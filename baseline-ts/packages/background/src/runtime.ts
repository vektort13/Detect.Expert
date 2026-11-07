import { redactSenderContext } from './sender';
import { reportHost } from '../../attribution/src/index';
// Service-worker orchestration (spec A10, ADR-005 §5–6, ADR-011 §2, E05-02): holds the reducer state, waits
// for hydration behind a readiness promise with a bounded pending buffer, runs side effects (per-document
// serialized persistence, ACK after commit, LRU/TTL eviction, quota degradation with bounded retry).

import { createExportPreview } from '../../export/src/index';
import { coverageRef } from '@detect-expert/engine';
import { BUDGETS, PRO_LIMITS, sanitizeHost, counterKey, validateBridgeResetAck } from '@detect-expert/contracts';
import type { Ack, BridgeControlCommand, BridgeControlMessage, CounterEntry, PageBatch, ReportProjection, UiErrorCode, UiResponse } from '@detect-expert/contracts';
import type { BackgroundChromeApi, Clock } from './chrome-api';
import { systemClock } from './chrome-api';
import {
  bindingKey,
  deriveCoverageState,
  createInitialState,
  estimateReportBytes,
  hasPendingFrameOrigin,
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
import { VisualPreviewManager } from './visual-preview';
import { RtcDetailsManager } from './rtc-details';
import { BadgeManager } from './badge';
import { ProRecordingManager, PRO_STORAGE_KEY } from './pro-recording';
import { NetworkAttemptObserver } from './network-attempts';
import { ProtectionController } from './protection';
import { ApiResultsManager } from './api-results';
import { ResponseHeadersObserver } from './response-headers';
import { GoogleIdsManager } from './google-ids';
import { DATA_CONSENT_PENDING_KEY } from '../../contracts/src/data-consent';

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
  pendingPageBatches: number;
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
  readonly visual: VisualPreviewManager;
  readonly rtc: RtcDetailsManager;
  readonly badge: BadgeManager;
  readonly pro: ProRecordingManager;
  readonly networkAttempts: NetworkAttemptObserver;
  readonly protection: ProtectionController;
  readonly apiResults: ApiResultsManager;
  readonly responseHeaders: ResponseHeadersObserver;
  readonly googleIds: GoogleIdsManager;

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
  private consentChain: Promise<unknown> = Promise.resolve();
  private consentPending = 0;
  private readonly pending: DocumentEvent[] = [];
  private pendingDropped = 0;
  private pendingNetworkLoss = false;
  private pendingPageBatches = 0;
  private readonly pendingPageDrops = new Map<string, number>();

  private readonly dirtyDocs = new Set<string>();
  private indexDirty = false;
  private indexRevision = 0;
  private indexTimer: Timer | null = null;
  private readonly persistTimers = new Map<string, Timer>();
  /** Last watermark that reached storage per document (ACK reports this, never the in-memory one). */
  private readonly persisted = new Map<string, ReadonlyMap<string, number>>();
  private readonly transportDrops = new Map<string, number>();
  private readonly estimated = new Map<string, number>();
  /** ADR-073: documents whose durable clear is in flight; their projection is withheld until it commits. */
  private readonly clearingDocs = new Set<string>();
  /** Native reset promises cannot be cancelled: hold their physical slot until actual settlement. */
  private readonly resetRequests = new Map<string, Promise<unknown>>();
  private lastMeasuredBytes: number | null = null;
  private lastBudgetCheck = 0;
  private budgetCheckRunning = false;
  private budgetCheckCompletion: Promise<void> = Promise.resolve();
  private persistFailures = 0;
  private persistCooldownUntil = 0;
  private degraded = false;
  private ttlTimer: Timer | null = null;
  private lastSweepAt = -Infinity;
  private lastFrameReconcileAt = 0;
  private frameReconcileRunning = false;
  private frameReconcileCursor = 0;
  /** Only identities actually exposed by getAllFrames can later be proven absent by that API. */
  private readonly enumeratedFrames = new Set<string>();

  constructor(api: BackgroundChromeApi, options: RuntimeOptions = {}) {
    this.api = api;
    this.apiResults = new ApiResultsManager(this);
    this.responseHeaders = new ResponseHeadersObserver(this);
    this.googleIds = new GoogleIdsManager(this);
    this.visual = new VisualPreviewManager(this);
    this.rtc = new RtcDetailsManager(this);
    this.badge = new BadgeManager(api, () => this.state, (key) => this.hasDocumentAccess(key));
    this.pro = new ProRecordingManager(this);
    this.networkAttempts = new NetworkAttemptObserver(this);
    this.engine = options.engine ?? noopEngine;
    this.clock = options.clock ?? systemClock;
    this.maxPending = options.maxPendingEvents ?? 256;
    this.persistDebounceMs = options.persistDebounceMs ?? BUDGETS.flushMaxMs;
    this.ttlIntervalMs = options.ttlIntervalMs ?? 60_000;
    this.maxPersistAttempts = Math.max(1, Math.min(3, options.maxPersistAttempts ?? 3));
    this.scope = new ScopeController(api, this.clock, options.testBootstrap);
    this.protection = new ProtectionController(api, this.scope);
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

  get hydrationComplete(): boolean { return this.isReady && this.historyLoaded; }

  canCollectBrowserData(): boolean {
    if (this.scope.hasDataConsent) return true;
    if (!this.isReady) this.pendingNetworkLoss = true;
    return false;
  }

  canBufferRedactedBrowserData(): boolean {
    return this.scope.hasDataConsent || !this.scope.dataConsentLoaded;
  }

  /** P07 / REQ-011: the message listener must not retain unlimited payloads during hydration. */
  async whenPageReady(documentKey: string): Promise<boolean> {
    if (this.isReady && this.historyLoaded && this.historyLoading === null) return true;
    if (this.pendingPageBatches >= BUDGETS.maxOutOfOrderEntriesGlobal) {
      this.pendingDropped = Math.min(BUDGETS.maxCount, this.pendingDropped + 1);
      this.countTransportDrop(documentKey);
      return false;
    }
    this.pendingPageBatches++;
    // Recover authority before the handler's permission check; an uninitialized scope cannot revoke an actor.
    try { await this.ready; await this.ensureHistory(); return true; } finally { this.pendingPageBatches--; }
  }

  // ---------------------------------------------------------------------------
  // Hydration (A10): restore snapshots, bindings and watermarks, reconcile with live frames, then drain.
  // ---------------------------------------------------------------------------

  async start(): Promise<void> {
    if (this.started) return this.ready;
    this.started = true;
    try {
      await this.repository.init();
      await this.scope.startup();
      if (this.scope.hasDataConsent) {
        await this.ensureHistory();
      } else if (!await this.discardUnconsentedData()) this.degraded = true;
    } catch {
      // Keep listeners available, but do not open ingress/persistence without a validated clear authority.
      this.state = createInitialState();
      this.degraded = true;
      if (!this.scope.hasDataConsent) await this.discardUnconsentedData();
    }
    this.isReady = true;
    this.finishHistoryReadiness();
    this.badge.start();
    this.resolveReady();
    this.lastFrameReconcileAt = this.now();
    this.ttlTick();
    if (this.ttlIntervalMs > 0 && this.ttlTimer === null) {
      this.ttlTimer = setInterval(() => this.ttlTick(), this.ttlIntervalMs);
    }
    await this.protection.start();
  }

  /** ADR-073: one shared retry; unread/malformed authority is never treated as an empty journal. */
  private async ensureHistory(): Promise<void> {
    if (this.historyLoading !== null) return this.historyLoading;
    if (this.historyLoaded || !this.scope.hasDataConsent) return;
    const attempt = (async () => {
      const accessGeneration = this.scope.accessGeneration;
      // Loader migrations must also be cancelled, before their queued writes can undo a consent purge.
      const loaded = await this.repository.loadAll(() => this.scope.hasDataConsent && this.scope.accessGeneration === accessGeneration);
      if (!this.scope.hasDataConsent || this.scope.accessGeneration !== accessGeneration) throw new Error('history-access-changed');
      this.hydrate(loaded.index, loaded.documents);
      this.historyLoaded = true;
      await this.reconcile();
      if (!this.scope.hasDataConsent || this.scope.accessGeneration !== accessGeneration) throw new Error('history-access-changed');
      this.reconcileAccess(true);
      await this.visual.start();
      await this.rtc.start();
      await this.pro.start();
      if (!this.scope.hasDataConsent || this.scope.accessGeneration !== accessGeneration) throw new Error('history-access-changed');
      const buffered = this.pending.splice(0, this.pending.length);
      for (const event of buffered) this.apply(event);
      this.reconcileAccess(true);
      if (this.isReady) this.finishHistoryReadiness();
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

  /** Resume production browser evidence only after history authority has been recovered. */
  private finishHistoryReadiness(): void {
    if (!this.historyLoaded) return;
    this.networkAttempts.flush();
    if (this.pendingNetworkLoss) {
      // Lost startup resources cannot be assigned to one document after the bounded queue evicts them.
      // Keep explicit coverage evidence on every currently authorized report in this worker epoch.
      for (const key of this.state.reports.keys()) if (this.hasDocumentAccess(key)) {
        this.apply({ type: 'network:limited', documentKey: key, at: this.now() });
      }
    }
    for (const [key, count] of this.pendingPageDrops) {
      const meta = this.state.metas.get(key);
      if (!meta || meta.revoked || meta.accessGranted === false) continue;
      this.transportDrops.set(key, count);
      this.schedulePersist(key);
    }
    this.pendingPageDrops.clear();
  }

  private readonly documentAccess = new Map<string, number>();
  private hasDocumentAccess(key: string): boolean {
    return this.scope.accessReady && this.documentAccess.get(key) === this.scope.accessGeneration;
  }
  private grantDocumentAccess(key: string): void {
    if (this.scope.accessReady) this.documentAccess.set(key, this.scope.accessGeneration);
  }

  canObserveNetworkDocument(key: string): boolean {
    return this.isReady && this.historyLoaded && this.hasNetworkDocumentAccess(key);
  }

  private hasNetworkDocumentAccess(key: string): boolean {
    if (!this.hasDocumentAccess(key)) return false;
    const [tab, frame] = key.split(':');
    const binding = this.state.bindings.get(bindingKey(Number(tab), Number(frame)));
    const meta = this.state.metas.get(key);
    return binding?.documentKey === key && binding.accessGranted === true &&
      (binding.documentLifecycle === null || binding.documentLifecycle === 'active') &&
      !meta?.paused && !meta?.revoked && meta?.accessGranted !== false;
  }

  /** A new explicit Pro observation period starts a fresh ephemeral classifier window. */
  resetNetworkProbeWindows(documentKeys?: readonly string[], tabId?: number, cutoffAt?: number): void { this.networkAttempts.resetWindows(documentKeys, tabId, cutoffAt); }

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
        const binding = reports.has(b.documentKey) || b.apiResultsResetRequired === false ? b : { ...b, apiResultsResetRequired: true };
        bindings.set(String(b.tabId) + ':' + String(b.frameId) + (isPrerender ? ':p' : ''), binding);
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
        if (this.enumeratedFrames.size < 1024) this.enumeratedFrames.add(String(tab.id) + ':' + f.frameId + ':' + f.documentId);
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
    for (const b of this.state.bindings.values()) {
      if (unavailableTabs.has(b.tabId) || liveDocuments.has(b.documentKey)) continue;
      // Missing cached/prerender/non-enumerable frames are not evidence of deletion in a live tab.
      if (liveTabIds.has(b.tabId) && (b.documentLifecycle === 'cached' || b.documentLifecycle === 'prerender' ||
          (b.frameId !== 0 && b.scheme === undefined && !this.enumeratedFrames.has(b.documentKey)))) continue;
      stale.push(b);
    }
    const staleKeys = new Set(stale.map((binding) => binding.documentKey));
    const boundKeys = new Set([...this.state.bindings.values()].map((binding) => binding.documentKey));
    const staleMetas = [...this.state.metas.values()].filter((meta) => meta.bound &&
      (staleKeys.has(meta.documentKey) || (!boundKeys.has(meta.documentKey) &&
        !unavailableTabs.has(this.state.reports.get(meta.documentKey)?.tabId ?? -1) && !liveDocuments.has(meta.documentKey))));
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

  /** F013/F017: bounded, non-overlapping frame cleanup while a long-lived SPA keeps this SW alive. */
  async reconcileFrames(): Promise<void> {
    const now = this.now();
    if (!this.isReady || !this.historyLoaded || this.frameReconcileRunning || (now >= this.lastFrameReconcileAt && now - this.lastFrameReconcileAt < 10_000)) return;
    this.lastFrameReconcileAt = now;
    this.frameReconcileRunning = true;
    try {
      const boundKeys = new Set([...this.state.bindings.values()].map((binding) => binding.documentKey));
      for (const key of this.enumeratedFrames) if (!boundKeys.has(key)) this.enumeratedFrames.delete(key);
      const tabIds = [...new Set([...this.state.bindings.values()].map((binding) => binding.tabId))];
      const count = Math.min(16, tabIds.length);
      for (let i = 0; i < count; i++) {
        const tabId = tabIds[(this.frameReconcileCursor + i) % tabIds.length];
        if (tabId === undefined) continue;
        const topKey = this.state.tabs.get(tabId)?.activeTopDocumentKey;
        const snapshot = [...this.state.bindings.values()].filter((binding) => binding.tabId === tabId);
        let frames: Awaited<ReturnType<BackgroundChromeApi['webNavigation']['getAllFrames']>>;
        try { frames = await this.api.webNavigation.getAllFrames({ tabId }); } catch { continue; }
        // Failed, incomplete or excessively large enumeration cannot justify retiring a binding.
        if (!Array.isArray(frames) || frames.length > 1024 || frames.some((frame) => typeof frame.documentId !== 'string' || typeof frame.frameId !== 'number') ||
            this.state.tabs.get(tabId)?.activeTopDocumentKey !== topKey) continue;
        const top = frames.find((frame) => frame.frameId === 0 && frame.documentLifecycle !== 'prerender' && frame.documentLifecycle !== 'cached');
        if (!top?.documentId || String(tabId) + ':0:' + top.documentId !== topKey) continue;
        const live = new Set<string>();
        for (const frame of frames) {
          if (typeof frame.documentId !== 'string' || typeof frame.frameId !== 'number') continue;
          const key = String(tabId) + ':' + frame.frameId + ':' + frame.documentId;
          live.add(key);
          if (this.enumeratedFrames.size < 1024) this.enumeratedFrames.add(key);
        }
        const retired = snapshot.filter((binding) => binding.frameId !== 0 &&
          (binding.documentLifecycle === null || binding.documentLifecycle === 'active') &&
          (binding.scheme !== undefined || this.enumeratedFrames.has(binding.documentKey)) && !live.has(binding.documentKey) &&
          this.state.bindings.get(bindingKey(tabId, binding.frameId)) === binding);
        if (retired.length > 0) this.apply({ type: 'frames:retired', documentKeys: retired.map((binding) => binding.documentKey), at: this.now() });
      }
      this.frameReconcileCursor = tabIds.length === 0 ? 0 : (this.frameReconcileCursor + count) % tabIds.length;
    } finally { this.frameReconcileRunning = false; }
  }

  // ---------------------------------------------------------------------------
  // Event application and effects
  // ---------------------------------------------------------------------------

  /** Browser events: buffered (bounded) until hydration finished, then applied in order. */
  dispatch(event: DocumentEvent): void {
    if (!this.scope.hasDataConsent) {
      if (this.isReady) return;
      if (event.type === 'navigation:committed') event = { ...event, host: null, accessGranted: false, originPending: true };
      else if (event.type === 'navigation:before') event = { ...event, host: null };
      else if (!(!this.scope.dataConsentLoaded && (event.type === 'network:host' || event.type === 'network:headers')) &&
        event.type !== 'navigation:error' && event.type !== 'tab:removed' && event.type !== 'tab:replaced') return;
    }
    this.visual.onBrowserEvent(event);
    this.rtc.onBrowserEvent(event);
    this.googleIds.onBrowserEvent(event);
    const pendingHeaders = this.responseHeaders.onBrowserEvent(event);
    // Raw navigation hosts are consumed synchronously, never queued before startup.
    if (event.type === 'navigation:before') event = { ...event, host: null };
    if (event.type === 'navigation:committed') {
      const accessGranted = this.scope.accessReady && this.scope.inScope(event.host, event.tabId, event.documentId, event.scheme);
      const top = event.frameType === 'outermost_frame' || (event.frameType === null && event.frameId === 0);
      if (top && event.documentLifecycle !== 'prerender' && this.scope.noteTopCommit(event.tabId, event.host, event.documentId)) {
        for (const key of this.documentAccess.keys()) if (key.startsWith(String(event.tabId) + ':')) this.documentAccess.delete(key);
        this.reconcileAccess();
      }
      event = { ...event, host: reportHost(event.host), accessGranted, originPending: event.originPending === true || !top && (!this.isReady || !this.scope.accessReady) };
    }
    if (!this.isReady || !this.historyLoaded || this.historyLoading !== null) {
      if (this.pending.length >= this.maxPending) {
        const dropped = this.pending.shift();
        if (dropped?.type === 'network:host' || dropped?.type === 'network:headers') this.pendingNetworkLoss = true;
        this.pendingDropped++;
      }
      this.pending.push(event);
      if (pendingHeaders) this.dispatch(pendingHeaders);
      return;
    }
    if (event.type === 'navigation:committed' || event.type === 'tab:removed') this.sweepExpired(this.now());
    this.apply(event);
    if (pendingHeaders) this.dispatch(pendingHeaders);
    if (event.type === 'navigation:committed') void this.reconcileFrames();
  }

  /** Synchronous reduce + state swap; effects are scheduled (persists queued per document). */
  private apply(event: DocumentEvent, inQueueFor: string | null = null): ReduceResult {
    if (!this.historyLoaded || !this.scope.hasDataConsent) return { state: this.state, effects: [] };
    if (event.type === 'network:observed' && !this.canObserveNetworkDocument(event.documentKey)) return { state: this.state, effects: [] };
    if (event.type === 'network:headers' && (!this.hasNetworkDocumentAccess(event.documentKey) || event.requiresAllSitesAccess &&
        (!this.scope.accessReady || this.scope.getScopeMode() !== 'all-sites' || !this.scope.getState().grantedAllSites))) return { state: this.state, effects: [] };
    let accessExpired = false;
    if (event.type === 'navigation:before') event = { ...event, host: null };
    if (event.type === 'navigation:committed') {
      const top = event.frameType === 'outermost_frame' || (event.frameType === null && event.frameId === 0);
      if (top && event.documentLifecycle !== 'prerender') accessExpired = this.scope.noteTopCommit(event.tabId, event.host, event.documentId);
      const accessKey = String(event.tabId) + ':' + event.frameId + ':' + event.documentId;
      // A hostless child navigation cannot reveal whether its origin is inherited or opaque. It
      // remains unauthorized until MessageSender.origin passes the existing scope/permission gate.
      const originPending = !top && (event.originPending === true || (event.host === null && event.scheme === undefined));
      // Queued HTTP(S) events carry no exact host. Only verified broad grants can resolve them
      // after hydration; a narrow scope still needs the original browser sender's origin.
      const broadStartupAccess = event.originPending === true && event.scheme !== undefined && this.scope.accessReady &&
        this.scope.getScopeMode() === 'all-sites' && this.scope.getState().grantedAllSites;
      const accessGranted = broadStartupAccess || ((!this.isReady || originPending) && this.hasDocumentAccess(accessKey)) ||
        (event.accessGranted ?? (this.scope.accessReady && this.scope.inScope(event.host, event.tabId, event.documentId, event.scheme)));
      if (accessGranted) this.grantDocumentAccess(accessKey); else this.documentAccess.delete(accessKey);
      const host = event.host ?? (originPending && accessGranted ? this.state.reports.get(accessKey)?.host ?? null : null);
      event = { ...event, host: accessGranted ? reportHost(host) : null, accessGranted, originPending: originPending && !accessGranted };
    }
    if (event.type === 'network:host') {
      if (event.requiresAllSitesAccess && (!this.scope.accessReady || this.scope.getScopeMode() !== 'all-sites' || !this.scope.getState().grantedAllSites)) return { state: this.state, effects: [] };
      const parent = event.resourceType === 'sub_frame' && event.parentDocumentId !== null && event.parentFrameId !== null && event.parentFrameId >= 0;
      const documentId = parent ? event.parentDocumentId : event.documentId;
      const frameId = parent ? event.parentFrameId : event.frameId;
      const binding = [...this.state.bindings.values()].find((b) => b.tabId === event.tabId && b.frameId === frameId && b.documentId === documentId);
      if (!binding || !this.hasDocumentAccess(binding.documentKey)) return { state: this.state, effects: [] };
    }
    if (event.type === 'tab:removed') for (const key of this.documentAccess.keys()) if (key.startsWith(String(event.tabId) + ':')) this.documentAccess.delete(key);
    const before = this.state;
    const result = reduce(this.state, event, this.engine);
    this.state = result.state;
    if (event.type === 'navigation:committed') {
      const key = String(event.tabId) + ':' + event.frameId + ':' + event.documentId;
      const fence = this.repository.clearFence(key);
      if (fence !== undefined && this.state.metas.get(key)?.clearEpoch !== fence.bridgeSessionId) {
        this.state = reduce(this.state, { type: 'ui:clear', documentKey: key, fence, at: this.now() }, this.engine).state;
      }
    }
    this.visual.afterEvent(event);
    this.rtc.afterEvent(event);
    this.apiResults.afterEvent(event);
    this.googleIds.afterEvent(event);
    this.networkAttempts.afterEvent(event, before);
    this.pro.afterEvent(event, before);
    if (this.documentAccess.size > 1024) { this.documentAccess.clear(); this.reconcileAccess(); }
    this.runEffects(result.effects, inQueueFor, before);
    if (accessExpired) this.reconcileAccess();
    this.badge.afterEvent(event, before);
    return result;
  }

  private runEffects(effects: readonly Effect[], inQueueFor: string | null, before: DocumentsState): void {
    for (const effect of effects) {
      switch (effect.type) {
        case 'persist':
          this.dirtyDocs.add(effect.documentKey);
          if (effect.documentKey === inQueueFor) break; // the caller persists inside the queue
          if (effect.immediate) this.queuePersist(effect.documentKey);
          else this.schedulePersist(effect.documentKey);
          break;
        case 'remove':
          for (const key of effect.documentKeys) this.queueRemove(key, [...before.bindings.values()].some(binding => binding.documentKey === key));
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

  private queueRemove(documentKey: string, resetPreview: boolean): void {
    const timer = this.persistTimers.get(documentKey);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.persistTimers.delete(documentKey);
    }
    this.dirtyDocs.delete(documentKey);
    this.persisted.delete(documentKey);
    this.estimated.delete(documentKey);
    void this.repository.run(documentKey, async () => {
      if (resetPreview && (this.state.evictedKeys.includes(documentKey) || [...this.state.bindings.values()].some(binding => binding.documentKey === documentKey && binding.apiResultsResetRequired)) &&
        !await this.persistApiResultsReset()) return;
      // Retain routing-only fences while an open tab can restore its cached document.
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

  markApiResultsReset(documentKeys: readonly string[], required: boolean): void {
    const keys = new Set(documentKeys);
    const bindings = new Map(this.state.bindings);
    let changed = false;
    for (const [slot, binding] of bindings) if (keys.has(binding.documentKey) && (binding.apiResultsResetRequired === true) !== required) {
      const next = { ...binding };
      next.apiResultsResetRequired = required;
      bindings.set(slot, next); changed = true;
    }
    if (changed) { this.state = { ...this.state, bindings }; this.markIndexDirty(); }
  }

  async persistApiResultsReset(): Promise<boolean> {
    if (!this.historyLoaded) return false;
    const revision = this.indexRevision;
    const ok = await this.repository.saveIndex(this.buildIndex());
    if (ok && revision === this.indexRevision) this.indexDirty = false;
    return ok;
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
      if (!this.state.reports.has(documentKey) || !this.state.metas.has(documentKey)) return false;
      // Quota/error path (A10): degraded + truncated, evict inactive LRU documents, bounded retry.
      this.apply({ type: 'document:degraded', documentKey, truncate: true, at: this.now() }, documentKey);
      const victims = planEviction(this.state, new Set([documentKey])).slice(0, 8);
      if (victims.length > 0) {
        this.apply({ type: 'document:evict', documentKeys: victims, at: this.now() }, documentKey);
      }
    }
    this.persistCooldownUntil = this.now() + 5000;
    return false;
  }

  /** ADR-023 gives the separately bounded Pro recording its own allowance; Light retains its 4 MiB. */
  private async ordinaryMeasuredBytes(): Promise<number | null> {
    const total = await this.repository.bytesInUse();
    this.lastMeasuredBytes = total;
    if (total === null || !this.pro.hasSession()) return total;
    const pro = await this.repository.bytesInUse([PRO_STORAGE_KEY]);
    // Missing measurement uses ordinary structural estimates, not eviction caused by a Pro payload.
    return pro === null ? null : Math.max(0, total - Math.min(pro, PRO_LIMITS.maxBytes));
  }

  /** Ordinary session budget: browser memory estimate, with the separate Pro allowance removed. */
  async enforceTotalBudget(force = false): Promise<void> {
    const now = this.now();
    if (this.budgetCheckRunning) {
      if (!force) return;
      await this.budgetCheckCompletion;
      return this.enforceTotalBudget(true);
    }
    if (!force && now - this.lastBudgetCheck < 1000) return;
    this.budgetCheckRunning = true;
    let completeBudgetCheck: () => void = () => undefined;
    this.budgetCheckCompletion = new Promise(resolve => { completeBudgetCheck = resolve; });
    this.lastBudgetCheck = now;
    try {
      const measured = await this.ordinaryMeasuredBytes();
      let bytes = measured ?? this.estimatedTotal();
      if (bytes <= BUDGETS.maxSessionTotalBytes) return;
      // ADR-020: optional server details count toward the same total, including estimate-only browsers.
      if (this.rtc.estimatedBytes() > 128) {
        await this.rtc.dropForBudget().catch(() => { this.degraded = true; });
        bytes = (await this.ordinaryMeasuredBytes()) ?? this.estimatedTotal();
        if (bytes <= BUDGETS.maxSessionTotalBytes) return;
      }
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
        const remaining = await this.ordinaryMeasuredBytes();
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
      completeBudgetCheck();
    }
  }

  /** Sum of the exact sizes measured at each persist (docs/PROJECT_RULES.md: no re-serialization of every report per check). */
  private estimatedTotal(): number {
    let total = this.repository.clearFenceBytes;
    for (const v of this.estimated.values()) total += v;
    total += this.rtc.estimatedBytes();
    return total;
  }

  ttlTick(): void {
    if (!this.isReady) return;
    this.sweepExpired(this.now());
    void this.reconcileFrames();
  }

  /** P02 / F171: events resume retention after SW suspension; at most one scan per 30 seconds. */
  sweepExpired(now: number): void {
    if (!this.historyLoaded) return;
    if (now >= this.lastSweepAt && now - this.lastSweepAt < 30_000) return;
    this.lastSweepAt = now;
    this.apply({ type: 'ttl-tick', at: now });
  }

  stop(): void {
    this.googleIds.clear();
    this.networkAttempts.clear();
    this.pro.dispose();
    this.badge.stop();
    this.visual.stop();
    this.rtc.stop();
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

  /** F020: persist a trusted transport stop before the ACK disables further diagnostics. */
  async recordTerminalStop(ctx: PageSenderContext, reason: 'revoked' | 'protocol-mismatch'): Promise<void> {
    if (!(await this.whenPageReady(ctx.documentKey))) return;
    await this.repository.run(ctx.documentKey, async () => {
      const meta = this.state.metas.get(ctx.documentKey);
      if (!meta?.bound || meta.revoked) return;
      if (reason === 'revoked') {
        this.documentAccess.delete(ctx.documentKey);
        this.apply({ type: 'scope:revoked', documentKeys: [ctx.documentKey], at: this.now() }, ctx.documentKey);
      } else if (this.hasDocumentAccess(ctx.documentKey)) {
        this.apply({ type: 'transport:stopped', documentKey: ctx.documentKey, reason, at: this.now() }, ctx.documentKey);
      } else return;
      await this.persistNow(ctx.documentKey);
      await this.visual.flush();
      await this.rtc.flush();
    });
  }

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
    if (!this.isReady || !this.historyLoaded) {
      if (!this.pendingPageDrops.has(documentKey) && this.pendingPageDrops.size >= BUDGETS.maxOutOfOrderEntriesGlobal) return;
      this.pendingPageDrops.set(documentKey, Math.min(BUDGETS.maxCount, (this.pendingPageDrops.get(documentKey) ?? 0) + 1));
      return;
    }
    const meta = this.state.metas.get(documentKey);
    if (!meta || meta.revoked || meta.accessGranted === false) return;
    if (!this.transportDrops.has(documentKey) && this.transportDrops.size >= 1024) return;
    this.transportDrops.set(documentKey, Math.min(BUDGETS.maxCount, (this.transportDrops.get(documentKey) ?? 0) + 1));
    this.schedulePersist(documentKey);
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
    if (!this.scope.hasDataConsent) return { ...ack(0, true, true), stopReason: 'revoked' };
    this.sweepExpired(this.now());
    if (!this.scope.accessReady) throw new Error('access-changing');
    if (ctx.originPattern !== null) {
      if (!this.scope.inScope(ctx.host, ctx.tabId, ctx.documentId, ctx.originPattern.startsWith('https:') ? 'https' : 'http')) {
        await this.recordTerminalStop(ctx, 'revoked');
        return { ...ack(0, true, true), stopReason: 'revoked' };
      }
      this.grantDocumentAccess(ctx.documentKey);
    }
    ctx = redactSenderContext(ctx);
    if (!admitted && !this.admitBatch(ctx)) {
      return ack(this.persistedSeq(ctx.documentKey, batch.bridgeSessionId), this.isPaused(ctx.documentKey), true);
    }
    return this.repository.run(ctx.documentKey, async () => {
      if (!this.scope.hasDataConsent) return { ...ack(0, true, true), stopReason: 'revoked' };
      if (!this.scope.accessReady || (!this.hasDocumentAccess(ctx.documentKey) && this.state.metas.get(ctx.documentKey)?.accessGranted !== false && !this.state.metas.get(ctx.documentKey)?.revoked)) throw new Error('access-changing');
      if (!this.hasDocumentAccess(ctx.documentKey)) return { ...ack(0, true, true), stopReason: 'revoked' };
      const meta = this.state.metas.get(ctx.documentKey);
      if (meta?.accessGranted === false || meta?.revoked) this.apply({ type: 'scope:access', documentKey: ctx.documentKey, host: ctx.host, accessGranted: true, at: this.now() }, ctx.documentKey);
      if (meta?.clearEpoch !== undefined && meta.clearBootIds?.length === 0 && meta.bound) {
        // Complete an earlier user-authorized inactive clear before admitting restored cumulative data.
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
          if (!this.scope.hasDataConsent) return { ...ack(0, true, true), stopReason: 'revoked' };
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
    if (!this.scope.hasDataConsent) return null;
    // ADR-073: a clear's durable revision floor must exceed every visible pre-clear revision, even mid-await.
    if (this.clearingDocs.has(documentKey)) return null;
    const report = this.state.reports.get(documentKey);
    const meta = this.state.metas.get(documentKey);
    // A cleared record stays hidden until a new observation, except a paused clear kept visible for Resume.
    if (report === undefined || meta === undefined || (meta.cleared && !meta.paused)) return null;
    const originPending = meta.accessGranted === false && [...this.state.bindings.values()].some(binding =>
      binding.documentKey === documentKey && binding.originPending === true);
    const pending = this.transportDrops.get(documentKey) ?? 0;
    let flags = pending > 0 && !report.coverageFlags.includes('throttled') ? [...report.coverageFlags, 'throttled' as const] : report.coverageFlags;
    // Unknown current descendants affect this view only. A verified inherited origin can resolve
    // uncertainty; historical gaps from actual denial, opaque origins or hook failures stay stored.
    if (!flags.includes('frames-inaccessible') && hasPendingFrameOrigin(this.state, documentKey)) flags = [...flags, 'frames-inaccessible'];
    // REQ-006 / F162: absence of API calls does not prove a missing browser permission.
    // sensorSeen=false remains partial; actual access/revoke policy independently produces no-access.
    // F175: webRequest needs grants on destination and initiator, so a narrow grant is incomplete.
    if (meta.accessGranted !== false && !meta.revoked && this.scope.getScopeMode() !== 'off' &&
        !this.scope.hasBroadNetworkAccess() && !flags.includes('network-limited')) {
      flags = [...flags, 'network-limited'];
    }
    try {
      const coverageState = deriveCoverageState(flags, meta);
      const currentCoverage = coverageRef(coverageState, flags);
      const rtcEvidence = this.rtc.vendorEvidence(documentKey);
      return projectReport({ ...report, coverageFlags: flags, coverageState,
        counters: originPending ? [] : report.counters, hosts: originPending ? [] : report.hosts,
        findings: originPending ? [] : report.findings.map(finding => ({ ...finding, coverageRef: currentCoverage })),
        dropped: { ...report.dropped, transport: Math.min(BUDGETS.maxCount, report.dropped.transport + pending) } },
        originPending ? { ...meta, firstObservationAt: null } : meta, this.scope.getScopeMode(), this.now(),
        rtcEvidence.observations.map(observation => observation.vendor), rtcEvidence.observedAt);
    } catch { return null; }
  }

  /** ADR-023: derive Pro findings only from counters observed after this visit's baseline. */
  recordingProjection(documentKey: string, baseline: ReadonlyMap<string, number>, startedAt: number, retainedCounters?: readonly CounterEntry[],
    browserBaseline: ReadonlyMap<string, number> = new Map(), retainedBrowserCounters?: readonly CounterEntry[], minimumLocalAttempts = 0): ReportProjection | null {
    const report = this.state.reports.get(documentKey), meta = this.state.metas.get(documentKey);
    const ordinary = this.projectionByKey(documentKey);
    if (!report || !meta || !ordinary || ordinary.coverageState === 'no-access') return null;
    const counters = (retainedCounters ?? report.counters).flatMap(counter => {
      const previous = baseline.get(counterKey(counter.techniqueId, counter.phase, counter.signalCodes, counter.apiOperation, counter.extensionResource)) ?? 0;
      const count = Math.max(0, counter.count - (counter.count < previous ? 0 : previous));
      return count ? [{ ...counter, count, signalCodes: [...counter.signalCodes] }] : [];
    });
    const deltaReport = { ...report, counters, findings: [], coverageState: ordinary.coverageState, coverageFlags: ordinary.coverageFlags };
    const browserCounters = retainedBrowserCounters ?? meta.networkCounters ?? [];
    const networkCounters = browserCounters.flatMap(counter => {
      const previous = browserBaseline.get(counterKey(counter.techniqueId, counter.phase, counter.signalCodes)) ?? 0;
      const count = Math.max(0, counter.count - (counter.count < previous ? 0 : previous));
      return count ? [{ ...counter, count, signalCodes: [...counter.signalCodes] }] : [];
    });
    const saturatedLocal = browserCounters.find(counter => counter.techniqueId === 'DET-060' && counter.count === BUDGETS.maxCount);
    const localCount = networkCounters.filter(counter => counter.techniqueId === 'DET-060').reduce((sum, counter) => sum + counter.count, 0);
    if (saturatedLocal && minimumLocalAttempts > localCount) {
      const retained = networkCounters.find(counter => counter.techniqueId === 'DET-060' && counter.signalCodes.length === 1);
      if (retained) { retained.count += minimumLocalAttempts - localCount; retained.countQuality = 'lower-bound'; }
      else networkCounters.push({ techniqueId: 'DET-060', phase: 'attempted', signalCodes: ['api-use'],
        count: minimumLocalAttempts - localCount, countQuality: 'lower-bound',
        firstBucket: saturatedLocal.firstBucket, lastBucket: saturatedLocal.lastBucket });
    }
    try {
      const findings = this.engine.deriveFindings(deltaReport).slice(0, BUDGETS.maxFindingsPerDocument);
      const rtcEvidence = this.rtc.vendorEvidence(documentKey);
      const recordingMeta = { ...meta, networkCounters };
      delete recordingMeta.requestedLocalPorts;
      delete recordingMeta.responseHeaders;
      const projection = projectReport({ ...deltaReport, findings }, recordingMeta, this.scope.getScopeMode(), this.now(),
        rtcEvidence.observations.map(observation => observation.vendor), rtcEvidence.observedAt);
      return { ...projection, observedSince: counters.length || networkCounters.length ? Math.max(startedAt, ordinary.observedSince ?? startedAt) : null };
    } catch { return null; }
  }

  /** CORE-01/02 / ADR-073: durable fence + producer reset before success; failed storage leaves old state. */
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
    // Revision floor is captured after the awaited reset barrier, so a concurrent commit cannot lower it.
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
      // Preserve Pro's prior Light history, and run production invalidation hooks for deferred clears too.
      this.pro.onLightClear(key);
      this.apply({ type: 'ui:clear', documentKey: key, fence, at }, key);
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
    // A cleared (non-paused) record is not addressable, even though its routing metadata still exists.
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
      const previewReset = await this.apiResults.prepareClear(documentKey);
      if (!previewReset.ready) return uiError('no-access');
      if (previewReset.reset) this.markApiResultsReset([documentKey], false);
      this.apply({ type: 'ui:pause', documentKey, at: this.now() }, documentKey);
      await this.persistNow(documentKey);
      await this.visual.flush();
      await this.rtc.flush();
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
      const previewReset = await this.apiResults.prepareClear(documentKey);
      if (!previewReset.ready) return uiError('no-access');
      this.pro.onLightClear(documentKey);
      await this.pro.flush();
      // CORE-01/02 / ADR-073: one durable fence + producer reset before success; a rejected write throws
      // (the listener returns a generic error) and never reports a false clear.
      await this.commitClear([documentKey]);
      if (previewReset.reset) this.markApiResultsReset([documentKey], false);
      this.badge.mark(tabId);
      this.visual.clearDocument(documentKey);
      this.rtc.clearDocument(documentKey);
      this.networkAttempts.clear(documentKey);
      await this.visual.flush();
      await this.rtc.flush();
      this.markIndexDirty();
      if (!await this.persistApiResultsReset()) return uiError('no-access');
      return { schemaVersion: 1, type: 'ok', reportRevision: null };
    });
  }

  /**
   * ui-clear-session (options page): every document report of the session is deleted, in memory and in
   * storage.session; bindings and scope prefs stay, so observed documents start a fresh report on their next batch.
   * Each document is cleared inside its own serialized queue (no interleaving with a commit of that document).
   */
  async clearSession(): Promise<UiResponse> {
    await this.ready;
    await this.ensureHistory();
    const keys = [...this.state.reports.keys()];
    this.apiResults.invalidate();
    this.googleIds.clear();
    this.markApiResultsReset(keys, true);
    if (keys.length > 0 && !await this.persistApiResultsReset()) return uiError('no-access');
    await this.pro.clear();
    this.visual.clear();
    this.rtc.clear();
    this.networkAttempts.clear();
    // ADR-073: durable fence + producer reset for every document under one atomic storage boundary; the
    // reducer's ui:clear (inside commitClear) replaces each report with its fenced empty record and clears
    // the per-document persist bookkeeping. Pro API-result resets are prepared alongside and applied after.
    const pendingResets = new Map(keys.map((documentKey) => [documentKey, this.apiResults.prepareClear(documentKey, true)]));
    await this.repository.runMany(keys, () => this.commitClear(keys));
    for (const documentKey of keys) {
      const previewReset = await pendingResets.get(documentKey);
      if (previewReset?.reset) this.markApiResultsReset([documentKey], false);
    }
    this.markIndexDirty();
    this.badge.markAll();
    await this.visual.flush();
    await this.rtc.flush();
    if (!await this.persistApiResultsReset()) return uiError('no-access');
    return { schemaVersion: 1, type: 'ok', reportRevision: null };
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
    const injectedKey = String(tabId) + ':0:' + top.documentId;
    // Revocation can permanently stop this document's guarded sensor/bridge. Reinjecting the
    // same bundles cannot restart it; preserve no-access until a reload creates a new document.
    if (this.state.metas.get(injectedKey)?.revoked) return uiError('no-access');
    const host = sanitizeHost(top.url);
    const ok = await this.scope.injectNow(tabId, host, top.documentId);
    if (!ok) return uiError('no-access');
    this.grantDocumentAccess(String(tabId) + ':0:' + top.documentId);
    this.apply({ type: 'scope:access', documentKey: String(tabId) + ':0:' + top.documentId, host, accessGranted: true, at: this.now() });
    if (!seenBefore.has(injectedKey)) this.apply({ type: 'injection:late', documentKeys: [injectedKey], at: this.now() });
    this.reconcileAccess();
    return { schemaVersion: 1, type: 'ok', reportRevision: key === null ? null : (this.state.reports.get(key)?.revision ?? null) };
  }

  changeDataConsent(accepted: boolean): Promise<boolean> {
    if (this.consentPending >= 4) return Promise.resolve(false);
    this.consentPending++;
    const operation = this.consentChain.then(async () => {
      await this.ready;
      this.scope.suspendDataConsent();
      const blocked = this.scope.beginDataConsentChange();
      const cleared = await this.discardUnconsentedData();
      if (!await blocked) return false;
      const saved = await this.scope.setDataConsent(accepted && cleared);
      if (!cleared || !saved) return false;
      if (accepted) {
        await this.reconcile();
        this.reconcileAccess();
        await this.visual.start();
        await this.rtc.start();
        await this.pro.start();
        await this.protection.accessChanged();
      }
      this.badge.markAll();
      return true;
    }).catch(async () => {
      this.scope.suspendDataConsent();
      await this.discardUnconsentedData();
      return false;
    }).finally(() => { this.consentPending--; });
    this.consentChain = operation;
    return operation;
  }

  async currentDataConsent(): Promise<boolean> {
    await this.ready;
    await this.consentChain;
    return this.scope.hasDataConsent;
  }

  private async discardUnconsentedData(): Promise<boolean> {
    for (const key of this.state.reports.keys()) this.sendControl(key, 'pause');
    this.apiResults.invalidate();
    this.googleIds.clear();
    this.responseHeaders.clear();
    this.networkAttempts.clear();
    this.visual.clear();
    this.rtc.clear();
    const proCleared = this.pro.clear();
    this.state = createInitialState();
    this.documentAccess.clear();
    this.pending.length = 0;
    this.pendingPageDrops.clear();
    this.pendingNetworkLoss = false;
    this.transportDrops.clear();
    this.dirtyDocs.clear();
    this.persisted.clear();
    this.estimated.clear();
    this.enumeratedFrames.clear();
    if (this.indexTimer !== null) clearTimeout(this.indexTimer);
    this.indexTimer = null;
    for (const timer of this.persistTimers.values()) clearTimeout(timer);
    this.persistTimers.clear();
    this.indexDirty = false;
    this.indexRevision++;
    this.badge.markAll();
    const cleanup = await Promise.allSettled([proCleared, this.visual.flush(), this.rtc.flush(), this.protection.suspendAccess(),
      this.api.tabs.query({}).then(tabs => {
        for (const tab of tabs.slice(0, 128)) if (tab.id !== undefined)
          void this.api.tabs.sendMessage(tab.id, { schemaVersion: 1, type: 'bridge-control', command: 'pause' }).catch(() => undefined);
      })]);
    const cleared = await this.repository.clearAll([DATA_CONSENT_PENDING_KEY]);
    this.historyLoaded = cleared;
    this.persisted.clear();
    this.estimated.clear();
    return cleared && cleanup.every(result => result.status === 'fulfilled');
  }

  /** Permission change (grant or revoke): refresh grants, reconcile registration, revoke documents out of scope. */
  async onPermissionsChanged(): Promise<void> {
    this.apiResults.invalidate();
    this.googleIds.clear();
    this.responseHeaders.clear();
    this.networkAttempts.clear();
    this.visual.clear();
    this.rtc.clear();
    await this.ready;
    this.documentAccess.clear();
    this.badge.markAll();
    try {
      await this.scope.onPermissionsChanged();
    } catch (error) {
      await this.protection.suspendAccess();
      throw error;
    }
    await this.protection.accessChanged();
    this.pro.onPermissionsChanged();
    await this.ensureHistory();
    this.documentAccess.clear();
    await this.reconcile();
    this.reconcileAccess();
    this.badge.markAll();
    await Promise.all([...this.dirtyDocs].map((key) => this.repository.run(key, () => this.persistNow(key))));
    await this.flushIndex();
    await this.visual.flush();
    await this.rtc.flush();
  }

  private reconcileAccess(restoring = false): void {
    // Redacted browser counters cannot re-prove their prior destination grants after a narrow
    // restart / permission mutation. Keep document access policy independent; discard this data.
    if (!this.scope.hasBroadNetworkAccess()) for (const [key, meta] of this.state.metas) {
      if (meta.networkCounters?.length || meta.requestedLocalPorts || meta.responseHeaders) this.apply({ type: 'network:reset', documentKey: key, at: this.now() });
    }
    const denied = new Set<string>();
    for (const binding of this.state.bindings.values()) {
      if (!this.hasDocumentAccess(binding.documentKey)) denied.add(binding.documentKey);
    }
    for (const [key, report] of this.state.reports) {
      if (!this.hasDocumentAccess(key)) denied.add(key);
    }
    for (const key of denied) {
      const meta = this.state.metas.get(key);
      // Browser resource evidence exists independently of a MAIN sensor hello.
      const pendingOrigin = [...this.state.bindings.values()].some(binding => binding.documentKey === key && binding.originPending === true);
      const preservePendingHistory = restoring && pendingOrigin && this.scope.getScopeMode() === 'all-sites' && this.scope.getState().grantedAllSites;
      if (meta && !meta.revoked && !preservePendingHistory && (meta.sensorSeen || (meta.networkCounters?.length ?? 0) > 0 || meta.requestedLocalPorts || meta.responseHeaders || (this.state.reports.get(key)?.hosts.length ?? 0) > 0)) {
        // A redacted historical host cannot prove an exact narrow grant after restart. Purge its
        // data, but do not convert an unresolved origin into a historical denial while scope exists.
        this.apply({ type: 'scope:revoked', documentKeys: [key],
          ...(restoring && pendingOrigin && this.scope.hasAnyHostAccess() ? { unresolvedOrigin: true as const } : {}), at: this.now() });
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
      pendingPageBatches: this.pendingPageBatches,
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
