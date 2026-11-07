// ADR-020 §E (S11): ReplayCadenceTracker — cadence of periodic cross-site sends per document and receiver, in SW memory
// only (never stored, never sent). Bounded: at most PROTECT_BUDGETS.replayCadenceDocuments documents (LRU) and
// PROTECT_BUDGETS.replayCadenceDomainsPerDocument receivers per document (LRU). Dropping a receiver that already formed
// a series marks the document `truncated` (periodic-hosts-truncated). The cadence arithmetic is pure
// (packages/engine/src/protect/replay.ts stepCadence); here only the bounded maps. Keys: document keys from Chrome ids
// and registrable domains; no URL, no body, no value.

import { PROTECT_BUDGETS } from '@detect-expert/contracts';
import { createCadence, stepCadence } from '@detect-expert/engine';
import type { ReplayCadence, ReplayPeriodicFact, ReplayThresholds } from '@detect-expert/engine';

export const REPLAY_TRACKER_DOCUMENTS = PROTECT_BUDGETS.replayCadenceDocuments;
export const REPLAY_TRACKER_DOMAINS = PROTECT_BUDGETS.replayCadenceDomainsPerDocument;
/** Vendors remembered per receiver (enabled endpoint rules only; none in production). */
const MAX_VENDORS_PER_DOMAIN = 4;

interface DomainCadence {
  cadence: ReplayCadence;
  vendorIds: string[];
}

interface DocumentCadence {
  domains: Map<string, DomainCadence>;
  truncated: boolean;
}

export class ReplayCadenceTracker {
  private readonly docs = new Map<string, DocumentCadence>();
  private evictedDocuments = 0;
  private evictedDomains = 0;

  constructor(private readonly thresholds?: Readonly<ReplayThresholds>) {}

  /**
   * One send of `documentKey` to `domain` at `t` with `bytes` of observed body (null = not observed). `vendorId`: an
   * enabled endpoint rule matched the request host. Returns true when the receiver's cadence qualifies (S3).
   */
  note(documentKey: string, domain: string, t: number, bytes: number | null, vendorId: string | null = null): boolean {
    let doc = this.docs.get(documentKey);
    if (doc === undefined) {
      if (this.docs.size >= REPLAY_TRACKER_DOCUMENTS) {
        const oldest = this.docs.keys().next();
        if (!oldest.done) {
          this.docs.delete(oldest.value);
          this.evictedDocuments++;
        }
      }
      doc = { domains: new Map(), truncated: false };
      this.docs.set(documentKey, doc);
    } else if (this.docs.size > 1) {
      this.docs.delete(documentKey);
      this.docs.set(documentKey, doc);
    }
    let entry = doc.domains.get(domain);
    if (entry === undefined) {
      if (doc.domains.size >= REPLAY_TRACKER_DOMAINS) {
        const oldest = doc.domains.entries().next();
        if (!oldest.done) {
          doc.domains.delete(oldest.value[0]);
          this.evictedDomains++;
          if (oldest.value[1].cadence.runMax >= 2) doc.truncated = true;
        }
      }
      entry = { cadence: createCadence(), vendorIds: [] };
      doc.domains.set(domain, entry);
    } else if (doc.domains.size > 1) {
      doc.domains.delete(domain);
      doc.domains.set(domain, entry);
    }
    if (vendorId !== null && !entry.vendorIds.includes(vendorId) && entry.vendorIds.length < MAX_VENDORS_PER_DOMAIN) entry.vendorIds.push(vendorId);
    return stepCadence(entry.cadence, t, bytes, this.thresholds);
  }

  has(documentKey: string): boolean {
    return this.docs.has(documentKey);
  }

  /** Receivers of one document with their cadence (read-only views; the engine never mutates them). */
  periodic(documentKey: string): ReplayPeriodicFact[] {
    const doc = this.docs.get(documentKey);
    if (doc === undefined) return [];
    const out: ReplayPeriodicFact[] = [];
    for (const [domain, e] of doc.domains) out.push({ registrableDomain: domain, cadence: e.cadence, vendorIds: e.vendorIds });
    return out;
  }

  truncated(documentKey: string): boolean {
    return this.docs.get(documentKey)?.truncated === true;
  }

  forget(documentKey: string): void {
    this.docs.delete(documentKey);
  }

  /** Every document of a tab (document keys start with `<tabId>:`). */
  forgetTab(tabId: number): void {
    const prefix = String(tabId) + ':';
    for (const key of [...this.docs.keys()]) if (key.startsWith(prefix)) this.docs.delete(key);
  }

  clear(): void {
    this.docs.clear();
  }

  /** Numbers only (bounds in tests and diagnostics). */
  stats(): { documents: number; domains: number; evictedDocuments: number; evictedDomains: number } {
    let domains = 0;
    for (const d of this.docs.values()) domains += d.domains.size;
    return { documents: this.docs.size, domains, evictedDocuments: this.evictedDocuments, evictedDomains: this.evictedDomains };
  }
}
