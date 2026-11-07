import { describe, expect, it } from 'vitest';
import { createHookContext, wrapSetter } from '../src/wrap';

describe('P04 / ADR-006 setter semantics', () => {
  it('forwards receiver, arguments, result and exception identity once, isolates observer failure and respects pause', () => {
    const receiver = {};
    const arg = {};
    const result = {};
    const error = {};
    const calls: unknown[][] = [];
    let fail = false;
    const getter = () => 32;
    const proto = {};
    Object.defineProperty(proto, 'width', {
      configurable: true, enumerable: true, get: getter,
      set: function (value) { calls.push([this, value]); if (fail) throw error; return result; },
    });
    const original = Object.getOwnPropertyDescriptor(proto, 'width');
    const context = createHookContext();
    let observations = 0;
    const handle = wrapSetter(proto, 'width', () => { observations++; throw new Error('observer'); }, { context });
    const wrapped = Object.getOwnPropertyDescriptor(proto, 'width')!;
    expect(wrapped.get).toBe(getter);
    expect(Reflect.apply(wrapped.set!, receiver, [arg])).toBe(result);
    expect(calls).toEqual([[receiver, arg]]);
    expect(context.observerErrors).toBe(1);
    fail = true;
    let caught;
    try { Reflect.apply(wrapped.set!, receiver, [arg]); } catch (e) { caught = e; }
    expect(caught).toBe(error);
    context.enabled = false;
    fail = false;
    expect(Reflect.apply(wrapped.set!, receiver, [arg])).toBe(result);
    expect(observations).toBe(2);
    expect(calls).toHaveLength(3);
    expect(wrapSetter(proto, 'width', () => {})).toBe(handle);
    expect(handle.status === 'installed' && handle.restore()).toBe(true);
    expect(Object.getOwnPropertyDescriptor(proto, 'width')).toEqual(original);
  });

  it.each(['get', 'set'] as const)('cleanup preserves a page replacement of %s', (key) => {
    const proto = {};
    Object.defineProperty(proto, 'height', { configurable: true, get() { return 1; }, set(_value) {} });
    const handle = wrapSetter(proto, 'height', () => {});
    Object.defineProperty(proto, 'height', { [key]: () => 2 });
    const replaced = Object.getOwnPropertyDescriptor(proto, 'height');
    expect(handle.status === 'installed' && handle.restore()).toBe(false);
    expect(Object.getOwnPropertyDescriptor(proto, 'height')).toEqual(replaced);
  });

  it('declines missing, readonly and non-configurable accessors', () => {
    const proto = {};
    Object.defineProperty(proto, 'readonly', { configurable: true, get() { return 1; } });
    Object.defineProperty(proto, 'frozen', { set(_value) {} });
    expect(wrapSetter(proto, 'missing', () => {})).toMatchObject({ status: 'unsupported', reason: 'missing' });
    expect(wrapSetter(proto, 'readonly', () => {})).toMatchObject({ status: 'unsupported', reason: 'not-a-setter' });
    expect(wrapSetter(proto, 'frozen', () => {})).toMatchObject({ status: 'unsupported', reason: 'non-configurable' });
  });
});
