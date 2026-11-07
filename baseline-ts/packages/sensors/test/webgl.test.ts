// DET-011/012/013 / ADR-006: differential API semantics, hostile data, bounded factual observations.
import { describe, expect, it, vi } from 'vitest';
import { API_OPERATION_DEFINITIONS } from '@detect-expert/contracts';
import { SensorRuntime } from '../src/runtime';
import { installGraphicsSensor } from '../src/webgl';
import { bridgeHello, deliver, makeEnv } from './helpers';

const QUERY_METHODS = ['getParameter', 'getExtension', 'getSupportedExtensions', 'getShaderPrecisionFormat'] as const;
const METHODS = [...QUERY_METHODS, 'readPixels'] as const;
const CANARY = 'GRAPHICS-PRIVATE-9f38a7';

function setup() {
  const env = makeEnv();
  const runtime = new SensorRuntime(env.env);
  runtime.start();
  deliver(env, bridgeHello(runtime));
  const calls: { method: string; receiver: unknown; args: unknown[] }[] = [];
  let result: unknown = undefined;
  let failure: unknown;
  let throws = false;
  const record = (method: string, receiver: unknown, args: unknown[]): unknown => {
    calls.push({ method, receiver, args });
    if (throws) throw failure;
    return result;
  };
  function glClass() {
    return class {
      getParameter(...args: unknown[]): unknown { return record('getParameter', this, args); }
      getExtension(...args: unknown[]): unknown { return record('getExtension', this, args); }
      getSupportedExtensions(...args: unknown[]): unknown { return record('getSupportedExtensions', this, args); }
      getShaderPrecisionFormat(...args: unknown[]): unknown { return record('getShaderPrecisionFormat', this, args); }
      readPixels(...args: unknown[]): unknown { return record('readPixels', this, args); }
      clear(...args: unknown[]): unknown { return record('clear', this, args); }
    };
  }
  const GL1 = glClass();
  const GL2 = glClass();
  class GPU {
    requestAdapter(...args: unknown[]): unknown { return record('requestAdapter', this, args); }
  }
  class GPUAdapter {
    get info(): unknown { return record('info', this, []); }
    get features(): unknown { return record('features', this, []); }
    get limits(): unknown { return record('limits', this, []); }
  }
  class GPUDevice {
    get adapterInfo(): unknown { return record('adapterInfo', this, []); }
    get features(): unknown { return record('features', this, []); }
    get limits(): unknown { return record('limits', this, []); }
  }
  const realm = { WebGLRenderingContext: GL1, WebGL2RenderingContext: GL2, GPU, GPUAdapter, GPUDevice };
  return { env, runtime, realm, calls, GL1, GL2, GPU, GPUAdapter, GPUDevice,
    returns(value: unknown) { result = value; throws = false; },
    throws(value: unknown) { failure = value; throws = true; },
    install: () => installGraphicsSensor(runtime, realm),
  };
}

describe('passive graphics sensor', () => {
  it('installs without requesting a context, adapter or characteristic', () => {
    const f = setup();
    const installed = f.install();
    expect(installed.results).toHaveLength(17);
    expect(installed.results.every((result) => result.status === 'installed')).toBe(true);
    expect(f.calls).toEqual([]);
    expect(f.runtime.snapshot().counters).toEqual([]);
  });

  it('counts WebGL1/2 query and readback facts with no fingerprinting signal', () => {
    const f = setup(); f.install();
    for (const GL of [f.GL1, f.GL2]) {
      const context = new GL();
      for (const method of METHODS) context[method](CANARY);
    }
    expect(f.runtime.snapshot().counters).toEqual(expect.arrayContaining([
      expect.objectContaining({ techniqueId: 'DET-011', phase: 'returned-sync', count: 8, signalCodes: ['api-use'] }),
      expect.objectContaining({ techniqueId: 'DET-012', phase: 'returned-sync', count: 2, signalCodes: ['api-use'] }),
    ]));
    expect(f.runtime.snapshot().counters).toHaveLength(2);
  });

  it.each(METHODS)('%s preserves original receiver, all arguments and result identity, including readPixels overloads', (method) => {
    const f = setup();
    const marker = { value: CANARY };
    const argumentsList = [0, 0, 1, 1, 6408, 5121, marker, 3, undefined];
    f.returns(marker); f.install();
    const receiver = new f.GL2();
    expect(Reflect.apply(receiver[method], receiver, argumentsList)).toBe(marker);
    expect(f.calls).toEqual([{ method, receiver, args: argumentsList }]);
    for (const value of [NaN, -0, Infinity, null, undefined]) {
      f.returns(value);
      expect(Object.is(receiver[method](), value)).toBe(true);
    }
  });

  it.each(METHODS)('%s propagates the same original exception after one call', (method) => {
    const f = setup(); const error = {}; f.throws(error); f.install();
    const receiver = new f.GL1();
    let caught: unknown;
    try { receiver[method](CANARY); } catch (failure) { caught = failure; }
    expect(caught).toBe(error);
    expect(f.calls).toHaveLength(1);
    expect(f.runtime.snapshot().counters[0]).toMatchObject({ phase: 'threw-sync', count: 1, signalCodes: ['api-use'] });
  });

  it('does not add coercion or inspect readPixels destination, options, results or thrown objects', () => {
    const f = setup();
    let coercions = 0;
    const numeric = { valueOf() { coercions++; return 7; } };
    f.GL1.prototype.getParameter = function (value: unknown) { return Number(value); };
    const hostile = new Proxy({}, { get() { throw new Error('observer touched private object'); }, ownKeys() { throw new Error('observer enumerated private object'); } });
    f.returns(hostile); f.install();
    const gl = new f.GL1();
    expect(gl.getParameter(numeric)).toBe(7);
    expect(coercions).toBe(1);
    expect(gl.readPixels(0, 0, 1, 1, 6408, 5121, hostile)).toBe(hostile);
    expect(new f.GPU().requestAdapter(hostile)).toBe(hostile);
    expect(new f.GPUDevice().adapterInfo).toBe(hostile);
    f.throws(hostile);
    try { gl.getExtension(hostile); } catch (error) { expect(error).toBe(hostile); }
    expect(f.runtime.snapshot().observerErrors).toBe(0);
  });

  it('requestAdapter returns the original Promise without reading then/catch or observing its settlement', () => {
    const f = setup();
    const promise = Promise.resolve(null);
    let touched = 0;
    for (const name of ['then', 'catch']) Object.defineProperty(promise, name, { get() { touched++; throw new Error('Promise was observed'); } });
    f.returns(promise); f.install();
    expect(new f.GPU().requestAdapter({ powerPreference: CANARY })).toBe(promise);
    expect(touched).toBe(0);
    expect(f.runtime.snapshot().counters).toEqual([expect.objectContaining({ techniqueId: 'DET-013', phase: 'settlement-unobserved', count: 1 })]);
  });

  it('GPUAdapter getters preserve identity and brand exceptions, reading only the requested original getter', () => {
    const f = setup(); const marker = {}; const error = {};
    f.returns(marker); f.install();
    const adapter = new f.GPUAdapter();
    expect(adapter.info).toBe(marker); expect(adapter.features).toBe(marker); expect(adapter.limits).toBe(marker);
    expect(f.calls.map((call) => call.method)).toEqual(['info', 'features', 'limits']);
    expect(f.calls.every((call) => call.receiver === adapter)).toBe(true);
    f.throws(error);
    const getter = Object.getOwnPropertyDescriptor(f.GPUAdapter.prototype, 'info')!.get!;
    try { Reflect.apply(getter, {}, []); } catch (failure) { expect(failure).toBe(error); }
    expect(f.runtime.snapshot().counters).toEqual(expect.arrayContaining([
      ...['GPUAdapter.info', 'GPUAdapter.features', 'GPUAdapter.limits'].map(apiOperation =>
        expect.objectContaining({ techniqueId: 'DET-013', apiOperation, phase: 'returned-sync', count: 1 })),
      expect.objectContaining({ techniqueId: 'DET-013', apiOperation: 'GPUAdapter.info', phase: 'threw-sync', count: 1 }),
    ]));
  });

  it('GPUDevice getters preserve object identity and original exceptions without inspecting returned details', () => {
    const fixture = setup();
    const touches = vi.fn(() => { throw new Error('private GPU fields were inspected'); });
    const value = new Proxy({}, { get: touches, ownKeys: touches });
    fixture.returns(value); fixture.install();
    const device = new fixture.GPUDevice();
    expect(device.adapterInfo).toBe(value);
    expect(device.features).toBe(value);
    expect(device.limits).toBe(value);
    expect(touches).not.toHaveBeenCalled();
    expect(fixture.calls).toEqual(['adapterInfo', 'features', 'limits'].map(method => ({ method, receiver: device, args: [] })));
    fixture.throws(value);
    const getter = Object.getOwnPropertyDescriptor(fixture.GPUDevice.prototype, 'adapterInfo')!.get!;
    let caught: unknown;
    try { Reflect.apply(getter, {}, []); } catch (error) { caught = error; }
    expect(caught).toBe(value);
    expect(fixture.calls).toHaveLength(4);
    expect(fixture.runtime.snapshot().counters).toEqual(expect.arrayContaining([
      ...['GPUDevice.adapterInfo', 'GPUDevice.features', 'GPUDevice.limits'].map(apiOperation =>
        expect.objectContaining({ techniqueId: 'DET-013', apiOperation, phase: 'returned-sync', count: 1 })),
      expect.objectContaining({ techniqueId: 'DET-013', apiOperation: 'GPUDevice.adapterInfo', phase: 'threw-sync', count: 1 }),
    ]));
    fixture.runtime.pause();
    fixture.returns(value);
    expect(device.adapterInfo).toBe(value);
    expect(fixture.runtime.snapshot().counters.find(counter => counter.apiOperation === 'GPUDevice.adapterInfo' && counter.phase === 'returned-sync')?.count).toBe(1);
    expect(fixture.runtime.stop('local').cleanup).toBe('complete');
    expect(touches).not.toHaveBeenCalled();
  });

  it('posts only canonical factual aggregates; capabilities, extension names, pixels and option canaries remain private', () => {
    const f = setup(); f.returns({ vendor: CANARY, pixels: [179, 83, 242, 17] }); f.install();
    const gl = new f.GL1();
    gl.getParameter(CANARY); gl.getExtension(CANARY); gl.readPixels(CANARY);
    new f.GPU().requestAdapter({ powerPreference: CANARY });
    void new f.GPUAdapter().info;
    void new f.GPUDevice().adapterInfo;
    f.env.advance(500);
    const serialized = JSON.stringify(f.env.messages());
    expect(serialized).not.toContain(CANARY);
    expect(serialized).not.toContain('179');
    expect(f.env.batches().flatMap((batch) => batch.observations).every((entry) => entry.signalCodes.every((signal) => signal === 'api-use'))).toBe(true);
  });

  it('ordinary rendering without capability queries/readback creates no observation', () => {
    const f = setup(); f.install();
    new f.GL1().clear(16384); new f.GL2().clear(16384);
    expect(f.calls).toHaveLength(2);
    expect(f.runtime.snapshot().counters).toEqual([]);
  });

  it('observer failure cannot replace return/throw identity or make methods constructible', () => {
    const f = setup(); const marker = {}; f.returns(marker); f.install();
    const record = vi.spyOn(f.runtime, 'record').mockImplementation(() => { throw new Error('observer'); });
    const gl = new f.GL1(); expect(gl.getParameter(1)).toBe(marker);
    f.throws(marker);
    try { gl.getParameter(1); } catch (failure) { expect(failure).toBe(marker); }
    expect(f.runtime.snapshot().observerErrors).toBe(2);
    expect(() => Reflect.construct(gl.getParameter, [])).toThrow(TypeError);
    expect(f.calls).toHaveLength(2);
    record.mockRestore();
  });

  it('pause stops observations, repeated installation does not double count, and cleanup preserves later replacements', () => {
    const f = setup(); const original = f.GL1.prototype.getParameter;
    f.install(); f.install();
    const gl = new f.GL1(); gl.getParameter(1);
    f.runtime.pause(); gl.getParameter(1);
    f.runtime.resume(); gl.getParameter(1);
    expect(f.runtime.snapshot().counters[0]?.count).toBe(2);
    const replacement = function () { return 99; };
    f.GL1.prototype.getExtension = replacement;
    expect(f.runtime.stop('local').cleanup).toBe('partial');
    expect(f.GL1.prototype.getParameter).toBe(original);
    expect(f.GL1.prototype.getExtension).toBe(replacement);
    expect(f.install().results).toEqual([]);
  });

  it('frozen and accessor-poisoned interfaces degrade without invoking accessors or replacing descriptors', () => {
    const f = setup();
    const original = f.GL1.prototype.getParameter;
    Object.defineProperty(f.GL1.prototype, 'getParameter', { configurable: false, value: original });
    let touched = 0;
    Object.defineProperty(f.realm, 'GPU', { get() { touched++; throw new Error('unexpected constructor getter'); } });
    const installed = f.install();
    expect(touched).toBe(0);
    expect(installed.skipped).toContain('GPU');
    expect(f.runtime.snapshot().flags).toContain('descriptor-nonconfigurable');
    expect(f.GL1.prototype.getParameter).toBe(original);
    expect(() => installGraphicsSensor(f.runtime, new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('hostile realm'); } }))).not.toThrow();
    expect(f.runtime.snapshot().flags).toContain('hook-failed');
  });

  it('absent WebGPU and optional adapter.info remain explicitly skipped with no fallback request', () => {
    const f = setup();
    const realm = { GPUAdapter: f.GPUAdapter };
    Reflect.deleteProperty(f.GPUAdapter.prototype, 'info');
    const installed = installGraphicsSensor(f.runtime, realm);
    expect(installed.skipped).toEqual(['WebGLRenderingContext', 'WebGL2RenderingContext', 'GPU', 'GPUAdapter.requestDevice',
      'GPUAdapter.info', 'GPUDevice', 'GPUAdapterInfo', 'GPUSupportedLimits', 'GPUShaderModule']);
    expect(f.calls).toEqual([]);
  });

  it('late page replacement of Array.push cannot orphan installed wrappers outside runtime cleanup', () => {
    const f = setup(); const originalMethod = f.GL1.prototype.getParameter;
    const originalPush = Object.getOwnPropertyDescriptor(Array.prototype, 'push')!;
    let installed;
    try {
      Object.defineProperty(Array.prototype, 'push', { ...originalPush, value() { throw new Error('page Array.push replacement'); } });
      installed = f.install();
    } finally { Object.defineProperty(Array.prototype, 'push', originalPush); }
    expect(installed.results).toHaveLength(17);
    expect(f.GL1.prototype.getParameter).not.toBe(originalMethod);
    expect(f.runtime.stop('local').cleanup).toBe('complete');
    expect(f.GL1.prototype.getParameter).toBe(originalMethod);
  });

  it.each(API_OPERATION_DEFINITIONS.filter(definition => definition[2] === 'webgpu'))('%s records only the exact operation and preserves its result and exception', (apiOperation, techniqueId, _mechanism, kind) => {
    const fake = makeEnv(); const runtime = new SensorRuntime(fake.env);
    runtime.start(); deliver(fake, bridgeHello(runtime));
    const [owner, property] = apiOperation.split('.');
    class NativeInterface {}
    const touches = vi.fn(() => { throw new Error('private GPU value'); });
    const value = new Proxy({}, { get: touches, ownKeys: touches });
    let failure = false;
    const original = vi.fn(function (this: unknown) { if (failure) throw value; return value; });
    Object.defineProperty(NativeInterface.prototype, property!, kind === 'get'
      ? { get: original, configurable: true } : { value: original, writable: true, configurable: true });
    const installed = installGraphicsSensor(runtime, { [owner!]: NativeInterface });
    expect(installed.results).toHaveLength(1);
    const receiver = new NativeInterface();
    const call = () => kind === 'get' ? Reflect.get(receiver, property!) : Reflect.apply(Reflect.get(receiver, property!) as Function, receiver, [value]);
    expect(call()).toBe(value);
    expect(original).toHaveBeenCalledTimes(1);
    expect(original.mock.instances[0]).toBe(receiver);
    expect(runtime.snapshot().counters).toEqual([expect.objectContaining({ techniqueId, apiOperation,
      phase: kind === 'async-call' ? 'settlement-unobserved' : 'returned-sync', count: 1, signalCodes: ['api-use'] })]);
    failure = true; let caught: unknown;
    try { call(); } catch (error) { caught = error; }
    expect(caught).toBe(value); expect(original).toHaveBeenCalledTimes(2);
    expect(touches).not.toHaveBeenCalled();
    runtime.stop('local');
  });
});
