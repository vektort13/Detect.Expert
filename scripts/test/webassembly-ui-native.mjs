// ADR-059: real API Guard disclosure, filtering and immediate row persistence in a disposable extension/profile.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { API_CONFIG_CATALOG } from '../../packages/contracts/src/api-configuration.mjs';
import { WASM_SURFACES } from '../../packages/contracts/src/webassembly-apis.mjs';
import { WEBASSEMBLY_UI_MESSAGES } from '../production-locales-webassembly.mjs';

const root = resolve(import.meta.dirname, '../..');
const arg = name => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; };
const input = resolve(arg('--dist') ?? join(root, 'dist/chrome'));
mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/webassembly-ui-')), extension = join(run, 'extension'); cpSync(input, extension, { recursive: true });
const artifact = resolve(arg('--output') ?? join(root, 'test-results/production-1.1.0/webassembly-ui')); mkdirSync(artifact, { recursive: true });
const evidence = { at: new Date().toISOString(), run, result: 'RUNNING', browser: null, checks: [], layouts: [], screenshots: [], errors: [], externalRequests: [],
  hashes: Object.fromEntries(['api-configuration-ui.js', 'api-configuration-ui.css', 'api-configuration.js', 'protection-ui.js', 'webassembly-apis.js'].map(file => [file, createHash('sha256').update(readFileSync(join(extension, file))).digest('hex')])) };
let context, page, phase = 'startup';
const send = message => page.evaluate(message => chrome.runtime.sendMessage({ schemaVersion: 1, ...message }), message);
const state = async () => { const value = await send({ type: 'ui-api-config-get', tabId: null }); assert.equal(value.type, 'api-config-state'); return value; };
const ready = () => page.locator('[data-api-configuration-editor][aria-busy="false"]').waitFor();
const toggle = () => page.locator('[data-api-wasm-toggle]');
const children = () => page.locator('[data-api-wasm-children]');
const search = () => page.locator('[data-protection-search]');
const operation = id => page.locator('[data-protection-feature="' + id + '"]');
const check = text => { evidence.checks.push(text); console.log('  ok ' + text); };
async function expanded(value) { await page.waitForFunction(value => document.querySelector('[data-api-wasm-toggle]')?.getAttribute('aria-expanded') === String(value) && document.querySelector('[data-api-wasm-children]')?.hidden === !value, value); }
async function saved(revision) { await page.waitForFunction(async revision => (await chrome.runtime.sendMessage({ schemaVersion: 1, type: 'ui-api-config-get', tabId: null })).revision > revision, revision); await ready(); return state(); }

try {
  context = await chromium.launchPersistentContext(join(run, 'profile'), { channel: 'chromium', headless: true, viewport: { width: 1100, height: 950 }, args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension] });
  evidence.browser = context.browser().version();
  await context.route('**/*', route => { if (/^https?:/.test(route.request().url())) { evidence.externalRequests.push(new URL(route.request().url()).origin); return route.abort(); } return route.continue(); });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  page = await context.newPage(); page.on('pageerror', error => evidence.errors.push({ phase, error: error.message }));
  await page.goto(new URL('options.html#api', worker.url()).href);
  await send({ type: 'ui-data-consent-set', version: 1, accepted: true }); await ready();
  const initial = await state(); assert.equal(initial.configuration.enabled, false, 'fresh API Guard stays OFF throughout this UI test');
  assert.equal(initial.configuration.apis.length, API_CONFIG_CATALOG.length);
  await page.evaluate(() => { window.__wasmUiWrites = []; chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local') window.__wasmUiWrites.push(Object.keys(changes)); }); });
  phase = 'compact defaults'; await expanded(false);
  assert.equal(await page.locator('[data-protection-feature]').count(), API_CONFIG_CATALOG.length);
  assert.equal(await page.locator('[data-protection-feature]:visible').count(), API_CONFIG_CATALOG.length - WASM_SURFACES.length);
  assert.equal(await children().getAttribute('data-api-wasm-count'), '37');
  assert.equal(await children().evaluate(element => element.inert), true);
  assert.equal(await operation('webassembly').isVisible(), true);
  const counts = await page.locator('[data-protection-filter]').evaluateAll(elements => elements.map(element => Number(element.querySelector('.blocking-chip__count')?.textContent)));
  // Catalog 10 has 158 rows (ADR-087 added 15 to the original 143: +10 Hardware, +3 OS, +2 Browser); All/Hardware/OS/Network/Browser/Social.
  assert.deepEqual(counts, [158, 50, 28, 11, 63, 6]); evidence.filterCounts = counts;
  assert.equal(counts[0], API_CONFIG_CATALOG.length);
  await page.locator('[data-protection-filter="browser"]').click(); assert.equal(await page.locator('[data-protection-feature]').count(), 63);
  await page.locator('[data-protection-filter="all"]').click();
  check('158 logical rows retain the 121-row compact view; Browser contains 63 and 37 child operations start hidden and inert');

  phase = 'native keyboard'; await toggle().focus(); await page.keyboard.press('Space'); await expanded(true);
  const names = await children().locator('.blocking-rule__name').allTextContents(); assert.deepEqual(names, WASM_SURFACES.map(row => row.operation));
  assert.equal(await children().locator('[data-protection-state="custom"]:not(:disabled)').count(), 0);
  assert.equal(await children().locator('[data-api-value-editor]').count(), 0);
  await page.keyboard.press('Enter'); await expanded(false); assert.equal(await toggle().evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('Space'); await expanded(true);
  assert.deepEqual(await page.evaluate(() => window.__wasmUiWrites), [], 'disclosure and category filters do not write storage or settings');
  check('native Space/Enter disclose the same 37 canonical technical names with keyboard focus preserved; resource Custom is unavailable');

  phase = 'immediate row'; const id = 'webassembly-memory-grow';
  await operation(id).locator('[data-protection-state="on"]').click(); const changed = await saved(initial.revision);
  assert.equal(changed.revision, initial.revision + 1, 'one mode click creates exactly one persisted revision');
  assert.equal(changed.configuration.enabled, false); assert.equal(changed.configuration.apis.find(row => row.id === id).mode, 'on');
  assert.deepEqual(changed.configuration.apis.filter(row => row.id !== id), initial.configuration.apis.filter(row => row.id !== id));
  await page.waitForFunction(() => window.__wasmUiWrites.filter(keys => keys.includes('api-configuration:v1')).length === 1);
  const modeWrites = await page.evaluate(() => window.__wasmUiWrites);
  await toggle().click(); await expanded(false); await toggle().click(); await expanded(true);
  assert.equal(await operation(id).locator('[data-protection-state="on"]').getAttribute('aria-checked'), 'true');
  await search().fill('WebAssembly'); await expanded(true); assert.equal(await page.locator('[data-protection-feature]').count(), 38);
  await search().fill('Memory.grow'); assert.equal(await page.locator('[data-protection-feature]').count(), 1);
  assert.equal(await operation(id).locator('[data-protection-state="on"]').getAttribute('aria-checked'), 'true');
  await search().fill(''); await page.locator('[data-api-group-picker]').selectOption('webassembly'); await expanded(true); assert.equal(await page.locator('[data-protection-feature]').count(), 38);
  await page.locator('[data-api-group-picker]').selectOption('all');
  const configured = page.locator('.blocking-filter input[type="checkbox"]').first(); await toggle().click(); await expanded(false); await configured.check(); await expanded(true);
  assert.equal(await page.locator('[data-protection-feature]').count(), 1); await configured.uncheck();
  const afterFilters = await state(); assert.equal(afterFilters.revision, changed.revision); assert.deepEqual(afterFilters.configuration, changed.configuration);
  assert.deepEqual(await page.evaluate(() => window.__wasmUiWrites), modeWrites, 'disclosure and filters add no storage or settings writes after the immediate row commit');
  await operation(id).locator('[data-protection-state="bypass"]').click(); const restored = await saved(changed.revision);
  assert.equal(restored.revision, changed.revision + 1);
  assert.deepEqual(restored.configuration, initial.configuration);
  assert.equal(await page.evaluate(() => window.__wasmUiWrites.filter(keys => keys.includes('api-configuration:v1')).length), 2);
  check('ON immediately persists only the clicked row once; collapse, search and configured-only add no writes; BYPASS immediately restores the initial configuration without Save');

  for (const layout of [{ locale: 'ru', theme: 'light', width: 1100, forcedColors: 'none' }, { locale: 'ru', theme: 'dark', width: 390, forcedColors: 'none' }, { locale: 'ar', theme: 'light', width: 390, forcedColors: 'active' }]) {
    phase = 'layout ' + layout.locale + '/' + layout.theme;
    await page.evaluate(locale => chrome.storage.local.set({ 'ui-language-v1': locale }), layout.locale);
    await page.waitForFunction(({ locale, label }) => document.documentElement.dir === (locale === 'ar' ? 'rtl' : 'ltr') && document.querySelector('[data-api-wasm-toggle]')?.getAttribute('aria-label') === label, { locale: layout.locale, label: WEBASSEMBLY_UI_MESSAGES[layout.locale].protection_webassembly_collapse + ' — WebAssembly' });
    await page.setViewportSize({ width: layout.width, height: layout.width < 500 ? 844 : 950 }); await page.emulateMedia({ colorScheme: layout.theme, forcedColors: layout.forcedColors, reducedMotion: 'reduce' });
    await search().fill('WebAssembly'); await expanded(true);
    assert.equal(await toggle().getAttribute('aria-label'), WEBASSEMBLY_UI_MESSAGES[layout.locale].protection_webassembly_collapse + ' — WebAssembly');
    await page.locator('[data-protection-group="webassembly"]').evaluate(element => window.scrollTo(0, element.getBoundingClientRect().top + scrollY - 100));
    const facts = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1, dir: document.documentElement.dir, forcedColors: matchMedia('(forced-colors: active)').matches,
      heading: (() => { const element = document.querySelector('[data-api-wasm-toggle]'), box = element.getBoundingClientRect(); return { width: box.width, height: box.height, clipped: element.scrollWidth > element.clientWidth + 1 }; })(),
      rows: [...document.querySelectorAll('[data-api-wasm-children] .api-config-rule')].map(element => ({ clipped: element.scrollWidth > element.clientWidth + 1, name: element.querySelector('.blocking-rule__name').textContent })) }));
    assert.equal(facts.overflow, false); assert.equal(facts.heading.clipped, false); assert.ok(facts.heading.width > 200); assert.equal(facts.forcedColors, layout.forcedColors === 'active'); assert.equal(facts.rows.length, 37); assert.ok(facts.rows.every(row => !row.clipped));
    const file = 'webassembly-' + layout.locale + '-' + layout.theme + '-' + layout.width + (layout.forcedColors === 'active' ? '-forced' : '') + '.png';
    const bytes = await page.screenshot({ path: join(artifact, file) }); evidence.screenshots.push({ file, sha256: createHash('sha256').update(bytes).digest('hex') }); evidence.layouts.push({ ...layout, ...facts });
  }
  check('RU desktop light, RU narrow dark and AR narrow forced-colors fit without clipping and use the canonical RU/AR group actions');
  assert.deepEqual(evidence.errors, []); assert.deepEqual(evidence.externalRequests, []); evidence.result = 'PASS'; console.log('PASS WebAssembly UI native: ' + evidence.checks.length + ' checks');
} catch (error) { evidence.result = 'FAIL'; evidence.failure = { phase, error: String(error.stack ?? error) }; console.error(evidence.failure); process.exitCode = 1; }
finally { writeFileSync(join(artifact, 'webassembly-ui-native.json'), JSON.stringify(evidence, null, 2) + '\n'); await context?.close(); }
