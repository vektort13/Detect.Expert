import { BUDGETS } from '@detect-expert/contracts';
import type { Worker } from '@playwright/test';
import { expect, test } from '../harness';
import { DET, fixtureResult, observed, techniqueCount, waitForReport } from '../helpers';
import { bridgeProbe, workerControl } from './probe';

test('P07: batches before readiness are bounded, excess is counted and revisions serialize', async ({ ext, fixtures }) => {
  const { sw, ui, page, tabId } = await observed(ext, fixtures.origins[0] + '/reinstall.html');
  await fixtureResult(page);
  await page.evaluate(() => (window as unknown as { __readback(n: number): number }).__readback(1));
  const baseline = await waitForReport(ui, tabId, (r) => techniqueCount(r, DET.pixelReadback) === 1);
  const probe = await bridgeProbe(page, sw);
  await expect.poll(async () => (await probe.snapshot()).inFlightBatchSeq).toBeNull();
  await sw.evaluate(() => chrome.storage.local.set({ 'test:p07:hold-readiness': true }));
  const control = await workerControl(ui, sw);
  await control.stop();
  await ui.evaluate(() => { void chrome.runtime.sendMessage({ schemaVersion: 1, type: 'ui-get-scope' }); });
  // Chromium may reuse the Playwright Worker wrapper while replacing its execution context.
  let restarted: Worker | undefined;
  await expect.poll(async () => {
    const candidate = ext.context.serviceWorkers().at(-1);
    if (!candidate) return false;
    try {
      const ready = await candidate.evaluate(() => typeof (globalThis as unknown as { __p07ReleaseReadiness?: () => void }).__p07ReleaseReadiness === 'function');
      if (ready) restarted = candidate;
      return ready;
    } catch { return false; }
  }).toBe(true);
  if (!restarted) throw new Error('Missing restarted worker execution context');
  await restarted.evaluate((key) => {
    const original = chrome.storage.session.set.bind(chrome.storage.session);
    const writes: Array<{ revision: number; seq: number; count: number }> = [];
    Object.assign(globalThis, { __p07Writes: writes });
    chrome.storage.session.set = (async (items: Record<string, unknown>) => {
      const stored = items['doc:' + key] as { report?: { revision: number; watermark?: { bridgeSessionId: string; lastCommittedBatchSeq: number }; counters: Array<{ techniqueId: string; count: number }> } } | undefined;
      if (stored?.report?.watermark?.bridgeSessionId === 'p07-hydration') {
        writes.push({ revision: stored.report.revision, seq: stored.report.watermark.lastCommittedBatchSeq,
          count: stored.report.counters.find((c) => c.techniqueId === 'DET-040')?.count ?? 0 });
      }
      return original(items);
    }) as typeof original;
  }, baseline.documentKey);
  await probe.evaluate('globalThis.__p07Replies = []; true');
  for (let group = 0; group < 16; group++) {
    await restarted.evaluate(() => (globalThis as unknown as { __p02: { advanceTime(ms: number): void } }).__p02.advanceTime(1000));
    await probe.evaluate(`for (let i = ${group * 10 + 1}; i <= ${group * 10 + 10}; i++) {
      chrome.runtime.sendMessage({ schemaVersion: 1, type: 'sensor-events', sensorBootId: 'p07-hydration',
        bridgeSessionId: 'p07-hydration', batchSeq: i, coverageDelta: [], observations: [
          { techniqueId: 'DET-040', phase: 'attempted', count: i, countQuality: 'exact', signalCodes: ['api-use'], intervalBucket: 1 }
        ] }).then(reply => __p07Replies.push({ seq: i, reply }));
    } true`);
    // Ensure the previous group reached admission before advancing the SW clock again.
    await page.waitForTimeout(30);
  }
  await expect.poll(() => probe.evaluate<number>('__p07Replies.length')).toBe(160 - BUDGETS.maxOutOfOrderEntriesGlobal);
  expect(await restarted.evaluate(() => (globalThis as unknown as { __p02: { diagnostics(): { pendingDropped: number } } }).__p02.diagnostics().pendingDropped)).toBe(32);
  expect(await restarted.evaluate(() => (globalThis as unknown as { __p07Writes: unknown[] }).__p07Writes.length)).toBe(0);
  expect(await restarted.evaluate(async (key) => ((await chrome.storage.session.get('doc:' + key))['doc:' + key] as { report: { revision: number } }).report.revision, baseline.documentKey)).toBe(baseline.reportRevision);
  await restarted.evaluate(() => (globalThis as unknown as { __p07ReleaseReadiness(): void }).__p07ReleaseReadiness());
  await expect.poll(() => probe.evaluate<number>('__p07Replies.length')).toBe(160);
  const report = await waitForReport(ui, tabId, (r) => techniqueCount(r, 'DET-040') === 128);
  expect(report.dropped.transport).toBe(32);
  expect(report.coverageFlags).toContain('throttled');
  const replies = await probe.evaluate<Array<{ seq: number; reply: { type: string; lastCommittedBatchSeq: number } }>>('__p07Replies');
  expect(replies.filter((r) => r.seq > 128).every((r) => r.reply.type === 'ack' && r.reply.lastCommittedBatchSeq === 0)).toBe(true);
  expect(replies.filter((r) => r.seq <= 128).every((r) => r.reply.lastCommittedBatchSeq === r.seq)).toBe(true);
  const writes = await restarted.evaluate(() => (globalThis as unknown as { __p07Writes: Array<{ revision: number; seq: number; count: number }> }).__p07Writes);
  const commits = writes.filter((w, index) => index === 0 || w.seq !== writes[index - 1]!.seq);
  expect(commits.map((w) => w.seq)).toEqual(Array.from({ length: 128 }, (_, i) => i + 1));
  for (let i = 0; i < commits.length; i++) {
    expect(commits[i]!.count).toBe(commits[i]!.seq);
    expect(commits[i]!.revision).toBeGreaterThan(i === 0 ? baseline.reportRevision : commits[i - 1]!.revision);
  }
  await restarted.evaluate(() => chrome.storage.local.remove('test:p07:hold-readiness'));
  await probe.cdp.detach();
  await control.cdp.detach();
});
