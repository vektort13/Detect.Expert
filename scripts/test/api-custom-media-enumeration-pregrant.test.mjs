// Owner request (Camoufox / CloakBrowser comparison, task E2): before any media permission Chrome lists one blank entry per present
// kind (label, deviceId and groupId all empty; measured in Chrome 156). The media-enumeration Custom list must not replace that blank
// list with labelled devices: no Chrome produces that shape. After a grant (any native label or id) the Custom rows sit on the native
// devices of the same kind (ADR-107): never on another kind, never more rows than real devices of a kind, never a created record.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { installApiCustom } from '../../apps/production-extension/api-custom-runtime.js';

const BLANK = kind => ({ kind, deviceId: '', groupId: '', label: '' });
const GRANTED = (kind, label = 'Native ' + kind) => ({ kind, deviceId: 'native-' + kind, groupId: 'native-group', label });
const ROWS = [
  { kind: 'audioinput', deviceId: 'custom-mic', groupId: 'custom-group', label: 'Custom Microphone' },
  { kind: 'videoinput', deviceId: 'custom-cam', groupId: 'custom-group', label: 'Custom Camera' },
];

function fixture({ natives = [], syncThrow = false, withInfo = true } = {}) {
  const brand = new TypeError('Illegal invocation'), data = new WeakMap(), valid = new WeakSet();
  const calls = [], created = [], last = { value: undefined }, state = { natives };
  const row = receiver => { const found = data.get(receiver); if (!found) throw brand; return found; };
  class MediaDeviceInfo {
    constructor(init) { data.set(this, init); }
    get deviceId() { return row(this).deviceId; }
    get groupId() { return row(this).groupId; }
    get kind() { return row(this).kind; }
    get label() { return row(this).label; }
    toJSON() { const found = row(this); return { deviceId: found.deviceId, kind: found.kind, label: found.label, groupId: found.groupId }; }
  }
  class MediaDevices {
    enumerateDevices() {
      calls.push({ receiver: this, args: Array.from(arguments) });
      if (!valid.has(this)) { if (syncThrow) throw brand; return Promise.reject(brand); }
      created.length = 0;
      for (const init of state.natives) created.push(new MediaDeviceInfo(init));
      last.value = [...created];
      return Promise.resolve(last.value);
    }
  }
  const receiver = new MediaDevices(); valid.add(receiver);
  const realm = { Object, Array, Promise, MediaDevices, ...(withInfo ? { MediaDeviceInfo } : {}) };
  return { realm, receiver, calls, created, last, state, brand, MediaDevices, MediaDeviceInfo };
}
const install = (f, extra = {}) => installApiCustom(f.realm, [{ id: 'media-enumeration', value: ROWS, ...extra }]);
const shape = devices => devices.map(device => [device.kind, device.deviceId, device.groupId, device.label]);

test('E2: a blank pre-permission list is returned exactly as Chrome produced it, native called once, nothing counted as changed', async () => {
  const f = fixture({ natives: [BLANK('audioinput'), BLANK('videoinput'), BLANK('audiooutput')] }), guard = install(f);
  const hostile = new Proxy({}, { get() { throw new Error('argument read'); }, ownKeys() { throw new Error('argument keys read'); } });
  const result = await f.receiver.enumerateDevices(hostile);
  assert.equal(result, f.last.value, 'the very array the native operation resolved with');
  result.forEach((device, index) => assert.equal(device, f.created[index], 'and its native objects'));
  assert.deepEqual(shape(result), [['audioinput', '', '', ''], ['videoinput', '', '', ''], ['audiooutput', '', '', '']]);
  assert.equal(JSON.stringify(result.map(device => device.toJSON())).includes('Custom'), false);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].receiver, f.receiver); assert.equal(f.calls[0].args[0], hostile);
  const snapshot = guard.snapshot();
  assert.equal(snapshot.changed, 0, 'no change bookkeeping'); assert.equal(snapshot.unavailable, 0); assert.ok(snapshot.entries[0].installed >= 1);
});

test('E2: after a grant (native labels) the Custom list applies as today', async () => {
  const f = fixture({ natives: [GRANTED('audioinput', 'Native Microphone'), GRANTED('videoinput', 'Native Camera')] }), guard = install(f);
  const result = await f.receiver.enumerateDevices(), changedByTransform = guard.snapshot().changed;
  assert.notEqual(result, f.last.value);
  assert.deepEqual(shape(result), shape(ROWS.map(row => ({ ...row }))));
  assert.equal(result[0], f.created[0], 'the first row keeps its native object and prototype');
  assert.equal(changedByTransform, 1, 'one change for the replaced list (property reads count separately)'); assert.equal(f.calls.length, 1);
});

test('E2: a partial grant (one labelled entry among blank ones) is not a pre-permission list', async () => {
  const f = fixture({ natives: [GRANTED('audioinput', 'Native Microphone'), BLANK('videoinput'), BLANK('audiooutput')] }); install(f);
  assert.deepEqual((await f.receiver.enumerateDevices()).map(device => device.label), ['Custom Microphone', 'Custom Camera']);
});

test('E2: a blank label with a native deviceId or groupId is not treated as pre-permission (stricter than the label alone)', async () => {
  for (const natives of [[{ kind: 'audioinput', deviceId: 'native-id', groupId: '', label: '' }], [{ kind: 'audioinput', deviceId: '', groupId: 'native-group', label: '' }]]) {
    const f = fixture({ natives }); install(f);
    assert.deepEqual((await f.receiver.enumerateDevices()).map(device => device.deviceId), ['custom-mic'], 'one real microphone carries the microphone row; no camera exists, so no camera row');
  }
});

test('E2: an empty native list stays empty (nothing is created); above 1024 entries rows still follow kinds; 1024 blank entries are pre-permission', async () => {
  const empty = fixture({ natives: [] }); install(empty);
  assert.deepEqual((await empty.receiver.enumerateDevices()).map(device => device.label), [], 'no device, no row');
  const many = fixture({ natives: Array.from({ length: 1025 }, () => BLANK('audioinput')) }); install(many);
  assert.deepEqual((await many.receiver.enumerateDevices()).map(device => device.label), ['Custom Microphone'], 'above 1024 entries the blank test is not attempted; the camera row has no camera');
  const exact = fixture({ natives: Array.from({ length: 1024 }, () => BLANK('audioinput')) }); install(exact);
  assert.equal((await exact.receiver.enumerateDevices()).length, 1024, 'up to 1024 blank entries still count as pre-permission');
});

test('E2: wrong receivers keep the native error: a rejection stays the same rejection, a synchronous throw stays the same throw', async () => {
  const rejecting = fixture({ natives: [BLANK('audioinput')] }), guard = install(rejecting), foreign = {};
  await assert.rejects(Reflect.apply(rejecting.MediaDevices.prototype.enumerateDevices, foreign, []), error => error === rejecting.brand);
  assert.equal(rejecting.calls.length, 1); assert.equal(rejecting.calls[0].receiver, foreign);
  assert.equal(guard.snapshot().changed, 0);
  const throwing = fixture({ natives: [BLANK('audioinput')], syncThrow: true }); install(throwing);
  assert.throws(() => Reflect.apply(throwing.MediaDevices.prototype.enumerateDevices, foreign, []), error => error === throwing.brand);
  assert.equal(throwing.calls.length, 1);
  assert.equal(shape(await throwing.receiver.enumerateDevices()).length, 1, 'a valid receiver still works afterwards');
});

test('E2: the blank test reads the captured native accessors, never a page-replaced MediaDeviceInfo property', async () => {
  const f = fixture({ natives: [BLANK('audioinput'), BLANK('videoinput')] }); install(f);
  Object.defineProperty(f.MediaDeviceInfo.prototype, 'label', { configurable: true, get() { return 'Page label'; } });
  Object.defineProperty(f.MediaDeviceInfo.prototype, 'deviceId', { configurable: true, get() { return 'page-id'; } });
  const blank = await f.receiver.enumerateDevices();
  assert.equal(blank, f.last.value, 'still pre-permission although the page now reports labels');
  f.state.natives = [GRANTED('audioinput', 'Native Microphone')];
  assert.deepEqual((await f.receiver.enumerateDevices()).map(device => device.kind), ['audioinput'], 'a native label is still seen through the captured accessor; only the microphone row has a device');
});

test('E2: a grant after a pre-permission call switches to the Custom list; earlier blank objects stay native', async () => {
  const f = fixture({ natives: [BLANK('audioinput'), BLANK('videoinput')] }); install(f);
  const before = await f.receiver.enumerateDevices();
  assert.equal(before, f.last.value);
  f.state.natives = [GRANTED('audioinput', 'Native Microphone'), GRANTED('videoinput', 'Native Camera')];
  const after = await f.receiver.enumerateDevices();
  assert.deepEqual(after.map(device => device.label), ['Custom Microphone', 'Custom Camera']);
  assert.deepEqual(before.map(device => device.label), ['', ''], 'objects handed out before the grant are not rewritten');
  assert.equal(f.calls.length, 2);
  f.state.natives = [BLANK('audioinput')];
  assert.equal(await f.receiver.enumerateDevices(), f.last.value, 'and a later blank list is native again');
});

test('E2: stop() restores the native operation; a retained wrapper returns the native result', async () => {
  const f = fixture({ natives: [BLANK('audioinput')] }), guard = install(f), wrapper = f.MediaDevices.prototype.enumerateDevices;
  assert.notEqual(wrapper, undefined);
  guard.stop();
  assert.equal(await Reflect.apply(wrapper, f.receiver, []), f.last.value);
  assert.equal(await f.receiver.enumerateDevices(), f.last.value);
  assert.equal(f.calls.length, 2);
});

test('E2: without a MediaDeviceInfo interface neither the blank test nor the device kind can be proven: nothing is shown', async () => {
  const f = fixture({ natives: [BLANK('audioinput')], withInfo: false }), guard = install(f);
  const result = await f.receiver.enumerateDevices();
  assert.deepEqual(result.map(device => device.label), [], 'fail closed: no native device without a proven kind, no created record');
  assert.ok(guard.snapshot().unavailable >= 1);
});

test('E2: the opaque shield entry (empty Custom list) still withholds every labelled native device and leaves blank ones blank', async () => {
  const labelled = fixture({ natives: [GRANTED('audioinput', 'Native Microphone')] });
  installApiCustom(labelled.realm, [{ id: 'media-enumeration', value: [], shield: true }]);
  const empty = await labelled.receiver.enumerateDevices();
  assert.deepEqual(empty, []);
  assert.deepEqual(shape(labelled.created), [['', '', '', '']], 'the native object itself reports blank strings (kind included) through the fallback');
  const blank = fixture({ natives: [BLANK('audioinput')] });
  installApiCustom(blank.realm, [{ id: 'media-enumeration', value: [], shield: true }]);
  assert.equal(await blank.receiver.enumerateDevices(), blank.last.value);
});

test('E2: On still hides the operation and does not read any accessor', () => {
  const f = fixture({ natives: [BLANK('audioinput')] });
  const guard = installApiCustom(f.realm, [{ id: 'media-enumeration', mode: 'on', value: [] }]);
  assert.equal(Object.hasOwn(f.MediaDevices.prototype, 'enumerateDevices'), false);
  assert.equal(guard.snapshot().installed, 1); assert.equal(f.calls.length, 0);
});

test('E2: the serialized installer (userScripts source, no module scope) behaves the same in a fresh realm', async () => {
  const context = vm.createContext({});
  vm.runInContext(`
    globalThis.install = (${installApiCustom.toString()});
    const rows = new WeakMap(), brand = new TypeError('brand');
    const row = value => { const found = rows.get(value); if (!found) throw brand; return found; };
    globalThis.MediaDeviceInfo = class MediaDeviceInfo {
      constructor(init) { rows.set(this, init); }
      get deviceId() { return row(this).deviceId; } get groupId() { return row(this).groupId; }
      get kind() { return row(this).kind; } get label() { return row(this).label; }
      toJSON() { return { ...row(this) }; }
    };
    globalThis.natives = [];
    globalThis.MediaDevices = class MediaDevices { enumerateDevices() { return Promise.resolve(natives.map(init => new MediaDeviceInfo(init))); } };
    globalThis.receiver = new MediaDevices();
    globalThis.guard = install(globalThis, [{ id: 'media-enumeration', value: [{ kind: 'audioinput', deviceId: 'c1', groupId: 'g', label: 'Custom Microphone' }] }]);
  `, context);
  const list = () => vm.runInContext('receiver.enumerateDevices().then(items => items.map(item => item.label + "|" + item.deviceId).join(","))', context);
  vm.runInContext('natives = [{ kind: "audioinput", deviceId: "", groupId: "", label: "" }, { kind: "videoinput", deviceId: "", groupId: "", label: "" }]', context);
  assert.equal(await list(), '|,|', 'blank pre-permission list passes through');
  assert.equal(vm.runInContext('guard.snapshot().changed', context), 0);
  vm.runInContext('natives = [{ kind: "audioinput", deviceId: "n1", groupId: "ng", label: "Native" }]', context);
  assert.equal(await list(), 'Custom Microphone|c1', 'granted list is replaced');
  assert.equal(vm.runInContext('guard.snapshot().unavailable', context), 0);
});
