import { reportHost, redactHost } from '../../attribution/src/index';
// Document model and pure reducer (REQ-009, REQ-011, spec A6/A7/A10, ADR-005).
// `reduce(state, event, deps) -> { state', effects }` never touches chrome.*; side effects (storage, ACK)
// are executed by runtime.ts. One DocumentReport per documentId; the documentKey is tabId:frameId:documentId
// and is derived from MessageSender / webNavigation only (REQ-004).

import { BUDGETS, EMPTY_DROPPED, MAX_COUNT, counterKey, makeDocumentKey } from '@detect-expert/contracts';
import type {
  CountQuality,
  CounterEntry,
  CoverageFlag,
  CoverageState,
  DocumentLifecycle,
  DocumentReport,
  DroppedCounters,
  Finding,
  HostEntry,
  PageBatch,
} from '@detect-expert/contracts';
import { computeCoverageState, coverageRef } from '@detect-expert/engine';
import type { BrowserDocumentLifecycle, FrameType, PageSenderContext } from './sender';

// ---------------------------------------------------------------------------
// Entities (ADR-005 §1)
// ---------------------------------------------------------------------------

export interface FrameBinding {
  tabId: number;
  frameId: number;
  documentId: string;
  documentKey: string;
  parentDocumentId: string | null;
  frameType: FrameType | null;
  documentLifecycle: BrowserDocumentLifecycle | null;
  host: string | null;
  boundAt: number;
  accessGranted?: boolean;
  scheme?: 'http' | 'https';
}

export interface NavigationAttempt {
  tabId: number;
  frameId: number;
  startedAt: number;
  host: string | null;
}

export interface TabProjection {
  tabId: number;
  /** documentKey of the active outermost document (frameType outermost_frame + documentLifecycle active). */
  activeTopDocumentKey: string | null;
}

/** Cumulative maxima reported by one MAIN sensor boot (ADR-004 §7: merge = max per sensorBootId). */
export interface BootCounters {
  sensorBootId: string;
  counts: Record<string, number>;
}

/** ADR-073: metadata-only routing fence, committed independently of the report payload. */
export interface ClearFence {
  documentKey: string;
  bridgeSessionId: string;
  sensorBootIds: string[];
  at: number;
  paused?: boolean;
  reportRevision: number;
}

export interface SessionWatermark {
  bridgeSessionId: string;
  lastCommittedBatchSeq: number;
}

/** Per-document bookkeeping stored next to the report (not part of the wire contract). */
export interface DocumentMeta {
  documentKey: string;
  /** Metadata-only reset record: hidden from UI/export until a new observation is accepted. */
  cleared?: boolean;
  clearEpoch?: string;
  clearBootIds?: string[];
  paused: boolean;
  revoked: boolean;
  scheme?: 'http' | 'https';
  accessGranted?: boolean;
  findingsCap?: number;
  /** A current FrameBinding points at this document. */
  bound: boolean;
  lastActivityAt: number;
  firstObservationAt: number | null;
  /** SPA pushState/replaceState/fragment updates; no URL is stored (REQ-005). */
  routeSegments: number;
  lateInjection: boolean;
  sensorSeen: boolean;
  degraded: boolean;
  /** Counts of sensor boots that were folded out of `boots` (bounded history). */
  folded: Record<string, number>;
  boots: BootCounters[];
  /** Recent bridge sessions with their watermarks; the newest is mirrored in report.watermark. */
  sessions: SessionWatermark[];
}

export interface QuarantineEntry {
  documentKey: string;
  sender: PageSenderContext;
  batch: PageBatch;
  receivedAt: number;
}

export interface UnattributedCounters {
  /** webRequest events with tabId -1 or without a resolvable document. */
  requests: number;
  orphanBatches: number;
  orphanObservations: number;
  lastOrphanReason: 'quarantine-expired' | 'quarantine-full' | 'tab-closed' | null;
}

export interface StateNotes {
  /** onCommitted without frameType/documentLifecycle: fell back to frameId === 0 (coverage note). */
  lifecycleFallbackCommits: number;
  /** Engine threw; findings kept from the previous run. */
  engineFailures: number;
}

export interface DocumentsState {
  reports: ReadonlyMap<string, DocumentReport>;
  metas: ReadonlyMap<string, DocumentMeta>;
  /** Keyed by bindingKey(tabId, frameId[, prerender]). */
  bindings: ReadonlyMap<string, FrameBinding>;
  tabs: ReadonlyMap<number, TabProjection>;
  /** Keyed by bindingKey(tabId, frameId). */
  attempts: ReadonlyMap<string, NavigationAttempt>;
  quarantine: readonly QuarantineEntry[];
  /** Ring of recently evicted/expired documentKeys: a re-commit of one of them is marked `truncated`. */
  evictedKeys: readonly string[];
  unattributed: UnattributedCounters;
  notes: StateNotes;
}

export const MAX_BOOTS_PER_DOCUMENT = 4;
export const MAX_SESSIONS_PER_DOCUMENT = 4;
export const MAX_EVICTED_KEYS = 256;
// REQ-011 admission budgets: internal bookkeeping, independent of detector thresholds.
export const MAX_BINDINGS_PER_TAB = 128;
export const MAX_DOCUMENTS_GLOBAL = 1024;


// ---------------------------------------------------------------------------
// Events and effects (ADR-005 §5)
// ---------------------------------------------------------------------------

export type DocumentEvent =
  | {
      type: 'navigation:before';
      tabId: number;
      frameId: number;
      host: string | null;
      at: number;
    }
  | {
      type: 'navigation:committed';
      tabId: number;
      frameId: number;
      documentId: string;
      parentDocumentId: string | null;
      scheme?: 'http' | 'https';
      accessGranted?: boolean;
      frameType: FrameType | null;
      documentLifecycle: BrowserDocumentLifecycle | null;
      host: string | null;
      at: number;
    }
  | { type: 'navigation:error'; tabId: number; frameId: number; documentId: string | null; at: number }
  | { type: 'navigation:route'; tabId: number; frameId: number; documentId: string; documentLifecycle: BrowserDocumentLifecycle | null; at: number }
  | { type: 'navigation:completed'; tabId: number; frameId: number; documentId: string; documentLifecycle: BrowserDocumentLifecycle | null; at: number }
  | { type: 'tab:removed'; tabId: number; at: number }
  | { type: 'tab:replaced'; addedTabId: number; removedTabId: number; at: number }
  | { type: 'batch'; sender: PageSenderContext; batch: PageBatch; at: number }
  | {
      type: 'network:host';
      tabId: number;
      frameId: number;
      documentId: string | null;
      parentFrameId: number | null;
      parentDocumentId: string | null;
      resourceType: string;
      host: string;
      category?: HostEntry['category'];
      relation?: HostEntry['relation'];
      at: number;
    }
  | { type: 'ttl-tick'; at: number }
  | { type: 'ui:pause'; documentKey: string; at: number }
  | { type: 'ui:resume'; documentKey: string; at: number }
  | { type: 'ui:clear'; documentKey: string; at: number; fence?: ClearFence }
  | { type: 'injection:late'; documentKeys: string[]; at: number }
  | { type: 'scope:access'; documentKey: string; host: string | null; accessGranted: boolean; at: number }
  | { type: 'frame:unavailable'; tabId: number; frameId: number; documentId: string; at: number }
  | { type: 'transport:dropped'; documentKey: string; count: number; at: number }
  | { type: 'scope:revoked'; documentKeys: readonly string[]; at: number }
  | { type: 'document:degraded'; documentKey: string; truncate: boolean; at: number }
  | { type: 'document:evict'; documentKeys: readonly string[]; at: number };

export type Effect =
  | { type: 'persist'; documentKey: string; immediate: boolean }
  | { type: 'remove'; documentKeys: string[] }
  | { type: 'persist-index' };

export type BatchStatus = 'committed' | 'duplicate' | 'quarantined' | 'paused' | 'revoked';

export interface BatchOutcome {
  status: BatchStatus;
  documentKey: string;
  lastCommittedBatchSeq: number;
  paused: boolean;
  protocolOk: boolean;
}

export interface ReduceResult {
  state: DocumentsState;
  effects: Effect[];
  batch?: BatchOutcome;
}

export interface ReducerDeps {
  deriveFindings(report: Readonly<DocumentReport>): readonly Finding[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function bindingKey(tabId: number, frameId: number, prerender = false): string {
  return String(tabId) + ':' + String(frameId) + (prerender ? ':p' : '');
}

function satAdd(a: number, b: number): number {
  const s = a + b;
  return s > MAX_COUNT ? MAX_COUNT : s;
}

const QUALITY_RANK: Record<CountQuality, number> = { exact: 0, sampled: 1, 'lower-bound': 2 };

function weakerQuality(a: CountQuality, b: CountQuality): CountQuality {
  return QUALITY_RANK[a] >= QUALITY_RANK[b] ? a : b;
}

function withFlag(flags: readonly CoverageFlag[], flag: CoverageFlag): CoverageFlag[] {
  return flags.includes(flag) ? [...flags] : [...flags, flag];
}

function mapLifecycle(lifecycle: BrowserDocumentLifecycle | null): DocumentLifecycle {
  switch (lifecycle) {
    case 'prerender':
      return 'prerender';
    case 'cached':
      return 'bfcache';
    case 'pending_deletion':
      return 'closed';
    default:
      return 'committed';
  }
}

/** Canonical engine precedence, with permission/control state supplied only by the SW (F009?F011). */
export function deriveCoverageState(
  flags: readonly CoverageFlag[],
  meta: Pick<DocumentMeta, 'paused' | 'revoked' | 'degraded' | 'sensorSeen' | 'accessGranted'>,
): CoverageState {
  const current = flags.filter((f) => f !== 'paused' && f !== 'revoked' && f !== 'no-host-permission');
  if (meta.degraded && !current.includes('truncated')) current.push('truncated');
  return computeCoverageState(current, {
    scopeMode: 'site', accessGranted: !meta.revoked && meta.accessGranted !== false,
    restricted: false, paused: meta.paused, inaccessibleFrames: meta.sensorSeen ? 0 : 1,
  });
}

export function createInitialState(): DocumentsState {
  return {
    reports: new Map(),
    metas: new Map(),
    bindings: new Map(),
    tabs: new Map(),
    attempts: new Map(),
    quarantine: [],
    evictedKeys: [],
    unattributed: { requests: 0, orphanBatches: 0, orphanObservations: 0, lastOrphanReason: null },
    notes: { lifecycleFallbackCommits: 0, engineFailures: 0 },
  };
}

function newReport(
  tabId: number,
  frameId: number,
  documentId: string,
  host: string | null,
  lifecycle: DocumentLifecycle,
  flags: CoverageFlag[],
  at: number,
): DocumentReport {
  const meta = { paused: false, revoked: false, degraded: false, sensorSeen: false };
  return {
    schemaVersion: 1,
    documentKey: makeDocumentKey(tabId, frameId, documentId),
    tabId,
    frameId,
    documentId,
    host: reportHost(host),
    lifecycle,
    createdAt: at,
    updatedAt: at,
    revision: 0,
    coverageState: deriveCoverageState(flags, meta),
    coverageFlags: flags,
    counters: [],
    findings: [],
    hosts: [],
    watermark: null,
    dropped: { ...EMPTY_DROPPED },
  };
}

function newMeta(documentKey: string, at: number): DocumentMeta {
  return {
    documentKey,
    paused: false,
    revoked: false,
    bound: true,
    lastActivityAt: at,
    firstObservationAt: null,
    routeSegments: 0,
    lateInjection: false,
    sensorSeen: false,
    degraded: false,
    folded: {},
    boots: [],
    sessions: [],
  };
}

function cloneReport(r: DocumentReport): DocumentReport {
  return { ...r, coverageFlags: [...r.coverageFlags], dropped: { ...r.dropped } };
}

function cloneMeta(m: DocumentMeta): DocumentMeta {
  return {
    ...m,
    folded: { ...m.folded },
    boots: m.boots.map((b) => ({ sensorBootId: b.sensorBootId, counts: { ...b.counts } })),
    sessions: m.sessions.map((s) => ({ ...s })),
  };
}

/** ADR-073: no old payload, cumulative key or ACK watermark survives an explicit producer-reset epoch. */
export function resetDocument(report: DocumentReport, meta: DocumentMeta, fence: ClearFence): { report: DocumentReport; meta: DocumentMeta } {
  const cleared = newReport(report.tabId, report.frameId, report.documentId, null, report.lifecycle, [], fence.at);
  cleared.revision = Math.max(satAdd(report.revision, 1), fence.reportRevision);
  const next = newMeta(report.documentKey, fence.at);
  next.bound = meta.bound;
  next.paused = fence.paused ?? meta.paused;
  next.revoked = meta.revoked;
  next.accessGranted = meta.accessGranted !== false;
  if (meta.scheme !== undefined) next.scheme = meta.scheme;
  next.cleared = true;
  next.clearEpoch = fence.bridgeSessionId;
  next.clearBootIds = [...fence.sensorBootIds];
  next.sensorSeen = fence.sensorBootIds.length > 0;
  return { report: cleared, meta: next };
}

/** Rebuild only empty routing metadata after a successful payload deletion and worker restart. */
export function clearedFromBinding(binding: FrameBinding, fence: ClearFence): { report: DocumentReport; meta: DocumentMeta } {
  const report = newReport(binding.tabId, binding.frameId, binding.documentId, null, mapLifecycle(binding.documentLifecycle), [], fence.at);
  const meta = newMeta(binding.documentKey, fence.at);
  meta.bound = true;
  meta.accessGranted = binding.accessGranted !== false;
  if (binding.scheme !== undefined) meta.scheme = binding.scheme;
  return resetDocument(report, meta, fence);
}

function touch(report: DocumentReport, at: number): void {
  report.revision = satAdd(report.revision, 1);
  report.updatedAt = at;
}

/** Copy-on-write view over the state: untouched maps are shared with the previous state. */
class Draft {
  private r: Map<string, DocumentReport> | null = null;
  private m: Map<string, DocumentMeta> | null = null;
  private b: Map<string, FrameBinding> | null = null;
  private t: Map<number, TabProjection> | null = null;
  private a: Map<string, NavigationAttempt> | null = null;
  private q: QuarantineEntry[] | null = null;
  private e: string[] | null = null;
  private u: UnattributedCounters | null = null;
  private n: StateNotes | null = null;
  readonly effects: Effect[] = [];
  private readonly persistKeys = new Set<string>();

  constructor(private readonly base: DocumentsState) {}

  get reports(): Map<string, DocumentReport> {
    return (this.r ??= new Map(this.base.reports));
  }
  get metas(): Map<string, DocumentMeta> {
    return (this.m ??= new Map(this.base.metas));
  }
  get bindings(): Map<string, FrameBinding> {
    return (this.b ??= new Map(this.base.bindings));
  }
  get tabs(): Map<number, TabProjection> {
    return (this.t ??= new Map(this.base.tabs));
  }
  get attempts(): Map<string, NavigationAttempt> {
    return (this.a ??= new Map(this.base.attempts));
  }
  get quarantine(): QuarantineEntry[] {
    return (this.q ??= [...this.base.quarantine]);
  }
  get evictedKeys(): string[] {
    return (this.e ??= [...this.base.evictedKeys]);
  }
  get unattributed(): UnattributedCounters {
    return (this.u ??= { ...this.base.unattributed });
  }
  get notes(): StateNotes {
    return (this.n ??= { ...this.base.notes });
  }
  readReport(key: string): DocumentReport | undefined {
    return (this.r ?? this.base.reports).get(key);
  }
  readMeta(key: string): DocumentMeta | undefined {
    return (this.m ?? this.base.metas).get(key);
  }
  readBinding(key: string): FrameBinding | undefined {
    return (this.b ?? this.base.bindings).get(key);
  }

  persist(documentKey: string, immediate: boolean): void {
    if (this.persistKeys.has(documentKey)) {
      if (immediate) {
        const existing = this.effects.find((e) => e.type === 'persist' && e.documentKey === documentKey);
        if (existing !== undefined && existing.type === 'persist') existing.immediate = true;
      }
      return;
    }
    this.persistKeys.add(documentKey);
    this.effects.push({ type: 'persist', documentKey, immediate });
  }
  remove(documentKeys: string[]): void {
    if (documentKeys.length > 0) this.effects.push({ type: 'remove', documentKeys });
  }
  persistIndex(): void {
    if (!this.effects.some((e) => e.type === 'persist-index')) this.effects.push({ type: 'persist-index' });
  }

  /** Delete a document and remember its key so a later re-commit is marked `truncated`. */
  evictDocument(key: string, keepBinding = true): void {
    if (!keepBinding) {
      for (const [bk, b] of this.finish().bindings) if (b.documentKey === key) this.bindings.delete(bk);
      this.persistIndex();
    }
    this.reports.delete(key);
    this.metas.delete(key);
    const ring = this.evictedKeys;
    if (!ring.includes(key)) {
      ring.push(key);
      if (ring.length > MAX_EVICTED_KEYS) ring.shift();
    }
  }

  finish(): DocumentsState {
    return {
      reports: this.r ?? this.base.reports,
      metas: this.m ?? this.base.metas,
      bindings: this.b ?? this.base.bindings,
      tabs: this.t ?? this.base.tabs,
      attempts: this.a ?? this.base.attempts,
      quarantine: this.q ?? this.base.quarantine,
      evictedKeys: this.e ?? this.base.evictedKeys,
      unattributed: this.u ?? this.base.unattributed,
      notes: this.n ?? this.base.notes,
    };
  }
}

// ---------------------------------------------------------------------------
// Batch merge (A6: dedup by (documentKey, bridgeSessionId, batchSeq); counters merge = max per boot)
// ---------------------------------------------------------------------------

function totalForKey(meta: DocumentMeta, key: string): number {
  let total = meta.folded[key] ?? 0;
  for (const boot of meta.boots) {
    const c = boot.counts[key];
    if (c !== undefined) total = satAdd(total, c);
  }
  return total;
}

function runEngine(d: Draft, report: DocumentReport, meta: DocumentMeta, deps: ReducerDeps): void {
  report.coverageState = deriveCoverageState(report.coverageFlags, meta);
  let findings: readonly Finding[];
  try {
    findings = deps.deriveFindings(report);
  } catch {
    d.notes.engineFailures = satAdd(d.notes.engineFailures, 1);
    meta.degraded = true;
    report.coverageState = deriveCoverageState(report.coverageFlags, meta);
    report.findings = [];
    return;
  }
  const cap = meta.findingsCap ?? BUDGETS.maxFindingsPerDocument;
  report.dropped.findings = Math.max(0, findings.length - cap);
  if (report.dropped.findings > 0) report.coverageFlags = withFlag(report.coverageFlags, 'budget-exceeded');
  report.coverageState = deriveCoverageState(report.coverageFlags, meta);
  const ref = coverageRef(report.coverageState, report.coverageFlags);
  report.findings = findings.slice(0, cap).map((f) => ({ ...f, coverageRef: ref }));
}

function finalize(d: Draft, report: DocumentReport, meta: DocumentMeta, at: number): void {
  meta.lastActivityAt = at;
  report.coverageState = deriveCoverageState(report.coverageFlags, meta);
  const ref = coverageRef(report.coverageState, report.coverageFlags);
  report.findings = report.findings.map((f) => ({ ...f, coverageRef: ref }));
  touch(report, at);
  d.reports.set(report.documentKey, report);
  d.metas.set(report.documentKey, meta);
}

/** Creates the report lazily for a document whose binding is known (cleared / evicted / subframe). */
function materialize(d: Draft, tabId: number, frameId: number, documentId: string, at: number): { report: DocumentReport; meta: DocumentMeta } | null {
  const key = makeDocumentKey(tabId, frameId, documentId);
  let binding = d.readBinding(bindingKey(tabId, frameId));
  let prerender = false;
  if (binding === undefined || binding.documentId !== documentId) {
    binding = d.readBinding(bindingKey(tabId, frameId, true));
    prerender = true;
  }
  if (binding === undefined || binding.documentId !== documentId) return null;
  if (!admission(d, tabId, frameId === 0 && !prerender, at, false)) return null;
  const flags: CoverageFlag[] = d.evictedKeys.includes(key) ? ['truncated'] : [];
  const lifecycle: DocumentLifecycle = prerender ? 'prerender' : mapLifecycle(binding.documentLifecycle);
  const report = newReport(tabId, frameId, documentId, binding.host, lifecycle, flags, at);
  const meta = newMeta(key, at);
  if (binding.scheme !== undefined) meta.scheme = binding.scheme;
  meta.accessGranted = binding.accessGranted !== false;
  report.coverageState = deriveCoverageState(flags, meta);
  return { report, meta };
}

function projectIfTop(d: Draft, binding: FrameBinding): void {
  const isTop = binding.frameType !== null ? binding.frameType === 'outermost_frame' : binding.frameId === 0;
  if (!isTop) return;
  d.tabs.set(binding.tabId, { tabId: binding.tabId, activeTopDocumentKey: binding.documentKey });
}

/** Prerender document became active (seen through sender/navigation lifecycle): promote and project. */
function promoteIfActivated(d: Draft, report: DocumentReport, lifecycle: BrowserDocumentLifecycle | null): DocumentReport {
  if (report.lifecycle !== 'prerender' || lifecycle !== 'active') return report;
  const promoted = cloneReport(report);
  promoted.lifecycle = 'committed';
  const pKey = bindingKey(report.tabId, report.frameId, true);
  const pBinding = d.readBinding(pKey);
  if (pBinding !== undefined && pBinding.documentId === report.documentId) {
    d.bindings.delete(pKey);
    const mainKey = bindingKey(report.tabId, report.frameId);
    const previous = d.readBinding(mainKey);
    if (previous !== undefined && previous.documentKey !== report.documentKey) unbindDocument(d, previous.documentKey, 'closed', promoted.updatedAt);
    const binding: FrameBinding = { ...pBinding, documentLifecycle: 'active', boundAt: promoted.updatedAt };
    d.bindings.set(mainKey, binding);
    projectIfTop(d, binding);
    d.persistIndex();
  }
  return promoted;
}

function applyBatch(d: Draft, ctx: PageSenderContext, batch: PageBatch, at: number, deps: ReducerDeps): BatchOutcome {
  const key = ctx.documentKey;
  if (ctx.documentLifecycle === 'active') migratePrerender(d, ctx.tabId, ctx.frameId, ctx.documentId, at);
  let report = d.readReport(key);
  let meta = d.readMeta(key);
  if (report === undefined || meta === undefined) {
    const created = materialize(d, ctx.tabId, ctx.frameId, ctx.documentId, at);
    if (created === null) return { status: 'quarantined', documentKey: key, lastCommittedBatchSeq: 0, paused: false, protocolOk: true };
    report = created.report;
    meta = created.meta;
  } else {
    report = cloneReport(report);
    meta = cloneMeta(meta);
  }
  if (meta.revoked || meta.accessGranted === false) {
    return { status: 'revoked', documentKey: key, lastCommittedBatchSeq: 0, paused: true, protocolOk: false };
  }
  if (meta.clearEpoch !== undefined && (batch.bridgeSessionId !== meta.clearEpoch || !meta.clearBootIds?.includes(batch.sensorBootId))) {
    return { status: 'duplicate', documentKey: key, lastCommittedBatchSeq: 0, paused: meta.paused, protocolOk: true };
  }
  let session = meta.sessions.find((s) => s.bridgeSessionId === batch.bridgeSessionId);
  if (meta.paused) {
    return {
      status: 'paused',
      documentKey: key,
      lastCommittedBatchSeq: session?.lastCommittedBatchSeq ?? 0,
      paused: true,
      protocolOk: true,
    };
  }
  if (session === undefined) {
    if (meta.sessions.length >= MAX_SESSIONS_PER_DOCUMENT) meta.sessions.shift();
    session = { bridgeSessionId: batch.bridgeSessionId, lastCommittedBatchSeq: report.coverageFlags.includes('truncated') ? batch.batchSeq - 1 : 0 };
    meta.sessions.push(session);
  } else if (batch.batchSeq <= session.lastCommittedBatchSeq) {
    return {
      status: 'duplicate',
      documentKey: key,
      lastCommittedBatchSeq: session.lastCommittedBatchSeq,
      paused: false,
      protocolOk: true,
    };
  }
  // The discarded interval cannot establish loss for the new interval; old sequences still deduplicate above.
  if (meta.cleared) session.lastCommittedBatchSeq = batch.batchSeq - 1;
  const gap = batch.batchSeq - session.lastCommittedBatchSeq - 1;
  if (gap > 0) {
    // Batches that never arrived (bridge ring overflow / lost buffer): explicit gap, not silent loss (REQ-009).
    report.dropped.batches = satAdd(report.dropped.batches, gap);
    report.coverageFlags = withFlag(report.coverageFlags, 'channel-gap');
  }
  session.lastCommittedBatchSeq = batch.batchSeq;
  report.watermark = { bridgeSessionId: batch.bridgeSessionId, lastCommittedBatchSeq: batch.batchSeq };
  if (meta.cleared) {
    delete meta.cleared;
    report.host = reportHost(ctx.host);
    report.createdAt = at;
  }

  // A coverage-only batch (observations: [], ADR-004 changelog) carries diagnostics only: no boot identity and
  // no counter is created for it, so a page cannot fill the boot slots with flag-only traffic.
  if (batch.observations.length > 0) {
    let boot = meta.boots.find((b) => b.sensorBootId === batch.sensorBootId);
    if (boot === undefined) {
      if (meta.boots.length >= MAX_BOOTS_PER_DOCUMENT) {
        // F169: never forget identities then add their cumulative totals again.
        report.coverageFlags = withFlag(report.coverageFlags, 'budget-exceeded');
        report.counters = report.counters.map((c) => ({ ...c, countQuality: 'lower-bound' }));
        report.dropped.observations = satAdd(report.dropped.observations, batch.observations.length);
        finalize(d, report, meta, at);
        d.persist(key, true);
        return { status: 'committed', documentKey: key, lastCommittedBatchSeq: batch.batchSeq, paused: false, protocolOk: true };
      }
      boot = { sensorBootId: batch.sensorBootId, counts: {} };
      meta.boots.push(boot);
    }

    const counters = new Map<string, CounterEntry>();
    for (const c of report.counters) counters.set(counterKey(c.techniqueId, c.phase, c.signalCodes), c);
    for (const obs of batch.observations) {
      const ck = counterKey(obs.techniqueId, obs.phase, obs.signalCodes);
      const existing = counters.get(ck);
      if (existing === undefined && counters.size >= BUDGETS.maxCountersPerDocumentGroup) {
        report.dropped.counters = satAdd(report.dropped.counters, 1);
        report.dropped.observations = satAdd(report.dropped.observations, 1);
        report.coverageFlags = withFlag(report.coverageFlags, 'budget-exceeded');
        continue;
      }
      const prev = boot.counts[ck];
      boot.counts[ck] = prev === undefined ? obs.count : Math.max(prev, obs.count);
      const total = totalForKey(meta, ck);
      if (existing === undefined && total > 0) {
        counters.set(ck, {
          techniqueId: obs.techniqueId,
          phase: obs.phase,
          signalCodes: [...obs.signalCodes].sort(),
          count: total,
          countQuality: obs.countQuality,
          firstBucket: obs.intervalBucket,
          lastBucket: obs.intervalBucket,
        });
      } else if (existing !== undefined) {
        counters.set(ck, {
          ...existing,
          count: total,
          countQuality: weakerQuality(existing.countQuality, obs.countQuality),
          firstBucket: Math.min(existing.firstBucket, obs.intervalBucket),
          lastBucket: Math.max(existing.lastBucket, obs.intervalBucket),
        });
      }
    }
    report.counters = [...counters.values()];
  }
  for (const flag of batch.coverageDelta) {
    // F010/F011: permission and SW retention flags can never be page assertions.
    // Bridge-owned diagnostics require MAIN filtering at the collector boundary as well.
    if (flag === 'revoked' || flag === 'paused' || flag === 'no-host-permission' ||
        flag === 'restricted-page' || flag === 'truncated' || flag === 'late-start' || flag === 'frames-inaccessible' || flag === 'network-limited') continue;
    report.coverageFlags = withFlag(report.coverageFlags, flag);
  }
  if (meta.lateInjection) report.coverageFlags = withFlag(report.coverageFlags, 'late-start');

  report = promoteIfActivated(d, report, ctx.documentLifecycle);
  if (batch.observations.length > 0) meta.sensorSeen = true;
  if (meta.firstObservationAt === null && batch.observations.length > 0) meta.firstObservationAt = at;
  runEngine(d, report, meta, deps);
  finalize(d, report, meta, at);
  d.persist(key, true);
  return { status: 'committed', documentKey: key, lastCommittedBatchSeq: batch.batchSeq, paused: false, protocolOk: true };
}

function enqueueQuarantine(d: Draft, entry: QuarantineEntry): void {
  const q = d.quarantine;
  const dup = q.some(
    (e) =>
      e.documentKey === entry.documentKey &&
      e.batch.bridgeSessionId === entry.batch.bridgeSessionId &&
      e.batch.batchSeq === entry.batch.batchSeq,
  );
  if (dup) return;
  if (q.length >= BUDGETS.maxOutOfOrderEntriesGlobal) {
    const dropped = q.shift();
    if (dropped !== undefined) orphan(d, dropped, 'quarantine-full');
  }
  q.push(entry);
}

function orphan(d: Draft, entry: QuarantineEntry, reason: UnattributedCounters['lastOrphanReason']): void {
  const u = d.unattributed;
  u.orphanBatches = satAdd(u.orphanBatches, 1);
  u.orphanObservations = satAdd(u.orphanObservations, entry.batch.observations.length);
  u.lastOrphanReason = reason;
}

function expireQuarantine(d: Draft, at: number): void {
  const base = d.finish().quarantine;
  if (base.length === 0) return;
  const expired = base.filter((e) => at - e.receivedAt >= BUDGETS.outOfOrderTtlMs);
  if (expired.length === 0) return;
  for (const e of expired) orphan(d, e, 'quarantine-expired');
  const keep = base.filter((e) => at - e.receivedAt < BUDGETS.outOfOrderTtlMs);
  d.quarantine.length = 0;
  d.quarantine.push(...keep);
}

function drainQuarantine(d: Draft, documentKey: string, at: number, deps: ReducerDeps): void {
  const base = d.finish().quarantine;
  const matching = base.filter((e) => e.documentKey === documentKey);
  if (matching.length === 0) return;
  const rest = base.filter((e) => e.documentKey !== documentKey);
  d.quarantine.length = 0;
  d.quarantine.push(...rest);
  matching.sort((a, b) =>
    a.batch.bridgeSessionId === b.batch.bridgeSessionId ? a.batch.batchSeq - b.batch.batchSeq : a.receivedAt - b.receivedAt,
  );
  for (const e of matching) applyBatch(d, e.sender, e.batch, at, deps);
}

// ---------------------------------------------------------------------------
// Navigation (A7 table)
// ---------------------------------------------------------------------------

function unbindDocument(d: Draft, documentKey: string, lifecycle: DocumentLifecycle, at: number): void {
  const report = d.readReport(documentKey);
  const meta = d.readMeta(documentKey);
  if (report === undefined || meta === undefined) return;
  const r = cloneReport(report);
  const m = cloneMeta(meta);
  m.bound = false;
  if (r.lifecycle === 'committed') r.lifecycle = lifecycle;
  finalize(d, r, m, at);
  d.persist(documentKey, false);
}

/** F012: activation keeps document identity even when Chrome changes frameId. */
function migratePrerender(d: Draft, tabId: number, frameId: number, documentId: string, at: number): void {
  const target = makeDocumentKey(tabId, frameId, documentId);
  for (const [bk, binding] of d.finish().bindings) {
    if (!bk.endsWith(':p') || binding.tabId !== tabId || binding.documentId !== documentId || binding.documentKey === target) continue;
    const report = d.readReport(binding.documentKey);
    const meta = d.readMeta(binding.documentKey);
    const previous = d.readBinding(bindingKey(tabId, frameId));
    if (previous !== undefined && previous.documentKey !== target) unbindDocument(d, previous.documentKey, 'closed', at);
    d.bindings.delete(bk);
    const active = { ...binding, frameId, documentKey: target, documentLifecycle: 'active' as const, boundAt: at };
    d.bindings.set(bindingKey(tabId, frameId), active);
    if (report !== undefined && meta !== undefined) {
      d.reports.delete(binding.documentKey);
      d.metas.delete(binding.documentKey);
      const r = { ...cloneReport(report), documentKey: target, frameId, lifecycle: 'committed' as const };
      const m = { ...cloneMeta(meta), documentKey: target };
      finalize(d, r, m, at);
      d.remove([binding.documentKey]);
      d.persist(target, false);
    }
    projectIfTop(d, active);
    d.persistIndex();
    return;
  }
}

function admission(d: Draft, tabId: number, top: boolean, at: number, newBinding = true): boolean {
  const state = d.finish();
  const perTab = [...state.bindings.values()].filter((b) => b.tabId === tabId).length;
  if ((!newBinding || (perTab < MAX_BINDINGS_PER_TAB && state.bindings.size < MAX_DOCUMENTS_GLOBAL)) && state.reports.size < MAX_DOCUMENTS_GLOBAL) return true;
  const topKey = state.tabs.get(tabId)?.activeTopDocumentKey;
  if (topKey) {
    const r = d.readReport(topKey);
    const m = d.readMeta(topKey);
    if (r && m) {
      const copy = cloneReport(r);
      copy.coverageFlags = withFlag(copy.coverageFlags, 'budget-exceeded');
      finalize(d, copy, cloneMeta(m), at);
      d.persist(topKey, false);
    }
  }
  if (!top) return false;
  const victim = planEviction(d.finish())[0];
  if (victim) { d.evictDocument(victim, false); d.remove([victim]); return true; }
  return false;
}

function onCommitted(d: Draft, ev: Extract<DocumentEvent, { type: 'navigation:committed' }>, deps: ReducerDeps): void {
  const key = makeDocumentKey(ev.tabId, ev.frameId, ev.documentId);
  const outermost = ev.frameType === 'outermost_frame' || (ev.frameType === null && ev.frameId === 0);
  if (ev.documentLifecycle === 'active') migratePrerender(d, ev.tabId, ev.frameId, ev.documentId, ev.at);
  const lifecycleKnown = ev.frameType !== null && ev.documentLifecycle !== null;
  if (!lifecycleKnown) d.notes.lifecycleFallbackCommits = satAdd(d.notes.lifecycleFallbackCommits, 1);
  const isPrerender = ev.documentLifecycle === 'prerender';
  const bKey = bindingKey(ev.tabId, ev.frameId, isPrerender);

  const previous = d.readBinding(bKey);
  if ((previous === undefined || d.readReport(key) === undefined) && !admission(d, ev.tabId, outermost && !isPrerender, ev.at, previous === undefined)) {
    if (previous) { d.bindings.delete(bKey); unbindDocument(d, previous.documentKey, 'closed', ev.at); d.persistIndex(); }
    return;
  }
  if (outermost && !isPrerender) {
    // Detach the replaced tree. Prerender trees are independent; activated descendants retain their parent chain.
    const retained = new Set([ev.documentId]);
    for (let pass = 0; pass < MAX_BINDINGS_PER_TAB; pass++) {
      let changed = false;
      for (const b of d.finish().bindings.values()) if (b.tabId === ev.tabId && b.parentDocumentId && retained.has(b.parentDocumentId) && !retained.has(b.documentId)) {
        retained.add(b.documentId); changed = true;
      }
      if (!changed) break;
    }
    for (const [bk, b] of d.finish().bindings) {
      if (b.tabId !== ev.tabId || bk === bKey || bk.endsWith(':p') || retained.has(b.documentId)) continue;
      d.bindings.delete(bk);
      unbindDocument(d, b.documentKey, 'closed', ev.at);
    }
  }
  if (previous !== undefined && previous.documentKey !== key) {
    // The frame now hosts a different document (navigation or iframe reuse): the old report stays until TTL.
    unbindDocument(d, previous.documentKey, 'closed', ev.at);
  }
  if (!isPrerender) {
    // An activated prerender document leaves its prerender slot.
    const pKey = bindingKey(ev.tabId, ev.frameId, true);
    const p = d.readBinding(pKey);
    if (p !== undefined && p.documentId === ev.documentId) d.bindings.delete(pKey);
  }
  const binding: FrameBinding = {
    tabId: ev.tabId,
    frameId: ev.frameId,
    documentId: ev.documentId,
    documentKey: key,
    parentDocumentId: ev.parentDocumentId,
    frameType: ev.frameType,
    documentLifecycle: ev.documentLifecycle,
    host: ev.accessGranted === false ? null : reportHost(ev.host),
    ...(ev.scheme === undefined ? {} : { scheme: ev.scheme }),
    boundAt: ev.at,
    accessGranted: ev.accessGranted !== false,
  };
  d.bindings.set(bKey, binding);
  d.attempts.delete(bindingKey(ev.tabId, ev.frameId));

  const existing = d.readReport(key);
  const existingMeta = d.readMeta(key);
  const isTop = ev.frameType !== null ? ev.frameType === 'outermost_frame' : ev.frameId === 0;
  if (existing !== undefined && existingMeta !== undefined) {
    // Same documentId again: BFCache restore or prerender activation. Keep the report (REQ-009).
    const r = cloneReport(existing);
    const m = cloneMeta(existingMeta);
    m.bound = true;
    r.lifecycle = mapLifecycle(ev.documentLifecycle);
    if (ev.scheme !== undefined) m.scheme = ev.scheme;
    m.accessGranted = ev.accessGranted !== false;
    r.host = m.cleared ? null : binding.host;
    finalize(d, r, m, ev.at);
    d.persist(key, false);
  } else {
    const flags: CoverageFlag[] = d.evictedKeys.includes(key) ? ['truncated'] : [];
    const report = newReport(ev.tabId, ev.frameId, ev.documentId, binding.host, mapLifecycle(ev.documentLifecycle), flags, ev.at);
    const meta = newMeta(key, ev.at);
    if (ev.scheme !== undefined) meta.scheme = ev.scheme;
    meta.accessGranted = ev.accessGranted !== false;
    if (!meta.accessGranted) report.coverageFlags = withFlag(report.coverageFlags, 'no-host-permission');
    report.coverageState = deriveCoverageState(report.coverageFlags, meta);
    d.reports.set(key, report);
    d.metas.set(key, meta);
    // Top-level documents are persisted eagerly (they are projected); subframes on first data.
    if (isTop && !isPrerender) d.persist(key, false);
  }
  if (isTop && !isPrerender && (ev.documentLifecycle === 'active' || ev.documentLifecycle === null)) {
    d.tabs.set(ev.tabId, { tabId: ev.tabId, activeTopDocumentKey: key });
  }
  d.persistIndex();
  drainQuarantine(d, key, ev.at, deps);
  // P06 / REQ-006: an ungranted frame never runs a bridge, so navigation must expose the gap.
  // Opaque/inherited documents can gain access from a verified sender origin after this commit.
  if (ev.accessGranted === false && ev.scheme !== undefined) markFrameUnavailable(d, ev.tabId, ev.frameId, ev.documentId, ev.at);
}

function markFrameUnavailable(d: Draft, tabId: number, frameId: number, documentId: string, at: number): void {
  const child = [...d.finish().bindings.values()].find((b) => b.tabId === tabId && b.frameId === frameId && b.documentId === documentId);
  if (!child?.parentDocumentId) return;
  const parent = [...d.finish().bindings.values()].find((b) => b.tabId === tabId && b.documentId === child.parentDocumentId);
  if (!parent) return;
  const r = d.readReport(parent.documentKey);
  const m = d.readMeta(parent.documentKey);
  if (!r || !m || m.accessGranted === false || m.revoked) return;
  const copy = cloneReport(r);
  copy.coverageFlags = withFlag(copy.coverageFlags, 'frames-inaccessible');
  finalize(d, copy, cloneMeta(m), at);
  d.persist(parent.documentKey, false);
}

function onTabRemoved(d: Draft, tabId: number): void {
  const removed: string[] = [];
  for (const [key, report] of d.finish().reports) {
    if (report.tabId === tabId) {
      removed.push(key);
      d.reports.delete(key);
      d.metas.delete(key);
    }
  }
  for (const [bk, b] of d.finish().bindings) if (b.tabId === tabId) d.bindings.delete(bk);
  for (const [ak, a] of d.finish().attempts) if (a.tabId === tabId) d.attempts.delete(ak);
  d.tabs.delete(tabId);
  const q = d.finish().quarantine;
  if (q.some((e) => e.sender.tabId === tabId)) {
    const keep = q.filter((e) => e.sender.tabId !== tabId);
    for (const e of q) if (e.sender.tabId === tabId) orphan(d, e, 'tab-closed');
    d.quarantine.length = 0;
    d.quarantine.push(...keep);
  }
  d.remove(removed);
  d.persistIndex();
}

function onTabReplaced(d: Draft, addedTabId: number, removedTabId: number, at: number): void {
  // The replaced tab is gone: unbind its documents (kept until TTL, never deleted mechanically).
  for (const [bk, b] of d.finish().bindings) {
    if (b.tabId === removedTabId) {
      d.bindings.delete(bk);
      unbindDocument(d, b.documentKey, 'closed', at);
    }
  }
  for (const [ak, a] of d.finish().attempts) if (a.tabId === removedTabId) d.attempts.delete(ak);
  d.tabs.delete(removedTabId);
  // The added tab shows its (previously prerendered) outermost document: promote and project it.
  for (const [bk, b] of d.finish().bindings) {
    if (b.tabId !== addedTabId || !bk.endsWith(':p')) continue;
    const report = d.readReport(b.documentKey);
    if (report === undefined) continue;
    const promoted = promoteIfActivated(d, report, 'active');
    const meta = d.readMeta(b.documentKey);
    if (meta !== undefined) {
      finalize(d, promoted, cloneMeta(meta), at);
      d.persist(b.documentKey, false);
    }
  }
  d.persistIndex();
}

function onNetworkHost(d: Draft, ev: Extract<DocumentEvent, { type: 'network:host' }>, deps: ReducerDeps): void {
  if (ev.tabId < 0) {
    // Worker / browser-initiated request: stays unattributed (A7); origin does not assign it to a tab.
    d.unattributed.requests = satAdd(d.unattributed.requests, 1);
    return;
  }
  let frameId = ev.frameId;
  let documentId: string | null = null;
  if (ev.resourceType === 'sub_frame' && ev.parentDocumentId !== null && ev.parentFrameId !== null && ev.parentFrameId >= 0) {
    frameId = ev.parentFrameId;
    documentId = ev.parentDocumentId;
  } else if (ev.documentId !== null) {
    documentId = ev.documentId;
  }
  if (documentId === null) {
    d.unattributed.requests = satAdd(d.unattributed.requests, 1);
    return;
  }
  const key = makeDocumentKey(ev.tabId, frameId, documentId);
  let report = d.readReport(key);
  let meta = d.readMeta(key);
  if (report === undefined || meta === undefined) {
    const created = materialize(d, ev.tabId, frameId, documentId, ev.at);
    if (created === null) {
      d.unattributed.requests = satAdd(d.unattributed.requests, 1);
      return;
    }
    report = created.report;
    meta = created.meta;
  } else {
    report = cloneReport(report);
    meta = cloneMeta(meta);
  }
  if (meta.revoked || meta.paused || meta.accessGranted === false) return;
  if (meta.cleared) {
    delete meta.cleared;
    report.host = d.readBinding(bindingKey(ev.tabId, ev.frameId))?.host ?? null;
    report.createdAt = ev.at;
  }
  const hosts: HostEntry[] = [...report.hosts];
  const redacted = redactHost(ev.host);
  const registrableDomain = redacted.kind === 'registrable' ? redacted.value : undefined;
  const category = ev.category ?? (redacted.kind === 'registrable' ? undefined : redacted.kind === 'unknown' ? 'unknown' : redacted.value);
  const relation = ev.relation ?? 'unknown';
  const bucket = Math.max(0, Math.floor((ev.at - report.createdAt) / 1000));
  const idx = hosts.findIndex((h) => h.registrableDomain === registrableDomain && h.category === category && h.relation === relation);
  if (idx >= 0) {
    const h = hosts[idx];
    if (h !== undefined) hosts[idx] = { ...h, requestCount: satAdd(h.requestCount, 1), lastSeenBucket: bucket };
  } else if (hosts.length >= BUDGETS.maxHostsPerDocument) {
    report.dropped.hosts = satAdd(report.dropped.hosts, 1);
    report.coverageFlags = withFlag(report.coverageFlags, 'budget-exceeded');
  } else {
    hosts.push({
      ...(registrableDomain === undefined ? { category: category! } : { registrableDomain }),
      relation,
      evidenceSource: 'browser-network',
      integrity: 'browser-observed',
      requestCount: 1,
      firstSeenBucket: bucket,
      lastSeenBucket: bucket,
      ruleIds: [],
    });
  }
  report.hosts = hosts;
  runEngine(d, report, meta, deps);
  finalize(d, report, meta, ev.at);
  d.persist(key, false);
}

function onTtlTick(d: Draft, at: number): void {
  expireQuarantine(d, at);
  for (const [key, attempt] of d.finish().attempts) if (at - attempt.startedAt >= BUDGETS.inactiveDocumentTtlMs) d.attempts.delete(key);
  const expired: string[] = [];
  for (const [key, meta] of d.finish().metas) {
    if (!meta.bound && at - meta.lastActivityAt >= BUDGETS.inactiveDocumentTtlMs) expired.push(key);
  }
  for (const key of expired) d.evictDocument(key, false);
  d.remove(expired);
}

function onRevoked(d: Draft, documentKeys: readonly string[], at: number): void {
  for (const key of documentKeys) {
    const report = d.readReport(key);
    const meta = d.readMeta(key);
    if (report === undefined || meta === undefined) continue;
    const r = cloneReport(report);
    const m = cloneMeta(meta);
    // Purge scope data, keep only the status (ADR-003 §5, ADR-007 §6).
    r.counters = [];
    r.findings = [];
    r.hosts = [];
    r.watermark = null;
    r.host = null;
    r.coverageFlags = ['revoked'];
    m.accessGranted = false;
    m.revoked = true;
    m.boots = [];
    m.folded = {};
    m.sessions = [];
    finalize(d, r, m, at);
    d.persist(key, true);
  }
}

function onDegraded(d: Draft, key: string, truncate: boolean, at: number): void {
  const report = d.readReport(key);
  const meta = d.readMeta(key);
  if (report === undefined || meta === undefined) return;
  const r = cloneReport(report);
  const m = cloneMeta(meta);
  m.degraded = true;
  if (truncate) {
    // Degradation order (ADR-011 §2): details first, summary counters keep going.
    const keepFindings = Math.floor(r.findings.length / 2);
    const keepHosts = Math.floor(r.hosts.length / 2);
    m.findingsCap = keepFindings;
    r.dropped.findings = satAdd(r.dropped.findings, r.findings.length - keepFindings);
    r.dropped.hosts = satAdd(r.dropped.hosts, r.hosts.length - keepHosts);
    r.findings = r.findings.slice(0, keepFindings);
    r.hosts = r.hosts.slice(0, keepHosts);
    r.coverageFlags = withFlag(r.coverageFlags, 'truncated');
  }
  finalize(d, r, m, at);
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function reduce(state: DocumentsState, event: DocumentEvent, deps: ReducerDeps): ReduceResult {
  const d = new Draft(state);
  let batch: BatchOutcome | undefined;
  switch (event.type) {
    case 'navigation:before': {
      // Pending attempt; the current report stays available (A7).
      if (d.finish().attempts.size >= MAX_DOCUMENTS_GLOBAL && !d.finish().attempts.has(bindingKey(event.tabId, event.frameId))) break;
      d.attempts.set(bindingKey(event.tabId, event.frameId), {
        tabId: event.tabId,
        frameId: event.frameId,
        startedAt: event.at,
        host: reportHost(event.host),
      });
      break;
    }
    case 'navigation:committed':
      onCommitted(d, event, deps);
      break;
    case 'navigation:error': {
      // Failed / cancelled navigation closes the attempt and never clears the current document.
      d.attempts.delete(bindingKey(event.tabId, event.frameId));
      // Cancel only a prerender identified by the browser, never the visible page on an ordinary abort.
      for (const [bk, binding] of d.finish().bindings) {
        if (bk.endsWith(':p') && binding.tabId === event.tabId && binding.documentId === event.documentId) {
          d.bindings.delete(bk);
          unbindDocument(d, binding.documentKey, 'closed', event.at);
          d.persistIndex();
        }
      }
      break;
    }
    case 'navigation:route': {
      const key = makeDocumentKey(event.tabId, event.frameId, event.documentId);
      const meta = d.readMeta(key);
      const report = d.readReport(key);
      if (meta !== undefined && report !== undefined) {
        const m = cloneMeta(meta);
        m.routeSegments = satAdd(m.routeSegments, 1);
        m.lastActivityAt = event.at;
        d.metas.set(key, m);
        const promoted = promoteIfActivated(d, report, event.documentLifecycle);
        if (promoted !== report) {
          finalize(d, promoted, m, event.at);
          d.persist(key, false);
        }
      }
      break;
    }
    case 'navigation:completed': {
      const key = makeDocumentKey(event.tabId, event.frameId, event.documentId);
      const report = d.readReport(key);
      const meta = d.readMeta(key);
      if (report !== undefined && meta !== undefined) {
        const promoted = promoteIfActivated(d, report, event.documentLifecycle);
        if (promoted !== report) {
          finalize(d, promoted, cloneMeta(meta), event.at);
          d.persist(key, false);
        }
      }
      break;
    }
    case 'tab:removed':
      onTabRemoved(d, event.tabId);
      break;
    case 'tab:replaced':
      onTabReplaced(d, event.addedTabId, event.removedTabId, event.at);
      break;
    case 'batch': {
      expireQuarantine(d, event.at);
      batch = applyBatch(d, event.sender, event.batch, event.at, deps);
      if (batch.status === 'quarantined') {
        enqueueQuarantine(d, { documentKey: event.sender.documentKey, sender: { ...event.sender, host: reportHost(event.sender.host), originPattern: null }, batch: event.batch, receivedAt: event.at });
      }
      break;
    }
    case 'network:host':
      onNetworkHost(d, event, deps);
      break;
    case 'ttl-tick':
      onTtlTick(d, event.at);
      break;
    case 'ui:pause':
    case 'ui:resume': {
      const report = d.readReport(event.documentKey);
      const meta = d.readMeta(event.documentKey);
      if (report !== undefined && meta !== undefined) {
        const r = cloneReport(report);
        const m = cloneMeta(meta);
        m.paused = event.type === 'ui:pause';
        // The paused interval stays visible in coverage after resume (E06-02 #2).
        if (m.paused) r.coverageFlags = withFlag(r.coverageFlags, 'paused');
        finalize(d, r, m, event.at);
        d.persist(event.documentKey, true);
      }
      break;
    }
    case 'ui:clear': {
      const report = d.readReport(event.documentKey);
      const meta = d.readMeta(event.documentKey);
      if (report !== undefined && meta !== undefined) {
        // CORE-01/02 / ADR-007: retain only bounded dedup/reset metadata, never deleted report payload.
        const cleared = resetDocument(report, meta, event.fence ?? { documentKey: report.documentKey, bridgeSessionId: 'reset-required', sensorBootIds: [], at: event.at, reportRevision: satAdd(report.revision, 1) });
        d.reports.set(event.documentKey, cleared.report);
        d.metas.set(event.documentKey, cleared.meta);
        d.persist(event.documentKey, true);
      }
      break;
    }
    case 'injection:late': {
      for (const b of d.finish().bindings.values()) {
        if (!event.documentKeys.includes(b.documentKey)) continue;
        const report = d.readReport(b.documentKey);
        const meta = d.readMeta(b.documentKey);
        if (report === undefined || meta === undefined) continue;
        const r = cloneReport(report);
        const m = cloneMeta(meta);
        m.lateInjection = true;
        r.coverageFlags = withFlag(r.coverageFlags, 'late-start');
        finalize(d, r, m, event.at);
        d.persist(b.documentKey, false);
      }
      break;
    }
    case 'frame:unavailable': {
      markFrameUnavailable(d, event.tabId, event.frameId, event.documentId, event.at);
      break;
    }
    case 'transport:dropped': {
      const report = d.readReport(event.documentKey);
      const meta = d.readMeta(event.documentKey);
      if (report === undefined || meta === undefined || meta.revoked || meta.accessGranted === false) break;
      const r = cloneReport(report);
      r.dropped.transport = satAdd(r.dropped.transport, event.count);
      r.coverageFlags = withFlag(r.coverageFlags, 'throttled');
      finalize(d, r, cloneMeta(meta), event.at);
      d.persist(event.documentKey, false);
      break;
    }
    case 'scope:access': {
      for (const [key, binding] of d.finish().bindings) {
        if (binding.documentKey === event.documentKey) d.bindings.set(key, { ...binding, accessGranted: event.accessGranted, host: event.accessGranted ? reportHost(event.host) : null });
      }
      const report = d.readReport(event.documentKey);
      const meta = d.readMeta(event.documentKey);
      if (report !== undefined && meta !== undefined) {
        const r = cloneReport(report);
        const m = cloneMeta(meta);
        m.accessGranted = event.accessGranted;
        r.host = event.accessGranted && !m.cleared ? reportHost(event.host) : null;
        if (event.accessGranted) {
          m.revoked = false;
          r.coverageFlags = r.coverageFlags.filter((f) => f !== 'no-host-permission' && f !== 'revoked');
        } else if (!m.revoked) r.coverageFlags = withFlag(r.coverageFlags, 'no-host-permission');
        finalize(d, r, m, event.at);
        d.persist(event.documentKey, false);
      }
      d.persistIndex();
      break;
    }
    case 'scope:revoked':
      onRevoked(d, event.documentKeys, event.at);
      break;
    case 'document:degraded':
      onDegraded(d, event.documentKey, event.truncate, event.at);
      break;
    case 'document:evict': {
      const removed: string[] = [];
      for (const key of event.documentKeys) {
        if (d.readReport(key) === undefined) continue;
        d.evictDocument(key, false);
        removed.push(key);
      }
      d.remove(removed);
      break;
    }
  }
  const result: ReduceResult = { state: d.finish(), effects: d.effects };
  if (batch !== undefined) result.batch = batch;
  return result;
}

// ---------------------------------------------------------------------------
// Selectors and planners (pure)
// ---------------------------------------------------------------------------

/** documentKey shown for a tab: the active outermost document, or the current document of a given frame. */
export function selectDocumentKey(state: DocumentsState, tabId: number, frameId?: number): string | null {
  if (frameId !== undefined) return state.bindings.get(bindingKey(tabId, frameId))?.documentKey ?? null;
  return state.tabs.get(tabId)?.activeTopDocumentKey ?? null;
}

export function isProjected(state: DocumentsState, documentKey: string): boolean {
  for (const t of state.tabs.values()) if (t.activeTopDocumentKey === documentKey) return true;
  return false;
}

/**
 * LRU order for eviction: unbound documents first (oldest activity first), then bound but unprojected
 * (subframes, prerender). Projected documents are never returned; they get truncated instead.
 */
export function planEviction(state: DocumentsState, exclude: ReadonlySet<string> = new Set()): string[] {
  const unbound: DocumentMeta[] = [];
  const bound: DocumentMeta[] = [];
  for (const meta of state.metas.values()) {
    if (exclude.has(meta.documentKey) || isProjected(state, meta.documentKey)) continue;
    (meta.bound ? bound : unbound).push(meta);
  }
  const byActivity = (a: DocumentMeta, b: DocumentMeta): number => a.lastActivityAt - b.lastActivityAt;
  unbound.sort(byActivity);
  bound.sort(byActivity);
  return [...unbound, ...bound].map((m) => m.documentKey);
}

/** Bounded shape preflight before exact persistence-size measurement (F097, REQ-011). */
function boundedRecord(value: unknown, depth: number, remaining: { nodes: number }): boolean {
  if (--remaining.nodes < 0 || depth > 8) return false;
  if (typeof value === 'string') return value.length <= BUDGETS.maxStringChars;
  if (value === null || typeof value !== 'object') return true;
  const entries = Object.entries(value);
  if (entries.length > BUDGETS.maxBridgeRecordsPerDocument) return false;
  return entries.every(([key, item]) => key.length <= BUDGETS.maxStringChars && boundedRecord(item, depth + 1, remaining));
}

/** Exact UTF-8 size of a bounded snapshot plus dedup metadata; measured only at persistence/budget boundaries. */
export function estimateReportBytes(report: DocumentReport, meta: DocumentMeta): number {
  if (report.counters.length > BUDGETS.maxCountersPerDocumentGroup || report.findings.length > BUDGETS.maxFindingsPerDocument ||
      report.hosts.length > BUDGETS.maxHostsPerDocument || meta.boots.length > MAX_BOOTS_PER_DOCUMENT || meta.sessions.length > MAX_SESSIONS_PER_DOCUMENT) return Infinity;
  for (const boot of meta.boots) if (Object.keys(boot.counts).length > BUDGETS.maxCountersPerDocumentGroup) return Infinity;
  const record = { v: 1, report, meta };
  if (!boundedRecord(record, 0, { nodes: 20_000 })) return Infinity;
  return new TextEncoder().encode(JSON.stringify(record)).byteLength;
}

export function droppedTotal(dropped: DroppedCounters): number {
  return dropped.observations + dropped.batches + dropped.findings + dropped.hosts + dropped.counters + dropped.transport;
}
