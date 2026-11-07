// ADR-107 (ShardBrowser comparison ports): MemoryInfo getters, Chrome-shaped Network Information, notification permission
// parity in Permissions/Push, the filtered native voice list and media rows by kind. Synthetic vm realms mimic Chromium 156
// (measured: scripts/test/api-custom-native-shapes-native.mjs). NATIVE_SHAPES_RUNTIME_SOURCE points at a mutated runtime copy.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const sourceUrl = process.env.NATIVE_SHAPES_RUNTIME_SOURCE ? pathToFileURL(process.env.NATIVE_SHAPES_RUNTIME_SOURCE) : new URL('../../apps/production-extension/api-custom-runtime.js', import.meta.url);
const installerSource = readFileSync(sourceUrl, 'utf8').replace(/^export /m, '');
const KEY = '0f1e2d3c4b5a69788796a5b4c3d2e1f000112233445566778899aabbccddeeff';
assert.equal(KEY.length, 64);
const json = value => JSON.parse(JSON.stringify(value));

// Realm with Chromium-shaped natives; `setup` adds API-specific mocks. Each mock counts its native calls in `calls`.
function realm(setup, { host = 'alpha.example', locationAccessor = true } = {}) {
  const context = vm.createContext({});
  vm.runInContext(`'use strict';
    globalThis.calls = {}; globalThis.illegal = new TypeError('Illegal invocation');
    const count = key => { calls[key] = (calls[key] || 0) + 1; };
    globalThis.count = count;
    ${locationAccessor ? `const location = {}; Object.defineProperty(location, 'hostname', { get() { return ${JSON.stringify(host)}; }, enumerable: true });
    Object.defineProperty(globalThis, 'location', { get() { return location; }, enumerable: true, configurable: false });` : `globalThis.location = { hostname: ${JSON.stringify(host)} };`}
    ${setup}
  `, context);
  const run = code => vm.runInContext(code, context);
  return { context, run, calls: () => json(run('calls')) };
}
function install(f, entries) {
  f.context.entries = entries;
  f.run(`${installerSource}\nglobalThis.guard = installApiCustom(globalThis, entries);`);
  return f;
}
const snapshot = f => json(f.run('guard.snapshot()'));

// ---------- MemoryInfo ----------
const MEMORY = `
  const heap = globalThis.heap = { limit: 4395630592, total: 1572886, used: 1094350 };
  const infos = new WeakSet();
  const MemoryInfo = class MemoryInfo {
    get totalJSHeapSize() { count('total'); if (!infos.has(this)) throw illegal; return heap.total; }
    get usedJSHeapSize() { count('used'); if (!infos.has(this)) throw illegal; return heap.used; }
    get jsHeapSizeLimit() { count('limit'); if (!infos.has(this)) throw illegal; return heap.limit; }
  };
  Object.defineProperty(MemoryInfo.prototype, Symbol.toStringTag, { value: 'MemoryInfo', configurable: true });
  delete MemoryInfo.prototype.constructor;
  globalThis.memoryPrototype = MemoryInfo.prototype;
  globalThis.nativeMemoryGetters = Object.fromEntries(['totalJSHeapSize', 'usedJSHeapSize', 'jsHeapSizeLimit'].map(key => [key, Object.getOwnPropertyDescriptor(MemoryInfo.prototype, key).get]));
  globalThis.Performance = class Performance {
    get memory() { count('memory'); if (this !== performance) throw illegal; const info = new MemoryInfo(); infos.add(info); return info; }
  };
  globalThis.nativeMemory = Object.getOwnPropertyDescriptor(Performance.prototype, 'memory').get;
  globalThis.performance = new Performance();
`;
const memoryEntry = (limit = 2147483648, mode = 'custom') => [{ id: 'performance-memory', mode, value: { jsHeapSizeLimit: limit, totalJSHeapSize: 1, usedJSHeapSize: 1 } }];

test('memory: installation is passive; MemoryInfo getters are hooked from the first Performance.memory read, once', () => {
  const f = install(realm(MEMORY), memoryEntry());
  assert.deepEqual(f.calls(), {}, 'install reads nothing');
  assert.equal(f.run("Object.getOwnPropertyDescriptor(memoryPrototype, 'jsHeapSizeLimit').get === nativeMemoryGetters.jsHeapSizeLimit"), true);
  const installed = snapshot(f).installed;
  f.run('performance.memory');
  assert.equal(f.run("Object.getOwnPropertyDescriptor(memoryPrototype, 'jsHeapSizeLimit').get !== nativeMemoryGetters.jsHeapSizeLimit"), true);
  assert.equal(snapshot(f).installed, installed + 3);
  f.run('for (let index = 0; index < 5; index++) performance.memory;');
  assert.equal(snapshot(f).installed, installed + 3, 'every read returns a new object but the prototype is wrapped once');
});

test('memory: a new native MemoryInfo per read, no own keys, JSON "{}", tag kept; limit selected, live used/total clamped', () => {
  const f = install(realm(MEMORY), memoryEntry(2147483648));
  assert.equal(f.run('performance.memory !== performance.memory'), true);
  assert.equal(f.run('Reflect.ownKeys(performance.memory).length'), 0);
  assert.equal(f.run('JSON.stringify(performance.memory)'), '{}');
  assert.equal(f.run('Object.prototype.toString.call(performance.memory)'), '[object MemoryInfo]');
  assert.deepEqual(json(f.run('(m => [m.jsHeapSizeLimit, m.totalJSHeapSize, m.usedJSHeapSize])(performance.memory)')), [2147483648, 1572886, 1094350]);
  f.run('heap.total = 41096005 + 1927404; heap.used = 41096005;');
  assert.deepEqual(json(f.run('(m => [m.jsHeapSizeLimit, m.totalJSHeapSize, m.usedJSHeapSize])(performance.memory)')), [2147483648, 43023409, 41096005], 'live numbers move');
  f.run('heap.total = 3000000000; heap.used = 2500000000;');
  assert.deepEqual(json(f.run('(m => [m.jsHeapSizeLimit, m.totalJSHeapSize, m.usedJSHeapSize])(performance.memory)')), [2147483648, 2147483648, 2147483648], 'clamped to the selected limit');
  f.run('heap.total = NaN;');
  assert.equal(f.run('performance.memory.totalJSHeapSize'), 2147483648);
  const above = install(realm(MEMORY), memoryEntry(8589934592));
  assert.deepEqual(json(above.run('(m => [m.jsHeapSizeLimit, m.totalJSHeapSize, m.usedJSHeapSize])(performance.memory)')), [8589934592, 1572886, 1094350], 'a limit above the native one is reported as selected');
});

test('memory: each getter calls its native getter once with the same receiver; foreign receivers keep the native TypeError', () => {
  const f = install(realm(MEMORY), memoryEntry());
  f.run('globalThis.info = performance.memory; calls.limit = calls.used = calls.total = 0;');
  f.run('info.jsHeapSizeLimit; info.usedJSHeapSize; info.totalJSHeapSize;');
  assert.deepEqual([f.calls().limit, f.calls().used, f.calls().total], [1, 1, 1]);
  for (const key of ['jsHeapSizeLimit', 'usedJSHeapSize', 'totalJSHeapSize']) {
    for (const receiver of ['{}', 'null', 'Object.create(info)', 'new Proxy(info, {})']) {
      assert.throws(() => f.run(`Reflect.apply(Object.getOwnPropertyDescriptor(memoryPrototype, '${key}').get, ${receiver}, [])`), error => error === f.run('illegal'), key + ' ' + receiver);
    }
  }
  assert.throws(() => f.run('Reflect.apply(Object.getOwnPropertyDescriptor(Performance.prototype, "memory").get, {}, [])'), error => error === f.run('illegal'));
});

test('memory: OFF/bypass untouched, On hides Performance.memory, stop restores and a retained getter delegates', () => {
  for (const mode of ['off', 'bypass']) {
    const f = install(realm(MEMORY), memoryEntry(1, mode));
    assert.equal(f.run('performance.memory.jsHeapSizeLimit'), 4395630592, mode);
    assert.equal(f.run('Object.getOwnPropertyDescriptor(Performance.prototype, "memory").get === nativeMemory'), true);
  }
  const on = install(realm(MEMORY), memoryEntry(1, 'on'));
  assert.equal(on.run('"memory" in performance'), false);
  const f = install(realm(MEMORY), memoryEntry(1024));
  f.run('globalThis.info = performance.memory; globalThis.retained = Object.getOwnPropertyDescriptor(memoryPrototype, "jsHeapSizeLimit").get; guard.stop();');
  assert.equal(f.run('Object.getOwnPropertyDescriptor(memoryPrototype, "jsHeapSizeLimit").get === nativeMemoryGetters.jsHeapSizeLimit'), true);
  assert.equal(f.run('Object.getOwnPropertyDescriptor(Performance.prototype, "memory").get === nativeMemory'), true);
  assert.equal(f.run('Reflect.apply(retained, info, [])'), 4395630592);
});

test('memory: the neutral opaque value withholds the native heap numbers (all 0)', () => {
  const f = install(realm(MEMORY), [{ id: 'performance-memory', mode: 'custom', value: { jsHeapSizeLimit: 0, totalJSHeapSize: 0, usedJSHeapSize: 0 } }]);
  assert.deepEqual(json(f.run('(m => [m.jsHeapSizeLimit, m.totalJSHeapSize, m.usedJSHeapSize])(performance.memory)')), [0, 0, 0]);
});

// ---------- Network Information ----------
// Independent SipHash-2-4 reference (BigInt), checked against the published test vectors before it serves as the oracle.
function sipHashReference(key, message) {
  const mask = (1n << 64n) - 1n, rotl = (x, b) => ((x << BigInt(b)) | (x >> BigInt(64 - b))) & mask;
  const k0 = key.subarray(0, 8).reduce((acc, byte, index) => acc | BigInt(byte) << BigInt(8 * index), 0n), k1 = key.subarray(8, 16).reduce((acc, byte, index) => acc | BigInt(byte) << BigInt(8 * index), 0n);
  let v0 = k0 ^ 0x736f6d6570736575n, v1 = k1 ^ 0x646f72616e646f6dn, v2 = k0 ^ 0x6c7967656e657261n, v3 = k1 ^ 0x7465646279746573n;
  const round = () => { v0 = (v0 + v1) & mask; v1 = rotl(v1, 13); v1 ^= v0; v0 = rotl(v0, 32); v2 = (v2 + v3) & mask; v3 = rotl(v3, 16); v3 ^= v2; v0 = (v0 + v3) & mask; v3 = rotl(v3, 21); v3 ^= v0; v2 = (v2 + v1) & mask; v1 = rotl(v1, 17); v1 ^= v2; v2 = rotl(v2, 32); };
  const full = message.length - message.length % 8;
  for (let offset = 0; offset < full; offset += 8) { let m = 0n; for (let index = 0; index < 8; index++) m |= BigInt(message[offset + index]) << BigInt(8 * index); v3 ^= m; round(); round(); v0 ^= m; }
  let last = BigInt(message.length & 255) << 56n;
  for (let index = 0; index < message.length % 8; index++) last |= BigInt(message[full + index]) << BigInt(8 * index);
  v3 ^= last; round(); round(); v0 ^= last; v2 ^= 0xffn; round(); round(); round(); round();
  return (v0 ^ v1 ^ v2 ^ v3) & mask;
}
function expectedFactor(key, host) {
  if (!host || typeof key !== 'string' || !/^[0-9a-f]{64}$/.test(key)) return 1;
  const words = Array.from({ length: 8 }, (_, index) => Number.parseInt(key.slice(index * 8, index * 8 + 8), 16));
  const folded = [0, 1, 2, 3].map(index => (words[index] ^ words[index + 4]) >>> 0), bytes = new Uint8Array(16);
  folded.forEach((word, index) => { for (let shift = 0; shift < 4; shift++) bytes[index * 4 + shift] = word >>> (8 * shift) & 255; });
  const message = [...Buffer.from('netinfo/v1', 'latin1'), 0, ...[...host].flatMap(character => { const code = character.charCodeAt(0); return [code & 255, code >>> 8]; })];
  const low = Number(sipHashReference(bytes, Uint8Array.from(message)) & 0xffffffffn);
  return 0.9 + low % 21 * 0.01;
}
// Chrome's NetworkStateNotifier::RoundRtt / RoundMbps with std::round, written independently.
const chromeRtt = (rtt, factor) => Math.round(Math.min(rtt * factor, 3000) / 50) * 50;
const chromeDownlink = (mbps, factor) => Math.round(Math.min(mbps * 1000 * factor, 10000) / 50) * 50 / 1000;
const chromeType = rtt => rtt >= 2010 ? 'slow-2g' : rtt >= 1420 ? '2g' : rtt >= 272 ? '3g' : '4g';

const NETWORK = ({ android = false } = {}) => `
  const connections = new WeakSet();
  globalThis.NetworkInformation = class NetworkInformation {
    get effectiveType() { count('effectiveType'); if (!connections.has(this)) throw illegal; return '4g'; }
    get rtt() { count('rtt'); if (!connections.has(this)) throw illegal; return 100; }
    get downlink() { count('downlink'); if (!connections.has(this)) throw illegal; return 1.6; }
    get saveData() { count('saveData'); if (!connections.has(this)) throw illegal; return false; }
    ${android ? `get type() { if (!connections.has(this)) throw illegal; return 'cellular'; } get downlinkMax() { if (!connections.has(this)) throw illegal; return 7.2; }` : ''}
  };
  globalThis.connection = new NetworkInformation(); connections.add(connection);
`;
const networkEntry = (value, extra = { networkKey: KEY }) => [{ id: 'network-information', mode: 'custom', value, ...extra }];
const readNetwork = f => json(f.run('[connection.rtt, connection.downlink, connection.effectiveType, connection.saveData]'));

test('SipHash reference matches the published SipHash-2-4 vectors (oracle self-check)', () => {
  const key = Uint8Array.from({ length: 16 }, (_, index) => index);
  assert.equal(sipHashReference(key, new Uint8Array(0)), 0x726fdb47dd0e0e31n);
  assert.equal(sipHashReference(key, Uint8Array.from({ length: 15 }, (_, index) => index)), 0xa129ca6149be45e5n);
});

test('network: Chrome projection of the raw selection: keyed per-host multiplier, 50 ms / 50 kbps rounding, caps and NQE thresholds', () => {
  const rows = [[100, 1.6], [123, 1.234], [272, 5], [300, 1.5], [1419, 0.2], [1420, 0.1], [2009, 0.05], [2010, 0.05], [5000, 0.02], [50, 100], [0, 10], [24, 0.024], [76, 9.97]];
  const hosts = ['alpha.example', 'bravo.example', 'xn--80ak6aa92e.example', 'Mixed.CASE.host', '[2001:db8::1]'];
  assert.ok(new Set(hosts.map(host => expectedFactor(KEY, host))).size >= 3, 'the hosts draw different multipliers');
  for (const host of hosts) {
    const factor = expectedFactor(KEY, host);
    for (const [rtt, downlink] of rows) {
      const f = install(realm(NETWORK(), { host }), networkEntry({ downlink, effectiveType: '4g', rtt, saveData: rtt > 1000 }));
      assert.deepEqual(readNetwork(f), [chromeRtt(rtt, factor), chromeDownlink(downlink, factor), chromeType(rtt), rtt > 1000], host + ' ' + rtt + '/' + downlink);
    }
  }
});

test('network: effectiveType follows the raw rtt (272/1420/2010 ms) even when the rounded rtt is on the other side', () => {
  for (const [rtt, type] of [[271, '4g'], [272, '3g'], [1419, '3g'], [1420, '2g'], [2009, '2g'], [2010, 'slow-2g'], [0, '4g'], [600000, 'slow-2g']]) {
    const f = install(realm(NETWORK()), networkEntry({ downlink: 1, effectiveType: '4g', rtt, saveData: false }));
    assert.equal(f.run('connection.effectiveType'), type, String(rtt));
  }
  assert.equal(chromeRtt(272, 0.9), 250, 'measured: 272 ms shows rtt 250 with effectiveType 3g');
});

test('network: no host (about:blank, srcdoc, unreadable location) or no valid key gives the multiplier 1, like Chrome for an empty host', () => {
  for (const [host, extra] of [['', { networkKey: KEY }], ['alpha.example', {}], ['alpha.example', { networkKey: 'XYZ' }], ['alpha.example', { networkKey: KEY.toUpperCase() }]]) {
    const f = install(realm(NETWORK(), { host }), networkEntry({ downlink: 1.6, effectiveType: '4g', rtt: 123, saveData: false }, extra));
    assert.deepEqual(readNetwork(f), [chromeRtt(123, 1), chromeDownlink(1.6, 1), '4g', false], JSON.stringify([host, extra]));
  }
  const data = install(realm(NETWORK(), { host: 'alpha.example', locationAccessor: false }), networkEntry({ downlink: 1.6, effectiveType: '4g', rtt: 123, saveData: false }));
  assert.equal(data.run('connection.downlink'), chromeDownlink(1.6, expectedFactor(KEY, 'alpha.example')), 'a data-property location (vm, worker-like) is read too');
});

test('network: the host slot is stable per key and host, spreads over the 21 multipliers and changes with the key', () => {
  const slots = new Set(), other = [];
  for (let index = 0; index < 300; index++) slots.add(Math.round((expectedFactor(KEY, 'site' + index + '.example') - 0.9) * 100));
  assert.ok(slots.size >= 19, 'slots used: ' + slots.size);
  for (let index = 0; index < 40; index++) other.push(expectedFactor(KEY, 'h' + index + '.example') === expectedFactor('1'.repeat(64), 'h' + index + '.example'));
  assert.ok(other.filter(Boolean).length < 20, 'another key draws other slots');
  const first = install(realm(NETWORK(), { host: 'stable.example' }), networkEntry({ downlink: 9.97, effectiveType: '4g', rtt: 76, saveData: false }));
  const second = install(realm(NETWORK(), { host: 'stable.example' }), networkEntry({ downlink: 9.97, effectiveType: '4g', rtt: 76, saveData: false }));
  assert.deepEqual(readNetwork(first), readNetwork(second));
});

test('network: desktop has no type/downlinkMax: nothing is added and nothing is reported unavailable; Android keeps the withholding', () => {
  const desktop = install(realm(NETWORK()), networkEntry({ downlink: 1.5, effectiveType: '4g', rtt: 100, saveData: false }));
  assert.equal(desktop.run('"type" in connection || "downlinkMax" in connection'), false);
  assert.equal(snapshot(desktop).unavailable, 0); assert.equal(snapshot(desktop).installed, 4);
  const android = install(realm(NETWORK({ android: true })), networkEntry({ downlink: 1.5, effectiveType: '4g', rtt: 100, saveData: false, type: 'wifi' }));
  assert.deepEqual(json(android.run('[connection.type, connection.downlinkMax]')), ['wifi', 0]);
});

test('network: each getter calls the native getter once (brand check) and foreign receivers keep the native error; OFF/On/stop', () => {
  const f = install(realm(NETWORK()), networkEntry({ downlink: 1.5, effectiveType: '4g', rtt: 100, saveData: false }));
  f.run('connection.rtt; connection.downlink; connection.effectiveType; connection.saveData;');
  assert.deepEqual([f.calls().rtt, f.calls().downlink, f.calls().effectiveType, f.calls().saveData], [1, 1, 1, 1]);
  for (const key of ['rtt', 'downlink', 'effectiveType', 'saveData']) assert.throws(() => f.run(`Reflect.apply(Object.getOwnPropertyDescriptor(NetworkInformation.prototype, '${key}').get, {}, [])`), error => error === f.run('illegal'), key);
  f.run('guard.stop();');
  assert.deepEqual(readNetwork(f), [100, 1.6, '4g', false]);
  const off = install(realm(NETWORK()), [{ id: 'network-information', mode: 'off', value: { downlink: 1.5, effectiveType: '4g', rtt: 900, saveData: true } }]);
  assert.deepEqual(readNetwork(off), [100, 1.6, '4g', false]);
  const on = install(realm(NETWORK()), [{ id: 'network-information', mode: 'on', value: { downlink: 1.5, effectiveType: '4g', rtt: 100, saveData: false } }]);
  assert.equal(on.run('"rtt" in connection || "downlink" in connection'), false);
});

// ---------- Notifications -> Permissions / Push ----------
const PERMISSIONS = `
  const statuses = new WeakMap(), managers = new WeakSet();
  globalThis.native = { notifications: 'prompt', geolocation: 'granted' };
  globalThis.Notification = class Notification {};
  Object.defineProperty(Notification, 'permission', { configurable: true, get() { return native.notifications === 'prompt' ? 'default' : native.notifications; } });
  globalThis.PermissionStatus = class PermissionStatus {
    get name() { count('name'); const found = statuses.get(this); if (!found) throw illegal; return found; }
    get state() { count('state'); const found = statuses.get(this); if (!found) throw illegal; return native[found === 'push' ? 'notifications' : found]; }
  };
  globalThis.makeStatus = name => { const status = new PermissionStatus(); statuses.set(status, name); return status; };
  globalThis.PushManager = class PushManager {
    permissionState(options) { count('permissionState'); if (!managers.has(this)) return Promise.reject(illegal);
      if (!options || options.userVisibleOnly !== true) return Promise.reject(new DOMException('Push subscriptions that do not enable userVisibleOnly are not supported.', 'NotSupportedError'));
      return Promise.resolve(native.notifications); }
  };
  globalThis.pushManager = new PushManager(); managers.add(pushManager);
  globalThis.nativeState = Object.getOwnPropertyDescriptor(PermissionStatus.prototype, 'state').get;
`;
const notificationsEntry = (value, mode = 'custom') => [{ id: 'notifications', mode, value }];

test('notifications: Permissions and Push report the state that matches the selected permission (default->prompt, denied, granted)', async () => {
  for (const [value, state] of [['default', 'prompt'], ['denied', 'denied'], ['granted', 'granted']]) {
    const f = realm(PERMISSIONS);
    f.context.DOMException = DOMException;
    install(f, notificationsEntry(value));
    assert.equal(f.run('Notification.permission'), value);
    assert.equal(f.run('makeStatus("notifications").state'), state, value);
    assert.equal(f.run('makeStatus("push").state'), state, 'a push status (Firefox name) follows too');
    assert.equal(f.run('makeStatus("geolocation").state'), 'granted', 'other permissions stay native');
    assert.equal(await f.run('pushManager.permissionState({ userVisibleOnly: true })'), state);
  }
});

test('notifications: the state getter keeps the native brand check and call; the name is read only through the captured native getter', () => {
  const f = install(realm(PERMISSIONS), notificationsEntry('denied'));
  f.run('globalThis.status = makeStatus("notifications"); calls.state = calls.name = 0; status.state;');
  assert.deepEqual([f.calls().state, f.calls().name], [1, 1]);
  assert.throws(() => f.run('Reflect.apply(Object.getOwnPropertyDescriptor(PermissionStatus.prototype, "state").get, {}, [])'), error => error === f.run('illegal'));
  f.run('Object.defineProperty(PermissionStatus.prototype, "name", { configurable: true, get() { return "geolocation"; } });');
  assert.equal(f.run('status.state'), 'denied', 'a page-replaced name getter cannot switch the answer');
});

test('notifications: Push keeps native rejections and calls the native operation once; nothing is requested; OFF and stop are native', async () => {
  const f = realm(PERMISSIONS);
  f.context.DOMException = DOMException;
  install(f, notificationsEntry('granted'));
  await assert.rejects(f.run('pushManager.permissionState()'), error => error.name === 'NotSupportedError');
  await assert.rejects(f.run('Reflect.apply(PushManager.prototype.permissionState, {}, [{ userVisibleOnly: true }])'), error => error === f.run('illegal'));
  assert.equal(f.calls().permissionState, 2);
  f.run('guard.stop();');
  assert.equal(f.run('makeStatus("notifications").state'), 'prompt');
  assert.equal(await f.run('pushManager.permissionState({ userVisibleOnly: true })'), 'prompt');
  const off = install(realm(PERMISSIONS), notificationsEntry('denied', 'off'));
  assert.equal(off.run('Object.getOwnPropertyDescriptor(PermissionStatus.prototype, "state").get === nativeState'), true);
});

// ---------- Speech voices ----------
const VOICES = ({ list = 'default' } = {}) => `
  const voices = new WeakMap();
  globalThis.SpeechSynthesisVoice = class SpeechSynthesisVoice {
    get name() { const found = voices.get(this); if (!found) throw illegal; return found.name; }
    get lang() { count('lang'); const found = voices.get(this); if (!found) throw illegal; return found.lang; }
    get default() { count('default'); const found = voices.get(this); if (!found) throw illegal; return found.isDefault; }
  };
  const make = (name, lang, isDefault = false) => { const voice = new SpeechSynthesisVoice(); voices.set(voice, { name, lang, isDefault }); return voice; };
  globalThis.nativeVoices = ${list === 'empty' ? '[]' : list === 'late-default' ? `[make('Microsoft Irina - Russian (Russia)', 'ru-RU'), make('Microsoft David - English (United States)', 'en-US', true), make('Microsoft Zira', 'en-US'), make('Pavel', 'ru_RU')]`
    : list === 'no-default' ? `[make('Mark', 'en-US'), make('Irina', 'ru-RU')]` : `[make('Microsoft David - English (United States)', 'en-US', true), make('Microsoft Mark - English (United States)', 'en-US'), make('Microsoft Zira - English (United States)', 'en-US'), make('Microsoft Irina - Russian (Russia)', 'ru-RU'), make('Microsoft Pavel - Russian (Russia)', 'ru-RU'), make('Google Deutsch', 'de-DE'), make('Google 普通话（中国大陆）', 'zh-CN')]`};
  globalThis.SpeechSynthesis = class SpeechSynthesis { getVoices() { count('getVoices'); if (this !== speechSynthesis) throw illegal; return [...nativeVoices]; } };
  globalThis.speechSynthesis = new SpeechSynthesis();
  globalThis.nativeGetVoices = SpeechSynthesis.prototype.getVoices;
`;
const voicesEntry = (value, mode = 'custom') => [{ id: 'speech-voices', mode, value }];
const names = f => json(f.run('speechSynthesis.getVoices().map(voice => voice.name)'));

test('voices: native voices filtered by base language, the native default voice first, same objects, native order', () => {
  const f = install(realm(VOICES()), voicesEntry({ languages: ['ru-RU'] }));
  assert.deepEqual(names(f), ['Microsoft David - English (United States)', 'Microsoft Irina - Russian (Russia)', 'Microsoft Pavel - Russian (Russia)']);
  assert.equal(f.run('speechSynthesis.getVoices()[1] === nativeVoices[3]'), true, 'the native object itself');
  assert.equal(f.run('speechSynthesis.getVoices() !== speechSynthesis.getVoices()'), true, 'a new array per call like Chrome');
  assert.equal(f.run('Object.getPrototypeOf(speechSynthesis.getVoices()) === Array.prototype'), true);
  const english = install(realm(VOICES()), voicesEntry({ languages: ['en-GB', 'zh-Hant-TW'] }));
  assert.deepEqual(names(english), ['Microsoft David - English (United States)', 'Microsoft Mark - English (United States)', 'Microsoft Zira - English (United States)', 'Google 普通话（中国大陆）']);
  const german = install(realm(VOICES()), voicesEntry({ languages: ['de-DE'] }));
  assert.deepEqual(names(german), ['Microsoft David - English (United States)', 'Google Deutsch']);
  const none = install(realm(VOICES()), voicesEntry({ languages: ['fr-FR'] }));
  assert.deepEqual(names(none), ['Microsoft David - English (United States)'], 'the native default voice always stays');
});

test('voices: an empty native list stays the native array; a default voice that is not first moves first; no default means matches only', () => {
  const empty = install(realm(VOICES({ list: 'empty' })), voicesEntry({ languages: ['en-US'] }));
  assert.equal(empty.run('(() => { const voices = speechSynthesis.getVoices(); return voices.length === 0 && Array.isArray(voices); })()'), true);
  assert.equal(json(empty.run('guard.snapshot()')).changed, 0);
  const late = install(realm(VOICES({ list: 'late-default' })), voicesEntry({ languages: ['ru'] }));
  assert.deepEqual(names(late), ['Microsoft David - English (United States)', 'Microsoft Irina - Russian (Russia)', 'Pavel'], 'default first; ru_RU matches ru');
  const noDefault = install(realm(VOICES({ list: 'no-default' })), voicesEntry({ languages: ['ru-RU'] }));
  assert.deepEqual(names(noDefault), ['Irina']);
});

test('voices: native call once with the same receiver; foreign receivers keep the native error; page-replaced lang/default are ignored', () => {
  const f = install(realm(VOICES()), voicesEntry({ languages: ['ru-RU'] }));
  f.run('speechSynthesis.getVoices();');
  assert.equal(f.calls().getVoices, 1);
  assert.throws(() => f.run('Reflect.apply(SpeechSynthesis.prototype.getVoices, {}, [])'), error => error === f.run('illegal'));
  f.run('Object.defineProperty(SpeechSynthesisVoice.prototype, "lang", { configurable: true, get() { return "ru-RU"; } }); Object.defineProperty(SpeechSynthesisVoice.prototype, "default", { configurable: true, get() { return false; } });');
  assert.equal(names(f).length, 3, 'captured native getters still decide');
});

test('voices: the historical [] value still empties the list; On hides getVoices; OFF and stop are native', () => {
  const legacy = install(realm(VOICES()), voicesEntry([]));
  assert.deepEqual(names(legacy), []);
  const on = install(realm(VOICES()), voicesEntry({ languages: ['en-US'] }, 'on'));
  assert.equal(on.run('"getVoices" in speechSynthesis'), false);
  const off = install(realm(VOICES()), voicesEntry({ languages: ['ru-RU'] }, 'off'));
  assert.equal(names(off).length, 7);
  const f = install(realm(VOICES()), voicesEntry({ languages: ['ru-RU'] }));
  f.run('guard.stop();');
  assert.equal(names(f).length, 7);
  assert.equal(f.run('SpeechSynthesis.prototype.getVoices === nativeGetVoices'), true);
});

// ---------- Media rows by kind ----------
const MEDIA = `
  const devices = new WeakMap();
  globalThis.MediaDeviceInfo = class MediaDeviceInfo {
    get deviceId() { const found = devices.get(this); if (!found) throw illegal; return found.deviceId; }
    get groupId() { const found = devices.get(this); if (!found) throw illegal; return found.groupId; }
    get kind() { count('kind'); const found = devices.get(this); if (!found) throw illegal; return found.kind; }
    get label() { const found = devices.get(this); if (!found) throw illegal; return found.label; }
    toJSON() { const found = devices.get(this); if (!found) throw illegal; return { ...found }; }
  };
  globalThis.InputDeviceInfo = class InputDeviceInfo extends MediaDeviceInfo {};
  const make = (kind, label) => { const device = kind === 'audiooutput' ? new MediaDeviceInfo() : new InputDeviceInfo(); devices.set(device, { deviceId: 'native-' + label, groupId: 'g-' + label, kind, label }); return device; };
  globalThis.nativeDevices = [make('audioinput', 'Mic A'), make('audioinput', 'Mic B'), make('videoinput', 'Cam'), make('audiooutput', 'Speaker')];
  globalThis.MediaDevices = class MediaDevices { enumerateDevices() { count('enumerate'); return Promise.resolve([...nativeDevices]); } };
  globalThis.mediaDevices = new MediaDevices();
`;
const row = (kind, label) => ({ kind, deviceId: 'id-' + label, groupId: 'group-' + label, label });

test('media: rows sit on native devices of the same kind in native order; extra rows are dropped; nothing is created', async () => {
  const rows = [row('videoinput', 'Selected camera'), row('audioinput', 'First microphone'), row('audiooutput', 'Selected speaker'), row('audioinput', 'Second microphone'), row('audioinput', 'Third microphone')];
  const f = install(realm(MEDIA), [{ id: 'media-enumeration', mode: 'custom', value: rows }]);
  const list = await f.run('mediaDevices.enumerateDevices().then(items => items.map((item, index) => [item === nativeDevices[index] || nativeDevices.includes(item), item.kind, item.label, Object.getPrototypeOf(item).constructor.name]))');
  assert.deepEqual(json(list), [[true, 'audioinput', 'First microphone', 'InputDeviceInfo'], [true, 'audioinput', 'Second microphone', 'InputDeviceInfo'], [true, 'videoinput', 'Selected camera', 'InputDeviceInfo'], [true, 'audiooutput', 'Selected speaker', 'MediaDeviceInfo']]);
});

test('media: a camera row never sits on a microphone object and kinds without native devices yield nothing', async () => {
  const onlyCamera = install(realm(MEDIA.replace("make('videoinput', 'Cam'), ", '')), [{ id: 'media-enumeration', mode: 'custom', value: [row('videoinput', 'Camera'), row('videoinput', 'Camera 2')] }]);
  assert.deepEqual(json(await onlyCamera.run('mediaDevices.enumerateDevices().then(items => items.length)')), 0);
  const swapped = install(realm(MEDIA), [{ id: 'media-enumeration', mode: 'custom', value: [row('videoinput', 'Camera')] }]);
  assert.deepEqual(json(await swapped.run('mediaDevices.enumerateDevices().then(items => items.map(item => [item.kind, item.label, item.toJSON().kind]))')), [['videoinput', 'Camera', 'videoinput']]);
});

test('media: the native kind comes from the captured getter, so a page-replaced kind getter cannot move a row to another device', async () => {
  const f = install(realm(MEDIA), [{ id: 'media-enumeration', mode: 'custom', value: [row('videoinput', 'Camera'), row('audioinput', 'Mic')] }]);
  f.run('Object.defineProperty(MediaDeviceInfo.prototype, "kind", { configurable: true, get() { return "videoinput"; } });');
  const list = await f.run('mediaDevices.enumerateDevices().then(items => items.map(item => [nativeDevices.indexOf(item), item.label]))');
  assert.deepEqual(json(list), [[0, 'Mic'], [2, 'Camera']], 'the microphone row on the first native microphone, the camera row on the native camera');
});

test('registration end to end: the closed document-start script hands entry.networkKey to the generic installer', async () => {
  const { createApiConfiguration, updateApiConfiguration } = await import('../../packages/contracts/src/api-configuration.mjs');
  const { buildApiCustomScripts } = await import('../../apps/production-extension/api-custom-registration.js');
  const base = { ...createApiConfiguration(), enabled: true, antidetectEnabled: true, preset: 'custom' };
  const saved = updateApiConfiguration(base, 'network-information', { mode: 'custom', selected: { kind: 'value', value: { downlink: 1.234, effectiveType: '4g', rtt: 123, saveData: false } } });
  assert.equal(saved.ok, true, saved.error?.message);
  const code = buildApiCustomScripts(saved.value, ['https://*/*'], { networkSeed: KEY })[0].js[0].code;
  const f = realm(NETWORK(), { host: 'registration.example' });
  f.context.DOMException = DOMException; f.context.TextEncoder = TextEncoder;
  // The document runtime protects a Window-like realm only (it needs Navigator.prototype).
  f.run('globalThis.Navigator = class Navigator {};');
  f.run(code);
  const factor = expectedFactor(KEY, 'registration.example');
  assert.notEqual(factor, 1, 'the fixture host draws a non-unit multiplier');
  assert.deepEqual(readNetwork(f), [chromeRtt(123, factor), chromeDownlink(1.234, factor), '4g', false]);
  assert.throws(() => buildApiCustomScripts(saved.value, ['https://*/*'], {}), /Network Information profiles require a persisted profile key/);
});
