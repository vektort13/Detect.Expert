// ADR-045: shared denial implementation. Only explicitly registered rules install it.
// packages/sensors/src/intrinsics.ts
var defineProperty = Object.defineProperty;
function arrayPush(a, value) {
  return defineProperty(a, a.length, { __proto__: null, value, writable: !0, enumerable: !0, configurable: !0 }), a.length;
}

// packages/sensors/src/protection.ts
var apply = Reflect.apply, construct = Reflect.construct, reflectGet = Reflect.get, primitiveSymbol = Symbol.toPrimitive, NativeProxy = Proxy, NativeWeakRef = typeof WeakRef === 'function' ? WeakRef : null, weakDeref = NativeWeakRef ? NativeWeakRef.prototype.deref : null, getOwn = Object.getOwnPropertyDescriptor, getPrototype = Object.getPrototypeOf, define = Object.defineProperty, remove = Reflect.deleteProperty, hasOwn = Object.hasOwn, NativePromise = Promise, resolve = Promise.resolve, reject = Promise.reject, NativeDOMException = DOMException, LIMIT = 65535;
function ownValue(target, key) {
  if (target === null) return;
  let descriptor = getOwn(target, key);
  return descriptor && hasOwn(descriptor, "value") ? descriptor.value : void 0;
}
function prototype(realm, name) {
  let constructor = ownValue(realm, name);
  if (typeof constructor != "function" && (typeof constructor != "object" || constructor === null)) return null;
  let value = ownValue(constructor, "prototype");
  return typeof value == "object" && value !== null ? value : null;
}
function constructorOf(realm, name) {
  let value = ownValue(realm, name);
  return typeof value == "function" ? value : null;
}
function owner(target, key) {
  for (let depth = 0; target !== null && depth < 8; depth++) {
    let descriptor = getOwn(target, key);
    if (descriptor) return { target, descriptor };
    target = getPrototype(target);
  }
  return null;
}
export function installProtection(realm, feature) {
  let state = { feature, installed: 0, unavailable: 0, removed: 0, blocked: 0, stopped: !1 }, handles = [];
  function method(target, key, denial) {
    try {
      let found = owner(target, key);
      if (!found || !found.descriptor.configurable || !hasOwn(found.descriptor, "value") || typeof found.descriptor.value != "function") {
        state.unavailable++;
        return;
      }
      const contextDenial = denial === 'webgl-null' || denial === 'offscreen-webgl-null', abortContext = { __proto__: null };
      const blockedContextType = value => value === 'webgl' || value === 'webgl2' || denial === 'webgl-null' && value === 'experimental-webgl';
      let original = found.descriptor.value, { blockedApi } = {
        blockedApi() {
          if (state.stopped) return apply(original, this, arguments);
          if (contextDenial) {
            if (arguments.length === 0) return apply(original, this, arguments);
            const contextType = arguments[0], opaque = contextType !== null && (typeof contextType === 'object' || typeof contextType === 'function');
            if (!opaque && !blockedContextType(contextType)) return apply(original, this, arguments);
            const args = []; for (let index = 0; index < arguments.length; index++) arrayPush(args, arguments[index]);
            // Native WebIDL validates the receiver before converting the name.
            // Abort only our private known-WebGL conversion, before any context
            // allocation or options reads. Caller coercion runs once, with its
            // original receiver; brand/coercion errors and non-WebGL names pass
            // through. Known blocked names skip later context/options processing.
            args[0] = opaque ? new NativeProxy({ __proto__: null }, { get(_target, key) {
              const member = reflectGet(contextType, key, contextType);
              if ((key === primitiveSymbol || key === 'toString' || key === 'valueOf') && typeof member === 'function') return function() {
                const value = apply(member, contextType, arguments);
                if (blockedContextType(value)) throw abortContext;
                return value;
              };
              return member;
            } }) : { [primitiveSymbol]() { throw abortContext; } };
            try { return apply(original, this, args); }
            catch (error) { if (error !== abortContext) throw error; if (state.blocked < LIMIT) state.blocked++; return null; }
          }
          if (state.blocked < LIMIT && state.blocked++, denial === "denied") return apply(resolve, NativePromise, ["denied"]);
          if (denial === "adapter-null") return apply(resolve, NativePromise, [null]);
          let error = new NativeDOMException("Blocked by detect.expert", denial === "not-allowed" ? "NotAllowedError" : "SecurityError");
          if (denial === "security-sync") throw error;
          return apply(reject, NativePromise, [error]);
        }
      };
      define(found.target, key, {
        __proto__: null,
        value: blockedApi,
        configurable: !0,
        enumerable: found.descriptor.enumerable === !0,
        writable: found.descriptor.writable === !0
      }), arrayPush(handles, { target: found.target, key, original: found.descriptor, wrapper: blockedApi }), state.installed++;
    } catch {
      state.unavailable++;
    }
  }
  function hide(target, key) {
    try {
      let found = owner(target, key);
      if (!found || !found.descriptor.configurable || !remove(found.target, key)) {
        state.unavailable++;
        return;
      }
      // REQ-012: retain deleted descriptors so disabling protection can restore them.
      arrayPush(handles, { target: found.target, key, original: found.descriptor, hidden: !0 });
      state.removed++, state.installed++;
    } catch {
      state.unavailable++;
    }
  }
  // Native Exception(traceStack:true) owns a getter that shadows the prototype.
  // Track only a bounded weak cleanup ring; every owned instance still gets denial.
  function wasmOwnStack(namespace, denied) {
    if (!NativeWeakRef || typeof weakDeref !== 'function') { state.unavailable++; return; }
    const constructor = getOwn(namespace, 'Exception');
    if (!constructor?.configurable || typeof constructor.value !== 'function') { state.unavailable++; return; }
    const original = constructor.value, records = []; let next = 0;
    const getter = originalGet => new NativeProxy(originalGet, { apply(originalGet, receiver, args) {
      if (state.stopped) return apply(originalGet, receiver, args);
      return denied();
    } });
    function protectOwn(instance) {
      try {
        const field = getOwn(instance, 'stack');
        if (!field || hasOwn(field, 'value') || typeof field.get !== 'function') return;
        if (!field.configurable) { if (state.unavailable < LIMIT) state.unavailable++; return; }
        const wrapper = getter(field.get);
        define(instance, 'stack', { __proto__: null, ...field, get: wrapper });
        const record = { ref: new NativeWeakRef(instance), getter: field.get, wrapper };
        if (records.length < 128) arrayPush(records, record);
        else { records[next] = record; next = (next + 1) % 128; }
      } catch { if (state.unavailable < LIMIT) state.unavailable++; }
    }
    const wrapper = new NativeProxy(original, { construct(original, args, newTarget) {
      const value = construct(original, args, newTarget);
      if (!state.stopped) protectOwn(value);
      return value;
    } });
    define(namespace, 'Exception', { __proto__: null, ...constructor, value: wrapper });
    arrayPush(handles, { target: namespace, key: 'Exception', original: constructor, wrapper }); state.installed++;
    const prototype = ownValue(original, 'prototype'), alias = prototype && getOwn(prototype, 'constructor');
    if (alias?.configurable && hasOwn(alias, 'value') && alias.value === original) {
      define(prototype, 'constructor', { __proto__: null, ...alias, value: wrapper });
      arrayPush(handles, { target: prototype, key: 'constructor', original: alias, wrapper }); state.installed++;
    }
    arrayPush(handles, { ownStack: records });
  }
  // ADR-059: deny one existing Wasm entry without reading its arguments/results.
  function wasmGuard(realm, targetKind, ownerName, key, kind) {
    try {
      const namespace = ownValue(realm, 'WebAssembly');
      if (!namespace || typeof namespace !== 'object') { state.unavailable++; return; }
      const constructor = ownerName ? ownValue(namespace, ownerName) : null;
      const target = targetKind === 'namespace' ? namespace : targetKind === 'static' ? constructor : constructor && ownValue(constructor, 'prototype');
      if (!target) { state.unavailable++; return; }
      const descriptor = getOwn(target, key);
      if (!descriptor || !descriptor.configurable) { state.unavailable++; return; }
      const denied = () => {
        if (state.blocked < LIMIT) state.blocked++;
        throw new NativeDOMException('Blocked by detect.expert', 'SecurityError');
      };
      if (kind === 'get' || kind === 'set') {
        const original = descriptor[kind];
        if (typeof original !== 'function') { state.unavailable++; return; }
        // Native accessors are not constructors. Keep the other accessor intact.
        const wrapper = kind === 'get' ? getOwn({ get blocked() {
          if (state.stopped) return apply(original, this, arguments);
          return denied();
        } }, 'blocked').get : getOwn({ set blocked(value) {
          if (state.stopped) return apply(original, this, arguments);
          denied();
        } }, 'blocked').set;
        define(target, key, { __proto__: null, ...descriptor, [kind]: wrapper });
        arrayPush(handles, { target, key, original: descriptor, wrapper, accessor: kind });
        state.installed++;
        if (ownerName === 'Exception' && key === 'stack' && kind === 'get') wasmOwnStack(namespace, denied);
        return;
      }
      if (!hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') { state.unavailable++; return; }
      const original = descriptor.value;
      const wrapper = new NativeProxy(original, {
        apply(original, receiver, args) {
          if (state.stopped) return apply(original, receiver, args);
          if (kind === 'async-call') {
            if (state.blocked < LIMIT) state.blocked++;
            return apply(reject, NativePromise, [new NativeDOMException('Blocked by detect.expert', 'SecurityError')]);
          }
          return denied();
        },
        construct(original, args, newTarget) {
          if (state.stopped) return construct(original, args, newTarget);
          return denied();
        },
      });
      define(target, key, { __proto__: null, ...descriptor, value: wrapper });
      arrayPush(handles, { target, key, original: descriptor, wrapper }); state.installed++;
      if (kind === 'construct') {
        const prototype = ownValue(original, 'prototype');
        const alias = prototype && getOwn(prototype, 'constructor');
        if (alias?.configurable && hasOwn(alias, 'value') && alias.value === original) {
          define(prototype, 'constructor', { __proto__: null, ...alias, value: wrapper });
          arrayPush(handles, { target: prototype, key: 'constructor', original: alias, wrapper }); state.installed++;
        }
      }
    } catch { state.unavailable++; }
  }
  let navigator = prototype(realm, "Navigator");
  switch (feature) {
    case "window-management":
      method(realm, "getScreenDetails", "not-allowed");
      break;
    case "compute-pressure":
      method(prototype(realm, "PressureObserver"), "observe", "not-allowed");
      break;
    case "idle-detection": {
      let constructor = ownValue(realm, "IdleDetector");
      method(typeof constructor == "function" ? constructor : null, "requestPermission", "denied"), method(prototype(realm, "IdleDetector"), "start", "not-allowed");
      break;
    }
    case "local-fonts":
      method(realm, "queryLocalFonts", "not-allowed");
      break;
    case "clipboard-read":
      method(prototype(realm, "Clipboard"), "read", "not-allowed"), method(prototype(realm, "Clipboard"), "readText", "not-allowed");
      break;
    case "canvas-readback":
      method(prototype(realm, "HTMLCanvasElement"), "toDataURL", "security-sync"), method(prototype(realm, "HTMLCanvasElement"), "toBlob", "security-sync"), method(prototype(realm, "HTMLCanvasElement"), "captureStream", "security-sync"), method(prototype(realm, "CanvasRenderingContext2D"), "getImageData", "security-sync"), method(prototype(realm, "OffscreenCanvasRenderingContext2D"), "getImageData", "security-sync"), method(prototype(realm, "OffscreenCanvas"), "convertToBlob", "security-async");
      break;
    case "webgl":
      method(prototype(realm, "HTMLCanvasElement"), "getContext", "webgl-null"), method(prototype(realm, "OffscreenCanvas"), "getContext", "offscreen-webgl-null");
      break;
    case "webgpu":
      method(prototype(realm, "GPU"), "requestAdapter", "adapter-null");
      break;
    case "audio":
      hide(realm, "AudioContext"), hide(realm, "OfflineAudioContext"), hide(realm, "webkitAudioContext"), hide(realm, "webkitOfflineAudioContext");
      break;
    case "webrtc":
      hide(realm, "RTCPeerConnection"), hide(realm, "webkitRTCPeerConnection");
      break;
    case "webassembly":
      hide(realm, "WebAssembly");
      break;
    case "battery":
      hide(navigator, "getBattery");
      break;
    case "network-information":
      hide(navigator, "connection");
      break;
    case "keyboard":
      hide(navigator, "keyboard");
      break;
    case "client-hints":
      hide(navigator, "userAgentData");
      break;
    case "media-enumeration":
      method(prototype(realm, "MediaDevices"), "enumerateDevices", "not-allowed");
      break;
    case "media-capture":
      method(prototype(realm, "MediaDevices"), "getUserMedia", "not-allowed");
      method(prototype(realm, "MediaDevices"), "getDisplayMedia", "not-allowed");
      // Legacy callback entry points are removed rather than given a Promise return.
      hide(navigator, "getUserMedia");
      hide(navigator, "webkitGetUserMedia");
      hide(navigator, "mozGetUserMedia");
      break;
    case "geolocation":
      hide(navigator, "geolocation");
      break;
    case "generic-sensors": {
      const names = ["Accelerometer", "LinearAccelerationSensor", "GravitySensor", "Gyroscope", "Magnetometer", "AbsoluteOrientationSensor", "RelativeOrientationSensor", "AmbientLightSensor"];
      for (let index = 0; index < names.length; index++) hide(realm, names[index]);
      break;
    }
    case "bluetooth":
      method(prototype(realm, "Bluetooth"), "requestDevice", "not-allowed");
      method(prototype(realm, "Bluetooth"), "getDevices", "security-async");
      method(prototype(realm, "Bluetooth"), "getAvailability", "security-async");
      hide(prototype(realm, "Bluetooth"), "onavailabilitychanged");
      break;
    case "usb":
      method(prototype(realm, "USB"), "requestDevice", "security-async");
      method(prototype(realm, "USB"), "getDevices", "security-async");
      break;
    case "serial":
      method(prototype(realm, "Serial"), "requestPort", "security-async");
      method(prototype(realm, "Serial"), "getPorts", "security-async");
      break;
    case "hid":
      method(prototype(realm, "HID"), "requestDevice", "not-allowed");
      method(prototype(realm, "HID"), "getDevices", "security-async");
      break;
    case "midi":
      method(navigator, "requestMIDIAccess", "security-async");
      break;
    case "gamepads":
      hide(navigator, "getGamepads");
      break;
    case "speech-voices":
      hide(prototype(realm, "SpeechSynthesis"), "getVoices");
      break;
    case "service-worker":
      method(prototype(realm, "ServiceWorkerContainer"), "register", "security-async");
      break;
    case "push":
      method(prototype(realm, "PushManager"), "subscribe", "not-allowed");
      break;
    case "background-sync":
      method(prototype(realm, "SyncManager"), "register", "not-allowed");
      break;
    case "periodic-sync":
      method(prototype(realm, "PeriodicSyncManager"), "register", "not-allowed");
      break;
    case "notifications": {
      const notification = ownValue(realm, "Notification");
      // Hide the dual callback/Promise API without executing page callbacks.
      hide(typeof notification === "function" ? notification : null, "requestPermission");
      break;
    }
    case "storage-estimate":
      hide(prototype(realm, "StorageManager"), "estimate");
      break;
    case "videoframe-readback":
      method(prototype(realm, "VideoFrame"), "copyTo", "security-async");
      break;
    case "screen-extended":
      hide(prototype(realm, "Screen"), "isExtended");
      hide(prototype(realm, "Screen"), "onchange");
      break;
    case "webcodecs-capabilities": {
      const names = ["VideoDecoder", "VideoEncoder", "AudioDecoder", "AudioEncoder"];
      for (let index = 0; index < names.length; index++) method(constructorOf(realm, names[index]), "isConfigSupported", "not-allowed");
      method(constructorOf(realm, "ImageDecoder"), "isTypeSupported", "not-allowed");
      break;
    }
    case "media-capabilities":
      hide(navigator, "mediaCapabilities");
      break;
    case "encrypted-media":
      method(navigator, "requestMediaKeySystemAccess", "not-allowed");
      break;
    case "hdcp-policy":
      method(prototype(realm, "MediaKeys"), "getStatusForPolicy", "not-allowed");
      break;
    case "autoplay-policy":
      hide(navigator, "getAutoplayPolicy");
      break;
    case "webrtc-codecs":
      hide(constructorOf(realm, "RTCRtpSender"), "getCapabilities");
      hide(constructorOf(realm, "RTCRtpReceiver"), "getCapabilities");
      break;
    case "device-motion": {
      // ADR-046: presence and handler slots only; addEventListener stays open.
      const names = ["DeviceMotionEvent", "DeviceOrientationEvent", "DeviceMotionEventAcceleration", "DeviceMotionEventRotationRate", "ondevicemotion", "ondeviceorientation", "ondeviceorientationabsolute"];
      for (let index = 0; index < names.length; index++) hide(realm, names[index]);
      break;
    }
    case "hardware-concurrency":
      hide(navigator, "hardwareConcurrency");
      break;
    case "device-memory":
      hide(navigator, "deviceMemory");
      break;
    case "performance-memory":
      hide(prototype(realm, "Performance"), "memory");
      method(prototype(realm, "Performance"), "measureUserAgentSpecificMemory", "security-async");
      break;
    case "cpu-performance":
      hide(navigator, "cpuPerformance");
      break;
    case "touch-points":
      hide(navigator, "maxTouchPoints");
      break;
    case "webxr":
      method(prototype(realm, "XRSystem"), "isSessionSupported", "security-async");
      method(prototype(realm, "XRSystem"), "requestSession", "security-async");
      break;
    case "speech-recognition":
      hide(realm, "SpeechRecognition");
      hide(realm, "webkitSpeechRecognition");
      break;
    case "shape-detection": {
      const names = ["BarcodeDetector", "FaceDetector", "TextDetector"];
      for (let index = 0; index < names.length; index++) hide(realm, names[index]);
      break;
    }
    case "handwriting-recognition":
      method(navigator, "createHandwritingRecognizer", "not-allowed");
      method(navigator, "queryHandwritingRecognizer", "not-allowed");
      break;
    case "webnn":
      method(prototype(realm, "ML"), "createContext", "not-allowed");
      break;
    case "builtin-ai-models": {
      const names = ["LanguageModel", "Summarizer", "Writer", "Rewriter", "Proofreader"];
      for (let index = 0; index < names.length; index++) hide(realm, names[index]);
      break;
    }
    case "translation-ai":
      hide(realm, "Translator");
      hide(realm, "LanguageDetector");
      break;
    case "screen-wake-lock":
      method(prototype(realm, "WakeLock"), "request", "not-allowed");
      break;
    case "picture-in-picture":
      method(prototype(realm, "HTMLVideoElement"), "requestPictureInPicture", "not-allowed");
      hide(prototype(realm, "Document"), "pictureInPictureEnabled");
      break;
    case "document-picture-in-picture":
      method(prototype(realm, "DocumentPictureInPicture"), "requestWindow", "not-allowed");
      break;
    case "fullscreen": {
      const element = prototype(realm, "Element"), video = prototype(realm, "HTMLVideoElement"), documentPrototype = prototype(realm, "Document");
      method(element, "requestFullscreen", "not-allowed");
      hide(element, "webkitRequestFullscreen");
      hide(element, "webkitRequestFullScreen");
      hide(element, "mozRequestFullScreen");
      hide(video, "webkitEnterFullscreen");
      hide(video, "webkitEnterFullScreen");
      hide(documentPrototype, "fullscreenEnabled");
      hide(documentPrototype, "webkitFullscreenEnabled");
      break;
    }
    case "pointer-lock":
      hide(prototype(realm, "Element"), "requestPointerLock");
      break;
    case "file-system-pickers":
      hide(realm, "showOpenFilePicker");
      hide(realm, "showSaveFilePicker");
      hide(realm, "showDirectoryPicker");
      method(prototype(realm, "FileSystemHandle"), "requestPermission", "not-allowed");
      break;
    case "protocol-handlers":
      hide(navigator, "registerProtocolHandler");
      hide(navigator, "unregisterProtocolHandler");
      break;
    case "installed-related-apps":
      method(navigator, "getInstalledRelatedApps", "not-allowed");
      break;
    case "media-session":
      hide(navigator, "mediaSession");
      break;
    case "opfs":
      method(prototype(realm, "StorageManager"), "getDirectory", "security-async");
      break;
    case "cookie-store":
      hide(realm, "cookieStore");
      break;
    case "document-cookie": {
      // ADR-046: removes script cookie access; HTTP Set-Cookie is unaffected.
      let documentPrototype = prototype(realm, "HTMLDocument");
      hide(documentPrototype === null ? prototype(realm, "Document") : documentPrototype, "cookie");
      break;
    }
    case "storage-buckets":
      hide(navigator, "storageBuckets");
      break;
    case "persistent-storage":
      method(prototype(realm, "StorageManager"), "persist", "not-allowed");
      method(prototype(realm, "StorageManager"), "persisted", "not-allowed");
      break;
    case "indexeddb-enumeration":
      method(prototype(realm, "IDBFactory"), "databases", "security-async");
      break;
    case "cache-storage":
      hide(realm, "caches");
      break;
    case "legacy-quota":
      hide(navigator, "webkitTemporaryStorage");
      hide(navigator, "webkitPersistentStorage");
      hide(realm, "webkitRequestFileSystem");
      hide(realm, "webkitResolveLocalFileSystemURL");
      break;
    case "cast-discovery":
      method(prototype(realm, "PresentationRequest"), "getAvailability", "not-allowed");
      method(prototype(realm, "RemotePlayback"), "watchAvailability", "not-allowed");
      break;
    case "send-beacon":
      hide(navigator, "sendBeacon");
      break;
    case "fetch-later":
      hide(realm, "fetchLater");
      break;
    case "websocket":
      hide(realm, "WebSocket");
      hide(realm, "WebSocketStream");
      break;
    case "webtransport":
      hide(realm, "WebTransport");
      break;
    case "platform-authenticator": {
      const credential = constructorOf(realm, "PublicKeyCredential");
      method(credential, "isUserVerifyingPlatformAuthenticatorAvailable", "not-allowed");
      method(credential, "isConditionalMediationAvailable", "not-allowed");
      method(credential, "getClientCapabilities", "not-allowed");
      hide(constructorOf(realm, "DigitalCredential"), "userAgentAllowsProtocol");
      break;
    }
    case "web-share":
      hide(navigator, "share");
      hide(navigator, "canShare");
      break;
    case "credential-management": {
      // preventSilentAccess stays open.
      const container = prototype(realm, "CredentialsContainer"), names = ["get", "create", "store"];
      for (let index = 0; index < names.length; index++) method(container, names[index], "not-allowed");
      break;
    }
    case "fedcm-user-info":
      method(constructorOf(realm, "IdentityProvider"), "getUserInfo", "not-allowed");
      break;
    case "payment-probes":
      // PaymentRequest.show stays open.
      method(prototype(realm, "PaymentRequest"), "canMakePayment", "not-allowed");
      method(prototype(realm, "PaymentRequest"), "hasEnrolledInstrument", "not-allowed");
      method(constructorOf(realm, "PaymentRequest"), "securePaymentConfirmationAvailability", "not-allowed");
      method(realm, "getDigitalGoodsService", "not-allowed");
      break;
    case "storage-access":
      // hasStorageAccess stays open.
      method(prototype(realm, "Document"), "requestStorageAccess", "not-allowed");
      method(prototype(realm, "Document"), "requestStorageAccessFor", "not-allowed");
      break;
    case "private-state-tokens":
      method(prototype(realm, "Document"), "hasPrivateToken", "not-allowed");
      method(prototype(realm, "Document"), "hasRedemptionRecord", "not-allowed");
      break;
    case "background-fetch":
      method(prototype(realm, "BackgroundFetchManager"), "fetch", "not-allowed");
      break;
    case "shared-worker":
      hide(realm, "SharedWorker");
      break;
    case "dedicated-worker":
      hide(realm, "Worker");
      break;
    case "clipboard-write":
      method(prototype(realm, "Clipboard"), "write", "not-allowed");
      method(prototype(realm, "Clipboard"), "writeText", "not-allowed");
      break;
    case "permission-probes":
      hide(navigator, "permissions");
      hide(constructorOf(realm, "Notification"), "permission");
      method(prototype(realm, "PushManager"), "permissionState", "not-allowed");
      break;
    case "reporting-observer":
      hide(realm, "ReportingObserver");
      break;
    case "feature-policy":
      hide(prototype(realm, "Document"), "featurePolicy");
      hide(prototype(realm, "HTMLIFrameElement"), "featurePolicy");
      break;
    case "webassembly-compile":
      wasmGuard(realm, "namespace", "", "compile", "async-call");
      break;
    case "webassembly-instantiate":
      wasmGuard(realm, "namespace", "", "instantiate", "async-call");
      break;
    case "webassembly-compile-streaming":
      wasmGuard(realm, "namespace", "", "compileStreaming", "async-call");
      break;
    case "webassembly-instantiate-streaming":
      wasmGuard(realm, "namespace", "", "instantiateStreaming", "async-call");
      break;
    case "webassembly-validate":
      wasmGuard(realm, "namespace", "", "validate", "call");
      break;
    case "webassembly-module":
      wasmGuard(realm, "namespace", "", "Module", "construct");
      break;
    case "webassembly-instance":
      wasmGuard(realm, "namespace", "", "Instance", "construct");
      break;
    case "webassembly-memory":
      wasmGuard(realm, "namespace", "", "Memory", "construct");
      break;
    case "webassembly-memory-grow":
      wasmGuard(realm, "prototype", "Memory", "grow", "call");
      break;
    case "webassembly-memory-buffer":
      wasmGuard(realm, "prototype", "Memory", "buffer", "get");
      break;
    case "webassembly-module-imports":
      wasmGuard(realm, "static", "Module", "imports", "call");
      break;
    case "webassembly-module-exports":
      wasmGuard(realm, "static", "Module", "exports", "call");
      break;
    case "webassembly-module-custom-sections":
      wasmGuard(realm, "static", "Module", "customSections", "call");
      break;
    case "webassembly-instance-exports":
      wasmGuard(realm, "prototype", "Instance", "exports", "get");
      break;
    case "webassembly-table":
      wasmGuard(realm, "namespace", "", "Table", "construct");
      break;
    case "webassembly-table-length":
      wasmGuard(realm, "prototype", "Table", "length", "get");
      break;
    case "webassembly-table-grow":
      wasmGuard(realm, "prototype", "Table", "grow", "call");
      break;
    case "webassembly-table-get":
      wasmGuard(realm, "prototype", "Table", "get", "call");
      break;
    case "webassembly-table-set":
      wasmGuard(realm, "prototype", "Table", "set", "call");
      break;
    case "webassembly-global":
      wasmGuard(realm, "namespace", "", "Global", "construct");
      break;
    case "webassembly-global-value-of":
      wasmGuard(realm, "prototype", "Global", "valueOf", "call");
      break;
    case "webassembly-global-value":
      wasmGuard(realm, "prototype", "Global", "value", "get");
      break;
    case "webassembly-global-value-set":
      wasmGuard(realm, "prototype", "Global", "value", "set");
      break;
    case "webassembly-tag":
      wasmGuard(realm, "namespace", "", "Tag", "construct");
      break;
    case "webassembly-exception":
      wasmGuard(realm, "namespace", "", "Exception", "construct");
      break;
    case "webassembly-exception-is":
      wasmGuard(realm, "prototype", "Exception", "is", "call");
      break;
    case "webassembly-exception-get-arg":
      wasmGuard(realm, "prototype", "Exception", "getArg", "call");
      break;
    case "webassembly-exception-stack":
      wasmGuard(realm, "prototype", "Exception", "stack", "get");
      break;
    case "webassembly-compile-error":
      wasmGuard(realm, "namespace", "", "CompileError", "construct");
      break;
    case "webassembly-link-error":
      wasmGuard(realm, "namespace", "", "LinkError", "construct");
      break;
    case "webassembly-runtime-error":
      wasmGuard(realm, "namespace", "", "RuntimeError", "construct");
      break;
    case "webassembly-suspending":
      wasmGuard(realm, "namespace", "", "Suspending", "construct");
      break;
    case "webassembly-promising":
      wasmGuard(realm, "namespace", "", "promising", "call");
      break;
    case "webassembly-suspend-error":
      wasmGuard(realm, "namespace", "", "SuspendError", "construct");
      break;
    case "webassembly-memory-to-fixed-length-buffer":
      wasmGuard(realm, "prototype", "Memory", "toFixedLengthBuffer", "call");
      break;
    case "webassembly-memory-to-resizable-buffer":
      wasmGuard(realm, "prototype", "Memory", "toResizableBuffer", "call");
      break;
    case "webassembly-tag-type":
      wasmGuard(realm, "prototype", "Tag", "type", "call");
      break;
  }
  return {
    snapshot: () => ({ ...state }),
    stop() {
      if (!state.stopped) {
        state.stopped = !0;
        for (let index = handles.length - 1; index >= 0; index--) {
          let handle = handles[index];
          try {
            if (handle.ownStack) {
              for (let entry = 0; entry < handle.ownStack.length; entry++) {
                const record = handle.ownStack[entry], instance = apply(weakDeref, record.ref, []);
                if (!instance) continue;
                const current = getOwn(instance, 'stack');
                if (current?.get === record.wrapper && !hasOwn(current, 'value')) {
                  try { define(instance, 'stack', { __proto__: null, ...current, get: record.getter }); } catch {}
                }
              }
              handle.ownStack.length = 0;
              continue;
            }
            let current = getOwn(handle.target, handle.key);
            if (handle.accessor) {
              // Another feature can own the other half of Global.value.
              if (!current || current[handle.accessor] !== handle.wrapper || hasOwn(current, 'value')) continue;
              define(handle.target, handle.key, { __proto__: null, ...current, [handle.accessor]: handle.original[handle.accessor] });
              continue;
            }
            if (hasOwn(handle, "hidden")) {
              // Preserve any descriptor installed by the page after our deletion.
              if (current !== void 0) continue;
              define(handle.target, handle.key, { __proto__: null, ...handle.original });
              continue;
            }
            if (!current || !hasOwn(current, "value") || current.value !== handle.wrapper) continue;
            let original = handle.original;
            define(handle.target, handle.key, {
              __proto__: null,
              value: original.value,
              configurable: original.configurable === !0,
              enumerable: original.enumerable === !0,
              writable: original.writable === !0
            });
          } catch {
          }
        }
      }
    }
  };
}
