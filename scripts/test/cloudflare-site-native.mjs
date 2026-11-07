// Compatibility observation of the exact owner-provided public demo. The explicit
// dummy-only mode permits one visually approved test-checkbox click, never a real
// challenge, callback invocation, token/hidden-input read, submit or stealth.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { enableChromeUserScripts } from './api-custom-early-native.mjs';

const root = resolve(import.meta.dirname, '../..');
const argument = name => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; };
const input = resolve(argument('--dist') ?? join(root, 'dist/chrome'));
const installed = process.argv.includes('--installed-chrome'), channel = installed ? 'chrome' : 'chromium';
const observeMs = Number(argument('--observe') ?? 12000);
assert.ok(Number.isSafeInteger(observeMs) && observeMs >= 2000 && observeMs <= 30000);
const challengeOnly = process.argv.includes('--challenge-only');
const target = 'https://2captcha.com/demo/' + (challengeOnly ? 'cloudflare-turnstile-challenge' : 'cloudflare-turnstile');
const artifact = resolve(argument('--output') ?? join(root, 'test-results/production-1.1.0/cloudflare-site-chrome.json'));
mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/cloudflare-site-')), extension = join(run, 'extension');
cpSync(input, extension, { recursive: true });
const files = folder => readdirSync(folder, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(folder, entry.name)) : [join(folder, entry.name)]);
const evidence = { at: new Date().toISOString(), result: 'RUNNING', target, run, input, channel,
  scope: process.argv.includes('--dummy-interaction') ? 'official public dummy-checkbox UI regression only; one visually confirmed pointer click; no real-challenge solving, response/token reads or submission' :
    'passive public-demo load observation only; no CAPTCHA interaction or proof of challenge completion',
  frozenFiles: files(extension).length, hashes: Object.fromEntries(['manifest.json', 'background.js', 'hook.early.js', 'hook.main.js', 'api-configuration-controller.js', 'protect.main.js', 'protect-sw.js'].map(file => [file, createHash('sha256').update(readFileSync(join(extension, file))).digest('hex')])),
  browser: null, modes: [], failures: [] };
const pause = ms => new Promise(done => setTimeout(done, ms));
let context, settings, base, page, tabId, worker, phase = 'baseline';
const send = message => settings.evaluate(value => chrome.runtime.sendMessage({ schemaVersion: 1, ...value }), message);
function safeResource(raw) {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return { host: 'non-http', path: '/' };
    return { host: url.hostname, path: url.hostname === '2captcha.com' && ['/demo/cloudflare-turnstile', '/demo/cloudflare-turnstile-challenge'].includes(url.pathname) ? url.pathname :
      url.hostname === 'challenges.cloudflare.com' && url.pathname === '/turnstile/v0/api.js' ? '/turnstile/v0/api.js' :
      url.hostname === 'challenges.cloudflare.com' && url.pathname.startsWith('/cdn-cgi/challenge-platform/') ? '/cdn-cgi/challenge-platform/…' : '/other' };
  } catch { return { host: 'invalid', path: '/' }; }
}
async function until(probe, label, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const value = await probe(); if (value) return value; await pause(100); }
  throw Error(label);
}
async function metadata() {
  const [scope, api, firewall, pro, browser] = await Promise.all([send({ type: 'ui-get-scope' }), send({ type: 'ui-api-config-get', tabId: null }),
    send({ type: 'ui-protect-get-state' }), send({ type: 'ui-pro-get' }), settings.evaluate(async () => ({
      dynamicCount: (await chrome.declarativeNetRequest.getDynamicRules()).length, sessionCount: (await chrome.declarativeNetRequest.getSessionRules()).length,
      registrations: (await chrome.scripting.getRegisteredContentScripts()).map(row => row.id), userScripts: (await chrome.userScripts.getScripts()).map(row => row.id) }))]);
  return { observation: scope.scope?.scopeMode, api: { enabled: api.configuration?.enabled, antidetectEnabled: api.configuration?.antidetectEnabled, registration: api.registration, earlyAccess: api.earlyAccess },
    firewall: { state: firewall.state?.state, preset: firewall.state?.preset, features: firewall.state?.features, degradedReasons: firewall.state?.degradedReasons },
    pro: { recording: pro.session?.status === 'recording' }, ...browser };
}
async function setApi(enabled, mode = 'bypass', id = null) {
  const state = await send({ type: 'ui-api-config-get', tabId: null });
  const configuration = { ...state.configuration, enabled, antidetectEnabled: enabled && mode === 'custom', preset: 'custom', sites: [], apis: state.configuration.apis.map(row => ({ ...row,
    mode: id === null ? mode : row.id === id ? mode : 'bypass', selected: row.id === id && mode === 'custom' ? { kind: 'value', value: 16 } : { kind: 'unset' } })) };
  const saved = await send({ type: 'ui-api-config-set', tabId: null, expectedRevision: state.revision, configuration });
  assert.equal(saved.type, 'api-config-state'); assert.notEqual(saved.registration, 'error');
  assert.equal(saved.configuration.enabled, enabled); assert.equal(saved.configuration.antidetectEnabled, enabled && mode === 'custom');
}
async function pageFacts() {
  return page.evaluate(() => ({ readyState: document.readyState, webdriver: navigator.webdriver,
    cpuCustom16: navigator.hardwareConcurrency === 16, userAgentWithheld: typeof navigator.userAgent === 'undefined',
    proMathWrapped: !Function.prototype.toString.call(Math.sin).includes('[native code]'),
    sdkGlobal: typeof globalThis.turnstile === 'object', iframeCount: document.querySelectorAll('iframe').length,
    challengeIframeCount: [...document.querySelectorAll('iframe')].filter(frame => {
      try { return new URL(frame.getAttribute('src') || '', location.href).hostname === 'challenges.cloudflare.com'; } catch { return false; }
    }).length,
    widgetContainerCount: document.querySelectorAll('.cf-turnstile,[data-sitekey]').length }));
}
async function visibleWidgetState() {
  for (const frame of page.frames()) {
    if (safeResource(frame.url()).host !== 'challenges.cloudflare.com') continue;
    for (const [state, text] of [['checkbox', 'Verify you are human'], ['loading', 'Verifying…'], ['success', 'Success!'], ['error', 'Failure!']]) {
      try { if (await frame.getByText(text, { exact: true }).first().isVisible()) return state; } catch { /* Native frame may navigate. */ }
    }
  }
  return 'unknown';
}
async function currentReportWithDiagnostics() {
  // Module-local runtime is intentionally not a public SW global. Read only its
  // fixed diagnostics at the real getProjection call frame, without product seams.
  worker = context.serviceWorkers().find(value => value.url().startsWith(base)) ?? worker;
  const cdp = await context.browser().newBrowserCDPSession();
  const target = (await cdp.send('Target.getTargets')).targetInfos.find(row => row.type === 'service_worker' && row.url === worker.url());
  assert.ok(target);
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
  const pending = new Map(); let sequence = 0, diagnostic, readError = false;
  const rpc = (method, params = {}) => new Promise((done, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error('Native diagnostic timeout')); }, 10000);
    pending.set(id, { done, reject, timer });
    cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch(reject);
  });
  const receive = async event => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    if (message.id) { const job = pending.get(message.id); if (job) { pending.delete(message.id); clearTimeout(job.timer); message.error ? job.reject(Error('Native diagnostic rejected')) : job.done(message.result); } return; }
    if (message.method !== 'Debugger.paused') return;
    try {
      const frame = message.params.callFrames.find(row => row.functionName === 'getProjection'); assert.ok(frame);
      const data = await rpc('Debugger.evaluateOnCallFrame', { callFrameId: frame.callFrameId, expression: 'this.diagnostics()', returnByValue: true });
      assert.equal(data.exceptionDetails, undefined); const value = data.result.value;
      diagnostic = { ready: value.ready, engineFailures: value.engineFailures, persistFailures: value.persistFailures, degraded: value.degraded, pendingDropped: value.pendingDropped };
    } catch { readError = true; } finally { await rpc('Debugger.resume').catch(() => {}); }
  };
  cdp.on('Target.receivedMessageFromTarget', receive);
  try {
    await rpc('Debugger.enable');
    const line = readFileSync(join(extension, 'background.js'), 'utf8').split('\n').findIndex(value => /^  getProjection\(tabId/.test(value)); assert.ok(line >= 0);
    await rpc('Debugger.setBreakpointByUrl', { url: worker.url(), lineNumber: line + 1, columnNumber: 0 });
    const current = await send({ type: 'ui-get-report', tabId });
    assert.equal(readError, false); assert.ok(diagnostic, 'Native diagnostic positive control must really execute');
    assert.equal(diagnostic.ready, true);
    return { current, diagnostic };
  } finally { await rpc('Debugger.disable').catch(() => {}); cdp.off('Target.receivedMessageFromTarget', receive); await cdp.detach(); }
}
async function interactWithVerifiedDummy(mode) {
  assert.equal(challengeOnly, false, 'Never interact with the managed-challenge page');
  const widget = page.locator('.cf-turnstile[data-sitekey="3x00000000000000000000FF"]');
  assert.equal(await widget.count(), 1, 'Only the single exact documented public dummy target may be clicked');
  const handle = await widget.elementHandle(); assert.ok(handle);
  const box = await handle.boundingBox();
  assert.ok(box && box.width >= 280 && box.width <= 340 && box.height >= 50 && box.height <= 100);
  const before = join(run, mode + '-dummy-before.png'), review = join(run, mode + '-dummy-approved');
  await page.screenshot({ path: before, fullPage: false });
  console.log('VISUAL_REVIEW_REQUIRED ' + before + ' approval=' + review);
  // The runner must visually confirm the test annotation and empty checkbox.
  // A different/real challenge receives no click, retry or response handling.
  await until(() => existsSync(review), 'No visual confirmation of the official dummy test annotation', 60000);
  assert.equal(await widget.count(), 1);
  assert.equal(await handle.evaluate(element => element.isConnected && element.getAttribute('data-sitekey') === '3x00000000000000000000FF'), true);
  const fresh = await handle.boundingBox();
  assert.ok(fresh && fresh.width >= 280 && fresh.width <= 340 && fresh.height >= 50 && fresh.height <= 100);
  // ElementHandle.click sends the normal pointer sequence after visibility,
  // stability and hit-target checks; a detached/replaced/covered target fails.
  await handle.click({ position: { x: 20, y: fresh.height / 2 }, timeout: 3000 });
  const interaction = { verifiedDummyKey: true, testAnnotationVisuallyConfirmed: true, clickCount: 1, before, after: [] };
  for (const seconds of [5, 10]) {
    await pause(5000);
    const screenshot = join(run, mode + '-dummy-after-' + seconds + 's.png'); await page.screenshot({ path: screenshot, fullPage: false });
    interaction.after.push({ seconds, screenshot, visibleWidgetState: await visibleWidgetState() });
  }
  if (settings) { const sample = await currentReportWithDiagnostics(); interaction.diagnostics = sample.diagnostic; assert.equal(sample.diagnostic.engineFailures, 0); }
  return interaction;
}
async function observe(mode, diagnosticOnly = false) {
  phase = mode; console.log('mode ' + mode);
  const duration = process.argv.includes('--extended-core') && ['baseline', 'light', 'pro-recording'].includes(mode) ? 30000 : observeMs;
  const record = { mode, diagnosticOnly, metadata: settings ? await metadata() : null, resources: [], samples: [], pageErrors: [], consoleErrors: 0, navigation: null };
  evidence.modes.push(record);
  if (record.metadata) {
    assert.equal(record.metadata.observation, mode === 'installed-observation-off' ? 'off' : 'all-sites');
    assert.equal(record.metadata.api.enabled, ['api-enabled-empty-bypass', 'api-all-off', 'hardware16-custom', 'intentional-user-agent-on'].includes(mode));
    assert.equal(record.metadata.api.antidetectEnabled, mode === 'hardware16-custom');
    if (mode === 'hardware16-custom') assert.equal(record.metadata.api.registration, 'ready', 'Custom must have a real active native registration');
    assert.notEqual(record.metadata.api.registration, 'error'); assert.equal(record.metadata.pro.recording, mode === 'pro-recording');
    if (mode.startsWith('firewall-')) {
      assert.equal(record.metadata.firewall.state, 'active'); assert.equal(record.metadata.firewall.preset, mode === 'firewall-normal-gpc' ? 'normal' : mode.slice(9));
      assert.deepEqual(record.metadata.firewall.features, ['value-match', 'firewall', 'session-replay', 'history', ...(mode === 'firewall-normal-gpc' ? ['gpc'] : [])]);
    } else assert.equal(record.metadata.firewall.state, 'off');
  }
  const resources = new Map(); let droppedResources = 0;
  const note = (raw, status, type) => {
    const safe = safeResource(raw), key = safe.host + safe.path + status + type;
    if (!resources.has(key) && resources.size >= 128) { ++droppedResources; return; }
    const entry = resources.get(key) ?? { ...safe, status, type, count: 0 };
    entry.count = Math.min(10000, entry.count + 1); resources.set(key, entry);
  };
  const response = value => note(value.url(), value.status(), value.request().resourceType());
  const failed = request => { const raw = request.failure()?.errorText; note(request.url(), typeof raw === 'string' && /^net::ERR_[A-Z_]+$/.test(raw) ? raw : 'request-failed', request.resourceType()); };
  const error = value => { if (record.pageErrors.length < 8) record.pageErrors.push({ name: value.name }); };
  const consoleEvent = value => { if (value.type() === 'error') record.consoleErrors = Math.min(10000, record.consoleErrors + 1); };
  page.on('response', response); page.on('requestfailed', failed); page.on('pageerror', error); page.on('console', consoleEvent);
  const cdp = await context.newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }); await cdp.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.filter(row => ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration'].includes(row.name)).map(row => [row.name, row.value]));
  const before = await metrics(), started = Date.now();
  try {
    try { const navigation = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 }); record.navigation = { status: navigation?.status() ?? null, domContentLoadedMs: Date.now() - started }; }
    catch (caught) { record.navigation = { error: caught.name, elapsedMs: Date.now() - started }; }
    for (const wait of [...new Set([0, Math.min(12000, duration), duration])]) {
      const remaining = wait - (Date.now() - started); if (remaining > 0) await pause(remaining);
      const begin = Date.now();
      try { record.samples.push({ elapsedMs: Date.now() - started, ...await pageFacts(), evaluationMs: Date.now() - begin, visibleWidgetState: await visibleWidgetState() }); }
      catch (caught) { record.samples.push({ elapsedMs: Date.now() - started, error: caught.name }); }
      if (wait > 0 && ['baseline', 'light', 'pro-recording'].includes(mode)) {
        const screenshot = join(run, mode + '-' + Math.round(wait / 1000) + 's.png');
        await page.screenshot({ path: screenshot, fullPage: false, timeout: 10000 });
        (record.screenshots ??= []).push(screenshot);
      }
    }
    record.frames = page.frames().slice(0, 32).map(frame => safeResource(frame.url()));
    const after = await metrics(); record.metricsSeconds = Object.fromEntries(Object.entries(after).map(([name, value]) => [name, Math.round((value - (before[name] ?? 0)) * 10000) / 10000]));
    const facts = record.samples.at(-1);
    if (mode === 'baseline') assert.equal(facts.webdriver, true);
    if (mode === 'hardware16-custom') assert.equal(facts.cpuCustom16, true);
    if (mode === 'intentional-user-agent-on') assert.equal(facts.userAgentWithheld, true);
    if (settings) {
      const { current, diagnostic } = await currentReportWithDiagnostics();
      record.report = { available: Boolean(current.report), coverageState: current.report?.coverageState, coverageFlags: current.report?.coverageFlags,
        vendorIds: current.report?.vendors?.map(row => row.vendorId), techniqueCount: current.report?.techniques?.length };
      record.diagnostics = diagnostic;
      assert.equal(record.diagnostics.engineFailures, 0, 'Native engine must not silently fail');
      if (!challengeOnly && ['light', 'pro-recording'].includes(mode)) assert.ok(record.report.vendorIds?.includes('cloudflare-turnstile'), 'The actual current report must recognize the loaded Turnstile resource');
      if (mode === 'pro-recording') {
        const pro = await send({ type: 'ui-pro-get', tabId });
        record.proTrackedPage = Boolean(pro.session?.pages?.some(row => row.tabId === tabId && row.documentKey === current.report?.documentKey && row.endedAt === null));
        const tracked = pro.session?.pages?.find(row => row.tabId === tabId && row.documentKey === current.report?.documentKey && row.endedAt === null);
        record.proVendorIds = [...new Set(tracked?.reports?.flatMap(row => row.vendors?.map(vendor => vendor.vendorId) ?? []) ?? [])];
        assert.equal(record.proTrackedPage, true); assert.equal(facts.proMathWrapped, true);
      }
    }
    { const screenshot = join(run, mode + '.png'); await page.screenshot({ path: screenshot, fullPage: false, timeout: 10000 }); record.screenshot = screenshot; }
    if (process.argv.includes('--dummy-interaction') && ['baseline', 'light', 'pro-recording'].includes(mode)) record.dummyInteraction = await interactWithVerifiedDummy(mode);
  } finally {
    record.resources = [...resources.values()]; record.droppedResources = droppedResources;
    page.off('response', response); page.off('requestfailed', failed); page.off('pageerror', error); page.off('console', consoleEvent); await cdp.detach();
  }
  console.log('  ' + JSON.stringify({ navigation: record.navigation, facts: record.samples.at(-1), metrics: record.metricsSeconds }));
}
try {
  context = await chromium.launchPersistentContext(join(run, 'baseline-profile'), { channel, headless: true });
  evidence.browser = context.browser().version(); page = await context.newPage(); await observe('baseline');
  await context.close(); context = null;
  context = await chromium.launchPersistentContext(join(run, 'extension-profile'), { channel, headless: true,
    ...(installed ? { ignoreDefaultArgs: ['--disable-extensions'] } : {}), args: installed ? ['--enable-unsafe-extension-debugging'] : ['--disable-extensions-except=' + extension, '--load-extension=' + extension] });
  if (installed) { const cdp = await context.browser().newBrowserCDPSession(); const loaded = await cdp.send('Extensions.loadUnpacked', { path: extension }); await cdp.detach(); base = 'chrome-extension://' + loaded.id + '/'; worker = context.serviceWorkers().find(row => row.url().startsWith(base)) ?? await context.waitForEvent('serviceworker', { predicate: row => row.url().startsWith(base) }); }
  else { worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'); base = new URL('.', worker.url()).href; }
  settings = await context.newPage(); await settings.goto(base + 'options.html#settings'); settings = await enableChromeUserScripts(context, settings, new URL(base).host, evidence);
  assert.equal((await send({ type: 'ui-data-consent-set', version: 1, accepted: true })).accepted, true);
  assert.equal((await send({ type: 'ui-set-scope', scopeMode: 'off' })).type, 'scope'); await setApi(false);
  page = await context.newPage(); await page.goto('https://2captcha.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  tabId = await settings.evaluate(url => chrome.tabs.query({}).then(rows => rows.find(row => row.url === url)?.id), page.url()); assert.ok(Number.isSafeInteger(tabId));
  await observe('installed-observation-off');
  await send({ type: 'ui-set-scope', scopeMode: 'all-sites' }); await observe('light');
  const pro = await send({ type: 'ui-pro-start', tabId }); assert.equal(pro.session?.status, 'recording'); await observe('pro-recording'); await send({ type: 'ui-pro-stop', sessionId: pro.session.id });
  if (!process.argv.includes('--core-only') && !challengeOnly && !process.argv.includes('--dummy-interaction')) {
    await setApi(true); await observe('api-enabled-empty-bypass'); await setApi(true, 'off'); await observe('api-all-off');
    await setApi(true, 'custom', 'hardware-concurrency'); await observe('hardware16-custom'); await setApi(false);
    const enabled = await send({ type: 'ui-protect-enable', consentVersion: 1, features: ['value-match', 'firewall', 'session-replay', 'history'], preset: 'warn-only' }); assert.equal(enabled.state?.state, 'active');
    for (const preset of ['warn-only', 'normal', 'strict']) { await send({ type: 'ui-protect-set-settings', preset }); await observe('firewall-' + preset); }
    if (process.argv.includes('--gpc')) {
      const gpc = await send({ type: 'ui-protect-set-settings', preset: 'normal', features: ['value-match', 'firewall', 'session-replay', 'history', 'gpc'] });
      assert.equal(gpc.state?.state, 'active'); assert.ok(gpc.state?.features.includes('gpc')); await observe('firewall-normal-gpc');
    }
    await send({ type: 'ui-protect-disable', purge: true }); await setApi(true, 'on', 'navigator-user-agent'); await observe('intentional-user-agent-on', true);
  }
  await setApi(false); await send({ type: 'ui-set-scope', scopeMode: 'off' }); evidence.finalMetadata = await metadata();
  evidence.result = 'OBSERVED';
} catch (caught) { evidence.result = 'FAIL'; evidence.failure = { phase, name: caught.name, message: String(caught.message).replace(/https?:\/\/\S+/g, '[URL omitted]').slice(0, 250) }; console.error('FAIL ' + evidence.failure.message); }
finally { if (context) await context.close().catch(() => {}); mkdirSync(resolve(artifact, '..'), { recursive: true }); writeFileSync(artifact, JSON.stringify(evidence, null, 2) + '\n'); console.log(evidence.result + ': ' + artifact); }
if (evidence.result === 'FAIL') process.exitCode = 1;
