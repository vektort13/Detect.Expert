// Canvas readout sensor: DET-001 (export), DET-002 (getImageData), DET-003 (text), DET-004 (OffscreenCanvas in the
// Window realm). Spec III §2.1, §3.4; REQ-001/003/005; ADR-006, ADR-007; task E07-01.
//
// Observed: the fact and phase of a call. Never read: pixels, data URLs, blobs, text strings, fonts, metrics.
// Argument classification is not needed for this family, so observers do not touch arguments at all.
// State: WeakSets of contexts and canvases on which fillText/strokeText ran; a readback (getImageData, toDataURL, toBlob,
// convertToBlob) on such a canvas carries `readback-after-text`. A 2D context resolves its canvas through the
// `canvas` getter only on early text draws/clears. Late installs omit supplemental getters (F124/F127).
// P04/F125: successful clearRect/reset and dimension setters disarm history conservatively.
// A SecurityError thrown by the original (tainted canvas) is reported as phase `threw-sync` +
// `tainted-canvas-attempt`; the exception itself still reaches the page unchanged.

import { weakSetHas, weakSetAdd, weakSetDelete } from './intrinsics';
import { PHASE_INDEX, SIGNAL_BIT, TECHNIQUE_INDEX } from './codes';
import type { SensorRuntime } from './runtime';
import { wrapMethod, wrapSetter } from './wrap';
import type { MethodObserver, WrapResult } from './wrap';

const apply = Reflect.apply;
const WeakSetCtor = WeakSet;
const WeakMapCtor = WeakMap;
const weakGet = Function.prototype.call.bind(WeakMap.prototype.get) as (map: WeakMap<object, object>, key: object) => object | undefined;
const weakPut = Function.prototype.call.bind(WeakMap.prototype.set) as (map: WeakMap<object, object>, key: object, value: object) => void;
const weakDelete = Function.prototype.call.bind(WeakMap.prototype.delete) as (map: WeakMap<object, object>, key: object) => void;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const EMPTY_ARGS: readonly unknown[] = Object.freeze([]);

const T_EXPORT = TECHNIQUE_INDEX['DET-001'];
const T_READBACK = TECHNIQUE_INDEX['DET-002'];
const T_TEXT = TECHNIQUE_INDEX['DET-003'];
const T_OFFSCREEN = TECHNIQUE_INDEX['DET-004'];
const P_ATTEMPTED = PHASE_INDEX['attempted'];
const P_RETURNED = PHASE_INDEX['returned-sync'];
const P_THREW = PHASE_INDEX['threw-sync'];
const P_ASYNC = PHASE_INDEX['settlement-unobserved'];
const S_API = SIGNAL_BIT['api-use'];
const S_DRAWN = SIGNAL_BIT['text-drawn'];
const S_MEASURED = SIGNAL_BIT['text-measured'];
const S_AFTER_TEXT = SIGNAL_BIT['readback-after-text'];
const S_TAINTED = SIGNAL_BIT['tainted-canvas-attempt'];

/** Interface names looked up on the realm (own data properties only; a page getter is never invoked). */
const CANVAS = 'HTMLCanvasElement';
const CONTEXT_2D = 'CanvasRenderingContext2D';
const OFFSCREEN = 'OffscreenCanvas';
const OFFSCREEN_CONTEXT_2D = 'OffscreenCanvasRenderingContext2D';
const DOM_EXCEPTION = 'DOMException';

type Getter = (this: unknown) => unknown;

export interface CanvasSensor {
  /** One entry per attempted hook (installed or unsupported), in install order. */
  results: WrapResult[];
  /** Interfaces absent from the realm (nothing to observe; not a failure). */
  skipped: string[];
}

/** `Interface.prototype` read through data descriptors only. */
function prototypeOf(realm: object, name: string): object | null {
  const d = getOwnPropertyDescriptor(realm, name);
  if (d === undefined || !('value' in d) || typeof d.value !== 'function') return null;
  const p = getOwnPropertyDescriptor(d.value, 'prototype');
  if (p === undefined || !('value' in p) || typeof p.value !== 'object' || p.value === null) return null;
  return p.value;
}

function getterOf(proto: object | null, key: string): Getter | null {
  if (proto === null) return null;
  const d = getOwnPropertyDescriptor(proto, key);
  return d !== undefined && typeof d.get === 'function' ? (d.get as Getter) : null;
}

/** Calls a getter captured at install time; a brand-check TypeError (wrong receiver) means "no object". */
function readObject(getter: Getter | null, receiver: unknown): object | null {
  if (getter === null) return null;
  try {
    const v: unknown = apply(getter, receiver, EMPTY_ARGS);
    return typeof v === 'object' && v !== null ? v : null;
  } catch {
    return null;
  }
}

/**
 * Installs the canvas hooks on `realm` (the window) and registers them with the runtime.
 * Repeated calls in the same module instance return the same handles (wrap.ts registry); a second bundle
 * instance is prevented by the bootstrap guard in hook.main.ts.
 */
export function installCanvasSensor(runtime: SensorRuntime, realm: object = globalThis): CanvasSensor {
  const results: WrapResult[] = [];
  const skipped: string[] = [];
  const options = { context: runtime.hooks };
  let textDrawn = new WeakSetCtor<object>();
  let textContexts = new WeakSetCtor<object>();
  let canvasContexts = new WeakMapCtor<object, object>();
  let historyEpoch = runtime.historyEpoch;
  const refreshHistory = (): void => {
    if (historyEpoch === runtime.historyEpoch) return;
    historyEpoch = runtime.historyEpoch;
    textDrawn = new WeakSetCtor<object>();
    textContexts = new WeakSetCtor<object>();
    canvasContexts = new WeakMapCtor<object, object>();
  };
  const supplementalGetters = runtime.earlyCaptureGuaranteed;
  if (!supplementalGetters) runtime.addFlag('hook-failed');

  const domExceptionName = supplementalGetters ? getterOf(prototypeOf(realm, DOM_EXCEPTION), 'name') : null;
  const isSecurityError = (error: unknown): boolean => {
    if (domExceptionName === null || typeof error !== 'object' || error === null) return false;
    try {
      return apply(domExceptionName, error, EMPTY_ARGS) === 'SecurityError';
    } catch {
      return false; // not a DOMException (brand check failed): nothing more is inspected
    }
  };

  const selfCanvas = (thisArg: unknown): object | null => (typeof thisArg === 'object' && thisArg !== null ? thisArg : null);
  const viaGetter =
    (getter: Getter | null) =>
    (thisArg: unknown): object | null =>
      readObject(getter, thisArg);

  const readback = (technique: number, okPhase: number, tracked: () => WeakSet<object>): MethodObserver => {
    return (thisArg, _args, threw, error) => {
      refreshHistory();
      let mask = S_API;
      if (threw) {
        if (isSecurityError(error)) mask |= S_TAINTED;
        runtime.record(technique, P_THREW, mask);
        return;
      }
      const receiver = selfCanvas(thisArg);
      if (receiver !== null && weakSetHas(tracked(), receiver)) mask |= S_AFTER_TEXT;
      runtime.record(technique, okPhase, mask);
    };
  };

  const textDraw = (resolve: (thisArg: unknown) => object | null): MethodObserver => {
    return (thisArg, _args, threw) => {
      refreshHistory();
      if (threw) {
        runtime.record(T_TEXT, P_THREW, S_API | S_DRAWN);
        return;
      }
      const canvas = resolve(thisArg);
      if (canvas !== null) {
        weakSetAdd(textDrawn, canvas);
        if (typeof thisArg === 'object' && thisArg !== null) weakPut(canvasContexts, canvas, thisArg);
      }
      const context = selfCanvas(thisArg);
      if (context !== null) weakSetAdd(textContexts, context);
      runtime.record(T_TEXT, P_RETURNED, S_API | S_DRAWN);
    };
  };

  const textMeasure: MethodObserver = (_thisArg, _args, threw) => {
    runtime.record(T_TEXT, threw ? P_THREW : P_RETURNED, S_API | S_MEASURED);
  };

  const install = (proto: object, key: string, observe: MethodObserver): void => {
    results.push(wrapMethod(proto, key, observe, options));
  };

  // F125 / REQ-002: disarm on any successful clear, without inspecting/coercing rectangle arguments.
  const installClears = (proto: object, resolve: (thisArg: unknown) => object | null): void => {
    const cleared: MethodObserver = (thisArg, _args, threw) => {
      if (threw) return;
      const context = selfCanvas(thisArg);
      if (context !== null) weakSetDelete(textContexts, context);
      const canvas = resolve(thisArg);
      if (canvas !== null) { weakSetDelete(textDrawn, canvas); weakDelete(canvasContexts, canvas); }
    };
    // reset is optional on older implementations; its absence is not an installation failure.
    if (getOwnPropertyDescriptor(proto, 'clearRect') !== undefined) install(proto, 'clearRect', cleared);
    if (getOwnPropertyDescriptor(proto, 'reset') !== undefined) install(proto, 'reset', cleared);
  };

  // P04: no dimension getters or argument coercion; same-value assignments also reset native canvas.
  const installDimensions = (proto: object): void => {
    const resized: MethodObserver = (thisArg, _args, threw) => {
      if (threw) return;
      const canvas = selfCanvas(thisArg);
      if (canvas === null) return;
      weakSetDelete(textDrawn, canvas);
      const context = weakGet(canvasContexts, canvas);
      if (context !== undefined) weakSetDelete(textContexts, context);
      weakDelete(canvasContexts, canvas);
      // Late capture cannot link contexts safely: invalidate all context history conservatively.
      if (!supplementalGetters) textContexts = new WeakSetCtor<object>();
    };
    for (const key of ['width', 'height']) results.push(wrapSetter(proto, key, resized, options));
  };

  // DET-001: HTMLCanvasElement export. toBlob takes a callback: the sync call is `attempted`, settlement unobserved.
  const canvasProto = prototypeOf(realm, CANVAS);
  if (canvasProto === null) skipped.push(CANVAS);
  else {
    installDimensions(canvasProto);
    if (getOwnPropertyDescriptor(canvasProto, 'transferControlToOffscreen') !== undefined) {
      install(canvasProto, 'transferControlToOffscreen', (_thisArg, _args, threw) => {
        if (!threw) runtime.addFlag('worker-not-observed');
      });
    }
    install(canvasProto, 'toDataURL', readback(T_EXPORT, P_RETURNED, () => textDrawn));
    install(canvasProto, 'toBlob', readback(T_EXPORT, P_ATTEMPTED, () => textDrawn));
  }

  // DET-002 / DET-003: 2D context readback and text.
  const ctxProto = prototypeOf(realm, CONTEXT_2D);
  if (ctxProto === null) skipped.push(CONTEXT_2D);
  else {
    const ctxCanvas = viaGetter(supplementalGetters ? getterOf(ctxProto, 'canvas') : null);
    install(ctxProto, 'getImageData', readback(T_READBACK, P_RETURNED, () => textContexts));
    install(ctxProto, 'measureText', textMeasure);
    install(ctxProto, 'fillText', textDraw(ctxCanvas));
    install(ctxProto, 'strokeText', textDraw(ctxCanvas));
    installClears(ctxProto, ctxCanvas);
  }

  // DET-004: OffscreenCanvas objects of this realm only. Calls inside workers are not observed
  // (coverage limitation `unsupported-realm`, owned by the collector/SW projection).
  const offscreenProto = prototypeOf(realm, OFFSCREEN);
  if (offscreenProto === null) skipped.push(OFFSCREEN);
  else {
    installDimensions(offscreenProto);
    // The method observer never inspects the return value or attaches Promise handlers.
    install(offscreenProto, 'convertToBlob', readback(T_OFFSCREEN, P_ASYNC, () => textDrawn));
  }

  const offscreenCtxProto = prototypeOf(realm, OFFSCREEN_CONTEXT_2D);
  if (offscreenCtxProto === null) skipped.push(OFFSCREEN_CONTEXT_2D);
  else {
    const offscreenCanvas = viaGetter(supplementalGetters ? getterOf(offscreenCtxProto, 'canvas') : null);
    install(offscreenCtxProto, 'getImageData', readback(T_OFFSCREEN, P_RETURNED, () => textContexts));
    // Text on an offscreen 2D context is the same DET-003 operation family; it also arms readback-after-text.
    install(offscreenCtxProto, 'measureText', textMeasure);
    install(offscreenCtxProto, 'fillText', textDraw(offscreenCanvas));
    install(offscreenCtxProto, 'strokeText', textDraw(offscreenCanvas));
    installClears(offscreenCtxProto, offscreenCanvas);
  }

  runtime.attach(results);
  return { results, skipped };
}
