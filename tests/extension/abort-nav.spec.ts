// Aborted navigation (REQ-009, ADR-005, overview §4 onErrorOccurred): the page starts navigating to /slow
// (the stand answers after 5 s) and the navigation is cancelled with window.stop(). Expected: the current
// document's report survives (same documentKey, counts intact) and keeps accumulating.

import { expect, test } from './harness';
import { writeFileSync } from 'node:fs';
import { DET, fixtureResult, observed, techniqueCount, topFrame, waitForReport } from './helpers';

test('an aborted navigation does not erase the current document report', async ({ ext, fixtures }) => {
  const url = fixtures.origins[0] + '/abort-nav.html';
  const { sw, ui, page, tabId } = await observed(ext, url);
  const result = await fixtureResult<{ readbacks: number }>(page);
  expect(result.readbacks).toBe(1);
  const before = await topFrame(sw, tabId);
  const reportBefore = await waitForReport(ui, tabId, (r) => techniqueCount(r, DET.pixelReadback) >= 1, { describe: 'DET-002 observed before the navigation attempt' });
  expect(reportBefore.documentKey).toBe(String(tabId) + ':0:' + before.documentId);

  // Start the navigation from inside the page (a real link click), let the request reach the server, then abort
  // through CDP (Page.stopLoading = the browser's Stop button); no page script runs while the navigation is pending.
  const cdp = await ext.context.newCDPSession(page);
  await page.evaluate(() => (document.getElementById('slow') as HTMLAnchorElement).click());
  await expect.poll(() => fixtures.stats.slowRequests, { timeout: 5000 }).toBe(1);
  await cdp.send('Page.stopLoading');
  await expect.poll(() => fixtures.stats.slowAborted, { timeout: 5000 }).toBe(1);
  expect(page.url()).toBe(url);
  expect(await page.evaluate(() => (window as unknown as { __fixtureResult?: unknown }).__fixtureResult !== undefined)).toBe(true);

  // Same document, report intact, still counting.
  const after = await topFrame(sw, tabId);
  expect(after.documentId).toBe(before.documentId);
  const reportAfter = await waitForReport(ui, tabId, (r) => r.documentKey === reportBefore.documentKey && techniqueCount(r, DET.pixelReadback) >= 1, { describe: 'report survives the aborted navigation' });
  expect(reportAfter.host).toBeNull();
  const more = await page.evaluate(() => (window as unknown as { __readbackAgain: (n: number) => number }).__readbackAgain(2));
  expect(more).toBe(2);
  const reportMore = await waitForReport(ui, tabId, (r) => techniqueCount(r, DET.pixelReadback) >= 3, { describe: 'counts keep accumulating after the abort' });
  expect(reportMore.documentKey).toBe(reportBefore.documentKey);

  // The slow navigation must not have completed later on.
  await page.waitForTimeout(5500);
  expect(page.url()).toBe(url);
  expect(fixtures.stats.slowRequests).toBe(1);
});

// F023: gather browser traces before proposing replacement transitions; cancellation != error page != crash.
test('records error-page and renderer-crash lifecycle traces', async ({ ext, fixtures }) => {
  const { sw, page, tabId } = await observed(ext, fixtures.origins[0] + '/abort-nav.html');
  await sw.evaluate((id) => {
    const state = globalThis as unknown as { __navigationTrace: Array<Record<string, unknown>> };
    state.__navigationTrace = [];
    const capture = (kind: string, event: { tabId: number; frameId: number; documentId?: string; documentLifecycle?: string; error?: string }) => {
      if (event.tabId !== id || state.__navigationTrace.length >= 32) return;
      state.__navigationTrace.push({ kind, frameId: event.frameId, documentId: event.documentId ?? null,
        lifecycle: event.documentLifecycle ?? null, error: event.error ?? null });
    };
    chrome.webNavigation.onBeforeNavigate.addListener((e) => capture('before', e));
    chrome.webNavigation.onCommitted.addListener((e) => capture('committed', e));
    chrome.webNavigation.onErrorOccurred.addListener((e) => capture('error', e));
  }, tabId);
  await page.route('**/controlled-error', (route) => route.abort('failed'));
  await page.goto(fixtures.origins[0] + '/controlled-error').catch(() => undefined);
  const trace = () => sw.evaluate(() => (globalThis as unknown as { __navigationTrace: Array<Record<string, unknown>> }).__navigationTrace);
  await expect.poll(async () => (await trace()).some((e) => e['kind'] === 'error')).toBe(true);
  const errorTrace = await trace();
  await page.goto(fixtures.origins[0] + '/abort-nav.html');
  await sw.evaluate(() => { (globalThis as unknown as { __navigationTrace: unknown[] }).__navigationTrace = []; });
  const cdp = await ext.context.newCDPSession(page);
  const version = await cdp.send('Browser.getVersion');
  const crashed = page.waitForEvent('crash');
  void cdp.send('Page.crash').catch(() => undefined);
  await crashed;
  // A bounded observation interval, not evidence that Chrome will never emit another event.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const crashTrace = await trace();
  const artifact = test.info().outputPath('F023-navigation-traces.json');
  writeFileSync(artifact, JSON.stringify({ browser: version.product, errorTrace, crashTrace, rendererCrashObserved: true, crashObservationMs: 1000 }, null, 2));
  await test.info().attach('F023-navigation-traces', { path: artifact, contentType: 'application/json' });
});
