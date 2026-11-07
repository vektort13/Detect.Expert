// Sensor reinstall (ADR-006 §9, vertical slice §4 "reinstall"): hook.main.js is injected two more times into a
// document that already has the sensor (registered at document_start). Expected: one set of wrappers; n calls
// are counted exactly n times, never 2n/3n.

import { expect, test } from './harness';
import { DET, fixtureResult, observed, techniqueCount, waitForReport } from './helpers';

test('injecting hook.main.js again does not duplicate wrappers or counts', async ({ ext, fixtures }) => {
  const url = fixtures.origins[0] + '/reinstall.html';
  const { sw, ui, page, tabId } = await observed(ext, url);
  const initial = await fixtureResult<{ ready: boolean; readbacks: number }>(page);
  expect(initial.ready).toBe(true);
  expect(initial.readbacks).toBe(0);

  for (let i = 0; i < 2; i++) {
    const injected = await sw.evaluate(async (id) => {
      const results = await chrome.scripting.executeScript({ target: { tabId: id }, files: ['hook.main.js'], world: 'MAIN', injectImmediately: true });
      return results.length;
    }, tabId);
    expect(injected).toBe(1);
    expect(await sw.evaluate(async (id) => (await chrome.scripting.executeScript({
      target: { tabId: id }, files: ['bridge.js'], world: 'ISOLATED', injectImmediately: true,
    })).length, tabId)).toBe(1);
  }

  const done = await page.evaluate(() => (window as unknown as { __readback: (n: number) => number }).__readback(5));
  expect(done).toBe(5);
  const report = await waitForReport(ui, tabId, (r) => techniqueCount(r, DET.pixelReadback) >= 5, { describe: 'five readbacks counted once' });
  // Give any duplicate sensor time to flush its own batch, then assert exactness.
  await page.waitForTimeout(1500);
  const settled = await waitForReport(ui, tabId, (r) => r.documentKey === report.documentKey, { describe: 'same document' });
  expect(techniqueCount(settled, DET.pixelReadback)).toBe(5);
  expect(techniqueCount(settled, DET.text)).toBe(1);
  expect(settled.coverageFlags).not.toContain('hook-failed');
});
