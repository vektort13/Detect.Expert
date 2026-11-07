// MAIN-world sensor runtime (spec II A5/A11, III §3.4, V §3; REQ-004, REQ-005, REQ-011, REQ-012; ADR-006 §7-8).
//
// Owns: sensorBootId, saturating counters keyed by (technique, phase, signal codes) as one integer, the bounded
// startup queue until the bridge handshake, batching over window.postMessage at most every 250 ms, sensor-status
// with coverage flags, and the pause/resume/stop protocol. Everything posted here is page-controlled by
// definition (REQ-004): the bridge validates it again and the SW never trusts it for identity.
//
// Never leaves this module: arguments, results, pixels, strings, fonts. Only technique/phase/signal enums,
// saturating counts and 250 ms interval buckets relative to sensor boot.

import { BUDGETS, CHANNEL, MAX_COUNT, PROTOCOL_VERSION, UNBOUND_SENSOR_BOOT_ID, validateBridgeMessage } from '@detect-expert/contracts';
import type {
  BridgeStopReason,
  CountQuality,
  CoverageFlag,
  PageObservation,
  Phase,
  SensorBatchMessage,
  SensorHelloMessage,
  SensorState,
  SensorStatusMessage,
  SensorResetMessage,
  SignalCode,
  TechniqueId,
} from '@detect-expert/contracts';
import { compositeKey, decodeKey, PHASE_INDEX } from './codes';
import { createHookContext } from './wrap';
import { arrayPush, arraySlice, arraySplice, arrayIncludes, setHas, setAdd, setArray, mapSize, mapForEach } from './intrinsics';
import type { HookContext, HookHandle, WrapResult } from './wrap';

/** Distinct aggregates kept before the bridge handshake (bounded startup queue). */
export const STARTUP_QUEUE_MAX = 32;
const BUCKET_MS = BUDGETS.flushMinMs;
const FLUSH_MS = BUDGETS.flushMinMs;
const PHASE_ATTEMPTED = PHASE_INDEX['attempted'];

const apply = Reflect.apply;
const getDescriptor = Object.getOwnPropertyDescriptor;
const getPrototype = Object.getPrototypeOf;
const functionSource = Function.prototype.call.bind(Function.prototype.toString) as (fn: Function) => string;
const stringIncludes = Function.prototype.call.bind(String.prototype.includes) as (text: string, part: string) => boolean;
const floor = Math.floor;
const NO_ARGS: readonly unknown[] = Object.freeze([]);
// Hot-path Map access through references captured now, immune to later page patches of Map.prototype.
const mapGet = Function.prototype.call.bind(Map.prototype.get) as (
  m: Map<number, CounterEntry>,
  k: number,
) => CounterEntry | undefined;
const mapSet = Function.prototype.call.bind(Map.prototype.set) as (
  m: Map<number, CounterEntry>,
  k: number,
  v: CounterEntry,
) => unknown;
const clearMap = Function.prototype.call.bind(Map.prototype.clear) as (map: Map<number, CounterEntry>) => void;
const deleteSet = Function.prototype.call.bind(Set.prototype.delete) as (set: Set<CoverageFlag>, flag: CoverageFlag) => void;

/** Environment the runtime talks to; captured once at install so later page patches do not redirect it. */
export interface RuntimeEnv {
  /** The realm's window; `event.source === self` is routing, not authentication. */
  self: object;
  /** Posts to the realm's window with targetOrigin '*'. */
  postMessage(message: unknown): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
  randomBytes(length: number): Uint8Array;
  /** document.readyState !== 'loading' at install: document scripts may already have run. */
  startedLate: boolean;
  /** Explicit injection provenance, never inferred solely from readyState. */
  earlyCaptureGuaranteed?: boolean;
  readMessage(event: object): { source: unknown; data: unknown };
}

/** Captures the browser environment from a window. Call as early as possible (document_start). */
export function browserEnv(w: Window & typeof globalThis, earlyCaptureGuaranteed = false): RuntimeEnv {
  // F129: descriptor inspection rejects detectable replacements without invoking their accessors.
  // Native-looking source is only a rejection heuristic, never proof of a pristine late-install realm.
  const nativeFunction = (value: unknown): Function => {
    if (typeof value !== 'function' || !stringIncludes(functionSource(value), '[native code]')) {
      throw new Error('sensor environment unavailable');
    }
    return value;
  };
  const descriptor = (object: object, key: string): PropertyDescriptor => {
    let current: object | null = object;
    for (let depth = 0; current !== null && depth < 16; depth++) {
      const d = getDescriptor(current, key);
      if (d !== undefined) return d;
      current = getPrototype(current);
    }
    throw new Error('sensor environment unavailable');
  };
  const read = (object: object, key: string, accessorAllowed = false): unknown => {
    const d = descriptor(object, key);
    if (getDescriptor(d, 'value') !== undefined) return d.value;
    if (!accessorAllowed) throw new Error('sensor environment unavailable');
    return apply(nativeFunction(d.get), object, NO_ARGS);
  };
  const objectValue = (value: unknown): object => {
    if (typeof value !== 'object' || value === null) throw new Error('sensor environment unavailable');
    return value;
  };
  const doc = objectValue(read(w, 'document', true));
  const startedLate = read(doc, 'readyState', true) !== 'loading';
  const post = nativeFunction(read(w, 'postMessage'));
  const add = nativeFunction(read(w, 'addEventListener'));
  const remove = nativeFunction(read(w, 'removeEventListener'));
  const st = nativeFunction(read(w, 'setTimeout'));
  const ct = nativeFunction(read(w, 'clearTimeout'));
  const perf = objectValue(read(w, 'performance', true));
  const perfNow = nativeFunction(read(perf, 'now'));
  const cr = objectValue(read(w, 'crypto', true));
  const grv = nativeFunction(read(cr, 'getRandomValues'));
  const eventClass = nativeFunction(read(w, 'MessageEvent'));
  const eventProto = objectValue(read(eventClass, 'prototype'));
  const sourceGetter = nativeFunction(descriptor(eventProto, 'source').get);
  const dataGetter = nativeFunction(descriptor(eventProto, 'data').get);
  return {
    self: w,
    postMessage: (message) => {
      apply(post, w, [message, '*']);
    },
    addEventListener: (type, listener) => {
      apply(add, w, [type, listener]);
    },
    removeEventListener: (type, listener) => {
      apply(remove, w, [type, listener]);
    },
    setTimeout: (callback, ms) => apply(st, w, [callback, ms]) as unknown,
    clearTimeout: (handle) => {
      apply(ct, w, [handle]);
    },
    now: () => apply(perfNow, perf, NO_ARGS) as number,
    randomBytes: (length) => apply(grv, cr, [new Uint8Array(length)]) as Uint8Array,
    startedLate,
    earlyCaptureGuaranteed: earlyCaptureGuaranteed && !startedLate,
    // F133: live MessageEvent getters may hide revoke messages; failed brand checks are ignored by onMessage.
    readMessage: (event) => ({ source: apply(sourceGetter, event, NO_ARGS), data: apply(dataGetter, event, NO_ARGS) }),
  };
}

interface CounterEntry {
  techniqueId: TechniqueId;
  phase: Phase;
  signalCodes: SignalCode[];
  count: number;
  countQuality: CountQuality;
  lastBucket: number;
  dirty: boolean;
}

export interface StopResult {
  reason: BridgeStopReason | 'local';
  /** Labels of hooks whose original descriptor was restored. */
  restored: string[];
  /** Labels of hooks left in place because the page (or another extension) replaced our wrapper. */
  notRestored: string[];
  cleanup: 'complete' | 'partial' | 'none';
}

/** Read-only view for tests and diagnostics. */
export interface RuntimeSnapshot {
  counters: Array<Pick<CounterEntry, 'techniqueId' | 'phase' | 'signalCodes' | 'count' | 'countQuality' | 'lastBucket'>>;
  size: number;
  dropped: number;
  flags: CoverageFlag[];
  state: SensorState;
  handshake: boolean;
  sensorSeq: number;
  observerErrors: number;
}

function makeBootId(env: RuntimeEnv): string {
  const bytes = env.randomBytes(12);
  let out = 'boot-';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0;
    out += (b < 16 ? '0' : '') + b.toString(16);
  }
  return out;
}

export class SensorRuntime {
  private currentBootId: string;
  get sensorBootId(): string { return this.currentBootId; }
  /** Shared with every hook installed for this runtime; `enabled` is the pause switch. */
  readonly hooks: HookContext = createHookContext();
  /** P04: association histories cannot cross an interval in which native mutations were unobserved. */
  historyEpoch: object = {};

  private readonly env: RuntimeEnv;
  private bootAt: number;
  private readonly counters = new Map<number, CounterEntry>();
  private readonly dirty: CounterEntry[] = [];
  private readonly flags = new Set<CoverageFlag>();
  private flagDelta: CoverageFlag[] = [];
  private readonly handles: HookHandle[] = [];
  private unsupportedHooks = 0;
  private reportedObserverErrors = 0;
  private dropped = 0;
  private sensorSeq = 0;
  private timer: unknown = null;
  private timerFailed = false;
  private handshake = false;
  private paused = false;
  private stopped = false;
  private started = false;
  private statusDirty = false;
  private stopResult: StopResult | null = null;
  private lastReset: SensorResetMessage | null = null;

  constructor(env: RuntimeEnv) {
    this.env = env;
    this.hooks.onObserverError = () => {
      this.statusDirty = true;
      this.scheduleFlush();
    };
    this.bootAt = env.now();
    this.currentBootId = makeBootId(env);
    if (env.startedLate) this.addFlag('late-start');
  }

  get earlyCaptureGuaranteed(): boolean { return this.env.earlyCaptureGuaranteed === true && !this.env.startedLate; }

  // -------------------------------------------------------------------------
  // Hooks
  // -------------------------------------------------------------------------

  /** Registers wrap results: installed handles for ownership-checked restore, unsupported ones as coverage flags. */
  attach(results: readonly WrapResult[]): void {
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      if (r.status === 'installed') {
        if (!arrayIncludes(this.handles, r)) arrayPush(this.handles, r);
      } else {
        this.unsupportedHooks++;
        this.addFlag(r.coverageFlag);
      }
    }
  }

  addFlag(flag: CoverageFlag): void {
    if (setHas(this.flags, flag)) return;
    setAdd(this.flags, flag);
    arrayPush(this.flagDelta, flag);
    this.statusDirty = true;
  }

  // -------------------------------------------------------------------------
  // Hot path
  // -------------------------------------------------------------------------

  /**
   * Increments the counter for (technique index, phase index, signal mask). Hot path: no string work for an
   * existing key and no clock read per call — the clock is read once per aggregate per flush window (when the
   * entry turns dirty), so `intervalBucket` is the bucket of the first increment since the previous flush;
   * later increments in that window are at most one bucket (250 ms) later. Local ordering only (contract).
   */
  record(techniqueIndex: number, phaseIndex: number, signalMask: number): void {
    if (!this.hooks.enabled) return;
    const key = compositeKey(techniqueIndex, phaseIndex, signalMask);
    let entry: CounterEntry | undefined = mapGet(this.counters, key);
    if (entry === undefined) {
      const created = this.createEntry(key, techniqueIndex);
      if (created === null) return;
      entry = created;
    }
    if (entry.count < MAX_COUNT) entry.count++;
    else entry.countQuality = 'lower-bound';
    if (!entry.dirty) {
      entry.lastBucket = this.bucket();
      arrayPush(this.dirty, entry);
      entry.dirty = true;
    }
    this.scheduleFlush();
  }

  private bucket(): number {
    const b = floor((this.env.now() - this.bootAt) / BUCKET_MS);
    return b > MAX_COUNT ? MAX_COUNT : b > 0 ? b : 0;
  }

  /** New key: bounded by the startup queue before handshake and by maxCountersPerDocumentGroup after. */
  private createEntry(key: number, techniqueIndex: number): CounterEntry | null {
    const limit = this.handshake ? BUDGETS.maxCountersPerDocumentGroup : STARTUP_QUEUE_MAX;
    if (mapSize(this.counters) >= limit) {
      // Overflow: fold into the technique's least specific key ("attempted", no signal codes) when it exists,
      // as a lower bound; otherwise the observation is dropped and reported via droppedSinceLast.
      const fold = mapGet(this.counters, compositeKey(techniqueIndex, PHASE_ATTEMPTED, 0));
      this.addFlag('budget-exceeded');
      if (fold !== undefined) {
        fold.countQuality = 'lower-bound';
        return fold;
      }
      if (this.dropped < MAX_COUNT) this.dropped++;
      this.statusDirty = true;
      this.scheduleFlush();
      return null;
    }
    const decoded = decodeKey(key);
    if (decoded === null) return null;
    const entry: CounterEntry = {
      techniqueId: decoded.techniqueId,
      phase: decoded.phase,
      signalCodes: decoded.signalCodes,
      count: 0,
      countQuality: 'exact',
      lastBucket: 0,
      dirty: false,
    };
    mapSet(this.counters, key, entry);
    return entry;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Subscribes to bridge messages and announces the sensor. Idempotent. */
  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    this.env.addEventListener('message', this.onMessage);
    this.env.addEventListener('pagehide', this.onPageHide);
    this.postHello();
  }

  private postHello(): void {
    const hello: SensorHelloMessage = {
      channel: CHANNEL,
      sensorBootId: this.sensorBootId,
      type: 'sensor-hello',
      protocolVersion: PROTOCOL_VERSION,
      startedLate: this.env.startedLate,
      coverageFlags: setArray(this.flags),
    };
    this.post(hello);
  }

  /** ADR-073: a routing reset changes only our bounded aggregates, never page API results or policy. */
  private reset(resetId: string): void {
    if (this.stopped) return;
    if (this.lastReset?.resetId === resetId) { this.post(this.lastReset); this.postHello(); return; }
    const oldBoot = this.sensorBootId;
    this.cancelTimer();
    clearMap(this.counters);
    this.dirty.length = 0;
    this.dropped = 0;
    deleteSet(this.flags, 'budget-exceeded');
    deleteSet(this.flags, 'channel-gap');
    deleteSet(this.flags, 'truncated');
    this.flagDelta = [];
    this.sensorSeq = 0;
    this.historyEpoch = {};
    this.bootAt = this.env.now();
    this.currentBootId = makeBootId(this.env).slice(0, 20) + '-' + resetId.slice(-32);
    this.handshake = false;
    this.lastReset = { channel: CHANNEL, type: 'sensor-reset', sensorBootId: oldBoot, resetId, nextSensorBootId: this.sensorBootId, coverageFlags: setArray(this.flags) };
    this.post(this.lastReset);
    this.postHello();
  }

  pause(): void {
    if (this.paused || this.stopped) return;
    this.paused = true;
    this.historyEpoch = {};
    this.hooks.enabled = false;
    this.cancelTimer();
    this.addFlag('paused');
    if (this.handshake) this.postStatus();
  }

  resume(): void {
    if (!this.paused || this.stopped) return;
    this.paused = false;
    this.hooks.enabled = true;
    this.statusDirty = true;
    if (this.handshake) {
      this.postStatus();
      if (this.dirty.length > 0) this.scheduleFlush();
    }
  }

  /**
   * Stops observing, posts the final aggregate when the bridge can still take it, restores hooks whose
   * descriptor we still own, and reports which ones stayed (the page must be reloaded to remove them).
   */
  stop(reason: BridgeStopReason | 'local'): StopResult {
    if (this.stopResult !== null) return this.stopResult;
    if (reason === 'revoked') this.addFlag('revoked');
    if (reason === 'protocol-mismatch') this.addFlag('protocol-mismatch');
    if (this.handshake && !this.paused && reason !== 'protocol-mismatch') this.flush();
    this.stopped = true;
    this.hooks.enabled = false;
    this.cancelTimer();
    const restored: string[] = [];
    const notRestored: string[] = [];
    for (let i = 0; i < this.handles.length; i++) {
      const h = this.handles[i]!;
      arrayPush(h.restore() ? restored : notRestored, h.label);
    }
    this.postStatus(); // F047: final status also before a completed handshake.
    if (this.started) {
      this.env.removeEventListener('message', this.onMessage);
      this.env.removeEventListener('pagehide', this.onPageHide);
    }
    this.stopResult = {
      reason,
      restored,
      notRestored,
      cleanup: this.handles.length === 0 ? 'none' : notRestored.length === 0 ? 'complete' : 'partial',
    };
    return this.stopResult;
  }

  snapshot(): RuntimeSnapshot {
    const counters: RuntimeSnapshot['counters'] = [];
    mapForEach(this.counters, (e) => {
      arrayPush(counters, {
        techniqueId: e.techniqueId,
        phase: e.phase,
        signalCodes: arraySlice(e.signalCodes),
        count: e.count,
        countQuality: e.countQuality,
        lastBucket: e.lastBucket,
      });
    });
    return {
      counters,
      size: mapSize(this.counters),
      dropped: this.dropped,
      flags: setArray(this.flags),
      state: this.state(),
      handshake: this.handshake,
      sensorSeq: this.sensorSeq,
      observerErrors: this.hooks.observerErrors,
    };
  }

  // -------------------------------------------------------------------------
  // Bridge messages (page-forgeable: routing only, REQ-004)
  // -------------------------------------------------------------------------

  private readonly onMessage = (event: unknown): void => {
    try {
      if (typeof event !== 'object' || event === null) return;
      const { source, data } = this.env.readMessage(event);
      if (source !== this.env.self) return;
      if (typeof data !== 'object' || data === null) return;
      if ((data as { channel?: unknown }).channel !== CHANNEL) return;
      const result = validateBridgeMessage(data);
      if (!result.ok) return;
      const msg = result.value;
      if (msg.type === 'bridge-reset') {
        if (msg.sensorBootId === this.sensorBootId || (this.lastReset?.resetId === msg.resetId && msg.sensorBootId === this.lastReset.sensorBootId)) this.reset(msg.resetId);
        return;
      }
      if (msg.sensorBootId === UNBOUND_SENSOR_BOOT_ID) {
        // The bridge started after our hello (both worlds start independently, ADR-004 §9): announce again so
        // it can answer with a hello bound to this boot. Cheap and bounded on the bridge side (one reply per
        // boot); the page can only make us repeat a hello, never skip the handshake.
        if (msg.type === 'bridge-hello' && !this.handshake && !this.stopped) this.postHello();
        return;
      }
      if (msg.sensorBootId !== this.sensorBootId) return;
      switch (msg.type) {
        case 'bridge-hello':
          if (this.handshake || this.stopped) return;
          if (msg.protocolVersion !== PROTOCOL_VERSION) {
            // F047 / ADR-004: only bridge-stop handles incompatibility; hello is unauthenticated.
            return;
          }
          this.handshake = true;
          if (msg.paused) this.pause();
          else if (this.dirty.length > 0 || this.statusDirty || this.dropped > 0) this.flush();
          return;
        case 'bridge-pause':
          this.pause();
          return;
        case 'bridge-resume':
          this.resume();
          return;
        case 'bridge-stop':
          this.stop(msg.reason);
          return;
        default:
          return;
      }
    } catch {
      // A malformed or hostile event must never throw into the page's event loop.
    }
  };

  private readonly onPageHide = (): void => {
    // One final aggregate when the document goes away (spec III §3.4); hooks stay for a BFCache restore.
    if (this.handshake && !this.paused && !this.stopped) this.flush();
  };

  // -------------------------------------------------------------------------
  // Emission
  // -------------------------------------------------------------------------

  private readonly onTimer = (): void => {
    this.timer = null;
    this.flush();
  };

  private scheduleFlush(): void {
    if (this.timerFailed || this.timer !== null || !this.handshake || this.paused || this.stopped) return;
    try {
      this.timer = this.env.setTimeout(this.onTimer, FLUSH_MS);
    } catch {
      this.timerFailed = true;
      this.reportEmissionError();
    }
  }

  private cancelTimer(): void {
    if (this.timer === null) return;
    this.env.clearTimeout(this.timer);
    this.timer = null;
  }

  /** Posts every dirty aggregate (cumulative totals; the SW merges by max) in batches of <= 32. */
  flush(): void {
    try {
      this.flushPending();
    } catch {
      // F049: preserve pending totals, report a gap, and never retry indefinitely or escape into the page.
      this.reportEmissionError();
    }
  }

  private reportEmissionError(): void {
    if (this.hooks.observerErrors < MAX_COUNT) this.hooks.observerErrors++;
    this.statusDirty = true;
    try {
      this.addFlag('hook-failed');
      this.postStatus();
    } catch { /* Failure reporting must not escape into the page or schedule recursive retries. */ }
  }

  private flushPending(): void {
    this.cancelTimer();
    if (!this.handshake || this.paused || this.stopped) return;
    if (this.hooks.observerErrors > this.reportedObserverErrors) {
      this.reportedObserverErrors = this.hooks.observerErrors;
      this.addFlag('hook-failed');
    }
    for (let emitted = 0; this.dirty.length > 0 && emitted < BUDGETS.maxCountersPerDocumentGroup; emitted += BUDGETS.maxBatchEvents) {
      const chunk = arraySlice(this.dirty, 0, BUDGETS.maxBatchEvents);
      const observations: PageObservation[] = [];
      for (let i = 0; i < chunk.length; i++) {
        const e = chunk[i]!;
        arrayPush(observations, {
          techniqueId: e.techniqueId,
          count: e.count,
          countQuality: e.countQuality,
          phase: e.phase,
          signalCodes: arraySlice(e.signalCodes),
          intervalBucket: e.lastBucket,
        });
      }
      if (this.sensorSeq < MAX_COUNT) this.sensorSeq++;
      const batch: SensorBatchMessage = {
        channel: CHANNEL,
        sensorBootId: this.sensorBootId,
        type: 'sensor-batch',
        sensorSeq: this.sensorSeq,
        observations,
        coverageDelta: this.flagDelta,
      };
      if (!this.post(batch)) throw new Error('sensor post failed');
      this.flagDelta = [];
      arraySplice(this.dirty, 0, chunk.length);
      for (let i = 0; i < chunk.length; i++) chunk[i]!.dirty = false;
    }
    if (this.statusDirty || this.dropped > 0) this.postStatus();
  }

  private state(): SensorState {
    if (this.stopped) return 'stopped';
    if (this.paused) return 'paused';
    return this.unsupportedHooks > 0 || this.hooks.observerErrors > 0 ? 'degraded' : 'active';
  }

  private postStatus(): void {
    const status: SensorStatusMessage = {
      channel: CHANNEL,
      sensorBootId: this.sensorBootId,
      type: 'sensor-status',
      state: this.state(),
      coverageFlags: setArray(this.flags),
      droppedSinceLast: this.dropped,
    };
    if (this.post(status)) {
      this.dropped = 0;
      this.statusDirty = false;
    }
  }

  private post(message: SensorHelloMessage | SensorBatchMessage | SensorStatusMessage | SensorResetMessage): boolean {
    try {
      this.env.postMessage(message);
      return true;
    } catch {
      // The page may have broken postMessage; do not retry on a timer.
      return false;
    }
  }
}
