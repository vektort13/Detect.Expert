// @detect-expert/sensors — MAIN-world API wrappers and the sensor runtime (spec Part VI I2; ADR-006, ADR-017).
// No chrome.* here: this code runs in the page realm and everything it emits is page-controlled (REQ-004).

export { wrapMethod, wrapGetter, wrapSetter, wrapConstructor, createHookContext } from './wrap';
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
export {
  API_USE,
  compositeKey,
  decodeKey,
  operationIndex,
  PHASE_INDEX,
  signalBit,
  TECHNIQUE_INDEX,
} from './codes';
export type { DecodedKey } from './codes';
export { SensorRuntime, browserEnv, FOLD_RESERVE, STARTUP_QUEUE_MAX } from './runtime';
export type { RuntimeEnv, RuntimeSnapshot, StopResult } from './runtime';
export { wrapHotGetter, wrapHotMethod } from './hot';
export type { HotSpec } from './hot';
export { brandCheck, getterOf, methodOf, prototypeOf, readObject } from './realm';
export type { Getter, Method } from './realm';
export { installSensors, SENSOR_FAMILIES } from './registry';
export { beginSensorPolicy, markSensorOff, takeSensorPolicy } from './policy';
export type { SensorFamily } from './registry';
export { installCanvasSensor } from './canvas';
export type { CanvasSensor } from './canvas';
export { installWebglSensor } from './webgl';
export type { WebglSensor } from './webgl';
export { isLimitParam, WEBGL_IDENTITY_PARAMS } from './webgl-params';
export { installAudioSensor } from './audio';
export type { AudioSensor } from './audio';
export { installPermissionsSensor } from './permissions';
export type { PermissionsSensor } from './permissions';
export { installEnvironmentSensor } from './environment';
export type { EnvironmentSensor } from './environment';
export { installGeometrySensor } from './geometry';
export type { GeometrySensor } from './geometry';
export { FAMILY_CONFIG, hotLimit } from './families';
export type { FamilyConfig, HotMode } from './families';
