// ADR-066 canvas readback projection: pixel kernel speed and bit-exactness, tiled export of large
// canvases and the bounded burst behaviour of async exports (audit defects D-canvas-2/3/4).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { installCanvasCustom } from '../../apps/production-extension/api-custom-canvas-runtime.js';

installCanvasCustom({}, []);
const I = installCanvasCustom.__detectExpertCanvasIntrinsicsV1;
const MAX_PIXELS = 16 * 1024 * 1024, TILE = 1024, MAX_PENDING = 256;
const seed = '0123456789abcdef'.repeat(4), origin = 'https://example.test';
const entry = () => ({ id: 'canvas-readback', mode: 'custom', value: { algorithm: 'stable-rgb-v1' }, canvasSeed: seed });

// ---------------------------------------------------------------------------------------------
// Reference: the per-pixel implementation that projectPixels replaced (one generic SipHash-2-4 call
// per opaque pixel over a 16-byte message). Kept verbatim as the bit-exact oracle and speed baseline.
function referenceProject(data, width, height, x, y, overlay, key) {
  const message = new Uint8Array(16), hash = new Uint32Array(2), length = width * height * 4;
  message[0] = 67; message[1] = 78; message[2] = 86; message[3] = 83; message[15] = 1;
  for (let index = 0; index < length; index += 4) {
    if (data[index + 3] !== 255) {
      if (overlay) { data[index] = 0; data[index + 1] = 0; data[index + 2] = 0; data[index + 3] = 0; }
      continue;
    }
    const pixel = index >>> 2, column = x + pixel % width, line = y + Math.trunc(pixel / width);
    for (let byte = 0; byte < 4; byte++) { message[4 + byte] = column >>> (8 * byte); message[8 + byte] = line >>> (8 * byte); }
    message[12] = data[index]; message[13] = data[index + 1]; message[14] = data[index + 2];
    I.sipHash24(message, key[0], key[1], key[2], key[3], hash);
    for (let channel = 0; channel < 3; channel++) {
      const value = data[index + channel];
      data[index + channel] = value === 0 ? 1 : value === 255 ? 254 : value + ((hash[0] >>> channel & 1) ? 1 : -1);
    }
  }
}
// The session key of the installer for `seed` and `origin`, derived independently of production.
function sessionKey() {
  const words = new Uint32Array(8), hash = new Uint32Array(2), key = new Uint32Array(4);
  for (let index = 0; index < 64; index++) { const code = seed.charCodeAt(index); words[index >>> 3] = words[index >>> 3] << 4 | (code <= 57 ? code - 48 : code - 87); }
  const input = new Uint8Array(12 + 2 * origin.length), domain = [67, 97, 110, 118, 97, 115, 47, 118, 49, 47, 111, 0];
  for (let index = 0; index < domain.length; index++) input[index] = domain[index];
  for (let index = 0; index < origin.length; index++) { const code = origin.charCodeAt(index); input[12 + index * 2] = code & 255; input[13 + index * 2] = code >>> 8; }
  I.sipHash24(input, words[0], words[1], words[2], words[3], hash); key[0] = hash[0]; key[1] = hash[1];
  input[11] = 1; I.sipHash24(input, words[4], words[5], words[6], words[7], hash); key[2] = hash[0]; key[3] = hash[1];
  return key;
}
const kernel = (data, width, height, x, y, overlay, key) => I.projectPixels(data, width, height, x, y, overlay, key[0], key[1], key[2], key[3]);

let state = 0x2545f491;
const next = () => (state = (Math.imul(state, 1664525) + 1013904223) | 0) >>> 0;
const EDGES = [0, 1, 254, 255];
// kinds: opaque, mixed (opaque + translucent + transparent), edge (endpoint-heavy mix), transparent
function image(width, height, kind) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    const r = next(), alpha = kind === 'opaque' ? 255 : kind === 'transparent' ? 0 : [255, 255, 255, 0, 17, 254][(r >>> 24) % 6];
    if (alpha === 0) continue;
    const pick = shift => kind === 'edge' && (r >>> shift) % 3 === 0 ? EDGES[(r >>> (shift + 4)) & 3] : (r >>> shift) & 255;
    data[offset] = pick(0); data[offset + 1] = pick(8); data[offset + 2] = pick(16); data[offset + 3] = alpha;
  }
  return data;
}
const bytes = array => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
const same = (left, right) => bytes(left).equals(bytes(right));
const fingerprint = array => createHash('sha1').update(bytes(array)).digest('hex');
const keys = [[0, 0, 0, 0], [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff], [0xcafebabe, 0x88776655, 0x80000000, 0x12345678], [next(), next(), next(), next()]];

test('the pixel kernel is bit-identical to the per-pixel SipHash loop across sizes, keys, origins and column-chunk boundaries', () => {
  // 1023/1024/1025 and 2049 columns cross the 1024-column state-cache chunks; origins reach the int32 wrap.
  const sizes = [[1, 1], [2, 3], [7, 5], [1, 40], [40, 1], [64, 64], [1023, 2], [1024, 2], [1025, 2], [2049, 3], [3, 1100], [1100, 3]];
  const origins = [[0, 0], [3, 5], [-7, -9], [2147483647, -2147483648], [-2147483648, 2147483647], [1000000, 2000000]];
  let cases = 0;
  for (const [width, height] of sizes) for (const kind of ['mixed', 'opaque', 'edge']) for (const key of keys) for (const [x, y] of origins) for (const overlay of [false, true]) {
    const expected = image(width, height, kind), actual = expected.slice();
    referenceProject(expected, width, height, x, y, overlay, key); kernel(actual, width, height, x, y, overlay, key); cases++;
    assert.ok(same(expected, actual), `${width}x${height} ${kind} key=${key} origin=${x},${y} overlay=${overlay}`);
  }
  assert.equal(cases, sizes.length * 3 * keys.length * origins.length * 2);
});

test('the kernel counts opaque and translucent pixels and zeroes non-opaque pixels only in overlay mode', () => {
  const width = 37, height = 29, key = keys[2], original = image(width, height, 'mixed');
  let opaque = 0, translucent = 0, transparent = 0;
  for (let offset = 3; offset < original.length; offset += 4) { const alpha = original[offset]; if (alpha === 255) opaque++; else if (alpha === 0) transparent++; else translucent++; }
  assert.ok(opaque > 0 && translucent > 0 && transparent > 0);
  const plain = original.slice(), overlay = original.slice();
  assert.deepEqual(kernel(plain, width, height, 5, 6, false, key), { opaque, translucent });
  assert.deepEqual(kernel(overlay, width, height, 5, 6, true, key), { opaque, translucent });
  for (let offset = 0; offset < original.length; offset += 4) {
    const solid = original[offset + 3] === 255;
    for (let channel = 0; channel < 4; channel++) {
      if (solid) { assert.ok(channel === 3 ? plain[offset + 3] === 255 : Math.abs(plain[offset + channel] - original[offset + channel]) === 1); assert.equal(plain[offset + channel], overlay[offset + channel]); }
      else { assert.equal(plain[offset + channel], original[offset + channel]); assert.equal(overlay[offset + channel], 0); }
    }
  }
});

test('the output table moves a channel by one level and reflects 0 and 255, exactly like the previous formula', () => {
  for (let value = 0; value < 256; value++) for (const bit of [0, 1]) {
    assert.equal(I.lut[value | bit << 8], value === 0 ? 1 : value === 255 ? 254 : value + (bit ? 1 : -1), `value ${value} bit ${bit}`);
  }
  assert.equal(I.lut.length, 512);
});

test('a flat single-colour canvas is projected like any other (no low-colour exemption)', () => {
  // An exemption by distinct-colour count would let a page read any canvas back exactly in flat
  // 1x1 or 2x2 slices, so every opaque pixel moves, including pure white and pure black.
  const width = 24, height = 16, flat = new Uint8ClampedArray(width * height * 4);
  for (const [r, g, b] of [[255, 255, 255], [0, 0, 0], [123, 45, 67]]) {
    for (let offset = 0; offset < flat.length; offset += 4) { flat[offset] = r; flat[offset + 1] = g; flat[offset + 2] = b; flat[offset + 3] = 255; }
    const projected = flat.slice(); kernel(projected, width, height, 0, 0, false, keys[2]);
    for (let offset = 0; offset < flat.length; offset += 4) for (let channel = 0; channel < 3; channel++) assert.equal(Math.abs(projected[offset + channel] - flat[offset + channel]), 1);
  }
});

test('the pixel kernel is several times faster than the per-pixel SipHash loop (relative, no absolute budget)', t => {
  const width = 256, height = 256, source = image(width, height, 'opaque'), work = new Uint8ClampedArray(source.length), key = keys[2];
  const measure = run => {
    for (let warm = 0; warm < 2; warm++) { work.set(source); run(); }
    let best = Infinity;
    for (let round = 0; round < 7; round++) { work.set(source); const start = performance.now(); run(); best = Math.min(best, performance.now() - start); }
    return best;
  };
  const before = measure(() => referenceProject(work, width, height, 3, 5, false, key));
  const after = measure(() => kernel(work, width, height, 3, 5, false, key));
  const perPixel = milliseconds => (milliseconds * 1e6 / (width * height)).toFixed(1);
  t.diagnostic(`reference ${perPixel(before)} ns/pixel, kernel ${perPixel(after)} ns/pixel, speed-up ${(before / after).toFixed(2)}x`);
  assert.ok(before / after >= 2, `expected at least a 2x speed-up, measured ${(before / after).toFixed(2)}x`);
});

test('the sparse-rgb-v1 kernel is far faster than the stable kernel above 512x512 and not slower below (relative, no absolute budget)', t => {
  // Same 256x256 rectangle as above. Read from a 1024x1024 canvas sparse hashes one cell in a hundred pixels; from canvases of up to
  // 512x512 it moves every pixel (one hash per 8 or 16 pixels) and must still not be slower than stable's hash per pixel.
  const width = 256, height = 256, source = image(width, height, 'opaque'), work = new Uint8ClampedArray(source.length), key = keys[2];
  const measure = run => {
    for (let warm = 0; warm < 2; warm++) { work.set(source); run(); }
    let best = Infinity;
    for (let round = 0; round < 7; round++) { work.set(source); const start = performance.now(); run(); best = Math.min(best, performance.now() - start); }
    return best;
  };
  const stable = measure(() => kernel(work, width, height, 3, 5, false, key));
  for (const [canvas, factor] of [[1024, 10], [512, 1], [256, 1]]) {
    const sparse = measure(() => I.projectSparse(work, width, height, 0, 0, canvas, canvas, key[0], key[1], key[2], key[3]));
    t.diagnostic(`${canvas}x${canvas} canvas: stable ${(stable * 1e6 / (width * height)).toFixed(1)} ns/pixel, sparse ${(sparse * 1e6 / (width * height)).toFixed(2)} ns/pixel, speed-up ${(stable / sparse).toFixed(1)}x`);
    assert.ok(stable / sparse >= factor, `${canvas}x${canvas}: expected at least ${factor}x, measured ${(stable / sparse).toFixed(1)}x`);
  }
  // From the large canvas the kernel moves about one pixel in a hundred; from the small one every pixel.
  work.set(source); const moved = I.projectSparse(work, width, height, 3, 5, 1024, 1024, key[0], key[1], key[2], key[3]);
  assert.ok(moved > width * height * 0.006 && moved < width * height * 0.014, 'moved ' + moved);
  work.set(source); assert.equal(I.projectSparse(work, width, height, 0, 0, 256, 256, key[0], key[1], key[2], key[3]), width * height);
});

// ---------------------------------------------------------------------------------------------
// Canvas fixture with real pixel stores, row-wise copies and exports that keep the pixels they encode.
// options.store === false: canvases keep no pixels (reads return blank images) so size limits are cheap.
// options.hold: native encoders answer only when release() is called.
function fixture(options = {}) {
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
  // In-bounds part of a width x height rectangle; `opaqueOnly` is source-over for 0/255 alpha overlays.
  function copyRows(from, fx, fy, to, tx, ty, width, height, opaqueOnly) {
    if (!from.data.length || !to.data.length) return;
    for (let y = 0; y < height; y++) {
      if (fy + y < 0 || fy + y >= from.height || ty + y < 0 || ty + y >= to.height) continue;
      const x0 = Math.max(0, -fx, -tx), x1 = Math.min(width, from.width - fx, to.width - tx);
      if (x1 <= x0) continue;
      const source = ((fy + y) * from.width + fx + x0) * 4, target = ((ty + y) * to.width + tx + x0) * 4, length = (x1 - x0) * 4;
      if (!opaqueOnly) { to.data.set(from.data.subarray(source, source + length), target); continue; }
      for (let offset = 0; offset < length; offset += 4) if (from.data[source + offset + 3] !== 0) for (let c = 0; c < 4; c++) to.data[target + offset + c] = from.data[source + offset + c];
    }
  }
  const members = {
    getImageData(sx, sy, sw, sh) {
      const context = check(contexts, this), source = check(stores, context.canvas); log('getImageData', this, [...arguments]);
      const data = new Uint8ClampedArray(sw * sh * 4);
      copyRows(source, sx, sy, { data, width: sw, height: sh }, 0, 0, sw, sh, false);
      return new ImageData(data, sw, sh, context.colorSpace);
    },
    putImageData(image, dx, dy) {
      const context = check(contexts, this), record = check(stores, context.canvas), input = check(images, image); log('putImageData', this, [...arguments]);
      copyRows(input, 0, 0, record, dx, dy, input.width, input.height, false);
    },
    drawImage(source, ...rest) {
      const context = check(contexts, this), destination = check(stores, context.canvas), input = check(stores, source); log('drawImage', this, [source, ...rest]);
      assert.ok(rest.length === 2 || rest.length === 8, 'unsupported drawImage form');
      const crop = rest.length === 8 ? rest : [0, 0, input.width, input.height, rest[0], rest[1]];
      if (rest.length === 8) assert.ok(rest[2] === rest[6] && rest[3] === rest[7], 'drawImage must not scale');
      copyRows(input, crop[0], crop[1], destination, crop[4], crop[5], crop[2], crop[3], true);
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
  class OffscreenCanvasRenderingContext2D {
    constructor(canvas, settings = {}) { contexts.set(this, { canvas, colorSpace: settings.colorSpace || 'srgb', colorType: 'unorm8' }); }
    get canvas() { return check(contexts, this).canvas; }
    getContextAttributes() { const row = check(contexts, this); return { alpha: true, colorSpace: row.colorSpace, colorType: row.colorType }; }
    getImageData(...args) { return Reflect.apply(members.getImageData, this, args); }
    putImageData(...args) { return Reflect.apply(members.putImageData, this, args); }
    drawImage(...args) { return Reflect.apply(members.drawImage, this, args); }
  }
  const mime = type => type === 'image/jpeg' || type === 'image/webp' ? type : 'image/png';
  const encode = (store, type) => ({ pixels: store.data.slice(), type: mime(type) });
  class HTMLCanvasElement {
    constructor() { stores.set(this, { width: 0, height: 0, data: new Uint8ClampedArray(0) }); }
    get width() { return check(stores, this).width; } set width(value) { const store = check(stores, this); store.width = Number(value); allocate(store); }
    get height() { return check(stores, this).height; } set height(value) { const store = check(stores, this); store.height = Number(value); allocate(store); }
    getContext(type, settings) { const store = check(stores, this); log('getContext', this, [...arguments]); if (type !== '2d') return null; return store.context ??= new CanvasRenderingContext2D(this, settings); }
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
  const realm = { HTMLCanvasElement, CanvasRenderingContext2D, OffscreenCanvas, OffscreenCanvasRenderingContext2D, ImageData, Document, Blob, DOMException, origin, document: new Document() };
  // The production page script serializes the installer; evaluate that text with isolated intrinsics.
  const installer = vm.runInContext(`(${installCanvasCustom.toString()})`, vm.createContext({ DOMException }));
  installer(realm, [entry()]);
  // Mostly transparent: opaque and translucent lines straddling the tile edges, so only the seams cost work.
  function sparse(store) {
    const { width, height, data } = store, lines = [0, 1, TILE - 1, TILE, TILE + 1, 2 * TILE - 1, 2 * TILE, height - 1];
    const put = (x, y, alpha) => { if (x < 0 || y < 0 || x >= width || y >= height) return; const offset = (y * width + x) * 4, r = next(); data[offset] = r & 255; data[offset + 1] = r >>> 8 & 255; data[offset + 2] = r >>> 16 & 255; data[offset + 3] = alpha; };
    for (const y of lines) for (let x = 0; x < width; x++) put(x, y, y === TILE ? 120 : 255);
    for (const x of lines.map(value => value % width)) for (let y = 0; y < height; y++) put(x, y, x === TILE ? 77 : 255);
    for (let step = 0; step < Math.min(width, height); step += 7) put(step, step, 200);
  }
  // A source canvas with deterministic pixels: a kind of image(), or 'sparse' for large canvases.
  function canvas(width, height, kind, offscreen = false) {
    const element = offscreen ? new OffscreenCanvas(width, height) : new HTMLCanvasElement();
    if (!offscreen) { element.width = width; element.height = height; }
    const context = element.getContext('2d'), store = stores.get(element);
    if (options.store !== false) { if (kind === 'sparse') sparse(store); else store.data.set(image(width, height, kind)); }
    return { canvas: element, context, store, before: fingerprint(store.data), expected: () => context.getImageData(0, 0, width, height).data };
  }
  // A canvas whose context was never created through the wrapped getContext (so it is untracked).
  function untracked(width, height) {
    const element = new HTMLCanvasElement(); element.width = width; element.height = height;
    return { canvas: element, store: stores.get(element) };
  }
  // Pixels an export encoded (each export is looked up once, then forgotten to keep memory flat).
  const take = value => { const row = exported.get(value); assert.ok(row, 'unknown export'); exported.delete(value); return row.pixels; };
  const privateCanvases = () => new Set(calls.filter(row => row.name === 'getContext').map(row => row.receiver));
  return { calls, canvas, untracked, take, privateCanvases, pending: installer.__detectExpertCanvasIntrinsicsV1.pending, release() { while (held.length) held.shift()(); } };
}
const exportBlob = canvas => new Promise(resolve => canvas.toBlob(resolve));

test('production output equals the previous implementation for the session key (stable-rgb-v1 stays frozen)', async () => {
  const f = fixture(), key = sessionKey();
  for (const [width, height, kind] of [[8, 4, 'mixed'], [40, 30, 'edge'], [17, 3, 'opaque']]) {
    const source = f.canvas(width, height, kind), expected = source.store.data.slice();
    referenceProject(expected, width, height, 0, 0, false, key);
    assert.ok(same(source.context.getImageData(0, 0, width, height).data, expected), `getImageData ${width}x${height} ${kind}`);
    assert.ok(same(f.take(source.canvas.toDataURL()), expected), `toDataURL ${width}x${height} ${kind}`);
    assert.ok(same(f.take(await exportBlob(source.canvas)), expected), `toBlob ${width}x${height} ${kind}`);
    const offscreen = f.canvas(width, height, kind, true), reference = offscreen.store.data.slice();
    referenceProject(reference, width, height, 0, 0, false, key);
    assert.ok(same(f.take(await offscreen.canvas.convertToBlob()), reference), `convertToBlob ${width}x${height} ${kind}`);
    // A window at an offset hashes the global canvas coordinates.
    const window = source.context.getImageData(3, 2, 9, 2).data, whole = source.store.data.slice();
    referenceProject(whole, width, height, 0, 0, false, key);
    for (let y = 0; y < Math.min(2, height - 2); y++) for (let x = 0; x < Math.min(9, width - 3); x++) for (let c = 0; c < 4; c++) assert.equal(window[(y * 9 + x) * 4 + c], whole[((y + 2) * width + x + 3) * 4 + c]);
  }
});

test('parallel async exports of small canvases all resolve with the projected Blob instead of null from the fifth call on', async () => {
  const f = fixture();
  // Promise.all of eight thumbnail resizes, twelve parallel exports of one canvas and twelve Offscreen conversions.
  const thumbnails = Array.from({ length: 8 }, () => f.canvas(48, 48, 'mixed'));
  const blobs = await Promise.all(thumbnails.map(({ canvas }) => exportBlob(canvas)));
  blobs.forEach((value, index) => { assert.ok(value instanceof Blob, `thumbnail ${index}`); assert.ok(same(f.take(value), thumbnails[index].expected())); });
  const one = f.canvas(64, 64, 'mixed'), expected = one.expected();
  const twelve = await Promise.all(Array.from({ length: 12 }, () => exportBlob(one.canvas)));
  for (const value of twelve) { assert.ok(value instanceof Blob); assert.ok(same(f.take(value), expected)); }
  const offscreen = f.canvas(40, 40, 'mixed', true), conversions = await Promise.all(Array.from({ length: 12 }, () => offscreen.canvas.convertToBlob()));
  for (const value of conversions) { assert.ok(value instanceof Blob); assert.ok(same(f.take(value), offscreen.expected())); }
  // Twenty exports whose native encoders are all still running.
  const busy = fixture({ hold: true }), source = busy.canvas(32, 32, 'opaque'), results = [];
  for (let index = 0; index < 20; index++) source.canvas.toBlob(value => results.push(value));
  assert.equal(busy.pending.count, 20); busy.release();
  assert.equal(results.length, 20); assert.ok(results.every(value => value instanceof Blob));
  assert.equal(busy.pending.count, 0); assert.equal(busy.pending.pixels, 0); assert.equal(f.pending.count, 0);
});

test('a burst beyond the pending bounds degrades to null only for the excess and frees every slot afterwards', () => {
  const f = fixture({ hold: true }), source = f.canvas(16, 16, 'opaque'), results = [], excess = 44;
  for (let index = 0; index < MAX_PENDING + excess; index++) source.canvas.toBlob(value => results.push(value));
  assert.equal(f.pending.count, MAX_PENDING);
  f.release();
  assert.equal(results.filter(value => value === null).length, excess);
  assert.equal(results.filter(value => value instanceof Blob).length, MAX_PENDING);
  assert.equal(f.pending.count, 0); assert.equal(f.pending.pixels, 0);
  source.canvas.toBlob(value => results.push(value)); f.release(); assert.ok(results.at(-1) instanceof Blob);
  // Combined snapshots are bounded in pixels too: thirty-three 1 MP snapshots exceed the 32 MP budget.
  const large = fixture({ hold: true, store: false }), big = large.canvas(1024, 1024, 'opaque'), outcomes = [];
  for (let index = 0; index < 33; index++) big.canvas.toBlob(value => outcomes.push(value));
  assert.equal(large.pending.count, 32); assert.equal(large.pending.pixels, 32 * 1024 * 1024);
  large.release();
  assert.equal(outcomes.filter(value => value === null).length, 1); assert.equal(outcomes.filter(value => value instanceof Blob).length, 32);
});

test('tiles of a canvas wider and taller than one tile project with global coordinates and match the full-image projection', async () => {
  for (const [width, height, kind] of [[TILE + 6, TILE + 6, 'mixed'], [TILE + 6, TILE + 6, 'opaque'], [2 * TILE + 3, 5, 'mixed'], [5, 2 * TILE + 3, 'opaque'], [TILE, TILE, 'mixed'], [TILE + 1, 1, 'opaque'], [1, TILE + 1, 'edge']]) {
    const f = fixture(), source = f.canvas(width, height, kind), expected = source.expected();
    assert.ok(same(f.take(await exportBlob(source.canvas)), expected), `toBlob ${width}x${height} ${kind}`);
    assert.ok(same(f.take(source.canvas.toDataURL()), expected), `toDataURL ${width}x${height} ${kind}`);
    assert.equal(fingerprint(source.store.data), source.before, 'the visible bitmap is never modified');
    // A crop that straddles a tile seam reads the same values as the export of those pixels.
    const crop = source.context.getImageData(TILE - 3, 0, 7, Math.min(2, height)).data;
    for (let y = 0; y < Math.min(2, height); y++) for (let x = 0; x < Math.min(7, Math.max(0, width - (TILE - 3))); x++) for (let c = 0; c < 4; c++) assert.equal(crop[(y * 7 + x) * 4 + c], expected[(y * width + TILE - 3 + x) * 4 + c]);
  }
});

test('opaque-or-transparent tiles are written back in place; only translucent tiles use an overlay canvas', () => {
  const opaque = fixture(), flat = opaque.canvas(300, 200, 'opaque'); flat.canvas.toDataURL();
  assert.equal(opaque.privateCanvases().size, 2, 'source and copy only');
  assert.equal(opaque.calls.filter(row => row.name === 'putImageData').length, 1);
  const translucent = fixture(), glass = translucent.canvas(300, 200, 'mixed'); glass.canvas.toDataURL();
  assert.equal(translucent.privateCanvases().size, 3, 'source, copy and overlay');
  const empty = fixture(), blank = empty.canvas(2 * TILE + 5, TILE + 5, 'transparent'); blank.canvas.toDataURL();
  assert.equal(empty.calls.filter(row => row.name === 'putImageData').length, 0, 'tiles without opaque pixels are not rewritten');
  assert.equal(empty.calls.filter(row => row.name === 'drawImage').length, 1, 'only the source is drawn');
  assert.equal(empty.calls.filter(row => row.name === 'getImageData' && row.receiver !== blank.context).length, 6, 'three tile columns by two tile rows');
});

test('canvases above the former 4 MP limit are projected by every covered API and match the tiled projection', async () => {
  for (const [width, height] of [[2100, 2100], [3840, 2160], [4000, 3000]]) {
    const f = fixture(), source = f.canvas(width, height, 'sparse'), expected = source.expected(), offscreen = f.canvas(width, height, 'sparse', true);
    assert.equal(expected.length, width * height * 4, `getImageData of the whole ${width}x${height} canvas is projected`);
    assert.ok(same(f.take(source.canvas.toDataURL()), expected), `toDataURL ${width}x${height}`);
    assert.ok(same(f.take(await exportBlob(source.canvas)), expected), `toBlob ${width}x${height}`);
    assert.ok(same(f.take(await offscreen.canvas.convertToBlob()), offscreen.expected()), `convertToBlob ${width}x${height}`);
    assert.equal(fingerprint(source.store.data), source.before, 'the visible bitmap is never modified');
    const tiles = Math.ceil(width / TILE) * Math.ceil(height / TILE), reads = f.calls.filter(row => row.name === 'getImageData' && row.receiver !== source.context && row.receiver !== offscreen.context);
    assert.equal(reads.length, 3 * tiles, 'a bounded number of tile reads per export');
    assert.ok(reads.every(row => row.args[2] <= TILE && row.args[3] <= TILE));
  }
});

test('an untracked canvas is exported only while it is blank, checked tile by tile', async () => {
  const f = fixture(), width = 2 * TILE + 8, height = 6, blank = f.untracked(width, height), dirty = f.untracked(width, height);
  assert.ok(same(f.take(blank.canvas.toDataURL()), blank.store.data), 'a blank untouched canvas has nothing to protect');
  // Content from a context this realm never saw sits in the last tile: still denied, never native.
  dirty.store.data[((height - 1) * width + width - 1) * 4 + 3] = 255;
  assert.throws(() => dirty.canvas.toDataURL(), error => error.name === 'SecurityError');
  assert.equal(await exportBlob(dirty.canvas), null);
  assert.equal(f.pending.count, 0);
});

test('the 16 MP limit is exact: the largest canvas is projected, one pixel more is denied and never returned natively', async () => {
  const exact = fixture(), top = exact.canvas(4096, 4096, 'sparse'), expected = top.expected();
  assert.ok(same(exact.take(top.canvas.toDataURL()), expected));
  const over = fixture({ store: false }), huge = over.canvas(MAX_PIXELS + 1, 1, 'transparent');
  assert.throws(() => huge.canvas.toDataURL(), error => error.name === 'SecurityError');
  assert.throws(() => huge.context.getImageData(0, 0, MAX_PIXELS + 1, 1), error => error.name === 'SecurityError');
  assert.equal(await exportBlob(huge.canvas), null);
  await assert.rejects(over.canvas(MAX_PIXELS + 1, 1, 'transparent', true).canvas.convertToBlob(), error => error.name === 'SecurityError');
  const wide = fixture({ store: false }), twenty = wide.canvas(5000, 4000, 'transparent');
  assert.throws(() => twenty.canvas.toDataURL(), error => error.name === 'SecurityError');
  assert.equal(await exportBlob(twenty.canvas), null);
  assert.equal(over.pending.count, 0); assert.equal(wide.pending.count, 0);
});
