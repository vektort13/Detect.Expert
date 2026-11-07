// E22-08 / ADR-048/049: explicit testing metadata; no connection or device is created by this installer.
// Serialized into the existing private document-start installer. Keep this function self-contained.
export function installWebRtcCustom(realm, entries) {
  const cached = installWebRtcCustom.__detectExpertRtcIntrinsicsV1;
  const I = cached || {
    apply: Reflect.apply, construct: Reflect.construct, get: Reflect.get,
    descriptor: Object.getOwnPropertyDescriptor, define: Object.defineProperty, prototype: Object.getPrototypeOf,
    setPrototype: Object.setPrototypeOf, reflectSetPrototype: Reflect.setPrototypeOf, keys: Reflect.ownKeys, create: Object.create,
    hasOwn: Object.hasOwn, isArray: Array.isArray, NativeProxy: Proxy, NativeWeakMap: WeakMap,
    weakGet: WeakMap.prototype.get, weakSet: WeakMap.prototype.set,
    NativeMap: Map, mapGet: Map.prototype.get, mapSet: Map.prototype.set, mapHas: Map.prototype.has,
    mapClear: Map.prototype.clear, mapDelete: Map.prototype.delete, mapKeys: Map.prototype.keys,
    mapSize: Object.getOwnPropertyDescriptor(Map.prototype, 'size').get,
    mapForEach: Map.prototype.forEach, mapEntries: Map.prototype.entries, mapValues: Map.prototype.values,
    mapIterator: Map.prototype[Symbol.iterator], iteratorSymbol: Symbol.iterator, primitiveSymbol: Symbol.toPrimitive,
    NativeTextEncoder: TextEncoder, NativeUint8Array: Uint8Array, encode: TextEncoder.prototype.encode,
    then: Promise.prototype.then, NativePromise: Promise, speciesSymbol: Symbol.species, NativeTypeError: TypeError, promiseBoundaries: new WeakMap(), split: String.prototype.split, slice: String.prototype.slice,
    join: Array.prototype.join, indexOf: String.prototype.indexOf, charCode: String.prototype.charCodeAt,
    lower: String.prototype.toLowerCase, exec: RegExp.prototype.exec, freeze: Object.freeze,
    windowOrigin: (() => { let target=realm;for(let depth=0;target&&depth<16;depth++,target=Object.getPrototypeOf(target)){const field=Object.getOwnPropertyDescriptor(target,'origin');if(field)return typeof field.get==='function'?field.get:null;}return null; })()
  };
  if (!cached) {
    I.privatePromiseConstructor = I.freeze(I.define(I.create(null), I.speciesSymbol, { __proto__: null, value: I.NativePromise }));
    I.define(installWebRtcCustom, '__detectExpertRtcIntrinsicsV1', { value: I.freeze(I) });
  }
  const { apply, construct, descriptor, define, hasOwn } = I;
  const handles = [], rows = [], state = { installed: 0, unavailable: 0, changed: 0, stopped: false };
  let current, critical = false;
  function push(array, value) { define(array, array.length, { __proto__: null, value, configurable: true, enumerable: true, writable: true }); }
  function each(array, callback) { for (let index = 0; index < array.length; index++) callback(array[index], index); }
  function own(object, key) {
    if (object === null || typeof object !== 'object' && typeof object !== 'function') return undefined;
    const field = descriptor(object, key); return field && hasOwn(field, 'value') ? field.value : undefined;
  }
  function owner(object, key) {
    for (let depth = 0; object && depth < 16; depth++, object = I.prototype(object)) {
      const field = descriptor(object, key); if (field) return { target: object, field };
    }
    return null;
  }
  const prototype = name => own(own(realm, name), 'prototype');
  const stringSplit = (value, separator) => apply(I.split, value, [separator]);
  const stringSlice = (value, start, end) => apply(I.slice, value, [start, end]);
  const join = (value, separator) => apply(I.join, value, [separator]);
  const test = (pattern, value) => apply(I.exec, pattern, [value]) !== null;
  const getMap = (map, key) => apply(I.mapGet, map, [key]);
  const setMap = (map, key, value) => apply(I.mapSet, map, [key, value]);
  const size = map => apply(I.mapSize, map, []);
  const getWeak = (map, key) => key !== null && (typeof key === 'object' || typeof key === 'function') ? apply(I.weakGet, map, [key]) : undefined;
  const setWeak = (map, key, value) => apply(I.weakSet, map, [key, value]);
  function dataField(target, key) {
    const field = descriptor(target, key);
    return field && hasOwn(field, 'value') ? { target, key, value: field.value, absent: false } : null;
  }
  function promiseBoundary(target) {
    const previous = getWeak(I.promiseBoundaries, target);
    if (previous) return previous;
    let result = { safe: false };
    try {
      const fields = [], chains = [];
      const data = (object, key) => {
        const field = dataField(object, key);
        if (!field) throw 0;
        push(fields, field); return field.value;
      };
      const chain = (start, key) => {
        let value = start;
        for (let depth = 0; value !== null; depth++) {
          if (depth >= 16) throw 0;
          const field = descriptor(value, key), parent = I.prototype(value);
          if (field && (!hasOwn(field, 'value') || typeof field.value === 'function')) throw 0;
          push(chains, { target: value, parent, key, entry: field ? { value: field.value } : null });
          if (field) break;
          value = parent;
        }
      };
      const P = data(target, 'Promise'), O = data(target, 'Object'), A = data(target, 'Array');
      if (typeof P !== 'function' || typeof O !== 'function' || typeof A !== 'function') throw 0;
      const promise = data(P, 'prototype'), object = data(O, 'prototype'), array = data(A, 'prototype');
      if (!promise || !object || !array || typeof promise !== 'object' || typeof object !== 'object' || typeof array !== 'object' || data(promise, 'constructor') !== P) throw 0;
      const methods = [[promise, 'then'], [promise, 'catch'], [promise, 'finally']];
      for (let index = 0; index < methods.length; index++) if (typeof data(methods[index][0], methods[index][1]) !== 'function') throw 0;
      const statics = ['resolve', 'reject', 'all', 'allSettled', 'any', 'race', 'withResolvers', 'try'];
      for (let index = 0; index < statics.length; index++) {
        const key = statics[index], field = descriptor(P, key);
        if (!field && key !== 'resolve') { push(fields, { target: P, key, absent: true }); chain(P, key); }
        else if (typeof data(P, key) !== 'function') throw 0;
      }
      const species = descriptor(P, I.speciesSymbol);
      if (!species || hasOwn(species, 'value') || typeof own(species, 'get') !== 'function' || own(species, 'set') !== undefined) throw 0;
      const prototypes = [object, array];
      for (let index = 0; index < prototypes.length; index++) chain(prototypes[index], 'then');
      result = { safe: true, fields, chains, P, speciesGet: own(species, 'get') };
    } catch { /* Missing/unsafe target intrinsics are not evaluated or repaired. */ }
    setWeak(I.promiseBoundaries, target, result);
    return result;
  }
  const targetPromise = promiseBoundary(realm);
  function promisePreflight() {
    let safe = false;
    try {
      safe = targetPromise.safe;
      const fields = safe ? targetPromise.fields : [];
      for (let index = 0; index < fields.length && safe; index++) {
        const expected = fields[index], actual = descriptor(expected.target, expected.key);
        safe = expected.absent ? !actual : !!actual && hasOwn(actual, 'value') && actual.value === expected.value;
      }
      const chains = safe ? targetPromise.chains : [];
      for (let index = 0; index < chains.length && safe; index++) {
        const expected = chains[index], actual = descriptor(expected.target, expected.key);
        safe = I.prototype(expected.target) === expected.parent && (expected.entry ?
          !!actual && hasOwn(actual, 'value') && actual.value === expected.entry.value : !actual);
      }
      if (safe) {
        const species = descriptor(targetPromise.P, I.speciesSymbol);
        safe = !!species && !hasOwn(species, 'value') && own(species, 'get') === targetPromise.speciesGet && own(species, 'set') === undefined;
      }
    } catch { safe = false; }
    if (!safe) { unavailable(); throw new I.NativeTypeError('Custom WebRTC asynchronous state is unavailable'); }
  }
  function unavailable(required = false) {
    if (state.unavailable < 65535) state.unavailable++;
    if (current && current.unavailable < 65535) current.unavailable++;
    if (required) critical = true;
  }
  function changed() { if (state.changed < 65535) state.changed++; }
  function privateThen(native, handlers) {
    // ADR-095: only this private operation result receives an own constructor.
    try { define(native, 'constructor', { __proto__: null, value: I.privatePromiseConstructor, writable: false, configurable: false, enumerable: false }); }
    catch { unavailable(); throw new I.NativeTypeError('Custom asynchronous result could not be protected'); }
    return apply(I.then, native, handlers);
  }
  const NativeError = own(realm, 'DOMException') || Error;
  function fail() { unavailable(); throw new NativeError('Custom WebRTC could not be applied', 'NotSupportedError'); }
  function capture(target, key, kind = 'value') { const found = owner(target, key); return found && typeof found.field[kind] === 'function' ? found.field[kind] : null; }
  function record(target, key, previous, next) {
    if (handles.length >= 256) { unavailable(true); return false; }
    define(target, key, next); push(handles, { target, key, previous, next });
    state.installed++; current.installed++; return true;
  }
  function meta(wrapper, original) {
    I.setPrototype(wrapper, I.prototype(original));
    each(['name', 'length'], key => { const field = descriptor(original, key); if (field && hasOwn(field, 'value')) define(wrapper, key, field); });
    return wrapper;
  }
  function getter(target, key, transform, required = false) {
    try {
      const found = owner(target, key);
      if (!found || !found.field.configurable || typeof found.field.get !== 'function') { unavailable(required); return; }
      const original = found.field.get;
      const { get } = { get() {
        const value = apply(original, this, arguments);
        if (state.stopped) return value;
        try { const result = transform(value, this); changed(); return result; } catch { return fail(); }
      } };
      record(found.target, key, found.field, { ...found.field, get: meta(get, original) });
    } catch { unavailable(required); }
  }
  function method(target, key, transform, asynchronous = false, prepare = null, required = false) {
    try {
      const found = owner(target, key);
      if (!found || !found.field.configurable || typeof found.field.value !== 'function') { unavailable(required); return; }
      const original = found.field.value;
      const { call } = { call() {
        const args = !state.stopped && prepare ? prepare(arguments, this) : arguments;
        // Firefox may inspect the public Promise chain inside its own RTC
        // implementation, before a returned Promise can receive our own pin.
        if (!state.stopped && asynchronous && transform) promisePreflight();
        const native = apply(original, this, args);
        if (state.stopped || !transform) return native;
        const receiver = this;
        if (asynchronous) return privateThen(native, [value => {
          if (state.stopped) return value;
          try { const result = transform(value, receiver); changed(); return result; } catch { return fail(); }
        }]);
        try { const result = transform(native, receiver); changed(); return result; } catch { return fail(); }
      } };
      record(found.target, key, found.field, { ...found.field, value: meta(call, original) });
    } catch { unavailable(required); }
  }
  function copyArguments(args) { const result = []; for (let index = 0; index < args.length; index++) push(result, args[index]); return result; }
  function argumentAt(args, index) { return index < args.length ? args[index] : undefined; }
  function setArgument(args, index, value) { define(args, index, { __proto__: null, value, configurable: true, enumerable: true, writable: true }); }
  function dictionary(value, replacements) {
    if (value !== undefined && value !== null && typeof value !== 'object' && typeof value !== 'function') return value;
    // Native WebIDL conversion drives these Gets. We do not enumerate or eagerly read caller dictionaries.
    return new I.NativeProxy(I.create(null), { get(_target, key) {
      const replacement = own(replacements, key);
      if (replacement) return replacement(value === undefined || value === null ? undefined : I.get(value, key, value));
      return value === undefined || value === null ? undefined : I.get(value, key, value);
    } });
  }
  function boundedPut(map, key, value, limit) {
    if (!apply(I.mapHas, map, [key]) && size(map) >= limit) apply(I.mapClear, map, []);
    setMap(map, key, value);
  }
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
    const entry = own(entries, entryIndex);
    if (own(entry, 'id') !== 'webrtc' || (own(entry, 'mode') || 'custom') !== 'custom') continue;
    current = { id: 'webrtc', installed: 0, unavailable: 0 }; push(rows, current);
    const profile = own(entry, 'value'), addresses = own(profile, 'addresses');
    if (!profile || !addresses && addresses !== null) { unavailable(true); continue; }
    const pc = prototype('RTCPeerConnection') || prototype('webkitRTCPeerConnection');
    if (!pc) { unavailable(); continue; }
    const candidate = prototype('RTCIceCandidate'), description = prototype('RTCSessionDescription');
    const nativeCandidate = capture(candidate, 'candidate', 'get');
    const nativeRelatedAddress = capture(candidate, 'relatedAddress', 'get');
    const nativeCandidateType = capture(candidate, 'type', 'get');
    const descriptionGet = capture(description, 'sdp', 'get');
    const originalDescriptions = new I.NativeMap(), originalCandidates = new I.NativeMap();
    const originalDescriptionInits = new I.NativeWeakMap(), originalCandidateInits = new I.NativeWeakMap();
    const projectedCandidates = new I.NativeMap(), projectedDescriptions = new I.NativeMap();
    const reports = new I.NativeWeakMap(), statIds = new I.NativeMap();
    let nextStat = 0;
    // Catalog 8 host mode `mdns` (a family host slot holds the literal "mdns" instead of an address): the page sees the shape of Chrome without a
    // camera/microphone grant. Host candidates carry a random <uuid>.local name, one stable name per original local address and document, built
    // from the random source captured here (never page-patchable). The name is not announced or resolved anywhere and the route is unchanged.
    const MDNS = 'mdns', mdnsNames = new I.NativeMap();
    const hostModeMdns = family => own(own(addresses, family), 'host') === MDNS, mdnsHost = hostModeMdns('ipv4') || hostModeMdns('ipv6');
    let randomValues = null, randomSource = null;
    if (mdnsHost) {
      try {
        const cryptoGetter = capture(realm, 'crypto', 'get');
        randomSource = cryptoGetter ? apply(cryptoGetter, realm, []) : own(realm, 'crypto');
        randomValues = randomSource !== null && (typeof randomSource === 'object' || typeof randomSource === 'function') ? capture(randomSource, 'getRandomValues') : null;
      } catch { randomValues = null; }
      if (!randomValues) unavailable();
    }
    // ADR-064: never fall back to a native address when one family/role is hidden.
    const addressRole = type => type === 'relay' ? 'turn' : type === 'srflx' || type === 'prflx' ? 'stun' : 'host';
    const addressFamily = value => typeof value === 'string' && test(/:/, value) ? 'ipv6' : typeof value === 'string' && test(/^[0-9]+(?:\.[0-9]+){3}$/, value) ? 'ipv4' : null;
    // Chrome hides host IPs behind uuid.local (stats: ""), one candidate per family. The family then comes from the native
    // ICE priority: the low byte of libwebrtc's local preference is the address precedence (IPv4 30; IPv6 40, ULA 50,
    // loopback 60, 6to4 20, Teredo 10, other 1). Unknown encodings (Firefox host candidates use 0) keep the IPv4-first fallback.
    function hiddenFamily(type, original, priority) {
      if (type !== 'host' || typeof original !== 'string' || original !== '' && !test(/\.local$/i, original)) return null;
      const rank = typeof priority === 'number' ? priority : typeof priority === 'string' && test(/^[0-9]{1,10}$/, priority) ? +priority : -1;
      if (!(rank >= 0 && rank <= 4294967295)) return null;
      const precedence = rank >>> 8 & 255;
      return precedence === 30 ? 'ipv4' : precedence > 0 && precedence <= 60 ? 'ipv6' : null;
    }
    // Up to eight hexadecimal 16-bit groups separated by single colons; false when the text is malformed. No split(): it consults a page-modifiable Symbol.split.
    function addressGroups(text, output) {
      if (text === '') return true;
      for (let from = 0, count = 0; count <= 8; count++) {
        const colon = apply(I.indexOf, text, [':', from]), group = stringSlice(text, from, colon < 0 ? text.length : colon);
        if (!test(/^[0-9a-fA-F]{1,4}$/, group)) return false;
        push(output, +('0x' + group));
        if (colon < 0) return true;
        from = colon + 1;
      }
      return false;
    }
    // Placeholder addresses are not an identity and are never rewritten or dropped: 0.0.0.0 and :: (unspecified), 127.0.0.0/8 and ::1
    // (loopback). Link-local (169.254.0.0/16, fe80::/10) is NOT special: stock Chromium gathers it as a host candidate (measured), it names
    // a real interface and follows the role/family logic below. Chrome writes 127.0.0.1 in o= and 0.0.0.0 in c= (measured live).
    // Only exact canonical text counts (no zone id, no IPv4-mapped IPv6, no leading zeros); anything else is a real address.
    function specialAddress(value) {
      // Chrome's RTCIceCandidate.address spells an IPv6 address in brackets (measured); the bracketed placeholder is the same placeholder.
      if (typeof value === 'string' && value.length >= 4 && apply(I.charCode, value, [0]) === 91 && apply(I.charCode, value, [value.length - 1]) === 93) value = stringSlice(value, 1, value.length - 1);
      if (typeof value !== 'string' || value.length < 2 || value.length > 39) return false;
      const quad = apply(I.exec, /^(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})$/, [value]);
      if (quad) {
        const first = +quad[1], second = +quad[2], third = +quad[3], fourth = +quad[4];
        if (first > 255 || second > 255 || third > 255 || fourth > 255) return false;
        // Only loopback and the unspecified address are non-identifying; link-local (169.254/16) is a real interface address that stock Chromium gathers, so it stays rewritten.
        return first === 127 || first === 0 && second === 0 && third === 0 && fourth === 0;
      }
      if (!test(/^[0-9a-fA-F:]+$/, value) || test(/:::|::.*::/, value)) return false;
      const gap = apply(I.indexOf, value, ['::']), left = [], right = [], words = [];
      if (!addressGroups(stringSlice(value, 0, gap < 0 ? value.length : gap), left) || gap >= 0 && !addressGroups(stringSlice(value, gap + 2), right)) return false;
      if (gap < 0 ? left.length !== 8 : left.length + right.length > 7) return false;
      for (let index = 0; index < left.length; index++) push(words, left[index]);
      for (let index = left.length + right.length; index < 8; index++) push(words, 0);
      for (let index = 0; index < right.length; index++) push(words, right[index]);
      let zero = true;
      for (let index = 0; index < 7; index++) if (words[index] !== 0) zero = false;
      return zero && words[7] <= 1; // :: and ::1 only; fe80::/10 is a real interface address and stays rewritten
    }
    // The configured value of one family slot, or null. The literal mdns is a host-slot mode only; anywhere else it is not an address.
    function configuredAddress(family, role) {
      const selected = family ? own(own(addresses, family), role) : own(own(addresses, 'ipv4'), role) || own(own(addresses, 'ipv6'), role);
      return typeof selected === 'string' && selected.length <= 45 && (selected !== MDNS || role === 'host') ? selected : null;
    }
    // One random <uuid>.local name per original local address (brackets and case ignored), made lazily when the page first reads that address.
    // Lowercase UUIDv4 text, exactly how Chrome spells its names. Table full or no random source: the host is held, never the real address.
    function mdnsName(original) {
      if (typeof original !== 'string' || original.length < 2 || original.length > 64) return null;
      const bare = apply(I.lower, apply(I.charCode, original, [0]) === 91 && apply(I.charCode, original, [original.length - 1]) === 93 ? stringSlice(original, 1, original.length - 1) : original, []);
      const known = getMap(mdnsNames, bare); if (known !== undefined) return known;
      if (!randomValues || size(mdnsNames) >= 256) { unavailable(); return null; }
      try {
        const bytes = new I.NativeUint8Array(16), hex = '0123456789abcdef'; let name = '';
        apply(randomValues, randomSource, [bytes]);
        bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128;
        for (let index = 0; index < 16; index++) name += (index === 4 || index === 6 || index === 8 || index === 10 ? '-' : '') + hex[bytes[index] >> 4] + hex[bytes[index] & 15];
        name += '.local'; setMap(mdnsNames, bare, name); return name;
      } catch { unavailable(); return null; }
    }
    // "" (stats) and *.local (everywhere else) are how Chrome itself reports a host it already hid; such a value is never renamed a second time.
    const hiddenHost = address => address === '' || typeof address === 'string' && test(/\.local$/i, address);
    function mdnsAddress(original, statistics) {
      if (hiddenHost(original)) return original;
      // Chrome reports a hidden host as an empty address in getStats().
      return statistics ? '' : mdnsName(original);
    }
    function selectedAddress(type, original, declared = null, priority, statistics = false) {
      if (specialAddress(original)) return original;
      const role = addressRole(type), family = declared || addressFamily(original) || hiddenFamily(type, original, priority);
      const selected = configuredAddress(family, role);
      return selected === MDNS ? mdnsAddress(original, statistics) : selected;
    }
    // The native foundation survives only for a host the browser hid itself (nothing was rewritten); everything else is re-derived from the shown address.
    function foundation(type, address, priority, native) {
      const shown = selectedAddress(type, address, null, priority);
      if (typeof native === 'string' && shown === address && hiddenHost(address)) return native;
      const value = shown + ':' + type; let hash = 2166136261;
      for (let index = 0; index < value.length; index++) { hash ^= apply(I.charCode, value, [index]); hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0; }
      return '' + hash;
    }
    const neutralAddress = declared => declared === 'IP6' ? '::' : '0.0.0.0';
    // c=, o= and a=rtcp take an address, never a name: a host in mdns mode shows Chrome's placeholder.
    function sdpAddress(type, address, declared) {
      if (specialAddress(address)) return address;
      const selected = configuredAddress(declared === 'IP6' ? 'ipv6' : 'ipv4', addressRole(type));
      return selected === null || selected === MDNS ? neutralAddress(declared) : selected;
    }
    // Related address of a candidate. A srflx/prflx base in an mdns family is what Chrome hides behind 0.0.0.0 / :: and port 0; a relay's related
    // address keeps following the STUN role. Result: { address, zero } or null when the pair is withheld.
    function relatedOf(type, raddr) {
      if (specialAddress(raddr)) return { address: raddr, zero: false };
      if (type !== 'relay' && mdnsHost && configuredAddress(addressFamily(raddr), 'host') === MDNS) return { address: addressFamily(raddr) === 'ipv6' ? '::' : '0.0.0.0', zero: true };
      const address = selectedAddress(type === 'relay' ? 'srflx' : 'host', raddr);
      return address === null ? null : { address, zero: false };
    }
    // A stats row of a srflx/prflx candidate whose base lies in an mdns family (the base is the related address, else the row's own family).
    function hiddenBase(row) {
      const kind = own(row, 'candidateType'); if (kind !== 'srflx' && kind !== 'prflx') return false;
      const base = own(row, 'relatedAddress'), reference = typeof base === 'string' ? base : own(row, 'address') ?? own(row, 'ip');
      return typeof reference === 'string' && !specialAddress(reference) && configuredAddress(addressFamily(reference), 'host') === MDNS;
    }
    function remember(map, safe, original, limit) {
      // A projected string projects to itself: re-reading a page-held copy must not turn the native inverse entry ambiguous.
      if (safe === original) return;
      const previous = getMap(map, safe);
      boundedPut(map, safe, previous !== undefined && previous !== original ? null : original, limit);
    }
    function projectCandidate(value) {
      if (value === '') return '';
      if (typeof value !== 'string' || value.length > 4096) return '';
      const known = getMap(projectedCandidates, value); if (known !== undefined) return known;
      const parts = stringSplit(value, ' ');
      if (parts.length < 8 || parts.length > 128 || !test(/^(?:a=)?candidate:/, parts[0]) || parts[6] !== 'typ' || !test(/^(host|srflx|prflx|relay)$/, parts[7])) return '';
      const type = parts[7], address = selectedAddress(type, parts[4], null, parts[3]), output = [];
      if (address === null) { boundedPut(projectedCandidates, value, '', 512); return ''; }
      const prefixed = test(/^a=/, parts[0]);
      for (let index = 0; index < 8; index++) push(output, index === 0 ? (prefixed ? 'a=' : '') + 'candidate:' + foundation(type, parts[4], parts[3], stringSlice(parts[0], prefixed ? 12 : 10)) : index === 4 ? address : parts[index]);
      for (let index = 8; index < parts.length; index += 2) {
        const key = parts[index], item = parts[index + 1];
        if (item === undefined) return '';
        if (key === 'raddr') {
          const related = relatedOf(type, item);
          if (related !== null) { push(output, key); push(output, related.address); }
        }
        else if (key === 'rport') {
          const relatedIndex = apply(I.indexOf, value, [' raddr ']);
          const raddr = relatedIndex >= 0 ? stringSplit(stringSlice(value, relatedIndex + 7), ' ')[0] : null;
          const related = raddr ? relatedOf(type, raddr) : null;
          if (related !== null) { push(output, key); push(output, related.zero ? '0' : item); }
        }
        else if (test(/^(tcptype|generation|ufrag|network-id|network-cost)$/, key)) { push(output, key); push(output, item); }
        // Unknown optional extensions are withheld rather than exposing an unclassified address field.
      }
      const safe = join(output, ' ');
      boundedPut(projectedCandidates, value, safe, 512); remember(originalCandidates, safe, value, 512);
      return safe;
    }
    function projectSdp(value) {
      if (typeof value !== 'string' || value.length > 65536) return '';
      const known = getMap(projectedDescriptions, value); if (known !== undefined) return known;
      const lines = stringSplit(value, /\r?\n/); if (lines.length > 1024) return '';
      const output = [];
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index]; let safe = line;
        if (test(/^a=candidate:/, line)) { safe = projectCandidate(line); if (!safe) continue; }
        else if (test(/^c=IN IP[46] /, line)) {
          const parts = stringSplit(line, ' '); if (parts.length !== 3) return '';
          safe = 'c=IN ' + parts[1] + ' ' + sdpAddress('host', parts[2], parts[1]);
        }
        else if (test(/^o=/, line)) {
          const parts = stringSplit(line, ' '); if (parts.length !== 6 || parts[3] !== 'IN' || !test(/^IP[46]$/, parts[4])) return '';
          parts[5] = sdpAddress('host', parts[5], parts[4]); safe = join(parts, ' ');
        } else if (test(/^a=rtcp:/, line)) {
          const parts = stringSplit(line, ' ');
          if (parts.length === 4 && parts[1] === 'IN' && test(/^IP[46]$/, parts[2])) { parts[3] = sdpAddress('host', parts[3], parts[2]); safe = join(parts, ' '); }
          else if (parts.length !== 1) continue;
        } else if (test(/^a=remote-candidates:/, line)) {
          const parts = stringSplit(line, ' '), remotes = [];
          // RFC 5245: component/address/port triples; the first component shares
          // the attribute token, so strip it before parsing the bounded list.
          const first = stringSlice(parts[0], 'a=remote-candidates:'.length);
          parts[0] = first;
          if (parts.length % 3 !== 0) continue;
          for (let position = 0; position < parts.length; position += 3) {
            const address = selectedAddress('srflx', parts[position + 1]);
            if (address !== null) { push(remotes, parts[position]); push(remotes, address); push(remotes, parts[position + 2]); }
          }
          if (!remotes.length) continue;
          safe = 'a=remote-candidates:' + join(remotes, ' ');
        }
        push(output, safe);
      }
      const safe = join(output, '\r\n');
      boundedPut(projectedDescriptions, value, safe, 32); remember(originalDescriptions, safe, value, 32);
      return safe;
    }
    function restoreSdp(value) {
      if (typeof value !== 'string') return value;
      const native = getMap(originalDescriptions, value); if (typeof native === 'string') return native;
      // A page edit (extra line, reordered attributes) misses the whole-string lookup: restore projected candidate lines one by one.
      if (value.length > 65536) return value;
      try {
        const lines = stringSplit(value, /\r?\n/); if (lines.length > 1024) return value;
        let restored = false;
        for (let index = 0; index < lines.length; index++) {
          if (!test(/^a=candidate:/, lines[index])) continue;
          const original = getMap(originalCandidates, lines[index]);
          if (typeof original === 'string') { lines[index] = original; restored = true; }
        }
        return restored ? join(lines, '\r\n') : value;
      } catch { return value; }
    }
    function restoreCandidate(value) {
      if (typeof value !== 'string') return value;
      const native = getMap(originalCandidates, value); return typeof native === 'string' ? native : value;
    }
    function safeDescription(value) {
      if (!value || typeof value !== 'object') return fail();
      const type = own(value, 'type'), sdp = own(value, 'sdp');
      if (typeof type !== 'string' || typeof sdp !== 'string') return fail();
      const output = { type, sdp: projectSdp(sdp) };
      setWeak(originalDescriptionInits, output, { safe: output.sdp, native: sdp });
      return output;
    }
    function descriptionArguments(args) {
      const value = argumentAt(args, 0);
      if (value === undefined || value === null) return args;
      const next = copyArguments(args), original = getWeak(originalDescriptionInits, value);
      setArgument(next, 0, dictionary(value, { sdp: value => original && value === original.safe ? original.native : restoreSdp(value) })); return next;
    }
    function candidateArguments(args) {
      const value = argumentAt(args, 0);
      if (value === null || value === undefined) return args;
      const next = copyArguments(args), original = getWeak(originalCandidateInits, value);
      setArgument(next, 0, dictionary(value, { candidate: value => original && value === original.safe ? original.native : restoreCandidate(value) })); return next;
    }
    function callbackArguments(args) {
      const callback = argumentAt(args, 0);
      if (typeof callback !== 'function') return args;
      const next = copyArguments(args);
      setArgument(next, 0, function(value) { return apply(callback, this, [state.stopped ? value : safeDescription(value)]); });
      return next;
    }
    function offerArguments(args) {
      let next = callbackArguments(args);
      const index = typeof argumentAt(args, 0) === 'function' ? 2 : 0, value = argumentAt(args, index);
      if (value === null || typeof value !== 'object' && typeof value !== 'function') return next;
      if (next === args) next = copyArguments(args);
      // Native WebIDL still drives every Get and Boolean conversion. The
      // successful Get may have changed the public Promise before Firefox's
      // backend enters _async; deny that state before returning the member.
      // ADR-095: the native options argument has a private Proxy identity.
      setArgument(next, index, new I.NativeProxy(I.create(null), { get(_target, key) {
        const result = I.get(value, key, value);
        if (!state.stopped) promisePreflight();
        return result;
      } }));
      return next;
    }
    function candidateText(receiver) { return nativeCandidate ? apply(nativeCandidate, receiver, []) : ''; }
    function candidateType(receiver) { return nativeCandidateType ? apply(nativeCandidateType, receiver, []) : 'host'; }
    function candidatePart(receiver, index) {
      const text = candidateText(receiver);
      if (typeof text !== 'string' || text.length > 4096) return null;
      const parts = stringSplit(text, ' '); return parts.length >= 8 ? parts[index] : null;
    }
    const candidateAddress = receiver => candidatePart(receiver, 4), candidatePriority = receiver => candidatePart(receiver, 3);
    function statId(value) {
      if (typeof value !== 'string') return value;
      let id = getMap(statIds, value); if (id !== undefined) return id;
      if (size(statIds) >= 2048) return fail();
      id = 'rtc-stat-' + ++nextStat; setMap(statIds, value, id); return id;
    }
    const statStrings = ' type kind mediaType state protocol candidateType relayProtocol networkType mimeType mid rid trackIdentifier dtlsState iceState iceRole dtlsRole fingerprint fingerprintAlgorithm qualityLimitationReason decoderImplementation encoderImplementation powerEfficientEncoderImplementation powerEfficientDecoderImplementation contentType scalabilityMode '; 
    function statRow(row) {
      if (!row || typeof row !== 'object') return fail();
      const keys = I.keys(row), type = own(row, 'type'), result = {};
      if (keys.length > 160 || typeof type !== 'string') return fail();
      for (let index = 0; index < keys.length; index++) {
        const key = keys[index]; if (typeof key !== 'string') continue;
        const field = descriptor(row, key); if (!field || !hasOwn(field, 'value')) return fail();
        const value = field.value;
        if (key === 'id' || test(/Id$/, key)) { if (typeof value === 'string') define(result, key, { value: statId(value), enumerable: true, configurable: true, writable: true }); }
        else if (key === 'foundation' && (type === 'local-candidate' || type === 'remote-candidate')) define(result, key, { value: selectedAddress(own(row, 'candidateType'), own(row, 'address') ?? own(row, 'ip'), null, own(row, 'priority')) === null ? '' : foundation(own(row,'candidateType'), own(row, 'address') ?? own(row, 'ip'), own(row, 'priority'), value), enumerable: true, configurable: true, writable: true });
        else if ((key === 'address' || key === 'ip') && (type === 'local-candidate' || type === 'remote-candidate')) define(result, key, { value: value === null ? null : selectedAddress(own(row, 'candidateType'), value, null, own(row, 'priority'), true), enumerable: true, configurable: true, writable: true });
        // Chrome omits the base port of a srflx/prflx candidate whose base is hidden (mdns family), exactly like the base address.
        else if (key === 'relatedPort' && mdnsHost && (type === 'local-candidate' || type === 'remote-candidate') && hiddenBase(row)) continue;
        else if (typeof value === 'number' || typeof value === 'boolean' || value === null || typeof value === 'string' && apply(I.indexOf, statStrings, [' ' + key + ' ']) >= 0) define(result, key, { value, enumerable: true, configurable: true, writable: true });
      }
      return result;
    }
    const statsPrototypes = new I.NativeWeakMap();
    function statsMap(receiver) { const map = getWeak(reports, receiver); if (!map) return fail(); return map; }
    function patchStats(report) {
      // Some engines implement RTCStatsReport as a genuine Map (possibly a
      // subclass). Never patch its shared Map.prototype: return native Map
      // storage containing only projected records, keeping the original private.
      let nativeMapSize;
      try { nativeMapSize=apply(I.mapSize,report,[]); } catch { /* WebIDL maplike report. */ }
      if(typeof nativeMapSize==='number'){
        if(nativeMapSize>512)return fail();const safe=new I.NativeMap();
        apply(I.mapForEach,report,[(row,key)=>setMap(safe,statId(key),statRow(row))]);
        I.setPrototype(safe,I.prototype(report));return safe;
      }
      const statsPrototype = I.prototype(report);
      let statsOriginal = getWeak(statsPrototypes, statsPrototype);
      if (!statsOriginal) {
        statsOriginal = { forEach: capture(statsPrototype, 'forEach'), get: capture(statsPrototype, 'get'), has: capture(statsPrototype, 'has'), keys: capture(statsPrototype, 'keys'), entries: capture(statsPrototype, 'entries'), values: capture(statsPrototype, 'values'), iterator: capture(statsPrototype, I.iteratorSymbol) };
        if (!statsOriginal.forEach || !statsOriginal.get) return fail();
        const methods = ['get', 'has', 'keys', 'values', 'entries', I.iteratorSymbol];
        for (let index = 0; index < methods.length; index++) {
          const key = methods[index], found = owner(statsPrototype, key), original = key === I.iteratorSymbol ? statsOriginal.iterator : statsOriginal[key];
          if (!found || !found.field.configurable || typeof original !== 'function') continue;
          const { call } = { call() {
            if(state.stopped)return apply(original,this,arguments);
            let keyValue=argumentAt(arguments,0),args=arguments;
            if((key==='get'||key==='has')&&keyValue!==null&&(typeof keyValue==='object'||typeof keyValue==='function')){
              const value=keyValue;args=copyArguments(arguments);
              setArgument(args,0,new I.NativeProxy(I.create(null),{get(_target,name){
                const method=I.get(value,name,value);
                if((name===I.primitiveSymbol||name==='toString'||name==='valueOf')&&typeof method==='function')return function(){
                  const result=apply(method,value,arguments);
                  if(result===null||typeof result!=='object'&&typeof result!=='function')keyValue=result;
                  return result;
                };
                return method;
              }}));
            }
            apply(original, this, args);
            const map = statsMap(this);
            if (key === 'get') return getMap(map, keyValue);
            if (key === 'has') return apply(I.mapHas, map, [keyValue]);
            return apply(key === 'keys' ? I.mapKeys : key === 'values' ? I.mapValues : I.mapEntries, map, []);
          } };
          record(found.target, key, found.field, { ...found.field, value: meta(call, original) });
        }
        const found = owner(statsPrototype, 'forEach'), original = statsOriginal.forEach;
        const { forEach } = { forEach(callback, thisArg) {
          if (state.stopped || typeof callback !== 'function') return apply(original, this, arguments);
          const report = this, map = getWeak(reports, report);
          if (!map) return apply(original, report, [() => fail(), thisArg]);
          // Native validates the receiver and invokes the callback exactly once per native row.
          return apply(original, report, [(value, key) => {
            const alias = statId(key); return apply(callback, thisArg, [getMap(map, alias), alias, report]);
          }, thisArg]);
        } };
        record(found.target, 'forEach', found.field, { ...found.field, value: meta(forEach, original) });
        setWeak(statsPrototypes, statsPrototype, statsOriginal);
      }
      const safe = new I.NativeMap(); let count = 0;
      apply(statsOriginal.forEach, report, [(row, key) => { if (++count > 512) return fail(); setMap(safe, statId(key), statRow(row)); }]);
      setWeak(reports, report, safe); return report;
    }
    if (addresses !== null) {
      if (!nativeCandidate || !descriptionGet) unavailable(true);
      getter(candidate, 'candidate', value => projectCandidate(value), true);
      getter(candidate, 'address', (value, receiver) => value === null ? null : selectedAddress(candidateType(receiver), value, null, candidatePriority(receiver)), true);
      // Chrome's address getters spell IPv6 in brackets (measured: [::] for a hidden base), the candidate text without; the hidden-base placeholder follows the native spelling.
      getter(candidate, 'relatedAddress', (value, receiver) => { const related = value === null ? null : relatedOf(candidateType(receiver), value); return related === null ? null : related.zero && apply(I.charCode, value, [0]) === 91 ? '[' + related.address + ']' : related.address; }, true);
      // Chrome reports port 0 next to the hidden 0.0.0.0 base; an unrelated candidate keeps null. Only installed for an mdns family.
      if (mdnsHost && nativeRelatedAddress && capture(candidate, 'relatedPort', 'get')) getter(candidate, 'relatedPort', (value, receiver) => {
        const base = value === null ? null : apply(nativeRelatedAddress, receiver, []), related = typeof base === 'string' ? relatedOf(candidateType(receiver), base) : null;
        return related !== null && related.zero ? 0 : value;
      });
      if (capture(candidate, 'foundation', 'get')) getter(candidate, 'foundation', (value, receiver) => value === null ? null : selectedAddress(candidateType(receiver), candidateAddress(receiver), null, candidatePriority(receiver)) === null ? '' : foundation(candidateType(receiver), candidateAddress(receiver), candidatePriority(receiver), value));
      if (capture(candidate, 'url', 'get')) getter(candidate, 'url', value => value === null ? null : '');
      method(candidate, 'toJSON', value => {
        const native = own(value, 'candidate');
        const output = { candidate: projectCandidate(native), sdpMid: own(value, 'sdpMid'), sdpMLineIndex: own(value, 'sdpMLineIndex'), usernameFragment: own(value, 'usernameFragment') };
        setWeak(originalCandidateInits, output, { safe: output.candidate, native });
        return output;
      }, false, null, true);
      getter(description, 'sdp', value => projectSdp(value), true);
      method(description, 'toJSON', value => safeDescription(value), false, null, true);
      each(['createOffer', 'createAnswer'], name => method(pc, name, value => value === undefined ? undefined : safeDescription(value), true, name === 'createOffer' ? offerArguments : callbackArguments, true));
      each(['setLocalDescription', 'setRemoteDescription'], name => method(pc, name, null, false, descriptionArguments, true));
      method(pc, 'addIceCandidate', null, false, candidateArguments, true);
      each(['localDescription', 'currentLocalDescription', 'pendingLocalDescription', 'remoteDescription', 'currentRemoteDescription', 'pendingRemoteDescription'], name => {
        if (capture(pc, name, 'get')) getter(pc, name, value => value, true);
      });
      each(['RTCPeerConnection', 'RTCRtpSender', 'RTCRtpReceiver'], name => method(prototype(name), 'getStats', patchStats, true, null, name === 'RTCPeerConnection'));
      const iceEvent = prototype('RTCPeerConnectionIceEvent'), iceError = prototype('RTCPeerConnectionIceErrorEvent');
      if (capture(iceEvent, 'url', 'get')) getter(iceEvent, 'url', value => value === null ? null : '');
      if (capture(iceError, 'address', 'get')) getter(iceError, 'address', value => value === null ? null : selectedAddress('host', value));
      if (capture(iceError, 'url', 'get')) getter(iceError, 'url', () => '');
      if (capture(iceError, 'errorText', 'get')) getter(iceError, 'errorText', () => '');
      const ice = prototype('RTCIceTransport');
      each(['getLocalCandidates', 'getRemoteCandidates'], name => { if (capture(ice, name)) method(ice, name, values => {
        if (!I.isArray(values) || values.length > 256) return [];
        for (let index = 0; index < values.length; index++) if (typeof candidateText(values[index]) !== 'string') return [];
        return values;
      }); });
      if (capture(ice, 'getSelectedCandidatePair')) method(ice, 'getSelectedCandidatePair', value => {
        if (value === null) return null;
        const keys=['local','remote'];for(let index=0;index<keys.length;index++)if(typeof candidateText(own(value,keys[index]))!=='string')return null;
        return value;
      });
    }
    const constructorWrappers = new I.NativeWeakMap();
    each(['RTCPeerConnection', 'webkitRTCPeerConnection', 'mozRTCPeerConnection'], name => {
      try {
        const field = descriptor(realm, name);
        if (!field || typeof field.value !== 'function') return;
        if (!field.configurable) { unavailable(true); return; }
        const original = field.value;
        let wrapper = getWeak(constructorWrappers, original);
        if (!wrapper) {
          const prepare = args => {
            if (state.stopped) return args;
            if (critical) return fail();
            if (!own(profile, 'freshCertificates') && own(profile, 'iceTransportPolicy') !== 'relay') return args;
            const config = argumentAt(args, 0);
            if (config !== undefined && config !== null && typeof config !== 'object' && typeof config !== 'function') return args;
            const next = copyArguments(args);
            // Constant overrides deliberately do not read an ignored caller certificate/policy getter.
            setArgument(next, 0, new I.NativeProxy(I.create(null), { get(_target, key) {
              if (key === 'certificates' && own(profile, 'freshCertificates')) return undefined;
              if (key === 'iceTransportPolicy' && own(profile, 'iceTransportPolicy') === 'relay') return 'relay';
              return config === undefined || config === null ? undefined : I.get(config, key, config);
            } }));
            return next;
          };
          wrapper = new I.NativeProxy(original, {
            apply(target, receiver, args) { return apply(target, receiver, prepare(args)); },
            construct(target, args, newTarget) { return construct(target, prepare(args), newTarget === wrapper ? target : newTarget); },
            // ADR-112: closing a prototype cycle through the wrapper is refused with the engine's own TypeError, as for the native constructor.
            setPrototypeOf(target, value) { if (value === wrapper) { I.setPrototype(target, target); return false; } return I.reflectSetPrototype(target, value); }
          });
          setWeak(constructorWrappers, original, wrapper);
        }
        record(realm, name, field, { ...field, value: wrapper });
        const nativePrototype = own(original, 'prototype'), alias = nativePrototype && descriptor(nativePrototype, 'constructor');
        if (alias && alias.configurable && hasOwn(alias, 'value') && alias.value === original) record(nativePrototype, 'constructor', alias, { ...alias, value: wrapper });
      } catch { unavailable(true); }
    });
    if (own(profile, 'iceTransportPolicy') === 'relay' || own(profile, 'freshCertificates')) {
      method(pc, 'setConfiguration', null, false, args => {
        if (args.length === 0) return args;
        const next = copyArguments(args), config = argumentAt(args, 0);
        if (config !== undefined && config !== null && typeof config !== 'object' && typeof config !== 'function') return args;
        setArgument(next, 0, new I.NativeProxy(I.create(null), { get(_target, key) {
          if (key === 'certificates' && own(profile, 'freshCertificates')) return undefined;
          if (key === 'iceTransportPolicy' && own(profile, 'iceTransportPolicy') === 'relay') return 'relay';
          return config === undefined || config === null ? undefined : I.get(config, key, config);
        } })); return next;
      });
    }
    if (own(profile, 'randomizeDevices')) {
      let seed = own(entry, 'deviceSeed'), origin = '';
      const locationGetter = capture(realm, 'location', 'get');
      const location = locationGetter ? apply(locationGetter, realm, []) : own(realm, 'location');
      const originGetter = capture(location, 'origin', 'get');
      // Window.origin serializes the security origin of inherited about:blank/srcdoc;
      // Location.origin serializes their URL and would incorrectly return "null".
      const originValue = I.windowOrigin ? apply(I.windowOrigin, realm, []) : originGetter ? apply(originGetter, location, []) : own(location, 'origin');
      if (typeof originValue === 'string' && originValue.length <= 2048) origin = originValue;
      let conflict = false;
      for (let index = 0; index < entries.length; index++) {
        const item = own(entries, index);
        if (own(item, 'id') === 'media-enumeration' && (own(item, 'mode') || 'custom') === 'custom') conflict = true;
      }
      if (typeof seed !== 'string' || !test(/^[a-f0-9]{64}$/, seed) || conflict) { seed = ''; unavailable(); }
      const aliases = new I.NativeMap(), originals = new I.NativeMap();
      const encoder = new I.NativeTextEncoder();
      // SHA-256 over a private seed, origin and length-framed native identifier.
      // The native identifier is neither persisted nor returned outside its private lookup table.
      function digest(value) {
        const bytes = apply(I.encode, encoder, [value]), words = I.create(null), h = [1779033703,3144134277,1013904242,2773480762,1359893119,2600822924,528734635,1541459225];
        const constants = [1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298];
        const rotate = (value, count) => value >>> count | value << 32 - count;
        const length = bytes.length, total = ((length + 9 + 63) >>> 6) << 6;
        const byte = index => index < length ? bytes[index] : index === length ? 128 : index >= total - 4 ? length * 8 >>> (total - 1 - index) * 8 & 255 : 0;
        for (let offset = 0; offset < total; offset += 64) {
          for (let index = 0; index < 16; index++) { const at = offset + index * 4; words[index] = byte(at) << 24 | byte(at + 1) << 16 | byte(at + 2) << 8 | byte(at + 3); }
          for (let index = 16; index < 64; index++) {
            const a = words[index - 15], b = words[index - 2];
            words[index] = ((rotate(a,7) ^ rotate(a,18) ^ a >>> 3) + words[index - 16] + (rotate(b,17) ^ rotate(b,19) ^ b >>> 10) + words[index - 7]) | 0;
          }
          let a=h[0],b=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],j=h[7];
          for (let index = 0; index < 64; index++) {
            const first=(j+(rotate(e,6)^rotate(e,11)^rotate(e,25))+(e&f^~e&g)+constants[index]+words[index])|0;
            const second=((rotate(a,2)^rotate(a,13)^rotate(a,22))+(a&b^a&c^b&c))|0;
            j=g;g=f;f=e;e=d+first|0;d=c;c=b;b=a;a=first+second|0;
          }
          const values=[a,b,c,d,e,f,g,j]; for(let index=0;index<8;index++)h[index]=h[index]+values[index]|0;
        }
        const alphabet='0123456789abcdef'; let result='';
        for(let index=0;index<8;index++)for(let shift=28;shift>=0;shift-=4)result+=alphabet[h[index]>>>shift&15];
        return result;
      }
      function alias(value, domain) {
        if (value === undefined || value === null || value === '') return value;
        if (typeof value !== 'string' || value.length > 2048 || !seed) return '';
        if (domain === 'device' && (value === 'default' || value === 'communications')) return value;
        const key = domain + ':' + value.length + ':' + value;
        const previous = getMap(aliases, key); if (previous !== undefined) return previous;
        if (size(aliases) >= 2048) { unavailable(); return ''; }
        const safe = digest(seed + ':' + origin.length + ':' + origin + ':' + key);
        setMap(aliases, key, safe); setMap(originals, safe, value); return safe;
      }
      function restoreId(value) { return typeof value === 'string' ? getMap(originals, value) ?? value : value; }
      const mediaDevice = prototype('MediaDeviceInfo'), inputDevice = prototype('InputDeviceInfo'), track = prototype('MediaStreamTrack');
      const deviceId = capture(mediaDevice, 'deviceId', 'get'), deviceGroup = capture(mediaDevice, 'groupId', 'get'), deviceKind = capture(mediaDevice, 'kind', 'get');
      const trackSettings = capture(track, 'getSettings'), trackKind = capture(track, 'kind', 'get');
      function label(value, id, kind) {
        if (value === undefined || value === null || value === '') return value;
        const identifier = alias(id, 'device'); if (!identifier) return '';
        return (kind === 'videoinput' || kind === 'video' ? 'Camera ' : kind === 'audiooutput' ? 'Speaker ' : kind === 'audioinput' || kind === 'audio' ? 'Microphone ' : 'Device ') + stringSlice(identifier, 0, 12);
      }
      function mediaLabel(value, receiver) { return label(value, deviceId ? apply(deviceId, receiver, []) : '', deviceKind ? apply(deviceKind, receiver, []) : ''); }
      if (deviceId) getter(mediaDevice, 'deviceId', value => alias(value, 'device'), true);
      if (deviceGroup) getter(mediaDevice, 'groupId', value => alias(value, 'group'), true);
      if (capture(mediaDevice, 'label', 'get')) getter(mediaDevice, 'label', mediaLabel, true);
      if (capture(mediaDevice, 'toJSON')) method(mediaDevice, 'toJSON', native => ({ deviceId: alias(own(native, 'deviceId'), 'device'), groupId: alias(own(native, 'groupId'), 'group'), kind: own(native, 'kind'), label: label(own(native, 'label'), own(native, 'deviceId'), own(native, 'kind')) }));
      function settings(value) {
        if (!value || typeof value !== 'object') return fail();
        const output = {}, keys = I.keys(value); if (keys.length > 128) return fail();
        for (let index = 0; index < keys.length; index++) {
          const key = keys[index]; if (typeof key !== 'string') continue;
          const field = descriptor(value, key); if (!field || !hasOwn(field, 'value')) return fail();
          define(output, key, { ...field, value: key === 'deviceId' ? alias(field.value, 'device') : key === 'groupId' ? alias(field.value, 'group') : field.value });
        }
        return output;
      }
      each(['getSettings','getCapabilities'], name => { if (capture(track, name)) method(track, name, settings); });
      if (capture(inputDevice, 'getCapabilities')) method(inputDevice, 'getCapabilities', settings);
      if (capture(track, 'label', 'get')) getter(track, 'label', (value, receiver) => {
        const source = trackSettings ? apply(trackSettings, receiver, []) : null;
        return label(value, own(source, 'deviceId'), trackKind ? apply(trackKind, receiver, []) : '');
      });
      function selection(value, reverse) {
        const convert = reverse ? restoreId : item => alias(item, 'device');
        if (typeof value === 'string') return convert(value);
        // Plain JSON lists are translated without invoking a second caller getter/coercion.
        if (I.isArray(value)) {
          if (value.length > 256) return fail(); const output = [];
          for (let index = 0; index < value.length; index++) { const field = descriptor(value, index); if (!field || !hasOwn(field, 'value')) return value; push(output, typeof field.value === 'string' ? convert(field.value) : field.value); }
          return output;
        }
        if (!value || typeof value !== 'object') return value;
        return dictionary(value, { exact: item => selection(item, reverse), ideal: item => selection(item, reverse) });
      }
      function constraints(value, reverse) {
        if (!value || typeof value !== 'object') return value;
        return dictionary(value, {
          deviceId: item => selection(item, reverse), groupId: item => {
            if (typeof item === 'string') return reverse ? restoreId(item) : alias(item, 'group');
            return selection(item, reverse);
          },
          advanced: item => {
            if (!I.isArray(item) || item.length > 256) return item;
            const output = []; for (let index = 0; index < item.length; index++) { const field = descriptor(item, index); if (!field || !hasOwn(field, 'value')) return item; push(output, constraints(field.value, reverse)); } return output;
          }
        });
      }
      if (capture(track, 'applyConstraints')) method(track, 'applyConstraints', null, false, args => { if (!args.length) return args; const next = copyArguments(args); setArgument(next, 0, constraints(argumentAt(args, 0), true)); return next; });
      if (capture(track, 'getConstraints')) method(track, 'getConstraints', native => {
        // Native returned constraints are data dictionaries. Copy only their known tree.
        function copy(value, depth = 0, domain = '') {
          if (depth > 8) return fail();
          if (typeof value === 'string') return domain ? alias(value, domain) : value;
          if (value === null || typeof value !== 'object') return value;
          const output = I.isArray(value) ? [] : {}, keys = I.keys(value); if (keys.length > 256) return fail();
          for (let index=0;index<keys.length;index++) { const key=keys[index]; if(key==='length'||typeof key!=='string')continue;const field=descriptor(value,key);if(!field||!hasOwn(field,'value'))return fail();define(output,key,{value:copy(field.value,depth+1,key==='deviceId'?'device':key==='groupId'?'group':domain),enumerable:true,configurable:true,writable:true}); }
          return output;
        }
        return copy(native);
      });
      const mediaDevices = prototype('MediaDevices');
      // ADR-083: warm only the result of an enumeration requested by the page.
      // A new document cannot invert an old SHA alias until it observes native
      // identities again. No enumeration is started by installation/selection.
      const enumerationCalls = new I.NativeWeakMap();
      if (capture(mediaDevices, 'enumerateDevices')) {
        try {
          const found = owner(mediaDevices, 'enumerateDevices');
          if (!found || !found.field.configurable) unavailable();
          else {
            const original = found.field.value;
            const { enumerateDevices } = { enumerateDevices() {
              if (!state.stopped) promisePreflight();
              const native = apply(original, this, arguments);
              if (state.stopped || this === null || typeof this !== 'object' && typeof this !== 'function') return native;
              const token = {}, receiver = this;
              setWeak(enumerationCalls, receiver, token);
              return privateThen(native, [values => {
                if (state.stopped || getWeak(enumerationCalls, receiver) !== token) return values;
                try {
                  if (!I.isArray(values) || !deviceId) { unavailable(); return values; }
                  const length = own(values, 'length');
                  if (typeof length !== 'number') { unavailable(); return values; }
                  if (length > 1024) unavailable();
                  for (let index = 0; index < length && index < 1024; index++) {
                    const item = own(values, index);
                    try {
                      alias(apply(deviceId, item, []), 'device');
                      if (deviceGroup) alias(apply(deviceGroup, item, []), 'group');
                    } catch { unavailable(); }
                  }
                } catch { unavailable(); }
                return values;
              }]);
            } };
            record(found.target, 'enumerateDevices', found.field, { ...found.field, value: meta(enumerateDevices, original) });
          }
        } catch { unavailable(); }
      }
      if (capture(mediaDevices, 'getUserMedia')) method(mediaDevices, 'getUserMedia', null, false, args => {
        if (!args.length) return args; const next=copyArguments(args);
        setArgument(next,0,dictionary(argumentAt(args,0),{audio:item=>constraints(item,true),video:item=>constraints(item,true)})); return next;
      });
      if (capture(mediaDevices, 'selectAudioOutput')) method(mediaDevices, 'selectAudioOutput', null, false, args => {
        if (!args.length) return args;const next=copyArguments(args);setArgument(next,0,dictionary(argumentAt(args,0),{deviceId:restoreId}));return next;
      });
      const element = prototype('HTMLMediaElement'), audio = prototype('AudioContext');
      each([element,audio], target => {
        // AudioContext may return a native AudioSinkInfo for the silent {type:'none'} sink.
        if (capture(target,'sinkId','get')) getter(target,'sinkId',value=>typeof value==='string'?alias(value,'device'):value);
        if (capture(target,'setSinkId')) method(target,'setSinkId',null,false,args=>{if(!args.length)return args;const next=copyArguments(args);setArgument(next,0,restoreId(argumentAt(args,0)));return next;});
      });
      const audioWrappers = new I.NativeWeakMap();
      each(['AudioContext','webkitAudioContext'], name => {
        try {
          const field=descriptor(realm,name);if(!field||typeof field.value!=='function')return;
          if(!field.configurable){unavailable();return;}
          const original=field.value;let wrapper=getWeak(audioWrappers,original);
          if(!wrapper){
            const prepare=args=>{if(state.stopped||!args.length)return args;const next=copyArguments(args);setArgument(next,0,dictionary(argumentAt(args,0),{sinkId:restoreId}));return next;};
            wrapper=new I.NativeProxy(original,{apply(target,receiver,args){return apply(target,receiver,prepare(args));},construct(target,args,newTarget){return construct(target,prepare(args),newTarget===wrapper?target:newTarget);},setPrototypeOf(target,value){if(value===wrapper){I.setPrototype(target,target);return false;}return I.reflectSetPrototype(target,value);}});
            setWeak(audioWrappers,original,wrapper);
          }
          record(realm,name,field,{...field,value:wrapper});
          const nativePrototype=own(original,'prototype'),constructor=nativePrototype&&descriptor(nativePrototype,'constructor');
          if(constructor&&constructor.configurable&&hasOwn(constructor,'value')&&constructor.value===original)record(nativePrototype,'constructor',constructor,{...constructor,value:wrapper});
        }catch{unavailable();}
      });
      // Existing privileged device handles remain native; only their available identity strings change.
      each([['BluetoothDevice',['id','name']],['BluetoothAdvertisingEvent',['name'],'BluetoothDevice'],['USBDevice',['serialNumber','productName','manufacturerName']],['USBConfiguration',['configurationName']],['USBAlternateInterface',['interfaceName']],['HIDDevice',['productName']],['Gamepad',['id']],['SpeechSynthesisVoice',['voiceURI','name']],['MIDIPort',['id','manufacturer','name','version']]], item => {
        const name=item[0],fields=item[1],domain=item[2]||name;
        const target=prototype(name);
        for(let index=0;index<fields.length;index++) {
          const key=fields[index];if(!capture(target,key,'get'))continue;
          getter(target,key,value=>{
            if(value===undefined||value===null||value==='')return value;
            const identifier=alias(value,domain+':'+key);
            return key==='id'||key==='serialNumber'||key==='voiceURI'?identifier:identifier?'Device '+stringSlice(identifier,0,12):'';
          });
        }
      });
      // Maplike MIDI keys are the same identities as MIDIPort.id. Their native
      // handles, live iteration and native send/receive operations are retained.
      const midiIterators=new I.NativeWeakMap();
      each(['MIDIInputMap','MIDIOutputMap'],name=>{
        const target=prototype(name);if(!target)return;
        const nativeForEach=capture(target,'forEach');
        if(!nativeForEach){unavailable();return;}
        function restoreMidiKey(value,receiver){
          if(typeof value!=='string')return value;
          if(getMap(originals,value)===undefined&&test(/^[a-f0-9]{64}$/,value)){
            let count=0;
            apply(nativeForEach,receiver,[(port,key)=>{if(++count>256)return fail();alias(key,'MIDIPort:id');}]);
          }
          return restoreId(value);
        }
        function keyArguments(args,receiver){
          if(!args.length)return args;const next=copyArguments(args),value=argumentAt(args,0);
          if(value!==null&&(typeof value==='object'||typeof value==='function')){
            // WebIDL drives ToPrimitive and receiver validation. Caller getters
            // and coercion methods retain their original receiver and run once.
            setArgument(next,0,new I.NativeProxy(I.create(null),{get(_target,key){
              const method=I.get(value,key,value);
              if((key===I.primitiveSymbol||key==='toString'||key==='valueOf')&&typeof method==='function')return function(){return restoreMidiKey(apply(method,value,arguments),receiver);};
              return method;
            }}));
          }else if(typeof value==='string'&&test(/^[a-f0-9]{64}$/,value)&&getMap(originals,value)===undefined){
            setArgument(next,0,{[I.primitiveSymbol](){return restoreMidiKey(value,receiver);}});
          }else setArgument(next,0,restoreId(value));
          return next;
        }
        each(['get','has'],key=>{if(capture(target,key))method(target,key,null,false,keyArguments);});
        function safeIterator(iterator,kind){
          if(!iterator||typeof iterator!=='object')return fail();
          const original=capture(iterator,'next');if(!original)return fail();
          const wrapper=I.create(I.prototype(iterator));
          setWeak(midiIterators,wrapper,{iterator,kind,original});
          const {next}= {next(){
            const owned=getWeak(midiIterators,this);
            if(!owned)return apply(original,this,arguments);
            const result=apply(owned.original,owned.iterator,arguments);
            if(state.stopped||own(result,'done'))return result;
            const value=own(result,'value');
            if(owned.kind==='keys')return {done:false,value:alias(value,'MIDIPort:id')};
            if(!I.isArray(value)||value.length!==2)return fail();
            return {done:false,value:[alias(own(value,0),'MIDIPort:id'),own(value,1)]};
          }};
          define(wrapper,'next',{value:meta(next,original),configurable:true,writable:true});return wrapper;
        }
        each(['keys','entries',I.iteratorSymbol],key=>{if(capture(target,key))method(target,key,iterator=>safeIterator(iterator,key==='keys'?'keys':'entries'));});
        const found=owner(target,'forEach');
        try{
          if(!found||!found.field.configurable){unavailable();return;}
          const {forEach}={forEach(callback,thisArg){
            if(state.stopped||typeof callback!=='function')return apply(nativeForEach,this,arguments);
            return apply(nativeForEach,this,[(port,key,map)=>apply(callback,thisArg,[port,alias(key,'MIDIPort:id'),map]),thisArg]);
          }};
          record(found.target,'forEach',found.field,{...found.field,value:meta(forEach,nativeForEach)});
        }catch{unavailable();}
      });
    }
  }
  return {
    snapshot() { const entries=[];each(rows,row=>push(entries,{...row}));return { ...state, entries }; },
    stop() {
      if (state.stopped) return; state.stopped = true;
      for (let index = handles.length - 1; index >= 0; index--) {
        const handle = handles[index];
        try {
          const current = descriptor(handle.target, handle.key), next = handle.next;
          if (!current) continue;
          if (hasOwn(next, 'value') ? current.value !== next.value : current.get !== next.get || current.set !== next.set) continue;
          define(handle.target, handle.key, handle.previous);
        } catch { /* A later page descriptor remains owned by the page. */ }
      }
    }
  };
}
