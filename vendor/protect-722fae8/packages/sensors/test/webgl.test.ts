// WebGL sensor (DET-011/012, task E07-03, S04) on fake WebGL interfaces. The realm is a plain object with the
// interface constructors as own data properties, like `window`. Covers ADR-017 §2 classification without coercion,
// wrapper semantics (REQ-002), getParameter modes of FAMILY_CONFIG, retirement, pause and privacy (REQ-005).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUDGETS } from '@detect-expert/contracts';
import { FAMILY_CONFIG, SensorRuntime, installWebglSensor, isLimitParam } from '../src/index';
import type { FamilyConfig, HookHandle, RuntimeSnapshot, WrapResult } from '../src/index';
import { bridgeHello, bridgeSimple, deliver, makeEnv } from './helpers';

const RENDERER_CANARY = 'CANARY-RENDERER-GPU-5d1e';
const EXTENSION_CANARY = 'CANARY_ext_name_77ab';
const WRAP: FamilyConfig = Object.freeze({ ...FAMILY_CONFIG, webglGetParameter: 'wrap' });
const MEMBERS = ['getParameter', 'getExtension', 'getSupportedExtensions', 'getShaderPrecisionFormat', 'readPixels'] as const;

interface Behavior {
  parameter: unknown;
  extension: unknown;
  supported: unknown;
  precision: unknown;
  error: unknown;
}

interface GlLike {
  getParameter(...args: unknown[]): unknown;
  getExtension(...args: unknown[]): unknown;
  getSupportedExtensions(): unknown;
  getShaderPrecisionFormat(...args: unknown[]): unknown;
  readPixels(...args: unknown[]): unknown;
}

interface Fakes {
  realm: Record<string, unknown>;
  GL: new () => GlLike;
  GL2: (new () => GlLike) | null;
  behavior: Behavior;
  /** Every original call: member, receiver and the exact argument list (identity). */
  calls: Array<{ member: string; thisArg: unknown; args: unknown[] }>;
}

/** Fresh interface classes per test. The fake originals never touch their arguments (so any access is ours). */
function makeFakes(options?: { webgl2?: 'own' | 'inherit' | 'absent' }): Fakes {
  const behavior: Behavior = { parameter: 0, extension: null, supported: [], precision: null, error: null };
  const calls: Fakes['calls'] = [];
  const glClass = (): new () => GlLike =>
    class implements GlLike {
      getParameter(...args: unknown[]): unknown {
        calls.push({ member: 'getParameter', thisArg: this, args });
        if (behavior.error !== null) throw behavior.error;
        if (args.length === 0) throw new TypeError('1 argument required, but only 0 present.');
        return behavior.parameter;
      }
      getExtension(...args: unknown[]): unknown {
        calls.push({ member: 'getExtension', thisArg: this, args });
        if (behavior.error !== null) throw behavior.error;
        if (args.length === 0) throw new TypeError('1 argument required, but only 0 present.');
        return behavior.extension;
      }
      getSupportedExtensions(...args: unknown[]): unknown {
        calls.push({ member: 'getSupportedExtensions', thisArg: this, args });
        return behavior.supported;
      }
      getShaderPrecisionFormat(...args: unknown[]): unknown {
        calls.push({ member: 'getShaderPrecisionFormat', thisArg: this, args });
        return behavior.precision;
      }
      readPixels(...args: unknown[]): unknown {
        calls.push({ member: 'readPixels', thisArg: this, args });
        if (behavior.error !== null) throw behavior.error;
        return undefined;
      }
    };
  const GL = glClass();
  const mode = options?.webgl2 ?? 'own';
  let GL2: (new () => GlLike) | null = null;
  if (mode === 'own') GL2 = glClass();
  if (mode === 'inherit') GL2 = class extends GL {};
  const realm: Record<string, unknown> = { WebGLRenderingContext: GL };
  if (GL2 !== null) realm['WebGL2RenderingContext'] = GL2;
  return { realm, GL, GL2, behavior, calls };
}

function setup(config: FamilyConfig = WRAP, options?: { webgl2?: 'own' | 'inherit' | 'absent' }) {
  const fake = makeEnv();
  const runtime = new SensorRuntime(fake.env);
  runtime.start();
  const fakes = makeFakes(options);
  const sensor = installWebglSensor(runtime, fakes.realm, config);
  return { fake, runtime, fakes, sensor };
}

/** "phase op count quality" rows in creation order. */
function rows(snap: RuntimeSnapshot): string[] {
  return snap.counters.map((c) => [c.techniqueId, c.phase, c.signalCodes.join(','), c.operationCode ?? '-', c.count, c.countQuality].join(' '));
}

function count(snap: RuntimeSnapshot, techniqueId: string, phase: string, op: string | undefined): number | undefined {
  return snap.counters.find((c) => c.techniqueId === techniqueId && c.phase === phase && c.operationCode === op && c.signalCodes.join(',') === 'api-use')?.count;
}

function installed(r: WrapResult | undefined): HookHandle {
  if (r === undefined || r.status !== 'installed') throw new Error('expected an installed hook');
  return r;
}

describe('installation', () => {
  it('default FAMILY_CONFIG (S03 no-go): getParameter is not wrapped; the other four members on both prototypes are', () => {
    expect(FAMILY_CONFIG.webglGetParameter).toBe('off');
    const fakes = makeFakes();
    const before = Object.getOwnPropertyDescriptor(fakes.GL.prototype, 'getParameter');
    const runtime = new SensorRuntime(makeEnv().env);
    const sensor = installWebglSensor(runtime, fakes.realm);
    expect(sensor.results.map((r) => r.status + ':' + r.label)).toEqual(
      [...MEMBERS.slice(1), ...MEMBERS.slice(1)].map((m) => 'installed:' + m),
    );
    expect(sensor.skipped).toEqual([]);
    expect(Object.getOwnPropertyDescriptor(fakes.GL.prototype, 'getParameter')).toEqual(before);
    new fakes.GL().getParameter(0x1f01);
    expect(runtime.snapshot().counters).toEqual([]);
    expect(runtime.snapshot().flags).toEqual([]);
  });

  it("'wrap' installs all five members on WebGL and WebGL2 (own copies, like Chromium)", () => {
    const { sensor, runtime } = setup();
    expect(sensor.results.map((r) => r.status + ':' + r.label)).toEqual([...MEMBERS, ...MEMBERS].map((m) => 'installed:' + m));
    expect(sensor.skipped).toEqual([]);
    expect(runtime.snapshot().state).toBe('active');
  });

  it('no WebGL2 interface: skipped without a coverage flag', () => {
    const { sensor, runtime } = setup(WRAP, { webgl2: 'absent' });
    expect(sensor.results).toHaveLength(5);
    expect(sensor.skipped).toEqual(['WebGL2RenderingContext']);
    expect(runtime.snapshot().flags).toEqual([]);
  });

  it('a WebGL2 prototype without own members is skipped per member and inherited calls are counted once', () => {
    const { sensor, runtime, fakes } = setup(WRAP, { webgl2: 'inherit' });
    expect(sensor.results).toHaveLength(5);
    expect(sensor.skipped).toEqual(MEMBERS.map((m) => 'WebGL2RenderingContext.' + m));
    expect(runtime.snapshot().flags).toEqual([]);
    new fakes.GL2!().getSupportedExtensions();
    expect(count(runtime.snapshot(), 'DET-011', 'returned-sync', 'supported-extensions')).toBe(1);
  });

  it('a non-configurable member is unsupported with descriptor-nonconfigurable; the rest install', () => {
    const fake = makeEnv();
    const runtime = new SensorRuntime(fake.env);
    const fakes = makeFakes();
    const original = Object.getOwnPropertyDescriptor(fakes.GL.prototype, 'getExtension')!;
    Object.defineProperty(fakes.GL.prototype, 'getExtension', { ...original, configurable: false });
    const sensor = installWebglSensor(runtime, fakes.realm, WRAP);
    const failed = sensor.results.filter((r) => r.status === 'unsupported');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ label: 'getExtension', reason: 'non-configurable', coverageFlag: 'descriptor-nonconfigurable' });
    expect(Object.getOwnPropertyDescriptor(fakes.GL.prototype, 'getExtension')!.value).toBe(original.value);
    expect(sensor.results.filter((r) => r.status === 'installed')).toHaveLength(9);
    expect(runtime.snapshot().flags).toEqual(['descriptor-nonconfigurable']);
    expect(runtime.snapshot().state).toBe('degraded');
  });

  it('a second install in the same module instance reuses the hooks and does not double count', () => {
    const { runtime, fakes, sensor } = setup();
    const again = installWebglSensor(runtime, fakes.realm, WRAP);
    expect(again.results).toEqual(sensor.results);
    new fakes.GL().getParameter(0x0d33);
    new fakes.GL2!().readPixels(0, 0, 1, 1, 0x1908, 0x1401, new Uint8Array(4));
    expect(fakes.calls).toHaveLength(2);
    expect(count(runtime.snapshot(), 'DET-011', 'returned-sync', 'param-limit')).toBe(1);
    expect(count(runtime.snapshot(), 'DET-012', 'returned-sync', 'read-pixels')).toBe(1);
  });

  it('restores every original descriptor on stop', () => {
    const fakes = makeFakes();
    const protos = [fakes.GL.prototype, fakes.GL2!.prototype];
    const before = protos.map((p) => Object.getOwnPropertyDescriptors(p));
    const runtime = new SensorRuntime(makeEnv().env);
    installWebglSensor(runtime, fakes.realm, WRAP);
    expect(protos.map((p) => Object.getOwnPropertyDescriptors(p))).not.toEqual(before);
    expect(runtime.stop('local')).toMatchObject({ notRestored: [], cleanup: 'complete' });
    expect(protos.map((p) => Object.getOwnPropertyDescriptors(p))).toEqual(before);
  });

  it('rejects an invalid retireAfter at install (contract error, isolated by the registry as hook-failed)', () => {
    const fakes = makeFakes();
    const runtime = new SensorRuntime(makeEnv().env);
    for (const retireAfter of [0, -1, 1.5, Number.NaN]) {
      expect(() => installWebglSensor(runtime, fakes.realm, { ...FAMILY_CONFIG, retireAfter, webglGetParameter: 'retire' })).toThrow(/retireAfter/);
    }
  });
});

describe('DET-011 getParameter classification (ADR-017 §2)', () => {
  it.each([
    [0x1f00, 'param-vendor'],
    [0x1f01, 'param-renderer'],
    [0x1f02, 'param-version'],
    [0x8b8c, 'param-shading-language-version'],
    [0x9245, 'param-unmasked-vendor'],
    [0x9246, 'param-unmasked-renderer'],
    [0x0d33, 'param-limit'], // MAX_TEXTURE_SIZE
    [0x8904, 'param-limit'], // MIN_PROGRAM_TEXEL_OFFSET
    [0x846e, 'param-limit'], // ALIASED_LINE_WIDTH_RANGE
    [0x0d57, 'param-limit'], // STENCIL_BITS
    [0x84ff, 'param-limit'], // MAX_TEXTURE_MAX_ANISOTROPY_EXT
    [0x0ba2, 'param-other'], // VIEWPORT
    [0x9631, 'param-other'], // MAX_VIEWS_OVR: an extension limit outside the literal list
    [Number.NaN, 'param-other'],
    [-0, 'param-other'],
  ] as const)('pname %d -> %s; the numeric pname is never recorded', (pname, op) => {
    const { runtime, fakes, fake } = setup();
    new fakes.GL().getParameter(pname);
    new fakes.GL2!().getParameter(pname);
    expect(rows(runtime.snapshot())).toEqual(['DET-011 returned-sync api-use ' + op + ' 2 exact']);
    deliver(fake, bridgeHello(runtime));
    const observations = fake.batches().flatMap((b) => b.observations);
    expect(observations).toHaveLength(1);
    expect(Object.keys(observations[0]!).sort()).toEqual(['count', 'countQuality', 'intervalBucket', 'operationCode', 'phase', 'signalCodes', 'techniqueId']);
    if (Number.isFinite(pname) && pname !== 0) expect(JSON.stringify(fake.posted)).not.toContain(String(pname));
  });

  it('isLimitParam is a literal switch: identity pnames and non-numbers-as-numbers are not limits', () => {
    for (const p of [0x1f00, 0x1f01, 0x1f02, 0x8b8c, 0x9245, 0x9246, 0x0ba2, 0]) expect(isLimitParam(p)).toBe(false);
    expect(isLimitParam(0x0d33)).toBe(true);
  });

  it('no argument, a string, an object with valueOf, a Proxy and a Number object are param-unclassified; nothing is coerced', () => {
    const { runtime, fakes } = setup();
    const gl = new fakes.GL();
    const touched: string[] = [];
    const valueOf = { valueOf: () => { touched.push('valueOf'); return 0x1f01; }, [Symbol.toPrimitive]: () => { touched.push('toPrimitive'); return 0x1f01; } };
    const proxy = new Proxy({}, {
      get: (_t, k) => { touched.push('get:' + String(k)); return undefined; },
      has: () => { touched.push('has'); return false; },
      getPrototypeOf: () => { touched.push('getPrototypeOf'); return null; },
      getOwnPropertyDescriptor: () => { touched.push('gOPD'); return undefined; },
      ownKeys: () => { touched.push('ownKeys'); return []; },
    });
    const boxed = new Number(0x1f01);
    Object.defineProperty(boxed, 'valueOf', { value: () => { touched.push('Number.valueOf'); return 0x1f01; } });
    expect(() => gl.getParameter()).toThrow(TypeError);
    gl.getParameter('0x1f01');
    gl.getParameter(valueOf);
    gl.getParameter(proxy);
    gl.getParameter(boxed);
    gl.getParameter(null);
    expect(touched).toEqual([]);
    expect(rows(runtime.snapshot())).toEqual([
      'DET-011 threw-sync api-use param-unclassified 1 exact',
      'DET-011 returned-sync api-use param-unclassified 5 exact',
    ]);
  });

  it('returns the original value untouched (NaN, -0, null, object identity) and calls the original exactly once with the same this and arguments', () => {
    const { fakes } = setup();
    const gl = new fakes.GL();
    for (const value of [Number.NaN, -0, null, undefined, { identity: true }, new Float32Array([1, 2])]) {
      fakes.behavior.parameter = value;
      const extra = { extra: true };
      const before = fakes.calls.length;
      const result = gl.getParameter(0x0d33, extra);
      expect(Object.is(result, value)).toBe(true);
      expect(fakes.calls.length).toBe(before + 1);
      const call = fakes.calls[fakes.calls.length - 1]!;
      expect(call.thisArg).toBe(gl);
      expect(call.args).toHaveLength(2);
      expect(call.args[1]).toBe(extra);
    }
  });

  it('propagates the same exception instance and records threw-sync with the classified operation', () => {
    const { runtime, fakes } = setup();
    const error = new DOMException('context lost', 'InvalidStateError');
    fakes.behavior.error = error;
    let caught: unknown = null;
    try {
      new fakes.GL().getParameter(0x9246);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(error);
    expect(rows(runtime.snapshot())).toEqual(['DET-011 threw-sync api-use param-unmasked-renderer 1 exact']);
    expect(runtime.snapshot().observerErrors).toBe(0);
  });
});

describe('DET-011 getExtension classification', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('the debug extension name matches ASCII case-insensitively; other names are ext-other', () => {
    const { runtime, fakes } = setup();
    const gl = new fakes.GL();
    for (const name of ['WEBGL_debug_renderer_info', 'webgl_debug_renderer_info', 'WebGL_Debug_Renderer_Info', 'WEBGL_DEBUG_RENDERER_INFO']) gl.getExtension(name);
    for (const name of ['OES_vertex_array_object', 'WEBGL_debug_renderer_infx', 'WEBGL_debug_renderer_info ', 'WEBGL_debug_shaders', '', EXTENSION_CANARY]) gl.getExtension(name);
    expect(rows(runtime.snapshot())).toEqual([
      'DET-011 returned-sync api-use ext-debug-renderer-info 4 exact',
      'DET-011 returned-sync api-use ext-other 6 exact',
    ]);
  });

  it('counts a request even when the browser returns null, and returns the extension object by identity', () => {
    const { runtime, fakes } = setup();
    const gl = new fakes.GL();
    fakes.behavior.extension = null;
    expect(gl.getExtension('WEBGL_debug_renderer_info')).toBeNull();
    const ext = { UNMASKED_RENDERER_WEBGL: 0x9246 };
    fakes.behavior.extension = ext;
    expect(gl.getExtension('WEBGL_debug_renderer_info')).toBe(ext);
    expect(count(runtime.snapshot(), 'DET-011', 'returned-sync', 'ext-debug-renderer-info')).toBe(2);
  });

  it('a String object, an object with toString, a Proxy and no argument are ext-unclassified; no toString/valueOf runs', () => {
    const { runtime, fakes } = setup();
    const gl = new fakes.GL();
    const touched: string[] = [];
    const boxed = new String('WEBGL_debug_renderer_info');
    Object.defineProperty(boxed, 'toString', { value: () => { touched.push('toString'); return 'x'; } });
    Object.defineProperty(boxed, 'valueOf', { value: () => { touched.push('valueOf'); return 'x'; } });
    const named = { toString: () => { touched.push('obj.toString'); return 'WEBGL_debug_renderer_info'; } };
    const proxy = new Proxy({}, { get: (_t, k) => { touched.push('get:' + String(k)); return undefined; } });
    gl.getExtension(boxed);
    gl.getExtension(named);
    gl.getExtension(proxy);
    gl.getExtension(25);
    expect(() => gl.getExtension()).toThrow(TypeError);
    expect(touched).toEqual([]);
    expect(rows(runtime.snapshot())).toEqual([
      'DET-011 returned-sync api-use ext-unclassified 4 exact',
      'DET-011 threw-sync api-use ext-unclassified 1 exact',
    ]);
  });

  it('string comparison uses no String.prototype method and no inherited index property', () => {
    const { runtime, fakes } = setup();
    const gl = new fakes.GL();
    const touched: string[] = [];
    for (const method of ['toLowerCase', 'toUpperCase', 'charCodeAt', 'charAt', 'localeCompare', 'startsWith', 'includes', 'codePointAt']) {
      vi.spyOn(String.prototype as unknown as Record<string, () => unknown>, method).mockImplementation(() => {
        touched.push(method);
        throw new Error('page patch');
      });
    }
    Object.defineProperty(String.prototype, '3', { configurable: true, get: () => { touched.push('index'); return 'X'; } });
    try {
      gl.getExtension('WEBGL_debug_renderer_info');
      gl.getExtension('webgl_debug_renderer_info');
    } finally {
      delete (String.prototype as unknown as Record<string, unknown>)['3'];
      vi.restoreAllMocks(); // before any assertion: expect() itself may use String.prototype
    }
    expect(touched).toEqual([]);
    expect(count(runtime.snapshot(), 'DET-011', 'returned-sync', 'ext-debug-renderer-info')).toBe(2);
  });
});

describe('DET-011 capability queries and DET-012 readPixels', () => {
  it('getSupportedExtensions / getShaderPrecisionFormat / readPixels record one fixed code; arguments and the buffer are not touched', () => {
    const { runtime, fakes } = setup();
    const gl = new fakes.GL2!();
    const touched: string[] = [];
    const watch = <T extends object>(target: T): T =>
      new Proxy(target, {
        get: (t, k, r) => { touched.push('get:' + String(k)); return Reflect.get(t, k, r); },
        set: (t, k, v, r) => { touched.push('set:' + String(k)); return Reflect.set(t, k, v, r); },
      });
    const list = ['OES_vertex_array_object', EXTENSION_CANARY];
    fakes.behavior.supported = list;
    expect(gl.getSupportedExtensions()).toBe(list);
    const precision = { rangeMin: 127, rangeMax: 127, precision: 23 };
    fakes.behavior.precision = precision;
    for (let i = 0; i < 6; i++) expect(gl.getShaderPrecisionFormat(watch({ shader: i }), watch({ precision: i }))).toBe(precision);
    const pixels = watch(new Uint8Array(16));
    expect(gl.readPixels(0, 0, 2, 2, 0x1908, 0x1401, pixels)).toBeUndefined();
    expect(touched).toEqual([]);
    expect(fakes.calls.filter((c) => c.member === 'readPixels')[0]!.args[6]).toBe(pixels);
    expect(rows(runtime.snapshot())).toEqual([
      'DET-011 returned-sync api-use supported-extensions 1 exact',
      'DET-011 returned-sync api-use shader-precision-format 6 exact',
      'DET-012 returned-sync api-use read-pixels 1 exact',
    ]);
  });

  it('readPixels that throws propagates the same exception and is threw-sync', () => {
    const { runtime, fakes } = setup();
    const error = new DOMException('The canvas has been tainted by cross-origin data.', 'SecurityError');
    fakes.behavior.error = error;
    expect(() => new fakes.GL().readPixels(0, 0, 1, 1, 0x1908, 0x1401, new Uint8Array(4))).toThrow(error);
    expect(rows(runtime.snapshot())).toEqual(['DET-012 threw-sync api-use read-pixels 1 exact']);
  });
});

describe('pause, retirement and privacy', () => {
  it('pause: originals still run and return their values; nothing is recorded until resume', () => {
    const { runtime, fakes, fake } = setup();
    deliver(fake, bridgeHello(runtime));
    deliver(fake, bridgeSimple(runtime, 'bridge-pause'));
    const gl = new fakes.GL();
    fakes.behavior.parameter = 4096;
    expect(gl.getParameter(0x0d33)).toBe(4096);
    gl.getExtension('WEBGL_debug_renderer_info');
    gl.readPixels(0, 0, 1, 1, 0x1908, 0x1401, new Uint8Array(4));
    expect(fakes.calls).toHaveLength(3);
    expect(runtime.snapshot().counters).toEqual([]);
    deliver(fake, bridgeSimple(runtime, 'bridge-resume'));
    gl.getParameter(0x0d33);
    expect(rows(runtime.snapshot())).toEqual(['DET-011 returned-sync api-use param-limit 1 exact']);
  });

  it("'retire': the getParameter hook of a prototype retires once after retireAfter calls; the marker carries sample-budget-exceeded", () => {
    const runtime = new SensorRuntime(makeEnv().env);
    runtime.start();
    const fakes = makeFakes();
    const original = Object.getOwnPropertyDescriptor(fakes.GL.prototype, 'getParameter');
    installWebglSensor(runtime, fakes.realm, { ...FAMILY_CONFIG, retireAfter: 3, webglGetParameter: 'retire' });
    const retire = vi.spyOn(runtime, 'retire');
    const gl = new fakes.GL();
    const saved = gl.getParameter;
    gl.getParameter(0x0d33);
    gl.getParameter(0x1f01);
    expect(retire).not.toHaveBeenCalled();
    gl.getParameter(0x9246); // third call: recorded, then retired
    expect(retire).toHaveBeenCalledTimes(1);
    expect(Object.getOwnPropertyDescriptor(fakes.GL.prototype, 'getParameter')!.value).not.toBe(saved);
    expect(Object.getOwnPropertyDescriptor(fakes.GL.prototype, 'getParameter')).toEqual(original);
    for (let i = 0; i < 4; i++) gl.getParameter(0x0d33);
    saved.call(gl, 0x0d33); // a reference saved by the page still calls the original once, without a record
    expect(fakes.calls.filter((c) => c.member === 'getParameter')).toHaveLength(3 + 4 + 1);
    expect(retire).toHaveBeenCalledTimes(1);
    // I1: the retired prototype no longer reports ANY param-* query, so every param-* aggregate is a lower bound, not
    // only the one of the call that reached the limit.
    expect(rows(runtime.snapshot())).toEqual([
      'DET-011 returned-sync api-use param-limit 1 lower-bound',
      'DET-011 returned-sync api-use param-renderer 1 lower-bound',
      'DET-011 returned-sync api-use param-unmasked-renderer 1 lower-bound',
      'DET-011 returned-sync api-use,sample-budget-exceeded - 0 lower-bound',
    ]);
    // The WebGL2 hook has its own budget and is still installed; a param-* aggregate it creates only now is a lower
    // bound as well (WebGL1 queries of that kind went unobserved since the retirement).
    const gl2 = new fakes.GL2!();
    gl2.getParameter(0x0d33);
    gl2.getParameter(0x1f00); // VENDOR: first param-vendor record of the document
    expect(count(runtime.snapshot(), 'DET-011', 'returned-sync', 'param-limit')).toBe(2);
    expect(rows(runtime.snapshot())).toContain('DET-011 returned-sync api-use param-vendor 1 lower-bound');
    // Other DET-011 operations are not affected by the getParameter retirement.
    gl2.getSupportedExtensions();
    expect(rows(runtime.snapshot())).toContain('DET-011 returned-sync api-use supported-extensions 1 exact');
    const stopped = runtime.stop('local');
    expect(stopped).toMatchObject({ notRestored: [], cleanup: 'complete' });
    expect(stopped.restored.filter((label) => label === 'getParameter')).toHaveLength(2); // retired + WebGL2 hook
  });

  it('no renderer string, extension name, pname, precision or pixel reaches the counters or the wire', () => {
    const { fake, runtime, fakes } = setup();
    deliver(fake, bridgeHello(runtime));
    const gl = new fakes.GL();
    fakes.behavior.parameter = RENDERER_CANARY;
    gl.getParameter(0x9246);
    fakes.behavior.supported = [EXTENSION_CANARY];
    gl.getSupportedExtensions();
    gl.getExtension(EXTENSION_CANARY);
    fakes.behavior.precision = { rangeMin: 12345, rangeMax: 23456, precision: 34567 };
    gl.getShaderPrecisionFormat(0x8b30, 0x8df2);
    const pixels = new Uint8Array([201, 202, 203, 204]);
    gl.readPixels(0, 0, 1, 1, 0x1908, 0x1401, pixels);
    fake.advance(BUDGETS.flushMinMs);
    const wire = JSON.stringify(fake.posted);
    const snapshot = JSON.stringify(runtime.snapshot());
    for (const secret of [RENDERER_CANARY, EXTENSION_CANARY, 'CANARY', '37446', '35632', '36338', '12345', '23456', '34567', '201,202', 'Uint8Array']) {
      expect(wire).not.toContain(secret);
      expect(snapshot).not.toContain(secret);
    }
    const observations = fake.batches().flatMap((b) => b.observations);
    expect(observations.map((o) => o.operationCode).sort()).toEqual(['ext-other', 'param-unmasked-renderer', 'read-pixels', 'shader-precision-format', 'supported-extensions']);
  });

  it('an observer exception never reaches the page and only bumps observerErrors', () => {
    const { runtime, fakes } = setup();
    vi.spyOn(runtime, 'recordKey').mockImplementation(() => {
      throw new Error('observer failure');
    });
    fakes.behavior.parameter = 7;
    expect(new fakes.GL().getParameter(0x0d33)).toBe(7);
    expect(runtime.snapshot().observerErrors).toBe(1);
    vi.restoreAllMocks();
  });

  it('handles returned by the installer belong to the runtime cleanup', () => {
    const { sensor, runtime } = setup();
    const first = installed(sensor.results[0]);
    expect(first.isOwned()).toBe(true);
    expect(runtime.stop('local').restored).toHaveLength(10);
    expect(first.isOwned()).toBe(false);
  });
});
