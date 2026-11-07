import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageBatch } from '@detect-expert/contracts';
import { startCollector } from '../src/index';
import { FakeEnv, ackFor, obs, sensorBatch, sensorHello } from './fake-env';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const never = (): unknown => new Promise(() => undefined);
const seqs = (env: FakeEnv): number[] => env.sent.map((s) => s.batch.batchSeq);

describe('delivery', () => {
  it.each([1, 3])('delivers recreated record totals despite a delayed ACK at version %s (F037/F119)', async (oldVersion) => {
    const env = new FakeEnv();
    const c = startCollector(env, { maxRecords: 1 });
    let resolve: (value: unknown) => void = () => undefined;
    env.respond = () => new Promise((done) => { resolve = done; });
    env.emit(sensorHello('b'));
    for (let seq = 1; seq <= oldVersion; seq++) env.emit(sensorBatch('b', seq, [obs({ count: seq })]));
    await vi.advanceTimersByTimeAsync(250);
    const first = env.sent[0]?.batch;
    if (first === undefined) throw new Error('Missing initial batch');
    env.emit(sensorBatch('b', oldVersion + 1, [obs({ techniqueId: 'DET-001' })]));
    env.emit(sensorBatch('b', oldVersion + 2, [obs({ count: 10 })]));
    env.respond = ackFor;
    resolve(ackFor(first));
    await vi.advanceTimersByTimeAsync(0);
    expect(c.snapshot().ringDirty).toBe(1);
    for (let i = 1; i < oldVersion; i++) env.emit(sensorBatch('b', oldVersion + 2 + i, [obs({ count: 10 + i })]));
    await vi.advanceTimersByTimeAsync(250);
    expect(env.sent[1]?.batch.observations).toEqual([obs({ count: 9 + oldVersion })]);
    expect(c.snapshot()).toMatchObject({ ringDirty: 0, inFlightBatchSeq: null });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['reject', 'timeout', 'uncommitted'])('suspends after cumulative %s failures and recovers with preserved totals (F116/F117)', async (failure) => {
    const env = new FakeEnv();
    const c = startCollector(env, { maxRetransmits: 1, maxConsecutiveAbandons: 3, ackTimeoutMs: 100, retransmitBaseMs: 100, retransmitMaxMs: 100 });
    env.respond = failure === 'timeout' ? never : failure === 'reject'
      ? () => { throw new Error('Receiving end does not exist'); }
      : () => ({ schemaVersion: 1, type: 'ack', lastCommittedBatchSeq: 0, paused: false, protocolOk: true });
    env.emit(sensorHello('b'));
    env.emit(sensorBatch('b', 1, [obs({ count: 7 })]));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(c.snapshot()).toMatchObject({ transportSuspended: true, ringDirty: 1, inFlightBatchSeq: null, stats: expect.objectContaining({ batchesAbandoned: 3 }) });
    expect(seqs(env)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(c.snapshot().pendingCoverage).toEqual(['channel-gap', 'budget-exceeded']);
    env.emit(sensorBatch('b', 2, [obs({ count: 9 })]));
    env.pagehide(true);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(env.sent).toHaveLength(6);
    expect(vi.getTimerCount()).toBe(0);
    env.respond = ackFor;
    c.resume();
    await vi.advanceTimersByTimeAsync(250);
    expect(env.sent[6]?.batch).toMatchObject({ batchSeq: 4, coverageDelta: ['channel-gap', 'budget-exceeded'], observations: [obs({ count: 9 })] });
    expect(c.snapshot()).toMatchObject({ transportSuspended: false, ringDirty: 0, pendingCoverage: [] });
  });

  it('trusted BFCache restore recovers a suspended transport without unpausing policy', async () => {
    const env = new FakeEnv();
    const c = startCollector(env, { maxRetransmits: 0, maxConsecutiveAbandons: 1 });
    env.respond = () => { throw new Error('Receiving end does not exist'); };
    env.emit(sensorHello('b'));
    env.emit(sensorBatch('b', 1, [obs()]));
    await vi.advanceTimersByTimeAsync(250);
    expect(c.snapshot().transportSuspended).toBe(true);
    c.pause();
    env.pageshow(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(env.sent).toHaveLength(1);
    expect(c.snapshot().state).toBe('paused');
    env.respond = ackFor;
    c.resume();
    await vi.advanceTimersByTimeAsync(250);
    expect(c.snapshot()).toMatchObject({ transportSuspended: false, ringDirty: 0 });
    env.respond = () => { throw new Error('Receiving end does not exist'); };
    env.emit(sensorBatch('b', 2, [obs({ count: 2 })]));
    await vi.advanceTimersByTimeAsync(250);
    expect(c.snapshot().transportSuspended).toBe(true);
    env.respond = ackFor;
    env.pageshow(true);
    await vi.advanceTimersByTimeAsync(250);
    expect(c.snapshot()).toMatchObject({ transportSuspended: false, ringDirty: 0 });
  });

  it('sends cumulative totals 250 ms after data; an Ack drops the records; batchSeq increases', async () => {
    const env = new FakeEnv();
    const c = startCollector(env);
    env.emit(sensorHello('b'));
    env.emit(sensorBatch('b', 1, [obs({ count: 2 })], ['late-start']));
    await vi.advanceTimersByTimeAsync(249);
    expect(env.sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(env.sent).toHaveLength(1);
    expect(env.sent[0]?.batch).toMatchObject({ schemaVersion: 1, type: 'sensor-events', sensorBootId: 'b', bridgeSessionId: c.snapshot().bridgeSessionId, batchSeq: 1, coverageDelta: ['late-start'] });
    expect(env.sent[0]?.batch.observations).toEqual([obs({ count: 2 })]);
    expect(c.snapshot()).toMatchObject({ ringDirty: 0, ringSize: 1, inFlightBatchSeq: null, pendingCoverage: [] });
    env.emit(sensorBatch('b', 2, [obs({ count: 5 }), obs({ techniqueId: 'DET-001' })]));
    await vi.advanceTimersByTimeAsync(250);
    expect(env.sent).toHaveLength(2);
    expect(env.sent[1]?.batch.batchSeq).toBe(2);
    expect(env.sent[1]?.batch.observations.map((o) => [o.techniqueId, o.count])).toEqual([['DET-007', 5], ['DET-001', 1]]);
    expect(c.snapshot().stats).toMatchObject({ batchesSent: 2, batchesCommitted: 2, batchesRetransmitted: 0 });
  });

  it('hung Ack: timeout, then the same batchSeq is retransmitted byte-identical with backoff; a late Ack cleans up', async () => {
    const env = new FakeEnv();
    const c = startCollector(env, { ackTimeoutMs: 250, retransmitBaseMs: 500, retransmitMaxMs: 2000 });
    env.emit(sensorHello('b'));
    env.respond = never;
    env.emit(sensorBatch('b', 1, [obs({ count: 4 })]));
    await vi.advanceTimersByTimeAsync(250); // t=250: send #1
    expect(seqs(env)).toEqual([1]);
    // Data arriving while in flight waits: stop-and-wait keeps one batch outstanding (sensor total now 5).
    env.emit(sensorBatch('b', 2, [obs({ count: 5 })]));
    await vi.advanceTimersByTimeAsync(750); // t=500 timeout, t=1000 retransmit #2 (backoff 500)
    expect(seqs(env)).toEqual([1, 1]);
    expect(env.sent[1]?.batch).toEqual(env.sent[0]?.batch);
    await vi.advanceTimersByTimeAsync(1250); // t=1250 timeout, t=2250 retransmit #3 (backoff 1000)
    expect(seqs(env)).toEqual([1, 1, 1]);
    expect(env.sent[2]?.batch).toEqual(env.sent[0]?.batch);
    expect(c.snapshot().stats).toMatchObject({ batchesSent: 1, batchesRetransmitted: 2, batchesCommitted: 0, acksTimedOut: 2 });
    env.respond = (b: PageBatch) => ackFor(b);
    await vi.advanceTimersByTimeAsync(2250); // t=2500 timeout, t=4500 retransmit #4 (backoff 2000) -> Ack
    expect(seqs(env)).toEqual([1, 1, 1, 1]);
    // The record changed after the frozen batch was built, so its new total (5) goes out under batchSeq 2.
    await vi.advanceTimersByTimeAsync(250);
    expect(seqs(env)).toEqual([1, 1, 1, 1, 2]);
    expect(env.sent[4]?.batch.observations[0]?.count).toBe(5);
    expect(c.snapshot()).toMatchObject({ ringDirty: 0, lastBatchSeq: 2 });
  });

  it('transient transport rejection is retried, not fatal', async () => {
    const env = new FakeEnv();
    const c = startCollector(env);
    env.emit(sensorHello('b'));
    env.respond = () => { throw new Error('Could not establish connection. Receiving end does not exist.'); };
    env.emit(sensorBatch('b', 1, [obs()]));
    await vi.advanceTimersByTimeAsync(250);
    env.respond = (b: PageBatch) => ackFor(b);
    await vi.advanceTimersByTimeAsync(500);
    expect(seqs(env)).toEqual([1, 1]);
    expect(c.snapshot()).toMatchObject({ state: 'active', ringDirty: 0 });
    expect(c.snapshot().stats.transportFailures).toBe(1);
    expect(env.postedOfType('bridge-stop')).toHaveLength(0);
  });

  it('Ack below the batchSeq or with an invalid shape is a lost Ack: retransmit, same batchSeq', async () => {
    const env = new FakeEnv();
    const c = startCollector(env);
    env.emit(sensorHello('b'));
    env.respond = () => ({ schemaVersion: 1, type: 'ack', lastCommittedBatchSeq: 0, paused: false, protocolOk: true });
    env.emit(sensorBatch('b', 1, [obs()]));
    await vi.advanceTimersByTimeAsync(250);
    env.respond = () => undefined;
    await vi.advanceTimersByTimeAsync(500);
    env.respond = () => ({ schemaVersion: 1, type: 'ack', lastCommittedBatchSeq: 'one', paused: false, protocolOk: true });
    await vi.advanceTimersByTimeAsync(1000);
    expect(seqs(env)).toEqual([1, 1, 1]);
    expect(c.snapshot().stats).toMatchObject({ acksNotCommitted: 1, acksInvalid: 2, batchesRetransmitted: 2 });
  });

  it('after maxRetransmits the batchSeq is abandoned and the still-dirty records get a fresh one', async () => {
    const env = new FakeEnv();
    const c = startCollector(env, { ackTimeoutMs: 100, retransmitBaseMs: 100, retransmitMaxMs: 200, maxRetransmits: 2 });
    env.emit(sensorHello('b'));
    env.respond = never;
    env.emit(sensorBatch('b', 1, [obs({ count: 7 })]));
    // t=250 #1; timeout 350 -> #2 at 450; timeout 550 -> #3 at 750; timeout 850 -> abandoned
    await vi.advanceTimersByTimeAsync(850);
    expect(seqs(env)).toEqual([1, 1, 1]);
    expect(c.snapshot()).toMatchObject({ inFlightBatchSeq: null, ringDirty: 1, stats: expect.objectContaining({ batchesAbandoned: 1 }) });
    env.respond = (b: PageBatch) => ackFor(b);
    await vi.advanceTimersByTimeAsync(200 + 250); // t=1050 reschedule, t=1300 fresh batch
    expect(seqs(env)).toEqual([1, 1, 1, 2]);
    expect(env.sent[3]?.batch.observations[0]?.count).toBe(7);
    expect(c.snapshot().ringDirty).toBe(0);
  });

  it('a late response from a superseded attempt cannot double-commit or restart retries', async () => {
    const env = new FakeEnv();
    const c = startCollector(env, { ackTimeoutMs: 100, retransmitBaseMs: 100, retransmitMaxMs: 100 });
    env.emit(sensorHello('b'));
    let resolveFirst: ((v: unknown) => void) | null = null;
    env.respond = (b: PageBatch) => {
      if (resolveFirst === null) return new Promise((resolve) => { resolveFirst = resolve; });
      return ackFor(b);
    };
    env.emit(sensorBatch('b', 1, [obs()]));
    await vi.advanceTimersByTimeAsync(250 + 100 + 100); // #1 hangs, #2 sent and acked
    expect(seqs(env)).toEqual([1, 1]);
    expect(c.snapshot()).toMatchObject({ ringDirty: 0, inFlightBatchSeq: null });
    (resolveFirst as unknown as (v: unknown) => void)({ schemaVersion: 1, type: 'ack', lastCommittedBatchSeq: 0, paused: false, protocolOk: true });
    await vi.advanceTimersByTimeAsync(1000);
    expect(seqs(env)).toEqual([1, 1]);
    expect(c.snapshot().stats).toMatchObject({ batchesCommitted: 1, batchesRetransmitted: 1 });
  });
});
