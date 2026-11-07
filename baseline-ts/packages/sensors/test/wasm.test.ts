import { describe, expect, it } from 'vitest';
import { installWebAssemblySensor } from '../src/wasm';
import { SensorRuntime } from '../src/runtime';
import { makeEnv } from './helpers';

const EMPTY = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const IMPORT_START = new Uint8Array([0,97,115,109,1,0,0,0,1,4,1,96,0,0,2,13,1,3,101,110,118,5,115,116,97,114,116,0,0,8,1,0]);
function fakeSetup() {
  const runtime = new SensorRuntime(makeEnv().env);
  const calls: Array<{ name: string; receiver: unknown; args: unknown[] }> = [];
  const failure = new Proxy({}, { get() { throw new Error('error inspected'); } });
  let thenReads = 0;
  const promise = Promise.resolve(undefined);
  Object.defineProperty(promise, 'then', { get() { thenReads++; throw new Error('then inspected'); } });
  const invoke = (name: string, receiver: unknown, args: unknown[]) => { calls.push({ name, receiver, args }); if (args[0] === failure) throw failure; };
  class Module {
    constructor(...args: unknown[]) { invoke('Module', this, args); }
    static exports() { return 'CANARY_EXPORT'; }
  }
  class Instance { constructor(...args: unknown[]) { invoke('Instance', this, args); } }
  const wasm = {
    compile(...args: unknown[]) { invoke('compile', this, args); return promise; },
    instantiate(...args: unknown[]) { invoke('instantiate', this, args); return promise; },
    compileStreaming(...args: unknown[]) { invoke('compileStreaming', this, args); return promise; },
    instantiateStreaming(...args: unknown[]) { invoke('instantiateStreaming', this, args); return promise; },
    validate(...args: unknown[]) { invoke('validate', this, args); return false; }, Module, Instance,
  };
  return { runtime, wasm, realm: { WebAssembly: wasm }, calls, failure, promise, thenReads: () => thenReads };
}
function nativeSetup() {
  const wasm = Object.defineProperties({}, Object.getOwnPropertyDescriptors(WebAssembly)) as typeof WebAssembly;
  const runtime = new SensorRuntime(makeEnv().env);
  return { wasm, realm: { WebAssembly: wasm }, runtime };
}

describe('DET-065 passive JS WebAssembly observation', () => {
  it('installation calls no API and adds exactly seven bounded hooks without observing data', () => {
    const s = fakeSetup();
    expect(installWebAssemblySensor(s.runtime, s.realm).results).toHaveLength(7);
    expect(s.calls).toEqual([]); expect(s.thenReads()).toBe(0);
    expect(s.runtime.snapshot().counters).toEqual([]);
    s.runtime.stop('local');
  });

  it.each(['compile', 'instantiate', 'compileStreaming', 'instantiateStreaming'] as const)('%s preserves original receiver/argument identities and Promise identity without then handlers', name => {
    const s = fakeSetup(); installWebAssemblySensor(s.runtime, s.realm);
    const input = new Proxy({}, { get() { throw new Error('input inspected'); }, ownKeys() { throw new Error('input enumerated'); } });
    const receiver = new Proxy({}, { get() { throw new Error('receiver inspected'); } });
    expect(Reflect.apply(s.wasm[name], receiver, [input, input, input, input])).toBe(s.promise);
    expect(s.calls).toHaveLength(1); expect(s.calls[0]!.receiver === receiver).toBe(true);
    expect(s.calls[0]!.args.length).toBe(4); expect(s.calls[0]!.args.every(arg => arg === input)).toBe(true);
    expect(s.thenReads()).toBe(0);
    expect(s.runtime.snapshot().counters).toEqual([expect.objectContaining({ techniqueId: 'DET-065', phase: 'settlement-unobserved', count: 1, signalCodes: ['api-use'] })]);
    s.runtime.stop('local');
  });

  it('false validate results stay false and thrown exceptions preserve identity without error introspection', () => {
    const s = fakeSetup(); installWebAssemblySensor(s.runtime, s.realm);
    expect(s.wasm.validate('CANARY_BYTES')).toBe(false);
    for (const name of ['validate', 'compile', 'instantiate', 'compileStreaming', 'instantiateStreaming'] as const) {
      let caught: unknown; try { s.wasm[name](s.failure); } catch (error) { caught = error; }
      expect(caught === s.failure).toBe(true);
    }
    expect(s.calls).toHaveLength(6);
    expect(s.runtime.snapshot().counters).toEqual(expect.arrayContaining([
      expect.objectContaining({ apiOperation: 'WebAssembly.validate', phase: 'returned-sync', count: 1, signalCodes: ['api-use'] }),
      ...['validate', 'compile', 'instantiate', 'compileStreaming', 'instantiateStreaming'].map(name =>
        expect.objectContaining({ apiOperation: 'WebAssembly.' + name, phase: 'threw-sync', count: 1, signalCodes: ['api-use'] })),
    ]));
    expect(JSON.stringify(s.runtime.snapshot())).not.toContain('CANARY'); s.runtime.stop('local');
  });

  it('native validate distinguishes normal false from native synchronous error only by phase', () => {
    const s = nativeSetup(); installWebAssemblySensor(s.runtime, s.realm);
    expect(s.wasm.validate(EMPTY)).toBe(true);
    expect(s.wasm.validate(new Uint8Array([1, 2, 3]))).toBe(false);
    expect(() => s.wasm.validate(null as unknown as BufferSource)).toThrow(TypeError);
    expect(s.runtime.snapshot().counters).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'returned-sync', count: 2, signalCodes: ['api-use'] }),
      expect.objectContaining({ phase: 'threw-sync', count: 1, signalCodes: ['api-use'] }),
    ])); s.runtime.stop('local');
  });

  it('native byte and Module overloads compile and instantiate unchanged, without deriving success from a returned Promise', async () => {
    const s = nativeSetup(); installWebAssemblySensor(s.runtime, s.realm);
    const compiled = await s.wasm.compile(EMPTY);
    const instantiated = await s.wasm.instantiate(EMPTY);
    const instance = await s.wasm.instantiate(compiled);
    expect(compiled).toBeInstanceOf(WebAssembly.Module);
    expect(instantiated.module).toBeInstanceOf(WebAssembly.Module);
    expect(instantiated.instance).toBeInstanceOf(WebAssembly.Instance);
    expect(instance).toBeInstanceOf(WebAssembly.Instance);
    expect(s.runtime.snapshot().counters).toEqual([
      expect.objectContaining({ apiOperation: 'WebAssembly.compile', phase: 'settlement-unobserved', count: 1, signalCodes: ['api-use'] }),
      expect.objectContaining({ apiOperation: 'WebAssembly.instantiate', phase: 'settlement-unobserved', count: 2, signalCodes: ['api-use'] }),
    ]);
    s.runtime.stop('local');
  });

  it('native streaming APIs retain response consumption and failure behavior', async () => {
    const s = nativeSetup(); installWebAssemblySensor(s.runtime, s.realm);
    const response = () => new Response(EMPTY, { headers: { 'Content-Type': 'application/wasm' } });
    const one = response(), two = response();
    expect(await s.wasm.compileStreaming(one)).toBeInstanceOf(WebAssembly.Module);
    expect((await s.wasm.instantiateStreaming(Promise.resolve(two))).instance).toBeInstanceOf(WebAssembly.Instance);
    await expect(s.wasm.compileStreaming(new Response(EMPTY))).rejects.toBeInstanceOf(TypeError);
    expect(one.bodyUsed).toBe(true); expect(two.bodyUsed).toBe(true);
    expect(s.runtime.snapshot().counters).toEqual([
      expect.objectContaining({ apiOperation: 'WebAssembly.compileStreaming', phase: 'settlement-unobserved', count: 2 }),
      expect.objectContaining({ apiOperation: 'WebAssembly.instantiateStreaming', phase: 'settlement-unobserved', count: 1 }),
    ]);
    s.runtime.stop('local');
  });

  it.each(['Module', 'Instance', 'Memory'] as const)('%s native constructors preserve statics, prototype, subclass and plain-call behavior', name => {
    const s = nativeSetup(); const Native = s.wasm[name];
    const input = name === 'Module' ? EMPTY : name === 'Memory' ? { initial: 1, maximum: 2 } : new WebAssembly.Module(EMPTY);
    installWebAssemblySensor(s.runtime, s.realm);
    const Wrapped = s.wasm[name];
    const instance = Reflect.construct(Wrapped, [input]);
    expect(instance).toBeInstanceOf(Native); expect(instance).toBeInstanceOf(Wrapped);
    expect(Object.getPrototypeOf(instance)).toBe(Native.prototype);
    expect(instance.constructor).toBe(Native); // Existing documented F051 identity difference.
    expect(Wrapped.prototype).toBe(Native.prototype); expect(Wrapped.name).toBe(Native.name); expect(Wrapped.length).toBe(Native.length);
    expect(() => Reflect.apply(Wrapped, undefined, [input])).toThrow(TypeError);
    class Derived extends (Wrapped as new (...args: unknown[]) => object) {}
    const derived = new Derived(input); expect(derived).toBeInstanceOf(Derived); expect(derived).toBeInstanceOf(Native);
    if (name === 'Module') {
      expect(s.wasm.Module.exports).toBe(WebAssembly.Module.exports);
      expect(s.wasm.Module.imports).toBe(WebAssembly.Module.imports);
      expect(s.wasm.Module.customSections).toBe(WebAssembly.Module.customSections);
      expect(s.wasm.Module.exports(instance)).toEqual([]);
    }
    expect(s.runtime.snapshot().counters).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'returned-sync', count: 2 }), expect.objectContaining({ phase: 'threw-sync', count: 1 }),
    ])); s.runtime.stop('local'); expect(s.wasm[name]).toBe(Native);
  });

  it.each(['Module', 'Instance', 'Memory'] as const)('%s does not add a hostile newTarget.prototype read', name => {
    const s = nativeSetup(); const Native = s.wasm[name];
    const input = name === 'Module' ? EMPTY : name === 'Memory' ? { initial: 1, maximum: 2 } : new WebAssembly.Module(EMPTY);
    const check = (Constructor: Function) => {
      let reads = 0; const prototype = Object.create(Native.prototype);
      const target = new Proxy(function () {}, { get(object, key, receiver) {
        if (key === 'prototype') { reads++; if (reads > 1) throw new Error('extra prototype access'); return prototype; }
        return Reflect.get(object, key, receiver);
      } });
      const result = Reflect.construct(Constructor, [input], target);
      return { reads, samePrototype: Object.getPrototypeOf(result) === prototype };
    };
    const before = check(Native); installWebAssemblySensor(s.runtime, s.realm);
    expect(check(s.wasm[name])).toEqual(before); expect(before).toEqual({ reads: 1, samePrototype: true });
    s.runtime.stop('local');
  });

  it('native import/start callbacks are invoked only by original instantiation and import exceptions retain identity', () => {
    const s = nativeSetup(), module = new WebAssembly.Module(IMPORT_START); installWebAssemblySensor(s.runtime, s.realm);
    let envReads = 0, functionReads = 0, startCalls = 0;
    const imports = { get env() { envReads++; return { get start() { functionReads++; return () => { startCalls++; }; } }; } };
    expect(new s.wasm.Instance(module, imports)).toBeInstanceOf(WebAssembly.Instance);
    expect({ envReads, functionReads, startCalls }).toEqual({ envReads: 1, functionReads: 1, startCalls: 1 });
    const failure = new Error('CANARY_IMPORT_ERROR'); let reads = 0, caught: unknown;
    try { new s.wasm.Instance(module, { get env(): never { reads++; throw failure; } }); } catch (error) { caught = error; }
    expect(caught).toBe(failure); expect(reads).toBe(1);
    expect(JSON.stringify(s.runtime.snapshot())).not.toContain('CANARY'); s.runtime.stop('local');
  });

  it('native Memory preserves descriptor coercion, grow and buffer semantics without reporting shared flag or sizes', () => {
    const state = nativeSetup(); installWebAssemblySensor(state.runtime, state.realm);
    let initialReads = 0, maximumReads = 0, sharedReads = 0, growCoercions = 0;
    const memory = new state.wasm.Memory({ get initial() { initialReads++; return 1; },
      get maximum() { maximumReads++; return 2; }, get shared() { sharedReads++; return true; } });
    expect({ initialReads, maximumReads, sharedReads }).toEqual({ initialReads: 1, maximumReads: 1, sharedReads: 1 });
    const buffer = memory.buffer;
    expect(buffer).toBeInstanceOf(SharedArrayBuffer);
    expect(memory.grow({ valueOf() { growCoercions++; return 1; } } as unknown as number)).toBe(1);
    expect(growCoercions).toBe(1);
    expect(memory.buffer.byteLength).toBe(131072);
    expect(state.runtime.snapshot().counters).toEqual(expect.arrayContaining([
      expect.objectContaining({ apiOperation: 'WebAssembly.Memory', count: 1 }),
      expect.objectContaining({ apiOperation: 'WebAssembly.Memory.grow', count: 1 }),
      expect.objectContaining({ apiOperation: 'WebAssembly.Memory.buffer', count: 2 }),
    ]));
    expect(JSON.stringify(state.runtime.snapshot())).not.toMatch(/131072|65536|"shared"|"initial"|"maximum"/);
    state.runtime.stop('local');
  });

  it('absent namespace/optional streaming APIs remain absent and namespace accessors are not invoked', () => {
    const runtime = new SensorRuntime(makeEnv().env);
    expect(installWebAssemblySensor(runtime, {}).skipped).toEqual(['WebAssembly']);
    const realm = Object.defineProperty({}, 'WebAssembly', { get() { throw new Error('namespace getter'); } });
    expect(installWebAssemblySensor(runtime, realm).skipped).toEqual(['WebAssembly']);
    const namespace = { validate() { return false; } };
    expect(installWebAssemblySensor(runtime, { WebAssembly: namespace }).skipped).toContain('WebAssembly.compileStreaming');
    expect(Object.hasOwn(namespace, 'compileStreaming')).toBe(false); runtime.stop('local');
  });

  it('frozen methods and hostile descriptors cannot orphan earlier hooks; later surfaces remain observed', () => {
    const s = fakeSetup(); const original = s.wasm.compile;
    Object.defineProperty(s.wasm, 'instantiate', { configurable: false });
    const namespace = new Proxy(s.wasm, { getOwnPropertyDescriptor(target, key) {
      if (key === 'compileStreaming') throw new Error('descriptor inaccessible');
      return Reflect.getOwnPropertyDescriptor(target, key);
    } });
    installWebAssemblySensor(s.runtime, { WebAssembly: namespace });
    s.wasm.compile(); s.wasm.validate();
    expect(s.runtime.snapshot().flags).toEqual(expect.arrayContaining(['hook-failed', 'descriptor-nonconfigurable']));
    expect(s.runtime.snapshot().counters.reduce((sum, counter) => sum + counter.count, 0)).toBe(2);
    s.runtime.stop('local'); expect(s.wasm.compile).toBe(original);
  });

  it('reinjection, pause, resume and ownership cleanup never duplicate original calls or overwrite a later page replacement', () => {
    const s = fakeSetup(); const original = s.wasm.compile;
    installWebAssemblySensor(s.runtime, s.realm); installWebAssemblySensor(s.runtime, s.realm);
    s.wasm.compile(); expect(s.runtime.snapshot().counters[0]?.count).toBe(1);
    s.runtime.pause(); s.wasm.compile(); expect(s.runtime.snapshot().counters[0]?.count).toBe(1);
    s.runtime.resume(); s.wasm.compile(); expect(s.runtime.snapshot().counters[0]?.count).toBe(2);
    const foreign = () => s.promise; s.wasm.instantiate = foreign;
    s.runtime.stop('revoked'); expect(s.wasm.compile).toBe(original); expect(s.wasm.instantiate).toBe(foreign);
    expect(installWebAssemblySensor(s.runtime, s.realm).results).toEqual([]);
    expect(s.calls).toHaveLength(3);
  });

  it('observer failures do not change returned Promise, constructor instance or original exception', () => {
    const s = fakeSetup(); installWebAssemblySensor(s.runtime, s.realm);
    s.runtime.record = () => { throw new Error('observer failed'); };
    expect(s.wasm.compile()).toBe(s.promise); expect(new s.wasm.Module()).toBeInstanceOf(s.wasm.Module);
    let caught: unknown; try { new s.wasm.Instance(s.failure); } catch (error) { caught = error; }
    expect(caught === s.failure).toBe(true); expect(s.calls).toHaveLength(3); expect(s.runtime.hooks.observerErrors).toBe(3);
    s.runtime.stop('local');
  });
});
