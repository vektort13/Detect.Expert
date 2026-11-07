// ADR-107: WebGL readPixels, Web Audio and TextMetrics Custom rows in a real engine, without the extension package. The MAIN-world source
// that buildApiCustomScripts registers for a Strict-like profile (canvas-readback + webgl-readback + audio-fingerprint + canvas-text-metrics,
// private keys) is injected at document start into owned pages served from a fake https origin (no network, no dist/ build).
// Checks: readPixels of the default framebuffer equals the decoded toDataURL PNG (independent decoder) for both Canvas algorithms and all
// three sparse zones; translucent pixels stay native; AudioProcessingEvent buffer reuse (measured, not assumed); the FingerprintJS-style
// compressor sum and AnalyserNode readouts against native runs; TextMetrics value domains. Usage: node scripts/test/surfaces-readback-native.mjs [--firefox]
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, firefox } from 'playwright';
// The production copy of the contract: the module buildApiCustomScripts validates with.
import { createApiConfiguration, updateApiConfiguration } from '../../apps/production-extension/api-configuration.js';
import { buildApiCustomScripts } from '../../apps/production-extension/api-custom-registration.js';
import { decodePng } from './canvas-sparse-kit.mjs';

const useFirefox = process.argv.includes('--firefox'), ORIGIN = 'https://top.example';
const KEYS = { canvasSeed: '3c'.repeat(32), webglSeed: '5a'.repeat(32), audioSeed: '7e'.repeat(32) }, OTHER_AUDIO = '81'.repeat(32), AMPLITUDE = 0.00001, SCALE = 1.005;
const checks = [], check = message => { checks.push(message); console.log('  ok ' + message); };
function change(config, id, patch) { const result = updateApiConfiguration(config, id, patch); assert.equal(result.ok, true, result.error?.message); return result.value; }
function source(algorithm, { canvas = true, audioSeed = KEYS.audioSeed } = {}) {
  let config = { ...createApiConfiguration(), enabled: true, antidetectEnabled: true };
  const rows = [['webgl-readback', { seed: '00112233445566778899aabbccddeeff' }], ['audio-fingerprint', { seed: '00112233445566778899aabbccddeeff', amplitude: AMPLITUDE }], ['canvas-text-metrics', { scale: SCALE }]];
  if (canvas) rows.push(['canvas-readback', { algorithm }]);
  for (const [id, value] of rows) config = change(config, id, { mode: 'custom', selected: { kind: 'value', value } });
  return buildApiCustomScripts(config, ['https://*/*'], { ...KEYS, audioSeed })[0].js[0].code;
}
function firefoxExecutable() {
  if (process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE) return process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE;
  const base = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  const candidates = existsSync(base) ? readdirSync(base).filter(name => /^firefox-[0-9]+$/.test(name)).sort((a, b) => Number(b.slice(8)) - Number(a.slice(8))) : [];
  for (const name of candidates) { const path = join(base, name, 'firefox', 'firefox.exe'); if (existsSync(path)) return path; }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Page probes (serialized by Playwright; self-contained)
// ---------------------------------------------------------------------------------------------
function glProbe({ sizes, rects, translucent }) {
  const b64 = bytes => { let text = ''; for (let index = 0; index < bytes.length; index += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(index, index + 0x8000)); return btoa(text); };
  function draw(width, height, version, alpha) {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const gl = canvas.getContext(version === 2 ? 'webgl2' : 'webgl', { preserveDrawingBuffer: true, antialias: false });
    if (!gl) return null;
    gl.clearColor(0.3, 0.5, 0.7, alpha); gl.clear(gl.COLOR_BUFFER_BIT);
    const shader = (type, text) => { const created = gl.createShader(type); gl.shaderSource(created, text); gl.compileShader(created); return created; };
    const program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, 'attribute vec2 p; attribute vec3 c; varying vec3 v; void main() { v = c; gl_Position = vec4(p, 0.0, 1.0); }'));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, 'precision mediump float; varying vec3 v; void main() { gl_FragColor = vec4(v, 1.0); }'));
    gl.linkProgram(program); gl.useProgram(program);
    const data = new Float32Array([-0.9, -0.8, 1, 0, 0, 0.8, -0.6, 0, 1, 0, 0.1, 0.9, 0, 0, 1, -0.2, -0.95, 0.9, 0.9, 0.1, 0.95, 0.3, 0.1, 0.9, 0.9, -0.5, 0.7, 0.5, 0.2, 0.3]);
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const p = gl.getAttribLocation(program, 'p'), c = gl.getAttribLocation(program, 'c');
    gl.enableVertexAttribArray(p); gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 20, 0); gl.enableVertexAttribArray(c); gl.vertexAttribPointer(c, 3, gl.FLOAT, false, 20, 8);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    return { canvas, gl };
  }
  const out = { reads: [] };
  for (const [width, height, version] of sizes) {
    const made = draw(width, height, version, 1);
    if (!made) { out.reads.push({ width, height, version, missing: true }); continue; }
    const { canvas, gl } = made, pixels = new Uint8Array(width * height * 4);
    let error = null; try { gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels); } catch (failure) { error = failure.name + ': ' + failure.message; }
    const parts = rects.map(([x, y, w, h]) => { const part = new Uint8Array(w * h * 4); try { gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, part); return b64(part); } catch (failure) { return failure.name; } });
    out.reads.push({ width, height, version, error, pixels: b64(pixels), url: canvas.toDataURL(), parts, format: gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT) });
  }
  if (translucent) {
    const made = draw(64, 32, 1, 0.5); const pixels = new Uint8Array(64 * 32 * 4); made.gl.readPixels(0, 0, 64, 32, made.gl.RGBA, made.gl.UNSIGNED_BYTE, pixels); out.translucent = b64(pixels);
  }
  out.locationOrigin = location.origin;
  return out;
}

async function audioProbe({ reuse }) {
  const out = {};
  // FingerprintJS-style: triangle 10 kHz into a compressor, 5000 samples at 44.1 kHz, |x| summed over 4500..5000 by the getChannelData(0)[i] loop.
  const render = async () => {
    const context = new OfflineAudioContext(1, 5000, 44100), oscillator = context.createOscillator(), compressor = context.createDynamicsCompressor();
    oscillator.type = 'triangle'; oscillator.frequency.value = 10000;
    compressor.threshold.value = -50; compressor.knee.value = 40; compressor.ratio.value = 12; compressor.attack.value = 0; compressor.release.value = 0.25;
    oscillator.connect(compressor); compressor.connect(context.destination); oscillator.start(0);
    return context.startRendering();
  };
  const rendered = await render();
  const start = performance.now(); let sum = 0; for (let index = 4500; index < 5000; index++) sum += Math.abs(rendered.getChannelData(0)[index]); out.loopMs = performance.now() - start;
  out.sum = sum; out.firstSamples = Array.from(rendered.getChannelData(0).subarray(4500, 4508));
  // AnalyserNode readouts at a fixed offline time (deterministic).
  const context = new OfflineAudioContext(1, 22050, 44100), oscillator = context.createOscillator(), analyser = context.createAnalyser();
  oscillator.type = 'sawtooth'; oscillator.frequency.value = 440; analyser.fftSize = 2048; oscillator.connect(analyser); analyser.connect(context.destination); oscillator.start(0);
  const levels = new Float32Array(1024), bytes = new Uint8Array(1024), samples = new Float32Array(2048), waves = new Uint8Array(2048);
  const read = () => { analyser.getFloatFrequencyData(levels); analyser.getByteFrequencyData(bytes); analyser.getFloatTimeDomainData(samples); analyser.getByteTimeDomainData(waves); };
  // Firefox has no OfflineAudioContext.suspend: read the analyser after rendering (its last fftSize samples), also deterministic.
  if (typeof context.suspend === 'function') { context.suspend(0.25).then(() => { read(); context.resume(); }); await context.startRendering(); }
  else { await context.startRendering(); read(); }
  out.readAfterRendering = typeof context.suspend !== 'function';
  out.levels = Array.from(levels, value => Number.isFinite(value) ? value : String(value)); out.bytes = Array.from(bytes); out.samples = Array.from(samples); out.waves = Array.from(waves);
  if (reuse) {
    // Are ScriptProcessor event buffers reused between events? Measured on a live context (autoplay allowed by the launch flag).
    try {
      const live = new AudioContext(), source = live.createOscillator(), processor = live.createScriptProcessor(256, 1, 1), seen = [];
      source.connect(processor); processor.connect(live.destination); source.start();
      await Promise.race([new Promise(resolve => { processor.onaudioprocess = event => { seen.push([event.inputBuffer, event.outputBuffer]); if (seen.length >= 8) resolve(); }; }), new Promise(resolve => setTimeout(resolve, 5000))]);
      out.events = seen.length; out.inputs = new Set(seen.map(pair => pair[0])).size; out.outputs = new Set(seen.map(pair => pair[1])).size;
      out.inputIsOutput = seen.some(pair => pair[0] === pair[1]); await live.close();
    } catch (error) { out.reuseError = error.name + ': ' + error.message; }
  }
  return out;
}

function textProbe() {
  const context = document.createElement('canvas').getContext('2d'), keys = ['width', 'actualBoundingBoxLeft', 'actualBoundingBoxRight', 'fontBoundingBoxAscent', 'fontBoundingBoxDescent', 'actualBoundingBoxAscent', 'actualBoundingBoxDescent', 'emHeightAscent', 'emHeightDescent', 'hangingBaseline', 'alphabeticBaseline', 'ideographicBaseline'];
  const out = [];
  for (const font of ['16px Arial', '13px "Times New Roman"', 'bold 31px monospace', '11.5px sans-serif']) {
    context.font = font; const metrics = context.measureText('Hello, world! 0123 ÄÉ');
    out.push(Object.fromEntries(keys.map(key => [key, metrics[key]])));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
const browser = await (useFirefox ? firefox : chromium).launch(useFirefox ? { executablePath: firefoxExecutable(), firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0 } } : { channel: 'chromium', args: ['--autoplay-policy=no-user-gesture-required'] });
console.log('surfaces readback native: ' + (useFirefox ? 'Playwright Firefox ' : 'Chromium ') + browser.version());
async function run(code, probe, argument) {
  const context = await browser.newContext();
  await context.route(ORIGIN + '/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>surfaces</title>' }));
  if (code) await context.addInitScript(code);
  const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(120000); await page.goto(ORIGIN + '/');
  try { const result = await page.evaluate(probe, argument); assert.deepEqual(errors, [], 'page errors'); return result; } finally { await context.close(); }
}
const bytesOf = text => Buffer.from(text, 'base64');
function flip(bytes, width, height) { const out = Buffer.alloc(width * height * 4); for (let row = 0; row < height; row++) bytes.copy(out, (height - 1 - row) * width * 4, row * width * 4, (row + 1) * width * 4); return out; }
function crop(data, width, x, y, w, h) { const out = Buffer.alloc(w * h * 4); for (let row = 0; row < h; row++) Buffer.from(data.buffer, data.byteOffset, data.byteLength).copy(out, row * w * 4, ((y + row) * width + x) * 4, ((y + row) * width + x + w) * 4); return out; }
let failed = null;
try {
  // -------------------------------- WebGL readPixels vs toDataURL --------------------------------
  const sizes = [[300, 150, 1], [400, 300, 1], [640, 480, 1], [300, 150, 2]], rects = [[0, 0, 1, 1], [10, 20, 33, 17], [299, 149, 1, 1], [0, 140, 300, 10]];
  const native = await run(null, glProbe, { sizes, rects, translucent: true });
  const glMissing = native.reads.every(read => read.missing);
  if (glMissing) console.log('  WebGL is not available in this browser build: readPixels checks skipped');
  else {
    for (const read of native.reads.filter(read => !read.missing)) {
      assert.ok(flip(bytesOf(read.pixels), read.width, read.height).equals(Buffer.from(decodePng(bytesOf(read.url.slice(read.url.indexOf(',') + 1))).data)), 'native engine: readPixels equals toDataURL ' + read.width + 'x' + read.height);
    }
    check('native baseline: the engine itself returns identical pixels through readPixels and toDataURL (' + native.reads.filter(read => !read.missing).length + ' canvases, IMPLEMENTATION_COLOR_READ_FORMAT ' + native.reads[0].format + ')');
    for (const algorithm of ['sparse-rgb-v2', 'sparse-rgb-v1', 'stable-rgb-v1']) {
      const projected = await run(source(algorithm), glProbe, { sizes, rects, translucent: true });
      for (const [index, read] of projected.reads.entries()) {
        if (read.missing) continue;
        assert.equal(read.error, null, algorithm + ' readPixels ' + read.width + 'x' + read.height + ' was denied: ' + read.error);
        const pixels = flip(bytesOf(read.pixels), read.width, read.height), decoded = Buffer.from(decodePng(bytesOf(read.url.slice(read.url.indexOf(',') + 1))).data);
        let differing = 0; for (let at = 0; at < pixels.length; at++) if (pixels[at] !== decoded[at]) differing++;
        assert.equal(differing, 0, `${algorithm} ${read.width}x${read.height} WebGL${read.version}: ${differing} of ${pixels.length} bytes differ between readPixels and toDataURL`);
        read.parts.forEach((part, partIndex) => {
          const [x, y, w, h] = rects[partIndex]; assert.ok(flip(bytesOf(part), w, h).equals(crop(decoded, read.width, x, read.height - y - h, w, h)), algorithm + ' rect ' + rects[partIndex]);
        });
        const nativePixels = flip(bytesOf(native.reads[index].pixels), read.width, read.height);
        let moved = 0; for (let at = 0; at < pixels.length; at += 4) if (pixels[at] !== nativePixels[at] || pixels[at + 1] !== nativePixels[at + 1] || pixels[at + 2] !== nativePixels[at + 2]) moved++;
        const share = moved / (read.width * read.height);
        console.log(`  ${algorithm} ${read.width}x${read.height} WebGL${read.version}: ${moved} of ${read.width * read.height} pixels moved (${(share * 100).toFixed(2)}%), readPixels = toDataURL, ${rects.length} rectangles = crops`);
        // ADR-112: sparse-rgb-v2 sets the lowest bit of one unsaturated channel, so about half of the candidates change (smooth colours are unsaturated almost everywhere).
        if (algorithm === 'sparse-rgb-v2') { if (read.width * read.height <= 262144) assert.ok(share > 0.3 && share < 0.6, `${algorithm}: about half of the pixels change (${share})`); else assert.ok(share > 0.002 && share < 0.01, `${algorithm}: about half of the keyed 1% change (${share})`); }
        else if (algorithm === 'stable-rgb-v1' || read.width * read.height <= 262144) assert.equal(moved, read.width * read.height, 'every opaque pixel moves'); else assert.ok(share > 0.005 && share < 0.02);
      }
      // Cleared to alpha 0.5 with opaque triangles on top: every non-opaque pixel reads exactly as natively.
      const translucent = bytesOf(projected.translucent), nativeTranslucent = bytesOf(native.translucent);
      let kept = 0;
      for (let at = 0; at < nativeTranslucent.length; at += 4) if (nativeTranslucent[at + 3] !== 255) { assert.ok(translucent.subarray(at, at + 4).equals(nativeTranslucent.subarray(at, at + 4)), algorithm + ': translucent pixel ' + at / 4); kept++; }
      assert.ok(kept > 1000, 'translucent pixels present: ' + kept);
      check(`${algorithm}: readPixels equals the decoded toDataURL PNG byte for byte (WebGL1 and WebGL2, small/medium/large zones, ${rects.length} rectangles each); translucent pixels stay native`);
    }
    // webgl-readback alone: keyed by its own private key; the Canvas export stays native, so the two disagree (documented limitation).
    const alone = await run(source('sparse-rgb-v1', { canvas: false }), glProbe, { sizes: [[300, 150, 1]], rects: [], translucent: false });
    const read = alone.reads[0], pixels = flip(bytesOf(read.pixels), 300, 150), decoded = Buffer.from(decodePng(bytesOf(read.url.slice(read.url.indexOf(',') + 1))).data);
    assert.ok(decoded.equals(flip(bytesOf(native.reads[0].pixels), 300, 150)), 'toDataURL is native without canvas-readback');
    assert.ok(!pixels.equals(decoded));
    check('webgl-readback alone: readPixels projected with its own key while toDataURL stays native (they disagree by design: enable canvas-readback with it)');
  }

  // -------------------------------- Web Audio --------------------------------
  const nativeAudio = await run(null, audioProbe, { reuse: true }), audioA = await run(source('sparse-rgb-v1'), audioProbe, { reuse: false });
  const audioAgain = await run(source('sparse-rgb-v1'), audioProbe, { reuse: false }), audioOther = await run(source('sparse-rgb-v1', { audioSeed: OTHER_AUDIO }), audioProbe, { reuse: false });
  if (nativeAudio.reuseError || !(nativeAudio.events >= 2)) console.log('  ScriptProcessor reuse NOT measured: ' + (nativeAudio.reuseError || nativeAudio.events + ' events'));
  else {
    console.log(`  ScriptProcessor (bufferSize 256): ${nativeAudio.events} events used ${nativeAudio.inputs} distinct inputBuffer and ${nativeAudio.outputs} distinct outputBuffer objects; an input was ever the output: ${nativeAudio.inputIsOutput}`);
    assert.equal(nativeAudio.inputIsOutput, false);
    check('AudioProcessingEvent buffer reuse measured (' + nativeAudio.inputs + ' inputs / ' + nativeAudio.outputs + ' outputs over ' + nativeAudio.events + ' events)');
  }
  if (nativeAudio.readAfterRendering) console.log('  AnalyserNode read after offline rendering (no OfflineAudioContext.suspend in this engine)');
  assert.notEqual(audioA.sum, nativeAudio.sum); assert.equal(audioAgain.sum, audioA.sum); assert.notEqual(audioOther.sum, audioA.sum);
  assert.ok(Math.abs(audioA.sum - nativeAudio.sum) <= 500 * AMPLITUDE);
  console.log(`  compressor sum 4500..5000: native ${nativeAudio.sum}, key A ${audioA.sum} (again ${audioAgain.sum}), key B ${audioOther.sum}; 500-call loop ms native ${nativeAudio.loopMs.toFixed(2)} / projected ${audioA.loopMs.toFixed(2)}`);
  check('compressor fingerprint: differs from native by at most 500 x amplitude, identical for the same key in a new document, different for another key');
  let silent = 0, moved = 0;
  nativeAudio.levels.forEach((value, index) => {
    const projected = audioA.levels[index];
    if (typeof value === 'string' || value === 0) { assert.equal(projected, value, 'bin ' + index); silent++; return; }
    const ratio = Math.abs(projected - value) / Math.abs(value); assert.ok(ratio >= AMPLITUDE * 0.5 - 2 ** -23 && ratio <= AMPLITUDE + 2 ** -23, `bin ${index}: ${value} -> ${projected}`); moved++;
  });
  const byteMoves = nativeAudio.bytes.filter((value, index) => value !== audioA.bytes[index]).length, waveMoves = nativeAudio.waves.filter((value, index) => value !== audioA.waves[index]).length;
  assert.ok(nativeAudio.bytes.every((value, index) => Math.abs(value - audioA.bytes[index]) <= 1 && (value !== 0 && value !== 255 || audioA.bytes[index] === value)));
  assert.ok(nativeAudio.waves.every((value, index) => Math.abs(value - audioA.waves[index]) <= 1 && (value !== 128 || audioA.waves[index] === 128)));
  assert.ok(nativeAudio.samples.every((value, index) => Math.abs(value - audioA.samples[index]) <= AMPLITUDE));
  const levelRange = nativeAudio.levels.filter(value => typeof value === 'number');
  console.log(`  AnalyserNode: ${moved} finite dB bins moved (native range ${Math.min(...levelRange).toFixed(1)}..${Math.max(...levelRange).toFixed(1)} dB), ${silent} -Infinity/0 bins exact; byte bins moved ${byteMoves}/1024, time-domain bytes moved ${waveMoves}/2048`);
  check('AnalyserNode: every finite dB bin moves by a relative step in [0.5, 1] x amplitude, silent bins exact, bytes within one level, 0/255 and 128 kept');

  // -------------------------------- TextMetrics --------------------------------
  const nativeText = await run(null, textProbe), projectedText = await run(source('sparse-rgb-v1'), textProbe);
  const domains = { integer: new Set(), float32: new Set(), double: new Set() };
  nativeText.forEach((row, index) => Object.entries(row).forEach(([key, value]) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    const domain = Number.isInteger(value) ? 'integer' : Math.fround(value) === value ? 'float32' : 'double'; domains[domain].add(key);
    const projected = projectedText[index][key];
    if (domain === 'integer') assert.ok(Number.isInteger(projected) && projected === Math.round(value * SCALE), key);
    else if (domain === 'float32') assert.ok(Math.fround(projected) === projected && projected === Math.fround(value * SCALE), key);
    else assert.equal(projected, value * SCALE, key);
  }));
  console.log('  TextMetrics domains: integer [' + [...domains.integer].join(', ') + '], float32 [' + [...domains.float32].join(', ') + '], double [' + [...domains.double].join(', ') + ']');
  check('TextMetrics: every projected value keeps the native value domain (integer, float32 or double)');
  console.log(`surfaces readback native ${useFirefox ? 'firefox' : 'chromium'}: ${checks.length} checks PASS`);
} catch (error) { failed = error; console.error(error); process.exitCode = 1; }
finally { await browser.close(); }
if (failed) throw failed;
