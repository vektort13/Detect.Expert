// S13 / E13-02: approximate activity timeline and card activity/document details (pure view models).
import { describe, expect, it } from 'vitest';
import { INTERVAL_BUCKET_MS, TECHNIQUE_IDS } from '@detect-expert/contracts';
import { buildCards } from '../src/view-models/cards';
import { MAX_TIMELINE_ROWS, activityMessage, bucketOffsetMessage, documentScopeKey, timelineRows, validBuckets } from '../src/view-models/timeline';
import { fallbackMessage } from '../src/i18n';
import { resolveMessage } from '../src/view-models/message';
import { finding, report, technique } from './fixtures';

const r = (m: Parameters<typeof resolveMessage>[1]) => resolveMessage(fallbackMessage, m);
const bucketsFor = (ms: number) => Math.floor(ms / INTERVAL_BUCKET_MS);

describe('bucketOffsetMessage (INTERVAL_BUCKET_MS = 250, rounded down)', () => {
  it('under a second, seconds, minutes, over a day', () => {
    expect(r(bucketOffsetMessage(0))).toBe('time_offset_under_second');
    expect(r(bucketOffsetMessage(3))).toBe('time_offset_under_second');
    expect(r(bucketOffsetMessage(4))).toBe('time_offset_seconds[1]');
    expect(r(bucketOffsetMessage(9))).toBe('time_offset_seconds[2]');
    expect(r(bucketOffsetMessage(bucketsFor(59_999)))).toBe('time_offset_seconds[59]');
    expect(r(bucketOffsetMessage(bucketsFor(60_000)))).toBe('time_offset_minutes[1]');
    expect(r(bucketOffsetMessage(bucketsFor(119_999)))).toBe('time_offset_minutes[1]');
    expect(r(bucketOffsetMessage(bucketsFor(86_400_000) - 1))).toBe('time_offset_minutes[1439]');
    expect(r(bucketOffsetMessage(bucketsFor(86_400_000)))).toBe('time_offset_over_day');
    expect(r(bucketOffsetMessage(2_147_483_647))).toBe('time_offset_over_day');
  });

  it('invalid input never throws and reads as under a second', () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(r(bucketOffsetMessage(bad))).toBe('time_offset_under_second');
  });

  it('activityMessage nests both offsets', () => {
    expect(r(activityMessage(2, 9))).toBe('detail_activity_value[time_offset_under_second, time_offset_seconds[2]]');
  });

  it('validBuckets: non-negative safe integers with first <= last', () => {
    expect(validBuckets(0, 0)).toBe(true);
    expect(validBuckets(2, 9)).toBe(true);
    for (const [a, b] of [[3, 2], [-1, 2], [1.5, 2], [1, Number.NaN], ['1', 2], [null, 1]] as const) expect(validBuckets(a, b)).toBe(false);
  });
});

describe('timelineRows', () => {
  const three = [
    technique({ techniqueId: 'DET-002', firstBucket: 2, lastBucket: 9 }),
    technique({ techniqueId: 'DET-001', firstBucket: 0, lastBucket: 1 }),
    technique({ techniqueId: 'DET-032', firstBucket: 40, lastBucket: 41 }),
  ];

  it('one row per page-hook technique, sorted by first bucket then id, bars on a 0…max(last) axis', () => {
    const rows = timelineRows(three);
    expect(rows.map((row) => [row.techniqueId, row.firstBucket, row.lastBucket])).toEqual([['DET-001', 0, 1], ['DET-002', 2, 9], ['DET-032', 40, 41]]);
    // axisMax 41: start floor(first / 41 * 1000) / 10, width max(0.5, floor((last - first) / 41 * 1000) / 10).
    expect(rows.map((row) => [row.startPct, row.widthPct])).toEqual([[0, 2.4], [4.8, 17], [97.5, 2.4]]);
    for (const row of rows) expect(row.startPct + row.widthPct).toBeLessThanOrEqual(100);
    expect(r(rows[1]!.label)).toBe('timeline_row[DET-002 CanvasRenderingContext2D.getImageData, time_offset_under_second, time_offset_seconds[2]]');
  });

  it('excludes browser-network summaries: their buckets are seconds from createdAt, a different scale', () => {
    const rows = timelineRows([
      ...three,
      technique({ techniqueId: 'DET-059', evidenceSource: 'browser-network', integrity: 'browser-observed', firstBucket: 0, lastBucket: 5000 }),
      technique({ techniqueId: 'DET-060', evidenceSource: 'browser-network', integrity: 'browser-observed', firstBucket: 1, lastBucket: 2 }),
      technique({ techniqueId: 'DET-025', evidenceSource: 'derived', integrity: 'derived', firstBucket: 1, lastBucket: 2 }),
    ]);
    expect(rows.map((row) => row.techniqueId)).toEqual(['DET-001', 'DET-002', 'DET-032']);
    // The network maximum does not stretch the axis either.
    expect(rows[2]!.startPct).toBe(97.5);
  });

  it('skips invalid bucket pairs; merges several summaries of one technique to min first / max last', () => {
    const rows = timelineRows([
      technique({ techniqueId: 'DET-001', firstBucket: 5, lastBucket: 3 }),
      technique({ techniqueId: 'DET-003', firstBucket: 1.5, lastBucket: 3 }),
      technique({ techniqueId: 'DET-004', firstBucket: -1, lastBucket: 3 }),
      technique({ techniqueId: 'DET-002', firstBucket: 4, lastBucket: 6 }),
      technique({ techniqueId: 'DET-002', firstBucket: 2, lastBucket: 5 }),
    ]);
    expect(rows.map((row) => [row.techniqueId, row.firstBucket, row.lastBucket])).toEqual([['DET-002', 2, 6]]);
  });

  it('degenerate axes: everything at bucket 0, and a point at the axis end, stay inside 0…100 with width >= 0.5', () => {
    const zero = timelineRows([technique({ techniqueId: 'DET-001', firstBucket: 0, lastBucket: 0 })]);
    expect(zero.map((row) => [row.startPct, row.widthPct])).toEqual([[0, 0.5]]);
    const end = timelineRows([technique({ techniqueId: 'DET-001', firstBucket: 0, lastBucket: 10 }), technique({ techniqueId: 'DET-002', firstBucket: 10, lastBucket: 10 })]);
    expect(end.map((row) => [row.techniqueId, row.startPct, row.widthPct])).toEqual([['DET-001', 0, 100], ['DET-002', 99.5, 0.5]]);
  });

  it('include limits rows to the shown techniques; empty include gives no rows', () => {
    expect(timelineRows(three, new Set(['DET-032'])).map((row) => row.techniqueId)).toEqual(['DET-032']);
    expect(timelineRows(three, new Set())).toEqual([]);
    expect(timelineRows([])).toEqual([]);
  });

  it('never more than one row per registry technique', () => {
    const many = TECHNIQUE_IDS.flatMap((techniqueId, i) => [technique({ techniqueId, firstBucket: i, lastBucket: i + 1 }), technique({ techniqueId, firstBucket: i, lastBucket: i + 2 })]);
    const rows = timelineRows(many);
    expect(MAX_TIMELINE_ROWS).toBe(69);
    expect(rows).toHaveLength(69);
    expect(new Set(rows.map((row) => row.techniqueId)).size).toBe(69);
  });
});

describe('card details (S13)', () => {
  it('page-hook cards carry their buckets, sorted signal codes, the interpretation axes and the document key', () => {
    const [card] = buildCards(report({
      techniques: [technique({ techniqueId: 'DET-002', firstBucket: 2, lastBucket: 9, signalCodes: ['readback-after-text', 'api-use', 'readback-after-text'] })],
      findings: [finding({ findingId: 'fp', techniqueId: 'DET-002', interpretation: 'fingerprinting-pattern', interpretationConfidence: 'low' })],
    }));
    expect(card).toMatchObject({ firstBucket: 2, lastBucket: 9, signalCodes: ['api-use', 'readback-after-text'], interpretationKind: 'fingerprinting-pattern', confidenceLevel: 'low', documentKey: '12:0:doc-a', kind: 'possible-fingerprinting' });
  });

  it('browser-network cards and findings without a summary have no buckets', () => {
    const cards = buildCards(report({
      techniques: [technique({ techniqueId: 'DET-059', evidenceSource: 'browser-network', integrity: 'browser-observed', firstBucket: 3, lastBucket: 8 })],
      findings: [finding({ findingId: 'lonely', techniqueId: 'DET-039' })],
    }));
    const network = cards.find((card) => card.techniqueId === 'DET-059')!;
    const lonely = cards.find((card) => card.techniqueId === 'DET-039')!;
    expect([network.firstBucket, network.lastBucket]).toEqual([null, null]);
    expect([lonely.firstBucket, lonely.lastBucket, lonely.signalCodes]).toEqual([null, null, []]);
  });

  it('documentScopeKey: frame 0 is the main document; any other key has no row', () => {
    expect(documentScopeKey('12:0:doc-a')).toBe('detail_document_top');
    expect(documentScopeKey('12:3:doc-a')).toBeNull();
    expect(documentScopeKey('12:00:doc-a')).toBeNull();
    expect(documentScopeKey('garbage')).toBeNull();
  });
});
