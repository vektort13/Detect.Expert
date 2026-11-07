// ADR-017 §5 (task E06-03): one accessor slot per key. Before S02, wrapGetter after wrapSetter on the same key
// silently returned the setter's handle (latent defect); now the second kind is refused without touching anything.

import { describe, expect, it } from 'vitest';
import { wrapGetter, wrapMethod, wrapSetter } from '../src/index';
import type { HookHandle, WrapResult } from '../src/index';
import { existingHandle } from '../src/wrap';

function installed(r: WrapResult): HookHandle {
  if (r.status !== 'installed') throw new Error('expected installed hook, got ' + r.reason);
  return r;
}

function accessorTarget(): { target: object; get: () => number; set: (v: unknown) => void } {
  const get = function (this: unknown): number { return 1; };
  const set = function (this: unknown, _v: unknown): void { /* native-like no-op */ };
  const target = {};
  Object.defineProperty(target, 'width', { get, set, enumerable: true, configurable: true });
  return { target, get, set };
}

describe('accessor slots (ADR-017 §5)', () => {
  it('getter first: a setter hook on the same key is refused, the descriptor keeps our getter and the original setter', () => {
    const { target, set } = accessorTarget();
    const getterHandle = installed(wrapGetter(target, 'width', () => undefined));
    const before = Object.getOwnPropertyDescriptor(target, 'width');
    const second = wrapSetter(target, 'width', () => undefined);
    expect(second).toMatchObject({ status: 'unsupported', kind: 'setter', reason: 'accessor-slot-wrapped', coverageFlag: 'hook-failed', label: 'width' });
    expect(Object.getOwnPropertyDescriptor(target, 'width')).toEqual(before);
    expect(Object.getOwnPropertyDescriptor(target, 'width')!.set).toBe(set);
    expect(existingHandle(target, 'width', 'getter')).toBe(getterHandle);
    expect(existingHandle(target, 'width', 'setter')).toBeNull();
  });

  it('setter first: a getter hook on the same key is refused, the descriptor keeps the original getter and our setter', () => {
    const { target, get } = accessorTarget();
    const setterHandle = installed(wrapSetter(target, 'width', () => undefined));
    const before = Object.getOwnPropertyDescriptor(target, 'width');
    const second = wrapGetter(target, 'width', () => undefined);
    expect(second).toMatchObject({ status: 'unsupported', kind: 'getter', reason: 'accessor-slot-wrapped', coverageFlag: 'hook-failed' });
    expect(second).not.toBe(setterHandle); // the defect: the setter handle came back as if the getter were wrapped
    expect(Object.getOwnPropertyDescriptor(target, 'width')).toEqual(before);
    expect(Object.getOwnPropertyDescriptor(target, 'width')!.get).toBe(get);
  });

  it('repeating the same kind returns the same handle (no double wrapping, ADR-006 §9)', () => {
    const { target } = accessorTarget();
    let first = 0;
    let second = 0;
    const g1 = installed(wrapGetter(target, 'width', () => first++));
    expect(wrapGetter(target, 'width', () => second++)).toBe(g1);
    void (target as { width: number }).width;
    expect([first, second]).toEqual([1, 0]);
    const other = accessorTarget();
    const s1 = installed(wrapSetter(other.target, 'width', () => undefined));
    expect(wrapSetter(other.target, 'width', () => undefined)).toBe(s1);
  });

  it('after the first hook is restored, the other slot kind can be installed', () => {
    const { target, get, set } = accessorTarget();
    const g = installed(wrapGetter(target, 'width', () => undefined));
    expect(g.restore()).toBe(true);
    expect(existingHandle(target, 'width', 'getter')).toBeNull();
    const s = installed(wrapSetter(target, 'width', () => undefined));
    expect(Object.getOwnPropertyDescriptor(target, 'width')!.get).toBe(get);
    expect(Object.getOwnPropertyDescriptor(target, 'width')!.set).not.toBe(set);
    expect(s.restore()).toBe(true);
    expect(Object.getOwnPropertyDescriptor(target, 'width')).toMatchObject({ get, set });
  });

  it('a method hook on a key does not hand its handle to another kind', () => {
    const target = { m(): number { return 1; } };
    installed(wrapMethod(target, 'm', () => undefined));
    expect(wrapGetter(target, 'm', () => undefined)).toMatchObject({ status: 'unsupported', reason: 'accessor-slot-wrapped' });
  });

  it('slot lookups ignore inherited (page-planted) getter/setter properties', () => {
    const { target } = accessorTarget();
    const fake = { status: 'installed', kind: 'getter' };
    Object.defineProperty(Object.prototype, 'getter', { configurable: true, value: fake });
    let result: WrapResult | undefined;
    try {
      installed(wrapSetter(target, 'width', () => undefined));
      result = wrapGetter(target, 'width', () => undefined);
    } finally {
      Reflect.deleteProperty(Object.prototype, 'getter');
    }
    expect(result).not.toBe(fake);
    expect(result).toMatchObject({ status: 'unsupported', reason: 'accessor-slot-wrapped' });
  });
});
