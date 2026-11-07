// ADR-066: packaged extension, trusted Options, owned first-inline Canvas fixtures.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { cpSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cpus, arch, platform } from 'node:os';
import { chromium } from 'playwright';
import { archiveProduction, FIREFOX_ID, productionManifest } from '../build-production.mjs';
import { PROTECT_CHROME_ONLY, PROTECT_FIREFOX_STUBS } from '../production/protect-files.mjs';
import { enableChromeUserScripts } from './api-custom-early-native.mjs';
import { canvasFixtureHtml, canvasBenchmarkHtml, canvasFlatHtml } from './canvas-readback-fixture.mjs';
const root = resolve(import.meta.dirname, '../..'), browser = process.argv.includes('--firefox') ? 'firefox' : 'chrome';
// --from-source: assemble the package for this browser from apps/production-extension into the run folder instead of copying dist/<browser> (which the lead builds).
const fromSource = process.argv.includes('--from-source');
// --output DIR: write the evidence file there instead of test-results/production-1.1.0/antidetect-profiles.
const outputIndex = process.argv.indexOf('--output'), outputDirectory = outputIndex >= 0 ? resolve(process.argv[outputIndex + 1]) : null;
const installedChrome = process.argv.includes('--chrome'), chromeChannel = installedChrome ? 'chrome' : 'chromium';
mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/canvas-readback-')), extension = join(run, 'extension');
// The file selection, origin rewrites, Firefox stubs/adapter wrapping and manifest of scripts/build-production.mjs (buildProduction), written to the run folder only.
function assemblePackage(target) {
  const source = join(root, 'apps/production-extension'), version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const adapter = readFileSync(join(source, 'browser-adapter.js'), 'utf8'), wrapped = ['background.js', 'bridge.js', 'api-custom-relay.js', 'api-custom-media-relay.js', 'popup.js', 'sidepanel.js', 'options.js', 'report.js'];
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source).sort()) {
    if (['manifest.json', 'browser-adapter.js', 'PROVENANCE.json'].includes(entry) || entry.endsWith('.md')) continue;
    if (browser === 'firefox' && PROTECT_CHROME_ONLY.includes(entry)) continue;
    if (browser === 'firefox' && Object.hasOwn(PROTECT_FIREFOX_STUBS, entry)) { cpSync(join(root, PROTECT_FIREFOX_STUBS[entry]), join(target, entry)); continue; }
    cpSync(join(source, entry), join(target, entry), { recursive: true });
    if (!entry.endsWith('.js')) continue;
    let code = readFileSync(join(source, entry), 'utf8');
    if (entry === 'background.js') {
      const previous = 'return "chrome-extension://" + runtimeId;';
      assert.ok(code.includes(previous) || code.includes('chrome.runtime.getURL("").replace'), 'missing background origin boundary');
      code = code.replace(previous, 'return chrome.runtime.getURL("").replace(/\\/$/, "");');
    }
    if (entry === 'bridge.js') code = code.replace('let own3 = "chrome-extension://" + id;', 'let own3 = chrome.runtime.getURL("").replace(/\\/$/, "");');
    if (browser === 'firefox' && wrapped.includes(entry)) {
      const context = entry === 'background.js' ? 'background' : ['bridge.js', 'api-custom-relay.js', 'api-custom-media-relay.js'].includes(entry) ? 'bridge' : 'ui';
      code = adapter + '\nvar chrome = createFirefoxAdapter(globalThis.browser, ' + JSON.stringify(context) + ');\n' + code;
    }
    writeFileSync(join(target, entry), code, 'utf8');
  }
  writeFileSync(join(target, 'manifest.json'), JSON.stringify(productionManifest(browser, version), null, 2) + '\n');
}
if (fromSource) assemblePackage(extension);
else cpSync(join(root, 'dist', browser), extension, { recursive: true });
const files = ['api-custom-canvas-runtime.js','api-custom-canvas-opaque.entry.js','api-custom-opaque.canvas-readback.js','canvas-profile-seed.js','api-custom-registration.js','api-configuration.js','api-custom-document-runtime.js','api-custom-inherit.main.js','api-configuration-controller.js','antidetect-controller.js','options.html','options.js','hook.early.js','hook.main.js'];
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const evidence = { packaging: fromSource ? 'assembled from apps/production-extension' : 'dist/' + browser, browser, channel: browser === 'firefox' ? 'installed-firefox' : chromeChannel, at: new Date().toISOString(), result: 'RUNNING', checks: [], device: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model }, hashes: Object.fromEntries(files.map(file => [file, sha(join(extension, file))])) };
evidence.sourceHashes = Object.fromEntries(files.map(file => [file, sha(join(root, 'apps/production-extension', file))]));
for (const file of files) {
  if (browser === 'firefox' && file === 'options.js') assert.ok(readFileSync(join(extension, file), 'utf8').endsWith(readFileSync(join(root, 'apps/production-extension', file), 'utf8')));
  else assert.equal(evidence.hashes[file], evidence.sourceHashes[file], 'stale packaged asset: ' + file);
}
evidence.sourceDistMatch = true;
const servers = [], pause = ms => new Promise(done => setTimeout(done, ms));
async function until(probe, label, timeout = 30000) { const end = Date.now() + timeout; while (Date.now() < end) { const value = await probe(); if (value) return value; await pause(50); } throw Error('timeout: ' + label); }
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPgiur5DwADUgHwDfE7DAAAAABJRU5ErkJggg==', 'base64');
async function server(image = false, imagePort) {
  const value = createServer((request, response) => { request.resume(); response.setHeader('Content-Type', image ? 'image/png' : 'text/html; charset=utf-8'); response.end(image ? png : request.url.startsWith('/benchmark') ? canvasBenchmarkHtml() : request.url.startsWith('/flat') ? canvasFlatHtml() : canvasFixtureHtml(imagePort)); });
  await new Promise(done => value.listen(0, '127.0.0.1', done)); servers.push(value); return value.address().port;
}
const imagePort = await server(true), origin = 'http://127.0.0.1:' + await server(false, imagePort), otherOrigin = 'http://127.0.0.1:' + await server(false, imagePort);
let opened, phase = 'startup';
const check = message => { evidence.checks.push(message); console.log('  ok ' + message); };
async function launch(extension, label) {
  const profile = join(run, label + '-profile'); mkdirSync(profile, { recursive: true });
  if (browser === 'chrome') {
    // Native system.display.getInfo crashes Chromium 153's headless process in a bare MV3 fixture.
    // A normal off-screen window exercises the real supported desktop API, without a foreground lab window.
    const context = await chromium.launchPersistentContext(profile, { channel: chromeChannel, headless: false, viewport: { width: 1180, height: 900 }, ...(installedChrome ? { ignoreDefaultArgs: ['--disable-extensions'] } : {}), args: ['--window-position=-10000,-10000', '--no-first-run', ...(installedChrome ? ['--enable-unsafe-extension-debugging'] : ['--disable-extensions-except=' + extension, '--load-extension=' + extension])] });
    // Official branded Chrome 137+ loads extensions over the debugging pipe;
    // --load-extension remains available in the bundled Chromium test build.
    if (installedChrome) { const cdp = await context.browser().newBrowserCDPSession(); await cdp.send('Extensions.loadUnpacked', { path: extension }); await cdp.detach(); evidence.extensionInstalledViaCDP = true; }
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const base = worker.url().slice(0, worker.url().indexOf('/', 'chrome-extension://'.length) + 1);
    let page = await context.newPage(); await page.goto(base + 'options.html#settings'); page = await enableChromeUserScripts(context, page, new URL(base).host, evidence);
    return { context, version: context.browser().version(), base, evaluate: (fn, value) => page.evaluate(fn, value), goto: url => page.goto(url), click: selector => page.locator(selector).click(), fill: (selector, value) => page.locator(selector).fill(value),
      screenshot: path => page.screenshot({ path, fullPage: true }), viewport: (width, height) => page.setViewportSize({ width, height }), media: options => page.emulateMedia(options), close: () => context.close() };
  }
  const driverPath = process.env.GECKODRIVER_BINARY ?? join(root, '.tmp/firefox/tools/geckodriver.exe'); assert.ok(existsSync(driverPath));
  let binary = process.env.FIREFOX_BINARY;
  if (!binary && process.platform === 'win32') binary = spawnSync('powershell.exe', ['-NoProfile', '-Command', "(Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\firefox.exe').'(default)'"], { encoding: 'utf8', windowsHide: true }).stdout.trim();
  assert.ok(binary, 'Installed Firefox binary is required');
  const uuid = randomUUID(), prefs = { 'extensions.webextensions.uuids': JSON.stringify({ [FIREFOX_ID]: uuid }), 'browser.shell.checkDefaultBrowser': false, 'browser.startup.homepage_override.mstone': 'ignore', 'browser.startup.page': 0, 'browser.newtabpage.enabled': false, 'datareporting.policy.dataSubmissionEnabled': false, 'toolkit.telemetry.enabled': false, 'app.update.auto': false, 'extensions.webextOptionalPermissionPrompts': false, 'network.proxy.type': 0, 'ui.systemUsesDarkTheme': 1, 'layout.css.prefers-color-scheme.content-override': 0 };
  writeFileSync(join(profile, 'user.js'), Object.entries(prefs).map(([key, value]) => 'user_pref(' + JSON.stringify(key) + ',' + JSON.stringify(value) + ');').join('\n'));
  const portServer = createServer(); await new Promise(done => portServer.listen(0, '127.0.0.1', done)); const port = portServer.address().port; await new Promise(done => portServer.close(done));
  const endpoint = 'http://127.0.0.1:' + port, log = createWriteStream(join(run, label + '-geckodriver.log'));
  const child = spawn(driverPath, ['--host', '127.0.0.1', '--port', String(port), '--profile-root', run, '--log', 'error'], { cwd: root, windowsHide: true }); child.stdout.pipe(log); child.stderr.pipe(log);
  async function command(path, body, method = 'POST') { const response = await fetch(endpoint + path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), signal: AbortSignal.timeout(30000) }); const value = (await response.json()).value; if (!response.ok || value?.error) throw Error(value?.error ?? 'WebDriver error'); return value; }
  await until(async () => { try { await command('/status', undefined, 'GET'); return true; } catch { return false; } }, 'geckodriver');
  let session;
  try {
    const result = await command('/session', { capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': { binary, args: ['-headless', '-no-remote', '-profile', profile] } } } }); session = result.sessionId;
    const wd = (path, body, method) => command('/session/' + session + path, body, method);
    const xpi = join(run, label + '.xpi'); writeFileSync(xpi, archiveProduction(extension)); assert.equal(await wd('/moz/addon/install', { path: xpi, temporary: true }), FIREFOX_ID);
    const element = async selector => (await wd('/element', { using: 'css selector', value: selector }))['element-6066-11e4-a52e-4f735466cecf'];
    return { version: result.capabilities.browserVersion, base: 'moz-extension://' + uuid + '/',
      evaluate: async (fn, value) => { const result = await wd('/execute/async', { script: 'const done=arguments[arguments.length-1];Promise.resolve((' + fn.toString() + ')(arguments[0])).then(value=>done({ok:true,value}),error=>done({ok:false,error:error?.code??error?.message??"error"}));', args: [value ?? null] }); if (!result.ok) throw Error(result.error); return result.value; },
      goto: url => wd('/url', { url }), click: async selector => { await until(async()=>{try{return await wd('/execute/sync',{script:'const e=document.querySelector(arguments[0]);return Boolean(e&&!e.disabled&&e.getClientRects().length);',args:[selector]});}catch{return false;}},'clickable '+selector);await wd('/execute/sync', {script:'document.querySelector(arguments[0]).scrollIntoView({block:"center"});',args:[selector]}); return wd('/element/' + await element(selector) + '/click', {}); }, fill: async (selector, text) => { const id = await element(selector); await wd('/element/' + id + '/clear', {}); await wd('/element/' + id + '/value', { text, value: [...text] }); },
      screenshot: async path => writeFileSync(path, Buffer.from(await wd('/screenshot', undefined, 'GET'), 'base64')), viewport: (width, height) => wd('/window/rect', { width, height }), media: async () => {},
      close: async () => { try { await command('/session/' + session, undefined, 'DELETE'); } finally { child.kill(); log.end(); } } };
  } catch (error) { if (session) try { await command('/session/' + session, undefined, 'DELETE'); } catch {} child.kill(); log.end(); throw error; }
}



const evaluate = (fn, value) => opened.evaluate(fn, value);
const send = message => evaluate(message => (globalThis.browser ?? globalThis.chrome).runtime.sendMessage({ schemaVersion: 1, ...message }), message);
const state = () => send({ type: 'ui-api-config-get', tabId: null });
async function ready() { await until(() => evaluate(() => document.querySelector('[data-antidetect-app]')?.getAttribute('aria-busy') === 'false' && Boolean(document.querySelector('[data-antidetect-master]'))), 'Antidetect ready'); }
async function probe(where = origin) {
  return evaluate(async where => {
    const api = globalThis.browser ?? globalThis.chrome, url = where + '/canvas?' + Date.now(), tab = await api.tabs.create({ url, active: false });
    try {
      for (let index = 0; index < 500; index++) {
        const current = await api.tabs.get(tab.id);
        if (current.status === 'complete' && current.url === url) {
          const results = await api.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: () => globalThis.__canvasResult ?? null });
          const record = results[0]?.result; if (record?.error) throw Error(record.error); if (record?.main && record?.blank && record?.srcdoc && record?.opaque) return record;
        }
        await new Promise(done => setTimeout(done, 40));
      }
      const summary = await api.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: () => ({ keys: Object.keys(globalThis.__canvasResult ?? {}), progress: globalThis.__canvasProgress, error: globalThis.__canvasResult?.error }) });
      throw Error('first-inline Canvas fixture timeout: ' + JSON.stringify(summary[0]?.result));
    } finally { await api.tabs.remove(tab.id); }
  }, where);
}
async function flat() {
  return evaluate(async origin => {
    const api = globalThis.browser ?? globalThis.chrome, url = origin + '/flat', tab = await api.tabs.create({ url, active: false });
    try {
      for (let index = 0; index < 600; index++) {
        const current = await api.tabs.get(tab.id);
        if (current.status === 'complete' && current.url === url) {
          const rows = await api.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: async () => typeof __canvasFlat === 'function' ? await __canvasFlat() : null });
          if (rows[0]?.result) return rows[0].result;
        }
        await new Promise(done => setTimeout(done, 40));
      }
      throw Error('Canvas flat export timeout');
    } finally { await api.tabs.remove(tab.id); }
  }, origin);
}
async function benchmark() {
  return evaluate(async origin => {
    const api = globalThis.browser ?? globalThis.chrome, url = origin + '/benchmark', tab = await api.tabs.create({ url, active: false });
    try {
      for (let index = 0; index < 400; index++) {
        const current = await api.tabs.get(tab.id);
        if (current.status === 'complete' && current.url === url) {
          const rows = await api.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: async () => typeof __canvasBenchmark === 'function' ? await __canvasBenchmark() : null });
          if (rows[0]?.result) return rows[0].result;
        }
        await new Promise(done => setTimeout(done, 40));
      }
      throw Error('Canvas benchmark timeout');
    } finally { await api.tabs.remove(tab.id); }
  }, origin);
}
function samePixels(row) {
  assert.deepEqual(row.repeat, row.read); assert.deepEqual(row.sourceAfter, row.read);
  assert.deepEqual(row.borrowed, row.read); opaquePixelsEqual(row.borrowedUrl, row.read, 'borrowed PNG URL');
  // Native Firefox PNG decode can round premultiplied translucent RGB
  // differently from direct ImageData. Compare opaque channels exactly here;
  // Custom's non-opaque PNG channels must separately equal its native baseline.
  opaquePixelsEqual(row.url, row.read, 'PNG URL'); opaquePixelsEqual(row.blob, row.read, 'PNG Blob');
  if (row.offRead) { opaquePixelsEqual(row.offRead, row.read, 'Offscreen ImageData'); opaquePixelsEqual(row.offBlob, row.read, 'Offscreen PNG'); opaquePixelsEqual(row.offSnapshot, row.offExpected, 'Offscreen snapshot'); }
  opaquePixelsEqual(row.snapshot, row.snapshotExpected, 'HTML snapshot'); assert.equal(row.callbackCount, 1);
  const crop = []; for (let y = 1; y < 3; y++) for (let x = 2; x < 5; x++) for (let c = 0; c < 4; c++) crop.push(row.read[(y * 16 + x) * 4 + c]); assert.deepEqual(row.crop, crop);
  assert.equal(row.receiver, 'TypeError'); assert.equal(row.errorIdentity, true); assert.equal(row.coordinateConversions, 1); assert.equal(row.mimeResult, true); assert.equal(row.mimeConversions, 1);
  assert.deepEqual(row.boundaries, Array(9).fill('TypeError')); assert.equal(row.empty, 'data:,'); assert.equal(row.zeroSize, 'IndexSizeError'); assert.equal(row.noNativeHandles, true);
  if (row.optionsOrder) { assert.deepEqual(row.optionsOrder, ['quality', 'type']); assert.equal(row.qualityConversions, 1); }
  if (row.taint) assert.deepEqual(row.taint, Array(3).fill('SecurityError'));
  if (row.p3) { assert.equal(row.p3.color, 'display-p3'); assert.deepEqual(row.p3.url, row.p3.read, 'P3 PNG must preserve P3 pixel projection'); }
  for (const gl of row.webgl ?? []) if (gl.outcome === 'allowed') assert.deepEqual(gl.encoded, gl.expected, gl.type + '/' + gl.color + ' Canvas PNG readback'); else assert.equal(gl.outcome, 'SecurityError');
}
function opaquePixelsEqual(actual, expected, label) { assert.equal(actual.length, expected.length, label); for (let index = 0; index < expected.length; index++) if (index % 4 === 3 || expected[(index & ~3) + 3] === 255) assert.equal(actual[index], expected[index], label + ' component ' + index); }
function borrowedMatrix(result) { assert.equal(result.borrowedMatrix.reads.length, 9); for (const row of result.borrowedMatrix.reads) assert.deepEqual(row, result.borrowedMatrix.reads[0], 'parent/child/sibling borrowed getImageData'); for (const url of result.borrowedMatrix.urls) assert.equal(url, result.borrowedMatrix.urls[0], 'borrowed Canvas PNG encoders'); }
// sparse-rgb-v1: an opaque pixel moves at most one channel by exactly one level; a translucent pixel (alpha 80 in the fixture) moves at most one
// channel to a byte this engine returns for its alpha (reach, measured in an uncovered Worker: the translucent rule of the runtime header);
// transparent pixels and alpha never move. Returns the moved pixel count; translucentMoved collects the translucent ones.
const translucentMoved = { count: 0, total: 0 };
function projectedSparse(before, after, reach) {
  assert.equal(after.length, before.length);
  let moved = 0;
  for (let pixel = 0; pixel < before.length; pixel += 4) {
    const deltas = [0, 1, 2].map(channel => Math.abs(after[pixel + channel] - before[pixel + channel])), alpha = before[pixel + 3];
    assert.equal(after[pixel + 3], alpha, 'alpha of pixel ' + pixel / 4);
    if (alpha === 0) assert.deepEqual(deltas, [0, 0, 0], 'transparent pixel ' + pixel / 4);
    else if (alpha !== 255) {
      assert.ok(deltas.filter(Boolean).length <= 1, 'translucent pixel ' + pixel / 4 + ' ' + deltas); translucentMoved.total++;
      for (let channel = 0; channel < 3; channel++) if (deltas[channel]) { assert.ok(reach.has(after[pixel + channel]), 'translucent pixel ' + pixel / 4 + ': ' + before[pixel + channel] + ' -> ' + after[pixel + channel] + ' is not a byte this engine returns for alpha ' + alpha); translucentMoved.count++; }
    } else { assert.ok(deltas.every(delta => delta <= 1) && deltas.filter(Boolean).length <= 1, 'opaque pixel ' + pixel / 4 + ' ' + deltas); }
    if (deltas.some(Boolean)) moved++;
  }
  assert.ok(moved >= 1, 'the keyed selection moved at least one opaque pixel'); return moved;
}
// sparse-rgb-v2 (ADR-112): an opaque pixel changes in at most one channel by exactly one level, only by flipping the lowest bit of a channel that is not 0, 1, 254 or
// 255; a translucent pixel is as for sparse-rgb-v1 (a byte this engine returns for its alpha); transparent pixels and alpha never move. Returns the moved pixel count.
function projectedParity(before, after, reach) {
  assert.equal(after.length, before.length);
  let moved = 0;
  for (let pixel = 0; pixel < before.length; pixel += 4) {
    const alpha = before[pixel + 3], changed = [0, 1, 2].filter(channel => after[pixel + channel] !== before[pixel + channel]);
    assert.equal(after[pixel + 3], alpha, 'alpha of pixel ' + pixel / 4);
    if (alpha === 0) assert.deepEqual(changed, [], 'transparent pixel ' + pixel / 4);
    else if (alpha !== 255) {
      assert.ok(changed.length <= 1, 'translucent pixel ' + pixel / 4); translucentMoved.total++;
      for (const channel of changed) { assert.ok(reach.has(after[pixel + channel]), 'translucent pixel ' + pixel / 4 + ': ' + before[pixel + channel] + ' -> ' + after[pixel + channel] + ' is not a byte this engine returns for alpha ' + alpha); translucentMoved.count++; }
    } else if (changed.length) {
      const channel = changed[0], value = before[pixel + channel];
      assert.equal(changed.length, 1, 'opaque pixel ' + pixel / 4); assert.equal(value ^ after[pixel + channel], 1, 'opaque pixel ' + pixel / 4 + ' flips the lowest bit'); assert.ok(value > 1 && value < 254, 'opaque pixel ' + pixel / 4 + ': a saturated channel (' + value + ') never moves');
    }
    if (changed.length) moved++;
  }
  return moved;
}
// sparse-rgb-v2 on the flat 2560x1440 canvas (more than 262,144 pixels, so not exempt): a keyed 1% are candidates and about half of them change the lowest bit.
function flatChecksParity(native, parity) {
  const total = native.width * native.height;
  assert.ok(parity.read.changed > total * 0.003 && parity.read.changed < total * 0.007, 'about half of the keyed 1% moved: ' + parity.read.changed);
  assert.equal(parity.read.multi, 0, 'one channel per pixel'); assert.equal(parity.read.big, 0, 'one level'); assert.equal(parity.read.alpha, 0, 'alpha untouched');
  for (const path of ['url', 'blob', 'off']) if (parity[path]) assert.equal(parity[path].hash, parity.read.hash, path + ' export decodes to what getImageData returns');
  assert.equal(parity.afterHash, parity.read.hash, 'reading after the exports gives the same pixels'); assert.equal(parity.rects.mismatches, 0, 'rectangles equal the whole read');
  const ratio = parity.urlBytes / native.urlBytes; assert.ok(ratio <= 4 && parity.blobBytes / native.blobBytes <= 4, 'sparse-rgb-v2 exports within 4x of native: ' + ratio);
  evidence.flatExportV2 = { width: native.width, height: native.height, nativeBytes: native.urlBytes, v2Bytes: parity.urlBytes, ratio: +ratio.toFixed(2), moved: parity.read.changed };
  console.log('  flat ' + native.width + 'x' + native.height + ' PNG: native ' + native.urlBytes + ' B, sparse-rgb-v2 ' + parity.urlBytes + ' B (' + ratio.toFixed(2) + 'x)');
  check('flat ' + native.width + 'x' + native.height + ' export: sparse-rgb-v2 ' + ratio.toFixed(2) + 'x the unprojected PNG, every export path decodes to the getImageData pixels, ' + parity.read.changed + ' pixels moved by the lowest bit of one channel');
}
// The translucent components of a decoded export are bytes this engine returns, and in Skia the PNG round trip reads what getImageData read.
function translucentExport(before, after, reach, label, expectedRead) {
  assert.equal(after.length, before.length, label);
  for (let index = 0; index < before.length; index++) { const alpha = before[(index & ~3) + 3]; if (index % 4 === 3 || alpha === 0 || alpha === 255) continue; assert.ok(reach.has(after[index]), label + ' translucent component ' + index + ' = ' + after[index]); if (expectedRead) assert.equal(after[index], expectedRead[index], label + ' translucent component ' + index + ' differs from getImageData'); }
}
// Flat 2560x1440 export (ADR-104 addendum 3): the sparse projection stays within 4x of the unprojected PNG (3x is the target), every export path
// decodes to exactly what getImageData returns, the structure is the specified one, and stable-rgb-v1 is the layout that explodes.
function flatChecks(native, sparse, stable) {
  const total = native.width * native.height;
  assert.equal(native.read.changed, 0); assert.equal(native.url.hash, native.read.hash, 'native PNG decodes to the native read');
  assert.ok(Math.abs(sparse.read.changed - total / 100) <= 8, 'about one pixel in a hundred moved: ' + sparse.read.changed);
  assert.equal(sparse.read.multi, 0, 'one channel per pixel'); assert.equal(sparse.read.big, 0, 'one level'); assert.equal(sparse.read.alpha, 0, 'alpha untouched');
  for (const path of ['url', 'blob', 'off']) if (sparse[path]) assert.equal(sparse[path].hash, sparse.read.hash, path + ' export decodes to what getImageData returns');
  assert.equal(sparse.afterHash, sparse.read.hash, 'reading after the exports gives the same pixels'); assert.equal(sparse.rects.mismatches, 0, 'rectangles equal the whole read');
  const ratio = sparse.urlBytes / native.urlBytes, blobRatio = sparse.blobBytes / native.blobBytes, offRatio = sparse.offBytes ? sparse.offBytes / native.offBytes : 0;
  assert.ok(ratio <= 4 && blobRatio <= 4 && offRatio <= 4, 'sparse exports within 4x of native: ' + [ratio, blobRatio, offRatio]);
  assert.ok(stable.urlBytes > sparse.urlBytes * 10, 'stable-rgb-v1 explodes: ' + stable.urlBytes + ' vs ' + sparse.urlBytes);
  evidence.flatExport = { width: native.width, height: native.height, nativeBytes: native.urlBytes, sparseBytes: sparse.urlBytes, stableBytes: stable.urlBytes, sparseRatio: +ratio.toFixed(2), stableRatio: +(stable.urlBytes / native.urlBytes).toFixed(1),
    toBlob: { native: native.blobBytes, sparse: sparse.blobBytes, stable: stable.blobBytes }, convertToBlob: { native: native.offBytes, sparse: sparse.offBytes, stable: stable.offBytes },
    moved: sparse.read.changed, timingsMs: { native: native.time, sparse: sparse.time, stable: stable.time } };
  console.log('  flat ' + native.width + 'x' + native.height + ' PNG: native ' + native.urlBytes + ' B, sparse ' + sparse.urlBytes + ' B (' + ratio.toFixed(2) + 'x), stable ' + stable.urlBytes + ' B (' + (stable.urlBytes / native.urlBytes).toFixed(1) + 'x)');
  check('flat ' + native.width + 'x' + native.height + ' export: sparse-rgb-v1 ' + ratio.toFixed(2) + 'x the unprojected PNG (' + (ratio <= 3 ? 'within' : 'ABOVE') + ' the 3x target, hard bound 4x), every export path decodes to the getImageData pixels, ' + sparse.read.changed + ' pixels moved by one level of one channel');
}
// stable-rgb-v1: every opaque component moves by exactly one; every translucent component moves to a byte the engine returns for its alpha (all
// three channels of a translucent pixel, where a neighbouring state has a byte every arithmetic agrees on); alpha and transparent pixels never.
function projected(before, after, reach) {
  assert.equal(after.length, before.length);
  let changed = 0, translucent = 0, translucentChanged = 0;
  for (let index = 0; index < before.length; index++) {
    const alpha = before[(index & ~3) + 3], delta = Math.abs(after[index] - before[index]);
    if (index % 4 === 3 || alpha === 0) { assert.equal(delta, 0, 'RGBA component ' + index); continue; }
    if (alpha === 255) { assert.equal(delta, 1, 'RGBA component ' + index); changed++; continue; }
    translucent++; if (delta) { assert.ok(reach.has(after[index]), 'translucent component ' + index + ' -> ' + after[index]); translucentChanged++; }
  }
  assert.ok(changed > 100); assert.ok(translucentChanged > translucent * 0.6, 'translucent components moved: ' + translucentChanged + ' of ' + translucent); return changed;
}
async function configure(mode, antidetectEnabled = true, algorithm = null) {
  const current = await state(), configuration = { ...current.configuration, enabled: false, antidetectEnabled, preset: 'custom', sites: [], apis: current.configuration.apis.map(row => ({ ...row, mode: row.id === 'canvas-readback' ? mode : 'bypass', selected: row.id === 'canvas-readback' ? (algorithm ? row.presets.find(preset => preset.value.value.algorithm === algorithm).value : row.presets[0].value) : { kind: 'unset' } })) };
  const result = await send({ type: 'ui-api-config-set', tabId: null, expectedRevision: current.revision, configuration }); assert.equal(result.type, 'api-config-state', JSON.stringify(result));
  assert.equal(result.configuration.enabled, false, 'Canvas Custom is independent of API Guard'); assert.equal(result.configuration.antidetectEnabled, antidetectEnabled); return result;
}
try {
  opened = await launch(extension, 'native'); evidence.version = opened.version;
  await opened.goto(opened.base + 'options.html#settings'); await until(() => evaluate(() => Boolean(document.querySelector('[data-management-shell]'))), 'management mount');
  await send({ type: 'ui-data-consent-set', version: 1, accepted: true }); await send({ type: 'ui-set-scope', scopeMode: 'all-sites' });
  await opened.goto(opened.base + 'options.html?canvas-native=1#antidetect'); await ready();
  if (browser === 'firefox') { await opened.click('[data-antidetect-grant-early]'); await ready(); assert.equal((await state()).earlyAccess, 'ready'); }
  await configure('bypass', false);
  phase = 'native baseline'; const baseline = await probe();
  borrowedMatrix(baseline);
  for (const kind of ['main', 'blank', 'srcdoc']) { samePixels(baseline[kind]); opaquePixelsEqual(baseline[kind].read, baseline[kind].nativePixels, 'native source backing bitmap'); assert.equal(baseline[kind].objectCoordinate, 'allowed'); }
  assert.ok(baseline.opaque.every(value => value === 'allowed'));
  evidence.benchmark = { native: await benchmark() };
  check('OFF baseline exercises native first-inline ImageData, PNG URL/Blob, accessible OffscreenCanvas, crop, callbacks, coercion and owned taint');
  const reach80 = new Set(baseline.main.reach80); assert.ok(reach80.size > 10 && reach80.size <= 81, 'bytes returned for alpha 80: ' + reach80.size);
  phase = 'Custom projection'; const active = await configure('custom'); assert.equal(active.registration, 'ready'); const spoof = await probe();
  const preset = active.configuration.apis.find(row => row.id === 'canvas-readback').selected.value.algorithm; evidence.defaultAlgorithm = preset;
  const parity = preset === 'sparse-rgb-v2', sparse = preset === 'sparse-rgb-v1' || parity, projectedBy = (before, after) => (parity ? projectedParity : sparse ? projectedSparse : projected)(before, after, reach80);
  borrowedMatrix(spoof); evidence.borrowedDirections = 9;
  let changed = 0;
  for (const kind of ['main', 'blank', 'srcdoc']) {
    const row = spoof[kind]; samePixels(row); changed += projectedBy(baseline[kind].read, row.read); assert.deepEqual(row.nativePixels, baseline[kind].nativePixels, 'source backing bitmap unchanged');
    if (row.offRead) projectedBy(baseline[kind].offRead, row.offRead);
    for (const path of ['url', 'borrowedUrl', 'blob', 'offBlob', 'snapshot', 'offSnapshot']) if (row[path]) translucentExport(baseline[kind][path], row[path], reach80, kind + ' ' + path, browser === 'chrome' && path === 'url' ? row.read : null);
    assert.equal(row.nativeFunctionString, baseline[kind].nativeFunctionString); assert.equal(row.objectCoordinate, 'SecurityError'); if (row.optionsOrder) assert.equal(row.objectQuality, 'SecurityError');
    if (row.float16) { assert.deepEqual(row.float16, ['SecurityError', 'SecurityError']); assert.equal(row.float16Blob, true); }
    for (const gl of row.webgl) assert.equal(gl.outcome, gl.copyColorSupported ? 'allowed' : 'SecurityError', gl.type + '/' + gl.color + ' must retain colorSpace or fail closed');
  }
  evidence.opaquePixelsChanged = changed; evidence.imageWidth = 16; evidence.imageHeight = 8; evidence.translucent = { channelsMoved: translucentMoved.count, pixels: translucentMoved.total / 3, reachable80: reach80.size };
  if (sparse) assert.ok(translucentMoved.count >= translucentMoved.total * (parity ? 0.3 : 0.5), 'translucent pixels carry marks: ' + translucentMoved.count + ' of ' + translucentMoved.total);
  assert.equal(preset, 'sparse-rgb-v2', 'the first preset, and so the default of a switched-on row, is sparse-rgb-v2 (ADR-112)');
  evidence.nativeSurfaces = { offscreen: Boolean(spoof.main.offRead), displayP3: Boolean(spoof.main.p3), float16: Boolean(spoof.main.float16), webgl: spoof.main.webgl.map(row => ({ type: row.type, color: row.color, preserveDrawingBuffer: row.preserveDrawingBuffer, copyColorSupported: row.copyColorSupported, outcome: row.outcome })) };
  evidence.benchmark.custom = await benchmark();
  assert.deepEqual(spoof.main.read, spoof.blank.read); assert.deepEqual(spoof.main.read, spoof.srcdoc.read); assert.ok(spoof.opaque.every(value => value === 'SecurityError'));
  check(parity ? 'Custom (default sparse-rgb-v2) sets the lowest bit of one unsaturated channel of fully opaque pixels (never 0, 1, 254 or 255) and moves translucent pixels by one stored state to a byte the engine returns (' + translucentMoved.count + ' marks); alpha/transparent pixels/source bitmap remain unchanged and PNG paths agree'
    : sparse ? 'Custom (sparse-rgb-v1) moves fully opaque pixels (all of them up to 512x512) by one level of one channel and translucent pixels by one stored state to a byte the engine returns (' + translucentMoved.count + ' marks); alpha/transparent pixels/source bitmap remain unchanged and PNG paths agree'
    : 'Custom changes fully opaque RGB components by exactly one and translucent ones to bytes the engine returns; alpha/transparent pixels/source bitmap remain unchanged and PNG paths agree');

  // The saved values of the earlier rounds keep working through the same package, and the flat export is measured for all three projections.
  phase = 'sparse-rgb-v1 stays available'; const settledTranslucent = { ...translucentMoved }; await configure('custom', true, 'sparse-rgb-v1'); const v1 = await probe();
  for (const kind of ['main', 'blank', 'srcdoc']) { const row = v1[kind]; samePixels(row); projectedSparse(baseline[kind].read, row.read, reach80); assert.deepEqual(row.nativePixels, baseline[kind].nativePixels, 'source backing bitmap unchanged'); }
  translucentMoved.count = settledTranslucent.count; translucentMoved.total = settledTranslucent.total;
  check('sparse-rgb-v1 (saved value of earlier rounds) still moves every opaque pixel of the small image by one level of one channel in the same package');
  phase = 'stable-rgb-v1 stays available'; await configure('custom', true, 'stable-rgb-v1'); const older = await probe();
  for (const kind of ['main', 'blank', 'srcdoc']) { const row = older[kind]; samePixels(row); projected(baseline[kind].read, row.read, reach80); assert.deepEqual(row.nativePixels, baseline[kind].nativePixels, 'source backing bitmap unchanged'); }
  check('stable-rgb-v1 (older saved value) still moves every opaque component by exactly one in the same package, and translucent components to bytes the engine returns');
  phase = 'flat export size';
  await configure('bypass', false); const flatNative = await flat();
  await configure('custom', true, 'sparse-rgb-v1'); const flatSparse = await flat();
  await configure('custom', true, 'stable-rgb-v1'); const flatStable = await flat();
  flatChecks(flatNative, flatSparse, flatStable);
  await configure('custom', true, 'sparse-rgb-v2'); const flatV2 = await flat(); flatChecksParity(flatNative, flatV2);
  await configure('custom'); assert.deepEqual((await probe()).main.read, spoof.main.read, 'the default profile reads the same pixels again');
  check('fresh same-origin about:blank and srcdoc inherit the same projection before first reads; forged markers cannot bypass opaque readback denial');
  assert.deepEqual((await probe()).main.read, spoof.main.read); assert.notDeepEqual((await probe(otherOrigin)).main.read, spoof.main.read);
  check('same-origin fresh tabs remain stable while a different owned origin receives an independent keyed projection');
  phase = 'session secret lifetime';
  const secret = await evaluate(async () => { const api = globalThis.browser ?? globalThis.chrome; return (await api.storage.local.get('profile-noise-root:v1'))['profile-noise-root:v1']; }); assert.match(secret, /^[a-f0-9]{64}$/);
  // ADR-106: the noise root lives under its own key in storage.local; it is not part of the portable configuration or of any other stored value.
  const local = await evaluate(async () => (globalThis.browser ?? globalThis.chrome).storage.local.get(null)); delete local['profile-noise-root:v1'];
  assert.equal(JSON.stringify(local).includes(secret), false); assert.equal(JSON.stringify(await state()).includes(secret), false);
  if (browser === 'chrome' && opened.context) {
    const cdp = await opened.context.browser().newBrowserCDPSession(), targets = await cdp.send('Target.getTargets'), target = targets.targetInfos.find(row => row.type === 'service_worker' && row.url.startsWith(opened.base)); assert.ok(target); assert.equal((await cdp.send('Target.closeTarget', { targetId: target.targetId })).success, true); await pause(100); await state();
    const next = await evaluate(async () => { const api = globalThis.browser ?? globalThis.chrome; return (await api.storage.local.get('profile-noise-root:v1'))['profile-noise-root:v1']; }); assert.equal(next, secret); assert.deepEqual((await probe()).main.read, spoof.main.read); await cdp.detach(); evidence.swRestart = true;
  }
  check('Canvas noise root is a private storage.local value (ADR-106) outside the portable configuration; Chrome service worker restart preserves the projection where applicable');
  phase = 'mode changes';
  for (const [mode, antidetectEnabled] of [['off', true], ['bypass', true], ['custom', false]]) { await configure(mode, antidetectEnabled); const native = await probe(); assert.deepEqual(native.main.read, baseline.main.read); assert.ok(native.opaque.every(value => value === 'allowed')); }
  check('Allow, Bypass and master OFF restore native results on new documents without applying a retained Custom selection');
  evidence.result = 'PASS'; console.log('Canvas readback ' + browser + ': ' + evidence.checks.length + ' checks PASS');
} catch (error) { evidence.result = 'FAIL'; evidence.phase = phase; evidence.error = [error.name + ': ' + String(error.message).split('\n')[0], ...String(error.stack).split('\n').filter(line => /^\s+at /.test(line))].join('\n'); throw error; }
finally {
  writeFileSync(join(run, 'result.json'), JSON.stringify(evidence, null, 2)); const destination = outputDirectory ?? join(root, 'test-results/production-1.1.0/antidetect-profiles'); mkdirSync(destination, { recursive: true }); writeFileSync(join(destination, 'canvas-' + browser + (installedChrome ? '-installed' : '') + '.json'), JSON.stringify(evidence, null, 2));
  await opened?.close(); for (const value of servers) await new Promise(done => value.close(done));
}
