// Token buckets for the content channel (REQ-011, ADR-004 §6): 20 batch/s/document, 100/tab, 200/extension.
// Pure, bounded: at most MAX_BUCKETS per-key buckets; idle buckets are evicted. Garbage costs the sender tokens.

import { BUDGETS } from '@detect-expert/contracts';

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const MAX_BUCKETS = 1024;
const IDLE_MS = 10_000;

function refill(bucket: Bucket, capacity: number, now: number): void {
  const elapsed = now - bucket.updatedAt;
  if (elapsed > 0) {
    // `capacity` tokens per second.
    bucket.tokens = Math.min(capacity, bucket.tokens + (elapsed / 1000) * capacity);
    bucket.updatedAt = now;
  }
}

export class RateLimiter {
  private readonly documents = new Map<string, Bucket>();
  private readonly tabs = new Map<number, Bucket>();
  private readonly global: Bucket = { tokens: BUDGETS.maxBatchesPerSecondGlobal, updatedAt: 0 };
  private lastSweep = 0;

  /** True when the batch may be processed; false when any of the three budgets is exhausted. */
  tryConsume(documentKey: string, tabId: number, now: number): boolean {
    this.sweep(now);
    const doc = this.bucket(this.documents, documentKey, BUDGETS.maxBatchesPerSecondPerDocument, now);
    const tab = this.bucket(this.tabs, tabId, BUDGETS.maxBatchesPerSecondPerTab, now);
    refill(this.global, BUDGETS.maxBatchesPerSecondGlobal, now);
    if (doc.tokens < 1 || tab.tokens < 1 || this.global.tokens < 1) return false;
    doc.tokens -= 1;
    tab.tokens -= 1;
    this.global.tokens -= 1;
    return true;
  }

  private bucket<K>(map: Map<K, Bucket>, key: K, capacity: number, now: number): Bucket {
    let b = map.get(key);
    if (b === undefined) {
      if (map.size >= MAX_BUCKETS) {
        // Bounded: drop the oldest inserted bucket rather than growing without limit.
        const first = map.keys().next();
        if (!first.done) map.delete(first.value);
      }
      b = { tokens: capacity, updatedAt: now };
      map.set(key, b);
      return b;
    }
    refill(b, capacity, now);
    return b;
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < IDLE_MS) return;
    this.lastSweep = now;
    for (const [k, b] of this.documents) if (now - b.updatedAt > IDLE_MS) this.documents.delete(k);
    for (const [k, b] of this.tabs) if (now - b.updatedAt > IDLE_MS) this.tabs.delete(k);
  }
}
