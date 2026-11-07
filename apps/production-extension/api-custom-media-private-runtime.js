// ADR-101: private extension-principal codec backend; no runtime/window channel.
// Caller authenticates MessageSender/document/scope and supplies trusted current
// profile/channel. Neither is accepted from a page request.
export function createPrivateMediaCapabilitiesBackend(realm) {
  const I = { apply: Reflect.apply, own: Object.getOwnPropertyDescriptor, keys: Reflect.ownKeys,
    define: Object.defineProperty, create: Object.create, parse: JSON.parse, stringify: JSON.stringify,
    code: String.prototype.charCodeAt, then: Promise.prototype.then, P: Promise,
    species: Symbol.species, freeze: Object.freeze, finite: Number.isFinite,
    array: Array.isArray, setTimeout, clearTimeout };
  const MAX = 64, BYTES = 16384, DEADLINE = 5000, slots = [];
  const state = { installed: 0, unavailable: 0, completed: 0, pending: 0, physical: 0, stopped: false };
  function own(object, key) { const field = object && I.own(object, key); return field && I.own(field, 'value') ? field.value : undefined; }
  function put(object, key, value) { I.define(object, key, { __proto__: null, value, configurable: true, writable: true, enumerable: true }); }
  function count(key) { if (state[key] < 65535) state[key]++; }
  function allowed(key, values) { for (let index = 0; index < values.length; index++) if (values[index] === key) return true; return false; }
  function bounded(text) {
    if (text.length > BYTES) return false;
    let bytes = 0; for (let index = 0; index < text.length; index++) {
      const code = I.apply(I.code, text, [index]);
      if (code < 128) bytes++; else if (code < 2048) bytes += 2;
      else if (code >= 55296 && code <= 56319 && index + 1 < text.length && I.apply(I.code, text, [index + 1]) >= 56320 && I.apply(I.code, text, [index + 1]) <= 57343) { bytes += 4; index++; } else bytes += 3;
      if (bytes > BYTES) return false;
    } return true;
  }
  const receiver = realm.navigator && realm.navigator.mediaCapabilities;
  const decode = receiver && receiver.decodingInfo, encode = receiver && receiver.encodingInfo;
  if (typeof decode === 'function') state.installed++; if (typeof encode === 'function') state.installed++;
  const privateConstructor = I.freeze(I.define(I.create(null), I.species, { __proto__: null, value: I.P }));
  const rootKeys = ['audio', 'video', 'keySystemConfiguration', 'type'];
  const audioKeys = ['contentType', 'channels', 'bitrate', 'samplerate', 'spatialRendering'];
  const videoKeys = ['contentType', 'width', 'height', 'bitrate', 'framerate', 'hdrMetadataType', 'colorGamut', 'transferFunction', 'scalabilityMode', 'spatialScalability', 'hasAlphaChannel'];
  const keyKeys = ['keySystem', 'initDataType', 'distinctiveIdentifier', 'persistentState', 'sessionTypes', 'audio', 'video'];
  const trackKeys = ['robustness', 'encryptionScheme'];
  function object(value) { return value !== null && typeof value === 'object' && !I.array(value); }
  function valid(value, kind) {
    if (!object(value)) return false;
    const keys = I.keys(value), accepted = kind === 'root' ? rootKeys : kind === 'audio' ? audioKeys : kind === 'video' ? videoKeys : kind === 'key' ? keyKeys : trackKeys;
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index], item = own(value, key);
      if (typeof key !== 'string' || !allowed(key, accepted)) return false;
      if (kind === 'root' && (key === 'audio' || key === 'video')) { if (!valid(item, key)) return false; }
      else if (kind === 'root' && key === 'keySystemConfiguration') { if (!valid(item, 'key')) return false; }
      else if (kind === 'key' && (key === 'audio' || key === 'video')) { if (!valid(item, 'track')) return false; }
      else if (kind === 'key' && key === 'sessionTypes') {
        if (!I.array(item) || item.length > 4096) return false;
        for (let itemIndex = 0; itemIndex < item.length; itemIndex++) if (typeof own(item, itemIndex) !== 'string') return false;
      } else if (key === 'spatialRendering' || key === 'spatialScalability' || key === 'hasAlphaChannel') { if (typeof item !== 'boolean') return false; }
      else if (key === 'bitrate' || key === 'samplerate' || key === 'width' || key === 'height' || key === 'framerate') { if (typeof item !== 'number' || !I.finite(item)) return false; }
      else if (key === 'encryptionScheme') { if (item !== null && typeof item !== 'string') return false; }
      else if (typeof item !== 'string') return false;
    }
    return true;
  }
  function reply(channel, id, status, fields, error) {
    const output = I.create(null); put(output, 'channel', channel); put(output, 'kind', 'result'); put(output, 'id', id); put(output, 'status', status);
    if (fields) put(output, 'fields', fields); if (error) put(output, 'error', error);
    return I.stringify(output);
  }
  function errorName(error) {
    // No native message/stack, physical flags, dictionary or opaque handle leaves.
    try { const name = error && error.name; return allowed(name, ['TypeError', 'SecurityError', 'InvalidStateError', 'NotSupportedError', 'NotAllowedError', 'AbortError']) ? name : 'NotSupportedError'; }
    catch { return 'NotSupportedError'; }
  }
  function finish(slot, item, status, fields, error) {
    if (own(slots, slot) !== item || item.replied) return;
    item.replied = true; state.pending--; I.apply(I.clearTimeout, realm, [item.timer]); count('completed');
    item.resolve(reply(item.channel, item.id, status, fields, error));
  }
  function physicalDone(slot, item) { if (own(slots, slot) === item) { put(slots, slot, null); state.physical--; } }
  function settled(value) { return new I.P(resolve => resolve(value)); }
  return {
    run(serialized, profile, channel) {
      if (typeof serialized !== 'string' || !bounded(serialized) || typeof channel !== 'string' || channel.length < 16 || channel.length > 128) { count('unavailable'); return settled(null); }
      let request; try { request = I.parse(serialized); } catch { count('unavailable'); return settled(null); }
      const id = own(request, 'id'), method = own(request, 'method'); let argument = own(request, 'argument');
      if (!object(request) || I.keys(request).length !== 5 || own(request, 'channel') !== channel || own(request, 'kind') !== 'request' || typeof id !== 'string' || id.length < 1 || id.length > 256 || method !== 'decodingInfo' && method !== 'encodingInfo' || !valid(argument, 'root')) { count('unavailable'); return settled(null); }
      const supported = own(profile, 'supported'), smooth = own(profile, 'smooth'), efficient = own(profile, 'powerEfficient');
      if (typeof supported !== 'boolean' || typeof smooth !== 'boolean' || typeof efficient !== 'boolean') { count('unavailable'); return settled(null); }
      const deny = name => settled(reply(channel, id, 'rejected', null, name));
      const original = method === 'decodingInfo' ? decode : encode;
      if (state.stopped) return deny('AbortError');
      if (typeof original !== 'function') return deny('NotSupportedError');
      if (state.physical >= MAX) { count('unavailable'); return deny('QuotaExceededError'); }
      const key = own(argument, 'keySystemConfiguration');
      if (key !== undefined) {
        if (method !== 'decodingInfo' || own(argument, 'type') === 'webrtc' || own(key, 'audio') !== undefined && own(argument, 'audio') === undefined || own(key, 'video') !== undefined && own(argument, 'video') === undefined || !own(key, 'keySystem')) return deny('TypeError');
        if (supported) return deny('NotSupportedError');
        // Custom false is explicitly virtual for DRM. Native no-DRM codec/config
        // validation remains; EME availability/policy and handles are not queried.
        delete argument.keySystemConfiguration;
      }
      let slot = 0; while (own(slots, slot)) slot++;
      let resolve; const output = new I.P(accept => { resolve = accept; });
      const item = { id, channel, resolve, timer: null, replied: false }; put(slots, slot, item); state.pending++; state.physical++;
      item.timer = I.apply(I.setTimeout, realm, [() => { count('unavailable'); finish(slot, item, 'rejected', null, 'TimeoutError'); }, DEADLINE]);
      let nativeStarted = false;
      try {
        const source = I.apply(original, receiver, [argument]); nativeStarted = true; argument = null; request = null;
        I.define(source, 'constructor', { __proto__: null, value: privateConstructor });
        I.apply(I.then, source, [value => {
          if (own(slots, slot) !== item) return;
          if (item.replied) { physicalDone(slot, item); return; }
          try {
            const fields = [], keys = I.keys(value), accepted = ['supported', 'smooth', 'powerEfficient', 'keySystemAccess', 'configuration'];
            if (keys.length > 16 || !I.own(value, 'supported') || !I.own(value, 'smooth') || !I.own(value, 'powerEfficient')) throw 0;
            for (let index = 0; index < keys.length; index++) if (allowed(keys[index], accepted)) put(fields, fields.length, keys[index]);
            finish(slot, item, 'fulfilled', fields);
          } catch { count('unavailable'); finish(slot, item, 'rejected', null, 'NotSupportedError'); }
          finally { physicalDone(slot, item); }
        }, error => { try { finish(slot, item, 'rejected', null, errorName(error)); } finally { physicalDone(slot, item); } }]);
      } catch (error) { argument = null; request = null; finish(slot, item, 'rejected', null, errorName(error)); if (!nativeStarted) physicalDone(slot, item); }
      return output;
    },
    stop() { state.stopped = true; },
    snapshot() { return { ...state }; }
  };
}
