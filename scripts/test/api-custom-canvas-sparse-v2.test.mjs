// ADR-112: the sparse-rgb-v2 canvas readback projection. Expected values come from the independent oracle sparseExpectedV2 in
// canvas-sparse-kit.mjs (BigInt SipHash, loops over the stored states), written from the specification in the header of
// api-custom-canvas-runtime.js, not from the production kernel. sparse-rgb-v1 and stable-rgb-v1 are pinned by api-custom-canvas-sparse.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  canvasRealm, makeImage, sparseGeometry, sparseExpected, sparseExpectedV2, isFlat, distinctColours, isSaturated, sessionKey, crop, sameBytes, sha1, rng,
  SEED, ORIGIN, TILE, DENSE_LIMIT, FLAT_COLOURS,
} from './canvas-sparse-kit.mjs';

const V2 = { algorithm: 'sparse-rgb-v2' }, KEY = sessionKey(), OTHER_SEED = 'a'.repeat(64);
const changed = (a, b) => { let count = 0; for (let o = 0; o < a.length; o += 4) if (a[o] !== b[o] || a[o + 1] !== b[o + 1] || a[o + 2] !== b[o + 2] || a[o + 3] !== b[o + 3]) count++; return count; };
// A palette canvas: `count` distinct opaque colours spread over the canvas, none of them saturated, so the saturation rule cannot hide a move.
const PALETTE = [[10, 20, 30, 255], [100, 110, 120, 255], [200, 150, 90, 255], [60, 70, 80, 255], [33, 99, 165, 255], [140, 33, 77, 255]];
function palette(width, height, count, colours = PALETTE) { const out = new Uint8ClampedArray(width * height * 4); for (let index = 0; index < width * height; index++) out.set(colours[(index * 7 + (index >> 3)) % count], index * 4); return out; }
function solid(width, height, colour) { const out = new Uint8ClampedArray(width * height * 4); for (let o = 0; o < out.length; o += 4) out.set(colour, o); return out; }
const withFamily = engine => ({ 'skia-cpu': 1, 'skia-gpu': 1, 'moz2d-old': 2, 'moz2d-new': 2 })[engine] ?? 0;

// ---------------------------------------------------------------------------------------------
// The exact function
// ---------------------------------------------------------------------------------------------
test('sparse-rgb-v2 equals the independent oracle for whole-canvas reads in all three zones and four pixel kinds (an engine whose conversions were not measured)', () => {
  let cases = 0; const zones = new Set();
  for (const [width, height] of [[1, 1], [8, 4], [40, 30], [220, 70], [256, 256], [300, 300], [512, 512], [700, 500], [1030, 3], [3, 1100]]) for (const kind of ['opaque', 'mixed', 'edge', 'extremes']) {
    const f = canvasRealm(V2), source = f.canvas(width, height, kind), expected = sparseExpectedV2(source.pixels, width, height, KEY);
    assert.ok(sameBytes(source.read(), expected.data), `${width}x${height} ${kind}`); zones.add(expected.geometry.zone); cases++;
    assert.equal(sha1(f.stores.get(source.canvas).data), source.before, 'the source bitmap is never modified');
  }
  assert.ok(cases >= 40); assert.deepEqual([...zones].sort(), ['large', 'medium', 'small']);
});

test('with measured engines translucent pixels follow the oracle too (Skia: stored-state parity of q +- 1; Moz2D: q +- 1 and q +- 3)', () => {
  for (const engine of ['skia-cpu', 'skia-gpu', 'moz2d-old', 'moz2d-new']) for (const [width, height, kind] of [[220, 70, 'mixed'], [64, 64, 'edge'], [300, 200, 'mixed']]) {
    const f = canvasRealm({ ...V2, engine }), source = f.canvas(width, height, kind), expected = sparseExpectedV2(source.pixels, width, height, KEY, withFamily(engine));
    assert.ok(sameBytes(source.read(), expected.data), `${engine} ${width}x${height} ${kind}`);
    assert.ok(changed(source.pixels, expected.data) > width * height * 0.15, `${engine}: the oracle itself moves translucent and opaque pixels`);
  }
});

test('an opaque pixel changes in exactly one channel by exactly one level, only by flipping the lowest bit of a channel that is not 0, 1, 254 or 255; alpha never changes', () => {
  for (const [width, height, kind, salt] of [[300, 150, 'mixed', 1], [301, 151, 'edge', 2], [64, 64, 'mixed', 3], [400, 300, 'edge', 6], [1030, 400, 'mixed', 4]]) {
    const f = canvasRealm(V2), source = f.canvas(width, height, makeImage(width, height, kind, salt)), after = source.read();
    let moved = 0;
    for (let pixel = 0; pixel < width * height; pixel++) {
      const o = pixel * 4; assert.equal(after[o + 3], source.pixels[o + 3], 'alpha is never touched');
      const deltas = [0, 1, 2].filter(c => after[o + c] !== source.pixels[o + c]);
      if (source.pixels[o + 3] !== 255) { assert.deepEqual(deltas, [], 'an unmeasured engine leaves translucent and transparent pixels native'); continue; }
      assert.ok(deltas.length <= 1, 'at most one channel');
      if (deltas.length) { const c = deltas[0]; assert.equal(after[o + c] ^ source.pixels[o + c], 1, 'the lowest bit flips'); assert.ok(!isSaturated(source.pixels[o + c]), 'a saturated channel never moves'); moved++; }
    }
    assert.ok(moved > 0);
  }
});

test('the keyed bit is a target parity: about half of the candidates already carry it, and a 0/255-only canvas of five colours does not move at all', () => {
  const f = canvasRealm(V2), source = f.canvas(256, 256, 'opaque'), moved = changed(source.pixels, source.read()), opaque = 256 * 256;
  assert.ok(moved > opaque * 0.45 && moved < opaque * 0.55, `about half of the pixels change (${moved} of ${opaque})`);
  // Five colours that are saturated in every channel: each pixel keeps its exact value (the red triangle on white of the anti-spoof pages).
  const pure = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 255, 255], [0, 0, 0, 255], [254, 1, 255, 255]];
  const image = palette(120, 80, 6, pure); assert.equal(distinctColours(image, 100), 6);
  assert.equal(changed(image, canvasRealm(V2).canvas(120, 80, image).read()), 0, 'saturated colours are never marked');
});

test('the channel order on a saturated keyed channel: R, G, B, R; a pixel with three saturated channels stays; every other channel flips its lowest bit', () => {
  // A canvas that is not flat (six colours) where every pixel has one or two saturated channels.
  const colours = [[255, 128, 128, 255], [0, 0, 77, 255], [10, 255, 255, 255], [254, 200, 1, 255], [1, 1, 100, 255], [127, 254, 33, 255]];
  for (const seed of [SEED, OTHER_SEED, 'b'.repeat(64)]) {
    const f = canvasRealm({ ...V2, seed }), image = palette(80, 60, 6, colours), after = f.canvas(80, 60, image).read(), expected = sparseExpectedV2(image, 80, 60, sessionKey(seed));
    assert.ok(sameBytes(after, expected.data), seed.slice(0, 4));
    for (let pixel = 0; pixel < 80 * 60; pixel++) for (let c = 0; c < 3; c++) if (isSaturated(image[pixel * 4 + c])) assert.equal(after[pixel * 4 + c], image[pixel * 4 + c], 'a saturated channel keeps its value');
    assert.ok(changed(image, after) > 80 * 60 * 0.3);
  }
});

test('stored profiles do not change: v1 and stable-rgb-v1 still move the flat canvas, pure colours and every parity (the v2 rules are not applied to them)', () => {
  const flat = solid(50, 50, [83, 129, 207, 255]);
  assert.equal(changed(flat, canvasRealm().canvas(50, 50, flat).read()), 2500, 'sparse-rgb-v1 moves a flat canvas');
  assert.equal(changed(flat, canvasRealm({ algorithm: 'stable-rgb-v1' }).canvas(50, 50, flat).read()), 2500, 'stable-rgb-v1 moves a flat canvas');
  const pure = palette(60, 40, 6, [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 255, 255], [0, 0, 0, 255], [254, 1, 255, 255]]);
  assert.equal(changed(pure, canvasRealm().canvas(60, 40, pure).read()), 60 * 40, 'sparse-rgb-v1 moves pure colours (0 -> 1, 255 -> 254)');
  assert.ok(sameBytes(canvasRealm().canvas(60, 40, pure).read(), sparseExpected(pure, 60, 40, KEY).data));
});

// ---------------------------------------------------------------------------------------------
// Idempotence: a projected image read back again does not move (page methods 9 and 20)
// ---------------------------------------------------------------------------------------------
test('v2 is idempotent: getImageData, toDataURL and toBlob of a canvas that holds a projected image give that image back (Skia exactly)', async () => {
  for (const engine of ['skia-cpu', 'skia-gpu']) for (const [width, height, kind] of [[220, 70, 'opaque'], [220, 70, 'mixed'], [64, 64, 'gradient'], [300, 200, 'mixed'], [700, 400, 'opaque']]) {
    const f = canvasRealm({ ...V2, engine }), base = f.canvas(width, height, kind), first = base.read();
    assert.equal(changed(first, f.canvas(width, height, first).read()), 0, `${engine} ${width}x${height} ${kind}: read of the projected pixels`);
    for (const exported of [f.take(base.canvas.toDataURL()), f.take(await f.exportBlob(base.canvas))]) {
      assert.equal(changed(first, f.canvas(width, height, exported).read()), 0, `${engine} ${width}x${height} ${kind}: decode round trip`);
      assert.ok(sameBytes(exported, first) || kind !== 'opaque' || engine !== 'skia-cpu', 'the export of an opaque canvas is its read');
    }
  }
});

test('v2 round trips in Firefox: opaque pixels are exact in both Moz2D models; translucent ones keep a measured residual (documented in ADR-112)', () => {
  for (const [engine, limit] of [['moz2d-new', 0.001], ['moz2d-old', 0.2]]) {
    let differing = 0, total = 0;
    for (const [width, height, kind] of [[220, 70, 'opaque'], [220, 70, 'mixed'], [300, 200, 'mixed']]) {
      const f = canvasRealm({ ...V2, engine }), base = f.canvas(width, height, kind), first = base.read(), again = f.canvas(width, height, f.take(base.canvas.toDataURL())).read();
      if (kind === 'opaque') assert.equal(changed(first, again), 0, `${engine} opaque`); else { differing += changed(first, again); total += width * height; }
    }
    assert.ok(differing / total < limit, `${engine}: ${differing} of ${total} translucent-canvas pixels differ after a decode round trip`);
  }
});

test('the defect that v2 removes: sparse-rgb-v1 moves the same channel again on every pass, so a decode round trip changes nine tenths of the pixels', async () => {
  const f = canvasRealm({ engine: 'skia-cpu' }), base = f.canvas(220, 70, 'opaque'), first = base.read();
  assert.ok(changed(first, f.canvas(220, 70, f.take(base.canvas.toDataURL())).read()) > 220 * 70 * 0.9);
});

// ---------------------------------------------------------------------------------------------
// Flat canvases stay as drawn (page methods 7, 11, 25)
// ---------------------------------------------------------------------------------------------
test('a flat canvas is returned as drawn by every read path: whole, tile, one pixel, toDataURL, toBlob and convertToBlob; five colours are projected', async () => {
  const flat = solid(50, 50, [0, 127, 255, 255]), f = canvasRealm(V2), source = f.canvas(50, 50, flat);
  assert.ok(sameBytes(source.read(), flat), 'whole');
  assert.ok(sameBytes(source.read(10, 10, 8, 8), crop(flat, 50, 50, 10, 10, 8, 8)), 'tile (decided on the whole canvas through a private copy)');
  assert.ok(sameBytes(source.read(3, 4, 1, 1), crop(flat, 50, 50, 3, 4, 1, 1)), 'one pixel');
  assert.ok(sameBytes(source.read(-5, -5, 70, 70), crop(flat, 50, 50, -5, -5, 70, 70)), 'a rectangle larger than the canvas (transparent outside)');
  assert.ok(sameBytes(f.take(source.canvas.toDataURL()), flat), 'toDataURL'); assert.ok(sameBytes(f.take(await f.exportBlob(source.canvas)), flat), 'toBlob');
  assert.ok(sameBytes(f.take(await f.canvas(50, 50, flat, true).canvas.convertToBlob()), flat), 'convertToBlob');
  assert.equal(f.pending.count, 0); assert.equal(f.pending.pixels, 0);
  for (const count of [1, 2, 3, 4]) { const image = palette(60, 40, count); assert.equal(changed(image, canvasRealm(V2).canvas(60, 40, image).read()), 0, count + ' colours'); }
  for (const count of [5, 6]) { const image = palette(60, 40, count); assert.ok(changed(image, canvasRealm(V2).canvas(60, 40, image).read()) > 100, count + ' colours are projected'); }
  assert.equal(FLAT_COLOURS, 4);
});

test('the flat limit is 262,144 pixels: a flat canvas of 512x512 stays, one pixel more is projected (a keyed 1%)', () => {
  const at = solid(512, 512, [83, 129, 207, 255]), above = solid(513, 512, [83, 129, 207, 255]);
  assert.equal(changed(at, canvasRealm(V2).canvas(512, 512, at).read()), 0, '262,144 pixels');
  const moved = changed(above, canvasRealm(V2).canvas(513, 512, above).read());
  assert.ok(moved > 0 && moved < 262656 * 0.012, `262,656 pixels: ${moved}`);
  assert.equal(isFlat(at, 512, 512), true); assert.equal(isFlat(above, 513, 512), false);
});

test('a flat translucent fill (the double-alpha probe) stays as drawn in a measured engine', () => {
  const translucent = solid(50, 50, [0, 0, 255, 192]);
  for (const engine of ['skia-cpu', 'moz2d-old']) { const g = canvasRealm({ ...V2, engine }).canvas(50, 50, translucent); assert.equal(changed(g.pixels, g.read()), 0, engine); }
});

test('a partial read decides on the whole canvas, never on its own rectangle: one different pixel of five colours projects every rectangle, a flat canvas keeps all of them', () => {
  const next = rng(11), four = palette(64, 64, 4), five = palette(64, 64, 5);
  for (const [image, flat] of [[four, true], [five, false]]) {
    const f = canvasRealm(V2), source = f.canvas(64, 64, image), whole = source.read();
    assert.equal(sameBytes(whole, image), flat);
    for (let index = 0; index < 40; index++) {
      const w = 1 + next() % 64, h = 1 + next() % 64, x = next() % (64 - w + 1), y = next() % (64 - h + 1);
      assert.ok(sameBytes(source.read(x, y, w, h), crop(whole, 64, 64, x, y, w, h)), `rect ${[x, y, w, h]} equals the crop of the whole read`);
    }
  }
});

test('the private whole-canvas looks reuse one scratch canvas, drop its pixels afterwards and stop after the pixel budget (then reads are projected)', () => {
  const flat = solid(256, 256, [83, 129, 207, 255]), f = canvasRealm(V2), source = f.canvas(256, 256, flat), before = f.privateCanvases().size;
  let exact = 0, moved = 0;
  for (let index = 0; index < 1300; index++) { const x = (index * 37) % 256, y = (index * 11) % 256, read = source.read(x, y, 1, 1); if (sameBytes(read, crop(flat, 256, 256, x, y, 1, 1))) exact++; else moved++; }
  assert.ok(f.privateCanvases().size - before <= 2, 'one scratch canvas (and its context) for all looks: ' + (f.privateCanvases().size - before));
  assert.ok(exact >= 1024, 'the first 1024 looks of a 256x256 canvas (2^26 pixels) found it flat: ' + exact);
  assert.ok(moved > 100, 'after the budget a flat-looking rectangle is projected: ' + moved);
  const scratchStore = [...f.privateCanvases()].map(canvas => f.stores.get(canvas)).filter(store => store && store.width === 1 && store.height === 1);
  assert.ok(scratchStore.length >= 1, 'the scratch canvas is shrunk to 1x1 after each look');
});

test('an export of a flat canvas does not use the translucent write-back path and releases its reservation', async () => {
  const flat = solid(120, 90, [200, 100, 50, 255]), f = canvasRealm(V2), source = f.canvas(120, 90, flat);
  f.calls.length = 0; f.take(source.canvas.toDataURL());
  assert.equal(f.calls.filter(row => row.name === 'putImageData').length, 0, 'nothing is written back');
  const blob = await f.exportBlob(source.canvas); assert.ok(blob instanceof Blob); assert.equal(f.pending.count, 0); assert.equal(f.pending.pixels, 0);
});

// ---------------------------------------------------------------------------------------------
// Rectangles, exports and the other zones (not flat)
// ---------------------------------------------------------------------------------------------
test('any rectangle of a canvas that is not flat equals the crop of the whole-canvas oracle: negative sizes, partly outside, seams', () => {
  const next = rng(0x5eed); let count = 0;
  for (const [width, height, kind] of [[7, 3, 'mixed'], [100, 70, 'mixed'], [257, 129, 'extremes'], [400, 300, 'mixed'], [1030, 1030, 'mixed'], [2049, 4, 'opaque']]) {
    const f = canvasRealm(V2), source = f.canvas(width, height, kind), expected = sparseExpectedV2(source.pixels, width, height, KEY).data;
    for (let index = 0; index < 40; index++) {
      const w = 1 + next() % Math.min(width + 6, 90), h = 1 + next() % Math.min(height + 6, 45), x = next() % (width + 12) - 6, y = next() % (height + 12) - 6;
      assert.ok(sameBytes(source.read(x, y, w, h), crop(expected, width, height, x, y, w, h)), `${width}x${height} rect ${x},${y} ${w}x${h}`);
      assert.ok(sameBytes(source.read(x + w, y + h, -w, -h), crop(expected, width, height, x, y, w, h)), `${width}x${height} negative rect`); count += 2;
    }
  }
  assert.ok(count >= 400);
});

test('toDataURL, toBlob and convertToBlob encode exactly the oracle pixels across zones, tiles and translucent overlays', async () => {
  for (const [width, height, kind] of [[100, 70, 'mixed'], [300, 150, 'opaque'], [400, 300, 'mixed'], [512, 512, 'edge'], [1030, 1030, 'mixed'], [2049, 17, 'edge'], [TILE + 1, 1, 'opaque'], [1, TILE + 1, 'edge']]) {
    const f = canvasRealm(V2), source = f.canvas(width, height, kind), offscreen = f.canvas(width, height, kind, true), expected = sparseExpectedV2(source.pixels, width, height, KEY).data;
    assert.ok(sameBytes(f.take(source.canvas.toDataURL()), expected), `toDataURL ${width}x${height} ${kind}`);
    assert.ok(sameBytes(f.take(await f.exportBlob(source.canvas)), expected), `toBlob ${width}x${height} ${kind}`);
    assert.ok(sameBytes(f.take(await offscreen.canvas.convertToBlob()), expected), `convertToBlob ${width}x${height} ${kind}`);
    assert.equal(sha1(f.stores.get(source.canvas).data), source.before, 'the visible bitmap is never modified');
    assert.equal(f.pending.count, 0); assert.equal(f.pending.pixels, 0);
  }
  // Skia reads a state back with the arithmetic its PNG encoder uses, so the PNG is the oracle; Moz2D's encoder rounds where its reads floor (see canvas-translucent-kit.mjs).
  for (const engine of ['skia-cpu', 'skia-gpu']) {
    const f = canvasRealm({ ...V2, engine }), source = f.canvas(300, 150, 'mixed'), expected = sparseExpectedV2(source.pixels, 300, 150, KEY, withFamily(engine)).data;
    assert.ok(sameBytes(f.take(source.canvas.toDataURL()), expected), `${engine}: the PNG of a mixed canvas carries the marked translucent pixels`);
  }
  { const f = canvasRealm({ ...V2, engine: 'moz2d-old' }), source = f.canvas(300, 150, 'mixed'), png = f.take(source.canvas.toDataURL()); assert.ok(changed(png, source.pixels) > 300 * 150 * 0.3, 'moz2d-old: the PNG carries marks'); }
});

test('two seeds, two sites and two canvas sizes draw independent moves; the same canvas read twice, in two installs, agrees', () => {
  const read = options => canvasRealm({ ...V2, ...options }).canvas(300, 150, 'opaque').read();
  const base = read({}); assert.ok(sameBytes(base, read({})), 'same profile, same pixels');
  for (const options of [{ seed: OTHER_SEED }, { origin: 'https://other.test' }]) assert.ok(!sameBytes(base, read(options)), JSON.stringify(options));
  const f = canvasRealm(V2), source = f.canvas(300, 150, 'mixed'); assert.ok(sameBytes(source.read(), source.read()), 'repeated reads agree');
  const a = f.canvas(120, 80, 'mixed'), same = f.canvas(120, 80, 'transparent'); same.context.drawImage(a.canvas, 0, 0);
  assert.ok(sameBytes(same.read(), a.read()), 'an equal drawing in an equal canvas reads equally (two canvases of one page agree)');
});

test('unknown algorithms still fail closed: sparse-rgb-v3 and a mistyped sparse-rgb-v2 deny every covered readback', async () => {
  for (const value of [{ algorithm: 'sparse-rgb-v3' }, { algorithm: 'Sparse-RGB-v2' }, { algorithm: 'sparse-rgb-v20' }, { algorithm: 'sparse-rgb-v2 ' }]) {
    const f = canvasRealm({ entries: [{ id: 'canvas-readback', mode: 'custom', value, canvasSeed: SEED }] }), source = f.canvas(16, 16, 'opaque');
    assert.throws(() => source.read(), error => error.name === 'SecurityError', JSON.stringify(value)); assert.throws(() => source.canvas.toDataURL(), error => error.name === 'SecurityError');
  }
  assert.throws(() => canvasRealm({ ...V2, seed: 'x'.repeat(64) }).canvas(16, 16, 'opaque').read(), error => error.name === 'SecurityError', 'an invalid seed still fails closed under v2');
});

// ---------------------------------------------------------------------------------------------
// Page method 18: a red triangle on white is never marked (numbers over many profiles)
// ---------------------------------------------------------------------------------------------
function triangle(width, height) {
  // Hard-edged red triangle on white with an anti-aliased edge: pure red and white pixels, blends along the edges.
  const out = new Uint8ClampedArray(width * height * 4), apex = width / 2, top = height * 0.2, bottom = height * 0.8, red = [255, 0, 0];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const o = (y * width + x) * 4, half = (y + 0.5 - top) * (width / 4) / (bottom - top);
    // distance of the pixel centre outside the triangle edge, in pixels; rows outside [top, bottom] are white
    const outside = y + 0.5 < top || y + 0.5 > bottom ? Infinity : Math.abs(x + 0.5 - apex) - half, coverage = outside === Infinity ? 0 : Math.max(0, Math.min(1, 0.5 - outside));
    for (let c = 0; c < 3; c++) out[o + c] = Math.round(255 * (1 - coverage) + red[c] * coverage);
    out[o + 3] = 255;
  }
  return out;
}
test('a red triangle on white (page method 18): no pixel whose three channels are 0 or 255 ever changes, whatever the profile; edge pixels still carry the mark', () => {
  const image = triangle(256, 128), pure = [], edge = [];
  for (let pixel = 0; pixel < 256 * 128; pixel++) { const o = pixel * 4; (isSaturated(image[o]) && isSaturated(image[o + 1]) && isSaturated(image[o + 2]) ? pure : edge).push(pixel); }
  assert.ok(pure.length > 5000 && edge.length > 20, `${pure.length} pure / ${edge.length} edge pixels`);
  let marked = 0;
  for (let index = 0; index < 24; index++) {
    const seed = (index * 2654435761 >>> 0).toString(16).padStart(8, '0').repeat(8), f = canvasRealm({ ...V2, seed }), after = f.canvas(256, 128, image).read();
    for (const pixel of pure) for (let c = 0; c < 4; c++) assert.equal(after[pixel * 4 + c], image[pixel * 4 + c], `seed ${index} pixel ${pixel}`);
    for (const pixel of edge) if (after[pixel * 4] !== image[pixel * 4] || after[pixel * 4 + 1] !== image[pixel * 4 + 1] || after[pixel * 4 + 2] !== image[pixel * 4 + 2]) marked++;
  }
  assert.ok(marked > 24 * edge.length * 0.25, `edge pixels are marked (${marked})`);
});

// ---------------------------------------------------------------------------------------------
// WebGL canvas exports follow the 2D rule (page method 24): the export equals the export of its 2D mirror, for all contents
// ---------------------------------------------------------------------------------------------
test('a WebGL canvas export equals the export of a 2D canvas holding the same pixels: opaque, mixed, translucent, edge, flat, with and without a measured engine', async () => {
  for (const engine of [undefined, 'skia-cpu', 'moz2d-old']) for (const algorithm of ['sparse-rgb-v2', 'sparse-rgb-v1', 'stable-rgb-v1']) for (const kind of ['opaque', 'mixed', 'edge', 'flat']) {
    const f = canvasRealm({ algorithm, ...(engine ? { engine } : {}) }), gl = f.webgl(120, 80, kind), two = f.canvas(120, 80, kind);
    const label = `${engine ?? 'unknown'} ${algorithm} ${kind}`;
    assert.ok(sameBytes(f.take(gl.canvas.toDataURL()), f.take(two.canvas.toDataURL())), label + ' toDataURL');
    assert.ok(sameBytes(f.take(await f.exportBlob(gl.canvas)), f.take(await f.exportBlob(two.canvas))), label + ' toBlob');
  }
});

// ---------------------------------------------------------------------------------------------
// The Proxy wrappers are real functions: no prototype cycle, same name and length (docs/PROJECT_RULES.md rule 3 allows copying descriptors, nothing more)
// ---------------------------------------------------------------------------------------------
test('closing a prototype cycle through a canvas wrapper throws the engine TypeError and leaves the function usable; other prototypes are forwarded', () => {
  const f = canvasRealm(V2), run = source => vm.runInContext(source, f.context);
  f.context.realm = f.realm;
  const result = run(`(() => {
    const fn = realm.HTMLCanvasElement.prototype.toDataURL, out = {}, native = Object.getPrototypeOf(fn);
    try { Object.setPrototypeOf(fn, fn); out.threw = false; } catch (error) { out.threw = error instanceof TypeError; out.message = error.message; }
    out.name = fn.name; out.length = fn.length; out.call = typeof fn.call; out.proto = Object.getPrototypeOf(fn) === native;
    out.reflect = Reflect.setPrototypeOf(fn, Object.prototype); out.afterReflect = Object.getPrototypeOf(fn) === Object.prototype;
    out.restored = Reflect.setPrototypeOf(fn, native); out.back = Object.getPrototypeOf(fn) === native;
    return out;
  })()`);
  assert.equal(result.threw, true, 'a TypeError, as for a native function'); assert.match(result.message, /cyclic|cycle/i);
  assert.equal(result.name, 'toDataURL'); assert.equal(typeof result.length, 'number'); assert.equal(result.call, 'function'); assert.equal(result.proto, true);
  assert.equal(result.reflect, true); assert.equal(result.afterReflect, true, 'other prototypes are forwarded to the wrapped function'); assert.equal(result.restored, true); assert.equal(result.back, true);
});
