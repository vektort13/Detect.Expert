// Custom geolocation: an inaccessible inherited realm (about:/data:/blob: whose parent profile cannot be read) has no selected position.
// Refuse both position requests there, before the native method runs: no permission prompt, no native position, no error callback.
// A normal or inherited document keeps its complete selected profile; this guard never touches it.
if (['about:', 'data:', 'blob:'].includes(globalThis.location?.protocol)) {
  const descriptor = Object.getOwnPropertyDescriptor, prototype = Object.getPrototypeOf, define = Object.defineProperty;
  const apply = Reflect.apply, NativeProxy = Proxy, Denial = DOMException, setProto = Object.setPrototypeOf, reflectSetProto = Reflect.setPrototypeOf;
  // Deny-only veto: presence stops raw API-result previews. A page value never grants permission to capture.
  try {
    const veto = Symbol.for('detect.expert/api-custom/value-capture-deny/v1'), existing = descriptor(globalThis, veto);
    if (!existing || existing.configurable) define(globalThis, veto, { __proto__: null, value: true, configurable: false, enumerable: false, writable: false });
  } catch { /* The covered methods below still refuse before their originals. */ }
  const marker = Symbol.for('detect.expert/api-custom/opaque/geolocation-deny/v1');
  let origin;
  try {
    let target = globalThis;
    for (let depth = 0; target && depth < 16; depth++, target = prototype(target)) {
      const field = descriptor(target, 'origin');
      if (field) { origin = typeof field.get === 'function' ? apply(field.get, globalThis, []) : field.value; break; }
    }
  } catch { /* An unreadable origin is handled as an opaque realm. */ }
  // The deny marker is distinct from the generic opaque marker, so the generic path can never pre-empt this guard.
  // A public symbol is only a routing hint. It cannot exempt an opaque origin.
  const inherited = origin !== 'null' && typeof origin === 'string' && descriptor(globalThis, Symbol.for('detect.expert/api-custom/document/v2'))?.value === true;
  if (!inherited && descriptor(globalThis, marker)?.value !== true) {
    const constructor = descriptor(globalThis, 'Geolocation')?.value, target = constructor && descriptor(constructor, 'prototype')?.value;
    const methods = ['getCurrentPosition', 'watchPosition'];
    for (let index = 0; target && index < methods.length; index++) {
      const field = descriptor(target, methods[index]);
      if (field && typeof field.value === 'function' && (field.configurable || field.writable)) {
        let self; // ADR-112: a denial Proxy refuses to close a prototype cycle through itself (Object.setPrototypeOf(fn, fn)) with the engine's own TypeError, as the native function does.
        const wrapped = self = new NativeProxy(field.value, { apply() { throw new Denial('Geolocation profile unavailable in this frame', 'SecurityError'); }, setPrototypeOf(target, value) { if (value === self) { setProto(target, target); return false; } return reflectSetProto(target, value); } });
        try { define(target, methods[index], { __proto__: null, ...field, value: wrapped }); } catch { /* Non-configurable: nothing more can be done here. */ }
      }
    }
    try { define(globalThis, marker, { __proto__: null, value: true, configurable: false, enumerable: false, writable: false }); } catch { /* Non-extensible realm. */ }
  }
}
