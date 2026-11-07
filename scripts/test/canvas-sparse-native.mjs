// ADR-066 / ADR-104 addendum 3: sparse-rgb-v1 in a real engine, without the extension package.
// The production installer text is injected at document start into owned pages served from fake https origins (no network, no dist/
// build needed). Everything the engine returns is compared with the independent oracle of canvas-sparse-kit.mjs: whole and partial
// getImageData reads, PNGs decoded by Node's zlib (toDataURL, toBlob, convertToBlob) and the size of a flat 2560x1440 export for the
// native, stable-rgb-v1 and sparse-rgb-v1 projections. Usage: node scripts/test/canvas-sparse-native.mjs [--firefox]
// Chromium is Playwright's channel 'chromium'. --firefox uses Playwright's own Firefox build: the newest ms-playwright/firefox-* folder that is
// installed, or the executable named by PLAYWRIGHT_FIREFOX_EXECUTABLE. Nothing is written to the repository.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, firefox } from 'playwright';
import { installCanvasCustom } from '../../apps/production-extension/api-custom-canvas-runtime.js';
import { SEED, ORIGIN, makeImage, sessionKey, sparseExpected, sparseGeometry, crop, decodePng, sameBytes, rng } from './canvas-sparse-kit.mjs';

const useFirefox = process.argv.includes('--firefox'), OTHER_ORIGIN = 'https://other.test', FAMILY = useFirefox ? 2 : 1;
const FLAT = [2560, 1440], CUT = [640, 480], ZONES = [[256, 256], [300, 150], [512, 512]];
const sha256 = bytes => createHash('sha256').update(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)).digest('hex');
const checks = [], check = message => { checks.push(message); console.log('  ok ' + message); };

// Runs inside the page. `config` carries the cutout pixels (base64) and the rectangles to read.
async function pageProbe(config) {
  const b64 = bytes => { let text = ''; for (let index = 0; index < bytes.length; index += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(index, index + 0x8000)); return btoa(text); };
  const unb64 = text => Uint8ClampedArray.from(atob(text), char => char.charCodeAt(0));
  const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const blobBase64 = async blob => b64(new Uint8Array(await blob.arrayBuffer()));
  const out = { timings: {} };
  const time = async (label, run) => { const start = performance.now(); const value = await run(); out.timings[label] = +(performance.now() - start).toFixed(1); return value; };
  // (1) flat canvas: sizes and whole-canvas reads
  const [W, H] = config.flat, flat = document.createElement('canvas'); flat.width = W; flat.height = H;
  const flatContext = flat.getContext('2d', { willReadFrequently: true }); flatContext.fillStyle = 'rgb(83,129,207)'; flatContext.fillRect(0, 0, W, H);
  const url = await time('flat toDataURL', () => flat.toDataURL());
  out.flatUrl = url; out.flatUrlBytes = Math.floor((url.length - url.indexOf(',') - 1) * 3 / 4);
  const blob = await time('flat toBlob', () => new Promise(resolve => flat.toBlob(resolve)));
  out.flatBlobBytes = blob.size; out.flatBlob = config.keepFlatBlob ? await blobBase64(blob) : null;
  const read = await time('flat getImageData', () => flatContext.getImageData(0, 0, W, H));
  out.flatReadHash = await hash(read.data);
  if (typeof OffscreenCanvas === 'function') {
    const off = new OffscreenCanvas(W, H), offContext = off.getContext('2d'); offContext.fillStyle = 'rgb(83,129,207)'; offContext.fillRect(0, 0, W, H);
    const converted = await time('flat convertToBlob', () => off.convertToBlob()); out.flatOffBytes = converted.size; out.flatOff = config.keepFlatBlob ? await blobBase64(converted) : null;
  }
  // (1b) flat canvases of the small and medium zones (every opaque pixel moves): PNG sizes and the read of the whole canvas
  out.zones = {};
  for (const [zw, zh] of config.zones) {
    const zone = document.createElement('canvas'); zone.width = zw; zone.height = zh; const zoneContext = zone.getContext('2d', { willReadFrequently: true });
    zoneContext.fillStyle = 'rgb(83,129,207)'; zoneContext.fillRect(0, 0, zw, zh);
    const zoneUrl = zone.toDataURL();
    out.zones[zw + 'x' + zh] = { bytes: Math.floor((zoneUrl.length - zoneUrl.indexOf(',') - 1) * 3 / 4), url: zoneUrl, readHash: await hash(zoneContext.getImageData(0, 0, zw, zh).data) };
  }
  // (2) cutout canvas (alpha 0 or 255 only): whole read, rectangles, every export path, drawImage copies
  const [cw, ch] = config.cut, pixels = unb64(config.cutPixels), cut = document.createElement('canvas'); cut.width = cw; cut.height = ch;
  const cutContext = cut.getContext('2d', { willReadFrequently: true }); cutContext.putImageData(new ImageData(pixels, cw, ch), 0, 0);
  out.cutRead = b64(cutContext.getImageData(0, 0, cw, ch).data);
  out.cutRects = config.rects.map(([x, y, w, h]) => b64(cutContext.getImageData(x, y, w, h).data));
  out.cutUrl = cut.toDataURL(); out.cutBlob = await blobBase64(await new Promise(resolve => cut.toBlob(resolve)));
  if (typeof OffscreenCanvas === 'function') {
    const off = new OffscreenCanvas(cw, ch), offContext = off.getContext('2d'); offContext.putImageData(new ImageData(unb64(config.cutPixels), cw, ch), 0, 0);
    out.cutOffRead = b64(offContext.getImageData(0, 0, cw, ch).data); out.cutOffBlob = await blobBase64(await off.convertToBlob());
  }
  const copy = document.createElement('canvas'); copy.width = cw; copy.height = ch; const copyContext = copy.getContext('2d', { willReadFrequently: true });
  copyContext.drawImage(cut, 0, 0); out.copyRead = b64(copyContext.getImageData(0, 0, cw, ch).data);
  const wider = document.createElement('canvas'); wider.width = cw + 1; wider.height = ch; const widerContext = wider.getContext('2d', { willReadFrequently: true });
  widerContext.drawImage(cut, 0, 0); out.widerRead = b64(widerContext.getImageData(0, 0, cw + 1, ch).data);
  // (3) translucent pixels: the cutout drawn at globalAlpha 0.99 and 0.5 (alpha 252 / 128 wherever it was opaque)
  for (const [label, alpha] of [['glass99', 0.99], ['glass50', 0.5]]) {
    const glass = document.createElement('canvas'); glass.width = cw; glass.height = ch; const glassContext = glass.getContext('2d', { willReadFrequently: true });
    glassContext.globalAlpha = alpha; glassContext.drawImage(cut, 0, 0); out[label] = b64(glassContext.getImageData(0, 0, cw, ch).data);
  }
  out.nativeFunctionString = Function.prototype.toString.toString(); out.locationOrigin = location.origin;
  return out;
}

// Playwright's own Firefox build: the one its version expects, else the newest firefox-* folder that is installed (or PLAYWRIGHT_FIREFOX_EXECUTABLE).
function firefoxExecutable() {
  if (process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE) return process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE;
  const base = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  const candidates = existsSync(base) ? readdirSync(base).filter(name => /^firefox-[0-9]+$/.test(name)).sort((a, b) => Number(b.slice(8)) - Number(a.slice(8))) : [];
  for (const name of candidates) { const path = join(base, name, 'firefox', 'firefox.exe'); if (existsSync(path)) return path; }
  return undefined;
}
const launcher = useFirefox ? firefox : chromium;
const browser = await launcher.launch(useFirefox ? { executablePath: firefoxExecutable() } : { channel: 'chromium' });
console.log('canvas sparse native: ' + (useFirefox ? 'Playwright Firefox ' : 'Chromium ') + browser.version());
const cutPixels = makeImage(...CUT, 'cutout', 7), cutBase64 = Buffer.from(cutPixels.buffer).toString('base64');
const next = rng(0xc0ffee), rects = [[0, 0, 1, 1], [CUT[0] - 1, CUT[1] - 1, 1, 1], [0, 0, CUT[0], 1], [5, 3, 200, 120], [-4, -4, 30, 30], [600, 440, 80, 80], [100, 100, -64, -48]];
while (rects.length < 40) rects.push([next() % (CUT[0] + 8) - 4, next() % (CUT[1] + 8) - 4, 1 + next() % 90, 1 + next() % 60]);

async function run(origin, algorithm, extra = {}) {
  const context = await browser.newContext(), host = new URL(origin).origin;
  await context.route(host + '/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>canvas</title>' }));
  if (algorithm) await context.addInitScript(`(${installCanvasCustom.toString()})(globalThis, ${JSON.stringify([{ id: 'canvas-readback', mode: 'custom', value: { algorithm }, canvasSeed: SEED }])});`);
  const page = await context.newPage(); page.setDefaultTimeout(240000); await page.goto(host + '/');
  try { return await page.evaluate(pageProbe, { flat: FLAT, zones: ZONES, cut: CUT, cutPixels: cutBase64, rects, keepFlatBlob: false, ...extra }); }
  finally { await context.close(); }
}
const bytes = text => Buffer.from(text.slice(text.indexOf(',') + 1), 'base64'), fromBase64 = text => new Uint8ClampedArray(Buffer.from(text, 'base64'));
const dataUrlPixels = text => decodePng(bytes(text)).data, blobPixels = text => decodePng(Buffer.from(text, 'base64')).data;
let failed = null;
try {
  const native = await run(ORIGIN, null), stable = await run(ORIGIN, 'stable-rgb-v1'), sparse = await run(ORIGIN, 'sparse-rgb-v1');
  // Native baseline: the engine returns the drawn pixels, so the oracle's input is exact.
  assert.ok(sameBytes(fromBase64(native.cutRead), cutPixels), 'native cutout read equals the drawn pixels');
  check('native baseline reads back the drawn cutout pixels exactly');

  // Exactness of the sparse projection against the independent oracle
  const key = sessionKey(SEED, ORIGIN), flatPixels = makeImage(...FLAT, 'flat'), flatExpected = sparseExpected(flatPixels, ...FLAT, key), cutExpected = sparseExpected(cutPixels, ...CUT, key);
  assert.equal(sparse.flatReadHash, sha256(flatExpected.data), 'flat getImageData equals the oracle');
  assert.ok(sameBytes(dataUrlPixels(sparse.flatUrl), flatExpected.data), 'flat toDataURL decodes to the oracle');
  const geometry = sparseGeometry(...FLAT); assert.equal(flatExpected.selected.length, FLAT[0] * FLAT[1] / geometry.step);
  check(`flat ${FLAT.join('x')}: getImageData and toDataURL equal the oracle (${flatExpected.selected.length} pixels move, runs of ${geometry.run})`);
  assert.ok(sameBytes(fromBase64(sparse.cutRead), cutExpected.data), 'cutout getImageData equals the oracle');
  sparse.cutRects.forEach((text, index) => { const [x, y, w, h] = rects[index], nx = w < 0 ? x + w : x, ny = h < 0 ? y + h : y, aw = Math.abs(w), ah = Math.abs(h); assert.ok(sameBytes(fromBase64(text), crop(cutExpected.data, ...CUT, nx, ny, aw, ah)), 'rect ' + rects[index]); });
  check(`cutout ${CUT.join('x')}: whole read and ${rects.length} rectangles (negative sizes, partly outside) equal the crops of the oracle`);
  assert.ok(sameBytes(dataUrlPixels(sparse.cutUrl), cutExpected.data), 'toDataURL'); assert.ok(sameBytes(blobPixels(sparse.cutBlob), cutExpected.data), 'toBlob');
  if (sparse.cutOffRead) { assert.ok(sameBytes(fromBase64(sparse.cutOffRead), cutExpected.data), 'Offscreen getImageData'); assert.ok(sameBytes(blobPixels(sparse.cutOffBlob), cutExpected.data), 'convertToBlob'); }
  check('toDataURL, toBlob' + (sparse.cutOffRead ? ', OffscreenCanvas getImageData and convertToBlob' : '') + ' decode (independent PNG decoder) to the same oracle pixels');
  assert.ok(sameBytes(fromBase64(sparse.copyRead), cutExpected.data), 'a drawImage copy of the same size reads like its source');
  const widerExpected = sparseExpected(crop(cutPixels, ...CUT, 0, 0, CUT[0] + 1, CUT[1]), CUT[0] + 1, CUT[1], key);
  assert.ok(sameBytes(fromBase64(sparse.widerRead), widerExpected.data), 'a copy on a canvas one pixel wider is keyed by its own size');
  check('drawImage copies: same size reads like the source, another size is keyed by its own width and height');
  assert.equal(sparse.nativeFunctionString, native.nativeFunctionString, 'Function.prototype.toString is not patched');
  let changed = 0; for (let index = 0; index < cutPixels.length; index += 4) { const a = cutPixels, b = fromBase64(sparse.cutRead); if (a[index] !== b[index] || a[index + 1] !== b[index + 1] || a[index + 2] !== b[index + 2]) changed++; assert.equal(a[index + 3], b[index + 3]); }
  assert.ok(changed > 0 && changed < CUT[0] * CUT[1] * 0.01 + 50, 'about one opaque pixel in a hundred moved: ' + changed);

  // Translucent pixels (header of the runtime, 'Translucent pixels'): the native run reads what the engine returns, the installed run is the oracle applied to it
  for (const label of ['glass99', 'glass50']) {
    const input = fromBase64(native[label]), read = fromBase64(sparse[label]), expected = sparseExpected(input, ...CUT, key, FAMILY).data;
    assert.ok(sameBytes(read, expected), label + ': getImageData equals the oracle'); let moved = 0, translucent = 0;
    for (let index = 0; index < input.length; index += 4) { if (input[index + 3] > 0 && input[index + 3] < 255) translucent++; if (input[index] !== read[index] || input[index + 1] !== read[index + 1] || input[index + 2] !== read[index + 2]) moved++; assert.equal(read[index + 3], input[index + 3]); }
    assert.ok(translucent > 100000 && moved > translucent * 0.005 && moved < translucent * 0.02, label + ': about one translucent pixel in a hundred moved: ' + moved + ' of ' + translucent);
    assert.ok(!sameBytes(read, input), label + ' is no longer read natively');
  }
  check('translucent cutout copies at globalAlpha 0.99 and 0.5: getImageData equals the oracle applied to the native read (about 1% of the translucent pixels move one stored state, as for opaque pixels)');

  // Key separation in the real engine
  const other = await run(OTHER_ORIGIN, 'sparse-rgb-v1'), again = await run(ORIGIN, 'sparse-rgb-v1');
  assert.equal(other.locationOrigin, OTHER_ORIGIN); assert.ok(sameBytes(fromBase64(other.cutRead), sparseExpected(cutPixels, ...CUT, sessionKey(SEED, OTHER_ORIGIN)).data), 'another site is keyed independently');
  assert.ok(!sameBytes(fromBase64(other.cutRead), fromBase64(sparse.cutRead)), 'two sites read different pixels');
  assert.equal(again.flatReadHash, sparse.flatReadHash); assert.ok(sameBytes(fromBase64(again.cutRead), fromBase64(sparse.cutRead)), 'a second document of the same site reads the same pixels');
  check('another top-level site is keyed independently (oracle) and a second document of the same site reads identical pixels');

  // Sizes
  const ratio = sparse.flatUrlBytes / native.flatUrlBytes, blobRatio = sparse.flatBlobBytes / native.flatBlobBytes, stableRatio = stable.flatUrlBytes / native.flatUrlBytes;
  console.log(`  flat ${FLAT.join('x')} PNG bytes: native ${native.flatUrlBytes}, sparse-rgb-v1 ${sparse.flatUrlBytes} (${ratio.toFixed(2)}x), stable-rgb-v1 ${stable.flatUrlBytes} (${stableRatio.toFixed(1)}x)`);
  console.log(`  toBlob bytes: native ${native.flatBlobBytes}, sparse ${sparse.flatBlobBytes} (${blobRatio.toFixed(2)}x), stable ${stable.flatBlobBytes}; convertToBlob: native ${native.flatOffBytes}, sparse ${sparse.flatOffBytes}, stable ${stable.flatOffBytes}`);
  console.log('  timings ms native/stable/sparse: ' + ['flat toDataURL', 'flat toBlob', 'flat getImageData', 'flat convertToBlob'].map(label => `${label} ${native.timings[label]}/${stable.timings[label]}/${sparse.timings[label]}`).join(', '));
  assert.ok(ratio <= 4, `sparse PNG ${ratio.toFixed(2)}x of native (hard bound 4x)`); assert.ok(blobRatio <= 4, 'toBlob within 4x');
  if (sparse.flatOffBytes) assert.ok(sparse.flatOffBytes / native.flatOffBytes <= 4, 'convertToBlob within 4x');
  assert.ok(stableRatio >= 20 && sparse.flatUrlBytes * 10 < stable.flatUrlBytes, 'stable-rgb-v1 is the layout that explodes');
  check(`flat ${FLAT.join('x')} export: native ${native.flatUrlBytes} B, sparse ${sparse.flatUrlBytes} B (${ratio.toFixed(2)}x${ratio <= 3 ? ', within the 3x target' : ', ABOVE the 3x target'}), stable ${stable.flatUrlBytes} B (${stableRatio.toFixed(1)}x)`);
  // Small and medium zones move every opaque pixel: exact against the oracle, and never larger than stable-rgb-v1's export.
  for (const [zw, zh] of ZONES) {
    const name = zw + 'x' + zh, expected = sparseExpected(makeImage(zw, zh, 'flat'), zw, zh, key).data;
    assert.equal(sparse.zones[name].readHash, sha256(expected), name + ' getImageData equals the oracle');
    assert.ok(sameBytes(dataUrlPixels(sparse.zones[name].url), expected), name + ' toDataURL decodes to the oracle');
    // Every opaque pixel moves here, so a flat canvas costs about what stable-rgb-v1 costs (per-pixel draws) or less (runs of 16);
    // the bound only guards against a layout that grows beyond one and a half bytes per pixel.
    assert.ok(sparse.zones[name].bytes <= zw * zh * 1.5, name + ' bounded: ' + sparse.zones[name].bytes);
    console.log(`  flat ${name} PNG bytes (${sparseGeometry(zw, zh).zone} zone): native ${native.zones[name].bytes}, sparse ${sparse.zones[name].bytes} (${(sparse.zones[name].bytes / native.zones[name].bytes).toFixed(1)}x), stable ${stable.zones[name].bytes} (${(stable.zones[name].bytes / native.zones[name].bytes).toFixed(1)}x)`);
  }
  check('flat ' + ZONES.map(zone => zone.join('x')).join(', ') + ' (every opaque pixel moves): reads and PNG exports equal the oracle, exports at most 1.5 bytes per pixel');
  console.log(`canvas sparse native ${useFirefox ? 'firefox' : 'chromium'}: ${checks.length} checks PASS`);
} catch (error) { failed = error; console.error(error); process.exitCode = 1; }
finally { await browser.close(); }
if (failed) throw failed;
