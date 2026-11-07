"use strict";
(() => {
const PROTECTION_CHANNEL = "detect.expert/protection/v1";
// ADR-045: shared denial implementation. Only explicitly registered rules install it.
// packages/sensors/src/intrinsics.ts
var defineProperty = Object.defineProperty;
function arrayPush(a, value) {
  return defineProperty(a, a.length, { __proto__: null, value, writable: !0, enumerable: !0, configurable: !0 }), a.length;
}

// packages/sensors/src/protection.ts
var apply = Reflect.apply, construct = Reflect.construct, reflectGet = Reflect.get, primitiveSymbol = Symbol.toPrimitive, NativeProxy = Proxy, NativeWeakRef = typeof WeakRef === 'function' ? WeakRef : null, weakDeref = NativeWeakRef ? NativeWeakRef.prototype.deref : null, getOwn = Object.getOwnPropertyDescriptor, getPrototype = Object.getPrototypeOf, define = Object.defineProperty, remove = Reflect.deleteProperty, hasOwn = Object.hasOwn, NativePromise = Promise, resolve = Promise.resolve, reject = Promise.reject, NativeDOMException = DOMException, LIMIT = 65535;
function ownValue(target, key) {
  if (target === null) return;
  let descriptor = getOwn(target, key);
  return descriptor && hasOwn(descriptor, "value") ? descriptor.value : void 0;
}
function prototype(realm, name) {
  let constructor = ownValue(realm, name);
  if (typeof constructor != "function" && (typeof constructor != "object" || constructor === null)) return null;
  let value = ownValue(constructor, "prototype");
  return typeof value == "object" && value !== null ? value : null;
}
function constructorOf(realm, name) {
  let value = ownValue(realm, name);
  return typeof value == "function" ? value : null;
}
function owner(target, key) {
  for (let depth = 0; target !== null && depth < 8; depth++) {
    let descriptor = getOwn(target, key);
    if (descriptor) return { target, descriptor };
    target = getPrototype(target);
  }
  return null;
}
function installProtection(realm, feature) {
  let state = { feature, installed: 0, unavailable: 0, removed: 0, blocked: 0, stopped: !1 }, handles = [];
  function method(target, key, denial) {
    try {
      let found = owner(target, key);
      if (!found || !found.descriptor.configurable || !hasOwn(found.descriptor, "value") || typeof found.descriptor.value != "function") {
        state.unavailable++;
        return;
      }
      const contextDenial = denial === 'webgl-null' || denial === 'offscreen-webgl-null', abortContext = { __proto__: null };
      const blockedContextType = value => value === 'webgl' || value === 'webgl2' || denial === 'webgl-null' && value === 'experimental-webgl';
      let original = found.descriptor.value, { blockedApi } = {
        blockedApi() {
          if (state.stopped) return apply(original, this, arguments);
          if (contextDenial) {
            if (arguments.length === 0) return apply(original, this, arguments);
            const contextType = arguments[0], opaque = contextType !== null && (typeof contextType === 'object' || typeof contextType === 'function');
            if (!opaque && !blockedContextType(contextType)) return apply(original, this, arguments);
            const args = []; for (let index = 0; index < arguments.length; index++) arrayPush(args, arguments[index]);
            // Native WebIDL validates the receiver before converting the name.
            // Abort only our private known-WebGL conversion, before any context
            // allocation or options reads. Caller coercion runs once, with its
            // original receiver; brand/coercion errors and non-WebGL names pass
            // through. Known blocked names skip later context/options processing.
            args[0] = opaque ? new NativeProxy({ __proto__: null }, { get(_target, key) {
              const member = reflectGet(contextType, key, contextType);
              if ((key === primitiveSymbol || key === 'toString' || key === 'valueOf') && typeof member === 'function') return function() {
                const value = apply(member, contextType, arguments);
                if (blockedContextType(value)) throw abortContext;
                return value;
              };
              return member;
            } }) : { [primitiveSymbol]() { throw abortContext; } };
            try { return apply(original, this, args); }
            catch (error) { if (error !== abortContext) throw error; if (state.blocked < LIMIT) state.blocked++; return null; }
          }
          if (state.blocked < LIMIT && state.blocked++, denial === "denied") return apply(resolve, NativePromise, ["denied"]);
          if (denial === "adapter-null") return apply(resolve, NativePromise, [null]);
          let error = new NativeDOMException("Blocked by detect.expert", denial === "not-allowed" ? "NotAllowedError" : "SecurityError");
          if (denial === "security-sync") throw error;
          return apply(reject, NativePromise, [error]);
        }
      };
      define(found.target, key, {
        __proto__: null,
        value: blockedApi,
        configurable: !0,
        enumerable: found.descriptor.enumerable === !0,
        writable: found.descriptor.writable === !0
      }), arrayPush(handles, { target: found.target, key, original: found.descriptor, wrapper: blockedApi }), state.installed++;
    } catch {
      state.unavailable++;
    }
  }
  function hide(target, key) {
    try {
      let found = owner(target, key);
      if (!found || !found.descriptor.configurable || !remove(found.target, key)) {
        state.unavailable++;
        return;
      }
      // REQ-012: retain deleted descriptors so disabling protection can restore them.
      arrayPush(handles, { target: found.target, key, original: found.descriptor, hidden: !0 });
      state.removed++, state.installed++;
    } catch {
      state.unavailable++;
    }
  }
  // Native Exception(traceStack:true) owns a getter that shadows the prototype.
  // Track only a bounded weak cleanup ring; every owned instance still gets denial.
  function wasmOwnStack(namespace, denied) {
    if (!NativeWeakRef || typeof weakDeref !== 'function') { state.unavailable++; return; }
    const constructor = getOwn(namespace, 'Exception');
    if (!constructor?.configurable || typeof constructor.value !== 'function') { state.unavailable++; return; }
    const original = constructor.value, records = []; let next = 0;
    const getter = originalGet => new NativeProxy(originalGet, { apply(originalGet, receiver, args) {
      if (state.stopped) return apply(originalGet, receiver, args);
      return denied();
    } });
    function protectOwn(instance) {
      try {
        const field = getOwn(instance, 'stack');
        if (!field || hasOwn(field, 'value') || typeof field.get !== 'function') return;
        if (!field.configurable) { if (state.unavailable < LIMIT) state.unavailable++; return; }
        const wrapper = getter(field.get);
        define(instance, 'stack', { __proto__: null, ...field, get: wrapper });
        const record = { ref: new NativeWeakRef(instance), getter: field.get, wrapper };
        if (records.length < 128) arrayPush(records, record);
        else { records[next] = record; next = (next + 1) % 128; }
      } catch { if (state.unavailable < LIMIT) state.unavailable++; }
    }
    const wrapper = new NativeProxy(original, { construct(original, args, newTarget) {
      const value = construct(original, args, newTarget);
      if (!state.stopped) protectOwn(value);
      return value;
    } });
    define(namespace, 'Exception', { __proto__: null, ...constructor, value: wrapper });
    arrayPush(handles, { target: namespace, key: 'Exception', original: constructor, wrapper }); state.installed++;
    const prototype = ownValue(original, 'prototype'), alias = prototype && getOwn(prototype, 'constructor');
    if (alias?.configurable && hasOwn(alias, 'value') && alias.value === original) {
      define(prototype, 'constructor', { __proto__: null, ...alias, value: wrapper });
      arrayPush(handles, { target: prototype, key: 'constructor', original: alias, wrapper }); state.installed++;
    }
    arrayPush(handles, { ownStack: records });
  }
  // ADR-059: deny one existing Wasm entry without reading its arguments/results.
  function wasmGuard(realm, targetKind, ownerName, key, kind) {
    try {
      const namespace = ownValue(realm, 'WebAssembly');
      if (!namespace || typeof namespace !== 'object') { state.unavailable++; return; }
      const constructor = ownerName ? ownValue(namespace, ownerName) : null;
      const target = targetKind === 'namespace' ? namespace : targetKind === 'static' ? constructor : constructor && ownValue(constructor, 'prototype');
      if (!target) { state.unavailable++; return; }
      const descriptor = getOwn(target, key);
      if (!descriptor || !descriptor.configurable) { state.unavailable++; return; }
      const denied = () => {
        if (state.blocked < LIMIT) state.blocked++;
        throw new NativeDOMException('Blocked by detect.expert', 'SecurityError');
      };
      if (kind === 'get' || kind === 'set') {
        const original = descriptor[kind];
        if (typeof original !== 'function') { state.unavailable++; return; }
        // Native accessors are not constructors. Keep the other accessor intact.
        const wrapper = kind === 'get' ? getOwn({ get blocked() {
          if (state.stopped) return apply(original, this, arguments);
          return denied();
        } }, 'blocked').get : getOwn({ set blocked(value) {
          if (state.stopped) return apply(original, this, arguments);
          denied();
        } }, 'blocked').set;
        define(target, key, { __proto__: null, ...descriptor, [kind]: wrapper });
        arrayPush(handles, { target, key, original: descriptor, wrapper, accessor: kind });
        state.installed++;
        if (ownerName === 'Exception' && key === 'stack' && kind === 'get') wasmOwnStack(namespace, denied);
        return;
      }
      if (!hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') { state.unavailable++; return; }
      const original = descriptor.value;
      const wrapper = new NativeProxy(original, {
        apply(original, receiver, args) {
          if (state.stopped) return apply(original, receiver, args);
          if (kind === 'async-call') {
            if (state.blocked < LIMIT) state.blocked++;
            return apply(reject, NativePromise, [new NativeDOMException('Blocked by detect.expert', 'SecurityError')]);
          }
          return denied();
        },
        construct(original, args, newTarget) {
          if (state.stopped) return construct(original, args, newTarget);
          return denied();
        },
      });
      define(target, key, { __proto__: null, ...descriptor, value: wrapper });
      arrayPush(handles, { target, key, original: descriptor, wrapper }); state.installed++;
      if (kind === 'construct') {
        const prototype = ownValue(original, 'prototype');
        const alias = prototype && getOwn(prototype, 'constructor');
        if (alias?.configurable && hasOwn(alias, 'value') && alias.value === original) {
          define(prototype, 'constructor', { __proto__: null, ...alias, value: wrapper });
          arrayPush(handles, { target: prototype, key: 'constructor', original: alias, wrapper }); state.installed++;
        }
      }
    } catch { state.unavailable++; }
  }
  let navigator = prototype(realm, "Navigator");
  switch (feature) {
    case "videoframe-readback":
      method(prototype(realm, "VideoFrame"), "copyTo", "security-async");
      break;
  }
  return {
    snapshot: () => ({ ...state }),
    stop() {
      if (!state.stopped) {
        state.stopped = !0;
        for (let index = handles.length - 1; index >= 0; index--) {
          let handle = handles[index];
          try {
            if (handle.ownStack) {
              for (let entry = 0; entry < handle.ownStack.length; entry++) {
                const record = handle.ownStack[entry], instance = apply(weakDeref, record.ref, []);
                if (!instance) continue;
                const current = getOwn(instance, 'stack');
                if (current?.get === record.wrapper && !hasOwn(current, 'value')) {
                  try { define(instance, 'stack', { __proto__: null, ...current, get: record.getter }); } catch {}
                }
              }
              handle.ownStack.length = 0;
              continue;
            }
            let current = getOwn(handle.target, handle.key);
            if (handle.accessor) {
              // Another feature can own the other half of Global.value.
              if (!current || current[handle.accessor] !== handle.wrapper || hasOwn(current, 'value')) continue;
              define(handle.target, handle.key, { __proto__: null, ...current, [handle.accessor]: handle.original[handle.accessor] });
              continue;
            }
            if (hasOwn(handle, "hidden")) {
              // Preserve any descriptor installed by the page after our deletion.
              if (current !== void 0) continue;
              define(handle.target, handle.key, { __proto__: null, ...handle.original });
              continue;
            }
            if (!current || !hasOwn(current, "value") || current.value !== handle.wrapper) continue;
            let original = handle.original;
            define(handle.target, handle.key, {
              __proto__: null,
              value: original.value,
              configurable: original.configurable === !0,
              enumerable: original.enumerable === !0,
              writable: original.writable === !0
            });
          } catch {
          }
        }
      }
    }
  };
}

// apps/extension/entrypoints/protection.main.ts
(() => {
  try {
    let apply2 = Reflect.apply, own = Object.getOwnPropertyDescriptor, hasOwn2 = Object.hasOwn, mark = /* @__PURE__ */ Symbol.for(PROTECTION_CHANNEL + "/videoframe-readback");
    if (own(globalThis, mark) !== void 0) return;
    Object.defineProperty(globalThis, mark, { __proto__: null, value: !0, configurable: !1 });
    let installation = installProtection(globalThis, "videoframe-readback"), post = window.postMessage, dataGetter = own(MessageEvent.prototype, "data")?.get, sourceGetter = own(MessageEvent.prototype, "source")?.get, clock = Date.now, lastReply = -1 / 0, field = (value, key) => {
      let descriptor = own(value, key);
      return descriptor && hasOwn2(descriptor, "value") ? descriptor.value : void 0;
    };
    window.addEventListener("message", (event) => {
      try {
        if (!dataGetter || !sourceGetter || apply2(sourceGetter, event, []) !== window) return;
        let data = apply2(dataGetter, event, []);
        if (typeof data != "object" || data === null || field(data, "channel") !== PROTECTION_CHANNEL) return;
        let type = field(data, "type");
        if (type === "protection-stop") installation.stop();
        else if (type === "protection-query") {
          let now = clock();
          if (now - lastReply < 250) return;
          lastReply = now, apply2(post, window, [{ channel: PROTECTION_CHANNEL, type: "protection-observation", observation: installation.snapshot() }, "*"]);
        }
      } catch {
      }
    });
  } catch {
  }
})();

})();
