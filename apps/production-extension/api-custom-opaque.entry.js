// ADR-049: withhold native metadata in opaque inherited realms where the
// parent's selected profile cannot be read synchronously across its origin.
import { installApiCustom } from './api-custom-runtime.js';
const SPECIALIZED_OPAQUE_IDS = new Set(['media-capabilities','navigator-metadata','navigator-plugins','screen-geometry','css-media','css-supports','intl-formatting','webgl-capabilities','webgpu-capabilities','canvas-text-metrics','audio-fingerprint','audio-metadata','clock-precision','canvas-font-policy','browser-surface','webgl-readback']);

export const API_CUSTOM_OPAQUE_NEUTRALS = Object.freeze({
  'canvas-readback': null,
  'math-transcendentals': null,
  // Hold: an opaque realm never receives a native position (dedicated deny entry, see api-custom-geolocation-opaque.entry.js).
  geolocation: null,
  'hardware-concurrency': 0, 'device-memory': 0, 'touch-points': 0,
  'navigator-platform': '', 'navigator-user-agent': '', 'navigator-app-version': '', 'navigator-vendor': '',
  'navigator-language': '', 'navigator-languages': [], 'navigator-oscpu': '',
  'screen-width': 0, 'screen-height': 0, 'screen-avail-width': 0, 'screen-avail-height': 0,
  'screen-color-depth': 0, 'screen-pixel-depth': 0, 'window-device-pixel-ratio': 0, 'screen-extended': false,
  'screen-orientation': { type: '', angle: 0 },
  timezone: { timeZone: 'UTC', offsetMinutes: 0 },
  battery: { charging: false, chargingTime: null, dischargingTime: null, level: 0 },
  'network-information': { downlink: 0, effectiveType: '', rtt: 0, saveData: false, type: '' },
  'performance-memory': { jsHeapSizeLimit: 0, totalJSHeapSize: 0, usedJSHeapSize: 0 },
  'client-hints': { brands: [], mobile: false, platform: '', architecture: '', bitness: '', model: '', platformVersion: '', uaFullVersion: '', wow64: false, fullVersionList: [] },
  'storage-estimate': { quota: 0, usage: 0 }, 'autoplay-policy': 'disallowed',
  'media-enumeration': [], gamepads: [], 'speech-voices': [],
  bluetooth: { available: false, devices: [] }, usb: [], hid: [], serial: [],
  notifications: 'denied', 'media-capabilities': { supported: false, smooth: false, powerEfficient: false },
  webgl: { vendor: '', renderer: '', unmaskedVendor: '', unmaskedRenderer: '' },
  webgpu: { vendor: '', architecture: '', device: '', description: '' },
  webrtc: { addresses: { ipv4: { host: null, stun: null, turn: null }, ipv6: { host: null, stun: null, turn: null } }, iceTransportPolicy: 'relay', randomizeDevices: true, freshCertificates: true, deviceLifetime: 'session' }
  , 'navigator-metadata': { appCodeName: '', appName: '', vendorSub: '', product: '', productSub: '', buildID: '', cookieEnabled: false, doNotTrack: null, pdfViewerEnabled: false, webdriver: false, globalPrivacyControl: false },
  'navigator-plugins': { plugins: [] },
  'screen-geometry': { availLeft: 0, availTop: 0, innerWidth: 1, innerHeight: 1, outerWidth: 1, outerHeight: 1, screenX: 0, screenY: 0, scrollbarsVisible: false, toolbarVisible: false },
  'css-media': { colorScheme: 'light', reducedMotion: 'no-preference', contrast: 'no-preference', forcedColors: 'none', hover: 'none', pointer: 'none', anyHover: 'none', anyPointer: 'none', colorGamut: 'srgb', dynamicRange: 'standard', viewportWidth: 1, viewportHeight: 1, resolutionDppx: 1 },
  'css-supports': { queries: [] }, 'intl-formatting': { locale: 'en-US', timeZone: 'UTC', calendar: 'gregory', numberingSystem: 'latn' },
  'webgl-capabilities': { parameters: { VERSION: '', SHADING_LANGUAGE_VERSION: '', MAX_TEXTURE_SIZE: 0, MAX_VIEWPORT_DIMS: [0, 0], MAX_SAMPLES: 0, SUBPIXEL_BITS: 0, ALIASED_LINE_WIDTH_RANGE: [0, 0] }, extensions: [] },
  'webgpu-capabilities': { features: [], limits: { maxTextureDimension1D: 1, maxTextureDimension2D: 1, maxTextureDimension3D: 1, maxBufferSize: 1, maxComputeWorkgroupSizeX: 1 } },
  'canvas-text-metrics': { scale: 1 }, 'audio-fingerprint': null,
  'audio-metadata': { sampleRate: 48000, baseLatency: 0, outputLatency: 0, maxChannelCount: 1 },
  'clock-precision': { resolutionMs: 100 }, 'canvas-font-policy': { families: [], fallback: 'sans-serif' },
  'browser-surface': { disabledGlobals: [], disabledNavigator: [], chrome: 'hidden' }, 'webgl-readback': null
});

export function installApiCustomOpaque(realm, id, installRtc, installExtended) {
  const getOwn = Object.getOwnPropertyDescriptor, define = Object.defineProperty;
  const documentMarker = Symbol.for('detect.expert/api-custom/document/v2');
  if (!['about:', 'blob:', 'data:'].includes(realm.location?.protocol)) return;
  const captureDeny = Symbol.for('detect.expert/api-custom/value-capture-deny/v1');
  try {
    const existing = getOwn(realm, captureDeny);
    if (!existing || existing.configurable) define(realm, captureDeny, { __proto__: null, value: true, configurable: false, enumerable: false, writable: false });
  } catch { /* Observer policy independently denies non-extensible/inaccessible realms. */ }
  if (getOwn(realm, documentMarker)?.value === true) return;
  const selected = getOwn(API_CUSTOM_OPAQUE_NEUTRALS, id);
  if (!selected || !Object.hasOwn(selected, 'value')) return;
  if (id === 'webrtc' && typeof installRtc !== 'function') return;
  // The common entry's auto-initializer runs before specialized entry modules.
  // It must not plant their immutable marker before the real installer executes.
  if (SPECIALIZED_OPAQUE_IDS.has(id) && typeof installExtended !== 'function') return;
  const marker = Symbol.for('detect.expert/api-custom/opaque/' + id + '/v1');
  if (getOwn(realm, marker)?.value === true) return;
  // These are internal withholding states, deliberately distinct from the
  // user's validated Custom values (for example, a zero CPU count).
  if (id === 'webrtc') {
    installRtc(realm, [{ id, mode: 'custom', value: selected.value }]);
    // Opaque realms cannot read the chosen address profile. Do not create a
    // connection there; borrowed metadata accessors remain sanitized as well.
    for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'mozRTCPeerConnection']) {
      const field = getOwn(realm, name);
      if (field?.configurable) Reflect.deleteProperty(realm, name);
    }
  } else if (typeof installExtended === 'function') installExtended(realm, [{ id, mode: 'custom', value: selected.value }]);
  else installApiCustom(realm, [{ id, mode: 'custom', value: selected.value, ...(id === 'media-enumeration' ? { shield: true } : {}) }]);
  if (id === 'webgpu') {
    // Keep prototype metadata blank as well as withholding a newly requested
    // adapter. A null request result alone does not cover a borrowed info getter.
    installApiCustom(realm, [{ id, mode: 'custom', value: null }]);
  }
  define(realm, marker, { value: true, configurable: false, writable: false });
  // Installer handles and all captured originals remain inside their closures.
}

if (typeof __DETECT_EXPERT_OPAQUE_API_ID__ === 'string') installApiCustomOpaque(globalThis, __DETECT_EXPERT_OPAQUE_API_ID__);
