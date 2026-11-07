// Real installed Firefox + official dummy Turnstile widgets on an owned server.
// No production challenge solving, webdriver concealment, downloads or builds.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { archiveProduction, FIREFOX_ID } from '../build-production.mjs';
import { TURNSTILE_CASES as cases, TURNSTILE_TEST_REFERENCE, turnstileFixture, safeTurnstileResource, turnstileFixtureFacts } from './cloudflare-turnstile-fixture.mjs';

const root = resolve(import.meta.dirname, '../..');
const argument = name => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; };
const input = resolve(argument('--dist') ?? join(root, 'dist/firefox'));
const timeout = Number(argument('--timeout') ?? 45000);
assert.ok(Number.isSafeInteger(timeout) && timeout >= 5000 && timeout <= 120000);
const artifact = resolve(argument('--output') ?? join(root, 'test-results/production-1.1.0/cloudflare-turnstile-firefox.json'));
const driverPath = process.env.GECKODRIVER_BINARY ?? join(root, '.tmp/firefox/tools/geckodriver.exe');
assert.ok(existsSync(driverPath), 'Existing geckodriver is required; nothing is downloaded');
let binary = process.env.FIREFOX_BINARY;
if (!binary && process.platform === 'win32') binary = spawnSync('powershell.exe', ['-NoProfile', '-Command', "(Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\firefox.exe').'(default)'"], { encoding: 'utf8', windowsHide: true }).stdout.trim();
assert.ok(binary, 'Set FIREFOX_BINARY to the installed executable');
mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/cloudflare-turnstile-firefox-')), profile = join(run, 'profile'), extension = join(run, 'extension');
mkdirSync(profile);
const uuid = randomUUID(), base = 'moz-extension://' + uuid + '/', host = 'cf-fixture.example.com';
const prefs = { 'extensions.webextensions.uuids': JSON.stringify({ [FIREFOX_ID]: uuid }), 'browser.shell.checkDefaultBrowser': false,
  'browser.startup.homepage_override.mstone': 'ignore', 'browser.startup.page': 0, 'browser.newtabpage.enabled': false,
  'datareporting.policy.dataSubmissionEnabled': false, 'toolkit.telemetry.enabled': false, 'app.update.auto': false,
  'network.proxy.type': 0, 'network.dns.localDomains': host, 'network.dns.disablePrefetch': true,
  'extensions.webextOptionalPermissionPrompts': false };
writeFileSync(join(profile, 'user.js'), Object.entries(prefs).map(([key, value]) => 'user_pref(' + JSON.stringify(key) + ', ' + JSON.stringify(value) + ');').join('\n'));
const evidence = { at: new Date().toISOString(), result: 'RUNNING', scope: 'official dummy widgets only; production challenge solving untested',
  reference: TURNSTILE_TEST_REFERENCE, run, input, browser: null, hashes: {}, modes: [], blocked: null, failures: [], networkObservation: 'sdk/callback-only' };
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/ready') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Owned Turnstile setup</title>Owned setup'); return; }
  const pro = request.url.startsWith('/pro/'), spec = cases.find(row => request.url === (pro ? '/pro/' : '/') + row.id);
  if (!spec) { response.writeHead(404); response.end(); return; }
  response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(turnstileFixture(spec, { awaitPro: pro }));
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://' + host + ':' + server.address().port;
let endpoint, session, driver, driverError, socket, settingsHandle, fixtureHandle, fixtureTabId, activeResources, phase = 'baseline';
const pause = ms => new Promise(done => setTimeout(done, ms));
async function command(path, body, method = 'POST') {
  const response = await fetch(endpoint + path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), signal: AbortSignal.timeout(30000) });
  const value = (await response.json()).value;
  // Do not persist the driver's arbitrary error message or SDK exception text.
  if (!response.ok || typeof value?.error === 'string') throw Error('WebDriver ' + (value?.error ?? response.status)); return value;
}
const wd = (path, body, method) => command('/session/' + session + path, body, method);
const script = (source, args = []) => wd('/execute/sync', { script: source, args });
const asyncScript = (source, args = []) => wd('/execute/async', { script: source, args });
async function inSettings(action) { await wd('/window', { handle: settingsHandle }); return action(); }
const send = value => inSettings(() => asyncScript('const done=arguments[arguments.length-1];browser.runtime.sendMessage(arguments[0]).then(done,()=>done({type:"test-send-error"}));', [{ schemaVersion: 1, ...value }]));
async function until(probe, label, milliseconds = 15000) {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) { const result = await probe(); if (result) return result; await pause(80); }
  throw Error(label);
}
async function bidi(address) {
  if (!address) return;
  socket = new WebSocket(address);
  await Promise.race([new Promise((done, reject) => { socket.onopen = done; socket.onerror = () => reject(Error('BiDi unavailable')); }), pause(3000).then(() => { throw Error('BiDi connection timeout'); })]);
  socket.onmessage = event => {
    let value; try { value = JSON.parse(event.data); } catch { return; }
    if (!activeResources || !['network.responseCompleted', 'network.fetchError'].includes(value.method)) return;
    const raw = value.params?.request?.url;
    if (typeof raw !== 'string' || !/^https?:/.test(raw)) return;
    const safe = safeTurnstileResource(raw, host), status = value.method === 'network.fetchError' ? 'request-failed' : value.params?.response?.status;
    if (typeof status !== 'number' && status !== 'request-failed') return;
    evidence.networkObservation = 'native-WebDriver-BiDi';
    const key = safe.host + safe.path + status, entry = activeResources.get(key) ?? { ...safe, status, count: 0 }; entry.count++; activeResources.set(key, entry);
  };
  socket.send(JSON.stringify({ id: 1, method: 'session.subscribe', params: { events: ['network.responseCompleted', 'network.fetchError'] } }));
}
async function metadata() {
  const [scope, api, pro] = await Promise.all([send({ type: 'ui-get-scope' }), send({ type: 'ui-api-config-get', tabId: null }), send({ type: 'ui-pro-get' })]);
  const browser = await inSettings(() => asyncScript('const done=arguments[arguments.length-1];(async()=>({dnrAvailable:typeof browser.declarativeNetRequest==="object",registered:(await browser.scripting.getRegisteredContentScripts()).map(({id,runAt,world,allFrames})=>({id,runAt,world,allFrames})),userScripts:typeof browser.userScripts?.getScripts==="function"?(await browser.userScripts.getScripts()).map(({id,runAt,world,allFrames})=>({id,runAt,world,allFrames})):[]}))().then(done,()=>done({error:true}));'));
  assert.equal(browser.error, undefined); assert.equal(browser.dnrAvailable, false, 'Firefox module is unavailable, never represented as active');
  return { observation: scope.scope?.scopeMode, api: { enabled: api.configuration?.enabled, antidetectEnabled: api.configuration?.antidetectEnabled, revision: api.revision, registration: api.registration, earlyAccess: api.earlyAccess },
    pro: { recording: pro.session?.status === 'recording' }, firewall: { supported: false, reason: 'Firefox build has no DNR module' }, ...browser };
}
async function runWidgets(mode, diagnosticOnly = false) {
  phase = mode; console.log('mode ' + mode);
  const record = { mode, diagnosticOnly, metadata: settingsHandle ? await metadata() : null, results: [] }; evidence.modes.push(record);
  if (record.metadata) {
    assert.equal(record.metadata.observation, mode === 'installed-observation-off' ? 'off' : 'all-sites');
    assert.equal(record.metadata.api.enabled, ['api-enabled-empty-bypass', 'api-all-off', 'hardware16-custom', 'intentional-user-agent-on'].includes(mode));
    assert.equal(record.metadata.api.antidetectEnabled, mode === 'hardware16-custom');
    if (mode === 'hardware16-custom') assert.equal(record.metadata.api.registration, 'ready', 'Custom must have a real active native registration');
    assert.equal(record.metadata.api.earlyAccess, 'ready'); assert.notEqual(record.metadata.api.registration, 'error');
    assert.equal(record.metadata.pro.recording, mode === 'pro-recording');
  }
  // All widgets stay in the actual Pro start tab. New unrelated tabs would not
  // receive a domain recording's controls even while the session says recording.
  for (const spec of cases) {
    await wd('/window', { handle: fixtureHandle }); activeResources = new Map();
    await wd('/url', { url: origin + (mode === 'pro-recording' ? '/pro/' : '/') + spec.id });
    let facts; const end = Date.now() + timeout;
    // Firefox's WebDriver sandbox owns separate ECMAScript intrinsics. Invoke
    // the function created by fixture HTML, so Math reflects the actual page.
    do { facts = await script('return window.fixtureFacts();');
      if (facts.success || facts.error || facts.renderError || facts.timeout || facts.proReadyTimedOut) break; await pause(150);
    } while (Date.now() < end);
    const outcome = facts.success ? 'success' : facts.error ? 'error' : facts.renderError ? 'render-error' : facts.timeout ? 'timeout-callback' : facts.sdkLoaded ? 'no-callback' : 'sdk-unavailable';
    const result = { id: spec.id, expected: spec.expected, outcome, ...facts, resources: [...activeResources.values()] }; activeResources = null;
    record.results.push(result); console.log('  ' + spec.id + ': ' + outcome);
    if (mode === 'baseline' && (!facts.sdkLoaded || !facts.rendered || !['success', 'error'].includes(outcome))) { evidence.blocked = { mode, case: spec.id, reason: outcome }; return false; }
    if (!diagnosticOnly && outcome !== spec.expected) evidence.failures.push({ mode, case: spec.id, expected: spec.expected, outcome });
    if (mode === 'baseline') assert.equal(facts.webdriver, true, 'Automation remains visible');
    if (mode === 'hardware16-custom') { assert.equal(facts.initialCpuCustom16, true, 'Custom must apply before the first page inline script and SDK'); assert.equal(facts.cpuCustom16, true, 'Custom must actually apply'); }
    if (mode === 'intentional-user-agent-on') assert.equal(facts.userAgentWithheld, true, 'The intentionally blocking mode must remove the getter');
    if (mode === 'pro-recording') {
      const pro = await send({ type: 'ui-pro-get', tabId: fixtureTabId });
      const current = await send({ type: 'ui-get-report', tabId: fixtureTabId });
      const tracked = pro.session?.pages?.find(row => row.tabId === fixtureTabId && row.documentKey === current.report?.documentKey && row.endedAt === null);
      result.proTrackedPage = Boolean(tracked); result.proReportCount = tracked?.reports?.length ?? 0;
      assert.equal(result.proTrackedPage, true); assert.equal(facts.proMathWrapped, true, 'Pro-only Math hooks must really be active');
      assert.equal(facts.proReadyBeforeSdk, true, 'Pro must be active before loading the SDK'); assert.equal(facts.proMathAtRender, true, 'Pro must be active before turnstile.render');
    }
  }
  return true;
}
async function setApi(enabled, mode = 'bypass', id = null) {
  const state = await send({ type: 'ui-api-config-get', tabId: null });
  const configuration = { ...state.configuration, enabled, antidetectEnabled: enabled && mode === 'custom', preset: 'custom', sites: [], apis: state.configuration.apis.map(row => ({ ...row,
    mode: id === null ? mode : row.id === id ? mode : 'bypass', selected: row.id === id && mode === 'custom' ? { kind: 'value', value: 16 } : { kind: 'unset' } })) };
  const saved = await send({ type: 'ui-api-config-set', tabId: null, expectedRevision: state.revision, configuration });
  assert.equal(saved.type, 'api-config-state'); assert.notEqual(saved.registration, 'error');
  assert.equal(saved.configuration.enabled, enabled); assert.equal(saved.configuration.antidetectEnabled, enabled && mode === 'custom'); return saved;
}
try {
  const portServer = createServer(); await new Promise(done => portServer.listen(0, '127.0.0.1', done));
  const port = portServer.address().port; await new Promise(done => portServer.close(done)); endpoint = 'http://127.0.0.1:' + port;
  driver = spawn(driverPath, ['--host', '127.0.0.1', '--port', String(port), '--profile-root', run, '--log', 'error'], { cwd: root, windowsHide: true, stdio: 'ignore' });
  driver.once('error', error => { driverError = error; });
  await until(async () => { if (driverError) throw driverError; try { return await command('/status', undefined, 'GET'); } catch { return false; } }, 'geckodriver ready');
  const opened = await command('/session', { capabilities: { alwaysMatch: { browserName: 'firefox', pageLoadStrategy: 'eager', webSocketUrl: true,
    'moz:firefoxOptions': { binary, args: ['-headless', '-no-remote', '-profile', profile] } } } });
  session = opened.sessionId; evidence.browser = opened.capabilities.browserVersion;
  await wd('/timeouts', { script: 15000, pageLoad: timeout });
  try { await bidi(opened.capabilities.webSocketUrl); } catch { socket?.close(); evidence.networkObservation = 'sdk/callback-only'; }
  fixtureHandle = await wd('/window', undefined, 'GET');
  if (!await runWidgets('baseline')) evidence.result = 'BLOCKED';
  else if (process.argv.includes('--baseline-only')) evidence.result = evidence.failures.length ? 'FAIL' : 'PASS';
  else {
    cpSync(input, extension, { recursive: true });
    evidence.hashes = Object.fromEntries(['manifest.json', 'background.js', 'hook.early.js', 'hook.main.js', 'api-configuration-controller.js'].map(file => [file, createHash('sha256').update(readFileSync(join(extension, file))).digest('hex')]));
    const archive = join(run, 'detect-expert-turnstile.xpi'); writeFileSync(archive, archiveProduction(extension)); assert.equal(await wd('/moz/addon/install', { path: archive, temporary: true }), FIREFOX_ID);
    settingsHandle = (await wd('/window/new', { type: 'tab' })).handle; await wd('/window', { handle: settingsHandle });
    await wd('/url', { url: base + 'options.html#api' });
    await until(() => script('return Boolean(document.querySelector("[data-api-early-grant]"));'), 'actual optional userScripts setup button');
    const grant = await wd('/element', { using: 'css selector', value: '[data-api-early-grant]' });
    await wd('/element/' + grant['element-6066-11e4-a52e-4f735466cecf'] + '/click', {});
    await until(async () => (await send({ type: 'ui-api-config-get', tabId: null })).earlyAccess === 'ready', 'Firefox optional userScripts must really be granted');
    assert.equal((await send({ type: 'ui-data-consent-set', version: 1, accepted: true })).accepted, true);
    assert.equal((await send({ type: 'ui-set-scope', scopeMode: 'off' })).type, 'scope');
    await setApi(false); await runWidgets('installed-observation-off');
    assert.equal((await send({ type: 'ui-set-scope', scopeMode: 'all-sites' })).type, 'scope'); await runWidgets('light');
    await wd('/window', { handle: fixtureHandle }); await wd('/url', { url: origin + '/ready' });
    fixtureTabId = await inSettings(() => asyncScript('const done=arguments[arguments.length-1];browser.tabs.query({}).then(rows=>done(rows.find(row=>row.url===arguments[0])?.id));', [origin + '/ready']));
    assert.ok(Number.isSafeInteger(fixtureTabId));
    const pro = await send({ type: 'ui-pro-start', tabId: fixtureTabId }); assert.equal(pro.session?.status, 'recording');
    await runWidgets('pro-recording'); await send({ type: 'ui-pro-stop', sessionId: pro.session.id });
    await setApi(true); await runWidgets('api-enabled-empty-bypass');
    await setApi(true, 'off'); await runWidgets('api-all-off');
    await setApi(true, 'custom', 'hardware-concurrency'); await runWidgets('hardware16-custom');
    await setApi(true, 'on', 'navigator-user-agent'); await runWidgets('intentional-user-agent-on', true);
    await setApi(false); await send({ type: 'ui-set-scope', scopeMode: 'off' });
    await inSettings(() => wd('/url', { url: base + 'options.html#protect' }));
    await until(() => script('return Boolean(document.querySelector("[data-management-unavailable=firewall]"));'), 'Firefox Firewall stub');
    evidence.firewallUnavailableVisible = true; evidence.finalMetadata = await metadata();
    evidence.result = evidence.failures.length ? 'FAIL' : 'PASS';
  }
} catch (error) {
  evidence.result = 'FAIL'; evidence.failure = { phase, name: error.name, message: String(error.message).replace(/https?:\/\/\S+/g, '[URL omitted]').slice(0, 250) }; console.error('FAIL: ' + evidence.failure.message);
} finally {
  socket?.close(); if (session) try { await command('/session/' + session, undefined, 'DELETE'); } catch { /* Retain original result. */ }
  driver?.kill(); server.closeAllConnections(); await new Promise(done => server.close(done));
  mkdirSync(resolve(artifact, '..'), { recursive: true }); writeFileSync(artifact, JSON.stringify(evidence, null, 2) + '\n'); console.log(evidence.result + ': ' + artifact);
}
if (evidence.result === 'FAIL') process.exitCode = 1;
if (evidence.result === 'BLOCKED') process.exitCode = 2;
