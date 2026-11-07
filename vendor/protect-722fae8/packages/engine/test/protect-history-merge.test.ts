// ADR-020 §G (S12): history merges are commutative, associative and idempotent (property tests over seeded random
// deltas), bounded (rule ids ≤ 8), deterministic (canonical family order) and keep the strongest interpretation.

import { describe, expect, it } from 'vitest';
import { HISTORY_FAMILIES, INTERPRETATIONS, PROTECT_BUDGETS } from '@detect-expert/contracts';
import type { HistoryFamily, Interpretation } from '@detect-expert/contracts';
import { daysIn } from '../src/protect/history/day-mask';
import {
  applyReceiverDay,
  applySightingDelta,
  applySiteDelta,
  boundedUnion,
  maxInterpretation,
  mergeSightingDeltas,
  mergeSightingRecords,
  mergeSiteRecords,
  retainSighting,
  retainSite,
} from '../src/protect/history/merge';
import { HISTORY_SIGNAL_BITS, parseSightingRecord, parseSiteRecord } from '../src/protect/history/records';
import type { HistorySightingDelta, HistorySightingRecord, HistorySiteRecord } from '../src/protect/history/records';

const D = 20_000;

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomDelta(r: () => number): HistorySightingDelta {
  const d: HistorySightingDelta = { receiver: 'tracker.example', site: 'shop.example', day: D - Math.floor(r() * 100), signals: 1 + Math.floor(r() * 31) };
  if (r() < 0.5) {
    const families: Partial<Record<HistoryFamily, Interpretation>> = {};
    for (const f of HISTORY_FAMILIES) if (r() < 0.3) families[f] = INTERPRETATIONS[Math.floor(r() * INTERPRETATIONS.length)]!;
    d.families = families;
  }
  if (r() < 0.4) d.ruleIds = Array.from({ length: 1 + Math.floor(r() * 6) }, () => 'rule-' + String(Math.floor(r() * 20)));
  if (r() < 0.3) d.valueStrength = r() < 0.5 ? 'hash' : 'plain';
  return d;
}

function recordOf(deltas: HistorySightingDelta[]): HistorySightingRecord {
  let rec: HistorySightingRecord | undefined;
  for (const d of deltas) rec = applySightingDelta(rec, d);
  return rec!;
}

describe('history merge', () => {
  it('merging records is commutative and idempotent (500 random cases, days across the 90-day edge)', () => {
    const r = rng(12_012);
    for (let i = 0; i < 500; i++) {
      const a = recordOf(Array.from({ length: 1 + Math.floor(r() * 5) }, () => randomDelta(r)));
      const b = recordOf(Array.from({ length: 1 + Math.floor(r() * 5) }, () => randomDelta(r)));
      const ab = mergeSightingRecords(a, b);
      expect(mergeSightingRecords(b, a)).toEqual(ab);
      expect(mergeSightingRecords(ab, ab)).toEqual(ab);
      expect(ab.ruleIds.length).toBeLessThanOrEqual(PROTECT_BUDGETS.maxRuleIdsPerSighting);
      expect(Object.keys(ab.families)).toEqual(HISTORY_FAMILIES.filter((f) => ab.families[f] !== undefined));
      expect(parseSightingRecord(structuredClone(ab))).toEqual(ab);
    }
  });

  it('merging is also associative while every day stays within one 90-day span (300 random cases)', () => {
    // Interpretations are kept per family, not per day: once a family's old days fall out of the span, the order of
    // merges may decide whether their interpretation still counts. Within one span every order agrees.
    const r = rng(4242);
    const inSpan = (): HistorySightingDelta => ({ ...randomDelta(r), day: D - Math.floor(r() * 90) });
    for (let i = 0; i < 300; i++) {
      const a = recordOf(Array.from({ length: 1 + Math.floor(r() * 5) }, inSpan));
      const b = recordOf(Array.from({ length: 1 + Math.floor(r() * 5) }, inSpan));
      const c = recordOf(Array.from({ length: 1 + Math.floor(r() * 5) }, inSpan));
      expect(mergeSightingRecords(mergeSightingRecords(a, b), c)).toEqual(mergeSightingRecords(a, mergeSightingRecords(b, c)));
    }
  });

  it('applying deltas in any order gives the same record (deltas within the 90-day span)', () => {
    const r = rng(7);
    for (let i = 0; i < 200; i++) {
      const deltas = Array.from({ length: 2 + Math.floor(r() * 8) }, () => ({ ...randomDelta(r), day: D - Math.floor(r() * 80) }));
      const forward = recordOf(deltas);
      const backward = recordOf([...deltas].reverse());
      // Same set of days and values; the anchor is the newest day in both orders.
      expect(mergeSightingRecords(forward, forward)).toEqual(mergeSightingRecords(backward, backward));
      // Applying the same delta twice changes nothing.
      expect(applySightingDelta(forward, deltas[0]!)).toEqual(applySightingDelta(applySightingDelta(forward, deltas[0]!), deltas[0]!));
    }
  });

  it('merging deltas is commutative and idempotent', () => {
    const r = rng(99);
    for (let i = 0; i < 300; i++) {
      const a = { ...randomDelta(r), day: D };
      const b = { ...randomDelta(r), day: D };
      expect(mergeSightingDeltas(a, b)).toEqual(mergeSightingDeltas(b, a));
      const ab = mergeSightingDeltas(a, b);
      expect(mergeSightingDeltas(ab, ab)).toEqual(ab);
    }
  });

  it('keeps the strongest interpretation and value strength; bounded sorted rule ids', () => {
    expect(maxInterpretation('api-use', 'fingerprinting-pattern')).toBe('fingerprinting-pattern');
    expect(maxInterpretation('fingerprinting-pattern', 'possible-fingerprinting')).toBe('fingerprinting-pattern');
    expect(maxInterpretation('unknown', 'api-use')).toBe('api-use');
    expect(boundedUnion(['z', 'b'], ['a', 'b'], 2)).toEqual(['a', 'b']);
    let rec = applySightingDelta(undefined, { receiver: 'cdn.example', site: 'a.example', day: D, signals: HISTORY_SIGNAL_BITS.frame, families: { canvas: 'api-use' } });
    rec = applySightingDelta(rec, { receiver: 'cdn.example', site: 'a.example', day: D, signals: HISTORY_SIGNAL_BITS.frame, families: { canvas: 'fingerprinting-pattern' }, valueStrength: 'plain' });
    rec = applySightingDelta(rec, { receiver: 'cdn.example', site: 'a.example', day: D - 1, signals: HISTORY_SIGNAL_BITS['value-match'], valueStrength: 'hash' });
    rec = applySightingDelta(rec, { receiver: 'cdn.example', site: 'a.example', day: D, signals: 1, ruleIds: ['r9', 'r1', 'r5', 'r2', 'r7', 'r3', 'r8', 'r4', 'r6'] });
    expect(rec.families.canvas?.interpretation).toBe('fingerprinting-pattern');
    expect(rec.families.canvas?.attributionConfidence).toBe('frame-only');
    expect(rec.strongestValueEncoding).toBe('hash');
    expect(rec.ruleIds).toEqual(['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8']);
    expect(daysIn(rec.valueMatch, rec.endDay, D - 1, D - 1)).toBe(1);
    expect(daysIn(rec.seen, rec.endDay, D - 1, D)).toBe(2);
    expect(rec.lastDay).toBe(D);
  });

  it('site records and receivers merge the same way', () => {
    let a: HistorySiteRecord | undefined;
    a = applySiteDelta(a, { site: 'a.example', day: D, limited: true, families: ['webgl', 'canvas'] });
    a = applySiteDelta(a, { site: 'a.example', day: D - 2, limited: false });
    const b = applySiteDelta(undefined, { site: 'a.example', day: D + 1, limited: false, families: ['audio'] });
    const ab = mergeSiteRecords(a, b);
    expect(mergeSiteRecords(b, a)).toEqual(ab);
    expect(Object.keys(ab.families)).toEqual(['canvas', 'webgl', 'audio']);
    expect(ab.lastDay).toBe(D + 1);
    expect(parseSiteRecord(structuredClone(ab))).toEqual(ab);
    const rr = applyReceiverDay(applyReceiverDay(undefined, 'cdn.example', D), 'cdn.example', D - 3);
    expect(rr.endDay).toBe(D);
    expect(daysIn(rr.seen, rr.endDay, D - 3, D)).toBe(2);
  });

  it('retention re-anchors to today, drops old days and empties to null', () => {
    const rec = recordOf([
      { receiver: 'cdn.example', site: 'a.example', day: D, signals: 1 },
      { receiver: 'cdn.example', site: 'a.example', day: D - 10, signals: HISTORY_SIGNAL_BITS['value-match'], valueStrength: 'hash' },
      { receiver: 'cdn.example', site: 'a.example', day: D - 40, signals: HISTORY_SIGNAL_BITS.frame, families: { canvas: 'api-use' } },
    ]);
    const kept = retainSighting(rec, D + 1, 30)!;
    expect(kept.endDay).toBe(D + 1);
    expect(kept.lastDay).toBe(D);
    expect(kept.families.canvas).toBeUndefined();
    expect(kept.strongestValueEncoding).toBe('hash');
    const short = retainSighting(rec, D + 1, 7)!;
    expect(short.strongestValueEncoding).toBeUndefined();
    expect(retainSighting(rec, D + 60, 30)).toBeNull();
    const site = applySiteDelta(undefined, { site: 'a.example', day: D - 20, limited: true, families: ['canvas'] });
    expect(retainSite(site, D, 7)).toBeNull();
    expect(retainSite(site, D, 30)?.families.canvas).toBeDefined();
  });
});
