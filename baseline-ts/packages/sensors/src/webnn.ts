import { API_OPERATION_DEFINITIONS } from '@detect-expert/contracts';
import { API_OPERATION_INDEX, PHASE_INDEX } from './codes';
import { arrayPush } from './intrinsics';
import type { SensorRuntime } from './runtime';
import { wrapConstructor, wrapGetter, wrapResultMethod } from './wrap';
import type { WrapResult } from './wrap';

const descriptor = Object.getOwnPropertyDescriptor;
const hasOwn = Object.hasOwn;
const SURFACES = API_OPERATION_DEFINITIONS.filter(definition => definition[2] === 'webnn').map(definition => {
  const operation = definition[0];
  const separator = operation.indexOf('.');
  return { operation, kind: definition[3], owner: separator < 0 ? operation : operation.slice(0, separator),
    member: separator < 0 ? operation : operation.slice(separator + 1) };
});

export interface WebNNSensor { results: WrapResult[]; skipped: string[] }

export function installWebNNSensor(runtime: SensorRuntime, realm: object = globalThis): WebNNSensor {
  const results: WrapResult[] = [], skipped: string[] = [];
  if (!runtime.hooks.enabled) return { results, skipped };
  for (let index = 0; index < SURFACES.length; index++) {
    const { owner, member, operation, kind } = SURFACES[index]!;
    try {
      const ordinal = API_OPERATION_INDEX[operation];
      const returned = PHASE_INDEX[kind === 'async-call' ? 'settlement-unobserved' : 'returned-sync'];
      const observe = (threw: boolean, result: unknown): void => {
        const phase = threw ? PHASE_INDEX['threw-sync'] : returned;
        runtime.recordOperation(ordinal, phase);
        runtime.recordResult(operation, phase, result);
      };
      const options = { context: runtime.hooks };
      const field = descriptor(realm, owner);
      if (kind === 'construct') {
        if (!field || !hasOwn(field, 'value') || typeof field.value !== 'function') { arrayPush(skipped, operation); continue; }
        const result = wrapConstructor(realm, owner, (_args, _newTarget, threw, _error, value) => observe(threw, value), options);
        arrayPush(results, result); runtime.attach([result]); continue;
      }
      const prototype = field && hasOwn(field, 'value') && typeof field.value === 'function' ? descriptor(field.value, 'prototype') : null;
      if (!prototype || !hasOwn(prototype, 'value') || typeof prototype.value !== 'object' || prototype.value === null || !descriptor(prototype.value, member)) {
        arrayPush(skipped, operation); continue;
      }
      const result = kind === 'get'
        ? wrapGetter(prototype.value, member, (_receiver, threw, _error, value) => observe(threw, value), options)
        : wrapResultMethod(prototype.value, member, observe, options);
      arrayPush(results, result); runtime.attach([result]);
    } catch { runtime.addFlag('hook-failed'); }
  }
  return { results, skipped };
}