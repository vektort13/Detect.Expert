// ADR-101: native-driven conversion is recorded before a private media backend.
// Round 5: a configuration WITHOUT a key system runs the page's own native call to completion and the answer is that native result lowered
// by the selected flags and the hidden codec families (Custom can only lower, never raise, what this browser reports). Only a key-system
// configuration still stops the native call at the final type conversion and uses the private backend (Custom true rejects it, Custom false
// is virtual unsupported). Keep this factory self-contained for document-start serialization; `codecs` is the shared codec matcher.
export function installMediaCapabilitiesBridge(realm, profile, options, codecs) {
  const previous = installMediaCapabilitiesBridge.__detectExpertMediaBridgeIntrinsicsV1;
  const I = previous || { apply: Reflect.apply, get: Reflect.get, own: Object.getOwnPropertyDescriptor,
    prototype: Object.getPrototypeOf, define: Object.defineProperty, create: Object.create,
    freeze: Object.freeze, setPrototype: Object.setPrototypeOf, keys: Reflect.ownKeys, array: Array.isArray,
    parse: JSON.parse, stringify: JSON.stringify, then: Promise.prototype.then, P: Promise,
    Proxy, TypeError, DOMException: typeof DOMException === 'function' ? DOMException : null,
    primitive: Symbol.toPrimitive, iterator: Symbol.iterator, species: Symbol.species,
    concat: String.prototype.concat, code: String.prototype.charCodeAt, finite: Number.isFinite, floor: Math.floor, ceil: Math.ceil,
    post: realm.postMessage, add: realm.addEventListener, remove: realm.removeEventListener,
    windowOrigin: (() => { let object = realm; for (let depth = 0; object && depth < 16; depth++, object = Object.getPrototypeOf(object)) { const field = Object.getOwnPropertyDescriptor(object, 'origin'); if (field) return typeof field.get === 'function' ? field.get : null; } return null; })(),
    setTimeout, clearTimeout };
  if (!previous) I.define(installMediaCapabilitiesBridge, '__detectExpertMediaBridgeIntrinsicsV1', { __proto__: null, value: I.freeze(I) });
  const MAX = 64, BYTES = 16384, DEADLINE = 5000, pending = [], handles = [];
  const state = { installed: 0, unavailable: 0, changed: 0, pending: 0, stopped: false };
  function own(object, key) { const field = object && I.own(object, key); return field && I.own(field, 'value') ? field.value : undefined; }
  function put(object, key, value) { I.define(object, key, { __proto__: null, value, writable: true, configurable: true, enumerable: true }); }
  function count(key) { if (state[key] < 65535) state[key]++; }
  function bounded(text) {
    if (text.length > BYTES) return false;
    let bytes = 0; for (let index = 0; index < text.length; index++) {
      const code = I.apply(I.code, text, [index]);
      if (code < 128) bytes++; else if (code < 2048) bytes += 2;
      else if (code >= 55296 && code <= 56319 && index + 1 < text.length && I.apply(I.code, text, [index + 1]) >= 56320 && I.apply(I.code, text, [index + 1]) <= 57343) { bytes += 4; index++; } else bytes += 3;
      if (bytes > BYTES) return false;
    } return true;
  }
  function primitive(value) { return value === null || typeof value !== 'object' && typeof value !== 'function'; }
  function owner(object, key) { for (let depth = 0; object && depth < 16; depth++, object = I.prototype(object)) { const field = I.own(object, key); if (field) return { object, field }; } }
  function error(name) { if (name === 'TypeError') return new I.TypeError('Custom media arguments could not be converted'); return I.DOMException ? new I.DOMException('Custom media operation is unavailable', name) : new I.TypeError('Custom media operation is unavailable'); }
  const channel = own(options, 'channel'), bits = own(options, 'bitrateBits') === 64 ? 64 : 32;
  const selected = I.freeze({ supported: own(profile, 'supported'), smooth: own(profile, 'smooth'), powerEfficient: own(profile, 'powerEfficient') });
  const mask = codecs && typeof codecs.mask === 'function' && typeof codecs.families === 'function' ? codecs.mask(profile) : 0;
  const targetObject = own(own(realm, 'Object'), 'prototype') || Object.prototype;
  const targetArray = own(own(realm, 'Array'), 'prototype') || Array.prototype;
  const targetPromise = own(own(realm, 'Promise'), 'prototype') || Promise.prototype;
  const origin = I.windowOrigin ? I.apply(I.windowOrigin, realm, []) : realm.origin, post = I.post, add = I.add, remove = I.remove;
  const nativePrototype = own(own(realm, 'MediaCapabilities'), 'prototype');
  const privateConstructor = I.freeze(I.define(I.create(null), I.species, { __proto__: null, value: I.P }));
  let sequence = 0, listening = false;
  const audio = { __proto__: null, contentType: 'string', channels: 'string', bitrate: 'bitrate', samplerate: 'uint32', spatialRendering: 'boolean' };
  const video = { __proto__: null, contentType: 'string', width: 'uint32', height: 'uint32', bitrate: 'bitrate', framerate: 'double', hdrMetadataType: 'string', colorGamut: 'string', transferFunction: 'string', scalabilityMode: 'string', spatialScalability: 'boolean', hasAlphaChannel: 'boolean' };
  const keySystem = { __proto__: null, keySystem: 'string', initDataType: 'string', distinctiveIdentifier: 'string', persistentState: 'string', sessionTypes: 'sequence', audio: 'track', video: 'track' };
  const track = { __proto__: null, robustness: 'string', encryptionScheme: 'nullable-string' };
  function uint(value, width) {
    if (!I.finite(value) || value === 0) return 0;
    const integer = value < 0 ? I.ceil(value) : I.floor(value), modulus = width === 64 ? 18446744073709551616 : 4294967296;
    const remainder = integer % modulus; return remainder < 0 ? remainder + modulus : remainder;
  }
  function clone(value) {
    if (primitive(value)) return value;
    const output = I.array(value) ? [] : I.create(targetObject), keys = I.keys(value);
    if (I.array(value) && I.prototype(output) !== targetArray) I.setPrototype(output, targetArray);
    for (let index = 0; index < keys.length; index++) { const key = keys[index]; if (key !== 'length') put(output, key, clone(own(value, key))); }
    if (I.array(value)) I.define(output, 'length', { __proto__: null, value: value.length, writable: true });
    return output;
  }
  function recordArguments(args, method) {
    const wire = I.create(null), normalized = I.create(null), marker = I.freeze(I.create(null));
    let complete = false, schemaFailed = false;
    function scalar(value, kind, save) {
      if (kind === 'boolean') { save(!!value, !!value); return value; }
      if (kind === 'nullable-string' && value === null) { save(null, null); return null; }
      return I.define(I.create(null), I.primitive, { __proto__: null, value(hint) {
        if (hint !== (kind === 'string' || kind === 'nullable-string' ? 'string' : 'number')) throw error('TypeError');
        const converted = hint === 'string' ? I.apply(I.concat, '', [value]) : +value;
        if (hint === 'number' && !I.finite(converted)) {
          if (kind === 'double') return converted; // Native finite-double validation rejects before type.
          save(0, 0); return converted;
        }
        const normalized = kind === 'uint32' ? uint(converted, 32) : kind === 'bitrate' ? uint(converted, bits) : converted;
        save(converted === 0 ? 0 : converted, normalized); return converted;
      } });
    }
    function strings(value, output, normalized) {
      if (primitive(value)) return value;
      return new I.Proxy(value, { get(_target, key) {
        const member = I.get(value, key, value);
        if (key !== I.iterator || typeof member !== 'function') return member;
        return function() {
          const iterator = I.apply(member, value, arguments); if (primitive(iterator)) return iterator;
          return new I.Proxy(iterator, { get(_iterator, name) {
            const item = I.get(iterator, name, iterator);
            if (name !== 'next' || typeof item !== 'function') return typeof item === 'function' ? function() { return I.apply(item, iterator, arguments); } : item;
            return function() {
              const result = I.apply(item, iterator, arguments); if (primitive(result)) return result;
              return new I.Proxy(result, { get(_result, field) {
                const entry = I.get(result, field, result);
                if (field !== 'value') return entry;
                return scalar(entry, 'string', (encoded, plain) => {
                  if (output.length >= 4096) { schemaFailed = true; throw error('TypeError'); }
                  put(output, output.length, encoded); put(normalized, normalized.length, plain);
                });
              } });
            };
          } });
        };
      } });
    }
    function dictionary(value, shape, output, normalized) {
      if (value === undefined || value === null || primitive(value)) return value;
      return new I.Proxy(I.create(null), { get(_target, key) {
        const member = I.get(value, key, value), kind = own(shape, key);
        if (!kind) { if (member !== undefined) { schemaFailed = true; throw error('TypeError'); } return member; }
        if (member === undefined) return member;
        if (kind === 'track') {
          const nested = I.create(null), plain = I.create(null); put(output, key, nested); put(normalized, key, plain);
          return dictionary(member, track, nested, plain);
        }
        if (kind === 'sequence') {
          const nested = [], plain = []; put(output, key, nested); put(normalized, key, plain); return strings(member, nested, plain);
        }
        return scalar(member, kind, (encoded, plain) => { put(output, key, encoded); put(normalized, key, plain); });
      } });
    }
    const input = args.length ? args[0] : undefined;
    if (input === undefined || input === null || primitive(input)) return { args, wire, normalized, marker, complete: () => false, direct: () => false };
    const proxy = new I.Proxy(I.create(null), { get(_target, key) {
      const value = I.get(input, key, input);
      if (key === 'audio' || key === 'video' || key === 'keySystemConfiguration' && method === 'decodingInfo') {
        if (value === undefined) return value;
        const nested = I.create(null), plain = I.create(null); put(wire, key, nested); put(normalized, key, plain);
        return dictionary(value, key === 'audio' ? audio : key === 'video' ? video : keySystem, nested, plain);
      }
      if (key !== 'type') { if (value !== undefined) { schemaFailed = true; throw error('TypeError'); } return value; }
      if (value === undefined) return value;
      return scalar(value, 'string', (encoded, plain) => {
        // An unknown enum value is left to the native converter, which rejects it with its own TypeError (round 5: the page sees the native message).
        if (method === 'decodingInfo' ? encoded !== 'file' && encoded !== 'media-source' && encoded !== 'webrtc' : encoded !== 'record' && encoded !== 'webrtc') return;
        put(wire, 'type', encoded); put(normalized, 'type', plain); complete = !schemaFailed;
        // No key system: let the native call run on; a key-system configuration stops here and goes to the private backend.
        if (own(wire, 'keySystemConfiguration') !== undefined) throw marker;
      });
    } });
    const next = []; for (let index = 0; index < args.length; index++) put(next, index, index === 0 ? proxy : args[index]);
    return { args: next, wire, normalized, marker, complete: () => complete, direct: () => complete && own(wire, 'keySystemConfiguration') === undefined };
  }
  // The native result with every own data field kept in native order (handles and optional fields included) and the three flags lowered:
  // supported = native AND selected AND no hidden family in the audio/video codec strings the native conversion saw; smooth and
  // powerEfficient additionally need support. A native false, an unreadable flag or a non-boolean is never raised.
  function lowered(value, plain) {
    if (primitive(value)) return value;
    let hidden = false;
    if (mask !== 0) {
      const rtc = own(plain, 'type') === 'webrtc', tracks = ['audio', 'video'];
      for (let index = 0; index < tracks.length; index++) { const type = own(own(plain, tracks[index]), 'contentType'); if (typeof type === 'string' && (codecs.families(type, rtc) & mask) !== 0) hidden = true; }
    }
    const shown = own(value, 'supported') === true && own(selected, 'supported') === true && !hidden;
    const output = I.create(targetObject), keys = I.keys(value);
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index], field = key === '__proto__' ? undefined : I.own(value, key);
      if (!field || !I.own(field, 'value')) continue;
      const kept = key === 'supported' ? shown : key === 'smooth' || key === 'powerEfficient' ? shown && field.value === true && own(selected, key) === true : field.value;
      I.define(output, key, { __proto__: null, value: kept, writable: true, configurable: true, enumerable: field.enumerable === true });
    }
    return output;
  }
  // The page gets its own Promise (never the native one); a native rejection keeps its identity, and so do its message and name.
  function deliver(native, plain) {
    let resolve, reject; const result = new I.P((accept, deny) => { resolve = accept; reject = deny; });
    if (I.prototype(result) !== targetPromise) I.setPrototype(result, targetPromise);
    try {
      I.define(native, 'constructor', { __proto__: null, value: privateConstructor });
      I.apply(I.then, native, [value => {
        let output; try { output = lowered(value, plain); } catch { count('unavailable'); reject(error('NotSupportedError')); return; }
        count('changed'); resolve(output);
      }, reason => reject(reason)]);
    } catch { count('unavailable'); reject(error('NotSupportedError')); }
    return result;
  }
  function detach() { if (listening && state.stopped && state.pending === 0) { I.apply(remove, realm, ['message', receive]); listening = false; } }
  function finish(slot, item, value, reason, rejected = true) {
    if (own(pending, slot) !== item) return;
    put(pending, slot, null); state.pending--; I.apply(I.clearTimeout, realm, [item.timer]);
    item.argument = null; item.normalized = null;
    if (rejected) item.reject(reason); else { count('changed'); item.resolve(value); }
    detach();
  }
  function receive(event) {
    if (event.origin !== origin || typeof event.data !== 'string' || !bounded(event.data)) return;
    let response; try { response = I.parse(event.data); } catch { return; }
    if (response === null || typeof response !== 'object' || I.keys(response).length !== 5 || own(response, 'channel') !== channel || own(response, 'kind') !== 'result') return;
    let slot = 0, item; for (; slot < MAX; slot++) { const candidate = own(pending, slot); if (candidate && candidate.id === own(response, 'id')) { item = candidate; break; } }
    if (!item) return;
    if (own(response, 'status') === 'rejected') {
      const name = own(response, 'error'), allowed = ['TypeError', 'SecurityError', 'InvalidStateError', 'NotSupportedError', 'NotAllowedError', 'AbortError', 'TimeoutError', 'QuotaExceededError'];
      let known = false; for (let index = 0; index < allowed.length; index++) if (name === allowed[index]) known = true;
      if (known) finish(slot, item, null, error(name)); return;
    }
    if (own(response, 'status') !== 'fulfilled') return;
    const fields = own(response, 'fields'); if (!I.array(fields) || fields.length > 5) return;
    const output = I.create(targetObject), seen = I.create(null);
    for (let index = 0; index < fields.length; index++) {
      const key = own(fields, index); if (typeof key !== 'string' || own(seen, key)) return; put(seen, key, true);
      if (key === 'supported' || key === 'smooth' || key === 'powerEfficient') put(output, key, own(selected, key));
      else if (key === 'keySystemAccess') put(output, key, null);
      else if (key === 'configuration') put(output, key, clone(item.normalized));
      else return;
    }
    if (!own(seen, 'supported') || !own(seen, 'smooth') || !own(seen, 'powerEfficient')) return;
    finish(slot, item, output, undefined, false);
  }
  function dispatch(slot, item) {
    if (own(pending, slot) !== item) return;
    const request = I.create(null); put(request, 'channel', channel); put(request, 'kind', 'request'); put(request, 'id', item.id); put(request, 'method', item.method); put(request, 'argument', item.argument);
    let encoded; try { encoded = I.stringify(request); } catch { count('unavailable'); finish(slot, item, null, error('TypeError')); return; }
    if (!bounded(encoded)) { count('unavailable'); finish(slot, item, null, error('QuotaExceededError')); return; }
    item.argument = null;
    try { I.apply(post, realm, [encoded, '*']); } catch { count('unavailable'); finish(slot, item, null, error('NotSupportedError')); }
  }
  if (typeof channel !== 'string' || channel.length < 16 || channel.length > 128 || typeof selected.supported !== 'boolean' || typeof selected.smooth !== 'boolean' || typeof selected.powerEfficient !== 'boolean' || typeof post !== 'function' || typeof add !== 'function' || typeof remove !== 'function' || !nativePrototype) count('unavailable');
  else {
    I.apply(add, realm, ['message', receive]); listening = true;
    const methods = ['decodingInfo', 'encodingInfo'];
    for (let index = 0; index < methods.length; index++) {
      const key = methods[index], found = owner(nativePrototype, key), original = found && own(found.field, 'value');
      if (!found || !found.field.configurable || typeof original !== 'function') { count('unavailable'); continue; }
      const { call } = { call() {
        'use strict';
        if (state.stopped) return I.apply(original, this, arguments);
        if (state.pending >= MAX || sequence >= 9007199254740991) { count('unavailable'); return new I.P((_, reject) => reject(error('QuotaExceededError'))); }
        const recorded = recordArguments(arguments, key), native = I.apply(original, this, recorded.args);
        if (recorded.direct()) return deliver(native, recorded.normalized);
        let slot = 0; while (own(pending, slot)) slot++;
        let resolve, reject; const result = new I.P((accept, deny) => { resolve = accept; reject = deny; });
        if (I.prototype(result) !== targetPromise) I.setPrototype(result, targetPromise);
        const item = { id: channel + ':' + ++sequence, method: key, argument: recorded.wire, normalized: recorded.normalized, resolve, reject, timer: null }; put(pending, slot, item); state.pending++;
        item.timer = I.apply(I.setTimeout, realm, [() => { count('unavailable'); finish(slot, item, null, error('TimeoutError')); }, DEADLINE]);
        try {
          I.define(native, 'constructor', { __proto__: null, value: privateConstructor });
          I.apply(I.then, native, [() => { count('unavailable'); finish(slot, item, null, error('NotSupportedError')); }, reason => {
            if (reason !== recorded.marker || !recorded.complete()) finish(slot, item, null, reason);
            else dispatch(slot, item);
          }]);
        } catch { count('unavailable'); finish(slot, item, null, error('NotSupportedError')); }
        return result;
      } };
      const next = { __proto__: null, value: call, writable: found.field.writable === true, enumerable: found.field.enumerable === true, configurable: true };
      try { I.define(found.object, key, next); put(handles, handles.length, { object: found.object, key, previous: found.field, value: call }); state.installed++; } catch { count('unavailable'); }
    }
  }
  return { stop() {
    if (state.stopped) return; state.stopped = true;
    for (let index = handles.length - 1; index >= 0; index--) { const item = own(handles, index), actual = I.own(item.object, item.key); if (actual && own(actual, 'value') === item.value) try { I.define(item.object, item.key, item.previous); } catch { count('unavailable'); } }
    detach();
  }, snapshot() { return { ...state }; } };
}
