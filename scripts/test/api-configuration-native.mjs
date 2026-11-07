// ADR-048: delivered Chrome extension, real options UI, local fixture and persistent profile.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { API_CONFIG_CATALOG, importApiConfiguration } from '../../packages/contracts/src/api-configuration.mjs';
import { enableChromeUserScripts } from './api-custom-early-native.mjs';
import { redesignLabels } from '../../apps/production-extension/redesign-labels.js';

const root = resolve(import.meta.dirname, '../..');
const temporary = join(root, '.tmp'); mkdirSync(temporary, { recursive: true });
const run = mkdtempSync(join(temporary, 'api-configuration-native-'));
const extension = join(run, 'extension'), profile = join(run, 'profile');
cpSync(join(root, 'dist/chrome'), extension, { recursive: true });
const artifact = join(root, 'test-results/production-1.1.0/api-configuration-custom-mode'); mkdirSync(artifact, { recursive: true });
const evidence = { browser: null, checks: [], errors: [], requests: [], profile: run, visuals: [], hashes: Object.fromEntries(['api-configuration-ui.js', 'api-configuration-ui.css', 'button-surfaces.css'].map(file => [file, createHash('sha256').update(readFileSync(join(extension, file))).digest('hex')])) };
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return; }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><html><head><title>Owned API configuration fixture</title></head><body><main>API configuration test fixture</main></body></html>');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const host = 'api-config.example.com', origin = 'http://' + host + ':' + server.address().port;
let context, settings, fixture, tabId, extensionId;
const options = { channel: 'chromium', headless: true, acceptDownloads: true, viewport: { width: 1100, height: 1000 }, args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension, '--no-proxy-server', '--enable-unsafe-swiftshader', '--unsafely-treat-insecure-origin-as-secure=' + origin, '--host-resolver-rules=MAP ' + host + ' 127.0.0.1'] };
async function launch() {
  context = await chromium.launchPersistentContext(profile, options);
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['http:', 'https:'].includes(url.protocol) || url.origin === origin) await route.continue();
    else { evidence.requests.push(url.origin); await route.abort(); }
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).host; evidence.browser = context.browser().version();
  settings = await context.newPage(); settings.on('pageerror', error => evidence.errors.push(error.message));
  await settings.goto('chrome-extension://' + extensionId + '/options.html');
  settings = await enableChromeUserScripts(context, settings, extensionId, evidence);
}
const send = message => settings.evaluate(message => chrome.runtime.sendMessage(message), message);
const state = () => send({ schemaVersion: 1, type: 'ui-api-config-get', tabId });
async function waitSaved(previous) {
  await settings.waitForFunction(async previous => {
    const response = await chrome.runtime.sendMessage({ schemaVersion: 1, type: 'ui-api-config-get', tabId: null });
    return response?.type === 'api-config-state' && response.revision > previous;
  }, previous);
  await settings.locator('[data-api-configuration-editor][aria-busy="false"]').waitFor();
  return state();
}
async function importFile(source, name = 'configuration.json') {
  await settings.locator('[data-api-config-file]').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(source) });
}
async function closePreview() { await settings.locator('.api-config-modal .api-config-actions button').first().click(); }
async function showExport() {
  await settings.locator('[data-api-config-export]').click();
  return settings.locator('.api-config-modal .api-config-json').textContent();
}
async function applyImport(source) {
  const before = await state();
  await importFile(source);
  await settings.locator('[data-api-config-apply="import"]').waitFor();
  assert.equal((await state()).revision, before.revision, 'Preview cannot write settings');
  await settings.locator('[data-api-config-apply="import"]').click();
  return waitSaved(before.revision);
}
async function captureWebGl(mode, theme, width = 1100, forcedColors = 'none') {
  await settings.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
  await settings.emulateMedia({ colorScheme: theme, forcedColors, reducedMotion: 'reduce' });
  const row = settings.locator('[data-protection-feature="webgl"]'); await row.scrollIntoViewIfNeeded();
  if (forcedColors === 'active') { await settings.keyboard.press('Tab'); await row.locator('[data-protection-state="custom"]').focus(); }
  const metrics = await row.evaluate(element => {
    const button = element.querySelector('[data-protection-state="custom"]'), style = getComputedStyle(button);
    function color(value) { const parts = value.match(/[\d.]+/g)?.map(Number); return parts?.length >= 3 ? [...parts.slice(0, 3), parts[3] ?? 1] : null; }
    let background = [255, 255, 255, 1];
    const ancestors = []; for (let node = button; node; node = node.parentElement) ancestors.unshift(node);
    for (const node of ancestors) { const value = color(getComputedStyle(node).backgroundColor); if (value) background = value.slice(0, 3).map((channel, index) => channel * value[3] + background[index] * (1 - value[3])); }
    const luminance = channels => channels.slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((total, value, index) => total + value * [.2126, .7152, .0722][index], 0);
    const levels = [luminance(color(style.color)), luminance(background)].sort((a, b) => b - a);
    const range = document.createRange(); range.selectNodeContents(button); const text = range.getBoundingClientRect(), box = button.getBoundingClientRect();
    const probe = document.createElement('span'); probe.style.cssText = 'color:ButtonText;background:ButtonFace'; document.body.append(probe);
    const system = { color: getComputedStyle(probe).color, background: getComputedStyle(probe).backgroundColor }; probe.remove();
    return { color: style.color, background: style.backgroundColor, system, outlineWidth: parseFloat(style.outlineWidth), outlineOffset: parseFloat(style.outlineOffset), focusVisible: button.matches(':focus-visible'), contrast: (levels[0] + .05) / (levels[1] + .05), selected: button.getAttribute('aria-checked'), label: button.textContent.trim(), clipped: text.width > box.width + 1 || text.height > box.height + 1, overflow: document.documentElement.scrollWidth > innerWidth + 1, forcedColors: matchMedia('(forced-colors: active)').matches, pickerCount: element.querySelectorAll('[data-api-value-editor]').length };
  });
  assert.equal(metrics.label, redesignLabels('ru').modeCustom, 'ADR-103 decision 2: localized Custom label'); assert.equal(metrics.selected, String(mode === 'custom'));
  assert.equal(metrics.clipped, false); assert.equal(metrics.overflow, false); assert.ok(metrics.contrast >= 4.5, 'Custom text contrast: ' + JSON.stringify(metrics));
  assert.equal(metrics.pickerCount, mode === 'custom' ? 1 : 0); assert.equal(metrics.forcedColors, forcedColors === 'active');
  if (forcedColors === 'active') {
    assert.equal(metrics.color, metrics.system.color); assert.equal(metrics.background, metrics.system.background);
    assert.equal(metrics.focusVisible, true); assert.ok(metrics.outlineWidth >= 3 && metrics.outlineOffset >= 3, 'Custom keeps the existing distinct keyboard focus ring');
  }
  const file = 'webgl-' + mode + '-ru-' + theme + '-' + width + (forcedColors === 'active' ? '-forced-colors' : '') + '.png';
  const bytes = await settings.screenshot({ path: join(artifact, file) });
  evidence.visuals.push({ mode, theme, width, ...metrics, file, sha256: createHash('sha256').update(bytes).digest('hex') });
}
try {
  await launch();
  const consent = await send({ schemaVersion: 1, type: 'ui-data-consent-set', version: 1, accepted: true });
  assert.equal(consent.accepted, true);
  const scope = await send({ schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'all-sites' });
  assert.ok(['scope', 'ok'].includes(scope.type), JSON.stringify(scope));
  await settings.evaluate(() => chrome.storage.local.set({ 'ui-language-v1': 'en' }));
  fixture = await context.newPage(); await fixture.goto(origin + '/');
  const baseline = await fixture.evaluate(() => navigator.hardwareConcurrency);
  assert.ok(Number.isInteger(baseline) && baseline > 0);
  tabId = await settings.evaluate(url => chrome.tabs.query({}).then(tabs => tabs.find(tab => tab.url === url)?.id), origin + '/');
  assert.ok(Number.isInteger(tabId));
  await settings.goto('chrome-extension://' + extensionId + '/protection.html?tabId=' + tabId);
  await settings.locator('[data-api-configuration-editor]').waitFor();
  assert.equal(await settings.locator('[data-protection-feature]').count(), API_CONFIG_CATALOG.length);
  await settings.locator('[data-protection-scope="global"]').click();
  const original = await state(); assert.equal(original.configuration.enabled, false); assert.equal(original.configuration.antidetectEnabled, false);
  assert.equal(await settings.locator('[data-api-value-editor="hardware-concurrency"]').count(), 0);
  await settings.locator('[data-protection-feature="hardware-concurrency"] [data-protection-state="custom"]').click();
  const cpuMode = await waitSaved(original.revision);
  const cpu = settings.locator('[data-api-value-editor="hardware-concurrency"]');
  await cpu.locator('.api-value-picker').click();
  await settings.locator('[data-api-value-list="hardware-concurrency"]').selectOption(':create');
  await settings.locator('[data-api-value-name]').fill('Workstation 16 logical processors');
  await settings.locator('[data-api-value-input]').fill('16');
  await settings.locator('[data-api-value-save]').click();
  const created = await waitSaved(cpuMode.revision);
  const cpuConfig = created.configuration.apis.find(row => row.id === 'hardware-concurrency');
  assert.equal(cpuConfig.mode, 'custom'); assert.equal(cpuConfig.userValues.length, 1);
  assert.deepEqual(cpuConfig.selected, { kind: 'value', value: 16 });
  assert.equal(await fixture.evaluate(() => navigator.hardwareConcurrency), baseline, 'Saved values cannot enable a disabled master');
  await settings.locator('[data-protection-master]').click(); const apiOnly = await waitSaved(created.revision);
  assert.equal(apiOnly.configuration.enabled, true); assert.equal(apiOnly.configuration.antidetectEnabled, false);
  await fixture.reload(); assert.equal(await fixture.evaluate(() => navigator.hardwareConcurrency), baseline, 'API Guard master does not activate Custom');
  const activated = await send({ schemaVersion: 1, type: 'ui-api-config-set', tabId: null, expectedRevision: apiOnly.revision, configuration: { ...apiOnly.configuration, antidetectEnabled: true } });
  assert.equal(activated.type, 'api-config-state'); assert.equal(activated.configuration.enabled, true); assert.equal(activated.configuration.antidetectEnabled, true);
  // The explicit second master changes outside this editor; reopen its saved
  // view before later export/import UI scenarios inspect that configuration.
  await settings.reload(); await settings.locator('[data-api-configuration-editor][aria-busy="false"]').waitFor();
  await settings.locator('[data-protection-scope="global"]').click();
  await fixture.reload(); await fixture.waitForFunction(() => navigator.hardwareConcurrency === 16);
  evidence.checks.push('Real Create New Value modal saves CPU=16 and library without activating either master; API Guard alone preserves native CPU; explicit Antidetect activation applies 16 on the reloaded owned page');

  const source = await showExport(), exported = JSON.parse(source);
  assert.equal(importApiConfiguration(source).ok, true);
  assert.equal(exported.apis.length, API_CONFIG_CATALOG.length);
  assert.equal(exported.apis.find(row => row.id === 'webassembly').mode, 'bypass');
  assert.deepEqual(exported.apis.find(row => row.id === 'webassembly').userValues, []);
  const downloadPromise = settings.waitForEvent('download');
  await settings.locator('[data-api-config-apply="export"]').click();
  const download = await downloadPromise, downloaded = join(run, 'configuration.json');
  await download.saveAs(downloaded); assert.equal(readFileSync(downloaded, 'utf8'), source);
  evidence.checks.push('Export preview and downloaded JSON are identical; all ' + API_CONFIG_CATALOG.length + ' APIs, presets, unused settings and user values included');

  const beforeReset = await state();
  await settings.locator('[data-protection-reset]').click();
  await settings.locator('[data-protection-save]').click();
  const reset = await waitSaved(beforeReset.revision);
  assert.equal(reset.configuration.apis.find(row => row.id === 'hardware-concurrency').mode, 'bypass');
  await importFile(source); await settings.locator('[data-api-config-apply="import"]').waitFor();
  assert.equal((await state()).revision, reset.revision);
  await closePreview(); assert.equal((await state()).revision, reset.revision);
  const restored = await applyImport(source);
  assert.deepEqual(restored.configuration.apis.find(row => row.id === 'hardware-concurrency').selected, { kind: 'value', value: 16 });
  await settings.locator('[data-api-config-undo]').click();
  const undone = await waitSaved(restored.revision);
  assert.deepEqual(undone.configuration, reset.configuration);
  await applyImport(source);
  await fixture.reload(); await fixture.waitForFunction(() => navigator.hardwareConcurrency === 16);
  evidence.checks.push('Reset preserves libraries; Import preview and Cancel write nothing; Apply restores all settings; Undo restores previous configuration');

  const beforeInvalid = await state();
  await importFile('{invalid', 'invalid.json');
  await settings.locator('.api-config-transfer > [role="alert"]').waitFor();
  assert.equal((await state()).revision, beforeInvalid.revision);
  const invalid = JSON.parse(source); invalid.apis[1] = invalid.apis[0];
  await importFile(JSON.stringify(invalid), 'duplicate-api.json');
  await settings.locator('.api-config-transfer > [role="alert"]').waitFor();
  assert.equal((await state()).revision, beforeInvalid.revision);
  assert.deepEqual((await state()).configuration, beforeInvalid.configuration);
  evidence.checks.push('Malformed JSON and duplicate API import show an error and preserve prior settings and revision');

  const many = JSON.parse(source), manyCpu = many.apis.find(row => row.id === 'hardware-concurrency');
  manyCpu.userValues = Array.from({ length: 100 }, (_, index) => ({ id: `native-${index + 1}`, label: `Configuration ${String(index + 1).padStart(3, '0')}`, value: { kind: 'value', value: index + 1 } }));
  await applyImport(JSON.stringify(many));
  await cpu.locator('.api-value-picker').click();
  await cpu.locator('input[type="search"]').fill('Configuration 100');
  assert.equal(await cpu.locator('optgroup option').count(), 1);
  await settings.locator('[data-api-value-list="hardware-concurrency"]').selectOption('u:native-100');
  const beforeManySave = await state(); await settings.locator('[data-protection-save]').click(); await waitSaved(beforeManySave.revision);
  await fixture.reload(); await fixture.waitForFunction(() => navigator.hardwareConcurrency === 100);
  evidence.checks.push('100 imported CPU values remain available; search narrows the list; selected CPU=100 reaches the owned page');

  await settings.evaluate(() => chrome.storage.local.set({ 'ui-language-v1': 'ru' }));
  await settings.locator('[data-protection-search]').fill('webgl');
  const webglRow = settings.locator('[data-protection-feature="webgl"]'), webglEditor = settings.locator('[data-api-value-editor="webgl"]');
  assert.equal(await webglEditor.count(), 0, 'Initial Bypass does not show a Custom picker');
  const beforeWebglMode = await state();
  await webglRow.locator('[data-protection-state="custom"]').click();
  await waitSaved(beforeWebglMode.revision);
  await webglEditor.locator('.api-value-picker').click(); await settings.locator('[data-api-value-list="webgl"]').selectOption(':create');
  const webglValue = { vendor: 'WebKit', renderer: 'WebKit WebGL', unmaskedVendor: 'Test vendor', unmaskedRenderer: 'Saved WebGL test renderer' };
  await settings.locator('[data-api-value-name]').fill('Сохранённый WebGL'); await settings.locator('[data-api-value-input]').fill(JSON.stringify(webglValue));
  let beforeWebgl = await state(); await settings.locator('[data-api-value-save]').click(); await waitSaved(beforeWebgl.revision);
  const selectedWebgl = (await state()).configuration.apis.find(row => row.id === 'webgl');
  for (const mode of ['bypass', 'on', 'off']) {
    beforeWebgl = await state(); const navigated = fixture.waitForNavigation({ waitUntil: 'load' });
    await webglRow.locator('[data-protection-state="' + mode + '"]').click();
    const changed = await waitSaved(beforeWebgl.revision), row = changed.configuration.apis.find(row => row.id === 'webgl'); await navigated;
    assert.notEqual((await state()).documentId, beforeWebgl.documentId, 'A mode click reloads the exact source document');
    assert.equal(await webglEditor.count(), 0);
    assert.equal(row.mode, mode); assert.deepEqual(row.selected, selectedWebgl.selected); assert.deepEqual(row.userValues, selectedWebgl.userValues);
    const readback = await fixture.evaluate(expected => ['webgl', 'webgl2'].map(kind => { const gl = document.createElement('canvas').getContext(kind); if (!gl) return { available: false, custom: false }; gl.getExtension('WEBGL_debug_renderer_info'); return { available: true, custom: gl.getParameter(37446) === expected }; }), webglValue.unmaskedRenderer);
    assert.ok(readback.every(value => mode === 'on' ? !value.available : value.available && !value.custom), 'ON blocks WebGL; Bypass/OFF restore native values without a separate Save');
    if (mode === 'bypass') for (const theme of ['light', 'dark']) {
      await captureWebGl(mode, theme); await captureWebGl(mode, theme, 390);
    }
    if (mode === 'bypass') await captureWebGl(mode, 'light', 390, 'active');
    await settings.emulateMedia({ colorScheme: 'light', forcedColors: 'none' });
    const beforeCustom = await state(), customNavigation = fixture.waitForNavigation({ waitUntil: 'load' });
    await webglRow.locator('[data-protection-state="custom"]').click(); await waitSaved(beforeCustom.revision); await customNavigation;
    assert.equal(await webglEditor.count(), 1); assert.ok((await webglEditor.locator('.api-value-picker').textContent()).includes(webglValue.unmaskedRenderer));
    assert.equal(await fixture.evaluate(expected => { const gl = document.createElement('canvas').getContext('webgl'); gl.getExtension('WEBGL_debug_renderer_info'); return gl.getParameter(37446) === expected; }, webglValue.unmaskedRenderer), true);
    if (mode === 'bypass') for (const theme of ['light', 'dark']) {
      await captureWebGl('custom', theme); await captureWebGl('custom', theme, 390);
    }
    if (mode === 'bypass') await captureWebGl('custom', 'light', 390, 'active');
    await settings.emulateMedia({ colorScheme: 'light', forcedColors: 'none' });
  }
  evidence.checks.push('Real Russian WebGL mode clicks immediately persist and reload the exact source: ON blocks, BYPASS/OFF restore native, Custom restores the saved value; libraries and readable controls survive light/dark/mobile/forced-colors');
  const persisted = (await state()).configuration;

  await settings.setViewportSize({ width: 390, height: 844 });
  assert.ok(await settings.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal overflow at 390px');
  await settings.screenshot({ path: join(run, 'api-configuration-mobile.png'), fullPage: true });
  await context.close(); context = null;
  await launch();
  const restart = await send({ schemaVersion: 1, type: 'ui-api-config-get', tabId: null });
  assert.deepEqual(restart.configuration, persisted);
  fixture = await context.newPage(); await fixture.goto(origin + '/');
  await fixture.waitForFunction(() => navigator.hardwareConcurrency === 100);
  evidence.checks.push('Closing and reopening the same browser profile preserves full configuration and applies CPU=100 after browser restart');
  assert.deepEqual(evidence.errors, []);
  assert.deepEqual(evidence.requests, []);
  evidence.passed = true;
  console.log(`api-configuration-native: PASS (${evidence.checks.length} scenarios, ${evidence.browser})`);
} catch (error) {
  evidence.failure = error.stack ?? String(error);
  if (settings && !settings.isClosed()) await settings.screenshot({ path: join(run, 'failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  writeFileSync(join(run, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  writeFileSync(join(artifact, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  if (context) await context.close();
  await new Promise(done => server.close(done));
  console.log('Native evidence: ' + join(run, 'evidence.json'));
}
