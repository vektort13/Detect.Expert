// ADR-107: WebGL readPixels of the default framebuffer returns exactly what the Canvas projection returns for the same pixels.
// Reference = the production Canvas installer (getImageData of a 2D canvas of the same size holding the same pixels); subject = the
// serialized production surfaces installer over a synthetic drawing buffer that returns rows bottom-up like a real framebuffer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { glRealm, canvasReference, flipRows, pixels, rng, CANVAS_KEY, WEBGL_KEY, TOP } from './webgl-readback-kit.mjs';
import { sparseExpected, sessionKey } from './canvas-sparse-kit.mjs';

const canvasRow = algorithm => ({ id: 'canvas-readback', mode: 'custom', value: { algorithm }, canvasSeed: CANVAS_KEY });
const glRow = (extra = {}) => ({ id: 'webgl-readback', mode: 'custom', value: { seed: '00112233445566778899aabbccddeeff' }, webglKey: WEBGL_KEY, ...extra });
const shared = algorithm => [canvasRow(algorithm), glRow({ canvasKey: CANVAS_KEY })];
const same = (left, right) => Buffer.from(left.buffer, left.byteOffset, left.byteLength).equals(Buffer.from(right.buffer, right.byteOffset, right.byteLength));
const denied = (run, source) => assert.throws(() => run(source), error => error.name === 'SecurityError');
// Sizes on both sides of every sparse-rgb-v1 zone boundary (65,536 and 262,144 pixels) plus odd shapes whose cells wrap rows.
const SIZES = [[1, 1], [3, 2], [7, 5], [16, 16], [255, 257], [256, 256], [300, 300], [512, 512], [513, 512], [640, 480]];

test('full readPixels equals the Canvas projection of the same pixels for both algorithms and every sparse zone', () => {
  for (const algorithm of ['sparse-rgb-v1', 'stable-rgb-v1']) {
    const run = glRealm(shared(algorithm)), reference = canvasReference({ algorithm });
    for (const [width, height] of SIZES) {
      if (algorithm === 'stable-rgb-v1' && width * height > 100000) continue;
      const source = pixels(width, height, 'mixed', width), expected = reference(source, width, height);
      const actual = flipRows(run.read(source, width, height), width, height);
      assert.ok(same(actual, expected), `${algorithm} ${width}x${height}`);
      // The projection changed something real and never touched alpha or a non-opaque pixel.
      let moved = 0, opaque = 0;
      for (let at = 0; at < source.length; at += 4) {
        assert.equal(actual[at + 3], source[at + 3]);
        const delta = [0, 1, 2].map(channel => actual[at + channel] - source[at + channel]);
        if (source[at + 3] !== 255) assert.deepEqual(delta, [0, 0, 0], 'non-opaque pixels stay native');
        else { opaque++; if (delta.some(value => value)) moved++; }
        assert.ok(delta.every(value => Math.abs(value) <= 1));
      }
      // Up to 512x512 every opaque pixel moves (sparse) and stable moves every opaque pixel; larger sparse canvases about 1%.
      if (algorithm === 'stable-rgb-v1' || width * height <= 262144) assert.equal(moved, opaque, `${algorithm} ${width}x${height} every opaque pixel moved`);
      else assert.ok(moved > opaque * 0.005 && moved < opaque * 0.02, `${algorithm} ${width}x${height} moved ${moved} of ${opaque}`);
    }
  }
});

test('sparse-rgb-v1 readPixels equals the independent oracle of canvas-sparse-kit.mjs (zones, lanes, runs)', () => {
  const run = glRealm(shared('sparse-rgb-v1')), key = sessionKey(CANVAS_KEY, TOP);
  for (const [width, height] of [[220, 30], [256, 256], [257, 256], [512, 512], [700, 500]]) {
    const source = pixels(width, height, 'mixed', 3), expected = sparseExpected(source, width, height, key).data;
    assert.ok(same(flipRows(run.read(source, width, height), width, height), Uint8Array.from(expected)), `${width}x${height}`);
  }
  // Small and medium canvases move every opaque pixel (220x30 holds 'Hello, world!'-sized text): none stays native.
  const flat = pixels(220, 30, 'flat'), read = flipRows(run.read(flat, 220, 30), 220, 30);
  for (let at = 0; at < flat.length; at += 4) assert.notDeepEqual([...read.subarray(at, at + 3)], [...flat.subarray(at, at + 3)], 'pixel ' + at / 4);
});

test('any rectangle agrees with the whole read; WebGL2 PACK row length, skips, alignment and destination offset address the same pixels', () => {
  for (const algorithm of ['sparse-rgb-v1', 'stable-rgb-v1']) {
    const run = glRealm(shared(algorithm)), reference = canvasReference({ algorithm }), next = rng(7);
    for (const [width, height] of [[37, 23], [300, 260]]) {
      const source = pixels(width, height, 'mixed', 9), whole = reference(source, width, height);
      for (let index = 0; index < 24; index++) {
        const w = 1 + next() % width, h = 1 + next() % height, x = next() % (width - w + 1), y = next() % (height - h + 1);
        const actual = flipRows(run.read(source, width, height, [x, y, w, h]), w, h), expected = reference(source, width, height, x, height - y - h, w, h);
        assert.ok(same(actual, expected), `${algorithm} ${width}x${height} rect ${[x, y, w, h]}`);
        assert.ok(same(expected, cropRows(whole, width, x, height - y - h, w, h)));
      }
      // WebGL2 with every PACK parameter and a destination offset: the addressed bytes equal the plain read, the rest stays 51.
      const pack = { rowLength: 9, skipRows: 2, skipPixels: 3, alignment: 8 }, offset = 5, [x, y, w, h] = [2, 3, 6, 4];
      const bytes = run.read(source, width, height, [x, y, w, h], { webgl2: true, pack, offset, extra: 7 });
      const plain = run.read(source, width, height, [x, y, w, h]), stride = Math.ceil(9 * 4 / 8) * 8, start = offset + 2 * stride + 3 * 4;
      const addressed = new Set();
      for (let row = 0; row < h; row++) for (let column = 0; column < w * 4; column++) {
        addressed.add(start + row * stride + column); assert.equal(bytes[start + row * stride + column], plain[row * w * 4 + column]);
      }
      bytes.forEach((value, at) => { if (!addressed.has(at)) assert.equal(value, 51, 'byte ' + at + ' outside the addressed pixels'); });
    }
  }
});
function cropRows(data, width, x, y, w, h) { const out = new Uint8Array(w * h * 4); for (let row = 0; row < h; row++) out.set(data.subarray(((y + row) * width + x) * 4, ((y + row) * width + x + w) * 4), row * w * 4); return out; }

test('OffscreenCanvas-backed contexts and WebGL2 agree with the Canvas projection too', () => {
  const run = glRealm(shared('sparse-rgb-v1')), reference = canvasReference(), source = pixels(64, 40, 'mixed', 5), expected = reference(source, 64, 40);
  assert.ok(same(flipRows(run.read(source, 64, 40, [0, 0, 64, 40], { canvasKind: 'offscreen' }), 64, 40), expected));
  assert.ok(same(flipRows(run.read(source, 64, 40, [0, 0, 64, 40], { webgl2: true }), 64, 40), expected));
});

test('keys: shared mode uses the Canvas key and algorithm, webgl-readback alone its private key with sparse-rgb-v1', () => {
  const source = pixels(48, 48, 'opaque', 2);
  const sharedRead = flipRows(glRealm(shared('sparse-rgb-v1')).read(source, 48, 48), 48, 48);
  const aloneRead = flipRows(glRealm([glRow()]).read(source, 48, 48), 48, 48);
  assert.ok(same(sharedRead, canvasReference({ seed: CANVAS_KEY })(source, 48, 48)));
  assert.ok(same(aloneRead, canvasReference({ seed: WEBGL_KEY })(source, 48, 48)), 'alone: same algorithm keyed by the WebGL key');
  assert.ok(!same(sharedRead, aloneRead));
  // A canvas-readback row in the list without canvasKey on the WebGL row (older registration) keeps the WebGL key.
  assert.ok(same(flipRows(glRealm([canvasRow('stable-rgb-v1'), glRow()]).read(source, 48, 48), 48, 48), aloneRead));
  // The portable value seed plays no part: another value seed, same private key, same bytes.
  assert.ok(same(flipRows(glRealm([{ ...glRow(), value: { seed: 'ffffffffffffffffffffffffffffffff' } }]).read(source, 48, 48), 48, 48), aloneRead));
  assert.ok(!same(flipRows(glRealm([glRow({ webglKey: 'ab'.repeat(32) })]).read(source, 48, 48), 48, 48), aloneRead));
});

test('scope: frames are keyed by the top-level site and opaque documents by their origin string, exactly like the Canvas runtime', () => {
  const source = pixels(32, 20, 'mixed', 4);
  const read = (origin, chain) => flipRows(glRealm(shared('sparse-rgb-v1'), { origin, chain }).read(source, 32, 20), 32, 20);
  const expect = (origin, chain) => canvasReference({ origin, chain })(source, 32, 20);
  for (const [origin, chain] of [[TOP, null], [TOP, []], ['https://tracker.example', ['https://a.example', TOP]], ['null', [TOP]], ['null', null], ['https://tracker.example', ['null']], ['https://tracker.example', [7]]]) {
    assert.ok(same(read(origin, chain), expect(origin, chain)), JSON.stringify([origin, chain]));
  }
  assert.ok(same(read('https://tracker.example', ['https://a.example', TOP]), read(TOP, null)), 'a frame reads like its top');
  assert.ok(!same(read('https://tracker.example', ['https://other.example']), read(TOP, null)), 'one frame origin under two tops');
});

test('fail closed before the native call: no usable key, algorithm, origin, canvas size or cell range', () => {
  const read = 'globalThis.out = new Uint8Array(64).fill(51); makeContext(false, 4, 4, "none").readPixels(0, 0, 4, 4, 6408, 5121, out)';
  const cases = [
    ['canvas key without a canvas-readback row', [glRow({ canvasKey: CANVAS_KEY })]],
    ['unknown canvas algorithm', [{ ...canvasRow('sparse-rgb-v1'), value: { algorithm: 'other' } }, glRow({ canvasKey: CANVAS_KEY })]],
    ['two canvas rows', [canvasRow('sparse-rgb-v1'), canvasRow('stable-rgb-v1'), glRow({ canvasKey: CANVAS_KEY })]],
    ['short canvas key', [canvasRow('sparse-rgb-v1'), glRow({ canvasKey: CANVAS_KEY.slice(1) })]],
    ['upper-case WebGL key', [glRow({ webglKey: WEBGL_KEY.toUpperCase() })]],
    ['missing WebGL key', [{ id: 'webgl-readback', mode: 'custom', value: { seed: '00112233445566778899aabbccddeeff' } }]],
  ];
  for (const [label, entries] of cases) {
    const run = glRealm(entries); run('sources.none = new Uint8Array(64).fill(200)');
    denied(run, read); assert.equal(run('calls.read'), 0, label); assert.equal(run('out.every(value => value === 51)'), true, label);
    assert.ok(run('guard.snapshot().entries[guard.snapshot().entries.length - 1].unavailable') >= 2, label + ': counted at install and per call');
  }
  for (const [label, origin] of [['no origin', null], ['empty origin', ''], ['oversized origin', 'x'.repeat(2049)]]) {
    const run = glRealm(shared('sparse-rgb-v1'), { origin }); run('sources.none = new Uint8Array(64).fill(200)');
    denied(run, read); assert.equal(run('calls.read'), 0, label);
  }
  // Canvas-shared keying needs the canvas: a clamped drawing buffer or a context without the canvas getter is denied.
  const source = pixels(8, 8);
  const clamped = glRealm(shared('sparse-rgb-v1'));
  assert.throws(() => clamped.read(source, 8, 8, [0, 0, 8, 8], { canvasSize: { width: 16, height: 8 } }), error => error.name === 'SecurityError');
  assert.throws(() => clamped.read(source, 8, 8, [0, 0, 8, 8], { canvasKind: 'none' }), error => error.name === 'SecurityError');
  assert.throws(() => glRealm(shared('sparse-rgb-v1'), { noCanvasGetter: true }).read(source, 8, 8), error => error.name === 'SecurityError');
  assert.equal(clamped('calls.read'), 0);
  // WebGL alone does not need the canvas (keyed by the drawing buffer), but sparse cells stay within 2^30 pixels.
  assert.equal(glRealm([glRow()], { noCanvasGetter: true }).read(source, 8, 8).length, 256);
  const huge = glRealm([glRow()]); huge('sources.huge = new Uint8Array(16).fill(255); globalThis.big = makeContext(false, 65536, 16385, "huge", "none")');
  denied(huge, 'big.readPixels(0, 0, 1, 1, 6408, 5121, new Uint8Array(4))'); assert.equal(huge('calls.read'), 0);
});

test('the original runs once with the original receiver and arguments except the private destination; errors are not swallowed', () => {
  const run = glRealm(shared('sparse-rgb-v1'));
  run('sources.s = new Uint8Array(16 * 16 * 4).fill(255); globalThis.gl = makeContext(false, 16, 16, "s");');
  assert.equal(run('globalThis.out = new Uint8Array(16); gl.readPixels(0, 0, 2, 2, 6408, 5121, out); calls.read'), 1);
  assert.equal(run('lastCall.receiver === gl && lastCall.args.length === 7 && lastCall.args[6] !== out && lastCall.args.slice(0, 6).join() === "0,0,2,2,6408,5121"'), true);
  assert.equal(run('calls.error'), 0, 'no getError consumed');
  // A white 16x16 buffer: every pixel has exactly one channel reflected to 254, alpha stays 255.
  assert.equal(run('[0, 4, 8, 12].every(at => out[at + 3] === 255 && [0, 1, 2].filter(channel => out[at + channel] === 254).length === 1 && [0, 1, 2].every(channel => out[at + channel] >= 254))'), true);
  assert.throws(() => run('WebGLRenderingContext.prototype.readPixels.call({}, 0, 0, 1, 1, 6408, 5121, new Uint8Array(4))'), error => error.name === 'TypeError');
});
