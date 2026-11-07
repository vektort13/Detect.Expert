// ADR-048: independent privileged-boundary, transaction and lifecycle review.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { ApiConfigurationController, API_CONFIGURATION_STORAGE_KEY, customEntries, mergeLegacyConfiguration } from '../../apps/production-extension/api-configuration-controller.js';
import { API_CONFIG_CATALOG, API_CONFIG_CATALOG_V1, API_CONFIGURATION_VERSION, API_CONFIGURATION_CATALOG_VERSION, API_CONFIGURATION_MAX_BYTES, createApiConfiguration, updateApiConfiguration, upgradeApiConfiguration, configurationToLegacy } from '../../packages/contracts/src/api-configuration.mjs';
import { WASM_SURFACES } from '../../packages/contracts/src/webassembly-apis.mjs';
import { buildApiCustomScripts, API_CUSTOM_SCRIPT_PREFIX } from '../../apps/production-extension/api-custom-registration.js';
import { snapshotFingerprintProfile, storeFingerprintProfile, renameFingerprintProfile, deleteFingerprintProfile } from '../../apps/production-extension/fingerprint-profiles.js';

const copy = value => JSON.parse(JSON.stringify(value));
const value = raw => ({ kind: 'value', value: raw });
const legacySettings = enabled => ({ schemaVersion: 1, revision: 0, enabled, preset: 'limited', global: [], sites: [] });
function change(config, id, patch, host = null) {
  const read = updateApiConfiguration(config, id, patch, host);
  assert.equal(read.ok, true, read.error?.message); return read.value;
}
function fixture({ enabled = false, open = false, firefox = false, browserVersion = '138' } = {}) {
  const stored = {}, writes = [], registrations = new Map(), obsoleteRegistrations = new Map(), messages = [], executions = [], registrationOperations = [];
  let failStorage = false, dropRegistration = false, earlyAvailable = true, controller;
  const origin = firefox ? 'moz-extension://test-private-uuid' : 'chrome-extension://test-extension';
  const userCalls = { get: 0, register: 0, update: 0, unregister: 0 };
  const api = {
    runtime: { id: 'test-extension', getURL: path => origin + '/' + path, getManifest: () => ({ manifest_version: 3, permissions: firefox ? [] : ['userScripts'], optional_permissions: firefox ? ['userScripts'] : [] }),
      ...(firefox ? { getBrowserInfo: async () => ({ name: 'Firefox', version: browserVersion }) } : {}) },
    storage: { local: {
      async get(key) { return Object.hasOwn(stored, key) ? { [key]: copy(stored[key]) } : {}; },
      async set(items) { if (failStorage) throw new Error('disk full'); writes.push(copy(items)); Object.assign(stored, copy(items)); }
    } },
    scripting: {
      async getRegisteredContentScripts({ ids } = {}) { return [...obsoleteRegistrations.values()].filter(row => !ids || ids.includes(row.id)).map(copy); },
      async registerContentScripts(rows) { for (const row of rows) { assert.match(row.id, /^(?:detector-api-custom-fallback-v2-|detector-api-custom-media-relay-v1$)/); obsoleteRegistrations.set(row.id, copy(row)); } },
      async updateContentScripts(rows) { for (const row of rows) { assert.match(row.id, /^(?:detector-api-custom-fallback-v2-|detector-api-custom-media-relay-v1$)/); obsoleteRegistrations.set(row.id, copy(row)); } },
      async unregisterContentScripts({ ids }) { for (const id of ids) obsoleteRegistrations.delete(id); },
      async executeScript(injection) { executions.push(copy(injection)); return []; }
    },
    userScripts: {
      async getScripts() { userCalls.get++; if (!earlyAvailable) throw new Error('browser userScripts access disabled'); return [...registrations.values()].map(copy); },
      async register(rows) { userCalls.register++; if (!earlyAvailable) throw new Error('browser userScripts access disabled'); registrationOperations.push({ operation: 'add', ids: rows.map(row => row.id) }); if (!dropRegistration) for (const row of rows) registrations.set(row.id, copy(row)); },
      async update(rows) { userCalls.update++; if (!earlyAvailable) throw new Error('browser userScripts access disabled'); registrationOperations.push({ operation: 'update', ids: rows.map(row => row.id) }); if (!dropRegistration) for (const row of rows) registrations.set(row.id, copy(row)); },
      async unregister({ ids }) { userCalls.unregister++; if (!earlyAvailable) throw new Error('browser userScripts access disabled'); registrationOperations.push({ operation: 'remove', ids: [...ids] }); for (const id of ids) registrations.delete(id); }
    },
    tabs: { async query() { return open ? [{ id: 7 }] : []; }, async sendMessage(...args) { messages.push(copy(args)); } },
    webNavigation: { async getAllFrames() { return [{ frameId: 0, documentId: 'document-7', url: 'https://example.com/page' }]; } }
  };
  const scope = { accessReady: true, hasDataConsent: true, accessGeneration: 1,
    desiredMatches: () => ['https://example.com/*'], isGranted: async () => true };
  const legacy = { settings: legacySettings(enabled), chain: Promise.resolve(), registration: 'inactive', accessUnavailable: false, cleanupIncomplete: false,
    callbacks: 0, stops: 0, async start() {},
    serialize(operation) {
      const next = this.chain.then(operation, operation);
      this.chain = next.catch(() => {});
      return next.finally(() => { if (++this.callbacks > 30) throw new Error('recursive legacy callbacks'); controller?.legacyChanged(); });
    },
    async reconcile() { this.registration = this.settings.enabled ? 'ready' : 'inactive'; },
    async stopOpenDocuments() { this.stops++; },
    async finishApplication() { await api.storage.local.set({ 'protection:pending:v1': false }); }
  };
  const ui = { id: api.runtime.id, origin, url: origin + '/options.html' };
  const page = { id: api.runtime.id, tab: { id: 7 }, frameId: 0, documentId: 'document-7', origin: 'https://example.com', url: 'https://example.com/page' };
  const verifyUiSender = sender => sender.id === api.runtime.id && sender.tab === undefined && sender.origin === ui.origin;
  const readPageSender = sender => sender.id === api.runtime.id && sender.tab?.id === 7 && sender.documentId && sender.origin === 'https://example.com' ?
    { ok: true, context: { host: 'example.com', tabId: 7, frameId: sender.frameId, documentId: sender.documentId,
      documentKey: `7:${sender.documentId}`, originPattern: 'https://example.com/*', documentLifecycle: sender.documentLifecycle ?? 'active' } } : { ok: false };
  controller = new ApiConfigurationController({ api, legacy, scope, whenReady: async () => {}, verifyUiSender, readPageSender });
  return { api, controller, legacy, scope, stored, writes, registrations, userRegistrations: registrations, obsoleteRegistrations, scriptingRegistrations: obsoleteRegistrations, messages, executions, registrationOperations, userCalls, ui, page,
    setFailStorage: flag => { failStorage = flag; }, setDropRegistration: flag => { dropRegistration = flag; }, setEarlyAvailable: flag => { earlyAvailable = flag; } };
}
function request(type, fields = {}) { return { schemaVersion: 1, type, ...fields }; }
function custom(config, host = null) { return change(config, 'hardware-concurrency', { mode: 'custom', selected: value(16) }, host); }
function mathProfile(config, functions, host = null) { return change(config, 'math-transcendentals', { mode: 'custom', selected: value({ algorithm: 'deterministic-ulp-v1', functions }) }, host); }

const packed = script => JSON.parse(/const packed = (.+);\n/.exec(script.js[0].code)[1]);

test('private media relay is registered in isolated world before MAIN, verified and removed with Custom master',async()=>{
 const f=fixture();await f.controller.start();let config={...f.controller.configuration,antidetectEnabled:true};
 config=change(config,'media-capabilities',{mode:'custom',selected:value({supported:true,smooth:true,powerEfficient:false,hidden:[]})});
 await f.controller.set(config,f.controller.revision,null);assert.equal(f.controller.registration,'ready');
 const relay=f.scriptingRegistrations.get('detector-api-custom-media-relay-v1');assert.equal(relay.world,'ISOLATED');assert.equal(relay.allFrames,true);assert.equal(relay.runAt,'document_start');assert.deepEqual(relay.js,['api-custom-media-relay.js']);
 const source=[...f.userRegistrations.values()][0].js[0].code;assert.match(source,/installMediaCapabilitiesBridge/);assert.match(source,/detect-expert-media-v1:110/);
 await f.controller.set({...f.controller.configuration,antidetectEnabled:false},f.controller.revision,null);assert.equal(f.scriptingRegistrations.has('detector-api-custom-media-relay-v1'),false);
});
test('independent master matrix partitions Custom and early On in global, exact-host, inherited and disabled registrations', async () => {
  for (const enabled of [false, true]) for (const antidetectEnabled of [false, true]) {
    const f = fixture(); f.scope.desiredMatches = () => ['http://*/*', 'https://*/*']; await f.controller.start();
    let config = { ...f.controller.configuration, enabled, antidetectEnabled, preset: 'custom' };
    config = custom(config); config = change(config, 'navigator-platform', { mode: 'on' }); config = change(config, 'websocket', { mode: 'on' });
    config = custom(config, 'exact.example');
    config = change(config, 'navigator-platform', { mode: 'custom', selected: value('Site platform') }, 'exact.example');
    config = change(config, 'websocket', { mode: 'off' }, 'exact.example');
    config = change(config, 'hardware-concurrency', { mode: 'bypass' }, 'inherit.example');
    config = change(config, 'hardware-concurrency', { mode: 'bypass' }, 'disabled.example'); config.sites.find(site => site.host === 'disabled.example').disabled = true;
    const response = await f.controller.set(config, f.controller.revision, null);
    assert.equal(response.type, 'api-config-state'); assert.equal(f.legacy.settings.enabled, enabled); assert.equal(f.controller.active(), enabled || antidetectEnabled);
    const expectedGlobal = [...(antidetectEnabled ? [['hardware-concurrency', 'custom']] : []), ...(enabled ? [['websocket', 'on'], ['navigator-platform', 'on']] : [])].sort();
    assert.deepEqual(customEntries(config, null).map(row => [row.id, row.mode]).sort(), expectedGlobal, enabled + ':' + antidetectEnabled);
    assert.deepEqual(customEntries(config, 'disabled.example'), []);
    const scripts = [...f.userRegistrations.values()], global = scripts.find(script => script.id.endsWith('-global'));
    assert.equal(Boolean(global), enabled || antidetectEnabled);
    if (global) {
      assert.deepEqual(packed(global).map(row => [row.id, row.mode]).sort(), expectedGlobal);
      assert.equal(global.excludeMatches.includes('https://disabled.example/*'), true);
      assert.equal(global.js[0].code.includes('Site platform'), false);
    }
    const local = scripts.find(script => script.id.endsWith(Buffer.from('exact.example').toString('hex')));
    assert.equal(Boolean(local), antidetectEnabled);
    if (local) assert.deepEqual(packed(local).map(row => [row.id, row.mode]).sort(), [['hardware-concurrency', 'custom'], ['navigator-platform', 'custom']]);
    const inherited = scripts.find(script => script.id.endsWith(Buffer.from('inherit.example').toString('hex')));
    assert.equal(Boolean(inherited), enabled || antidetectEnabled);
    if (inherited) assert.deepEqual(packed(inherited).map(row => [row.id, row.mode]).sort(), expectedGlobal);
    assert.equal(scripts.some(script => script.id.endsWith(Buffer.from('disabled.example').toString('hex'))), false);
  }
});
test('Antidetect-only activation ignores API legacy master and leaves On denial and native protocol rules inactive', async () => {
  const f = fixture(); await f.controller.start(); let config = { ...custom(f.controller.configuration), antidetectEnabled: true, enabled: false, preset: 'strict' };
  config = change(config, 'websocket', { mode: 'on' }); config = change(config, 'navigator-platform', { mode: 'on' });
  const result = await f.controller.set(config, 0, null);
  assert.equal(result.registration, 'ready'); assert.equal(f.legacy.settings.enabled, false); assert.equal(f.controller.active(), true);
  assert.deepEqual(packed([...f.userRegistrations.values()][0]).map(row => row.id), ['hardware-concurrency']);
  assert.equal(f.controller.antidetectProtocols.inspect().status, 'unsupported', 'native API is unavailable in this fixture; it cannot fabricate an applied rule');
});
test('Antidetect Off leaves dormant Canvas, Math and randomized RTC profiles unseeded while API On remains usable', async () => {
  const f = fixture(); await f.controller.start(); let config = { ...f.controller.configuration, enabled: true, antidetectEnabled: false, preset: 'custom' };
  config = change(config, 'canvas-readback', { mode: 'custom', selected: value({ algorithm: 'stable-rgb-v1' }) });
  config = mathProfile(config, ['sin']);
  config = change(config, 'webrtc', { mode: 'custom', selected: value({ addresses: null, iceTransportPolicy: 'preserve', randomizeDevices: true, freshCertificates: true, deviceLifetime: 'session' }) });
  config = change(config, 'navigator-platform', { mode: 'on' });
  const result = await f.controller.set(config, 0, null);
  assert.equal(result.registration, 'ready'); assert.equal(f.api.storage.session, undefined);
  const selected = packed([...f.userRegistrations.values()][0]); assert.deepEqual(selected, [{ id: 'navigator-platform', mode: 'on', selected: { kind: 'unset' } }]);
  assert.equal(f.scriptingRegistrations.get('detector-api-custom-fallback-v2-global').js.some(file => file.includes('canvas') || file.includes('math') || file.includes('webrtc')), false);
});
test('toggling Antidetect master preserves legacy revision, active API guards, every selected mode and library', async () => {
  const f = fixture({ open: true }); await f.controller.start(); const config = { ...custom(f.controller.configuration), enabled: true, antidetectEnabled: true };
  await f.controller.set(config, 0, null);
  const previous = copy(f.controller.configuration), legacy = copy(f.legacy.settings), stops = f.legacy.stops;
  const off = await f.controller.set({ ...previous, antidetectEnabled: false }, 1, null);
  assert.deepEqual(off.configuration, { ...previous, antidetectEnabled: false }); assert.deepEqual(f.legacy.settings, legacy); assert.equal(f.legacy.stops, stops);
  assert.equal(f.userRegistrations.size, 0); assert.equal(off.reloadRequired, true);
  const on = await f.controller.set({ ...off.configuration, antidetectEnabled: true }, 2, null);
  assert.deepEqual(on.configuration, previous); assert.deepEqual(f.legacy.settings, legacy); assert.equal(f.legacy.stops, stops); assert.equal(f.userRegistrations.size, 1);
});
test('legacy API switch cannot turn off an active Antidetect master or discard its private profile selection', async () => {
  const f = fixture(); await f.controller.start(); const config = { ...custom(f.controller.configuration), enabled: true, antidetectEnabled: true };
  await f.controller.set(config, 0, null); f.legacy.settings = { ...f.legacy.settings, enabled: false, revision: f.legacy.settings.revision + 1 };
  f.controller.legacyChanged(); await f.controller.refreshing;
  assert.equal(f.controller.configuration.enabled, false); assert.equal(f.controller.configuration.antidetectEnabled, true);
  assert.equal(f.controller.registration, 'ready'); assert.equal(f.userRegistrations.size, 1); assert.equal(f.controller.configuration.apis.find(row => row.id === 'hardware-concurrency').selected.value, 16);
});
test('dormant policy can be saved without privacy grant and disabled masters need no early Custom access', async () => {
  const f = fixture(); await f.controller.start(); f.setEarlyAvailable(false);
  const config = { ...custom(f.controller.configuration), enabled: false, antidetectEnabled: false, webrtcNetworkPolicy: 'disable_non_proxied_udp' };
  const result = await f.controller.set(config, 0, null);
  assert.equal(result.type, 'api-config-state'); assert.equal(result.configuration.webrtcNetworkPolicy, 'disable_non_proxied_udp'); assert.equal(result.registration, 'inactive');
  assert.equal((await f.controller.set({ ...config, antidetectEnabled: true }, 1, null)).code, 'privacy-permission-required');
  const withoutPolicy = { ...config, antidetectEnabled: true, webrtcNetworkPolicy: 'system' };
  assert.equal((await f.controller.set(withoutPolicy, 1, null)).code, 'early-access-required');
});
test('a WebRTC network policy this browser cannot apply is refused when Antidetect is on, before anything is written; a normal policy still saves', async () => {
  const f = fixture(); await f.controller.start();
  // The browser rule itself lives in WebRtcNetworkController.refusal (Chrome refuses the Firefox-only proxy_only); a fake decides here.
  const asked = []; f.controller.webrtcNetwork.refusal = policy => { asked.push(policy); return policy === 'proxy_only' ? 'webrtc-policy-unsupported' : null; };
  const stored = copy(f.stored[API_CONFIGURATION_STORAGE_KEY] ?? null), writesBefore = f.writes.length, revision = f.controller.revision;
  const refused = await f.controller.set({ ...f.controller.configuration, antidetectEnabled: true, webrtcNetworkPolicy: 'proxy_only' }, revision, null);
  assert.equal(refused.type, 'api-config-error'); assert.equal(refused.code, 'webrtc-policy-unsupported'); assert.match(refused.message, /not available in this browser/u);
  assert.deepEqual(asked, ['proxy_only'], 'the refusal was asked about the chosen policy'); assert.equal(f.writes.length, writesBefore, 'nothing was written');
  assert.deepEqual(copy(f.stored[API_CONFIGURATION_STORAGE_KEY] ?? null), stored); assert.equal(f.controller.revision, revision); assert.equal(f.controller.configuration.webrtcNetworkPolicy, 'system');
  // A dormant choice (Antidetect off) is stored as before, and a normal policy with Antidetect on saves.
  const dormant = await f.controller.set({ ...f.controller.configuration, antidetectEnabled: false, webrtcNetworkPolicy: 'proxy_only' }, revision, null);
  assert.equal(dormant.type, 'api-config-state'); assert.equal(dormant.configuration.webrtcNetworkPolicy, 'proxy_only'); assert.equal(f.controller.revision, revision + 1);
  const saved = await f.controller.set({ ...f.controller.configuration, antidetectEnabled: true, webrtcNetworkPolicy: 'system' }, revision + 1, null);
  assert.equal(saved.type, 'api-config-state'); assert.equal(saved.configuration.antidetectEnabled, true); assert.equal(saved.configuration.webrtcNetworkPolicy, 'system'); assert.equal(f.controller.revision, revision + 2);
});
function nativePolicy(f) {
  let details = { value: 'default', levelOfControl: 'controllable_by_this_extension' }, failClear = false;
  const calls = [];
  f.api.permissions = { async contains() { return true; } };
  f.api.privacy = { network: { webRTCIPHandlingPolicy: {
    async get() { return copy(details); },
    async set(input) { calls.push(['set', copy(input)]); details = { value: input.value, levelOfControl: 'controlled_by_this_extension' }; },
    async clear(input) { calls.push(['clear', copy(input)]); if (failClear) return false; if (details.levelOfControl === 'controlled_by_this_extension') details = { value: 'default', levelOfControl: 'controllable_by_this_extension' }; },
  } } };
  return { calls, state: () => copy(details), foreign: () => { details = { value: 'foreign-policy', levelOfControl: 'controlled_by_other_extensions' }; }, failClear: () => { failClear = true; } };
}
test('Antidetect owns native WebRTC policy independently of API Guard, retains desired selection and clears only its own layer', async () => {
  const f = fixture(), policy = nativePolicy(f); await f.controller.start(); policy.calls.length = 0;
  const desired = 'disable_non_proxied_udp', initial = { ...f.controller.configuration, enabled: false, antidetectEnabled: true, webrtcNetworkPolicy: desired };
  await f.controller.set(initial, 0, null); assert.deepEqual(policy.calls, [['set', { value: desired, scope: 'regular' }]]); assert.equal(policy.state().value, desired);
  policy.calls.length = 0;
  const off = await f.controller.set({ ...f.controller.configuration, antidetectEnabled: false, enabled: true }, 1, null);
  assert.deepEqual(policy.calls, [['clear', { scope: 'regular' }]]); assert.equal(off.configuration.webrtcNetworkPolicy, desired); assert.equal(off.webrtcNetwork.status, 'inactive');
  policy.calls.length = 0; policy.foreign(); await f.controller.reconcile(); assert.deepEqual(policy.calls, []); assert.equal(policy.state().value, 'foreign-policy');
});
test('native WebRTC policy removal failure remains a saved application error when Antidetect is Off', async () => {
  const f = fixture(), policy = nativePolicy(f); await f.controller.start();
  const desired = { ...f.controller.configuration, antidetectEnabled: true, webrtcNetworkPolicy: 'disable_non_proxied_udp' };
  await f.controller.set(desired, 0, null); policy.failClear();
  const off = await f.controller.set({ ...f.controller.configuration, antidetectEnabled: false }, 1, null);
  assert.equal(off.configuration.antidetectEnabled, false); assert.equal(off.registration, 'error'); assert.equal(off.webrtcNetwork.status, 'error');
  assert.equal(f.controller.recoveryPending, true); assert.equal(f.stored['protection:pending:v1'], true);
});

test('profile-library edits never stop open guards, rewrite legacy/pending state or re-register active scripts', async () => {
  const f = fixture(); await f.controller.start(); const active = custom(f.controller.configuration); active.enabled = true; active.antidetectEnabled = true;
  await f.controller.set(active, f.controller.revision, null);
  const before = { stops: f.legacy.stops, legacy: copy(f.legacy.settings), pending: f.stored['protection:pending:v1'], calls: copy(f.userCalls), fallback: [...f.scriptingRegistrations.values()].map(copy) };
  const configuration = copy(f.controller.configuration); configuration.fingerprintProfiles.push({ id: 'fp-' + '45'.repeat(16), label: 'Library only', preset: configuration.preset, webrtcNetworkPolicy: configuration.webrtcNetworkPolicy,
    apis: configuration.apis.map(({ id, mode, selected, settings }) => ({ id, mode, selected, settings })), tags: [], note: '' });
  const state = await f.controller.set(configuration, f.controller.revision, null);
  assert.equal(state.configuration.fingerprintProfiles.length, 1); assert.equal(state.registration, 'ready'); assert.equal(f.legacy.stops, before.stops);
  assert.deepEqual(f.legacy.settings, before.legacy);
  for (const key of ['register', 'update', 'unregister']) assert.equal(f.userCalls[key], before.calls[key], key);
  assert.deepEqual([...f.scriptingRegistrations.values()].map(copy), before.fallback);
  assert.equal(f.stored['protection:pending:v1'], before.pending); assert.deepEqual(Object.keys(f.writes.at(-1)), [API_CONFIGURATION_STORAGE_KEY]);
});

for (const revoked of ['early', 'privacy']) test(`FP06: library-only Save/Rename/Delete retain CAS and application state after ${revoked} access is revoked`, async () => {
  const f = fixture(), policy = revoked === 'privacy' ? nativePolicy(f) : null;
  await f.controller.start();
  let active = { ...f.controller.configuration, antidetectEnabled: true };
  if (revoked === 'early') active = custom(active); else active.webrtcNetworkPolicy = 'disable_non_proxied_udp';
  const savedId = 'fp-' + '06'.repeat(16), newId = 'fp-' + '16'.repeat(16);
  active = storeFingerprintProfile(active, snapshotFingerprintProfile(active, 'Existing', savedId));
  assert.equal((await f.controller.set(active, f.controller.revision, null)).type, 'api-config-state');
  if (revoked === 'early') f.setEarlyAvailable(false); else f.api.permissions.contains = async () => false;
  await f.controller.reconcile();
  const before = { configuration: copy(f.controller.configuration), registration: f.controller.registration, reloadRequired: f.controller.reloadRequired, stops: f.legacy.stops, legacy: copy(f.legacy.settings), pending: f.stored['protection:pending:v1'], calls: copy(f.userCalls), fallback: [...f.scriptingRegistrations.values()].map(copy), nativeCalls: policy?.calls.length };
  const edits = [configuration => storeFingerprintProfile(configuration, snapshotFingerprintProfile(configuration, 'New', newId)), configuration => renameFingerprintProfile(configuration, savedId, 'Renamed'), configuration => deleteFingerprintProfile(configuration, savedId)];
  for (const edit of edits) {
    const revision = f.controller.revision, writes = f.writes.length, next = edit(f.controller.configuration);
    const state = await f.controller.set(next, revision, null);
    assert.equal(state.type, 'api-config-state', state.code); assert.equal(state.revision, revision + 1); assert.equal(f.writes.length, writes + 1);
    assert.deepEqual(state.configuration, next); assert.deepEqual({ ...state.configuration, fingerprintProfiles: [] }, { ...before.configuration, fingerprintProfiles: [] });
    assert.equal(state.registration, before.registration); assert.equal(state.reloadRequired, before.reloadRequired);
    assert.deepEqual(Object.keys(f.writes.at(-1)), [API_CONFIGURATION_STORAGE_KEY]);
    assert.equal((await f.controller.set(state.configuration, revision, null)).code, 'stale-revision', 'a stale library-only edit is still fenced');
  }
  assert.equal(f.legacy.stops, before.stops); assert.deepEqual(f.legacy.settings, before.legacy); assert.equal(f.stored['protection:pending:v1'], before.pending);
  for (const key of ['register', 'update', 'unregister']) assert.equal(f.userCalls[key], before.calls[key], key);
  assert.deepEqual([...f.scriptingRegistrations.values()].map(copy), before.fallback); if (policy) assert.equal(policy.calls.length, before.nativeCalls);
  const change = custom(f.controller.configuration), revision = f.controller.revision, writes = f.writes.length;
  change.apis.find(row => row.id === 'hardware-concurrency').selected = value(32);
  assert.equal((await f.controller.set(change, revision, null)).code, revoked === 'early' ? 'early-access-required' : 'privacy-permission-required');
  assert.equal(f.controller.revision, revision); assert.equal(f.writes.length, writes, 'real application changes remain permission-gated');
});

test('an empty Math profile creates no userScript or opaque guard and requires no session seed', async () => {
  const f = fixture(); await f.controller.start();
  const config = mathProfile(f.controller.configuration, []); config.enabled = true; config.antidetectEnabled = true;
  for (const row of config.apis) if (row.id !== 'math-transcendentals') row.mode = 'off';
  const state = await f.controller.set(config, f.controller.revision, null);
  assert.equal(state.registration, 'inactive'); assert.equal(f.userRegistrations.size, 0); assert.equal(f.scriptingRegistrations.size, 0);
  assert.equal(f.api.storage.session, undefined, 'no seed storage needed for the empty profile');
  assert.deepEqual(state.configuration.apis.find(row => row.id === 'math-transcendentals').selected, value({ algorithm: 'deterministic-ulp-v1', functions: [] }));
});

test('empty Math remains absent from opaque registrations while another Custom API is active', async () => {
  const f = fixture(); await f.controller.start();
  const config = mathProfile(custom(f.controller.configuration), []); config.enabled = true; config.antidetectEnabled = true;
  const state = await f.controller.set(config, f.controller.revision, null);
  assert.equal(state.registration, 'ready'); assert.ok(f.userRegistrations.size > 0); assert.ok(f.scriptingRegistrations.size > 0);
  for (const row of f.scriptingRegistrations.values()) { assert.ok(row.js.includes('api-custom-opaque.hardware-concurrency.js')); assert.ok(!row.js.includes('api-custom-opaque.math-transcendentals.js')); }
});

test('empty exact-site Math overrides global Spoof without inheriting its opaque guard', async () => {
  const f = fixture(); f.api.storage.session = { async get(key) { return { [key]: '42'.repeat(32) }; } }; await f.controller.start();
  let config = mathProfile(custom(f.controller.configuration), ['sin']); config.enabled = true; config.antidetectEnabled = true;
  config = mathProfile(config, [], 'example.com');
  const state = await f.controller.set(config, f.controller.revision, null); assert.equal(state.registration, 'ready');
  const global = [...f.scriptingRegistrations.values()].find(row => row.id.endsWith('-global'));
  const local = [...f.scriptingRegistrations.values()].find(row => !row.id.endsWith('-global'));
  assert.ok(global.js.includes('api-custom-opaque.math-transcendentals.js')); assert.ok(local);
  assert.ok(!local.js.includes('api-custom-opaque.math-transcendentals.js')); assert.ok(local.js.includes('api-custom-opaque.hardware-concurrency.js'));
  assert.ok(global.excludeMatches.includes('https://example.com/*')); assert.ok(local.matches.includes('https://example.com/*'));
});
function historical(config) {
  const previous = copy(config), ids = new Set(API_CONFIG_CATALOG_V1.map(row => row.id));
  previous.formatVersion = 1; previous.catalogVersion = 1; delete previous.webrtcNetworkPolicy; delete previous.fingerprintProfiles; delete previous.antidetectEnabled;
  previous.apis = previous.apis.filter(row => ids.has(row.id)).map(row => ({ ...copy(API_CONFIG_CATALOG_V1.find(entry => entry.id === row.id)),
    mode: row.mode, userValues: row.userValues, selected: row.selected, settings: row.settings }));
  for (const site of previous.sites) site.apis = site.apis.filter(row => ids.has(row.id));
  return previous;
}
function storedHistorical(f, revision = 17) {
  let config = custom(createApiConfiguration()); config.enabled = true; config.antidetectEnabled = true;
  config = change(config, 'hardware-concurrency', { userValues: [{ id: 'saved-16', label: 'Saved CPU', value: value(16) }] });
  config = change(config, 'navigator-oscpu', { mode: 'custom', selected: { kind: 'undefined' } }, 'example.com');
  config.sites[0].disabled = true;
  f.legacy.settings = configurationToLegacy(config, { revision: 9 });
  const record = { revision, configuration: historical(config) };
  f.stored[API_CONFIGURATION_STORAGE_KEY] = copy(record);
  return record;
}

test('catalogue v1 startup persists one complete additive upgrade before registration and bumps revision', async () => {
  const f = fixture(), previous = storedHistorical(f), oldLegacy = copy(f.legacy.settings);
  const register = f.api.userScripts.register;
  f.api.userScripts.register = async rows => {
    assert.equal(f.stored[API_CONFIGURATION_STORAGE_KEY].configuration.catalogVersion, API_CONFIGURATION_CATALOG_VERSION);
    assert.equal(f.stored[API_CONFIGURATION_STORAGE_KEY].configuration.formatVersion, API_CONFIGURATION_VERSION);
    assert.equal(f.stored[API_CONFIGURATION_STORAGE_KEY].configuration.webrtcNetworkPolicy, 'system');
    assert.equal(f.stored[API_CONFIGURATION_STORAGE_KEY].revision, previous.revision + 1);
    return register(rows);
  };
  await f.controller.start();
  assert.equal(f.writes.length, 1);
  assert.deepEqual(Object.keys(f.writes[0]), [API_CONFIGURATION_STORAGE_KEY]);
  assert.equal(f.controller.revision, 18); assert.equal(f.controller.configuration.catalogVersion, API_CONFIGURATION_CATALOG_VERSION);
  assert.deepEqual(f.legacy.settings, oldLegacy, 'default Bypass adds no legacy policy or revision changes');
  assert.deepEqual(f.controller.configuration.apis.slice(0, 105), previous.configuration.apis.map(row => ({ ...copy(API_CONFIG_CATALOG.find(entry => entry.id === row.id)),
    mode: row.mode, userValues: row.userValues, selected: row.selected, settings: row.settings })));
  assert.deepEqual(f.controller.configuration.sites[0].apis.slice(0, 105), previous.configuration.sites[0].apis);
  assert.equal(f.controller.configuration.sites[0].disabled, true);
  for (const site of f.controller.configuration.sites) assert.equal(site.apis.length, API_CONFIG_CATALOG.length);
  assert.equal(f.controller.configuration.apis.length, API_CONFIG_CATALOG.length); assert.equal(f.registrations.size, 1);
  assert.equal(f.controller.configuration.apis.slice(105).every(row => row.mode === 'bypass' && row.selected.kind === 'unset'), true);
  assert.equal((await f.controller.state(null)).revision, 18); assert.equal(f.writes.length, 1);
  assert.equal((await f.controller.set(f.controller.configuration, previous.revision, null)).code, 'stale-revision');
  assert.equal(f.writes.length, 1, 'stale pre-upgrade editor cannot overwrite migrated state');
});

test('catalogue migration storage failure preserves old disk and Custom libraries for explicit retry', async () => {
  const f = fixture(), previous = storedHistorical(f); f.setFailStorage(true);
  const response = await f.controller.route(request('ui-api-config-get', { tabId: null }), f.ui);
  assert.equal(response.code, 'storage-error');
  assert.deepEqual(f.stored[API_CONFIGURATION_STORAGE_KEY], previous);
  assert.equal(f.controller.revision, previous.revision); assert.equal(f.controller.registration, 'error');
  assert.equal(f.controller.loading, null); assert.equal(f.writes.length, 0); assert.equal(f.registrations.size, 0);
  const cpu = f.controller.configuration.apis.find(row => row.id === 'hardware-concurrency');
  assert.equal(cpu.mode, 'custom'); assert.deepEqual(cpu.selected, value(16)); assert.equal(cpu.userValues.length, 1);
  f.setFailStorage(false);
  const recovered = await f.controller.route(request('ui-api-config-get', { tabId: null }), f.ui);
  assert.equal(recovered.type, 'api-config-state'); assert.equal(recovered.registration, 'ready');
  assert.equal(recovered.revision, previous.revision + 1); assert.equal(f.writes.length, 1);
  assert.equal(recovered.configuration.apis.find(row => row.id === 'hardware-concurrency').userValues.length, 1);
  assert.equal(f.stored[API_CONFIGURATION_STORAGE_KEY].configuration.catalogVersion, API_CONFIGURATION_CATALOG_VERSION);
});

test('migration merges current serialized legacy changes without losing selections or libraries', async () => {
  const f = fixture(), previous = storedHistorical(f);
  f.legacy.settings.enabled = false; f.legacy.settings.preset = 'strict';
  f.legacy.settings.global.push({ feature: WASM_SURFACES[0].feature, state: 'block' });
  await f.controller.start();
  assert.equal(f.writes.length, 1); assert.equal(f.controller.revision, previous.revision + 1);
  assert.equal(f.controller.configuration.enabled, false); assert.equal(f.controller.configuration.preset, 'strict');
  assert.equal(f.controller.configuration.apis.find(row => row.id === WASM_SURFACES[0].feature).mode, 'on');
  const cpu = f.controller.configuration.apis.find(row => row.id === 'hardware-concurrency');
  assert.equal(cpu.mode, 'custom'); assert.deepEqual(cpu.selected, value(16)); assert.equal(cpu.userValues.length, 1);
  assert.equal(f.controller.configuration.sites[0].disabled, true); assert.equal(f.controller.configuration.antidetectEnabled, true);
  assert.equal(f.registrations.size, 1, 'legacy API master change preserves the migrated active Antidetect master');
});

test('current catalogue restarts do not repeat migration or rewrite portable state', async () => {
  const f = fixture(); const previous = storedHistorical(f);
  await f.controller.start(); const persisted = copy(f.stored[API_CONFIGURATION_STORAGE_KEY]);
  const next = fixture(); next.stored[API_CONFIGURATION_STORAGE_KEY] = persisted;
  next.legacy.settings = copy(f.legacy.settings);
  await next.controller.start();
  assert.equal(next.controller.revision, previous.revision + 1);
  assert.equal(next.controller.configuration.catalogVersion, API_CONFIGURATION_CATALOG_VERSION); assert.equal(next.writes.length, 0);
  assert.deepEqual(next.controller.configuration, persisted.configuration);
});

test('catalogue migration cannot overflow a persisted revision or discard valid previous data', async () => {
  const f = fixture(), previous = storedHistorical(f, Number.MAX_SAFE_INTEGER);
  const response = await f.controller.route(request('ui-api-config-get', { tabId: null }), f.ui);
  assert.equal(response.code, 'storage-error'); assert.equal(f.controller.registration, 'error');
  assert.equal(f.writes.length, 0); assert.equal(f.registrations.size, 0);
  assert.deepEqual(f.stored[API_CONFIGURATION_STORAGE_KEY], previous);
  assert.equal(f.controller.configuration.apis.find(row => row.id === 'hardware-concurrency').userValues.length, 1);
});

test('valid historical capacity failure leaves both persisted libraries and installed profiles untouched', async () => {
  const f = fixture(), previous = historical(createApiConfiguration());
  for (const row of previous.apis.filter(row => row.customSupported && row.presets.length).slice(0, 20)) {
    row.userValues = Array.from({ length: 1000 }, (_, index) => ({ id: 'custom-' + index, label: 'x'.repeat(100), value: copy(row.presets[0].value) }));
  }
  let remaining = API_CONFIGURATION_MAX_BYTES - 1024 - Buffer.byteLength(JSON.stringify(previous));
  for (const row of previous.apis) for (const user of row.userValues) {
    const addition = Math.min(60, remaining); user.label += 'x'.repeat(addition); remaining -= addition;
  }
  assert.equal(remaining, 0);
  f.stored[API_CONFIGURATION_STORAGE_KEY] = { revision: 8, configuration: copy(previous) };
  f.registrations.set('detector-api-custom-profile-v2-global', { id: 'detector-api-custom-profile-v2-global' });
  f.scriptingRegistrations.set('detector-api-custom-fallback-v2-global', { id: 'detector-api-custom-fallback-v2-global' });
  const response = await f.controller.route(request('ui-api-config-get', { tabId: null }), f.ui);
  assert.equal(response.code, 'storage-error'); assert.equal(f.controller.registration, 'error');
  assert.equal(f.controller.loading, null); assert.equal(f.controller.configuration, null, 'no legacy-only replacement is created');
  assert.deepEqual(f.stored[API_CONFIGURATION_STORAGE_KEY], { revision: 8, configuration: previous });
  assert.equal(f.writes.length, 0); assert.equal(f.registrations.size, 1); assert.equal(f.scriptingRegistrations.size, 1);
  assert.deepEqual(f.userCalls, { get: 0, register: 0, update: 0, unregister: 0 });
});

test('page/other-extension cannot mutate policy or retrieve privileged configuration', async () => {
  const f = fixture(); await f.controller.start();
  const config = custom(createApiConfiguration()); config.enabled = true; config.antidetectEnabled = true;
  for (const sender of [f.page, { ...f.ui, id: 'other-extension' }, { ...f.ui, origin: 'https://evil.example' }]) {
    assert.equal((await f.controller.route(request('ui-api-config-set', { tabId: null, expectedRevision: 0, configuration: config }), sender)).code, 'unauthorized-sender');
    assert.equal((await f.controller.route(request('ui-api-config-get', { tabId: null }), sender)).code, 'unauthorized-sender');
  }
  assert.equal(f.writes.length, 0); assert.equal(f.controller.configuration.enabled, false);
  assert.equal((await f.controller.route(request('api-custom-ready'), { ...f.page, id: 'other' })).code, 'unauthorized-sender');
  const ready = await f.controller.route(request('api-custom-ready'), f.page);
  assert.equal(ready.type, 'api-custom-state'); assert.deepEqual(ready.entries, []);
});
test('temporary startup read failure can recover on the next request without restarting SW', async () => {
  const f = fixture(), get = f.api.storage.local.get;
  f.api.storage.local.get = async () => { throw new Error('temporary browser failure'); };
  await assert.rejects(f.controller.start(), /temporary browser failure/);
  assert.equal(f.controller.loading, null); assert.equal(f.controller.registration, 'error');
  f.api.storage.local.get = get;
  const state = await f.controller.route(request('ui-api-config-get', { tabId: null }), f.ui);
  assert.equal(state.type, 'api-config-state'); assert.equal(state.revision, 0); assert.equal(state.registration, 'inactive');
  assert.equal(f.controller.registration, 'inactive'); assert.equal(f.writes.length, 0);
});
test('atomic successful commit persists modern + legacy + recovery marker in one write', async () => {
  const f = fixture(); await f.controller.start();
  const config = custom(f.controller.configuration); config.enabled = true; config.antidetectEnabled = true;
  const response = await f.controller.route(request('ui-api-config-set', { tabId: null, expectedRevision: 0, configuration: config }), f.ui);
  assert.equal(response.type, 'api-config-state'); assert.equal(response.revision, 1);
  assert.deepEqual(Object.keys(f.writes[0]).sort(), [API_CONFIGURATION_STORAGE_KEY, 'protection:pending:v1', 'protection:v1'].sort());
  assert.equal(f.writes[0]['protection:pending:v1'], true);
  assert.deepEqual(f.legacy.settings.global.find(row => row.feature === 'hardware-concurrency'), { feature: 'hardware-concurrency', state: 'allow' });
  assert.equal(f.legacy.stops, 1); assert.equal(f.registrations.size, 1);
  assert.equal(f.scriptingRegistrations.size, 1);
  const inherit = f.scriptingRegistrations.get('detector-api-custom-fallback-v2-global');
  assert.deepEqual(inherit.js, ['api-custom-inherit.main.js', 'api-custom-opaque.hardware-concurrency.js']); assert.deepEqual(inherit.matches, ['https://example.com/*']);
  assert.equal(inherit.world, 'MAIN'); assert.equal(inherit.runAt, 'document_start'); assert.equal(inherit.allFrames, true);
  assert.equal(inherit.persistAcrossSessions, true); assert.equal(inherit.matchOriginAsFallback, true);
  assert.equal([...f.registrations.values()][0].world, 'MAIN');
  assert.equal([...f.registrations.values()][0].runAt, 'document_start');
  assert.equal([...f.registrations.values()][0].js.length, 1);
  assert.equal(typeof [...f.registrations.values()][0].js[0].code, 'string');
  assert.equal(f.stored['protection:pending:v1'], false);
  assert.equal(f.controller.mutating, 0); assert.equal(f.controller.refreshing, null);
});
test('storage failure and stale revision cannot change stored/in-memory settings or install hooks', async () => {
  const f = fixture(); await f.controller.start();
  const original = copy(f.controller.configuration), oldLegacy = copy(f.legacy.settings);
  const config = custom(original); config.enabled = true; config.antidetectEnabled = true; f.setFailStorage(true);
  assert.equal((await f.controller.set(config, 0, null)).code, 'storage-error');
  assert.deepEqual(f.controller.configuration, original); assert.deepEqual(f.legacy.settings, oldLegacy);
  assert.equal(f.controller.revision, 0); assert.equal(f.writes.length, 0); assert.equal(f.registrations.size, 0);
  f.setFailStorage(false);
  assert.equal((await f.controller.set(config, 1, null)).code, 'stale-revision');
  assert.equal(f.writes.length, 0); assert.deepEqual(f.controller.configuration, original);
});
test('invalid import configuration cannot persist; previous legacy change invalidates stale editor revision', async () => {
  const f = fixture(); await f.controller.start();
  const invalid = copy(f.controller.configuration); invalid.apis.pop();
  assert.equal((await f.controller.set(invalid, 0, null)).code, 'missing-api'); assert.equal(f.writes.length, 0);
  f.legacy.settings = { ...f.legacy.settings, enabled: true, revision: 1 };
  assert.equal((await f.controller.set(custom(f.controller.configuration), 0, null)).code, 'stale-revision');
  assert.equal(f.controller.revision, 1); assert.equal(f.controller.configuration.enabled, true);
});
test('Custom scope selection obeys local Off/On, Bypass inheritance and disabled sites', () => {
  let config = custom(createApiConfiguration()); config.enabled = true; config.antidetectEnabled = true;
  assert.equal(customEntries(config, 'example.com')[0].selected.value, 16);
  config = change(config, 'hardware-concurrency', { mode: 'off' }, 'example.com');
  assert.deepEqual(customEntries(config, 'example.com'), []);
  config = change(config, 'hardware-concurrency', { mode: 'bypass' }, 'example.com');
  assert.equal(customEntries(config, 'example.com')[0].selected.value, 16);
  config = change(config, 'hardware-concurrency', { mode: 'on' }, 'example.com');
  assert.deepEqual(customEntries(config, 'example.com'), [], 'legacy installer owns existing On IDs');
  config = change(config, 'navigator-platform', { mode: 'on' }, 'example.com');
  assert.deepEqual(customEntries(config, 'example.com'), [{ id: 'navigator-platform', mode: 'on', selected: { kind: 'unset' } }]);
  config.sites[0].disabled = true; assert.deepEqual(customEntries(config, 'example.com'), []);
});
test('legacy master Off preserves Custom libraries and selected values', async () => {
  let config = custom(createApiConfiguration(legacySettings(true)));
  config = change(config, 'hardware-concurrency', { userValues: [{ id: 'custom-1', label: '16 cores', value: value(16) }] });
  const legacy = { ...legacySettings(false), global: [{ feature: 'hardware-concurrency', state: 'allow' }] };
  const merged = mergeLegacyConfiguration(config, legacy);
  const row = merged.apis.find(item => item.id === 'hardware-concurrency');
  assert.equal(merged.enabled, false); assert.equal(row.mode, 'custom'); assert.equal(row.selected.value, 16); assert.equal(row.userValues.length, 1);
  const f = fixture(); await f.controller.start(); f.legacy.settings.enabled = true;
  f.controller.legacyChanged(); await f.controller.refreshing;
  assert.equal(f.controller.configuration.enabled, true); assert.equal(f.controller.revision, 1);
  assert.ok(f.legacy.callbacks < 5, 'onChange callback does not schedule an unbounded refresh loop');
});
test('legacy insertion order does not cause phantom configuration revisions or stale saves', async () => {
  const legacy = { ...legacySettings(true), global: [{ feature: 'touch-points', state: 'block' }, { feature: 'hardware-concurrency', state: 'allow' }],
    sites: [{ host: 'z.example', disabled: false, rules: [{ feature: 'touch-points', state: 'allow' }, { feature: 'hardware-concurrency', state: 'block' }] },
      { host: 'a.example', disabled: true, rules: [] }] };
  const config = createApiConfiguration(legacy);
  assert.equal(mergeLegacyConfiguration(config, legacy), config);
  const f = fixture(); f.legacy.settings = legacy; await f.controller.start();
  assert.equal(f.controller.revision, 0); assert.equal(f.writes.length, 0);
  const response = await f.controller.set(f.controller.configuration, 0, null);
  assert.equal(response.type, 'api-config-state'); assert.equal(response.revision, 1);
});
test('compatibility readiness never transports Custom values even with consent, grants or prerender', async () => {
  const f = fixture(); await f.controller.start();
  const config = custom(f.controller.configuration); config.enabled = true; config.antidetectEnabled = true; await f.controller.set(config, 0, null);
  assert.deepEqual((await f.controller.page(f.page)).entries, []);
  f.scope.hasDataConsent = false;
  assert.deepEqual((await f.controller.route(request('api-custom-ready'), f.page)).entries, []);
  assert.equal((await f.controller.route(request('ui-api-config-get', { tabId: null }), f.ui)).code, 'no-access');
  f.scope.hasDataConsent = true; f.scope.isGranted = async () => false;
  assert.deepEqual((await f.controller.page(f.page)).entries, []);
  f.scope.isGranted = async () => { f.scope.accessGeneration++; return true; };
  assert.deepEqual((await f.controller.page(f.page)).entries, []);
  f.scope.isGranted = async () => true;
  assert.deepEqual((await f.controller.page({ ...f.page, documentLifecycle: 'prerender' })).entries, []);
});
test('master disable unregisters early profiles, requires reload and never restores native in open documents', async () => {
  const f = fixture({ open: true }); await f.controller.start();
  const config = custom(f.controller.configuration); config.enabled = true; config.antidetectEnabled = true; await f.controller.set(config, 0, null);
  assert.equal(f.executions.length, 0); assert.equal(f.messages.length, 0);
  assert.equal(f.registrations.size, 1); assert.equal(f.controller.reloadRequired, true);
  f.executions.length = 0; f.messages.length = 0;
  await f.controller.set({ ...config, enabled: false, antidetectEnabled: false }, 1, null);
  assert.equal(f.registrations.size, 0); assert.equal(f.executions.length, 0);
  assert.equal(f.scriptingRegistrations.size, 0);
  assert.equal(f.messages.length, 0, 'No page-visible stop/apply or privileged restore message');
  assert.equal(f.controller.reloadRequired, true);
});

test('one UI read recovers failed OFF removal after the native API returns, preserving values and revision', async () => {
  const f = fixture({ open: true }); await f.controller.start();
  const enabled = custom(f.controller.configuration); enabled.enabled = true; enabled.antidetectEnabled = true;
  await f.controller.set(enabled, 0, null);
  const unregister = f.api.userScripts.unregister;
  let attempts = 0;
  f.api.userScripts.unregister = async () => { attempts++; throw new Error('temporary unregister failure'); };
  const disabled = copy(f.controller.configuration); disabled.enabled = false; disabled.antidetectEnabled = false;
  const failed = await f.controller.set(disabled, 1, null);
  assert.equal(failed.configuration.enabled, false); assert.equal(failed.registration, 'error');
  assert.equal(attempts, 1, 'the SET projection does not consume the bounded read retry');
  assert.equal(f.registrations.size, 1); assert.equal(f.scriptingRegistrations.size, 1);
  assert.equal(f.stored['protection:pending:v1'], true);
  f.api.userScripts.unregister = async request => { attempts++; return unregister(request); };
  const recovered = await f.controller.route(request('ui-api-config-get', { tabId: null }), f.ui);
  assert.equal(recovered.configuration.enabled, false); assert.equal(recovered.registration, 'inactive');
  assert.equal(recovered.revision, failed.revision); assert.deepEqual(recovered.configuration, failed.configuration);
  assert.equal(f.registrations.size, 0); assert.equal(f.scriptingRegistrations.size, 0);
  assert.equal(f.stored['protection:pending:v1'], false); assert.equal(attempts, 2);
  const writes = f.writes.length;
  for (let count = 0; count < 5; count++) await f.controller.state(null);
  assert.equal(attempts, 2); assert.equal(f.writes.length, writes);
  assert.deepEqual(f.executions, []); assert.deepEqual(f.messages, [], 'recovery never restores native in the current document');
});

test('persistent native OFF cleanup failure receives one read retry, not an unbounded polling loop', async () => {
  const f = fixture(); await f.controller.start();
  const enabled = custom(f.controller.configuration); enabled.enabled = true; enabled.antidetectEnabled = true; await f.controller.set(enabled, 0, null);
  let attempts = 0;
  f.api.userScripts.unregister = async () => { attempts++; throw new Error('persistent browser failure'); };
  const disabled = copy(f.controller.configuration); disabled.enabled = false; disabled.antidetectEnabled = false;
  await f.controller.set(disabled, 1, null);
  const writes = f.writes.length;
  for (let count = 0; count < 20; count++) {
    const state = await f.controller.state(null);
    assert.equal(state.configuration.enabled, false); assert.equal(state.registration, 'error');
  }
  assert.equal(attempts, 2); assert.equal(f.writes.length, writes);
  assert.equal(f.registrations.size, 1); assert.equal(f.scriptingRegistrations.size, 1);
  assert.equal(f.stored['protection:pending:v1'], true);
});

test('restored native access renews the bounded recovery budget after an earlier retry failed', async () => {
  const f = fixture(); await f.controller.start();
  const enabled = custom(f.controller.configuration); enabled.enabled = true; enabled.antidetectEnabled = true; await f.controller.set(enabled, 0, null);
  const unregister = f.api.userScripts.unregister;
  f.api.userScripts.unregister = async () => { throw new Error('unregister unavailable'); };
  const disabled = copy(f.controller.configuration); disabled.enabled = false; disabled.antidetectEnabled = false;
  await f.controller.set(disabled, 1, null); await f.controller.state(null);
  assert.equal(f.controller.recoveryAttempted, true);
  f.setEarlyAvailable(false); await f.controller.state(null);
  f.setEarlyAvailable(true); f.api.userScripts.unregister = unregister;
  const recovered = await f.controller.state(null);
  assert.equal(recovered.registration, 'inactive'); assert.equal(f.registrations.size, 0); assert.equal(f.scriptingRegistrations.size, 0);
  assert.equal(f.stored['protection:pending:v1'], false);
});

test('concurrent UI reads share one physical cleanup operation and one successful pending-marker write', async () => {
  const f = fixture(); await f.controller.start();
  const enabled = custom(f.controller.configuration); enabled.enabled = true; enabled.antidetectEnabled = true; await f.controller.set(enabled, 0, null);
  const unregister = f.api.userScripts.unregister;
  f.api.userScripts.unregister = async () => { throw new Error('temporary unregister failure'); };
  const disabled = copy(f.controller.configuration); disabled.enabled = false; disabled.antidetectEnabled = false; await f.controller.set(disabled, 1, null);
  let release, entered;
  const held = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  let attempts = 0;
  f.api.userScripts.unregister = async input => { attempts++; entered(); await held; return unregister(input); };
  const writes = f.writes.length;
  const first = f.controller.state(null), second = f.controller.state(null);
  await started; release();
  const states = await Promise.all([first, second]);
  assert.equal(attempts, 1); assert.equal(f.writes.length, writes + 1);
  for (const state of states) assert.equal(state.registration, 'inactive');
  assert.equal(f.registrations.size, 0); assert.equal(f.scriptingRegistrations.size, 0);
});

test('concurrent native-access restoration resets the failed-cleanup retry budget only once', async () => {
  const f = fixture(); await f.controller.start();
  const enabled = custom(f.controller.configuration); enabled.enabled = true; enabled.antidetectEnabled = true; await f.controller.set(enabled, 0, null);
  let attempts = 0;
  f.api.userScripts.unregister = async () => { attempts++; throw new Error('persistent unregister failure'); };
  const disabled = copy(f.controller.configuration); disabled.enabled = false; disabled.antidetectEnabled = false;
  await f.controller.set(disabled, 1, null); await f.controller.state(null);
  assert.equal(attempts, 2);
  f.setEarlyAvailable(false); await f.controller.state(null); f.setEarlyAvailable(true);
  await Promise.all([f.controller.state(null), f.controller.state(null)]);
  for (let count = 0; count < 5; count++) await f.controller.state(null);
  assert.equal(attempts, 3, 'one access restoration grants one shared retry, including concurrent UI reads');
  assert.equal(f.controller.recoveryAttempted, true); assert.equal(f.registrations.size, 1);
});

test('native early registration verification failure reports error and leaves recovery marker', async () => {
  const broken = fixture({ open: true }); await broken.controller.start(); broken.setDropRegistration(true);
  const bad = custom(broken.controller.configuration); bad.enabled = true; bad.antidetectEnabled = true;
  await broken.controller.set(bad, 0, null);
  assert.equal(broken.controller.registration, 'error'); assert.equal(broken.executions.length, 0);
  assert.equal(broken.messages.length, 0); assert.equal(broken.registrations.size, 0);
  assert.equal(broken.stored['protection:pending:v1'], true);
});
test('post-commit application failure is reported as saved state with retry marker', async () => {
  const f = fixture({ open: true }); await f.controller.start();
  const config = custom(f.controller.configuration); config.enabled = true; config.antidetectEnabled = true;
  f.api.tabs.query = async () => { throw new Error('browser unavailable'); };
  const saved = await f.controller.set(config, 0, null);
  assert.equal(saved.type, 'api-config-state'); assert.equal(saved.revision, 1);
  assert.equal(saved.registration, 'error'); assert.equal(saved.reloadRequired, true);
  assert.equal(f.stored[API_CONFIGURATION_STORAGE_KEY].revision, 1);
  assert.equal(f.stored['protection:pending:v1'], true);
});
test('scope and consent revocation unregister future profiles without weakening the open document', async () => {
  const f = fixture({ open: true }); await f.controller.start();
  const config = custom(f.controller.configuration); config.enabled = true; config.antidetectEnabled = true;
  await f.controller.set(config, 0, null);
  assert.equal(f.registrations.size, 1);
  f.scope.accessGeneration++; f.scope.accessReady = false;
  f.controller.legacyChanged(); await f.controller.refreshing;
  assert.equal(f.registrations.size, 0); assert.equal(f.controller.registration, 'inactive');
  assert.equal(f.scriptingRegistrations.size, 0);
  assert.equal(f.controller.reloadRequired, true); assert.equal(f.messages.length, 0); assert.equal(f.executions.length, 0);
  f.scope.accessReady = true; f.controller.legacyChanged(); await f.controller.refreshing;
  assert.equal(f.registrations.size, 1);
  f.scope.hasDataConsent = false; f.controller.legacyChanged(); await f.controller.refreshing;
  assert.equal(f.registrations.size, 0);
});
test('Firefox early profiles require no exact-document injection or asynchronous relay', async () => {
  const f = fixture({ open: true, firefox: true }); await f.controller.start();
  const config = custom(f.controller.configuration); config.enabled = true; config.antidetectEnabled = true;
  f.api.scripting.executeScript = async () => { throw new Error('document-targeted-injection-unsupported'); };
  const state = await f.controller.set(config, 0, null);
  assert.equal(state.type, 'api-config-state'); assert.equal(state.reloadRequired, true);
  assert.equal(state.earlyAccess, 'ready'); assert.equal(f.registrations.size, 1);
  assert.equal(f.messages.length, 0); assert.equal(f.executions.length, 0);
});
test('retired relay has no page channel, runtime listener or ready request', () => {
  const posts = [], listeners = [], sends = [];
  const context = vm.createContext({ window: { postMessage(packet) { posts.push(packet); }, addEventListener(...args) { listeners.push(args); } }, chrome: { runtime: {
    id: 'test-extension', getURL: () => 'chrome-extension://test-extension/', onMessage: { addListener(listener) { listeners.push(listener); } }, sendMessage(packet) { sends.push(packet); return Promise.resolve({}); }
  } } });
  vm.runInContext(readFileSync(new URL('../../apps/production-extension/api-custom-relay.js', import.meta.url), 'utf8'), context);
  assert.deepEqual(posts, []); assert.deepEqual(listeners, []); assert.deepEqual(sends, []);
});

test('disabled native userScripts access rejects activation before any settings write', async () => {
  for (const firefox of [false, true]) {
    const f = fixture({ firefox }); await f.controller.start(); f.setEarlyAvailable(false);
    const previous = copy(f.controller.configuration), config = custom(previous); config.enabled = true; config.antidetectEnabled = true;
    const response = await f.controller.set(config, 0, null);
    assert.equal(response.code, 'early-access-required');
    assert.equal(f.controller.earlyAccess, firefox ? 'permission-required' : 'browser-toggle-required');
    assert.equal(f.writes.length, 0); assert.equal(f.controller.revision, 0); assert.equal(f.registrations.size, 0);
    assert.deepEqual(f.controller.configuration, previous);
    const savedWhileOff = await f.controller.set({ ...config, enabled: false, antidetectEnabled: false }, 0, null);
    assert.equal(savedWhileOff.type, 'api-config-state'); assert.equal(savedWhileOff.configuration.enabled, false);
    assert.equal(savedWhileOff.configuration.apis.find(row => row.id === 'hardware-concurrency').selected.value, 16);
  }
});

test('failed native protocol cleanup remains an application error with master Off regardless of userScripts access', async () => {
  for (const earlyAvailable of [false, true]) {
    const f = fixture(); f.setEarlyAvailable(earlyAvailable);
    f.controller.antidetectProtocols.reconcile = async () => ({ status: 'error' });
    await f.controller.start();
    assert.equal(f.controller.configuration.enabled, false);
    assert.equal(f.controller.registration, 'error', 'native DNR cleanup failure cannot become an inactive status');
    assert.equal(f.controller.recoveryPending, true);
    const state = await f.controller.state(null);
    assert.equal(state.registration, 'error'); assert.equal(state.configuration.enabled, false);
    assert.equal(f.controller.recoveryPending, true); assert.equal(f.controller.revision, 0); assert.equal(f.writes.length, 0);
  }
});

test('committed master Off retains its recovery marker when both native protocol cleanup and userScripts access fail', async () => {
  const f = fixture(); await f.controller.start();
  const enabled = custom(f.controller.configuration); enabled.enabled = true; enabled.antidetectEnabled = true;
  assert.equal((await f.controller.set(enabled, 0, null)).registration, 'ready');
  f.setEarlyAvailable(false); f.controller.antidetectProtocols.reconcile = async () => ({ status: 'error' });
  const state = await f.controller.set({ ...f.controller.configuration, enabled: false, antidetectEnabled: false }, 1, null);
  assert.equal(state.type, 'api-config-state'); assert.equal(state.configuration.enabled, false);
  assert.equal(state.registration, 'error'); assert.equal(f.controller.recoveryPending, true);
  assert.equal(f.stored['protection:pending:v1'], true); assert.equal(f.stored[API_CONFIGURATION_STORAGE_KEY].configuration.enabled, false);
  assert.equal(f.registrations.size, 1, 'failed cleanup is reported without pretending an unavailable native unregister completed');
});

test('Firefox before 137 reports native early Custom unsupported', async () => {
  const f = fixture({ firefox: true, browserVersion: '136.0' }); f.setEarlyAvailable(false); await f.controller.start();
  const state = await f.controller.state(null);
  assert.equal(state.earlyAccess, 'unsupported');
  const config = custom(state.configuration); config.enabled = true; config.antidetectEnabled = true;
  assert.equal((await f.controller.set(config, 0, null)).code, 'early-access-required'); assert.equal(f.writes.length, 0);
});

test('startup reconciles persisted native profiles, retires v1 delivery and preserves unrelated scripts', async () => {
  const f = fixture(); let config = custom(createApiConfiguration()); config.enabled = true; config.antidetectEnabled = true;
  config = custom(config, 'example.com');
  f.legacy.settings = { ...legacySettings(true), global: [{ feature: 'hardware-concurrency', state: 'allow' }], sites: [{ host: 'example.com', disabled: false, rules: [{ feature: 'hardware-concurrency', state: 'allow' }] }] };
  f.stored[API_CONFIGURATION_STORAGE_KEY] = { revision: 7, configuration: config };
  for (const script of buildApiCustomScripts(config, f.scope.desiredMatches())) f.registrations.set(script.id, copy(script));
  f.registrations.set('unrelated-user-script', { id: 'unrelated-user-script', js: [{ code: '0;' }] });
  for (const id of ['detector-api-custom-main-v1', 'detector-api-custom-relay-v1']) f.obsoleteRegistrations.set(id, { id });
  await f.controller.start(); const state = await f.controller.state(null);
  assert.equal(state.revision, 7); assert.equal(state.registration, 'ready'); assert.equal(state.earlyAccess, 'ready');
  assert.equal(f.registrations.size, 3); assert.equal(f.scriptingRegistrations.size, 2); assert.equal(f.userCalls.register, 0);
  assert.equal(f.scriptingRegistrations.has('detector-api-custom-main-v1'), false);
  assert.equal(f.scriptingRegistrations.has('detector-api-custom-relay-v1'), false);
  assert.equal(f.writes.length, 0, 'Native persisted registrations do not rewrite policy or revision');
  assert.equal(f.registrations.has('unrelated-user-script'), true);
  assert.equal([...f.registrations.keys()].filter(id => id.startsWith(API_CUSTOM_SCRIPT_PREFIX)).length, 2);
});

test('opaque fallback files follow each complete exact-host profile and exclude locally disabled APIs', async () => {
  const f = fixture(); f.scope.desiredMatches = () => ['https://*.example.com/*']; await f.controller.start();
  let config = custom(f.controller.configuration); config.enabled = true; config.antidetectEnabled = true;
  config = change(config, 'device-memory', { mode: 'custom', selected: value(8) });
  config = change(config, 'hardware-concurrency', { mode: 'off' }, 'site.example.com');
  config = change(config, 'navigator-platform', { mode: 'custom', selected: value('Win32') }, 'site.example.com');
  const state = await f.controller.set(config, 0, null); assert.equal(state.registration, 'ready');
  const global = f.scriptingRegistrations.get('detector-api-custom-fallback-v2-global');
  assert.deepEqual(global.js, ['api-custom-inherit.main.js', 'api-custom-opaque.hardware-concurrency.js', 'api-custom-opaque.device-memory.js']);
  assert.deepEqual(global.excludeMatches, ['http://site.example.com/*', 'https://site.example.com/*']);
  const local = [...f.scriptingRegistrations.values()].find(row => row.id !== global.id);
  assert.deepEqual(local.matches, ['https://site.example.com/*']); assert.deepEqual(local.excludeMatches, []);
  assert.deepEqual(local.js, ['api-custom-inherit.main.js', 'api-custom-opaque.device-memory.js', 'api-custom-opaque.navigator-platform.js']);
  for (const row of f.scriptingRegistrations.values()) {
    assert.equal(row.world, 'MAIN'); assert.equal(row.matchOriginAsFallback, true);
    assert.ok(row.js.every(file => typeof file === 'string' && !file.includes('code:')));
  }
});

test('protocol ON fallback registrations contain only the exact effective guards and omit locally allowed protocols', async () => {
  const f = fixture(); f.scope.desiredMatches = () => ['https://*/*', 'http://*/*']; await f.controller.start();
  let config = { ...f.controller.configuration, enabled: true, preset: 'custom' };
  for (const id of ['webrtc', 'websocket', 'webtransport']) config = change(config, id, { mode: 'on' });
  config = change(config, 'webrtc', { mode: 'off' }, 'allow.example');
  config = change(config, 'websocket', { mode: 'off' }, 'allow.example');
  config = change(config, 'webrtc', { mode: 'bypass' }, 'disabled.example'); config.sites.find(row => row.host === 'disabled.example').disabled = true;
  const state = await f.controller.set(config, 0, null); assert.equal(state.registration, 'ready');
  const global = f.scriptingRegistrations.get('detector-api-custom-fallback-v2-global');
  assert.deepEqual(global.js, ['api-custom-inherit.main.js', 'antidetect-block-opaque.webrtc.js', 'antidetect-block-opaque.websocket.js', 'antidetect-block-opaque.webtransport.js']);
  const local = [...f.scriptingRegistrations.values()].find(row => row.matches.includes('https://allow.example/*'));
  assert.deepEqual(local.js, ['api-custom-inherit.main.js', 'antidetect-block-opaque.webtransport.js']);
  assert.deepEqual(local.matches, ['http://allow.example/*', 'https://allow.example/*']);
  assert.equal([...f.scriptingRegistrations.values()].some(row => row.matches.includes('https://disabled.example/*')), false);
  assert.ok([...f.scriptingRegistrations.values()].every(row => !row.js.some(file => /^protection\.(?:webrtc|websocket|webtransport)\.js$/.test(file))));
});

test('profile partition changes add coverage before updating/removing existing registrations', async () => {
  const f = fixture(); await f.controller.start();
  const global = custom(f.controller.configuration); global.enabled = true; global.antidetectEnabled = true; await f.controller.set(global, 0, null);
  let partitioned = custom(global, 'example.com');
  partitioned = change(partitioned, 'hardware-concurrency', { selected: value(8) }, 'example.com');
  f.registrationOperations.length = 0; await f.controller.set(partitioned, 1, null);
  assert.deepEqual(f.registrationOperations.map(entry => entry.operation), ['add', 'update']);
  f.registrationOperations.length = 0; await f.controller.set(global, 2, null);
  assert.deepEqual(f.registrationOperations.map(entry => entry.operation), ['update', 'remove']);
});

test('failed native update preserves the previous immutable profile rather than exposing raw values', async () => {
  const f = fixture(); await f.controller.start();
  const config = custom(f.controller.configuration); config.enabled = true; config.antidetectEnabled = true; await f.controller.set(config, 0, null);
  const before = copy([...f.registrations.values()][0]);
  f.setDropRegistration(true); f.registrationOperations.length = 0;
  const next = change(config, 'hardware-concurrency', { selected: value(8) });
  const state = await f.controller.set(next, 1, null);
  assert.equal(state.type, 'api-config-state'); assert.equal(state.registration, 'error');
  assert.deepEqual([...f.registrations.values()], [before]);
  assert.ok(!f.registrationOperations.some(entry => entry.operation === 'remove'));
  assert.equal(f.stored['protection:pending:v1'], true);
  assert.equal(state.configuration.apis.find(entry => entry.id === 'hardware-concurrency').selected.value, 8);
});

test('queued activation rechecks native access before the storage transaction', async () => {
  const f = fixture(); await f.controller.start();
  const before = copy(f.controller.configuration), config = custom(before); config.enabled = true; config.antidetectEnabled = true;
  const serialize = f.legacy.serialize.bind(f.legacy);
  f.legacy.serialize = operation => serialize(async () => {
    // The early fast check succeeded, but the user changed the browser toggle
    // before this queued operation acquired the shared settings writer.
    f.setEarlyAvailable(false);
    return operation();
  });
  const state = await f.controller.set(config, 0, null);
  assert.equal(state.code, 'early-access-required');
  assert.equal(f.writes.length, 0); assert.equal(f.controller.revision, 0);
  assert.deepEqual(f.controller.configuration, before); assert.equal(f.registrations.size, 0);
});

test('queued native WebRTC policy rechecks revoked optional privacy permission before any commit or application', async () => {
  const f = fixture(); await f.controller.start();
  const before = copy(f.controller.configuration), oldLegacy = copy(f.legacy.settings), nativeCalls = [];
  let permitted = true, permissionChecks = 0, fastCheckDone, release;
  const fastChecked = new Promise(resolve => { fastCheckDone = resolve; });
  f.api.permissions = { async contains(request) {
    assert.deepEqual(request, { permissions: ['privacy'] }); permissionChecks++;
    if (permissionChecks === 1) fastCheckDone();
    return permitted;
  } };
  f.api.privacy = { network: { webRTCIPHandlingPolicy: {
    async get() { nativeCalls.push('get'); return { value: 'default', levelOfControl: 'controllable_by_this_extension' }; },
    async set() { nativeCalls.push('set'); }, async clear() { nativeCalls.push('clear'); }
  } } };
  f.legacy.chain = new Promise(resolve => { release = resolve; });
  const pending = f.controller.route(request('ui-api-config-set', { tabId: null, expectedRevision: 0,
    configuration: { ...before, antidetectEnabled: true, webrtcNetworkPolicy: 'disable_non_proxied_udp' } }), f.ui);
  await fastChecked;
  assert.equal(f.writes.length, 0, 'the operation must still be waiting for the shared writer');
  permitted = false; release();
  const response = await pending;
  assert.equal(response.type, 'api-config-error'); assert.equal(response.code, 'privacy-permission-required');
  assert.equal(permissionChecks, 2); assert.deepEqual(nativeCalls, []);
  assert.equal(f.writes.length, 0); assert.equal(f.controller.revision, 0);
  assert.deepEqual(f.controller.configuration, before); assert.deepEqual(f.legacy.settings, oldLegacy);
  assert.equal(f.legacy.stops, 0); assert.deepEqual(f.registrationOperations, []); assert.deepEqual(f.executions, []);
});

test('origin-fallback bridge only invokes the parent apply capability with its own Window', () => {
  const calls = [], key = Symbol.for('detect.expert/api-custom/inherit/v2');
  const parent = {}, child = { location: { protocol: 'about:', href: 'about:srcdoc' } };
  Object.defineProperty(parent, key, { value: target => { calls.push(target); }, configurable: false, writable: false });
  child.parent = parent; child.opener = null;
  const source = readFileSync(new URL('../../apps/production-extension/api-custom-inherit.main.js', import.meta.url), 'utf8');
  const context = vm.createContext({ window: child, location: child.location, chrome: new Proxy({}, { get() { throw new Error('Privileged API access is forbidden'); } }) });
  vm.runInContext(source, context);
  assert.equal(calls.length, 1); assert.equal(calls[0], child);
  assert.equal(Object.getOwnPropertyDescriptor(parent, key).writable, false);
  assert.equal(Object.hasOwn(child, 'stop'), false);
});

test('origin-fallback bridge never invokes a page-defined property getter or returns a restore handle', () => {
  const calls = [], key = Symbol.for('detect.expert/api-custom/inherit/v2'); let getters = 0;
  const parent = {}, opener = {}, child = { location: { protocol: 'about:', href: 'about:blank' }, parent, opener };
  Object.defineProperty(parent, key, { get() { getters++; throw new Error('Page getter must not run'); } });
  Object.defineProperty(opener, key, { value: target => { calls.push(target); return { stop() { throw new Error('Must never restore'); } }; } });
  const source = readFileSync(new URL('../../apps/production-extension/api-custom-inherit.main.js', import.meta.url), 'utf8');
  const result = vm.runInNewContext(source, { window: child, location: child.location });
  assert.equal(result, undefined); assert.equal(getters, 0);
  assert.equal(calls.length, 1); assert.equal(calls[0], child);
});

test('ADR-107: a UI write refuses a new unsafe library label but keeps the stored configuration', async () => {
  const f = fixture(); await f.controller.start();
  const config = custom(f.controller.configuration);
  config.fingerprintProfiles = [{ id: 'fp-' + 'ab'.repeat(16), label: 'Safe' + String.fromCodePoint(0x202e) + 'label', preset: config.preset, webrtcNetworkPolicy: config.webrtcNetworkPolicy, apis: config.apis.map(row => ({ id: row.id, mode: row.mode, selected: row.selected, settings: row.settings })), tags: [], note: '' }];
  const response = await f.controller.route(request('ui-api-config-set', { tabId: null, expectedRevision: 0, configuration: config }), f.ui);
  assert.equal(response.type, 'api-config-error'); assert.equal(response.code, 'unsafe-label');
  assert.equal(f.writes.length, 0, 'nothing is written'); assert.equal(f.controller.revision, 0);
});

test('round 5: a UI write refuses a new unsafe profile tag or note, keeps unchanged stored ones and accepts clean tags and a multi-line note', async () => {
  const f = fixture(), bidi = String.fromCodePoint(0x202e), lineFeed = String.fromCodePoint(10), carriage = String.fromCodePoint(13);
  const stored = createApiConfiguration();
  // A stored format 9 book whose note already carries a bidirectional control (never checked before): it still loads and re-saves unchanged.
  stored.fingerprintProfiles = [{ id: 'fp-' + 'cd'.repeat(16), label: 'Stored', preset: stored.preset, webrtcNetworkPolicy: stored.webrtcNetworkPolicy,
    apis: stored.apis.map(({ id, mode, selected, settings }) => ({ id, mode, selected, settings })), tags: ['work'], note: 'old' + bidi + 'note' }];
  f.stored[API_CONFIGURATION_STORAGE_KEY] = { revision: 3, configuration: stored };
  await f.controller.start();
  assert.equal(f.controller.revision, 3); assert.equal(f.controller.configuration.fingerprintProfiles[0].note, 'old' + bidi + 'note');
  const write = async edit => {
    const next = copy(f.controller.configuration); edit(next.fingerprintProfiles[0]);
    return f.controller.route(request('ui-api-config-set', { tabId: null, expectedRevision: f.controller.revision, configuration: next }), f.ui);
  };
  const rejected = async (edit, message) => {
    const before = f.writes.length, revision = f.controller.revision, response = await write(edit);
    assert.equal(response.type, 'api-config-error', message); assert.equal(response.code, 'unsafe-label', message);
    assert.equal(f.writes.length, before, message + ': nothing is written'); assert.equal(f.controller.revision, revision, message);
  };
  await rejected(profile => { profile.tags = ['work', 'a' + bidi + 'b']; }, 'new unsafe tag');
  await rejected(profile => { profile.note = 'other' + bidi + 'note'; }, 'changed unsafe note');
  await rejected(profile => { profile.note = 'one' + carriage + 'two'; }, 'carriage return in a note');
  const kept = await write(profile => { profile.tags = ['home', 'work']; });
  assert.equal(kept.type, 'api-config-state', kept.message); assert.equal(f.controller.revision, 4);
  assert.deepEqual(f.controller.configuration.fingerprintProfiles[0].tags, ['home', 'work']); assert.equal(f.controller.configuration.fingerprintProfiles[0].note, 'old' + bidi + 'note');
  const cleaned = await write(profile => { profile.note = 'line one' + lineFeed + 'line two'; });
  assert.equal(cleaned.type, 'api-config-state', cleaned.message); assert.equal(f.controller.configuration.fingerprintProfiles[0].note, 'line one' + lineFeed + 'line two');
  await rejected(profile => { profile.note = 'old' + bidi + 'note'; }, 'a removed unsafe note is not grandfathered again');
});

test('ADR-112: a stored export of the round-5 pair (format 9 / catalog 10) is migrated at startup to format 10 / catalog 11, persisted before registration, keeps every saved value and profile and is not migrated twice', async () => {
  const source = JSON.parse(readFileSync(new URL('./api-configuration-catalog10-export.fixture.json', import.meta.url), 'utf8'));
  assert.equal(source.formatVersion, 9); assert.equal(source.catalogVersion, 10);
  const expected = upgradeApiConfiguration(copy(source));
  assert.equal(expected.ok, true, expected.error?.message); assert.equal(expected.migrated, true);
  const f = fixture(), policy = nativePolicy(f);
  f.legacy.settings = configurationToLegacy(expected.value, { revision: 9 });
  f.stored[API_CONFIGURATION_STORAGE_KEY] = { revision: 21, configuration: copy(source) };
  const register = f.api.userScripts.register;
  f.api.userScripts.register = async rows => {
    const saved = f.stored[API_CONFIGURATION_STORAGE_KEY];
    assert.equal(saved.configuration.formatVersion, 10); assert.equal(saved.configuration.catalogVersion, 11); assert.equal(saved.revision, 22, 'the upgrade is persisted before any registration');
    return register(rows);
  };
  await f.controller.start();
  const configWrites = fixtureOf => fixtureOf.writes.filter(write => Object.hasOwn(write, API_CONFIGURATION_STORAGE_KEY));
  assert.equal(f.controller.revision, 22); assert.equal(configWrites(f).length, 1, 'the configuration is written exactly once');
  const config = f.controller.configuration;
  assert.equal(config.formatVersion, 10); assert.equal(config.catalogVersion, 11);
  assert.deepEqual(config, expected.value, 'the controller holds exactly what upgradeApiConfiguration returns');
  const row = (holder, id) => holder.apis.find(entry => entry.id === id);
  assert.deepEqual(row(config, 'canvas-readback').selected, value({ algorithm: 'sparse-rgb-v1' }), 'a saved profile keeps its algorithm');
  assert.deepEqual(row(config, 'media-capabilities').selected, value({ hidden: ['h265', 'dolby'], powerEfficient: false, smooth: true, supported: true }), 'hidden codec families survive');
  assert.deepEqual(row(config, 'webgl-capabilities').selected, value({ extensions: [], parameters: { MAX_TEXTURE_SIZE: 4096 } }), 'a value saved from an old preset is kept');
  assert.deepEqual(config.fingerprintProfiles.map(saved => [saved.label, saved.tags, saved.note]), source.fingerprintProfiles.map(saved => [saved.label, saved.tags, saved.note]));
  const next = fixture(); nativePolicy(next); next.stored[API_CONFIGURATION_STORAGE_KEY] = copy(f.stored[API_CONFIGURATION_STORAGE_KEY]); next.legacy.settings = copy(f.legacy.settings);
  await next.controller.start();
  assert.equal(configWrites(next).length, 0); assert.equal(next.controller.revision, 22); assert.deepEqual(next.controller.configuration, expected.value);
  assert.ok(policy);
});

test('round 5: a stored export of the published round-4 module (format 8 / catalog 9) is migrated at startup, persisted as the current format 10 / catalog 11 before registration and not migrated twice', async () => {
  const source = JSON.parse(readFileSync(new URL('./api-configuration-catalog9-export.fixture.json', import.meta.url), 'utf8'));
  const expected = upgradeApiConfiguration(copy(source));
  assert.equal(expected.ok, true, expected.error?.message); assert.equal(expected.migrated, true);
  const f = fixture(), policy = nativePolicy(f);
  f.legacy.settings = configurationToLegacy(expected.value, { revision: 9 });
  f.stored[API_CONFIGURATION_STORAGE_KEY] = { revision: 21, configuration: copy(source) };
  const register = f.api.userScripts.register;
  f.api.userScripts.register = async rows => {
    const saved = f.stored[API_CONFIGURATION_STORAGE_KEY];
    assert.equal(saved.configuration.formatVersion, 10); assert.equal(saved.configuration.catalogVersion, 11); assert.equal(saved.revision, 22, 'the upgrade is persisted before any registration');
    return register(rows);
  };
  await f.controller.start();
  const configWrites = fixtureOf => fixtureOf.writes.filter(write => Object.hasOwn(write, API_CONFIGURATION_STORAGE_KEY));
  assert.equal(f.controller.revision, 22); assert.equal(configWrites(f).length, 1, 'the configuration is written exactly once'); assert.deepEqual(Object.keys(f.writes[0]), [API_CONFIGURATION_STORAGE_KEY]);
  const config = f.controller.configuration;
  assert.equal(config.formatVersion, 10); assert.equal(config.catalogVersion, 11);
  assert.deepEqual(config, expected.value, 'the controller holds exactly what upgradeApiConfiguration returns');
  assert.deepEqual(f.stored[API_CONFIGURATION_STORAGE_KEY].configuration, expected.value);
  const media = config.apis.find(row => row.id === 'media-capabilities');
  assert.deepEqual(media.selected, value({ hidden: [], powerEfficient: false, smooth: true, supported: true })); assert.equal(media.userValues.length, 2);
  assert.deepEqual(config.fingerprintProfiles.map(saved => [saved.label, saved.tags, saved.note]), source.fingerprintProfiles.map(saved => [saved.label, [], '']));
  assert.equal(config.webrtcNetworkPolicy, 'disable_non_proxied_udp'); assert.equal(policy.state().value, 'disable_non_proxied_udp', 'the saved native policy is reapplied');
  // The persisted copy is current: a second controller does not migrate or write again.
  const next = fixture(); nativePolicy(next); next.stored[API_CONFIGURATION_STORAGE_KEY] = copy(f.stored[API_CONFIGURATION_STORAGE_KEY]); next.legacy.settings = copy(f.legacy.settings);
  await next.controller.start();
  assert.equal(configWrites(next).length, 0); assert.equal(next.controller.revision, 22); assert.deepEqual(next.controller.configuration, expected.value);
});
