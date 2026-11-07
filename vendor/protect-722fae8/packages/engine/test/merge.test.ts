import { describe, expect, it } from 'vitest';
import { BUDGETS, MAX_COUNT, TECHNIQUE_IDS, PHASES } from '@detect-expert/contracts';
import { mergeObservations, isDuplicateBatch, unionCoverageFlags } from '../src/index';
import { batch, counter, obs, report } from './fixtures';

function deepFreeze<T>(v: T): T {
  if (typeof v === 'object' && v !== null) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}

describe('mergeObservations (E05, ADR-005 §4)', () => {
  it('adds a new counter key with buckets and bumps the revision', () => {
    const r = deepFreeze(report());
    const b = deepFreeze(batch({ observations: [obs({ count: 3, intervalBucket: 9 })] }));
    const m = mergeObservations(r, b, { now: 42 });
    expect(m.changed).toBe(true);
    expect(m.duplicate).toBe(false);
    expect(m.applied).toBe(1);
    expect(m.report.counters).toEqual([
      counter({ techniqueId: 'DET-002', count: 3, firstBucket: 9, lastBucket: 9 }),
    ]);
    expect(m.report.revision).toBe(1);
    expect(m.report.updatedAt).toBe(42);
    expect(m.report.watermark).toEqual({ bridgeSessionId: 'bridge-1', lastCommittedBatchSeq: 1 });
    // purity: the frozen inputs were not touched
    expect(r.counters).toEqual([]);
    expect(r.revision).toBe(0);
  });

  it('ADR-017: the operation code is part of the key; absent stays absent', () => {
    const m1 = mergeObservations(report(), batch({ batchSeq: 1, observations: [
      obs({ techniqueId: 'DET-029', operationCode: 'width', count: 2 }),
      obs({ techniqueId: 'DET-029', operationCode: 'height', count: 1 }),
      obs({ techniqueId: 'DET-029', count: 3 }),
    ] }));
    expect(m1.report.counters.map((c) => [c.operationCode, c.count])).toEqual([['width', 2], ['height', 1], [undefined, 3]]);
    expect(Object.prototype.hasOwnProperty.call(m1.report.counters[2], 'operationCode')).toBe(false);
    const m2 = mergeObservations(m1.report, batch({ batchSeq: 2, observations: [obs({ techniqueId: 'DET-029', operationCode: 'width', count: 7 })] }));
    expect(m2.report.counters).toHaveLength(3);
    expect(m2.report.counters[0]).toMatchObject({ operationCode: 'width', count: 7 });
    expect(m2.report.counters[2]?.count).toBe(3);
  });

  it('merges cumulative totals with max, never sum; a lower redelivered total is a no-op', () => {
    const r0 = report();
    const m1 = mergeObservations(r0, batch({ batchSeq: 1, observations: [obs({ count: 5, intervalBucket: 2 })] }));
    const m2 = mergeObservations(m1.report, batch({ batchSeq: 2, observations: [obs({ count: 8, intervalBucket: 4 })] }));
    expect(m2.report.counters[0]?.count).toBe(8);
    expect(m2.report.counters[0]?.firstBucket).toBe(2);
    expect(m2.report.counters[0]?.lastBucket).toBe(4);
    expect(m2.report.revision).toBe(2);
    // a later batch carrying a smaller cumulative value (stale) changes nothing
    const m3 = mergeObservations(m2.report, batch({ batchSeq: 3, observations: [obs({ count: 6, intervalBucket: 3 })] }));
    expect(m3.changed).toBe(false);
    expect(m3.report.counters[0]?.count).toBe(8);
    expect(m3.report.revision).toBe(2);
    expect(m3.report.watermark?.lastCommittedBatchSeq).toBe(3);
  });

  it('is idempotent and order-independent for batches that are not deduplicated', () => {
    // Two bridge sessions so that neither batch falls under the other's watermark.
    const a = batch({ bridgeSessionId: 'bridge-a', batchSeq: 1, observations: [obs({ count: 2, intervalBucket: 1 })] });
    const b = batch({ bridgeSessionId: 'bridge-b', batchSeq: 1, observations: [obs({ count: 7, intervalBucket: 5 })] });
    const ab = mergeObservations(mergeObservations(report(), a).report, b).report;
    const ba = mergeObservations(mergeObservations(report(), b).report, a).report;
    expect(ab.counters).toEqual(ba.counters);
    expect(ab.counters[0]).toEqual(counter({ techniqueId: 'DET-002', count: 7, firstBucket: 1, lastBucket: 5 }));
    // Inside one session a lower batchSeq after a higher one is a duplicate by contract (ADR-005 §4).
    const early = batch({ batchSeq: 1, observations: [obs({ count: 2, intervalBucket: 1 })] });
    const lateFirst = mergeObservations(report(), batch({ batchSeq: 2, observations: [obs({ count: 7, intervalBucket: 5 })] })).report;
    expect(mergeObservations(lateFirst, early).duplicate).toBe(true);
  });

  it('treats an already committed (documentKey, bridgeSessionId, batchSeq) as a duplicate no-op', () => {
    const r = mergeObservations(report(), batch({ batchSeq: 4, observations: [obs({ count: 1 })] })).report;
    const dup = batch({ batchSeq: 4, observations: [obs({ count: 99 })] });
    expect(isDuplicateBatch(r, dup)).toBe(true);
    const m = mergeObservations(r, dup);
    expect(m.duplicate).toBe(true);
    expect(m.report).toBe(r);
    // a new bridge session restarts the sequence space
    const other = batch({ bridgeSessionId: 'bridge-2', batchSeq: 1, observations: [obs({ count: 1 })] });
    expect(isDuplicateBatch(r, other)).toBe(false);
    expect(mergeObservations(r, other).report.watermark).toEqual({ bridgeSessionId: 'bridge-2', lastCommittedBatchSeq: 1 });
  });

  it('normalizes signalCodes order so the counter key is stable', () => {
    const m1 = mergeObservations(report(), batch({ batchSeq: 1, observations: [obs({ count: 1, signalCodes: ['readback-after-text', 'api-use'] })] }));
    const m2 = mergeObservations(m1.report, batch({ batchSeq: 2, observations: [obs({ count: 2, signalCodes: ['api-use', 'readback-after-text'] })] }));
    expect(m2.report.counters).toHaveLength(1);
    expect(m2.report.counters[0]?.signalCodes).toEqual(['api-use', 'readback-after-text']);
    expect(m2.report.counters[0]?.count).toBe(2);
  });

  it('keeps the worst count quality', () => {
    const m1 = mergeObservations(report(), batch({ batchSeq: 1, observations: [obs({ count: 1 })] }));
    const m2 = mergeObservations(m1.report, batch({ batchSeq: 2, observations: [obs({ count: 1, countQuality: 'lower-bound' })] }));
    expect(m2.report.counters[0]?.countQuality).toBe('lower-bound');
    const m3 = mergeObservations(m2.report, batch({ batchSeq: 3, observations: [obs({ count: 1, countQuality: 'exact' })] }));
    expect(m3.report.counters[0]?.countQuality).toBe('lower-bound');
  });

  it('caps counters at 128 keys, counts the rejects and raises budget-exceeded', () => {
    // 128 distinct keys: 69 techniques x phases, taken in order
    const keys: Array<{ t: (typeof TECHNIQUE_IDS)[number]; p: (typeof PHASES)[number] }> = [];
    for (const p of PHASES) for (const t of TECHNIQUE_IDS) if (keys.length < BUDGETS.maxCountersPerDocumentGroup) keys.push({ t, p });
    let r = report();
    let seq = 1;
    for (let i = 0; i < keys.length; i += 32) {
      const slice = keys.slice(i, i + 32).map((k) => obs({ techniqueId: k.t, phase: k.p, count: 1 }));
      r = mergeObservations(r, batch({ batchSeq: seq++, observations: slice })).report;
    }
    expect(r.counters).toHaveLength(BUDGETS.maxCountersPerDocumentGroup);
    expect(r.dropped.counters).toBe(0);
    const extra = mergeObservations(r, batch({ batchSeq: seq, observations: [obs({ techniqueId: 'DET-069', phase: 'settlement-unobserved', count: 1 }), obs({ techniqueId: 'DET-001', count: 5 })] }));
    expect(extra.rejected).toBe(1);
    expect(extra.applied).toBe(1); // the existing DET-001 key still advances
    expect(extra.report.counters).toHaveLength(BUDGETS.maxCountersPerDocumentGroup);
    expect(extra.report.dropped.counters).toBe(1);
    expect(extra.report.coverageFlags).toContain('budget-exceeded');
  });

  it('saturates dropped counters at MAX_COUNT', () => {
    let r = report({ dropped: { observations: 0, batches: 0, findings: 0, hosts: 0, counters: MAX_COUNT, transport: 0 } });
    const many = Array.from({ length: BUDGETS.maxCountersPerDocumentGroup }, (_, i) => counter({ techniqueId: TECHNIQUE_IDS[i % TECHNIQUE_IDS.length] ?? 'DET-001', phase: PHASES[Math.floor(i / TECHNIQUE_IDS.length)] ?? 'attempted', count: 1 }));
    r = { ...r, counters: many };
    const m = mergeObservations(r, batch({ observations: [obs({ techniqueId: 'DET-069', phase: 'settlement-unobserved' })] }));
    expect(m.report.dropped.counters).toBe(MAX_COUNT);
  });

  it('unions coverage flags in canonical order without duplicates', () => {
    const r = report({ coverageFlags: ['hook-failed'] });
    const m = mergeObservations(r, batch({ coverageDelta: ['late-start', 'hook-failed', 'truncated'] }));
    expect(m.report.coverageFlags).toEqual(['late-start', 'hook-failed', 'truncated']);
    expect(unionCoverageFlags(['truncated'], ['late-start'], ['truncated'])).toEqual(['late-start', 'truncated']);
  });

  it('marks a batchSeq jump as an explicit channel-gap with the number of missing batches', () => {
    const m1 = mergeObservations(report(), batch({ batchSeq: 1 }));
    expect(m1.report.coverageFlags).not.toContain('channel-gap');
    const m2 = mergeObservations(m1.report, batch({ batchSeq: 4, observations: [obs({ count: 2 })] }));
    expect(m2.report.coverageFlags).toContain('channel-gap');
    expect(m2.report.dropped.batches).toBe(2);
    // first batch of a session starting above 1 is also a gap
    const m3 = mergeObservations(report(), batch({ batchSeq: 3 }));
    expect(m3.report.coverageFlags).toContain('channel-gap');
    expect(m3.report.dropped.batches).toBe(2);
  });

  it('a flags-only batch (no counter change) still bumps the revision when flags change', () => {
    const r = mergeObservations(report(), batch({ batchSeq: 1, observations: [obs({ count: 1 })] })).report;
    const m = mergeObservations(r, batch({ batchSeq: 2, observations: [obs({ count: 1 })], coverageDelta: ['throttled'] }));
    expect(m.changed).toBe(true);
    expect(m.applied).toBe(0);
    expect(m.report.revision).toBe(r.revision + 1);
  });
});
