// ADR-065: no synchronous trusted seed in inaccessible inherited opaque realms.
// Deny the group there instead of returning the engine's native fingerprint.
import { API_MATH_FUNCTIONS } from './math-functions.js';
if (['about:', 'data:', 'blob:'].includes(globalThis.location?.protocol)) {
  const marker = Symbol.for('detect.expert/api-custom/value-capture-deny/v1');
  try {
    const existing = Object.getOwnPropertyDescriptor(globalThis, marker);
    if (!existing || existing.configurable) Object.defineProperty(globalThis, marker, { __proto__: null, value: true, configurable: false, enumerable: false, writable: false });
  } catch { /* Observer policy independently denies non-extensible/inaccessible realms. */ }
}
if (['about:', 'data:', 'blob:'].includes(globalThis.location?.protocol) && Object.getOwnPropertyDescriptor(globalThis, Symbol.for('detect.expert/api-custom/document/v2'))?.value !== true) {
  const getOwn = Object.getOwnPropertyDescriptor, define = Object.defineProperty, apply = Reflect.apply;
  const NativeProxy = Proxy, Denial = DOMException, math = getOwn(globalThis, 'Math')?.value, setProto = Object.setPrototypeOf, reflectSetProto = Reflect.setPrototypeOf;
  for (let index = 0; math && index < API_MATH_FUNCTIONS.length; index++) {
    const name = API_MATH_FUNCTIONS[index], field = getOwn(math, name);
    if (!field || typeof field.value !== 'function' || !field.configurable && !field.writable) continue;
    let self; // ADR-112: a denial Proxy refuses to close a prototype cycle through itself (Object.setPrototypeOf(fn, fn)) with the engine's own TypeError, as the native function does.
    const wrapped = self = new NativeProxy(field.value, { apply() { throw new Denial('Math profile unavailable in this frame', 'SecurityError'); }, setPrototypeOf(target, value) { if (value === self) { setProto(target, target); return false; } return reflectSetProto(target, value); } });
    apply(define, Object, [math, name, { __proto__: null, ...field, value: wrapped }]);
  }
}
