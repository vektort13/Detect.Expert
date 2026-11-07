// ADR-020 §G (S12): the SW lane of the history «Кто вас узнаёт» (feature `history`, off by default; the module itself is
// off by default). While the feature is off this service does not run: no delta, no IndexedDB record. Turning the
// feature off clears the history stores; turning the module off keeps them until the user purges.
// Sources: persisted observation reports (onReportPersisted) and the module event bus (onEvent). Deltas wait in memory
// (≤ 1024 keys) and are flushed every historyFlushMs or when full; queries flush first. Retention runs once per UTC
// day at the next event. Storage errors make the storage state `degraded` (`storage-unavailable`); a database removed
// by the browser while the history was on is reported as `storage-reset`. Everything here is days, domains, enums
// and counts; the UI gets HistoryProjection / HistoryReceiverCard / HistoryExport only.

import { HISTORY_WINDOW_DAYS, PROTECT_BUDGETS, PROTECT_LIMITATIONS, PROTECT_WIRE_LIMITS, isDomainName, isSiteName } from '@detect-expert/contracts';
import type {
  DocumentReport,
  FieldKind,
  HistoryProjection,
  HistoryRetentionDays,
  HistoryStorageState,
  HistoryWindowDays,
  ProtectLimitation,
  ProtectUiRequest,
  UiResponse,
  ValueEncoding,
} from '@detect-expert/contracts';
import {
  HISTORY_SIGNAL_ALL,
  NO_HISTORY_VENDOR,
  addHistoryDropped,
  historyDayIndex,
  historyDayString,
  historyExportData,
  historyReceiverCard,
  historyRowKey,
  newHistoryState,
  rankHistory,
} from '@detect-expert/engine';
import type { HistorySightingDelta, HistorySiteDelta, HistoryStateRecord, HistoryVendorOfRule } from '@detect-expert/engine';
import { createHistoryExport } from '../../../../export/src/protect-history';
import type { FrameBinding } from '../../documents';
import type { ProtectDb } from '../db-port';
import type { ProtectEvent } from '../event-bus';
import type { PersistedReportInfo, ProtectFeatureService, ProtectServiceContext, ProtectStopReason } from '../services';
import { HistoryAccumulator } from './accumulator';
import type { HistoryDrained } from './accumulator';
import { HistoryAwaitingSends } from './awaiting';
import { HistoryFoldMemo, asSent, awaitedRequestId, foldEvent, foldReport } from './fold';
import { HISTORY_LIMITS, HistoryStore } from './store';
import type { HistoryLimits, HistoryLoaded } from './store';

const DAY_MS = 86_400_000;
/** Loaded records are kept for repeated queries at most this long (and only for the same revision). */
const CACHE_TTL_MS = 60_000;
/** Test harness: the history clock may be moved by at most this many days. */
const MAX_DAY_OFFSET = 400;

export interface HistoryServiceOptions {
  flushMs?: number;
  maxPending?: number;
  limits?: HistoryLimits;
  vendorOf?: HistoryVendorOfRule;
  maxExportBytes?: number;
}

interface CachedLoad {
  revision: number;
  at: number;
  data: HistoryLoaded;
}

function errorResponse(code: 'invalid-request' | 'storage-unavailable' | 'not-found'): UiResponse {
  return { schemaVersion: 1, type: 'error', code };
}

function windowOf(days: number): HistoryWindowDays {
  return (HISTORY_WINDOW_DAYS as readonly number[]).includes(days) ? (days as HistoryWindowDays) : 30;
}

export class HistoryService implements ProtectFeatureService {
  readonly name = 'history' as const;
  readonly features = ['history'] as const;

  private ctx: ProtectServiceContext | null = null;
  private store: HistoryStore | null = null;
  private state: HistoryStateRecord | null = null;
  private readonly memo = new HistoryFoldMemo();
  /** value-match records waiting for their request's outcome (§11: only `sent` counts). */
  private readonly awaiting = new HistoryAwaitingSends();
  private acc: HistoryAccumulator;
  private chain: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cacheTimer: ReturnType<typeof setTimeout> | null = null;
  private cache: CachedLoad | null = null;
  private storage: HistoryStorageState = 'ok';
  private dayOffset = 0;
  /** Deltas refused while a flush was running (saturating, merged into the state at the next flush). */
  private pendingDropped = 0;
  private unresolved = 0;
  /** Full batches taken out of the accumulator and not yet written. */
  private queuedBatches = 0;
  private readonly flushMs: number;
  private readonly limits: HistoryLimits;
  private readonly vendorOf: HistoryVendorOfRule;
  private readonly maxExportBytes: number | undefined;
  private stats = { folds: 0, events: 0, flushes: 0, flushFailures: 0, purges: 0, queries: 0, resets: 0, unsent: 0 };

  constructor(options: HistoryServiceOptions = {}) {
    this.flushMs = options.flushMs ?? PROTECT_BUDGETS.historyFlushMs;
    this.acc = new HistoryAccumulator(options.maxPending ?? PROTECT_BUDGETS.maxPendingDeltas);
    this.limits = options.limits ?? HISTORY_LIMITS;
    this.vendorOf = options.vendorOf ?? NO_HISTORY_VENDOR;
    this.maxExportBytes = options.maxExportBytes;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  private now(): number {
    return (this.ctx?.clock.now() ?? 0) + this.dayOffset * DAY_MS;
  }

  private today(): number {
    return historyDayIndex(this.now());
  }

  private retention(): HistoryRetentionDays {
    return this.ctx?.settings().historyRetentionDays ?? PROTECT_BUDGETS.defaultHistoryRetentionDays;
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.chain.then(task, task);
    this.chain = next.catch(() => undefined);
    return next;
  }

  async start(ctx: ProtectServiceContext): Promise<void> {
    this.ctx = ctx;
    const db: ProtectDb | null = ctx.db;
    this.store = db === null ? null : new HistoryStore(db, this.limits);
    this.storage = db === null ? 'unavailable' : 'ok';
    this.state = null;
    this.cache = null;
    await this.serial(() => this.init());
  }

  /** Reads (or creates) the state and runs the day's retention. Storage errors never throw out of here. */
  private async init(): Promise<void> {
    const store = this.store;
    if (store === null) return;
    try {
      const today = this.today();
      const stored = await store.readState();
      if (stored === null || stored === 'malformed') {
        this.state = newHistoryState(today);
        if (stored === 'malformed') addHistoryDropped(this.state.dropped, 'malformed');
        this.state.counts = await store.counts();
        await store.writeState(this.state);
      } else this.state = stored;
      await this.purgeIfDue(today);
      this.markOk();
    } catch {
      this.markFailed();
    }
  }

  async stop(reason: ProtectStopReason): Promise<void> {
    this.clearTimer();
    this.clearCache();
    if (reason === 'feature-off') {
      // Turning the history off deletes all its records (the UI warns before).
      this.acc.clear();
      await this.serial(async () => {
        try {
          await this.store?.clearAll();
        } catch {
          this.markFailed();
        }
      });
    } else {
      // Module off / suspended: what was folded while allowed is written once (best effort), then memory goes.
      await this.serial(() => this.flushNow());
    }
    await this.chain;
    this.acc.clear();
    this.memo.clear();
    this.awaiting.clear();
    this.state = null;
    this.store = null;
    this.ctx = null;
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private clearCache(): void {
    if (this.cacheTimer !== null) clearTimeout(this.cacheTimer);
    this.cacheTimer = null;
    this.cache = null;
  }

  private markOk(): void {
    if (this.storage !== 'unavailable') this.storage = 'ok';
  }

  private markFailed(): void {
    this.stats.flushFailures++;
    this.storage = this.store === null ? 'unavailable' : 'degraded';
  }

  // ---------------------------------------------------------------------------
  // Sources
  // ---------------------------------------------------------------------------

  private excluded = (site: string): boolean => this.ctx?.isExcluded(site) ?? true;

  onReportPersisted(report: Readonly<DocumentReport>, binding: Readonly<FrameBinding> | null, info: PersistedReportInfo): void {
    if (this.ctx === null) return;
    this.stats.folds++;
    const result = foldReport(report, binding, info, this.today(), this.memo, this.excluded);
    if (result.skipped === 'unresolved-site') this.unresolved++;
    for (const d of result.sightings) this.addSighting(d);
    for (const d of result.sites) this.addSite(d);
  }

  onEvent(event: ProtectEvent): void {
    if (this.ctx === null) return;
    const now = this.ctx.clock.now();
    if (event.kind === 'outcome') {
      // ADR-020 §11: a parked value-match counts only once Chrome sent its request; stopped (our rule or another
      // extension) and unknown never count as «received».
      const parked = this.awaiting.take(event.requestId, now);
      if (parked.length === 0) return;
      if (event.state !== 'sent') {
        this.stats.unsent = Math.min(Number.MAX_SAFE_INTEGER, this.stats.unsent + parked.length);
        return;
      }
      for (const e of parked) this.onEvent(asSent(e));
      return;
    }
    // The tab's top-level site as the module knows it (browser-trusted) wins over the event's site when excluded.
    const tabSite = this.ctx.tabModel.get(event.tabId)?.site ?? null;
    if (tabSite !== null && this.ctx.isExcluded(tabSite)) return;
    const awaited = awaitedRequestId(event);
    if (awaited !== null && event.kind === 'evidence') {
      this.awaiting.park(awaited, event, now);
      return;
    }
    const result = foldEvent(event, this.today(), this.excluded);
    if ('delta' in result) {
      this.stats.events++;
      this.addSighting(result.delta);
    } else if (result.skipped === 'unresolved-site') this.unresolved++;
  }

  /** A closed tab: the outcome tracker forgets its requests without an event, so their parked records go now. */
  onTabRemoved(tabId: number): void {
    this.awaiting.forgetTab(tabId);
  }

  private addSighting(d: HistorySightingDelta): void {
    if (this.acc.addSighting(d)) return this.schedule();
    if (this.startFlushWhenFull() && this.acc.addSighting(d)) return this.schedule();
    this.pendingDropped++;
  }

  private addSite(d: HistorySiteDelta): void {
    if (this.acc.addSite(d)) return this.schedule();
    if (this.startFlushWhenFull() && this.acc.addSite(d)) return this.schedule();
    this.pendingDropped++;
  }

  /**
   * Full accumulator: its deltas are taken out now and written by a queued flush, unless an earlier full batch is still
   * waiting or writing (then the delta is dropped and counted). Memory stays ≤ 2 × maxPendingDeltas.
   */
  private startFlushWhenFull(): boolean {
    if (this.queuedBatches > 0) return false;
    const drained = this.acc.drain();
    this.queuedBatches++;
    void this.serial(() => this.writeBatch(drained)).finally(() => {
      this.queuedBatches--;
    });
    return true;
  }

  private schedule(): void {
    if (this.timer !== null || this.ctx === null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.serial(() => this.flushNow());
    }, this.flushMs);
  }

  // ---------------------------------------------------------------------------
  // Flush and retention (inside the serial chain)
  // ---------------------------------------------------------------------------

  /** Detects a database removed by the browser while the history was on (the state record vanished). */
  private async checkReset(store: HistoryStore, today: number): Promise<void> {
    if (this.state === null || this.state.revision === 0) return;
    const stored = await store.readState();
    if (stored !== null && stored !== 'malformed') return;
    this.stats.resets++;
    const fresh = newHistoryState(today);
    fresh.resetDay = today;
    fresh.dropped = { ...this.state.dropped };
    this.state = fresh;
  }

  private flushNow(): Promise<void> {
    this.clearTimer();
    return this.writeBatch(this.acc.drain());
  }

  private async writeBatch(drained: HistoryDrained): Promise<void> {
    const store = this.store;
    const today = this.today();
    // No state yet (start failed, or the history was just purged): a new state first, then the batch.
    if (store !== null && this.state === null) await this.init();
    if (store === null || this.state === null) {
      if (drained.sightings.length + drained.sites.length > 0) this.pendingDropped += drained.sightings.length + drained.sites.length;
      return;
    }
    if (drained.sightings.length === 0 && drained.sites.length === 0 && this.pendingDropped === 0 && this.unresolved === 0) {
      await this.purgeIfDue(today).catch(() => this.markFailed());
      return;
    }
    try {
      await this.checkReset(store, today);
      const state = this.state;
      this.takeCounters(state);
      await store.flush(drained, state);
      await this.purgeIfDue(today);
      state.revision++;
      await store.writeState(state);
      this.stats.flushes++;
      this.clearCache();
      this.markOk();
    } catch {
      // The drained deltas are lost: an explicit gap (dropped.pending), never a silent loss.
      if (this.state !== null) addHistoryDropped(this.state.dropped, 'pending', drained.sightings.length + drained.sites.length);
      this.markFailed();
    }
  }

  private takeCounters(state: HistoryStateRecord): void {
    if (this.pendingDropped > 0) addHistoryDropped(state.dropped, 'pending', this.pendingDropped);
    if (this.unresolved > 0) addHistoryDropped(state.dropped, 'unresolvedSite', this.unresolved);
    this.pendingDropped = 0;
    this.unresolved = 0;
  }

  private async purgeIfDue(today: number): Promise<void> {
    const store = this.store;
    const state = this.state;
    if (store === null || state === null || state.lastPurgeDay === today) return;
    await store.purge(state, today, this.retention());
    state.revision++;
    await store.writeState(state);
    this.stats.purges++;
    this.clearCache();
  }

  /** Flush + retention before a read (queries see what was folded so far). */
  private async prepareRead(): Promise<{ store: HistoryStore; state: HistoryStateRecord } | null> {
    await this.flushNow();
    if (this.store === null) return null;
    if (this.state === null) await this.init();
    if (this.state === null) return null;
    try {
      await this.purgeIfDue(this.today());
    } catch {
      this.markFailed();
    }
    return { store: this.store, state: this.state };
  }

  private async load(store: HistoryStore, state: HistoryStateRecord): Promise<HistoryLoaded> {
    const now = this.ctx?.clock.now() ?? 0;
    if (this.cache !== null && this.cache.revision === state.revision && now - this.cache.at <= CACHE_TTL_MS) return this.cache.data;
    const data = await store.loadAll(state);
    // A successful read from the database means the storage works again (a failed write degraded it).
    this.markOk();
    this.cache = { revision: state.revision, at: now, data };
    if (this.cacheTimer !== null) clearTimeout(this.cacheTimer);
    this.cacheTimer = setTimeout(() => {
      this.cacheTimer = null;
      this.cache = null;
    }, CACHE_TTL_MS);
    return data;
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------

  private storageState(state: HistoryStateRecord | null, today: number): HistoryStorageState {
    if (this.store === null || this.storage === 'unavailable') return 'unavailable';
    if (this.storage === 'degraded') return 'degraded';
    if (state !== null && state.resetDay !== null && today - state.resetDay < this.retention()) return 'reset';
    return 'ok';
  }

  private limitations(state: HistoryStateRecord | null, storage: HistoryStorageState, frameOnly: boolean): ProtectLimitation[] {
    const set = new Set<ProtectLimitation>();
    if (frameOnly) set.add('attribution-frame-only');
    if (state?.truncated === true) set.add('history-truncated');
    if (storage === 'unavailable' || storage === 'degraded') set.add('storage-unavailable');
    if (storage === 'reset') set.add('storage-reset');
    return PROTECT_LIMITATIONS.filter((l) => set.has(l)).slice(0, PROTECT_WIRE_LIMITS.maxProjectionLimitations);
  }

  private since(state: HistoryStateRecord | null, today: number): string | null {
    if (state === null) return null;
    return historyDayString(Math.max(state.enabledDay, today - this.retention() + 1));
  }

  private emptyProjection(windowDays: HistoryWindowDays): HistoryProjection {
    const today = this.today();
    const storage = this.storageState(this.state, today);
    return {
      historyRevision: this.state?.revision ?? 0,
      retentionDays: this.retention(),
      storage,
      today: historyDayString(today),
      since: this.since(this.state, today),
      windowDays,
      rows: [],
      totalRows: 0,
      singleSiteReceivers: 0,
      sitesInWindow: 0,
      limitedSitesInWindow: 0,
      limitations: this.limitations(this.state, storage, false),
      dropped: { ...(this.state?.dropped ?? newHistoryState(today).dropped) },
    };
  }

  private async project(request: { windowDays: HistoryWindowDays; offset: number; limit: number; minSites?: 1 | 2; mechanismsOnly?: boolean; site?: string; domainFilter?: string }): Promise<HistoryProjection> {
    this.stats.queries++;
    const ready = await this.prepareRead();
    if (ready === null) return this.emptyProjection(request.windowDays);
    let data: HistoryLoaded;
    try {
      data = await this.load(ready.store, ready.state);
    } catch {
      this.markFailed();
      return this.emptyProjection(request.windowDays);
    }
    const today = this.today();
    const ranked = rankHistory(data.sightings, data.sites, {
      today,
      retentionDays: this.retention(),
      windowDays: request.windowDays,
      offset: request.offset,
      limit: request.limit,
      ...(request.minSites === undefined ? {} : { minSites: request.minSites }),
      ...(request.mechanismsOnly === undefined ? {} : { mechanismsOnly: request.mechanismsOnly }),
      ...(request.site === undefined ? {} : { site: request.site }),
      ...(request.domainFilter === undefined ? {} : { domainFilter: request.domainFilter }),
      vendorOf: this.vendorOf,
    });
    const storage = this.storageState(ready.state, today);
    const projection: HistoryProjection = {
      historyRevision: ready.state.revision,
      retentionDays: this.retention(),
      storage,
      today: historyDayString(today),
      since: this.since(ready.state, today),
      windowDays: request.windowDays,
      rows: ranked.rows,
      totalRows: ranked.totalRows,
      singleSiteReceivers: ranked.singleSiteReceivers,
      sitesInWindow: ranked.sitesInWindow,
      limitedSitesInWindow: ranked.limitedSitesInWindow,
      limitations: this.limitations(ready.state, storage, ranked.frameOnly || (ranked.site?.unattributedFamilies.length ?? 0) > 0),
      dropped: { ...ready.state.dropped },
    };
    if (ranked.site !== undefined) projection.site = ranked.site;
    return projection;
  }

  private defaultProjection(): Promise<HistoryProjection> {
    return this.project({ windowDays: windowOf(this.retention()), offset: 0, limit: PROTECT_BUDGETS.maxRowsPerPage });
  }

  handleUi(type: ProtectUiRequest['type'], request: ProtectUiRequest): Promise<UiResponse | undefined> | UiResponse | undefined {
    switch (request.type) {
      case 'ui-protect-history-query': {
        const { windowDays, offset, limit, minSites, mechanismsOnly, site, domainFilter } = request;
        return this.serial<UiResponse>(async () => ({
          schemaVersion: 1,
          type: 'protect-history',
          history: await this.project({
            windowDays,
            offset,
            limit,
            ...(minSites === undefined ? {} : { minSites }),
            ...(mechanismsOnly === undefined ? {} : { mechanismsOnly }),
            ...(site === undefined ? {} : { site }),
            ...(domainFilter === undefined ? {} : { domainFilter }),
          }),
        }));
      }
      case 'ui-protect-history-receiver':
        return this.serial<UiResponse>(async () => {
          const ready = await this.prepareRead();
          if (ready === null) return { schemaVersion: 1, type: 'protect-history-receiver', card: null };
          try {
            const data = await this.load(ready.store, ready.state);
            const card = historyReceiverCard(data.sightings, request.rowKey, { today: this.today(), retentionDays: this.retention(), windowDays: request.windowDays, vendorOf: this.vendorOf });
            return { schemaVersion: 1, type: 'protect-history-receiver', card };
          } catch {
            this.markFailed();
            return errorResponse('storage-unavailable');
          }
        });
      case 'ui-protect-history-delete':
        return this.serial<UiResponse>(async () => {
          const ready = await this.prepareRead();
          if (ready === null) return errorResponse('storage-unavailable');
          try {
            if (request.target === 'row') {
              const receivers = await this.receiversOfRow(ready.store, ready.state, request.key);
              await ready.store.deleteReceivers(receivers, ready.state);
            } else {
              if (!isSiteName(request.key)) return errorResponse('invalid-request');
              await ready.store.deleteSite(request.key, ready.state);
            }
            ready.state.revision++;
            await ready.store.writeState(ready.state);
            this.clearCache();
            this.markOk();
          } catch {
            this.markFailed();
            return errorResponse('storage-unavailable');
          }
          return { schemaVersion: 1, type: 'protect-history', history: await this.defaultProjection() };
        });
      case 'ui-protect-history-export':
        return this.serial<UiResponse>(async () => {
          const ready = await this.prepareRead();
          const today = this.today();
          let data: HistoryLoaded = { sightings: [], sites: [] };
          if (ready !== null) {
            try {
              data = await this.load(ready.store, ready.state);
            } catch {
              this.markFailed();
            }
          }
          const exportData = historyExportData(data.sightings, data.sites, { today, retentionDays: this.retention(), vendorOf: this.vendorOf });
          const state = ready?.state ?? null;
          const storage = this.storageState(state, today);
          const preview = createHistoryExport(exportData, {
            includeSites: request.includeSites,
            exportedOn: historyDayString(today),
            retentionDays: this.retention(),
            since: this.since(state, today),
            limitations: this.limitations(state, storage, exportData.frameOnly),
            dropped: state?.dropped ?? newHistoryState(today).dropped,
            ...(this.maxExportBytes === undefined ? {} : { maxBytes: this.maxExportBytes }),
          });
          return { schemaVersion: 1, type: 'protect-history-export', preview };
        });
      case 'ui-protect-purge':
        // The controller clears the stores right after this answer; the memory goes now. The next write starts a
        // new state (no false «storage-reset»).
        if (request.what !== 'history' && request.what !== 'all') return undefined;
        this.clearTimer();
        this.clearCache();
        this.acc.clear();
        this.memo.clear();
        this.awaiting.clear();
        this.pendingDropped = 0;
        this.unresolved = 0;
        return this.serial<UiResponse | undefined>(async () => {
          this.state = null;
          return undefined;
        });
      default:
        void type;
        return undefined;
    }
  }

  /** Receivers of a row key (`d:<domain>` directly; `v:<vendor>` through the stored sightings). */
  private async receiversOfRow(store: HistoryStore, state: HistoryStateRecord, rowKey: string): Promise<string[]> {
    if (rowKey.startsWith('d:')) {
      const domain = rowKey.slice(2);
      return isDomainName(domain) ? [domain] : [];
    }
    const data = await this.load(store, state);
    return [...new Set(data.sightings.filter((s) => historyRowKey(s, this.vendorOf) === rowKey).map((s) => s.receiver))];
  }

  // ---------------------------------------------------------------------------
  // Diagnostics and the test harness (numbers only)
  // ---------------------------------------------------------------------------

  debug(): Record<string, number | boolean> {
    return {
      pending: this.acc.size,
      pendingDropped: this.pendingDropped,
      memoDocuments: this.memo.size,
      awaitingSends: this.awaiting.size,
      awaitingDropped: this.awaiting.droppedCount,
      revision: this.state?.revision ?? 0,
      sightings: this.state?.counts.sightings ?? 0,
      receivers: this.state?.counts.receivers ?? 0,
      sites: this.state?.counts.sites ?? 0,
      truncated: this.state?.truncated === true,
      storageOk: this.storage === 'ok',
      dayOffset: this.dayOffset,
      ...this.stats,
    };
  }

  /**
   * Test profile only (the controller refuses otherwise). Payloads:
   * - `{dayOffset: n}`: moves the history clock by n days (|n| ≤ 400) and runs the retention now;
   * - `{flush: true}`: writes the accumulated deltas now;
   * - `{evidence: {receiver, site, fieldKind, encodings}}`: a synthetic value-match event (lanes S07 / S11 publish the
   *   real ones); `{replay: {receiver, site}}`, `{blocked: {receiver, site}}` likewise;
   * - `{seed: {receivers, sitesPerReceiver}}`: synthetic sightings for the perf gate (domains `*.example`);
   * - `{bench: 'flush' | 'query' | 'clear', n?}`: one timed operation inside the SW (perf gate; numbers only).
   */
  async debugInject(payload: unknown): Promise<unknown> {
    if (typeof payload !== 'object' || payload === null) throw new Error('history-inject: object expected');
    const p = payload as Record<string, unknown>;
    if (typeof p['dayOffset'] === 'number') {
      const n = p['dayOffset'];
      if (!Number.isSafeInteger(n) || Math.abs(n) > MAX_DAY_OFFSET) throw new Error('history-inject: dayOffset');
      this.dayOffset = n;
      await this.serial(async () => {
        await this.flushNow();
        try {
          await this.purgeIfDue(this.today());
        } catch {
          this.markFailed();
        }
      });
      return this.debug();
    }
    if (p['flush'] === true) {
      await this.serial(() => this.flushNow());
      return this.debug();
    }
    for (const kind of ['evidence', 'replay', 'blocked'] as const) {
      if (p[kind] === undefined) continue;
      const e = p[kind] as Record<string, unknown>;
      const receiver = e['receiver'];
      const site = e['site'];
      if (!isDomainName(receiver) || !isSiteName(site)) throw new Error('history-inject: receiver / site');
      this.onEvent(syntheticEvent(kind, receiver, site, e));
      return this.debug();
    }
    if (typeof p['seed'] === 'object' && p['seed'] !== null) return this.seed(p['seed'] as Record<string, unknown>);
    if (typeof p['bench'] === 'string') return this.bench(p['bench'], typeof p['n'] === 'number' ? p['n'] : 512);
    throw new Error('history-inject: unknown payload');
  }

  private async seed(spec: Record<string, unknown>): Promise<unknown> {
    const receivers = typeof spec['receivers'] === 'number' ? Math.min(4096, Math.max(0, Math.floor(spec['receivers']))) : 0;
    const perReceiver = typeof spec['sitesPerReceiver'] === 'number' ? Math.min(64, Math.max(1, Math.floor(spec['sitesPerReceiver']))) : 1;
    const today = this.today();
    await this.serial(async () => {
      for (let r = 0; r < receivers; r++) {
        for (let s = 0; s < perReceiver; s++) {
          const d: HistorySightingDelta = { receiver: 'perf-r' + String(r) + '.example', site: 'perf-s' + String((r + s * 7) % 2000) + '.example', day: today - ((r + s) % 30), signals: (r + s) % HISTORY_SIGNAL_ALL || 1 };
          if (!this.acc.addSighting(d)) {
            await this.flushNow();
            this.acc.addSighting(d);
          }
        }
      }
      await this.flushNow();
    });
    return this.debug();
  }

  private async bench(kind: string, n: number): Promise<{ ms: number }> {
    const count = Math.min(PROTECT_BUDGETS.maxPendingDeltas, Math.max(1, Math.floor(n)));
    return this.serial(async () => {
      const today = this.today();
      if (kind === 'flush') {
        await this.flushNow();
        // Same name space as `seed` (perf-r*, perf-s*): the bench never pushes the stores over their limits.
        for (let i = 0; i < count; i++) this.acc.addSighting({ receiver: 'perf-r' + String(i % 97) + '.example', site: 'perf-s' + String(i % 2000) + '.example', day: today, signals: 1 });
        const t0 = performance.now();
        await this.flushNow();
        return { ms: performance.now() - t0 };
      }
      if (kind === 'query') {
        this.clearCache();
        const t0 = performance.now();
        await this.project({ windowDays: 90, offset: 0, limit: PROTECT_BUDGETS.maxRowsPerPage, minSites: 1 });
        return { ms: performance.now() - t0 };
      }
      if (kind === 'clear') {
        const t0 = performance.now();
        await this.store?.clearAll();
        this.state = null;
        this.clearCache();
        return { ms: performance.now() - t0 };
      }
      throw new Error('history-inject: bench');
    });
  }
}

function syntheticEvent(kind: 'evidence' | 'replay' | 'blocked', receiver: string, site: string, e: Record<string, unknown>): ProtectEvent {
  if (kind === 'blocked') return { kind: 'blocked', tabId: 0, site, receiver, ruleKey: 'test' };
  const base = {
    evidenceId: 'pe-test',
    frameContext: 'top' as const,
    attributionConfidence: 'unknown' as const,
    count: 1,
    countQuality: 'exact' as const,
    firstSecond: 0,
    lastSecond: 0,
    evidenceSource: 'derived' as const,
    integrity: 'derived' as const,
    ruleVersion: '1',
    limitationCodes: [],
    relation: 'cross-site' as const,
  };
  if (kind === 'replay') {
    return { kind: 'evidence', documentKey: '0:0:test', tabId: 0, site, evidence: { ...base, protectKind: 'replay-pattern', ruleId: 'session-replay-behavior', receiver, interpretationConfidence: 'low' } };
  }
  const fieldKind: FieldKind = e['fieldKind'] === 'phone' || e['fieldKind'] === 'name' ? e['fieldKind'] : 'email';
  const encodings: ValueEncoding[] = Array.isArray(e['encodings']) ? (e['encodings'] as unknown[]).filter((x): x is ValueEncoding => typeof x === 'string').slice(0, 4) as ValueEncoding[] : ['plain'];
  return {
    kind: 'evidence',
    documentKey: '0:0:test',
    tabId: 0,
    site,
    evidence: {
      ...base,
      protectKind: 'value-match',
      ruleId: 'form-leak',
      transferClass: 'third-party-moment-unknown',
      fieldKind,
      encodings,
      receiver,
      method: 'POST',
      requestKind: 'xhr',
      endpointHost: receiver,
      endpointPathTemplate: '/',
      submitTiming: 'unknown',
      deliveryState: 'sent',
      interpretationConfidence: 'medium',
    },
  };
}

export function createHistoryService(options: HistoryServiceOptions = {}): ProtectFeatureService {
  return new HistoryService(options);
}
