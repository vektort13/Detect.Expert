// ADR-048: Custom-mode semantics, privacy, ownership, and native-browser coverage.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { installApiCustom } from '../../apps/production-extension/api-custom-runtime.js';
import { installWebRtcCustom } from '../../apps/production-extension/api-custom-webrtc-runtime.js';
import { installMathCustom } from '../../apps/production-extension/api-custom-math-runtime.js';
import { installCanvasCustom } from '../../apps/production-extension/api-custom-canvas-runtime.js';
import { installApiCustomEnvironment } from '../../apps/production-extension/api-custom-environment-runtime.js';
import { installIntlCustom } from '../../apps/production-extension/api-custom-intl-runtime.js';
import { installSurfaceCustom } from '../../apps/production-extension/api-custom-surfaces-runtime.js';
import { installGeolocationCustom } from '../../apps/production-extension/api-custom-geolocation-runtime.js';
import { API_CONFIG_CATALOG } from '../../packages/contracts/src/api-configuration.mjs';
import { ADVERSARIAL_CUSTOM_ENTRIES, nativeCustomAdversarialProbe } from './api-custom-adversarial-fixture.mjs';

const scalar = [
  ['hardware-concurrency', 'Navigator', 'hardwareConcurrency', 16],
  ['device-memory', 'Navigator', 'deviceMemory', 8],
  ['touch-points', 'Navigator', 'maxTouchPoints', 5],
  ['navigator-platform', 'Navigator', 'platform', 'Linux x86_64'],
  ['navigator-user-agent', 'Navigator', 'userAgent', 'Test Browser'],
  ['navigator-app-version', 'Navigator', 'appVersion', '5.0 Test'],
  ['navigator-vendor', 'Navigator', 'vendor', ''],
  ['navigator-oscpu', 'Navigator', 'oscpu', 'Linux x86_64'],
  ['navigator-language', 'Navigator', 'language', 'ru-RU'],
  ['navigator-languages', 'Navigator', 'languages', ['ru-RU', 'en-US']],
  ['screen-width', 'Screen', 'width', 1920], ['screen-height', 'Screen', 'height', 1080],
  ['screen-avail-width', 'Screen', 'availWidth', 1920], ['screen-avail-height', 'Screen', 'availHeight', 1040],
  ['screen-color-depth', 'Screen', 'colorDepth', 24], ['screen-pixel-depth', 'Screen', 'pixelDepth', 24],
  ['window-device-pixel-ratio', null, 'devicePixelRatio', 2], ['screen-extended', 'Screen', 'isExtended', false]
];
function accessorFixture(name, key, nativeValue = 'native') {
  const constructor = function () {}, realm = name ? { [name]: constructor } : {};
  const target = name ? constructor.prototype : realm, receiver = name ? new constructor() : realm;
  let calls = 0;
  const error = new TypeError('Illegal invocation');
  const original = { configurable: true, enumerable: true, get() { calls++; if (this !== receiver) throw error; return nativeValue; }, set: undefined };
  Object.defineProperty(target, key, original);
  return { realm, target, receiver, original, error, calls: () => calls };
}
for (const [id, name, key, value] of scalar) test(`${id}: native brand/error, exact restoration and retained getter bypass`, () => {
  const fixture = accessorFixture(name, key), guard = installApiCustom(fixture.realm, [{ id, value }]);
  const wrapper = Object.getOwnPropertyDescriptor(fixture.target, key).get;
  assert.equal(fixture.calls(), 0, 'installation never samples hardware');
  assert.deepEqual(fixture.receiver[key], value);
  assert.equal(fixture.calls(), 1, 'native getter runs once');
  assert.throws(() => Reflect.apply(wrapper, {}, []), error => error === fixture.error);
  assert.equal(fixture.calls(), 2);
  assert.equal(guard.snapshot().installed, 1);
  guard.stop(); guard.stop();
  assert.deepEqual(Object.getOwnPropertyDescriptor(fixture.target, key), fixture.original);
  assert.equal(Reflect.apply(wrapper, fixture.receiver, []), 'native');
  assert.equal(fixture.calls(), 3);
});
test('On hides metadata without getter reads; Off/Bypass leave native descriptors intact', () => {
  for (const mode of ['on', 'off', 'bypass']) {
    const fixture = accessorFixture('Navigator', 'platform');
    const guard = installApiCustom(fixture.realm, [{ id: 'navigator-platform', value: 'test', mode }]);
    assert.equal(fixture.calls(), 0);
    assert.equal(Object.hasOwn(fixture.target, 'platform'), mode !== 'on');
    guard.stop(); assert.deepEqual(Object.getOwnPropertyDescriptor(fixture.target, 'platform'), fixture.original);
  }
});
test('preserves page replacement; absent and non-configurable properties are unavailable', () => {
  const fixture = accessorFixture('Navigator', 'hardwareConcurrency');
  const guard = installApiCustom(fixture.realm, [{ id: 'hardware-concurrency', value: 16 }]);
  Object.defineProperty(fixture.target, 'hardwareConcurrency', { value: 'page', configurable: true });
  guard.stop(); assert.equal(fixture.target.hardwareConcurrency, 'page');
  const empty = {}, unavailable = installApiCustom(empty, scalar.map(([id, , , value]) => ({ id, value })));
  assert.deepEqual(empty, {}); assert.equal(unavailable.snapshot().installed, 0);
  assert.equal(unavailable.snapshot().unavailable, scalar.length);
  Object.defineProperty(fixture.target, 'hardwareConcurrency', { value: 8, configurable: false });
  assert.equal(installApiCustom(fixture.realm, [{ id: 'hardware-concurrency', value: 16 }]).snapshot().unavailable, 1);
  assert.equal(fixture.target.hardwareConcurrency, 8);
});
test('empty string, false, zero and undefined are preserved; frozen custom arrays cannot corrupt saved values', () => {
  const fixture = accessorFixture('Navigator', 'languages');
  const value = ['en-US'], guard = installApiCustom(fixture.realm, [{ id: 'navigator-languages', value }]);
  value[0] = 'mutated caller';
  assert.deepEqual(fixture.receiver.languages, ['en-US']);
  assert.throws(() => fixture.receiver.languages.push('mutated page'), TypeError);
  guard.stop();
  for (const custom of ['', false, 0, undefined]) {
    const single = accessorFixture('Navigator', 'platform');
    const one = installApiCustom(single.realm, [{ id: 'navigator-platform', value: custom }]);
    assert.equal(single.receiver.platform, custom); one.stop();
  }
});
function methodFixture(name, key, nativeResult, asynchronous = true) {
  const constructor = function () {}, receiver = new constructor(), target = constructor.prototype;
  const realm = { Object, Array, Promise, [name]: constructor }, calls = [], error = new TypeError('Illegal invocation');
  function native() { calls.push({ receiver: this, args: Array.from(arguments) }); if (this !== receiver) throw error; return nativeResult; }
  const original = { value: native, writable: true, enumerable: true, configurable: true };
  Object.defineProperty(target, key, original);
  return { realm, receiver, target, calls, original, error, asynchronous };
}
const asynchronousMethods = [
  // ADR-085 StorageEstimate is virtual; its zero-quota-call contract has separate adversarial fixtures.
  ['media-capabilities', 'MediaCapabilities', 'decodingInfo', { supported: false, smooth: false, powerEfficient: false }, { supported: true, smooth: true, powerEfficient: true, keySystemAccess: { native: true }, configuration: {} }, { supported: false, smooth: false, powerEfficient: false, keySystemAccess: { native: true }, configuration: {} }],
  ['usb', 'USB', 'getDevices', [], [{ native: true }], []],
  ['hid', 'HID', 'getDevices', [], [{ native: true }], []],
  ['serial', 'Serial', 'getPorts', [], [{ native: true }], []],
  ['bluetooth', 'Bluetooth', 'getDevices', { available: false, devices: [] }, [{ native: true }], []],
  ['bluetooth', 'Bluetooth', 'getAvailability', { available: false, devices: [] }, true, false],
  ['webgpu', 'GPU', 'requestAdapter', null, { native: true }, null]
];
for (const [id, name, key, value, nativeValue, expected] of asynchronousMethods) test(`${id}.${key}: one native invocation, unchanged args, rejection, pending-stop and Promise bypass`, async () => {
  const originalResult = Promise.resolve(structuredClone(nativeValue));
  const fixture = methodFixture(name, key, originalResult);
  const guard = installApiCustom(fixture.realm, [{ id, value }]), wrapper = fixture.target[key];
  const hostile = new Proxy({}, { get() { throw new Error('page getter read'); }, ownKeys() { throw new Error('page keys read'); } });
  const transformed = Reflect.apply(wrapper, fixture.receiver, [hostile]);
  assert.notEqual(transformed, originalResult);
  assert.deepEqual(await transformed, expected);
  assert.equal(fixture.calls.length, 1); assert.equal(fixture.calls[0].receiver, fixture.receiver);
  assert.equal(fixture.calls[0].args[0], hostile);
  assert.throws(() => Reflect.apply(wrapper, {}, [hostile]), error => error === fixture.error);
  guard.stop(); assert.deepEqual(Object.getOwnPropertyDescriptor(fixture.target, key), fixture.original);
  assert.equal(Reflect.apply(wrapper, fixture.receiver, [hostile]), originalResult);
  let fulfill;
  const pending = new Promise(resolve => { fulfill = resolve; }), second = methodFixture(name, key, pending);
  const secondGuard = installApiCustom(second.realm, [{ id, value }]);
  const awaiting = Reflect.apply(second.target[key], second.receiver, []);
  secondGuard.stop(); fulfill(nativeValue); assert.equal(await awaiting, nativeValue);
  const error = new Error('native rejection'), rejected = methodFixture(name, key, Promise.reject(error));
  const rejectedGuard = installApiCustom(rejected.realm, [{ id, value }]);
  await assert.rejects(Reflect.apply(rejected.target[key], rejected.receiver, []), actual => actual === error);
  rejectedGuard.stop();
});
test('WebGL overrides only primitive metadata enums, preserves errors and never reads argument objects', () => {
  const fixture = methodFixture('WebGLRenderingContext', 'getParameter', 'native', false);
  const value = { vendor: 'Vendor', renderer: 'Renderer', unmaskedVendor: 'Unmasked Vendor', unmaskedRenderer: 'Unmasked Renderer' };
  const guard = installApiCustom(fixture.realm, [{ id: 'webgl', value }]);
  const wrapper = fixture.target.getParameter, hostile = new Proxy({}, { get() { throw new Error('coercion'); } });
  for (const [parameter, expected] of [[7936, value.vendor], [7937, value.renderer], [37445, value.unmaskedVendor], [37446, value.unmaskedRenderer], ['37446', value.unmaskedRenderer], [2 ** 32 + 7936, value.vendor], [7937.9, value.renderer], [3379, 'native'], [hostile, undefined]]) {
    const before = fixture.calls.length;
    assert.equal(Reflect.apply(wrapper, fixture.receiver, [parameter]), expected);
    assert.equal(fixture.calls.length, before + 1);
  }
  guard.stop(); assert.equal(Reflect.apply(wrapper, fixture.receiver, [7936]), 'native');
  const unsupported = methodFixture('WebGLRenderingContext', 'getParameter', null, false);
  const unavailable = installApiCustom(unsupported.realm, [{ id: 'webgl', value }]);
  assert.equal(unsupported.receiver.getParameter(37445), null, 'unenabled debug extension remains unavailable');
  unavailable.stop();
});
test('all 56 catalog Custom APIs leave an empty realm unchanged and explicitly unavailable', () => {
  const supported = API_CONFIG_CATALOG.filter(entry => entry.customSupported);
  assert.equal(supported.length, 56);
  for (const entry of supported) {
    const realm = {}, selected = entry.presets[0].value;
    const installer = entry.id === 'webrtc' ? installWebRtcCustom : entry.id === 'math-transcendentals' ? installMathCustom : entry.id === 'canvas-readback' ? installCanvasCustom : entry.id === 'geolocation' ? installGeolocationCustom : entry.id === 'intl-formatting' ? installIntlCustom :
      ['navigator-metadata', 'navigator-plugins', 'screen-geometry', 'css-media', 'css-supports'].includes(entry.id) ? installApiCustomEnvironment :
      ['webgl-capabilities', 'webgpu-capabilities', 'canvas-text-metrics', 'audio-fingerprint', 'audio-metadata', 'clock-precision', 'canvas-font-policy', 'browser-surface', 'webgl-readback'].includes(entry.id) ? installSurfaceCustom : installApiCustom;
    const guard = installer(realm, [{ id: entry.id, mode: 'custom', value: selected.kind === 'value' ? selected.value : null,
      ...(entry.id === 'math-transcendentals' ? { mathSeed: '01'.repeat(32) } : {}), ...(entry.id === 'canvas-readback' ? { canvasSeed: '02'.repeat(32) } : {}) }]);
    assert.deepEqual(realm, {}, entry.id); assert.equal(guard.snapshot().installed, 0, entry.id);
    assert.ok(guard.snapshot().unavailable > 0, entry.id);
    if (['math-transcendentals', 'canvas-readback'].includes(entry.id)) assert.deepEqual(Object.keys(guard), ['snapshot'], entry.id + ' has no public stop/restore capability');
    else guard.stop();
  }
});
for (const [id, name, key, value, expected] of [
  ['autoplay-policy', 'Navigator', 'getAutoplayPolicy', 'disallowed', 'disallowed'],
  ['gamepads', 'Navigator', 'getGamepads', [], []],
  ['speech-voices', 'SpeechSynthesis', 'getVoices', [], []]
]) test(`${id}: native sync semantics and retained method bypass`, () => {
  const fixture = methodFixture(name, key, 'native', false);
  const guard = installApiCustom(fixture.realm, [{ id, value }]), wrapper = fixture.target[key];
  const hostile = new Proxy({}, { get() { throw new Error('page input'); } });
  assert.deepEqual(Reflect.apply(wrapper, fixture.receiver, [hostile]), expected);
  assert.equal(fixture.calls.length, 1); assert.equal(fixture.calls[0].args[0], hostile);
  assert.throws(() => Reflect.apply(wrapper, {}, []), error => error === fixture.error);
  guard.stop(); assert.equal(Reflect.apply(wrapper, fixture.receiver, []), 'native');
});
test('notification Custom changes permission metadata only and retains native permission request', () => {
  function Notification() {}
  const originalRequest = Notification.requestPermission = () => Promise.resolve('native permission');
  Object.defineProperty(Notification, 'permission', { get() { return 'default'; }, configurable: true });
  const original = Object.getOwnPropertyDescriptor(Notification, 'permission');
  const guard = installApiCustom({ Notification }, [{ id: 'notifications', value: 'denied' }]);
  assert.equal(Notification.permission, 'denied'); assert.equal(Notification.requestPermission, originalRequest);
  guard.stop(); assert.deepEqual(Object.getOwnPropertyDescriptor(Notification, 'permission'), original);
});
test('battery null time represents native Infinity without synthesizing battery instances', () => {
  const fixture = accessorFixture('BatteryManager', 'dischargingTime', 10);
  const guard = installApiCustom(fixture.realm, [{ id: 'battery', value: { dischargingTime: null } }]);
  assert.equal(fixture.calls(), 0); assert.equal(fixture.receiver.dischargingTime, Infinity);
  guard.stop(); assert.equal(fixture.receiver.dischargingTime, 10);
});
test('Custom network metadata withholds omitted connection type and maximum downlink', () => {
  function NetworkInformation() {}
  const connection = new NetworkInformation();
  Object.defineProperty(NetworkInformation.prototype, 'type', { get() { if (this !== connection) throw new TypeError(); return 'native type'; }, configurable: true });
  Object.defineProperty(NetworkInformation.prototype, 'downlinkMax', { get() { if (this !== connection) throw new TypeError(); return 12345; }, configurable: true });
  const guard = installApiCustom({ NetworkInformation }, [{ id: 'network-information', value: { downlink: 10, effectiveType: '4g', rtt: 50, saveData: false } }]);
  assert.equal(connection.type, ''); assert.equal(connection.downlinkMax, 0);
  assert.equal(Reflect.apply(Object.getOwnPropertyDescriptor(NetworkInformation.prototype, 'type').get, connection, []), '');
  guard.stop(); assert.equal(connection.type, 'native type'); assert.equal(connection.downlinkMax, 12345);
});
test('screen orientation, network and GPU metadata getters preserve brand checks', () => {
  for (const [id, name, key, value, expected] of [
    ['screen-orientation', 'ScreenOrientation', 'angle', { type: 'landscape-primary', angle: 90 }, 90],
    ['network-information', 'NetworkInformation', 'saveData', { saveData: false }, false],
    ['webgpu', 'GPUAdapterInfo', 'vendor', { vendor: 'test vendor' }, 'test vendor']
  ]) {
    const fixture = accessorFixture(name, key), guard = installApiCustom(fixture.realm, [{ id, value }]);
    assert.equal(fixture.receiver[key], expected);
    const wrapper = Object.getOwnPropertyDescriptor(fixture.target, key).get;
    assert.throws(() => Reflect.apply(wrapper, {}, []), error => error === fixture.error);
    guard.stop(); assert.equal(fixture.receiver[key], 'native');
  }
});
test('WebGPU covers native info getters, private info prototypes, device adapterInfo and legacy Promise records', async () => {
  for (const path of ['info', 'device', 'legacy']) {
    function GPUAdapter() {}
    function GPUDevice() {}
    function PrivateInfo() {}
    const adapter = new GPUAdapter(), device = new GPUDevice(), info = new PrivateInfo();
    const value = { vendor: 'custom vendor', architecture: 'custom architecture', device: 'custom device', description: 'custom description' };
    for (const key of Object.keys(value)) Object.defineProperty(PrivateInfo.prototype, key, { get() { if (this !== info) throw new TypeError('Illegal invocation'); return 'native ' + key; }, configurable: true });
    Object.defineProperty(GPUAdapter.prototype, 'info', { get() { if (this !== adapter) throw new TypeError('Illegal invocation'); return info; }, configurable: true });
    Object.defineProperty(GPUDevice.prototype, 'adapterInfo', { get() { if (this !== device) throw new TypeError('Illegal invocation'); return info; }, configurable: true });
    const nativePromise = Promise.resolve(info);
    Object.defineProperty(GPUAdapter.prototype, 'requestAdapterInfo', { value() { if (this !== adapter) throw new TypeError('Illegal invocation'); return nativePromise; }, configurable: true });
    const guard = installApiCustom({ Object, Array, Promise, GPUAdapter, GPUDevice }, [{ id: 'webgpu', value }]);
    const result = path === 'info' ? adapter.info : path === 'device' ? device.adapterInfo : await adapter.requestAdapterInfo();
    assert.equal(result, info, path + ': retain native metadata object identity');
    for (const key of Object.keys(value)) {
      assert.equal(result[key], value[key]);
      const getter = Object.getOwnPropertyDescriptor(PrivateInfo.prototype, key).get;
      assert.equal(Reflect.apply(getter, info, []), value[key]);
      assert.throws(() => Reflect.apply(getter, {}, []), TypeError);
    }
    guard.stop();
    assert.equal(info.vendor, 'native vendor');
  }
  function GPUAdapter() {}
  const nativeInfo = Object.freeze({ vendor: 'native vendor', architecture: 'native architecture', device: 'native device', description: 'native description' });
  Object.defineProperty(GPUAdapter.prototype, 'info', { get() { return nativeInfo; }, configurable: true });
  const selected = { vendor: 'custom vendor', architecture: '', device: '', description: '' };
  const guard = installApiCustom({ GPUAdapter }, [{ id: 'webgpu', value: selected }]);
  assert.deepEqual(new GPUAdapter().info, selected, 'unpatchable native records return only the selected metadata');
  guard.stop(); assert.equal(new GPUAdapter().info, nativeInfo);
});
test('UA client hints snapshot only requested selected/neutral highs without a native high-entropy operation', async () => {
  function NavigatorUAData() {}
  const receiver = new NavigatorUAData(), realm = { Object, Array, Promise, NavigatorUAData }, proto = NavigatorUAData.prototype;
  for (const [key, native] of Object.entries({ brands: [], mobile: false, platform: 'native' })) Object.defineProperty(proto, key, { get() { if (this !== receiver) throw new TypeError(); return native; }, configurable: true });
  let nativeCalls = 0;
  Object.defineProperty(proto, 'getHighEntropyValues', { value() { nativeCalls++; return Promise.resolve({ platform: 'native', architecture: 'native', bitness: 'native', platformVersion: 'native', fullVersionList: [{ brand: 'native', version: 'native' }], formFactors: ['Desktop'], wow64: true, futureNativeField: 'native' }); }, configurable: true });
  const value = { brands: [{ brand: 'Test', version: '1' }], mobile: true, platform: 'test', architecture: 'arm', model: 'never requested' };
  const guard = installApiCustom(realm, [{ id: 'client-hints', value }]);
  assert.deepEqual(receiver.brands, value.brands); assert.equal(receiver.platform, 'test');
  assert.deepEqual(await receiver.getHighEntropyValues(['architecture', 'bitness', 'platformVersion', 'fullVersionList', 'formFactors', 'wow64']), { brands: value.brands, mobile: true, platform: 'test', architecture: 'arm', bitness: '', platformVersion: '', fullVersionList: [], formFactors: [], wow64: false });
  const sentinel = new Error('read hints');
  await assert.rejects(receiver.getHighEntropyValues(new Proxy({}, { get() { throw sentinel; } })), error => error === sentinel);
  assert.equal(nativeCalls, 0);
  const exposedBrands = receiver.brands;
  assert.equal(Object.isFrozen(exposedBrands), true);
  assert.equal(Reflect.set(exposedBrands[0], 'brand', 'page changed'), true);
  assert.deepEqual(receiver.brands, value.brands);
  guard.stop(); assert.equal(receiver.platform, 'native');
  assert.equal((await receiver.getHighEntropyValues([])).architecture, 'native'); assert.equal(nativeCalls, 1);
});
test('media descriptors retain the native prototype; a row without a native device of its kind is dropped, never created', async () => {
  function MediaDeviceInfo() {}
  const originalDevice = new MediaDeviceInfo();
  for (const [key, native] of Object.entries({ kind: 'audioinput', deviceId: 'native-id', groupId: 'native-group', label: 'native label' })) Object.defineProperty(MediaDeviceInfo.prototype, key, { get() { if (this !== originalDevice) throw new TypeError(); return native; }, configurable: true });
  MediaDeviceInfo.prototype.toJSON = function () { if (this !== originalDevice) throw new TypeError(); return { label: 'native label' }; };
  MediaDeviceInfo.prototype.getCapabilities = function () { if (this !== originalDevice) throw new TypeError(); return { deviceId: 'native-id', groupId: 'native-group', width: { min: 1, max: 9999 } }; };
  const fixture = methodFixture('MediaDevices', 'enumerateDevices', Promise.resolve([originalDevice]));
  // The interface is a global in every browser: its captured native kind getter decides which row may sit on a device.
  fixture.realm.MediaDeviceInfo = MediaDeviceInfo;
  const value = [{ kind: 'audioinput', deviceId: 'test-id', groupId: '', label: 'Test Microphone' }, { kind: 'videoinput', deviceId: 'test-camera', groupId: '', label: 'Test Camera' }];
  const guard = installApiCustom(fixture.realm, [{ id: 'media-enumeration', value }]);
  const devices = await fixture.receiver.enumerateDevices();
  assert.equal(devices[0], originalDevice); assert.equal(Object.getPrototypeOf(devices[0]), MediaDeviceInfo.prototype);
  assert.equal(devices.length, 1, 'one native microphone: the camera row has no camera (ADR-107)');
  assert.deepEqual(devices.map(device => device.toJSON()), [value[0]]);
  for (const key of ['deviceId', 'label', 'groupId', 'kind']) {
    const borrowed = Object.getOwnPropertyDescriptor(MediaDeviceInfo.prototype, key).get;
    assert.equal(Reflect.apply(borrowed, devices[0], []), value[0][key], 'borrowed prototype getter must not bypass Custom: ' + key);
  }
  assert.deepEqual(Reflect.apply(MediaDeviceInfo.prototype.toJSON, devices[0], []), value[0], 'borrowed prototype toJSON must not expose native slots');
  assert.deepEqual(devices[0].getCapabilities(), { deviceId: value[0].deviceId, groupId: value[0].groupId, width: { min: 1, max: 9999 } });
  assert.deepEqual(Reflect.apply(MediaDeviceInfo.prototype.getCapabilities, devices[0], []), { deviceId: value[0].deviceId, groupId: value[0].groupId, width: { min: 1, max: 9999 } });
  assert.throws(() => Reflect.apply(MediaDeviceInfo.prototype.getCapabilities, {}, []), TypeError);
  assert.throws(() => Reflect.apply(devices[0].toJSON, {}, []), TypeError, 'native MediaDeviceInfo.toJSON brand check remains active');
  const retained = Object.getOwnPropertyDescriptor(MediaDeviceInfo.prototype, 'label').get;
  guard.stop(); assert.equal(originalDevice.label, 'native label');
  assert.equal(Reflect.apply(retained, originalDevice, []), 'native label');
  assert.deepEqual(originalDevice.toJSON(), { label: 'native label' });
  assert.deepEqual(originalDevice.getCapabilities(), { deviceId: 'native-id', groupId: 'native-group', width: { min: 1, max: 9999 } });
});
test('timezone preserves invalid Date and errors; On has no destructive date hooks', () => {
  const realm = vm.runInNewContext('({Date, Intl})');
  const original = Object.getOwnPropertyDescriptor(realm.Date.prototype, 'getTimezoneOffset');
  const value = { timeZone: 'Asia/Dubai', offsetMinutes: -240 };
  const guard = installApiCustom(realm, [{ id: 'timezone', value }]);
  assert.equal(new realm.Date(0).getTimezoneOffset(), -240);
  assert.ok(Number.isNaN(new realm.Date(NaN).getTimezoneOffset()));
  assert.equal(new realm.Intl.DateTimeFormat().resolvedOptions().timeZone, 'Asia/Dubai');
  const explicit = new realm.Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', hourCycle: 'h23' });
  assert.equal(explicit.resolvedOptions().timeZone, 'Asia/Dubai', 'Custom affects all resolvedOptions metadata, including explicit formatter zones');
  assert.equal(explicit.format(new realm.Date(0)), '00', 'the explicit UTC formatter keeps its native formatting engine');
  assert.throws(() => Reflect.apply(realm.Date.prototype.getTimezoneOffset, {}, []), { name: 'TypeError' });
  guard.stop(); assert.deepEqual(Object.getOwnPropertyDescriptor(realm.Date.prototype, 'getTimezoneOffset'), original);
  const on = installApiCustom(realm, [{ id: 'timezone', mode: 'on', value }]);
  assert.equal(on.snapshot().installed, 0); assert.equal(on.snapshot().unavailable, 1);
  assert.deepEqual(Object.getOwnPropertyDescriptor(realm.Date.prototype, 'getTimezoneOffset'), original);
});
test('installer has no module dependencies and captured intrinsics resist later page mutation', () => {
  const context = vm.createContext({});
  vm.runInContext(`globalThis.install = (${installApiCustom.toString()}); globalThis.Navigator = function Navigator() {}; Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {get() {return 8}, configurable:true}); globalThis.guard=install(globalThis,[{id:'hardware-concurrency',value:16}]);`, context);
  vm.runInContext('Object.defineProperty=()=>{throw Error("poisoned")}; Object.getOwnPropertyDescriptor=()=>{throw Error("poisoned")}; Reflect.apply=()=>{throw Error("poisoned")}; Array.prototype.push=()=>{throw Error("poisoned")};', context);
  assert.equal(vm.runInContext('(new Navigator()).hardwareConcurrency', context), 16);
  assert.equal(vm.runInContext('guard.snapshot().installed', context), 1);
  vm.runInContext('guard.stop()', context);
  assert.equal(vm.runInContext('(new Navigator()).hardwareConcurrency', context), 8);
});
test('native Chromium: hardware, screen, performance, locale, battery, UAData, lifecycle and no synthetic absent API', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://custom-api.invalid/', route => route.fulfill({ body: '<!doctype html><title>Custom API fixture</title>', contentType: 'text/html' }));
    await page.goto('https://custom-api.invalid/');
    await page.evaluate(`globalThis.customInstaller = (${installApiCustom.toString()})`);
    const result = await page.evaluate(async () => {
      const original = Object.getOwnPropertyDescriptor(Navigator.prototype, 'hardwareConcurrency');
      const native = navigator.hardwareConcurrency, oscpuPresent = 'oscpu' in navigator;
      const memory = { jsHeapSizeLimit: 100000000, totalJSHeapSize: 20000000, usedJSHeapSize: 10000000 };
      const guard = globalThis.customInstaller(globalThis, [
        { id: 'hardware-concurrency', value: 16 }, { id: 'navigator-platform', value: 'Custom Platform' },
        { id: 'navigator-oscpu', value: 'Custom OS' }, { id: 'screen-width', value: 1920 },
        { id: 'screen-orientation', value: { type: 'landscape-primary', angle: 90 } },
        { id: 'window-device-pixel-ratio', value: 2 }, { id: 'performance-memory', value: memory },
        { id: 'navigator-languages', value: ['ru-RU', 'en-US'] },
        { id: 'battery', value: { charging: true, chargingTime: 0, dischargingTime: null, level: 0.5 } },
        { id: 'client-hints', value: { brands: [{ brand: 'Test', version: '1' }], mobile: false, platform: 'Test OS', architecture: 'arm' } }
      ]);
      const retained = Object.getOwnPropertyDescriptor(Navigator.prototype, 'hardwareConcurrency').get;
      let illegal = false;
      try { Reflect.apply(retained, {}, []); } catch (error) { illegal = error instanceof TypeError; }
      const custom = navigator.hardwareConcurrency === 16 && navigator.platform === 'Custom Platform' &&
        screen.width === 1920 && screen.orientation.angle === 90 && devicePixelRatio === 2 &&
        performance.memory.usedJSHeapSize === memory.usedJSHeapSize && navigator.languages[0] === 'ru-RU';
      const battery = await navigator.getBattery();
      const batteryMatches = battery.level === 0.5 && battery.dischargingTime === Infinity;
      const ua = await navigator.userAgentData.getHighEntropyValues(['architecture']);
      const uaMatches = ua.architecture === 'arm' && navigator.userAgentData.platform === 'Test OS';
      const uaJSONMatches = navigator.userAgentData.toJSON().platform === 'Test OS';
      const noAbsentAPI = oscpuPresent || !('oscpu' in navigator);
      guard.stop();
      const restored = Object.getOwnPropertyDescriptor(Navigator.prototype, 'hardwareConcurrency').get === original.get &&
        navigator.hardwareConcurrency === native && Reflect.apply(retained, navigator, []) === native;
      return { custom, illegal, batteryMatches, uaMatches, uaJSONMatches, noAbsentAPI, restored };
    });
    assert.deepEqual(result, { custom: true, illegal: true, batteryMatches: true, uaMatches: true, uaJSONMatches: true, noAbsentAPI: true, restored: true });
  } finally { await browser.close(); }
});
test('native Chromium adversarial: prototype calls, WebGL1/2/Offscreen primitive conversion, opaque args and device metadata', async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-angle=swiftshader'] });
  try {
    const page = await browser.newPage();
    await page.route('https://custom-adversarial.invalid/', route => route.fulfill({ body: '<!doctype html><title>Owned native adversarial fixture</title>', contentType: 'text/html' }));
    await page.goto('https://custom-adversarial.invalid/');
    await page.evaluate(`globalThis.adversarialInstaller = (${installApiCustom.toString()}); globalThis.adversarialProbe = (${nativeCustomAdversarialProbe.toString()});`);
    const result = await page.evaluate(async entries => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      for (const track of stream.getTracks()) track.stop();
      const guard = globalThis.adversarialInstaller(globalThis, entries);
      try { return await globalThis.adversarialProbe(entries); }
      finally { guard.stop(); }
    }, ADVERSARIAL_CUSTOM_ENTRIES);
    assert.deepEqual(result.failures, []);
    assert.ok(result.passed >= 100, 'native adversarial read paths were exercised');
    assert.ok(result.checks.some(check => check.id === 'media:native-object-prototype-coverage' && check.status === 'pass'), 'real MediaDeviceInfo objects exercised borrowed prototype getters');
    assert.ok(result.checks.some(check => check.id.startsWith('webgl2:') && check.status === 'pass'), 'WebGL2 implementation was exercised');
  } finally { await browser.close(); }
});
test('native Chromium descendants reuse private startup intrinsics after parent globals are poisoned', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto('about:blank');
    await page.evaluate(`globalThis.poisonFixtureInstaller = (${installApiCustom.toString()});`);
    const result = await page.evaluate(() => {
      const installer = globalThis.poisonFixtureInstaller;
      delete globalThis.poisonFixtureInstaller;
      const entries = [{ id: 'hardware-concurrency', value: 257 }, { id: 'navigator-platform', value: 'private-capture-platform' }];
      const parentGuard = installer(globalThis, entries);
      const captured = { getOwn: Object.getOwnPropertyDescriptor, define: Object.defineProperty, prototype: Object.getPrototypeOf,
        apply: Reflect.apply, keys: Reflect.ownKeys, isArray: Array.isArray, freeze: Object.freeze,
        then: Promise.prototype.then, weakGet: WeakMap.prototype.get, weakSet: WeakMap.prototype.set };
      let childGuard, frame;
      try {
        const poison = () => { throw new Error('page replaced intrinsic'); };
        Object.getOwnPropertyDescriptor = poison; Object.defineProperty = poison; Object.getPrototypeOf = poison;
        Reflect.apply = poison; Reflect.ownKeys = poison; Array.isArray = poison; Object.freeze = poison;
        Promise.prototype.then = poison; WeakMap.prototype.get = poison; WeakMap.prototype.set = poison;
        frame = document.createElement('iframe'); document.body.appendChild(frame);
        childGuard = installer(frame.contentWindow, entries);
        const privateCacheDescriptor = captured.getOwn(installer, '__detectExpertCustomIntrinsicsV1');
        return { parent: navigator.hardwareConcurrency === 257, child: frame.contentWindow.navigator.hardwareConcurrency === 257,
          platform: frame.contentWindow.navigator.platform === 'private-capture-platform',
          cachePrivate: privateCacheDescriptor.enumerable === false && privateCacheDescriptor.writable === false && privateCacheDescriptor.configurable === false };
      } finally {
        Object.getOwnPropertyDescriptor = captured.getOwn; Object.defineProperty = captured.define; Object.getPrototypeOf = captured.prototype;
        Reflect.apply = captured.apply; Reflect.ownKeys = captured.keys; Array.isArray = captured.isArray; Object.freeze = captured.freeze;
        Promise.prototype.then = captured.then; WeakMap.prototype.get = captured.weakGet; WeakMap.prototype.set = captured.weakSet;
        childGuard?.stop(); parentGuard.stop(); frame?.remove();
      }
    });
    assert.deepEqual(result, { parent: true, child: true, platform: true, cachePrivate: true });
  } finally { await browser.close(); }
});
