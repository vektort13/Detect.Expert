// ADR-087: opt-in readback/metadata projections. Serialized; keep self-contained.
export function installSurfaceCustom(realm, entries) {
  'use strict';
  const cached = installSurfaceCustom.__detectExpertSurfaceIntrinsicsV1;
  const I = cached || {
    own: Object.getOwnPropertyDescriptor, define: Object.defineProperty, proto: Object.getPrototypeOf,
    setProto: Object.setPrototypeOf, reflectSetProto: Reflect.setPrototypeOf, apply: Reflect.apply, construct: Reflect.construct, remove: Reflect.deleteProperty,
    Proxy, WeakMap, WeakSet, weakGet: WeakMap.prototype.get, weakSet: WeakMap.prototype.set,
    // Buffers whose samples the page authored itself (audioFingerprint): weak, shared by every realm this installer patches.
    setHas: WeakSet.prototype.has, setAdd: WeakSet.prototype.add, authored: new WeakSet(),
    // Audio channels already projected in place (buffer -> bit mask of channels 0..31), ScriptProcessor input buffers that the engine
    // refills for every event (never cached) and AudioProcessingEvents constructed by the page (not engine dispatched).
    projected: new WeakMap(), live: new WeakSet(), pageEvents: new WeakSet(),
    round: Math.round, fround: Math.fround, isInteger: Number.isInteger,
    ArrayBuffer, Uint8Array, Uint32Array, Float32Array, Int32Array, Float64Array,
    arrayProto: Array.prototype, arrayValues: Array.prototype.values, iterator: Symbol.iterator,
    isArray: Array.isArray, number: Number, finite: Number.isFinite, floor: Math.floor,
    pow: Math.pow, min: Math.min, max: Math.max, charCode: String.prototype.charCodeAt,
    lower: String.prototype.toLowerCase, regexpExec: RegExp.prototype.exec, keys: Object.keys,
    split: String.prototype.split, trim: String.prototype.trim, slice: String.prototype.slice,
    join: Array.prototype.join, imul: Math.imul,
    typedLength: Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'length').get,
    typedBuffer: Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'buffer').get,
    typedTag: Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), Symbol.toStringTag).get,
    sharedLength: typeof SharedArrayBuffer === 'function' ? Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, 'byteLength').get : null,
    Denial: typeof DOMException === 'function' ? DOMException : Error,
  };
  if (!cached) I.define(installSurfaceCustom, '__detectExpertSurfaceIntrinsicsV1', { value: I });
  const handles = [], rows = [], state = { installed: 0, unavailable: 0, changed: 0, stopped: false };
  let row;
  function own(object, key) { if (object === null || typeof object !== 'object' && typeof object !== 'function') return; const field = I.own(object, key); return field && I.own(field, 'value') ? field.value : undefined; }
  function push(array, value) { I.define(array, array.length, { value, configurable: true, enumerable: true, writable: true }); }
  function prototype(name) { return own(own(realm, name), 'prototype'); }
  function field(object, key) { for (let depth = 0; object && depth < 16; depth++, object = I.proto(object)) { const descriptor = I.own(object, key); if (descriptor) return { target: object, descriptor }; } return null; }
  // ADR-112: every Proxy wrapper of a native function refuses to close a prototype cycle through itself (Object.setPrototypeOf(fn, fn)) with the
  // engine's own TypeError, as the native function does; accepted, the cycle would make every later property read of the function overflow the
  // stack. Everything else is forwarded to the target. `handler` is a fresh literal of the caller.
  function wrap(original, handler) {
    let self;
    I.setProto(handler, null); // no trap can be inherited from a page-extended Object.prototype
    handler.setPrototypeOf = function(target, value) { if (value === self) { I.setProto(target, target); return false; } return I.reflectSetProto(target, value); };
    return self = new I.Proxy(original, handler);
  }
  // ADR-112: a replacement function (not a Proxy) reports the name and length of the function it replaces. This copies two descriptors, the
  // compatibility measure docs/PROJECT_RULES.md allows; Function.prototype.toString is not touched.
  function matchMeta(replacement, source) {
    const length = own(source, 'length'), name = own(source, 'name');
    try {
      if (typeof length === 'number') I.define(replacement, 'length', { value: length, writable: false, enumerable: false, configurable: true });
      if (typeof name === 'string') I.define(replacement, 'name', { value: name, writable: false, enumerable: false, configurable: true });
    } catch { /* the default name and length stay */ }
  }
  function unavailable(counter = row) { if (counter.unavailable < 65535) counter.unavailable++; if (state.unavailable < 65535) state.unavailable++; }
  function changed() { if (state.changed < 65535) state.changed++; }
  function deny() { unavailable(); throw new I.Denial('Selected readback is unavailable for this operation', 'SecurityError'); }
  function save(target, key, original, descriptor) { if (handles.length >= 4096) { unavailable(); return false; } I.define(target, key, descriptor); push(handles, { target, key, original, descriptor }); state.installed++; row.installed++; return true; }
  // skip(receiver) true: the call passes through natively and is not counted. quiet: the result is only observed, never changed.
  function method(object, key, transform, before = null, skip = null, quiet = false) {
    const found = field(object, key);
    if (!found || !found.descriptor.configurable || typeof found.descriptor.value !== 'function') { unavailable(); return; }
    const original = found.descriptor.value, counter = row;
    const wrapped = wrap(original, { apply(target, receiver, args) {
      if (state.stopped || skip && skip(receiver)) return I.apply(target, receiver, args);
      const prior = row; row = counter;
      try {
        if (before) before(receiver, args);
        const native = I.apply(target, receiver, args);
        if (state.stopped) return native;
        const value = transform(native, receiver, args); if (!quiet) changed(); return value;
      } finally { row = prior; }
    } });
    save(found.target, key, found.descriptor, { ...found.descriptor, value: wrapped });
  }
  function getter(object, key, transform, quiet = false) {
    const found = field(object, key);
    if (!found || !found.descriptor.configurable || typeof found.descriptor.get !== 'function') { unavailable(); return; }
    const original = found.descriptor.get;
    const wrapped = wrap(original, { apply(target, receiver, args) { const native = I.apply(target, receiver, args); if (state.stopped) return native; const result = transform(native, receiver); if (!quiet) changed(); return result; } });
    save(found.target, key, found.descriptor, { ...found.descriptor, get: wrapped });
  }
  function array() { const output = [], target = prototype('Array'); if (target && target !== I.arrayProto) I.setProto(output, target); return output; }
  function contains(values, value) { for (let index = 0; values && index < values.length; index++) if (own(values, index) === value) return true; return false; }
  function listIterator(values) { return I.apply(I.arrayValues, values, []); }
  function uint(value) { if (value !== null && (typeof value === 'object' || typeof value === 'function')) return null; return I.number(value) >>> 0; }
  function seedWord(seed, scope) {
    let output = 2166136261;
    for (let index = 0; index < seed.length; index++) output = I.imul(output ^ I.apply(I.charCode, seed, [index]), 16777619) >>> 0;
    // An optional scope (document origin) follows a NUL separator, so one profile seed gives one word per origin.
    for (let index = -1; scope !== undefined && index < scope.length; index++) output = I.imul(output ^ (index < 0 ? 0 : I.apply(I.charCode, scope, [index])), 16777619) >>> 0;
    return output;
  }
  // Property read through the descriptor found now: the accessor's own getter (called on object) or a plain data value.
  function read(object, key) {
    const found = object !== null && (typeof object === 'object' || typeof object === 'function') ? field(object, key) : null;
    if (!found) return undefined;
    const accessor = own(found.descriptor, 'get'); return typeof accessor === 'function' ? I.apply(accessor, object, []) : own(found.descriptor, 'value');
  }
  // Window.origin through the accessor found at install time, as the canvas and math installers do.
  // An opaque ('null'), empty, oversized or unreadable origin stays unscoped (the pre-scoping behaviour).
  function documentOrigin() {
    let origin;
    try { origin = read(realm, 'origin'); } catch { /* unscoped */ }
    return typeof origin === 'string' && origin.length > 0 && origin.length <= 2048 && origin !== 'null' ? origin : undefined;
  }
  // Top-level site of the document: the last Location.ancestorOrigins entry. Chromium exposes the list; Firefox does not (unverified
  // for newer builds) and workers have no frame chain, so both keep the frame origin. A third-party frame embedded on two sites
  // therefore gets two values. A top-level document (empty list) and every opaque ('null'), empty, oversized (> 512) or unreadable
  // case return undefined, and the caller keeps the frame origin exactly as before. Read once at install: the list getter and
  // DOMStringList.length come from this realm, the entry by bounded index; no iteration, item() or other page-patchable method.
  function topOrigin() {
    try {
      const list = read(read(realm, 'location'), 'ancestorOrigins'); if (list === null || typeof list !== 'object' && typeof list !== 'function') return undefined;
      const lengthField = field(prototype('DOMStringList'), 'length'), lengthGet = lengthField && own(lengthField.descriptor, 'get');
      const length = typeof lengthGet === 'function' ? I.apply(lengthGet, list, []) : own(list, 'length');
      if (typeof length !== 'number' || !(length >= 1) || length > 1024) return undefined;
      const top = list[length - 1];
      return typeof top === 'string' && top.length > 0 && top.length <= 512 && top !== 'null' ? top : undefined;
    } catch { return undefined; }
  }
  function scopeOrigin() { const top = topOrigin(); return top !== undefined ? top : documentOrigin(); }
  // A private profile key (ADR-107): exactly 64 lower-case hex digits, checked without page-patchable methods.
  function hex64(text) {
    if (typeof text !== 'string' || text.length !== 64) return false;
    for (let index = 0; index < 64; index++) { const code = I.apply(I.charCode, text, [index]); if (!(code >= 48 && code <= 57 || code >= 97 && code <= 102)) return false; }
    return true;
  }
  function accessor(object, key) { const found = field(object, key), get = found && own(found.descriptor, 'get'); return typeof get === 'function' ? get : undefined; }
  function mix(seed, channel, offset) { let value = (seed ^ I.imul(channel, 374761393) ^ I.imul(offset, 668265263)) >>> 0; value = I.imul(value ^ value >>> 13, 1274126177) >>> 0; return (value ^ value >>> 16) >>> 0; }
  const glNames = {
    VERSION: 7938, SHADING_LANGUAGE_VERSION: 35724, MAX_TEXTURE_SIZE: 3379, MAX_VIEWPORT_DIMS: 3386,
    MAX_VERTEX_ATTRIBS: 34921, MAX_TEXTURE_IMAGE_UNITS: 34930, MAX_VERTEX_TEXTURE_IMAGE_UNITS: 35660,
    MAX_COMBINED_TEXTURE_IMAGE_UNITS: 35661, MAX_VERTEX_UNIFORM_VECTORS: 36347, MAX_FRAGMENT_UNIFORM_VECTORS: 36349,
    MAX_VARYING_VECTORS: 36348, MAX_RENDERBUFFER_SIZE: 34024, MAX_CUBE_MAP_TEXTURE_SIZE: 34076,
    MAX_3D_TEXTURE_SIZE: 32883, MAX_ARRAY_TEXTURE_LAYERS: 35071, MAX_DRAW_BUFFERS: 34852,
    MAX_COLOR_ATTACHMENTS: 36063, MAX_SAMPLES: 36183, MAX_UNIFORM_BUFFER_BINDINGS: 35375,
    RED_BITS: 3410, GREEN_BITS: 3411, BLUE_BITS: 3412, ALPHA_BITS: 3413, DEPTH_BITS: 3414, STENCIL_BITS: 3415,
    SUBPIXEL_BITS: 3408, MAX_ELEMENT_INDEX: 36203, ALIASED_LINE_WIDTH_RANGE: 33902, ALIASED_POINT_SIZE_RANGE: 33901,
  };
  function glCapabilities(value, entry) {
    const parameters = own(value, 'parameters'), extensions = own(value, 'extensions'), patched = [], opaqueNeutral = own(entry, 'opaqueNeutral') === true;
    const names = ['WebGLRenderingContext', 'WebGL2RenderingContext'];
    // pname -> key, built once: the getParameter wrapper runs on every call and must not rebuild the key list.
    const keyOf = { __proto__: null }, glKeys = I.keys(glNames);
    for (let keyIndex = 0; keyIndex < glKeys.length; keyIndex++) { const pname = glNames[glKeys[keyIndex]]; if (keyOf[pname] === undefined) keyOf[pname] = glKeys[keyIndex]; }
    for (let nameIndex = 0; nameIndex < names.length; nameIndex++) {
      const name = names[nameIndex];
      const target = prototype(name), found = field(target, 'getParameter');
      if (!found || contains(patched, found.target)) continue; push(patched, found.target);
      if (parameters) method(target, 'getParameter', (native, receiver, args) => {
        const number = uint(args[0]); if (number === null) {
          unavailable(); let tag; try { tag = I.apply(I.typedTag, native, []); } catch { /* non-view native handle */ }
          return typeof native === 'string' || typeof native === 'number' || typeof tag === 'string' ? undefined : native;
        }
        const key = keyOf[number];
        if (key !== undefined) {
          const selected = own(parameters, key); if (selected === undefined || native === null) return native;
          if (typeof native === 'number' && typeof selected === 'number') return I.min(native, selected);
          if (typeof native === 'string' && typeof selected === 'string') return selected;
          if (I.isArray(selected) && native && typeof native === 'object') {
            let type; try { type = I.apply(I.typedTag, native, []); } catch { return native; }
            const Constructor = type === 'Int32Array' ? I.Int32Array : type === 'Float32Array' ? I.Float32Array : null;
            if (!Constructor) return native; const output = new Constructor(2);
            if (key === 'MAX_VIEWPORT_DIMS' || opaqueNeutral) {
              output[0] = I.min(native[0], selected[0]); output[1] = I.min(native[1], selected[1]);
            } else {
              output[0] = I.max(native[0], selected[0]); output[1] = I.min(native[1], selected[1]);
              if (output[0] > output[1]) deny();
            }
            const targetPrototype = prototype(type); if (targetPrototype) I.setProto(output, targetPrototype); return output;
          }
          return native;
        }
        return native;
      });
      if (extensions !== undefined) {
        // ADR-112: WEBGL_lose_context is never hidden. A page that is told it has no such extension cannot release its contexts, and the
        // browser then warns about too many active contexts, which a plain Chrome never shows for the same page.
        method(target, 'getSupportedExtensions', native => { if (native === null) return null; const result = array(); for (let index = 0; index < native.length; index++) if (native[index] === 'WEBGL_lose_context' || contains(extensions, native[index])) push(result, native[index]); return result; });
        method(target, 'getExtension', (native, receiver, args) => {
          if (native === null) return null;
          const argument = args[0]; if (typeof argument !== 'string') return null;
          const lower = I.apply(I.lower, argument, []); if (lower === 'webgl_lose_context') return native; for (let index = 0; index < extensions.length; index++) if (I.apply(I.lower, extensions[index], []) === lower) return native; return null;
        });
      }
    }
    if (!patched.length) unavailable();
  }
  function gpuCapabilities(value) {
    const limits = own(value, 'limits'), features = own(value, 'features');
    const limitKeys = limits ? I.keys(limits) : [];
    for (let keyIndex = 0; keyIndex < limitKeys.length; keyIndex++) { const key = limitKeys[keyIndex];
      const selected = own(limits, key), minimum = key === 'minUniformBufferOffsetAlignment' || key === 'minStorageBufferOffsetAlignment';
      getter(prototype('GPUSupportedLimits'), key, native => typeof native === 'number' ? minimum ? I.max(native, selected) : I.min(native, selected) : native);
    }
    if (features === undefined) return;
    const target = prototype('GPUSupportedFeatures'), forEachField = field(target, 'forEach');
    if (!target || !forEachField || typeof forEachField.descriptor.value !== 'function') { unavailable(); return; }
    const originalForEach = forEachField.descriptor.value;
    function filtered(receiver) {
      const result = array();
      // Captured native iteration invokes only our callback; never execute a
      // page-replaced iterator.next while constructing a private projection.
      I.apply(originalForEach, receiver, [function(value) { if (result.length < 256 && contains(features, value)) push(result, value); }]);
      return result;
    }
    getter(target, 'size', (native, receiver) => filtered(receiver).length);
    method(target, 'has', (native, receiver, args) => native === true && typeof args[0] === 'string' && contains(features, args[0]));
    const iterators = ['values', 'keys', I.iterator];
    for (let index = 0; index < iterators.length; index++) method(target, iterators[index], (native, receiver) => listIterator(filtered(receiver)));
    method(target, 'entries', (native, receiver) => { const values = filtered(receiver), result = array(); for (let index = 0; index < values.length; index++) { const pair = array(); push(pair, values[index]); push(pair, values[index]); push(result, pair); } return listIterator(result); });
    const found = field(target, 'forEach');
    if (found && typeof found.descriptor.value === 'function' && found.descriptor.configurable) {
      const original = found.descriptor.value;
      const wrapped = wrap(original, { apply(fn, receiver, args) {
        if (state.stopped || typeof args[0] !== 'function') return I.apply(fn, receiver, args);
        const callback = args[0], thisArg = args[1];
        return I.apply(fn, receiver, [function(value) { if (contains(features, value)) I.apply(callback, thisArg, [value, value, receiver]); }]);
      } });
      save(found.target, 'forEach', found.descriptor, { ...found.descriptor, value: wrapped });
    } else unavailable();
  }
  function textMetrics(value) {
    const scale = own(value, 'scale');
    const keys = ['width', 'actualBoundingBoxLeft', 'actualBoundingBoxRight', 'fontBoundingBoxAscent', 'fontBoundingBoxDescent', 'actualBoundingBoxAscent', 'actualBoundingBoxDescent', 'emHeightAscent', 'emHeightDescent', 'hangingBaseline', 'alphabeticBaseline', 'ideographicBaseline'];
    // The scaled value keeps the native value domain: an integral metric stays integral (Math.round) and a float32 metric stays
    // float32 (Math.fround; Chromium measures in float), so a fractional font ascent or a double-precision width cannot reveal the
    // scaling. Any other finite double is scaled as before; non-numbers and non-finite values stay native.
    const scaled = native => typeof native !== 'number' || !I.finite(native) ? native : I.isInteger(native) ? I.round(native * scale) : I.fround(native) === native ? I.fround(native * scale) : native * scale;
    for (let index = 0; index < keys.length; index++) getter(prototype('TextMetrics'), keys[index], scaled);
  }
  // Replaces the global constructor `name` by a construct trap (original once, original arguments and new.target) that adds every
  // instance it returns to the weak `set`. False when the binding cannot be replaced; the caller then keeps its safe default.
  function track(name, set) {
    const found = field(realm, name), Constructor = found && own(found.descriptor, 'value');
    if (!found || !found.descriptor.configurable || typeof Constructor !== 'function') { unavailable(); return false; }
    const wrapper = wrap(Constructor, { construct(target, args, newTarget) {
      const instance = I.construct(target, args, newTarget === wrapper ? target : newTarget);
      if (!state.stopped && instance !== null && typeof instance === 'object') I.apply(I.setAdd, set, [instance]);
      return instance;
    } });
    const home = own(Constructor, 'prototype'), alias = home && I.own(home, 'constructor');
    if (alias && alias.configurable && own(alias, 'value') === Constructor) save(home, 'constructor', alias, { ...alias, value: wrapper });
    return save(found.target, name, found.descriptor, { ...found.descriptor, value: wrapper });
  }
  function audioFingerprint(value, entry) {
    // ADR-107: the noise is keyed by the private per-profile key (entry.audioKey) and the top-level site; the portable value seed only
    // identifies the profile, so a published profile JSON cannot reproduce or undo the noise. Without a valid key every covered
    // engine read fails closed before its native call (page-written buffers stay readable).
    const key = own(entry, 'audioKey'), ready = hex64(key), amplitude = own(value, 'amplitude');
    const seed = ready ? seedWord(key, scopeOrigin()) : 0;
    if (!ready) unavailable();
    const buffer = new I.ArrayBuffer(4), floats = new I.Float32Array(buffer), words = new I.Uint32Array(buffer);
    const nativeLength = field(prototype('AudioBuffer'), 'length')?.descriptor.get;
    if (typeof nativeLength !== 'function') { unavailable(); return; }
    // Samples per call and channel (2^26, about 25 minutes at 44.1 kHz). project() costs about 3.3 ns/sample
    // (~0.2 s at the cap); longer buffers stay denied because a native tail would bypass the projection.
    const limit = 67108864, masks = [];
    for (let exponent = 0; exponent < 256; exponent++) {
      let bits = 0;
      if (exponent !== 0 && exponent !== 255) { const ulp = I.pow(2, exponent - 150); while (bits < 16 && I.pow(2, bits + 1) * ulp <= amplitude) bits++; }
      push(masks, bits ? (1 << bits) - 1 : 0);
    }
    function project(samples, channel, offset, length) {
      for (let index = 0; index < length; index++) {
        floats[0] = samples[index]; const original = words[0], exponent = original >>> 23 & 255;
        const mask = masks[exponent]; if (!mask) continue;
        words[0] = (original & ~mask) | (mix(seed, channel, offset + index) & mask); samples[index] = floats[0];
      }
    }
    // Buffers the page authored itself (createBuffer, new AudioBuffer) are returned natively: a page that writes samples into a buffer
    // it created and reads them back sees exactly what it wrote, as in an unmodified browser. Engine-produced buffers (startRendering,
    // decodeAudioData, ...) are never in the set and keep the projection. The weak set is filled only by the createBuffer and AudioBuffer
    // constructor wrappers and by outputBuffer of engine-dispatched ScriptProcessor events (below), so a path they miss leaves a page
    // buffer projected (the old behaviour) and can never expose engine samples.
    const authored = receiver => I.apply(I.setHas, I.authored, [receiver]);
    // A channel projected in place stays projected (the engine returns the same array again), so later reads skip the work: the
    // widely copied loop calling getChannelData(0)[i] hundreds of times costs one projection instead of one per call (a timing
    // signal), and samples the page writes into an engine buffer afterwards read back as written. ScriptProcessor input buffers are
    // refilled by the engine for every event (Chromium reuses the same AudioBuffer objects), so they are projected on every read.
    function cached(receiver, channel) { return channel < 32 && !I.apply(I.setHas, I.live, [receiver]) && (I.apply(I.weakGet, I.projected, [receiver]) & 1 << channel) !== 0; }
    function remember(receiver, channel) { if (channel < 32 && !I.apply(I.setHas, I.live, [receiver])) I.apply(I.weakSet, I.projected, [receiver, I.apply(I.weakGet, I.projected, [receiver]) | 1 << channel]); }
    method(prototype('AudioBuffer'), 'getChannelData', (native, receiver, args) => {
      const channel = uint(args[0]); if (channel === null) deny();
      const length = I.apply(I.typedLength, native, []); if (length > limit) deny();
      if (!cached(receiver, channel)) { project(native, channel, 0, length); remember(receiver, channel); }
      return native;
    }, (receiver, args) => { if (!ready || args[0] !== null && (typeof args[0] === 'object' || typeof args[0] === 'function')) deny(); if (I.apply(nativeLength, receiver, []) > limit) deny(); }, authored);
    method(prototype('AudioBuffer'), 'copyFromChannel', (native, receiver, args) => {
      const channel = uint(args[1]), offset = args.length >= 3 ? uint(args[2]) : 0;
      // A channel already projected in place is copied projected by the native call.
      if (cached(receiver, channel)) return native;
      const length = I.min(I.apply(I.typedLength, args[0], []), I.max(0, I.apply(nativeLength, receiver, []) - offset));
      project(args[0], channel, offset, length); return native;
    }, (receiver, args) => {
      if (!ready) deny();
      for (let index = 1; index <= 2 && index < args.length; index++) if (args[index] !== null && (typeof args[index] === 'object' || typeof args[index] === 'function')) deny();
      if (I.apply(I.typedLength, args[0], []) > limit) deny();
    }, authored);
    method(prototype('BaseAudioContext'), 'createBuffer', native => { if (native !== null && typeof native === 'object') I.apply(I.setAdd, I.authored, [native]); return native; }, null, null, true);
    // AnalyserNode readouts land in the page's own array: the native call runs once, then only the entries it wrote (min(length,
    // frequencyBinCount) or min(length, fftSize)) are projected in place, each keyed by (key, kind, index). Decibel values move by a
    // keyed RELATIVE step of 0.5..1 x max(amplitude, 2^-20) of their magnitude (at least four float32 steps): the low-mantissa
    // projection of samples would leave every bin below about -0.5 dB untouched at amplitude 1e-5. -Infinity (silent bins), NaN and
    // 0 stay exact. Time-domain floats are samples and take the sample projection. Bytes move by one level in a keyed eighth of the
    // bins, never from or onto 0 and 255 (clipped and silent bins), and time-domain 128 (silence) stays 128.
    const analyser = prototype('AnalyserNode'), bins = accessor(analyser, 'frequencyBinCount'), size = accessor(analyser, 'fftSize');
    const relative = amplitude > 9.5367431640625e-7 ? amplitude : 9.5367431640625e-7;
    const readouts = ['getFloatFrequencyData', 'getByteFrequencyData', 'getFloatTimeDomainData', 'getByteTimeDomainData'];
    if (analyser && (!bins || !size)) unavailable();
    else if (analyser) for (let kind = 0; kind < 4; kind++) method(analyser, readouts[kind], (native, receiver, args) => {
      const array = args[0], count = I.min(I.apply(I.typedLength, array, []), I.apply(kind < 2 ? bins : size, receiver, []));
      if (kind === 2) { project(array, 65538, 0, count); return native; }
      for (let index = 0; index < count; index++) {
        const word = mix(seed, 65536 + kind, index), level = array[index];
        if (kind === 0) { if (level !== 0 && I.finite(level)) array[index] = level + level * relative * (word & 1 ? 1 : -1) * (0.5 + (word >>> 16) / 131072); }
        else if ((word & 7) === 0 && level !== 0 && level !== 255 && (kind === 1 || level !== 128)) array[index] = word & 8 ? level === 254 ? 253 : level + 1 : level === 1 ? 2 : level - 1;
      }
      return native;
    }, () => { if (!ready) deny(); });
    // Same construct-trap shape as the AudioContext wrapper in audioMetadata: the original runs once with the original arguments and new.target.
    track('AudioBuffer', I.authored);
    // ScriptProcessor: inputBuffer is engine output (projected, never cached); outputBuffer is the page's to fill, so it reads back
    // natively like a buffer the page created. Only engine-dispatched events count: an AudioProcessingEvent the page constructs around
    // an engine buffer (from startRendering) must not move that buffer into the page-written set, and without the constructor wrapper
    // outputBuffer stays projected.
    const eventPrototype = prototype('AudioProcessingEvent');
    if (eventPrototype) {
      getter(eventPrototype, 'inputBuffer', buffer => { if (buffer !== null && typeof buffer === 'object') I.apply(I.setAdd, I.live, [buffer]); return buffer; }, true);
      if (track('AudioProcessingEvent', I.pageEvents)) getter(eventPrototype, 'outputBuffer', (buffer, receiver) => {
        if (buffer !== null && typeof buffer === 'object' && !I.apply(I.setHas, I.pageEvents, [receiver])) I.apply(I.setAdd, I.authored, [buffer]);
        return buffer;
      }, true);
    }
  }
  function audioMetadata(value) {
    // Latency and channel rows apply to every AudioContext. The selected sampleRate belongs only to a live
    // AudioContext created without page options: OfflineAudioContext, AudioBuffer rate/duration and
    // page-chosen rates keep their native values (a WAV header or a duration computed from them stays true).
    const keys = [['AudioContext', 'baseLatency'], ['AudioContext', 'outputLatency'], ['AudioDestinationNode', 'maxChannelCount']];
    for (let index = 0; index < keys.length; index++) { const name = keys[index][0], key = keys[index][1];
      const selected = own(value, key); if (selected !== undefined) getter(prototype(name), key, native => key === 'maxChannelCount' ? I.min(native, selected) : selected);
    }
    const rate = own(value, 'sampleRate'); if (rate === undefined) return;
    const defaults = new I.WeakMap(), names = ['AudioContext', 'webkitAudioContext']; let wrapper = null, original = null;
    for (let index = 0; index < names.length; index++) {
      const found = field(realm, names[index]), ctor = found && own(found.descriptor, 'value');
      if (!found || !found.descriptor.configurable || typeof ctor !== 'function') { if (index === 0) unavailable(); continue; }
      if (wrapper === null) {
        original = ctor;
        // Constructor arguments cannot be observed afterwards. An options object is never read (that would run
        // page getters or Proxy traps), so only no-argument contexts count as default-rate; options stay native.
        wrapper = wrap(ctor, { construct(target, args, newTarget) {
          const instance = I.construct(target, args, newTarget === wrapper ? target : newTarget);
          if (!state.stopped && (args.length === 0 || args[0] === undefined || args[0] === null)) I.apply(I.weakSet, defaults, [instance, true]);
          return instance;
        } });
        const home = own(ctor, 'prototype'), alias = home && I.own(home, 'constructor');
        if (alias && alias.configurable && own(alias, 'value') === ctor) save(home, 'constructor', alias, { ...alias, value: wrapper });
      } else if (ctor !== original) continue;
      save(found.target, names[index], found.descriptor, { ...found.descriptor, value: wrapper });
    }
    if (wrapper) getter(prototype('BaseAudioContext'), 'sampleRate', (native, receiver) => I.apply(I.weakGet, defaults, [receiver]) === true ? rate : native);
  }
  function clocks(value) {
    const resolution = own(value, 'resolutionMs'), quantize = native => typeof native === 'number' && I.finite(native) ? I.floor(native / resolution) * resolution : native;
    // Date timestamps have integral milliseconds; sub-ms precision belongs to Performance/RAF.
    const dateResolution = I.max(1, -I.floor(-resolution));
    const dateQuantize = native => typeof native === 'number' && I.finite(native) ? I.floor(native / dateResolution) * dateResolution : native;
    method(prototype('Performance'), 'now', quantize); method(own(realm, 'Date'), 'now', dateQuantize);
    const found = field(realm, 'requestAnimationFrame');
    if (found && found.descriptor.configurable && typeof found.descriptor.value === 'function') {
      const original = found.descriptor.value;
      const wrapped = wrap(original, { apply(fn, receiver, args) {
        if (state.stopped || typeof args[0] !== 'function') return I.apply(fn, receiver, args);
        const callback = args[0]; return I.apply(fn, receiver, [function(timestamp) { return I.apply(callback, this, [state.stopped ? timestamp : quantize(timestamp)]); }]);
      } });
      save(found.target, 'requestAnimationFrame', found.descriptor, { ...found.descriptor, value: wrapped });
    }
  }
  function fontPolicy(value) {
    const families = own(value, 'families'), fallback = own(value, 'fallback'), counter = row;
    // CSS family names match case-insensitively: a null-prototype table of lower-cased names, built once (at most 256 names of at
    // most 128 characters; anything else is ignored, so it stays out). "12px arial" therefore matches a selected "Arial".
    const allowed = { __proto__: null };
    for (let index = 0; families && index < families.length && index < 256; index++) {
      const name = own(families, index); if (typeof name === 'string' && name.length <= 128) allowed[I.apply(I.lower, name, [])] = true;
    }
    // Families the page registered itself (FontFace, @font-face) pass as well: the page chose and loaded them, so replacing them by the
    // fallback only breaks canvas apps, and a FontFace with a local() source already bypasses this list, so nothing new is exposed.
    // Read through natives captured now (document_start, before page scripts), never through page-patchable methods; a size change
    // triggers one bounded rescan (at most 256 faces). Unverified on live browsers: FontFaceSet forEach/size and the FontFace.family
    // string format. If any capture is missing the pass-through is off and the strict list stays in force.
    const setPrototype = prototype('FontFaceSet'), faceFamilyField = field(prototype('FontFace'), 'family');
    const walkField = field(setPrototype, 'forEach'), sizeField = field(setPrototype, 'size');
    const documentField = field(realm, 'document'), documentFontsField = field(prototype('Document'), 'fonts');
    const scopeFontsField = prototype('Document') ? null : field(realm, 'fonts');
    const walk = walkField && own(walkField.descriptor, 'value'), sizeOf = sizeField && own(sizeField.descriptor, 'get'), familyOf = faceFamilyField && own(faceFamilyField.descriptor, 'get');
    // ADR-110: the HTML/CSS font shield adopts hundreds of rules with the unicode-range U+10FFFF. They are the extension's, not the page's:
    // skipped without being counted, so they neither pass a family as "registered by the page" nor use up the bounded scan.
    const rangeField = field(prototype('FontFace'), 'unicodeRange'), rangeOf = rangeField && own(rangeField.descriptor, 'get');
    const documentGet = documentField && own(documentField.descriptor, 'get'), documentFonts = documentFontsField && own(documentFontsField.descriptor, 'get'), scopeFonts = scopeFontsField && own(scopeFontsField.descriptor, 'get');
    const fromDocument = typeof documentGet === 'function' && typeof documentFonts === 'function';
    const passThrough = typeof walk === 'function' && typeof sizeOf === 'function' && typeof familyOf === 'function' && (fromDocument || typeof scopeFonts === 'function');
    const scans = new I.WeakMap();
    function familyKey(name) {
      if (name.length > 130) return undefined;
      let text = I.apply(I.trim, name, []);
      if (text.length >= 2 && (text[0] === '"' || text[0] === "'") && text[text.length - 1] === text[0]) text = I.apply(I.slice, text, [1, -1]);
      return text.length > 0 && text.length <= 128 ? I.apply(I.lower, text, []) : undefined;
    }
    // Lower-cased names of the faces registered in the current FontFaceSet, or null when they cannot be read.
    function pageTable() {
      if (!passThrough) return null;
      try {
        const set = fromDocument ? I.apply(documentFonts, I.apply(documentGet, realm, []), []) : I.apply(scopeFonts, realm, []);
        if (set === null || typeof set !== 'object') return null;
        const size = I.apply(sizeOf, set, []); let scan = I.apply(I.weakGet, scans, [set]);
        if (!scan || scan.size !== size) {
          // Cached before the walk, so a failing walk is not repeated for the same size.
          scan = { size, names: { __proto__: null } }; I.apply(I.weakSet, scans, [set, scan]);
          const known = scan.names; let examined = 0;
          try { I.apply(walk, set, [function(face) { if (typeof rangeOf === 'function' && I.apply(rangeOf, face, []) === 'U+10FFFF') return; if (examined >= 256) return; examined++; const name = I.apply(familyOf, face, []), key = typeof name === 'string' ? familyKey(name) : undefined; if (key !== undefined) known[key] = true; }]); } catch { /* the names read so far stay */ }
        }
        return scan.names;
      } catch { return null; }
    }
    const names = ['CanvasRenderingContext2D', 'OffscreenCanvasRenderingContext2D'];
    for (let nameIndex = 0; nameIndex < names.length; nameIndex++) { const name = names[nameIndex];
      const target = prototype(name), found = field(target, 'font');
      if (!found || !found.descriptor.configurable || typeof found.descriptor.set !== 'function' || typeof found.descriptor.get !== 'function') { unavailable(); continue; }
      const originalSet = found.descriptor.set, originalGet = found.descriptor.get;
      const wrapped = wrap(originalSet, { apply(fn, receiver, args) {
        const result = I.apply(fn, receiver, args); if (state.stopped) return result;
        const native = I.apply(originalGet, receiver, []);
        const matched = I.apply(I.regexpExec, /^(.*?\b[0-9.]+(?:px|pt|pc|in|cm|mm|em|rem|ex|ch|%)(?:\/[^ ]+)?\s+)(.+)$/i, [native]);
        if (!matched) { unavailable(counter); return result; }
        const text = matched[2], parts = [], selected = []; let start = 0, quote = '', escaped = false;
        for (let index = 0; index < text.length; index++) {
          const character = text[index];
          if (escaped) { escaped = false; continue; }
          if (character === '\\') { escaped = true; continue; }
          if (quote) { if (character === quote) quote = ''; continue; }
          if (character === '"' || character === "'") { quote = character; continue; }
          if (character === ',') { push(parts, I.apply(I.slice, text, [start, index])); start = index + 1; }
        }
        push(parts, I.apply(I.slice, text, [start]));
        const generics = ['serif', 'sans-serif', 'monospace', 'system-ui', 'cursive', 'fantasy', 'emoji', 'math', 'fangsong'];
        let web;
        for (let index = 0; index < parts.length && index < 64; index++) {
          const trimmed = I.apply(I.trim, parts[index], []);
          const quoted = trimmed.length >= 2 && (trimmed[0] === '"' && trimmed[trimmed.length - 1] === '"' || trimmed[0] === "'" && trimmed[trimmed.length - 1] === "'");
          const family = quoted ? I.apply(I.slice, trimmed, [1, -1]) : trimmed;
          // Case-insensitive; a family over 128 characters can match nothing. The page's own faces are read only for a family the list rejects.
          const key = family.length <= 128 ? I.apply(I.lower, family, []) : undefined;
          let pass = key !== undefined && (!quoted && contains(generics, key) || allowed[key] === true);
          if (!pass && key !== undefined) { if (web === undefined) web = pageTable(); pass = web !== null && web[key] === true; }
          if (pass) push(selected, trimmed);
        }
        if (!selected.length) push(selected, contains(generics, fallback) ? fallback : '"' + fallback + '"');
        I.apply(originalSet, receiver, [matched[1] + I.apply(I.join, selected, [', '])]); changed(); return result;
      } });
      save(found.target, 'font', found.descriptor, { ...found.descriptor, set: wrapped });
    }
  }
  function browserSurface(value) {
    function hide(object, key) {
      const found = field(object, key); if (!found) { unavailable(); return; }
      const old = found.descriptor;
      if (old.configurable) { if (!I.remove(found.target, key)) { unavailable(); return; } push(handles, { target: found.target, key, original: old, descriptor: undefined }); state.installed++; row.installed++; }
      else if (I.own(old, 'value') && old.writable) save(found.target, key, old, { ...old, value: undefined });
      else unavailable();
    }
    const globals = own(value, 'disabledGlobals'), navigator = own(value, 'disabledNavigator');
    for (let index = 0; globals && index < globals.length; index++) hide(realm, globals[index]);
    for (let index = 0; navigator && index < navigator.length; index++) hide(prototype('Navigator'), navigator[index]);
    if (own(value, 'chrome') === 'hidden') hide(realm, 'chrome');
  }
  // SipHash-2-4 with each 64-bit lane held as two int32 halves (branch-free carries) under the key words k0..k3 (k0 low, k1 high of
  // the first key half). With `bytes` it hashes `length` bytes; with `bytes` null the 16-byte message of the little-endian words
  // w0..w3. Writes the low and high 32 bits of the result to out[0] and out[1].
  function sip(k0, k1, k2, k3, bytes, length, w0, w1, w2, w3, out) {
    let a = k0 ^ 0x70736575, A = k1 ^ 0x736f6d65, b = k2 ^ 0x6e646f6d, B = k3 ^ 0x646f7261;
    let c = k0 ^ 0x6e657261, C = k1 ^ 0x6c796765, d = k2 ^ 0x79746573, D = k3 ^ 0x74656462, low = 0, high = 0, lo = 0, t = 0;
    const blocks = bytes ? length >>> 3 : 2;
    for (let block = 0; block <= blocks + 1; block++) {
      if (block <= blocks) {
        low = 0; high = block === blocks ? length << 24 : 0;
        if (!bytes) { if (block === 0) { low = w0; high = w1; } else if (block === 1) { low = w2; high = w3; } }
        else for (let at = block * 8, end = block === blocks ? length : at + 8; at < end; at++) if ((at & 7) < 4) low |= bytes[at] << (at & 3) * 8; else high |= bytes[at] << (at & 3) * 8;
        d ^= low; D ^= high;
      } else c ^= 255;
      for (let round = block > blocks ? 4 : 2; round > 0; round--) {
        lo = (a + b) | 0; A = (A + B - ((a & b | (a | b) & ~lo) >> 31)) | 0; a = lo;
        lo = (c + d) | 0; C = (C + D - ((c & d | (c | d) & ~lo) >> 31)) | 0; c = lo;
        t = b << 13 | B >>> 19; B = B << 13 | b >>> 19; b = t;
        t = d << 16 | D >>> 16; D = D << 16 | d >>> 16; d = t;
        b ^= a; B ^= A; d ^= c; D ^= C; t = a; a = A; A = t;
        lo = (c + b) | 0; C = (C + B - ((c & b | (c | b) & ~lo) >> 31)) | 0; c = lo;
        lo = (a + d) | 0; A = (A + D - ((a & d | (a | d) & ~lo) >> 31)) | 0; a = lo;
        t = b << 17 | B >>> 15; B = B << 17 | b >>> 15; b = t;
        t = d << 21 | D >>> 11; D = D << 21 | d >>> 11; d = t;
        b ^= c; B ^= C; d ^= a; D ^= A; t = c; c = C; C = t;
      }
      if (block <= blocks) { a ^= low; A ^= high; }
    }
    out[0] = a ^ b ^ c ^ d; out[1] = A ^ B ^ C ^ D;
  }
  // ADR-107: readPixels of the default framebuffer returns exactly what the Canvas projection (api-custom-canvas-runtime.js) returns
  // for the same pixels, so readPixels, getImageData and every export of one canvas agree. With canvas-readback Custom in the same
  // scope the entry carries that row's key (entry.canvasKey) and its algorithm is used; with webgl-readback alone the private
  // entry.webglKey and sparse-rgb-v1. Mirrored from the Canvas runtime (its header is the specification): the 128-bit key is
  // SipHash(seed words 0..3 | 4..7, 'Canvas/v1/o' NUL / 1 + UTF-16LE origin) with the origin read as the Canvas runtime reads it
  // (last ancestorOrigins entry, else Window.origin, 'null' included); only alpha-255 pixels move, one level, reflected at 0/255;
  // framebuffer row y is canvas line height - 1 - y (readPixels rows are bottom-up); the canvas is keyed by its width/height,
  // which must equal the drawing buffer. stable-rgb-v1: SipHash of 'CNVS' | x | line | r g b 1, bit c moves channel c up.
  // sparse-rgb-v1: draw(k) = SipHash of 'SPR1' | width | height | k (lo, hi = low, high 32 bits), N = width * height. N <= 65,536:
  // cell k = pixels [8k, 8k + 8), pixel 8k + j uses byte j of lo|hi (little endian): channel (byte & 127) mod 3, up = byte >>> 7.
  // 65,536 < N <= 262,144: cell k = pixels [16k, 16k + 16), channel (hi & 0xffff) mod 3, up = hi >>> 16 & 1. N > 262,144:
  // run = clamp(floor(floor(N / 100) / 1024), 1, 8), span = 100 * run, run start k * span + lo mod (span - run + 1), channel and
  // direction as for 65,536 < N. Without a usable key, algorithm or origin every read fails closed before its native call.
  // sparse-rgb-v2 (ADR-112): the same cells and draws; the keyed bit `up` is the target parity of the keyed channel, level' = (level & 254) | up,
  // where a channel whose value pair (level >> 1) is 0 or 127 (0, 1, 254, 255) never moves and the next channel in the order R, G, B, R
  // takes the bit (a pixel with three saturated channels stays); and a read of the whole drawing buffer (N <= 262,144) that holds at most
  // 4 distinct RGBA values is returned as rendered. A partial read cannot see the rest of the buffer and the native call may not be repeated,
  // so it is projected (the Canvas runtime looks at a private copy instead).
  function canvasOrigin() {
    let origin = topOrigin();
    if (origin === undefined) try { const get = accessor(realm, 'origin'); origin = get ? I.apply(get, realm, []) : own(realm, 'origin'); } catch { origin = undefined; }
    return typeof origin === 'string' && origin.length > 0 && origin.length <= 2048 ? origin : undefined;
  }
  function glReadback(value, entry) {
    const patched = [], counter = row;
    const names = ['WebGLRenderingContext', 'WebGL2RenderingContext'], spanLimit = 16777216, canvasLimit = 1073741824;
    function miss() { if (counter.unavailable < 65535) counter.unavailable++; if (state.unavailable < 65535) state.unavailable++; }
    function reject() { miss(); throw new I.Denial('Selected readback is unavailable for this operation', 'SecurityError'); }
    const canvasShared = own(entry, 'canvasKey') !== undefined;
    let seed = canvasShared ? own(entry, 'canvasKey') : own(entry, 'webglKey'), algorithm = canvasShared ? undefined : 'sparse-rgb-v1', canvasRows = 0;
    for (let index = 0; canvasShared && index < entries.length && index < 1024; index++) {
      const candidate = own(entries, index);
      if (own(candidate, 'id') === 'canvas-readback' && own(candidate, 'mode') === 'custom') { canvasRows++; algorithm = own(own(candidate, 'value'), 'algorithm'); }
    }
    const parity = algorithm === 'sparse-rgb-v2', sparse = algorithm === 'sparse-rgb-v1' || parity, origin = canvasOrigin(), key = new I.Uint32Array(4), hash = new I.Uint32Array(2);
    const ready = (sparse || algorithm === 'stable-rgb-v1') && canvasRows <= 1 && hex64(seed) && origin !== undefined;
    if (ready) {
      const words = new I.Uint32Array(8), length = 12 + 2 * origin.length, input = new I.Uint8Array(length), domain = [67, 97, 110, 118, 97, 115, 47, 118, 49, 47, 111, 0];
      for (let index = 0; index < 64; index++) { const code = I.apply(I.charCode, seed, [index]); words[index >>> 3] = words[index >>> 3] << 4 | (code <= 57 ? code - 48 : code - 87); }
      for (let index = 0; index < 12; index++) input[index] = domain[index];
      for (let index = 0; index < origin.length; index++) { const code = I.apply(I.charCode, origin, [index]); input[12 + index * 2] = code & 255; input[13 + index * 2] = code >>> 8; }
      sip(words[0], words[1], words[2], words[3], input, length, 0, 0, 0, 0, hash); key[0] = hash[0]; key[1] = hash[1];
      input[11] = 1; sip(words[4], words[5], words[6], words[7], input, length, 0, 0, 0, 0, hash); key[2] = hash[0]; key[3] = hash[1];
    } else miss();
    // The private buffer is prefilled with a keyed pattern to see whether the native call wrote the addressed bytes.
    const sentinel = key[1] ^ key[2];
    seed = null;
    const canvasWidth = accessor(prototype('HTMLCanvasElement'), 'width'), canvasHeight = accessor(prototype('HTMLCanvasElement'), 'height');
    const offscreenWidth = accessor(prototype('OffscreenCanvas'), 'width'), offscreenHeight = accessor(prototype('OffscreenCanvas'), 'height');
    // Width and height of the context's canvas (HTMLCanvasElement or OffscreenCanvas) through getters captured now, else null.
    function canvasSize(context, canvasGet) {
      let canvas; try { canvas = I.apply(canvasGet, context, []); } catch { return null; }
      try { return [I.apply(canvasWidth, canvas, []), I.apply(canvasHeight, canvas, [])]; } catch { /* not an element */ }
      try { return [I.apply(offscreenWidth, canvas, []), I.apply(offscreenHeight, canvas, [])]; } catch { return null; }
    }
    // sparse-rgb-v2: true when the rows hold at most 4 distinct RGBA values (the scan stops at the first pixel that makes a fifth).
    function flatRows(bytes, start, stride, width, height) {
      let first = 0, second = 0, third = 0, fourth = 0, found = 0;
      for (let rowIndex = 0; rowIndex < height; rowIndex++) for (let column = 0, at = start + rowIndex * stride; column < width; column++, at += 4) {
        const word = bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16 | bytes[at + 3] << 24;
        if (found > 0 && word === first || found > 1 && word === second || found > 2 && word === third || found > 3 && word === fourth) continue;
        if (found === 4) return false;
        if (found === 0) first = word; else if (found === 1) second = word; else if (found === 2) third = word; else fourth = word;
        found++;
      }
      return true;
    }
    // sparse-rgb-v2, one opaque pixel: the keyed channel, or the next one whose value pair is neither 0 nor 127, takes the bit as its lowest bit.
    function parityPixel(bytes, at, channel, bit) {
      for (let step = 0; step < 3; step++, channel = channel === 2 ? 0 : channel + 1) {
        const level = bytes[at + channel], pair = level >> 1;
        if (pair === 0 || pair === 127) continue;
        bytes[at + channel] = (level & 254) | bit; return;
      }
    }
    // Projects `height` rows of `width` RGBA pixels in place; row r starts at start + r * stride and is framebuffer row y + r of a
    // cw x ch framebuffer, i.e. canvas line ch - 1 - (y + r). The last sparse cell is reused for the next row.
    function projectRows(bytes, start, stride, x, y, width, height, cw, ch) {
      const total = cw * ch, lanes = total <= 65536, dense = total <= 262144;
      let run = 8, span = 0, range = 0, cell = -1, from = 0, channel = 0, up = 0;
      if (parity && dense && x === 0 && y === 0 && width === cw && height === ch && flatRows(bytes, start, stride, width, height)) return;
      if (!dense) { run = (((total / 100) | 0) / 1024) | 0; run = run < 1 ? 1 : run > 8 ? 8 : run; } else if (!lanes) run = 16;
      span = dense ? run : run * 100; range = span - run + 1;
      for (let rowIndex = 0; rowIndex < height; rowIndex++) {
        const offset = start + rowIndex * stride, line = ch - 1 - (y + rowIndex);
        if (!sparse) {
          for (let column = 0, at = offset; column < width; column++, at += 4) {
            if (bytes[at + 3] !== 255) continue;
            sip(key[0], key[1], key[2], key[3], null, 16, 0x53564e43, x + column, line, bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16 | 0x01000000, hash);
            for (let channel = 0; channel < 3; channel++) { const level = bytes[at + channel]; bytes[at + channel] = level === 0 ? 1 : level === 255 ? 254 : hash[0] >>> channel & 1 ? level + 1 : level - 1; }
          }
          continue;
        }
        const first = line * cw + x, last = first + width - 1;
        for (let current = (first / span) | 0, end = (last / span) | 0; current <= end; current++) {
          if (current !== cell) { cell = current; sip(key[0], key[1], key[2], key[3], null, 16, 0x31525053, cw, ch, cell, hash); from = cell * span + hash[0] % range; channel = (hash[1] & 0xffff) % 3; up = hash[1] >>> 16 & 1; }
          for (let index = from > first ? from : first, to = from + run - 1 < last ? from + run - 1 : last; index <= to; index++) {
            const at = offset + (index - first) * 4; if (bytes[at + 3] !== 255) continue;
            if (lanes) { const lane = index - from, byte = (lane < 4 ? hash[0] >>> (lane << 3) : hash[1] >>> ((lane - 4) << 3)) & 255; channel = (byte & 127) % 3; up = byte >>> 7; }
            if (parity) { parityPixel(bytes, at, channel, up); continue; }
            const level = bytes[at + channel]; bytes[at + channel] = level === 0 ? 1 : level === 255 ? 254 : up ? level + 1 : level - 1;
          }
        }
      }
    }
    for (let kind = 0; kind < names.length; kind++) {
      const target = prototype(names[kind]), found = field(target, 'readPixels');
      if (!found || contains(patched, found.target)) continue;
      const parameter = field(target, 'getParameter'), lost = field(target, 'isContextLost');
      const widthField = field(target, 'drawingBufferWidth'), heightField = field(target, 'drawingBufferHeight');
      const original = own(found.descriptor, 'value'), getParameter = parameter && own(parameter.descriptor, 'value');
      const isLost = lost && own(lost.descriptor, 'value'), getWidth = widthField && own(widthField.descriptor, 'get'), getHeight = heightField && own(heightField.descriptor, 'get');
      const canvasGet = accessor(target, 'canvas');
      if (!found.descriptor.configurable || typeof original !== 'function') { miss(); continue; }
      const readonlyAvailable = typeof getParameter === 'function' && typeof isLost === 'function' && typeof getWidth === 'function' && typeof getHeight === 'function';
      push(patched, found.target);
      const webgl2 = kind === 1;
      function parameterValue(receiver, name) { return I.apply(getParameter, receiver, [name]); }
      function integerState(number) { return typeof number === 'number' && I.finite(number) && number >= 0 && I.floor(number) === number; }
      const selectedReadPixels = { selectedReadPixels() {
        'use strict';
        if (state.stopped) return I.apply(original, this, arguments);
        if (!readonlyAvailable || !ready) reject();
        // Native brand checks happen through captured read-only accessors, not
        // through page properties or a trial read into the caller's buffer.
        if (I.apply(isLost, this, []) !== false) reject();
        const framebufferWidth = I.apply(getWidth, this, []), framebufferHeight = I.apply(getHeight, this, []);
        if (arguments.length < 7 || !integerState(framebufferWidth) || !integerState(framebufferHeight)) reject();
        const positions = [0, 1, 2, 3, 4, 5, 7];
        for (let index = 0; index < positions.length; index++) {
          const argument = arguments[positions[index]], type = typeof argument;
          if (type === 'object' && argument !== null || type === 'function' || type === 'bigint' || type === 'symbol') reject();
        }
        const x = I.number(arguments[0]) | 0, y = I.number(arguments[1]) | 0;
        const width = I.number(arguments[2]) | 0, height = I.number(arguments[3]) | 0;
        if (x < 0 || y < 0 || width < 0 || height < 0 || x + width > framebufferWidth || y + height > framebufferHeight || (I.number(arguments[4]) >>> 0) !== 6408 || (I.number(arguments[5]) >>> 0) !== 5121) reject();
        const destination = arguments[6], destinationOffset = arguments.length > 7 ? I.number(arguments[7]) >>> 0 : 0;
        let length, buffer, tag;
        try { length = I.apply(I.typedLength, destination, []); buffer = I.apply(I.typedBuffer, destination, []); tag = I.apply(I.typedTag, destination, []); } catch { reject(); }
        if (tag !== 'Uint8Array' || !integerState(length)) reject();
        if (I.sharedLength) {
          let shared = false; try { I.apply(I.sharedLength, buffer, []); shared = true; } catch { /* ordinary ArrayBuffer */ }
          if (shared) reject();
        }
        // Only a default RGBA8-like readable buffer is supported. These queries
        // do not clear GL errors or touch framebuffer/PACK state.
        if (parameterValue(this, webgl2 ? 36010 : 36006) !== null || parameterValue(this, 35739) !== 6408 || parameterValue(this, 35738) !== 5121) reject();
        let rowLength = 0, skipRows = 0, skipPixels = 0;
        const alignment = parameterValue(this, 3333);
        if (alignment !== 1 && alignment !== 2 && alignment !== 4 && alignment !== 8) reject();
        if (webgl2) {
          if (parameterValue(this, 35053) !== null || parameterValue(this, 3074) !== 1029) reject();
          rowLength = parameterValue(this, 3330); skipRows = parameterValue(this, 3331); skipPixels = parameterValue(this, 3332);
          if (!integerState(rowLength) || !integerState(skipRows) || !integerState(skipPixels)) reject();
        } else if (arguments.length > 7) reject();
        const rowPixels = rowLength || width;
        if (rowPixels < skipPixels + width) reject();
        const stride = I.floor((rowPixels * 4 + alignment - 1) / alignment) * alignment;
        const start = destinationOffset + skipRows * stride + skipPixels * 4;
        const span = width === 0 || height === 0 ? destinationOffset : start + (height - 1) * stride + width * 4;
        if (!integerState(start) || !integerState(span) || span > length || span > spanLimit) reject();
        // The Canvas runtime keys a canvas by its own width and height; a drawing buffer of another size (clamped by the GPU) could
        // not agree with its exports. sparse-rgb-v1 cell arithmetic stays in int32 up to 2^30 pixels, as for getImageData.
        if (canvasShared) { const size = canvasGet ? canvasSize(this, canvasGet) : null; if (size === null || size[0] !== framebufferWidth || size[1] !== framebufferHeight) reject(); }
        if (sparse && framebufferWidth * framebufferHeight > canvasLimit) reject();
        const privateBytes = new I.Uint8Array(span);
        for (let index = 0; index < span; index++) privateBytes[index] = mix(sentinel, 1, index) & 255;
        const args = []; for (let index = 0; index < arguments.length; index++) push(args, index === 6 ? privateBytes : arguments[index]);
        const native = I.apply(original, this, args);
        if (I.apply(isLost, this, []) !== false) { miss(); return native; }
        let wrote = false;
        for (let rowIndex = 0; rowIndex < height && !wrote; rowIndex++) for (let column = 0; column < width * 4; column++) {
          const offset = start + rowIndex * stride + column;
          if (privateBytes[offset] !== (mix(sentinel, 1, offset) & 255)) { wrote = true; break; }
        }
        // GL errors normally return undefined without writing. No getError is
        // consumed. A legitimate complete sentinel match is conservatively unknown.
        if (!wrote) { miss(); return native; }
        // One framebuffer pixel has the same projection for every rectangle/PACK layout, equal to its Canvas projection.
        projectRows(privateBytes, start, stride, x, y, width, height, framebufferWidth, framebufferHeight);
        for (let rowIndex = 0; rowIndex < height; rowIndex++) {
          const rowStart = start + rowIndex * stride;
          for (let column = 0; column < width * 4; column++) destination[rowStart + column] = privateBytes[rowStart + column];
        }
        changed(); return native;
      } }.selectedReadPixels;
      matchMeta(selectedReadPixels, original);
      save(found.target, 'readPixels', found.descriptor, { __proto__: null, ...found.descriptor, value: selectedReadPixels });
    }
    if (!patched.length) miss();
  }
  for (let index = 0; index < entries.length && index < 1024; index++) {
    const entry = own(entries, index), id = own(entry, 'id'), value = own(entry, 'value');
    if (own(entry, 'mode') !== 'custom') continue;
    const handler = id === 'webgl-capabilities' ? glCapabilities : id === 'webgpu-capabilities' ? gpuCapabilities : id === 'canvas-text-metrics' ? textMetrics : id === 'audio-fingerprint' ? audioFingerprint : id === 'audio-metadata' ? audioMetadata : id === 'clock-precision' ? clocks : id === 'canvas-font-policy' ? fontPolicy : id === 'browser-surface' ? browserSurface : id === 'webgl-readback' ? glReadback : null;
    if (!handler) continue; row = { id, installed: 0, unavailable: 0 }; push(rows, row);
    try { handler(value, entry); } catch { unavailable(); }
  }
  return { snapshot() { const values = []; for (let index = 0; index < rows.length; index++) push(values, { ...rows[index] }); return { ...state, entries: values }; }, stop() {
    if (state.stopped) return; state.stopped = true;
    for (let index = handles.length - 1; index >= 0; index--) { const handle = handles[index]; try { const current = I.own(handle.target, handle.key), saved = handle.descriptor;
      const owned = saved === undefined ? current === undefined : current && (saved.get || saved.set ? current.get === saved.get && current.set === saved.set : current.value === saved.value);
      if (owned) { if (handle.original) I.define(handle.target, handle.key, handle.original); else I.remove(handle.target, handle.key); }
    } catch { /* later page ownership */ } }
  } };
}
