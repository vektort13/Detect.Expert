import { PROTECTION_FEATURES } from '../packages/contracts/src/protection-features.mjs';
import { API_CONFIG_CATALOG } from '../packages/contracts/src/api-configuration.mjs';
import { enableChromeUserScripts } from './test/api-custom-early-native.mjs';
import { readNativeToolbar, verifyNativeToolbar } from './test/toolbar-native-fixture.mjs';
import { nativeProtectionProbe, verifyNativeProtection } from './test/protection-native-fixture.mjs';
import { PROTECTION_FEATURE_FILTER, PROTECTION_FILTERS } from '../apps/production-extension/protection-ui.js';
// ADR-033/ADR-046: native extension clicks and keys, one owned loopback canvas fixture.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { PRODUCTION_LANGUAGES } from './production-languages.mjs';

const root = resolve(import.meta.dirname, '..'), temporary = join(root, '.tmp'), artifact = join(root, 'test-results/production-1.1.0/blocking');
mkdirSync(temporary, { recursive: true }); mkdirSync(artifact, { recursive: true });
const run = mkdtempSync(join(temporary, 'blocking-chrome-')), extension = join(run, 'extension');
cpSync(join(root, 'dist/chrome'), extension, { recursive: true });
const RULES = PROTECTION_FEATURES.length, API_ROWS = API_CONFIG_CATALOG.length, SCRIPT_PREFIX = 'detector-protection-v1-';
const files = ['api-configuration-ui.js', 'api-configuration-ui.css', 'api-configuration.js', 'api-custom.main.js', 'protection-ui.js', 'protection-ui.css', 'protection.html', 'popup.js', 'sidepanel.js', 'options.js', 'background.js', 'bridge.js', 'protection-runtime.js', 'manifest.json', ...PROTECTION_FEATURES.map(id => 'protection.' + id + '.js')];
const evidence = { at: new Date().toISOString(), checks: [], layout: [], errors: [], unexpectedRequests: [], packagedHashes: Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(join(extension, file))).digest('hex')])) };
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return; }
  if (request.url === '/fixture.js') {
    response.setHeader('Content-Type', 'application/javascript');
    response.end('window.fixtureReady=true;window.readCanvas=()=>{try{return document.getElementById("fixture-canvas").toDataURL().startsWith("data:image/png")?"native":"unexpected";}catch(e){return e.name;}};'); return;
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end('<!doctype html><html><head><title>Owned blocking fixture</title></head><body><canvas id="fixture-canvas" width="2" height="2"></canvas><script src="/fixture.js"></script></body></html>');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const host = 'blocking.example.com', origin = 'http://' + host + ':' + server.address().port;
let context;
try {
  context = await chromium.launchPersistentContext(join(run, 'profile'), { channel: 'chromium', headless: true, viewport: { width: 1080, height: 1000 }, args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension, '--no-proxy-server', '--unsafely-treat-insecure-origin-as-secure=' + origin, '--host-resolver-rules=MAP ' + host + ' 127.0.0.1'] });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['http:', 'https:'].includes(url.protocol) || url.origin === origin) await route.continue();
    else { evidence.unexpectedRequests.push(url.origin); await route.abort(); }
  });
  evidence.browser = context.browser().version();
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'), id = new URL(worker.url()).host;
  let inspector = await context.newPage(); inspector.on('pageerror', error => evidence.errors.push(error.message));
  await inspector.goto('chrome-extension://' + id + '/popup.html');
  inspector = await enableChromeUserScripts(context, inspector, id, evidence);
  await inspector.goto('chrome-extension://' + id + '/popup.html');
  const send = message => inspector.evaluate(message => chrome.runtime.sendMessage(message), message);
  assert.equal((await send({ schemaVersion: 1, type: 'ui-data-consent-get' })).accepted, true);
  assert.equal(await inspector.locator('[data-action="accept-data-consent"]').count(), 0);
  await inspector.evaluate(() => chrome.storage.local.set({ 'ui-language-v1': 'ru' }));
  const fixture = await context.newPage(); await fixture.goto(origin + '/'); await fixture.waitForFunction(() => window.fixtureReady);
  const tab = await inspector.evaluate(url => chrome.tabs.query({}).then(tabs => tabs.find(tab => tab.url === url)), origin + '/');
  assert.ok(Number.isInteger(tab.id));
  await inspector.evaluate(tabId => chrome.tabs.update(tabId, { active: true }), tab.id); await inspector.reload();
  const state = () => send({ schemaVersion: 1, type: 'ui-protection-get', tabId: tab.id });
  const initial = await state(); assert.equal(initial.settings.enabled, false);
  const toolbar = mode => verifyNativeToolbar(() => inspector.evaluate(readNativeToolbar, tab.id), mode, evidence);
  await toolbar('observing');
  await inspector.locator('[data-protection-launcher]').waitFor();
  assert.equal(await inspector.locator('[data-protection-master]').getAttribute('aria-checked'), 'false');
  const settingsPromise = context.waitForEvent('page'); await inspector.locator('[data-protection-open]').click();
  const settings = await settingsPromise; settings.on('pageerror', error => evidence.errors.push(error.message));
  await settings.waitForURL('**/protection.html?tabId=' + tab.id); await settings.locator('[data-protection-feature="canvas-readback"]').waitFor();
  assert.deepEqual((await state()).settings, initial.settings, 'Opening settings cannot enable or write rules');
  evidence.checks.push('trusted consent click; launcher under mode tabs opens separate extension page with originating numeric tabId; opening writes no policy');
  const clickMode = async mode => {
    const selector = '[data-protection-feature="canvas-readback"] [data-protection-state="' + mode + '"]';
    await settings.locator(selector).click();
    await settings.locator(selector + '[aria-checked="true"]').waitFor();
    const rgb = await settings.locator(selector).evaluate(element => getComputedStyle(element).backgroundColor.match(/[0-9]+/g).slice(0, 3).map(Number));
    const channel = { on: 1, bypass: 2, off: 0 }[mode];
    assert.ok(rgb.every((value, index) => index === channel || rgb[channel] > value), 'Selected ' + mode + ' uses its requested color');
  };
  const save = async (reload = false) => {
    const beforeState = await state(), before = beforeState.settings.revision;
    await settings.locator(reload ? '[data-protection-save-reload]' : '[data-protection-save]').click();
    let after;
    for (let attempt = 0; attempt < 60; attempt++) {
      after = await state();
      if (after.settings.revision > before && (!reload || after.documentId !== null && after.documentId !== beforeState.documentId)) break;
      await settings.waitForTimeout(100);
    }
    assert.ok(after.settings.revision > before);
    if (reload) { assert.notEqual(after.documentId, beforeState.documentId); await fixture.waitForLoadState('load'); await fixture.waitForFunction(() => window.fixtureReady); }
  };
  await clickMode('on'); await save();
  assert.equal((await state()).settings.enabled, false, 'API ON does not implicitly enable master');
  assert.equal(await fixture.evaluate(() => window.readCanvas()), 'native');
  await settings.locator('[data-protection-master]').click();
  await settings.waitForFunction(() => document.querySelector('[data-protection-master]')?.getAttribute('aria-checked') === 'true');
  assert.equal((await state()).settings.enabled, true);
  await inspector.waitForFunction(() => document.querySelector('[data-protection-master]')?.getAttribute('aria-checked') === 'true');
  await toolbar('blocking');
  await inspector.locator('[data-observation-master]').click();
  await inspector.waitForFunction(() => document.querySelector('[data-observation-master]')?.getAttribute('aria-checked') === 'false');
  await toolbar('off');
  await inspector.locator('[data-observation-master]').click();
  await inspector.waitForFunction(() => document.querySelector('[data-observation-master]')?.getAttribute('aria-checked') === 'true');
  await toolbar('blocking');
  await fixture.reload(); await fixture.waitForFunction(() => window.fixtureReady);
  assert.equal(await fixture.evaluate(() => window.readCanvas()), 'SecurityError');
  evidence.checks.push('row ON retains disabled master; explicit master ON persists; native canvas is blocked only after activation and fixture reload');
  await clickMode('off'); await save(true);
  assert.equal(await fixture.evaluate(() => window.readCanvas()), 'native');
  assert.equal((await state()).settings.sites.find(site => site.host === host).rules.find(rule => rule.feature === 'canvas-readback').state, 'allow');
  await settings.locator('[data-protection-scope="global"]').click();
  await clickMode('on'); await save();
  await settings.locator('[data-protection-scope="site"]').click();
  await clickMode('bypass'); await save(true);
  assert.equal((await state()).settings.sites.find(site => site.host === host).rules.some(rule => rule.feature === 'canvas-readback'), false);
  assert.equal(await fixture.evaluate(() => window.readCanvas()), 'SecurityError');
  evidence.checks.push('OFF creates explicit allow; BYPASS removes exact-host override and inherits global ON; save/reload remains bound to fixture tab');
  await settings.locator('[data-protection-master]').click();
  await settings.waitForFunction(() => document.querySelector('[data-protection-master]')?.getAttribute('aria-checked') === 'false');
  await inspector.waitForFunction(() => document.querySelector('[data-protection-master]')?.getAttribute('aria-checked') === 'false');
  await fixture.reload(); await fixture.waitForFunction(() => window.fixtureReady);
  assert.equal(await fixture.evaluate(() => window.readCanvas()), 'native');
  const disabled = await state(); assert.equal(disabled.settings.enabled, false); assert.equal(disabled.settings.global.find(rule => rule.feature === 'canvas-readback').state, 'block');
  await toolbar('observing');
  await settings.locator('[data-protection-feature="canvas-readback"] [aria-checked="true"]').waitFor();
  await settings.locator('[data-protection-feature="canvas-readback"] [aria-checked="true"]').focus();
  await settings.keyboard.press('Home');
  await settings.locator('[data-protection-feature="canvas-readback"] [data-protection-state="on"][aria-checked="true"]').waitFor();
  await settings.keyboard.press('End');
  await settings.locator('[data-protection-feature="canvas-readback"] [data-protection-state="off"][aria-checked="true"]').waitFor();
  await settings.keyboard.press('ArrowLeft');
  await settings.locator('[data-protection-feature="canvas-readback"] [data-protection-state="bypass"][aria-checked="true"]').waitFor();
  assert.deepEqual((await state()).settings, disabled.settings, 'Keyboard row edits remain drafts until save');
  evidence.checks.push('green ON, blue BYPASS, red OFF; keyboard Home/End/Arrow keys select rows without writing until Save');
  await inspector.locator('#popup-mode-tab-pro').click();
  assert.equal(await inspector.locator('[data-protection-launcher]').count(), 1);
  evidence.checks.push('master OFF restores native calls and retains all rules; launcher remains available in Pro');
  const chipLineLimit = { 360: 3, 600: 2, 1080: 1 };
  for (const language of PRODUCTION_LANGUAGES) {
    await settings.evaluate(locale => chrome.storage.local.set({ 'ui-language-v1': locale }), language.id);
    const table = JSON.parse(readFileSync(join(extension, language.uiOnly ? 'ui-locales' : '_locales', language.id, 'messages.json'), 'utf8'));
    await settings.waitForFunction(title => document.querySelector('h1')?.textContent === title, table.protection_page_title.message);
    for (const width of [360, 600, 1080]) {
      await settings.setViewportSize({ width, height: 1000 });
      const geometry = await settings.evaluate(support => {
        const box = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height }; };
        const rows = [...document.querySelectorAll('[data-protection-feature]')], chips = [...document.querySelectorAll('[data-protection-filter]')];
        const chipBoxes = chips.map(box), filter = document.querySelector('.blocking-filter'), group = document.querySelector('[data-protection-group]');
        let chipLines = 0, lineTop = -Infinity;
        for (const top of chipBoxes.map(entry => entry.top).sort((a, b) => a - b)) if (top - lineTop > 4) { chipLines++; lineTop = top; }
        return { width: innerWidth, documentWidth: document.documentElement.scrollWidth, rows: rows.length,
          malformed: rows.filter(row => {
            const buttons = [...row.querySelectorAll('[data-protection-state]')]; if (buttons.length !== 4) return true;
            if (buttons.map(button => button.textContent).join('|') !== 'ON|BYPASS|OFF|Custom') return true;
            const rects = buttons.map(button => button.getBoundingClientRect()); if (rects.some(rect => Math.abs(rect.top - rects[0].top) > 1)) return true;
            const rowBox = row.getBoundingClientRect();
            if (rects.some(rect => rect.left < rowBox.left - 1 || rect.right > rowBox.right + 1 || rect.height < 24)) return true;
            if (buttons.some(button => button.scrollWidth > button.clientWidth + 1)) return true;
            const custom = buttons.find(button => button.dataset.protectionState === 'custom'), supported = support[row.dataset.protectionFeature];
            if (custom.disabled !== !supported || supported !== Boolean(row.querySelector('.api-value-picker'))) return true;
            const description = row.querySelector('.api-config-rule__description')?.getBoundingClientRect(), states = buttons[0].parentElement.getBoundingClientRect();
            return !description || description.left < rowBox.left - 1 || description.right > rowBox.right + 1 || description.top < states.bottom - 1 && description.bottom > states.top + 1 && description.right > states.left + 1 && description.left < states.right - 1;
          }).map(row => row.dataset.protectionFeature),
          customSupported: rows.filter(row => !row.querySelector('[data-protection-state="custom"]').disabled).map(row => row.dataset.protectionFeature),
          selected: [...document.querySelectorAll('[data-protection-state][aria-checked="true"]')].length,
          filter: document.querySelector('[data-protection-filter][aria-checked="true"]')?.dataset.protectionFilter ?? null,
          chips: chips.map((chip, index) => { const label = chip.querySelector('.blocking-chip__label'); return { id: chip.dataset.protectionFilter, ...chipBoxes[index], labelClipped: !label || label.scrollWidth > label.clientWidth + 1 }; }),
          chipLines, filterBottom: filter ? filter.getBoundingClientRect().bottom : null, firstGroupTop: group ? group.getBoundingClientRect().top : null,
          forbidden: document.body.textContent.includes('Установка для этого API не подтверждена') || document.body.textContent.includes('Высокий риск поломок') };
      }, Object.fromEntries(API_CONFIG_CATALOG.map(entry => [entry.id, entry.customSupported])));
      const where = language.id + ':' + width;
      assert.equal(geometry.rows, API_ROWS, where + ' rows under All'); assert.equal(geometry.selected, API_ROWS, where + ' selected states'); assert.equal(geometry.filter, 'all', where + ' default filter');
      assert.deepEqual(geometry.malformed, [], where + ' four mode controls fit each row without clipping or overlap'); assert.equal(geometry.forbidden, false); assert.ok(geometry.documentWidth <= width + 1, where + ' overflow');
      assert.deepEqual(geometry.customSupported.sort(), API_CONFIG_CATALOG.filter(entry => entry.customSupported).map(entry => entry.id).sort(), where + ' Custom controls match the executable catalogue');
      assert.deepEqual(geometry.chips.map(chip => chip.id), PROTECTION_FILTERS, where + ' chip order');
      for (const chip of geometry.chips) {
        assert.ok(chip.left >= 0 && chip.right <= geometry.width + 1, where + ' chip ' + chip.id + ' inside the viewport');
        assert.ok(chip.height >= 32, where + ' chip ' + chip.id + ' height ' + chip.height);
        assert.equal(chip.labelClipped, false, where + ' chip ' + chip.id + ' label is not clipped');
      }
      assert.ok(geometry.filterBottom !== null && geometry.filterBottom <= geometry.chips[0].top, where + ' chips follow the search row');
      assert.ok(geometry.firstGroupTop !== null && Math.max(...geometry.chips.map(chip => chip.bottom)) <= geometry.firstGroupTop, where + ' chips precede the first group');
      assert.ok(geometry.chipLines <= chipLineLimit[width], where + ' chip lines ' + geometry.chipLines);
      if (language.id === 'ar' || language.id === 'ur') {
        const [all, hardware] = geometry.chips;
        assert.ok(Math.abs(all.top - hardware.top) <= 1 && all.left >= hardware.right - 1, where + ' RTL chip order starts at the right');
      }
      evidence.layout.push({ locale: language.id, ...geometry });
    }
  }
  const ru = JSON.parse(readFileSync(join(extension, '_locales/ru/messages.json'), 'utf8'));
  await settings.evaluate(() => chrome.storage.local.set({ 'ui-language-v1': 'ru' })); await settings.setViewportSize({ width: 1080, height: 1000 });
  await settings.waitForFunction(title => document.querySelector('h1')?.textContent === title, ru.protection_page_title.message);
  await settings.screenshot({ path: join(artifact, 'chrome-settings.png'), fullPage: true });
  await settings.emulateMedia({ colorScheme: 'dark' });
  await settings.screenshot({ path: join(artifact, 'chrome-settings-dark.png'), fullPage: true });
  await settings.emulateMedia({ colorScheme: 'light' });
  await inspector.screenshot({ path: join(artifact, 'chrome-launcher.png'), fullPage: true });
  evidence.checks.push('all 21 languages at 360/600/1080px: ' + API_ROWS + ' API rows with four aligned mode controls; Custom availability matches the catalogue; six filter chips in order, unclipped labels, bounded chip lines, RTL chip order and no page overflow or removed copy');

  // ADR-046: category chips are view-only; trusted clicks and keys only.
  const formatMessage = (entry, subs) => entry.message.replace(/\$\$|\$([a-z_][a-z0-9_]*)\$|\$([1-9])/gi, (token, name, direct) => {
    if (token === '$$') return '$';
    const content = name ? entry.placeholders?.[name.toLowerCase()]?.content : '$' + direct;
    return content ? content.replace(/\$([1-9])/g, (_match, index) => subs[Number(index) - 1] ?? '') : token;
  });
  const expectedFeatures = id => API_CONFIG_CATALOG.filter(entry => id === 'all' || (PROTECTION_FEATURE_FILTER[entry.id] ?? (entry.group === 'graphics' ? 'hardware' : 'os')) === id).map(entry => entry.id);
  const chip = id => settings.locator('[data-protection-filter="' + id + '"]');
  const chipSelected = id => settings.locator('[data-protection-filter="' + id + '"][aria-checked="true"]').waitFor();
  const readFilterView = () => settings.evaluate(() => ({
    selected: document.querySelector('[data-protection-filter][aria-checked="true"]')?.dataset.protectionFilter ?? null,
    active: document.activeElement?.dataset?.protectionFilter ?? null,
    features: [...document.querySelectorAll('[data-protection-feature]')].map(row => row.dataset.protectionFeature),
    groups: [...document.querySelectorAll('[data-protection-group]')].map(group => ({ id: group.dataset.protectionGroup, rows: group.querySelectorAll('[data-protection-feature]').length, count: group.querySelector('.blocking-group__count')?.textContent ?? null })),
    live: document.querySelector('[data-protection-filter-live]')?.textContent ?? null }));
  const pressChip = async (key, expected) => {
    await settings.keyboard.press(key); await chipSelected(expected);
    const view = await readFilterView();
    assert.equal(view.selected, expected, key + ' selects ' + expected); assert.equal(view.active, expected, key + ' moves focus to ' + expected);
    assert.deepEqual([...view.features].sort(), [...expectedFeatures(expected)].sort(), key + ' rows of ' + expected);
  };
  const beforeFilters = await state();
  evidence.filters = [];
  // 'all' is already selected, so it is clicked last to change the category and trigger the summary.
  for (const id of [...PROTECTION_FILTERS.slice(1), PROTECTION_FILTERS[0]]) {
    await chip(id).click(); await chipSelected(id);
    await settings.waitForTimeout(650);
    const view = await readFilterView(), expected = expectedFeatures(id);
    assert.equal(view.selected, id);
    assert.deepEqual([...view.features].sort(), [...expected].sort(), id + ' filter rows');
    assert.ok(view.groups.length > 0, id + ' shows groups');
    for (const group of view.groups) { assert.ok(group.rows > 0, id + ':' + group.id + ' not empty'); assert.equal(group.count, String(group.rows), id + ':' + group.id + ' count'); }
    assert.equal(view.live, formatMessage(ru.protection_filter_shown, [String(expected.length), String(API_ROWS)]), id + ' live summary');
    evidence.filters.push({ filter: id, rows: view.features.length, groups: view.groups, live: view.live });
  }
  assert.equal((await readFilterView()).active, 'all', 'clicked chip keeps focus');
  await pressChip('ArrowRight', 'hardware'); await pressChip('End', 'social'); await pressChip('Home', 'all');
  assert.deepEqual(await state(), beforeFilters, 'chip clicks and keys write nothing');
  evidence.checks.push('six chips by trusted clicks: rows equal PROTECTION_FEATURE_FILTER, non-empty groups with matching counts, localized live summary after 650 ms; ArrowRight/End/Home move selection and focus; ui-protection-get unchanged');

  await chip('network').click(); await chipSelected('network');
  const scopeId = await settings.locator('[data-protection-scope][aria-checked="true"]').getAttribute('data-protection-scope');
  const rulesOf = value => scopeId === 'global' ? value.global : value.sites.find(site => site.host === host)?.rules ?? [];
  const webrtc = '[data-protection-feature="webrtc"]';
  const originalMode = await settings.locator(webrtc + ' [data-protection-state][aria-checked="true"]').getAttribute('data-protection-state');
  assert.notEqual(originalMode, 'on', 'webrtc starts without an explicit block');
  const beforeWebrtc = await state();
  await settings.locator(webrtc + ' [data-protection-state="on"]').click();
  await settings.locator(webrtc + ' [data-protection-state="on"][aria-checked="true"]').waitFor();
  await save();
  const afterWebrtc = await state();
  assert.ok(rulesOf(afterWebrtc.settings).some(rule => rule.feature === 'webrtc' && rule.state === 'block'), 'webrtc ON saved under the Network filter');
  assert.deepEqual(rulesOf(afterWebrtc.settings).filter(rule => rule.feature !== 'webrtc'), rulesOf(beforeWebrtc.settings).filter(rule => rule.feature !== 'webrtc'), 'other rules unchanged');
  await settings.locator(webrtc + ' [data-protection-state="' + originalMode + '"]').click();
  await settings.locator(webrtc + ' [data-protection-state="' + originalMode + '"][aria-checked="true"]').waitFor();
  await save();
  const restoredWebrtc = await state();
  assert.deepEqual({ ...restoredWebrtc.settings, revision: 0 }, { ...beforeWebrtc.settings, revision: 0 }, 'webrtc returned to its original state');
  evidence.webrtcUnderNetwork = { scope: scopeId, originalMode, saved: rulesOf(afterWebrtc.settings), restored: rulesOf(restoredWebrtc.settings) };
  await settings.screenshot({ path: join(artifact, 'chrome-settings-filter-network.png'), fullPage: true });
  await settings.emulateMedia({ colorScheme: 'dark' });
  await settings.screenshot({ path: join(artifact, 'chrome-settings-filter-network-dark.png'), fullPage: true });
  await settings.emulateMedia({ colorScheme: 'light', forcedColors: 'active' });
  const forced = await settings.evaluate(() => {
    const style = node => { const s = getComputedStyle(node); return { border: s.borderTopWidth + ' ' + s.borderTopStyle + ' ' + s.borderTopColor, outline: s.outlineStyle + ' ' + s.outlineWidth + ' ' + s.outlineColor }; };
    return { selected: style(document.querySelector('[data-protection-filter][aria-checked="true"]')), unselected: style(document.querySelector('[data-protection-filter][aria-checked="false"]')) };
  });
  assert.ok(forced.selected.border !== forced.unselected.border || forced.selected.outline !== forced.unselected.outline, 'forced colors distinguish the selected chip: ' + JSON.stringify(forced));
  evidence.forcedColorsChip = forced;
  await chip('network').scrollIntoViewIfNeeded();
  await settings.screenshot({ path: join(artifact, 'chrome-settings-filter-forced-colors.png'), fullPage: false });
  await settings.emulateMedia({ colorScheme: 'light', forcedColors: 'none' });
  evidence.checks.push('under Network: webrtc ON saved through the page, other rules unchanged, then restored; selected chip differs in forced colors');

  await settings.locator('[data-protection-search]').click(); await settings.keyboard.type('zzzz');
  await settings.locator('[data-protection-filter-clear]').waitFor();
  assert.equal(await settings.locator('[data-protection-feature]').count(), 0);
  await settings.locator('[data-protection-filter-clear]').click();
  await settings.waitForFunction(count => document.querySelectorAll('[data-protection-feature]').length === count, API_ROWS);
  const cleared = await readFilterView();
  assert.equal(cleared.selected, 'all'); assert.equal(cleared.active, 'all', 'clear moves focus to All');
  assert.equal(await settings.locator('[data-protection-search]').inputValue(), '');
  evidence.checks.push('search without matches shows clear action; clear restores all ' + API_ROWS + ' rows, All and focus');

  const ar = JSON.parse(readFileSync(join(extension, '_locales/ar/messages.json'), 'utf8'));
  await settings.evaluate(() => chrome.storage.local.set({ 'ui-language-v1': 'ar' })); await settings.setViewportSize({ width: 360, height: 1000 });
  await settings.waitForFunction(title => document.querySelector('h1')?.textContent === title && document.documentElement.dir === 'rtl', ar.protection_page_title.message);
  await chip('all').click(); await chipSelected('all');
  await pressChip('ArrowLeft', 'hardware');
  await settings.screenshot({ path: join(artifact, 'chrome-settings-filter-ar-360.png') });
  await pressChip('Home', 'all');
  await settings.evaluate(() => chrome.storage.local.set({ 'ui-language-v1': 'ru' })); await settings.setViewportSize({ width: 1080, height: 1000 });
  await settings.waitForFunction(title => document.querySelector('h1')?.textContent === title, ru.protection_page_title.message);
  assert.deepEqual((await state()).settings, restoredWebrtc.settings, 'RTL keys write nothing');
  evidence.checks.push('Arabic 360px: ArrowLeft selects the next chip and moves focus');
  assert.deepEqual(evidence.errors, []); assert.deepEqual(evidence.unexpectedRequests, []);

  const nativeBefore = await fixture.evaluate(nativeProtectionProbe, 'baseline');
  const allRules = PROTECTION_FEATURES.map(feature => ({ feature, state: 'block' }));
  const expanded = await send({ schemaVersion: 1, type: 'ui-protection-set', tabId: tab.id, settings: { ...(await state()).settings, enabled: true, preset: 'custom', global: allRules, sites: [] } });
  assert.equal(expanded.registration, 'ready');
  await fixture.reload(); await fixture.waitForFunction(() => window.fixtureReady);
  // Open extension pages query the new document on commit; each rule answers at most every 250 ms.
  await fixture.waitForTimeout(1000);
  const registered = (await inspector.evaluate(() => chrome.scripting.getRegisteredContentScripts())).map(entry => entry.id).filter(id => id.startsWith(SCRIPT_PREFIX));
  assert.equal(registered.length, RULES, 'one registration per rule');
  assert.deepEqual([...registered].sort(), PROTECTION_FEATURES.map(feature => SCRIPT_PREFIX + feature).sort());
  const live = await state();
  assert.equal(live.liveRead, 'received');
  assert.equal(live.observations.length, RULES, 'one live observation per rule through the bridge');
  assert.deepEqual(live.observations.map(row => row.feature).sort(), [...PROTECTION_FEATURES].sort());
  for (const row of live.observations) assert.ok(row.installed + row.unavailable >= 1, row.feature + ' reports installed or unavailable hooks');
  const nativeBlocked = await fixture.evaluate(nativeProtectionProbe, 'blocked');
  await send({ schemaVersion: 1, type: 'ui-protection-set', tabId: tab.id, settings: { ...(await state()).settings, enabled: false } });
  await fixture.reload(); await fixture.waitForFunction(() => window.fixtureReady);
  const nativeRestored = await fixture.evaluate(nativeProtectionProbe, 'baseline');
  const verified = verifyNativeProtection(assert, nativeBefore, nativeBlocked, nativeRestored);
  evidence.registration = { protectionScripts: registered.length };
  evidence.expansion = { rules: RULES, registered: registered.length, observations: live.observations.length, liveObservations: live.observations, tested: verified.tested, features: verified.features, frameGap: nativeBlocked.frameGap ?? null, before: nativeBefore, blocked: nativeBlocked, restored: nativeRestored };
  evidence.checks.push('all ' + RULES + ' rules: ' + registered.length + ' registrations, ' + live.observations.length + ' live observations, ' + verified.tested + ' present native entry points denied or hidden, master OFF restores native availability');
  evidence.finalSettings = (await state()).settings;
  evidence.summary = { rules: RULES, registeredProtectionScripts: registered.length, observations: live.observations.length, layouts: evidence.layout.length, layoutsWithChips: evidence.layout.filter(entry => entry.chips.length === PROTECTION_FILTERS.length).length, nativeTested: verified.tested };
  evidence.passed = true;
} catch (error) {
  evidence.failure = error.stack; throw error;
} finally {
  writeFileSync(join(artifact, 'chrome.json'), JSON.stringify(evidence, null, 2) + '\n');
  if (context) await context.close(); await new Promise(done => server.close(done));
}
console.log('blocking Chrome: ' + evidence.checks.length + ' checks, ' + evidence.layout.length + ' localized layouts; PASS');
