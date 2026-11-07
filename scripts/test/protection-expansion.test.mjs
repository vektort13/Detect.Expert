// ADR-045, ADR-046: denial, recovery, unavailable APIs and additive policy compatibility.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { installProtection } from '../../apps/production-extension/protection-runtime.js';
import { PROTECTION_FEATURES } from '../../packages/contracts/src/protection-features.mjs';
import { API_NAMES, PROTECTION_GROUPS } from '../../apps/production-extension/protection-ui.js';
import { applyExpandedBlockingCopy, EXPANDED_BLOCKING_KEYS } from '../production-locales-blocking-expanded.mjs';
import { applyCatalogBlockingCopy, CATALOG_BLOCKING_KEYS } from '../production-locales-blocking-catalog.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';
import { WEBASSEMBLY_UI_KEYS } from '../production-locales-webassembly.mjs';

// Shared Promise-denial scenario: the page argument is a throwing Proxy, so any read or coercion fails the test.
async function assertPromiseDenial({ feature, realm, target, method, errorName, receiver }) {
  let calls = 0, thisValue, argumentsValue, shouldThrow = false;
  const error = new Error('native exception'), result = Promise.resolve({ native: true });
  const native = function (...args) { calls++; thisValue = this; argumentsValue = args; if (shouldThrow) throw error; return result; };
  const original = { value: native, writable: true, configurable: true, enumerable: true };
  Object.defineProperty(target, method, original);
  const guard = installProtection(realm, feature), wrapper = target[method];
  assert.notEqual(wrapper, native);
  const input = new Proxy({}, { get() { throw new Error('page getter'); } });
  const denied = wrapper.call(receiver, input);
  assert.ok(denied instanceof Promise);
  await assert.rejects(denied, { name: errorName, message: 'Blocked by detect.expert' });
  assert.equal(calls, 0); assert.equal(guard.snapshot().blocked, 1);
  guard.stop(); guard.stop();
  assert.deepEqual(Object.getOwnPropertyDescriptor(target, method), original);
  assert.equal(wrapper.call(receiver, input), result);
  assert.equal(calls, 1); assert.equal(thisValue, receiver); assert.equal(argumentsValue[0], input);
  shouldThrow = true;
  assert.throws(() => wrapper.call(receiver), value => value === error);
  assert.equal(calls, 2);
}

const methods = [
  ['media-enumeration', 'MediaDevices', 'enumerateDevices', 'NotAllowedError'],
  ['media-capture', 'MediaDevices', 'getUserMedia', 'NotAllowedError'],
  ['media-capture', 'MediaDevices', 'getDisplayMedia', 'NotAllowedError'],
  ['bluetooth', 'Bluetooth', 'requestDevice', 'NotAllowedError'],
  ['bluetooth', 'Bluetooth', 'getDevices', 'SecurityError'],
  ['bluetooth', 'Bluetooth', 'getAvailability', 'SecurityError'],
  ['usb', 'USB', 'requestDevice', 'SecurityError'], ['usb', 'USB', 'getDevices', 'SecurityError'],
  ['serial', 'Serial', 'requestPort', 'SecurityError'], ['serial', 'Serial', 'getPorts', 'SecurityError'],
  ['hid', 'HID', 'requestDevice', 'NotAllowedError'], ['hid', 'HID', 'getDevices', 'SecurityError'],
  ['midi', 'Navigator', 'requestMIDIAccess', 'SecurityError'],
  ['service-worker', 'ServiceWorkerContainer', 'register', 'SecurityError'],
  ['push', 'PushManager', 'subscribe', 'NotAllowedError'],
  ['background-sync', 'SyncManager', 'register', 'NotAllowedError'],
  ['periodic-sync', 'PeriodicSyncManager', 'register', 'NotAllowedError'],
  ['videoframe-readback', 'VideoFrame', 'copyTo', 'SecurityError'],
  ['hdcp-policy', 'MediaKeys', 'getStatusForPolicy', 'NotAllowedError'],
  ['performance-memory', 'Performance', 'measureUserAgentSpecificMemory', 'SecurityError'],
  ['webxr', 'XRSystem', 'isSessionSupported', 'SecurityError'],
  ['webxr', 'XRSystem', 'requestSession', 'SecurityError'],
  ['webnn', 'ML', 'createContext', 'NotAllowedError'],
  ['encrypted-media', 'Navigator', 'requestMediaKeySystemAccess', 'NotAllowedError'],
  ['handwriting-recognition', 'Navigator', 'createHandwritingRecognizer', 'NotAllowedError'],
  ['handwriting-recognition', 'Navigator', 'queryHandwritingRecognizer', 'NotAllowedError'],
  ['screen-wake-lock', 'WakeLock', 'request', 'NotAllowedError'],
  ['picture-in-picture', 'HTMLVideoElement', 'requestPictureInPicture', 'NotAllowedError'],
  ['document-picture-in-picture', 'DocumentPictureInPicture', 'requestWindow', 'NotAllowedError'],
  ['fullscreen', 'Element', 'requestFullscreen', 'NotAllowedError'],
  ['file-system-pickers', 'FileSystemHandle', 'requestPermission', 'NotAllowedError'],
  ['installed-related-apps', 'Navigator', 'getInstalledRelatedApps', 'NotAllowedError'],
  ['persistent-storage', 'StorageManager', 'persist', 'NotAllowedError'],
  ['persistent-storage', 'StorageManager', 'persisted', 'NotAllowedError'],
  ['cast-discovery', 'PresentationRequest', 'getAvailability', 'NotAllowedError'],
  ['cast-discovery', 'RemotePlayback', 'watchAvailability', 'NotAllowedError'],
  ...['get', 'create', 'store'].map(key => ['credential-management', 'CredentialsContainer', key, 'NotAllowedError']),
  ['payment-probes', 'PaymentRequest', 'canMakePayment', 'NotAllowedError'],
  ['payment-probes', 'PaymentRequest', 'hasEnrolledInstrument', 'NotAllowedError'],
  ['storage-access', 'Document', 'requestStorageAccess', 'NotAllowedError'],
  ['storage-access', 'Document', 'requestStorageAccessFor', 'NotAllowedError'],
  ['private-state-tokens', 'Document', 'hasPrivateToken', 'NotAllowedError'],
  ['private-state-tokens', 'Document', 'hasRedemptionRecord', 'NotAllowedError'],
  ['background-fetch', 'BackgroundFetchManager', 'fetch', 'NotAllowedError'],
  ['clipboard-write', 'Clipboard', 'write', 'NotAllowedError'],
  ['clipboard-write', 'Clipboard', 'writeText', 'NotAllowedError'],
  ['permission-probes', 'PushManager', 'permissionState', 'NotAllowedError'],
  ['opfs', 'StorageManager', 'getDirectory', 'SecurityError'],
  ['indexeddb-enumeration', 'IDBFactory', 'databases', 'SecurityError']
];
for (const [feature, name, method, errorName] of methods) test(feature + ' / ' + method + ': deny without invoking page code; stop restores exact behavior', async () => {
  const realm = { [name]: function () {} };
  await assertPromiseDenial({ feature, realm, target: realm[name].prototype, method, errorName, receiver: {} });
});

// Static methods live on the constructor itself; the constructor is the receiver.
const statics = [
  ...['VideoDecoder', 'VideoEncoder', 'AudioDecoder', 'AudioEncoder'].map(name => ['webcodecs-capabilities', name, 'isConfigSupported', 'NotAllowedError']),
  ['webcodecs-capabilities', 'ImageDecoder', 'isTypeSupported', 'NotAllowedError'],
  ...['isUserVerifyingPlatformAuthenticatorAvailable', 'isConditionalMediationAvailable', 'getClientCapabilities'].map(key => ['platform-authenticator', 'PublicKeyCredential', key, 'NotAllowedError']),
  ['fedcm-user-info', 'IdentityProvider', 'getUserInfo', 'NotAllowedError'],
  ['payment-probes', 'PaymentRequest', 'securePaymentConfirmationAvailability', 'NotAllowedError']
];
for (const [feature, name, method, errorName] of statics) test(feature + ' / ' + name + '.' + method + ': static denial without invoking page code; stop restores exact behavior', async () => {
  const realm = { [name]: function () {} };
  await assertPromiseDenial({ feature, realm, target: realm[name], method, errorName, receiver: realm[name] });
});
// Window-level operation: the global object is both the owner and the receiver.
test('payment-probes / getDigitalGoodsService: window method denial without invoking page code; stop restores exact behavior', async () => {
  const realm = {};
  await assertPromiseDenial({ feature: 'payment-probes', realm, target: realm, method: 'getDigitalGoodsService', errorName: 'NotAllowedError', receiver: realm });
});

// kind: 'proto' (default) -> realm[name].prototype, 'static' -> realm[name], 'window' -> realm.
const hidden = [
  ['geolocation', 'Navigator', 'geolocation'], ['gamepads', 'Navigator', 'getGamepads'],
  ['speech-voices', 'SpeechSynthesis', 'getVoices'], ['storage-estimate', 'StorageManager', 'estimate'],
  ['notifications', 'Notification', 'requestPermission', 'static'],
  ...['getUserMedia', 'webkitGetUserMedia', 'mozGetUserMedia'].map(key => ['media-capture', 'Navigator', key]),
  ...['Accelerometer', 'LinearAccelerationSensor', 'GravitySensor', 'Gyroscope', 'Magnetometer', 'AbsoluteOrientationSensor', 'RelativeOrientationSensor', 'AmbientLightSensor'].map(key => ['generic-sensors', null, key, 'window']),
  ['bluetooth', 'Bluetooth', 'onavailabilitychanged'],
  ['screen-extended', 'Screen', 'isExtended'], ['screen-extended', 'Screen', 'onchange'],
  ['media-capabilities', 'Navigator', 'mediaCapabilities'], ['autoplay-policy', 'Navigator', 'getAutoplayPolicy'],
  ['hardware-concurrency', 'Navigator', 'hardwareConcurrency'], ['device-memory', 'Navigator', 'deviceMemory'],
  ['cpu-performance', 'Navigator', 'cpuPerformance'], ['touch-points', 'Navigator', 'maxTouchPoints'],
  ['performance-memory', 'Performance', 'memory'],
  ['webrtc-codecs', 'RTCRtpSender', 'getCapabilities', 'static'], ['webrtc-codecs', 'RTCRtpReceiver', 'getCapabilities', 'static'],
  ...['DeviceMotionEvent', 'DeviceOrientationEvent', 'DeviceMotionEventAcceleration', 'DeviceMotionEventRotationRate', 'ondevicemotion', 'ondeviceorientation', 'ondeviceorientationabsolute'].map(key => ['device-motion', null, key, 'window']),
  ...['SpeechRecognition', 'webkitSpeechRecognition'].map(key => ['speech-recognition', null, key, 'window']),
  ...['BarcodeDetector', 'FaceDetector', 'TextDetector'].map(key => ['shape-detection', null, key, 'window']),
  ...['LanguageModel', 'Summarizer', 'Writer', 'Rewriter', 'Proofreader'].map(key => ['builtin-ai-models', null, key, 'window']),
  ...['Translator', 'LanguageDetector'].map(key => ['translation-ai', null, key, 'window']),
  ['picture-in-picture', 'Document', 'pictureInPictureEnabled'],
  ['fullscreen', 'Document', 'fullscreenEnabled'], ['fullscreen', 'Document', 'webkitFullscreenEnabled'],
  ...['webkitRequestFullscreen', 'webkitRequestFullScreen', 'mozRequestFullScreen'].map(key => ['fullscreen', 'Element', key]),
  ['fullscreen', 'HTMLVideoElement', 'webkitEnterFullscreen'], ['fullscreen', 'HTMLVideoElement', 'webkitEnterFullScreen'],
  ['pointer-lock', 'Element', 'requestPointerLock'],
  ['feature-policy', 'Document', 'featurePolicy'], ['feature-policy', 'HTMLIFrameElement', 'featurePolicy'],
  ['protocol-handlers', 'Navigator', 'registerProtocolHandler'], ['protocol-handlers', 'Navigator', 'unregisterProtocolHandler'],
  ['media-session', 'Navigator', 'mediaSession'], ['storage-buckets', 'Navigator', 'storageBuckets'],
  ['legacy-quota', 'Navigator', 'webkitTemporaryStorage'], ['legacy-quota', 'Navigator', 'webkitPersistentStorage'],
  ['send-beacon', 'Navigator', 'sendBeacon'], ['web-share', 'Navigator', 'share'], ['web-share', 'Navigator', 'canShare'],
  ['permission-probes', 'Navigator', 'permissions'],
  ['permission-probes', 'Notification', 'permission', 'static'],
  ['platform-authenticator', 'DigitalCredential', 'userAgentAllowsProtocol', 'static'],
  ...['showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker'].map(key => ['file-system-pickers', null, key, 'window']),
  ['cookie-store', null, 'cookieStore', 'window'], ['cache-storage', null, 'caches', 'window'],
  ['legacy-quota', null, 'webkitRequestFileSystem', 'window'], ['legacy-quota', null, 'webkitResolveLocalFileSystemURL', 'window'],
  ['fetch-later', null, 'fetchLater', 'window'],
  ['websocket', null, 'WebSocket', 'window'], ['websocket', null, 'WebSocketStream', 'window'],
  ['webtransport', null, 'WebTransport', 'window'],
  ['shared-worker', null, 'SharedWorker', 'window'], ['dedicated-worker', null, 'Worker', 'window'],
  ['reporting-observer', null, 'ReportingObserver', 'window']
];
for (const [feature, name, key, kind = 'proto'] of hidden) test(feature + ' / ' + (kind === 'window' ? '' : name + '.') + key + ': remove and restore without evaluating getters', () => {
  let reads = 0;
  const realm = kind === 'window' ? {} : { [name]: function () {} };
  const target = kind === 'window' ? realm : kind === 'static' ? realm[name] : realm[name].prototype;
  const original = { get() { reads++; throw new Error('unexpected getter'); }, set: undefined, configurable: true, enumerable: true };
  Object.defineProperty(target, key, original);
  const guard = installProtection(realm, feature);
  assert.equal(Object.hasOwn(target, key), false); assert.equal(reads, 0);
  guard.stop(); assert.deepEqual(Object.getOwnPropertyDescriptor(target, key), original);
  assert.equal(reads, 0);
  const second = installProtection(realm, feature), replacement = () => 'page';
  Object.defineProperty(target, key, { value: replacement, configurable: true });
  second.stop(); assert.equal(target[key], replacement, 'stop must not overwrite a later page descriptor');
});
// The cookie owner search starts at HTMLDocument.prototype and climbs to Document.prototype; HTTP Set-Cookie is out of scope.
for (const placement of ['Document', 'HTMLDocument', 'Document without HTMLDocument']) test('document-cookie / cookie on ' + placement + ': remove and restore without invoking the accessor', () => {
  let calls = 0;
  const Document = function () {}, HTMLDocument = function () {};
  Object.setPrototypeOf(HTMLDocument.prototype, Document.prototype);
  assert.equal(Object.getPrototypeOf(HTMLDocument.prototype), Document.prototype);
  const realm = placement === 'Document without HTMLDocument' ? { Document } : { Document, HTMLDocument };
  const target = placement === 'HTMLDocument' ? HTMLDocument.prototype : Document.prototype;
  const original = { get() { calls++; throw new Error('cookie getter'); }, set() { calls++; throw new Error('cookie setter'); }, configurable: true, enumerable: true };
  Object.defineProperty(target, 'cookie', original);
  const guard = installProtection(realm, 'document-cookie');
  assert.equal(Object.hasOwn(Document.prototype, 'cookie'), false); assert.equal(Object.hasOwn(HTMLDocument.prototype, 'cookie'), false);
  assert.deepEqual(guard.snapshot(), { feature: 'document-cookie', installed: 1, unavailable: 0, removed: 1, blocked: 0, stopped: false });
  // A later page assignment becomes a plain own property of that document and never reaches the removed setter.
  const page = Object.create(HTMLDocument.prototype); page.cookie = 'page';
  assert.deepEqual(Object.getOwnPropertyDescriptor(page, 'cookie'), { value: 'page', writable: true, enumerable: true, configurable: true });
  guard.stop(); guard.stop();
  assert.deepEqual(Object.getOwnPropertyDescriptor(target, 'cookie'), original);
  assert.equal(placement === 'HTMLDocument' ? Object.hasOwn(Document.prototype, 'cookie') : Object.hasOwn(HTMLDocument.prototype, 'cookie'), false);
  assert.equal(calls, 0);
});
test('unsupported APIs are not created and non-configurable properties are left intact', () => {
  for (const feature of PROTECTION_FEATURES) {
    const realm = {}, guard = installProtection(realm, feature), snapshot = guard.snapshot();
    assert.deepEqual(realm, {}, feature); assert.equal(snapshot.installed, 0, feature);
    // In an empty realm every hook attempt is unavailable: the bundles accept at most 16 per rule.
    assert.ok(snapshot.unavailable >= 1 && snapshot.unavailable <= 16, feature + ': ' + snapshot.unavailable); guard.stop();
  }
  const realm = { MediaDevices: function () {} }, native = () => 1;
  Object.defineProperty(realm.MediaDevices.prototype, 'enumerateDevices', { value: native, configurable: false });
  const guard = installProtection(realm, 'media-enumeration');
  assert.equal(guard.snapshot().installed, 0); assert.equal(realm.MediaDevices.prototype.enumerateDevices, native);
  const statics = { VideoDecoder: function () {} };
  Object.defineProperty(statics.VideoDecoder, 'isConfigSupported', { value: native, configurable: false });
  const codecs = installProtection(statics, 'webcodecs-capabilities');
  assert.equal(codecs.snapshot().installed, 0); assert.equal(codecs.snapshot().unavailable, 5); assert.equal(statics.VideoDecoder.isConfigSupported, native);
  const global = {};
  Object.defineProperty(global, 'Translator', { value: native, configurable: false });
  const translation = installProtection(global, 'translation-ai');
  assert.equal(translation.snapshot().installed, 0); assert.equal(global.Translator, native);
  const documents = { Document: function () {} };
  Object.defineProperty(documents.Document.prototype, 'cookie', { get: native, configurable: false });
  const cookie = installProtection(documents, 'document-cookie');
  assert.equal(cookie.snapshot().installed, 0); assert.equal(cookie.snapshot().unavailable, 1);
  assert.equal(Object.getOwnPropertyDescriptor(documents.Document.prototype, 'cookie').get, native);
  const credentials = { PublicKeyCredential: function () {} };
  Object.defineProperty(credentials.PublicKeyCredential, 'getClientCapabilities', { value: native, configurable: false });
  const authenticator = installProtection(credentials, 'platform-authenticator');
  assert.equal(authenticator.snapshot().installed, 0); assert.equal(authenticator.snapshot().unavailable, 4);
  assert.equal(credentials.PublicKeyCredential.getClientCapabilities, native);
});
test('every feature appears exactly once in grouped UI with an API label and localized expanded copy', () => {
  assert.equal(new Set(PROTECTION_FEATURES).size, PROTECTION_FEATURES.length, 'contract has no duplicates');
  const grouped = PROTECTION_GROUPS.flatMap(group => group.features);
  assert.equal(new Set(grouped).size, grouped.length, 'no feature is listed in two groups');
  assert.deepEqual([...grouped].sort(), [...PROTECTION_FEATURES].sort());
  assert.deepEqual(PROTECTION_GROUPS.map(group => group.id), ['graphics', 'media', 'device', 'hardware', 'background', 'browser', 'webassembly', 'system', 'ai', 'storage', 'network', 'identity']);
  const storage = PROTECTION_GROUPS.find(group => group.id === 'storage'), browser = PROTECTION_GROUPS.find(group => group.id === 'browser');
  assert.ok(storage.features.includes('storage-estimate') && !browser.features.includes('storage-estimate'), 'storage-estimate is listed under storage');
  assert.deepEqual(Object.keys(API_NAMES).sort(), [...PROTECTION_FEATURES].sort());
  for (const feature of PROTECTION_FEATURES) assert.ok(typeof API_NAMES[feature] === 'string' && API_NAMES[feature].trim().length > 0, feature);
  for (const locale of PRODUCTION_LANGUAGES) {
    const table = {}; applyExpandedBlockingCopy(table, locale.id);
    assert.deepEqual(Object.keys(table), EXPANDED_BLOCKING_KEYS);
    assert.ok(Object.values(table).every(entry => entry.message.length > 0));
    const catalog = applyCatalogBlockingCopy({}, locale.id);
    assert.deepEqual(Object.keys(catalog), CATALOG_BLOCKING_KEYS);
    assert.ok(Object.values(catalog).every(entry => entry.message.length > 0));
  }
  // The first 15 labels are 1.0.0 catalog entries; every later rule and every group comes from an overlay.
  const overlay = new Set([...EXPANDED_BLOCKING_KEYS, ...CATALOG_BLOCKING_KEYS, ...WEBASSEMBLY_UI_KEYS]);
  for (const feature of PROTECTION_FEATURES.slice(15).filter(id => !id.startsWith('webassembly-'))) assert.ok(overlay.has('protection_feature_' + feature.replaceAll('-', '_')), feature);
  for (const group of PROTECTION_GROUPS) assert.ok(overlay.has('protection_group_' + group.id), group.id);
});
test('all bundled contracts and scripts agree, legacy presets stay unchanged and new rules are explicit', () => {
  for (const file of ['background.js', 'bridge.js', 'options.js', 'popup.js', 'sidepanel.js', 'report.js']) {
    const source = readFileSync(new URL('../../apps/production-extension/' + file, import.meta.url), 'utf8');
    const lists = [...source.matchAll(/var PROTECTION_FEATURES = (\[[\s\S]*?\])/g)];
    assert.ok(lists.length > 0);
    for (const list of lists) assert.deepEqual(JSON.parse(list[1]), PROTECTION_FEATURES, file);
  }
  const source = readFileSync(new URL('../../apps/production-extension/background.js', import.meta.url), 'utf8');
  const start = source.indexOf('// packages/contracts/src/protection.ts'), end = source.indexOf('// packages/contracts/src/rtc-values.ts', start);
  const realm = vm.createContext({ URL, isSanitizedHost: value => value === 'example.com' });
  vm.runInContext(source.slice(start, end) + '\nglobalThis.api={readProtectionSettings,effectiveProtection,readProtectionObservations};', realm);
  const base = { schemaVersion: 1, revision: 7, enabled: true, preset: 'strict', global: [], sites: [] };
  const legacy = ['window-management', 'compute-pressure', 'idle-detection', 'local-fonts', 'canvas-readback', 'battery', 'network-information', 'keyboard', 'client-hints'];
  assert.deepEqual(Array.from(realm.api.effectiveProtection(realm.api.readProtectionSettings(base), 'example.com')), legacy);
  const all = realm.api.readProtectionSettings({ ...base, preset: 'custom', global: PROTECTION_FEATURES.map(feature => ({ feature, state: 'block' })) });
  assert.ok(all); assert.deepEqual(Array.from(realm.api.effectiveProtection(all, 'example.com')), PROTECTION_FEATURES);
  assert.deepEqual(Array.from(realm.api.effectiveProtection({ ...all, enabled: false }, 'example.com')), []);
  assert.equal(realm.api.readProtectionSettings({ ...all, global: [{ feature: '__proto__', state: 'block' }] }), null);
  assert.equal(realm.api.readProtectionSettings({ ...all, global: [all.global[0], all.global[0]] }), null);
  assert.ok(realm.api.readProtectionObservations(PROTECTION_FEATURES.map(feature => ({ feature, installed: 1, unavailable: 0, removed: 0, blocked: 0, stopped: false }))));
  for (const feature of PROTECTION_FEATURES) {
    const code = readFileSync(new URL('../../apps/production-extension/protection.' + feature + '.js', import.meta.url), 'utf8');
    assert.ok(code.includes('installProtection(globalThis, "' + feature + '")'));
  }
});
