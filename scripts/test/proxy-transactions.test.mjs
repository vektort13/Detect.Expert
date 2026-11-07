// PP-02/04/05: native-vault transactions survive storage failures and restarts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { installProxyService } from '../../apps/production-extension/proxy-service.js';
import { createProxyClient } from '../../apps/production-extension/proxy-client.js';
import { createDefaultProxyConfiguration, PROXY_STORAGE_KEY } from '../../apps/production-extension/proxy-shared.js';

const STATE = 'proxy-vault-state:v1', tick = () => new Promise(done => setImmediate(done));
const fails = code => error => error?.code === code;
function event() {
  const listeners = new Set();
  return { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn), emit: (...args) => [...listeners].map(fn => fn(...args)) };
}
function pair(name, sender) {
  const a = { name, sender, onMessage: event(), onDisconnect: event() }, b = { name, sender, onMessage: event(), onDisconnect: event() };
  let closed = false;
  a.postMessage = value => { if (closed) throw Error('closed'); const copy = structuredClone(value); queueMicrotask(() => { if (!closed) b.onMessage.emit(copy); }); };
  b.postMessage = value => { if (closed) throw Error('closed'); const copy = structuredClone(value); queueMicrotask(() => { if (!closed) a.onMessage.emit(copy); }); };
  a.disconnect = b.disconnect = () => { if (!closed) { closed = true; a.onDisconnect.emit(); b.onDisconnect.emit(); } };
  return [a, b];
}
function metadata({ native = true, enabled = false } = {}) {
  const config = createDefaultProxyConfiguration();
  Object.assign(config, { selectedId: 'owned', enabled, protectWebRTC: false, disablePrediction: false });
  config.profiles = [{ id: 'owned', name: 'Owned', type: 'socks5', host: '192.0.2.10', port: 1080, native }];
  return config;
}
const oldSecret = () => ({ type: 'socks5', host: '192.0.2.10', port: 1080, username: 'OLD_USER_CANARY', password: 'OLD_PASSWORD_CANARY' });
const replacement = () => ({ id: 'owned', name: 'Changed', type: 'socks5', host: '192.0.2.20', port: 2080, username: 'NEW_USER_CANARY', password: 'NEW_PASSWORD_CANARY' });
function fixture({ firefox = false, config = metadata(), data = null, vault = new Map([['owned', oldSecret()]]), get = null, set = null, native = null, nativeTimeout = 60000 } = {}) {
  data ??= { [PROXY_STORAGE_KEY]: structuredClone(config) };
  const trace = [], changes = [], timers = new Map();
  let active = null, nextTimer = 0, setting = { mode: 'direct' }, level = 'controllable_by_this_extension';
  const api = {
    runtime: { id: 'owned-extension', getURL: path => (firefox ? 'moz-extension://owned-extension/' : 'chrome-extension://owned-extension/') + path,
      onConnect: event(), onStartup: event(),
      connect({ name }) {
        const [client, server] = pair(name, { id: this.id, url: this.getURL('options.html'), origin: this.getURL('').slice(0, -1), frameId: 0 });
        api.runtime.onConnect.emit(server); return client;
      },
      connectNative() {
        trace.push(['open-native']); const [client, server] = pair('native');
        server.onMessage.addListener(message => {
          trace.push(['native', message.op, message.profileId]);
          const respond = result => server.postMessage({ v: 1, id: message.id, ok: true, result });
          const reject = code => server.postMessage({ v: 1, id: message.id, ok: false, error: { code } });
          if (native?.(message, { respond, reject, vault, trace, disconnect: () => server.disconnect() }) === true) return;
          if (message.op === 'hello') return respond({ version: 1, capabilities: { socks5: true, vless: true, openvpn: true, vault: true } });
          if (message.op === 'save') { vault.set(message.profileId, structuredClone(message.profile)); return respond({ profileId: message.profileId, summary: { type: message.profile.type, host: message.profile.host, port: message.profile.port } }); }
          if (message.op === 'delete') { vault.delete(message.profileId); return respond({ deleted: true }); }
          if (message.op === 'connect') { if (!vault.has(message.profileId)) return reject('profile-not-found'); active = message.profileId; return respond({ profileId: active, host: '127.0.0.1', port: 32123 }); }
          if (message.op === 'disconnect') { active = null; return respond({ disconnected: true }); }
          if (message.op === 'status') return respond({ state: active ? 'connected' : 'off', profileId: active, diagnostic: null });
          if (message.op === 'check' || message.op === 'diagnose') return respond({ reachable: true, remoteDns: true, tlsVerified: true, httpStatus: 200, ip: '198.51.100.10', elapsedMs: 1 });
          if (message.op === 'export') return respond({ profiles: message.profileIds.map(profileId => ({ profileId, profile: structuredClone(vault.get(profileId)) })) });
          reject('invalid-input');
        });
        return client;
      },
    },
    permissions: { contains: async () => true, onRemoved: event() },
    storage: { local: {
      async get(key) { trace.push(['get', key]); if (get) await get(key, data); return { [key]: structuredClone(data[key]) }; },
      async set(value) { trace.push(['set', Object.keys(value)]); if (set) await set(value, data); Object.assign(data, structuredClone(value)); },
      async remove(key) { delete data[key]; },
    } },
    proxy: { onRequest: event(), onProxyError: event(), settings: { onChange: event(),
      async get() { return { value: structuredClone(setting), levelOfControl: level }; },
      async set({ value }) { setting = structuredClone(value); level = 'controlled_by_this_extension'; trace.push(['set-policy']); },
      async clear() { setting = { mode: 'direct' }; level = 'controllable_by_this_extension'; trace.push(['clear-policy']); },
    } },
  };
  if (firefox) api.runtime.getBrowserInfo = async () => ({ version: '138' });
  const env = { crypto: webcrypto, location: { href: api.runtime.getURL('options.html') },
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, fn); trace.push(['timer', delay]); return id; },
    clearTimeout(id) { timers.delete(id); },
  }; env.top = env;
  const service = installProxyService(api, { env, nativeTimeout, privacyOverlay: { setActive: async () => ({ status: 'inactive' }) } });
  const client = createProxyClient(api, { env, onChange: value => changes.push(value) });
  return { api, env, service, client, data, vault, trace, changes, timers, get setting() { return setting; },
    route: url => api.proxy.onRequest.emit({ url })[0],
    async runTimer() { const row = [...timers][0]; if (!row) return false; timers.delete(row[0]); row[1](); await tick(); await tick(); return true; },
    cleanup() { client.dispose(); service.dispose(); },
  };
}

test('Firefox unreadable configuration never infers OFF or honors bypass routes; a later read recovers the saved active route', async () => {
  let unavailable = true; const config = metadata({ native: false, enabled: true });
  config.routing.directDomains = ['direct.example']; config.routing.bypassLocal = true;
  const f = fixture({ firefox: true, config, get(key) { if (key === PROXY_STORAGE_KEY && unavailable) throw Error('unavailable'); } });
  try {
    await f.service.ready;
    for (const url of ['https://target.example/', 'https://direct.example/', 'http://127.0.0.1/']) assert.deepEqual(await f.route(url), [{ type: 'socks', host: '127.0.0.1', port: 9, proxyDNS: true, failoverTimeout: 1 }, null]);
    assert.equal(f.data[PROXY_STORAGE_KEY].enabled, true);
    await assert.rejects(f.client.saveProfile(replacement()), fails('operation-failed'));
    assert.equal(f.trace.some(row => row[0] === 'set'), false);
    unavailable = false; assert.equal(await f.runTimer(), true);
    assert.equal(f.service.snapshot().status.state, 'connected');
    assert.equal((await f.route('https://target.example/'))[0].host, '192.0.2.10');
    assert.deepEqual(await f.route('https://direct.example/'), { type: 'direct' });
    assert.equal(f.trace.some(row => row[0] === 'open-native'), false);
  } finally { f.cleanup(); }
});

test('a failed private vault-journal read is quarantined like a failed configuration read', async () => {
  const f = fixture({ firefox: true, get(key) { if (key === STATE) throw Error('unavailable'); } });
  try { await f.service.ready; assert.equal((await f.route('https://target.example/'))[0].port, 9); assert.equal(f.trace.some(row => row[0] === 'open-native'), false); } finally { f.cleanup(); }
});

test('an unsupported stored configuration version cannot bypass Firefox quarantine', async () => {
  const config = metadata(); config.version = 2; const f = fixture({ firefox: true, config });
  try { await f.service.ready; assert.equal((await f.route('https://owned.example/'))[0].port, 9); assert.equal(f.trace.some(row => row[0] === 'set'), false); } finally { f.cleanup(); }
});

test('Chrome recovers a readable OFF state by clearing only the quarantine PAC that it owns', async () => {
  let unavailable = true; const f = fixture({ data: {}, get() { if (unavailable) throw Error('unavailable'); } });
  try {
    await f.service.ready; assert.equal(f.setting.mode, 'pac_script'); assert.match(f.setting.pacScript.data, /127\.0\.0\.1:9/);
    unavailable = false; await f.runTimer();
    assert.equal(f.service.snapshot().status.state, 'off'); assert.equal(f.setting.mode, 'direct');
    assert.equal(f.trace.filter(row => row[0] === 'clear-policy').length, 1); assert.equal(f.timers.size, 0);
  } finally { f.cleanup(); }
});

test('readable active metadata with repeated persistence failure still has only three automatic recovery attempts', async () => {
  const f = fixture({ config: metadata({ native: false, enabled: true }), set() { throw Error('unavailable'); } });
  try {
    await f.service.ready; for (let n = 0; n < 3; n++) assert.equal(await f.runTimer(), true);
    assert.equal(f.timers.size, 0); assert.equal(f.trace.filter(row => row[0] === 'timer').length, 3);
    assert.equal(f.service.snapshot().status.state, 'blocked');
  } finally { f.cleanup(); }
});

test('initial OFF remains OFF and unreadable startup retries are bounded, with explicit Off preserved across recovery', async () => {
  const off = fixture({ firefox: true, data: {} });
  try { await off.service.ready; assert.equal(off.service.snapshot().status.state, 'off'); assert.equal(await off.route('https://target.example/'), undefined); assert.equal(off.timers.size, 0); } finally { off.cleanup(); }
  let unavailable = true; const f = fixture({ firefox: true, config: metadata({ native: false, enabled: true }), get() { if (unavailable) throw Error('unavailable'); } });
  try {
    await f.service.ready;
    for (let n = 0; n < 3; n++) assert.equal(await f.runTimer(), true);
    assert.equal(f.timers.size, 0); assert.equal(f.trace.filter(row => row[0] === 'timer').length, 3);
    await f.client.disconnect(); assert.equal(await f.route('https://target.example/'), undefined);
    unavailable = false; const recovered = await f.client.load();
    assert.equal(recovered.configuration.enabled, false); assert.equal(recovered.status.state, 'off'); assert.equal(f.data[PROXY_STORAGE_KEY].enabled, false);
  } finally { f.cleanup(); }
});

test('failed metadata commit never overwrites the old native record and a load removes its staged orphan', async () => {
  let failCommit = true; const f = fixture({ set(value) { if (failCommit && Object.hasOwn(value, PROXY_STORAGE_KEY)) throw Error('metadata unavailable'); } });
  try {
    await assert.rejects(f.client.saveProfile(replacement()), fails('operation-failed'));
    assert.deepEqual(f.vault.get('owned'), oldSecret()); assert.equal(f.vault.size, 2);
    assert.equal(f.data[PROXY_STORAGE_KEY].profiles[0].host, '192.0.2.10');
    assert.equal(f.data[STATE].cleanup.length, 1); assert.notEqual(f.data[STATE].cleanup[0], 'owned');
    await assert.rejects(f.client.connect('owned'), fails('operation-failed'));
    failCommit = false; await f.client.load();
    assert.equal(f.vault.size, 1); assert.deepEqual(f.data[STATE].cleanup, []);
    await f.client.connect('owned'); assert.equal(f.trace.findLast(row => row[0] === 'native' && row[1] === 'connect')[2], 'owned');
    assert.doesNotMatch(JSON.stringify([f.data, f.changes, f.service.snapshot()]), /USER_CANARY|PASSWORD_CANARY/);
  } finally { f.cleanup(); }
});

for (const afterSave of [false, true]) test('failed native save keeps its staged ID recoverable, including an unknown committed outcome: ' + afterSave, async () => {
  const f = fixture({ native(message, { reject, vault }) {
    if (message.op !== 'save') return false;
    if (afterSave) vault.set(message.profileId, structuredClone(message.profile));
    reject('vault-unavailable'); return true;
  } });
  try {
    await assert.rejects(f.client.saveProfile(replacement()), fails('vault-unavailable'));
    assert.deepEqual(f.vault.get('owned'), oldSecret()); assert.equal(f.data[STATE].cleanup.length, 1);
    await f.client.load(); assert.deepEqual(f.data[STATE].cleanup, []); assert.equal(f.vault.size, 1);
  } finally { f.cleanup(); }
});

test('native port loss after saving but before ACK cannot replace the committed profile or lose its staged cleanup', async () => {
  let lost = false; const f = fixture({ native(message, { vault, disconnect }) {
    if (message.op !== 'save' || lost) return false;
    vault.set(message.profileId, structuredClone(message.profile)); lost = true; disconnect(); return true;
  } });
  try {
    await assert.rejects(f.client.saveProfile(replacement()), fails('native-disconnected'));
    assert.deepEqual(f.vault.get('owned'), oldSecret()); assert.equal(f.data[PROXY_STORAGE_KEY].profiles[0].host, '192.0.2.10');
    assert.equal(f.data[STATE].cleanup.length, 1); assert.equal(f.vault.size, 2);
    await f.client.load(); assert.deepEqual(f.data[STATE].cleanup, []); assert.equal(f.vault.size, 1); assert.deepEqual(f.vault.get('owned'), oldSecret());
  } finally { f.cleanup(); }
});

test('a physically timed-out native Save keeps the old committed record and retries cleanup through a fresh broker', async () => {
  const f = fixture({ nativeTimeout: 20, native(message, { vault }) {
    if (message.op !== 'save') return false;
    vault.set(message.profileId, structuredClone(message.profile)); return true; // Deliberately no ACK.
  } });
  try {
    await assert.rejects(f.client.saveProfile(replacement()), fails('native-disconnected'));
    assert.deepEqual(f.vault.get('owned'), oldSecret()); assert.equal(f.vault.size, 2); assert.equal(f.data[STATE].cleanup.length, 1);
    await f.client.load(); assert.deepEqual(f.data[STATE].cleanup, []); assert.equal(f.vault.size, 1);
    assert.equal(f.trace.filter(row => row[0] === 'open-native').length, 2);
  } finally { f.cleanup(); }
});

test('successful replacement preserves the public ID and uses the exact staged ID for connect, check and full export', async () => {
  const f = fixture();
  try {
    const saved = await f.client.saveProfile(replacement()), vaultId = f.data[STATE].nativeIds.owned;
    assert.equal(saved.configuration.profiles[0].id, 'owned'); assert.notEqual(vaultId, 'owned');
    assert.equal(f.vault.has('owned'), false); assert.equal(f.vault.get(vaultId).host, '192.0.2.20'); assert.deepEqual(f.data[STATE].cleanup, []);
    await f.client.connect('owned'); assert.equal(f.trace.findLast(row => row[0] === 'native' && row[1] === 'connect')[2], vaultId);
    assert.equal((await f.client.checkProfile({ id: 'owned', url: 'https://owned.example/' })).profileId, 'owned');
    assert.equal(f.trace.findLast(row => row[0] === 'native' && row[1] === 'check')[2], vaultId);
    const bundle = await f.client.exportProfiles('owned');
    assert.equal(bundle.profiles[0].id, 'owned'); assert.equal(bundle.profiles[0].connection.password, 'NEW_PASSWORD_CANARY');
    assert.equal(JSON.stringify([bundle, saved, f.changes]).includes(vaultId), false);
  } finally { f.cleanup(); }
});

test('native-to-plain conversion and subsequent Delete leave no native credentials', async () => {
  const f = fixture();
  try {
    const result = await f.client.saveProfile({ id: 'owned', name: 'Plain', type: 'socks5', host: '192.0.2.20', port: 2080, username: '', password: '' });
    assert.equal(result.configuration.profiles[0].native, false); assert.equal(f.vault.size, 0); assert.deepEqual(f.data[STATE].nativeIds, {}); assert.deepEqual(f.data[STATE].cleanup, []);
    const before = f.trace.filter(row => row[0] === 'native').length;
    await f.client.deleteProfile('owned'); assert.equal(f.service.snapshot().configuration.profiles.length, 0); assert.equal(f.vault.size, 0);
    assert.equal(f.trace.filter(row => row[0] === 'native').length, before);
  } finally { f.cleanup(); }
});

test('failed Delete metadata write never deletes the committed native profile', async () => {
  const f = fixture({ set(value) { if (Object.hasOwn(value, PROXY_STORAGE_KEY)) throw Error('unavailable'); } });
  try { await assert.rejects(f.client.deleteProfile('owned'), fails('operation-failed')); assert.equal(f.vault.has('owned'), true); assert.equal(f.trace.some(row => row[0] === 'native' && row[1] === 'delete'), false); assert.equal(f.data[PROXY_STORAGE_KEY].profiles.length, 1); } finally { f.cleanup(); }
});

test('a failed post-commit native cleanup reports failure and survives a service restart for an idempotent retry', async () => {
  const vault = new Map([['owned', oldSecret()]]); let failDelete = true;
  const f = fixture({ vault, native(message, { reject }) { if (failDelete && message.op === 'delete') { reject('vault-unavailable'); return true; } return false; } });
  let second;
  try {
    await assert.rejects(f.client.deleteProfile('owned'), fails('vault-unavailable'));
    assert.equal(f.data[PROXY_STORAGE_KEY].profiles.length, 0); assert.deepEqual(f.data[STATE].cleanup, ['owned']); assert.equal(vault.has('owned'), true);
    assert.equal(f.changes.at(-1).configuration.profiles.length, 0);
    const data = structuredClone(f.data); f.cleanup(); failDelete = false;
    second = fixture({ data, vault }); await second.client.load();
    assert.equal(second.vault.size, 0); assert.deepEqual(second.data[STATE].cleanup, []); assert.equal(second.service.snapshot().status.state, 'off');
  } finally { f.cleanup(); second?.cleanup(); }
});

test('a delete reply followed by failed journal persistence is safe to repeat after restart', async () => {
  let failCleanupWrite = true; const f = fixture({ set(value) { if (failCleanupWrite && !Object.hasOwn(value, PROXY_STORAGE_KEY) && value[STATE]?.cleanup.length === 0) throw Error('unavailable'); } }); let second;
  try {
    await assert.rejects(f.client.deleteProfile('owned'), fails('operation-failed'));
    assert.equal(f.vault.size, 0); assert.deepEqual(f.data[STATE].cleanup, ['owned']);
    const data = structuredClone(f.data); f.cleanup(); failCleanupWrite = false;
    second = fixture({ data, vault: f.vault }); await second.client.load(); assert.equal(second.vault.size, 0); assert.deepEqual(second.data[STATE].cleanup, []);
  } finally { f.cleanup(); second?.cleanup(); }
});

test('unknown storage commit outcomes reload the durable mapping before any cleanup can delete a newly committed record', async () => {
  let failAfterCommit = true; const f = fixture({ set(value, data) { if (failAfterCommit && Object.hasOwn(value, PROXY_STORAGE_KEY)) { Object.assign(data, structuredClone(value)); throw Error('reply lost after commit'); } } });
  try {
    await assert.rejects(f.client.saveProfile(replacement()), fails('operation-failed'));
    const committedId = f.data[STATE].nativeIds.owned; assert.ok(committedId); assert.equal(f.vault.has(committedId), true);
    await assert.rejects(f.client.deleteProfile('owned'), fails('operation-failed'));
    failAfterCommit = false; await f.client.load();
    assert.equal(f.service.snapshot().configuration.profiles[0].host, '192.0.2.20'); assert.equal(f.vault.has(committedId), true); assert.equal(f.vault.has('owned'), false);
    assert.deepEqual(f.data[STATE].cleanup, []); await f.client.connect('owned');
    assert.equal(f.trace.findLast(row => row[0] === 'native' && row[1] === 'connect')[2], committedId);
  } finally { f.cleanup(); }
});

test('a failed prepared-journal write cannot send credentials to the native host', async () => {
  const f = fixture({ set(value) { if (value[STATE]?.cleanup.length) throw Error('unavailable'); } });
  try { await assert.rejects(f.client.saveProfile(replacement()), fails('operation-failed')); assert.equal(f.trace.some(row => row[0] === 'native' && row[1] === 'save'), false); assert.deepEqual(f.vault.get('owned'), oldSecret()); } finally { f.cleanup(); }
});

test('a corrupt journal cannot nominate a committed live ID for cleanup', async () => {
  const config = metadata({ enabled: true }), data = { [PROXY_STORAGE_KEY]: config, [STATE]: { version: 1, configuration: structuredClone(config), nativeIds: {}, cleanup: ['owned'] } };
  const f = fixture({ firefox: true, data });
  try { await f.service.ready; assert.equal((await f.route('https://owned.example/'))[0].port, 9); assert.equal(f.trace.some(row => row[0] === 'native'), false); } finally { f.cleanup(); }
});

for (const committedKey of [PROXY_STORAGE_KEY, STATE]) test('a torn multi-key storage write uses the single authoritative item before native cleanup: ' + committedKey, async () => {
  let failCommit = true; const f = fixture({ set(value, data) {
    if (!failCommit || !Object.hasOwn(value, PROXY_STORAGE_KEY) || !Object.hasOwn(value, STATE)) return;
    data[committedKey] = structuredClone(value[committedKey]); throw Error('partial multi-key write');
  } });
  try {
    await assert.rejects(f.client.saveProfile(replacement()), fails('operation-failed'));
    assert.equal(f.vault.size, 2); const desiredHost = committedKey === STATE ? '192.0.2.20' : '192.0.2.10';
    assert.equal(f.data[STATE].configuration.profiles[0].host, desiredHost);
    await assert.rejects(f.client.connect('owned'), fails('operation-failed'));
    failCommit = false; await f.client.load();
    assert.equal(f.service.snapshot().configuration.profiles[0].host, desiredHost); assert.equal(f.data[PROXY_STORAGE_KEY].profiles[0].host, desiredHost);
    assert.equal(f.vault.size, 1); assert.deepEqual(f.data[STATE].cleanup, []);
    await f.client.connect('owned'); const connectedId = f.trace.findLast(row => row[0] === 'native' && row[1] === 'connect')[2];
    assert.equal(f.vault.get(connectedId).host, desiredHost);
  } finally { f.cleanup(); }
});

test('failed projection repair stays quarantined and cannot clean up native records until reconciliation succeeds', async () => {
  const authoritative = metadata(), projection = metadata(); projection.profiles[0].host = '192.0.2.99';
  const data = { [PROXY_STORAGE_KEY]: projection, [STATE]: { version: 1, configuration: authoritative, nativeIds: {}, cleanup: ['staged-owned'] } };
  let failRepair = true;
  const f = fixture({ firefox: true, data, vault: new Map([['owned', oldSecret()], ['staged-owned', oldSecret()]]), set(value) { if (failRepair && Object.hasOwn(value, PROXY_STORAGE_KEY)) throw Error('repair unavailable'); } });
  try {
    await f.service.ready; assert.equal((await f.route('https://owned.example/'))[0].port, 9);
    await f.client.load(); assert.equal(f.trace.some(row => row[0] === 'native' && row[1] === 'delete'), false); assert.equal(f.vault.size, 2);
    failRepair = false; await f.client.load();
    assert.equal(f.vault.size, 1); assert.equal(f.data[PROXY_STORAGE_KEY].profiles[0].host, '192.0.2.10'); assert.deepEqual(f.data[STATE].cleanup, []);
  } finally { f.cleanup(); }
});

for (const kind of ['version', 'unknown-key', 'cleanup-budget', 'metadata-budget']) test('invalid authoritative state is bounded and cannot fall back to an apparently valid projection: ' + kind, async () => {
  const config = metadata({ native: false }), state = { version: 1, configuration: structuredClone(config), nativeIds: {}, cleanup: [] };
  if (kind === 'version') state.version = 2;
  if (kind === 'unknown-key') state.unexpected = true;
  if (kind === 'cleanup-budget') state.cleanup = Array.from({ length: 102 }, (_, n) => 'orphan-' + n);
  if (kind === 'metadata-budget') state.configuration.profiles = Array.from({ length: 101 }, (_, n) => ({ ...config.profiles[0], id: 'profile-' + n }));
  const f = fixture({ firefox: true, data: { [PROXY_STORAGE_KEY]: config, [STATE]: state } });
  try { await f.service.ready; assert.equal((await f.route('https://owned.example/'))[0].port, 9); assert.equal(f.trace.some(row => row[0] === 'native'), false); } finally { f.cleanup(); }
});

for (const id of ['toString', 'constructor', 'hasOwnProperty', 'prototype']) test('legacy and replaced native profiles retain valid Object-shaped public ID: ' + id, async () => {
  const config = metadata(); config.selectedId = id; config.profiles[0].id = id;
  const f = fixture({ config, vault: new Map([[id, oldSecret()]]) });
  try {
    await f.client.connect(id); assert.equal(f.trace.findLast(row => row[0] === 'native' && row[1] === 'connect')[2], id);
    await f.client.disconnect(); const input = replacement(); input.id = id;
    const updated = await f.client.saveProfile(input); assert.equal(updated.configuration.profiles[0].id, id);
    const vaultId = Object.getOwnPropertyDescriptor(f.data[STATE].nativeIds, id).value;
    await f.client.connect(id); assert.equal(f.trace.findLast(row => row[0] === 'native' && row[1] === 'connect')[2], vaultId);
    assert.equal((await f.client.exportProfiles(id)).profiles[0].connection.password, 'NEW_PASSWORD_CANARY');
  } finally { f.cleanup(); }
});
