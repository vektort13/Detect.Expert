// @detect-expert/sensors — MAIN-world API wrappers and the sensor runtime (spec Part VI I2; ADR-006).
// No chrome.* here: this code runs in the page realm and everything it emits is page-controlled (REQ-004).

export { wrapMethod, wrapOutcomeMethod, wrapGetter, wrapConstructor, createHookContext } from './wrap';
export type {
  ConstructorObserver,
  GetterObserver,
  HookContext,
  HookHandle,
  HookKind,
  HookUnsupported,
  MethodObserver,
  OutcomeObserver,
  UnsupportedReason,
  WrapOptions,
  WrapResult,
} from './wrap';
export { compositeKey, decodeKey, signalMaskOf, PHASE_INDEX, SIGNAL_BIT, TECHNIQUE_INDEX } from './codes';
export type { DecodedKey } from './codes';
export { SensorRuntime, browserEnv, STARTUP_QUEUE_MAX } from './runtime';
export type { RuntimeEnv, RuntimeSnapshot, StopResult } from './runtime';
export { installCanvasSensor } from './canvas';
export type { CanvasSensor } from './canvas';
export { startChildRealmManager } from './child-realms';
export { installGeometrySensor } from './geometry';
export { installGraphicsSensor } from './webgl';
export { installWebRTCSensor } from './webrtc';
export type { WebRTCSensor } from './webrtc';
export { installVisualCapture } from './visual';
export { registerValueCaptureRealm } from './value-capture-policy';
export { installEnvironmentSensor } from './environment';
export { installBrowserRequestSensor } from './browser-requests';
export { installTimingSensor } from './timing';
export { installWebAssemblySensor } from './wasm';
export { installPermissionsSensor } from './permissions';
export { installInteractionSensor } from './interaction';
export { installAudioSensor } from './audio';
export { installWebNNSensor } from './webnn';
export { installCapabilitySensor } from './capabilities';
