// E22-12 / ADR-061: real mode clicks, first-inline WebGL and exact source reload.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { enableChromeUserScripts } from './api-custom-early-native.mjs';

const root = resolve(import.meta.dirname, '../..'); mkdirSync(join(root, '.tmp'), { recursive: true });
const argument = name => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; };
const run = mkdtempSync(join(root, '.tmp/api-mode-switches-')), extension = join(run, 'extension');
cpSync(resolve(argument('--dist') ?? join(root, 'dist/chrome')), extension, { recursive: true });
const artifact = resolve(argument('--output') ?? join(root, 'test-results/production-1.1.0/api-mode-switches')); mkdirSync(artifact, { recursive: true });
const chosen = { vendor: 'Owned Mode Vendor', renderer: 'Owned Mode Renderer', unmaskedVendor: 'Owned Mode GPU Vendor', unmaskedRenderer: 'Owned Mode GPU Renderer' };
function fixture(expected) {
  window.readOwnedGl = () => ['webgl', 'webgl2'].map(kind => {
    const gl = document.createElement('canvas').getContext(kind);
    let objectReads = 0;
    const objectContext = document.createElement('canvas').getContext({ toString() { objectReads++; return kind; } });
    if (!gl) return { available: false, custom: false, objectAvailable: !!objectContext, objectCustom: false, objectReads };
    gl.getExtension('WEBGL_debug_renderer_info');
    objectContext?.getExtension('WEBGL_debug_renderer_info');
    return { available: true, custom: [7936, 7937, 37445, 37446].every((id, index) => gl.getParameter(id) === Object.values(expected)[index]), objectAvailable: !!objectContext, objectCustom: objectContext?.getParameter(37446) === expected.unmaskedRenderer, objectReads };
  });
  window.ownedDocumentToken = Math.random(); window.ownedFirstGl = window.readOwnedGl();
  window.ownedCanvas2dPreserved = !!document.createElement('canvas').getContext({ toString() { return '2d'; } });
}
const body = '<!doctype html><meta charset="utf-8"><title>Owned API mode fixture</title><script>(' + fixture.toString() + ')(' + JSON.stringify(chosen) + ')</script><body>Owned API mode fixture';
let holdNextSource = false, heldResponse = null, heldStarted = null;
const server = createServer((request, response) => {
  request.resume(); response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.setHeader('Cache-Control', 'no-store');
  if (holdNextSource && request.url === '/source') { holdNextSource = false; heldResponse = response; heldStarted?.(); return; }
  response.end(body);
});
await new Promise(done => server.listen(0, '127.0.0.1', done)); const origin = 'http://127.0.0.1:' + server.address().port;
const evidence = { at: new Date().toISOString(), run, result: 'RUNNING', checks: [], errors: [], externalRequests: [], layouts: [],
  hashes: Object.fromEntries(['api-configuration-ui.js', 'api-configuration-ui.css', 'api-configuration-controller.js', 'api-custom-registration.js', 'protection.webgl.js'].map(file => [file, createHash('sha256').update(readFileSync(join(extension, file))).digest('hex')])) };
let context, ui, source, base, tabId, phase = 'launch';
const send = message => ui.evaluate(message => chrome.runtime.sendMessage({ schemaVersion: 1, ...message }), message);
const state = (target = null) => send({ type: 'ui-api-config-get', tabId: target });
const ready = () => ui.locator('[data-api-configuration-editor][aria-busy="false"]').waitFor();
const row = () => ui.locator('[data-protection-feature="webgl"]');
const check = message => { evidence.checks.push(message); console.log('  ok ' + message); };
// Below 1120 px (this window is 1100) the redesigned shell keeps its navigation behind the menu button, exactly as a user would open it.
async function openSection(section) {
  const menu = ui.locator('[data-management-menu-toggle]'); if (await menu.isVisible()) await menu.click();
  await ui.locator('[data-management-tab="' + section + '"]').click();
}
async function openUi(target = null) {
  await ui.goto(base + 'options.html' + (target === null ? '' : '?tabId=' + target) + '#api');
  // Reusing the same hash URL preserves the management document and its draft.
  // These independent cases explicitly start from the newly seeded saved state.
  await ui.reload(); await ready();
  await ui.locator('[data-protection-search]').fill('webgl');
}
async function seed() {
  const old = await state(), configuration = { ...old.configuration, enabled: true, antidetectEnabled: true, preset: 'custom', webrtcNetworkPolicy: 'system', sites: [],
    apis: old.configuration.apis.map(entry => entry.id === 'webgl' ? { ...entry, mode: 'custom', selected: { kind: 'value', value: chosen }, userValues: [{ id: 'owned-gl', label: 'Owned WebGL value', value: { kind: 'value', value: chosen } }] } : { ...entry, mode: 'bypass' }) };
  const result = await send({ type: 'ui-api-config-set', tabId: null, expectedRevision: old.revision, configuration });
  assert.equal(result.type, 'api-config-state'); assert.notEqual(result.registration, 'error'); return result;
}
async function mode(mode, expected) {
  const before = await state(tabId), beforeRow = before.configuration.apis.find(entry => entry.id === 'webgl');
  const navigated = source.waitForNavigation({ waitUntil: 'load' }); await row().locator('[data-protection-state="' + mode + '"]').click(); await ready(); await navigated;
  const after = await state(tabId); assert.equal(after.revision, before.revision + 1); assert.notEqual(after.documentId, before.documentId);
  assert.equal(await row().locator('[data-protection-state="' + mode + '"]').evaluate(element => element === document.activeElement), true, 'the applied radio keeps keyboard focus');
  const observed = await source.evaluate(() => ownedFirstGl); assert.equal(observed.length, 2);
  assert.ok(observed.every(value => value.objectReads === 1 && (expected === 'blocked' ? !value.available && !value.objectAvailable : value.available && value.objectAvailable && value.custom === (expected === 'custom') && value.objectCustom === (expected === 'custom'))));
  assert.equal(await source.evaluate(() => ownedCanvas2dPreserved), true);
  const afterRow = after.configuration.apis.find(entry => entry.id === 'webgl'); assert.deepEqual(afterRow.selected, beforeRow.selected); assert.deepEqual(afterRow.userValues, beforeRow.userValues);
  return after;
}
try {
  context = await chromium.launchPersistentContext(join(run, 'profile'), { channel: 'chromium', headless: true, viewport: { width: 1100, height: 950 },
    args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension, '--enable-unsafe-swiftshader'] });
  evidence.browser = context.browser().version();
  await context.route('**/*', route => { const url = new URL(route.request().url()); if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) { evidence.externalRequests.push(url.origin); return route.abort(); } return route.continue(); });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'); base = new URL('.', worker.url()).href;
  ui = await context.newPage(); ui.on('pageerror', error => evidence.errors.push(error.message)); await ui.goto(base + 'options.html#api');
  ui = await enableChromeUserScripts(context, ui, new URL(base).host, evidence); await send({ type: 'ui-data-consent-set', version: 1, accepted: true });
  await seed(); source = await context.newPage(); source.on('pageerror', error => evidence.errors.push(error.message)); await source.goto(origin + '/source');
  assert.ok((await source.evaluate(() => ownedFirstGl)).every(value => value.available && value.custom));
  tabId = await ui.evaluate(url => chrome.tabs.query({}).then(rows => rows.find(row => row.url === url).id), source.url());
  await openUi(tabId); await ui.locator('[data-protection-scope="global"]').click();
  for (const [selected, expected] of [['on', 'blocked'], ['custom', 'custom'], ['bypass', 'native'], ['custom', 'custom'], ['off', 'native'], ['custom', 'custom']]) {
    phase = 'global ' + selected; await mode(selected, expected); assert.equal(await ui.locator('[data-protection-save]').isDisabled(), true);
    check('click ' + selected.toUpperCase() + ' commits once and reloads only the source; first inline WebGL1/2 sees ' + expected + ' with the saved library retained');
  }
  phase = 'held reload'; const oldDocument = await state(tabId);
  holdNextSource = true; const held = new Promise(done => { heldStarted = done; }), heldNavigation = source.waitForNavigation({ waitUntil: 'load' });
  await row().locator('[data-protection-state="on"]').click(); await held;
  await new Promise(done => setTimeout(done, 500));
  assert.equal((await state(tabId)).documentId, oldDocument.documentId, 'held headers keep the old native document');
  assert.equal(await ui.locator('[data-api-configuration-editor]').getAttribute('aria-busy'), 'true');
  assert.equal(await row().locator('[data-protection-state="off"]').isDisabled(), true, 'a second mode cannot race an uncommitted reload');
  heldResponse.end(body); heldResponse = null; await heldNavigation; await ready();
  assert.notEqual((await state(tabId)).documentId, oldDocument.documentId); assert.ok((await source.evaluate(() => ownedFirstGl)).every(value => !value.available && !value.objectAvailable));
  check('a held reload keeps controls busy until the native source document changes; it never announces application while the old Custom document is still present');
  await mode('custom', 'custom');
  phase = 'bounded reload timeout'; const timedSource = await state(tabId);
  holdNextSource = true; const timedHeld = new Promise(done => { heldStarted = done; }), timedNavigation = source.waitForNavigation({ waitUntil: 'load' });
  await row().locator('[data-protection-state="on"]').click(); await timedHeld; await ready();
  assert.equal((await state(tabId)).documentId, timedSource.documentId); assert.equal((await state()).configuration.apis.find(entry => entry.id === 'webgl').mode, 'on');
  assert.equal(await row().locator('[data-api-row-status="webgl"]').getAttribute('role'), 'status');
  assert.match(await row().locator('[data-api-row-status="webgl"]').textContent(), /[Rr]eload|[Пп]ерезагруз/);
  heldResponse.end(body); heldResponse = null; await timedNavigation; await ready();
  assert.ok((await source.evaluate(() => ownedFirstGl)).every(value => !value.available));
  check('a slow reload times out within a bound with the mode saved and an explicit pending-reload status instead of a false application or storage failure');
  await mode('custom', 'custom');
  phase = 'unrelated drafts'; const before = await state();
  assert.equal(await ui.locator('[data-webrtc-network-policy-picker]').count(), 0, 'ADR-064: the native WebRTC policy picker is no longer part of API Guard');
  await ui.locator('[data-protection-preset-select]').selectOption('strict');
  // ADR-064 moved the native policy to the Antidetect Network level of the same Options page; that panel (and its draft) stays mounted behind its tab.
  await openSection('antidetect'); await ui.locator('[data-antidetect-app][aria-busy="false"]').waitFor(); await ui.locator('[data-antidetect-category="network"]').click();
  await ui.locator('[data-antidetect-network-policy]').selectOption('disable_non_proxied_udp');
  await openSection('api'); await ready();
  await mode('on', 'blocked'); const after = await state();
  assert.equal(after.configuration.preset, before.configuration.preset); assert.equal(after.configuration.webrtcNetworkPolicy, before.configuration.webrtcNetworkPolicy);
  assert.equal(await ui.locator('[data-protection-preset-select]').inputValue(), 'strict');
  assert.equal(await ui.locator('[data-protection-save]').isEnabled(), true);
  await openSection('antidetect'); await ui.locator('[data-antidetect-network-policy]').waitFor({ state: 'visible' });
  assert.equal(await ui.locator('[data-antidetect-network-policy]').inputValue(), 'disable_non_proxied_udp', 'the pending native-policy draft survives the API Guard mode click');
  await openSection('api'); await ready();
  check('a mode click preserves unrelated preset/native-policy drafts (preset in API Guard, native policy in the Antidetect Network level) and does not activate or persist either');
  phase = 'site inheritance'; await seed(); await source.reload(); await openUi(tabId);
  await ui.locator('[data-protection-scope="site"]').click();
  for (const [selected, expected] of [['off', 'native'], ['on', 'blocked'], ['bypass', 'custom']]) { phase = 'site ' + selected; await mode(selected, expected); }
  assert.match(await row().locator('[data-api-inherited-value="webgl"]').textContent(), /Custom/);
  check('site OFF overrides global Custom, ON blocks, and BYPASS explicitly inherits global Custom; source reload and saved library remain correct');
  phase = 'no source target'; await seed(); await source.reload(); const token = await source.evaluate(() => ownedDocumentToken); await openUi();
  const previous = await state(); await row().locator('[data-protection-state="bypass"]').click(); await ready();
  await ui.waitForFunction(async revision => (await chrome.runtime.sendMessage({ schemaVersion: 1, type: 'ui-api-config-get', tabId: null })).revision === revision + 1, previous.revision);
  assert.equal(await source.evaluate(() => ownedDocumentToken), token); assert.ok((await source.evaluate(() => readOwnedGl())).every(value => value.custom));
  const fresh = await context.newPage(); await fresh.goto(origin + '/fresh'); assert.ok((await fresh.evaluate(() => ownedFirstGl)).every(value => value.available && !value.custom)); await fresh.close();
  const status = ui.locator('[data-api-mode-status]'); assert.ok(await status.count() > 0); await status.first().scrollIntoViewIfNeeded(); assert.equal(await status.first().isVisible(), true);
  check('without a source tab the click persists for new pages and shows pending reload clearly; existing unrelated tabs are never reloaded');
  for (const layout of [{ locale: 'ru', theme: 'light', width: 1100, forcedColors: 'none' }, { locale: 'ru', theme: 'dark', width: 390, forcedColors: 'none' }, { locale: 'ar', theme: 'light', width: 390, forcedColors: 'active' }]) {
    await ui.evaluate(locale => chrome.storage.local.set({ 'ui-language-v1': locale }), layout.locale); await ui.setViewportSize({ width: layout.width, height: 900 });
    await ui.emulateMedia({ colorScheme: layout.theme, forcedColors: layout.forcedColors }); await row().scrollIntoViewIfNeeded();
    assert.equal(await ui.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    const file = 'modes-' + layout.locale + '-' + layout.theme + '.png'; await ui.screenshot({ path: join(artifact, file) }); evidence.layouts.push({ ...layout, file, overflow: false });
  }
  check('mode feedback and inherited Custom remain usable in RU light/dark and AR narrow forced colors');
  assert.deepEqual(evidence.errors, []); assert.deepEqual(evidence.externalRequests, []); evidence.result = 'PASS';
  console.log('PASS API mode switches: ' + evidence.checks.length + ' checks / ' + evidence.layouts.length + ' layouts');
} catch (error) { evidence.result = 'FAIL'; evidence.failure = { phase, error: String(error.stack ?? error) }; console.error(evidence.failure); process.exitCode = 1; }
finally { heldResponse?.destroy(); await context?.close(); await new Promise(done => server.close(done)); writeFileSync(join(artifact, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n'); }
