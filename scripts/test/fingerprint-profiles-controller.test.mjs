// E22-19: exact Options trust boundary, one CAS commit and truthful async outcomes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiConfiguration } from '../../apps/production-extension/api-configuration.js';
import { snapshotFingerprintProfile, storeFingerprintProfile } from '../../apps/production-extension/fingerprint-profiles.js';
import { createFingerprintProfilesController } from '../../apps/production-extension/fingerprint-profiles-controller.js';
function event() { const listeners = new Set(); return { addListener: callback => listeners.add(callback), removeListener: callback => listeners.delete(callback), emit: (...args) => { for (const listener of listeners) listener(...args); }, size: () => listeners.size }; }
// `navigator` builds a custom navigator (receives a probe counter); `display` defines the window-level globals the real-environment snapshot reads.
function globals({ url = 'chrome-extension://owned/options.html#antidetect', framed = false, navigator: custom = null, display = {} } = {}) {
  const keys = ['location', 'window', 'navigator', 'screen', 'devicePixelRatio', 'outerWidth', 'outerHeight'], previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const own = {}; own.top = framed ? {} : own;
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: url } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: own });
  let probes = 0;
  // Probes count every read of a hardware value or call of the client-hint API (U1 reads both on purpose; failures must stay harmless).
  const failing = { userAgent: 'Mozilla/5.0 Chrome/153.0.0.0', appVersion: '5.0', platform: 'Win32', vendor: 'Google Inc.', language: 'en-US', languages: ['en-US', 'en'], userAgentData: { brands: [{ brand: 'Chromium', version: '153' }], mobile: false, platform: 'Windows', getHighEntropyValues() { probes++; throw Error('Client hints are unavailable'); } }, get hardwareConcurrency() { probes++; throw Error('Hardware is unavailable'); } };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: custom ? custom(() => { probes++; }) : failing });
  for (const [key, value] of Object.entries(display)) Object.defineProperty(globalThis, key, { configurable: true, value });
  return { probes: () => probes, restore() { for (const [key, descriptor] of previous) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } };
}
const CHROME_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
const REAL_LIST = [{ brand: 'Not:A-Brand', version: '8.0.0.0' }, { brand: 'Chromium', version: '156.0.8078.80' }, { brand: 'Google Chrome', version: '156.0.8078.80' }];
// A Chrome 156 / Windows 11 style navigator (values measured on one machine; used here only as plausible fixture data).
const chromeNavigator = (overrides = {}, hints = {}) => ({ userAgent: CHROME_AGENT, appVersion: '5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32', vendor: 'Google Inc.', language: 'en-US', languages: ['en-US', 'en'], hardwareConcurrency: 16,
  userAgentData: { brands: [{ brand: 'Not:A-Brand', version: '8' }, { brand: 'Chromium', version: '156' }, { brand: 'Google Chrome', version: '156' }], mobile: false, platform: 'Windows',
    getHighEntropyValues: async () => ({ platformVersion: '19.0.0', uaFullVersion: '156.0.8078.80', fullVersionList: REAL_LIST, architecture: 'x86' }), ...hints }, ...overrides });
const DISPLAY = { screen: { width: 2560, height: 1440, availWidth: 2560, availHeight: 1392, colorDepth: 24, pixelDepth: 24 }, devicePixelRatio: 1.5, outerWidth: 2560, outerHeight: 1392 };
const turn = () => new Promise(resolve => setImmediate(resolve));
function fixture(options = {}) {
  const environment = globals(options), changes = event(), removed = event(), calls = [], invalidations = [];
  let configuration = createApiConfiguration(), revision = 7, intercept = null;
  const api = { runtime: { id: 'owned', getURL: path => 'chrome-extension://owned/' + path, async sendMessage(request) {
    calls.push(structuredClone(request));
    if (intercept) return intercept(request);
    if (request.type === 'ui-api-config-set') {
      if (request.expectedRevision !== revision) return { type: 'api-config-error', code: 'stale-revision', message: 'Private backend detail' };
      configuration = structuredClone(request.configuration); revision++;
      changes.emit({ 'api-configuration:v1': { newValue: { revision, configuration } } }, 'local');
    }
    return { schemaVersion: 1, type: 'api-config-state', revision, configuration: structuredClone(configuration), registration: 'inactive', reloadRequired: false, earlyAccess: 'ready' };
  } }, storage: { onChanged: changes }, permissions: { onRemoved: removed } };
  const controller = createFingerprintProfilesController(api, { tabId: options.tabId ?? null, onInvalidate: value => invalidations.push(value) });
  return { environment, controller, changes, removed, calls, invalidations, setIntercept: value => { intercept = value; }, newer: () => { revision++; }, configuration: () => structuredClone(configuration), close() { controller.dispose(); environment.restore(); } };
}

// U1 deliberately replaced the old "no hardware / high-entropy probe" rule: this Options page now reads its own real browser facts
// (core count, screen, client hints) as local hints for the generator. A failing read must stay harmless, which this test pins.
test('loads a canonical state and bounded own browser metadata; failing hardware and client-hint reads are ignored and nothing is written', async () => {
  const f = fixture(); try {
    const state = await f.controller.load(); assert.equal(state.revision, 7); assert.equal(state.configuration.fingerprintProfiles.length, 0);
    assert.deepEqual(state.environment.uaData, { brands: [{ brand: 'Chromium', version: '153' }], mobile: false, platform: 'Windows' });
    assert.equal(f.environment.probes(), 2, 'the core count and the client-hint API were each tried once');
    for (const key of ['hardwareConcurrency', 'platformVersion', 'uaFullVersion', 'fullVersionList', 'screen', 'outer', 'devicePixelRatio']) assert.equal(Object.hasOwn(state.environment, key), false, key);
    assert.equal(state.environment.uaMajor, 153); assert.equal(state.environment.brand, 'chrome'); assert.equal(state.environment.platform, 'windows');
    assert.deepEqual(f.calls.map(call => call.type), ['ui-api-config-get']);
  } finally { f.close(); }
});

test('real environment: Chrome client hints, hardware, screen and window are read as bounded plain data and the old fields keep their meaning', async () => {
  const asked = [], f = fixture({ navigator: () => chromeNavigator({}, { getHighEntropyValues: async list => { asked.push([...list]); return { platformVersion: '19.0.0', uaFullVersion: '156.0.8078.80', fullVersionList: REAL_LIST, architecture: 'x86' }; } }), display: DISPLAY }); try {
    const state = await f.controller.load(), env = state.environment;
    assert.deepEqual(asked, [['platformVersion', 'uaFullVersion', 'fullVersionList']], 'only the three needed hints are requested, once');
    assert.deepEqual({ uaMajor: env.uaMajor, brand: env.brand, platform: env.platform, hardwareConcurrency: env.hardwareConcurrency, devicePixelRatio: env.devicePixelRatio, screen: env.screen, outer: env.outer, platformVersion: env.platformVersion, uaFullVersion: env.uaFullVersion, fullVersionList: env.fullVersionList },
      { uaMajor: 156, brand: 'chrome', platform: 'windows', hardwareConcurrency: 16, devicePixelRatio: 1.5, screen: { width: 2560, height: 1440, availWidth: 2560, availHeight: 1392, colorDepth: 24 }, outer: { width: 2560, height: 1392 }, platformVersion: '19.0.0', uaFullVersion: '156.0.8078.80', fullVersionList: REAL_LIST });
    assert.equal(env.timeZone, Intl.DateTimeFormat().resolvedOptions().timeZone);
    // Legacy fields: the raw navigator.platform string moved to navigatorPlatform because `platform` is now the OS family the generator compares.
    assert.equal(env.userAgent, CHROME_AGENT); assert.equal(env.navigatorPlatform, 'Win32'); assert.equal(env.vendor, 'Google Inc.'); assert.equal(env.language, 'en-US'); assert.deepEqual(env.languages, ['en-US', 'en']); assert.equal(env.hasOscpu, false);
    assert.deepEqual(env.uaData, { brands: [{ brand: 'Not:A-Brand', version: '8' }, { brand: 'Chromium', version: '156' }, { brand: 'Google Chrome', version: '156' }], mobile: false, platform: 'Windows' });
    assert.deepEqual(JSON.parse(JSON.stringify(env)), env, 'plain data without undefined placeholders');
    // The snapshot is a local hint: no request carries it, and a commit returns the same facts without asking the browser again.
    const next = await f.controller.commit(structuredClone(state.configuration), state.revision);
    assert.equal(next.environment.uaFullVersion, '156.0.8078.80'); assert.equal(asked.length, 1);
    for (const call of f.calls) assert.deepEqual(Object.keys(call).filter(key => !['schemaVersion', 'type', 'tabId', 'expectedRevision', 'configuration'].includes(key)), []);
    // (Configuration rows legitimately name APIs such as hardwareConcurrency, so only keys that exist solely in the snapshot are searched.)
    assert.equal(/"(?:uaMajor|navigatorPlatform|hasOscpu)"/u.test(JSON.stringify(f.calls)), false, 'no request carries a snapshot field');
  } finally { f.close(); }
});

test('real environment: Edge, other operating systems, Chromium without client hints and Firefox are told apart; missing facts stay absent', async () => {
  const cases = [
    { name: 'edge', navigator: () => chromeNavigator({ userAgent: CHROME_AGENT.replace('Safari/537.36', 'Safari/537.36 Edg/148.0.0.0') }, { brands: [{ brand: 'Not A;Brand', version: '99' }, { brand: 'Chromium', version: '148' }, { brand: 'Microsoft Edge', version: '148' }], getHighEntropyValues: async () => ({ platformVersion: '10.0.0' }) }), expect: { uaMajor: 148, brand: 'edge', platform: 'windows', platformVersion: '10.0.0' }, absent: ['uaFullVersion', 'fullVersionList'] },
    // Another Chromium vendor keeps the OS facts but its build numbers and brand list are not passed on (they would leak its own brand into a Chrome claim).
    { name: 'other chromium vendor', navigator: () => chromeNavigator({}, { brands: [{ brand: 'Not)A;Brand', version: '99' }, { brand: 'Chromium', version: '148' }, { brand: 'Opera', version: '100' }], getHighEntropyValues: async () => ({ platformVersion: '10.0.0', uaFullVersion: '100.0.4815.54', fullVersionList: [{ brand: 'Chromium', version: '148.0.8078.80' }, { brand: 'Opera', version: '100.0.4815.54' }] }) }), expect: { uaMajor: 148, brand: 'chrome', platform: 'windows', platformVersion: '10.0.0' }, absent: ['uaFullVersion', 'fullVersionList'] },
    { name: 'mac', navigator: () => chromeNavigator({ platform: 'MacIntel' }, { platform: 'macOS' }), expect: { uaMajor: 156, brand: 'chrome', platform: 'mac' }, absent: [] },
    { name: 'linux', navigator: () => chromeNavigator({ platform: 'Linux x86_64' }, { platform: 'Linux' }), expect: { platform: 'linux' }, absent: [] },
    { name: 'android keeps no family', navigator: () => chromeNavigator({ platform: 'Linux armv81' }, { platform: 'Android' }), expect: { uaMajor: 156, brand: 'chrome' }, absent: ['platform'] },
    { name: 'old Chromium without userAgentData', navigator: () => ({ userAgent: CHROME_AGENT.replace('156.', '120.'), appVersion: '5.0', platform: 'Win32', vendor: 'Google Inc.', language: 'en-US', languages: ['en-US'], hardwareConcurrency: 12 }), expect: { uaMajor: 120, brand: 'chrome', platform: 'windows', hardwareConcurrency: 12 }, absent: ['platformVersion', 'uaFullVersion', 'fullVersionList'], noHints: true },
    { name: 'firefox', navigator: () => ({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0', appVersion: '5.0 (Windows)', platform: 'Win32', vendor: '', language: 'en-US', languages: ['en-US'], oscpu: 'Windows NT 10.0; Win64; x64', hardwareConcurrency: 8 }), expect: { platform: 'windows', hardwareConcurrency: 8, hasOscpu: true }, absent: ['uaMajor', 'brand', 'platformVersion'], noHints: true }];
  for (const { name, navigator, expect, absent, noHints } of cases) {
    const f = fixture({ navigator }); try {
      const env = (await f.controller.load()).environment;
      for (const [key, value] of Object.entries(expect)) assert.equal(env[key], value, name + '/' + key);
      for (const key of absent) assert.equal(Object.hasOwn(env, key), false, name + '/' + key + ' stays absent');
      if (noHints) assert.equal(env.uaData, null, name);
    } finally { f.close(); }
  }
});

test('real environment: hostile or oversized values are dropped and lists stay within bounds', async () => {
  const long = Array.from({ length: 100 }, (_, index) => ({ brand: 'Brand ' + index, version: '1.0.' + index }));
  const f = fixture({ navigator: () => chromeNavigator({ hardwareConcurrency: 1e9 }, { getHighEntropyValues: async () => ({ platformVersion: 'x'.repeat(100), uaFullVersion: '156;DROP TABLE', fullVersionList: [...long, { brand: 'x'.repeat(500), version: '1.0' }, null, 7] }) }), display: { screen: { width: -5, height: 'tall', availWidth: 1e9 }, devicePixelRatio: 99, outerWidth: 0, outerHeight: 700 } }); try {
    const env = (await f.controller.load()).environment;
    for (const key of ['hardwareConcurrency', 'devicePixelRatio', 'screen', 'outer', 'platformVersion', 'uaFullVersion']) assert.equal(Object.hasOwn(env, key), false, key);
    assert.equal(env.fullVersionList.length, 16); assert.deepEqual(env.fullVersionList[0], { brand: 'Brand 0', version: '1.0.0' });
    assert.ok(env.fullVersionList.every(item => item.brand.length <= 128 && /^\d+(?:\.\d+){0,3}$/u.test(item.version)));
  } finally { f.close(); }
  // Malformed entries are filtered one by one; the valid one survives.
  const mixed = fixture({ navigator: () => chromeNavigator({}, { getHighEntropyValues: async () => ({ platformVersion: '15.0.0', fullVersionList: [null, 7, { brand: 'x'.repeat(500), version: '1.0' }, { brand: 'ok', version: 'not-a-version' }, { brand: 'Chromium', version: '156.0.8078.80' }] }) }) }); try {
    const env = (await mixed.controller.load()).environment; assert.deepEqual(env.fullVersionList, [{ brand: 'Chromium', version: '156.0.8078.80' }]); assert.equal(env.platformVersion, '15.0.0');
  } finally { mixed.close(); }
  // Version strings must have Chrome's shape: a platformVersion is x.y.z, a full version has two to four numeric parts.
  for (const [hints, expected] of [[{ platformVersion: '10', uaFullVersion: '156' }, {}], [{ platformVersion: '10.0.0.0', uaFullVersion: '156.0.8078.80.1' }, {}], [{ platformVersion: '19.0.0', uaFullVersion: '156.0.8078.80' }, { platformVersion: '19.0.0', uaFullVersion: '156.0.8078.80' }], [{ platformVersion: '99999.0.0', uaFullVersion: '156.0.8078.800000' }, {}]]) {
    const shaped = fixture({ navigator: () => chromeNavigator({}, { getHighEntropyValues: async () => hints }) }); try {
      const env = (await shaped.controller.load()).environment; assert.equal(env.platformVersion, expected.platformVersion, JSON.stringify(hints)); assert.equal(env.uaFullVersion, expected.uaFullVersion, JSON.stringify(hints));
    } finally { shaped.close(); }
  }
  // Not a number, not finite or out of range: each is skipped on its own while the valid facts around it survive.
  for (const [value, expected] of [[NaN, undefined], [0, undefined], [-4, undefined], [1.5, undefined], ['8', undefined], [1025, undefined], [8, 8], [1024, 1024]]) {
    const g = fixture({ navigator: () => chromeNavigator({ hardwareConcurrency: value }) }); try { assert.equal((await g.controller.load()).environment.hardwareConcurrency, expected, String(value)); } finally { g.close(); }
  }
});

test('a hung client-hint read is abandoned after 500 ms, its late failure is swallowed and the other facts are still returned', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let rejectLate; const f = fixture({ navigator: () => chromeNavigator({}, { getHighEntropyValues: () => new Promise((_, reject) => { rejectLate = reject; }) }) }); try {
    const pending = f.controller.load(); let settled = false; pending.then(() => { settled = true; }, () => { settled = true; });
    for (let index = 0; index < 5; index++) await turn();
    assert.equal(settled, false, 'the load waits for the client hints within the limit');
    t.mock.timers.tick(499); await turn(); assert.equal(settled, false, 'still inside the 500 ms limit');
    t.mock.timers.tick(1); const state = await pending;
    assert.equal(state.environment.uaMajor, 156); assert.equal(state.environment.hardwareConcurrency, 16);
    for (const key of ['platformVersion', 'uaFullVersion', 'fullVersionList']) assert.equal(Object.hasOwn(state.environment, key), false, key);
    rejectLate(new Error('late failure')); await turn(); await turn();
    // The abandoned read is not retried by later loads (one bounded attempt per view).
    const again = await f.controller.load(); assert.equal(Object.hasOwn(again.environment, 'platformVersion'), false);
  } finally { f.close(); }
});

test('client hints are read once per view, and a throwing or absent API never fails the load', async () => {
  let calls = 0; const f = fixture({ navigator: () => chromeNavigator({}, { getHighEntropyValues: async () => { calls++; return { platformVersion: '15.0.0' }; } }) }); try {
    const first = await f.controller.load(); const second = await f.controller.load();
    assert.equal(calls, 1); assert.equal(first.environment.platformVersion, '15.0.0'); assert.equal(second.environment.platformVersion, '15.0.0');
  } finally { f.close(); }
  const g = fixture({ navigator: () => chromeNavigator({}, { getHighEntropyValues: () => { throw Error('blocked by policy'); } }) }); try { assert.equal(Object.hasOwn((await g.controller.load()).environment, 'platformVersion'), false); } finally { g.close(); }
  const h = fixture({ navigator: () => chromeNavigator({}, { getHighEntropyValues: undefined }) }); try { assert.equal((await h.controller.load()).environment.uaMajor, 156); } finally { h.close(); }
  const i = fixture({ navigator: () => chromeNavigator({}, { getHighEntropyValues: async () => null }) }); try { assert.equal((await i.controller.load()).environment.uaMajor, 156); } finally { i.close(); }
});
test('foreign paths/origins, child frames and invalid target tabs cannot read or commit', async () => {
  for (const options of [{ url: 'https://owned/options.html' }, { url: 'chrome-extension://other/options.html' }, { url: 'chrome-extension://owned/popup.html' }, { framed: true }, { tabId: -1 }]) {
    const f = fixture(options); try { await assert.rejects(f.controller.load(), error => error.code === 'inactive'); assert.equal(f.calls.length, 0); } finally { f.close(); }
  }
});
test('named snapshot uses exactly one existing CAS write, retains master and returns registration accurately', async () => {
  const f = fixture(); try {
    const state = await f.controller.load(), snapshot = snapshotFingerprintProfile(state.configuration, 'Own', 'fp-' + '12'.repeat(16));
    const next = await f.controller.commit(storeFingerprintProfile(state.configuration, snapshot), state.revision);
    assert.equal(next.revision, 8); assert.equal(next.registration, 'inactive'); assert.equal(next.configuration.enabled, false);
    assert.deepEqual(next.configuration.apis, state.configuration.apis); assert.equal(next.configuration.fingerprintProfiles.length, 1);
    assert.deepEqual(f.calls.map(call => call.type), ['ui-api-config-get', 'ui-api-config-set']); assert.equal(f.calls[1].expectedRevision, 7);
    assert.equal(f.invalidations.length, 0, 'an owned write does not invalidate its own response');
  } finally { f.close(); }
});
test('stale revisions and storage invalidation cannot overwrite a newer configuration', async () => {
  const f = fixture(); try {
    const state = await f.controller.load(); f.newer();
    await assert.rejects(f.controller.commit(state.configuration, state.revision), error => error.code === 'stale-revision');
    await f.controller.load(); const before = f.calls.length; f.changes.emit({ 'api-configuration:v1': {} }, 'local');
    await assert.rejects(f.controller.commit(state.configuration, state.revision), error => error.code === 'stale-revision');
    assert.equal(f.calls.length, before); assert.equal(f.invalidations.length, 1);
  } finally { f.close(); }
});
test('late reads are discarded after hiding or permission revocation and event listeners are removed', async () => {
  const f = fixture(); try {
    let release; f.setIntercept(() => new Promise(resolve => { release = resolve; })); const pending = f.controller.load();
    f.controller.setVisible(false); release({}); await assert.rejects(pending, error => error.code === 'inactive');
    f.controller.setVisible(true); f.setIntercept(null); await f.controller.load(); f.removed.emit({ permissions: ['userScripts'] });
    await assert.rejects(f.controller.commit(f.configuration(), 7), error => error.code === 'stale-revision');
    assert.equal(f.changes.size(), 1); assert.equal(f.removed.size(), 1); f.controller.dispose(); assert.equal(f.changes.size(), 0); assert.equal(f.removed.size(), 0);
    await assert.rejects(f.controller.load(), error => error.code === 'inactive');
  } finally { f.close(); }
});
test('concurrent commits are fenced and failed application is returned as an error state without false rollback', async () => {
  const f = fixture(); try {
    const state = await f.controller.load(); let release;
    f.setIntercept(() => new Promise(resolve => { release = resolve; })); const pending = f.controller.commit(state.configuration, 7);
    await assert.rejects(f.controller.commit(state.configuration, 7), error => error.code === 'busy');
    release({ schemaVersion: 1, type: 'api-config-state', revision: 8, configuration: state.configuration, registration: 'error', reloadRequired: true });
    const result = await pending; assert.equal(result.registration, 'error'); assert.equal(result.revision, 8); assert.equal(result.reloadRequired, true);
  } finally { f.close(); }
});
test('malformed responses and unsafe drafts are rejected before any write', async () => {
  const f = fixture(); try {
    const state = await f.controller.load(), next = structuredClone(state.configuration); next.fingerprintProfiles = [{ id: 'unknown' }];
    await assert.rejects(f.controller.commit(next, 7), error => error.code === 'invalid-profile'); assert.equal(f.calls.length, 1);
    for (const response of [{ type: 'api-config-error', code: 'private-code', message: 'Sensitive data' }, { schemaVersion: 1, type: 'api-config-state', revision: 8, configuration: state.configuration, registration: 'unknown', reloadRequired: false }]) {
      f.setIntercept(() => response); await assert.rejects(f.controller.load(), error => error.code === 'operation-failed');
    }
  } finally { f.close(); }
});

test('a delayed storage echo of the accepted own write is not an external change, while any other revision still invalidates', async () => {
  const f = fixture(); try {
    const state = await f.controller.load(), next = structuredClone(state.configuration);
    const committed = await f.controller.commit(next, state.revision);
    // Delivered after the reply (busy is already false): the same revision as the accepted state.
    f.changes.emit({ 'api-configuration:v1': { newValue: { revision: committed.revision, configuration: committed.configuration } } }, 'local');
    assert.equal(f.invalidations.length, 0, 'the own echo does not lock the panel');
    await f.controller.commit(structuredClone(committed.configuration), committed.revision);
    assert.equal(f.invalidations.length, 0, 'the next commit still works without a refresh');
    f.changes.emit({ 'api-configuration:v1': { newValue: { revision: committed.revision + 5, configuration: committed.configuration } } }, 'local');
    assert.equal(f.invalidations.length, 1, 'a different revision is external');
    await assert.rejects(f.controller.commit(structuredClone(committed.configuration), committed.revision + 1), error => error.code === 'stale-revision');
  } finally { f.close(); }
});
