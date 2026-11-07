import { reportHost, redactHost } from '../../attribution/src/index';
import { lookupVendorResourceRule } from '../../catalog/src/index';
import { addRequestedLocalPort, incrementNetworkCounters } from './network-counters';
// Document model and pure reducer (REQ-009, REQ-011, spec A6/A7/A10, ADR-005).
// `reduce(state, event, deps) -> { state', effects }` never touches chrome.*; side effects (storage, ACK)
// are executed by runtime.ts. One DocumentReport per documentId; the documentKey is tabId:frameId:documentId
// and is derived from MessageSender / webNavigation only (REQ-004).

import { BUDGETS, EMPTY_DROPPED, MAX_COUNT, counterKey, makeDocumentKey, mergeResponseHeaders, readResponseHeaders } from '@detect-expert/contracts';
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
  RequestedLocalPorts,
  ResponseHeadersSummary,
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
  /** Browser navigation lacks a verified origin/access decision; this is not a confirmed denial. */
  originPending?: boolean;
  apiResultsResetRequired?: boolean;
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
  /** Decimal report.counters slot when DocumentMeta.counterKeyFormat is index-v1. */
  counts: Record<string, number>;
}

export interface SessionWatermark {
  bridgeSessionId: string;
  lastCommittedBatchSeq: number;
}

/** ADR-073: metadata-only routing fence, committed independently of the report payload. */
export interface ClearFence {
  documentKey: string;
  bridgeSessionId: string;
  sensorBootIds: string[];
  at: number;
  /** Preserve a paused clear so its projection stays visible for Resume. */
  paused?: boolean;
  /** Revision floor so a cleared record never rolls back below a visible pre-clear revision on restart. */
  reportRevision: number;
}

/** Per-document bookkeeping stored next to the report (not part of the wire contract). */
export interface DocumentMeta {
  documentKey: string;
  /** ADR-073: metadata-only reset record hidden from UI/export until a new observation is accepted. */
  cleared?: boolean;
  /** Accepts only a producer-reset epoch: the fresh bridgeSessionId and its new boot allowlist. */
  clearEpoch?: string;
  clearBootIds?: string[];
  /** Browser-owned canonical aggregates; never merged with page-controlled boot counters. */
  networkCounters?: CounterEntry[];
  networkCounterEpoch?: string;
  requestedLocalPorts?: RequestedLocalPorts;
  responseHeaders?: ResponseHeadersSummary;
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
  /** Internal persistence format; report counters retain the canonical wire fields. */
  counterKeyFormat?: 'index-v1';
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
  /** F098: short-lived unavailable diagnostics, keyed only by trusted browser document identity. */
  unavailableFrames: ReadonlyMap<string, number>;
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
      originPending?: boolean;
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
      /** Vetted browser-network catalog IDs only; never accepted from a PageBatch. */
      ruleIds?: readonly string[];
      /** Startup-only browser event; replay requires verified broad grants and all-sites scope. */
      requiresAllSitesAccess?: true;
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
  | { type: 'frames:retired'; documentKeys: readonly string[]; at: number }
  | { type: 'transport:dropped'; documentKey: string; count: number; at: number }
  | { type: 'transport:stopped'; documentKey: string; reason: 'protocol-mismatch'; at: number }
  | { type: 'network:limited'; documentKey: string; at: number }
  | { type: 'network:observed'; documentKey: string; websocket: boolean; local: boolean; localPort?: number; multiPort: boolean; dnsUnique?: number; limited: boolean; epoch: string; preVisitAt?: number; at: number }
  | { type: 'network:unattributed'; at: number }
  | { type: 'network:reset'; documentKey: string; at: number }
  | { type: 'network:headers'; documentKey: string; headers: ResponseHeadersSummary; requiresAllSitesAccess?: true;
      proPeriod?: { sessionId: string; pageId: string; navigation: boolean } | null; at: number }
  | { type: 'vendor:updated'; documentKey: string; at: number }
  | { type: 'scope:revoked'; documentKeys: readonly string[]; unresolvedOrigin?: true; at: number }
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
    unavailableFrames: new Map(),
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
    counterKeyFormat: 'index-v1',
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

/** ADR-073: no old payload, cumulative slot or ACK watermark survives an explicit producer-reset epoch. */
export function resetDocument(report: DocumentReport, meta: DocumentMeta, fence: ClearFence): { report: DocumentReport; meta: DocumentMeta } {
  const cleared = newReport(report.tabId, report.frameId, report.documentId, null, report.lifecycle, [], fence.at);
  // Revision floor: never below a visible pre-clear revision, even when loaded from a stale restart.
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
  private f: Map<string, number> | null = null;
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
  get unavailableFrames(): Map<string, number> {
    return (this.f ??= new Map(this.base.unavailableFrames));
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
    } else {
      for (const [slot, binding] of this.finish().bindings) if (binding.documentKey === key) {
        this.bindings.set(slot, { ...binding, apiResultsResetRequired: true });
        this.persistIndex();
      }
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
      unavailableFrames: this.f ?? this.base.unavailableFrames,
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

/** P06 / REQ-006: only browser-bound ancestry can carry a child coverage gap to its ancestors. */
function markAncestorFrameGap(d: Draft, child: FrameBinding, at: number): boolean {
  const visited = new Set<string>();
  let marked = false;
  let current = child;
  while (current.parentDocumentId !== null && visited.size < MAX_BINDINGS_PER_TAB) {
    if (current.documentLifecycle !== null && current.documentLifecycle !== 'active') return marked;
    if (visited.has(current.documentKey)) return marked;
    visited.add(current.documentKey);
    const parent = [...d.finish().bindings.values()].find((binding) => binding.tabId === current.tabId && binding.documentId === current.parentDocumentId);
    if (!parent || (parent.documentLifecycle !== null && parent.documentLifecycle !== 'active')) return marked;
    const report = d.readReport(parent.documentKey);
    const meta = d.readMeta(parent.documentKey);
    if (!report || !meta || meta.accessGranted === false || meta.revoked) return marked;
    marked = true;
    if (!report.coverageFlags.includes('frames-inaccessible')) {
      const copy = cloneReport(report);
      copy.coverageFlags = withFlag(copy.coverageFlags, 'frames-inaccessible');
      finalize(d, copy, cloneMeta(meta), at);
      d.persist(parent.documentKey, false);
    }
    current = parent;
  }
  return marked;
}

function expireUnavailableFrames(d: Draft, at: number): void {
  for (const [key, receivedAt] of d.finish().unavailableFrames) {
    if (at - receivedAt >= BUDGETS.outOfOrderTtlMs) d.unavailableFrames.delete(key);
  }
}

function hasFrameGap(report: DocumentReport | undefined, meta: DocumentMeta | undefined, binding: FrameBinding): boolean {
  return (meta?.accessGranted === false && binding.originPending !== true) || report?.coverageFlags.some((flag) =>
    flag === 'hook-failed' || flag === 'unsupported-realm' || flag === 'descriptor-nonconfigurable' || flag === 'frames-inaccessible') === true;
}

/** Unknown inherited origins remain visible, without persisting an unverified historical denial. */
export function hasPendingFrameOrigin(state: DocumentsState, documentKey: string): boolean {
  const root = [...state.bindings.values()].find(binding => binding.documentKey === documentKey);
  if (!root || (root.documentLifecycle !== null && root.documentLifecycle !== 'active')) return false;
  const children = new Map<string, FrameBinding[]>();
  for (const binding of state.bindings.values()) {
    if (binding.tabId !== root.tabId || binding.parentDocumentId === null ||
        (binding.documentLifecycle !== null && binding.documentLifecycle !== 'active')) continue;
    const siblings = children.get(binding.parentDocumentId) ?? [];
    siblings.push(binding);
    children.set(binding.parentDocumentId, siblings);
  }
  const queue = [root.documentId], visited = new Set<string>();
  for (let i = 0; i < queue.length && visited.size < MAX_BINDINGS_PER_TAB; i++) {
    const id = queue[i]!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const child of children.get(id) ?? []) {
      if (child.originPending === true && child.accessGranted === false) return true;
      if (!visited.has(child.documentId) && queue.length < MAX_BINDINGS_PER_TAB) queue.push(child.documentId);
    }
  }
  return false;
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
  // ADR-073 / CORE-02: after a producer reset only the fresh epoch's boots are admitted; an old-boot
  // cumulative (known or first-delivered-after-clear key) can never re-enter the new report.
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
    // F092: bounded eviction markers may no longer remember this document after a reset/restart.
    // A first seen sequence above one cannot establish how many earlier batches were actually lost.
    if (batch.batchSeq > 1 && meta.sessions.length === 0 && report.watermark === null &&
        !meta.sensorSeen && report.counters.length === 0) report.coverageFlags = withFlag(report.coverageFlags, 'truncated');
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
  // The discarded (pre-clear) interval cannot establish loss for the fresh epoch; old sequences still dedup above.
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
    // First accepted observation of the fresh epoch: the record becomes visible again from zero.
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
    const slots = new Map<string, string>();
    for (const c of report.counters) {
      const ck = counterKey(c.techniqueId, c.phase, c.signalCodes, c.apiOperation, c.extensionResource);
      slots.set(ck, String(counters.size));
      counters.set(ck, c);
    }
    for (const obs of batch.observations) {
      const ck = counterKey(obs.techniqueId, obs.phase, obs.signalCodes, obs.apiOperation, obs.extensionResource);
      const existing = counters.get(ck);
      if (existing === undefined && counters.size >= BUDGETS.maxCountersPerDocumentGroup) {
        report.dropped.counters = satAdd(report.dropped.counters, 1);
        report.dropped.observations = satAdd(report.dropped.observations, 1);
        report.coverageFlags = withFlag(report.coverageFlags, 'budget-exceeded');
        continue;
      }
      // F097: each boot keeps maxima by the stable, append-only counter slot. Repeating long
      // canonical keys across four boots can exceed 100 KiB even after every detail is removed.
      const slot = slots.get(ck) ?? String(counters.size);
      slots.set(ck, slot);
      const prev = boot.counts[slot];
      boot.counts[slot] = prev === undefined ? obs.count : Math.max(prev, obs.count);
      const total = totalForKey(meta, slot);
      if (existing === undefined) {
        counters.set(ck, {
          techniqueId: obs.techniqueId,
          ...(obs.apiOperation === undefined ? {} : { apiOperation: obs.apiOperation }),
          ...(obs.extensionResource === undefined ? {} : { extensionResource: { ...obs.extensionResource } }),
          phase: obs.phase,
          signalCodes: [...obs.signalCodes].sort(),
          count: total,
          countQuality: obs.countQuality,
          firstBucket: obs.intervalBucket,
          lastBucket: obs.intervalBucket,
        });
      } else {
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
  const binding = [...d.finish().bindings.values()].find((entry) => entry.documentKey === key);
  if (binding && hasFrameGap(report, meta, binding)) markAncestorFrameGap(d, binding, at);
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

/** F017: a replacement retires the old browser document's descendants, including inherited realms. */
function retireFrameTree(d: Draft, root: FrameBinding, at: number): void {
  const retired = new Set([root.documentId]);
  const prerender = root.documentLifecycle === 'prerender';
  for (let pass = 0; pass < MAX_BINDINGS_PER_TAB; pass++) {
    let changed = false;
    for (const binding of d.finish().bindings.values()) {
      if (binding.tabId !== root.tabId || (binding.documentLifecycle === 'prerender') !== prerender ||
          !binding.parentDocumentId || !retired.has(binding.parentDocumentId) || retired.has(binding.documentId)) continue;
      retired.add(binding.documentId);
      changed = true;
    }
    if (!changed) break;
  }
  for (const [slot, binding] of d.finish().bindings) {
    if (binding.tabId !== root.tabId || (binding.documentLifecycle === 'prerender') !== prerender || !retired.has(binding.documentId)) continue;
    d.bindings.delete(slot);
    d.unavailableFrames.delete(binding.documentKey);
    unbindDocument(d, binding.documentKey, 'closed', at);
  }
  d.persistIndex();
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

function admission(d: Draft, tabId: number, top: boolean, at: number, newBinding = true, existingKey: string | null = null): boolean {
  const needsReport = existingKey === null || d.readReport(existingKey) === undefined;
  // A long-lived SPA may fill history while its active frame slots are free. Reuse unbound history.
  if (needsReport && d.finish().reports.size >= MAX_DOCUMENTS_GLOBAL) {
    const victim = planEviction(d.finish()).find((key) => d.readMeta(key)?.bound === false);
    if (victim) { d.evictDocument(victim, false); d.remove([victim]); }
  }
  const state = d.finish();
  const perTab = [...state.bindings.values()].filter((b) => b.tabId === tabId).length;
  if ((!newBinding || (perTab < MAX_BINDINGS_PER_TAB && state.bindings.size < MAX_DOCUMENTS_GLOBAL)) && (!needsReport || state.reports.size < MAX_DOCUMENTS_GLOBAL)) return true;
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
  const victim = planEviction(d.finish(), existingKey === null ? new Set() : new Set([existingKey]))[0];
  if (victim) { d.evictDocument(victim, false); d.remove([victim]); return true; }
  return false;
}

function onCommitted(d: Draft, ev: Extract<DocumentEvent, { type: 'navigation:committed' }>, deps: ReducerDeps): void {
  expireUnavailableFrames(d, ev.at);
  const key = makeDocumentKey(ev.tabId, ev.frameId, ev.documentId);
  const outermost = ev.frameType === 'outermost_frame' || (ev.frameType === null && ev.frameId === 0);
  if (ev.documentLifecycle === 'active') migratePrerender(d, ev.tabId, ev.frameId, ev.documentId, ev.at);
  const lifecycleKnown = ev.frameType !== null && ev.documentLifecycle !== null;
  if (!lifecycleKnown) d.notes.lifecycleFallbackCommits = satAdd(d.notes.lifecycleFallbackCommits, 1);
  const isPrerender = ev.documentLifecycle === 'prerender';
  const bKey = bindingKey(ev.tabId, ev.frameId, isPrerender);

  const previous = d.readBinding(bKey);
  if (previous !== undefined && previous.documentKey !== key && !outermost) retireFrameTree(d, previous, ev.at);
  if ((previous === undefined || d.readReport(key) === undefined) && !admission(d, ev.tabId, outermost && !isPrerender, ev.at, previous === undefined, key)) {
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
  if (previous !== undefined && previous.documentKey !== key && d.readMeta(previous.documentKey)?.bound !== false) {
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
    originPending: ev.originPending === true && ev.accessGranted === false && !d.finish().unavailableFrames.has(key),
    ...(previous?.documentKey === key && previous.apiResultsResetRequired !== undefined
      ? { apiResultsResetRequired: previous.apiResultsResetRequired }
      : d.evictedKeys.includes(key) ? { apiResultsResetRequired: true } : {}),
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
    if (m.accessGranted && !m.revoked) r.coverageFlags = r.coverageFlags.filter(flag => flag !== 'no-host-permission');
    r.host = binding.host;
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
  if (ev.accessGranted === false && !binding.originPending) markAncestorFrameGap(d, binding, ev.at);
  if (d.finish().unavailableFrames.has(key) && markAncestorFrameGap(d, binding, ev.at)) d.unavailableFrames.delete(key);
  // A child commit or its diagnostic batch may precede the parent's commit notification.
  for (const child of d.finish().bindings.values()) {
    if (child.tabId === ev.tabId && child.parentDocumentId === ev.documentId &&
        (d.finish().unavailableFrames.has(child.documentKey) || hasFrameGap(d.readReport(child.documentKey), d.readMeta(child.documentKey), child))) {
      if (markAncestorFrameGap(d, child, ev.at)) d.unavailableFrames.delete(child.documentKey);
    }
  }
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
  for (const key of d.finish().unavailableFrames.keys()) if (key.startsWith(String(tabId) + ':')) d.unavailableFrames.delete(key);
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
    // A browser-observed host is a real post-clear observation: the fenced record becomes visible from zero.
    delete meta.cleared;
    report.host = d.readBinding(bindingKey(ev.tabId, ev.frameId))?.host ?? null;
    report.createdAt = ev.at;
  }
  const hosts: HostEntry[] = [...report.hosts];
  const redacted = redactHost(ev.host);
  const registrableDomain = redacted.kind === 'registrable' ? redacted.value : undefined;
  const category = ev.category ?? (redacted.kind === 'registrable' ? undefined : redacted.kind === 'unknown' ? 'unknown' : redacted.value);
  const relation = ev.relation ?? 'unknown';
  const ruleIds: string[] = [];
  // Internal events still cannot promote unknown/candidate/expired IDs. Page batches have no such field.
  for (const id of (ev.ruleIds ?? []).slice(0, 32)) {
    if (lookupVendorResourceRule(id, ev.at) !== null && !ruleIds.includes(id)) ruleIds.push(id);
  }
  const bucket = Math.max(0, Math.floor((ev.at - report.createdAt) / 1000));
  const idx = hosts.findIndex((h) => h.registrableDomain === registrableDomain && h.category === category && h.relation === relation);
  if (idx >= 0) {
    const h = hosts[idx];
    if (h !== undefined) {
      const merged = [...h.ruleIds];
      for (const id of ruleIds) {
        if (merged.includes(id)) continue;
        if (merged.length >= 32) { report.coverageFlags = withFlag(report.coverageFlags, 'budget-exceeded'); break; }
        merged.push(id);
      }
      hosts[idx] = { ...h, requestCount: satAdd(h.requestCount, 1), lastSeenBucket: bucket, ruleIds: merged.sort() };
      if (ruleIds.length > 0 && meta.firstObservationAt === null) meta.firstObservationAt = ev.at;
    }
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
      ruleIds: ruleIds.sort(),
    });
    if (ruleIds.length > 0 && meta.firstObservationAt === null) meta.firstObservationAt = ev.at;
  }
  report.hosts = hosts;
  runEngine(d, report, meta, deps);
  finalize(d, report, meta, ev.at);
  d.persist(key, false);
}

function onTtlTick(d: Draft, at: number): void {
  expireQuarantine(d, at);
  expireUnavailableFrames(d, at);
  for (const [key, attempt] of d.finish().attempts) if (at - attempt.startedAt >= BUDGETS.inactiveDocumentTtlMs) d.attempts.delete(key);
  const expired: string[] = [];
  for (const [key, meta] of d.finish().metas) {
    if (!meta.bound && at - meta.lastActivityAt >= BUDGETS.inactiveDocumentTtlMs) expired.push(key);
  }
  for (const key of expired) d.evictDocument(key, false);
  d.remove(expired);
}

function onRevoked(d: Draft, documentKeys: readonly string[], at: number, unresolvedOrigin = false): void {
  for (const key of documentKeys) {
    for (const [slot, binding] of d.finish().bindings) if (binding.documentKey === key) {
      const denied = { ...binding, accessGranted: false, originPending: unresolvedOrigin && binding.originPending === true };
      d.bindings.set(slot, denied);
      if (!denied.originPending) markAncestorFrameGap(d, denied, at);
      d.persistIndex();
    }
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
    r.coverageFlags = unresolvedOrigin ? r.coverageFlags.filter(flag => flag !== 'revoked' && flag !== 'no-host-permission') : ['revoked'];
    m.accessGranted = false;
    m.revoked = !unresolvedOrigin;
    if (unresolvedOrigin) m.sensorSeen = false;
    m.firstObservationAt = null;
    m.networkCounters = [];
    delete m.networkCounterEpoch;
    delete m.requestedLocalPorts;
    delete m.responseHeaders;
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
          retireFrameTree(d, binding, event.at);
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
    case 'network:headers': {
      const headers = readResponseHeaders(event.headers);
      if (!headers || !headers.entries.length && !headers.truncated) break;
      const binding = [...d.finish().bindings.values()].find(item => item.documentKey === event.documentKey);
      if (!binding || binding.accessGranted !== true || binding.originPending || binding.documentLifecycle !== null && binding.documentLifecycle !== 'active') break;
      const created = d.readReport(event.documentKey) && d.readMeta(event.documentKey) ? null : materialize(d, binding.tabId, binding.frameId, binding.documentId, event.at);
      const report = d.readReport(event.documentKey) ?? created?.report, meta = d.readMeta(event.documentKey) ?? created?.meta;
      if (!report || !meta || meta.paused || meta.revoked || meta.accessGranted === false) break;
      const nextReport = cloneReport(report), nextMeta = cloneMeta(meta);
      nextMeta.responseHeaders = mergeResponseHeaders(nextMeta.responseHeaders, headers);
      if (headers.entries.length) nextMeta.firstObservationAt ??= event.at;
      if (nextMeta.responseHeaders.truncated) nextReport.coverageFlags = withFlag(nextReport.coverageFlags, 'network-limited');
      finalize(d, nextReport, nextMeta, event.at);
      d.persist(event.documentKey, false);
      break;
    }
    case 'network:unattributed':
      d.unattributed.requests = satAdd(d.unattributed.requests, 1);
      break;
    case 'network:observed': {
      if (event.dnsUnique !== undefined && (!Number.isSafeInteger(event.dnsUnique) || event.dnsUnique < 1 || event.dnsUnique > 64)) break;
      const binding = [...d.finish().bindings.values()].find(item => item.documentKey === event.documentKey);
      if (!binding || binding.accessGranted !== true || binding.documentLifecycle !== null && binding.documentLifecycle !== 'active') break;
      const created = d.readReport(event.documentKey) && d.readMeta(event.documentKey) ? null : materialize(d, binding.tabId, binding.frameId, binding.documentId, event.at);
      const report = d.readReport(event.documentKey) ?? created?.report, meta = d.readMeta(event.documentKey) ?? created?.meta;
      if (!report || !meta || meta.paused || meta.revoked || meta.accessGranted === false || !/^[A-Za-z0-9_-]{1,64}$/.test(event.epoch)) break;
      const r = cloneReport(report), m = cloneMeta(meta);
      const bucket = Math.min(MAX_COUNT, Math.max(0, Math.floor((event.at - r.createdAt) / 1000)));
      if (event.local) m.requestedLocalPorts = addRequestedLocalPort(m.requestedLocalPorts, event.localPort,
        m.requestedLocalPorts === undefined && (m.networkCounters?.some(counter => counter.techniqueId === 'DET-060' && counter.count > 0) ?? false));
      m.networkCounters = incrementNetworkCounters(m.networkCounters ?? [], event.websocket, event.local, event.multiPort, event.limited, bucket, event.dnsUnique);
      m.networkCounterEpoch ??= event.epoch;
      m.firstObservationAt ??= event.at;
      if (event.limited) r.coverageFlags = withFlag(r.coverageFlags, 'network-limited');
      finalize(d, r, m, event.at);
      d.persist(event.documentKey, false);
      break;
    }
    case 'network:reset': {
      const report = d.readReport(event.documentKey), meta = d.readMeta(event.documentKey);
      if (!report || !meta || !meta.networkCounters?.length && !meta.requestedLocalPorts && !meta.responseHeaders) break;
      const r = cloneReport(report), m = cloneMeta(meta);
      m.networkCounters = []; delete m.networkCounterEpoch;
      delete m.requestedLocalPorts;
      delete m.responseHeaders;
      if (r.counters.length === 0 && !r.hosts.some(host => host.ruleIds.length > 0)) m.firstObservationAt = null;
      r.coverageFlags = withFlag(r.coverageFlags, 'network-limited');
      finalize(d, r, m, event.at); d.persist(event.documentKey, true);
      break;
    }
    case 'network:limited': {
      const report = d.readReport(event.documentKey), meta = d.readMeta(event.documentKey);
      if (!report || !meta || meta.revoked || meta.accessGranted === false) break;
      const r = cloneReport(report), m = cloneMeta(meta);
      r.coverageFlags = withFlag(r.coverageFlags, 'network-limited');
      m.degraded = true;
      if (m.networkCounters) m.networkCounters = m.networkCounters.map(counter => ({ ...counter, countQuality: 'lower-bound' }));
      m.requestedLocalPorts = { ports: m.requestedLocalPorts?.ports.slice() ?? [], truncated: true };
      finalize(d, r, m, event.at);
      d.persist(event.documentKey, false);
      break;
    }
    case 'vendor:updated': {
      const report = d.readReport(event.documentKey), meta = d.readMeta(event.documentKey);
      if (!report || !meta) break;
      // Only projection revision changes. ADR-024 endpoint data stays in the RTC manager.
      finalize(d, cloneReport(report), cloneMeta(meta), event.at);
      d.persist(event.documentKey, false);
      break;
    }
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
        // CORE-01/02 / ADR-073: retain only the bounded reset/epoch metadata, never deleted report payload.
        // The committed fence (runtime.commitClear) is authoritative; a missing fence keeps the record fenced.
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
      expireUnavailableFrames(d, event.at);
      const child = [...d.finish().bindings.values()].find((b) => b.tabId === event.tabId && b.frameId === event.frameId && b.documentId === event.documentId);
      if (child?.originPending) {
        for (const [slot, binding] of d.finish().bindings) if (binding === child) d.bindings.set(slot, { ...binding, originPending: false });
        d.persistIndex();
      }
      if (child && markAncestorFrameGap(d, child, event.at)) break;
      const key = makeDocumentKey(event.tabId, event.frameId, event.documentId);
      if (!d.finish().unavailableFrames.has(key)) {
        if (d.finish().unavailableFrames.size >= BUDGETS.maxOutOfOrderEntriesGlobal) {
          const oldest = d.finish().unavailableFrames.keys().next().value as string | undefined;
          if (oldest !== undefined) d.unavailableFrames.delete(oldest);
        }
        d.unavailableFrames.set(key, event.at);
      }
      break;
    }
    case 'frames:retired': {
      for (const key of event.documentKeys) {
        const binding = [...d.finish().bindings.values()].find((entry) => entry.documentKey === key);
        if (binding && binding.frameId !== 0 && (binding.documentLifecycle === null || binding.documentLifecycle === 'active')) retireFrameTree(d, binding, event.at);
      }
      break;
    }
    case 'transport:stopped': {
      // F020: terminal evidence changes coverage only for the current authorized document.
      const report = d.readReport(event.documentKey);
      const meta = d.readMeta(event.documentKey);
      if (!report || !meta || !meta.bound || meta.revoked || meta.accessGranted === false) break;
      if (!report.coverageFlags.includes(event.reason)) {
        const copy = cloneReport(report);
        copy.coverageFlags = withFlag(copy.coverageFlags, event.reason);
        finalize(d, copy, cloneMeta(meta), event.at);
        d.persist(event.documentKey, true);
      }
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
        if (binding.documentKey === event.documentKey) d.bindings.set(key, { ...binding, accessGranted: event.accessGranted,
          originPending: event.accessGranted ? false : binding.originPending === true, host: event.accessGranted ? reportHost(event.host) : null });
      }
      const report = d.readReport(event.documentKey);
      const meta = d.readMeta(event.documentKey);
      if (report !== undefined && meta !== undefined) {
        const r = cloneReport(report);
        const m = cloneMeta(meta);
        m.accessGranted = event.accessGranted;
        r.host = event.accessGranted ? reportHost(event.host) : null;
        if (event.accessGranted) {
          m.revoked = false;
          r.coverageFlags = r.coverageFlags.filter((f) => f !== 'no-host-permission' && f !== 'revoked');
        } else if (!m.revoked) r.coverageFlags = withFlag(r.coverageFlags, 'no-host-permission');
        finalize(d, r, m, event.at);
        d.persist(event.documentKey, false);
        if (!event.accessGranted) {
          const binding = [...d.finish().bindings.values()].find((entry) => entry.documentKey === event.documentKey);
          if (binding && !binding.originPending) markAncestorFrameGap(d, binding, event.at);
        }
      }
      d.persistIndex();
      break;
    }
    case 'scope:revoked':
      onRevoked(d, event.documentKeys, event.at, event.unresolvedOrigin);
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
  if (meta.responseHeaders !== undefined && readResponseHeaders(meta.responseHeaders) === null) return Infinity;
  if (report.counters.length > BUDGETS.maxCountersPerDocumentGroup || report.findings.length > BUDGETS.maxFindingsPerDocument ||
      report.hosts.length > BUDGETS.maxHostsPerDocument || meta.boots.length > MAX_BOOTS_PER_DOCUMENT || meta.sessions.length > MAX_SESSIONS_PER_DOCUMENT || (meta.networkCounters?.length ?? 0) > 4) return Infinity;
  for (const boot of meta.boots) if (Object.keys(boot.counts).length > BUDGETS.maxCountersPerDocumentGroup) return Infinity;
  const record = { v: 1, report, meta };
  if (!boundedRecord(record, 0, { nodes: 20_000 })) return Infinity;
  return new TextEncoder().encode(JSON.stringify(record)).byteLength;
}

export function droppedTotal(dropped: DroppedCounters): number {
  return dropped.observations + dropped.batches + dropped.findings + dropped.hosts + dropped.counters + dropped.transport;
}
