// Canvas readout sensor: DET-001 (export), DET-002 (getImageData), DET-003 (text), DET-004 (OffscreenCanvas in the
// Window realm). Spec III §2.1, §3.4; REQ-001/003/005; ADR-006, ADR-007; task E07-01.
//
// Observations contain the fact/phase only, never pixels, URLs, blobs, text, fonts or metrics.
// ADR-017/018 allow separate automatic ephemeral previews of existing ImageData/PNG results; never observations.
// Argument classification is not needed for this family, so observers do not touch arguments at all.
// State: WeakSets of contexts and canvases on which fillText/strokeText ran; a readback (getImageData, toDataURL, toBlob,
// convertToBlob) on such a canvas carries `readback-after-text`. Context/canvas identity is linked only from
// the original getContext return value, with no supplemental getters, even on early installs (F124/F127).
// P04/F125: successful clearRect/reset and dimension setters disarm history conservatively.
// All original exceptions are reported as `threw-sync`; their properties are never read and they still
// reach the page unchanged. Specific SecurityError/tainted-canvas classification is intentionally omitted.

import { arrayPush, weakSetHas, weakSetAdd, weakSetDelete } from './intrinsics';
import { PHASE_INDEX, SIGNAL_BIT, TECHNIQUE_INDEX } from './codes';
import type { SensorRuntime } from './runtime';
import { wrapMethod, wrapOutcomeMethod, wrapSetter } from './wrap';
import type { MethodObserver, OutcomeObserver, WrapResult } from './wrap';
import { visualCaptureFor } from './visual';

const WeakSetCtor = WeakSet;
const WeakMapCtor = WeakMap;
const weakGet = Function.prototype.call.bind(WeakMap.prototype.get) as (map: WeakMap<object, object>, key: object) => object | undefined;
const weakPut = Function.prototype.call.bind(WeakMap.prototype.set) as (map: WeakMap<object, object>, key: object, value: object) => void;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;

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

/** Interface names looked up on the realm (own data properties only; a page getter is never invoked). */
const CANVAS = 'HTMLCanvasElement';
const CONTEXT_2D = 'CanvasRenderingContext2D';
const OFFSCREEN = 'OffscreenCanvas';
const OFFSCREEN_CONTEXT_2D = 'OffscreenCanvasRenderingContext2D';

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

/**
 * Installs the canvas hooks on `realm` (the window) and registers them with the runtime.
 * Repeated calls in the same module instance return the same handles (wrap.ts registry); a second bundle
 * instance is prevented by the bootstrap guard in hook.main.ts.
 */
export function installCanvasSensor(runtime: SensorRuntime, realm: object = globalThis): CanvasSensor {
  const results: WrapResult[] = [];
  const skipped: string[] = [];
  const options = { context: runtime.hooks };
  const visual = visualCaptureFor(runtime);
  let textDrawn = new WeakSetCtor<object>();
  let textContexts = new WeakSetCtor<object>();
  // Identity links survive clear/resize/pause: native 2D contexts remain attached to the same canvas.
  // They are not text history and contain no page-visible properties or exportable data.
  const canvasContexts = new WeakMapCtor<object, object>();
  const contextCanvases = new WeakMapCtor<object, object>();
  let historyEpoch = runtime.historyEpoch;
  const refreshHistory = (): void => {
    if (historyEpoch === runtime.historyEpoch) return;
    historyEpoch = runtime.historyEpoch;
    textDrawn = new WeakSetCtor<object>();
    textContexts = new WeakSetCtor<object>();
  };

  const selfCanvas = (thisArg: unknown): object | null => (typeof thisArg === 'object' && thisArg !== null ? thisArg : null);
  const linkedCanvas = (context: object): object | undefined => weakGet(contextCanvases, context);
  const contextReturned: MethodObserver = (thisArg, args, threw, _error, result) => {
    if (threw) return;
    const canvas = selfCanvas(thisArg);
    const context = selfCanvas(result);
    if (canvas === null || context === null) return;
    refreshHistory();
    weakPut(canvasContexts, canvas, context);
    weakPut(contextCanvases, context, canvas);
    visual?.context(canvas, context, args[0]);
    if (weakSetHas(textContexts, context)) weakSetAdd(textDrawn, canvas);
  };

  const readback = (technique: number, okPhase: number, tracked: () => WeakSet<object>, preview?: 'imageData' | 'dataUrl'): MethodObserver => {
    return (thisArg, _args, threw, _error, result) => {
      refreshHistory();
      let mask = S_API;
      if (threw) {
        runtime.record(technique, P_THREW, mask);
        return;
      }
      const receiver = selfCanvas(thisArg);
      if (receiver !== null && weakSetHas(tracked(), receiver)) mask |= S_AFTER_TEXT;
      runtime.record(technique, okPhase, mask);
      // ADR-017/018 ephemeral path; raw output never enters observations, reports or exports.
      if (visual && preview) visual[preview](result, thisArg);
    };
  };

  const textDraw: MethodObserver = (thisArg, args, threw) => {
      refreshHistory();
      if (threw) {
        runtime.record(T_TEXT, P_THREW, S_API | S_DRAWN);
        return;
      }
      const context = selfCanvas(thisArg);
      if (context !== null) {
        weakSetAdd(textContexts, context);
        const canvas = linkedCanvas(context);
        if (canvas !== undefined) weakSetAdd(textDrawn, canvas);
      }
      runtime.record(T_TEXT, P_RETURNED, S_API | S_DRAWN);
      visual?.action(thisArg, 'fillText', args);
  };

  const textMeasure: OutcomeObserver = (threw) => {
    runtime.record(T_TEXT, threw ? P_THREW : P_RETURNED, S_API | S_MEASURED);
  };

  const install = (proto: object, key: string, observe: MethodObserver): void => {
    arrayPush(results, wrapMethod(proto, key, observe, options));
  };

  // F125 / REQ-002: disarm on any successful clear, without inspecting/coercing rectangle arguments.
  const installClears = (proto: object): void => {
    const cleared: MethodObserver = (thisArg, _args, threw) => {
      if (threw) return;
      refreshHistory();
      const context = selfCanvas(thisArg);
      if (context === null) return;
      if (visual) visual.action(context, 'clearRect', _args);
      weakSetDelete(textContexts, context);
      const canvas = linkedCanvas(context);
      if (canvas !== undefined) weakSetDelete(textDrawn, canvas);
    };
    // reset is optional on older implementations; its absence is not an installation failure.
    if (getOwnPropertyDescriptor(proto, 'clearRect') !== undefined) install(proto, 'clearRect', cleared);
    if (getOwnPropertyDescriptor(proto, 'reset') !== undefined) install(proto, 'reset', (receiver, args, threw, error, result) => {
      cleared(receiver, args, threw, error, result);
      if (!threw) visual?.reset(receiver);
    });
  };

  // P04: no dimension getters or argument coercion; same-value assignments also reset native canvas.
  const installDimensions = (proto: object): void => {
    const resized: MethodObserver = (thisArg, _args, threw) => {
      if (threw) return;
      const canvas = selfCanvas(thisArg);
      if (canvas === null) return;
      visual?.reset(canvas);
      refreshHistory();
      weakSetDelete(textDrawn, canvas);
      const context = weakGet(canvasContexts, canvas);
      if (context !== undefined) weakSetDelete(textContexts, context);
      // A context created before the hook (or while paused) may be unlinked. Drop its possible history
      // conservatively without inspecting any canvas/context property to discover its owner.
      else textContexts = new WeakSetCtor<object>();
    };
    arrayPush(results, wrapSetter(proto, 'width', resized, options));
    arrayPush(results, wrapSetter(proto, 'height', resized, options));
  };

  const installActivity = (proto: object): void => {
    if (!visual) return;
    for (const key of ['drawImage', 'putImageData', 'fillRect', 'createLinearGradient', 'createRadialGradient', 'createConicGradient',
      'createPattern', 'arc', 'fill', 'stroke', 'rect', 'scale', 'translate', 'rotate', 'transform', 'setTransform', 'resetTransform']) {
      if (getOwnPropertyDescriptor(proto, key) === undefined) continue;
      install(proto, key, (receiver, args, threw) => { if (!threw) visual.action(receiver, key, args); });
    }
    for (const key of ['globalAlpha', 'globalCompositeOperation']) {
      if (getOwnPropertyDescriptor(proto, key) === undefined) continue;
      arrayPush(results, wrapSetter(proto, key, (receiver, args, threw) => { if (!threw) visual.action(receiver, key, args); }, options));
    }
  };

  // DET-001: HTMLCanvasElement export. toBlob takes a callback: the sync call is `attempted`, settlement unobserved.
  const canvasProto = prototypeOf(realm, CANVAS);
  if (canvasProto === null) arrayPush(skipped, CANVAS);
  else {
    installDimensions(canvasProto);
    install(canvasProto, 'getContext', contextReturned);
    if (getOwnPropertyDescriptor(canvasProto, 'transferControlToOffscreen') !== undefined) {
      install(canvasProto, 'transferControlToOffscreen', (receiver, _args, threw, _error, result) => {
        if (!threw) { runtime.addFlag('worker-not-observed'); visual?.offscreen(receiver, result); }
      });
    }
    install(canvasProto, 'toDataURL', readback(T_EXPORT, P_RETURNED, () => textDrawn, 'dataUrl'));
    install(canvasProto, 'toBlob', readback(T_EXPORT, P_ATTEMPTED, () => textDrawn));
  }

  // DET-002 / DET-003: 2D context readback and text.
  const ctxProto = prototypeOf(realm, CONTEXT_2D);
  if (ctxProto === null) arrayPush(skipped, CONTEXT_2D);
  else {
    install(ctxProto, 'getImageData', readback(T_READBACK, P_RETURNED, () => textContexts, 'imageData'));
    arrayPush(results, wrapOutcomeMethod(ctxProto, 'measureText', textMeasure, options));
    install(ctxProto, 'fillText', textDraw);
    install(ctxProto, 'strokeText', textDraw);
    installClears(ctxProto);
    installActivity(ctxProto);
  }

  // DET-004: OffscreenCanvas objects of this realm only. Calls inside workers are not observed
  // (coverage limitation `unsupported-realm`, owned by the collector/SW projection).
  const offscreenProto = prototypeOf(realm, OFFSCREEN);
  if (offscreenProto === null) arrayPush(skipped, OFFSCREEN);
  else {
    installDimensions(offscreenProto);
    install(offscreenProto, 'getContext', contextReturned);
    // The method observer never inspects the return value or attaches Promise handlers.
    install(offscreenProto, 'convertToBlob', readback(T_OFFSCREEN, P_ASYNC, () => textDrawn));
    if (visual && getOwnPropertyDescriptor(offscreenProto, 'transferToImageBitmap') !== undefined) {
      install(offscreenProto, 'transferToImageBitmap', (receiver, _args, threw, _error, result) => { if (!threw) visual.bitmap(receiver, result); });
    }
  }

  const offscreenCtxProto = prototypeOf(realm, OFFSCREEN_CONTEXT_2D);
  if (offscreenCtxProto === null) arrayPush(skipped, OFFSCREEN_CONTEXT_2D);
  else {
    install(offscreenCtxProto, 'getImageData', readback(T_OFFSCREEN, P_RETURNED, () => textContexts, 'imageData'));
    // Text on an offscreen 2D context is the same DET-003 operation family; it also arms readback-after-text.
    arrayPush(results, wrapOutcomeMethod(offscreenCtxProto, 'measureText', textMeasure, options));
    install(offscreenCtxProto, 'fillText', textDraw);
    install(offscreenCtxProto, 'strokeText', textDraw);
    installClears(offscreenCtxProto);
    installActivity(offscreenCtxProto);
  }

  if (visual && getOwnPropertyDescriptor(realm, 'createImageBitmap') !== undefined) {
    install(realm, 'createImageBitmap', (_receiver, args, threw) => { if (!threw) visual.action(args[0], 'createImageBitmap', args); });
  }

  runtime.attach(results);
  return { results, skipped };
}
