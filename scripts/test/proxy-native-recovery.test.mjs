// ADR-070: a real optional grant can leave Chromium's cached runtime API stale.
// This independent fixture never contacts a native host or a network endpoint.
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createProxyClient } from '../../apps/production-extension/proxy-client.js';
import { installProxyService } from '../../apps/production-extension/proxy-service.js';
import { createDefaultProxyConfiguration, PROXY_PORT, PROXY_STORAGE_KEY, PROXY_NATIVE_RESTART_KEY } from '../../apps/production-extension/proxy-shared.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const fail = code => error => error?.code === code;
function event() {
  const listeners = new Set();
  return { addListener(fn) { listeners.add(fn); }, removeListener(fn) { listeners.delete(fn); }, emit(...args) { return [...listeners].map(fn => fn(...args)); } };
}
function pair(name, sender) {
  const left = { name, sender, onMessage: event(), onDisconnect: event() }, right = { name, sender, onMessage: event(), onDisconnect: event() };
  let closed = false;
  left.postMessage = value => { if (closed) throw Error('closed'); queueMicrotask(() => right.onMessage.emit(structuredClone(value))); };
  right.postMessage = value => { if (closed) throw Error('closed'); queueMicrotask(() => left.onMessage.emit(structuredClone(value))); };
  left.disconnect = right.disconnect = () => { if (!closed) { closed = true; left.onDisconnect.emit(); right.onDisconnect.emit(); } };
  return [left, right];
}
function configuration(enabled = false) {
  const result = createDefaultProxyConfiguration();
  result.profiles = [{ id: 'owned-direct', name: 'Owned direct', type: 'socks5', host: '192.0.2.15', port: 1080, native: false }];
  result.selectedId = 'owned-direct'; result.enabled = enabled;
  result.protectWebRTC = false; result.disablePrediction = false;
  return result;
}
function fixture({ firefox = false, nativeGranted = true, nativeAvailable = false, reloadAvailable = true, marker, config, setStorage = null, removeStorage = null, createTab = null, reload = null, scheduleFailure = null } = {}) {
  const data = {}, trace = [], timers = new Map(), changes = [];
  if (marker !== undefined) data[PROXY_NATIVE_RESTART_KEY] = structuredClone(marker);
  if (config !== undefined) data[PROXY_STORAGE_KEY] = structuredClone(config);
  const grants = { native: nativeGranted };
  let nextTimer = 0, setting = { mode: 'direct' }, level = 'controllable_by_this_extension';
  const api = {
    runtime: {
      id: 'owned', getURL: path => (firefox ? 'moz-extension://owned/' : 'chrome-extension://owned/') + path,
      getManifest: () => ({ permissions: ['storage', 'proxy'], optional_permissions: ['nativeMessaging'] }),
      onConnect: event(), onStartup: event(),
      connect({ name }) {
        const [client, server] = pair(name, { id: 'owned', url: this.getURL('options.html#proxy'), origin: (firefox ? 'moz-extension://owned' : 'chrome-extension://owned'), frameId: 0, tab: { id: 10, url: this.getURL('options.html#proxy') } });
        server.onMessage.addListener(message => trace.push(['command', message.op]));
        client.onMessage.addListener(message => { if (message.type !== 'change') trace.push(['reply', message.ok]); });
        api.runtime.onConnect.emit(server); return client;
      },
    },
    permissions: {
      onRemoved: event(),
      async contains({ permissions }) { return !permissions.includes('nativeMessaging') || grants.native; },
      request(input) { trace.push(['request-permission', input.permissions]); grants.native = true; return Promise.resolve(true); },
    },
    storage: { local: {
      async get(key) { trace.push(['get', key]); if (typeof key === 'string') return { [key]: structuredClone(data[key]) }; return Object.fromEntries((Array.isArray(key) ? key : Object.keys(data)).map(name => [name, structuredClone(data[name])])); },
      async set(value) { trace.push(['set', Object.keys(value)]); if (setStorage) await setStorage(value); Object.assign(data, structuredClone(value)); },
      async remove(key) { trace.push(['remove', key]); if (removeStorage) await removeStorage(key); for (const name of Array.isArray(key) ? key : [key]) delete data[name]; },
    } },
    tabs: { async create(options) { trace.push(['create-tab', structuredClone(options)]); if (createTab) return await createTab(options, data); return { id: 20 }; } },
    proxy: { onProxyError: event(), onRequest: event(), settings: {
      onChange: event(),
      async get() { return { value: structuredClone(setting), levelOfControl: level }; },
      async set({ value }) { trace.push(['set-proxy']); setting = structuredClone(value); level = 'controlled_by_this_extension'; },
      async clear() { trace.push(['clear-proxy']); setting = { mode: 'direct' }; level = 'controllable_by_this_extension'; },
    } },
  };
  if (firefox) api.runtime.getBrowserInfo = async () => ({ version: '138' });
  if (nativeAvailable) api.runtime.connectNative = () => { trace.push(['connect-native']); throw Error('native must not be opened by recovery'); };
  if (reloadAvailable) api.runtime.reload = () => { trace.push(['reload']); if (reload) return reload(); };
  const env = { location: { href: api.runtime.getURL('options.html#proxy') }, crypto: webcrypto,
    setTimeout(fn, delay) { const id = ++nextTimer; trace.push(['schedule', delay]); if (scheduleFailure) scheduleFailure(); timers.set(id, fn); return id; },
    clearTimeout(id) { trace.push(['cancel-timer', id]); timers.delete(id); },
  };
  env.top = env;
  const service = installProxyService(api, { env, privacyOverlay: { async setActive(active) { trace.push(['privacy', active]); return { status: 'inactive' }; } } });
  const client = createProxyClient(api, { env, onChange: value => changes.push(value) });
  const runTimers = () => { for (const [id, fn] of timers) { timers.delete(id); fn(); } };
  return { api, env, service, client, data, grants, trace, timers, changes, runTimers,
    cleanup() { client.dispose(); service.dispose(); },
  };
}

test('a granted optional native permission with a missing cached API is a retryable native restart condition, not another permission request', async () => {
  const f = fixture({ nativeGranted: false });
  try {
    await f.service.ready;
    const grant = f.client.requestAccess({ native: true });
    assert.deepEqual(f.trace.find(item => item[0] === 'request-permission'), ['request-permission', ['nativeMessaging']]);
    await grant; assert.equal(f.grants.native, true); assert.equal(f.api.runtime.connectNative, undefined);
    await assert.rejects(f.client.hostStatus(), error => error.code === 'reconnect-required' && error.phase === 'native' && error.retryable === true);
    assert.equal(f.service.snapshot().status.state, 'off');
    assert.equal(f.trace.some(item => ['connect-native', 'set-proxy', 'clear-proxy', 'reload', 'create-tab'].includes(item[0])), false);
    assert.equal(f.data[PROXY_NATIVE_RESTART_KEY], undefined);
  } finally { f.cleanup(); }
});
test('without native grant the same missing API remains permission-required, with no reload marker or host access', async () => {
  const f = fixture({ nativeGranted: false });
  try {
    await assert.rejects(f.client.hostStatus(), fail('permission-required'));
    await assert.rejects(f.client.restartNative(), fail('permission-required'));
    assert.equal(f.data[PROXY_NATIVE_RESTART_KEY], undefined); assert.equal(f.timers.size, 0);
    assert.equal(f.trace.some(item => ['reload', 'connect-native', 'set-proxy', 'clear-proxy'].includes(item[0])), false);
  } finally { f.cleanup(); }
});
test('explicit eligible recovery stores only its bounded nonsecret marker and replies before the delayed reload', async () => {
  const f = fixture({ config: configuration(false) });
  try {
    await f.service.ready; const before = structuredClone(f.data[PROXY_STORAGE_KEY]);
    const result = await f.client.restartNative();
    assert.equal(result.status.state, 'off'); assert.deepEqual(result.configuration, before);
    assert.deepEqual(Object.keys(f.data[PROXY_NATIVE_RESTART_KEY]).sort(), ['at', 'version']);
    assert.equal(f.data[PROXY_NATIVE_RESTART_KEY].version, 1); assert.ok(Number.isFinite(f.data[PROXY_NATIVE_RESTART_KEY].at));
    assert.ok(Math.abs(Date.now() - f.data[PROXY_NATIVE_RESTART_KEY].at) < 2000);
    assert.equal(f.trace.some(item => item[0] === 'reload'), false); assert.equal(f.timers.size, 1);
    assert.equal(f.trace.find(item => item[0] === 'schedule')[1], 50);
    assert.equal(f.trace.some(item => ['connect-native', 'set-proxy', 'clear-proxy'].includes(item[0])), false);
    f.runTimers(); assert.equal(f.trace.filter(item => item[0] === 'reload').length, 1);
    assert.ok(f.trace.findIndex(item => item[0] === 'reply') < f.trace.findIndex(item => item[0] === 'reload'));
    assert.deepEqual(f.data[PROXY_STORAGE_KEY], before);
  } finally { f.cleanup(); }
});
test('a scheduled restart is single-flight across Options clients until reload or disposal', async () => {
  const f = fixture(), other = createProxyClient(f.api, { env: f.env });
  try {
    await f.client.restartNative();
    await assert.rejects(other.restartNative(), fail('busy'));
    await assert.rejects(other.saveProfile({ name: 'Not written', type: 'socks5', host: '192.0.2.5', port: 1080 }), fail('busy'));
    assert.equal(f.timers.size, 1); assert.equal(f.trace.filter(item => item[0] === 'set').length, 1);
    assert.equal(f.service.snapshot().configuration.profiles.length, 0);
  } finally { other.dispose(); f.cleanup(); }
});

test('the physical marker storage write excludes a second client before the write has settled', async () => {
  let settle, entered;
  const writing = new Promise(resolve => { entered = resolve; });
  const pendingWrite = new Promise(resolve => { settle = resolve; });
  const f = fixture({ setStorage() { entered(); return pendingWrite; } }), other = createProxyClient(f.api, { env: f.env });
  try {
    const pending = f.client.restartNative(); await writing;
    await assert.rejects(other.restartNative(), fail('busy'));
    await assert.rejects(other.saveProfile({ name: 'Not written', type: 'socks5', host: '192.0.2.5', port: 1080 }), fail('busy'));
    assert.equal(f.timers.size, 0); assert.equal(f.data[PROXY_NATIVE_RESTART_KEY], undefined);
    settle(); await pending;
    assert.equal(f.timers.size, 1); assert.equal(f.trace.filter(item => item[0] === 'set').length, 1);
  } finally { settle(); other.dispose(); f.cleanup(); }
});
test('enabled direct Proxy rejects restart without releasing its currently applied route', async () => {
  const f = fixture({ config: configuration(true) });
  try {
    await f.service.ready; const before = f.service.snapshot(), trace = f.trace.length;
    await assert.rejects(f.client.restartNative(), fail('busy'));
    assert.deepEqual(f.service.snapshot(), before); assert.equal(f.data[PROXY_NATIVE_RESTART_KEY], undefined);
    assert.equal(f.trace.slice(trace).some(item => ['set', 'set-proxy', 'clear-proxy', 'privacy', 'reload', 'schedule'].includes(item[0])), false);
  } finally { f.cleanup(); }
});
test('Firefox and an unavailable reload method cannot schedule Chrome-only recovery', async () => {
  for (const options of [{ firefox: true }, { reloadAvailable: false }]) {
    const f = fixture(options);
    try {
      await assert.rejects(f.client.restartNative());
      assert.equal(f.data[PROXY_NATIVE_RESTART_KEY], undefined); assert.equal(f.timers.size, 0);
      assert.equal(f.trace.some(item => ['connect-native', 'reload', 'set-proxy', 'clear-proxy'].includes(item[0])), false);
    } finally { f.cleanup(); }
  }
});

test('an already available native API makes restart an inert no-op without opening a host', async () => {
  const f = fixture({ nativeAvailable: true });
  try {
    const result = await f.client.restartNative();
    assert.equal(result.status.state, 'off');
    assert.equal(f.data[PROXY_NATIVE_RESTART_KEY], undefined); assert.equal(f.timers.size, 0);
    assert.equal(f.trace.some(item => ['connect-native', 'reload', 'set', 'set-proxy', 'clear-proxy'].includes(item[0])), false);
  } finally { f.cleanup(); }
});
test('native Save fails before any vault or metadata write when the already granted native binding still needs restart', async () => {
  const f = fixture();
  try {
    await assert.rejects(f.client.saveProfile({ name: 'Owned private input', type: 'socks5', host: '192.0.2.5', port: 1080, username: 'RECOVERY_USER_CANARY', password: 'RECOVERY_SECRET_CANARY' }), error => error.code === 'reconnect-required' && error.phase === 'native');
    assert.equal(f.service.snapshot().configuration.profiles.length, 0); assert.equal(f.data[PROXY_STORAGE_KEY], undefined); assert.equal(f.data[PROXY_NATIVE_RESTART_KEY], undefined);
    assert.doesNotMatch(JSON.stringify(f.changes), /RECOVERY_(USER|SECRET)_CANARY/);
    assert.equal(f.trace.some(item => ['connect-native', 'set', 'reload', 'set-proxy', 'clear-proxy'].includes(item[0])), false);
  } finally { f.cleanup(); }
});
test('the new restart operation retains exact own top-level MessageSender authorization', async () => {
  const f = fixture();
  try {
    await f.service.ready;
    for (const sender of [
      { id: 'foreign', url: f.api.runtime.getURL('options.html'), frameId: 0 },
      { id: 'owned', url: 'https://example.test/', frameId: 0, tab: { id: 1, url: 'https://example.test/' } },
      { id: 'owned', url: f.api.runtime.getURL('options.html'), frameId: 1, tab: { id: 1, url: f.api.runtime.getURL('options.html') } },
    ]) {
      const [client, server] = pair(PROXY_PORT, sender); let disconnected = false;
      client.onDisconnect.addListener(() => { disconnected = true; }); f.api.runtime.onConnect.emit(server);
      assert.equal(disconnected, true); assert.throws(() => client.postMessage({ v: 1, id: 'forged', op: 'restartNative' }));
    }
    assert.equal(f.data[PROXY_NATIVE_RESTART_KEY], undefined); assert.equal(f.timers.size, 0);
  } finally { f.cleanup(); }
});

test('an authorized restart request cannot supply a return destination or any payload fields', async () => {
  const f = fixture();
  try {
    await f.service.ready;
    const port = f.api.runtime.connect({ name: PROXY_PORT });
    const response = new Promise(resolve => port.onMessage.addListener(message => { if (message.id === 'invalid-return') resolve(message); }));
    port.postMessage({ v: 1, id: 'invalid-return', op: 'restartNative', payload: { url: 'https://foreign.test/', password: 'REJECTED_RESTART_PAYLOAD' } });
    const reply = await response;
    assert.equal(reply.ok, false); assert.equal(reply.error.code, 'invalid-input');
    assert.equal(f.data[PROXY_NATIVE_RESTART_KEY], undefined); assert.equal(f.timers.size, 0);
    assert.doesNotMatch(JSON.stringify(reply), /foreign\.test|REJECTED_RESTART_PAYLOAD/);
    port.disconnect();
  } finally { f.cleanup(); }
});

test('quarantined corrupt Proxy settings cannot be released through native recovery', async () => {
  const f = fixture({ config: { invalid: true } });
  try {
    await f.service.ready; const before = f.trace.length;
    await assert.rejects(f.client.restartNative(), fail('busy'));
    assert.equal(f.trace.slice(before).some(item => ['set', 'set-proxy', 'clear-proxy', 'schedule', 'reload', 'create-tab'].includes(item[0])), false);
    assert.equal(f.data[PROXY_NATIVE_RESTART_KEY], undefined);
  } finally { f.cleanup(); }
});
test('fresh recovery marker is consumed before reopening only the fixed own Options proxy route', async () => {
  const marker = { version: 1, at: Date.now() - 1000 };
  const f = fixture({ marker, nativeAvailable: true, createTab(options, data) { assert.equal(data[PROXY_NATIVE_RESTART_KEY], undefined); assert.equal(options.url, 'chrome-extension://owned/options.html#proxy'); return { id: 20 }; } });
  try {
    await f.service.ready;
    assert.equal(f.data[PROXY_NATIVE_RESTART_KEY], undefined);
    assert.equal(f.trace.filter(item => item[0] === 'create-tab').length, 1);
    assert.ok(f.trace.findIndex(item => item[0] === 'remove') < f.trace.findIndex(item => item[0] === 'create-tab'));
    assert.equal(f.trace.some(item => ['reload', 'connect-native', 'set-proxy', 'clear-proxy'].includes(item[0])), false);
    f.api.runtime.onStartup.emit(); await tick(); assert.equal(f.trace.filter(item => item[0] === 'create-tab').length, 1);
  } finally { f.cleanup(); }
});

test('a valid boot marker cannot bypass the grant, fresh native binding, browser or active-route guards', async () => {
  for (const options of [{ nativeGranted: false, nativeAvailable: true }, { nativeAvailable: false }, { firefox: true, nativeAvailable: true }, { config: configuration(true), nativeAvailable: true }]) {
    const f = fixture({ marker: { version: 1, at: Date.now() }, ...options });
    try {
      await f.service.ready; assert.equal(f.data[PROXY_NATIVE_RESTART_KEY], undefined);
      assert.equal(f.trace.some(item => ['create-tab', 'reload', 'connect-native'].includes(item[0])), false);
      if (options.config?.enabled) assert.equal(f.service.snapshot().configuration.enabled, true);
    } finally { f.cleanup(); }
  }
});
test('expired, future, nonfinite, malformed and extra-field restart markers never open a tab or survive consumption', async () => {
  for (const marker of [
    { version: 1, at: Date.now() - 61000 }, { version: 1, at: Date.now() + 60000 },
    { version: 1, at: NaN }, { version: 1, at: Infinity }, { version: 1, at: 'now' },
    { version: 2, at: Date.now() }, { version: 1 }, null, [],
    { version: 1, at: Date.now(), url: 'https://foreign.test/' },
    { version: 1, at: Date.now(), password: 'NEVER_REOPEN_SECRET_CANARY' },
  ]) {
    const f = fixture({ marker, nativeAvailable: true });
    try {
      await f.service.ready; assert.equal(f.data[PROXY_NATIVE_RESTART_KEY], undefined);
      assert.equal(f.trace.some(item => ['create-tab', 'reload', 'connect-native'].includes(item[0])), false);
      assert.doesNotMatch(JSON.stringify(f.changes), /foreign\.test|NEVER_REOPEN_SECRET_CANARY/);
    } finally { f.cleanup(); }
  }
});
test('marker persistence failure cannot reload, mutate routing or claim success', async () => {
  const f = fixture({ setStorage() { throw Error('owned injected storage failure'); } });
  try {
    await assert.rejects(f.client.restartNative(), fail('operation-failed'));
    assert.equal(f.timers.size, 0); assert.equal(f.data[PROXY_NATIVE_RESTART_KEY], undefined);
    assert.equal(f.trace.some(item => ['reload', 'connect-native', 'set-proxy', 'clear-proxy'].includes(item[0])), false);
  } finally { f.cleanup(); }
});
test('failed marker removal prevents opening and a failed open never leaves a replayable marker', async () => {
  const f = fixture({ nativeAvailable: true, marker: { version: 1, at: Date.now() }, removeStorage() { throw Error('owned remove failure'); } });
  try { await f.service.ready; assert.equal(f.trace.some(item => item[0] === 'create-tab'), false); } finally { f.cleanup(); }
  const g = fixture({ nativeAvailable: true, marker: { version: 1, at: Date.now() }, createTab() { throw Error('owned open failure'); } });
  try { await g.service.ready; assert.equal(g.data[PROXY_NATIVE_RESTART_KEY], undefined); g.api.runtime.onStartup.emit(); await tick(); assert.equal(g.trace.filter(item => item[0] === 'create-tab').length, 1); } finally { g.cleanup(); }
});
test('disposing a scheduled recovery cancels its timer and removes only its own restart marker', async () => {
  const f = fixture({ config: configuration(false) });
  await f.client.restartNative(); const config = structuredClone(f.data[PROXY_STORAGE_KEY]);
  f.cleanup(); await tick(); f.runTimers();
  assert.equal(f.timers.size, 0); assert.equal(f.data[PROXY_NATIVE_RESTART_KEY], undefined); assert.deepEqual(f.data[PROXY_STORAGE_KEY], config);
  assert.equal(f.trace.some(item => item[0] === 'reload'), false);
});

test('a reload exception or unavailable scheduler releases pending recovery and removes its return marker', async () => {
  for (const kind of ['reload', 'schedule']) {
    let shouldFail = true;
    const inject = () => { if (shouldFail) throw Error('owned injected restart failure'); };
    const f = fixture(kind === 'reload' ? { reload: inject } : { scheduleFailure: inject });
    try {
      await f.client.restartNative(); if (kind === 'reload') f.runTimers(); await tick();
      assert.equal(f.data[PROXY_NATIVE_RESTART_KEY], undefined);
      assert.equal(f.service.snapshot().configuration.enabled, false);
      assert.equal(f.service.snapshot().status.state, 'error');
      assert.equal(f.service.snapshot().status.code, 'operation-failed');
      assert.equal(f.trace.some(item => ['set-proxy', 'clear-proxy', 'connect-native'].includes(item[0])), false);
      shouldFail = false; await f.client.restartNative(); assert.equal(f.timers.size, 1);
    } finally { f.cleanup(); }
  }
});

test('disposing while marker storage is pending cannot leave a return marker for an unperformed reload', async () => {
  let settle, entered;
  const writing = new Promise(resolve => { entered = resolve; });
  const pendingWrite = new Promise(resolve => { settle = resolve; });
  const f = fixture({ setStorage() { entered(); return pendingWrite; } });
  const response = assert.rejects(f.client.restartNative(), fail('inactive'));
  await writing; f.cleanup(); settle(); await response; await tick(); await tick();
  assert.equal(f.data[PROXY_NATIVE_RESTART_KEY], undefined);
  assert.equal(f.timers.size, 0); assert.equal(f.trace.some(item => item[0] === 'reload'), false);
});
