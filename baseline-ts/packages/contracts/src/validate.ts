// Hand-written strict validators for untrusted input (REQ-004, REQ-011, spec A6).
// Rules: cheap shape checks first; unknown keys rejected; enums checked via sets; strings bounded;
// arrays bounded; integers finite and non-negative; counts saturate at MAX_COUNT; never throws;
// reasons never echo page-controlled values (only fixed key names and indices).
// No schema compiler at runtime (MV3 CSP forbids dynamic code); ../schemas/*.json are cross-checked
// against this file in unit tests.

import { BUDGETS, MAX_COUNT } from './budgets';
import {
  BRIDGE_CONTROL_COMMANDS,
  BRIDGE_STOP_REASONS,
  CHANNEL,
  COUNT_QUALITIES,
  COVERAGE_FLAGS,
  PHASES,
  SCOPE_MODES,
  SENSOR_STATES,
  SIGNAL_CODES,
  TECHNIQUE_IDS,
} from './enums';
import type {
  BridgeControlCommand,
  BridgeStopReason,
  CountQuality,
  CoverageFlag,
  Phase,
  ScopeMode,
  SensorState,
  SignalCode,
  TechniqueId,
} from './enums';
import { isSanitizedHost } from './host';
import { apiOperationAllows, isApiOperation } from './api-operations';
import { extensionResourceAllows, readExtensionResource } from './extension-resources';
import type { BridgeControlMessage, BridgeMessage, BridgeResetAck, PageBatch, PageObservation, SensorMessage, UiRequest } from './messages';

export interface ValidationFailure {
  ok: false;
  reason: string;
}
export type ValidationResult<T> = { ok: true; value: T } | ValidationFailure;

// MAIN control parsing uses captured intrinsics, including after Array/Set poisoning (F168).
const capturedApply = Reflect.apply;
const capturedKeys = Object.keys;
const capturedOwnKeys = Reflect.ownKeys;
const capturedDescriptor = Object.getOwnPropertyDescriptor;
const capturedCreate = Object.create;
const capturedIsArray = Array.isArray;
const capturedHasOwn = Object.prototype.hasOwnProperty;
const capturedSetHas = Set.prototype.has;
const capturedSetSize = Object.getOwnPropertyDescriptor(Set.prototype, 'size')!.get!;
const capturedInteger = Number.isInteger;
const capturedRegexExec = RegExp.prototype.exec;
function setContains(set: ReadonlySet<string>, value: string): boolean {
  return capturedApply(capturedSetHas, set, [value]) as boolean;
}

const TECHNIQUE_SET: ReadonlySet<string> = new Set<string>(TECHNIQUE_IDS);
const SIGNAL_SET: ReadonlySet<string> = new Set<string>(SIGNAL_CODES);
const COVERAGE_SET: ReadonlySet<string> = new Set<string>(COVERAGE_FLAGS);
const COUNT_QUALITY_SET: ReadonlySet<string> = new Set<string>(COUNT_QUALITIES);
const PHASE_SET: ReadonlySet<string> = new Set<string>(PHASES);
const SCOPE_SET: ReadonlySet<string> = new Set<string>(SCOPE_MODES);
const SENSOR_STATE_SET: ReadonlySet<string> = new Set<string>(SENSOR_STATES);
const STOP_REASON_SET: ReadonlySet<string> = new Set<string>(BRIDGE_STOP_REASONS);
const CONTROL_COMMAND_SET: ReadonlySet<string> = new Set<string>(BRIDGE_CONTROL_COMMANDS);

const ID_RE = /^[A-Za-z0-9_-]+$/;
const DOCUMENT_KEY_RE = /^[A-Za-z0-9_:.-]+$/;
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);
/** Longest enum member is well below this; cheap pre-check before a Set lookup. */
const MAX_ENUM_CHARS = 64;
const MAX_TYPE_CHARS = 32;

function fail(reason: string): ValidationFailure {
  return { ok: false, reason };
}

function isObjectLike(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !capturedIsArray(v);
}

function hasOwn(o: object, k: string): boolean {
  return capturedApply(capturedHasOwn, o, [k]) as boolean;
}

/** Null when acceptable. Does not echo unknown (page-controlled) key names. */
function checkKeys(
  obj: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  required: readonly string[],
  path: string,
): string | null {
  const keys = capturedKeys(obj);
  if (keys.length > (capturedApply(capturedSetSize, allowed, []) as number)) return path + ': too many keys';
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!;
    if (setContains(FORBIDDEN_KEYS, k)) return path + ': forbidden key';
    if (!setContains(allowed, k)) return path + ': unknown key';
  }
  for (let i = 0; i < required.length; i++) {
    const r = required[i]!;
    if (!hasOwn(obj, r)) return path + ': missing ' + r;
  }
  return null;
}

function readString(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.length >= 1 && v.length <= max ? v : null;
}

function readId(v: unknown): string | null {
  const s = readString(v, BUDGETS.maxIdChars);
  return s !== null && (capturedApply(capturedRegexExec, ID_RE, [s]) !== null) ? s : null;
}

function readDocumentKey(v: unknown): string | null {
  const s = readString(v, BUDGETS.maxDocumentKeyChars);
  return s !== null && (capturedApply(capturedRegexExec, DOCUMENT_KEY_RE, [s]) !== null) ? s : null;
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

function readEnum<T extends string>(v: unknown, set: ReadonlySet<string>): T | null {
  return typeof v === 'string' && v.length <= MAX_ENUM_CHARS && setContains(set, v) ? (v as T) : null;
}

/** Bounded array of unique enum members. */
function readEnumArray<T extends string>(v: unknown, set: ReadonlySet<string>, max: number): T[] | null {
  if (!capturedIsArray(v) || v.length > max) return null;
  const out: T[] = [];
  const seen = new Set<string>();
  for (const item of v) {
    const e = readEnum<T>(item, set);
    if (e === null || seen.has(e)) return null;
    seen.add(e);
    out.push(e);
  }
  return out;
}

function readCoverageFlags(v: unknown): CoverageFlag[] | null {
  return readEnumArray<CoverageFlag>(v, COVERAGE_SET, COVERAGE_FLAGS.length);
}

// ---------------------------------------------------------------------------
// Observations
// ---------------------------------------------------------------------------

const OBS_KEYS = ['techniqueId', 'count', 'countQuality', 'phase', 'signalCodes', 'intervalBucket'] as const;
const OBS_KEY_SET: ReadonlySet<string> = new Set<string>([...OBS_KEYS, 'apiOperation', 'extensionResource']);

function validateObservation(v: unknown, path: string): ValidationResult<PageObservation> {
  if (!isObjectLike(v)) return fail(path + ': not an object');
  const keyError = checkKeys(v, OBS_KEY_SET, OBS_KEYS, path);
  if (keyError !== null) return fail(keyError);
  const techniqueId = readEnum<TechniqueId>(v['techniqueId'], TECHNIQUE_SET);
  if (techniqueId === null || techniqueId === 'DET-074') return fail(path + '.techniqueId');
  const count = readCount(v['count']);
  if (count === null) return fail(path + '.count');
  const countQuality = readEnum<CountQuality>(v['countQuality'], COUNT_QUALITY_SET);
  if (countQuality === null) return fail(path + '.countQuality');
  const phase = readEnum<Phase>(v['phase'], PHASE_SET);
  if (phase === null) return fail(path + '.phase');
  const signalCodes = readEnumArray<SignalCode>(v['signalCodes'], SIGNAL_SET, BUDGETS.maxSignalCodesPerObservation);
  if (signalCodes === null) return fail(path + '.signalCodes');
  const intervalBucket = readInt(v['intervalBucket'], 0, MAX_COUNT);
  if (intervalBucket === null) return fail(path + '.intervalBucket');
  if (hasOwn(v, 'extensionResource')) {
    const field = Object.getOwnPropertyDescriptor(v, 'extensionResource');
    const resource = field && hasOwn(field, 'value') && field.enumerable ? readExtensionResource(field.value) : null;
    if (!resource || hasOwn(v, 'apiOperation') || !extensionResourceAllows(resource, techniqueId, phase) ||
        signalCodes.length !== 1 || signalCodes[0] !== 'api-use') return fail(path + '.extensionResource');
    return { ok: true, value: { techniqueId, count, countQuality, phase, signalCodes, intervalBucket, extensionResource: resource } };
  }
  if (hasOwn(v, 'apiOperation')) {
    const field = Object.getOwnPropertyDescriptor(v, 'apiOperation');
    if (!field || !hasOwn(field, 'value') || !field.enumerable || !isApiOperation(field.value) ||
        !apiOperationAllows(field.value, techniqueId, phase) || signalCodes.length !== 1 || signalCodes[0] !== 'api-use') return fail(path + '.apiOperation');
    return { ok: true, value: { techniqueId, count, countQuality, phase, signalCodes, intervalBucket, apiOperation: field.value } };
  }
  return { ok: true, value: { techniqueId, count, countQuality, phase, signalCodes, intervalBucket } };
}

function validateObservations(v: unknown, path: string, minItems = 1): ValidationResult<PageObservation[]> {
  if (!capturedIsArray(v)) return fail(path + ': not an array');
  if (v.length < minItems || v.length > BUDGETS.maxBatchEvents) return fail(path + ': length out of range');
  const out: PageObservation[] = [];
  for (let i = 0; i < v.length; i++) {
    const r = validateObservation(v[i], path + '[' + String(i) + ']');
    if (!r.ok) return r;
    out.push(r.value);
  }
  return { ok: true, value: out };
}

// ---------------------------------------------------------------------------
// ISOLATED -> SW: PageBatch
// Serialized size: with the structural bounds above (<= 32 observations, ids <= 64 chars, enum arrays
// bounded) the maximum JSON size is ~12 KiB < BUDGETS.maxBatchBytes, so no serialization is needed here.
// A batch without observations is accepted only as a coverage-only batch (non-empty coverageDelta): the
// bridge reports sensor diagnostics without fabricating an observation (ADR-004 changelog, F033/F034).
// ---------------------------------------------------------------------------

const BATCH_KEYS = [
  'schemaVersion',
  'type',
  'sensorBootId',
  'bridgeSessionId',
  'batchSeq',
  'observations',
  'coverageDelta',
] as const;
const BATCH_KEY_SET: ReadonlySet<string> = new Set<string>(BATCH_KEYS);

function pageBatch(input: unknown): ValidationResult<PageBatch> {
  if (!isObjectLike(input)) return fail('batch: not an object');
  const keyError = checkKeys(input, BATCH_KEY_SET, BATCH_KEYS, 'batch');
  if (keyError !== null) return fail(keyError);
  if (input['schemaVersion'] !== 1) return fail('batch.schemaVersion');
  if (input['type'] !== 'sensor-events') return fail('batch.type');
  const sensorBootId = readId(input['sensorBootId']);
  if (sensorBootId === null) return fail('batch.sensorBootId');
  const bridgeSessionId = readId(input['bridgeSessionId']);
  if (bridgeSessionId === null) return fail('batch.bridgeSessionId');
  const batchSeq = readInt(input['batchSeq'], 1, MAX_COUNT);
  if (batchSeq === null) return fail('batch.batchSeq');
  const observations = validateObservations(input['observations'], 'batch.observations', 0);
  if (!observations.ok) return observations;
  const coverageDelta = readCoverageFlags(input['coverageDelta']);
  if (coverageDelta === null) return fail('batch.coverageDelta');
  if (observations.value.length === 0 && coverageDelta.length === 0) return fail('batch: empty (no observations, no coverageDelta)');
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      type: 'sensor-events',
      sensorBootId,
      bridgeSessionId,
      batchSeq,
      observations: observations.value,
      coverageDelta,
    },
  };
}

/** Strict validation of an incoming PageBatch. Never throws. The returned value is a fresh, normalized copy. */
export function validatePageBatch(input: unknown): ValidationResult<PageBatch> {
  try {
    return pageBatch(input);
  } catch {
    return fail('batch: exception');
  }
}

// ---------------------------------------------------------------------------
// MAIN -> ISOLATED: sensor messages (page-controlled)
// ---------------------------------------------------------------------------

const SENSOR_HELLO_KEYS = ['channel', 'sensorBootId', 'type', 'protocolVersion', 'startedLate', 'coverageFlags'] as const;
const SENSOR_BATCH_KEYS = ['channel', 'sensorBootId', 'type', 'sensorSeq', 'observations', 'coverageDelta'] as const;
const SENSOR_STATUS_KEYS = ['channel', 'sensorBootId', 'type', 'state', 'coverageFlags', 'droppedSinceLast'] as const;
const SENSOR_HELLO_SET: ReadonlySet<string> = new Set<string>(SENSOR_HELLO_KEYS);
const SENSOR_BATCH_SET: ReadonlySet<string> = new Set<string>(SENSOR_BATCH_KEYS);
const SENSOR_STATUS_SET: ReadonlySet<string> = new Set<string>(SENSOR_STATUS_KEYS);

function readMessageType(input: Record<string, unknown>): string | null {
  const t = input['type'];
  return typeof t === 'string' && t.length >= 1 && t.length <= MAX_TYPE_CHARS ? t : null;
}

function readPageMessageHeader(input: Record<string, unknown>, path: string): ValidationResult<string> {
  if (input['channel'] !== CHANNEL) return fail(path + '.channel');
  const sensorBootId = readId(input['sensorBootId']);
  if (sensorBootId === null) return fail(path + '.sensorBootId');
  return { ok: true, value: sensorBootId };
}

function sensorMessage(input: unknown): ValidationResult<SensorMessage> {
  if (!isObjectLike(input)) return fail('sensor: not an object');
  const type = readMessageType(input);
  if (type === null) return fail('sensor.type');
  switch (type) {
    case 'sensor-reset': {
      const required = ['channel', 'sensorBootId', 'type', 'resetId', 'nextSensorBootId', 'coverageFlags'] as const;
      const error = checkKeys(input, new Set(required), required, type);
      if (error !== null) return fail(error);
      const header = readPageMessageHeader(input, type);
      if (!header.ok) return header;
      const resetId = readId(input['resetId']);
      const nextSensorBootId = readId(input['nextSensorBootId']);
      const coverageFlags = readCoverageFlags(input['coverageFlags']);
      if (resetId === null || nextSensorBootId === null || nextSensorBootId === header.value || coverageFlags === null) return fail('sensor-reset.ids');
      return { ok: true, value: { channel: CHANNEL, sensorBootId: header.value, type, resetId, nextSensorBootId, coverageFlags } };
    }
    case 'sensor-hello': {
      const keyError = checkKeys(input, SENSOR_HELLO_SET, SENSOR_HELLO_KEYS, type);
      if (keyError !== null) return fail(keyError);
      const header = readPageMessageHeader(input, type);
      if (!header.ok) return header;
      const protocolVersion = readInt(input['protocolVersion'], 0, MAX_COUNT);
      if (protocolVersion === null) return fail(type + '.protocolVersion');
      const startedLate = readBool(input['startedLate']);
      if (startedLate === null) return fail(type + '.startedLate');
      const coverageFlags = readCoverageFlags(input['coverageFlags']);
      if (coverageFlags === null) return fail(type + '.coverageFlags');
      return {
        ok: true,
        value: { channel: CHANNEL, sensorBootId: header.value, type, protocolVersion, startedLate, coverageFlags },
      };
    }
    case 'sensor-batch': {
      const keyError = checkKeys(input, SENSOR_BATCH_SET, SENSOR_BATCH_KEYS, type);
      if (keyError !== null) return fail(keyError);
      const header = readPageMessageHeader(input, type);
      if (!header.ok) return header;
      const sensorSeq = readInt(input['sensorSeq'], 1, MAX_COUNT);
      if (sensorSeq === null) return fail(type + '.sensorSeq');
      const observations = validateObservations(input['observations'], type + '.observations');
      if (!observations.ok) return observations;
      const coverageDelta = readCoverageFlags(input['coverageDelta']);
      if (coverageDelta === null) return fail(type + '.coverageDelta');
      return {
        ok: true,
        value: {
          channel: CHANNEL,
          sensorBootId: header.value,
          type,
          sensorSeq,
          observations: observations.value,
          coverageDelta,
        },
      };
    }
    case 'sensor-status': {
      const keyError = checkKeys(input, SENSOR_STATUS_SET, SENSOR_STATUS_KEYS, type);
      if (keyError !== null) return fail(keyError);
      const header = readPageMessageHeader(input, type);
      if (!header.ok) return header;
      const state = readEnum<SensorState>(input['state'], SENSOR_STATE_SET);
      if (state === null) return fail(type + '.state');
      const coverageFlags = readCoverageFlags(input['coverageFlags']);
      if (coverageFlags === null) return fail(type + '.coverageFlags');
      const droppedSinceLast = readCount(input['droppedSinceLast']);
      if (droppedSinceLast === null) return fail(type + '.droppedSinceLast');
      return {
        ok: true,
        value: { channel: CHANNEL, sensorBootId: header.value, type, state, coverageFlags, droppedSinceLast },
      };
    }
    default:
      return fail('sensor.type');
  }
}

/** Validation of a MAIN -> ISOLATED window message. Never throws. */
export function validateSensorMessage(input: unknown): ValidationResult<SensorMessage> {
  try {
    return sensorMessage(input);
  } catch {
    return fail('sensor: exception');
  }
}

// ---------------------------------------------------------------------------
// ISOLATED -> MAIN: bridge messages (the page can forge these too; shape-check only)
// ---------------------------------------------------------------------------

const BRIDGE_HELLO_KEYS = ['channel', 'sensorBootId', 'type', 'protocolVersion', 'bridgeSessionId', 'paused'] as const;
const BRIDGE_SIMPLE_KEYS = ['channel', 'sensorBootId', 'type'] as const;
const BRIDGE_STOP_KEYS = ['channel', 'sensorBootId', 'type', 'reason'] as const;
const BRIDGE_HELLO_SET: ReadonlySet<string> = new Set<string>(BRIDGE_HELLO_KEYS);
const BRIDGE_SIMPLE_SET: ReadonlySet<string> = new Set<string>(BRIDGE_SIMPLE_KEYS);
const BRIDGE_STOP_SET: ReadonlySet<string> = new Set<string>(BRIDGE_STOP_KEYS);

function bridgeMessage(input: unknown): ValidationResult<BridgeMessage> {
  if (!isObjectLike(input)) return fail('bridge: not an object');
  const type = readMessageType(input);
  if (type === null) return fail('bridge.type');
  switch (type) {
    case 'bridge-reset': {
      const required = ['channel', 'sensorBootId', 'type', 'resetId'] as const;
      const error = checkKeys(input, new Set(required), required, type);
      if (error !== null) return fail(error);
      const header = readPageMessageHeader(input, type);
      if (!header.ok) return header;
      const resetId = readId(input['resetId']);
      return resetId === null ? fail('bridge-reset.resetId') : { ok: true, value: { channel: CHANNEL, sensorBootId: header.value, type, resetId } };
    }
    case 'bridge-hello': {
      const keyError = checkKeys(input, BRIDGE_HELLO_SET, BRIDGE_HELLO_KEYS, type);
      if (keyError !== null) return fail(keyError);
      const header = readPageMessageHeader(input, type);
      if (!header.ok) return header;
      const protocolVersion = readInt(input['protocolVersion'], 0, MAX_COUNT);
      if (protocolVersion === null) return fail(type + '.protocolVersion');
      const bridgeSessionId = readId(input['bridgeSessionId']);
      if (bridgeSessionId === null) return fail(type + '.bridgeSessionId');
      const paused = readBool(input['paused']);
      if (paused === null) return fail(type + '.paused');
      return {
        ok: true,
        value: { channel: CHANNEL, sensorBootId: header.value, type, protocolVersion, bridgeSessionId, paused },
      };
    }
    case 'bridge-pause':
    case 'bridge-resume': {
      const keyError = checkKeys(input, BRIDGE_SIMPLE_SET, BRIDGE_SIMPLE_KEYS, type);
      if (keyError !== null) return fail(keyError);
      const header = readPageMessageHeader(input, type);
      if (!header.ok) return header;
      return { ok: true, value: { channel: CHANNEL, sensorBootId: header.value, type } };
    }
    case 'bridge-stop': {
      const keyError = checkKeys(input, BRIDGE_STOP_SET, BRIDGE_STOP_KEYS, type);
      if (keyError !== null) return fail(keyError);
      const header = readPageMessageHeader(input, type);
      if (!header.ok) return header;
      const reason = readEnum<BridgeStopReason>(input['reason'], STOP_REASON_SET);
      if (reason === null) return fail(type + '.reason');
      return { ok: true, value: { channel: CHANNEL, sensorBootId: header.value, type, reason } };
    }
    default:
      return fail('bridge.type');
  }
}

/** Validation of an ISOLATED -> MAIN window message. Never throws. */
export function validateBridgeMessage(input: unknown): ValidationResult<BridgeMessage> {
  try {
    return bridgeMessage(input);
  } catch {
    return fail('bridge: exception');
  }
}

// ---------------------------------------------------------------------------
// SW -> ISOLATED: bridge control (tabs.sendMessage). The sender is verified by the bridge; shape-check only.
// ---------------------------------------------------------------------------

const BRIDGE_CONTROL_KEYS = ['schemaVersion', 'type', 'command'] as const;
const BRIDGE_CONTROL_SET: ReadonlySet<string> = new Set<string>(BRIDGE_CONTROL_KEYS);
const BRIDGE_CONTROL_RESET_SET: ReadonlySet<string> = new Set<string>([...BRIDGE_CONTROL_KEYS, 'resetId']);

function readDataFields(input: unknown, allowed: ReadonlySet<string>, required: readonly string[]): Record<string, unknown> | null {
  if (!isObjectLike(input)) return null;
  const keys = capturedOwnKeys(input);
  if (keys.length > (capturedApply(capturedSetSize, allowed, []) as number)) return null;
  const fields = capturedCreate(null) as Record<string, unknown>;
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index];
    if (typeof key !== 'string' || !setContains(allowed, key)) return null;
    const descriptor = capturedDescriptor(input, key);
    if (descriptor === undefined || !hasOwn(descriptor, 'value') || !descriptor.enumerable) return null;
    fields[key] = descriptor.value;
  }
  for (let index = 0; index < required.length; index++) if (!hasOwn(fields, required[index]!)) return null;
  return fields;
}

function bridgeControl(input: unknown): ValidationResult<BridgeControlMessage> {
  const fields = readDataFields(input, BRIDGE_CONTROL_RESET_SET, BRIDGE_CONTROL_KEYS);
  if (fields === null) return fail('control: data fields');
  input = fields;
  if (!isObjectLike(input)) return fail('control: not an object');
  if (readMessageType(input) === 'bridge-control' && input['command'] === 'reset') {
    const required = ['schemaVersion', 'type', 'command', 'resetId'] as const;
    const error = checkKeys(input, new Set(required), required, 'bridge-control');
    if (error !== null) return fail(error);
    const resetId = readId(input['resetId']);
    return input['schemaVersion'] === 1 && resetId !== null
      ? { ok: true, value: { schemaVersion: 1, type: 'bridge-control', command: 'reset', resetId } }
      : fail('bridge-control.reset');
  }
  const keyError = checkKeys(input, BRIDGE_CONTROL_SET, BRIDGE_CONTROL_KEYS, 'bridge-control');
  if (keyError !== null) return fail(keyError);
  if (input['schemaVersion'] !== 1) return fail('bridge-control.schemaVersion');
  if (input['type'] !== 'bridge-control') return fail('bridge-control.type');
  const command = readEnum<BridgeControlCommand>(input['command'], CONTROL_COMMAND_SET);
  if (command === null || command === 'reset') return fail('bridge-control.command');
  return { ok: true, value: { schemaVersion: 1, type: 'bridge-control', command } };
}

/** Validation of a SW -> ISOLATED bridge-control message. Never throws. */
export function validateBridgeControl(input: unknown): ValidationResult<BridgeControlMessage> {
  try {
    return bridgeControl(input);
  } catch {
    return fail('control: exception');
  }
}

/** Exact response to a native SW→ISOLATED reset; IDs remain routing, not page authentication (ADR-073). */
export function validateBridgeResetAck(input: unknown): ValidationResult<BridgeResetAck> {
  try {
    const required = ['schemaVersion', 'type', 'resetId', 'bridgeSessionId', 'sensorBootIds'] as const;
    const fields = readDataFields(input, new Set(required), required);
    if (fields === null) return fail('reset-ack.fields');
    input = fields;
    if (!isObjectLike(input)) return fail('reset-ack.object');
    const resetId = readId(input['resetId']);
    const bridgeSessionId = readId(input['bridgeSessionId']);
    const boots = input['sensorBootIds'];
    if (input['schemaVersion'] !== 1 || input['type'] !== 'bridge-reset-ack' || resetId === null || bridgeSessionId === null || !capturedIsArray(boots)) return fail('reset-ack.shape');
    const lengthDescriptor = capturedDescriptor(boots, 'length');
    const length = lengthDescriptor !== undefined && hasOwn(lengthDescriptor, 'value') ? readInt(lengthDescriptor.value, 1, 4) : null;
    if (length === null || capturedOwnKeys(boots).length !== length + 1) return fail('reset-ack.boots');
    const sensorBootIds: string[] = [];
    for (let index = 0; index < length; index++) {
      const descriptor = capturedDescriptor(boots, String(index));
      const id = descriptor !== undefined && hasOwn(descriptor, 'value') && descriptor.enumerable ? readId(descriptor.value) : null;
      if (id === null || sensorBootIds.includes(id)) return fail('reset-ack.boots');
      sensorBootIds.push(id);
    }
    return { ok: true, value: { schemaVersion: 1, type: 'bridge-reset-ack', resetId, bridgeSessionId, sensorBootIds } };
  } catch { return fail('reset-ack.exception'); }
}

// ---------------------------------------------------------------------------
// UI -> SW requests. Sender authorization (extension page) is checked by the SW separately.
// ---------------------------------------------------------------------------

const UI_GET_REPORT_REQUIRED = ['schemaVersion', 'type', 'tabId'] as const;
const UI_GET_REPORT_SET: ReadonlySet<string> = new Set<string>([...UI_GET_REPORT_REQUIRED, 'frameId']);
const UI_REVISION_KEYS = ['schemaVersion', 'type', 'tabId', 'documentKey', 'reportRevision'] as const;
const UI_REVISION_SET: ReadonlySet<string> = new Set<string>(UI_REVISION_KEYS);
const UI_EXPORT_SET: ReadonlySet<string> = new Set<string>([...UI_REVISION_KEYS, 'includeHost']);
const UI_SET_SCOPE_REQUIRED = ['schemaVersion', 'type', 'scopeMode'] as const;
const UI_SET_SCOPE_SET: ReadonlySet<string> = new Set<string>([...UI_SET_SCOPE_REQUIRED, 'host']);
const UI_GET_SCOPE_KEYS = ['schemaVersion', 'type'] as const;
const UI_GET_SCOPE_SET: ReadonlySet<string> = new Set<string>(UI_GET_SCOPE_KEYS);
const UI_INJECT_NOW_KEYS = ['schemaVersion', 'type', 'tabId'] as const;
const UI_INJECT_NOW_SET: ReadonlySet<string> = new Set<string>(UI_INJECT_NOW_KEYS);

function readTabId(v: unknown): number | null {
  return readInt(v, 0, MAX_COUNT);
}

function uiRequest(input: unknown): ValidationResult<UiRequest> {
  if (!isObjectLike(input)) return fail('ui: not an object');
  const type = readMessageType(input);
  if (type === null) return fail('ui.type');
  if (input['schemaVersion'] !== 1) return fail('ui.schemaVersion');
  switch (type) {
    case 'ui-get-report': {
      const keyError = checkKeys(input, UI_GET_REPORT_SET, UI_GET_REPORT_REQUIRED, type);
      if (keyError !== null) return fail(keyError);
      const tabId = readTabId(input['tabId']);
      if (tabId === null) return fail(type + '.tabId');
      if (hasOwn(input, 'frameId')) {
        const frameId = readInt(input['frameId'], 0, Number.MAX_SAFE_INTEGER);
        if (frameId === null) return fail(type + '.frameId');
        return { ok: true, value: { schemaVersion: 1, type, tabId, frameId } };
      }
      return { ok: true, value: { schemaVersion: 1, type, tabId } };
    }
    case 'ui-pause':
    case 'ui-resume':
    case 'ui-clear':
    case 'ui-export-preview': {
      const keyError = checkKeys(input, type === 'ui-export-preview' ? UI_EXPORT_SET : UI_REVISION_SET, UI_REVISION_KEYS, type);
      if (keyError !== null) return fail(keyError);
      const tabId = readTabId(input['tabId']);
      if (tabId === null) return fail(type + '.tabId');
      const documentKey = readDocumentKey(input['documentKey']);
      if (documentKey === null) return fail(type + '.documentKey');
      const reportRevision = readInt(input['reportRevision'], 0, MAX_COUNT);
      if (reportRevision === null) return fail(type + '.reportRevision');
      if (type === 'ui-export-preview' && hasOwn(input, 'includeHost')) {
        const includeHost = readBool(input['includeHost']);
        if (includeHost === null) return fail(type + '.includeHost');
        return { ok: true, value: { schemaVersion: 1, type, tabId, documentKey, reportRevision, includeHost } };
      }
      return { ok: true, value: { schemaVersion: 1, type, tabId, documentKey, reportRevision } };
    }
    case 'ui-set-scope': {
      const keyError = checkKeys(input, UI_SET_SCOPE_SET, UI_SET_SCOPE_REQUIRED, type);
      if (keyError !== null) return fail(keyError);
      const scopeMode = readEnum<ScopeMode>(input['scopeMode'], SCOPE_SET);
      if (scopeMode === null) return fail(type + '.scopeMode');
      const hasHost = hasOwn(input, 'host');
      if (scopeMode === 'site') {
        if (!hasHost) return fail(type + '.host: required for site scope');
        const host = input['host'];
        if (!isSanitizedHost(host)) return fail(type + '.host');
        return { ok: true, value: { schemaVersion: 1, type, scopeMode, host } };
      }
      if (hasHost) return fail(type + '.host: only allowed for site scope');
      return { ok: true, value: { schemaVersion: 1, type, scopeMode } };
    }
    case 'ui-get-scope':
    case 'ui-clear-session': {
      const keyError = checkKeys(input, UI_GET_SCOPE_SET, UI_GET_SCOPE_KEYS, type);
      if (keyError !== null) return fail(keyError);
      return { ok: true, value: { schemaVersion: 1, type } };
    }
    case 'ui-inject-now': {
      const keyError = checkKeys(input, UI_INJECT_NOW_SET, UI_INJECT_NOW_KEYS, type);
      if (keyError !== null) return fail(keyError);
      const tabId = readTabId(input['tabId']);
      if (tabId === null) return fail(type + '.tabId');
      return { ok: true, value: { schemaVersion: 1, type, tabId } };
    }
    default:
      return fail('ui.type');
  }
}

/** Validation of a UI -> SW request. Never throws. */
export function validateUiRequest(input: unknown): ValidationResult<UiRequest> {
  try {
    return uiRequest(input);
  } catch {
    return fail('ui: exception');
  }
}
