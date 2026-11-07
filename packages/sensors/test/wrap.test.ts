// Semantic-preservation contract tests for the hook utilities (REQ-001/002/003, ADR-006, task E06-01).
// Fake objects only: no DOM. Each case builds fresh targets because wrappers mutate the target in place.

import { describe, expect, it } from 'vitest';
import { createHookContext, wrapConstructor, wrapGetter, wrapMethod } from '../src/index';
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

describe('wrapGetter', () => {
  it('CORE-03: never replaces a foreign setter, including a newly added setter', () => {
    for (const withSetter of [false, true]) {
      let originalWrites = 0;
      let foreignWrites = 0;
      const target: { p?: number } = {};
      Object.defineProperty(target, 'p', {
        get: () => 7,
        ...(withSetter ? { set: () => { originalWrites++; } } : {}),
        configurable: true,
      });
      const handle = installed(wrapGetter(target, 'p', () => undefined));
      const ours = Object.getOwnPropertyDescriptor(target, 'p')!;
      const foreign = (): void => { foreignWrites++; };
      Object.defineProperty(target, 'p', { ...ours, set: foreign });
      expect(handle.isOwned()).toBe(false);
      expect(handle.restore()).toBe(false);
      expect(Object.getOwnPropertyDescriptor(target, 'p')?.get).toBe(ours.get);
      expect(Object.getOwnPropertyDescriptor(target, 'p')?.set).toBe(foreign);
      target.p = 9;
      expect(originalWrites).toBe(0);
      expect(foreignWrites).toBe(1);
    }
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
    const target = { m: () => 3, get x() { return 4; }, C: class { static value = 5; } };
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
