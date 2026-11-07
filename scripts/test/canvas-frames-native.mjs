// ADR-066 / ADR-049 / ADR-106 / ADR-108: Canvas noise CONSISTENCY across every kind of realm a script can run in (owner's order 2026-11-07).
// One NON-flat 2D drawing (a gradient, antialiased text, a translucent disc and translucent text on transparent pixels) and one WebGL scene (a
// shader gradient) are read back with getImageData, toDataURL, toBlob, OffscreenCanvas.convertToBlob and WebGL readPixels / GL toDataURL / the 2D
// mirror of the GL canvas in the top page and in 28 other realms: srcdoc, same-origin / other-port / other-host navigated frames (alt.test is mapped
// to 127.0.0.1), sandboxed frames (URL, srcdoc, allow-same-origin), nested frames of mixed origins and their about:blank / document.write children,
// about:blank read right after appendChild, document.write, blob: and data: frames, popups (same origin read at once, own script, other host),
// frames that navigate after creation and iframes inside a shadow root. A fingerprinting script inside any of them must see the page's projection.
//
//   node scripts/test/canvas-frames-native.mjs [--keep]      Chrome only (Playwright Chromium); --keep leaves the run folder after a pass
//
// The extension is staged FROM SOURCE into .tmp/canvas-frames-chrome-* (never dist/ or release/), the per-extension user-scripts switch is flipped as
// every native does, the product level (balanced, strict) comes from generateConsistentDevice of the STAGED copy, scope all-sites (and one run with
// scope site = 127.0.0.1), registration=ready is asserted. A plain Chromium pass gives the native hashes: the fixture must be neutral (every realm
// reads the same natively) and every Custom result is classified against the page of its own run and against the native value:
//   P  equals the top page and differs from native    =  equals both (native by design)      N  native      O  other      T  SecurityError
// Oracle (all-sites): every cell P, except sb-srcdoc and data: = T (ADR-066: an inherited opaque realm has no synchronous trusted key, so the
// covered readbacks are denied; chrome.userScripts.register has no matchOriginAsFallback, recorded below) and popup-cross = O (a top-level document
// keys its noise by its own origin). WebGL readPixels is projected only where the webgl-readback row exists (strict, ADR-108); GL exports must equal
// the top page. Scope site: the cells of the other host (frames, their children, the popup) read N. The Custom canvas wrapper set is asserted per
// cell (the five covered methods are wrapped, the deny marker and the document marker exist; the opaque guard in the two denied cells); the
// observation sensors are RECORDED, never asserted: they stay inert in same-origin child documents because of their own child-realm manager.
// Native hashes of a run that differ from the top page are recorded too, so an algorithm change that makes a cell native by mistake fails here.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { enableChromeUserScripts } from './api-custom-early-native.mjs';
import { until } from './management-browser-fixture.mjs';
import { stageExtension } from './native-evidence.mjs';

// ---- page code: serialized into the owned fixture pages, never executed in Node --------------------------------------------------------------
function labCore() {
  'use strict';
  var FTS = Function.prototype.toString;
  function fnv(bytes) { var h = 0x811c9dc5; for (var i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0') + '/' + bytes.length; }
  function fnvText(text) { var bytes = new Uint8Array(text.length); for (var i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 255; return fnv(bytes); }
  function tag(error) { return 'THROW:' + ((error && error.name) || 'Error') + (error && error.message ? '(' + String(error.message).slice(0, 36) + ')' : ''); }
  function safe(read) { try { return read(); } catch (error) { return tag(error); } }
  // The fixed picture: far more than four colours, antialiased text edges, translucent pixels (a disc and text over transparent pixels).
  function paint(ctx, w, h) {
    var g = ctx.createLinearGradient(0, 0, w / 2, h); g.addColorStop(0, '#ff7f50'); g.addColorStop(0.5, '#6a5acd'); g.addColorStop(1, '#20b2aa');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w / 2, h);
    ctx.font = '600 20px Arial'; ctx.fillStyle = '#102030'; ctx.fillText('Frame noise 0123', 8, h * 0.4);
    ctx.globalAlpha = 0.5; ctx.fillStyle = '#00c070'; ctx.beginPath(); ctx.arc(w * 0.75, h * 0.5, h * 0.35, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(200,30,30,0.3)'; ctx.fillText('translucent', w * 0.55, h * 0.85);
  }
  function draw(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; paint(c.getContext('2d', { willReadFrequently: true }), w, h); return c; }
  // A WebGL scene whose 4096 opaque pixels carry a continuous shader gradient (not flat, not a few solid colours).
  function glRead(out) {
    try {
      var c = document.createElement('canvas'); c.width = 64; c.height = 64;
      var g = c.getContext('webgl', { preserveDrawingBuffer: true, antialias: false });
      if (!g) { out.reads.glpx = 'NOGL'; return; }
      function shader(type, source) { var s = g.createShader(type); g.shaderSource(s, source); g.compileShader(s); return s; }
      var prog = g.createProgram();
      g.attachShader(prog, shader(g.VERTEX_SHADER, 'attribute vec2 p; varying vec2 uv; void main(){ gl_Position = vec4(p, 0.0, 1.0); uv = (p + 1.0) * 0.5; }'));
      g.attachShader(prog, shader(g.FRAGMENT_SHADER, 'precision mediump float; varying vec2 uv; void main(){ gl_FragColor = vec4(uv.x, uv.y, 0.5 + 0.5 * sin(uv.x * 23.0 + uv.y * 17.0), 1.0); }'));
      g.linkProgram(prog); g.useProgram(prog);
      var buffer = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, buffer); g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, -1, 1, 1, -1, 1]), g.STATIC_DRAW);
      var loc = g.getAttribLocation(prog, 'p'); g.enableVertexAttribArray(loc); g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);
      g.viewport(0, 0, 64, 64); g.drawArrays(g.TRIANGLES, 0, 6);
      var px = new Uint8Array(64 * 64 * 4);
      out.reads.glpx = safe(function () { g.readPixels(0, 0, 64, 64, g.RGBA, g.UNSIGNED_BYTE, px); return fnv(px); });
      out.reads.glurl = safe(function () { return fnvText(c.toDataURL()); });
      out.reads.glmirror = safe(function () { var m = document.createElement('canvas'); m.width = 64; m.height = 64; var mx = m.getContext('2d'); mx.drawImage(c, 0, 0); return fnv(mx.getImageData(0, 0, 64, 64).data); });
      safe(function () { var l = g.getExtension('WEBGL_lose_context'); if (l) l.loseContext(); });
    } catch (error) { out.reads.glpx = tag(error); }
  }
  var WRAP = [['HTMLCanvasElement', 'toDataURL'], ['HTMLCanvasElement', 'toBlob'], ['HTMLCanvasElement', 'getContext'], ['CanvasRenderingContext2D', 'getImageData'], ['CanvasRenderingContext2D', 'putImageData'],
    ['CanvasRenderingContext2D', 'drawImage'], ['CanvasRenderingContext2D', 'fillText'], ['CanvasRenderingContext2D', 'measureText'], ['OffscreenCanvas', 'convertToBlob'], ['WebGLRenderingContext', 'readPixels']];
  // native = untouched; proxy = native-looking but nameless (a Proxy); plain = a script function; missing = absent.
  function wrappers() {
    var o = {};
    WRAP.forEach(function (p) {
      var C = window[p[0]], d = C && C.prototype && Object.getOwnPropertyDescriptor(C.prototype, p[1]);
      if (!d || typeof d.value !== 'function') { o[p[1]] = 'missing'; return; }
      var s; try { s = FTS.call(d.value); } catch (error) { o[p[1]] = 'err'; return; }
      o[p[1]] = !/\{\s*\[native code\]\s*\}/.test(s) ? 'plain' : (s === 'function ' + p[1] + '() { [native code] }' ? 'native' : 'proxy');
    });
    return o;
  }
  function symbols() { try { return Object.getOwnPropertySymbols(window).map(function (s) { return String(s).replace('Symbol(detect.expert/', '').replace(')', ''); }); } catch (error) { return [tag(error)]; } }
  function offscreen(out) {
    return new Promise(function (resolve) {
      var done = false;
      function finish(value) { if (!done) { done = true; out.reads.off240x90 = value; resolve(); } }
      try {
        var oc = new OffscreenCanvas(240, 90); paint(oc.getContext('2d'), 240, 90);
        oc.convertToBlob().then(function (blob) { return blob.arrayBuffer(); }).then(function (buffer) { finish(fnv(new Uint8Array(buffer))); }, function (error) { finish(tag(error)); });
      } catch (error) { finish(tag(error)); }
      setTimeout(function () { finish('TIMEOUT'); }, 20000);
    });
  }
  // sync = the read right after appendChild / window.open: no toBlob / convertToBlob (their realm may be replaced before they answer).
  function run(cell, sync) {
    var out = { cell: cell, proto: location.protocol, origin: safe(function () { return location.origin; }), winOrigin: safe(function () { return window.origin; }),
      ancestors: safe(function () { return Array.prototype.slice.call(location.ancestorOrigins); }), isTop: window === window.top, reads: {}, wrap: {}, sym: [] };
    var pending = [];
    [[240, 90], [520, 300]].forEach(function (size) {
      var key = size[0] + 'x' + size[1], canvas;
      try { canvas = draw(size[0], size[1]); } catch (error) { out.reads['draw' + key] = tag(error); return; }
      var ctx = canvas.getContext('2d');
      out.reads['gid' + key] = safe(function () { return fnv(ctx.getImageData(0, 0, size[0], size[1]).data); });
      out.reads['url' + key] = safe(function () { return fnvText(canvas.toDataURL()); });
      if (!sync) pending.push(new Promise(function (resolve) {
        var done = false;
        function finish(value) { if (!done) { done = true; out.reads['blob' + key] = value; resolve(); } }
        try { canvas.toBlob(function (blob) { if (!blob) { finish('NULL'); return; } blob.arrayBuffer().then(function (buffer) { finish(fnv(new Uint8Array(buffer))); }, function (error) { finish(tag(error)); }); }); } catch (error) { finish(tag(error)); }
        setTimeout(function () { finish('TIMEOUT'); }, 20000);
      }));
    });
    glRead(out);
    if (!sync) pending.push(offscreen(out));
    out.wrap = wrappers(); out.sym = symbols();
    return sync ? out : Promise.all(pending).then(function () { return out; });
  }
  return { run: run };
}
// Runs LAB in the page it is written into and reports the result to the top page (or to the opener of a popup). REPORT_SRC is its source text.
function reportScript(cell) {
  function send(result) { var target = window.opener || window.top; try { target.postMessage({ lab: 1, cell: cell, r: result }, '*'); } catch (error) { /* the page is gone */ } }
  try { LAB.run(cell).then(send, function (error) { send({ cell: cell, error: String(error) }); }); } catch (error) { send({ cell: cell, error: 'sync:' + error }); }
}
// /frame.html: reports itself, or builds the next frame of a chain, or creates its own about:blank / document.write child (a frame of another origin).
function frameMain() {
  var q = new URLSearchParams(location.search), cell = q.get('cell') || 'frame', chain = JSON.parse(q.get('chain') || '[]');
  function send(result) { var target = window.opener || window.top; try { target.postMessage({ lab: 1, cell: cell, r: result }, '*'); } catch (error) { /* the page is gone */ } }
  if (q.get('blankchild')) { var b = document.createElement('iframe'); document.body.appendChild(b); send(JSON.parse(JSON.stringify(b.contentWindow.eval(CORE_SRC + ';LAB.run(' + JSON.stringify(cell) + ', true)')))); return; }
  if (q.get('writechild')) {
    var w = document.createElement('iframe'); document.body.appendChild(w);
    var d = w.contentDocument; d.open(); d.write('<!doctype html><script>' + CORE_SRC + ';(' + REPORT_SRC + ')(' + JSON.stringify(cell) + ')<\/script>'); d.close(); return;
  }
  if (chain.length) { var f = document.createElement('iframe'); f.src = chain[0] + '?cell=' + encodeURIComponent(cell) + '&chain=' + encodeURIComponent(JSON.stringify(chain.slice(1))); document.body.appendChild(f); return; }
  reportScript(cell);
}
// /lab.html: builds every kind of frame / popup one after the other and collects the reports in window.__lab.
function labOrchestrator(config) {
  var results = {}, notes = {};
  window.__lab = { results: results, notes: notes, done: false };
  var same = location.origin, byPort = 'http://127.0.0.1:' + config.p2, byHost = 'http://alt.test:' + config.p1;
  var holder = document.createElement('div'); document.body.appendChild(holder);
  addEventListener('message', function (event) { var data = event.data; if (data && data.lab === 1 && data.cell && !results[data.cell]) results[data.cell] = data.r; });
  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function waitFor(cell, ms) { return new Promise(function (resolve) { var t0 = Date.now(); (function poll() { if (results[cell] || Date.now() - t0 > (ms || 30000)) resolve(!!results[cell]); else setTimeout(poll, 50); })(); }); }
  function docFor(cell) { return '<!doctype html><meta charset="utf-8"><body><script>' + CORE_SRC + '\n;(' + REPORT_SRC + ')(' + JSON.stringify(cell) + ')<\/script></body>'; }
  function ifr(attributes) { var f = document.createElement('iframe'); for (var k in attributes) f.setAttribute(k, attributes[k]); f.style.cssText = 'width:300px;height:150px;border:0'; return f; }
  async function step(names, build) {
    names = Array.isArray(names) ? names : [names];
    var f = null;
    try { f = build(); for (var i = 0; i < names.length; i++) if (!(await waitFor(names[i]))) notes[names[i]] = 'no report'; }
    catch (error) { notes[names[0]] = 'ERR ' + ((error && error.stack) || error); }
    try { if (f && typeof f.close === 'function') f.close(); else if (f && f.parentNode) f.parentNode.removeChild(f); } catch (error) { /* already gone */ }
    await sleep(150);
  }
  function plain(value) { return JSON.parse(JSON.stringify(value)); }
  function shadowHost() { var host = document.createElement('div'); document.body.appendChild(host); return { host: host, root: host.attachShadow({ mode: 'open' }) }; }
  function esc(text) { return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }
  function chainUrl(first, rest, name) { return first + '/frame.html?cell=' + name + '&chain=' + encodeURIComponent(JSON.stringify(rest.map(function (url) { return url + '/frame.html'; }))); }
  async function main() {
    results.top = plain(await LAB.run('top'));
    await step('srcdoc', function () { var f = ifr({}); f.srcdoc = docFor('srcdoc'); holder.appendChild(f); return f; });
    await step('nav-same', function () { var f = ifr({}); f.src = same + '/frame.html?cell=nav-same'; holder.appendChild(f); return f; });
    await step('nav-port', function () { var f = ifr({}); f.src = byPort + '/frame.html?cell=nav-port'; holder.appendChild(f); return f; });
    await step('nav-host', function () { var f = ifr({}); f.src = byHost + '/frame.html?cell=nav-host'; holder.appendChild(f); return f; });
    await step('sb-src', function () { var f = ifr({ sandbox: 'allow-scripts' }); f.src = same + '/frame.html?cell=sb-src'; holder.appendChild(f); return f; });
    await step('sb-srcdoc', function () { var f = ifr({ sandbox: 'allow-scripts' }); f.srcdoc = docFor('sb-srcdoc'); holder.appendChild(f); return f; });
    await step('sb-same', function () { var f = ifr({ sandbox: 'allow-scripts allow-same-origin' }); f.src = same + '/frame.html?cell=sb-same'; holder.appendChild(f); return f; });
    await step('sb-host', function () { var f = ifr({ sandbox: 'allow-scripts' }); f.src = byHost + '/frame.html?cell=sb-host'; holder.appendChild(f); return f; });
    await step('nest2', function () { var f = ifr({}); f.src = chainUrl(byHost, [same], 'nest2'); holder.appendChild(f); return f; });
    await step('nest3', function () { var f = ifr({}); f.src = chainUrl(same, [byHost, byPort], 'nest3'); holder.appendChild(f); return f; });
    await step('nest-blank', function () { var f = ifr({}); f.src = byHost + '/frame.html?cell=nest-blank&blankchild=1'; holder.appendChild(f); return f; });
    await step('nest-write', function () { var f = ifr({}); f.src = byHost + '/frame.html?cell=nest-write&writechild=1'; holder.appendChild(f); return f; });
    await step('blank-sync', function () { var f = ifr({}); holder.appendChild(f); var w = f.contentWindow; results['blank-sync'] = plain(w.eval(CORE_SRC + ';LAB.run("blank-sync", true)')); return f; });
    await step('blank-write', function () { var f = ifr({}); holder.appendChild(f); var d = f.contentDocument; d.open(); d.write(docFor('blank-write')); d.close(); return f; });
    await step('blob', function () { var f = ifr({}); f.src = URL.createObjectURL(new Blob([docFor('blob')], { type: 'text/html' })); holder.appendChild(f); return f; });
    await step('data', function () { var f = ifr({}); f.src = 'data:text/html;charset=utf-8,' + encodeURIComponent(docFor('data')); holder.appendChild(f); return f; });
    await step(['popup-same-imm', 'popup-same'], function () {
      var w = window.open(same + '/frame.html?cell=popup-same', '_blank', 'popup=yes,width=420,height=300');
      results['popup-same-imm'] = plain(w.eval(CORE_SRC + ';LAB.run("popup-same-imm", true)')); return w;
    });
    await step('popup-cross', function () { return window.open(byHost + '/frame.html?cell=popup-cross', '_blank', 'popup=yes,width=420,height=300'); });
    await step(['navlater-first', 'navlater-same'], function () { var f = ifr({}); f.src = same + '/frame.html?cell=navlater-first'; holder.appendChild(f); setTimeout(function () { f.src = same + '/frame.html?cell=navlater-same'; }, 1800); return f; });
    await step(['navlater-srcdoc', 'navlater-xhost'], function () { var f = ifr({}); f.srcdoc = docFor('navlater-srcdoc'); holder.appendChild(f); setTimeout(function () { f.removeAttribute('srcdoc'); f.src = byHost + '/frame.html?cell=navlater-xhost'; }, 1800); return f; });
    await step('navlater-js', function () { var f = ifr({}); holder.appendChild(f); f.contentWindow.location.href = same + '/frame.html?cell=navlater-js'; return f; });
    await step('shadow-srcdoc', function () { var s = shadowHost(); s.root.innerHTML = '<iframe srcdoc="' + esc(docFor('shadow-srcdoc')) + '"></iframe>'; return s.host; });
    await step('shadow-src', function () { var s = shadowHost(); s.root.innerHTML = '<iframe src="' + same + '/frame.html?cell=shadow-src"></iframe>'; return s.host; });
    await step('shadow-append', function () { var s = shadowHost(); var f = ifr({}); f.srcdoc = docFor('shadow-append'); s.root.appendChild(f); return s.host; });
    await step('shadow-sync', function () { var s = shadowHost(); s.root.innerHTML = '<iframe></iframe>'; var f = s.root.querySelector('iframe'); results['shadow-sync'] = plain(f.contentWindow.eval(CORE_SRC + ';LAB.run("shadow-sync", true)')); return s.host; });
  }
  addEventListener('load', function () { main().catch(function (error) { notes.main = String((error && error.stack) || error); }).then(function () { window.__lab.done = true; }); });
}

// ---- the oracle -----------------------------------------------------------------------------------------------------------------------------------
const CELLS = Object.freeze(['top', 'srcdoc', 'nav-same', 'nav-port', 'nav-host', 'sb-src', 'sb-srcdoc', 'sb-same', 'sb-host', 'nest2', 'nest3', 'nest-blank', 'nest-write', 'blank-sync', 'blank-write', 'blob', 'data',
  'popup-same-imm', 'popup-same', 'popup-cross', 'navlater-first', 'navlater-same', 'navlater-srcdoc', 'navlater-xhost', 'navlater-js', 'shadow-srcdoc', 'shadow-src', 'shadow-append', 'shadow-sync']);
const TWO_D = ['gid240x90', 'url240x90', 'blob240x90', 'gid520x300', 'url520x300', 'blob520x300', 'off240x90'], GL = ['glpx', 'glurl', 'glmirror'], READS = [...TWO_D, ...GL];
// ADR-066: an inherited opaque realm (sandboxed srcdoc, data:) has no synchronous trusted key; covered readbacks are denied there.
const OPAQUE = new Set(['sb-srcdoc', 'data']);
// Scope site = 127.0.0.1 registers every script for that host only: the frames of the other host, their children and the cross-host popup stay out.
const OUTSIDE_SITE = new Set(['nav-host', 'sb-host', 'navlater-xhost', 'nest-blank', 'nest-write', 'popup-cross']);
// ADR-108: readPixels is projected only where the webgl-readback row exists.
const READ_PIXELS_LEVELS = new Set(['strict']);
// The Custom canvas wrapper set (ADR-066): installed in every realm the projection covers; the opaque guard denies the first four (readPixels too in strict).
const COVERED = ['toDataURL', 'toBlob', 'getContext', 'getImageData', 'convertToBlob'], GUARDED = ['toDataURL', 'toBlob', 'getImageData', 'convertToBlob'];
const DENY_MARKER = 'api-custom/value-capture-deny/v1', DOCUMENT_MARKER = 'api-custom/document/v2', SENSOR_MARKER = 'sensor/v1';
function classify(value, top, native) {
  if (typeof value === 'string' && value.startsWith('THROW:')) return value.startsWith('THROW:SecurityError') ? 'T' : 'E';
  if (typeof value === 'string' && /^(TIMEOUT|NULL|NOGL)$/u.test(value)) return value;
  return value === top && value === native ? '=' : value === top ? 'P' : value === native ? 'N' : 'O';
}
function expectedClasses(spec, cell, key) {
  const readPixels = key === 'glpx', exportOfGl = key === 'glurl' || key === 'glmirror';
  if (readPixels && !READ_PIXELS_LEVELS.has(spec.level)) return ['='];                  // native by design at this level
  if (spec.scope === 'site' && OUTSIDE_SITE.has(cell)) return ['N'];
  if (OPAQUE.has(cell)) return ['T'];
  if (cell === 'popup-cross') return ['O'];
  return exportOfGl ? ['P', '='] : ['P'];                                              // GL exports: equal to the top page (their algorithm belongs to the projection owner)
}
// Everything that disagrees with the oracle, plus the compact matrix and the per-cell evidence.
function judge(spec, lab, native) {
  const problems = [], matrix = {}, cells = {};
  if (Object.keys(lab.notes ?? {}).length) problems.push('fixture notes: ' + JSON.stringify(lab.notes));
  const top = lab.results.top?.reads ?? {};
  for (const cell of CELLS) {
    const report = lab.results[cell];
    if (!report || report.error) { problems.push(cell + ': no report ' + (report?.error ?? '')); continue; }
    const classes = {}, differs = {};
    for (const key of READS) {
      const value = report.reads[key]; if (value === undefined) continue;                // synchronous cells skip the asynchronous reads
      const actual = classify(value, top[key], native[key]); classes[key] = actual; differs[key] = value !== native[key];
      if (!expectedClasses(spec, cell, key).includes(actual)) problems.push(spec.label + ' ' + cell + ' ' + key + ': expected ' + expectedClasses(spec, cell, key).join('|') + ', got ' + actual + ' (' + value + ')');
    }
    matrix[cell] = READS.map(key => classes[key] ?? '-').join('');
    const wrap = report.wrap ?? {}, symbols = new Set(report.sym ?? []), outside = spec.scope === 'site' && OUTSIDE_SITE.has(cell), opaque = OPAQUE.has(cell);
    if (!outside) {
      const wanted = opaque ? [...GUARDED, ...(READ_PIXELS_LEVELS.has(spec.level) ? ['readPixels'] : [])] : COVERED;
      for (const method of wanted) if (wrap[method] === 'native' || wrap[method] === 'missing') problems.push(spec.label + ' ' + cell + ': ' + method + ' is not wrapped (' + wrap[method] + ')');
      if (!symbols.has(DENY_MARKER)) problems.push(spec.label + ' ' + cell + ': the Custom deny marker is missing');
      if (!opaque && !symbols.has(DOCUMENT_MARKER)) problems.push(spec.label + ' ' + cell + ': the Custom document marker is missing');
    }
    cells[cell] = { winOrigin: report.winOrigin, proto: report.proto, ancestors: report.ancestors, classes, differsFromNative: differs, canvasWrappers: Object.fromEntries(COVERED.map(method => [method, wrap[method]])), wrap,
      markers: [...symbols], sensors: { marker: symbols.has(SENSOR_MARKER), putImageData: wrap.putImageData ?? 'missing' } };   // recorded, never asserted
  }
  return { problems, matrix, cells };
}

// ---- Node side --------------------------------------------------------------------------------------------------------------------------------------
const root = resolve(import.meta.dirname, '../..'), keep = process.argv.includes('--keep'), SEED = 123456789;
mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/canvas-frames-chrome-')), extension = join(run, 'extension');
await stageExtension({ browser: 'chrome', target: extension, from: 'source' });
const evidence = { at: new Date().toISOString(), browser: 'chrome', run, extensionSource: 'source', result: 'RUNNING', checks: [], runs: {} };
const check = name => { evidence.checks.push(name); console.log('  ok ' + name); };
const json = value => JSON.stringify(value).replace(/</g, '\\u003c');
const CORE_SOURCE = 'var LAB = (' + labCore.toString() + ')();';
const PAGE_HEAD = '<!doctype html><meta charset="utf-8"><title>canvas frames</title><body><script>var CORE_SRC = ' + json(CORE_SOURCE) + ', REPORT_SRC = ' + json(reportScript.toString()) + ';</script><script>' + CORE_SOURCE
  + '</script><script>var reportScript = ' + reportScript.toString() + ';</script>';
let P1 = 0, P2 = 0;
const labPage = () => PAGE_HEAD + '<script>(' + labOrchestrator.toString() + ')(' + JSON.stringify({ p1: P1, p2: P2 }) + ')</script></body>';
const framePage = () => PAGE_HEAD + '<script>(' + frameMain.toString() + ')()</script></body>';
const handler = (request, response) => {
  const path = new URL(request.url, 'http://x').pathname;
  response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.setHeader('Cache-Control', 'no-store');
  if (path === '/lab.html') response.end(labPage()); else if (path === '/frame.html') response.end(framePage()); else { response.statusCode = 404; response.end('no'); }
};
const servers = [createServer(handler), createServer(handler)];
const listen = server => new Promise(done => server.listen(0, '127.0.0.1', done));
await listen(servers[0]); await listen(servers[1]); P1 = servers[0].address().port; P2 = servers[1].address().port;
const ARGUMENTS = ['--window-position=-10000,-10000', '--window-size=1000,700', '--no-first-run', '--no-proxy-server', '--host-resolver-rules=MAP alt.test 127.0.0.1', '--disable-popup-blocking'];
const launch = (label, withExtension) => chromium.launchPersistentContext(join(run, 'profile-' + label), { channel: 'chromium', headless: false, viewport: { width: 1000, height: 700 },
  args: [...ARGUMENTS, ...(withExtension ? ['--disable-extensions-except=' + extension, '--load-extension=' + extension] : [])] });
async function readLab(context) {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:' + P1 + '/lab.html', { waitUntil: 'load', timeout: 60000 });
  await until(() => page.evaluate(() => globalThis.__lab?.done === true), 'the lab pages finished', 300000);
  return page.evaluate(() => JSON.parse(JSON.stringify(globalThis.__lab)));
}
async function plainRun() {
  const context = await launch('native', false);
  try { return { version: context.browser().version(), lab: await readLab(context) }; } finally { await context.close(); }
}
async function extensionRun(spec) {
  const context = await launch(spec.label, true), info = { ...spec };
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'), base = new URL('.', worker.url()).href;
    let ui = await context.newPage(); await ui.goto(base + 'options.html#settings');
    info.userScripts = {}; ui = await enableChromeUserScripts(context, ui, new URL(base).host, info.userScripts);
    const send = message => ui.evaluate(message => chrome.runtime.sendMessage({ schemaVersion: 1, ...message }), message), state = () => send({ type: 'ui-api-config-get', tabId: null });
    await until(() => ui.evaluate(() => Boolean(document.querySelector('[data-management-shell]'))), 'Options shell');
    await send({ type: 'ui-data-consent-set', version: 1, accepted: true });
    await send({ type: 'ui-set-scope', scopeMode: spec.scope, ...(spec.scope === 'site' ? { host: '127.0.0.1' } : {}) });
    const current = await state();
    // The product's own generator, from the STAGED copy, so a source tree that changes meanwhile cannot disagree with the extension under test.
    const { generateConsistentDevice } = await import(pathToFileURL(join(extension, 'fingerprint-profiles.js')).href);
    const generated = generateConsistentDevice(current.configuration, { protection: spec.level, seed: SEED, deviceType: 'desktop', os: 'windows-11', browser: 'chrome' }, {});
    const set = await send({ type: 'ui-api-config-set', tabId: null, expectedRevision: current.revision, configuration: { ...generated.configuration, enabled: false, antidetectEnabled: true, sites: [] } });
    assert.equal(set.type, 'api-config-state', spec.label + ': the configuration was refused ' + JSON.stringify(set).slice(0, 200));
    await until(async () => (await state()).registration === 'ready', 'early registration ready', 30000).catch(() => {});
    const applied = await state();
    assert.equal(applied.registration, 'ready', spec.label + ': early registration must be ready (earlyAccess ' + applied.earlyAccess + ')');
    assert.equal(applied.configuration.antidetectEnabled, true);
    info.rows = Object.fromEntries(applied.configuration.apis.filter(row => row.mode === 'custom' || row.mode === 'on').map(row => [row.id, row.mode]));
    assert.equal(info.rows['canvas-readback'], 'custom', spec.label + ': the level must set the Canvas row');
    assert.equal(info.rows['webgl-readback'] === 'custom', READ_PIXELS_LEVELS.has(spec.level), spec.label + ': webgl-readback exists exactly at the levels that project readPixels');
    info.registration = await ui.evaluate(async () => {
      const pick = row => ({ id: row.id, matches: row.matches, allFrames: row.allFrames, world: row.world, runAt: row.runAt, matchOriginAsFallback: row.matchOriginAsFallback });
      const user = await chrome.userScripts.getScripts(), content = await chrome.scripting.getRegisteredContentScripts();
      return { userScripts: user.map(pick), contentScripts: content.map(pick) };
    });
    const globalProfile = info.registration.userScripts.find(row => row.id.endsWith('profile-v2-global'));
    assert.ok(globalProfile && globalProfile.allFrames === true && globalProfile.world === 'MAIN' && globalProfile.runAt === 'document_start', spec.label + ': the Custom profile is a MAIN, document_start, allFrames user script');
    assert.ok(info.registration.contentScripts.some(row => row.id.includes('fallback') && row.allFrames === true && row.world === 'MAIN' && row.matchOriginAsFallback === true), spec.label + ': the origin-fallback bridge for blank/srcdoc/blob realms is registered');
    if (spec.scope === 'site') assert.ok(globalProfile.matches.every(pattern => pattern.includes('127.0.0.1')), 'scope site registers the chosen host only: ' + globalProfile.matches.join(','));
    else assert.ok(globalProfile.matches.includes('http://*/*'), spec.label + ': all-sites registers http://*/*');
    info.version = context.browser().version();
    return { info, lab: await readLab(context) };
  } finally { await context.close(); }
}
// chrome.userScripts.register has no matchOriginAsFallback: the full bundle (with the private key) can only reach frames whose URL matches, so the
// opaque realms keep the denial. Recorded, not asserted (a Chrome that grows the option would let ADR-066 be revisited).
async function platformFact() {
  const context = await launch('fact', true);
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'), base = new URL('.', worker.url()).href;
    let ui = await context.newPage(); await ui.goto(base + 'options.html#settings'); ui = await enableChromeUserScripts(context, ui, new URL(base).host, {});
    return await ui.evaluate(async () => {
      try { await chrome.userScripts.register([{ id: 'probe-mof', matches: ['http://*/*'], js: [{ code: 'void 0' }], world: 'MAIN', matchOriginAsFallback: true }]); await chrome.userScripts.unregister({ ids: ['probe-mof'] }); return 'accepted'; }
      catch (error) { return String(error.message).slice(0, 160); }
    });
  } finally { await context.close(); }
}

async function main() {
  // ---- 1. native reference: the fixture is neutral (every realm reads the same in a plain Chromium)
  const plain = await plainRun(); evidence.version = plain.version;
  const native = plain.lab.results.top?.reads ?? {};
  assert.deepEqual(plain.lab.notes, {}, 'plain Chromium: the fixture could not read every realm');
  const neutral = [];
  for (const cell of CELLS) {
    const report = plain.lab.results[cell]; if (!report || report.error) { neutral.push(cell + ': no report'); continue; }
    for (const key of READS) { const value = report.reads[key]; if (value !== undefined && value !== native[key]) neutral.push(cell + ' ' + key + ': ' + value + ' vs top ' + native[key]); }
  }
  assert.deepEqual(neutral, [], 'plain Chromium reads differently in some realm: the fixture is not neutral');
  for (const key of READS) assert.ok(!/^(THROW|TIMEOUT|NULL|NOGL)/u.test(native[key]), 'plain Chromium: the top page could not read ' + key + ' (' + native[key] + ')');
  evidence.native = { top: native };
  check('plain Chromium: one drawing, 29 realm kinds, ' + READS.length + ' reads each, identical natively (the fixture is neutral)');
  // ---- 2. Custom at the product levels
  for (const spec of [{ label: 'balanced', level: 'balanced', scope: 'all-sites' }, { label: 'strict', level: 'strict', scope: 'all-sites' }, { label: 'balanced-site', level: 'balanced', scope: 'site' }]) {
    const { info, lab } = await extensionRun(spec), verdict = judge(spec, lab, native);
    evidence.runs[spec.label] = { ...info, matrix: verdict.matrix, cells: verdict.cells };
    console.log('  ' + spec.label + ' (keys: ' + READS.join(' ') + ')'); for (const cell of CELLS) console.log('    ' + cell.padEnd(16) + (verdict.matrix[cell] ?? 'none'));
    assert.deepEqual(verdict.problems, [], spec.label + ': the frame matrix disagrees with the oracle');
    check(spec.label + ' (' + spec.level + ', scope ' + spec.scope + '): every realm matches the oracle (P everywhere' + (spec.scope === 'site' ? ', the other host reads native' : ', sandboxed srcdoc and data: denied, the cross-host popup keyed by its own origin') + ') and the Custom canvas wrapper set is installed');
  }
  evidence.platform = { userScriptsMatchOriginAsFallback: await platformFact() };
  check('platform fact recorded: chrome.userScripts.register matchOriginAsFallback -> ' + evidence.platform.userScriptsMatchOriginAsFallback);
  evidence.result = 'PASS';
}

try {
  await main();
} catch (failure) {
  evidence.result = 'FAIL'; evidence.failure = failure?.message ?? String(failure); process.exitCode = 1; console.error(failure?.stack ?? String(failure));
} finally {
  evidence.finishedAt = new Date().toISOString();
  writeFileSync(join(run, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  for (const server of servers) { server.closeAllConnections?.(); await new Promise(done => server.close(done)); }
  console.log((evidence.result === 'PASS' ? 'PASS ' : 'FAIL ') + 'Canvas frames chrome: ' + evidence.checks.length + ' checks' + (evidence.result === 'PASS' && !keep ? '' : ', evidence ' + join(run, 'evidence.json')));
  if (evidence.result === 'PASS' && !keep) rmSync(run, { recursive: true, force: true });
}
