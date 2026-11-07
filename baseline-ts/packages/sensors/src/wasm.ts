// DET-065 / REQ-001/002/005/011 / ADR-006: passive JavaScript WebAssembly entry points.
// Bytes, imports, options, Responses and Promise settlement are never inspected.
// ADR-036 previews only already-returned primitives, such as validate and grow results, separately.
// A returned call is API use, not proof of validity, successful compilation, or internal execution.
import type { ApiOperation } from '@detect-expert/contracts';
import { API_OPERATION_INDEX, PHASE_INDEX } from './codes';
import { arrayPush } from './intrinsics';
import type { SensorRuntime } from './runtime';
import { wrapConstructor, wrapGetter, wrapResultMethod } from './wrap';
import type { WrapResult } from './wrap';

const descriptor = Object.getOwnPropertyDescriptor;
const own = Function.prototype.call.bind(Object.prototype.hasOwnProperty) as (value: object, key: string) => boolean;
const METHODS = ['compile', 'instantiate', 'compileStreaming', 'instantiateStreaming', 'validate'] as const;
const CONSTRUCTORS = ['Module', 'Instance', 'Memory'] as const;

export interface WebAssemblySensor { results: WrapResult[]; skipped: string[] }

export function installWebAssemblySensor(runtime: SensorRuntime, realm: object = globalThis): WebAssemblySensor {
  const results: WrapResult[] = [], skipped: string[] = [];
  if (!runtime.hooks.enabled) return { results, skipped };
  const attach = (result: WrapResult): void => { arrayPush(results, result); runtime.attach([result]); };
  let namespace: object;
  try {
    const field = descriptor(realm, 'WebAssembly');
    if (!field || !own(field, 'value') || typeof field.value !== 'object' || field.value === null) {
      arrayPush(skipped, 'WebAssembly'); return { results, skipped };
    }
    namespace = field.value as object;
  } catch { runtime.addFlag('hook-failed'); return { results, skipped }; }
  const options = { context: runtime.hooks };
  for (let i = 0; i < METHODS.length; i++) {
    const name = METHODS[i]!;
    try {
      if (!descriptor(namespace, name)) { arrayPush(skipped, 'WebAssembly.' + name); continue; }
      const returned = PHASE_INDEX[name === 'validate' ? 'returned-sync' : 'settlement-unobserved'];
      const operation = API_OPERATION_INDEX[('WebAssembly.' + name) as ApiOperation];
      attach(wrapResultMethod(namespace, name, (threw, result) => {
        runtime.recordOperation(operation, threw ? PHASE_INDEX['threw-sync'] : returned);
        runtime.recordResult('WebAssembly.' + name, threw ? PHASE_INDEX['threw-sync'] : returned, result);
      }, options));
    } catch { runtime.addFlag('hook-failed'); }
  }
  for (let i = 0; i < CONSTRUCTORS.length; i++) {
    const name = CONSTRUCTORS[i]!;
    try {
      if (!descriptor(namespace, name)) { arrayPush(skipped, 'WebAssembly.' + name); continue; }
      const operation = API_OPERATION_INDEX[('WebAssembly.' + name) as ApiOperation];
      attach(wrapConstructor(namespace, name, (_args, _newTarget, threw, _error, result) => {
        runtime.recordOperation(operation, PHASE_INDEX[threw ? 'threw-sync' : 'returned-sync']);
        runtime.recordResult('WebAssembly.' + name, PHASE_INDEX[threw ? 'threw-sync' : 'returned-sync'], result);
      }, options));
    } catch { runtime.addFlag('hook-failed'); }
  }
  try {
    const memory = descriptor(namespace, 'Memory');
    const prototype = memory && own(memory, 'value') && typeof memory.value === 'function' ? descriptor(memory.value, 'prototype') : null;
    if (prototype && own(prototype, 'value') && typeof prototype.value === 'object' && prototype.value !== null) {
      const target = prototype.value as object;
      if (descriptor(target, 'grow')) attach(wrapResultMethod(target, 'grow', (threw, result) => {
        runtime.recordOperation(API_OPERATION_INDEX['WebAssembly.Memory.grow'], PHASE_INDEX[threw ? 'threw-sync' : 'returned-sync']);
        runtime.recordResult('WebAssembly.Memory.grow', PHASE_INDEX[threw ? 'threw-sync' : 'returned-sync'], result);
      }, options));
      else arrayPush(skipped, 'WebAssembly.Memory.grow');
      if (descriptor(target, 'buffer')) attach(wrapGetter(target, 'buffer', (_receiver, threw, _error, result) => {
        runtime.recordOperation(API_OPERATION_INDEX['WebAssembly.Memory.buffer'], PHASE_INDEX[threw ? 'threw-sync' : 'returned-sync']);
        runtime.recordResult('WebAssembly.Memory.buffer', PHASE_INDEX[threw ? 'threw-sync' : 'returned-sync'], result);
      }, options));
      else arrayPush(skipped, 'WebAssembly.Memory.buffer');
    }
  } catch { runtime.addFlag('hook-failed'); }
  return { results, skipped };
}
