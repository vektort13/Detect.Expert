// ADR-109: the Proxy Manager Geolocation API settings page in a real, owned, disposable browser, with the extension staged FROM SOURCE into a
// private run folder (.tmp/proxy-geo-settings-<browser>-*; never dist/ or release/). Evidence and screenshots stay in that folder.
//   node scripts/test/proxy-geo-settings-native.mjs             Chrome (Playwright Chromium): the full run, provider replies are canned
//   node scripts/test/proxy-geo-settings-native.mjs --firefox   Firefox: markup, hooks, storage areas, CSP, themes, layout. Firefox is driven over
//                                                               WebDriver, which cannot answer a request, so nothing is ever asked of a provider
//                                                               there: the check is that nothing leaves the page without a trigger.
// No real provider is contacted. In Chrome every provider host is answered by page.route with a canned reply and any other address is refused;
// the keys are fixtures. An extension page sends no cookie header and no Referer by itself, and the Cookie header is added below the layer
// page.route sees, so those two checks are weak by nature: the request options (credentials omit, no-referrer) belong to the client's unit test.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stageExtension } from './native-evidence.mjs';
import { launchOwnedManagement, until, pause } from './management-browser-fixture.mjs';
import { GEO_CACHE_KEY, GEO_CREDENTIALS_KEY, GEO_FLAGS, GEO_PROVIDERS, GEO_PROVIDER_INFO, GEO_SETTINGS_KEY, GEO_TEST_IP, emptyGeoCache, geoCachePut, geoConnectOrigins } from '../../apps/production-extension/proxy-geo-shared.js';
import { PROXY_GEO_SETTINGS_MESSAGES, proxyGeoFill } from '../../apps/production-extension/proxy-geo-settings-labels.js';

const root = resolve(import.meta.dirname, '../..');
const browser = process.argv.includes('--firefox') ? 'firefox' : 'chrome', isChrome = browser === 'chrome';
const EN = PROXY_GEO_SETTINGS_MESSAGES.en, RU = PROXY_GEO_SETTINGS_MESSAGES.ru, PAGE = 'proxy-geo-settings.html';
mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/proxy-geo-settings-' + browser + '-')), extension = join(run, 'extension'), shots = join(run, 'screenshots');
mkdirSync(shots, { recursive: true });
await stageExtension({ browser, target: extension, from: 'source' });
const evidence = { at: new Date().toISOString(), browser, run, extensionSource: 'source', result: 'RUNNING', realNetwork: false, checks: [], requests: [], layouts: [], contrast: [], screenshots: [], notes: [] };
const check = name => { evidence.checks.push(name); console.log('  ok ' + name); };

// ---- Fixtures: fake keys and canned replies --------------------------------------------------------------------------------------
const KEYS = Object.freeze({ accountId: '4242424', licenseKey: 'FIXTURE-licence-key-aaaa1111', ipgeolocation: 'FIXTURE-ipgeo-key-bbbb2222', ipdata: 'FIXTURE-ipdata-key-cccc3333', ipapi: 'FIXTURE-ipapi-key-dddd4444' });
const SECRETS = Object.freeze(Object.values(KEYS));
const GOOGLE = 'Google LLC', HOSTILE = 'Mountain View <img src=x onerror=alert(1)>', SUMMARY = 'United States · Mountain View · ' + GOOGLE, HOSTILE_SUMMARY = 'United States · ' + HOSTILE + ' · ' + GOOGLE;
const CANNED = {
  'geolite.info': { type: 'application/vnd.maxmind.com-city+json; charset=UTF-8; version=2.1', body: { country: { iso_code: 'US', names: { en: 'United States' } }, city: { names: { en: 'Mountain View' } }, subdivisions: [{ names: { en: 'California' } }],
    location: { time_zone: 'America/Los_Angeles' }, traits: { ip_address: GEO_TEST_IP, autonomous_system_number: 15169, autonomous_system_organization: GOOGLE }, maxmind: { queries_remaining: 4321 } } },
  'api.ipgeolocation.io': { type: 'application/json', body: { ip: GEO_TEST_IP, location: { country_code2: 'US', country_name: 'United States', state_prov: 'California', city: 'Mountain View' }, time_zone: { name: 'America/Los_Angeles' }, asn: { as_number: 'AS15169', organization: GOOGLE, type: 'HOSTING' } } },
  'api.ipdata.co': { type: 'application/json', body: { ip: GEO_TEST_IP, city: HOSTILE, region: 'California', country_name: 'United States', country_code: 'US', asn: { asn: 'AS15169', name: GOOGLE, type: 'hosting' }, time_zone: { name: 'America/Los_Angeles' } } },
  'ip-api.com': { type: 'application/json', body: { status: 'success', country: 'United States', countryCode: 'US', regionName: 'California', city: 'Mountain View', timezone: 'America/Los_Angeles', isp: GOOGLE, org: 'Google Public DNS', as: 'AS15169 ' + GOOGLE, query: GEO_TEST_IP }, headers: { 'x-rl': '43', 'x-ttl': '60' } },
};
CANNED['geoip.maxmind.com'] = CANNED['geolite.info']; CANNED['pro.ip-api.com'] = CANNED['ip-api.com']; Object.freeze(CANNED);
assert.deepEqual(Object.keys(CANNED).sort(), geoConnectOrigins().map(origin => new URL(origin).host).sort(), 'the fixture answers exactly the hosts the CSP allows');
const CONTROL = '/csp-control';

// ---- Browser ---------------------------------------------------------------------------------------------------------------------
const requests = [];
let opened = null;
const decodeBasic = value => { const match = /^Basic (.+)$/.exec(value ?? ''); return match ? Buffer.from(match[1], 'base64').toString('utf8') : null; };
async function answer(route) {
  const request = route.request(), url = new URL(request.url()), headers = await request.allHeaders(), canned = CANNED[url.host];
  requests.push({ method: request.method(), scheme: url.protocol, host: url.host, path: url.pathname, query: Object.fromEntries(url.searchParams), authorization: headers.authorization ?? null,
    cookie: headers.cookie ?? null, referer: headers.referer ?? null, userAgent: Boolean(headers['user-agent']), url: request.url() });
  if (!canned) return route.abort('blockedbyclient');
  return route.fulfill({ status: 200, headers: { 'content-type': canned.type, 'access-control-allow-origin': '*', ...(canned.headers ?? {}) }, body: JSON.stringify(canned.body) });
}
async function launch(options = {}) {
  opened = await launchOwnedManagement({ root, run, extension, browser, evidence, userScripts: false, dark: false, ...options });
  if (isChrome) await opened.context.route(/^https?:\/\//, answer);
  evidence.version = opened.version;
  return opened;
}
const get = (fn, value) => opened.evaluate(fn, value);
const storageArea = (area, key) => get(async ({ area, key }) => { const api = globalThis.browser ?? globalThis.chrome; return JSON.stringify(await api.storage[area].get(key ?? null)); }, { area, key });
const areas = async () => ({ local: await storageArea('local'), session: await storageArea('session') });
const ready = () => until(() => get(() => document.querySelector('#proxy-geo-settings')?.getAttribute('aria-busy') === 'false'), 'page ready');
// Firefox cannot answer requests, so it counts them instead: any request to an http(s) address from anywhere in the browser is one.
async function countRequests() {
  await get(() => { const api = globalThis.browser, node = document.documentElement; node.dataset.geoRequests = '0'; node.dataset.geoHosts = ''; api.webRequest.onBeforeRequest.addListener(details => { node.dataset.geoRequests = String(Number(node.dataset.geoRequests) + 1); node.dataset.geoHosts += new URL(details.url).host + ' '; }, { urls: ['http://*/*', 'https://*/*'] }); });
}
const seen = () => (isChrome ? Promise.resolve(requests.length) : get(() => Number(document.documentElement.dataset.geoRequests)));
async function openPage(language = 'en') {
  await opened.goto(opened.base + PAGE); await ready();
  if (!isChrome) await countRequests();
  await setLanguage(language);
}
async function setLanguage(id) {
  await get(async id => { await (globalThis.browser ?? globalThis.chrome).storage.local.set({ 'ui-language-v1': id }); }, id);
  await until(() => get(id => document.querySelector('#pg-language')?.value === id, id), 'language ' + id);
}
const text = selector => get(selector => document.querySelector(selector)?.textContent ?? null, selector);
const attribute = (selector, name) => get(({ selector, name }) => document.querySelector(selector)?.getAttribute(name) ?? null, { selector, name });
const card = id => '[data-geo-provider="' + id + '"] ';
const settled = selector => until(() => get(selector => ['ok', 'error'].includes(document.querySelector(selector)?.getAttribute('data-kind')), selector), 'a result in ' + selector);
const idle = () => until(() => get(() => document.querySelector('#proxy-geo-settings')?.getAttribute('aria-busy') === 'false'), 'idle');
const click = async selector => { await opened.click(selector); };
const press = name => (isChrome ? opened.context.pages().find(page => page.url().endsWith(PAGE)).keyboard.press(name) : get(name => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true })), name));
const forgetResult = id => get(id => document.querySelector('[data-geo-provider="' + id + '"] [data-geo-result]').removeAttribute('data-kind'), id);
const chooseService = service => get(service => { const select = document.querySelector('[data-geo-opt="service"]'); select.value = service; select.dispatchEvent(new Event('change', { bubbles: true })); }, service);
const channel = value => { const s = value / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const luminance = ({ r, g, b }) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const contrast = (a, b) => { const hi = Math.max(luminance(a), luminance(b)), lo = Math.min(luminance(a), luminance(b)); return (hi + 0.05) / (lo + 0.05); };
function colour(value) {
  const rgb = /^rgba?\(([^)]+)\)$/.exec(value), srgb = /^color\(srgb ([^)]+)\)$/.exec(value);
  if (rgb) { const [r, g, b, a = 1] = rgb[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r, g, b, a }; }
  if (srgb) { const [r, g, b, a = 1] = srgb[1].split(/[ /]+/).map(Number); return { r: r * 255, g: g * 255, b: b * 255, a }; }
  throw new Error('unsupported colour ' + value);
}

async function structure() {
  assert.equal(await get(() => performance.getEntriesByType('resource').filter(entry => /^https?:/.test(entry.name)).length), 0, 'the page loaded without a network request of its own');
  if (isChrome) assert.equal(requests.length, 0, 'and none reached the network layer');
  assert.equal(await get(() => document.title), 'Proxy Manager Geolocation API · Detect.Expert');
  assert.equal(await text('h1'), 'Proxy Manager Geolocation API');
  assert.equal(await text('[data-geo-state]'), EN.state_off); assert.equal(await attribute('[data-geo-master]', 'aria-checked'), 'false');
  assert.deepEqual(await get(() => [...document.querySelectorAll('[data-geo-provider]')].map(node => node.dataset.geoProvider)), GEO_PROVIDERS);
  assert.deepEqual(await get(() => [...document.querySelectorAll('[data-geo-option]')].map(node => node.dataset.geoOption)), ['auto', 'failover', 'remember']);
  const found = await get(() => ({
    star: [...document.querySelectorAll('[data-geo-star]')].map(node => node.closest('[data-geo-provider]')?.dataset.geoProvider ?? null),
    starName: document.querySelector('[data-geo-star]')?.getAttribute('aria-label'), starRole: document.querySelector('[data-geo-star]')?.getAttribute('role'),
    caption: document.querySelector('[data-geo-provider="maxmind"] .pg-star-caption')?.textContent,
    docs: [...document.querySelectorAll('[data-geo-docs]')].map(node => [node.closest('[data-geo-provider]').dataset.geoProvider, node.getAttribute('href'), node.getAttribute('target'), node.getAttribute('rel'), node.textContent]),
    fields: [...document.querySelectorAll('[data-geo-field]')].map(node => [node.dataset.geoField, node.type, node.autocomplete, node.getAttribute('spellcheck'), node.getAttribute('dir'), node.maxLength]),
    opts: [...document.querySelectorAll('[data-geo-opt]')].map(node => [node.closest('[data-geo-provider]').dataset.geoProvider, node.dataset.geoOpt, node.localName]),
    hooks: ['[data-geo-master]', '[data-geo-state]', '[data-geo-message]', '[data-geo-clear-cache]', '[data-geo-forget-all]', ...['reveal', 'save', 'test', 'forget', 'status', 'enabled'].map(name => '[data-geo-' + name + ']')].map(selector => [selector, document.querySelectorAll(selector).length]),
    remote: document.querySelectorAll('#proxy-geo-settings [src], #proxy-geo-settings img, #proxy-geo-settings iframe, #proxy-geo-settings link').length,
    roles: [document.querySelector('[data-geo-message]').getAttribute('role'), document.querySelector('[data-geo-master]').getAttribute('role')],
  }));
  assert.deepEqual(found.star, ['maxmind'], 'the gold star is in the MaxMind card and nowhere else');
  assert.deepEqual([found.starRole, found.starName, found.caption], ['img', 'Recommended', 'Recommended']);
  assert.deepEqual(found.docs.map(row => row.slice(0, 2)), GEO_PROVIDERS.map(id => [id, GEO_PROVIDER_INFO[id].docsUrl]));
  assert.ok(found.docs.every(row => row[2] === '_blank' && row[3] === 'noopener noreferrer' && row[4] === 'Documentation'));
  assert.deepEqual(found.fields.map(row => row[0]), ['accountId', 'licenseKey', 'apiKey', 'apiKey', 'apiKey']);
  assert.ok(found.fields.every(row => row[1] === 'password' && row[2] === 'off' && row[3] === 'false' && row[4] === 'ltr' && row[5] === 256));
  assert.deepEqual(found.opts, [['maxmind', 'service', 'select'], ['ipgeolocation', 'security', 'input'], ['ipapi', 'http', 'input']]);
  assert.ok(found.hooks.every(([selector, count]) => count >= 1), JSON.stringify(found.hooks)); assert.equal(found.remote, 0); assert.deepEqual(found.roles, ['alert', 'switch']);
  await opened.goto(opened.base + PAGE + '?token=abc&x=1#integrations'); await ready(); if (!isChrome) await countRequests();
  assert.equal(await get(() => document.title), 'Proxy Manager Geolocation API · Detect.Expert'); assert.equal(await text('[data-geo-state]'), EN.state_off, 'a query and a hash change nothing');
  check('page opens from source: title, heading, hooks, four providers in order, the star only in the MaxMind card with a name and a caption, docs links, password fields; opened directly with a query and a hash it is the same');
}

async function silenceUntilTriggered() {
  const before = await seen();
  await click('[data-geo-master]'); await idle();
  assert.equal(await attribute('[data-geo-master]', 'aria-checked'), 'true'); assert.equal(await text('[data-geo-state]'), EN.state_no_key);
  for (const option of ['auto', 'failover']) { await click('[data-geo-option="' + option + '"]'); await idle(); await click('[data-geo-option="' + option + '"]'); await idle(); }
  for (const id of GEO_PROVIDERS) { await click(card(id) + '[data-geo-enabled]'); await idle(); assert.equal(await attribute(card(id) + '[data-geo-enabled]', 'aria-checked'), 'true'); }
  await opened.fill(card('maxmind') + '[data-geo-field="accountId"]', KEYS.accountId); await opened.fill(card('maxmind') + '[data-geo-field="licenseKey"]', KEYS.licenseKey);
  await click(card('maxmind') + '[data-geo-save]'); await idle();
  for (const id of ['ipgeolocation', 'ipdata']) { await opened.fill(card(id) + '[data-geo-field="apiKey"]', KEYS[id]); await click(card(id) + '[data-geo-save]'); await idle(); }
  await pause(700);
  assert.equal(await seen(), before, 'no request while switching, typing and saving');
  assert.equal(await text('[data-geo-state]'), proxyGeoFill(EN.state_ready, { list: 'MaxMind GeoIP / GeoLite, ipgeolocation.io, ipdata' }));
  for (const id of ['maxmind', 'ipgeolocation', 'ipdata']) {
    assert.equal(await text(card(id) + '[data-geo-result]'), EN.result_saved); assert.equal(await text(card(id) + '[data-geo-key]'), EN.key_saved);
    assert.equal(await get(selector => [...document.querySelectorAll(selector + ' [data-geo-field]')].every(node => node.value === ''), card(id).trim()), true, 'the fields are empty after Save');
  }
  const everything = await get(() => document.body.innerText + '\n' + [...document.querySelectorAll('*')].flatMap(node => [...node.attributes].map(attr => attr.value)).join('\n'));
  assert.ok(SECRETS.every(secret => !everything.includes(secret) && !everything.includes(secret.slice(0, 8)) && !everything.includes(secret.slice(-8))), 'no part of a saved key is anywhere in the page');
  check('master, options, providers, typing and Save send nothing (0 requests); Save clears the fields and echoes nothing');
}

async function testEveryProvider() {
  const first = requests.length;
  const fresh = async (provider, work) => { const before = requests.length; await forgetResult(provider); await work(); await settled(card(provider) + '[data-geo-result]'); return requests.slice(before); };
  const summary = proxyGeoFill(EN.test_ok, { ip: GEO_TEST_IP, summary: SUMMARY });
  let sent = await fresh('maxmind', () => click(card('maxmind') + '[data-geo-test]'));
  assert.equal(sent.length, 1); assert.deepEqual([sent[0].method, sent[0].scheme, sent[0].host, sent[0].path, sent[0].query], ['GET', 'https:', 'geolite.info', '/geoip/v2.1/city/' + GEO_TEST_IP, {}]);
  assert.equal(decodeBasic(sent[0].authorization), KEYS.accountId + ':' + KEYS.licenseKey, 'Basic: account ID and license key'); assert.ok(!sent[0].url.includes(KEYS.licenseKey), 'the license key is not in the address');
  assert.equal(await text(card('maxmind') + '[data-geo-result]'), summary); assert.equal(await attribute(card('maxmind') + '[data-geo-status]', 'data-status'), 'ok');
  assert.ok((await text(card('maxmind') + '[data-geo-status]')).includes(proxyGeoFill(EN.status_remaining, { n: '4,321' })), 'the quota the provider reported is shown: ' + await text(card('maxmind') + '[data-geo-status]'));
  assert.equal(await get(() => document.activeElement?.hasAttribute('data-geo-test')), true, 'the Test button lost the focus while it was disabled and got it back');
  for (const [service, path] of [['geoip-city', '/geoip/v2.1/city/'], ['geoip-insights', '/geoip/v2.1/insights/']]) {
    await chooseService(service); await idle();
    sent = await fresh('maxmind', () => click(card('maxmind') + '[data-geo-test]'));
    assert.deepEqual([sent.length, sent[0].host, sent[0].path], [1, 'geoip.maxmind.com', path + GEO_TEST_IP], service);
  }
  await chooseService('geolite-city'); await idle();
  sent = await fresh('ipgeolocation', () => click(card('ipgeolocation') + '[data-geo-test]'));
  assert.deepEqual([sent.length, sent[0].method, sent[0].host, sent[0].path, sent[0].query, sent[0].authorization], [1, 'GET', 'api.ipgeolocation.io', '/v3/ipgeo', { apiKey: KEYS.ipgeolocation, ip: GEO_TEST_IP }, null]);
  assert.equal(await text(card('ipgeolocation') + '[data-geo-result]'), summary); assert.equal(await attribute(card('ipgeolocation') + '[data-geo-status]', 'data-status'), 'ok');
  await click(card('ipgeolocation') + '[data-geo-opt="security"]'); await idle();
  sent = await fresh('ipgeolocation', () => click(card('ipgeolocation') + '[data-geo-test]'));
  assert.deepEqual([sent[0].query.include, sent[0].query.apiKey], ['security', KEYS.ipgeolocation], 'security data is asked only when the box is ticked');
  await click(card('ipgeolocation') + '[data-geo-opt="security"]'); await idle();
  sent = await fresh('ipdata', () => click(card('ipdata') + '[data-geo-test]'));
  assert.deepEqual([sent.length, sent[0].method, sent[0].host, sent[0].path, sent[0].query, sent[0].authorization], [1, 'GET', 'api.ipdata.co', '/' + GEO_TEST_IP, { 'api-key': KEYS.ipdata }, null]);
  assert.equal(await text(card('ipdata') + '[data-geo-result]'), proxyGeoFill(EN.test_ok, { ip: GEO_TEST_IP, summary: HOSTILE_SUMMARY }), 'provider text that looks like markup is shown as the text it is');
  assert.equal(await get(() => document.querySelectorAll('#proxy-geo-settings img, #proxy-geo-settings [onerror]').length), 0, 'and creates no element');
  // ip-api: the free endpoint needs the user's say-so; with a key the HTTPS Pro address is used
  const beforeFree = requests.length;
  await click(card('ipapi') + '[data-geo-test]'); await settled(card('ipapi') + '[data-geo-result]');
  assert.equal(await text(card('ipapi') + '[data-geo-result]'), EN.error_http_not_allowed); assert.equal(requests.length, beforeFree, 'plain HTTP is not used without the tick');
  assert.equal(await text(card('ipapi') + '[data-geo-status]'), EN.error_http_not_allowed, 'the card also says it before any test');
  await click(card('ipapi') + '[data-geo-opt="http"]'); await idle();
  sent = await fresh('ipapi', () => click(card('ipapi') + '[data-geo-test]'));
  assert.deepEqual([sent.length, sent[0].method, sent[0].scheme, sent[0].host, sent[0].path, sent[0].authorization], [1, 'GET', 'http:', 'ip-api.com', '/json/' + GEO_TEST_IP, null]); assert.ok(!('key' in sent[0].query), 'no key on the free endpoint');
  assert.ok((await text(card('ipapi') + '[data-geo-status]')).includes(proxyGeoFill(EN.status_remaining, { n: '43' })), 'the X-Rl header becomes the quota left: ' + await text(card('ipapi') + '[data-geo-status]'));
  await opened.fill(card('ipapi') + '[data-geo-field="apiKey"]', KEYS.ipapi);
  sent = await fresh('ipapi', () => click(card('ipapi') + '[data-geo-test]'));
  assert.deepEqual([sent.length, sent[0].scheme, sent[0].host, sent[0].path, sent[0].query.key, sent[0].authorization], [1, 'https:', 'pro.ip-api.com', '/json/' + GEO_TEST_IP, KEYS.ipapi, null], 'a key typed but not saved is saved first and the Pro address is used');
  assert.equal(await text(card('ipapi') + '[data-geo-key]'), EN.key_saved);
  const tested = requests.slice(first);
  assert.ok(tested.every(entry => entry.method === 'GET' && entry.cookie === null && entry.referer === null && entry.userAgent), 'GET only, no cookie header, no Referer');
  assert.ok(tested.filter(entry => entry.authorization).length === 3 && tested.every(entry => !entry.authorization || entry.host.endsWith('maxmind.com') || entry.host === 'geolite.info'), 'only MaxMind uses the Authorization header');
  for (const entry of tested) for (const secret of SECRETS) if (entry.url.includes(secret)) assert.ok(['apiKey', 'api-key', 'key'].some(name => entry.query[name] === secret), 'a key is in the address only as the documented query parameter: ' + entry.host);
  for (const id of ['ipdata', 'ipapi']) assert.equal(await attribute(card(id) + '[data-geo-status]', 'data-status'), 'ok', id);
  evidence.requests = tested.map(entry => ({ method: entry.method, url: entry.url.replace(/(apiKey|api-key|key)=[^&]+/, '$1=<fixture>'), authorization: entry.authorization ? 'Basic <fixture>' : null, cookie: entry.cookie, referer: entry.referer }));
  check('Test key of each provider: GET only, documented address and parameter or Basic header, canned reply shown as country, city, organisation; plain HTTP only after the tick; no cookie, no Referer');
}

// Firefox cannot answer, so it only proves the local refusals: no key and plain HTTP, neither of which sends anything.
async function testWithoutAnswers() {
  const before = await seen();
  await click(card('ipapi') + '[data-geo-test]'); await settled(card('ipapi') + '[data-geo-result]');
  assert.equal(await text(card('ipapi') + '[data-geo-result]'), EN.error_http_not_allowed); assert.equal(await text(card('ipapi') + '[data-geo-status]'), EN.error_http_not_allowed);
  await click(card('ipapi') + '[data-geo-enabled]'); await idle();
  await click(card('ipapi') + '[data-geo-test]'); await settled(card('ipapi') + '[data-geo-result]');
  assert.equal(await seen(), before, 'a refused test sends nothing');
  check('Firefox: Test key with plain HTTP not allowed is refused in words and sends nothing');
}

async function contentSecurityPolicy() {
  const outcome = await get(async ({ control }) => {
    const violations = [], results = {};
    document.addEventListener('securitypolicyviolation', event => violations.push({ directive: event.violatedDirective, blocked: event.blockedURI }));
    for (const [name, url] of [['unlisted', 'https://remote.example/x'], ['unlisted-http', 'http://remote.example/x']]) {
      try { const response = await fetch(url, { credentials: 'omit' }); results[name] = 'resolved ' + response.status; } catch (error) { results[name] = error.name; }
    }
    if (control) { try { const response = await fetch('https://api.ipdata.co' + control, { credentials: 'omit' }); results.control = 'resolved ' + response.status; } catch (error) { results.control = error.name; } }
    await new Promise(resolve => setTimeout(resolve, 150));
    return { results, violations };
  }, { control: isChrome ? CONTROL : null });
  assert.equal(outcome.results.unlisted, 'TypeError'); assert.equal(outcome.results['unlisted-http'], 'TypeError');
  assert.ok(outcome.violations.length >= 2 && outcome.violations.every(item => item.directive.startsWith('connect-src')), JSON.stringify(outcome.violations));
  if (isChrome) {
    assert.equal(outcome.results.control, 'resolved 200', 'an address on the list is allowed');
    assert.equal(requests.filter(entry => entry.host === 'remote.example').length, 0, 'the refused request never reached the network layer'); assert.equal(requests.filter(entry => entry.path === CONTROL).length, 1);
  } else assert.equal(await get(() => document.documentElement.dataset.geoHosts.includes('remote.example')), false, 'no request to the unlisted host');
  check('a fetch to an address that is not on the list is refused by the CSP (connect-src)' + (isChrome ? ', one on the list is not' : ''));
}

async function whereKeysLive() {
  if (!isChrome) {
    await opened.fill(card('maxmind') + '[data-geo-field="accountId"]', KEYS.accountId); await opened.fill(card('maxmind') + '[data-geo-field="licenseKey"]', KEYS.licenseKey); await click(card('maxmind') + '[data-geo-save]'); await idle();
    await opened.fill(card('ipdata') + '[data-geo-field="apiKey"]', KEYS.ipdata); await click(card('ipdata') + '[data-geo-save]'); await idle();
  }
  const saved = isChrome ? SECRETS : [KEYS.accountId, KEYS.licenseKey, KEYS.ipdata];
  let stores = await areas();
  assert.ok(saved.every(secret => !stores.local.includes(secret)), 'remember is off: no key on disk'); assert.ok(saved.every(secret => stores.session.includes(secret)), 'the keys are in session storage');
  assert.ok(stores.local.includes(GEO_SETTINGS_KEY) && !stores.local.includes(GEO_CREDENTIALS_KEY), 'settings are stored without the credentials container');
  await opened.goto(opened.base + PAGE); await ready(); if (!isChrome) await countRequests();
  assert.equal(await text(card('maxmind') + '[data-geo-key]'), EN.key_saved, 'a reload keeps the keys of this browser session');
  assert.equal(await get(() => [...document.querySelectorAll('[data-geo-field]')].every(node => node.value === '')), true, 'but never refills a field');
  await click('[data-geo-option="remember"]'); await idle();
  stores = await areas();
  assert.ok(saved.every(secret => stores.local.includes(secret) && !stores.session.includes(secret)), 'remember on: the keys moved to disk (unencrypted, as the page says) and left the session area');
  assert.equal(await attribute('[data-geo-option="remember"]', 'aria-checked'), 'true'); assert.equal(await text(card('ipdata') + '[data-geo-key]'), EN.key_saved);
  const others = await get(async keys => { const api = globalThis.browser ?? globalThis.chrome; return JSON.stringify(await api.storage.local.get(keys)); }, [GEO_SETTINGS_KEY, GEO_CACHE_KEY]);
  assert.ok(SECRETS.every(secret => !others.includes(secret)), 'neither the settings nor the cache hold a key');
  check('keys: session storage by default and nothing on disk; a reload keeps them but never refills a field; "remember" moves them to disk, and the settings and the cache never hold one');
}

async function dataCard() {
  const record = { provider: 'ipdata', service: '', at: Date.now(), ip: GEO_TEST_IP, country: 'US', countryName: 'United States', region: 'California', city: 'Mountain View', timezone: 'America/Los_Angeles', asn: 15169, org: GOOGLE, isp: '', kind: 'hosting', flags: Object.fromEntries(GEO_FLAGS.map(flag => [flag, null])) };
  await get(async ({ key, cache }) => { await (globalThis.browser ?? globalThis.chrome).storage.local.set({ [key]: cache }); }, { key: GEO_CACHE_KEY, cache: geoCachePut(emptyGeoCache(), record) });
  await until(() => text('[data-geo-clear-cache]').then(value => value === proxyGeoFill(EN.clear_cache, { n: 1 })), 'a cache written elsewhere is shown');
  await get(() => document.querySelector('[data-geo-clear-cache]').focus());
  if (isChrome) {
    await press('Enter'); assert.equal(await attribute('[data-geo-clear-cache]', 'data-armed'), 'true'); assert.equal(await text('[data-geo-clear-cache]'), proxyGeoFill(EN.clear_cache_armed, { n: 1 }));
    assert.equal(await text('[data-geo-confirm-hint]'), EN.confirm_hint);
  } else await click('[data-geo-clear-cache]');
  await press('Escape'); assert.equal(await attribute('[data-geo-clear-cache]', 'data-armed'), 'false');
  assert.equal(await get(() => document.activeElement?.hasAttribute('data-geo-clear-cache')), true, 'Escape keeps the focus on the button');
  if (isChrome) { await press('Enter'); await press('Enter'); } else { await click('[data-geo-clear-cache]'); await click('[data-geo-clear-cache]'); }
  await idle();
  await until(() => text('[data-geo-clear-cache]').then(value => value === proxyGeoFill(EN.clear_cache, { n: 0 })), 'the cache is cleared');
  assert.equal(await text('[data-geo-data-note]'), EN.done_cache); assert.equal(await get(() => document.activeElement !== document.body), true, 'the focus is not lost with the disabled button');
  assert.ok(!(await storageArea('local', GEO_CACHE_KEY)).includes(GEO_TEST_IP), 'the cache is gone from storage');
  if (isChrome) {
    await get(() => document.querySelector('[data-geo-master]').focus());
    await press('Space'); await idle(); assert.equal(await attribute('[data-geo-master]', 'aria-checked'), 'false');
    await press('Enter'); await idle(); assert.equal(await attribute('[data-geo-master]', 'aria-checked'), 'true');
  }
  const keyed = await get(() => document.querySelectorAll('[data-geo-key][data-has="true"]').length);
  await click('[data-geo-forget-all]'); assert.equal(await attribute('[data-geo-forget-all]', 'data-armed'), 'true'); assert.equal(await text('[data-geo-forget-all]'), EN.forget_all_armed);
  await click('[data-geo-confirm-cancel]'); assert.equal(await attribute('[data-geo-forget-all]', 'data-armed'), 'false'); assert.equal(await get(() => document.querySelectorAll('[data-geo-key][data-has="true"]').length), keyed, 'cancel removes nothing');
  await click('[data-geo-forget-all]'); await click('[data-geo-forget-all]'); await idle();
  await until(() => get(() => document.querySelectorAll('[data-geo-key][data-has="true"]').length === 0), 'all keys removed');
  const stores = await areas(); assert.ok(SECRETS.every(secret => !stores.local.includes(secret) && !stores.session.includes(secret)), 'no key left in either storage area');
  assert.equal(await text('[data-geo-data-note]'), EN.done_forget_all);
  check('data card: a cache written elsewhere appears live; the two-step confirms work (' + (isChrome ? 'Enter, Escape' : 'click, Escape') + ', Cancel); ' + (isChrome ? 'switches answer Space and Enter; ' : '') + 'all keys are removed from both areas');
}

async function integrationsEntry() {
  await opened.goto(opened.base + 'options.html#integrations');
  await until(() => get(() => Boolean(document.querySelector('[data-api-proxy-geo]'))), 'the Integrations entry');
  const entry = await get(() => {
    const precursor = document.querySelector('[data-api-precursor]'), geo = document.querySelector('[data-api-proxy-geo]');
    return { order: [...document.querySelectorAll('[data-management-integrations] [data-api-precursor], [data-management-integrations] [data-api-proxy-geo]')].map(node => (node.hasAttribute('data-api-precursor') ? 'precursor' : node.hasAttribute('data-api-proxy-geo') ? 'proxy-geo' : '?')),
      title: geo.querySelector('strong').textContent, dir: geo.querySelector('strong').getAttribute('dir'), subtitle: geo.querySelector('.small').textContent, sameClass: geo.className === precursor.className,
      arrow: Boolean(geo.querySelector('.management-settings-entry__arrow')), icon: Boolean(geo.querySelector('svg')) };
  });
  assert.deepEqual(entry.order, ['precursor', 'proxy-geo']); assert.deepEqual([entry.title, entry.dir, entry.sameClass, entry.arrow, entry.icon], ['Proxy Manager Geolocation API', 'ltr', true, true, true]); assert.ok(entry.subtitle.length > 10);
  const url = opened.base + PAGE;
  if (isChrome) {
    const [created] = await Promise.all([opened.context.waitForEvent('page', { timeout: 15000 }), click('[data-api-proxy-geo]')]);
    await created.waitForLoadState('domcontentloaded'); assert.equal(created.url(), url); await created.close();
  } else {
    await click('[data-api-proxy-geo]');
    await until(() => get(async url => { const found = (await browser.tabs.query({})).find(tab => tab.url === url); if (found) await browser.tabs.remove(found.id); return Boolean(found); }, url), 'a new tab for the page (closed again)');
  }
  await get(() => document.querySelector('[data-management-search]').click());
  await until(() => get(() => { const input = document.querySelector('[data-command-palette-input]'); return Boolean(input && input.getClientRects().length > 0 && input.closest('dialog')?.open); }), 'the palette is open');
  await opened.fill('[data-command-palette-input]', 'geolocation');
  await until(() => get(() => Boolean(document.querySelector('[data-command-option="proxy-geo"]'))), 'the palette entry');
  assert.equal(await get(() => document.querySelector('[data-command-option="proxy-geo"] .command-palette__label').textContent), 'Proxy Manager Geolocation API');
  check('Integrations: the second entry follows Cloudflare Precursor with the same classes and opens the page in a new tab; the palette finds it by "geolocation"');
}

const THEMES = [['system', 'light', 'system-light'], ['pearl', 'light', 'pearl'], ['orchid', 'light', 'orchid'], ['system', 'dark', 'system-dark'], ['aurora', 'dark', 'aurora'], ['graphite', 'dark', 'graphite'], ['glass', 'dark', 'glass']];
const sample = () => get(() => {
  const solid = node => { for (let at = node; at; at = at.parentElement) { const value = getComputedStyle(at).backgroundColor; if (!/rgba\(.*, 0\)$|transparent/.test(value)) return value; } return 'rgb(255, 255, 255)'; };
  const star = document.querySelector('[data-geo-star] path'), maxmind = document.querySelector('[data-geo-provider="maxmind"]');
  const of = selector => { const node = document.querySelector(selector); return { selector, color: getComputedStyle(node).color, background: solid(node) }; };
  return { effective: document.documentElement.getAttribute('data-ui-theme-effective'), star: { fill: getComputedStyle(star).fill, stroke: getComputedStyle(star).stroke, background: getComputedStyle(maxmind).backgroundColor },
    texts: ['.pg-help', '[data-geo-state]', '.pg-docs', '[data-geo-save]', '.pg-status', '.pg-star-caption', '.pg-option-label', 'h3'].map(of) };
});
async function overflow(name) {
  const result = await get(() => ({ inner: innerWidth, scroll: document.documentElement.scrollWidth, direction: getComputedStyle(document.documentElement).direction,
    outside: [...document.querySelectorAll('#proxy-geo-settings *')].filter(node => { const box = node.getBoundingClientRect(); return box.width > 0 && (box.right > innerWidth + 1 || box.left < -1); }).map(node => node.className || node.localName).slice(0, 5) }));
  assert.ok(result.scroll <= result.inner, name + ': no horizontal overflow (' + result.scroll + ' > ' + result.inner + ')'); assert.deepEqual(result.outside, [], name + ': nothing outside the viewport');
  evidence.layouts.push({ name, ...result });
}
const shot = async name => { const path = join(shots, name + '.png'); await opened.screenshot(path); evidence.screenshots.push(path); };
// Firefox cannot make its window narrower than about 360 px (the harness reports it) and needs a taller one to match the size.
const NARROW_HEIGHT = isChrome ? 800 : 900;
const widths = isChrome ? [[320, 800], [360, 800], [768, 900], [1180, 900]] : [[360, 900], [768, 900], [1180, 900]];
async function layouts() {
  await openPage('en');
  if ((await attribute('[data-geo-master]', 'aria-checked')) !== 'true') { await click('[data-geo-master]'); await idle(); }
  for (const [width, height] of widths) { await opened.viewport(width, height); await pause(150); await overflow('en-' + width); }
  await opened.viewport(360, NARROW_HEIGHT); await shot('en-360-light'); await opened.viewport(1180, 900); await shot('en-1180-light');
  await get(async () => { await (globalThis.browser ?? globalThis.chrome).storage.local.set({ 'ui-theme-v1': 'aurora' }); }); await pause(300);
  await opened.viewport(360, NARROW_HEIGHT); await overflow('dark-360'); await shot('dark-360'); await opened.viewport(1180, 900); await overflow('dark-1180'); await shot('dark-1180');
  await get(async () => { await (globalThis.browser ?? globalThis.chrome).storage.local.set({ 'ui-theme-v1': 'system' }); });
  await setLanguage('ar');
  assert.equal(String(await get(() => [document.documentElement.dir, document.documentElement.lang])), 'rtl,ar');
  for (const [width, height] of widths) { await opened.viewport(width, height); await pause(150); await overflow('ar-' + width); }
  const mirrored = await get(() => { const master = document.querySelector('.pg-master').getBoundingClientRect(), toggle = document.querySelector('[data-geo-master]').getBoundingClientRect(), star = document.querySelector('[data-geo-star]').getBoundingClientRect(), maxmind = document.querySelector('[data-geo-provider="maxmind"]').getBoundingClientRect(); return { switchOnLeft: toggle.left - master.left < master.right - toggle.right, starOnRight: maxmind.right - star.right < star.left - maxmind.left }; });
  assert.deepEqual(mirrored, { switchOnLeft: true, starOnRight: true }, 'right-to-left mirrors the master switch and the star');
  await opened.viewport(360, NARROW_HEIGHT); await shot('ar-360-rtl'); await opened.viewport(1180, 900); await shot('ar-1180-rtl');
  await setLanguage('ru'); assert.equal(await text('[data-geo-state]'), isChrome ? proxyGeoFill(RU.state_ready, { list: 'ip-api.com' }) : RU.state_no_key, 'Russian is complete (in Chrome the free ip-api.com endpoint was allowed above, so it is ready without a key)'); assert.equal(await attribute('[data-geo-star]', 'aria-label'), RU.recommended); await shot('ru-1180'); await setLanguage('en');
  check('no horizontal overflow at ' + widths.map(pair => pair[0]).join(', ') + ' px in English, dark and Arabic (RTL, mirrored); Russian shows its own texts; screenshots are in the run folder');
}
async function themes(list) {
  for (const [theme, scheme, effective] of list) {
    if (isChrome) await opened.media({ colorScheme: scheme, forcedColors: 'none' });
    await get(async theme => { await (globalThis.browser ?? globalThis.chrome).storage.local.set({ 'ui-theme-v1': theme }); }, theme);
    await until(() => get(effective => document.documentElement.getAttribute('data-ui-theme-effective') === effective, effective), 'theme ' + effective); await pause(250);
    const measured = await sample(), starRatio = contrast(colour(measured.star.fill), colour(measured.star.background));
    assert.ok(starRatio >= 3, effective + ': gold star fill against the card is ' + starRatio.toFixed(2) + ':1 (needs 3:1)');
    const texts = measured.texts.map(item => ({ selector: item.selector, ratio: contrast(colour(item.color), colour(item.background)) }));
    for (const item of texts) assert.ok(item.ratio >= 4.5, effective + ': ' + item.selector + ' is ' + item.ratio.toFixed(2) + ':1 (needs 4.5:1)');
    evidence.contrast.push({ theme: effective, star: Number(starRatio.toFixed(2)), starFill: measured.star.fill, texts: texts.map(item => [item.selector, Number(item.ratio.toFixed(2))]) });
    await opened.viewport(1180, 900); await shot('theme-' + effective);
  }
  check('the gold star keeps 3:1 against the card and the texts keep 4.5:1 in ' + list.map(item => item[2]).join(', '));
}
async function forcedColors() {
  // The shared stylesheet forces ButtonFace on every button, so a switch shows its state by its thumb: another place and another colour.
  // The thumb colour of the base rule comes from a theme token (white in the light themes), so every theme is measured, not one.
  const measured = [];
  for (const [theme, scheme, effective] of THEMES) {
    await opened.media({ colorScheme: scheme, forcedColors: 'active' });
    await get(async theme => { await (globalThis.browser ?? globalThis.chrome).storage.local.set({ 'ui-theme-v1': theme }); }, theme);
    await until(() => get(effective => document.documentElement.getAttribute('data-ui-theme-effective') === effective, effective), 'theme ' + effective + ' in forced colors'); await pause(250);
    const forced = await sample(), fill = contrast(colour(forced.star.fill), colour(forced.star.background)), edge = contrast(colour(forced.star.stroke), colour(forced.star.background));
    assert.ok(fill >= 3 && edge >= 3, effective + ' in forced colors: star fill ' + fill.toFixed(2) + ':1, edge ' + edge.toFixed(2) + ':1');
    const thumbs = await get(async () => {
      const node = document.querySelector('[data-geo-option="auto"]');
      const at = async on => { node.setAttribute('aria-checked', String(on)); await new Promise(resolve => setTimeout(resolve, 400)); const after = getComputedStyle(node, '::after'); return { thumb: after.backgroundColor, track: getComputedStyle(node).backgroundColor, left: after.insetInlineStart }; };
      const on = await at(true), off = await at(false); node.setAttribute('aria-checked', 'true'); return { on, off };
    });
    for (const state of ['on', 'off']) assert.ok(contrast(colour(thumbs[state].thumb), colour(thumbs[state].track)) >= 3, effective + ' in forced colors: the ' + state + ' thumb is visible on the track');
    assert.notEqual(thumbs.on.left, thumbs.off.left, effective + ' in forced colors: on and off differ by the place of the thumb'); assert.notEqual(thumbs.on.thumb, thumbs.off.thumb, 'and by its colour');
    measured.push({ theme: 'forced-colors/' + effective, star: Number(fill.toFixed(2)), edge: Number(edge.toFixed(2)), switchThumbs: thumbs });
    if (['pearl', 'glass'].includes(effective)) await shot('forced-colors-' + effective);
  }
  evidence.contrast.push(...measured);
  await opened.media({ colorScheme: 'light', forcedColors: 'none' });
  check('forced colors in all 7 themes: the star is drawn in system colors and keeps 3:1; a switch shows on and off by the place and the colour of its thumb, and that thumb is visible on the track');
}

// prefers-reduced-motion: the switch thumb and the buttons animate normally and stop when the system asks for less motion.
async function reducedMotion() {
  const durations = () => get(() => ['[data-geo-master]', '[data-geo-save]'].flatMap(selector => { const node = document.querySelector(selector); return [getComputedStyle(node).transitionDuration, getComputedStyle(node, '::after').transitionDuration]; }));
  const seconds = list => list.flatMap(value => value.split(',')).map(part => parseFloat(part));
  await opened.media({ colorScheme: 'light', forcedColors: 'none', reducedMotion: 'no-preference' }); await pause(200);
  assert.ok(seconds(await durations()).some(value => value > 0), 'with no preference the switch animates');
  await opened.media({ colorScheme: 'light', forcedColors: 'none', reducedMotion: 'reduce' }); await pause(200);
  assert.ok(seconds(await durations()).every(value => value === 0), 'with reduced motion nothing animates');
  await opened.media({ colorScheme: 'light', forcedColors: 'none', reducedMotion: 'no-preference' });
  check('prefers-reduced-motion: the switch animates by default and stops animating when less motion is asked for');
}

// Restarting the owned browser with the same profile: session keys vanish, disk keys stay only while "remember" is on.
async function restart() {
  await opened.close(); await launch(); await openPage('en');
  assert.equal(await attribute('[data-geo-option="remember"]', 'aria-checked'), 'true', 'the choice itself is stored');
  await opened.fill(card('ipdata') + '[data-geo-field="apiKey"]', KEYS.ipdata); await click(card('ipdata') + '[data-geo-save]'); await idle();
  assert.ok((await storageArea('local')).includes(KEYS.ipdata), 'remember on: on disk');
  await opened.close(); await launch(); await openPage('en');
  assert.equal(await text(card('ipdata') + '[data-geo-key]'), EN.key_saved, 'a restart keeps a remembered key'); assert.equal(await get(() => [...document.querySelectorAll('[data-geo-field]')].every(node => node.value === '')), true);
  await click('[data-geo-option="remember"]'); await idle();
  let stores = await areas(); assert.ok(!stores.local.includes(KEYS.ipdata) && stores.session.includes(KEYS.ipdata), 'remember off: back to session storage, off the disk');
  await opened.close(); await launch(); await openPage('en');
  assert.equal(await text(card('ipdata') + '[data-geo-key]'), EN.key_none, 'a restart forgets a session key'); stores = await areas();
  assert.ok(SECRETS.every(secret => !stores.local.includes(secret) && !stores.session.includes(secret)), 'and leaves nothing in either area');
  check('restart of the browser: a remembered key survives it, a session key does not, and turning "remember" off takes the key off the disk');
}

try {
  await launch();
  await openPage('en');
  await structure();
  await silenceUntilTriggered();
  if (isChrome) await testEveryProvider(); else await testWithoutAnswers();
  await contentSecurityPolicy();
  await whereKeysLive();
  await dataCard();
  await integrationsEntry();
  await layouts();
  if (isChrome) {
    await themes(THEMES); await forcedColors(); await reducedMotion();
    await restart();
  } else {
    await themes(THEMES.filter(item => item[2] !== 'system-dark'));
    await opened.close(); await launch({ dark: true }); await openPage('en'); await themes(THEMES.filter(item => item[2] === 'system-dark'));
  }
  assert.ok(requests.every(entry => entry.method === 'GET'), 'only GET requests were ever made');
  if (!isChrome) assert.equal(await seen(), 0, 'Firefox: nothing left the page');
  evidence.result = 'PASS';
} catch (failure) {
  evidence.result = 'FAIL'; evidence.failure = failure?.message ?? String(failure); throw failure;
} finally {
  evidence.finishedAt = new Date().toISOString(); evidence.totalRequests = requests.length;
  writeFileSync(join(run, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  await opened?.close();
  console.log((evidence.result === 'PASS' ? 'PASS ' : 'FAIL ') + browser + ': ' + evidence.checks.length + ' checks, ' + evidence.layouts.length + ' layouts, ' + evidence.contrast.length + ' contrast rows, ' + evidence.screenshots.length + ' screenshots, ' + requests.length + ' intercepted requests; evidence in ' + run);
}
