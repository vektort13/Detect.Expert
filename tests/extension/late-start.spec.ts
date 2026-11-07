// Late start (ADR-003 activeTab mode, REQ-006): the fixture reads back at parse time in <head>. In the test
// profile the stand is injected at document_start from startup, so "no early injection" is produced by
// unregistering the stand scripts through the SW before the page loads. Then the "check from now on" path is
// driven with the background's `ui-inject-now` (scripting.executeScript into the tab; the static host grant
// stands in for the activeTab grant, which needs a toolbar gesture Playwright cannot perform). Expected:
// coverage says late-start, the early calls are NOT counted (honest gap), later calls are.

import { expect, getServiceWorker, test } from './harness';
import { DET, STAND_SCRIPT_IDS, assertAccepted, brief, fixtureResult, getReport, getScope, injectNow, openExtensionPage, registeredScripts, setScope, tabIdOf, techniqueCount, unregisterStandScripts, waitForReport } from './helpers';

interface LateStartResult {
  earlyReadbacks: number;
  earlyAtMs: number;
}

test('late injection reports late-start and does not count the early readbacks', async ({ ext, fixtures }) => {
  const sw = await getServiceWorker(ext.context);
  const ui = await openExtensionPage(ext.context, sw);
  // Wait for the startup registration, then remove it so the page loads without sensors.
  await expect.poll(async () => (await registeredScripts(sw)).map((s) => s.id).sort(), { timeout: 5000 }).toEqual([...STAND_SCRIPT_IDS].sort());
  const removed = await unregisterStandScripts(sw);
  expect(removed.sort()).toEqual([...STAND_SCRIPT_IDS].sort());
  expect(await registeredScripts(sw)).toEqual([]);

  const url = fixtures.origins[0] + '/late-start.html';
  const page = await ext.context.newPage();
  await page.goto(url);
  const result = await fixtureResult<LateStartResult>(page);
  expect(result.earlyReadbacks).toBe(2);
  const tabId = await tabIdOf(sw, url);

  // Not injected: the early readbacks are invisible; "not observed" must stay explicit (REQ-006).
  await page.waitForTimeout(800);
  const before = await getReport(ui, tabId);
  if (before !== null) {
    expect(before.techniques, 'nothing observed before injection: ' + brief(before)).toEqual([]);
    // F162 / REQ-006: partial must not disguise a document with no injected sensor.
    // Soft assertion still fails the test while preserving the post-injection regression checks below.
    expect.soft(['no-access', 'unsupported'], 'explicit pre-injection coverage: ' + brief(before)).toContain(before.coverageState);
  }
  test.info().annotations.push({ type: 'before-injection', description: before === null ? 'no report' : 'report without observations, coverageState=' + before.coverageState });

  const injected = await injectNow(ui, tabId);
  expect(injected.type, 'ui-inject-now must succeed on the stand: ' + brief(injected)).toBe('ok');

  const report = await waitForReport(ui, tabId, (r) => r.coverageState === 'late-start' || r.coverageFlags.includes('late-start'), { describe: 'late-start coverage after ui-inject-now' });
  expect(techniqueCount(report, DET.pixelReadback), 'early readbacks happened before injection and must not be counted').toBe(0);

  const more = await page.evaluate(() => (window as unknown as { __readbackAgain: (n: number) => number }).__readbackAgain(2));
  expect(more).toBe(2);
  const later = await waitForReport(ui, tabId, (r) => techniqueCount(r, DET.pixelReadback) >= 2, { describe: 'readbacks after injection are counted' });
  expect(techniqueCount(later, DET.pixelReadback)).toBe(2);
  expect(later.coverageState === 'late-start' || later.coverageFlags.includes('late-start')).toBe(true);
  expect(later.documentKey).toBe(report.documentKey);

  // F083/ADR-003: retained static host access cannot extend the app's active-tab grant to a replacement.
  await page.goto(url + '?replacement=1');
  await fixtureResult(page);
  const replacement = await waitForReport(ui, tabId, (r) => r.documentKey !== later.documentKey && r.coverageState === 'no-access');
  expect(replacement.techniques).toEqual([]);
  expect(replacement.coverageFlags).not.toContain('late-start');
  expect(replacement.host).toBeNull();
});

// F162 / ADR-003: real scope-off/no-grant navigation is distinct from unregistering scripts
// on the statically permitted 127.0.0.1 stand in the late-injection scenario above.
test('scope off without a host grant explicitly reports no access', async ({ ext, fixtures }) => {
  const sw = await getServiceWorker(ext.context);
  const ui = await openExtensionPage(ext.context, sw);
  assertAccepted(await setScope(ui, 'off'), 'scope off');
  expect((await getScope(ui)).scopeMode).toBe('off');
  expect(await sw.evaluate(() => chrome.permissions.contains({ origins: ['http://localhost/*'] }))).toBe(false);
  const url = fixtures.origins[0]?.replace('127.0.0.1', 'localhost') + '/late-start.html';
  const existingIds = await sw.evaluate(async () => (await chrome.tabs.query({})).map((tab) => tab.id));
  const page = await ext.context.newPage();
  await page.goto(url);
  expect((await fixtureResult<LateStartResult>(page)).earlyReadbacks).toBe(2);
  // With no grant and no tabs permission, Chrome hides Tab.url; resolve by trusted IDs instead.
  const newIds = await sw.evaluate(async (ids) => (await chrome.tabs.query({})).filter((tab) => !ids.includes(tab.id)).map((tab) => tab.id), existingIds);
  expect(newIds).toHaveLength(1);
  const tabId = newIds[0];
  if (tabId === undefined) throw new Error('Missing trusted ungranted tab id');
  const report = await waitForReport(ui, tabId, (r) => r.coverageState === 'no-access', { describe: 'scope off and no grant: no-access' });
  expect(report.techniques).toEqual([]);
  expect(report.observedSince).toBeNull();
  expect(report.coverageFlags).toContain('no-host-permission');
  const stored = await sw.evaluate(async () => ({ session: await chrome.storage.session.get(null), local: await chrome.storage.local.get(null) }));
  expect(JSON.stringify(stored)).not.toContain('localhost');
  expect(JSON.stringify(stored)).not.toContain('late-start.html');
});

// F129/F168: a frozen descriptor before manual installation stays untouched; diagnostics need no observations.
test('late installation on a frozen canvas method preserves the original and reports failure', async ({ ext, fixtures }) => {
  const sw = await getServiceWorker(ext.context);
  const ui = await openExtensionPage(ext.context, sw);
  await expect.poll(async () => (await registeredScripts(sw)).length).toBe(2);
  await unregisterStandScripts(sw);
  const page = await ext.context.newPage();
  await page.addInitScript(() => {
    const proto = CanvasRenderingContext2D.prototype;
    const original = proto.getImageData;
    Object.defineProperty(proto, 'getImageData', { ...Object.getOwnPropertyDescriptor(proto, 'getImageData'), configurable: false, writable: false });
    (window as unknown as { __originalReadback: unknown }).__originalReadback = original;
  });
  const url = fixtures.origins[0] + '/late-start.html';
  await page.goto(url);
  await fixtureResult(page);
  const tabId = await tabIdOf(sw, url);
  expect((await injectNow(ui, tabId)).type).toBe('ok');
  const report = await waitForReport(ui, tabId, (r) => r.coverageFlags.includes('hook-failed'));
  expect(report.techniques).toEqual([]);
  expect(await page.evaluate(() => CanvasRenderingContext2D.prototype.getImageData === (window as unknown as { __originalReadback: unknown }).__originalReadback)).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __readbackAgain: (n: number) => number }).__readbackAgain(2))).toBe(2);
  await page.waitForTimeout(1000);
  expect(techniqueCount((await getReport(ui, tabId))!, DET.pixelReadback)).toBe(0);
});
