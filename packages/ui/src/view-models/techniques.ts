// Technique registry labels for the UI (spec Part III §2, DET-001..DET-069). API names are identifiers and
// stay in English; categories are localized through `category_<key>`. Nothing here is a detector.

import type { TechniqueId } from '@detect-expert/contracts';

export type TechniqueCategory = 'graphics' | 'audio' | 'environment' | 'permissions' | 'storage' | 'network';

/** Wording family for observation / interpretation phrases. */
export type TechniqueFamily = 'canvas' | 'math' | 'webrtc' | 'local-probe' | 'dns' | 'generic';

export interface TechniqueInfo {
  category: TechniqueCategory;
  family: TechniqueFamily;
  /** Human-readable API surface (identifier text, not localized). */
  api: string;
  /** Coverage boundary entries (DET-067/068) describe what is NOT observable. */
  boundary?: true;
}

const G = 'graphics';
const A = 'audio';
const E = 'environment';
const P = 'permissions';
const S = 'storage';
const N = 'network';

function info(category: TechniqueCategory, api: string, family: TechniqueFamily = 'generic', boundary = false): TechniqueInfo {
  return boundary ? { category, family, api, boundary: true } : { category, family, api };
}

export const TECHNIQUE_INFO: Readonly<Record<TechniqueId, TechniqueInfo>> = {
  'DET-001': info(G, 'HTMLCanvasElement.toDataURL / toBlob', 'canvas'),
  'DET-002': info(G, 'CanvasRenderingContext2D.getImageData', 'canvas'),
  'DET-003': info(G, 'measureText / fillText / strokeText', 'canvas'),
  'DET-004': info(G, 'OffscreenCanvas.getContext / convertToBlob', 'canvas'),
  'DET-005': info(G, 'Element.getClientRects / getBoundingClientRect / offsetWidth'),
  'DET-006': info(G, 'Range.getClientRects / getBoundingClientRect'),
  'DET-007': info(G, 'SVG getBBox / getComputedTextLength / getSubStringLength'),
  'DET-008': info(G, 'FontFaceSet.check / load'),
  'DET-009': info(G, 'window.queryLocalFonts'),
  'DET-010': info(G, 'getComputedStyle / computedStyleMap'),
  'DET-011': info(G, 'WebGL getParameter / getExtension / getSupportedExtensions / getShaderPrecisionFormat'),
  'DET-012': info(G, 'WebGL readPixels', 'canvas'),
  'DET-013': info(G, 'GPU.requestAdapter / GPUAdapter.info / features / limits'),
  'DET-014': info(G, 'GPUBuffer.mapAsync / getMappedRange'),
  'DET-015': info(A, 'OfflineAudioContext.startRendering / AudioNode.connect'),
  'DET-016': info(A, 'AudioBuffer.getChannelData / copyFromChannel / AnalyserNode'),
  'DET-017': info(A, 'AudioContext properties'),
  'DET-018': info(A, 'speechSynthesis.getVoices'),
  'DET-019': info(A, 'MediaDevices.enumerateDevices / MediaStreamTrack.getCapabilities'),
  'DET-020': info(A, 'canPlayType / MediaSource.isTypeSupported / mediaCapabilities'),
  'DET-021': info(A, 'navigator.requestMediaKeySystemAccess'),
  'DET-022': info(A, 'Math.* (trigonometric, hyperbolic, exp / log)', 'math'),
  'DET-023': info(A, 'Math.pow / sqrt / hypot / cbrt / fround', 'math'),
  'DET-024': info(A, 'CSS math functions (partial coverage)'),
  'DET-025': info(E, 'Navigator.userAgent / platform / vendor / languages'),
  'DET-026': info(E, 'navigator.userAgentData.getHighEntropyValues'),
  'DET-027': info(E, 'navigator.plugins / mimeTypes / pdfViewerEnabled'),
  'DET-028': info(E, 'navigator.webdriver'),
  'DET-029': info(E, 'Screen.width / height / colorDepth / orientation'),
  'DET-030': info(E, 'innerWidth / outerWidth / devicePixelRatio / visualViewport'),
  'DET-031': info(E, 'window.getScreenDetails / screen.isExtended'),
  'DET-032': info(E, 'navigator.hardwareConcurrency'),
  'DET-033': info(E, 'navigator.deviceMemory'),
  'DET-034': info(E, 'maxTouchPoints / pointer media features'),
  'DET-035': info(E, 'Date.getTimezoneOffset'),
  'DET-036': info(E, 'Intl.*.resolvedOptions'),
  'DET-037': info(E, 'matchMedia'),
  'DET-038': info(E, 'CSS.supports / feature detection'),
  'DET-039': info(P, 'Permissions.query'),
  'DET-040': info(P, 'navigator.getBattery'),
  'DET-041': info(P, 'NetworkInformation (effectiveType / rtt / downlink / saveData)'),
  'DET-042': info(P, 'Generic Sensor / DeviceMotion / DeviceOrientation'),
  'DET-043': info(P, 'addEventListener (pointer / key / touch / scroll)'),
  'DET-044': info(P, 'Geolocation.getCurrentPosition / watchPosition'),
  'DET-045': info(P, 'Bluetooth getAvailability / getDevices / requestDevice'),
  'DET-046': info(P, 'USB / HID / Serial device requests'),
  'DET-047': info(P, 'navigator.getGamepads'),
  'DET-048': info(P, 'WebXR isSessionSupported / requestSession'),
  'DET-049': info(S, 'document.cookie / CookieStore'),
  'DET-050': info(S, 'Storage.getItem / setItem / removeItem'),
  'DET-051': info(S, 'IDBFactory.open'),
  'DET-052': info(S, 'CacheStorage.open / Cache.match / put'),
  'DET-053': info(S, 'navigator.storage.estimate / persist'),
  'DET-054': info(S, 'hasStorageAccess / requestStorageAccess'),
  'DET-055': info(S, 'ETag / If-None-Match (network)'),
  'DET-056': info(N, 'RTCPeerConnection / createOffer / createDataChannel / setLocalDescription', 'webrtc'),
  'DET-057': info(N, 'ICE candidates / RTCPeerConnection.getStats', 'webrtc'),
  'DET-058': info(N, 'WebSocket / WebTransport'),
  'DET-059': info(N, 'fetch / XMLHttpRequest / sendBeacon'),
  'DET-060': info(N, 'local address and port access sequences', 'local-probe'),
  'DET-061': info(N, 'unique subdomain request series', 'dns'),
  'DET-062': info(N, 'vendor delivery via first-party hostname / CNAME'),
  'DET-063': info(N, 'ServiceWorkerContainer.register'),
  'DET-064': info(N, 'Worker / SharedWorker / Worklet'),
  'DET-065': info(N, 'WebAssembly.compile / instantiate'),
  'DET-066': info(N, 'performance.now / Performance timeline'),
  'DET-067': info(N, 'server-side fingerprint (TLS / HTTP / QUIC)', 'generic', true),
  'DET-068': info(N, 'CSS without JavaScript', 'generic', true),
  'DET-069': info(P, 'WebAuthn isUserVerifyingPlatformAuthenticatorAvailable'),
};

export function categoryKey(category: TechniqueCategory): string {
  return 'category_' + category;
}
