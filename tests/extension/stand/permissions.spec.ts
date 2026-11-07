// P06 / E02-01 #1,2,7: real host grants and toolbar action; Chrome host patterns ignore ports.
import { test as base, expect, evidence, captureVendorRequests, vendorRequests } from './harness';
import { launch, getServiceWorker, extensionIdOf } from '../harness';
import { grant, openTab } from '../permissions/support';
import { DET, getReport, registeredScripts, techniqueCount, waitForReport } from '../helpers';

const test = base.extend({
  ext: async ({}, use) => {
    const session = await launch({ profile: 'test-optional', extensionActionDebugging: true });
    try { await use(session); } finally { await session.close(); }
  },
});

for (const mode of ['site', 'all-sites'] as const) {
  test('P06: optional ' + mode + ' registration precedes first inline', async ({ ext, fixtures }) => {
    const sw = await getServiceWorker(ext.context);
    await grant(ext, sw, mode);
    const scripts = await sw.evaluate(() => chrome.scripting.getRegisteredContentScripts());
    expect(scripts.map((s) => s.id).sort()).toEqual(['detector-isolated-v1', 'detector-main-v1']);
    expect(scripts.every((s) => s.runAt === 'document_start' && s.allFrames && s.matchOriginAsFallback)).toBe(true);
    const { page, ui, tabId } = await openTab(ext, sw, fixtures.origins[0] + '/order-marker.html');
    const wrapped = await page.evaluate(() => (window as unknown as { __realm: { wrappedAtFirstInline: boolean } }).__realm.wrappedAtFirstInline);
    expect(wrapped).toBe(true);
    const report = await waitForReport(ui, tabId, (r) => r.coverageState === 'active' && techniqueCount(r, DET.canvasExport) === 1);
    expect(report.coverageFlags).not.toContain('late-start');
    await evidence(page, 'P06-order-' + mode, { scripts, wrapped, report });
  });
}

test('P06: actual activeTab is late and expires on cross-origin navigation in the same tab', async ({ ext, fixtures }) => {
  const sw = await getServiceWorker(ext.context);
  const { page, ui, tabId } = await openTab(ext, sw, fixtures.origins[0] + '/order-marker.html');
  const wrapped = await page.evaluate(() => (window as unknown as { __realm: { wrappedAtFirstInline: boolean } }).__realm.wrappedAtFirstInline);
  expect(wrapped).toBe(false);
  const cdp = await ext.context.browser()!.newBrowserCDPSession();
  const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
  const target = targetInfos.find((t) => t.url === page.url());
  expect(target).toBeDefined();
  await page.bringToFront();
  await cdp.send('Extensions.triggerAction', { id: extensionIdOf(sw), targetId: target!.targetId });
  await ui.reload();
  await ui.locator('#popup-scope-active-tab').check();
  await ui.locator('form.scope button[type=submit]').click();
  await expect.poll(() => page.evaluate(() => !Function.prototype.toString.call(HTMLCanvasElement.prototype.toDataURL).includes('[native code]'))).toBe(true);
  await page.evaluate(() => (window as unknown as { __realm: { read(): void } }).__realm.read());
  const before = await waitForReport(ui, tabId, (r) => r.coverageState === 'late-start' && techniqueCount(r, DET.canvasExport) === 1);
  expect(before.coverageFlags).toContain('late-start');
  expect((await sw.evaluate(() => chrome.permissions.getAll())).origins).toEqual([]);
  expect(await registeredScripts(sw)).toEqual([]);
  await page.goto(fixtures.origins[1]!.replace('127.0.0.1', 'localhost') + '/order-marker.html');
  expect(await page.evaluate(() => (window as unknown as { __realm: { wrappedAtFirstInline: boolean } }).__realm.wrappedAtFirstInline)).toBe(false);
  const after = await waitForReport(ui, tabId, (r) => r.coverageState === 'no-access' && r.documentKey !== before.documentKey);
  expect(after.techniques).toEqual([]);
  // Browser itself rejects execution on the new host; app scope is not the only denial evidence.
  const browserDenied = await sw.evaluate(async (id) => {
    try { await chrome.scripting.executeScript({ target: { tabId: id }, func: () => true }); return false; }
    catch { return true; }
  }, tabId);
  expect(browserDenied).toBe(true);
  expect((await getReport(ui, tabId))?.techniques).toEqual([]);
  await evidence(page, 'P06-active-tab-cross-origin', { wrapped, before, after, browserDenied, optionalOrigins: [] });
});

for (const targetGranted of [true, false]) {
  test('P06: no initiator grant hides vendor webRequest; target grant ' + targetGranted, async ({ ext, fixtures }) => {
    const sw = await getServiceWorker(ext.context);
    if (targetGranted) await grant(ext, sw, 'site');
    await captureVendorRequests(sw);
    const url = fixtures.origins[0]!.replace('127.0.0.1', 'localhost') + '/third-party-script.html' + (targetGranted ? '' : '?host=localhost');
    const { page, ui, tabId } = await openTab(ext, sw, url);
    await page.waitForFunction(() => (window as unknown as { __realmVendor?: { completed: boolean } }).__realmVendor?.completed === true);
    expect(await sw.evaluate(() => chrome.permissions.contains({ origins: ['http://localhost/*'] }))).toBe(false);
    expect(await sw.evaluate(() => chrome.permissions.contains({ origins: ['http://127.0.0.1/*'] }))).toBe(targetGranted);
    await page.waitForTimeout(700);
    const requests = await vendorRequests(sw);
    expect(requests).toEqual([]);
    const report = await waitForReport(ui, tabId, (r) => r.coverageState === 'no-access');
    expect(report.techniques).toEqual([]);
    await evidence(page, 'P06-no-initiator-target-' + targetGranted, { targetGranted, initiatorGranted: false, requests, report });
  });
}
