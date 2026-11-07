// Actual API Guard UI mode filters; all configuration belongs to this disposable extension/profile.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { updateApiConfiguration } from '../../packages/contracts/src/api-configuration.mjs';
import { MODE_FILTER_MESSAGES } from '../production-locales-mode-filters.mjs';

const root = resolve(import.meta.dirname, '../..');
const argument = name => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; };
const input = resolve(argument('--dist') ?? join(root, 'dist/chrome'));
mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/api-mode-filters-')), extension = join(run, 'extension'); cpSync(input, extension, { recursive: true });
const artifact = resolve(argument('--output') ?? join(root, 'test-results/production-1.1.0/api-mode-filters')); mkdirSync(artifact, { recursive: true });
const digest = value => createHash('sha256').update(value).digest('hex');
const evidence = { at: new Date().toISOString(), run, result: 'RUNNING', browser: null, checks: [], layouts: [], screenshots: [], errors: [], externalRequests: [],
  hashes: Object.fromEntries(['api-configuration-ui.js', 'api-configuration-ui.css', 'api-configuration.js', 'options.js'].map(file => [file, digest(readFileSync(join(extension, file)))])) };
let context, page, phase = 'startup';
const send = message => page.evaluate(message => chrome.runtime.sendMessage({ schemaVersion: 1, ...message }), message);
const state = async () => { const value = await send({ type: 'ui-api-config-get', tabId: null }); assert.equal(value.type, 'api-config-state'); return value; };
const ready = () => page.locator('[data-api-configuration-editor][aria-busy="false"]').waitFor();
const mode = value => page.locator('[data-api-mode-filter="' + value + '"]');
const category = value => page.locator('[data-protection-filter="' + value + '"]');
const row = id => page.locator('[data-protection-feature="' + id + '"]');
const search = () => page.locator('[data-protection-search]');
const rows = () => page.locator('[data-protection-feature]').evaluateAll(elements => elements.map(element => element.dataset.protectionFeature).sort());
const check = text => { evidence.checks.push(text); console.log('  ok ' + text); };
async function selected(value) {
  await page.waitForFunction(value => ['spoofed', 'blocked'].every(id => document.querySelector('[data-api-mode-filter="' + id + '"]')?.getAttribute('aria-pressed') === String(value === id)), value);
  for (const id of ['spoofed', 'blocked']) assert.equal(await mode(id).getAttribute('aria-pressed'), String(value === id));
}
async function exactRows(expected) {
  await page.waitForFunction(expected => JSON.stringify([...document.querySelectorAll('[data-protection-feature]')].map(element => element.dataset.protectionFeature).sort()) === JSON.stringify([...expected].sort()), expected);
  assert.deepEqual(await rows(), [...expected].sort()); for (const id of expected) await row(id).waitFor({ state: 'visible' });
}
async function counts(expectedModes, expectedCategories) {
  await page.waitForFunction(({ modes, categories }) => {
    const read = selector => [...document.querySelectorAll(selector)].map(element => Number(element.textContent));
    return JSON.stringify(read('[data-api-mode-filter-count]')) === JSON.stringify(modes) && (!categories || JSON.stringify(read('[data-protection-filter-count]')) === JSON.stringify(categories));
  }, { modes: expectedModes, categories: expectedCategories });
}
async function chooseMode(value) { await mode(value).click(); }
async function noConfigurationWrites(before) {
  const after = await state(); assert.equal(after.revision, before.revision); assert.deepEqual(after.configuration, before.configuration);
  assert.deepEqual(await page.evaluate(() => window.__modeFilterWrites), [], 'filters and drafts do not write storage');
}

try {
  context = await chromium.launchPersistentContext(join(run, 'profile'), { channel: 'chromium', headless: true, viewport: { width: 1100, height: 950 }, args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension] });
  evidence.browser = context.browser().version();
  await context.route('**/*', route => { const url = new URL(route.request().url()); if (['http:', 'https:'].includes(url.protocol)) { evidence.externalRequests.push(url.origin); return route.abort(); } return route.continue(); });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'); page = await context.newPage(); page.on('pageerror', error => evidence.errors.push({ phase, error: error.message }));
  await page.goto(new URL('options.html#api', worker.url()).href); await send({ type: 'ui-data-consent-set', version: 1, accepted: true }); await ready();
  await page.evaluate(() => chrome.storage.local.set({ 'ui-language-v1': 'en' }));
  const initial = await state(); let configuration = initial.configuration; assert.equal(configuration.enabled, false);
  assert.equal(configuration.apis.find(item => item.id === 'canvas-readback').customSupported, true, 'current Canvas projection supports Custom');
  assert.equal(configuration.apis.find(item => item.id === 'webassembly-memory-grow').customSupported, false, 'native WASM memory growth has no Custom profile');
  const patch = (id, value, host = null) => { const next = updateApiConfiguration(configuration, id, value, host); assert.equal(next.ok, true, id); configuration = next.value; };
  const cpuValue = { kind: 'value', value: 16 }, dormantGpu = structuredClone(configuration.apis.find(item => item.id === 'webgl').presets[0].value);
  patch('hardware-concurrency', { mode: 'custom', selected: cpuValue, userValues: [{ id: 'custom-1', label: 'Owned CPU fixture', value: cpuValue }] });
  patch('webgl', { mode: 'bypass', selected: dormantGpu, userValues: [{ id: 'custom-1', label: 'Dormant GPU fixture', value: dormantGpu }] });
  patch('canvas-readback', { mode: 'on' }); patch('webassembly-memory-grow', { mode: 'on' }); patch('navigator-user-agent', { mode: 'off' });
  patch('hardware-concurrency', { mode: 'bypass', selected: { kind: 'value', value: 8 } }, 'example.com');
  patch('screen-width', { mode: 'custom', selected: { kind: 'value', value: 1492 } }, 'example.com'); patch('battery', { mode: 'on' }, 'example.com');
  const persisted = await send({ type: 'ui-api-config-set', tabId: null, expectedRevision: initial.revision, configuration }); assert.equal(persisted.type, 'api-config-state');
  await page.reload(); await ready(); await mode('spoofed').waitFor(); let before = await state();
  await page.evaluate(() => { window.__modeFilterWrites = []; chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local') window.__modeFilterWrites.push(Object.keys(changes)); }); });

  // Catalog 10: 158 rows (ADR-087 added 15 to the original 143: +10 Hardware, +3 OS, +2 Browser); order All/Hardware/OS/Network/Browser/Social.
  phase = 'selected-scope modes'; await selected('all'); await counts([1, 2], [158, 50, 28, 11, 63, 6]);
  await chooseMode('spoofed'); await selected('spoofed'); await exactRows(['hardware-concurrency']); await counts([1, 2], [1, 1, 0, 0, 0, 0]);
  assert.equal(await row('webgl').count(), 0, 'a saved dormant Custom value is not Spoofed');
  await chooseMode('blocked'); await selected('blocked'); await exactRows(['canvas-readback', 'webassembly-memory-grow']); await counts([1, 2], [2, 1, 0, 0, 1, 0]);
  assert.equal(await row('navigator-user-agent').count(), 0, 'OFF means allow and is never Blocked');
  await chooseMode('blocked'); await selected('all'); assert.equal((await rows()).length, configuration.apis.length);
  await noConfigurationWrites(before);
  check('Spoofed selects actual Custom modes, Blocked selects ON, dormant values and OFF stay out, and clicking the selected chip returns to All');

  phase = 'category intersections'; await chooseMode('blocked'); await category('hardware').click(); await exactRows(['canvas-readback']); await counts([1, 1]);
  await category('browser').click(); await exactRows(['webassembly-memory-grow']); await counts([0, 1]); await search().fill('not-an-api'); await exactRows([]); await counts([0, 0]);
  await page.locator('[data-protection-filter-clear]').click(); await selected('all'); assert.equal(await category('all').getAttribute('aria-checked'), 'true');
  assert.equal(await search().inputValue(), ''); assert.equal(await category('all').evaluate(element => element === document.activeElement), true);
  assert.equal((await rows()).length, configuration.apis.length); await noConfigurationWrites(before);
  check('category and mode filters intersect, matching blocked WASM is visible, and Clear resets both rows and restores focus without writing settings');

  phase = 'faceted auxiliary filters'; const configured = page.locator('.blocking-filter input[type="checkbox"]').first(), customSupported = page.locator('.blocking-filter input[type="checkbox"]').nth(1);
  await chooseMode('blocked'); await customSupported.check(); await exactRows(['canvas-readback']); await counts([1, 1]);
  await customSupported.uncheck(); await configured.check(); await exactRows(['canvas-readback', 'webassembly-memory-grow']); await counts([1, 2]);
  await page.locator('[data-api-group-picker]').selectOption('webassembly'); await exactRows(['webassembly-memory-grow']); await counts([0, 1]);
  await search().fill('Memory.grow'); await exactRows(['webassembly-memory-grow']); await counts([0, 1]);
  await search().fill('not-an-api'); await exactRows([]); await counts([0, 0]); await page.locator('[data-protection-filter-clear]').click();
  assert.equal(await configured.isChecked(), false); assert.equal(await customSupported.isChecked(), false); assert.equal(await page.locator('[data-api-group-picker]').inputValue(), 'all');
  await selected('all'); await counts([1, 2]); await noConfigurationWrites(before);
  check('mode counts ignore their own selection while respecting category, group, search, configured-only and Custom support; Clear resets all facets');

  // ADR-061: mode clicks persist immediately. Restore only this disposable fixture after proving the exact write.
  const assertSavedMode = async (previous, id) => {
    await page.waitForFunction(({ revision, id }) => chrome.runtime.sendMessage({ schemaVersion: 1, type: 'ui-api-config-get', tabId: null }).then(value => value.revision > revision && value.configuration.apis.find(item => item.id === id).mode === 'bypass'), { revision: previous.revision, id });
    const current = await state(), expected = updateApiConfiguration(previous.configuration, id, { mode: 'bypass' }); assert.equal(expected.ok, true);
    assert.equal(current.revision, previous.revision + 1); assert.deepEqual(current.configuration, expected.value);
    const restored = await send({ type: 'ui-api-config-set', tabId: null, expectedRevision: current.revision, configuration: previous.configuration });
    assert.equal(restored.type, 'api-config-state'); assert.equal(restored.revision, current.revision + 1); assert.deepEqual(restored.configuration, previous.configuration);
    await page.reload(); await ready(); before = await state(); assert.deepEqual(before.configuration, previous.configuration);
    await page.evaluate(() => { window.__modeFilterWrites = []; chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local') window.__modeFilterWrites.push(Object.keys(changes)); }); });
  };
  phase = 'immediate saved-mode filtering'; await chooseMode('blocked'); await category('hardware').click();
  const canvasBefore = await state();
  await row('canvas-readback').locator('[data-protection-state="bypass"]').click(); await exactRows([]); await selected('blocked');
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-api-mode-filter') === 'blocked');
  await assertSavedMode(canvasBefore, 'canvas-readback'); await chooseMode('spoofed'); await exactRows(['hardware-concurrency']);
  const cpuBefore = await state();
  await row('hardware-concurrency').locator('[data-protection-state="bypass"]').click(); await exactRows([]); await selected('spoofed');
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-api-mode-filter') === 'spoofed');
  await assertSavedMode(cpuBefore, 'hardware-concurrency'); await noConfigurationWrites(before);
  check('changing ON or Custom to Bypass removes the row immediately and saves only that rule with one revision; explicit owned-fixture restoration preserves all libraries and other settings');

  phase = 'exact site scope'; await page.locator('[data-protection-scope="site"]').click(); await page.locator('[data-protection-host-picker]').selectOption('example.com');
  await chooseMode('spoofed'); await exactRows(['screen-width']); await chooseMode('blocked'); await exactRows(['battery']);
  await chooseMode('blocked'); await search().fill('hardware-concurrency'); await exactRows(['hardware-concurrency']);
  assert.equal(await page.locator('[data-api-inherited-value="hardware-concurrency"]').count(), 1);
  await chooseMode('spoofed'); await exactRows([]); await page.locator('[data-protection-filter-clear]').click();
  assert.equal(await page.locator('[data-protection-host-picker]').inputValue(), 'example.com');
  await page.locator('[data-protection-scope="global"]').click(); await noConfigurationWrites(before);
  check('site filters use the selected site modes; a Bypass row inheriting global Custom retains its value but does not falsely qualify as a site Custom rule');

  phase = 'native keyboard'; await mode('spoofed').focus(); await page.keyboard.press('ArrowRight'); await selected('blocked');
  assert.equal(await mode('blocked').evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('Home'); await selected('spoofed'); await page.keyboard.press('End'); await selected('blocked');
  await page.keyboard.press('Space'); await selected('all'); await page.keyboard.press('Enter'); await selected('blocked');
  await page.keyboard.press('Escape'); await selected('all'); assert.equal(await mode('blocked').evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('ArrowLeft'); await selected('spoofed'); await exactRows(['hardware-concurrency']);
  assert.equal(await mode('spoofed').getAttribute('tabindex'), '0'); assert.equal(await mode('blocked').getAttribute('tabindex'), '-1'); await noConfigurationWrites(before);
  check('native arrows, Home/End, Space/Enter and Escape select or clear the mutually exclusive chips with roving focus and no configuration writes');

  for (const layout of [{ locale: 'ru', theme: 'light', width: 1100, forcedColors: 'none' }, { locale: 'ru', theme: 'dark', width: 390, forcedColors: 'none' }, { locale: 'ar', theme: 'light', width: 390, forcedColors: 'active' }]) {
    phase = 'layout ' + layout.locale + '/' + layout.theme;
    await page.evaluate(locale => chrome.storage.local.set({ 'ui-language-v1': locale }), layout.locale);
    await page.waitForFunction(({ locale, label }) => document.documentElement.dir === (locale === 'ar' ? 'rtl' : 'ltr') && document.querySelector('[data-api-mode-filters]')?.getAttribute('aria-label') === label,
      { locale: layout.locale, label: MODE_FILTER_MESSAGES[layout.locale].protection_mode_filter_label });
    await page.setViewportSize({ width: layout.width, height: layout.width < 500 ? 844 : 950 }); await page.emulateMedia({ colorScheme: layout.theme, forcedColors: layout.forcedColors, reducedMotion: 'reduce' });
    await mode('spoofed').focus(); await page.keyboard.press('Home'); await selected('spoofed');
    await page.keyboard.press(layout.locale === 'ar' ? 'ArrowLeft' : 'ArrowRight'); await selected('blocked'); await exactRows(['canvas-readback', 'webassembly-memory-grow']);
    await page.keyboard.press(layout.locale === 'ar' ? 'ArrowRight' : 'ArrowLeft'); await selected('spoofed'); await exactRows(['hardware-concurrency']); await counts([1, 2]);
    assert.equal(await mode('spoofed').getAttribute('title'), MODE_FILTER_MESSAGES[layout.locale].protection_mode_filter_reset);
    await page.locator('.api-config-filter-groups').scrollIntoViewIfNeeded();
    const facts = await page.evaluate(() => {
      const rect = element => { const box = element.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height }; };
      return { overflow: document.documentElement.scrollWidth > innerWidth + 1, dir: document.documentElement.dir, forcedColors: matchMedia('(forced-colors: active)').matches,
        categoryRow: rect(document.querySelector('[data-protection-filters]')), modeRow: rect(document.querySelector('[data-api-mode-filters]')),
        controls: [...document.querySelectorAll('[data-api-mode-filter]')].map(element => { const box = element.getBoundingClientRect(), style = getComputedStyle(element); return { id: element.dataset.apiModeFilter, rect: rect(element), color: style.color, background: style.backgroundColor, border: style.borderColor, outline: style.outlineStyle,
          clipped: element.scrollWidth > element.clientWidth + 1, pressed: element.getAttribute('aria-pressed'), pieces: [...element.querySelectorAll('svg,.blocking-chip__label,.blocking-chip__count')].map(piece => { const part = piece.getBoundingClientRect(); return { rect: rect(piece), clipped: piece.scrollWidth > piece.clientWidth + 1 || part.left < box.left - 1 || part.right > box.right + 1 || part.top < box.top - 1 || part.bottom > box.bottom + 1 }; }) }; }) };
    });
    assert.equal(facts.overflow, false); assert.equal(facts.forcedColors, layout.forcedColors === 'active'); assert.equal(facts.controls.length, 2);
    // ADR-103 single filter panel: the mode chips follow the category chips on the same row (inline end, behind a divider) and wrap onto their own row below on narrow viewports; they never overlap.
    const categories = facts.categoryRow, modes = facts.modeRow, wrapped = modes.y >= categories.y + categories.height - 1;
    const inline = Math.abs(modes.y - categories.y) <= 2 && (facts.dir === 'rtl' ? modes.x + modes.width <= categories.x + 1 : modes.x >= categories.x + categories.width - 1);
    assert.ok(wrapped || inline, 'mode filters follow the category chips inline or on a row below and never overlap them');
    assert.equal(wrapped, layout.width < 500, layout.width < 500 ? 'narrow: mode filters wrap onto a separate row below all category chips' : 'desktop: mode filters share the category row at the inline end'); facts.arrangement = wrapped ? 'wrapped-below' : 'inline';
    for (const control of facts.controls) { assert.ok(control.rect.width >= 90); assert.ok(control.rect.height >= 30); assert.equal(control.clipped, false); assert.ok(control.pieces.every(piece => !piece.clipped)); }
    assert.notEqual(facts.controls[0].color, facts.controls[0].background, 'selected label is not the same color as its fill');
    const file = 'api-mode-filters-' + layout.locale + '-' + layout.theme + '-' + layout.width + (layout.forcedColors === 'active' ? '-forced' : '') + '.png';
    const bytes = await page.locator('.api-config-filter-groups').screenshot({ path: join(artifact, file) }); evidence.screenshots.push({ file, sha256: digest(bytes) }); evidence.layouts.push({ ...layout, ...facts });
    const after = await state(); assert.equal(after.revision, before.revision); assert.deepEqual(after.configuration, before.configuration);
  }
  check('RU desktop light, RU narrow dark and AR narrow forced-colors show both labels, icons and counts without clipping; native RTL keyboard works and all saved selections/libraries remain exact');
  evidence.result = 'PASS'; assert.deepEqual(evidence.errors, []); assert.deepEqual(evidence.externalRequests, []);
  console.log('PASS API mode filters native: ' + evidence.checks.length + ' checks');
} catch (error) { evidence.result = 'FAIL'; evidence.failure = { phase, error: String(error.stack ?? error) }; console.error(evidence.failure); process.exitCode = 1; }
finally { writeFileSync(join(artifact, 'api-mode-filters-native.json'), JSON.stringify(evidence, null, 2) + '\n'); await context?.close(); }
