// ADR-048: first inline reads are fixtures, never automation-injected startup code.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { ADVERSARIAL_CUSTOM_ENTRIES, nativeCustomAdversarialProbe } from './api-custom-adversarial-fixture.mjs';

export const EARLY_EXPECTED = Object.freeze({ cpu: 257, platform: 'detect-expert-test-platform', width: 1234 });
export const EARLY_RECONFIGURED = Object.freeze({ cpu: 258, platform: 'detect-expert-test-platform-updated', width: 1235 });
export const EARLY_REQUIRED_PHASE_LABELS = Object.freeze({
  initial: Object.freeze(['top:first-inline', '/main:first-microtask', '/main:dom-content-loaded', '/main:load', '/main:settled-saved-reference', 'top:settled-before-page-stop',
    'aboutblank:parent-synchronous', 'aboutblank-written:first-inline', 'window-frames-index:parent-synchronous', 'borrowed-fresh-frame-getter:parent-navigator',
    'parent-node-append:parent-synchronous', 'fragment-append:window-index-synchronous', 'fragment-append:borrowed-parent-getter', 'aboutblank-onload:index-synchronous', 'aboutblank-onload:borrowed-parent-getter',
    'nested-document-write:inline-window-index', 'nested-document-write:borrowed-parent-getter', 'srcdoc-initialblank:parent-synchronous', 'srcdoc:first-inline', '/frame-same:first-inline', '/frame-cross:first-inline',
    'popup-same:initialblank-parent-synchronous', 'popup-cross:initialblank-parent-synchronous', 'popup-aboutblank-written:initialblank-parent-synchronous', 'popup-aboutblank-written:first-inline', '/popup-same:first-inline', '/popup-cross:first-inline',
    'page-channel-apply-empty:after-task', 'page-channel-stop:after-task']),
  reconfigured: Object.freeze(['top:after-reconfiguration', 'aboutblank-written:after-reconfiguration', 'srcdoc:after-reconfiguration', '/frame-same:after-reconfiguration', '/frame-cross:after-reconfiguration',
    '/popup-same:after-reconfiguration', '/popup-cross:after-reconfiguration', 'popup-aboutblank-written:after-reconfiguration',
    'aboutblank-parent:after-reconfiguration', 'parent-node-append:after-reconfiguration', 'fragment-append:after-reconfiguration', 'aboutblank-onload:after-reconfiguration',
    'nested-document-write:after-reconfiguration', 'nested-document-write-child:after-reconfiguration', 'srcdoc-parent:after-reconfiguration', 'borrowed-frame-getter:after-reconfiguration'])
});
export function earlyNativeRunOptions(argv = process.argv.slice(2)) {
  const argument = (flag, fallback) => {
    const index = argv.indexOf(flag); if (index < 0) return fallback;
    assert.equal(argv.lastIndexOf(flag), index, flag + ' must be provided once');
    const value = argv[index + 1]; assert.ok(typeof value === 'string' && value.length > 0 && !value.startsWith('--'), flag + ' requires a value');
    return value;
  };
  const label = argument('--label', 'current'); assert.match(label, /^[a-z0-9-]+$/);
  const artifactDirectory = resolve(argument('--artifact-dir', resolve(import.meta.dirname, '../../test-results/prod/reports/2026-10-20-api-custom')));
  return { label, artifactDirectory, headed: argv.includes('--headed') };
}
export function earlyChromeLaunchOptions(origin, crossOrigin, { headed = false } = {}) {
  return { channel: 'chromium', headless: !headed, ignoreDefaultArgs: ['--disable-extensions'], viewport: { width: 1100, height: 900 }, args: [
    ...(headed ? ['--window-position=-32000,-32000', '--window-size=1100,900'] : []), '--enable-unsafe-extension-debugging', '--disable-popup-blocking', '--no-proxy-server', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    '--unsafely-treat-insecure-origin-as-secure=' + origin + ',' + crossOrigin, '--host-resolver-rules=MAP early-api.example.com 127.0.0.1,MAP cross-early-api.example.com 127.0.0.1'] };
}
export function earlyProbe() {
  const samples = [], saved = new WeakMap(), borrowed = new WeakMap();
  const firstLabel = document.currentScript?.dataset?.label || location.pathname + ':first-inline';
  function getters(realm) {
    return { cpu: Object.getOwnPropertyDescriptor(realm.Navigator.prototype, 'hardwareConcurrency')?.get,
      platform: Object.getOwnPropertyDescriptor(realm.Navigator.prototype, 'platform')?.get,
      width: Object.getOwnPropertyDescriptor(realm.Screen.prototype, 'width')?.get };
  }
  function safe(read) { try { const value = read(); return value === undefined ? { undefined: true } : value; } catch (error) { return { error: error.name }; } }
  function capture(realm, label, phase = 'initial') {
    const current = getters(realm); if (!saved.has(realm)) saved.set(realm, current);
    const previous = saved.get(realm), output = { label, phase, origin: safe(() => realm.location.origin), direct: {}, prototype: {}, saved: {} };
    for (const [key, target, property] of [['cpu', realm.navigator, 'hardwareConcurrency'], ['platform', realm.navigator, 'platform'], ['width', realm.screen, 'width']]) {
      output.direct[key] = safe(() => target[property]);
      output.prototype[key] = safe(() => current[key] ? Reflect.apply(current[key], target, []) : { missingGetter: true });
      output.saved[key] = safe(() => previous[key] ? Reflect.apply(previous[key], target, []) : { missingGetter: true });
    }
    return output;
  }
  function captureBorrowed(sourceRealm, targetRealm, label, phase = 'initial') {
    const output = capture(targetRealm, label, phase), current = getters(sourceRealm);
    if (!borrowed.has(sourceRealm)) borrowed.set(sourceRealm, current);
    const previous = borrowed.get(sourceRealm);
    for (const [key, target] of [['cpu', targetRealm.navigator], ['platform', targetRealm.navigator], ['width', targetRealm.screen]]) {
      output.prototype[key] = safe(() => current[key] ? Reflect.apply(current[key], target, []) : { missingGetter: true });
      output.saved[key] = safe(() => previous[key] ? Reflect.apply(previous[key], target, []) : { missingGetter: true });
    }
    return output;
  }
  function report(sample) {
    samples.push(sample);
    if (parent !== window) parent.postMessage({ channel: 'detect-expert-owned-early-fixture', sample }, '*');
    if (opener) opener.postMessage({ channel: 'detect-expert-owned-early-fixture', sample }, '*');
    return sample;
  }
  Object.assign(window, { __earlySamples: samples, __captureEarly: capture, __captureBorrowedEarly: captureBorrowed, __reportEarly: report,
    __captureReconfiguredEarly: () => report(capture(window, firstLabel.replace(/:first-inline$/, ':after-reconfiguration'), 'reconfigured')) });
  addEventListener('message', event => { if (event.data?.channel === 'detect-expert-owned-early-fixture') samples.push(event.data.sample); });
  report(capture(window, firstLabel));
  queueMicrotask(() => report(capture(window, location.pathname + ':first-microtask')));
  addEventListener('DOMContentLoaded', () => report(capture(window, location.pathname + ':dom-content-loaded')), { once: true });
  addEventListener('load', () => { report(capture(window, location.pathname + ':load')); setTimeout(() => report(capture(window, location.pathname + ':settled-saved-reference')), 350); }, { once: true });
}
const probeSource = '(' + earlyProbe.toString() + ')();';
function script(source, label = '') { return '<script data-label="' + label + '">' + source.replaceAll('</script', '<\\/script') + '</script>'; }
export function earlyFixtureHtml(url, origin, crossOrigin) {
  const child = label => '<!doctype html><html><head>' + script(probeSource, label) + '</head><body>Owned early API fixture</body></html>';
  if (url.pathname !== '/main') return child(url.pathname + ':first-inline');
  const srcdoc = child('srcdoc:first-inline'), about = child('aboutblank-written:first-inline'), popupBlank = child('popup-aboutblank-written:first-inline'),
    nestedWrite = '<!doctype html><html><body><iframe></iframe>' + script("parent.__reportEarly(parent.__captureEarly(window.frames[0],'nested-document-write:inline-window-index'));parent.__reportEarly(parent.__captureBorrowedEarly(window.frames[0],parent,'nested-document-write:borrowed-parent-getter'));") + '</body></html>';
  return '<!doctype html><html><head>' + script(probeSource, 'top:first-inline') + '</head><body><h1>Owned early API fixture</h1>' + script(`
    const blank = document.createElement('iframe'); blank.id='blank'; document.body.appendChild(blank);
    __reportEarly(__captureEarly(blank.contentWindow,'aboutblank:parent-synchronous'));
    __reportEarly(__captureEarly(window.frames[0],'window-frames-index:parent-synchronous'));
    __reportEarly(__captureBorrowedEarly(window.frames[0],window,'borrowed-fresh-frame-getter:parent-navigator'));
    blank.contentDocument.open(); blank.contentDocument.write(${JSON.stringify(about)}); blank.contentDocument.close();
    const nodeAppend=parent.Node.prototype.appendChild,nodeFrame=document.createElement('iframe');nodeFrame.id='parent-node-append';
    Reflect.apply(nodeAppend,document.body,[nodeFrame]);__reportEarly(__captureEarly(nodeFrame.contentWindow,'parent-node-append:parent-synchronous'));
    const fragment=document.createDocumentFragment(),fragmentFrame=document.createElement('iframe');fragmentFrame.id='fragment-append';fragment.appendChild(fragmentFrame);document.body.appendChild(fragment);
    const fragmentRealm=window.frames[window.frames.length-1];
    __reportEarly(__captureEarly(fragmentRealm,'fragment-append:window-index-synchronous'));
    __reportEarly(__captureBorrowedEarly(fragmentRealm,window,'fragment-append:borrowed-parent-getter'));
    const loadFrame=document.createElement('iframe'),loadFrameIndex=window.frames.length;loadFrame.id='aboutblank-onload';loadFrame.onload=()=>{
      __reportEarly(__captureEarly(window.frames[loadFrameIndex],'aboutblank-onload:index-synchronous'));
      __reportEarly(__captureBorrowedEarly(window.frames[loadFrameIndex],window,'aboutblank-onload:borrowed-parent-getter'));
    };document.body.appendChild(loadFrame);
    const writeFrame=document.createElement('iframe');writeFrame.id='nested-document-write';document.body.appendChild(writeFrame);
    writeFrame.contentDocument.open();writeFrame.contentDocument.write(${JSON.stringify(nestedWrite)});writeFrame.contentDocument.close();
    window.__borrowedBlankRealm=blank.contentWindow;
    window.__captureReconfiguredParentRealms=()=>{
      for(const [id,label] of [['blank','aboutblank-parent'],['parent-node-append','parent-node-append'],['fragment-append','fragment-append'],['aboutblank-onload','aboutblank-onload'],['nested-document-write','nested-document-write'],['srcdoc','srcdoc-parent']])
        __reportEarly(__captureEarly(document.getElementById(id).contentWindow,label+':after-reconfiguration','reconfigured'));
      __reportEarly(__captureEarly(document.getElementById('nested-document-write').contentWindow.frames[0],'nested-document-write-child:after-reconfiguration','reconfigured'));
      __reportEarly(__captureBorrowedEarly(__borrowedBlankRealm,window,'borrowed-frame-getter:after-reconfiguration','reconfigured'));
    };
    const srcdoc = document.createElement('iframe');srcdoc.id='srcdoc';srcdoc.srcdoc=${JSON.stringify(srcdoc)};document.body.appendChild(srcdoc);
    __reportEarly(__captureEarly(srcdoc.contentWindow,'srcdoc-initialblank:parent-synchronous'));
    window.__openEarlyPopups=()=>{
      for(const [label,url] of [['popup-same',${JSON.stringify(origin + '/popup-same')}],['popup-cross',${JSON.stringify(crossOrigin + '/popup-cross')}]]){
        const popup=window.open('about:blank',label);if(!popup){__earlySamples.push({label:label+':blocked'});continue;}
        __reportEarly(__captureEarly(popup,label+':initialblank-parent-synchronous'));popup.location.href=url;
      }
      const popup=window.open('about:blank','popup-aboutblank-written');if(!popup){__earlySamples.push({label:'popup-aboutblank-written:blocked'});return;}
      __reportEarly(__captureEarly(popup,'popup-aboutblank-written:initialblank-parent-synchronous'));
      popup.document.open();popup.document.write(${JSON.stringify(popupBlank)});popup.document.close();
    };
    window.__adversarialStop=()=>{
      window.postMessage({channel:'detect.expert/api-custom/v1',type:'apply',revision:Number.MAX_SAFE_INTEGER,entries:[]},'*');
      setTimeout(()=>{
        __reportEarly(__captureEarly(window,'page-channel-apply-empty:after-task'));
        window.postMessage({channel:'detect.expert/api-custom/v1',type:'stop'},'*');
        setTimeout(()=>{
          __reportEarly(__captureEarly(window,'page-channel-stop:after-task'));
          const installation=Object.getOwnPropertyDescriptor(window,Symbol.for('detect.expert/api-custom/installation/v1'))?.value;
          if(typeof installation?.stop==='function'){installation.stop();__reportEarly(__captureEarly(window,'public-installation-stop:immediate'));}
        },30);
      },30);
    };
  `) + '<iframe id="same" src="' + origin + '/frame-same"></iframe><iframe id="cross" src="' + crossOrigin + '/frame-cross"></iframe><button id="open-popups" onclick="__openEarlyPopups()">Open owned popups</button></body></html>';
}
export function earlyLeaks(samples, expected = EARLY_EXPECTED, requiredByPhase = {}) {
  const leaks = [];
  if (!Array.isArray(samples) || samples.length === 0) return [{ problem: 'Missing API samples' }];
  for (const [phase, labels] of Object.entries(requiredByPhase)) for (const label of labels)
    if (!samples.some(sample => sample?.phase === phase && sample.label === label)) leaks.push({ label, phase, problem: 'Missing required API sample' });
  for (const sample of samples) {
    if (!sample?.direct) { leaks.push({ label: sample?.label, problem: 'Missing API sample' }); continue; }
    for (const path of ['direct', 'prototype', 'saved']) for (const key of Object.keys(expected)) {
      // ADR-083 / FP-08: each document keeps its configured generation, including saved getters.
      if (!Object.is(sample[path]?.[key], expected[key])) leaks.push({ label: sample.label, path: path + '.' + key, actual: sample[path]?.[key], expected: expected[key] });
    }
  }
  return leaks;
}
export function configureEarlyValues(state, expected = EARLY_EXPECTED) {
  const values = { 'hardware-concurrency': expected.cpu, 'navigator-platform': expected.platform, 'screen-width': expected.width };
  return { ...state.configuration, enabled: true, antidetectEnabled: true, preset: 'custom', sites: [], apis: state.configuration.apis.map(row => ({ ...row, mode: Object.hasOwn(values, row.id) ? 'custom' : 'bypass', selected: Object.hasOwn(values, row.id) ? { kind: 'value', value: values[row.id] } : { kind: 'unset' } })) };
}
// Uses the actual Chromium settings toggle in an isolated test profile. No project manifest edits.
export async function enableChromeUserScripts(context, ui, extensionId, evidence = {}) {
  evidence.userScriptsBefore = await ui.evaluate(() => typeof chrome.userScripts);
  if (evidence.userScriptsBefore === 'object') return ui;
  const details = await context.newPage(); await details.goto('chrome://extensions/?id=' + extensionId);
  const toggle = details.locator('extensions-detail-view #allow-user-scripts'); await toggle.waitFor();
  const enabled = await toggle.evaluate(element => element.checked ?? element.shadowRoot?.querySelector('cr-toggle')?.checked);
  if (!enabled) await toggle.click();
  await details.close();
  // Refresh the browser's extension contexts after the real toggle, without unloading an
  // addon loaded through --load-extension. CDP is confined to this disposable profile.
  const cdp = await context.newCDPSession(ui);
  try { await cdp.send('ServiceWorker.enable'); await cdp.send('ServiceWorker.stopAllWorkers'); } finally { await cdp.detach(); }
  await ui.reload();
  const reloaded = ui;
  evidence.userScriptsAfter = await reloaded.evaluate(async () => { const scripts = await chrome.userScripts.getScripts(); return { available: typeof chrome.userScripts, scripts: scripts.length }; });
  assert.equal(evidence.userScriptsAfter.available, 'object');
  return reloaded;
}
// CDP installs are removed on Chrome startup. Complete a normal unpacked installation
// through Chrome's native failed-load retry, confined to this harness's copied files.
export async function installPersistentChromeExtension(context, extension, evidence = {}) {
  const temporaryRoot = resolve(import.meta.dirname, '../../.tmp') + sep;
  assert.ok(resolve(extension).startsWith(temporaryRoot), 'Only an isolated test copy may be reloaded');
  const cdp = await context.browser().newBrowserCDPSession();
  let id;
  try { ({ id } = await cdp.send('Extensions.loadUnpacked', { path: extension })); } finally { await cdp.detach(); }
  const details = await context.newPage(); await details.goto('chrome://extensions/');
  const developer = details.locator('extensions-toolbar #devMode');
  if (!await developer.evaluate(element => element.checked)) await developer.click();
  const manifestPath = join(extension, 'manifest.json'), manifest = readFileSync(manifestPath);
  let failure;
  try {
    writeFileSync(manifestPath, '{');
    failure = await details.evaluate(id => new Promise(resolve => chrome.developerPrivate.reload(id, { failQuietly: true, populateErrorForUnpacked: true }, result => resolve({ result, error: chrome.runtime.lastError?.message }))), id);
  } finally { writeFileSync(manifestPath, manifest); }
  assert.ok(readFileSync(manifestPath).equals(manifest), 'Copied manifest must be restored byte for byte');
  assert.equal(failure.error, undefined); assert.equal(typeof failure.result?.retryGuid, 'string', 'Chrome must issue the normal native load retry');
  const installed = await details.evaluate(retryGuid => new Promise(resolve => chrome.developerPrivate.loadUnpacked({ retryGuid, failQuietly: true, populateError: true }, result => resolve({ result, error: chrome.runtime.lastError?.message }))), failure.result.retryGuid);
  assert.equal(installed.error, undefined); assert.equal(installed.result?.error, undefined);
  const info = await details.evaluate(id => new Promise(resolve => chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true, includeTerminated: true }, rows => resolve(rows.find(row => row.id === id)))), id);
  assert.equal(info?.state, 'ENABLED'); assert.equal(info?.location, 'UNPACKED');
  evidence.normalInstallation = { id, state: info.state, location: info.location, manifestRestored: true };
  await details.close(); return id;
}
export async function runChromeEarly() {
  const options = earlyNativeRunOptions();
  const root = resolve(import.meta.dirname, '../..'), temporary = join(root, '.tmp'); mkdirSync(temporary, { recursive: true });
  const run = mkdtempSync(join(temporary, 'api-custom-early-chrome-')), extension = join(run, 'extension'); cpSync(join(root, 'dist/chrome'), extension, { recursive: true });
  const artifact = options.artifactDirectory; mkdirSync(artifact, { recursive: true });
  const label = options.label;
  const evidence = { at: new Date().toISOString(), run, headed: options.headed, expected: EARLY_EXPECTED, samples: [], errors: [], requests: [], checks: [], hashes: Object.fromEntries(['api-custom.main.js', 'api-custom-relay.js', 'api-configuration-controller.js'].map(file => [file, createHash('sha256').update(readFileSync(join(extension, file))).digest('hex')])) };
  let origin, crossOrigin, context;
  const server = createServer((request, response) => {
    const url = new URL(request.url, origin); response.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(earlyFixtureHtml(url, origin, crossOrigin));
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  origin = 'http://early-api.example.com:' + server.address().port; crossOrigin = 'http://cross-early-api.example.com:' + server.address().port;
  const launchOptions = earlyChromeLaunchOptions(origin, crossOrigin, options);
  const guardRequest = async route => { const url = new URL(route.request().url()); if (!['http:', 'https:'].includes(url.protocol) || [origin, crossOrigin].includes(url.origin)) await route.continue(); else { evidence.requests.push(url.origin); await route.abort(); } };
  try {
    context = await chromium.launchPersistentContext(join(run, 'profile'), launchOptions);
    await context.route('**/*', guardRequest);
    evidence.browser = context.browser().version();
    const id = await installPersistentChromeExtension(context, extension, evidence);
    let ui = await context.newPage();
    ui.on('pageerror', error => evidence.errors.push(error.message)); await ui.goto('chrome-extension://' + id + '/options.html');
    if (!process.argv.includes('--skip-early-access-setup')) ui = await enableChromeUserScripts(context, ui, id, evidence);
    const send = message => ui.evaluate(message => chrome.runtime.sendMessage(message), message);
    await send({ schemaVersion: 1, type: 'ui-data-consent-set', version: 1, accepted: true }); await send({ schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'all-sites' });
    const fixture = await context.newPage(); fixture.on('pageerror', error => evidence.errors.push(error.message)); await fixture.goto(origin + '/baseline');
    evidence.native = await fixture.evaluate(() => __earlySamples[0]); assert.notEqual(evidence.native.direct.cpu, EARLY_EXPECTED.cpu); assert.notEqual(evidence.native.direct.platform, EARLY_EXPECTED.platform); assert.notEqual(evidence.native.direct.width, EARLY_EXPECTED.width);
    const before = await send({ schemaVersion: 1, type: 'ui-api-config-get', tabId: null }); assert.equal(before.type, 'api-config-state');
    if (!process.argv.includes('--skip-early-access-setup')) assert.equal(before.earlyAccess, 'ready');
    const saved = await send({ schemaVersion: 1, type: 'ui-api-config-set', tabId: null, expectedRevision: before.revision, configuration: configureEarlyValues(before) }); assert.equal(saved.type, 'api-config-state'); assert.equal(saved.registration, 'ready');
    evidence.configurationRevision = saved.revision;
    await fixture.goto(origin + '/main'); await fixture.locator('#same').waitFor(); await fixture.locator('#cross').waitFor();
    await fixture.waitForTimeout(650); await fixture.locator('#open-popups').click(); await fixture.waitForTimeout(650);
    await fixture.evaluate(() => { __reportEarly(__captureEarly(window, 'top:settled-before-page-stop')); __adversarialStop(); }); await fixture.waitForTimeout(150);
    const unchanged = await send({ schemaVersion: 1, type: 'ui-api-config-get', tabId: null }); assert.deepEqual(unchanged.configuration, saved.configuration); assert.equal(unchanged.revision, saved.revision);
    const updated = await send({ schemaVersion: 1, type: 'ui-api-config-set', tabId: null, expectedRevision: saved.revision, configuration: configureEarlyValues(saved, EARLY_RECONFIGURED) }); assert.equal(updated.type, 'api-config-state');
    await fixture.waitForTimeout(150);
    for (const frame of fixture.frames()) await frame.evaluate(() => { if (typeof __captureReconfiguredEarly === 'function') __captureReconfiguredEarly(); });
    await fixture.evaluate(() => __captureReconfiguredParentRealms());
    for (const page of context.pages()) if (page !== ui && page !== fixture && !page.isClosed() && [origin, crossOrigin, 'null'].some(value => page.url().startsWith(value) || value === 'null' && page.url() === 'about:blank')) await page.evaluate(() => { if (typeof __captureReconfiguredEarly === 'function') __captureReconfiguredEarly(); });
    await fixture.waitForTimeout(50);
    evidence.samples = await fixture.evaluate(() => __earlySamples); evidence.leaks = earlyLeaks(evidence.samples, EARLY_EXPECTED, EARLY_REQUIRED_PHASE_LABELS);
    assert.deepEqual(evidence.leaks, [], 'Every required phase/realm must retain its exact original document profile');
    const after = await send({ schemaVersion: 1, type: 'ui-api-config-get', tabId: null }); assert.deepEqual(after.configuration, updated.configuration); assert.equal(after.revision, updated.revision);
    // Ask Chrome to restore the owned page through its real settings API. Keep the
    // old document alive with its previous immutable values until browser shutdown.
    const settings = await context.newPage(); await settings.goto('chrome://settings/');
    const restoreSetting = await settings.evaluate(() => new Promise(resolve => chrome.settingsPrivate.setPref('session.restore_on_startup', 1, undefined, success => resolve({ success, error: chrome.runtime.lastError?.message }))));
    assert.equal(restoreSetting.error, undefined); assert.equal(restoreSetting.success, true);
    await settings.close();
    for (const page of context.pages()) if (page !== fixture) await page.close();
    // Inspect restored page scripts before opening extension UI, creating a new
    // page, or waiting for its worker after a full browser restart.
    await context.close(); context = null;
    const installedPreferences = JSON.parse(readFileSync(join(run, 'profile/Default/Secure Preferences'), 'utf8')).extensions.settings[id];
    evidence.normalInstallation.creationFlags = installedPreferences.creation_flags;
    assert.equal(installedPreferences.location, 4); assert.equal(installedPreferences.creation_flags & 32768, 0, 'Chrome must retain a normal unpacked install without the CDP startup cleanup flag');
    context = await chromium.launchPersistentContext(join(run, 'profile'), { ...launchOptions, args: launchOptions.args.filter(argument => argument !== '--enable-unsafe-extension-debugging') }); await context.route('**/*', guardRequest);
    let restored;
    for (let attempt = 0; attempt < 100 && !restored; attempt++) {
      restored = context.pages().find(page => page.url() === origin + '/main');
      if (!restored) await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(restored, 'Chrome must automatically restore the saved fixture tab');
    await restored.waitForFunction(() => Array.isArray(window.__earlySamples) && window.__earlySamples.some(sample => sample.label === '/main:settled-saved-reference'));
    evidence.restoredStart = { automatic: true, samples: await restored.evaluate(() => __earlySamples) };
    evidence.restoredStart.leaks = earlyLeaks(evidence.restoredStart.samples, EARLY_RECONFIGURED);
    assert.ok(evidence.restoredStart.samples.some(sample => sample.label === 'top:first-inline'), 'Restored tab must record its earliest inline read');
    const cold = await context.newPage(); await cold.goto(origin + '/cold-start'); await cold.waitForTimeout(400);
    evidence.coldStart = { samples: await cold.evaluate(() => __earlySamples) }; evidence.coldStart.leaks = earlyLeaks(evidence.coldStart.samples, EARLY_RECONFIGURED);
    ui = await context.newPage(); await ui.goto('chrome-extension://' + id + '/options.html');
    const afterRestart = await send({ schemaVersion: 1, type: 'ui-api-config-get', tabId: null }); assert.deepEqual(afterRestart.configuration, after.configuration);
    const selected = new Map(ADVERSARIAL_CUSTOM_ENTRIES.map(entry => [entry.id, entry.value]));
    const adversarialConfiguration = { ...afterRestart.configuration, apis: afterRestart.configuration.apis.map(row => ({ ...row, mode: selected.has(row.id) ? 'custom' : 'bypass', selected: selected.has(row.id) ? { kind: 'value', value: selected.get(row.id) } : { kind: 'unset' } })) };
    const adversarialState = await send({ schemaVersion: 1, type: 'ui-api-config-set', tabId: null, expectedRevision: afterRestart.revision, configuration: adversarialConfiguration }); assert.equal(adversarialState.type, 'api-config-state');
    await cold.goto(origin + '/adversarial');
    evidence.adversarial = await cold.evaluate(nativeCustomAdversarialProbe, ADVERSARIAL_CUSTOM_ENTRIES);
    evidence.checks.push('Earliest inline, microtask, DOM/load, saved and borrowed native getters, window.frames, Node.appendChild, same/cross frames, srcdoc, document.write/about:blank, same/cross popups, forged MAIN apply-empty/stop, and saved references after reconfiguration; forged commands cannot change extension settings');
    assert.deepEqual(evidence.requests, []); assert.deepEqual(evidence.errors, []); assert.equal(evidence.leaks.length, 0, 'Custom leaked native or mismatched values: ' + JSON.stringify(evidence.leaks.slice(0, 12)));
    assert.deepEqual(evidence.coldStart.leaks, [], 'Saved Custom values must apply before inline scripts after browser restart');
    assert.deepEqual(evidence.restoredStart.leaks, [], 'Saved Custom values must apply before inline scripts in automatically restored tabs');
    assert.deepEqual(evidence.adversarial.failures, []); assert.ok(evidence.adversarial.passed > 0);
    evidence.passed = true; console.log('API Custom early Chrome: PASS (' + evidence.samples.length + ' snapshots)');
  } catch (error) { evidence.failure = error.stack ?? String(error); process.exitCode = 1; console.error('API Custom early Chrome: FAIL ' + error.message); }
  finally { if (context) await context.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); const path = join(artifact, 'api-custom-early-chrome-' + label + '.json'); writeFileSync(path, JSON.stringify(evidence, null, 2) + '\n'); console.log('Early native evidence: ' + path); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await runChromeEarly();
