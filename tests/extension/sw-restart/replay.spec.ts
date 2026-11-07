// REQ-009 / F006/F115: actual Chromium worker termination on both sides of storage.session.set.
// Instrumentation lives only in this test; no extension permission or production test hook is added.
import { expect, getServiceWorker, test } from '../harness';
import { DET, fixtureResult, observed, techniqueCount, waitForReport } from '../helpers';

for (const boundary of ['before-save', 'after-save'] as const) {
  test('worker termination ' + boundary + ' replays cumulative data exactly once', async ({ ext, fixtures }) => {
    const { sw, ui, page, tabId } = await observed(ext, fixtures.origins[0] + '/reinstall.html');
    await fixtureResult(page);
    await page.evaluate(() => (window as unknown as { __readback(n: number): number }).__readback(1));
    const first = await waitForReport(ui, tabId, (r) => techniqueCount(r, DET.pixelReadback) === 1);
    const cdp = await ext.context.newCDPSession(ui);
    let versionId: string | undefined;
    cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
      for (const version of versions) if (version.scriptURL === sw.url() && version.runningStatus === 'running') versionId = version.versionId;
    });
    await cdp.send('ServiceWorker.enable');
    await expect.poll(() => versionId).toBeTruthy();
    await sw.evaluate(async (id) => {
      await chrome.scripting.executeScript({ target: { tabId: id }, world: 'ISOLATED', func: () => {
        const original = chrome.runtime.sendMessage;
        const root = window as unknown as { __replayWire: Array<{ seq: number; session: string }> };
        root.__replayWire = [];
        chrome.runtime.sendMessage = function (...args: unknown[]) {
          const batch = args[0] as { batchSeq: number; bridgeSessionId: string; observations?: Array<{ techniqueId: string; count: number }> };
          if (batch.observations?.some((o) => o.techniqueId === 'DET-002' && o.count === 4) && root.__replayWire.length < 32) {
            root.__replayWire.push({ seq: batch.batchSeq, session: batch.bridgeSessionId });
          }
          return Reflect.apply(original, chrome.runtime, args);
        } as typeof original;
      } });
    }, tabId);
    await sw.evaluate(({ boundary, key }) => {
      const original = chrome.storage.session.set.bind(chrome.storage.session);
      const state = globalThis as unknown as { __saveBoundary?: string };
      chrome.storage.session.set = (async (items: Record<string, unknown>) => {
        const stored = items['doc:' + key] as { report?: { counters?: Array<{ techniqueId: string; count: number }>; watermark?: { lastCommittedBatchSeq: number } } } | undefined;
        if (!stored?.report?.watermark || !stored.report.counters?.some((c) => c.techniqueId === 'DET-002' && c.count === 4)) return original(items);
        chrome.storage.session.set = original;
        if (boundary === 'after-save') await original(items);
        state.__saveBoundary = boundary;
        await new Promise<void>(() => undefined);
      }) as typeof chrome.storage.session.set;
    }, { boundary, key: first.documentKey });
    await page.evaluate(() => (window as unknown as { __readback(n: number): number }).__readback(3));
    await expect.poll(() => sw.evaluate(() => (globalThis as unknown as { __saveBoundary?: string }).__saveBoundary)).toBe(boundary);
    await cdp.send('ServiceWorker.stopWorker', { versionId: versionId! });
    const restored = await waitForReport(ui, tabId, (r) => techniqueCount(r, DET.pixelReadback) === 4,
      { timeoutMs: 15_000, describe: boundary + ': resumed worker commits replay' });
    expect(restored.documentKey).toBe(first.documentKey);
    await page.waitForTimeout(1500);
    const settled = await waitForReport(ui, tabId, (r) => r.documentKey === first.documentKey);
    expect(techniqueCount(settled, DET.pixelReadback)).toBe(4);
    const restarted = await getServiceWorker(ext.context);
    const replay = await restarted.evaluate(async (id) => (await chrome.scripting.executeScript({
      target: { tabId: id }, world: 'ISOLATED', func: () => (window as unknown as { __replayWire: Array<{ seq: number; session: string }> }).__replayWire,
    }))[0]!.result!, tabId);
    expect(replay.length).toBeGreaterThanOrEqual(2);
    expect(new Set(replay.map((b) => b.session + ':' + b.seq)).size).toBe(1);
    await cdp.detach();
  });
}
