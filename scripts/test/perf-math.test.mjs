import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare, summarize, validateRun } from '../perf-math.mjs';

test('P09 statistics use median and nearest-rank p95, reject invalid/zero baselines', () => {
  assert.deepEqual(summarize([10, 1, 3, 2, 4]), { n: 5, median: 3, p95: 10 });
  assert.equal(summarize([1, 3]).median, 2);
  for (const values of [[], [NaN], [Infinity], [-1]]) assert.throws(() => summarize(values));
  assert.deepEqual(compare({ median: 10, p95: 20 }, { median: 20, p95: 40 }),
    { medianMs: 10, medianPct: 100, p95Ms: 20, p95Pct: 100 });
  assert.throws(() => compare({ median: 0, p95: 0 }, { median: 1, p95: 1 }));
});

test('P09 rejects idle, partial, degraded, mistimed and stack-producing fast runs', () => {
  const counts = [1_000_000, 0, 0, 0, 0, 0, 0, 0, 0];
  const result = { scenario: 'single', mode: 'fast', iterations: 1_000_000, calls: 1_000_000,
    totalMs: 10, checksum: 1, expectedCounts: counts,
    observed: { installed: 9, degraded: false, counts, mask: 1, stackReads: 0 } };
  validateRun(result, 'single', 'fast');
  for (const patch of [{ counts: counts.map(() => 0) }, { installed: 8 }, { degraded: true }, { mask: 0 }, { stackReads: 1 }]) {
    assert.throws(() => validateRun({ ...result, observed: { ...result.observed, ...patch } }, 'single', 'fast'));
  }
  for (const patch of [{ totalMs: 0 }, { checksum: NaN }, { calls: 1 }, { iterations: 1 }]) {
    assert.throws(() => validateRun({ ...result, ...patch }, 'single', 'fast'));
  }
  validateRun({ ...result, mode: 'baseline', observed: null }, 'single', 'baseline');
  assert.throws(() => validateRun({ ...result, mode: 'naive' }, 'single', 'naive'));
  validateRun({ ...result, mode: 'naive', observed: { ...result.observed, stackReads: 1_000_000 } }, 'single', 'naive');
});

test('P09 animation evidence requires five seconds, frame intervals and exact per-frame counts', () => {
  const counts = [512, 512, 0, 0, 0, 0, 0, 0, 0];
  const result = { scenario: 'animation', mode: 'fast', totalMs: 5000, workMs: 1, frames: 2,
    frameIntervalsMs: [5000], checksum: 1, calls: 1024, expectedCounts: counts,
    observed: { installed: 9, degraded: false, counts, mask: 3, stackReads: 0 } };
  validateRun(result, 'animation', 'fast');
  for (const patch of [{ totalMs: 4999 }, { frames: 3 }, { frameIntervalsMs: [NaN] }, { workMs: 0 }]) {
    assert.throws(() => validateRun({ ...result, ...patch }, 'animation', 'fast'));
  }
});
