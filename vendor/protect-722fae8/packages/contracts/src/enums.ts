// Canonical wire enums (docs/PROJECT_RULES.md, spec Part VI I1.1). These are the ONLY wire names.
// Do not introduce parallel names (observationSource, techniqueConfidence, page_observed, ...).

export { TECHNIQUE_IDS } from './technique-ids';
export type { TechniqueId } from './technique-ids';

/** Protocol version carried by every wire message. Unknown versions are rejected. */
export const PROTOCOL_VERSION = 1 as const;
export type ProtocolVersion = typeof PROTOCOL_VERSION;

/** Routing channel tag for window.postMessage between MAIN and ISOLATED. Routing only, not authentication. */
export const CHANNEL = 'detect.expert/v1' as const;
export type Channel = typeof CHANNEL;

/**
 * sensorBootId of a bridge-hello broadcast before any sensor announced itself (ADR-004 §9 handshake): the
 * ISOLATED bridge posts it on a bounded retry; a MAIN sensor that sees it re-sends its sensor-hello. Routing only.
 */
export const UNBOUND_SENSOR_BOOT_ID = 'unbound' as const;

/** Allowed per-observation signal codes (pack enum + v1 additions). */
export const SIGNAL_CODES = [
  'api-use',
  'readback-after-text',
  'offline-render',
  'numeric-diversity',
  'known-numeric-pattern',
  'local-multi-port',
  'unique-subdomains',
  'early-observation',
  'late-start',
  'hook-failed',
  'sample-budget-exceeded',
  'tainted-canvas-attempt',
  'export-after-text',
  'hook-replaced',
  'bfcache-restore',
  'text-measured',
  'text-drawn',
] as const;
export type SignalCode = (typeof SIGNAL_CODES)[number];

/** Coverage flags: reasons why "not observed" does not mean "did not happen". */
export const COVERAGE_FLAGS = [
  'late-start',
  'hook-failed',
  'throttled',
  'unsupported-realm',
  'channel-gap',
  'truncated',
  'paused',
  'revoked',
  'protocol-mismatch',
  'descriptor-nonconfigurable',
  'bridge-ring-overflow',
  'budget-exceeded',
  'no-host-permission',
  'restricted-page',
  'worker-not-observed',
  // Permission-limited network and inaccessible child frames (REQ-006, ADR-003, F175).
  'network-limited',
  'frames-inaccessible',
  // ADR-019 (S11): part of the sensor families is disabled (user or organization). Set by the SW only; a page
  // coverageDelta can never assert it. Appended at the end: the coverageRef bits of the older flags are unchanged.
  'sensor-disabled',
] as const;
export type CoverageFlag = (typeof COVERAGE_FLAGS)[number];

export const EVIDENCE_SOURCES = [
  'browser-network',
  'browser-navigation',
  'page-hook',
  'page-dom',
  'derived',
] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

export const INTEGRITIES = ['browser-observed', 'page-controlled', 'derived'] as const;
export type Integrity = (typeof INTEGRITIES)[number];

export const INTERPRETATIONS = [
  'api-use',
  'possible-fingerprinting',
  'fingerprinting-pattern',
  'local-probe-pattern',
  'dns-test-pattern',
  'unknown',
] as const;
export type Interpretation = (typeof INTERPRETATIONS)[number];

export const INTERPRETATION_CONFIDENCES = ['low', 'medium', 'high', 'unassessed'] as const;
export type InterpretationConfidence = (typeof INTERPRETATION_CONFIDENCES)[number];

export const ATTRIBUTION_CONFIDENCES = ['exact-resource', 'sampled-stack', 'frame-only', 'unknown'] as const;
export type AttributionConfidence = (typeof ATTRIBUTION_CONFIDENCES)[number];

/** Vendor confidence axis values; the canonical wire field is `vendorConfidence` (ADR-001 §1). */
export const VENDOR_MATCHES = ['documented-resource', 'multi-signal', 'weak-signal', 'none'] as const;
export type VendorMatch = (typeof VENDOR_MATCHES)[number];

export const COVERAGE_STATES = [
  'active',
  'partial',
  'late-start',
  'paused',
  'unsupported',
  'no-access',
  'degraded',
] as const;
export type CoverageState = (typeof COVERAGE_STATES)[number];

export const COUNT_QUALITIES = ['exact', 'sampled', 'lower-bound'] as const;
export type CountQuality = (typeof COUNT_QUALITIES)[number];

export const PHASES = [
  'attempted',
  'returned-sync',
  'threw-sync',
  'async-returned',
  'settlement-unobserved',
] as const;
export type Phase = (typeof PHASES)[number];

/**
 * Category of a browser-observed network host that has no PSL registrable domain (ADR-008 §5, ADR-018): IP class,
 * local name kind or unknown. Never the address or the name itself.
 */
export const HOST_CATEGORIES = [
  'loopback',
  'link-local',
  'private',
  'ULA',
  'public',
  'localhost',
  'local',
  'single-label',
  'unknown',
] as const;
export type HostCategory = (typeof HOST_CATEGORIES)[number];

/** Schemeful site relation of a request target to its browser-reported initiator (ADR-008 §2, ADR-018). */
export const SITE_RELATIONS = ['same-origin', 'same-site', 'cross-site', 'opaque', 'unknown'] as const;
export type SiteRelation = (typeof SITE_RELATIONS)[number];

/** Observation scope chosen by the user (spec Part II A3). `off` is the post-install default. */
export const SCOPE_MODES = ['off', 'active-tab', 'site', 'all-sites'] as const;
export type ScopeMode = (typeof SCOPE_MODES)[number];

/**
 * Sensor family ids (ADR-019, S11) = the MAIN registry packages/sensors/src/registry.ts, in the same order. The
 * index is the bit of the off mask and of the sensor-off.<id>.js prelude file. Append only; an id is never renamed
 * or reused (a managed policy names these ids).
 */
export const SENSOR_IDS = ['canvas', 'webgl', 'audio', 'permissions', 'environment', 'geometry'] as const;
export type SensorId = (typeof SENSOR_IDS)[number];

/** Who disabled a sensor family (ADR-019): the user in the options page, or the organization (managed policy). */
export const SENSOR_DISABLE_SOURCES = ['user', 'organization'] as const;
export type SensorDisableSource = (typeof SENSOR_DISABLE_SOURCES)[number];

/**
 * State of the managed DisabledSensorIds policy (ADR-019): absent; applied (a valid value is in effect);
 * last-known-good (the current value is invalid or unreadable, the last valid value stays in effect).
 */
export const ORGANIZATION_POLICY_STATES = ['absent', 'applied', 'last-known-good'] as const;
export type OrganizationPolicyState = (typeof ORGANIZATION_POLICY_STATES)[number];

export const SENSOR_STATES = ['active', 'paused', 'degraded', 'stopped'] as const;
export type SensorState = (typeof SENSOR_STATES)[number];

export const BRIDGE_STOP_REASONS = ['protocol-mismatch', 'revoked', 'scope-changed', 'unload'] as const;
export type BridgeStopReason = (typeof BRIDGE_STOP_REASONS)[number];

/** SW -> ISOLATED bridge control (chrome.tabs.sendMessage to one document; ADR-004 changelog, F030). */
export const BRIDGE_CONTROL_COMMANDS = ['pause', 'resume', 'stop'] as const;
export type BridgeControlCommand = (typeof BRIDGE_CONTROL_COMMANDS)[number];

export const DOCUMENT_LIFECYCLES = ['pending', 'committed', 'bfcache', 'prerender', 'closed'] as const;
export type DocumentLifecycle = (typeof DOCUMENT_LIFECYCLES)[number];

export const UI_ERROR_CODES = [
  'invalid-request',
  'unauthorized-sender',
  'not-found',
  'stale-revision',
  'document-mismatch',
  'no-access',
  'not-implemented',
  // ADR-020 «Защита» (S02): appended at the end; the indices of the codes above do not move.
  'module-disabled',
  'feature-disabled',
  'consent-required',
  'permission-required',
  'disabled-by-organization',
  'limit-reached',
  'storage-unavailable',
  'unsafe-receiver',
] as const;
export type UiErrorCode = (typeof UI_ERROR_CODES)[number];
