// ADR-020 §E (S11): ReplayCadenceTracker — SW memory only, bounded at 32 documents × 16 receivers (LRU), truncation
// flag when a receiver with a series is dropped, glue / series / reset through the engine's stepCadence.

import { describe, expect, it } from 'vitest';
import { PROTECT_BUDGETS } from '@detect-expert/contracts';
import { REPLAY_TRACKER_DOCUMENTS, REPLAY_TRACKER_DOMAINS, ReplayCadenceTracker } from '../../src/protect/replay/index';

describe('ReplayCadenceTracker', () => {
  it('uses the module budgets: 32 documents × 16 receivers', () => {
    expect(REPLAY_TRACKER_DOCUMENTS).toBe(PROTECT_BUDGETS.replayCadenceDocuments);
    expect(REPLAY_TRACKER_DOMAINS).toBe(PROTECT_BUDGETS.replayCadenceDomainsPerDocument);
    expect(REPLAY_TRACKER_DOCUMENTS).toBe(32);
    expect(REPLAY_TRACKER_DOMAINS).toBe(16);
  });

  it('glue, series, qualification and a new series after a long pause', () => {
    const t = new ReplayCadenceTracker();
    const key = '7:0:DOC';
    expect(t.note(key, 'example.net', 0, 2048)).toBe(false);
    expect(t.note(key, 'example.net', 300, 2048)).toBe(false); // glued
    expect(t.note(key, 'example.net', 1500, 2048)).toBe(false);
    expect(t.note(key, 'example.net', 3000, 100)).toBe(true); // third burst, two large
    const [p] = t.periodic(key);
    expect(p).toMatchObject({ registrableDomain: 'example.net', vendorIds: [] });
    expect(p!.cadence).toMatchObject({ runMax: 3, sends: 4, largeInRunMax: 2, qualified: true });
    t.note(key, 'example.net', 30_000, 2048);
    expect(t.periodic(key)[0]!.cadence).toMatchObject({ run: 1, runMax: 3 });
  });

  it('memory is bounded: LRU documents and receivers; truncation is reported', () => {
    const t = new ReplayCadenceTracker();
    for (let d = 0; d < 40; d++) for (let h = 0; h < 20; h++) t.note('1:0:D' + String(d), 'h' + String(h) + '.example.net', h * 10, 10);
    const s = t.stats();
    expect(s.documents).toBe(32);
    expect(s.domains).toBeLessThanOrEqual(32 * 16);
    expect(s.evictedDocuments).toBe(8);
    expect(t.has('1:0:D0')).toBe(false);
    expect(t.has('1:0:D39')).toBe(true);
    expect(t.periodic('1:0:D39')).toHaveLength(16);
    // Dropped receivers had no series (runMax 1): no truncation.
    expect(t.truncated('1:0:D39')).toBe(false);
    const u = new ReplayCadenceTracker();
    u.note('1:0:X', 'a.example.net', 0, 10);
    u.note('1:0:X', 'a.example.net', 2000, 10); // a series of 2
    for (let h = 0; h < 16; h++) u.note('1:0:X', 'b' + String(h) + '.example.net', 3000 + h, 10);
    expect(u.truncated('1:0:X')).toBe(true);
  });

  it('recently used documents survive; forgetTab and clear', () => {
    const t = new ReplayCadenceTracker();
    for (let d = 0; d < 32; d++) t.note(String(d % 2) + ':0:D' + String(d), 'x.example.net', 0, null);
    t.note('0:0:D0', 'x.example.net', 2000, null); // touched: no longer the oldest
    t.note('9:0:NEW', 'x.example.net', 0, null);
    expect(t.has('0:0:D0')).toBe(true);
    expect(t.has('1:0:D1')).toBe(false);
    t.forgetTab(0);
    expect(t.has('0:0:D0')).toBe(false);
    expect(t.has('9:0:NEW')).toBe(true);
    t.clear();
    expect(t.stats().documents).toBe(0);
  });

  it('vendor ids of matched endpoint rules are kept per receiver (bounded)', () => {
    const t = new ReplayCadenceTracker();
    for (let i = 0; i < 6; i++) t.note('1:0:V', 'rec.example.org', i * 1500, null, 'v' + String(i));
    t.note('1:0:V', 'rec.example.org', 10_000, null, 'v0');
    expect(t.periodic('1:0:V')[0]!.vendorIds).toEqual(['v0', 'v1', 'v2', 'v3']);
  });
});
