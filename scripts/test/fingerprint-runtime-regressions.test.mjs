// ADR-083 / FP-02, FP-03: native/control compatibility regressions; no browser probes.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installApiCustom } from '../../apps/production-extension/api-custom-runtime.js';

function methodFixture(name, key, behavior) {
  const calls = [], owner = {};
  const original = { operation() {
    'use strict';
    const args = Array.from(arguments);
    calls.push({ receiver: this, args });
    return behavior(this, args);
  } }.operation;
  const descriptor = { value: original, configurable: true, writable: true, enumerable: true };
  Object.defineProperty(owner, key, descriptor);
  const Constructor = function() {};
  Object.setPrototypeOf(Constructor.prototype, owner);
  const receiver = new Constructor();
  return { realm: { Object, Array, Promise, [name]: Constructor }, owner, receiver, calls, original, descriptor };
}

function hintsFixture() {
  function NavigatorUAData() {}
  const receiver = new NavigatorUAData(), proto = NavigatorUAData.prototype;
  const template = { brands: [{ brand: 'Selected Chromium', version: '153' }], mobile: false, platform: 'Selected OS', architecture: 'arm' };
  const originals = new Map(), calls = { brands: 0, mobile: 0, platform: 0, json: 0, high: 0 };
  const brandError = new TypeError('Native invalid receiver');
  for (const [key, native] of Object.entries({ brands: [{ brand: 'Native Chromium', version: '153' }], mobile: false, platform: 'Native OS' })) {
    const descriptor = { configurable: true, enumerable: true, set: undefined, get() {
      calls[key]++;
      if (this !== receiver) throw brandError;
      return key === 'brands' ? Object.freeze(structuredClone(native)) : native;
    } };
    originals.set(key, descriptor);
    Object.defineProperty(proto, key, descriptor);
  }
  const methods = { toJSON() {
    calls.json++;
    if (this !== receiver) throw brandError;
    return { brands: [{ brand: 'Native Chromium', version: '153' }], mobile: false, platform: 'Native OS' };
  }, getHighEntropyValues() {
    calls.high++;
    if (this !== receiver) return Promise.reject(brandError);
    return Promise.resolve({ brands: [{ brand: 'Native Chromium', version: '153' }], mobile: false, platform: 'Native OS', architecture: 'x86' });
  } };
  for (const key of ['toJSON', 'getHighEntropyValues']) {
    const descriptor = { configurable: true, enumerable: true, writable: true, value: methods[key] };
    originals.set(key, descriptor);
    Object.defineProperty(proto, key, descriptor);
  }
  const guard = installApiCustom({ Object, Array, Promise, NavigatorUAData }, [{ id: 'client-hints', value: template }]);
  return { receiver, proto, template, originals, calls, brandError, guard };
}

test('FP-02: every brands read has a fresh frozen array and fresh mutable dictionaries, without changing selected data', async () => {
  const f = hintsFixture(), saved = structuredClone(f.template);
  assert.equal(f.calls.brands, 0, 'installation never samples native brands');
  const first = f.receiver.brands, second = f.receiver.brands;
  assert.equal(f.calls.brands, 2, 'one native getter invocation per read');
  assert.notEqual(first, second);
  assert.notEqual(first[0], second[0]);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first[0]), false);
  assert.throws(() => first.push({ brand: 'Extra', version: '1' }), TypeError);
  assert.equal(Reflect.set(first[0], 'brand', 'Page mutation'), true);
  assert.equal(Reflect.set(first[0], 'version', '1'), true);
  assert.equal(Reflect.set(first[0], 'extra', 'page-only field'), true);
  assert.deepEqual(second, saved.brands);
  assert.deepEqual(f.receiver.brands, saved.brands);
  assert.deepEqual(f.template, saved);
  assert.deepEqual(f.receiver.toJSON().brands, saved.brands);
  assert.deepEqual((await f.receiver.getHighEntropyValues(['architecture'])).brands, saved.brands);
  const borrowed = Object.getOwnPropertyDescriptor(f.proto, 'brands').get;
  assert.deepEqual(Reflect.apply(borrowed, f.receiver, []), saved.brands);
  assert.throws(() => Reflect.apply(borrowed, {}, []), error => error === f.brandError);
  assert.equal(f.calls.brands, 5, 'including the invalid receiver invokes native exactly once');
  f.guard.stop();
  assert.deepEqual(Object.getOwnPropertyDescriptor(f.proto, 'brands'), f.originals.get('brands'));
  assert.deepEqual(Reflect.apply(borrowed, f.receiver, []), [{ brand: 'Native Chromium', version: '153' }]);
});

test('FP-02: caller mutation after installation cannot replace the private brands template; other arrays keep existing behavior', () => {
  const f = hintsFixture();
  f.template.brands[0].brand = 'Caller mutation';
  f.template.brands.push({ brand: 'Caller extra', version: '1' });
  assert.deepEqual(f.receiver.brands, [{ brand: 'Selected Chromium', version: '153' }]);
  f.guard.stop();
  function Navigator() {}
  const receiver = new Navigator();
  Object.defineProperty(Navigator.prototype, 'languages', { configurable: true, get() { return ['native']; } });
  const guard = installApiCustom({ Navigator }, [{ id: 'navigator-languages', value: ['en-US', 'en'] }]);
  assert.equal(Object.isFrozen(receiver.languages), true);
  assert.throws(() => receiver.languages.push('fr'), TypeError);
  guard.stop();
});

for (const [id, name, key, selected, native, expected, asynchronous] of [
  ['client-hints', 'NavigatorUAData', 'toJSON', { brands: [], mobile: false, platform: 'Chosen' }, { brands: [], mobile: false, platform: 'Native' }, { brands: [], mobile: false, platform: 'Chosen' }, false],
  ['bluetooth', 'Bluetooth', 'getAvailability', { available: false, devices: [] }, true, false, true],
  ['media-capabilities', 'MediaCapabilities', 'decodingInfo', { supported: false, smooth: false, powerEfficient: false }, { supported: true, smooth: true, powerEfficient: true }, { supported: false, smooth: false, powerEfficient: false }, true]
]) test(`FP-03: ${name}.${key} is non-constructable and forwards receiver/opaque arguments once`, async () => {
  const result = asynchronous ? Promise.resolve(native) : native;
  const f = methodFixture(name, key, () => result);
  const guard = installApiCustom(f.realm, [{ id, value: selected }]);
  const wrapper = f.owner[key];
  assert.equal(Object.hasOwn(wrapper, 'prototype'), false);
  assert.throws(() => Reflect.construct(wrapper, []), TypeError);
  assert.throws(() => Reflect.construct(function() {}, [], wrapper), TypeError);
  assert.equal(f.calls.length, 0, 'construction never enters the native operation');
  let reads = 0;
  const opaque = new Proxy({}, { get() { reads++; throw Error('unexpected argument read'); }, ownKeys() { reads++; throw Error('unexpected argument keys'); } });
  const receiver = new Proxy({}, { get() { reads++; throw Error('unexpected receiver read'); } });
  const returned = Reflect.apply(wrapper, receiver, [opaque, Symbol('argument'), undefined]);
  assert.deepEqual(asynchronous ? await returned : returned, expected);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].receiver, receiver);
  assert.equal(f.calls[0].args[0], opaque);
  assert.equal(typeof f.calls[0].args[1], 'symbol');
  assert.equal(f.calls[0].args.length, 3);
  assert.equal(reads, 0);
  guard.stop();
  assert.deepEqual(Object.getOwnPropertyDescriptor(f.owner, key), f.descriptor);
  assert.equal(Reflect.apply(wrapper, receiver, [opaque]), result, 'retained wrapper returns native identity after stop');
});

test('ADR-101 / FP-03: virtual UAData remains non-constructable and retained Stop delegates the original', async () => {
  const f = hintsFixture(), wrapper = f.proto.getHighEntropyValues;
  assert.equal(Object.hasOwn(wrapper, 'prototype'), false);
  assert.throws(() => Reflect.construct(wrapper, []), TypeError);
  assert.throws(() => Reflect.construct(function() {}, [], wrapper), TypeError);
  assert.equal(f.calls.high, 0);
  assert.equal((await Reflect.apply(wrapper, f.receiver, [[]])).platform, 'Selected OS');
  assert.equal(f.calls.high, 0, 'Custom does not enter the high-entropy backend');
  const sentinel = Error('caller iterator'); let reads = 0;
  await assert.rejects(Reflect.apply(wrapper, f.receiver, [new Proxy({}, { get() { reads++; throw sentinel; } })]), error => error === sentinel);
  assert.equal(reads, 1); assert.equal(f.calls.high, 0);
  f.guard.stop(); assert.deepEqual(Object.getOwnPropertyDescriptor(f.proto, 'getHighEntropyValues'), f.originals.get('getHighEntropyValues'));
  assert.equal((await Reflect.apply(wrapper, f.receiver, [[]])).platform, 'Native OS'); assert.equal(f.calls.high, 1);
});

test('FP-03: without a native UAData brand oracle the original preserves rejected errors and exact primitive receivers', async () => {
  const reason = new TypeError('Native invalid receiver');
  const f = methodFixture('NavigatorUAData', 'getHighEntropyValues', () => Promise.reject(reason));
  const guard = installApiCustom(f.realm, [{ id: 'client-hints', value: { brands: [], mobile: false, platform: 'Chosen' } }]);
  const wrapper = f.owner.getHighEntropyValues;
  assert.equal(wrapper, f.original); assert.ok(guard.snapshot().unavailable > 0);
  for (const receiver of [undefined, null, 0, '', Symbol('receiver'), {}]) {
    let returned;
    assert.doesNotThrow(() => { returned = Reflect.apply(wrapper, receiver, []); });
    await assert.rejects(returned, error => error === reason);
    assert.equal(f.calls.at(-1).receiver, receiver);
  }
  assert.equal(f.calls.length, 6);
  const beforeConstruct = f.calls.length;
  assert.throws(() => new wrapper([]), TypeError);
  assert.equal(f.calls.length, beforeConstruct);
  guard.stop();
});

test('FP-03: synchronous native exceptions and native rejection survive; own Promise.then is never read', async () => {
  const syncReason = new Error('Native synchronous failure');
  const sync = methodFixture('Bluetooth', 'getAvailability', () => { throw syncReason; });
  const selected = { available: false, devices: [] };
  const syncGuard = installApiCustom(sync.realm, [{ id: 'bluetooth', value: selected }]);
  assert.throws(() => sync.receiver.getAvailability(), error => error === syncReason);
  assert.equal(sync.calls.length, 1);
  syncGuard.stop();
  const reason = new Error('Native rejection'), rejected = Promise.reject(reason);
  let thenReads = 0;
  Object.defineProperty(rejected, 'then', { get() { thenReads++; throw Error('Own then read'); } });
  const async = methodFixture('Bluetooth', 'getAvailability', () => rejected);
  const asyncGuard = installApiCustom(async.realm, [{ id: 'bluetooth', value: selected }]);
  await assert.rejects(async.receiver.getAvailability(), error => error === reason);
  assert.equal(thenReads, 0);
  assert.equal(async.calls.length, 1);
  asyncGuard.stop();
});

test('FP-03: stop during settlement returns native value and never overwrites page-owned replacement', async () => {
  let resolve;
  const pending = new Promise(complete => { resolve = complete; });
  const f = methodFixture('MediaCapabilities', 'decodingInfo', () => pending);
  const guard = installApiCustom(f.realm, [{ id: 'media-capabilities', value: { supported: false, smooth: false, powerEfficient: false } }]);
  const retained = f.owner.decodingInfo, waiting = f.receiver.decodingInfo();
  const replacement = () => 'Page replacement';
  Object.defineProperty(f.owner, 'decodingInfo', { ...f.descriptor, value: replacement });
  guard.stop();
  const native = { supported: true, smooth: true, powerEfficient: true };
  resolve(native);
  assert.equal(await waiting, native);
  assert.equal(f.owner.decodingInfo, replacement);
  assert.equal(Reflect.apply(retained, f.receiver, []), pending);
  assert.equal(f.calls.length, 2);
  assert.throws(() => Reflect.construct(retained, []), TypeError);
});

test('FP-02/03: absent or immutable UAData surfaces remain absent/unchanged', () => {
  const empty = {}, absent = installApiCustom(empty, [{ id: 'client-hints', value: { brands: [], mobile: false, platform: 'Chosen' } }]);
  assert.deepEqual(Reflect.ownKeys(empty), []);
  assert.equal(absent.snapshot().installed, 0);
  function NavigatorUAData() {}
  const original = { operation() { return Promise.resolve({ platform: 'Native' }); } }.operation;
  Object.defineProperty(NavigatorUAData.prototype, 'getHighEntropyValues', { value: original, configurable: false });
  const guard = installApiCustom({ NavigatorUAData }, [{ id: 'client-hints', value: { brands: [], mobile: false, platform: 'Chosen' } }]);
  assert.equal(NavigatorUAData.prototype.getHighEntropyValues, original);
  assert.equal(Object.hasOwn(NavigatorUAData.prototype, 'brands'), false);
  assert.equal(guard.snapshot().installed, 0);
  guard.stop();
});

test('FP-03: installer serialization keeps non-constructability and strict receivers without module scope', async () => {
  const context = vm.createContext({});
  vm.runInContext(`
    globalThis.install = (${installApiCustom.toString()});
    globalThis.calls = [];
    globalThis.NavigatorUAData = function() {};
    NavigatorUAData.prototype.getHighEntropyValues = { getHighEntropyValues() {
      'use strict'; calls.push(this); return Promise.reject('native reason');
    } }.getHighEntropyValues;
    globalThis.guard = install(globalThis, [{id:'client-hints',value:{brands:[],mobile:false,platform:'Chosen'}}]);
    globalThis.saved = NavigatorUAData.prototype.getHighEntropyValues;
  `, context);
  const wrapper = vm.runInContext('saved', context);
  assert.throws(() => Reflect.construct(wrapper, []), { name: 'TypeError' });
  assert.equal(vm.runInContext('calls.length', context), 0);
  await assert.rejects(Reflect.apply(wrapper, undefined, []), error => error === 'native reason');
  assert.equal(vm.runInContext('calls[0]', context), undefined);
  vm.runInContext('guard.stop()', context);
});

function assertNonConstructor(operation, calls) {
  const before = calls.length;
  assert.throws(() => new operation(), TypeError);
  assert.equal(calls.length, before, 'new rejects before native invocation');
  assert.throws(() => Reflect.construct(operation, []), TypeError);
  assert.throws(() => Reflect.construct(function() {}, [], operation), TypeError);
  assert.equal(calls.length, before, 'Reflect.construct rejects before native invocation');
  assert.equal(Object.hasOwn(operation, 'prototype'), false);
}

test('FP-03 follow-up: scalar accessor is non-constructable before native brand validation and retains stop/ownership', () => {
  const calls = [], reason = new TypeError('Native getter receiver');
  function Navigator() {}
  const receiver = new Navigator();
  const original = { configurable: true, enumerable: true, set: undefined, get() {
    calls.push(this); if (this !== receiver) throw reason; return 8;
  } };
  Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', original);
  const guard = installApiCustom({ Navigator }, [{ id: 'hardware-concurrency', value: 16 }]);
  const get = Object.getOwnPropertyDescriptor(Navigator.prototype, 'hardwareConcurrency').get;
  assertNonConstructor(get, calls);
  assert.equal(Reflect.apply(get, receiver, []), 16);
  assert.equal(calls.length, 1);
  assert.throws(() => Reflect.apply(get, {} , []), error => error === reason);
  assert.equal(calls.length, 2);
  const replacement = () => 20;
  Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { ...original, get: replacement });
  guard.stop();
  assert.equal(Object.getOwnPropertyDescriptor(Navigator.prototype, 'hardwareConcurrency').get, replacement);
  assert.equal(Reflect.apply(get, receiver, []), 8);
  assert.equal(calls.length, 3);
  assertNonConstructor(get, calls);
});

test('FP-03 follow-up: data-property compatibility accessor is non-constructable', () => {
  const realm = {};
  Object.defineProperty(realm, 'devicePixelRatio', { value: 1, configurable: true, enumerable: true, writable: true });
  const original = Object.getOwnPropertyDescriptor(realm, 'devicePixelRatio');
  const guard = installApiCustom(realm, [{ id: 'window-device-pixel-ratio', value: 2 }]);
  const get = Object.getOwnPropertyDescriptor(realm, 'devicePixelRatio').get;
  assertNonConstructor(get, []);
  assert.equal(Reflect.apply(get, realm, []), 2);
  guard.stop();
  assert.deepEqual(Object.getOwnPropertyDescriptor(realm, 'devicePixelRatio'), original);
});

test('FP-03 follow-up: GPU native-result accessor never invokes native when used as a constructor', () => {
  const calls = [], reason = new TypeError('Native GPU receiver');
  class GPUAdapterInfo {}
  const native = new GPUAdapterInfo(), selected = { vendor: 'Chosen', architecture: 'arm', device: '1', description: 'Fixture' };
  for (const key of Object.keys(selected)) Object.defineProperty(GPUAdapterInfo.prototype, key, { configurable: true, get() { return 'Native'; } });
  class GPUAdapter {}
  const receiver = new GPUAdapter();
  const original = { configurable: true, enumerable: true, set: undefined, get() {
    calls.push(this); if (this !== receiver) throw reason; return native;
  } };
  Object.defineProperty(GPUAdapter.prototype, 'info', original);
  const guard = installApiCustom({ GPUAdapter, GPUAdapterInfo }, [{ id: 'webgpu', value: selected }]);
  const get = Object.getOwnPropertyDescriptor(GPUAdapter.prototype, 'info').get;
  assertNonConstructor(get, calls);
  assert.equal(Reflect.apply(get, receiver, []), native);
  assert.equal(native.vendor, selected.vendor);
  assert.equal(calls.length, 1);
  assert.throws(() => Reflect.apply(get, {}, []), error => error === reason);
  assert.equal(calls.length, 2);
  guard.stop();
  assert.deepEqual(Object.getOwnPropertyDescriptor(GPUAdapter.prototype, 'info'), original);
  assert.equal(Reflect.apply(get, receiver, []), native);
  assert.equal(native.vendor, 'Native');
  assert.equal(calls.length, 3);
});

function mediaFixture() {
  const calls = [], values = new WeakMap(), reason = new TypeError('Native media receiver');
  class MediaDeviceInfo {
    constructor() { values.set(this, { deviceId: 'native-device', groupId: 'native-group', kind: 'audioinput', label: 'Native microphone' }); }
  }
  for (const key of ['deviceId', 'groupId', 'kind', 'label']) Object.defineProperty(MediaDeviceInfo.prototype, key, { configurable: true, get() {
    calls.push({ key, receiver: this }); if (!values.has(this)) throw reason; return values.get(this)[key];
  } });
  Object.defineProperty(MediaDeviceInfo.prototype, 'toJSON', { configurable: true, writable: true, value: { toJSON() {
    'use strict'; calls.push({ key: 'toJSON', receiver: this, args: Array.from(arguments) });
    if (!values.has(this)) throw reason; return { ...values.get(this) };
  } }.toJSON });
  class InputDeviceInfo extends MediaDeviceInfo {
    getCapabilities() {
      calls.push({ key: 'getCapabilities', receiver: this, args: Array.from(arguments) });
      if (!values.has(this)) throw reason;
      return { deviceId: values.get(this).deviceId, groupId: values.get(this).groupId, sampleRate: { min: 8000, max: 48000 } };
    }
  }
  const device = new InputDeviceInfo();
  class MediaDevices { enumerateDevices() { return Promise.resolve([device]); } }
  const selected = [
    { deviceId: 'selected-device', groupId: 'selected-group', kind: 'audioinput', label: 'Selected microphone' },
    { deviceId: 'metadata-only-camera', groupId: '', kind: 'videoinput', label: 'Metadata-only camera' }
  ];
  const realm = { Object, Array, Promise, MediaDeviceInfo, InputDeviceInfo, MediaDevices };
  const original = Object.getOwnPropertyDescriptors(MediaDeviceInfo.prototype);
  const guard = installApiCustom(realm, [{ id: 'media-enumeration', value: selected }]);
  return { calls, reason, realm, device, selected, original, guard };
}

test('FP-03 follow-up: media getters, toJSON and getCapabilities reject construction without calling original', async () => {
  const f = mediaFixture();
  const [device] = await new f.realm.MediaDevices().enumerateDevices();
  assert.equal(device, f.device);
  // Pre-permission recognition (E2) reads one native label and stops at the first non-empty one; the by-kind overlay (ADR-107)
  // then reads each native kind through the captured getter. Nothing else runs.
  const enumerated = f.calls.length;
  assert.deepEqual(f.calls.map(call => call.key), ['label', 'kind']);
  const operations = [
    ...['deviceId', 'groupId', 'kind', 'label'].map(key => Object.getOwnPropertyDescriptor(f.realm.MediaDeviceInfo.prototype, key).get),
    device.toJSON, device.getCapabilities
  ];
  for (const operation of operations) assertNonConstructor(operation, f.calls);
  assert.equal(f.calls.length, enumerated);
  assert.equal(device.deviceId, 'selected-device');
  assert.equal(f.calls.length, enumerated + 1);
  let pageReads = 0;
  const opaque = new Proxy({}, { get() { pageReads++; throw Error('Page argument inspected'); } });
  assert.deepEqual(Reflect.apply(device.toJSON, device, [opaque]), f.selected[0]);
  assert.equal(f.calls.at(-1).receiver, device); assert.equal(f.calls.at(-1).args[0], opaque);
  assert.deepEqual(Reflect.apply(device.getCapabilities, device, [opaque]), { deviceId: 'selected-device', groupId: 'selected-group', sampleRate: { min: 8000, max: 48000 } });
  assert.equal(f.calls.at(-1).receiver, device); assert.equal(f.calls.at(-1).args[0], opaque);
  assert.equal(f.calls.length, enumerated + 3);
  assert.equal(pageReads, 0);
  for (const operation of operations) {
    const before = f.calls.length;
    assert.throws(() => Reflect.apply(operation, {}, []), error => error === f.reason);
    assert.equal(f.calls.length, before + 1);
  }
  const retainedJSON = device.toJSON, retainedCapabilities = device.getCapabilities, retainedGetter = operations[0];
  f.guard.stop();
  assert.deepEqual(Object.getOwnPropertyDescriptor(f.realm.MediaDeviceInfo.prototype, 'toJSON'), f.original.toJSON);
  assert.equal(Reflect.apply(retainedGetter, device, []), 'native-device');
  assert.equal(Reflect.apply(retainedJSON, device, []).deviceId, 'native-device');
  assert.equal(Reflect.apply(retainedCapabilities, device, []).deviceId, 'native-device');
});

test('FP-03 follow-up (ADR-107): a row without a native device of its kind creates no metadata-only record', async () => {
  const f = mediaFixture();
  const devices = await new f.realm.MediaDevices().enumerateDevices();
  assert.equal(devices.length, 1); assert.equal(devices[0], f.device);
  assert.deepEqual(devices[0].toJSON(), f.selected[0]);
  assert.equal(JSON.stringify(devices.map(device => device.toJSON())).includes('metadata-only-camera'), false);
  assert.deepEqual(f.calls.map(call => call.key).slice(0, 2), ['label', 'kind'], 'the pre-permission label read (E2), then the native kind');
  f.guard.stop();
});

test('FP-03 follow-up: serialized scalar getter preserves primitive receivers without ambient strict mode', () => {
  const context = vm.createContext({});
  vm.runInContext(`
    globalThis.install = (${installApiCustom.toString()});
    globalThis.calls = [];
    globalThis.Navigator = function() {};
    Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { configurable: true, get: { read() {
      'use strict'; calls.push(this); return 8;
    } }.read });
    globalThis.guard = install(globalThis, [{id:'hardware-concurrency',value:16}]);
    globalThis.saved = Object.getOwnPropertyDescriptor(Navigator.prototype, 'hardwareConcurrency').get;
  `, context);
  const getter = vm.runInContext('saved', context);
  assert.throws(() => Reflect.construct(getter, []), { name: 'TypeError' });
  assert.equal(vm.runInContext('calls.length', context), 0);
  assert.equal(Reflect.apply(getter, undefined, []), 16);
  assert.equal(vm.runInContext('calls[0]', context), undefined);
  assert.equal(Reflect.apply(getter, null, []), 16);
  assert.equal(vm.runInContext('calls[1]', context), null);
  vm.runInContext('guard.stop()', context);
});
