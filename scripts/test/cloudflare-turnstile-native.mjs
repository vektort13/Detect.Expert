// Owned fixture + Cloudflare's documented dummy sitekeys. This checks test-widget
// compatibility, never solves a production challenge or conceals automation.
// Builds nothing; the delivered extension is frozen in a disposable profile.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { enableChromeUserScripts } from './api-custom-early-native.mjs';
import { TURNSTILE_CASES as cases, TURNSTILE_TEST_REFERENCE, turnstileFixture, safeTurnstileResource, turnstileFixtureFacts } from './cloudflare-turnstile-fixture.mjs';

const root = resolve(import.meta.dirname, '../..');
const argument = name => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; };
const input = resolve(argument('--dist') ?? join(root, 'dist/chrome'));
const installedChrome = process.argv.includes('--installed-chrome');
const browserChannel = installedChrome ? 'chrome' : 'chromium';
const timeout = Number(argument('--timeout') ?? 45000);
assert.ok(Number.isSafeInteger(timeout) && timeout >= 5000 && timeout <= 120000);
const artifact = resolve(argument('--output') ?? join(root, 'test-results/production-1.1.0/cloudflare-turnstile.json'));
mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/cloudflare-turnstile-'));
const evidence = { at: new Date().toISOString(), result: 'RUNNING', scope: 'official dummy widgets only; production challenge solving untested', run,
  reference: TURNSTILE_TEST_REFERENCE, browserChannel, browser: null, input, hashes: {}, cases: cases.map(({ id, expected }) => ({ id, expected })), modes: [], blocked: null, failures: [] };
const pause = ms => new Promise(done => setTimeout(done, ms));
async function until(probe, label, milliseconds = 15000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) { const result = await probe(); if (result) return result; await pause(75); }
  throw Error(label);
}
const server = createServer((request, response) => {
  const pro = request.url.startsWith('/pro/');
  const spec = cases.find(row => request.url === (pro ? '/pro/' : '/') + row.id);
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/ready') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Owned Turnstile setup</title>Owned setup'); return; }
  if (!spec) { response.writeHead(404); response.end(); return; }
  response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(turnstileFixture(spec, { awaitPro: pro }));
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const host = 'cf-fixture.example.com', origin = 'http://' + host + ':' + server.address().port;
let context, settings, worker, setupTab, base, phase = 'baseline', proSession = null;
const commonArgs = ['--no-proxy-server', '--host-resolver-rules=MAP ' + host + ' 127.0.0.1'];
const send = message => settings.evaluate(value => chrome.runtime.sendMessage({ schemaVersion: 1, ...value }), message);
async function modeMetadata() {
  const [scope, api, firewall, pro, browser] = await Promise.all([
    send({ type: 'ui-get-scope' }), send({ type: 'ui-api-config-get', tabId: null }), send({ type: 'ui-protect-get-state' }),
    send({ type: 'ui-pro-get' }),
    settings.evaluate(async () => ({ dynamic: await chrome.declarativeNetRequest.getDynamicRules(), session: await chrome.declarativeNetRequest.getSessionRules(),
      registered: (await chrome.scripting.getRegisteredContentScripts()).map(({ id, runAt, world, allFrames }) => ({ id, runAt, world, allFrames })),
      userScripts: typeof chrome.userScripts === 'object' ? (await chrome.userScripts.getScripts()).map(({ id, runAt, world, allFrames }) => ({ id, runAt, world, allFrames })) : [] }))
  ]);
  return { observation: scope.scope?.scopeMode ?? null, api: { enabled: api.configuration?.enabled, antidetectEnabled: api.configuration?.antidetectEnabled, revision: api.revision, registration: api.registration, earlyAccess: api.earlyAccess },
    firewall: { state: firewall.state?.state, preset: firewall.state?.preset, features: firewall.state?.features, degradedReasons: firewall.state?.degradedReasons },
    pro: { recording: pro.session?.status === 'recording' }, ...browser };
}
async function runWidgets(mode, diagnosticOnly = false) {
  phase = mode;
  console.log('mode ' + mode);
  const record = { mode, diagnosticOnly, metadata: settings ? await modeMetadata() : null, results: [] }; evidence.modes.push(record);
  if (record.metadata !== null) {
    const apiEnabled = ['api-enabled-empty-bypass', 'api-all-off', 'hardware16-custom', 'intentional-user-agent-on'].includes(mode);
    assert.equal(record.metadata.observation, mode === 'installed-observation-off' ? 'off' : 'all-sites');
    assert.equal(record.metadata.api.enabled, apiEnabled); assert.notEqual(record.metadata.api.registration, 'error');
    assert.equal(record.metadata.api.antidetectEnabled, mode === 'hardware16-custom');
    if (mode === 'hardware16-custom') assert.equal(record.metadata.api.registration, 'ready', 'Custom must have a real active native registration');
    assert.equal(record.metadata.pro.recording, mode === 'pro-recording');
    if (mode.startsWith('firewall-')) {
      assert.equal(record.metadata.firewall.state, 'active'); assert.equal(record.metadata.firewall.preset, mode.slice('firewall-'.length));
      assert.deepEqual(record.metadata.firewall.features, ['value-match', 'firewall', 'session-replay', 'history']);
    } else assert.equal(record.metadata.firewall.state, 'off');
    assert.equal(record.metadata.dynamic.length, 0); assert.equal(record.metadata.session.length, 0);
  }
  for (const spec of cases) {
    // Pro only follows its start tab and genuine children. A fresh unrelated
    // context.newPage() would silently exercise Light despite a recording session.
    const reused = mode === 'pro-recording', page = reused ? setupTab : await context.newPage(), resources = new Map(), pageErrors = [];
    const pageError = error => { if (pageErrors.length < 8) pageErrors.push({ name: error.name }); }; page.on('pageerror', pageError);
    const note = (url, status) => { const safe = safeTurnstileResource(url, host), key = safe.host + safe.path + status, entry = resources.get(key) ?? { ...safe, status, count: 0 }; entry.count++; resources.set(key, entry); };
    const response = value => note(value.url(), value.status());
    const failed = request => { const raw = request.failure()?.errorText, code = typeof raw === 'string' && /^net::ERR_[A-Z_]+$/.test(raw) ? raw : 'request-failed'; note(request.url(), code); };
    page.on('response', response); page.on('requestfailed', failed);
    try {
      await page.goto(origin + (reused ? '/pro/' : '/') + spec.id, { waitUntil: 'domcontentloaded', timeout });
      const end = Date.now() + timeout;
      let facts;
      do { facts = await page.evaluate(turnstileFixtureFacts);
        if (facts.success || facts.error || facts.renderError || facts.timeout) break; await pause(150);
      } while (Date.now() < end);
      const outcome = facts.success ? 'success' : facts.error ? 'error' : facts.renderError ? 'render-error' : facts.timeout ? 'timeout-callback' : facts.sdkLoaded ? 'no-callback' : 'sdk-unavailable';
      const result = { id: spec.id, expected: spec.expected, outcome, ...facts, resources: [...resources.values()], pageErrors };
      if (mode === 'pro-recording') {
        const tabId = await settings.evaluate(url => chrome.tabs.query({}).then(rows => rows.find(row => row.url === url)?.id), page.url());
        const pro = await send({ type: 'ui-pro-get', tabId });
        const current = await send({ type: 'ui-get-report', tabId });
        // Pro URLs deliberately redact host/path segments. Match the native
        // current document identity, never the raw fixture URL against redaction.
        const tracked = pro.session?.pages?.find(row => row.tabId === tabId && row.documentKey === current.report?.documentKey && row.endedAt === null);
        result.proTrackedPage = Boolean(tracked); result.proReportCount = tracked?.reports?.length ?? 0;
        assert.equal(result.proTrackedPage, true, 'Every widget must run in the actual tracked Pro start tab');
        assert.equal(facts.proReadyBeforeSdk, true, 'Pro hooks must be active before the remote SDK starts loading');
        assert.equal(facts.proMathAtRender, true, 'Pro hooks must be active immediately before the SDK renders the widget');
        assert.equal(facts.proMathWrapped, true, 'Pro-only Math hooks must actually be active in the widget document');
      }
      record.results.push(result); console.log('  ' + spec.id + ': ' + outcome);
      if (mode === 'baseline' && (!facts.sdkLoaded || !facts.rendered || !['success', 'error'].includes(outcome))) {
        evidence.blocked = { mode, case: spec.id, reason: outcome }; return false;
      }
      if (!diagnosticOnly && outcome !== spec.expected) evidence.failures.push({ mode, case: spec.id, expected: spec.expected, outcome });
      if (mode === 'baseline') assert.equal(facts.webdriver, true, 'Automation remains visible; no webdriver masking');
      if (mode === 'hardware16-custom') {
        assert.equal(facts.initialCpuCustom16, true, 'Custom must apply in the first owned inline script before the SDK');
        assert.equal(facts.cpuCustom16, true, 'Custom must really be active on the owned page');
      }
      if (mode === 'intentional-user-agent-on') assert.equal(facts.userAgentWithheld, true, 'The deliberately blocking UA mode must actually be applied');
    } finally { page.off('pageerror', pageError); page.off('response', response); page.off('requestfailed', failed); if (!reused) await page.close(); }
  }
  return true;
}
async function setApi(enabled, mode = 'bypass', id = null) {
  const state = await send({ type: 'ui-api-config-get', tabId: null });
  const configuration = { ...state.configuration, enabled, antidetectEnabled: enabled && mode === 'custom', preset: 'custom', sites: [], apis: state.configuration.apis.map(row => ({ ...row,
    mode: id === null ? mode : row.id === id ? mode : 'bypass', selected: row.id === id && mode === 'custom' ? { kind: 'value', value: 16 } : { kind: 'unset' } })) };
  const saved = await send({ type: 'ui-api-config-set', tabId: null, expectedRevision: state.revision, configuration });
  assert.equal(saved.type, 'api-config-state', 'API mode must save through the real controller');
  assert.equal(saved.configuration.enabled, enabled); assert.equal(saved.configuration.antidetectEnabled, enabled && mode === 'custom');
  assert.notEqual(saved.registration, 'error'); return saved;
}
try {
  context = await chromium.launchPersistentContext(join(run, 'baseline-profile'), { channel: browserChannel, headless: true, args: commonArgs });
  evidence.browser = context.browser().version();
  if (!await runWidgets('baseline')) evidence.result = 'BLOCKED';
  else if (process.argv.includes('--baseline-only')) evidence.result = evidence.failures.length ? 'FAIL' : 'PASS';
  else {
    await context.close(); context = null;
    const extension = join(run, 'extension'); cpSync(input, extension, { recursive: true });
    evidence.hashes = Object.fromEntries(['manifest.json', 'background.js', 'hook.early.js', 'hook.main.js', 'protect.main.js', 'protect-sw.js'].map(file => [file, createHash('sha256').update(readFileSync(join(extension, file))).digest('hex')]));
    context = await chromium.launchPersistentContext(join(run, 'extension-profile'), { channel: browserChannel, headless: true,
      ...(installedChrome ? { ignoreDefaultArgs: ['--disable-extensions'] } : {}),
      args: installedChrome ? [...commonArgs, '--enable-unsafe-extension-debugging'] : [...commonArgs, '--disable-extensions-except=' + extension, '--load-extension=' + extension] });
    if (installedChrome) {
      const cdp = await context.browser().newBrowserCDPSession();
      let id;
      try { ({ id } = await cdp.send('Extensions.loadUnpacked', { path: extension })); } finally { await cdp.detach(); }
      assert.equal(typeof id, 'string');
      base = 'chrome-extension://' + id + '/'; evidence.extensionInstallation = 'native CDP loadUnpacked in a fresh isolated installed-Chrome profile';
      worker = context.serviceWorkers().find(value => value.url().startsWith(base)) ?? await context.waitForEvent('serviceworker', { predicate: value => value.url().startsWith(base) });
    } else {
      worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'); base = new URL('.', worker.url()).href;
    }
    evidence.extensionBrowser = context.browser().version();
    settings = await context.newPage(); await settings.goto(base + 'options.html#settings');
    settings = await enableChromeUserScripts(context, settings, new URL(base).host, evidence);
    assert.equal((await send({ type: 'ui-data-consent-set', version: 1, accepted: true })).accepted, true);
    assert.equal((await send({ type: 'ui-set-scope', scopeMode: 'off' })).type, 'scope');
    await setApi(false); await runWidgets('installed-observation-off');
    assert.equal((await send({ type: 'ui-set-scope', scopeMode: 'all-sites' })).type, 'scope');
    await runWidgets('light');
    setupTab = await context.newPage(); await setupTab.goto(origin + '/ready');
    const tabId = await settings.evaluate(url => chrome.tabs.query({}).then(rows => rows.find(row => row.url === url)?.id), setupTab.url());
    const pro = await send({ type: 'ui-pro-start', tabId });
    assert.equal(pro.session?.status, 'recording', 'Real Pro recording must start on the owned domain'); proSession = pro.session.id;
    await runWidgets('pro-recording'); await send({ type: 'ui-pro-stop', sessionId: proSession }); proSession = null;
    await setApi(true); await runWidgets('api-enabled-empty-bypass');
    await setApi(true, 'off'); await runWidgets('api-all-off');
    await setApi(true, 'custom', 'hardware-concurrency'); await runWidgets('hardware16-custom');
    await setApi(false);
    const enabled = await send({ type: 'ui-protect-enable', consentVersion: 1, features: ['value-match', 'firewall', 'session-replay', 'history'], preset: 'warn-only' });
    assert.equal(enabled.state?.state, 'active', 'Firewall must activate through the exact owned Options sender');
    for (const preset of ['warn-only', 'normal', 'strict']) {
      const saved = await send({ type: 'ui-protect-set-settings', preset }); assert.equal(saved.state?.preset, preset);
      await runWidgets('firewall-' + preset);
    }
    await send({ type: 'ui-protect-disable', purge: true });
    // Explicit blocking is intentionally incompatible and is observed, not relabelled
    // a passive compatibility failure. Only one relevant API is blocked here.
    await setApi(true, 'on', 'navigator-user-agent'); await runWidgets('intentional-user-agent-on', true);
    await setApi(false); await send({ type: 'ui-set-scope', scopeMode: 'off' });
    evidence.finalMetadata = await modeMetadata();
    evidence.result = evidence.failures.length ? 'FAIL' : 'PASS';
  }
} catch (error) {
  evidence.result = 'FAIL'; evidence.failure = { phase, name: error.name, message: String(error.message).replace(/https?:\/\/\S+/g, '[URL omitted]').slice(0, 300) };
  console.error('FAIL: ' + evidence.failure.message);
} finally {
  if (context) await context.close().catch(() => {});
  await new Promise(done => server.close(done));
  mkdirSync(resolve(artifact, '..'), { recursive: true }); writeFileSync(artifact, JSON.stringify(evidence, null, 2) + '\n');
  console.log(evidence.result + ': ' + artifact);
}
if (evidence.result === 'FAIL') process.exitCode = 1;
if (evidence.result === 'BLOCKED') process.exitCode = 2;
