import { describe, expect, it } from 'vitest';
import { BUDGETS, MAX_COUNT } from '@detect-expert/contracts';
import { SensorRuntime, wrapMethod, SIGNAL_BIT } from '../src/index';
import { bridgeHello, deliver, makeEnv } from './helpers';

describe('F045/F046/F049/F131: isolated collection and emission paths', () => {
  it.each([['timer', false], ['pagehide', false], ['timer', true], ['pagehide', true]] as const)('ignores poisoned collections during %s emission (non-progressing: %s)', (trigger, nonProgressing) => {
    const fake = makeEnv();
    let timer: (() => void) | undefined;
    let hide: ((event: unknown) => void) | undefined;
    const add = fake.env.addEventListener;
    fake.env.addEventListener = (type, listener) => {
      if (type === 'pagehide') hide = listener;
      add(type, listener);
    };
    fake.env.setTimeout = (fn) => { timer = fn; return 1; };
    fake.env.clearTimeout = () => undefined;
    fake.env.postMessage = (message) => { fake.posted[fake.posted.length] = message; };
    const runtime = new SensorRuntime(fake.env);
    runtime.start();
    deliver(fake, bridgeHello(runtime));
    const target = { m: () => 42 };
    const hook = wrapMethod(target, 'm', () => runtime.record(1, 1, SIGNAL_BIT['readback-after-text'] | SIGNAL_BIT['api-use']), { context: runtime.hooks });
    runtime.attach([hook]);
    const iteratorProto: object = Object.getPrototypeOf([][Symbol.iterator]());
    const patches: Array<[object, PropertyKey]> = [
      [Array.prototype, 'push'], [Array.prototype, 'splice'], [Array.prototype, 'sort'], [Array.prototype, 'includes'],
      [Array.prototype, Symbol.iterator], [Array, Symbol.species], [iteratorProto, 'next'],
      [Set.prototype, 'add'], [Set.prototype, 'has'], [Set.prototype, Symbol.iterator], [Map.prototype, 'size'],
    ];
    const descriptors = patches.map(([target, key]) => Object.getOwnPropertyDescriptor(target, key)!);
    const define = Object.defineProperty;
    let calls = 0;
    let result: unknown;
    let escaped: unknown;
    try {
      for (let i = 0; i < patches.length; i++) {
        const object = patches[i]![0];
        const key = patches[i]![1];
        const trap = () => { calls++; if (nonProgressing) return []; throw new Error('page builtin trap'); };
        define(object, key, key === 'size' || key === Symbol.species ? { get: trap, configurable: true } : { value: trap, configurable: true, writable: true });
      }
      result = target.m();
      runtime.addFlag('late-start');
      if (trigger === 'timer') timer!();
      else hide!({});
    } catch (error) { escaped = error; }
    finally {
      for (let i = 0; i < patches.length; i++) define(patches[i]![0], patches[i]![1], descriptors[i]!);
    }
    expect(escaped).toBeUndefined();
    expect(calls).toBe(0);
    expect(result).toBe(42);
    expect(runtime.snapshot().observerErrors).toBe(0);
    expect(fake.batches()[0]!.observations[0]).toMatchObject({ count: 1, signalCodes: ['api-use', 'readback-after-text'] });
    expect(fake.statuses().at(-1)!.coverageFlags).toEqual(['late-start']);
  });

  it('F045: failed insertion does not strand an entry and error-only status is coalesced', () => {
    const fake = makeEnv();
    const runtime = new SensorRuntime(fake.env);
    runtime.start();
    deliver(fake, bridgeHello(runtime));
    const internal = runtime as unknown as { dirty: unknown[] };
    internal.dirty = new Proxy([], { defineProperty() { throw new Error('injected insertion failure'); } });
    const target = { m: () => 7 };
    runtime.attach([wrapMethod(target, 'm', () => runtime.record(1, 1, 1), { context: runtime.hooks })]);
    for (let i = 0; i < 50; i++) expect(target.m()).toBe(7);
    expect(fake.pendingTimers()).toBe(1);
    internal.dirty = [];
    fake.advance(BUDGETS.flushMinMs);
    expect(fake.batches()).toEqual([]);
    expect(fake.statuses().at(-1)).toMatchObject({ state: 'degraded', coverageFlags: ['hook-failed'] });
    target.m();
    fake.advance(BUDGETS.flushMinMs);
    expect(fake.batches()[0]!.observations[0]!.count).toBe(51);
  });

  it('F049: failed emission preserves totals, reports degradation and does not retry indefinitely', () => {
    const fake = makeEnv();
    const runtime = new SensorRuntime(fake.env);
    runtime.start();
    deliver(fake, bridgeHello(runtime));
    const post = fake.env.postMessage;
    fake.env.postMessage = (message) => {
      if ((message as { type: string }).type === 'sensor-batch') throw new Error('injected post failure');
      post(message);
    };
    runtime.hooks.observerErrors = MAX_COUNT;
    runtime.record(1, 1, 1);
    expect(() => fake.advance(BUDGETS.flushMinMs)).not.toThrow();
    expect(() => fake.dispatch('pagehide', {})).not.toThrow();
    expect(runtime.snapshot().observerErrors).toBe(MAX_COUNT);
    expect(fake.pendingTimers()).toBe(0);
    expect(fake.statuses().at(-1)).toMatchObject({ state: 'degraded', coverageFlags: ['hook-failed'] });
    fake.env.postMessage = post;
    runtime.record(1, 1, 1);
    fake.advance(BUDGETS.flushMinMs);
    expect(fake.batches()[0]!.observations[0]!.count).toBe(2);
  });

  it('F132: an unfolderable drop after the table drains schedules status without another observation', () => {
    const fake = makeEnv();
    const runtime = new SensorRuntime(fake.env);
    runtime.start();
    deliver(fake, bridgeHello(runtime));
    for (let i = 0; i < 128; i++) runtime.record(i % 68, Math.floor(i / 68), 1);
    fake.advance(BUDGETS.flushMinMs);
    const batches = fake.batches().length;
    runtime.record(0, 2, 1);
    expect(fake.pendingTimers()).toBe(1);
    fake.advance(BUDGETS.flushMinMs);
    expect(fake.batches()).toHaveLength(batches);
    expect(fake.statuses().at(-1)).toMatchObject({ droppedSinceLast: 1, coverageFlags: ['budget-exceeded'] });
  });

  it('F049: persistent timer failure reports once and does not turn every record into a status post', () => {
    const fake = makeEnv();
    const runtime = new SensorRuntime(fake.env);
    runtime.start();
    deliver(fake, bridgeHello(runtime));
    let attempts = 0;
    fake.env.setTimeout = () => { attempts++; throw new Error('timer unavailable'); };
    for (let i = 0; i < 1000; i++) runtime.record(1, 1, 1);
    expect(attempts).toBe(1);
    expect(fake.statuses()).toHaveLength(1);
    expect(fake.statuses()[0]).toMatchObject({ state: 'degraded', coverageFlags: ['hook-failed'] });
    fake.dispatch('pagehide', {});
    expect(fake.batches()[0]!.observations[0]!.count).toBe(1000);
  });

  it('F046: inherited numeric setters never receive private queue entries', () => {
    const fake = makeEnv();
    fake.env.setTimeout = () => 1;
    fake.env.clearTimeout = () => undefined;
    const runtime = new SensorRuntime(fake.env);
    runtime.start();
    deliver(fake, bridgeHello(runtime));
    let calls = 0;
    const prior = Object.getOwnPropertyDescriptor(Array.prototype, '0');
    let escaped: unknown;
    try {
      Object.defineProperty(Array.prototype, '0', { configurable: true, set() { calls++; throw new Error('numeric setter'); } });
      runtime.record(1, 1, 1);
      runtime.flush();
    } catch (error) { escaped = error; }
    finally {
      Reflect.deleteProperty(Array.prototype, '0');
      if (prior !== undefined) Object.defineProperty(Array.prototype, '0', prior);
    }
    expect(escaped).toBeUndefined();
    expect(calls).toBe(0);
    expect(fake.batches()[0]!.observations[0]!.count).toBe(1);
  });

  it('F049/F132: failed status posting retains dropped totals until a successful lifecycle flush', () => {
    const fake = makeEnv();
    const runtime = new SensorRuntime(fake.env);
    runtime.start();
    deliver(fake, bridgeHello(runtime));
    for (let i = 0; i < 128; i++) runtime.record(i % 68, Math.floor(i / 68), 1);
    fake.advance(BUDGETS.flushMinMs);
    const post = fake.env.postMessage;
    fake.env.postMessage = () => { throw new Error('status unavailable'); };
    runtime.record(0, 2, 1);
    fake.advance(BUDGETS.flushMinMs);
    expect(runtime.snapshot().dropped).toBe(1);
    fake.env.postMessage = post;
    fake.dispatch('pagehide', {});
    expect(fake.statuses().at(-1)).toMatchObject({ droppedSinceLast: 1, coverageFlags: ['budget-exceeded'] });
    expect(runtime.snapshot().dropped).toBe(0);
  });
});
