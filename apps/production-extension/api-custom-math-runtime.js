// E22-18: explicit deterministic Math test profile. This installer stays private
// inside the immutable document-start bootstrap and is serialized with toString.
export function installMathCustom(realm, entries) {
  'use strict';
  const cached = installMathCustom.__detectExpertMathIntrinsicsV1;
  const I = cached || {
    apply: Reflect.apply, own: Object.getOwnPropertyDescriptor,
    define: Object.defineProperty, prototype: Object.getPrototypeOf,
    freeze: Object.freeze, isArray: Array.isArray,
    Proxy, setProto: Object.setPrototypeOf, reflectSetProto: Reflect.setPrototypeOf, ArrayBuffer, Float64Array, Uint32Array, Uint8Array, WeakSet,
    BigInt: typeof BigInt === 'function' ? BigInt : null,
    typedLength: Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'length').get,
    setHas: WeakSet.prototype.has, setAdd: WeakSet.prototype.add,
    charCode: String.prototype.charCodeAt, exec: RegExp.prototype.exec,
    toPrecision: Number.prototype.toPrecision, toNumber: Number,
    installed: new WeakSet(), origin: null,
  };
  function own(target, key) {
    if (target === null || typeof target !== 'object' && typeof target !== 'function') return;
    const field = I.own(target, key);
    return field && I.own(field, 'value') ? field.value : undefined;
  }
  // SipHash-2-4, represented as low/high uint32 pairs. No BigInt, floating-point
  // multiplication, external state, or page callbacks enter the hash rounds.
  function sipHash24(bytes, k0l, k0h, k1l, k1h, output) {
    let a = (k0l ^ 0x70736575) >>> 0, A = (k0h ^ 0x736f6d65) >>> 0;
    let b = (k1l ^ 0x6e646f6d) >>> 0, B = (k1h ^ 0x646f7261) >>> 0;
    let c = (k0l ^ 0x6e657261) >>> 0, C = (k0h ^ 0x6c796765) >>> 0;
    let d = (k1l ^ 0x79746573) >>> 0, D = (k1h ^ 0x74656462) >>> 0;
    const length = I.apply(I.typedLength, bytes, []), blocks = length >>> 3;
    for (let block = 0; block <= blocks + 1; block++) {
      let low = 0, high = 0;
      if (block === blocks + 1) c = (c ^ 255) >>> 0;
      else {
        const index = block * 8;
        if (block < blocks) {
          low = (bytes[index] | bytes[index + 1] << 8 | bytes[index + 2] << 16 | bytes[index + 3] << 24) >>> 0;
          high = (bytes[index + 4] | bytes[index + 5] << 8 | bytes[index + 6] << 16 | bytes[index + 7] << 24) >>> 0;
        } else {
          high = (length & 255) << 24;
          for (let offset = 0; index + offset < length; offset++) {
            if (offset < 4) low |= bytes[index + offset] << (offset * 8);
            else high |= bytes[index + offset] << ((offset - 4) * 8);
          }
        }
        d = (d ^ low) >>> 0; D = (D ^ high) >>> 0;
      }
      // Keep the eight state words local. A closure per round forces boxed
      // context loads/stores in hot loops on both supported JS engines.
      const rounds = block === blocks + 1 ? 4 : 2;
      for (let iteration = 0; iteration < rounds; iteration++) {
        let sum = a + b; a = sum >>> 0; A = (A + B + (sum > 0xffffffff ? 1 : 0)) >>> 0;
        let previousLow = b; b = ((b << 13) | (B >>> 19)) >>> 0; B = ((B << 13) | (previousLow >>> 19)) >>> 0;
        b = (b ^ a) >>> 0; B = (B ^ A) >>> 0; previousLow = a; a = A; A = previousLow;
        sum = c + d; c = sum >>> 0; C = (C + D + (sum > 0xffffffff ? 1 : 0)) >>> 0;
        previousLow = d; d = ((d << 16) | (D >>> 16)) >>> 0; D = ((D << 16) | (previousLow >>> 16)) >>> 0;
        d = (d ^ c) >>> 0; D = (D ^ C) >>> 0;
        sum = a + d; a = sum >>> 0; A = (A + D + (sum > 0xffffffff ? 1 : 0)) >>> 0;
        previousLow = d; d = ((d << 21) | (D >>> 11)) >>> 0; D = ((D << 21) | (previousLow >>> 11)) >>> 0;
        d = (d ^ a) >>> 0; D = (D ^ A) >>> 0;
        sum = c + b; c = sum >>> 0; C = (C + B + (sum > 0xffffffff ? 1 : 0)) >>> 0;
        previousLow = b; b = ((b << 17) | (B >>> 15)) >>> 0; B = ((B << 17) | (previousLow >>> 15)) >>> 0;
        b = (b ^ c) >>> 0; B = (B ^ C) >>> 0; previousLow = c; c = C; C = previousLow;
      }
      if (block <= blocks) { a = (a ^ low) >>> 0; A = (A ^ high) >>> 0; }
    }
    output[0] = (a ^ b ^ c ^ d) >>> 0; output[1] = (A ^ B ^ C ^ D) >>> 0;
    return output;
  }
  if (!cached) {
    // Window.origin is a native getter in browser realms. A later child uses
    // this captured getter, never a page-replaced accessor or location method.
    try {
      let target = realm;
      for (let depth = 0; target && depth < 16; depth++, target = I.prototype(target)) {
        const field = I.own(target, 'origin');
        if (field) { if (typeof field.get === 'function') I.origin = field.get; break; }
      }
    } catch { /* An inaccessible realm cannot establish an origin key. */ }
    I.sipHash24 = sipHash24;
    I.define(installMathCustom, '__detectExpertMathIntrinsicsV1', { __proto__: null, value: I.freeze(I) });
  }
  const state = { installed: 0, unavailable: 0, changed: 0 }, rows = [];
  // ADR-087: append only; IDs1..20 retain their existing hash domains.
  const names = ['acos', 'acosh', 'asin', 'asinh', 'atan', 'atanh', 'atan2', 'cos', 'cosh', 'exp', 'expm1', 'log', 'log1p', 'log2', 'log10', 'sin', 'sinh', 'tan', 'tanh', 'pow', 'sqrt', 'cbrt', 'hypot'];
  const PI = 3.141592653589793, HALF_PI = 1.5707963267948966;
  const NORMAL_MIN = 2.2250738585072014e-308;
  function push(array, item) { I.define(array, array.length, { __proto__: null, value: item, enumerable: true, configurable: true, writable: true }); }
  function count(row, key) { if (state[key] < 65535) state[key]++; if (row && row[key] < 65535) row[key]++; }
  function constant(value) {
    const absolute = value < 0 ? -value : value;
    return absolute === PI || absolute === HALF_PI || absolute === 0.7853981633974483 || absolute === 2.356194490192345 ||
      absolute === 2.718281828459045 || absolute === 0.6931471805599453 || absolute === 2.302585092994046 ||
      absolute === 1.4426950408889634 || absolute === 0.4342944819032518 ||
      absolute === 1.4142135623730951 || absolute === 0.7071067811865476;
  }
  function snapshot() {
    const functions = [];
    for (let index = 0; index < rows.length; index++) push(functions, { ...rows[index] });
    return { ...state, functions };
  }
  let selected;
  if (I.isArray(entries)) for (let index = 0; index < entries.length && index < 1024; index++) {
    const entry = own(entries, index);
    if (own(entry, 'id') === 'math-transcendentals') {
      if (selected) { count(null, 'unavailable'); return { snapshot }; }
      selected = entry;
    }
  }
  if (!selected) return { snapshot };
  if (own(selected, 'mode') !== 'custom') {
    if (own(selected, 'mode') === 'on') count(null, 'unavailable');
    return { snapshot };
  }
  const profile = own(selected, 'value'), functions = own(profile, 'functions'), seed = own(selected, 'mathSeed');
  const math = own(realm, 'Math');
  if (own(selected, 'mode') !== 'custom' || own(profile, 'algorithm') !== 'deterministic-ulp-v1' ||
      !I.isArray(functions) || functions.length > names.length || typeof seed !== 'string' ||
      I.apply(I.exec, /^[a-f0-9]{64}$/, [seed]) === null || !math || typeof math !== 'object') {
    count(null, 'unavailable'); return { snapshot };
  }
  const selectedIds = [];
  for (let index = 0; index < functions.length; index++) {
    const name = own(functions, index); let id = -1;
    for (let item = 0; item < names.length; item++) if (names[item] === name) id = item;
    if (id < 0 || own(selectedIds, id) === true) { count(null, 'unavailable'); return { snapshot }; }
    I.define(selectedIds, id, { __proto__: null, value: true, configurable: true });
  }
  if (functions.length === 0 || I.apply(I.setHas, I.installed, [math])) return { snapshot };
  let origin;
  try { origin = I.origin ? I.apply(I.origin, realm, []) : own(realm, 'origin'); } catch { /* No shared unscoped seed fallback. */ }
  if (typeof origin !== 'string' || origin.length === 0 || origin.length > 2048) { count(null, 'unavailable'); return { snapshot }; }
  const seedWords = new I.Uint32Array(8);
  for (let index = 0; index < 64; index++) {
    const code = I.apply(I.charCode, seed, [index]);
    seedWords[index >>> 3] = (seedWords[index >>> 3] << 4) | (code <= 57 ? code - 48 : code - 87);
  }
  // Two domain-separated SipHash outputs use both independent halves of the
  // 256-bit browser-session seed. Origin is encoded as bounded UTF-16LE.
  const originBytes = new I.Uint8Array(12 + origin.length * 2);
  const domain = [77, 97, 116, 104, 47, 118, 49, 47, 111, 114, 103, 0];
  for (let index = 0; index < domain.length; index++) originBytes[index] = domain[index];
  for (let index = 0; index < origin.length; index++) {
    const code = I.apply(I.charCode, origin, [index]); originBytes[12 + 2 * index] = code & 255; originBytes[13 + 2 * index] = code >>> 8;
  }
  const key = new I.Uint32Array(4), hash = new I.Uint32Array(2);
  I.sipHash24(originBytes, seedWords[0], seedWords[1], seedWords[2], seedWords[3], hash); key[0] = hash[0]; key[1] = hash[1];
  originBytes[11] = 1;
  I.sipHash24(originBytes, seedWords[4], seedWords[5], seedWords[6], seedWords[7], hash); key[2] = hash[0]; key[3] = hash[1];
  const storage = new I.ArrayBuffer(8), floats = new I.Float64Array(storage), words = new I.Uint32Array(storage);
  floats[0] = 1; const highIndex = words[0] === 0 ? 1 : 0, lowIndex = 1 - highIndex;
  const message = new I.Uint8Array(16);
  message[0] = 77; message[1] = 65; message[2] = 84; message[3] = 72; message[5] = 1;
  function powerOfTwo(value) {
    if (!(value > 0)) return false;
    floats[0] = value;
    const high = words[highIndex] & 0x7fffffff, low = words[lowIndex], exponent = high >>> 20;
    if (exponent !== 0) return exponent !== 2047 && (high & 0xfffff) === 0 && low === 0;
    return high === 0 ? low !== 0 && (low & (low - 1)) === 0 : low === 0 && (high & (high - 1)) === 0;
  }
  function exactHypot(value, args) {
    // The ordinary squared-sum guard can round differently even for an exact
    // Pythagorean result. Compare exact binary integers, bounded to32 inputs.
    // No native Math call, page coercion, seed, sample or result escapes here.
    if (!I.BigInt) return true;
    function binary(number) {
      floats[0] = number;
      const high = words[highIndex] & 0x7fffffff, exponent = high >>> 20;
      let mantissa = I.BigInt(high & 0xfffff) << 32n | I.BigInt(words[lowIndex]);
      if (exponent !== 0) mantissa |= 1n << 52n;
      return { mantissa, exponent: exponent === 0 ? -1074 : exponent - 1075 };
    }
    const result = binary(value), terms = [];
    let minimum = result.exponent;
    for (let index = 0; index < args.length; index++) if (args[index] !== 0) {
      const term = binary(args[index]); push(terms, term);
      if (term.exponent < minimum) minimum = term.exponent;
    }
    let sum = 0n;
    for (let index = 0; index < terms.length; index++) {
      const term = terms[index];
      sum += term.mantissa * term.mantissa << I.BigInt((term.exponent - minimum) * 2);
    }
    return sum === (result.mantissa * result.mantissa << I.BigInt((result.exponent - minimum) * 2));
  }
  function eligible(name, result, args) {
    const arity = name === 'hypot' ? args.length : name === 'atan2' || name === 'pow' ? 2 : 1;
    // Preserve unary/zero hypot and bound inspection of its variadic arguments.
    if (name === 'hypot' && (arity < 2 || arity > 32)) return false;
    if (args.length < arity || typeof result !== 'number' || result !== result || result === 0 || result === Infinity || result === -Infinity ||
        result % 1 === 0 || constant(result) || result > -NORMAL_MIN && result < NORMAL_MIN) return false;
    // A result that is the double nearest a decimal of at most 10 significant digits is an everyday value (0.1, 0.7, 0.01): keep it,
    // or pages print 0.09999999999999999 for Math.pow(10, -1). Genuine transcendental results never have such a short form by chance.
    if (I.toNumber(I.apply(I.toPrecision, result, [10])) === result) return false;
    for (let index = 0; index < arity; index++) {
      const value = args[index];
      if (typeof value !== 'number' || value !== value || value === Infinity || value === -Infinity || value === result) return false;
      if (name === 'hypot' && -value === result) return false;
    }
    if (name === 'atan2' && (args[0] === 0 || args[1] === 0 || args[0] === args[1] || args[0] === -args[1])) return false;
    // Conservative exact-result guards. Rounded reconstructions may preserve
    // additional native results; they never promise every finite value changes.
    if (name === 'sqrt' && result * result === args[0]) return false;
    if (name === 'cbrt' && result * result * result === args[0]) return false;
    if (name === 'hypot') {
      let nonzero = 0, squares = 0;
      for (let index = 0; index < arity; index++) {
        const value = args[index]; if (value !== 0) nonzero++;
        squares += value * value;
      }
      if (nonzero < 2 || result * result === squares || exactHypot(result, args)) return false;
    }
    if (name === 'pow') {
      const base = args[0], exponent = args[1];
      if (powerOfTwo(base < 0 ? -base : base)) return false;
      if (exponent % 1 === 0) { if (exponent >= 0) return false; }
      else if (exponent * 1024 % 1 === 0) return false;
    }
    return true;
  }
  function allowed(name, result, native) {
    if (result !== result || result === Infinity || result === -Infinity || result === 0 ||
        result > -NORMAL_MIN && result < NORMAL_MIN || native > 0 && result < 0 || native < 0 && result > 0) return false;
    if (name === 'acos') return result > 0 && result <= PI;
    if (name === 'asin' || name === 'atan') return result >= -HALF_PI && result <= HALF_PI;
    if (name === 'atan2') return result >= -PI && result <= PI;
    if (name === 'sin' || name === 'cos' || name === 'tanh') return result >= -1 && result <= 1;
    if (name === 'cosh') return result >= 1;
    if (name === 'acosh' || name === 'exp') return result > 0;
    if (name === 'expm1') return result >= -1;
    if (name === 'sqrt' || name === 'hypot') return result > 0;
    return true;
  }
  function nudge(id, name, value) {
    floats[0] = value;
    let high = words[highIndex], low = words[lowIndex];
    message[4] = id + 1;
    // Hash the magnitude: an odd native function keeps f(-x) === -f(x).
    const magnitudeHigh = high & 0x7fffffff;
    for (let index = 0; index < 4; index++) { message[8 + index] = low >>> (index * 8); message[12 + index] = magnitudeHigh >>> (index * 8); }
    I.sipHash24(message, key[0], key[1], key[2], key[3], hash);
    // Adjacent positive bit patterns are increasing; negative ones decreasing.
    const increment = (hash[0] & 1) === 1;
    if (increment) { if (low === 0xffffffff) { low = 0; high = (high + 1) >>> 0; } else low = (low + 1) >>> 0; }
    else if (low === 0) { low = 0xffffffff; high = (high - 1) >>> 0; } else low = (low - 1) >>> 0;
    words[highIndex] = high; words[lowIndex] = low;
    const result = floats[0]; return allowed(name, result, value) ? result : value;
  }
  I.apply(I.setAdd, I.installed, [math]);
  for (let id = 0; id < names.length; id++) {
    if (own(selectedIds, id) !== true) continue;
    const name = names[id], row = { name, installed: 0, unavailable: 0, changed: 0 }; push(rows, row);
    try {
      const field = I.own(math, name), original = own(field, 'value');
      if (typeof original !== 'function' || !field.configurable && !field.writable) { count(row, 'unavailable'); continue; }
      // ADR-112: closing a prototype cycle through the wrapper (Object.setPrototypeOf(fn, fn)) is refused with the engine's own TypeError, as for the
      // native function; accepted, it would make every later property read of the function overflow the stack. Everything else is forwarded.
      let self;
      const wrapper = self = new I.Proxy(original, { __proto__: null, apply(target, receiver, args) {
        // Exactly one native call drives conversion, this, and thrown identity.
        const native = I.apply(target, receiver, args);
        if (!eligible(name, native, args)) return native;
        const result = nudge(id, name, native); if (result !== native) count(row, 'changed'); return result;
      }, setPrototypeOf(target, value) {
        if (value === self) { I.setProto(target, target); return false; }
        return I.reflectSetProto(target, value);
      } });
      I.define(math, name, { __proto__: null, ...field, value: wrapper }); count(row, 'installed');
    } catch { count(row, 'unavailable'); }
  }
  // No stop/restore handle, seed, input, result, or native reference is exposed.
  return { snapshot };
}
