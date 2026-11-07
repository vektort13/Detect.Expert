// Delivery loop ISOLATED -> SW (ADR-004 §6-7, spec A6). Stop-and-wait: one PageBatch in flight per document,
// frozen at first send and retransmitted byte-identical with the same batchSeq until the Ack watermark covers
// it, so the SW's (documentKey, bridgeSessionId, batchSeq) dedup works. Flush 250 ms after data appears (or
// at once when a full batch is waiting), never more than 20 batches per second. A missing Ack (timeout,
// transport rejection, garbage or a lower watermark) triggers retransmits with bounded exponential backoff and
// a bounded attempt count (REQ-011: no hang, no infinite retry). Records stay in the ring until acknowledged;
// an abandoned batch loses nothing because totals are cumulative.

import { MAX_COUNT } from '@detect-expert/contracts';
import type { Ack, CoverageFlag, PageBatch } from '@detect-expert/contracts';
import type { CollectorEnv, TimerHandle } from './env';
import { RateLimiter } from './rate-limit';
import type { AggregateRing, BatchEntry } from './ring';

export interface DeliveryOptions {
  flushMinMs: number;
  maxBatchEvents: number;
  maxBatchesPerSecond: number;
  /** A sendMessage promise that has not settled by then counts as a lost Ack. */
  ackTimeoutMs: number;
  retransmitBaseMs: number;
  retransmitMaxMs: number;
  /** Retransmits of one batchSeq before it is abandoned (records stay dirty and get a new batchSeq). */
  maxRetransmits: number;
  /** Consecutive abandoned batches before automatic delivery is suspended (REQ-011). */
  maxConsecutiveAbandons: number;
}

export interface DeliveryHooks {
  /** Coverage flags to attach to a new batch. */
  coverageDelta(): CoverageFlag[];
  /** Flags of a committed batch. */
  committed(flags: readonly CoverageFlag[]): void;
  /** Every valid Ack (pause / protocol handling happens in the collector). */
  onAck(ack: Ack, currentControl: boolean): void;
  /** Transport is dead: the extension context was invalidated. */
  onFatal(): void;
  /** Cumulative delivery budget exhausted; retain diagnostics for a later recovery. */
  onSuspended(): void;
  /** True when a pending coverage flag has not been committed to the SW in this bridge session. */
  hasUndeliveredCoverage(): boolean;
  /** sensorBootId for a coverage-only batch (no observation to take it from). */
  sensorBootId(): string;
}

export interface DeliveryStats {
  batchesSent: number;
  batchesRetransmitted: number;
  batchesCommitted: number;
  batchesAbandoned: number;
  acksInvalid: number;
  acksNotCommitted: number;
  acksTimedOut: number;
  transportFailures: number;
}

interface InFlight {
  batch: PageBatch;
  entries: BatchEntry[];
  attempts: number;
  /** Incremented per transmit; responses from older attempts are stale. */
  attemptId: number;
}

export class Deliverer {
  readonly stats: DeliveryStats = {
    batchesSent: 0,
    batchesRetransmitted: 0,
    batchesCommitted: 0,
    batchesAbandoned: 0,
    acksInvalid: 0,
    acksNotCommitted: 0,
    acksTimedOut: 0,
    transportFailures: 0,
  };
  private readonly limiter: RateLimiter;
  private batchSeq = 0;
  private inFlight: InFlight | null = null;
  private flushTimer: TimerHandle | null = null;
  private retryTimer: TimerHandle | null = null;
  private ackTimer: TimerHandle | null = null;
  private backoffMs: number;
  private paused = false;
  private stopped = false;
  private suspended = false;
  private consecutiveAbandons = 0;
  private controlGeneration = 0;

  noteControl(): void { this.controlGeneration++; }

  constructor(
    private readonly env: CollectorEnv,
    private readonly ring: AggregateRing,
    private readonly bridgeSessionId: string,
    private readonly options: DeliveryOptions,
    private readonly hooks: DeliveryHooks,
  ) {
    this.limiter = new RateLimiter(options.maxBatchesPerSecond, 1000);
    this.backoffMs = options.retransmitBaseMs;
  }

  get lastBatchSeq(): number {
    return this.batchSeq;
  }

  get inFlightBatchSeq(): number | null {
    return this.inFlight === null ? null : this.inFlight.batch.batchSeq;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get isStopped(): boolean {
    return this.stopped;
  }

  get isSuspended(): boolean {
    return this.suspended;
  }

  /** New dirty data in the ring. */
  notifyData(): void {
    this.schedule();
  }

  private schedule(): void {
    if (this.stopped || this.paused || this.suspended || this.inFlight !== null) return;
    if (this.flushTimer !== null || this.retryTimer !== null) return;
    if (this.ring.dirty === 0) {
      // Coverage without new data (F033/F034): a flag the SW has not seen yet rides on one real cumulative
      // snapshot when the ring holds one (max-merge, idempotent); an empty ring sends a coverage-only batch
      // (observations: [], ADR-004 changelog). Flags already committed are never resent on their own.
      if (!this.hooks.hasUndeliveredCoverage()) return;
      this.ring.markCoverageDirty();
    }
    const now = this.env.now();
    const base = this.ring.dirty >= this.options.maxBatchEvents ? 0 : this.options.flushMinMs;
    const wait = this.limiter.waitMs(now);
    this.flushTimer = this.env.setTimer(() => {
      this.flushTimer = null;
      this.flush();
    }, base > wait ? base : wait);
  }

  private flush(): void {
    if (this.stopped || this.paused || this.suspended || this.inFlight !== null) return;
    if (this.ring.dirty === 0 && !this.hooks.hasUndeliveredCoverage()) return;
    if (!this.limiter.tryAcquire(this.env.now())) {
      this.schedule();
      return;
    }
    this.startBatch();
  }

  private startBatch(): void {
    const entries = this.ring.takeBatch(this.options.maxBatchEvents);
    const coverageDelta = this.hooks.coverageDelta();
    const first = entries[0];
    // A batch without observations is legal only as a coverage-only batch (non-empty coverageDelta).
    if (first === undefined && coverageDelta.length === 0) return;
    if (this.batchSeq < MAX_COUNT) this.batchSeq++;
    const batch: PageBatch = {
      schemaVersion: 1,
      type: 'sensor-events',
      sensorBootId: first === undefined ? this.hooks.sensorBootId() : first.sensorBootId,
      bridgeSessionId: this.bridgeSessionId,
      batchSeq: this.batchSeq,
      observations: entries.map((e) => e.observation),
      coverageDelta,
    };
    this.inFlight = { batch, entries, attempts: 0, attemptId: 0 };
    this.stats.batchesSent++;
    this.transmit();
  }

  private transmit(): void {
    const token = this.inFlight;
    if (token === null) return;
    this.clearAckTimer();
    token.attemptId++;
    const attemptId = token.attemptId;
    const controlGeneration = this.controlGeneration;
    this.ackTimer = this.env.setTimer(() => {
      this.ackTimer = null;
      this.onAckTimeout(token, attemptId);
    }, this.options.ackTimeoutMs);
    let promise: Promise<unknown>;
    try {
      promise = this.env.sendToBackground(token.batch);
    } catch (error) {
      promise = Promise.reject(error);
    }
    promise.then(
      (response) => this.onResponse(token, attemptId, response, controlGeneration),
      (error: unknown) => this.onFailure(token, attemptId, error),
    );
  }

  private isCurrent(token: InFlight, attemptId: number): boolean {
    return this.inFlight === token && token.attemptId === attemptId;
  }

  private onAckTimeout(token: InFlight, attemptId: number): void {
    if (this.stopped || !this.isCurrent(token, attemptId)) return;
    this.stats.acksTimedOut++;
    this.retryLater(token);
  }

  private onResponse(token: InFlight, attemptId: number, raw: unknown, controlGeneration: number): void {
    if (this.stopped || this.inFlight !== token) return;
    const current = token.attemptId === attemptId;
    const ack = readAck(raw);
    if (ack === null) {
      // No or garbage response (SW restarting, listener missing): treat as a lost Ack.
      if (!current) return;
      this.clearAckTimer();
      this.stats.acksInvalid++;
      this.retryLater(token);
      return;
    }
    const committed = ack.lastCommittedBatchSeq >= token.batch.batchSeq;
    // A late Ack from a superseded attempt is useful only if it commits (same batchSeq, same payload).
    if (!current && !committed) return;
    this.clearAckTimer();
    this.hooks.onAck(ack, controlGeneration === this.controlGeneration);
    if (this.stopped) return;
    if (committed) {
      this.backoffMs = this.options.retransmitBaseMs;
      this.consecutiveAbandons = 0;
      this.clearRetryTimer();
      this.ring.markAcked(token.entries);
      this.hooks.committed(token.batch.coverageDelta);
      this.stats.batchesCommitted++;
      this.inFlight = null;
      this.schedule();
      return;
    }
    this.stats.acksNotCommitted++;
    this.retryLater(token);
  }

  private onFailure(token: InFlight, attemptId: number, error: unknown): void {
    if (this.stopped) return;
    if (isFatalTransportError(error) || !this.env.isContextAlive()) {
      this.stats.transportFailures++;
      this.stop();
      this.hooks.onFatal();
      return;
    }
    if (!this.isCurrent(token, attemptId)) return;
    this.clearAckTimer();
    this.stats.transportFailures++;
    this.retryLater(token);
  }

  private retryLater(token: InFlight): void {
    if (this.paused || this.retryTimer !== null) return; // resumed later / a retry is already pending
    token.attempts++;
    if (token.attempts > this.options.maxRetransmits) {
      // Keep a cumulative budget across replacement sequences (F116/F117, REQ-011).
      this.stats.batchesAbandoned++;
      this.consecutiveAbandons++;
      this.inFlight = null;
      this.backoffMs = this.options.retransmitBaseMs;
      if (this.consecutiveAbandons >= this.options.maxConsecutiveAbandons) {
        this.suspended = true;
        this.clearTimers();
        this.hooks.onSuspended();
        return;
      }
      this.retryTimer = this.env.setTimer(() => {
        this.retryTimer = null;
        this.schedule();
      }, this.options.retransmitMaxMs);
      return;
    }
    const wait = this.limiter.waitMs(this.env.now());
    const delay = this.backoffMs > wait ? this.backoffMs : wait;
    this.backoffMs = Math.min(this.options.retransmitMaxMs, this.backoffMs * 2);
    this.retryTimer = this.env.setTimer(() => {
      this.retryTimer = null;
      this.retransmit(token);
    }, delay);
  }

  private retransmit(token: InFlight): void {
    if (this.stopped || this.paused || this.suspended || this.inFlight !== token) return;
    const now = this.env.now();
    if (!this.limiter.tryAcquire(now)) {
      this.retryTimer = this.env.setTimer(() => {
        this.retryTimer = null;
        this.retransmit(token);
      }, this.limiter.waitMs(now));
      return;
    }
    this.stats.batchesRetransmitted++;
    this.transmit();
  }

  /** pagehide: one best-effort send now (in-flight batch first, else a fresh one). No unload handler. */
  forceFlush(): void {
    if (this.stopped || this.paused || this.suspended) return;
    this.clearTimers();
    if (this.inFlight !== null) {
      this.stats.batchesRetransmitted++;
      this.transmit();
      return;
    }
    if (this.ring.dirty === 0) {
      if (!this.hooks.hasUndeliveredCoverage()) return;
      this.ring.markCoverageDirty();
    }
    this.startBatch();
  }

  setPaused(paused: boolean): void {
    if (this.stopped || this.paused === paused) return;
    this.paused = paused;
    if (paused) {
      this.clearTimers();
      return;
    }
    if (this.suspended) return;
    if (this.inFlight !== null) {
      this.stats.batchesRetransmitted++;
      this.transmit();
      return;
    }
    this.schedule();
  }

  /** Only explicit local resume or trusted browser lifecycle may reset the failure budget. */
  recover(): void {
    if (this.stopped || this.paused || !this.suspended) return;
    this.suspended = false;
    this.consecutiveAbandons = 0;
    this.backoffMs = this.options.retransmitBaseMs;
    this.schedule();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.inFlight = null;
  }

  private clearTimers(): void {
    if (this.flushTimer !== null) {
      this.env.clearTimer(this.flushTimer);
      this.flushTimer = null;
    }
    this.clearRetryTimer();
    this.clearAckTimer();
  }

  private clearRetryTimer(): void {
    if (this.retryTimer !== null) {
      this.env.clearTimer(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private clearAckTimer(): void {
    if (this.ackTimer !== null) {
      this.env.clearTimer(this.ackTimer);
      this.ackTimer = null;
    }
  }
}

/** SW -> bridge is a trusted context; a light shape check guards against a missing or foreign response. */
export function readAck(raw: unknown): Ack | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const seq = r['lastCommittedBatchSeq'];
  const paused = r['paused'];
  const protocolOk = r['protocolOk'];
  if (r['schemaVersion'] !== 1 || r['type'] !== 'ack') return null;
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0 || seq > MAX_COUNT) return null;
  if (typeof paused !== 'boolean' || typeof protocolOk !== 'boolean') return null;
  if (r['stopReason'] !== undefined && r['stopReason'] !== 'revoked') return null;
  return { schemaVersion: 1, type: 'ack', lastCommittedBatchSeq: seq, paused, protocolOk,
    ...(r['stopReason'] === 'revoked' ? { stopReason: 'revoked' as const } : {}) };
}

/** "Extension context invalidated": the extension was reloaded/removed or access revoked. Everything else
 *  ("receiving end does not exist", "message port closed") is transient: the SW may just be restarting. */
export function isFatalTransportError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return /context invalidated/i.test(message);
}
