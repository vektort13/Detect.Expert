// REQ-002/004/005/011: API-use labels only; no sensor readings, credentials, clipboard or GPU bytes.
export const EXTENDED_API_OPERATIONS = Object.freeze([
  ...['Accelerometer', 'Gyroscope', 'LinearAccelerationSensor', 'GravitySensor', 'Magnetometer', 'AbsoluteOrientationSensor', 'RelativeOrientationSensor']
    .map(name => Object.freeze([name, 'DET-042', 'device-sensor', 'construct'])),
  Object.freeze(['WebTransport', 'DET-058', 'webtransport', 'construct']),
  Object.freeze(['CredentialsContainer.create', 'DET-069', 'webauthn', 'async-call']),
  ...['read', 'readText', 'write', 'writeText'].map(name => Object.freeze(['Clipboard.' + name, 'DET-069', 'clipboard', 'async-call'])),
  Object.freeze(['GPUBuffer.mapAsync', 'DET-014', 'webgpu', 'async-call']),
  Object.freeze(['GPUBuffer.getMappedRange', 'DET-014', 'webgpu', 'call']),
  Object.freeze(['GPUBuffer.unmap', 'DET-014', 'webgpu', 'call']),
  ...['deviceorientation', 'devicemotion', 'deviceorientationabsolute'].flatMap(name => [
    Object.freeze(['Window.addEventListener.' + name, 'DET-042', 'device-sensor', 'call']),
    Object.freeze(['Window.on' + name, 'DET-042', 'device-sensor', 'set'])
  ])
]);

export function createExtendedSurfacesSupport(registry, definitions) {
  const apply = Reflect.apply, descriptor = Object.getOwnPropertyDescriptor, hasOwn = Object.hasOwn;
  const fnSource = Function.prototype.toString, exec = RegExp.prototype.exec, push = Array.prototype.push;
  const indexOf = String.prototype.indexOf, slice = String.prototype.slice;
  const NativeWeakMap = WeakMap, NativeWeakSet = WeakSet;
  const weakGet = WeakMap.prototype.get, weakSet = WeakMap.prototype.set, weakDelete = WeakMap.prototype.delete;
  const setHas = WeakSet.prototype.has, setAdd = WeakSet.prototype.add;
  const states = new NativeWeakMap();
  const native = value => typeof value === 'function' && apply(exec, /\[native code\]/, [apply(fnSource, value, [])]) !== null;
  const own = (value, key) => {
    if (value === null || typeof value !== 'object' && typeof value !== 'function') return null;
    const property = descriptor(value, key);
    return property && hasOwn(property, 'value') ? property.value : null;
  };
  const phase = (threw, asynchronous = false) => registry.phaseIndex[threw ? 'threw-sync' : asynchronous ? 'settlement-unobserved' : 'returned-sync'];
  function record(runtime, operation, technique, threw, asynchronous = false) {
    if (!runtime.hooks.enabled) return;
    const index = registry.operationIndex[operation], phaseIndex = phase(threw, asynchronous);
    if (index === undefined) runtime.record(registry.techniqueIndex[technique], phaseIndex, registry.apiUse);
    else runtime.recordOperation(index, phaseIndex);
  }
  function flag(runtime) { try { runtime.addFlag('hook-failed'); } catch { /* Observer diagnostics cannot affect the page. */ } }
  function isRegisteredWindow(runtime, receiver) {
    const state = apply(weakGet, states, [runtime]);
    return !!state && receiver !== null && (typeof receiver === 'object' || typeof receiver === 'function') && apply(setHas, state.realms, [receiver]);
  }
  function observeDeviceEvent(runtime, receiver, args, threw) {
    // Three exact primitive comparisons precede any state lookup, callback access or observer work.
    const type = args[0];
    if (type !== 'deviceorientation' && type !== 'devicemotion' && type !== 'deviceorientationabsolute') return;
    if (!runtime.hooks.enabled || !isRegisteredWindow(runtime, receiver)) return;
    const callback = args[1];
    if (typeof callback !== 'function' && (callback === null || typeof callback !== 'object')) return;
    record(runtime, 'Window.addEventListener.' + type, 'DET-042', threw);
  }
  function install(runtime, realm, wrappers, nativeCheck = native) {
    const results = [], skipped = [];
    if (!runtime.hooks.enabled) return { results, skipped };
    let state = apply(weakGet, states, [runtime]);
    if (!state) {
      state = { realms: new NativeWeakSet() };
      apply(weakSet, states, [runtime, state]);
      runtime.onStop(() => apply(weakDelete, states, [runtime]));
    }
    if (apply(setHas, state.realms, [realm])) return { results, skipped };
    apply(setAdd, state.realms, [realm]);
    const options = { context: runtime.hooks };
    const attach = handle => { if (handle) { apply(push, results, [handle]); runtime.attach([handle]); } };
    for (let index = 0; index < definitions.length; ++index) {
      const definition = definitions[index], operation = definition[0], technique = definition[1], kind = definition[3];
      // EventTarget already has the interaction wrapper: root dispatches its callback to observeDeviceEvent.
      if (operation === 'Window.addEventListener.deviceorientation' || operation === 'Window.addEventListener.devicemotion' || operation === 'Window.addEventListener.deviceorientationabsolute') continue;
      try {
        if (kind === 'construct') {
          if (!nativeCheck(own(realm, operation))) { apply(push, skipped, [operation]); continue; }
          attach(wrappers.wrapConstructor(realm, operation, (_args, _newTarget, threw) => record(runtime, operation, technique, threw), options));
          continue;
        }
        const dot = apply(indexOf, operation, ['.']), owner = apply(slice, operation, [0, dot]), key = apply(slice, operation, [dot + 1]);
        const constructor = own(realm, owner), prototype = own(constructor, 'prototype');
        if (kind === 'set') {
          const target = descriptor(realm, key) ? realm : prototype;
          if (!target || !nativeCheck(descriptor(target, key)?.set)) { apply(push, skipped, [operation]); continue; }
          attach(wrappers.wrapSetter(target, key, (receiver, args, threw) => {
            if (typeof args[0] === 'function' && isRegisteredWindow(runtime, receiver)) record(runtime, operation, technique, threw);
          }, options));
        } else {
          if (!prototype || !nativeCheck(own(prototype, key))) { apply(push, skipped, [operation]); continue; }
          attach(wrappers.wrapMethod(prototype, key, (_receiver, _args, threw) => record(runtime, operation, technique, threw, kind === 'async-call'), options));
        }
      } catch { flag(runtime); apply(push, skipped, [operation]); }
    }
    return { results, skipped };
  }
  return { install, observeDeviceEvent };
}

export const extendedSurfacesRuntimeSource = '  // packages/sensors/src/extended-surfaces.ts\n' +
  '  var extendedSurfaceDefinitions = ' + JSON.stringify(EXTENDED_API_OPERATIONS) + ';\n' +
  '  var extendedSurfacesSupport = (' + createExtendedSurfacesSupport.toString() + ')({ techniqueIndex: TECHNIQUE_INDEX, operationIndex: API_OPERATION_INDEX, phaseIndex: PHASE_INDEX, apiUse: SIGNAL_BIT["api-use"] }, extendedSurfaceDefinitions);\n' +
  '  // packages/sensors/src/extended-surfaces:end\n\n';
