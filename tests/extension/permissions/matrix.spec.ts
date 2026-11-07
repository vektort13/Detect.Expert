// P05 / ADR-003 / REQ-013: serial matrix with real optional grants and actual permissions.remove.
import { test as base, expect, launch, launchPlain, getServiceWorker, extensionIdOf } from '../harness';
import { DET, assertAccepted, getReport, getScope, openExtensionPage, registeredScripts, setScope, techniqueCount, waitForReport } from '../helpers';
import { ALL, SITE, applyOptions, descriptors, expectStopped, grant, openTab, readbacks, reconcile, rejectedBatch, watchStops } from './support';

const test = base.extend({
  ext: async ({}, use) => {
    const session = await launch({ profile: 'test-optional', extensionActionDebugging: true, hostResolverRules: 'MAP neighbour.test 127.0.0.1' });
    try { await use(session); } finally { await session.close(); }
  },
});

test('01 no-access: no grants, no injection, no accepted page traffic', async ({ ext, fixtures }) => {
  const sw = await getServiceWorker(ext.context);
  const { page, ui, tabId } = await openTab(ext, sw, fixtures.origins[0] + '/reinstall.html');
  expect((await sw.evaluate(() => chrome.permissions.getAll())).origins).toEqual([]);
  expect(await registeredScripts(sw)).toEqual([]);
  expect(await reconcile(sw, SITE)).toBe(false);
  expect(await registeredScripts(sw)).toEqual([]);
  const plain = await launchPlain();
  try {
    const baseline = await plain.context.newPage();
    await baseline.goto(fixtures.origins[0] + '/reinstall.html');
    expect(await page.evaluate(descriptors)).toEqual(await baseline.evaluate(descriptors));
  } finally { await plain.close(); }
  await readbacks(page);
  await page.evaluate(() => window.postMessage({ channel: 'detect.expert/v1', type: 'sensor-batch', sensorBootId: 'p05-forged-boot', sensorSeq: 1,
    observations: [{ techniqueId: 'DET-002', count: 17, countQuality: 'exact', phase: 'returned-sync', signalCodes: ['api-use'], intervalBucket: 0 }], coverageDelta: [] }, '*'));
  const report = await waitForReport(ui, tabId, (r) => r.coverageState === 'no-access');
  expect(report.techniques).toEqual([]);
  await expect(ui.locator('#coverage')).toContainText('No access');
});

test('02 first-time Options permission prompt', async ({ ext }) => {
  const sw = await getServiceWorker(ext.context);
  const accessibility = await ext.context.newPage();
  await accessibility.goto('chrome://accessibility');
  const ui = await openExtensionPage(ext.context, sw, 'options.html');
  // Observe the native API without changing its arguments, result, Promise or user activation.
  await ui.evaluate(() => {
    const state = { called: false, gesture: false, settled: false, error: '' };
    Object.assign(window, { __p05Request: state });
    const request = chrome.permissions.request.bind(chrome.permissions);
    chrome.permissions.request = ((permissions: chrome.permissions.Permissions) => {
      state.called = true;
      state.gesture = navigator.userActivation.isActive;
      const promise = request(permissions);
      void promise.then(() => { state.settled = true; }, (error: Error) => { state.settled = true; state.error = error.message; });
      return promise;
    }) as typeof chrome.permissions.request;
  });
  await applyOptions(ui, 'site');
  await expect.poll(() => ui.evaluate(() => (window as unknown as { __p05Request: { called: boolean } }).__p05Request.called)).toBe(true);
  await ui.waitForTimeout(2000);
  const state = await ui.evaluate(() => (window as unknown as { __p05Request: { gesture: boolean; settled: boolean; error: string } }).__p05Request);
  expect(state.gesture).toBe(true);
  expect(state.error).toBe('');
  if (!state.settled) {
    // Independent browser-native evidence: a pending Promise alone cannot justify a platform skip.
    await accessibility.bringToFront();
    await accessibility.locator('[id^="browser_"][id$="-showOrRefreshTree"]').click();
    const tree = accessibility.locator('[id^="browser_"][id$="-tree"]');
    await expect(tree).toContainText('ExtensionInstallDialogView');
    await expect(tree).toContainText('ExtensionPermissionsView');
    await expect(tree).toContainText('has requested additional permissions');
    await expect(tree).toContainText('Read and change your data on 127.0.0.1');
    await test.info().attach('native-permission-prompt', { body: await tree.innerText(), contentType: 'text/plain' });
  }
  // Chromium 153 keeps permissions.request pending in its native PERMISSIONS_PROMPT, outside DOM/CDP dialogs.
  // Headless Playwright cannot accept that widget. Cases 04–08 use settings approval, a real Options click,
  // permissions.contains and the test-only reconciliation hook, never fake grants.
  test.fixme(!state.settled, 'Chromium native PERMISSIONS_PROMPT remains pending after an activated Options click; no Playwright page dialog can accept it. Real-grant settings fallback covers remaining cases.');
  expect((await getScope(ui)).scopeMode).toBe('site');
  expect(await sw.evaluate((origins) => chrome.permissions.contains({ origins }), SITE)).toBe(true);
});

test('03 active-tab: toolbar action, late-start, only the current document', async ({ ext, fixtures }) => {
  const sw = await getServiceWorker(ext.context);
  const { page, ui, tabId } = await openTab(ext, sw, fixtures.origins[0] + '/reinstall.html');
  const browserCdp = await ext.context.browser()!.newBrowserCDPSession();
  const { targetInfos } = await browserCdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
  const tabTarget = targetInfos.find((target) => target.url === page.url());
  expect(tabTarget).toBeDefined();
  await page.bringToFront();
  await browserCdp.send('Extensions.triggerAction', { id: extensionIdOf(sw), targetId: tabTarget!.targetId });
  await ui.reload();
  // Record the actual privileged response: a DOM click starts asynchronous
  // injection and is not evidence that hooks are ready for the first stimulus.
  await ui.evaluate(() => {
    const send = chrome.runtime.sendMessage;
    const root = window as unknown as { __activeTabInjectionAck: unknown };
    root.__activeTabInjectionAck = null;
    chrome.runtime.sendMessage = function(...args: unknown[]) {
      const result = Reflect.apply(send, chrome.runtime, args);
      if ((args[0] as { type?: string })?.type === 'ui-inject-now') void Promise.resolve(result).then(response => { root.__activeTabInjectionAck = response; });
      return result;
    } as typeof send;
  });
  await ui.locator('#popup-scope-active-tab').check();
  await ui.locator('form.scope button[type=submit]').click();
  await expect.poll(() => ui.evaluate(() => (window as unknown as { __activeTabInjectionAck: unknown }).__activeTabInjectionAck), { message: 'the actual activeTab injection request was acknowledged' }).toMatchObject({ schemaVersion: 1, type: 'ok' });
  await expect.poll(() => page.evaluate(() => !Function.prototype.toString.call(CanvasRenderingContext2D.prototype.getImageData).includes('[native code]')), { message: 'the readback hook is installed before generating readbacks' }).toBe(true);
  await waitForReport(ui, tabId, report => report.coverageState === 'late-start');
  await readbacks(page);
  await waitForReport(ui, tabId, (r) => r.coverageState === 'late-start' && techniqueCount(r, DET.pixelReadback) >= 3);
  expect((await sw.evaluate(() => chrome.permissions.getAll())).origins).toEqual([]);
  expect(await registeredScripts(sw)).toEqual([]);
  const other = await openTab(ext, sw, fixtures.origins[0] + '/reinstall.html?other');
  expect((await getReport(other.ui, other.tabId))?.coverageState).toBe('no-access');
  await page.reload();
  await readbacks(page);
  const after = await waitForReport(ui, tabId, (r) => r.coverageState === 'no-access');
  expect(after.techniques).toEqual([]);
});

test('04 site: early calls next load; neighbour hostname has no access', async ({ ext, fixtures }) => {
  const sw = await getServiceWorker(ext.context);
  await grant(ext, sw, 'site');
  const { ui, tabId } = await openTab(ext, sw, fixtures.origins[0] + '/reinstall.html');
  await waitForReport(ui, tabId, (r) => r.coverageState === 'active' && techniqueCount(r, DET.text) > 0);
  const neighbour = await openTab(ext, sw, fixtures.origins[0]!.replace('127.0.0.1', 'neighbour.test') + '/reinstall.html');
  await readbacks(neighbour.page);
  const denied = await waitForReport(neighbour.ui, neighbour.tabId, (r) => r.coverageState === 'no-access');
  expect(denied.techniques).toEqual([]);
  expect(await sw.evaluate(() => chrome.permissions.contains({ origins: ['http://neighbour.test/*'] }))).toBe(false);
  await expect(neighbour.ui.locator('#coverage')).toContainText('No access');
});

test('05 all-sites: both fixture hostnames observe document_start calls', async ({ ext, fixtures }) => {
  const sw = await getServiceWorker(ext.context);
  await grant(ext, sw, 'all-sites');
  for (const host of ['127.0.0.1', 'neighbour.test']) {
    const { ui, tabId } = await openTab(ext, sw, fixtures.origins[0]!.replace('127.0.0.1', host) + '/reinstall.html');
    await waitForReport(ui, tabId, (r) => r.coverageState === 'active' && techniqueCount(r, DET.text) > 0);
  }
});

for (const foreign of [false, true]) {
  test((foreign ? '07' : '06') + ' real revoke: stop, purge, reload descriptors' + (foreign ? ', preserve foreign wrapper' : ''), async ({ ext, fixtures }) => {
    const sw = await getServiceWorker(ext.context);
    await grant(ext, sw, 'site');
    const { page, ui, tabId } = await openTab(ext, sw, fixtures.origins[0] + '/reinstall.html');
    await readbacks(page);
    await waitForReport(ui, tabId, (r) => techniqueCount(r, DET.pixelReadback) >= 3);
    await watchStops(page);
    if (foreign) await page.evaluate(() => {
      const original = HTMLCanvasElement.prototype.toDataURL;
      function foreignToDataURL(this: HTMLCanvasElement, ...args: Parameters<typeof original>) { return Reflect.apply(original, this, args); }
      HTMLCanvasElement.prototype.toDataURL = foreignToDataURL;
      Object.assign(window, { __p05Foreign: foreignToDataURL });
    });
    expect(await sw.evaluate((origins) => chrome.permissions.remove({ origins }), SITE)).toBe(true);
    expect(await sw.evaluate((origins) => chrome.permissions.contains({ origins }), SITE)).toBe(false);
    await expect.poll(() => registeredScripts(sw)).toEqual([]);
    await expectStopped(page);
    const after = await waitForReport(ui, tabId, (r) => r.coverageState === 'no-access' && r.coverageFlags.includes('revoked'));
    expect(after.techniques).toEqual([]);
    expect(after.host).toBeNull();
    expect(after.observedSince).toBeNull();
    await expect.poll(() => sw.evaluate(async (key) => {
      const value = (await chrome.storage.session.get('doc:' + key))['doc:' + key];
      return (value as { report?: unknown } | undefined)?.report;
    }, after.documentKey)).toMatchObject({ host: null, counters: [], findings: [], hosts: [] });
    await expect(ui.locator('#coverage')).toContainText('No access');
    await expect(ui.locator('#coverage')).toContainText(/reload/i);
    if (foreign) expect(await page.evaluate(() => HTMLCanvasElement.prototype.toDataURL === (window as unknown as { __p05Foreign: unknown }).__p05Foreign)).toBe(true);
    await readbacks(page);
    await page.waitForTimeout(1000);
    expect((await getReport(ui, tabId))?.techniques).toEqual([]);
    const plain = await launchPlain();
    try {
      const baseline = await plain.context.newPage();
      await baseline.goto(fixtures.origins[0] + '/reinstall.html');
      const clean = await baseline.evaluate(descriptors);
      if (!foreign) expect(await page.evaluate(descriptors)).toEqual(clean);
      await page.reload();
      expect(await page.evaluate(descriptors)).toEqual(clean);
      expect(await registeredScripts(sw)).toEqual([]);
    } finally { await plain.close(); }
  });
}

test('08 scope narrowing rejects stale isolated batches while all-sites grant remains', async ({ ext, fixtures }) => {
  const sw = await getServiceWorker(ext.context);
  await grant(ext, sw, 'all-sites');
  const first = await openTab(ext, sw, fixtures.origins[0] + '/reinstall.html');
  const sameHost = await openTab(ext, sw, fixtures.origins[0] + '/reinstall.html?second');
  const neighbour = await openTab(ext, sw, fixtures.origins[0]!.replace('127.0.0.1', 'neighbour.test') + '/reinstall.html');
  for (const tab of [first, sameHost, neighbour]) {
    await readbacks(tab.page);
    await waitForReport(tab.ui, tab.tabId, (r) => techniqueCount(r, DET.pixelReadback) >= 3);
    await watchStops(tab.page);
  }
  assertAccepted(await setScope(first.ui, 'site'), 'all-sites -> site');
  await rejectedBatch(sw, neighbour.tabId);
  await expectStopped(neighbour.page);
  await readbacks(first.page);
  await waitForReport(first.ui, first.tabId, (r) => techniqueCount(r, DET.pixelReadback) >= 6);
  // App scope under retained host permission; case 03 tests actual Chrome activeTab.
  await first.ui.locator('details:has(form.scope) > summary').click();
  await first.ui.locator('#popup-scope-active-tab').check();
  await first.ui.locator('form.scope button[type=submit]').click();
  await expect.poll(() => getScope(first.ui)).toMatchObject({ scopeMode: 'active-tab' });
  await rejectedBatch(sw, sameHost.tabId);
  await expectStopped(sameHost.page);
  assertAccepted(await setScope(first.ui, 'off'), 'active-tab -> off');
  await rejectedBatch(sw, first.tabId);
  await expectStopped(first.page);
  expect(await sw.evaluate((origins) => chrome.permissions.contains({ origins }), ALL)).toBe(true);
  expect(await registeredScripts(sw)).toEqual([]);
  for (const tab of [first, sameHost, neighbour]) {
    const report = await getReport(tab.ui, tab.tabId);
    expect(report?.coverageState).toBe('no-access');
    expect(report?.techniques).toEqual([]);
  }
});
