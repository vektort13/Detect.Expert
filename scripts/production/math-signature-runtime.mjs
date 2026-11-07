// ADR-038 / DET-022/023 / REQ-002/004/005/011: opt-in, primitive marker matches only.
// Sources: FingerprintJS src/sources/math.ts; ECMA-262 Math. Values never leave this sensor.
export function createMathSignatureSupport() {
  const descriptor = Object.getOwnPropertyDescriptor, getPrototype = Object.getPrototypeOf;
  const define = Object.defineProperty, apply = Reflect.apply, fnSource = Function.prototype.toString;
  const exec = RegExp.prototype.exec, integer = Number.isSafeInteger;
  const NativeWeakMap = WeakMap, get = WeakMap.prototype.get, set = WeakMap.prototype.set;
  const states = new NativeWeakMap();
  const own = (object, key) => object && descriptor(object, key)?.value;
  const native = value => typeof value === 'function' && apply(exec, /\[native code\]/, [apply(fnSource, value, [])]) !== null;
  const push = (array, value) => define(array, array.length, { __proto__: null, value, writable: true, enumerable: true, configurable: true });
  function mathObject(realm) {
    for (let depth = 0; realm && depth < 8; ++depth, realm = getPrototype(realm)) {
      const entry = descriptor(realm, 'Math');
      if (entry) return own(entry, 'value');
    }
    return null;
  }
  function install(runtime, realm, wrappers, techniques, phases, signals, nativeCheck = native) {
    const previous = apply(get, states, [runtime]);
    if (previous) return previous;
    const trig = own(techniques, 'DET-022'), pow = own(techniques, 'DET-023');
    const returned = own(phases, 'returned-sync'), thrown = own(phases, 'threw-sync');
    const api = own(signals, 'api-use'), pattern = own(signals, 'known-numeric-pattern');
    const indexes = [trig, pow, returned, thrown, api, pattern];
    for (let index = 0; index < indexes.length; ++index) if (!integer(indexes[index]) || indexes[index] < 0) {
      runtime.addFlag('hook-failed'); return null;
    }
    if (api < 1 || pattern < 1 || api === pattern) { runtime.addFlag('hook-failed'); return null; }
    const mask = api | pattern, options = { context: runtime.hooks };
    let active = false, stopped = false, handles = [];
    const reset = () => {
      active = false;
      for (let index = 0; index < handles.length; ++index) {
        try { if (!handles[index].restore()) runtime.addFlag('hook-failed'); }
        catch { runtime.addFlag('hook-failed'); }
      }
      handles = [];
    };
    const installOne = (target, key, technique, first, second) => {
      try {
        if (!target || !nativeCheck(own(target, key))) { runtime.addFlag('hook-failed'); return; }
        const binary = key === 'pow';
        const handle = wrappers.wrapMethod(target, key, (_receiver, args, threw) => {
          // Read only primitive arguments from the wrapper's own arguments object.
          // No coercion, result access, clock, stack, attribution or value recording.
          if (!active || args.length !== (binary ? 2 : 1) || typeof args[0] !== 'number' || args[0] !== first) return;
          if (binary && (typeof args[1] !== 'number' || args[1] !== second)) return;
          runtime.record(technique, threw ? thrown : returned, mask);
        }, options);
        if (handle?.status === 'installed') push(handles, handle);
        else if (handle) runtime.attach([handle]);
        else runtime.addFlag('hook-failed');
      } catch { runtime.addFlag('hook-failed'); }
    };
    const setActive = enabled => {
      if (enabled !== true) { reset(); return; }
      if (stopped || active || !runtime.hooks.enabled) return;
      active = true;
      let target;
      try { target = mathObject(realm); } catch { runtime.addFlag('hook-failed'); }
      if (!target || typeof target !== 'object') { runtime.addFlag('hook-failed'); return; }
      installOne(target, 'sin', trig, -1e300);
      installOne(target, 'cos', trig, 10.000000000123);
      installOne(target, 'tan', trig, -1e300);
      installOne(target, 'acos', trig, 0.123124234234234242);
      installOne(target, 'acosh', trig, 1e308);
      installOne(target, 'asin', trig, 0.123124234234234242);
      installOne(target, 'pow', pow, 3.141592653589793, -100);
    };
    const recorder = runtime.apiResults, originalCallback = own(recorder, 'onProSessionChanged');
    const onChange = enabled => {
      try { if (typeof originalCallback === 'function') apply(originalCallback, recorder, [enabled]); }
      finally { setActive(enabled); }
    };
    const stop = () => {
      stopped = true; reset();
      if (own(recorder, 'onProSessionChanged') === onChange) recorder.onProSessionChanged = originalCallback;
    };
    const state = { setActive, stop, get active() { return active; }, get installed() { return handles.length; } };
    apply(set, states, [runtime, state]);
    recorder.onProSessionChanged = onChange;
    runtime.onStop(stop);
    const session = own(recorder, 'proSession');
    if (typeof session === 'string' && session.length > 0) setActive(true);
    return state;
  }
  return { install };
}

export const mathSignatureRuntimeSource = '  // packages/sensors/src/math-signature.ts\n  var mathSignatureSupport = (' + createMathSignatureSupport.toString() + ')();\n\n';
export const mathSignatureSupport = createMathSignatureSupport();
