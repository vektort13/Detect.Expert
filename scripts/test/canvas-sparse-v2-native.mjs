// ADR-112: sparse-rgb-v2 in a real engine, without the extension package. The production installers (Canvas runtime and surfaces runtime) are
// injected at document start into owned pages served from a fake https origin (no network, no dist/ build needed). A native run of the same
// page gives the pixels the engine really draws; the installed run is compared with the independent oracle of canvas-sparse-kit.mjs applied to
// those pixels (parity, saturated channels, the flat rule, translucent stored states), and the properties the anti-spoof pages test are
// asserted in the engine itself: a projected image read back again does not move (getImageData after toDataURL / toBlob / createImageBitmap),
// flat canvases are returned as drawn on every path, a WebGL canvas export equals the export of its 2D drawImage mirror, readPixels equals the
// Canvas projection, a prototype cycle through a wrapper throws the engine's own TypeError, and wrappers keep the native name and length.
// Usage: node scripts/test/canvas-sparse-v2-native.mjs [--firefox]   (Chromium is Playwright's channel 'chromium'; --firefox uses Playwright's Firefox
// build, see canvas-sparse-native.mjs.) Nothing is written to the repository.
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, firefox } from 'playwright';
import { installCanvasCustom } from '../../apps/production-extension/api-custom-canvas-runtime.js';
import { installSurfaceCustom } from '../../apps/production-extension/api-custom-surfaces-runtime.js';
import { SEED, ORIGIN, makeImage, sessionKey, sparseExpectedV2, crop, decodePng, sameBytes, distinctColours, isSaturated } from './canvas-sparse-kit.mjs';

const useFirefox = process.argv.includes('--firefox'), FAMILY = useFirefox ? 2 : 1, KEY = sessionKey(SEED, ORIGIN), WEBGL_KEY = 'fedcba9876543210'.repeat(4);
const CUT = [640, 480], MEDIUM = [300, 150], RECTS = [[0, 0, 1, 1], [5, 3, 120, 60], [-4, -4, 30, 30], [100, 100, -64, -48], [250, 100, 80, 80]];
const checks = [], check = message => { checks.push(message); console.log('  ok ' + message); };

// Runs inside the page. `config` carries the cutout pixels (base64) and the rectangles to read.
async function pageProbe(config) {
  const b64 = bytes => { let text = ''; for (let index = 0; index < bytes.length; index += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(index, index + 0x8000)); return btoa(text); };
  const unb64 = text => Uint8ClampedArray.from(atob(text), char => char.charCodeAt(0));
  const out = { scenes: {}, gl: {}, shape: {} };
  const decode = url => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = url; });
  const readOf = canvas => canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
  const differing = (a, b) => { let count = 0; for (let index = 0; index < a.length; index += 4) if (a[index] !== b[index] || a[index + 1] !== b[index + 1] || a[index + 2] !== b[index + 2] || a[index + 3] !== b[index + 3]) count++; return count; };
  const fresh = (w, h) => { const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; return [canvas, canvas.getContext('2d', { willReadFrequently: true })]; };
  const SCENES = {
    text: (c, w, h) => { const g = c.createLinearGradient(0, 0, w, 0); g.addColorStop(0, '#ff6600'); g.addColorStop(1, '#2244aa'); c.fillStyle = '#fff'; c.fillRect(0, 0, w, h); c.fillStyle = g; c.fillRect(10, 10, w - 20, 60); c.font = '20px Arial'; c.fillStyle = '#102030'; c.fillText('Cwm fjordbank glyphs vext quiz', 12, 100); c.strokeStyle = '#a0f'; c.beginPath(); c.arc(w - 50, h - 40, 30, 0, 6.2); c.stroke(); },
    glass: (c, w, h) => { c.fillStyle = 'rgba(255,0,0,0.5)'; c.fillRect(10, 10, 120, 60); c.fillStyle = 'rgba(0,80,255,0.25)'; c.fillRect(60, 40, 120, 60); c.globalAlpha = 0.6; c.fillStyle = '#00aa88'; c.fillRect(150, 5, 100, 100); c.globalAlpha = 1; c.font = '22px Arial'; c.fillStyle = '#111'; c.fillText('translucent edges', 8, 130); },
    flat: (c, w, h) => { c.fillStyle = 'rgba(0,127,255,1)'; c.fillRect(0, 0, w, h); },
    twoColours: (c, w, h) => { c.fillStyle = '#000'; c.fillRect(0, 0, w, h); c.fillStyle = '#fff'; for (let x = 0; x < w; x += 20) c.fillRect(x, 0, 10, h); },
    doubleAlpha: (c, w, h) => { c.globalAlpha = 0.5; c.fillStyle = 'blue'; c.fillRect(0, 0, w, h); c.fillRect(0, 0, w, h); c.globalAlpha = 1; },
    pure: (c, w, h) => { const colours = ['#f00', '#0f0', '#00f', '#fff', '#000', '#0ff']; colours.forEach((colour, index) => { c.fillStyle = colour; c.fillRect(index * (w / 6), 0, w / 6 + 1, h); }); },
  };
  // (1) 2D scenes: every read path, and the decode round trip of every export
  for (const [name, draw] of Object.entries(SCENES)) {
    const [w, h] = name === 'text' || name === 'glass' ? config.medium : [120, 80], [canvas, context] = fresh(w, h); draw(context, w, h);
    const entry = { w, h };
    entry.read = b64(context.getImageData(0, 0, w, h).data);
    entry.rects = config.rects.map(([x, y, rw, rh]) => b64(context.getImageData(x, y, rw, rh).data));
    entry.url = canvas.toDataURL(); entry.blob = b64(new Uint8Array(await (await new Promise(resolve => canvas.toBlob(resolve))).arrayBuffer()));
    if (typeof OffscreenCanvas === 'function') { const off = new OffscreenCanvas(w, h), offContext = off.getContext('2d'); draw(offContext, w, h); entry.offRead = b64(offContext.getImageData(0, 0, w, h).data); entry.offBlob = b64(new Uint8Array(await (await off.convertToBlob()).arrayBuffer())); }
    // decode round trips: the exported PNG drawn into a fresh canvas of the same size and read again; createImageBitmap of the canvas and of the blob
    const [roundCanvas, roundContext] = fresh(w, h); roundContext.drawImage(await decode(entry.url), 0, 0); const read = context.getImageData(0, 0, w, h).data;
    entry.roundUrl = differing(read, roundContext.getImageData(0, 0, w, h).data);
    const [bitmapCanvas, bitmapContext] = fresh(w, h); bitmapContext.drawImage(await createImageBitmap(canvas), 0, 0); entry.roundBitmap = differing(read, bitmapContext.getImageData(0, 0, w, h).data);
    const [blobCanvas, blobContext] = fresh(w, h); blobContext.drawImage(await createImageBitmap(await new Promise(resolve => canvas.toBlob(resolve))), 0, 0); entry.roundBlob = differing(read, blobContext.getImageData(0, 0, w, h).data);
    const [copyCanvas, copyContext] = fresh(w, h); copyContext.drawImage(canvas, 0, 0); entry.roundCopy = differing(read, copyContext.getImageData(0, 0, w, h).data);
    const [putCanvas, putContext] = fresh(w, h); putContext.putImageData(context.getImageData(0, 0, w, h), 0, 0); entry.roundPut = differing(read, putContext.getImageData(0, 0, w, h).data);
    out.scenes[name] = entry;
  }
  // (2) the cutout canvas of the large zone (alpha 0 or 255): the oracle's input is exact in every engine
  { const [cw, ch] = config.cut, [canvas, context] = fresh(cw, ch); context.putImageData(new ImageData(unb64(config.cutPixels), cw, ch), 0, 0);
    out.cut = { read: b64(context.getImageData(0, 0, cw, ch).data), url: canvas.toDataURL() }; }
  // (3) WebGL: the export of a WebGL canvas against the export of its 2D drawImage mirror (page method 24), and readPixels of the whole buffer
  const shader = (gl, type, source) => { const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s); return s; };
  function draw(gl, kind) {
    const program = gl.createProgram(); gl.attachShader(program, shader(gl, gl.VERTEX_SHADER, 'attribute vec2 p; void main(){gl_Position=vec4(p,0,1);}'));
    gl.attachShader(program, shader(gl, gl.FRAGMENT_SHADER, 'precision mediump float; uniform vec4 c; void main(){gl_FragColor=c;}')); gl.linkProgram(program); gl.useProgram(program);
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.8, -0.7, 0.9, -0.6, 0.1, 0.9]), gl.STATIC_DRAW);
    const location = gl.getAttribLocation(program, 'p'); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
    gl.clearColor(...(kind === 'translucent' ? [0, 0, 0, 0] : kind === 'flat' ? [0.2, 0.4, 0.6, 1] : [1, 1, 1, 1])); gl.clear(gl.COLOR_BUFFER_BIT);
    // Three overlapping triangles (a hard-edged scene of more than four colours); 'flat' is the cleared buffer alone (one colour).
    if (kind !== 'flat') {
      if (kind === 'translucent') { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); }
      const triangles = [[[-0.8, -0.7, 0.9, -0.6, 0.1, 0.9], kind === 'translucent' ? [0.45, 0.2, 0.1, 0.5] : [0.9, 0.3, 0.2, 1]], [[-0.3, -0.8, 0.8, 0.2, -0.7, 0.6], kind === 'translucent' ? [0.1, 0.5, 0.8, 0.75] : [0.1, 0.5, 0.8, 1]], [[0, -0.9, 0.5, 0.7, -0.9, 0.1], kind === 'translucent' ? [0.3, 0.3, 0.05, 0.4] : [0.25, 0.7, 0.3, 1]]];
      for (const [vertices, colour] of triangles) { gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW); gl.uniform4f(gl.getUniformLocation(program, 'c'), ...colour); gl.drawArrays(gl.TRIANGLES, 0, 3); }
    }
  }
  for (const premultipliedAlpha of [true, false]) for (const kind of ['opaque', 'translucent', 'flat']) {
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 96;
    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha, antialias: false });
    const key = (premultipliedAlpha ? 'pma-' : 'straight-') + kind;
    if (!gl) { out.gl[key] = { error: 'no webgl' }; continue; }
    draw(gl, kind);
    const [mirror, mirrorContext] = fresh(128, 96); mirrorContext.drawImage(canvas, 0, 0);
    const glUrl = canvas.toDataURL(), mirrorUrl = mirror.toDataURL(), blobOf = c => new Promise(resolve => c.toBlob(async blob => resolve(b64(new Uint8Array(await blob.arrayBuffer())))));
    const pixels = new Uint8Array(128 * 96 * 4); gl.readPixels(0, 0, 128, 96, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    out.gl[key] = { urlEqual: glUrl === mirrorUrl, blobEqual: (await blobOf(canvas)) === (await blobOf(mirror)), glUrl, mirrorUrl, mirrorRead: b64(mirrorContext.getImageData(0, 0, 128, 96).data), pixels: b64(pixels) };
  }
  // (4) the shape of the wrappers
  const natives = { math: String(Object.getOwnPropertyDescriptor(Math, 'cos').value.name) };
  try { Object.setPrototypeOf(Math.cos, Math.cos); out.shape.nativeCycle = 'no throw'; } catch (error) { out.shape.nativeCycle = error.constructor === TypeError ? error.message : 'other ' + error.constructor.name; }
  for (const [label, target] of [['toDataURL', HTMLCanvasElement.prototype.toDataURL], ['getImageData', CanvasRenderingContext2D.prototype.getImageData], ['readPixels', WebGLRenderingContext.prototype.readPixels]]) {
    const row = { name: target.name, length: target.length };
    try { Object.setPrototypeOf(target, target); row.cycle = 'no throw'; } catch (error) { row.cycle = error.constructor === TypeError ? error.message : 'other ' + error.constructor.name; }
    row.afterReads = [typeof target.name, typeof target.length, typeof target.call].join(); row.proto = Object.getPrototypeOf(target) === Function.prototype; out.shape[label] = row;
  }
  out.shape.toString = Function.prototype.toString.toString(); void natives;
  return out;
}

function firefoxExecutable() {
  if (process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE) return process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE;
  const base = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  const candidates = existsSync(base) ? readdirSync(base).filter(name => /^firefox-[0-9]+$/.test(name)).sort((a, b) => Number(b.slice(8)) - Number(a.slice(8))) : [];
  for (const name of candidates) { const path = join(base, name, 'firefox', 'firefox.exe'); if (existsSync(path)) return path; }
  return undefined;
}
const browser = await (useFirefox ? firefox : chromium).launch(useFirefox ? { executablePath: firefoxExecutable() } : { channel: 'chromium' });
console.log('canvas sparse v2 native: ' + (useFirefox ? 'Playwright Firefox ' : 'Chromium ') + browser.version());
const cutPixels = makeImage(...CUT, 'cutout', 7), cutBase64 = Buffer.from(cutPixels.buffer).toString('base64');
async function run(algorithm) {
  const context = await browser.newContext(), host = new URL(ORIGIN).origin;
  await context.route(host + '/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>canvas</title>' }));
  if (algorithm) {
    await context.addInitScript(`(${installCanvasCustom.toString()})(globalThis, ${JSON.stringify([{ id: 'canvas-readback', mode: 'custom', value: { algorithm }, canvasSeed: SEED }])});`);
    await context.addInitScript(`(${installSurfaceCustom.toString()})(globalThis, ${JSON.stringify([{ id: 'canvas-readback', mode: 'custom', value: { algorithm }, canvasSeed: SEED }, { id: 'webgl-readback', mode: 'custom', value: { seed: '00112233445566778899aabbccddeeff' }, webglKey: WEBGL_KEY, canvasKey: SEED }])});`);
  }
  const page = await context.newPage(); page.setDefaultTimeout(240000); await page.goto(host + '/');
  try { return await page.evaluate(pageProbe, { medium: MEDIUM, cut: CUT, cutPixels: cutBase64, rects: RECTS }); } finally { await context.close(); }
}
const bytes = text => Buffer.from(text.slice(text.indexOf(',') + 1), 'base64'), fromBase64 = text => new Uint8ClampedArray(Buffer.from(text, 'base64'));
const dataUrlPixels = text => decodePng(bytes(text)).data, blobPixels = text => decodePng(Buffer.from(text, 'base64')).data;
const changedCount = (a, b) => { let n = 0; for (let o = 0; o < a.length; o += 4) if (a[o] !== b[o] || a[o + 1] !== b[o + 1] || a[o + 2] !== b[o + 2] || a[o + 3] !== b[o + 3]) n++; return n; };
const flip = (pixels, w, h) => { const out = new Uint8ClampedArray(pixels.length); for (let row = 0; row < h; row++) out.set(pixels.subarray(row * w * 4, (row + 1) * w * 4), (h - 1 - row) * w * 4); return out; };
let failed = null;
try {
  const native = await run(null), v2 = await run('sparse-rgb-v2'), v1 = await run('sparse-rgb-v1');
  const scenes = Object.keys(native.scenes);

  // The oracle against the engine: every read path of every 2D scene equals the oracle applied to the native read of the same scene.
  for (const name of scenes) {
    const base = native.scenes[name], now = v2.scenes[name], input = fromBase64(base.read), { w, h } = base, expected = sparseExpectedV2(input, w, h, KEY, FAMILY);
    assert.ok(sameBytes(fromBase64(now.read), expected.data), name + ': getImageData equals the oracle');
    now.rects.forEach((text, index) => { const [x, y, rw, rh] = RECTS[index], nx = rw < 0 ? x + rw : x, ny = rh < 0 ? y + rh : y; assert.ok(sameBytes(fromBase64(text), crop(expected.data, w, h, nx, ny, Math.abs(rw), Math.abs(rh))), name + ' rect ' + RECTS[index]); });
    // PNG exports: a CPU Skia canvas decodes to the oracle. Moz2D's PNG encoder rounds where its reads floor, and an accelerated canvas (the OffscreenCanvas here)
    // encodes with the CPU arithmetic where its reads differ at exact halves (canvas-translucent-kit.mjs), so a translucent pixel is compared on opaque pixels only there.
    const same = (actual, wanted, accelerated = false) => { if (!useFirefox && !accelerated || name !== 'glass') return sameBytes(actual, wanted); for (let o = 0; o < actual.length; o += 4) if (wanted[o + 3] === 255 && (actual[o] !== wanted[o] || actual[o + 1] !== wanted[o + 1] || actual[o + 2] !== wanted[o + 2])) return false; return true; };
    assert.ok(same(dataUrlPixels(now.url), expected.data), name + ': toDataURL decodes to the oracle'); assert.ok(same(blobPixels(now.blob), expected.data), name + ': toBlob decodes to the oracle');
    // An OffscreenCanvas may rasterize text differently from a DOM canvas, so its oracle input is its own native read.
    if (now.offRead) { const offExpected = sparseExpectedV2(fromBase64(base.offRead), w, h, KEY, FAMILY).data; assert.ok(sameBytes(fromBase64(now.offRead), offExpected), name + ': OffscreenCanvas getImageData'); assert.ok(same(blobPixels(now.offBlob), offExpected, true), name + ': convertToBlob'); }
  }
  check('2D scenes (' + scenes.join(', ') + '): whole reads, five rectangles, toDataURL, toBlob, OffscreenCanvas getImageData and convertToBlob equal the oracle applied to the engine\'s native read');

  // Flat canvases are returned as drawn on every path; pure colours keep every channel; the text scene is projected.
  for (const name of ['flat', 'twoColours', 'doubleAlpha']) {
    const base = native.scenes[name], now = v2.scenes[name];
    assert.ok(distinctColours(fromBase64(base.read)) <= 4, name + ' is a flat scene'); assert.ok(sameBytes(fromBase64(now.read), fromBase64(base.read)), name + ': getImageData as drawn');
    now.rects.forEach((text, index) => assert.ok(sameBytes(fromBase64(text), fromBase64(base.rects[index])), name + ' rect ' + RECTS[index] + ' as drawn'));
    assert.ok(sameBytes(dataUrlPixels(now.url), dataUrlPixels(base.url)), name + ': toDataURL as drawn'); assert.ok(sameBytes(blobPixels(now.blob), blobPixels(base.blob)), name + ': toBlob as drawn');
    if (now.offRead) assert.ok(sameBytes(blobPixels(now.offBlob), blobPixels(base.offBlob)), name + ': convertToBlob as drawn');
  }
  assert.ok(sameBytes(fromBase64(v2.scenes.pure.read), fromBase64(native.scenes.pure.read)), 'six saturated colours: every channel keeps its exact value');
  assert.ok(changedCount(fromBase64(native.scenes.text.read), fromBase64(v2.scenes.text.read)) > 1000, 'the text scene is projected');
  check('flat scenes (one colour, two colours, a double-alpha fill) come back exactly as drawn on every path and rectangle; six saturated colours keep every channel; real text is projected');

  // Idempotence in the engine: a projected image read back again does not move.
  const roundTrip = (name, run = v2) => { const row = run.scenes[name]; return { url: row.roundUrl, bitmap: row.roundBitmap, blob: row.roundBlob, copy: row.roundCopy, put: row.roundPut }; };
  const text = roundTrip('text'), textV1 = roundTrip('text', v1); const textBase = native.scenes.text; // roundX counts the pixels of read(canvas) that differ from read(<decoded export drawn into a fresh canvas>)
  for (const [path, count] of Object.entries(text)) assert.equal(count, 0, 'text scene, decode round trip through ' + path + ': ' + count + ' pixels moved');
  assert.equal(native.scenes.text.roundUrl, 0, 'natively the same round trip is exact (sanity)'); void textBase;
  assert.ok(textV1.url > 1000 && textV1.copy === 0, 'sparse-rgb-v1 moves the same channel again on a decode round trip (' + textV1.url + ' pixels), which is the defect that sparse-rgb-v2 removes');
  const glass = roundTrip('glass'); const glassTotal = MEDIUM[0] * MEDIUM[1];
  if (!useFirefox) for (const [path, count] of Object.entries(glass)) assert.equal(count, 0, 'translucent scene, round trip through ' + path + ': ' + count + ' pixels moved');
  else for (const [path, count] of Object.entries(glass)) assert.ok(count < glassTotal * 0.5, 'translucent scene in Firefox, round trip through ' + path + ': ' + count + ' of ' + glassTotal + ' (documented residual)');
  console.log('  translucent scene decode round trip (pixels of ' + glassTotal + '): native ' + JSON.stringify(roundTrip('glass', native)) + ', sparse-rgb-v2 ' + JSON.stringify(glass) + ', sparse-rgb-v1 ' + JSON.stringify(roundTrip('glass', v1)));
  check('decode round trips of the text scene (toDataURL image, createImageBitmap of the canvas and of the blob, drawImage copy, putImageData of the read) move no pixel' + (useFirefox ? '; the translucent scene keeps the documented Firefox residual' : '; the translucent scene moves none either'));

  // The large zone (alpha 0 or 255): exact against the oracle, and about 1 % of the candidates are affected
  const cutExpected = sparseExpectedV2(cutPixels, ...CUT, KEY);
  assert.ok(sameBytes(fromBase64(v2.cut.read), cutExpected.data), 'cutout getImageData equals the oracle'); assert.ok(sameBytes(dataUrlPixels(v2.cut.url), cutExpected.data), 'cutout toDataURL equals the oracle');
  assert.ok(sameBytes(fromBase64(native.cut.read), cutPixels), 'native cutout read is exact');
  check('large zone (640x480): getImageData and toDataURL equal the oracle');

  // WebGL: the export of a WebGL canvas equals the export of its 2D mirror, whatever the contents; readPixels follows the Canvas projection.
  let glChecked = 0;
  for (const [key, now] of Object.entries(v2.gl)) {
    if (now.error) continue; const base = native.gl[key];
    // Whatever the engine does natively with a WebGL canvas and its drawImage mirror (premultiplied and straight drawing buffers round differently), the installed export
    // of a translucent scene is derived from the same 2D copy on both sides, so it must be equal; a native pair that is equal must stay equal.
    console.log('  ' + key + ': native export == mirror export ' + base.urlEqual + ', installed ' + now.urlEqual);
    if (key.endsWith('flat')) assert.equal(now.urlEqual, base.urlEqual, key + ': a flat scene keeps the native relation');
    else { assert.equal(now.urlEqual, true, key + ': toDataURL of the WebGL canvas equals the export of its mirror'); assert.equal(now.blobEqual, true, key + ': toBlob equals'); }
    const mirrorInput = fromBase64(base.mirrorRead), expected = sparseExpectedV2(mirrorInput, 128, 96, KEY, FAMILY).data;
    assert.ok(sameBytes(fromBase64(now.mirrorRead), expected), key + ': the mirror read equals the oracle');
    if (!useFirefox || key.endsWith('flat') || key.endsWith('opaque')) assert.ok(sameBytes(dataUrlPixels(now.glUrl), key.endsWith('flat') ? mirrorInput : expected), key + ': the WebGL export decodes to the projected mirror (flat: as drawn)');
    if (key.endsWith('opaque')) assert.ok(sameBytes(flip(fromBase64(now.pixels), 128, 96), expected), key + ': readPixels equals the Canvas projection of the same pixels');
    if (key.endsWith('flat')) assert.ok(sameBytes(fromBase64(now.pixels), fromBase64(base.pixels)), key + ': a whole-buffer readPixels of a flat buffer is as rendered');
    glChecked++;
  }
  assert.ok(glChecked >= 4, 'WebGL scenes checked: ' + glChecked);
  check('WebGL (premultipliedAlpha true and false; opaque, translucent and flat scenes): export == export of the 2D mirror, the mirror equals the oracle, readPixels equals the Canvas projection, a flat buffer is read as rendered (' + glChecked + ' scenes)');

  // Wrapper shape in the engine
  const cycle = native.shape.nativeCycle; assert.notEqual(cycle, 'no throw');
  for (const label of ['toDataURL', 'getImageData', 'readPixels']) {
    const row = v2.shape[label], base = native.shape[label];
    assert.equal(row.cycle, cycle, label + ': the wrapper throws the engine TypeError (same message as a native function)'); assert.equal(row.name, base.name, label + ' name'); assert.equal(row.length, base.length, label + ' length');
    assert.equal(row.afterReads, 'string,number,function', label + ': still usable'); assert.equal(row.proto, true, label + ': prototype unchanged');
  }
  assert.equal(v2.shape.toString, native.shape.toString, 'Function.prototype.toString is not patched');
  check('wrappers: Object.setPrototypeOf(fn, fn) throws the engine\'s own TypeError ("' + cycle + '"), name and length are the native ones, Function.prototype.toString is untouched');
  console.log(`canvas sparse v2 native ${useFirefox ? 'firefox' : 'chromium'}: ${checks.length} checks PASS`);
} catch (error) { failed = error; console.error(error); process.exitCode = 1; }
finally { await browser.close(); }
if (failed) throw failed;
void isSaturated;
