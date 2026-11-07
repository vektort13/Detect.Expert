// SPA navigation (ADR-005, overview §4): pushState/replaceState/hash changes never change the document.
// Expected: one documentKey (tab:0:documentId from webNavigation) before and after, counts accumulate,
// and only one stored report for the tab. The pushed query/path/fragment must not be stored (REQ-005).

import { expect, test } from './harness';
import { DET, dumpSession, fixtureResult, observed, storedReportsForTab, techniqueCount, topFrame, waitForReport } from './helpers';

interface SpaResult {
  steps: string[];
  readbacks: number;
  finalPathIsSpa: boolean;
}

test('SPA navigation keeps one documentKey and accumulates counts', async ({ ext, fixtures }) => {
  const url = fixtures.origins[0] + '/spa-navigation.html';
  const { sw, ui, page, tabId } = await observed(ext, url);
  const result = await fixtureResult<SpaResult>(page);
  expect(result.steps).toEqual(['initial', 'pushState', 'replaceState', 'hash']);
  expect(result.readbacks).toBe(4);

  const top = await topFrame(sw, tabId);
  const expectedKey = String(tabId) + ':0:' + top.documentId;
  const report = await waitForReport(ui, tabId, (r) => techniqueCount(r, DET.pixelReadback) >= 4, { describe: 'four readbacks across SPA steps' });
  expect(report.documentKey).toBe(expectedKey);

  const more = await page.evaluate(() => (window as unknown as { __readbackAgain: (n: number) => number }).__readbackAgain(2));
  expect(more).toBe(2);
  const later = await waitForReport(ui, tabId, (r) => techniqueCount(r, DET.pixelReadback) >= 6, { describe: 'counts keep accumulating on the same document' });
  expect(later.documentKey).toBe(expectedKey);
  expect((await topFrame(sw, tabId)).documentId).toBe(top.documentId);

  // One stored report for this document; the tab's earlier about:blank document may keep its own (host null) record.
  const session = await dumpSession(sw);
  const stored = storedReportsForTab(session, tabId);
  test.info().annotations.push({ type: 'stored-reports', description: stored.map((r) => String(r['documentKey']) + ' host=' + String(r['host'])).join('; ') });
  expect(stored.filter((r) => r['coverageState'] !== 'no-access').map((r) => r['documentKey'])).toEqual([expectedKey]);
  expect(stored.every((r) => r['host'] === null)).toBe(true);
  const serialized = JSON.stringify(session);
  for (const leak of ['SPA-QUERY-TOKEN-01', 'SPA-PATH-ID-4477', 'SPA-FRAGMENT-9021', 'step=1', '?', '#']) {
    expect(serialized, 'URL part must not be stored: ' + leak).not.toContain(leak);
  }
});
