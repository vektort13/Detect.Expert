// Round 5 (ADR-101 amendment) end to end: the extension assembled from apps/production-extension, a Custom media-capabilities profile
// applied through the real ui-api-config-set message, and an owned loopback page that reads what a page can read: decodingInfo /
// encodingInfo (MAIN bridge -> packaged ISOLATED relay -> background route -> the private backend of the real service worker or
// event page), canPlayType and the isTypeSupported statics, in the top document and in a new same-origin about:blank frame.
// (A configuration without a key system runs the page's own native call and is lowered in the page; the service worker answers only a
// key-system configuration, probed with ClearKey.)
// Every expectation is an independent oracle over the NATIVE answers of the same browser read first with Antidetect OFF
// (media-codecs-kit.mjs): a Custom profile only LOWERS what this browser reports, a native false is never raised. Nothing is decoded.
//
// node scripts/test/api-custom-media-extension-native.mjs [--firefox]
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { enableChromeUserScripts } from './api-custom-early-native.mjs';
import { launchOwnedManagement, until, pause } from './management-browser-fixture.mjs';
import { ROOT, stageExtension } from './native-evidence.mjs';
import { updateApiConfiguration } from '../../apps/production-extension/api-configuration.js';
import { CODEC_PROFILES, absentFamilies, assertDrm, assertLowered, installKit, readKit } from './media-codecs-kit.mjs';

const browser = process.argv.includes('--firefox') ? 'firefox' : 'chrome';
mkdirSync(join(ROOT, '.tmp'), { recursive: true });
const run = mkdtempSync(join(ROOT, '.tmp/api-custom-media-extension-')), extension = join(run, 'extension'), evidence = {}, sockets = new Set();
await stageExtension({ browser, target: extension, from: 'source' });

const server = createServer((request, response) => {
  request.resume();
  if (new URL(request.url, 'http://fixture').pathname === '/page') { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); response.end('<!doctype html><title>media codecs</title><body></body>'); return; }
  response.writeHead(404); response.end();
});
server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
const origin = 'http://127.0.0.1:' + await new Promise(done => server.listen(0, '127.0.0.1', () => done(server.address().port)));

// One Options page for messages; one fresh owned page per probe.
let opened = null, context = null, ui = null, base, phase = 'startup';
async function launch() {
  if (browser === 'firefox') {
    opened = await launchOwnedManagement({ root: ROOT, run, extension, browser, evidence });
    await opened.viewport(1000, 560); base = opened.base;
    return;
  }
  context = await chromium.launchPersistentContext(join(run, 'chrome-profile'), { channel: 'chromium', headless: false, viewport: null,
    args: ['--window-position=-10000,-10000', '--window-size=1000,640', '--disable-extensions-except=' + extension, '--load-extension=' + extension, '--no-first-run', '--no-proxy-server'] });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  base = new URL('.', worker.url()).href;
  ui = await context.newPage(); await ui.goto(base + 'options.html#settings');
  ui = await enableChromeUserScripts(context, ui, new URL(base).host, evidence);
}
async function onOptions(hash = 'settings') {
  if (browser === 'chrome') return;
  await opened.goto(base + 'options.html?media=' + Date.now() + '#' + hash);
  await until(() => opened.evaluate(() => document.readyState === 'complete' && Boolean((globalThis.browser ?? globalThis.chrome)?.runtime?.id)), 'Options page');
}
const evaluate = (fn, value) => browser === 'chrome' ? ui.evaluate(fn, value) : opened.evaluate(fn, value);
const send = message => evaluate(message => (globalThis.browser ?? globalThis.chrome).runtime.sendMessage({ schemaVersion: 1, ...message }), message);
const state = () => send({ type: 'ui-api-config-get', tabId: null });

// geckodriver scripts run in a sandbox that sees the NATIVE page objects through Xray wrappers, not what page scripts (and the Custom
// bootstrap) did to them. The page world is reached with a script element; its JSON result comes back through a DOM attribute.
let runs = 0;
const pageWorld = driver => ({ async evaluate(fn, argument) {
  const id = 'r' + ++runs, attribute = 'data-codec-' + id;
  const source = '(async () => { try { const value = await (' + fn.toString() + ')(' + JSON.stringify(argument) + '); document.documentElement.setAttribute(' + JSON.stringify(attribute) + ', JSON.stringify({ ok: true, value })); }'
    + ' catch (error) { document.documentElement.setAttribute(' + JSON.stringify(attribute) + ', JSON.stringify({ ok: false, error: String(error && error.stack || error) })); } })()';
  await driver.evaluate(text => { const script = document.createElement('script'); script.textContent = text; document.documentElement.append(script); script.remove(); }, source);
  const raw = await until(() => driver.evaluate(name => document.documentElement.getAttribute(name), attribute), 'page-world result ' + id, 90000);
  await driver.evaluate(name => document.documentElement.removeAttribute(name), attribute);
  const result = JSON.parse(raw);
  if (!result.ok) throw new Error(result.error);
  return result.value;
} });

// Reads the whole answer set in a fresh page (and in a new about:blank frame of it) and what the page sees of the function objects.
async function probe(label) {
  let page = null;
  try {
    const target = browser === 'chrome' ? (page = await context.newPage()) : pageWorld(opened);
    await (browser === 'chrome' ? page.goto(origin + '/page?run=' + label) : opened.goto(origin + '/page?run=' + label));
    await until(() => target.evaluate(() => document.readyState === 'complete'), 'page ' + label);
    await installKit(target);
    const top = await readKit(target), frame = await readKit(target, undefined, undefined, { frame: true });
    // The detector's own observers also wrap these functions, so "not native code" says nothing: look for the source of the Custom wrappers.
    // When an observer sits outside a Custom wrapper this can read false for a wrapper that exists; behaviour is what is asserted below.
    const wrapped = await target.evaluate(() => [HTMLMediaElement.prototype.canPlayType, MediaSource.isTypeSupported, MediaRecorder.isTypeSupported, MediaCapabilities.prototype.decodingInfo, MediaCapabilities.prototype.encodingInfo]
      .map(value => /customMediaType|recordArguments/.test(Function.prototype.toString.call(value))));
    const shape = await target.evaluate(async () => {
      const info = navigator.mediaCapabilities.decodingInfo({ type: 'file', video: { contentType: 'video/webm; codecs="vp8"', width: 640, height: 360, bitrate: 1000000, framerate: 30 } }), value = await info;
      return { promise: info instanceof Promise, plain: Object.getPrototypeOf(value) === Object.prototype, keys: Reflect.ownKeys(value).join(',') };
    });
    return { top, frame, wrapped, shape };
  } finally {
    if (page) await page.close();
    if (browser === 'chrome') for (const extra of context.pages()) if (extra !== ui) await extra.close().catch(() => {});
  }
}

let passed = false;
try {
  await launch();
  phase = 'setup'; await onOptions();
  await send({ type: 'ui-data-consent-set', version: 1, accepted: true }); await send({ type: 'ui-set-scope', scopeMode: 'all-sites' });
  if (browser === 'firefox') {
    await onOptions('antidetect');
    await until(() => opened.evaluate(() => document.querySelector('[data-antidetect-app]')?.getAttribute('aria-busy') === 'false'), 'Antidetect ready');
    if ((await state()).earlyAccess !== 'ready') await opened.click('[data-antidetect-grant-early]');
    await until(async () => (await state()).earlyAccess === 'ready', 'Firefox early access');
  }
  let current = await state();
  assert.equal(current.earlyAccess, 'ready'); assert.equal(current.configuration.antidetectEnabled, false);
  console.log('  ok setup: consent, all-sites scope, early registration ready');

  phase = 'native baseline';
  const baseline = await probe('native');
  assert.deepEqual(baseline.wrapped, [false, false, false, false, false], 'Antidetect OFF shows no Custom wrapper');
  assert.deepEqual(baseline.frame.snapshot, baseline.top.snapshot, 'a new about:blank frame answers like the top document');
  const absent = absentFamilies(baseline.top.snapshot);
  assert.ok(absent.length >= 1, 'this browser lacks at least one probed codec, so "never raised above native" is exercised');
  console.log('  ok native baseline read with Antidetect OFF (absent here: ' + absent.join(',') + ')');

  const summary = [];
  for (const [name, profile] of Object.entries(CODEC_PROFILES)) {
    phase = 'profile ' + name;
    const updated = updateApiConfiguration(current.configuration, 'media-capabilities', { mode: 'custom', selected: { kind: 'value', value: profile } });
    assert.equal(updated.ok, true, phase + ': ' + updated.error?.message);
    await onOptions();
    const saved = await send({ type: 'ui-api-config-set', tabId: null, expectedRevision: current.revision, configuration: { ...updated.value, antidetectEnabled: true } });
    assert.equal(saved.type, 'api-config-state', phase + ': ' + JSON.stringify(saved).slice(0, 300));
    assert.equal(saved.registration, 'ready', phase + ': registration ' + saved.registration);
    current = saved;
    const result = await probe(name);
    // The identity profile is the native answer: nothing is installed. Every other profile wraps decodingInfo / encodingInfo, and the type
    // functions exactly when a codec family is hidden or supported is false.
    const wantsTypes = profile.hidden.length > 0 || !profile.supported, lowers = wantsTypes || !profile.smooth || !profile.powerEfficient;
    // A wrapper the page can see must belong to a profile that needs it; the identity profile shows none.
    result.wrapped.forEach((seen, index) => assert.ok(!seen || (index < 3 ? wantsTypes : lowers), name + ': unexpected Custom wrapper at ' + index));
    const counts = assertLowered(name + ' top', profile, baseline.top.snapshot, result.top.snapshot);
    assertLowered(name + ' frame', profile, baseline.top.snapshot, result.frame.snapshot);
    assertDrm(name + ' top', profile, baseline.top.snapshot, result.top.snapshot, { installed: lowers });
    assertDrm(name + ' frame', profile, baseline.top.snapshot, result.frame.snapshot, { installed: lowers });
    assert.deepEqual(result.top.edges, baseline.top.edges, name + ': wrong receivers, missing and odd arguments behave natively');
    assert.deepEqual(result.frame.edges, baseline.top.edges, name + ': the same in a new about:blank frame');
    assert.deepEqual(result.shape, { promise: true, plain: true, keys: 'powerEfficient,smooth,supported,keySystemAccess' }, name + ': decodingInfo keeps the native Promise result shape');
    summary.push(name + ' lowered ' + counts.lowered + ' native-false ' + counts.neverRaised + ' (visible wrappers ' + result.wrapped.map(Number).join('') + ')');
  }
  console.log('  ok Codecs only downward through the packaged extension (' + browser + ', top + about:blank frame): ' + summary.join('; '));

  phase = 'off'; await onOptions();
  const off = await send({ type: 'ui-api-config-set', tabId: null, expectedRevision: current.revision, configuration: { ...current.configuration, antidetectEnabled: false } });
  assert.equal(off.type, 'api-config-state', 'switching Antidetect off: ' + JSON.stringify(off).slice(0, 300));
  const after = await probe('off');
  assert.deepEqual(after.wrapped, [false, false, false, false, false], 'Antidetect OFF again: no Custom wrapper');
  assert.deepEqual(after.top.snapshot, baseline.top.snapshot, 'after OFF every answer is the native one');
  console.log('  ok Antidetect OFF again: native functions and answers');
  passed = true;
  console.log('API Custom media codecs (extension) ' + browser + ': PASS');
} catch (error) { console.error('FAIL in phase "' + phase + '": ' + String(error?.stack ?? error)); process.exitCode = 1; }
finally {
  try { if (browser === 'chrome') await context?.close(); else await opened?.close(); } catch { /* the disposable profile is removed with the run folder */ }
  for (const socket of sockets) socket.destroy();
  await new Promise(done => server.close(done));
  await pause(10);
  // The disposable profile and package copy (~150 MB) are kept only when the run did not pass, for inspection.
  if (passed) try { rmSync(run, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* a locked file only leaves the folder behind */ }
}
