import { expect, test } from '../harness';
import { DET, fixtureResult, observed, techniqueCount, waitForReport } from '../helpers';
import { bridgeProbe } from './probe';

test('P07: persistent SW errors exhaust production retry budget and leave zero calls over 30 seconds', async ({ ext, fixtures }) => {
  test.setTimeout(270_000);
  console.log('P07 retry: intentional long test, 33 real retries followed by a 30-second suspended window (270-second total deadline)');
  const { sw, ui, page, tabId } = await observed(ext, fixtures.origins[0] + '/reinstall.html');
  await fixtureResult(page);
  const probe = await bridgeProbe(page, sw);
  await expect.poll(async () => (await probe.snapshot()).inFlightBatchSeq).toBeNull();
  // Add an error responder in the actual SW. No fake sender or successful ACK.
  await sw.evaluate(() => {
    const api = chrome.runtime.onMessage;
    const fail = (_message: unknown, _sender: chrome.runtime.MessageSender, reply: (value: unknown) => void) => {
      reply({ schemaVersion: 1, type: 'error', code: 'invalid-request' });
      return true;
    };
    Object.assign(globalThis, { __p07Fail: fail });
    // The production listener remains; intercept its asynchronous persistence so only the test error answers.
    const original = chrome.storage.session.set.bind(chrome.storage.session);
    chrome.storage.session.set = (() => new Promise<void>(() => {})) as typeof original;
    api.addListener(fail);
  });
  await probe.evaluate('__p07Wire.calls = []; true');
  await page.evaluate(() => (window as unknown as { __readback(n: number): number }).__readback(1));
  await page.waitForTimeout(30_000);
  const firstWindow = await probe.evaluate<number>('__p07Wire.calls.length');
  expect(firstWindow).toBeGreaterThan(1);
  expect(firstWindow).toBeLessThanOrEqual(8);
  console.log('P07 retry progress: ' + firstWindow + ' calls in the first 30 seconds');
  let reported = firstWindow;
  await expect.poll(async () => {
    const state = await probe.snapshot();
    if (state.stats.acksInvalid >= reported + 5 || state.transportSuspended) {
      reported = state.stats.acksInvalid;
      console.log('P07 retry progress: ' + reported + '/33 invalid acknowledgements; suspended=' + state.transportSuspended);
    }
    return state.transportSuspended;
  }, { timeout: 210_000, intervals: [1000] }).toBe(true);
  const before = await probe.evaluate<Array<{ at: number; batch: { batchSeq: number } }>>('__p07Wire.calls');
  expect(before).toHaveLength(33);
  const state = await probe.snapshot();
  expect(state.stats.batchesAbandoned).toBe(3);
  expect(state.stats.acksInvalid).toBe(33);
  expect(state.pendingCoverage).toEqual(expect.arrayContaining(['channel-gap', 'budget-exceeded']));
  for (let i = 1; i < 5; i++) expect(before[i]!.at - before[i - 1]!.at).toBeGreaterThanOrEqual(450 * 2 ** (i - 1));
  await page.evaluate(() => (window as unknown as { __readback(n: number): number }).__readback(1));
  const start = Date.now();
  await page.waitForTimeout(30_000);
  const after = await probe.evaluate<number>('__p07Wire.calls.length');
  expect(after).toBe(before.length);
  const measurement = { first30Seconds: firstWindow, totalCalls: after, suspendedWindowMs: Date.now() - start, suspendedCalls: after - before.length };
  console.log('P07 retry measurement: ' + JSON.stringify(measurement));
  await test.info().attach('retry-measurement', { body: JSON.stringify(measurement), contentType: 'application/json' });
  // The gap is local while every SW response fails. A restart + explicit resume delivers it durably.
  const { workerControl } = await import('./probe');
  const control = await workerControl(ui, sw);
  await control.stop();
  await probe.evaluate('__p07Collector.resume(); true');
  const report = await waitForReport(ui, tabId, (r) => r.coverageFlags.includes('channel-gap'), { timeoutMs: 15_000 });
  expect(techniqueCount(report, DET.pixelReadback)).toBe(2);
  await probe.cdp.detach();
  await control.cdp.detach();
});
