// Hot-path budget for the transport validator (REQ-011). The thresholds are deliberately generous so that
// the test is stable on slow CI machines; the measured numbers are printed for the record (spec I4:
// no false precision — these are single-machine microbenchmarks, not guarantees).

import { describe, expect, it } from 'vitest';
import { BUDGETS, COVERAGE_FLAGS, MAX_COUNT, SIGNAL_CODES, TECHNIQUE_IDS, sanitizeHost, validatePageBatch } from '@detect-expert/contracts';

function maxBatch(): unknown {
  return {
    schemaVersion: 1,
    type: 'sensor-events',
    sensorBootId: 'a'.repeat(BUDGETS.maxIdChars),
    bridgeSessionId: 'b'.repeat(BUDGETS.maxIdChars),
    batchSeq: 1,
    observations: Array.from({ length: BUDGETS.maxBatchEvents }, (_, i) => ({
      techniqueId: TECHNIQUE_IDS[i % TECHNIQUE_IDS.length],
      count: MAX_COUNT,
      countQuality: 'exact',
      phase: 'attempted',
      signalCodes: SIGNAL_CODES.slice(0, BUDGETS.maxSignalCodesPerObservation),
      intervalBucket: i,
    })),
    coverageDelta: [...COVERAGE_FLAGS],
  };
}

function measure(label: string, iterations: number, fn: () => void): number {
  for (let i = 0; i < Math.min(iterations, 2000); i++) fn(); // warm-up
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const perCallMs = (performance.now() - start) / iterations;
  console.log('perf: ' + label + ' = ' + (perCallMs * 1000).toFixed(2) + ' µs/call over ' + String(iterations) + ' iterations');
  return perCallMs;
}

describe('validator hot path', () => {
  it('validatePageBatch on a maximal batch stays under 0.5 ms per call', () => {
    const batch = maxBatch();
    expect(validatePageBatch(batch).ok).toBe(true);
    const perCall = measure('validatePageBatch(max)', 20_000, () => {
      validatePageBatch(batch);
    });
    expect(perCall).toBeLessThan(0.5);
  });

  it('rejecting a flood batch (10 000 observations) is cheap: it fails on length before per-item work', () => {
    const flood = { ...(maxBatch() as Record<string, unknown>), observations: Array.from({ length: 10_000 }, () => ({})) };
    const perCall = measure('validatePageBatch(flood 10k)', 5_000, () => {
      validatePageBatch(flood);
    });
    expect(perCall).toBeLessThan(0.05);
  });

  it('sanitizeHost stays under 0.05 ms per call', () => {
    const perCall = measure('sanitizeHost', 50_000, () => {
      sanitizeHost('https://user:pw@Sub.Example.COM:8443/path/to/resource?query=1#frag');
    });
    expect(perCall).toBeLessThan(0.05);
  });
});
