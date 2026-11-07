import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHANNEL } from '@detect-expert/contracts';
import type { PageBatch } from '@detect-expert/contracts';
import { startCollector } from '../src/index';
import { FakeEnv, ackFor, obs, sensorBatch, sensorHello, sensorStatus } from './fake-env';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const never = (): unknown => new Promise(() => undefined);

describe('pause / stop relay', () => {
  it('Ack.paused relays bridge-pause, stops sending and dropping new data; resume relays bridge-resume', async () => {
    const env = new FakeEnv();
    const c = startCollector(env);
    env.emit(sensorHello('b'));
    env.respond = (b: PageBatch) => ackFor(b, { paused: true });
    env.emit(sensorBatch('b', 1, [obs()]));
    await vi.advanceTimersByTimeAsync(250);
    expect(env.postedOfType('bridge-pause')).toEqual([expect.objectContaining({ sensorBootId: 'b' })]);
    expect(c.snapshot()).toMatchObject({ state: 'paused', ringDirty: 0 });
    env.emit(sensorBatch('b', 2, [obs()]));
    await vi.advanceTimersByTimeAsync(5000);
    expect(env.sent).toHaveLength(1);
    expect(c.snapshot().stats.droppedWhilePaused).toBe(1);
    expect(env.postedOfType('bridge-hello')).toHaveLength(2);
    env.respond = (b: PageBatch) => ackFor(b);
    c.resume();
    expect(env.postedOfType('bridge-resume')).toEqual([expect.objectContaining({ sensorBootId: 'b' })]);
    env.emit(sensorBatch('b', 3, [obs({ techniqueId: 'DET-002' })]));
    await vi.advanceTimersByTimeAsync(250);
    expect(env.sent).toHaveLength(2);
    expect(env.sent[1]?.batch.coverageDelta).toEqual(['paused']);
    expect(c.snapshot().state).toBe('active');
  });

  it('Ack.protocolOk === false relays bridge-stop(protocol-mismatch) and stops for good', async () => {
    const env = new FakeEnv();
    const c = startCollector(env);
    env.emit(sensorHello('b'));
    env.respond = (b: PageBatch) => ackFor(b, { protocolOk: false });
    env.emit(sensorBatch('b', 1, [obs()]));
    await vi.advanceTimersByTimeAsync(250);
    expect(env.postedOfType('bridge-stop')).toEqual([expect.objectContaining({ sensorBootId: 'b', reason: 'protocol-mismatch' })]);
    expect(c.snapshot().state).toBe('stopped');
    env.emit(sensorBatch('b', 2, [obs()]));
    await vi.advanceTimersByTimeAsync(5000);
    expect(env.sent).toHaveLength(1);
  });

  it('extension context invalidated: quiet stop, bridge-stop(revoked), no further sends', async () => {
    const env = new FakeEnv();
    const c = startCollector(env);
    env.emit(sensorHello('b'));
    env.alive = false;
    env.emit(sensorBatch('b', 1, [obs()]));
    await vi.advanceTimersByTimeAsync(250);
    expect(env.postedOfType('bridge-stop')).toEqual([expect.objectContaining({ sensorBootId: 'b', reason: 'revoked' })]);
    expect(c.snapshot()).toMatchObject({ state: 'stopped', inFlightBatchSeq: null });
    env.emit(sensorBatch('b', 2, [obs()]));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(env.sent).toHaveLength(1);
    expect(c.snapshot().stats.transportFailures).toBe(1);
  });

  it('sensor-status merges coverage flags and counts sensor-side drops', async () => {
    const env = new FakeEnv();
    const c = startCollector(env);
    env.emit(sensorHello('b'));
    env.emit(sensorBatch('b', 1, [obs()]));
    env.emit(sensorStatus('b', { state: 'degraded', coverageFlags: ['hook-failed'], droppedSinceLast: 12 }));
    await vi.advanceTimersByTimeAsync(250);
    expect(env.sent[0]?.batch.coverageDelta.sort()).toEqual(['hook-failed', 'truncated']);
    expect(c.snapshot().stats.sensorDropped).toBe(12);
  });
});

describe('rejected channel traffic', () => {
  it('malformed, unknown-boot and replayed channel messages are counted and surface as throttled on the next batch', async () => {
    const env = new FakeEnv();
    const c = startCollector(env);
    env.emit(sensorHello('b'));
    env.emit({ channel: CHANNEL, sensorBootId: 'b', type: 'ui-clear', tabId: 1 });
    env.emit(sensorBatch('spoof', 1, [obs()]));
    env.emit(sensorBatch('b', 1, [obs({ count: 1 })]));
    env.emit(sensorBatch('b', 1, [obs({ count: 5 })]));
    expect(c.snapshot().stats).toMatchObject({ droppedMalformed: 1, droppedUnknownBoot: 1, droppedReplayed: 1, observationsAccepted: 1 });
    expect(c.snapshot().pendingCoverage.sort()).toEqual(['channel-gap', 'throttled']);
    await vi.advanceTimersByTimeAsync(250);
    expect(env.sent).toHaveLength(1);
    expect(env.sent[0]?.batch.coverageDelta.sort()).toEqual(['channel-gap', 'throttled']);
    expect(env.sent[0]?.batch.observations).toEqual([obs({ count: 1 })]);
    // Committed: the flag is not repeated on the next batch unless new rejections happen.
    env.emit(sensorBatch('b', 2, [obs({ count: 2 })]));
    await vi.advanceTimersByTimeAsync(250);
    expect(env.sent[1]?.batch.coverageDelta).toEqual([]);
    // Untagged page traffic (not addressed to the bridge) is neither counted nor flagged.
    env.emit({ hello: 'world' });
    env.emit(sensorBatch('b', 3, [obs()]), false);
    expect(c.snapshot().pendingCoverage).toEqual([]);
    expect(c.snapshot().stats.droppedMalformed).toBe(1);
  });
});

describe('BFCache and pagehide', () => {
  it('pageshow(persisted) resends the cumulative snapshot; later observations carry bfcache-restore', async () => {
    const env = new FakeEnv();
    const c = startCollector(env);
    env.emit(sensorHello('b'));
    env.emit(sensorBatch('b', 1, [obs({ count: 3 }), obs({ techniqueId: 'DET-001', count: 2 })]));
    await vi.advanceTimersByTimeAsync(250);
    expect(c.snapshot().ringDirty).toBe(0);
    env.pageshow(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(env.sent).toHaveLength(1);
    env.pageshow(true);
    expect(c.snapshot()).toMatchObject({ ringDirty: 2, stats: expect.objectContaining({ bfcacheRestores: 1 }) });
    await vi.advanceTimersByTimeAsync(250);
    expect(env.sent).toHaveLength(2);
    expect(env.sent[1]?.batch.batchSeq).toBe(2);
    expect(env.sent[1]?.batch.observations.map((o) => [o.techniqueId, o.count])).toEqual([['DET-007', 3], ['DET-001', 2]]);
    // The sensor keeps its cumulative total (3 before + 1 after the restore); only the growth is re-keyed.
    env.emit(sensorBatch('b', 2, [obs({ count: 4 })]));
    await vi.advanceTimersByTimeAsync(250);
    const after = env.sent[2]?.batch.observations;
    expect(after).toEqual([{ ...obs({ count: 1 }), signalCodes: ['api-use', 'bfcache-restore'] }]);
    expect(c.snapshot().ringSize).toBe(3);
  });

  it('pagehide flushes immediately without waiting for the timer', async () => {
    const env = new FakeEnv();
    const c = startCollector(env);
    env.emit(sensorHello('b'));
    env.emit(sensorBatch('b', 1, [obs()]));
    env.pagehide(true);
    expect(env.sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(c.snapshot().ringDirty).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(env.sent).toHaveLength(1);
  });

  it('pagehide does not allocate another native promise while a batch remains in flight', async () => {
    const env = new FakeEnv();
    startCollector(env);
    env.emit(sensorHello('b'));
    env.respond = never;
    env.emit(sensorBatch('b', 1, [obs()]));
    await vi.advanceTimersByTimeAsync(250);
    env.pagehide(true);
    expect(env.sent.map((s) => s.batch.batchSeq)).toEqual([1]);
  });

  it('pagehide while paused or with nothing dirty sends nothing', () => {
    const env = new FakeEnv();
    const c = startCollector(env);
    env.emit(sensorHello('b'));
    env.pagehide(true);
    c.pause();
    env.emit(sensorBatch('b', 1, [obs()]));
    env.pagehide(true);
    expect(env.sent).toHaveLength(0);
  });
});

describe('bridge-control (SW -> bridge, ADR-004 changelog, F030)', () => {
  const control = (command: string): Record<string, unknown> => ({ schemaVersion: 1, type: 'bridge-control', command });

  it('resume control reaches a paused bridge that would never see an Ack; pause control pauses', async () => {
    const env = new FakeEnv();
    const c = startCollector(env);
    env.emit(sensorHello('b'));
    env.emit(sensorBatch('b', 1, [obs()]));
    await vi.advanceTimersByTimeAsync(250);
    expect(env.sent).toHaveLength(1);

    env.control(control('pause'));
    expect(c.snapshot().state).toBe('paused');
    expect(env.postedOfType('bridge-pause')).toHaveLength(1);
    env.emit(sensorBatch('b', 2, [obs({ count: 5 })]));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(env.sent).toHaveLength(1); // paused: nothing is sent, so no Ack could ever carry paused:false

    env.control(control('resume'));
    expect(c.snapshot().state).toBe('active');
    expect(env.postedOfType('bridge-resume')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(env.sent).toHaveLength(2);
    expect(env.sent[1]?.batch.coverageDelta).toEqual(['paused']);
    env.emit(sensorBatch('b', 3, [obs({ count: 5 })]));
    await vi.advanceTimersByTimeAsync(250);
    expect(env.sent[2]?.batch.observations[0]?.count).toBe(5);
    expect(c.snapshot()).toMatchObject({ ringDirty: 0, pendingCoverage: [] });
  });

  it('control from a non-extension sender, with a bad shape or after stop is ignored', () => {
    const env = new FakeEnv();
    const c = startCollector(env);
    env.emit(sensorHello('b'));
    env.control(control('pause'), false);
    env.control({ channel: 'detect.expert/v1', sensorBootId: 'b', type: 'bridge-pause' });
    env.control({ ...control('pause'), extra: 1 });
    env.control(control('restart'));
    env.control(control('stop'), false);
    expect(c.snapshot().state).toBe('active');
    expect(env.postedOfType('bridge-pause')).toEqual([]);
    c.stop('unload');
    env.control(control('resume'));
    expect(c.snapshot().state).toBe('stopped');
    expect(env.postedOfType('bridge-resume')).toEqual([]);
  });

  it.each([false, true])('P05 trusted stop is terminal without a new batch (paused=%s)', async (paused) => {
    const env = new FakeEnv();
    const c = startCollector(env);
    env.emit(sensorHello('b'));
    if (paused) env.control(control('pause'));
    env.control(control('stop'));
    env.control(control('stop'));
    expect(c.snapshot().state).toBe('stopped');
    expect(env.postedOfType('bridge-stop')).toEqual([expect.objectContaining({ sensorBootId: 'b', reason: 'revoked' })]);
    env.control(control('resume'));
    env.emit(sensorBatch('b', 1, [obs()]));
    await vi.advanceTimersByTimeAsync(5000);
    expect(c.snapshot().state).toBe('stopped');
    expect(env.sent).toEqual([]);
  });

  it('P05 an in-flight ACK cannot undo a terminal stop', async () => {
    const env = new FakeEnv();
    let resolveAck!: (value: unknown) => void;
    env.respond = () => new Promise((resolve) => { resolveAck = resolve; });
    const c = startCollector(env);
    env.emit(sensorHello('b'));
    env.emit(sensorBatch('b', 1, [obs()]));
    await vi.advanceTimersByTimeAsync(250);
    expect(env.sent).toHaveLength(1);
    env.control(control('stop'));
    resolveAck(ackFor(env.sent[0]!.batch));
    await vi.advanceTimersByTimeAsync(5000);
    expect(c.snapshot().state).toBe('stopped');
    expect(env.postedOfType('bridge-stop')).toHaveLength(1);
    expect(env.postedOfType('bridge-resume')).toEqual([]);
    expect(env.sent).toHaveLength(1);
  });
});
