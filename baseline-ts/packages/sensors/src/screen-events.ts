import type { ApiOperation } from '@detect-expert/contracts';
import type { SensorRuntime } from './runtime';

type TargetKind = 'Screen' | 'ScreenDetails';
type Targets = { count: number; receivers: WeakMap<object, TargetKind> };
const WeakMapCtor = WeakMap;
const get = Function.prototype.call.bind(WeakMap.prototype.get) as <Value>(map: WeakMap<object, Value>, key: object) => Value | undefined;
const set = Function.prototype.call.bind(WeakMap.prototype.set) as <Value>(map: WeakMap<object, Value>, key: object, value: Value) => void;
const remove = Function.prototype.call.bind(WeakMap.prototype.delete) as (map: WeakMap<object, unknown>, key: object) => void;
const targets = new WeakMapCtor<SensorRuntime, Targets>();

export function rememberScreenTarget(runtime: SensorRuntime, receiver: unknown, kind: TargetKind): void {
  if (typeof receiver !== 'object' || receiver === null) return;
  let state = get(targets, runtime);
  if (!state) {
    state = { count: 0, receivers: new WeakMapCtor<object, TargetKind>() };
    set(targets, runtime, state);
    runtime.onStop(() => remove(targets, runtime));
  }
  if (get(state.receivers, receiver) !== undefined) return;
  if (state.count >= 128) { runtime.addFlag('budget-exceeded'); return; }
  state.count++;
  set(state.receivers, receiver, kind);
}

export function screenEventOperation(runtime: SensorRuntime, receiver: unknown, type: unknown, adding: boolean): ApiOperation | null {
  if (typeof receiver !== 'object' || receiver === null) return null;
  const state = get(targets, runtime);
  const kind = state ? get(state.receivers, receiver) : undefined;
  if (kind === 'Screen' && type === 'change') return adding ? 'Screen.addEventListener' : 'Screen.removeEventListener';
  if (kind === 'ScreenDetails' && (type === 'screenschange' || type === 'currentscreenchange')) {
    return adding ? 'ScreenDetails.addEventListener' : 'ScreenDetails.removeEventListener';
  }
  return null;
}