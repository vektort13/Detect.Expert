// Actual browser-network provenance: official SDK, no response mocks or catalog edits.
// Firefox <153 deliberately lacks trustworthy network document identity. Its SDK
// and inventory are checked without fabricating per-document vendor attribution.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { archiveProduction, FIREFOX_ID } from '../build-production.mjs';
import { TURNSTILE_CASES, turnstileFixture, turnstileFixtureFacts, safeTurnstileResource } from './cloudflare-turnstile-fixture.mjs';

const root = resolve(import.meta.dirname, '../..');
const argument = name => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; };
const browser = argument('--browser') ?? 'chrome'; assert.ok(['chrome', 'firefox'].includes(browser));
const cacheEnabled = process.argv.includes('--cache-enabled');
const input = resolve(argument('--dist') ?? join(root, 'dist', browser));
const artifact = resolve(argument('--output') ?? join(root, 'test-results/production-1.1.0/observer-compatibility/vendor-redirect-' + browser + '.json'));
mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/vendor-redirect-' + browser + '-')), extension = join(run, 'extension');
cpSync(input, extension, { recursive: true });
const host = 'redirect-analysis.example.com';
const evidence = { at: new Date().toISOString(), result: 'RUNNING', browser, cacheEnabled, version: null, run, input,
  scope: 'official dummy SDK plus read-only actual reports; production challenge solving untested', modes: [], engineSamples: [], errors: [],
  hashes: Object.fromEntries(['background.js', 'hook.early.js', 'bridge.js'].map(name => [name, createHash('sha256').update(readFileSync(join(extension, name))).digest('hex')])) };
const server = createServer((request, response) => {
  request.resume(); response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/turnstile/v0/api.js') { response.writeHead(302, { Location: '/local-sdk.js' }); response.end(); return; }
  if (request.url === '/local-sdk.js') { response.setHeader('Content-Type', 'text/javascript'); response.end('window.turnstile={ownedFixture:true};window.ownedRedirectExecuted=true;'); return; }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (request.url === '/ready') { response.end('<!doctype html><title>Owned provenance setup</title>setup'); return; }
  if (request.url === '/negative') { response.end('<!doctype html><title>Owned unapproved redirect</title><script>window.exerciseNegative=()=>{const canvas=document.createElement("canvas");canvas.getContext("2d").getImageData(0,0,1,1);};exerciseNegative();window.negativeFixtureReady=true;</script><script src="/turnstile/v0/api.js"></script>'); return; }
  if (request.url === '/light' || request.url === '/pro') { response.end(turnstileFixture(TURNSTILE_CASES[0], { awaitPro: request.url === '/pro' })); return; }
  response.writeHead(404); response.end();
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://' + host + ':' + server.address().port;
const pause = ms => new Promise(done => setTimeout(done, ms));
async function until(probe, label, timeout = 15000) { const end = Date.now() + timeout; while (Date.now() < end) { const value = await probe(); if (value) return value; await pause(100); } throw Error(label); }
function safeResource(raw) {
  const value = safeTurnstileResource(raw, host);
  try { const url = new URL(raw); if (url.hostname === 'challenges.cloudflare.com' && url.pathname.startsWith('/turnstile/v0/'))
    value.path = '/' + url.pathname.split('/').slice(1, 10).map(part => ['turnstile', 'v0', 'g', 'api.js'].includes(part) ? part : '<opaque>').join('/'); } catch { /* Keep bounded template. */ }
  return value;
}
let transport, phase = 'startup';

async function chromeTransport() {
  const context = await chromium.launchPersistentContext(join(run, 'profile'), { channel: 'chromium', headless: true,
    args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension, '--no-proxy-server', '--host-resolver-rules=MAP ' + host + ' 127.0.0.1'] });
  evidence.version = context.browser().version();
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const settings = await context.newPage(); await settings.goto(new URL('.', worker.url()).href + 'options.html#settings');
  const send = value => settings.evaluate(message => chrome.runtime.sendMessage({ schemaVersion: 1, ...message }), value);
  const page = await context.newPage(); page.on('pageerror', error => evidence.errors.push({ phase, name: error.name }));
  const pageCdp = await context.newCDPSession(page); await pageCdp.send('Network.enable'); if (!cacheEnabled) await pageCdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  let resources = [], cacheHits = 0;
  pageCdp.on('Network.requestServedFromCache', () => { ++cacheHits; });
  page.on('response', response => { if (resources.length < 96) resources.push({ ...safeResource(response.url()), status: response.status(),
    redirectedFrom: response.request().redirectedFrom() ? safeResource(response.request().redirectedFrom().url()) : null }); });
  const cdp = await context.browser().newBrowserCDPSession(), target = (await cdp.send('Target.getTargets')).targetInfos.find(row => row.type === 'service_worker' && row.url === worker.url());
  assert.ok(target); const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
  const pending = new Map(); let sequence = 0;
  const rpc = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP ' + method + ' timed out')); }, 10000); pending.set(id, { resolve, reject, timer }); cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch(reject); });
  const receive = async event => {
    if (event.sessionId !== sessionId) return; const message = JSON.parse(event.message);
    if (message.id) { const job = pending.get(message.id); if (!job) return; pending.delete(message.id); clearTimeout(job.timer); message.error ? job.reject(Error('CDP method rejected')) : job.resolve(message.result); return; }
    if (message.method !== 'Debugger.paused') return;
    try { const frame = message.params.callFrames.find(row => row.functionName === 'getProjection'); assert.ok(frame);
      const data = await rpc('Debugger.evaluateOnCallFrame', { callFrameId: frame.callFrameId, expression: 'this.diagnostics()', returnByValue: true });
      assert.equal(data.exceptionDetails, undefined); const facts = data.result?.value; assert.ok(facts);
      const sample = { phase, ready: facts.ready, engineFailures: facts.engineFailures, persistFailures: facts.persistFailures };
      if (evidence.engineSamples.filter(row => row.phase === phase).length < 12) evidence.engineSamples.push(sample);
      else evidence.engineSamples[evidence.engineSamples.findLastIndex(row => row.phase === phase)] = sample;
    } catch { evidence.diagnosticReadFailed = true; } finally { await rpc('Debugger.resume').catch(() => {}); }
  };
  cdp.on('Target.receivedMessageFromTarget', receive); await rpc('Debugger.enable');
  const source = readFileSync(join(extension, 'background.js'), 'utf8'), line = source.split('\n').findIndex(value => /^  getProjection\(tabId/.test(value)); assert.ok(line >= 0);
  await rpc('Debugger.setBreakpointByUrl', { url: worker.url(), lineNumber: line + 1, columnNumber: 0 });
  return { send, async goto(path) { resources = []; cacheHits = 0; await page.goto(origin + path, { waitUntil: 'domcontentloaded' }); },
    facts: () => page.evaluate(turnstileFixtureFacts), negativeReady: () => page.evaluate(() => window.negativeFixtureReady && window.ownedRedirectExecuted),
    exerciseNegative: () => page.evaluate(() => window.exerciseNegative()),
    tabId: () => settings.evaluate(url => chrome.tabs.query({}).then(rows => rows.find(row => row.url === url)?.id), page.url()),
    resources: () => resources, cacheFacts: () => ({ source: 'native-CDP-requestServedFromCache', hits: cacheHits }), async close() { await rpc('Debugger.disable').catch(() => {}); cdp.off('Target.receivedMessageFromTarget', receive); await cdp.detach(); await pageCdp.detach(); await context.close(); } };
}

async function firefoxTransport() {
  const driverPath = process.env.GECKODRIVER_BINARY ?? join(root, '.tmp/firefox/tools/geckodriver.exe'); assert.ok(existsSync(driverPath));
  let binary = process.env.FIREFOX_BINARY;
  if (!binary && process.platform === 'win32') binary = spawnSync('powershell.exe', ['-NoProfile', '-Command', "(Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\firefox.exe').'(default)'"], { encoding: 'utf8', windowsHide: true }).stdout.trim();
  assert.ok(binary); const uuid = randomUUID(), base = 'moz-extension://' + uuid + '/', profile = join(run, 'profile'); mkdirSync(profile);
  const prefs = { 'extensions.webextensions.uuids': JSON.stringify({ [FIREFOX_ID]: uuid }), 'browser.shell.checkDefaultBrowser': false, 'browser.startup.homepage_override.mstone': 'ignore', 'browser.startup.page': 0,
    'browser.newtabpage.enabled': false, 'datareporting.policy.dataSubmissionEnabled': false, 'toolkit.telemetry.enabled': false, 'app.update.auto': false, 'network.proxy.type': 0,
    'network.dns.localDomains': host, 'network.dns.disablePrefetch': true, ...(!cacheEnabled ? { 'browser.cache.disk.enable': false, 'browser.cache.memory.enable': false } : {}) };
  writeFileSync(join(profile, 'user.js'), Object.entries(prefs).map(([key, value]) => 'user_pref(' + JSON.stringify(key) + ', ' + JSON.stringify(value) + ');').join('\n'));
  const portServer = createServer(); await new Promise(done => portServer.listen(0, '127.0.0.1', done)); const port = portServer.address().port; await new Promise(done => portServer.close(done));
  const bidiPortServer = createServer(); await new Promise(done => bidiPortServer.listen(0, '127.0.0.1', done)); const bidiPort = bidiPortServer.address().port; await new Promise(done => bidiPortServer.close(done));
  assert.notEqual(bidiPort, port); evidence.bidiPort = bidiPort;
  const endpoint = 'http://127.0.0.1:' + port; let session, driverError, socket, resources = [], settingsHandle, fixtureHandle;
  const driver = spawn(driverPath, ['--host', '127.0.0.1', '--port', String(port), '--websocket-port', String(bidiPort), '--profile-root', run, '--log', 'error'], { windowsHide: true, stdio: 'ignore' }); driver.once('error', error => { driverError = error; });
  async function command(path, body, method = 'POST') { const response = await fetch(endpoint + path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), signal: AbortSignal.timeout(30000) }); const value = (await response.json()).value; if (!response.ok || typeof value?.error === 'string') throw Error('WebDriver ' + (value?.error ?? response.status)); return value; }
  const wd = (path, body, method) => command('/session/' + session + path, body, method);
  const script = source => wd('/execute/sync', { script: source, args: [] });
  const send = async value => { await wd('/window', { handle: settingsHandle }); return wd('/execute/async', { script: 'const done=arguments[arguments.length-1];browser.runtime.sendMessage(arguments[0]).then(done,()=>done({type:"test-send-error"}));', args: [{ schemaVersion: 1, ...value }] }); };
  try {
    await until(async () => { if (driverError) throw driverError; try { return await command('/status', undefined, 'GET'); } catch { return false; } }, 'geckodriver readiness');
    const opened = await command('/session', { capabilities: { alwaysMatch: { browserName: 'firefox', pageLoadStrategy: 'eager', webSocketUrl: true, 'moz:firefoxOptions': { binary, args: ['-headless', '-no-remote', '-profile', profile] } } } });
    session = opened.sessionId; evidence.version = opened.capabilities.browserVersion;
    await wd('/timeouts', { script: 15000, pageLoad: 45000 }); fixtureHandle = await wd('/window', undefined, 'GET');
    // The Remote Agent can bind just after New Session resolves. Reconnect only
    // within the existing 4s setup bound; absence never becomes a passing zero.
    await until(async () => {
      const candidate = new WebSocket(opened.capabilities.webSocketUrl);
      try { await Promise.race([new Promise((done, reject) => { candidate.onopen = done; candidate.onerror = () => reject(Error('BiDi connection')); }), pause(700).then(() => { throw Error('BiDi connection timeout'); })]); socket = candidate; return true; }
      catch { candidate.close(); return false; }
    }, 'Firefox BiDi unavailable', 4000);
    socket.onmessage = event => { let message; try { message = JSON.parse(event.data); } catch { return; } if (!['network.responseStarted', 'network.responseCompleted'].includes(message.method)) return;
      const raw = message.params?.request?.url, status = message.params?.response?.status; if (typeof raw !== 'string' || !/^https?:/.test(raw) || typeof status !== 'number') return;
      const row = { ...safeResource(raw), status, redirectCount: message.params?.redirectCount ?? 0 }; if (resources.length < 96 && !resources.some(item => JSON.stringify(item) === JSON.stringify(row))) resources.push(row); };
    socket.send(JSON.stringify({ id: 1, method: 'session.subscribe', params: { events: ['network.responseStarted', 'network.responseCompleted'] } }));
    const archive = join(run, 'detect-expert-redirect.xpi'); writeFileSync(archive, archiveProduction(extension)); assert.equal(await wd('/moz/addon/install', { path: archive, temporary: true }), FIREFOX_ID);
    settingsHandle = (await wd('/window/new', { type: 'tab' })).handle; await wd('/window', { handle: settingsHandle }); await wd('/url', { url: base + 'options.html#settings' });
    return { send, async goto(path) { await wd('/window', { handle: fixtureHandle }); resources = []; await wd('/url', { url: origin + path }); },
      async facts() { await wd('/window', { handle: fixtureHandle }); return script('return window.fixtureFacts();'); },
      async negativeReady() { await wd('/window', { handle: fixtureHandle }); return script('return Boolean(window.negativeFixtureReady&&window.ownedRedirectExecuted);'); },
      async exerciseNegative() { await wd('/window', { handle: fixtureHandle }); return script('window.exerciseNegative();return true;'); },
      async tabId() { await wd('/window', { handle: settingsHandle }); return wd('/execute/async', { script: 'const done=arguments[arguments.length-1];browser.tabs.query({}).then(rows=>done(rows.find(row=>row.url?.startsWith(arguments[0]))?.id));', args: [origin + '/'] }); },
      resources: () => resources, cacheFacts: () => ({ source: 'native-cache-hit-status-not-exposed', hits: null }), async close() { socket?.close(); try { await command('/session/' + session, undefined, 'DELETE'); } finally { driver.kill(); } } };
  } catch (error) { socket?.close(); if (session) await command('/session/' + session, undefined, 'DELETE').catch(() => {}); driver.kill(); throw error; }
}

try {
  transport = browser === 'chrome' ? await chromeTransport() : await firefoxTransport();
  assert.equal((await transport.send({ type: 'ui-data-consent-set', version: 1, accepted: true })).accepted, true);
  assert.equal((await transport.send({ type: 'ui-set-scope', scopeMode: 'all-sites' })).type, 'scope');
  assert.equal((await transport.send({ type: 'ui-api-config-get', tabId: null })).configuration.enabled, false);
  const reportFor = async tabId => until(async () => { const response = await transport.send({ type: 'ui-get-report', tabId }); return response.report?.documentKey && response.report.observedSince !== null ? response.report : null; }, 'actual analysis report');
  phase = 'negative'; await transport.goto('/negative'); await until(() => transport.negativeReady(), 'owned redirect script must execute');
  const tabId = await transport.tabId(); assert.ok(Number.isSafeInteger(tabId));
  // Observation MAIN can activate asynchronously in Firefox. Exercise a tiny
  // owned canvas workload until the real report confirms it, bounded at 15s.
  // This is a positive control, not a zero-count compatibility assertion.
  const negative = await until(async () => { await transport.exerciseNegative(); const response = await transport.send({ type: 'ui-get-report', tabId });
    return response.report?.techniques.some(row => row.techniqueId === 'DET-002' && row.count > 0) ? response.report : null; }, 'Native canvas readback must positively exercise analysis on the negative fixture');
  assert.equal(negative.vendors.some(row => row.vendorId === 'cloudflare-turnstile'), false, 'Unapproved host/global name must not acquire curated provenance');
  evidence.negative = { analyzed: true, vendorAbsent: true, resources: transport.resources(), coverageState: negative.coverageState, coverageFlags: negative.coverageFlags };
  for (const mode of ['light', 'pro']) {
    phase = mode; if (mode === 'pro') { const started = await transport.send({ type: 'ui-pro-start', tabId }); assert.equal(started.session?.status, 'recording'); }
    await transport.goto('/' + mode);
    const facts = await until(async () => { const value = await transport.facts(); return value.success || value.error || value.proReadyTimedOut || value.renderError ? value : null; }, mode + ' SDK callback', 45000);
    assert.equal(facts.sdkLoaded, true); assert.equal(facts.rendered, true); assert.equal(facts.success, true); assert.equal(facts.error, false);
    if (mode === 'pro') { assert.equal(facts.proReadyBeforeSdk, true); assert.equal(facts.proMathAtRender, true); }
    const report = await reportFor(tabId), resources = transport.resources();
    const inventory = await transport.send({ type: 'ui-get-third-party', tabId, frameId: 0, documentKey: report.documentKey });
    const rows = inventory.rows?.filter(row => row.domain === 'cloudflare.com') ?? [];
    const vendor = report.vendors.find(row => row.vendorId === 'cloudflare-turnstile') ?? null;
    const entry = { mode, success: facts.success, proReadyBeforeSdk: facts.proReadyBeforeSdk, proMathAtRender: facts.proMathAtRender, resources, cache: transport.cacheFacts(),
      report: { documentKey: report.documentKey, coverageState: report.coverageState, coverageFlags: report.coverageFlags, vendor },
      inventoryCoverage: { type: inventory.type, coverageState: inventory.coverageState, coverageFlags: inventory.coverageFlags },
      inventory: rows.map(({ domain, pathTemplate, type, requestCount, completedCount, redirectCount, statusCodes, evidenceSource, integrity }) => ({ domain, pathTemplate, type, requestCount, completedCount, redirectCount, statusCodes, evidenceSource, integrity })) };
    evidence.modes.push(entry);
    if (browser === 'chrome') {
      assert.ok(rows.some(row => row.evidenceSource === 'browser-network' && row.integrity === 'browser-observed' && row.completedCount > 0), 'Actual completed Cloudflare inventory must exist');
      const canonicalRedirect = resources.some(row => row.host === 'challenges.cloudflare.com' && row.path === '/turnstile/v0/api.js' && row.status >= 300 && row.status < 400);
      const finalSuccess = resources.some(row => row.host === 'challenges.cloudflare.com' && row.path !== '/turnstile/v0/api.js' && row.path.startsWith('/turnstile/v0/') && row.status >= 200 && row.status < 300 && row.redirectedFrom?.host === 'challenges.cloudflare.com');
      entry.nativeRedirectAvailable = canonicalRedirect && finalSuccess;
      if (!cacheEnabled) assert.equal(entry.nativeRedirectAvailable, true, 'The cold SDK must supply a native canonical-to-versioned redirect for this regression');
      assert.ok(vendor, 'Completed approved redirect chain must retain curated vendor provenance');
      assert.equal(vendor.vendorConfidence, 'documented-resource'); assert.equal(vendor.evidenceSource, 'browser-network'); assert.equal(vendor.integrity, 'browser-observed'); assert.ok(vendor.ruleIds.includes('turnstile-loader-v1'));
    } else {
      assert.ok(resources.some(row => row.host === 'challenges.cloudflare.com' && row.status >= 200 && row.status < 300), 'Native BiDi must positively observe successful Cloudflare resources');
      assert.ok(report.coverageFlags.includes('network-limited'), 'Firefox without trusted network document identity must state the limitation');
      assert.equal(report.coverageState, 'partial', 'The supported Firefox report must remain usable with explicit partial coverage');
      assert.equal(vendor, null, 'Firefox must not fabricate per-document vendor identity'); entry.vendorAttribution = 'unsupported-network-document-identity';
    }
    if (mode === 'pro') {
      const saved = await until(async () => {
        const pro = await transport.send({ type: 'ui-pro-get', tabId }), page = pro.session?.pages?.find(row => row.tabId === tabId && row.documentKey === report.documentKey && row.endedAt === null);
        const snapshot = page?.reports?.find(row => row.documentKey === report.documentKey);
        const snapshotVendor = snapshot?.vendors?.find(row => row.vendorId === 'cloudflare-turnstile') ?? null;
        return snapshot && (browser !== 'chrome' || snapshotVendor) ? { pro, page, snapshotVendor } : null;
      }, 'Actual Pro snapshot must reflect the current document and supported vendor evidence');
      const { pro, page, snapshotVendor } = saved;
      assert.ok(page.reports.length > 0); entry.pro = { recording: pro.session.status === 'recording', tracked: true, reports: page.reports.length, snapshotVendor };
      if (browser === 'chrome') { assert.ok(snapshotVendor.ruleIds.includes('turnstile-loader-v1')); assert.equal(snapshotVendor.evidenceSource, 'browser-network'); assert.equal(snapshotVendor.integrity, 'browser-observed'); }
      else assert.equal(snapshotVendor, null, 'Firefox Pro must preserve unsupported network document identity');
      await transport.send({ type: 'ui-pro-stop', sessionId: pro.session.id });
    }
    console.log(mode + ': actual SDK/report ' + (vendor ? 'curated vendor and network inventory present' : 'native network observed; per-document attribution explicitly limited'));
  }
  if (browser === 'chrome') {
    for (const mode of ['negative', 'light', 'pro']) assert.ok(evidence.engineSamples.some(row => row.phase === mode), mode + ': native diagnostics positive control');
    for (const row of evidence.engineSamples) { assert.equal(row.ready, true); assert.equal(row.engineFailures, 0); assert.equal(row.persistFailures, 0); }
    assert.notEqual(evidence.diagnosticReadFailed, true); evidence.engineCounters = 'native-debugger-observed-zero';
  } else evidence.engineCounters = 'not-exposed; no zero claim';
  assert.deepEqual(evidence.errors, []); evidence.result = 'PASS'; console.log('PASS actual vendor redirect: ' + browser);
} catch (error) { evidence.result = 'FAIL'; evidence.failure = { phase, name: error.name, message: String(error.message).replace(/https?:\/\/\S+/g, '[URL omitted]').slice(0, 300) }; console.error('FAIL: ' + evidence.failure.message); process.exitCode = 1; }
finally { await transport?.close().catch(() => {}); server.closeAllConnections(); await new Promise(done => server.close(done)); mkdirSync(resolve(artifact, '..'), { recursive: true }); writeFileSync(artifact, JSON.stringify(evidence, null, 2) + '\n'); console.log('Evidence: ' + artifact); }
