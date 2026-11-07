import { describe, expect, it } from 'vitest';
import { MAX_COUNT, SIGNAL_CODES } from '@detect-expert/contracts';
import type { SignalCode } from '@detect-expert/contracts';
import { AggregateRing } from '../src/index';
import { obs } from './fake-env';

describe('AggregateRing', () => {
  it.each([1, 3])('ignores an evicted insertion ACK at old version %s, including equal-version replacements (F037/F119)', (oldVersion) => {
    const ring = new AggregateRing(1);
    for (let count = 1; count <= oldVersion; count++) ring.add('b', obs({ count }), null);
    const old = ring.takeBatch(1);
    ring.add('other', obs(), null);
    ring.add('b', obs({ count: 10 }), null);
    expect(ring.markAcked(old)).toBe(0);
    expect(ring.dirty).toBe(1);
    for (let i = 1; i < oldVersion; i++) ring.add('b', obs({ count: 10 + i }), null);
    expect(ring.markAcked(old)).toBe(0);
    expect(ring.dirty).toBe(1);
    const latest = ring.takeBatch(1);
    expect(latest[0]?.observation.count).toBe(9 + oldVersion);
    expect(ring.markAcked(latest)).toBe(1);
    expect(ring.dirty).toBe(0);
    expect(ring.takeBatch(1)).toEqual([]);
  });

  it('merges cumulative sensor totals by max (never sums) and saturates', () => {
    const ring = new AggregateRing(8);
    expect(ring.add('b', obs({ count: 2 }), null)).toBe('inserted');
    expect(ring.add('b', obs({ count: 5, intervalBucket: 9 }), null)).toBe('updated');
    expect(ring.size).toBe(1);
    const [entry] = ring.takeBatch(32);
    expect(entry?.observation).toMatchObject({ count: 5, intervalBucket: 9, countQuality: 'exact' });
    // A retransmitted or stale sensor total changes nothing and does not dirty the record again.
    ring.markAcked(ring.takeBatch(32));
    expect(ring.add('b', obs({ count: 5, intervalBucket: 9 }), null)).toBe('unchanged');
    expect(ring.add('b', obs({ count: 3, intervalBucket: 4 }), null)).toBe('unchanged');
    expect(ring.dirty).toBe(0);
    ring.add('b', obs({ count: MAX_COUNT }), null);
    expect(ring.takeBatch(32)[0]?.observation.count).toBe(MAX_COUNT);
  });

  it('degrades countQuality to the worst contribution and sorts signal codes', () => {
    const ring = new AggregateRing(8);
    ring.add('b', obs({ signalCodes: ['offline-render', 'api-use'], countQuality: 'exact' }), null);
    ring.add('b', obs({ signalCodes: ['api-use', 'offline-render'], countQuality: 'lower-bound', count: 2 }), null);
    ring.add('b', obs({ signalCodes: ['offline-render', 'api-use'], countQuality: 'sampled', count: 3 }), null);
    expect(ring.size).toBe(1);
    expect(ring.takeBatch(32)[0]?.observation).toMatchObject({ count: 3, countQuality: 'lower-bound', signalCodes: ['api-use', 'offline-render'] });
  });

  it('keys are namespaced by sensor boot and takeBatch returns one boot at a time', () => {
    const ring = new AggregateRing(8);
    ring.add('boot-1', obs(), null);
    ring.add('boot-2', obs(), null);
    ring.add('boot-1', obs({ techniqueId: 'DET-001' }), null);
    expect(ring.size).toBe(3);
    const batch = ring.takeBatch(32);
    expect(batch.map((e) => e.sensorBootId)).toEqual(['boot-1', 'boot-1']);
    ring.markAcked(batch);
    expect(ring.takeBatch(32).map((e) => e.sensorBootId)).toEqual(['boot-2']);
  });

  it('extra signal (bfcache-restore) is appended only when it fits the 8-code budget', () => {
    const ring = new AggregateRing(8);
    ring.add('b', obs({ signalCodes: ['api-use'] }), 'bfcache-restore');
    const eight = SIGNAL_CODES.filter((s) => s !== 'bfcache-restore').slice(0, 8) as SignalCode[];
    ring.add('b', obs({ signalCodes: eight }), 'bfcache-restore');
    const batch = ring.takeBatch(32);
    expect(batch[0]?.observation.signalCodes).toEqual(['api-use', 'bfcache-restore']);
    expect(batch[1]?.observation.signalCodes).toHaveLength(8);
    expect(batch[1]?.observation.signalCodes).not.toContain('bfcache-restore');
  });

  it('a re-keyed (bfcache-restore) record reports the growth since the pre-restore total; the old record freezes', () => {
    const ring = new AggregateRing(8);
    ring.add('b', obs({ count: 7 }), null);
    ring.markAcked(ring.takeBatch(32));
    // After the restore the sensor keeps counting on its own key: cumulative 9 = 7 before + 2 after.
    expect(ring.add('b', obs({ count: 9 }), 'bfcache-restore')).toBe('inserted');
    expect(ring.size).toBe(2);
    let batch = ring.takeBatch(32);
    expect(batch.map((e) => [e.observation.count, e.observation.signalCodes])).toEqual([[2, ['api-use', 'bfcache-restore']]]);
    ring.markAcked(batch);
    ring.add('b', obs({ count: 12 }), 'bfcache-restore');
    batch = ring.takeBatch(32);
    expect(batch.map((e) => e.observation.count)).toEqual([5]);
    // The pre-restore record still reports 7 when everything is resent (idempotent at the SW).
    ring.markAllDirty();
    const all = ring.takeBatch(32).map((e) => [e.observation.count, e.observation.signalCodes.includes('bfcache-restore')]);
    expect(all).toEqual(expect.arrayContaining([[7, false], [5, true]]));
    expect(all).toHaveLength(2);
    // A key first seen after the restore has no baseline: its whole total is post-restore.
    expect(ring.add('b', obs({ techniqueId: 'DET-001', count: 4 }), 'bfcache-restore')).toBe('inserted');
    expect(ring.takeBatch(32).find((e) => e.observation.techniqueId === 'DET-001')?.observation.count).toBe(4);
  });

  it('markAcked keeps a record dirty when it changed after the batch was built', () => {
    const ring = new AggregateRing(8);
    ring.add('b', obs({ count: 1 }), null);
    const batch = ring.takeBatch(32);
    ring.add('b', obs({ count: 2 }), null);
    expect(ring.markAcked(batch)).toBe(0);
    expect(ring.dirty).toBe(1);
    const again = ring.takeBatch(32);
    expect(again[0]?.observation.count).toBe(2);
    expect(ring.markAcked(again)).toBe(1);
    expect(ring.dirty).toBe(0);
  });

  it('overflow evicts acknowledged records first, then the least recently touched dirty one', () => {
    const ring = new AggregateRing(3);
    ring.add('b', obs({ techniqueId: 'DET-001' }), null);
    ring.add('b', obs({ techniqueId: 'DET-002' }), null);
    ring.add('b', obs({ techniqueId: 'DET-003' }), null);
    ring.markAcked(ring.takeBatch(1)); // DET-001 clean
    expect(ring.add('b', obs({ techniqueId: 'DET-004' }), null)).toBe('evicted-clean');
    expect(ring.size).toBe(3);
    expect(ring.dirty).toBe(3);
    ring.add('b', obs({ techniqueId: 'DET-002', count: 2 }), null); // touch: DET-002 is now the newest
    expect(ring.add('b', obs({ techniqueId: 'DET-005' }), null)).toBe('evicted-dirty');
    const keys = ring.takeBatch(32).map((e) => e.observation.techniqueId);
    expect(keys).toEqual(['DET-004', 'DET-002', 'DET-005']);
    expect(ring.dirty).toBe(3);
  });

  it('a key re-added after eviction restarts from the sensor total (the SW max-merge heals it)', () => {
    const ring = new AggregateRing(1);
    ring.add('b', obs({ techniqueId: 'DET-001', count: 10 }), null);
    ring.markAcked(ring.takeBatch(32));
    expect(ring.add('b', obs({ techniqueId: 'DET-002', count: 1 }), null)).toBe('evicted-clean');
    expect(ring.add('b', obs({ techniqueId: 'DET-001', count: 11 }), null)).toBe('evicted-dirty');
    expect(ring.takeBatch(32)[0]?.observation).toMatchObject({ techniqueId: 'DET-001', count: 11 });
  });

  it('markAllDirty resends everything and bumps versions so stale acks do not clean', () => {
    const ring = new AggregateRing(8);
    ring.add('b', obs(), null);
    const first = ring.takeBatch(32);
    ring.markAcked(first);
    expect(ring.dirty).toBe(0);
    ring.markAllDirty();
    expect(ring.dirty).toBe(1);
    expect(ring.markAcked(first)).toBe(0);
    expect(ring.dirty).toBe(1);
  });

  it('ADR-017: different operation codes are different records; no operation keeps the six v1 keys', () => {
    const ring = new AggregateRing(8);
    ring.add('b', obs({ techniqueId: 'DET-025', operationCode: 'user-agent', count: 2 }), null);
    ring.add('b', obs({ techniqueId: 'DET-025', operationCode: 'platform', count: 3 }), null);
    ring.add('b', obs({ techniqueId: 'DET-025', count: 4 }), null);
    expect(ring.size).toBe(3);
    const batch = ring.takeBatch(32);
    expect(batch.map((e) => [e.observation.operationCode, e.observation.count])).toEqual([['user-agent', 2], ['platform', 3], [undefined, 4]]);
    expect(Object.keys(batch[2]!.observation)).toHaveLength(6);
    expect(Object.keys(batch[0]!.observation)).toHaveLength(7);
    // Same op merges by max.
    ring.add('b', obs({ techniqueId: 'DET-025', operationCode: 'user-agent', count: 5 }), null);
    expect(ring.size).toBe(3);
  });

  it('ADR-017: a bfcache re-key keeps the operation and its own baseline', () => {
    const ring = new AggregateRing(8);
    ring.add('b', obs({ techniqueId: 'DET-011', operationCode: 'param-renderer', count: 4 }), null);
    ring.add('b', obs({ techniqueId: 'DET-011', operationCode: 'param-vendor', count: 1 }), null);
    ring.markAcked(ring.takeBatch(32));
    expect(ring.add('b', obs({ techniqueId: 'DET-011', operationCode: 'param-renderer', count: 6 }), 'bfcache-restore')).toBe('inserted');
    const batch = ring.takeBatch(32);
    expect(batch.map((e) => e.observation)).toEqual([
      expect.objectContaining({ techniqueId: 'DET-011', operationCode: 'param-renderer', count: 2, signalCodes: ['api-use', 'bfcache-restore'] }),
    ]);
  });

  it('never exceeds capacity under a distinct-key flood', () => {
    const ring = new AggregateRing(512);
    for (let i = 0; i < 20_000; i++) {
      ring.add('b', obs({ intervalBucket: i, signalCodes: [SIGNAL_CODES[i % SIGNAL_CODES.length] as SignalCode], techniqueId: i % 2 === 0 ? 'DET-001' : 'DET-002', phase: i % 3 === 0 ? 'attempted' : 'threw-sync' }), null);
      ring.add('boot-' + String(i), obs(), null);
    }
    expect(ring.size).toBe(512);
    expect(ring.dirty).toBe(512);
  });
});
