import { describe, expect, it } from 'vitest';
import { API_OPERATION_DEFINITIONS } from '@detect-expert/contracts';
import { installWebNNSensor } from '../src/webnn';
import { SensorRuntime } from '../src/runtime';
import { makeEnv } from './helpers';

function setup() {
  const runtime = new SensorRuntime(makeEnv().env);
  const calls: Array<{ receiver: unknown; args: unknown[] }> = [];
  let reads = 0;
  const opaque = new Proxy({}, { get() { reads++; throw new Error('unexpected property read'); },
    ownKeys() { reads++; throw new Error('unexpected enumeration'); }, getOwnPropertyDescriptor() { reads++; throw new Error('unexpected descriptor read'); } });
  const promise = Promise.resolve(undefined);
  Object.defineProperty(promise, 'then', { get() { reads++; throw new Error('unexpected Promise read'); } });
  class ML { createContext(...args: unknown[]) { calls.push({ receiver: this, args }); return promise; } }
  class MLContext { opSupportLimits() { calls.push({ receiver: this, args: [] }); return opaque; } }
  const ml = new ML();
  class Navigator { get ml() { calls.push({ receiver: this, args: [] }); return ml; } }
  return { runtime, realm: { Navigator, ML, MLContext }, calls, opaque, promise, reads: () => reads };
}

describe('DET-070 passive WebNN observation', () => {
  it('installs without invoking ML or reading options and preserves exact receiver, arguments and Promise', () => {
    const state = setup();
    expect(installWebNNSensor(state.runtime, state.realm).results).toHaveLength(3);
    expect(state.calls).toEqual([]);
    const navigator = new state.realm.Navigator();
    const ml = navigator.ml;
    expect(Reflect.apply(ml.createContext, state.opaque, [state.opaque, state.opaque]) === state.promise).toBe(true);
    expect(state.calls).toHaveLength(2);
    expect(state.calls[1]!.receiver === state.opaque).toBe(true);
    expect(state.calls[1]!.args.every(value => value === state.opaque)).toBe(true);
    expect(state.reads()).toBe(0);
    expect(state.runtime.snapshot().counters).toEqual([
      expect.objectContaining({ techniqueId: 'DET-070', apiOperation: 'Navigator.ml', phase: 'returned-sync', count: 1, signalCodes: ['api-use'] }),
      expect.objectContaining({ techniqueId: 'DET-070', apiOperation: 'ML.createContext', phase: 'settlement-unobserved', count: 1, signalCodes: ['api-use'] }),
    ]);
    state.runtime.stop('local');
  });

  it('does not inspect the capability matrix or infer hardware from a returned object', () => {
    const state = setup(); installWebNNSensor(state.runtime, state.realm);
    expect(new state.realm.MLContext().opSupportLimits() === state.opaque).toBe(true);
    expect(state.reads()).toBe(0);
    expect(state.runtime.apiResults.snapshot().rows).toEqual([{ operation: 'MLContext.opSupportLimits', techniqueId: 'DET-070',
      phase: 'returned-sync', value: { kind: 'unobserved', reason: 'object' } }]);
    expect(state.runtime.snapshot().counters[0]).toMatchObject({ techniqueId: 'DET-070', signalCodes: ['api-use'] });
    state.runtime.stop('local');
  });

  it('does not fabricate absent APIs or invoke constructor accessors', () => {
    const state = setup();
    const realm = Object.defineProperty({}, 'ML', { get() { throw new Error('ML global read'); } });
    expect(installWebNNSensor(state.runtime, realm).results).toEqual([]);
    expect(state.runtime.snapshot().counters).toEqual([]);
    state.runtime.stop('local');
  });

  it('preserves graph constructor newTarget, argument identity and subclassing without reading model input', () => {
    const state = setup();
    const targets: unknown[] = [];
    class MLGraphBuilder {
      constructor(context: unknown) { targets.push(new.target); state.calls.push({ receiver: this, args: [context] }); }
      input(...args: unknown[]) { state.calls.push({ receiver: this, args }); return state.opaque; }
      constant(...args: unknown[]) { state.calls.push({ receiver: this, args }); return state.opaque; }
      add(...args: unknown[]) { state.calls.push({ receiver: this, args }); return state.opaque; }
      build(...args: unknown[]) { state.calls.push({ receiver: this, args }); return state.promise; }
    }
    const realm = { ...state.realm, MLGraphBuilder };
    installWebNNSensor(state.runtime, realm);
    class Derived extends realm.MLGraphBuilder {}
    const builder = new Derived(state.opaque);
    expect(targets).toEqual([Derived]); expect(builder).toBeInstanceOf(MLGraphBuilder);
    expect(builder.input(state.opaque, state.opaque) === state.opaque).toBe(true);
    expect(builder.constant(state.opaque, state.opaque) === state.opaque).toBe(true);
    expect(builder.add(state.opaque, state.opaque) === state.opaque).toBe(true);
    expect(builder.build(state.opaque) === state.promise).toBe(true);
    expect(state.calls).toHaveLength(5); expect(state.reads()).toBe(0);
    expect(state.runtime.snapshot().counters.every(counter => counter.techniqueId === 'DET-070')).toBe(true);
    expect(state.runtime.snapshot().counters.find(counter => counter.apiOperation === 'MLGraphBuilder.build')?.phase).toBe('settlement-unobserved');
    state.runtime.stop('local'); expect(realm.MLGraphBuilder).toBe(MLGraphBuilder);
  });

  it('covers every fixed method/getter and preserves opaque thrown errors without inspecting tensor shapes or data', () => {
    for (const [operation, , mechanism, kind] of API_OPERATION_DEFINITIONS) {
      if (mechanism !== 'webnn' || kind === 'construct') continue;
      const state = setup();
      const [owner, member] = operation.split('.') as [string, string];
      let calls = 0;
      function Interface() {}
      const original = function () { calls++; throw state.opaque; };
      Object.defineProperty(Interface.prototype, member, kind === 'get' ? { configurable: true, get: original } : { configurable: true, writable: true, value: original });
      installWebNNSensor(state.runtime, { [owner]: Interface });
      let thrown: unknown;
      try {
        const field = Object.getOwnPropertyDescriptor(Interface.prototype, member)!;
        Reflect.apply(kind === 'get' ? field.get! : field.value as Function, state.opaque, kind === 'get' ? [] : [state.opaque]);
      } catch (error) { thrown = error; }
      expect(thrown === state.opaque, operation).toBe(true);
      expect(calls).toBe(1); expect(state.reads()).toBe(0);
      expect(state.runtime.snapshot().counters).toEqual([expect.objectContaining({ apiOperation: operation, phase: 'threw-sync', signalCodes: ['api-use'] })]);
      state.runtime.stop('local');
    }
  });

  it('retains supported scalar tensor metadata but never model shape or tensor contents', () => {
    const state = setup();
    class MLTensor {
      get dataType() { return 'float32'; }
      get shape() { return state.opaque; }
      get readable() { return true; }
      get writable() { return false; }
    }
    const realm = { ...state.realm, MLTensor };
    installWebNNSensor(state.runtime, realm);
    const tensor = new MLTensor();
    expect(tensor.dataType).toBe('float32'); expect(tensor.shape === state.opaque).toBe(true);
    expect(tensor.readable).toBe(true); expect(tensor.writable).toBe(false); expect(state.reads()).toBe(0);
    expect(state.runtime.apiResults.snapshot().rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: 'MLTensor.dataType', value: { kind: 'string', value: 'float32' } }),
      expect.objectContaining({ operation: 'MLTensor.shape', value: { kind: 'unobserved', reason: 'sensitive' } }),
    ]));
    state.runtime.stop('local');
  });

  it('reinjection, pause/resume and ownership-aware cleanup preserve the original call path', () => {
    const state = setup();
    const original = state.realm.MLContext.prototype.opSupportLimits;
    installWebNNSensor(state.runtime, state.realm); installWebNNSensor(state.runtime, state.realm);
    const context = new state.realm.MLContext();
    context.opSupportLimits(); state.runtime.pause(); context.opSupportLimits();
    expect(state.runtime.snapshot().counters[0]?.count).toBe(1);
    expect(state.runtime.apiResults.snapshot().rows).toEqual([]);
    state.runtime.resume(); context.opSupportLimits();
    expect(state.runtime.snapshot().counters[0]?.count).toBe(2);
    const replacement = () => state.promise;
    state.realm.ML.prototype.createContext = replacement;
    state.runtime.stop('revoked');
    expect(state.realm.MLContext.prototype.opSupportLimits).toBe(original);
    expect(state.realm.ML.prototype.createContext).toBe(replacement);
    expect(state.calls).toHaveLength(3);
  });

  it('frozen surfaces and observer failures cannot replace native outcomes', () => {
    const state = setup();
    Object.defineProperty(state.realm.MLContext.prototype, 'opSupportLimits', { configurable: false });
    installWebNNSensor(state.runtime, state.realm);
    state.runtime.recordOperation = () => { throw new Error('observer failed'); };
    expect(new state.realm.ML().createContext(state.opaque) === state.promise).toBe(true);
    expect(state.calls).toHaveLength(1); expect(state.reads()).toBe(0);
    expect(state.runtime.hooks.observerErrors).toBe(1);
    expect(state.runtime.snapshot().flags).toContain('descriptor-nonconfigurable');
    state.runtime.stop('local');
  });

  it('bounds repeated observations without building or executing a model itself', () => {
    const state = setup();
    let nativeCalls = 0;
    class MLContext { dispatch() { nativeCalls++; } }
    installWebNNSensor(state.runtime, { MLContext });
    const context = new MLContext();
    for (let index = 0; index < 100000; index++) context.dispatch();
    expect(nativeCalls).toBe(100000);
    expect(state.runtime.snapshot().counters).toHaveLength(1);
    expect(state.runtime.snapshot().counters[0]).toMatchObject({ apiOperation: 'MLContext.dispatch', count: 100000, phase: 'returned-sync' });
    expect(state.runtime.apiResults.snapshot().rows).toHaveLength(1);
    state.runtime.stop('local');
  });
});