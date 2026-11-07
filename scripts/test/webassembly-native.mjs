// ADR-059: packaged static Guard files, native registration, and first-inline owned Wasm fixtures.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { cpSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { archiveProduction, FIREFOX_ID } from '../build-production.mjs';
import { WASM_SURFACES } from '../../packages/contracts/src/webassembly-apis.mjs';
import { API_CONFIG_CATALOG, API_CONFIG_CATALOG_V1, API_CONFIGURATION_CATALOG_VERSION } from '../../packages/contracts/src/api-configuration.mjs';
import { installPersistentChromeExtension } from './api-custom-early-native.mjs';

const root = resolve(import.meta.dirname, '../..');
const option = (name, fallback) => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1]; };
const selectedBrowser = option('--browser', 'both'); assert.ok(['chrome', 'firefox', 'both'].includes(selectedBrowser));
const output = resolve(option('--output', join(root, 'test-results/production-1.1.0/webassembly-native.json')));
const pause = milliseconds => new Promise(done => setTimeout(done, milliseconds));
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const evidence = { at: new Date().toISOString(), result: 'RUNNING', scope: 'Owned loopback Wasm fixtures only; no user profile or page inputs', browsers: [] };
let origin;

// All input and binary modules here belong to this fixture. The product observes
// none of their contents; the recorded result is an enum, never a Wasm value.
async function fixtureProbe(surface) {
  const initialInline = document.readyState === 'loading' && document.currentScript !== null;
  const W = globalThis.WebAssembly;
  if (!W) return { feature: surface.feature, initialInline, namespace: false, available: false };
  const constructor = surface.owner && W[surface.owner];
  const target = surface.target === 'namespace' ? W : surface.target === 'static' ? constructor : constructor?.prototype;
  const descriptor = target && Object.getOwnPropertyDescriptor(target, surface.property);
  const member = descriptor && (surface.kind === 'get' || surface.kind === 'set' ? descriptor[surface.kind] : descriptor.value);
  if (typeof member !== 'function') return { feature: surface.feature, initialInline, namespace: true, available: false };
  const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
  const callableBytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 127, 3, 2, 1, 0, 7, 5, 1, 1, 102, 0, 0, 10, 6, 1, 4, 0, 65, 42, 11]);
  let positiveControl = false;
  try { positiveControl = surface.feature === 'webassembly-validate' ? new W.Module(bytes) instanceof W.Module : W.validate(bytes) === true; } catch {}
  let stage = 'setup';
  try {
    let receiver, args = [], construct = false;
    if (surface.target === 'namespace') {
      receiver = W;
      if (['compile', 'instantiate', 'validate', 'Module'].includes(surface.property)) args = [bytes];
      else if (['compileStreaming', 'instantiateStreaming'].includes(surface.property)) args = [new Response(bytes, { headers: { 'Content-Type': 'application/wasm' } })];
      else if (surface.property === 'Instance') args = [new W.Module(bytes)];
      else if (surface.property === 'Memory') args = [{ initial: 1, maximum: 2 }];
      else if (surface.property === 'Table') args = [{ element: 'anyfunc', initial: 1, maximum: 3 }];
      else if (surface.property === 'Global') args = [{ value: 'i32', mutable: true }, 0];
      else if (surface.property === 'Tag') args = [{ parameters: ['i32'] }];
      else if (surface.property === 'Exception') args = [new W.Tag({ parameters: ['i32'] }), [7], { traceStack: true }];
      else if (surface.property === 'Suspending') args = [() => Promise.resolve(1)];
      else if (surface.property === 'promising') args = [new W.Instance(new W.Module(callableBytes)).exports.f];
      construct = surface.kind === 'construct';
    } else if (surface.target === 'static') {
      receiver = constructor; args = [new W.Module(bytes)];
      if (surface.property === 'customSections') args.push('owned-fixture');
    } else if (surface.owner === 'Memory') {
      receiver = new W.Memory({ initial: 1, maximum: 3 }); if (surface.property === 'grow') args = [1];
    } else if (surface.owner === 'Instance') receiver = new W.Instance(new W.Module(bytes));
    else if (surface.owner === 'Table') {
      receiver = new W.Table({ element: 'anyfunc', initial: 1, maximum: 3 });
      args = surface.property === 'grow' ? [1] : surface.property === 'set' ? [0, null] : surface.property === 'get' ? [0] : [];
    } else if (surface.owner === 'Global') { receiver = new W.Global({ value: 'i32', mutable: true }, 0); if (surface.kind === 'set') args = [1]; }
    else if (surface.owner === 'Tag') receiver = new W.Tag({ parameters: ['i32'] });
    else if (surface.owner === 'Exception') {
      const tag = new W.Tag({ parameters: ['i32'] }); receiver = new W.Exception(tag, [7], { traceStack: true });
      args = surface.property === 'is' ? [tag] : surface.property === 'getArg' ? [tag, 0] : [];
    }
    stage = 'target'; let result;
    // Normal property syntax deliberately covers own Exception.stack accessors.
    if (surface.kind === 'get') result = receiver[surface.property];
    else if (surface.kind === 'set') { receiver[surface.property] = args[0]; result = undefined; }
    else result = construct ? Reflect.construct(member, args) : Reflect.apply(member, receiver, args);
    if (surface.kind === 'async-call') await result;
    return { feature: surface.feature, initialInline, namespace: true, available: true, positiveControl, outcome: 'allowed' };
  } catch (error) {
    return { feature: surface.feature, initialInline, namespace: true, available: true, positiveControl, stage,
      outcome: error?.name === 'SecurityError' ? 'denied' : 'error', errorName: error?.name ?? 'unknown' };
  }
}
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return; }
  const match = /^\/probe\/(all|parent|[0-9]+)$/.exec(request.url);
  if (!match) { response.writeHead(404); response.end(); return; }
  const surfaces = match[1] === 'parent' ? [WASM_SURFACES[0]] : match[1] === 'all' ? WASM_SURFACES : [WASM_SURFACES[Number(match[1])]];
  if (!surfaces[0]) { response.writeHead(404); response.end(); return; }
  const source = 'window.__wasmReady=false;Promise.all(' + JSON.stringify(surfaces) + '.map(' + fixtureProbe.toString() + ')).then(rows=>{window.__wasmResults=rows;window.__wasmReady=true;},error=>{window.__wasmFailure=error.name;window.__wasmReady=true;});';
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><html><head><meta charset="utf-8"><script>' + source.replaceAll('</script', '<\\/script') + '</script></head><body>Owned WebAssembly Guard fixture</body></html>');
});

async function chromeBrowser(extension, run, record) {
  const context = await chromium.launchPersistentContext(join(run, 'profile'), { channel: 'chromium', headless: true,
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging', '--no-proxy-server', '--host-resolver-rules=MAP wasm-guard.example.com 127.0.0.1'] });
  let ui, fixture;
  try {
    await context.route('**/*', route => { const url = new URL(route.request().url()); return ['http:', 'https:'].includes(url.protocol) && url.origin !== origin ? route.abort() : route.continue(); });
    record.version = context.browser().version(); const id = await installPersistentChromeExtension(context, extension, record);
    ui = await context.newPage(); await ui.goto('chrome-extension://' + id + '/options.html#api'); fixture = await context.newPage();
    return {
      async send(message) { return ui.evaluate(message => chrome.runtime.sendMessage(message), message); },
      async registrations() { return ui.evaluate(() => chrome.scripting.getRegisteredContentScripts()); },
      async fixtureTabId() { return ui.evaluate(async origin => (await chrome.tabs.query({})).find(tab => tab.url === origin + '/probe/all')?.id, origin); },
      async importPrevious(source) { return ui.evaluate(async source => (await import(chrome.runtime.getURL('api-configuration.js'))).importApiConfiguration(source), source); },
      async probe(path) { await fixture.goto(origin + path); await fixture.waitForFunction(() => window.__wasmReady === true); return fixture.evaluate(() => { if (window.__wasmFailure) throw Error(window.__wasmFailure); return window.__wasmResults; }); },
      async close() { await context.close(); }
    };
  } catch (error) { await context.close(); throw error; }
}

async function firefoxBrowser(extension, run, record) {
  const driverPath = process.env.GECKODRIVER_BINARY ?? join(root, '.tmp/firefox/tools/geckodriver.exe'); assert.ok(existsSync(driverPath));
  let binary = process.env.FIREFOX_BINARY;
  if (!binary && process.platform === 'win32') binary = spawnSync('powershell.exe', ['-NoProfile', '-Command', "(Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\firefox.exe').'(default)'"], { encoding: 'utf8', windowsHide: true }).stdout.trim();
  assert.ok(binary, 'Installed Firefox is required; this test downloads no tools');
  const profile = join(run, 'profile'); mkdirSync(profile, { recursive: true });
  const uuid = randomUUID(), preferences = { 'extensions.webextensions.uuids': JSON.stringify({ [FIREFOX_ID]: uuid }),
    'browser.shell.checkDefaultBrowser': false, 'browser.startup.homepage_override.mstone': 'ignore', 'browser.startup.page': 0,
    'datareporting.policy.dataSubmissionEnabled': false, 'toolkit.telemetry.enabled': false, 'app.update.auto': false,
    'network.proxy.type': 0, 'network.dns.localDomains': 'wasm-guard.example.com', 'network.dns.disablePrefetch': true, 'extensions.webextOptionalPermissionPrompts': false };
  writeFileSync(join(profile, 'user.js'), Object.entries(preferences).map(([key, value]) => 'user_pref(' + JSON.stringify(key) + ', ' + JSON.stringify(value) + ');').join('\n'));
  const portServer = createServer(); await new Promise(done => portServer.listen(0, '127.0.0.1', done)); const port = portServer.address().port; await new Promise(done => portServer.close(done));
  const endpoint = 'http://127.0.0.1:' + port, log = createWriteStream(join(run, 'geckodriver.log'));
  const driver = spawn(driverPath, ['--host', '127.0.0.1', '--port', String(port), '--profile-root', run, '--log', 'error'], { cwd: root, windowsHide: true });
  let driverError, session; driver.once('error', error => { driverError = error; }); driver.stdout.pipe(log); driver.stderr.pipe(log);
  async function command(path, body, method = 'POST') {
    const response = await fetch(endpoint + path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), signal: AbortSignal.timeout(30000) });
    const value = (await response.json()).value; if (!response.ok || value?.error) throw Error(JSON.stringify(value)); return value;
  }
  const wd = (path, body, method) => command('/session/' + session + path, body, method);
  const script = (source, args = []) => wd('/execute/sync', { script: source, args });
  const asyncScript = (source, args = []) => wd('/execute/async', { script: source, args });
  async function close() { if (session) try { await command('/session/' + session, undefined, 'DELETE'); } catch {} driver.kill(); log.end(); }
  try {
    for (let n = 0; n < 80; n++) { if (driverError) throw driverError; try { await command('/status', undefined, 'GET'); break; } catch { await pause(100); } }
    const opened = await command('/session', { capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': { binary, args: ['-headless', '-no-remote', '-profile', profile] } } } });
    session = opened.sessionId; record.version = opened.capabilities.browserVersion;
    const archive = join(run, 'extension.xpi'); writeFileSync(archive, archiveProduction(extension)); assert.equal(await wd('/moz/addon/install', { path: archive, temporary: true }), FIREFOX_ID);
    await wd('/url', { url: 'moz-extension://' + uuid + '/options.html#api' });
    const ui = await wd('/window', undefined, 'GET'), fixture = (await wd('/window/new', { type: 'tab' })).handle;
    return {
      async send(message) { await wd('/window', { handle: ui }); return asyncScript('const done=arguments[arguments.length-1];browser.runtime.sendMessage(arguments[0]).then(done,e=>done({error:e.name}));', [message]); },
      async registrations() { await wd('/window', { handle: ui }); return asyncScript('const done=arguments[arguments.length-1];browser.scripting.getRegisteredContentScripts().then(done,e=>done({error:e.name}));'); },
      async fixtureTabId() { await wd('/window', { handle: ui }); return asyncScript('const done=arguments[arguments.length-1];browser.tabs.query({}).then(rows=>done(rows.find(t=>t.url===arguments[0]+"/probe/all")?.id??null));', [origin]); },
      async importPrevious(source) { await wd('/window', { handle: ui }); return asyncScript('const done=arguments[arguments.length-1];import(browser.runtime.getURL("api-configuration.js")).then(m=>done(m.importApiConfiguration(arguments[0])),e=>done({error:e.name}));', [source]); },
      async probe(path) {
        await wd('/window', { handle: fixture }); await wd('/url', { url: origin + path });
        for (let n = 0; n < 100; n++) { if (await script('return window.__wasmReady===true;')) return script('if(window.__wasmFailure)throw Error(window.__wasmFailure);return window.__wasmResults;'); await pause(50); }
        throw Error('Firefox first-inline Wasm fixture did not finish');
      }, close
    };
  } catch (error) { await close(); throw error; }
}

function assertAllowed(rows, baseline) {
  assert.equal(rows.length, WASM_SURFACES.length);
  for (const row of rows) {
    const native = baseline.find(entry => entry.feature === row.feature);
    assert.equal(row.initialInline, true, row.feature + ': fixture must execute in first inline');
    assert.equal(row.namespace, true); assert.equal(row.available, native.available, row.feature + ': missing APIs stay missing');
    if (row.available) { assert.equal(row.outcome, 'allowed', JSON.stringify(row)); assert.equal(row.positiveControl, true, row.feature); }
  }
}
async function matrix(browser, adapter, record) {
  let state = await adapter.send({ schemaVersion: 1, type: 'ui-api-config-get', tabId: null }); assert.equal(state.type, 'api-config-state');
  assert.equal(state.configuration.catalogVersion, API_CONFIGURATION_CATALOG_VERSION); assert.equal(state.configuration.apis.length, API_CONFIG_CATALOG.length);
  assert.equal(state.configuration.apis.filter(row => row.id.startsWith('webassembly-')).every(row => row.mode === 'bypass' && !row.customSupported), true);
  record.baseline = await adapter.probe('/probe/all'); assertAllowed(record.baseline, record.baseline);
  record.available = record.baseline.filter(row => row.available).length;
  assert.ok(record.available >= 30, 'Native fixture must exercise actual Wasm operations, not only unsupported cases');
  assert.equal((await adapter.send({ schemaVersion: 1, type: 'ui-data-consent-set', version: 1, accepted: true })).accepted, true);
  assert.equal((await adapter.send({ schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'all-sites' })).type, 'scope');
  const old = structuredClone(state.configuration); old.formatVersion = 1; old.catalogVersion = 1;
  delete old.webrtcNetworkPolicy; delete old.fingerprintProfiles; delete old.antidetectEnabled;
  old.apis = API_CONFIG_CATALOG_V1.map(entry => ({ ...structuredClone(entry), mode: 'bypass', userValues: [], selected: { kind: 'unset' }, settings: {} }));
  const cpu = old.apis.find(row => row.id === 'hardware-concurrency'); cpu.selected = { kind: 'value', value: 16 };
  cpu.userValues = [{ id: 'fixture-cpu', label: 'Owned fixture CPU', value: { kind: 'value', value: 16 } }];
  old.sites = [{ host: 'disabled.example', disabled: true, apis: old.apis.map(row => ({ id: row.id, mode: row.id === 'hardware-concurrency' ? 'custom' : 'bypass', selected: row.id === 'hardware-concurrency' ? { kind: 'value', value: 8 } : { kind: 'unset' }, settings: {} })) }];
  const imported = await adapter.importPrevious(JSON.stringify(old)); assert.equal(imported.ok, true); assert.equal(imported.migrated, true);
  state = await adapter.send({ schemaVersion: 1, type: 'ui-api-config-set', tabId: null, expectedRevision: state.revision, configuration: imported.value }); assert.equal(state.type, 'api-config-state');
  assert.equal(state.configuration.apis.find(row => row.id === 'hardware-concurrency').userValues.length, 1);
  assert.equal(state.configuration.sites[0].disabled, true); assert.equal(state.configuration.sites[0].apis.length, API_CONFIG_CATALOG.length);
  record.checks.push('shipped importer upgrades strict v1 full catalogue, saved values and disabled exact-host Custom scope');
  async function save(modes = {}, enabled = true, sites = []) {
    const configuration = { ...state.configuration, enabled, preset: 'custom', sites,
      apis: state.configuration.apis.map(row => ({ ...row, mode: modes[row.id] ?? 'bypass' })) };
    state = await adapter.send({ schemaVersion: 1, type: 'ui-api-config-set', tabId: null, expectedRevision: state.revision, configuration });
    assert.equal(state.type, 'api-config-state', JSON.stringify(state)); return state;
  }
  const onCases = []; record.on = onCases;
  for (let index = 0; index < WASM_SURFACES.length; index++) {
    const surface = WASM_SURFACES[index]; await save({ [surface.feature]: 'on' });
    const registrations = await adapter.registrations(); assert.ok(Array.isArray(registrations));
    const registration = registrations.find(row => row.js?.includes('protection.' + surface.feature + '.js'));
    assert.ok(registration, surface.feature + ': actual static file registration');
    assert.equal(registration.runAt, 'document_start'); assert.equal(registration.allFrames, true); assert.equal(registration.world, 'MAIN');
    const [result] = await adapter.probe('/probe/' + index), native = record.baseline[index];
    assert.equal(result.initialInline, true); assert.equal(result.namespace, true); assert.equal(result.available, native.available);
    if (native.available) { assert.equal(result.outcome, 'denied', JSON.stringify(result)); assert.equal(result.stage, 'target', surface.feature); assert.equal(result.positiveControl, true, surface.feature + ': unrelated native API remains usable'); }
    onCases.push(result);
  }
  record.checks.push('all 37 packaged per-operation guards register in MAIN document_start; available native operations deny before first page script while unrelated native controls work');
  for (const mode of ['off', 'bypass']) {
    await save(Object.fromEntries(WASM_SURFACES.map(row => [row.feature, mode])));
    record[mode] = await adapter.probe('/probe/all'); assertAllowed(record[mode], record.baseline);
    record.checks.push(mode + ' permits all available native operations without synthesizing absent APIs');
  }
  const fixtureTabId = await adapter.fixtureTabId(); assert.ok(Number.isSafeInteger(fixtureTabId));
  const expectedOperations = new Set(WASM_SURFACES.filter((surface, index) => record.baseline[index].available).map(surface => surface.operation));
  const observed = new Set(); let report;
  // The documented startup queue is 32 keys. A 36-operation first-inline burst
  // can legitimately exceed it before the native bridge handshake. Retain this
  // fact, then use fresh single-operation documents; do not raise
  // production limits or replace first-inline Guard assertions with late reads.
  for (let attempt = 0; attempt < 100; attempt++) {
    report = await adapter.send({ schemaVersion: 1, type: 'ui-get-report', tabId: fixtureTabId });
    if (report?.report?.apiOperations?.length) break;
    await pause(50);
  }
  const burstOperations = new Set((report?.report?.apiOperations ?? []).map(row => row.apiOperation));
  const burstMissing = [...expectedOperations].filter(operation => !burstOperations.has(operation));
  for (let attempt = 0; burstMissing.length && !report?.report?.coverageFlags?.includes('budget-exceeded') && attempt < 100; attempt++) {
    await pause(50); report = await adapter.send({ schemaVersion: 1, type: 'ui-get-report', tabId: fixtureTabId });
  }
  record.startupObservation = { operations: report?.report?.apiOperations?.length ?? 0, missing: burstMissing, coverageState: report?.report?.coverageState,
    coverageFlags: report?.report?.coverageFlags ?? [], dropped: report?.report?.dropped };
  if (burstMissing.length) assert.ok(record.startupObservation.coverageFlags.includes('budget-exceeded'), 'startup burst loss must have an explicit observed coverage gap');
  let previousDocument = report?.report?.documentKey; assert.equal(typeof previousDocument, 'string');
  record.observationDocuments = [];
  for (let index = 0; index < WASM_SURFACES.length; index++) {
    if (!record.baseline[index].available) continue;
    const surface = WASM_SURFACES[index], [result] = await adapter.probe('/probe/' + index);
    assert.equal(result.initialInline, true); assert.equal(result.outcome, 'allowed');
    let counter = null;
    for (let attempt = 0; attempt < 100; attempt++) {
      report = await adapter.send({ schemaVersion: 1, type: 'ui-get-report', tabId: fixtureTabId });
      if (report?.report?.documentKey !== previousDocument) counter = report?.report?.apiOperations?.find(row => row.apiOperation === surface.operation && row.count > 0);
      if (counter) break;
      await pause(50);
    }
    assert.ok(counter, surface.operation + ': actual fresh-document sensor/bridge/SW observation must exist');
    assert.equal(typeof report.report.documentKey, 'string'); assert.notEqual(report.report.documentKey, previousDocument);
    previousDocument = report.report.documentKey; observed.add(counter.apiOperation);
    record.observationDocuments.push({ feature: surface.feature, documentKey: previousDocument, apiOperation: counter.apiOperation, phase: counter.phase, count: counter.count,
      coverageState: report.report.coverageState, coverageFlags: report.report.coverageFlags, dropped: report.report.dropped });
  }
  record.observedOperations = [...observed].sort();
  assert.deepEqual([...expectedOperations].filter(operation => !observed.has(operation)), [], 'actual sensor/bridge/SW projection must retain every available Wasm operation');
  record.checks.push('actual shipped observer, bridge and SW report expose every available operation as bounded enum/count metadata');
  const siteRows = mode => state.configuration.apis.map(row => ({ id: row.id, mode: row.id === 'webassembly-compile' ? mode : 'bypass', selected: { kind: 'unset' }, settings: {} }));
  await save({ 'webassembly-compile': 'on' }, true, [{ host: 'wasm-guard.example.com', disabled: false, apis: siteRows('bypass') }]);
  const [inherited] = await adapter.probe('/probe/0'); assert.equal(inherited.outcome, 'denied'); assert.equal(inherited.stage, 'target');
  await save({ 'webassembly-compile': 'on' }, true, [{ host: 'wasm-guard.example.com', disabled: false, apis: siteRows('off') }]);
  const [localOff] = await adapter.probe('/probe/0'); assert.equal(localOff.outcome, 'allowed');
  record.checks.push('exact-host Bypass inherits global compile On, while local Off overrides it in new documents');
  await save({ webassembly: 'on', 'webassembly-compile': 'off' });
  const [parent] = await adapter.probe('/probe/parent'); assert.equal(parent.initialInline, true); assert.equal(parent.namespace, false);
  record.checks.push('existing parent On hides the whole namespace and dominates a child Off');
  await save(Object.fromEntries(['webassembly', ...WASM_SURFACES.map(row => row.feature)].map(feature => [feature, 'on'])), false);
  record.masterOff = await adapter.probe('/probe/all'); assertAllowed(record.masterOff, record.baseline);
  const remaining = await adapter.registrations(); assert.equal(remaining.filter(row => row.js?.some(file => /^protection\.webassembly/.test(file))).length, 0);
  record.checks.push('master Off removes actual Wasm guard registrations; new first-inline documents retain native behavior');
  record.result = 'PASS'; console.log('WebAssembly Guard ' + browser + ': PASS (' + record.available + ' actual native operations, ' + record.checks.length + ' checks)');
}

try {
  await new Promise(done => server.listen(0, '127.0.0.1', done)); origin = 'http://wasm-guard.example.com:' + server.address().port;
  for (const browser of selectedBrowser === 'both' ? ['chrome', 'firefox'] : [selectedBrowser]) {
    const temporary = join(root, '.tmp'); mkdirSync(temporary, { recursive: true }); const run = mkdtempSync(join(temporary, 'webassembly-' + browser + '-'));
    const extension = join(run, 'extension'); cpSync(join(root, 'dist', browser), extension, { recursive: true });
    const record = { browser, run, result: 'RUNNING', checks: [], hashes: Object.fromEntries(['manifest.json', 'background.js', 'api-configuration.js', 'api-configuration-controller.js', 'webassembly-apis.js', ...WASM_SURFACES.map(row => 'protection.' + row.feature + '.js')].map(file => [file, hash(join(extension, file))])) };
    evidence.browsers.push(record); let adapter;
    try { adapter = await (browser === 'chrome' ? chromeBrowser : firefoxBrowser)(extension, run, record); await matrix(browser, adapter, record); }
    catch (error) { record.result = 'FAIL'; record.failure = error.stack ?? String(error); throw error; }
    finally { await adapter?.close(); }
  }
  evidence.result = 'PASS';
} catch (error) { evidence.result = 'FAIL'; evidence.failure = error.stack ?? String(error); process.exitCode = 1; console.error(error); }
finally { server.closeAllConnections(); if (server.listening) await new Promise(done => server.close(done)); mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n'); console.log('Wasm native evidence: ' + output); }
