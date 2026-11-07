// SensorRuntime: counters, budgets, batching, bridge protocol, pause/stop (REQ-011/012, ADR-006 §7-8, task E06-02),
// key layout v2 with operations, fold reserve and retirement (ADR-017 §4-5, task E06-03).

import { describe, expect, it } from 'vitest';
import { BUDGETS, INTERVAL_BUCKET_MS, MAX_COUNT, PROTOCOL_VERSION, UNBOUND_SENSOR_BOOT_ID, validateSensorMessage } from '@detect-expert/contracts';
import {
  API_USE,
  FOLD_RESERVE,
  PHASE_INDEX,
  STARTUP_QUEUE_MAX,
  SensorRuntime,
  TECHNIQUE_INDEX,
  compositeKey,
  operationIndex,
  signalBit,
  wrapGetter,
  wrapMethod,
} from '../src/index';
import type { HookHandle } from '../src/index';
import { bridgeHello, bridgeSimple, bridgeStop, deliver, makeEnv } from './helpers';

const T1 = TECHNIQUE_INDEX['DET-001'];
const T2 = TECHNIQUE_INDEX['DET-002'];
const P_RET = PHASE_INDEX['returned-sync'];
const P_ATT = PHASE_INDEX['attempted'];
const S_API = API_USE;
const S_AFTER_TEXT = signalBit('DET-002', 'readback-after-text');
const REGULAR = BUDGETS.maxCountersPerDocumentGroup - FOLD_RESERVE; // 120

/**
 * Distinct filler keys without an `attempted` aggregate: technique index i % 60 (DET-001..DET-060) x phases
 * returned-sync..settlement-unobserved. Overflowing fillers therefore need a fold target from the reserve.
 */
function regularKey(i: number): [number, number, number] {
  return [i % 60, 1 + (Math.floor(i / 60) % 4), S_API];
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
  it('keeps 128 keys before the handshake (120 regular + 8 fold targets), still increments existing ones, drops the rest', () => {
    expect(STARTUP_QUEUE_MAX).toBe(128);
    const { fake, runtime } = started();
    for (let i = 0; i < REGULAR; i++) runtime.record(...regularKey(i));
    expect(runtime.snapshot()).toMatchObject({ size: REGULAR, dropped: 0, flags: [] });
    // 8 overflows on DET-001..DET-008 (phase 3) fold into fresh (attempted, api-use) targets from the reserve.
    for (let i = REGULAR; i < REGULAR + FOLD_RESERVE; i++) runtime.record(...regularKey(i));
    runtime.record(...regularKey(REGULAR)); // the same overflow again folds into the existing DET-001 target
    runtime.record(...regularKey(REGULAR + FOLD_RESERVE)); // DET-009: no target, reserve exhausted -> dropped
    runtime.record(...regularKey(0)); // an existing regular key still increments
    const snap = runtime.snapshot();
    expect(snap.size).toBe(STARTUP_QUEUE_MAX);
    expect(snap.dropped).toBe(1);
    expect(snap.flags).toEqual(['budget-exceeded']);
    expect(snap.counters.find((c) => c.techniqueId === 'DET-001' && c.phase === 'attempted')).toMatchObject({
      count: 2,
      countQuality: 'lower-bound',
      signalCodes: ['api-use'],
    });
    expect(snap.counters.find((c) => c.techniqueId === 'DET-001' && c.phase === 'returned-sync')).toMatchObject({ count: 2, countQuality: 'exact' });
    expect(snap.counters.filter((c) => c.countQuality === 'lower-bound')).toHaveLength(FOLD_RESERVE);
    expect(fake.batches()).toHaveLength(0); // nothing is posted before the bridge answered
    expect(fake.pendingTimers()).toBe(0);
  });

  it('flushes the queue immediately on bridge-hello, in batches of <= 32, then reports dropped via sensor-status', () => {
    const { fake, runtime } = started();
    for (let i = 0; i < REGULAR + FOLD_RESERVE + 2; i++) runtime.record(...regularKey(i));
    handshake(fake, runtime);
    const batches = fake.batches();
    expect(batches.map((b) => b.observations.length)).toEqual([32, 32, 32, 32]);
    expect(batches.map((b) => b.sensorSeq)).toEqual([1, 2, 3, 4]);
    expect(batches[0]!.coverageDelta).toEqual(['budget-exceeded']);
    const statuses = fake.statuses();
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({ state: 'active', coverageFlags: ['budget-exceeded'], droppedSinceLast: 2 });
    expect(runtime.snapshot().dropped).toBe(0);
  });
});

describe('batching after the handshake', () => {
  it('S13: intervalBucket = floor((now - boot) / INTERVAL_BUCKET_MS), local ordering only', () => {
    const { fake, runtime } = started();
    handshake(fake, runtime);
    fake.advance(INTERVAL_BUCKET_MS * 3 - 1);
    runtime.record(T2, P_RET, S_API);
    fake.advance(BUDGETS.flushMinMs);
    fake.advance(1);
    runtime.record(T1, P_RET, S_API);
    fake.advance(BUDGETS.flushMinMs);
    const observations = fake.batches().flatMap((batch) => batch.observations);
    expect(observations.map((o) => [o.techniqueId, o.intervalBucket])).toEqual([['DET-002', 2], ['DET-001', 4]]);
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
    for (let i = 0; i < 200; i++) runtime.record(...regularKey(i));
    const snap = runtime.snapshot();
    expect(snap.size).toBe(BUDGETS.maxCountersPerDocumentGroup);
    // i = 120..127 fold (DET-001..008, from the reserve); 128..179 drop (DET-009..060, phase 3);
    // 180..199 = DET-001..020 phase 4: the first 8 fold into existing targets, 12 drop.
    expect(snap.dropped).toBe(52 + 12);
    fake.advance(BUDGETS.flushMinMs);
    const batches = fake.batches();
    expect(batches.map((b) => b.observations.length)).toEqual([32, 32, 32, 32]);
    expect(batches.map((b) => b.sensorSeq)).toEqual([1, 2, 3, 4]);
    expect(fake.statuses().at(-1)).toMatchObject({ droppedSinceLast: 64, coverageFlags: ['budget-exceeded'] });
  });

  it('D4-11: an overflowing key creates its (attempted, api-use) fold target from the reserve as a lower bound', () => {
    const { fake, runtime } = started();
    handshake(fake, runtime);
    for (let i = 0; i < REGULAR; i++) runtime.record(...regularKey(i));
    expect(runtime.snapshot()).toMatchObject({ size: REGULAR, flags: [] });
    runtime.record(T2, P_RET, S_API | S_AFTER_TEXT); // new DET-002 key over the regular limit -> fold target created
    runtime.record(T2, P_ATT, S_API); // the fold key itself now exists and keeps counting
    const after = runtime.snapshot();
    expect(after.size).toBe(REGULAR + 1);
    expect(after.dropped).toBe(0);
    expect(after.flags).toEqual(['budget-exceeded']);
    expect(after.counters.find((c) => c.techniqueId === 'DET-002' && c.phase === 'attempted')).toMatchObject({
      count: 2,
      countQuality: 'lower-bound',
      signalCodes: ['api-use'],
    });
    expect(after.counters.some((c) => c.techniqueId === 'DET-002' && c.signalCodes.includes('readback-after-text'))).toBe(false);
    fake.advance(BUDGETS.flushMinMs);
    const folded = fake.batches().flatMap((b) => b.observations).find((o) => o.techniqueId === 'DET-002' && o.phase === 'attempted');
    expect(folded).toEqual({ techniqueId: 'DET-002', count: 2, countQuality: 'lower-bound', phase: 'attempted', signalCodes: ['api-use'], intervalBucket: 0 });
  });

  it('exhausted reserve: a new key without a fold target is dropped and reported via droppedSinceLast', () => {
    const { fake, runtime } = started();
    handshake(fake, runtime);
    for (let i = 0; i < REGULAR + FOLD_RESERVE; i++) runtime.record(...regularKey(i)); // 120 + 8 fold targets
    expect(runtime.snapshot()).toMatchObject({ size: 128, dropped: 0 });
    runtime.record(TECHNIQUE_INDEX['DET-061'], P_RET, S_API);
    runtime.record(T1, P_RET, S_API | S_AFTER_TEXT); // DET-001 still folds into its existing target
    const snap = runtime.snapshot();
    expect(snap).toMatchObject({ size: 128, dropped: 1 });
    expect(snap.counters.find((c) => c.techniqueId === 'DET-001' && c.phase === 'attempted')?.count).toBe(2);
    fake.advance(BUDGETS.flushMinMs);
    expect(fake.statuses().at(-1)).toMatchObject({ droppedSinceLast: 1, coverageFlags: ['budget-exceeded'] });
  });

  it('ADR-017: the operation reaches the batch; a key without operation has no operationCode field', () => {
    const { fake, runtime } = started();
    handshake(fake, runtime);
    const T_WEBGL = TECHNIQUE_INDEX['DET-011'];
    runtime.record(T_WEBGL, P_RET, S_API, operationIndex('DET-011', 'param-renderer'));
    runtime.record(T_WEBGL, P_RET, S_API, operationIndex('DET-011', 'param-renderer'));
    runtime.record(T_WEBGL, P_RET, S_API, operationIndex('DET-011', 'shader-precision-format'));
    runtime.recordKey(compositeKey(T_WEBGL, P_RET, S_API)); // same technique, no operation: a separate aggregate
    runtime.record(T2, P_RET, S_API);
    fake.advance(BUDGETS.flushMinMs);
    const observations = fake.batches()[0]!.observations; // fake.messages() validated every posted message
    expect(observations).toEqual([
      { techniqueId: 'DET-011', count: 2, countQuality: 'exact', phase: 'returned-sync', signalCodes: ['api-use'], intervalBucket: 0, operationCode: 'param-renderer' },
      { techniqueId: 'DET-011', count: 1, countQuality: 'exact', phase: 'returned-sync', signalCodes: ['api-use'], intervalBucket: 0, operationCode: 'shader-precision-format' },
      { techniqueId: 'DET-011', count: 1, countQuality: 'exact', phase: 'returned-sync', signalCodes: ['api-use'], intervalBucket: 0 },
      { techniqueId: 'DET-002', count: 1, countQuality: 'exact', phase: 'returned-sync', signalCodes: ['api-use'], intervalBucket: 0 },
    ]);
    expect(Object.keys(observations[2]!)).not.toContain('operationCode');
    expect(Object.keys(observations[3]!)).not.toContain('operationCode');
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

describe('retire (ADR-017 §5)', () => {
  const T_ENV = TECHNIQUE_INDEX['DET-025'];
  const OP_UA = operationIndex('DET-025', 'user-agent');
  const OK_KEY = compositeKey(T_ENV, P_RET, S_API, OP_UA);
  const MARKER_KEY = compositeKey(T_ENV, P_RET, S_API | signalBit('DET-025', 'sample-budget-exceeded'), OP_UA);

  function getterTarget(): { proto: object; get: () => unknown } {
    const get = function (this: unknown): string { return 'ua'; };
    const proto = {};
    Object.defineProperty(proto, 'userAgent', { get, configurable: true, enumerable: true });
    return { proto, get };
  }

  it('restores an owned hook, marks the main key lower-bound, adds a count-0 marker; stop reports cleanup complete', () => {
    const { fake, runtime } = started();
    handshake(fake, runtime);
    const { proto, get } = getterTarget();
    const handle = wrapGetter(proto, 'userAgent', () => runtime.recordKey(OK_KEY), { context: runtime.hooks });
    runtime.attach([handle]);
    if (handle.status !== 'installed') throw new Error('not installed');
    void (proto as { userAgent: string }).userAgent;
    void (proto as { userAgent: string }).userAgent;
    fake.advance(BUDGETS.flushMinMs);
    expect(runtime.retire(handle, [OK_KEY], MARKER_KEY)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(proto, 'userAgent')!.get).toBe(get);
    expect(runtime.snapshot().flags).toEqual([]); // no document coverage flag
    fake.advance(BUDGETS.flushMinMs);
    const last = fake.batches().at(-1)!.observations; // validated by validateSensorMessage in fake.messages()
    expect(last).toEqual([
      { techniqueId: 'DET-025', count: 2, countQuality: 'lower-bound', phase: 'returned-sync', signalCodes: ['api-use'], intervalBucket: 1, operationCode: 'user-agent' },
      {
        techniqueId: 'DET-025',
        count: 0,
        countQuality: 'lower-bound',
        phase: 'returned-sync',
        signalCodes: ['api-use', 'sample-budget-exceeded'],
        intervalBucket: 1,
        operationCode: 'user-agent',
      },
    ]);
    // Lower-bound is sticky: later increments of the main key keep it.
    runtime.recordKey(OK_KEY);
    expect(runtime.snapshot().counters.find((c) => c.count === 3)?.countQuality).toBe('lower-bound');
    expect(runtime.stop('local')).toEqual({ reason: 'local', restored: ['userAgent'], notRestored: [], cleanup: 'complete' });
  });

  it('the marker passes validateSensorMessage as a standalone sensor-batch', () => {
    const { fake, runtime } = started();
    handshake(fake, runtime);
    const { proto } = getterTarget();
    const handle = wrapGetter(proto, 'userAgent', () => undefined, { context: runtime.hooks });
    if (handle.status !== 'installed') throw new Error('not installed');
    runtime.retire(handle, [OK_KEY], MARKER_KEY); // main key absent: only the marker is created
    fake.advance(BUDGETS.flushMinMs);
    const raw = fake.posted.at(-1);
    expect(validateSensorMessage(raw).ok).toBe(true);
    expect((raw as { observations: unknown[] }).observations).toEqual([
      { techniqueId: 'DET-025', count: 0, countQuality: 'lower-bound', phase: 'returned-sync', signalCodes: ['api-use', 'sample-budget-exceeded'], intervalBucket: 0, operationCode: 'user-agent' },
    ]);
  });

  it('a page-replaced wrapper is not restored: the handle stays and stop reports cleanup partial', () => {
    const { fake, runtime } = started();
    handshake(fake, runtime);
    const { proto } = getterTarget();
    const handle = wrapGetter(proto, 'userAgent', () => runtime.recordKey(OK_KEY), { context: runtime.hooks });
    runtime.attach([handle]);
    if (handle.status !== 'installed') throw new Error('not installed');
    const ours = Object.getOwnPropertyDescriptor(proto, 'userAgent')!.get!;
    const pageGetter = function (this: unknown): unknown { return Reflect.apply(ours, this, []); };
    Object.defineProperty(proto, 'userAgent', { get: pageGetter, configurable: true });
    void (proto as { userAgent: string }).userAgent;
    expect(runtime.retire(handle, [OK_KEY], MARKER_KEY)).toBe(false);
    expect(Object.getOwnPropertyDescriptor(proto, 'userAgent')!.get).toBe(pageGetter);
    const snap = runtime.snapshot();
    expect(snap.counters.map((c) => [c.signalCodes.join(','), c.count, c.countQuality])).toEqual([
      ['api-use', 1, 'lower-bound'],
      ['api-use,sample-budget-exceeded', 0, 'lower-bound'],
    ]);
    expect(runtime.stop('local')).toEqual({ reason: 'local', restored: [], notRestored: ['userAgent'], cleanup: 'partial' });
  });

  it('no marker when the regular key limit is exhausted (only the main key turns lower-bound); never the reserve', () => {
    const { fake, runtime } = started();
    handshake(fake, runtime);
    for (let i = 0; i < REGULAR - 1; i++) runtime.record(...regularKey(i));
    runtime.recordKey(OK_KEY); // the 120th regular key
    const { proto } = getterTarget();
    const handle = wrapGetter(proto, 'userAgent', () => undefined, { context: runtime.hooks });
    if (handle.status !== 'installed') throw new Error('not installed');
    runtime.retire(handle, [OK_KEY], MARKER_KEY);
    const snap = runtime.snapshot();
    expect(snap.size).toBe(REGULAR);
    expect(snap.counters.some((c) => c.signalCodes.includes('sample-budget-exceeded'))).toBe(false);
    expect(snap.counters.find((c) => c.operationCode === 'user-agent')).toMatchObject({ count: 1, countQuality: 'lower-bound' });
    expect(snap.flags).toEqual([]);
  });

  it('I1: every key passed turns lower-bound (threw-sync too), sticky for an aggregate created after retirement', () => {
    const { fake, runtime } = started();
    handshake(fake, runtime);
    const THREW_KEY = compositeKey(T_ENV, PHASE_INDEX['threw-sync'], S_API, OP_UA);
    const OTHER_KEY = compositeKey(T_ENV, P_RET, S_API, operationIndex('DET-025', 'platform'));
    const { proto } = getterTarget();
    const handle = wrapGetter(proto, 'userAgent', () => undefined, { context: runtime.hooks });
    if (handle.status !== 'installed') throw new Error('not installed');
    runtime.recordKey(OK_KEY);
    runtime.recordKey(THREW_KEY);
    runtime.recordKey(OTHER_KEY);
    runtime.retire(handle, [OK_KEY, THREW_KEY], MARKER_KEY);
    const quality = (phase: string, op: string): string | undefined =>
      runtime.snapshot().counters.find((c) => c.phase === phase && c.operationCode === op && !c.signalCodes.includes('sample-budget-exceeded'))?.countQuality;
    expect(quality('returned-sync', 'user-agent')).toBe('lower-bound');
    expect(quality('threw-sync', 'user-agent')).toBe('lower-bound');
    expect(quality('returned-sync', 'platform')).toBe('exact'); // not a key of the retired hook
    // A key of the retired hook created only now (e.g. by a second hook sharing it) starts as lower-bound.
    const runtime2 = started().runtime;
    const handle2 = wrapGetter(getterTarget().proto, 'userAgent', () => undefined, { context: runtime2.hooks });
    if (handle2.status !== 'installed') throw new Error('not installed');
    runtime2.retire(handle2, [OK_KEY, THREW_KEY], MARKER_KEY);
    runtime2.recordKey(THREW_KEY);
    expect(runtime2.snapshot().counters.find((c) => c.phase === 'threw-sync')).toMatchObject({ count: 1, countQuality: 'lower-bound' });
  });

  it('after stop, retire changes nothing', () => {
    const { runtime } = started();
    const { proto } = getterTarget();
    const handle = wrapGetter(proto, 'userAgent', () => undefined, { context: runtime.hooks });
    runtime.attach([handle]);
    if (handle.status !== 'installed') throw new Error('not installed');
    runtime.stop('local');
    expect(runtime.retire(handle, [OK_KEY], MARKER_KEY)).toBe(false);
    expect(runtime.snapshot().size).toBe(0);
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
