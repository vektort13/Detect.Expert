// ADR-048: real Firefox first-inline and realm-boundary checks; no injected startup probes.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { cpSync, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { archiveProduction, FIREFOX_ID } from '../build-production.mjs';
import { EARLY_EXPECTED, EARLY_RECONFIGURED, EARLY_REQUIRED_PHASE_LABELS, earlyNativeRunOptions, earlyFixtureHtml, earlyLeaks, configureEarlyValues } from './api-custom-early-native.mjs';
import { ADVERSARIAL_CUSTOM_ENTRIES, nativeCustomAdversarialProbe } from './api-custom-adversarial-fixture.mjs';

const root = resolve(import.meta.dirname, '../..'), driverPath = process.env.GECKODRIVER_BINARY ?? join(root, '.tmp/firefox/tools/geckodriver.exe');
const options = earlyNativeRunOptions();
assert.ok(existsSync(driverPath), 'Existing geckodriver is required; this test downloads no browser tools');
let binary = process.env.FIREFOX_BINARY;
if (!binary && process.platform === 'win32') binary = spawnSync('powershell.exe', ['-NoProfile', '-Command', "(Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\firefox.exe').'\x28default\x29'"], { encoding: 'utf8', windowsHide: true }).stdout.trim();
assert.ok(binary, 'Set FIREFOX_BINARY to the installed Firefox executable');
const label = options.label;
const run = join(root, '.tmp/firefox/runs', Date.now() + '-api-custom-early'), profile = join(run, 'profile'), extension = join(run, 'extension');
mkdirSync(profile, { recursive: true }); cpSync(join(root, 'dist/firefox'), extension, { recursive: true });
const artifact = options.artifactDirectory; mkdirSync(artifact, { recursive: true });
const uuid = randomUUID(), host = 'early-api.example.com', crossHost = 'cross-early-api.example.com';
const prefs = { 'extensions.webextensions.uuids': JSON.stringify({ [FIREFOX_ID]: uuid }), 'browser.shell.checkDefaultBrowser': false, 'browser.startup.homepage_override.mstone': 'ignore', 'browser.startup.page': 0, 'browser.newtabpage.enabled': false, 'datareporting.policy.dataSubmissionEnabled': false, 'toolkit.telemetry.enabled': false, 'app.update.auto': false, 'network.proxy.type': 0, 'network.dns.localDomains': host + ',' + crossHost, 'dom.securecontext.allowlist': host + ',' + crossHost, 'network.dns.disablePrefetch': true, 'extensions.webextOptionalPermissionPrompts': false, 'dom.disable_open_during_load': false };
writeFileSync(join(profile, 'user.js'), Object.entries(prefs).map(([key, value]) => 'user_pref(' + JSON.stringify(key) + ', ' + JSON.stringify(value) + ');').join('\n'));
const evidence = { at: new Date().toISOString(), run, binary, expected: EARLY_EXPECTED, samples: [], checks: [], hashes: Object.fromEntries(['api-custom.main.js', 'api-custom-relay.js', 'api-configuration-controller.js'].map(file => [file, createHash('sha256').update(readFileSync(join(extension, file))).digest('hex')])) };
let origin, crossOrigin, endpoint, session, driver, driverError;
const log = createWriteStream(join(run, 'geckodriver.log'));
const server = createServer((request, response) => {
  const url = new URL(request.url, origin); response.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(earlyFixtureHtml(url, origin, crossOrigin));
});
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function command(path, body, method = 'POST') {
  const response = await fetch(endpoint + path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), signal: AbortSignal.timeout(30000) });
  const value = (await response.json()).value; if (!response.ok || value?.error) throw Error(JSON.stringify(value)); return value;
}
const wd = (path, body, method) => command('/session/' + session + path, body, method);
const script = (source, args = []) => wd('/execute/sync', { script: source, args });
const send = message => wd('/execute/async', { script: 'const done=arguments[arguments.length-1];browser.runtime.sendMessage(arguments[0]).then(done,error=>done({error:String(error)}));', args: [message] });
async function waitFor(source, args = [], attempts = 60) { for (let index = 0; index < attempts; index++) { if (await script(source, args)) return; await sleep(100); } throw Error('Firefox fixture condition timed out: ' + source); }
async function click(selector) { const element = await wd('/element', { using: 'css selector', value: selector }); await wd('/element/' + element['element-6066-11e4-a52e-4f735466cecf'] + '/click', {}); }
try {
  await new Promise(done => server.listen(0, '127.0.0.1', done)); origin = 'http://' + host + ':' + server.address().port; crossOrigin = 'http://' + crossHost + ':' + server.address().port;
  const portServer = createServer(); await new Promise(done => portServer.listen(0, '127.0.0.1', done)); const port = portServer.address().port; await new Promise(done => portServer.close(done));
  endpoint = 'http://127.0.0.1:' + port;
  driver = spawn(driverPath, ['--host', '127.0.0.1', '--port', String(port), '--profile-root', run, '--log', 'error'], { cwd: root, windowsHide: true }); driver.once('error', error => { driverError = error; }); driver.stdout.pipe(log); driver.stderr.pipe(log);
  for (let attempt = 0; attempt < 80; attempt++) { if (driverError) throw driverError; try { await command('/status', undefined, 'GET'); break; } catch { await sleep(100); } }
  const opened = await command('/session', { capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': { binary, args: ['-headless', '-no-remote', '-profile', profile] } } } }); session = opened.sessionId; evidence.browser = opened.capabilities.browserVersion;
  const archive = join(run, 'detect-expert-early.xpi'); writeFileSync(archive, archiveProduction(extension)); assert.equal(await wd('/moz/addon/install', { path: archive, temporary: true }), FIREFOX_ID); await sleep(1200);
  await wd('/url', { url: origin + '/baseline' }); const fixtureWindow = await wd('/window', undefined, 'GET'); await waitFor('return Boolean(window.__earlySamples?.length);');
  evidence.native = await script('return __earlySamples[0];'); assert.notEqual(evidence.native.direct.cpu, EARLY_EXPECTED.cpu); assert.notEqual(evidence.native.direct.platform, EARLY_EXPECTED.platform); assert.notEqual(evidence.native.direct.width, EARLY_EXPECTED.width);
  const uiWindow = (await wd('/window/new', { type: 'tab' })).handle; await wd('/window', { handle: uiWindow }); await wd('/url', { url: 'moz-extension://' + uuid + '/options.html' });
  await waitFor('return typeof browser?.runtime?.sendMessage === "function";');
  if (!process.argv.includes('--skip-early-access-setup')) {
    evidence.userScriptsBefore = await script('return typeof browser.userScripts;');
    await wd('/url', { url: 'moz-extension://' + uuid + '/protection.html' });
    await waitFor('return Boolean(document.querySelector("[data-api-early-grant]"));');
    await click('[data-api-early-grant]');
    await waitFor('return typeof browser.userScripts?.getScripts === "function";');
    evidence.userScriptsAfter = await wd('/execute/async', { script: 'const done=arguments[arguments.length-1];browser.userScripts.getScripts().then(scripts=>done({available:typeof browser.userScripts,scripts:scripts.length}));', args: [] });
  }
  await send({ schemaVersion: 1, type: 'ui-data-consent-set', version: 1, accepted: true }); await send({ schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'all-sites' });
  const before = await send({ schemaVersion: 1, type: 'ui-api-config-get', tabId: null }); assert.equal(before.type, 'api-config-state');
  if (!process.argv.includes('--skip-early-access-setup')) assert.equal(before.earlyAccess, 'ready');
  const saved = await send({ schemaVersion: 1, type: 'ui-api-config-set', tabId: null, expectedRevision: before.revision, configuration: configureEarlyValues(before) }); assert.equal(saved.type, 'api-config-state'); assert.equal(saved.registration, 'ready'); evidence.configurationRevision = saved.revision;
  await wd('/window', { handle: fixtureWindow }); await wd('/url', { url: origin + '/main' }); await waitFor('return Boolean(document.querySelector("#same")&&document.querySelector("#cross"));');
  await sleep(650); await click('#open-popups'); await wd('/window', { handle: fixtureWindow }); await sleep(650);
  await script('__reportEarly(__captureEarly(window,"top:settled-before-page-stop"));__adversarialStop();'); await sleep(150);
  await wd('/window', { handle: uiWindow });
  const unchanged = await send({ schemaVersion: 1, type: 'ui-api-config-get', tabId: null }); assert.deepEqual(unchanged.configuration, saved.configuration); assert.equal(unchanged.revision, saved.revision);
  const updated = await send({ schemaVersion: 1, type: 'ui-api-config-set', tabId: null, expectedRevision: saved.revision, configuration: configureEarlyValues(saved, EARLY_RECONFIGURED) }); assert.equal(updated.type, 'api-config-state');
  await wd('/window', { handle: fixtureWindow }); await sleep(150);
  await script('__captureReconfiguredEarly();__captureReconfiguredParentRealms();');
  const frames = await script('return window.frames.length;');
  for (let index = 0; index < frames; index++) {
    await wd('/frame', { id: index });
    await script('if(typeof __captureReconfiguredEarly==="function")__captureReconfiguredEarly();');
    await wd('/frame/parent', {});
  }
  for (const handle of await wd('/window/handles', undefined, 'GET')) {
    if (handle === fixtureWindow || handle === uiWindow) continue;
    await wd('/window', { handle }); await script('if(typeof __captureReconfiguredEarly==="function")__captureReconfiguredEarly();');
  }
  await wd('/window', { handle: fixtureWindow }); await sleep(50);
  evidence.samples = await script('return __earlySamples;'); evidence.leaks = earlyLeaks(evidence.samples, EARLY_EXPECTED, EARLY_REQUIRED_PHASE_LABELS);
  assert.deepEqual(evidence.leaks, [], 'Every required phase/realm must retain its exact original document profile');
  await wd('/window', { handle: uiWindow }); const after = await send({ schemaVersion: 1, type: 'ui-api-config-get', tabId: null }); assert.deepEqual(after.configuration, updated.configuration); assert.equal(after.revision, updated.revision);
  const selected = new Map(ADVERSARIAL_CUSTOM_ENTRIES.map(entry => [entry.id, entry.value]));
  const adversarialConfiguration = { ...after.configuration, apis: after.configuration.apis.map(row => ({ ...row, mode: selected.has(row.id) ? 'custom' : 'bypass', selected: selected.has(row.id) ? { kind: 'value', value: selected.get(row.id) } : { kind: 'unset' } })) };
  const adversarialState = await send({ schemaVersion: 1, type: 'ui-api-config-set', tabId: null, expectedRevision: after.revision, configuration: adversarialConfiguration }); assert.equal(adversarialState.type, 'api-config-state');
  await wd('/window', { handle: fixtureWindow }); await wd('/url', { url: origin + '/adversarial' });
  evidence.adversarial = await wd('/execute/async', { script: 'const done=arguments[arguments.length-1];(' + nativeCustomAdversarialProbe.toString() + ')(arguments[0]).then(done,error=>done({error:String(error)}));', args: [ADVERSARIAL_CUSTOM_ENTRIES] });
  evidence.checks.push('First-inline, microtasks, direct/prototype/saved/borrowed getters, window.frames, Node.appendChild, same/cross frames, srcdoc, document.write/about:blank, popups, forged MAIN apply-empty/stop, and saved references after reconfiguration; forged commands cannot change extension settings');
  assert.equal(evidence.leaks.length, 0, 'Custom leaked native or mismatched values: ' + JSON.stringify(evidence.leaks.slice(0, 12)));
  assert.deepEqual(evidence.adversarial.failures, []); assert.ok(evidence.adversarial.passed > 0);
  evidence.passed = true; console.log('API Custom early Firefox: PASS (' + evidence.samples.length + ' snapshots)');
} catch (error) { evidence.failure = error.stack ?? String(error); process.exitCode = 1; console.error('API Custom early Firefox: FAIL ' + error.message); }
finally {
  if (session) try { await command('/session/' + session, undefined, 'DELETE'); } catch {}
  driver?.kill(); log.end(); server.closeAllConnections(); if (server.listening) await new Promise(done => server.close(done));
  const path = join(artifact, 'api-custom-early-firefox-' + label + '.json'); writeFileSync(path, JSON.stringify(evidence, null, 2) + '\n'); console.log('Early native evidence: ' + path);
}
