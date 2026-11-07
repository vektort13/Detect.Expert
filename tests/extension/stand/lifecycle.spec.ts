// P06 / E02-01 #5-6 / ADR-005: browser lifecycle is authoritative, page markers are diagnostics.
import type { DocumentReport } from '@detect-expert/contracts';
import { test, expect, captureNavigation, navigationTrace, evidence } from './harness';
import { getServiceWorker, launch } from '../harness';
import { DET, ensureObserved, getReport, observed, openExtensionPage, tabIdOf, techniqueCount, topFrame, waitForReport } from '../helpers';

test('P06: prerender is separate before activation and retains documentId afterwards', async ({ ext, fixtures }) => {
  const sw = await getServiceWorker(ext.context);
  const ui = await openExtensionPage(ext.context, sw);
  await ensureObserved(sw, ui);
  await captureNavigation(sw);
  const page = await ext.context.newPage();
  const cdp = await ext.context.newCDPSession(page);
  await cdp.send('Preload.enable');
  const statuses: Array<{ status: string; prerenderStatus: string | null }> = [];
  cdp.on('Preload.prerenderStatusUpdated', (event) => {
    statuses.push({ status: event.status, prerenderStatus: event.prerenderStatus ?? null });
  });
  await page.goto(fixtures.origins[0] + '/prerender.html');
  await page.bringToFront();
  const tabId = await tabIdOf(sw, page.url());
  await expect.poll(() => statuses.some((s) => s.status === 'Ready' || s.status === 'Failure'), { timeout: 15000 }).toBe(true);
  const beforeTrace = await navigationTrace(sw);
  const before = await getReport(ui, tabId);
  expect(before).not.toBeNull();
  expect(before!.techniques).toEqual([]);
  const failure = statuses.find((s) => s.status === 'Failure');
  if (failure) {
    await evidence(page, 'prerender', { statuses, navigation: beforeTrace, before, verified: false });
    // Only explicit browser-level capability failures qualify, never a timeout or an extension assertion.
    test.fixme(failure.prerenderStatus === 'PrerenderingDisabledByDevTools',
      'Chromium 153 reports PrerenderingDisabledByDevTools through Preload.prerenderStatusUpdated under Playwright CDP auto-attach. No enabling flag is verified for this harness. Activation and documentId retention remain unverified.');
    test.fixme(failure.prerenderStatus === 'PreloadingDisabled' || failure.prerenderStatus === 'BatterySaverEnabled' || failure.prerenderStatus === 'MemoryPressureOnTrigger',
      'Chromium refused prerender: ' + failure.prerenderStatus + '. PreloadingDisabled may require --enable-features=Prerender2 and enabled page preloading; resource/power restrictions require a suitable host.');
  }
  expect(failure).toBeUndefined();
  const prerender = beforeTrace.find((event) => event.kind === 'committed' && event.lifecycle === 'prerender' && event.path === '/prerender-target.html');
  expect(prerender).toBeDefined();
  expect(prerender!.documentId).not.toBeNull();
  const readDocuments = () => sw.evaluate(async () => Object.values(await chrome.storage.session.get(null))
    .map((value) => (value as { report?: DocumentReport }).report).filter((report) => report?.lifecycle === 'prerender'));
  await expect.poll(async () => (await readDocuments()).some((report) => report!.documentId === prerender!.documentId && report!.counters.some((counter) => counter.techniqueId === DET.pixelReadback && counter.count > 0))).toBe(true);
  const documents = await readDocuments();
  expect(documents.some((report) => report!.documentId === prerender!.documentId && report!.counters.some((counter) => counter.techniqueId === DET.pixelReadback && counter.count > 0))).toBe(true);
  expect(documents.every((report) => report!.documentKey !== before!.documentKey)).toBe(true);
  await page.click('#activate');
  await page.waitForURL('**/prerender-target.html');
  const marker = await page.evaluate(() => (window as unknown as { __realm: { prerenderingAtFirstInline: boolean; activations: number } }).__realm);
  expect(marker).toEqual({ prerenderingAtFirstInline: true, activations: 1 });
  const active = await topFrame(sw, tabId);
  expect(active.documentId).toBe(prerender!.documentId);
  const after = await waitForReport(ui, tabId, (report) => report.documentKey.endsWith(':' + active.documentId) && techniqueCount(report, DET.pixelReadback) === 1);
  expect(after.documentKey).not.toBe(before!.documentKey);
  await evidence(page, 'prerender', { statuses, navigation: await navigationTrace(sw), before, documents, marker, after, verified: true });
});

test('P06: BFCache back and forward retain browser identities and traces', async ({ fixtures }) => {
  const ext = await launch({ backForwardCache: true });
  try {
    const sw = await getServiceWorker(ext.context);
    const ui = await openExtensionPage(ext.context, sw);
    await ensureObserved(sw, ui);
    await captureNavigation(sw);
    const { page, tabId } = await observed(ext, fixtures.origins[0] + '/bfcache-a.html');
    const before = await waitForReport(ui, tabId, (r) => techniqueCount(r, DET.pixelReadback) === 1);
    await page.click('#to-b');
    await page.waitForURL('**/bfcache-b.html');
    const b = await topFrame(sw, tabId);
    await page.goBack({ waitUntil: 'commit' });
    const restored = await page.evaluate(() => (window as unknown as { __fixtureResult: { pageshow: Array<{ persisted: boolean }> } }).__fixtureResult.pageshow);
    expect(restored.at(-1)?.persisted).toBe(true);
    const after = await waitForReport(ui, tabId, (r) => r.documentKey === before.documentKey && techniqueCount(r, DET.pixelReadback) >= 1);
    await page.goForward({ waitUntil: 'commit' });
    expect((await topFrame(sw, tabId)).documentId).toBe(b.documentId);
    const trace = await navigationTrace(sw);
    expect(trace.filter((e) => e.kind === 'committed' && e.path === '/bfcache-a.html').map((e) => e.documentId)).toEqual([before.documentKey.split(':')[2], before.documentKey.split(':')[2]]);
    await evidence(page, 'bfcache', { navigation: trace, before, after, restored });
  } finally { await ext.close(); }
});

test('P06: cancelled navigation has before/error but no commit', async ({ ext, fixtures }) => {
  const { sw, ui, page, tabId } = await observed(ext, fixtures.origins[0] + '/abort-nav.html');
  await captureNavigation(sw);
  const before = await waitForReport(ui, tabId, (r) => techniqueCount(r, DET.pixelReadback) === 1);
  const cdp = await ext.context.newCDPSession(page);
  await page.evaluate(() => (document.querySelector('#slow') as HTMLAnchorElement).click());
  await expect.poll(() => fixtures.stats.slowRequests).toBe(1);
  await cdp.send('Page.stopLoading');
  await expect.poll(() => fixtures.stats.slowAborted).toBe(1);
  await expect.poll(async () => (await navigationTrace(sw)).some((e) => e.path === '/slow' && e.kind === 'error')).toBe(true);
  const trace = await navigationTrace(sw);
  expect(trace.some((e) => e.path === '/slow' && e.kind === 'before')).toBe(true);
  expect(trace.some((e) => e.path === '/slow' && e.kind === 'committed')).toBe(false);
  expect((await getReport(ui, tabId))?.documentKey).toBe(before.documentKey);
  await evidence(page, 'aborted-navigation', { navigation: trace, before, after: await getReport(ui, tabId) });
});
