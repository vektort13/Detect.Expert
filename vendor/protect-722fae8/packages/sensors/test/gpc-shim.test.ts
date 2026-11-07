// ADR-020 §H (S13): installGpcProperty — the descriptor of navigator.globalPrivacyControl, an existing property is never
// changed or called, own-descriptor reads only (no page getter runs), a frozen prototype is a quiet failure,
// idempotence, Function.prototype.toString untouched (no masking, REQ-003), and the environment sensor of observation
// never hooks the property (both install orders): reading it adds no DET-025 count.

import { describe, expect, it } from 'vitest';
import { GPC_PROPERTY, installGpcProperty } from '../src/gpc-shim';
import { FAMILY_CONFIG, SensorRuntime, installEnvironmentSensor } from '../src/index';
import { bridgeHello, deliver, makeEnv } from './helpers';

interface FakeRealm {
  realm: Record<string, unknown>;
  proto: Record<string, unknown>;
  navigator: Record<string, unknown>;
  calls: Record<string, number>;
}

/** A realm like `window`: Navigator as an own data property, native-like getters that brand-check their receiver. */
function makeRealm(): FakeRealm {
  const calls: Record<string, number> = {};
  const branded = new WeakSet<object>();
  class Navigator {
    constructor() {
      branded.add(this);
    }
  }
  const getter = (key: string, value: unknown) => ({
    configurable: true,
    enumerable: true,
    get: function (this: object): unknown {
      calls[key] = (calls[key] ?? 0) + 1;
      if (!branded.has(this)) throw new TypeError('Illegal invocation');
      return value;
    },
  });
  for (const [key, value] of [['userAgent', 'CANARY-UA'], ['platform', 'CANARY-PLATFORM'], ['vendor', 'CANARY-VENDOR'], ['language', 'xx'], ['languages', ['xx']]] as const) {
    Object.defineProperty(Navigator.prototype, key, getter(key, value));
  }
  const realm: Record<string, unknown> = { Navigator };
  return { realm, proto: Navigator.prototype as unknown as Record<string, unknown>, navigator: new Navigator() as unknown as Record<string, unknown>, calls };
}

describe('installGpcProperty', () => {
  it('defines a plain, named, enumerable and configurable getter returning true, without a setter', () => {
    const f = makeRealm();
    expect(installGpcProperty(f.realm)).toBe('defined');
    const d = Object.getOwnPropertyDescriptor(f.proto, GPC_PROPERTY)!;
    expect(Object.keys(d).sort()).toEqual(['configurable', 'enumerable', 'get', 'set']);
    expect(d.set).toBeUndefined();
    expect(d.enumerable).toBe(true);
    expect(d.configurable).toBe(true);
    expect(typeof d.get).toBe('function');
    expect(d.get!.name).toBe('detectExpertGpcGetter');
    expect(d.get!.length).toBe(0);
    expect(f.navigator[GPC_PROPERTY]).toBe(true);
    // Not an own property of the instance: only the prototype carries it.
    expect(Object.getOwnPropertyDescriptor(f.navigator, GPC_PROPERTY)).toBeUndefined();
    // Assignment is ignored outside strict mode and throws in strict mode, like a native read-only accessor.
    expect(() => {
      'use strict';
      (f.navigator as { globalPrivacyControl: unknown }).globalPrivacyControl = false;
    }).toThrow(TypeError);
    expect(f.navigator[GPC_PROPERTY]).toBe(true);
  });

  it('is not masked: the getter source is ours, Function.prototype.toString and its descriptor stay as they were', () => {
    const toString = Function.prototype.toString;
    const before = Object.getOwnPropertyDescriptor(Function.prototype, 'toString');
    const f = makeRealm();
    installGpcProperty(f.realm);
    expect(Function.prototype.toString).toBe(toString);
    expect(Object.getOwnPropertyDescriptor(Function.prototype, 'toString')).toEqual(before);
    const source = toString.call(Object.getOwnPropertyDescriptor(f.proto, GPC_PROPERTY)!.get);
    expect(source).toContain('detectExpertGpcGetter');
    expect(source).not.toContain('[native code]');
  });

  it('leaves an existing property alone (native or planted) and never calls a planted accessor', () => {
    for (const kind of ['accessor', 'data'] as const) {
      const f = makeRealm();
      let called = 0;
      const planted: PropertyDescriptor = kind === 'accessor'
        ? { configurable: true, enumerable: false, get: () => { called++; return false; } }
        : { configurable: false, enumerable: false, writable: false, value: 'page' };
      Object.defineProperty(f.proto, GPC_PROPERTY, planted);
      const before = Object.getOwnPropertyDescriptor(f.proto, GPC_PROPERTY);
      expect(installGpcProperty(f.realm), kind).toBe('present');
      expect(Object.getOwnPropertyDescriptor(f.proto, GPC_PROPERTY), kind).toEqual(before);
      expect(called, kind).toBe(0);
    }
  });

  it('reads own data descriptors only: an accessor Navigator or prototype is never called', () => {
    let calls = 0;
    const accessorRealm = {};
    Object.defineProperty(accessorRealm, 'Navigator', { configurable: true, get: () => { calls++; return function Navigator() { /* page */ }; } });
    expect(installGpcProperty(accessorRealm)).toBe('failed');
    // An interface object whose `prototype` became an accessor (a plain object stands in for the function so the
    // property can be redefined): not a function → failed before any read.
    const accessorProto = { prototype: undefined as unknown };
    Object.defineProperty(accessorProto, 'prototype', { get: () => { calls++; return {}; } });
    expect(installGpcProperty({ Navigator: accessorProto })).toBe('failed');
    const fnWithGetter = new Proxy(function Navigator(): void { /* page */ }, {});
    Object.defineProperty(fnWithGetter, 'extra', { get: () => { calls++; return 1; } });
    expect(installGpcProperty({ Navigator: fnWithGetter })).toBe('defined');
    expect(calls).toBe(0);
    expect(installGpcProperty({})).toBe('failed');
    expect(installGpcProperty({ Navigator: 'not a function' })).toBe('failed');
    const noProto = function Navigator(): void { /* page */ };
    Object.defineProperty(noProto, 'prototype', { value: null });
    expect(installGpcProperty({ Navigator: noProto })).toBe('failed');
  });

  it('a frozen prototype is a quiet failure (nothing thrown into the page)', () => {
    const f = makeRealm();
    Object.freeze(f.proto);
    expect(() => installGpcProperty(f.realm)).not.toThrow();
    expect(installGpcProperty(f.realm)).toBe('failed');
    expect(Object.getOwnPropertyDescriptor(f.proto, GPC_PROPERTY)).toBeUndefined();
  });

  it('is idempotent: a second call finds the property and keeps the same getter', () => {
    const f = makeRealm();
    expect(installGpcProperty(f.realm)).toBe('defined');
    const first = Object.getOwnPropertyDescriptor(f.proto, GPC_PROPERTY)!.get;
    expect(installGpcProperty(f.realm)).toBe('present');
    expect(Object.getOwnPropertyDescriptor(f.proto, GPC_PROPERTY)!.get).toBe(first);
  });
});

describe('coexistence with the environment sensor of observation (DET-025)', () => {
  function counters(runtime: SensorRuntime): string[] {
    return runtime.snapshot().counters.map((c) => c.techniqueId + ' ' + String(c.operationCode ?? '-') + ' ' + String(c.count)).sort();
  }

  for (const order of ['environment-first', 'gpc-first'] as const) {
    it(order + ': the family never hooks globalPrivacyControl; reading it records nothing', () => {
      const fake = makeEnv();
      const runtime = new SensorRuntime(fake.env);
      runtime.start();
      deliver(fake, bridgeHello(runtime));
      const f = makeRealm();
      let sensor: ReturnType<typeof installEnvironmentSensor>;
      if (order === 'environment-first') {
        sensor = installEnvironmentSensor(runtime, f.realm, FAMILY_CONFIG);
        expect(installGpcProperty(f.realm)).toBe('defined');
      } else {
        expect(installGpcProperty(f.realm)).toBe('defined');
        sensor = installEnvironmentSensor(runtime, f.realm, FAMILY_CONFIG);
      }
      const labels = sensor.results.map((r) => r.label);
      expect(labels).not.toContain(GPC_PROPERTY);
      expect(sensor.skipped.some((s) => s.includes(GPC_PROPERTY))).toBe(false);
      expect(sensor.off.some((s) => s.includes(GPC_PROPERTY))).toBe(false);
      expect(Object.getOwnPropertyDescriptor(f.proto, GPC_PROPERTY)!.get!.name).toBe('detectExpertGpcGetter');
      const before = counters(runtime);
      for (let i = 0; i < 25; i++) expect(f.navigator[GPC_PROPERTY]).toBe(true);
      expect(counters(runtime)).toEqual(before);
      // The hooked members still work and count (the shim did not disturb them).
      expect(f.navigator['userAgent']).toBe('CANARY-UA');
      expect(counters(runtime).some((c) => c.startsWith('DET-025'))).toBe(true);
    });
  }
});
