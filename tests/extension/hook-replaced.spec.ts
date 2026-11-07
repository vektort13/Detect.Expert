// Hook replacement by the page (spec A11 gate 3, REQ-003, REQ-014): after load the page installs its own wrapper
// over HTMLCanvasElement.prototype.toDataURL. Expected: the call keeps working through both wrappers, the
// extension has not touched Function.prototype.toString, and (honestly) the extension wrapper is visible as
// non-native source — that is the documented limitation, not a bug.

import { expect, test } from './harness';
import { DET, fixtureResult, observed, signalCodesOf, techniqueCount, waitForReport } from './helpers';

interface HookReplacedResult {
  rewrapInstalled: boolean;
  callWorks: boolean;
  pageWrapperCalls: number;
  previousToDataURLLooksNative: boolean;
  previousToDataURLSourceLength: number | null;
  toStringIsNative: boolean;
  toStringDescriptor: { writable: boolean; configurable: boolean; enumerable: boolean; isFunction: boolean };
  toStringIdentityStable: boolean;
}

test('page re-wraps toDataURL: the page still works and Function.prototype.toString is untouched', async ({ ext, fixtures }) => {
  const url = fixtures.origins[0] + '/hook-replaced.html';
  const { ui, page, tabId } = await observed(ext, url);
  const result = await fixtureResult<HookReplacedResult>(page);
  expect(result.rewrapInstalled).toBe(true);
  expect(result.callWorks).toBe(true);
  expect(result.pageWrapperCalls).toBe(1);
  expect(result.toStringIsNative).toBe(true);
  expect(result.toStringIdentityStable).toBe(true);
  expect(result.toStringDescriptor).toEqual({ writable: true, configurable: true, enumerable: false, isFunction: true });
  // REQ-003: wrappers are not masked, so the extension's toDataURL wrapper is expected to look non-native.
  test.info().annotations.push({
    type: 'wrapper-visibility',
    description: result.previousToDataURLLooksNative ? 'toDataURL looked native before the page re-wrap (no extension wrapper installed?)' : 'extension wrapper visible as non-native source (documented limitation, REQ-003)',
  });
  expect(result.previousToDataURLLooksNative, 'the extension wrapper must not masquerade as native code (REQ-003)').toBe(false);

  // The extension wrapper sits under the page wrapper and keeps counting.
  const first = await waitForReport(ui, tabId, (r) => techniqueCount(r, DET.canvasExport) >= 1, { describe: 'DET-001 observed through the page wrapper' });
  const more = await page.evaluate(() => (window as unknown as { __readbackAgain: (n: number) => number }).__readbackAgain(3));
  expect(more).toBe(3);
  const second = await waitForReport(ui, tabId, (r) => techniqueCount(r, DET.canvasExport) >= 4, { describe: 'DET-001 keeps counting after the re-wrap' });
  expect(second.documentKey).toBe(first.documentKey);
  test.info().annotations.push({ type: 'signal-codes', description: 'DET-001: ' + signalCodesOf(second, DET.canvasExport).join(',') });
});
