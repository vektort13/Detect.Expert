// MAIN <-> ISOLATED relay of the module «Защита» (ADR-020 §A, §F; S05). A separate window listener on the module's own
// channel `detect.expert/protect/v1`; bridge.js and its channel do not change. Everything from MAIN is page-controlled
// (REQ-004): `event.source === window`, the channel tag, sensorBootId and relaySessionId are routing, not
// authentication. Cheap shape checks first, then validateProtectMainMessage. Sample times are page-clock tMs; the
// relay turns them into ageMs on the ISOLATED clock (shared timeOrigin, SP-12) when it sends: samples from the future
// (> +50 ms) or older than maxSampleAgeMs are dropped into `dropped`. protect-events go to the SW at most 4 per second,
// ≤ 32 samples and ≤ 16 KiB each. This is the only module that posts to the page (scripts/build.mjs verifies it).

import {
  BUDGETS,
  MAX_COUNT,
  PROTECT_BUDGETS,
  PROTECT_CHANNEL,
  PROTECT_MAIN_PROTOCOL_VERSION,
  PROTECT_WIRE_LIMITS,
  UNBOUND_SENSOR_BOOT_ID,
  jsonLengthUpTo,
  validateProtectAck,
  validateProtectMainMessage,
} from '@detect-expert/contracts';
import type {
  BridgeStopReason,
  ProtectEventsMessage,
  ProtectLimitation,
  ProtectMainBatchMessage,
  ProtectMainDropped,
  ProtectMainHelloMessage,
  ProtectRelayMessage,
  RegistrationSampleSw,
  RegistrationSampleWire,
  SendSampleSw,
  SendSampleWire,
} from '@detect-expert/contracts';
import type { ProtectEnv, ProtectTimer } from './env';
import { validatedValue } from './validated';

export const RELAY_HELLO_RETRIES = 10;
export const RELAY_HELLO_INTERVAL_MS = 100;
/** Bounded set of MAIN boots (re-injection races); a boot that already sent data is never evicted by hello churn. */
export const RELAY_MAX_BOOTS = 4;
export const RELAY_EVENTS_PER_SECOND = 4;
/** A sample whose page time is ahead of the ISOLATED clock by more than this is dropped. */
export const RELAY_FUTURE_SLACK_MS = 50;
/** Pending samples per boot while the SW budget is spent; beyond it samples are dropped (budget-exceeded). */
export const RELAY_MAX_PENDING_SAMPLES = 128;
/** A sensorSeq jump larger than this is refused (routing heuristic, as in the observation handshake). */
export const RELAY_MAX_SEQ_JUMP = 64;

/** The relay's only way to the page (ISOLATED -> MAIN). Must never throw. */
export function postRelayMessageToPage(message: ProtectRelayMessage): void {
  try {
    window.postMessage(message, '*');
  } catch {
    // Nothing to do: the relay never throws into the page.
  }
}

interface BootState {
  lastSeq: number;
  sends: SendSampleWire[];
  registrations: RegistrationSampleWire[];
  dropped: ProtectMainDropped;
  limitations: ProtectLimitation[];
}

export interface ProtectRelayOptions {
  /** The SW answered inactive (or the context is gone): the whole module stops in this document. */
  onInactive?(): void;
}

/** Numbers only (tests): never a sample, a host or a path. */
export interface ProtectRelaySnapshot {
  state: 'idle' | 'running' | 'stopped';
  paused: boolean;
  boots: number;
  pending: number;
  batchSeq: number;
  rejected: number;
  droppedFuture: number;
  droppedStale: number;
  droppedOverflow: number;
}

function satAdd(a: number, b: number): number {
  return Math.min(MAX_COUNT, a + b);
}

function zeroDropped(): ProtectMainDropped {
  return { sends: 0, registrations: 0, unsampled: 0 };
}

export class ProtectRelay {
  private state: 'idle' | 'running' | 'stopped' = 'idle';
  private paused = false;
  private readonly relaySessionId: string;
  private readonly boots = new Map<string, BootState>();
  private readonly sendTimes: number[] = [];
  private removeListener: (() => void) | null = null;
  private helloTimer: ProtectTimer | null = null;
  private helloTries = 0;
  private flushTimer: ProtectTimer | null = null;
  private batchSeq = 0;
  private rejected = 0;
  private droppedFuture = 0;
  private droppedStale = 0;
  private droppedOverflow = 0;

  constructor(
    private readonly env: ProtectEnv,
    private readonly post: (message: ProtectRelayMessage) => void,
    private readonly options: ProtectRelayOptions = {},
  ) {
    this.relaySessionId = env.randomId();
  }

  /** Listens on the module channel and announces itself (unbound hello, bounded retries until MAIN answers). */
  start(): void {
    if (this.state !== 'idle') return;
    this.state = 'running';
    this.removeListener = this.env.listenMessages((fromSelf, data) => this.guard(() => this.onWindowMessage(fromSelf, data)));
    this.helloTries = 1;
    this.postHello(UNBOUND_SENSOR_BOOT_ID);
    this.scheduleHelloRetry();
  }

  pause(): void {
    if (this.state !== 'running' || this.paused) return;
    this.paused = true;
    for (const sensorBootId of this.boots.keys()) this.post({ channel: PROTECT_CHANNEL, sensorBootId, type: 'protect-relay-pause' });
  }

  resume(): void {
    if (this.state !== 'running' || !this.paused) return;
    this.paused = false;
    for (const sensorBootId of this.boots.keys()) this.post({ channel: PROTECT_CHANNEL, sensorBootId, type: 'protect-relay-resume' });
    this.scheduleFlush();
  }

  /** protect-relay-stop to every known boot; the listener and timers go. */
  stop(reason: BridgeStopReason): void {
    if (this.state === 'stopped') return;
    const wasRunning = this.state === 'running';
    this.state = 'stopped';
    if (wasRunning) for (const sensorBootId of this.boots.keys()) this.post({ channel: PROTECT_CHANNEL, sensorBootId, type: 'protect-relay-stop', reason });
    this.boots.clear();
    try {
      this.removeListener?.();
    } catch {
      // The listener sees `stopped` and returns.
    }
    this.removeListener = null;
    if (this.helloTimer !== null) this.env.clearTimer(this.helloTimer);
    if (this.flushTimer !== null) this.env.clearTimer(this.flushTimer);
    this.helloTimer = null;
    this.flushTimer = null;
  }

  snapshot(): ProtectRelaySnapshot {
    let pending = 0;
    for (const boot of this.boots.values()) pending += boot.sends.length + boot.registrations.length;
    return {
      state: this.state,
      paused: this.paused,
      boots: this.boots.size,
      pending,
      batchSeq: this.batchSeq,
      rejected: this.rejected,
      droppedFuture: this.droppedFuture,
      droppedStale: this.droppedStale,
      droppedOverflow: this.droppedOverflow,
    };
  }

  private guard(fn: () => void): void {
    try {
      fn();
    } catch {
      // A malformed or hostile message must never throw into the page's event loop.
    }
  }

  // ---------------------------------------------------------------------------
  // Handshake (routing only)
  // ---------------------------------------------------------------------------

  private postHello(sensorBootId: string): void {
    this.post({
      channel: PROTECT_CHANNEL,
      sensorBootId,
      type: 'protect-relay-hello',
      protocolVersion: PROTECT_MAIN_PROTOCOL_VERSION,
      relaySessionId: this.relaySessionId,
      paused: this.paused,
    });
  }

  private scheduleHelloRetry(): void {
    if (this.state !== 'running' || this.boots.size > 0 || this.helloTries >= RELAY_HELLO_RETRIES) return;
    this.helloTimer = this.env.setTimer(() => {
      this.helloTimer = null;
      if (this.state !== 'running' || this.boots.size > 0) return;
      this.helloTries++;
      this.postHello(UNBOUND_SENSOR_BOOT_ID);
      this.scheduleHelloRetry();
    }, RELAY_HELLO_INTERVAL_MS);
  }

  private onWindowMessage(fromSelf: boolean, data: unknown): void {
    if (!fromSelf || this.state !== 'running') return;
    // Cheap shape checks first: other channels and our own relay posts (echoed back by the window) stop here.
    if (typeof data !== 'object' || data === null) return;
    const head = data as { channel?: unknown; type?: unknown };
    if (head.channel !== PROTECT_CHANNEL) return;
    const type = head.type;
    if (type !== 'protect-main-hello' && type !== 'protect-main-batch') return;
    const r = validateProtectMainMessage(data);
    if (!r.ok) {
      this.rejected = satAdd(this.rejected, 1);
      return;
    }
    const message = validatedValue(r);
    if (message.type === 'protect-main-hello') this.onMainHello(message);
    else this.onMainBatch(message);
  }

  private onMainHello(message: ProtectMainHelloMessage): void {
    const id = message.sensorBootId;
    if (id === UNBOUND_SENSOR_BOOT_ID) {
      this.rejected = satAdd(this.rejected, 1);
      return;
    }
    if (message.protocolVersion !== PROTECT_MAIN_PROTOCOL_VERSION) {
      this.post({ channel: PROTECT_CHANNEL, sensorBootId: id, type: 'protect-relay-stop', reason: 'protocol-mismatch' });
      return;
    }
    if (this.boots.has(id)) return; // one bound answer per boot: the page can only make us repeat nothing
    if (this.boots.size >= RELAY_MAX_BOOTS) {
      let unused: string | null = null;
      for (const [bootId, boot] of this.boots) {
        if (boot.lastSeq === 0) {
          unused = bootId;
          break;
        }
      }
      if (unused === null) {
        this.rejected = satAdd(this.rejected, 1);
        return;
      }
      this.boots.delete(unused);
    }
    this.boots.set(id, { lastSeq: 0, sends: [], registrations: [], dropped: zeroDropped(), limitations: [] });
    if (this.helloTimer !== null) this.env.clearTimer(this.helloTimer);
    this.helloTimer = null;
    this.postHello(id);
  }

  private onMainBatch(message: ProtectMainBatchMessage): void {
    const boot = this.boots.get(message.sensorBootId);
    if (boot === undefined || message.sensorSeq <= boot.lastSeq || message.sensorSeq - boot.lastSeq > RELAY_MAX_SEQ_JUMP) {
      this.rejected = satAdd(this.rejected, 1);
      return;
    }
    boot.lastSeq = message.sensorSeq;
    boot.dropped = {
      sends: satAdd(boot.dropped.sends, message.dropped.sends),
      registrations: satAdd(boot.dropped.registrations, message.dropped.registrations),
      unsampled: satAdd(boot.dropped.unsampled, message.dropped.unsampled),
    };
    for (const code of message.limitations) this.addLimitation(boot, code);
    if (this.paused) {
      // Paused: nothing is relayed; the loss is reported as dropped once the relay resumes.
      boot.dropped.sends = satAdd(boot.dropped.sends, message.sends.length);
      let folded = 0;
      for (const r of message.registrations) folded = satAdd(folded, r.count);
      boot.dropped.registrations = satAdd(boot.dropped.registrations, folded);
      return;
    }
    const now = this.env.monotonicNow();
    for (const s of message.sends) {
      if (this.admit(s.tMs, now)) {
        if (boot.sends.length + boot.registrations.length < RELAY_MAX_PENDING_SAMPLES) boot.sends.push(s);
        else this.overflow(boot, 'sends', 1);
      } else boot.dropped.sends = satAdd(boot.dropped.sends, 1);
    }
    for (const r of message.registrations) {
      if (this.admit(r.tMs, now)) {
        if (boot.sends.length + boot.registrations.length < RELAY_MAX_PENDING_SAMPLES) boot.registrations.push(r);
        else this.overflow(boot, 'registrations', r.count);
      } else boot.dropped.registrations = satAdd(boot.dropped.registrations, r.count);
    }
    this.scheduleFlush();
  }

  /** Age check on the ISOLATED clock: not from the future (beyond the slack) and not older than maxSampleAgeMs. */
  private admit(tMs: number, now: number): boolean {
    if (tMs - now > RELAY_FUTURE_SLACK_MS) {
      this.droppedFuture = satAdd(this.droppedFuture, 1);
      return false;
    }
    if (now - tMs > PROTECT_BUDGETS.maxSampleAgeMs) {
      this.droppedStale = satAdd(this.droppedStale, 1);
      return false;
    }
    return true;
  }

  private overflow(boot: BootState, kind: 'sends' | 'registrations', count: number): void {
    this.droppedOverflow = satAdd(this.droppedOverflow, 1);
    boot.dropped[kind] = satAdd(boot.dropped[kind], count);
    this.addLimitation(boot, 'budget-exceeded');
  }

  private addLimitation(boot: BootState, code: ProtectLimitation): void {
    if (!boot.limitations.includes(code) && boot.limitations.length < PROTECT_WIRE_LIMITS.maxEventLimitations) boot.limitations.push(code);
  }

  // ---------------------------------------------------------------------------
  // protect-events to the SW (≤ 4/s, ≤ 32 samples, ≤ 16 KiB)
  // ---------------------------------------------------------------------------

  private scheduleFlush(delay = 0): void {
    if (this.flushTimer !== null || this.state !== 'running' || this.paused) return;
    this.flushTimer = this.env.setTimer(() => {
      this.flushTimer = null;
      this.guard(() => this.flush());
    }, delay);
  }

  private takeSendSlot(now: number): number {
    while (this.sendTimes.length > 0 && now - this.sendTimes[0]! >= 1000) this.sendTimes.shift();
    if (this.sendTimes.length < RELAY_EVENTS_PER_SECOND) {
      this.sendTimes.push(now);
      return 0;
    }
    return Math.max(1, this.sendTimes[0]! + 1000 - now);
  }

  private hasWork(boot: BootState): boolean {
    const d = boot.dropped;
    return boot.sends.length > 0 || boot.registrations.length > 0 || boot.limitations.length > 0 || d.sends > 0 || d.registrations > 0 || d.unsampled > 0;
  }

  private flush(): void {
    if (this.state !== 'running' || this.paused) return;
    for (const [sensorBootId, boot] of this.boots) {
      while (this.hasWork(boot)) {
        const wait = this.takeSendSlot(this.env.now());
        if (wait > 0) {
          this.scheduleFlush(wait);
          return;
        }
        const message = this.nextEvents(sensorBootId, boot);
        if (message !== null) this.send(message);
      }
    }
  }

  /**
   * One protect-events of a boot: samples in arrival order (sends, then registrations), each re-timed as ageMs now;
   * a sample that has become older than maxSampleAgeMs while waiting is dropped. Shrinks until it fits 16 KiB.
   */
  private nextEvents(sensorBootId: string, boot: BootState): ProtectEventsMessage | null {
    const now = this.env.monotonicNow();
    const sends: SendSampleSw[] = [];
    const registrations: RegistrationSampleSw[] = [];
    const max = PROTECT_BUDGETS.maxItemsPerBatch;
    while (sends.length + registrations.length < max && boot.sends.length > 0) {
      const s = boot.sends.shift()!;
      const ageMs = this.ageOf(s.tMs, now);
      if (ageMs === null) boot.dropped.sends = satAdd(boot.dropped.sends, 1);
      else sends.push({ hookPoint: s.hookPoint, sensorSeq: s.sensorSeq, script: s.script, sampled: s.sampled, target: s.target, ageMs });
    }
    while (sends.length + registrations.length < max && boot.registrations.length > 0) {
      const r = boot.registrations.shift()!;
      const ageMs = this.ageOf(r.tMs, now);
      if (ageMs === null) {
        boot.dropped.registrations = satAdd(boot.dropped.registrations, r.count);
        continue;
      }
      const sample: RegistrationSampleSw = { hookPoint: r.hookPoint, targetKind: r.targetKind, script: r.script, sampled: r.sampled, count: r.count, ageMs };
      if (r.eventCode !== undefined) sample.eventCode = r.eventCode;
      registrations.push(sample);
    }
    const build = (): ProtectEventsMessage => ({
      schemaVersion: 1,
      type: 'protect-events',
      sensorBootId,
      relaySessionId: this.relaySessionId,
      batchSeq: Math.min(MAX_COUNT, this.batchSeq + 1),
      sends,
      registrations,
      dropped: { ...boot.dropped },
      limitations: [...boot.limitations],
    });
    let message = build();
    // Over the byte budget: the newest samples go back to the front of the queues until the message fits.
    while (sends.length + registrations.length > 1 && jsonLengthUpTo(message, BUDGETS.maxBatchBytes) > BUDGETS.maxBatchBytes) {
      if (registrations.length > 0) this.requeueRegistration(boot, registrations.pop()!, now);
      else this.requeueSend(boot, sends.pop()!, now);
      message = build();
    }
    if (jsonLengthUpTo(message, BUDGETS.maxBatchBytes) > BUDGETS.maxBatchBytes) {
      // A single sample that does not fit cannot be valid: it is dropped, never sent truncated.
      boot.dropped.sends = satAdd(boot.dropped.sends, sends.length);
      for (const r of registrations) boot.dropped.registrations = satAdd(boot.dropped.registrations, r.count);
      sends.length = 0;
      registrations.length = 0;
      message = build();
    }
    if (sends.length === 0 && registrations.length === 0 && boot.limitations.length === 0 && boot.dropped.sends === 0 && boot.dropped.registrations === 0 && boot.dropped.unsampled === 0) {
      return null;
    }
    this.batchSeq = message.batchSeq;
    boot.dropped = zeroDropped();
    boot.limitations = [];
    return message;
  }

  private ageOf(tMs: number, now: number): number | null {
    const age = Math.round(now - tMs);
    if (age > PROTECT_BUDGETS.maxSampleAgeMs) {
      this.droppedStale = satAdd(this.droppedStale, 1);
      return null;
    }
    return age < 0 ? 0 : age;
  }

  private requeueSend(boot: BootState, s: SendSampleSw, now: number): void {
    boot.sends.unshift({ hookPoint: s.hookPoint, sensorSeq: s.sensorSeq, script: s.script, sampled: s.sampled, target: s.target, tMs: this.pageTime(s.ageMs, now) });
  }

  private requeueRegistration(boot: BootState, r: RegistrationSampleSw, now: number): void {
    const wire: RegistrationSampleWire = { hookPoint: r.hookPoint, targetKind: r.targetKind, script: r.script, sampled: r.sampled, count: r.count, tMs: this.pageTime(r.ageMs, now) };
    if (r.eventCode !== undefined) wire.eventCode = r.eventCode;
    boot.registrations.unshift(wire);
  }

  /** Back to a page-clock time (only for samples returned to the queue within the same flush). */
  private pageTime(ageMs: number, now: number): number {
    return Math.max(0, Math.round(now - ageMs));
  }

  private send(message: ProtectEventsMessage): void {
    this.env.sendToBackground(message).then(
      (raw) =>
        this.guard(() => {
          if (isInactive(raw)) this.options.onInactive?.();
        }),
      () =>
        this.guard(() => {
          // No retry; a dead context ends the module in this document.
          if (!this.env.isContextAlive()) this.options.onInactive?.();
        }),
    );
  }
}

/**
 * Review W1: the module stopped in this document while no relay had bound MAIN (an inactive or failed first hello:
 * excluded tab site, throttled hello, SW not ready, groups 0). protect.main.js may still have installed its hooks at
 * document_start: every MAIN boot that announces itself within the bounded hello window (RELAY_HELLO_RETRIES ×
 * RELAY_HELLO_INTERVAL_MS, ≤ RELAY_MAX_BOOTS boots) gets protect-relay-stop, so it restores its hooks. Routing only
 * (REQ-004): nothing is read from MAIN beyond the boot id, nothing goes to the SW. Returns a cancel function.
 */
export function stopUnboundMain(env: ProtectEnv, post: (message: ProtectRelayMessage) => void, reason: BridgeStopReason = 'revoked'): () => void {
  const relaySessionId = env.randomId();
  const stopped = new Set<string>();
  let done = false;
  let tries = 0;
  let timer: ProtectTimer | null = null;
  let remove: (() => void) | null = null;
  const finish = (): void => {
    if (done) return;
    done = true;
    if (timer !== null) env.clearTimer(timer);
    timer = null;
    try {
      remove?.();
    } catch {
      // The listener sees `done` and returns.
    }
    remove = null;
  };
  const hello = (): void => {
    if (done) return;
    if (tries >= RELAY_HELLO_RETRIES) {
      finish();
      return;
    }
    tries++;
    post({ channel: PROTECT_CHANNEL, sensorBootId: UNBOUND_SENSOR_BOOT_ID, type: 'protect-relay-hello', protocolVersion: PROTECT_MAIN_PROTOCOL_VERSION, relaySessionId, paused: true });
    timer = env.setTimer(() => {
      timer = null;
      hello();
    }, RELAY_HELLO_INTERVAL_MS);
  };
  try {
    remove = env.listenMessages((fromSelf, data) => {
      try {
        if (done || !fromSelf || typeof data !== 'object' || data === null) return;
        const head = data as { channel?: unknown; type?: unknown };
        if (head.channel !== PROTECT_CHANNEL || head.type !== 'protect-main-hello') return;
        const r = validateProtectMainMessage(data);
        if (!r.ok) return;
        const message = validatedValue(r);
        const id = message.sensorBootId;
        if (message.type !== 'protect-main-hello' || id === UNBOUND_SENSOR_BOOT_ID || stopped.has(id) || stopped.size >= RELAY_MAX_BOOTS) return;
        stopped.add(id);
        post({ channel: PROTECT_CHANNEL, sensorBootId: id, type: 'protect-relay-stop', reason });
      } catch {
        // A malformed or hostile message must never throw into the page's event loop.
      }
    });
    hello();
  } catch {
    finish();
  }
  return finish;
}

/** A validated ack that says the module is not active for this document. */
function isInactive(raw: unknown): boolean {
  const r = validateProtectAck(raw);
  if (!r.ok) return false;
  return !validatedValue(r).active;
}
