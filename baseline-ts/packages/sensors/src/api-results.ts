import { API_RESULTS_CHANNEL, API_RESULTS_LIMITS, apiResultDefinition, apiResultEntryBytes } from '../../contracts/src/api-results';
import type { ApiNumericValue, ApiResultEntry, ApiResultPhase, ApiResultsControl, ApiResultsSnapshot, ApiResultValue } from '../../contracts/src/api-results';
import { arrayPush, arraySlice } from './intrinsics';
import { readRtcValue, rtcValueProfile, rtcValueSource } from '../../contracts/src/rtc-values';
import type { RtcValue } from '../../contracts/src/rtc-values';
import { valueCaptureDenied } from './value-capture-policy';

const apply = Reflect.apply;
const mapGet = Map.prototype.get;
const mapSet = Map.prototype.set;
const mapClear = Map.prototype.clear;
const mapForEach = Map.prototype.forEach;
const mapSize = Object.getOwnPropertyDescriptor(Map.prototype, 'size')!.get!;
const is = Object.is;
const isFinite = Number.isFinite;
const isNaN = Number.isNaN;
const NativeMap = Map;
const typedPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const typedLength = Object.getOwnPropertyDescriptor(typedPrototype, 'length')!.get!;
const typedBuffer = Object.getOwnPropertyDescriptor(typedPrototype, 'buffer')!.get!;
const typedAt = Object.getOwnPropertyDescriptor(typedPrototype, 'at')!.value as Function;
const ordinaryBufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;

function numeric(value: number): ApiNumericValue {
  if (is(value, -0)) return '-0';
  if (isNaN(value)) return 'NaN';
  if (!isFinite(value)) return value > 0 ? 'Infinity' : '-Infinity';
  return value;
}

function numericVector(result: unknown): ApiResultValue {
  try {
    const length: unknown = apply(typedLength, result, []);
    if (typeof length !== 'number') return { kind: 'unobserved', reason: 'object' };
    if (length > API_RESULTS_LIMITS.vectorItems) return { kind: 'unobserved', reason: 'limit' };
    const buffer: unknown = apply(typedBuffer, result, []);
    apply(ordinaryBufferLength, buffer, []);
    const values: ApiNumericValue[] = [];
    for (let index = 0; index < length; index++) {
      const value: unknown = apply(typedAt, result, [index]);
      if (typeof value !== 'number') return { kind: 'unobserved', reason: 'unsupported' };
      arrayPush(values, numeric(value));
    }
    return { kind: 'number-array', values };
  } catch { return { kind: 'unobserved', reason: 'object' }; }
}

export function previewReturnedValue(operation: string, phase: ApiResultPhase, result: unknown, allowNumericVectors = false): ApiResultValue | null {
  const definition = apiResultDefinition(operation);
  if (!definition) return null;
  if (phase === 'threw-sync') return { kind: 'unobserved', reason: 'exception' };
  if (definition.sensitive) return { kind: 'unobserved', reason: 'sensitive' };
  if (definition.typeOnly) return { kind: 'unobserved', reason: 'unsupported' };
  if (phase === 'settlement-unobserved') return { kind: 'unobserved', reason: 'async' };
  if (definition.numericVector && result !== null && typeof result === 'object') return allowNumericVectors
    ? numericVector(result) : { kind: 'unobserved', reason: 'unsupported' };
  if (result === null) return { kind: 'null' };
  if (result === undefined) return { kind: 'undefined' };
  if (typeof result === 'boolean') return { kind: 'boolean', value: result };
  if (typeof result === 'number') {
    if (is(result, -0)) return { kind: 'special-number', value: '-0' };
    if (isNaN(result)) return { kind: 'special-number', value: 'NaN' };
    if (!isFinite(result)) return { kind: 'special-number', value: result > 0 ? 'Infinity' : '-Infinity' };
    return { kind: 'number', value: result };
  }
  if (typeof result === 'string') return result.length <= API_RESULTS_LIMITS.stringChars
    ? { kind: 'string', value: result } : { kind: 'unobserved', reason: 'limit' };
  return { kind: 'unobserved', reason: typeof result === 'object' || typeof result === 'function' ? 'object' : 'unsupported' };
}

export class ApiResultRecorder {
  private readonly rows = new NativeMap<string, ApiResultEntry>();
  private truncated = false;
  private bytes = 512;
  private lastOperation = '';
  private lastPhase: ApiResultPhase = 'returned-sync';
  private lastEntry: ApiResultEntry | undefined;
  private epoch = 0;
  private lastReadAt = -Infinity;
  private resetGeneration = 0;

  constructor(private readonly allowNumericVectors = false) {}

  get generation(): number { return this.resetGeneration; }

  recordRtc(operation: string, value: RtcValue): void {
    if (valueCaptureDenied(this)) return;
    const definition = apiResultDefinition(operation);
    if (!definition || definition.asynchronous || definition.sensitive || rtcValueProfile(operation) !== value.profile || rtcValueSource(operation) !== value.source) return;
    const checked = readRtcValue(value);
    if (!checked) { this.truncated = true; return; }
    this.store({ operation, techniqueId: definition.techniqueId, phase: 'returned-sync', value: checked });
  }

  markLimited(): void { this.truncated = true; }

  record(operation: string, phase: ApiResultPhase, result: unknown): void {
    if (valueCaptureDenied(this)) return;
    const cached = operation === this.lastOperation && phase === this.lastPhase;
    const key = cached ? '' : operation + ':' + phase;
    const previous = cached ? this.lastEntry : apply(mapGet, this.rows, [key]) as ApiResultEntry | undefined;
    if (previous) {
      const value = previous.value;
      if ((value.kind === 'number' || value.kind === 'boolean' || value.kind === 'string') && is(value.value, result) ||
        value.kind === 'null' && result === null || value.kind === 'undefined' && result === undefined ||
        value.kind === 'unobserved' && (value.reason === 'sensitive' || phase !== 'returned-sync' ||
          value.reason === 'object' && !apiResultDefinition(operation)?.numericVector && result !== null &&
            (typeof result === 'object' || typeof result === 'function'))) return;
    }
    const definition = apiResultDefinition(operation);
    if (!definition) return;
    if (!previous && (apply(mapSize, this.rows, []) as number) >= API_RESULTS_LIMITS.rows) { this.truncated = true; return; }
    let value = previewReturnedValue(operation, phase, result, this.allowNumericVectors);
    if (value === null) return;
    this.store({ operation, techniqueId: definition.techniqueId, phase, value });
  }

  private store(entry: ApiResultEntry): void {
    if (valueCaptureDenied(this)) return;
    const key = entry.operation + ':' + entry.phase;
    const previous = apply(mapGet, this.rows, [key]) as ApiResultEntry | undefined;
    if (!previous && (apply(mapSize, this.rows, []) as number) >= API_RESULTS_LIMITS.rows) { this.truncated = true; return; }
    let bytes = this.bytes - (previous ? apiResultEntryBytes(previous) : 0) + apiResultEntryBytes(entry);
    if (bytes > API_RESULTS_LIMITS.bytes) {
      this.truncated = true;
      entry.value = { kind: 'unobserved', reason: apiResultDefinition(entry.operation)?.typeOnly ? 'unsupported' : 'limit' };
      bytes = this.bytes - (previous ? apiResultEntryBytes(previous) : 0) + apiResultEntryBytes(entry);
      if (bytes > API_RESULTS_LIMITS.bytes) return;
    }
    this.bytes = bytes;
    this.lastOperation = entry.operation; this.lastPhase = entry.phase; this.lastEntry = entry;
    apply(mapSet, this.rows, [key, entry]);
    if (entry.value.kind === 'unobserved' && entry.value.reason === 'limit' || entry.value.kind === 'webrtc' && entry.value.truncated) this.truncated = true;
  }

  snapshot(): ApiResultsSnapshot {
    if (valueCaptureDenied(this)) return { rows: [], truncated: false };
    const rows: ApiResultEntry[] = [];
    apply(mapForEach, this.rows, [(row: ApiResultEntry) => { arrayPush(rows, { ...row,
      value: row.value.kind === 'number-array' ? { kind: 'number-array', values: arraySlice(row.value.values) } :
        row.value.kind === 'webrtc' ? readRtcValue(row.value)! : { ...row.value } }); }]);
    return { rows, truncated: this.truncated };
  }

  clear(): void {
    apply(mapClear, this.rows, []); this.truncated = false; this.bytes = 512; this.lastOperation = ''; this.lastEntry = undefined;
    this.resetGeneration++;
  }

  handleControl(control: ApiResultsControl, enabled: boolean, env: { now(): number; postMessage(message: unknown): void }): void {
    enabled = enabled && !valueCaptureDenied(this);
    if (control.epoch !== this.epoch || control.type === 'api-results-reset') {
      this.clear(); this.epoch = control.epoch;
    }
    if (control.type !== 'api-results-read') return;
    const now = env.now();
    if (now - this.lastReadAt < 1000) return;
    this.lastReadAt = now;
    const snapshot = enabled ? this.snapshot() : { rows: [], truncated: false };
    let index = 0, batchSeq = 0;
    do {
      const rows: ApiResultEntry[] = [];
      let bytes = 512;
      while (index < snapshot.rows.length && rows.length < API_RESULTS_LIMITS.batchRows) {
        const row = snapshot.rows[index]!;
        const cost = apiResultEntryBytes(row);
        if (bytes + cost > 16384) break;
        arrayPush(rows, row); bytes += cost; index++;
      }
      const denied = valueCaptureDenied(this);
      env.postMessage({ channel: API_RESULTS_CHANNEL, type: 'api-results-batch', requestId: control.requestId, epoch: this.epoch,
        batchSeq, final: denied || index >= snapshot.rows.length, enabled: enabled && !denied, rows: denied ? [] : rows, truncated: denied ? false : snapshot.truncated });
      if (denied) return;
      batchSeq++;
    } while (index < snapshot.rows.length && batchSeq < 64);
  }
}
