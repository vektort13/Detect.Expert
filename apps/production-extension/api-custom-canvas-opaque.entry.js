// ADR-066: an inaccessible inherited realm has no synchronous trusted session
// key. Deny covered readbacks there; never reveal the unprojected source bitmap.
if (['about:', 'data:', 'blob:'].includes(globalThis.location?.protocol)) {
  const descriptor = Object.getOwnPropertyDescriptor, prototype = Object.getPrototypeOf, define = Object.defineProperty;
  const apply = Reflect.apply, NativeProxy = Proxy, Denial = DOMException, setProto = Object.setPrototypeOf, reflectSetProto = Reflect.setPrototypeOf;
  // A deny-only veto also clears any observer preview queued before this guard.
  // A page-planted false/accessor value never grants permission to capture.
  try {
    const marker = Symbol.for('detect.expert/api-custom/value-capture-deny/v1'), existing = descriptor(globalThis, marker);
    if (!existing || existing.configurable) define(globalThis, marker, { __proto__: null, value: true, configurable: false, enumerable: false, writable: false });
  } catch { /* Covered readback methods below still fail before their originals. */ }
  let origin;
  try {
    let target = globalThis;
    for (let depth = 0; target && depth < 16; depth++, target = prototype(target)) {
      const field = descriptor(target, 'origin');
      if (field) { origin = typeof field.get === 'function' ? apply(field.get, globalThis, []) : field.value; break; }
    }
  } catch { /* Inaccessible origin is handled as an opaque realm. */ }
  // A public symbol is only a routing hint. It cannot exempt an opaque origin.
  const inherited = origin !== 'null' && typeof origin === 'string' && descriptor(globalThis, Symbol.for('detect.expert/api-custom/document/v2'))?.value === true;
  if (!inherited) {
    const targets = [['CanvasRenderingContext2D', ['getImageData']], ['OffscreenCanvasRenderingContext2D', ['getImageData']], ['HTMLCanvasElement', ['toDataURL', 'toBlob']], ['OffscreenCanvas', ['convertToBlob']]];
    for (let index = 0; index < targets.length; index++) {
      const name = targets[index][0], methods = targets[index][1];
      const constructor = descriptor(globalThis, name)?.value, target = constructor && descriptor(constructor, 'prototype')?.value;
      for (let methodIndex = 0; methodIndex < methods.length; methodIndex++) {
        const method = methods[methodIndex];
        let owner = target;
        for (let depth = 0; owner && depth < 16; depth++, owner = prototype(owner)) {
          const field = descriptor(owner, method); if (!field) continue;
          if (typeof field.value === 'function' && (field.configurable || field.writable)) {
            let self; // ADR-112: a denial Proxy refuses to close a prototype cycle through itself (Object.setPrototypeOf(fn, fn)) with the engine's own TypeError, as the native function does.
            const wrapped = self = new NativeProxy(field.value, { apply() { throw new Denial('Canvas profile unavailable in this frame', 'SecurityError'); }, setPrototypeOf(target, value) { if (value === self) { setProto(target, target); return false; } return reflectSetProto(target, value); } });
            define(owner, method, { __proto__: null, ...field, value: wrapped });
          }
          break;
        }
      }
    }
  }
}
