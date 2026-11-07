// ADR-020 §F (S10): MAIN runtime of the module «Защита» (protect.main.js). Owns the module boot id, the bounded queue
// of send samples, the registration aggregates (≤ maxRegistrationKeysPerRealm keys with saturating counts), the
// handshake with the ISOLATED relay on the module channel and the pause / resume / stop protocol. Everything posted
// here is page-controlled by definition (REQ-004): the relay validates it again and the SW never trusts it for
// identity. Only ScriptRef (masked host + safe path template), enums and counters cross the channel: never an argument,
// a value, a URL, a raw stack or a function name (REQ-005, ADR-020 §4).
// Bounds: batches ≤ maxItemsPerBatch items and ≤ BUDGETS.maxBatchBytes (estimated from string lengths, never
// serialized), flush every flushMs, at most startupQueueItems pending sends (before and after the handshake), at most
// MAX_BATCHES_PER_FLUSH batches per flush; overflow -> `dropped` + `budget-exceeded` (REQ-011). The relay protocol
// (FOLLOWUPS 93): an unbound protect-relay-hello makes the runtime repeat its protect-main-hello until the bound
// relay-hello arrives. stop() restores only the hooks whose descriptor still holds our wrapper (REQ-012).

import { BUDGETS, LISTEN_EVENT_CODES, LISTEN_TARGET_KINDS, MAX_COUNT, PROTECT_BUDGETS, PROTECT_CHANNEL, PROTECT_MAIN_PROTOCOL_VERSION, PROTECT_WIRE_LIMITS, UNBOUND_SENSOR_BOOT_ID, validateProtectRelayMessage } from '@detect-expert/contracts';
import type {
  BridgeStopReason,
  ListenEventCode,
  ListenTargetKind,
  ProtectLimitation,
  ProtectMainBatchMessage,
  ProtectMainHelloMessage,
  ProtectRegistrationHookPoint,
  ProtectSendHookPoint,
  RegistrationSampleWire,
  ScriptRef,
  SendSampleWire,
  SendTarget,
} from '@detect-expert/contracts';
import { scriptRefKey } from '../../../attribution/src/script-ref';
import { arrayPush } from '../intrinsics';
import type { RuntimeEnv } from '../runtime';
import { createHookContext } from '../wrap';
import type { HookContext, HookHandle, WrapResult } from '../wrap';

const floor = Math.floor;
const NativeMap = Map;
const mapGet = Function.prototype.call.bind(Map.prototype.get) as <K, V>(m: Map<K, V>, k: K) => V | undefined;
const mapSet = Function.prototype.call.bind(Map.prototype.set) as <K, V>(m: Map<K, V>, k: K, v: V) => unknown;
const mapSize = Function.prototype.call.bind(Object.getOwnPropertyDescriptor(Map.prototype, 'size')!.get!) as (m: Map<unknown, unknown>) => number;

/** Batches per flush at most (≤ 32 pending sends + ≤ 64 dirty registration keys). */
export const MAX_BATCHES_PER_FLUSH = 3;
/** Upper bound of one batch's JSON envelope (channel, ids, dropped, ≤ 8 limitations) in characters. */
const ENVELOPE_BYTES = 700;
/** Upper bound of the fixed part of one send / registration item (keys, enums, numbers, the script's own keys). */
const ITEM_BYTES = 220;

const UNKNOWN_REF: ScriptRef = Object.freeze({ kind: 'unknown' }) as ScriptRef;

/** Index constants of the registration key (no strings on the hot path). */
export const HOOK_LISTEN = 0;
export const HOOK_OBSERVE = 1;
export const TARGET_INDEX: Readonly<Record<ListenTargetKind, number>> = Object.freeze({ window: 0, document: 1, root: 2, field: 3, 'field-password': 4, other: 5 });

interface RegistrationAggregate {
  hookPoint: ProtectRegistrationHookPoint;
  eventCode: ListenEventCode | null;
  targetKind: ListenTargetKind;
  scriptId: number;
  sampled: boolean;
  count: number;
  tMs: number;
  dirty: boolean;
}

export interface ProtectMainRuntimeOptions {
  /** PROTECT_MAIN_GROUPS mask the prelude enabled for this document. */
  groups: number;
  startedLate: boolean;
}

export interface ProtectStopResult {
  reason: BridgeStopReason | 'local';
  restored: string[];
  notRestored: string[];
  cleanup: 'complete' | 'partial' | 'none';
}

/** Numbers only (tests, the perf probe): never a sample, a host or a path. */
export interface ProtectMainSnapshot {
  state: 'idle' | 'running' | 'paused' | 'stopped';
  handshake: boolean;
  pendingSends: number;
  registrationKeys: number;
  dirtyRegistrations: number;
  batchSeq: number;
  sendSeq: number;
  dropped: { sends: number; registrations: number; unsampled: number };
  limitations: ProtectLimitation[];
  observerErrors: number;
  hooks: number;
  scripts: number;
}

function satInc(n: number): number {
  return n < MAX_COUNT ? n + 1 : MAX_COUNT;
}

function refBytes(ref: ScriptRef): number {
  return 64 + (ref.host?.length ?? 0) + (ref.pathTemplate?.length ?? 0);
}

function targetBytes(t: SendTarget): number {
  return 40 + (t.kind === 'absolute' ? t.host.length : 0);
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

export class ProtectMainRuntime {
  readonly sensorBootId: string;
  /** Shared with every hook of the module; `enabled` is the pause switch (originals always run). */
  readonly hooks: HookContext = createHookContext();
  private readonly env: RuntimeEnv;
  private readonly groups: number;
  private readonly startedLate: boolean;
  private readonly handles: HookHandle[] = [];
  private readonly sends: SendSampleWire[] = [];
  private readonly registrations = new NativeMap<number, RegistrationAggregate>();
  private readonly dirty: RegistrationAggregate[] = [];
  /** Interned ScriptRefs of registrations (index = id; 0 = unknown). */
  private readonly scripts: ScriptRef[] = [UNKNOWN_REF];
  private readonly scriptIds = new NativeMap<string, number>();
  private readonly limitations: ProtectLimitation[] = [];
  private readonly reported: ProtectLimitation[] = [];
  private dropped = { sends: 0, registrations: 0, unsampled: 0 };
  private batchSeq = 0;
  private sendSeq = 0;
  private timer: unknown = null;
  private timerFailed = false;
  private handshake = false;
  private paused = false;
  private stopped = false;
  private started = false;
  private stopResult: ProtectStopResult | null = null;

  constructor(env: RuntimeEnv, options: ProtectMainRuntimeOptions) {
    this.env = env;
    this.groups = options.groups;
    this.startedLate = options.startedLate;
    this.sensorBootId = makeBootId(env);
  }

  // ---------------------------------------------------------------------------
  // Hooks
  // ---------------------------------------------------------------------------

  /** Installed handles are kept for the ownership-checked restore; an unsupported hook adds `limitation` (if any). */
  attach(results: readonly WrapResult[], limitation: ProtectLimitation | null = null): number {
    let installed = 0;
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      if (r.status === 'installed') {
        arrayPush(this.handles, r);
        installed++;
      } else if (limitation !== null) this.addLimitation(limitation);
    }
    return installed;
  }

  get hookCount(): number {
    return this.handles.length;
  }

  /** A limitation code reported once per boot (≤ maxEventLimitations distinct codes). */
  addLimitation(code: ProtectLimitation): void {
    for (let i = 0; i < this.reported.length; i++) if (this.reported[i] === code) return;
    if (this.reported.length >= PROTECT_WIRE_LIMITS.maxEventLimitations) return;
    arrayPush(this.reported, code);
    arrayPush(this.limitations, code);
    this.scheduleFlush();
  }

  /** Small integer id of a sampled ScriptRef (registration keys and the listener cache); -1 when the table is full. */
  internScript(ref: ScriptRef): number {
    if (ref.kind === 'unknown') return 0;
    const key = scriptRefKey(ref);
    const known = mapGet(this.scriptIds, key);
    if (known !== undefined) return known;
    if (this.scripts.length > PROTECT_BUDGETS.maxRegistrationKeysPerRealm) return -1;
    const id = this.scripts.length;
    arrayPush(this.scripts, ref);
    mapSet(this.scriptIds, key, id);
    return id;
  }

  // ---------------------------------------------------------------------------
  // Hot path (observers). No string work beyond what the sample needs; the clock is read once per sample.
  // ---------------------------------------------------------------------------

  private pageTime(): number {
    const t = floor(this.env.now() / 10) * 10;
    return t > 0 ? (t < MAX_COUNT ? t : MAX_COUNT - (MAX_COUNT % 10)) : 0;
  }

  /** One observed send call (the original already returned). */
  noteSend(hookPoint: ProtectSendHookPoint, script: ScriptRef, sampled: boolean, target: SendTarget): void {
    if (this.stopped) return;
    this.sendSeq = satInc(this.sendSeq);
    if (this.sends.length >= PROTECT_BUDGETS.startupQueueItems) {
      // A lost sample still took its sequence number: the SW sees the gap.
      if (sampled) this.dropped.sends = satInc(this.dropped.sends);
      else this.dropped.unsampled = satInc(this.dropped.unsampled);
      this.addLimitation('budget-exceeded');
      return;
    }
    // Literals define own data properties: an inherited page setter never sees these values.
    arrayPush(this.sends, { hookPoint, sensorSeq: this.sendSeq, script, sampled, target, tMs: this.pageTime() });
    this.scheduleFlush();
  }

  /**
   * One listener / observer registration folded into its aggregate (hook, event, target kind, script id, sampled).
   * `eventIndex` is the LISTEN_EVENT_CODES index, -1 for observe-document.
   */
  noteRegistration(hook: number, eventIndex: number, targetIndex: number, scriptId: number, sampled: boolean): void {
    if (this.stopped) return;
    const key = ((((scriptId < 0 ? 0 : scriptId) * 2 + (sampled ? 1 : 0)) * 8 + targetIndex) * 32 + (eventIndex + 1)) * 2 + hook;
    let agg = mapGet(this.registrations, key);
    if (agg === undefined) {
      if (mapSize(this.registrations) >= PROTECT_BUDGETS.maxRegistrationKeysPerRealm) {
        this.dropped.registrations = satInc(this.dropped.registrations);
        this.addLimitation('budget-exceeded');
        return;
      }
      const eventCode = eventIndex >= 0 ? (LISTEN_EVENT_CODES[eventIndex] ?? null) : null;
      const targetKind = LISTEN_TARGET_KINDS[targetIndex] ?? 'other';
      agg = {
        hookPoint: hook === HOOK_LISTEN ? 'listen' : 'observe-document',
        eventCode,
        targetKind,
        scriptId: scriptId < 0 ? 0 : scriptId,
        sampled,
        count: 0,
        tMs: 0,
        dirty: false,
      };
      mapSet(this.registrations, key, agg);
    }
    agg.count = satInc(agg.count);
    if (!agg.dirty) {
      agg.dirty = true;
      agg.tMs = this.pageTime();
      arrayPush(this.dirty, agg);
      this.scheduleFlush();
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Subscribes to relay messages and announces the module boot. Idempotent. */
  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    this.env.addEventListener('message', this.onMessage);
    this.env.addEventListener('pagehide', this.onPageHide);
    this.postHello();
  }

  private postHello(): void {
    const hello: ProtectMainHelloMessage = {
      channel: PROTECT_CHANNEL,
      sensorBootId: this.sensorBootId,
      type: 'protect-main-hello',
      protocolVersion: PROTECT_MAIN_PROTOCOL_VERSION,
      startedLate: this.startedLate,
      groups: this.groups,
    };
    this.post(hello);
  }

  pause(): void {
    if (this.paused || this.stopped) return;
    this.paused = true;
    this.hooks.enabled = false;
    this.cancelTimer();
  }

  resume(): void {
    if (!this.paused || this.stopped) return;
    this.paused = false;
    this.hooks.enabled = true;
    if (this.handshake) this.scheduleFlush();
  }

  /** Stops observing and restores the hooks whose descriptor still holds our wrapper (REQ-012). Idempotent. */
  stop(reason: BridgeStopReason | 'local'): ProtectStopResult {
    if (this.stopResult !== null) return this.stopResult;
    this.stopped = true;
    this.hooks.enabled = false;
    this.cancelTimer();
    const restored: string[] = [];
    const notRestored: string[] = [];
    for (let i = 0; i < this.handles.length; i++) {
      const h = this.handles[i]!;
      arrayPush(h.restore() ? restored : notRestored, h.label);
    }
    if (this.started) {
      try {
        this.env.removeEventListener('message', this.onMessage);
        this.env.removeEventListener('pagehide', this.onPageHide);
      } catch {
        // The listeners see `stopped` and return.
      }
    }
    this.sends.length = 0;
    this.dirty.length = 0;
    this.stopResult = {
      reason,
      restored,
      notRestored,
      cleanup: restored.length + notRestored.length === 0 ? 'none' : notRestored.length === 0 ? 'complete' : 'partial',
    };
    return this.stopResult;
  }

  snapshot(): ProtectMainSnapshot {
    const limitations: ProtectLimitation[] = [];
    for (let i = 0; i < this.reported.length; i++) arrayPush(limitations, this.reported[i]!);
    return {
      state: this.stopped ? 'stopped' : this.paused ? 'paused' : this.started ? 'running' : 'idle',
      handshake: this.handshake,
      pendingSends: this.sends.length,
      registrationKeys: mapSize(this.registrations),
      dirtyRegistrations: this.dirty.length,
      batchSeq: this.batchSeq,
      sendSeq: this.sendSeq,
      dropped: { sends: this.dropped.sends, registrations: this.dropped.registrations, unsampled: this.dropped.unsampled },
      limitations,
      observerErrors: this.hooks.observerErrors,
      hooks: this.handles.length,
      scripts: this.scripts.length - 1,
    };
  }

  // ---------------------------------------------------------------------------
  // Relay messages (page-forgeable: routing only, REQ-004)
  // ---------------------------------------------------------------------------

  private readonly onMessage = (event: unknown): void => {
    try {
      if (this.stopped || typeof event !== 'object' || event === null) return;
      const { source, data } = this.env.readMessage(event);
      if (source !== this.env.self || typeof data !== 'object' || data === null) return;
      if ((data as { channel?: unknown }).channel !== PROTECT_CHANNEL) return;
      const result = validateProtectRelayMessage(data);
      if (!result.ok) return;
      const msg = result.value;
      if (msg.sensorBootId === UNBOUND_SENSOR_BOOT_ID) {
        // The relay started after our hello (both worlds start independently): announce again so it can bind.
        if (msg.type === 'protect-relay-hello' && !this.handshake) this.postHello();
        return;
      }
      if (msg.sensorBootId !== this.sensorBootId) return;
      switch (msg.type) {
        case 'protect-relay-hello':
          if (this.handshake || msg.protocolVersion !== PROTECT_MAIN_PROTOCOL_VERSION) return;
          this.handshake = true;
          if (msg.paused) this.pause();
          else this.flush();
          return;
        case 'protect-relay-pause':
          this.pause();
          return;
        case 'protect-relay-resume':
          this.resume();
          return;
        case 'protect-relay-stop':
          this.stop(msg.reason);
          return;
      }
    } catch {
      // A malformed or hostile event must never throw into the page's event loop.
    }
  };

  private readonly onPageHide = (): void => {
    // One final flush when the document goes away; hooks stay for a BFCache restore.
    if (this.handshake && !this.paused && !this.stopped) this.flush();
  };

  // ---------------------------------------------------------------------------
  // Emission
  // ---------------------------------------------------------------------------

  private readonly onTimer = (): void => {
    this.timer = null;
    this.flush();
  };

  private scheduleFlush(): void {
    if (this.timerFailed || this.timer !== null || !this.handshake || this.paused || this.stopped) return;
    try {
      this.timer = this.env.setTimeout(this.onTimer, PROTECT_BUDGETS.flushMs);
    } catch {
      this.timerFailed = true;
    }
  }

  private cancelTimer(): void {
    if (this.timer === null) return;
    try {
      this.env.clearTimeout(this.timer);
    } catch {
      // A broken clearTimeout leaves a timer that finds nothing to do.
    }
    this.timer = null;
  }

  private hasWork(): boolean {
    const d = this.dropped;
    return this.sends.length > 0 || this.dirty.length > 0 || this.limitations.length > 0 || d.sends > 0 || d.registrations > 0 || d.unsampled > 0;
  }

  /** Posts pending samples in batches of ≤ maxItemsPerBatch items and ≤ maxBatchBytes; never throws. */
  flush(): void {
    try {
      this.cancelTimer();
      if (!this.handshake || this.paused || this.stopped) return;
      for (let n = 0; n < MAX_BATCHES_PER_FLUSH && this.hasWork(); n++) if (!this.postBatch()) return;
      if (this.hasWork()) this.scheduleFlush();
    } catch {
      // Pending samples stay; the next sample schedules another attempt (no retry loop).
    }
  }

  private postBatch(): boolean {
    const sends: SendSampleWire[] = [];
    const registrations: RegistrationSampleWire[] = [];
    let bytes = ENVELOPE_BYTES;
    let takenSends = 0;
    let takenRegs = 0;
    const max = PROTECT_BUDGETS.maxItemsPerBatch;
    while (takenSends < this.sends.length && sends.length + registrations.length < max) {
      const s = this.sends[takenSends]!;
      const size = ITEM_BYTES + refBytes(s.script) + targetBytes(s.target) + 1;
      if (bytes + size > BUDGETS.maxBatchBytes) break;
      bytes += size;
      arrayPush(sends, s);
      takenSends++;
    }
    while (takenRegs < this.dirty.length && sends.length + registrations.length < max) {
      const a = this.dirty[takenRegs]!;
      const script = this.scripts[a.scriptId] ?? UNKNOWN_REF;
      const size = ITEM_BYTES + refBytes(script) + 1;
      if (bytes + size > BUDGETS.maxBatchBytes) break;
      bytes += size;
      arrayPush(
        registrations,
        a.eventCode === null
          ? { hookPoint: a.hookPoint, targetKind: a.targetKind, script, sampled: a.sampled, count: a.count, tMs: a.tMs }
          : { hookPoint: a.hookPoint, eventCode: a.eventCode, targetKind: a.targetKind, script, sampled: a.sampled, count: a.count, tMs: a.tMs },
      );
      takenRegs++;
    }
    const limitations: ProtectLimitation[] = [];
    for (let i = 0; i < this.limitations.length; i++) arrayPush(limitations, this.limitations[i]!);
    const batch: ProtectMainBatchMessage = {
      channel: PROTECT_CHANNEL,
      sensorBootId: this.sensorBootId,
      type: 'protect-main-batch',
      sensorSeq: satInc(this.batchSeq),
      sends,
      registrations,
      dropped: { sends: this.dropped.sends, registrations: this.dropped.registrations, unsampled: this.dropped.unsampled },
      limitations,
    };
    if (!this.post(batch)) return false;
    this.batchSeq = batch.sensorSeq;
    // Compact by index (no page-patchable splice / @@species).
    const remaining = this.sends.length - takenSends;
    for (let i = 0; i < remaining; i++) this.sends[i] = this.sends[i + takenSends]!;
    this.sends.length = remaining;
    for (let i = 0; i < takenRegs; i++) {
      const a = this.dirty[i]!;
      a.dirty = false;
      a.count = 0;
    }
    const left = this.dirty.length - takenRegs;
    for (let i = 0; i < left; i++) this.dirty[i] = this.dirty[i + takenRegs]!;
    this.dirty.length = left;
    this.limitations.length = 0;
    this.dropped = { sends: 0, registrations: 0, unsampled: 0 };
    return true;
  }

  private post(message: ProtectMainHelloMessage | ProtectMainBatchMessage): boolean {
    try {
      this.env.postMessage(message);
      return true;
    } catch {
      // The page may have broken postMessage; no retry on a timer.
      return false;
    }
  }
}
