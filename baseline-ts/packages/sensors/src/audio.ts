import { API_OPERATION_DEFINITIONS } from '@detect-expert/contracts';
import type { ApiOperation } from '@detect-expert/contracts';
import { API_OPERATION_INDEX, PHASE_INDEX } from './codes';
import { arrayPush } from './intrinsics';
import type { SensorRuntime } from './runtime';
import { wrapConstructor, wrapGetter, wrapResultMethod } from './wrap';
import type { WrapResult } from './wrap';

const descriptor = Object.getOwnPropertyDescriptor;
const own = Function.prototype.call.bind(Object.prototype.hasOwnProperty) as (value: object, key: string) => boolean;
const indexOf = Function.prototype.call.bind(String.prototype.indexOf) as (value: string, search: string) => number;
const slice = Function.prototype.call.bind(String.prototype.slice) as (value: string, start: number, end?: number) => string;

export interface AudioSensor { results: WrapResult[]; skipped: string[] }

function dataObject(owner: object, key: string): object | null {
  const field = descriptor(owner, key);
  if (!field || !own(field, 'value')) return null;
  const value: unknown = field.value;
  return value !== null && (typeof value === 'object' || typeof value === 'function') ? value : null;
}

export function installAudioSensor(runtime: SensorRuntime, realm: object = globalThis): AudioSensor {
  const results: WrapResult[] = [], skipped: string[] = [];
  if (!runtime.hooks.enabled) return { results, skipped };
  const options = { context: runtime.hooks };
  const attach = (result: WrapResult): void => { arrayPush(results, result); runtime.attach([result]); };
  const install = (operation: ApiOperation, name: string, property: string | null, kind: string): void => {
    try {
      const constructor = dataObject(realm, name);
      if (constructor === null) {
        arrayPush(skipped, name);
        const field = descriptor(realm, name);
        if (field && !own(field, 'value')) runtime.addFlag('hook-failed');
        return;
      }
      const operationIndex = API_OPERATION_INDEX[operation];
      const phase = PHASE_INDEX[kind === 'async-call' ? 'settlement-unobserved' : 'returned-sync'];
      if (property === null) {
        attach(wrapConstructor(realm, name, (_args, _newTarget, threw, _error, result) => {
          runtime.recordOperation(operationIndex, threw ? PHASE_INDEX['threw-sync'] : phase);
          runtime.recordResult(operation, threw ? PHASE_INDEX['threw-sync'] : phase, result);
        }, options));
        return;
      }
      const target = dataObject(constructor, 'prototype');
      if (!target || !descriptor(target, property)) { arrayPush(skipped, operation); return; }
      if (kind === 'get') attach(wrapGetter(target, property, (_receiver, threw, _error, result) => {
        runtime.recordOperation(operationIndex, threw ? PHASE_INDEX['threw-sync'] : phase);
        runtime.recordResult(operation, threw ? PHASE_INDEX['threw-sync'] : phase, result);
      }, options));
      else attach(wrapResultMethod(target, property, (threw, result) => {
        runtime.recordOperation(operationIndex, threw ? PHASE_INDEX['threw-sync'] : phase);
        runtime.recordResult(operation, threw ? PHASE_INDEX['threw-sync'] : phase, result);
      }, options));
    } catch { runtime.addFlag('hook-failed'); }
  };
  for (let operationIndex = 0; operationIndex < API_OPERATION_DEFINITIONS.length; operationIndex++) {
    const [operation, , mechanism, kind] = API_OPERATION_DEFINITIONS[operationIndex]!;
    if (mechanism !== 'audio') continue;
    const separator = indexOf(operation, '.');
    install(operation, separator < 0 ? operation : slice(operation, 0, separator), separator < 0 ? null : slice(operation, separator + 1), kind);
  }
  install('AudioContext', 'webkitAudioContext', null, 'construct');
  install('OfflineAudioContext', 'webkitOfflineAudioContext', null, 'construct');
  return { results, skipped };
}