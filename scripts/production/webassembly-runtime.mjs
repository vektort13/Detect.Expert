// DET-065 / REQ-002/005/011: passive WebAssembly operations; never inspect module data.
import { WASM_SURFACES } from '../../packages/contracts/src/webassembly-apis.mjs';

export function createWebAssemblyObserverSupport(registry, surfaces) {
  const apply = Reflect.apply, descriptor = Object.getOwnPropertyDescriptor, define = Object.defineProperty;
  const prototypeOf = Object.getPrototypeOf, setPrototypeOf = Object.setPrototypeOf, own = Object.hasOwn;
  const NativeWeakMap = WeakMap, NativeWeakSet = WeakSet;
  const NativeWeakRef = typeof WeakRef === 'function' ? WeakRef : null;
  const deref = NativeWeakRef && NativeWeakRef.prototype.deref;
  const weakGet = WeakMap.prototype.get, weakSet = WeakMap.prototype.set;
  const setHas = WeakSet.prototype.has, setAdd = WeakSet.prototype.add;
  const states = new NativeWeakMap();
  const legacy = new Set(['WebAssembly.compile', 'WebAssembly.instantiate', 'WebAssembly.compileStreaming', 'WebAssembly.instantiateStreaming', 'WebAssembly.validate', 'WebAssembly.Module', 'WebAssembly.Instance', 'WebAssembly.Memory', 'WebAssembly.Memory.grow', 'WebAssembly.Memory.buffer']);
  const legacyHas = Set.prototype.has;
  const functionSource = Function.prototype.toString, includes = String.prototype.includes;
  const nativeFunction = value => typeof value === 'function' && apply(includes, apply(functionSource, value, []), ['[native code]']);
  let notifying = false;
  const append = (array, value) => define(array, array.length, { __proto__: null, value, writable: true, configurable: true, enumerable: true });
  const data = (object, key) => {
    if (object === null || typeof object !== 'object' && typeof object !== 'function') return undefined;
    const field = descriptor(object, key);
    return field && own(field, 'value') ? field.value : undefined;
  };
  function observerError(runtime) {
    const context = runtime.hooks;
    if (context.observerErrors < 2147483647) context.observerErrors++;
    try { context.onObserverError?.(); } catch { /* Never replace a native exception. */ }
  }
  function count(runtime, operation, phase) {
    if (runtime.hooks.enabled) runtime.recordOperation(operation, phase);
  }
  function copyMeta(wrapper, original) {
    setPrototypeOf(wrapper, prototypeOf(original));
    for (const name of ['name', 'length']) {
      const field = descriptor(original, name);
      if (field && own(field, 'value')) define(wrapper, name, field);
    }
    return wrapper;
  }
  // Global.value owns both slots. Installing independent getter/setter handles would lose ownership.
  // Concise methods retain native accessor non-constructibility, including borrowed setter calls.
  function accessor(runtime, target, property, getOperation, setOperation) {
    const previous = descriptor(target, property);
    if (!previous || previous.configurable !== true) return { status: 'unsupported', kind: 'getter', target, key: property, label: property,
      reason: previous ? 'non-configurable' : 'missing', coverageFlag: previous ? 'descriptor-nonconfigurable' : 'hook-failed' };
    const originalGet = previous.get, originalSet = previous.set;
    function invoke(original, receiver, args, operation) {
      let value, error, threw = false;
      try { value = apply(original, receiver, args); } catch (caught) { error = caught; threw = true; }
      if (operation !== undefined && runtime.hooks.enabled && !notifying) {
        notifying = true;
        try { count(runtime, operation, registry.phaseIndex[threw ? 'threw-sync' : 'returned-sync']); }
        catch { observerError(runtime); }
        finally { notifying = false; }
      }
      if (threw) throw error;
      return value;
    }
    const callbacks = {
      get() { return invoke(originalGet, this, arguments, getOperation); },
      set(value) { return invoke(originalSet, this, arguments, setOperation); }
    };
    const next = { ...previous };
    if (typeof originalGet === 'function' && getOperation !== undefined) next.get = copyMeta(callbacks.get, originalGet);
    if (typeof originalSet === 'function' && setOperation !== undefined) next.set = copyMeta(callbacks.set, originalSet);
    define(target, property, next);
    const isOwned = () => {
      const current = descriptor(target, property);
      return !!current && current.get === next.get && current.set === next.set;
    };
    return { status: 'installed', kind: 'getter', target, key: property, label: property, isOwned,
      restore() { if (!isOwned()) return false; try { define(target, property, previous); return true; } catch { return false; } }
    };
  }
  function constructorAlias(original, replacement) {
    const prototype = data(original, 'prototype');
    if (prototype === null || typeof prototype !== 'object') return null;
    const previous = descriptor(prototype, 'constructor');
    // Do not rewrite a page-supplied alias, inherited property or frozen prototype.
    if (!previous || previous.configurable !== true || !own(previous, 'value') || previous.value !== original) return null;
    define(prototype, 'constructor', { ...previous, value: replacement });
    const isOwned = () => descriptor(prototype, 'constructor')?.value === replacement;
    return { status: 'installed', kind: 'constructor', target: prototype, key: 'constructor', label: 'constructor', isOwned,
      restore() { if (!isOwned()) return false; try { define(prototype, 'constructor', previous); return true; } catch { return false; } }
    };
  }
  function createStackGetter(runtime, original, operation, active) {
    // This factory has no instance/result binding: the wrapper cannot keep an Exception alive.
    const { get } = { get() {
      let value, error, threw = false;
      try { value = apply(original, this, arguments); } catch (caught) { threw = true; error = caught; }
      if (active() && runtime.hooks.enabled && !notifying) {
        notifying = true;
        try { count(runtime, operation, registry.phaseIndex[threw ? 'threw-sync' : 'returned-sync']); }
        catch { observerError(runtime); }
        finally { notifying = false; }
      }
      if (threw) throw error;
      return value;
    } };
    return copyMeta(get, original);
  }
  function createStackTracker(runtime, operation, attach) {
    const seen = new NativeWeakSet(), ring = [];
    let cursor = 0, evicted = false, active = true, attached = false;
    const isActive = () => active;
    const handle = { status: 'installed', kind: 'getter', target: null, key: 'stack', label: 'WebAssembly.Exception.stack.instances',
      isOwned: isActive,
      restore() {
        active = false;
        let complete = !evicted;
        for (let index = 0; index < ring.length; index++) {
          const entry = ring[index], instance = apply(deref, entry.reference, []);
          if (!instance) continue;
          try {
            const current = descriptor(instance, 'stack');
            if (!current || current.get !== entry.wrapper || current.set !== entry.setter) { complete = false; continue; }
            define(instance, 'stack', { ...current, get: entry.getter });
          } catch { complete = false; }
        }
        ring.length = 0;
        return complete;
      }
    };
    return { observe(instance) {
      if (!active || !runtime.hooks.enabled || instance === null || typeof instance !== 'object' || apply(setHas, seen, [instance])) return;
      if (!NativeWeakRef) { runtime.addFlag('hook-failed'); return; }
      const field = descriptor(instance, 'stack');
      // Never read a stack getter, inspect its return or retain an own data stack string.
      if (!field) return;
      if (own(field, 'value') || field.configurable !== true || typeof field.get !== 'function') { runtime.addFlag('hook-failed'); return; }
      const wrapper = createStackGetter(runtime, field.get, operation, isActive);
      const reference = new NativeWeakRef(instance);
      define(instance, 'stack', { ...field, get: wrapper });
      apply(setAdd, seen, [instance]);
      const entry = { reference, getter: field.get, setter: field.set, wrapper };
      if (ring.length < 128) append(ring, entry);
      else { ring[cursor] = entry; cursor = (cursor + 1) % 128; evicted = true; }
      if (!attached) { attached = true; attach(handle); }
    } };
  }
  function install(runtime, realm, wrappers, nativeCheck = nativeFunction) {
    const results = [], skipped = [];
    if (!runtime.hooks.enabled) return { results, skipped };
    let state = apply(weakGet, states, [runtime]);
    if (!state) { state = { realms: new NativeWeakSet(), stack: null }; apply(weakSet, states, [runtime, state]); }
    if (apply(setHas, state.realms, [realm])) return { results, skipped };
    apply(setAdd, state.realms, [realm]);
    let namespace;
    try { namespace = data(realm, 'WebAssembly'); }
    catch { runtime.addFlag('hook-failed'); return { results, skipped }; }
    if (namespace === null || typeof namespace !== 'object') { append(skipped, 'WebAssembly'); return { results, skipped }; }
    const options = { context: runtime.hooks }, owners = Object.create(null);
    const attach = handle => { if (handle) { append(results, handle); runtime.attach([handle]); } };
    function targetFor(surface) {
      if (surface.target === 'namespace') return namespace;
      let constructor = owners[surface.owner];
      if (constructor === undefined) constructor = owners[surface.owner] = data(namespace, surface.owner);
      return surface.target === 'static' ? constructor : data(constructor, 'prototype');
    }
    // Static functions must be wrapped before wrapConstructor copies their descriptors.
    for (let pass = 0; pass < 2; pass++) for (let index = 0; index < surfaces.length; index++) {
      const surface = surfaces[index];
      if ((surface.kind === 'construct') !== (pass === 1)) continue;
      const operation = surface.operation, operationIndex = registry.operationIndex[operation];
      if (operationIndex === undefined) { append(skipped, operation); continue; }
      try {
        const target = targetFor(surface), field = target && descriptor(target, surface.property);
        if (!field) { append(skipped, operation); continue; }
        const returned = registry.phaseIndex[surface.kind === 'async-call' ? 'settlement-unobserved' : 'returned-sync'];
        const record = threw => count(runtime, operationIndex, threw ? registry.phaseIndex['threw-sync'] : returned);
        const wasLegacy = apply(legacyHas, legacy, [operation]);
        if (surface.kind === 'construct') {
          const original = data(target, surface.property);
          const trackStack = operation === 'WebAssembly.Exception' && nativeCheck(original) && registry.operationIndex['WebAssembly.Exception.stack'] !== undefined;
          if (trackStack && !state.stack) state.stack = createStackTracker(runtime, registry.operationIndex['WebAssembly.Exception.stack'], attach);
          const handle = wrappers.wrapConstructor(target, surface.property, (_args, _newTarget, threw, _error, value) => {
            if (trackStack && !threw) state.stack.observe(value);
            record(threw);
            if (wasLegacy) runtime.recordResult(operation, threw ? registry.phaseIndex['threw-sync'] : returned, value);
          }, options);
          attach(handle);
          if (handle.status === 'installed') attach(constructorAlias(original, data(target, surface.property)));
        } else if (surface.kind === 'get' || surface.kind === 'set') {
          let counterpart;
          for (let other = 0; other < surfaces.length; other++) {
            const candidate = surfaces[other];
            if (candidate.target === surface.target && candidate.owner === surface.owner && candidate.property === surface.property && candidate.kind !== surface.kind && (candidate.kind === 'get' || candidate.kind === 'set')) { counterpart = candidate; break; }
          }
          if (counterpart) {
            if (surface.kind === 'set') continue;
            if (typeof field.get !== 'function') { append(skipped, operation); continue; }
            attach(accessor(runtime, target, surface.property, operationIndex, typeof field.set === 'function' ? registry.operationIndex[counterpart.operation] : undefined));
            if (typeof field.set !== 'function') append(skipped, counterpart.operation);
          } else if (surface.kind === 'get') attach(wrappers.wrapGetter(target, surface.property, (_receiver, threw, _error, value) => {
            record(threw);
            if (wasLegacy) runtime.recordResult(operation, threw ? registry.phaseIndex['threw-sync'] : returned, value);
          }, options));
          else attach(wrappers.wrapSetter(target, surface.property, (_receiver, _args, threw) => record(threw), options));
        } else if (wasLegacy) attach(wrappers.wrapResultMethod(target, surface.property, (threw, value, args) => {
          record(threw);
          runtime.recordResult(operation, threw ? registry.phaseIndex['threw-sync'] : returned, value, operation === 'WebAssembly.Memory.grow' ? args : undefined);
        }, options));
        else attach(wrappers.wrapOutcomeMethod(target, surface.property, record, options));
      } catch { runtime.addFlag('hook-failed'); append(skipped, operation); }
    }
    return { results, skipped };
  }
  return { install };
}

export const webAssemblyRuntimeSource = '  // packages/sensors/src/wasm.ts\n' +
  '  var webAssemblyObserverSupport = (' + createWebAssemblyObserverSupport.toString() + ')({ operationIndex: API_OPERATION_INDEX, phaseIndex: PHASE_INDEX }, ' + JSON.stringify(WASM_SURFACES) + ');\n' +
  '  function installWebAssemblySensor(runtime, realm = globalThis) { return webAssemblyObserverSupport.install(runtime, realm, { wrapConstructor, wrapGetter, wrapSetter, wrapOutcomeMethod, wrapResultMethod }); }\n\n';
