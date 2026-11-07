// ADR-020 §F (S10, SP-12): the stack sampler on real V8 (Node). Checks before every sample: the prototype chain
// Error -> Function.prototype -> Object.prototype, no own prepareStackTrace on any of them, Error.stackTraceLimit an own
// data property 1..100. A planted accessor or Proxy is never invoked; budgets 16 / 8 per 1 s window; late capture off.

import { describe, expect, it } from 'vitest';
import { captureStackIntrinsics, createStackSampler, stackIntegrityOk } from '../src/protect/stack';
import type { StackIntrinsics } from '../src/protect/stack';
import { makeRealm, trapCounter, withoutPrepareStackTrace } from './protect-fakes';

const CDN = 'https://cdn.tracker-a.example.org/lib/v2/collect.js';

function intrinsics(): StackIntrinsics {
  const i = captureStackIntrinsics(globalThis);
  if (i === null) throw new Error('V8 intrinsics missing');
  return i;
}

/** Runs `fn` with a temporary own property on `target`, restored afterwards. */
function withProperty<T>(target: object, key: string, descriptor: PropertyDescriptor, fn: () => T): T {
  const saved = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, ...descriptor });
  try {
    return fn();
  } finally {
    if (saved === undefined) delete (target as Record<string, unknown>)[key];
    else Object.defineProperty(target, key, saved);
  }
}

describe('captureStackIntrinsics', () => {
  it('reads own data properties only; a realm without them gives null', () => {
    expect(captureStackIntrinsics({})).toBeNull();
    let getterCalls = 0;
    const realm = Object.defineProperty({}, 'Error', { get: () => { getterCalls++; return Error; }, configurable: true });
    expect(captureStackIntrinsics(realm)).toBeNull();
    expect(getterCalls).toBe(0);
  });
});

describe('sampling on real V8', () => {
  it('samples the first page frame below the omitted wrapper', () => {
    const fr = makeRealm();
    const sampler = createStackSampler(intrinsics(), { now: () => 0, docHost: 'shop.example.com', earlyCapture: true });
    // A stand-in wrapper on the stack: everything above it (our observer) and itself is omitted.
    const wrapper = function wrapper(cb: () => unknown): unknown {
      return cb();
    };
    const result = withoutPrepareStackTrace(() => fr.runAs<unknown>(CDN, 'return wrapper(() => sampler.sample("send", wrapper));', { wrapper, sampler }));
    expect(result).toEqual({ status: 'sampled', script: { kind: 'external', scheme: 'https', host: 'cdn.tracker-a.example.org', pathTemplate: '/lib/v2/collect.js' } });
  });

  it('refuses a planted prepareStackTrace on Object.prototype / Function.prototype / Error without invoking it', () => {
    const i = intrinsics();
    const sampler = createStackSampler(i, { now: () => 0, docHost: '', earlyCapture: true, budgets: { send: 100, registration: 100 } });
    let calls = 0;
    const accessor = { get: () => { calls++; return undefined; }, set: () => { calls++; } };
    const omit = function omit(): unknown {
      return sampler.sample('send', omit);
    };
    const seen: unknown[] = [];
    withoutPrepareStackTrace(() => {
      seen.push(stackIntegrityOk(i));
      for (const target of [Object.prototype, Function.prototype, Error]) {
        // Results are collected under the plant and asserted after its removal (the runner may format stacks).
        withProperty(target, 'prepareStackTrace', accessor, () => {
          seen.push(stackIntegrityOk(i), omit());
        });
        withProperty(target, 'prepareStackTrace', { value: () => { calls++; return 'forged'; }, writable: true }, () => {
          seen.push(omit());
        });
      }
    });
    expect(calls).toBe(0);
    const unavailable = { status: 'unavailable' };
    expect(seen).toEqual([true, false, unavailable, unavailable, false, unavailable, unavailable, false, unavailable, unavailable]);
  });

  it('refuses an accessor or out-of-range Error.stackTraceLimit and a changed prototype chain (no trap runs)', () => {
    const i = intrinsics();
    withoutPrepareStackTrace(() => {
      let getterCalls = 0;
      withProperty(Error, 'stackTraceLimit', { get: () => { getterCalls++; return 10; }, set: () => undefined }, () => expect(stackIntegrityOk(i)).toBe(false));
      expect(getterCalls).toBe(0);
      for (const v of [0, 101, 1.5, Infinity, '10']) withProperty(Error, 'stackTraceLimit', { value: v, writable: true }, () => expect(stackIntegrityOk(i)).toBe(false));
      const trap = trapCounter(Function.prototype);
      const proto = Object.getPrototypeOf(Error) as object;
      Object.setPrototypeOf(Error, trap.proxy);
      try {
        expect(stackIntegrityOk(i)).toBe(false);
      } finally {
        Object.setPrototypeOf(Error, proto);
      }
      expect(trap.traps()).toBe(0);
      expect(stackIntegrityOk(i)).toBe(true);
    });
  });

  it('budgets: 16 send and 8 registration samples per 1 s window, independent; the next window resets', () => {
    let t = 5000;
    const sampler = createStackSampler(intrinsics(), { now: () => t, docHost: '', earlyCapture: true });
    const omit = function omit(kind: 'send' | 'registration'): string {
      return sampler.sample(kind, omit).status;
    };
    withoutPrepareStackTrace(() => {
      const sends = Array.from({ length: 17 }, () => omit('send'));
      const regs = Array.from({ length: 9 }, () => omit('registration'));
      expect(sends.filter((s) => s === 'sampled')).toHaveLength(16);
      expect(sends[16]).toBe('budget');
      expect(regs.filter((s) => s === 'sampled')).toHaveLength(8);
      expect(regs[8]).toBe('budget');
      t += 999;
      expect(omit('send')).toBe('budget');
      t += 1;
      expect(omit('send')).toBe('sampled');
    });
    expect(sampler.snapshot()).toMatchObject({ enabled: true, sampled: 25, budget: 3 });
  });

  it('late capture (or no intrinsics): the sampler is off', () => {
    const off = createStackSampler(intrinsics(), { now: () => 0, docHost: '', earlyCapture: false });
    expect(off.enabled).toBe(false);
    expect(off.sample('send', () => undefined)).toEqual({ status: 'unavailable' });
    expect(createStackSampler(null, { now: () => 0, docHost: '', earlyCapture: true }).sample('send', () => undefined)).toEqual({ status: 'unavailable' });
  });
});
