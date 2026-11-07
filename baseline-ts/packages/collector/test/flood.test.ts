import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUDGETS, PHASES, SIGNAL_CODES, TECHNIQUE_IDS } from '@detect-expert/contracts';
import type { Phase, SignalCode, TechniqueId } from '@detect-expert/contracts';
import { startCollector } from '../src/index';
import { FakeEnv, obs, sensorBatch, sensorHello } from './fake-env';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const PAGE_TECHNIQUES = TECHNIQUE_IDS.filter(techniqueId => techniqueId !== 'DET-074');

/** Rotating keys: far more than 512 distinct (technique, phase, signalCodes) combinations. */
function floodObservation(i: number): Record<string, unknown> {
  const a = SIGNAL_CODES[i % SIGNAL_CODES.length] as SignalCode;
  const b = SIGNAL_CODES[(i * 7 + 3) % SIGNAL_CODES.length] as SignalCode;
  return {
    techniqueId: PAGE_TECHNIQUES[i % PAGE_TECHNIQUES.length] as TechniqueId,
    count: 1 + (i % 3),
    countQuality: 'exact',
    phase: PHASES[(i >> 3) % PHASES.length] as Phase,
    signalCodes: a === b ? [a] : [a, b],
    intervalBucket: i,
  };
}

describe('flood', () => {
  it('refuses browser-only response headers submitted through the page channel', () => {
    const env = new FakeEnv();
    const collector = startCollector(env);
    env.emit(sensorHello('b'));
    env.emit(sensorBatch('b', 1, [obs({ techniqueId: 'DET-074' })]));
    expect(collector.snapshot().stats).toMatchObject({ observationsAccepted: 0, droppedMalformed: 1 });
    expect(collector.snapshot().ringSize).toBe(0);
  });

  it('100k distinct-key sensor-batch messages: ring <= 512, <= 20 batches in any second, explicit gap, bounded memory', async () => {
    const env = new FakeEnv();
    const c = startCollector(env);
    env.emit(sensorHello('b'));
    const heapBefore = process.memoryUsage().heapUsed;
    const startedAt = Date.now();
    const realStart = vi.getRealSystemTime(); // process.hrtime/performance are faked; this is wall-clock
    let seq = 0;
    let maxRing = 0;
    // 10 bursts of 10k messages, 100 ms apart, while delivery runs with instant Acks.
    for (let burst = 0; burst < 10; burst++) {
      for (let i = 0; i < 10_000; i++) {
        seq++;
        const n = 1 + (seq % 2);
        const observations: Record<string, unknown>[] = [];
        for (let k = 0; k < n; k++) observations.push(floodObservation(seq * 2 + k));
        env.emit(sensorBatch('b', seq, observations));
      }
      maxRing = Math.max(maxRing, c.snapshot().ringSize);
      await vi.advanceTimersByTimeAsync(100);
      maxRing = Math.max(maxRing, c.snapshot().ringSize);
    }
    const ingestMs = vi.getRealSystemTime() - realStart;
    await vi.advanceTimersByTimeAsync(4000);
    const heapAfter = process.memoryUsage().heapUsed;
    const snap = c.snapshot();

    expect(snap.state).toBe('active');
    expect(snap.stats.observationsAccepted).toBe(150_000);
    expect(snap.stats.droppedMalformed).toBe(0);
    expect(maxRing).toBeLessThanOrEqual(BUDGETS.maxBridgeRecordsPerDocument);
    expect(snap.ringSize).toBeLessThanOrEqual(BUDGETS.maxBridgeRecordsPerDocument);
    expect(snap.stats.ringEvictedDirty + snap.stats.ringEvictedClean).toBeGreaterThan(0);

    // Rate: no one-second bin (and no trailing one-second window) holds more than 20 batches.
    const bins = new Map<number, number>();
    for (const s of env.sent) {
      const bin = Math.floor((s.at - startedAt) / 1000);
      bins.set(bin, (bins.get(bin) ?? 0) + 1);
    }
    for (const [, n] of bins) expect(n).toBeLessThanOrEqual(BUDGETS.maxBatchesPerSecondPerDocument);
    for (let i = BUDGETS.maxBatchesPerSecondPerDocument; i < env.sent.length; i++) {
      const newer = env.sent[i]?.at ?? 0;
      const older = env.sent[i - BUDGETS.maxBatchesPerSecondPerDocument]?.at ?? 0;
      expect(newer - older).toBeGreaterThanOrEqual(1000);
    }
    // The limiter actually engaged: demand exceeded 20 batches during the first second of the flood.
    expect(bins.get(0)).toBe(BUDGETS.maxBatchesPerSecondPerDocument);
    for (const s of env.sent) expect(s.batch.observations.length).toBeLessThanOrEqual(BUDGETS.maxBatchEvents);

    // Loss is explicit: the batch after an eviction carries the gap flags.
    const flagged = env.sent.filter((s) => s.batch.coverageDelta.includes('channel-gap') && s.batch.coverageDelta.includes('bridge-ring-overflow'));
    expect(flagged.length).toBeGreaterThan(0);

    // Every retained structure is bounded; heap growth is dominated by the test's own garbage.
    expect(snap.inFlightBatchSeq).toBeNull();
    expect(snap.pendingCoverage.length).toBeLessThanOrEqual(15);
    const heapGrowthMb = (heapAfter - heapBefore) / (1024 * 1024);
    expect(heapGrowthMb).toBeLessThan(256);

    console.log(`flood/distinct: 100k messages (150k observations) ingested + delivered over 1 s of fake time in ${ingestMs} ms wall-clock; batches sent ${env.sent.length}; ring max ${maxRing}; evicted dirty ${snap.stats.ringEvictedDirty} clean ${snap.stats.ringEvictedClean}; heap growth ${heapGrowthMb.toFixed(1)} MB`);
  });

  it('100k same-key messages collapse into one cumulative record and a handful of batches', async () => {
    const env = new FakeEnv();
    const c = startCollector(env);
    env.emit(sensorHello('b'));
    const realStart = vi.getRealSystemTime();
    for (let seq = 1; seq <= 100_000; seq++) env.emit(sensorBatch('b', seq, [obs({ count: 2 * seq, intervalBucket: seq })]));
    const ingestMs = vi.getRealSystemTime() - realStart;
    expect(c.snapshot()).toMatchObject({ ringSize: 1, ringDirty: 1 });
    await vi.advanceTimersByTimeAsync(1000);
    const snap = c.snapshot();
    expect(env.sent).toHaveLength(1);
    expect(env.sent[0]?.batch.observations).toEqual([obs({ count: 200_000, intervalBucket: 100_000 })]);
    expect(env.sent[0]?.batch.coverageDelta).toEqual([]);
    expect(snap.stats).toMatchObject({ observationsAccepted: 100_000, ringEvictedDirty: 0, ringEvictedClean: 0 });
    console.log(`flood/same-key: 100k messages ingested in ${ingestMs} ms wall-clock; batches sent ${env.sent.length}`);
  });
});
