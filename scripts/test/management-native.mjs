// Unified management: real extension routes, storage and privileged Firewall sender.
// Builds nothing. Every run freezes dist into its own disposable extension/profile.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';
import { MANAGEMENT_MESSAGES } from '../management-locales.mjs';
import { AUTOSURF_UI_MESSAGES } from '../production-locales-autosurf.mjs';
import { redesignLabels } from '../../apps/production-extension/redesign-labels.js';
import { enableChromeUserScripts } from './api-custom-early-native.mjs';

const root = resolve(import.meta.dirname, '../..'), argument = process.argv.indexOf('--dist');
const input = argument < 0 ? join(root, 'dist/chrome') : resolve(process.argv[argument + 1]);
mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/management-native-')), extension = join(run, 'extension');
const artifact = join(root, 'test-results/production-1.1.0/management'); mkdirSync(artifact, { recursive: true });
cpSync(input, extension, { recursive: true });
const evidence = { at: new Date().toISOString(), input, run, result: 'RUNNING', checks: [], errors: [], requests: [], layouts: [], locales: [], screenshots: [], contexts: [] };
evidence.hashes = Object.fromEntries(['manifest.json', 'options.html', 'options.js', 'popup.js', 'sidepanel.js', 'protection-ui.js', 'management-navigation.js', 'management-ui.js', 'management-ui.css', 'management-workspaces.css', 'protect-ui.js', 'protect-sw.js', 'protect.css', 'ui.css', 'options.css'].map(file => [file, createHash('sha256').update(readFileSync(join(extension, file))).digest('hex')]));
const pause = ms => new Promise(done => setTimeout(done, ms));
async function until(probe, label, timeout = 15000) { const end = Date.now() + timeout; while (Date.now() < end) { const value = await probe(); if (value) return value; await pause(40); } throw Error('timeout: ' + label); }
const check = message => { evidence.checks.push(message); console.log('  ok ' + message); };
const server = createServer((request, response) => { request.resume(); response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Owned management fixture</title><h1>Owned management fixture</h1>'); });
await new Promise(done => server.listen(0, '127.0.0.1', done));
const fixtureUrl = 'http://127.0.0.1:' + server.address().port + '/';
let context, worker, ui, base, phase = 'startup';
// ADR-103: the hub leads; then Анализ (Detector), Защита, Атака and Инструменты.
const tabs = ['hub', 'detector', 'api', 'firewall', 'antidetect', 'autosurf', 'cookies', 'proxy', 'integrations', 'settings', 'contacts'];
const tabLabel = (name, language) => name === 'hub' || name === 'integrations' ? redesignLabels(language)[name] : name === 'detector' ? 'Detector' : (name === 'autosurf' ? AUTOSURF_UI_MESSAGES : MANAGEMENT_MESSAGES)[language]['management_tab_' + name.replaceAll('-', '_')];
const tab = name => ui.locator('[data-management-tab="' + name + '"]');
const panel = name => ui.locator('[data-management-panel="' + name + '"]');
const send = message => ui.evaluate(value => chrome.runtime.sendMessage({ schemaVersion: 1, ...value }), message);
const protect = async () => (await send({ type: 'ui-protect-get-state' })).state;
const api = () => send({ type: 'ui-api-config-get', tabId: null });
async function selected(name) {
  const visibleTab = name === 'browser-debug' ? 'settings' : name;
  await tab(visibleTab).waitFor({ state: 'attached' });
  await until(() => tab(visibleTab).getAttribute('aria-selected').then(value => value === 'true'), name + ': selected management tab');
  assert.equal(await ui.locator('[data-management-tab][aria-selected="true"]').count(), 1);
  await panel(name).waitFor({ state: 'visible' });
  for (const other of [...tabs, 'browser-debug'].filter(value => value !== name)) if (await panel(other).count()) {
    assert.equal(await panel(other).isVisible(), false, other + ': inactive panel hidden');
    assert.equal(await panel(other).evaluate(element => element.hidden && element.inert), true, other + ': inactive panel inert');
  }
}
async function openNavigation() {
  const toggle = ui.locator('[data-management-menu-toggle]'), navigation = ui.locator('[data-management-navigation]');
  if (await toggle.isVisible() && !await navigation.isVisible()) await toggle.click();
  await navigation.waitFor({ state: 'visible' });
  assert.equal(await navigation.locator('[role="tablist"]').getAttribute('aria-orientation'), 'vertical');
}
async function focusNavigation(name) { await openNavigation(); await tab(name).focus(); }
async function choose(name) { await openNavigation(); await tab(name).click(); await selected(name); }
async function ownManagement() {
  return worker.evaluate(async () => {
    const own = chrome.runtime.getURL('options.html');
    return (await chrome.runtime.getContexts({ contextTypes: ['TAB'] })).filter(row => {
      try { const url = new URL(row.documentUrl); return url.origin + url.pathname === own && row.frameId === 0; } catch { return false; }
    }).map(({ tabId, windowId, documentId, documentUrl }) => ({ tabId, windowId, documentId, documentUrl }));
  });
}
async function single(identity) {
  const rows = await ownManagement(); assert.equal(rows.length, 1, 'one native management TAB context');
  if (identity) for (const key of ['tabId', 'windowId', 'documentId']) if (identity[key] !== undefined) assert.equal(rows[0][key], identity[key], 'management ' + key + ' retained');
  return rows[0];
}
async function layout(locale, theme) {
  await ui.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await openNavigation();
  const result = await ui.evaluate(() => {
    const shell = document.querySelector('[data-management-shell]'), controls = [...shell.querySelectorAll('[data-management-tab]')];
    const boxes = controls.map(element => ({ name: element.dataset.managementTab, text: element.textContent.trim(), box: element.getBoundingClientRect().toJSON(), clipped: element.scrollWidth > element.clientWidth + 1 }));
    return { width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1, dir: getComputedStyle(shell).direction, lang: shell.lang || document.documentElement.lang, boxes };
  });
  assert.equal(result.overflow, false, locale + '/' + theme + ': horizontal overflow');
  assert.equal(result.dir, ['ar', 'ur'].includes(locale) ? 'rtl' : 'ltr');
  for (const entry of result.boxes) { assert.ok(entry.text && !entry.text.includes('management_')); assert.equal(entry.clipped, false, locale + ': clipped ' + entry.name); }
  evidence.layouts.push({ locale, theme, ...result });
}
async function nativeActionGear(source) {
  const sourceTab = await worker.evaluate(url => chrome.tabs.query({}).then(rows => rows.find(row => row.url === url)), source.url());
  await source.bringToFront();
  const cdp = await context.newCDPSession(source), previous = new Set((await cdp.send('Target.getTargets')).targetInfos.map(row => row.targetId));
  await worker.evaluate(async row => { await chrome.action.setPopup({ tabId: row.id, popup: 'popup.html' }); await chrome.action.openPopup({ windowId: row.windowId }); }, sourceTab);
  const target = await until(async () => (await cdp.send('Target.getTargets')).targetInfos.find(row => row.type === 'page' && row.url === base + 'popup.html' && !previous.has(row.targetId)), 'genuine Chrome action popup');
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
  const pending = new Map(); let sequence = 0;
  const receive = event => { if (event.sessionId !== sessionId) return; const value = JSON.parse(event.message), job = pending.get(value.id); if (!job) return; pending.delete(value.id); clearTimeout(job.timer); value.error ? job.reject(Error(JSON.stringify(value.error))) : job.resolve(value.result); };
  cdp.on('Target.receivedMessageFromTarget', receive);
  const rpc = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout ' + method)); }, 10000); pending.set(id, { resolve, reject, timer }); cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch(reject); });
  const evaluate = async expression => { const value = await rpc('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (value.exceptionDetails) throw Error(JSON.stringify(value.exceptionDetails)); return value.result?.value; };
  try {
    await until(() => evaluate('document.readyState==="complete"'), 'native popup complete');
    await until(() => evaluate('document.querySelector("[data-protection-master]")?.disabled===false&&document.querySelector("[data-protect-launcher]")?.getAttribute("aria-busy")==="false"'), 'native popup backend state and layout ready');
    await evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
    await evaluate('globalThis.__managementNativeClick=[];addEventListener("click",e=>__managementNativeClick.push({trusted:e.isTrusted,action:e.target.closest("button")?.dataset.action,tag:e.target.tagName,className:e.target.getAttribute("class"),x:e.clientX,y:e.clientY}),true);true');
    const box = await until(() => evaluate('(()=>{const b=document.querySelector("[data-action=\\"open-options\\"]");return b&&!b.disabled?b.getBoundingClientRect().toJSON():null})()'), 'native popup gear');
    const hit = await evaluate('(()=>{const e=document.elementFromPoint(' + (box.x + box.width / 2) + ',' + (box.y + box.height / 2) + ');return e?{tag:e.tagName,className:e.getAttribute("class"),action:e.closest("button")?.dataset.action}:null})()');
    evidence.nativePopup = { target, box, hit };
    assert.equal(hit?.action, 'open-options', 'native gear center belongs to the visible gear');
    for (const type of ['mousePressed', 'mouseReleased']) await rpc('Input.dispatchMouseEvent', { type, x: box.x + box.width / 2, y: box.y + box.height / 2, button: 'left', clickCount: 1 });
    evidence.nativePopup.clicks = await evaluate('__managementNativeClick');
    assert.ok(evidence.nativePopup.clicks.some(value => value.trusted && value.action === 'open-options'), 'trusted native click reaches the gear');
    await selected('hub');
  } finally { cdp.off('Target.receivedMessageFromTarget', receive); await cdp.detach(); }
}

try {
  context = await chromium.launchPersistentContext(join(run, 'profile'), { channel: 'chromium', headless: true, viewport: { width: 1180, height: 900 }, args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension] });
  evidence.browser = context.browser().version();
  const observe = page => page.on('pageerror', error => evidence.errors.push({ phase, url: page.url(), error: error.message }));
  context.on('page', observe); for (const page of context.pages()) observe(page);
  await context.route('**/*', async route => { const url = new URL(route.request().url()); if (!['http:', 'https:'].includes(url.protocol) || url.origin === new URL(fixtureUrl).origin) await route.continue(); else { evidence.requests.push(url.origin); await route.abort(); } });
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'); base = new URL('.', worker.url()).href;
  ui = context.pages().find(page => page.url().startsWith(base + 'options.html')) ?? await context.newPage();
  await ui.goto(base + 'options.html#settings');
  ui = await enableChromeUserScripts(context, ui, new URL(base).host, evidence);
  worker = context.serviceWorkers().find(value => value.url().startsWith(base)) ?? await context.waitForEvent('serviceworker');
  await send({ type: 'ui-data-consent-set', version: 1, accepted: true });
  await ui.evaluate(() => chrome.storage.local.set({ 'ui-language-v1': 'ru' })); await ui.reload();
  await selected('settings'); const identity = await single(); evidence.contexts.push(identity);
  const token = await ui.evaluate(() => { globalThis.__managementNativeIdentity = crypto.randomUUID(); return globalThis.__managementNativeIdentity; });
  const initialApi = await api(), initialProtect = await worker.evaluate(() => chrome.storage.local.get('protect'));
  for (const name of tabs) { await choose(name); assert.equal(await ui.evaluate(() => globalThis.__managementNativeIdentity), token); await single(identity); }
  assert.equal((await protect()).state, 'off'); assert.deepEqual(await worker.evaluate(() => chrome.storage.local.get('protect')), initialProtect); assert.equal((await api()).revision, initialApi.revision);
  check('eleven primary tabs, the hub first, reuse one native document; visiting tabs does not enable Firewall or save API settings');
  await choose('firewall');
  for (const theme of ['light', 'dark']) {
    await layout('ru', theme); const file = 'management-ru-' + theme + '.png', bytes = await ui.screenshot({ path: join(artifact, file) });
    evidence.screenshots.push({ file, sha256: createHash('sha256').update(bytes).digest('hex') });
  }

  phase = 'keyboard and browser history';
  await choose('settings'); await focusNavigation('settings'); await ui.keyboard.press('ArrowDown');
  assert.equal(await tab('contacts').evaluate(element => element === document.activeElement), true); await selected('settings');
  await ui.keyboard.press('Enter'); await selected('contacts'); await focusNavigation('contacts'); await ui.keyboard.press('Home');
  assert.equal(await tab('hub').evaluate(element => element === document.activeElement), true); await selected('contacts');
  await ui.keyboard.press('Space'); await selected('hub'); await focusNavigation('hub'); await ui.keyboard.press('End');
  assert.equal(await tab('contacts').evaluate(element => element === document.activeElement), true); await selected('hub');
  await choose('api'); await choose('settings'); await choose('contacts');
  await ui.goBack(); await selected('settings'); await ui.goBack(); await selected('api'); await ui.goForward(); await selected('settings');
  await single(identity); assert.equal(await ui.evaluate(() => globalThis.__managementNativeIdentity), token);
  check('manual keyboard activation and Back/Forward follow selected tabs without reloading the document');

  phase = 'unsaved Custom API draft';
  await choose('api'); await ui.locator('[data-api-configuration-editor][aria-busy="false"]').waitFor();
  await ui.locator('[data-protection-scope="global"]').click(); await ui.locator('[data-protection-search]').fill('hardware-concurrency');
  assert.equal(await ui.locator('[data-api-value-editor="hardware-concurrency"]').count(), 0);
  await ui.locator('[data-protection-feature="hardware-concurrency"] [data-protection-state="custom"]').click();
  await ui.locator('[data-api-configuration-editor][aria-busy="false"]').waitFor();
  const cpu = ui.locator('[data-api-value-editor="hardware-concurrency"]'), preset = (await api()).configuration.apis.find(row => row.id === 'hardware-concurrency').presets[1];
  await cpu.locator('.api-value-picker').click(); await ui.locator('[data-api-value-list="hardware-concurrency"]').selectOption('p:' + preset.id);
  await until(() => ui.locator('[data-protection-save]').isEnabled(), 'dirty Custom draft'); const display = await cpu.locator('.api-value-picker').textContent();
  const draftRevision = (await api()).revision;
  await choose('contacts'); await choose('firewall'); await choose('api');
  assert.equal(await ui.locator('[data-protection-search]').inputValue(), 'hardware-concurrency'); assert.equal(await cpu.locator('.api-value-picker').textContent(), display); assert.equal(await ui.locator('[data-protection-save]').isEnabled(), true); assert.equal((await api()).revision, draftRevision);
  await ui.locator('[data-protection-save]').click(); await until(async () => (await api()).revision > draftRevision, 'actual API Save');
  const saved = await api(); assert.deepEqual(saved.configuration.apis.find(row => row.id === 'hardware-concurrency').selected, preset.value); assert.equal(saved.configuration.enabled, false);
  await ui.reload(); await selected('api'); assert.deepEqual((await api()).configuration, saved.configuration);
  check('unsaved CPU Custom selection and filter survive tab changes; explicit Save persists and reopening restores it while master remains OFF');

  phase = 'native launcher reuse';
  const afterReload = await single(), reused = { tabId: afterReload.tabId, windowId: afterReload.windowId }, popup = await context.newPage(); await popup.goto(base + 'popup.html');
  await popup.locator('[data-protect-open]').click(); await selected('firewall'); await single(reused); assert.equal((await protect()).state, 'off');
  await popup.locator('[data-protection-open]').click(); await selected('api'); await single(reused);
  const sidepanel = await context.newPage(); await sidepanel.goto(base + 'sidepanel.html');
  await Promise.all([popup.locator('[data-action="open-options"]').click(), sidepanel.locator('[data-action="open-options"]').click()]);
  await selected('hub'); await single(reused);
  await popup.close(); await sidepanel.close();
  const fixture = await context.newPage(); await fixture.goto(fixtureUrl); await choose('contacts'); await nativeActionGear(fixture); await single(reused);
  check('Firewall/API launchers, concurrent popup/sidebar gears and a trusted genuine Chrome action-popup gear reuse the management tab');

  phase = 'direct links and legacy API target';
  const source = await worker.evaluate(url => chrome.tabs.query({}).then(rows => rows.find(row => row.url === url)), fixtureUrl); assert.ok(Number.isInteger(source?.id));
  for (const [hash, name] of [['#protect', 'firewall'], ['#firewall', 'firewall'], ['#history', 'firewall'], ['#requests', 'firewall'], ['#api', 'api'], ['#protection', 'api'], ['#antidetect', 'antidetect'], ['#browser-debug', 'browser-debug'], ['#cookies', 'cookies'], ['#autosurf', 'autosurf'], ['#proxy', 'proxy'], ['#contacts', 'contacts'], ['#settings', 'settings'], ['#integrations', 'integrations'], ['#hub', 'hub'], ['', 'hub']]) {
    await ui.goto(base + 'options.html?tabId=' + source.id + hash); await selected(name); assert.equal(new URL(ui.url()).searchParams.get('tabId'), String(source.id));
  }
  await ui.goto(base + 'protection.html?tabId=' + source.id); await selected('api');
  assert.equal(new URL(ui.url()).pathname, '/options.html'); assert.equal(new URL(ui.url()).hash, '#api'); assert.equal(new URL(ui.url()).searchParams.get('tabId'), String(source.id));
  await ui.locator('[data-api-configuration-editor][aria-busy="false"]').waitFor();
  assert.equal(await ui.locator('[data-protection-host-picker]').inputValue(), new URL(fixtureUrl).hostname, 'the API editor consumes the preserved source tab');
  assert.equal(await ui.locator('[data-protection-save-reload]').count(), 1, 'source-tab reload action retained');
  await single(); assert.equal((await protect()).state, 'off');
  check('legacy Firewall aliases and standalone API URL resolve inside the shell and preserve the selected source tab');

  phase = 'privileged Firewall Options route';
  await choose('firewall');
  const offRecord = await worker.evaluate(() => chrome.storage.local.get('protect'));
  await worker.evaluate(() => { globalThis.__managementProtectWrites = []; chrome.storage.onChanged.addListener((changes, area) => { const keys = Object.keys(changes).filter(key => key === 'protect' || key.startsWith('protect-')); if (keys.length) globalThis.__managementProtectWrites.push({ area, keys }); }); });
  const offFeatures = ui.locator('[data-protect-features] input[type="checkbox"]'), offPresets = ui.locator('[data-protect-preset-preview] input[type="radio"]');
  assert.equal(await offFeatures.count(), 5); assert.equal(await offPresets.count(), 3);
  for (const control of [...await offFeatures.all(), ...await offPresets.all()]) { assert.equal(await control.isVisible(), true); assert.equal(await control.isDisabled(), true); }
  // ADR-090/098: the workspace header switch owns power; one explicit click enables without a dialog.
  const master = ui.locator('[data-workspace-master="firewall"] [data-protect-toggle="status"]');
  assert.equal(await master.getAttribute('role'), 'switch'); assert.equal(await master.getAttribute('aria-checked'), 'false');
  assert.equal(await ui.locator('[data-protect-enable]').isVisible(), false, 'the in-page enable button is replaced by the header switch');
  assert.equal((await protect()).state, 'off'); assert.deepEqual(await worker.evaluate(() => chrome.storage.local.get('protect')), offRecord); assert.deepEqual(await worker.evaluate(() => globalThis.__managementProtectWrites), []);
  await master.click();
  await until(async () => (await protect()).state === 'active', 'real Options header switch enables controller');
  assert.equal(await ui.locator('dialog[open], [aria-modal="true"], [data-protect-inline-consent]').count(), 0, 'ADR-098: no activation dialog or inline consent');
  await until(() => master.getAttribute('aria-checked').then(value => value === 'true'), 'header switch reflects the active controller'); await ui.locator('[data-protect-section="full"]').waitFor();
  await until(() => ui.locator('[data-protect-features] input[type="checkbox"]:disabled').count().then(count => count === 0), 'active feature choices become editable after enable');
  assert.equal(await ui.locator('[data-fw-mode-form] input[type="radio"]').count(), 3); assert.equal(await ui.locator('[data-fw-mode-form] input[type="radio"]:disabled').count(), 0);
  for (const [hash, heading] of [['#firewall', 'fw-rules-panel-title'], ['#history', 'history-settings-title'], ['#requests', 'requests-options-title']]) {
    await choose('api'); await ui.evaluate(value => { location.hash = value; }, hash); await selected('firewall');
    await until(() => ui.evaluate(id => {
      const heading = document.getElementById(id), header = document.querySelector('.management-header');
      if (!heading || document.activeElement !== heading) return false;
      const box = heading.getBoundingClientRect(), headerBox = header?.getBoundingClientRect();
      const overlappingHeader = headerBox && headerBox.bottom > 0 && headerBox.top < innerHeight && headerBox.left < box.right && headerBox.right > box.left;
      return box.top >= Math.max(0, overlappingHeader ? headerBox.bottom : 0) - 1 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth + 1;
    }, heading), hash + ': focused heading fully visible without header overlap after returning from API');
  }
  const configured = await send({ type: 'ui-protect-set-settings', preset: 'warn-only' }); assert.equal(configured.type, 'protect-state'); assert.equal(configured.state.preset, 'warn-only');
  const rejected = await worker.evaluate(async ({ tabId }) => (await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: async () => chrome.runtime.sendMessage({ schemaVersion: 1, type: 'ui-protect-set-settings', preset: 'strict' }) }))[0].result, { tabId: source.id });
  assert.equal(rejected.type, 'error'); assert.equal(rejected.code, 'unauthorized-sender'); assert.equal((await protect()).preset, 'warn-only');
  await master.click(); await until(async () => (await protect()).state === 'off', 'real Options header switch disable');
  await ui.locator('[data-protect-preset-preview]').waitFor(); assert.equal(await ui.locator('[data-protect-features] input:disabled').count(), 5); assert.equal(await ui.locator('[data-protect-preset-preview] input:disabled').count(), 3);
  check('OFF previews show five disabled features and three presets without writes; the header switch enables directly without a dialog (ADR-098), settings/disable remain authorized, and web senders stay rejected');

  phase = 'all locale labels and representative native layout';
  for (const language of PRODUCTION_LANGUAGES) {
    await ui.evaluate(value => chrome.storage.local.set({ 'ui-language-v1': value }), language.id);
    await until(() => ui.evaluate(expected => {
      const shell = document.querySelector('[data-management-shell]');
      return (shell?.lang || document.documentElement.lang).toLowerCase() === expected.toLowerCase();
    }, language.id.replace('_', '-')), 'management locale ' + language.id);
    const labels = (await ui.locator('[data-management-tab]').allTextContents()).map(value => value.trim()); assert.equal(labels.length, tabs.length);
    assert.deepEqual(labels, tabs.map(name => tabLabel(name, language.id)), language.id + ': exact localized tab labels');
    evidence.locales.push({ language: language.id, labels });
  }
  for (const locale of ['ru', 'en', 'ar', 'yue']) {
    await ui.evaluate(value => chrome.storage.local.set({ 'ui-language-v1': value }), locale);
    await ui.setViewportSize({ width: locale === 'ru' ? 1180 : 400, height: 900 });
    for (const name of tabs) { await choose(name); await layout(locale, locale === 'en' || locale === 'ar' ? 'dark' : 'light'); }
    if (locale === 'ar') { await choose('settings'); await focusNavigation('settings'); await ui.keyboard.press('ArrowLeft'); assert.equal(await tab(tabs[(tabs.indexOf('settings') + 1) % tabs.length]).evaluate(element => element === document.activeElement), true); await selected('settings'); }
    if (locale === 'ru') for (const theme of ['light', 'dark']) { await choose('firewall'); await layout(locale, theme); const file = 'management-ru-' + theme + '.png', bytes = await ui.screenshot({ path: join(artifact, file) }); evidence.screenshots.push({ file, sha256: createHash('sha256').update(bytes).digest('hex') }); }
  }
  assert.deepEqual(evidence.errors, []); assert.deepEqual(evidence.requests, []);
  check('all 21 locale labels resolve; RU/EN/Arabic/Yue light/dark/narrow layouts remain usable without horizontal overflow');
  phase = 'browser native Options entry';
  const nativeOptionsIdentity = await single();
  await ui.evaluate(() => chrome.runtime.openOptionsPage());
  await until(async () => { const rows = await ownManagement(); return rows.length === 1 && rows[0].tabId === nativeOptionsIdentity.tabId; }, 'browser Options entry converges to the existing management tab');
  await selected('hub'); await single({ tabId: nativeOptionsIdentity.tabId, windowId: nativeOptionsIdentity.windowId });
  check('the browser native Options entry also reuses an existing management tab with a source-tab query');
  evidence.result = 'PASS'; console.log('PASS management native: ' + evidence.checks.length + ' checks');
} catch (error) {
  evidence.result = 'FAIL'; evidence.failure = { phase, error: String(error.stack ?? error) }; process.exitCode = 1; console.error(JSON.stringify(evidence.failure, null, 2));
  if (worker) evidence.contexts.push(...await ownManagement().catch(() => []));
  if (ui && !ui.isClosed()) await ui.screenshot({ path: join(artifact, 'failure.png'), fullPage: true }).catch(() => {});
} finally {
  writeFileSync(join(artifact, 'management.json'), JSON.stringify(evidence, null, 2) + '\n');
  if (context) await context.close(); await new Promise(done => server.close(done));
}
