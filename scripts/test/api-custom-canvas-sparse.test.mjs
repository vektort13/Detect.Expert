// ADR-066 / ADR-104 addendum 3 / ADR-107: the sparse-rgb-v1 canvas readback projection (the default until ADR-112, kept byte for byte for saved profiles) next to the frozen stable-rgb-v1.
// Expected values come from an independent oracle in canvas-sparse-kit.mjs (BigInt SipHash, written from the specification in the
// header of api-custom-canvas-runtime.js), not from the production kernel.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  canvasRealm, makeImage, sessionKey, sparseGeometry, sparseExpected, crop, sameBytes, sha1, encodePng, rng,
  SEED, ORIGIN, TILE, SMALL_LIMIT, DENSE_LIMIT, RUN_MAX,
} from './canvas-sparse-kit.mjs';

const KEY = sessionKey();
const OTHER_SEED = 'a'.repeat(64);
// Pixel indices whose bytes differ between two RGBA arrays.
function changedPixels(before, after) {
  const out = []; for (let offset = 0; offset < before.length; offset += 4) if (before[offset] !== after[offset] || before[offset + 1] !== after[offset + 1] || before[offset + 2] !== after[offset + 2] || before[offset + 3] !== after[offset + 3]) out.push(offset >>> 2);
  return out;
}
// Per pixel: which channel moved and in which direction ('' when it did not move).
const moves = (before, after) => Array.from({ length: before.length / 4 }, (_, pixel) => { for (let c = 0; c < 3; c++) { const delta = after[pixel * 4 + c] - before[pixel * 4 + c]; if (delta) return c + (delta > 0 ? '+' : '-'); } return ''; });
const opaqueCount = pixels => { let count = 0; for (let offset = 3; offset < pixels.length; offset += 4) if (pixels[offset] === 255) count++; return count; };

// ---------------------------------------------------------------------------------------------
// stable-rgb-v1 is frozen: SHA-1 of its output, recorded from the implementation that existed BEFORE sparse-rgb-v1 was added
// (kit images, SEED, ORIGIN unless stated). Any drift here changes the pixels of users who saved the older value.
// ---------------------------------------------------------------------------------------------
const STABLE_GOLDEN = [
  [8, 4, 'mixed', '31ac682ae0e3fac400b3e261ac9330cbbdff12f9'], [40, 30, 'edge', 'ef4e1edf526b40664b39203f29bdb9d57d10378a'],
  [17, 3, 'opaque', '656a465bdcfd531ef4c683a821085e3d26ffc0ad'], [64, 48, 'gradient', 'c7696bf26cf4ddb11e2b21ca325568593b0c06f8'],
  [1, 1, 'extremes', '0f3844f2b2b9d5f6b08481bc620270117782e408'], [33, 17, 'extremes', 'f09fdbc4a0b31f68f049e96cc5c7ba46b796a5bc'],
  [300, 150, 'mixed', '98b7bf011642ec5e9e1c9b8e40cbc7a135f2bc51'], [1030, 3, 'opaque', '7ea144589c17ffce9ebb55bdd0bfe3b0d7a812b8'],
  [3, 1100, 'edge', '66ffdca2c0208823a319a1f2a1fe814eaffd280e'], [257, 256, 'flat', 'cbd97ff4548a1dc70ce0a3fdd408d039b6af43df'],
];
test('stable-rgb-v1 output is byte for byte what it was before sparse-rgb-v1 existed (golden hashes of the old implementation)', async () => {
  const f = canvasRealm({ algorithm: 'stable-rgb-v1' });
  for (const [width, height, kind, hash] of STABLE_GOLDEN) {
    const source = f.canvas(width, height, kind);
    assert.equal(sha1(source.read()), hash, `getImageData ${width}x${height} ${kind}`);
    assert.equal(sha1(f.take(source.canvas.toDataURL())), hash, `toDataURL ${width}x${height} ${kind}`);
    assert.equal(sha1(f.take(await f.exportBlob(source.canvas))), hash, `toBlob ${width}x${height} ${kind}`);
  }
  assert.equal(sha1(f.canvas(40, 30, 'mixed').read(3, 2, 9, 2)), '2f60c52b6ad282bdfa596daf6d33ad1bc81d10f7', 'crop');
  assert.equal(sha1(canvasRealm({ algorithm: 'stable-rgb-v1', origin: 'https://other.test' }).canvas(40, 30, 'edge').read()), '60637d73c7cb3d69c3bb77a5d6c81a45e4d63c90', 'other origin');
  assert.equal(sha1(canvasRealm({ algorithm: 'stable-rgb-v1', seed: OTHER_SEED }).canvas(40, 30, 'edge').read()), '3f6e779c484d875c8ae6334cc2aa16fcc26f8e94', 'other seed');
});

test('the two algorithms are independent: stable moves all three channels of every opaque pixel, sparse one channel (all pixels up to 512x512, 1% above)', () => {
  const original = makeImage(64, 48, 'opaque'), stable = canvasRealm({ algorithm: 'stable-rgb-v1' }).canvas(64, 48, 'opaque').read(), sparse = canvasRealm().canvas(64, 48, 'opaque').read();
  assert.ok(!sameBytes(stable, sparse));
  for (let pixel = 0; pixel < 64 * 48; pixel++) {
    const changed = [0, 1, 2].filter(c => stable[pixel * 4 + c] !== original[pixel * 4 + c]).length, one = [0, 1, 2].filter(c => sparse[pixel * 4 + c] !== original[pixel * 4 + c]).length;
    assert.equal(changed, 3); assert.equal(one, 1);
  }
  const large = canvasRealm().canvas(700, 400, 'opaque'); assert.equal(changedPixels(large.pixels, large.read()).length, 2800, '700x400: one pixel in a hundred');
});

// ---------------------------------------------------------------------------------------------
// The exact function: whole-canvas reads equal the independent oracle for every shape that exercises a branch
// ---------------------------------------------------------------------------------------------
const SHAPES = [
  [1, 1], [2, 1], [1, 2], [3, 3], [8, 4], [15, 15], [16, 16], [255, 1], [256, 1], [1, 256], [257, 1], [40, 30], [63, 100], [80, 80], [101, 64],
  [99, 100], [300, 150], [1030, 3], [3, 1100], [2049, 2], [2, 2049], [256, 256], [1, 65536], [65537, 1], [257, 255], [400, 300], [512, 512], [513, 511],
  [600, 437], [512, 513], [640, 480], [1030, 1030], [1, 270000],
];
test('getImageData of the whole canvas equals the independent oracle for 33 shapes across the three zones and 4 pixel kinds', () => {
  let cases = 0;
  const zones = new Set();
  for (const [width, height] of SHAPES) for (const kind of (width * height > 70000 ? ['mixed'] : ['opaque', 'mixed', 'edge', 'extremes'])) {
    const f = canvasRealm(), source = f.canvas(width, height, kind), expected = sparseExpected(source.pixels, width, height, KEY); cases++; zones.add(expected.geometry.zone);
    assert.ok(sameBytes(source.read(), expected.data), `${width}x${height} ${kind}`);
    assert.equal(sha1(f.stores.get(source.canvas).data), source.before, 'the source bitmap is never modified');
  }
  assert.ok(cases >= 100, 'cases ' + cases); assert.deepEqual([...zones].sort(), ['large', 'medium', 'small']);
});

test('the zone follows the canvas size only: 65,536 pixels is small, 262,144 medium, one pixel more large', () => {
  assert.deepEqual([[256, 256], [65536, 1], [257, 255], [65537, 1], [512, 512], [262144, 1], [262145, 1], [513, 512]].map(([w, h]) => sparseGeometry(w, h).zone), ['small', 'small', 'small', 'medium', 'medium', 'medium', 'large', 'large']);
  assert.equal(SMALL_LIMIT, 65536); assert.equal(DENSE_LIMIT, 262144);
  for (const [w, h, every] of [[65536, 1, true], [65537, 1, true], [262144, 1, true], [262145, 1, false]]) {
    const source = canvasRealm().canvas(w, h, 'flat'), moved = changedPixels(source.pixels, source.read()).length;
    if (every) assert.equal(moved, w * h, `${w}x${h}: every pixel`);
    else { assert.equal(moved, sparseExpected(source.pixels, w, h, KEY).selected.length); assert.ok(moved > 2600 && moved < 2650, `${w}x${h}: about 1% (${moved})`); }
  }
});

test('toDataURL, toBlob and convertToBlob encode exactly the oracle pixels, across zones, tiles, cells that straddle rows and translucent overlays', async () => {
  for (const [width, height, kind] of [[100, 70, 'mixed'], [300, 150, 'opaque'], [400, 300, 'mixed'], [512, 512, 'edge'], [1030, 1030, 'mixed'], [2049, 17, 'edge'], [3, 2050, 'mixed'], [TILE, TILE, 'flat'], [TILE + 1, 1, 'opaque'], [1, TILE + 1, 'edge'], [40, 30, 'transparent']]) {
    const f = canvasRealm(), source = f.canvas(width, height, kind), offscreen = f.canvas(width, height, kind, true), expected = sparseExpected(source.pixels, width, height, KEY).data;
    assert.ok(sameBytes(f.take(source.canvas.toDataURL()), expected), `toDataURL ${width}x${height} ${kind}`);
    assert.ok(sameBytes(f.take(await f.exportBlob(source.canvas)), expected), `toBlob ${width}x${height} ${kind}`);
    assert.ok(sameBytes(f.take(await offscreen.canvas.convertToBlob()), expected), `convertToBlob ${width}x${height} ${kind}`);
    assert.equal(sha1(f.stores.get(source.canvas).data), source.before, 'the visible bitmap is never modified');
    assert.equal(f.pending.count, 0); assert.equal(f.pending.pixels, 0);
  }
});

// ---------------------------------------------------------------------------------------------
// Only fully opaque pixels move, one channel by one level, alpha never
// ---------------------------------------------------------------------------------------------
test('only alpha-255 pixels change, each in exactly one of R/G/B by exactly one level; alpha, translucent and transparent pixels are untouched (an engine whose conversions were not measured)', () => {
  for (const [width, height, kind, salt] of [[300, 150, 'mixed', 1], [301, 151, 'edge', 2], [64, 64, 'mixed', 3], [400, 300, 'mixed', 6], [1030, 400, 'mixed', 4], [37, 29, 'extremes', 5]]) {
    const f = canvasRealm({ seed: salt % 2 ? SEED : OTHER_SEED }), source = f.canvas(width, height, makeImage(width, height, kind, salt)), after = source.read();
    const expected = sparseExpected(source.pixels, width, height, sessionKey(salt % 2 ? SEED : OTHER_SEED)), selectedOpaque = new Set(expected.selected.filter(index => source.pixels[index * 4 + 3] === 255));
    let moved = 0;
    for (let pixel = 0; pixel < width * height; pixel++) {
      const o = pixel * 4, deltas = [0, 1, 2].map(c => after[o + c] - source.pixels[o + c]);
      assert.equal(after[o + 3], source.pixels[o + 3], 'alpha is never touched');
      if (source.pixels[o + 3] !== 255) { assert.deepEqual(deltas, [0, 0, 0], 'translucent/transparent pixel ' + pixel); continue; }
      const nonzero = deltas.filter(delta => delta !== 0);
      if (selectedOpaque.has(pixel)) { assert.equal(nonzero.length, 1, 'a selected opaque pixel always moves, in one channel'); assert.equal(Math.abs(nonzero[0]), 1); moved++; }
      else assert.deepEqual(deltas, [0, 0, 0], 'an unselected pixel never moves');
    }
    assert.equal(moved, selectedOpaque.size); assert.ok(moved > 0);
    if (width * height <= DENSE_LIMIT) assert.equal(moved, opaqueCount(source.pixels), 'up to 512x512 every opaque pixel moves');
  }
});

test('the direction is reflected at the ends: 0 becomes 1 and 255 becomes 254, whatever the drawn direction was', () => {
  let low = 0, high = 0;
  for (const seed of [SEED, OTHER_SEED, 'b'.repeat(64), '0123456789abcdeffedcba9876543210'.repeat(2)]) for (const [w, h] of [[200, 200], [700, 400]]) {
    const f = canvasRealm({ seed }), source = f.canvas(w, h, 'extremes'), after = source.read();
    for (let o = 0; o < after.length; o += 4) for (let c = 0; c < 3; c++) {
      if (after[o + c] === source.pixels[o + c]) continue;
      if (source.pixels[o + c] === 0) { assert.equal(after[o + c], 1); low++; } else { assert.equal(source.pixels[o + c], 255); assert.equal(after[o + c], 254); high++; }
    }
  }
  assert.ok(low > 5000 && high > 5000, `both ends were exercised (${low}/${high})`);
  // Clamping would hide a no-op: a flat black or white canvas moves every candidate, in each zone.
  for (const value of [0, 255]) for (const [w, h, expected] of [[100, 100, 10000], [400, 300, 120000], [700, 400, 2800]]) {
    const flat = new Uint8ClampedArray(w * h * 4).fill(value); for (let o = 3; o < flat.length; o += 4) flat[o] = 255;
    assert.equal(changedPixels(flat, canvasRealm().canvas(w, h, flat).read()).length, expected, `${w}x${h} flat at ${value}`);
  }
});

test('channels and directions are spread evenly in every zone (one draw byte per pixel, one draw per run)', () => {
  for (const [w, h, total] of [[256, 256, 65536], [512, 512, 262144], [1100, 700, 7700]]) {
    const source = canvasRealm().canvas(w, h, 'flat'), after = source.read(), tally = { R: 0, G: 0, B: 0, up: 0, down: 0 };
    for (let o = 0; o < after.length; o += 4) for (const [c, name] of [[0, 'R'], [1, 'G'], [2, 'B']]) if (after[o + c] !== source.pixels[o + c]) { tally[name]++; tally[after[o + c] > source.pixels[o + c] ? 'up' : 'down']++; }
    assert.equal(tally.R + tally.G + tally.B, total, `${w}x${h}`);
    for (const name of ['R', 'G', 'B']) assert.ok(tally[name] > total * 0.28 && tally[name] < total * 0.38, `${w}x${h} ${name} share ${tally[name] / total}`);
    assert.ok(tally.up > total * 0.42 && tally.down > total * 0.42, `${w}x${h} ` + JSON.stringify(tally));
  }
});

// ---------------------------------------------------------------------------------------------
// Density
// ---------------------------------------------------------------------------------------------
test('density: every opaque pixel up to 512x512, about 1% above (at least 1024 runs), whatever the key', () => {
  for (const [width, height] of [[1, 1], [16, 16], [257, 1], [40, 30], [300, 150], [256, 256], [400, 300], [512, 512], [600, 437], [640, 480], [1100, 700], [1030, 1030], [2560, 1440]]) {
    const total = width * height, geometry = sparseGeometry(width, height), selected = sparseExpected(makeImage(width, height, 'opaque'), width, height, KEY).selected.length;
    assert.ok(geometry.run >= 1 && geometry.run <= (total <= DENSE_LIMIT ? 16 : RUN_MAX));
    if (total <= DENSE_LIMIT) assert.equal(selected, total, `${width}x${height}: every pixel is a candidate`);
    else { assert.ok(selected >= total * 0.0099 - RUN_MAX && selected <= total * 0.0101 + RUN_MAX, `${width}x${height}: ${selected}/${total}`); assert.ok(geometry.cells >= 1024); }
    // The production kernel moves exactly the pixels of the independent selection, for several keys (a key only decides where the
    // last, partial cell's run falls, so large counts may differ by up to one run).
    for (const options of [{}, { seed: OTHER_SEED }, { origin: 'https://other.test' }]) {
      const source = canvasRealm(options).canvas(width, height, 'opaque'), expected = sparseExpected(source.pixels, width, height, sessionKey(options.seed ?? SEED, options.origin ?? ORIGIN)).selected.length;
      assert.equal(changedPixels(source.pixels, source.read()).length, expected, `${width}x${height} ${JSON.stringify(options)}`); assert.ok(Math.abs(expected - selected) <= RUN_MAX);
    }
  }
});

test('translucent and transparent pixels give no moves in an unmeasured engine: a half-opaque small canvas moves exactly its opaque pixels', () => {
  const f = canvasRealm(), source = f.canvas(300, 150, 'mixed'), moved = changedPixels(source.pixels, source.read()), opaque = opaqueCount(source.pixels);
  assert.ok(opaque > 18000 && opaque < 27000, 'the kit mixes about half opaque pixels ' + opaque);
  assert.equal(moved.length, opaque); assert.ok(moved.every(pixel => source.pixels[pixel * 4 + 3] === 255));
});

// ---------------------------------------------------------------------------------------------
// Library-shaped canvases (ADR-107): few opaque pixels on a transparent canvas are always marked, distinctly per key
// ---------------------------------------------------------------------------------------------
// Synthetic glyph-like strokes: opaque cores with an antialiased (translucent) halo, like fillText on a transparent canvas.
function strokes(width, height, opaqueCount, salt, colour = [0, 0, 0]) {
  const data = new Uint8ClampedArray(width * height * 4), next = rng(salt);
  let placed = 0;
  while (placed < opaqueCount) {
    const x = 2 + next() % (width - 4), y = 2 + next() % (height - 4), length = 1 + next() % 4;
    for (let k = 0; k < length && placed < opaqueCount; k++) {
      const o = ((y + k) * width + x) * 4; if (data[o + 3] === 255) continue;
      data.set([...colour, 255], o); placed++;
      for (const [dx, dy] of [[-1, 0], [1, 0]]) { const h = ((y + k + dy) * width + x + dx) * 4; if (data[h + 3] !== 255) data.set([...colour, 60 + next() % 120], h); }
    }
  }
  return data;
}
const CORPUS = [['hello 220x30 (38 opaque px)', 220, 30, 38, [0, 102, 153]], ['abc 120x20 (15 opaque px, black)', 120, 20, 15, [0, 0, 0]], ['lines 300x150 (3 opaque px)', 300, 150, 3, [51, 51, 51]], ['emoji 60x30 (284 opaque px)', 60, 30, 284, [250, 200, 40]]];
const KEYS = [];
for (let index = 0; index < 20; index++) {
  const seed = index < 4 ? ['f'.repeat(64), '8' + '0'.repeat(63), '80000000'.repeat(8), 'ffffffff'.repeat(7) + '7fffffff'][index] : (index * 2654435761 >>> 0).toString(16).padStart(8, '0').repeat(8);
  for (const origin of ['https://site-a.test', 'https://site-b.test']) KEYS.push({ seed, origin });
}
test('corpus (vm): 20 seeds incl. high-bit seeds x 2 top sites: no output equals native, every opaque pixel is marked and outputs are pairwise distinct', () => {
  assert.equal(KEYS.length, 40);
  for (const [name, width, height, opaque, colour] of CORPUS) {
    const native = strokes(width, height, opaque, width * 31 + height, colour), outputs = new Set();
    for (const [index, options] of KEYS.entries()) {
      const f = canvasRealm(options), read = f.canvas(width, height, native).read();
      // The oracle is slow (BigInt): check the four high-bit seeds on both sites; the rest is covered by the distinctness below.
      if (index < 8) assert.ok(sameBytes(read, sparseExpected(native, width, height, sessionKey(options.seed, options.origin)).data), name + ' equals the oracle for ' + JSON.stringify(options));
      const moved = changedPixels(native, read).length;
      assert.equal(moved, opaque, name + ': every opaque pixel is marked'); assert.ok(!sameBytes(read, native));
      outputs.add(sha1(read));
    }
    // Black (0 or 255) pixels can only go one way, so three pixels give at most 3^3 = 27 outputs; 3 opaque pixels of grey give 6^3.
    if (opaque >= 15) assert.equal(outputs.size, KEYS.length, name + ': pairwise distinct');
    else assert.ok(outputs.size >= KEYS.length * 0.7, name + `: ${outputs.size} distinct of ${KEYS.length} (only ${opaque} opaque pixels; translucent pixels are not marked)`);
  }
});

// Translucent pixels are marked where the engine's premultiply/unpremultiply arithmetic was measured (Skia, Moz2D; see the header of
// api-custom-canvas-runtime.js and api-custom-canvas-translucent.test.mjs). A drawing copied at globalAlpha 0.99 has alpha 252 in every pixel.
test('a drawing copied at globalAlpha 0.99 (no opaque pixel) is marked where the engine arithmetic was measured', () => {
  const width = 240, height = 60, copy = makeImage(width, height, 'opaque'); for (let o = 3; o < copy.length; o += 4) copy[o] = 252;
  for (const engine of ['skia-cpu', 'skia-gpu', 'moz2d-old', 'moz2d-new']) {
    const source = canvasRealm({ engine }).canvas(width, height, copy), read = source.read();
    assert.ok(!sameBytes(read, source.pixels), engine + ': the copy should be marked');
    let moved = 0; for (let o = 0; o < read.length; o += 4) if (read[o] !== source.pixels[o] || read[o + 1] !== source.pixels[o + 1] || read[o + 2] !== source.pixels[o + 2]) moved++;
    assert.ok(moved > width * height * 0.95, engine + ': ' + moved + ' of ' + width * height + ' pixels moved');
  }
});

test('KNOWN GAP (ADR-107): in an engine whose conversions were not measured the 0.99 copy still reads back natively', { todo: 'only Skia (Chromium family) and Moz2D (Firefox) are measured; any other engine keeps translucent pixels native' }, () => {
  const width = 240, height = 60, copy = makeImage(width, height, 'opaque'); for (let o = 3; o < copy.length; o += 4) copy[o] = 252;
  const read = canvasRealm().canvas(width, height, copy).read();
  assert.ok(!sameBytes(read, copy), 'the copy should be marked');
});

test('fill a rectangle and compare (documented, detectable): up to 512x512 every filled pixel differs by one level of one channel; above, about 1%', () => {
  for (const [w, h] of [[64, 64], [400, 300], [1000, 400]]) {
    const filled = new Uint8ClampedArray(w * h * 4); for (let o = 0; o < filled.length; o += 4) filled.set([10, 200, 30, 255], o);
    const read = canvasRealm().canvas(w, h, filled).read(), moved = changedPixels(filled, read);
    assert.equal(moved.length, w * h <= DENSE_LIMIT ? w * h : sparseExpected(filled, w, h, KEY).selected.length, `${w}x${h}`);
    if (w * h > DENSE_LIMIT) assert.ok(moved.length > w * h * 0.0099 && moved.length < w * h * 0.0101);
    assert.ok(moved.every(pixel => [0, 1, 2].reduce((sum, c) => sum + Math.abs(read[pixel * 4 + c] - filled[pixel * 4 + c]), 0) === 1));
  }
});

// ---------------------------------------------------------------------------------------------
// Rectangle and export independence
// ---------------------------------------------------------------------------------------------
function rects(width, height, next, count) {
  const out = [[0, 0, 1, 1], [width - 1, height - 1, 1, 1], [0, 0, width, 1], [0, height - 1, width, 1], [0, 0, 1, height], [width - 1, 0, 1, height], [-3, -2, width + 6, height + 4], [width, height, 4, 4], [-5, -5, 4, 4]];
  if (width > TILE) out.push([TILE - 5, 0, 11, Math.min(height, 7)], [TILE - 1, 0, 2, height]);
  if (height > TILE) out.push([0, TILE - 5, Math.min(width, 7), 11]);
  for (let index = 0; index < count; index++) {
    const w = 1 + next() % Math.min(width + 6, 90), h = 1 + next() % Math.min(height + 6, 45);
    out.push([next() % (width + 12) - 6, next() % (height + 12) - 6, w, h]);
  }
  return out;
}
test('any rectangle of a canvas equals the crop of the whole-canvas oracle: 800+ rectangles incl. negative sizes, partly or fully outside, seams', () => {
  const next = rng(0x5eed); let count = 0;
  for (const [width, height, kind] of [[1, 1, 'opaque'], [7, 3, 'mixed'], [16, 16, 'edge'], [100, 70, 'mixed'], [300, 150, 'mixed'], [1, 5000, 'opaque'], [5000, 1, 'opaque'], [257, 129, 'extremes'], [400, 300, 'mixed'], [1030, 1030, 'mixed'], [2049, 4, 'opaque'], [1, 300000, 'opaque']]) {
    const f = canvasRealm(), source = f.canvas(width, height, kind), expected = sparseExpected(source.pixels, width, height, KEY).data;
    for (const [x, y, w, h] of rects(width, height, next, 70)) {
      assert.ok(sameBytes(source.read(x, y, w, h), crop(expected, width, height, x, y, w, h)), `${width}x${height} rect ${x},${y} ${w}x${h}`);
      const [nx, ny] = [x + w, y + h]; // the same rectangle named from its opposite corner (negative sizes)
      assert.ok(sameBytes(source.read(nx, ny, -w, -h), crop(expected, width, height, x, y, w, h)), `${width}x${height} negative rect ${nx},${ny} ${-w}x${-h}`); count += 2;
    }
  }
  assert.ok(count >= 800, 'rectangles ' + count);
});

test('a read of one pixel at a time reproduces the same canvas as one read of everything', () => {
  for (const [w, h] of [[53, 41], [97, 3]]) {
    const f = canvasRealm(), source = f.canvas(w, h, 'mixed'), whole = source.read(), pixelwise = new Uint8ClampedArray(whole.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) pixelwise.set(source.read(x, y, 1, 1), (y * w + x) * 4);
    assert.ok(sameBytes(pixelwise, whole), `${w}x${h}`);
  }
});

test('a drawImage copy of the same size reads like its source; a copy of another size draws its own moves (the key includes the canvas size)', () => {
  const f = canvasRealm(), a = f.canvas(120, 80, 'mixed'), same = f.canvas(120, 80, 'transparent'), wider = f.canvas(121, 80, 'transparent');
  same.context.drawImage(a.canvas, 0, 0); wider.context.drawImage(a.canvas, 0, 0);
  assert.ok(sameBytes(same.read(), a.read()), 'equal pixels in equal canvases agree');
  assert.ok(sameBytes(f.take(same.canvas.toDataURL()), a.read()));
  const widerStore = f.stores.get(wider.canvas).data, widerRead = wider.read();
  assert.ok(sameBytes(widerRead, sparseExpected(widerStore, 121, 80, KEY).data), 'the wider canvas reads the oracle of its own size');
  // Same drawing, one empty column more: the moves of the shared pixels are independent draws (agreement by chance is about 1 in 6).
  const own = moves(a.pixels, a.read()), other = moves(crop(widerStore, 121, 80, 0, 0, 120, 80), crop(widerRead, 121, 80, 0, 0, 120, 80));
  const moved = own.filter(Boolean).length, agree = own.filter((move, pixel) => move && move === other[pixel]).length;
  assert.ok(moved > 1000 && agree < moved * 0.3, `${agree} of ${moved} moves agree`);
});

test('after a resize the next read uses the new canvas size', () => {
  const f = canvasRealm(), source = f.canvas(60, 40, 'opaque');
  source.canvas.width = 90; source.canvas.height = 20; f.stores.get(source.canvas).data.set(makeImage(90, 20, 'opaque', 9));
  assert.ok(sameBytes(source.context.getImageData(0, 0, 90, 20).data, sparseExpected(makeImage(90, 20, 'opaque', 9), 90, 20, KEY).data));
});

test('the same canvas read through independent installs of the same profile agrees, and survives a reinstall', () => {
  const first = canvasRealm().canvas(300, 150, 'mixed').read(), second = canvasRealm().canvas(300, 150, 'mixed').read();
  assert.ok(sameBytes(first, second));
  const f = canvasRealm(), source = f.canvas(300, 150, 'mixed'); assert.ok(sameBytes(source.read(), source.read()), 'repeated reads agree');
});

// ---------------------------------------------------------------------------------------------
// Key separation: seed, top-level site, canvas size
// ---------------------------------------------------------------------------------------------
test('two seeds, two sites and two canvas sizes draw independent moves (small and medium) and (almost) disjoint selections (large)', () => {
  for (const [w, h] of [[300, 150], [400, 300]]) {
    const base = canvasRealm().canvas(w, h, 'opaque'), reference = moves(base.pixels, base.read());
    for (const options of [{ seed: OTHER_SEED }, { origin: 'https://other.test' }, { seed: 'f'.repeat(64), origin: 'https://third.test' }]) {
      const other = canvasRealm(options).canvas(w, h, 'opaque'), drawn = moves(other.pixels, other.read());
      const agree = drawn.filter((move, pixel) => move === reference[pixel]).length;
      assert.ok(agree < w * h * 0.25, `${w}x${h} ${JSON.stringify(options)}: ${agree} of ${w * h} moves agree (chance is about 1 in 6)`);
    }
  }
  const base = canvasRealm().canvas(1100, 700, 'opaque'), reference = new Set(changedPixels(base.pixels, base.read()));
  assert.equal(reference.size, 7700);
  for (const options of [{ seed: OTHER_SEED }, { origin: 'https://other.test' }]) {
    const other = canvasRealm(options).canvas(1100, 700, 'opaque'), moved = changedPixels(other.pixels, other.read());
    assert.equal(moved.length, 7700); assert.ok(moved.filter(index => reference.has(index)).length <= 200, 'overlap by chance only: ' + JSON.stringify(options));
  }
  // The same 770,000 pixels in another shape select other pixels (width and height are part of every draw).
  const tall = canvasRealm().canvas(700, 1100, 'opaque'), moved = changedPixels(tall.pixels, tall.read());
  assert.ok(moved.filter(index => reference.has(index)).length <= 200);
});

test('a top-level site keys the noise: the last ancestorOrigins entry, as for stable-rgb-v1', () => {
  const chain = list => realm => {
    class DOMStringList { get length() { return list.length; } }
    const object = Object.create(DOMStringList.prototype); list.forEach((value, index) => Object.defineProperty(object, index, { value, enumerable: true }));
    realm.DOMStringList = DOMStringList; Object.defineProperty(realm, 'location', { get() { return { ancestorOrigins: object }; }, configurable: true });
  };
  const read = options => { const f = canvasRealm(options); return f.canvas(200, 100, 'opaque').read(); };
  const topLevel = read({ origin: 'https://top.test' });
  // canvasRealm has no prepare hook: build the chain realm by hand through an entry installer call on a prepared realm.
  const prepared = origin => {
    const f = canvasRealm({ origin, entries: [] }); chain(['https://a.test', 'https://top.test'])(f.realm);
    f.installer(f.realm, [{ id: 'canvas-readback', mode: 'custom', value: { algorithm: 'sparse-rgb-v1' }, canvasSeed: SEED }]);
    const source = f.canvas(200, 100, 'opaque'); return source.read();
  };
  assert.ok(sameBytes(prepared('https://tracker.test'), topLevel), 'a third-party frame under top.test reads like a top-level document at top.test');
  assert.ok(!sameBytes(prepared('https://tracker.test'), read({ origin: 'https://tracker.test' })));
});

test('globals a page poisons after installation never reach the kernel, in any zone (Math, Number, Reflect, iterators)', async () => {
  const f = canvasRealm(), sources = [[37, 23], [400, 300], [700, 400]].map(([w, h]) => [w, h, f.canvas(w, h, 'mixed')]);
  vm.runInContext(`const poison = () => { throw Error('PAGE_INTRINSIC'); }; for (const name of Object.getOwnPropertyNames(Math)) if (typeof Math[name] === 'function') Math[name] = poison;
    Number = poison; Reflect.apply = poison; Reflect.get = poison; Object.getOwnPropertyDescriptor = poison; Array.prototype[Symbol.iterator] = poison; String.prototype.charCodeAt = poison;`, f.context);
  for (const [w, h, source] of sources) {
    assert.ok(sameBytes(source.read(), sparseExpected(source.pixels, w, h, KEY).data), `getImageData ${w}x${h}`);
    assert.ok(sameBytes(f.take(source.canvas.toDataURL()), sparseExpected(source.pixels, w, h, KEY).data), `toDataURL ${w}x${h}`);
  }
});

test('seeds with the high bit set in every word derive the same keys as the oracle (no signed 32-bit drift)', () => {
  for (const seed of ['f'.repeat(64), '8' + '0'.repeat(63), '80000000'.repeat(8), 'fedcba98'.repeat(8)]) for (const [w, h] of [[37, 23], [400, 300], [700, 400]]) {
    const source = canvasRealm({ seed }).canvas(w, h, 'mixed');
    assert.ok(sameBytes(source.read(), sparseExpected(source.pixels, w, h, sessionKey(seed)).data), `${seed.slice(0, 8)} ${w}x${h}`);
  }
});

// ---------------------------------------------------------------------------------------------
// Fail closed, limits, covered/uncovered paths
// ---------------------------------------------------------------------------------------------
test('unknown or malformed algorithms and seeds fail closed: every covered readback is denied, none returns the source bitmap', async () => {
  for (const value of [{ algorithm: 'sparse-rgb-v3' }, { algorithm: 'Sparse-RGB-v1' }, { algorithm: '' }, {}, { algorithm: null }, { algorithm: 42 }, null, 'sparse-rgb-v1']) {
    const f = canvasRealm({ entries: [{ id: 'canvas-readback', mode: 'custom', value, canvasSeed: SEED }] }), source = f.canvas(16, 16, 'opaque'), off = f.canvas(16, 16, 'opaque', true);
    assert.throws(() => source.read(), error => error.name === 'SecurityError', JSON.stringify(value));
    assert.throws(() => source.canvas.toDataURL(), error => error.name === 'SecurityError');
    assert.equal(await f.exportBlob(source.canvas), null);
    await assert.rejects(off.canvas.convertToBlob(), error => error.name === 'SecurityError');
    assert.equal(f.installation.snapshot().unavailable, 1);
  }
  for (const canvasSeed of [undefined, '', 'a'.repeat(63), 'A'.repeat(64), 'g'.repeat(64)]) {
    const f = canvasRealm({ entries: [{ id: 'canvas-readback', mode: 'custom', value: { algorithm: 'sparse-rgb-v1' }, canvasSeed }] });
    assert.throws(() => f.canvas(16, 16, 'opaque').read(), error => error.name === 'SecurityError');
  }
});

test('canvases above 16 MP: a small rectangle can still be read, every export is denied, and nothing is returned unprojected', async () => {
  const f = canvasRealm({ store: false }), huge = f.canvas(5000, 4000, 'transparent');
  assert.equal(huge.context.getImageData(10, 10, 4, 4).data.length, 64);
  assert.throws(() => huge.canvas.toDataURL(), error => error.name === 'SecurityError');
  assert.equal(await f.exportBlob(huge.canvas), null);
  const absurd = f.canvas(32768, 32769, 'transparent'); // beyond 2^30 pixels: no browser allows it; denied rather than hashed
  assert.throws(() => absurd.context.getImageData(0, 0, 1, 1), error => error.name === 'SecurityError');
  const exact = canvasRealm(), top = exact.canvas(4096, 4096, 'flat');
  assert.ok(sameBytes(exact.take(top.canvas.toDataURL()), sparseExpected(top.pixels, 4096, 4096, KEY).data), 'the 16 MP canvas is projected');
});

test('tiles without a selected opaque pixel are not rewritten; a tile with one is written once', () => {
  const quiet = canvasRealm(), blank = quiet.canvas(2 * TILE + 5, TILE + 5, 'transparent'); blank.canvas.toDataURL();
  assert.equal(quiet.calls.filter(row => row.name === 'putImageData').length, 0); assert.equal(quiet.calls.filter(row => row.name === 'drawImage').length, 1);
  assert.equal(quiet.calls.filter(row => row.name === 'getImageData' && row.receiver !== blank.context).length, 6, 'three tile columns by two tile rows');
  const width = 700, height = 400, selected = sparseExpected(new Uint8ClampedArray(width * height * 4), width, height, KEY).selected, taken = new Set(selected);
  const free = Array.from({ length: width * height }, (_, index) => index).find(index => !taken.has(index));
  for (const [index, writes] of [[free, 0], [selected[10], 1]]) {
    const pixels = new Uint8ClampedArray(width * height * 4); pixels.set([120, 60, 30, 255], index * 4);
    const f = canvasRealm(), source = f.canvas(width, height, pixels); f.calls.length = 0;
    const exported = f.take(source.canvas.toDataURL());
    assert.equal(f.calls.filter(row => row.name === 'putImageData').length, writes, 'pixel ' + index);
    assert.equal(changedPixels(pixels, exported).length, writes);
  }
});

test('opaque-or-transparent tiles are written back in place; only tiles with translucent pixels use an overlay canvas', () => {
  const opaque = canvasRealm(), flat = opaque.canvas(300, 200, 'opaque'); flat.canvas.toDataURL();
  assert.equal(opaque.privateCanvases().size, 2, 'source and copy only'); assert.equal(opaque.calls.filter(row => row.name === 'putImageData').length, 1);
  const translucent = canvasRealm(), glass = translucent.canvas(300, 200, 'mixed'); glass.canvas.toDataURL();
  assert.equal(translucent.privateCanvases().size, 3, 'source, copy and overlay');
});

test('a canvas that the realm never saw (untracked) is exported only while blank', () => {
  const f = canvasRealm(), width = 2 * TILE + 8, height = 6, blank = f.untracked(width, height), dirty = f.untracked(width, height);
  assert.ok(sameBytes(f.take(blank.canvas.toDataURL()), blank.store.data));
  dirty.store.data[((height - 1) * width + width - 1) * 4 + 3] = 255;
  assert.throws(() => dirty.canvas.toDataURL(), error => error.name === 'SecurityError');
});

// ---------------------------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------------------------
function best(run, rounds = 7) {
  for (let warm = 0; warm < 2; warm++) run();
  let fastest = Infinity; for (let round = 0; round < rounds; round++) { const start = performance.now(); run(); fastest = Math.min(fastest, performance.now() - start); }
  return fastest;
}
test('cost: no zone is slower than stable-rgb-v1; above 512x512 a read scales with the selection, not the pixels', t => {
  for (const [w, h, factor] of [[256, 256, 1], [512, 512, 1], [1024, 1024, 4]]) {
    const stable = canvasRealm({ algorithm: 'stable-rgb-v1' }).canvas(w, h, 'opaque'), sparse = canvasRealm().canvas(w, h, 'opaque');
    const slow = best(() => stable.read()), fast = best(() => sparse.read());
    t.diagnostic(`${w}x${h} getImageData: stable ${slow.toFixed(2)} ms, sparse ${fast.toFixed(2)} ms, ${(slow / fast).toFixed(1)}x`);
    assert.ok(slow / fast >= factor, `${w}x${h}: expected at least ${factor}x, measured ${(slow / fast).toFixed(1)}x`);
  }
  const large = canvasRealm().canvas(2560, 1440, 'flat'), largeMs = best(() => large.read(), 5), stable512 = best(() => canvasRealm({ algorithm: 'stable-rgb-v1' }).canvas(512, 512, 'opaque').read(), 3);
  t.diagnostic(`2560x1440 sparse getImageData: ${largeMs.toFixed(1)} ms`);
  assert.ok(largeMs < stable512 * 2, `2560x1440 sparse ${largeMs.toFixed(1)} ms vs 512x512 stable ${stable512.toFixed(1)} ms`);
});

test('cost: degenerate shapes stay linear (a 1 px wide strip shares one draw between many rows)', () => {
  for (const [width, height] of [[1, 65536], [1, 262144], [1, 1000000], [1000000, 1], [2, 400000], [3, 262144]]) {
    const f = canvasRealm({ store: true }), source = f.canvas(width, height, 'opaque'), start = performance.now(), read = source.read();
    assert.ok(performance.now() - start < 3000, `${width}x${height} took ${performance.now() - start} ms`);
    assert.equal(changedPixels(source.pixels, read).length, sparseExpected(source.pixels, width, height, KEY).selected.length);
  }
});

// ---------------------------------------------------------------------------------------------
// PNG size (model; the real browser is measured by canvas-sparse-native.mjs and canvas-readback-native.mjs)
// ---------------------------------------------------------------------------------------------
test('PNG size model: flat 1280x720 stays within 3x, flat 512x512 within 15x and well below stable; stable-rgb-v1 explodes', () => {
  const flat = makeImage(1280, 720, 'flat'), native = encodePng(flat, 1280, 720).length, sparse = encodePng(sparseExpected(flat, 1280, 720, KEY).data, 1280, 720).length;
  const stable = encodePng(canvasRealm({ algorithm: 'stable-rgb-v1' }).canvas(1280, 720, flat).read(), 1280, 720).length;
  assert.ok(sparse <= native * 3, `sparse ${sparse} vs native ${native} (${(sparse / native).toFixed(2)}x)`);
  assert.ok(stable >= native * 50, `stable ${stable} vs native ${native}`);
  // Runs are what keep it small: the same density in isolated pixels would not fit the budget.
  const isolated = flat.slice(); for (let index = 0; index < 1280 * 720; index += 100) isolated[index * 4 + 1] ^= 1;
  assert.ok(encodePng(isolated, 1280, 720).length > native * 3, 'isolated pixels at the same density are the expensive layout');
  // Medium canvases move every pixel in runs of 16: bounded, and far below stable's per-pixel noise.
  const medium = makeImage(512, 512, 'flat'), mediumNative = encodePng(medium, 512, 512).length, mediumSparse = encodePng(sparseExpected(medium, 512, 512, KEY).data, 512, 512).length;
  const mediumStable = encodePng(canvasRealm({ algorithm: 'stable-rgb-v1' }).canvas(512, 512, medium).read(), 512, 512).length;
  assert.ok(mediumSparse <= mediumNative * 15 && mediumSparse * 4 < mediumStable, `512x512: native ${mediumNative}, sparse ${mediumSparse}, stable ${mediumStable}`);
});
