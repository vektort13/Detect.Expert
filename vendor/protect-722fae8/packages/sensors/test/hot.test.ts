// Hot hooks with retirement (ADR-017 §5, task E06-03): limit boundary, a single retirement, pause, saved references
// after retirement, page replacement, limit null, method variant and install-time contract errors.

import { describe, expect, it, vi } from 'vitest';
import { BUDGETS } from '@detect-expert/contracts';
import { SensorRuntime, wrapHotGetter, wrapHotMethod, wrapMethod } from '../src/index';
import type { HookHandle, RuntimeSnapshot, StopResult, WrapResult } from '../src/index';
import { existingHandle } from '../src/wrap';
import { bridgeHello, deliver, makeEnv } from './helpers';

function installed(r: WrapResult): HookHandle {
  if (r.status !== 'installed') throw new Error('expected installed hook, got ' + r.reason);
  return r;
}

function setup(): { fake: ReturnType<typeof makeEnv>; runtime: SensorRuntime } {
  const fake = makeEnv();
  const runtime = new SensorRuntime(fake.env);
  runtime.start();
  deliver(fake, bridgeHello(runtime));
  return { fake, runtime };
}

/** A navigator-like prototype with a getter that counts original calls and can throw. */
function navigatorLike(): { proto: object; get: () => string; calls: () => number; failNext: () => void } {
  let calls = 0;
  let fail = false;
  const get = function (this: unknown): string {
    calls++;
    if (fail) {
      fail = false;
      throw new TypeError('Illegal invocation');
    }
    return 'UA-CANARY-3f9e';
  };
  const proto = {};
  Object.defineProperty(proto, 'userAgent', { get, configurable: true, enumerable: true });
  return { proto, get, calls: () => calls, failNext: () => { fail = true; } };
}

function rows(snap: RuntimeSnapshot): Array<[string, string, string, number, string]> {
  return snap.counters.map((c) => [c.phase, c.signalCodes.join(','), c.operationCode ?? '-', c.count, c.countQuality]);
}

const read = (proto: object): unknown => (proto as { userAgent: string }).userAgent;

describe('wrapHotGetter', () => {
  it('records exactly `limit` calls, retires once on the limit-th call and restores the original descriptor', () => {
    const { fake, runtime } = setup();
    const { proto, get, calls } = navigatorLike();
    const retire = vi.spyOn(runtime, 'retire');
    const handle = installed(wrapHotGetter(runtime, proto, 'userAgent', { technique: 'DET-025', op: 'user-agent', limit: 3 }));
    runtime.attach([handle]);
    const saved = Object.getOwnPropertyDescriptor(proto, 'userAgent')!.get!;
    expect(read(proto)).toBe('UA-CANARY-3f9e');
    expect(read(proto)).toBe('UA-CANARY-3f9e');
    expect(retire).not.toHaveBeenCalled();
    expect(Object.getOwnPropertyDescriptor(proto, 'userAgent')!.get).toBe(saved);
    expect(read(proto)).toBe('UA-CANARY-3f9e'); // 3rd call: recorded, then retired
    expect(retire).toHaveBeenCalledTimes(1);
    expect(Object.getOwnPropertyDescriptor(proto, 'userAgent')!.get).toBe(get);
    expect(rows(runtime.snapshot())).toEqual([
      ['returned-sync', 'api-use', 'user-agent', 3, 'lower-bound'],
      ['returned-sync', 'api-use,sample-budget-exceeded', 'user-agent', 0, 'lower-bound'],
    ]);
    // After retirement: native descriptor, and a reference saved by the page still calls the original exactly once
    // but records nothing (observer off), and never retires again.
    for (let i = 0; i < 5; i++) read(proto);
    expect(Reflect.apply(saved, proto, [])).toBe('UA-CANARY-3f9e');
    expect(calls()).toBe(3 + 5 + 1);
    expect(retire).toHaveBeenCalledTimes(1);
    expect(runtime.snapshot().counters[0]!.count).toBe(3);
    expect(runtime.snapshot().flags).toEqual([]);
    fake.advance(BUDGETS.flushMinMs);
    const observations = fake.batches().flatMap((b) => b.observations); // validated by fake.messages()
    expect(observations.map((o) => o.operationCode)).toEqual(['user-agent', 'user-agent']);
    expect(JSON.stringify(fake.posted)).not.toContain('UA-CANARY');
    expect(runtime.stop('local')).toMatchObject({ restored: ['userAgent'], notRestored: [], cleanup: 'complete' });
  });

  it('limit 1 retires on the first call; a throwing call counts toward the limit and keeps its own phase', () => {
    const { runtime } = setup();
    const a = navigatorLike();
    installed(wrapHotGetter(runtime, a.proto, 'userAgent', { technique: 'DET-025', op: 'platform', limit: 1 }));
    read(a.proto);
    expect(Object.getOwnPropertyDescriptor(a.proto, 'userAgent')!.get).toBe(a.get);
    const b = navigatorLike();
    installed(wrapHotGetter(runtime, b.proto, 'userAgent', { technique: 'DET-029', op: 'width', limit: 2 }));
    b.failNext();
    expect(() => read(b.proto)).toThrow(TypeError);
    read(b.proto);
    // I1: after retirement neither phase of the hook is observed, so the threw-sync aggregate is lower-bound too.
    expect(rows(runtime.snapshot()).filter((r) => r[2] === 'width')).toEqual([
      ['threw-sync', 'api-use', 'width', 1, 'lower-bound'],
      ['returned-sync', 'api-use', 'width', 1, 'lower-bound'],
      ['returned-sync', 'api-use,sample-budget-exceeded', 'width', 0, 'lower-bound'],
    ]);
  });

  it('calls while paused are neither recorded nor counted toward the limit', () => {
    const { runtime } = setup();
    const { proto, get } = navigatorLike();
    installed(wrapHotGetter(runtime, proto, 'userAgent', { technique: 'DET-025', op: 'language', limit: 2 }));
    read(proto);
    runtime.pause();
    for (let i = 0; i < 10; i++) read(proto);
    expect(Object.getOwnPropertyDescriptor(proto, 'userAgent')!.get).not.toBe(get);
    runtime.resume();
    read(proto);
    expect(Object.getOwnPropertyDescriptor(proto, 'userAgent')!.get).toBe(get);
    expect(rows(runtime.snapshot())[0]).toEqual(['returned-sync', 'api-use', 'language', 2, 'lower-bound']);
  });

  it('a page-replaced wrapper: retirement leaves the page descriptor, stops observing, cleanup stays partial', () => {
    const { runtime } = setup();
    const { proto, calls } = navigatorLike();
    const handle = installed(wrapHotGetter(runtime, proto, 'userAgent', { technique: 'DET-025', op: 'vendor', limit: 2 }));
    runtime.attach([handle]);
    const ours = Object.getOwnPropertyDescriptor(proto, 'userAgent')!.get!;
    const pageGetter = function (this: unknown): unknown { return Reflect.apply(ours, this, []); };
    Object.defineProperty(proto, 'userAgent', { get: pageGetter, configurable: true });
    read(proto);
    read(proto);
    read(proto);
    expect(Object.getOwnPropertyDescriptor(proto, 'userAgent')!.get).toBe(pageGetter);
    expect(calls()).toBe(3);
    expect(rows(runtime.snapshot())[0]).toEqual(['returned-sync', 'api-use', 'vendor', 2, 'lower-bound']);
    expect(runtime.stop('local')).toMatchObject({ restored: [], notRestored: ['userAgent'], cleanup: 'partial' });
  });

  // S02 review / F045: retirement runs restore() inside the observer, on a call the page triggers. The ownership
  // registry must be reached only through collection operations captured at module evaluation: a live WeakMap/Map
  // prototype method would receive the private registry (leak) or throw half-way through restore.
  it.each([['throwing', true], ['leaking', false]] as const)(
    'retirement and stop() never call page-patched WeakMap/Map methods (%s trap)',
    (_name, throwing) => {
      const { fake, runtime } = setup();
      const { proto, get } = navigatorLike();
      const hot = installed(wrapHotGetter(runtime, proto, 'userAgent', { technique: 'DET-025', op: 'user-agent', limit: 2 }));
      const plain = { m: (): number => 42 };
      const m = plain.m;
      const regular = installed(wrapMethod(plain, 'm', () => undefined, { context: runtime.hooks }));
      runtime.attach([hot, regular]);
      expect(read(proto)).toBe('UA-CANARY-3f9e'); // 1st call, before the page patches
      // The fake env's own listener bookkeeping uses Map; keep test plumbing out of the patched window.
      fake.env.removeEventListener = () => undefined;
      const patches: Array<[object, PropertyKey]> = [
        [WeakMap.prototype, 'get'], [WeakMap.prototype, 'set'], [WeakMap.prototype, 'has'], [WeakMap.prototype, 'delete'],
        [Map.prototype, 'get'], [Map.prototype, 'set'], [Map.prototype, 'has'], [Map.prototype, 'delete'],
      ];
      const descriptors = patches.map(([object, key]) => Object.getOwnPropertyDescriptor(object, key)!);
      const define = Object.defineProperty;
      const apply = Reflect.apply;
      const leaked: unknown[] = [];
      let calls = 0;
      let result: unknown;
      let stopped: StopResult | undefined;
      let escaped: unknown;
      try {
        for (let i = 0; i < patches.length; i++) {
          const original = descriptors[i]!.value as (...args: unknown[]) => unknown;
          define(patches[i]![0], patches[i]![1], {
            value: function (this: unknown, ...args: unknown[]): unknown {
              calls++;
              leaked[leaked.length] = this;
              if (throwing) throw new Error('page builtin trap');
              return apply(original, this, args);
            },
            configurable: true,
            writable: true,
          });
        }
        result = read(proto); // limit-th call: recorded, then retired from inside the observer
        stopped = runtime.stop('local'); // stop-path restore of the regular hook
      } catch (error) {
        escaped = error;
      } finally {
        for (let i = 0; i < patches.length; i++) define(patches[i]![0], patches[i]![1], descriptors[i]!);
      }
      expect(escaped).toBeUndefined();
      expect(calls).toBe(0);
      expect(leaked).toEqual([]);
      expect(result).toBe('UA-CANARY-3f9e');
      expect(runtime.snapshot().observerErrors).toBe(0);
      expect(Object.getOwnPropertyDescriptor(proto, 'userAgent')!.get).toBe(get);
      expect(plain.m).toBe(m);
      expect(rows(runtime.snapshot())).toEqual([
        ['returned-sync', 'api-use', 'user-agent', 2, 'lower-bound'],
        ['returned-sync', 'api-use,sample-budget-exceeded', 'user-agent', 0, 'lower-bound'],
      ]);
      expect(stopped).toMatchObject({ restored: ['userAgent', 'm'], notRestored: [], cleanup: 'complete' });
      expect(existingHandle(proto, 'userAgent', 'getter')).toBeNull();
      expect(existingHandle(plain, 'm', 'method')).toBeNull();
    },
  );

  it('limit null never retires and needs no sample-budget-exceeded signal', () => {
    const { runtime } = setup();
    const { proto, get } = navigatorLike();
    installed(wrapHotGetter(runtime, proto, 'userAgent', { technique: 'DET-039', op: 'query', limit: null }));
    for (let i = 0; i < 50; i++) read(proto);
    expect(Object.getOwnPropertyDescriptor(proto, 'userAgent')!.get).not.toBe(get);
    expect(rows(runtime.snapshot())).toEqual([['returned-sync', 'api-use', 'query', 50, 'exact']]);
  });

  it('install-time contract errors throw (undeclared operation, retiring technique without the signal, bad limit)', () => {
    const { runtime } = setup();
    const { proto } = navigatorLike();
    expect(() => wrapHotGetter(runtime, proto, 'userAgent', { technique: 'DET-025', op: 'param-renderer', limit: null })).toThrow();
    expect(() => wrapHotGetter(runtime, proto, 'userAgent', { technique: 'DET-001', limit: 10 })).toThrow();
    expect(() => wrapHotGetter(runtime, proto, 'userAgent', { technique: 'DET-025', limit: 0 })).toThrow();
    expect(() => wrapHotGetter(runtime, proto, 'userAgent', { technique: 'DET-025', limit: 1.5 })).toThrow();
    expect(Object.getOwnPropertyDescriptor(proto, 'userAgent')!.get!.name).toBe('get'); // untouched
  });

  it('I1: the limit check never calls the live Math.floor (a page may replace it before a late start)', () => {
    const { runtime } = setup();
    const floor = Math.floor;
    let pageCalls = 0;
    Math.floor = ((x: number) => { pageCalls++; return floor(x); }) as typeof Math.floor;
    try {
      installed(wrapHotGetter(runtime, navigatorLike().proto, 'userAgent', { technique: 'DET-025', op: 'user-agent', limit: 3 }));
      expect(() => wrapHotGetter(runtime, navigatorLike().proto, 'userAgent', { technique: 'DET-025', limit: 2.5 })).toThrow(/limit/);
      expect(() => wrapHotGetter(runtime, navigatorLike().proto, 'userAgent', { technique: 'DET-025', limit: Number.POSITIVE_INFINITY })).toThrow(/limit/);
      expect(() => wrapHotGetter(runtime, navigatorLike().proto, 'userAgent', { technique: 'DET-025', limit: Number.NaN })).toThrow(/limit/);
    } finally {
      Math.floor = floor;
    }
    expect(pageCalls).toBe(0);
  });
});

describe('wrapHotMethod', () => {
  it('records without reading arguments, retires at the limit and keeps the original result identity', () => {
    const { runtime } = setup();
    const rect = {};
    let calls = 0;
    const getBoundingClientRect = function (this: unknown): object { calls++; return rect; };
    const proto = { getBoundingClientRect };
    const hostile = new Proxy({}, { get: () => { throw new Error('argument read'); } });
    installed(wrapHotMethod(runtime, proto, 'getBoundingClientRect', { technique: 'DET-005', op: 'get-bounding-client-rect', limit: 2 }));
    expect(Reflect.apply(proto.getBoundingClientRect, proto, [hostile])).toBe(rect);
    expect(proto.getBoundingClientRect()).toBe(rect);
    expect(proto.getBoundingClientRect).toBe(getBoundingClientRect);
    expect(calls).toBe(2);
    expect(rows(runtime.snapshot())).toEqual([
      ['returned-sync', 'api-use', 'get-bounding-client-rect', 2, 'lower-bound'],
      ['returned-sync', 'api-use,sample-budget-exceeded', 'get-bounding-client-rect', 0, 'lower-bound'],
    ]);
  });
});
