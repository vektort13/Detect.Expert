// ADR-020 «Защита»: hand-written strict validators of the module's untrusted input (REQ-004, REQ-011). Same rules as
// validate.ts: cheap shape checks first; exactly the listed keys; enums via sets; strings, arrays and integers bounded;
// counts saturate at MAX_COUNT; never throws; reasons never echo input values (only fixed key names and indices).
// Byte budgets are checked on the normalized copy after the structural checks, by counting (never by serializing).
// Helpers are local (not shared with validate.ts) so that the observation validator is unchanged and this module is
// dropped from bundles that do not use it. MAIN parses only relay messages: that path uses captured intrinsics only.

import { BUDGETS, MAX_COUNT } from './budgets';
import { BRIDGE_STOP_REASONS, EVIDENCE_SOURCES, INTEGRITIES, INTERPRETATION_CONFIDENCES, TECHNIQUE_IDS } from './enums';
import type { BridgeStopReason, EvidenceSource, Integrity, InterpretationConfidence, TechniqueId } from './enums';
import { isSanitizedHost } from './host';
import { WIRE_CATALOG_VERSION_PATTERN, WIRE_RULE_ID_PATTERN } from './messages';
import type { ProtectUiRequest, UiProtectRequestStatusRequest } from './messages';
import {
  EVIDENCE_ID_PATTERN,
  FIELD_KINDS,
  FINGERPRINT_ENCODINGS,
  FINGERPRINT_HASH_PATTERN,
  FINGERPRINT_TRIGGERS,
  HISTORY_RETENTION_DAYS,
  PARAM_NAME_PATTERN,
  PROMPT_ID_PATTERN,
  PROTECT_BUDGETS,
  PROTECT_CONTROL_COMMANDS,
  PROTECT_FEATURES,
  PROTECT_LIMITATIONS,
  PROTECT_MAIN_GROUPS,
  PROTECT_PRESETS,
  PROTECT_PURGE_TARGETS,
  PROTECT_SNOOZE_MINUTES,
  PROTECT_WIRE_LIMITS,
  SALT_ID_PATTERN,
  SALT_PATTERN,
  SCRIPT_REF_KINDS,
  SUBMIT_SIGNALS,
  SUBMIT_TIMINGS,
  UNDO_ID_PATTERN,
  VALUE_ENCODINGS,
  VALUE_LOCATIONS,
  isDomainName,
  isEndpointPathTemplate,
  isScriptHost,
  isScriptPathTemplate,
  isSiteName,
} from './protect';
import type {
  FieldKind,
  FingerprintEncoding,
  FingerprintTrigger,
  HistoryRetentionDays,
  ProtectAck,
  ProtectControlCommand,
  ProtectControlMessage,
  ProtectFeature,
  ProtectFieldFingerprint,
  ProtectFingerprintEntry,
  ProtectLimitation,
  ProtectMainDropped,
  ProtectPageMessage,
  ProtectPreset,
  ProtectPurgeTarget,
  ProtectSnoozeMinutes,
  RegistrationSampleSw,
  ScriptRef,
  ScriptRefKind,
  SendSampleSw,
  SubmitSignal,
  SubmitTiming,
  ValueEncoding,
  ValueLocation,
} from './protect';
import { DECISION_SCOPES, FIREWALL_ACTIONS, FIREWALL_RULE_KEY_PATTERN } from './protect-firewall';
import type { DecisionScope, FirewallAction } from './protect-firewall';
import { HISTORY_DELETE_TARGETS, HISTORY_ROW_KEY_PATTERN, HISTORY_WINDOW_DAYS } from './protect-history';
import type { HistoryDeleteTarget, HistoryWindowDays } from './protect-history';
import {
  LISTEN_EVENT_CODES,
  LISTEN_TARGET_KINDS,
  PROTECT_CHANNEL,
  PROTECT_REGISTRATION_HOOK_POINTS,
  PROTECT_SEND_HOOK_POINTS,
} from './protect-main';
import type {
  ListenEventCode,
  ListenTargetKind,
  ProtectMainMessage,
  ProtectRegistrationHookPoint,
  ProtectRelayMessage,
  ProtectSendHookPoint,
  RegistrationSampleWire,
  SendSampleWire,
  SendTarget,
} from './protect-main';
import {
  CONTACT_ID_PATTERN,
  JURISDICTION_LETTER_LANGS,
  JURISDICTION_REQUEST_KINDS,
  RECIPIENT_CHANNELS,
  REQUEST_DELIVERIES,
  REQUEST_ENDPOINT_SCHEMES,
  REQUEST_FACT_KINDS,
  REQUEST_ID_PATTERN,
  REQUEST_IDENTITY_KINDS,
  REQUEST_JURISDICTIONS,
  REQUEST_KINDS,
  REQUEST_LETTER_LANGS,
  REQUEST_RECORD_EXTRA_CHARS,
  REQUEST_SOURCE_KINDS,
  REQUEST_STATUSES,
  REQUEST_SUBJECT_ROLES,
  REQUEST_VIEWS,
  TEMPLATE_ID_PATTERN,
  TEMPLATE_VERSION_PATTERN,
  isEntityName,
  isLocalDay,
  isPortalUrl,
  isRequestEmail,
} from './protect-requests';
import type {
  DeletionRequestRecord,
  NewRequestInput,
  RecipientChannel,
  RecipientRef,
  RequestDelivery,
  RequestEndpoint,
  RequestEndpointScheme,
  RequestEvidenceFact,
  RequestFactKind,
  RequestHistoryEntry,
  RequestIdentityKind,
  RequestJurisdiction,
  RequestKind,
  RequestLetterLang,
  RequestPrefs,
  RequestSourceKind,
  RequestStatus,
  RequestSubject,
  RequestSubjectRole,
  RequestView,
  StoredRequestJournal,
} from './protect-requests';
import type { ValidationFailure, ValidationResult } from './validate';

// Captured at module evaluation (document_start in MAIN, before page scripts), as in validate.ts (F168).
const capturedApply = Reflect.apply;
const capturedKeys = Object.keys;
const capturedIsArray = Array.isArray;
const capturedHasOwn = Object.prototype.hasOwnProperty;
const capturedSetHas = Set.prototype.has;
const capturedSetSize = Object.getOwnPropertyDescriptor(Set.prototype, 'size')!.get!;
const capturedInteger = Number.isInteger;
const capturedRegexExec = RegExp.prototype.exec;

function makeSet(values: readonly (string | number)[]): ReadonlySet<string | number> {
  return new Set<string | number>(values);
}

function setContains(set: ReadonlySet<string | number>, value: string | number): boolean {
  return capturedApply(capturedSetHas, set, [value]) as boolean;
}

const FORBIDDEN_KEYS = /* @__PURE__ */ makeSet(['__proto__', 'constructor', 'prototype']);
const BROWSER_ID_KEYS = ['tabId', 'frameId', 'documentId'] as const;
const ID_RE = /^[A-Za-z0-9_-]+$/;
const DOCUMENT_KEY_RE = /^[A-Za-z0-9_:.-]+$/;
const DOMAIN_FILTER_RE = /^[a-z0-9.-]{1,64}$/;
const MAX_ENUM_CHARS = 64;
const MAX_TYPE_CHARS = 32;

function fail(reason: string): ValidationFailure {
  return { ok: false, reason };
}

function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

function isObjectLike(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !capturedIsArray(v);
}

function hasOwn(o: object, k: string): boolean {
  return capturedApply(capturedHasOwn, o, [k]) as boolean;
}

function matches(re: RegExp, s: string): boolean {
  return capturedApply(capturedRegexExec, re, [s]) !== null;
}

/** Null when acceptable. Does not echo unknown (page-controlled) key names. */
function checkKeys(obj: Record<string, unknown>, allowed: ReadonlySet<string | number>, required: readonly string[], path: string): string | null {
  const keys = capturedKeys(obj);
  if (keys.length > (capturedApply(capturedSetSize, allowed, []) as number)) return path + ': too many keys';
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!;
    if (setContains(FORBIDDEN_KEYS, k)) return path + ': forbidden key';
    if (!setContains(allowed, k)) return path + ': unknown key';
  }
  for (let i = 0; i < required.length; i++) {
    if (!hasOwn(obj, required[i]!)) return path + ': missing ' + required[i]!;
  }
  return null;
}

function concatKeys(a: readonly string[], b: readonly string[]): readonly string[] {
  return [...a, ...b];
}

function keySet(required: readonly string[], optional: readonly string[] = []): ReadonlySet<string | number> {
  return makeSet(concatKeys(required, optional));
}

function readString(v: unknown, min: number, max: number): string | null {
  return typeof v === 'string' && v.length >= min && v.length <= max ? v : null;
}

function readPattern(v: unknown, re: RegExp, max: number): string | null {
  const s = readString(v, 1, max);
  return s !== null && matches(re, s) ? s : null;
}

function readId(v: unknown): string | null {
  return readPattern(v, ID_RE, BUDGETS.maxIdChars);
}

function readDocumentKey(v: unknown): string | null {
  return readPattern(v, DOCUMENT_KEY_RE, BUDGETS.maxDocumentKeyChars);
}

function readBool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

/** Finite integer within [min, max]; -0 normalized to 0. */
function readInt(v: unknown, min: number, max: number): number | null {
  if (typeof v !== 'number' || !capturedInteger(v) || v < min || v > max) return null;
  return v === 0 ? 0 : v;
}

/** Finite non-negative integer, saturated at MAX_COUNT. */
function readCount(v: unknown): number | null {
  if (typeof v !== 'number' || !capturedInteger(v) || v < 0) return null;
  if (v > MAX_COUNT) return MAX_COUNT;
  return v === 0 ? 0 : v;
}

function readEnum<T extends string>(v: unknown, set: ReadonlySet<string | number>): T | null {
  return typeof v === 'string' && v.length <= MAX_ENUM_CHARS && setContains(set, v) ? (v as T) : null;
}

function readIntEnum<T extends number>(v: unknown, set: ReadonlySet<string | number>): T | null {
  return typeof v === 'number' && setContains(set, v) ? (v as T) : null;
}

function readArray(v: unknown, min: number, max: number): unknown[] | null {
  if (!capturedIsArray(v) || v.length < min || v.length > max) return null;
  return v;
}

/** Bounded array of unique enum members (indexed loop: no iterator protocol). */
function readEnumArray<T extends string>(v: unknown, set: ReadonlySet<string | number>, min: number, max: number): T[] | null {
  const items = readArray(v, min, max);
  if (items === null) return null;
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    const e = readEnum<T>(items[i], set);
    if (e === null || out.includes(e)) return null;
    out.push(e);
  }
  return out;
}

/** Bounded array of unique strings accepted by `check`. */
function readUniqueStrings(v: unknown, min: number, max: number, check: (s: unknown) => boolean): string[] | null {
  const items = readArray(v, min, max);
  if (items === null) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < items.length; i++) {
    const s = items[i];
    if (typeof s !== 'string' || !check(s) || seen.has(s)) return null;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function readMessageType(input: Record<string, unknown>): string | null {
  const t = input['type'];
  return typeof t === 'string' && t.length >= 1 && t.length <= MAX_TYPE_CHARS ? t : null;
}

// ---------------------------------------------------------------------------
// Exact JSON length of validated plain data (strings, integers, booleans, null, arrays, objects) without serializing.
// ---------------------------------------------------------------------------

function jsonStringChars(s: string): number {
  let n = s.length + 2;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 34 || c === 92) n += 1;
    else if (c < 0x20) n += c === 8 || c === 9 || c === 10 || c === 12 || c === 13 ? 1 : 5;
    else if (c >= 0xd800 && c <= 0xdbff) {
      const d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (d >= 0xdc00 && d <= 0xdfff) i++;
      else n += 5;
    } else if (c >= 0xdc00 && c <= 0xdfff) n += 5;
  }
  return n;
}

function jsonIntegerChars(n: number): number {
  let x = n < 0 ? -n : n;
  let len = n < 0 ? 2 : 1;
  while (x >= 10) {
    len++;
    x = Math.floor(x / 10);
  }
  return len;
}

function jsonLength(v: unknown, limit: number): number {
  if (v === null) return 4;
  switch (typeof v) {
    case 'boolean':
      return v ? 4 : 5;
    case 'number':
      return jsonIntegerChars(v);
    case 'string':
      return jsonStringChars(v);
    case 'object': {
      let total = 1;
      if (capturedIsArray(v)) {
        for (let i = 0; i < v.length; i++) {
          if (i > 0) total++;
          total += jsonLength(v[i], limit - total);
          if (total > limit) return limit + 1;
        }
        return total + 1;
      }
      const record = v as Record<string, unknown>;
      const keys = capturedKeys(record);
      let first = true;
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i]!;
        const item = record[key];
        if (item === undefined) continue;
        if (!first) total++;
        first = false;
        total += jsonStringChars(key) + 1;
        total += jsonLength(item, limit - total);
        if (total > limit) return limit + 1;
      }
      return total + 1;
    }
    default:
      return 4;
  }
}

/**
 * JSON.stringify(value).length of validated plain data (integers only), counted without serializing; stops counting
 * above `limit` and returns limit + 1. For the ASCII-only module wire messages this is also the UTF-8 byte length.
 */
export function jsonLengthUpTo(value: unknown, limit: number): number {
  return jsonLength(value, limit);
}

/** JSON characters of a journal record (budget PROTECT_BUDGETS.maxRecordChars), counted without serializing. */
export function estimateRecordChars(record: DeletionRequestRecord): number {
  return jsonLength(record, Number.MAX_SAFE_INTEGER);
}

// ---------------------------------------------------------------------------
// Shared module shapes
// ---------------------------------------------------------------------------

const SCRIPT_KIND_SET = /* @__PURE__ */ makeSet(SCRIPT_REF_KINDS);
const SCRIPT_EXTERNAL_KEYS = ['kind', 'scheme', 'host', 'pathTemplate'] as const;
const SCRIPT_EXTERNAL_SET = /* @__PURE__ */ keySet(SCRIPT_EXTERNAL_KEYS);
const KIND_ONLY_KEYS = ['kind'] as const;
const KIND_ONLY_SET = /* @__PURE__ */ keySet(KIND_ONLY_KEYS);
const TARGET_ABSOLUTE_KEYS = ['kind', 'host'] as const;
const TARGET_ABSOLUTE_SET = /* @__PURE__ */ keySet(TARGET_ABSOLUTE_KEYS);
const LIMITATION_SET = /* @__PURE__ */ makeSet(PROTECT_LIMITATIONS);

/** ScriptRef: scheme/host/pathTemplate exactly for `external`; host masked, path a fixed point of templateScriptPath. */
function readScriptRef(v: unknown, path: string): ValidationResult<ScriptRef> {
  if (!isObjectLike(v)) return fail(path + ': not an object');
  const kind = readEnum<ScriptRefKind>(v['kind'], SCRIPT_KIND_SET);
  if (kind === null) return fail(path + '.kind');
  if (kind !== 'external') {
    const keyError = checkKeys(v, KIND_ONLY_SET, KIND_ONLY_KEYS, path);
    return keyError !== null ? fail(keyError) : ok({ kind });
  }
  const keyError = checkKeys(v, SCRIPT_EXTERNAL_SET, SCRIPT_EXTERNAL_KEYS, path);
  if (keyError !== null) return fail(keyError);
  const scheme = v['scheme'];
  if (scheme !== 'http' && scheme !== 'https') return fail(path + '.scheme');
  const host = v['host'];
  if (!isScriptHost(host)) return fail(path + '.host');
  const pathTemplate = v['pathTemplate'];
  if (!isScriptPathTemplate(pathTemplate)) return fail(path + '.pathTemplate');
  return ok({ kind, scheme, host, pathTemplate });
}

function readSendTarget(v: unknown, path: string): ValidationResult<SendTarget> {
  if (!isObjectLike(v)) return fail(path + ': not an object');
  const kind = v['kind'];
  if (kind === 'absolute') {
    const keyError = checkKeys(v, TARGET_ABSOLUTE_SET, TARGET_ABSOLUTE_KEYS, path);
    if (keyError !== null) return fail(keyError);
    const host = v['host'];
    return isScriptHost(host) ? ok({ kind, host }) : fail(path + '.host');
  }
  if (kind !== 'relative' && kind !== 'unread') return fail(path + '.kind');
  const keyError = checkKeys(v, KIND_ONLY_SET, KIND_ONLY_KEYS, path);
  return keyError !== null ? fail(keyError) : ok({ kind });
}

function readLimitations(v: unknown, max: number): ProtectLimitation[] | null {
  return readEnumArray<ProtectLimitation>(v, LIMITATION_SET, 0, max);
}

const DROPPED_KEYS = ['sends', 'registrations', 'unsampled'] as const;
const DROPPED_SET = /* @__PURE__ */ keySet(DROPPED_KEYS);

function readMainDropped(v: unknown, path: string): ValidationResult<ProtectMainDropped> {
  if (!isObjectLike(v)) return fail(path + ': not an object');
  const keyError = checkKeys(v, DROPPED_SET, DROPPED_KEYS, path);
  if (keyError !== null) return fail(keyError);
  const sends = readCount(v['sends']);
  const registrations = readCount(v['registrations']);
  const unsampled = readCount(v['unsampled']);
  if (sends === null) return fail(path + '.sends');
  if (registrations === null) return fail(path + '.registrations');
  if (unsampled === null) return fail(path + '.unsampled');
  return ok({ sends, registrations, unsampled });
}

const SEND_HOOK_SET = /* @__PURE__ */ makeSet(PROTECT_SEND_HOOK_POINTS);
const REGISTRATION_HOOK_SET = /* @__PURE__ */ makeSet(PROTECT_REGISTRATION_HOOK_POINTS);
const LISTEN_EVENT_SET = /* @__PURE__ */ makeSet(LISTEN_EVENT_CODES);
const LISTEN_TARGET_SET = /* @__PURE__ */ makeSet(LISTEN_TARGET_KINDS);

type TimeField = 'tMs' | 'ageMs';

/** Page-clock time of a MAIN sample (multiple of 10 ms) or its age on the ISOLATED clock (0..maxSampleAgeMs). */
function readSampleTime(v: unknown, field: TimeField): number | null {
  if (field === 'ageMs') return readInt(v, 0, PROTECT_BUDGETS.maxSampleAgeMs);
  const t = readInt(v, 0, MAX_COUNT);
  return t !== null && t % 10 === 0 ? t : null;
}

const SEND_WIRE_KEYS = ['hookPoint', 'sensorSeq', 'script', 'sampled', 'target', 'tMs'] as const;
const SEND_SW_KEYS = ['hookPoint', 'sensorSeq', 'script', 'sampled', 'target', 'ageMs'] as const;
const SEND_WIRE_SET = /* @__PURE__ */ keySet(SEND_WIRE_KEYS);
const SEND_SW_SET = /* @__PURE__ */ keySet(SEND_SW_KEYS);
const REGISTRATION_WIRE_KEYS = ['hookPoint', 'targetKind', 'script', 'sampled', 'count', 'tMs'] as const;
const REGISTRATION_SW_KEYS = ['hookPoint', 'targetKind', 'script', 'sampled', 'count', 'ageMs'] as const;
const REGISTRATION_OPTIONAL_KEYS = ['eventCode'] as const;
const REGISTRATION_WIRE_SET = /* @__PURE__ */ keySet(REGISTRATION_WIRE_KEYS, REGISTRATION_OPTIONAL_KEYS);
const REGISTRATION_SW_SET = /* @__PURE__ */ keySet(REGISTRATION_SW_KEYS, REGISTRATION_OPTIONAL_KEYS);

function readSendSample(v: unknown, field: TimeField, path: string): ValidationResult<Record<string, unknown>> {
  if (!isObjectLike(v)) return fail(path + ': not an object');
  const keyError = field === 'tMs' ? checkKeys(v, SEND_WIRE_SET, SEND_WIRE_KEYS, path) : checkKeys(v, SEND_SW_SET, SEND_SW_KEYS, path);
  if (keyError !== null) return fail(keyError);
  const hookPoint = readEnum<ProtectSendHookPoint>(v['hookPoint'], SEND_HOOK_SET);
  if (hookPoint === null) return fail(path + '.hookPoint');
  const sensorSeq = readInt(v['sensorSeq'], 1, MAX_COUNT);
  if (sensorSeq === null) return fail(path + '.sensorSeq');
  const time = readSampleTime(v[field], field);
  if (time === null) return fail(path + '.' + field);
  const script = readScriptRef(v['script'], path + '.script');
  if (!script.ok) return script;
  const sampled = readBool(v['sampled']);
  if (sampled === null) return fail(path + '.sampled');
  const target = readSendTarget(v['target'], path + '.target');
  if (!target.ok) return target;
  return ok({ hookPoint, sensorSeq, [field]: time, script: script.value, sampled, target: target.value });
}

/** `eventCode` exactly for `listen`; `observe-document` targets only the document or its root elements. */
function readRegistrationSample(v: unknown, field: TimeField, path: string): ValidationResult<Record<string, unknown>> {
  if (!isObjectLike(v)) return fail(path + ': not an object');
  const keyError =
    field === 'tMs'
      ? checkKeys(v, REGISTRATION_WIRE_SET, REGISTRATION_WIRE_KEYS, path)
      : checkKeys(v, REGISTRATION_SW_SET, REGISTRATION_SW_KEYS, path);
  if (keyError !== null) return fail(keyError);
  const hookPoint = readEnum<ProtectRegistrationHookPoint>(v['hookPoint'], REGISTRATION_HOOK_SET);
  if (hookPoint === null) return fail(path + '.hookPoint');
  const targetKind = readEnum<ListenTargetKind>(v['targetKind'], LISTEN_TARGET_SET);
  if (targetKind === null) return fail(path + '.targetKind');
  let eventCode: ListenEventCode | null = null;
  if (hookPoint === 'listen') {
    eventCode = readEnum<ListenEventCode>(v['eventCode'], LISTEN_EVENT_SET);
    if (eventCode === null) return fail(path + '.eventCode');
  } else {
    if (hasOwn(v, 'eventCode')) return fail(path + '.eventCode: only for listen');
    if (targetKind !== 'document' && targetKind !== 'root') return fail(path + '.targetKind');
  }
  const script = readScriptRef(v['script'], path + '.script');
  if (!script.ok) return script;
  const sampled = readBool(v['sampled']);
  if (sampled === null) return fail(path + '.sampled');
  const count = readCount(v['count']);
  if (count === null) return fail(path + '.count');
  const time = readSampleTime(v[field], field);
  if (time === null) return fail(path + '.' + field);
  const out: Record<string, unknown> = { hookPoint };
  if (eventCode !== null) out['eventCode'] = eventCode;
  out['targetKind'] = targetKind;
  out['script'] = script.value;
  out['sampled'] = sampled;
  out['count'] = count;
  out[field] = time;
  return ok(out);
}

interface Samples {
  sends: Record<string, unknown>[];
  registrations: Record<string, unknown>[];
}

/** sends + registrations: at most PROTECT_BUDGETS.maxItemsPerBatch together (lengths checked before any item). */
function readSamples(sendsIn: unknown, registrationsIn: unknown, field: TimeField, path: string): ValidationResult<Samples> {
  const sendItems = readArray(sendsIn, 0, PROTECT_BUDGETS.maxItemsPerBatch);
  if (sendItems === null) return fail(path + '.sends');
  const registrationItems = readArray(registrationsIn, 0, PROTECT_BUDGETS.maxItemsPerBatch);
  if (registrationItems === null) return fail(path + '.registrations');
  if (sendItems.length + registrationItems.length > PROTECT_BUDGETS.maxItemsPerBatch) return fail(path + ': too many samples');
  const sends: Record<string, unknown>[] = [];
  for (let i = 0; i < sendItems.length; i++) {
    const r = readSendSample(sendItems[i], field, path + '.sends[' + String(i) + ']');
    if (!r.ok) return r;
    sends.push(r.value);
  }
  const registrations: Record<string, unknown>[] = [];
  for (let i = 0; i < registrationItems.length; i++) {
    const r = readRegistrationSample(registrationItems[i], field, path + '.registrations[' + String(i) + ']');
    if (!r.ok) return r;
    registrations.push(r.value);
  }
  return ok({ sends, registrations });
}

function isEmptyBatch(samples: Samples, dropped: ProtectMainDropped, limitations: readonly ProtectLimitation[]): boolean {
  return (
    samples.sends.length === 0 &&
    samples.registrations.length === 0 &&
    limitations.length === 0 &&
    dropped.sends === 0 &&
    dropped.registrations === 0 &&
    dropped.unsampled === 0
  );
}

// ---------------------------------------------------------------------------
// ISOLATED -> SW page messages (runtime.sendMessage). tabId/frameId/documentId are never accepted from a payload.
// ---------------------------------------------------------------------------

const FIELD_KIND_SET = /* @__PURE__ */ makeSet(FIELD_KINDS);
const FINGERPRINT_ENC_SET = /* @__PURE__ */ makeSet(FINGERPRINT_ENCODINGS);
const TRIGGER_SET = /* @__PURE__ */ makeSet(FINGERPRINT_TRIGGERS);
const SUBMIT_SIGNAL_SET = /* @__PURE__ */ makeSet(SUBMIT_SIGNALS);

const HELLO_KEYS = ['schemaVersion', 'type', 'startedLate'] as const;
const HELLO_SET = /* @__PURE__ */ keySet(HELLO_KEYS);
const ARM_KEYS = ['schemaVersion', 'type', 'fieldKind'] as const;
const ARM_SET = /* @__PURE__ */ keySet(ARM_KEYS);
const INPUT_KEYS = ['schemaVersion', 'type', 'saltId', 'seq', 'fields', 'submit', 'neverReadFields', 'paymentSuspended'] as const;
const INPUT_SET = /* @__PURE__ */ keySet(INPUT_KEYS);
const FIELD_KEYS = ['fieldRef', 'fieldKind', 'trigger', 'entries'] as const;
const FIELD_SET = /* @__PURE__ */ keySet(FIELD_KEYS);
const ENTRY_KEYS = ['enc', 'len', 'h'] as const;
const ENTRY_SET = /* @__PURE__ */ keySet(ENTRY_KEYS);
const EVENTS_KEYS = ['schemaVersion', 'type', 'sensorBootId', 'relaySessionId', 'batchSeq', 'sends', 'registrations', 'dropped', 'limitations'] as const;
const EVENTS_SET = /* @__PURE__ */ keySet(EVENTS_KEYS);

function readFingerprintEntry(v: unknown, path: string): ValidationResult<ProtectFingerprintEntry> {
  if (!isObjectLike(v)) return fail(path + ': not an object');
  const keyError = checkKeys(v, ENTRY_SET, ENTRY_KEYS, path);
  if (keyError !== null) return fail(keyError);
  const enc = readEnum<FingerprintEncoding>(v['enc'], FINGERPRINT_ENC_SET);
  if (enc === null) return fail(path + '.enc');
  const len = readInt(v['len'], PROTECT_WIRE_LIMITS.minFingerprintLen, PROTECT_WIRE_LIMITS.maxFingerprintLen);
  if (len === null) return fail(path + '.len');
  const h = readPattern(v['h'], FINGERPRINT_HASH_PATTERN, 13);
  if (h === null) return fail(path + '.h');
  return ok({ enc, len, h });
}

function readFieldFingerprint(v: unknown, path: string): ValidationResult<ProtectFieldFingerprint> {
  if (!isObjectLike(v)) return fail(path + ': not an object');
  const keyError = checkKeys(v, FIELD_SET, FIELD_KEYS, path);
  if (keyError !== null) return fail(keyError);
  const fieldRef = readInt(v['fieldRef'], 1, PROTECT_BUDGETS.maxTrackedFieldsPerDocument);
  if (fieldRef === null) return fail(path + '.fieldRef');
  const fieldKind = readEnum<FieldKind>(v['fieldKind'], FIELD_KIND_SET);
  if (fieldKind === null) return fail(path + '.fieldKind');
  const trigger = readEnum<FingerprintTrigger>(v['trigger'], TRIGGER_SET);
  if (trigger === null) return fail(path + '.trigger');
  const items = readArray(v['entries'], 1, PROTECT_BUDGETS.maxVariantsPerField);
  if (items === null) return fail(path + '.entries');
  const entries: ProtectFingerprintEntry[] = [];
  for (let i = 0; i < items.length; i++) {
    const r = readFingerprintEntry(items[i], path + '.entries[' + String(i) + ']');
    if (!r.ok) return r;
    entries.push(r.value);
  }
  return ok({ fieldRef, fieldKind, trigger, entries });
}

function protectPageMessage(input: unknown): ValidationResult<ProtectPageMessage> {
  if (!isObjectLike(input)) return fail('protect-page: not an object');
  for (let i = 0; i < BROWSER_ID_KEYS.length; i++) {
    if (hasOwn(input, BROWSER_ID_KEYS[i]!)) return fail('protect-page: browser ids come from MessageSender only');
  }
  if (input['schemaVersion'] !== 1) return fail('protect-page.schemaVersion');
  const type = readMessageType(input);
  switch (type) {
    case 'protect-hello': {
      const keyError = checkKeys(input, HELLO_SET, HELLO_KEYS, type);
      if (keyError !== null) return fail(keyError);
      const startedLate = readBool(input['startedLate']);
      if (startedLate === null) return fail(type + '.startedLate');
      return ok({ schemaVersion: 1, type, startedLate });
    }
    case 'protect-arm': {
      const keyError = checkKeys(input, ARM_SET, ARM_KEYS, type);
      if (keyError !== null) return fail(keyError);
      const fieldKind = readEnum<FieldKind>(input['fieldKind'], FIELD_KIND_SET);
      if (fieldKind === null) return fail(type + '.fieldKind');
      return ok({ schemaVersion: 1, type, fieldKind });
    }
    case 'protect-input': {
      const keyError = checkKeys(input, INPUT_SET, INPUT_KEYS, type);
      if (keyError !== null) return fail(keyError);
      const saltId = readPattern(input['saltId'], SALT_ID_PATTERN, 16);
      if (saltId === null) return fail(type + '.saltId');
      const seq = readInt(input['seq'], 0, MAX_COUNT);
      if (seq === null) return fail(type + '.seq');
      const items = readArray(input['fields'], 0, PROTECT_BUDGETS.maxFieldsPerInputMessage);
      if (items === null) return fail(type + '.fields');
      const fields: ProtectFieldFingerprint[] = [];
      for (let i = 0; i < items.length; i++) {
        const r = readFieldFingerprint(items[i], type + '.fields[' + String(i) + ']');
        if (!r.ok) return r;
        for (let j = 0; j < fields.length; j++) {
          if (fields[j]!.fieldRef === r.value.fieldRef) return fail(type + '.fields[' + String(i) + '].fieldRef: duplicate');
        }
        fields.push(r.value);
      }
      const submit = readEnum<SubmitSignal>(input['submit'], SUBMIT_SIGNAL_SET);
      if (submit === null) return fail(type + '.submit');
      const neverReadFields = readInt(input['neverReadFields'], 0, PROTECT_WIRE_LIMITS.maxNeverReadFields);
      if (neverReadFields === null) return fail(type + '.neverReadFields');
      const paymentSuspended = readBool(input['paymentSuspended']);
      if (paymentSuspended === null) return fail(type + '.paymentSuspended');
      const value = { schemaVersion: 1 as const, type, saltId, seq, fields, submit, neverReadFields, paymentSuspended };
      if (jsonLength(value, PROTECT_BUDGETS.maxInputMessageBytes) > PROTECT_BUDGETS.maxInputMessageBytes) return fail(type + ': over the byte budget');
      return ok(value);
    }
    case 'protect-events': {
      const keyError = checkKeys(input, EVENTS_SET, EVENTS_KEYS, type);
      if (keyError !== null) return fail(keyError);
      const sensorBootId = readId(input['sensorBootId']);
      if (sensorBootId === null) return fail(type + '.sensorBootId');
      const relaySessionId = readId(input['relaySessionId']);
      if (relaySessionId === null) return fail(type + '.relaySessionId');
      const batchSeq = readInt(input['batchSeq'], 1, MAX_COUNT);
      if (batchSeq === null) return fail(type + '.batchSeq');
      const samples = readSamples(input['sends'], input['registrations'], 'ageMs', type);
      if (!samples.ok) return samples;
      const dropped = readMainDropped(input['dropped'], type + '.dropped');
      if (!dropped.ok) return dropped;
      const limitations = readLimitations(input['limitations'], PROTECT_WIRE_LIMITS.maxEventLimitations);
      if (limitations === null) return fail(type + '.limitations');
      if (isEmptyBatch(samples.value, dropped.value, limitations)) return fail(type + ': empty');
      const value = {
        schemaVersion: 1 as const,
        type,
        sensorBootId,
        relaySessionId,
        batchSeq,
        sends: samples.value.sends as unknown as SendSampleSw[],
        registrations: samples.value.registrations as unknown as RegistrationSampleSw[],
        dropped: dropped.value,
        limitations,
      };
      if (jsonLength(value, BUDGETS.maxBatchBytes) > BUDGETS.maxBatchBytes) return fail(type + ': over the byte budget');
      return ok(value);
    }
    default:
      return fail('protect-page.type');
  }
}

/** Validation of an ISOLATED -> SW module message (page-controlled document). Never throws; fresh normalized copy. */
export function validateProtectPageMessage(input: unknown): ValidationResult<ProtectPageMessage> {
  try {
    return protectPageMessage(input);
  } catch {
    return fail('protect-page: exception');
  }
}

// ---------------------------------------------------------------------------
// SW -> ISOLATED: ack (answer) and control (tabs.sendMessage). The receiver verifies the SW sender; shape-check only.
// ---------------------------------------------------------------------------

const ACK_REQUIRED = ['schemaVersion', 'type', 'active', 'groups'] as const;
const ACK_SET = /* @__PURE__ */ keySet(ACK_REQUIRED, ['saltId', 'salt']);
const CONTROL_KEYS = ['schemaVersion', 'type', 'command'] as const;
const CONTROL_SET = /* @__PURE__ */ keySet(CONTROL_KEYS);
const CONTROL_COMMAND_SET = /* @__PURE__ */ makeSet(PROTECT_CONTROL_COMMANDS);
const MAX_GROUP_MASK = (1 << PROTECT_MAIN_GROUPS.length) - 1;

function protectAck(input: unknown): ValidationResult<ProtectAck> {
  if (!isObjectLike(input)) return fail('protect-ack: not an object');
  const keyError = checkKeys(input, ACK_SET, ACK_REQUIRED, 'protect-ack');
  if (keyError !== null) return fail(keyError);
  if (input['schemaVersion'] !== 1) return fail('protect-ack.schemaVersion');
  if (input['type'] !== 'protect-ack') return fail('protect-ack.type');
  const active = readBool(input['active']);
  if (active === null) return fail('protect-ack.active');
  const groups = readInt(input['groups'], 0, MAX_GROUP_MASK);
  if (groups === null) return fail('protect-ack.groups');
  const hasSaltId = hasOwn(input, 'saltId');
  if (hasSaltId !== hasOwn(input, 'salt')) return fail('protect-ack: saltId and salt go together');
  if (!hasSaltId) return ok({ schemaVersion: 1, type: 'protect-ack', active, groups });
  if (!active) return fail('protect-ack: salt only while active');
  const saltId = readPattern(input['saltId'], SALT_ID_PATTERN, 16);
  if (saltId === null) return fail('protect-ack.saltId');
  const salt = readPattern(input['salt'], SALT_PATTERN, 22);
  if (salt === null) return fail('protect-ack.salt');
  return ok({ schemaVersion: 1, type: 'protect-ack', active, saltId, salt, groups });
}

/** Validation of the SW answer to a module page message. Never throws. */
export function validateProtectAck(input: unknown): ValidationResult<ProtectAck> {
  try {
    return protectAck(input);
  } catch {
    return fail('protect-ack: exception');
  }
}

function protectControl(input: unknown): ValidationResult<ProtectControlMessage> {
  if (!isObjectLike(input)) return fail('protect-control: not an object');
  const keyError = checkKeys(input, CONTROL_SET, CONTROL_KEYS, 'protect-control');
  if (keyError !== null) return fail(keyError);
  if (input['schemaVersion'] !== 1) return fail('protect-control.schemaVersion');
  if (input['type'] !== 'protect-control') return fail('protect-control.type');
  const command = readEnum<ProtectControlCommand>(input['command'], CONTROL_COMMAND_SET);
  if (command === null) return fail('protect-control.command');
  return ok({ schemaVersion: 1, type: 'protect-control', command });
}

/** Validation of a SW -> ISOLATED protect-control message. Never throws. */
export function validateProtectControl(input: unknown): ValidationResult<ProtectControlMessage> {
  try {
    return protectControl(input);
  } catch {
    return fail('protect-control: exception');
  }
}

// ---------------------------------------------------------------------------
// MAIN -> ISOLATED (page-controlled) and ISOLATED -> MAIN (forgeable) on PROTECT_CHANNEL.
// ---------------------------------------------------------------------------

const MAIN_HELLO_KEYS = ['channel', 'sensorBootId', 'type', 'protocolVersion', 'startedLate', 'groups'] as const;
const MAIN_HELLO_SET = /* @__PURE__ */ keySet(MAIN_HELLO_KEYS);
const MAIN_BATCH_KEYS = ['channel', 'sensorBootId', 'type', 'sensorSeq', 'sends', 'registrations', 'dropped', 'limitations'] as const;
const MAIN_BATCH_SET = /* @__PURE__ */ keySet(MAIN_BATCH_KEYS);
const RELAY_HELLO_KEYS = ['channel', 'sensorBootId', 'type', 'protocolVersion', 'relaySessionId', 'paused'] as const;
const RELAY_HELLO_SET = /* @__PURE__ */ keySet(RELAY_HELLO_KEYS);
const RELAY_SIMPLE_KEYS = ['channel', 'sensorBootId', 'type'] as const;
const RELAY_SIMPLE_SET = /* @__PURE__ */ keySet(RELAY_SIMPLE_KEYS);
const RELAY_STOP_KEYS = ['channel', 'sensorBootId', 'type', 'reason'] as const;
const RELAY_STOP_SET = /* @__PURE__ */ keySet(RELAY_STOP_KEYS);
const STOP_REASON_SET = /* @__PURE__ */ makeSet(BRIDGE_STOP_REASONS);

function readChannelHeader(input: Record<string, unknown>, path: string): ValidationResult<string> {
  if (input['channel'] !== PROTECT_CHANNEL) return fail(path + '.channel');
  const sensorBootId = readId(input['sensorBootId']);
  return sensorBootId === null ? fail(path + '.sensorBootId') : ok(sensorBootId);
}

function protectMainMessage(input: unknown): ValidationResult<ProtectMainMessage> {
  if (!isObjectLike(input)) return fail('protect-main: not an object');
  const type = readMessageType(input);
  switch (type) {
    case 'protect-main-hello': {
      const keyError = checkKeys(input, MAIN_HELLO_SET, MAIN_HELLO_KEYS, type);
      if (keyError !== null) return fail(keyError);
      const header = readChannelHeader(input, type);
      if (!header.ok) return header;
      const protocolVersion = readInt(input['protocolVersion'], 0, MAX_COUNT);
      if (protocolVersion === null) return fail(type + '.protocolVersion');
      const startedLate = readBool(input['startedLate']);
      if (startedLate === null) return fail(type + '.startedLate');
      const groups = readInt(input['groups'], 0, MAX_GROUP_MASK);
      if (groups === null) return fail(type + '.groups');
      return ok({ channel: PROTECT_CHANNEL, sensorBootId: header.value, type, protocolVersion, startedLate, groups });
    }
    case 'protect-main-batch': {
      const keyError = checkKeys(input, MAIN_BATCH_SET, MAIN_BATCH_KEYS, type);
      if (keyError !== null) return fail(keyError);
      const header = readChannelHeader(input, type);
      if (!header.ok) return header;
      const sensorSeq = readInt(input['sensorSeq'], 1, MAX_COUNT);
      if (sensorSeq === null) return fail(type + '.sensorSeq');
      const samples = readSamples(input['sends'], input['registrations'], 'tMs', type);
      if (!samples.ok) return samples;
      const dropped = readMainDropped(input['dropped'], type + '.dropped');
      if (!dropped.ok) return dropped;
      const limitations = readLimitations(input['limitations'], PROTECT_WIRE_LIMITS.maxEventLimitations);
      if (limitations === null) return fail(type + '.limitations');
      if (isEmptyBatch(samples.value, dropped.value, limitations)) return fail(type + ': empty');
      const value = {
        channel: PROTECT_CHANNEL,
        sensorBootId: header.value,
        type,
        sensorSeq,
        sends: samples.value.sends as unknown as SendSampleWire[],
        registrations: samples.value.registrations as unknown as RegistrationSampleWire[],
        dropped: dropped.value,
        limitations,
      };
      if (jsonLength(value, BUDGETS.maxBatchBytes) > BUDGETS.maxBatchBytes) return fail(type + ': over the byte budget');
      return ok(value);
    }
    default:
      return fail('protect-main.type');
  }
}

/** Validation of a MAIN -> ISOLATED module window message (page-controlled). Never throws. */
export function validateProtectMainMessage(input: unknown): ValidationResult<ProtectMainMessage> {
  try {
    return protectMainMessage(input);
  } catch {
    return fail('protect-main: exception');
  }
}

/** Runs in MAIN: captured intrinsics only (no arrays, no string methods). */
function protectRelayMessage(input: unknown): ValidationResult<ProtectRelayMessage> {
  if (!isObjectLike(input)) return fail('protect-relay: not an object');
  const type = readMessageType(input);
  switch (type) {
    case 'protect-relay-hello': {
      const keyError = checkKeys(input, RELAY_HELLO_SET, RELAY_HELLO_KEYS, type);
      if (keyError !== null) return fail(keyError);
      const header = readChannelHeader(input, type);
      if (!header.ok) return header;
      const protocolVersion = readInt(input['protocolVersion'], 0, MAX_COUNT);
      if (protocolVersion === null) return fail(type + '.protocolVersion');
      const relaySessionId = readId(input['relaySessionId']);
      if (relaySessionId === null) return fail(type + '.relaySessionId');
      const paused = readBool(input['paused']);
      if (paused === null) return fail(type + '.paused');
      return ok({ channel: PROTECT_CHANNEL, sensorBootId: header.value, type, protocolVersion, relaySessionId, paused });
    }
    case 'protect-relay-pause':
    case 'protect-relay-resume': {
      const keyError = checkKeys(input, RELAY_SIMPLE_SET, RELAY_SIMPLE_KEYS, type);
      if (keyError !== null) return fail(keyError);
      const header = readChannelHeader(input, type);
      if (!header.ok) return header;
      return ok({ channel: PROTECT_CHANNEL, sensorBootId: header.value, type });
    }
    case 'protect-relay-stop': {
      const keyError = checkKeys(input, RELAY_STOP_SET, RELAY_STOP_KEYS, type);
      if (keyError !== null) return fail(keyError);
      const header = readChannelHeader(input, type);
      if (!header.ok) return header;
      const reason = readEnum<BridgeStopReason>(input['reason'], STOP_REASON_SET);
      if (reason === null) return fail(type + '.reason');
      return ok({ channel: PROTECT_CHANNEL, sensorBootId: header.value, type, reason });
    }
    default:
      return fail('protect-relay.type');
  }
}

/** Validation of an ISOLATED -> MAIN module window message (the page can forge it). Never throws. */
export function validateProtectRelayMessage(input: unknown): ValidationResult<ProtectRelayMessage> {
  try {
    return protectRelayMessage(input);
  } catch {
    return fail('protect-relay: exception');
  }
}

// ---------------------------------------------------------------------------
// Request journal shapes (UI request-save and IndexedDB hydration)
// ---------------------------------------------------------------------------

const JURISDICTION_SET = /* @__PURE__ */ makeSet(REQUEST_JURISDICTIONS);
const REQUEST_KIND_SET = /* @__PURE__ */ makeSet(REQUEST_KINDS);
const LETTER_LANG_SET = /* @__PURE__ */ makeSet(REQUEST_LETTER_LANGS);
const SOURCE_KIND_SET = /* @__PURE__ */ makeSet(REQUEST_SOURCE_KINDS);
const IDENTITY_KIND_SET = /* @__PURE__ */ makeSet(REQUEST_IDENTITY_KINDS);
const RECIPIENT_CHANNEL_SET = /* @__PURE__ */ makeSet(RECIPIENT_CHANNELS);
const DELIVERY_SET = /* @__PURE__ */ makeSet(REQUEST_DELIVERIES);
const SUBJECT_ROLE_SET = /* @__PURE__ */ makeSet(REQUEST_SUBJECT_ROLES);
const STATUS_SET = /* @__PURE__ */ makeSet(REQUEST_STATUSES);
const FACT_KIND_SET = /* @__PURE__ */ makeSet(REQUEST_FACT_KINDS);
const ENDPOINT_SCHEME_SET = /* @__PURE__ */ makeSet(REQUEST_ENDPOINT_SCHEMES);
const VALUE_ENCODING_SET = /* @__PURE__ */ makeSet(VALUE_ENCODINGS);
const VALUE_LOCATION_SET = /* @__PURE__ */ makeSet(VALUE_LOCATIONS);
const SUBMIT_TIMING_SET = /* @__PURE__ */ makeSet(SUBMIT_TIMINGS);
const TECHNIQUE_SET = /* @__PURE__ */ makeSet(TECHNIQUE_IDS);
const EVIDENCE_SOURCE_SET = /* @__PURE__ */ makeSet(EVIDENCE_SOURCES);
const INTEGRITY_SET = /* @__PURE__ */ makeSet(INTEGRITIES);
const INTERPRETATION_CONFIDENCE_SET = /* @__PURE__ */ makeSet(INTERPRETATION_CONFIDENCES);

const ENDPOINT_KEYS = ['scheme', 'host', 'pathTemplate'] as const;
const ENDPOINT_SET = /* @__PURE__ */ keySet(ENDPOINT_KEYS);
const FACT_KEYS = [
  'factKind',
  'day',
  'site',
  'receiverDomain',
  'endpoint',
  'script',
  'dataKind',
  'encoding',
  'location',
  'parameterName',
  'submitTiming',
  'techniqueIds',
  'vendorId',
  'evidenceSource',
  'integrity',
  'interpretationConfidence',
] as const;
const FACT_SET = /* @__PURE__ */ keySet(FACT_KEYS);
const SUBJECT_KEYS = ['role', 'vendorId', 'domain', 'entityName'] as const;
const SUBJECT_SET = /* @__PURE__ */ keySet(SUBJECT_KEYS);
const RECIPIENT_TABLE_KEYS = ['source', 'contactId', 'contactsVersion', 'channel', 'address'] as const;
const RECIPIENT_TABLE_SET = /* @__PURE__ */ keySet(RECIPIENT_TABLE_KEYS);
const RECIPIENT_MANUAL_KEYS = ['source', 'channel', 'address'] as const;
const RECIPIENT_MANUAL_SET = /* @__PURE__ */ keySet(RECIPIENT_MANUAL_KEYS);
const RECIPIENT_NONE_KEYS = ['source'] as const;
const RECIPIENT_NONE_SET = /* @__PURE__ */ keySet(RECIPIENT_NONE_KEYS);
/** NewRequestInput: exactly these keys; identity, identifier, name, body, text, value or email are rejected. */
const REQUEST_INPUT_KEYS = [
  'sourceKind',
  'jurisdiction',
  'kinds',
  'letterLang',
  'templateId',
  'templateVersion',
  'subject',
  'recipient',
  'facts',
  'identityKinds',
  'delivery',
  'mentionGpc',
] as const;
const REQUEST_INPUT_SET = /* @__PURE__ */ keySet(REQUEST_INPUT_KEYS);
const RECORD_EXTRA_KEYS = ['requestId', 'createdDay', 'status', 'statusDay', 'sentDay', 'deadlineDay', 'extendedDeadlineDay', 'history'] as const;
const RECORD_KEYS = /* @__PURE__ */ concatKeys(REQUEST_INPUT_KEYS, RECORD_EXTRA_KEYS);
const RECORD_SET = /* @__PURE__ */ keySet(RECORD_KEYS);
const HISTORY_ENTRY_KEYS = ['status', 'day'] as const;
const HISTORY_ENTRY_SET = /* @__PURE__ */ keySet(HISTORY_ENTRY_KEYS);
const PREFS_KEYS = ['jurisdiction', 'letterLang'] as const;
const PREFS_SET = /* @__PURE__ */ keySet(PREFS_KEYS);
const JOURNAL_KEYS = ['v', 'revision', 'prefs', 'requests'] as const;
const JOURNAL_SET = /* @__PURE__ */ keySet(JOURNAL_KEYS);

/** Absent-or-null-or-valid reader result: undefined = invalid. */
function readNullable<T>(v: unknown, read: (x: unknown) => T | null): T | null | undefined {
  if (v === null) return null;
  const r = read(v);
  return r === null ? undefined : r;
}

function readVendorId(v: unknown): string | null {
  return readPattern(v, WIRE_RULE_ID_PATTERN, 64);
}

function readEndpoint(v: unknown, path: string): ValidationResult<RequestEndpoint> {
  if (!isObjectLike(v)) return fail(path + ': not an object');
  const keyError = checkKeys(v, ENDPOINT_SET, ENDPOINT_KEYS, path);
  if (keyError !== null) return fail(keyError);
  const scheme = readEnum<RequestEndpointScheme>(v['scheme'], ENDPOINT_SCHEME_SET);
  if (scheme === null) return fail(path + '.scheme');
  const host = v['host'];
  if (!isDomainName(host)) return fail(path + '.host');
  const pathTemplate = v['pathTemplate'];
  if (!isEndpointPathTemplate(pathTemplate)) return fail(path + '.pathTemplate');
  return ok({ scheme, host, pathTemplate });
}

function readFact(v: unknown, path: string): ValidationResult<RequestEvidenceFact> {
  if (!isObjectLike(v)) return fail(path + ': not an object');
  const keyError = checkKeys(v, FACT_SET, FACT_KEYS, path);
  if (keyError !== null) return fail(keyError);
  const factKind = readEnum<RequestFactKind>(v['factKind'], FACT_KIND_SET);
  if (factKind === null) return fail(path + '.factKind');
  const day = v['day'];
  if (!isLocalDay(day)) return fail(path + '.day');
  const site = v['site'];
  if (!isDomainName(site)) return fail(path + '.site');
  const receiverDomain = readNullable(v['receiverDomain'], (x) => (isDomainName(x) ? x : null));
  if (receiverDomain === undefined) return fail(path + '.receiverDomain');
  let endpoint: RequestEndpoint | null = null;
  if (v['endpoint'] !== null) {
    const r = readEndpoint(v['endpoint'], path + '.endpoint');
    if (!r.ok) return r;
    endpoint = r.value;
  }
  let script: ScriptRef | null = null;
  if (v['script'] !== null) {
    const r = readScriptRef(v['script'], path + '.script');
    if (!r.ok) return r;
    script = r.value;
  }
  const dataKind = readNullable(v['dataKind'], (x) => readEnum<FieldKind>(x, FIELD_KIND_SET));
  if (dataKind === undefined) return fail(path + '.dataKind');
  const encoding = readNullable(v['encoding'], (x) => readEnum<ValueEncoding>(x, VALUE_ENCODING_SET));
  if (encoding === undefined) return fail(path + '.encoding');
  const location = readNullable(v['location'], (x) => readEnum<ValueLocation>(x, VALUE_LOCATION_SET));
  if (location === undefined) return fail(path + '.location');
  const parameterName = readNullable(v['parameterName'], (x) => readPattern(x, PARAM_NAME_PATTERN, PROTECT_BUDGETS.maxParamNameChars));
  if (parameterName === undefined) return fail(path + '.parameterName');
  const submitTiming = readNullable(v['submitTiming'], (x) => readEnum<SubmitTiming>(x, SUBMIT_TIMING_SET));
  if (submitTiming === undefined) return fail(path + '.submitTiming');
  const techniqueIds = readEnumArray<TechniqueId>(v['techniqueIds'], TECHNIQUE_SET, 0, PROTECT_WIRE_LIMITS.maxTechniquesPerFact);
  if (techniqueIds === null) return fail(path + '.techniqueIds');
  const vendorId = readNullable(v['vendorId'], readVendorId);
  if (vendorId === undefined) return fail(path + '.vendorId');
  const evidenceSource = readEnum<EvidenceSource>(v['evidenceSource'], EVIDENCE_SOURCE_SET);
  if (evidenceSource === null) return fail(path + '.evidenceSource');
  const integrity = readEnum<Integrity>(v['integrity'], INTEGRITY_SET);
  if (integrity === null) return fail(path + '.integrity');
  const interpretationConfidence = readEnum<InterpretationConfidence>(v['interpretationConfidence'], INTERPRETATION_CONFIDENCE_SET);
  if (interpretationConfidence === null) return fail(path + '.interpretationConfidence');
  // Kind invariants: a value match names the data kind and its encoding; a listener fact has no data, place or encoding.
  if (factKind === 'value-match' && (dataKind === null || encoding === null)) return fail(path + ': value-match needs dataKind and encoding');
  if (factKind === 'opaque-after-input' && encoding !== null) return fail(path + ': opaque-after-input has no encoding');
  if (factKind === 'password-field-listener' && (dataKind !== null || encoding !== null || location !== null || parameterName !== null)) {
    return fail(path + ': password-field-listener carries no data fields');
  }
  return ok({
    factKind,
    day,
    site,
    receiverDomain,
    endpoint,
    script,
    dataKind,
    encoding,
    location,
    parameterName,
    submitTiming,
    techniqueIds,
    vendorId,
    evidenceSource,
    integrity,
    interpretationConfidence,
  });
}

function readSubject(v: unknown, path: string): ValidationResult<RequestSubject> {
  if (!isObjectLike(v)) return fail(path + ': not an object');
  const keyError = checkKeys(v, SUBJECT_SET, SUBJECT_KEYS, path);
  if (keyError !== null) return fail(keyError);
  const role = readEnum<RequestSubjectRole>(v['role'], SUBJECT_ROLE_SET);
  if (role === null) return fail(path + '.role');
  const vendorId = readNullable(v['vendorId'], readVendorId);
  if (vendorId === undefined) return fail(path + '.vendorId');
  const domain = readNullable(v['domain'], (x) => (isDomainName(x) ? x : null));
  if (domain === undefined) return fail(path + '.domain');
  const entityName = v['entityName'];
  if (!isEntityName(entityName)) return fail(path + '.entityName');
  return ok({ role, vendorId, domain, entityName });
}

function readRecipient(v: unknown, path: string): ValidationResult<RecipientRef> {
  if (!isObjectLike(v)) return fail(path + ': not an object');
  switch (v['source']) {
    case 'table': {
      const keyError = checkKeys(v, RECIPIENT_TABLE_SET, RECIPIENT_TABLE_KEYS, path);
      if (keyError !== null) return fail(keyError);
      const contactId = readPattern(v['contactId'], CONTACT_ID_PATTERN, 63);
      if (contactId === null) return fail(path + '.contactId');
      const contactsVersion = readPattern(v['contactsVersion'], WIRE_CATALOG_VERSION_PATTERN, 64);
      if (contactsVersion === null) return fail(path + '.contactsVersion');
      const channel = readEnum<RecipientChannel>(v['channel'], RECIPIENT_CHANNEL_SET);
      if (channel === null) return fail(path + '.channel');
      const address = v['address'];
      if (channel === 'email' ? !isRequestEmail(address) : !isPortalUrl(address)) return fail(path + '.address');
      return ok({ source: 'table', contactId, contactsVersion, channel, address: address as string });
    }
    case 'manual': {
      const keyError = checkKeys(v, RECIPIENT_MANUAL_SET, RECIPIENT_MANUAL_KEYS, path);
      if (keyError !== null) return fail(keyError);
      if (v['channel'] !== 'email') return fail(path + '.channel');
      const address = v['address'];
      if (!isRequestEmail(address)) return fail(path + '.address');
      return ok({ source: 'manual', channel: 'email', address });
    }
    case 'none': {
      const keyError = checkKeys(v, RECIPIENT_NONE_SET, RECIPIENT_NONE_KEYS, path);
      return keyError !== null ? fail(keyError) : ok({ source: 'none' });
    }
    default:
      return fail(path + '.source');
  }
}

/** Reads the NewRequestInput fields of `v` (keys are checked by the caller). */
function readRequestFields(v: Record<string, unknown>, path: string): ValidationResult<NewRequestInput> {
  const sourceKind = readEnum<RequestSourceKind>(v['sourceKind'], SOURCE_KIND_SET);
  if (sourceKind === null) return fail(path + '.sourceKind');
  const jurisdiction = readEnum<RequestJurisdiction>(v['jurisdiction'], JURISDICTION_SET);
  if (jurisdiction === null) return fail(path + '.jurisdiction');
  const kinds = readEnumArray<RequestKind>(v['kinds'], REQUEST_KIND_SET, 1, PROTECT_WIRE_LIMITS.maxKindsPerRequest);
  if (kinds === null) return fail(path + '.kinds');
  const allowedKinds = JURISDICTION_REQUEST_KINDS[jurisdiction];
  for (let i = 0; i < kinds.length; i++) if (!allowedKinds.includes(kinds[i]!)) return fail(path + '.kinds[' + String(i) + ']: not for this law');
  const letterLang = readEnum<RequestLetterLang>(v['letterLang'], LETTER_LANG_SET);
  if (letterLang === null || !JURISDICTION_LETTER_LANGS[jurisdiction].includes(letterLang)) return fail(path + '.letterLang');
  const templateId = readPattern(v['templateId'], TEMPLATE_ID_PATTERN, 64);
  if (templateId === null) return fail(path + '.templateId');
  const templateVersion = readPattern(v['templateVersion'], TEMPLATE_VERSION_PATTERN, 32);
  if (templateVersion === null) return fail(path + '.templateVersion');
  const subject = readSubject(v['subject'], path + '.subject');
  if (!subject.ok) return subject;
  const recipient = readRecipient(v['recipient'], path + '.recipient');
  if (!recipient.ok) return recipient;
  const factItems = readArray(v['facts'], 0, PROTECT_BUDGETS.maxFactsPerRequest);
  if (factItems === null) return fail(path + '.facts');
  if (sourceKind === 'manual' && factItems.length > 0) return fail(path + '.facts: a manual request has no observations');
  const facts: RequestEvidenceFact[] = [];
  for (let i = 0; i < factItems.length; i++) {
    const r = readFact(factItems[i], path + '.facts[' + String(i) + ']');
    if (!r.ok) return r;
    facts.push(r.value);
  }
  const identityKinds = readEnumArray<RequestIdentityKind>(v['identityKinds'], IDENTITY_KIND_SET, 1, 2);
  if (identityKinds === null) return fail(path + '.identityKinds');
  const primary = identityKinds.filter((k) => k !== 'typed-name').length;
  if (primary !== 1) return fail(path + '.identityKinds: exactly one of sender-address, typed-identifier');
  const delivery = readEnum<RequestDelivery>(v['delivery'], DELIVERY_SET);
  if (delivery === null) return fail(path + '.delivery');
  const to = recipient.value;
  if (delivery === 'mailto' && (to.source === 'none' || to.channel !== 'email')) return fail(path + '.delivery: mailto needs an e-mail recipient');
  if (delivery === 'portal' && (to.source !== 'table' || to.channel !== 'portal')) return fail(path + '.delivery: portal needs a table form address');
  const mentionGpc = readBool(v['mentionGpc']);
  if (mentionGpc === null) return fail(path + '.mentionGpc');
  return ok({
    sourceKind,
    jurisdiction,
    kinds,
    letterLang,
    templateId,
    templateVersion,
    subject: subject.value,
    recipient: to,
    facts,
    identityKinds,
    delivery,
    mentionGpc,
  });
}

function readNewRequestInput(v: unknown, path: string): ValidationResult<NewRequestInput> {
  if (!isObjectLike(v)) return fail(path + ': not an object');
  const keyError = checkKeys(v, REQUEST_INPUT_SET, REQUEST_INPUT_KEYS, path);
  if (keyError !== null) return fail(keyError);
  const r = readRequestFields(v, path);
  if (!r.ok) return r;
  const limit = PROTECT_BUDGETS.maxRecordChars - REQUEST_RECORD_EXTRA_CHARS;
  if (jsonLength(r.value, limit) > limit) return fail(path + ': over the record budget');
  return r;
}

function readDay(v: unknown): string | null {
  return isLocalDay(v) ? v : null;
}

function readRequestRecord(v: unknown, path: string): ValidationResult<DeletionRequestRecord> {
  if (!isObjectLike(v)) return fail(path + ': not an object');
  const keyError = checkKeys(v, RECORD_SET, RECORD_KEYS, path);
  if (keyError !== null) return fail(keyError);
  const input = readRequestFields(v, path);
  if (!input.ok) return input;
  const requestId = readPattern(v['requestId'], REQUEST_ID_PATTERN, 23);
  if (requestId === null) return fail(path + '.requestId');
  const createdDay = readDay(v['createdDay']);
  if (createdDay === null) return fail(path + '.createdDay');
  const status = readEnum<RequestStatus>(v['status'], STATUS_SET);
  if (status === null) return fail(path + '.status');
  const statusDay = readDay(v['statusDay']);
  if (statusDay === null || statusDay < createdDay) return fail(path + '.statusDay');
  const sentDay = readNullable(v['sentDay'], readDay);
  if (sentDay === undefined || (status === 'prepared' && sentDay !== null)) return fail(path + '.sentDay');
  const deadlineDay = readNullable(v['deadlineDay'], readDay);
  if (deadlineDay === undefined) return fail(path + '.deadlineDay');
  const extendedDeadlineDay = readNullable(v['extendedDeadlineDay'], readDay);
  if (extendedDeadlineDay === undefined) return fail(path + '.extendedDeadlineDay');
  const historyItems = readArray(v['history'], 0, PROTECT_BUDGETS.maxHistoryPerRequest);
  if (historyItems === null) return fail(path + '.history');
  const history: RequestHistoryEntry[] = [];
  for (let i = 0; i < historyItems.length; i++) {
    const item = historyItems[i];
    const itemPath = path + '.history[' + String(i) + ']';
    if (!isObjectLike(item)) return fail(itemPath + ': not an object');
    const itemKeyError = checkKeys(item, HISTORY_ENTRY_SET, HISTORY_ENTRY_KEYS, itemPath);
    if (itemKeyError !== null) return fail(itemKeyError);
    const entryStatus = readEnum<RequestStatus>(item['status'], STATUS_SET);
    if (entryStatus === null) return fail(itemPath + '.status');
    const day = readDay(item['day']);
    if (day === null) return fail(itemPath + '.day');
    history.push({ status: entryStatus, day });
  }
  const record: DeletionRequestRecord = {
    ...input.value,
    requestId,
    createdDay,
    status,
    statusDay,
    sentDay,
    deadlineDay,
    extendedDeadlineDay,
    history,
  };
  if (jsonLength(record, PROTECT_BUDGETS.maxRecordChars) > PROTECT_BUDGETS.maxRecordChars) return fail(path + ': over the record budget');
  return ok(record);
}

function readPrefs(v: unknown, path: string): ValidationResult<RequestPrefs> {
  if (!isObjectLike(v)) return fail(path + ': not an object');
  const keyError = checkKeys(v, PREFS_SET, PREFS_KEYS, path);
  if (keyError !== null) return fail(keyError);
  const jurisdiction = readNullable(v['jurisdiction'], (x) => readEnum<RequestJurisdiction>(x, JURISDICTION_SET));
  if (jurisdiction === undefined) return fail(path + '.jurisdiction');
  const letterLang = readNullable(v['letterLang'], (x) => readEnum<RequestLetterLang>(x, LETTER_LANG_SET));
  if (letterLang === undefined) return fail(path + '.letterLang');
  return ok({ jurisdiction, letterLang });
}

export interface HydratedRequestJournal {
  journal: StoredRequestJournal;
  /** Invalid, duplicate or over-budget records dropped one by one (saturating). */
  droppedRecords: number;
}

function storedRequestJournal(input: unknown): ValidationResult<HydratedRequestJournal> {
  if (!isObjectLike(input)) return fail('journal: not an object');
  const keyError = checkKeys(input, JOURNAL_SET, JOURNAL_KEYS, 'journal');
  if (keyError !== null) return fail(keyError);
  if (input['v'] !== 1) return fail('journal.v');
  const revision = readInt(input['revision'], 0, MAX_COUNT);
  if (revision === null) return fail('journal.revision');
  const prefs = readPrefs(input['prefs'], 'journal.prefs');
  if (!prefs.ok) return prefs;
  const items = input['requests'];
  if (!capturedIsArray(items)) return fail('journal.requests');
  const requests: DeletionRequestRecord[] = [];
  const ids = new Set<string>();
  let dropped = 0;
  let chars = 0;
  for (let i = 0; i < items.length; i++) {
    if (requests.length === PROTECT_BUDGETS.maxRequests) {
      dropped += items.length - i;
      break;
    }
    const r = readRequestRecord(items[i], 'journal.requests[' + String(i) + ']');
    if (!r.ok || ids.has(r.value.requestId)) {
      dropped++;
      continue;
    }
    const size = jsonLength(r.value, PROTECT_BUDGETS.maxRecordChars) + 1;
    if (chars + size > PROTECT_BUDGETS.maxJournalChars) {
      dropped++;
      continue;
    }
    chars += size;
    ids.add(r.value.requestId);
    requests.push(r.value);
  }
  return ok({
    journal: { v: 1, revision, prefs: prefs.value, requests },
    droppedRecords: dropped > MAX_COUNT ? MAX_COUNT : dropped,
  });
}

/**
 * Hydration of the request journal (IndexedDB is outside the trust boundary of a single record): invalid records are
 * dropped one by one and counted; only a broken envelope fails. Never throws.
 */
export function validateStoredRequestJournal(input: unknown): ValidationResult<HydratedRequestJournal> {
  try {
    return storedRequestJournal(input);
  } catch {
    return fail('journal: exception');
  }
}

// ---------------------------------------------------------------------------
// UI -> SW module requests (privileged channel; the SW checks the sender and isOptionsSender separately)
// ---------------------------------------------------------------------------

const FEATURE_SET = /* @__PURE__ */ makeSet(PROTECT_FEATURES);
const PRESET_SET = /* @__PURE__ */ makeSet(PROTECT_PRESETS);
const PURGE_SET = /* @__PURE__ */ makeSet(PROTECT_PURGE_TARGETS);
const SNOOZE_SET = /* @__PURE__ */ makeSet(PROTECT_SNOOZE_MINUTES);
const RETENTION_SET = /* @__PURE__ */ makeSet(HISTORY_RETENTION_DAYS);
const WINDOW_SET = /* @__PURE__ */ makeSet(HISTORY_WINDOW_DAYS);
const ACTION_SET = /* @__PURE__ */ makeSet(FIREWALL_ACTIONS);
const SCOPE_SET = /* @__PURE__ */ makeSet(DECISION_SCOPES);
const DELETE_TARGET_SET = /* @__PURE__ */ makeSet(HISTORY_DELETE_TARGETS);
const VIEW_SET = /* @__PURE__ */ makeSet(REQUEST_VIEWS);

/** Per type: required keys besides schemaVersion/type, and optional keys. */
const UI_KEYS = {
  'ui-protect-get-state': [[], []],
  'ui-protect-enable': [['consentVersion', 'features', 'preset'], []],
  'ui-protect-disable': [['purge'], []],
  'ui-protect-set-settings': [[], ['features', 'preset', 'historyRetentionDays']],
  'ui-protect-snooze': [['minutes'], []],
  'ui-protect-set-site': [['host', 'excluded'], []],
  'ui-protect-purge': [['what'], []],
  'ui-protect-get-report': [['tabId'], ['frameId']],
  'ui-protect-decide': [['tabId', 'documentKey', 'protectRevision', 'promptId', 'receivers', 'action', 'scope'], []],
  'ui-protect-undo': [['tabId', 'undoId'], []],
  'ui-protect-dismiss': [['tabId', 'documentKey', 'protectRevision', 'promptId'], []],
  'ui-protect-list-rules': [['offset', 'limit'], ['domainFilter', 'action']],
  'ui-protect-remove-rules': [['ruleKeys'], []],
  'ui-protect-history-query': [['windowDays', 'offset', 'limit'], ['minSites', 'mechanismsOnly', 'site', 'domainFilter']],
  'ui-protect-history-receiver': [['rowKey', 'windowDays'], []],
  'ui-protect-history-delete': [['target', 'key'], []],
  'ui-protect-history-export': [['includeSites'], []],
  'ui-protect-requests-get': [['view'], []],
  'ui-protect-request-draft': [['sourceKind'], ['recordId']],
  'ui-protect-request-save': [['expectedRevision', 'request'], []],
  'ui-protect-request-status': [['expectedRevision', 'requestId', 'status', 'day'], []],
  'ui-protect-request-delete': [['expectedRevision', 'requestId'], []],
} as const satisfies Record<ProtectUiRequest['type'], readonly [readonly string[], readonly string[]]>;
type UiProtectType = keyof typeof UI_KEYS;

type UiKeySpec = readonly [ReadonlySet<string | number>, readonly string[]];

function buildUiKeySets(): ReadonlyMap<string, UiKeySpec> {
  const map = new Map<string, UiKeySpec>();
  const types = capturedKeys(UI_KEYS) as UiProtectType[];
  for (let i = 0; i < types.length; i++) {
    const type = types[i]!;
    const [extra, optional] = UI_KEYS[type];
    const required = concatKeys(['schemaVersion', 'type'], extra);
    map.set(type, [keySet(required, optional), required]);
  }
  return map;
}

const UI_KEY_SETS = /* @__PURE__ */ buildUiKeySets();

function readTabId(v: unknown): number | null {
  return readInt(v, 0, MAX_COUNT);
}

function readFeatures(v: unknown): ProtectFeature[] | null {
  return readEnumArray<ProtectFeature>(v, FEATURE_SET, 1, PROTECT_WIRE_LIMITS.maxFeatures);
}

function readDomainFilter(v: unknown): string | null {
  return readPattern(v, DOMAIN_FILTER_RE, PROTECT_WIRE_LIMITS.maxDomainFilterChars);
}

function protectUiRequest(input: unknown): ValidationResult<ProtectUiRequest> {
  if (!isObjectLike(input)) return fail('ui-protect: not an object');
  if (input['schemaVersion'] !== 1) return fail('ui-protect.schemaVersion');
  const type = readMessageType(input);
  const spec = type === null ? undefined : UI_KEY_SETS.get(type);
  if (type === null || spec === undefined) return fail('ui-protect.type');
  const keyError = checkKeys(input, spec[0], spec[1], type);
  if (keyError !== null) return fail(keyError);
  const t = type as UiProtectType;
  switch (t) {
    case 'ui-protect-get-state':
      return ok({ schemaVersion: 1, type: t });
    case 'ui-protect-enable': {
      const consentVersion = readInt(input['consentVersion'], 0, MAX_COUNT);
      if (consentVersion === null) return fail(t + '.consentVersion');
      const features = readFeatures(input['features']);
      if (features === null) return fail(t + '.features');
      const preset = readEnum<ProtectPreset>(input['preset'], PRESET_SET);
      if (preset === null) return fail(t + '.preset');
      return ok({ schemaVersion: 1, type: t, consentVersion, features, preset });
    }
    case 'ui-protect-disable': {
      const purge = readBool(input['purge']);
      return purge === null ? fail(t + '.purge') : ok({ schemaVersion: 1, type: t, purge });
    }
    case 'ui-protect-set-settings': {
      const out: { schemaVersion: 1; type: typeof t; features?: ProtectFeature[]; preset?: ProtectPreset; historyRetentionDays?: HistoryRetentionDays } = {
        schemaVersion: 1,
        type: t,
      };
      if (hasOwn(input, 'features')) {
        const features = readFeatures(input['features']);
        if (features === null) return fail(t + '.features');
        out.features = features;
      }
      if (hasOwn(input, 'preset')) {
        const preset = readEnum<ProtectPreset>(input['preset'], PRESET_SET);
        if (preset === null) return fail(t + '.preset');
        out.preset = preset;
      }
      if (hasOwn(input, 'historyRetentionDays')) {
        const days = readIntEnum<HistoryRetentionDays>(input['historyRetentionDays'], RETENTION_SET);
        if (days === null) return fail(t + '.historyRetentionDays');
        out.historyRetentionDays = days;
      }
      if (out.features === undefined && out.preset === undefined && out.historyRetentionDays === undefined) return fail(t + ': no setting');
      return ok(out);
    }
    case 'ui-protect-snooze': {
      const minutes = readIntEnum<ProtectSnoozeMinutes>(input['minutes'], SNOOZE_SET);
      return minutes === null ? fail(t + '.minutes') : ok({ schemaVersion: 1, type: t, minutes });
    }
    case 'ui-protect-set-site': {
      const host = input['host'];
      if (!isSanitizedHost(host)) return fail(t + '.host');
      const excluded = readBool(input['excluded']);
      if (excluded === null) return fail(t + '.excluded');
      return ok({ schemaVersion: 1, type: t, host, excluded });
    }
    case 'ui-protect-purge': {
      const what = readEnum<ProtectPurgeTarget>(input['what'], PURGE_SET);
      return what === null ? fail(t + '.what') : ok({ schemaVersion: 1, type: t, what });
    }
    case 'ui-protect-get-report': {
      const tabId = readTabId(input['tabId']);
      if (tabId === null) return fail(t + '.tabId');
      if (!hasOwn(input, 'frameId')) return ok({ schemaVersion: 1, type: t, tabId });
      const frameId = readInt(input['frameId'], 0, MAX_COUNT);
      return frameId === null ? fail(t + '.frameId') : ok({ schemaVersion: 1, type: t, tabId, frameId });
    }
    case 'ui-protect-decide':
    case 'ui-protect-dismiss': {
      const tabId = readTabId(input['tabId']);
      if (tabId === null) return fail(t + '.tabId');
      const documentKey = readDocumentKey(input['documentKey']);
      if (documentKey === null) return fail(t + '.documentKey');
      const protectRevision = readInt(input['protectRevision'], 0, MAX_COUNT);
      if (protectRevision === null) return fail(t + '.protectRevision');
      const promptId = readPattern(input['promptId'], PROMPT_ID_PATTERN, 16);
      if (promptId === null) return fail(t + '.promptId');
      if (t === 'ui-protect-dismiss') return ok({ schemaVersion: 1, type: t, tabId, documentKey, protectRevision, promptId });
      const receivers = readUniqueStrings(input['receivers'], 1, PROTECT_BUDGETS.maxPromptReceivers, isDomainName);
      if (receivers === null) return fail(t + '.receivers');
      const action = readEnum<FirewallAction>(input['action'], ACTION_SET);
      if (action === null) return fail(t + '.action');
      const scope = readEnum<DecisionScope>(input['scope'], SCOPE_SET);
      if (scope === null) return fail(t + '.scope');
      return ok({ schemaVersion: 1, type: t, tabId, documentKey, protectRevision, promptId, receivers, action, scope });
    }
    case 'ui-protect-undo': {
      const tabId = readTabId(input['tabId']);
      if (tabId === null) return fail(t + '.tabId');
      const undoId = readPattern(input['undoId'], UNDO_ID_PATTERN, 16);
      return undoId === null ? fail(t + '.undoId') : ok({ schemaVersion: 1, type: t, tabId, undoId });
    }
    case 'ui-protect-list-rules': {
      const offset = readInt(input['offset'], 0, PROTECT_WIRE_LIMITS.maxRulesOffset);
      if (offset === null) return fail(t + '.offset');
      const limit = readInt(input['limit'], 1, PROTECT_WIRE_LIMITS.maxRulesPageSize);
      if (limit === null) return fail(t + '.limit');
      const out: { schemaVersion: 1; type: typeof t; offset: number; limit: number; domainFilter?: string; action?: FirewallAction } = {
        schemaVersion: 1,
        type: t,
        offset,
        limit,
      };
      if (hasOwn(input, 'domainFilter')) {
        const domainFilter = readDomainFilter(input['domainFilter']);
        if (domainFilter === null) return fail(t + '.domainFilter');
        out.domainFilter = domainFilter;
      }
      if (hasOwn(input, 'action')) {
        const action = readEnum<FirewallAction>(input['action'], ACTION_SET);
        if (action === null) return fail(t + '.action');
        out.action = action;
      }
      return ok(out);
    }
    case 'ui-protect-remove-rules': {
      const ruleKeys = readUniqueStrings(input['ruleKeys'], 1, PROTECT_WIRE_LIMITS.maxRemoveRuleKeys, (s) =>
        typeof s === 'string' && s.length <= 512 && matches(FIREWALL_RULE_KEY_PATTERN, s),
      );
      return ruleKeys === null ? fail(t + '.ruleKeys') : ok({ schemaVersion: 1, type: t, ruleKeys });
    }
    case 'ui-protect-history-query': {
      const windowDays = readIntEnum<HistoryWindowDays>(input['windowDays'], WINDOW_SET);
      if (windowDays === null) return fail(t + '.windowDays');
      const offset = readInt(input['offset'], 0, PROTECT_WIRE_LIMITS.maxHistoryOffset);
      if (offset === null) return fail(t + '.offset');
      const limit = readInt(input['limit'], 1, PROTECT_BUDGETS.maxRowsPerPage);
      if (limit === null) return fail(t + '.limit');
      const out: {
        schemaVersion: 1;
        type: typeof t;
        windowDays: HistoryWindowDays;
        offset: number;
        limit: number;
        minSites?: 1 | 2;
        mechanismsOnly?: boolean;
        site?: string;
        domainFilter?: string;
      } = { schemaVersion: 1, type: t, windowDays, offset, limit };
      if (hasOwn(input, 'minSites')) {
        const minSites = input['minSites'];
        if (minSites !== 1 && minSites !== 2) return fail(t + '.minSites');
        out.minSites = minSites;
      }
      if (hasOwn(input, 'mechanismsOnly')) {
        const mechanismsOnly = readBool(input['mechanismsOnly']);
        if (mechanismsOnly === null) return fail(t + '.mechanismsOnly');
        out.mechanismsOnly = mechanismsOnly;
      }
      if (hasOwn(input, 'site')) {
        const site = input['site'];
        if (!isSiteName(site)) return fail(t + '.site');
        out.site = site;
      }
      if (hasOwn(input, 'domainFilter')) {
        const domainFilter = readDomainFilter(input['domainFilter']);
        if (domainFilter === null) return fail(t + '.domainFilter');
        out.domainFilter = domainFilter;
      }
      return ok(out);
    }
    case 'ui-protect-history-receiver': {
      const rowKey = readPattern(input['rowKey'], HISTORY_ROW_KEY_PATTERN, 255);
      if (rowKey === null) return fail(t + '.rowKey');
      const windowDays = readIntEnum<HistoryWindowDays>(input['windowDays'], WINDOW_SET);
      return windowDays === null ? fail(t + '.windowDays') : ok({ schemaVersion: 1, type: t, rowKey, windowDays });
    }
    case 'ui-protect-history-delete': {
      const target = readEnum<HistoryDeleteTarget>(input['target'], DELETE_TARGET_SET);
      if (target === null) return fail(t + '.target');
      const key = input['key'];
      const valid = target === 'row' ? readPattern(key, HISTORY_ROW_KEY_PATTERN, 255) !== null : isSiteName(key);
      return valid ? ok({ schemaVersion: 1, type: t, target, key: key as string }) : fail(t + '.key');
    }
    case 'ui-protect-history-export': {
      const includeSites = readBool(input['includeSites']);
      return includeSites === null ? fail(t + '.includeSites') : ok({ schemaVersion: 1, type: t, includeSites });
    }
    case 'ui-protect-requests-get': {
      const view = readEnum<RequestView>(input['view'], VIEW_SET);
      return view === null ? fail(t + '.view') : ok({ schemaVersion: 1, type: t, view });
    }
    case 'ui-protect-request-draft': {
      const sourceKind = readEnum<RequestSourceKind>(input['sourceKind'], SOURCE_KIND_SET);
      if (sourceKind === null) return fail(t + '.sourceKind');
      const hasRecord = hasOwn(input, 'recordId');
      if (sourceKind === 'manual') return hasRecord ? fail(t + '.recordId: not for manual') : ok({ schemaVersion: 1, type: t, sourceKind });
      if (!hasRecord) return fail(t + '.recordId: required');
      const recordId =
        sourceKind === 'evidence'
          ? readPattern(input['recordId'], EVIDENCE_ID_PATTERN, 15)
          : readPattern(input['recordId'], HISTORY_ROW_KEY_PATTERN, 255);
      return recordId === null ? fail(t + '.recordId') : ok({ schemaVersion: 1, type: t, sourceKind, recordId });
    }
    case 'ui-protect-request-save': {
      const expectedRevision = readInt(input['expectedRevision'], 0, MAX_COUNT);
      if (expectedRevision === null) return fail(t + '.expectedRevision');
      const request = readNewRequestInput(input['request'], t + '.request');
      return request.ok ? ok({ schemaVersion: 1, type: t, expectedRevision, request: request.value }) : request;
    }
    case 'ui-protect-request-status': {
      const expectedRevision = readInt(input['expectedRevision'], 0, MAX_COUNT);
      if (expectedRevision === null) return fail(t + '.expectedRevision');
      const requestId = readPattern(input['requestId'], REQUEST_ID_PATTERN, 23);
      if (requestId === null) return fail(t + '.requestId');
      const status = readEnum<RequestStatus>(input['status'], STATUS_SET);
      if (status === null || status === 'prepared') return fail(t + '.status');
      const day = readDay(input['day']);
      if (day === null) return fail(t + '.day');
      const value: UiProtectRequestStatusRequest = { schemaVersion: 1, type: t, expectedRevision, requestId, status, day };
      return ok(value);
    }
    case 'ui-protect-request-delete': {
      const expectedRevision = readInt(input['expectedRevision'], 0, MAX_COUNT);
      if (expectedRevision === null) return fail(t + '.expectedRevision');
      const requestId = readPattern(input['requestId'], REQUEST_ID_PATTERN, 23);
      return requestId === null ? fail(t + '.requestId') : ok({ schemaVersion: 1, type: t, expectedRevision, requestId });
    }
  }
}

/** Validation of a UI -> SW `ui-protect-*` request. Never throws; returns a fresh normalized copy. */
export function validateProtectUiRequest(input: unknown): ValidationResult<ProtectUiRequest> {
  try {
    return protectUiRequest(input);
  } catch {
    return fail('ui-protect: exception');
  }
}
