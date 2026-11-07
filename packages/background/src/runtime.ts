import { redactSenderContext } from './sender';
import { reportHost } from '../../attribution/src/index';
// Service-worker orchestration (spec A10, ADR-005 §5–6, ADR-011 §2, E05-02): holds the reducer state, waits
// for hydration behind a readiness promise with a bounded pending buffer, runs side effects (per-document
// serialized persistence, ACK after commit, LRU/TTL eviction, quota degradation with bounded retry).

import { createExportPreview } from '../../export/src/index';
import { BUDGETS, sanitizeHost, validateBridgeResetAck } from '@detect-expert/contracts';
import type { Ack, BridgeControlCommand, BridgeControlMessage, PageBatch, ReportProjection, UiErrorCode, UiResponse } from '@detect-expert/contracts';
import type { BackgroundChromeApi, Clock } from './chrome-api';
import { systemClock } from './chrome-api';
import {
  bindingKey,
  deriveCoverageState,
  createInitialState,
  estimateReportBytes,
  isProjected,
  planEviction,
  reduce,
  selectDocumentKey,
} from './documents';
import type { ClearFence, DocumentEvent, DocumentMeta, DocumentsState, Effect, FrameBinding, ReduceResult } from './documents';
import { noopEngine } from './engine-port';
import type { EnginePort } from './engine-port';
import { projectReport } from './projection';
import { RateLimiter } from './rate-limit';
import { SessionRepository } from './repository';
import type { StoredDocument, StoredIndex } from './repository';
import { ScopeController } from './scope';
import { readFrameType, readLifecycle } from './sender';
import type { PageSenderContext } from './sender';

export interface RuntimeOptions {
  testBootstrap?: boolean;
  engine?: EnginePort;
  clock?: Clock;
  /** Bounded buffer for browser events that arrive before hydration finished. */
  maxPendingEvents?: number;
  /** Debounce for non-critical persists (network hosts, lifecycle changes). */
  persistDebounceMs?: number;
  /** TTL sweep period; 0 disables the timer (tests call ttlTick()). */
  ttlIntervalMs?: number;
  maxPersistAttempts?: number;
}

export interface RuntimeDiagnostics {
  ready: boolean;
  pendingDropped: number;
  persistFailures: number;
  degraded: boolean;
  estimatedBytes: number;
  lastMeasuredBytes: number | null;
  reports: number;
  quarantine: number;
  orphanBatches: number;
  unattributedRequests: number;
  lifecycleFallbackCommits: number;
  engineFailures: number;
}

type Timer = ReturnType<typeof setTimeout>;

export function uiError(code: UiErrorCode): UiResponse {
  return { schemaVersion: 1, type: 'error', code };
}

function ack(lastCommittedBatchSeq: number, paused: boolean, protocolOk: boolean): Ack {
  return { schemaVersion: 1, type: 'ack', lastCommittedBatchSeq, paused, protocolOk };
}

export class BackgroundRuntime {
  state: DocumentsState = createInitialState();
  readonly scope: ScopeController;
  readonly repository: SessionRepository;
  readonly limiter = new RateLimiter();
  readonly api: BackgroundChromeApi;

  private readonly engine: EnginePort;
  private readonly clock: Clock;
  private readonly maxPending: number;
  private readonly persistDebounceMs: number;
  private readonly ttlIntervalMs: number;
  private readonly maxPersistAttempts: number;

  private readonly ready: Promise<void>;
  private resolveReady: () => void = () => undefined;
  private isReady = false;
  private started = false;
  private historyLoaded = false;
  private historyLoading: Promise<void> | null = null;
  private readonly pending: DocumentEvent[] = [];
  private pendingDropped = 0;
  private pendingBatches = 0;

  /** P07 / ADR-005: bound validated messages retained across the shared readiness promise. */
  async batchReadiness(documentKey: string): Promise<boolean> {
    if (this.isReady && this.historyLoaded && this.historyLoading === null) return true;
    if (this.pendingBatches >= BUDGETS.maxOutOfOrderEntriesGlobal) {
      this.pendingDropped = Math.min(BUDGETS.maxCount, this.pendingDropped + 1);
      this.countTransportDrop(documentKey);
      return false;
    }
    this.pendingBatches++;
    // Recovery must precede the handler's scope check, otherwise an uninitialized scope falsely revokes actors.
    try { await this.ready; await this.ensureHistory(); return true; }
    finally { this.pendingBatches--; }
  }

  private readonly dirtyDocs = new Set<string>();
  private indexDirty = false;
  private indexRevision = 0;
  private indexTimer: Timer | null = null;
  private readonly persistTimers = new Map<string, Timer>();
  /** Last watermark that reached storage per document (ACK reports this, never the in-memory one). */
  private readonly persisted = new Map<string, ReadonlyMap<string, number>>();
  private readonly transportDrops = new Map<string, number>();
  /** Native reset promises cannot be cancelled: hold their physical slot until actual settlement. */
  private readonly resetRequests = new Map<string, Promise<unknown>>();
  private readonly clearingDocs = new Set<string>();
  private readonly estimated = new Map<string, number>();
  private lastMeasuredBytes: number | null = null;
  private lastBudgetCheck = 0;
  private budgetCheckRunning = false;
  private persistFailures = 0;
  private persistCooldownUntil = 0;
  private degraded = false;
  private ttlTimer: Timer | null = null;
  private lastSweepAt = -Infinity;

  constructor(api: BackgroundChromeApi, options: RuntimeOptions = {}) {
    this.api = api;
    this.engine = options.engine ?? noopEngine;
    this.clock = options.clock ?? systemClock;
    this.maxPending = options.maxPendingEvents ?? 256;
    this.persistDebounceMs = options.persistDebounceMs ?? BUDGETS.flushMaxMs;
    this.ttlIntervalMs = options.ttlIntervalMs ?? 60_000;
    this.maxPersistAttempts = Math.max(1, Math.min(3, options.maxPersistAttempts ?? 3));
    this.scope = new ScopeController(api, this.clock, options.testBootstrap);
    this.repository = new SessionRepository(api.storage.session);
    this.ready = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });
  }

  now(): number {
    return this.clock.now();
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  // ---------------------------------------------------------------------------
  // Hydration (A10): restore snapshots, bindings and watermarks, reconcile with live frames, then drain.
  // ---------------------------------------------------------------------------

  async start(): Promise<void> {
    if (this.started) return this.ready;
    this.started = true;
    try {
      await this.repository.init();
      await this.ensureHistory();
    } catch {
      // Listeners remain available, but ingress/persistence stays closed until authority retry succeeds.
      this.degraded = true;
    }
    this.isReady = true;
    this.resolveReady();
    this.ttlTick();
    if (this.ttlIntervalMs > 0 && this.ttlTimer === null) {
      this.ttlTimer = setInterval(() => this.ttlTick(), this.ttlIntervalMs);
    }
  }

  /** Shared bounded retry: never treat an unread/malformed clear authority as an empty journal. */
  private async ensureHistory(): Promise<void> {
    if (this.historyLoading !== null) return this.historyLoading;
    if (this.historyLoaded) return;
    const attempt = (async () => {
      const loaded = await this.repository.loadAll();
      await this.scope.startup();
      this.hydrate(loaded.index, loaded.documents);
      this.historyLoaded = true;
      await this.reconcile();
      this.reconcileAccess();
      const buffered = this.pending.splice(0, this.pending.length);
      for (const event of buffered) this.apply(event);
      this.reconcileAccess();
      for (const key of this.transportDrops.keys()) this.schedulePersist(key);
    })();
    this.historyLoading = attempt;
    try { await attempt; }
    catch (error) {
      this.historyLoaded = false;
      this.state = createInitialState();
      this.persisted.clear();
      this.estimated.clear();
      this.documentAccess.clear();
      this.degraded = true;
      throw error;
    } finally { if (this.historyLoading === attempt) this.historyLoading = null; }
  }

  private readonly documentAccess = new Map<string, number>();
  private hasDocumentAccess(key: string): boolean {
    return this.scope.accessReady && this.documentAccess.get(key) === this.scope.accessGeneration;
  }
  private grantDocumentAccess(key: string): void {
    if (this.scope.accessReady) this.documentAccess.set(key, this.scope.accessGeneration);
  }

  private hydrate(index: StoredIndex | null, documents: StoredDocument[]): void {
    const reports = new Map(this.state.reports);
    const metas = new Map(this.state.metas);
    const bindings = new Map(this.state.bindings);
    const tabs = new Map(this.state.tabs);
    for (const doc of documents) {
      const meta: DocumentMeta = { ...doc.meta, bound: doc.meta.bound };
      // P01: repository migrates legacy hosts before hydration.
      if (Object.keys(meta.folded).length > 0) { meta.boots = []; meta.folded = {}; meta.degraded = true; doc.report.coverageFlags = ['truncated']; }
      meta.findingsCap ??= BUDGETS.maxFindingsPerDocument;
      reports.set(doc.report.documentKey, doc.report);
      metas.set(doc.report.documentKey, meta);
      this.persisted.set(doc.report.documentKey, new Map(meta.sessions.map((w) => [w.bridgeSessionId, w.lastCommittedBatchSeq])));
      this.estimated.set(doc.report.documentKey, estimateReportBytes(doc.report, meta));
    }
    if (index !== null) {
      for (const b of index.bindings) {
        const isPrerender = b.documentLifecycle === 'prerender';
        bindings.set(String(b.tabId) + ':' + String(b.frameId) + (isPrerender ? ':p' : ''), b);
        const meta = metas.get(b.documentKey);
        if (meta !== undefined && meta.bound) metas.set(b.documentKey, { ...meta, bound: true });
      }
      for (const t of index.tabs) tabs.set(t.tabId, t);
    }
    this.state = { ...this.state, reports, metas, bindings, tabs, evictedKeys: index?.evictedKeys ?? [] };
  }

  /** Reconciliation with tabs.query + webNavigation.getAllFrames (ADR-005 §6); stale bindings are dropped. */
  private async reconcile(): Promise<void> {
    const live = new Set<string>();
    const liveDocuments = new Set<string>();
    const unavailableTabs = new Set<number>();
    const commits: DocumentEvent[] = [];
    let tabs: Array<{ id?: number | undefined }> = [];
    try {
      tabs = await this.api.tabs.query({});
    } catch {
      this.sweepExpired(this.now());
      return;
    }
    for (const tab of tabs) {
      if (typeof tab.id !== 'number' || tab.id < 0) continue;
      let frames: Awaited<ReturnType<BackgroundChromeApi['webNavigation']['getAllFrames']>> = null;
      try {
        frames = await this.api.webNavigation.getAllFrames({ tabId: tab.id });
      } catch {
        frames = null;
      }
      if (!Array.isArray(frames)) {
        unavailableTabs.add(tab.id);
        this.degraded = true;
        continue;
      }
      for (const f of frames) {
        if (typeof f.documentId !== 'string' || typeof f.frameId !== 'number') continue;
        if (f.frameId === 0) live.add(String(tab.id) + ':' + f.documentId);
        liveDocuments.add(String(tab.id) + ':' + f.frameId + ':' + f.documentId);
        commits.push({
          type: 'navigation:committed',
          tabId: tab.id,
          frameId: f.frameId,
          documentId: f.documentId,
          parentDocumentId: typeof f.parentDocumentId === 'string' ? f.parentDocumentId : null,
          frameType: readFrameType(f.frameType),
          documentLifecycle: readLifecycle(f.documentLifecycle),
          host: sanitizeHost(f.url),
          ...(f.url.startsWith('https://') ? { scheme: 'https' as const } : f.url.startsWith('http://') ? { scheme: 'http' as const } : {}),
          at: this.now(),
        });
      }
    }
    await this.scope.reconcileActiveTabs(live);
    // P02: a stopped close cleanup can leave tab projections in the saved index.
    const liveTabIds = new Set(tabs.flatMap((tab) => typeof tab.id === 'number' ? [tab.id] : []));
    const projections = new Map(this.state.tabs);
    for (const id of projections.keys()) if (!liveTabIds.has(id)) projections.delete(id);
    if (projections.size !== this.state.tabs.size) {
      this.state = { ...this.state, tabs: projections };
      this.markIndexDirty();
      this.scheduleIndexFlush();
    }
    // Bindings that no live frame refreshed belong to documents that are gone: unbind (TTL cleans up).
    const stale: FrameBinding[] = [];
    for (const b of this.state.bindings.values()) if (!unavailableTabs.has(b.tabId) && !liveDocuments.has(b.documentKey)) stale.push(b);
    const staleMetas = [...this.state.metas.values()].filter((meta) => meta.bound &&
      !unavailableTabs.has(this.state.reports.get(meta.documentKey)?.tabId ?? -1) && !liveDocuments.has(meta.documentKey));
    if (stale.length > 0 || staleMetas.length > 0) {
      const bindings = new Map(this.state.bindings);
      const metas = new Map(this.state.metas);
      for (const b of stale) {
        for (const [k, v] of bindings) if (v === b) bindings.delete(k);
      }
      for (const meta of staleMetas) {
        metas.set(meta.documentKey, { ...meta, bound: false });
        this.dirtyDocs.add(meta.documentKey);
        this.schedulePersist(meta.documentKey);
      }
      this.state = { ...this.state, bindings, metas };
      this.markIndexDirty();
      this.scheduleIndexFlush();
    }
    // P02 / F171: one startup scan after stale bindings are detached, before live rebind refreshes history.
    this.sweepExpired(this.now());
    for (const event of commits) this.apply(event);
  }

  // ---------------------------------------------------------------------------
  // Event application and effects
  // ---------------------------------------------------------------------------

  /** Browser events: buffered (bounded) until hydration finished, then applied in order. */
  dispatch(event: DocumentEvent): void {
    // Raw navigation hosts are consumed synchronously, never queued before startup.
    if (event.type === 'navigation:before') event = { ...event, host: null };
    if (event.type === 'navigation:committed') {
      const accessGranted = this.scope.accessReady && this.scope.inScope(event.host, event.tabId, event.documentId, event.scheme);
      const top = event.frameType === 'outermost_frame' || (event.frameType === null && event.frameId === 0);
      if (top && event.documentLifecycle !== 'prerender' && this.scope.noteTopCommit(event.tabId, event.host, event.documentId)) {
        for (const key of this.documentAccess.keys()) if (key.startsWith(String(event.tabId) + ':')) this.documentAccess.delete(key);
        this.reconcileAccess();
      }
      event = { ...event, host: reportHost(event.host), accessGranted };
    }
    if (!this.isReady || !this.historyLoaded || this.historyLoading !== null) {
      if (this.pending.length >= this.maxPending) {
        this.pending.shift();
        this.pendingDropped++;
      }
      this.pending.push(event);
      return;
    }
    if (event.type === 'navigation:committed' || event.type === 'tab:removed') this.sweepExpired(this.now());
    this.apply(event);
  }

  /** Synchronous reduce + state swap; effects are scheduled (persists queued per document). */
  private apply(event: DocumentEvent, inQueueFor: string | null = null): ReduceResult {
    if (!this.historyLoaded) return { state: this.state, effects: [] };
    let accessExpired = false;
    if (event.type === 'navigation:before') event = { ...event, host: null };
    if (event.type === 'navigation:committed') {
      const top = event.frameType === 'outermost_frame' || (event.frameType === null && event.frameId === 0);
      if (top && event.documentLifecycle !== 'prerender') accessExpired = this.scope.noteTopCommit(event.tabId, event.host, event.documentId);
      const accessGranted = (!this.isReady && this.hasDocumentAccess(String(event.tabId) + ':' + event.frameId + ':' + event.documentId)) || (event.accessGranted ?? (this.scope.accessReady && this.scope.inScope(event.host, event.tabId, event.documentId, event.scheme)));
      const accessKey = String(event.tabId) + ':' + event.frameId + ':' + event.documentId;
      if (accessGranted) this.grantDocumentAccess(accessKey); else this.documentAccess.delete(accessKey);
      event = { ...event, host: accessGranted ? reportHost(event.host) : null, accessGranted };
    }
    if (event.type === 'network:host') {
      const parent = event.resourceType === 'sub_frame' && event.parentDocumentId !== null && event.parentFrameId !== null && event.parentFrameId >= 0;
      const documentId = parent ? event.parentDocumentId : event.documentId;
      const frameId = parent ? event.parentFrameId : event.frameId;
      const binding = [...this.state.bindings.values()].find((b) => b.tabId === event.tabId && b.frameId === frameId && b.documentId === documentId);
      if (!binding || !this.hasDocumentAccess(binding.documentKey)) return { state: this.state, effects: [] };
    }
    if (event.type === 'tab:removed') for (const key of this.documentAccess.keys()) if (key.startsWith(String(event.tabId) + ':')) this.documentAccess.delete(key);
    const result = reduce(this.state, event, this.engine);
    this.state = result.state;
    if (event.type === 'navigation:committed') {
      const key = String(event.tabId) + ':' + event.frameId + ':' + event.documentId;
      const fence = this.repository.clearFence(key);
      if (fence !== undefined && this.state.metas.get(key)?.clearEpoch !== fence.bridgeSessionId) {
        this.state = reduce(this.state, { type: 'ui:clear', documentKey: key, fence, at: this.now() }, this.engine).state;
      }
    }
    if (this.documentAccess.size > 1024) { this.documentAccess.clear(); this.reconcileAccess(); }
    this.runEffects(result.effects, inQueueFor);
    if (accessExpired) this.reconcileAccess();
    return result;
  }

  private runEffects(effects: readonly Effect[], inQueueFor: string | null): void {
    for (const effect of effects) {
      switch (effect.type) {
        case 'persist':
          this.dirtyDocs.add(effect.documentKey);
          if (effect.documentKey === inQueueFor) break; // the caller persists inside the queue
          if (effect.immediate) this.queuePersist(effect.documentKey);
          else this.schedulePersist(effect.documentKey);
          break;
        case 'remove':
          for (const key of effect.documentKeys) this.queueRemove(key);
          break;
        case 'persist-index':
          this.markIndexDirty();
          this.scheduleIndexFlush();
          break;
      }
    }
  }

  private queuePersist(documentKey: string): void {
    const timer = this.persistTimers.get(documentKey);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.persistTimers.delete(documentKey);
    }
    void this.repository.run(documentKey, () => this.persistNow(documentKey));
  }

  private schedulePersist(documentKey: string): void {
    if (this.persistTimers.has(documentKey)) return;
    const timer = setTimeout(() => {
      this.persistTimers.delete(documentKey);
      void this.repository.run(documentKey, () => this.persistNow(documentKey));
    }, this.persistDebounceMs);
    this.persistTimers.set(documentKey, timer);
  }

  private queueRemove(documentKey: string): void {
    const timer = this.persistTimers.get(documentKey);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.persistTimers.delete(documentKey);
    }
    this.dirtyDocs.delete(documentKey);
    this.persisted.delete(documentKey);
    this.estimated.delete(documentKey);
    void this.repository.run(documentKey, async () => {
      // Keep routing-only fences while the tab can still restore a cached document; no report payload remains.
      const tabId = Number(documentKey.split(':', 1)[0]);
      await this.repository.remove([documentKey], !this.state.tabs.has(tabId));
    });
    this.markIndexDirty();
    this.scheduleIndexFlush();
  }

  private markIndexDirty(): void {
    this.indexDirty = true;
    this.indexRevision++;
  }

  private scheduleIndexFlush(): void {
    if (this.indexTimer !== null) return;
    this.indexTimer = setTimeout(() => {
      this.indexTimer = null;
      void this.flushIndex();
    }, BUDGETS.flushMinMs);
  }

  /** Flushes the index unless a document commit already carried it. */
  async flushIndex(): Promise<void> {
    if (!this.historyLoaded) return;
    if (!this.indexDirty || this.now() < this.persistCooldownUntil) return;
    const revision = this.indexRevision;
    const ok = await this.repository.saveIndex(this.buildIndex());
    if (ok && revision === this.indexRevision) this.indexDirty = false;
  }

  buildIndex(): StoredIndex {
    return { v: 1, evictedKeys: [...this.state.evictedKeys], bindings: [...this.state.bindings.values()].map((b) => ({ ...b, boundAt: Math.floor(b.boundAt / 1000) * 1000 })), tabs: [...this.state.tabs.values()], savedAt: Math.floor(this.now() / 1000) * 1000 };
  }

  /**
   * Persists one document (must run inside its queue). Bounded: at most maxPersistAttempts set() calls;
   * on quota/storage errors the document is degraded+truncated and LRU inactive documents are evicted
   * between attempts. Returns false when storage kept failing (in-memory state stays, ACK stays behind).
   */
  async persistNow(documentKey: string): Promise<boolean> {
    if (!this.historyLoaded) return false;
    if (this.now() < this.persistCooldownUntil) return false;
    this.foldTransportDrops(documentKey);
    // P07: covers immediate commits and quarantine replay. The flag proves at least one eviction,
    // including clean entries; it cannot quantify permanently lost observations on the v1 wire.
    const overflow = this.state.reports.get(documentKey);
    if (overflow?.coverageFlags.includes('bridge-ring-overflow') && (overflow.dropped.ring ?? 0) === 0) {
      this.state = { ...this.state, reports: new Map(this.state.reports).set(documentKey,
        { ...overflow, revision: Math.min(BUDGETS.maxCount, overflow.revision + 1), dropped: { ...overflow.dropped, ring: 1 } }) };
    }
    for (let attempt = 0; attempt < this.maxPersistAttempts; attempt++) {
      const report = this.state.reports.get(documentKey);
      const meta = this.state.metas.get(documentKey);
      if (report === undefined || meta === undefined) {
        this.dirtyDocs.delete(documentKey);
        return true;
      }
      let estimate = estimateReportBytes(report, meta);
      for (let shrink = 0; estimate > BUDGETS.maxReportSerializedBytes && shrink < 9; shrink++) {
        this.apply({ type: 'document:degraded', documentKey, truncate: true, at: this.now() }, documentKey);
        const r2 = this.state.reports.get(documentKey);
        const m2 = this.state.metas.get(documentKey);
        if (r2 === undefined || m2 === undefined) return true;
        estimate = estimateReportBytes(r2, m2);
      }
      if (estimate > BUDGETS.maxReportSerializedBytes) { this.degraded = true; return false; }
      const current = this.state.reports.get(documentKey);
      const currentMeta = this.state.metas.get(documentKey);
      if (current === undefined || currentMeta === undefined) return true;
      const record: StoredDocument = { v: 1, report: current, meta: currentMeta };
      const indexRevision = this.indexRevision;
      const index = this.indexDirty ? this.buildIndex() : null;
      const result = await this.repository.commit(documentKey, record, index);
      if (result.ok) {
        if (this.state.reports.get(documentKey) === current) this.dirtyDocs.delete(documentKey);
        if (index !== null && indexRevision === this.indexRevision) this.indexDirty = false;
        this.estimated.set(documentKey, estimate);
        this.persisted.set(documentKey, new Map(currentMeta.sessions.map((w) => [w.bridgeSessionId, w.lastCommittedBatchSeq])));
        void this.enforceTotalBudget();
        return true;
      }
      this.persistFailures++;
      this.degraded = true;
      // Quota/error path (A10): degraded + truncated, evict inactive LRU documents, bounded retry.
      this.apply({ type: 'document:degraded', documentKey, truncate: true, at: this.now() }, documentKey);
      const victims = planEviction(this.state, new Set([documentKey])).slice(0, 8);
      if (victims.length > 0) {
        this.apply({ type: 'document:evict', documentKeys: victims, at: this.now() }, documentKey);
        await this.repository.remove(victims);
      }
    }
    this.persistCooldownUntil = this.now() + 5000;
    return false;
  }

  /** Total session budget (4 MiB): getBytesInUse when available, else the structural estimate. Throttled. */
  async enforceTotalBudget(force = false): Promise<void> {
    const now = this.now();
    if (this.budgetCheckRunning) return;
    if (!force && now - this.lastBudgetCheck < 1000) return;
    this.budgetCheckRunning = true;
    this.lastBudgetCheck = now;
    try {
      const measured = await this.repository.bytesInUse();
      this.lastMeasuredBytes = measured;
      let bytes = measured ?? this.estimatedTotal();
      if (bytes <= BUDGETS.maxSessionTotalBytes) return;
      const candidates = planEviction(this.state);
      for (const key of candidates) {
        if (bytes <= BUDGETS.maxSessionTotalBytes) break;
        // A10: subtract Chrome's memory estimate too, not a JSON length from a measured total.
        const size = measured === null ? null : await this.repository.bytesInUse(['doc:' + key]);
        const report = this.state.reports.get(key);
        const meta = this.state.metas.get(key);
        // Navigation/TTL can change a candidate during the storage await. Never evict a newly active report.
        if (!report || !meta || isProjected(this.state, key)) continue;
        bytes -= size ?? this.estimated.get(key) ?? estimateReportBytes(report, meta);
        this.apply({ type: 'document:evict', documentKeys: [key], at: now });
      }
      if (bytes > BUDGETS.maxSessionTotalBytes) {
        // Wait for queued removals, including concurrent close/TTL, before degrading surviving projections.
        await Promise.all(candidates.map((key) => this.repository.run(key, async () => undefined)));
        const remaining = await this.repository.bytesInUse();
        this.lastMeasuredBytes = remaining;
        bytes = remaining ?? this.estimatedTotal();
        if (bytes <= BUDGETS.maxSessionTotalBytes) return;
        // Only projected documents left: shrink their details (ADR-011 §2), summary counters continue.
        const projected = [...this.state.metas.keys()].filter((k) => isProjected(this.state, k));
        projected.sort((a, b) => (this.estimated.get(b) ?? 0) - (this.estimated.get(a) ?? 0));
        for (const key of projected.slice(0, 4)) {
          this.apply({ type: 'document:degraded', documentKey: key, truncate: true, at: now });
          this.queuePersist(key);
        }
      }
    } finally {
      this.budgetCheckRunning = false;
    }
  }

  /** Sum of the exact sizes measured at each persist (docs/PROJECT_RULES.md: no re-serialization of every report per check). */
  private estimatedTotal(): number {
    let total = this.repository.clearFenceBytes;
    for (const v of this.estimated.values()) total += v;
    return total;
  }

  ttlTick(): void {
    if (!this.isReady) return;
    this.sweepExpired(this.now());
  }

  /** P02 / F171: events resume retention after SW suspension; at most one scan per 30 seconds. */
  sweepExpired(now: number): void {
    if (!this.historyLoaded) return;
    if (now >= this.lastSweepAt && now - this.lastSweepAt < 30_000) return;
    this.lastSweepAt = now;
    this.apply({ type: 'ttl-tick', at: now });
  }

  stop(): void {
    if (this.ttlTimer !== null) {
      clearInterval(this.ttlTimer);
      this.ttlTimer = null;
    }
    if (this.indexTimer !== null) {
      clearTimeout(this.indexTimer);
      this.indexTimer = null;
    }
    for (const t of this.persistTimers.values()) clearTimeout(t);
    this.persistTimers.clear();
  }

  // ---------------------------------------------------------------------------
  // Content channel
  // ---------------------------------------------------------------------------

  private persistedSeq(documentKey: string, bridgeSessionId: string): number {
    return this.persisted.get(documentKey)?.get(bridgeSessionId) ?? 0;
  }

  lastPersistedSeq(documentKey: string, bridgeSessionId?: string): number {
    if (bridgeSessionId !== undefined) return this.persistedSeq(documentKey, bridgeSessionId);
    const id = this.state.reports.get(documentKey)?.watermark?.bridgeSessionId;
    return id === undefined ? 0 : this.persistedSeq(documentKey, id);
  }

  isPaused(documentKey: string): boolean {
    return this.state.metas.get(documentKey)?.paused === true;
  }

  /** Rejected/throttled input costs the document a transport drop and the `throttled` flag. */
  countTransportDrop(documentKey: string): void {
    const meta = this.state.metas.get(documentKey);
    if (this.isReady && (!meta || meta.revoked || meta.accessGranted === false)) return;
    if (!this.transportDrops.has(documentKey) && this.transportDrops.size >= 1024) return;
    this.transportDrops.set(documentKey, Math.min(BUDGETS.maxCount, (this.transportDrops.get(documentKey) ?? 0) + 1));
    if (this.isReady) this.schedulePersist(documentKey);
  }

  private foldTransportDrops(documentKey: string): void {
    const count = this.transportDrops.get(documentKey);
    if (count === undefined) return;
    this.transportDrops.delete(documentKey);
    this.apply({ type: 'transport:dropped', documentKey, count, at: this.now() }, documentKey);
  }

  admitBatch(ctx: PageSenderContext): boolean {
    if (this.isReady) this.sweepExpired(this.now());
    const allowed = this.limiter.tryConsume(ctx.documentKey, ctx.tabId, this.now());
    if (!allowed) this.countTransportDrop(ctx.documentKey);
    return allowed;
  }

  /** Validated batch from a verified page sender: dedup -> merge -> engine -> save -> ACK (REQ-009). */
  async handleBatch(ctx: PageSenderContext, batch: PageBatch, admitted = false): Promise<Ack> {
    await this.ready;
    await this.ensureHistory();
    this.sweepExpired(this.now());
    if (!this.scope.accessReady) throw new Error('access-changing');
    if (ctx.originPattern !== null) {
      if (!this.scope.inScope(ctx.host, ctx.tabId, ctx.documentId, ctx.originPattern.startsWith('https:') ? 'https' : 'http')) return { ...ack(0, true, true), stopReason: 'revoked' };
      this.grantDocumentAccess(ctx.documentKey);
    }
    ctx = redactSenderContext(ctx);
    if (!admitted && !this.admitBatch(ctx)) {
      return ack(this.persistedSeq(ctx.documentKey, batch.bridgeSessionId), this.isPaused(ctx.documentKey), true);
    }
    return this.repository.run(ctx.documentKey, async () => {
      if (!this.scope.accessReady || (!this.hasDocumentAccess(ctx.documentKey) && this.state.metas.get(ctx.documentKey)?.accessGranted !== false && !this.state.metas.get(ctx.documentKey)?.revoked)) throw new Error('access-changing');
      if (!this.hasDocumentAccess(ctx.documentKey)) return { ...ack(0, true, true), stopReason: 'revoked' };
      const meta = this.state.metas.get(ctx.documentKey);
      // A verified restored/regranted document is active before its deferred clear reset is completed.
      if (meta?.accessGranted === false || meta?.revoked) this.apply({ type: 'scope:access', documentKey: ctx.documentKey, host: ctx.host, accessGranted: true, at: this.now() }, ctx.documentKey);
      if (meta?.clearEpoch !== undefined && meta.clearBootIds?.length === 0 && meta.bound) {
        // Completion of an earlier user-authorized clear for an actor that was inactive at commit time.
        await this.commitClear([ctx.documentKey]);
        return ack(0, false, true);
      }
      this.foldTransportDrops(ctx.documentKey);
      const result = this.apply({ type: 'batch', sender: ctx, batch, at: this.now() }, ctx.documentKey);
      const outcome = result.batch;
      if (outcome === undefined) return ack(0, false, true);
      switch (outcome.status) {
        case 'committed': {
          const ok = await this.persistNow(ctx.documentKey);
          if (!this.scope.accessReady || (!this.hasDocumentAccess(ctx.documentKey) && this.state.metas.get(ctx.documentKey)?.accessGranted !== false && !this.state.metas.get(ctx.documentKey)?.revoked)) throw new Error('access-changing');
          if (!this.hasDocumentAccess(ctx.documentKey)) return { ...ack(0, true, true), stopReason: 'revoked' };
          return ack(ok ? outcome.lastCommittedBatchSeq : this.persistedSeq(ctx.documentKey, batch.bridgeSessionId), false, true);
        }
        case 'duplicate': {
          // A duplicate after a failed persist retries the (bounded) write instead of looping forever.
          if (this.dirtyDocs.has(ctx.documentKey)) await this.persistNow(ctx.documentKey);
          return ack(this.persistedSeq(ctx.documentKey, batch.bridgeSessionId), false, true);
        }
        case 'paused':
          return ack(this.persistedSeq(ctx.documentKey, batch.bridgeSessionId), true, true);
        case 'revoked':
          return { ...ack(0, true, true), stopReason: 'revoked' };
        case 'quarantined':
          return ack(0, false, true);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // UI channel (read-only projections; pause/resume/clear/export verified against documentKey + revision)
  // ---------------------------------------------------------------------------

  getProjection(tabId: number, frameId?: number): ReportProjection | null {
    const key = selectDocumentKey(this.state, tabId, frameId);
    if (key === null) return null;
    return this.projectionByKey(key);
  }

  projectionByKey(documentKey: string): ReportProjection | null {
    // A clear's durable revision floor must exceed every visible pre-clear revision, including during awaits.
    if (this.clearingDocs.has(documentKey)) return null;
    const report = this.state.reports.get(documentKey);
    const meta = this.state.metas.get(documentKey);
    if (report === undefined || meta === undefined || (meta.cleared && !meta.paused)) return null;
    const pending = this.transportDrops.get(documentKey) ?? 0;
    let flags = pending > 0 && !report.coverageFlags.includes('throttled') ? [...report.coverageFlags, 'throttled' as const] : report.coverageFlags;
    // F162 / REQ-006: a document nobody injected into is not "partially observed". When no sensor ever connected,
    // no late injection happened and the browser has no registration covering the host, the honest state is
    // no-access (the extension does not run on this page), never partial.
    let stateMeta: DocumentMeta = meta;
    if (!meta.sensorSeen && !meta.lateInjection && report.watermark === null && !meta.revoked && meta.accessGranted !== false) {
      if (!flags.includes('no-host-permission')) flags = [...flags, 'no-host-permission' as const];
      stateMeta = { ...meta, accessGranted: false };
    }
    try {
      return projectReport({ ...report, coverageFlags: flags, coverageState: deriveCoverageState(flags, stateMeta),
        dropped: { ...report.dropped, transport: Math.min(BUDGETS.maxCount, report.dropped.transport + pending) } }, meta, this.scope.getScopeMode());
    } catch { return null; }
  }

  /**
   * SW -> bridge control (ADR-004 changelog, F030): tells the document's ISOLATED bridge to pause/resume at once.
   * Best effort: a document without a bridge has no listener, and a paused bridge never sends, so an Ack could
   * never carry `paused: false` on its own.
   */
  private sendControl(documentKey: string, command: Exclude<BridgeControlCommand, 'reset'>): void {
    const report = this.state.reports.get(documentKey);
    if (report === undefined) return;
    const message: BridgeControlMessage = { schemaVersion: 1, type: 'bridge-control', command };
    try {
      void this.api.tabs.sendMessage(report.tabId, message, { frameId: report.frameId, documentId: report.documentId }).catch(() => undefined);
    } catch {
      // No such tab / no listener: the bridge learns the state from its next Ack instead.
    }
  }

  private checkDocument(tabId: number, documentKey: string, reportRevision: number | null): UiErrorCode | null {
    const report = this.state.reports.get(documentKey);
    const meta = this.state.metas.get(documentKey);
    if (report === undefined || (meta?.cleared && !meta.paused)) return 'not-found';
    if (report.tabId !== tabId) return 'document-mismatch';
    if (reportRevision !== null && report.revision !== reportRevision) return 'stale-revision';
    return null;
  }

  async pause(tabId: number, documentKey: string, reportRevision: number): Promise<UiResponse> {
    await this.ready;
    await this.ensureHistory();
    return this.repository.run(documentKey, async () => {
      const error = this.checkDocument(tabId, documentKey, reportRevision);
      if (error !== null) return uiError(error);
      this.apply({ type: 'ui:pause', documentKey, at: this.now() }, documentKey);
      await this.persistNow(documentKey);
      this.sendControl(documentKey, 'pause');
      return { schemaVersion: 1, type: 'ok', reportRevision: this.state.reports.get(documentKey)?.revision ?? null };
    });
  }

  async resume(tabId: number, documentKey: string, reportRevision: number): Promise<UiResponse> {
    await this.ready;
    await this.ensureHistory();
    return this.repository.run(documentKey, async () => {
      const error = this.checkDocument(tabId, documentKey, reportRevision);
      if (error !== null) return uiError(error);
      this.apply({ type: 'ui:resume', documentKey, at: this.now() }, documentKey);
      await this.persistNow(documentKey);
      this.sendControl(documentKey, 'resume');
      return { schemaVersion: 1, type: 'ok', reportRevision: this.state.reports.get(documentKey)?.revision ?? null };
    });
  }

  async clear(tabId: number, documentKey: string, reportRevision: number): Promise<UiResponse> {
    await this.ready;
    await this.ensureHistory();
    return this.repository.run(documentKey, async () => {
      const error = this.checkDocument(tabId, documentKey, reportRevision);
      if (error !== null) return uiError(error);
      await this.commitClear([documentKey]);
      return { schemaVersion: 1, type: 'ok', reportRevision: null };
    });
  }

  /**
   * ui-clear-session (options page): discard visible history atomically, retaining only bounded reset/ACK
   * metadata so cumulative replay cannot restore it after worker restart. Scope/bindings stay unchanged.
   */
  async clearSession(): Promise<UiResponse> {
    await this.ready;
    await this.ensureHistory();
    const keys = [...this.state.reports.keys()];
    await this.repository.runMany(keys, () => this.commitClear(keys));
    return { schemaVersion: 1, type: 'ok', reportRevision: null };
  }

  /** CORE-01/02: one durable replacement before success; failed storage leaves the old visible state intact. */
  private async commitClear(keys: readonly string[]): Promise<void> {
    for (const key of keys) this.clearingDocs.add(key);
    try { await this.commitClearRecords(keys); }
    finally { for (const key of keys) this.clearingDocs.delete(key); }
  }

  private async commitClearRecords(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    const at = this.now();
    const fences: ClearFence[] = [];
    try {
      for (const key of keys) if (this.state.reports.has(key) && this.state.metas.has(key)) fences.push(await this.resetHistoryActor(key));
    } catch (error) {
      for (const key of keys) this.apply({ type: 'transport:dropped', documentKey: key, count: 1, at: this.now() }, key);
      throw error;
    }
    if (fences.length === 0) return;
    for (const fence of fences) fence.reportRevision = Math.min(BUDGETS.maxCount, (this.state.reports.get(fence.documentKey)?.revision ?? fence.reportRevision) + 1);
    let result: { committed: boolean; cleaned: boolean };
    try { result = await this.repository.commitClear(fences, this.estimatedTotal()); }
    catch { result = { committed: false, cleaned: false }; }
    if (!result.committed) {
      this.persistFailures++;
      this.degraded = true;
      for (const key of keys) this.apply({ type: 'transport:dropped', documentKey: key, count: 1, at: this.now() }, key);
      // The existing listener returns a generic error for rejected routes; never a false clear success.
      throw new Error('clear-storage');
    }
    for (const fence of fences) {
      const key = fence.documentKey;
      // Navigation of another document may have occurred during the write; never replace its state snapshot.
      this.state = reduce(this.state, { type: 'ui:clear', documentKey: key, fence, at }, this.engine).state;
      const timer = this.persistTimers.get(key);
      if (timer !== undefined) { clearTimeout(timer); this.persistTimers.delete(key); }
      this.dirtyDocs.delete(key);
      this.transportDrops.delete(key);
      this.persisted.delete(key);
      const report = this.state.reports.get(key), meta = this.state.metas.get(key);
      if (report !== undefined && meta !== undefined) this.estimated.set(key, estimateReportBytes(report, meta));
    }
    if (!result.cleaned) throw new Error('clear-cleanup');
  }

  /** ADR-073: active actors must acknowledge a fresh epoch; inactive history is fenced until restore. */
  private async resetHistoryActor(documentKey: string): Promise<ClearFence> {
    const report = this.state.reports.get(documentKey), meta = this.state.metas.get(documentKey);
    if (report === undefined || meta === undefined) throw new Error('clear-missing');
    const resetId = 'reset-' + crypto.randomUUID().replaceAll('-', '');
    const retired: ClearFence = { documentKey, bridgeSessionId: resetId, sensorBootIds: [], at: this.now(), paused: meta.paused, reportRevision: Math.min(BUDGETS.maxCount, report.revision + 1) };
    if (!meta.bound || meta.revoked || meta.accessGranted === false || report.lifecycle === 'bfcache' || report.lifecycle === 'closed') return retired;
    if (this.resetRequests.has(documentKey) || this.resetRequests.size >= 4) throw new Error('reset-busy');
    let native: Promise<unknown>;
    try { native = this.api.tabs.sendMessage(report.tabId, { schemaVersion: 1, type: 'bridge-control', command: 'reset', resetId }, { frameId: report.frameId, documentId: report.documentId }); }
    catch { native = Promise.reject(new Error('reset-unavailable')); }
    this.resetRequests.set(documentKey, native);
    void native.then(() => { if (this.resetRequests.get(documentKey) === native) this.resetRequests.delete(documentKey); }, () => { if (this.resetRequests.get(documentKey) === native) this.resetRequests.delete(documentKey); });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const raw = await Promise.race([native, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('reset-timeout')), 2500); })]);
      const response = validateBridgeResetAck(raw);
      if (!response.ok || response.value.resetId !== resetId) throw new Error('reset-invalid');
      return { ...retired, bridgeSessionId: response.value.bridgeSessionId, sensorBootIds: response.value.sensorBootIds, at: this.now() };
    } catch (error) {
      // No sensor has ever been admitted: retain a fence and reset on its first verified delivery.
      if (!meta.sensorSeen && meta.boots.length === 0) return retired;
      throw error;
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }

  /** Export preview = exactly the redacted projection shown in the UI (REQ-013); no raw data. */
  async exportPreview(tabId: number, documentKey: string, reportRevision: number, includeHost = false): Promise<UiResponse> {
    await this.ready;
    await this.ensureHistory();
    const error = this.checkDocument(tabId, documentKey, reportRevision);
    if (error !== null) return uiError(error);
    const report = this.projectionByKey(documentKey);
    if (report === null) return uiError('not-found');
    const preview = createExportPreview(report, this.now(), includeHost);
    return { schemaVersion: 1, type: 'export-preview', preview };
  }

  /** ui-inject-now (active-tab mode): late injection under the activeTab grant; the tab's documents get `late-start`. */
  async injectNow(tabId: number): Promise<UiResponse> {
    await this.ready;
    await this.ensureHistory();
    const key = selectDocumentKey(this.state, tabId);
    const seenBefore = new Set([...this.state.metas].filter(([, meta]) => meta.sensorSeen).map(([id]) => id));
    let frames: Awaited<ReturnType<BackgroundChromeApi['webNavigation']['getAllFrames']>>;
    try { frames = await this.api.webNavigation.getAllFrames({ tabId }); } catch { return uiError('no-access'); }
    const top = frames?.find((f) => f.frameId === 0 && f.documentLifecycle !== 'prerender');
    if (!top || typeof top.documentId !== 'string') return uiError('no-access');
    const host = sanitizeHost(top.url);
    const ok = await this.scope.injectNow(tabId, host, top.documentId);
    if (!ok) return uiError('no-access');
    this.grantDocumentAccess(String(tabId) + ':0:' + top.documentId);
    this.apply({ type: 'scope:access', documentKey: String(tabId) + ':0:' + top.documentId, host, accessGranted: true, at: this.now() });
    const injectedKey = String(tabId) + ':0:' + top.documentId;
    if (!seenBefore.has(injectedKey)) this.apply({ type: 'injection:late', documentKeys: [injectedKey], at: this.now() });
    this.reconcileAccess();
    return { schemaVersion: 1, type: 'ok', reportRevision: key === null ? null : (this.state.reports.get(key)?.revision ?? null) };
  }

  /** Permission change (grant or revoke): refresh grants, reconcile registration, revoke documents out of scope. */
  async onPermissionsChanged(): Promise<void> {
    await this.ready;
    await this.ensureHistory();
    this.documentAccess.clear();
    await this.scope.onPermissionsChanged();
    this.documentAccess.clear();
    await this.reconcile();
    this.reconcileAccess();
    await Promise.all([...this.dirtyDocs].map((key) => this.repository.run(key, () => this.persistNow(key))));
    await this.flushIndex();
  }

  private reconcileAccess(): void {
    const denied = new Set<string>();
    for (const binding of this.state.bindings.values()) {
      if (!this.hasDocumentAccess(binding.documentKey)) denied.add(binding.documentKey);
    }
    for (const [key, report] of this.state.reports) {
      if (!this.hasDocumentAccess(key)) denied.add(key);
    }
    for (const key of denied) {
      const meta = this.state.metas.get(key);
      if (meta && !meta.revoked && meta.sensorSeen) {
        // P05 / REQ-012: an idle or paused bridge cannot learn revocation from its next ACK.
        this.sendControl(key, 'stop');
        this.apply({ type: 'scope:revoked', documentKeys: [key], at: this.now() });
      }
      this.transportDrops.delete(key);
      this.apply({ type: 'scope:access', documentKey: key, host: null, accessGranted: false, at: this.now() });
    }
    // Scope reduction also discards queued page work and its origin hints.
    this.state = { ...this.state, quarantine: this.state.quarantine.filter((q) => this.hasDocumentAccess(q.documentKey)) };
    for (const key of this.dirtyDocs) this.schedulePersist(key);
  }

  diagnostics(): RuntimeDiagnostics {
    return {
      ready: this.isReady,
      pendingDropped: this.pendingDropped,
      persistFailures: this.persistFailures,
      degraded: this.degraded,
      estimatedBytes: this.estimatedTotal(),
      lastMeasuredBytes: this.lastMeasuredBytes,
      reports: this.state.reports.size,
      quarantine: this.state.quarantine.length,
      orphanBatches: this.state.unattributed.orphanBatches,
      unattributedRequests: this.state.unattributed.requests,
      lifecycleFallbackCommits: this.state.notes.lifecycleFallbackCommits,
      engineFailures: this.state.notes.engineFailures,
    };
  }
}
