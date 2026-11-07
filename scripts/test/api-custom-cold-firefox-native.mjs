// ADR-049: persistent unsigned-addon startup in an existing Firefox Nightly test
// build. Signature preference changes are confined to a fresh owned test profile.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { cpSync, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { archiveProduction, FIREFOX_ID } from '../build-production.mjs';
import { EARLY_EXPECTED, EARLY_RECONFIGURED, earlyFixtureHtml, earlyLeaks, configureEarlyValues } from './api-custom-early-native.mjs';

const root = resolve(import.meta.dirname, '../..');
const binary = process.env.FIREFOX_COLD_BINARY ?? join(process.env.LOCALAPPDATA ?? '', 'ms-playwright/firefox-1538/firefox/firefox.exe');
const driverPath = process.env.GECKODRIVER_BINARY ?? join(root, '.tmp/firefox/tools/geckodriver.exe');
assert.ok(existsSync(binary), 'An existing Firefox Nightly/test executable is required; no tools are downloaded');
assert.ok(existsSync(driverPath), 'An existing geckodriver is required');
const run = join(root, '.tmp/firefox/runs', Date.now() + '-api-custom-cold'), profile = join(run, 'profile'), extension = join(run, 'extension');
mkdirSync(profile, { recursive: true }); cpSync(join(root, 'dist/firefox'), extension, { recursive: true });
const artifact = join(root, 'test-results/prod/reports/2026-10-20-api-custom'); mkdirSync(artifact, { recursive: true });
const uuid = randomUUID(), host = 'cold-api.example.com';
const prefs = { 'extensions.webextensions.uuids': JSON.stringify({ [FIREFOX_ID]: uuid }), 'xpinstall.signatures.required': false, 'browser.shell.checkDefaultBrowser': false, 'browser.startup.homepage_override.mstone': 'ignore', 'browser.startup.page': 0, 'browser.newtabpage.enabled': false, 'datareporting.policy.dataSubmissionEnabled': false, 'toolkit.telemetry.enabled': false, 'app.update.auto': false, 'network.proxy.type': 0, 'network.dns.localDomains': host, 'dom.securecontext.allowlist': host, 'network.dns.disablePrefetch': true, 'extensions.webextOptionalPermissionPrompts': false };
writeFileSync(join(profile, 'user.js'), Object.entries(prefs).map(([key, value]) => 'user_pref(' + JSON.stringify(key) + ', ' + JSON.stringify(value) + ');').join('\n'));
const evidence = { at: new Date().toISOString(), run, binary, unsignedTestBuildOnly: true, profileSignaturePreference: false, hashes: Object.fromEntries(['api-custom.main.js', 'api-configuration-controller.js'].map(file => [file, createHash('sha256').update(readFileSync(join(extension, file))).digest('hex')])) };
let origin, endpoint, session, driver, driverError;
const log = createWriteStream(join(run, 'geckodriver.log'));
const server = createServer((request, response) => { const url = new URL(request.url, origin); response.setHeader('Cache-Control', 'no-store'); if (url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; } response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(earlyFixtureHtml(url, origin, origin)); });
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function command(path, body, method = 'POST') {
  const response = await fetch(endpoint + path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), signal: AbortSignal.timeout(30000) });
  const value = (await response.json()).value; if (!response.ok || value?.error) throw Error(JSON.stringify(value)); return value;
}
const wd = (path, body, method) => command('/session/' + session + path, body, method);
const script = (source, args = []) => wd('/execute/sync', { script: source, args });
const send = message => wd('/execute/async', { script: 'const done=arguments[arguments.length-1];browser.runtime.sendMessage(arguments[0]).then(done,error=>done({error:String(error)}));', args: [message] });
async function waitFor(source, args = []) { for (let index = 0; index < 100; index++) { if (await script(source, args)) return; await sleep(100); } throw Error('Firefox cold fixture condition timed out: ' + source); }
async function openSession() {
  const opened = await command('/session', { capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': { binary, args: ['-headless', '-no-remote', '-profile', profile] } } } });
  session = opened.sessionId; return opened.capabilities;
}
try {
  await new Promise(done => server.listen(0, '127.0.0.1', done)); origin = 'http://' + host + ':' + server.address().port;
  const portServer = createServer(); await new Promise(done => portServer.listen(0, '127.0.0.1', done)); const port = portServer.address().port; await new Promise(done => portServer.close(done)); endpoint = 'http://127.0.0.1:' + port;
  driver = spawn(driverPath, ['--host', '127.0.0.1', '--port', String(port), '--profile-root', run, '--log', 'error'], { cwd: root, windowsHide: true }); driver.once('error', error => { driverError = error; }); driver.stdout.pipe(log); driver.stderr.pipe(log);
  for (let attempt = 0; attempt < 80; attempt++) { if (driverError) throw driverError; try { await command('/status', undefined, 'GET'); break; } catch { await sleep(100); } }
  const capabilities = await openSession(); evidence.browser = capabilities.browserVersion;
  const archive = join(run, 'detect-expert-permanent.xpi'); writeFileSync(archive, archiveProduction(extension));
  assert.equal(await wd('/moz/addon/install', { path: archive, temporary: false }), FIREFOX_ID); evidence.permanentInstall = true;
  await wd('/url', { url: origin + '/baseline' }); await waitFor('return Boolean(window.__earlySamples?.length);');
  const fixtureWindow = await wd('/window', undefined, 'GET'); evidence.native = await script('return __earlySamples[0];');
  assert.notEqual(evidence.native.direct.cpu, EARLY_EXPECTED.cpu);
  const uiWindow = (await wd('/window/new', { type: 'tab' })).handle; await wd('/window', { handle: uiWindow });
  await wd('/url', { url: 'moz-extension://' + uuid + '/protection.html' });
  await waitFor('return Boolean(document.querySelector("[data-api-early-grant]"));');
  const grant = await wd('/element', { using: 'css selector', value: '[data-api-early-grant]' }); await wd('/element/' + grant['element-6066-11e4-a52e-4f735466cecf'] + '/click', {});
  await waitFor('return typeof browser.userScripts?.getScripts === "function";');
  await send({ schemaVersion: 1, type: 'ui-data-consent-set', version: 1, accepted: true }); await send({ schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'all-sites' });
  const before = await send({ schemaVersion: 1, type: 'ui-api-config-get', tabId: null }); assert.equal(before.type, 'api-config-state'); assert.equal(before.earlyAccess, 'ready');
  const saved = await send({ schemaVersion: 1, type: 'ui-api-config-set', tabId: null, expectedRevision: before.revision, configuration: configureEarlyValues(before) }); assert.equal(saved.type, 'api-config-state'); assert.equal(saved.registration, 'ready');
  await wd('/window', { handle: fixtureWindow }); await wd('/url', { url: origin + '/first-visit' }); await waitFor('return window.__earlySamples?.length >= 5;');
  evidence.firstVisit = { samples: await script('return __earlySamples;') }; evidence.firstVisit.leaks = earlyLeaks(evidence.firstVisit.samples); assert.deepEqual(evidence.firstVisit.leaks, []);
  await wd('/window', { handle: uiWindow });
  const updated = await send({ schemaVersion: 1, type: 'ui-api-config-set', tabId: null, expectedRevision: saved.revision, configuration: configureEarlyValues(saved, EARLY_RECONFIGURED) }); assert.equal(updated.type, 'api-config-state'); assert.equal(updated.registration, 'ready');
  evidence.scriptsBeforeRestart = await wd('/execute/async', { script: 'const done=arguments[arguments.length-1];browser.userScripts.getScripts().then(scripts=>done(scripts.map(script=>script.id)));', args: [] }); assert.ok(evidence.scriptsBeforeRestart.length > 0);
  await command('/session/' + session, undefined, 'DELETE'); session = null;
  const installed = JSON.parse(readFileSync(join(profile, 'addons.json'), 'utf8')).addons.find(addon => addon.id === FIREFOX_ID);
  assert.ok(installed); assert.equal(installed.temporarilyInstalled, false); assert.equal(installed.active, true);
  evidence.persistedAddon = { id: installed.id, active: installed.active, temporarilyInstalled: installed.temporarilyInstalled, signedState: installed.signedState };
  evidence.browserAfterRestart = (await openSession()).browserVersion;
  // No addon install, extension UI, registration reads, or worker-ready wait before this navigation.
  await wd('/url', { url: origin + '/cold-start' }); await waitFor('return window.__earlySamples?.length >= 5;');
  evidence.coldStart = { samples: await script('return __earlySamples;') }; evidence.coldStart.leaks = earlyLeaks(evidence.coldStart.samples, EARLY_RECONFIGURED);
  assert.equal(evidence.coldStart.samples[0].label, '/cold-start:first-inline'); assert.deepEqual(evidence.coldStart.leaks, []);
  await wd('/url', { url: 'moz-extension://' + uuid + '/options.html' }); await waitFor('return typeof browser?.runtime?.sendMessage === "function";');
  const after = await send({ schemaVersion: 1, type: 'ui-api-config-get', tabId: null }); assert.equal(after.type, 'api-config-state'); assert.deepEqual(after.configuration, updated.configuration); assert.equal(after.earlyAccess, 'ready');
  evidence.scriptsAfterRestart = await wd('/execute/async', { script: 'const done=arguments[arguments.length-1];browser.userScripts.getScripts().then(scripts=>done(scripts.map(script=>script.id)));', args: [] }); assert.deepEqual(evidence.scriptsAfterRestart, evidence.scriptsBeforeRestart);
  evidence.passed = true; console.log('API Custom cold Firefox Nightly ' + evidence.browser + ': PASS (' + evidence.coldStart.samples.length + ' cold snapshots)');
} catch (error) { evidence.failure = error.stack ?? String(error); process.exitCode = 1; console.error('API Custom cold Firefox Nightly: FAIL ' + error.message); }
finally {
  if (session) try { await command('/session/' + session, undefined, 'DELETE'); } catch {}
  driver?.kill(); log.end(); server.closeAllConnections(); if (server.listening) await new Promise(done => server.close(done));
  const path = join(artifact, 'api-custom-cold-firefox-nightly.json'); writeFileSync(path, JSON.stringify(evidence, null, 2) + '\n'); console.log('Firefox Nightly cold evidence: ' + path);
}
