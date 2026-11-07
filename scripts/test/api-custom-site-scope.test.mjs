// S1 (surfaces installer): audio and WebGL readback noise is keyed by the TOP-LEVEL site, so one third-party frame embedded on
// two sites no longer shows one value. The canvas half of the same rule is tested in api-custom-canvas-runtime.test.mjs.
// Actual serialized production installer, synthetic Web Audio / WebGL / Location.ancestorOrigins.
import test from 'node:test';
import assert from 'node:assert/strict';
import { surfaceFixture, originOf, chainSetup, AUDIO_MOCKS } from './surface-test-kit.mjs';

// ADR-107: the projection is keyed by the private per-profile key (entry.audioKey), not by the portable value seed.
const AUDIO = { id: 'audio-fingerprint', value: { seed: '00112233445566778899aabbccddeeff', amplitude: 0.00001 }, audioKey: '0f1e2d3c4b5a69788796a5b4c3d2e1f0'.repeat(2) };
const CHANNEL0 = '(() => { const buffer = engineBuffer({ length: 64, sampleRate: 44100 }); buffer.getChannelData(0); return bitsOf(rawChannel(buffer), 0, 12); })()';
const CHANNEL1 = '(() => { const buffer = engineBuffer({ numberOfChannels: 2, length: 64, sampleRate: 44100 }); const out = new Float32Array(8); buffer.copyFromChannel(out, 1, 5); return bitsOf(out, 0, 8); })()';

// Values pinned for the key above (sine input), recorded when ADR-107 moved the noise to the private key: a change of the projection
// for a top-level document must be deliberate. UNSCOPED: a realm without a readable origin (the frame-origin fallback of an opaque frame).
const GOLDEN = {
  'https://a.example': { ch0: '00000000,3f218f94,3f2e95f9,3dd8c1b7,bf114e15,bf381d66,be5696cf,3efc48e6,3f3df497,3e9e4098,bed0e766,bf3fffa4', ch1: 'bf381d29,be56965b,3efc487d,3f3df4c7,3e9e40fb,bed0e708,bf3fffb2,bece0b11' },
  'https://top.test': { ch0: '00000000,3f218fe7,3f2e95fa,3dd8c360,bf114e78,bf381d4d,be569769,3efc486c,3f3df4b8,3e9e408e,bed0e765,bf3fffe2', ch1: 'bf381d1b,be569723,3efc481b,3f3df4c9,3e9e4020,bed0e770,bf3fffdb,bece0b08' },
  'https://tracker.test': { ch0: '00000000,3f218fb3,3f2e9595,3dd8c1a7,bf114e2d,bf381d49,be56966a,3efc4858,3f3df4f4,3e9e401e,bed0e7a5,bf3ffff4', ch1: 'bf381d62,be569724,3efc4889,3f3df49f,3e9e40cc,bed0e7ba,bf3fffe4,bece0b81' },
};
const UNSCOPED = { ch0: '00000000,3f218f83,3f2e95aa,3dd8c118,bf114e63,bf381d3d,be56964a,3efc48b9,3f3df48e,3e9e40be,bed0e794,bf3fffe7', ch1: 'bf381d09,be569729,3efc48df,3f3df4d1,3e9e40c1,bed0e709,bf3fffff,bece0b53' };

const audio = (origin, chain) => surfaceFixture([AUDIO], { mocks: AUDIO_MOCKS, setup: (origin === undefined ? '' : originOf(origin)) + (chain ? chainSetup(...chain) : '') });
const values = run => ({ ch0: run(CHANNEL0), ch1: run(CHANNEL1) });

test('audio: top-level documents keep their pinned values, with no Location chain or an empty one', () => {
  for (const [origin, golden] of Object.entries(GOLDEN)) {
    assert.deepEqual(values(audio(origin)), golden, origin + ': no location');
    assert.deepEqual(values(audio(origin, [[]])), golden, origin + ': empty ancestorOrigins');
  }
});

test('audio: a frame is keyed by the last ancestorOrigins entry, i.e. the top-level site, not by its own origin', () => {
  const frame = values(audio('https://tracker.test', [['https://a.example', 'https://top.test']]));
  assert.deepEqual(frame, GOLDEN['https://top.test'], 'equals a top-level document at top.test');
  assert.notDeepEqual(frame, GOLDEN['https://tracker.test']);
  // Same-origin-with-top frame equals the top document; a direct child of the top works the same way.
  assert.deepEqual(values(audio('https://top.test', [['https://top.test']])), GOLDEN['https://top.test']);
  assert.deepEqual(values(audio('https://tracker.test', [['https://top.test']])), GOLDEN['https://top.test']);
  // A realm whose list is a plain Array (no DOMStringList.prototype getter) is read through its own length, like a data-property origin.
  assert.deepEqual(values(audio('https://tracker.test', [['https://a.example', 'https://top.test'], { data: true }])), GOLDEN['https://top.test']);
});

test('audio: one frame origin embedded under two tops gets two values, each stable across reinstall', () => {
  const underA = values(audio('https://tracker.test', [['https://a.example']])), underTop = values(audio('https://tracker.test', [['https://top.test']]));
  assert.notDeepEqual(underA, underTop);
  assert.deepEqual(underA, GOLDEN['https://a.example']); assert.deepEqual(underTop, GOLDEN['https://top.test']);
  assert.deepEqual(values(audio('https://tracker.test', [['https://a.example']])), underA);
  const differing = underA.ch0.split(',').filter((word, index) => word !== underTop.ch0.split(',')[index]).length;
  assert.ok(differing >= 9, 'most samples differ between tops, got ' + differing + '/12');
});

test('audio: sandboxed (opaque) frames follow their top; an opaque top or any unreadable chain keeps today\'s frame-origin value', () => {
  assert.deepEqual(values(audio('null', [['https://top.test']])), GOLDEN['https://top.test'], 'opaque frame under a normal top');
  const fallbacks = {
    'opaque top': [['https://a.example', 'null']],
    'empty entry': [['']], 'non-string entry': [[42]], 'oversized entry': [['https://' + 'x'.repeat(520)]],
    'no ancestorOrigins (Firefox, workers)': [[], { none: true }],
    'length is not a number': [['https://top.test'], { length: '1' }], 'fractional length': [['https://top.test'], { length: 0.5 }],
    'length over the bound': [['https://top.test'], { length: 5000 }], 'zero length': [['https://top.test'], { length: 0 }],
    'throwing list getter': [['https://top.test'], { listThrows: true }], 'throwing length getter': [['https://top.test'], { lengthThrows: true }],
    'throwing location getter': [['https://top.test'], { locationThrows: true }],
  };
  for (const [label, chain] of Object.entries(fallbacks)) {
    assert.deepEqual(values(audio('https://tracker.test', chain)), GOLDEN['https://tracker.test'], label + ' -> frame origin');
    assert.deepEqual(values(audio('null', chain)), UNSCOPED, label + ' with an opaque frame -> unscoped, as before');
  }
});

test('audio: the chain is read once at install through captured accessors; no page-patchable method runs and later edits are ignored', () => {
  const run = audio('https://tracker.test', [['https://a.example', 'https://top.test']]);
  assert.equal(run('trips'), 0, 'item/contains/iterator/toString/forEach/at were never called');
  const first = values(run);
  assert.deepEqual(first, GOLDEN['https://top.test']);
  run('chainList[1] = "https://evil.test"; Object.defineProperty(DOMStringList.prototype, "length", { get() { return 1; } });');
  assert.deepEqual(values(run), first, 'a later page edit cannot rekey a document that is already installed');
  assert.equal(run('trips'), 0);
});

test('audio: a page-planted own length on the list cannot hide the chain (length comes from the DOMStringList.length getter)', () => {
  assert.deepEqual(values(audio('https://tracker.test', [['https://a.example', 'https://top.test'], { ownLength: 0 }])), GOLDEN['https://top.test']);
  assert.deepEqual(values(audio('https://tracker.test', [['https://a.example', 'https://top.test'], { ownLength: 1 }])), GOLDEN['https://top.test'], 'nor can it point at another entry');
});

// ---------------------------------------------------------------------------------------------
// WebGL readPixels: scoped by the top-level site like the Canvas runtime.
// ---------------------------------------------------------------------------------------------
const GL_MOCKS = `(() => {
  const brands = new WeakMap(), reason = new TypeError('Synthetic native WebGL brand');
  function data(receiver, webgl2) { const found = brands.get(receiver); if (!found || found.webgl2 !== webgl2) throw reason; return found; }
  function makeClass(webgl2) { return class {
    constructor() { brands.set(this, { webgl2, width: 16, height: 16 }); }
    get drawingBufferWidth() { return data(this, webgl2).width; } get drawingBufferHeight() { return data(this, webgl2).height; }
    isContextLost() { data(this, webgl2); return false; }
    getParameter(name) {
      data(this, webgl2);
      if (name === 3333) return 4; if (name === 35739) return 6408; if (name === 35738) return 5121; if (name === (webgl2 ? 36010 : 36006)) return null;
      if (webgl2) { if (name === 35053) return null; if (name === 3074) return 1029; if (name === 3330 || name === 3331 || name === 3332) return 0; }
      throw reason;
    }
    readPixels(x, y, width, height, format, type, destination, offset = 0) {
      data(this, webgl2); const stride = width * 4;
      for (let row = 0; row < height; row++) for (let pixel = 0; pixel < width; pixel++) {
        const at = offset + row * stride + pixel * 4; destination[at] = 100; destination[at + 1] = 110; destination[at + 2] = 120; destination[at + 3] = 255;
      }
    }
  }; }
  globalThis.WebGLRenderingContext = makeClass(false); globalThis.WebGL2RenderingContext = makeClass(true);
  globalThis.gl = new WebGLRenderingContext(); globalThis.gl2 = new WebGL2RenderingContext();
})();`;
// ADR-107: keyed like the Canvas runtime (private entry.webglKey here; entry.canvasKey when canvas-readback is Custom too): the top-level
// site, else Window.origin with 'null' kept as a scope of its own; no readable origin at all fails closed. The equality with the Canvas
// projection itself is tested in api-custom-webgl-canvas-agreement.test.mjs.
const GL_SEED = { id: 'webgl-readback', value: { seed: '00000000000000000000000000000000' }, webglKey: 'fedcba9876543210'.repeat(4) };
const READ = 'globalThis.full = new Uint8Array(64); gl.readPixels(0, 0, 4, 4, 6408, 5121, full); Array.from(full).join(",")';
const READ2 = 'globalThis.full2 = new Uint8Array(64); gl2.readPixels(0, 0, 4, 4, 6408, 5121, full2); Array.from(full2).join(",")';
const gl = (origin, chain) => surfaceFixture([GL_SEED], { mocks: GL_MOCKS, setup: (origin === undefined ? '' : originOf(origin)) + (chain ? chainSetup(...chain) : '') });

test('WebGL readPixels: a realm without a readable origin fails closed; an opaque origin is a scope of its own, like the Canvas key', () => {
  assert.throws(() => gl()(READ), error => error.name === 'SecurityError');
  const opaque = gl('null')(READ);
  assert.equal(gl('null', [[]])(READ), opaque, 'opaque origin, empty chain');
  assert.notEqual(opaque, gl('https://top.test')(READ));
});

test('WebGL readPixels: the noise is scoped by the top-level site', () => {
  const top = gl('https://top.test')(READ), other = gl('https://other.test')(READ);
  assert.notEqual(top, other, 'two top-level documents differ');
  assert.equal(gl('https://top.test')(READ), top, 'stable for one site');
  // Frames: equal to a top-level document at the last ancestor, whatever the frame\'s own origin is.
  assert.equal(gl('https://tracker.test', [['https://a.example', 'https://top.test']])(READ), top);
  assert.equal(gl('https://top.test', [['https://top.test']])(READ), top, 'same-origin frame equals its top');
  const underOther = gl('https://tracker.test', [['https://other.test']])(READ);
  assert.equal(underOther, other); assert.notEqual(underOther, top, 'one tracker origin under two tops');
  assert.equal(gl('null', [['https://top.test']])(READ), top, 'sandboxed frame follows its top');
  assert.equal(gl('https://top.test')(READ2), gl('https://tracker.test', [['https://top.test']])(READ2), 'WebGL2 follows the same scope');
});

test('WebGL readPixels: unusable chains fall back to the frame origin (opaque included); the chain is read once without page methods', () => {
  const own = gl('https://tracker.test')(READ), opaque = gl('null')(READ);
  for (const chain of [[['null']], [['']], [[7]], [['https://top.test'], { none: true }], [['https://top.test'], { length: 0.5 }], [['https://top.test'], { lengthThrows: true }], [['https://top.test'], { listThrows: true }], [['https://top.test'], { locationThrows: true }]]) {
    assert.equal(gl('https://tracker.test', chain)(READ), own, JSON.stringify(chain));
    assert.equal(gl('null', chain)(READ), opaque, 'opaque frame ' + JSON.stringify(chain));
  }
  const run = gl('https://tracker.test', [['https://a.example', 'https://top.test']]), first = run(READ);
  run('chainList[1] = "https://evil.test"; Object.defineProperty(DOMStringList.prototype, "length", { get() { throw new Error("PAGE"); } });');
  assert.equal(run(READ), first); assert.equal(run('trips'), 0);
});
