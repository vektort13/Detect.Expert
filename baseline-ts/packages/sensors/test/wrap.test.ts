// Semantic-preservation contract tests for the hook utilities (REQ-001/002/003, ADR-006, task E06-01).
// Fake objects only: no DOM. Each case builds fresh targets because wrappers mutate the target in place.

import { describe, expect, it } from 'vitest';
import { createHookContext, wrapConstructor, wrapGetter, wrapMethod, wrapOutcomeMethod } from '../src/index';
import { MAX_COUNT } from '@detect-expert/contracts';
import type { HookHandle, WrapResult } from '../src/index';

function installed(r: WrapResult): HookHandle {
  if (r.status !== 'installed') throw new Error('expected installed hook, got ' + r.reason);
  return r;
}

interface Call {
  self: unknown;
  args: unknown[];
}

function methodTarget<T>(impl: (this: unknown, ...args: unknown[]) => T): { target: { m: (...args: unknown[]) => T }; calls: Call[] } {
  const calls: Call[] = [];
  const target = {
    m(this: unknown, ...args: unknown[]): T {
      calls.push({ self: this, args });
      return impl.apply(this, args);
    },
  };
  return { target, calls };
}

function countingProxy(): { proxy: object; traps: () => number } {
  let hits = 0;
  const count = (): void => {
    hits++;
  };
  const proxy = new Proxy(
    {},
    {
      get: () => (count(), undefined),
      has: () => (count(), false),
      ownKeys: () => (count(), []),
      getOwnPropertyDescriptor: () => (count(), undefined),
      getPrototypeOf: () => (count(), null),
      set: () => (count(), true),
      defineProperty: () => (count(), true),
      deleteProperty: () => (count(), true),
      apply: () => (count(), undefined),
    },
  );
  return { proxy, traps: () => hits };
}

describe('wrapMethod: original call semantics', () => {
  it('calls the original exactly once with the same this and arguments and returns its result', () => {
    const { target, calls } = methodTarget(function (...args: unknown[]) {
      return args.length;
    });
    const observed: Array<[unknown, number, boolean]> = [];
    installed(wrapMethod(target, 'm', (self, args, threw) => observed.push([self, args.length, threw])));
    const a = {};
    const b = Symbol('b');
    expect(target.m(a, b, 3)).toBe(3);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.self).toBe(target);
    expect(calls[0]!.args[0]).toBe(a);
    expect(calls[0]!.args[1]).toBe(b);
    expect(calls[0]!.args[2]).toBe(3);
    expect(observed).toEqual([[target, 3, false]]);
  });

  it('calls the original exactly once when it throws, and rethrows the same instance', () => {
    const err = new RangeError('original failure');
    const { target, calls } = methodTarget(() => {
      throw err;
    });
    let seen: unknown = null;
    installed(wrapMethod(target, 'm', (_s, _a, threw, error) => (seen = threw ? error : null)));
    let caught: unknown = null;
    try {
      target.m();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(err);
    expect(seen).toBe(err);
    expect(calls).toHaveLength(1);
  });

  it('coerces an object argument exactly once (by the original), never by the wrapper', () => {
    let valueOfCalls = 0;
    const arg = {
      valueOf() {
        valueOfCalls++;
        return 5;
      },
    };
    const { target } = methodTarget(function (x: unknown) {
      return Number(x) + 1;
    });
    installed(wrapMethod(target, 'm', () => undefined));
    expect(target.m(arg)).toBe(6);
    expect(valueOfCalls).toBe(1);
  });

  it('preserves result identity: object, Promise, -0, NaN, undefined', () => {
    const obj = {};
    const promise = Promise.resolve(1);
    const values: unknown[] = [obj, promise, -0, Number.NaN, undefined, 0, ''];
    let i = 0;
    const { target } = methodTarget(() => values[i++]);
    installed(wrapMethod(target, 'm', () => undefined));
    expect(target.m()).toBe(obj);
    expect(target.m()).toBe(promise);
    expect(Object.is(target.m(), -0)).toBe(true);
    expect(Number.isNaN(target.m())).toBe(true);
    expect(target.m()).toBeUndefined();
    expect(Object.is(target.m(), 0)).toBe(true);
    expect(target.m()).toBe('');
  });

  it('passes the original result to the observer without inspecting it and never leaks a previous result on throw', () => {
    const { proxy, traps } = countingProxy();
    let fail = false;
    let seenResult: unknown;
    let seenError: unknown;
    const { target, calls } = methodTarget(() => { if (fail) throw proxy; return proxy; });
    installed(wrapMethod(target, 'm', (_thisArg, _args, _threw, error, result) => {
      seenResult = result;
      seenError = error;
    }));
    expect(target.m() === proxy).toBe(true);
    expect(seenResult === proxy).toBe(true);
    expect(seenError).toBeUndefined();
    fail = true;
    let caught: unknown;
    try { target.m(); } catch (error) { caught = error; }
    expect(caught === proxy).toBe(true);
    expect(seenError === proxy).toBe(true);
    expect(seenResult).toBeUndefined();
    expect(calls).toHaveLength(2);
    expect(traps()).toBe(0);
  });

  it('does not attach .then/.catch to a returned Promise', () => {
    const promise = Promise.reject(new Error('page rejection'));
    promise.catch(() => undefined); // keep the test process quiet; this is the page's own handler
    const { target } = methodTarget(() => promise);
    installed(wrapMethod(target, 'm', () => undefined));
    const originalThen = Promise.prototype.then;
    let thenOnOurPromise = 0;
    Object.defineProperty(Promise.prototype, 'then', {
      value: function (this: unknown, ...args: unknown[]) {
        if (this === promise) thenOnOurPromise++;
        return Reflect.apply(originalThen, this, args);
      },
      writable: true,
      configurable: true,
    });
    try {
      expect(target.m()).toBe(promise);
    } finally {
      Object.defineProperty(Promise.prototype, 'then', { value: originalThen, writable: true, configurable: true });
    }
    expect(thenOnOurPromise).toBe(0);
  });

  it('never touches a Proxy argument (0 traps from the wrapper and a typeof/length-only observer)', () => {
    const { proxy, traps } = countingProxy();
    const { target } = methodTarget(function (...args: unknown[]) {
      return args.length; // the fake original does not touch the argument either
    });
    let kind = '';
    installed(
      wrapMethod(target, 'm', (_s, args) => {
        kind = args.length === 1 ? typeof args[0] : 'none';
      }),
    );
    expect(target.m(proxy)).toBe(1);
    expect(kind).toBe('object');
    expect(traps()).toBe(0);
  });
});

describe('wrapMethod: observer isolation', () => {
  it('an observer exception changes neither the result nor the exception of the page', () => {
    const ctx = createHookContext();
    const err = new TypeError('page error');
    let shouldThrow = false;
    const { target, calls } = methodTarget(() => {
      if (shouldThrow) throw err;
      return 42;
    });
    installed(
      wrapMethod(
        target,
        'm',
        () => {
          throw new Error('observer bug');
        },
        { context: ctx },
      ),
    );
    expect(target.m()).toBe(42);
    expect(ctx.observerErrors).toBe(1);
    shouldThrow = true;
    let caught: unknown = null;
    try {
      target.m();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(err);
    expect(ctx.observerErrors).toBe(2);
    expect(calls).toHaveLength(2);
  });

  it('a disabled context skips the observer but still calls the original', () => {
    const ctx = createHookContext();
    ctx.enabled = false;
    const { target, calls } = methodTarget(() => 'ok');
    let observed = 0;
    installed(wrapMethod(target, 'm', () => observed++, { context: ctx }));
    expect(target.m()).toBe('ok');
    expect(calls).toHaveLength(1);
    expect(observed).toBe(0);
    ctx.enabled = true;
    target.m();
    expect(observed).toBe(1);
  });

  it('a wrapped API called from inside an observer is executed but not observed (reentrancy guard)', () => {
    const a = methodTarget(() => 'a');
    const b = methodTarget(() => 'b');
    let observedB = 0;
    installed(wrapMethod(b.target, 'm', () => observedB++));
    installed(
      wrapMethod(a.target, 'm', () => {
        b.target.m();
      }),
    );
    expect(a.target.m()).toBe('a');
    expect(b.calls).toHaveLength(1);
    expect(observedB).toBe(0);
    b.target.m();
    expect(observedB).toBe(1);
  });
});

describe('wrapMethod: descriptors, ownership, no masking', () => {
  it('refuses a non-configurable descriptor and leaves the target untouched', () => {
    const fn = (): number => 1;
    const target = {};
    Object.defineProperty(target, 'm', { value: fn, writable: true, enumerable: false, configurable: false });
    const r = wrapMethod(target, 'm', () => undefined);
    expect(r.status).toBe('unsupported');
    if (r.status === 'unsupported') {
      expect(r.reason).toBe('non-configurable');
      expect(r.coverageFlag).toBe('descriptor-nonconfigurable');
    }
    expect(Object.getOwnPropertyDescriptor(target, 'm')!.value).toBe(fn);
  });

  it('refuses a frozen target, a missing key and an accessor property with hook-failed', () => {
    const frozen = Object.freeze({ m: () => 1 });
    const missing = {};
    const accessor = {
      get m(): number {
        return 1;
      },
    };
    const r1 = wrapMethod(frozen, 'm', () => undefined);
    const r2 = wrapMethod(missing, 'm', () => undefined);
    const r3 = wrapMethod(accessor, 'm', () => undefined);
    expect(r1.status === 'unsupported' && r1.reason).toBe('non-configurable');
    expect(r2.status === 'unsupported' && r2.reason).toBe('missing');
    expect(r2.status === 'unsupported' && r2.coverageFlag).toBe('hook-failed');
    expect(r3.status === 'unsupported' && r3.reason).toBe('not-a-method');
  });

  it('copies name/length as descriptors and leaves Function.prototype.toString alone', () => {
    const toStringBefore = Function.prototype.toString;
    const toStringDesc = Object.getOwnPropertyDescriptor(Function.prototype, 'toString');
    const target = { getImageData(_a: number, _b: number, _c: number, _d: number): number { return 0; } };
    const original = target.getImageData;
    installed(wrapMethod(target, 'getImageData', () => undefined));
    expect(target.getImageData).not.toBe(original);
    expect(target.getImageData.name).toBe('getImageData');
    expect(target.getImageData.length).toBe(4);
    expect(Function.prototype.toString).toBe(toStringBefore);
    expect(Object.getOwnPropertyDescriptor(Function.prototype, 'toString')).toEqual(toStringDesc);
    // The wrapper is not disguised: its source is not the original's source (REQ-003).
    expect(Function.prototype.toString.call(target.getImageData)).not.toBe(Function.prototype.toString.call(original));
    // No marker property is exposed on the wrapper (ownership lives in a WeakMap); like a native method it has
    // no `prototype` and cannot be constructed.
    expect(Object.getOwnPropertyNames(target.getImageData).sort()).toEqual(['length', 'name']);
    expect(() => new (target.getImageData as unknown as new () => unknown)()).toThrow(TypeError);
  });

  it('copyNameAndLength: false keeps the wrapper name', () => {
    const target = { m(_a: number): number { return 0; } };
    installed(wrapMethod(target, 'm', () => undefined, { copyNameAndLength: false }));
    expect(target.m.name).not.toBe('m');
  });

  it('restores the original descriptor exactly when still owned', () => {
    const fn = (): number => 1;
    const target = {};
    Object.defineProperty(target, 'm', { value: fn, writable: false, enumerable: true, configurable: true });
    const h = installed(wrapMethod(target, 'm', () => undefined));
    expect(Object.getOwnPropertyDescriptor(target, 'm')).toMatchObject({ writable: false, enumerable: true, configurable: true });
    expect(h.isOwned()).toBe(true);
    expect(h.restore()).toBe(true);
    expect(Object.getOwnPropertyDescriptor(target, 'm')).toEqual({ value: fn, writable: false, enumerable: true, configurable: true });
    expect(h.isOwned()).toBe(false);
    expect(h.restore()).toBe(false);
  });

  it('does not clobber a wrapper the page installed on top of ours', () => {
    const { target, calls } = methodTarget(() => 'orig');
    const h = installed(wrapMethod(target, 'm', () => undefined));
    const ours = target.m;
    const pageWrapper = function (this: unknown, ...args: unknown[]): string {
      return Reflect.apply(ours, this, args) as string;
    };
    target.m = pageWrapper;
    expect(h.isOwned()).toBe(false);
    expect(h.restore()).toBe(false);
    expect(target.m).toBe(pageWrapper);
    expect(target.m()).toBe('orig');
    expect(calls).toHaveLength(1);
  });

  it('wrapping an already wrapped API returns the same handle and observes once', () => {
    const { target, calls } = methodTarget(() => 1);
    let first = 0;
    let second = 0;
    const h1 = installed(wrapMethod(target, 'm', () => first++));
    const h2 = wrapMethod(target, 'm', () => second++);
    expect(h2).toBe(h1);
    target.m();
    expect(calls).toHaveLength(1);
    expect(first).toBe(1);
    expect(second).toBe(0);
    // After the page replaced our wrapper we still do not wrap again (ADR-006 §9): the same handle comes back.
    const ours = target.m;
    target.m = (...args: unknown[]) => Reflect.apply(ours, target, args);
    expect(wrapMethod(target, 'm', () => second++)).toBe(h1);
    // Only after a successful restore can the key be wrapped again.
    target.m = ours;
    expect(h1.restore()).toBe(true);
    const h3 = installed(wrapMethod(target, 'm', () => second++));
    expect(h3).not.toBe(h1);
  });
});

describe('wrapOutcomeMethod: native semantics without argument exposure', () => {
  it('preserves all arguments, receiver and result identities while the observer receives only a boolean', () => {
    const { proxy, traps } = countingProxy();
    const promise = Promise.resolve(1);
    const values: unknown[] = [proxy, promise, -0, NaN, undefined, null, 0, false, '', 1n, Symbol('result')];
    let index = 0;
    const { target, calls } = methodTarget(() => values[index++]);
    const outcomes: unknown[][] = [];
    installed(wrapOutcomeMethod(target, 'm', function (threw) { outcomes.push([threw, arguments.length]); }));
    const argumentSets = [[], [proxy], [proxy, undefined, Symbol('extra'), 9, null, false]];
    for (let i = 0; i < values.length; i++) {
      const args = argumentSets[i % argumentSets.length]!;
      expect(Object.is(Reflect.apply(target.m, proxy, args), values[i])).toBe(true);
      expect(calls[i]!.self === proxy).toBe(true);
      expect(calls[i]!.args.length).toBe(args.length);
      for (let j = 0; j < args.length; j++) expect(calls[i]!.args[j] === args[j]).toBe(true);
    }
    expect(calls).toHaveLength(values.length);
    expect(outcomes).toEqual(values.map(() => [false, 1]));
    expect(traps()).toBe(0);
  });

  it('rethrows even falsy native exceptions unchanged, without exposing them or reading Proxy properties', () => {
    const { proxy, traps } = countingProxy();
    const values: unknown[] = [undefined, null, false, 0, '', proxy, new RangeError('native error')];
    const outcomes: unknown[][] = [];
    let originalCalls = 0;
    let value: unknown;
    let fail = true;
    const target = { m() { originalCalls++; if (fail) throw value; return value; } };
    installed(wrapOutcomeMethod(target, 'm', function (threw) { outcomes.push([threw, arguments.length]); }));
    for (value of values) {
      let caught = false;
      try { target.m(); } catch (error) { caught = true; expect(Object.is(error, value)).toBe(true); }
      expect(caught).toBe(true);
    }
    fail = false;
    value = -0;
    expect(Object.is(target.m(), -0)).toBe(true);
    expect(originalCalls).toBe(values.length + 1);
    expect(outcomes).toEqual([...values.map(() => [true, 1]), [false, 1]]);
    expect(traps()).toBe(0);
  });

  it('lets only the original coerce arguments, in the original order before observation', () => {
    const events: string[] = [];
    const error = new TypeError('page coercion');
    let fail = false;
    const argument = { [Symbol.toPrimitive]() { events.push('coerce'); if (fail) throw error; return 4; } };
    const target = { m(value: unknown) { events.push('native'); return Number(value) + 1; } };
    installed(wrapOutcomeMethod(target, 'm', (threw) => { events.push(threw ? 'threw' : 'returned'); }));
    expect(target.m(argument)).toBe(5);
    expect(events).toEqual(['native', 'coerce', 'returned']);
    events.length = 0;
    fail = true;
    let caught: unknown;
    try { target.m(argument); } catch (value) { caught = value; }
    expect(caught).toBe(error);
    expect(events).toEqual(['native', 'coerce', 'threw']);
  });

  it('shares the module reentrancy guard with regular methods in both directions, including self calls', () => {
    let outcomeCalls = 0;
    let methodCalls = 0;
    let outcomeObserved = 0;
    let methodObserved = 0;
    const target = { outcome() { outcomeCalls++; return 7; }, method() { methodCalls++; return 8; } };
    installed(wrapMethod(target, 'method', () => { methodObserved++; target.outcome(); }));
    installed(wrapOutcomeMethod(target, 'outcome', () => { outcomeObserved++; target.method(); target.outcome(); }));
    expect(target.outcome()).toBe(7);
    expect([outcomeCalls, methodCalls, outcomeObserved, methodObserved]).toEqual([2, 1, 1, 0]);
    expect(target.method()).toBe(8);
    expect([outcomeCalls, methodCalls, outcomeObserved, methodObserved]).toEqual([3, 2, 1, 1]);
  });

  it('checks pause after the original and resumes observations without suppressing native calls', () => {
    const context = createHookContext();
    let calls = 0;
    let observed = 0;
    let change: boolean | undefined;
    const target = { m() { calls++; if (change !== undefined) context.enabled = change; return calls; } };
    installed(wrapOutcomeMethod(target, 'm', () => { observed++; }, { context }));
    expect(target.m()).toBe(1);
    context.enabled = false;
    expect(target.m()).toBe(2);
    expect(observed).toBe(1);
    change = true;
    expect(target.m()).toBe(3);
    expect(observed).toBe(2);
    change = false;
    expect(target.m()).toBe(4);
    expect(observed).toBe(2);
  });

  it('isolates observer and status-callback failures, saturates errors and releases the reentrancy guard', () => {
    const context = createHookContext();
    context.observerErrors = MAX_COUNT - 1;
    let statusCalls = 0;
    let nestedObserved = 0;
    const nested = { m() { return 8; } };
    installed(wrapMethod(nested, 'm', () => { nestedObserved++; }));
    context.onObserverError = () => { statusCalls++; nested.m(); throw new Error('status error'); };
    const nativeError = new Error('native error');
    let fail = false;
    const target = { m() { if (fail) throw nativeError; return 42; } };
    installed(wrapOutcomeMethod(target, 'm', () => { throw new Error('observer error'); }, { context }));
    expect(target.m()).toBe(42);
    fail = true;
    let caught: unknown;
    try { target.m(); } catch (error) { caught = error; }
    expect(caught).toBe(nativeError);
    expect(context.observerErrors).toBe(MAX_COUNT);
    expect(statusCalls).toBe(2);
    expect(nestedObserved).toBe(0);
    nested.m();
    expect(nestedObserved).toBe(1);
  });

  it('preserves method descriptors and metadata without constructibility or toString masking', () => {
    let calls = 0;
    let observed = 0;
    const target = { measureText(_text: unknown, _extra: unknown) { calls++; return 1; } };
    Object.defineProperty(target, 'measureText', { writable: false, enumerable: false });
    const before = Object.getOwnPropertyDescriptor(target, 'measureText');
    const stringify = Function.prototype.toString;
    const handle = installed(wrapOutcomeMethod(target, 'measureText', () => { observed++; }));
    expect(Object.getOwnPropertyDescriptor(target, 'measureText')).toMatchObject({ writable: false, enumerable: false, configurable: true });
    expect(target.measureText.name).toBe('measureText');
    expect(target.measureText.length).toBe(2);
    expect(Object.getOwnPropertyNames(target.measureText).sort()).toEqual(['length', 'name']);
    expect(() => Reflect.construct(target.measureText, [])).toThrow(TypeError);
    expect([calls, observed]).toEqual([0, 0]);
    expect(Function.prototype.toString).toBe(stringify);
    expect(stringify.call(target.measureText)).not.toBe(stringify.call(before!.value));
    expect(handle.restore()).toBe(true);
    expect(Object.getOwnPropertyDescriptor(target, 'measureText')).toEqual(before);
    expect(handle.restore()).toBe(false);
    installed(wrapOutcomeMethod(target, 'measureText', () => undefined, { copyNameAndLength: false }));
    expect(target.measureText.name).not.toBe('measureText');
  });

  it('shares installation ownership with regular methods and preserves foreign replacements', () => {
    let first = 0;
    let second = 0;
    const target = { m() { return 4; } };
    const original = target.m;
    const handle = installed(wrapOutcomeMethod(target, 'm', () => { first++; }));
    expect(wrapMethod(target, 'm', () => { second++; })).toBe(handle);
    expect(target.m()).toBe(4);
    expect([first, second]).toEqual([1, 0]);
    const ours = target.m;
    const foreign = () => ours();
    target.m = foreign;
    expect(handle.isOwned()).toBe(false);
    expect(handle.restore()).toBe(false);
    expect(wrapOutcomeMethod(target, 'm', () => { second++; })).toBe(handle);
    expect(target.m).toBe(foreign);
    target.m = ours;
    expect(handle.restore()).toBe(true);
    expect(target.m).toBe(original);
    const regular = installed(wrapMethod(target, 'm', () => { second++; }));
    expect(wrapOutcomeMethod(target, 'm', () => { first++; })).toBe(regular);
    target.m();
    expect([first, second]).toEqual([1, 1]);
  });

  it('refuses missing, frozen, accessor and rejected descriptors without invoking accessors', () => {
    let reads = 0;
    const accessor = { get m() { reads++; return () => 1; } };
    const rejecting = new Proxy({ m() { return 1; } }, { defineProperty() { return false; } });
    const cases: Array<[object, string]> = [
      [{}, 'missing'], [Object.freeze({ m() { return 1; } }), 'non-configurable'],
      [accessor, 'not-a-method'], [{ m: 3 }, 'not-a-method'], [rejecting, 'define-failed'],
    ];
    for (const [target, reason] of cases) {
      const result = wrapOutcomeMethod(target, 'm', () => undefined);
      expect(result.status === 'unsupported' && result.reason).toBe(reason);
    }
    expect(reads).toBe(0);
  });

  it('uses captured intrinsics after installation and never reads then/catch on a returned object', () => {
    const apply = Reflect.apply;
    const define = Object.defineProperty;
    let propertyReads = 0;
    let observed = 0;
    const result = { get then() { propertyReads++; throw new Error('then read'); }, get catch() { propertyReads++; throw new Error('catch read'); } };
    const target = { m() { return result; } };
    const handle = installed(wrapOutcomeMethod(target, 'm', () => { observed++; }));
    let actual: unknown;
    let restored = false;
    try {
      Reflect.apply = () => { throw new Error('late apply'); };
      Object.defineProperty = () => { throw new Error('late define'); };
      actual = target.m();
      restored = handle.restore();
    } finally { Reflect.apply = apply; Object.defineProperty = define; }
    expect(actual).toBe(result);
    expect(propertyReads).toBe(0);
    expect(observed).toBe(1);
    expect(restored).toBe(true);
  });
});

describe('wrapGetter', () => {
  it.each([false, true])('cleanup preserves a foreign setter added or replaced after installation (original setter=%s)', (withSetter) => {
    const target = {} as { p: number };
    const originalSetter = (_value: number): void => undefined;
    Object.defineProperty(target, 'p', { configurable: true, get() { return 1; }, ...(withSetter ? { set: originalSetter } : {}) });
    const handle = installed(wrapGetter(target, 'p', () => undefined));
    const ours = Object.getOwnPropertyDescriptor(target, 'p')!.get;
    let written = 0;
    const foreignSetter = (value: number): void => { written = value; };
    Object.defineProperty(target, 'p', { set: foreignSetter });
    expect(handle.isOwned()).toBe(false);
    expect(handle.restore()).toBe(false);
    expect(Object.getOwnPropertyDescriptor(target, 'p')!.get).toBe(ours);
    expect(Object.getOwnPropertyDescriptor(target, 'p')!.set).toBe(foreignSetter);
    target.p = 17;
    expect(written).toBe(17);
  });

  it('returns the same value with the same this, keeps the setter, rethrows the same error, restores', () => {
    let boom: Error | null = null;
    const setter = function (this: { v: number }, x: number): void {
      this.v = x;
    };
    const target = { v: 1 } as { v: number; p?: number };
    Object.defineProperty(target, 'p', {
      get(this: { v: number }): number {
        if (boom !== null) throw boom;
        return this.v * 2;
      },
      set: setter,
      enumerable: false,
      configurable: true,
    });
    const observed: Array<[unknown, boolean]> = [];
    const h = installed(wrapGetter(target, 'p', (self, threw) => observed.push([self, threw])));
    expect(target.p).toBe(2);
    expect(Object.getOwnPropertyDescriptor(target, 'p')!.set).toBe(setter);
    target.p = 5;
    expect(target.v).toBe(5);
    boom = new Error('getter failure');
    let caught: unknown = null;
    try {
      void target.p;
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(boom);
    expect(observed).toEqual([
      [target, false],
      [target, true],
    ]);
    expect(h.restore()).toBe(true);
    boom = null;
    expect(target.p).toBe(10);
    expect(Object.getOwnPropertyDescriptor(target, 'p')!.get!.name).toBe('get');
  });

  it('refuses data properties and non-configurable accessors', () => {
    const data = { p: 1 };
    const r1 = wrapGetter(data, 'p', () => undefined);
    expect(r1.status === 'unsupported' && r1.reason).toBe('not-a-getter');
    const sealed = {};
    Object.defineProperty(sealed, 'p', { get: () => 1, configurable: false });
    const r2 = wrapGetter(sealed, 'p', () => undefined);
    expect(r2.status === 'unsupported' && r2.reason).toBe('non-configurable');
    expect(r2.status === 'unsupported' && r2.coverageFlag).toBe('descriptor-nonconfigurable');
  });
});

describe('wrapConstructor', () => {
  class Parent {
    static readonly KIND = 'parent';
  }
  class Base extends Parent {
    static readonly CONNECTING = 0;
    static made = 0;
    readonly args: unknown[];
    constructor(...args: unknown[]) {
      super();
      Base.made++;
      this.args = args;
    }
  }

  function namespace(): { ns: { Base: typeof Base }; Original: typeof Base } {
    // A fresh class per test so wrapping never leaks between cases.
    class Fresh extends Base {}
    return { ns: { Base: Fresh }, Original: Fresh };
  }

  it('new: real instances, instanceof, prototype identity, statics and inherited statics', () => {
    const { ns, Original } = namespace();
    const observed: Array<[number, unknown, boolean]> = [];
    installed(wrapConstructor(ns, 'Base', (args, nt, threw) => observed.push([args.length, nt, threw])));
    expect(ns.Base).not.toBe(Original);
    const inst = new ns.Base(1, 'two');
    expect(inst).toBeInstanceOf(Original);
    expect(inst instanceof ns.Base).toBe(true);
    expect(Object.getPrototypeOf(inst)).toBe(Original.prototype);
    expect(inst.args).toEqual([1, 'two']);
    expect(ns.Base.prototype).toBe(Original.prototype);
    expect(ns.Base.CONNECTING).toBe(0);
    expect(ns.Base.KIND).toBe('parent');
    expect(ns.Base.name).toBe('Fresh');
    expect(observed).toEqual([[2, ns.Base, false]]);
  });

  it('subclassing forwards new.target so the subclass prototype wins', () => {
    const { ns, Original } = namespace();
    let seenTarget: unknown = null;
    installed(wrapConstructor(ns, 'Base', (_a, nt) => (seenTarget = nt)));
    class Sub extends ns.Base {
      extra = true;
    }
    const s = new Sub('x');
    expect(s).toBeInstanceOf(Sub);
    expect(s).toBeInstanceOf(Original);
    expect(Object.getPrototypeOf(s)).toBe(Sub.prototype);
    expect(s.extra).toBe(true);
    expect(s.args).toEqual(['x']);
    expect(seenTarget).toBe(Sub);
  });

  it('called without new raises the original TypeError; constructor exceptions keep identity', () => {
    const { ns, Original } = namespace();
    installed(wrapConstructor(ns, 'Base', () => undefined));
    let direct: unknown = null;
    try {
      (Original as unknown as (...a: unknown[]) => unknown)('x');
    } catch (e) {
      direct = e;
    }
    let viaWrapper: unknown = null;
    try {
      (ns.Base as unknown as (...a: unknown[]) => unknown)('x');
    } catch (e) {
      viaWrapper = e;
    }
    expect(direct).toBeInstanceOf(TypeError);
    expect(viaWrapper).toBeInstanceOf(TypeError);
    expect((viaWrapper as Error).message).toBe((direct as Error).message);

    const err = new Error('ctor failure');
    class Throwing {
      constructor() {
        throw err;
      }
    }
    const holder = { Throwing };
    let seen: unknown = null;
    installed(wrapConstructor(holder, 'Throwing', (_a, _n, threw, error) => (seen = threw ? error : null)));
    let caught: unknown = null;
    try {
      new holder.Throwing();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(err);
    expect(seen).toBe(err);
  });

  it('calls the original constructor exactly once and restores when owned', () => {
    const { ns, Original } = namespace();
    const before = Base.made;
    const h = installed(wrapConstructor(ns, 'Base', () => undefined));
    new ns.Base();
    expect(Base.made).toBe(before + 1);
    expect(h.restore()).toBe(true);
    expect(ns.Base).toBe(Original);
  });

  it('refuses non-constructors (arrow functions) and non-configurable keys', () => {
    const holder = { Arrow: (): number => 1 };
    const r1 = wrapConstructor(holder, 'Arrow', () => undefined);
    expect(r1.status === 'unsupported' && r1.reason).toBe('not-a-constructor');
    const sealed = {};
    Object.defineProperty(sealed, 'Base', { value: Base, configurable: false, writable: true });
    const r2 = wrapConstructor(sealed, 'Base', () => undefined);
    expect(r2.status === 'unsupported' && r2.reason).toBe('non-configurable');
  });
});

describe('F135: descriptor pollution', () => {
  it('installs and restores methods, accessors, metadata and constructor statics with inherited descriptor fields', () => {
    const target = { m: () => 3, outcome: () => 6, get x() { return 4; }, C: class { static value = 5; } };
    const originalMethod = target.m;
    const originalConstructor = target.C;
    const define = Object.defineProperty;
    const keys = ['get', 'set', 'value', 'writable'];
    const previous = keys.map((key) => Object.getOwnPropertyDescriptor(Object.prototype, key));
    const handles: HookHandle[] = [];
    let error: unknown;
    let restored = false;
    try {
      for (let i = 0; i < keys.length; i++) {
        define(Object.prototype, keys[i]!, { __proto__: null, value: () => undefined, configurable: true, writable: true } as PropertyDescriptor);
      }
      handles.push(installed(wrapMethod(target, 'm', () => undefined)));
      handles.push(installed(wrapOutcomeMethod(target, 'outcome', () => undefined)));
      handles.push(installed(wrapGetter(target, 'x', () => undefined)));
      handles.push(installed(wrapConstructor(target, 'C', () => undefined)));
      restored = handles.every((handle) => handle.restore());
    } catch (caught) { error = caught; }
    finally {
      for (let i = 0; i < keys.length; i++) {
        const d = previous[i];
        if (d === undefined) Reflect.deleteProperty(Object.prototype, keys[i]!);
        else define(Object.prototype, keys[i]!, Object.assign(Object.create(null) as object, d));
      }
    }
    expect(error).toBeUndefined();
    expect(restored).toBe(true);
    expect(target.m).toBe(originalMethod);
    expect(target.C).toBe(originalConstructor);
    expect(target.x).toBe(4);
    expect(target.C.value).toBe(5);
  });

  it('an inherited get does not confer ownership of a replacement data descriptor', () => {
    const target = { get x() { return 1; } };
    const handle = installed(wrapGetter(target, 'x', () => undefined));
    const wrapper = Object.getOwnPropertyDescriptor(target, 'x')!.get;
    Object.defineProperty(target, 'x', { value: 9, configurable: true });
    const prior = Object.getOwnPropertyDescriptor(Object.prototype, 'get');
    let owned = true;
    let restored = true;
    try {
      Object.defineProperty(Object.prototype, 'get', { value: wrapper, configurable: true });
      owned = handle.isOwned();
      restored = handle.restore();
    } finally {
      Reflect.deleteProperty(Object.prototype, 'get');
      if (prior !== undefined) Object.defineProperty(Object.prototype, 'get', prior);
    }
    expect(owned).toBe(false);
    expect(restored).toBe(false);
    expect(target.x).toBe(9);
  });
});

describe('P03 constructor regressions: F051/F176 (ADR-006)', () => {
  it('records the shared prototype.constructor identity and unobserved constructor route', () => {
    class Base {}
    const ns = { Base };
    let observed = 0;
    const handle = installed(wrapConstructor(ns, 'Base', () => observed++));
    const instance = new ns.Base();
    expect(instance.constructor).toBe(Base);
    expect(ns.Base.prototype.constructor).toBe(Base);
    expect(instance.constructor).not.toBe(ns.Base);
    Reflect.construct(instance.constructor, []);
    expect(observed).toBe(1);
    handle.restore();
  });

  it('preserves the single Proxy new.target prototype read and returned prototype', () => {
    class Base {}
    const ns = { Base };
    installed(wrapConstructor(ns, 'Base', () => undefined));
    const first = {};
    const second = {};
    let reads = 0;
    const newTarget = new Proxy(function Target() {}, { get(target, key, receiver) {
      if (key === 'prototype') return ++reads === 1 ? first : second;
      return Reflect.get(target, key, receiver);
    } });
    const direct = Reflect.construct(Base, [], newTarget);
    expect(reads).toBe(1);
    expect(Object.getPrototypeOf(direct)).toBe(first);
    reads = 0;
    const wrapped = Reflect.construct(ns.Base, [], newTarget);
    expect(reads).toBe(1);
    expect(Object.getPrototypeOf(wrapped)).toBe(first);
  });

  it('never introduces a second-read exception absent from the original', () => {
    class Base {}
    const ns = { Base };
    installed(wrapConstructor(ns, 'Base', () => undefined));
    const error = new Error('second prototype read');
    let reads = 0;
    const newTarget = new Proxy(function Target() {}, { get(target, key, receiver) {
      if (key === 'prototype' && ++reads === 2) throw error;
      return Reflect.get(target, key, receiver);
    } });
    expect(() => Reflect.construct(Base, [], newTarget)).not.toThrow();
    reads = 0;
    expect(() => Reflect.construct(ns.Base, [], newTarget)).not.toThrow();
    expect(reads).toBe(1);
  });
});
