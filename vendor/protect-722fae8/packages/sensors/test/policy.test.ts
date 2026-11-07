// ADR-019 (S11): MAIN policy prelude. The slot is a primitive mask read through its own descriptor only (W1): planted
// accessors are never called and planted objects (including Proxies) are never inspected; anything other than a
// slot with the prelude's shape yields null (the sensor then installs nothing).

import { describe, expect, it } from 'vitest';
import { SENSOR_IDS } from '@detect-expert/contracts';
import { beginSensorPolicy, markSensorOff, takeSensorPolicy } from '../src/index';

const KEY = Symbol.for('detect.expert/sensor-policy/v1');
const N = SENSOR_IDS.length;

function realm(): Record<PropertyKey, unknown> {
  return {};
}

describe('sensor policy prelude', () => {
  it('begin -> take returns 0 and removes the record', () => {
    const w = realm();
    beginSensorPolicy(w);
    const d = Object.getOwnPropertyDescriptor(w, KEY)!;
    expect(d.configurable).toBe(true);
    expect(d.enumerable).toBe(false);
    expect(d.writable).toBe(false);
    expect(d.value).toBe(0);
    expect(takeSensorPolicy(w, N)).toBe(0);
    expect(Object.getOwnPropertyDescriptor(w, KEY)).toBeUndefined();
    // A second take finds nothing.
    expect(takeSensorPolicy(w, N)).toBeNull();
  });

  it('mark sets bits (idempotent), take returns the mask', () => {
    const w = realm();
    beginSensorPolicy(w);
    markSensorOff(w, 1 << 0);
    markSensorOff(w, 1 << 5);
    markSensorOff(w, 1 << 5);
    expect(takeSensorPolicy(w, N)).toBe(1 | 32);
  });

  it('mark without a record or with an invalid bit does nothing', () => {
    const w = realm();
    markSensorOff(w, 1);
    expect(Object.getOwnPropertySymbols(w)).toEqual([]);
    beginSensorPolicy(w);
    markSensorOff(w, 0);
    markSensorOff(w, -1);
    markSensorOff(w, 1.5);
    expect(takeSensorPolicy(w, N)).toBe(0);
  });

  it('a page-planted configurable accessor is replaced by begin without calling its getter or setter', () => {
    const w = realm();
    let calls = 0;
    Object.defineProperty(w, KEY, { configurable: true, get() { calls++; return { v: 1, off: 0 }; }, set() { calls++; } });
    beginSensorPolicy(w);
    markSensorOff(w, 2);
    expect(takeSensorPolicy(w, N)).toBe(2);
    expect(calls).toBe(0);
  });

  it('an accessor left in place is rejected (and removed) by take without being called', () => {
    const w = realm();
    let calls = 0;
    Object.defineProperty(w, KEY, { configurable: true, get() { calls++; return 0; } });
    markSensorOff(w, 1);
    expect(takeSensorPolicy(w, N)).toBeNull();
    expect(Object.getOwnPropertyDescriptor(w, KEY)).toBeUndefined();
    expect(calls).toBe(0);
  });

  it('a non-configurable plant makes begin fail closed and take return null', () => {
    const w = realm();
    Object.defineProperty(w, KEY, { value: 0, configurable: false });
    beginSensorPolicy(w);
    markSensorOff(w, 1);
    expect(Object.getOwnPropertyDescriptor(w, KEY)?.value).toBe(0); // not marked
    expect(takeSensorPolicy(w, N)).toBeNull();
    // Still there (cannot be removed); the next take is null again.
    expect(takeSensorPolicy(w, N)).toBeNull();
  });

  it('W1: a planted Proxy (non-configurable, or configurable after begin) never runs a trap; mark leaves it, take is null', () => {
    const traps: string[] = [];
    const handler: ProxyHandler<object> = {};
    for (const name of ['get', 'set', 'has', 'getPrototypeOf', 'setPrototypeOf', 'getOwnPropertyDescriptor', 'defineProperty', 'deleteProperty', 'ownKeys', 'isExtensible', 'preventExtensions', 'apply', 'construct'] as const) {
      (handler as Record<string, unknown>)[name] = (...args: unknown[]) => {
        traps.push(name);
        return (Reflect as unknown as Record<string, (...a: unknown[]) => unknown>)[name]!(...args);
      };
    }
    const proxy = (): object => new Proxy(Object.assign(Object.create(null), { v: 1, off: 0 }) as object, handler);
    // Non-configurable plant before the prelude (the reviewer's activeTab late-injection scenario).
    const fixed = realm();
    Object.defineProperty(fixed, KEY, { value: proxy(), configurable: false });
    beginSensorPolicy(fixed);
    markSensorOff(fixed, 4);
    expect(takeSensorPolicy(fixed, N)).toBeNull();
    // Configurable plant between the prelude files (page ran between them): mark and take still never touch it.
    const between = realm();
    beginSensorPolicy(between);
    Object.defineProperty(between, KEY, { value: proxy(), configurable: true, writable: false, enumerable: false });
    markSensorOff(between, 4);
    expect(takeSensorPolicy(between, N)).toBeNull();
    expect(Object.getOwnPropertyDescriptor(between, KEY)).toBeUndefined(); // removed by take
    expect(traps).toEqual([]);
  });

  it('rejects slots without the prelude shape: objects, non-integer or out-of-range masks, accessors, writable or enumerable', () => {
    const plant = (value: unknown, over: PropertyDescriptor = {}): Record<PropertyKey, unknown> => {
      const w = realm();
      Object.defineProperty(w, KEY, { value, configurable: true, writable: false, enumerable: false, ...over });
      return w;
    };
    const nullProto = (fields: Record<string, unknown>): object => Object.assign(Object.create(null), fields);
    // Objects are never the format (the former record shape included): rejected without being read.
    expect(takeSensorPolicy(plant({ v: 1, off: 0 }), N)).toBeNull();
    expect(takeSensorPolicy(plant(nullProto({ v: 1, off: 2 ** N - 1 })), N)).toBeNull();
    expect(takeSensorPolicy(plant(1.5), N)).toBeNull();
    expect(takeSensorPolicy(plant(-1), N)).toBeNull();
    expect(takeSensorPolicy(plant(2 ** N), N)).toBeNull();
    expect(takeSensorPolicy(plant(2 ** 40), N)).toBeNull();
    expect(takeSensorPolicy(plant(NaN), N)).toBeNull();
    expect(takeSensorPolicy(plant('1'), N)).toBeNull();
    expect(takeSensorPolicy(plant(1n), N)).toBeNull();
    expect(takeSensorPolicy(plant(null), N)).toBeNull();
    expect(takeSensorPolicy(plant(1, { writable: true }), N)).toBeNull(); // e.g. a plain page assignment
    expect(takeSensorPolicy(plant(1, { enumerable: true }), N)).toBeNull();
    expect(takeSensorPolicy(plant(2 ** N - 1), N)).toBe(2 ** N - 1);
    // A mark on a foreign-shaped slot leaves it untouched.
    const writable = plant(1, { writable: true });
    markSensorOff(writable, 2);
    expect(Object.getOwnPropertyDescriptor(writable, KEY)?.value).toBe(1);
  });

  it('never invokes Object.prototype getters named like descriptor fields', () => {
    const w = realm();
    let calls = 0;
    let result: number | null = null;
    try {
      // Null-prototype descriptors: the second definition must not inherit the first poisoned 'value'.
      Object.defineProperty(Object.prototype, 'value', { __proto__: null, configurable: true, get() { calls++; return undefined; } } as PropertyDescriptor);
      Object.defineProperty(Object.prototype, 'get', { __proto__: null, configurable: true, get() { calls++; return undefined; } } as PropertyDescriptor);
      // Only the prelude runs while the poisoned prototype is in place (no test framework code in between).
      beginSensorPolicy(w);
      markSensorOff(w, 4);
      result = takeSensorPolicy(w, N);
    } finally {
      delete (Object.prototype as Record<string, unknown>)['value'];
      delete (Object.prototype as Record<string, unknown>)['get'];
    }
    expect(result).toBe(4);
    expect(calls).toBe(0);
  });

  it('take validates the family count', () => {
    const w = realm();
    beginSensorPolicy(w);
    expect(takeSensorPolicy(w, 0)).toBeNull();
    expect(takeSensorPolicy(w, 31)).toBeNull();
    expect(takeSensorPolicy(w, 1.5)).toBeNull();
  });
});
