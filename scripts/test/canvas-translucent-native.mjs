// Translucent pixels of the Canvas readback projection (api-custom-canvas-runtime.js, header 'Translucent pixels'), measured in a REAL
// browser and checked against the production rule. Dev-time only: the production code never renders a canvas (REQ-001); this file does,
// in owned pages, to find out what the engine's premultiply / unpremultiply arithmetic really is.
//
// 1. Measure (no installer): for all 256 alphas x 256 values (a 256x256 grid, R = value, G = value + 85, B = value + 170) put the straight
//    pixel with putImageData and read it back (getImageData) in a software canvas, an accelerated canvas, an OffscreenCanvas in the window and
//    in a Worker, a display-p3 canvas where the engine has one, at several row alignments; export it as PNG (toDataURL, toBlob,
//    convertToBlob); draw the PNG back (Image and createImageBitmap) and read again; read the stored premultiplied bytes through WebGL. That
//    is 254 x 256 = 65,024 translucent pairs and 32,639 stored states per path.
// 2. Fit: the embedded engine models (canvas-translucent-kit.mjs) must reproduce the measured tables, or the run says which model matches
//    ('moz2d-new' would mean this Firefox already uses the upstream rounding) and which does not.
// 3. Check the production rule against the MEASURED tables only (no model): every value it returns for every readable (alpha, value, direction)
//    is a value every measured path returns, is a valid stored state, and survives putImageData -> getImageData.
// 4. (not with --installed-firefox) Install the production installer at document start and read the same grid, random 300x150 / 512x512 / 700x400 /
//    1100x700 canvases, a 0.99 copy, a dedicated Worker that runs the installer, and a WebGL canvas, for the three algorithms (ADR-112 added sparse-rgb-v2): getImageData equals the
//    independent oracle applied to the native read, every export decodes to what a NATIVE canvas holding the marked bytes exports, drawing the
//    export back reads what a native pixel of those bytes reads, a WebGL export stays what the engine writes. Prints 1920x1080 timings.
//
// Usage: node scripts/test/canvas-translucent-native.mjs [--firefox | --chrome | --installed-firefox] [--report]
//   (default: Playwright's Chromium; --chrome: the installed branded Chrome; --firefox: Playwright's Firefox build, see canvas-sparse-native.mjs;
//    --installed-firefox: the installed Firefox through geckodriver: steps 1-3 only, because geckodriver runs scripts in a sandbox that cannot see
//    what the installer defines). --report lists the model fit per path. Nothing is written to the repository (the geckodriver profile lives in
//    .tmp/canvas-translucent-* and is removed).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, firefox } from 'playwright';
import { installCanvasCustom } from '../../apps/production-extension/api-custom-canvas-runtime.js';
import { SEED, sessionKey, sparseExpected, sparseExpectedV2, stableExpected, decodePng, sameBytes } from './canvas-sparse-kit.mjs';
import { ENGINES, SKIA_CPU_LIST, SKIA_GPU_LIST, MOZ_OLD_LIST } from './canvas-translucent-kit.mjs';

const root = resolve(import.meta.dirname, '../..');
const argv = process.argv.slice(2), has = flag => argv.includes(flag);
const mode = has('--installed-firefox') ? 'installed-firefox' : has('--firefox') ? 'firefox' : has('--chrome') ? 'chrome' : 'chromium';
const family = mode === 'chrome' || mode === 'chromium' ? 1 : 2, report = has('--report');
const checks = [], check = message => { checks.push(message); console.log('  ok ' + message); };
const ORIGIN = mode === 'installed-firefox' ? 'null' : 'https://translucent.test';
const KEY = sessionKey(SEED, ORIGIN);

// ---------------------------------------------------------------------------------------------
// Page code. Every function below is serialized into the page: it uses nothing from this module.
// ---------------------------------------------------------------------------------------------
async function measureProbe() {
  const W = 256, b64 = bytes => { let text = ''; for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(text); };
  const grid = () => { const data = new Uint8ClampedArray(W * W * 4); for (let a = 0; a < 256; a++) for (let v = 0; v < 256; v++) { const o = (a * 256 + v) * 4; data[o] = v; data[o + 1] = (v + 85) & 255; data[o + 2] = (v + 170) & 255; data[o + 3] = a; } return data; };
  const image = () => new ImageData(grid(), W, W);
  const rTable = got => { const t = new Uint8Array(W * W); for (let i = 0; i < W * W; i++) t[i] = got[i * 4]; return t; };
  const out = { tables: {}, urls: {}, notes: {}, counts: {} };
  const channelMismatch = got => { let bad = 0; for (let a = 0; a < 256; a++) for (let v = 0; v < 256; v++) { const o = (a * 256 + v) * 4, g = got[(a * 256 + ((v + 85) & 255)) * 4], b = got[(a * 256 + ((v + 170) & 255)) * 4]; if (got[o + 1] !== g || got[o + 2] !== b) bad++; } return bad; };
  const blobBytes = async blob => b64(new Uint8Array(await blob.arrayBuffer()));
  const worker = new Worker(URL.createObjectURL(new Blob([`
    onmessage = async event => {
      const { id, kind, buffer, bytes, frequent } = event.data;
      try {
        if (kind === 'put') {
          const canvas = new OffscreenCanvas(256, 256), context = canvas.getContext('2d', { willReadFrequently: frequent }); context.putImageData(new ImageData(new Uint8ClampedArray(buffer), 256, 256), 0, 0);
          const got = context.getImageData(0, 0, 256, 256).data, png = new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer()); postMessage({ id, got, png }, [got.buffer, png.buffer]);
        } else if (kind === 'redraw') {
          const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' })), canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext('2d', { willReadFrequently: true });
          context.drawImage(bitmap, 0, 0); const got = context.getImageData(0, 0, bitmap.width, bitmap.height).data; postMessage({ id, got }, [got.buffer]);
        }
      } catch (error) { postMessage({ id, error: error.name + ': ' + error.message }); }
    };`], { type: 'text/javascript' })));
  let serial = 0;
  const ask = (message, transfer = []) => new Promise((resolve, reject) => { const id = ++serial; const listener = event => { if (event.data.id !== id) return; worker.removeEventListener('message', listener); if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data); }; worker.addEventListener('message', listener); worker.postMessage({ id, ...message }, transfer); });
  // software canvas
  const soft = document.createElement('canvas'); soft.width = W; soft.height = W; const sctx = soft.getContext('2d', { willReadFrequently: true });
  sctx.putImageData(image(), 0, 0); const sread = sctx.getImageData(0, 0, W, W).data;
  out.tables.soft = b64(rTable(sread)); out.counts.channelMismatch = channelMismatch(sread);
  sctx.putImageData(new ImageData(new Uint8ClampedArray(sread), W, W), 0, 0); const again = sctx.getImageData(0, 0, W, W).data;
  let roundtrip = 0; for (let i = 0; i < sread.length; i++) if (sread[i] !== again[i]) roundtrip++; out.counts.roundtrip = roundtrip;
  sctx.putImageData(image(), 0, 0);
  out.urls.soft = soft.toDataURL(); out.urls.blob = await blobBytes(await new Promise(resolve => soft.toBlob(resolve)));
  // fillRect with rgba(v, v + 85, v + 170, a / 255): the stored states a DRAWING produces (putImageData is not the only way to a state)
  {
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = W; const ctx = canvas.getContext('2d', { willReadFrequently: true });
    for (let a = 1; a < 255; a++) for (let v = 0; v < 256; v++) { ctx.fillStyle = 'rgba(' + v + ',' + ((v + 85) & 255) + ',' + ((v + 170) & 255) + ',' + a / 255 + ')'; ctx.fillRect(v, a, 1, 1); }
    const got = ctx.getImageData(0, 0, W, W).data; out.tables.fill = b64(rTable(got));
    let alphaBad = 0; for (let a = 1; a < 255; a++) for (let v = 0; v < 256; v++) if (got[(a * W + v) * 4 + 3] !== a) alphaBad++; out.counts.fillAlpha = alphaBad;
  }
  // the canvas the browser decides to accelerate (first read)
  const fast = document.createElement('canvas'); fast.width = W; fast.height = W; const fctx = fast.getContext('2d');
  fctx.putImageData(image(), 0, 0); const fread = fctx.getImageData(0, 0, W, W).data; out.tables.gpu = b64(rTable(fread)); out.counts.gpuChannelMismatch = channelMismatch(fread);
  out.urls.gpuCanvas = fast.toDataURL();
  // OffscreenCanvas in the window and in a Worker
  if (typeof OffscreenCanvas === 'function') {
    const off = new OffscreenCanvas(W, W), octx = off.getContext('2d'); octx.putImageData(image(), 0, 0); out.tables.off = b64(rTable(octx.getImageData(0, 0, W, W).data)); out.urls.off = await blobBytes(await off.convertToBlob());
    const frequent = await ask({ kind: 'put', buffer: grid().buffer, frequent: true }); out.tables.workerSoft = b64(rTable(frequent.got)); out.urls.workerSoft = b64(frequent.png);
    const plain = await ask({ kind: 'put', buffer: grid().buffer, frequent: false }); out.tables.workerDefault = b64(rTable(plain.got)); out.urls.workerDefault = b64(plain.png);
    // draw the PNG back and read natively
    const png = Uint8Array.from(atob(out.urls.soft.slice(out.urls.soft.indexOf(',') + 1)), char => char.charCodeAt(0));
    out.tables.redrawWorker = b64(rTable((await ask({ kind: 'redraw', bytes: png })).got));
  }
  {
    const img = new Image(); img.src = out.urls.soft; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = W; const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
    out.tables.redrawImage = b64(rTable(ctx.getImageData(0, 0, W, W).data));
  }
  // display-p3
  try {
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = W; const ctx = canvas.getContext('2d', { colorSpace: 'display-p3', willReadFrequently: true });
    if (ctx.getContextAttributes().colorSpace === 'display-p3') {
      ctx.putImageData(new ImageData(grid(), W, W, { colorSpace: 'display-p3' }), 0, 0); const first = ctx.getImageData(0, 0, W, W, { colorSpace: 'display-p3' }).data; out.tables.p3 = b64(rTable(first));
      ctx.putImageData(new ImageData(new Uint8ClampedArray(first), W, W, { colorSpace: 'display-p3' }), 0, 0); const second = ctx.getImageData(0, 0, W, W, { colorSpace: 'display-p3' }).data;
      let bad = 0; for (let i = 0; i < first.length; i++) if (first[i] !== second[i]) bad++; out.counts.roundtripP3 = bad;
    }
  } catch (error) { out.notes.p3 = String(error); }
  // alignment: put at x = dx of a wider canvas, read at dx and at dx + 1
  for (const dx of [1, 3, 7, 13]) {
    const canvas = document.createElement('canvas'); canvas.width = W + 16; canvas.height = W; const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.putImageData(image(), dx, 0);
    const same = ctx.getImageData(dx, 0, W, W).data, shifted = ctx.getImageData(dx + 1, 0, W - 1, W).data; let bad = 0;
    for (let i = 0; i < sread.length; i++) if (same[i] !== sread[i]) bad++;
    for (let y = 0; y < W; y++) for (let x = 0; x < W - 1; x++) for (let c = 0; c < 4; c++) if (shifted[(y * (W - 1) + x) * 4 + c] !== sread[(y * W + x + 1) * 4 + c]) bad++;
    out.counts['alignment' + dx] = bad;
  }
  // the stored premultiplied bytes, through WebGL (UNPACK_PREMULTIPLY_ALPHA keeps them as they are)
  try {
    const gl = document.createElement('canvas'); gl.width = W; gl.height = W; const g = gl.getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
    const tex = g.createTexture(); g.bindTexture(g.TEXTURE_2D, tex); g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true); g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, soft);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST);
    const fb = g.createFramebuffer(); g.bindFramebuffer(g.FRAMEBUFFER, fb); g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, tex, 0);
    if (g.checkFramebufferStatus(g.FRAMEBUFFER) === g.FRAMEBUFFER_COMPLETE) { const px = new Uint8Array(W * W * 4); g.readPixels(0, 0, W, W, g.RGBA, g.UNSIGNED_BYTE, px); out.tables.state = b64(rTable(px)); }
  } catch (error) { out.notes.state = String(error); }
  // a WebGL canvas with translucent pixels: since ADR-112 its export takes the 2D rule (it is copied into a 2D canvas first), so the export of the canvas equals the export of its drawImage mirror
  try {
    const gl = document.createElement('canvas'); gl.width = 64; gl.height = 32; const g = gl.getContext('webgl', { preserveDrawingBuffer: true, antialias: false });
    g.clearColor(0.2, 0.4, 0.6, 0.5); g.clear(g.COLOR_BUFFER_BIT); g.enable(g.SCISSOR_TEST); g.scissor(8, 4, 20, 10); g.clearColor(0.9, 0.1, 0.3, 0.8); g.clear(g.COLOR_BUFFER_BIT);
    out.urls.webgl = gl.toDataURL();
  } catch (error) { out.notes.webgl = String(error); }
  worker.terminate();
  out.notes.fnToString = Function.prototype.toString.toString();
  return out;
}

async function coveredProbe(config) {
  const b64 = bytes => { let text = ''; for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(text); };
  const unb64 = text => Uint8ClampedArray.from(atob(text), char => char.charCodeAt(0));
  const out = { shapes: {}, notes: {} };
  const worker = new Worker(URL.createObjectURL(new Blob([`
    onmessage = async event => {
      const { id, width, height, buffer, bitmap, frequent = true } = event.data;
      try {
        const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d', { willReadFrequently: frequent });
        if (buffer) context.putImageData(new ImageData(new Uint8ClampedArray(buffer), width, height), 0, 0); else { context.drawImage(bitmap, 0, 0); }
        const got = context.getImageData(0, 0, width, height).data; postMessage({ id, got }, [got.buffer]);
      } catch (error) { postMessage({ id, error: error.name + ': ' + error.message }); }
    };`], { type: 'text/javascript' })));
  let serial = 0;
  const ask = (message, transfer = []) => new Promise((resolve, reject) => { const id = ++serial; const listener = event => { if (event.data.id !== id) return; worker.removeEventListener('message', listener); if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.got); }; worker.addEventListener('message', listener); worker.postMessage({ id, ...message }, transfer); });
  const blobBytes = async blob => b64(new Uint8Array(await blob.arrayBuffer()));
  const exportsOf = async (canvas, offscreen) => ({ url: canvas.toDataURL(), blob: await blobBytes(await new Promise(resolve => canvas.toBlob(resolve))), off: offscreen ? await blobBytes(await offscreen.convertToBlob()) : null });
  // (1) the grid: every alpha x every value
  const grid = unb64(config.grid);
  for (const label of config.gridCanvases) {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256; const ctx = canvas.getContext('2d', label === 'soft' ? { willReadFrequently: true } : {});
    ctx.putImageData(new ImageData(new Uint8ClampedArray(grid), 256, 256), 0, 0);
    const row = { read: b64(ctx.getImageData(0, 0, 256, 256).data) };
    if (label === 'soft') {
      const off = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(256, 256) : null; if (off) off.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(grid), 256, 256), 0, 0);
      Object.assign(row, await exportsOf(canvas, off));
      row.after = b64(ctx.getImageData(0, 0, 256, 256).data);
      const png = Uint8Array.from(atob(row.url.slice(row.url.indexOf(',') + 1)), char => char.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([png], { type: 'image/png' })); row.redraw = b64(await ask({ width: 256, height: 256, bitmap }, [bitmap]));
    }
    out.shapes['grid-' + label] = row;
  }
  // (1b) the same grid in a dedicated Worker that runs the installer too (the packaged Worker bootstrap does)
  {
    const source = `(${config.installer})(self, ${config.entries});` + `onmessage = event => { const canvas = new OffscreenCanvas(256, 256), context = canvas.getContext('2d', { willReadFrequently: true }); context.putImageData(new ImageData(new Uint8ClampedArray(event.data), 256, 256), 0, 0); const got = context.getImageData(0, 0, 256, 256).data; postMessage(got, [got.buffer]); };`;
    const inner = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
    out.worker = b64(await new Promise((resolve, reject) => { inner.onmessage = event => resolve(new Uint8Array(event.data.buffer ?? event.data)); inner.onerror = event => reject(new Error(event.message)); inner.postMessage(grid.buffer.slice(0)); })); inner.terminate();
  }
  // (2) random canvases: all three sparse zones
  for (const [width, height, seed] of config.shapes) {
    let state = seed | 0; const next = () => (state = (Math.imul(state, 1664525) + 1013904223) | 0) >>> 0;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let o = 0; o < data.length; o += 4) { const r = next(), kind = r % 10; data[o + 3] = kind < 4 ? 255 : kind === 4 ? 0 : 1 + (next() % 254); if (data[o + 3]) { const e = next(); data[o] = e & 1 ? (e & 2 ? 255 : 0) : (e >>> 8) & 255; data[o + 1] = (e >>> 16) & 255; data[o + 2] = (e >>> 24) & 255; } }
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
    const native = await ask({ width, height, buffer: data.buffer.slice(0) });
    out.shapes[width + 'x' + height] = { native: b64(native), read: b64(ctx.getImageData(0, 0, width, height).data), url: canvas.toDataURL() };
  }
  // (3) a drawing copied at globalAlpha 0.99
  {
    const scene = document.createElement('canvas'); scene.width = 240; scene.height = 60; const sc = scene.getContext('2d');
    sc.fillStyle = '#fff'; sc.fillRect(0, 0, 240, 60); const gr = sc.createLinearGradient(0, 0, 240, 60); gr.addColorStop(0, '#f60'); gr.addColorStop(0.5, '#069'); gr.addColorStop(1, '#6c0'); sc.fillStyle = gr; sc.fillRect(10, 8, 150, 40); sc.fillStyle = 'rgba(102, 204, 0, 0.2)'; sc.fillRect(100, 30, 80, 20); sc.beginPath(); sc.arc(190, 30, 22, 0, 6.2832); sc.fillStyle = '#c0f'; sc.fill();
    const copy = document.createElement('canvas'); copy.width = 240; copy.height = 60; const cc = copy.getContext('2d', { willReadFrequently: true }); cc.globalAlpha = 0.99; cc.drawImage(scene, 0, 0);
    const first = await createImageBitmap(copy), second = await createImageBitmap(copy);
    // The page canvas may be read through the CPU or the GPU arithmetic (they differ only at exact halves); the same stored bytes read in a
    // Worker through both give the two native readings a marked read has to be told apart from.
    out.copy = { nativeCpu: b64(await ask({ width: 240, height: 60, bitmap: first, frequent: true }, [first])), nativeGpu: b64(await ask({ width: 240, height: 60, bitmap: second, frequent: false }, [second])), read: b64(cc.getImageData(0, 0, 240, 60).data), url: copy.toDataURL() };
  }
  // (4) a WebGL canvas with translucent pixels
  try {
    const gl = document.createElement('canvas'); gl.width = 64; gl.height = 32; const g = gl.getContext('webgl', { preserveDrawingBuffer: true, antialias: false });
    g.clearColor(0.2, 0.4, 0.6, 0.5); g.clear(g.COLOR_BUFFER_BIT); g.enable(g.SCISSOR_TEST); g.scissor(8, 4, 20, 10); g.clearColor(0.9, 0.1, 0.3, 0.8); g.clear(g.COLOR_BUFFER_BIT);
    out.webgl = gl.toDataURL();
  } catch (error) { out.notes.webgl = String(error); }
  // (5) timing, 1920x1080
  {
    const W = 1920, H = 1080, best = async (n, fn) => { let b = Infinity; for (let i = 0; i < n; i++) { const s = performance.now(); await fn(); b = Math.min(b, performance.now() - s); } return +b.toFixed(1); };
    const times = {};
    for (const kind of ['opaque', 'translucent']) {
      const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H; const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (kind === 'opaque') { ctx.fillStyle = 'rgb(83,129,207)'; ctx.fillRect(0, 0, W, H); }
      else { const base = document.createElement('canvas'); base.width = W; base.height = H; const bc = base.getContext('2d'); const gr = bc.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#f60'); gr.addColorStop(1, '#069'); bc.fillStyle = gr; bc.fillRect(0, 0, W, H); ctx.globalAlpha = 0.99; ctx.drawImage(base, 0, 0); }
      times[kind] = { getImageData: await best(5, () => ctx.getImageData(0, 0, W, H)), toDataURL: await best(3, () => canvas.toDataURL()), toBlob: await best(3, () => new Promise(resolve => canvas.toBlob(resolve))) };
    }
    out.times = times;
  }
  worker.terminate();
  return out;
}

// ---------------------------------------------------------------------------------------------
// Sessions: Playwright (Chromium, Chrome, Firefox) or geckodriver (the installed Firefox)
// ---------------------------------------------------------------------------------------------
function firefoxExecutable() {
  if (process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE) return process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE;
  const base = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  const candidates = existsSync(base) ? readdirSync(base).filter(name => /^firefox-[0-9]+$/.test(name)).sort((a, b) => Number(b.slice(8)) - Number(a.slice(8))) : [];
  for (const name of candidates) { const path = join(base, name, 'firefox', 'firefox.exe'); if (existsSync(path)) return path; }
  return undefined;
}
async function openSession() {
  if (mode !== 'installed-firefox') {
    const browser = await (mode === 'firefox' ? firefox.launch({ executablePath: firefoxExecutable() }) : chromium.launch({ channel: mode === 'chrome' ? 'chrome' : 'chromium' }));
    const page = async algorithm => {
      const context = await browser.newContext();
      await context.route(ORIGIN + '/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>translucent</title>' }));
      if (algorithm) await context.addInitScript(`(${installCanvasCustom.toString()})(globalThis, ${JSON.stringify([{ id: 'canvas-readback', mode: 'custom', value: { algorithm }, canvasSeed: SEED }])});`);
      const opened = await context.newPage(); opened.setDefaultTimeout(300000); await opened.goto(ORIGIN + '/'); return { opened, context };
    };
    const run = async (algorithm, fn, arg) => { const { opened, context } = await page(algorithm); try { return await opened.evaluate(fn, arg); } finally { await context.close(); } };
    return { version: browser.version(), uncovered: (fn, arg) => run(null, fn, arg), covered: (algorithm, fn, arg) => run(algorithm, fn, arg), close: () => browser.close() };
  }
  // the installed Firefox through geckodriver (WebDriver classic); one page, installer injected after the uncovered measurement
  const driver = process.env.GECKODRIVER_BINARY ?? join(root, '.tmp/firefox/tools/geckodriver.exe'), binary = process.env.FIREFOX_BINARY ?? 'C:/Program Files/Mozilla Firefox/firefox.exe';
  assert.ok(existsSync(driver) && existsSync(binary), 'geckodriver and the installed Firefox are required');
  mkdirSync(join(root, '.tmp'), { recursive: true });
  const folder = mkdtempSync(join(root, '.tmp/canvas-translucent-')), profile = join(folder, 'profile'); mkdirSync(profile);
  writeFileSync(join(profile, 'user.js'), ['browser.shell.checkDefaultBrowser', 'app.update.auto', 'app.update.enabled', 'datareporting.policy.dataSubmissionEnabled'].map(key => `user_pref("${key}", false);`).join('\n'));
  const port = await new Promise(done => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => done(p)); }); });
  const child = spawn(driver, ['--host', '127.0.0.1', '--port', String(port), '--profile-root', folder, '--log', 'error'], { windowsHide: true });
  const endpoint = 'http://127.0.0.1:' + port;
  const command = async (path, body, method = 'POST') => { const response = await fetch(endpoint + path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), signal: AbortSignal.timeout(300000) }); const json = await response.json(); if (!response.ok || json.value?.error) throw Error(JSON.stringify(json.value)); return json.value; };
  for (let attempt = 0; attempt < 100; attempt++) { try { await command('/status', undefined, 'GET'); break; } catch { await new Promise(done => setTimeout(done, 100)); } }
  const opened = await command('/session', { capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': { binary, args: ['-headless', '-no-remote', '-profile', profile] } } } });
  const session = opened.sessionId; await command('/session/' + session + '/timeouts', { script: 300000 }); await command('/session/' + session + '/url', { url: 'about:blank' });
  const execute = async (fn, arg) => { const value = await command('/session/' + session + '/execute/async', { script: `const done = arguments[arguments.length - 1]; (${fn.toString()})(arguments[0]).then(value => done({ ok: true, value }), error => done({ ok: false, error: String(error) }));`, args: [arg ?? null] }); if (!value.ok) throw Error(value.error); return value.value; };
  return {
    version: opened.capabilities.browserVersion, uncovered: execute,
    covered: async () => { throw Error('the installed rule does not run through geckodriver'); },
    close: async () => { try { await command('/session/' + session, undefined, 'DELETE'); } finally { child.kill(); rmSync(folder, { recursive: true, force: true }); } },
  };
}

// ---------------------------------------------------------------------------------------------
// Node side
// ---------------------------------------------------------------------------------------------
const bytes64 = text => new Uint8Array(Buffer.from(text, 'base64'));
const clamped64 = text => new Uint8ClampedArray(Buffer.from(text, 'base64'));
const pngRaw = text => decodePng(Buffer.from(text.startsWith('data:') ? text.slice(text.indexOf(',') + 1) : text, 'base64'));
const pngTable = text => { const { data, width } = pngRaw(text), table = new Uint8Array(65536); for (let i = 0; i < 65536; i++) table[i] = data[i * 4]; assert.equal(width, 256); return table; };
const index = (a, v) => a * 256 + v;
function gridPixels() { const data = new Uint8ClampedArray(65536 * 4); for (let a = 0; a < 256; a++) for (let v = 0; v < 256; v++) { const o = (a * 256 + v) * 4; data[o] = v; data[o + 1] = (v + 85) & 255; data[o + 2] = (v + 170) & 255; data[o + 3] = a; } return data; }
// A full RGBA native read of the grid from an R-channel table (the channels are independent: verified by channelMismatch).
function gridFromTable(table) {
  const data = new Uint8ClampedArray(65536 * 4);
  for (let a = 0; a < 256; a++) for (let v = 0; v < 256; v++) {
    const o = (a * 256 + v) * 4; data[o + 3] = a;
    if (a === 0) continue;
    data[o] = table[index(a, v)]; data[o + 1] = table[index(a, (v + 85) & 255)]; data[o + 2] = table[index(a, (v + 170) & 255)];
  }
  return data;
}
const countDiff = (x, y) => { let d = 0; for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) d++; return d; };
// states 1..254 x values: the set of straight bytes a path returns for alpha a
const readable = (table, a) => { const set = new Set(); for (let v = 0; v < 256; v++) set.add(table[index(a, v)]); return set; };
function modelTable(engine, which = 'get') { const t = new Uint8Array(65536); for (let a = 0; a < 256; a++) for (let v = 0; v < 256; v++) t[index(a, v)] = a === 0 ? 0 : a === 255 ? v : engine[which](engine.premul(v, a), a); return t; }

installCanvasCustom({}, [{ id: 'canvas-readback', mode: 'custom', value: { algorithm: 'sparse-rgb-v1' }, canvasSeed: SEED }]);
const I = installCanvasCustom.__detectExpertCanvasIntrinsicsV1;

let session, failed = null;
try {
  session = await openSession();
  console.log(`canvas translucent native: ${mode} ${session.version} (${family === 1 ? 'Skia family' : 'Moz2D family'}), origin ${ORIGIN}`);

  // ---- 1. measure ---------------------------------------------------------------------------------------------
  const m = await session.uncovered(measureProbe);
  const T = {}; for (const [name, text] of Object.entries(m.tables)) T[name] = bytes64(text);
  const png = {}; for (const [name, text] of Object.entries(m.urls)) if (name !== 'webgl') png[name] = pngTable(text);
  const soft = T.soft;
  assert.equal(m.counts.channelMismatch, 0, 'the three channels convert independently'); assert.equal(m.counts.gpuChannelMismatch, 0);
  for (const dx of [1, 3, 7, 13]) assert.equal(m.counts['alignment' + dx], 0, `row alignment ${dx} reads the same bytes`);
  assert.equal(m.counts.roundtrip, 0, 'putImageData(getImageData(x)) stores the same bytes');
  if (m.counts.roundtripP3 !== undefined) assert.equal(m.counts.roundtripP3, 0, 'the same in a display-p3 canvas');
  let pairs = 0, states = 0; for (let a = 1; a <= 254; a++) { pairs += 256; states += a + 1; }
  assert.equal(pairs, 65024); assert.equal(states, 32639);
  const fillTable = T.fill; delete T.fill;
  const tableNames = Object.keys(T).filter(name => !['state', 'redrawWorker', 'redrawImage'].includes(name));
  const measured = [];
  // transparent and opaque rows are exact in every path
  for (const name of tableNames) for (let v = 0; v < 256; v++) { assert.equal(T[name][index(0, v)], 0, name + ' alpha 0'); assert.equal(T[name][index(255, v)], v, name + ' alpha 255'); }
  check(`measured ${pairs} translucent (alpha, value) pairs = ${states} stored states in ${tableNames.length} read paths (${tableNames.join(', ')}) and ${Object.keys(png).length} PNG paths; channels independent, row alignments 1/3/7/13 identical, putImageData(getImageData) lossless (0 bytes differ${m.counts.roundtripP3 === undefined ? '; no display-p3 canvas here' : ', also in display-p3'})`);

  // ---- 2. fit the models --------------------------------------------------------------------------------------
  const mismatch = (engine, table, which = 'get') => countDiff(modelTable(engine, which), table);
  const lines = [];
  if (family === 1) {
    assert.equal(mismatch(ENGINES['skia-cpu'], soft), 0, 'the software canvas is the skia-cpu model');
    for (const name of tableNames) { const cpu = mismatch(ENGINES['skia-cpu'], T[name]), gpu = mismatch(ENGINES['skia-gpu'], T[name]); lines.push(`${name}: skia-cpu ${cpu}, skia-gpu ${gpu} pairs differ`); assert.ok(cpu === 0 || gpu === 0, `${name} matches neither Skia model`); }
    // The encoder reads the canvas the way getImageData does: a software canvas through the CPU arithmetic, a canvas that is still accelerated
    // through the GPU readback (the production export always encodes a software copy).
    for (const name of Object.keys(png)) { const cpu = mismatch(ENGINES['skia-cpu'], png[name], 'png'), gpu = mismatch(ENGINES['skia-gpu'], png[name], 'get'); lines.push(`PNG ${name}: skia-cpu ${cpu}, skia-gpu ${gpu} pairs differ`); assert.ok(cpu === 0 || gpu === 0, 'PNG ' + name + ' matches neither Skia model'); if (name === 'soft' || name === 'blob' || name === 'workerSoft') assert.equal(cpu, 0, 'the software canvas encodes with the CPU arithmetic: ' + name); }
    check(`Skia models reproduce the measurement: software canvas and its PNGs = skia-cpu (0 of ${pairs} pairs differ); accelerated paths and their PNGs = skia-gpu or skia-cpu (differences only at exact halves: lists of ${SKIA_CPU_LIST.size} / ${SKIA_GPU_LIST.size} states)`);
  } else {
    const old = mismatch(ENGINES['moz2d-old'], soft), upstream = mismatch(ENGINES['moz2d-new'], soft);
    lines.push(`getImageData: moz2d-old ${old}, moz2d-new ${upstream} pairs differ`);
    assert.ok(old === 0 || upstream === 0, `neither Firefox model reproduces getImageData (old ${old}, new ${upstream})`);
    const regime = old === 0 ? 'moz2d-old' : 'moz2d-new';
    for (const name of tableNames) assert.equal(mismatch(ENGINES[regime], T[name]), 0, name + ' = ' + regime);
    for (const name of Object.keys(png)) { const d = mismatch(ENGINES[regime], png[name], 'png'); lines.push(`PNG ${name}: ${regime} ${d}`); assert.equal(d, 0, 'PNG ' + name); }
    check(`Moz2D model ${regime} reproduces every read path and every PNG path exactly (0 of ${pairs} pairs differ)` + (regime === 'moz2d-old' ? `; ${MOZ_OLD_LIST.size} states read floor(x) - 1` : '; the upstream rounding is what this Firefox runs'));
  }
  if (T.state) {
    const premulOf = family === 1 ? ENGINES['skia-cpu'] : (mismatch(ENGINES['moz2d-old'], soft) === 0 ? ENGINES['moz2d-old'] : ENGINES['moz2d-new']);
    let bad = 0; for (let a = 1; a <= 254; a++) for (let v = 0; v < 256; v++) if (T.state[index(a, v)] !== premulOf.premul(v, a)) bad++;
    lines.push(`stored premultiplied bytes (WebGL): ${bad} of ${pairs} differ from ${premulOf.name} premul`); assert.equal(bad, 0, 'putImageData stores ' + premulOf.name + ' premultiplied bytes'); check(`the stored bytes read through WebGL equal premul(v, a) of ${premulOf.name} for all ${pairs} pairs`);
  } else lines.push('stored premultiplied bytes: not readable through WebGL here (' + (m.notes.state ?? 'no framebuffer') + ')');
  // A drawing reaches states putImageData reaches too: every byte fillRect() reads back is a byte the put/get tables return for that alpha.
  {
    assert.equal(m.counts.fillAlpha, 0, 'fillStyle keeps the requested alpha'); let outside = 0, differs = 0;
    for (let a = 1; a <= 254; a++) { const known = readable(soft, a); for (let v = 0; v < 256; v++) { const byte = fillTable[index(a, v)]; if (!known.has(byte)) outside++; if (byte !== soft[index(a, v)]) differs++; } }
    assert.equal(outside, 0, 'fillRect read back a byte putImageData never produces'); lines.push(`fillRect: ${differs} of ${pairs} pairs read other bytes than putImageData of the same (value, alpha), all inside the same reachable sets`);
    check(`fillRect(rgba) drawings of all ${pairs} (alpha, value) pairs read back only bytes the put/get tables return (${differs} pairs differ from putImageData: another stored state, same arithmetic)`);
  }
  if (report) console.log(lines.map(line => '    ' + line).join('\n'));

  // ---- 3. the production rule against the measured tables only ------------------------------------------------
  {
    const getTables = tableNames.map(name => T[name]);
    let readableInputs = 0, movable = 0, inspected = 0;
    for (let a = 1; a <= 254; a++) {
      const sets = getTables.map(table => readable(table, a)), everywhere = new Set([...sets[0]].filter(value => sets.every(set => set.has(value)))), union = new Set(sets.flatMap(set => [...set]));
      for (const v of union) for (const up of [0, 1]) {
        readableInputs++;
        const w = I.nearbyValue(v, a, up, family); if (w < 0) continue;
        movable++; inspected++;
        assert.ok(w >= 0 && w <= 255 && w !== v);
        for (const [i, set] of sets.entries()) assert.ok(set.has(w), `${tableNames[i]}: alpha ${a}: ${v} -> ${w} is a byte this path never returns`);
        assert.ok(everywhere.has(w));
        // putImageData(w) then getImageData returns w in every path: a valid stored state of this engine
        for (const [i, table] of getTables.entries()) assert.equal(table[index(a, w)], w, `${tableNames[i]}: alpha ${a}: putImageData(${w}) reads back ${table[index(a, w)]}`);
      }
    }
    const share = movable / readableInputs;
    assert.ok(share > (family === 1 ? 0.999 : 0.85), `${(share * 100).toFixed(2)}% of the readable values can move`);
    check(`production rule vs the measured tables: ${inspected} moves over ${readableInputs} readable (alpha, value, direction) inputs (${(share * 100).toFixed(2)}% movable), every result is returned by all ${getTables.length} measured read paths and survives putImageData -> getImageData in each`);
  }

  // ADR-112: sparse-rgb-v2 takes the keyed bit as the parity of the stored state. Same standard as above: every result is returned by all measured read
  // paths and survives putImageData -> getImageData; where the stored premultiplied bytes are readable (T.state) the stored byte has the keyed parity,
  // and a second projection of what the engine reads back moves nothing (idempotence).
  {
    const getTables = tableNames.map(name => T[name]);
    let readableInputs = 0, movable = 0, parityChecked = 0, second = 0, parityMisses = 0, secondMoves = 0;
    for (let a = 1; a <= 254; a++) {
      const sets = getTables.map(table => readable(table, a)), union = new Set(sets.flatMap(set => [...set]));
      for (const v of union) for (const bit of [0, 1]) {
        readableInputs++;
        const w = I.nearbyParity(v, a, bit, family); if (w < 0) continue;
        movable++;
        assert.ok(w >= 0 && w <= 255 && w !== v);
        for (const [i, set] of sets.entries()) assert.ok(set.has(w), `${tableNames[i]}: alpha ${a}: parity ${bit}: ${v} -> ${w} is a byte this path never returns`);
        for (const [i, table] of getTables.entries()) assert.equal(table[index(a, w)], w, `${tableNames[i]}: alpha ${a}: putImageData(${w}) reads back ${table[index(a, w)]}`);
        // Skia: the stored byte has the keyed parity and a second projection moves nothing. Moz2D premultiplies by ceil (Firefox 138/153), so the value read for a
        // neighbouring state can be stored as another state: the parity is then missed and a second projection may move again (ADR-112 states this residual).
        if (T.state) { parityChecked++; if ((T.state[index(a, w)] & 1) !== bit) { parityMisses++; assert.ok(family === 2, `alpha ${a}: the stored byte of ${w} has parity ${bit}`); } }
        second++; if (I.nearbyParity(w, a, bit, family) !== -1) { secondMoves++; assert.ok(family === 2, `alpha ${a}: a second projection of ${w} moves nothing`); }
      }
    }
    const share = movable / readableInputs;
    assert.ok(share > (family === 1 ? 0.49 : 0.38), `${(share * 100).toFixed(2)}% of the readable values can move`);
    check(`sparse-rgb-v2 rule vs the measured tables: ${movable} moves over ${readableInputs} readable (alpha, value, bit) inputs (${(share * 100).toFixed(2)}% movable, about half already carry the keyed parity), every result is returned by all ${getTables.length} measured read paths and survives putImageData -> getImageData${T.state ? (parityMisses ? '; the stored byte misses the keyed parity for ' + parityMisses + ' of ' + parityChecked + ' (Moz2D residual)' : '; the stored byte has the keyed parity for all ' + parityChecked) : ''}${secondMoves ? '; a second projection moves ' + secondMoves + ' of ' + second + ' (Moz2D residual)' : '; a second projection moves none of the ' + second}`);
  }

  // ---- 4. the installed rule, end to end ----------------------------------------------------------------------
  // geckodriver runs scripts in a sandbox that sees the page through Xray wrappers, which hide what the installer defines: the installed
  // Firefox is measured and the rule is checked against its tables (1-3), but the installed rule is not run there.
  const algorithms = mode === 'installed-firefox' ? [] : ['sparse-rgb-v2', 'sparse-rgb-v1', 'stable-rgb-v1'];
  const SHAPES = [[300, 150, 11], [512, 512, 12], [700, 400, 13], [1100, 700, 14]];
  const oracle = (algorithm, pixels, width, height) => algorithm === 'sparse-rgb-v2' ? sparseExpectedV2(pixels, width, height, KEY, family).data : algorithm === 'sparse-rgb-v1' ? sparseExpected(pixels, width, height, KEY, family).data : stableExpected(pixels, width, height, KEY, family);
  const grid = gridPixels();
  const gridCanvases = ['soft', 'default'];
  const timings = {};
  for (const algorithm of algorithms) {
    const c = await session.covered(algorithm, coveredProbe, { installer: installCanvasCustom.toString(), entries: JSON.stringify([{ id: 'canvas-readback', mode: 'custom', value: { algorithm }, canvasSeed: SEED }]), grid: Buffer.from(grid.buffer).toString('base64'), gridCanvases, shapes: SHAPES.filter(([w, h]) => algorithm !== 'stable-rgb-v1' || w * h <= 70000) });
    timings[algorithm] = c.times;
    // the grid, software canvas and the canvas the browser may accelerate
    for (const label of gridCanvases) {
      const row = c.shapes['grid-' + label], input = gridFromTable(label === 'soft' ? soft : T.gpu), read = clamped64(row.read);
      assert.ok(sameBytes(read, oracle(algorithm, input, 256, 256)), `${algorithm} grid (${label}): getImageData differs from the oracle`);
      let moved = 0, translucent = 0;
      for (let p = 0; p < 65536; p++) { const a = p >> 8; assert.equal(read[p * 4 + 3], a); if (a > 0 && a < 255) { translucent++; for (let ch = 0; ch < 3; ch++) if (read[p * 4 + ch] !== input[p * 4 + ch]) moved++; } else for (let ch = 0; ch < 3; ch++) if (a === 0) assert.equal(read[p * 4 + ch], 0); }
      assert.ok(moved > translucent * (algorithm === 'sparse-rgb-v2' ? (family === 1 ? 0.45 : 0.35) : algorithm === 'sparse-rgb-v1' ? (family === 1 ? 0.99 : 0.85) : 3 * (family === 1 ? 0.99 : 0.8)) - 1, `${algorithm} ${label}: ${moved} translucent channels moved of ${translucent} pixels`);
      check(`${algorithm} ${label} grid: all ${65536} pixels of getImageData equal the independent oracle (${moved} ${algorithm !== 'stable-rgb-v1' ? 'of ' + translucent + ' translucent pixels' : 'translucent channels'} carry a mark)`);
    }
    {
      const row = c.shapes['grid-soft'], read = clamped64(row.read);
      assert.equal(countDiff(read, clamped64(row.after)), 0, 'a second read returns the same marked bytes');
      // exports: what a NATIVE canvas holding the marked bytes exports, and what drawing that export back reads
      const wantPng = new Uint8ClampedArray(read.length), wantRedraw = new Uint8ClampedArray(read.length);
      for (let p = 0; p < 65536; p++) { const a = p >> 8; wantPng[p * 4 + 3] = wantRedraw[p * 4 + 3] = a; if (a === 0) continue; for (let ch = 0; ch < 3; ch++) { const w = read[p * 4 + ch]; wantPng[p * 4 + ch] = a === 255 ? w : png.soft[index(a, w)]; wantRedraw[p * 4 + ch] = a === 255 ? w : T.redrawWorker ? T.redrawWorker[index(a, w)] : 0; } }
      const native = gridFromTable(soft);
      for (const kind of ['url', 'blob', 'off']) {
        if (!row[kind]) continue; const got = pngRaw(row[kind]).data, odd = [];
        for (let o = 0; o < got.length && odd.length < 6; o++) if (got[o] !== wantPng[o]) odd.push(`pixel ${o >> 2} (alpha ${got[(o | 3)]}) channel ${o & 3}: export ${got[o]}, expected ${wantPng[o]}, read ${read[o]}, native ${native[o]}`);
        assert.equal(countDiff(got, wantPng), 0, `${algorithm}: ${kind} export differs from the native export of the marked bytes (${countDiff(got, wantPng)} bytes): ${odd.join('; ')}`);
      }
      if (T.redrawWorker) assert.equal(countDiff(clamped64(row.redraw), wantRedraw), 0, `${algorithm}: drawing the export back reads other bytes than a native pixel of the marked bytes`);
      if (T.redrawWorker && family === 1) { let drift = 0, markedBytes = 0; const redraw = clamped64(row.redraw), nativeGrid = gridFromTable(soft); for (let o = 0; o < read.length; o++) if (o % 4 !== 3 && read[o] !== nativeGrid[o]) { markedBytes++; if (redraw[o] !== read[o]) drift++; } assert.equal(drift, 0, `${algorithm}: in Skia drawing the marked PNG back reads the marked bytes (${drift} of ${markedBytes} differ)`); check(`${algorithm}: in Skia drawing the marked PNG back and reading it reads exactly the marked bytes (${markedBytes} marked bytes)`); }
      let agree = 0, marked = 0; const exported = pngRaw(row.url).data;
      for (let p = 0; p < 65536; p++) { const a = p >> 8; if (a === 0 || a === 255) continue; for (let ch = 0; ch < 3; ch++) { const o = p * 4 + ch; if (read[o] !== gridFromTable(soft)[o]) { marked++; if (exported[o] === read[o]) agree++; } } }
      check(`${algorithm}: toDataURL, toBlob${row.off ? ', convertToBlob' : ''} equal the native export of the marked bytes for all 65536 pixels` + (T.redrawWorker ? ', and drawing the export back reads what a native pixel of those bytes reads' : ''));
      if (family === 1) { assert.equal(agree, marked, 'in Skia a marked byte reads the same in getImageData and in the PNG'); check(`${algorithm}: in Skia every one of the ${marked} marked bytes is the same in getImageData and in the exported PNG`); }
      else console.log(`  note: Moz2D encodes PNG by rounding and getImageData by ${mismatch(ENGINES['moz2d-old'], soft) === 0 ? 'flooring' : 'rounding'}: ${agree} of ${marked} marked bytes are equal in both (natively the same relation holds for every pixel)`);
    }
    // a dedicated Worker running the installer (the packaged Worker bootstrap does): the family is recognised there too (Chromium: the Worker global has
    // webkitRequestFileSystem; Firefox: SpiderMonkey's Error#fileName), so it marks like the window
    if (c.worker) {
      const input = gridFromTable(soft), read = clamped64(c.worker), want = oracle(algorithm, input, 256, 256);
      let translucentMoved = 0; for (let p = 0; p < 65536; p++) { const a = p >> 8; if (a > 0 && a < 255) for (let ch = 0; ch < 3; ch++) if (read[p * 4 + ch] !== input[p * 4 + ch]) translucentMoved++; }
      assert.ok(sameBytes(read, want), `${algorithm}: a Worker's getImageData differs from the oracle`); assert.ok(translucentMoved > (algorithm === 'sparse-rgb-v2' ? (family === 1 ? 25000 : 20000) : family === 1 ? 50000 : 40000), 'translucent marks in the Worker: ' + translucentMoved);
      check(`${algorithm}: a dedicated Worker running the installer marks the grid like the window does (${translucentMoved} translucent channels, all 65536 pixels equal the oracle)`);
    }
    // random canvases in the three zones
    for (const [width, height] of SHAPES) {
      const row = c.shapes[width + 'x' + height]; if (!row) continue;
      const input = clamped64(row.native), read = clamped64(row.read), want = oracle(algorithm, input, width, height);
      assert.ok(sameBytes(read, want), `${algorithm} ${width}x${height}: getImageData differs from the oracle`);
      let moved = 0, translucent = 0, opaque = 0; for (let o = 0; o < read.length; o += 4) { const a = input[o + 3]; if (a === 255) opaque++; else if (a > 0) translucent++; if (a > 0 && a < 255 && (read[o] !== input[o] || read[o + 1] !== input[o + 1] || read[o + 2] !== input[o + 2])) moved++; }
      // the export: each pixel's PNG value is what a native canvas holding the marked bytes exports
      const exported = pngRaw(row.url).data; let bad = 0;
      for (let o = 0; o < read.length; o += 4) { const a = read[o + 3]; for (let ch = 0; ch < 3; ch++) { const w = read[o + ch], expectedValue = a === 0 ? 0 : a === 255 ? w : png.soft[index(a, w)]; if (exported[o + ch] !== expectedValue) bad++; } }
      assert.equal(bad, 0, `${algorithm} ${width}x${height}: ${bad} exported bytes differ from the native export of the marked bytes`);
      check(`${algorithm} ${width}x${height} (${width * height <= 65536 ? 'small' : width * height <= 262144 ? 'medium' : 'large'} zone, ${opaque} opaque / ${translucent} translucent pixels): getImageData equals the oracle (${moved} translucent pixels moved) and toDataURL equals the native export of the marked bytes`);
    }
    // a 0.99 copy
    {
      const cpu = clamped64(c.copy.nativeCpu), gpu = clamped64(c.copy.nativeGpu), read = clamped64(c.copy.read), input = cpu; let moved = 0, total = 0, outside = 0, unchanged = 0; const odd = [];
      const sets = tableNames.map(name => T[name]);
      for (let o = 0; o < read.length; o += 4) {
        const a = input[o + 3]; if (a === 0 || a === 255) { assert.equal(read[o + 3], a); continue; }
        total++; let any = false;
        for (let ch = 0; ch < 3; ch++) if (read[o + ch] !== cpu[o + ch] && read[o + ch] !== gpu[o + ch]) { any = true; if (!sets.every(table => readable(table, a).has(read[o + ch]))) { outside++; odd.push(`pixel ${o / 4} channel ${ch} alpha ${a}: native ${input[o + ch]} -> ${read[o + ch]} (tables that lack it: ${tableNames.filter((name, i) => !readable(sets[i], a).has(read[o + ch])).join(',')}; tables that lack the native byte: ${tableNames.filter((name, i) => !readable(sets[i], a).has(input[o + ch])).join(',')})`); } }
        if (any) moved++; else unchanged++;
      }
      assert.ok(total > 1000, 'the copy has translucent pixels: ' + total); assert.equal(outside, 0, 'every moved byte of the copy is a byte every measured path returns: ' + odd.join('; '));
      assert.ok(moved > total * (algorithm === 'sparse-rgb-v2' ? 0.4 : algorithm === 'sparse-rgb-v1' ? 0.5 : 0.9), `${algorithm}: only ${moved} of ${total} pixels of the 0.99 copy are marked`);
      check(`${algorithm}: a drawing copied at globalAlpha 0.99 (alpha ${input[3]}...) is marked in ${moved} of ${total} translucent pixels (every moved byte is returned by all measured paths); before translucent marking: 0`);
    }
    // a WebGL canvas keeps its translucent pixels native
    // a WebGL canvas with translucent pixels takes the 2D export rule (ADR-112): its translucent pixels are marked like those of a 2D canvas holding the same pixels, opaque and transparent ones and alpha stay
    if (c.webgl && m.urls.webgl) {
      const exported = pngRaw(c.webgl).data, nativeExport = pngRaw(m.urls.webgl).data; let marked = 0;
      for (let o = 0; o < exported.length; o += 4) { assert.equal(exported[o + 3], nativeExport[o + 3], 'alpha is never touched'); const a = exported[o + 3]; if (exported[o] !== nativeExport[o] || exported[o + 1] !== nativeExport[o + 1] || exported[o + 2] !== nativeExport[o + 2]) { assert.ok(a > 0 && a < 255, 'only translucent pixels are marked'); marked++; } }
      // The scene has two colours: sparse-rgb-v2 returns such a flat canvas as rendered (its 2D mirror too), the older algorithms mark it.
      if (algorithm === 'sparse-rgb-v2') { assert.equal(marked, 0, `${algorithm}: a flat WebGL scene is exported as rendered`); check(`${algorithm}: a WebGL canvas of two translucent colours is exported as the engine writes it (flat canvas, like its 2D mirror)`); }
      else { assert.ok(marked > 100, `${algorithm}: the translucent pixels of a WebGL canvas export are marked (${marked} of ${exported.length / 4})`); check(`${algorithm}: a WebGL canvas with translucent pixels exports them marked like a 2D canvas (${marked} pixels; opaque, transparent and alpha unchanged)`); }
    }
  }

  // ---- timing -------------------------------------------------------------------------------------------------
  const native1080 = !algorithms.length ? null : await session.uncovered(async () => {
    const W = 1920, H = 1080, best = async (n, fn) => { let b = Infinity; for (let i = 0; i < n; i++) { const s = performance.now(); await fn(); b = Math.min(b, performance.now() - s); } return +b.toFixed(1); };
    const times = {};
    for (const kind of ['opaque', 'translucent']) {
      const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H; const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (kind === 'opaque') { ctx.fillStyle = 'rgb(83,129,207)'; ctx.fillRect(0, 0, W, H); }
      else { const base = document.createElement('canvas'); base.width = W; base.height = H; const bc = base.getContext('2d'); const gr = bc.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#f60'); gr.addColorStop(1, '#069'); bc.fillStyle = gr; bc.fillRect(0, 0, W, H); ctx.globalAlpha = 0.99; ctx.drawImage(base, 0, 0); }
      times[kind] = { getImageData: await best(5, () => ctx.getImageData(0, 0, W, H)), toDataURL: await best(3, () => canvas.toDataURL()), toBlob: await best(3, () => new Promise(resolve => canvas.toBlob(resolve))) };
    }
    return times;
  });
  if (!algorithms.length) console.log('  note: --installed-firefox measures and checks the rule against the measured tables; the installed rule runs in the other modes');
  for (const [algorithm, times] of Object.entries(timings)) for (const kind of ['opaque', 'translucent']) console.log(`  1920x1080 ${kind} ${algorithm} (ms, best of 5/3/3) getImageData ${native1080[kind].getImageData} -> ${times[kind].getImageData}, toDataURL ${native1080[kind].toDataURL} -> ${times[kind].toDataURL}, toBlob ${native1080[kind].toBlob} -> ${times[kind].toBlob}  (native -> installed)`);
  console.log(`canvas translucent native ${mode}: ${checks.length} checks PASS`);
} catch (error) { failed = error; console.error(error); process.exitCode = 1; }
finally { await session?.close(); }
if (failed) throw failed;
