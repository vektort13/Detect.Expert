import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBrowserDebugEnvironmentDriver } from '../../apps/production-extension/browser-debug-environment.js';
import { BROWSER_DEBUG_LIMITS, BrowserDebugError } from '../../apps/production-extension/browser-debug-shared.js';

function fixture(api = {}, env = {}, browser = 'chrome') {
  const calls = []; let active = true;
  const check = () => { if (!active) throw new BrowserDebugError('stale'); };
  const driver = createBrowserDebugEnvironmentDriver({ api, env, browser, check, call: async (target, method, args = []) => { check(); calls.push({ target, method, args }); return Reflect.apply(target[method], target, args); } });
  return { api, driver, calls, stop: () => { active = false; } };
}
function chromeSetting(value = true, levelOfControl = 'controllable_by_this_extension') {
  const state = { value, levelOfControl }, writes = [];
  const target = {
    async get(options) { assert.deepEqual(options, { incognito: false }); return { ...state }; },
    async set(details) { writes.push({ operation: 'set', details }); state.value = details.value; state.levelOfControl = 'controlled_by_this_extension'; },
    async clear(details) { writes.push({ operation: 'clear', details }); state.value = true; state.levelOfControl = 'controllable_by_this_extension'; },
  };
  return { target, state, writes };
}
function contentSetting(value = 'ask') {
  const state = { setting: value }, writes = [], queries = [];
  const target = {
    async get(details) { queries.push(details); return { ...state }; },
    async set(details) { writes.push(details); state.setting = details.setting; },
    async clear() { throw Error('A type-wide clear must never run'); },
  };
  return { target, state, writes, queries };
}
const rejects = (promise, code) => assert.rejects(promise, error => error instanceof BrowserDebugError && error.code === code);

test('overview reads only own navigator, runtime manifest/platform and usage; no page, media, profile-storage or auth probe', async () => {
  const forbidden = () => { throw Error('forbidden probe'); };
  const navigator = { userAgent: 'Owned UI UA', platform: 'Own platform', languages: ['ru', 'en'], hardwareConcurrency: 8, cookieEnabled: true };
  Object.defineProperty(navigator, 'mediaDevices', { get: forbidden });
  const manifest = { name: 'Owned extension', version: '1.2.3', manifest_version: 3, permissions: ['storage'] };
  Object.defineProperty(manifest, 'oauth2', { get: forbidden });
  const area = { get: forbidden, getBytesInUse: async key => { assert.equal(key, null); return 512; } };
  const api = { runtime: { getPlatformInfo: async () => ({ os: 'win', arch: 'x86-64' }), getManifest: () => manifest }, storage: { local: area }, scripting: { executeScript: forbidden }, identity: { getAuthToken: forbidden } };
  const f = fixture(api, { navigator, fetch: forbidden, document: { createElement: forbidden } });
  const result = await f.driver.read('overview');
  assert.equal(result.truncated, false); assert.ok(result.records.every(row => row.reference === null && row.actions.length === 0));
  assert.equal(result.records.find(row => row.values.name === 'navigator.userAgent').values.value, navigator.userAgent);
  assert.equal(result.records.find(row => row.values.name === 'navigator.languages.1').values.value, 'en');
  assert.equal(result.records.find(row => row.values.name === 'storage.local.bytes').values.value, 512);
  assert.deepEqual(f.calls.map(row => row.method), ['getPlatformInfo', 'getManifest', 'getBytesInUse']);
  await rejects(f.driver.write('overview', 'edit', {}, {}), 'unsupported');
});

test('system is capability-based, read-only and bounds large native arrays without losing other available info groups', async () => {
  const api = { system: {
    cpu: { getInfo: async () => ({ modelName: 'Own CPU', processors: Array.from({ length: 1000 }, (_, id) => ({ id, usage: { user: id } })) }) },
    memory: { getInfo: async () => ({ capacity: 4096, availableCapacity: 1024 }) },
    storage: { getInfo: async () => [{ id: 'disk', capacity: 8192 }], ejectDevice() { throw Error('not allowed'); } },
    display: { getInfo: async () => [{ id: 'display', bounds: { width: 1920, height: 1080 } }], setDisplayProperties() { throw Error('not allowed'); } },
  } };
  const f = fixture(api); const result = await f.driver.read('system');
  assert.equal(result.truncated, true); assert.ok(result.records.length <= BROWSER_DEBUG_LIMITS.rows);
  for (const type of ['cpu', 'memory', 'storage', 'display']) assert.ok(result.records.some(row => row.values.name.startsWith('system.' + type + '.')), type);
  assert.ok(result.records.every(row => row.actions.length === 0)); assert.equal(f.calls.length, 4);
  assert.equal(fixture({}, {}, 'firefox').driver.supports('system'), false); assert.throws(() => f.driver.describe('system', 'edit', {}), { code: 'unsupported' });
});

test('read budgets bound UTF-8 data and skip native result accessors', async () => {
  let accessorReads = 0; const info = { values: Array(10000).fill('字'.repeat(5000)) };
  Object.defineProperty(info, 'accessor', { enumerable: true, get() { accessorReads++; throw Error('accessor'); } });
  const f = fixture({ system: { cpu: { getInfo: async () => info } } }); const result = await f.driver.read('system');
  assert.equal(result.truncated, true); assert.equal(accessorReads, 0); assert.ok(result.records.length < 10000);
  assert.ok(new TextEncoder().encode(JSON.stringify(result)).length <= BROWSER_DEBUG_LIMITS.bytes);
  assert.ok(result.records.every(row => row.values.value.length <= BROWSER_DEBUG_LIMITS.string));
});

test('account calls only getProfileUserInfo ANY and preserves empty native account fields', async () => {
  const identity = { getProfileUserInfo: async options => { assert.deepEqual(options, { accountStatus: 'ANY' }); return { email: '', id: '' }; } };
  Object.defineProperty(identity, 'getAuthToken', { get() { throw Error('OAuth must never be inspected'); } });
  const f = fixture({ identity }); assert.equal(f.driver.supports('account'), true);
  const result = await f.driver.read('account'); assert.deepEqual(result.records.map(row => row.values), [{ name: 'account.email', value: '' }, { name: 'account.id', value: '' }]);
  assert.deepEqual(f.calls.map(row => row.method), ['getProfileUserInfo']); assert.equal(fixture({ identity: {} }, {}, 'firefox').driver.supports('account'), false);
});

test('privacy uses only the static bool list, preserves current form default and reads WebRTC without competing with API Guard', async () => {
  const setting = chromeSetting(), rtc = chromeSetting('default'), ignored = chromeSetting();
  const f = fixture({ privacy: { network: { networkPredictionEnabled: setting.target, webRTCIPHandlingPolicy: rtc.target, arbitrarySetting: ignored.target } } });
  const result = await f.driver.read('privacy'); assert.equal(result.records.length, 2); assert.equal(ignored.writes.length, 0);
  const reference = result.records[0].reference;
  const beforeDescribe = f.calls.length;
  assert.deepEqual(f.driver.describe('privacy', 'edit', reference), { fields: [{ key: 'value', type: 'boolean', value: true }], destructive: false });
  assert.equal(f.calls.length, beforeDescribe, 'form descriptions are synchronous and never read the browser');
  assert.deepEqual(await f.driver.write('privacy', 'edit', reference, { value: true }), { applied: false, unchanged: true }); assert.deepEqual(setting.writes, []);
  const webRtc = result.records.find(row => row.reference.path === 'network.webRTCIPHandlingPolicy'); assert.deepEqual(webRtc.actions, ['api-guard']);
  assert.deepEqual(f.driver.describe('privacy', 'api-guard', webRtc.reference), { fields: [], destructive: false });
  await rejects(f.driver.write('privacy', 'edit', webRtc.reference, { value: 'disable_non_proxied_udp' }), 'unsupported');
  await rejects(f.driver.write('privacy', 'clear', webRtc.reference, {}), 'unsupported'); assert.deepEqual(rtc.writes, []);
});

test('privacy set/clear use regular scope, fresh ownership and authoritative readback', async () => {
  const setting = chromeSetting(), f = fixture({ privacy: { services: { safeBrowsingEnabled: setting.target } } });
  let reference = (await f.driver.read('privacy')).records[0].reference;
  assert.equal(f.driver.describe('privacy', 'edit', reference).destructive, true);
  assert.deepEqual(await f.driver.write('privacy', 'edit', reference, { value: false }), { applied: true, value: false });
  assert.deepEqual(setting.writes, [{ operation: 'set', details: { value: false, scope: 'regular' } }]);
  reference = (await f.driver.read('privacy')).records[0].reference; assert.ok((await f.driver.read('privacy')).records[0].actions.includes('clear'));
  assert.deepEqual(await f.driver.write('privacy', 'clear', reference, {}), { applied: true, value: true }); assert.deepEqual(setting.writes[1], { operation: 'clear', details: { scope: 'regular' } });
});

test('privacy changes refuse foreign ownership, stale values, invalid patches and a cancelled operation before any native write', async () => {
  const setting = chromeSetting(true, 'controlled_by_other_extensions'), f = fixture({ privacy: { services: { searchSuggestEnabled: setting.target } } });
  let reference = (await f.driver.read('privacy')).records[0].reference; assert.deepEqual((await f.driver.read('privacy')).records[0].actions, []);
  await rejects(f.driver.write('privacy', 'edit', reference, { value: false }), 'not-controllable'); await rejects(f.driver.write('privacy', 'clear', reference, {}), 'not-controllable');
  setting.state.levelOfControl = 'controllable_by_this_extension'; reference = (await f.driver.read('privacy')).records[0].reference;
  await rejects(f.driver.write('privacy', 'edit', reference, { value: false, scope: 'incognito_session_only' }), 'invalid-input');
  setting.state.value = false; await rejects(f.driver.write('privacy', 'edit', reference, { value: false }), 'stale-record');
  reference = (await f.driver.read('privacy')).records[0].reference;
  const get = setting.target.get; setting.target.get = async options => { const value = await get(options); f.stop(); return value; };
  await rejects(f.driver.write('privacy', 'edit', reference, { value: true }), 'stale'); assert.deepEqual(setting.writes, []);
});

test('privacy never reports a rejected or overridden write as applied and never clears a foreign layer', async () => {
  const setting = chromeSetting(), f = fixture({ privacy: { websites: { referrersEnabled: setting.target } } });
  let reference = (await f.driver.read('privacy')).records[0].reference;
  setting.target.set = async () => false; await rejects(f.driver.write('privacy', 'edit', reference, { value: false }), 'verification-failed');
  setting.target.set = async () => undefined; await rejects(f.driver.write('privacy', 'edit', reference, { value: false }), 'verification-failed');
  setting.state.levelOfControl = 'controlled_by_this_extension'; reference = (await f.driver.read('privacy')).records[0].reference;
  setting.state.levelOfControl = 'controlled_by_other_extensions'; await rejects(f.driver.write('privacy', 'clear', reference, {}), 'stale-record'); assert.deepEqual(setting.writes, []);
});

test('site settings require one exact HTTP(S) origin and never enumerate or clear permissions', async () => {
  const setting = contentSetting(), f = fixture({ contentSettings: { notifications: setting.target } });
  for (const origin of [undefined, 'file:///tmp/x', 'chrome://settings/', 'https://u:p@example.com/', 'https://example.com/path', 'https://example.com/?query', 'https://example.com/#fragment', '*://*.example.com/']) await rejects(f.driver.read('site-permissions', { origin }), 'invalid-input');
  assert.deepEqual(setting.queries, []);
  const result = await f.driver.read('site-permissions', { origin: 'https://EXAMPLE.com:443/' }); const reference = result.records[0].reference;
  assert.equal(reference.origin, 'https://example.com'); assert.deepEqual(result.records[0].actions, ['edit']);
  assert.deepEqual(f.driver.describe('site-permissions', 'edit', reference), { fields: [{ key: 'value', type: 'select', value: 'ask', options: ['allow', 'block', 'ask'] }], destructive: false });
  await rejects(f.driver.write('site-permissions', 'clear', reference, {}), 'unsupported');
  await f.driver.write('site-permissions', 'edit', reference, { value: 'block' }); assert.deepEqual(setting.writes, [{ primaryPattern: 'https://example.com:443/*', setting: 'block', scope: 'regular' }]);
  assert.ok(setting.queries.every(query => query.primaryUrl === 'https://example.com/' && query.secondaryUrl === query.primaryUrl && query.incognito === false));
});

test('content-setting port and embedding scope remain exact; stale or unapplied settings are not reset by a fake rollback', async () => {
  const cookies = contentSetting('allow'), f = fixture({ contentSettings: { cookies: cookies.target } });
  const result = await f.driver.read('site-permissions', { origin: 'http://example.com:8080' }), reference = result.records[0].reference;
  assert.equal(result.records[0].values.scope, 'same-origin-context');
  await f.driver.write('site-permissions', 'edit', reference, { value: 'session_only' });
  assert.deepEqual(cookies.writes[0], { primaryPattern: 'http://example.com:8080/*', secondaryPattern: 'http://example.com:8080/*', setting: 'session_only', scope: 'regular' });
  await rejects(f.driver.write('site-permissions', 'edit', reference, { value: 'block' }), 'stale-record');
  const current = (await f.driver.read('site-permissions', { origin: reference.origin })).records[0].reference;
  cookies.target.set = async details => { cookies.writes.push(details); };
  await rejects(f.driver.write('site-permissions', 'edit', current, { value: 'block' }), 'not-applied'); assert.equal(cookies.writes.length, 2, 'no clearing or resetting observed defaults after readback failure');
});

test('invalid action references and getter patches cannot choose arbitrary API members or execute coercion', async () => {
  const setting = chromeSetting(), f = fixture({ privacy: { network: { networkPredictionEnabled: setting.target } } });
  const reference = (await f.driver.read('privacy')).records[0].reference;
  let gets = 0; const patch = {}; Object.defineProperty(patch, 'value', { enumerable: true, get() { gets++; return false; } });
  await rejects(f.driver.write('privacy', 'edit', reference, patch), 'invalid-input'); assert.equal(gets, 0);
  await rejects(f.driver.write('privacy', 'edit', { ...reference, path: '__proto__.set' }, { value: false }), 'invalid-input');
  await rejects(f.driver.write('privacy', 'edit', { ...reference, tabId: 123 }, { value: false }), 'invalid-input'); assert.deepEqual(setting.writes, []);
});

test('internals use only fixed browser-specific local links and open them only after a fresh context check', async () => {
  const opened = [], api = { tabs: { create: async details => { opened.push(details); return { id: 4 }; } } };
  const chrome = fixture(api), firefox = fixture(api, {}, 'firefox');
  const c = await chrome.driver.read('internals'), f = await firefox.driver.read('internals');
  assert.ok(c.records.every(row => row.values.url.startsWith('chrome://'))); assert.ok(f.records.every(row => row.values.url.startsWith('about:')));
  const reference = c.records[0].reference; assert.deepEqual(chrome.driver.describe('internals', 'open', reference), { fields: [], destructive: false });
  await rejects(chrome.driver.write('internals', 'open', { ...reference, url: 'https://example.com/' }, {}), 'invalid-input');
  assert.deepEqual(await chrome.driver.write('internals', 'open', reference, {}), { opened: true }); assert.deepEqual(opened, [{ url: 'chrome://version/' }]);
  firefox.stop(); await rejects(firefox.driver.write('internals', 'open', f.records[0].reference, {}), 'stale'); assert.equal(opened.length, 1);
});
