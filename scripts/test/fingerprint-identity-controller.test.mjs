// ADR-107 round 5: what the Options controller adds for the profile library: the temporary profile flow (record before write, never stacked,
// restored over the current state), the trash and link stores behind the exact-page guard, and the saved-proxy list with the explicit connect.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApiConfiguration, updateApiConfiguration } from '../../apps/production-extension/api-configuration.js';
import { applyFingerprintProfile, generateConsistentDevice, snapshotFingerprintProfile, storeFingerprintProfile } from '../../apps/production-extension/fingerprint-profiles.js';
import { createFingerprintProfilesController, describeProxyList, loadProxySnapshot, readProxyState, PROXY_LIST_MAX } from '../../apps/production-extension/fingerprint-profiles-controller.js';
import { TEMPORARY_KEY, TEMPORARY_LIVE_KEY } from '../../apps/production-extension/fingerprint-temporary.js';
import { TRASH_KEY } from '../../apps/production-extension/fingerprint-trash.js';
import { BUNDLES_KEY } from '../../apps/production-extension/identity-bundles.js';
import { device, library, clone, fakeStorage, turn, ENVIRONMENT } from './fingerprint-identity-fixtures.mjs';

function defineGlobals(values) {
  const previous = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  return () => { for (const [key, descriptor] of previous) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; };
}
const generated = (seed, protection = 'balanced') => generateConsistentDevice(createApiConfiguration(), { deviceType: 'desktop', os: 'windows-11', browser: 'chrome', version: 153, protection, seed }, ENVIRONMENT).configuration;

// The Options page with a fake service worker that applies the configuration writes like the real CAS (revision check, same reply shapes).
function fixture({ session = {}, initial = generated(5), url = 'chrome-extension://owned/options.html#antidetect', proxy = null, noLocal = false, proxyTimeoutMs = 50 } = {}) {
  const own = {}; own.top = own;
  const restore = defineGlobals({ location: { href: url }, window: own, navigator: { userAgent: 'Mozilla/5.0 Chrome/153.0.0.0', language: 'en-US', languages: ['en-US'] }, performance: {} });
  const storage = fakeStorage({ session }), order = [], calls = [];
  // One ordered trace of storage writes and configuration writes, to prove the order of the two-step flows.
  for (const area of ['local', 'session']) if (storage[area]) for (const name of ['set', 'remove']) { const original = storage[area][name]; storage[area][name] = async (...args) => { order.push(area + '.' + name); return original(...args); }; }
  let configuration = initial, revision = 7, failNext = null, intercept = null;
  const api = {
    runtime: { id: 'owned', getURL: path => 'chrome-extension://owned/' + path, async sendMessage(request) {
      calls.push(clone(request)); order.push('message:' + request.type);
      if (intercept) return intercept(request);
      if (request.type === 'ui-api-config-set') {
        if (failNext) { const code = failNext; failNext = null; return { type: 'api-config-error', code, message: 'private detail' }; }
        if (request.expectedRevision !== revision) return { type: 'api-config-error', code: 'stale-revision', message: 'private detail' };
        configuration = clone(request.configuration); revision++;
        storage.onChanged && void 0;
      }
      return { schemaVersion: 1, type: 'api-config-state', revision, configuration: clone(configuration), registration: 'inactive', reloadRequired: false, earlyAccess: 'ready' };
    } },
    storage: noLocal ? { onChanged: storage.onChanged } : { local: storage.local, session: storage.session, onChanged: storage.onChanged }, permissions: { onRemoved: { addListener() {}, removeListener() {} } } };
  const proxyCalls = [];
  const proxyFactory = (target, options) => { proxyCalls.push({ target, options }); if (!proxy) throw new Error('no proxy port in this fixture'); return typeof proxy === 'function' ? proxy(proxyCalls.length) : proxy; };
  const controller = createFingerprintProfilesController(api, { proxyFactory, gpuTimeoutMs: 20, proxyTimeoutMs });
  return { api, storage, order, calls, controller, proxyCalls, configuration: () => clone(configuration), revision: () => revision, setConfiguration: value => { configuration = value; revision++; }, failNext: code => { failNext = code; }, setIntercept: value => { intercept = value; }, close() { controller.dispose(); restore(); } };
}
const settle = async () => { for (let index = 0; index < 6; index++) await turn(); await new Promise(resolve => setTimeout(resolve, 60)); for (let index = 0; index < 6; index++) await turn(); };
const rowsOf = configuration => configuration.apis.map(row => [row.id, row.mode, row.selected]);

test('starting a temporary profile writes the marker and the record BEFORE the configuration, and remembers the SAVED rows as a profile snapshot', async () => {
  const f = fixture(); try {
    const state = await f.controller.load(), before = rowsOf(state.configuration), temp = generated(99, 'strict');
    f.order.length = 0;
    const result = await f.controller.temporary.start(temp, '  Trip to Berlin ');
    assert.deepEqual(f.order.filter(entry => !entry.startsWith('message:ui-api-config-get')), ['session.set', 'local.set', 'message:ui-api-config-set'], 'bookkeeping first, then the one revision-checked write');
    assert.deepEqual(result.temporary.label, 'Trip to Berlin'); assert.equal(result.temporary.active, true); assert.ok(Number.isSafeInteger(result.temporary.startedAt));
    const record = f.storage.data.local[TEMPORARY_KEY]; assert.deepEqual(Object.keys(record), ['version', 'startedAt', 'label', 'previous']);
    assert.deepEqual(rowsOf({ apis: record.previous.apis }), before, 'previous holds exactly the applied rows before'); assert.match(record.previous.id, /^fp-[a-f0-9]{32}$/u); assert.deepEqual(record.previous.tags, []); assert.equal(record.previous.note, '');
    assert.deepEqual(f.storage.data.session[TEMPORARY_LIVE_KEY], { version: 1, startedAt: record.startedAt });
    assert.deepEqual(rowsOf(f.configuration()), rowsOf(temp), 'the temporary rows are applied'); assert.deepEqual(f.configuration().fingerprintProfiles, [], 'a generated identity is NOT added to the library');
    const read = await f.controller.temporary.read(); assert.deepEqual({ ...read }, { active: true, label: 'Trip to Berlin', startedAt: record.startedAt, live: true });
  } finally { f.close(); }
});

test('a library profile applied temporarily leaves the library as it was; the stored record carries nothing but the remembered rows', async () => {
  const profile = device('From the library', { id: 'fp-' + 'ab'.repeat(16), seed: 21, tags: ['x'], note: 'n' }), f = fixture({ initial: library([profile], generated(5)) }); try {
    const state = await f.controller.load(), applied = applyFingerprintProfile(state.configuration, profile.id);
    await f.controller.temporary.start(applied, profile.label);
    assert.deepEqual(f.configuration().fingerprintProfiles, state.configuration.fingerprintProfiles, 'the library is untouched');
    assert.deepEqual(Object.keys(f.storage.data.local).sort(), [TEMPORARY_KEY], 'one small key besides the configuration (which lives in the service worker)');
    assert.equal(JSON.stringify(f.storage.data.local[TEMPORARY_KEY]).includes('From the library'), true, 'the label is the profile name');
  } finally { f.close(); }
});

test('a second temporary profile never stacks: the ORIGINAL remembered state stays, only the label and time change', async () => {
  const f = fixture(); try {
    const state = await f.controller.load(), original = rowsOf(state.configuration);
    await f.controller.temporary.start(generated(11), 'First');
    const first = clone(f.storage.data.local[TEMPORARY_KEY]);
    await new Promise(resolve => setTimeout(resolve, 3)); await f.controller.temporary.start(generated(12, 'strict'), 'Second');
    const second = f.storage.data.local[TEMPORARY_KEY];
    assert.deepEqual(second.previous, first.previous, 'the snapshot of the very first state, not of the first temporary one'); assert.deepEqual(rowsOf({ apis: second.previous.apis }), original);
    assert.equal(second.label, 'Second'); assert.ok(second.startedAt >= first.startedAt);
    const ended = await f.controller.temporary.end(); assert.deepEqual(rowsOf(ended.state.configuration), original, 'ending returns to the original, not to the first temporary identity');
  } finally { f.close(); }
});

test('ending restores the remembered rows over the CURRENT saved state: masters and library changes made meanwhile stay, the record and marker go', async () => {
  const f = fixture(); try {
    const state = await f.controller.load(), original = rowsOf(state.configuration);
    await f.controller.temporary.start(generated(31), 'Trip');
    // Meanwhile the user switched a master on and saved a profile into the library (through the same CAS path).
    const during = clone(f.configuration()); during.antidetectEnabled = true; const withProfile = storeFingerprintProfile(during, snapshotFingerprintProfile(generated(77), 'Saved meanwhile', 'fp-' + 'cd'.repeat(16)));
    f.setConfiguration(withProfile); await f.controller.load();
    const ended = await f.controller.temporary.end();
    assert.equal(ended.ended, true); assert.deepEqual(rowsOf(ended.state.configuration), original); assert.equal(ended.state.configuration.antidetectEnabled, true); assert.deepEqual(ended.state.configuration.fingerprintProfiles.map(profile => profile.label), ['Saved meanwhile']);
    assert.equal(Object.hasOwn(f.storage.data.local, TEMPORARY_KEY), false); assert.equal(Object.hasOwn(f.storage.data.session, TEMPORARY_LIVE_KEY), false);
    assert.deepEqual({ ...(await f.controller.temporary.read()) }, { active: false, label: '', startedAt: null, live: false });
    const again = await f.controller.temporary.end(); assert.equal(again.ended, false, 'nothing to end');
  } finally { f.close(); }
});

test('a refused write leaves no trace: no record when there was none, the old record back when there was one', async () => {
  const f = fixture(); try {
    await f.controller.load(); f.failNext('early-access-required');
    await assert.rejects(f.controller.temporary.start(generated(41), 'Refused'), error => error.code === 'early-access-required' || error.code === 'operation-failed');
    assert.equal(Object.hasOwn(f.storage.data.local, TEMPORARY_KEY), false); assert.equal(Object.hasOwn(f.storage.data.session, TEMPORARY_LIVE_KEY), false);
    await f.controller.temporary.start(generated(42), 'Accepted'); const accepted = clone(f.storage.data.local[TEMPORARY_KEY]);
    await new Promise(resolve => setTimeout(resolve, 3)); f.failNext('privacy-permission-required');
    await assert.rejects(f.controller.temporary.start(generated(43), 'Refused again'));
    assert.deepEqual(f.storage.data.local[TEMPORARY_KEY], accepted, 'the earlier temporary profile is exactly as it was');
    f.failNext('storage-error'); await assert.rejects(f.controller.temporary.end());
    assert.deepEqual(f.storage.data.local[TEMPORARY_KEY], accepted, 'a failed End keeps the record, so ending can be tried again');
  } finally { f.close(); }
});

test('guards: not offered without session storage, a bad label or configuration is refused before anything is written, and the stale or hidden view is refused', async () => {
  const none = fixture({ session: null }); try {
    await none.controller.load(); assert.equal(none.controller.temporary.available(), false);
    await assert.rejects(none.controller.temporary.start(generated(1), 'x'), error => error.code === 'operation-failed'); assert.deepEqual(none.storage.log, []);
  } finally { none.close(); }
  const f = fixture(); try {
    await assert.rejects(f.controller.temporary.start(generated(1), 'x'), error => error.code === 'stale-revision', 'before the first load there is no saved state');
    await f.controller.load();
    await assert.rejects(f.controller.temporary.start(generated(1), '   '), error => error.code === 'invalid-value');
    await assert.rejects(f.controller.temporary.start(generated(1), String.fromCodePoint(0x202e)), error => error.code === 'invalid-value', 'a label of refused characters is no label');
    await assert.rejects(f.controller.temporary.start({ not: 'a configuration' }, 'x'), error => error.code === 'invalid-profile');
    assert.deepEqual(f.storage.log, [], 'nothing was written by any refused start');
    f.controller.setVisible(false); await assert.rejects(f.controller.temporary.start(generated(1), 'x'), error => error.code === 'inactive'); await assert.rejects(f.controller.temporary.end(), error => error.code === 'inactive');
  } finally { f.close(); }
  const foreign = fixture({ url: 'https://evil.example/options.html' }); try { await assert.rejects(foreign.controller.temporary.read(), error => error.code === 'inactive'); await assert.rejects(foreign.controller.trash.read([]), error => error.code === 'inactive'); } finally { foreign.close(); }
});

test('the trash and link stores sit behind the exact-page guard and are not offered without storage.local', async () => {
  const f = fixture(); try {
    await f.controller.load(); const profile = device('Gone', { id: 'fp-' + 'ee'.repeat(16) });
    assert.equal((await f.controller.trash.add(profile, 2, [])).items.length, 1); assert.equal((await f.controller.trash.read([])).length, 1); assert.deepEqual((await f.controller.trash.remove(profile.id)), []); assert.equal(Object.hasOwn(f.storage.data.local, TRASH_KEY), false);
    await f.controller.trash.add(profile, 0, []); assert.deepEqual(await f.controller.trash.empty(), []);
    const linked = await f.controller.bundles.link('fp-' + '11'.repeat(16), 'proxy-a', {}); assert.deepEqual({ ...linked }, { ['fp-' + '11'.repeat(16)]: 'proxy-a' }); assert.ok(Object.hasOwn(f.storage.data.local, BUNDLES_KEY));
    assert.deepEqual({ ...await f.controller.bundles.unlink('fp-' + '11'.repeat(16), {}) }, {});
    let seen = 0; const stop = f.controller.trash.watch(() => { seen++; }); await f.controller.trash.add(profile, 0, []); assert.equal(seen, 1); stop();
    f.controller.setVisible(false); await assert.rejects(f.controller.trash.add(profile, 0, []), error => error.code === 'inactive'); await assert.rejects(f.controller.bundles.read(null), error => error.code === 'inactive');
  } finally { f.close(); }
  const bare = fixture({ noLocal: true }); try { assert.equal(bare.controller.trash, null); assert.equal(bare.controller.bundles, null); } finally { bare.close(); }
});

// --- the saved proxies --------------------------------------------------------------------------------------------------
const PROFILES = [
  { id: 'proxy-de', name: 'Berlin exit', type: 'socks5', host: 'de.example', port: 1080, native: true, country: 'DE' },
  { id: 'proxy-us', name: 'Plain HTTP', type: 'http', host: 'us.example', port: 8080, native: false },
  { id: 'proxy-xx', name: 'Odd', type: 'vless', host: null, port: null, native: true, country: 'jp' }];
const snapshot = (overrides = {}) => ({ configuration: { profiles: PROFILES, protectWebRTC: true, disablePrediction: false, autoConnect: false, killSwitch: true }, status: { state: 'off' }, host: { available: true }, ...overrides });
const client = (overrides = {}) => ({ load: async () => snapshot(), requestAccess: async () => snapshot(), connect: async () => snapshot(), dispose() {}, ...overrides });

test('describeProxyList keeps id, name, type, host, port, the native flag and a valid country tag, and nothing else', () => {
  const secret = snapshot({ configuration: { profiles: PROFILES.map(profile => ({ ...profile, username: 'user', password: 'hunter2', uri: 'vless://secret', config: 'secret' })), protectWebRTC: false, disablePrediction: true }, status: { state: 'connected', profileId: 'proxy-us' } });
  const list = describeProxyList(secret);
  assert.deepEqual(list.profiles, [{ id: 'proxy-de', name: 'Berlin exit', type: 'socks5', host: 'de.example', port: 1080, native: true, country: 'DE' }, { id: 'proxy-us', name: 'Plain HTTP', type: 'http', host: 'us.example', port: 8080, native: false }, { id: 'proxy-xx', name: 'Odd', type: 'vless', host: null, port: null, native: true }]);
  assert.equal(JSON.stringify(list).includes('hunter2'), false); assert.equal(JSON.stringify(list).includes('vless://'), false);
  assert.equal(list.connectedId, 'proxy-us'); assert.equal(list.privacy, true);
  assert.equal(describeProxyList(snapshot({ status: { state: 'connected', profileId: 'unknown' } })).connectedId, null); assert.equal(describeProxyList(snapshot({ status: { state: 'off', profileId: 'proxy-us' } })).connectedId, null);
  assert.equal(describeProxyList(snapshot({ configuration: { profiles: PROFILES, protectWebRTC: false, disablePrediction: false } })).privacy, false);
  assert.equal(describeProxyList({}), undefined); assert.equal(describeProxyList(null), undefined); assert.equal(describeProxyList({ configuration: { profiles: 'x' } }), undefined);
  const hostile = describeProxyList(snapshot({ configuration: { profiles: [null, 5, {}, { id: 5 }, { id: 'a'.repeat(65) }, { id: 'ok', name: 'n'.repeat(500), type: {}, host: 7, port: 70000, native: 'yes' }] } }));
  assert.deepEqual(hostile.profiles, [{ id: 'ok', name: '', type: '', host: null, port: null, native: false }]);
  assert.equal(describeProxyList(snapshot({ configuration: { profiles: Array.from({ length: 500 }, (_, index) => ({ id: 'p' + index, name: 'n', type: 'http', host: 'h', port: 1, native: false })) } })).profiles.length, PROXY_LIST_MAX);
  let ran = false; const accessor = { id: 'x' }; Object.defineProperty(accessor, 'name', { enumerable: true, get() { ran = true; return 'n'; } });
  assert.equal(describeProxyList(snapshot({ configuration: { profiles: [accessor] } })).profiles[0].name, '', 'the accessor value is not read'); assert.equal(ran, false);
});

test('the connected proxy state carries the profile country tag only for a connected profile that has a valid one', async () => {
  const state = async snap => readProxyState({}, () => client({ load: async () => snap }), {});
  assert.deepEqual(await state(snapshot({ status: { state: 'connected', profileId: 'proxy-de' } })), { state: 'connected', country: 'DE' });
  assert.deepEqual(await state(snapshot({ status: { state: 'connected', profileId: 'proxy-us' } })), { state: 'connected' }, 'no tag');
  assert.deepEqual(await state(snapshot({ status: { state: 'connected', profileId: 'proxy-xx' } })), { state: 'connected' }, 'a malformed tag');
  assert.deepEqual(await state(snapshot({ status: { state: 'connected', profileId: 'nope' } })), { state: 'connected' });
  assert.deepEqual(await state(snapshot({ status: { state: 'off', profileId: 'proxy-de' } })), { state: 'disconnected' }, 'a tag only counts while that proxy is connected');
  assert.deepEqual(await state(snapshot({ status: { state: 'conflict' } })), { state: 'conflict' });
  assert.equal(await loadProxySnapshot({}, () => client({ load: async () => ({}) }), {}), undefined);
});

test('the page reads the proxy port once: the same answer feeds the hints and the list; Refresh reads again', async () => {
  const f = fixture({ proxy: client({ load: async () => snapshot({ status: { state: 'connected', profileId: 'proxy-de' } }) }) }); try {
    const state = await f.controller.load(); void state; await settle();
    assert.equal(f.proxyCalls.length, 1, 'one port read at open');
    assert.equal(f.controller.environment().proxy.country, 'DE'); assert.equal(f.controller.environment().proxy.state, 'connected');
    const list = await f.controller.proxies.load(); assert.equal(f.proxyCalls.length, 1, 'served from that answer'); assert.equal(list.connectedId, 'proxy-de'); assert.equal(list.profiles.length, 3);
    await f.controller.proxies.load({ fresh: true }); assert.equal(f.proxyCalls.length, 2, 'Refresh asks again');
  } finally { f.close(); }
  const down = fixture({ proxy: null }); try { await down.controller.load(); await settle(); assert.equal(await down.controller.proxies.load(), null, 'no answer is null, not an error'); } finally { down.close(); }
  const slow = fixture({ proxy: client({ load: () => new Promise(() => {}) }), proxyTimeoutMs: 20 }); try { await slow.controller.load(); await settle(); assert.equal(await slow.controller.proxies.load({ fresh: true }), null, 'a hung port is not a list'); } finally { slow.close(); }
});

test('connecting is explicit: access is requested first inside the click, finish() connects only when it was granted, and nothing is saved', async () => {
  const events = [];
  const f = fixture({ proxy: () => client({
    requestAccess: async options => { events.push(['access', options]); return snapshot(); },
    connect: async id => { events.push(['connect', id]); return snapshot({ status: { state: 'connected', profileId: id } }); }, dispose() { events.push(['dispose']); } }) });
  try {
    await f.controller.load(); await settle(); events.length = 0;
    const attempt = f.controller.proxies.begin(PROFILES[0]);
    assert.deepEqual(events.map(entry => entry[0]), ['access'], 'the permissions are requested before anything else, inside the click'); assert.deepEqual(events[0][1], { native: true, privacy: true });
    assert.deepEqual(await attempt.finish(), { ok: true }); assert.deepEqual(events.map(entry => entry[0]), ['access', 'connect', 'dispose']); assert.deepEqual(events[1], ['connect', 'proxy-de']);
    assert.equal((await f.controller.proxies.load()).connectedId, 'proxy-de', 'the list follows the new state');
    assert.deepEqual(Object.keys(f.storage.data.local), [], 'no setting of ours changed; the Proxy workspace owns its configuration');
    assert.equal(f.calls.every(call => call.type === 'ui-api-config-get'), true);
  } finally { f.close(); }
  events.length = 0;
  const denied = fixture({ proxy: () => client({ requestAccess: async () => { throw Object.assign(new Error('x'), { code: 'permission-denied' }); }, connect: async () => { events.push('connect'); return snapshot(); }, dispose() { events.push('dispose'); } }) });
  try {
    await denied.controller.load(); await settle(); events.length = 0;
    assert.deepEqual(await denied.controller.proxies.begin(PROFILES[1]).finish(), { ok: false, code: 'permission-denied' }); assert.deepEqual(events, ['dispose'], 'a refused permission never connects');
  } finally { denied.close(); }
  const failing = fixture({ proxy: () => client({ connect: async () => snapshot({ status: { state: 'error', code: 'timeout' } }) }) });
  try { await failing.controller.load(); await settle(); assert.deepEqual(await failing.controller.proxies.begin(PROFILES[1]).finish(), { ok: false, code: 'timeout' }); } finally { failing.close(); }
  const other = fixture({ proxy: () => client({ connect: async () => snapshot({ status: { state: 'connected', profileId: 'another' } }) }) });
  try { await other.controller.load(); await settle(); assert.equal((await other.controller.proxies.begin(PROFILES[1]).finish()).ok, false, 'connected to a different proxy is not the answer to this click'); } finally { other.close(); }
  const throwing = fixture({ proxy: () => ({ requestAccess() { throw new Error('sync failure'); }, connect: async () => snapshot(), dispose() {} }) });
  try { await throwing.controller.load(); await settle(); assert.deepEqual(await throwing.controller.proxies.begin(PROFILES[1]).finish(), { ok: false, code: 'operation-failed' }, 'finish never throws'); } finally { throwing.close(); }
  const cancelled = fixture({ proxy: () => client({ dispose() { events.push('cancelled-dispose'); } }) });
  try { await cancelled.controller.load(); await settle(); events.length = 0; cancelled.controller.proxies.begin(PROFILES[1]).cancel(); assert.deepEqual(events, ['cancelled-dispose']); } finally { cancelled.close(); }
  void updateApiConfiguration;
});
