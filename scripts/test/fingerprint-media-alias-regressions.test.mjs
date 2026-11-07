// ADR-083: page-requested enumeration warms the current document's inverse map.
// No startup probe or extra native selection/enumeration is permitted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installWebRtcCustom } from '../../apps/production-extension/api-custom-webrtc-runtime.js';

const seed = 'a'.repeat(64);
const profile = { addresses: null, iceTransportPolicy: 'preserve', randomizeDevices: true, freshCertificates: false, deviceLifetime: 'session' };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture({ absent = false, configurable = true, randomizeDevices = true, origin = 'https://fixture.invalid' } = {}) {
  const devices = new WeakMap(), receivers = new WeakMap(), calls = [], reads = [];
  const brand = new TypeError('FIXTURE_NATIVE_BRAND'), rejected = new Error('FIXTURE_NATIVE_REJECTION');
  class RTCPeerConnection {}
  class MediaDeviceInfo {
    constructor(id = 'native-device', group = 'native-group') { devices.set(this, { id, group }); }
    get deviceId() { const value = devices.get(this); if (!value) throw brand; reads.push(['device', value.id]); return value.id; }
    get groupId() { const value = devices.get(this); if (!value) throw brand; reads.push(['group', value.group]); return value.group; }
    get kind() { if (!devices.has(this)) throw brand; return 'audioinput'; }
    get label() { if (!devices.has(this)) throw brand; return 'Fixture microphone'; }
  }
  class MediaDevices {
    constructor() { receivers.set(this, { response: [new MediaDeviceInfo()], enumerate: null, ids: new Set(['native-device']), groups: new Set(['native-group']) }); }
    enumerateDevices() {
      const state = receivers.get(this); if (!state) return Promise.reject(brand);
      calls.push(['enumerate', this, arguments.length]);
      return state.enumerate ? state.enumerate() : Promise.resolve(state.response);
    }
    getUserMedia(constraints) {
      const state = receivers.get(this); if (!state) return Promise.reject(brand);
      calls.push(['getUserMedia', this, arguments.length]);
      const audio = constraints.audio, id = audio.deviceId?.exact ?? audio.deviceId, group = audio.groupId?.exact ?? audio.groupId;
      calls.push(['selection', id, group]);
      if (id !== undefined && !state.ids.has(id) || group !== undefined && !state.groups.has(group)) return Promise.reject(new DOMException('Fixture exact selection unavailable', 'OverconstrainedError'));
      return Promise.resolve({ nativeFixtureTrack: true });
    }
  }
  if (absent) delete MediaDevices.prototype.enumerateDevices;
  else if (!configurable) Object.defineProperty(MediaDevices.prototype, 'enumerateDevices', { configurable: false });
  const nativeEnumerate = MediaDevices.prototype.enumerateDevices;
  const realm = { Object, Array, Promise, RTCPeerConnection, MediaDeviceInfo, MediaDevices, DOMException, location: { origin } };
  const installation = installWebRtcCustom(realm, [{ id: 'webrtc', mode: 'custom', value: { ...profile, randomizeDevices }, deviceSeed: seed }]);
  const receiver = new MediaDevices();
  return { realm, receiver, installation, calls, reads, brand, rejected, nativeEnumerate, state: receivers.get(receiver),
    stateOf: value => receivers.get(value), device: (id, group) => new MediaDeviceInfo(id, group) };
}
function remembered() {
  const f = fixture(), device = f.device();
  try { return { id: device.deviceId, group: device.groupId }; }
  finally { f.installation.stop(); }
}
const selection = (id, group) => ({ audio: { ...(id ? { deviceId: { exact: id } } : {}), ...(group ? { groupId: { exact: group } } : {}) } });

test('new document restores saved device/group aliases after legitimate enumeration without any page ID getter', async () => {
  const saved = remembered(), f = fixture();
  try {
    assert.equal(f.calls.length, 0, 'installation must not enumerate or select devices');
    const nativeArray = f.state.response;
    const result = await f.receiver.enumerateDevices();
    assert.equal(result, nativeArray); assert.equal(result[0], nativeArray[0]);
    assert.deepEqual(f.reads, [['device', 'native-device'], ['group', 'native-group']]);
    assert.equal(f.calls.filter(([name]) => name === 'enumerate').length, 1);
    await f.receiver.getUserMedia(selection(saved.id, saved.group));
    assert.deepEqual(f.calls.at(-1), ['selection', 'native-device', 'native-group']);
    assert.equal(f.calls.filter(([name]) => name === 'getUserMedia').length, 1);
    assert.equal(f.calls.filter(([name]) => name === 'enumerate').length, 1);
  } finally { f.installation.stop(); }
});

test('selection before any enumeration remains unsupported and never causes an implicit enumeration or retry', async () => {
  const saved = remembered(), f = fixture();
  try {
    await assert.rejects(f.receiver.getUserMedia(selection(saved.id)), error => error.name === 'OverconstrainedError');
    assert.equal(f.calls.filter(([name]) => name === 'enumerate').length, 0);
    assert.equal(f.calls.filter(([name]) => name === 'getUserMedia').length, 1);
    assert.equal(f.reads.length, 0);
  } finally { f.installation.stop(); }
});

test('enumeration keeps native receiver/argument forwarding, rejection reason identity and synchronous native throw', async () => {
  const f = fixture();
  try {
    await assert.rejects(Reflect.apply(f.receiver.enumerateDevices, {}, []), error => error === f.brand);
    f.state.enumerate = () => Promise.reject(f.rejected);
    await assert.rejects(f.receiver.enumerateDevices(), error => error === f.rejected);
    f.state.enumerate = () => { throw f.rejected; };
    assert.throws(() => f.receiver.enumerateDevices(), error => error === f.rejected);
    f.state.enumerate = null;
    await Reflect.apply(f.receiver.enumerateDevices, f.receiver, ['ignored-native-argument']);
    assert.equal(f.calls.at(-1)[1], f.receiver); assert.equal(f.calls.at(-1)[2], 1);
  } finally { f.installation.stop(); }
});

test('warming does not add caller constraint getter reads or change their native conversion order', async () => {
  const saved = remembered(), f = fixture();
  try {
    await f.receiver.enumerateDevices();
    const order = [], audio = {};
    Object.defineProperties(audio, {
      deviceId: { get() { order.push('deviceId'); return { exact: saved.id }; } },
      groupId: { get() { order.push('groupId'); return { exact: saved.group }; } },
    });
    const constraints = { get audio() { order.push('audio'); return audio; } };
    await f.receiver.getUserMedia(constraints);
    // The wrapper preserves the native selector's trace, with no preflight Gets.
    assert.deepEqual(order, ['audio', 'deviceId', 'groupId']);
    assert.equal(f.calls.filter(([name]) => name === 'getUserMedia').length, 1);
  } finally { f.installation.stop(); }
});

test('stopped or in-flight stopped enumeration forwards native results without warming private identities', async () => {
  for (const pending of [false, true]) {
    const f = fixture(), retained = f.receiver.enumerateDevices;
    try {
      const wait = deferred(); if (pending) f.state.enumerate = () => wait.promise;
      let result;
      if (pending) result = retained.call(f.receiver);
      f.installation.stop();
      if (pending) wait.resolve(f.state.response); else result = retained.call(f.receiver);
      assert.equal(await result, f.state.response);
      assert.equal(f.reads.length, 0);
      assert.equal(f.calls.filter(([name]) => name === 'enumerate').length, 1);
    } finally { f.installation.stop(); }
  }
});

test('only the latest enumeration of one native receiver warms its results; independent receivers retain their own generation', async () => {
  const saved = remembered(), f = fixture();
  try {
    const first = deferred(), second = deferred(); let number = 0;
    f.state.enumerate = () => ++number === 1 ? first.promise : second.promise;
    const oldArray = [f.device('old-device', 'old-group')], newArray = f.state.response;
    const old = f.receiver.enumerateDevices(), current = f.receiver.enumerateDevices();
    second.resolve(newArray); assert.equal(await current, newArray);
    first.resolve(oldArray); assert.equal(await old, oldArray);
    assert.deepEqual(f.reads, [['device', 'native-device'], ['group', 'native-group']]);
    await f.receiver.getUserMedia(selection(saved.id));
    const other = new f.realm.MediaDevices(), separate = deferred();
    f.state.enumerate = () => separate.promise;
    const pending = f.receiver.enumerateDevices(); await other.enumerateDevices();
    separate.resolve(newArray); await pending;
    assert.equal(f.reads.filter(([kind, id]) => kind === 'device' && id === 'native-device').length, 3);
  } finally { f.installation.stop(); }
});

test('empty, malformed and unbrandable successful results retain native result identity and bounded error reporting', async () => {
  const f = fixture();
  try {
    for (const result of [[], null, [Object.defineProperty({}, 'deviceId', { get() { assert.fail('page getter must not be read'); } })]]) {
      f.state.enumerate = () => Promise.resolve(result);
      assert.equal(await f.receiver.enumerateDevices(), result);
    }
    assert.equal(f.reads.length, 0);
    assert.ok(f.installation.snapshot().unavailable > 0);
  } finally { f.installation.stop(); }
});

test('absent or non-configurable native enumeration is not created/replaced and disabled randomness adds no warming', async () => {
  for (const options of [{ absent: true }, { configurable: false }, { randomizeDevices: false }]) {
    const f = fixture(options);
    try {
      assert.equal(f.realm.MediaDevices.prototype.enumerateDevices, f.nativeEnumerate);
      if (!options.absent) { assert.equal(await f.receiver.enumerateDevices(), f.state.response); assert.equal(f.reads.length, 0); }
    } finally { f.installation.stop(); }
  }
});

test('warming inspects at most 1024 native entries and retains the existing 2048-alias limit', async () => {
  const f = fixture();
  try {
    f.state.response = Array.from({ length: 1025 }, (_, index) => f.device('device-' + index, 'group-' + index));
    assert.equal(await f.receiver.enumerateDevices(), f.state.response);
    assert.equal(f.reads.length, 2048);
    assert.equal(f.state.response[1024].deviceId, '', 'full alias budget never falls back to a native identifier');
    assert.ok(f.installation.snapshot().unavailable > 0);
  } finally { f.installation.stop(); }
});

test('separate origin installations keep aliases and warmed inverse maps isolated', async () => {
  const saved = remembered(), f = fixture({ origin: 'https://other.invalid' });
  try {
    await f.receiver.enumerateDevices();
    await assert.rejects(f.receiver.getUserMedia(selection(saved.id)), error => error.name === 'OverconstrainedError');
    const localAlias = f.state.response[0].deviceId;
    assert.notEqual(localAlias, saved.id);
    await f.receiver.getUserMedia(selection(localAlias));
    assert.deepEqual(f.calls.at(-1), ['selection', 'native-device', undefined]);
  } finally { f.installation.stop(); }
});

test('warming uses captured native getters without invoking later page getter replacements or array iterators', async () => {
  const saved = remembered(), f = fixture();
  try {
    Object.defineProperty(f.realm.MediaDeviceInfo.prototype, 'deviceId', { configurable: true, get() { assert.fail('later page device getter must not be invoked'); } });
    Object.defineProperty(f.realm.MediaDeviceInfo.prototype, 'groupId', { configurable: true, get() { assert.fail('later page group getter must not be invoked'); } });
    Object.defineProperty(f.state.response, Symbol.iterator, { configurable: true, get() { assert.fail('page array iterator must not be invoked'); } });
    assert.equal(await f.receiver.enumerateDevices(), f.state.response);
    await f.receiver.getUserMedia(selection(saved.id, saved.group));
    assert.deepEqual(f.calls.at(-1), ['selection', 'native-device', 'native-group']);
  } finally { f.installation.stop(); }
});

test('captured branded getters support native-like device handles with another prototype without replacing them', async () => {
  const saved = remembered(), f = fixture();
  try {
    class ForeignDeviceInfo extends f.realm.MediaDeviceInfo {}
    const foreignDevice = new ForeignDeviceInfo();
    f.state.response = [foreignDevice];
    const array = await f.receiver.enumerateDevices();
    assert.equal(array, f.state.response); assert.equal(array[0], foreignDevice);
    await f.receiver.getUserMedia(selection(saved.id, saved.group));
    assert.deepEqual(f.calls.at(-1), ['selection', 'native-device', 'native-group']);
  } finally { f.installation.stop(); }
});
