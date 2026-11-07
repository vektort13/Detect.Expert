// Canvas sensor (DET-001..DET-004) on fake canvas interfaces (task E07-01 acceptance 1-7, 10 at unit level).
// The realm is a plain object with the interface constructors as own data properties, like `window`.

import { describe, expect, it } from 'vitest';
import { SensorRuntime, installCanvasSensor } from '../src/index';
import type { RuntimeSnapshot } from '../src/index';
import { bridgeHello, deliver, makeEnv } from './helpers';

const CANARY_TEXT = 'CANARY-TEXT-9f3a1c';
const CANARY_URL = 'data:image/png;base64,CANARYPIXELS7e2b';

interface Fakes {
  realm: Record<string, unknown>;
  calls: Record<string, number>;
  Canvas: new () => FakeCanvasLike;
  Offscreen: new () => FakeOffscreenLike;
  throwOnRead: { error: unknown };
}

interface FakeCanvasLike {
  width: number;
  height: number;
  getContext(kind: string): unknown;
  toDataURL(type?: string): string;
  toBlob(callback: (blob: unknown) => void): void;
}

interface FakeOffscreenLike {
  width: number;
  height: number;
  getContext(kind: string): unknown;
  convertToBlob(): Promise<unknown>;
}

interface Context2DLike {
  canvas: unknown;
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray; width: number; height: number };
  measureText(text: string): { width: number };
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
}

/** Fresh interface classes per test (wrappers mutate prototypes in place). */
function makeFakes(options?: { withOffscreen?: boolean }): Fakes {
  const calls: Record<string, number> = {};
  const hit = (name: string): void => {
    calls[name] = (calls[name] ?? 0) + 1;
  };
  const throwOnRead: { error: unknown } = { error: null };
  const contexts = new WeakMap<object, object>();
  const owners = new WeakMap<object, object>();

  // Like Chrome, the window and offscreen 2D contexts are distinct interfaces with their own prototype methods.
  const contextClass = (): new () => Context2DLike =>
    class implements Context2DLike {
      get canvas(): unknown {
        return owners.get(this);
      }
      getImageData(_x: number, _y: number, w: number, h: number): { data: Uint8ClampedArray; width: number; height: number } {
        hit('getImageData');
        if (throwOnRead.error !== null) throw throwOnRead.error;
        return { data: new Uint8ClampedArray(4), width: w, height: h };
      }
      measureText(text: string): { width: number } {
        hit('measureText');
        return { width: text.length * 7 };
      }
      fillText(_text: string, _x: number, _y: number): void {
        hit('fillText');
      }
      strokeText(_text: string, _x: number, _y: number): void {
        hit('strokeText');
      }
    };
  const FakeContext2D = contextClass();
  const FakeOffscreenContext2D = contextClass();
  class FakeCanvas implements FakeCanvasLike {
    get width(): number { return 300; }
    set width(value: number) { hit('width'); Number(value); if (throwOnRead.error !== null) throw throwOnRead.error; }
    get height(): number { return 150; }
    set height(value: number) { hit('height'); Number(value); if (throwOnRead.error !== null) throw throwOnRead.error; }
    getContext(_kind: string): unknown {
      let ctx = contexts.get(this);
      if (ctx === undefined) {
        ctx = new FakeContext2D();
        contexts.set(this, ctx);
        owners.set(ctx, this);
      }
      return ctx;
    }
    toDataURL(_type?: string): string {
      hit('toDataURL');
      if (throwOnRead.error !== null) throw throwOnRead.error;
      return CANARY_URL;
    }
    toBlob(callback: (blob: unknown) => void): void {
      hit('toBlob');
      if (typeof callback !== 'function') throw new TypeError('callback is not a function');
      if (throwOnRead.error !== null) throw throwOnRead.error;
    }
  }
  class FakeOffscreen implements FakeOffscreenLike {
    get width(): number { return 300; }
    set width(value: number) { hit('width'); Number(value); if (throwOnRead.error !== null) throw throwOnRead.error; }
    get height(): number { return 150; }
    set height(value: number) { hit('height'); Number(value); if (throwOnRead.error !== null) throw throwOnRead.error; }
    getContext(_kind: string): unknown {
      let ctx = contexts.get(this);
      if (ctx === undefined) {
        ctx = new FakeOffscreenContext2D();
        contexts.set(this, ctx);
        owners.set(ctx, this);
      }
      return ctx;
    }
    convertToBlob(): Promise<unknown> {
      hit('convertToBlob');
      return Promise.resolve({ size: 1 });
    }
  }
  const realm: Record<string, unknown> = {
    HTMLCanvasElement: FakeCanvas,
    CanvasRenderingContext2D: FakeContext2D,
    DOMException,
  };
  if (options?.withOffscreen !== false) {
    realm['OffscreenCanvas'] = FakeOffscreen;
    realm['OffscreenCanvasRenderingContext2D'] = FakeOffscreenContext2D;
  }
  return { realm, calls, Canvas: FakeCanvas, Offscreen: FakeOffscreen, throwOnRead };
}

function setup(options?: { withOffscreen?: boolean }) {
  const fake = makeEnv();
  const runtime = new SensorRuntime(fake.env);
  runtime.start();
  const fakes = makeFakes(options);
  const sensor = installCanvasSensor(runtime, fakes.realm);
  return { fake, runtime, fakes, sensor };
}

function counter(snap: RuntimeSnapshot, techniqueId: string, phase: string, signalCodes: string[]) {
  return snap.counters.find(
    (c) => c.techniqueId === techniqueId && c.phase === phase && c.signalCodes.join(',') === [...signalCodes].sort().join(','),
  );
}

describe('installation', () => {
  it('installs all canvas hooks of the realm and skips nothing when OffscreenCanvas exists', () => {
    const { sensor, runtime } = setup();
    expect(sensor.results.map((r) => r.status)).toEqual(Array<string>(15).fill('installed'));
    expect(sensor.results.map((r) => r.label)).toEqual([
      'width', 'height', 'toDataURL', 'toBlob',
      'getImageData', 'measureText', 'fillText', 'strokeText',
      'width', 'height', 'convertToBlob',
      'getImageData', 'measureText', 'fillText', 'strokeText',
    ]);
    expect(sensor.skipped).toEqual([]);
    expect(runtime.snapshot().state).toBe('active');
  });

  it('skips absent interfaces without a failure flag', () => {
    const { sensor, runtime } = setup({ withOffscreen: false });
    expect(sensor.results).toHaveLength(8);
    expect(sensor.skipped).toEqual(['OffscreenCanvas', 'OffscreenCanvasRenderingContext2D']);
    expect(runtime.snapshot().flags).toEqual([]);
  });

  it('a non-configurable method is reported as unsupported with descriptor-nonconfigurable; the rest install', () => {
    const fake = makeEnv();
    const runtime = new SensorRuntime(fake.env);
    const fakes = makeFakes();
    const proto = (fakes.realm['CanvasRenderingContext2D'] as { prototype: object }).prototype;
    const original = Object.getOwnPropertyDescriptor(proto, 'getImageData')!;
    Object.defineProperty(proto, 'getImageData', { ...original, configurable: false });
    const sensor = installCanvasSensor(runtime, fakes.realm);
    const failed = sensor.results.filter((r) => r.status === 'unsupported');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ label: 'getImageData', reason: 'non-configurable', coverageFlag: 'descriptor-nonconfigurable' });
    expect(Object.getOwnPropertyDescriptor(proto, 'getImageData')!.value).toBe(original.value);
    expect(runtime.snapshot().flags).toEqual(['descriptor-nonconfigurable']);
    expect(runtime.snapshot().state).toBe('degraded');
  });

  it('a second install in the same module instance reuses the hooks and does not double count', () => {
    const { runtime, fakes, sensor } = setup();
    const again = installCanvasSensor(runtime, fakes.realm);
    expect(again.results).toEqual(sensor.results);
    const c = new fakes.Canvas();
    (c.getContext('2d') as Context2DLike).getImageData(0, 0, 1, 1);
    expect(fakes.calls['getImageData']).toBe(1);
    expect(counter(runtime.snapshot(), 'DET-002', 'returned-sync', ['api-use'])?.count).toBe(1);
  });
});

describe('DET-001..DET-003: readback after text', () => {
  it('getImageData after fillText on the same canvas carries readback-after-text; other canvases do not', () => {
    const { runtime, fakes } = setup();
    const a = new fakes.Canvas();
    const b = new fakes.Canvas();
    const ctxA = a.getContext('2d') as Context2DLike;
    const ctxB = b.getContext('2d') as Context2DLike;
    ctxA.fillText(CANARY_TEXT, 1, 2);
    ctxA.getImageData(0, 0, 4, 4);
    ctxB.getImageData(0, 0, 4, 4);
    ctxA.getImageData(0, 0, 4, 4);
    const snap = runtime.snapshot();
    expect(counter(snap, 'DET-003', 'returned-sync', ['api-use', 'text-drawn'])?.count).toBe(1);
    expect(counter(snap, 'DET-002', 'returned-sync', ['api-use', 'readback-after-text'])?.count).toBe(2);
    expect(counter(snap, 'DET-002', 'returned-sync', ['api-use'])?.count).toBe(1);
    expect(fakes.calls['fillText']).toBe(1);
    expect(fakes.calls['getImageData']).toBe(3);
  });

  it('strokeText arms the flag too; toDataURL/toBlob after text are readback-after-text, before text api-use', () => {
    const { runtime, fakes } = setup();
    const c = new fakes.Canvas();
    expect(c.toDataURL('image/png')).toBe(CANARY_URL);
    (c.getContext('2d') as Context2DLike).strokeText(CANARY_TEXT, 0, 0);
    expect(c.toDataURL()).toBe(CANARY_URL);
    let blobCallbackArg: unknown = 'untouched';
    c.toBlob((blob) => (blobCallbackArg = blob));
    const snap = runtime.snapshot();
    expect(counter(snap, 'DET-001', 'returned-sync', ['api-use'])?.count).toBe(1);
    expect(counter(snap, 'DET-001', 'returned-sync', ['api-use', 'readback-after-text'])?.count).toBe(1);
    expect(counter(snap, 'DET-001', 'attempted', ['api-use', 'readback-after-text'])?.count).toBe(1);
    expect(blobCallbackArg).toBe('untouched'); // the callback is never wrapped or invoked by us
  });

  it('measureText is DET-003 returned-sync and does not arm readback-after-text', () => {
    const { runtime, fakes } = setup();
    const c = new fakes.Canvas();
    const ctx = c.getContext('2d') as Context2DLike;
    expect(ctx.measureText(CANARY_TEXT).width).toBe(CANARY_TEXT.length * 7);
    ctx.getImageData(0, 0, 1, 1);
    const snap = runtime.snapshot();
    expect(counter(snap, 'DET-003', 'returned-sync', ['api-use', 'text-measured'])?.count).toBe(1);
    expect(counter(snap, 'DET-002', 'returned-sync', ['api-use'])?.count).toBe(1);
    expect(counter(snap, 'DET-002', 'returned-sync', ['api-use', 'readback-after-text'])).toBeUndefined();
  });

  it('resolves the canvas through the getter captured at install, not a live property read', () => {
    const { runtime, fakes } = setup();
    const c = new fakes.Canvas();
    const ctx = c.getContext('2d') as Context2DLike;
    ctx.fillText('x', 0, 0);
    const proto = (fakes.realm['CanvasRenderingContext2D'] as { prototype: object }).prototype;
    let pageGetterCalls = 0;
    Object.defineProperty(proto, 'canvas', {
      get(): unknown {
        pageGetterCalls++;
        throw new Error('page replaced the getter');
      },
      configurable: true,
    });
    ctx.getImageData(0, 0, 1, 1);
    expect(pageGetterCalls).toBe(0);
    expect(counter(runtime.snapshot(), 'DET-002', 'returned-sync', ['api-use', 'readback-after-text'])?.count).toBe(1);
  });
});

describe('exceptions', () => {
  it('tainted canvas: SecurityError propagates unchanged and is counted as threw-sync + tainted-canvas-attempt', () => {
    const { runtime, fakes } = setup();
    const c = new fakes.Canvas();
    const ctx = c.getContext('2d') as Context2DLike;
    const err = new DOMException('The canvas has been tainted by cross-origin data.', 'SecurityError');
    fakes.throwOnRead.error = err;
    let caught: unknown = null;
    try {
      ctx.getImageData(0, 0, 1, 1);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(err);
    let caught2: unknown = null;
    try {
      c.toDataURL();
    } catch (e) {
      caught2 = e;
    }
    expect(caught2).toBe(err);
    const snap = runtime.snapshot();
    expect(counter(snap, 'DET-002', 'threw-sync', ['api-use', 'tainted-canvas-attempt'])?.count).toBe(1);
    expect(counter(snap, 'DET-001', 'threw-sync', ['api-use', 'tainted-canvas-attempt'])?.count).toBe(1);
    expect(fakes.calls['getImageData']).toBe(1);
  });

  it('other exceptions (TypeError, IndexSizeError, non-DOMException, hostile objects) are threw-sync only', () => {
    const { runtime, fakes } = setup();
    const c = new fakes.Canvas();
    const ctx = c.getContext('2d') as Context2DLike;
    const thrown: unknown[] = [
      new TypeError('bad arguments'),
      new DOMException('index', 'IndexSizeError'),
      { name: 'SecurityError' }, // a plain object claiming to be a SecurityError: not a DOMException
      new Proxy({}, { get: () => 'SecurityError' }),
    ];
    for (const err of thrown) {
      fakes.throwOnRead.error = err;
      let caught: unknown = null;
      try {
        ctx.getImageData(0, 0, 1, 1);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBe(err);
    }
    let caughtType: unknown = null;
    try {
      (c.toBlob as unknown as (cb: unknown) => void)('not a function');
    } catch (e) {
      caughtType = e;
    }
    expect(caughtType).toBeInstanceOf(TypeError);
    const snap = runtime.snapshot();
    expect(counter(snap, 'DET-002', 'threw-sync', ['api-use'])?.count).toBe(4);
    expect(counter(snap, 'DET-001', 'threw-sync', ['api-use'])?.count).toBe(1);
    expect(counter(snap, 'DET-002', 'threw-sync', ['api-use', 'tainted-canvas-attempt'])).toBeUndefined();
    expect(snap.observerErrors).toBe(0);
  });
});

describe('DET-004: OffscreenCanvas in the window realm', () => {
  it('transfer marks only the coverage gap after success, preserving the return and original throw', () => {
    const fake = makeEnv();
    const runtime = new SensorRuntime(fake.env);
    const fakes = makeFakes();
    const result = new fakes.Offscreen();
    const error = new Error('transfer failed');
    let fail = true;
    Object.defineProperty(fakes.Canvas.prototype, 'transferControlToOffscreen', {
      configurable: true, value() { if (fail) throw error; return result; },
    });
    installCanvasSensor(runtime, fakes.realm);
    const canvas = new fakes.Canvas() as FakeCanvasLike & { transferControlToOffscreen(): unknown };
    expect(() => canvas.transferControlToOffscreen()).toThrow(error);
    expect(runtime.snapshot().flags).not.toContain('worker-not-observed');
    fail = false;
    expect(canvas.transferControlToOffscreen()).toBe(result);
    expect(runtime.snapshot().flags).toContain('worker-not-observed');
    expect(runtime.snapshot().counters).toEqual([]);
  });

  it('returns the original Promise without touching handlers or its property chain', () => {
    const fake = makeEnv();
    const runtime = new SensorRuntime(fake.env);
    const fakes = makeFakes();
    let handlers = 0;
    const promise = Promise.resolve({ size: 1 });
    Object.defineProperties(promise, {
      then: { get() { handlers++; throw new Error('then inspected'); } },
      catch: { get() { handlers++; throw new Error('catch inspected'); } },
    });
    const before = Object.getOwnPropertyDescriptors(promise);
    const chain = Object.getPrototypeOf(promise);
    let calls = 0;
    Object.defineProperty(fakes.Offscreen.prototype, 'convertToBlob', {
      configurable: true, value() { calls++; return promise; },
    });
    installCanvasSensor(runtime, fakes.realm);
    expect(new fakes.Offscreen().convertToBlob()).toBe(promise);
    expect(Object.getOwnPropertyDescriptors(promise)).toEqual(before);
    expect(Object.getPrototypeOf(promise)).toBe(chain);
    expect(handlers).toBe(0);
    expect(calls).toBe(1);
    expect(counter(runtime.snapshot(), 'DET-004', 'settlement-unobserved', ['api-use'])?.count).toBe(1);
  });

  it('convertToBlob is settlement-unobserved with the same Promise; offscreen getImageData after text is readback-after-text', async () => {
    const { runtime, fakes } = setup();
    const off = new fakes.Offscreen();
    const p = off.convertToBlob();
    expect(p).toBeInstanceOf(Promise);
    await expect(p).resolves.toEqual({ size: 1 });
    const ctx = off.getContext('2d') as Context2DLike;
    ctx.fillText(CANARY_TEXT, 0, 0);
    ctx.getImageData(0, 0, 1, 1);
    const p2 = off.convertToBlob();
    await p2;
    const snap = runtime.snapshot();
    expect(counter(snap, 'DET-004', 'settlement-unobserved', ['api-use'])?.count).toBe(1);
    expect(counter(snap, 'DET-004', 'settlement-unobserved', ['api-use', 'readback-after-text'])?.count).toBe(1);
    expect(counter(snap, 'DET-004', 'returned-sync', ['api-use', 'readback-after-text'])?.count).toBe(1);
    expect(counter(snap, 'DET-003', 'returned-sync', ['api-use', 'text-drawn'])?.count).toBe(1);
    expect(fakes.calls['convertToBlob']).toBe(2);
  });
});

describe('privacy (REQ-005)', () => {
  it('no text, data URL or pixel data reaches the counters or the wire', () => {
    const { fake, runtime, fakes } = setup();
    const c = new fakes.Canvas();
    const ctx = c.getContext('2d') as Context2DLike;
    ctx.fillText(CANARY_TEXT, 0, 0);
    ctx.measureText(CANARY_TEXT);
    ctx.getImageData(0, 0, 2, 2);
    c.toDataURL();
    deliver(fake, bridgeHello(runtime));
    const wire = JSON.stringify(fake.posted);
    const snapshot = JSON.stringify(runtime.snapshot());
    for (const secret of [CANARY_TEXT, CANARY_URL, 'CANARY', 'Uint8ClampedArray', 'width']) {
      expect(wire).not.toContain(secret);
      expect(snapshot).not.toContain(secret);
    }
    const batch = fake.batches()[0]!;
    expect(batch.observations.length).toBeGreaterThan(0);
    for (const o of batch.observations) {
      expect(Object.keys(o).sort()).toEqual(['count', 'countQuality', 'intervalBucket', 'phase', 'signalCodes', 'techniqueId']);
    }
  });
});

describe('F124/F125/F127: conservative text association', () => {
  it('late resize invalidation never invokes a subsequently replaced WeakSet constructor', () => {
    const fake = makeEnv({ startedLate: true });
    const runtime = new SensorRuntime(fake.env);
    const fakes = makeFakes();
    installCanvasSensor(runtime, fakes.realm);
    const canvas = new fakes.Canvas();
    const ctx = canvas.getContext('2d') as Context2DLike;
    ctx.fillText(CANARY_TEXT, 0, 0);
    const original = globalThis.WeakSet;
    let calls = 0;
    try {
      globalThis.WeakSet = new Proxy(original, { construct() { calls++; throw new Error('page constructor'); } });
      canvas.width = 32;
      ctx.getImageData(0, 0, 1, 1);
    } finally { globalThis.WeakSet = original; }
    expect(calls).toBe(0);
    expect(runtime.snapshot().observerErrors).toBe(0);
    expect(counter(runtime.snapshot(), 'DET-002', 'returned-sync', ['api-use'])?.count).toBe(1);
  });

  it('history cannot cross a pause even when mutation and drawing occur while observers are disabled', () => {
    const { runtime, fakes } = setup();
    const canvas = new fakes.Canvas();
    const ctx = canvas.getContext('2d') as Context2DLike;
    ctx.fillText(CANARY_TEXT, 0, 0);
    runtime.pause();
    canvas.width = 32;
    ctx.fillText(CANARY_TEXT, 0, 0);
    runtime.resume();
    ctx.getImageData(0, 0, 1, 1);
    canvas.toDataURL();
    ctx.fillText(CANARY_TEXT, 0, 0);
    ctx.getImageData(0, 0, 1, 1);
    expect(counter(runtime.snapshot(), 'DET-002', 'returned-sync', ['api-use'])?.count).toBe(1);
    expect(counter(runtime.snapshot(), 'DET-001', 'returned-sync', ['api-use'])?.count).toBe(1);
    expect(counter(runtime.snapshot(), 'DET-002', 'returned-sync', ['api-use', 'readback-after-text'])?.count).toBe(1);
    expect(counter(runtime.snapshot(), 'DET-003', 'returned-sync', ['api-use', 'text-drawn'])?.count).toBe(2);
  });

  for (const kind of ['Canvas', 'Offscreen'] as const) {
    it.each(['width', 'height'] as const)(kind + ' %s resets only its own history, including same-value writes; new text rearms', (key) => {
      const { runtime, fakes } = setup();
      const a = new fakes[kind]();
      const b = new fakes[kind]();
      const ca = a.getContext('2d') as Context2DLike;
      const cb = b.getContext('2d') as Context2DLike;
      ca.fillText(CANARY_TEXT, 0, 0);
      cb.strokeText(CANARY_TEXT, 0, 0);
      a[key] = a[key];
      ca.getImageData(0, 0, 1, 1);
      cb.getImageData(0, 0, 1, 1);
      if ('toDataURL' in a) a.toDataURL(); else void a.convertToBlob();
      ca.fillText(CANARY_TEXT, 0, 0);
      ca.getImageData(0, 0, 1, 1);
      a[key] = 10;
      ca.getImageData(0, 0, 1, 1);
      const id = kind === 'Canvas' ? 'DET-002' : 'DET-004';
      expect(counter(runtime.snapshot(), id, 'returned-sync', ['api-use'])?.count).toBe(2);
      expect(counter(runtime.snapshot(), id, 'returned-sync', ['api-use', 'readback-after-text'])?.count).toBe(2);
      const exportId = kind === 'Canvas' ? 'DET-001' : 'DET-004';
      const phase = kind === 'Canvas' ? 'returned-sync' : 'settlement-unobserved';
      expect(counter(runtime.snapshot(), exportId, phase, ['api-use'])?.count).toBe(1);
      expect(fakes.calls[key]).toBe(2);
    });

    it.each(['width', 'height'] as const)(kind + ' %s preserves throws and coerces only in the original setter', (key) => {
      const { runtime, fakes } = setup();
      const canvas = new fakes[kind]();
      const ctx = canvas.getContext('2d') as Context2DLike;
      ctx.fillText(CANARY_TEXT, 0, 0);
      const error = new Error('setter failed');
      fakes.throwOnRead.error = error;
      let coercions = 0;
      const value = { valueOf() { coercions++; return 10; } } as unknown as number;
      expect(() => { canvas[key] = value; }).toThrow(error);
      fakes.throwOnRead.error = null;
      ctx.getImageData(0, 0, 1, 1);
      canvas[key] = value;
      ctx.getImageData(0, 0, 1, 1);
      expect(coercions).toBe(2);
      expect(fakes.calls[key]).toBe(2);
      const id = kind === 'Canvas' ? 'DET-002' : 'DET-004';
      expect(counter(runtime.snapshot(), id, 'returned-sync', ['api-use', 'readback-after-text'])?.count).toBe(1);
      expect(counter(runtime.snapshot(), id, 'returned-sync', ['api-use'])?.count).toBe(1);
    });

    it.each(['clearRect', 'reset'])(kind + ' %s clears history and permits rearming', (method) => {
      const fake = makeEnv();
      const runtime = new SensorRuntime(fake.env);
      const fakes = makeFakes();
      const name = kind === 'Canvas' ? 'CanvasRenderingContext2D' : 'OffscreenCanvasRenderingContext2D';
      const proto = (fakes.realm[name] as { prototype: object }).prototype;
      Object.defineProperty(proto, method, { configurable: true, value() {} });
      installCanvasSensor(runtime, fakes.realm);
      const canvas = new fakes[kind]();
      const ctx = canvas.getContext('2d') as Context2DLike & Record<string, (...args: number[]) => void>;
      ctx.fillText(CANARY_TEXT, 0, 0);
      ctx[method]!(0, 0, canvas.width, canvas.height);
      ctx.getImageData(0, 0, 1, 1);
      if ('toDataURL' in canvas) canvas.toDataURL(); else void canvas.convertToBlob();
      ctx.strokeText(CANARY_TEXT, 0, 0);
      ctx.getImageData(0, 0, 1, 1);
      const id = kind === 'Canvas' ? 'DET-002' : 'DET-004';
      expect(counter(runtime.snapshot(), id, 'returned-sync', ['api-use'])?.count).toBe(1);
      expect(counter(runtime.snapshot(), id, 'returned-sync', ['api-use', 'readback-after-text'])?.count).toBe(1);
    });

    it.each(['width', 'height'] as const)(kind + ' frozen %s reports a coverage gap without changing the descriptor', (key) => {
      const fake = makeEnv();
      const runtime = new SensorRuntime(fake.env);
      const fakes = makeFakes();
      const proto = fakes[kind].prototype;
      Object.defineProperty(proto, key, { configurable: false });
      const before = Object.getOwnPropertyDescriptor(proto, key);
      installCanvasSensor(runtime, fakes.realm);
      expect(Object.getOwnPropertyDescriptor(proto, key)).toEqual(before);
      expect(runtime.snapshot().flags).toContain('descriptor-nonconfigurable');
    });
  }

  it('late install never calls preinstalled canvas/DOMException getters, preserving counts and exceptions', () => {
    const fake = makeEnv({ startedLate: true });
    const runtime = new SensorRuntime(fake.env);
    const fakes = makeFakes();
    let getters = 0;
    const proto = (fakes.realm['CanvasRenderingContext2D'] as { prototype: object }).prototype;
    Object.defineProperty(proto, 'canvas', { configurable: true, get() { getters++; throw new Error('page getter'); } });
    class PageException { get name() { getters++; return 'SecurityError'; } }
    fakes.realm['DOMException'] = PageException;
    installCanvasSensor(runtime, fakes.realm);
    const canvas = new fakes.Canvas();
    const ctx = canvas.getContext('2d') as Context2DLike;
    ctx.fillText('label', 0, 0);
    ctx.getImageData(0, 0, 1, 1);
    canvas.toDataURL();
    const error = new PageException();
    fakes.throwOnRead.error = error;
    let caught: unknown;
    try { ctx.getImageData(0, 0, 1, 1); } catch (e) { caught = e; }
    expect(caught).toBe(error);
    expect(getters).toBe(0);
    const snap = runtime.snapshot();
    expect(snap.flags).toContain('hook-failed');
    expect(snap.observerErrors).toBe(0);
    expect(counter(snap, 'DET-002', 'threw-sync', ['api-use'])?.count).toBe(1);
    expect(counter(snap, 'DET-002', 'returned-sync', ['api-use', 'readback-after-text'])?.count).toBe(1);
    expect(counter(snap, 'DET-001', 'returned-sync', ['api-use'])?.count).toBe(1);
  });

  it('W2 (F045/F046): late install never runs an inherited numeric setter or a patched array iterator; every handle is kept', () => {
    const fake = makeEnv({ startedLate: true });
    const runtime = new SensorRuntime(fake.env);
    const fakes = makeFakes();
    const iteratorProto = Object.getPrototypeOf([][Symbol.iterator]()) as { next: (...args: unknown[]) => unknown };
    const nativeNext = iteratorProto.next;
    const priorZero = Object.getOwnPropertyDescriptor(Array.prototype, '0');
    const priorOne = Object.getOwnPropertyDescriptor(Array.prototype, '1');
    let calls = 0;
    let sensor: ReturnType<typeof installCanvasSensor> | undefined;
    let escaped: unknown;
    try {
      // Page code planted before the activeTab late injection: a numeric setter and a patched array iterator.
      Object.defineProperty(Array.prototype, '0', { configurable: true, set() { calls++; } });
      Object.defineProperty(Array.prototype, '1', { configurable: true, set() { calls++; } });
      iteratorProto.next = function (this: unknown, ...args: unknown[]): unknown { calls++; return Reflect.apply(nativeNext, this, args); };
      sensor = installCanvasSensor(runtime, fakes.realm);
    } catch (error) { escaped = error; }
    finally {
      iteratorProto.next = nativeNext;
      Reflect.deleteProperty(Array.prototype, '0');
      Reflect.deleteProperty(Array.prototype, '1');
      if (priorZero !== undefined) Object.defineProperty(Array.prototype, '0', priorZero);
      if (priorOne !== undefined) Object.defineProperty(Array.prototype, '1', priorOne);
    }
    expect(escaped).toBeUndefined();
    expect(calls).toBe(0);
    // The handles are own slots of `results` (registered for ownership-checked stop), not swallowed by a setter.
    expect(sensor!.results).toHaveLength(15);
    expect(Object.getOwnPropertyDescriptor(sensor!.results, '0')?.value).toMatchObject({ status: 'installed', label: 'width' });
    expect(sensor!.results.every((r) => r.status === 'installed')).toBe(true);
    // The wrappers carry the copied name/length (copyFunctionMeta ran without the iterator).
    const toDataURL = Object.getOwnPropertyDescriptor(fakes.Canvas.prototype, 'toDataURL')!.value as { name: string };
    expect(toDataURL.name).toBe('toDataURL');
    new fakes.Canvas().toDataURL();
    expect(counter(runtime.snapshot(), 'DET-001', 'returned-sync', ['api-use'])?.count).toBe(1);
    runtime.stop('local');
    expect(Object.getOwnPropertyDescriptor(fakes.Canvas.prototype, 'toDataURL')!.value).not.toBe(toDataURL);
  });

  it.each(['clearRect', 'reset'])('successful %s disarms context and canvas without coercing arguments; a throw retains state', (method) => {
    const fake = makeEnv();
    const runtime = new SensorRuntime(fake.env);
    const fakes = makeFakes();
    const proto = (fakes.realm['CanvasRenderingContext2D'] as { prototype: object }).prototype;
    let shouldThrow = true;
    const error = new Error('original clear error');
    Object.defineProperty(proto, method, { configurable: true, value() { if (shouldThrow) throw error; } });
    installCanvasSensor(runtime, fakes.realm);
    const canvas = new fakes.Canvas();
    const ctx = canvas.getContext('2d') as Context2DLike & Record<string, (...args: unknown[]) => void>;
    ctx.fillText('label', 0, 0);
    expect(() => ctx[method]!()).toThrow(error);
    ctx.getImageData(0, 0, 1, 1);
    shouldThrow = false;
    let coercions = 0;
    ctx[method]!({ valueOf() { coercions++; return 0; } });
    ctx.getImageData(0, 0, 1, 1);
    canvas.toDataURL();
    expect(coercions).toBe(0);
    const snap = runtime.snapshot();
    expect(counter(snap, 'DET-002', 'returned-sync', ['api-use', 'readback-after-text'])?.count).toBe(1);
    expect(counter(snap, 'DET-002', 'returned-sync', ['api-use'])?.count).toBe(1);
    expect(counter(snap, 'DET-001', 'returned-sync', ['api-use'])?.count).toBe(1);
  });

  it('F046: WeakSet prototype replacements receive no observer calls or tracked objects', () => {
    const { runtime, fakes } = setup();
    const ctx = new fakes.Canvas().getContext('2d') as Context2DLike;
    const has = WeakSet.prototype.has;
    const add = WeakSet.prototype.add;
    let calls = 0;
    let caught: unknown;
    try {
      WeakSet.prototype.has = () => { calls++; throw new Error('page has'); };
      WeakSet.prototype.add = () => { calls++; throw new Error('page add'); };
      ctx.fillText('label', 0, 0);
      ctx.getImageData(0, 0, 1, 1);
    } catch (error) { caught = error; }
    finally { WeakSet.prototype.has = has; WeakSet.prototype.add = add; }
    expect(caught).toBeUndefined();
    expect(calls).toBe(0);
    expect(runtime.snapshot().observerErrors).toBe(0);
    expect(counter(runtime.snapshot(), 'DET-002', 'returned-sync', ['api-use', 'readback-after-text'])?.count).toBe(1);
  });
});
