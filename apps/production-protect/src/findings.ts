// Positive, value-free findings shared by the SW surface and extension UI.
// No detector thresholds, browser APIs or page/UI dependencies live here.
import { ATTRIBUTION_CONFIDENCES, COUNT_QUALITIES, DELIVERY_STATES, EVIDENCE_ID_PATTERN, EVIDENCE_SOURCES, FIELD_KINDS, FRAME_CONTEXTS, HOST_CATEGORIES, INTEGRITIES,
  MAX_COUNT, PARAM_NAME_PATTERN, PROTECT_BUDGETS, PROTECT_FEATURES, PROTECT_HTTP_METHODS, PROTECT_LIMITATIONS, PROTECT_REQUEST_KINDS, PROTECT_WIRE_LIMITS,
  REPLAY_BODY_SIZES, REPLAY_SIGNAL_CODES, SINCE_INPUT, SITE_RELATIONS, SUBMIT_TIMINGS, TRANSFER_CLASSES, VALUE_ENCODINGS, VALUE_LOCATIONS, isEndpointPathTemplate, isSiteName } from '@detect-expert/contracts';
import type { ProtectTransferEvidence, ReplaySummary } from '@detect-expert/contracts';

export interface FindingSnapshot { documentKey: string; site: string; keys: string[] }
export interface PositiveFindings { transfers: ProtectTransferEvidence[]; replay: ReplaySummary | null }
export const FINDING_DOCUMENT_KEY = /^\d+:0:[A-Za-z0-9_-]{1,64}$/;
export const MAX_FINDING_KEYS = PROTECT_BUDGETS.maxEvidencePerDocument + PROTECT_BUDGETS.maxReplayPeriodicHosts + 1;
const own = (value: unknown, key: PropertyKey): unknown => typeof value === 'object' && value !== null ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const member = (value: unknown, values: readonly string[]): value is string => typeof value === 'string' && values.includes(value);
const count = (value: unknown, max = MAX_COUNT): value is number => Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= max;
const nonnegative = (value: unknown, max: number): boolean => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max;
function dataRecord(value: unknown, max: number): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length <= max && keys.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, 'value'));
}
function list(value: unknown, max: number): unknown[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const out: unknown[] = [];
  for (let index = 0; index < value.length; index++) {
    const field = Object.getOwnPropertyDescriptor(value, String(index));
    if (!field || !Object.hasOwn(field, 'value')) return null;
    out.push(field.value);
  }
  return out;
}
const codes = (value: unknown, max: number, values: readonly string[]): boolean => {
  const entries = list(value, max); return entries !== null && entries.every(entry => member(entry, values));
};

/** A matched value is a finding even when the request outcome is unknown/stopped. */
export function isPositiveTransfer(value: unknown): value is ProtectTransferEvidence {
  if (!dataRecord(value, 48)) return false;
  if (own(value, 'protectKind') !== 'value-match' || own(value, 'ruleId') !== 'form-leak') return false;
  if (!text(own(value, 'evidenceId'), 15) || !EVIDENCE_ID_PATTERN.test(own(value, 'evidenceId') as string) || !count(own(value, 'count'))) return false;
  if (!member(own(value, 'transferClass'), TRANSFER_CLASSES) || own(value, 'transferClass') === 'opaque-after-input' || !member(own(value, 'fieldKind'), FIELD_KINDS)) return false;
  const encodings = list(own(value, 'encodings'), PROTECT_WIRE_LIMITS.maxEvidenceEncodings);
  if (encodings === null || encodings.length === 0 || !encodings.every(entry => member(entry, VALUE_ENCODINGS))) return false;
  if (!member(own(value, 'location'), VALUE_LOCATIONS) || own(value, 'location') === 'body-opaque' || !member(own(value, 'deliveryState'), DELIVERY_STATES)) return false;
  if (!member(own(value, 'interpretationConfidence'), ['low', 'medium', 'high']) || !member(own(value, 'frameContext'), FRAME_CONTEXTS)) return false;
  if (!member(own(value, 'method'), PROTECT_HTTP_METHODS) || !member(own(value, 'requestKind'), PROTECT_REQUEST_KINDS) || !member(own(value, 'relation'), SITE_RELATIONS)) return false;
  if (!member(own(value, 'submitTiming'), SUBMIT_TIMINGS) || !member(own(value, 'countQuality'), COUNT_QUALITIES) || !member(own(value, 'attributionConfidence'), ATTRIBUTION_CONFIDENCES)) return false;
  if (!isEndpointPathTemplate(own(value, 'endpointPathTemplate')) || !text(own(value, 'ruleVersion'), 64)) return false;
  const receiver = own(value, 'receiver'), category = own(value, 'receiverCategory');
  if (receiver !== undefined ? !isSiteName(receiver) || category !== undefined : !member(category, HOST_CATEGORIES)) return false;
  const endpoint = own(value, 'endpointHost');
  if (endpoint !== null && !text(endpoint, 253)) return false;
  if (!nonnegative(own(value, 'firstSecond'), PROTECT_WIRE_LIMITS.maxEvidenceSecond) || !nonnegative(own(value, 'lastSecond'), PROTECT_WIRE_LIMITS.maxEvidenceSecond)) return false;
  if (own(value, 'evidenceSource') !== 'derived' || own(value, 'integrity') !== 'derived') return false;
  if (!codes(own(value, 'limitationCodes'), PROTECT_WIRE_LIMITS.maxEvidenceLimitations, PROTECT_LIMITATIONS)) return false;
  const param = own(value, 'paramName'), since = own(value, 'sinceInput'), frameSite = own(value, 'frameSite');
  if (own(value, 'pathSegment') !== undefined && !nonnegative(own(value, 'pathSegment'), PROTECT_WIRE_LIMITS.maxEvidencePathSegment)) return false;
  return (param === undefined || typeof param === 'string' && PARAM_NAME_PATTERN.test(param)) &&
    (since === undefined || member(since, SINCE_INPUT)) && (frameSite === undefined || isSiteName(frameSite));
}

/** Mere registrations, empty/unassessed summaries and signals-only are not findings. */
export function isPositiveReplay(value: unknown): value is ReplaySummary {
  if (!dataRecord(value, 20)) return false;
  if (own(value, 'ruleId') !== 'session-replay-behavior' || !text(own(value, 'ruleVersion'), 64)) return false;
  if (!member(own(value, 'level'), ['replay-like', 'replay-recording']) || !member(own(value, 'interpretationConfidence'), ['low', 'medium'])) return false;
  const signals = list(own(value, 'signals'), PROTECT_WIRE_LIMITS.maxReplaySignals);
  const hosts = list(own(value, 'periodicHosts'), PROTECT_BUDGETS.maxReplayPeriodicHosts);
  if (signals === null || signals.length === 0 || hosts === null) return false;
  if (!signals.every(signal => member(own(signal, 'code'), REPLAY_SIGNAL_CODES) && count(own(signal, 'count')) && member(own(signal, 'countQuality'), COUNT_QUALITIES) && member(own(signal, 'evidenceSource'), EVIDENCE_SOURCES) && member(own(signal, 'integrity'), INTEGRITIES))) return false;
  if (!hosts.every(host => isSiteName(own(host, 'registrableDomain')) && count(own(host, 'sends')) && nonnegative(own(host, 'runMax'), PROTECT_BUDGETS.replayRunMaxCeiling) && nonnegative(own(host, 'largeInRunMax'), PROTECT_BUDGETS.replayRunMaxCeiling) && member(own(host, 'bodySize'), REPLAY_BODY_SIZES))) return false;
  return member(own(value, 'inputMasking'), ['unconfirmed', 'value-seen-in-traffic']) && member(own(value, 'attributionConfidence'), ATTRIBUTION_CONFIDENCES) &&
    list(own(value, 'vendors'), PROTECT_BUDGETS.maxReplayVendors) !== null && codes(own(value, 'limitationCodes'), PROTECT_WIRE_LIMITS.maxReplayLimitations, PROTECT_LIMITATIONS);
}

export function positiveFindings(report: unknown): PositiveFindings {
  const none = (): PositiveFindings => ({ transfers: [], replay: null });
  if (!member(own(report, 'moduleState'), ['active', 'degraded']) || !text(own(report, 'documentKey'), 96) || !FINDING_DOCUMENT_KEY.test(own(report, 'documentKey') as string) || !isSiteName(own(report, 'site'))) return none();
  if (!member(own(report, 'coverageState'), ['active', 'partial', 'late-start', 'degraded'])) return none();
  const features = list(own(report, 'features'), PROTECT_FEATURES.length), evidence = list(own(report, 'evidence'), PROTECT_BUDGETS.maxEvidencePerDocument);
  if (features === null || !features.every(feature => member(feature, PROTECT_FEATURES)) || evidence === null) return none();
  const replay = own(report, 'replay');
  return { transfers: features.includes('value-match') ? evidence.filter(isPositiveTransfer) : [], replay: features.includes('session-replay') && isPositiveReplay(replay) ? replay : null };
}

/** Semantic keys ignore counts, generated evidence IDs and delivery updates. */
export function positiveFindingSnapshot(report: unknown): FindingSnapshot | null {
  const findings = positiveFindings(report), keys: string[] = [];
  for (const evidence of findings.transfers) keys.push('transfer:' + JSON.stringify([evidence.fieldKind, evidence.transferClass, evidence.receiver ?? evidence.receiverCategory,
    evidence.location, evidence.paramName ?? '', evidence.pathSegment ?? '', evidence.endpointHost, evidence.endpointPathTemplate, evidence.frameContext, evidence.frameSite ?? '']));
  if (findings.replay !== null) {
    const receivers = findings.replay.periodicHosts.map(host => host.registrableDomain);
    for (const receiver of receivers.length ? receivers : ['']) keys.push('replay:' + findings.replay.level + ':' + receiver);
  }
  return keys.length ? { documentKey: own(report, 'documentKey') as string, site: own(report, 'site') as string, keys: [...new Set(keys)].sort().slice(0, MAX_FINDING_KEYS) } : null;
}
