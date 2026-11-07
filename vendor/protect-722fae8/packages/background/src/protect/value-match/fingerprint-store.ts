// ADR-020 §B, §8 (S07): keyed fingerprints of typed values in SW memory only. Never written to storage, never in a
// projection, an export, a log or diagnostics (only counts leave). Key (documentKey, fieldRef); per document at most
// maxTrackedFieldsPerDocument fields, at most maxFingerprintDocuments documents (LRU), and a grace of crossSiteGraceMs
// once the tab's top-level site changed. Lifetime (consent: «не дольше 15 минут»): the fingerprints of each field go
// fingerprintIdleTtlMs after they were written, whatever else is typed in the document (review round 2); a document
// without any input for that long goes as a whole. The salt lives as long as the service (a new SW or a restarted lane
// has a new one; documents re-key through protect-control `rekey` / the next ack).

import { MAX_COUNT, PROTECT_BUDGETS } from '@detect-expert/contracts';
import type { FieldKind, FingerprintEncoding, FrameContext, ProtectFieldFingerprint } from '@detect-expert/contracts';
import { fpFromHex, toBase64 } from '@detect-expert/engine';

export interface StoredEntry {
  enc: FingerprintEncoding;
  len: number;
  /** 52-bit keyed fingerprint as a number. */
  h: number;
}

/** Rolling-window candidates: variants that may contain a separator (name forms, phone as typed). */
export function isRollingCandidate(kind: FieldKind, enc: FingerprintEncoding): boolean {
  if (kind === 'name') return enc === 'plain' || enc === 'plain-normalized';
  if (kind === 'phone') return enc === 'plain';
  return false;
}

export interface FieldRecord {
  readonly documentKey: string;
  readonly fieldRef: number;
  readonly tabId: number;
  fieldKind: FieldKind;
  /** Site of the document the value was typed in (frame site for sub-frames). */
  readonly site: string | null;
  /** Top-level site of the tab when the value arrived. */
  readonly topSite: string | null;
  /** Top-level document of the tab when the value arrived (previous-document detection). */
  readonly topKey: string | null;
  readonly frameContext: FrameContext;
  readonly frameSite: string | null;
  readonly capturedAt: number;
  updatedAt: number;
  /** When the value last changed (input / blur / submit); null after a rekey-only read (moment unknown). */
  changedAt: number | null;
  /** Increments on every value change; an opaque-after-input record is made once per change. */
  changeSeq: number;
  opaqueReportedSeq: number;
  entries: StoredEntry[];
}

export interface DocumentState {
  readonly documentKey: string;
  readonly tabId: number;
  /** Time of the last submit boundary (submit event or a submit control) of this document, or null. */
  submitAt: number | null;
  /** The tab's top-level site changed: the fingerprints go at this time (grace), else null. */
  expiresAt: number | null;
  lastActive: number;
  readonly fields: Map<number, FieldRecord>;
  neverReadNoted: boolean;
  paymentNoted: boolean;
}

export interface IndexRef {
  rec: FieldRecord;
  entry: StoredEntry;
}

export interface TabIndex {
  byHash: Map<number, IndexRef[]>;
  /** Lengths of every indexed variant (cheap pre-check before hashing a token). */
  lengths: Set<number>;
  /** ≤ 4 rolling lengths (most recently changed fields first) with their candidates. */
  rolling: Map<number, IndexRef[]>;
  fields: number;
}

export const MAX_ROLLING_LENGTHS = 4;

function randomBytes(n: number, random: (n: number) => Uint8Array): Uint8Array {
  const b = random(n);
  if (!(b instanceof Uint8Array) || b.length !== n) throw new Error('protect: random source failed');
  return b;
}

export function defaultRandom(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export class FingerprintStore {
  readonly salt: string;
  readonly saltId: string;
  private readonly docs = new Map<string, DocumentState>();
  private readonly indexes = new Map<number, TabIndex>();
  private droppedByTab = new Map<number, number>();
  private evictions = 0;

  constructor(random: (n: number) => Uint8Array = defaultRandom) {
    this.salt = toBase64(randomBytes(16, random), true);
    this.saltId = toBase64(randomBytes(9, random), true);
  }

  get documentCount(): number {
    return this.docs.size;
  }

  fieldCount(): number {
    let n = 0;
    for (const d of this.docs.values()) n += d.fields.size;
    return n;
  }

  tabCount(): number {
    const tabs = new Set<number>();
    for (const d of this.docs.values()) tabs.add(d.tabId);
    return tabs.size;
  }

  documents(): IterableIterator<DocumentState> {
    return this.docs.values();
  }

  document(documentKey: string): DocumentState | undefined {
    return this.docs.get(documentKey);
  }

  /** Document state, created when absent (LRU over maxFingerprintDocuments: the least recently active one goes). */
  ensureDocument(documentKey: string, tabId: number, now: number): DocumentState {
    let doc = this.docs.get(documentKey);
    if (doc !== undefined) {
      this.docs.delete(documentKey);
      this.docs.set(documentKey, doc);
      doc.lastActive = now;
      return doc;
    }
    while (this.docs.size >= PROTECT_BUDGETS.maxFingerprintDocuments) {
      let victim: DocumentState | null = null;
      for (const d of this.docs.values()) if (victim === null || d.lastActive < victim.lastActive) victim = d;
      if (victim === null) break;
      this.evictions++;
      this.noteDropped(victim.tabId, victim.fields.size);
      this.removeDocument(victim.documentKey);
    }
    doc = { documentKey, tabId, submitAt: null, expiresAt: null, lastActive: now, fields: new Map(), neverReadNoted: false, paymentNoted: false };
    this.docs.set(documentKey, doc);
    return doc;
  }

  /**
   * Replaces the fingerprints of one field. Entries with an invalid hash are skipped. `changed` = a new value (not a
   * rekey re-read): it moves changedAt / changeSeq. Returns the record, or null when nothing valid remained.
   */
  upsert(doc: DocumentState, field: ProtectFieldFingerprint, meta: { site: string | null; topSite: string | null; topKey: string | null; frameContext: FrameContext; frameSite: string | null }, now: number): FieldRecord | null {
    const entries: StoredEntry[] = [];
    for (const e of field.entries.slice(0, PROTECT_BUDGETS.maxVariantsPerField)) {
      const h = fpFromHex(e.h);
      if (h >= 0) entries.push({ enc: e.enc, len: e.len, h });
    }
    if (entries.length === 0) return null;
    const changed = field.trigger !== 'rekey';
    const before = doc.fields.get(field.fieldRef);
    const rec: FieldRecord = {
      documentKey: doc.documentKey,
      fieldRef: field.fieldRef,
      tabId: doc.tabId,
      fieldKind: field.fieldKind,
      site: meta.site,
      topSite: meta.topSite,
      topKey: before?.topKey ?? meta.topKey,
      frameContext: meta.frameContext,
      frameSite: meta.frameSite,
      capturedAt: before?.capturedAt ?? now,
      updatedAt: now,
      changedAt: changed ? now : (before?.changedAt ?? null),
      changeSeq: Math.min(MAX_COUNT, (before?.changeSeq ?? 0) + (changed ? 1 : 0)),
      opaqueReportedSeq: before?.opaqueReportedSeq ?? 0,
      entries,
    };
    doc.fields.set(field.fieldRef, rec);
    doc.lastActive = now;
    this.indexes.delete(doc.tabId);
    return rec;
  }

  /** Index of every live field of a tab (rebuilt lazily after a change). */
  index(tabId: number): TabIndex | null {
    const cached = this.indexes.get(tabId);
    if (cached !== undefined) return cached.fields > 0 ? cached : null;
    const byHash = new Map<number, IndexRef[]>();
    const lengths = new Set<number>();
    const recs: FieldRecord[] = [];
    for (const d of this.docs.values()) {
      if (d.tabId !== tabId) continue;
      for (const rec of d.fields.values()) recs.push(rec);
    }
    recs.sort((a, b) => (b.changedAt ?? b.updatedAt) - (a.changedAt ?? a.updatedAt));
    const rolling = new Map<number, IndexRef[]>();
    for (const rec of recs) {
      for (const entry of rec.entries) {
        const ref = { rec, entry };
        const list = byHash.get(entry.h);
        if (list === undefined) byHash.set(entry.h, [ref]);
        else list.push(ref);
        lengths.add(entry.len);
        if (isRollingCandidate(rec.fieldKind, entry.enc)) {
          const slot = rolling.get(entry.len);
          if (slot !== undefined) slot.push(ref);
          else if (rolling.size < MAX_ROLLING_LENGTHS) rolling.set(entry.len, [ref]);
        }
      }
    }
    const index: TabIndex = { byHash, lengths, rolling, fields: recs.length };
    this.indexes.set(tabId, index);
    return recs.length > 0 ? index : null;
  }

  /** Fields of a tab, most recently changed first. */
  fieldsOfTab(tabId: number): FieldRecord[] {
    const out: FieldRecord[] = [];
    for (const d of this.docs.values()) if (d.tabId === tabId) for (const rec of d.fields.values()) out.push(rec);
    return out.sort((a, b) => (b.changedAt ?? -1) - (a.changedAt ?? -1));
  }

  hasTab(tabId: number): boolean {
    for (const d of this.docs.values()) if (d.tabId === tabId) return true;
    return false;
  }

  /** The tab's top-level site changed: its documents of the previous site keep their fingerprints for the grace. */
  startGrace(tabId: number, newSite: string | null, now: number): void {
    for (const d of this.docs.values()) {
      if (d.tabId !== tabId || d.expiresAt !== null) continue;
      const first = d.fields.values().next();
      const topSite = first.done ? null : first.value.topSite;
      if (topSite !== newSite) d.expiresAt = now + PROTECT_BUDGETS.crossSiteGraceMs;
    }
  }

  /**
   * Per-field lifetime (fingerprintIdleTtlMs since the fingerprints were written), idle documents, grace expiry and
   * documents of excluded sites. Returns the number of documents removed.
   */
  sweep(now: number, excluded: (site: string | null, tabId: number) => boolean): number {
    let removed = 0;
    for (const d of [...this.docs.values()]) {
      let drop = d.expiresAt !== null && now >= d.expiresAt;
      if (!drop && now - d.lastActive >= PROTECT_BUDGETS.fingerprintIdleTtlMs) drop = true;
      if (!drop) {
        let expired = false;
        // Deleting the current entry while iterating a Map is safe (no copy on this hot path).
        for (const [ref, rec] of d.fields) {
          if (excluded(rec.site, d.tabId) || excluded(rec.topSite, d.tabId)) {
            drop = true;
            break;
          }
          // Another field typed later in the document does not extend this value's fingerprints.
          if (now - rec.updatedAt >= PROTECT_BUDGETS.fingerprintIdleTtlMs) {
            d.fields.delete(ref);
            expired = true;
          }
        }
        if (expired && !drop) this.indexes.delete(d.tabId);
      }
      if (drop) {
        this.removeDocument(d.documentKey);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Earliest moment sweep() removes something (a field's TTL, an idle document, a grace expiry); +Infinity when empty.
   * Bounded: ≤ maxFingerprintDocuments × maxTrackedFieldsPerDocument records (review PT-1: the lane's expiry timer).
   */
  nextExpiry(): number {
    let at = Number.POSITIVE_INFINITY;
    for (const d of this.docs.values()) {
      if (d.expiresAt !== null) at = Math.min(at, d.expiresAt);
      at = Math.min(at, d.lastActive + PROTECT_BUDGETS.fingerprintIdleTtlMs);
      for (const rec of d.fields.values()) at = Math.min(at, rec.updatedAt + PROTECT_BUDGETS.fingerprintIdleTtlMs);
    }
    return at;
  }

  removeDocument(documentKey: string): void {
    const d = this.docs.get(documentKey);
    if (d === undefined) return;
    this.docs.delete(documentKey);
    this.indexes.delete(d.tabId);
  }

  forgetTab(tabId: number): void {
    for (const d of [...this.docs.values()]) if (d.tabId === tabId) this.docs.delete(d.documentKey);
    this.indexes.delete(tabId);
    this.droppedByTab.delete(tabId);
  }

  clear(): void {
    this.docs.clear();
    this.indexes.clear();
    this.droppedByTab.clear();
  }

  private noteDropped(tabId: number, n: number): void {
    this.droppedByTab.set(tabId, Math.min(MAX_COUNT, (this.droppedByTab.get(tabId) ?? 0) + Math.max(1, n)));
  }

  droppedFor(tabId: number): number {
    return this.droppedByTab.get(tabId) ?? 0;
  }

  get evictionCount(): number {
    return this.evictions;
  }
}
