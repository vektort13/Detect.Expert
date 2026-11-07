import { reportHost } from '../../attribution/src/index';
// storage.session repository (spec A10, ADR-005 §4/§6, ADR-007 §4, E05-02). The service worker is the only
// writer. Keys: 'doc:' + documentKey (snapshot + dedup watermark + meta, one record) and 'index'
// (bindings + tab projections). A commit is ONE storage.session.set() call so the snapshot and the watermark
// can never disagree; the ACK is sent only after that call resolved (REQ-009). Never the synced area (REQ-010).

import { BUDGETS, COUNT_QUALITIES, EMPTY_NETWORK_PATTERNS, MAX_COUNT, isPageOperation } from '@detect-expert/contracts';
import type { CounterEntry, CountQuality, DocumentReport, NetworkPatterns, TechniqueId } from '@detect-expert/contracts';
import { NETWORK_TECHNIQUE_IDS } from '@detect-expert/engine';
import type { StorageAreaLike } from './chrome-api';
import type { DocumentMeta, FrameBinding, TabProjection } from './documents';

export const DOC_KEY_PREFIX = 'doc:';
export const INDEX_KEY = 'index';
export const STORED_VERSION = 1 as const;

export interface StoredDocument {
  v: typeof STORED_VERSION;
  report: DocumentReport;
  meta: DocumentMeta;
}

export interface StoredIndex {
  v: typeof STORED_VERSION;
  bindings: FrameBinding[];
  tabs: TabProjection[];
  savedAt: number;
  evictedKeys?: string[];
}

export type CommitFailure = 'quota' | 'storage';
export type CommitResult = { ok: true } | { ok: false; failure: CommitFailure };

export interface LoadResult {
  index: StoredIndex | null;
  documents: StoredDocument[];
  /** Records with an unknown version or a broken shape: dropped with a count, never an exception (E05-02 #8). */
  discarded: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isQuotaError(e: unknown): boolean {
  const message = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  return /quota/i.test(message);
}

/** Minimal shape validation of our own record (trusted context, but SW/extension updates may change shapes). */
const HOST_CATEGORIES = new Set(['loopback', 'link-local', 'private', 'ULA', 'public', 'localhost', 'local', 'single-label', 'unknown']);
const RELATIONS = new Set(['same-origin', 'same-site', 'cross-site', 'opaque', 'unknown']);
/** Reconstruct the storage allowlist, including during migration; legacy raw-host records are dropped. */
export function redactStoredHosts(value: unknown): DocumentReport['hosts'] {
  if (!Array.isArray(value)) return [];
  const out: DocumentReport['hosts'] = [];
  for (const h of value.slice(0, BUDGETS.maxHostsPerDocument)) {
    if (!isRecord(h)) continue;
    const domain = reportHost(h['registrableDomain']);
    const category = h['category'];
    if (domain === null && (typeof category !== 'string' || !HOST_CATEGORIES.has(category))) continue;
    const relation = typeof h['relation'] === 'string' && RELATIONS.has(h['relation']) ? h['relation'] as DocumentReport['hosts'][number]['relation'] : 'unknown';
    const count = (n: unknown): number => typeof n === 'number' && Number.isFinite(n) ? Math.min(MAX_COUNT, Math.max(0, Math.floor(n))) : 0;
    out.push({ ...(domain === null ? { category: category as NonNullable<DocumentReport['hosts'][number]['category']> } : { registrableDomain: domain }),
      relation, evidenceSource: 'browser-network', integrity: 'browser-observed', requestCount: count(h['requestCount']),
      firstSeenBucket: count(h['firstSeenBucket']), lastSeenBucket: count(h['lastSeenBucket']),
      ruleIds: Array.isArray(h['ruleIds']) ? h['ruleIds'].filter((id): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id)).slice(0, 32) : [],
    });
  }
  return out;
}

const NETWORK_IDS: ReadonlySet<string> = new Set<string>(NETWORK_TECHNIQUE_IDS);
const QUALITY_SET: ReadonlySet<string> = new Set<string>(COUNT_QUALITIES);

function boundedInt(v: unknown, max: number): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : null;
}

/**
 * S07 / ADR-018: rebuild the SW-only network fields from a stored record. Only valid entries survive (DET-058…061,
 * attempted, ['api-use'], no operation, bounded integers, one per technique, at most 8); patterns are three integers
 * 0..32 or all zeros. Snapshots written before S07 have neither field and get the defaults (no discard).
 */
export function redactStoredNetwork(report: Record<string, unknown>): { networkCounters: CounterEntry[]; networkPatterns: NetworkPatterns } {
  const networkCounters: CounterEntry[] = [];
  const rawCounters = report['networkCounters'];
  if (Array.isArray(rawCounters)) {
    for (const c of rawCounters.slice(0, BUDGETS.maxNetworkCountersPerDocument)) {
      if (!isRecord(c) || Object.prototype.hasOwnProperty.call(c, 'operationCode')) continue;
      const techniqueId = c['techniqueId'];
      const signals = c['signalCodes'];
      const count = boundedInt(c['count'], MAX_COUNT);
      const firstBucket = boundedInt(c['firstBucket'], MAX_COUNT);
      const lastBucket = boundedInt(c['lastBucket'], MAX_COUNT);
      const quality = c['countQuality'];
      if (typeof techniqueId !== 'string' || !NETWORK_IDS.has(techniqueId) || c['phase'] !== 'attempted') continue;
      if (!Array.isArray(signals) || signals.length !== 1 || signals[0] !== 'api-use') continue;
      if (count === null || firstBucket === null || lastBucket === null || typeof quality !== 'string' || !QUALITY_SET.has(quality)) continue;
      if (networkCounters.some((x) => x.techniqueId === techniqueId)) continue;
      networkCounters.push({ techniqueId: techniqueId as TechniqueId, phase: 'attempted', signalCodes: ['api-use'], count,
        countQuality: quality as CountQuality, firstBucket, lastBucket });
    }
  }
  const rawPatterns = report['networkPatterns'];
  let networkPatterns: NetworkPatterns = { ...EMPTY_NETWORK_PATTERNS };
  if (isRecord(rawPatterns)) {
    const ports = boundedInt(rawPatterns['localPortsMax'], BUDGETS.maxNetworkWindowDistinct);
    const targets = boundedInt(rawPatterns['localTargetsMax'], BUDGETS.maxNetworkWindowDistinct);
    const subdomains = boundedInt(rawPatterns['randomSubdomainsMax'], BUDGETS.maxNetworkWindowDistinct);
    if (ports !== null && targets !== null && subdomains !== null) networkPatterns = { localPortsMax: ports, localTargetsMax: targets, randomSubdomainsMax: subdomains };
  }
  return { networkCounters, networkPatterns };
}

/**
 * ADR-017: a stored counter may carry `operationCode` only from OPERATION_CODES, allowlisted for its technique.
 * Legacy counters (no field) stay valid; any other value makes the record a broken shape (discarded and counted).
 */
function storedOperationsValid(counters: readonly unknown[]): boolean {
  for (const c of counters) {
    if (!isRecord(c) || !Object.prototype.hasOwnProperty.call(c, 'operationCode')) continue;
    if (typeof c['techniqueId'] !== 'string' || !isPageOperation(c['techniqueId'], c['operationCode'])) return false;
  }
  return true;
}

export function readStoredDocument(key: string, value: unknown): StoredDocument | null {
  if (!key.startsWith(DOC_KEY_PREFIX) || !isRecord(value) || value['v'] !== STORED_VERSION) return null;
  const report = value['report'];
  const meta = value['meta'];
  if (!isRecord(report) || !isRecord(meta)) return null;
  const documentKey = key.slice(DOC_KEY_PREFIX.length);
  if (report['schemaVersion'] !== 1 || report['documentKey'] !== documentKey || meta['documentKey'] !== documentKey) return null;
  if (
    !Array.isArray(report['counters']) ||
    !Array.isArray(report['findings']) ||
    !Array.isArray(report['hosts']) ||
    !Array.isArray(report['coverageFlags']) ||
    !isRecord(report['dropped']) ||
    !Array.isArray(meta['boots']) ||
    !Array.isArray(meta['sessions']) ||
    !isRecord(meta['folded']) ||
    report['counters'].length > BUDGETS.maxCountersPerDocumentGroup || report['findings'].length > BUDGETS.maxFindingsPerDocument ||
    report['hosts'].length > BUDGETS.maxHostsPerDocument || meta['boots'].length > 4 || meta['sessions'].length > 4 ||
    !storedOperationsValid(report['counters'])
  ) {
    return null;
  }
  return { v: STORED_VERSION, report: { ...report, host: reportHost(report['host']), hosts: redactStoredHosts(report['hosts']), ...redactStoredNetwork(report) } as unknown as DocumentReport, meta: meta as unknown as DocumentMeta };
}

export function readStoredIndex(value: unknown): StoredIndex | null {
  if (!isRecord(value) || value['v'] !== STORED_VERSION) return null;
  const bindings = value['bindings'];
  const tabs = value['tabs'];
  if (!Array.isArray(bindings) || !Array.isArray(tabs)) return null;
  const savedAt = typeof value['savedAt'] === 'number' ? value['savedAt'] : 0;
  return {
    v: STORED_VERSION,
    bindings: bindings.filter((b): b is FrameBinding => isRecord(b) && typeof b['documentKey'] === 'string' && typeof b['tabId'] === 'number').map((b) => ({ ...b, host: reportHost(b.host) })),
    tabs: tabs.filter((t): t is TabProjection => isRecord(t) && typeof t['tabId'] === 'number'),
    savedAt,
    evictedKeys: Array.isArray(value['evictedKeys']) ? value['evictedKeys'].filter((k): k is string => typeof k === 'string' && k.length <= 128).slice(-256) : [],
  };
}

function redactedIndex(index: StoredIndex): StoredIndex {
  return { ...index, bindings: index.bindings.map((b) => ({ ...b, host: reportHost(b.host) })) };
}

export class SessionRepository {
  /** Per-document serialized promise queue: one read-modify-write of a snapshot at a time (A10). */
  private readonly queues = new Map<string, Promise<void>>();
  private writes: Promise<unknown> = Promise.resolve();

  private write<T>(task: () => Promise<T>): Promise<T> {
    const next = this.writes.then(task, task);
    this.writes = next.catch(() => undefined);
    return next;
  }

  constructor(private readonly storage: StorageAreaLike) {}

  /** TRUSTED_CONTEXTS where available (Chrome 102+); the default is already trusted-only. */
  async init(): Promise<void> {
    if (typeof this.storage.setAccessLevel !== 'function') return;
    try {
      await this.storage.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    } catch {
      // Unsupported on this build: session storage is not exposed to content scripts by default anyway.
    }
  }

  /** Runs `task` after every earlier task for the same document; different documents run independently. */
  run<T>(documentKey: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(documentKey) ?? Promise.resolve();
    const result = previous.then(task, task);
    const settled: Promise<void> = result.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(documentKey, settled);
    void settled.then(() => {
      if (this.queues.get(documentKey) === settled) this.queues.delete(documentKey);
    });
    return result;
  }

  async loadAll(): Promise<LoadResult> {
    let items: Record<string, unknown>;
    try {
      items = await this.storage.get(null);
    } catch {
      return { index: null, documents: [], discarded: 0 };
    }
    const documents: StoredDocument[] = [];
    let discarded = 0;
    const discardedKeys: string[] = [];
    let index: StoredIndex | null = null;
    for (const key of Object.keys(items)) {
      if (key === INDEX_KEY) {
        index = readStoredIndex(items[key]);
        if (index === null) { discarded++; discardedKeys.push(key); }
        continue;
      }
      if (!key.startsWith(DOC_KEY_PREFIX)) continue;
      const doc = readStoredDocument(key, items[key]);
      if (doc === null) { discarded++; discardedKeys.push(key); }
      else documents.push(doc);
    }
    if (discardedKeys.length > 0) await this.write(() => this.storage.remove(discardedKeys));
    // P01 migration must remove legacy literals from session, not only from the in-memory projection.
    const migrated: Record<string, unknown> = {};
    if (index !== null) migrated[INDEX_KEY] = redactedIndex(index);
    for (const doc of documents) migrated[DOC_KEY_PREFIX + doc.report.documentKey] = doc;
    if (Object.keys(migrated).length > 0) await this.write(() => this.storage.set(migrated));
    return { index, documents, discarded };
  }

  /** Snapshot + watermark (+ index when dirty) in exactly one set() call. Never throws. */
  async commit(documentKey: string, record: StoredDocument, index: StoredIndex | null): Promise<CommitResult> {
    // F027: persisted receipt times need only second precision for lifecycle/TTL bookkeeping.
    const rounded = (at: number): number => Math.floor(at / 1000) * 1000;
    const stored: StoredDocument = { v: 1,
      report: { ...record.report, createdAt: rounded(record.report.createdAt), updatedAt: rounded(record.report.updatedAt),
        host: reportHost(record.report.host), hosts: redactStoredHosts(record.report.hosts),
        ...redactStoredNetwork(record.report as unknown as Record<string, unknown>) },
      meta: { ...record.meta, lastActivityAt: rounded(record.meta.lastActivityAt),
        firstObservationAt: record.meta.firstObservationAt === null ? null : rounded(record.meta.firstObservationAt) },
    };
    const items: Record<string, unknown> = { [DOC_KEY_PREFIX + documentKey]: stored };
    if (index !== null) items[INDEX_KEY] = redactedIndex(index);
    try {
      await this.write(() => this.storage.set(items));
      return { ok: true };
    } catch (e) {
      return { ok: false, failure: isQuotaError(e) ? 'quota' : 'storage' };
    }
  }

  async remove(documentKeys: readonly string[]): Promise<boolean> {
    if (documentKeys.length === 0) return true;
    try {
      await this.write(() => this.storage.remove(documentKeys.map((k) => DOC_KEY_PREFIX + k)));
      return true;
    } catch {
      return false;
    }
  }

  async saveIndex(index: StoredIndex): Promise<boolean> {
    try {
      await this.write(() => this.storage.set({ [INDEX_KEY]: redactedIndex(index) }));
      return true;
    } catch {
      return false;
    }
  }

  /** Real usage as Chrome estimates it (session quota is a memory estimate, not JSON length); null if unavailable. */
  async bytesInUse(keys: string[] | null = null): Promise<number | null> {
    if (typeof this.storage.getBytesInUse !== 'function') return null;
    try {
      const n = await this.storage.getBytesInUse(keys);
      return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
    } catch {
      return null;
    }
  }

  async clearAll(): Promise<void> {
    try {
      await this.write(() => this.storage.clear());
    } catch {
      // Nothing to do: session storage is cleared by the browser on restart/update anyway.
    }
  }
}
