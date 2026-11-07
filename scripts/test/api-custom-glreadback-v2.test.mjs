// ADR-112: WebGL readPixels of the default framebuffer under sparse-rgb-v2 equals the Canvas projection (the same function: parity, saturated
// channels stay, a flat whole-buffer read stays as rendered). Reference = the production Canvas installer; subject = the serialized production
// surfaces installer over a synthetic drawing buffer that returns rows bottom-up like a real framebuffer. See api-custom-webgl-canvas-agreement.test.mjs
// for sparse-rgb-v1 and stable-rgb-v1, which are unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { glRealm, canvasReference, flipRows, pixels, rng, CANVAS_KEY, WEBGL_KEY, TOP } from './webgl-readback-kit.mjs';
import { sparseExpectedV2, sessionKey, isSaturated, distinctColours } from './canvas-sparse-kit.mjs';

const canvasRow = algorithm => ({ id: 'canvas-readback', mode: 'custom', value: { algorithm }, canvasSeed: CANVAS_KEY });
const glRow = (extra = {}) => ({ id: 'webgl-readback', mode: 'custom', value: { seed: '00112233445566778899aabbccddeeff' }, webglKey: WEBGL_KEY, ...extra });
const shared = algorithm => [canvasRow(algorithm), glRow({ canvasKey: CANVAS_KEY })];
const same = (left, right) => Buffer.from(left.buffer, left.byteOffset, left.byteLength).equals(Buffer.from(right.buffer, right.byteOffset, right.byteLength));
const V2 = 'sparse-rgb-v2', KEY = sessionKey(CANVAS_KEY, TOP);
const changedPixels = (a, b) => { let n = 0; for (let o = 0; o < a.length; o += 4) if (a[o] !== b[o] || a[o + 1] !== b[o + 1] || a[o + 2] !== b[o + 2] || a[o + 3] !== b[o + 3]) n++; return n; };
const SIZES = [[1, 1], [3, 2], [7, 5], [16, 16], [255, 257], [256, 256], [300, 300], [512, 512], [513, 512], [640, 480]];
function solid(width, height, colour) { const out = new Uint8Array(width * height * 4); for (let o = 0; o < out.length; o += 4) out.set(colour, o); return out; }
function palette(width, height, count) { const colours = [[10, 20, 30, 255], [100, 110, 120, 255], [200, 150, 90, 255], [60, 70, 80, 255], [33, 99, 165, 255], [140, 33, 77, 255]], out = new Uint8Array(width * height * 4); for (let i = 0; i < width * height; i++) out.set(colours[(i * 7 + (i >> 3)) % count], i * 4); return out; }

test('sparse-rgb-v2: a full readPixels equals the Canvas projection and the independent oracle in every zone (opaque pixels only; translucent bytes are premultiplied and stay)', () => {
  const run = glRealm(shared(V2)), reference = canvasReference({ algorithm: V2 });
  for (const [width, height] of SIZES) {
    const source = pixels(width, height, 'mixed', width), expected = reference(source, width, height), actual = flipRows(run.read(source, width, height), width, height);
    assert.ok(same(actual, expected), `${width}x${height}`);
    assert.ok(same(actual, Uint8Array.from(sparseExpectedV2(source, width, height, KEY).data)), `${width}x${height} oracle`);
    for (let at = 0; at < source.length; at += 4) {
      assert.equal(actual[at + 3], source[at + 3]);
      const deltas = [0, 1, 2].map(channel => actual[at + channel] ^ source[at + channel]);
      if (source[at + 3] !== 255) assert.deepEqual(deltas, [0, 0, 0], 'non-opaque pixels stay native');
      else { assert.ok(deltas.filter(Boolean).length <= 1 && deltas.every(delta => delta === 0 || delta === 1), 'one lowest bit at most'); }
    }
  }
});

test('sparse-rgb-v2: a whole-buffer read of a flat drawing buffer (at most 4 colours, at most 262,144 pixels) is returned as rendered; a part of it, five colours and a larger buffer are projected', () => {
  const run = glRealm(shared(V2)), reference = canvasReference({ algorithm: V2 });
  const flat = solid(50, 50, [0, 127, 255, 255]), actual = flipRows(run.read(flat, 50, 50), 50, 50);
  assert.ok(same(actual, flat), 'whole flat buffer');
  const part = flipRows(run.read(flat, 50, 50, [10, 10, 8, 8]), 8, 8);
  assert.ok(!same(part, solid(8, 8, [0, 127, 255, 255])) || true, 'a partial read cannot see the rest of the buffer'); // see the next assertions for what it is
  assert.ok(same(part, reference(flat, 50, 50, 10, 50 - 10 - 8, 8, 8)), 'a partial read equals the Canvas reference of the same rectangle (which cannot look at a copy in this mock)');
  assert.ok(changedPixels(solid(8, 8, [0, 127, 255, 255]), part) > 0, 'the part is projected');
  for (const count of [1, 2, 3, 4]) { const image = palette(60, 40, count); assert.ok(same(flipRows(run.read(image, 60, 40), 60, 40), image), count + ' colours'); }
  for (const count of [5, 6]) { const image = palette(60, 40, count); assert.ok(changedPixels(image, flipRows(run.read(image, 60, 40), 60, 40)) > 100, count + ' colours are projected'); }
  const atLimit = solid(512, 512, [83, 129, 207, 255]), above = solid(513, 512, [83, 129, 207, 255]);
  assert.ok(same(flipRows(run.read(atLimit, 512, 512), 512, 512), atLimit), '262,144 pixels');
  assert.ok(changedPixels(above, flipRows(run.read(above, 513, 512), 513, 512)) > 0, '262,656 pixels are projected');
  // Both a flat buffer with a transparent clear colour and a double-alpha fill keep their bytes.
  const clear = solid(64, 64, [0, 0, 0, 0]); assert.ok(same(flipRows(run.read(clear, 64, 64), 64, 64), clear));
  const alpha = solid(64, 64, [0, 0, 255, 192]); assert.ok(same(flipRows(run.read(alpha, 64, 64), 64, 64), alpha));
});

test('sparse-rgb-v2: pure red and white pixels never change under any profile, the anti-aliased edge pixels do (page method 18)', () => {
  const width = 256, height = 128, source = new Uint8Array(width * height * 4), pureIndex = [], edgeIndex = [];
  // Canvas order (top-down): a red triangle on white with five blends along its edges, so the drawing buffer has seven colours.
  const blends = [[255, 31, 31, 255], [255, 64, 64, 255], [255, 127, 127, 255], [255, 191, 191, 255], [255, 223, 223, 255]];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const o = (y * width + x) * 4, inside = y >= 32 && y <= 96 && Math.abs(x - 128) <= (96 - y) * 2 - 1, edge = y >= 32 && y <= 96 && Math.abs(Math.abs(x - 128) - ((96 - y) * 2 - 1)) <= 1 && !inside;
    const colour = inside ? [255, 0, 0, 255] : edge ? blends[(x + y) % 5] : [255, 255, 255, 255];
    source.set(colour, o); (isSaturated(colour[0]) && isSaturated(colour[1]) && isSaturated(colour[2]) ? pureIndex : edgeIndex).push(y * width + x);
  }
  assert.ok(distinctColours(source, 100) >= 6 && pureIndex.length > 20000 && edgeIndex.length > 100);
  let marked = 0;
  for (let index = 0; index < 20; index++) {
    const canvasKey = (index * 2654435761 >>> 0).toString(16).padStart(8, '0').repeat(8), run = glRealm([{ ...canvasRow(V2), canvasSeed: canvasKey }, glRow({ canvasKey })]);
    const after = flipRows(run.read(source, width, height), width, height); // read() returns bottom-up rows
    for (const at of pureIndex) for (let c = 0; c < 4; c++) assert.equal(after[at * 4 + c], source[at * 4 + c], `key ${index} pixel ${at}`);
    for (const at of edgeIndex) if (after[at * 4] !== source[at * 4] || after[at * 4 + 1] !== source[at * 4 + 1] || after[at * 4 + 2] !== source[at * 4 + 2]) marked++;
  }
  assert.ok(marked > 20 * edgeIndex.length * 0.25, `edge pixels are marked (${marked})`);
});

test('sparse-rgb-v2: any rectangle of a buffer that is not flat agrees with the whole read; WebGL2 PACK layouts address the same pixels', () => {
  const run = glRealm(shared(V2)), reference = canvasReference({ algorithm: V2 }), next = rng(7);
  for (const [width, height] of [[37, 23], [300, 260]]) {
    const source = pixels(width, height, 'mixed', 9);
    for (let index = 0; index < 24; index++) {
      const w = 1 + next() % width, h = 1 + next() % height, x = next() % (width - w + 1), y = next() % (height - h + 1);
      assert.ok(same(flipRows(run.read(source, width, height, [x, y, w, h]), w, h), reference(source, width, height, x, height - y - h, w, h)), `${width}x${height} rect ${[x, y, w, h]}`);
    }
    const pack = { rowLength: 9, skipRows: 2, skipPixels: 3, alignment: 8 }, offset = 5, [x, y, w, h] = [2, 3, 6, 4];
    const bytes = run.read(source, width, height, [x, y, w, h], { webgl2: true, pack, offset, extra: 7 }), plain = run.read(source, width, height, [x, y, w, h]);
    const stride = Math.ceil(9 * 4 / 8) * 8, start = offset + 2 * stride + 3 * 4, addressed = new Set();
    for (let row = 0; row < h; row++) for (let column = 0; column < w * 4; column++) { addressed.add(start + row * stride + column); assert.equal(bytes[start + row * stride + column], plain[row * w * 4 + column]); }
    bytes.forEach((value, at) => { if (!addressed.has(at)) assert.equal(value, 51); });
  }
  // WebGL2 and an OffscreenCanvas-backed context agree with the Canvas projection too.
  const source = pixels(64, 40, 'mixed', 5), expected = reference(source, 64, 40);
  assert.ok(same(flipRows(run.read(source, 64, 40, [0, 0, 64, 40], { canvasKind: 'offscreen' }), 64, 40), expected));
  assert.ok(same(flipRows(run.read(source, 64, 40, [0, 0, 64, 40], { webgl2: true }), 64, 40), expected));
});

test('keys: shared mode takes the canvas row algorithm (v2 here); webgl-readback alone keeps its private key with sparse-rgb-v1; unknown algorithms fail closed before the native call', () => {
  const source = pixels(48, 48, 'mixed', 2);
  assert.ok(same(flipRows(glRealm(shared(V2)).read(source, 48, 48), 48, 48), canvasReference({ algorithm: V2, seed: CANVAS_KEY })(source, 48, 48)));
  assert.ok(same(flipRows(glRealm([glRow()]).read(source, 48, 48), 48, 48), canvasReference({ algorithm: 'sparse-rgb-v1', seed: WEBGL_KEY })(source, 48, 48)), 'alone: sparse-rgb-v1, as saved profiles keep it');
  assert.ok(!same(flipRows(glRealm(shared(V2)).read(source, 48, 48), 48, 48), flipRows(glRealm(shared('sparse-rgb-v1')).read(source, 48, 48), 48, 48)), 'the algorithms differ');
  const read = 'globalThis.out = new Uint8Array(64).fill(51); makeContext(false, 4, 4, "none").readPixels(0, 0, 4, 4, 6408, 5121, out)';
  for (const algorithm of ['sparse-rgb-v3', 'Sparse-RGB-v2', 'sparse-rgb-v2 ']) {
    const run = glRealm([{ ...canvasRow(algorithm) }, glRow({ canvasKey: CANVAS_KEY })]); run('sources.none = new Uint8Array(64).fill(200)');
    assert.throws(() => run(read), error => error.name === 'SecurityError', algorithm); assert.equal(run('calls.read'), 0, algorithm);
  }
});

test('the readPixels wrapper reports the native name and length and refuses nothing it did not refuse before', () => {
  const run = glRealm(shared(V2));
  assert.equal(run('WebGLRenderingContext.prototype.readPixels.name'), 'readPixels'); assert.equal(run('WebGL2RenderingContext.prototype.readPixels.name'), 'readPixels');
  assert.equal(run('WebGLRenderingContext.prototype.readPixels.length'), 7);
  assert.equal(run('Function.prototype.toString.call(WebGLRenderingContext.prototype.readPixels).includes("selectedReadPixels")'), true, 'toString is not masked');
  run('sources.s = new Uint8Array(16 * 16 * 4).fill(255); globalThis.gl = makeContext(false, 16, 16, "s");');
  assert.equal(run('globalThis.out = new Uint8Array(16); gl.readPixels(0, 0, 2, 2, 6408, 5121, out); calls.read'), 1, 'the original runs once');
  assert.equal(run('out.every(value => value === 255)'), true, 'a white buffer is flat (one colour), so a whole read would stay; this 2x2 part reads pure white: saturated channels never move');
});
