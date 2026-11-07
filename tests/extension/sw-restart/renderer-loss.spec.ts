import { expect, getServiceWorker, test } from '../harness';
import { DET, fixtureResult, getReport, observed, techniqueCount, waitForReport } from '../helpers';
import { bridgeProbe, workerControl } from './probe';

test('P07: renderer closes before ACK; closed-document gap requires retained history', async ({ ext, fixtures }) => {
  const { sw, ui, page, tabId } = await observed(ext, fixtures.origins[0] + '/reinstall.html');
  await fixtureResult(page);
  await page.evaluate(() => (window as unknown as { __readback(n: number): number }).__readback(1));
  const first = await waitForReport(ui, tabId, (r) => techniqueCount(r, DET.pixelReadback) === 1);
  const probe = await bridgeProbe(page, sw);
  await expect.poll(async () => (await probe.snapshot()).inFlightBatchSeq).toBeNull();
  await sw.evaluate((key) => {
    const original = chrome.storage.session.set.bind(chrome.storage.session);
    chrome.storage.session.set = (async (items: Record<string, unknown>) => {
      const stored = items['doc:' + key] as { report?: { counters: Array<{ techniqueId: string; count: number }> } } | undefined;
      if (stored?.report?.counters.some((c) => c.techniqueId === 'DET-002' && c.count === 4)) {
        Object.assign(globalThis, { __p07BeforeSave: true });
        await new Promise<void>(() => {});
      } else await original(items);
    }) as typeof original;
  }, first.documentKey);
  await page.evaluate(() => (window as unknown as { __readback(n: number): number }).__readback(3));
  await expect.poll(() => sw.evaluate(() => (globalThis as unknown as { __p07BeforeSave?: boolean }).__p07BeforeSave)).toBe(true);
  expect((await probe.snapshot()).inFlightBatchSeq).not.toBeNull();
  await probe.evaluate('__p07Wire.hold = true; true');
  const control = await workerControl(ui, sw);
  await control.stop();
  await page.close();
  await expect.poll(() => getReport(ui, tabId)).toBeNull();
  const restarted = await getServiceWorker(ext.context);
  await expect.poll(() => restarted.evaluate(async (key) => (await chrome.storage.session.get('doc:' + key))['doc:' + key] ?? null, first.documentKey)).toBeNull();
  await control.cdp.detach();
  test.fixme(true, 'MV3 cannot recover an unpersisted ISOLATED queue after its renderer is destroyed. The current ADR-005 close policy purges tab reports and ui-get-report only selects live bindings; therefore no closed-document projection exists to carry dropped/channel-gap. Acceptance requires a reviewed retained-history/tombstone policy and UI selection, outside P07 allowed runtime/repository changes. CDP stop-before-save and actual tab closure/purge were verified above.');
});
