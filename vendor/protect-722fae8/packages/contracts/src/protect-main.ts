// ADR-020 §F: MAIN <-> ISOLATED messages of the «Защита» module on its own window.postMessage channel. Everything from
// MAIN is page-controlled (integrity: page-controlled); `event.source === window`, the channel tag, sensorBootId and
// relaySessionId are routing, not authentication (REQ-004). Only ScriptRef (masked host + safe path template), enums
// and counters cross this channel: never a value, a value length, a hash, a URL, a raw stack or a function name.
// The observation channel `detect.expert/v1` (sensor-* / bridge-*) does not change.

import type { AttributionConfidence, BridgeStopReason, CountQuality, SiteRelation } from './enums';
import type { ProtectLimitation, ProtectMainDropped, ScriptRef } from './protect';

/** Routing tag of the module channel (separate from CHANNEL; bridge.js ignores it). */
export const PROTECT_CHANNEL = 'detect.expert/protect/v1' as const;
export type ProtectChannel = typeof PROTECT_CHANNEL;

/** Protocol version of the MAIN <-> ISOLATED module channel. */
export const PROTECT_MAIN_PROTOCOL_VERSION = 1 as const;

export const PROTECT_HOOK_POINTS = ['send-fetch', 'send-xhr', 'send-beacon', 'send-image', 'listen', 'observe-document'] as const;
export type ProtectHookPoint = (typeof PROTECT_HOOK_POINTS)[number];

export const PROTECT_SEND_HOOK_POINTS = ['send-fetch', 'send-xhr', 'send-beacon', 'send-image'] as const satisfies readonly ProtectHookPoint[];
export type ProtectSendHookPoint = (typeof PROTECT_SEND_HOOK_POINTS)[number];

export const PROTECT_REGISTRATION_HOOK_POINTS = ['listen', 'observe-document'] as const satisfies readonly ProtectHookPoint[];
export type ProtectRegistrationHookPoint = (typeof PROTECT_REGISTRATION_HOOK_POINTS)[number];

/** How the send target was read: an absolute address (masked host only), a relative one, or not read (object/Proxy). */
export const SEND_TARGET_KINDS = ['absolute', 'relative', 'unread'] as const;
export type SendTargetKind = (typeof SEND_TARGET_KINDS)[number];

/** Event types whose listener registrations are sampled (exact, case-sensitive match of a primitive string type). */
export const LISTEN_EVENT_CODES = [
  'input',
  'beforeinput',
  'change',
  'paste',
  'copy',
  'cut',
  'keydown',
  'keyup',
  'keypress',
  'focusin',
  'focusout',
  'blur',
  'selectionchange',
  'mousemove',
  'pointermove',
  'touchmove',
  'scroll',
  'wheel',
] as const;
export type ListenEventCode = (typeof LISTEN_EVENT_CODES)[number];

/** Registration target by identity / brand check: never the element's value or attributes other than `type`. */
export const LISTEN_TARGET_KINDS = ['window', 'document', 'root', 'field', 'field-password', 'other'] as const;
export type ListenTargetKind = (typeof LISTEN_TARGET_KINDS)[number];

/** Result of the SW correlation of a request with MAIN send samples (correlate.ts). */
export const SEND_CORRELATIONS = ['pending', 'unique', 'ambiguous', 'none', 'gap', 'saturated'] as const;
export type SendCorrelation = (typeof SEND_CORRELATIONS)[number];

export type SendTarget = { kind: 'absolute'; host: string } | { kind: 'relative' } | { kind: 'unread' };

/** One sampled send call (MAIN wire). */
export interface SendSampleWire {
  hookPoint: ProtectSendHookPoint;
  /** Monotonic per sensor boot, 1..MAX_COUNT (a gap means lost samples). */
  sensorSeq: number;
  /** Page clock (performance.now()), rounded to a multiple of 10 ms, 0..MAX_COUNT. */
  tMs: number;
  script: ScriptRef;
  /** False when the stack budget was exhausted (script then has kind 'unknown'). */
  sampled: boolean;
  /** `host` is a masked host (isScriptHost). */
  target: SendTarget;
}

/** One aggregated listener / observer registration (MAIN wire). `eventCode` only for `listen`. */
export interface RegistrationSampleWire {
  hookPoint: ProtectRegistrationHookPoint;
  eventCode?: ListenEventCode;
  targetKind: ListenTargetKind;
  script: ScriptRef;
  sampled: boolean;
  /** Saturating number of folded registrations of this key since the previous flush. */
  count: number;
  tMs: number;
}

interface ProtectMainBase {
  channel: ProtectChannel;
  /** Local boot id of the MAIN module instance; UNBOUND_SENSOR_BOOT_ID in a relay hello before any MAIN hello. */
  sensorBootId: string;
}

/** MAIN -> ISOLATED. `groups` is the PROTECT_MAIN_GROUPS mask the prelude enabled. */
export interface ProtectMainHelloMessage extends ProtectMainBase {
  type: 'protect-main-hello';
  protocolVersion: number;
  startedLate: boolean;
  groups: number;
}

/** MAIN -> ISOLATED. At most PROTECT_BUDGETS.maxItemsPerBatch sends + registrations and BUDGETS.maxBatchBytes. */
export interface ProtectMainBatchMessage extends ProtectMainBase {
  type: 'protect-main-batch';
  /** Batch sequence, monotonic per sensor boot, starts at 1. */
  sensorSeq: number;
  sends: SendSampleWire[];
  registrations: RegistrationSampleWire[];
  dropped: ProtectMainDropped;
  /** At most PROTECT_WIRE_LIMITS.maxEventLimitations. */
  limitations: ProtectLimitation[];
}

export type ProtectMainMessage = ProtectMainHelloMessage | ProtectMainBatchMessage;

/** ISOLATED -> MAIN (the page can forge these as well; shape-check only). */
export interface ProtectRelayHelloMessage extends ProtectMainBase {
  type: 'protect-relay-hello';
  protocolVersion: number;
  relaySessionId: string;
  paused: boolean;
}

export interface ProtectRelayPauseMessage extends ProtectMainBase {
  type: 'protect-relay-pause';
}

export interface ProtectRelayResumeMessage extends ProtectMainBase {
  type: 'protect-relay-resume';
}

export interface ProtectRelayStopMessage extends ProtectMainBase {
  type: 'protect-relay-stop';
  reason: BridgeStopReason;
}

export type ProtectRelayMessage = ProtectRelayHelloMessage | ProtectRelayPauseMessage | ProtectRelayResumeMessage | ProtectRelayStopMessage;

/**
 * SW result of attributing one request (attribution service port `attributionFor(requestId)`). Page-controlled: the
 * level is at most `sampled-stack`; `exact-resource` is unreachable.
 */
export interface ScriptAttribution {
  script: ScriptRef | null;
  /** PSL registrable domain of the script host, or null. */
  scriptSite: string | null;
  /** Relation of the script site to the request initiator. */
  scriptRelation: SiteRelation;
  attributionConfidence: Extract<AttributionConfidence, 'sampled-stack' | 'unknown'>;
  evidenceSource: 'page-hook';
  integrity: 'page-controlled';
  correlation: SendCorrelation;
  /** A `script` request of this host was observed in the document (webRequest). */
  scriptLoadObserved: boolean;
  limitationCodes: ProtectLimitation[];
}

/** Per-document script activity summary (SW memory, ≤ PROTECT_BUDGETS.maxScriptActivityPerDocument) for session replay. */
export interface ScriptActivityEntry {
  script: ScriptRef;
  scriptSite: string | null;
  hookPoints: ProtectHookPoint[];
  eventCodes: ListenEventCode[];
  targetKinds: ListenTargetKind[];
  count: number;
  sampledCount: number;
  countQuality: CountQuality;
}
