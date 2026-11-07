// Bounded aggregate ring (spec A6, ADR-004 §7, REQ-011). One record per (sensorBootId, techniqueId, phase,
// signalCodes) holds the document's cumulative saturating total; the SW merges by max, so a retransmitted
// batch never double counts. A sensor-batch observation carries the sensor's CUMULATIVE total for that key
// (packages/sensors posts totals, not deltas), so a merge is a max, never a sum: a repeated or retransmitted
// sensor batch is idempotent here as well.
//
// BFCache restore re-keys later observations with the extra signal `bfcache-restore` (spec A7). The sensor keeps
// counting on its own key, so the re-keyed record stores a baseline (the total seen before the restore) and
// reports `total - baseline`; the pre-restore record stays frozen at its last total. Both go out under
// different signalCodes and the SW sums them per technique without double counting.
//
// Capacity is BUDGETS.maxBridgeRecordsPerDocument in LRU order: on overflow an acknowledged (clean) record is
// evicted first, otherwise the oldest unacknowledged one. A re-added key restarts from the sensor's total (the
// SW's max-merge heals a plain key) but a re-keyed record loses its baseline, so the caller still marks
// `bridge-ring-overflow` + `channel-gap` (explicit gap, never silent loss — REQ-009).

import { BUDGETS, MAX_COUNT, counterKey } from '@detect-expert/contracts';
import type { ApiOperation, ExtensionResource, CountQuality, PageObservation, Phase, SignalCode, TechniqueId } from '@detect-expert/contracts';

export interface AggregateRecord {
  /** Local insertion identity, never serialized (F037/F119). */
  identity: object;
  key: string;
  sensorBootId: string;
  techniqueId: TechniqueId;
  apiOperation?: ApiOperation;
  extensionResource?: ExtensionResource;
  phase: Phase;
  /** Sorted, unique (wire codes: sensor codes plus the optional extra signal). */
  signalCodes: SignalCode[];
  /** Reported total for the document, saturating at MAX_COUNT. */
  count: number;
  countQuality: CountQuality;
  /** Highest sensor bucket seen for this key (local ordering only). */
  intervalBucket: number;
  /** Highest cumulative total the sensor reported for the underlying sensor key. */
  sensorTotal: number;
  /** Sensor total subtracted from `sensorTotal` for a re-keyed (bfcache-restore) record; 0 otherwise. */
  baseline: number;
  /** Bumps on every change; the record is clean when ackedVersion === version. */
  version: number;
  ackedVersion: number;
}

export interface BatchEntry {
  identity: object;
  key: string;
  version: number;
  sensorBootId: string;
  observation: PageObservation;
}

export type AddOutcome = 'updated' | 'unchanged' | 'inserted' | 'evicted-clean' | 'evicted-dirty';

const QUALITY_RANK: Readonly<Record<CountQuality, number>> = { exact: 0, sampled: 1, 'lower-bound': 2 };

function sat(n: number): number {
  return n > MAX_COUNT ? MAX_COUNT : n < 0 ? 0 : n;
}

export class AggregateRing {
  /** Insertion order = LRU order (touched records are re-inserted at the end). */
  private readonly records = new Map<string, AggregateRecord>();
  /** Acknowledged keys in acknowledgement order. */
  private readonly cleanKeys = new Set<string>();
  private dirtyCount = 0;

  constructor(readonly capacity: number) {}

  get size(): number {
    return this.records.size;
  }

  /** Records whose latest total has not been acknowledged. */
  get dirty(): number {
    return this.dirtyCount;
  }

  /** ADR-073: drop every aggregate for a fresh reset epoch (no pre-reset total survives). */
  clear(): void {
    this.records.clear();
    this.cleanKeys.clear();
    this.dirtyCount = 0;
  }

  /**
   * Merges one normalized observation (cumulative per sensor key). `extraSignal` (bfcache-restore) re-keys the
   * record when it fits the signal budget; the re-keyed record reports the growth since the pre-restore total.
   */
  add(sensorBootId: string, obs: PageObservation, extraSignal: SignalCode | null): AddOutcome {
    const sensorCodes = [...obs.signalCodes].sort();
    const sensorKey = sensorBootId + '|' + counterKey(obs.techniqueId, obs.phase, sensorCodes, obs.apiOperation, obs.extensionResource);
    let codes = sensorCodes;
    let key = sensorKey;
    if (obs.apiOperation === undefined && obs.extensionResource === undefined && extraSignal !== null && !sensorCodes.includes(extraSignal) && sensorCodes.length < BUDGETS.maxSignalCodesPerObservation) {
      codes = [...sensorCodes, extraSignal].sort();
      key = sensorBootId + '|' + counterKey(obs.techniqueId, obs.phase, codes);
    }
    const existing = this.records.get(key);
    if (existing !== undefined) {
      let changed = false;
      if (obs.count > existing.sensorTotal) {
        existing.sensorTotal = obs.count;
        const total = sat(obs.count - existing.baseline);
        if (total > existing.count) {
          existing.count = total;
          changed = true;
        }
      }
      if (QUALITY_RANK[obs.countQuality] > QUALITY_RANK[existing.countQuality]) {
        existing.countQuality = obs.countQuality;
        changed = true;
      }
      if (obs.intervalBucket > existing.intervalBucket) {
        existing.intervalBucket = obs.intervalBucket;
        changed = true;
      }
      if (!changed) return 'unchanged';
      existing.version++;
      if (this.cleanKeys.delete(key)) this.dirtyCount++;
      this.records.delete(key);
      this.records.set(key, existing);
      return 'updated';
    }
    // A re-keyed record starts from the total the pre-restore record last saw (0 when it never existed).
    const baseline = key === sensorKey ? 0 : (this.records.get(sensorKey)?.sensorTotal ?? 0);
    let outcome: AddOutcome = 'inserted';
    if (this.records.size >= this.capacity) outcome = this.evictOne();
    this.records.set(key, {
      identity: {},
      key,
      sensorBootId,
      techniqueId: obs.techniqueId,
      ...(obs.apiOperation === undefined ? {} : { apiOperation: obs.apiOperation }),
      ...(obs.extensionResource === undefined ? {} : { extensionResource: { ...obs.extensionResource } }),
      phase: obs.phase,
      signalCodes: codes,
      count: sat(obs.count - baseline),
      countQuality: obs.countQuality,
      intervalBucket: obs.intervalBucket,
      sensorTotal: obs.count,
      baseline,
      version: 1,
      ackedVersion: 0,
    });
    this.dirtyCount++;
    return outcome;
  }

  private evictOne(): AddOutcome {
    const clean = this.cleanKeys.values().next().value;
    if (clean !== undefined) {
      this.cleanKeys.delete(clean);
      this.records.delete(clean);
      return 'evicted-clean';
    }
    const oldest = this.records.keys().next().value;
    if (oldest !== undefined) {
      this.records.delete(oldest);
      this.dirtyCount--;
    }
    return 'evicted-dirty';
  }

  /** Up to `max` dirty records of a single sensor boot (the boot of the least recently touched dirty record). */
  takeBatch(max: number): BatchEntry[] {
    const out: BatchEntry[] = [];
    let boot: string | null = null;
    for (const r of this.records.values()) {
      if (r.version === r.ackedVersion) continue;
      if (boot === null) boot = r.sensorBootId;
      else if (r.sensorBootId !== boot) continue;
      out.push({ identity: r.identity, key: r.key, version: r.version, sensorBootId: r.sensorBootId, observation: toObservation(r) });
      if (out.length >= max) break;
    }
    return out;
  }

  /** Marks entries clean unless they were updated after the batch was built. Returns how many became clean. */
  markAcked(entries: readonly BatchEntry[]): number {
    let cleaned = 0;
    for (const e of entries) {
      const r = this.records.get(e.key);
      if (r === undefined || r.identity !== e.identity || e.version > r.version) continue;
      if (r.ackedVersion < e.version) r.ackedVersion = e.version;
      if (r.version === r.ackedVersion && !this.cleanKeys.has(e.key)) {
        this.cleanKeys.add(e.key);
        this.dirtyCount--;
        cleaned++;
      }
    }
    return cleaned;
  }

  /** Resend one real cumulative snapshot to carry coverage without fabricating an observation (F033). */
  markCoverageDirty(): void {
    if (this.dirtyCount > 0) return;
    const key = this.cleanKeys.values().next().value;
    if (key === undefined) return;
    const record = this.records.get(key);
    if (record === undefined) return;
    record.version++;
    this.cleanKeys.delete(key);
    this.dirtyCount++;
  }

  /** BFCache restore: every record is resent as a snapshot (idempotent at the SW). */
  markAllDirty(): void {
    for (const key of this.cleanKeys) {
      const r = this.records.get(key);
      if (r !== undefined) r.version++;
    }
    this.dirtyCount += this.cleanKeys.size;
    this.cleanKeys.clear();
  }
}

function toObservation(r: AggregateRecord): PageObservation {
  return {
    techniqueId: r.techniqueId,
    ...(r.apiOperation === undefined ? {} : { apiOperation: r.apiOperation }),
    ...(r.extensionResource === undefined ? {} : { extensionResource: { ...r.extensionResource } }),
    count: r.count,
    countQuality: r.countQuality,
    phase: r.phase,
    signalCodes: [...r.signalCodes],
    intervalBucket: r.intervalBucket,
  };
}
