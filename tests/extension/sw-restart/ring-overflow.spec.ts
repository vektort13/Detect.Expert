import { BUDGETS, SIGNAL_CODES } from '@detect-expert/contracts';
import type { PageBatch } from '@detect-expert/contracts';
import { expect, test } from '../harness';
import { DET, fixtureResult, observed, techniqueCount, waitForReport } from '../helpers';
import { bridgeProbe, workerControl } from './probe';

test('P07: 544 dirty aggregates overflow the stopped-worker ring and replay by max', async ({ ext, fixtures }) => {
  console.log('P07 ring stage: test body starting');
  const { sw, ui, page, tabId } = await test.step('P07 observe fixture', () => observed(ext, fixtures.origins[0] + '/reinstall.html', stage => console.log('P07 ring observation: ' + stage)), { timeout: 10_000 });
  await test.step('P07 fixture result', () => fixtureResult(page), { timeout: 10_000 });
  console.log('P07 ring stage: fixture observed');
  const probe = await bridgeProbe(page, sw);
  let control: Awaited<ReturnType<typeof workerControl>> | undefined;
  try {
  console.log('P07 ring stage: bridge probe attached');
  await expect.poll(async () => (await probe.snapshot()).inFlightBatchSeq).toBeNull();
  // Let a late startup batch (e.g. fillText/DET-003) commit instead of holding
  // it ahead of our readback. The retained in-flight packet must contain DET-002.
  await probe.evaluate('__p07Wire.holdTechnique = "DET-002"; __p07Wire.hold = true; __p07Wire.calls = []; true');
  await page.evaluate(() => (window as unknown as { __readback(n: number): number }).__readback(1));
  await expect.poll(async () => {
    const sequence = (await probe.snapshot()).inFlightBatchSeq;
    return probe.evaluate<boolean>('__p07Wire.calls.some(call => call.batch.batchSeq === ' + JSON.stringify(sequence) + ' && call.batch.observations.some(item => item.techniqueId === "DET-002"))');
  }, { message: 'the held in-flight packet contains the readback before stopping the worker' }).toBe(true);
  console.log('P07 ring stage: held packet contains DET-002');
  control = await workerControl(ui, sw);
  await control.stop();
  console.log('P07 ring stage: worker stopped');
  // MAIN postMessage supplies page-controlled stimuli while sendMessage cannot wake the worker.
  const beforeFlood = await probe.snapshot();
  const boot = beforeFlood.sensorBootIds[0]!;
  await page.evaluate(({ boot, codes }) => {
    const observations = [];
    for (let mask = 0; observations.length < 544; mask++) {
      const signalCodes = codes.filter((_, bit) => (mask & (1 << bit)) !== 0);
      if (signalCodes.length > 8) continue;
      observations.push({ techniqueId: 'DET-040', count: observations.length + 1, countQuality: 'exact', phase: 'attempted', signalCodes, intervalBucket: 1 });
    }
    for (let offset = 0; offset < observations.length; offset += 32) {
      window.postMessage({
        channel: 'detect.expert/v1', type: 'sensor-batch', sensorBootId: boot,
        sensorSeq: 10 + offset / 32, observations: observations.slice(offset, offset + 32), coverageDelta: [],
      }, '*');
    }
  }, { boot, codes: SIGNAL_CODES.slice(0, 10) });
  await expect.poll(async () => (await probe.snapshot()).ringSize).toBe(512);
  const filled = await probe.snapshot();
  expect(filled.ringSize).toBe(BUDGETS.maxBridgeRecordsPerDocument);
  expect(filled.ringDirty).toBe(512);
  expect(filled.stats.ringEvictedDirty - beforeFlood.stats.ringEvictedDirty).toBe(beforeFlood.ringDirty + 544 - 512);
  expect(filled.pendingCoverage).toEqual(expect.arrayContaining(['channel-gap', 'bridge-ring-overflow']));
  console.log('P07 ring stage: ring filled and dirty overflow asserted');
  expect(await probe.evaluate<number>('__p07Wire.calls.filter(call => call.batch.observations.some(item => item.techniqueId === "DET-002")).length')).toBe(1);
  await probe.evaluate('__p07Wire.hold = false; if (typeof __p07Wire.release !== "function") throw Error("held physical send missing"); __p07Wire.release(); true');
  const report = await waitForReport(ui, tabId, (r) => r.coverageFlags.includes('bridge-ring-overflow'), { timeoutMs: 15_000 });
  expect(report.coverageFlags).toContain('channel-gap');
  expect(report.dropped.ring).toBeGreaterThan(0);
  await expect.poll(async () => (await probe.snapshot()).ringDirty).toBe(0);
  const wire = await probe.evaluate<Array<{ batch: PageBatch }>>('__p07Wire.calls');
  const retained = wire.flatMap((call) => call.batch.observations).filter((o) => o.techniqueId === 'DET-040');
  expect(Math.min(...retained.map((o) => o.count))).toBe(33);
  expect(Math.max(...retained.map((o) => o.count))).toBe(544);
  const settled = await waitForReport(ui, tabId, (r) => techniqueCount(r, DET.pixelReadback) === 1);
  console.log('P07 ring stage: overflow committed and DET-002 retained');
  const replay = wire.find((call) => call.batch.observations.some((o) => o.techniqueId === 'DET-040'))!.batch;
  await probe.evaluate('chrome.runtime.sendMessage(' + JSON.stringify(replay) + ')');
  console.log('P07 ring stage: duplicate replay acknowledged');
  const repeated = await waitForReport(ui, tabId, (r) => r.documentKey === settled.documentKey);
  expect(repeated.techniques).toEqual(settled.techniques);
  expect(repeated.dropped.ring).toBe(settled.dropped.ring);
  // A fresh sequence with the same cumulative totals exercises max-merge, independently of dedup.
  const fresh = { ...replay, batchSeq: (await probe.snapshot()).lastBatchSeq + 1 };
  const committed = await probe.evaluate<{ lastCommittedBatchSeq: number }>('chrome.runtime.sendMessage(' + JSON.stringify(fresh) + ')');
  expect(committed.lastCommittedBatchSeq).toBe(fresh.batchSeq);
  console.log('P07 ring stage: fresh sequence acknowledged');
  expect((await waitForReport(ui, tabId, (r) => r.documentKey === settled.documentKey && r.reportRevision > settled.reportRevision)).techniques).toEqual(settled.techniques);
  await ui.goto(ui.url().split('?')[0] + '?tabId=' + tabId);
  await expect(ui.locator('.flags__list')).toContainText(/разрыв|gap/i);
  console.log('P07 ring: ' + JSON.stringify({ dirtyEvictions: filled.stats.ringEvictedDirty, retainedMin: 33, retainedMax: 544, dropped: repeated.dropped }));
  } finally {
    await Promise.allSettled([probe.detach(), control?.detach()]);
  }
});
