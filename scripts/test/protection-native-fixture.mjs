// Executed in our loopback page only. Prototypes and constructors as receivers avoid permission
// prompts; in blocked mode only our own wrapper is ever called, never a native function.
// Firefox passes this function through toString(), so it stays self-contained.
export async function nativeProtectionProbe(mode) {
  const rows = [];
  // [feature, interface, method, error]: receiver is the interface prototype.
  const methods = [
    ['media-enumeration', 'MediaDevices', 'enumerateDevices', 'NotAllowedError'],
    ['media-capture', 'MediaDevices', 'getUserMedia', 'NotAllowedError'],
    ['media-capture', 'MediaDevices', 'getDisplayMedia', 'NotAllowedError'],
    ['bluetooth', 'Bluetooth', 'requestDevice', 'NotAllowedError'], ['bluetooth', 'Bluetooth', 'getDevices', 'SecurityError'],
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
    ['performance-memory', 'Performance', 'measureUserAgentSpecificMemory', 'SecurityError'],
    ['webxr', 'XRSystem', 'isSessionSupported', 'SecurityError'], ['webxr', 'XRSystem', 'requestSession', 'SecurityError'],
    ['opfs', 'StorageManager', 'getDirectory', 'SecurityError'],
    ['indexeddb-enumeration', 'IDBFactory', 'databases', 'SecurityError'],
    ['hdcp-policy', 'MediaKeys', 'getStatusForPolicy', 'NotAllowedError'],
    ['webnn', 'ML', 'createContext', 'NotAllowedError'],
    ['encrypted-media', 'Navigator', 'requestMediaKeySystemAccess', 'NotAllowedError'],
    ['handwriting-recognition', 'Navigator', 'createHandwritingRecognizer', 'NotAllowedError'],
    ['handwriting-recognition', 'Navigator', 'queryHandwritingRecognizer', 'NotAllowedError'],
    ['installed-related-apps', 'Navigator', 'getInstalledRelatedApps', 'NotAllowedError'],
    ['screen-wake-lock', 'WakeLock', 'request', 'NotAllowedError'],
    ['picture-in-picture', 'HTMLVideoElement', 'requestPictureInPicture', 'NotAllowedError'],
    ['document-picture-in-picture', 'DocumentPictureInPicture', 'requestWindow', 'NotAllowedError'],
    ['fullscreen', 'Element', 'requestFullscreen', 'NotAllowedError'],
    ['file-system-pickers', 'FileSystemHandle', 'requestPermission', 'NotAllowedError'],
    ['persistent-storage', 'StorageManager', 'persist', 'NotAllowedError'],
    ['persistent-storage', 'StorageManager', 'persisted', 'NotAllowedError'],
    ['cast-discovery', 'PresentationRequest', 'getAvailability', 'NotAllowedError'],
    ['cast-discovery', 'RemotePlayback', 'watchAvailability', 'NotAllowedError'],
    ['credential-management', 'CredentialsContainer', 'get', 'NotAllowedError'],
    ['credential-management', 'CredentialsContainer', 'create', 'NotAllowedError'],
    ['credential-management', 'CredentialsContainer', 'store', 'NotAllowedError'],
    ['payment-probes', 'PaymentRequest', 'canMakePayment', 'NotAllowedError'],
    ['payment-probes', 'PaymentRequest', 'hasEnrolledInstrument', 'NotAllowedError'],
    ['storage-access', 'Document', 'requestStorageAccess', 'NotAllowedError'],
    ['storage-access', 'Document', 'requestStorageAccessFor', 'NotAllowedError'],
    ['private-state-tokens', 'Document', 'hasPrivateToken', 'NotAllowedError'],
    ['private-state-tokens', 'Document', 'hasRedemptionRecord', 'NotAllowedError'],
    ['background-fetch', 'BackgroundFetchManager', 'fetch', 'NotAllowedError'],
    ['clipboard-write', 'Clipboard', 'write', 'NotAllowedError'], ['clipboard-write', 'Clipboard', 'writeText', 'NotAllowedError'],
    ['permission-probes', 'PushManager', 'permissionState', 'NotAllowedError']
  ];
  // [feature, constructor, method, error]: receiver is the constructor itself.
  const statics = [
    ['webcodecs-capabilities', 'VideoDecoder', 'isConfigSupported', 'NotAllowedError'],
    ['webcodecs-capabilities', 'VideoEncoder', 'isConfigSupported', 'NotAllowedError'],
    ['webcodecs-capabilities', 'AudioDecoder', 'isConfigSupported', 'NotAllowedError'],
    ['webcodecs-capabilities', 'AudioEncoder', 'isConfigSupported', 'NotAllowedError'],
    ['webcodecs-capabilities', 'ImageDecoder', 'isTypeSupported', 'NotAllowedError'],
    ['platform-authenticator', 'PublicKeyCredential', 'isUserVerifyingPlatformAuthenticatorAvailable', 'NotAllowedError'],
    ['platform-authenticator', 'PublicKeyCredential', 'isConditionalMediationAvailable', 'NotAllowedError'],
    ['platform-authenticator', 'PublicKeyCredential', 'getClientCapabilities', 'NotAllowedError'],
    ['fedcm-user-info', 'IdentityProvider', 'getUserInfo', 'NotAllowedError'],
    ['payment-probes', 'PaymentRequest', 'securePaymentConfirmationAvailability', 'NotAllowedError']
  ];
  // [feature, method, error]: receiver is the window.
  const windowMethods = [['payment-probes', 'getDigitalGoodsService', 'NotAllowedError']];
  const calls = [];
  for (const [feature, name, method, expected] of methods) calls.push({ feature, api: name + '.' + method, kind: 'method', receiver: globalThis[name]?.prototype, method, expected });
  for (const [feature, name, method, expected] of statics) calls.push({ feature, api: name + '.' + method, kind: 'static', receiver: globalThis[name], method, expected });
  for (const [feature, method, expected] of windowMethods) calls.push({ feature, api: 'Window.' + method, kind: 'window', receiver: globalThis, method, expected });
  for (const call of calls) {
    const fn = call.receiver?.[call.method], row = { feature: call.feature, api: call.api, kind: call.kind, present: typeof fn === 'function' };
    if (mode === 'blocked' && row.present) {
      row.expected = call.expected;
      // Only the extension wrapper may run; a native function is never invoked by this probe.
      if (fn.name !== 'blockedApi') row.result = 'not-wrapped';
      else {
        try { await fn.call(call.receiver, {}); row.result = 'unexpected-success'; }
        catch (error) { row.result = error.name; row.extensionDenial = error.message === 'Blocked by detect.expert'; }
      }
    }
    rows.push(row);
  }
  // [feature, owner, key, kind]: 'proto' -> owner.prototype, 'static' -> owner, 'window' -> globalThis.
  const hidden = [
    ['geolocation', 'Navigator', 'geolocation', 'proto'], ['gamepads', 'Navigator', 'getGamepads', 'proto'],
    ['speech-voices', 'SpeechSynthesis', 'getVoices', 'proto'], ['storage-estimate', 'StorageManager', 'estimate', 'proto'],
    ['notifications', 'Notification', 'requestPermission', 'static'],
    ['media-capture', 'Navigator', 'getUserMedia', 'proto'], ['media-capture', 'Navigator', 'webkitGetUserMedia', 'proto'],
    ['media-capture', 'Navigator', 'mozGetUserMedia', 'proto']
  ];
  const sensors = ['Accelerometer', 'LinearAccelerationSensor', 'GravitySensor', 'Gyroscope', 'Magnetometer', 'AbsoluteOrientationSensor', 'RelativeOrientationSensor', 'AmbientLightSensor'];
  for (const key of sensors) hidden.push(['generic-sensors', 'Window', key, 'window']);
  hidden.push(
    ['bluetooth', 'Bluetooth', 'onavailabilitychanged', 'proto'],
    ['screen-extended', 'Screen', 'isExtended', 'proto'], ['screen-extended', 'Screen', 'onchange', 'proto'],
    ['media-capabilities', 'Navigator', 'mediaCapabilities', 'proto'],
    ['autoplay-policy', 'Navigator', 'getAutoplayPolicy', 'proto'],
    ['hardware-concurrency', 'Navigator', 'hardwareConcurrency', 'proto'],
    ['device-memory', 'Navigator', 'deviceMemory', 'proto'],
    ['cpu-performance', 'Navigator', 'cpuPerformance', 'proto'],
    ['touch-points', 'Navigator', 'maxTouchPoints', 'proto'],
    ['protocol-handlers', 'Navigator', 'registerProtocolHandler', 'proto'],
    ['protocol-handlers', 'Navigator', 'unregisterProtocolHandler', 'proto'],
    ['media-session', 'Navigator', 'mediaSession', 'proto'],
    ['storage-buckets', 'Navigator', 'storageBuckets', 'proto'],
    ['legacy-quota', 'Navigator', 'webkitTemporaryStorage', 'proto'], ['legacy-quota', 'Navigator', 'webkitPersistentStorage', 'proto'],
    ['send-beacon', 'Navigator', 'sendBeacon', 'proto'],
    ['web-share', 'Navigator', 'share', 'proto'], ['web-share', 'Navigator', 'canShare', 'proto'],
    ['permission-probes', 'Navigator', 'permissions', 'proto'],
    ['performance-memory', 'Performance', 'memory', 'proto'],
    ['fullscreen', 'Element', 'webkitRequestFullscreen', 'proto'], ['fullscreen', 'Element', 'webkitRequestFullScreen', 'proto'],
    ['fullscreen', 'Element', 'mozRequestFullScreen', 'proto'],
    ['pointer-lock', 'Element', 'requestPointerLock', 'proto'],
    ['fullscreen', 'HTMLVideoElement', 'webkitEnterFullscreen', 'proto'], ['fullscreen', 'HTMLVideoElement', 'webkitEnterFullScreen', 'proto'],
    ['fullscreen', 'Document', 'fullscreenEnabled', 'proto'], ['fullscreen', 'Document', 'webkitFullscreenEnabled', 'proto'],
    ['picture-in-picture', 'Document', 'pictureInPictureEnabled', 'proto'],
    ['feature-policy', 'Document', 'featurePolicy', 'proto'], ['feature-policy', 'HTMLIFrameElement', 'featurePolicy', 'proto'],
    // Presence through the prototype chain: the accessor may live on Document.prototype.
    ['document-cookie', 'HTMLDocument', 'cookie', 'proto'],
    ['webrtc-codecs', 'RTCRtpSender', 'getCapabilities', 'static'], ['webrtc-codecs', 'RTCRtpReceiver', 'getCapabilities', 'static'],
    ['permission-probes', 'Notification', 'permission', 'static'],
    ['platform-authenticator', 'DigitalCredential', 'userAgentAllowsProtocol', 'static']
  );
  const windowHidden = [
    ['device-motion', ['DeviceMotionEvent', 'DeviceOrientationEvent', 'DeviceMotionEventAcceleration', 'DeviceMotionEventRotationRate', 'ondevicemotion', 'ondeviceorientation', 'ondeviceorientationabsolute']],
    ['speech-recognition', ['SpeechRecognition', 'webkitSpeechRecognition']],
    ['shape-detection', ['BarcodeDetector', 'FaceDetector', 'TextDetector']],
    ['builtin-ai-models', ['LanguageModel', 'Summarizer', 'Writer', 'Rewriter', 'Proofreader']],
    ['translation-ai', ['Translator', 'LanguageDetector']],
    ['file-system-pickers', ['showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker']],
    ['cookie-store', ['cookieStore']], ['cache-storage', ['caches']],
    ['legacy-quota', ['webkitRequestFileSystem', 'webkitResolveLocalFileSystemURL']],
    ['fetch-later', ['fetchLater']], ['websocket', ['WebSocket', 'WebSocketStream']], ['webtransport', ['WebTransport']],
    ['shared-worker', ['SharedWorker']], ['dedicated-worker', ['Worker']], ['reporting-observer', ['ReportingObserver']]
  ];
  for (const [feature, keys] of windowHidden) for (const key of keys) hidden.push([feature, 'Window', key, 'window']);
  for (const [feature, name, key, kind] of hidden) {
    const target = kind === 'window' ? globalThis : kind === 'static' ? globalThis[name] : globalThis[name]?.prototype;
    const present = (typeof target === 'object' || typeof target === 'function') && target !== null && key in target;
    rows.push({ feature, api: name + '.' + key, kind, hidden: true, present });
  }
  const result = { secure: isSecureContext, rows };
  if (mode === 'blocked') {
    // Evidence only (ADR-046): a frame without its own URL receives no registered rules.
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    try {
      const view = frame.contentWindow;
      result.frameGap = { hardwareConcurrencyInFrame: 'hardwareConcurrency' in view.Navigator.prototype, workerInFrame: typeof view.Worker };
    } catch (error) { result.frameGap = { error: error.name }; }
    finally { frame.remove(); }
  }
  return result;
}

export function verifyNativeProtection(assert, before, blocked, restored) {
  assert.equal(before.secure, true, 'loopback fixture must expose secure-context APIs');
  assert.deepEqual(restored, before, 'master OFF restores native availability');
  assert.equal(blocked.rows.length, before.rows.length);
  let tested = 0;
  const features = {};
  for (let i = 0; i < before.rows.length; i++) {
    const a = before.rows[i], b = blocked.rows[i];
    assert.equal(a.api, b.api);
    if (a.hidden) assert.equal(b.present, false, a.api + ' entry point hidden');
    else {
      assert.equal(a.present, b.present, a.api + ' support preserved');
      if (a.present) {
        assert.notEqual(b.result, 'not-wrapped', a.api + ' is wrapped by the extension');
        assert.equal(b.result, b.expected, a.api); assert.equal(b.extensionDenial, true, a.api);
      }
    }
    if (a.present) tested++;
    const entry = features[a.feature] ??= { present: [], absent: [] };
    entry[a.present ? 'present' : 'absent'].push(a.api);
  }
  assert.ok(tested >= 8, 'native APIs must be exercised');
  return { tested, features };
}
