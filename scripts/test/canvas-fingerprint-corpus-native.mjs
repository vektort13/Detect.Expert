// ADR-066 / ADR-107 / ADR-112: library-shaped fingerprint canvases under sparse-rgb-v1 (default here) or sparse-rgb-v2 (--algorithm sparse-rgb-v2) in a real engine
// (no extension package, no dist/ needed). Under sparse-rgb-v2 an opaque pixel is marked when its keyed bit differs from the lowest bit of an unsaturated channel
// (so "every opaque pixel is marked" becomes "reads equal the oracle"), and a flat canvas stays as drawn.
// The production installer text is injected at document start into owned pages on two fake https top-level sites. For a corpus of
// typical library drawings (FingerprintJS-like text and geometry, emoji, 'Hello, world!' and 'abc' on transparent canvases, antialiased
// lines) and 20 seeds (four with the high bit set) x 2 sites, it checks: no output equals the native pixels, every opaque pixel is
// marked, outputs are pairwise distinct, reads equal the independent oracle of canvas-sparse-kit.mjs and PNG exports decode to the read.
// Translucent pixels (antialiased edges, 0.2-alpha fills, a copy at globalAlpha 0.99) are marked too: every byte that moved is a byte this
// engine returns for that alpha (measured live in an uncovered Worker, put then get of every value), and a marked pixel exports as a
// native canvas holding the marked bytes would. Adversarial cases: the 0.99 copy, fill-rect-and-compare (detectable by design), and WebGL
// readPixels against toDataURL.
// Usage: node scripts/test/canvas-fingerprint-corpus-native.mjs [--firefox] [--algorithm sparse-rgb-v2]   (--firefox: Playwright's Firefox build, see canvas-sparse-native.mjs)
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, firefox } from 'playwright';
import { installCanvasCustom } from '../../apps/production-extension/api-custom-canvas-runtime.js';
import { installSurfaceCustom } from '../../apps/production-extension/api-custom-surfaces-runtime.js';
import { sessionKey, sparseExpected, sparseExpectedV2, decodePng, sameBytes } from './canvas-sparse-kit.mjs';

const algorithmIndex = process.argv.indexOf('--algorithm'), ALGORITHM = algorithmIndex >= 0 ? process.argv[algorithmIndex + 1] : 'sparse-rgb-v1', V2 = ALGORITHM === 'sparse-rgb-v2';
if (!['sparse-rgb-v1', 'sparse-rgb-v2'].includes(ALGORITHM)) throw new Error('--algorithm must be sparse-rgb-v1 or sparse-rgb-v2');
const useFirefox = process.argv.includes('--firefox'), SITES = ['https://site-a.test', 'https://site-b.test'], FAMILY = useFirefox ? 2 : 1;
const SEEDS = ['f'.repeat(64), '8' + '0'.repeat(63), '80000000'.repeat(8), 'ffffffff'.repeat(7) + '7fffffff'];
for (let index = 4; index < 20; index++) SEEDS.push(createHash('sha256').update('corpus-seed-' + index).digest('hex'));
const sha1 = bytes => createHash('sha1').update(bytes).digest('hex');
const checks = [], check = message => { checks.push(message); console.log('  ok ' + message); };

// Runs inside the page: draws the corpus and the adversarial cases; returns pixels as base64 (all canvases are small).
async function corpusProbe() {
  const b64 = bytes => { let text = ''; for (let index = 0; index < bytes.length; index += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(index, index + 0x8000)); return btoa(text); };
  const make = (w, h, paint) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); paint(x); return c; };
  // Warm the fonts once so the corpus is drawn with the same faces in every document.
  make(400, 60, x => { for (const font of ['11pt "Times New Roman"', '18pt Arial', '20px sans-serif', '16px Arial', '12px sans-serif']) { x.font = font; x.fillText('Cwm fjordbank gly \u{1F603} Hello, world! abc', 2, 30); } });
  await document.fonts.ready; await new Promise(resolve => setTimeout(resolve, 50));
  const shapes = {
    'text-240x60': make(240, 60, x => { x.textBaseline = 'alphabetic'; x.fillStyle = '#f60'; x.fillRect(100, 1, 62, 20); x.fillStyle = '#069'; x.font = '11pt "Times New Roman"'; x.fillText('Cwm fjordbank gly \u{1F603}', 2, 15); x.fillStyle = 'rgba(102, 204, 0, 0.2)'; x.font = '18pt Arial'; x.fillText('Cwm fjordbank gly \u{1F603}', 4, 45); }),
    'geometry-122x110': make(122, 110, x => { x.globalCompositeOperation = 'multiply'; for (const [c, cx, cy] of [['#f2f', 40, 40], ['#2ff', 80, 40], ['#ff2', 60, 80]]) { x.fillStyle = c; x.beginPath(); x.arc(cx, cy, 40, 0, Math.PI * 2, true); x.closePath(); x.fill(); } x.fillStyle = '#f9c'; x.arc(60, 60, 60, 0, Math.PI * 2, true); x.arc(60, 60, 20, 0, Math.PI * 2, true); x.fill('evenodd'); }),
    'emoji-60x30': make(60, 30, x => { x.font = '20px sans-serif'; x.fillText('\u{1F603}', 0, 24); }),
    'hello-220x30': make(220, 30, x => { x.font = '16px Arial'; x.fillStyle = '#069'; x.fillText('Hello, world!', 2, 20); }),
    'abc-120x20': make(120, 20, x => { x.font = '12px sans-serif'; x.fillText('abc', 2, 14); }),
    'lines-300x150': make(300, 150, x => { x.strokeStyle = '#333'; x.lineWidth = 1; for (let i = 0; i < 12; i++) { x.beginPath(); x.moveTo(3 + i * 23.5, 3); x.lineTo(290 - i * 17.25, 147); x.stroke(); } }),
  };
  // The canvas's own native pixels, read in a Worker the installer does not cover (text rendering may differ between documents,
  // e.g. while a fallback font loads, so every comparison uses the pixels of the same canvas).
  const worker = new Worker(URL.createObjectURL(new Blob([`onmessage = event => { const bitmap = event.data, canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(bitmap, 0, 0); const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data; postMessage(data.buffer, [data.buffer]); };`], { type: 'text/javascript' })));
  const nativeOf = async canvas => { const bitmap = await createImageBitmap(canvas); return new Promise(resolve => { worker.onmessage = event => resolve(new Uint8Array(event.data)); worker.postMessage(bitmap, [bitmap]); }); };
  const out = { shapes: {} };
  for (const [name, canvas] of Object.entries(shapes)) out.shapes[name] = { w: canvas.width, h: canvas.height, read: b64(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data), url: canvas.toDataURL(), native: b64(await nativeOf(canvas)) };
  // Adversarial: the opaque text scene copied at globalAlpha 0.99 (every pixel translucent).
  const scene = make(240, 60, x => { x.fillStyle = '#fff'; x.fillRect(0, 0, 240, 60); x.fillStyle = '#069'; x.font = '11pt "Times New Roman"'; x.fillText('Cwm fjordbank gly \u{1F603}', 2, 15); });
  const copy = make(240, 60, x => { x.globalAlpha = 0.99; x.drawImage(scene, 0, 0); });
  out.copy99 = b64(copy.getContext('2d').getImageData(0, 0, 240, 60).data); out.copy99Native = b64(await nativeOf(copy));
  // Adversarial: fill a rectangle with a known colour and compare.
  const fill = make(100, 100, x => { x.fillStyle = 'rgb(10, 200, 30)'; x.fillRect(0, 0, 100, 100); });
  out.fill = b64(fill.getContext('2d').getImageData(0, 0, 100, 100).data);
  // WebGL readPixels and toDataURL of the same drawing buffer (compared only once the webgl-readback projection uses the canvas key).
  const gl = document.createElement('canvas'); gl.width = 64; gl.height = 32;
  const context = gl.getContext('webgl', { preserveDrawingBuffer: true, antialias: false });
  if (context) {
    context.clearColor(0.2, 0.4, 0.6, 1); context.clear(context.COLOR_BUFFER_BIT); context.enable(context.SCISSOR_TEST);
    for (const [rect, colour] of [[[8, 4, 20, 10], [0.9, 0.1, 0.3, 1]], [[32, 10, 16, 8], [0.3, 0.8, 0.2, 1]], [[2, 20, 10, 8], [0.7, 0.7, 0.1, 1]], [[50, 2, 10, 10], [0.1, 0.2, 0.9, 1]]]) { context.scissor(...rect); context.clearColor(...colour); context.clear(context.COLOR_BUFFER_BIT); }
    context.disable(context.SCISSOR_TEST);
    const pixels = new Uint8Array(64 * 32 * 4); try { context.readPixels(0, 0, 64, 32, context.RGBA, context.UNSIGNED_BYTE, pixels); out.glRead = b64(pixels); } catch (error) { out.glReadError = error.name; }
    try { out.glUrl = gl.toDataURL(); } catch (error) { out.glUrlError = error.name; }
  }
  return out;
}

// Runs in an uncovered page: for every alpha 1..254 and value 0..255 put the straight pixel in an OffscreenCanvas of a Worker and read it back
// (software and default canvas), and export the same canvas as PNG. Returns R-channel tables indexed alpha * 256 + value.
async function referenceProbe() {
  const worker = new Worker(URL.createObjectURL(new Blob([`onmessage = async event => { const out = []; for (const frequent of [true, false]) { const canvas = new OffscreenCanvas(256, 256), context = canvas.getContext('2d', { willReadFrequently: frequent }); const data = new Uint8ClampedArray(256 * 256 * 4); for (let a = 0; a < 256; a++) for (let v = 0; v < 256; v++) data.set([v, v, v, a], (a * 256 + v) * 4); context.putImageData(new ImageData(data, 256, 256), 0, 0); const got = context.getImageData(0, 0, 256, 256).data; const table = new Uint8Array(65536); for (let i = 0; i < 65536; i++) table[i] = got[i * 4]; out.push(table); if (frequent) out.push(new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer())); } postMessage(out); };`], { type: 'text/javascript' })));
  const reply = await new Promise(resolve => { worker.onmessage = event => resolve(event.data); worker.postMessage(0); });
  const b64 = bytes => { let text = ''; for (let index = 0; index < bytes.length; index += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(index, index + 0x8000)); return btoa(text); };
  worker.terminate(); return { soft: b64(reply[0]), png: b64(reply[1]), gpu: b64(reply[2]) };
}

function firefoxExecutable() {
  if (process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE) return process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE;
  const base = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  const candidates = existsSync(base) ? readdirSync(base).filter(name => /^firefox-[0-9]+$/.test(name)).sort((a, b) => Number(b.slice(8)) - Number(a.slice(8))) : [];
  for (const name of candidates) { const path = join(base, name, 'firefox', 'firefox.exe'); if (existsSync(path)) return path; }
  return undefined;
}
const browser = await (useFirefox ? firefox : chromium).launch(useFirefox ? { executablePath: firefoxExecutable() } : { channel: 'chromium' });
console.log('canvas fingerprint corpus: ' + (useFirefox ? 'Playwright Firefox ' : 'Chromium ') + browser.version());
async function run(site, seed) {
  const context = await browser.newContext();
  await context.route(site + '/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>corpus</title>' }));
  if (seed) await context.addInitScript(`(${installCanvasCustom.toString()})(globalThis, ${JSON.stringify([{ id: 'canvas-readback', mode: 'custom', value: { algorithm: ALGORITHM }, canvasSeed: seed }])});`);
  const page = await context.newPage(); page.setDefaultTimeout(120000); await page.goto(site + '/');
  try { return await page.evaluate(corpusProbe); } finally { await context.close(); }
}
async function runReference() {
  const context = await browser.newContext(); await context.route(SITES[0] + '/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>reference</title>' }));
  const page = await context.newPage(); page.setDefaultTimeout(120000); await page.goto(SITES[0] + '/');
  try { return await page.evaluate(referenceProbe); } finally { await context.close(); }
}
// WebGL readPixels against toDataURL of the same drawing buffer, with canvas-readback and webgl-readback both Custom and the WebGL
// row carrying the canvas key (ADR-107): one small, one medium and one large drawing buffer.
async function runGl(site, seed) {
  const context = await browser.newContext(), canvasRow = { id: 'canvas-readback', mode: 'custom', value: { algorithm: ALGORITHM }, canvasSeed: seed };
  const glRow = { id: 'webgl-readback', mode: 'custom', value: { seed: '00112233445566778899aabbccddeeff' }, webglKey: 'fedcba9876543210'.repeat(4), canvasKey: seed };
  await context.route(site + '/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>webgl</title>' }));
  await context.addInitScript(`(${installCanvasCustom.toString()})(globalThis, ${JSON.stringify([canvasRow])}); (${installSurfaceCustom.toString()})(globalThis, ${JSON.stringify([canvasRow, glRow])});`);
  const page = await context.newPage(); page.setDefaultTimeout(120000); await page.goto(site + '/');
  try {
    return await page.evaluate(sizes => sizes.map(([w, h]) => {
      const b64 = bytes => { let text = ''; for (let index = 0; index < bytes.length; index += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(index, index + 0x8000)); return btoa(text); };
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: false }); if (!gl) return { w, h, error: 'no webgl' };
      gl.clearColor(0.2, 0.4, 0.6, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.enable(gl.SCISSOR_TEST);
      for (const [rect, colour] of [[[8, 4, 20, 10], [0.9, 0.1, 0.3, 1]], [[32, 10, 16, 8], [0.3, 0.8, 0.2, 1]], [[2, 20, 10, 8], [0.7, 0.7, 0.1, 1]], [[50, 2, 10, 10], [0.1, 0.2, 0.9, 1]], [[w - 40, h - 30, 30, 20], [0.5, 0.5, 0.5, 1]]]) { gl.scissor(...rect); gl.clearColor(...colour); gl.clear(gl.COLOR_BUFFER_BIT); }
      gl.disable(gl.SCISSOR_TEST);
      const pixels = new Uint8Array(w * h * 4); let read = null, url = null, error = null;
      try { gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels); read = b64(pixels); } catch (failure) { error = 'readPixels ' + failure.name; }
      try { url = canvas.toDataURL(); } catch (failure) { error = (error ? error + ', ' : '') + 'toDataURL ' + failure.name; }
      return { w, h, read, url, error };
    }), [[64, 32], [512, 300], [600, 450]]);
  } finally { await context.close(); }
}
const pixels = text => new Uint8ClampedArray(Buffer.from(text, 'base64'));
const png = url => decodePng(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')).data;
// The export of a pixel: opaque pixels equal the read exactly; a translucent pixel that was NOT marked exports like the native canvas does;
// one that was marked (read differs from the native read) exports like a native canvas holding the marked byte (putImageData then PNG,
// measured in the Worker: pngOfPut). Engines unpremultiply PNG and getImageData differently, so the export is not compared with the read.
function exportMatches(decoded, read, base, nativeDecoded) {
  for (let o = 0; o < read.length; o += 4) {
    const alpha = read[o + 3]; if (decoded[o + 3] !== alpha) return false;
    for (let c = 0; c < 3; c++) {
      const expected = alpha === 255 ? read[o + c] : alpha !== 0 && read[o + c] !== base[o + c] ? pngOfPut[alpha * 256 + read[o + c]] : nativeDecoded[o + c];
      if (decoded[o + c] !== expected) return false;
    }
  }
  return true;
}
let pngOfPut = null; // alpha * 256 + value -> the PNG value of a canvas that holds value at alpha, filled in from the reference run
const reachable = new Map(); // alpha -> the bytes this engine returns for it (software and default canvas)
const reaches = (alpha, value) => reachable.get(alpha).has(value);
const changed = (a, b) => { let count = 0; for (let o = 0; o < a.length; o += 4) if (a[o] !== b[o] || a[o + 1] !== b[o + 1] || a[o + 2] !== b[o + 2] || a[o + 3] !== b[o + 3]) count++; return count; };
const opaque = data => { let count = 0; for (let o = 3; o < data.length; o += 4) if (data[o] === 255) count++; return count; };
// Opaque pixels are the same on every read path; translucent ones may be unpremultiplied differently by the Worker/ImageBitmap path.
const sameOpaque = (a, b) => { for (let o = 0; o < a.length; o += 4) if ((a[o + 3] === 255 || b[o + 3] === 255) && (a[o] !== b[o] || a[o + 1] !== b[o + 1] || a[o + 2] !== b[o + 2] || a[o + 3] !== b[o + 3])) return false; return true; };
let failed = null;
try {
  const reference = await runReference(), softTable = new Uint8Array(Buffer.from(reference.soft, 'base64')), gpuTable = new Uint8Array(Buffer.from(reference.gpu, 'base64'));
  { const decoded = decodePng(Buffer.from(reference.png, 'base64')); pngOfPut = new Uint8Array(65536); for (let index = 0; index < 65536; index++) pngOfPut[index] = decoded.data[index * 4];
    for (let alpha = 1; alpha < 255; alpha++) { const set = new Set(); for (let value = 0; value < 256; value++) { set.add(softTable[alpha * 256 + value]); set.add(gpuTable[alpha * 256 + value]); } reachable.set(alpha, set); } }
  const native = await run(SITES[0], null), nativeOther = await run(SITES[1], null);
  let unstable = 0, pathDiffers = 0;
  for (const name of Object.keys(native.shapes)) {
    const read = pixels(native.shapes[name].read), bitmap = pixels(native.shapes[name].native);
    assert.ok(sameOpaque(read, bitmap), name + ': without the installer the opaque pixels of getImageData are the native bitmap');
    if (!sameBytes(read, bitmap)) pathDiffers++;
    if (!sameBytes(read, pixels(nativeOther.shapes[name].read))) unstable++;
  }
  if (pathDiffers) console.log(`  note: in ${pathDiffers} corpus drawings this engine unpremultiplies translucent pixels differently for getImageData and for an ImageBitmap read in a Worker (opaque pixels agree)`);
  const runs = [];
  for (const seed of SEEDS) for (const site of SITES) runs.push({ seed, site, result: await run(site, seed) });
  const table = {};
  for (const [name, shape] of Object.entries(native.shapes)) {
    const hashes = new Set(), marks = [], counts = new Set(), translucent = [];
    for (const [index, { seed, site, result }] of runs.entries()) {
      // Every comparison uses the bitmap of the same canvas, read natively in a Worker; where it equals the native document's drawing,
      // that document's getImageData supplies the translucent pixels (identical paths, identical drawing).
      const read = pixels(result.shapes[name].read), bitmap = pixels(result.shapes[name].native), sameDrawing = sameBytes(bitmap, pixels(shape.native));
      const base = sameDrawing ? pixels(shape.read) : bitmap, opaquePixels = opaque(base);
      let moved = 0, translucentPixels = 0, movedTranslucent = 0;
      for (let o = 0; o < base.length; o += 4) {
        const alpha = base[o + 3], differs = read[o] !== base[o] || read[o + 1] !== base[o + 1] || read[o + 2] !== base[o + 2];
        assert.equal(read[o + 3], alpha, `${name}: alpha is never touched`);
        if (alpha === 255 && differs) moved++;
        else if (alpha === 0) assert.ok(!differs, `${name}: a transparent pixel moved`);
        else if (alpha !== 255) { translucentPixels++; if (differs) movedTranslucent++; for (let c = 0; c < 3; c++) if (read[o + c] !== base[o + c]) assert.ok(reaches(alpha, read[o + c]), `${name}: alpha ${alpha}: ${base[o + c]} -> ${read[o + c]} is not a byte this engine returns`); }
      }
      if (V2) assert.ok(moved <= opaquePixels, `${name}: only opaque pixels with an unsaturated channel move`);
      else { assert.equal(moved, opaquePixels, `${name}: every opaque pixel is marked for ${seed.slice(0, 8)} on ${site}`); assert.ok(moved > 0, `${name}: output equals native`); }
      if (sameDrawing) { assert.equal(changed(base, read), moved + movedTranslucent, `${name}: nothing but opaque and translucent pixels moved`); assert.ok(!sameBytes(read, base), `${name}: output equals native for ${seed.slice(0, 8)} on ${site}`); }
      if (translucentPixels >= 100) assert.ok(movedTranslucent >= translucentPixels * (V2 ? (FAMILY === 1 ? 0.3 : 0.2) : FAMILY === 1 ? 0.97 : 0.7), `${name}: only ${movedTranslucent} of ${translucentPixels} translucent pixels are marked`);
      translucent.push([translucentPixels, movedTranslucent]);
      marks.push(opaquePixels); counts.add(sha1(bitmap)); hashes.add(sha1(read));
      if (index < 8 || index % 9 === 0) {
        const expected = (V2 ? sparseExpectedV2 : sparseExpected)(base, shape.w, shape.h, sessionKey(seed, site), FAMILY).data;
        assert.ok(sameDrawing ? sameBytes(read, expected) : sameOpaque(read, expected), `${name}: oracle for ${seed.slice(0, 8)} on ${site}`);
        if (sameDrawing) assert.ok(exportMatches(png(result.shapes[name].url), read, base, png(shape.url)), `${name}: PNG decodes to the read (opaque), to the native export (unmarked) and to the native export of the marked byte (marked translucent)`);
      }
    }
    table[name] = { opaque: Math.min(...marks), distinct: hashes.size, natives: counts.size, translucent: Math.max(...translucent.map(row => row[0])), movedTranslucent: Math.min(...translucent.map(row => row[1])) };
    console.log(`  ${name.padEnd(17)} opaque ${String(Math.min(...marks)).padStart(5)}${Math.max(...marks) !== Math.min(...marks) ? '..' + Math.max(...marks) : ''} | ${V2 ? 'unsaturated opaque pixels marked by parity' : 'every opaque pixel marked'} | translucent ${String(table[name].translucent).padStart(5)} (>= ${table[name].movedTranslucent} marked) | distinct outputs ${hashes.size} of ${runs.length}${counts.size > 1 ? ` (native bitmap differed between documents: ${counts.size} variants)` : ''}`);
    if (V2 || Math.min(...marks) >= 15) assert.equal(hashes.size, runs.length, `${name}: pairwise distinct`);
  }
  if (unstable) console.log(`  note: ${unstable} corpus drawings rendered differently in two native documents of this engine`);
  check(`${ALGORITHM}: corpus x ${SEEDS.length} seeds (4 with the high bit set) x ${SITES.length} sites: no output equals native, ${V2 ? 'unsaturated opaque pixels are marked by parity' : 'every opaque pixel is marked'}, every moved translucent byte is returned by the engine, reads equal the oracle, exports equal the native export of the marked bytes`);
  const few = Object.entries(table).filter(([, row]) => row.opaque < 15);
  check('pairwise distinct for every corpus canvas with at least 15 opaque pixels' + (few.length ? '; fewer opaque pixels: ' + few.map(([name, row]) => `${name} ${row.distinct}/${runs.length}`).join(', ') + ' (fewer pixels than the 15 needed for pairwise distinct keys)' : ''));
  // Adversarial cases
  // A drawing copied at globalAlpha 0.99 has no opaque pixel (alpha 252 everywhere): translucent marking is what keeps it from reading natively.
  // The page canvas may be read through the CPU or the GPU arithmetic, which differ by a level only at exact halves: the same bytes read in a
  // Worker through the software path (copy99Native) and the native document's own read (native.copy99) are the two native readings.
  const docNative = pixels(native.copy99), copyHashes = new Set(); let copyMarked = 0;
  for (const { seed, site, result } of runs) {
    const read = pixels(result.copy99), cpuNative = pixels(result.copy99Native); let marked = 0, total = 0;
    for (let o = 0; o < read.length; o += 4) {
      const alpha = read[o + 3]; assert.ok(alpha > 0 && alpha < 255, 'the 0.99 copy has no opaque pixel'); total++;
      let differs = false; for (let c = 0; c < 3; c++) if (read[o + c] !== docNative[o + c] && read[o + c] !== cpuNative[o + c]) { differs = true; assert.ok(reaches(alpha, read[o + c]), `copy99 alpha ${alpha}: ${docNative[o + c]} -> ${read[o + c]} is not a byte this engine returns`); }
      if (differs) marked++;
    }
    assert.ok(marked >= total * (V2 ? (FAMILY === 1 ? 0.4 : 0.3) : 0.95), `copy99 for ${seed.slice(0, 8)} on ${site}: only ${marked} of ${total} pixels are marked`);
    copyHashes.add(sha1(read)); copyMarked = Math.min(copyMarked || total, marked);
  }
  assert.equal(copyHashes.size, runs.length, 'the 0.99 copy reads differently for every key');
  check(`a copy at globalAlpha 0.99 (alpha ${docNative[3]} everywhere, no opaque pixel) is marked for all ${runs.length} keys: at least ${copyMarked} of 14400 pixels differ from both native readings, every moved byte is returned by this engine, all ${copyHashes.size} outputs differ (before translucent marking it read natively for every key)`);
  const fill = pixels(runs[0].result.fill), fillNative = pixels(native.fill);
  if (V2) { assert.equal(changed(fillNative, fill), 0, 'a flat canvas stays as drawn'); check('fill-rect-and-compare reads back exactly as drawn: a filled 100x100 canvas has one colour, so sparse-rgb-v2 leaves it alone (ADR-112)'); }
  else { assert.equal(changed(fillNative, fill), 100 * 100, 'fill-rect-and-compare: every filled pixel of a 100x100 canvas differs (one level of one channel)');
    check('fill-rect-and-compare is detectable by design: all 10000 pixels of a filled 100x100 canvas differ by one level of one channel'); }
  if (native.glRead && runs[0].result.glRead && runs[0].result.glUrl) {
    // Without the webgl-readback row readPixels stays native while the export is projected: they must differ.
    const glRead = pixels(runs[0].result.glRead), decoded = png(runs[0].result.glUrl);
    let differ = 0; for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) for (let c = 0; c < 4; c++) if (glRead[((31 - y) * 64 + x) * 4 + c] !== decoded[(y * 64 + x) * 4 + c]) differ++;
    assert.ok(differ > 0, 'canvas-readback alone projects the WebGL export, not readPixels');
    if (installSurfaceCustom.toString().includes('canvasKey')) {
      for (const [seed, site] of [[SEEDS[0], SITES[0]], [SEEDS[5], SITES[1]]]) for (const row of await runGl(site, seed)) {
        assert.equal(row.error, null, `${row.w}x${row.h}: ${row.error}`);
        const read = pixels(row.read), image = png(row.url); let mismatch = 0;
        for (let y = 0; y < row.h; y++) for (let x = 0; x < row.w; x++) for (let c = 0; c < 4; c++) if (read[((row.h - 1 - y) * row.w + x) * 4 + c] !== image[(y * row.w + x) * 4 + c]) mismatch++;
        assert.equal(mismatch, 0, `${row.w}x${row.h} readPixels (rows flipped) equals the toDataURL export for ${seed.slice(0, 8)} on ${site}`);
      }
      check('WebGL readPixels equals toDataURL of the same drawing buffer (64x32 small, 512x300 medium, 600x450 large) when webgl-readback carries the canvas key');
    } else console.log(`  TODO (agent A): readPixels vs toDataURL differ in ${differ} of ${64 * 32 * 4} bytes; the webgl-readback projection does not use the canvas key yet`);
  }
  console.log(`canvas fingerprint corpus ${useFirefox ? 'firefox' : 'chromium'}: ${checks.length} checks PASS`);
} catch (error) { failed = error; console.error(error); process.exitCode = 1; }
finally { await browser.close(); }
if (failed) throw failed;
