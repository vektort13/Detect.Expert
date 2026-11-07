// ADR-066: opt-in derived canvas readback projection; no independent drawing,
// pixel export, page command channel, native restore handle, or source mutation.
// Serialized into the private document-start bootstrap. Keep self-contained.
//
// Three algorithms share one session key (private profile seed x top-level site) and one set of covered readbacks
// (getImageData, toDataURL, toBlob, convertToBlob; a WebGL canvas takes the same export rule as a 2D canvas). Fully opaque pixels
// (alpha 255) move by one level (sparse-rgb-v2: one channel takes a keyed lowest bit, see below), reflected at 0 and 255 in the two older
// algorithms; alpha is never touched and fully transparent pixels (alpha 0) are never touched. Translucent pixels (0 < alpha < 255) move
// one stored state (see 'Translucent pixels' below) in the engines where that was measured, and are left native everywhere else.
//
// stable-rgb-v1 (older saved values, kept byte for byte): every opaque pixel moves, all three channels; SipHash-2-4 over
//   'CNVS' | column | line | r g b 1 picks the sign of each channel. A flat canvas becomes incompressible noise
//   (Chromium 153, flat 2560x1440 PNG: 76,122 B -> 4,658,145 B = 61x).
//
// sparse-rgb-v1 (default). Which pixels move, which channel and which direction depend on nothing but (session key, canvas width,
//   canvas height, x, y) - not on the rectangle that is read, the export method or the pixel colour. N = width * height of the canvas
//   bitmap at read time (exports <= 16 Mi, a small getImageData up to 2^30); pixels are indexed in row-major order, i = y * width + x.
//   draw(k) = SipHash-2-4 under the session key of the 16 bytes 'SPR1' | width | height | k (u32, little endian); lo / hi are its low
//   and high 32 bits. A candidate pixel moves only if its alpha is 255: one channel by one level, reflected (0 -> 1, 255 -> 254).
//   Small, N <= 65,536 (256x256): every pixel is a candidate. Cell k = pixels [8k, 8k + 8); pixel 8k + j uses byte j of the draw
//     (bytes 0-3 = lo, 4-7 = hi, little endian): channel = (byte & 127) mod 3 (R, G, B), direction = byte >>> 7 (1 = +1, 0 = -1).
//   Medium, 65,536 < N <= 262,144 (512x512): every pixel is a candidate. Cell k = pixels [16k, 16k + 16) moves as one run:
//     channel = (hi & 0xffff) mod 3, direction = (hi >>> 16) & 1.
//   Large, N > 262,144: a keyed 1% moves, in runs: run = clamp(floor(floor(N / 100) / 1024), 1, 8) (at least 1024 runs remain),
//     span = 100 * run, cell k = pixels [k * span, (k + 1) * span) holds one run [start, start + run) with
//     start = k * span + lo mod (span - run + 1); channel and direction as for medium canvases.
// Why: up to 512x512 every opaque pixel moves, so any such canvas with one opaque pixel is marked (the 1% rule left 'Hello, world!' 16px
// on a transparent 220x30 canvas - 38 opaque pixels - native for 66% of keys), with an independent draw per pixel where fingerprinting
// canvases live. Runs keep PNG small where every pixel would otherwise differ: PNG filters turn a flat canvas into zeros, an isolated
// changed pixel costs about 7 bytes of deflate output and a run of 8 about 15. A read costs one hash per cell it touches (no per-pixel
// hashing) and any rectangle, tile or export agrees with a read of the whole canvas, because every cell is drawn from (key, width,
// height, k) alone.
//
// sparse-rgb-v2 (ADR-112, default for new profiles). The same cells, draws, channels, zones and independence from the rectangle as
//   sparse-rgb-v1, with three differences that remove what exact-value and round-trip probes of anti-spoof pages see:
//   1. Parity, not direction. The keyed bit (`up` above) is the TARGET PARITY of the keyed channel: its lowest bit is forced to that bit,
//      v' = (v & 254) | bit; a translucent pixel takes the lowest bit of its stored state (nearbyParity below). A channel moves by at
//      most one level and the projection is IDEMPOTENT: pixels that were already projected - a page decoding our PNG into a fresh canvas
//      of the same size, an ImageBitmap copy, a second read - read back unchanged, so getImageData, toDataURL and toBlob agree after a
//      decode round trip. Version 1 moves the same channel the same way again on every pass.
//   2. Saturated channels stay. A channel whose value pair (v >> 1) is 0 or 127, i.e. v is 0, 1, 254 or 255 (flipping the lowest bit keeps the
//      pair, so the candidate set is stable), never moves; the next channel in the order R, G, B, R takes the keyed bit instead, and an
//      opaque pixel whose three channels are saturated stays as drawn. Pure colours (a red triangle on white) therefore keep their exact
//      0 / 255 values, and the projection is still idempotent. Translucent pixels have no such exception (their marking is the only
//      mark a transparent canvas can carry).
//   3. Flat canvases stay as rendered. A canvas of at most 262,144 pixels with at most FLAT_COLOURS (4) distinct RGBA values (a flat
//      fill, a two-colour pattern, a double-alpha probe) carries no rendering-dependent entropy - anti-aliased text, gradients and shapes
//      always produce more - and is returned unchanged by getImageData and by every export. The decision depends on the whole canvas
//      only, never on the rectangle: a read whose own rectangle holds more than 4 values needs nothing more, and a flat-looking rectangle
//      of a larger canvas is checked through a private copy of the whole canvas (a scratch canvas; the copies of one realm may cover
//      2^26 pixels in all, then the rectangle is projected). Residual: a canvas that really is two-coloured with AA off (hard-edged
//      glyphs) is returned as drawn too.
// sparse-rgb-v1 and stable-rgb-v1 are byte for byte what they were.
//
// Translucent pixels (0 < alpha < 255). A canvas stores a colour channel premultiplied, as a byte q <= alpha, and the engine hands it back
// as the straight byte v = U(q, alpha). U differs between engines and between Firefox releases, so v +- 1 is usually a value no engine can
// return, and a drawing copied with globalAlpha < 1 would read back natively if translucent pixels were skipped. A selected translucent
// pixel (same selection, channel and direction as an opaque one; stable-rgb-v1 hashes the three states and alpha ^ 254 where an opaque pixel
// hashes its bytes and 1, and moves all three channels) therefore moves one STORED STATE and takes a value the engine itself returns, with
// x(q) = 255 q / alpha:
//   family 1, Skia (Chromium, Chrome, Edge): U = round(x), in the CPU path and in the GPU readback alike except where frac(x) = 1/2
//     exactly. A value is usable when no state sits exactly half a level from it.
//   family 2, Moz2D (Firefox): U = floor(x) in 138.0.4 and 153.0 (measured; the premultiply there is ceil) and round(x) in the current
//     upstream source (read, not run); the PNG encoder rounds. A value is usable when it is the floor of a state at least 0.03 above that
//     integer (a state just above an integer reads one less; or 0, or exact because alpha divides 255) AND the rounding of a state at least
//     0.01 from half a level.
//   family 0, anything else: translucent pixels stay native.
// The state of an observed v is q = round(v alpha / 255). A v is no readback of this arithmetic, and stays, when it is more than half a level
// from x(q) (Skia), or more than half a level above or more than 1.02 levels below x(q) (Moz2D). Targets in order: q + s, q - s, q + 2s, q - 2s (Moz2D: also +-3s), s = +1
// when the selection says up, else -1; a target gives its rounded value (Moz2D: then its floored value); the first usable value other than
// v wins, none means the pixel stays native. Exports write the whole tile back with putImageData where translucent pixels are marked:
// getImageData then putImageData stores the same bytes (measured for every state), and a marked value stores the state it names.
// A WebGL canvas export takes the same rule (ADR-112): its pixels are copied into a 2D canvas first, so the export agrees with the export of
// the drawImage mirror a page makes of it (a 2D canvas holding the same stored states). readPixels (surfaces runtime) returns premultiplied
// bytes and still moves opaque pixels only. sparse-rgb-v2 moves the stored state to the keyed parity instead of a keyed direction
// (nearbyParity: the neighbouring state q +- 1, Moz2D also q +- 3, whose straight byte this engine itself returns). Measured and checked by
// scripts/test/canvas-translucent-native.mjs.
export function installCanvasCustom(realm, entries) {
  'use strict';
  const cached = installCanvasCustom.__detectExpertCanvasIntrinsicsV1;
  const I = cached || {
    apply: Reflect.apply, get: Reflect.get, descriptor: Object.getOwnPropertyDescriptor,
    define: Object.defineProperty, prototype: Object.getPrototypeOf, freeze: Object.freeze,
    isArray: Array.isArray, create: Object.create, Proxy, setProto: Object.setPrototypeOf, reflectSetProto: Reflect.setPrototypeOf, Uint8Array, Uint32Array, Int32Array, WeakMap, WeakSet,
    weakGet: WeakMap.prototype.get, weakSet: WeakMap.prototype.set, has: WeakSet.prototype.has, add: WeakSet.prototype.add,
    then: Promise.prototype.then, NativePromise: Promise, speciesSymbol: Symbol.species, NativeTypeError: TypeError, charCode: String.prototype.charCodeAt,
    stringIndex: String.prototype.indexOf, stringSlice: String.prototype.slice, exec: RegExp.prototype.exec,
    typedLength: Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'length').get,
    typedTag: Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), Symbol.toStringTag).get,
    number: Number, trunc: Math.trunc, installed: new WeakSet(),
    symbolFor: Symbol.for, visualDeny: null,
    pending: { count: 0, pixels: 0 },
    byCanvas: new WeakMap(), byContext: new WeakMap(), contextKinds: new WeakMap(),
  };
  function own(target, key) {
    if (target === null || typeof target !== 'object' && typeof target !== 'function') return;
    const field = I.descriptor(target, key); return field && I.descriptor(field, 'value') ? field.value : undefined;
  }
  function owner(target, key) {
    for (let depth = 0; target && depth < 16; depth++, target = I.prototype(target)) {
      const field = I.descriptor(target, key); if (field) return { target, field };
    }
    return null;
  }
  function proto(win, name) { return own(own(win, name), 'prototype'); }
  function capture(target, key, kind = 'value') { const found = owner(target, key); return found && typeof found.field[kind] === 'function' ? found.field[kind] : null; }
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
  // Pixel kernel. For every opaque pixel this is sipHash24 over the 16-byte message
  // 'CNVS' | column | line | r g b 1 (same key, same bits), written out for that one message shape: no
  // allocation, helper call or unpredictable branch per pixel (about 4.5x faster than one generic call
  // per pixel). SipHash blocks: 0 = 'CNVS' | column, 1 = line | r g b 1, 2 = length. The state after
  // block 0 depends on the column only; projectPixels caches it per chunk of up to 1024 columns and
  // projectRow runs the remaining 8 rounds for one row segment. 64-bit lanes are (lo, hi) int32 pairs and
  // carries are computed branch-free. Calling projectRow per row lets the engine tier it up by call
  // count, which is what makes small canvases fast on their first reads.
  // Opaque RGB moves by one level (reflected at 0 and 255); with `overlay` non-opaque pixels are zeroed. With `mode` (1 Skia, 2 Moz2D,
  // see the header) a translucent pixel is hashed as 'CNVS' | column | line | q r q g q b alpha ^ 254, with q = round(c alpha / 255) the stored
  // state of each channel (the CPU and GPU readbacks of one state differ by a level at an exact half, never in the state; the last byte is 1
  // for an opaque pixel, so opaque output is unchanged), and moves one stored state per channel; `overlay` is then not used.
  // Returns translucent << 11 | transparent (a row segment has at most 1024 pixels).
  function projectRow(data, start, columns, line, overlay, table, lut, mode) {
    let translucent = 0, transparent = 0, a = 0, A = 0, b = 0, B = 0, c = 0, C = 0, d = 0, D = 0, lo = 0, t = 0;
    for (let column = 0, index = start; column < columns; column++, index += 4) {
      const alpha = data[index + 3];
      if (alpha !== 255) {
        if (alpha === 0) transparent++; else translucent++;
        if (!mode || alpha === 0) {
          if (overlay) { data[index] = 0; data[index + 1] = 0; data[index + 2] = 0; data[index + 3] = 0; }
          continue;
        }
      }
      let word = data[index] | data[index + 1] << 8 | data[index + 2] << 16 | 0x01000000;
      if (alpha !== 255) word = ((data[index] * alpha * 2 + 255) / 510 | 0) | ((data[index + 1] * alpha * 2 + 255) / 510 | 0) << 8 | ((data[index + 2] * alpha * 2 + 255) / 510 | 0) << 16 | (alpha ^ 254) << 24;
      const base = column << 3;
      a = table[base]; A = table[base + 1]; b = table[base + 2]; B = table[base + 3];
      c = table[base + 4]; C = table[base + 5]; d = table[base + 6] ^ line; D = table[base + 7] ^ word;
      for (let step = 0; step < 4; step++) {
        if (step === 1) { a ^= line; A ^= word; D ^= 0x10000000; } else if (step === 2) { A ^= 0x10000000; c ^= 0xff; }
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
      const bits = a ^ b ^ c ^ d;
      if (alpha === 255) {
        data[index] = lut[data[index] | (bits & 1) << 8]; data[index + 1] = lut[data[index + 1] | (bits & 2) << 7]; data[index + 2] = lut[data[index + 2] | (bits & 4) << 6];
      } else {
        let moved = nearbyValue(data[index], alpha, bits & 1, mode); if (moved >= 0) data[index] = moved;
        moved = nearbyValue(data[index + 1], alpha, bits & 2, mode); if (moved >= 0) data[index + 1] = moved;
        moved = nearbyValue(data[index + 2], alpha, bits & 4, mode); if (moved >= 0) data[index + 2] = moved;
      }
    }
    return translucent << 11 | transparent;
  }
  // True when `value` is a straight byte that every known arithmetic of the family returns for some stored state at this alpha (see the
  // header): Skia (mode 1) rounds, and no state may sit exactly half a level away; Moz2D (mode 2) floors or rounds, so the value must be
  // the floor of a state at least 0.03 above that integer (a state just above an integer reads one less up to Firefox 153; or 0, or exact
  // because alpha divides 255) and the rounding of a state at least 0.01 away from half a level.
  function robustValue(value, alpha, mode) {
    const near = ((value * alpha * 2 + 255) / 510) | 0, gap = 255 * near - value * alpha, off = gap < 0 ? -gap : gap; // |x(near) - value| = off / alpha
    if (mode === 1) return 2 * off < alpha;
    if (100 * off > 49 * alpha) return false;
    const above = ((value * alpha + 254) / 255) | 0, excess = 255 * above - value * alpha, rest = (255 * above) % alpha; // x(above) - value = excess / alpha
    return above <= alpha && excess < alpha && (above === 0 || (rest === 0 ? 255 % alpha === 0 : rest * 100 >= 3 * alpha));
  }
  // One channel of a translucent pixel (0 < alpha < 255): the straight byte of a neighbouring stored state, or -1 when the pixel stays
  // native (see 'Translucent pixels' in the header). Integer arithmetic only. `up` is truthy for the direction of the selection.
  function nearbyValue(value, alpha, up, mode) {
    const state = ((value * alpha * 2 + 255) / 510) | 0, gap = 255 * state - value * alpha; // x(state) - value = gap / alpha
    if (mode === 1 ? 2 * (gap < 0 ? -gap : gap) > alpha : 2 * gap < -alpha || 100 * gap > 102 * alpha) return -1;
    const reach = mode === 1 ? 2 : 3;
    for (let step = 1; step <= reach; step++) for (let side = 0; side < 2; side++) {
      const target = (side === 0) === (up ? true : false) ? state + step : state - step;
      if (target < 0 || target > alpha) continue;
      const scaled = 255 * target, rounded = ((scaled * 2 + alpha) / (2 * alpha)) | 0, floored = (scaled / alpha) | 0;
      if (rounded !== value && robustValue(rounded, alpha, mode)) return rounded;
      if (mode === 2 && floored !== rounded && floored !== value && robustValue(floored, alpha, mode)) return floored;
    }
    return -1;
  }
  // sparse-rgb-v2, one channel of a translucent pixel: the stored state q = round(value alpha / 255) already carrying the keyed parity keeps the
  // pixel native (-1); otherwise the neighbouring state q + 1, q - 1 (Moz2D: also q +- 3, of the same parity) whose straight byte this engine
  // returns is taken, or -1 when there is none. Same arithmetic and the same readback test as nearbyValue.
  function nearbyParity(value, alpha, parity, mode) {
    const state = ((value * alpha * 2 + 255) / 510) | 0, gap = 255 * state - value * alpha;
    if (mode === 1 ? 2 * (gap < 0 ? -gap : gap) > alpha : 2 * gap < -alpha || 100 * gap > 102 * alpha) return -1;
    if ((state & 1) === parity) return -1;
    const reach = mode === 1 ? 1 : 3;
    for (let step = 1; step <= reach; step += 2) for (let side = 0; side < 2; side++) {
      const target = side === 0 ? state + step : state - step;
      if (target < 0 || target > alpha) continue;
      const scaled = 255 * target, rounded = ((scaled * 2 + alpha) / (2 * alpha)) | 0, floored = (scaled / alpha) | 0;
      if (rounded !== value && robustValue(rounded, alpha, mode)) return rounded;
      if (mode === 2 && floored !== rounded && floored !== value && robustValue(floored, alpha, mode)) return floored;
    }
    return -1;
  }
  // sparse-rgb-v2, one opaque pixel at `offset`: the keyed channel takes the keyed bit as its lowest bit unless the value pair (value >> 1) of
  // that channel is 0 or 127 (the value is 0, 1, 254 or 255; see the header). Then the next channel in the order R, G, B, R is tried, and a
  // pixel whose three channels are saturated stays as drawn. Returns 1 when a byte changed.
  function parityMove(data, offset, channel, bit) {
    for (let step = 0; step < 3; step++, channel = channel === 2 ? 0 : channel + 1) {
      const at = offset + channel, value = data[at], pair = value >> 1;
      if (pair === 0 || pair === 127) continue;
      const target = (value & 254) | bit;
      if (target === value) return 0;
      data[at] = target; return 1;
    }
    return 0;
  }
  // Projects `width` x `height` RGBA pixels in place whose top-left is canvas position (x, y); `mode` selects translucent marking.
  // Returns { opaque, translucent } pixel counts (the rest are fully transparent).
  function projectPixels(data, width, height, x, y, overlay, k0l, k0h, k1l, k1h, mode) {
    const table = I.table, lut = I.lut;
    const i0l = (k0l ^ 0x70736575) | 0, i0h = (k0h ^ 0x736f6d65) | 0, i1l = (k1l ^ 0x6e646f6d) | 0, i1h = (k1h ^ 0x646f7261) | 0;
    const i2l = (k0l ^ 0x6e657261) | 0, i2h = (k0h ^ 0x6c796765) | 0, i3l = (k1l ^ 0x79746573) | 0, i3h = (k1h ^ 0x74656462) | 0;
    let translucent = 0, transparent = 0, a = 0, A = 0, b = 0, B = 0, c = 0, C = 0, d = 0, D = 0, lo = 0, t = 0;
    for (let first = 0; first < width; first += 1024) {
      const columns = width - first < 1024 ? width - first : 1024;
      for (let column = 0; column < columns; column++) {
        const across = (x + first + column) | 0, base = column << 3;
        a = i0l; A = i0h; b = i1l; B = i1h; c = i2l; C = i2h; d = i3l ^ 0x53564e43; D = i3h ^ across;
        for (let round = 0; round < 2; round++) {
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
        table[base] = a ^ 0x53564e43; table[base + 1] = A ^ across; table[base + 2] = b; table[base + 3] = B;
        table[base + 4] = c; table[base + 5] = C; table[base + 6] = d; table[base + 7] = D;
      }
      for (let row = 0; row < height; row++) {
        const packed = projectRow(data, (row * width + first) * 4, columns, (y + row) | 0, overlay, table, lut, mode);
        translucent += packed >> 11; transparent += packed & 2047;
      }
    }
    return { opaque: width * height - translucent - transparent, translucent };
  }
  // sparse-rgb-v1 kernel (specification in the file header). `data` holds the width x height RGBA pixels whose top-left is canvas
  // position (x, y) of a cw x ch canvas. Every cell that touches one of its row segments is drawn once (the last draw is reused for
  // the next row, so narrow canvases cost one hash per cell, not per row) and the part of its run inside the rectangle is moved.
  // Plain integer arithmetic only: no Math.*, so page-patched globals cannot reach it. Returns the number of pixels changed. With `mode`
  // (1 Skia, 2 Moz2D) a selected translucent pixel moves one stored state of its channel too (see the header). With `parity` (sparse-rgb-v2) the
  // keyed bit sets the lowest bit of the keyed channel (or of the next unsaturated one) instead of choosing a direction (see the header).
  function projectSparse(data, width, height, x, y, cw, ch, k0l, k0h, k1l, k1h, mode, parity) {
    const total = cw * ch, message = I.sparseMessage, draw = I.sparseDraw;
    const x0 = x < 0 ? 0 : x, x1 = x + width > cw ? cw : x + width, y0 = y < 0 ? 0 : y, y1 = y + height > ch ? ch : y + height;
    if (x1 <= x0 || y1 <= y0) return 0;
    // Small canvases: cells of 8 pixels, one draw byte per pixel. Medium: runs of 16 cover every pixel. Large: 1% in runs.
    const lanes = total <= 65536, dense = total <= 262144;
    let run = 8;
    if (!dense) { run = (((total / 100) | 0) / 1024) | 0; run = run < 1 ? 1 : run > 8 ? 8 : run; } else if (!lanes) run = 16;
    const span = dense ? run : run * 100, range = span - run + 1;
    message[4] = cw; message[5] = cw >>> 8; message[6] = cw >>> 16; message[7] = cw >>> 24;
    message[8] = ch; message[9] = ch >>> 8; message[10] = ch >>> 16; message[11] = ch >>> 24;
    let cell = -1, start = 0, channel = 0, up = 0, changed = 0;
    for (let line = y0; line < y1; line++) {
      const base = line * cw, first = base + x0, last = base + x1 - 1;
      for (let current = (first / span) | 0, end = (last / span) | 0; current <= end; current++) {
        if (current !== cell) {
          cell = current;
          message[12] = cell; message[13] = cell >>> 8; message[14] = cell >>> 16; message[15] = cell >>> 24;
          I.sipHash24(message, k0l, k0h, k1l, k1h, draw);
          start = cell * span + draw[0] % range; channel = (draw[1] & 0xffff) % 3; up = (draw[1] >>> 16) & 1;
        }
        const to = start + run - 1 < last ? start + run - 1 : last;
        for (let index = start > first ? start : first; index <= to; index++) {
          const offset = ((line - y) * width + index - base - x) * 4, alpha = data[offset + 3];
          if (alpha !== 255 && (alpha === 0 || !mode)) continue;
          if (lanes) { const lane = index - start, byte = (lane < 4 ? draw[0] >>> (lane << 3) : draw[1] >>> ((lane - 4) << 3)) & 255; channel = (byte & 127) % 3; up = byte >>> 7; }
          const at = offset + channel, value = data[at];
          if (parity) {
            if (alpha === 255) { changed += parityMove(data, offset, channel, up); continue; }
            const near = nearbyParity(value, alpha, up, mode);
            if (near >= 0) { data[at] = near; changed++; }
            continue;
          }
          if (alpha === 255) { data[at] = value === 0 ? 1 : value === 255 ? 254 : up ? value + 1 : value - 1; changed++; continue; }
          const moved = nearbyValue(value, alpha, up, mode);
          if (moved >= 0) { data[at] = moved; changed++; }
        }
      }
    }
    return changed;
  }
  // Counts translucent pixels and zeroes every non-opaque pixel (the overlay of a tile that has to be composited, as in projectRow).
  function scanAlpha(data, pixels) {
    let translucent = 0;
    for (let index = 0, end = pixels * 4; index < end; index += 4) {
      const alpha = data[index + 3];
      if (alpha === 255) continue;
      if (alpha !== 0) translucent++;
      data[index] = 0; data[index + 1] = 0; data[index + 2] = 0; data[index + 3] = 0;
    }
    return translucent;
  }
  if (!cached) {
    I.privatePromiseConstructor = I.freeze(I.define(I.create(null), I.speciesSymbol, { __proto__: null, value: I.NativePromise }));
    I.visualDeny = I.apply(I.symbolFor, undefined, ['detect.expert/api-custom/value-capture-deny/v1']);
    I.sipHash24 = sipHash24;
    // Output table: [v] is v - 1 and [256 + v] is v + 1, both reflected at the 0 and 255 endpoints.
    I.lut = new I.Uint8Array(512);
    for (let value = 0; value < 256; value++) { I.lut[value] = value === 0 ? 1 : value === 255 ? 254 : value - 1; I.lut[256 + value] = value === 0 ? 1 : value === 255 ? 254 : value + 1; }
    I.table = new I.Int32Array(8192);
    I.projectPixels = projectPixels;
    // sparse-rgb-v1: reusable 16-byte message ('SPR1' | width | height | cell) and 64-bit draw; the hot path never allocates.
    I.sparseMessage = new I.Uint8Array(16); I.sparseMessage[0] = 83; I.sparseMessage[1] = 80; I.sparseMessage[2] = 82; I.sparseMessage[3] = 49;
    I.sparseDraw = new I.Uint32Array(2);
    I.projectSparse = projectSparse; I.scanAlpha = scanAlpha; I.nearbyValue = nearbyValue; I.nearbyParity = nearbyParity; I.parityMove = parityMove; I.robustValue = robustValue;
    I.define(installCanvasCustom, '__detectExpertCanvasIntrinsicsV1', { __proto__: null, value: I.freeze(I) });
  }
  // DOM bindings are captured in their own realm. Chromium 153 can crash when
  // a parent's getContextAttributes is called on a child context after readback.
  function nativeBundle() {
    const canvas = proto(realm, 'HTMLCanvasElement'), context = proto(realm, 'CanvasRenderingContext2D');
    const offscreen = proto(realm, 'OffscreenCanvas'), offContext = proto(realm, 'OffscreenCanvasRenderingContext2D');
    const image = proto(realm, 'ImageData');
    return I.freeze({
      origin: capture(realm, 'origin', 'get'), document: capture(realm, 'document', 'get'),
      createCanvas: capture(proto(realm, 'Document'), 'createElement'),
      width: capture(canvas, 'width', 'get'), height: capture(canvas, 'height', 'get'),
      setWidth: capture(canvas, 'width', 'set'), setHeight: capture(canvas, 'height', 'set'),
      offWidth: capture(offscreen, 'width', 'get'), offHeight: capture(offscreen, 'height', 'get'),
      getContext: capture(canvas, 'getContext'), getImageData: capture(context, 'getImageData'),
      putImageData: capture(context, 'putImageData'), drawImage: capture(context, 'drawImage'),
      toDataURL: capture(canvas, 'toDataURL'), toBlob: capture(canvas, 'toBlob'),
      contextCanvas: capture(context, 'canvas', 'get'), contextAttributes: capture(context, 'getContextAttributes'),
      offContextCanvas: capture(offContext, 'canvas', 'get'), offContextAttributes: capture(offContext, 'getContextAttributes'),
      glColor: capture(proto(realm, 'WebGLRenderingContext'), 'drawingBufferColorSpace', 'get'),
      gl2Color: capture(proto(realm, 'WebGL2RenderingContext'), 'drawingBufferColorSpace', 'get'),
      glCanvas: capture(proto(realm, 'WebGLRenderingContext'), 'canvas', 'get'),
      gl2Canvas: capture(proto(realm, 'WebGL2RenderingContext'), 'canvas', 'get'),
      imageData: capture(image, 'data', 'get'), imageWidth: capture(image, 'width', 'get'), imageHeight: capture(image, 'height', 'get'),
      imageColor: capture(image, 'colorSpace', 'get'), blobType: capture(proto(realm, 'Blob'), 'type', 'get'),
    });
  }
  // Largest canvas/readback that can be projected, tile edge for derived canvases, and the bounds on
  // exports whose private snapshot is alive until the native encoder answers (toBlob/convertToBlob).
  // A read of a small rectangle stays allowed on canvases above MAX_PIXELS (browsers allow up to 2^28 pixels); 2^30 keeps the cell arithmetic in int32.
  const N = nativeBundle(), MAX_PIXELS = 16 * 1024 * 1024, MAX_CANVAS_PIXELS = 1024 * 1024 * 1024, TILE = 1024, MAX_PENDING = 256, MAX_PENDING_PIXELS = 2 * MAX_PIXELS;
  const state = { installed: 0, unavailable: 0, changed: 0, denied: 0 }, rows = [];
  function push(array, value) { I.define(array, array.length, { __proto__: null, value, enumerable: true, configurable: true, writable: true }); }
  function count(key, row) { if (state[key] < 65535) state[key]++; if (row && row[key] < 65535) row[key]++; }
  function snapshot() { const operations = []; for (let index = 0; index < rows.length; index++) push(operations, { ...rows[index] }); return { ...state, operations }; }
  let entry, duplicate = false;
  if (I.isArray(entries)) for (let index = 0; index < entries.length && index < 1024; index++) {
    const candidate = own(entries, index);
    if (own(candidate, 'id') === 'canvas-readback' && own(candidate, 'mode') === 'custom') { if (entry) duplicate = true; entry = candidate; }
  }
  if (!entry) return { snapshot };
  // Presence is a one-way privacy veto, never an authorization marker. Seal a
  // page-forged configurable field too; its value/getter is deliberately ignored.
  let visualSafe = false;
  try {
    const existing = I.descriptor(realm, I.visualDeny);
    if (!existing || existing.configurable) I.define(realm, I.visualDeny, { __proto__: null, value: true, configurable: false, enumerable: false, writable: false });
    const locked = I.descriptor(realm, I.visualDeny); visualSafe = !!locked && !locked.configurable;
  } catch { /* A covered read must not reach an inner observer if the veto cannot be sealed. */ }
  if (!visualSafe) count('unavailable');
  const identity = proto(realm, 'HTMLCanvasElement') || proto(realm, 'OffscreenCanvas') || proto(realm, 'CanvasRenderingContext2D');
  if (!identity) { count('unavailable'); return { snapshot }; }
  if (I.apply(I.has, I.installed, [identity])) return { snapshot };
  I.apply(I.add, I.installed, [identity]);
  // Canvas implementation, from vendor members of the realm that no Custom row touches (never from navigator values, which Custom rows change):
  // 2 = Firefox (Moz2D), 1 = Chromium family (Skia), 0 = unknown, where translucent pixels stay native. Chrome 156 has all three webkit
  // members (a Chromium Worker global has webkitRequestFileSystem), Firefox 138 and 153 none of them; the file-system member is also hidden
  // by a protection row, hence the other two. Firefox: mozInnerScreenX, mozOpaque, and (also in a Worker) SpiderMonkey's Error#fileName.
  function engineFamily() {
    try {
      if (owner(realm, 'mozInnerScreenX') || owner(proto(realm, 'HTMLCanvasElement'), 'mozOpaque')) return 2;
      const Failure = own(realm, 'Error'); // SpiderMonkey error objects carry fileName (a Worker has no window members): Firefox 138 and 153
      if (typeof Failure === 'function' && I.descriptor(new Failure(), 'fileName')) return 2;
      if (owner(realm, 'webkitRequestAnimationFrame') || owner(realm, 'webkitRequestFileSystem') || owner(proto(realm, 'Navigator'), 'webkitTemporaryStorage')) return 1;
      return 0;
    } catch { return 0; }
  }
  const family = engineFamily();
  const Denial = own(realm, 'DOMException') || DOMException;
  function deny(row) { count('denied', row); throw new Denial('Canvas profile cannot be applied to this readback', 'SecurityError'); }
  const profile = own(entry, 'value'), seed = own(entry, 'canvasSeed');
  // Unlinkability scope: a frame keys its noise by the top-level site (the last Location.ancestorOrigins entry), so one third-party
  // frame embedded on two sites no longer reports one hash. Chromium exposes the list; Firefox does not (unverified for newer
  // builds) and keeps the frame origin, as do workers, top-level documents (empty list) and every opaque ('null'), empty, oversized
  // (> 512) or unreadable case. Read once at install through getters captured from this realm and a bounded index: no iteration,
  // item() or other page-patchable method.
  function topSite() {
    try {
      const locationGet = capture(realm, 'location', 'get'), where = locationGet ? I.apply(locationGet, realm, []) : own(realm, 'location');
      if (where === null || typeof where !== 'object' && typeof where !== 'function') return undefined;
      const listGet = capture(where, 'ancestorOrigins', 'get'), list = listGet ? I.apply(listGet, where, []) : own(where, 'ancestorOrigins');
      if (list === null || typeof list !== 'object' && typeof list !== 'function') return undefined;
      const lengthGet = capture(proto(realm, 'DOMStringList'), 'length', 'get'), length = lengthGet ? I.apply(lengthGet, list, []) : own(list, 'length');
      if (typeof length !== 'number' || !(length >= 1) || length > 1024) return undefined;
      const top = list[length - 1];
      return typeof top === 'string' && top.length > 0 && top.length <= 512 && top !== 'null' ? top : undefined;
    } catch { return undefined; }
  }
  let origin = topSite();
  if (origin === undefined) try { origin = N.origin ? I.apply(N.origin, realm, []) : own(realm, 'origin'); } catch { /* Deny successful readback rather than use an unscoped key. */ }
  // Unknown algorithms fail closed: covered reads are denied, never returned unprojected.
  const algorithm = own(profile, 'algorithm'), parity = algorithm === 'sparse-rgb-v2', sparse = algorithm === 'sparse-rgb-v1' || parity;
  let ready = !duplicate && (sparse || algorithm === 'stable-rgb-v1') && typeof seed === 'string' &&
    I.apply(I.exec, /^[a-f0-9]{64}$/, [seed]) !== null && typeof origin === 'string' && origin.length > 0 && origin.length <= 2048;
  const key = new I.Uint32Array(4), hash = new I.Uint32Array(2);
  if (ready) {
    const words = new I.Uint32Array(8);
    for (let index = 0; index < 64; index++) { const code = I.apply(I.charCode, seed, [index]); words[index >>> 3] = words[index >>> 3] << 4 | (code <= 57 ? code - 48 : code - 87); }
    const input = new I.Uint8Array(12 + 2 * origin.length), domain = [67, 97, 110, 118, 97, 115, 47, 118, 49, 47, 111, 0];
    for (let index = 0; index < domain.length; index++) input[index] = domain[index];
    for (let index = 0; index < origin.length; index++) { const code = I.apply(I.charCode, origin, [index]); input[12 + index * 2] = code & 255; input[13 + index * 2] = code >>> 8; }
    I.sipHash24(input, words[0], words[1], words[2], words[3], hash); key[0] = hash[0]; key[1] = hash[1];
    input[11] = 1; I.sipHash24(input, words[4], words[5], words[6], words[7], hash); key[2] = hash[0]; key[3] = hash[1];
  } else count('unavailable');
  const contextDefinitions = [
    ['CanvasRenderingContext2D', N.contextCanvas, N.contextAttributes, null, false, false],
    ['OffscreenCanvasRenderingContext2D', N.offContextCanvas, N.offContextAttributes, null, true, false],
    ['WebGLRenderingContext', N.glCanvas, null, N.glColor, false, true],
    ['WebGL2RenderingContext', N.gl2Canvas, null, N.gl2Color, false, true],
  ];
  for (let index = 0; index < contextDefinitions.length; index++) {
    const row = contextDefinitions[index], prototype = proto(realm, row[0]);
    if (prototype && row[1]) I.apply(I.weakSet, I.contextKinds, [prototype, { canvas: row[1], attributes: row[2], color: row[3], offscreen: row[4], webgl: row[5] }]);
  }
  function bounded(width, height, limit = MAX_PIXELS) { return typeof width === 'number' && typeof height === 'number' && width >= 0 && height >= 0 && width % 1 === 0 && height % 1 === 0 && (!height || width <= limit / height); }
  function imageParts(image) {
    if (!N.imageData || !N.imageWidth || !N.imageHeight) throw 0;
    const data = I.apply(N.imageData, image, []), width = I.apply(N.imageWidth, image, []), height = I.apply(N.imageHeight, image, []);
    if (!bounded(width, height) || I.apply(I.typedTag, data, []) !== 'Uint8ClampedArray' || I.apply(I.typedLength, data, []) !== width * height * 4) throw 0;
    const color = N.imageColor ? I.apply(N.imageColor, image, []) : 'srgb';
    if (color !== 'srgb' && color !== 'display-p3') throw 0;
    return { data, width, height, color, length: width * height * 4 };
  }
  // parts.work: pixels that changed (sparse) or are opaque or marked translucent (stable), 0 = nothing to write back; parts.translucent:
  // pixels that need the overlay path (never with a translucent `mode`: such a tile is written back whole). `size` is the canvas { width, height } the rectangle belongs to; only sparse-rgb-v1 keys by it.
  function project(image, x, y, overlay = false, size = null, mode = 0, color = undefined) {
    if (!ready) throw 0;
    const parts = imageParts(image);
    // Translucent bytes are only understood in the canvas's own colour space (a converted ImageData is not a readback of a stored state).
    if (mode && color !== undefined && parts.color !== color) mode = 0;
    if (sparse) {
      if (!size) throw 0;
      parts.work = I.projectSparse(parts.data, parts.width, parts.height, x, y, size.width, size.height, key[0], key[1], key[2], key[3], mode, parity);
      // Only a tile that is going to be written back needs its translucent pixels found and zeroed.
      parts.translucent = overlay && parts.work ? I.scanAlpha(parts.data, parts.width * parts.height) : 0;
      return parts;
    }
    const counts = I.projectPixels(parts.data, parts.width, parts.height, x, y, overlay, key[0], key[1], key[2], key[3], mode);
    parts.work = counts.opaque + (mode ? counts.translucent : 0); parts.translucent = counts.translucent;
    return parts;
  }
  function dimensions(canvas, offscreen, limit = MAX_PIXELS) {
    const width = I.apply(offscreen ? N.offWidth : N.width, canvas, []), height = I.apply(offscreen ? N.offHeight : N.height, canvas, []);
    if (!bounded(width, height, limit)) throw 0; return { width, height };
  }
  function reserve(canvas, offscreen) {
    const size = dimensions(canvas, offscreen), pixels = size.width * size.height;
    // The snapshot must be taken in the call itself, so a request cannot wait for a slot: it is
    // admitted while the combined live snapshots stay inside the bounds, else it is denied.
    if (!pixels || I.pending.count >= MAX_PENDING || I.pending.pixels + pixels > MAX_PENDING_PIXELS) throw 0;
    I.pending.count++; I.pending.pixels += pixels;
    return { pixels, active: true };
  }
  function release(reservation) {
    if (!reservation || !reservation.active) return;
    reservation.active = false; I.pending.count--; I.pending.pixels -= reservation.pixels;
  }
  function newCanvas(width, height, color) {
    // Initial about:blank can be replaced by srcdoc without replacing its JS
    // intrinsics. A captured Document would then be detached and encoders stall.
    const document = N.document ? I.apply(N.document, realm, []) : own(realm, 'document');
    if (!document || !N.createCanvas || !N.setWidth || !N.setHeight || !N.getContext) throw 0;
    const canvas = I.apply(N.createCanvas, document, ['canvas']);
    I.apply(N.setWidth, canvas, [width]); I.apply(N.setHeight, canvas, [height]);
    const context = I.apply(N.getContext, canvas, ['2d', { __proto__: null, colorSpace: color, willReadFrequently: true }]);
    if (!context) throw 0;
    if (N.contextAttributes) { const attributes = I.apply(N.contextAttributes, context, []); if ((own(attributes, 'colorSpace') || 'srgb') !== color || own(attributes, 'colorType') === 'float16') throw 0; }
    else if (color !== 'srgb') throw 0;
    return { canvas, context };
  }
  // sparse-rgb-v2, flat canvases (see the header). distinctAtMost: true when `pixels` RGBA pixels hold at most FLAT_COLOURS distinct values
  // (the scan stops at the first pixel that makes a fifth, so a real drawing costs a few comparisons).
  const FLAT_COLOURS = 4, DENSE_PIXELS = 262144, FLAT = I.freeze(I.create(null));
  let scratch = null, lookBudget = 1 << 26; // pixels the private whole-canvas looks of this install may still copy (about 0.15 s of work in all)
  function distinctAtMost(data, pixels) {
    let first = 0, second = 0, third = 0, fourth = 0, found = 0;
    for (let index = 0, end = pixels * 4; index < end; index += 4) {
      const word = data[index] | data[index + 1] << 8 | data[index + 2] << 16 | data[index + 3] << 24;
      if (found > 0 && word === first || found > 1 && word === second || found > 2 && word === third || found > 3 && word === fourth) continue;
      if (found === FLAT_COLOURS) return false;
      if (found === 0) first = word; else if (found === 1) second = word; else if (found === 2) third = word; else fourth = word;
      found++;
    }
    return true;
  }
  // True when the whole canvas behind a getImageData call is flat. `image` is what the native getImageData(left, top, ...) returned for this call.
  function flatCanvas(image, left, top, size, metadata) {
    try {
      if (size.width * size.height > DENSE_PIXELS) return false;
      const parts = imageParts(image);
      if (!distinctAtMost(parts.data, parts.width * parts.height)) return false;
      if (left === 0 && top === 0 && parts.width === size.width && parts.height === size.height) return true;
      // The rectangle alone looks flat: look at the whole canvas through a private scratch copy (one per install and colour space; resizing clears it).
      if (lookBudget < size.width * size.height) return false;
      lookBudget -= size.width * size.height;
      const color = metadata.color || 'srgb';
      if (!scratch || scratch.color !== color) { scratch = newCanvas(size.width, size.height, color); scratch.color = color; }
      else { I.apply(N.setWidth, scratch.canvas, [size.width]); I.apply(N.setHeight, scratch.canvas, [size.height]); }
      I.apply(N.drawImage, scratch.context, [metadata.canvas, 0, 0]);
      const whole = imageParts(I.apply(N.getImageData, scratch.context, [0, 0, size.width, size.height]));
      const flat = distinctAtMost(whole.data, size.width * size.height);
      I.apply(N.setWidth, scratch.canvas, [1]); I.apply(N.setHeight, scratch.canvas, [1]); // drop the copied pixels
      return flat;
    } catch { scratch = null; return false; }
  }
  function derived(canvas, offscreen = false) {
    if (!ready || !N.getImageData || !N.putImageData || !N.drawImage) throw 0;
    const size = dimensions(canvas, offscreen); if (size.width === 0 || size.height === 0) return null;
    let attributes = I.apply(I.weakGet, I.byCanvas, [canvas]);
    if (attributes?.context) attributes = contextMetadata(attributes.context, canvas);
    if (attributes?.blocked || attributes?.colorType === 'float16') throw 0;
    const color = attributes?.color || 'srgb';
    const copy = newCanvas(size.width, size.height, color);
    I.apply(N.drawImage, copy.context, [canvas, 0, 0]);
    // sparse-rgb-v2: a flat canvas is exported as the browser rendered it (the callers return their native result).
    if (parity && attributes && size.width * size.height <= DENSE_PIXELS && distinctAtMost(imageParts(I.apply(N.getImageData, copy.context, [0, 0, size.width, size.height])).data, size.width * size.height)) return FLAT;
    // Project one tile at a time, so a large canvas costs one copy plus one tile instead of three copies. Where translucent pixels are
    // marked (a known engine; since ADR-112 a WebGL canvas too, so its export equals the export of its 2D mirror) every tile is written
    // back whole: putImageData(getImageData(x)) stores the same
    // premultiplied bytes again there (measured for every state), and a marked value stores its own state. Elsewhere a tile whose pixels
    // are all opaque or transparent is written back losslessly, and with translucent pixels only the opaque ones are composited over
    // the exact original via an overlay.
    const mode = family;
    const tileWidth = size.width < TILE ? size.width : TILE, tileHeight = size.height < TILE ? size.height : TILE;
    let overlay = null;
    for (let top = 0; top < size.height; top += TILE) for (let left = 0; left < size.width; left += TILE) {
      const width = size.width - left < TILE ? size.width - left : TILE, height = size.height - top < TILE ? size.height - top : TILE;
      const image = I.apply(N.getImageData, copy.context, [left, top, width, height]);
      const parts = imageParts(image);
      // No tracked context means an untouched blank canvas, or an inaccessible
      // native context obtained outside this realm. Only the blank case is safe.
      if (!attributes) for (let index = 0; index < parts.length; index++) if (parts.data[index] !== 0) throw 0;
      const counts = project(image, left, top, !mode, size, mode);
      if (counts.work === 0) continue;
      if (mode || counts.translucent === 0) { I.apply(N.putImageData, copy.context, [image, left, top]); continue; }
      overlay = overlay || newCanvas(tileWidth, tileHeight, color);
      I.apply(N.putImageData, overlay.context, [image, 0, 0]);
      I.apply(N.drawImage, copy.context, [overlay.canvas, 0, 0, width, height, left, top, width, height]);
    }
    return copy.canvas;
  }
  function mimeFromUrl(value) {
    if (typeof value !== 'string') throw 0;
    if (value === 'data:,') return null;
    const end = I.apply(I.stringIndex, value, [';']);
    if (end < 6 || end > 128 || I.apply(I.stringSlice, value, [0, 5]) !== 'data:') throw 0;
    return I.apply(I.stringSlice, value, [5, end]);
  }
  function mimeFromBlob(value) {
    if (!N.blobType) throw 0; const type = I.apply(N.blobType, value, []);
    if (typeof type !== 'string' || type.length > 128) throw 0; return type;
  }
  const quality = value => typeof value === 'number' ? value : undefined;
  function install(target, name, transform) {
    const row = { name, installed: 0, unavailable: 0, changed: 0, denied: 0 }; push(rows, row);
    try {
      const found = owner(target, name), original = found && own(found.field, 'value');
      if (typeof original !== 'function' || !found.field.configurable && !found.field.writable) { count('unavailable', row); return; }
      // ADR-112: closing a prototype cycle through the wrapper (Object.setPrototypeOf(fn, fn)) is refused with the engine's own TypeError, as for the
      // native function; accepted, it would make every later property read of the function overflow the stack. Everything else is forwarded.
      let self;
      const wrapper = self = new I.Proxy(original, { __proto__: null, apply(original, receiver, args) {
        if (!visualSafe && name !== 'getContext') return deny(row);
        return transform(original, receiver, args, row);
      }, setPrototypeOf(target, value) {
        if (value === self) { I.setProto(target, target); return false; }
        return I.reflectSetProto(target, value);
      } });
      I.define(found.target, name, { __proto__: null, ...found.field, value: wrapper }); count('installed', row);
    } catch { count('unavailable', row); }
  }
  function contextMetadata(context, fallbackCanvas) {
    const known = I.apply(I.weakGet, I.byContext, [context]);
    if (known) {
      // 2D attributes are fixed at context creation. Only WebGL's drawing buffer
      // colorSpace changes, and its getter must come from the receiver's realm.
      if (known.colorGetter) { known.color = I.apply(known.colorGetter, context, []); known.blocked = known.color !== 'srgb' && known.color !== 'display-p3'; }
      return known;
    }
    // A successful borrowed read of an untracked context is withheld; probing
    // foreign DOM bindings here could call a native with the wrong realm.
    if (!fallbackCanvas) return null;
    try {
      let kind, prototype = I.prototype(context);
      for (let depth = 0; prototype && depth < 16; depth++, prototype = I.prototype(prototype)) { kind = I.apply(I.weakGet, I.contextKinds, [prototype]); if (kind) break; }
      if (!kind) throw 0;
      const canvas = I.apply(kind.canvas, context, []); if (canvas !== fallbackCanvas) throw 0;
      const values = kind.attributes ? I.apply(kind.attributes, context, []) : null;
      const color = kind.color ? I.apply(kind.color, context, []) : own(values, 'colorSpace') || 'srgb';
      const result = { context, canvas, offscreen: kind.offscreen, webgl: kind.webgl, colorGetter: kind.color, color, colorType: own(values, 'colorType') || 'unorm8', blocked: color !== 'srgb' && color !== 'display-p3' };
      I.apply(I.weakSet, I.byCanvas, [canvas, result]); I.apply(I.weakSet, I.byContext, [context, result]); return result;
    } catch { const result = { blocked: true }; I.apply(I.weakSet, I.byCanvas, [fallbackCanvas, result]); return result; }
  }
  const canvasNames = ['HTMLCanvasElement', 'OffscreenCanvas'];
  for (let index = 0; index < canvasNames.length; index++) {
    const canvas = proto(realm, canvasNames[index]);
    if (canvas) install(canvas, 'getContext', (original, receiver, args) => { const result = I.apply(original, receiver, args); if (result) contextMetadata(result, receiver); return result; });
  }
  const contextNames = ['CanvasRenderingContext2D', 'OffscreenCanvasRenderingContext2D'];
  for (let contextIndex = 0; contextIndex < contextNames.length; contextIndex++) {
    const context = proto(realm, contextNames[contextIndex]); if (!context) continue;
    install(context, 'getImageData', (original, receiver, args, row) => {
      const image = I.apply(original, receiver, args);
      try {
        const metadata = contextMetadata(receiver);
        if (!metadata || metadata.blocked || metadata.colorType === 'float16') throw 0;
        for (let index = 0; index < 4; index++) if (typeof args[index] === 'object' && args[index] !== null || typeof args[index] === 'function') throw 0;
        const x = I.trunc(I.number(args[0])), y = I.trunc(I.number(args[1])), width = I.trunc(I.number(args[2])), height = I.trunc(I.number(args[3]));
        const left = x + (width < 0 ? width : 0), top = y + (height < 0 ? height : 0), size = sparse ? dimensions(metadata.canvas, metadata.offscreen, MAX_CANVAS_PIXELS) : null;
        if (parity && flatCanvas(image, left, top, size, metadata)) return image;
        project(image, left, top, false, size, metadata.webgl ? 0 : family, metadata.color); count('changed', row); return image;
      } catch { return deny(row); }
    });
  }
  const canvas = proto(realm, 'HTMLCanvasElement');
  if (canvas) {
    install(canvas, 'toDataURL', (original, receiver, args, row) => {
      const value = I.apply(original, receiver, args);
      try { const type = mimeFromUrl(value); if (type === null) return value; const copy = derived(receiver); if (!copy || copy === FLAT) return value;
        const result = I.apply(N.toDataURL, copy, [type, quality(args[1])]); count('changed', row); return result;
      } catch { return deny(row); }
    });
    install(canvas, 'toBlob', (original, receiver, args, row) => {
      const callback = args[0];
      if (typeof callback !== 'function') return I.apply(original, receiver, args);
      let copy, reservation, failed = false, delivered = false, received = false;
      function finish() { release(reservation); copy = null; }
      const sourceArgs = []; for (let index = 0; index < args.length; index++) push(sourceArgs, index === 0 ? function nativeBlobResult(blob) {
        if (received) return; received = true;
        const callbackThis = this;
        function deliver(value) { if (delivered) return; delivered = true; I.apply(callback, callbackThis, [value]); }
        if (blob === null) { finish(); deliver(null); return; }
        if (copy === FLAT) { finish(); deliver(blob); return; }
        if (failed || !copy) { finish(); count('denied', row); deliver(null); return; }
        let type; try { type = mimeFromBlob(blob); } catch { finish(); count('denied', row); deliver(null); return; }
        try { I.apply(N.toBlob, copy, [function projectedBlobResult(value) { finish(); count('changed', row); deliver(value); }, type, quality(args[2])]); }
        catch { finish(); count('denied', row); deliver(null); }
      } : args[index]);
      const result = I.apply(original, receiver, sourceArgs);
      try { reservation = reserve(receiver, false); copy = derived(receiver); } catch { finish(); failed = true; }
      return result;
    });
  }
  const offscreen = proto(realm, 'OffscreenCanvas');
  if (offscreen) install(offscreen, 'convertToBlob', (original, receiver, args, row) => {
    const sourceArgs = [], options = args[0], observed = { quality: undefined, opaque: false };
    let wrapped = options;
    if (options !== null && (typeof options === 'object' || typeof options === 'function')) wrapped = new I.Proxy(I.create(null), { __proto__: null, get(_target, key) {
      const value = I.get(options, key, options);
      if (key === 'quality') { if (value !== null && (typeof value === 'object' || typeof value === 'function')) observed.opaque = true; else observed.quality = value; }
      return value;
    } });
    for (let index = 0; index < args.length; index++) push(sourceArgs, index === 0 ? wrapped : args[index]);
    const native = I.apply(original, receiver, sourceArgs);
    let copy, reservation, failed = observed.opaque;
    function finish() { release(reservation); copy = null; }
    try { if (!failed) { reservation = reserve(receiver, true); copy = derived(receiver, true); } } catch { finish(); failed = true; }
    try {
      // ADR-095: do not expose the private native Blob Promise to page species.
      try { I.define(native, 'constructor', { __proto__: null, value: I.privatePromiseConstructor, writable: false, configurable: false, enumerable: false }); }
      catch { throw new I.NativeTypeError('Custom asynchronous result could not be protected'); }
      return I.apply(I.then, native, [function nativeBlobFulfilled(blob) {
      if (copy === FLAT) { finish(); return blob; }
      if (failed || !copy) { finish(); return deny(row); }
      let type; try { type = mimeFromBlob(blob); } catch { finish(); return deny(row); }
      return new I.NativePromise((resolve, reject) => {
        try { I.apply(N.toBlob, copy, [function projectedOffscreenBlob(value) { finish(); if (value === null) { reject(new Denial('Canvas profile encoding failed', 'EncodingError')); return; } count('changed', row); resolve(value); }, type, observed.quality === undefined ? undefined : I.number(observed.quality)]); }
        catch { finish(); reject(new Denial('Canvas profile encoding failed', 'SecurityError')); }
      });
    }, function nativeBlobRejected(error) { finish(); throw error; }]); }
    catch (error) { finish(); throw error; }
  });
  return { snapshot };
}
