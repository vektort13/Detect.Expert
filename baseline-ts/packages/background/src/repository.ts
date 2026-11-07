import { reportHost } from '../../attribution/src/index';
import { readNetworkCounters } from './network-counters';
// storage.session repository (spec A10, ADR-005 §4/§6, ADR-007 §4, E05-02). The service worker is the only
// writer. Keys: 'doc:' + documentKey (snapshot + dedup watermark + meta, one record) and 'index'
// (bindings + tab projections). A commit is ONE storage.session.set() call so the snapshot and the watermark
// can never disagree; the ACK is sent only after that call resolved (REQ-009). Never the synced area (REQ-010).

import { BUDGETS, MAX_COUNT, apiOperationAllows, isApiOperation, counterKey, readRequestedLocalPorts, readExtensionResource, extensionResourceAllows, readResponseHeaders } from '@detect-expert/contracts';
import type { DocumentReport } from '@detect-expert/contracts';
import type { StorageAreaLike } from './chrome-api';
import { clearedFromBinding, resetDocument } from './documents';
import type { ClearFence, DocumentMeta, FrameBinding, TabProjection } from './documents';

export const DOC_KEY_PREFIX = 'doc:';
export const INDEX_KEY = 'index';
export const STORED_VERSION = 1 as const;
export const CLEAR_FENCES_KEY = 'clear-epochs:v1';

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

export function readStoredDocument(key: string, value: unknown): StoredDocument | null {
  if (!key.startsWith(DOC_KEY_PREFIX) || !isRecord(value) || value['v'] !== STORED_VERSION) return null;
  const report = value['report'];
  const meta = value['meta'];
  if (!isRecord(report) || !isRecord(meta)) return null;
  const portsField = Object.getOwnPropertyDescriptor(meta, 'requestedLocalPorts');
  const requestedLocalPorts = portsField && Object.hasOwn(portsField, 'value') ? readRequestedLocalPorts(portsField.value) : null;
  if (portsField && (!portsField.enumerable || requestedLocalPorts === null)) return null;
  const headersField = Object.getOwnPropertyDescriptor(meta, 'responseHeaders');
  const responseHeaders = headersField && Object.hasOwn(headersField, 'value') ? readResponseHeaders(headersField.value) : null;
  if (headersField && (!headersField.enumerable || responseHeaders === null)) return null;
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
    report['hosts'].length > BUDGETS.maxHostsPerDocument || meta['boots'].length > 4 || meta['sessions'].length > 4
  ) {
    return null;
  }
  // ADR-073: a cleared record is an empty, fenced placeholder; any payload on it is a corrupt shape.
  if (meta['cleared'] !== undefined && typeof meta['cleared'] !== 'boolean') return null;
  if (meta['cleared'] === true && (report['counters'].length !== 0 || report['findings'].length !== 0 ||
      report['hosts'].length !== 0 || report['host'] !== null || report['watermark'] !== null)) return null;
  if (meta['clearEpoch'] !== undefined && readClearFence({ documentKey, bridgeSessionId: meta['clearEpoch'], sensorBootIds: meta['clearBootIds'], at: 0, reportRevision: report['revision'] }) === null) return null;
  // F097 / REQ-009: migrate legacy long-key maxima without forgetting a boot or its counts.
  // Slots refer to the report's append-only counter order, shared by snapshot and watermark.
  if (meta['counterKeyFormat'] !== undefined && meta['counterKeyFormat'] !== 'index-v1') return null;
  const slots = new Map<string, string>();
  try {
    for (const [i, counter] of report['counters'].entries()) {
      const c = counter as DocumentReport['counters'][number];
      if (Object.hasOwn(c, 'apiOperation')) {
        const keys = ['techniqueId', 'phase', 'signalCodes', 'count', 'countQuality', 'firstBucket', 'lastBucket', 'apiOperation'];
        if (Reflect.ownKeys(c).length !== keys.length || keys.some(key => {
          const field = Object.getOwnPropertyDescriptor(c, key);
          return !field || !field.enumerable || !Object.hasOwn(field, 'value');
        }) || !isApiOperation(c.apiOperation) || !apiOperationAllows(c.apiOperation, c.techniqueId, c.phase) ||
            !Array.isArray(c.signalCodes) || c.signalCodes.length !== 1 || c.signalCodes[0] !== 'api-use') return null;
      }
      if (Object.hasOwn(c, 'extensionResource')) {
        const keys = ['techniqueId', 'phase', 'signalCodes', 'count', 'countQuality', 'firstBucket', 'lastBucket', 'extensionResource'];
        if (Reflect.ownKeys(c).length !== keys.length || keys.some(key => {
          const field = Object.getOwnPropertyDescriptor(c, key);
          return !field?.enumerable || !Object.hasOwn(field, 'value');
        })) return null;
        const resource = readExtensionResource(c.extensionResource);
        if (!resource || !extensionResourceAllows(resource, c.techniqueId, c.phase) ||
            !Array.isArray(c.signalCodes) || c.signalCodes.length !== 1 || c.signalCodes[0] !== 'api-use' ||
            !Number.isSafeInteger(c.count) || c.count < 0 || c.count > MAX_COUNT ||
            !['exact', 'sampled', 'lower-bound'].includes(c.countQuality) ||
            !Number.isSafeInteger(c.firstBucket) || !Number.isSafeInteger(c.lastBucket) || c.firstBucket < 0 || c.lastBucket < c.firstBucket || c.lastBucket > MAX_COUNT) return null;
      }
      const ck = counterKey(c.techniqueId, c.phase, c.signalCodes, c.apiOperation, c.extensionResource);
      if (slots.has(ck)) return null;
      slots.set(ck, String(i));
    }
  } catch { return null; }
  const boots: DocumentMeta['boots'] = [];
  for (const boot of meta['boots']) {
    if (!isRecord(boot) || typeof boot['sensorBootId'] !== 'string' || !isRecord(boot['counts'])) return null;
    const counts: Record<string, number> = {};
    for (const [key, count] of Object.entries(boot['counts'])) {
      const slot = meta['counterKeyFormat'] === 'index-v1' ? key : slots.get(key);
      if (slot === undefined || !/^(0|[1-9][0-9]*)$/.test(slot) || Number(slot) >= report['counters'].length ||
          typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > MAX_COUNT) return null;
      counts[slot] = count;
    }
    boots.push({ sensorBootId: boot['sensorBootId'], counts });
  }
  return { v: STORED_VERSION, report: { ...report, host: reportHost(report['host']), hosts: redactStoredHosts(report['hosts']) } as unknown as DocumentReport,
    meta: { ...meta, counterKeyFormat: 'index-v1', boots,
      ...(requestedLocalPorts === null ? {} : { requestedLocalPorts }),
      ...(responseHeaders === null ? {} : { responseHeaders }),
      networkCounters: typeof meta['networkCounterEpoch'] === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(meta['networkCounterEpoch']) ? readNetworkCounters(meta['networkCounters']) : [],
      networkCounterEpoch: typeof meta['networkCounterEpoch'] === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(meta['networkCounterEpoch']) ? meta['networkCounterEpoch'] : undefined } as unknown as DocumentMeta };
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

/** ADR-073: strict shape of one authoritative clear fence; only the allowed keys, bounded ids. */
function readClearFence(raw: unknown): ClearFence | null {
  if (!isRecord(raw) || Object.keys(raw).some(key => !['documentKey', 'bridgeSessionId', 'sensorBootIds', 'at', 'paused', 'reportRevision'].includes(key))) return null;
  const { documentKey, bridgeSessionId, sensorBootIds, at } = raw;
  if (typeof documentKey !== 'string' || documentKey.length < 1 || documentKey.length > 128 ||
      typeof bridgeSessionId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(bridgeSessionId) ||
      !Number.isSafeInteger(at) || (at as number) < 0 || !Array.isArray(sensorBootIds) || sensorBootIds.length > 4 ||
      sensorBootIds.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) || new Set(sensorBootIds).size !== sensorBootIds.length ||
      (raw['paused'] !== undefined && typeof raw['paused'] !== 'boolean') || !Number.isSafeInteger(raw['reportRevision']) ||
      (raw['reportRevision'] as number) < 0 || (raw['reportRevision'] as number) > MAX_COUNT) return null;
  return { documentKey, bridgeSessionId, sensorBootIds: [...sensorBootIds], at: at as number, reportRevision: raw['reportRevision'] as number,
    ...(raw['paused'] === undefined ? {} : { paused: raw['paused'] as boolean }) };
}

/** Exact UTF-8 bytes of the authoritative journal, counted against the 4 MiB session budget (ADR-073). */
function clearFenceBytes(fences: ReadonlyMap<string, ClearFence>): number {
  return new TextEncoder().encode(CLEAR_FENCES_KEY + JSON.stringify({ v: 1, documents: [...fences.values()] })).byteLength;
}

export class SessionRepository {
  /** Per-document serialized promise queue: one read-modify-write of a snapshot at a time (A10). */
  private readonly queues = new Map<string, Promise<void>>();
  private writes: Promise<unknown> = Promise.resolve();
  /** ADR-073: committed clear fences, authoritative over stored payload until the payload is removed. */
  private fences = new Map<string, ClearFence>();
  private fenceSize = 0;
  clearFence(documentKey: string): ClearFence | undefined { return this.fences.get(documentKey); }
  get clearFenceBytes(): number { return this.fenceSize; }

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

  /** Reserve all document queues before waiting, so a session clear has one atomic storage boundary. */
  runMany<T>(documentKeys: readonly string[], task: () => Promise<T>): Promise<T> {
    const keys = [...new Set(documentKeys)];
    const previous = keys.map((key) => this.queues.get(key) ?? Promise.resolve());
    const result = Promise.all(previous).then(task);
    const settled = result.then(() => undefined, () => undefined);
    for (const key of keys) this.queues.set(key, settled);
    void settled.then(() => {
      for (const key of keys) if (this.queues.get(key) === settled) this.queues.delete(key);
    });
    return result;
  }

  async loadAll(isCurrent: () => boolean = () => true): Promise<LoadResult> {
    // An unread authority is different from an absent one: cumulative ingress must wait for a valid read.
    const items = await this.storage.get(null);
    if (!isCurrent()) throw new Error('history-access-changed');
    const journal = items[CLEAR_FENCES_KEY];
    this.fences = new Map();
    this.fenceSize = 0;
    if (journal !== undefined) {
      if (!isRecord(journal) || journal['v'] !== 1 || !Array.isArray(journal['documents']) || journal['documents'].length > 1024) throw new Error('clear-journal');
      for (const value of journal['documents']) {
        const fence = readClearFence(value);
        if (fence === null || this.fences.has(fence.documentKey)) throw new Error('clear-journal');
        this.fences.set(fence.documentKey, fence);
      }
      this.fenceSize = clearFenceBytes(this.fences);
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
      else {
        // ADR-073: the committed fence is authoritative; a payload from a stale epoch is reset before exposure.
        const fence = this.fences.get(doc.report.documentKey);
        documents.push(fence !== undefined && doc.meta.clearEpoch !== fence.bridgeSessionId
          ? { v: 1, ...resetDocument(doc.report, doc.meta, fence) } : doc);
      }
    }
    // A successful clear removes payload keys. Rebuild hidden routing records from the trusted saved index.
    if (index !== null) for (const fence of this.fences.values()) {
      if (documents.some((doc) => doc.report.documentKey === fence.documentKey)) continue;
      const binding = index.bindings.find((entry) => entry.documentKey === fence.documentKey);
      if (binding !== undefined) documents.push({ v: 1, ...clearedFromBinding(binding, fence) });
    }
    if (discardedKeys.length > 0) await this.write(() => {
      if (!isCurrent()) throw new Error('history-access-changed');
      return this.storage.remove(discardedKeys);
    });
    // P01 migration must remove legacy literals from session, not only from the in-memory projection.
    const migrated: Record<string, unknown> = {};
    if (index !== null) migrated[INDEX_KEY] = redactedIndex(index);
    for (const doc of documents) migrated[DOC_KEY_PREFIX + doc.report.documentKey] = doc;
    if (Object.keys(migrated).length > 0) await this.write(() => {
      if (!isCurrent()) throw new Error('history-access-changed');
      return this.storage.set(migrated);
    });
    if (!isCurrent()) throw new Error('history-access-changed');
    return { index, documents, discarded };
  }

  /** Snapshot + watermark (+ index when dirty) in exactly one set() call. Never throws. */
  async commit(documentKey: string, record: StoredDocument, index: StoredIndex | null): Promise<CommitResult> {
    // F027: persisted receipt times need only second precision for lifecycle/TTL bookkeeping.
    const rounded = (at: number): number => Math.floor(at / 1000) * 1000;
    const stored: StoredDocument = { v: 1,
      report: { ...record.report, createdAt: rounded(record.report.createdAt), updatedAt: rounded(record.report.updatedAt),
        host: reportHost(record.report.host), hosts: redactStoredHosts(record.report.hosts) },
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

  /** Atomic all-or-fail replacement (used by session clear); records contain no cleared report payload. */
  async commitMany(records: readonly (readonly [string, StoredDocument])[], index: StoredIndex | null): Promise<CommitResult> {
    const rounded = (at: number): number => Math.floor(at / 1000) * 1000;
    const items: Record<string, unknown> = {};
    for (const [documentKey, record] of records) {
      const stored: StoredDocument = { v: 1,
        report: { ...record.report, createdAt: rounded(record.report.createdAt), updatedAt: rounded(record.report.updatedAt),
          host: reportHost(record.report.host), hosts: redactStoredHosts(record.report.hosts) },
        meta: { ...record.meta, lastActivityAt: rounded(record.meta.lastActivityAt),
          firstObservationAt: record.meta.firstObservationAt === null ? null : rounded(record.meta.firstObservationAt) },
      };
      items[DOC_KEY_PREFIX + documentKey] = stored;
    }
    if (index !== null) items[INDEX_KEY] = redactedIndex(index);
    try {
      await this.write(() => this.storage.set(items));
      return { ok: true };
    } catch (e) {
      return { ok: false, failure: isQuotaError(e) ? 'quota' : 'storage' };
    }
  }

  /**
   * ADR-073: one authoritative `clear-epochs:v1` item is the logical all-document clear commit; payload
   * cleanup is a separate step. A rejected write is read back before deciding its outcome (no assumption of
   * multi-key atomicity). `committed:false` leaves the old visible state intact (no false clear success).
   */
  async commitClear(fences: readonly ClearFence[], estimatedSessionBytes = 0): Promise<{ committed: boolean; cleaned: boolean }> {
    return this.write(async () => {
      const next = new Map(this.fences);
      for (const fence of fences) { if (readClearFence(fence) === null) throw new Error('clear-fence'); next.set(fence.documentKey, fence); }
      if (next.size > 1024) throw new Error('clear-fence-budget');
      const nextBytes = clearFenceBytes(next);
      const usage = await this.bytesInUse();
      // Reserve authority bytes while the old payload still exists; never rely solely on the entry-count cap.
      if ((usage ?? estimatedSessionBytes) - this.fenceSize + nextBytes > BUDGETS.maxSessionTotalBytes) return { committed: false, cleaned: false };
      try { await this.storage.set({ [CLEAR_FENCES_KEY]: { v: 1, documents: [...next.values()] } }); }
      catch {
        // A rejected write may have committed. Read back this single authority before deciding its outcome.
        try {
          const actual = (await this.storage.get(CLEAR_FENCES_KEY))[CLEAR_FENCES_KEY];
          if (!isRecord(actual) || JSON.stringify(actual) !== JSON.stringify({ v: 1, documents: [...next.values()] })) return { committed: false, cleaned: false };
        } catch { return { committed: false, cleaned: false }; }
      }
      this.fences = next;
      this.fenceSize = nextBytes;
      try { await this.storage.remove(fences.map((fence) => DOC_KEY_PREFIX + fence.documentKey)); return { committed: true, cleaned: true }; }
      catch { return { committed: true, cleaned: false }; }
    });
  }

  async remove(documentKeys: readonly string[], forgetFences = true): Promise<boolean> {
    if (documentKeys.length === 0) return true;
    try {
      await this.write(async () => {
        await this.storage.remove(documentKeys.map((k) => DOC_KEY_PREFIX + k));
        // TTL / tab-close removes a fence only after its payload is gone (ADR-073).
        if (forgetFences && documentKeys.some((key) => this.fences.has(key))) {
          const next = new Map(this.fences);
          for (const key of documentKeys) next.delete(key);
          await this.storage.set({ [CLEAR_FENCES_KEY]: { v: 1, documents: [...next.values()] } });
          this.fences = next;
          this.fenceSize = clearFenceBytes(next);
        }
      });
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

  async clearAll(keepKeys: readonly string[] = []): Promise<boolean> {
    try {
      await Promise.all([...this.queues.values()]);
      await this.write(async () => {
        if (keepKeys.length === 0) await this.storage.clear();
        else {
          const items = await this.storage.get(null);
          const remove = Object.keys(items).filter(key => !keepKeys.includes(key));
          if (remove.length > 0) await this.storage.remove(remove);
        }
      });
      // The authoritative journal was removed unless explicitly retained: drop the in-memory fences too.
      if (keepKeys.length === 0 || !keepKeys.includes(CLEAR_FENCES_KEY)) { this.fences = new Map(); this.fenceSize = 0; }
      return true;
    } catch {
      return false;
    }
  }
}
