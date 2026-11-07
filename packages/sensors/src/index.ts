// @detect-expert/sensors — MAIN-world API wrappers and the sensor runtime (spec Part VI I2; ADR-006).
// No chrome.* here: this code runs in the page realm and everything it emits is page-controlled (REQ-004).

export { wrapMethod, wrapGetter, wrapConstructor, createHookContext } from './wrap';
export type {
  ConstructorObserver,
  GetterObserver,
  HookContext,
  HookHandle,
  HookKind,
  HookUnsupported,
  MethodObserver,
  UnsupportedReason,
  WrapOptions,
  WrapResult,
} from './wrap';
export { compositeKey, decodeKey, PHASE_INDEX, SIGNAL_BIT, TECHNIQUE_INDEX } from './codes';
export type { DecodedKey } from './codes';
export { SensorRuntime, browserEnv, STARTUP_QUEUE_MAX } from './runtime';
export type { RuntimeEnv, RuntimeSnapshot, StopResult } from './runtime';
export { installCanvasSensor } from './canvas';
export type { CanvasSensor } from './canvas';
