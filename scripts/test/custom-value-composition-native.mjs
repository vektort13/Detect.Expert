// ADR-066 / E22-19: actual packaged observers composed with the real Custom
// bootstrap. Native values and image payloads remain inside disposable pages;
// only boolean comparisons, counts, operation identifiers and hashes leave RAM.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createApiConfiguration, validateApiConfiguration } from '../../apps/production-extension/api-configuration.js';
import { buildApiCustomScripts } from '../../apps/production-extension/api-custom-registration.js';

const root = resolve(import.meta.dirname, '../..'), browserName = argument('browser', 'chrome');
assert.ok(['chrome', 'firefox'].includes(browserName));
const development = process.argv.includes('--development-source');
const source = join(root, 'apps/production-extension'), delivery = development ? source : join(root, 'dist', browserName);
mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/custom-value-composition-'));
const output = development ? join(run, 'diagnostic-' + browserName + '.json') : join(root, 'test-results/production-1.1.0/antidetect-profiles/custom-value-composition-' + browserName + '.json');
const files = ['hook.early.js', 'hook.main.js', 'api-custom-document-runtime.js', 'api-custom-runtime.js', 'api-custom-canvas-runtime.js', 'api-custom-webrtc-runtime.js', 'api-custom-math-runtime.js', 'api-custom-registration.js', 'api-custom-inherit.main.js', 'api-custom-opaque.entry.js', 'api-custom-opaque.webgl.js', 'api-custom-opaque.canvas-readback.js', 'api-configuration.js'];
const blobs = Object.fromEntries(files.map(file => [file, readFileSync(join(delivery, file))]));
const hashes = Object.fromEntries(files.map(file => [file, sha(blobs[file])]));
const sourceDistMatch = !development && files.every(file => sha(readFileSync(join(source, file))) === hashes[file]);
if (!development) assert.equal(sourceDistMatch, true, 'Composition fixture requires the current source in the final browser delivery');

const selected = {
  'hardware-concurrency': 61, 'navigator-language': 'ja-JP', 'screen-width': 1777,
  webgl: { vendor: 'Owned fixture vendor', renderer: 'Owned fixture renderer', unmaskedVendor: 'Owned fixture unmasked vendor', unmaskedRenderer: 'Owned fixture unmasked renderer' },
  webrtc: { addresses: { ipv4: { host: '192.0.2.10', stun: '198.51.100.20', turn: '203.0.113.30' }, ipv6: { host: null, stun: null, turn: null } }, iceTransportPolicy: 'preserve', randomizeDevices: false, freshCertificates: false, deviceLifetime: 'session' }
};
function customSource({ antidetectEnabled = true, apiEnabled = false, canvas = true } = {}) {
  const configuration = createApiConfiguration(); configuration.enabled = apiEnabled; configuration.antidetectEnabled = antidetectEnabled; configuration.preset = 'custom';
  for (const row of configuration.apis) {
    const canvasRow = canvas && row.id === 'canvas-readback';
    row.mode = canvasRow || Object.hasOwn(selected, row.id) ? 'custom' : 'bypass';
    row.selected = canvasRow ? row.presets[0].value : Object.hasOwn(selected, row.id) ? { kind: 'value', value: selected[row.id] } : { kind: 'unset' };
  }
  assert.equal(validateApiConfiguration(configuration).ok, true, 'Owned fixture configuration validates');
  return buildApiCustomScripts(configuration, ['<all_urls>'], { canvasSeed: 'a'.repeat(64) })[0]?.js[0].code ?? '';
}
const custom = customSource(), metadataOnly = customSource({ canvas: false }), inactive = customSource({ antidetectEnabled: false });
assert.equal(inactive, '', 'Disabled Custom does not produce an active bootstrap');
assert.equal(customSource({ antidetectEnabled: false, apiEnabled: true }), '', 'API Guard alone cannot activate dormant Custom values');
const scriptSources = {
  '/hook.early.js': blobs['hook.early.js'], '/hook.main.js': blobs['hook.main.js'],
  '/custom.js': custom, '/metadata-custom.js': metadataOnly, '/inactive.js': inactive,
  '/opaque-webgl.js': blobs['api-custom-opaque.webgl.js'], '/opaque-canvas.js': blobs['api-custom-opaque.canvas-readback.js'],
  '/boot.js': '(' + browserBootstrap.toString() + ')();',
  '/stage.js': 'globalThis.__composition.stage();',
  '/probe.js': 'globalThis.__composition.run().then(value=>{globalThis.__compositionResult=value;},error=>{globalThis.__compositionResult={fixtureFailure:true,errorName:error.name,phase:globalThis.__composition.phase};});'
};
const cases = [];
for (const hook of ['early', 'main']) {
  cases.push({ id: hook + '-inactive-positive', hook, order: 'inactive', active: false, canvas: false });
  for (const order of ['observer-first', 'custom-first']) cases.push({ id: hook + '-' + order, hook, order, active: true, canvas: true });
}
cases.push({ id: 'early-metadata-only-observer-first', hook: 'early', order: 'observer-first', active: true, canvas: false });
cases.push({ id: 'early-metadata-only-custom-first', hook: 'early', order: 'custom-first', active: true, canvas: false });
cases.push({ id: 'early-late-queued', hook: 'early', order: 'late-queued', active: true, canvas: true });
cases.push({ id: 'early-inherited-blank-child', hook: 'early', order: 'child', active: true, canvas: true });
for (const order of ['observer-first', 'custom-first']) cases.push({ id: 'early-opaque-' + order, hook: 'early', order, active: true, canvas: false, opaque: true });
if (argument('case', null)) { assert.equal(development, true, 'A case filter is diagnostic only'); const wanted = cases.find(row => row.id === argument('case')); assert.ok(wanted, 'Diagnostic case exists'); cases.splice(0, cases.length, wanted); }

function htmlFor(row, search) {
  const boot = '<script src="/boot.js' + search.replaceAll('&', '&amp;') + '"></script>', observer = '<script src="/hook.' + row.hook + '.js"></script>';
  const profile = '<script src="' + (row.active ? row.canvas ? '/custom.js' : '/metadata-custom.js' : '/inactive.js') + '"></script>';
  const opaque = '<script src="/opaque-webgl.js"></script><script src="/opaque-canvas.js"></script>';
  let sequence;
  if (row.opaque) sequence = row.order === 'observer-first' ? observer + opaque : opaque + observer;
  else if (row.order === 'late-queued') sequence = observer + '<script src="/stage.js"></script>' + profile;
  else if (row.order === 'child') sequence = '';
  else sequence = row.order === 'custom-first' ? profile + observer : observer + profile;
  return '<!doctype html><meta charset="utf-8"><title>Owned observer composition fixture</title>' + boot + sequence + '<script src="/probe.js"></script>';
}
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1'); response.setHeader('Cache-Control', 'no-store'); response.setHeader('Access-Control-Allow-Origin', '*');
  if (Object.hasOwn(scriptSources, url.pathname)) { response.setHeader('Content-Type', 'application/javascript'); response.end(scriptSources[url.pathname]); return; }
  if (url.pathname === '/opaque-shell') {
    response.setHeader('Content-Type', 'text/html');
    const row = cases.find(row => row.id === url.searchParams.get('case'));
    if (!row) { response.writeHead(404); response.end(); return; }
    const frameSource = '<base href="http://127.0.0.1:' + server.address().port + '/">' + htmlFor(row, url.search);
    response.end('<!doctype html><title>Owned opaque parent</title><iframe sandbox="allow-scripts"></iframe><script>addEventListener("message",event=>{if(event.source===document.querySelector("iframe")?.contentWindow&&event.data?.channel==="owned-composition-result")globalThis.__compositionResult=event.data.result;});document.querySelector("iframe").srcdoc=' + JSON.stringify(frameSource).replaceAll('<', '\\u003c') + ';</script>'); return;
  }
  const row = cases.find(row => row.id === url.searchParams.get('case'));
  if (!row) { response.writeHead(404); response.end(); return; }
  response.setHeader('Content-Type', 'text/html'); response.end(htmlFor(row, url.search));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const evidence = { result: 'FAIL', browser: browserName, at: new Date().toISOString(), hashes, sourceDistMatch, ownedLocalhostOnly: true, rawValuesPersisted: false,
  generatedSHA256: { active: sha(custom), metadataOnly: sha(metadataOnly) }, checks: [], scenarios: [] };
let native;
try {
  native = await launchNative(); evidence.version = native.version;
  for (const row of cases) {
    const url = new URL(row.opaque ? '/opaque-shell' : '/fixture', origin); url.searchParams.set('case', row.id);
    url.searchParams.set('active', row.active ? '1' : '0'); url.searchParams.set('canvas', row.canvas ? '1' : '0'); url.searchParams.set('order', row.order);
    if (row.opaque) url.searchParams.set('opaque', '1');
    await native.goto(url.href);
    const result = await native.evaluate(async () => {
      const deadline = Date.now() + 25000;
      while (!globalThis.__compositionResult && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
      return globalThis.__compositionResult ?? { fixtureFailure: true, errorName: 'FixtureTimeout' };
    });
    evidence.scenarios.push({ id: row.id, ...result });
    assert.equal(result.fixtureFailure, undefined, row.id + ': owned fixture runs');
    assert.equal(result.realProUiAbsent, true, row.id + ': no Pro UI or extension bridge is loaded');
    assert.equal(result.metadataObserved, true, row.id + ': ordinary observer counter metadata remains active');
    assert.equal(result.nativeArgumentsPreserved, true, row.id + ': page-created Canvas/RTC inputs retain native validity');
    if (row.active) {
      assert.equal(result.markerImmutable, true, row.id + ': Custom installs an immutable one-way capture veto');
      assert.equal(result.directValuesSelected, true, row.id + ': direct page metadata receives its selected/opaque value');
      assert.equal(result.apiValueRows, 0, row.id + ': Pro-OFF API results contain no raw value rows');
      assert.equal(result.proValueRows, 0, row.id + ': forged Pro start/read cannot publish raw values');
      assert.equal(result.visualFrames, 0, row.id + ': forged visual controls cannot publish image payloads');
      assert.equal(result.rtcDetailRows, 0, row.id + ': RTC detail channel cannot publish native configuration');
      if (row.canvas) { assert.equal(result.canvasProjected, true, row.id + ': direct Canvas output is projected'); assert.equal(result.canvasStable, true, row.id + ': repeated page readbacks are stable'); }
      if (row.order === 'late-queued') assert.equal(result.queuedBeforeCustom, true, row.id + ': value/image copies were staged before the veto');
      if (row.order === 'child') { assert.equal(result.inheritedChild, true, row.id + ': probe executes inside the inherited child'); assert.equal(result.parentMarkerImmutable, true, row.id + ': the real parent bootstrap owns the inherited veto'); }
      if (row.opaque) assert.equal(result.opaqueRealm, true, row.id + ': the real guard runs inside a same-origin-inaccessible srcdoc realm');
      if (!row.opaque && row.order !== 'child') assert.equal(result.originalDiffersFromSelection, true, row.id + ': independent native oracle distinguishes the selected profile');
      assert.ok(result.webglOperations > 0, row.id + ': actual WebGL parameters are exercised');
    } else {
      assert.equal(result.markerPresent, false, row.id + ': disabled Custom leaves no capture veto');
      assert.equal(result.apiContainsNative, true, row.id + ': inactive API-results positive control publishes the native fixture calls');
      assert.equal(result.proContainsNative, true, row.id + ': forged Pro controls reach the unprotected positive control');
      assert.equal(result.apiWebGlContainsNative, true, row.id + ': native WebGL is present in the unprotected API-results channel');
      assert.equal(result.proWebGlContainsNative, true, row.id + ': native WebGL is present in the unprotected Pro channel');
      assert.equal(result.visualContainsNativeSynthetic, true, row.id + ': unprotected visual channel publishes the synthetic image');
      assert.ok(result.rtcDetailRows > 0, row.id + ': unprotected RTC detail channel is a live positive control');
      assert.equal(result.directValuesNative, true, row.id + ': disabled Custom uses native page values');
      assert.ok(result.webglOperations > 0, row.id + ': native WebGL positive control is available');
    }
    evidence.checks.push(row.id);
    console.log('PASS composition ' + browserName + ' ' + row.id);
  }
  for (const file of files) assert.equal(sha(readFileSync(join(delivery, file))), hashes[file], 'No delivery changed during native composition checks: ' + file);
  if (!development) for (const file of files) assert.equal(sha(readFileSync(join(source, file))), hashes[file], 'No source changed after delivery snapshot: ' + file);
  evidence.result = 'PASS';
} catch (error) { evidence.failure = { name: error.name, message: error.message }; throw error; }
finally {
  await native?.close(); await new Promise(resolve => server.close(resolve)); mkdirSync(resolve(output, '..'), { recursive: true }); writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
  console.log((evidence.result === 'PASS' ? 'PASS' : 'FAIL') + ' Custom composition ' + browserName + ': ' + evidence.checks.length + '/' + cases.length + ' cases; boolean-only evidence ' + output);
}

function argument(name, fallback) { const index = process.argv.indexOf('--' + name); return index >= 0 ? process.argv[index + 1] : fallback; }
function sha(value) { return createHash('sha256').update(value).digest('hex'); }
function pause(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function until(probe, label) { const end = Date.now() + 20000; while (Date.now() < end) { try { if (await probe()) return; } catch {} await pause(50); } throw Error(label + ' timed out'); }
async function launchNative() {
  if (browserName === 'chrome') {
    const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
    const context = await browser.newContext(); const page = await context.newPage();
    await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    return { version: browser.version(), goto: url => page.goto(url), evaluate: fn => page.evaluate(fn), close: () => browser.close() };
  }
  const driver = process.env.GECKODRIVER_BINARY ?? join(root, '.tmp/firefox/tools/geckodriver.exe'); assert.ok(existsSync(driver), 'Owned geckodriver binary exists');
  let binary = process.env.FIREFOX_BINARY;
  if (!binary && process.platform === 'win32') binary = spawnSync('powershell.exe', ['-NoProfile', '-Command', "(Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\firefox.exe').'(default)'"], { windowsHide: true, encoding: 'utf8' }).stdout.trim();
  assert.ok(binary, 'Installed Firefox binary exists');
  const profile = join(run, 'firefox-profile'); mkdirSync(profile, { recursive: true });
  const prefs = { 'browser.shell.checkDefaultBrowser': false, 'browser.startup.homepage_override.mstone': 'ignore', 'browser.startup.page': 0, 'browser.newtabpage.enabled': false,
    'datareporting.policy.dataSubmissionEnabled': false, 'toolkit.telemetry.enabled': false, 'app.update.auto': false, 'network.proxy.type': 0 };
  writeFileSync(join(profile, 'user.js'), Object.entries(prefs).map(([key, value]) => 'user_pref(' + JSON.stringify(key) + ',' + JSON.stringify(value) + ');').join('\n'));
  const portServer = createServer(); await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve)); const port = portServer.address().port; await new Promise(resolve => portServer.close(resolve));
  const endpoint = 'http://127.0.0.1:' + port, log = createWriteStream(join(run, 'geckodriver.log'));
  const child = spawn(driver, ['--host', '127.0.0.1', '--port', String(port), '--profile-root', run, '--log', 'error'], { cwd: root, windowsHide: true }); child.stdout.pipe(log); child.stderr.pipe(log);
  async function command(path, body, method = 'POST') {
    const response = await fetch(endpoint + path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), signal: AbortSignal.timeout(40000) });
    const result = (await response.json()).value; if (!response.ok || result?.error) throw Error(result?.error ?? 'WebDriver error'); return result;
  }
  let session;
  try {
    await until(async () => { await command('/status', undefined, 'GET'); return true; }, 'Owned geckodriver');
    const result = await command('/session', { capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': { binary, args: ['-headless', '-no-remote', '-profile', profile] } } } }); session = result.sessionId;
    const wd = (path, body, method) => command('/session/' + session + path, body, method);
    return { version: result.capabilities.browserVersion, goto: url => wd('/url', { url }), evaluate: async fn => {
      const result = await wd('/execute/async', { script: 'const done=arguments[arguments.length-1];Promise.resolve((' + fn.toString() + ')()).then(value=>done({ok:true,value}),error=>done({ok:false,errorName:error.name}));', args: [] });
      if (!result.ok) throw Error(result.errorName); return result.value;
    }, close: async () => { try { await command('/session/' + session, undefined, 'DELETE'); } finally { child.kill(); log.end(); } } };
  } catch (error) { if (session) try { await command('/session/' + session, undefined, 'DELETE'); } catch {} child.kill(); log.end(); throw error; }
}

// This function is served verbatim before either product script. No captured
// native handle, native fingerprint value, pixel buffer or recorder row is
// returned to Node, published to a child, or written to an artifact.
function browserBootstrap() {
  const query = new URL(document.currentScript?.src || location.href).searchParams, active = query.get('active') === '1', opaque = query.get('opaque') === '1';
  const child = query.get('child') === '1';
  const apply = Reflect.apply, descriptor = Object.getOwnPropertyDescriptor, now = Date.now;
  const nativeGetter = (name, key) => descriptor(globalThis[name]?.prototype ?? {}, key)?.get;
  const originals = { cpu: nativeGetter('Navigator', 'hardwareConcurrency'), language: nativeGetter('Navigator', 'language'), width: nativeGetter('Screen', 'width'),
    gl: globalThis.WebGLRenderingContext?.prototype.getParameter, gl2: globalThis.WebGL2RenderingContext?.prototype.getParameter };
  const rows = [], proRows = [], images = [], rtc = [], meta = [], comparisons = [];
  let sensorBootId = null, visualBootId = null, rtcBootId = null, protocolVersion = null, proStarted = false, staged = false, closedPeersValid = true, phase = 'boot';
  const marker = Symbol.for('detect.expert/api-custom/value-capture-deny/v1');
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  function post(message) { postMessage(message, '*'); }
  function configureVisual() { if (visualBootId) post({ channel: 'detect.expert/visual/v1', type: 'visual-config', sensorBootId: visualBootId, enabled: true, remainingMs: 60000 }); }
  function hello() { if (sensorBootId && protocolVersion !== null) post({ channel: 'detect.expert/v1', type: 'bridge-hello', sensorBootId, protocolVersion, bridgeSessionId: 'owned-composition', paused: false }); }
  addEventListener('message', event => {
    if (event.source !== globalThis) return; const message = event.data;
    if (message?.channel === 'detect.expert/v1' && message.type === 'sensor-hello') { sensorBootId = message.sensorBootId; protocolVersion = message.protocolVersion; hello(); }
    if (message?.channel === 'detect.expert/v1' && message.type === 'sensor-batch') meta.push(message);
    if (message?.channel === 'detect.expert/api-results/v1' && message.type === 'api-results-batch') rows.push(...message.rows ?? []);
    if (message?.channel === 'detect.expert/pro-values/v1' && message.type === 'pro-values-batch') { proStarted ||= message.enabled === true; proRows.push(...message.rows ?? []); }
    if (message?.channel === 'detect.expert/visual/v1' && message.type === 'visual-hello') visualBootId = message.sensorBootId;
    if (message?.channel === 'detect.expert/visual/v1' && message.type === 'visual-image') images.push(message.image);
    if (message?.channel === 'detect.expert/rtc/v1' && message.type === 'rtc-hello') rtcBootId = message.sensorBootId;
    if (message?.channel === 'detect.expert/rtc/v1' && message.type === 'rtc-snapshot') rtc.push(message.snapshot);
  });
  function compare(operation, original, direct, selected) { comparisons.push({ operation, original, direct, selected }); }
  function exercise(includeRtc = true) {
    phase = 'metadata';
    compare('Navigator.hardwareConcurrency', apply(originals.cpu, navigator, []), navigator.hardwareConcurrency, 61);
    compare('Navigator.language', apply(originals.language, navigator, []), navigator.language, 'ja-JP');
    compare('Screen.width', apply(originals.width, screen, []), screen.width, 1777);
    for (const [name, method, context] of [['WebGLRenderingContext', originals.gl, 'webgl'], ['WebGL2RenderingContext', originals.gl2, 'webgl2']]) {
      phase = context;
      if (!method) continue; const canvas = document.createElement('canvas'), gl = canvas.getContext(context); if (!gl) continue;
      compare(name + '.getParameter.RENDERER', apply(method, gl, [gl.RENDERER]), gl.getParameter(gl.RENDERER), 'Owned fixture renderer');
      const extension = gl.getExtension('WEBGL_debug_renderer_info');
      if (extension) compare(name + '.getParameter.UNMASKED_RENDERER_WEBGL', apply(method, gl, [extension.UNMASKED_RENDERER_WEBGL]), gl.getParameter(extension.UNMASKED_RENDERER_WEBGL), 'Owned fixture unmasked renderer');
    }
    phase = 'canvas'; const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 8;
    const flat = canvas.getContext('2d'); flat.fillStyle = 'rgb(17,31,73)'; flat.fillRect(0, 0, 16, 8); // one colour: the synthetic image the observation channels are asked about
    try { flat.getImageData(0, 0, 16, 8); } catch (error) { if (!(opaque && error.name === 'SecurityError')) throw error; }
    // Six unsaturated colours in stripes (ADR-112: sparse-rgb-v2 returns a canvas of at most four colours as drawn, so a single fill is never projected).
    const stripes = [[17, 31, 73], [100, 110, 120], [200, 150, 90], [60, 70, 80], [33, 99, 165], [140, 33, 77]], stripeAt = x => Math.min(5, Math.floor(x / 3));
    const striped = document.createElement('canvas'); striped.width = 16; striped.height = 8; const context = striped.getContext('2d');
    stripes.forEach((rgb, index) => { context.fillStyle = 'rgb(' + rgb.join(',') + ')'; context.fillRect(index * 3, 0, index === 5 ? 1 : 3, 8); });
    let first, second, denied = false;
    try { first = context.getImageData(0, 0, 16, 8).data; second = context.getImageData(0, 0, 16, 8).data; } catch (error) { if (opaque && error.name === 'SecurityError') denied = true; else throw error; }
    const expected = index => (index % 4 === 3 ? 255 : stripes[stripeAt((index >> 2) % 16)][index % 4]), projected = denied || first.some((value, index) => value !== expected(index));
    const stable = denied || first.every((value, index) => value === second[index]);
    // A separate page-created canvas also exercises the encoded visual path.
    phase = 'png'; const pngCanvas = document.createElement('canvas'); pngCanvas.width = 4; pngCanvas.height = 4;
    const pngContext = pngCanvas.getContext('2d'); pngContext.fillStyle = 'rgb(17,31,73)'; pngContext.fillRect(0, 0, 4, 4);
    try { pngCanvas.toDataURL(); } catch (error) { if (!opaque || error.name !== 'SecurityError') throw error; }
    if (includeRtc && typeof RTCPeerConnection === 'function') {
      phase = 'rtc';
      const peer = new RTCPeerConnection({ iceServers: [], iceCandidatePoolSize: 0 });
      const config = peer.getConfiguration(); closedPeersValid &&= Array.isArray(config.iceServers); peer.close();
    }
    return { projected, stable };
  }
  function values(row) { return [row.value?.value, ...(row.value?.fields ?? []).map(field => field.value)]; }
  const contains = (records, comparison) => records.some(row => row.operation === comparison.operation && values(row).includes(comparison.original));
  function synthetic(image) {
    if (image?.format !== 'rgba' || typeof image.data !== 'string') return false;
    const bytes = atob(image.data), pattern = [17, 31, 73, 255];
    return bytes.length > 0 && [...bytes].every((value, index) => value.charCodeAt(0) === pattern[index % 4]);
  }
  function summary(canvas) {
    const present = descriptor(globalThis, marker), immutable = Boolean(present && present.configurable === false && present.writable === false);
    const select = row => opaque ? row.direct === '' || !row.operation.includes('WebGL') : row.direct === row.selected;
    let opaqueRealm = false; if (opaque && location.protocol === 'about:') try { void parent.document; } catch { opaqueRealm = true; }
    return { realProUiAbsent: true, opaqueRealm, metadataObserved: meta.some(batch => Array.isArray(batch.observations) && batch.observations.length > 0), nativeArgumentsPreserved: closedPeersValid,
      markerPresent: Boolean(present), markerImmutable: immutable, sensorHelloObserved: sensorBootId !== null, apiValueRows: rows.filter(row => row.value).length, proValueRows: proRows.filter(row => row.value).length,
      visualFrames: images.length, rtcDetailRows: rtc.reduce((count, snapshot) => count + (snapshot?.connections?.length ?? 0), 0),
      directValuesSelected: comparisons.every(select), directValuesNative: comparisons.every(row => row.direct === row.original),
      originalDiffersFromSelection: comparisons.some(row => row.original !== row.selected),
      apiContainsNative: comparisons.some(row => contains(rows, row)), proContainsNative: comparisons.some(row => contains(proRows, row)),
      apiWebGlContainsNative: comparisons.some(row => row.operation.startsWith('WebGL') && contains(rows, row)), proWebGlContainsNative: comparisons.some(row => row.operation.startsWith('WebGL') && contains(proRows, row)),
      forgedProEnabled: proStarted, visualContainsNativeSynthetic: images.some(synthetic), canvasProjected: canvas.projected, canvasStable: canvas.stable,
      webglOperations: comparisons.filter(row => row.operation.startsWith('WebGL')).length,
      operations: [...new Set(comparisons.map(row => row.operation))], queuedBeforeCustom: staged, rawValuesPersisted: false };
  }
  async function run() {
    if (query.get('order') === 'child' && !child) {
      phase = 'child'; await delay(30);
      const frame = document.createElement('iframe'); document.body.append(frame);
      const childUrl = new URL(location.href); childUrl.searchParams.set('child', '1'); childUrl.searchParams.set('order', 'inherited');
      // Install an actual child observer first, stage undelivered value/image
      // copies, then let the real parent bootstrap inherit its Custom profile.
      frame.contentDocument.open(); frame.contentDocument.write('<!doctype html><script src="/boot.js' + childUrl.search.replaceAll('&', '&amp;') + '"></script><script src="/hook.early.js"></script><script src="/stage.js"></script>'); frame.contentDocument.close();
      let end = now() + 15000; while (!frame.contentWindow.__composition?.staged && now() < end) await delay(5);
      if (!frame.contentWindow.__composition?.staged) throw new Error('ChildStageFailure');
      await new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = '/custom.js'; script.onload = resolve; script.onerror = () => reject(new Error('ChildCustomFailure')); document.head.append(script); });
      const probe = frame.contentDocument.createElement('script'); probe.src = '/probe.js'; frame.contentDocument.head.append(probe);
      end = now() + 15000; while (!frame.contentWindow.__compositionResult && now() < end) await delay(10);
      const result = frame.contentWindow.__compositionResult;
      if (!result || result.fixtureFailure) throw new Error('ChildFixtureFailure');
      return { ...result, parentMarkerImmutable: descriptor(globalThis, marker)?.configurable === false, inheritedChild: true };
    }
    // Ensure routing handshakes are delivered, but keep Pro unstarted for the
    // first API-results read. Page-visible controls are deliberately forged.
    await delay(60); hello();
    let canvas = exercise();
    post({ channel: 'detect.expert/api-results/v1', type: 'api-results-read', requestId: 'owned-before-pro', epoch: 0 });
    await delay(100);
    post({ channel: 'detect.expert/pro-values/v1', type: 'pro-values-start', requestId: 'pro-1', sessionId: 'owned-composition' });
    await delay(100); configureVisual(); canvas = exercise();
    await delay(650);
    post({ channel: 'detect.expert/pro-values/v1', type: 'pro-values-read', requestId: 'pro-2', sessionId: 'owned-composition' });
    configureVisual(); if (rtcBootId) post({ channel: 'detect.expert/rtc/v1', type: 'rtc-request', sensorBootId: rtcBootId, epoch: 0 });
    // Try both removal and a forged false value. An actual Custom veto is
    // immutable; these operations must leave page semantics and denial intact.
    if (active) { Reflect.deleteProperty(globalThis, marker); try { Object.defineProperty(globalThis, marker, { value: false, configurable: true }); } catch {} }
    await delay(400);
    const result = summary(canvas);
    if (opaque) parent.postMessage({ channel: 'owned-composition-result', result }, '*');
    return result;
  }
  globalThis.__composition = { run, stage() { exercise(false); comparisons.length = 0; staged = true; }, get staged() { return staged; }, get phase() { return phase; } };
}
