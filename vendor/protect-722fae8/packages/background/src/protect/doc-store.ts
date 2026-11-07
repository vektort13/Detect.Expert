// ADR-020 §8 (S04): storage.session state of the module «Защита» (TRUSTED_CONTEXTS like the observation reports).
// Keys: `protect-doc:<documentKey>` (value-free evidence and lane sections of one top-level document, ≤ 16 KiB by a
// counted estimate, never by serializing), `protect-tabs` (tab model + document index, ≤ 64 tabs) and
// `protect-runtime` (hashes of the applied DNR ranges, undo ≤ 16). Writes are debounced (500 ms) and bounded by the
// module's own total (maxProtectSessionBytes): the oldest inactive documents are evicted first. Each lane writes only
// its own section through update(). Nothing is written until the module is enabled (the store is never touched off).

import { DNR_RANGE_NAMES, MAX_COUNT, PROTECT_BUDGETS, PROTECT_LIMITATIONS, PROTECT_WIRE_LIMITS, jsonLengthUpTo } from '@detect-expert/contracts';
import type {
  DnrRangeName,
  FirewallNotice,
  FirewallPromptView,
  FirewallReceiverView,
  GpcTabFact,
  ProtectDropped,
  ProtectEvidence,
  ProtectLimitation,
  ReplaySummary,
} from '@detect-expert/contracts';
import { mergeEvidence } from '@detect-expert/engine';
import type { MergeEvidenceResult } from '@detect-expert/engine';
import type { Clock, StorageAreaLike } from '../chrome-api';

export const PROTECT_DOC_PREFIX = 'protect-doc:';
export const PROTECT_TABS_KEY = 'protect-tabs';
export const PROTECT_RUNTIME_KEY = 'protect-runtime';
/** Same TTL as the observation reports (docs/PROJECT_RULES.md #11): an inactive document is dropped after 10 minutes. */
export const PROTECT_DOC_TTL_MS = 600_000;
export const PROTECT_DOC_FLUSH_MS = 500;
/** Document index bound (the byte budget usually evicts earlier). */
export const MAX_PROTECT_DOCS = 256;
const SWEEP_EVERY_MS = 30_000;

export interface ProtectFirewallSection {
  prompt?: FirewallPromptView;
  notices: FirewallNotice[];
  receivers: FirewallReceiverView[];
}

/** One top-level document of a tab (frame facts carry frameContext / frameSite inside the evidence). */
export interface ProtectDocState {
  v: 1;
  protectRevision: number;
  createdAt: number;
  updatedAt: number;
  tabId: number;
  /** protect.js started after the document began loading (protect-hello startedLate), or the module was enabled later. */
  startedLate: boolean;
  evidence: ProtectEvidence[];
  replay?: ReplaySummary;
  gpc?: GpcTabFact;
  firewall: ProtectFirewallSection;
  /** Document-level limitations (≤ maxProjectionLimitations), canonical order. */
  limitations: ProtectLimitation[];
  dropped: ProtectDropped;
}

export type ProtectDocSection = 'evidence' | 'replay' | 'gpc' | 'firewall' | 'limitations' | 'dropped' | 'startedLate';

export interface ProtectUndoEntry {
  undoId: string;
  at: number;
  /** Lane data (firewall: the decision before/after); JSON only. */
  payload: unknown;
}

export interface ProtectRuntimeState {
  v: 1;
  dnr: Partial<Record<DnrRangeName, string>>;
  undo: ProtectUndoEntry[];
  /** Epoch ms since which the module has been active in this browser session (documents committed earlier: late-start). */
  activeSince?: number;
}

const EMPTY_DROPPED: ProtectDropped = { evidence: 0, fingerprints: 0, bodies: 0, events: 0 };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function canonicalLimitations(list: readonly ProtectLimitation[]): ProtectLimitation[] {
  const set = new Set(list);
  return PROTECT_LIMITATIONS.filter((l) => set.has(l)).slice(0, PROTECT_WIRE_LIMITS.maxProjectionLimitations);
}

/** Shape check of a stored document (our own record; a broken one is dropped, never thrown on). */
function readDoc(v: unknown): ProtectDocState | null {
  if (!isRecord(v) || v['v'] !== 1) return null;
  if (!Number.isSafeInteger(v['protectRevision']) || !Number.isSafeInteger(v['tabId']) || typeof v['createdAt'] !== 'number') return null;
  if (!Array.isArray(v['evidence']) || v['evidence'].length > PROTECT_BUDGETS.maxEvidencePerDocument) return null;
  const fw = v['firewall'];
  if (!isRecord(fw) || !Array.isArray(fw['notices']) || !Array.isArray(fw['receivers'])) return null;
  if (!Array.isArray(v['limitations']) || !isRecord(v['dropped'])) return null;
  return v as unknown as ProtectDocState;
}

function readRuntime(v: unknown): ProtectRuntimeState {
  const out: ProtectRuntimeState = { v: 1, dnr: {}, undo: [] };
  if (!isRecord(v) || v['v'] !== 1) return out;
  const dnr = v['dnr'];
  if (isRecord(dnr)) for (const r of DNR_RANGE_NAMES) if (typeof dnr[r] === 'string' && (dnr[r] as string).length <= 64) out.dnr[r] = dnr[r] as string;
  if (typeof v['activeSince'] === 'number' && Number.isFinite(v['activeSince'])) out.activeSince = v['activeSince'];
  const undo = v['undo'];
  if (Array.isArray(undo)) {
    for (const u of undo.slice(-PROTECT_BUDGETS.maxUndoEntries)) {
      if (isRecord(u) && typeof u['undoId'] === 'string' && typeof u['at'] === 'number') out.undo.push({ undoId: u['undoId'], at: u['at'], payload: u['payload'] });
    }
  }
  return out;
}

export interface ProtectDocStoreOptions {
  flushMs?: number;
  ttlMs?: number;
  maxDocBytes?: number;
  maxSessionBytes?: number;
}

export class ProtectDocStore {
  private readonly docs = new Map<string, ProtectDocState>();
  private readonly sizes = new Map<string, number>();
  private readonly dirty = new Set<string>();
  private readonly removed = new Set<string>();
  private tabs: unknown[] = [];
  private runtimeState: ProtectRuntimeState = { v: 1, dnr: {}, undo: [] };
  private indexDirty = false;
  private runtimeDirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private loaded = false;
  private lastSweep = 0;
  private failures = 0;
  private readonly flushMs: number;
  private readonly ttlMs: number;
  private readonly maxDocBytes: number;
  private readonly maxSessionBytes: number;

  constructor(
    private readonly session: StorageAreaLike,
    private readonly clock: Clock,
    /** Current top-level documents of live tabs: never evicted by TTL or the byte budget. */
    private readonly isActiveDocument: (documentKey: string) => boolean = () => false,
    options: ProtectDocStoreOptions = {},
  ) {
    this.flushMs = options.flushMs ?? PROTECT_DOC_FLUSH_MS;
    this.ttlMs = options.ttlMs ?? PROTECT_DOC_TTL_MS;
    this.maxDocBytes = options.maxDocBytes ?? PROTECT_BUDGETS.maxProtectDocBytes;
    this.maxSessionBytes = options.maxSessionBytes ?? PROTECT_BUDGETS.maxProtectSessionBytes;
  }

  get hydrated(): boolean {
    return this.loaded;
  }

  /** Reads protect-tabs and protect-runtime, then the indexed documents (module enabled only). */
  async hydrate(): Promise<{ tabs: unknown[] }> {
    if (this.loaded) return { tabs: this.tabs };
    let index: Record<string, unknown> = {};
    try {
      index = await this.session.get([PROTECT_TABS_KEY, PROTECT_RUNTIME_KEY]);
    } catch {
      index = {};
    }
    const tabsRecord = index[PROTECT_TABS_KEY];
    const keys: string[] = [];
    if (isRecord(tabsRecord) && tabsRecord['v'] === 1) {
      if (Array.isArray(tabsRecord['tabs'])) this.tabs = tabsRecord['tabs'].slice(0, 64);
      if (Array.isArray(tabsRecord['docs'])) for (const k of tabsRecord['docs'].slice(0, MAX_PROTECT_DOCS)) if (typeof k === 'string' && k.length <= 160) keys.push(k);
    }
    this.runtimeState = readRuntime(index[PROTECT_RUNTIME_KEY]);
    if (keys.length > 0) {
      let stored: Record<string, unknown> = {};
      try {
        stored = await this.session.get(keys.map((k) => PROTECT_DOC_PREFIX + k));
      } catch {
        stored = {};
      }
      for (const k of keys) {
        const doc = readDoc(stored[PROTECT_DOC_PREFIX + k]);
        if (doc === null) {
          this.removed.add(k);
          continue;
        }
        this.docs.set(k, doc);
        this.sizes.set(k, jsonLengthUpTo(doc, this.maxDocBytes * 2));
      }
    }
    this.loaded = true;
    return { tabs: this.tabs };
  }

  doc(documentKey: string): Readonly<ProtectDocState> | undefined {
    return this.docs.get(documentKey);
  }

  /** Documents of one tab, oldest first. */
  docsOfTab(tabId: number): Array<[string, Readonly<ProtectDocState>]> {
    const prefix = String(tabId) + ':';
    return [...this.docs].filter(([k]) => k.startsWith(prefix)).sort((a, b) => a[1].createdAt - b[1].createdAt);
  }

  get size(): number {
    return this.docs.size;
  }

  private fresh(tabId: number, startedLate: boolean): ProtectDocState {
    const now = this.clock.now();
    return { v: 1, protectRevision: 0, createdAt: now, updatedAt: now, tabId, startedLate, evidence: [], firewall: { notices: [], receivers: [] }, limitations: [], dropped: { ...EMPTY_DROPPED } };
  }

  /** The document's state, created when absent (bounded by MAX_PROTECT_DOCS: the oldest inactive one is evicted). */
  ensure(documentKey: string, tabId: number, startedLate = false): Readonly<ProtectDocState> {
    const existing = this.docs.get(documentKey);
    if (existing !== undefined) return existing;
    const doc = this.fresh(tabId, startedLate);
    this.docs.set(documentKey, doc);
    this.removed.delete(documentKey);
    while (this.docs.size > MAX_PROTECT_DOCS && this.evictOne(documentKey)) { /* bounded by size */ }
    this.touch(documentKey, doc);
    return doc;
  }

  /**
   * Replaces one section of a document (creating it when absent) and bumps protectRevision. Over maxProtectDocBytes
   * the oldest evidence is shed (`dropped.evidence`, `budget-exceeded`). Returns the stored state, or null when the
   * key is not a document key.
   */
  update<K extends ProtectDocSection>(documentKey: string, tabId: number, section: K, fn: (current: ProtectDocState[K], doc: Readonly<ProtectDocState>) => ProtectDocState[K]): Readonly<ProtectDocState> | null {
    if (!/^\d+:\d+:[A-Za-z0-9_-]{1,64}$/.test(documentKey)) return null;
    const cur = this.ensure(documentKey, tabId);
    const next: ProtectDocState = { ...cur, [section]: fn(cur[section], cur) };
    return this.commit(documentKey, next);
  }

  /** Adds (merges) one evidence record into the document (mergeEvidence; budget-exceeded when full). */
  addEvidence(documentKey: string, tabId: number, evidence: ProtectEvidence): MergeEvidenceResult | null {
    if (!/^\d+:\d+:[A-Za-z0-9_-]{1,64}$/.test(documentKey)) return null;
    const cur = this.ensure(documentKey, tabId);
    const result = mergeEvidence(cur.evidence, evidence, cur.dropped);
    const limitations = result.budgetExceeded ? canonicalLimitations([...cur.limitations, 'budget-exceeded']) : cur.limitations;
    this.commit(documentKey, { ...cur, evidence: result.evidence, dropped: result.dropped, limitations });
    return result;
  }

  /** Adds document-level limitation codes (canonical order, bounded). */
  addLimitations(documentKey: string, tabId: number, codes: readonly ProtectLimitation[]): void {
    this.update(documentKey, tabId, 'limitations', (cur) => canonicalLimitations([...cur, ...codes]));
  }

  private commit(documentKey: string, next: ProtectDocState): Readonly<ProtectDocState> {
    next.protectRevision = Math.min(MAX_COUNT, next.protectRevision + 1);
    next.updatedAt = this.clock.now();
    let size = jsonLengthUpTo(next, this.maxDocBytes);
    while (size > this.maxDocBytes && (next.evidence.length > 0 || next.firewall.notices.length > 0 || next.firewall.receivers.length > 0)) {
      if (next.evidence.length > 0) {
        next.evidence = next.evidence.slice(1);
        next.dropped = { ...next.dropped, evidence: Math.min(MAX_COUNT, next.dropped.evidence + 1) };
      } else if (next.firewall.notices.length > 0) next.firewall = { ...next.firewall, notices: next.firewall.notices.slice(1) };
      else next.firewall = { ...next.firewall, receivers: next.firewall.receivers.slice(1) };
      if (!next.limitations.includes('budget-exceeded')) next.limitations = canonicalLimitations([...next.limitations, 'budget-exceeded']);
      size = jsonLengthUpTo(next, this.maxDocBytes);
    }
    this.docs.set(documentKey, next);
    this.sizes.set(documentKey, size);
    this.touch(documentKey, next);
    this.enforceTotal(documentKey);
    return next;
  }

  private touch(documentKey: string, _doc: ProtectDocState): void {
    this.dirty.add(documentKey);
    this.indexDirty = true;
    this.schedule();
  }

  private totalBytes(): number {
    let total = 0;
    for (const v of this.sizes.values()) total += v;
    return total;
  }

  /** Oldest inactive document (never `keep`, never a current top-level document); false when none. */
  private evictOne(keep: string | null): boolean {
    let victim: string | null = null;
    let oldest = Number.POSITIVE_INFINITY;
    for (const [k, d] of this.docs) {
      if (k === keep || this.isActiveDocument(k)) continue;
      if (d.updatedAt < oldest) {
        oldest = d.updatedAt;
        victim = k;
      }
    }
    if (victim === null) return false;
    this.forgetDocument(victim);
    return true;
  }

  private enforceTotal(keep: string): void {
    while (this.totalBytes() > this.maxSessionBytes && this.evictOne(keep)) { /* each pass removes one document */ }
  }

  forgetDocument(documentKey: string): void {
    if (!this.docs.delete(documentKey)) return;
    this.sizes.delete(documentKey);
    this.dirty.delete(documentKey);
    this.removed.add(documentKey);
    this.indexDirty = true;
    this.schedule();
  }

  /** Tab closed: every document of the tab goes. */
  forgetTab(tabId: number): void {
    const prefix = String(tabId) + ':';
    for (const k of [...this.docs.keys()]) if (k.startsWith(prefix)) this.forgetDocument(k);
  }

  /** TTL of inactive documents (at most every 30 s; events drive it, no alarms). */
  sweep(force = false): number {
    const now = this.clock.now();
    if (!force && now - this.lastSweep < SWEEP_EVERY_MS) return 0;
    this.lastSweep = now;
    let removed = 0;
    for (const [k, d] of [...this.docs]) {
      if (this.isActiveDocument(k) || now - d.updatedAt < this.ttlMs) continue;
      this.forgetDocument(k);
      removed++;
    }
    return removed;
  }

  /** protect-tabs content (tab-model entries); persisted with the document index. */
  setTabs(entries: readonly unknown[]): void {
    this.tabs = entries.slice(-64);
    this.indexDirty = true;
    this.schedule();
  }

  runtime(): Readonly<ProtectRuntimeState> {
    return this.runtimeState;
  }

  /** Replaces protect-runtime (DNR hashes, undo ≤ maxUndoEntries within undoTtlMs). */
  updateRuntime(fn: (cur: ProtectRuntimeState) => ProtectRuntimeState): void {
    const now = this.clock.now();
    const next = fn({ ...this.runtimeState, dnr: { ...this.runtimeState.dnr }, undo: [...this.runtimeState.undo] });
    next.undo = next.undo.filter((u) => now - u.at < PROTECT_BUDGETS.undoTtlMs).slice(-PROTECT_BUDGETS.maxUndoEntries);
    this.runtimeState = next;
    this.runtimeDirty = true;
    this.schedule();
  }

  private schedule(): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.flushMs);
  }

  /** Writes dirty documents, the index and the runtime record; removes forgotten documents. One retry after a failure. */
  flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const next = this.chain.then(() => this.flushNow());
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async flushNow(): Promise<void> {
    if (this.dirty.size === 0 && this.removed.size === 0 && !this.indexDirty && !this.runtimeDirty) return;
    for (let attempt = 0; attempt < 2; attempt++) {
      const items: Record<string, unknown> = {};
      for (const k of this.dirty) {
        const d = this.docs.get(k);
        if (d !== undefined) items[PROTECT_DOC_PREFIX + k] = d;
      }
      if (this.indexDirty || this.dirty.size > 0) items[PROTECT_TABS_KEY] = { v: 1, tabs: this.tabs, docs: [...this.docs.keys()] };
      if (this.runtimeDirty) items[PROTECT_RUNTIME_KEY] = this.runtimeState;
      const removed = [...this.removed].map((k) => PROTECT_DOC_PREFIX + k);
      try {
        if (removed.length > 0) await this.session.remove(removed);
        if (Object.keys(items).length > 0) await this.session.set(items);
        for (const k of this.removed) if (!this.docs.has(k)) this.removed.delete(k);
        this.dirty.clear();
        this.indexDirty = false;
        this.runtimeDirty = false;
        return;
      } catch {
        this.failures++;
        // Quota of storage.session (shared with observation): give room by evicting two inactive documents, once.
        if (!this.evictOne(null) || !this.evictOne(null)) break;
      }
    }
  }

  /** ui-clear-session: every document goes (tabs and runtime stay). */
  async clearDocs(): Promise<void> {
    for (const k of [...this.docs.keys()]) this.forgetDocument(k);
    await this.flush();
  }

  /** Disable / purge: every protect-* key goes and the memory is reset. */
  async clearAll(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const keys = [...new Set([...this.docs.keys(), ...this.removed])].map((k) => PROTECT_DOC_PREFIX + k);
    this.docs.clear();
    this.sizes.clear();
    this.dirty.clear();
    this.removed.clear();
    this.tabs = [];
    this.runtimeState = { v: 1, dnr: {}, undo: [] };
    this.indexDirty = false;
    this.runtimeDirty = false;
    this.loaded = false;
    const run = this.chain.then(() => this.session.remove([...keys, PROTECT_TABS_KEY, PROTECT_RUNTIME_KEY]));
    this.chain = run.catch(() => undefined);
    await run;
  }

  /** Drops timers and memory without touching storage (SW shutdown in tests, module suspension). */
  stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  debug(): { docs: number; bytes: number; failures: number } {
    return { docs: this.docs.size, bytes: this.totalBytes(), failures: this.failures };
  }
}
