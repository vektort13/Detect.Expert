// ADR-020 §11, §G (S12): value-match records whose send Chrome has not reported yet (published at onBeforeRequest time
// with `deliveryState: 'unknown'` and the request id on the bus event). The history counts them only after the outcome
// tracker reports `sent` (webRequest.onSendHeaders); `stopped`, `stopped-other` and `unknown` drop them. SW memory
// only, nothing persisted: ≤ PROTECT_BUDGETS.maxPendingOutcomes requests, ≤ MAX_PARKED_PER_REQUEST records each,
// TTL 2 × outcomeTtlMs (the tracker reports `unknown` at outcomeTtlMs; the bound covers a closed tab, which the
// tracker forgets without an event). Everything dropped here is simply not counted (never «received»).

import { PROTECT_BUDGETS } from '@detect-expert/contracts';
import type { ProtectEvent } from '../event-bus';

type EvidenceEvent = Extract<ProtectEvent, { kind: 'evidence' }>;

/** Records of one request kept while it is in flight (one request carries at most a few tracked fields). */
export const MAX_PARKED_PER_REQUEST = 8;

interface Parked {
  at: number;
  tabId: number;
  events: EvidenceEvent[];
}

export class HistoryAwaitingSends {
  private readonly parked = new Map<string, Parked>();
  private dropped = 0;

  constructor(
    private readonly maxRequests: number = PROTECT_BUDGETS.maxPendingOutcomes,
    private readonly ttlMs: number = 2 * PROTECT_BUDGETS.outcomeTtlMs,
  ) {}

  get size(): number {
    return this.parked.size;
  }

  /** Records dropped without an outcome (bound, TTL, closed tab): saturating, numbers only. */
  get droppedCount(): number {
    return this.dropped;
  }

  private drop(n: number): void {
    this.dropped = Math.min(Number.MAX_SAFE_INTEGER, this.dropped + n);
  }

  park(requestId: string, event: EvidenceEvent, now: number): void {
    this.sweep(now);
    let p = this.parked.get(requestId);
    if (p === undefined) {
      while (this.parked.size >= this.maxRequests) {
        const oldest = this.parked.entries().next();
        if (oldest.done === true) break;
        this.parked.delete(oldest.value[0]);
        this.drop(oldest.value[1].events.length);
      }
      p = { at: now, tabId: event.tabId, events: [] };
      this.parked.set(requestId, p);
    }
    if (p.events.length >= MAX_PARKED_PER_REQUEST) {
      this.drop(1);
      return;
    }
    p.events.push(event);
  }

  /** The parked records of a request, removed (empty when none). */
  take(requestId: string, now: number): EvidenceEvent[] {
    this.sweep(now);
    const p = this.parked.get(requestId);
    if (p === undefined) return [];
    this.parked.delete(requestId);
    return p.events;
  }

  /** Insertion order is park order: the sweep stops at the first live entry (cheap inside the webRequest callback). */
  sweep(now: number): void {
    for (const [id, p] of this.parked) {
      if (now - p.at <= this.ttlMs) break;
      this.parked.delete(id);
      this.drop(p.events.length);
    }
  }

  forgetTab(tabId: number): void {
    for (const [id, p] of this.parked) {
      if (p.tabId !== tabId) continue;
      this.parked.delete(id);
      this.drop(p.events.length);
    }
  }

  clear(): void {
    this.parked.clear();
  }
}
