// BFCache (ADR-005, overview §4, docs/coverage/matrix.md §1): A → B → back. Playwright disables the
// back/forward cache by default (--disable-back-forward-cache), so this spec launches its own session with
// that switch removed. If Chromium still does not restore the page (pageshow.persisted === false), the CDP
// not-restored reasons are recorded and the test is marked fixme instead of asserting something weaker.

import { expect, launch, test } from './harness';
import { DET, fixtureResult, observed, signalCodesOf, techniqueCount, topFrame, waitForReport } from './helpers';

interface BfcacheResult {
  readbacks: number;
  pageshow: Array<{ persisted: boolean }>;
  pagehide: Array<{ persisted: boolean }>;
}

test('BFCache restore keeps the same documentId and report, flags bfcache-restore', async ({ fixtures }) => {
  const ext = await launch({ backForwardCache: true });
  try {
    const origin = fixtures.origins[0];
    const { sw, ui, page, tabId } = await observed(ext, origin + '/bfcache-a.html');
    const cdp = await ext.context.newCDPSession(page);
    await cdp.send('Page.enable');
    const notRestored: string[] = [];
    cdp.on('Page.backForwardCacheNotUsed', (event) => {
      const reasons = (event.notRestoredExplanations ?? []).map((e) => e.reason);
      notRestored.push(...reasons);
    });

    const first = await fixtureResult<BfcacheResult>(page);
    expect(first.pageshow.map((p) => p.persisted)).toEqual([false]);
    const before = await topFrame(sw, tabId);
    const reportBefore = await waitForReport(ui, tabId, (r) => techniqueCount(r, DET.pixelReadback) >= 1, { describe: 'DET-002 observed on page A' });
    expect(reportBefore.documentKey).toBe(String(tabId) + ':0:' + before.documentId);

    await page.click('#to-b');
    await page.waitForURL(/bfcache-b\.html$/);
    await fixtureResult(page);
    await page.goBack({ waitUntil: 'commit' });
    await page.waitForFunction(() => {
      const r = (window as unknown as { __fixtureResult?: { pageshow?: unknown[] } }).__fixtureResult;
      return r !== undefined && Array.isArray(r.pageshow) && r.pageshow.length >= 2;
    });
    const restored = await fixtureResult<BfcacheResult>(page);
    const persisted = restored.pageshow[1]?.persisted === true;
    test.info().annotations.push({ type: 'bfcache', description: 'persisted=' + String(persisted) + (notRestored.length > 0 ? '; not-restored reasons: ' + notRestored.join(',') : '') });
    test.fixme(!persisted, 'Chromium did not restore page A from BFCache in this harness (pageshow.persisted=false; reasons: ' + (notRestored.join(',') || 'none reported via CDP') + '). The scenario cannot be verified until restore works here.');

    const after = await topFrame(sw, tabId);
    expect(after.documentId).toBe(before.documentId);
    expect(restored.pagehide.map((p) => p.persisted)).toEqual([true]);

    const countBefore = techniqueCount(reportBefore, DET.pixelReadback);
    const reportAfter = await waitForReport(ui, tabId, (r) => r.documentKey === reportBefore.documentKey && techniqueCount(r, DET.pixelReadback) >= countBefore, {
      describe: 'report retained on the restored document',
    });
    expect(reportAfter.coverageState).not.toBe('no-access');

    const more = await page.evaluate(() => (window as unknown as { __readbackAgain: (n: number) => number }).__readbackAgain(1));
    expect(more).toBe(1);
    const reportMore = await waitForReport(ui, tabId, (r) => techniqueCount(r, DET.pixelReadback) >= countBefore + 1, { describe: 'a readback after restore counts on the same document' });
    expect(reportMore.documentKey).toBe(reportBefore.documentKey);
    // The restore itself must be visible: contracts define the `bfcache-restore` signal code for it.
    const codes = [...new Set(reportMore.techniques.flatMap((t) => t.signalCodes))];
    expect(codes, 'expected the bfcache-restore signal code on the restored document; DET-002 codes: ' + signalCodesOf(reportMore, DET.pixelReadback).join(',')).toContain('bfcache-restore');
  } finally {
    await ext.close();
  }
});
