import { describe, expect, it, vi } from 'vitest';
import { ApiResultRecorder, previewReturnedValue } from '../src/api-results';
import { SensorRuntime } from '../src/runtime';
import { installEnvironmentSensor } from '../src/environment';
import { makeEnv } from './helpers';
import { API_RESULTS_CHANNEL, readApiResultsBatch, webglResultOperation, readApiResultEntries } from '../../contracts/src/api-results';
import { installGraphicsSensor } from '../src/webgl';

describe('ADR-036 local previews of values already returned to the page', () => {
  it('preserves exact allowed primitive values and distinguishes absent values from zero', () => {
    expect(previewReturnedValue('Screen.width', 'returned-sync', 1920)).toEqual({ kind: 'number', value: 1920 });
    expect(previewReturnedValue('Navigator.hardwareConcurrency', 'returned-sync', 16)).toEqual({ kind: 'number', value: 16 });
    expect(previewReturnedValue('Navigator.webdriver', 'returned-sync', false)).toEqual({ kind: 'boolean', value: false });
    expect(previewReturnedValue('GPUAdapterInfo.vendor', 'returned-sync', 'Example GPU')).toEqual({ kind: 'string', value: 'Example GPU' });
    expect(previewReturnedValue('Window.open', 'returned-sync', null)).toEqual({ kind: 'null' });
    expect(previewReturnedValue('Window.moveTo', 'returned-sync', undefined)).toEqual({ kind: 'undefined' });
    for (const [value, label] of [[NaN, 'NaN'], [Infinity, 'Infinity'], [-Infinity, '-Infinity'], [-0, '-0']] as const) {
      expect(previewReturnedValue('Screen.width', 'returned-sync', value)).toEqual({ kind: 'special-number', value: label });
    }
  });

  it('never inspects arbitrary objects, thrown values, or foreign Promises', () => {
    const touched = vi.fn(() => { throw new Error('untrusted read'); });
    const opaque = new Proxy({}, { get: touched, ownKeys: touched, getOwnPropertyDescriptor: touched, getPrototypeOf: touched });
    expect(previewReturnedValue('Screen.orientation', 'returned-sync', opaque)).toEqual({ kind: 'unobserved', reason: 'object' });
    expect(previewReturnedValue('NavigatorUAData.getHighEntropyValues', 'settlement-unobserved', opaque)).toEqual({ kind: 'unobserved', reason: 'async' });
    expect(previewReturnedValue('Screen.width', 'threw-sync', opaque)).toEqual({ kind: 'unobserved', reason: 'exception' });
    expect(touched).not.toHaveBeenCalled();
  });

  it('omits sensitive results and rejects unknown operation labels', () => {
    for (const operation of ['Document.cookie', 'AudioBuffer.getChannelData', 'Clipboard.readText', 'PressureRecord.time']) {
      expect(previewReturnedValue(operation, 'returned-sync', 'PRIVATE_RESULT_CANARY')).toEqual({ kind: 'unobserved', reason: 'sensitive' });
    }
    expect(previewReturnedValue('Page.customMethod', 'returned-sync', 'PRIVATE_RESULT_CANARY')).toBeNull();
    expect(previewReturnedValue('__proto__', 'returned-sync', 'PRIVATE_RESULT_CANARY')).toBeNull();
    expect(previewReturnedValue('GPUAdapterInfo.vendor', 'returned-sync', 'x'.repeat(257))).toEqual({ kind: 'unobserved', reason: 'limit' });
  });

  it('keeps the latest returned value and exception in separate bounded entries', () => {
    const recorder = new ApiResultRecorder();
    recorder.record('Screen.width', 'returned-sync', 1920);
    recorder.record('Screen.width', 'returned-sync', 1280);
    recorder.record('Screen.width', 'threw-sync', new Error('DO_NOT_CAPTURE_ERROR_TEXT'));
    const snapshot = recorder.snapshot();
    expect(snapshot.rows).toHaveLength(2);
    expect(snapshot.rows.find(row => row.phase === 'returned-sync')).toMatchObject({ operation: 'Screen.width', value: { kind: 'number', value: 1280 } });
    expect(snapshot.rows.find(row => row.phase === 'threw-sync')).toMatchObject({ value: { kind: 'unobserved', reason: 'exception' } });
    expect(JSON.stringify(snapshot)).not.toContain('DO_NOT_CAPTURE_ERROR_TEXT');
    recorder.clear();
    expect(recorder.snapshot()).toEqual({ rows: [], truncated: false });
  });

  it('captures the actual screen getter result once, outside ordinary snapshots, and clears on pause/stop', () => {
    const runtime = new SensorRuntime(makeEnv().env);
    class Screen {}
    let width = 1927;
    const getter = vi.fn(() => width);
    Object.defineProperty(Screen.prototype, 'width', { configurable: true, get: getter });
    const screen = new Screen();
    installEnvironmentSensor(runtime, { Screen });
    expect(getter).not.toHaveBeenCalled();
    expect(Reflect.get(screen, 'width')).toBe(1927);
    expect(getter).toHaveBeenCalledTimes(1);
    expect(runtime.apiResults.snapshot().rows).toEqual([{ operation: 'Screen.width', techniqueId: 'DET-029',
      phase: 'returned-sync', value: { kind: 'number', value: 1927 } }]);
    expect(JSON.stringify(runtime.snapshot())).not.toContain('1927');
    runtime.pause();
    expect(runtime.apiResults.snapshot().rows).toEqual([]);
    width = 1000;
    expect(Reflect.get(screen, 'width')).toBe(1000);
    expect(runtime.apiResults.snapshot().rows).toEqual([]);
    runtime.resume();
    expect(Reflect.get(screen, 'width')).toBe(1000);
    expect(runtime.apiResults.snapshot().rows[0]?.value).toEqual({ kind: 'number', value: 1000 });
    runtime.stop('local');
    expect(runtime.apiResults.snapshot().rows).toEqual([]);
    expect(Object.getOwnPropertyDescriptor(Screen.prototype, 'width')?.get).toBe(getter);
    expect(getter).toHaveBeenCalledTimes(3);
  });

  it('returns bounded batches only on a result query and clears a stale epoch before replying', () => {
    const recorder = new ApiResultRecorder();
    const fake = makeEnv();
    recorder.record('Screen.width', 'returned-sync', 1920);
    expect(fake.posted).toEqual([]);
    recorder.handleControl({ channel: API_RESULTS_CHANNEL, type: 'api-results-read', requestId: 'query1', epoch: 0 }, true, fake.env);
    expect(readApiResultsBatch(fake.posted[0])?.rows).toHaveLength(1);
    fake.advance(1000);
    recorder.handleControl({ channel: API_RESULTS_CHANNEL, type: 'api-results-read', requestId: 'query2', epoch: 1 }, true, fake.env);
    expect(readApiResultsBatch(fake.posted[1])?.rows).toEqual([]);
    expect(recorder.snapshot().rows).toEqual([]);
  });

  it('copies only bounded native numeric vectors without invoking custom properties or accepting shared buffers', () => {
    const name = 'WebGLRenderingContext.getParameter.MAX_VIEWPORT_DIMS';
    const touched = vi.fn();
    const vector = new Int32Array([4096, 8192]);
    for (const key of ['length', 'buffer', 'constructor', 'toJSON']) Object.defineProperty(vector, key, { get: touched });
    expect(previewReturnedValue(name, 'returned-sync', vector, true)).toEqual({ kind: 'number-array', values: [4096, 8192] });
    expect(touched).not.toHaveBeenCalled();
    const opaque = new Proxy(vector, { get: touched, getPrototypeOf: touched, getOwnPropertyDescriptor: touched });
    expect(previewReturnedValue(name, 'returned-sync', opaque, true)).toEqual({ kind: 'unobserved', reason: 'object' });
    expect(touched).not.toHaveBeenCalled();
    expect(previewReturnedValue(name, 'returned-sync', new Float32Array([-0, NaN, Infinity]), true)).toEqual({ kind: 'number-array', values: ['-0', 'NaN', 'Infinity'] });
    expect(previewReturnedValue(name, 'returned-sync', new Int32Array(17), true)).toEqual({ kind: 'unobserved', reason: 'limit' });
    expect(previewReturnedValue(name, 'returned-sync', new Int32Array(new SharedArrayBuffer(8)), true)).toEqual({ kind: 'unobserved', reason: 'object' });
  });

  it('names only known primitive WebGL parameters and returns the original value without extra capability queries', () => {
    const runtime = new SensorRuntime(makeEnv().env);
    const original = vi.fn((parameter: unknown) => parameter === 0x0d33 ? 16384 : 'opaque');
    class WebGL { getParameter = original; }
    Object.defineProperty(WebGL.prototype, 'getParameter', { value: original, configurable: true, writable: true });
    installGraphicsSensor(runtime, { WebGLRenderingContext: WebGL });
    expect(original).not.toHaveBeenCalled();
    expect(WebGL.prototype.getParameter(0x0d33)).toBe(16384);
    expect(original).toHaveBeenCalledTimes(1);
    const rows = runtime.apiResults.snapshot().rows;
    expect(rows[0]).toMatchObject({ operation: 'WebGLRenderingContext.getParameter.MAX_TEXTURE_SIZE', value: { kind: 'number', value: 16384 } });
    expect(readApiResultEntries(rows)).not.toBeNull();
    const touched = vi.fn();
    const opaque = new Proxy({}, { get: touched });
    expect(webglResultOperation('WebGLRenderingContext', 'getParameter', opaque)).toBe('WebGLRenderingContext.getParameter');
    expect(touched).not.toHaveBeenCalled();
    expect(previewReturnedValue('WebGLRenderingContext.getParameter', 'returned-sync', 'PRIVATE_UNKNOWN_PARAM')).toEqual({ kind: 'unobserved', reason: 'unsupported' });
    runtime.stop('local');
  });

  it('does not consult inherited feature flags while observing an actual getter result', () => {
    const runtime = new SensorRuntime(makeEnv().env);
    class Screen {}
    const original = vi.fn(() => 1920);
    Object.defineProperty(Screen.prototype, 'width', { configurable: true, get: original });
    installEnvironmentSensor(runtime, { Screen });
    const touched = vi.fn(() => false);
    try {
      for (const key of ['typeOnly', 'numericVector']) Object.defineProperty(Object.prototype, key, { configurable: true, get: touched });
      expect(Reflect.get(new Screen(), 'width')).toBe(1920);
      expect(runtime.apiResults.snapshot().rows[0]?.value).toEqual({ kind: 'number', value: 1920 });
    } finally {
      delete (Object.prototype as { typeOnly?: boolean }).typeOnly;
      delete (Object.prototype as { numericVector?: boolean }).numericVector;
      runtime.stop('local');
    }
    expect(original).toHaveBeenCalledTimes(1);
    expect(touched).not.toHaveBeenCalled();
  });

  it('records a later valid WebGL vector after a rejected Proxy or shared vector', () => {
    for (const previous of [new Proxy({}, {}), new Int32Array(new SharedArrayBuffer(8))]) {
      const recorder = new ApiResultRecorder(true);
      const operation = 'WebGLRenderingContext.getParameter.MAX_VIEWPORT_DIMS';
      recorder.record(operation, 'returned-sync', previous);
      recorder.record(operation, 'returned-sync', new Int32Array([4096, 8192]));
      expect(recorder.snapshot().rows[0]?.value).toEqual({ kind: 'number-array', values: [4096, 8192] });
    }
  });

  it('does not read vector contents in a late-installed runtime', () => {
    const runtime = new SensorRuntime(makeEnv({ startedLate: true }).env);
    const vector = new Int32Array([4096, 8192]);
    const original = vi.fn(() => vector);
    class WebGL {}
    Object.defineProperty(WebGL.prototype, 'getParameter', { value: original, configurable: true, writable: true });
    installGraphicsSensor(runtime, { WebGLRenderingContext: WebGL });
    const wrapped = Reflect.get(WebGL.prototype, 'getParameter') as Function;
    expect(Reflect.apply(wrapped, new WebGL(), [0x0d3a])).toBe(vector);
    expect(original).toHaveBeenCalledTimes(1);
    expect(runtime.apiResults.snapshot().rows[0]?.value).toEqual({ kind: 'unobserved', reason: 'unsupported' });
    runtime.stop('local');
  });
});