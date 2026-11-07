// Shared synthetic realms, an independent sparse-rgb-v1 oracle and a small PNG model for the Canvas projection tests
// (ADR-066, ADR-104 addendum 3, ADR-107). Not a test file (no .test.mjs suffix): `node --test scripts/test/*.test.mjs` never runs it.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { installCanvasCustom } from '../../apps/production-extension/api-custom-canvas-runtime.js';
import { ENGINES, markRealm, storePixel, readPixel, oracleNearby, oracleParity, nearestState } from './canvas-translucent-kit.mjs';

export const SEED = '0123456789abcdef'.repeat(4);
export const ORIGIN = 'https://example.test';
export const MAX_PIXELS = 16 * 1024 * 1024;
export const TILE = 1024;

// ---------------------------------------------------------------------------------------------
// Deterministic pixels
// ---------------------------------------------------------------------------------------------
export function rng(seed) {
  let state = seed | 0;
  return () => (state = (Math.imul(state, 1664525) + 1013904223) | 0) >>> 0;
}
const EDGES = [0, 1, 254, 255];
// kinds: opaque, mixed (opaque + translucent + transparent), edge (endpoint-heavy mix), transparent, flat (one colour),
// gradient (smooth opaque), extremes (opaque pixels whose channels sit on 0 or 255 only), cutout (alpha 0 or 255 only: survives a real
// canvas round trip exactly, unlike translucent pixels whose RGB is premultiplied)
export function makeImage(width, height, kind, salt = 1) {
  const next = rng(Math.imul(width, 73856093) ^ Math.imul(height, 19349663) ^ Math.imul(salt, 83492791) ^ 0x2545f491);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    const r = next();
    if (kind === 'flat') { data[offset] = 83; data[offset + 1] = 129; data[offset + 2] = 207; data[offset + 3] = 255; continue; }
    if (kind === 'gradient') { const pixel = offset >>> 2; data[offset] = (pixel % width) * 255 / Math.max(1, width - 1); data[offset + 1] = Math.floor(pixel / width) * 255 / Math.max(1, height - 1); data[offset + 2] = 128; data[offset + 3] = 255; continue; }
    if (kind === 'cutout') { if (r >>> 31) { data[offset] = r & 255; data[offset + 1] = (r >>> 8) & 255; data[offset + 2] = (r >>> 16) & 255; data[offset + 3] = 255; } continue; }
    if (kind === 'extremes') { data[offset] = r & 1 ? 255 : 0; data[offset + 1] = r & 2 ? 255 : 0; data[offset + 2] = r & 4 ? 255 : 0; data[offset + 3] = 255; continue; }
    const alpha = kind === 'opaque' ? 255 : kind === 'transparent' ? 0 : [255, 255, 255, 0, 17, 254][(r >>> 24) % 6];
    if (alpha === 0) continue;
    const pick = shift => kind === 'edge' && (r >>> shift) % 3 === 0 ? EDGES[(r >>> (shift + 4)) & 3] : (r >>> shift) & 255;
    data[offset] = pick(0); data[offset + 1] = pick(8); data[offset + 2] = pick(16); data[offset + 3] = alpha;
  }
  return data;
}
export const bytesOf = array => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
export const sameBytes = (left, right) => bytesOf(left).equals(bytesOf(right));
export const sha1 = array => createHash('sha1').update(bytesOf(array)).digest('hex');
// Crops a width x height RGBA array to the in-bounds rectangle (x, y, w, h); outside pixels read as transparent black.
export function crop(data, width, height, x, y, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row++) for (let column = 0; column < w; column++) {
    const gx = x + column, gy = y + row; if (gx < 0 || gy < 0 || gx >= width || gy >= height) continue;
    out.set(data.subarray((gy * width + gx) * 4, (gy * width + gx) * 4 + 4), (row * w + column) * 4);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Independent BigInt SipHash-2-4 (does not share code with production) and the session key of the installer
// ---------------------------------------------------------------------------------------------
const MASK = (1n << 64n) - 1n;
const rotate = (value, bits) => ((value << BigInt(bits)) | (value >> BigInt(64 - bits))) & MASK;
export function sipHash(bytes, key) {
  const k0 = BigInt(key[0]) | BigInt(key[1]) << 32n, k1 = BigInt(key[2]) | BigInt(key[3]) << 32n;
  const state = [k0 ^ 0x736f6d6570736575n, k1 ^ 0x646f72616e646f6dn, k0 ^ 0x6c7967656e657261n, k1 ^ 0x7465646279746573n];
  function round() {
    state[0] = (state[0] + state[1]) & MASK; state[1] = rotate(state[1], 13) ^ state[0]; state[0] = rotate(state[0], 32);
    state[2] = (state[2] + state[3]) & MASK; state[3] = rotate(state[3], 16) ^ state[2];
    state[0] = (state[0] + state[3]) & MASK; state[3] = rotate(state[3], 21) ^ state[0];
    state[2] = (state[2] + state[1]) & MASK; state[1] = rotate(state[1], 17) ^ state[2]; state[2] = rotate(state[2], 32);
  }
  let position = 0;
  while (position + 8 <= bytes.length) {
    let word = 0n;
    for (let offset = 0; offset < 8; offset++) word |= BigInt(bytes[position + offset]) << BigInt(8 * offset);
    state[3] ^= word; round(); round(); state[0] ^= word; position += 8;
  }
  let tail = BigInt(bytes.length & 255) << 56n;
  for (let offset = 0; position + offset < bytes.length; offset++) tail |= BigInt(bytes[position + offset]) << BigInt(8 * offset);
  state[3] ^= tail; round(); round(); state[0] ^= tail; state[2] ^= 255n;
  round(); round(); round(); round();
  const result = state[0] ^ state[1] ^ state[2] ^ state[3];
  return { lo: Number(result & 0xffffffffn), hi: Number(result >> 32n) };
}
// Session key of the installer for a 64-hex seed and an origin string: two keyed hashes of 'Canvas/v1/o\0' + origin (UTF-16LE).
export function sessionKey(seed = SEED, origin = ORIGIN) {
  const words = []; for (let index = 0; index < 8; index++) words.push(parseInt(seed.slice(index * 8, index * 8 + 8), 16));
  const input = new Uint8Array(12 + 2 * origin.length), domain = [67, 97, 110, 118, 97, 115, 47, 118, 49, 47, 111, 0];
  domain.forEach((value, index) => { input[index] = value; });
  for (let index = 0; index < origin.length; index++) { const code = origin.charCodeAt(index); input[12 + index * 2] = code & 255; input[13 + index * 2] = code >>> 8; }
  const first = sipHash(input, words.slice(0, 4)); input[11] = 1; const second = sipHash(input, words.slice(4, 8));
  return [first.lo, first.hi, second.lo, second.hi];
}

// ---------------------------------------------------------------------------------------------
// sparse-rgb-v1 oracle, written from the specification in the header of api-custom-canvas-runtime.js
// ---------------------------------------------------------------------------------------------
// Zones by canvas size N: small (<= 65,536) and medium (<= 262,144) move every opaque pixel, large moves a keyed 1% in runs.
export const SMALL_LIMIT = 65536, DENSE_LIMIT = 262144, SMALL_CELL = 8, MEDIUM_RUN = 16, LARGE_STEP = 100, RUN_MAX = 8, MIN_RUNS = 1024;
const clamp = (value, low, high) => value < low ? low : value > high ? high : value;
export function sparseGeometry(width, height) {
  const total = width * height, zone = total <= SMALL_LIMIT ? 'small' : total <= DENSE_LIMIT ? 'medium' : 'large', step = zone === 'large' ? LARGE_STEP : 1;
  const run = zone === 'small' ? SMALL_CELL : zone === 'medium' ? MEDIUM_RUN : clamp(Math.floor(Math.floor(total / LARGE_STEP) / MIN_RUNS), 1, RUN_MAX), span = run * step;
  return { total, zone, step, run, span, cells: Math.ceil(total / span), range: span - run + 1 };
}
// The draw of one cell: where its run starts, the colour channel it moves and the direction; small canvases use one byte per pixel.
export function sparseCell(key, width, height, cell, geometry = sparseGeometry(width, height)) {
  const message = new Uint8Array(16), view = new DataView(message.buffer);
  message.set([0x53, 0x50, 0x52, 0x31]); view.setUint32(4, width, true); view.setUint32(8, height, true); view.setUint32(12, cell, true);
  const { lo, hi } = sipHash(message, key), bytes = [lo & 255, (lo >>> 8) & 255, (lo >>> 16) & 255, lo >>> 24, hi & 255, (hi >>> 8) & 255, (hi >>> 16) & 255, hi >>> 24];
  return { start: cell * geometry.span + lo % geometry.range, channel: (hi & 0xffff) % 3, up: ((hi >>> 16) & 1) === 1, lanes: bytes.map(byte => ({ channel: (byte & 127) % 3, up: byte >>> 7 === 1 })) };
}
// Expected projection of a whole canvas: alpha-255 candidates move by one level on one channel; with a `family` (1 Skia, 2 Moz2D) translucent
// candidates take the value of the translucent oracle (canvas-translucent-kit.mjs) on the same channel and direction. `source` holds what a
// native read returns.
export function sparseExpected(source, width, height, key, family = 0) {
  const geometry = sparseGeometry(width, height), out = Uint8ClampedArray.from(source), selected = [];
  for (let cell = 0; cell < geometry.cells; cell++) {
    const draw = sparseCell(key, width, height, cell, geometry);
    for (let index = draw.start; index < draw.start + geometry.run && index < geometry.total; index++) {
      selected.push(index);
      const offset = index * 4, alpha = out[offset + 3];
      if (alpha === 0 || alpha !== 255 && !family) continue;
      const pick = geometry.zone === 'small' ? draw.lanes[index - draw.start] : draw, value = out[offset + pick.channel];
      if (alpha !== 255) { const moved = oracleNearby(value, alpha, pick.up, family); if (moved >= 0) out[offset + pick.channel] = moved; continue; }
      out[offset + pick.channel] = value === 0 ? 1 : value === 255 ? 254 : pick.up ? value + 1 : value - 1;
    }
  }
  return { data: out, geometry, selected };
}

// sparse-rgb-v2 oracle (ADR-112), written from the specification in the header of api-custom-canvas-runtime.js. Same cells, draws, channels and
// zones as sparse-rgb-v1 (sparseCell / sparseGeometry); the differences are the three of the header:
//   parity      the keyed bit is the lowest bit of the keyed channel (translucent: of the stored state, oracleParity);
//   saturation  a channel with value 0, 1, 254 or 255 never moves: the first other channel in the order c, c + 1, c + 2 (mod 3) takes the bit,
//               and an opaque pixel whose three channels are saturated stays;
//   flat        a canvas of at most 262,144 pixels with at most 4 distinct RGBA values is returned as drawn.
export const FLAT_COLOURS = 4;
export function distinctColours(rgba, stopAfter = FLAT_COLOURS) {
  const seen = new Set();
  for (let offset = 0; offset < rgba.length; offset += 4) { seen.add(rgba[offset] + rgba[offset + 1] * 256 + rgba[offset + 2] * 65536 + rgba[offset + 3] * 16777216); if (seen.size > stopAfter) break; }
  return seen.size;
}
export const isFlat = (rgba, width, height) => width * height <= DENSE_LIMIT && distinctColours(rgba) <= FLAT_COLOURS;
export const isSaturated = value => value === 0 || value === 1 || value === 254 || value === 255;
export function sparseExpectedV2(source, width, height, key, family = 0) {
  const geometry = sparseGeometry(width, height), out = Uint8ClampedArray.from(source), selected = [];
  if (isFlat(source, width, height)) return { data: out, geometry, selected, flat: true };
  for (let cell = 0; cell < geometry.cells; cell++) {
    const draw = sparseCell(key, width, height, cell, geometry);
    for (let index = draw.start; index < draw.start + geometry.run && index < geometry.total; index++) {
      selected.push(index);
      const offset = index * 4, alpha = out[offset + 3];
      if (alpha === 0 || alpha !== 255 && !family) continue;
      const pick = geometry.zone === 'small' ? draw.lanes[index - draw.start] : draw, bit = pick.up ? 1 : 0;
      if (alpha === 255) {
        for (let step = 0; step < 3; step++) { const channel = (pick.channel + step) % 3, value = out[offset + channel]; if (isSaturated(value)) continue; out[offset + channel] = (value & 254) | bit; break; }
        continue;
      }
      const moved = oracleParity(out[offset + pick.channel], alpha, bit, family); if (moved >= 0) out[offset + pick.channel] = moved;
    }
  }
  return { data: out, geometry, selected, flat: false };
}

// stable-rgb-v1 oracle: SipHash of 'CNVS' | x | y | r g b tag (tag 1 for alpha 255, alpha ^ 254 for a translucent pixel, whose r g b are the three
// stored states round(c alpha / 255)); bit c of the low word
// moves channel c up (else down). Opaque channels move one level (reflected), translucent ones through the translucent oracle.
export function stableExpected(source, width, height, key, family = 0) {
  const out = Uint8ClampedArray.from(source), message = new Uint8Array(16), view = new DataView(message.buffer);
  message.set([0x43, 0x4e, 0x56, 0x53]);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4, alpha = source[offset + 3];
    if (alpha === 0 || alpha !== 255 && !family) continue;
    view.setUint32(4, x, true); view.setUint32(8, y, true); for (let c = 0; c < 3; c++) message[12 + c] = alpha === 255 ? source[offset + c] : nearestState(source[offset + c], alpha); message[15] = alpha === 255 ? 1 : alpha ^ 254;
    const bits = sipHash(message, key).lo;
    for (let c = 0; c < 3; c++) {
      const value = source[offset + c], up = (bits >>> c) & 1;
      if (alpha === 255) out[offset + c] = value === 0 ? 1 : value === 255 ? 254 : up ? value + 1 : value - 1;
      else { const moved = oracleNearby(value, alpha, up, family); if (moved >= 0) out[offset + c] = moved; }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Minimal PNG model: 8-bit RGBA, adaptive per-row filter by the smallest sum of absolute residuals (libpng's heuristic), zlib level 6
// ---------------------------------------------------------------------------------------------
const chunk = (type, body) => {
  const length = Buffer.alloc(4); length.writeUInt32BE(body.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), body])) >>> 0);
  return Buffer.concat([length, Buffer.from(type), body, checksum]);
};
const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
export function encodePng(rgba, width, height, { filters = true } = {}) {
  const stride = width * 4, rows = Buffer.alloc((stride + 1) * height), candidate = Buffer.alloc(stride), best = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const line = y * stride, above = line - stride;
    let bestType = 0, bestSum = Infinity;
    for (let type = 0; type < (filters ? 5 : 1); type++) {
      let sum = 0;
      for (let x = 0; x < stride; x++) {
        const raw = rgba[line + x], left = x >= 4 ? rgba[line + x - 4] : 0, up = y ? rgba[above + x] : 0, corner = y && x >= 4 ? rgba[above + x - 4] : 0;
        const value = (raw - (type === 0 ? 0 : type === 1 ? left : type === 2 ? up : type === 3 ? (left + up) >> 1 : paeth(left, up, corner))) & 255;
        candidate[x] = value; sum += value < 128 ? value : 256 - value;
        if (sum >= bestSum) break;
      }
      if (sum < bestSum) { bestSum = sum; bestType = type; candidate.copy(best); }
    }
    rows[y * (stride + 1)] = bestType; best.copy(rows, y * (stride + 1) + 1);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}
// Independent decoder for the 8-bit RGBA, non-interlaced PNGs this model and Chromium write (all five filters).
export function decodePng(buffer) {
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  let width = 0, height = 0, type = 0, depth = 0; const parts = [];
  for (let position = 8; position < buffer.length;) {
    const length = buffer.readUInt32BE(position), name = buffer.toString('latin1', position + 4, position + 8), body = buffer.subarray(position + 8, position + 8 + length);
    if (name === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]; type = body[9]; assert.equal(body[12], 0, 'interlaced PNG'); }
    if (name === 'IDAT') parts.push(body);
    position += 12 + length;
  }
  assert.ok(depth === 8 && (type === 6 || type === 2), 'only 8-bit RGB/RGBA PNGs');
  const channels = type === 6 ? 4 : 3, stride = width * channels, raw = inflateSync(Buffer.concat(parts)), data = new Uint8Array(width * height * 4);
  const line = new Uint8Array(stride), previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x], left = x >= channels ? line[x - channels] : 0, up = previous[x], corner = x >= channels ? previous[x - channels] : 0;
      line[x] = (value + (filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : paeth(left, up, corner))) & 255;
    }
    for (let x = 0; x < width; x++) { for (let c = 0; c < 3; c++) data[(y * width + x) * 4 + c] = line[x * channels + c]; data[(y * width + x) * 4 + 3] = channels === 4 ? line[x * 4 + 3] : 255; }
    previous.set(line);
  }
  return { width, height, data };
}

// ---------------------------------------------------------------------------------------------
// Canvas realm with real pixel stores: row-wise copies, exports that remember the pixels they encoded.
// options.algorithm / seed / origin: the Custom value and keys. options.store === false: canvases keep no pixels (cheap size limits).
// options.hold: native encoders answer only when release() is called. options.entries: replaces the default Custom entry.
// options.engine ('skia-cpu' | 'skia-gpu' | 'moz2d-old' | 'moz2d-new', canvas-translucent-kit.mjs): the canvases then store PREMULTIPLIED bytes
// and convert with the measured arithmetic of that engine in getImageData, putImageData, drawImage (source-over on premultiplied bytes)
// and in every export, and the realm carries the member production uses to recognise the engine family (options.prepare(realm) may add others). Without it the realm is an
// unknown engine (family 0): straight bytes, translucent pixels stay native.
// ---------------------------------------------------------------------------------------------
export function canvasRealm(options = {}) {
  const { algorithm = 'sparse-rgb-v1', seed = SEED, origin = ORIGIN } = options;
  const engine = options.engine ? ENGINES[options.engine] : null;
  const stores = new WeakMap(), contexts = new WeakMap(), images = new WeakMap(), exported = new Map(), calls = [], held = [];
  const brand = new TypeError('NATIVE_BRAND');
  const check = (map, key) => { const found = map.get(key); if (!found) throw brand; return found; };
  const log = (name, receiver, args) => calls.push({ name, receiver, args });
  let serial = 0;
  const allocate = store => { store.data = new Uint8ClampedArray(options.store === false ? 0 : store.width * store.height * 4); };
  class ImageData {
    constructor(data, width, height, colorSpace) { images.set(this, { data, width, height, colorSpace }); }
    get data() { return check(images, this).data; } get width() { return check(images, this).width; } get height() { return check(images, this).height; } get colorSpace() { return check(images, this).colorSpace; }
  }
  // In-bounds part of a width x height rectangle; `opaqueOnly` is source-over (straight alpha): alpha 0 leaves the destination,
  // 255 replaces it and anything between blends, so an overlay that still carries a translucent pixel visibly changes it.
  function copyRows(from, fx, fy, to, tx, ty, width, height, opaqueOnly) {
    if (!from.data.length || !to.data.length) return;
    for (let y = 0; y < height; y++) {
      if (fy + y < 0 || fy + y >= from.height || ty + y < 0 || ty + y >= to.height) continue;
      const x0 = Math.max(0, -fx, -tx), x1 = Math.min(width, from.width - fx, to.width - tx);
      if (x1 <= x0) continue;
      const source = ((fy + y) * from.width + fx + x0) * 4, target = ((ty + y) * to.width + tx + x0) * 4, length = (x1 - x0) * 4;
      if (!opaqueOnly) { to.data.set(from.data.subarray(source, source + length), target); continue; }
      for (let offset = 0; offset < length; offset += 4) {
        const alpha = from.data[source + offset + 3]; if (alpha === 0) continue;
        if (alpha === 255) { for (let c = 0; c < 4; c++) to.data[target + offset + c] = from.data[source + offset + c]; continue; }
        if (engine) { for (let c = 0; c < 4; c++) to.data[target + offset + c] = from.data[source + offset + c] + Math.round(to.data[target + offset + c] * (255 - alpha) / 255); continue; } // premultiplied source-over
        const sa = alpha / 255, da = to.data[target + offset + 3] / 255, oa = sa + da * (1 - sa);
        for (let c = 0; c < 3; c++) to.data[target + offset + c] = Math.round((from.data[source + offset + c] * sa + to.data[target + offset + c] * da * (1 - sa)) / oa);
        to.data[target + offset + 3] = Math.round(oa * 255);
      }
    }
  }
  const members = {
    getImageData(sx, sy, sw, sh, settings) {
      const context = check(contexts, this), source = check(stores, context.canvas); log('getImageData', this, [...arguments]);
      if (sw < 0) { sx += sw; sw = -sw; } if (sh < 0) { sy += sh; sh = -sh; }
      const data = new Uint8ClampedArray(sw * sh * 4);
      copyRows(source, sx, sy, { data, width: sw, height: sh }, 0, 0, sw, sh, false);
      if (engine) for (let o = 0; o < data.length; o += 4) readPixel(engine, data, o, 'get');
      return new ImageData(data, sw, sh, settings?.colorSpace ?? context.colorSpace);
    },
    putImageData(image, dx, dy) {
      const context = check(contexts, this), record = check(stores, context.canvas), input = check(images, image); log('putImageData', this, [...arguments]);
      if (engine) { const stored = new Uint8ClampedArray(input.data.length); for (let o = 0; o < stored.length; o += 4) storePixel(engine, input.data, o, stored); copyRows({ ...input, data: stored }, 0, 0, record, dx, dy, input.width, input.height, false); }
      else copyRows(input, 0, 0, record, dx, dy, input.width, input.height, false);
    },
    drawImage(source, ...rest) {
      const context = check(contexts, this), destination = check(stores, context.canvas), input = check(stores, source); log('drawImage', this, [source, ...rest]);
      assert.ok(rest.length === 2 || rest.length === 8, 'unsupported drawImage form');
      const area = rest.length === 8 ? rest : [0, 0, input.width, input.height, rest[0], rest[1]];
      if (rest.length === 8) assert.ok(rest[2] === rest[6] && rest[3] === rest[7], 'drawImage must not scale');
      copyRows(input, area[0], area[1], destination, area[4], area[5], area[2], area[3], true);
    },
  };
  class CanvasRenderingContext2D {
    constructor(canvas, settings = {}) { contexts.set(this, { canvas, colorSpace: settings.colorSpace || 'srgb', colorType: 'unorm8' }); }
    get canvas() { return check(contexts, this).canvas; }
    getContextAttributes() { const row = check(contexts, this); return { alpha: true, colorSpace: row.colorSpace, colorType: row.colorType }; }
    getImageData(...args) { return Reflect.apply(members.getImageData, this, args); }
    putImageData(...args) { return Reflect.apply(members.putImageData, this, args); }
    drawImage(...args) { return Reflect.apply(members.drawImage, this, args); }
  }
  // A WebGL context only has to exist for the runtime to classify its canvas (canvas, drawingBufferColorSpace); the pixels are put into the store.
  class WebGLRenderingContext {
    constructor(canvas) { contexts.set(this, { canvas, colorSpace: 'srgb' }); }
    get canvas() { return check(contexts, this).canvas; } get drawingBufferColorSpace() { return check(contexts, this).colorSpace; }
  }
  class OffscreenCanvasRenderingContext2D {
    constructor(canvas, settings = {}) { contexts.set(this, { canvas, colorSpace: settings.colorSpace || 'srgb', colorType: 'unorm8' }); }
    get canvas() { return check(contexts, this).canvas; }
    getContextAttributes() { const row = check(contexts, this); return { alpha: true, colorSpace: row.colorSpace, colorType: row.colorType }; }
    getImageData(...args) { return Reflect.apply(members.getImageData, this, args); }
    putImageData(...args) { return Reflect.apply(members.putImageData, this, args); }
    drawImage(...args) { return Reflect.apply(members.drawImage, this, args); }
  }
  const mime = type => type === 'image/jpeg' || type === 'image/webp' ? type : 'image/png';
  const encode = (store, type) => { const pixels = store.data.slice(); if (engine) for (let o = 0; o < pixels.length; o += 4) readPixel(engine, pixels, o, 'png'); return { pixels, width: store.width, height: store.height, type: mime(type) }; };
  class HTMLCanvasElement {
    constructor() { stores.set(this, { width: 0, height: 0, data: new Uint8ClampedArray(0) }); }
    get width() { return check(stores, this).width; } set width(value) { const store = check(stores, this); store.width = Number(value); allocate(store); }
    get height() { return check(stores, this).height; } set height(value) { const store = check(stores, this); store.height = Number(value); allocate(store); }
    getContext(type, settings) { const store = check(stores, this); log('getContext', this, [...arguments]); if (type === 'webgl') return store.context ??= new WebGLRenderingContext(this); if (type !== '2d') return null; return store.context ??= new CanvasRenderingContext2D(this, settings); }
    toDataURL(type) {
      const store = check(stores, this); log('toDataURL', this, [...arguments]);
      if (!store.width || !store.height) return 'data:,';
      const row = encode(store, type), url = 'data:' + row.type + ';base64,' + serial++; exported.set(url, row); return url;
    }
    toBlob(callback, type) {
      const store = check(stores, this); log('toBlob', this, [...arguments]);
      const row = store.width && store.height ? encode(store, type) : null, blob = row && new Blob([String(serial++)], { type: row.type });
      if (blob) exported.set(blob, row);
      const deliver = () => Reflect.apply(callback, undefined, [blob]); if (options.hold) held.push(deliver); else queueMicrotask(deliver);
    }
  }
  class OffscreenCanvas {
    constructor(width, height) { const store = { width, height, data: null }; allocate(store); stores.set(this, store); }
    get width() { return check(stores, this).width; } get height() { return check(stores, this).height; }
    getContext(type, settings) { const store = check(stores, this); log('getContext', this, [...arguments]); if (type !== '2d') return null; return store.context ??= new OffscreenCanvasRenderingContext2D(this, settings); }
    convertToBlob(request = {}) {
      const store = check(stores, this); log('convertToBlob', this, [...arguments]);
      const row = encode(store, request?.type), blob = new Blob([String(serial++)], { type: row.type }); exported.set(blob, row);
      return options.hold ? new Promise(resolve => held.push(() => resolve(blob))) : Promise.resolve(blob);
    }
  }
  class Document { createElement(tag) { assert.equal(tag, 'canvas'); return new HTMLCanvasElement(); } }
  const realm = { HTMLCanvasElement, CanvasRenderingContext2D, WebGLRenderingContext, OffscreenCanvas, OffscreenCanvasRenderingContext2D, ImageData, Document, Blob, DOMException, origin, document: new Document() };
  if (engine) markRealm(realm, engine.family);
  options.prepare?.(realm); // a test may add or remove members before the installer looks at the realm
  // The production page script serializes the installer; evaluate that text with isolated intrinsics (exposed as `context`, so a test
  // can poison them the way a page would after installation).
  const context = options.context ?? vm.createContext({ DOMException });
  const installer = options.installer ?? vm.runInContext(`(${installCanvasCustom.toString()})`, context);
  const installation = installer(realm, options.entries ?? [{ id: 'canvas-readback', mode: 'custom', value: { algorithm }, canvasSeed: seed }]);
  // A source canvas with deterministic pixels: a kind of makeImage(), or an explicit RGBA array.
  function canvas(width, height, kind = 'opaque', offscreen = false, salt = 1) {
    const element = offscreen ? new OffscreenCanvas(width, height) : new HTMLCanvasElement();
    if (!offscreen) { element.width = width; element.height = height; }
    const context = element.getContext('2d'), store = stores.get(element);
    if (options.store !== false) {
      const straight = typeof kind === 'string' ? makeImage(width, height, kind, salt) : kind;
      if (engine) for (let o = 0; o < straight.length; o += 4) storePixel(engine, straight, o, store.data); else store.data.set(straight);
    }
    // pixels: what a native read of the canvas returns (the projection's input)
    const native = store.data.slice(); if (engine) for (let o = 0; o < native.length; o += 4) readPixel(engine, native, o, 'get');
    return { canvas: element, context, store, before: sha1(store.data), pixels: native, read: (x = 0, y = 0, w = width, h = height) => context.getImageData(x, y, w, h).data };
  }
  // A canvas with a WebGL context holding the given pixels (stored like a 2D canvas: only its export is read).
  function webgl(width, height, kind = 'opaque', salt = 1) {
    const element = new HTMLCanvasElement(); element.width = width; element.height = height;
    const context = element.getContext('webgl'), store = stores.get(element), straight = typeof kind === 'string' ? makeImage(width, height, kind, salt) : kind;
    if (engine) for (let o = 0; o < straight.length; o += 4) storePixel(engine, straight, o, store.data); else store.data.set(straight);
    return { canvas: element, context, store, before: sha1(store.data) };
  }
  // A canvas whose context was never created through the wrapped getContext (so it is untracked).
  function untracked(width, height) {
    const element = new HTMLCanvasElement(); element.width = width; element.height = height;
    return { canvas: element, store: stores.get(element) };
  }
  // The export record (pixels, size, type) behind a URL/Blob; each export is looked up once, then forgotten to keep memory flat.
  const takeRow = value => { const row = exported.get(value); assert.ok(row, 'unknown export'); exported.delete(value); return row; };
  const take = value => takeRow(value).pixels;
  const privateCanvases = () => new Set(calls.filter(row => row.name === 'getContext').map(row => row.receiver));
  const exportBlob = element => new Promise(resolve => element.toBlob(resolve));
  return { realm, installer, installation, context, calls, canvas, webgl, untracked, take, takeRow, exportBlob, privateCanvases, stores, pending: installer.__detectExpertCanvasIntrinsicsV1.pending, release() { while (held.length) held.shift()(); } };
}
