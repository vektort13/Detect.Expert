import { PROTECTION_FEATURES } from '../packages/contracts/src/protection-features.mjs';
import { API_CONFIG_CATALOG } from '../packages/contracts/src/api-configuration.mjs';
import { readNativeToolbar, verifyNativeToolbar } from './test/toolbar-native-fixture.mjs';
import { nativeProtectionProbe, verifyNativeProtection } from './test/protection-native-fixture.mjs';
import { PROTECTION_FEATURE_FILTER } from '../apps/production-extension/protection-ui.js';
// Native installed Firefox acceptance for the separate API blocking page.
// This harness consumes an existing dist/firefox build and keeps its profile in this project.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { cpSync, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archiveProduction, FIREFOX_ID } from './build-production.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildOutput = join(root, 'dist', 'firefox');
assert.ok(existsSync(join(buildOutput, 'protection.html')), 'Build dist/firefox before running this harness');
const manifest = JSON.parse(readFileSync(join(buildOutput, 'manifest.json'), 'utf8'));
assert.equal(manifest.version, JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version);
const driverPath = process.env.GECKODRIVER_BINARY ?? join(root, '.tmp', 'firefox', 'tools', 'geckodriver.exe');
assert.ok(existsSync(driverPath), 'Existing project geckodriver required; this harness does not download tools');
let binary = process.env.FIREFOX_BINARY;
if (!binary && process.platform === 'win32') {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command',
    "(Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\firefox.exe').'\x28default\x29'"], { encoding: 'utf8', windowsHide: true });
  binary = result.stdout.trim();
}
assert.ok(binary, 'Set FIREFOX_BINARY to the installed Firefox executable');
const run = join(root, '.tmp', 'firefox', 'runs', Date.now().toString() + '-blocking');
const evidenceDirectory = join(root, 'test-results', 'production-1.1.0', 'blocking');
mkdirSync(run, { recursive: true }); mkdirSync(evidenceDirectory, { recursive: true });
const output = join(run, 'extension'); cpSync(buildOutput, output, { recursive: true });
const profile = join(run, 'profile'); mkdirSync(profile);
const uuid = randomUUID(), host = 'blocking.example.com';
const prefs = {
  'extensions.webextensions.uuids': JSON.stringify({ [FIREFOX_ID]: uuid }),
  'browser.shell.checkDefaultBrowser': false,
  'browser.startup.homepage_override.mstone': 'ignore',
  'browser.startup.page': 0,
  'browser.newtabpage.enabled': false,
  'datareporting.policy.dataSubmissionEnabled': false,
  'toolkit.telemetry.enabled': false,
  'app.update.auto': false,
  'network.proxy.type': 0,
  'network.dns.localDomains': host,
  'dom.securecontext.allowlist': host,
  'network.dns.disablePrefetch': true,
  'extensions.webextOptionalPermissionPrompts': false,
};
writeFileSync(join(profile, 'user.js'), Object.entries(prefs).map(([key, value]) => 'user_pref(' + JSON.stringify(key) + ', ' + JSON.stringify(value) + ');').join('\n'));
const evidence = {
  at: new Date().toISOString(), browser: null, binary, profile,
  driverVersion: spawnSync(driverPath, ['--version'], { encoding: 'utf8', windowsHide: true }).stdout.trim(),
  harnessSha256: createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
  assertions: [], states: [], screenshots: [],
  fixture: 'Owned loopback hostname resolved in the isolated Firefox profile; production blocking is tested through native UI clicks and page JavaScript.',
};
const log = createWriteStream(join(run, 'geckodriver.log'));
let endpoint, session, driver, portServer, driverError, pageLoads = 0;
const server = createServer((_request, response) => {
  pageLoads++;
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>Native blocking fixture</title><body><h1>Native blocking fixture</h1><button id="read-canvas" type="button">Read fixture canvas</button><output id="result"></output><script>document.querySelector("#read-canvas").addEventListener("click",()=>{let value;try{const canvas=document.createElement("canvas");value=canvas.toDataURL().startsWith("data:image/")?"allowed":"unexpected";}catch(error){value=error.name;}document.querySelector("#result").textContent=value;});</script></body></html>');
});
async function command(path, body, method = 'POST') {
  const response = await fetch(endpoint + path, { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}), signal: AbortSignal.timeout(30000) });
  const result = (await response.json()).value;
  if (!response.ok || result?.error) throw new Error(JSON.stringify(result));
  return result;
}
const wd = (path, body, method) => command('/session/' + session + path, body, method);
const script = (code, args = []) => wd('/execute/sync', { script: code, args });
const asyncScript = (code, args = []) => wd('/execute/async', { script: code, args });
const send = (message) => asyncScript('const done=arguments[arguments.length-1];browser.runtime.sendMessage(arguments[0]).then(done,e=>done({error:String(e)}));', [message]);
const sleep = (ms) => new Promise(done => setTimeout(done, ms));
const elementKey = 'element-6066-11e4-a52e-4f735466cecf';
async function click(selector) {
  const element = await wd('/element', { using: 'css selector', value: selector });
  await wd('/element/' + element[elementKey] + '/click', {});
}
async function waitFor(code, args = [], attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt++) { if (await script(code, args)) return; await sleep(150); }
  throw new Error('Firefox condition timed out: ' + code);
}
async function screenshot(name) {
  const file = join(evidenceDirectory, name + '.png');
  writeFileSync(file, Buffer.from(await wd('/screenshot', undefined, 'GET'), 'base64'));
  evidence.screenshots.push(file.slice(root.length + 1).replaceAll('\\', '/'));
}
async function state(label, tabId) {
  const value = await send({ schemaVersion: 1, type: 'ui-protection-get', tabId });
  assert.equal(value.type, 'protection-state', label);
  const stored = await script('return browser.storage.local.get("protection:v1");');
  assert.deepEqual(stored['protection:v1'], value.settings, label + ': real saved policy');
  evidence.states.push({ label, ...value });
  return value;
}

// Stable selectors are supplied by the shared protection UI module.
const selectors = {
  launch: '[data-protection-open]',
  master: '[data-protection-master]',
  global: '[data-protection-scope="global"]',
  site: '[data-protection-scope="site"]',
  custom: '[data-protection-preset-select] option[value="custom"]',
  save: '[data-protection-save]',
  saveReload: '[data-protection-save-reload]',
};
const rule = (state) => '[data-protection-feature="canvas-readback"] [data-protection-state="' + state + '"]';

try {
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const fixtureUrl = 'http://' + host + ':' + server.address().port + '/';
  portServer = createServer();
  await new Promise((done, reject) => { portServer.once('error', reject); portServer.listen(0, '127.0.0.1', done); });
  const port = portServer.address().port; await new Promise(done => portServer.close(done));
  driver = spawn(driverPath, ['--host', '127.0.0.1', '--port', String(port), '--profile-root', run, '--log', 'error'], { cwd: root, windowsHide: true });
  driver.once('error', error => { driverError = error; }); driver.stdout.pipe(log); driver.stderr.pipe(log);
  endpoint = 'http://127.0.0.1:' + port;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (driverError) throw driverError;
    try { await command('/status', undefined, 'GET'); break; } catch { await sleep(100); }
  }
  const opened = await command('/session', { capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': { binary, args: ['-headless', '-no-remote', '-profile', profile] } } } });
  session = opened.sessionId; evidence.browser = opened.capabilities.browserVersion;
  console.log('Firefox blocking native: ' + evidence.browser);
  const xpi = join(run, 'detect-expert-blocking-test.xpi'); writeFileSync(xpi, archiveProduction(output));
  evidence.xpiSha256 = createHash('sha256').update(readFileSync(xpi)).digest('hex');
  evidence.packagedHashes = Object.fromEntries(['api-configuration-ui.js', 'api-configuration-ui.css', 'api-configuration.js', 'api-custom.main.js', 'protection.html', 'protection-ui.js', 'protection-ui.css', 'options.js', 'popup.js', 'sidepanel.js', 'background.js', 'bridge.js', 'protection-runtime.js', 'manifest.json', ...PROTECTION_FEATURES.map(id => 'protection.' + id + '.js')].map(file => [file, createHash('sha256').update(readFileSync(join(output, file))).digest('hex')]));
  assert.equal(await wd('/moz/addon/install', { path: xpi, temporary: true }), FIREFOX_ID);
  evidence.assertions.push('existing Firefox build installed temporarily without rebuilding or downloading tools');
  await sleep(1200); // Native installation returns before asynchronous document_start registration finishes.
  await wd('/url', { url: fixtureUrl }); const fixtureWindow = await wd('/window', undefined, 'GET');
  await sleep(500);
  await click('#read-canvas'); assert.equal(await script('return document.querySelector("#result").textContent;'), 'allowed');
  const uiWindow = (await wd('/window/new', { type: 'tab' })).handle; await wd('/window', { handle: uiWindow });
  await wd('/url', { url: 'moz-extension://' + uuid + '/protection.html' });
  await waitFor('return Boolean(document.querySelector("[data-protection-feature]"));');
  await waitFor('return Boolean(document.querySelector("[data-api-early-grant]"));');
  await click('[data-api-early-grant]');
  await waitFor('return typeof browser.userScripts?.getScripts === "function";');
  assert.equal(await script('return Boolean(document.querySelector("[data-action=accept-data-consent]"));'), false);
  assert.equal((await send({ schemaVersion: 1, type: 'ui-data-consent-get' })).accepted, true);
  evidence.assertions.push('fresh installation opens the regular blocking page without a disclosure screen or enable action');
  await script('return browser.storage.local.set({"ui-language-v1":"ru"});');
  const tabs = await script('return browser.tabs.query({});'); const tabId = tabs.find(tab => tab.url === fixtureUrl).id;
  const toolbar = mode => verifyNativeToolbar(() => script('return (' + readNativeToolbar.toString() + ')(arguments[0]);', [tabId]), mode, evidence);
  await toolbar('observing');
  let initialReport;
  for (let attempt = 0; attempt < 40; attempt++) {
    initialReport = await send({ schemaVersion: 1, type: 'ui-get-report', tabId });
    if (initialReport.report?.techniques?.some(item => item.count > 0)) break;
    await sleep(150);
  }
  assert.ok(initialReport.report?.techniques.some(item => item.count > 0), 'fixture API calls made before opening UI are observed automatically');
  evidence.initialReport = initialReport;
  assert.equal((await send({ schemaVersion: 1, type: 'ui-pro-get', tabId })).session, null);
  assert.equal(await script('return browser.permissions.contains({permissions:["cookies"]});'), false);
  assert.equal((await send({ schemaVersion: 1, type: 'ui-protection-get', tabId })).settings.enabled, false);
  evidence.assertions.push('ordinary observations captured before any extension UI; Pro and API blocking remain off; optional cookies permission is not requested');
  await wd('/window', { handle: fixtureWindow }); await wd('/refresh', {}); await sleep(1000);
  await wd('/window', { handle: uiWindow }); await wd('/url', { url: 'moz-extension://' + uuid + '/popup.html' });
  await script('return browser.tabs.update(arguments[0],{active:true});', [tabId]); await wd('/refresh', {});
  await waitFor('return Boolean(document.querySelector(arguments[0]));', [selectors.launch]);
  await waitFor('const button=document.querySelector(arguments[0]);return Boolean(button&&!button.disabled);', [selectors.master]);
  await waitFor('return document.querySelector("[data-observation-master]")?.getAttribute("aria-checked")==="true";');
  await click('[data-observation-master]');
  await waitFor('return document.querySelector("[data-observation-master]")?.getAttribute("aria-checked")==="false";');
  assert.equal((await send({ schemaVersion: 1, type: 'ui-get-scope' })).scope.scopeMode, 'off');
  await toolbar('off');
  await click('[data-observation-master]');
  await waitFor('const b=document.querySelector("[data-observation-master]");return b?.getAttribute("aria-checked")==="true"&&!b.disabled;');
  assert.equal((await send({ schemaVersion: 1, type: 'ui-get-scope' })).scope.scopeMode, 'all-sites');
  evidence.assertions.push('header master switches observation off and restores all-sites in native Firefox');
  await wd('/window', { handle: fixtureWindow }); await wd('/refresh', {}); await sleep(600);
  await wd('/window', { handle: uiWindow });
  await script('return browser.tabs.update(arguments[0],{active:true});', [tabId]); await wd('/refresh', {});
  await waitFor('const button=document.querySelector(arguments[0]);return Boolean(button&&!button.disabled);', [selectors.master]);
  assert.equal((await state('initial-disabled', tabId)).settings.enabled, false);
  await click(selectors.master);
  await waitFor('return browser.storage.local.get("protection:v1").then(s=>s["protection:v1"]?.enabled===true);');
  assert.equal((await state('launcher-on', tabId)).settings.enabled, true);
  await toolbar('blocking');
  await click('[data-observation-master]');
  await waitFor('return document.querySelector("[data-observation-master]")?.getAttribute("aria-checked")==="false";');
  await toolbar('off');
  await click('[data-observation-master]');
  await waitFor('return document.querySelector("[data-observation-master]")?.getAttribute("aria-checked")==="true";');
  await toolbar('blocking');
  evidence.assertions.push('wide popup launcher master ON persists through the privileged production controller');
  const oldHandles = await wd('/window/handles', undefined, 'GET'); await click(selectors.launch);
  let settingsWindow;
  for (let attempt = 0; attempt < 50; attempt++) {
    settingsWindow = (await wd('/window/handles', undefined, 'GET')).find(handle => !oldHandles.includes(handle));
    if (settingsWindow) break; await sleep(100);
  }
  assert.ok(settingsWindow, 'native launcher opens its own settings tab'); await wd('/window', { handle: settingsWindow });
  assert.equal(await script('return new URL(location.href).searchParams.get("tabId");'), String(tabId));
  await waitFor('return Boolean(document.querySelector(arguments[0]));', [rule('on')]);
  await waitFor('const picker=document.querySelector("[data-protection-host-picker]");return picker?.value===arguments[0];', [host]);
  assert.equal(await script('return document.querySelector("[data-protection-host-picker]").selectedOptions[0].textContent;'), host);
  evidence.assertions.push('new settings tab preserves the originating native website tab and exact hostname');
  evidence.initialLayout = await script('return {width:innerWidth,documentWidth:document.documentElement.scrollWidth,rows:[...document.querySelectorAll("[data-protection-feature]")].map(row=>{const buttons=[...row.querySelectorAll("[data-protection-state]")],bounds=row.getBoundingClientRect(),rects=buttons.map(button=>button.getBoundingClientRect());return {feature:row.dataset.protectionFeature,labels:buttons.map(button=>button.textContent),aligned:rects.every(rect=>Math.abs(rect.top-rects[0].top)<=1),inside:rects.every(rect=>rect.left>=bounds.left-1&&rect.right<=bounds.right+1),clipped:buttons.some(button=>button.scrollWidth>button.clientWidth+1),customDisabled:row.querySelector("[data-protection-state=custom]").disabled,picker:!!row.querySelector(".api-value-picker")};})};');
  assert.ok(evidence.initialLayout.documentWidth <= evidence.initialLayout.width + 1);
  assert.equal(evidence.initialLayout.rows.length, API_CONFIG_CATALOG.length);
  for (const row of evidence.initialLayout.rows) {
    const entry = API_CONFIG_CATALOG.find(entry => entry.id === row.feature); assert.ok(entry);
    assert.deepEqual(row.labels, ['ON', 'BYPASS', 'OFF', 'Custom']); assert.equal(row.aligned, true); assert.equal(row.inside, true); assert.equal(row.clipped, false);
    assert.equal(row.customDisabled, !entry.customSupported); assert.equal(row.picker, entry.customSupported);
  }
  evidence.assertions.push('all ' + API_CONFIG_CATALOG.length + ' API rows contain four aligned, unclipped mode controls; Custom availability and value pickers match the executable catalogue');
  await screenshot('firefox-settings');
  // ADR-046: view-only category chip through a native WebDriver click.
  const filterView = () => script('return {width:innerWidth,documentWidth:document.documentElement.scrollWidth,selected:document.querySelector("[data-protection-filter][aria-checked=true]")?.dataset.protectionFilter??null,features:[...document.querySelectorAll("[data-protection-feature]")].map(row=>row.dataset.protectionFeature),groups:[...document.querySelectorAll("[data-protection-group]")].map(group=>({id:group.dataset.protectionGroup,rows:group.querySelectorAll("[data-protection-feature]").length,count:group.querySelector(".blocking-group__count")?.textContent??null}))};');
  const filterPolicy = await send({ schemaVersion: 1, type: 'ui-protection-get', tabId });
  await click('[data-protection-filter="network"]');
  await waitFor('return document.querySelector("[data-protection-filter=network]")?.getAttribute("aria-checked")==="true";');
  const network = await filterView(), expectedNetwork = PROTECTION_FEATURES.filter(feature => PROTECTION_FEATURE_FILTER[feature] === 'network');
  assert.equal(network.selected, 'network');
  assert.deepEqual([...network.features].sort(), [...expectedNetwork].sort(), 'Network chip shows exactly the Network rules');
  assert.ok(network.documentWidth <= network.width + 1, 'filtered page has no horizontal overflow');
  for (const group of network.groups) { assert.ok(group.rows > 0, group.id + ' not empty'); assert.equal(group.count, String(group.rows), group.id + ' count'); }
  await screenshot('firefox-settings-filter');
  await click('[data-protection-filter="all"]');
  await waitFor('return document.querySelector("[data-protection-filter=all]")?.getAttribute("aria-checked")==="true"&&document.querySelectorAll("[data-protection-feature]").length===arguments[0];', [API_CONFIG_CATALOG.length]);
  assert.deepEqual((await send({ schemaVersion: 1, type: 'ui-protection-get', tabId })).settings, filterPolicy.settings, 'chip clicks write nothing');
  evidence.filter = { network: network.features.length, groups: network.groups, width: network.width, documentWidth: network.documentWidth };
  evidence.assertions.push('native click on Network shows its ' + expectedNetwork.length + ' rules in non-empty groups without overflow; All restores ' + API_CONFIG_CATALOG.length + ' rows; policy unchanged');

  async function saveReload(label) {
    const before = await state(label + '-before', tabId), beforeLoads = pageLoads;
    await click(selectors.saveReload);
    await waitFor('const button=document.querySelector(arguments[0]);return Boolean(button&&!button.disabled);', [selectors.saveReload]);
    let after;
    for (let attempt = 0; attempt < 60; attempt++) {
      after = await send({ schemaVersion: 1, type: 'ui-protection-get', tabId });
      if (after.settings.revision > before.settings.revision && after.documentId !== before.documentId && after.documentId !== null) break;
      await sleep(150);
    }
    assert.ok(after.settings.revision > before.settings.revision, label + ': policy revision increased');
    assert.notEqual(after.documentId, before.documentId, label + ': originating native document reloaded');
    assert.ok(pageLoads > beforeLoads, label + ': owned HTTP fixture reloaded');
    await waitFor('const button=document.querySelector(arguments[0]);return Boolean(button&&!button.disabled);', [selectors.saveReload]);
    return state(label + '-saved', tabId);
  }
  async function canvas(expected) {
    await wd('/window', { handle: fixtureWindow }); await click('#read-canvas');
    assert.equal(await script('return document.querySelector("#result").textContent;'), expected);
    await wd('/window', { handle: settingsWindow });
  }
  async function mode(expected) {
    const selected = await script('const button=document.querySelector("[data-protection-feature=canvas-readback] [data-protection-state][aria-checked=true]");return {mode:button?.dataset.protectionState,color:button?getComputedStyle(button).backgroundColor:null};');
    assert.equal(selected.mode, expected);
    const channels = selected.color.match(/\d+/g).map(Number), dominant = expected === 'on' ? 1 : expected === 'bypass' ? 2 : 0;
    assert.ok(channels[dominant] > channels[(dominant + 1) % 3] && channels[dominant] > channels[(dominant + 2) % 3], 'actual selected color for ' + expected);
  }
  await click(selectors.global); await click(selectors.custom); await click(rule('on'));
  await mode('on');
  const globalOn = await saveReload('global-on');
  assert.equal(globalOn.settings.preset, 'custom');
  assert.ok(globalOn.settings.global.some(entry => entry.feature === 'canvas-readback' && entry.state === 'block'));
  await canvas('SecurityError');
  evidence.assertions.push('global ON saves block and native page canvas readback throws SecurityError after target reload');

  await click(rule('bypass')); await mode('bypass'); const globalBypass = await saveReload('global-bypass');
  assert.ok(!globalBypass.settings.global.some(entry => entry.feature === 'canvas-readback'));
  await canvas('allowed');
  evidence.assertions.push('global BYPASS removes the explicit block and inherits the custom preset');
  await click(rule('off')); await mode('off'); const globalOff = await saveReload('global-off');
  assert.ok(globalOff.settings.global.some(entry => entry.feature === 'canvas-readback' && entry.state === 'allow'));
  await canvas('allowed');
  evidence.assertions.push('global OFF saves allow in the actual production policy');
  await click(rule('on')); await saveReload('global-on-again'); await canvas('SecurityError');

  await click(selectors.site); await click(rule('on')); const firstSiteOn = await saveReload('site-on-first');
  assert.ok(firstSiteOn.settings.sites.find(entry => entry.host === host)?.rules.some(entry => entry.feature === 'canvas-readback' && entry.state === 'block'));
  await canvas('SecurityError');

  await click(rule('off')); const siteOff = await saveReload('site-off');
  assert.ok(siteOff.settings.sites.find(entry => entry.host === host)?.rules.some(entry => entry.feature === 'canvas-readback' && entry.state === 'allow'));
  await canvas('allowed');
  evidence.assertions.push('site OFF saves allow and overrides the global block in the native page');

  await click(rule('bypass')); const siteBypass = await saveReload('site-bypass');
  assert.ok(!(siteBypass.settings.sites.find(entry => entry.host === host)?.rules ?? []).some(entry => entry.feature === 'canvas-readback'));
  await canvas('SecurityError');
  evidence.assertions.push('site BYPASS removes the explicit API override and inherits the global block');

  await click(rule('on')); const siteOn = await saveReload('site-on');
  assert.ok(siteOn.settings.sites.find(entry => entry.host === host)?.rules.some(entry => entry.feature === 'canvas-readback' && entry.state === 'block'));
  await canvas('SecurityError');
  evidence.assertions.push('site ON saves block and applies it to the originating native website');
  await screenshot('firefox-site-on');

  await click(selectors.master);
  await waitFor('return browser.storage.local.get("protection:v1").then(s=>s["protection:v1"]?.enabled===false);');
  const off = await state('master-off', tabId); assert.equal(off.settings.enabled, false); assert.deepEqual(off.configured, []);
  await toolbar('observing');
  await wd('/window', { handle: fixtureWindow }); await wd('/refresh', {}); await sleep(600);
  await click('#read-canvas'); assert.equal(await script('return document.querySelector("#result").textContent;'), 'allowed');
  await wd('/window', { handle: settingsWindow });
  const registered = await script('return browser.scripting.getRegisteredContentScripts();');
  assert.ok(!registered.some(entry => entry.id.startsWith('detector-protection-v1-')));
  evidence.assertions.push('master OFF preserves rules while removing production blocking registrations and restoring native canvas use after reload');
  await wd('/window', { handle: uiWindow });
  await waitFor('const master=document.querySelector("[data-protection-master]");return master?.getAttribute("aria-checked")==="false"&&!master.disabled;');
  await screenshot('firefox-popup-synchronized-off');
  await wd('/window', { handle: settingsWindow });
  await waitFor('const master=document.querySelector("[data-protection-master]");return master?.getAttribute("aria-checked")==="false"&&!master.disabled;');
  assert.equal((await state('synchronized-final-off', tabId)).settings.enabled, false);
  evidence.assertions.push('existing popup master reflects editor OFF through real saved changes without refreshing the standalone popup page');
  const body = await script('return document.body.innerText;');
  for (const removed of ['Установка для этого API не подтверждена', 'Высокий риск поломок']) assert.ok(!body.includes(removed));
  assert.equal(await script('return Boolean(document.querySelector("[data-api-config-transfer]")&&document.querySelector("[data-protection-preset-select]"));'), true);
  evidence.assertions.push('unified editor exposes configuration transfer and the protection preset selector; removed installation and risk labels remain absent');
  await screenshot('firefox-master-off');
  await wd('/window', { handle: fixtureWindow });
  const runProbe = mode => asyncScript('const done=arguments[arguments.length-1];(' + nativeProtectionProbe.toString() + ')(arguments[0]).then(done,e=>done({error:String(e)}));', [mode]);
  const nativeBefore = await runProbe('baseline');
  await wd('/window', { handle: settingsWindow });
  const latest = await send({ schemaVersion: 1, type: 'ui-protection-get', tabId });
  const expanded = await send({ schemaVersion: 1, type: 'ui-protection-set', tabId, settings: { ...latest.settings, enabled: true, preset: 'custom', global: PROTECTION_FEATURES.map(feature => ({feature,state:'block'})), sites: [] } });
  assert.equal(expanded.registration, 'ready');
  // Open extension pages query the new document on commit; each rule answers at most every 250 ms.
  await wd('/window', { handle: fixtureWindow }); await wd('/refresh', {}); await sleep(1000);
  const nativeBlocked = await runProbe('blocked');
  await wd('/window', { handle: settingsWindow });
  const registeredAll = (await script('return browser.scripting.getRegisteredContentScripts();')).map(entry => entry.id).filter(id => id.startsWith('detector-protection-v1-'));
  assert.equal(registeredAll.length, PROTECTION_FEATURES.length, 'one registration per rule');
  let active = await send({ schemaVersion: 1, type: 'ui-protection-get', tabId });
  // Native Firefox 138: the first read after a navigation can exceed the controller's 1000 ms bound
  // (reproduced with zero rules), giving liveRead 'unavailable'. Only that timeout is read once more;
  // a received read is never repeated, so a short observation count still fails.
  evidence.firstLiveRead = { liveRead: active.liveRead, observations: active.observations.length };
  if (active.liveRead === 'unavailable') { await sleep(400); active = await send({ schemaVersion: 1, type: 'ui-protection-get', tabId }); }
  assert.equal(active.liveRead, 'received');
  assert.equal(active.observations.length, PROTECTION_FEATURES.length, 'one live observation per rule through the bridge');
  for (const row of active.observations) assert.ok(row.installed + row.unavailable >= 1, row.feature + ' reports installed or unavailable hooks');
  await send({ schemaVersion: 1, type: 'ui-protection-set', tabId, settings: { ...active.settings, enabled: false } });
  await wd('/window', { handle: fixtureWindow }); await wd('/refresh', {}); await sleep(600);
  const nativeRestored = await runProbe('baseline');
  const verified = verifyNativeProtection(assert, nativeBefore, nativeBlocked, nativeRestored);
  evidence.expansion = { rules: PROTECTION_FEATURES.length, registered: registeredAll.length, observations: active.observations.length, liveObservations: active.observations, tested: verified.tested, features: verified.features, frameGap: nativeBlocked.frameGap ?? null, before: nativeBefore, blocked: nativeBlocked, restored: nativeRestored };
  evidence.assertions.push('all ' + PROTECTION_FEATURES.length + ' rules: ' + registeredAll.length + ' registrations, ' + active.observations.length + ' live observations, ' + verified.tested + ' present native entry points denied or hidden and restored; unsupported APIs remain absent');
  // ADR-048: verify real Firefox Custom results independently of the legacy blocking probes.
  const nativeCpu = await script('return navigator.hardwareConcurrency;');
  assert.ok(Number.isInteger(nativeCpu) && nativeCpu > 0, 'native Firefox reports a positive logical CPU count');
  await wd('/window', { handle: settingsWindow });
  const getApiConfiguration = () => send({ schemaVersion: 1, type: 'ui-api-config-get', tabId });
  let apiState = await getApiConfiguration(); assert.equal(apiState.type, 'api-config-state');
  let cpuConfiguration = { ...apiState.configuration, enabled: true, preset: 'custom', sites: [], apis: apiState.configuration.apis.map(row => ({ ...row, mode: row.id === 'hardware-concurrency' ? 'custom' : 'bypass', selected: row.id === 'hardware-concurrency' ? { kind: 'value', value: 16 } : { kind: 'unset' } })) };
  const readCpuAfterReload = async expected => {
    await wd('/window', { handle: fixtureWindow }); await wd('/refresh', {});
    await waitFor('return document.readyState==="complete"&&Boolean(document.querySelector("#read-canvas"));');
    // The ISOLATED relay obtains the validated configuration asynchronously after navigation.
    await waitFor('return navigator.hardwareConcurrency===arguments[0];', [expected], 60);
    const value = await script('return navigator.hardwareConcurrency;');
    await wd('/window', { handle: settingsWindow }); return value;
  };
  const customCpuResults = [];
  evidence.customApi = { nativeCpu, selected: customCpuResults, attempts: [] };
  for (const logicalProcessors of [16, 32]) {
    cpuConfiguration = { ...cpuConfiguration, apis: cpuConfiguration.apis.map(row => row.id === 'hardware-concurrency' ? { ...row, selected: { kind: 'value', value: logicalProcessors } } : row) };
    apiState = await send({ schemaVersion: 1, type: 'ui-api-config-set', tabId, expectedRevision: apiState.revision, configuration: cpuConfiguration });
    assert.equal(apiState.type, 'api-config-state'); assert.equal(apiState.registration, 'ready');
    evidence.customApi.attempts.push({ selected: logicalProcessors, revision: apiState.revision, stored: apiState.configuration.apis.find(row => row.id === 'hardware-concurrency').selected });
    const actual = await readCpuAfterReload(logicalProcessors); assert.equal(actual, logicalProcessors, 'Custom controls native Firefox navigator.hardwareConcurrency');
    customCpuResults.push(actual);
  }
  cpuConfiguration = { ...apiState.configuration, apis: apiState.configuration.apis.map(row => row.id === 'hardware-concurrency' ? { ...row, mode: 'off' } : row) };
  apiState = await send({ schemaVersion: 1, type: 'ui-api-config-set', tabId, expectedRevision: apiState.revision, configuration: cpuConfiguration });
  assert.equal(apiState.type, 'api-config-state');
  const restoredCpu = await readCpuAfterReload(nativeCpu); assert.equal(restoredCpu, nativeCpu, 'OFF restores native Firefox CPU reporting after reload');
  const stopped = await send({ schemaVersion: 1, type: 'ui-api-config-set', tabId, expectedRevision: apiState.revision, configuration: { ...apiState.configuration, enabled: false } });
  assert.equal(stopped.type, 'api-config-state'); assert.equal(stopped.configuration.enabled, false);
  evidence.customApi = { nativeCpu, selected: customCpuResults, restoredCpu, finalRevision: stopped.revision, masterEnabled: stopped.configuration.enabled };
  evidence.assertions.push('native Firefox Custom CPU returns 16 then 32 after target reload; OFF restores the original CPU count and master OFF persists');
  console.log('Firefox blocking: PASS (' + evidence.assertions.length + ' assertions)');
} catch (error) {
  evidence.error = String(error); console.error('Firefox blocking: FAIL ' + error); process.exitCode = 1;
  if (session) try {
    evidence.failureUi = await script('const master=document.querySelector("[data-protection-master]");return {url:location.href,body:document.body.innerText.slice(0,20000),master:master?{disabled:master.disabled,checked:master.getAttribute("aria-checked"),label:master.textContent}:null};');
    await screenshot('firefox-failure');
    evidence.failureProtection = await send({ schemaVersion: 1, type: 'ui-protection-get', tabId: evidence.states.at(-1)?.tabId ?? null });
  } catch {}
} finally {
  if (session) try { await command('/session/' + session, undefined, 'DELETE'); } catch {}
  driver?.kill();
  for (const fixture of [server, portServer]) if (fixture?.listening) { fixture.closeAllConnections(); await new Promise(done => fixture.close(done)); }
  log.end();
  writeFileSync(join(run, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  writeFileSync(join(evidenceDirectory, 'firefox.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log('Firefox blocking evidence: ' + join(evidenceDirectory, 'firefox.json'));
}
