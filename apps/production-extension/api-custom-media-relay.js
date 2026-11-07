// ADR-101: unprivileged page routing only; background authenticates the native
// MessageSender/current document and selects the effective trusted profile.
(() => {
  function installMediaCapabilitiesRelay(realm, runtime) {
    const I = { apply: Reflect.apply, own: Object.getOwnPropertyDescriptor, keys: Reflect.ownKeys,
      define: Object.defineProperty, create: Object.create, parse: JSON.parse, stringify: JSON.stringify,
      array: Array.isArray, finite: Number.isFinite, code: String.prototype.charCodeAt,
      then: Promise.prototype.then, species: Symbol.species, P: Promise, freeze: Object.freeze,
      setTimeout, clearTimeout, now: Date.now };
    const MAX = 64, BYTES = 16384, DEADLINE = 5000, slots = [], state = { pending: 0, relayed: 0, dropped: 0, stopped: false };
    const origin = realm.origin, post = realm.postMessage, add = realm.addEventListener, remove = realm.removeEventListener;
    const send = runtime && runtime.sendMessage;
    const privateConstructor = I.freeze(I.define(I.create(null), I.species, { __proto__: null, value: I.P }));
    let started = I.now(), requests = 0;
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
    function object(value) { return value !== null && typeof value === 'object' && !I.array(value); }
    function allowed(key, values) { for (let index = 0; index < values.length; index++) if (values[index] === key) return true; return false; }
    const rootKeys = ['audio', 'video', 'keySystemConfiguration', 'type'];
    const audioKeys = ['contentType', 'channels', 'bitrate', 'samplerate', 'spatialRendering'];
    const videoKeys = ['contentType', 'width', 'height', 'bitrate', 'framerate', 'hdrMetadataType', 'colorGamut', 'transferFunction', 'scalabilityMode', 'spatialScalability', 'hasAlphaChannel'];
    const keyKeys = ['keySystem', 'initDataType', 'distinctiveIdentifier', 'persistentState', 'sessionTypes', 'audio', 'video'];
    const trackKeys = ['robustness', 'encryptionScheme'];
    function canonical(value, kind) {
      if (!object(value)) return false;
      const keys = I.keys(value), accepted = kind === 'root' ? rootKeys : kind === 'audio' ? audioKeys : kind === 'video' ? videoKeys : kind === 'key' ? keyKeys : trackKeys;
      for (let index = 0; index < keys.length; index++) {
        const key = keys[index], item = own(value, key); if (!allowed(key, accepted)) return false;
        if (kind === 'root' && (key === 'audio' || key === 'video')) { if (!canonical(item, key)) return false; }
        else if (kind === 'root' && key === 'keySystemConfiguration') { if (!canonical(item, 'key')) return false; }
        else if (kind === 'key' && (key === 'audio' || key === 'video')) { if (!canonical(item, 'track')) return false; }
        else if (kind === 'key' && key === 'sessionTypes') { if (!I.array(item) || item.length > 4096) return false; for (let itemIndex = 0; itemIndex < item.length; itemIndex++) if (typeof own(item, itemIndex) !== 'string') return false; }
        else if (key === 'spatialRendering' || key === 'spatialScalability' || key === 'hasAlphaChannel') { if (typeof item !== 'boolean') return false; }
        else if (key === 'bitrate' || key === 'samplerate' || key === 'width' || key === 'height' || key === 'framerate') { if (typeof item !== 'number' || !I.finite(item)) return false; }
        else if (key === 'encryptionScheme') { if (item !== null && typeof item !== 'string') return false; }
        else if (typeof item !== 'string') return false;
      } return true;
    }
    function channel(value) { return typeof value === 'string' && /^detect-expert-media-v1:[01]{3}$/.test(value); }
    function postResult(encoded) { try { I.apply(post, realm, [encoded, '*']); } catch { count('dropped'); } }
    function deny(item, name) {
      const output = I.create(null); put(output, 'channel', item.channel); put(output, 'kind', 'result'); put(output, 'id', item.id); put(output, 'status', 'rejected'); put(output, 'error', name); postResult(I.stringify(output));
    }
    function validReply(encoded, item) {
      if (typeof encoded !== 'string' || !bounded(encoded)) return false;
      let value; try { value = I.parse(encoded); } catch { return false; }
      if (!object(value) || I.keys(value).length !== 5 || own(value, 'channel') !== item.channel || own(value, 'kind') !== 'result' || own(value, 'id') !== item.id) return false;
      if (own(value, 'status') === 'rejected') return allowed(own(value, 'error'), ['TypeError', 'SecurityError', 'InvalidStateError', 'NotSupportedError', 'NotAllowedError', 'AbortError', 'TimeoutError', 'QuotaExceededError']);
      const fields = own(value, 'fields'); if (own(value, 'status') !== 'fulfilled' || !I.array(fields) || fields.length < 3 || fields.length > 5) return false;
      const seen = I.create(null); for (let index = 0; index < fields.length; index++) { const key = own(fields, index); if (!allowed(key, ['supported', 'smooth', 'powerEfficient', 'keySystemAccess', 'configuration']) || own(seen, key)) return false; put(seen, key, true); }
      return !!own(seen, 'supported') && !!own(seen, 'smooth') && !!own(seen, 'powerEfficient');
    }
    function finish(slot, item, response, failure) {
      if (own(slots, slot) !== item) return;
      put(slots, slot, null); state.pending--; I.apply(I.clearTimeout, realm, [item.timer]);
      if (failure) deny(item, failure); else if (validReply(response, item)) postResult(response); else { count('dropped'); deny(item, 'NotSupportedError'); }
    }
    function receive(event) {
      if (state.stopped || !event.source || event.source !== realm && event.origin !== origin || typeof event.data !== 'string' || !bounded(event.data)) return;
      let value; try { value = I.parse(event.data); } catch { return; }
      if (!object(value) || I.keys(value).length !== 5 || !channel(own(value, 'channel')) || own(value, 'kind') !== 'request' || typeof own(value, 'id') !== 'string' || value.id.length < 1 || value.id.length > 256 || !allowed(own(value, 'method'), ['decodingInfo', 'encodingInfo']) || !canonical(own(value, 'argument'), 'root')) { count('dropped'); return; }
      const item = { id: own(value, 'id'), channel: own(value, 'channel'), timer: null };
      const now = I.now(); if (now < started || now - started >= 1000) { started = now; requests = 0; }
      if (state.pending >= MAX || requests >= MAX) { count('dropped'); deny(item, 'QuotaExceededError'); return; }
      if (typeof send !== 'function') { count('dropped'); deny(item, 'NotSupportedError'); return; }
      requests++; let slot = 0; while (own(slots, slot)) slot++; put(slots, slot, item); state.pending++; count('relayed');
      item.timer = I.apply(I.setTimeout, realm, [() => finish(slot, item, null, 'TimeoutError'), DEADLINE]);
      try {
        const result = I.apply(send, runtime, [{ schemaVersion: 1, type: 'api-custom-media-request', payload: { serialized: event.data } }]);
        I.define(result, 'constructor', { __proto__: null, value: privateConstructor });
        I.apply(I.then, result, [response => finish(slot, item, response, null), () => finish(slot, item, null, 'NotSupportedError')]);
      } catch { finish(slot, item, null, 'NotSupportedError'); }
    }
    I.apply(add, realm, ['message', receive]);
    return { stop() { if (state.stopped) return; state.stopped = true; I.apply(remove, realm, ['message', receive]); }, snapshot() { return { ...state }; } };
  }
  installMediaCapabilitiesRelay(globalThis, (typeof chrome !== 'undefined' ? chrome : globalThis.browser)?.runtime);
})();
