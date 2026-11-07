// DET-043 / REQ-001/002/005/011 / ADR-006: passive movement subscriptions and pointer-coordinate API reads.
// No event listeners are installed here. Callback properties/options/events/coordinate values are never read.
// Registration calls are not a count of installed listeners: duplicates/aborted subscriptions can return normally.
import { API_OPERATION_INDEX, PHASE_INDEX, TECHNIQUE_INDEX, signalMaskOf } from './codes';
import { arrayPush } from './intrinsics';
import type { SensorRuntime } from './runtime';
import { screenEventOperation } from './screen-events';
import { wrapGetter, wrapMethod, wrapSetter } from './wrap';
import type { WrapResult } from './wrap';

const descriptor = Object.getOwnPropertyDescriptor;
const own = Function.prototype.call.bind(Object.prototype.hasOwnProperty) as (value: object, key: string) => boolean;
const TECHNIQUE = TECHNIQUE_INDEX['DET-043'];
const RETURNED = PHASE_INDEX['returned-sync'];
const THREW = PHASE_INDEX['threw-sync'];
const LISTENER_USE = signalMaskOf(['api-use', 'movement-listener']);
const COORDINATE_READ = signalMaskOf(['api-use', 'pointer-coordinate-read']);

export interface InteractionSensor { results: WrapResult[]; skipped: string[] }

function dataObject(target: object, key: string): object | null {
  const field = descriptor(target, key);
  if (!field || !own(field, 'value')) return null;
  const value: unknown = field.value;
  return (typeof value === 'object' && value !== null) || typeof value === 'function' ? value : null;
}

export function installInteractionSensor(runtime: SensorRuntime, realm: object = globalThis): InteractionSensor {
  const results: WrapResult[] = [], skipped: string[] = [];
  if (!runtime.hooks.enabled) return { results, skipped };
  const options = { context: runtime.hooks };
  const attach = (result: WrapResult): void => {
    arrayPush(results, result);
    runtime.attach([result]);
  };
  const prototype = (name: string): object | null => {
    const constructor = dataObject(realm, name);
    if (!constructor) {
      arrayPush(skipped, name);
      const field = descriptor(realm, name);
      if (field && !own(field, 'value')) runtime.addFlag('hook-failed');
      return null;
    }
    return dataObject(constructor, 'prototype');
  };
  try {
    const target = prototype('EventTarget');
    if (target) attach(wrapMethod(target, 'addEventListener', (receiver, args, threw) => {
      if (args.length < 2) return;
      // Type/identity checks cannot invoke page code. Native conversion remains native.
      const type: unknown = args[0];
      if (typeof type === 'string' && (type === 'mousemove' || type === 'pointermove' || type === 'pointerrawupdate')) {
        const callback: unknown = args[1];
        if (typeof callback === 'function' || (typeof callback === 'object' && callback !== null)) {
          runtime.record(TECHNIQUE, threw ? THREW : RETURNED, LISTENER_USE);
        }
      }
      if (type === 'change' || type === 'screenschange' || type === 'currentscreenchange') {
        const callback: unknown = args[1];
        if (typeof callback === 'function' || (typeof callback === 'object' && callback !== null)) {
          const operation = screenEventOperation(runtime, receiver, type, true);
          if (operation !== null) runtime.recordOperation(API_OPERATION_INDEX[operation], threw ? THREW : RETURNED);
        }
      }
    }, options));
    if (target && (dataObject(realm, 'Screen') || dataObject(realm, 'ScreenDetails'))) {
      if (descriptor(target, 'removeEventListener')) attach(wrapMethod(target, 'removeEventListener', (receiver, args, threw) => {
        if (args.length < 2) return;
        const type: unknown = args[0];
        if (type !== 'change' && type !== 'screenschange' && type !== 'currentscreenchange') return;
        const callback: unknown = args[1];
        if (typeof callback !== 'function' && (typeof callback !== 'object' || callback === null)) return;
        const operation = screenEventOperation(runtime, receiver, type, false);
        if (operation !== null) runtime.recordOperation(API_OPERATION_INDEX[operation], threw ? THREW : RETURNED);
      }, options));
    }
  } catch { runtime.addFlag('hook-failed'); }

  const setters = (target: object, label: string): void => {
    const keys = ['onmousemove', 'onpointermove', 'onpointerrawupdate'];
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index]!;
      try {
        if (!descriptor(target, key)) { arrayPush(skipped, label + '.' + key); continue; }
        // Exclude clearing/non-callback primitives using typeof alone. Do not read callback properties.
        attach(wrapSetter(target, key, (_receiver, args, threw) => {
          const callback: unknown = args[0];
          if (typeof callback === 'function' || (typeof callback === 'object' && callback !== null)) {
            runtime.record(TECHNIQUE, threw ? THREW : RETURNED, LISTENER_USE);
          }
        }, options));
      } catch { runtime.addFlag('hook-failed'); }
    }
  };
  setters(realm, 'Window');
  const names = ['Document', 'HTMLElement', 'SVGElement', 'MathMLElement'];
  for (let index = 0; index < names.length; index++) {
    try {
      const name = names[index]!, target = prototype(name);
      if (target) setters(target, name);
    } catch { runtime.addFlag('hook-failed'); }
  }
  try {
    const target = prototype('MouseEvent');
    if (target) {
      // PointerEvent inherits these getters. A read need not come from a movement or trusted event.
      const keys = ['clientX', 'clientY', 'screenX', 'screenY', 'pageX', 'pageY', 'offsetX', 'offsetY', 'movementX', 'movementY', 'x', 'y'];
      for (let index = 0; index < keys.length; index++) {
        const key = keys[index]!;
        try {
          if (!descriptor(target, key)) { arrayPush(skipped, 'MouseEvent.' + key); continue; }
          attach(wrapGetter(target, key, (_receiver, threw) => {
            // Do not inspect receiver, result or exception, including event.type/isTrusted.
            runtime.record(TECHNIQUE, threw ? THREW : RETURNED, COORDINATE_READ);
          }, options));
        } catch { runtime.addFlag('hook-failed'); }
      }
    }
  } catch { runtime.addFlag('hook-failed'); }
  return { results, skipped };
}
