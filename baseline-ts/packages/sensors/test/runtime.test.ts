// SensorRuntime: counters, budgets, batching, bridge protocol, pause/stop (REQ-011/012, ADR-006 §7-8, task E06-02).

import { describe, expect, it } from 'vitest';
import { API_OPERATION_DEFINITIONS, BUDGETS, MAX_COUNT, PROTOCOL_VERSION, UNBOUND_SENSOR_BOOT_ID, validateSensorMessage } from '@detect-expert/contracts';
import { PHASE_INDEX, SIGNAL_BIT, STARTUP_QUEUE_MAX, SensorRuntime, TECHNIQUE_INDEX, wrapMethod } from '../src/index';
import { API_OPERATION_INDEX, compositeKey, decodeKey, operationKey } from '../src/codes';
import type { HookHandle } from '../src/index';
import { bridgeHello, bridgeSimple, bridgeStop, deliver, makeEnv } from './helpers';

const T1 = TECHNIQUE_INDEX['DET-001'];
const T2 = TECHNIQUE_INDEX['DET-002'];
const P_RET = PHASE_INDEX['returned-sync'];
const P_ATT = PHASE_INDEX['attempted'];
const S_API = SIGNAL_BIT['api-use'];

/** Distinct filler keys over DET-002..DET-069 x 5 phases (DET-001 is reserved for fold-target cases). */
function distinctKey(i: number): [number, number, number] {
  return [1 + (i % 68), Math.floor(i / 68) % 5, S_API];
}

function started(options?: { startedLate?: boolean }): { fake: ReturnType<typeof makeEnv>; runtime: SensorRuntime } {
  const fake = makeEnv(options);
  const runtime = new SensorRuntime(fake.env);
  runtime.start();
  return { fake, runtime };
}

function handshake(fake: ReturnType<typeof makeEnv>, runtime: SensorRuntime, paused = false): void {
  deliver(fake, bridgeHello(runtime, { paused }));
}

describe('boot and hello', () => {
  it('runs bounded resource cleanups once and restores hooks despite a cleanup failure', () => {
    const { runtime } = started();
    let cleaned = 0;
    const target = { method() { return 7; } };
    const original = target.method;
    runtime.attach([wrapMethod(target, 'method', () => undefined, { context: runtime.hooks })]);
    runtime.onStop(() => { cleaned++; throw new Error('cleanup failure'); });
    runtime.onStop(() => { cleaned++; });
    expect(runtime.stop('local').cleanup).toBe('complete');
    runtime.stop('local');
    expect(cleaned).toBe(2);
    expect(target.method).toBe(original);
    runtime.onStop(() => { cleaned++; });
    expect(cleaned).toBe(3);
  });
  it('has a boot id in the wire id alphabet and announces itself with a valid sensor-hello', () => {
    const { fake, runtime } = started();
    expect(runtime.sensorBootId).toMatch(/^boot-[0-9a-f]{24}$/);
    const msgs = fake.messages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ type: 'sensor-hello', protocolVersion: PROTOCOL_VERSION, startedLate: false, coverageFlags: [] });
    expect(fake.listenerCount('message')).toBe(1);
    expect(fake.listenerCount('pagehide')).toBe(1);
  });

  it('reports late-start in the hello when installed after document scripts may have run', () => {
    const { fake } = started({ startedLate: true });
    expect(fake.messages()[0]).toMatchObject({ type: 'sensor-hello', startedLate: true, coverageFlags: ['late-start'] });
  });

  it('start() is idempotent', () => {
    const { fake, runtime } = started();
    runtime.start();
    expect(fake.posted).toHaveLength(1);
    expect(fake.listenerCount('message')).toBe(1);
  });

  it('re-announces itself on the unbound bridge-hello of a bridge that started after our hello; quiet once handshaken', () => {
    const { fake, runtime } = started();
    deliver(fake, bridgeHello(runtime, { sensorBootId: UNBOUND_SENSOR_BOOT_ID }));
    const hellos = fake.messages().filter((m) => m.type === 'sensor-hello');
    expect(hellos).toHaveLength(2);
    expect(hellos[1]).toMatchObject({ sensorBootId: runtime.sensorBootId, protocolVersion: PROTOCOL_VERSION });
    expect(runtime.snapshot().handshake).toBe(false);
    // Other unbound bridge messages are routing noise: ignored.
    deliver(fake, { ...bridgeSimple(runtime, 'bridge-pause'), sensorBootId: UNBOUND_SENSOR_BOOT_ID });
    expect(runtime.hooks.enabled).toBe(true);
    handshake(fake, runtime);
    deliver(fake, bridgeHello(runtime, { sensorBootId: UNBOUND_SENSOR_BOOT_ID }));
    expect(fake.messages().filter((m) => m.type === 'sensor-hello')).toHaveLength(2);
    expect(runtime.snapshot().handshake).toBe(true);
  });
});

describe('counters before the handshake (startup queue)', () => {
  it('keeps at most 32 distinct aggregates, still increments existing ones, counts the rest as dropped', () => {
    const { fake, runtime } = started();
    for (let i = 0; i < 40; i++) runtime.record(...distinctKey(i));
    runtime.record(...distinctKey(0));
    const snap = runtime.snapshot();
    expect(snap.size).toBe(STARTUP_QUEUE_MAX);
    expect(snap.dropped).toBe(8);
    expect(snap.flags).toContain('budget-exceeded');
    expect(snap.counters.find((c) => c.techniqueId === 'DET-002' && c.phase === 'attempted')?.count).toBe(2);
    expect(fake.batches()).toHaveLength(0); // nothing is posted before the bridge answered
    expect(fake.pendingTimers()).toBe(0);
  });

  it('flushes the queue immediately on bridge-hello, in batches of <= 32, then reports dropped via sensor-status', () => {
    const { fake, runtime } = started();
    for (let i = 0; i < 40; i++) runtime.record(...distinctKey(i));
    handshake(fake, runtime);
    const batches = fake.batches();
    expect(batches).toHaveLength(1);
    expect(batches[0]!.sensorSeq).toBe(1);
    expect(batches[0]!.observations).toHaveLength(32);
    expect(batches[0]!.coverageDelta).toEqual(['budget-exceeded']);
    const statuses = fake.statuses();
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({ state: 'active', coverageFlags: ['budget-exceeded'], droppedSinceLast: 8 });
    expect(runtime.snapshot().dropped).toBe(0);
  });
});

describe('batching after the handshake', () => {
  it('keeps operation keys disjoint from legacy namespaces and rejects invalid operation phases', () => {
    const keys = new Set<number>();
    for (const [index, definition] of API_OPERATION_DEFINITIONS.entries()) {
      for (const phase of ['threw-sync', definition[3] === 'async-call' ? 'settlement-unobserved' : 'returned-sync'] as const) {
        const key = operationKey(index, PHASE_INDEX[phase]);
        expect(key).toBeGreaterThanOrEqual(2 ** 31);
        expect(keys.has(key)).toBe(false); keys.add(key);
        expect(decodeKey(key)).toEqual({ techniqueId: definition[1], apiOperation: definition[0], phase, signalCodes: ['api-use'] });
      }
      expect(decodeKey(operationKey(index, PHASE_INDEX['attempted']))).toBeNull();
      expect(decodeKey(operationKey(index, 7))).toBeNull();
    }
    expect(decodeKey(operationKey(API_OPERATION_DEFINITIONS.length, 1))).toBeNull();
    expect(decodeKey(operationKey(0, 1) + 0.5)).toBeNull();
    expect(decodeKey(compositeKey(T2, P_RET, S_API))).toEqual({ techniqueId: 'DET-002', phase: 'returned-sync', signalCodes: ['api-use'] });
  });

  it('emits separate operation totals under the existing batching and pause controls', () => {
    const { fake, runtime } = started(); handshake(fake, runtime);
    runtime.recordOperation(API_OPERATION_INDEX['GPUAdapter.info'], P_RET);
    runtime.recordOperation(API_OPERATION_INDEX['GPUAdapter.info'], P_RET);
    runtime.recordOperation(API_OPERATION_INDEX['GPUDevice.adapterInfo'], P_RET);
    runtime.record(TECHNIQUE_INDEX['DET-013'], P_RET, S_API);
    fake.advance(250);
    expect(fake.batches()[0]?.observations).toEqual(expect.arrayContaining([
      expect.objectContaining({ techniqueId: 'DET-013', apiOperation: 'GPUAdapter.info', count: 2 }),
      expect.objectContaining({ techniqueId: 'DET-013', apiOperation: 'GPUDevice.adapterInfo', count: 1 }),
    ]));
    expect(fake.batches()[0]?.observations).toHaveLength(3);
    expect(validateSensorMessage(fake.batches()[0]).ok).toBe(true);
    runtime.pause(); runtime.recordOperation(API_OPERATION_INDEX['GPUAdapter.info'], P_RET);
    runtime.resume(); runtime.recordOperation(API_OPERATION_INDEX['GPUAdapter.info'], P_RET);
    fake.advance(250);
    expect(fake.batches().at(-1)?.observations).toEqual([expect.objectContaining({ apiOperation: 'GPUAdapter.info', count: 3 })]);
    runtime.stop('local'); runtime.recordOperation(API_OPERATION_INDEX['GPUAdapter.info'], P_RET);
    expect(runtime.snapshot().counters.find(counter => counter.apiOperation === 'GPUAdapter.info')?.count).toBe(3);
  });

  it('applies the same 128-counter budget to detailed operations with explicit loss', () => {
    const { fake, runtime } = started(); handshake(fake, runtime);
    for (const [index, definition] of API_OPERATION_DEFINITIONS.entries()) {
      runtime.recordOperation(index, PHASE_INDEX['threw-sync']);
      runtime.recordOperation(index, PHASE_INDEX[definition[3] === 'async-call' ? 'settlement-unobserved' : 'returned-sync']);
    }
    expect(runtime.snapshot().size).toBe(128);
    expect(runtime.snapshot().dropped).toBe(API_OPERATION_DEFINITIONS.length * 2 - 128);
    expect(runtime.snapshot().flags).toContain('budget-exceeded');
    fake.advance(250);
    expect(fake.batches()).toHaveLength(4);
    expect(fake.batches().every(batch => validateSensorMessage(batch).ok)).toBe(true);
  });

  it('posts at most every 250 ms, cumulative counts, monotonic sensorSeq, no allocation of new keys', () => {
    const { fake, runtime } = started();
    handshake(fake, runtime);
    expect(fake.batches()).toHaveLength(0);
    runtime.record(T2, P_RET, S_API);
    runtime.record(T2, P_RET, S_API);
    fake.advance(BUDGETS.flushMinMs - 1);
    expect(fake.batches()).toHaveLength(0);
    fake.advance(1);
    let batches = fake.batches();
    expect(batches).toHaveLength(1);
    expect(batches[0]!.sensorSeq).toBe(1);
    expect(batches[0]!.observations).toEqual([
      { techniqueId: 'DET-002', count: 2, countQuality: 'exact', phase: 'returned-sync', signalCodes: ['api-use'], intervalBucket: 0 },
    ]);
    expect(batches[0]!.coverageDelta).toEqual([]);
    expect(fake.pendingTimers()).toBe(0);
    // Same key again later: cumulative total, a later bucket, next sequence number.
    fake.advance(1000);
    runtime.record(T2, P_RET, S_API);
    fake.advance(BUDGETS.flushMinMs);
    batches = fake.batches();
    expect(batches).toHaveLength(2);
    expect(batches[1]!.sensorSeq).toBe(2);
    expect(batches[1]!.observations[0]).toMatchObject({ count: 3, intervalBucket: 5 });
    expect(fake.statuses()).toHaveLength(0);
  });

  it('never exceeds 32 observations per batch and 128 keys per document group', () => {
    const { fake, runtime } = started();
    handshake(fake, runtime);
    for (let i = 0; i < 200; i++) runtime.record(...distinctKey(i));
    const snap = runtime.snapshot();
    expect(snap.size).toBe(BUDGETS.maxCountersPerDocumentGroup);
    expect(snap.dropped).toBe(200 - 128);
    fake.advance(BUDGETS.flushMinMs);
    const batches = fake.batches();
    expect(batches.map((b) => b.observations.length)).toEqual([32, 32, 32, 32]);
    expect(batches.map((b) => b.sensorSeq)).toEqual([1, 2, 3, 4]);
    expect(fake.statuses().at(-1)).toMatchObject({ droppedSinceLast: 72, coverageFlags: ['budget-exceeded'] });
  });

  it('folds an overflowing key into the technique attempted aggregate as a lower bound when it exists', () => {
    const { fake, runtime } = started();
    handshake(fake, runtime);
    runtime.record(T1, P_ATT, 0); // fold target for DET-001 (1 key)
    for (let i = 0; i < 127; i++) runtime.record(...distinctKey(i)); // + 127 keys over DET-002.. = 128
    expect(runtime.snapshot().size).toBe(128);
    runtime.record(T1, P_RET, S_API | SIGNAL_BIT['readback-after-text']); // new DET-001 key -> folded
    runtime.record(T2, P_RET, S_API | SIGNAL_BIT['readback-after-text']); // new DET-002 key, no fold target -> dropped
    const after = runtime.snapshot();
    expect(after.size).toBe(128);
    const fold = after.counters.find((c) => c.techniqueId === 'DET-001' && c.phase === 'attempted');
    expect(fold).toMatchObject({ count: 2, countQuality: 'lower-bound', signalCodes: [] });
    expect(after.dropped).toBe(1);
    expect(after.flags).toContain('budget-exceeded');
  });

  it('saturates counts at 2^31-1 and marks the aggregate lower-bound', () => {
    const { runtime } = started();
    runtime.record(T2, P_RET, S_API);
    // Reach the ceiling without 2^31 calls: the private map is a plain TS field.
    const counters = (runtime as unknown as { counters: Map<number, { count: number; countQuality: string }> }).counters;
    const entry = [...counters.values()][0]!;
    entry.count = MAX_COUNT - 1;
    runtime.record(T2, P_RET, S_API);
    expect(runtime.snapshot().counters[0]).toMatchObject({ count: MAX_COUNT, countQuality: 'exact' });
    runtime.record(T2, P_RET, S_API);
    runtime.record(T2, P_RET, S_API);
    expect(runtime.snapshot().counters[0]).toMatchObject({ count: MAX_COUNT, countQuality: 'lower-bound' });
  });

  it('pagehide posts one final aggregate immediately', () => {
    const { fake, runtime } = started();
    handshake(fake, runtime);
    runtime.record(T2, P_RET, S_API);
    fake.dispatch('pagehide', {});
    expect(fake.batches()).toHaveLength(1);
    expect(fake.pendingTimers()).toBe(0);
  });

  it('an observer error surfaces as hook-failed and state degraded at the next flush', () => {
    const { fake, runtime } = started();
    handshake(fake, runtime);
    const target = { m: (): number => 1 };
    const r = wrapMethod(
      target,
      'm',
      () => {
        throw new Error('observer bug');
      },
      { context: runtime.hooks },
    );
    runtime.attach([r]);
    expect(target.m()).toBe(1);
    runtime.record(T2, P_RET, S_API);
    fake.advance(BUDGETS.flushMinMs);
    expect(fake.batches()[0]!.coverageDelta).toEqual(['hook-failed']); // the flag delta rides with the batch
    expect(fake.statuses().at(-1)).toMatchObject({ state: 'degraded', coverageFlags: ['hook-failed'] });
    expect(runtime.snapshot().observerErrors).toBe(1);
  });
});

describe('pause / resume', () => {
  it('bridge-pause stops counting and posting; bridge-resume restarts both', () => {
    const { fake, runtime } = started();
    handshake(fake, runtime);
    runtime.record(T2, P_RET, S_API);
    expect(fake.pendingTimers()).toBe(1);
    deliver(fake, bridgeSimple(runtime, 'bridge-pause'));
    expect(runtime.hooks.enabled).toBe(false);
    expect(fake.pendingTimers()).toBe(0);
    expect(fake.statuses().at(-1)).toMatchObject({ state: 'paused', coverageFlags: ['paused'] });
    runtime.record(T2, P_RET, S_API);
    runtime.record(T1, P_RET, S_API);
    expect(runtime.snapshot().size).toBe(1);
    fake.advance(5000);
    expect(fake.batches()).toHaveLength(0);
    deliver(fake, bridgeSimple(runtime, 'bridge-resume'));
    expect(runtime.hooks.enabled).toBe(true);
    expect(fake.statuses().at(-1)).toMatchObject({ state: 'active', coverageFlags: ['paused'] });
    fake.advance(BUDGETS.flushMinMs);
    const batches = fake.batches();
    expect(batches).toHaveLength(1);
    expect(batches[0]!.observations[0]).toMatchObject({ techniqueId: 'DET-002', count: 1 });
    expect(batches[0]!.coverageDelta).toEqual(['paused']);
  });

  it('a paused bridge-hello starts paused and keeps the queue until resume', () => {
    const { fake, runtime } = started();
    runtime.record(T2, P_RET, S_API);
    handshake(fake, runtime, true);
    expect(runtime.hooks.enabled).toBe(false);
    expect(fake.batches()).toHaveLength(0);
    expect(fake.statuses().at(-1)).toMatchObject({ state: 'paused' });
    deliver(fake, bridgeSimple(runtime, 'bridge-resume'));
    fake.advance(BUDGETS.flushMinMs);
    expect(fake.batches()).toHaveLength(1);
  });

  it('pause and resume are idempotent and post nothing before the handshake', () => {
    const { fake, runtime } = started();
    runtime.pause();
    runtime.pause();
    runtime.resume();
    runtime.resume();
    expect(fake.posted).toHaveLength(1); // only the hello
    expect(runtime.snapshot().flags).toEqual(['paused']);
  });
});

describe('bridge message routing (page-forgeable, routing only)', () => {
  it('ignores messages from another source, another channel, another boot id or malformed data', () => {
    const { fake, runtime } = started();
    deliver(fake, bridgeHello(runtime), { other: 'window' });
    deliver(fake, { ...bridgeHello(runtime), channel: 'detect.expert/v2' });
    deliver(fake, bridgeHello(runtime, { sensorBootId: 'boot-000000000000000000000000' }));
    deliver(fake, { ...bridgeHello(runtime), extra: 1 });
    deliver(fake, null);
    deliver(fake, 'bridge-hello');
    fake.dispatch('message', null);
    fake.dispatch('message', { source: fake.self });
    expect(runtime.snapshot().handshake).toBe(false);
    expect(runtime.snapshot().state).toBe('active');
    const hostile = {
      get channel(): string {
        throw new Error('hostile getter');
      },
    };
    deliver(fake, hostile);
    expect(runtime.snapshot().handshake).toBe(false);
  });

  it('F047: ignores an incompatible forged hello and accepts the later compatible handshake', () => {
    const { fake, runtime } = started();
    runtime.record(T2, P_RET, S_API);
    deliver(fake, bridgeHello(runtime, { protocolVersion: PROTOCOL_VERSION + 1 }));
    expect(runtime.snapshot()).toMatchObject({ state: 'active', handshake: false, flags: [] });
    expect(runtime.hooks.enabled).toBe(true);
    expect(fake.batches()).toHaveLength(0);
    expect(fake.listenerCount('message')).toBe(1);
    deliver(fake, bridgeHello(runtime));
    expect(runtime.snapshot().handshake).toBe(true);
    expect(fake.batches()[0]!.observations[0]).toMatchObject({ count: 1, techniqueId: 'DET-002' });
  });

  it('F047: explicit protocol stop before handshake posts a final status and restores owned hooks', () => {
    const { fake, runtime } = started();
    const target = { m: () => 1 };
    const original = target.m;
    runtime.attach([wrapMethod(target, 'm', () => undefined, { context: runtime.hooks })]);
    deliver(fake, bridgeStop(runtime, 'protocol-mismatch'));
    expect(target.m).toBe(original);
    expect(fake.statuses().at(-1)).toMatchObject({ state: 'stopped', coverageFlags: ['protocol-mismatch'] });
  });

  it('a duplicate bridge-hello is ignored', () => {
    const { fake, runtime } = started();
    handshake(fake, runtime);
    handshake(fake, runtime, true);
    expect(runtime.hooks.enabled).toBe(true);
  });
});

describe('stop and ownership-checked restore', () => {
  function hooked(runtime: SensorRuntime): { owned: { m: () => number }; replaced: { m: () => number }; handles: HookHandle[] } {
    const owned = { m: (): number => 1 };
    const replaced = { m: (): number => 2 };
    const r1 = wrapMethod(owned, 'm', () => runtime.record(T1, P_RET, S_API), { context: runtime.hooks });
    const r2 = wrapMethod(replaced, 'm', () => runtime.record(T2, P_RET, S_API), { context: runtime.hooks });
    runtime.attach([r1, r2]);
    if (r1.status !== 'installed' || r2.status !== 'installed') throw new Error('hooks not installed');
    return { owned, replaced, handles: [r1, r2] };
  }

  it('bridge-stop(revoked): final aggregate, restore what we own, report what the page kept', () => {
    const { fake, runtime } = started();
    handshake(fake, runtime);
    const { owned, replaced, handles } = hooked(runtime);
    const ours = replaced.m;
    const pageWrapper = (): number => ours.call(replaced);
    replaced.m = pageWrapper;
    owned.m();
    replaced.m();
    expect(runtime.snapshot().size).toBe(2);
    const originalOwned = handles[0]!;
    deliver(fake, bridgeStop(runtime, 'revoked'));
    const batches = fake.batches();
    expect(batches).toHaveLength(1);
    expect(batches[0]!.observations).toHaveLength(2);
    expect(batches[0]!.coverageDelta).toEqual(['revoked']);
    expect(fake.statuses().at(-1)).toMatchObject({ state: 'stopped', coverageFlags: ['revoked'] });
    expect(originalOwned.isOwned()).toBe(false);
    expect(owned.m).not.toBe(ours);
    expect(replaced.m).toBe(pageWrapper);
    expect(runtime.hooks.enabled).toBe(false);
    expect(fake.listenerCount('message')).toBe(0);
    expect(fake.listenerCount('pagehide')).toBe(0);
    // Stopped is final: the page's resume forgery and further calls change nothing.
    const posted = fake.posted.length;
    deliver(fake, bridgeSimple(runtime, 'bridge-resume'));
    owned.m();
    replaced.m();
    expect(runtime.hooks.enabled).toBe(false);
    expect(fake.posted).toHaveLength(posted);
  });

  it('stop() returns the cleanup report and is idempotent', () => {
    const { fake, runtime } = started();
    handshake(fake, runtime);
    const { replaced } = hooked(runtime);
    const ours = replaced.m;
    replaced.m = () => ours.call(replaced);
    const result = runtime.stop('local');
    expect(result).toEqual({ reason: 'local', restored: ['m'], notRestored: ['m'], cleanup: 'partial' });
    expect(runtime.stop('revoked')).toBe(result);
    expect(runtime.snapshot().flags).not.toContain('revoked');
  });

  it('stop with no hooks reports cleanup none; stop with all hooks owned reports complete', () => {
    const a = new SensorRuntime(makeEnv().env);
    expect(a.stop('local').cleanup).toBe('none');
    const { runtime } = started();
    hooked(runtime);
    expect(runtime.stop('unload').cleanup).toBe('complete');
  });
});

describe('hot path cost (measurement, generous bound)', () => {
  it('increments an existing key one million times without growing the map', () => {
    const { fake, runtime } = started();
    handshake(fake, runtime);
    runtime.record(T2, P_RET, S_API);
    const t0 = performance.now();
    for (let i = 0; i < 1_000_000; i++) runtime.record(T2, P_RET, S_API);
    const elapsed = performance.now() - t0;
    console.log('record() existing key: ' + (elapsed * 1000 / 1_000_000).toFixed(3) + ' us/call (' + elapsed.toFixed(1) + ' ms per 1e6)');
    expect(runtime.snapshot().size).toBe(1);
    expect(runtime.snapshot().counters[0]!.count).toBe(1_000_001);
    expect(fake.pendingTimers()).toBe(1);
    expect(elapsed).toBeLessThan(5000);
  });
});
