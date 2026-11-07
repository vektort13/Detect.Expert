// ADR-073 / CORE-01/02: actual MAIN/ISOLATED reset, delayed old batch and worker restart.
import { expect, test } from './harness';
import { DET, brief, fixtureResult, getReport, observed, sendUi, techniqueCount, waitForReport } from './helpers';
import { getServiceWorker } from './harness';
import { workerControl } from './sw-restart/probe';

test('clear fences a buffered unseen key and old native ACK, then survives worker restart', async ({ ext, fixtures }) => {
  const { sw, ui, page, tabId } = await observed(ext, fixtures.origins[0] + '/reinstall.html');
  await fixtureResult(page);
  await page.evaluate(() => (window as unknown as { __readback(n: number): number }).__readback(100));
  const before = await waitForReport(ui, tabId, report => techniqueCount(report, DET.pixelReadback) === 100);
  await sw.evaluate(async id => {
    await chrome.scripting.executeScript({ target: { tabId: id }, world: 'ISOLATED', func: () => {
      const state = globalThis as unknown as { __clearHeld: boolean; __releaseClearBatch?: () => void };
      state.__clearHeld = false;
      const original = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = function (...args: unknown[]) {
        const batch = args[0] as { type?: string; observations?: Array<{ techniqueId: string }> } | undefined;
        if (!state.__clearHeld && batch?.type === 'sensor-events' && batch.observations?.some(row => row.techniqueId === 'DET-001')) {
          state.__clearHeld = true;
          return new Promise(resolve => { state.__releaseClearBatch = () => { delete state.__releaseClearBatch; resolve(Reflect.apply(original, chrome.runtime, args)); }; });
        }
        return Reflect.apply(original, chrome.runtime, args);
      } as typeof original;
    } });
  }, tabId);
  expect(await page.evaluate(() => document.createElement('canvas').toDataURL().startsWith('data:image/png'))).toBe(true);
  await expect.poll(() => sw.evaluate(async id => (await chrome.scripting.executeScript({ target: { tabId: id }, world: 'ISOLATED', func: () => (globalThis as unknown as { __clearHeld: boolean }).__clearHeld }))[0]?.result, tabId)).toBe(true);
  const current = await getReport(ui, tabId);
  if (!current) throw Error('report missing before clear');
  const cleared = await sendUi(ui, { schemaVersion: 1, type: 'ui-clear', tabId, documentKey: current.documentKey, reportRevision: current.reportRevision });
  expect(cleared.type, brief(cleared)).toBe('ok');
  await expect.poll(async () => { const report = await getReport(ui, tabId); return report ? [techniqueCount(report, DET.pixelReadback), techniqueCount(report, DET.canvasExport)] : [0, 0]; }).toEqual([0, 0]);
  expect(await page.evaluate(() => (window as unknown as { __readback(n: number): number }).__readback(1))).toBe(1);
  expect(await page.evaluate(() => document.createElement('canvas').toDataURL().startsWith('data:image/png'))).toBe(true);
  await sw.evaluate(async id => { await chrome.scripting.executeScript({ target: { tabId: id }, world: 'ISOLATED', func: () => (globalThis as unknown as { __releaseClearBatch?: () => void }).__releaseClearBatch?.() }); }, tabId);
  const fresh = await waitForReport(ui, tabId, report => techniqueCount(report, DET.pixelReadback) === 1 && techniqueCount(report, DET.canvasExport) === 1, { describe: 'only new epoch calls, including previously unseen key' });
  expect(fresh.documentKey).toBe(before.documentKey);
  await page.waitForTimeout(600);
  const settled = await getReport(ui, tabId);
  expect(techniqueCount(settled!, DET.pixelReadback)).toBe(1); expect(techniqueCount(settled!, DET.canvasExport)).toBe(1);
  const running = await getServiceWorker(ext.context), control = await workerControl(ui, running);
  try { await control.stop(); } finally { await control.detach(); }
  await page.evaluate(() => (window as unknown as { __readback(n: number): number }).__readback(1));
  const restored = await waitForReport(ui, tabId, report => techniqueCount(report, DET.pixelReadback) === 2, { timeoutMs: 15000, describe: 'cleared history stays absent after SW restart' });
  expect(techniqueCount(restored, DET.canvasExport)).toBe(1); expect(restored.documentKey).toBe(before.documentKey);
});
