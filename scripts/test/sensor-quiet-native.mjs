// ADR-113 end to end in a real browser: the opt-in setting "do not run the observation sensors while Antidetect is on". The extension is assembled
// from apps/production-extension (no build needed); the pages are an owned loopback fixture; nothing leaves the machine.
//
//   node scripts/test/sensor-quiet-native.mjs [--firefox | --installed-chrome]
//   (--installed-chrome loads the same extension into the installed branded Chrome over CDP, like canvas-readback-native.mjs --chrome; manual only)
//
// What a page can see is measured, not assumed. With the observation sensors registered a page finds the realm marker
// Symbol(detect.expert/sensor/v1), function objects whose text is not "[native code]" (canvas, WebGL, Navigator, Screen, Date, Performance, ...), and
// extension frames (hook.early.js) in the stack of an error thrown through a wrapped call. With the setting ON and Antidetect ON none of that remains
// in pages opened afterwards, while Antidetect's own Custom canvas row still changes the pixels; with the setting OFF everything is as before.
// Antidetect's own wrappers (Symbol(detect.expert/api-custom/...), its document runtime) are NOT claimed to be unnoticeable: they are listed, not hidden.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { enableChromeUserScripts } from './api-custom-early-native.mjs';
import { launchOwnedManagement, until, pause } from './management-browser-fixture.mjs';
import { ROOT, stageExtension } from './native-evidence.mjs';

const browser = process.argv.includes('--firefox') ? 'firefox' : 'chrome', installed = process.argv.includes('--installed-chrome') && browser === 'chrome';
mkdirSync(join(ROOT, '.tmp'), { recursive: true });
const run = mkdtempSync(join(ROOT, '.tmp/sensor-quiet-')), extension = join(run, 'extension'), evidence = {}, sockets = new Set();
await stageExtension({ browser, target: extension, from: 'source' });

const server = createServer((request, response) => {
  request.resume();
  if (new URL(request.url, 'http://fixture').pathname === '/page') { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); response.end('<!doctype html><title>sensor quiet</title><body><canvas id="c" width="64" height="32"></canvas></body>'); return; }
  response.writeHead(404); response.end();
});
server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
const origin = 'http://127.0.0.1:' + await new Promise(done => server.listen(0, '127.0.0.1', () => done(server.address().port)));

// ---- what a page can see (self-contained: it is also sent to the page as text) ----------------------------------------------------------
function pageProbe() {
  const FTS = Function.prototype.toString;
  const isNative = fn => { try { return /\{\s*\[native code\]\s*\}/.test(FTS.call(fn)); } catch { return false; } };
  const TRACE = /(?:chrome|moz)-extension:|hook\.(?:early|main)\.js|bridge\.js/;
  const TARGETS = [['HTMLCanvasElement', 'getContext'], ['HTMLCanvasElement', 'toDataURL'], ['HTMLCanvasElement', 'toBlob'], ['CanvasRenderingContext2D', 'getImageData'],
    ['CanvasRenderingContext2D', 'measureText'], ['CanvasRenderingContext2D', 'fillText'], ['CanvasRenderingContext2D', 'drawImage'], ['CanvasRenderingContext2D', 'fillRect'],
    ['WebGLRenderingContext', 'getParameter'], ['WebGLRenderingContext', 'readPixels'], ['WebGLRenderingContext', 'getExtension'], ['Navigator', 'userAgent', 'get'],
    ['Navigator', 'hardwareConcurrency', 'get'], ['Navigator', 'platform', 'get'], ['Screen', 'width', 'get'], ['Date', 'getTimezoneOffset'], ['Performance', 'now'],
    ['EventTarget', 'addEventListener'], ['Element', 'getBoundingClientRect'], ['FontFaceSet', 'check'], ['Permissions', 'query'], ['Storage', 'getItem']];
  const THROWS = { getImageData: win => win.CanvasRenderingContext2D.prototype.getImageData.call(null, 0, 0, 1, 1), toDataURL: win => win.HTMLCanvasElement.prototype.toDataURL.call(null),
    getContext: win => win.HTMLCanvasElement.prototype.getContext.call(null, '2d'), drawImage: win => win.CanvasRenderingContext2D.prototype.drawImage.call(null, null, 0, 0),
    measureText: win => win.CanvasRenderingContext2D.prototype.measureText.call(null, 'x'), fillRect: win => win.CanvasRenderingContext2D.prototype.fillRect.call(null, 0, 0, 1, 1) };
  function facts(win) {
    const out = { sensorMarker: false, nativeText: {}, extensionFrames: {} };
    try { out.sensorMarker = Object.getOwnPropertySymbols(win).some(symbol => String(symbol) === 'Symbol(detect.expert/sensor/v1)'); } catch { /* unreadable */ }
    for (const [ownerName, key, part = 'value'] of TARGETS) {
      const label = ownerName + '.' + key + (part === 'get' ? '(get)' : '');
      try {
        const owner = win[ownerName]?.prototype, descriptor = owner ? Object.getOwnPropertyDescriptor(owner, key) : undefined, fn = descriptor?.[part];
        out.nativeText[label] = typeof fn === 'function' ? isNative(fn) : null;
      } catch { out.nativeText[label] = null; }
    }
    for (const [label, call] of Object.entries(THROWS)) {
      try { call(win); out.extensionFrames[label] = null; } catch (error) { out.extensionFrames[label] = TRACE.test(String(error && error.stack || '')); }
    }
    return out;
  }
  const result = { top: facts(window), frame: null };
  const canvas = document.getElementById('c'), context = canvas.getContext('2d');
  context.fillStyle = '#c0ffee'; context.fillRect(0, 0, 64, 32); context.fillStyle = '#123456'; context.fillText('x', 3, 12);
  const data = context.getImageData(0, 0, 64, 32).data; let hash = 2166136261 >>> 0;
  for (let index = 0; index < data.length; index++) { hash ^= data[index]; hash = Math.imul(hash, 16777619) >>> 0; }
  result.pixelHash = hash.toString(16); result.dataUrlLength = canvas.toDataURL().length;
  const frame = document.createElement('iframe'); document.body.appendChild(frame);
  try { result.frame = facts(frame.contentWindow); } finally { frame.remove(); }
  return result;
}

// geckodriver scripts run in a sandbox that sees native page objects through Xray wrappers: the page world is reached with a script element.
let runs = 0;
const pageWorld = driver => ({ async evaluate(fn) {
  const attribute = 'data-quiet-' + ++runs;
  const source = '(async () => { try { const value = await (' + fn.toString() + ')(); document.documentElement.setAttribute(' + JSON.stringify(attribute) + ', JSON.stringify({ ok: true, value })); }'
    + ' catch (error) { document.documentElement.setAttribute(' + JSON.stringify(attribute) + ', JSON.stringify({ ok: false, error: String(error && error.stack || error) })); } })()';
  await driver.evaluate(text => { const script = document.createElement('script'); script.textContent = text; document.documentElement.append(script); script.remove(); }, source);
  const raw = await until(() => driver.evaluate(name => document.documentElement.getAttribute(name), attribute), 'page-world result ' + attribute, 60000);
  const result = JSON.parse(raw); if (!result.ok) throw new Error(result.error); return result.value;
} });

// ---- the browser -------------------------------------------------------------------------------------------------------------------------
let opened = null, context = null, ui = null, base, phase = 'startup';
async function launch() {
  if (browser === 'firefox') { opened = await launchOwnedManagement({ root: ROOT, run, extension, browser, evidence }); await opened.viewport(1000, 560); base = opened.base; return; }
  context = await chromium.launchPersistentContext(join(run, 'chrome-profile'), { channel: installed ? 'chrome' : 'chromium', headless: false, viewport: null, ...(installed ? { ignoreDefaultArgs: ['--disable-extensions'] } : {}),
    args: ['--window-position=-10000,-10000', '--window-size=1000,640', '--no-first-run', '--no-proxy-server', ...(installed ? ['--enable-unsafe-extension-debugging'] : ['--disable-extensions-except=' + extension, '--load-extension=' + extension])] });
  if (installed) { const cdp = await context.browser().newBrowserCDPSession(); await cdp.send('Extensions.loadUnpacked', { path: extension }); await cdp.detach(); }
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  base = new URL('.', worker.url()).href;
  ui = await context.newPage(); await ui.goto(base + 'options.html#settings');
  ui = await enableChromeUserScripts(context, ui, new URL(base).host, evidence);
}
async function onOptions(hash = 'settings') {
  if (browser === 'chrome') return;
  // Navigate only when this is not already the wanted Options page: two navigations in one millisecond would hit a document that is being replaced.
  const here = String(await opened.evaluate(() => location.href).catch(() => ''));
  if (!here.startsWith(base + 'options.html') || !here.endsWith('#' + hash)) { await opened.goto(base + 'options.html?quiet=' + Date.now() + '#' + hash); await pause(50); }
  await until(() => opened.evaluate(() => document.readyState === 'complete' && Boolean((globalThis.browser ?? globalThis.chrome)?.runtime?.id)), 'Options page');
}
const evaluate = (fn, value) => browser === 'chrome' ? ui.evaluate(fn, value) : opened.evaluate(fn, value);
const sendHere = message => evaluate(message => (globalThis.browser ?? globalThis.chrome).runtime.sendMessage({ schemaVersion: 1, ...message }), message);
const send = async message => { await onOptions(); return sendHere(message); };
const configuration = () => send({ type: 'ui-api-config-get', tabId: null });
async function applyAntidetect(master) {
  const current = await configuration();
  const next = { ...current.configuration, enabled: false, antidetectEnabled: master, preset: 'custom', sites: [],
    apis: current.configuration.apis.map(row => ({ ...row, mode: row.id === 'canvas-readback' ? 'custom' : 'bypass', selected: row.id === 'canvas-readback' ? row.presets[0].value : { kind: 'unset' } })) };
  const saved = await send({ type: 'ui-api-config-set', tabId: null, expectedRevision: current.revision, configuration: next });
  assert.equal(saved.type, 'api-config-state', phase + ': ' + JSON.stringify(saved).slice(0, 300));
  assert.equal(saved.configuration.antidetectEnabled, master);
  if (master) assert.equal(saved.registration, 'ready', phase + ': Antidetect registration ' + saved.registration);
  return saved;
}
const quiet = enabled => send({ type: 'ui-sensor-quiet-set', enabled });
// Only the two observation scripts: Antidetect's own Custom scripts are registered through other ids (and userScripts).
const registered = async () => { await onOptions(); return evaluate(async () => (await (globalThis.browser ?? globalThis.chrome).scripting.getRegisteredContentScripts({ ids: ['detector-isolated-v1', 'detector-main-v1'] })).map(script => script.id).sort()); };

// One fresh page, probed in its own world. Returns the facts and, in Chrome, what the Detector says about that tab.
async function probe(label, { report = false } = {}) {
  let page = null;
  try {
    const url = origin + '/page?run=' + label;
    const facts = browser === 'chrome' ? await (async () => { page = await context.newPage(); await page.goto(url); await page.waitForLoadState('load'); return page.evaluate(pageProbe); })()
      : await (async () => { await opened.goto(url); await until(() => opened.evaluate(() => document.readyState === 'complete'), 'page ' + label); return pageWorld(opened).evaluate(pageProbe); })();
    if (!report || browser !== 'chrome') return { facts };
    // The service worker needs a moment to see the navigation; the report is polled, never guessed.
    const tabId = await ui.evaluate(async needle => (await chrome.tabs.query({})).find(tab => (tab.url ?? '').includes(needle))?.id ?? null, '/page?run=' + label);
    assert.ok(Number.isInteger(tabId), 'the probe tab is visible to the extension');
    let reply = null;
    await until(async () => { reply = await send({ type: 'ui-get-report', tabId }); return reply?.type === 'report' && reply.report !== null; }, 'report of ' + label, 20000);
    return { facts, tabId, report: reply.report };
  } finally { if (page) await page.close(); }
}
const nativeCount = side => Object.values(side.nativeText).filter(value => value === true).length;
const wrappedCount = side => Object.values(side.nativeText).filter(value => value === false).length;
const known = side => Object.values(side.nativeText).filter(value => value !== null).length;
const traces = side => Object.entries(side.extensionFrames).filter(([, seen]) => seen === true).map(([label]) => label);

function assertSensorsVisible(label, facts) {
  for (const [where, side] of [['top', facts.top], ['child frame', facts.frame]]) {
    assert.equal(side.sensorMarker, true, label + ' ' + where + ': the realm marker Symbol(detect.expert/sensor/v1) is there');
    assert.ok(wrappedCount(side) >= 8, label + ' ' + where + ': ' + wrappedCount(side) + ' of ' + known(side) + ' probed functions are not native text');
    // Firefox hides the frames of extension code from page scripts (cross-principal stack filtering): there the stack check can only prove absence.
    if (browser === 'chrome') assert.ok(traces(side).length >= 1, label + ' ' + where + ': an extension frame shows in the stack of a wrapped call');
  }
}
function assertNoSensorTrace(label, facts) {
  for (const [where, side] of [['top', facts.top], ['child frame', facts.frame]]) {
    assert.equal(side.sensorMarker, false, label + ' ' + where + ': no Symbol(detect.expert/sensor/v1)');
    assert.equal(wrappedCount(side), 0, label + ' ' + where + ': every probed function reads native, not ' + JSON.stringify(Object.entries(side.nativeText).filter(([, value]) => value === false)));
    assert.ok(nativeCount(side) >= 12, label + ' ' + where + ': the probe really read ' + nativeCount(side) + ' native functions');
    assert.deepEqual(traces(side), [], label + ' ' + where + ': no extension frame in any probed stack');
  }
}

let passed = false;
try {
  await launch();
  phase = 'setup'; await send({ type: 'ui-data-consent-set', version: 1, accepted: true });
  assert.equal((await send({ type: 'ui-set-scope', scopeMode: 'all-sites' })).type, 'scope');
  if (browser === 'firefox') {
    await onOptions('antidetect');
    await until(() => opened.evaluate(() => document.querySelector('[data-antidetect-app]')?.getAttribute('aria-busy') === 'false'), 'Antidetect ready');
    const early = () => sendHere({ type: 'ui-api-config-get', tabId: null }).then(state => state.earlyAccess);
    if (await early() !== 'ready') await opened.click('[data-antidetect-grant-early]');
    await until(async () => await early() === 'ready', 'Firefox early access');
  }
  assert.equal((await configuration()).earlyAccess, 'ready');
  assert.deepEqual(await registered(), ['detector-isolated-v1', 'detector-main-v1'], 'the sensors are registered by default');
  const initial = await send({ type: 'ui-sensor-quiet-get' });
  assert.deepEqual(initial, { schemaVersion: 1, type: 'sensor-quiet-state', setting: false, antidetect: false, scoped: true, effective: false, healthy: true });
  console.log('  ok setup (' + browser + '): consent, all-sites scope, early registration ready, setting OFF by default');

  phase = 'plain page (observation scope off)';
  assert.equal((await send({ type: 'ui-set-scope', scopeMode: 'off' })).type, 'scope');
  const plain = (await probe('plain')).facts;
  assertNoSensorTrace('plain', plain);
  assert.equal((await send({ type: 'ui-set-scope', scopeMode: 'all-sites' })).type, 'scope');
  console.log('  ok a plain page of this browser: no marker, ' + nativeCount(plain.top) + ' native functions, no extension frame (pixel hash ' + plain.pixelHash + ')');

  phase = 'sensors only';
  const sensors = await probe('sensors', { report: true });
  assertSensorsVisible('sensors only', sensors.facts);
  assert.equal(sensors.facts.pixelHash, plain.pixelHash, 'the observation sensors never change pixels');
  if (sensors.report) assert.notEqual(sensors.report.coverageState, 'paused', 'sensors running: not paused');
  console.log('  ok observation sensors on: marker, ' + wrappedCount(sensors.facts.top) + ' wrapped functions, extension frames [' + traces(sensors.facts.top).join(',') + '], same pixels as a plain page');

  phase = 'Antidetect on, setting off (today)';
  await applyAntidetect(true);
  let oldPage = null;
  if (browser === 'chrome') { oldPage = await context.newPage(); await oldPage.goto(origin + '/page?run=old'); await oldPage.waitForLoadState('load'); }
  const today = (await probe('today', { report: true }));
  assertSensorsVisible('Antidetect + sensors', today.facts);
  assert.notEqual(today.facts.pixelHash, plain.pixelHash, 'Antidetect Custom canvas changes the pixels');
  assert.notEqual(today.facts.dataUrlLength, plain.dataUrlLength);
  if (today.report) assert.notEqual(today.report.coverageState, 'paused');
  console.log('  ok Antidetect on, setting off: sensors AND Antidetect (pixel hash ' + plain.pixelHash + ' -> ' + today.facts.pixelHash + ')');

  phase = 'setting on';
  const on = await quiet(true);
  assert.deepEqual({ setting: on.setting, antidetect: on.antidetect, scoped: on.scoped, effective: on.effective, healthy: on.healthy }, { setting: true, antidetect: true, scoped: true, effective: true, healthy: true });
  assert.deepEqual(await registered(), [], 'the observation sensors are unregistered');
  const userScripts = await evaluate(async () => (await (globalThis.browser ?? globalThis.chrome).userScripts.getScripts()).length);
  assert.ok(userScripts >= 1, 'Antidetect\'s own early registration is untouched (' + userScripts + ' user scripts)');
  const quietProbe = await probe('quiet', { report: true });
  assertNoSensorTrace('setting on', quietProbe.facts);
  assert.equal(quietProbe.facts.pixelHash, today.facts.pixelHash, 'Antidetect keeps changing the pixels exactly as before');
  assert.equal(quietProbe.facts.dataUrlLength, today.facts.dataUrlLength);
  if (quietProbe.report) {
    assert.equal(quietProbe.report.coverageState, 'paused', 'the Detector says paused for a page the sensors never ran in');
    assert.equal(quietProbe.report.coverageFlags.includes('paused'), false, 'it is not the user\'s own pause');
    const scope = await send({ type: 'ui-get-scope' });
    assert.equal(scope.scope.sensorsQuiet, true, 'the scope reply tells the interface why');
  }
  console.log('  ok setting on: no marker, no wrapped function, no extension frame in the page or its child frame; Antidetect still changes the pixels' + (quietProbe.report ? '; the Detector reads paused' : ''));

  if (oldPage) {
    phase = 'open tab keeps its sensors until reload';
    assert.equal(await oldPage.evaluate(() => Object.getOwnPropertySymbols(window).some(symbol => String(symbol) === 'Symbol(detect.expert/sensor/v1)')), true, 'a tab opened before the change keeps its wrappers');
    await oldPage.reload(); await oldPage.waitForLoadState('load');
    assert.equal(await oldPage.evaluate(() => Object.getOwnPropertySymbols(window).some(symbol => String(symbol) === 'Symbol(detect.expert/sensor/v1)')), false, 'after a reload it has none');
    await oldPage.close();
    console.log('  ok an open tab keeps its sensors until it is reloaded, then loses them');
  }

  phase = 'setting off again';
  const off = await quiet(false);
  assert.equal(off.effective, false); assert.deepEqual(await registered(), ['detector-isolated-v1', 'detector-main-v1'], 'observation is registered again');
  const again = await probe('again', { report: true });
  // The registration is the very one made before (unit tests compare it byte for byte). What the browser then does with two layers of wrappers depends on the order the
  // scripts were registered in: the sensors now come after Antidetect's scripts, so the sensor wrapper is the outer one. That is the same order a toggle of the observation
  // master gives today, so the facts that do not depend on the layering are compared, not the text of the canvas functions.
  assertSensorsVisible('setting off again', again.facts);
  assert.equal(again.facts.pixelHash, today.facts.pixelHash, 'Antidetect keeps changing the pixels as before'); assert.equal(again.facts.dataUrlLength, today.facts.dataUrlLength);
  assert.equal(again.facts.top.sensorMarker, today.facts.top.sensorMarker); assert.equal(again.facts.frame.sensorMarker, today.facts.frame.sensorMarker);
  if (again.report) assert.notEqual(again.report.coverageState, 'paused');
  console.log('  ok setting off again: marker and ' + wrappedCount(again.facts.top) + ' wrapped functions are back (extension frames [' + traces(again.facts.top).join(',') + ']); Antidetect still changes the pixels');

  phase = 'Antidetect off while the setting is on';
  await quiet(true); assert.deepEqual(await registered(), []);
  await applyAntidetect(false);
  assert.deepEqual(await registered(), ['detector-isolated-v1', 'detector-main-v1'], 'Antidetect off: the sensors run again even though the setting stays on');
  const waiting = await probe('waiting');
  assertSensorsVisible('Antidetect off, setting on', waiting.facts);
  assert.equal(waiting.facts.pixelHash, plain.pixelHash, 'Antidetect off: native pixels');
  assert.equal((await send({ type: 'ui-sensor-quiet-get' })).effective, false);
  await applyAntidetect(true);
  assert.deepEqual(await registered(), [], 'Antidetect on again: withheld again, on the fly');
  console.log('  ok the master moves the sensors with it while the setting stays on');

  phase = 'scope off';
  assert.equal((await send({ type: 'ui-set-scope', scopeMode: 'off' })).type, 'scope');
  assert.deepEqual(await registered(), []);
  const idle = await send({ type: 'ui-sensor-quiet-get' });
  assert.equal(idle.effective, false); assert.equal(idle.scoped, false);
  assert.equal((await send({ type: 'ui-set-scope', scopeMode: 'all-sites' })).type, 'scope');
  assert.equal((await send({ type: 'ui-sensor-quiet-get' })).effective, true, 'back in scope: withheld again');
  await quiet(false); await applyAntidetect(false);
  assert.deepEqual(await registered(), ['detector-isolated-v1', 'detector-main-v1']);
  passed = true;
  console.log('Sensor quiet ' + browser + ' ' + (context?.browser().version() ?? opened?.version) + ': PASS');
} catch (error) { console.error('FAIL in phase "' + phase + '": ' + String(error?.stack ?? error)); process.exitCode = 1; }
finally {
  try { if (browser === 'chrome') await context?.close(); else await opened?.close(); } catch { /* the disposable profile is removed with the run folder */ }
  for (const socket of sockets) socket.destroy();
  await new Promise(done => server.close(done));
  await pause(10);
  // The disposable profile and package copy are kept only when the run did not pass, for inspection.
  if (passed) try { rmSync(run, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* a locked file only leaves the folder behind */ }
}
