// WebGL sensor: DET-011 (parameter, extension and capability queries) and DET-012 (readPixels). Task E07-03, S04;
// spec III §2.1 rows DET-011/012; REQ-001, REQ-002, REQ-003, REQ-005; ADR-006, ADR-017.
//
// Observed: which query the page made (operation code) and the phase of the call. Never read or recorded: returned
// values, the numeric pname, extension names, shader precision formats, pixels or the readPixels buffer.
// Argument classification (ADR-017 §2) uses only `arguments.length`, `typeof` of the first argument and comparisons
// with our own constants:
//   - getParameter: a primitive number -> identity code, `param-limit` (webgl-params.ts) or `param-other`;
//   - getExtension: a primitive string of length 25 equal to 'WEBGL_debug_renderer_info' (ASCII case-insensitive,
//     compared character by character, no String.prototype method) -> `ext-debug-renderer-info`, other strings ->
//     `ext-other`;
//   - anything else (no argument, an object, a String object, a Proxy) -> `*-unclassified`, without coercion and
//     without reading a property of a page object.
// getShaderPrecisionFormat, getSupportedExtensions and readPixels arguments are not touched.
// getParameter follows FAMILY_CONFIG.webglGetParameter (S03 perf-gate): 'wrap' | 'retire' | 'off'.
// WebGL2RenderingContext carries own copies of these members in Chromium (S03 fact), so both prototypes are hooked.
// An absent interface or a member that is not an own property is skipped without a coverage flag; a present but
// non-configurable member is reported by wrapMethod (descriptor-nonconfigurable). Keys are computed at install.

import type { OperationCode, TechniqueId } from '@detect-expert/contracts';
import { API_USE, compositeKey, operationIndex, PHASE_INDEX, signalBit, TECHNIQUE_INDEX } from './codes';
import { FAMILY_CONFIG } from './families';
import type { FamilyConfig } from './families';
import { arrayPush } from './intrinsics';
import { prototypeOf } from './realm';
import type { SensorRuntime } from './runtime';
import { isLimitParam, WEBGL_IDENTITY_PARAMS } from './webgl-params';
import { wrapMethod } from './wrap';
import type { HookHandle, MethodObserver, WrapResult } from './wrap';

const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;

const WEBGL = 'WebGLRenderingContext';
const WEBGL2 = 'WebGL2RenderingContext';
const T_PARAMS: TechniqueId = 'DET-011';
const T_READBACK: TechniqueId = 'DET-012';

const P_VENDOR = WEBGL_IDENTITY_PARAMS.VENDOR;
const P_RENDERER = WEBGL_IDENTITY_PARAMS.RENDERER;
const P_VERSION = WEBGL_IDENTITY_PARAMS.VERSION;
const P_SLV = WEBGL_IDENTITY_PARAMS.SHADING_LANGUAGE_VERSION;
const P_UNMASKED_VENDOR = WEBGL_IDENTITY_PARAMS.UNMASKED_VENDOR_WEBGL;
const P_UNMASKED_RENDERER = WEBGL_IDENTITY_PARAMS.UNMASKED_RENDERER_WEBGL;

// Both spellings of the debug extension name, compared per character (ASCII case-insensitive, like getExtension).
const DEBUG_EXT_LOWER = 'webgl_debug_renderer_info';
const DEBUG_EXT_UPPER = 'WEBGL_DEBUG_RENDERER_INFO';
const DEBUG_EXT_LENGTH = 25;
if (DEBUG_EXT_LOWER.length !== DEBUG_EXT_LENGTH || DEBUG_EXT_UPPER.length !== DEBUG_EXT_LENGTH) {
  throw new Error('webgl: debug extension name tables are inconsistent');
}

/** Primitive string only (the caller checked typeof): `length` and index reads hit the string's own properties. */
function isDebugRendererInfo(name: string): boolean {
  if (name.length !== DEBUG_EXT_LENGTH) return false;
  for (let i = 0; i < DEBUG_EXT_LENGTH; i++) {
    const c = name[i];
    if (c !== DEBUG_EXT_LOWER[i] && c !== DEBUG_EXT_UPPER[i]) return false;
  }
  return true;
}

export interface WebglSensor {
  /** One entry per attempted hook (installed or unsupported), in install order. */
  results: WrapResult[];
  /** Interfaces absent from the realm, or `Interface.member` that is not an own property (not a failure). */
  skipped: string[];
}

interface KeyPair {
  readonly ok: number;
  readonly threw: number;
}

function keyPair(technique: TechniqueId, op: OperationCode): KeyPair {
  const t = TECHNIQUE_INDEX[technique];
  const o = operationIndex(technique, op);
  return { ok: compositeKey(t, PHASE_INDEX['returned-sync'], API_USE, o), threw: compositeKey(t, PHASE_INDEX['threw-sync'], API_USE, o) };
}

/**
 * Installs the WebGL hooks on `realm` (the window) and registers them with the runtime. `config` defaults to the
 * perf-gate decisions (families.ts); tests pass another mode. Repeated calls in the same module instance return
 * the same handles (wrap.ts registry) and add no observer.
 */
export function installWebglSensor(runtime: SensorRuntime, realm: object = globalThis, config: FamilyConfig = FAMILY_CONFIG): WebglSensor {
  const results: WrapResult[] = [];
  const skipped: string[] = [];
  const options = { context: runtime.hooks };
  const mode = config.webglGetParameter;
  const limit = mode === 'retire' ? config.retireAfter : 0;
  // I1: a pure integer check (no call into the live Math object).
  if (mode === 'retire' && !(typeof limit === 'number' && limit >= 1 && limit % 1 === 0)) throw new Error('webgl: retireAfter must be a positive integer');

  // Keys (install time; an undeclared pair throws here and the registry isolates it as hook-failed).
  const K = {
    vendor: keyPair(T_PARAMS, 'param-vendor'),
    renderer: keyPair(T_PARAMS, 'param-renderer'),
    version: keyPair(T_PARAMS, 'param-version'),
    slv: keyPair(T_PARAMS, 'param-shading-language-version'),
    unmaskedVendor: keyPair(T_PARAMS, 'param-unmasked-vendor'),
    unmaskedRenderer: keyPair(T_PARAMS, 'param-unmasked-renderer'),
    limit: keyPair(T_PARAMS, 'param-limit'),
    other: keyPair(T_PARAMS, 'param-other'),
    paramUnclassified: keyPair(T_PARAMS, 'param-unclassified'),
    extDebug: keyPair(T_PARAMS, 'ext-debug-renderer-info'),
    extOther: keyPair(T_PARAMS, 'ext-other'),
    extUnclassified: keyPair(T_PARAMS, 'ext-unclassified'),
    supported: keyPair(T_PARAMS, 'supported-extensions'),
    precision: keyPair(T_PARAMS, 'shader-precision-format'),
    readPixels: keyPair(T_READBACK, 'read-pixels'),
  };
  // I1: a retired getParameter hook no longer observes ANY param-* query on its prototype, so every param-* pair (both
  // phases) turns lower-bound, not only the key of the call that reached the limit. Shared by both prototypes' hooks.
  const paramKeys: readonly number[] = [
    K.vendor.ok, K.vendor.threw, K.renderer.ok, K.renderer.threw, K.version.ok, K.version.threw, K.slv.ok, K.slv.threw,
    K.unmaskedVendor.ok, K.unmaskedVendor.threw, K.unmaskedRenderer.ok, K.unmaskedRenderer.threw, K.limit.ok, K.limit.threw,
    K.other.ok, K.other.threw, K.paramUnclassified.ok, K.paramUnclassified.threw,
  ];
  // Retirement marker: technique-level (no operation), only for the 'retire' mode.
  const markerKey =
    mode === 'retire'
      ? compositeKey(TECHNIQUE_INDEX[T_PARAMS], PHASE_INDEX['returned-sync'], API_USE | signalBit(T_PARAMS, 'sample-budget-exceeded'), 0)
      : -1;

  const classifyParameter = (args: IArguments): KeyPair => {
    if (args.length === 0) return K.paramUnclassified;
    const p: unknown = args[0];
    if (typeof p !== 'number') return K.paramUnclassified;
    switch (p) {
      case P_VENDOR:
        return K.vendor;
      case P_RENDERER:
        return K.renderer;
      case P_VERSION:
        return K.version;
      case P_SLV:
        return K.slv;
      case P_UNMASKED_VENDOR:
        return K.unmaskedVendor;
      case P_UNMASKED_RENDERER:
        return K.unmaskedRenderer;
      default:
        return isLimitParam(p) ? K.limit : K.other;
    }
  };

  const classifyExtension = (args: IArguments): KeyPair => {
    if (args.length === 0) return K.extUnclassified;
    const name: unknown = args[0];
    if (typeof name !== 'string') return K.extUnclassified;
    return isDebugRendererInfo(name) ? K.extDebug : K.extOther;
  };

  const fixed = (pair: KeyPair): MethodObserver => {
    return (_thisArg, _args, threw) => {
      runtime.recordKey(threw ? pair.threw : pair.ok);
    };
  };

  const extension: MethodObserver = (_thisArg, args, threw) => {
    const pair = classifyExtension(args);
    runtime.recordKey(threw ? pair.threw : pair.ok);
  };

  /** getParameter observer; with `limit` > 0 one hook retires once after `limit` observed calls (ADR-017 §5). */
  const parameter = (): { observe: MethodObserver; bind(result: WrapResult): void } => {
    let calls = 0;
    let retired = false;
    let handle: HookHandle | null = null;
    return {
      observe: (_thisArg, args, threw) => {
        if (retired) return;
        const pair = classifyParameter(args);
        const key = threw ? pair.threw : pair.ok;
        runtime.recordKey(key);
        if (limit === 0) return;
        calls++;
        if (calls < limit) return;
        retired = true;
        if (handle !== null) runtime.retire(handle, paramKeys, markerKey);
      },
      bind(result) {
        if (result.status === 'installed') handle = result;
      },
    };
  };

  const installOn = (name: string): void => {
    const proto = prototypeOf(realm, name);
    if (proto === null) {
      arrayPush(skipped, name);
      return;
    }
    const add = (key: string, observe: MethodObserver): WrapResult | null => {
      if (getOwnPropertyDescriptor(proto, key) === undefined) {
        arrayPush(skipped, name + '.' + key);
        return null;
      }
      const result = wrapMethod(proto, key, observe, options);
      arrayPush(results, result);
      return result;
    };
    if (mode !== 'off') {
      const hook = parameter();
      const result = add('getParameter', hook.observe);
      if (result !== null) hook.bind(result);
    }
    add('getExtension', extension);
    add('getSupportedExtensions', fixed(K.supported));
    add('getShaderPrecisionFormat', fixed(K.precision));
    add('readPixels', fixed(K.readPixels));
  };

  try {
    installOn(WEBGL);
    installOn(WEBGL2);
  } finally {
    // A throwing realm lookup must not strand installed hooks outside ownership-checked cleanup (ADR-006 §8).
    runtime.attach(results);
  }
  return { results, skipped };
}
