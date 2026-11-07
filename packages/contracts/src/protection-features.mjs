// ADR-045, ADR-046: additive feature IDs. Existing Limited/Strict presets remain unchanged.
import { WASM_SURFACES } from './webassembly-apis.mjs';

// Historical IDs are also the immutable catalogue-v1 prefix (ADR-048/059).
export const PROTECTION_FEATURES_V1 = Object.freeze([
  'window-management', 'compute-pressure', 'idle-detection', 'local-fonts',
  'canvas-readback', 'webgl', 'webgpu', 'audio', 'webrtc', 'webassembly',
  'battery', 'network-information', 'keyboard', 'client-hints', 'clipboard-read',
  'media-enumeration', 'media-capture', 'geolocation', 'generic-sensors',
  'bluetooth', 'usb', 'serial', 'hid', 'midi', 'gamepads', 'speech-voices',
  'service-worker', 'push', 'background-sync', 'periodic-sync',
  'notifications', 'storage-estimate',
  'videoframe-readback', 'screen-extended', 'webcodecs-capabilities', 'media-capabilities',
  'encrypted-media', 'hdcp-policy', 'autoplay-policy', 'webrtc-codecs', 'device-motion',
  'hardware-concurrency', 'device-memory', 'performance-memory', 'cpu-performance',
  'touch-points', 'webxr', 'speech-recognition', 'shape-detection',
  'handwriting-recognition', 'webnn', 'builtin-ai-models', 'translation-ai',
  'screen-wake-lock', 'picture-in-picture', 'document-picture-in-picture', 'fullscreen',
  'pointer-lock', 'file-system-pickers', 'protocol-handlers', 'installed-related-apps',
  'media-session', 'opfs', 'cookie-store', 'document-cookie', 'storage-buckets',
  'persistent-storage', 'indexeddb-enumeration', 'cache-storage', 'legacy-quota',
  'cast-discovery', 'send-beacon', 'fetch-later', 'websocket', 'webtransport',
  'platform-authenticator', 'web-share', 'credential-management', 'fedcm-user-info',
  'payment-probes', 'storage-access', 'private-state-tokens', 'background-fetch',
  'shared-worker', 'dedicated-worker', 'clipboard-write', 'permission-probes',
  'reporting-observer', 'feature-policy'
]);
export const PROTECTION_FEATURES = Object.freeze([
  ...PROTECTION_FEATURES_V1,
  ...WASM_SURFACES.map(surface => surface.feature)
]);
