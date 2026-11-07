// ADR-020 §11 (S04): outcome of requests a lane asked to track (SW memory only, ≤ maxPendingOutcomes, TTL outcomeTtlMs).
// - `sent`: webRequest.onSendHeaders arrived (Chrome sent the request; never "the server received");
// - `stopped`: onErrorOccurred net::ERR_BLOCKED_BY_CLIENT AND the firewall port says our block rule won AND that rule
//   was active at least ruleActivationSlackMs before the request started; a first request is never `stopped`;
// - `stopped-other`: ERR_BLOCKED_BY_CLIENT otherwise (another extension, or our rule activated later);
// - `unknown`: everything else (no event, SW asleep, listener added later, TTL expired).

import { PROTECT_BUDGETS } from '@detect-expert/contracts';
import type { DeliveryState } from '@detect-expert/contracts';
import type { Clock, RequestDetailsLike } from '../chrome-api';

export const BLOCKED_BY_CLIENT = 'net::ERR_BLOCKED_BY_CLIENT';

/** What the firewall's local DNR evaluation (S08) says about a request: the winning rule of the module, or null. */
export interface FirewallVerdict {
  ruleKey: string;
  action: 'block' | 'allow';
  /** Epoch ms when the rule became active in Chrome (write confirmed). */
  activatedAt: number;
}

export type FirewallEvaluatePort = (details: RequestDetailsLike) => FirewallVerdict | null;

/** Default port until the firewall lane (S08) registers its own: no rule of ours is known. */
export const noFirewallEvaluate: FirewallEvaluatePort = () => null;

export interface OutcomeEvent {
  kind: 'outcome';
  requestId: string;
  tabId: number;
  state: DeliveryState;
  ruleKey?: string;
}

interface Pending {
  tabId: number;
  startedAt: number;
  trackedAt: number;
  state: DeliveryState | null;
}

const SWEEP_EVERY_MS = 1000;

export class OutcomeTracker {
  private readonly pending = new Map<string, Pending>();
  private lastSweep = 0;
  private evicted = 0;

  constructor(
    private readonly clock: Clock,
    private readonly publish: (event: OutcomeEvent) => void,
    private readonly evaluate: () => FirewallEvaluatePort,
  ) {}

  get size(): number {
    return this.pending.size;
  }

  /** Lanes call this for requests whose outcome they show. Returns false for an invalid id. */
  track(requestId: string, tabId: number, startedAt: number): boolean {
    if (typeof requestId !== 'string' || requestId.length === 0 || requestId.length > 64) return false;
    this.sweep();
    if (this.pending.has(requestId)) return true;
    while (this.pending.size >= PROTECT_BUDGETS.maxPendingOutcomes) {
      const oldest = this.pending.entries().next();
      if (oldest.done) break;
      this.pending.delete(oldest.value[0]);
      this.evicted++;
      if (oldest.value[1].state === null) this.emit(oldest.value[0], oldest.value[1], 'unknown');
    }
    this.pending.set(requestId, { tabId, startedAt, trackedAt: this.clock.now(), state: null });
    return true;
  }

  stateOf(requestId: string): DeliveryState | null {
    return this.pending.get(requestId)?.state ?? null;
  }

  onSendHeaders(details: RequestDetailsLike): void {
    const id = details.requestId;
    if (id === undefined) return;
    const p = this.pending.get(id);
    if (p === undefined || p.state !== null) return;
    p.state = 'sent';
    this.emit(id, p, 'sent');
  }

  onErrorOccurred(details: RequestDetailsLike): void {
    const id = details.requestId;
    if (id === undefined) return;
    const p = this.pending.get(id);
    if (p === undefined) return;
    this.pending.delete(id);
    if (p.state !== null) return; // already sent: a later network error does not undo the send
    if (details.error !== BLOCKED_BY_CLIENT) {
      this.emit(id, p, 'unknown');
      return;
    }
    let verdict: FirewallVerdict | null = null;
    try {
      verdict = this.evaluate()(details);
    } catch {
      verdict = null;
    }
    const ours = verdict !== null && verdict.action === 'block' && verdict.activatedAt <= p.startedAt - PROTECT_BUDGETS.ruleActivationSlackMs;
    if (ours) this.emit(id, p, 'stopped', verdict!.ruleKey);
    else this.emit(id, p, 'stopped-other');
  }

  onCompleted(details: RequestDetailsLike): void {
    const id = details.requestId;
    if (id === undefined) return;
    const p = this.pending.get(id);
    if (p === undefined) return;
    this.pending.delete(id);
    // Completed without onSendHeaders (e.g. served from cache): no send was observed.
    if (p.state === null) this.emit(id, p, 'unknown');
  }

  /** Expired entries become `unknown` (at the next event: no alarms, ADR-020 §8). */
  sweep(force = false): void {
    const now = this.clock.now();
    if (!force && now - this.lastSweep < SWEEP_EVERY_MS) return;
    this.lastSweep = now;
    for (const [id, p] of this.pending) {
      if (now - p.trackedAt < PROTECT_BUDGETS.outcomeTtlMs) continue;
      this.pending.delete(id);
      if (p.state === null) this.emit(id, p, 'unknown');
    }
  }

  forgetTab(tabId: number): void {
    for (const [id, p] of this.pending) if (p.tabId === tabId) this.pending.delete(id);
  }

  clear(): void {
    this.pending.clear();
  }

  debug(): { pending: number; evicted: number } {
    return { pending: this.pending.size, evicted: this.evicted };
  }

  private emit(requestId: string, p: Pending, state: DeliveryState, ruleKey?: string): void {
    try {
      this.publish({ kind: 'outcome', requestId, tabId: p.tabId, state, ...(ruleKey === undefined ? {} : { ruleKey }) });
    } catch {
      // The bus isolates subscribers; a failing publisher must not break the webRequest callback.
    }
  }
}
