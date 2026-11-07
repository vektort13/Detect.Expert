// ADR-020 §A (S04): synchronous event bus between the module's lanes (SW memory only). A subscriber that throws is
// isolated: the error is swallowed and counted, the others still run. Bounded subscriber list.

import type { DeliveryState, ProtectEvidence } from '@detect-expert/contracts';

// `requestId` (SW memory only, never stored): the request a value-match record describes, so a subscriber can wait for
// that request's `outcome` while the record's delivery is `unknown` (ADR-020 §11; the history counts only `sent`).
export type ProtectEvent =
  | { kind: 'evidence'; documentKey: string; tabId: number; site: string | null; evidence: ProtectEvidence; requestId?: string }
  | { kind: 'blocked'; tabId: number; site: string | null; receiver: string; ruleKey: string }
  | { kind: 'outcome'; requestId: string; tabId: number; state: DeliveryState; ruleKey?: string }
  // Review PT-4: value-match dropped the script of stored records of these receivers (it carried a typed value); lanes
  // holding a copy of that script (the firewall receiver view) drop theirs too.
  | { kind: 'evidence-scrubbed'; tabId: number; receivers: string[] };

export type ProtectEventKind = ProtectEvent['kind'];
export type ProtectEventListener = (event: ProtectEvent) => void;

export const MAX_EVENT_SUBSCRIBERS = 32;

export class ProtectEventBus {
  private readonly subscribers: Array<{ kind: ProtectEventKind | null; fn: ProtectEventListener }> = [];
  private failures = 0;
  private publishing = 0;

  /** Subscribes to one kind (or all with null). Returns the unsubscribe function; beyond the bound nothing is added. */
  subscribe(kind: ProtectEventKind | null, fn: ProtectEventListener): () => void {
    if (this.subscribers.length >= MAX_EVENT_SUBSCRIBERS) return () => undefined;
    const entry = { kind, fn };
    this.subscribers.push(entry);
    return () => {
      const i = this.subscribers.indexOf(entry);
      if (i >= 0) this.subscribers.splice(i, 1);
    };
  }

  /** Delivers synchronously, in subscription order. Re-entrant publishing deeper than 4 levels is dropped. */
  publish(event: ProtectEvent): void {
    if (this.publishing >= 4) {
      this.failures++;
      return;
    }
    this.publishing++;
    try {
      for (const s of [...this.subscribers]) {
        if (s.kind !== null && s.kind !== event.kind) continue;
        try {
          s.fn(event);
        } catch {
          this.failures++;
        }
      }
    } finally {
      this.publishing--;
    }
  }

  clear(): void {
    this.subscribers.length = 0;
  }

  debug(): { subscribers: number; failures: number } {
    return { subscribers: this.subscribers.length, failures: this.failures };
  }
}
