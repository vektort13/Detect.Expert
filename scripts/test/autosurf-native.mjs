// ADR-075: unchanged production files, owned browser profiles and local HTTP pages only.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launchOwnedManagement, until as untilBase, pause } from './management-browser-fixture.mjs';
import { createAutosurfFixture } from './autosurf-fixture.mjs';
import { createDefaultAutosurfConfiguration } from '../../packages/contracts/src/autosurf.mjs';

const root = resolve(import.meta.dirname, '../..'), browser = process.argv.includes('--firefox') ? 'firefox' : 'chrome';
mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/autosurf-native-' + browser + '-')), extension = join(run, 'extension');
cpSync(join(root, 'dist', browser), extension, { recursive: true });
const artifact = join(root, 'test-results/production-1.1.0/autosurf'); mkdirSync(artifact, { recursive: true });
const files = ['manifest.json', 'background.js', 'autosurf-shared.js', 'autosurf-controller.js', 'autosurf-service.js', 'autosurf-driver.js', 'autosurf-page.js', 'autosurf-metrics.js', 'autosurf-client.js', 'autosurf-ui.js', 'autosurf.css'];
const evidence = { at: new Date().toISOString(), browser, run, result: 'RUNNING', checks: [], errors: [], metrics: [], layouts: [], hashes: Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(join(extension, file))).digest('hex')])) };
const fixture = await createAutosurfFixture(); let opened, phase = 'startup';
const check = message => { evidence.checks.push(message); console.log('  ok ' + message); };
const request = (op, payload) => opened.evaluate(({ op, payload }) => new Promise((resolve, reject) => {
  const api = globalThis.browser ?? globalThis.chrome, port = api.runtime.connect({ name: 'detect-expert/autosurf/v1' }), id = 'native-' + Date.now();
  let done = false;
  const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); port.disconnect(); error ? reject(error) : resolve(value); };
  const timer = setTimeout(() => finish(Error('request-timeout')), 15000);
  port.onMessage.addListener(value => { if (value.id === id) finish(null, value); });
  port.onDisconnect.addListener(() => { void api.runtime.lastError; if (!done) finish(Error('request-disconnected')); });
  port.postMessage({ v: 1, id, op, ...(payload === undefined ? {} : { payload }) });
}), { op, payload });
const state = async () => { const value = await request('load'); assert.equal(value.ok, true); return value.snapshot; };
// A timeout carries the run state (status, phase, reason): a slow run is told from a paused one, for example "window-blurred" when another program took the focus from the owned window.
const until = (probe, label, timeout) => untilBase(probe, label, timeout).catch(async error => { let snapshot = 'state unavailable'; try { const now = await state(); snapshot = JSON.stringify({ status: now.status, phase: now.phase, reason: now.reason ?? null, visits: now.visits?.map(row => row.status), last: now.events?.slice(-4).map(row => row.type + ':' + (row.reason ?? '')) }); } catch {} throw Error(error.message + ' | run state: ' + snapshot); });
async function command(op, data = {}) { const before = await state(), result = await request(op, { revision: before.revision, ...data }); assert.equal(result.ok, true, op + ': ' + result.error?.code); return result.snapshot; }
async function configure(path, overrides = {}) { return command('save', { configuration: { ...createDefaultAutosurfConfiguration(), urls: [fixture.url + path], order: 'sequential', dwellMinSec: 5, dwellMaxSec: 5, gapMinSec: 1, gapMaxSec: 1, maxRunMinutes: 2, ...overrides } }); }
const ownedPages = () => opened.context.pages().filter(page => page.url().startsWith(fixture.url));
const normalWindows = () => opened.evaluate(async () => (await chrome.windows.getAll({ windowTypes: ['normal'] })).length);
async function focusUi() { const ui = opened.context.pages().find(page => page.url().startsWith(opened.base + 'options.html')); await ui.bringToFront(); }

try {
  opened = await launchOwnedManagement({ root, run, extension, browser, evidence, loopbackHosts: ['autosurf.example.com', 'external-autosurf.example.com'] });
  evidence.browserVersion = opened.version;
  if (opened.context) opened.context.on('page', page => page.on('pageerror', error => evidence.errors.push(error.message)));
  await opened.goto(opened.base + 'options.html#autosurf');
  await until(() => opened.evaluate(() => Boolean(document.querySelector('[data-autosurf-workspace]'))), 'Autosurfer UI');
  await until(async () => (await state()).status === 'idle', 'initial state');
  const tabs = await opened.evaluate(() => [...document.querySelectorAll('[data-management-tab]')].map(row => row.dataset.managementTab));
  assert.deepEqual(tabs.slice(tabs.indexOf('antidetect'), tabs.indexOf('antidetect') + 4), ['antidetect', 'autosurf', 'cookies', 'proxy'], 'the Attack group: Antidetect, Autosurfer, Cookies, Proxy');
  check('built-in Autosurfer sits in the Attack group between Antidetect and Cookies; initial state idle');
  await opened.fill('[data-autosurf-field="urls"]', fixture.url + '/passive?token=AUTOSURF_USER_CONFIG_CANARY');
  await opened.click('[data-autosurf-save]');
  await until(async () => (await state()).configuration.urls.length === 1, 'UI saves configuration');
  const stale = await request('start', { revision: 0 }); assert.equal(stale.ok, false); assert.equal(stale.error.code, 'stale-revision');
  check('real form saves local user configuration; stale revision cannot start a run');
  if (browser === 'firefox') {
    assert.equal((await state()).capabilities.supported, false);
    assert.equal(await opened.evaluate(() => document.querySelector('[data-autosurf-action="start"]').disabled), true);
    const refused = await request('start', { revision: (await state()).revision }); assert.equal(refused.ok, false); assert.equal(refused.error.code, 'unsupported');
    assert.equal(JSON.parse(readFileSync(join(extension, 'manifest.json'), 'utf8')).permissions.includes('debugger'), false);
    assert.equal(fixture.requests.length, 0);
    check('Firefox retains configuration UI, explicitly disables unsupported CDP and creates no browsing tab');
  } else {
    phase = 'trusted pointer and metrics'; const initialWindows = await normalWindows();
    await configure('/passive?token=AUTOSURF_USER_CONFIG_CANARY', { dwellMinSec: 40, dwellMaxSec: 40, metrics: true });
    assert.equal(await opened.evaluate(() => chrome.permissions.contains({ permissions: ['system.cpu', 'system.memory'] })), false);
    await until(() => opened.evaluate(() => Boolean(document.querySelector('[data-autosurf-grant]'))), 'metrics permission button');
    await opened.click('[data-autosurf-grant]');
    await until(() => opened.evaluate(() => chrome.permissions.contains({ permissions: ['system.cpu', 'system.memory'] })), 'first optional metrics grant');
    await until(() => opened.evaluate(() => !document.querySelector('[data-autosurf-action="start"]').disabled), 'Start enabled');
    await opened.click('[data-autosurf-action="start"]');
    const page = await until(() => ownedPages()[0], 'owned working page');
    await until(async () => { const value = await page.evaluate(() => globalThis.__autosurfFixture); return value?.hovers > 0 && value.trustedWheels > 0 && value.maxScroll > 0 && value; }, 'trusted hover and scrolling', 35000);
    const interactions = await page.evaluate(() => globalThis.__autosurfFixture); evidence.interactions = interactions;
    assert.ok(interactions.trustedMoves > 0); assert.equal(interactions.wheels, interactions.trustedWheels); assert.equal(interactions.clicks, 0); assert.equal(interactions.keys, 0); assert.equal(interactions.submits, 0);
    assert.equal((await state()).status, 'running', 'passive loader and ordinary password form do not trigger challenge');
    await until(async () => (await state()).samples.length > 0, 'renderer sample');
    const measured = (await state()).samples[0]; assert.equal(measured.gpuPercent, null); assert.equal(measured.scope, 'system-and-renderer'); assert.ok(measured.rendererJsHeapBytes > 0); assert.ok(measured.systemMemoryUsedBytes > 0, 'first grant enables actual system memory'); assert.equal(measured.systemCpuPercent, null); evidence.metrics.push(measured);
    const cpu = await until(async () => (await state()).samples.find(sample => typeof sample.systemCpuPercent === 'number'), 'second native CPU delta sample', 15000); assert.ok(cpu.systemCpuPercent >= 0 && cpu.systemCpuPercent <= 100); evidence.metrics.push(cpu);
    check('native isTrusted hover/wheel scroll the owned page; no clicks, keys or form submissions; passive scripts do not pause');
    check('first optional grant enables native CPU/RAM and renderer metrics; initial CPU null then valid delta, GPU unavailable');

    phase = 'hardware permission revocation';
    assert.equal(await opened.evaluate(() => chrome.permissions.remove({ permissions: ['system.cpu', 'system.memory'] })), true);
    await until(async () => (await state()).status === 'paused', 'hardware permission revoke pauses'); assert.equal((await state()).reason, 'permission-revoked');
    const samplesAfterRevoke = (await state()).samples.length; await pause(250); assert.equal((await state()).samples.length, samplesAfterRevoke);
    await command('resume'); await until(async () => (await state()).phase === 'interacting', 'explicit Resume after revoked metrics');
    check('native CPU/RAM permission revocation pauses and prevents later samples until explicit Resume');

    phase = 'Stop closes the owned window; export';
    // A content script of a real website must not reach the privileged port (checked while that page is still open).
    const pageRejected = await opened.evaluate(async prefix => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url?.startsWith(prefix));
      return (await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'ISOLATED', func: () => new Promise(resolve => {
        const port = chrome.runtime.connect({ name: 'detect-expert/autosurf/v1' }); let done = false;
        const finish = value => { if (done) return; done = true; clearTimeout(timer); port.disconnect(); resolve(value); };
        const timer = setTimeout(() => finish(false), 1500);
        port.onDisconnect.addListener(() => { void chrome.runtime.lastError; finish(true); });
        port.onMessage.addListener(() => finish(false)); port.postMessage({ v: 1, id: 'foreign-load', op: 'load' });
      }) }))[0].result;
    }, fixture.url); assert.equal(pageRejected, true);
    const windowsBeforeStop = await normalWindows(); await command('stop');
    await until(() => page.isClosed(), 'the owned page closes with its window'); assert.equal(await normalWindows(), windowsBeforeStop - 1, 'Stop closes exactly the window the run created');
    // The debugger let go before the window closed: no target of the fixture is left attached.
    assert.equal(await opened.evaluate(async () => (await chrome.debugger.getTargets()).some(target => target.url.startsWith('http://autosurf.example.com:'))), false);
    const exported = await request('export'); assert.equal(exported.ok, true); const text = JSON.stringify(exported.result);
    assert.doesNotMatch(text, /AUTOSURF_(?:USER_CONFIG|PASSWORD|QUERY|FRAGMENT)_CANARY/); assert.doesNotMatch(text, /[?]token=|"(?:x|y|currentUrl|documentId|tabId)"/);
    await focusUi(); await opened.click('[data-autosurf-export="json"]');
    await until(() => opened.evaluate(() => Boolean(document.querySelector('[data-autosurf-preview="json"] textarea'))), 'JSON preview');
    const preview = await opened.evaluate(() => document.querySelector('[data-autosurf-preview="json"] textarea').value); assert.doesNotMatch(preview, /AUTOSURF_.*CANARY/); assert.equal(JSON.parse(preview).runId, exported.result.runId);
    const exportPage = opened.context.pages().find(page => page.url().startsWith(opened.base + 'options.html'));
    const download = exportPage.waitForEvent('download'); await opened.click('[data-autosurf-download]');
    const savedFile = await download; assert.equal(await savedFile.failure(), null); assert.equal(readFileSync(await savedFile.path(), 'utf8'), preview, 'download contains exactly the shown preview');
    check('Stop detaches the debugger, closes exactly the window the run created and exports only redacted report data through preview');
    check('real website content-script sender cannot connect to the privileged Autosurfer port');

    phase = 'native challenge responses';
    for (const [path, reason] of [['/blocked', 'http-403'], ['/rate', 'http-429'], ['/challenge', 'challenge']]) {
      await configure(path); await command('start');
      const paused = await until(async () => { const value = await state(); return value.status === 'paused' && value; }, path + ': paused');
      assert.equal(paused.reason, reason); await command('stop'); await pause(200); await focusUi();
    }
    check('native top-level 403, 429 and cf-mitigated challenge all pause without retry');

    phase = 'redirect provenance';
    await configure('/redirect#section', { scroll: false, hover: false }); await command('start');
    await until(async () => (await state()).status === 'completed', 'native same-origin redirect completion');
    await focusUi(); await configure('/external-redirect'); await command('start');
    await until(async () => (await state()).status === 'paused', 'external redirect pauses'); assert.equal((await state()).reason, 'external-navigation');
    await command('stop'); await focusUi();
    check('browser-confirmed same-origin redirect completes; cross-host redirect pauses before input');

    phase = 'queue completion and safe discovery';
    await configure('/start', { depth: 1, scroll: false, hover: false }); await command('start');
    await until(async () => (await state()).status === 'completed', 'bounded depth1 run completion', 22000);
    const completed = await state(); assert.equal(completed.progress.completed, 1); assert.equal(completed.visits.length, 2); assert.equal(completed.visits[1].depth, 1);
    assert.equal(fixture.requests.some(path => /^\/(?:submitted|logout|delete|query|fragment|download|advert)/.test(path)), false);
    check('queue completes with one internal depth step; form, side-effect, token, download and ad links remain untouched');

    phase = 'window lifecycle';
    const baseline = await normalWindows(), quick = { scroll: false, hover: false };
    assert.equal(baseline, initialWindows, 'earlier scenarios left no browsing window behind');
    await focusUi(); await configure('/article', quick); await command('start');
    await until(async () => (await state()).status === 'completed', 'a short run completes', 22000);
    await until(async () => (await normalWindows()) === baseline, 'the finished run closes its window');
    await focusUi(); await configure('/article', { ...quick, dwellMinSec: 40, dwellMaxSec: 40 }); await command('start');
    await until(async () => (await state()).phase === 'interacting', 'a long run is interacting'); assert.equal(await normalWindows(), baseline + 1);
    await command('pause'); assert.equal(await normalWindows(), baseline + 1, 'Pause keeps the window');
    await command('resume'); await until(async () => (await state()).phase === 'interacting', 'resumed'); assert.equal(await normalWindows(), baseline + 1, 'Resume takes the same window back');
    await command('pause'); await command('start'); await until(async () => (await state()).phase === 'interacting', 'a new Start while paused');
    assert.equal(await normalWindows(), baseline + 1, 'a new Start closes the old window and opens exactly one');
    await command('stop'); await until(async () => (await normalWindows()) === baseline, 'Stop closes the window');
    check('a finished or stopped run closes its window; Pause and Resume keep and reuse it; a new Start never stacks a second one');

    phase = 'cookies are received';
    await focusUi(); await configure('/cookie-set', { ...quick, urls: [fixture.url + '/cookie-set', fixture.url + '/cookie-read'] }); await command('start');
    await until(async () => (await state()).status === 'completed', 'cookie run completes', 30000);
    const readBack = fixture.cookies.find(row => row.path === '/cookie-read');
    assert.match(readBack.cookie, /surf_header=1/); assert.match(readBack.cookie, /surf_js=1/);
    await until(async () => (await normalWindows()) === baseline, 'the window is closed after the cookie run');
    const later = await opened.context.newPage(); await later.goto(fixture.url + '/cookie-read'); await later.close(); await until(async () => (await normalWindows()) === baseline, 'the helper tab is gone');
    assert.match(fixture.cookies.at(-1).cookie, /surf_header=1/); assert.match(fixture.cookies.at(-1).cookie, /surf_js=1/);
    check('cookies set by the surfed site (Set-Cookie header and script) reach the profile, are sent on the next visit and outlive the closed window');

    phase = 'unreachable site'; const unreachableStart = Date.now();
    await focusUi(); await configure('/article', { ...quick, urls: [fixture.deadUrl + '/', fixture.url + '/article'] }); await command('start');
    await until(async () => (await state()).status === 'completed', 'the unreachable site is skipped', 30000);
    const skippedRun = await state(); assert.deepEqual(skippedRun.visits.map(row => row.status), ['interrupted', 'completed']); assert.equal(skippedRun.progress.completed, 2);
    assert.ok(skippedRun.events.some(row => row.type === 'error' && row.reason === 'navigation-error'));
    await until(async () => (await normalWindows()) === baseline, 'the window is closed after the skipped site');
    check('a site that refuses the connection is skipped and recorded; the run goes on, completes and closes its window (' + Math.round((Date.now() - unreachableStart) / 1000) + ' s)');

    phase = 'focus loss'; await focusUi(); await configure('/focus', { dwellMinSec: 40, dwellMaxSec: 40 }); await command('start');
    await until(async () => (await state()).phase === 'interacting', 'focus test running'); await focusUi();
    await until(async () => (await state()).status === 'paused', 'window focus loss pauses'); assert.equal((await state()).reason, 'window-blurred');
    check('switching from the owned browsing window pauses automatically');
    phase = 'Resume and manual takeover';
    const windowsBeforeResume = await normalWindows();
    await command('resume'); await until(async () => (await state()).phase === 'interacting', 'explicit Resume'); assert.equal(await normalWindows(), windowsBeforeResume, 'Resume takes the paused run window back');
    const takenOver = ownedPages().findLast(page => page.url().endsWith('/focus')); await takenOver.goto(fixture.url + '/manual');
    await until(async () => (await state()).status === 'paused', 'manual navigation pause'); assert.equal((await state()).reason, 'manual-navigation');
    await command('resume'); await until(async () => (await state()).phase === 'interacting', 'Resume creates new owned window');
    assert.equal(takenOver.url(), fixture.url + '/manual'); assert.equal(await takenOver.evaluate(() => globalThis.__autosurfFixture.clicks), 0);
    await command('pause');
    check('Resume runs explicitly; manual takeover pauses and the next Resume leaves the taken-over tab untouched');

    phase = 'worker recovery';
    const before = await state(), worker = opened.context.serviceWorkers()[0], ui = opened.context.pages().find(page => page.url().startsWith(opened.base + 'options.html'));
    const cdp = await opened.context.newCDPSession(ui); let versionId;
    cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => { for (const row of versions) if (row.scriptURL === worker.url() && row.runningStatus === 'running') versionId = row.versionId; });
    try { await cdp.send('ServiceWorker.enable'); await until(() => versionId, 'native worker version'); await cdp.send('ServiceWorker.stopWorker', { versionId }); } finally { await cdp.detach(); }
    const restored = await until(async () => { try { const value = await state(); return value.reason === 'restored' && value; } catch { return false; } }, 'paused restored state');
    assert.equal(restored.status, 'paused'); assert.equal(restored.runId, before.runId);
    const count = fixture.requests.length; await pause(1500); assert.equal(fixture.requests.length, count);
    const windowsAfterRestart = await normalWindows();
    await command('resume'); await until(async () => (await state()).phase === 'interacting', 'Resume after the worker restart'); assert.equal(await normalWindows(), windowsAfterRestart, 'after a worker restart Resume takes the same window back');
    await command('stop'); await until(async () => (await normalWindows()) === windowsAfterRestart - 1, 'Stop closes the window of the restored run');
    check('real service-worker termination restores paused progress, performs no automatic navigation, and Resume takes the same window back');
    phase = 'browser restart durability';
    const previous = await state(), requestsBeforeRestart = fixture.requests.length;
    await opened.close(); opened = await launchOwnedManagement({ root, run, extension, browser, evidence, loopbackHosts: ['autosurf.example.com', 'external-autosurf.example.com'] });
    await opened.goto(opened.base + 'options.html#autosurf');
    const durable = await state(); assert.deepEqual(durable.configuration, previous.configuration); assert.equal(durable.runId, previous.runId); assert.equal(durable.status, 'stopped');
    await pause(1000); assert.equal(fixture.requests.length, requestsBeforeRestart);
    check('browser restart retains local configuration and redacted last report without restarting a run');
  }
  phase = 'layout';
  for (const locale of ['ru', 'en', 'ar']) {
    await opened.evaluate(locale => (globalThis.browser ?? chrome).storage.local.set({ 'ui-language-v1': locale }), locale);
    await opened.viewport(browser === 'firefox' ? 520 : locale === 'ru' ? 1180 : 400, 900);
    await opened.media({ colorScheme: locale === 'en' ? 'dark' : 'light' }); await pause(200);
    const layout = await opened.evaluate(() => ({ width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1, dir: document.documentElement.dir, raw: /autosurf_[a-z_]+/.test(document.querySelector('[data-autosurf-workspace]').textContent) }));
    assert.equal(layout.overflow, false); assert.equal(layout.raw, false); evidence.layouts.push({ locale, ...layout });
    await opened.screenshot(join(artifact, browser + '-' + locale + '.png'));
  }
  check('RU/EN/Arabic layouts render without unresolved keys or horizontal overflow');
  evidence.result = 'PASS'; console.log('PASS Autosurf ' + browser + ': ' + evidence.checks.length + ' checks');
} catch (error) { evidence.result = 'FAIL'; evidence.failure = { phase, message: error.stack }; console.error(error); process.exitCode = 1; }
finally { try { await opened?.close(); } finally { await fixture.close(); evidence.requestPaths = fixture.requests; writeFileSync(join(artifact, browser + '.json'), JSON.stringify(evidence, null, 2)); } }
