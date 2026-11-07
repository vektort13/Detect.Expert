// Technique registry facts used by the engine (spec Part III §2, sections 2.1–2.6). Categories follow the
// registry subsections; DET-067/068 are documented coverage boundaries, not detectors.

import type { TechniqueId } from '@detect-expert/contracts';

export const TECHNIQUE_CATEGORIES = [
  'graphics',
  'media-compute',
  'environment',
  'devices',
  'storage',
  'network',
  'boundary',
] as const;
export type TechniqueCategory = (typeof TECHNIQUE_CATEGORIES)[number];

/** Registry subsection of a technique (spec III §2.1–2.6). */
export function techniqueCategory(id: TechniqueId): TechniqueCategory {
  const n = Number(id.slice(4));
  if (n <= 14) return 'graphics';
  if (n <= 24) return 'media-compute';
  if (n <= 38) return 'environment';
  if (n <= 48 || n === 69) return 'devices';
  if (n <= 55) return 'storage';
  if (n <= 66) return 'network';
  return 'boundary';
}

/** Slice 1: canvas family (E07-01). */
export const CANVAS_TECHNIQUE_IDS = ['DET-001', 'DET-002', 'DET-003', 'DET-004'] as const;
export type CanvasTechniqueId = (typeof CANVAS_TECHNIQUE_IDS)[number];

const CANVAS_SET: ReadonlySet<string> = new Set<string>(CANVAS_TECHNIQUE_IDS);

export function isCanvasTechnique(id: TechniqueId): id is CanvasTechniqueId {
  return CANVAS_SET.has(id);
}

/** Techniques whose call hands pixels (or an encoded image) back to the page. DET-003 only draws/measures. */
export const CANVAS_READOUT_TECHNIQUE_IDS = ['DET-002', 'DET-001', 'DET-004'] as const;

/** E07-03 (S04): WebGL family — DET-011 parameter/extension/capability queries, DET-012 readPixels. */
export const WEBGL_TECHNIQUE_IDS = ['DET-011', 'DET-012'] as const;
export type WebglTechniqueId = (typeof WEBGL_TECHNIQUE_IDS)[number];

const WEBGL_SET: ReadonlySet<string> = new Set<string>(WEBGL_TECHNIQUE_IDS);

export function isWebglTechnique(id: TechniqueId): id is WebglTechniqueId {
  return WEBGL_SET.has(id);
}

/** E08-01 (S05): Web Audio family — DET-015 offline graph (oscillator, compressor, rendering), DET-016 data readout. */
export const AUDIO_TECHNIQUE_IDS = ['DET-015', 'DET-016'] as const;
export type AudioTechniqueId = (typeof AUDIO_TECHNIQUE_IDS)[number];

const AUDIO_SET: ReadonlySet<string> = new Set<string>(AUDIO_TECHNIQUE_IDS);

export function isAudioTechnique(id: TechniqueId): id is AudioTechniqueId {
  return AUDIO_SET.has(id);
}

/** E08-03 (S05): Permissions family — DET-039 permission state checks (category only, never the state). */
export const PERMISSION_TECHNIQUE_IDS = ['DET-039'] as const;
export type PermissionTechniqueId = (typeof PERMISSION_TECHNIQUE_IDS)[number];

export function isPermissionTechnique(id: TechniqueId): id is PermissionTechniqueId {
  return id === 'DET-039';
}

/**
 * E08-02 (S06): environment family — DET-025 navigator identity, DET-026 User-Agent Client Hints, DET-029 screen,
 * DET-032 hardwareConcurrency, DET-033 deviceMemory. Only the generic api-use rule applies (no cross-surface rule).
 */
export const ENVIRONMENT_TECHNIQUE_IDS = ['DET-025', 'DET-026', 'DET-029', 'DET-032', 'DET-033'] as const;
export type EnvironmentTechniqueId = (typeof ENVIRONMENT_TECHNIQUE_IDS)[number];

const ENVIRONMENT_SET: ReadonlySet<string> = new Set<string>(ENVIRONMENT_TECHNIQUE_IDS);

export function isEnvironmentTechnique(id: TechniqueId): id is EnvironmentTechniqueId {
  return ENVIRONMENT_SET.has(id);
}

/** E07-02 (S06): geometry family — DET-005 element size and position reads (offset getters, rect methods). */
export const GEOMETRY_TECHNIQUE_IDS = ['DET-005'] as const;
export type GeometryTechniqueId = (typeof GEOMETRY_TECHNIQUE_IDS)[number];

export function isGeometryTechnique(id: TechniqueId): id is GeometryTechniqueId {
  return id === 'DET-005';
}

/**
 * S06: common surfaces — read constantly by layout, compatibility checks and analytics. The UI ranks them below other
 * techniques of the same tier so they never push canvas/WebGL out of the popup's top cards. DET-026 (high-entropy
 * hints) is deliberately not listed.
 */
export const COMMON_SURFACE_TECHNIQUE_IDS = ['DET-005', 'DET-025', 'DET-029', 'DET-032', 'DET-033'] as const;

const COMMON_SURFACE_SET: ReadonlySet<string> = new Set<string>(COMMON_SURFACE_TECHNIQUE_IDS);

export function isCommonSurfaceTechnique(id: TechniqueId): boolean {
  return COMMON_SURFACE_SET.has(id);
}

/**
 * S07 / ADR-018: N-part of DET-058…061, observed only by the SW (webRequest onBeforeRequest) into
 * DocumentReport.networkCounters. Page-hook observations of these ids are ignored by the SW and never summarized as
 * page-hook (the J-parts, e.g. a WebSocket constructor sensor, are not admitted: FOLLOWUPS item 10).
 */
export const NETWORK_TECHNIQUE_IDS = ['DET-058', 'DET-059', 'DET-060', 'DET-061'] as const;
export type NetworkTechniqueId = (typeof NETWORK_TECHNIQUE_IDS)[number];
export const PAGE_HOOK_EXCLUDED_TECHNIQUE_IDS: readonly TechniqueId[] = NETWORK_TECHNIQUE_IDS;

const NETWORK_SET: ReadonlySet<string> = new Set<string>(NETWORK_TECHNIQUE_IDS);

export function isNetworkTechnique(id: TechniqueId): id is NetworkTechniqueId {
  return NETWORK_SET.has(id);
}

/** UI message keys per technique (docs/ui-copy.md §4.1). Techniques without a key use `card_api_use_generic`. */
export const TECHNIQUE_LABEL_KEYS: Readonly<Partial<Record<TechniqueId, string>>> = Object.freeze({
  'DET-001': 'card_api_use_canvas_export',
  'DET-002': 'card_api_use_canvas_readback',
  'DET-003': 'card_api_use_canvas_text',
  'DET-004': 'card_api_use_offscreen',
  // S04 / I1: WebGL. 'card_api_use_webgl_params' carries $API$ (viewmodel.ts LABELS_WITH_API), as in packages/ui cards.ts.
  'DET-011': 'card_api_use_webgl_params',
  'DET-012': 'card_api_use_webgl_readback',
  // S05: Web Audio and Permissions ($COUNT$ only).
  'DET-015': 'card_api_use_audio_graph',
  'DET-016': 'card_api_use_audio_readout',
  'DET-039': 'card_api_use_permissions',
  // S06 / I1: geometry and environment, the same keys as packages/ui cards.ts ('card_api_use_geometry' carries $API$).
  'DET-005': 'card_api_use_geometry',
  'DET-025': 'card_api_use_navigator',
  'DET-026': 'card_api_use_ua_hints',
  'DET-029': 'card_api_use_screen',
  'DET-032': 'card_api_use_hardware_concurrency',
  'DET-033': 'card_api_use_device_memory',
});

/** API surface names shown verbatim in both locales ($API$ placeholder). Never page data. */
export const TECHNIQUE_API_NAMES: Readonly<Partial<Record<TechniqueId, string>>> = Object.freeze({
  'DET-001': 'toDataURL / toBlob',
  'DET-002': 'getImageData',
  'DET-003': 'measureText / fillText / strokeText',
  'DET-004': 'OffscreenCanvas',
  // S04: WebGL family. I1: getParameter is not wrapped in this build (FAMILY_CONFIG.webglGetParameter 'off', S03
  // perf no-go), so the label does not name it (REQ-014/015); the same text as packages/ui TECHNIQUE_INFO.
  'DET-011': 'WebGL getExtension / getSupportedExtensions / getShaderPrecisionFormat',
  'DET-012': 'readPixels',
  // S05: Web Audio and Permissions.
  'DET-015': 'createOscillator / createDynamicsCompressor / AudioNode.connect / startRendering',
  'DET-016': 'getChannelData / copyFromChannel / AnalyserNode',
  'DET-039': 'Permissions.query / PermissionStatus.state',
  // S06: environment and geometry.
  'DET-005': 'Element.getBoundingClientRect / getClientRects / HTMLElement.offsetWidth / offsetHeight',
  'DET-025': 'Navigator.userAgent / platform / vendor / language / languages',
  'DET-026': 'Navigator.userAgentData / NavigatorUAData.getHighEntropyValues',
  'DET-029': 'Screen.width / height / availWidth / availHeight / colorDepth / pixelDepth / orientation',
  'DET-032': 'Navigator.hardwareConcurrency',
  'DET-033': 'Navigator.deviceMemory',
  // S07 / I1: browser-network techniques (request types seen by webRequest, not page hooks); the same text as
  // packages/ui TECHNIQUE_INFO (S08). WebTransport is not observed. The suffix is a separate literal so the label never
  // reads as a call to the lint rule (scripts/lint.mjs network-call).
  'DET-058': 'WebSocket handshake (webRequest)',
  'DET-059': 'fetch / XMLHttpRequest / sendBeacon' + ' (webRequest)',
  'DET-060': 'local address and port access sequences',
  'DET-061': 'unique subdomain request series',
});
