// ADR-038 / DET-064 / REQ-002/004/005: observe document-side creation, never rewrite workers.
export function createWorkerSurfacesSupport() {
  const descriptor = Object.getOwnPropertyDescriptor, getPrototype = Object.getPrototypeOf;
  const define = Object.defineProperty, apply = Reflect.apply, source = Function.prototype.toString;
  const exec = RegExp.prototype.exec, integer = Number.isSafeInteger;
  const native = value => typeof value === 'function' && apply(exec, /\[native code\]/, [apply(source, value, [])]) !== null;
  const own = (object, key) => object && descriptor(object, key)?.value;
  const push = (array, value) => define(array, array.length, { __proto__: null, value, writable: true, enumerable: true, configurable: true });
  // Read descriptors only. Unknown accessors are not invoked to discover an interface.
  function member(object, key, depthLimit = 8) {
    for (let depth = 0; object && depth < depthLimit; ++depth, object = getPrototype(object)) {
      const entry = descriptor(object, key);
      if (entry) return { owner: object, value: own(entry, 'value') };
    }
    return null;
  }
  function install(runtime, realm, wrappers, operationIndex, phaseIndex, nativeCheck = native) {
    const results = [], skipped = [], workletOwners = [];
    if (!runtime.hooks.enabled) return { results, skipped };
    const options = { context: runtime.hooks };
    const installOne = (label, target, key, kind) => {
      try {
        const ordinal = own(operationIndex, label), returned = own(phaseIndex, kind === 'method' ? 'settlement-unobserved' : 'returned-sync');
        const thrown = own(phaseIndex, 'threw-sync');
        if (!integer(ordinal) || ordinal < 0 || !integer(returned) || returned < 0 || !integer(thrown) || thrown < 0) {
          push(skipped, label); runtime.addFlag('hook-failed'); return;
        }
        if (!target || !nativeCheck(own(target, key))) { push(skipped, label); return; }
        const observe = threw => {
          // The wrapper owns argument forwarding and exception/Promise identity.
          // This callback reads no URL, options, constructor result or foreign Promise.
          runtime.recordOperation(ordinal, threw ? thrown : returned);
          if (!threw) runtime.addFlag('worker-not-observed');
        };
        const handle = kind === 'constructor'
          ? wrappers.wrapConstructor(target, key, (_args, _newTarget, threw) => observe(threw), options)
          : wrappers.wrapMethod(target, key, (_receiver, _args, threw) => observe(threw), options);
        if (handle) { push(results, handle); runtime.attach([handle]); }
        else { push(skipped, label); runtime.addFlag('hook-failed'); }
      } catch { push(skipped, label); runtime.addFlag('hook-failed'); }
    };
    const constructors = ['Worker', 'SharedWorker'];
    for (let index = 0; index < constructors.length; ++index) {
      const label = constructors[index];
      try { installOne(label, member(realm, label)?.owner, label, 'constructor'); }
      catch { push(skipped, label); runtime.addFlag('hook-failed'); }
    }
    // Worklet.addModule is shared by AudioWorklet/PaintWorklet. Some browsers expose
    // only a subtype constructor; follow its prototype without reading CSS/audio getters.
    const interfaces = ['Worklet', 'AudioWorklet', 'PaintWorklet'];
    for (let index = 0; index < interfaces.length; ++index) {
      try {
        const constructor = member(realm, interfaces[index])?.value;
        if (typeof constructor !== 'function' || !nativeCheck(constructor)) continue;
        const target = member(own(constructor, 'prototype'), 'addModule')?.owner;
        if (!target) continue;
        let duplicate = false;
        for (let previous = 0; previous < workletOwners.length; ++previous) if (workletOwners[previous] === target) duplicate = true;
        if (duplicate) continue;
        push(workletOwners, target); installOne('Worklet.addModule', target, 'addModule', 'method');
      } catch { runtime.addFlag('hook-failed'); }
    }
    if (!workletOwners.length) push(skipped, 'Worklet.addModule');
    return { results, skipped };
  }
  return { install };
}

export const workerSurfacesRuntimeSource = '  // packages/sensors/src/worker-surfaces.ts\n  var workerSurfacesSupport = (' + createWorkerSurfacesSupport.toString() + ')();\n\n';
export const workerSurfacesSupport = createWorkerSurfacesSupport();
