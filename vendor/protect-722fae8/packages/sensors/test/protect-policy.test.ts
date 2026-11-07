// ADR-020 §10 (S05): MAIN prelude of the module «Защита». An ON mask of PROTECT_MAIN_GROUPS that fails closed: no
// valid record -> 0 -> protect.main.js installs nothing. The slot is a primitive read through its own descriptor only:
// planted accessors are never called and planted objects (including Proxies) are never inspected.

import { describe, expect, it } from 'vitest';
import { PROTECT_MAIN_GROUPS, protectGroupBit } from '@detect-expert/contracts';
import { beginProtectPolicy, markProtectGroupOn, takeProtectPolicy } from '../src/protect-policy';

const KEY = Symbol.for('detect.expert/protect-policy/v1');
const OBSERVATION_KEY = Symbol.for('detect.expert/sensor-policy/v1');
const N = PROTECT_MAIN_GROUPS.length;
const SEND = protectGroupBit('send');
const LISTEN = protectGroupBit('listen');

function realm(): Record<PropertyKey, unknown> {
  return {};
}

describe('protect policy prelude', () => {
  it('begin -> take returns 0 (no group) and removes the record', () => {
    const w = realm();
    beginProtectPolicy(w);
    const d = Object.getOwnPropertyDescriptor(w, KEY)!;
    expect(d).toMatchObject({ value: 0, configurable: true, enumerable: false, writable: false });
    expect(takeProtectPolicy(w, N)).toBe(0);
    expect(Object.getOwnPropertyDescriptor(w, KEY)).toBeUndefined();
  });

  it('fail closed: no record at all -> 0', () => {
    expect(takeProtectPolicy(realm(), N)).toBe(0);
  });

  it('mark sets the bits of enabled groups (idempotent); take returns the ON mask once', () => {
    const w = realm();
    beginProtectPolicy(w);
    markProtectGroupOn(w, SEND);
    markProtectGroupOn(w, LISTEN);
    markProtectGroupOn(w, LISTEN);
    expect(takeProtectPolicy(w, N)).toBe(SEND | LISTEN);
    // The record is consumed: a second take (re-injected protect.main.js) installs nothing.
    expect(takeProtectPolicy(w, N)).toBe(0);
  });

  it('mark without a record or with an invalid bit does nothing', () => {
    const w = realm();
    markProtectGroupOn(w, SEND);
    expect(Object.getOwnPropertySymbols(w)).toEqual([]);
    beginProtectPolicy(w);
    for (const bit of [0, -1, 1.5, Number.NaN, 2 ** 30, Number.POSITIVE_INFINITY]) markProtectGroupOn(w, bit);
    expect(takeProtectPolicy(w, N)).toBe(0);
  });

  it('a mask above 2^groupCount - 1 is rejected (0) and removed', () => {
    const w = realm();
    beginProtectPolicy(w);
    markProtectGroupOn(w, 1 << N);
    expect(takeProtectPolicy(w, N)).toBe(0);
    expect(Object.getOwnPropertyDescriptor(w, KEY)).toBeUndefined();
  });

  it('an invalid group count fails closed', () => {
    for (const count of [0, -1, 1.5, 31, Number.NaN]) {
      const w = realm();
      beginProtectPolicy(w);
      markProtectGroupOn(w, SEND);
      expect(takeProtectPolicy(w, count)).toBe(0);
    }
  });

  it('a page-planted configurable accessor is replaced by begin without calling its getter or setter', () => {
    const w = realm();
    let calls = 0;
    Object.defineProperty(w, KEY, { configurable: true, get() { calls++; return 3; }, set() { calls++; } });
    beginProtectPolicy(w);
    markProtectGroupOn(w, SEND);
    expect(takeProtectPolicy(w, N)).toBe(SEND);
    expect(calls).toBe(0);
  });

  it('page substitution of the slot: an accessor left in place -> 0, removed, never called', () => {
    const w = realm();
    let calls = 0;
    Object.defineProperty(w, KEY, { configurable: true, get() { calls++; return SEND | LISTEN; } });
    markProtectGroupOn(w, SEND);
    expect(takeProtectPolicy(w, N)).toBe(0);
    expect(Object.getOwnPropertyDescriptor(w, KEY)).toBeUndefined();
    expect(calls).toBe(0);
  });

  it('page substitution of the slot: an object or a Proxy is never inspected', () => {
    for (const planted of [{ valueOf: () => 3 }, new Proxy({}, { get() { throw new Error('trap'); }, getPrototypeOf() { throw new Error('trap'); } })]) {
      const w = realm();
      Object.defineProperty(w, KEY, { value: planted, configurable: true, writable: false, enumerable: false });
      expect(takeProtectPolicy(w, N)).toBe(0);
      expect(Object.getOwnPropertyDescriptor(w, KEY)).toBeUndefined();
    }
  });

  it('page substitution of the slot: a writable or enumerable data property is not the prelude shape -> 0', () => {
    for (const shape of [{ writable: true, enumerable: false }, { writable: false, enumerable: true }]) {
      const w = realm();
      Object.defineProperty(w, KEY, { value: SEND | LISTEN, configurable: true, ...shape });
      expect(takeProtectPolicy(w, N)).toBe(0);
    }
  });

  it('a page-planted mask with the prelude shape is taken as is (not a security boundary; documented)', () => {
    const w = realm();
    Object.defineProperty(w, KEY, { value: SEND | LISTEN, configurable: true, writable: false, enumerable: false });
    expect(takeProtectPolicy(w, N)).toBe(SEND | LISTEN);
  });

  it('a non-configurable plant makes begin fail closed and take return 0 every time', () => {
    const w = realm();
    Object.defineProperty(w, KEY, { value: SEND, configurable: false });
    beginProtectPolicy(w);
    markProtectGroupOn(w, LISTEN);
    expect(Object.getOwnPropertyDescriptor(w, KEY)?.value).toBe(SEND); // not marked
    expect(takeProtectPolicy(w, N)).toBe(0);
    expect(takeProtectPolicy(w, N)).toBe(0);
  });

  it('a sealed realm: begin fails closed without throwing', () => {
    const w = Object.preventExtensions(realm());
    expect(() => beginProtectPolicy(w)).not.toThrow();
    expect(() => markProtectGroupOn(w, SEND)).not.toThrow();
    expect(takeProtectPolicy(w, N)).toBe(0);
  });

  it('uses its own key: the observation sensor policy slot is neither read nor changed', () => {
    const w = realm();
    Object.defineProperty(w, OBSERVATION_KEY, { value: 5, configurable: true, writable: false, enumerable: false });
    beginProtectPolicy(w);
    markProtectGroupOn(w, SEND);
    expect(takeProtectPolicy(w, N)).toBe(SEND);
    expect(Object.getOwnPropertyDescriptor(w, OBSERVATION_KEY)?.value).toBe(5);
  });
});
