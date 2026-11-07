// ADR-113: the opt-in setting "do not run the observation sensors while Antidetect is on". The REAL ScopeController of the delivered
// background.js runs in a vm (cut at the same module boundaries as automatic-observation.test.mjs) with the REAL SensorQuietGate.
// Matrix: observation scope x Antidetect master x setting x browser family. Then live transitions (REQ-012), the start-up race, the strict
// reader of the stored record, the periods that let the Detector say "paused", the two UI messages and the wiring in background.js.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import {
  SENSOR_QUIET_KEY, SENSOR_QUIET_PERIODS_KEY, SENSOR_QUIET_MAX_PERIODS, SENSOR_QUIET_MESSAGES, SensorQuietGate, readSensorQuietSetting, readQuietPeriods,
  sensorQuietStatus, readSensorQuietState, presentQuietCoverage,
} from '../../apps/production-extension/sensor-quiet.js';
import { ApiConfigurationController } from '../../apps/production-extension/api-configuration-controller.js';

const background = readFileSync(new URL('../../apps/production-extension/background.js', import.meta.url), 'utf8');
const start = background.indexOf('// packages/contracts/src/data-consent.ts');
const end = background.indexOf('// packages/background/src/visual-preview.ts', start);
assert.ok(start >= 0 && end > start, 'the ScopeController module boundaries moved');
const CONSENT = 'data-consent:v1', SCOPE = 'scope', DEFAULT_APPLIED = 'scope:full-access-default-v1', CONFIGURATION = 'api-configuration:v1';
const SENSOR_IDS = ['detector-isolated-v1', 'detector-main-v1'];
const plain = value => structuredClone(value);
const own = { id: 'quiet-fixture', origin: 'chrome-extension://quiet-fixture' };
const verifyUiSender = (sender, id) => sender?.id === id && sender?.origin === 'chrome-extension://' + id && sender.tab === undefined;
const scopeRecord = mode => ({ v: 1, scopeMode: mode, hosts: mode === 'site' ? ['example.com'] : [] });
const configurationRecord = master => ({ revision: 3, configuration: { antidetectEnabled: master, enabled: false } });

/** A browser stand-in. `firefox` rejects the property matchOriginAsFallback the way a build that does not know it does. */
function fixture({ mode = 'all-sites', master = false, setting = false, browser = 'chrome', local = {}, session = {}, origins = ['<all_urls>'], failLocalGetOnce = false, failSet = false, preRegistered = false, time = { value: 1000 } } = {}) {
  const scripts = new Map(), calls = [], reads = [];
  if (!Object.hasOwn(local, CONSENT)) local[CONSENT] = { version: 1, accepted: true };
  if (!Object.hasOwn(local, SCOPE)) local[SCOPE] = scopeRecord(mode);
  if (!Object.hasOwn(local, DEFAULT_APPLIED)) local[DEFAULT_APPLIED] = true;
  if (!Object.hasOwn(local, CONFIGURATION)) local[CONFIGURATION] = configurationRecord(master);
  if (setting && !Object.hasOwn(local, SENSOR_QUIET_KEY)) local[SENSOR_QUIET_KEY] = { version: 1, enabled: true };
  let failedOnce = false;
  const area = (store, kind) => ({
    get: async keys => {
      if (kind === 'local') reads.push([...(Array.isArray(keys) ? keys : [keys])]);
      if (kind === 'local' && failLocalGetOnce && !failedOnce && (Array.isArray(keys) ? keys : [keys]).includes(SENSOR_QUIET_KEY)) { failedOnce = true; throw new Error('storage unavailable'); }
      return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => Object.hasOwn(store, key)).map(key => [key, plain(store[key])]));
    },
    set: async value => { if (failSet && kind === 'local' && Object.hasOwn(value, SENSOR_QUIET_KEY)) throw new Error('quota'); calls.push(['set:' + kind, Object.keys(value)]); Object.assign(store, plain(value)); },
    remove: async key => { for (const name of Array.isArray(key) ? key : [key]) delete store[name]; },
  });
  const reject = entries => { if (browser === 'firefox' && entries.some(entry => Object.hasOwn(entry, 'matchOriginAsFallback'))) throw new Error('Unexpected property "matchOriginAsFallback"'); };
  const api = {
    storage: { local: area(local, 'local'), session: area(session, 'session') },
    runtime: { id: own.id, getManifest: () => ({ host_permissions: ['http://*/*', 'https://*/*'] }) },
    permissions: { getAll: async () => ({ origins }), contains: async () => origins.includes('<all_urls>') },
    scripting: {
      getRegisteredContentScripts: async filter => [...scripts.values()].filter(script => !filter?.ids || filter.ids.includes(script.id)).map(plain),
      registerContentScripts: async entries => { reject(entries); calls.push(['register', entries.map(entry => entry.id)]); for (const entry of entries) scripts.set(entry.id, plain(entry)); },
      updateContentScripts: async entries => { reject(entries); calls.push(['update', entries.map(entry => entry.id)]); for (const entry of entries) scripts.set(entry.id, plain(entry)); },
      unregisterContentScripts: async ({ ids }) => { calls.push(['unregister', [...ids]]); for (const id of ids) scripts.delete(id); },
    },
  };
  if (preRegistered) for (const [index, id] of SENSOR_IDS.entries()) scripts.set(id, { id, js: [index ? 'hook.early.js' : 'bridge.js'], matches: ['http://*/*', 'https://*/*'], world: index ? 'MAIN' : 'ISOLATED', runAt: 'document_start', allFrames: true, persistAcrossSessions: true });
  const realm = vm.createContext({ api, SCOPE_MODES: ['off', 'all-sites', 'site', 'active-tab'], BUDGETS: { maxHostsPerDocument: 32 },
    isSanitizedHost: value => typeof value === 'string' && /^[a-z0-9.-]+$/.test(value), clock: { now: () => time.value } });
  vm.runInContext(background.slice(start, end) + '\nglobalThis.controller = new ScopeController(api, clock);', realm);
  const controller = realm.controller;
  const gate = new SensorQuietGate({ api, scope: controller, whenReady: () => Promise.resolve(), verifyUiSender, now: () => time.value });
  controller.sensorGate = gate;
  const registered = () => [...scripts.keys()].sort();
  return { controller, gate, api, local, session, scripts, calls, reads, registered, time, origins };
}
const matchesOf = f => JSON.parse(JSON.stringify(f.controller.desiredMatches()));
const settle = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };

// ---- the matrix -------------------------------------------------------------------------------------------------------------------------

for (const browser of ['chrome', 'firefox']) for (const mode of ['off', 'active-tab', 'site', 'all-sites']) for (const master of [false, true]) for (const setting of [false, true]) {
  test('matrix ' + browser + ' / scope ' + mode + ' / Antidetect ' + (master ? 'on' : 'off') + ' / setting ' + (setting ? 'on' : 'off') + ': sensors are withheld exactly when all three agree, Antidetect matches are untouched', async () => {
    const f = fixture({ browser, mode, master, setting });
    await f.controller.startup();
    const inScope = matchesOf(f), persistent = inScope.length > 0, withheld = persistent && master && setting;
    assert.deepEqual(inScope, mode === 'all-sites' ? ['http://*/*', 'https://*/*'] : mode === 'site' ? ['http://example.com/*', 'https://example.com/*'] : [], 'the scope matches Antidetect registers from never depend on the setting');
    assert.deepEqual(f.registered(), persistent && !withheld ? SENSOR_IDS : [], 'registered sensor scripts');
    assert.equal(f.controller.sensorsWithheld(), withheld);
    assert.equal(f.controller.getState().sensorsQuiet, withheld);
    assert.equal(f.controller.registrationHealthy, true);
    if (persistent && !withheld) {
      const [isolated, main] = SENSOR_IDS.map(id => f.scripts.get(id));
      assert.deepEqual([isolated.world, isolated.js[0], main.world, main.js[0]], ['ISOLATED', 'bridge.js', 'MAIN', 'hook.early.js']);
      assert.deepEqual([...main.matches].sort(), [...inScope].sort());
      assert.equal(Object.hasOwn(main, 'matchOriginAsFallback'), browser === 'chrome', 'Firefox retries without the property exactly as before');
    }
    // The stored record is read, never rewritten: nothing was written under the setting key by start-up.
    assert.deepEqual(f.local[SENSOR_QUIET_KEY], setting ? { version: 1, enabled: true } : undefined);
    assert.equal(f.calls.filter(([kind, keys]) => kind === 'set:local' && keys.includes(SENSOR_QUIET_KEY)).length, 0);
  });
}

test('default OFF changes nothing for anyone who never opened the setting: no gate at all and a gate with no stored record register the very same scripts', async () => {
  const bare = fixture({ master: true }); bare.controller.sensorGate = null; await bare.controller.startup();
  const gated = fixture({ master: true }); await gated.controller.startup();
  assert.deepEqual(bare.registered(), SENSOR_IDS); assert.deepEqual(gated.registered(), SENSOR_IDS);
  assert.deepEqual(gated.scripts.get(SENSOR_IDS[1]), bare.scripts.get(SENSOR_IDS[1]), 'byte-identical registration');
  assert.equal(Object.hasOwn(gated.local, SENSOR_QUIET_KEY), false, 'no record is created');
  assert.equal(gated.controller.getState().sensorsQuiet, false); assert.equal(bare.controller.getState().sensorsQuiet, false);
  assert.deepEqual(gated.calls.filter(([kind]) => kind === 'unregister'), [], 'the sensors are never unregistered when the setting was never turned on');
});

// ---- live transitions -------------------------------------------------------------------------------------------------------------------

test('turning the setting on and off applies on the fly: sensors are unregistered, then registered again, and the periods follow', async () => {
  const f = fixture({ master: true }); await f.controller.startup();
  assert.deepEqual(f.registered(), SENSOR_IDS);
  f.time.value = 2000;
  const on = await f.gate.set(true);
  assert.deepEqual(f.registered(), [], 'withheld from every site in scope');
  assert.deepEqual(plain(f.local[SENSOR_QUIET_KEY]), { version: 1, enabled: true });
  assert.deepEqual({ setting: on.setting, antidetect: on.antidetect, scoped: on.scoped, effective: on.effective, healthy: on.healthy }, { setting: true, antidetect: true, scoped: true, effective: true, healthy: true });
  assert.deepEqual(plain(f.session[SENSOR_QUIET_PERIODS_KEY]), [{ from: 2000, to: null }]);
  f.time.value = 3000;
  const off = await f.gate.set(false);
  assert.deepEqual(f.registered(), SENSOR_IDS, 'observation is restored for pages opened from now on');
  assert.equal(off.effective, false); assert.equal(off.setting, false);
  await settle();
  assert.deepEqual(plain(f.session[SENSOR_QUIET_PERIODS_KEY]), [{ from: 2000, to: 3000 }]);
  assert.deepEqual(plain(f.local[SENSOR_QUIET_KEY]), { version: 1, enabled: false });
  // The closed period names the documents opened while the sensors were away, and only those.
  assert.equal(f.gate.coversDocument(1999), false); assert.equal(f.gate.coversDocument(2000), true); assert.equal(f.gate.coversDocument(2999), true); assert.equal(f.gate.coversDocument(3000), false);
});

test('Antidetect master off/on moves the sensors with it while the setting stays on; Antidetect Custom matches are the scope matches in both states', async () => {
  const f = fixture({ master: false, setting: true }); await f.controller.startup();
  assert.deepEqual(f.registered(), SENSOR_IDS, 'setting on but Antidetect off: the sensors run, nothing is withheld');
  assert.equal(f.gate.state().effective, false);
  await f.gate.noteAntidetect(true);
  assert.deepEqual(f.registered(), [], 'Antidetect on: sensors withheld');
  assert.deepEqual(matchesOf(f), ['http://*/*', 'https://*/*']);
  await f.gate.noteAntidetect(true);
  assert.equal(f.calls.filter(([kind]) => kind === 'unregister').length, 1, 'an unchanged master does not touch the registration again');
  await f.gate.noteAntidetect(false);
  assert.deepEqual(f.registered(), SENSOR_IDS, 'Antidetect off: observation is restored');
  assert.deepEqual(matchesOf(f), ['http://*/*', 'https://*/*']);
});

test('the setting alone never touches the registration while Antidetect is off, and the master alone never does while the setting is off', async () => {
  const f = fixture({ master: false, setting: false }); await f.controller.startup();
  const before = f.calls.length;
  await f.gate.noteAntidetect(true); await f.gate.noteAntidetect(false);
  assert.equal(f.calls.length, before, 'no registration call: the setting was off');
  await f.gate.set(true);
  assert.deepEqual(f.registered(), SENSOR_IDS, 'the setting on with Antidetect off keeps the sensors');
});

test('scope changes move the withheld state: off stops it and closes the period, all-sites resumes it with a new period; consent loss unregisters as before', async () => {
  const f = fixture({ master: true, setting: true }); await f.controller.startup();
  assert.deepEqual(f.registered(), []); assert.equal(f.gate.periods.length, 1); assert.equal(f.gate.periods[0].to, null);
  f.time.value = 5000; const off = await f.controller.setScope({ scopeMode: 'off' });
  assert.equal(off.ok, true); assert.deepEqual(f.registered(), []); assert.equal(f.controller.sensorsWithheld(), false, 'no site is in scope, so nothing is being withheld');
  assert.equal(f.gate.periods[0].to, 5000, 'the period ended when nothing was in scope any more');
  f.time.value = 6000; const all = await f.controller.setScope({ scopeMode: 'all-sites' });
  assert.equal(all.ok, true); assert.deepEqual(f.registered(), []); assert.equal(f.controller.sensorsWithheld(), true);
  assert.deepEqual(f.gate.periods.map(period => [period.from, period.to]), [[1000, 5000], [6000, null]]);
  f.time.value = 7000; await f.controller.setDataConsent(false);
  assert.deepEqual(f.registered(), []); assert.equal(f.controller.sensorsWithheld(), false); assert.equal(f.gate.periods.at(-1).to, 7000);
});

test('a write failure leaves the setting and the registration as they were and says storage-error', async () => {
  const f = fixture({ master: true, failSet: true }); await f.controller.startup();
  const reply = await f.gate.set(true);
  assert.deepEqual(reply, { schemaVersion: 1, type: 'error', code: 'storage-error' });
  assert.equal(f.gate.setting, false); assert.deepEqual(f.registered(), SENSOR_IDS);
});

test('a registration the browser refuses is reported as not healthy instead of claiming success', async () => {
  const f = fixture({ master: true }); await f.controller.startup();
  f.api.scripting.unregisterContentScripts = async () => { throw new Error('browser refused'); };
  const reply = await f.gate.set(true);
  assert.equal(reply.healthy, false, 'the interface can say the browser did not confirm the change');
  assert.equal(reply.setting, true);
});

// ---- the start-up race ------------------------------------------------------------------------------------------------------------------

test('start-up with the setting and the master stored: the sensors are never registered, not even for a moment, before the configuration controller loads', async () => {
  const f = fixture({ master: true, setting: true }); await f.controller.startup();
  assert.deepEqual(f.calls.filter(([kind]) => kind === 'register' || kind === 'update'), [], 'not one register or update call');
  // The configuration controller then confirms the same master: no flap.
  const before = f.calls.length; await f.gate.noteAntidetect(true); assert.equal(f.calls.length, before);
});

test('sensors a previous browser session left registered are removed at start-up when they must stay out of the pages', async () => {
  const f = fixture({ master: true, setting: true, preRegistered: true }); assert.deepEqual(f.registered(), SENSOR_IDS);
  await f.controller.startup();
  assert.deepEqual(f.registered(), []); assert.deepEqual(f.calls.filter(([kind]) => kind === 'unregister').length, 1);
});

test('if the stored setting cannot be read the sensors keep running (observation stays the default) and the gate stays OFF', async () => {
  const f = fixture({ master: true, setting: true, failLocalGetOnce: true }); await f.controller.startup();
  assert.equal(f.gate.setting, false); assert.deepEqual(f.registered(), SENSOR_IDS);
});

test('the stored master is only a bootstrap: the configuration controller corrects it, and a master that is really off brings the sensors back', async () => {
  const f = fixture({ master: true, setting: true }); await f.controller.startup();
  assert.deepEqual(f.registered(), []);
  await f.gate.noteAntidetect(false);
  assert.deepEqual(f.registered(), SENSOR_IDS);
});

test('periods survive a service worker restart; a period still open when the setting is found off is closed', async () => {
  const f = fixture({ master: true, setting: true }); f.time.value = 4000; await f.controller.startup();
  await f.gate.persistPeriods(); const kept = plain(f.session);
  const again = fixture({ master: true, setting: true, session: kept, time: { value: 9000 } }); await again.controller.startup();
  assert.deepEqual(again.gate.periods.map(period => [period.from, period.to]), [[4000, null]], 'restored, and still open: no duplicate');
  const ended = fixture({ master: true, setting: false, session: kept, time: { value: 9500 } }); await ended.controller.startup();
  assert.deepEqual(ended.gate.periods.map(period => [period.from, period.to]), [[4000, 9500]]);
});

test('a user who left the setting off pays one tiny read at start-up: the stored configuration is never read by the gate until it is needed', async () => {
  const f = fixture({ master: true }); await f.controller.startup();
  assert.deepEqual(f.reads.filter(keys => keys.includes(SENSOR_QUIET_KEY)), [[SENSOR_QUIET_KEY]], 'the setting key alone');
  assert.equal(f.reads.some(keys => keys.includes('api-configuration:v1')), false, 'no read of the (possibly multi-megabyte) configuration');
  assert.equal(f.gate.known, false); assert.equal(f.gate.state().antidetect, false);
});

test('the interface asks, the gate reads the stored master once, and a later answer of the controller makes any further read unnecessary', async () => {
  const f = fixture({ master: true }); await f.controller.startup();
  const configurationReads = () => f.reads.filter(keys => keys.includes('api-configuration:v1')).length;
  const first = await f.gate.route({ schemaVersion: 1, type: 'ui-sensor-quiet-get' }, own);
  assert.equal(first.antidetect, true, 'the master is real even before the controller has spoken'); assert.equal(configurationReads(), 1);
  await f.gate.route({ schemaVersion: 1, type: 'ui-sensor-quiet-get' }, own); assert.equal(configurationReads(), 1, 'read once');
  const again = fixture({ master: true }); await again.controller.startup(); await again.gate.noteAntidetect(false);
  const reply = await again.gate.route({ schemaVersion: 1, type: 'ui-sensor-quiet-get' }, own);
  assert.equal(reply.antidetect, false, 'the controller is the authority'); assert.equal(again.reads.some(keys => keys.includes('api-configuration:v1')), false, 'no read at all');
});

test('turning the setting on before the controller has spoken still sees the real master, and a failed configuration read stays OFF without throwing', async () => {
  const f = fixture({ master: true }); await f.controller.startup();
  const reply = await f.gate.set(true);
  assert.equal(reply.antidetect, true); assert.equal(reply.effective, true); assert.deepEqual(f.registered(), []);
  const g = fixture({ master: true }); await g.controller.startup();
  g.api.storage.local.get = async () => { throw new Error('storage unavailable'); };
  await g.gate.ensureMaster(); assert.equal(g.gate.known, false); assert.equal(g.gate.antidetect, false);
});

// ---- strict readers ---------------------------------------------------------------------------------------------------------------------

test('only the exact record turns the stored setting on; every other shape reads as OFF and nothing throws', () => {
  assert.equal(readSensorQuietSetting({ version: 1, enabled: true }), true);
  assert.equal(readSensorQuietSetting({ version: 1, enabled: false }), false);
  const hostile = [undefined, null, true, 1, 'on', [], [true], {}, { enabled: true }, { version: 1 }, { version: 2, enabled: true }, { version: '1', enabled: true }, { version: 1, enabled: 'true' }, { version: 1, enabled: 1 },
    { version: 1, enabled: true, extra: 1 }, Object.create({ version: 1, enabled: true }), new Proxy({}, { ownKeys() { throw new Error('trap'); } }),
    Object.defineProperty({ version: 1 }, 'enabled', { enumerable: true, get() { throw new Error('getter must not run'); } }),
    Object.defineProperty({ enabled: true }, 'version', { enumerable: true, get() { throw new Error('getter must not run'); } }), { version: 1, enabled: true, [Symbol('x')]: 1 }];
  for (const value of hostile) assert.equal(readSensorQuietSetting(value), false);
});

test('periods read back only when they are the exact, ascending, bounded shape', () => {
  assert.deepEqual(readQuietPeriods([]), []); assert.deepEqual(readQuietPeriods([{ from: 1, to: 2 }, { from: 2, to: null }]), [{ from: 1, to: 2 }, { from: 2, to: null }]);
  const bad = [undefined, null, {}, 'x', [1], [{ from: 1 }], [{ from: 1, to: 2, extra: 0 }], [{ from: -1, to: null }], [{ from: 1.5, to: 2 }], [{ from: 2, to: 1 }], [{ from: '1', to: null }],
    [{ from: 1, to: null }, { from: 2, to: null }], [{ from: 1, to: 5 }, { from: 4, to: 6 }], [{ from: 5, to: 6 }, { from: 1, to: 2 }], new Array(SENSOR_QUIET_MAX_PERIODS + 1).fill({ from: 0, to: 0 }),
    new Proxy([], { get() { throw new Error('trap'); } })];
  for (const value of bad) assert.deepEqual(readQuietPeriods(value), []);
});

test('the eight newest periods are kept; an older one is dropped', async () => {
  const f = fixture({ master: true, setting: true }); await f.controller.startup();
  for (let index = 0; index < 12; index++) { f.time.value = 10000 + index * 100; f.gate.noteWithheld(false); f.time.value += 50; f.gate.noteWithheld(true); }
  assert.equal(f.gate.periods.length, SENSOR_QUIET_MAX_PERIODS);
  assert.ok(f.gate.periods.every((period, index, all) => index === 0 || all[index - 1].to <= period.from));
});

test('status words: off, waiting, idle, active - from the three booleans only', () => {
  assert.equal(sensorQuietStatus({ setting: false, antidetect: true, effective: true }), 'off');
  assert.equal(sensorQuietStatus({ setting: true, antidetect: false, effective: false }), 'waiting');
  assert.equal(sensorQuietStatus({ setting: true, antidetect: true, effective: false }), 'idle');
  assert.equal(sensorQuietStatus({ setting: true, antidetect: true, effective: true }), 'active');
  assert.equal(sensorQuietStatus(null), 'off'); assert.equal(sensorQuietStatus('x'), 'off');
});

test('the interface trusts a reply only with the exact seven fields', () => {
  const good = { schemaVersion: 1, type: 'sensor-quiet-state', setting: true, antidetect: false, scoped: true, effective: false, healthy: true };
  assert.deepEqual(readSensorQuietState(good), { setting: true, antidetect: false, scoped: true, effective: false, healthy: true });
  for (const bad of [null, [], { ...good, type: 'error' }, { ...good, schemaVersion: 2 }, { ...good, healthy: 1 }, { ...good, extra: true }, (({ healthy, ...rest }) => rest)(good), { ...good, setting: 'yes' }]) assert.equal(readSensorQuietState(bad), null);
});

// ---- what the Detector says --------------------------------------------------------------------------------------------------------------

test('a document opened while the sensors were withheld reads "paused"; nothing else changes and stronger or existing states stay', () => {
  const gate = { coversDocument: createdAt => createdAt === 2500 };
  const ref = (state, flags) => 'cov-' + state + '-' + flags.length;
  const projection = state => ({ coverageState: state, coverageFlags: ['network-limited'], findings: [{ findingId: 'f1', coverageRef: ref(state, ['network-limited']) }], techniques: [] });
  const report = { createdAt: 2500 }, meta = { sensorSeen: false, revoked: false, accessGranted: true };
  const shown = presentQuietCoverage(projection('partial'), report, meta, gate, ref);
  assert.equal(shown.coverageState, 'paused'); assert.deepEqual(shown.coverageFlags, ['network-limited'], 'the flags stay truthful: the user did not pause');
  assert.equal(shown.findings[0].coverageRef, 'cov-paused-1'); assert.equal(shown.findings[0].findingId, 'f1');
  for (const state of ['active', 'late-start', 'degraded']) assert.equal(presentQuietCoverage(projection(state), report, meta, gate, ref).coverageState, 'paused', state);
  for (const state of ['paused', 'no-access', 'unsupported']) assert.equal(presentQuietCoverage(projection(state), report, meta, gate, ref).coverageState, state, state + ' keeps its own meaning');
  assert.equal(presentQuietCoverage(projection('partial'), { createdAt: 9 }, meta, gate, ref).coverageState, 'partial', 'a document opened outside every period is untouched');
  assert.equal(presentQuietCoverage(projection('partial'), report, { ...meta, sensorSeen: true }, gate, ref).coverageState, 'partial', 'a document whose sensors reported is observed');
  assert.equal(presentQuietCoverage(projection('partial'), report, { ...meta, revoked: true }, gate, ref).coverageState, 'partial');
  assert.equal(presentQuietCoverage(projection('partial'), report, { ...meta, accessGranted: false }, gate, ref).coverageState, 'partial');
  const input = projection('partial'); presentQuietCoverage(input, report, meta, gate, ref); assert.equal(input.coverageState, 'partial', 'the input projection is not mutated');
  assert.equal(presentQuietCoverage(null, report, meta, gate, ref), null); assert.equal(presentQuietCoverage(input, report, meta, null, ref), input);
  assert.equal(presentQuietCoverage(input, report, meta, { coversDocument() { throw new Error('boom'); } }, ref), input, 'a failing gate leaves the ordinary projection');
});

// ---- the two UI messages ----------------------------------------------------------------------------------------------------------------

test('the UI messages: exact shape, extension pages only, boolean only, data consent required; every other message falls through', async () => {
  const f = fixture({ master: true }); await f.controller.startup();
  assert.deepEqual([...SENSOR_QUIET_MESSAGES], ['ui-sensor-quiet-get', 'ui-sensor-quiet-set']);
  const get = { schemaVersion: 1, type: 'ui-sensor-quiet-get' };
  const reply = await f.gate.route(get, own);
  assert.deepEqual(reply, { schemaVersion: 1, type: 'sensor-quiet-state', setting: false, antidetect: true, scoped: true, effective: false, healthy: true });
  assert.equal(f.gate.route({ schemaVersion: 1, type: 'ui-get-report', tabId: 1 }, own), null, 'foreign types are not ours');
  assert.equal(f.gate.route(null, own), null); assert.equal(f.gate.route('x', own), null);
  const bad = [{ ...get, extra: 1 }, { schemaVersion: 2, type: get.type }, { type: get.type }, { schemaVersion: 1, type: 'ui-sensor-quiet-set' }, { schemaVersion: 1, type: 'ui-sensor-quiet-set', enabled: 'true' },
    { schemaVersion: 1, type: 'ui-sensor-quiet-set', enabled: 1 }, { schemaVersion: 1, type: 'ui-sensor-quiet-set', enabled: true, extra: 1 }, { schemaVersion: 1, type: 'ui-sensor-quiet-get', enabled: true },
    Object.defineProperty({ schemaVersion: 1 }, 'type', { enumerable: true, get() { throw new Error('getter must not run'); } })];
  for (const message of bad) { const answer = f.gate.route(message, own); if (answer !== null) assert.equal((await answer).code, 'invalid-request'); }
  for (const sender of [{ id: 'other-extension', origin: 'chrome-extension://other-extension' }, { id: own.id, origin: 'https://evil.example', tab: { id: 1 } }, { id: own.id, origin: own.origin, tab: { id: 1 } }, {}, undefined]) {
    assert.equal((await f.gate.route({ schemaVersion: 1, type: 'ui-sensor-quiet-set', enabled: true }, sender)).code, 'unauthorized-sender');
  }
  assert.equal(f.gate.setting, false, 'a page or a foreign extension never changes the setting');
  const set = await f.gate.route({ schemaVersion: 1, type: 'ui-sensor-quiet-set', enabled: true }, own);
  assert.equal(set.setting, true); assert.equal(set.effective, true); assert.deepEqual(f.registered(), []);
  await f.controller.setDataConsent(false);
  assert.equal((await f.gate.route(get, own)).code, 'no-access', 'without data consent the setting is not served');
});

// ---- the hook in the configuration controller and the wiring -----------------------------------------------------------------------------

test('ApiConfigurationController.reconcile tells the gate the master of its configuration before it does anything else', async () => {
  const sentinel = new Error('stop here');
  for (const master of [true, false]) {
    const noted = [];
    const fake = { recoveryAttempted: true, scope: { sensorGate: { noteAntidetect(value) { noted.push(value); return Promise.resolve(); } } }, configuration: { antidetectEnabled: master }, webrtcNetwork: { reconcile() { throw sentinel; } } };
    await assert.rejects(ApiConfigurationController.prototype.reconcile.call(fake), sentinel);
    assert.deepEqual(noted, [master]);
  }
  const quiet = { recoveryAttempted: true, scope: {}, configuration: { antidetectEnabled: true }, webrtcNetwork: { reconcile() { throw sentinel; } } };
  await assert.rejects(ApiConfigurationController.prototype.reconcile.call(quiet), sentinel);
});

test('background.js: the gate is wired once, outside the generated ADR-048 block, before start(), and every projection reader goes through the override', () => {
  const marker = (text, from = 0) => { const at = background.indexOf(text, from); assert.ok(at >= 0, 'missing ' + text); return at; };
  const adrEnd = marker('// ADR-048 API configuration integration end\n'), begin = marker('// ADR-113 sensor quiet integration start\n'), finish = marker('// ADR-113 sensor quiet integration end\n'), starting = marker('background.start();\n', finish);
  assert.ok(adrEnd < begin && begin < finish && finish < starting, 'order: ADR-048 block, ADR-113 block, background.start()');
  assert.equal(background.split('// ADR-113 sensor quiet integration start').length, 2);
  const block = background.slice(begin, finish);
  assert.match(block, /background\.runtime\.sensorQuiet = new SensorQuietGate\(\{ api: chrome, scope: background\.runtime\.scope, whenReady: \(\) => background\.runtime\.whenReady\(\), verifyUiSender \}\);/);
  assert.match(block, /background\.runtime\.scope\.sensorGate = background\.runtime\.sensorQuiet;/);
  assert.match(block, /background\.runtime\.projectionByKey = documentKey => presentQuietCoverage\(ordinaryProjection\(documentKey\), background\.runtime\.state\.reports\.get\(documentKey\), background\.runtime\.state\.metas\.get\(documentKey\), background\.runtime\.sensorQuiet, coverageRef\);/);
  assert.match(background, /import \{ SensorQuietGate, presentQuietCoverage \} from "\.\/sensor-quiet\.js";\nimport \{ withProReportHistoryPurge \} from "\.\/pro-report-history\.js";\n/, 'the import sits before the archive import that must stay last');
  const route = background.slice(marker('async function route(runtime, message, sender) {'), marker('function createMessageListener(runtime)'));
  assert.ok(route.indexOf('runtime.apiConfiguration?.route(message, sender)') < route.indexOf('runtime.sensorQuiet?.route(message, sender)') && route.indexOf('runtime.sensorQuiet?.route(message, sender)') < route.indexOf('let messageType'), 'the route is consulted right after the configuration route and before any page handling');
  // The Antidetect Custom registration still takes its matches from the scope, never from the gate.
  const controller = readFileSync(new URL('../../apps/production-extension/api-configuration-controller.js', import.meta.url), 'utf8');
  assert.equal(controller.split('this.scope.desiredMatches()').length - 1, 3, 'protocol rules, header rules and Custom scripts all keep using desiredMatches()');
  assert.equal(/sensorsWithheld|sensorMatches/.test(controller), false, 'the Custom registration does not know about the setting');
});

test('the wired route answers the two messages before any page handling, with the real route function', async () => {
  const routeSource = background.slice(background.indexOf('async function route(runtime, message, sender) {'), background.indexOf('function createMessageListener(runtime)'));
  const context = vm.createContext({});
  vm.runInContext(routeSource.replace('async function route(', 'globalThis.route = async function route('), context);
  const f = fixture({ master: true }); await f.controller.startup();
  const runtime = { apiConfiguration: null, sensorQuiet: f.gate, api: { runtime: { id: own.id } } };
  const reply = await context.route(runtime, { schemaVersion: 1, type: 'ui-sensor-quiet-get' }, own);
  assert.equal(reply.type, 'sensor-quiet-state'); assert.equal(reply.antidetect, true);
  const set = await context.route(runtime, { schemaVersion: 1, type: 'ui-sensor-quiet-set', enabled: true }, own);
  assert.equal(set.effective, true); assert.deepEqual(f.registered(), []);
});
