// ADR-107 round 5: the service worker ends a temporary profile of an earlier browser session before it registers anything: a valid record without
// the storage.session marker is laid back over the current configuration through the same revision-checked write as every other change.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiConfigurationController, API_CONFIGURATION_STORAGE_KEY } from '../../apps/production-extension/api-configuration-controller.js';
import { createApiConfiguration, updateApiConfiguration, configurationToLegacy } from '../../apps/production-extension/api-configuration.js';
import { snapshotFingerprintProfile } from '../../apps/production-extension/fingerprint-profiles.js';
import { overlayProfile, buildTemporaryRecord, buildLiveMarker, TEMPORARY_KEY, TEMPORARY_LIVE_KEY } from '../../apps/production-extension/fingerprint-temporary.js';
import { clone } from './fingerprint-identity-fixtures.mjs';

const value = raw => ({ kind: 'value', value: raw });
const set = (config, id, patch, host = null) => { const result = updateApiConfiguration(config, id, patch, host); assert.equal(result.ok, true, result.error?.message); return result.value; };
const legacySettings = () => ({ schemaVersion: 1, revision: 0, enabled: false, preset: 'limited', global: [], sites: [] });

// The controller with a fake browser: storage.local with remove, storage.session, scripting/userScripts registries and the privileged lists it needs.
function fixture({ session = {}, local = {}, sessionApi = true, earlyAvailable = true, failStorage = false } = {}) {
  const saved = local[API_CONFIGURATION_STORAGE_KEY]?.configuration;
  const stored = clone(local), sessionData = clone(session), writes = [], registrations = new Map(), scripting = new Map(), removed = [];
  let refuseWrites = failStorage, controller;
  const origin = 'chrome-extension://test-extension';
  const api = {
    runtime: { id: 'test-extension', getURL: path => origin + '/' + path, getManifest: () => ({ manifest_version: 3, permissions: ['userScripts'] }) },
    storage: { local: {
      async get(key) { return Object.hasOwn(stored, key) ? { [key]: clone(stored[key]) } : {}; },
      async set(items) { if (refuseWrites) throw new Error('disk full'); writes.push(clone(items)); Object.assign(stored, clone(items)); },
      async remove(key) { removed.push(key); delete stored[key]; } },
      ...(sessionApi ? { session: { async get(key) { if (sessionApi === 'broken') throw new Error('session unavailable'); return Object.hasOwn(sessionData, key) ? { [key]: clone(sessionData[key]) } : {}; } } } : {}) },
    scripting: {
      async getRegisteredContentScripts({ ids } = {}) { return [...scripting.values()].filter(row => !ids || ids.includes(row.id)).map(clone); },
      async registerContentScripts(rows) { for (const row of rows) scripting.set(row.id, clone(row)); },
      async updateContentScripts(rows) { for (const row of rows) scripting.set(row.id, clone(row)); },
      async unregisterContentScripts({ ids }) { for (const id of ids) scripting.delete(id); } },
    userScripts: {
      async getScripts() { if (!earlyAvailable) throw new Error('browser userScripts access disabled'); return [...registrations.values()].map(clone); },
      async register(rows) { for (const row of rows) registrations.set(row.id, clone(row)); },
      async update(rows) { for (const row of rows) registrations.set(row.id, clone(row)); },
      async unregister({ ids }) { for (const id of ids) registrations.delete(id); } },
    tabs: { async query() { return []; } }, webNavigation: { async getAllFrames() { return []; } } };
  const scope = { accessReady: true, hasDataConsent: true, accessGeneration: 1, desiredMatches: () => ['https://example.com/*'], isGranted: async () => true };
  // In a real profile the old API Guard projection is stored next to the configuration and agrees with it.
  const legacy = { settings: saved ? configurationToLegacy(saved, null) : legacySettings(), chain: Promise.resolve(), registration: 'inactive', accessUnavailable: false, cleanupIncomplete: false, async start() {},
    serialize(operation) { const next = this.chain.then(operation, operation); this.chain = next.catch(() => {}); return next.finally(() => controller?.legacyChanged()); },
    async reconcile() { this.registration = this.settings.enabled ? 'ready' : 'inactive'; }, async stopOpenDocuments() {}, async finishApplication() { await api.storage.local.set({ 'protection:pending:v1': false }); } };
  controller = new ApiConfigurationController({ api, legacy, scope, whenReady: async () => {}, verifyUiSender: () => true, readPageSender: () => ({ ok: false }) });
  return { api, controller, stored, sessionData, writes, registrations, removed, legacy, setRefuse: flag => { refuseWrites = flag; } };
}

// The scenario: the user had `before` applied, started a temporary profile `temp` (one Custom row) and the browser restarted.
const before = set(createApiConfiguration(), 'device-memory', { mode: 'custom', selected: value(8) });
const temp = set(createApiConfiguration(), 'hardware-concurrency', { mode: 'custom', selected: value(16) });
const previous = snapshotFingerprintProfile(before, 'previous', 'fp-' + '0a'.repeat(16));
const applied = { ...overlayProfile(before, snapshotFingerprintProfile(temp, 'temp', 'fp-' + '0b'.repeat(16))), antidetectEnabled: true };
const recordOf = (startedAt = 1_800_000_000_000) => buildTemporaryRecord({ startedAt, label: 'Trip', previous });
const stage = (extra = {}) => fixture({ local: { [API_CONFIGURATION_STORAGE_KEY]: { revision: 4, configuration: applied }, [TEMPORARY_KEY]: recordOf() }, ...extra });
// The rows a registered script carries (the same extraction as api-configuration-controller.test.mjs).
const packedRows = registrations => [...registrations.values()].flatMap(script => JSON.parse(/const packed = (.+);\n/.exec(script.js[0].code)[1]).map(row => row.id)).sort();
const value_ = (configuration, id) => { const row = configuration.apis.find(item => item.id === id); return row.mode === 'custom' ? row.selected.value : null; };

test('a record without its marker is reverted at start-up, before anything is registered; the master the user set stays and the revision moves once', async () => {
  const f = stage(); await f.controller.start();
  assert.equal(value_(f.controller.configuration, 'hardware-concurrency'), null, 'the temporary row is gone'); assert.equal(value_(f.controller.configuration, 'device-memory'), 8, 'the remembered row is back');
  assert.equal(f.controller.configuration.antidetectEnabled, true); assert.equal(f.controller.revision, 5); assert.equal(f.stored[API_CONFIGURATION_STORAGE_KEY].revision, 5);
  assert.deepEqual(f.stored[API_CONFIGURATION_STORAGE_KEY].configuration, f.controller.configuration, 'what is stored is what runs');
  assert.equal(Object.hasOwn(f.stored, TEMPORARY_KEY), false, 'the record is removed'); assert.deepEqual(f.removed, [TEMPORARY_KEY]);
  // The user-script registration follows the restored rows: the device-memory profile, not the temporary hardware-concurrency one.
  assert.ok(f.registrations.size > 0); assert.ok(packedRows(f.registrations).includes('device-memory') && !packedRows(f.registrations).includes('hardware-concurrency'), 'registered scripts carry the restored state only');
  assert.deepEqual(f.stored['protection:v1'] ?? configurationToLegacy(f.controller.configuration, null), configurationToLegacy(f.controller.configuration, f.stored['protection:v1'] ?? null), 'the old projection is consistent with it');
});

test('the same record WITH its marker (a service worker restart inside one browser session) changes nothing', async () => {
  const f = stage({ session: { [TEMPORARY_LIVE_KEY]: buildLiveMarker(1_800_000_000_000) } }); await f.controller.start();
  assert.equal(value_(f.controller.configuration, 'hardware-concurrency'), 16, 'the temporary profile stays'); assert.equal(f.controller.revision, 4); assert.deepEqual(f.removed, []); assert.ok(Object.hasOwn(f.stored, TEMPORARY_KEY));
  assert.ok(packedRows(f.registrations).includes('hardware-concurrency') && !packedRows(f.registrations).includes('device-memory'), 'and the registration still carries it');
});

test('no record, a record that is not valid, and a record that already matches never rewrite the configuration', async () => {
  const none = fixture({ local: { [API_CONFIGURATION_STORAGE_KEY]: { revision: 4, configuration: applied } } }); await none.controller.start(); assert.equal(none.controller.revision, 4); assert.deepEqual(none.removed, []);
  const junk = fixture({ local: { [API_CONFIGURATION_STORAGE_KEY]: { revision: 4, configuration: applied }, [TEMPORARY_KEY]: { version: 1, startedAt: 5, label: 'x', previous: { id: 'bad' } } } }); await junk.controller.start();
  assert.equal(junk.controller.revision, 4, 'nothing can be restored from it'); assert.equal(value_(junk.controller.configuration, 'hardware-concurrency'), 16); assert.deepEqual(junk.removed, [TEMPORARY_KEY], 'but the junk is removed');
  const matching = fixture({ local: { [API_CONFIGURATION_STORAGE_KEY]: { revision: 4, configuration: overlayProfile(applied, previous) }, [TEMPORARY_KEY]: recordOf() } }); await matching.controller.start();
  assert.equal(matching.controller.revision, 4, 'already the remembered state: no write'); assert.deepEqual(matching.removed, [TEMPORARY_KEY]);
});

test('whatever is uncertain keeps the record for the next start: a refused write, no session storage, a broken session read', async () => {
  const refused = stage(); refused.setRefuse(true); await refused.controller.start();
  assert.ok(Object.hasOwn(refused.stored, TEMPORARY_KEY), 'a refused write keeps the record'); assert.equal(value_(refused.controller.configuration, 'hardware-concurrency'), 16, 'the temporary profile still runs, and the next start tries again');
  const noSession = stage({ sessionApi: false }); await noSession.controller.start(); assert.ok(Object.hasOwn(noSession.stored, TEMPORARY_KEY)); assert.equal(noSession.controller.revision, 4, 'without session storage "restarted" cannot be told');
  const broken = stage({ sessionApi: 'broken' }); await broken.controller.start(); assert.ok(Object.hasOwn(broken.stored, TEMPORARY_KEY)); assert.equal(broken.controller.revision, 4);
  // The next start (the write works now) finishes the job.
  const retry = stage(); retry.setRefuse(true); await retry.controller.start(); retry.setRefuse(false); retry.controller.loading = null; await retry.controller.start();
  assert.equal(value_(retry.controller.configuration, 'hardware-concurrency'), null); assert.equal(Object.hasOwn(retry.stored, TEMPORARY_KEY), false);
});

test('ending is not an activation: a missing permission or browser switch does not refuse the restore, and an unsupported policy is not refused either', async () => {
  const withPolicy = { ...before, webrtcNetworkPolicy: 'proxy_only' };
  const remembered = snapshotFingerprintProfile(withPolicy, 'previous', 'fp-' + '0c'.repeat(16));
  const f = fixture({ earlyAvailable: false, local: { [API_CONFIGURATION_STORAGE_KEY]: { revision: 4, configuration: { ...applied, antidetectEnabled: true } }, [TEMPORARY_KEY]: buildTemporaryRecord({ startedAt: 1_800_000_000_000, label: 'Trip', previous: remembered }) } });
  f.controller.webrtcNetwork.refusal = () => 'webrtc-policy-unsupported'; f.controller.webrtcNetwork.allowed = async () => false;
  await f.controller.start();
  assert.equal(f.controller.configuration.webrtcNetworkPolicy, 'proxy_only', 'a UI write would have been refused; the restore of an earlier state is not');
  assert.equal(value_(f.controller.configuration, 'hardware-concurrency'), null); assert.equal(Object.hasOwn(f.stored, TEMPORARY_KEY), false);
  // The same configuration through the normal write path IS refused (the gates still work for the UI).
  const ui = fixture({ earlyAvailable: false, local: { [API_CONFIGURATION_STORAGE_KEY]: { revision: 4, configuration: applied } } }); await ui.controller.start();
  ui.controller.webrtcNetwork.refusal = () => 'webrtc-policy-unsupported';
  const refusal = await ui.controller.set({ ...applied, webrtcNetworkPolicy: 'proxy_only' }, 4, null); assert.equal(refusal.code, 'webrtc-policy-unsupported');
});

test('a remembered state that cannot be laid over the current configuration is discarded instead of being retried at every start', async () => {
  // A site keeps WebRTC device randomization; the remembered rows hold Custom media enumeration: together they are the contract's refused combination.
  const rtc = { addresses: null, iceTransportPolicy: 'preserve', randomizeDevices: true, freshCertificates: false, deviceLifetime: 'site' };
  let current = set(createApiConfiguration(), 'webrtc', { mode: 'custom', selected: value(rtc) }, 'rtc.example'); current = { ...current, antidetectEnabled: true };
  const remembered = snapshotFingerprintProfile(set(createApiConfiguration(), 'media-enumeration', { mode: 'custom', selected: value([]) }), 'previous', 'fp-' + '0d'.repeat(16));
  assert.equal(overlayProfile(current, remembered), null, 'the combination is refused by the contract');
  const f = fixture({ local: { [API_CONFIGURATION_STORAGE_KEY]: { revision: 4, configuration: current }, [TEMPORARY_KEY]: buildTemporaryRecord({ startedAt: 1_800_000_000_000, label: 'Trip', previous: remembered }) } });
  await f.controller.start(); assert.equal(f.controller.revision, 4); assert.equal(Object.hasOwn(f.stored, TEMPORARY_KEY), false, 'the record does not stay behind');
});
