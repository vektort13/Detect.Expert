// ADR-066 / ADR-106 / ADR-107 follow-up: translucent pixels (0 < alpha < 255) in the Canvas readback projection.
// A canvas stores a channel premultiplied (a "state" q <= alpha); getImageData, the PNG encoder and putImageData convert with engine specific
// arithmetic, so a translucent pixel is marked by moving to a neighbouring STATE and taking a byte the engine itself returns for it. The
// header of api-custom-canvas-runtime.js is the specification; canvas-translucent-kit.mjs holds the MEASURED engine models (Skia CPU and GPU,
// Moz2D 138/153 and the upstream source) and an independent oracle written with loops where production uses closed forms.
// scripts/test/canvas-translucent-native.mjs re-measures real browsers against the same kit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installCanvasCustom } from '../../apps/production-extension/api-custom-canvas-runtime.js';
import { canvasRealm, makeImage, sessionKey, sparseExpected, stableExpected, sameBytes, sha1, crop, rng, SEED } from './canvas-sparse-kit.mjs';
import { ENGINES, FAMILIES, REACH, reachable, oracleNearby, storePixel, readPixel } from './canvas-translucent-kit.mjs';

// The kernel, read from the installer's existing cache like canvas-siphash-oracle.test.mjs does.
installCanvasCustom({}, [{ id: 'canvas-readback', mode: 'custom', value: { algorithm: 'sparse-rgb-v1' }, canvasSeed: SEED }]);
const I = installCanvasCustom.__detectExpertCanvasIntrinsicsV1;
const KEY = sessionKey();
const NAMES = Object.keys(ENGINES), ALGORITHMS = ['sparse-rgb-v1', 'stable-rgb-v1'];
const expected = (algorithm, pixels, width, height, family) => algorithm === 'sparse-rgb-v1' ? sparseExpected(pixels, width, height, KEY, family).data : stableExpected(pixels, width, height, KEY, family);
// Every alpha 0..255 (row) x every value 0..255 (column): R = value, G = value + 85, B = value + 170. 256 x 256 = 65,536 pixels, the
// largest "small" canvas, so every pixel is a candidate of sparse-rgb-v1.
function grid() {
  const data = new Uint8ClampedArray(256 * 256 * 4);
  for (let a = 0; a < 256; a++) for (let v = 0; v < 256; v++) { const o = (a * 256 + v) * 4; data[o] = v; data[o + 1] = (v + 85) & 255; data[o + 2] = (v + 170) & 255; data[o + 3] = a; }
  return data;
}
const alphaOf = (pixels, pixel) => pixels[pixel * 4 + 3];

// ---------------------------------------------------------------------------------------------
// Regression: everything that is not translucent is byte for byte what it was. Recorded from the implementation that existed BEFORE
// translucent marking (the kit's opaque / extremes / gradient / flat / cutout images only contain alpha 0 and 255), read and PNG export.
// ---------------------------------------------------------------------------------------------
const GOLDEN = {
  'sparse-rgb-v1': [
    [1, 1, 'extremes', '4f55e09102b39727b0eb6e163d3a300a65873a8c', '4f55e09102b39727b0eb6e163d3a300a65873a8c'],
    [8, 4, 'opaque', '56371285c13b7c5a3d5f21cf6102986c4e2f93b1', '56371285c13b7c5a3d5f21cf6102986c4e2f93b1'],
    [33, 17, 'cutout', '379683fe88dd6cc1a87a694ce2878f46c4e95af9', '379683fe88dd6cc1a87a694ce2878f46c4e95af9'],
    [40, 30, 'extremes', '7c029be16da161d8b5aba52eec008946913e14c4', '7c029be16da161d8b5aba52eec008946913e14c4'],
    [64, 48, 'gradient', '7aae6c559c2516e8500c2a18f8fc7bda6dc2aa24', '7aae6c559c2516e8500c2a18f8fc7bda6dc2aa24'],
    [257, 256, 'flat', '17e54268a7c09bb1d311d49846eff6224425e397', '17e54268a7c09bb1d311d49846eff6224425e397'],
    [300, 150, 'cutout', '17deb00d8e86f2af311bf129fdfe97332e748956', '17deb00d8e86f2af311bf129fdfe97332e748956'],
    [400, 300, 'opaque', '0c078914d953300e9f099b2ac6491853d1d52e63', '0c078914d953300e9f099b2ac6491853d1d52e63'],
    [512, 512, 'cutout', 'e6adc996106ba14059ce86530d72705ba732058a', 'e6adc996106ba14059ce86530d72705ba732058a'],
    [700, 400, 'opaque', 'e2a3df231ba8940716940692179e75c1cbed20bf', 'e2a3df231ba8940716940692179e75c1cbed20bf'],
    [1030, 600, 'flat', 'c2b6a96dcf413815500e9a45736cdc8981f32f8d', 'c2b6a96dcf413815500e9a45736cdc8981f32f8d'],
    [1100, 3, 'cutout', '39feab03ec7ddd80c528883ca143f2a3a2ab2b90', '39feab03ec7ddd80c528883ca143f2a3a2ab2b90'],
  ],
  'stable-rgb-v1': [
    [1, 1, 'extremes', '0f3844f2b2b9d5f6b08481bc620270117782e408', '0f3844f2b2b9d5f6b08481bc620270117782e408'],
    [8, 4, 'opaque', 'ed5874cb0d318eb084cc11ba78f71e3d3c61845c', 'ed5874cb0d318eb084cc11ba78f71e3d3c61845c'],
    [33, 17, 'cutout', 'f68cd066581c98e4bded26762c569cf909c21dac', 'f68cd066581c98e4bded26762c569cf909c21dac'],
    [40, 30, 'extremes', '5b6ae5511612adae2d9f435d59057a9445f7339e', '5b6ae5511612adae2d9f435d59057a9445f7339e'],
    [64, 48, 'gradient', 'c7696bf26cf4ddb11e2b21ca325568593b0c06f8', 'c7696bf26cf4ddb11e2b21ca325568593b0c06f8'],
    [257, 256, 'flat', 'cbd97ff4548a1dc70ce0a3fdd408d039b6af43df', 'cbd97ff4548a1dc70ce0a3fdd408d039b6af43df'],
    [300, 150, 'cutout', 'e0b69ece7d4e4d461f88769e417d07f4e3b816b7', 'e0b69ece7d4e4d461f88769e417d07f4e3b816b7'],
    [400, 300, 'opaque', 'c0aa9a0ea38786a410ef4c7a18cc1a6dfff2cc07', 'c0aa9a0ea38786a410ef4c7a18cc1a6dfff2cc07'],
    [512, 512, 'cutout', 'fa42f9c32deb9f407b7fca3913de8fecb73de1c2', 'fa42f9c32deb9f407b7fca3913de8fecb73de1c2'],
    [700, 400, 'opaque', 'f276b1bb75b9a8da848a9be6a568d3999aedfe61', 'f276b1bb75b9a8da848a9be6a568d3999aedfe61'],
    [1030, 600, 'flat', '5f62af5dcf4e28a9d237382ce36947d47a595959', '5f62af5dcf4e28a9d237382ce36947d47a595959'],
    [1100, 3, 'cutout', 'd3472f883b7e9856a62948516845a00eee240d21', 'd3472f883b7e9856a62948516845a00eee240d21'],
  ],
};
test('opaque and transparent output is byte for byte what it was before translucent marking, in an unknown engine and under every engine model', async () => {
  let cases = 0;
  for (const engine of [undefined, ...NAMES]) for (const algorithm of ALGORITHMS) {
    const f = canvasRealm({ algorithm, engine });
    for (const [width, height, kind, read, url] of GOLDEN[algorithm]) {
      const source = f.canvas(width, height, kind);
      assert.equal(sha1(source.read()), read, `${engine ?? 'unknown'} ${algorithm} getImageData ${width}x${height} ${kind}`);
      assert.equal(sha1(f.take(source.canvas.toDataURL())), url, `${engine ?? 'unknown'} ${algorithm} toDataURL ${width}x${height} ${kind}`); cases += 2;
    }
  }
  assert.equal(cases, 5 * 2 * 12 * 2);
});

// ---------------------------------------------------------------------------------------------
// The rule for one channel, exhaustively: all 254 translucent alphas x 256 values x 2 directions x 2 families
// ---------------------------------------------------------------------------------------------
test('nearbyValue equals the independent oracle for all 254 x 256 x 2 inputs of both families', () => {
  let cases = 0;
  for (const family of [1, 2]) for (let a = 1; a <= 254; a++) for (let v = 0; v < 256; v++) for (const up of [0, 1]) {
    assert.equal(I.nearbyValue(v, a, up, family), oracleNearby(v, a, up, family), `family ${family} alpha ${a} value ${v} up ${up}`); cases++;
  }
  assert.equal(cases, 2 * 254 * 256 * 2);
});

test('every value the rule returns is one every measured arithmetic of the family returns, is a valid stored state and survives putImageData', () => {
  for (const family of [1, 2]) {
    let marked = 0, inputs = 0;
    for (let a = 1; a <= 254; a++) {
      const engines = FAMILIES[family].map(name => ENGINES[name]), gets = engines.map(engine => reachable(engine, a, 'get')), native = new Set(gets.flatMap(set => [...set]));
      for (let v = 0; v < 256; v++) for (const up of [0, 1]) {
        const w = I.nearbyValue(v, a, up, family);
        if (native.has(v)) inputs++;
        if (w < 0) continue;
        if (native.has(v)) marked++;
        assert.ok(Number.isInteger(w) && w >= 0 && w <= 255 && w !== v, `family ${family} alpha ${a} value ${v}: ${w}`);
        for (const [index, engine] of engines.entries()) {
          assert.ok(gets[index].has(w), `${engine.name} alpha ${a}: ${w} (from ${v}) is not a value the engine returns`);
          assert.ok(engine.premul(w, a) <= a, `${engine.name} alpha ${a}: ${w} is no valid premultiplied state`);
          assert.equal(engine.get(engine.premul(w, a), a), w, `${engine.name} alpha ${a}: ${w} does not survive putImageData then getImageData`);
        }
      }
    }
    const share = marked / inputs;
    assert.ok(share > (family === 1 ? 0.999 : 0.85), `family ${family}: ${(share * 100).toFixed(2)}% of the readable values move`);
  }
});

test('the models are consistent: putImageData of a native readback stores the same state (the tile write-back is lossless)', () => {
  for (const engine of Object.values(ENGINES)) for (let a = 1; a <= 254; a++) for (let q = 0; q <= a; q++) {
    const v = engine.get(q, a);
    assert.equal(engine.premul(v, a), q, `${engine.name} alpha ${a} state ${q} reads ${v}`);
  }
});

test('a move never leaves the neighbourhood of the state: at most 2 states (Skia) or 3 states (Moz2D) away, and values that no state explains stay', () => {
  for (const family of [1, 2]) for (let a = 1; a <= 254; a++) for (const name of FAMILIES[family]) {
    const engine = ENGINES[name];
    for (let q = 0; q <= a; q++) for (const up of [0, 1]) {
      const v = engine.get(q, a), w = I.nearbyValue(v, a, up, family);
      if (w < 0) continue;
      const states = []; for (let t = 0; t <= a; t++) if (engine.get(t, a) === w) states.push(t);
      assert.ok(states.some(t => Math.abs(t - q) <= REACH[family] + 1), `${name} alpha ${a}: ${v} (state ${q}) moved to ${w}`);
    }
  }
  // 255 q / a rounds to a byte for every q; a byte between two such values is no readback of this arithmetic and is left alone
  assert.equal(I.nearbyValue(1, 10, 1, 1), -1); assert.equal(I.nearbyValue(1, 10, 1, 2), -1); assert.equal(I.nearbyValue(200, 10, 0, 1), -1);
});

// ---------------------------------------------------------------------------------------------
// Through the canvas wrappers, all 65,536 (alpha, value) pairs at once, for every engine model and both algorithms
// ---------------------------------------------------------------------------------------------
test('getImageData of the full alpha x value grid equals the oracle: opaque as before, translucent moved one state, transparent and alpha untouched', () => {
  const data = grid();
  for (const name of NAMES) for (const algorithm of ALGORITHMS) {
    const engine = ENGINES[name], f = canvasRealm({ algorithm, engine: name }), source = f.canvas(256, 256, data), read = source.read();
    assert.ok(sameBytes(read, expected(algorithm, source.pixels, 256, 256, engine.family)), `${name} ${algorithm}`);
    assert.equal(sha1(f.stores.get(source.canvas).data), source.before, 'the stored bitmap is never modified');
    let moved = 0, translucent = 0;
    for (let pixel = 0; pixel < 65536; pixel++) {
      const a = alphaOf(source.pixels, pixel), o = pixel * 4;
      assert.equal(read[o + 3], a, 'alpha is never touched');
      if (a === 0) assert.deepEqual([...read.slice(o, o + 3)], [0, 0, 0]);
      if (a > 0 && a < 255) {
        translucent++;
        for (let c = 0; c < 3; c++) if (read[o + c] !== source.pixels[o + c]) { moved++; assert.ok(engine.premul(read[o + c], a) <= a); }
      }
    }
    if (algorithm === 'stable-rgb-v1') assert.ok(moved > translucent * 3 * (engine.family === 1 ? 0.99 : 0.8), `${name}: ${moved} of ${translucent * 3} translucent channels moved`);
    else assert.ok(moved > translucent * (engine.family === 1 ? 0.99 : 0.85) - 1, `${name}: ${moved} of ${translucent} translucent pixels moved one channel`);
  }
});

test('toDataURL, toBlob and convertToBlob of the grid decode to the PNG a native canvas holding the marked bytes would give; Skia agrees with getImageData', async () => {
  const data = grid();
  for (const name of NAMES) for (const algorithm of ALGORITHMS) {
    const engine = ENGINES[name], f = canvasRealm({ algorithm, engine: name }), source = f.canvas(256, 256, data), off = f.canvas(256, 256, data, true), read = source.read();
    const want = new Uint8ClampedArray(read.length);
    for (let o = 0; o < read.length; o += 4) { storePixel(engine, read, o, want); readPixel(engine, want, o, 'png'); }
    const url = f.take(source.canvas.toDataURL()), blob = f.take(await f.exportBlob(source.canvas)), converted = f.take(await off.canvas.convertToBlob());
    assert.ok(sameBytes(url, want), `${name} ${algorithm} toDataURL`); assert.ok(sameBytes(blob, want), `${name} ${algorithm} toBlob`); assert.ok(sameBytes(converted, want), `${name} ${algorithm} convertToBlob`);
    assert.equal(sha1(f.stores.get(source.canvas).data), source.before, 'the visible bitmap is never modified');
    if (engine.family === 1) {
      // Skia's encoder reads the state like getImageData does. A marked byte is never at an exact half, so there the two agree in the GPU
      // model too; an unmarked byte may differ only where the GPU and CPU arithmetic differ natively (an exact-half state).
      let marked = 0;
      for (let o = 0; o < read.length; o++) if (read[o] !== source.pixels[o]) { marked++; assert.equal(url[o], read[o], `${name} ${algorithm}: marked byte ${o} differs between getImageData and the PNG`); }
      assert.ok(marked > 40000, `${name} ${algorithm}: ${marked} marked bytes`);
      if (name === 'skia-cpu') assert.ok(sameBytes(url, read), 'the CPU encoder and getImageData agree on every byte');
    }
    assert.equal(f.pending.count, 0); assert.equal(f.pending.pixels, 0);
  }
});

test('drawing the exported PNG back and reading it natively gives the marked bytes in Skia, and what a native pixel of those bytes gives in Moz2D', async () => {
  const data = grid();
  for (const name of NAMES) for (const algorithm of ALGORITHMS) {
    const engine = ENGINES[name], f = canvasRealm({ algorithm, engine: name }), source = f.canvas(256, 256, data), read = source.read();
    const decoded = f.take(source.canvas.toDataURL());
    const native = canvasRealm({ engine: name, entries: [] }), again = native.canvas(256, 256, decoded);   // no Custom entry: a native canvas
    if (engine.family === 1) assert.ok(sameBytes(again.pixels, read), `${name} ${algorithm}: the redrawn PNG reads differently from getImageData`);
    else {
      // Moz2D's PNG encoder and its getImageData differ natively; the relation of the marked bytes is the relation of any native pixel
      const model = new Uint8ClampedArray(read.length);
      for (let o = 0; o < read.length; o += 4) { storePixel(engine, read, o, model); readPixel(engine, model, o, 'png'); storePixel(engine, model, o, model); readPixel(engine, model, o, 'get'); }
      assert.ok(sameBytes(again.pixels, model), `${name} ${algorithm}`);
    }
  }
});

test('where translucent pixels are marked the export writes whole tiles back; without a known engine it still composites the opaque ones over an overlay', () => {
  const known = canvasRealm({ engine: 'skia-cpu' }), glass = known.canvas(300, 200, 'mixed'); glass.canvas.toDataURL();
  assert.equal(known.privateCanvases().size, 2, 'source and copy only, no overlay canvas');
  const unknown = canvasRealm(), plain = unknown.canvas(300, 200, 'mixed'); plain.canvas.toDataURL();
  assert.equal(unknown.privateCanvases().size, 3, 'source, copy and overlay');
});

// ---------------------------------------------------------------------------------------------
// The sidestep that motivated this: a drawing copied at globalAlpha 0.99
// ---------------------------------------------------------------------------------------------
test('a drawing copied at globalAlpha 0.99 (alpha 252 everywhere) is marked in both engine families, for both algorithms, and stays native in an unknown engine', () => {
  const width = 240, height = 60, copy = makeImage(width, height, 'opaque'); for (let o = 3; o < copy.length; o += 4) copy[o] = 252;
  for (const algorithm of ALGORITHMS) {
    for (const name of NAMES) {
      const f = canvasRealm({ algorithm, engine: name }), source = f.canvas(width, height, copy), read = source.read();
      let moved = 0; for (let o = 0; o < read.length; o += 4) if (read[o] !== source.pixels[o] || read[o + 1] !== source.pixels[o + 1] || read[o + 2] !== source.pixels[o + 2]) moved++;
      assert.ok(moved > width * height * 0.95, `${name} ${algorithm}: ${moved} of ${width * height} pixels are marked`);
      assert.ok(sameBytes(read, expected(algorithm, source.pixels, width, height, ENGINES[name].family)));
    }
    // an engine the arithmetic was not measured for keeps the old behaviour: the copy reads back natively (this is not marked, on purpose)
    const unknown = canvasRealm({ algorithm }), native = unknown.canvas(width, height, copy);
    assert.ok(sameBytes(native.read(), copy), `${algorithm}: unknown engine`);
  }
});

test('a translucent canvas is keyed like an opaque one: another seed or site moves other pixels, the same key moves the same', () => {
  const glass = makeImage(300, 150, 'mixed');
  for (const name of ['skia-cpu', 'moz2d-old']) {
    const reads = [{}, { seed: 'a'.repeat(64) }, { origin: 'https://other.test' }, {}].map(options => canvasRealm({ engine: name, ...options }).canvas(300, 150, glass).read());
    assert.ok(sameBytes(reads[0], reads[3]), 'the same key reads the same bytes'); assert.ok(!sameBytes(reads[0], reads[1])); assert.ok(!sameBytes(reads[0], reads[2]));
    const native = canvasRealm({ engine: name }).canvas(300, 150, glass).pixels;
    for (const read of reads) { let translucent = 0; for (let o = 0; o < read.length; o += 4) if (native[o + 3] > 0 && native[o + 3] < 255 && (read[o] !== native[o] || read[o + 1] !== native[o + 1] || read[o + 2] !== native[o + 2])) translucent++; assert.ok(translucent > 1000, `${name}: ${translucent} translucent pixels moved`); }
  }
});

test('an ImageData in another colour space than the canvas is not a readback of a stored state: translucent pixels stay, opaque ones still move', () => {
  for (const name of ['skia-cpu', 'moz2d-old']) {
    const f = canvasRealm({ engine: name }), source = f.canvas(100, 70, 'mixed'), converted = source.context.getImageData(0, 0, 100, 70, { colorSpace: 'display-p3' }).data, plain = source.read();
    let translucent = 0, opaqueMoved = 0, translucentMovedPlain = 0;
    for (let o = 0; o < converted.length; o += 4) {
      const alpha = source.pixels[o + 3], differs = converted[o] !== source.pixels[o] || converted[o + 1] !== source.pixels[o + 1] || converted[o + 2] !== source.pixels[o + 2];
      if (alpha > 0 && alpha < 255) { translucent++; assert.ok(!differs, `${name}: a converted translucent pixel moved`); if (plain[o] !== source.pixels[o] || plain[o + 1] !== source.pixels[o + 1] || plain[o + 2] !== source.pixels[o + 2]) translucentMovedPlain++; }
      else if (alpha === 255 && differs) opaqueMoved++;
    }
    assert.ok(translucent > 1000 && opaqueMoved > 1000 && translucentMovedPlain > 500, `${name}: ${translucent} translucent, ${opaqueMoved} opaque moved, ${translucentMovedPlain} translucent moved in the canvas's own space`);
  }
});

test('a WebGL canvas export moves its translucent pixels exactly like a 2D canvas holding the same pixels (page check: canvas export vs its drawImage mirror)', () => {
  for (const name of ['skia-cpu', 'moz2d-old']) {
    const engine = ENGINES[name], f = canvasRealm({ engine: name }), gl = f.webgl(120, 80, 'mixed'), two = f.canvas(120, 80, 'mixed');
    // the native export of the stored state: what the engine writes for the unmodified canvas
    const nativeExport = new Uint8ClampedArray(gl.store.data.length); for (let o = 0; o < nativeExport.length; o += 4) { nativeExport.set(gl.store.data.subarray(o, o + 4), o); readPixel(engine, nativeExport, o, 'png'); }
    const exported = f.take(gl.canvas.toDataURL()), marked = f.take(two.canvas.toDataURL());
    assert.ok(sameBytes(exported, marked), `${name}: the WebGL export equals the export of a 2D canvas with the same pixels`);
    let opaqueMoved = 0, translucentMoved = 0;
    for (let o = 0; o < exported.length; o += 4) {
      const alpha = exported[o + 3];
      if (alpha === 255) { if (exported[o] !== nativeExport[o] || exported[o + 1] !== nativeExport[o + 1] || exported[o + 2] !== nativeExport[o + 2]) opaqueMoved++; }
      else if (alpha > 0) for (let c = 0; c < 3; c++) if (exported[o + c] !== nativeExport[o + c]) { translucentMoved++; break; }
    }
    assert.ok(opaqueMoved > 500, `${name}: ${opaqueMoved} opaque pixels of the WebGL export are projected`); assert.ok(translucentMoved > 1000, `${name}: ${translucentMoved} translucent pixels of the WebGL export are marked`);
  }
  // a browser whose WebGL context has no drawingBufferColorSpace getter is a WebGL canvas all the same
  const bare = canvasRealm({ engine: 'skia-cpu', prepare: realm => { delete realm.WebGLRenderingContext.prototype.drawingBufferColorSpace; } }), glBare = bare.webgl(120, 80, 'mixed'), twoBare = bare.canvas(120, 80, 'mixed');
  assert.ok(sameBytes(bare.take(glBare.canvas.toDataURL()), bare.take(twoBare.canvas.toDataURL())), 'the WebGL export equals the 2D export without the colour-space getter too');
});

// ---------------------------------------------------------------------------------------------
// Which engine family: vendor members only
// ---------------------------------------------------------------------------------------------
test('the engine family comes from vendor members of the realm (each alone is enough), never from navigator values', () => {
  const cases = [
    ['Chromium window: webkitRequestAnimationFrame', realm => { realm.webkitRequestAnimationFrame = () => 0; }, true],
    ['Chromium Worker: webkitRequestFileSystem', realm => { realm.webkitRequestFileSystem = () => 0; }, true],
    ['Chromium: Navigator.prototype.webkitTemporaryStorage', realm => { realm.Navigator = class Navigator { get webkitTemporaryStorage() { return 0; } }; }, true],
    ['Firefox window: mozInnerScreenX', realm => { realm.mozInnerScreenX = 0; }, true],
    ['Firefox: HTMLCanvasElement.prototype.mozOpaque', realm => { Object.defineProperty(realm.HTMLCanvasElement.prototype, 'mozOpaque', { get() { return false; }, configurable: true }); }, true],
    ['Firefox Worker: SpiderMonkey Error#fileName', realm => { realm.Error = function Error() { this.fileName = 'worker.js'; }; }, true],
    ['a V8 Error object (stack, no fileName) is not Firefox', realm => { realm.Error = function Error() { this.stack = 'Error'; }; }, false],
    ['navigator values and window.chrome alone prove nothing', realm => { realm.navigator = { userAgent: 'Mozilla/5.0 Chrome/156 Firefox/150', vendor: 'Google Inc.', buildID: '20260101' }; realm.chrome = {}; }, false],
    ['no vendor member', () => {}, false],
  ];
  for (const [name, prepare, marked] of cases) {
    const f = canvasRealm({ prepare }), source = f.canvas(100, 70, 'mixed'), read = source.read();
    let moved = 0; for (let o = 0; o < read.length; o += 4) if (source.pixels[o + 3] > 0 && source.pixels[o + 3] < 255 && (read[o] !== source.pixels[o] || read[o + 1] !== source.pixels[o + 1] || read[o + 2] !== source.pixels[o + 2])) moved++;
    if (marked) assert.ok(moved > 100, `${name}: ${moved} translucent pixels moved`); else assert.equal(moved, 0, `${name}: translucent pixels must stay native`);
  }
});

// ---------------------------------------------------------------------------------------------
// Rectangles, zones and tiles
// ---------------------------------------------------------------------------------------------
test('any rectangle of a translucent canvas equals the crop of the whole-canvas oracle, in all three sparse zones and for stable-rgb-v1', () => {
  const next = rng(0x7a15); let count = 0;
  for (const name of ['skia-gpu', 'moz2d-new']) for (const algorithm of ALGORITHMS) for (const [width, height, kind] of [[7, 3, 'mixed'], [100, 70, 'edge'], [300, 150, 'mixed'], [700, 400, 'mixed']]) {
    if (algorithm === 'stable-rgb-v1' && width * height > 70000) continue;
    const engine = ENGINES[name], f = canvasRealm({ algorithm, engine: name }), source = f.canvas(width, height, kind), whole = expected(algorithm, source.pixels, width, height, engine.family);
    for (let i = 0; i < 40; i++) {
      const w = 1 + next() % Math.min(width + 6, 90), h = 1 + next() % Math.min(height + 6, 45), x = next() % (width + 12) - 6, y = next() % (height + 12) - 6;
      assert.ok(sameBytes(source.read(x, y, w, h), crop(whole, width, height, x, y, w, h)), `${name} ${algorithm} ${width}x${height} rect ${x},${y} ${w}x${h}`);
      assert.ok(sameBytes(source.read(x + w, y + h, -w, -h), crop(whole, width, height, x, y, w, h)), `${name} ${algorithm} negative rect`); count += 2;
    }
  }
  assert.ok(count >= 600, 'rectangles ' + count);
});

test('exports of tiled translucent canvases (seams at 1024) decode to the marked bytes', async () => {
  for (const name of ['skia-cpu', 'moz2d-old']) for (const [width, height, kind] of [[1030, 300, 'mixed'], [2049, 17, 'edge'], [3, 1100, 'mixed']]) {
    const engine = ENGINES[name], f = canvasRealm({ engine: name }), source = f.canvas(width, height, kind), read = source.read(), want = new Uint8ClampedArray(read.length);
    for (let o = 0; o < read.length; o += 4) { storePixel(engine, read, o, want); readPixel(engine, want, o, 'png'); }
    assert.ok(sameBytes(f.take(source.canvas.toDataURL()), want), `${name} ${width}x${height} toDataURL`);
    assert.ok(sameBytes(f.take(await f.exportBlob(source.canvas)), want), `${name} ${width}x${height} toBlob`);
    assert.ok(sameBytes(read, expected('sparse-rgb-v1', source.pixels, width, height, engine.family)), `${name} ${width}x${height} getImageData`);
  }
});

// ---------------------------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------------------------
function best(run, rounds = 5) { run(); run(); let fastest = Infinity; for (let i = 0; i < rounds; i++) { const start = performance.now(); run(); fastest = Math.min(fastest, performance.now() - start); } return fastest; }
test('cost: marking every translucent pixel of a 512x512 canvas stays within a small factor of the opaque read, in both algorithms', t => {
  for (const algorithm of ALGORITHMS) {
    const opaque = canvasRealm({ algorithm, engine: 'skia-cpu' }).canvas(512, 512, 'opaque'), glass = makeImage(512, 512, 'opaque'); for (let o = 3; o < glass.length; o += 4) glass[o] = 200;
    const translucent = canvasRealm({ algorithm, engine: 'skia-cpu' }).canvas(512, 512, glass);
    const fast = best(() => opaque.read()), slow = best(() => translucent.read());
    t.diagnostic(`${algorithm} 512x512 getImageData: opaque ${fast.toFixed(1)} ms, alpha 200 ${slow.toFixed(1)} ms (${(slow / fast).toFixed(1)}x)`);
    assert.ok(slow < fast * 8 + 50, `${algorithm}: ${slow.toFixed(1)} ms against ${fast.toFixed(1)} ms`);
  }
});
