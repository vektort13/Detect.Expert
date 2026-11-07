import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApiConfiguration, updateApiConfiguration } from '../../apps/production-extension/api-configuration.js';
import { antidetectDraft, applyAntidetectDraft, createAntidetectController, ipv4MappedIpv6 } from '../../apps/production-extension/antidetect-controller.js';

const copy = value => structuredClone(value), row = (config, id) => config.apis.find(entry => entry.id === id);
const errorCode = code => error => error?.code === code && error.message === code;
function selected(config, id, value, mode = 'custom') {
  const result = updateApiConfiguration(config, id, { mode, selected: { kind: 'value', value } });
  assert.equal(result.ok, true, result.error?.message); return result.value;
}
function profile(patch = {}) { return { addresses: null, iceTransportPolicy: 'preserve', randomizeDevices: false, freshCertificates: false, deviceLifetime: 'session', ...patch }; }
function event() {
  const listeners = new Set();
  return { addListener: callback => listeners.add(callback), removeListener: callback => listeners.delete(callback),
    emit: (...args) => { for (const callback of listeners) callback(...args); }, count: () => listeners.size };
}
function environment(url = 'chrome-extension://owned/options.html#antidetect', framed = false) {
  const before = { location: Object.getOwnPropertyDescriptor(globalThis, 'location'), window: Object.getOwnPropertyDescriptor(globalThis, 'window') };
  const window = {}; window.top = framed ? {} : window;
  Object.defineProperty(globalThis, 'location', { configurable: true, writable: true, value: { href: url } });
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: window });
  return () => { for (const key of ['location', 'window']) if (before[key]) Object.defineProperty(globalThis, key, before[key]); else delete globalThis[key]; };
}
function fixture(config = createApiConfiguration()) {
  const calls = [], permissionCalls = [], changes = event(), removed = event();
  let current = { schemaVersion: 1, type: 'api-config-state', revision: 1, configuration: copy(config), registration: 'ready', reloadRequired: false,
    earlyAccess: 'ready', webrtcNetwork: { desired: 'system', status: 'inactive', value: null, levelOfControl: null } };
  let handler, requestResult = true, nativeRules = [], ruleHandler;
  const api = { runtime: { id: 'owned', getURL: path => 'chrome-extension://owned/' + path,
    async sendMessage(message) {
      calls.push(copy(message)); if (handler) return handler(message);
      if (message.type === 'ui-api-config-set') {
        if (message.expectedRevision !== current.revision) return { type: 'api-config-error', code: 'stale-revision' };
        current = { ...current, revision: current.revision + 1, configuration: copy(message.configuration) };
      }
      return copy(current);
    } }, storage: { onChanged: changes }, permissions: { onRemoved: removed, request(value) { permissionCalls.push(copy(value)); return Promise.resolve(requestResult); } },
    declarativeNetRequest: { async getDynamicRules() { return ruleHandler ? ruleHandler() : copy(nativeRules); } }, tabs: { async create(value) { calls.push(['tab-create', value]); } } };
  return { api, calls, permissionCalls, changes, removed, state: () => copy(current), set: value => { current = { ...current, ...copy(value) }; },
    handler: value => { handler = value; }, permission: value => { requestResult = value; }, rules: value => { nativeRules = copy(value); }, ruleHandler: value => { ruleHandler = value; } };
}

test('WebRTC Allow/Block/Spoof/Inheritance maps to canonical modes and never enables the master implicitly', () => {
  const config = createApiConfiguration(), original = copy(config);
  for (const [mode, native] of [['allow', 'off'], ['block', 'on'], ['spoof', 'custom'], ['inherit', 'bypass']]) {
    const draft = antidetectDraft(config); draft.mode = mode;
    const result = applyAntidetectDraft(config, draft);
    assert.equal(row(result, 'webrtc').mode, native); assert.equal(result.enabled, false);
    assert.equal(result.preset, config.preset); assert.deepEqual(result.sites, config.sites);
  }
  assert.deepEqual(config, original);
});

test('Antidetect draft and save own only the Custom master and preserve API Guard in every master combination', () => {
  for (const enabled of [false, true]) for (const antidetectEnabled of [false, true]) {
    const config = { ...createApiConfiguration(), enabled, antidetectEnabled }, original = copy(config), draft = antidetectDraft(config);
    assert.equal(draft.enabled, antidetectEnabled);
    draft.enabled = !antidetectEnabled;
    const saved = applyAntidetectDraft(config, draft);
    assert.equal(saved.enabled, enabled);
    assert.equal(saved.antidetectEnabled, !antidetectEnabled);
    assert.deepEqual(saved.apis, original.apis); assert.deepEqual(saved.sites, original.sites); assert.deepEqual(saved.fingerprintProfiles, original.fingerprintProfiles);
    assert.deepEqual(config, original);
  }
});

test('effective WebRTC and Math spoofing use Antidetect while protocol blocking uses API Guard', async () => {
  const restore = environment();
  try {
    for (const enabled of [false, true]) for (const antidetectEnabled of [false, true]) {
      let config = { ...createApiConfiguration(), enabled, antidetectEnabled };
      config = selected(config, 'webrtc', profile());
      config = selected(config, 'math-transcendentals', { algorithm: 'deterministic-ulp-v1', functions: ['sin'] });
      for (const id of ['websocket', 'webtransport']) config = updateApiConfiguration(config, id, { mode: 'on' }).value;
      const f = fixture(config), c = createAntidetectController(f.api), state = await c.load();
      assert.equal(state.draft.enabled, antidetectEnabled); assert.equal(state.apiEnabled, enabled);
      assert.deepEqual(state.effective, { webrtc: antidetectEnabled ? 'spoof' : 'inactive', websocket: enabled ? 'block' : 'inactive', webtransport: enabled ? 'block' : 'inactive', math: antidetectEnabled ? 'spoof' : 'inactive' });
      state.draft.mode = 'block'; const saved = await c.save(state.draft);
      assert.equal(saved.effective.webrtc, enabled ? 'block' : 'inactive');
      assert.equal(f.state().configuration.enabled, enabled); assert.equal(f.state().configuration.antidetectEnabled, antidetectEnabled);
      c.dispose();
    }
  } finally { restore(); }
});

test('leaving Spoof preserves its saved value and library without applying it in Allow/Block/Inheritance', () => {
  const config = selected(createApiConfiguration(), 'webrtc', profile({ freshCertificates: true }));
  row(config, 'webrtc').userValues.push({ id: 'retained', label: 'Owned value', value: copy(row(config, 'webrtc').selected) });
  for (const mode of ['allow', 'block', 'inherit']) {
    const draft = antidetectDraft(config); draft.mode = mode;
    const result = applyAntidetectDraft(config, draft);
    assert.deepEqual(row(result, 'webrtc').selected, row(config, 'webrtc').selected);
    assert.deepEqual(row(result, 'webrtc').userValues, row(config, 'webrtc').userValues);
    assert.notEqual(row(result, 'webrtc').mode, 'custom');
  }
});

test('a new Spoof profile is remembered once and unrelated API libraries, sites and settings remain exact', () => {
  let config = selected(createApiConfiguration(), 'hardware-concurrency', 16);
  config = selected(config, 'media-enumeration', [{ deviceId: 'saved-camera', groupId: 'saved-group', kind: 'videoinput', label: 'Saved camera' }], 'off');
  const result = updateApiConfiguration(config, 'websocket', { mode: 'off' }, 'exact.fixture.invalid'); assert.equal(result.ok, true); config = result.value;
  const before = copy(config), draft = antidetectDraft(config); draft.mode = 'spoof'; draft.profile.freshCertificates = true;
  const saved = applyAntidetectDraft(config, draft), again = applyAntidetectDraft(saved, antidetectDraft(saved));
  assert.equal(row(saved, 'webrtc').userValues.length, 1); assert.deepEqual(again, saved);
  for (const entry of saved.apis) if (entry.id !== 'webrtc') assert.deepEqual(entry, row(before, entry.id));
  assert.deepEqual(saved.sites, before.sites); assert.deepEqual(config, before);
});

test('random device mode sets actual RTC profile aliases and media allow without inventing devices', () => {
  const config = createApiConfiguration(), draft = antidetectDraft(config);
  draft.mode = 'spoof'; draft.devices.mode = 'random'; draft.devices.lifetime = 'site';
  const saved = applyAntidetectDraft(config, draft);
  assert.equal(row(saved, 'webrtc').selected.value.randomizeDevices, true);
  assert.equal(row(saved, 'webrtc').selected.value.deviceLifetime, 'site');
  assert.equal(row(saved, 'media-enumeration').mode, 'off'); assert.deepEqual(row(saved, 'media-enumeration').selected, { kind: 'unset' });
});

test('custom devices use canonical media enumeration and turn off conflicting RTC randomization', () => {
  const config = selected(createApiConfiguration(), 'webrtc', profile({ randomizeDevices: true }));
  const draft = antidetectDraft(config); draft.devices.mode = 'custom';
  draft.devices.values = [{ deviceId: 'owned-camera', groupId: 'owned-group', kind: 'videoinput', label: 'Owned camera' }];
  const saved = applyAntidetectDraft(config, draft);
  assert.equal(row(saved, 'webrtc').selected.value.randomizeDevices, false);
  assert.equal(row(saved, 'media-enumeration').mode, 'custom');
  assert.deepEqual(row(saved, 'media-enumeration').selected, { kind: 'value', value: draft.devices.values });
  assert.equal(row(saved, 'media-enumeration').userValues.length, 1);
});

test('media original, inherit and blocked choices preserve dormant device list and map independently', () => {
  const config = selected(createApiConfiguration(), 'media-enumeration', [{ deviceId: 'microphone', groupId: 'group', kind: 'audioinput', label: 'Microphone' }]);
  for (const [mode, native] of [['original', 'off'], ['inherit', 'bypass'], ['blocked', 'on']]) {
    const draft = antidetectDraft(config); draft.devices.mode = mode;
    const result = applyAntidetectDraft(config, draft);
    assert.equal(row(result, 'media-enumeration').mode, native);
    assert.deepEqual(row(result, 'media-enumeration').selected, row(config, 'media-enumeration').selected);
    assert.equal(row(result, 'webrtc').mode, 'bypass');
  }
});

test('invalid fields and nested accessor values are rejected before coercion or mutation', () => {
  const config = createApiConfiguration(), original = copy(config); let reads = 0;
  for (const mutate of [
    draft => { draft.mode = { toString() { reads++; return 'block'; } }; },
    draft => { Object.defineProperty(draft, 'mode', { get() { reads++; return 'block'; }, enumerable: true }); },
    draft => { Object.defineProperty(draft.profile, 'freshCertificates', { get() { reads++; return true; }, enumerable: true }); },
    draft => { draft.devices.mode = 'original'; draft.devices.values = [{ get deviceId() { reads++; return 'secret'; }, groupId: '', kind: 'audioinput', label: '' }]; },
    draft => { draft.devices.mode = 'random'; draft.devices.values = { toJSON() { reads++; return []; } }; },
    draft => { draft.websocket = 'spoof'; }, draft => { draft.networkPolicy = 'global-udp-block'; }, draft => { draft.enabled = 'yes'; },
    draft => { draft.extra = true; }, draft => { delete draft.profile; },
  ]) {
    const draft = antidetectDraft(config); mutate(draft);
    assert.throws(() => applyAntidetectDraft(config, draft), errorCode('invalid-value')); assert.equal(reads, 0);
    assert.deepEqual(config, original);
  }
});

test('validated device fields are compared canonically without invoking inherited toJSON hooks', () => {
  const config = createApiConfiguration(), retained = copy(config), expected = applyAntidetectDraft(config, antidetectDraft(config)); let calls = 0, getterReads = 0;
  const prototypes = [
    { toJSON() { calls++; return 'inherited code must not execute'; } },
    Object.create(null, { toJSON: { get() { getterReads++; return () => { calls++; return []; }; } } }),
  ];
  for (const prototype of prototypes) {
    const draft = antidetectDraft(config); Object.setPrototypeOf(draft.devices, prototype);
    const saved = applyAntidetectDraft(config, draft);
    assert.deepEqual(saved, expected); assert.deepEqual(config, retained);
    assert.equal(calls, 0); assert.equal(getterReads, 0);
  }
});

test('IPv4-mapped helper accepts only literal four-octet addresses and does not coerce input', () => {
  assert.equal(ipv4MappedIpv6('192.0.2.7'), '::ffff:c000:207'); assert.equal(ipv4MappedIpv6('0.0.0.0'), '::ffff:0:0');
  assert.equal(ipv4MappedIpv6('255.255.255.255'), '::ffff:ffff:ffff');
  let reads = 0;
  for (const input of ['127.1', '256.0.0.1', '0192.0.2.1', '192.0.2.1 ', '::1', { toString() { reads++; return '192.0.2.1'; } }]) assert.throws(() => ipv4MappedIpv6(input), errorCode('invalid-value'));
  assert.equal(reads, 0);
});

test('trusted Options load and save uses one canonical CAS message, preserves a false master and returns safe actual DNR status', async () => {
  const restore = environment();
  try {
    const f = fixture(), c = createAntidetectController(f.api), loaded = await c.load(); loaded.draft.mode = 'block';
    const saved = await c.save(loaded.draft), sent = f.calls[1];
    assert.equal(sent.type, 'ui-api-config-set'); assert.equal(sent.expectedRevision, 1); assert.equal(sent.tabId, null);
    assert.equal(sent.configuration.enabled, false); assert.equal(row(sent.configuration, 'webrtc').mode, 'on');
    assert.equal(saved.revision, 2); assert.equal(saved.effective.webrtc, 'inactive');
    assert.deepEqual(saved.capabilities, { udp: false, quic: false, ipv6: false, nativeProtocols: true });
    c.dispose();
  } finally { restore(); }
});

test('native enforcement is browser only for an exact owned narrow read-back rule', async () => {
  const restore = environment();
  try {
    const f = fixture(), c = createAntidetectController(f.api);
    const exact = { id: 300000, priority: 1000, action: { type: 'block' }, condition: { resourceTypes: ['websocket'] } };
    f.rules([exact]); assert.deepEqual((await c.load()).networkEnforcement, { websocket: 'browser', webtransport: 'page' });
    for (const invalid of [
      { ...exact, id: 300002 }, { ...exact, priority: 50 }, { ...exact, action: { type: 'allow' } },
      { ...exact, condition: { resourceTypes: ['websocket', 'xmlhttprequest'] } },
      { ...exact, condition: { resourceTypes: ['websocket'], initiatorDomains: ['fixture.invalid'] } },
    ]) { f.rules([invalid]); assert.equal((await c.load()).networkEnforcement.websocket, 'page'); }
    f.ruleHandler(() => Promise.reject(Error('native DNR failure'))); assert.equal((await c.load()).networkEnforcement.websocket, 'page');
    c.dispose();
  } finally { restore(); }
});

test('the immediate Antidetect master commits exactly its canonical field at the accepted revision', async () => {
  const restore = environment();
  try {
    for (const enabled of [false, true]) for (const antidetectEnabled of [false, true]) {
      const configuration = selected({ ...createApiConfiguration(), enabled, antidetectEnabled }, 'hardware-concurrency', 8);
      const f = fixture(configuration), c = createAntidetectController(f.api);
      await c.load(); const result = await c.setEnabled(!antidetectEnabled);
      assert.equal(result.draft.enabled, !antidetectEnabled);
      assert.deepEqual(f.calls[1], { schemaVersion: 1, type: 'ui-api-config-set', tabId: null, expectedRevision: 1, configuration: { ...configuration, antidetectEnabled: !antidetectEnabled } });
      assert.equal(f.calls.length, 2); assert.equal(f.permissionCalls.length, 0); c.dispose();
    }
  } finally { restore(); }
});

test('master CAS validates intent and cannot replay stale, hidden, disposed or concurrent operations', async () => {
  const restore = environment();
  try {
    const f = fixture(), c = createAntidetectController(f.api);
    await c.load();
    for (const invalid of [null, 1, 'true', {}]) await assert.rejects(c.setEnabled(invalid), errorCode('invalid-value'));
    assert.equal(f.calls.length, 1);
    let release; f.handler(() => new Promise(resolve => { release = resolve; }));
    const pending = c.setEnabled(true);
    await assert.rejects(c.setEnabled(true), errorCode('busy'));
    release({ type: 'api-config-error', code: 'stale-revision' });
    await assert.rejects(pending, errorCode('stale-revision'));
    assert.equal(f.calls.length, 2); assert.equal(f.state().configuration.antidetectEnabled, false);
    c.setVisible(false); await assert.rejects(c.setEnabled(true), errorCode('inactive'));
    c.dispose(); await assert.rejects(c.setEnabled(true), errorCode('inactive'));
    assert.equal(f.calls.length, 2);
  } finally { restore(); }
});

test('a concurrent owner during async native projection cannot confirm stale ON after its newer OFF', async () => {
  const restore = environment();
  try {
    const f = fixture(), c = createAntidetectController(f.api); await c.load();
    let release; f.ruleHandler(() => new Promise(resolve => { release = resolve; }));
    const pending = c.setEnabled(true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.state().revision, 2); assert.equal(f.state().configuration.antidetectEnabled, true);
    f.changes.emit({ 'api-configuration:v1': { newValue: { revision: 2 } } }, 'local');
    f.set({ revision: 3, configuration: { ...f.state().configuration, antidetectEnabled: false } });
    f.changes.emit({ 'api-configuration:v1': { newValue: { revision: 3 } } }, 'local');
    release([]); await assert.rejects(pending, errorCode('stale-revision'));
    assert.equal(f.state().configuration.antidetectEnabled, false);
    assert.equal(f.calls.filter(value => value.type === 'ui-api-config-set').length, 1);
    f.ruleHandler(null); assert.equal((await c.load()).draft.enabled, false); c.dispose();
  } finally { restore(); }
});

test('a master accepts its own revision notification but fences an indeterminate removal', async () => {
  const restore = environment();
  try {
    for (const ownNotification of [true, false]) {
      const f = fixture(), c = createAntidetectController(f.api); await c.load();
      let release; f.ruleHandler(() => new Promise(resolve => { release = resolve; }));
      const pending = c.setEnabled(true); await new Promise(resolve => setImmediate(resolve));
      f.changes.emit({ 'api-configuration:v1': ownNotification ? { newValue: { revision: 2 } } : {} }, 'local');
      release([]);
      if (ownNotification) assert.equal((await pending).draft.enabled, true);
      else await assert.rejects(pending, errorCode('stale-revision'));
      assert.equal(f.calls.filter(value => value.type === 'ui-api-config-set').length, 1); c.dispose();
    }
  } finally { restore(); }
});

test('a delayed exact storage echo cannot invalidate the accepted master but changed or deleted data still does', async () => {
  const restore = environment();
  try {
    const f = fixture(), notifications = [], c = createAntidetectController(f.api, { onChange: value => notifications.push(value) });
    await c.load(); await c.setEnabled(true);
    const accepted = f.state();
    f.changes.emit({ 'api-configuration:v1': { newValue: { revision: accepted.revision, configuration: accepted.configuration } } }, 'local');
    assert.equal(notifications.length, 0);
    for (const newValue of [
      { revision: accepted.revision, configuration: { ...accepted.configuration, antidetectEnabled: false } },
      { revision: accepted.revision + 1, configuration: accepted.configuration },
      undefined,
    ]) f.changes.emit({ 'api-configuration:v1': { newValue } }, 'local');
    assert.equal(notifications.length, 3); c.dispose();
  } finally { restore(); }
});

test('stale CAS and unknown backend/native errors preserve settings and expose only safe codes', async () => {
  const restore = environment();
  try {
    const f = fixture(), c = createAntidetectController(f.api), initial = await c.load();
    f.set({ revision: 9 }); initial.draft.mode = 'block';
    await assert.rejects(c.save(initial.draft), errorCode('stale-revision'));
    assert.equal(row(f.state().configuration, 'webrtc').mode, 'bypass');
    f.handler(() => ({ type: 'api-config-error', code: 'private-native-secret-url' }));
    await assert.rejects(c.load(), errorCode('operation-failed'));
    f.handler(() => { throw Error('private-native-secret-url'); });
    await assert.rejects(c.load(), errorCode('operation-failed'));
    c.dispose();
  } finally { restore(); }
});

test('only exact own top-level Options origin may load, save, request permissions or open settings', async () => {
  for (const [url, framed] of [['https://owned/options.html', false], ['chrome-extension://different/options.html', false], ['chrome-extension://owned/popup.html', false], ['chrome-extension://owned/options.html', true]]) {
    const restore = environment(url, framed);
    try {
      const f = fixture(), c = createAntidetectController(f.api);
      await assert.rejects(c.load(), errorCode('inactive')); await assert.rejects(c.save({}), errorCode('inactive'));
      await assert.rejects(c.grantPrivacy(), errorCode('inactive')); assert.throws(() => c.openEarlySettings(), errorCode('inactive'));
      assert.deepEqual(f.calls, []); assert.deepEqual(f.permissionCalls, []); c.dispose();
    } finally { restore(); }
  }
});

test('hidden, disposed and invalid target-tab views cannot dispatch privileged operations', async () => {
  const restore = environment();
  try {
    for (const kind of ['hidden', 'disposed', 'bad-tab']) {
      const f = fixture(), c = createAntidetectController(f.api, { tabId: kind === 'bad-tab' ? -1 : null });
      if (kind === 'hidden') c.setVisible(false); if (kind === 'disposed') c.dispose();
      await assert.rejects(c.load(), errorCode('inactive')); await assert.rejects(c.grantEarlyAccess(), errorCode('inactive'));
      assert.deepEqual(f.calls, []); assert.deepEqual(f.permissionCalls, []); c.dispose();
    }
  } finally { restore(); }
});

test('native permission requests retain the direct user activation and never grant silently', async () => {
  const restore = environment();
  try {
    const f = fixture(), c = createAntidetectController(f.api), pending = c.grantPrivacy();
    assert.deepEqual(f.permissionCalls, [{ permissions: ['privacy'] }], 'request executes synchronously before any await');
    await pending; assert.equal(f.calls[0].type, 'ui-api-config-get');
    f.permission(false); await assert.rejects(c.grantEarlyAccess(), errorCode('permission-denied'));
    assert.deepEqual(f.permissionCalls[1], { permissions: ['userScripts'] });
    c.dispose();
  } finally { restore(); }
});

test('concurrent save is rejected and uses the original loaded revision until the native response settles', async () => {
  const restore = environment();
  try {
    const f = fixture(), c = createAntidetectController(f.api), loaded = await c.load(); let release;
    f.handler(() => new Promise(resolve => { release = resolve; }));
    const pending = c.save(loaded.draft);
    await assert.rejects(c.save(loaded.draft), errorCode('busy')); await assert.rejects(c.load(), errorCode('busy'));
    release({ ...f.state(), revision: 2 }); await pending; assert.equal(f.calls.filter(message => message.type === 'ui-api-config-set').length, 1);
    c.dispose();
  } finally { restore(); }
});

test('permission revocation invalidates an in-flight response and dispose removes listeners', async () => {
  const restore = environment();
  try {
    const f = fixture(), invalidations = [], c = createAntidetectController(f.api, { onInvalidate: event => invalidations.push(event) }); let release;
    f.handler(() => new Promise(resolve => { release = resolve; }));
    const pending = c.load(); f.removed.emit({ permissions: ['userScripts'] }); release(f.state());
    await assert.rejects(pending, errorCode('inactive')); assert.deepEqual(invalidations, [{ reason: 'permissions' }]);
    assert.equal(f.changes.count(), 1); assert.equal(f.removed.count(), 1); c.dispose();
    assert.equal(f.changes.count(), 0); assert.equal(f.removed.count(), 0);
  } finally { restore(); }
});

test('out-of-order native rule projections cannot return an old load after a newer completed view', async () => {
  const restore = environment();
  try {
    const f = fixture(), c = createAntidetectController(f.api); let release, projected;
    const started = new Promise(resolve => { projected = resolve; }); let count = 0;
    f.ruleHandler(() => { if (++count === 1) { projected(); return new Promise(resolve => { release = resolve; }); } return []; });
    const old = c.load(); await started;
    f.set({ revision: 7 }); const recent = await c.load(); assert.equal(recent.revision, 7);
    release([]); await assert.rejects(old, errorCode('inactive'));
    c.dispose();
  } finally { restore(); }
});

test('cross-tab configuration notifications are bounded to the canonical local key and visible view', () => {
  const restore = environment();
  try {
    const f = fixture(), notifications = [], c = createAntidetectController(f.api, { onChange: value => notifications.push(value) });
    f.changes.emit({ other: {} }, 'local'); f.changes.emit({ 'api-configuration:v1': {} }, 'sync');
    f.changes.emit({ 'api-configuration:v1': {} }, 'local');
    c.setVisible(false); f.changes.emit({ 'api-configuration:v1': {} }, 'local');
    assert.deepEqual(notifications, [{ reason: 'configuration' }]); c.dispose();
  } finally { restore(); }
});

test('Allow does not require an early script registration and cleanup errors stay visible with master OFF', async () => {
  const restore = environment();
  try {
    const config = createApiConfiguration(); config.enabled = true;
    for (const id of ['webrtc', 'websocket', 'webtransport']) row(config, id).mode = 'off';
    const f = fixture(config), c = createAntidetectController(f.api); f.set({ registration: 'inactive' });
    assert.deepEqual((await c.load()).effective, { webrtc: 'allow', websocket: 'allow', webtransport: 'allow', math: 'inherited' });
    f.set({ registration: 'error', configuration: { ...config, enabled: false } });
    assert.deepEqual((await c.load()).effective, { webrtc: 'error', websocket: 'error', webtransport: 'error', math: 'error' });
    c.dispose();
  } finally { restore(); }
});

test('save stays busy through native read-back projection until the caller receives its complete result', async () => {
  const restore = environment();
  try {
    const f = fixture(), c = createAntidetectController(f.api), initial = await c.load(); let release, signal;
    const started = new Promise(resolve => { signal = resolve; });
    const projection = new Promise(resolve => { release = resolve; });
    f.ruleHandler(() => { signal(); return projection; });
    const pending = c.save(initial.draft); await started;
    const second = c.save(initial.draft), loading = c.load();
    void second.catch(() => {}); void loading.catch(() => {});
    try {
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(f.calls.filter(message => message.type === 'ui-api-config-set').length, 1, 'a pending native projection must retain the save mutex');
      release([]);
      await assert.rejects(second, errorCode('busy')); await assert.rejects(loading, errorCode('busy'));
    } finally { release([]); await pending; await Promise.allSettled([second, loading]); c.dispose(); }
  } finally { restore(); }
});
