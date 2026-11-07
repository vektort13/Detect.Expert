// DET-011/012/013 / REQ-001/004/005 / ADR-006: passive graphics API facts only.
// This module is opt-in; production entrypoints must enable it only after the graphics acceptance gate.
// No context creation, capability queries, active pixel reads, or Promise handlers.
// ADR-017/018 separately permit ephemeral copies of bounded page-requested readPixels destinations.
import { API_OPERATION_DEFINITIONS, webglResultOperation } from '@detect-expert/contracts';
import { API_OPERATION_INDEX, PHASE_INDEX, SIGNAL_BIT, TECHNIQUE_INDEX } from './codes';
import { arrayPush } from './intrinsics';
import type { SensorRuntime } from './runtime';
import { wrapGetter, wrapMethod, wrapResultMethod } from './wrap';
import type { MethodObserver, WrapResult } from './wrap';
import { visualCaptureFor } from './visual';

const getDescriptor = Object.getOwnPropertyDescriptor;
const hasOwn = Function.prototype.call.bind(Object.prototype.hasOwnProperty) as (object: object, key: string) => boolean;
const T_CAPABILITIES = TECHNIQUE_INDEX['DET-011'];
const T_READBACK = TECHNIQUE_INDEX['DET-012'];
const P_RETURNED = PHASE_INDEX['returned-sync'];
const P_THREW = PHASE_INDEX['threw-sync'];
const P_UNSETTLED = PHASE_INDEX['settlement-unobserved'];
const S_API = SIGNAL_BIT['api-use'];
const stringIndexOf = Function.prototype.call.bind(String.prototype.indexOf) as (value: string, search: string) => number;
const stringSlice = Function.prototype.call.bind(String.prototype.slice) as (value: string, start: number, end?: number) => string;

export interface GraphicsSensor {
  results: WrapResult[];
  /** Missing interfaces/optional properties; absence is not proof that a hook ran. */
  skipped: string[];
}

/** Never invoke a realm's constructor accessor or inspect navigator.gpu/adapter instances. */
function prototypeOf(realm: object, name: string): object | null {
  const descriptor = getDescriptor(realm, name);
  if (!descriptor || !hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') return null;
  const prototype = getDescriptor(descriptor.value, 'prototype');
  return prototype && hasOwn(prototype, 'value') && typeof prototype.value === 'object' && prototype.value !== null
    ? prototype.value as object : null;
}

export function installGraphicsSensor(runtime: SensorRuntime, realm: object = globalThis): GraphicsSensor {
  const results: WrapResult[] = [];
  const skipped: string[] = [];
  // Installation during pause/after stop must not leave newly attached wrappers behind.
  if (!runtime.hooks.enabled) return { results, skipped };
  const options = { context: runtime.hooks };
  const visual = visualCaptureFor(runtime);
  const query = (prefix: string, name: string): MethodObserver => (receiver, args, threw, _error, result) => {
    runtime.record(T_CAPABILITIES, threw ? P_THREW : P_RETURNED, S_API);
    runtime.recordResult(webglResultOperation(prefix, name, args.length > 0 ? args[0] : undefined), threw ? P_THREW : P_RETURNED, result);
    if (!threw) visual?.action(receiver, name, args);
  };
  const readback = (webgl2: boolean): MethodObserver => (receiver, args, threw) => {
    runtime.record(T_READBACK, threw ? P_THREW : P_RETURNED, S_API);
    runtime.recordResult((webgl2 ? 'WebGL2RenderingContext' : 'WebGLRenderingContext') + '.readPixels', threw ? P_THREW : P_RETURNED, undefined);
    if (!threw && visual) visual.readPixels(receiver, args, webgl2);
  };

  for (const name of ['WebGLRenderingContext', 'WebGL2RenderingContext', 'GPU', 'GPUAdapter', 'GPUDevice', 'GPUAdapterInfo', 'GPUSupportedLimits', 'GPUShaderModule']) {
    try {
      const prototype = prototypeOf(realm, name);
      if (prototype === null) { arrayPush(skipped, name); continue; }
      if (name !== 'WebGLRenderingContext' && name !== 'WebGL2RenderingContext') {
        for (let index = 0; index < API_OPERATION_DEFINITIONS.length; index++) {
          const definition = API_OPERATION_DEFINITIONS[index]!;
          if (definition[2] !== 'webgpu') continue;
          const separator = stringIndexOf(definition[0], '.');
          if (stringSlice(definition[0], 0, separator) !== name) continue;
          const key = stringSlice(definition[0], separator + 1);
          if (getDescriptor(prototype, key) === undefined) { arrayPush(skipped, definition[0]); continue; }
          const operation = API_OPERATION_INDEX[definition[0]];
          const returned = definition[3] === 'async-call' ? P_UNSETTLED : P_RETURNED;
          const handle = definition[3] === 'get'
            ? wrapGetter(prototype, key, (_receiver, threw, _error, result) => {
              runtime.recordOperation(operation, threw ? P_THREW : returned);
              runtime.recordResult(definition[0], threw ? P_THREW : returned, result);
            }, options)
            : wrapResultMethod(prototype, key, (threw, result) => {
              runtime.recordOperation(operation, threw ? P_THREW : returned);
              runtime.recordResult(definition[0], threw ? P_THREW : returned, result);
            }, options);
          arrayPush(results, handle); runtime.attach([handle]);
        }
      } else {
        for (const key of ['getParameter', 'getExtension', 'getSupportedExtensions', 'getShaderPrecisionFormat']) {
          arrayPush(results, wrapMethod(prototype, key, query(name, key), options));
        }
        arrayPush(results, wrapMethod(prototype, 'readPixels', readback(name === 'WebGL2RenderingContext'), options));
        if (visual && getDescriptor(prototype, 'pixelStorei')) arrayPush(results, wrapMethod(prototype, 'pixelStorei', (receiver, args, threw) => {
          if (!threw) { visual.pixelStore(receiver, args); visual.action(receiver, 'pixelStorei', args); }
        }, options));
        if (visual) for (const key of ['texImage2D', 'texSubImage2D', 'createShader', 'shaderSource', 'compileShader', 'linkProgram', 'useProgram',
          'drawArrays', 'drawElements', 'clear', 'finish', 'flush', 'beginQuery', 'endQuery', 'getQueryParameter']) {
          if (getDescriptor(prototype, key) === undefined) continue;
          arrayPush(results, wrapMethod(prototype, key, (receiver, args, threw) => { if (!threw) visual.action(receiver, key, args); }, options));
        }
      }
    } catch {
      // Hostile descriptors/Proxy traps are an installation limitation, never an exception into the page.
      runtime.addFlag('hook-failed');
    }
  }
  try {
    const precision = prototypeOf(realm, 'WebGLShaderPrecisionFormat');
    if (precision) for (const key of ['rangeMin', 'rangeMax', 'precision']) {
      if (!getDescriptor(precision, key)) continue;
      arrayPush(results, wrapGetter(precision, key, (_receiver, threw, _error, result) => {
        runtime.record(T_CAPABILITIES, threw ? P_THREW : P_RETURNED, S_API);
        runtime.recordResult('WebGLShaderPrecisionFormat.' + key, threw ? P_THREW : P_RETURNED, result);
      }, options));
    }
  } catch { runtime.addFlag('hook-failed'); }
  runtime.attach(results);
  return { results, skipped };
}
