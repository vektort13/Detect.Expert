// ADR-020 §H (S13, E21-13 case 2): the GPC feature end to end. Ground truth is the fixture server: the only header it
// reads is sec-gpc (tests/fixture-routes/gpc.mjs). SP-1: after the optional DNR grant rule writes complete only after
// the extension is loaded again with the grant, so the «on» stands enable the module in Options and restart the browser
// with the same profile (launchFirewallStand of firewall-support.ts, features passed in).
// Cases: off → no rule, no gpc.main.js, no property, no header; on → the server sees Sec-GPC: 1 on the navigation, the
// cross-site frame, fetch (same-origin, cross-site, from a Worker), sendBeacon and an image; the page property is true,
// its getter is ours (not native) and Function.prototype.toString is untouched; the tab fact is `observed`; reading the
// property adds no DET-025 count of observation; the popup line; exclusion from the popup (header gone at once,
// property until reload, reloadNeeded), the way back in Options; a stopped service worker still sends the header;
// turning the feature off on an open page (header gone at once, property until reload).

import { expect, test, type Page, type Worker } from '@playwright/test';
import type { GpcTabFact } from '@detect-expert/contracts';
import { getServiceWorker, startFixtureServer, type FixtureServer } from '../harness';
import { brief, enableProtectViaOptions, fixtureResult, getReport, openExtensionPage, tabIdOf, techniqueCount } from '../helpers';
import { launchFirewallStand, report, type FirewallStand } from './firewall-support';
import { enableProtect, grantAllSites, launchProtect, ourDnrRules, protectListeners, protectRoute, registeredScripts, standUrl } from './support';

const HOST = 'www.example.com';
const OTHER_HOST = 'api.example.net';
const MAIN_ID = 'detector-protect-main-v1';

interface PropertyCheck {
  value: boolean | string;
  onPrototype: boolean;
  ownOnInstance: boolean;
  kind: string;
  getterName: string | null;
  getterNative: boolean | null;
  hasSetter: boolean | null;
  enumerable: boolean | null;
  configurable: boolean | null;
  toStringNative: boolean;
  toStringOwnOnPrototype: boolean;
}

interface StandResult {
  property: PropertyCheck;
  requests?: { fetchSame: { secGpc?: string | null }; fetchCross: { secGpc?: string | null }; image: { loaded?: boolean }; beacon: boolean; socket: { open?: boolean } };
  frame?: { value: boolean | string; getterName: string | null; fetch: string | null };
  aboutBlank?: Partial<PropertyCheck> & { error?: string };
  worker?: { value: boolean | string; fetch: string | null };
}

/** Counted requests of `<host:port><path>` per Sec-GPC state (the stand's stats.routes.gpc). */
function counts(server: FixtureServer, hostPath: string): { one: number; other: number; absent: number } {
  const bucket = server.stats.routes?.['gpc'] ?? {};
  return { one: bucket[hostPath + ' 1'] ?? 0, other: bucket[hostPath + ' other'] ?? 0, absent: bucket[hostPath + ' absent'] ?? 0 };
}

function port(server: FixtureServer, i: number): string {
  return new URL(server.origins[i]!).port;
}

function pageUrl(server: FixtureServer, query = ''): string {
  const other = standUrl(server.origins[1]!, OTHER_HOST, '');
  return standUrl(server.origins[0]!, HOST, '/protect/gpc/gpc-top.html') + '?other=' + encodeURIComponent(other) + query;
}

async function openStand(context: FirewallStand['context'], server: FixtureServer, sw: Worker, query = ''): Promise<{ page: Page; tabId: number; result: StandResult }> {
  const page = await context.newPage();
  await page.goto(pageUrl(server, query));
  const result = await fixtureResult<StandResult>(page, 25_000);
  const tabId = await tabIdOf(sw, page.url());
  return { page, tabId, result };
}

async function gpcStatus(sw: Worker): Promise<{ status: string; excludedSites: number }> {
  return sw.evaluate(() => (globalThis as unknown as { __protectHarness: { inject(n: string, p: unknown): Promise<{ status: string; excludedSites: number }> } }).__protectHarness.inject('gpc', { op: 'status' }));
}

async function gpcRule(sw: Worker): Promise<unknown> {
  return sw.evaluate(async () => (await chrome.declarativeNetRequest.getDynamicRules({ ruleIds: [1] }))[0] ?? null);
}

async function pageFetch(page: Page, label: string): Promise<string | null | undefined> {
  return page.evaluate(async (l) => ((await (window as unknown as { __gpcFetch(x: string): Promise<{ secGpc?: string | null }> }).__gpcFetch(l)).secGpc), label);
}

async function propertyNow(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const v = (navigator as unknown as { globalPrivacyControl?: unknown }).globalPrivacyControl;
    return v === undefined ? 'undefined' : v;
  });
}

async function gpcFact(stand: FirewallStand, tabId: number): Promise<GpcTabFact | null> {
  return (await report(stand, tabId)).gpc;
}

const EXPECTED_PROPERTY = {
  value: true, onPrototype: true, ownOnInstance: false, kind: 'accessor', getterName: 'detectExpertGpcGetter', getterNative: false, hasSetter: false,
  enumerable: true, configurable: true, toStringNative: true, toStringOwnOnPrototype: true,
};

test('GPC off: no rule, no gpc.main.js, no property, no header (module on without the feature)', async () => {
  test.setTimeout(120_000);
  const server = await startFixtureServer();
  const ext = await launchProtect();
  try {
    const sw = await getServiceWorker(ext.context);
    await grantAllSites(ext, sw);
    const on = await enableProtect(sw, ['value-match']);
    expect(on.state?.state, brief(on)).toBe('active');
    expect((await ourDnrRules(sw)).ids).toEqual([]);
    const main = await registeredScripts(sw, [MAIN_ID]);
    expect(main.flatMap((s) => s.js)).not.toContain('gpc.main.js');
    expect(await protectListeners(sw)).toMatchObject({ requestHeaders: false });
    const { result } = await openStand(ext.context, server, sw);
    expect(result.property).toMatchObject({ value: 'undefined', onPrototype: false });
    expect(result.requests?.fetchSame).toEqual({ secGpc: null });
    expect(result.requests?.fetchCross).toEqual({ secGpc: null });
    expect(counts(server, HOST + ':' + port(server, 0) + '/protect/gpc/gpc-top.html')).toMatchObject({ one: 0 });
    await expect.poll(() => counts(server, HOST + ':' + port(server, 0) + '/gpc-echo/beacon').absent).toBe(1);
    expect(counts(server, HOST + ':' + port(server, 0) + '/gpc-echo/beacon').one).toBe(0);
  } finally {
    await ext.close();
    await server.close();
  }
});

test('SP-1: right after the runtime grant the rule write hangs → rule error and the browser-restart hint in Options and the popup, no header', async () => {
  test.setTimeout(120_000);
  const server = await startFixtureServer();
  const ext = await launchProtect();
  try {
    const sw = await getServiceWorker(ext.context);
    await grantAllSites(ext, sw);
    const on = (await enableProtectViaOptions(ext.context, sw, ['value-match', 'gpc'])) as { state?: { state: string; degradedReasons: string[]; permissions: { dnr: boolean } } };
    expect(on.state, brief(on)).toMatchObject({ state: 'degraded', degradedReasons: ['blocking-unavailable'], permissions: { dnr: true } });
    expect(await gpcStatus(sw)).toMatchObject({ status: 'error' });
    const options = await openExtensionPage(ext.context, sw, 'options.html#protect');
    await expect(options.locator('[data-gpc-section="on"] [data-gpc-rule="error"]')).toBeVisible({ timeout: 15_000 });
    await expect(options.locator('[data-gpc-rule="error"] p')).toHaveCount(2);
    await options.close();
    const { tabId, result } = await openStand(ext.context, server, sw, '&requests=0');
    // The registration is in place (the property is set); the header rule is not (Chrome has not applied the write).
    expect(result.property.value).toBe(true);
    expect(counts(server, HOST + ':' + port(server, 0) + '/protect/gpc/gpc-top.html')).toMatchObject({ one: 0, absent: 1 });
    const popup = await openExtensionPage(ext.context, sw, 'popup.html?tabId=' + String(tabId));
    await expect(popup.locator('[data-gpc-site="off"]')).toBeVisible({ timeout: 15_000 });
    await expect(popup.locator('[data-gpc-rule-error]')).toHaveCount(2);
    await popup.close();
  } finally {
    await ext.close();
    await server.close();
  }
});

test('GPC on: Sec-GPC: 1 on navigation, frame, fetch, worker fetch, beacon and image; the property; the fact; DET-025 unchanged; the popup and Options', async () => {
  test.setTimeout(240_000);
  const stand = await launchFirewallStand(['value-match', 'gpc']);
  try {
    const sw = stand.sw;
    const server = stand.server;
    // The rule: one dynamic rule in our GPC range, read back as installed.
    expect((await ourDnrRules(sw)).ids).toEqual([1]);
    expect(await gpcStatus(sw)).toMatchObject({ status: 'installed', excludedSites: 0 });
    expect(await gpcRule(sw)).toMatchObject({ id: 1, priority: 100, action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Sec-GPC', operation: 'set', value: '1' }] } });
    expect((await gpcRule(sw)) as { condition: Record<string, unknown> }).toMatchObject({ condition: { resourceTypes: expect.arrayContaining(['main_frame', 'sub_frame', 'xmlhttprequest', 'ping', 'image', 'websocket']) } });
    // The registration: gpc.main.js first (after the test-profile tripwire).
    const main = (await registeredScripts(sw, [MAIN_ID]))[0]!;
    expect(main.js.filter((f) => f !== 'protect-tripwire.main.js')[0], brief(main.js)).toBe('gpc.main.js');
    expect(await protectListeners(sw)).toMatchObject({ sendHeaders: true, requestHeaders: true });

    const { page, tabId, result } = await openStand(stand.context, server, sw);
    expect(result.property, brief(result)).toEqual(EXPECTED_PROPERTY);
    expect(result.requests?.fetchSame).toEqual({ secGpc: '1' });
    expect(result.requests?.fetchCross).toEqual({ secGpc: '1' });
    expect(result.requests?.image).toEqual({ loaded: true });
    expect(result.requests?.beacon).toBe(true);
    expect(result.frame, brief(result.frame)).toMatchObject({ value: true, getterName: 'detectExpertGpcGetter', fetch: '1' });
    // SP-10: the worker's fetch carries the header; the property does not exist in workers (a coverage gap, said in the UI).
    expect(result.worker, brief(result.worker)).toMatchObject({ fetch: '1', value: 'undefined' });
    test.info().annotations.push({ type: 'about:blank frame (observed)', description: JSON.stringify(result.aboutBlank) });
    console.log('gpc: about:blank frame (observed) ' + JSON.stringify(result.aboutBlank));

    const p0 = HOST + ':' + port(server, 0);
    const p1 = OTHER_HOST + ':' + port(server, 1);
    expect(counts(server, p0 + '/protect/gpc/gpc-top.html'), 'navigation').toMatchObject({ one: 1, absent: 0, other: 0 });
    expect(counts(server, p1 + '/protect/gpc/gpc-frame.html'), 'cross-site frame').toMatchObject({ one: 1, absent: 0 });
    expect(counts(server, p0 + '/protect/gpc/gpc-worker.js'), 'worker script').toMatchObject({ one: 1, absent: 0 });
    expect(counts(server, p1 + '/gpc-echo/img-cross'), 'image').toMatchObject({ one: 1, absent: 0 });
    await expect.poll(() => counts(server, p0 + '/gpc-echo/beacon').one, { message: 'beacon' }).toBe(1);
    expect(counts(server, p0 + '/gpc-echo/beacon').absent).toBe(0);
    // SP-10 (ADR-020 §H): the WebSocket handshake gets no Sec-GPC (host permissions are http/https only) — a gap.
    const ws = counts(server, p0 + '/gpc-ws');
    test.info().annotations.push({ type: 'WebSocket handshake Sec-GPC (observed)', description: JSON.stringify({ ...ws, open: result.requests?.socket }) });
    console.log('gpc: WebSocket handshake (observed) ' + JSON.stringify({ ...ws, open: result.requests?.socket }));
    expect(ws.one + ws.absent + ws.other, 'the handshake reached the stand').toBe(1);
    expect(ws.one, 'SP-10 gap: no Sec-GPC on the WebSocket handshake').toBe(0);

    // The tab fact: Chrome's record of the outgoing requests.
    await expect.poll(async () => (await gpcFact(stand, tabId))?.requestsWithHeader ?? 0, { message: 'sub-requests with the header' }).toBeGreaterThanOrEqual(4);
    expect(await gpcFact(stand, tabId)).toMatchObject({
      site: 'example.com', siteState: 'on', navigationHeader: 'observed', requestsWithoutHeader: 0, countQuality: 'exact', propertyAtLoad: true, reloadNeeded: false,
      evidenceSource: 'browser-network', integrity: 'browser-observed',
    });

    // Coexistence with observation: reading the property is not a DET-025 operation; a userAgent read still is.
    const ui = await openExtensionPage(stand.context, sw, 'options.html');
    const det25 = async () => {
      const r = await getReport(ui, tabId);
      return r === null ? -1 : techniqueCount(r, 'DET-025');
    };
    await expect.poll(det25, { message: 'observation report of the stand page' }).toBeGreaterThanOrEqual(0);
    const before = await det25();
    await page.evaluate(() => {
      for (let i = 0; i < 50; i++) void (navigator as unknown as { globalPrivacyControl?: unknown }).globalPrivacyControl;
    });
    await page.waitForTimeout(1500);
    expect(await det25(), 'reading navigator.globalPrivacyControl adds no DET-025 count').toBe(before);
    await page.evaluate(() => void navigator.userAgent);
    await expect.poll(det25, { message: 'positive control: navigator.userAgent is counted' }).toBeGreaterThan(before);

    // Popup line and Options section.
    const popup = await openExtensionPage(stand.context, sw, 'popup.html?tabId=' + String(tabId));
    await expect(popup.locator('[data-gpc-site="on"]')).toBeVisible({ timeout: 15_000 });
    await expect(popup.locator('#popup-gpc-title')).toContainText('example.com');
    await expect(popup.locator('[data-gpc-exclude]')).toBeVisible();
    await popup.locator('[data-gpc-details] summary').click();
    await expect(popup.locator('[data-gpc-details] p')).toHaveCount(3);
    // Extension palette (ui.css tokens) in both themes: --surface-2 and the --accent edge of the «on» state.
    const look = () => popup.locator('[data-gpc-site]').evaluate((el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, edge: cs.borderInlineStartColor };
    });
    await popup.emulateMedia({ colorScheme: 'light' });
    expect(await look()).toEqual({ bg: 'rgb(243, 245, 247)', edge: 'rgb(36, 86, 179)' });
    await popup.emulateMedia({ colorScheme: 'dark' });
    expect(await look()).toEqual({ bg: 'rgb(29, 34, 40)', edge: 'rgb(141, 179, 255)' });
    await popup.close();
    const options = await openExtensionPage(stand.context, sw, 'options.html#protect');
    await expect(options.locator('[data-gpc-section="on"] [data-gpc-rule="written"]')).toBeVisible({ timeout: 15_000 });
    await expect(options.locator('[data-gpc-legal]')).toHaveCount(1);
    await options.close();
    await ui.close();
  } finally {
    await stand.close();
  }
});

test('GPC: exclusion from the popup (header at once, property until reload), Options brings it back, stopped SW, feature off on an open page', async () => {
  test.setTimeout(240_000);
  const stand = await launchFirewallStand(['value-match', 'gpc']);
  try {
    const server = stand.server;
    const p0 = HOST + ':' + port(server, 0);
    let sw = stand.sw;
    const { page, tabId, result } = await openStand(stand.context, server, sw, '&requests=0');
    expect(result.property.value).toBe(true);
    expect(await pageFetch(page, 'before')).toBe('1');

    // «Не отправлять на этом сайте» in the popup = ui-protect-set-site excluded:true.
    const popup = await openExtensionPage(stand.context, sw, 'popup.html?tabId=' + String(tabId));
    await expect(popup.locator('[data-gpc-site="on"]')).toBeVisible({ timeout: 15_000 });
    await popup.locator('[data-gpc-exclude]').click();
    await expect(popup.locator('[data-gpc-site="excluded"]')).toBeVisible({ timeout: 15_000 });
    await expect(popup.locator('[data-gpc-reload]')).toBeVisible();
    await expect(popup.locator('[data-gpc-exclude]')).toHaveCount(0);
    await popup.close();
    expect(await gpcRule(sw)).toMatchObject({ condition: { excludedInitiatorDomains: ['example.com'], excludedRequestDomains: ['example.com'] } });
    expect(await gpcStatus(sw)).toMatchObject({ status: 'installed', excludedSites: 1 });
    // The header follows at once; the property stays until the page reloads.
    expect(await pageFetch(page, 'after-exclude')).toBeNull();
    expect(await propertyNow(page)).toBe(true);
    expect(await gpcFact(stand, tabId)).toMatchObject({ siteState: 'excluded', propertyAtLoad: true, reloadNeeded: true });
    await page.reload();
    expect((await fixtureResult<StandResult>(page)).property).toMatchObject({ value: 'undefined', onPrototype: false });
    expect(counts(server, p0 + '/protect/gpc/gpc-top.html')).toMatchObject({ one: 1, absent: 1 });
    expect(await gpcFact(stand, tabId)).toMatchObject({ siteState: 'excluded', navigationHeader: 'not-applicable', propertyAtLoad: false, reloadNeeded: false });

    // Bringing the site back is an Options-only action (the harness route carries an Options sender).
    const back = await protectRoute(sw, { type: 'ui-protect-set-site', host: 'example.com', excluded: false });
    expect(back.state?.excludedSites, brief(back)).toEqual([]);
    expect(((await gpcRule(sw)) as { condition: Record<string, unknown> }).condition['excludedRequestDomains']).toBeUndefined();
    expect(await pageFetch(page, 'after-include')).toBe('1');
    await page.reload();
    expect((await fixtureResult<StandResult>(page)).property.value).toBe(true);
    // The fact of this load is in storage.session before the worker stops (it outlives the worker).
    const key = 'protect-doc:' + (await report(stand, tabId)).documentKey;
    await expect.poll(() => sw.evaluate(async (k) => {
      const doc = (await chrome.storage.session.get(k))[k] as { gpc?: { propertyAtLoad?: boolean; navigationHeader?: string } } | undefined;
      return doc?.gpc?.navigationHeader === 'observed' && doc.gpc.propertyAtLoad === true;
    }, key), { message: 'stored GPC fact of the reloaded page' }).toBe(true);

    // A stopped service worker: the dynamic rule still adds the header.
    const cdpPage = await stand.context.newPage();
    await cdpPage.goto(server.origins[0]! + '/protect/index.html');
    const cdp = await stand.context.newCDPSession(cdpPage);
    let versionId = '';
    cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
      for (const v of versions) if (v.scriptURL === sw.url() && v.runningStatus === 'running') versionId = v.versionId;
    });
    await cdp.send('ServiceWorker.enable');
    await expect.poll(() => versionId).not.toBe('');
    await cdp.send('ServiceWorker.stopWorker', { versionId });
    expect(await pageFetch(page, 'sw-stopped'), 'Sec-GPC while the service worker is stopped').toBe('1');
    await cdp.detach();
    await cdpPage.close();
    await stand.refreshWorker();
    sw = stand.sw;

    // Feature off on the open page: the rule goes now, the property stays until a reload, the fact says so.
    const off = await protectRoute(sw, { type: 'ui-protect-set-settings', features: ['value-match'] });
    expect(off.state?.features, brief(off)).toEqual(['value-match']);
    expect((await ourDnrRules(sw)).ids).toEqual([]);
    expect(await pageFetch(page, 'feature-off')).toBeNull();
    expect(await propertyNow(page)).toBe(true);
    expect(await gpcFact(stand, tabId)).toMatchObject({ siteState: 'off', propertyAtLoad: true, reloadNeeded: true });
    const popup2 = await openExtensionPage(stand.context, sw, 'popup.html?tabId=' + String(tabId));
    await expect(popup2.locator('[data-gpc-reload]')).toBeVisible({ timeout: 15_000 });
    await expect(popup2.locator('[data-gpc-exclude]')).toHaveCount(0);
    await popup2.close();
    expect((await registeredScripts(sw, [MAIN_ID])).flatMap((s) => s.js)).not.toContain('gpc.main.js');
    await page.reload();
    expect((await fixtureResult<StandResult>(page)).property.value).toBe('undefined');
  } finally {
    await stand.close();
  }
});
