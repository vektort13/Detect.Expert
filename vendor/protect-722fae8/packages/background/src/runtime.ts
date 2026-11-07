import { redactSenderContext } from './sender';
import { reportHost } from '../../attribution/src/index';
// Service-worker orchestration (spec A10, ADR-005 §5–6, ADR-011 §2, E05-02): holds the reducer state, waits
// for hydration behind a readiness promise with a bounded pending buffer, runs side effects (per-document
// serialized persistence, ACK after commit, LRU/TTL eviction, quota degradation with bounded retry).

import { createExportPreview } from '../../export/src/index';
import { EMPTY_CATALOG } from '@detect-expert/catalog';
import type { CatalogIndex } from '@detect-expert/catalog';
import { BUDGETS, SENSOR_IDS, WIRE_CATALOG_VERSION_PATTERN, makeDocumentKey, sanitizeHost } from '@detect-expert/contracts';
import type { Ack, BridgeControlCommand, BridgeControlMessage, DocumentReport, PageBatch, ReportProjection, ScopeState, SensorId, UiErrorCode, UiRequest, UiResponse } from '@detect-expert/contracts';
import { BadgeController } from './badge';
import type { BackgroundChromeApi, Clock } from './chrome-api';
import { systemClock } from './chrome-api';
import {
  bindingKey,
  deriveCoverageState,
  createInitialState,
  estimateReportBytes,
  hasScopeData,
  isProjected,
  planEviction,
  reduce,
  selectDocumentKey,
} from './documents';
import type { DocumentEvent, DocumentMeta, DocumentsState, Effect, FrameBinding, ReduceResult, SensorStamp } from './documents';
import { noopEngine } from './engine-port';
import type { EnginePort } from './engine-port';
import { NetworkWindowTracker } from './network-window';
import { projectReport } from './projection';
import { RateLimiter } from './rate-limit';
import { SessionRepository } from './repository';
import type { StoredDocument, StoredIndex } from './repository';
import { ScopeController } from './scope';
import { readFrameType, readLifecycle } from './sender';
import type { PageSenderContext } from './sender';
import { SensorPolicyController, inRegistryOrder, readSensorIdList } from './sensors';
import type { SensorChange } from './sensors';
import { ProtectController } from './protect/controller';
import type { ProtectControllerOptions } from './protect/controller';

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
  /** S07: salt of the ephemeral network window tokens (tests); default 16 random bytes per SW lifetime. */
  networkSalt?: string;
  /**
   * S10 / ADR-009 v1.1: vendor catalog of this build (the SW entry passes PRODUCTION_CATALOG). Default EMPTY_CATALOG:
   * no rules, so no matching and catalogVersion null in every projection.
   */
  catalog?: CatalogIndex;
  /** ADR-019 (S11): test profile only — the DevTools harness may replace the managed policy. */
  sensorPolicyTestOverride?: boolean;
  /**
   * ADR-020 (S04): options of the opt-in module «Защита» (IndexedDB factory, catalog protect-tables, test profile).
   * The clock and the host-access check come from the runtime. The module stays off until the user enables it.
   */
  protect?: Omit<ProtectControllerOptions, 'clock' | 'hostGranted'>;
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
  /** S10: version of the active catalog, or null when it has no rules (as in projections). */
  catalogVersion: string | null;
  /** S10: number of rules in the active catalog. */
  catalogRules: number;
  /** ADR-020 (S04): numbers of the module «Защита» only (state index, counts); no hosts, ids or values. */
  protect: Record<string, number>;
}

type Timer = ReturnType<typeof setTimeout>;

/** I1: where a webRequest attempt belongs (see BackgroundRuntime.networkDocumentLookup). */
export type NetworkDocumentLookup =
  | { readonly kind: 'document'; readonly key: string }
  | { readonly kind: 'excluded' }
  | { readonly kind: 'unbound' };

/**
 * I1 (ADR-018): lowest reportRevision a UI action may still carry for one report incarnation. Network-only updates
 * (request counts, hosts, rule ids) bump the revision on almost every request; they do not invalidate an action the
 * UI prepared at an earlier revision. Any other change resets the floor to the current revision (strict check).
 */
interface ActionFloor {
  readonly floor: number;
  readonly createdAt: number;
}

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
  /** S07 / ADR-018: SW-memory-only pattern windows (salted tokens; never stored or projected). */
  readonly networkWindows: NetworkWindowTracker;
  /** S10: compiled vendor catalog (local data; REQ-010). Replaced only through setCatalog(). */
  private catalogIndex: CatalogIndex;
  /** ADR-019 (S11): user and organization sensor family settings. */
  readonly sensors: SensorPolicyController;
  /** S12 / E13-03: per-tab toolbar badge (coalesced, bounded; never awaited inside a repository queue). */
  readonly badge: BadgeController;
  /** ADR-020 (S04): the opt-in module «Защита» (OFF by default; nothing of it runs until the user enables it). */
  readonly protect: ProtectController;
  private protectStarted = false;

  private readonly engine: EnginePort;
  private readonly clock: Clock;
  private readonly maxPending: number;
  private readonly persistDebounceMs: number;
  private readonly ttlIntervalMs: number;
  private readonly maxPersistAttempts: number;

  private readonly readiness: Promise<void>;
  private resolveReady: () => void = () => undefined;
  private isReady = false;
  private started = false;
  private readonly pending: DocumentEvent[] = [];
  private pendingDropped = 0;
  private pendingBatches = 0;

  /** P07 / ADR-005: bound validated messages retained across the shared readiness promise. */
  async batchReadiness(documentKey: string): Promise<boolean> {
    if (this.isReady) return true;
    if (this.pendingBatches >= BUDGETS.maxOutOfOrderEntriesGlobal) {
      this.pendingDropped = Math.min(BUDGETS.maxCount, this.pendingDropped + 1);
      this.countTransportDrop(documentKey);
      return false;
    }
    this.pendingBatches++;
    try { await this.readiness; return true; }
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
  /** I1: SW-memory only; a missing entry means the strict check (after a restart, a clear or any non-network change). */
  private readonly actionFloors = new Map<string, ActionFloor>();
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
    this.sensors = new SensorPolicyController(api, options.sensorPolicyTestOverride === true ? { testOverride: true } : {});
    this.scope = new ScopeController(api, this.clock, options.testBootstrap, () => this.sensors.effectiveOff());
    this.repository = new SessionRepository(api.storage.session);
    this.networkWindows = new NetworkWindowTracker(options.networkSalt === undefined ? {} : { salt: options.networkSalt });
    this.catalogIndex = BackgroundRuntime.checkCatalog(options.catalog ?? EMPTY_CATALOG);
    this.protect = new ProtectController(api, { ...(options.protect ?? {}), clock: this.clock, hostGranted: (host, scheme) => this.scope.isHostGrantedSync(host, scheme) });
    // Review W3: the module's MAIN registration follows observation's (no-op while the module is off).
    this.scope.onMainRegistered(() => void this.protect.onObservationMainRegistered().catch(() => undefined));
    this.badge = new BadgeController(
      api,
      (tabId) => ({ report: this.getProjection(tabId), scopeMode: this.scope.getScopeMode(), protectPending: this.protect.pendingCount(tabId) }),
      async () => (await api.tabs.query({})).flatMap((tab) => (typeof tab.id === 'number' && tab.id >= 0 ? [tab.id] : [])),
    );
    // ADR-020 §D (S09): a transfer record may open a firewall prompt in its tab (the firewall lane subscribed first,
    // in the controller's constructor); the badge of that tab is recomputed now and once the lane settled.
    this.protect.eventBus.subscribe('evidence', (event) => this.badge.markTabSettled(event.tabId));
    this.readiness = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });
  }

  now(): number {
    return this.clock.now();
  }

  /** S10: the active vendor catalog (EMPTY_CATALOG unless the entry passed one). */
  get catalog(): CatalogIndex {
    return this.catalogIndex;
  }

  /**
   * S10: replaces the active catalog (test profile: synthetic on/off). Only a compiled index of a known kind is
   * accepted. Stored host rule ids stay; projections show only ids that are valid in the active catalog.
   */
  setCatalog(index: CatalogIndex): void {
    this.catalogIndex = BackgroundRuntime.checkCatalog(index);
  }

  private static checkCatalog(index: CatalogIndex): CatalogIndex {
    const ok = typeof index === 'object' && index !== null && (index.kind === 'production' || index.kind === 'test') &&
      typeof index.catalogVersion === 'string' && WIRE_CATALOG_VERSION_PATTERN.test(index.catalogVersion) &&
      index.rulesById instanceof Map && index.networkByHost instanceof Map && index.networkBySuffix instanceof Map && Array.isArray(index.rules);
    if (!ok) throw new TypeError('invalid-catalog');
    return index;
  }

  whenReady(): Promise<void> {
    return this.readiness;
  }

  /** Hydration finished; synchronous listeners (network) check this before reading bindings. */
  get ready(): boolean {
    return this.isReady;
  }

  /**
   * S07 / ADR-018: document key of a webRequest attempt from trusted browser ids only (REQ-004): a current binding
   * (I1: or the document's report after its binding moved on), document access in the current scope generation, and a
   * document that is neither paused nor revoked.
   */
  networkDocumentKey(tabId: number, frameId: number, documentId: string): string | null {
    const lookup = this.networkDocumentLookup(tabId, frameId, documentId);
    return lookup.kind === 'document' ? lookup.key : null;
  }

  /**
   * I1 (docs/PROJECT_RULES.md #9/#11): like networkDocumentKey, but tells an excluded document (out of scope, paused, revoked:
   * nothing to record by design) from an unknown one ('unbound': no current binding and no report under these Chrome
   * ids — the request raced webNavigation.onCommitted, or the documentId is unknown after hydration). The caller
   * counts 'unbound' as an explicit gap (unattributed.requests) instead of dropping it silently. A document whose
   * binding already moved on (keepalive beacon after the next commit) still owns its report: the ids are Chrome's.
   */
  networkDocumentLookup(tabId: number, frameId: number, documentId: string): NetworkDocumentLookup {
    if (!this.isReady || !this.scope.accessReady) return { kind: 'unbound' };
    const key = this.resolveNetworkDocument(tabId, frameId, documentId);
    if (key === null) return { kind: 'unbound' };
    if (!this.hasDocumentAccess(key)) return { kind: 'excluded' };
    const meta = this.state.metas.get(key);
    if (meta !== undefined && (meta.paused || meta.revoked || meta.accessGranted === false)) return { kind: 'excluded' };
    return { kind: 'document', key };
  }

  /** Current binding of these Chrome ids, else an existing report under the same ids (binding moved on), else null. */
  private resolveNetworkDocument(tabId: number, frameId: number, documentId: string): string | null {
    for (const b of this.state.bindings.values()) {
      if (b.tabId === tabId && b.frameId === frameId && b.documentId === documentId) return b.documentKey;
    }
    const key = makeDocumentKey(tabId, frameId, documentId);
    return this.state.reports.has(key) && this.state.metas.has(key) ? key : null;
  }

  /** webRequest attempt without a document (tabId < 0: workers, browser): one saturating counter, nothing else. */
  countUnattributedRequest(): void {
    const u = this.state.unattributed;
    this.state = { ...this.state, unattributed: { ...u, requests: Math.min(BUDGETS.maxCount, u.requests + 1) } };
  }

  /**
   * S07 / ADR-018 (variant A): while the network view is permission-limited (active-tab, site, or all-sites without
   * the broad grant), documents with access carry the monotonic 'network-limited' flag, so coverage is 'partial'.
   * Widening the scope later does not remove it: earlier requests stayed unobserved.
   */
  private ensureNetworkLimited(keys: Iterable<string>, inQueueFor: string | null = null): void {
    if (!this.scope.accessReady || this.scope.networkUnrestricted()) return;
    const pending: string[] = [];
    for (const key of keys) {
      const report = this.state.reports.get(key);
      const meta = this.state.metas.get(key);
      if (report === undefined || meta === undefined || meta.revoked || meta.accessGranted === false) continue;
      if (report.coverageFlags.includes('network-limited') || !this.hasDocumentAccess(key) || pending.includes(key)) continue;
      pending.push(key);
    }
    if (pending.length > 0) this.apply({ type: 'network:limited', documentKeys: pending, at: this.now() }, inQueueFor);
  }

  // ---------------------------------------------------------------------------
  // Hydration (A10): restore snapshots, bindings and watermarks, reconcile with live frames, then drain.
  // ---------------------------------------------------------------------------

  async start(): Promise<void> {
    if (this.started) return this.readiness;
    this.started = true;
    try {
      await this.repository.init();
      const loaded = await this.repository.loadAll();
      // ADR-019: the sensor settings decide the MAIN prelude files the scope registers.
      await this.sensors.load();
      await this.scope.startup();
      this.startProtect();
      this.hydrate(loaded.index, loaded.documents);
      await this.reconcile();
      this.reconcileAccess();
      // ADR-019: settings changed while the SW was stopped reach the live documents now (idempotent).
      this.applySensorsDisabled();
    } catch {
      // A broken hydration must never block the listeners: start from an empty state.
      this.state = createInitialState();
      this.degraded = true;
    }
    this.startProtect();
    const buffered = this.pending.splice(0, this.pending.length);
    for (const ev of buffered) this.apply(ev);
    this.reconcileAccess();
    this.isReady = true;
    for (const key of this.transportDrops.keys()) this.schedulePersist(key);
    this.resolveReady();
    // S12: colours, then every open tab (hydrated reports and the current scope mode).
    this.badge.start();
    this.ttlTick();
    if (this.ttlIntervalMs > 0 && this.ttlTimer === null) {
      this.ttlTimer = setInterval(() => this.ttlTick(), this.ttlIntervalMs);
    }
  }

  /**
   * ADR-020 (S04): the module loads its settings after the scope startup, without blocking hydration (an error there
   * never breaks observation). Off: two storage reads, nothing else.
   */
  private startProtect(): void {
    if (this.protectStarted) return;
    this.protectStarted = true;
    void this.protect.load().catch(() => undefined);
  }

  /** ADR-020 (S04): a committed report reaches the module's lanes (history, S12) only while a lane wants it. */
  private notifyProtect(documentKey: string, report: Readonly<DocumentReport>, meta: Readonly<DocumentMeta>): void {
    if (!this.protect.wantsReports) return;
    const bindingOf = (tabId: number, documentId: string): FrameBinding | null => {
      for (const b of this.state.bindings.values()) if (b.tabId === tabId && b.documentId === documentId) return b;
      return null;
    };
    let binding: FrameBinding | null = null;
    for (const b of this.state.bindings.values()) if (b.documentKey === documentKey) { binding = b; break; }
    try {
      this.protect.onReportPersisted(report, binding, { paused: meta.paused, bindingOf });
    } catch {
      // The module isolates its lanes; observation never depends on it.
    }
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
      // ADR-019: stored sensor lists are re-validated (known ids, registry order, hooksMayRemain ⊆ off).
      const off = readSensorIdList(doc.meta.sensorsOff);
      const may = readSensorIdList(doc.meta.sensorsHooksMayRemain).filter((id) => off.includes(id));
      delete meta.sensorsOff;
      delete meta.sensorsHooksMayRemain;
      if (off.length > 0) {
        meta.sensorsOff = off;
        meta.sensorsHooksMayRemain = may;
        if (!doc.report.coverageFlags.includes('sensor-disabled')) doc.report.coverageFlags = [...doc.report.coverageFlags, 'sensor-disabled'];
      }
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
          // ADR-019: what was registered when these documents loaded is unknown after a restart (conservative).
          sensors: this.sensorStamp('conservative'),
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
    if (!this.isReady) {
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
    let accessExpired = false;
    if (event.type === 'navigation:before') event = { ...event, host: null };
    if (event.type === 'navigation:committed') {
      const top = event.frameType === 'outermost_frame' || (event.frameType === null && event.frameId === 0);
      if (top && event.documentLifecycle !== 'prerender') accessExpired = this.scope.noteTopCommit(event.tabId, event.host, event.documentId);
      const accessGranted = (!this.isReady && this.hasDocumentAccess(String(event.tabId) + ':' + event.frameId + ':' + event.documentId)) || (event.accessGranted ?? (this.scope.accessReady && this.scope.inScope(event.host, event.tabId, event.documentId, event.scheme)));
      const accessKey = String(event.tabId) + ':' + event.frameId + ':' + event.documentId;
      if (accessGranted) this.grantDocumentAccess(accessKey); else this.documentAccess.delete(accessKey);
      event = { ...event, host: accessGranted ? reportHost(event.host) : null, accessGranted, sensors: event.sensors ?? this.sensorStamp('normal') };
    }
    // ADR-019: a report created lazily (batch before its commit, network request) gets the conservative stamp.
    if ((event.type === 'batch' || event.type === 'network:host') && event.sensors === undefined) event = { ...event, sensors: this.sensorStamp('conservative') };
    // PT-1: a re-granted document stops storing the families disabled while it had no access (hooks may remain).
    if (event.type === 'scope:access' && event.accessGranted && event.sensors === undefined) event = { ...event, sensors: this.sensorStamp('conservative') };
    if (event.type === 'network:host') {
      const parent = event.resourceType === 'sub_frame' && event.parentDocumentId !== null && event.parentFrameId !== null && event.parentFrameId >= 0;
      const documentId = parent ? event.parentDocumentId : event.documentId;
      const frameId = parent ? event.parentFrameId : event.frameId;
      const key = documentId === null || frameId === null ? null : this.resolveNetworkDocument(event.tabId, frameId, documentId);
      if (key === null || !this.hasDocumentAccess(key)) return { state: this.state, effects: [] };
    }
    if (event.type === 'network:vendor-match') {
      // S10: the event already names the owning document; it needs that document (bound, or its report after the
      // binding moved on, I1) and access.
      const key = this.resolveNetworkDocument(event.tabId, event.frameId, event.documentId);
      if (key === null || !this.hasDocumentAccess(key)) return { state: this.state, effects: [] };
    }
    if (event.type === 'tab:removed') for (const key of this.documentAccess.keys()) if (key.startsWith(String(event.tabId) + ':')) this.documentAccess.delete(key);
    const before = this.state;
    const result = reduce(this.state, event, this.engine);
    this.state = result.state;
    this.trackActionFloors(event, before, result.effects);
    if (this.documentAccess.size > 1024) { this.documentAccess.clear(); this.reconcileAccess(); }
    this.runEffects(result.effects, inQueueFor);
    this.markBadge(event);
    if (accessExpired) this.reconcileAccess();
    if (event.type !== 'network:limited') {
      const touched: string[] = [];
      for (const effect of result.effects) if (effect.type === 'persist') touched.push(effect.documentKey);
      if (touched.length > 0) this.ensureNetworkLimited(touched, inQueueFor);
    }
    return result;
  }

  /**
   * I1: network:host / network:vendor-match keep (or open) the action floor of the reports they touched at the
   * revision before the event; every other event drops it, so the next UI action must carry the current revision.
   */
  private trackActionFloors(event: DocumentEvent, before: DocumentsState, effects: readonly Effect[]): void {
    if (event.type !== 'network:host' && event.type !== 'network:vendor-match') {
      // Any report this event replaced or removed returns to the strict check (independent of the effect list).
      for (const key of [...this.actionFloors.keys()]) {
        if (this.state.reports.get(key) !== before.reports.get(key)) this.actionFloors.delete(key);
      }
      return;
    }
    for (const effect of effects) {
      if (effect.type === 'remove') {
        for (const key of effect.documentKeys) this.actionFloors.delete(key);
        continue;
      }
      if (effect.type !== 'persist') continue;
      const key = effect.documentKey;
      const after = this.state.reports.get(key);
      if (after === undefined) {
        this.actionFloors.delete(key);
        continue;
      }
      const kept = this.actionFloors.get(key);
      if (kept !== undefined && kept.createdAt === after.createdAt) continue;
      const prev = before.reports.get(key);
      // A report created by this very event: no earlier view of it can exist.
      const floor = prev !== undefined && prev.createdAt === after.createdAt ? prev.revision : after.revision;
      this.actionFloors.set(key, { floor, createdAt: after.createdAt });
    }
  }

  /** S12: the tab an event belongs to gets its badge recomputed; a closed or replaced tab is forgotten. */
  private markBadge(event: DocumentEvent): void {
    switch (event.type) {
      case 'tab:removed':
        this.badge.forget(event.tabId);
        return;
      case 'tab:replaced':
        this.badge.forget(event.removedTabId);
        this.badge.markTab(event.addedTabId);
        return;
      case 'batch':
        this.badge.markTab(event.sender.tabId);
        return;
      default:
        if ('tabId' in event && typeof event.tabId === 'number') this.badge.markTab(event.tabId);
    }
  }

  /**
   * ADR-020 §D (S09): after a module UI action that can change the firewall prompts waiting in a tab (decide, undo,
   * dismiss) that tab's badge is recomputed; actions of the whole module (snooze, enable, disable, settings, sites,
   * purge, rule removal) recompute every open tab. Reads change nothing and mark nothing.
   */
  markProtectBadge(type: UiRequest['type'], tabId: number | null): void {
    switch (type) {
      case 'ui-protect-decide':
      case 'ui-protect-undo':
      case 'ui-protect-dismiss':
        if (tabId !== null) this.badge.markTab(tabId);
        return;
      case 'ui-protect-snooze':
      case 'ui-protect-enable':
      case 'ui-protect-disable':
      case 'ui-protect-set-settings':
      case 'ui-protect-set-site':
      case 'ui-protect-purge':
      case 'ui-protect-remove-rules':
        this.badge.markAll();
        return;
      default:
    }
  }

  private runEffects(effects: readonly Effect[], inQueueFor: string | null): void {
    for (const effect of effects) {
      switch (effect.type) {
        case 'persist':
          this.badge.markDocument(effect.documentKey);
          this.dirtyDocs.add(effect.documentKey);
          if (effect.documentKey === inQueueFor) break; // the caller persists inside the queue
          if (effect.immediate) this.queuePersist(effect.documentKey);
          else this.schedulePersist(effect.documentKey);
          break;
        case 'remove':
          for (const key of effect.documentKeys) {
            this.networkWindows.forget(key);
            this.queueRemove(key);
            this.badge.markDocument(key);
          }
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
      await this.repository.remove([documentKey]);
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
    if (this.now() < this.persistCooldownUntil) return false;
    this.foldTransportDrops(documentKey);
    // P07: covers immediate commits and quarantine replay. The flag proves at least one eviction,
    // including clean entries; it cannot quantify permanently lost observations on the v1 wire.
    const overflow = this.state.reports.get(documentKey);
    if (overflow?.coverageFlags.includes('bridge-ring-overflow') && (overflow.dropped.ring ?? 0) === 0) {
      this.state = { ...this.state, reports: new Map(this.state.reports).set(documentKey,
        { ...overflow, revision: Math.min(BUDGETS.maxCount, overflow.revision + 1), dropped: { ...overflow.dropped, ring: 1 } }) };
      this.actionFloors.delete(documentKey);
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
        this.notifyProtect(documentKey, current, currentMeta);
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
    let total = 0;
    for (const v of this.estimated.values()) total += v;
    return total;
  }

  ttlTick(): void {
    if (!this.isReady) return;
    this.sweepExpired(this.now());
  }

  /** P02 / F171: events resume retention after SW suspension; at most one scan per 30 seconds. */
  sweepExpired(now: number): void {
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
    this.networkWindows.clear();
    this.badge.stop();
    this.protect.stop();
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
    await this.readiness;
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
      if (meta?.accessGranted === false || meta?.revoked) this.apply({ type: 'scope:access', documentKey: ctx.documentKey, host: ctx.host, accessGranted: true, at: this.now() }, ctx.documentKey);
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

  // ---------------------------------------------------------------------------
  // Sensor families (ADR-019, S11)
  // ---------------------------------------------------------------------------

  /**
   * Sensor stamp of a new report: normal (commit), conservative (restart / lazily created report: hooks may remain
   * for every off family) or exact (late injection with the prelude: off = exactly what was injected as disabled).
   * registered === null: no prelude registration, so the sensor bundle installed nothing at load.
   */
  private sensorStamp(kind: 'normal' | 'conservative' | 'exact', exactOff?: readonly SensorId[]): SensorStamp {
    const desired = this.sensors.effectiveOff();
    if (kind === 'exact') return { off: inRegistryOrder(exactOff ?? desired), hooksMayRemain: [] };
    const registered = this.scope.registeredOff;
    if (registered === null) return { off: desired, hooksMayRemain: kind === 'conservative' ? desired : [] };
    const off = inRegistryOrder([...desired, ...registered]);
    return { off, hooksMayRemain: kind === 'conservative' ? off : desired.filter((id) => !registered.includes(id)) };
  }

  /** Live documents stop storing the currently disabled families (reducer event; idempotent). */
  private applySensorsDisabled(): void {
    const off = this.sensors.effectiveOff();
    if (off.length > 0) this.apply({ type: 'sensors:disabled', ids: off, at: this.now() });
  }

  /** ADR-019 order: reducer event first (data stops at once), then the registration, then the controller persists. */
  private async applySensorChange(change: SensorChange): Promise<void> {
    this.applySensorsDisabled();
    const same = change.before.length === change.after.length && change.before.every((id, i) => id === change.after[i]);
    if (!same) await this.scope.ensureRegistration();
  }

  /** ScopeState for the UI: scope fields plus the sensor settings (ADR-019). */
  scopeState(): ScopeState {
    return { ...this.scope.getState(), sensorSettings: this.sensors.settings() };
  }

  /** ui-set-sensor (options page). The answer is the resulting scope state. */
  async setSensor(sensorId: SensorId, enabled: boolean): Promise<UiResponse> {
    await this.readiness;
    await this.sensors.setUser(sensorId, enabled, (change) => this.applySensorChange(change));
    return { schemaVersion: 1, type: 'scope', scope: this.scopeState() };
  }

  /** chrome.storage.managed.onChanged: the organization policy changed (applied on the fly, ADR-019). */
  async onManagedPolicyChanged(): Promise<void> {
    await this.readiness;
    await this.sensors.refreshManaged((change) => this.applySensorChange(change));
  }

  /** Every registry family is off for this document: no sensor data can arrive by design (F162 exception). */
  private allSensorsOff(meta: DocumentMeta): boolean {
    const off = meta.sensorsOff ?? [];
    return SENSOR_IDS.every((id) => off.includes(id));
  }

  getProjection(tabId: number, frameId?: number): ReportProjection | null {
    const key = selectDocumentKey(this.state, tabId, frameId);
    if (key === null) return null;
    return this.projectionByKey(key);
  }

  projectionByKey(documentKey: string): ReportProjection | null {
    const report = this.state.reports.get(documentKey);
    const meta = this.state.metas.get(documentKey);
    if (report === undefined || meta === undefined) return null;
    const pending = this.transportDrops.get(documentKey) ?? 0;
    let flags = pending > 0 && !report.coverageFlags.includes('throttled') ? [...report.coverageFlags, 'throttled' as const] : report.coverageFlags;
    // F162 / REQ-006: a document nobody injected into is not "partially observed". When no sensor ever connected,
    // no late injection happened and the browser has no registration covering the host, the honest state is
    // no-access (the extension does not run on this page), never partial.
    let stateMeta: DocumentMeta = meta;
    // ADR-019: with every family disabled nothing is expected from the sensor; the document stays 'partial'.
    if (!meta.sensorSeen && !meta.lateInjection && report.watermark === null && !meta.revoked && meta.accessGranted !== false && !this.allSensorsOff(meta)) {
      if (!flags.includes('no-host-permission')) flags = [...flags, 'no-host-permission' as const];
      stateMeta = { ...meta, accessGranted: false };
    }
    // S10: the catalog view is passed only when it has rules (otherwise catalogVersion null, vendors []).
    const catalog = this.catalogIndex.rules.length > 0 ? { view: this.catalogIndex, nowMs: this.now() } : null;
    try {
      return projectReport({ ...report, coverageFlags: flags, coverageState: deriveCoverageState(flags, stateMeta),
        dropped: { ...report.dropped, transport: Math.min(BUDGETS.maxCount, report.dropped.transport + pending) } }, meta, this.scope.getScopeMode(), catalog,
      (id) => this.sensors.sourcesOf(id));
    } catch { return null; }
  }

  /**
   * SW -> bridge control (ADR-004 changelog, F030): tells the document's ISOLATED bridge to pause/resume at once.
   * Best effort: a document without a bridge has no listener, and a paused bridge never sends, so an Ack could
   * never carry `paused: false` on its own.
   */
  private sendControl(documentKey: string, command: BridgeControlCommand): void {
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
    if (report === undefined) return 'not-found';
    if (report.tabId !== tabId) return 'document-mismatch';
    if (reportRevision !== null && !this.revisionCurrent(documentKey, report, reportRevision)) return 'stale-revision';
    return null;
  }

  /**
   * I1: the revision a UI action carries is current when it equals the report's revision, or when only network
   * updates (counts, hosts, rule ids) happened since (floor ≤ revision ≤ current). Page batches, pause/resume,
   * coverage and lifecycle changes reset the floor, so a view older than those still gets stale-revision.
   */
  private revisionCurrent(documentKey: string, report: Readonly<DocumentReport>, reportRevision: number): boolean {
    if (report.revision === reportRevision) return true;
    const floor = this.actionFloors.get(documentKey);
    if (floor === undefined || floor.createdAt !== report.createdAt) return false;
    return reportRevision >= floor.floor && reportRevision < report.revision;
  }

  async pause(tabId: number, documentKey: string, reportRevision: number): Promise<UiResponse> {
    await this.readiness;
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
    await this.readiness;
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
    await this.readiness;
    return this.repository.run(documentKey, async () => {
      const error = this.checkDocument(tabId, documentKey, reportRevision);
      if (error !== null) return uiError(error);
      const result = reduce(this.state, { type: 'ui:clear', documentKey, at: this.now() }, this.engine);
      this.state = result.state;
      this.badge.markDocument(documentKey);
      this.actionFloors.delete(documentKey);
      this.networkWindows.forget(documentKey);
      this.dirtyDocs.delete(documentKey);
      this.persisted.delete(documentKey);
      this.estimated.delete(documentKey);
      await this.repository.remove([documentKey]);
      this.markIndexDirty();
      this.scheduleIndexFlush();
      return { schemaVersion: 1, type: 'ok', reportRevision: null };
    });
  }

  /**
   * ui-clear-session (options page): every document report of the session is deleted, in memory and in
   * storage.session; bindings and scope prefs stay, so observed documents start a fresh report on their next batch.
   * Each document is cleared inside its own serialized queue (no interleaving with a commit of that document).
   */
  async clearSession(): Promise<UiResponse> {
    await this.readiness;
    this.networkWindows.clear();
    const keys = [...this.state.reports.keys()];
    await Promise.all(
      keys.map((documentKey) =>
        this.repository.run(documentKey, async () => {
          this.state = reduce(this.state, { type: 'ui:clear', documentKey, at: this.now() }, this.engine).state;
          this.actionFloors.delete(documentKey);
          const timer = this.persistTimers.get(documentKey);
          if (timer !== undefined) {
            clearTimeout(timer);
            this.persistTimers.delete(documentKey);
          }
          this.dirtyDocs.delete(documentKey);
          this.persisted.delete(documentKey);
          this.estimated.delete(documentKey);
          await this.repository.remove([documentKey]);
        }),
      ),
    );
    this.markIndexDirty();
    await this.flushIndex();
    // ADR-020 (S04): the module's session documents go too (nothing to do while it never ran).
    await this.protect.clearSession().catch(() => undefined);
    this.badge.markAll();
    return { schemaVersion: 1, type: 'ok', reportRevision: null };
  }

  /** Export preview = exactly the redacted projection shown in the UI (REQ-013); no raw data. */
  async exportPreview(tabId: number, documentKey: string, reportRevision: number, includeHost = false): Promise<UiResponse> {
    await this.readiness;
    const error = this.checkDocument(tabId, documentKey, reportRevision);
    if (error !== null) return uiError(error);
    const report = this.projectionByKey(documentKey);
    if (report === null) return uiError('not-found');
    const preview = createExportPreview(report, this.now(), includeHost);
    return { schemaVersion: 1, type: 'export-preview', preview };
  }

  /** ui-inject-now (active-tab mode): late injection under the activeTab grant; the tab's documents get `late-start`. */
  async injectNow(tabId: number): Promise<UiResponse> {
    await this.readiness;
    const key = selectDocumentKey(this.state, tabId);
    const seenBefore = new Set([...this.state.metas].filter(([, meta]) => meta.sensorSeen).map(([id]) => id));
    let frames: Awaited<ReturnType<BackgroundChromeApi['webNavigation']['getAllFrames']>>;
    try { frames = await this.api.webNavigation.getAllFrames({ tabId }); } catch { return uiError('no-access'); }
    const top = frames?.find((f) => f.frameId === 0 && f.documentLifecycle !== 'prerender');
    if (!top || typeof top.documentId !== 'string') return uiError('no-access');
    const host = sanitizeHost(top.url);
    const injected = await this.scope.injectWithPolicy(tabId, host, top.documentId);
    if (!injected.ok) return uiError('no-access');
    const injectedKey = String(tabId) + ':0:' + top.documentId;
    this.grantDocumentAccess(injectedKey);
    // PT-1: the prelude just injected is exact for a document without an earlier sensor; otherwise conservative.
    const stamp = seenBefore.has(injectedKey) ? this.sensorStamp('conservative') : this.sensorStamp('exact', injected.off);
    this.apply({ type: 'scope:access', documentKey: injectedKey, host, accessGranted: true, sensors: stamp, at: this.now() });
    if (!seenBefore.has(injectedKey)) this.apply({ type: 'injection:late', documentKeys: [injectedKey], sensors: this.sensorStamp('exact', injected.off), at: this.now() });
    this.reconcileAccess();
    return { schemaVersion: 1, type: 'ok', reportRevision: key === null ? null : (this.state.reports.get(key)?.revision ?? null) };
  }

  /** Permission change (grant or revoke): refresh grants, reconcile registration, revoke documents out of scope. */
  async onPermissionsChanged(): Promise<void> {
    await this.readiness;
    this.documentAccess.clear();
    await this.scope.onPermissionsChanged();
    this.documentAccess.clear();
    await this.reconcile();
    this.reconcileAccess();
    // PT-1 (ADR-019): documents with access again stop storing the families disabled meanwhile (idempotent).
    this.applySensorsDisabled();
    await Promise.all([...this.dirtyDocs].map((key) => this.repository.run(key, () => this.persistNow(key))));
    await this.flushIndex();
    // S12: scope mode or grants changed: every tab's badge and tooltip (off / revoked / no-access) is recomputed.
    this.badge.markAll();
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
      const report = this.state.reports.get(key);
      // CW-01 (ADR-003 §5, ADR-007 §6): any scope data is purged, not only a sensor's. A quiet document or one with
      // every sensor family disabled can still hold browser-network hosts and counters.
      if (meta && !meta.revoked && (meta.sensorSeen || (report !== undefined && hasScopeData(report)))) {
        // P05 / REQ-012: an idle or paused bridge cannot learn revocation from its next ACK.
        if (meta.sensorSeen) this.sendControl(key, 'stop');
        this.apply({ type: 'scope:revoked', documentKeys: [key], at: this.now() });
      }
      this.networkWindows.forget(key);
      this.transportDrops.delete(key);
      this.apply({ type: 'scope:access', documentKey: key, host: null, accessGranted: false, at: this.now() });
    }
    // Scope reduction also discards queued page work and its origin hints.
    this.state = { ...this.state, quarantine: this.state.quarantine.filter((q) => this.hasDocumentAccess(q.documentKey)) };
    this.ensureNetworkLimited(this.state.reports.keys());
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
      catalogVersion: this.catalogIndex.rules.length > 0 ? this.catalogIndex.catalogVersion : null,
      catalogRules: this.catalogIndex.rules.length,
      protect: this.protect.diagnostics(),
    };
  }
}
