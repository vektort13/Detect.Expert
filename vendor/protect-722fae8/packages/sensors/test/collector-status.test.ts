// F045/F048: sensor status traverses the current collector after its observation ring is ACKed and clean.
import { expect, it, vi } from 'vitest';
import { startCollector } from '../../collector/src/collector';
import { FakeEnv } from '../../collector/test/fake-env';
import { SensorRuntime, wrapMethod } from '../src/index';
import { bridgeHello, bridgeSimple, bridgeStop, deliver, makeEnv } from './helpers';

it.each(['observer-error', 'forged-pause', 'forged-stop'] as const)('delivers %s coverage through a clean collector ring', async (kind) => {
  vi.useFakeTimers();
  try {
    const sensorEnv = makeEnv();
    const collectorEnv = new FakeEnv();
    const collector = startCollector(collectorEnv);
    sensorEnv.env.postMessage = (message) => collectorEnv.emit(message);
    const runtime = new SensorRuntime(sensorEnv.env);
    runtime.start();
    deliver(sensorEnv, bridgeHello(runtime));
    runtime.record(1, 1, 1);
    sensorEnv.advance(250);
    await vi.advanceTimersByTimeAsync(250);
    expect(collector.snapshot().ringDirty).toBe(0);
    expect(collectorEnv.sent).toHaveLength(1);
    if (kind === 'observer-error') {
      const target = { m: () => 7 };
      runtime.attach([wrapMethod(target, 'm', () => { throw new Error('observer failed before recording'); }, { context: runtime.hooks })]);
      expect(target.m()).toBe(7);
      sensorEnv.advance(250);
    } else if (kind === 'forged-pause') deliver(sensorEnv, bridgeSimple(runtime, 'bridge-pause'));
    else deliver(sensorEnv, bridgeStop(runtime, 'revoked'));
    await vi.advanceTimersByTimeAsync(250);
    expect(collectorEnv.sent).toHaveLength(2);
    expect(collectorEnv.sent[1]!.batch.coverageDelta).toContain(kind === 'observer-error' ? 'hook-failed' : 'channel-gap');
    expect(collectorEnv.sent[1]!.batch.observations[0]!.count).toBe(1);
    expect(collector.snapshot().state).toBe('active'); // Diagnostic traffic cannot change privileged pause policy.
  } finally { vi.useRealTimers(); }
});
