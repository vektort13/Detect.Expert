// ADR-048: versioned, local-only API test configurations. No browser or storage access.
import { PROTECTION_FEATURES, PROTECTION_FEATURES_V1 } from './protection-features.mjs';
import { WASM_SURFACES } from './webassembly-apis.mjs';
import { API_MATH_FUNCTIONS } from './math-functions.mjs';
import { FINGERPRINT_CUSTOM_ENTRIES, validateFingerprintCustomValue } from './fingerprint-custom-values.mjs';
export { API_MATH_FUNCTIONS } from './math-functions.mjs';

export const API_CONFIGURATION_FORMAT = 'detect.expert/api-configuration';
// Formats 5-10 share one envelope; each later format pairs with one more catalog. Catalog 8 (format 7, published in
// release 2.0.0) widens three value domains (Custom geolocation, the sparse Canvas algorithm, the mDNS WebRTC host mode)
// and refreshes the reasons of CATALOG_V8_CHANGED (ADR-105/106). Catalog 9 (format 8, ADR-107, published in round 4) adds
// the speech-voices language filter and the Chrome-measured presets/names of CATALOG_V9_CHANGED. Catalog 10 (format 9,
// round 5) changes only the media-capabilities row (type media-codecs: the flags plus hidden codec families) and, in
// format 9 only, adds the library profile fields tags and note and the Firefox-only WebRTC policy proxy_only. Catalog 11
// (format 10, ADR-112) changes exactly the rows of CATALOG_V11_CHANGED: Canvas gains the algorithm sparse-rgb-v2 (first
// preset), and the first presets of the WebGL capability, WebGPU adapter and WebGPU capability rows are what a real
// Chrome reports. Format 10 has the field set of format 9. Every catalog 1-10 value stays valid; formats and catalogs
// 1-10 keep their exact value domains, field sets, presets and policy list.
export const API_CONFIGURATION_VERSION = 10;
export const API_CONFIGURATION_CATALOG_VERSION = 11;
// Formats 2-8 know three native WebRTC policies; format 9 adds proxy_only, which only Firefox can apply.
export const API_WEBRTC_NETWORK_POLICIES_V8 = Object.freeze(['system', 'default_public_interface_only', 'disable_non_proxied_udp']);
export const API_WEBRTC_NETWORK_POLICIES = Object.freeze([...API_WEBRTC_NETWORK_POLICIES_V8, 'proxy_only']);
export const API_CONFIGURATION_MAX_VALUES = 1000;
export const API_CONFIGURATION_MAX_PROFILES = 128;
export const API_CONFIGURATION_MAX_BYTES = 4 * 1024 * 1024;
// Format 9 library profile metadata: a few short tags (trimmed, unique ignoring case) and a plain-text note.
export const API_PROFILE_MAX_TAGS = 8;
export const API_PROFILE_TAG_MAX = 24;
export const API_PROFILE_NOTE_MAX = 500;
// Catalog 10 media-codecs: the codec families a Custom profile can report as unsupported, always stored in this order.
export const API_MEDIA_CODEC_FAMILIES = Object.freeze(['h264', 'h265', 'av1', 'vp9', 'vp8', 'aac', 'opus', 'vorbis', 'flac', 'mp3', 'dolby']);
const MAX_SITES = 128;
const MODES = ['on', 'bypass', 'off', 'custom'];
const GROUPS = {
  graphics: ['canvas-readback', 'webgl', 'webgpu', 'local-fonts', 'window-management', 'videoframe-readback', 'screen-extended'],
  media: ['audio', 'webrtc', 'media-enumeration', 'media-capture', 'speech-voices', 'webcodecs-capabilities', 'media-capabilities', 'encrypted-media', 'hdcp-policy', 'autoplay-policy', 'webrtc-codecs'],
  device: ['battery', 'network-information', 'client-hints', 'keyboard', 'idle-detection', 'compute-pressure', 'geolocation', 'generic-sensors', 'device-motion', 'hardware-concurrency', 'device-memory', 'performance-memory', 'cpu-performance', 'touch-points'],
  hardware: ['bluetooth', 'usb', 'serial', 'hid', 'midi', 'gamepads', 'webxr'],
  background: ['service-worker', 'push', 'background-sync', 'periodic-sync', 'notifications', 'background-fetch', 'shared-worker', 'dedicated-worker'],
  browser: ['clipboard-read', 'clipboard-write', 'webassembly', 'permission-probes', 'reporting-observer', 'feature-policy'],
  system: ['screen-wake-lock', 'picture-in-picture', 'document-picture-in-picture', 'fullscreen', 'pointer-lock', 'file-system-pickers', 'protocol-handlers', 'installed-related-apps', 'media-session'],
  ai: ['speech-recognition', 'shape-detection', 'handwriting-recognition', 'webnn', 'builtin-ai-models', 'translation-ai'],
  storage: ['storage-estimate', 'legacy-quota', 'persistent-storage', 'indexeddb-enumeration', 'cache-storage', 'opfs', 'storage-buckets', 'cookie-store', 'document-cookie'],
  network: ['cast-discovery', 'websocket', 'webtransport', 'send-beacon', 'fetch-later'],
  identity: ['credential-management', 'platform-authenticator', 'fedcm-user-info', 'storage-access', 'private-state-tokens', 'payment-probes', 'web-share']
};
const EXTRA = [
  ['navigator-platform', 'Navigator.platform', 'system'],
  ['navigator-user-agent', 'Navigator.userAgent', 'system'],
  ['navigator-language', 'Navigator.language', 'system'],
  ['navigator-languages', 'Navigator.languages', 'system'],
  ['navigator-vendor', 'Navigator.vendor', 'system'],
  ['navigator-app-version', 'Navigator.appVersion', 'system'],
  ['navigator-oscpu', 'Navigator.oscpu', 'system'],
  ['screen-width', 'Screen.width', 'graphics'],
  ['screen-height', 'Screen.height', 'graphics'],
  ['screen-avail-width', 'Screen.availWidth', 'graphics'],
  ['screen-avail-height', 'Screen.availHeight', 'graphics'],
  ['screen-color-depth', 'Screen.colorDepth', 'graphics'],
  ['screen-pixel-depth', 'Screen.pixelDepth', 'graphics'],
  ['window-device-pixel-ratio', 'Window.devicePixelRatio', 'graphics'],
  ['screen-orientation', 'ScreenOrientation.type / angle', 'graphics'],
  ['timezone', 'Intl.DateTimeFormat timeZone', 'system']
];
const spec = (type, values, options = {}) => ({ type, values, ...options });
// ADR-064: freeze the complete previous metadata for strict, lossless imports.
const WEBRTC_SPEC_V3 = spec('webrtc', [
    { addresses: null, iceTransportPolicy: 'preserve', randomizeDevices: false, freshCertificates: false, deviceLifetime: 'session' },
    { addresses: { host: '192.0.2.10', stun: '198.51.100.10', turn: '203.0.113.10' }, iceTransportPolicy: 'preserve', randomizeDevices: false, freshCertificates: false, deviceLifetime: 'session' },
    { addresses: { host: '2001:db8::10', stun: '2001:db8::20', turn: '2001:db8::30' }, iceTransportPolicy: 'preserve', randomizeDevices: false, freshCertificates: false, deviceLifetime: 'session' },
    { addresses: null, iceTransportPolicy: 'relay', randomizeDevices: true, freshCertificates: true, deviceLifetime: 'session' },
    { addresses: null, iceTransportPolicy: 'preserve', randomizeDevices: true, freshCertificates: true, deviceLifetime: 'site' }
]);
function upgradeWebRtcAddresses(addresses) {
  if (addresses === null) return null;
  const output = { ipv4: { host: null, stun: null, turn: null }, ipv6: { host: null, stun: null, turn: null } };
  for (const key of ['host', 'stun', 'turn']) output[addresses[key].includes(':') ? 'ipv6' : 'ipv4'][key] = addresses[key];
  return output;
}
// Published catalogs retain their exact metadata and value domains even when
// a new catalog expands a Custom profile or its function allowlist.
const MATH_FUNCTIONS_V6 = Object.freeze(API_MATH_FUNCTIONS.slice(0, 20));
const SPECS_V6 = {
  'canvas-readback': spec('canvas-projection', [{ algorithm: 'stable-rgb-v1' }]),
  'math-transcendentals': spec('math-transcendentals', [
    { algorithm: 'deterministic-ulp-v1', functions: [...MATH_FUNCTIONS_V6] },
    { algorithm: 'deterministic-ulp-v1', functions: ['cos', 'sin', 'tan'] },
    { algorithm: 'deterministic-ulp-v1', functions: ['exp', 'expm1', 'log', 'log1p', 'log2', 'log10'] },
    { algorithm: 'deterministic-ulp-v1', functions: ['tanh'] }
  ], { allowedFunctions: MATH_FUNCTIONS_V6 }),
  webrtc: spec('webrtc', WEBRTC_SPEC_V3.values.map(value => ({ ...value, addresses: upgradeWebRtcAddresses(value.addresses) }))),
  'hardware-concurrency': spec('integer', [2, 4, 8, 16, 32], { min: 1, max: 1024 }),
  'device-memory': spec('number', [0.5, 1, 2, 4, 8], { min: 0.25, max: 1024 }),
  'touch-points': spec('integer', [0, 1, 2, 5, 10], { min: 0, max: 256 }),
  'screen-extended': spec('boolean', [false, true]),
  'navigator-platform': spec('string', ['Win32', 'Linux x86_64', 'MacIntel', 'Linux armv8l', 'iPhone']),
  'navigator-user-agent': spec('string', ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Mozilla/5.0 (X11; Linux x86_64)', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'Mozilla/5.0 (Linux; Android 14)', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)']),
  'navigator-language': spec('language', ['en-US', 'ru-RU', 'de-DE', 'fr-FR', 'ja-JP']),
  'navigator-languages': spec('languages', [['en-US', 'en'], ['ru-RU', 'ru'], ['de-DE', 'de'], ['fr-FR', 'fr'], ['ja-JP', 'ja']]),
  'navigator-vendor': spec('string', ['', 'Google Inc.', 'Apple Computer, Inc.']),
  'navigator-app-version': spec('string', ['5.0 (Windows)', '5.0 (X11)', '5.0 (Macintosh)', '5.0 (Linux; Android 14)', '5.0 (iPhone)']),
  'navigator-oscpu': spec('string', ['Windows NT 10.0; Win64; x64', 'Linux x86_64', 'Intel Mac OS X 10.15', 'Linux aarch64', ''], { allowUndefined: true }),
  'screen-width': spec('integer', [1280, 1366, 1920, 2560, 3840], { min: 1, max: 32768 }),
  'screen-height': spec('integer', [720, 768, 1080, 1440, 2160], { min: 1, max: 32768 }),
  'screen-avail-width': spec('integer', [1280, 1366, 1920, 2560, 3840], { min: 0, max: 32768 }),
  'screen-avail-height': spec('integer', [680, 728, 1040, 1400, 2120], { min: 0, max: 32768 }),
  'screen-color-depth': spec('integer', [8, 16, 24, 30, 32], { min: 1, max: 64 }),
  'screen-pixel-depth': spec('integer', [8, 16, 24, 30, 32], { min: 1, max: 64 }),
  'window-device-pixel-ratio': spec('number', [1, 1.25, 1.5, 2, 3], { min: 0.1, max: 16 }),
  'timezone': spec('timezone', [{ timeZone: 'UTC', offsetMinutes: 0 }, { timeZone: 'Europe/London', offsetMinutes: 0 }, { timeZone: 'Europe/Berlin', offsetMinutes: -60 }, { timeZone: 'America/New_York', offsetMinutes: 300 }, { timeZone: 'Asia/Tokyo', offsetMinutes: -540 }]),
  'screen-orientation': spec('orientation', [{ type: 'landscape-primary', angle: 0 }, { type: 'portrait-primary', angle: 90 }, { type: 'landscape-secondary', angle: 180 }, { type: 'portrait-secondary', angle: 270 }]),
  'webgl': spec('webgl', [{ vendor: 'WebKit', renderer: 'WebKit WebGL', unmaskedVendor: 'Intel', unmaskedRenderer: 'Intel Iris Xe Graphics' }, { vendor: 'WebKit', renderer: 'WebKit WebGL', unmaskedVendor: 'NVIDIA', unmaskedRenderer: 'NVIDIA GeForce RTX 3060' }, { vendor: 'WebKit', renderer: 'WebKit WebGL', unmaskedVendor: 'AMD', unmaskedRenderer: 'AMD Radeon RX 6600' }, { vendor: 'WebKit', renderer: 'WebKit WebGL', unmaskedVendor: 'Apple', unmaskedRenderer: 'Apple M2' }]),
  'webgpu': spec('webgpu', [{ vendor: 'intel', architecture: '', device: '', description: 'Intel Iris Xe Graphics' }, { vendor: 'nvidia', architecture: '', device: '', description: 'NVIDIA GeForce RTX 3060' }, { vendor: 'amd', architecture: '', device: '', description: 'AMD Radeon RX 6600' }, { vendor: 'apple', architecture: '', device: '', description: 'Apple M2' }, null], { allowNull: true }),
  'media-enumeration': spec('media-devices', [[], [{ deviceId: 'test-audio-input', groupId: 'test-group', kind: 'audioinput', label: 'Test microphone' }], [{ deviceId: 'test-video-input', groupId: 'test-group', kind: 'videoinput', label: 'Test camera' }], [{ deviceId: 'test-audio-output', groupId: 'test-group', kind: 'audiooutput', label: 'Test speaker' }]]),
  battery: spec('battery', [{ charging: true, chargingTime: 0, dischargingTime: null, level: 1 }, { charging: false, chargingTime: null, dischargingTime: 7200, level: 0.75 }, { charging: false, chargingTime: null, dischargingTime: 3600, level: 0.5 }, { charging: true, chargingTime: 1800, dischargingTime: null, level: 0.25 }, { charging: false, chargingTime: null, dischargingTime: 600, level: 0.1 }]),
  'network-information': spec('network', [{ downlink: 10, effectiveType: '4g', rtt: 50, saveData: false }, { downlink: 1.5, effectiveType: '3g', rtt: 300, saveData: false }, { downlink: 0.1, effectiveType: '2g', rtt: 1400, saveData: true }, { downlink: 0.01, effectiveType: 'slow-2g', rtt: 2000, saveData: true }, { downlink: 100, effectiveType: '4g', rtt: 0, saveData: false }]),
  'performance-memory': spec('memory', [{ jsHeapSizeLimit: 2147483648, totalJSHeapSize: 33554432, usedJSHeapSize: 16777216 }, { jsHeapSizeLimit: 4294967296, totalJSHeapSize: 67108864, usedJSHeapSize: 33554432 }, { jsHeapSizeLimit: 1073741824, totalJSHeapSize: 16777216, usedJSHeapSize: 8388608 }]),
  'client-hints': spec('client-hints', [{ brands: [{ brand: 'Chromium', version: '130' }], mobile: false, platform: 'Windows' }, { brands: [{ brand: 'Chromium', version: '130' }], mobile: false, platform: 'macOS' }, { brands: [{ brand: 'Chromium', version: '130' }], mobile: false, platform: 'Linux' }, { brands: [{ brand: 'Chromium', version: '130' }], mobile: true, platform: 'Android' }]),
  'storage-estimate': spec('storage', [{ quota: 1073741824, usage: 0 }, { quota: 10737418240, usage: 1048576 }, { quota: 107374182400, usage: 1073741824 }, { quota: 0, usage: 0 }]),
  'autoplay-policy': spec('autoplay', ['allowed', 'allowed-muted', 'disallowed']),
  gamepads: spec('empty-array', [[]]),
  'speech-voices': spec('empty-array', [[]]),
  bluetooth: spec('bluetooth', [{ available: true, devices: [] }, { available: false, devices: [] }]),
  usb: spec('empty-array', [[]]), hid: spec('empty-array', [[]]), serial: spec('empty-array', [[]]),
  notifications: spec('notification', ['default', 'denied', 'granted']),
  'media-capabilities': spec('media-capabilities', [{ supported: false, smooth: false, powerEfficient: false }, { supported: true, smooth: true, powerEfficient: true }, { supported: true, smooth: true, powerEfficient: false }, { supported: true, smooth: false, powerEfficient: false }])
};
freeze(SPECS_V6);
// Catalog 7 value domains (ADR-087), frozen for strict historical imports.
const SPECS_V7 = freeze({
  ...SPECS_V6,
  'math-transcendentals': spec('math-transcendentals', [
    { algorithm: 'deterministic-ulp-v1', functions: [...API_MATH_FUNCTIONS] },
    ...SPECS_V6['math-transcendentals'].values.slice(1)
  ], { allowedFunctions: API_MATH_FUNCTIONS }),
  'client-hints': { ...SPECS_V6['client-hints'], allowFormFactors: true },
  ...Object.fromEntries(FINGERPRINT_CUSTOM_ENTRIES.map(entry => [entry.id, entry.spec]))
});
// Catalog 8: Canvas gains the sparse algorithm (first preset), WebRTC accepts the mdns host mode and geolocation
// becomes Custom-capable. Presets are city centres with 25 m accuracy; labels are the city names.
const CANVAS_ALGORITHMS_V7 = Object.freeze(['stable-rgb-v1']);
// Catalogs 8-10 (frozen): the sparse-rgb-v1 era. Catalog 11 adds sparse-rgb-v2 as the first preset (see SPECS below).
const CANVAS_ALGORITHMS_V8 = Object.freeze(['sparse-rgb-v1', 'stable-rgb-v1']);
const CANVAS_ALGORITHMS = Object.freeze(['sparse-rgb-v2', 'sparse-rgb-v1', 'stable-rgb-v1']);
const GEOLOCATION_CITIES = freeze([['New York', 40.7128, -74.006], ['London', 51.5074, -0.1278], ['Berlin', 52.52, 13.405], ['Paris', 48.8566, 2.3522], ['Tokyo', 35.6762, 139.6503], ['Sydney', -33.8688, 151.2093]]);
// Catalog 8 value domains (published), frozen for strict historical imports.
const SPECS_V8 = freeze({
  ...SPECS_V7,
  'canvas-readback': spec('canvas-projection', CANVAS_ALGORITHMS_V8.map(algorithm => ({ algorithm })), { algorithms: CANVAS_ALGORITHMS_V8 }),
  webrtc: spec('webrtc', SPECS_V6.webrtc.values, { allowMdns: true }),
  geolocation: spec('geolocation', GEOLOCATION_CITIES.map(([, latitude, longitude]) => ({ latitude, longitude, accuracy: 25 })), { labels: GEOLOCATION_CITIES.map(([name]) => name) })
});
// Catalog 9 (ADR-107, published in round 4; frozen as SPECS_V9, NAMES_V9 and CUSTOM_REASONS_V9): Chrome-possible presets
// measured in Chrome 156 (Windows, deviceMemory 32): network values on
// 50 ms / 0.05 Mbps steps without a desktop connection type, quota = usage + 10 GiB, the 4395630592-byte heap limit with
// a light and a busy page, a 0.1 ms clock and the five built-in PDF viewer plugins sharing application/pdf and text/pdf.
const MIB = 1048576, CHROME_QUOTA_HEADROOM = 10 * 1024 * MIB;
const CHROME_PDF_PLUGINS = freeze(['PDF Viewer', 'Chrome PDF Viewer', 'Chromium PDF Viewer', 'Microsoft Edge PDF Viewer', 'WebKit built-in PDF'].map(name => ({
  name, filename: 'internal-pdf-viewer', description: 'Portable Document Format',
  mimeTypes: ['application/pdf', 'text/pdf'].map(type => ({ type, suffixes: 'pdf', description: 'Portable Document Format' }))
})));
const SPECS_V9 = freeze({
  ...SPECS_V8,
  'network-information': spec('network', [
    { downlink: 1.5, effectiveType: '4g', rtt: 100, saveData: false }, { downlink: 10, effectiveType: '4g', rtt: 50, saveData: false },
    // Chrome 156 derives effectiveType from the raw rtt alone (>= 272 3g, >= 1420 2g, >= 2010 slow-2g): each preset agrees.
    { downlink: 1.5, effectiveType: '3g', rtt: 300, saveData: false }, { downlink: 0.1, effectiveType: '2g', rtt: 1450, saveData: true },
    { downlink: 0.05, effectiveType: 'slow-2g', rtt: 2050, saveData: true }
  ]),
  'storage-estimate': spec('storage', [0, MIB, 10 * MIB, 100 * MIB].map(usage => ({ quota: CHROME_QUOTA_HEADROOM + usage, usage }))),
  'performance-memory': spec('memory', [{ jsHeapSizeLimit: 4395630592, totalJSHeapSize: 1573038, usedJSHeapSize: 1092582 }, { jsHeapSizeLimit: 4395630592, totalJSHeapSize: 26443950, usedJSHeapSize: 25083726 }]),
  // The historical empty list or a filter of the native voices by 1-8 canonical BCP 47 tags; voices are never created.
  'speech-voices': spec('speech-voices', [{ languages: ['en-US'] }, { languages: ['en-US', 'en-GB'] }, []]),
  'clock-precision': { ...SPECS_V7['clock-precision'], values: [{ resolutionMs: 0.1 }, { resolutionMs: 1 }, { resolutionMs: 10 }] },
  'navigator-plugins': { ...SPECS_V7['navigator-plugins'], values: [{ plugins: CHROME_PDF_PLUGINS }, { plugins: [] }], labels: ['Chrome built-in PDF viewer (5 plugins)', 'No plugins'] }
});
// Catalog 9 row names that differ from catalog 8 (published).
const NAMES_V9 = Object.freeze({ 'audio-fingerprint': 'AudioBuffer.getChannelData / copyFromChannel / AnalyserNode readouts' });
// Catalog 10 value domain (round 5): the media-capabilities flags plus the hidden codec families. The historical
// media-capabilities type stays byte-identical in catalogs 1-9; the presets hide nothing. Frozen as SPECS_V10.
const SPECS_V10 = freeze({
  ...SPECS_V9,
  'media-capabilities': spec('media-codecs', [
    { supported: false, smooth: false, powerEfficient: false, hidden: [] },
    { supported: true, smooth: true, powerEfficient: true, hidden: [] },
    { supported: true, smooth: true, powerEfficient: false, hidden: [] },
    { supported: true, smooth: false, powerEfficient: false, hidden: [] }
  ])
});
// Catalog 11 (ADR-112, format 10). Canvas: sparse-rgb-v2 is the first preset; sparse-rgb-v1 and stable-rgb-v1 stay valid saved values.
// The first preset of a row is what the Custom editor applies when the row is switched to Custom, so it must be what a real
// Chrome reports (measured in Chromium 153 on Windows, D3D11/D3D12): the WebGL limits of a desktop GPU with every extension left
// native (a list would hide extensions, e.g. WEBGL_debug_renderer_info and EXT_disjoint_timer_query), a WebGPU adapter whose
// device and description are blank as in Chrome (vendor and architecture only) and the WebGPU features that adapter reports.
// A features list can only filter what the adapter has; it never adds a feature.
const CHROME_WEBGPU_FEATURES = Object.freeze(['bgra8unorm-storage', 'clip-distances', 'core-features-and-limits', 'depth-clip-control', 'depth32float-stencil8', 'dual-source-blending', 'float32-blendable', 'float32-filterable', 'indirect-first-instance', 'primitive-index', 'rg11b10ufloat-renderable', 'shader-f16', 'subgroup-size-control', 'subgroups', 'texture-component-swizzle', 'texture-compression-bc', 'texture-compression-bc-sliced-3d', 'texture-formats-tier1', 'texture-formats-tier2', 'timestamp-query']);
const CHROME_WEBGPU_FEATURES_OLDER = Object.freeze(['bgra8unorm-storage', 'depth-clip-control', 'depth32float-stencil8', 'indirect-first-instance', 'rg11b10ufloat-renderable', 'shader-f16', 'texture-compression-bc', 'timestamp-query']);
const SPECS = freeze({
  ...SPECS_V10,
  'canvas-readback': spec('canvas-projection', CANVAS_ALGORITHMS.map(algorithm => ({ algorithm })), { algorithms: CANVAS_ALGORITHMS }),
  'webgl-capabilities': { type: 'webgl-capabilities', bundle: 'webgl-capabilities', values: [
    { parameters: { MAX_TEXTURE_SIZE: 16384, MAX_RENDERBUFFER_SIZE: 16384, MAX_VIEWPORT_DIMS: [32767, 32767], MAX_CUBE_MAP_TEXTURE_SIZE: 16384, MAX_VERTEX_ATTRIBS: 16, MAX_TEXTURE_IMAGE_UNITS: 16 } },
    { parameters: { MAX_TEXTURE_SIZE: 8192, MAX_RENDERBUFFER_SIZE: 8192, MAX_VIEWPORT_DIMS: [16384, 16384], MAX_CUBE_MAP_TEXTURE_SIZE: 8192, MAX_VERTEX_ATTRIBS: 16, MAX_TEXTURE_IMAGE_UNITS: 16 } }
  ], labels: ['Desktop limits (16384), all extensions native', 'Lower limits (8192), all extensions native'] },
  webgpu: spec('webgpu', [
    { vendor: 'intel', architecture: 'gen-12lp', device: '', description: '' }, { vendor: 'nvidia', architecture: 'turing', device: '', description: '' },
    { vendor: 'amd', architecture: 'rdna-2', device: '', description: '' }, null
  ], { allowNull: true, labels: ['Intel (gen-12lp)', 'NVIDIA (turing)', 'AMD (rdna-2)', 'No adapter (null)'] }),
  'webgpu-capabilities': { type: 'webgpu-capabilities', bundle: 'webgpu-capabilities', values: [{ features: [...CHROME_WEBGPU_FEATURES] }, { features: [...CHROME_WEBGPU_FEATURES_OLDER] }], labels: ['Chrome 153 desktop features (20)', 'Older Chrome desktop features (8)'] }
});
const CATALOG_SPECS = new WeakMap();
export const API_CUSTOM_ONLY_IDS = Object.freeze(['timezone', 'math-transcendentals', ...FINGERPRINT_CUSTOM_ENTRIES.map(entry => entry.id)]);
const tagged = value => value === null ? { kind: 'null' } : { kind: 'value', value };
const clone = value => JSON.parse(JSON.stringify(value));
function freeze(value) { if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } return value; }
// Published catalogs 3-7 keep these texts; catalog 8 overrides or adds the ones below.
const CUSTOM_REASONS_V7 = {
  'canvas-readback': 'Deterministic Window Canvas and accessible OffscreenCanvas ImageData/PNG readback projection, including covered export methods. Native drawing, WebGL readPixels and workers are unchanged. Readbacks above four megapixels are denied rather than returned unchanged.',
  'math-transcendentals': 'Session/origin keyed deterministic shifts of at most one ULP for selected inexact Math results. Exact and special cases stay native. Workers, CSS, WebAssembly and ** are unchanged. On is unavailable.',
  webrtc: 'IP overrides change JavaScript metadata; network routing is controlled separately. Device identifiers are aliases. Fresh certificates use native generation for each connection.',
  timezone: 'Overrides resolvedOptions().timeZone for all DateTimeFormat instances, including explicitly chosen formatter zones, and a fixed Date.getTimezoneOffset. Date formatting, local date fields, and daylight saving rules are unchanged. On is unavailable for this entry.',
  'client-hints': 'JavaScript metadata only; HTTP User-Agent Client Hints headers are unchanged.',
  'navigator-user-agent': 'JavaScript userAgent only; HTTP User-Agent headers are unchanged.',
  'media-enumeration': 'Enumeration metadata only; no camera, microphone, or media stream is created.',
  notifications: 'Notification.permission metadata only; native notification permission is unchanged.',
  bluetooth: 'Availability metadata and empty paired-device enumeration only; no device is created or paired.',
  webgl: 'Vendor and renderer metadata only; graphics capabilities and rendering are unchanged.',
  webgpu: 'Adapter metadata or a null adapter result only; GPU capabilities and rendering are unchanged.',
  'media-capabilities': 'Capability result metadata only; codecs and actual decoding or encoding are unchanged.',
  'storage-estimate': 'Quota and usage result metadata only; actual browser storage limits are unchanged.'
};
// Catalog 8 texts (published); catalog 9 adds the two texts of CUSTOM_REASONS_V9.
const CUSTOM_REASONS_V8 = {
  ...CUSTOM_REASONS_V7,
  'canvas-readback': 'Deterministic Window Canvas and accessible OffscreenCanvas ImageData/PNG readback projection, including covered export methods. sparse-rgb-v1 (default) changes one RGB level in about 1% of fully opaque pixels; stable-rgb-v1 changes every fully opaque pixel by one level and is kept for older profiles. Native drawing, WebGL readPixels and workers are unchanged. Readbacks above four megapixels are denied rather than returned unchanged.',
  webrtc: 'IP overrides change JavaScript metadata; network routing is controlled separately. A host of mdns hides the local address behind a random <uuid>.local name in JavaScript metadata, like Chrome without a camera or microphone grant; no name resolution is performed. Device identifiers are aliases. Fresh certificates use native generation for each connection.',
  geolocation: 'Coordinates and accuracy of successful getCurrentPosition and watchPosition results only. The permission prompt, denial, timeout and unavailable errors stay native; no location or permission is created and the timestamp stays native.',
  'navigator-user-agent': "JavaScript userAgent. In Chrome with Antidetect's all-sites scope the HTTP User-Agent request header follows the same value (ADR-105); other engines and scopes leave HTTP headers unchanged.",
  'client-hints': "JavaScript userAgentData metadata. In Chrome with Antidetect's all-sites scope the low-entropy Sec-CH-UA headers follow it and high-entropy hints are removed from requests (ADR-105); other engines and scopes leave HTTP headers unchanged.",
  'navigator-language': "JavaScript Navigator.language. In Chrome with Antidetect's all-sites scope the HTTP Accept-Language request header follows it when navigator-languages is not Custom (ADR-105); other engines and scopes leave HTTP headers unchanged.",
  'navigator-languages': "JavaScript Navigator.languages. In Chrome with Antidetect's all-sites scope the HTTP Accept-Language request header follows this list (ADR-105); other engines and scopes leave HTTP headers unchanged.",
  'storage-estimate': 'Quota and usage result metadata only; actual browser storage limits are unchanged. The same selected snapshot answers StorageManager.estimate, StorageBucket.estimate and the deprecated webkitTemporaryStorage/webkitPersistentStorage queryUsageAndQuota and requestQuota (ADR-106).'
};
const CUSTOM_REASONS_V9 = Object.freeze({
  ...CUSTOM_REASONS_V8,
  'speech-voices': 'Either an empty voice list or the native voices filtered to the selected languages (1-8 BCP 47 tags). No voice is created and native voice metadata is unchanged.',
  'audio-fingerprint': 'Deterministic per-profile noise, smaller than the selected amplitude, in engine-produced AudioBuffer channel data (getChannelData, copyFromChannel) and in AnalyserNode readouts. Buffers the page created itself are returned natively; audio processing is otherwise unchanged.'
});
// Catalog 10 texts (frozen): catalog 9 plus the media-capabilities reason.
const CUSTOM_REASONS_V10 = Object.freeze({
  ...CUSTOM_REASONS_V9,
  'media-capabilities': 'Capability result metadata. A Custom flag can only lower what this browser reports: supported, smooth and power efficient are combined with the native answer, and hidden codec families are reported as unsupported by MediaCapabilities, canPlayType and isTypeSupported. Real decoding and encoding are unchanged.'
});
// Catalog 11 texts (ADR-112): the Canvas projection, the WebGL capability and WebGPU capability rows.
const CUSTOM_REASONS = Object.freeze({
  ...CUSTOM_REASONS_V10,
  'canvas-readback': 'Deterministic Window Canvas and accessible OffscreenCanvas ImageData/PNG readback projection, including covered export methods and the exports of WebGL canvases. sparse-rgb-v2 (default) sets the lowest bit of one colour channel of opaque pixels, so a projected image read back again stays unchanged (up to 512x512 every pixel with a channel that is not 0, 1, 254 or 255 is a candidate and about half of them change; above that about 1% are candidates). Canvases of up to 262,144 pixels with at most four colours (flat fills, two-colour patterns) are returned as drawn. sparse-rgb-v1 and stable-rgb-v1 are kept for saved profiles. A page that knows its own drawing can still tell that a profile is active. Native drawing and workers are unchanged; readbacks above four megapixels are denied rather than returned unchanged.',
  'webgl-capabilities': 'getParameter limits can only be lowered. When a list of extensions is set, every extension that is not on it is hidden, except WEBGL_lose_context, which is never hidden; leave the list out to keep the native extensions. Rendering and readback are unchanged.',
  'webgpu-capabilities': 'Limits can only be lowered and features are filtered to the listed names; a feature the adapter does not have is never added. GPU rendering is unchanged.'
});
function catalogItem(id, index, name, group, historical = false, override = null, reasons = CUSTOM_REASONS_V7) {
  const item = historical && (id === 'webrtc' || id === 'canvas-readback') ? undefined : override ?? SPECS_V6[id];
  const entry = { id, order: index, name, group, type: item?.type ?? 'unsupported', customSupported: !!item,
    customReason: !item ? 'This API requires native objects, permissions, or side effects; Custom is unavailable.' : reasons[id] ?? (item.type === 'empty-array' ? 'Custom supports an empty enumeration only; native devices are not created.' : null),
    valueHint: item?.min !== undefined ? `${item.type}: ${item.min}–${item.max}` : item?.type ?? 'Native API operation',
    allowNull: !!item?.allowNull, allowUndefined: !!item?.allowUndefined,
    presets: (item?.values ?? []).map((value, presetIndex) => ({ id: `preset-${presetIndex + 1}`, label: item.labels?.[presetIndex] ?? (typeof value === 'string' ? value || '(empty string)' : typeof value === 'object' ? JSON.stringify(value) : String(value)), value: tagged(value) })) };
  if (item) CATALOG_SPECS.set(entry, item);
  return entry;
}
// Preserve all 105 version-1 IDs, positions and metadata for strict migration.
// Changing historical metadata requires a new historical schema, never leniency.
export const API_CONFIG_CATALOG_V1 = freeze([
  ...PROTECTION_FEATURES_V1.map((id, index) => catalogItem(id, index, id, Object.keys(GROUPS).find(group => GROUPS[group].includes(id)) ?? 'browser', true)),
  ...EXTRA.map(([id, name, group], index) => catalogItem(id, index + PROTECTION_FEATURES_V1.length, name, group, true))
]);
export const API_CONFIG_CATALOG_V2 = freeze([
  ...API_CONFIG_CATALOG_V1,
  ...WASM_SURFACES.map((surface, index) => catalogItem(surface.feature, index + API_CONFIG_CATALOG_V1.length, surface.operation, 'webassembly', true))
]);
export const API_CONFIG_CATALOG_V3 = freeze(API_CONFIG_CATALOG_V2.map(entry => entry.id === 'webrtc' ? catalogItem(entry.id, entry.order, entry.name, entry.group, false, WEBRTC_SPEC_V3) : entry));
const WEBRTC_CATALOG_V3 = API_CONFIG_CATALOG_V3.find(entry => entry.id === 'webrtc');
export const API_CONFIG_CATALOG_V4 = freeze(API_CONFIG_CATALOG_V3.map(entry => entry.id === 'webrtc' ? catalogItem(entry.id, entry.order, entry.name, entry.group) : entry));
export const API_CONFIG_CATALOG_V5 = freeze([...API_CONFIG_CATALOG_V4, catalogItem('math-transcendentals', API_CONFIG_CATALOG_V4.length, 'Math transcendental functions', 'browser')]);
export const API_CONFIG_CATALOG_V6 = freeze(API_CONFIG_CATALOG_V5.map(entry => entry.id === 'canvas-readback' ? catalogItem(entry.id, entry.order, entry.name, entry.group) : entry));
export const API_CONFIG_CATALOG_V7 = freeze([
  ...API_CONFIG_CATALOG_V6.map(entry => catalogItem(entry.id, entry.order, entry.name, entry.group, false, SPECS_V7[entry.id])),
  ...FINGERPRINT_CUSTOM_ENTRIES.map((entry, index) => catalogItem(entry.id, API_CONFIG_CATALOG_V6.length + index, entry.name, entry.group, false, entry.spec))
]);
// Catalog 8 (published in release 2.0.0) changes exactly these rows; every other entry is the frozen catalog 7 object.
const CATALOG_V8_CHANGED = Object.freeze(['canvas-readback', 'webrtc', 'geolocation', 'navigator-user-agent', 'client-hints', 'navigator-language', 'navigator-languages', 'storage-estimate']);
export const API_CONFIG_CATALOG_V8 = freeze(API_CONFIG_CATALOG_V7.map(entry => CATALOG_V8_CHANGED.includes(entry.id) ? catalogItem(entry.id, entry.order, entry.name, entry.group, false, SPECS_V8[entry.id], CUSTOM_REASONS_V8) : entry));
// Catalog 9 (ADR-107) changes exactly these rows of catalog 8; every other entry is the frozen catalog 8 object.
const CATALOG_V9_CHANGED = Object.freeze(['network-information', 'speech-voices', 'storage-estimate', 'performance-memory', 'navigator-plugins', 'audio-fingerprint', 'clock-precision']);
export const API_CONFIG_CATALOG_V9 = freeze(API_CONFIG_CATALOG_V8.map(entry => CATALOG_V9_CHANGED.includes(entry.id) ? catalogItem(entry.id, entry.order, NAMES_V9[entry.id] ?? entry.name, entry.group, false, SPECS_V9[entry.id], CUSTOM_REASONS_V9) : entry));
// Catalog 10 (round 5) changes exactly this row of catalog 9; every other entry is the frozen catalog 9 object.
const CATALOG_V10_CHANGED = Object.freeze(['media-capabilities']);
export const API_CONFIG_CATALOG_V10 = freeze(API_CONFIG_CATALOG_V9.map(entry => CATALOG_V10_CHANGED.includes(entry.id) ? catalogItem(entry.id, entry.order, entry.name, entry.group, false, SPECS_V10[entry.id], CUSTOM_REASONS_V10) : entry));
// Catalog 11 (ADR-112) changes exactly these rows of catalog 10; every other entry is the frozen catalog 10 object.
const CATALOG_V11_CHANGED = Object.freeze(['canvas-readback', 'webgl-capabilities', 'webgpu', 'webgpu-capabilities']);
export const API_CONFIG_CATALOG_V11 = freeze(API_CONFIG_CATALOG_V10.map(entry => CATALOG_V11_CHANGED.includes(entry.id) ? catalogItem(entry.id, entry.order, entry.name, entry.group, false, SPECS[entry.id], CUSTOM_REASONS) : entry));
export const API_CONFIG_CATALOG = API_CONFIG_CATALOG_V11;
const CATALOG = new Map(API_CONFIG_CATALOG.map(item => [item.id, item]));
export const API_CONFIG_MODES = Object.freeze([...MODES]);

class ConfigurationError extends Error {
  constructor(code, path, message) { super(message); this.code = code; this.path = path; }
}
function fail(code, path, message) { throw new ConfigurationError(code, path, message); }
function resultError(error) { return { ok: false, error: { code: error instanceof ConfigurationError ? error.code : 'invalid-structure', path: error instanceof ConfigurationError ? error.path : '$', message: error instanceof ConfigurationError ? error.message : 'Invalid configuration structure.' } }; }
function exact(value, keys, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid-type', path, 'Expected an object.');
  const actual = Object.keys(value);
  for (const key of keys) if (!Object.hasOwn(value, key)) fail('missing-field', `${path}.${key}`, 'Required field is missing.');
  for (const key of actual) if (!keys.includes(key)) fail('unknown-field', `${path}.${key}`, 'Unknown field.');
}
function text(value, min, max, path) { if (typeof value !== 'string' || value.length < min || value.length > max) fail('invalid-value', path, `Expected a string of ${min}–${max} characters.`); }
function array(value, max, path) { if (!Array.isArray(value) || value.length > max) fail('invalid-type', path, `Expected an array with at most ${max} entries.`); }
function number(value, min, max, path, integer = false) { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) fail('invalid-value', path, `Expected ${integer ? 'an integer' : 'a number'} between ${min} and ${max}.`); }
function boolean(value, path) { if (typeof value !== 'boolean') fail('invalid-value', path, 'Expected a boolean.'); }
function record(value, required, optional, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid-type', path, 'Expected an object.');
  for (const key of required) if (!Object.hasOwn(value, key)) fail('missing-field', `${path}.${key}`, 'Required field is missing.');
  for (const key of Object.keys(value)) if (![...required, ...optional].includes(key)) fail('unknown-field', `${path}.${key}`, 'Unknown field.');
}
function safeData(input) {
  let nodes = 0, characters = 0;
  function visit(value, depth, path) {
    if (++nodes > 250000 || depth > 16) fail('size-limit', path, 'Configuration is too large or too deeply nested.');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') { characters += value.length; if (characters > API_CONFIGURATION_MAX_BYTES) fail('size-limit', path, 'Configuration is too large.'); return value; }
    if (typeof value === 'number' && Number.isFinite(value)) return Object.is(value, -0) ? 0 : value;
    if (!value || typeof value !== 'object') fail('invalid-type', path, 'Only JSON data is allowed.');
    const keys = Reflect.ownKeys(value);
    if (Array.isArray(value)) {
      const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
      if (!Number.isInteger(length) || length > 2048 || keys.length !== length + 1) fail('invalid-structure', path, 'Invalid array.');
      const output = [];
      for (let i = 0; i < length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('invalid-structure', path, 'Accessors and sparse arrays are not allowed.');
        output.push(visit(descriptor.value, depth + 1, `${path}[${i}]`));
      }
      return output;
    }
    const proto = Object.getPrototypeOf(value);
    if ((proto !== null && proto !== Object.prototype) || keys.length > 2048) fail('invalid-structure', path, 'Expected a plain data object.');
    const output = Object.create(null);
    for (const key of keys) {
      if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)) fail('unknown-field', path, 'Unsafe or unknown field.');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('invalid-structure', `${path}.${key}`, 'Accessors are not allowed.');
      output[key] = visit(descriptor.value, depth + 1, `${path}.${key}`);
    }
    return output;
  }
  return visit(input, 0, '$');
}
function language(value, path) {
  text(value, 1, 64, path);
  try { if (Intl.getCanonicalLocales(value).length !== 1) throw new Error(); } catch { fail('invalid-value', path, 'Expected a valid language tag, such as en-US.'); }
}
function canonicalLanguage(value, path) {
  text(value, 1, 64, path);
  let tags = [];
  try { tags = Intl.getCanonicalLocales(value); } catch { /* reported below */ }
  if (tags.length !== 1) fail('invalid-value', path, 'Expected a valid BCP 47 language tag, such as en-US.');
  return tags[0];
}
// Labels are shown in privileged extension UI. Imported files and new or renamed labels refuse C0/C1 controls (Cc) and
// the bidirectional formatting controls ALM U+061C, LRM/RLM U+200E-U+200F, embeddings and overrides U+202A-U+202E and
// isolates U+2066-U+2069. Stored configurations keep loading unchanged.
const UNSAFE_LABEL_RANGES = Object.freeze([[0x0, 0x1f], [0x7f, 0x9f], [0x61c, 0x61c], [0x200e, 0x200f], [0x202a, 0x202e], [0x2066, 0x2069]]);
function noUnsafe(text, ranges) {
  if (typeof text !== 'string') return false;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    for (const [low, high] of ranges) if (code >= low && code <= high) return false;
  }
  return true;
}
export function apiLabelSafe(label) { return noUnsafe(label, UNSAFE_LABEL_RANGES); }
// Format 9 profile notes follow the label rules, except that line feeds (U+000A) are allowed; profile tags use apiLabelSafe.
const UNSAFE_NOTE_RANGES = Object.freeze([[0x0, 0x9], [0xb, 0x1f], [0x7f, 0x9f], [0x61c, 0x61c], [0x200e, 0x200f], [0x202a, 0x202e], [0x2066, 0x2069]]);
export function apiNoteSafe(note) { return noUnsafe(note, UNSAFE_NOTE_RANGES); }
function ipAddress(value, path) {
  text(value, 1, 45, path);
  if (/^(?:0|[1-9][0-9]{0,2})(?:\.(?:0|[1-9][0-9]{0,2})){3}$/.test(value) && value.split('.').every(part => Number(part) <= 255)) return value;
  if (!value.includes(':') || !/^[0-9a-fA-F:.]+$/.test(value)) fail('invalid-value', path, 'Expected a literal IPv4 or IPv6 address.');
  try {
    const host = new URL('http://[' + value + ']/').hostname;
    if (host.startsWith('[') && host.endsWith(']')) return host.slice(1, -1);
  } catch {}
  fail('invalid-value', path, 'Expected a literal IPv4 or IPv6 address.');
}
function readWebRtcProfile(value, path, historical = false, allowMdns = false) {
  exact(value, ['addresses', 'iceTransportPolicy', 'randomizeDevices', 'freshCertificates', 'deviceLifetime'], path);
  let addresses = null;
  if (value.addresses !== null) {
    if (historical) {
      exact(value.addresses, ['host', 'stun', 'turn'], `${path}.addresses`);
      addresses = Object.fromEntries(['host', 'stun', 'turn'].map(key => [key, ipAddress(value.addresses[key], `${path}.addresses.${key}`)]));
    } else {
      exact(value.addresses, ['ipv4', 'ipv6'], `${path}.addresses`);
      addresses = {};
      for (const family of ['ipv4', 'ipv6']) {
        const rowPath = `${path}.addresses.${family}`, row = value.addresses[family];
        exact(row, ['host', 'stun', 'turn'], rowPath);
        addresses[family] = {};
        for (const key of ['host', 'stun', 'turn']) {
          // Catalog 8: the literal mdns is a host mode, never an address, and only valid in a family host slot.
          if (key === 'host' && allowMdns && row.host === 'mdns') { addresses[family].host = 'mdns'; continue; }
          const address = row[key] === null ? null : ipAddress(row[key], `${rowPath}.${key}`);
          if (address !== null && address.includes(':') !== (family === 'ipv6')) fail('invalid-value', `${rowPath}.${key}`, `Expected a literal ${family === 'ipv6' ? 'IPv6' : 'IPv4'} address or null.`);
          addresses[family][key] = address;
        }
      }
    }
  }
  if (!['preserve', 'relay'].includes(value.iceTransportPolicy)) fail('invalid-value', `${path}.iceTransportPolicy`, 'Expected preserve or relay.');
  boolean(value.randomizeDevices, `${path}.randomizeDevices`); boolean(value.freshCertificates, `${path}.freshCertificates`);
  if (!['session', 'site'].includes(value.deviceLifetime)) fail('invalid-value', `${path}.deviceLifetime`, 'Expected session or site for device aliases.');
  return { addresses, iceTransportPolicy: value.iceTransportPolicy, randomizeDevices: value.randomizeDevices, freshCertificates: value.freshCertificates, deviceLifetime: value.deviceLifetime };
}
export function validateWebRtcProfile(input) {
  try { return { ok: true, value: readWebRtcProfile(safeData(input), '$', false, true) }; } catch (error) { return resultError(error); }
}
function validateValue(id, value, path, catalog = CATALOG) {
  const entry = catalog.get(id);
  if (!entry) fail('unknown-api', path, 'Unknown API identifier.');
  exact(value, value?.kind === 'value' ? ['kind', 'value'] : ['kind'], path);
  if (value.kind === 'unset') return { kind: 'unset' };
  if (!entry.customSupported) fail('unsupported-value', path, 'Custom values are not supported by this API.');
  if (value.kind === 'null' && entry.allowNull) return { kind: 'null' };
  if (value.kind === 'undefined' && entry.allowUndefined) return { kind: 'undefined' };
  if (value.kind !== 'value') fail('unsupported-value', path, 'This API does not support this value state.');
  const raw = value.value, item = CATALOG_SPECS.get(entry), type = item.type;
  if (item.bundle) return { kind: 'value', value: canonicalJson(validateFingerprintCustomValue(item.bundle, raw, `${path}.value`, fail)) };
  if (type === 'canvas-projection') {
    exact(raw, ['algorithm'], `${path}.value`);
    if (!(item.algorithms ?? CANVAS_ALGORITHMS_V7).includes(raw.algorithm)) fail('invalid-value', `${path}.value.algorithm`, 'Unsupported Canvas projection algorithm.');
    return { kind: 'value', value: { algorithm: raw.algorithm } };
  }
  if (type === 'math-transcendentals') {
    exact(raw, ['algorithm', 'functions'], `${path}.value`);
    if (raw.algorithm !== 'deterministic-ulp-v1') fail('invalid-value', `${path}.value.algorithm`, 'Unsupported Math algorithm.');
    const allowedFunctions = item.allowedFunctions;
    array(raw.functions, allowedFunctions.length, `${path}.value.functions`);
    if (raw.functions.some(name => typeof name !== 'string' || !allowedFunctions.includes(name))) fail('invalid-value', `${path}.value.functions`, 'Unknown Math function.');
    if (new Set(raw.functions).size !== raw.functions.length) fail('duplicate-value', `${path}.value.functions`, 'Math functions must be unique.');
    return { kind: 'value', value: { algorithm: raw.algorithm, functions: allowedFunctions.filter(name => raw.functions.includes(name)) } };
  }
  if (type === 'webrtc') return { kind: 'value', value: canonicalJson(readWebRtcProfile(raw, `${path}.value`, entry === WEBRTC_CATALOG_V3, item.allowMdns === true)) };
  if (type === 'integer' || type === 'number') {
    if (typeof raw !== 'number' || !Number.isFinite(raw) || (type === 'integer' && !Number.isSafeInteger(raw)) || raw < item.min || raw > item.max) fail('invalid-value', `${path}.value`, `Expected ${type} between ${item.min} and ${item.max}.`);
  } else if (type === 'boolean') { if (typeof raw !== 'boolean') fail('invalid-value', `${path}.value`, 'Expected a boolean.'); }
  else if (type === 'string') text(raw, 0, 1024, `${path}.value`);
  else if (type === 'language') language(raw, `${path}.value`);
  else if (type === 'languages') {
    array(raw, 32, `${path}.value`); if (!raw.length) fail('invalid-value', path, 'At least one language is required.');
    for (let index = 0; index < raw.length; index++) language(raw[index], `${path}.value[${index}]`);
    if (new Set(raw.map(item => item.toLowerCase())).size !== raw.length) fail('duplicate-value', path, 'Language tags must be unique.');
  } else if (type === 'timezone') {
    exact(raw, ['timeZone', 'offsetMinutes'], `${path}.value`);
    text(raw.timeZone, 1, 128, `${path}.value.timeZone`);
    number(raw.offsetMinutes, -840, 840, `${path}.value.offsetMinutes`, true);
    try { new Intl.DateTimeFormat('en', { timeZone: raw.timeZone }); } catch { fail('invalid-value', path, 'Expected an available IANA time zone.'); }
  } else if (type === 'orientation') {
    exact(raw, ['type', 'angle'], `${path}.value`);
    if (!['portrait-primary', 'portrait-secondary', 'landscape-primary', 'landscape-secondary'].includes(raw.type) || ![0, 90, 180, 270].includes(raw.angle)) fail('invalid-value', path, 'Expected a screen orientation type and angle (0, 90, 180, 270).');
  } else if (type === 'geolocation') {
    exact(raw, ['latitude', 'longitude', 'accuracy'], `${path}.value`);
    number(raw.latitude, -90, 90, `${path}.value.latitude`); number(raw.longitude, -180, 180, `${path}.value.longitude`); number(raw.accuracy, 1, 100000, `${path}.value.accuracy`);
  } else if (type === 'webgl' || type === 'webgpu') {
    const keys = type === 'webgl' ? ['vendor', 'renderer', 'unmaskedVendor', 'unmaskedRenderer'] : ['vendor', 'architecture', 'device', 'description'];
    exact(raw, keys, `${path}.value`); for (const key of keys) text(raw[key], 0, 512, `${path}.value.${key}`);
  } else if (type === 'battery') {
    exact(raw, ['charging', 'chargingTime', 'dischargingTime', 'level'], `${path}.value`);
    boolean(raw.charging, `${path}.value.charging`); number(raw.level, 0, 1, `${path}.value.level`);
    for (const key of ['chargingTime', 'dischargingTime']) if (raw[key] !== null) number(raw[key], 0, Number.MAX_SAFE_INTEGER, `${path}.value.${key}`);
  } else if (type === 'network') {
    record(raw, ['downlink', 'effectiveType', 'rtt', 'saveData'], ['type'], `${path}.value`);
    number(raw.downlink, 0, 100000, `${path}.value.downlink`); number(raw.rtt, 0, 600000, `${path}.value.rtt`, true); boolean(raw.saveData, `${path}.value.saveData`);
    if (!['slow-2g', '2g', '3g', '4g'].includes(raw.effectiveType)) fail('invalid-value', `${path}.value.effectiveType`, 'Expected slow-2g, 2g, 3g, or 4g.');
    if (Object.hasOwn(raw, 'type') && !['bluetooth', 'cellular', 'ethernet', 'none', 'wifi', 'wimax', 'other', 'unknown'].includes(raw.type)) fail('invalid-value', `${path}.value.type`, 'Unknown connection type.');
  } else if (type === 'memory' || type === 'storage') {
    const keys = type === 'memory' ? ['jsHeapSizeLimit', 'totalJSHeapSize', 'usedJSHeapSize'] : ['quota', 'usage'];
    exact(raw, keys, `${path}.value`); for (const key of keys) number(raw[key], 0, Number.MAX_SAFE_INTEGER, `${path}.value.${key}`, true);
    if (type === 'memory' ? raw.usedJSHeapSize > raw.totalJSHeapSize || raw.totalJSHeapSize > raw.jsHeapSizeLimit : raw.usage > raw.quota) fail('invalid-value', `${path}.value`, 'Used memory/storage must not exceed its limit.');
  } else if (type === 'client-hints') {
    const optional = ['architecture', 'bitness', 'model', 'platformVersion', 'uaFullVersion', 'wow64', 'fullVersionList', ...(item.allowFormFactors ? ['formFactors'] : [])];
    record(raw, ['brands', 'mobile', 'platform'], optional, `${path}.value`);
    function brands(items, brandsPath) {
      array(items, 32, brandsPath); const seen = new Set();
      for (let i = 0; i < items.length; i++) {
        const item = items[i]; exact(item, ['brand', 'version'], `${brandsPath}[${i}]`); text(item.brand, 1, 128, `${brandsPath}[${i}].brand`); text(item.version, 1, 64, `${brandsPath}[${i}].version`);
        if (seen.has(item.brand)) fail('duplicate-value', `${brandsPath}[${i}]`, 'Duplicate user-agent brand.'); seen.add(item.brand);
      }
    }
    brands(raw.brands, `${path}.value.brands`); boolean(raw.mobile, `${path}.value.mobile`); text(raw.platform, 0, 128, `${path}.value.platform`);
    for (const key of optional.filter(item => !['wow64', 'fullVersionList', 'formFactors'].includes(item))) if (Object.hasOwn(raw, key)) text(raw[key], 0, 128, `${path}.value.${key}`);
    if (Object.hasOwn(raw, 'wow64')) boolean(raw.wow64, `${path}.value.wow64`);
    if (Object.hasOwn(raw, 'fullVersionList')) brands(raw.fullVersionList, `${path}.value.fullVersionList`);
    if (Object.hasOwn(raw, 'formFactors')) {
      array(raw.formFactors, 16, `${path}.value.formFactors`);
      for (const value of raw.formFactors) text(value, 1, 128, `${path}.value.formFactors`);
      if (new Set(raw.formFactors).size !== raw.formFactors.length) fail('duplicate-value', `${path}.value.formFactors`, 'Form factors must be unique.');
    }
    if (Object.hasOwn(raw, 'bitness') && !['', '32', '64'].includes(raw.bitness)) fail('invalid-value', `${path}.value.bitness`, 'Expected 32, 64, or an empty string.');
  } else if (type === 'empty-array') { array(raw, 0, `${path}.value`); }
  else if (type === 'speech-voices') {
    if (Array.isArray(raw)) array(raw, 0, `${path}.value`);
    else {
      exact(raw, ['languages'], `${path}.value`); array(raw.languages, 8, `${path}.value.languages`);
      if (!raw.languages.length) fail('invalid-value', `${path}.value.languages`, 'At least one language is required.');
      const languages = raw.languages.map((tag, index) => canonicalLanguage(tag, `${path}.value.languages[${index}]`));
      if (new Set(languages).size !== languages.length) fail('duplicate-value', `${path}.value.languages`, 'Language tags must be unique.');
      return { kind: 'value', value: { languages } };
    }
  } else if (type === 'bluetooth') { exact(raw, ['available', 'devices'], `${path}.value`); boolean(raw.available, `${path}.value.available`); array(raw.devices, 0, `${path}.value.devices`); }
  else if (type === 'autoplay' || type === 'notification') {
    if (!(type === 'autoplay' ? ['allowed', 'allowed-muted', 'disallowed'] : ['default', 'denied', 'granted']).includes(raw)) fail('invalid-value', `${path}.value`, 'Unknown API result.');
  } else if (type === 'media-capabilities') {
    exact(raw, ['supported', 'smooth', 'powerEfficient'], `${path}.value`);
    for (const key of ['supported', 'smooth', 'powerEfficient']) boolean(raw[key], `${path}.value.${key}`);
    if (!raw.supported && (raw.smooth || raw.powerEfficient)) fail('invalid-value', `${path}.value`, 'An unsupported media configuration cannot be smooth or power efficient.');
  } else if (type === 'media-codecs') {
    // Catalog 10: the same flags plus codec families reported as unsupported, stored in the API_MEDIA_CODEC_FAMILIES order.
    exact(raw, ['supported', 'smooth', 'powerEfficient', 'hidden'], `${path}.value`);
    for (const key of ['supported', 'smooth', 'powerEfficient']) boolean(raw[key], `${path}.value.${key}`);
    if (!raw.supported && (raw.smooth || raw.powerEfficient)) fail('invalid-value', `${path}.value`, 'An unsupported media configuration cannot be smooth or power efficient.');
    array(raw.hidden, API_MEDIA_CODEC_FAMILIES.length, `${path}.value.hidden`);
    if (raw.hidden.some(family => typeof family !== 'string' || !API_MEDIA_CODEC_FAMILIES.includes(family))) fail('invalid-value', `${path}.value.hidden`, 'Unknown codec family.');
    if (new Set(raw.hidden).size !== raw.hidden.length) fail('duplicate-value', `${path}.value.hidden`, 'Codec families must be unique.');
    return { kind: 'value', value: canonicalJson({ supported: raw.supported, smooth: raw.smooth, powerEfficient: raw.powerEfficient, hidden: API_MEDIA_CODEC_FAMILIES.filter(family => raw.hidden.includes(family)) }) };
  } else if (type === 'media-devices') {
    array(raw, 128, `${path}.value`); const ids = new Set();
    for (let index = 0; index < raw.length; index++) {
      const device = raw[index], devicePath = `${path}.value[${index}]`;
      exact(device, ['deviceId', 'groupId', 'kind', 'label'], devicePath);
      for (const key of ['deviceId', 'groupId', 'label']) text(device[key], 0, 512, `${devicePath}.${key}`);
      if (!['audioinput', 'audiooutput', 'videoinput'].includes(device.kind)) fail('invalid-value', `${devicePath}.kind`, 'Unknown media device kind.');
      const key = device.kind + ':' + device.deviceId; if (ids.has(key)) fail('duplicate-value', devicePath, 'Duplicate media device.'); ids.add(key);
    }
  } else fail('unsupported-value', path, 'Unsupported API value type.');
  return { kind: 'value', value: canonicalJson(raw) };
}
function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalJson(value[key])]));
  return value;
}
// Count canonical JSON bytes without constructing an oversized serialized object.
function jsonByteLength(value, limit = API_CONFIGURATION_MAX_BYTES) {
  let bytes = 0;
  function add(count) { bytes += count; if (bytes > limit) fail('size-limit', '$', 'Configuration exceeds the JSON size limit.'); }
  function string(text) {
    add(2);
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      if (code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 || code === 13) add(2);
      else if (code < 32) add(6);
      else if (code < 128) add(1);
      else if (code < 2048) add(2);
      else if (code >= 0xd800 && code <= 0xdbff && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) { add(4); index++; }
      else if (code >= 0xd800 && code <= 0xdfff) add(6);
      else add(3);
    }
  }
  function visit(item) {
    if (item === null) add(4);
    else if (typeof item === 'string') string(item);
    else if (typeof item === 'boolean') add(item ? 4 : 5);
    else if (typeof item === 'number') add(String(item).length);
    else if (Array.isArray(item)) { add(2 + Math.max(0, item.length - 1)); for (const entry of item) visit(entry); }
    else {
      const keys = Object.keys(item); add(2 + Math.max(0, keys.length - 1));
      for (const key of keys) { string(key); add(1); visit(item[key]); }
    }
  }
  visit(value); return bytes;
}
export function validateApiValue(id, value) { try { return { ok: true, value: validateValue(id, safeData(value), '$') }; } catch (error) { return resultError(error); } }
function metadata(entry) { const { id, order, name, group, type, customSupported, customReason, valueHint, allowNull, allowUndefined, presets } = entry; return { id, order, name, group, type, customSupported, customReason, valueHint, allowNull, allowUndefined, presets: clone(presets) }; }
function emptyScopeRow(id) { return { id, mode: 'bypass', selected: { kind: 'unset' }, settings: {} }; }
function emptyConfiguration() {
  return { format: API_CONFIGURATION_FORMAT, formatVersion: API_CONFIGURATION_VERSION, catalogVersion: API_CONFIGURATION_CATALOG_VERSION, enabled: false, antidetectEnabled: false, preset: 'limited', webrtcNetworkPolicy: 'system',
    apis: API_CONFIG_CATALOG.map(entry => ({ ...metadata(entry), mode: 'bypass', userValues: [], selected: { kind: 'unset' }, settings: {} })), sites: [], fingerprintProfiles: [] };
}
function hostValid(host) {
  if (typeof host !== 'string' || host.length < 1 || host.length > 253 || !/^[a-z0-9.:[\]-]+$/.test(host)) return false;
  try { return new URL('https://' + host + '/').hostname === host && !host.includes('..') && !host.endsWith('.'); } catch { return false; }
}
function scopeRow(row, path, catalog) {
  const entry = catalog.get(row.id);
  if (!entry) fail('unknown-api', `${path}.id`, 'Unknown API identifier.');
  if (!MODES.includes(row.mode)) fail('invalid-mode', `${path}.mode`, 'Expected on, bypass, off, or custom.');
  // timezone ON was accepted in published formats even though its UI control
  // was disabled. Retain that stored mode for lossless historical imports.
  if (row.id !== 'timezone' && API_CUSTOM_ONLY_IDS.includes(row.id) && row.mode === 'on') fail('unsupported-value', `${path}.mode`, 'Blocking is not supported by this Custom profile.');
  if (row.mode === 'custom' && !entry.customSupported) fail('unsupported-value', `${path}.mode`, 'Custom is not supported by this API.');
  const selected = validateValue(row.id, row.selected, `${path}.selected`, catalog);
  if (row.mode === 'custom' && selected.kind === 'unset') fail('missing-value', `${path}.selected`, 'Select a value before enabling Custom.');
  exact(row.settings, [], `${path}.settings`);
  return { id: row.id, mode: row.mode, selected, settings: {} };
}
function readRows(rows, path, full, catalog) {
  array(rows, catalog.length, path);
  const schema = new Map(catalog.map(entry => [entry.id, entry]));
  const map = new Map();
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index], rowPath = `${path}[${index}]`;
    exact(row, full ? [...Object.keys(metadata(catalog[0])), 'mode', 'userValues', 'selected', 'settings'] : ['id', 'mode', 'selected', 'settings'], rowPath);
    if (map.has(row.id)) fail('duplicate-api', `${rowPath}.id`, 'Duplicate API identifier.');
    if (!schema.has(row.id)) fail('unknown-api', `${rowPath}.id`, 'Unknown API identifier.');
    const normalized = scopeRow(row, rowPath, schema), entry = schema.get(row.id);
    if (full) {
      const expected = metadata(entry), incoming = Object.fromEntries(Object.keys(expected).map(key => [key, row[key]]));
      if (JSON.stringify(canonicalJson(incoming)) !== JSON.stringify(canonicalJson(expected))) fail('catalog-mismatch', rowPath, 'API metadata and standard presets must match this catalogue version.');
      array(row.userValues, API_CONFIGURATION_MAX_VALUES, `${rowPath}.userValues`);
      const values = [], ids = new Set();
      for (let i = 0; i < row.userValues.length; i++) {
        const user = row.userValues[i], userPath = `${rowPath}.userValues[${i}]`;
        exact(user, ['id', 'label', 'value'], userPath);
        if (typeof user.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(user.id) || user.id.startsWith('preset-')) fail('invalid-value', `${userPath}.id`, 'Expected a stable custom value ID.');
        if (ids.has(user.id)) fail('duplicate-value', `${userPath}.id`, 'Duplicate custom value identifier.'); ids.add(user.id);
        text(user.label, 1, 160, `${userPath}.label`);
        const value = validateValue(row.id, user.value, `${userPath}.value`, schema);
        if (value.kind === 'unset') fail('missing-value', `${userPath}.value`, 'A saved value cannot be unset.');
        values.push({ id: user.id, label: user.label, value });
      }
      values.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      map.set(row.id, { ...expected, mode: normalized.mode, userValues: values, selected: normalized.selected, settings: {} });
    } else map.set(row.id, normalized);
  }
  for (const entry of catalog) if (!map.has(entry.id)) fail('missing-api', path, `Missing API: ${entry.id}.`);
  return catalog.map(entry => map.get(entry.id));
}
function validateDeviceProfiles(apis, sites, enabled, rootPath = '$') {
  if (!enabled) return;
  const global = new Map(apis.map(row => [row.id, row]));
  function check(rows, path) {
    const resolved = id => {
      const local = rows?.find(row => row.id === id);
      return local && local.mode !== 'bypass' ? local : global.get(id);
    };
    const rtc = resolved('webrtc'), media = resolved('media-enumeration');
    if (rtc?.mode === 'custom' && rtc.selected.kind === 'value' && rtc.selected.value.randomizeDevices === true && media?.mode === 'custom') {
      fail('conflicting-webrtc-devices', path, 'Custom media enumeration cannot be combined with randomized WebRTC device identifiers in this scope.');
    }
  }
  check(null, `${rootPath}.apis`);
  for (let index = 0; index < sites.length; index++) if (!sites[index].disabled) check(sites[index].apis, `${rootPath}.sites[${index}].apis`);
}
// Format 9 profile tags: a few short trimmed strings, unique ignoring case. A bad item is an error, never repaired; any
// input order is accepted and the tags are stored in ascending UTF-16 code unit order. Unsafe characters are refused
// separately by checkLabels (writes and imports), like labels.
function readProfileTags(value, path) {
  array(value, API_PROFILE_MAX_TAGS, path);
  const seen = new Set();
  for (let index = 0; index < value.length; index++) {
    const tag = value[index], tagPath = `${path}[${index}]`;
    if (typeof tag !== 'string' || tag.length < 1 || tag.length > API_PROFILE_TAG_MAX) fail('invalid-value', tagPath, `Expected a tag of 1-${API_PROFILE_TAG_MAX} characters.`);
    if (tag !== tag.trim()) fail('invalid-value', tagPath, 'A tag must not start or end with whitespace.');
    const folded = tag.toLowerCase();
    if (seen.has(folded)) fail('duplicate-value', tagPath, 'Tags must be unique, ignoring case.');
    seen.add(folded);
  }
  return [...value].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
}
function readFingerprintProfiles(input, catalog, formatVersion) {
  array(input, API_CONFIGURATION_MAX_PROFILES, '$.fingerprintProfiles');
  const profiles = [], ids = new Set(), policies = formatVersion >= 9 ? API_WEBRTC_NETWORK_POLICIES : API_WEBRTC_NETWORK_POLICIES_V8;
  for (let index = 0; index < input.length; index++) {
    const row = input[index], path = `$.fingerprintProfiles[${index}]`;
    exact(row, ['id', 'label', 'preset', 'webrtcNetworkPolicy', 'apis', ...(formatVersion >= 9 ? ['tags', 'note'] : [])], path);
    if (typeof row.id !== 'string' || !/^fp-[a-f0-9]{32}$/.test(row.id)) fail('invalid-value', `${path}.id`, 'Expected a stable fingerprint profile ID.');
    if (ids.has(row.id)) fail('duplicate-profile', `${path}.id`, 'Duplicate fingerprint profile identifier.');
    ids.add(row.id); text(row.label, 1, 160, `${path}.label`);
    if (!['limited', 'strict', 'custom'].includes(row.preset)) fail('invalid-value', `${path}.preset`, 'Invalid fingerprint profile preset.');
    if (!policies.includes(row.webrtcNetworkPolicy)) fail('invalid-value', `${path}.webrtcNetworkPolicy`, 'Unsupported native WebRTC policy.');
    const apis = readRows(row.apis, `${path}.apis`, false, catalog);
    let tags, note;
    if (formatVersion >= 9) { tags = readProfileTags(row.tags, `${path}.tags`); text(row.note, 0, API_PROFILE_NOTE_MAX, `${path}.note`); note = row.note; }
    // A dormant library record must be safe to activate without depending on
    // the current master, active profile, or unrelated exact-site overrides.
    validateDeviceProfiles(apis, [], true, path);
    profiles.push({ id: row.id, label: row.label, preset: row.preset, webrtcNetworkPolicy: row.webrtcNetworkPolicy, apis, ...(formatVersion >= 9 ? { tags, note } : {}) });
  }
  profiles.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return profiles;
}
function validateConfiguration(input, catalog, catalogVersion, formatVersion) {
  try {
    const value = safeData(input);
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'formatVersion') && Object.hasOwn(value, 'catalogVersion') &&
      (value.formatVersion !== formatVersion || value.catalogVersion !== catalogVersion)) fail('incompatible-version', '$.formatVersion', 'Unsupported configuration or catalogue version.');
    // ADR-068: published formats 1–4 retain their exact field set and their
    // original shared-master validation before the additive upgrade is allowed.
    exact(value, ['format', 'formatVersion', 'catalogVersion', 'enabled', ...(formatVersion >= 5 ? ['antidetectEnabled'] : []), 'preset', ...(formatVersion >= 2 ? ['webrtcNetworkPolicy'] : []), 'apis', 'sites', ...(formatVersion >= 4 ? ['fingerprintProfiles'] : [])], '$');
    if (value.format !== API_CONFIGURATION_FORMAT) fail('invalid-format', '$.format', 'This is not a detect.expert API configuration.');
    if (value.formatVersion !== formatVersion || value.catalogVersion !== catalogVersion) fail('incompatible-version', '$.formatVersion', 'Unsupported configuration or catalogue version.');
    if (typeof value.enabled !== 'boolean' || !['limited', 'strict', 'custom'].includes(value.preset)) fail('invalid-value', '$', 'Invalid master switch or protection preset.');
    if (formatVersion >= 5) boolean(value.antidetectEnabled, '$.antidetectEnabled');
    if (formatVersion >= 2 && !(formatVersion >= 9 ? API_WEBRTC_NETWORK_POLICIES : API_WEBRTC_NETWORK_POLICIES_V8).includes(value.webrtcNetworkPolicy)) fail('invalid-value', '$.webrtcNetworkPolicy', 'Unsupported native WebRTC policy.');
    const apis = readRows(value.apis, '$.apis', true, catalog), sites = [], hosts = new Set();
    array(value.sites, MAX_SITES, '$.sites');
    for (let index = 0; index < value.sites.length; index++) {
      const site = value.sites[index], path = `$.sites[${index}]`;
      exact(site, ['host', 'disabled', 'apis'], path);
      if (!hostValid(site.host) || typeof site.disabled !== 'boolean') fail('invalid-value', path, 'Expected a canonical exact host and boolean disabled field.');
      if (hosts.has(site.host)) fail('duplicate-host', `${path}.host`, 'Duplicate site host.'); hosts.add(site.host);
      sites.push({ host: site.host, disabled: site.disabled, apis: readRows(site.apis, `${path}.apis`, false, catalog) });
    }
    validateDeviceProfiles(apis, sites, formatVersion >= 5 ? value.antidetectEnabled : value.enabled);
    sites.sort((a, b) => a.host < b.host ? -1 : a.host > b.host ? 1 : 0);
    const configuration = { format: API_CONFIGURATION_FORMAT, formatVersion, catalogVersion, enabled: value.enabled,
      ...(formatVersion >= 5 ? { antidetectEnabled: value.antidetectEnabled } : {}), preset: value.preset,
      ...(formatVersion >= 2 ? { webrtcNetworkPolicy: value.webrtcNetworkPolicy } : {}), apis, sites,
      ...(formatVersion >= 4 ? { fingerprintProfiles: readFingerprintProfiles(value.fingerprintProfiles, catalog, formatVersion) } : {}) };
    // Reserve the terminating newline used by both export layouts.
    jsonByteLength(configuration, API_CONFIGURATION_MAX_BYTES - 1);
    return { ok: true, value: configuration };
  } catch (error) { return resultError(error); }
}
export function validateApiConfiguration(input) {
  return validateConfiguration(input, API_CONFIG_CATALOG, API_CONFIGURATION_CATALOG_VERSION, API_CONFIGURATION_VERSION);
}
// Identity-bound texts of a validated configuration: saved-value labels per API and, per library profile, its label and
// (format 9) each tag and the note. Entry: [identity key, text, path, safety test, message].
const LABEL_MESSAGE = 'Labels must not contain control or bidirectional formatting characters.';
const TAG_MESSAGE = 'Tags must not contain control or bidirectional formatting characters.';
const NOTE_MESSAGE = 'Notes must not contain control characters other than line feeds, or bidirectional formatting characters.';
function labelEntries(config) {
  const entries = [];
  config.apis.forEach((row, index) => row.userValues.forEach((saved, position) => entries.push([JSON.stringify(['value', row.id, saved.id, saved.label]), saved.label, `$.apis[${index}].userValues[${position}].label`, apiLabelSafe, LABEL_MESSAGE])));
  (config.fingerprintProfiles ?? []).forEach((profile, index) => {
    const base = `$.fingerprintProfiles[${index}]`;
    entries.push([JSON.stringify(['profile', profile.id, profile.label]), profile.label, `${base}.label`, apiLabelSafe, LABEL_MESSAGE]);
    (profile.tags ?? []).forEach((tag, position) => entries.push([JSON.stringify(['tag', profile.id, tag]), tag, `${base}.tags[${position}]`, apiLabelSafe, TAG_MESSAGE]));
    if (profile.note !== undefined) entries.push([JSON.stringify(['note', profile.id, profile.note]), profile.note, `${base}.note`, apiNoteSafe, NOTE_MESSAGE]);
  });
  return entries;
}
const labelKeys = config => new Set(labelEntries(config).map(([key]) => key));
// An unsafe text is accepted only where the same text already existed at the same identity in the previous state.
function checkLabels(config, known = new Set()) {
  for (const [key, label, path, safe, message] of labelEntries(config)) if (!safe(label) && !known.has(key)) fail('unsafe-label', path, message);
}
// Validation for a new write: the stored previous state (if any) grandfathers its own unchanged labels.
export function validateApiConfigurationWrite(input, previous = null) {
  const result = validateApiConfiguration(input);
  if (!result.ok) return result;
  try {
    const before = previous === null || previous === undefined ? null : validateApiConfiguration(previous);
    checkLabels(result.value, before?.ok ? labelKeys(before.value) : new Set());
    return result;
  } catch (error) { return resultError(error); }
}
export function upgradeApiConfiguration(input) {
  let upgrading = false;
  try {
    // Read only a data descriptor here; the strict validator rejects accessors.
    const version = input && typeof input === 'object' ? Object.getOwnPropertyDescriptor(input, 'catalogVersion')?.value : undefined;
    const format = input && typeof input === 'object' ? Object.getOwnPropertyDescriptor(input, 'formatVersion')?.value : undefined;
    const previous = version === 1 || version === 2 || version === 3 || version === 4 || version === 5 && format === 3 || version === 6 && (format === 4 || format === 5) || version === 7 && format === 6 || version === 8 && format === 7 || version === 9 && format === 8 || version === 10 && format === 9;
    const historical = version === 1 ? API_CONFIG_CATALOG_V1 : version === 2 ? API_CONFIG_CATALOG_V2 : version === 3 ? API_CONFIG_CATALOG_V3 : version === 4 ? API_CONFIG_CATALOG_V4 : version === 5 ? API_CONFIG_CATALOG_V5 : version === 6 ? API_CONFIG_CATALOG_V6 : version === 7 ? API_CONFIG_CATALOG_V7 : version === 8 ? API_CONFIG_CATALOG_V8 : version === 9 ? API_CONFIG_CATALOG_V9 : API_CONFIG_CATALOG_V10;
    const result = previous ? validateConfiguration(input, historical, version, version >= 6 ? format : version >= 4 ? 3 : version === 3 ? 2 : 1) : validateApiConfiguration(input);
    if (!result.ok) return result;
    if (!previous) return { ...result, migrated: false };
    upgrading = true;
    const value = result.value, previousRows = new Map(value.apis.map(row => [row.id, row]));
    value.formatVersion = API_CONFIGURATION_VERSION; value.catalogVersion = API_CONFIGURATION_CATALOG_VERSION;
    if (format < 5) value.antidetectEnabled = value.enabled;
    if (format < 4) value.fingerprintProfiles = [];
    if (version < 3) value.webrtcNetworkPolicy = 'system';
    const upgradeSelected = selected => selected?.kind === 'value' ? { kind: 'value', value: { ...selected.value, addresses: upgradeWebRtcAddresses(selected.value.addresses) } } : selected;
    if (version === 3) {
      const rtc = previousRows.get('webrtc');
      rtc.selected = upgradeSelected(rtc.selected);
      rtc.userValues = rtc.userValues.map(row => ({ ...row, value: upgradeSelected(row.value) }));
      for (const site of value.sites) {
        const local = site.apis.find(row => row.id === 'webrtc');
        local.selected = upgradeSelected(local.selected);
      }
    }
    // Catalog 10: every stored media-capabilities value (selection, saved values, exact sites, library profiles) of an older
    // catalog gains an empty list of hidden codec families. A catalog 10 file already carries its list and keeps it.
    if (version <= 9) {
      const withHidden = selected => selected?.kind === 'value' ? { kind: 'value', value: { ...selected.value, hidden: [] } } : selected;
      const media = previousRows.get('media-capabilities');
      media.selected = withHidden(media.selected);
      media.userValues = media.userValues.map(saved => ({ ...saved, value: withHidden(saved.value) }));
      for (const scope of [...value.sites, ...value.fingerprintProfiles]) { const local = scope.apis.find(row => row.id === 'media-capabilities'); local.selected = withHidden(local.selected); }
    }
    value.apis = API_CONFIG_CATALOG.map(entry => {
      const row = previousRows.get(entry.id);
      return { ...metadata(entry), mode: row?.mode ?? 'bypass', userValues: row?.userValues ?? [], selected: row?.selected ?? { kind: 'unset' }, settings: row?.settings ?? {} };
    });
    for (const site of value.sites) {
      const rows = new Map(site.apis.map(row => [row.id, row]));
      site.apis = API_CONFIG_CATALOG.map(entry => rows.get(entry.id) ?? emptyScopeRow(entry.id));
    }
    for (const profile of value.fingerprintProfiles) {
      const rows = new Map(profile.apis.map(row => [row.id, row]));
      profile.apis = API_CONFIG_CATALOG.map(entry => rows.get(entry.id) ?? emptyScopeRow(entry.id));
      // Format 9: records written by older formats carry neither tags nor a note (a format 9 record keeps its own).
      if (format < 9) { profile.tags = []; profile.note = ''; }
    }
    const upgraded = validateApiConfiguration(value);
    return upgraded.ok ? { ...upgraded, migrated: true } : { ...upgraded, upgradeFailure: true };
  } catch (error) { const result = resultError(error); return upgrading ? { ...result, upgradeFailure: true } : result; }
}

// JSON.parse alone silently overwrites duplicate fields. Scan structure before parsing.
function parseUniqueJson(source) {
  if (typeof source !== 'string') fail('invalid-json', '$', 'Expected a JSON file.');
  if (source.length > API_CONFIGURATION_MAX_BYTES || new TextEncoder().encode(source).byteLength > API_CONFIGURATION_MAX_BYTES) fail('size-limit', '$', 'Configuration file is too large.');
  let position = 0, nodes = 0;
  const whitespace = () => { while (/\s/.test(source[position] ?? '') && position < source.length) position++; };
  function string() {
    const start = position++;
    while (position < source.length) {
      const c = source[position++];
      if (c === '\\') position++;
      else if (c === '"') return JSON.parse(source.slice(start, position));
    }
    fail('invalid-json', '$', 'Unterminated JSON string.');
  }
  function value(depth) {
    if (++nodes > 250000 || depth > 16) fail('size-limit', '$', 'Configuration is too large or too deeply nested.');
    whitespace(); const c = source[position];
    if (c === '"') { string(); return; }
    if (c === '{') {
      position++; whitespace(); const keys = new Set();
      if (source[position] === '}') { position++; return; }
      while (position < source.length) {
        whitespace(); if (source[position] !== '"') fail('invalid-json', '$', 'Expected a JSON field name.');
        const key = string(); if (keys.has(key)) fail('duplicate-field', '$', `Duplicate JSON field: ${key}.`); keys.add(key);
        whitespace(); if (source[position++] !== ':') fail('invalid-json', '$', 'Expected a colon.');
        value(depth + 1); whitespace(); const separator = source[position++];
        if (separator === '}') return;
        if (separator !== ',') fail('invalid-json', '$', 'Expected a comma or closing brace.');
      }
    } else if (c === '[') {
      position++; whitespace(); if (source[position] === ']') { position++; return; }
      while (position < source.length) {
        value(depth + 1); whitespace(); const separator = source[position++];
        if (separator === ']') return;
        if (separator !== ',') fail('invalid-json', '$', 'Expected a comma or closing bracket.');
      }
    } else {
      const match = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(source.slice(position));
      if (!match) fail('invalid-json', '$', 'Invalid JSON value.'); position += match[0].length; return;
    }
    fail('invalid-json', '$', 'Unterminated JSON structure.');
  }
  value(0); whitespace(); if (position !== source.length) fail('invalid-json', '$', 'Unexpected trailing JSON content.');
  try { return JSON.parse(source); } catch { fail('invalid-json', '$', 'Invalid JSON.'); }
}
function migrateLegacy(input) {
  const value = safeData(input);
  exact(value, ['schemaVersion', 'revision', 'enabled', 'preset', 'global', 'sites'], '$');
  if (value.schemaVersion !== 1) fail('incompatible-version', '$.schemaVersion', 'Unsupported legacy configuration version.');
  if (!Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.enabled !== 'boolean' || !['limited', 'strict', 'custom'].includes(value.preset)) fail('invalid-value', '$', 'Invalid legacy configuration.');
  function rules(rows, path) {
    array(rows, PROTECTION_FEATURES.length, path); const seen = new Set(), output = new Map();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]; exact(row, ['feature', 'state'], `${path}[${i}]`);
      if (!PROTECTION_FEATURES.includes(row.feature) || !['allow', 'block'].includes(row.state)) fail('invalid-value', `${path}[${i}]`, 'Invalid legacy protection rule.');
      if (seen.has(row.feature)) fail('duplicate-api', `${path}[${i}]`, 'Duplicate legacy API rule.'); seen.add(row.feature);
      output.set(row.feature, row.state === 'block' ? 'on' : 'off');
    }
    return output;
  }
  const output = emptyConfiguration(), global = rules(value.global, '$.global');
  output.enabled = value.enabled; output.antidetectEnabled = value.enabled; output.preset = value.preset;
  for (const row of output.apis) row.mode = global.get(row.id) ?? 'bypass';
  array(value.sites, MAX_SITES, '$.sites'); const hosts = new Set();
  for (let i = 0; i < value.sites.length; i++) {
    const site = value.sites[i], path = `$.sites[${i}]`; exact(site, ['host', 'disabled', 'rules'], path);
    if (!hostValid(site.host) || typeof site.disabled !== 'boolean') fail('invalid-value', path, 'Invalid legacy site.');
    if (hosts.has(site.host)) fail('duplicate-host', path, 'Duplicate legacy site.'); hosts.add(site.host);
    const selected = rules(site.rules, `${path}.rules`);
    output.sites.push({ host: site.host, disabled: site.disabled, apis: API_CONFIG_CATALOG.map(entry => ({ ...emptyScopeRow(entry.id), mode: selected.get(entry.id) ?? 'bypass' })) });
  }
  return validateApiConfiguration(output);
}
export function createApiConfiguration(legacySettings) {
  if (legacySettings === undefined) return emptyConfiguration();
  const result = migrateLegacy(legacySettings);
  if (!result.ok) throw new ConfigurationError(result.error.code, result.error.path, result.error.message);
  return result.value;
}
export const apiConfigurationFromLegacy = createApiConfiguration;
function requireConfiguration(input) {
  const result = validateApiConfiguration(input);
  if (!result.ok) throw new ConfigurationError(result.error.code, result.error.path, result.error.message);
  return result.value;
}
export function configurationToLegacy(input, currentLegacy = null) {
  const config = requireConfiguration(input);
  const rules = rows => rows.filter(row => PROTECTION_FEATURES.includes(row.id) && row.mode !== 'bypass').map(row => ({ feature: row.id, state: row.mode === 'on' ? 'block' : 'allow' }));
  return { schemaVersion: 1, revision: Number.isSafeInteger(currentLegacy?.revision) && currentLegacy.revision >= 0 ? currentLegacy.revision : 0,
    enabled: config.enabled, preset: config.preset, global: rules(config.apis), sites: config.sites.map(site => ({ host: site.host, disabled: site.disabled, rules: rules(site.apis) })) };
}
export function effectiveApiConfiguration(input, host) {
  const config = requireConfiguration(input);
  if ((!config.enabled && !config.antidetectEnabled) || !hostValid(host)) return [];
  const site = config.sites.find(item => item.host === host);
  if (site?.disabled) return [];
  const limited = ['window-management', 'compute-pressure', 'idle-detection', 'local-fonts'];
  const blocked = new Set(config.preset === 'strict' ? [...limited, 'canvas-readback', 'battery', 'network-information', 'keyboard', 'client-hints'] : config.preset === 'limited' ? limited : []);
  return config.apis.map(global => {
    const local = site?.apis.find(row => row.id === global.id), row = local && local.mode !== 'bypass' ? local : global;
    const mode = row.mode === 'bypass' ? blocked.has(row.id) ? 'on' : 'off' : row.mode;
    return { id: row.id, mode: mode === 'custom' ? config.antidetectEnabled ? 'custom' : 'off' : mode === 'on' ? config.enabled ? 'on' : 'off' : mode, value: clone(row.selected) };
  });
}
export function importApiConfiguration(source) {
  try {
    const parsed = parseUniqueJson(source), migrated = Object.hasOwn(parsed ?? {}, 'schemaVersion') && !Object.hasOwn(parsed ?? {}, 'formatVersion');
    const result = migrated ? migrateLegacy(parsed) : upgradeApiConfiguration(parsed);
    // A file is new input: no label is grandfathered.
    if (result.ok) checkLabels(result.value);
    return result.ok ? { ...result, migrated: migrated || result.migrated } : result;
  } catch (error) { return error instanceof SyntaxError ? resultError(new ConfigurationError('invalid-json', '$', 'Invalid JSON.')) : resultError(error); }
}
export function exportApiConfiguration(input) {
  const result = validateApiConfiguration(input);
  if (!result.ok) throw new ConfigurationError(result.error.code, result.error.path, result.error.message);
  const pretty = JSON.stringify(result.value, null, 2) + '\n';
  if (pretty.length <= API_CONFIGURATION_MAX_BYTES && new TextEncoder().encode(pretty).byteLength <= API_CONFIGURATION_MAX_BYTES) return pretty;
  // Whitespace is optional JSON data. Large valid libraries use the same
  // canonical field/record order with compact spacing to remain transferable.
  return JSON.stringify(result.value) + '\n';
}
export function nextApiValueId(records) {
  const used = new Set(records.map(record => record.id));
  for (let index = 1; index <= API_CONFIGURATION_MAX_VALUES + 1; index++) if (!used.has(`custom-${index}`)) return `custom-${index}`;
  return null;
}
export function updateApiConfiguration(input, id, patch, host = null) {
  try {
    const read = validateApiConfiguration(input); if (!read.ok) return read;
    const known = labelKeys(read.value), value = read.value, changes = safeData(patch);
    for (const key of Object.keys(changes)) if (!['mode', 'selected', 'userValues', 'settings'].includes(key)) fail('unknown-field', `$.patch.${key}`, 'Unsupported API change.');
    if (!CATALOG.has(id)) fail('unknown-api', '$.id', 'Unknown API identifier.');
    let scope = value.apis;
    if (host !== null) {
      if (!hostValid(host)) fail('invalid-value', '$.host', 'Expected an exact canonical host.');
      let site = value.sites.find(item => item.host === host);
      if (!site) { site = { host, disabled: false, apis: API_CONFIG_CATALOG.map(entry => emptyScopeRow(entry.id)) }; value.sites.push(site); }
      scope = site.apis;
    }
    if (host !== null && Object.hasOwn(changes, 'userValues')) {
      value.apis.find(row => row.id === id).userValues = changes.userValues;
      delete changes.userValues;
    }
    const index = scope.findIndex(row => row.id === id); scope[index] = { ...scope[index], ...changes };
    const next = validateApiConfiguration(value);
    if (next.ok) checkLabels(next.value, known);
    return next;
  } catch (error) { return resultError(error); }
}
export function diffApiConfigurations(before, after) {
  const left = validateApiConfiguration(before), right = validateApiConfiguration(after);
  if (!left.ok) return left; if (!right.ok) return right;
  const changes = [];
  for (const key of ['enabled', 'antidetectEnabled', 'preset', 'webrtcNetworkPolicy']) if (left.value[key] !== right.value[key]) changes.push({ scope: 'global', id: null, field: key, before: left.value[key], after: right.value[key] });
  if (JSON.stringify(left.value.fingerprintProfiles) !== JSON.stringify(right.value.fingerprintProfiles)) changes.push({ scope: 'global', id: null, field: 'fingerprintProfiles', before: left.value.fingerprintProfiles, after: right.value.fingerprintProfiles });
  function rows(a, b, scope) {
    for (const entry of API_CONFIG_CATALOG) {
      const old = a?.find(row => row.id === entry.id) ?? emptyScopeRow(entry.id), next = b?.find(row => row.id === entry.id) ?? emptyScopeRow(entry.id);
      for (const field of ['mode', 'selected', 'userValues', 'settings']) if (JSON.stringify(old[field] ?? []) !== JSON.stringify(next[field] ?? [])) changes.push({ scope, id: entry.id, field, before: old[field] ?? [], after: next[field] ?? [] });
    }
  }
  rows(left.value.apis, right.value.apis, 'global');
  const hosts = [...new Set([...left.value.sites, ...right.value.sites].map(site => site.host))].sort();
  for (const host of hosts) {
    const a = left.value.sites.find(site => site.host === host), b = right.value.sites.find(site => site.host === host);
    if (!a || !b || a.disabled !== b.disabled) changes.push({ scope: host, id: null, field: 'site', before: a ? { disabled: a.disabled } : null, after: b ? { disabled: b.disabled } : null });
    rows(a?.apis, b?.apis, host);
  }
  return { ok: true, value: changes };
}
export function apiConfigurationWarnings(input) {
  const result = validateApiConfiguration(input); if (!result.ok) return [];
  const warnings = [];
  function check(rows, scope) {
    const active = new Map(rows.filter(row => row.mode === 'custom' && row.selected.kind === 'value').map(row => [row.id, row.selected.value]));
    for (const [available, total] of [['screen-avail-width', 'screen-width'], ['screen-avail-height', 'screen-height']]) if (active.has(available) && active.has(total) && active.get(available) > active.get(total)) warnings.push({ code: 'screen-bounds', scope, ids: [available, total], message: 'Available screen size exceeds total screen size.' });
    if (active.has('navigator-language') && active.has('navigator-languages') && active.get('navigator-languages')[0] !== active.get('navigator-language')) warnings.push({ code: 'language-mismatch', scope, ids: ['navigator-language', 'navigator-languages'], message: 'The primary language differs from the first preferred language.' });
    if (active.has('screen-color-depth') && active.has('screen-pixel-depth') && active.get('screen-color-depth') !== active.get('screen-pixel-depth')) warnings.push({ code: 'color-depth-mismatch', scope, ids: ['screen-color-depth', 'screen-pixel-depth'], message: 'Color depth and pixel depth differ.' });
  }
  check(result.value.apis, 'global');
  for (const site of result.value.sites) if (!site.disabled) check(site.apis.map(row => row.mode === 'bypass' ? result.value.apis.find(global => global.id === row.id) : row), site.host);
  return warnings;
}
