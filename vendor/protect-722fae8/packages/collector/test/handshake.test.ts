import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION } from '@detect-expert/contracts';
import { startCollector, UNBOUND_SENSOR_BOOT_ID } from '../src/index';
import { FakeEnv, obs, sensorBatch, sensorHello } from './fake-env';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('handshake', () => {
  it('bridge first: unbound hellos every 100 ms until sensor-hello, then one bound hello and no more retries', async () => {
    const env = new FakeEnv();
    const c = startCollector(env);
    expect(env.postedOfType('bridge-hello')).toHaveLength(1);
    expect(env.posted[0]).toMatchObject({ type: 'bridge-hello', sensorBootId: UNBOUND_SENSOR_BOOT_ID, protocolVersion: PROTOCOL_VERSION, paused: false });
    await vi.advanceTimersByTimeAsync(350);
    expect(env.postedOfType('bridge-hello')).toHaveLength(4);
    env.emit(sensorHello('boot-A'));
    const hellos = env.postedOfType('bridge-hello');
    expect(hellos).toHaveLength(5);
    expect(hellos[4]).toMatchObject({ sensorBootId: 'boot-A', bridgeSessionId: c.snapshot().bridgeSessionId });
    await vi.advanceTimersByTimeAsync(5000);
    expect(env.postedOfType('bridge-hello')).toHaveLength(5);
    expect(c.snapshot().sensorBootIds).toEqual(['boot-A']);
  });

  it('sensor first: sensor-hello right after start binds immediately and cancels retries', async () => {
    const env = new FakeEnv();
    const c = startCollector(env);
    env.emit(sensorHello('boot-B', { startedLate: true, coverageFlags: ['unsupported-realm'] }));
    expect(env.postedOfType('bridge-hello').map((m) => m.sensorBootId)).toEqual([UNBOUND_SENSOR_BOOT_ID, 'boot-B']);
    await vi.advanceTimersByTimeAsync(2000);
    expect(env.postedOfType('bridge-hello')).toHaveLength(2);
    // Hello diagnostics go out at once as a coverage-only batch (no observation is invented for them).
    expect(env.sent).toHaveLength(1);
    expect(env.sent[0]?.batch).toMatchObject({ sensorBootId: 'boot-B', observations: [] });
    expect([...(env.sent[0]?.batch.coverageDelta ?? [])].sort()).toEqual(['late-start', 'unsupported-realm']);
    expect(c.snapshot().pendingCoverage).toEqual([]);
  });

  it('no sensor: exactly 10 unbound hellos, then silence; a late sensor-hello still binds', async () => {
    const env = new FakeEnv();
    const c = startCollector(env);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(env.postedOfType('bridge-hello')).toHaveLength(10);
    env.emit(sensorHello('boot-late'));
    expect(env.postedOfType('bridge-hello')).toHaveLength(11);
    expect(c.snapshot().sensorBootIds).toEqual(['boot-late']);
  });

  it('a repeated sensor-hello from a known boot gets no second bound hello (no ping-pong)', () => {
    const env = new FakeEnv();
    startCollector(env);
    env.emit(sensorHello('boot-A'));
    env.emit(sensorHello('boot-A'));
    env.emit(sensorHello('boot-A'));
    expect(env.postedOfType('bridge-hello')).toHaveLength(2);
  });

  it('protocol mismatch in sensor-hello: bridge-stop to that boot, its batches are dropped', async () => {
    const env = new FakeEnv();
    const c = startCollector(env);
    env.emit(sensorHello('boot-v2', { protocolVersion: PROTOCOL_VERSION + 1 }));
    expect(env.postedOfType('bridge-stop')).toEqual([expect.objectContaining({ sensorBootId: 'boot-v2', reason: 'protocol-mismatch' })]);
    env.emit(sensorBatch('boot-v2', 1, [obs()]));
    await vi.advanceTimersByTimeAsync(1000);
    // Nothing of the incompatible sensor is forwarded; the SW only learns the diagnostics (coverage-only batch).
    expect(env.sent).toHaveLength(1);
    expect(env.sent[0]?.batch.observations).toEqual([]);
    expect(env.sent[0]?.batch.sensorBootId).toBe(UNBOUND_SENSOR_BOOT_ID);
    expect(env.sent[0]?.batch.coverageDelta).toEqual(expect.arrayContaining(['protocol-mismatch', 'throttled']));
    const snap = c.snapshot();
    expect(snap.stats.droppedUnknownBoot).toBe(1);
    expect(snap.stats.protocolMismatches).toBe(1);
    expect(snap.state).toBe('active');
  });

  it('batches from a boot that never said hello are dropped and counted', async () => {
    const env = new FakeEnv();
    const c = startCollector(env);
    env.emit(sensorBatch('boot-ghost', 1, [obs()]));
    await vi.advanceTimersByTimeAsync(1000);
    // The observation never reaches the SW; the rejection itself is reported as `throttled` (ADR-004 §6).
    expect(env.sent).toHaveLength(1);
    expect(env.sent[0]?.batch.observations).toEqual([]);
    expect(env.sent[0]?.batch.coverageDelta).toContain('throttled');
    expect(c.snapshot().stats.droppedUnknownBoot).toBe(1);
    expect(c.snapshot().stats.observationsAccepted).toBe(0);
  });

  it('the known-boot set is bounded (oldest boot forgotten)', () => {
    const env = new FakeEnv();
    const c = startCollector(env, { maxKnownBoots: 2 });
    env.emit(sensorHello('b1'));
    env.emit(sensorHello('b2'));
    env.emit(sensorHello('b3'));
    expect(c.snapshot().sensorBootIds).toEqual(['b2', 'b3']);
  });
});
