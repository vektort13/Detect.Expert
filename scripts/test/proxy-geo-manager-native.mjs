// ADR-109: the Proxy Manager Geolocation API in the real manager, in a disposable Chromium profile (the complete stack: real controller,
// client and providers) or Firefox (the part that needs no interception). Provider hosts are intercepted by the browser driver; nothing leaves the machine.
//   node scripts/test/proxy-geo-manager-native.mjs [--firefox] [--from-source]   (the package is always assembled from apps/production-extension)
// Covered: the notice (invitation, reminder, dismissal, the link), NO provider request on open, the lookup after a completed manual check
// (once per distinct public address; private and reserved addresses never leave the page), the five columns (live on/off, canonical order,
// column menu groups that persist), cells that show provider data as text only (a hostile answer), the error / stale / pending states, the
// lookup button, "look up all" with its confirmation, the details panel, layouts at 1920/1180/580/340 px in light, dark and RTL without
// horizontal overflow, AA contrast of the new parts in all seven themes, keyboard use, and that no key reaches the page, a log or an export.
// Not covered, and said so: screen readers (only roles, names and states are checked), providers' real answers (no keys here), Firefox lookups.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stageExtension } from './native-evidence.mjs';
import { launchOwnedManagement, until, pause } from './management-browser-fixture.mjs';
import { PROXY_WORKSPACE_MESSAGES } from '../production-locales-proxy.mjs';

const root = resolve(import.meta.dirname, '../..'), browser = process.argv.includes('--firefox') ? 'firefox' : 'chrome', chrome = browser === 'chrome';
mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/proxy-geo-manager-' + browser + '-')), frozen = join(run, 'frozen'), shots = join(run, 'screenshots');
mkdirSync(shots, { recursive: true });
await stageExtension({ browser, target: frozen, from: 'source' });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const evidence = { at: new Date().toISOString(), browser, run, extensionSource: 'source', result: 'RUNNING', disposableProfile: true, externalConnectionAttempted: false, checks: [], layouts: [], screenshots: [], contrast: [], notes: [], requests: [] };
const check = text => { evidence.checks.push(text); console.log('  ok ' + text); };
let opened, phase = 'startup';

// ---- Data -------------------------------------------------------------------------------------------------------------------------------
const GEO_COLUMNS = ['geo', 'geonet', 'geokind', 'geoflags', 'geotime'], BASE_HEADS = ['select', 'name', 'type', 'address', 'country', 'check', 'ip', 'checked', 'actions'];
const PROFILES = [['p-001', 'Frankfurt office', 'socks5', 'DE'], ['p-002', 'Sydney edge', 'http', 'AU'], ['p-003', 'Amsterdam fast', 'https', 'NL'], ['p-004', 'US pool', 'socks5', 'US'], ['p-005', 'Private LAN', 'http', null], ['p-006', 'Not checked yet', 'https', null]]
  .map(([id, name, type, country], index) => ({ id, name, type, host: '203.0.113.' + (10 + index), port: 1080 + index, native: false, ...(country ? { country } : {}) }));
const EXITS = { 'p-001': '8.8.8.8', 'p-002': '1.1.1.1', 'p-003': '9.9.9.9', 'p-004': '8.8.8.8', 'p-005': '10.0.0.7' };
const PUBLIC_EXITS = ['8.8.8.8', '1.1.1.1', '9.9.9.9'];
const CANARY_ACCOUNT = '4815162', CANARY_KEY = 'CANARY_LICENSE_KEY_a1b2c3d4e5f6';
const KEY_PATTERN = new RegExp(CANARY_KEY + '|' + CANARY_ACCOUNT + '|' + Buffer.from(CANARY_ACCOUNT + ':' + CANARY_KEY).toString('base64'));
const configurationOf = profiles => ({ format: 'detect.expert.proxy', version: 1, revision: 5, enabled: false, selectedId: profiles[0].id, profiles, routing: { mode: 'all', proxyDomains: [], directDomains: [], bypassLocal: true }, protectWebRTC: true, disablePrediction: true, killSwitch: true, autoConnect: false });
const historyOf = () => {
  const now = Date.now(), items = {};
  Object.entries(EXITS).forEach(([id, ip], index) => { const at = now - (index + 2) * 60000; items[id] = [{ firstAt: at, lastAt: at, checks: 1, ok: true, code: '', ms: 90 + index * 20, dns: 'ok', tls: 'ok', status: 200, ip }]; });
  return { version: 1, enabled: true, items };
};
const settingsOf = (over = {}) => ({ version: 1, enabled: true, auto: true, failover: true, remember: true, columns: [...GEO_COLUMNS], providers: { maxmind: { enabled: true, service: 'geoip-insights' }, ipgeolocation: { enabled: false, security: false }, ipdata: { enabled: false }, ipapi: { enabled: false, http: false } }, ...over });
const CREDENTIALS = { version: 1, items: { maxmind: { accountId: CANARY_ACCOUNT, licenseKey: CANARY_KEY } } };
const SETTINGS_KEY = 'proxy-geo-settings:v1', CREDENTIALS_KEY = 'proxy-geo-credentials:v1', CACHE_KEY = 'proxy-geo-cache:v1', BANNER_KEY = 'proxy-geo-banner:v1', VIEW_KEY = 'proxy-view:v1';

// ---- The provider side (Chromium): every request to a provider host is recorded and answered here --------------------------------------
const CODE = cp => String.fromCodePoint(cp);
const HOSTILE = { city: '<img src=x onerror=window.__geoPwned=1>', region: 'Cali' + CODE(0x202e) + 'fornia', org: 'Evil' + CODE(0x200b) + CODE(0x2066) + 'Corp' + CODE(0x061c), isp: '<script>window.__geoPwned=2</script>' };
const maxmind = (ip, over = {}) => ({ traits: { ip_address: ip, autonomous_system_number: 15169, autonomous_system_organization: 'Google LLC', isp: 'Google Fiber', user_type: 'hosting' }, country: { iso_code: 'US', names: { en: 'United States' } },
  city: { names: { en: 'Mountain View' } }, subdivisions: [{ names: { en: 'California' } }], location: { time_zone: 'America/Los_Angeles' }, anonymizer: { is_public_proxy: true, is_anonymous_vpn: true }, maxmind: { queries_remaining: 481 }, ...over });
const ANSWERS = {
  '8.8.8.8': ip => ({ body: maxmind(ip, { city: { names: { en: HOSTILE.city } }, subdivisions: [{ names: { en: HOSTILE.region } }], traits: { ip_address: ip, autonomous_system_number: 15169, autonomous_system_organization: HOSTILE.org, isp: HOSTILE.isp, user_type: 'hosting' } }) }),
  '1.1.1.1': ip => ({ body: maxmind(ip, { country: { iso_code: 'AU', names: { en: 'Australia' } }, city: { names: { en: 'Sydney' } }, subdivisions: [{ names: { en: 'New South Wales' } }], location: { time_zone: 'Australia/Sydney' }, traits: { ip_address: ip, autonomous_system_number: 13335, autonomous_system_organization: 'Cloudflare, Inc.', user_type: 'hosting' }, anonymizer: {} }) }),
  '9.9.9.9': () => ({ status: 404, contentType: 'application/vnd.maxmind.com-error+json', body: { code: 'IP_ADDRESS_NOT_FOUND', error: 'The address is not in the database' } }),
};
const requests = [], unexpected = [], consoleLines = [];
let answers = { ...ANSWERS };
const PROVIDER = /^https?:\/\/(geolite\.info|geoip\.maxmind\.com|api\.ipgeolocation\.io|api\.ipdata\.co|ip-api\.com|pro\.ip-api\.com)(\/|$)/;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, accept', 'access-control-allow-methods': 'GET' };
async function intercept() {
  await opened.context.route(url => !/^(chrome-extension|moz-extension|about|data|blob|chrome):/.test(url.href) && !PROVIDER.test(url.href), route => { unexpected.push(route.request().url().replace(/[?#].*$/, '')); void route.abort(); });
  await opened.context.route(url => PROVIDER.test(url.href), async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: CORS }); return; }
    const ip = decodeURIComponent(url.pathname.split('/').pop()), headers = request.headers();
    requests.push({ method: request.method(), host: url.host, path: url.pathname, ip, hasAuthorization: Boolean(headers.authorization), hasCookie: Boolean(headers.cookie), hasReferer: Boolean(headers.referer), secretInUrl: KEY_PATTERN.test(url.href) });
    const reply = (answers[ip] ?? (() => ({ status: 404, contentType: 'application/vnd.maxmind.com-error+json', body: { code: 'IP_ADDRESS_NOT_FOUND', error: 'nothing' } })))(ip);
    if (reply.delay) await pause(reply.delay);
    await route.fulfill({ status: reply.status ?? 200, contentType: reply.contentType ?? 'application/json', headers: CORS, body: JSON.stringify(reply.body) });
  });
}
const settle = async (label, ms = 1600) => { await pause(ms); return requests.length; };

// The proxy service of this extension needs a companion for manual checks: a controllable stand-in answers only checkProfile, and grants the optional
// permissions the page asks for. Nothing else is changed and nothing leaves the browser.
const FAKE_SERVICE = String.raw`(() => {
  const api = globalThis.chrome; if (!api?.runtime?.connect || globalThis.__geoFake) return; globalThis.__geoFake = true;
  const real = api.runtime.connect.bind(api.runtime);
  api.runtime.connect = (...args) => {
    const port = real(...args);
    if (args[0]?.name !== 'detect.expert.proxy/v1') return port;
    const listeners = [], add = port.onMessage.addListener.bind(port.onMessage), post = port.postMessage.bind(port);
    port.onMessage.addListener = fn => { listeners.push(fn); add(fn); };
    port.postMessage = message => {
      if (message?.op === 'checkProfile') {
        const cfg = globalThis.__geoChecks || {}, id = message.payload.id, entry = cfg[id] ?? cfg.default ?? { state: 'pass', ms: 140, ip: '8.8.8.8' };
        setTimeout(() => {
          const diagnostic = entry.state === 'pass' ? { state: 'pass', reachable: true, remoteDns: true, tlsVerified: true, httpStatus: 200, ip: entry.ip ?? null, elapsedMs: entry.ms ?? 140 } : { state: 'fail', code: entry.code ?? 'auth-failed', phase: entry.phase ?? 'auth' };
          for (const fn of listeners) fn({ v: 1, id: message.id, ok: true, result: { profileId: id, diagnostic } });
        }, entry.delay ?? 150);
        return;
      }
      post(message);
    };
    return port;
  };
  if (api.permissions) { api.permissions.request = async () => true; const contains = api.permissions.contains?.bind(api.permissions); api.permissions.contains = async query => (query?.permissions ?? []).includes('nativeMessaging') || (query?.permissions ?? []).includes('clipboardWrite') ? true : contains ? contains(query) : true; }
})();`;

// ---- Page helpers (self-contained functions: the Firefox driver sends them as source) ---------------------------------------------------
const page = () => opened.context.pages().find(candidate => candidate.url().startsWith(opened.base + 'options.html'));
const setStorage = data => opened.evaluate(async data => { const api = globalThis.browser ?? globalThis.chrome; await api.storage.local.set(data); return true; }, data);
const removeStorage = keys => opened.evaluate(async keys => { const api = globalThis.browser ?? globalThis.chrome; await api.storage.local.remove(keys); return true; }, keys);
const readStorage = key => opened.evaluate(async key => { const api = globalThis.browser ?? globalThis.chrome; return (await api.storage.local.get(key))[key] ?? null; }, key);
const local = {
  get: key => opened.evaluate(key => { try { return localStorage.getItem(key); } catch { return null; } }, key),
  set: (key, value) => opened.evaluate(({ key, value }) => { localStorage.setItem(key, value); return true; }, { key, value }),
  remove: key => opened.evaluate(key => { localStorage.removeItem(key); return true; }, key),
};
const probe = async fn => { try { return await fn(); } catch { return false; } };
let reloads = 0;
const ready = (count = null) => until(() => probe(() => opened.evaluate(count => document.querySelector('[data-proxy-workspace]')?.getAttribute('aria-busy') === 'false' && document.querySelector('[data-proxy-new]')?.disabled === false && (count === null || document.querySelectorAll('[data-proxy-profile]').length === count), count)), 'Proxy ready', 40000);
const navigate = async () => { const query = '?r=' + (++reloads); await opened.goto(opened.base + 'options.html' + query + '#proxy'); await until(() => probe(() => opened.evaluate(query => location.search === query && document.readyState === 'complete', query)), 'navigation', 40000); await ready(); };
async function restartWorker() {
  const cdp = await opened.context.newCDPSession(page());
  try { await cdp.send('ServiceWorker.enable'); await cdp.send('ServiceWorker.stopAllWorkers'); await pause(500); } finally { await cdp.detach().catch(() => {}); }
}
const heads = () => opened.evaluate(() => [...document.querySelectorAll('[data-proxy-table] [role="columnheader"]')].map(head => head.dataset.col));
const visibleHeads = () => opened.evaluate(() => [...document.querySelectorAll('[data-proxy-table] [role="columnheader"]')].filter(head => head.getClientRects().length > 0).map(head => head.dataset.col));
const banner = () => opened.evaluate(() => document.querySelector('[data-proxy-geo-banner]')?.dataset.proxyGeoBanner ?? null);
const phaseOf = id => opened.evaluate(id => document.querySelector('[data-proxy-profile="' + id + '"] [data-col="geo"]')?.dataset.proxyGeoState ?? null, id);
const cellText = (id, col) => opened.evaluate(({ id, col }) => (document.querySelector('[data-proxy-profile="' + id + '"] [data-col="' + col + '"]')?.textContent ?? '').replace(/\s+/g, ' ').trim(), { id, col });
const exists = selector => opened.evaluate(selector => Boolean(document.querySelector(selector)), selector);
const overflow = () => opened.evaluate(() => document.documentElement.scrollWidth - innerWidth);
const gridHtml = () => opened.evaluate(() => document.querySelector('[data-proxy-table]')?.outerHTML ?? '');
const workspaceText = () => opened.evaluate(() => document.querySelector('[data-proxy-workspace]').textContent);
const colcounts = () => opened.evaluate(() => { const grid = document.querySelector('[data-proxy-table]'); return { colcount: Number(grid.getAttribute('aria-colcount')), heads: grid.querySelectorAll('[role="columnheader"]').length, rowcount: Number(grid.getAttribute('aria-rowcount')), rows: grid.querySelectorAll('[role="row"]').length }; });
const openPeek = async id => { if (!await exists('[data-proxy-peek="' + id + '"]')) await opened.click('[data-proxy-open="' + id + '"]'); await until(() => exists('[data-proxy-peek="' + id + '"]'), 'details of ' + id); };
const closePeek = async () => { if (await exists('[data-proxy-peek-close]')) { await opened.click('[data-proxy-peek-close]'); await until(async () => !(await exists('[data-proxy-peek]')), 'details closed'); } };
const openMenu = async id => { if (!await opened.evaluate(id => document.querySelector('[data-proxy-menu="' + id + '"]')?.getAttribute('aria-expanded') === 'true', id)) await opened.click('[data-proxy-menu="' + id + '"]'); await until(() => opened.evaluate(id => document.querySelector('[data-proxy-menu="' + id + '"]')?.getAttribute('aria-expanded') === 'true', id), 'menu ' + id); };
async function capture(name) {
  await opened.evaluate(async () => { document.activeElement?.blur?.(); window.scrollTo(0, 0); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); return true; });
  const path = join(shots, browser + '-' + name + '.png'); await opened.screenshot(path); evidence.screenshots.push({ file: browser + '-' + name + '.png', sha256: hash(readFileSync(path)) });
}
const useChecks = checks => opened.evaluate(checks => { globalThis.__geoChecks = checks; return true; }, checks);
async function batchCheck(checks) {
  await useChecks(checks);
  await opened.click('[data-proxy-check-visible]');
  await until(() => probe(() => opened.evaluate(() => !document.querySelector('[data-proxy-check-progress]') && [...document.querySelectorAll('[data-proxy-health]')].every(node => node.dataset.state !== 'checking'))), 'batch check done', 40000);
}
async function enable(over = {}, wanted = CREDENTIALS) {
  const credentials = chrome ? wanted : null; // Firefox has no interception here: it never gets a key, so nothing it shows can be sent
  await setStorage({ [SETTINGS_KEY]: settingsOf(over), ...(credentials ? { [CREDENTIALS_KEY]: credentials } : {}) });
  if (!credentials) await removeStorage([CREDENTIALS_KEY]);
}
const waitPhase = (id, wanted, label = '') => until(async () => (await phaseOf(id)) === wanted, id + ' is ' + wanted + ' ' + label, 20000);

// ---- Seeding ---------------------------------------------------------------------------------------------------------------------------
// The proxy service keeps its configuration in memory: in Chromium the worker is stopped after the storage write and starts again from the
// seed; in Firefox the profiles go in through the page's own import dialog (direct kinds only).
let ids = PROFILES.map(profile => profile.id);
const ID = number => ids[number - 1]; // Chromium keeps the seeded ids; Firefox gets generated ones from the import
async function seed() {
  if (chrome) {
    await setStorage({ 'proxy-configuration:v1': configurationOf(PROFILES), 'proxy-check-history:v1': historyOf() });
    await restartWorker(); await navigate(); await ready(PROFILES.length);
    return;
  }
  await navigate();
  if (await opened.evaluate(() => document.querySelectorAll('[data-proxy-profile]').length)) { await opened.click('[data-proxy-select-all]'); await opened.click('[data-proxy-delete-selected]'); await opened.click('[data-proxy-remove-confirm]'); await until(async () => (await opened.evaluate(() => document.querySelectorAll('[data-proxy-profile]').length)) === 0, 'profiles removed', 90000); await ready(); }
  await opened.click('[data-proxy-menu="add"]'); await opened.click('[data-proxy-bulk-open]'); await until(() => opened.evaluate(() => Boolean(document.querySelector('dialog[data-proxy-bulk]')?.open)), 'import dialog');
  await opened.fill('[data-proxy-bulk-text]', PROFILES.map(profile => profile.type + '://' + profile.host + ':' + profile.port + ' #' + profile.name).join(String.fromCharCode(10))); await opened.click('[data-proxy-bulk-parse]');
  await until(() => opened.evaluate(() => document.querySelector('dialog[data-proxy-bulk]')?.dataset.proxyBulk === 'preview'), 'import preview'); await opened.click('[data-proxy-bulk-save]');
  await until(() => opened.evaluate(() => !document.querySelector('dialog[data-proxy-bulk]')), 'import saved', 180000); await ready(PROFILES.length);
  if (await exists('[data-proxy-imported-close]')) await opened.click('[data-proxy-imported-close]');
  const byName = await opened.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-proxy-profile]')].map(row => [row.querySelector('.pm-name-main').textContent.trim(), row.getAttribute('data-proxy-profile')])));
  ids = PROFILES.map(profile => byName[profile.name]); assert.ok(ids.every(Boolean), 'every seeded profile is listed');
  const history = historyOf(); history.items = Object.fromEntries(Object.entries(history.items).map(([id, entries]) => [ids[PROFILES.findIndex(profile => profile.id === id)], entries]));
  await setStorage({ 'proxy-check-history:v1': history }); await navigate();
}

// ---- Contrast probe: the one of proxy-ui-visual-native.mjs, taken from its source so there is a single definition ------------------------
function contrastProbeSource() {
  const text = readFileSync(join(import.meta.dirname, 'proxy-ui-visual-native.mjs'), 'utf8'), start = text.indexOf('function contrastProbe(options) {');
  assert.ok(start >= 0, 'proxy-ui-visual-native.mjs still defines contrastProbe(options)');
  let depth = 0, end = -1;
  for (let index = text.indexOf('{', start); index < text.length; index++) { if (text[index] === '{') depth++; else if (text[index] === '}' && --depth === 0) { end = index + 1; break; } }
  assert.ok(end > start, 'the probe has a closing brace'); return text.slice(start, end);
}
const probeSource = chrome ? contrastProbeSource() : null;
const contrastOf = async scope => { await page().mouse.move(2, 2); await pause(250); return page().evaluate('(' + probeSource + ')(' + JSON.stringify({ scope }) + ')'); };
const THEMES = ['system-light', 'system-dark', 'pearl', 'orchid', 'aurora', 'graphite', 'glass'], DARK = new Set(['system-dark', 'aurora', 'graphite', 'glass']);
async function arrange({ theme = 'system-light', language = 'en', width = 1180, height = 900 } = {}) {
  const id = theme.startsWith('system') ? 'system' : theme; // the system themes follow the emulated colour scheme
  await setStorage({ 'ui-theme-v1': id, 'ui-language-v1': language });
  if (chrome) await opened.media({ colorScheme: DARK.has(theme) ? 'dark' : 'light' });
  await opened.viewport(width, height);
  const label = PROXY_WORKSPACE_MESSAGES[language].proxy_workspace_selected_domains;
  await until(() => probe(() => opened.evaluate(({ theme, label }) => document.documentElement.getAttribute('data-ui-theme') === theme && document.documentElement.getAttribute('data-ui-theme-ready') === 'true' && document.querySelector('[data-proxy-route-mode="include"]')?.closest('label')?.textContent.trim() === label, { theme: id, label })), 'theme ' + theme + ' and language ' + language, 20000);
  await pause(250);
}

try {
  phase = 'launch';
  opened = await launchOwnedManagement({ root, run, extension: frozen, browser, evidence, dark: !chrome });
  evidence.version = opened.version;
  if (chrome) {
    await opened.context.addInitScript(FAKE_SERVICE); await intercept();
    opened.context.on('console', message => { consoleLines.push(message.type() + ' ' + message.text()); });
    opened.context.on('weberror', error => { consoleLines.push('pageerror ' + String(error.error()?.message ?? error)); });
  }
  await opened.viewport(1920, 1000);
  phase = 'seed'; await seed();
  const baseline = { heads: await heads(), counts: await colcounts() };
  assert.deepEqual(baseline.heads.length, 9); assert.deepEqual(baseline.counts, { colcount: 9, heads: 9, rowcount: 7, rows: 7 });
  await until(async () => (await banner()) === 'invite', 'a fresh profile starts with the invitation', 15000);
  check('seeded six profiles (five with a saved exit IP, one private) in a disposable ' + browser + ' profile; the feature is off by default');

  // ---- The invitation -------------------------------------------------------------------------------------------------------------------
  phase = 'invitation';
  assert.equal(await banner(), 'invite');
  const info = await opened.evaluate(() => { const node = document.querySelector('[data-proxy-geo-banner]'), link = node.querySelector('[data-proxy-geo-banner-link]'), dismiss = node.querySelector('[data-proxy-geo-banner-dismiss]'), listhead = document.querySelector('header.pm-listhead');
    return { role: node.getAttribute('role'), label: node.getAttribute('aria-label'), text: node.textContent.replace(/\s+/g, ' ').trim(), href: link.getAttribute('href'), target: link.getAttribute('target'), rel: link.getAttribute('rel'), dismissName: dismiss.getAttribute('aria-label'),
      tour: document.querySelector('[data-tour="proxy"]') === listhead, below: listhead.nextElementSibling === node, aboveFilters: Boolean(node.compareDocumentPosition(document.querySelector('.pm-filters-wrap')) & Node.DOCUMENT_POSITION_FOLLOWING) }; });
  assert.equal(info.role, 'region'); assert.ok(info.label.length > 0); assert.match(info.text, /Improve the results: add a geolocation API key and the manager will show the country, city, network and proxy\/VPN flags for each proxy's exit IP\. Nothing is sent until you turn it on\./);
  assert.match(info.text, /Set up Proxy Manager Geolocation API/); assert.deepEqual([info.href, info.target, info.rel], ['proxy-geo-settings.html', '_blank', 'noopener']); assert.ok(info.dismissName.length > 0);
  assert.equal(info.tour, true, 'the tour anchor is still the list header'); assert.equal(info.below, true, 'the notice sits right under the header'); assert.equal(info.aboveFilters, true);
  assert.deepEqual(await heads(), baseline.heads); assert.deepEqual(await colcounts(), baseline.counts); assert.equal(await exists('[data-proxy-geo-detail]'), false);
  await openMenu('columns'); assert.equal(await exists('[data-proxy-geo-column]'), false, 'no geolocation columns in the menu while off'); await opened.click('[data-proxy-menu="columns"]');
  await openMenu('list'); assert.equal(await exists('[data-proxy-geo-lookup-all]'), false); await opened.click('[data-proxy-menu="list"]');
  assert.equal(await settle('open, feature off'), 0, 'no provider request on open'); assert.equal(requests.length, 0);
  const before = await gridHtml();
  if (chrome) {
    const opening = opened.context.waitForEvent('page'); await opened.click('[data-proxy-geo-banner-link]'); const tab = await opening; await tab.waitForLoadState('domcontentloaded').catch(() => {});
    assert.equal(tab.url(), opened.base + 'proxy-geo-settings.html', 'the link opens the settings page in a new tab'); await tab.close();
  } else evidence.notes.push('Firefox: the new tab opened by the link is not driven (the driver has no tab events); its href and target are checked above.');
  check('the invitation is a named region right under the list header (tour anchor unchanged), carries the owner\'s sentence and a real link that opens the settings page in a new tab; no column, menu entry or provider request exists while the feature is off');
  await opened.click('[data-proxy-geo-banner-dismiss]'); await until(async () => (await banner()) === null, 'invitation dismissed');
  assert.equal(await local.get(BANNER_KEY), '{"version":1,"dismissed":true}'); assert.equal(await gridHtml(), before, 'dismissing changes nothing else: the grid is byte-for-byte the same');
  await navigate(); assert.equal(await banner(), null, 'the dismissal survives a reload');
  check('dismissing hides the invitation and nothing else, is stored under proxy-geo-banner:v1 in this browser profile only, and survives a reload');

  // ---- On, without a ready provider: the reminder -----------------------------------------------------------------------------------------
  phase = 'reminder';
  await enable({}, null); await until(async () => (await banner()) === 'not-ready', 'reminder', 15000);
  assert.equal(await exists('[data-proxy-geo-banner-dismiss]'), false, 'the reminder is not dismissible'); assert.equal(await local.get(BANNER_KEY), '{"version":1,"dismissed":true}', 'although the invitation was dismissed');
  assert.match(await opened.evaluate(() => document.querySelector('[data-proxy-geo-banner]').textContent), /Geolocation API is on, but no provider is ready — add a key\./);
  assert.deepEqual(await heads(), ['select', 'name', 'type', 'address', 'country', 'check', 'ip', ...GEO_COLUMNS, 'checked', 'actions'], 'the five columns arrive live, in canonical order, between the exit IP and the check time');
  assert.deepEqual(await colcounts(), { colcount: 14, heads: 14, rowcount: 7, rows: 7 });
  assert.match(await cellText(ID(1), 'geo'), /No provider is ready — add a key/); assert.equal(await exists('[data-proxy-geo-lookup]'), false, 'no lookup button without a ready provider');
  assert.equal(await phaseOf(ID(5)), 'private'); assert.equal(await phaseOf(ID(6)), 'no-ip'); assert.match(await cellText(ID(5), 'geo'), /Not a public address — nothing is sent/); assert.match(await cellText(ID(6), 'geo'), /Run a check first/);
  await openMenu('list'); assert.equal(await opened.evaluate(() => document.querySelector('[data-proxy-geo-lookup-all]').disabled), true); assert.match(await opened.evaluate(() => document.querySelector('[data-proxy-geo-lookup-all]').textContent), /No provider is ready — add a key/); await opened.click('[data-proxy-menu="list"]');
  assert.equal(requests.length, 0);
  check('on without a provider the reminder shows (even after the invitation was dismissed) and cannot be dismissed, the five columns appear live in order, rows explain themselves, and "look up all" is disabled with its reason');

  // ---- Ready: nothing is sent by opening, rendering or waiting -----------------------------------------------------------------------------
  phase = 'ready';
  if (chrome) {
  await enable(); await until(async () => (await banner()) === null && (await exists('[data-proxy-geo-lookup]')), 'ready: no notice, lookup buttons', 15000);
  assert.deepEqual(await Promise.all(['p-001', 'p-002', 'p-003', 'p-004', 'p-005', 'p-006'].map(phaseOf)), ['empty', 'empty', 'empty', 'empty', 'private', 'no-ip']);
  assert.deepEqual((await opened.evaluate(() => [...document.querySelectorAll('[data-proxy-geo-lookup]')].map(button => button.dataset.proxyGeoLookup))).sort(), ['p-001', 'p-002', 'p-003', 'p-004'], 'a lookup is offered only for a public exit IP');
  assert.equal(await settle('ready, idle'), 0, 'a ready feature sends nothing by itself');
  await navigate(); assert.equal(await settle('reopened'), 0, 'nor on a fresh visit with saved exit IPs and a ready provider'); assert.equal(await phaseOf('p-001'), 'empty');
  assert.equal(await banner(), null);
  assert.equal(KEY_PATTERN.test(await opened.evaluate(() => document.documentElement.outerHTML)), false, 'no key or account number anywhere in the page');
  check('with a ready provider the lookup buttons appear for public exit IPs only and NO provider request is made by opening, rendering, reloading or waiting (0 requests)');
  } else evidence.notes.push('Firefox: no ready provider is configured (there is no interception here), so no lookup can happen; the lookup, retry, bulk and keyboard phases are Chromium only.');

  if (chrome) {
    // ---- A completed manual check: one request per distinct public address ------------------------------------------------------------------
    phase = 'manual check';
    const checks = { 'p-001': { state: 'pass', ip: '8.8.8.8' }, 'p-002': { state: 'pass', ip: '1.1.1.1' }, 'p-003': { state: 'pass', ip: '9.9.9.9' }, 'p-004': { state: 'pass', ip: '8.8.8.8' }, 'p-005': { state: 'pass', ip: '10.0.0.7' }, 'p-006': { state: 'fail', code: 'auth-failed', phase: 'auth' } };
    await batchCheck(checks);
    await until(async () => (await phaseOf('p-001')) === 'data' && (await phaseOf('p-002')) === 'data' && (await phaseOf('p-003')) === 'error', 'lookups arrive', 25000);
    await settle('after the batch', 2500);
    assert.equal(requests.length, 3, 'one request per distinct public address (p-001 and p-004 share 8.8.8.8)');
    assert.deepEqual(requests.map(request => request.ip).sort(), [...PUBLIC_EXITS].sort()); assert.ok(requests.every(request => request.method === 'GET' && request.host === 'geoip.maxmind.com' && request.path === '/geoip/v2.1/insights/' + request.ip));
    assert.equal(requests.some(request => /^(10\.|172\.16\.)/.test(request.ip)), false, 'private and reserved exit IPs are never sent');
    assert.ok(requests.every(request => request.hasAuthorization && !request.hasCookie && !request.hasReferer && !request.secretInUrl), 'the key goes only in the Authorization header: no cookie, no referrer, nothing in the URL');
    assert.deepEqual(await Promise.all(['p-001', 'p-002', 'p-003', 'p-004', 'p-005', 'p-006'].map(phaseOf)), ['data', 'data', 'error', 'data', 'private', 'no-ip']);
    check('a completed manual check of six profiles sent exactly 3 GET requests, one per distinct public exit IP (8.8.8.8 once for two profiles); 10.0.0.7 never left the page and a failed check says nothing; no cookie, no referrer, the key only in the Authorization header');

    // ---- Cells show provider data as text, nothing else ---------------------------------------------------------------------------------
    phase = 'cells';
    const text1 = await cellText('p-001', 'geo'); assert.ok(text1.includes(HOSTILE.city), 'the hostile city is shown as plain text'); assert.match(text1, /US\s*United States/);
    const forbidden = new RegExp('[' + [0x202e, 0x200b, 0x2066, 0x061c, 0x200e, 0x2067].map(cp => CODE(cp)).join('') + ']');
    const safe = await opened.evaluate(() => ({ images: document.querySelectorAll('[data-proxy-workspace] img').length, scripts: document.querySelectorAll('[data-proxy-workspace] script').length, pwned: window.__geoPwned ?? null, handlers: [...document.querySelectorAll('[data-proxy-workspace] *')].filter(node => [...node.attributes].some(attribute => /^on/i.test(attribute.name))).length }));
    assert.deepEqual(safe, { images: 0, scripts: 0, pwned: null, handlers: 0 }, 'a hostile answer creates no element and runs nothing');
    assert.equal(forbidden.test(await workspaceText()), false, 'bidi overrides and zero-width characters of the answer never reach the page');
    assert.equal(await opened.evaluate(() => [...document.querySelectorAll('[data-proxy-geo-state="data"] [data-proxy-geo-flag]')].length >= 2), true);
    assert.equal(await opened.evaluate(() => [...document.querySelectorAll('[data-proxy-profile="p-001"] bdi')].length >= 2), true, 'provider text is isolated in <bdi>');
    assert.match(await cellText('p-001', 'geonet'), /AS15169 Evil\s?Corp/); assert.match(await cellText('p-001', 'geokind'), /Hosting/);
    assert.deepEqual(await opened.evaluate(() => [...document.querySelectorAll('[data-proxy-profile="p-001"] [data-proxy-geo-flag]')].map(chip => chip.dataset.proxyGeoFlag)), ['proxy', 'vpn']);
    assert.equal(await opened.evaluate(() => [...document.querySelectorAll('[data-proxy-profile="p-001"] [data-proxy-geo-flag]')].every(chip => /as reported by the provider/.test(chip.title))), true);
    assert.equal(await cellText('p-002', 'geoflags'), 'None flagged'); assert.match(await cellText('p-002', 'geo'), /Sydney, New South Wales\s*AU\s*Australia/); assert.match(await cellText('p-002', 'geotime'), /UTC\+(10|11):00/); assert.match(await cellText('p-002', 'geotime'), /Australia\/Sydney/);
    assert.equal(await exists('[data-proxy-profile="p-001"] [data-proxy-geo-mismatch]'), true, 'tag DE against the provider US'); assert.equal(await exists('[data-proxy-profile="p-002"] [data-proxy-geo-mismatch]'), false, 'tag AU matches'); assert.equal(await exists('[data-proxy-profile="p-004"] [data-proxy-geo-mismatch]'), false, 'tag US matches');
    assert.match(await opened.evaluate(() => document.querySelector('[data-proxy-profile="p-001"] [data-proxy-geo-mismatch]').title), /differs from your tag \(DE\)/);
    assert.equal(await opened.evaluate(() => document.querySelector('[data-proxy-profile="p-001"] [data-col="geo"]').title.startsWith('MaxMind GeoIP / GeoLite (GeoIP Insights), received')), true);
    assert.match(await cellText('p-003', 'geo'), /No data/); assert.equal(await opened.evaluate(() => document.querySelector('[data-proxy-profile="p-003"] [data-proxy-geo-error]')?.dataset.code), 'not-found'); assert.equal(await exists('[data-proxy-profile="p-003"] [data-proxy-geo-lookup]'), true, 'an error offers its retry');
    assert.equal(await opened.evaluate(() => getComputedStyle(document.querySelector('[data-proxy-profile="p-003"] [data-proxy-geo-state="error"] .pm-geo-error')).color !== getComputedStyle(document.querySelector('[data-proxy-profile="p-001"] [data-proxy-geo-state="data"] .pm-geo-primary')).color), true);
    check('provider text appears only as text: a hostile city, region, organisation and ISP (markup, a right-to-left override, zero-width and isolate characters) created no element, ran nothing and lost its invisible characters; flags are chips with "as reported by the provider", "None flagged" for reported-and-clear, the tag mismatch is a glyph with a title, an error shows its reason and a retry');

    // ---- Error then retry: a transient failure of this page, then success -------------------------------------------------------------------
    phase = 'retry';
    const count = requests.length;
    answers['9.9.9.9'] = () => ({ status: 500, contentType: 'application/json', body: {} });
    await opened.click('[data-proxy-profile="p-003"] [data-proxy-geo-lookup]'); await until(async () => /Server error/.test(await cellText('p-003', 'geo')), 'a failure of this lookup is shown', 15000);
    assert.equal(requests.length, count + 1, 'one request per press'); assert.equal(await opened.evaluate(() => document.querySelector('[data-proxy-profile="p-003"] [data-proxy-geo-error]')?.dataset.code), 'server');
    answers['9.9.9.9'] = ip => ({ body: maxmind(ip, { country: { iso_code: 'NL', names: { en: 'Netherlands' } }, city: { names: { en: 'Amsterdam' } }, subdivisions: [{ names: { en: 'North Holland' } }], location: { time_zone: 'Europe/Amsterdam' }, traits: { ip_address: ip, autonomous_system_number: 19281, autonomous_system_organization: 'Quad9', user_type: 'business' }, anonymizer: { is_hosting_provider: true } }) });
    await opened.click('[data-proxy-profile="p-003"] [data-proxy-geo-lookup]'); await waitPhase('p-003', 'data', 'after the retry');
    assert.equal(requests.length, count + 2); assert.match(await cellText('p-003', 'geo'), /Amsterdam, North Holland\s*NL\s*Netherlands/); assert.equal(await exists('[data-proxy-profile="p-003"] [data-proxy-geo-error]'), false);
    check('a failed lookup (HTTP 500) shows "Server error" with a retry on the row although the controller does not remember transient errors; the retry sends one request and the data replaces the error');

    // ---- Stale data ---------------------------------------------------------------------------------------------------------------------------
    phase = 'stale';
    await opened.evaluate(async key => { const api = globalThis.browser ?? globalThis.chrome, cache = (await api.storage.local.get(key))[key]; cache.items['1.1.1.1'].at = Date.now() - 26 * 3600000; await api.storage.local.set({ [key]: cache }); return true; }, CACHE_KEY);
    await until(() => opened.evaluate(() => document.querySelector('[data-proxy-profile="p-002"] [data-col="geo"]')?.classList.contains('is-stale') === true), 'stale record', 15000);
    const stale = await opened.evaluate(() => { const cell = document.querySelector('[data-proxy-profile="p-002"] [data-col="geo"]'), fresh = document.querySelector('[data-proxy-profile="p-001"] [data-col="geo"] .pm-geo-primary'), old = cell.querySelector('.pm-geo-primary');
      return { title: cell.title, italic: getComputedStyle(cell.querySelector('.pm-geo-stack')).fontStyle, dimmer: getComputedStyle(old).color !== getComputedStyle(fresh).color, text: cell.textContent.replace(/\s+/g, ' ').trim() }; });
    assert.match(stale.title, /^Out of date: received /); assert.equal(stale.italic, 'italic', 'not only dimmer: slanted as well'); assert.equal(stale.dimmer, true); assert.match(stale.text, /Sydney/, 'old data is still shown');
    await openPeek('p-002'); assert.equal(await exists('[data-proxy-geo-stale="p-002"]'), true); assert.match(await opened.evaluate(() => document.querySelector('[data-proxy-geo-detail="p-002"]').textContent), /Out of date: received/);
    const refreshCount = requests.length; await opened.click('[data-proxy-geo-detail="p-002"] [data-proxy-geo-lookup]'); await until(async () => !(await exists('[data-proxy-geo-stale="p-002"]')), 'refreshed', 15000);
    assert.equal(requests.length, refreshCount + 1); await closePeek();
    check('an old record is dimmed and slanted with its age in the title and an "Out of date" note in the details; Refresh sends one request and the note goes away');

    // ---- The details panel --------------------------------------------------------------------------------------------------------------------
    phase = 'details';
    await openPeek('p-001');
    const detail = await opened.evaluate(() => { const panel = document.querySelector('[data-proxy-geo-detail="p-001"]'); return { text: panel.textContent.replace(/\s+/g, ' ').trim(), labelledBy: document.getElementById(panel.getAttribute('aria-labelledby'))?.textContent ?? '', flags: Object.fromEntries([...panel.querySelectorAll('[data-proxy-geo-flag-state]')].map(item => [item.dataset.proxyGeoFlagState, item.dataset.state])), button: panel.querySelector('[data-proxy-geo-lookup]')?.textContent.trim() }; });
    assert.match(detail.text, /MaxMind GeoIP \/ GeoLite \(GeoIP Insights\) · updated/); assert.ok(detail.text.includes(HOSTILE.city)); assert.match(detail.text, /Requests left with the provider: 481/); assert.match(detail.text, /Provider data is approximate and may differ from other sources\./); assert.match(detail.text, /differs from your tag \(DE\)/);
    assert.deepEqual(detail.flags, { proxy: 'yes', vpn: 'yes', tor: 'no', hosting: 'no', mobile: 'unreported', relay: 'unreported', residentialProxy: 'no', threat: 'unreported' }); assert.match(detail.labelledBy, /Geolocation \(as reported by the provider\)/); assert.equal(detail.button, 'Refresh');
    await openPeek('p-005'); assert.match(await opened.evaluate(() => document.querySelector('[data-proxy-geo-detail="p-005"]').textContent), /The exit address is not public, so it is not sent to a provider\./); assert.equal(await exists('[data-proxy-geo-detail="p-005"] [data-proxy-geo-lookup]'), false);
    await openPeek('p-006'); assert.match(await opened.evaluate(() => document.querySelector('[data-proxy-geo-detail="p-006"]').textContent), /The exit IP appears after this proxy is checked\./);
    await closePeek();
    check('the details panel shows the provider and its service, the age, every field as text, three-state flags (yes / no / not reported), the quota the provider reported, the caveat, and in plain words why a private or unchecked proxy has nothing');

    // ---- Look up all ----------------------------------------------------------------------------------------------------------------------------
    phase = 'look up all';
    await removeStorage([CACHE_KEY]); await until(async () => (await phaseOf('p-001')) === 'empty' && (await phaseOf('p-003')) === 'empty', 'cache cleared', 15000);
    answers = { ...ANSWERS, '9.9.9.9': ip => ({ body: maxmind(ip, { country: { iso_code: 'NL', names: { en: 'Netherlands' } }, city: { names: { en: 'Amsterdam' } } }) }) };
    const bulkStart = requests.length;
    await openMenu('list'); assert.equal(await opened.evaluate(() => document.querySelector('[data-proxy-geo-lookup-all]').disabled), false); await opened.click('[data-proxy-geo-lookup-all]');
    await until(() => exists('[data-proxy-geo-confirm]'), 'confirmation');
    const confirm = await opened.evaluate(() => { const node = document.querySelector('[data-proxy-geo-confirm]'); return { count: node.dataset.proxyGeoConfirm, role: node.getAttribute('role'), text: node.textContent.replace(/\s+/g, ' ').trim(), focus: document.activeElement?.hasAttribute('data-proxy-geo-confirm-yes') }; });
    assert.equal(confirm.count, '3'); assert.equal(confirm.role, 'group'); assert.match(confirm.text, /^Send 3 addresses to MaxMind GeoIP \/ GeoLite\?/); assert.match(confirm.text, /hosts, ports and logins are not sent/); assert.equal(confirm.focus, true, 'the confirmation takes the focus');
    assert.equal(requests.length, bulkStart, 'asking sends nothing');
    await opened.click('[data-proxy-geo-confirm-no]'); await until(async () => !(await exists('[data-proxy-geo-confirm]')), 'cancelled'); await settle('after Cancel', 800); assert.equal(requests.length, bulkStart, 'Cancel sends nothing');
    await openMenu('list'); await opened.click('[data-proxy-geo-lookup-all]'); await until(() => exists('[data-proxy-geo-confirm]'), 'confirmation again');
    await page().keyboard.press('Escape'); await until(async () => !(await exists('[data-proxy-geo-confirm]')), 'Escape cancels'); assert.equal(requests.length, bulkStart);
    await openMenu('list'); await opened.click('[data-proxy-geo-lookup-all]'); await until(() => exists('[data-proxy-geo-confirm]'), 'confirmation a third time'); await opened.click('[data-proxy-geo-confirm-yes]');
    await until(async () => (await Promise.all(['p-001', 'p-002', 'p-003', 'p-004'].map(phaseOf))).every(value => value === 'data'), 'bulk results', 25000); await settle('after the bulk', 1500);
    assert.equal(requests.length, bulkStart + 3, 'exactly the three distinct public addresses, once each'); assert.deepEqual(requests.slice(bulkStart).map(request => request.ip).sort(), [...PUBLIC_EXITS].sort());
    await openMenu('list'); assert.equal(await opened.evaluate(() => document.querySelector('[data-proxy-geo-lookup-all]').disabled), true); assert.match(await opened.evaluate(() => document.querySelector('[data-proxy-geo-lookup-all]').textContent), /No addresses without fresh data/); await opened.click('[data-proxy-menu="list"]');
    check('"Look up all" asks first (3 distinct addresses, the provider\'s name, what is and is not sent), Cancel and Escape send nothing, Yes sends exactly one request per distinct public address, and the entry is then disabled with its reason');

    // ---- A lookup in flight: the busy marker, aria-busy, no double request, no animation under reduced motion ---------------------------------------------------
    phase = 'pending';
    await removeStorage([CACHE_KEY]); await until(async () => (await phaseOf('p-003')) === 'empty', 'cache cleared again', 15000);
    answers = { ...ANSWERS, '9.9.9.9': ip => ({ delay: 3000, body: maxmind(ip, { country: { iso_code: 'NL', names: { en: 'Netherlands' } }, city: { names: { en: 'Amsterdam' } } }) }) };
    const flightStart = requests.length;
    await opened.media({ reducedMotion: 'reduce', colorScheme: 'light' });
    await opened.click('[data-proxy-profile="p-003"] [data-proxy-geo-lookup]');
    await until(() => opened.evaluate(() => document.querySelector('[data-proxy-profile="p-003"] [data-col="geo"]')?.getAttribute('aria-busy') === 'true'), 'a lookup in flight', 10000);
    const flight = await opened.evaluate(() => { const row = document.querySelector('[data-proxy-profile="p-003"]'), spinner = row.querySelector('[data-col="geo"] .pm-spinner'), button = row.querySelector('[data-proxy-geo-lookup]');
      return { animation: spinner ? getComputedStyle(spinner).animationName : null, disabled: button?.getAttribute('aria-disabled'), name: button?.textContent.trim(), nativeDisabled: button?.disabled, allBusy: [...row.querySelectorAll('[data-col^="geo"]')].every(cell => cell.getAttribute('aria-busy') === 'true'), state: row.querySelector('[data-col="geo"]').dataset.proxyGeoState }; });
    assert.deepEqual(flight, { animation: 'none', disabled: 'true', name: 'Looking up…', nativeDisabled: false, allBusy: true, state: 'empty' }, 'busy: a static marker under reduced motion, a button that stays focusable but does nothing');
    // the driver refuses to click an aria-disabled button, a person can: press it in the page
    await opened.evaluate(() => { document.querySelector('[data-proxy-profile="p-003"] [data-proxy-geo-lookup]').click(); return true; }); await opened.media({ reducedMotion: 'no-preference' });
    assert.equal(await opened.evaluate(() => getComputedStyle(document.querySelector('[data-proxy-profile="p-003"] [data-col="geo"] .pm-spinner')).animationName), 'pm-spin', 'the same marker turns when motion is allowed');
    await waitPhase('p-003', 'data', 'after the slow answer'); assert.equal(requests.length, flightStart + 1, 'pressing again while it runs sent nothing');
    await opened.media({ reducedMotion: 'no-preference' });
    check('a lookup in flight shows a busy marker on every cell of the row (aria-busy), a button that stays focusable but ignores a second press (one request), a static marker under reduced motion and a turning one otherwise');

    // ---- Keyboard ------------------------------------------------------------------------------------------------------------------------------
    phase = 'keyboard';
    await removeStorage([CACHE_KEY]); await until(async () => (await phaseOf('p-003')) === 'empty', 'cache cleared again', 15000);
    answers = { ...ANSWERS, '9.9.9.9': ip => ({ body: maxmind(ip, { country: { iso_code: 'NL', names: { en: 'Netherlands' } }, city: { names: { en: 'Amsterdam' } } }) }) };
    const handle = page();
    await handle.locator('[data-proxy-profile="p-003"]').focus();
    const order = [];
    for (let step = 0; step < 14; step++) { await handle.keyboard.press('Tab'); order.push(await opened.evaluate(() => { const node = document.activeElement; return node ? (node.getAttribute('data-proxy-geo-lookup') ? 'geo-lookup:' + node.getAttribute('data-proxy-geo-lookup') : node.getAttribute('data-proxy-open') ? 'open' : node.getAttribute('data-proxy-copy-address') ? 'address' : node.tagName.toLowerCase()) : null; })); if (order.at(-1) === 'geo-lookup:p-003') break; }
    assert.ok(order.includes('geo-lookup:p-003'), 'Tab reaches the lookup button of the current row (' + order.join(' > ') + ')'); assert.ok(order.indexOf('address') < order.indexOf('geo-lookup:p-003'), 'after the address, in reading order');
    const keyboardStart = requests.length; await handle.keyboard.press('Enter');
    await until(async () => (await phaseOf('p-003')) === 'data', 'lookup by keyboard', 15000); assert.equal(requests.length, keyboardStart + 1);
    assert.equal(await opened.evaluate(() => document.activeElement?.closest('[data-proxy-profile="p-003"]') !== null), true, 'the focus stays in the row when the button leaves with its result');
    await handle.keyboard.press('ArrowDown'); await until(() => opened.evaluate(() => document.activeElement?.closest('[data-proxy-profile]')?.getAttribute('data-proxy-profile') === 'p-001'), 'arrows still move between rows (the list is sorted by name: Amsterdam, Frankfurt, ...)');
    assert.equal(await opened.evaluate(() => [...document.querySelectorAll('[data-proxy-geo-lookup]')].every(button => button.closest('[data-proxy-profile]').tabIndex === 0 ? button.tabIndex === 0 : button.tabIndex === -1)), true, 'only the current row\'s buttons are tab stops');
    check('keyboard: Tab reaches the new lookup button after the address in the current row, Enter looks up (one request) and the focus stays in the row when the button leaves with its result, arrows still move between rows, and only the current row\'s buttons are tab stops');
    await removeStorage([CACHE_KEY]);
  }

  // ---- Columns menu and the live switch ----------------------------------------------------------------------------------------------------------
  phase = 'columns menu';
  await enable(); await until(async () => (await heads()).filter(head => head.startsWith('geo')).length === 5, 'five columns', 15000);
  await openMenu('columns');
  const menu = await opened.evaluate(() => { const group = document.querySelector('[role="menu"] [role="group"]'); return { label: group?.getAttribute('aria-label'), items: [...(group?.querySelectorAll('[data-proxy-geo-column]') ?? [])].map(item => [item.dataset.proxyGeoColumn, item.getAttribute('role'), item.getAttribute('aria-checked'), item.textContent.trim()]), base: [...document.querySelectorAll('[data-proxy-column-toggle]')].map(item => item.dataset.proxyColumnToggle), reset: Boolean(document.querySelector('[data-proxy-view-reset]')) }; });
  assert.equal(menu.label, 'Geolocation (API)'); assert.deepEqual(menu.items, [['geo', 'menuitemcheckbox', 'true', 'Location'], ['geonet', 'menuitemcheckbox', 'true', 'Network'], ['geokind', 'menuitemcheckbox', 'true', 'Address type'], ['geoflags', 'menuitemcheckbox', 'true', 'Flags'], ['geotime', 'menuitemcheckbox', 'true', 'Time']]);
  assert.deepEqual(menu.base, ['type', 'address', 'country', 'linked', 'check', 'ip', 'checked'], 'the base group is unchanged (the linked entry exists once the links record can be read)'); assert.equal(menu.reset, true);
  const viewBefore = await local.get(VIEW_KEY), settingsBefore = JSON.stringify(await readStorage(SETTINGS_KEY));
  await opened.click('[data-proxy-geo-column="geoflags"]'); await until(async () => !(await heads()).includes('geoflags'), 'geoflags hidden', 15000);
  assert.deepEqual((await readStorage(SETTINGS_KEY)).columns, ['geo', 'geonet', 'geokind', 'geotime'], 'the choice is stored with the geolocation settings'); assert.equal(await local.get(VIEW_KEY), viewBefore, 'and never in the stored view'); assert.equal((await colcounts()).colcount, 13);
  await navigate(); assert.deepEqual((await heads()).filter(head => head.startsWith('geo')), ['geo', 'geonet', 'geokind', 'geotime'], 'it persists across a reload');
  await openMenu('columns'); assert.equal(await opened.evaluate(() => document.querySelector('[data-proxy-geo-column="geoflags"]').getAttribute('aria-checked')), 'false');
  await opened.click('[data-proxy-column-toggle="ip"]'); await until(async () => !(await heads()).includes('ip'), 'ip hidden');
  assert.deepEqual(await readStorage(SETTINGS_KEY), { ...JSON.parse(settingsBefore), columns: ['geo', 'geonet', 'geokind', 'geotime'] }, 'a base column choice leaves the geolocation settings alone'); assert.notEqual(await local.get(VIEW_KEY), viewBefore, 'it goes to the stored view');
  await openMenu('columns'); await opened.click('[data-proxy-column-toggle="ip"]'); await openMenu('columns'); await opened.click('[data-proxy-geo-column="geoflags"]'); await until(async () => (await heads()).includes('geoflags'), 'geoflags back', 15000);
  assert.deepEqual((await heads()).filter(head => head.startsWith('geo')), GEO_COLUMNS, 'canonical order again');
  check('the columns menu has a second group "Geolocation (API)" with five checkbox items; a choice is stored with the geolocation settings (not the view), persists across a reload and returns in canonical order; base column choices keep their own stored view');

  phase = 'switch off';
  const withGeo = await colcounts();
  await setStorage({ [SETTINGS_KEY]: settingsOf({ enabled: false }) }); await until(async () => (await heads()).every(head => !head.startsWith('geo')), 'columns gone', 15000);
  assert.deepEqual(await heads(), BASE_HEADS); assert.deepEqual(await colcounts(), baseline.counts); assert.equal(await banner(), null, 'the invitation stays dismissed'); assert.equal(await exists('[data-proxy-geo-detail]'), false); assert.equal(await exists('[data-proxy-geo-lookup]'), false);
  await openMenu('columns'); assert.equal(await exists('[data-proxy-geo-column]'), false); await opened.click('[data-proxy-menu="columns"]');
  await setStorage({ [SETTINGS_KEY]: settingsOf() }); await until(async () => (await heads()).filter(head => head.startsWith('geo')).length === 5, 'columns back', 15000); assert.deepEqual(await colcounts(), withGeo);
  check('switching the feature off on the settings side removes the five columns, the group, the details block and every lookup button from the open manager at once (and back on restores them); nothing else changes');

  // ---- Layouts ---------------------------------------------------------------------------------------------------------------------------------
  phase = 'layouts';
  await setStorage({ [CACHE_KEY]: staleCache() }); await navigate(); await until(async () => (await phaseOf(ID(1))) === 'data', 'seeded records are shown', 15000);
  const ladder = { 1920: ['select', 'name', 'address', 'check', 'ip', ...GEO_COLUMNS], 1180: ['select', 'name', 'address', 'check', 'geo'] };
  for (const language of ['en', 'ru', 'ar']) for (const theme of chrome ? ['system-light', 'system-dark'] : ['pearl', 'system-dark']) for (const width of [1920, 1180, 580, 340]) {
    await arrange({ theme, language, width, height: 900 });
    const layout = await opened.evaluate(() => ({ width: innerWidth, overflow: document.documentElement.scrollWidth - innerWidth, direction: getComputedStyle(document.querySelector('[data-proxy-workspace]')).direction, dark: matchMedia('(prefers-color-scheme: dark)').matches, cards: getComputedStyle(document.querySelector('.pm-row--head')).display === 'none' }));
    assert.ok(layout.overflow <= 0, language + '/' + theme + '/' + width + ': no horizontal overflow (' + layout.overflow + ')'); assert.equal(layout.direction, language === 'ar' ? 'rtl' : 'ltr');
    const shown = await visibleHeads();
    if (width >= 1180) { for (const column of ladder[width]) assert.ok(shown.includes(column), width + ': ' + column + ' is shown (' + shown.join(',') + ')'); assert.equal(layout.cards, false); }
    else {
      assert.equal(layout.cards, true, width + ': cards');
      const meta = await opened.evaluate(id => { const row = document.querySelector('[data-proxy-profile="' + id + '"]'), name = row.querySelector('[data-proxy-open]').getBoundingClientRect(), cells = [...row.querySelectorAll('.pm-meta > [data-col^="geo"]')].filter(cell => cell.getClientRects().length); return { shown: cells.map(cell => cell.dataset.col), stacked: cells.every(cell => cell.getBoundingClientRect().top >= name.bottom - 2), inside: cells.every(cell => { const box = cell.getBoundingClientRect(); return box.left >= -1 && box.right <= innerWidth + 1; }) }; }, ID(1));
      assert.ok(meta.shown.length >= 1 && meta.stacked && meta.inside, width + ' ' + language + ': geolocation lines sit in the card meta area and inside the screen (' + JSON.stringify(meta) + ')');
    }
    evidence.layouts.push({ language, theme, width, overflow: layout.overflow, shown: shown.length, cards: layout.cards });
  }
  // density: comfortable and compact both lay the columns out without overflow; compact rows are not taller
  for (const width of [1920, 1180]) {
    await arrange({ theme: chrome ? 'system-light' : 'pearl', language: 'en', width, height: 900 });
    const heightOf = () => opened.evaluate(id => ({ row: document.querySelector('[data-proxy-profile="' + id + '"]').getBoundingClientRect().height, overflow: document.documentElement.scrollWidth - innerWidth, density: document.querySelector('[data-proxy-table]').className.match(/pm-density--(\w+)/)?.[1], shown: [...document.querySelectorAll('[data-proxy-table] [role="columnheader"]')].filter(head => head.getClientRects().length).map(head => head.dataset.col).filter(col => col.startsWith('geo')).length }), ID(1));
    await opened.click('[data-proxy-density-option="comfortable"]'); const comfortable = await heightOf();
    await opened.click('[data-proxy-density-option="compact"]'); await until(async () => (await heightOf()).density === 'compact', 'compact density'); const compact = await heightOf();
    assert.deepEqual([comfortable.density, compact.density], ['comfortable', 'compact']); assert.ok(comfortable.overflow <= 0 && compact.overflow <= 0, width + ': no overflow in either density');
    assert.ok(compact.row <= comfortable.row && compact.shown === comfortable.shown && compact.shown >= 1, width + ': compact rows are not taller (' + compact.row + ' <= ' + comfortable.row + '), same columns');
    if (width === 1920) await capture('geo-columns-compact-1920');
    await opened.click('[data-proxy-density-option="comfortable"]');
  }
  await arrange({ theme: chrome ? 'system-light' : 'pearl', language: 'en', width: 1920, height: 900 }); await capture('geo-columns-light-1920');
  await arrange({ theme: 'system-dark', language: 'ru', width: 1180, height: 900 }); await capture('geo-columns-dark-ru-1180');
  await arrange({ theme: chrome ? 'system-light' : 'pearl', language: 'ar', width: 340, height: 900 }); await capture('geo-cards-rtl-340');
  // the invitation and the reminder at every width, in light and dark, RTL included
  const noticeShots = [];
  for (const [state, over, credentials] of [['invite', { enabled: false }, CREDENTIALS], ['not-ready', {}, null]]) {
    await local.remove(BANNER_KEY); await enable(over, credentials); await until(async () => (await banner()) === state, state + ' notice', 15000);
    for (const language of ['en', 'ar']) for (const theme of chrome ? ['system-light', 'system-dark'] : ['pearl', 'system-dark']) for (const width of [1180, 580, 340]) {
      await arrange({ theme, language, width, height: 900 });
      const fit = await opened.evaluate(() => { const node = document.querySelector('[data-proxy-geo-banner]'), box = node.getBoundingClientRect(), link = node.querySelector('[data-proxy-geo-banner-link]').getBoundingClientRect(), dismiss = node.querySelector('[data-proxy-geo-banner-dismiss]')?.getBoundingClientRect() ?? null;
        return { overflow: document.documentElement.scrollWidth - innerWidth, inside: box.left >= -1 && box.right <= innerWidth + 1, linkTall: link.height, dismissSize: dismiss ? [dismiss.width, dismiss.height] : null, rtl: getComputedStyle(node).direction }; });
      assert.ok(fit.overflow <= 0 && fit.inside, state + ' ' + language + '/' + theme + '/' + width + ': the notice fits (' + JSON.stringify(fit) + ')'); assert.equal(fit.rtl, language === 'ar' ? 'rtl' : 'ltr');
      if (width < 700) { assert.ok(fit.linkTall >= 44, 'the link is a 44 px touch target on a phone (' + fit.linkTall + ')'); if (fit.dismissSize) assert.ok(fit.dismissSize[0] >= 44 && fit.dismissSize[1] >= 44, 'so is the dismiss button'); }
    }
    if (state === 'invite') { await arrange({ theme: chrome ? 'system-light' : 'pearl', language: 'en', width: 1180 }); await capture('geo-invitation-light-1180'); await arrange({ theme: 'system-dark', language: 'ar', width: 340 }); await capture('geo-invitation-dark-rtl-340'); }
    else { await arrange({ theme: chrome ? 'system-light' : 'pearl', language: 'en', width: 580 }); await capture('geo-reminder-light-580'); }
    noticeShots.push(state);
  }
  await local.remove(BANNER_KEY); await enable(); await until(async () => (await banner()) === (chrome ? null : 'not-ready') && (await heads()).filter(head => head.startsWith('geo')).length === 5, 'ready again', 15000);
  check('layouts: 1920/1180/580/340 px in English, Russian and Arabic (RTL), light and dark: no horizontal overflow; the list keeps location (and more as it widens) in the table, cards carry the geolocation lines in their meta area inside the screen; the invitation and the reminder fit every width with 44 px touch targets on a phone');

  // ---- Contrast in every theme ---------------------------------------------------------------------------------------------------------------
  if (chrome) {
    phase = 'contrast';
    const scopes = ['[data-proxy-geo-banner]', '[data-proxy-profile="p-001"]', '[data-proxy-profile="p-003"]', '[data-proxy-profile="p-005"]', '[data-proxy-geo-detail]', '[data-proxy-geo-confirm]', '.pm-menu'];
    let probed = 0;
    for (const theme of THEMES) {
      await arrange({ theme, language: 'en', width: 1920, height: 900 });
      // each state in turn: invitation, reminder, rows with data / error / lookup, details, confirmation, an open menu
      await local.remove(BANNER_KEY); await enable({ enabled: false }); await until(async () => (await banner()) === 'invite', 'invite', 15000); let result = await contrastOf('[data-proxy-geo-banner]'); evidence.contrast.push({ theme, scope: 'invite', seen: result.seen, failures: result.failures.length }); assert.deepEqual([result.failures, result.glyphFailures], [[], []], theme + ' invitation'); probed += result.seen.text;
      await enable({}, null); await until(async () => (await banner()) === 'not-ready', 'reminder', 15000); result = await contrastOf('[data-proxy-geo-banner]'); evidence.contrast.push({ theme, scope: 'reminder', seen: result.seen, failures: result.failures.length }); assert.deepEqual([result.failures, result.glyphFailures], [[], []], theme + ' reminder'); probed += result.seen.text;
      result = await contrastOf('[data-proxy-profile="p-001"] .pm-meta'); assert.deepEqual([result.failures, result.glyphFailures], [[], []], theme + ' a row without a provider'); probed += result.seen.text;
      await enable(); await until(async () => (await banner()) === null && (await exists('[data-proxy-geo-lookup]')), 'ready', 15000);
      result = await contrastOf('[data-proxy-profile="p-001"] .pm-meta'); evidence.contrast.push({ theme, scope: 'row with a lookup button', seen: result.seen, failures: result.failures.length }); assert.deepEqual([result.failures, result.glyphFailures], [[], []], theme + ' a row with a lookup button'); probed += result.seen.text;
      if (chrome) {
        await removeStorage([CACHE_KEY]);
        await opened.evaluate(async cache => { const api = globalThis.browser ?? globalThis.chrome; await api.storage.local.set({ [cache.key]: cache.value }); return true; }, { key: CACHE_KEY, value: staleCache() });
        await until(async () => (await phaseOf('p-001')) === 'data' && (await phaseOf('p-002')) === 'data', 'cache seeded', 15000);
        for (const id of ['p-001', 'p-002', 'p-004']) { result = await contrastOf('[data-proxy-profile="' + id + '"] .pm-meta'); evidence.contrast.push({ theme, scope: 'row ' + id, seen: result.seen, failures: result.failures.length }); assert.deepEqual([result.failures, result.glyphFailures], [[], []], theme + ' row ' + id + ' (data' + (id === 'p-002' ? ', stale' : '') + ')'); probed += result.seen.text; }
        await openPeek('p-001'); result = await contrastOf('[data-proxy-geo-detail]'); assert.deepEqual([result.failures, result.glyphFailures], [[], []], theme + ' details'); probed += result.seen.text; await closePeek();
        await openMenu('list'); await opened.click('[data-proxy-geo-lookup-all]'); if (await exists('[data-proxy-geo-confirm]')) { result = await contrastOf('[data-proxy-geo-confirm]'); assert.deepEqual([result.failures, result.glyphFailures], [[], []], theme + ' confirmation'); probed += result.seen.text; await opened.click('[data-proxy-geo-confirm-no]'); }
        await openMenu('columns'); result = await contrastOf('.pm-menu'); assert.deepEqual([result.failures, result.glyphFailures], [[], []], theme + ' columns menu with the geolocation group'); probed += result.seen.text; await opened.click('[data-proxy-menu="columns"]');
        await removeStorage([CACHE_KEY]);
      }
    }
    await local.remove(BANNER_KEY); await enable();
    assert.ok(probed > 300, 'the probe looked at ' + probed + ' text nodes');
    check('AA contrast (4.5:1 text, 3:1 glyphs) of the invitation, the reminder, rows in every cell state, the details, the confirmation and the menu groups in all seven themes: 0 failures over ' + probed + ' text nodes');
  }

  // ---- Secrets and logs --------------------------------------------------------------------------------------------------------------------------
  phase = 'secrets';
  await arrange({ theme: chrome ? 'system-light' : 'pearl', language: 'en', width: 1180, height: 900 });
  assert.equal(KEY_PATTERN.test(await opened.evaluate(() => document.documentElement.outerHTML)), false, 'no key in the page');
  assert.equal(await opened.evaluate(() => [...document.querySelectorAll('input,textarea')].some(field => /CANARY/.test(field.value))), false);
  const proxyStorage = JSON.stringify([await readStorage('proxy-configuration:v1'), await readStorage('proxy-check-history:v1')]); assert.equal(KEY_PATTERN.test(proxyStorage), false, 'the proxy configuration and the check history hold no key'); assert.doesNotMatch(proxyStorage, /geoip|maxmind/i, 'and no geolocation data');
  if (chrome) {
    const logs = consoleLines.filter(line => !/Failed to load resource/.test(line)); assert.equal(logs.some(line => KEY_PATTERN.test(line)), false, 'no key in any console line'); assert.deepEqual(logs.filter(line => /^(error|pageerror)/.test(line)), [], 'a clean console');
    assert.deepEqual(unexpected, [], 'no request left the extension except to the six provider hosts'); evidence.requests = requests.map(request => ({ method: request.method, host: request.host, path: request.path }));
  }
  check('no key, account number or Authorization value appears in the page, a field, the proxy configuration, the check history or a console line; the console is clean' + (chrome ? '; nothing but the six provider hosts was requested' : ''));
  evidence.result = 'PASS';
} catch (error) {
  evidence.result = 'FAIL'; evidence.failure = { phase, message: String(error?.message ?? error).slice(0, 1500) };
  if (opened) try { await opened.screenshot(join(shots, browser + '-failure.png')); } catch { /* the page may be gone */ }
  console.error('FAIL in ' + phase + ': ' + String(error?.stack ?? error).slice(0, 2500));
  if (consoleLines.length) console.error('console (last 12): ' + consoleLines.slice(-12).map(line => line.replace(KEY_PATTERN, '[key]').slice(0, 300)).join(' | '));
  if (unexpected.length) console.error('unexpected requests: ' + unexpected.join(' '));
  process.exitCode = 1;
} finally {
  writeFileSync(join(run, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  if (opened) await opened.close().catch(() => {});
}
console.log(evidence.result + ' ' + browser + ' ' + evidence.checks.length + ' checks; evidence ' + join(run, 'evidence.json'));

function staleCache() {
  const now = Date.now(), record = (ip, patch) => ({ provider: 'maxmind', service: 'geoip-insights', at: now - 5 * 60000, ip, country: 'US', countryName: 'United States', region: 'California', city: 'Mountain View', timezone: 'America/Los_Angeles', asn: 15169, org: 'Google LLC', isp: 'Google Fiber', kind: 'hosting', flags: { proxy: true, vpn: false, tor: false, hosting: true, mobile: null, relay: null, residentialProxy: false, threat: null }, ...patch });
  return { version: 1, items: { '8.8.8.8': record('8.8.8.8'), '1.1.1.1': record('1.1.1.1', { at: now - 26 * 3600000, country: 'AU', countryName: 'Australia', region: 'New South Wales', city: 'Sydney', timezone: 'Australia/Sydney', asn: 13335, org: 'Cloudflare, Inc.', isp: '' }) } };
}
