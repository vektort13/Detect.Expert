// Round 5 (ADR-101 amendment): HTMLMediaElement.canPlayType and the isTypeSupported statics of MediaSource, ManagedMediaSource and
// MediaRecorder report a hidden codec family as unsupported. Strictly downward: a native '' or false is never raised, and a call,
// receiver, argument or exception the matcher does not recognize stays exactly native (the original runs once, first, with the
// original this and arguments; only a primitive string first argument is read, nothing is coerced).
// Keep this factory self-contained for document-start serialization; the matcher object comes from api-custom-media-codecs.js.
export function installMediaTypeHooks(realm, mask, codecs) {
  // Descendant realms reuse the intrinsics captured by the first installation, even if the page replaced globals since.
  const previous = installMediaTypeHooks.__detectExpertMediaTypeIntrinsicsV1;
  const I = previous || { apply: Reflect.apply, own: Object.getOwnPropertyDescriptor, prototype: Object.getPrototypeOf, define: Object.defineProperty, freeze: Object.freeze };
  if (!previous) I.define(installMediaTypeHooks, '__detectExpertMediaTypeIntrinsicsV1', { __proto__: null, value: I.freeze(I) });
  const handles = [], state = { installed: 0, unavailable: 0, changed: 0, stopped: false };
  function own(object, key) { const field = object && I.own(object, key); return field && I.own(field, 'value') ? field.value : undefined; }
  function put(array, value) { I.define(array, array.length, { __proto__: null, value, writable: true, configurable: true, enumerable: true }); }
  function count(key) { if (state[key] < 65535) state[key]++; }
  // ADR-112: a replacement function reports the name and length of the function it replaces. Two descriptors are copied (the compatibility
  // measure docs/PROJECT_RULES.md allows); Function.prototype.toString is not touched.
  function matchMeta(replacement, source) {
    for (const metaKey of ['length', 'name']) { const value = own(source, metaKey); if (value !== undefined) { try { I.define(replacement, metaKey, { __proto__: null, value, writable: false, enumerable: false, configurable: true }); } catch { /* keep the default */ } } }
  }
  function owner(object, key) { for (let depth = 0; object && depth < 16; depth++, object = I.prototype(object)) { const field = I.own(object, key); if (field) return { object, field }; } }
  // `text` marks canPlayType ('maybe' / 'probably' become ''), otherwise isTypeSupported (true becomes false).
  function hook(target, key, text) {
    const found = owner(target, key), original = found && own(found.field, 'value');
    if (!found || !found.field.configurable || typeof original !== 'function') { count('unavailable'); return; }
    // ManagedMediaSource inherits the static of MediaSource: one wrapper per owning object.
    for (let index = 0; index < handles.length; index++) if (handles[index].object === found.object && handles[index].key === key) return;
    const customMediaType = { customMediaType() {
      'use strict';
      const native = I.apply(original, this, arguments);
      if (state.stopped || (text ? native !== 'maybe' && native !== 'probably' : native !== true)) return native;
      const type = arguments.length > 0 ? arguments[0] : undefined;
      if (typeof type !== 'string') return native;
      let hidden = false;
      try { hidden = (codecs.families(type, false) & mask) !== 0; } catch { count('unavailable'); }
      if (!hidden) return native;
      count('changed');
      return text ? '' : false;
    } }.customMediaType;
    matchMeta(customMediaType, original);
    try {
      I.define(found.object, key, { __proto__: null, value: customMediaType, writable: found.field.writable === true, enumerable: found.field.enumerable === true, configurable: true });
      put(handles, { object: found.object, key, previous: found.field, value: customMediaType }); count('installed');
    } catch { count('unavailable'); }
  }
  // A zero mask hides nothing: no hook is installed at all.
  if (mask === 0) { /* native everywhere */ }
  else if (typeof mask === 'number' && codecs && typeof codecs.families === 'function') {
    const element = own(own(realm, 'HTMLMediaElement'), 'prototype');
    if (element) hook(element, 'canPlayType', true);
    const names = ['MediaSource', 'ManagedMediaSource', 'MediaRecorder'];
    for (let index = 0; index < names.length; index++) { const constructor = own(realm, names[index]); if (typeof constructor === 'function') hook(constructor, 'isTypeSupported', false); }
  } else count('unavailable');
  return { stop() {
    if (state.stopped) return; state.stopped = true;
    for (let index = handles.length - 1; index >= 0; index--) {
      const item = handles[index], actual = I.own(item.object, item.key);
      if (actual && own(actual, 'value') === item.value) { try { I.define(item.object, item.key, item.previous); } catch { count('unavailable'); } }
    }
  }, snapshot() { return { ...state }; } };
}
