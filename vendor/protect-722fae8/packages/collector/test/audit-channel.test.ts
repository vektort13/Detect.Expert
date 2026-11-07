// F004/F031-F036: page-controlled routing conflicts and diagnostic delivery (REQ-004/006/009/011).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_COUNT, PROTOCOL_VERSION, validatePageBatch } from '@detect-expert/contracts';
import { startCollector } from '../src/collector';
import { Handshake } from '../src/handshake';
import { FakeEnv, ackFor, obs, sensorBatch, sensorHello, sensorStatus } from './fake-env';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('hostile genuine-boot traffic', () => {
  it.each([MAX_COUNT, 4294967295])('rejects sequence poisoning (%s) after ACK and delivers the conflict without new data', async (seq) => {
    const env = new FakeEnv();
    const collector = startCollector(env);
    env.emit(sensorHello('real'));
    env.emit(sensorBatch('real', 1, [obs()]));
    await vi.advanceTimersByTimeAsync(250);
    env.emit(sensorBatch('real', seq, [obs({ count: 99 })]));
    await vi.advanceTimersByTimeAsync(250);
    expect(env.sent[1]?.batch.observations).toEqual([obs()]);
    expect(env.sent[1]?.batch.coverageDelta).toContain('throttled');
    expect(validatePageBatch(env.sent[1]?.batch).ok).toBe(true);
    env.emit(sensorBatch('real', 2, [obs({ count: 2 })]));
    await vi.advanceTimersByTimeAsync(250);
    expect(env.sent[2]?.batch.observations).toEqual([obs({ count: 2 })]);
    expect(collector.snapshot().ringDirty).toBe(0);
  });

  it('rejects MAX_COUNT before the first genuine batch without changing sequence state', async () => {
    const env = new FakeEnv();
    startCollector(env);
    env.emit(sensorHello('real'));
    env.emit(sensorBatch('real', MAX_COUNT, [obs({ count: 99 })]));
    env.emit(sensorBatch('real', 1, [obs()]));
    await vi.advanceTimersByTimeAsync(250);
    expect(env.sent[0]?.batch.observations).toEqual([obs()]);
    expect(env.sent[0]?.batch.coverageDelta).toEqual(['channel-gap', 'throttled']);
  });

  it('retains an acknowledged boot under hello churn and rejects mismatched duplicate hellos without stopping it', async () => {
    const env = new FakeEnv();
    const collector = startCollector(env);
    env.emit(sensorHello('real'));
    env.emit(sensorBatch('real', 1, [obs()]));
    await vi.advanceTimersByTimeAsync(250);
    for (let i = 0; i < 100; i++) env.emit(sensorHello('fake-' + String(i)));
    env.emit(sensorHello('real', { protocolVersion: PROTOCOL_VERSION + 1 }));
    await vi.advanceTimersByTimeAsync(250);
    expect(collector.snapshot().sensorBootIds).toContain('real');
    expect(collector.snapshot().sensorBootIds).toHaveLength(4);
    expect(env.postedOfType('bridge-stop')).toEqual([]);
    expect(env.sent[1]?.batch.coverageDelta).toEqual(['channel-gap', 'throttled']);
    env.emit(sensorBatch('real', 2, [obs({ count: 2 })]));
    await vi.advanceTimersByTimeAsync(250);
    expect(env.sent[2]?.batch.observations[0]?.count).toBe(2);
  });

  it('keeps all sequence state bounded across 100k rotating boots, rejection and unbind', () => {
    const env = new FakeEnv();
    const handshake = new Handshake(env, 'bridge', () => false, { maxKnownBoots: 4, helloRetries: 10, helloIntervalMs: 100 });
    const started = vi.getRealSystemTime();
    for (let i = 0; i < 100_000; i++) {
      const boot = 'boot-' + String(i);
      handshake.bind(boot);
      handshake.acceptSequence(boot, 1);
    }
    expect(handshake.bootIds).toEqual(['boot-0', 'boot-1', 'boot-2', 'boot-3']);
    expect(handshake.acceptSequence('boot-99999', 2)).toBe(false);
    handshake.unbind('boot-0');
    expect(handshake.acceptSequence('boot-0', 2)).toBe(false);
    expect(handshake.bind('boot-0')).toBe(true);
    expect(handshake.acceptSequence('boot-0', 1)).toBe(true);
    expect(handshake.bootIds).toHaveLength(4);
    console.log(`collector/rotating-boots: 100k bind/sequence attempts in ${vi.getRealSystemTime() - started} ms; retained boots ${handshake.bootIds.length}`);
  });
});

describe('coverage without new observations', () => {
  it('does not mislabel an acknowledged policy pause as a channel gap', async () => {
    const env = new FakeEnv();
    const collector = startCollector(env);
    env.respond = (batch) => ackFor(batch, { paused: true });
    env.emit(sensorHello('real'));
    env.emit(sensorBatch('real', 1, [obs()]));
    await vi.advanceTimersByTimeAsync(250);
    env.emit(sensorStatus('real', { state: 'paused', coverageFlags: ['paused'] }));
    expect(collector.snapshot()).toMatchObject({ state: 'paused', pendingCoverage: ['paused'] });
  });

  it.each(['paused', 'stopped', 'degraded'])('reports %s diagnostically after final ACK without changing policy or totals', async (state) => {
    const env = new FakeEnv();
    const collector = startCollector(env);
    env.emit(sensorHello('real'));
    env.emit(sensorBatch('real', 1, [obs({ count: 7 })]));
    await vi.advanceTimersByTimeAsync(250);
    env.emit(sensorStatus('real', { state }));
    await vi.advanceTimersByTimeAsync(250);
    expect(env.sent[1]?.batch.observations).toEqual([obs({ count: 7 })]);
    expect(env.sent[1]?.batch.coverageDelta).toEqual(['channel-gap']);
    expect(collector.snapshot()).toMatchObject({ state: 'active', ringDirty: 0, pendingCoverage: [] });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(env.sent).toHaveLength(2);
  });

  it('preserves partial hook coverage without inventing a channel gap for explained degradation', async () => {
    const env = new FakeEnv();
    startCollector(env);
    env.emit(sensorHello('real'));
    env.emit(sensorBatch('real', 1, [obs()]));
    await vi.advanceTimersByTimeAsync(250);
    env.emit(sensorStatus('real', { state: 'degraded', coverageFlags: ['hook-failed', 'descriptor-nonconfigurable'] }));
    await vi.advanceTimersByTimeAsync(250);
    expect(env.sent[1]?.batch.coverageDelta).toEqual(['hook-failed', 'descriptor-nonconfigurable']);
    expect(env.sent[1]?.batch.observations).toEqual([obs()]);
  });

  it('delivers a hello diagnostic using an existing clean snapshot', async () => {
    const env = new FakeEnv();
    startCollector(env);
    env.emit(sensorHello('real'));
    env.emit(sensorBatch('real', 1, [obs()]));
    await vi.advanceTimersByTimeAsync(250);
    env.emit(sensorHello('late', { startedLate: true }));
    await vi.advanceTimersByTimeAsync(250);
    expect(env.sent[1]?.batch.coverageDelta).toEqual(['late-start']);
  });

  it('delivers zero-observation installation failures as a coverage-only batch (no fabricated observation)', async () => {
    const env = new FakeEnv();
    const collector = startCollector(env);
    env.emit(sensorHello('real', { startedLate: true, coverageFlags: ['descriptor-nonconfigurable'] }));
    env.emit(sensorStatus('real', { state: 'degraded', coverageFlags: ['hook-failed'] }));
    await vi.advanceTimersByTimeAsync(250);
    expect(env.sent).toHaveLength(1);
    const batch = env.sent[0]?.batch;
    expect(batch).toMatchObject({ sensorBootId: 'real', batchSeq: 1, observations: [] });
    expect([...(batch?.coverageDelta ?? [])].sort()).toEqual(['descriptor-nonconfigurable', 'hook-failed', 'late-start']);
    expect(validatePageBatch(batch).ok).toBe(true);
    expect(collector.snapshot()).toMatchObject({ ringSize: 0, ringDirty: 0, pendingCoverage: [] });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(env.sent).toHaveLength(1); // committed flags are never resent on their own
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a sensor stopped before any observation (protocol mismatch) is reported as a coverage-only batch', async () => {
    const env = new FakeEnv();
    startCollector(env);
    env.emit(sensorHello('real'));
    env.emit(sensorStatus('real', { state: 'stopped', coverageFlags: ['protocol-mismatch'] }));
    await vi.advanceTimersByTimeAsync(250);
    expect(env.sent).toHaveLength(1);
    expect(env.sent[0]?.batch.observations).toEqual([]);
    expect(env.sent[0]?.batch.coverageDelta).toEqual(expect.arrayContaining(['protocol-mismatch', 'channel-gap']));
    expect(validatePageBatch(env.sent[0]?.batch).ok).toBe(true);
  });

  it('never sends a coverage-only batch without a known boot and without flags', async () => {
    const env = new FakeEnv();
    const collector = startCollector(env);
    await vi.advanceTimersByTimeAsync(500);
    expect(env.sent).toEqual([]);
    expect(collector.snapshot()).toMatchObject({ ringSize: 0, pendingCoverage: [] });
    await vi.advanceTimersByTimeAsync(4500);
    expect(env.sent).toHaveLength(1);
    expect(env.sent[0]?.batch).toMatchObject({ observations: [], coverageDelta: ['hook-failed'], sensorBootId: 'unbound' });
    expect(validatePageBatch(env.sent[0]?.batch).ok).toBe(true);
  });

  it('does not resend committed flags on their own: continued rejections after throttled was committed add no batches', async () => {
    const env = new FakeEnv();
    startCollector(env);
    env.emit(sensorHello('real'));
    env.emit(sensorBatch('real', 1, [obs()]));
    await vi.advanceTimersByTimeAsync(250);
    env.emit(sensorBatch('real', 1, [obs()])); // replay -> throttled + channel-gap, undelivered
    await vi.advanceTimersByTimeAsync(250);
    expect(env.sent).toHaveLength(2);
    expect(env.sent[1]?.batch.coverageDelta).toEqual(expect.arrayContaining(['throttled', 'channel-gap']));
    for (let i = 0; i < 200; i++) {
      env.emit(sensorBatch('real', 1, [obs()]));
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(env.sent).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('delivers coverage received while the final snapshot is in flight, through ACK/retry', async () => {
    const env = new FakeEnv();
    const collector = startCollector(env);
    let resolve: (value: unknown) => void = () => undefined;
    env.respond = () => new Promise((done) => { resolve = done; });
    env.emit(sensorHello('real'));
    env.emit(sensorBatch('real', 1, [obs()]));
    await vi.advanceTimersByTimeAsync(250);
    env.emit(sensorStatus('real', { coverageFlags: ['hook-failed'] }));
    const first = env.sent[0]?.batch;
    if (first === undefined) throw new Error('Missing initial batch');
    env.respond = () => { throw new Error('Receiving end does not exist'); };
    resolve(ackFor(first));
    await vi.advanceTimersByTimeAsync(250);
    expect(env.sent[1]?.batch.coverageDelta).toEqual(['hook-failed']);
    expect(collector.snapshot().pendingCoverage).toEqual(['hook-failed']);
    env.respond = ackFor;
    await vi.advanceTimersByTimeAsync(500);
    expect(env.sent[2]?.batch).toEqual(env.sent[1]?.batch);
    expect(collector.snapshot()).toMatchObject({ ringDirty: 0, pendingCoverage: [] });
  });
});

describe('integration terminal ACK and control ordering', () => {
  it.each([true, false])('a delayed ACK cannot undo newer pause=%s', async (paused) => {
    const env = new FakeEnv();
    let resolve: (value: unknown) => void = () => undefined;
    env.respond = () => new Promise((done) => { resolve = done; });
    const collector = startCollector(env);
    env.emit(sensorHello('real'));
    env.emit(sensorBatch('real', 1, [obs()]));
    await vi.advanceTimersByTimeAsync(250);
    env.control({ schemaVersion: 1, type: 'bridge-control', command: paused ? 'pause' : 'resume' });
    resolve(ackFor(env.sent[0]!.batch, { paused: !paused }));
    await vi.advanceTimersByTimeAsync(1);
    expect(collector.snapshot().state).toBe(paused ? 'paused' : 'active');
  });
  it('terminal revoke stops without inventing a protocol mismatch', async () => {
    const env = new FakeEnv();
    env.respond = (batch) => ({ ...(ackFor(batch) as object), lastCommittedBatchSeq: 0, paused: true, stopReason: 'revoked' });
    const collector = startCollector(env);
    env.emit(sensorHello('real'));
    env.emit(sensorBatch('real', 1, [obs()]));
    await vi.advanceTimersByTimeAsync(250);
    expect(collector.snapshot().state).toBe('stopped');
    expect(collector.snapshot().stats.protocolMismatches).toBe(0);
    expect(env.postedOfType('bridge-stop').at(-1)).toMatchObject({ reason: 'revoked' });
  });
});
