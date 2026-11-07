// E05 reducer helper: merge a validated PageBatch into a DocumentReport (REQ-009, REQ-011, ADR-004 §7, ADR-005 §4).
// Pure: never mutates the input, no clock (pass `now`), no chrome.*.
//
// Semantics:
// - Counters are cumulative per key (techniqueId | phase | sorted signalCodes): the sensor sends running totals,
//   so merging takes the MAX of the stored and incoming count, never the sum. Redelivery cannot double-count and
//   the merge is idempotent and order-independent.
// - Duplicate batch = same bridgeSessionId and batchSeq <= watermark.lastCommittedBatchSeq -> no-op.
// - A batchSeq jump (n+2 after n) is a known loss of batches: 'channel-gap' is raised and dropped.batches counts
//   the missing sequence numbers. Cumulative counters make the counts themselves survive the gap.
// - At most BUDGETS.maxCountersPerDocumentGroup keys: new keys beyond the cap are dropped (dropped.counters++) and
//   'budget-exceeded' is raised. CounterEntry.techniqueId is an enum, so there is no "other" bucket to fold into.
// Known limitation: CounterEntry carries no sensorBootId namespace. A sensor reboot inside the same document
// (counters restarting at 0) would be masked by max-merge until the new totals exceed the old ones. In slice 1
// a reboot never happens without a new documentId (reinstall is suppressed by the sensor), so this is documented
// rather than handled.

import {
  BUDGETS,
  COVERAGE_FLAGS,
  MAX_COUNT,
  counterKey,
  type CounterEntry,
  type CoverageFlag,
  type DocumentReport,
  type DroppedCounters,
  type PageBatch,
  type SignalCode,
} from '@detect-expert/contracts';
import { sameStrings, satAdd, sortByEnumOrder, worstQuality } from './arith';

export interface MergeOptions {
  /** SW receipt time (ms epoch) written to updatedAt when the report changes. Omitted = updatedAt unchanged. */
  now?: number;
}

export interface MergeResult {
  /** The merged report (the same object as the input for a duplicate batch). */
  report: DocumentReport;
  /** Counters, flags or dropped counters changed (revision was bumped). */
  changed: boolean;
  /** The batch was already committed for this bridge session: nothing was applied. */
  duplicate: boolean;
  /** Observations applied (new key, or an existing key advanced). */
  applied: number;
  /** Observations rejected by the counter cap. */
  rejected: number;
}

/** True when the batch was already committed under the report's watermark. */
export function isDuplicateBatch(report: DocumentReport, batch: PageBatch): boolean {
  const w = report.watermark;
  return w !== null && w.bridgeSessionId === batch.bridgeSessionId && batch.batchSeq <= w.lastCommittedBatchSeq;
}

/** Union of coverage flags in canonical order. */
export function unionCoverageFlags(...lists: ReadonlyArray<readonly CoverageFlag[]>): CoverageFlag[] {
  const all: CoverageFlag[] = [];
  for (const list of lists) for (const f of list) all.push(f);
  return sortByEnumOrder(all, COVERAGE_FLAGS);
}

function normalizedSignalCodes(codes: readonly SignalCode[]): SignalCode[] {
  return [...new Set(codes)].sort();
}

export function mergeObservations(report: DocumentReport, batch: PageBatch, opts: MergeOptions = {}): MergeResult {
  if (isDuplicateBatch(report, batch)) {
    return { report, changed: false, duplicate: true, applied: 0, rejected: 0 };
  }

  const counters: CounterEntry[] = report.counters.slice();
  const index = new Map<string, number>();
  for (let i = 0; i < counters.length; i++) {
    const c = counters[i];
    if (c !== undefined) index.set(counterKey(c.techniqueId, c.phase, c.signalCodes, c.apiOperation, c.extensionResource), i);
  }

  let countersChanged = false;
  let applied = 0;
  let rejected = 0;
  const raised: CoverageFlag[] = [];

  for (const obs of batch.observations) {
    const signalCodes = normalizedSignalCodes(obs.signalCodes);
    const key = counterKey(obs.techniqueId, obs.phase, signalCodes, obs.apiOperation, obs.extensionResource);
    const at = index.get(key);
    if (at !== undefined) {
      const existing = counters[at];
      if (existing === undefined) continue;
      const count = Math.max(existing.count, obs.count);
      const countQuality = worstQuality(existing.countQuality, obs.countQuality);
      const firstBucket = Math.min(existing.firstBucket, obs.intervalBucket);
      const lastBucket = Math.max(existing.lastBucket, obs.intervalBucket);
      if (
        count === existing.count &&
        countQuality === existing.countQuality &&
        firstBucket === existing.firstBucket &&
        lastBucket === existing.lastBucket
      ) {
        continue;
      }
      counters[at] = { ...existing, count, countQuality, firstBucket, lastBucket };
      countersChanged = true;
      applied++;
      continue;
    }
    if (counters.length >= BUDGETS.maxCountersPerDocumentGroup) {
      rejected++;
      continue;
    }
    index.set(key, counters.length);
    counters.push({
      techniqueId: obs.techniqueId,
      ...(obs.apiOperation === undefined ? {} : { apiOperation: obs.apiOperation }),
      ...(obs.extensionResource === undefined ? {} : { extensionResource: { ...obs.extensionResource } }),
      phase: obs.phase,
      signalCodes,
      count: obs.count,
      countQuality: obs.countQuality,
      firstBucket: obs.intervalBucket,
      lastBucket: obs.intervalBucket,
    });
    countersChanged = true;
    applied++;
  }

  // Sequence accounting: a jump means batches were lost between the last commit and this one.
  const w = report.watermark;
  const sameSession = w !== null && w.bridgeSessionId === batch.bridgeSessionId;
  const missing = sameSession && w !== null ? batch.batchSeq - w.lastCommittedBatchSeq - 1 : batch.batchSeq - 1;
  if (missing > 0) raised.push('channel-gap');
  if (rejected > 0) raised.push('budget-exceeded');

  const dropped: DroppedCounters = {
    ...report.dropped,
    counters: satAdd(report.dropped.counters, rejected),
    batches: satAdd(report.dropped.batches, missing > 0 ? Math.min(missing, MAX_COUNT) : 0),
  };
  const droppedChanged = dropped.counters !== report.dropped.counters || dropped.batches !== report.dropped.batches;

  const coverageFlags = unionCoverageFlags(report.coverageFlags, batch.coverageDelta, raised);
  const flagsChanged = !sameStrings(coverageFlags, report.coverageFlags);

  const watermark = {
    bridgeSessionId: batch.bridgeSessionId,
    lastCommittedBatchSeq:
      sameSession && w !== null ? Math.max(w.lastCommittedBatchSeq, batch.batchSeq) : batch.batchSeq,
  };

  const changed = countersChanged || flagsChanged || droppedChanged;
  const next: DocumentReport = {
    ...report,
    counters: countersChanged ? counters : report.counters,
    coverageFlags: flagsChanged ? coverageFlags : report.coverageFlags,
    dropped: droppedChanged ? dropped : report.dropped,
    watermark,
    revision: changed ? satAdd(report.revision, 1) : report.revision,
    updatedAt: changed && opts.now !== undefined ? opts.now : report.updatedAt,
  };
  return { report: next, changed, duplicate: false, applied, rejected };
}
