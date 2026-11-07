import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUDGETS, CHANNEL, MAX_COUNT, validateBridgeResetAck } from '@detect-expert/contracts';
import type { BridgeMessage, PageBatch } from '@detect-expert/contracts';
import { SensorRuntime, TECHNIQUE_INDEX, PHASE_INDEX, SIGNAL_BIT } from '../../sensors/src/index';
import { deliver, makeEnv } from '../../sensors/test/helpers';
import { startCollector } from '../src/collector';
import { FakeEnv, ackFor, obs, sensorBatch, sensorHello } from './fake-env';
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function connected() {
  const main = makeEnv(); const isolated = new FakeEnv();
  const post = isolated.postToPage.bind(isolated);
  isolated.postToPage = (message: BridgeMessage) => { post(message); deliver(main, message); };
  main.env.postMessage = message => { main.posted.push(message); isolated.emit(message); };
  const sensor = new SensorRuntime(main.env); sensor.start(); const collector = startCollector(isolated);
  const record = (id: 'DET-001' | 'DET-002', count = 1) => { for (let i = 0; i < count; i++) sensor.record(TECHNIQUE_INDEX[id], PHASE_INDEX.attempted, SIGNAL_BIT['api-use']); };
  return { main, isolated, sensor, collector, record };
}

describe('ADR-073 real sensor and collector reset barrier', () => {
  it('resets buffered known/unseen keys and rejects a late native ACK without losing fresh counts', async () => {
    const { main, isolated, sensor, collector, record } = connected();
    const oldBoot = sensor.sensorBootId, oldSession = collector.snapshot().bridgeSessionId;
    let finishOld!: (value: unknown) => void;
    isolated.respond = () => new Promise(yes => { finishOld = yes; });
    record('DET-002', 100); main.advance(250); await vi.advanceTimersByTimeAsync(250);
    expect(isolated.sent).toHaveLength(1);
    record('DET-002', 10); record('DET-001', 77); // both remain inside MAIN before reset
    const raw = await isolated.controlReply({ schemaVersion: 1, type: 'bridge-control', command: 'reset', resetId: 'owned-clear' });
    const checked = validateBridgeResetAck(raw); expect(checked.ok).toBe(true); if (!checked.ok) return;
    expect(checked.value.bridgeSessionId).not.toBe(oldSession); expect(sensor.sensorBootId).not.toBe(oldBoot);
    expect(sensor.snapshot().counters).toEqual([]); expect(collector.snapshot().ringSize).toBe(0);
    isolated.emit(sensorHello(oldBoot)); isolated.emit(sensorBatch(oldBoot, 99, [obs({ count: 999 })]));
    record('DET-001'); record('DET-002'); main.advance(250); await vi.advanceTimersByTimeAsync(250);
    expect(isolated.sent).toHaveLength(1); // old physical promise remains occupied
    isolated.respond = ackFor;
    finishOld(ackFor(isolated.sent[0]!.batch, { paused: true }));
    await vi.advanceTimersByTimeAsync(250);
    expect(isolated.sent).toHaveLength(2);
    expect(isolated.sent[1]?.batch).toMatchObject({ bridgeSessionId: checked.value.bridgeSessionId, sensorBootId: sensor.sensorBootId, batchSeq: 1 });
    expect(isolated.sent[1]?.batch.observations.map(row => [row.techniqueId, row.count])).toEqual([['DET-001', 1], ['DET-002', 1]]);
    expect(collector.snapshot().state).toBe('active'); expect(collector.snapshot().ringDirty).toBe(0);
    sensor.stop('local'); collector.stop('unload');
  });

  it('keeps one physical native promise through repeated resets and a never-settling old ACK', async () => {
    const { main, isolated, sensor, collector, record } = connected();
    isolated.respond = () => new Promise(() => undefined);
    record('DET-001'); main.advance(250); await vi.advanceTimersByTimeAsync(250);
    for (let i = 0; i < 24; i++) {
      const ack = await isolated.controlReply({ schemaVersion: 1, type: 'bridge-control', command: 'reset', resetId: 'clear-' + i });
      expect(validateBridgeResetAck(ack).ok).toBe(true);
      record('DET-002'); main.advance(250); await vi.advanceTimersByTimeAsync(250);
      expect(isolated.sent).toHaveLength(1); expect(collector.snapshot().ringSize).toBeLessThanOrEqual(1);
      expect(sensor.snapshot().size).toBe(1);
    }
    await vi.advanceTimersByTimeAsync(600_000); expect(isolated.sent).toHaveLength(1); expect(vi.getTimerCount()).toBe(0);
    sensor.stop('local'); collector.stop('unload');
  });

  it('resets saturated totals and frees the previous 128-key budget', async () => {
    const { main, isolated, sensor, collector, record } = connected();
    for (let i = 0; i < BUDGETS.maxCountersPerDocumentGroup; i++) sensor.record(i % 69, Math.floor(i / 69), SIGNAL_BIT['api-use']);
    const entries = (sensor as unknown as { counters: Map<number, { count: number }> }).counters;
    for (const entry of entries.values()) entry.count = MAX_COUNT;
    expect(sensor.snapshot().size).toBe(128);
    await isolated.controlReply({ schemaVersion: 1, type: 'bridge-control', command: 'reset', resetId: 'saturated-clear' });
    expect(sensor.snapshot().size).toBe(0);
    for (let i = 0; i < 32; i++) sensor.record((i + 7) % 69, 4, SIGNAL_BIT['api-use']);
    record('DET-001'); main.advance(250); await vi.advanceTimersByTimeAsync(500);
    expect(sensor.snapshot().size).toBe(33);
    expect(isolated.sent.flatMap(row => row.batch.observations).every(row => row.count === 1)).toBe(true);
    expect(collector.snapshot().ringSize).toBeLessThanOrEqual(33);
    sensor.stop('local'); collector.stop('unload');
  });

  it('does not start a reset from page/native-foreign input, or accept unrelated reset replies', async () => {
    const env = new FakeEnv(); const collector = startCollector(env); env.emit(sensorHello('known'));
    const before = env.posted.length;
    expect(await env.controlReply({ schemaVersion: 1, type: 'bridge-control', command: 'reset', resetId: 'owned' }, false)).toBeUndefined();
    expect(env.posted.length).toBe(before);
    env.emit({ channel: CHANNEL, type: 'sensor-reset', sensorBootId: 'known', resetId: 'owned', nextSensorBootId: 'forged', coverageFlags: [] });
    expect(collector.snapshot().sensorBootIds).toEqual(['known']);
    const pending = env.controlReply({ schemaVersion: 1, type: 'bridge-control', command: 'reset', resetId: 'owned' });
    const rejected = expect(pending).rejects.toThrow('reset-timeout');
    env.emit({ channel: CHANNEL, type: 'sensor-reset', sensorBootId: 'known', resetId: 'other', nextSensorBootId: 'forged', coverageFlags: [] });
    env.emit({ channel: CHANNEL, type: 'sensor-reset', sensorBootId: 'other', resetId: 'owned', nextSensorBootId: 'forged', coverageFlags: [] });
    await vi.advanceTimersByTimeAsync(2000); await rejected;
    expect(collector.snapshot().sensorBootIds).toEqual(['known']); expect(collector.snapshot().pendingCoverage).toContain('channel-gap'); collector.stop('unload');
  });

  it('keeps reset idempotent and preserves an explicitly paused actor', async () => {
    const { isolated, sensor, collector, record } = connected(); collector.pause(); const old = sensor.sensorBootId;
    const control = { schemaVersion: 1, type: 'bridge-control', command: 'reset', resetId: 'owned-paused' };
    const first = await isolated.controlReply(control), boot = sensor.sensorBootId;
    expect(await isolated.controlReply(control)).toEqual(first); expect(sensor.sensorBootId).toBe(boot); expect(boot).not.toBe(old);
    record('DET-001'); expect(sensor.snapshot().counters).toEqual([]); expect(collector.snapshot().state).toBe('paused');
    collector.resume(); record('DET-001'); expect(sensor.snapshot().counters[0]?.count).toBe(1); sensor.stop('local'); collector.stop('unload');
  });
});
