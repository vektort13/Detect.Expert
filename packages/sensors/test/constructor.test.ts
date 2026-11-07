// P03 / REQ-001 / ADR-006: differential constructor semantics, including hostile new.target.
import { describe, expect, it } from 'vitest';
import { createHookContext, wrapConstructor } from '../src/index';

function caught(call: () => unknown): unknown {
  try { call(); } catch (error) { return error; }
  throw new Error('expected exception');
}

describe('P03 differential constructors', () => {
  it('preserves direct and subclass new.target, arguments and exactly one original call', () => {
    const arg = new Proxy({}, { get() { throw new Error('argument inspected'); } });
    for (const wrapped of [false, true]) {
      const calls: unknown[][] = [];
      class Base {
        constructor(...args: unknown[]) { calls.push([new.target, ...args]); }
      }
      const ns = { Base };
      if (wrapped) expect(wrapConstructor(ns, 'Base', () => undefined).status).toBe('installed');
      const base = new ns.Base(arg);
      class Sub extends ns.Base {}
      const sub = new Sub(arg);
      expect(calls).toHaveLength(2);
      expect(calls[0]![0]).toBe(Base);
      expect(calls[1]![0]).toBe(Sub);
      expect(calls[0]![1]).toBe(arg);
      expect(calls[1]![1]).toBe(arg);
      expect(base instanceof Base && base instanceof ns.Base).toBe(true);
      expect(sub instanceof Base && sub instanceof ns.Base && sub instanceof Sub).toBe(true);
      expect(Object.getPrototypeOf(sub)).toBe(Sub.prototype);
      expect(new Base() instanceof ns.Base).toBe(true);
    }
  });

  it.each(['base', 'derived', 'object-return', 'derived-object-return'] as const)('preserves get prototype order for %s constructors', (kind) => {
    function run(wrapped: boolean) {
      const log: string[] = [];
      const returned = {};
      class Parent { constructor() { log.push('parent'); } }
      const returnsObject = kind === 'object-return' || kind === 'derived-object-return';
      const Base = kind === 'derived-object-return' ? class extends Parent {
        constructor() {
          log.push('body without super');
          if (kind === 'derived-object-return') return returned;
          super();
        }
      } : kind === 'derived' ? class extends Parent {
        constructor() { log.push('before super'); super(); log.push('after super'); }
      } : class {
        constructor() { log.push('body'); if (kind === 'object-return') return returned; }
      };
      const ns = { Base };
      if (wrapped) {
        expect(wrapConstructor(ns, 'Base', () => undefined).status).toBe('installed');
        expect(ns.Base).not.toBe(Base);
      }
      const proto = {};
      const target = new Proxy(function Target() {}, { get(t, key, receiver) {
        log.push('get ' + String(key));
        return key === 'prototype' ? proto : Reflect.get(t, key, receiver);
      } });
      const value = Reflect.construct(ns.Base, [], target);
      return { log, correctResult: returnsObject ? value === returned : Object.getPrototypeOf(value) === proto };
    }
    const baseline = run(false);
    expect(baseline.log.filter((entry) => entry === 'get prototype')).toHaveLength(kind === 'derived-object-return' ? 0 : 1);
    expect(baseline.correctResult).toBe(true);
    expect(run(true)).toEqual(baseline);
  });

  it('preserves a first-read thrown object and observes the same exception after the trap', () => {
    const error = {};
    for (const wrapped of [false, true]) {
      const log: string[] = [];
      let observation: unknown[] | undefined;
      class Base { constructor() { log.push('body'); } }
      const ns = { Base };
      if (wrapped) wrapConstructor(ns, 'Base', (_args, _nt, threw, observedError) => {
        observation = [threw, observedError];
        log.push('observer');
      });
      const target = new Proxy(function Target() {}, { get() { log.push('get prototype'); throw error; } });
      expect(caught(() => Reflect.construct(ns.Base, [], target))).toBe(error);
      expect(log).toEqual(wrapped ? ['get prototype', 'observer'] : ['get prototype']);
      if (wrapped) expect(observation).toEqual([true, error]);
    }
  });

  it('preserves returned object/Promise and thrown object identity even if the observer throws', () => {
    for (const result of [{}, Promise.resolve(1)]) {
      for (const throws of [false, true]) {
        let calls = 0;
        function Original() { calls++; if (throws) throw result; return result; }
        const ns = { Original };
        const baseline = throws ? caught(() => Reflect.construct(Original, [])) : Reflect.construct(Original, []);
        const context = createHookContext();
        wrapConstructor(ns, 'Original', () => { throw new Error('observer'); }, { context });
        const actual = throws ? caught(() => Reflect.construct(ns.Original, [])) : Reflect.construct(ns.Original, []);
        expect(actual).toBe(baseline);
        expect(calls).toBe(2);
        expect(context.observerErrors).toBe(1);
      }
    }
  });

  it('forwards calls without new with the same receiver, result and original exception', () => {
    const self = {};
    const error = new TypeError("Constructor requires 'new'");
    let calls = 0;
    function Original(this: unknown, arg: unknown) { calls++; expect(this).toBe(self); if (arg) throw error; return self; }
    const ns = { Original };
    wrapConstructor(ns, 'Original', () => undefined);
    for (const ctor of [Original, ns.Original]) {
      expect(Reflect.apply(ctor, self, [false])).toBe(self);
      expect(caught(() => Reflect.apply(ctor, self, [true]))).toBe(error);
    }
    expect(calls).toBe(4);
  });

  it('copies static descriptors without getters, shares values and preserves Symbol.hasInstance dispatch', () => {
    const value = {};
    const symbol = Symbol('static');
    const receivers: unknown[] = [];
    class Parent { static inherited = value; }
    class Base extends Parent {
      static data = value;
      static [symbol] = value;
      static get accessor() { receivers.push(this); return value; }
      static override [Symbol.hasInstance](candidate: unknown) { receivers.push(this); return candidate === value; }
    }
    Object.defineProperty(Base, 'name', { value: 'Base', writable: true, enumerable: true, configurable: false });
    Object.defineProperty(Base, 'length', { value: 3, writable: true, enumerable: true, configurable: false });
    const ns = { Base };
    expect(wrapConstructor(ns, 'Base', () => undefined).status).toBe('installed');
    expect(ns.Base).not.toBe(Base);
    expect(receivers).toEqual([]);
    for (const key of ['name', 'length', 'data', 'accessor', symbol, Symbol.hasInstance]) {
      expect(Object.getOwnPropertyDescriptor(ns.Base, key)).toEqual(Object.getOwnPropertyDescriptor(Base, key));
    }
    expect(ns.Base.data).toBe(value);
    expect(ns.Base[symbol]).toBe(value);
    expect(ns.Base.inherited).toBe(value);
    expect(ns.Base.accessor).toBe(Base.accessor);
    expect(value instanceof ns.Base).toBe(value instanceof Base);
    expect({} instanceof ns.Base).toBe({} instanceof Base);
    expect(receivers).toEqual([ns.Base, Base, ns.Base, Base, ns.Base, Base]);
    expect(ns.Base.prototype.constructor).toBe(Base);
  });

  it('keeps pause, reentrancy, metadata opt-out and ownership-safe cleanup', () => {
    class Base {}
    const ns = { Base };
    let observations = 0;
    const context = createHookContext();
    const handle = wrapConstructor(ns, 'Base', () => { observations++; new ns.Base(); }, { context, copyNameAndLength: false });
    expect(handle.status).toBe('installed');
    new ns.Base();
    expect(observations).toBe(1);
    context.enabled = false;
    new ns.Base();
    expect(observations).toBe(1);
    expect(ns.Base.name).not.toBe(Base.name);
    expect(wrapConstructor(ns, 'Base', () => undefined)).toBe(handle);
    ns.Base = class Replacement {};
    if (handle.status === 'installed') expect(handle.restore()).toBe(false);
    expect(ns.Base.name).toBe('Replacement');
  });
});
