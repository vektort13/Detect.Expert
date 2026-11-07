// Native UI localization checks. Profiles and evidence stay in this project.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { chromium } from 'playwright';
import { buildProduction } from './build-production.mjs';
import { PRODUCTION_LANGUAGES } from './production-languages.mjs';
import { PRECURSOR_UI_KEYS, PRECURSOR_UI_MESSAGES } from './production-locales-precursor.mjs';

const root = resolve(import.meta.dirname, '..');
const temporary = join(root, '.tmp');
const artifact = join(root, 'test-results', 'production-locales-1.1.0');
const managementTabs = ['firewall', 'api', 'antidetect', 'settings', 'cookies', 'autosurf', 'proxy', 'contacts'];
mkdirSync(temporary, { recursive: true });
mkdirSync(artifact, { recursive: true });
const { output } = buildProduction('chrome');
const profile = mkdtempSync(join(temporary, 'production-locales-profile-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: true, viewport: { width: 1100, height: 800 },
  args: ['--disable-extensions-except=' + output, '--load-extension=' + output],
});
const evidence = { browser: context.browser().version(), checks: [], errors: [], outbound: [], languages: [], startupMs: {}, bundleBytes: {} };
context.on('request', request => {
  if (/^https?:/i.test(request.url())) evidence.outbound.push(request.url());
});
try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const pages = {};
  for (const name of ['options', 'popup', 'sidepanel', 'report']) {
    const page = await context.newPage();
    page.on('pageerror', error => evidence.errors.push({ page: name, message: error.message }));
    const started = performance.now();
    await page.goto('chrome-extension://' + extensionId + '/' + name + '.html');
    await page.locator('.language-picker__trigger').waitFor();
    if (name === 'options') {
      await page.locator('#options-onboarding-title').waitFor();
      assert.equal(await page.locator('[data-action="accept-data-consent"]').count(), 0);
    }
    evidence.startupMs[name] = Math.round((performance.now() - started) * 100) / 100;
    evidence.bundleBytes[name] = statSync(join(output, name + '.js')).size;
    pages[name] = page;
  }
  const options = pages.options;
  const requested = new Set(['zh_CN', 'de', 'pl', 'id', 'mr', 'te', 'ko', 'ta', 'yue', 'wuu']);
  for (const language of PRODUCTION_LANGUAGES) {
    const catalog = JSON.parse(readFileSync(join(root, 'apps', 'production-extension', language.uiOnly ? 'ui-locales' : '_locales', language.id, 'messages.json'), 'utf8'));
    await options.locator('.language-picker__trigger').click();
    assert.equal(await options.locator('.language-picker__menu button').count(), PRODUCTION_LANGUAGES.length);
    const button = options.locator('.language-picker__menu button[data-locale="' + language.id + '"]');
    assert.equal(await button.locator('span[lang]').textContent(), language.name);
    await button.click();
    await options.locator('.language-picker__panel').waitFor({ state: 'hidden' });
    for (const [name, page] of Object.entries(pages)) {
      await page.waitForFunction(({ tag, label }) => document.documentElement.lang === tag && document.querySelector('.language-picker__trigger')?.getAttribute('title') === label,
        { tag: language.tag, label: catalog.language_label.message });
      assert.equal(await page.locator('html').getAttribute('dir'), language.id === 'ar' || language.id === 'ur' ? 'rtl' : 'ltr', name + ':' + language.id);
      assert.equal(await page.locator('.language-picker__trigger > span').textContent(), language.short, name + ':' + language.id);
    }
    // Options is embedded in the current management shell. Its h1 is the product
    // brand; the selected tab, document title and settings heading are localized.
    // The legacy optionsTitle h1 is intentionally absent from this embedded view.
    assert.equal(await options.locator('.management-brand h1').textContent(), 'Detect Expert');
    assert.equal(await options.locator('[data-management-shell]').getAttribute('data-management-active'), 'settings');
    assert.equal(await options.locator('.management-tabs').getAttribute('aria-label'), catalog.management_navigation.message);
    assert.equal(await options.locator('[data-management-tab]').count(), managementTabs.length);
    for (const section of managementTabs) {
      assert.equal(await options.locator('[data-management-tab="' + section + '"]').textContent(), catalog['management_tab_' + section].message, language.id + ':management:' + section);
    }
    assert.equal(await options.locator('#options-onboarding-title').textContent(), catalog.options_onboarding_title.message);
    const expectedTitle = catalog.management_tab_settings.message + ' — Detect Expert';
    await options.waitForFunction(title => document.title === title, expectedTitle);
    assert.equal(await options.title(), expectedTitle, language.id + ':document-title');

    const packagedCatalog = JSON.parse(readFileSync(join(output, language.uiOnly ? 'ui-locales' : '_locales', language.id, 'messages.json'), 'utf8'));
    for (const key of PRECURSOR_UI_KEYS) {
      assert.equal(catalog[key]?.message, PRECURSOR_UI_MESSAGES[language.id][key], language.id + ':source:' + key);
      assert.equal(packagedCatalog[key]?.message, PRECURSOR_UI_MESSAGES[language.id][key], language.id + ':packaged:' + key);
    }
    for (const name of ['popup', 'sidepanel']) {
      const panel = pages[name].locator('[data-precursor-panel]');
      assert.equal(await panel.count(), 1, language.id + ':' + name + ':precursor-panel');
      assert.equal(await panel.locator('.precursor-panel__heading strong').textContent(), catalog.precursor_title.message);
      assert.equal(await panel.locator('[data-precursor-mode-label]').textContent(), catalog.precursor_mode.message + ': ' + catalog.precursor_mode_unknown.message);
      assert.equal(await panel.getAttribute('data-precursor-mode'), 'unknown');
      const status = await panel.getAttribute('data-precursor-status');
      assert.ok(['ready', 'loading', 'no-site', 'no-access', 'paused', 'unsupported', 'unavailable'].includes(status), language.id + ':' + name + ':precursor-status');
      const statusKey = { 'no-site': 'no_site', 'no-access': 'no_access' }[status] ?? status;
      const presence = await panel.getAttribute('data-precursor-presence');
      assert.ok(status === 'ready' ? ['observed', 'not-observed'].includes(presence) : presence === 'unknown', language.id + ':' + name + ':precursor-presence');
      const labelKey = status === 'ready' ? presence === 'observed' ? 'observed' : 'not_observed' : statusKey;
      assert.ok(catalog['precursor_' + labelKey]?.message, language.id + ':' + name + ':known-precursor-status');
      assert.equal(await panel.locator('[data-precursor-presence-label]').textContent(), catalog['precursor_' + labelKey].message);
    }
    assert.equal(await options.evaluate(() => chrome.storage.local.get('ui-language-v1').then(values => values['ui-language-v1'])), language.id);
    if (['de', 'pl', 'id', 'ko'].includes(language.id)) {
      assert.equal(await options.locator('.language-picker__trigger svg.language-flag').getAttribute('data-country'), language.flag);
      assert.ok(await options.locator('.language-picker__trigger svg.language-flag rect').count() > 0);
      if (language.id === 'ko') assert.equal(await options.locator('.language-picker__trigger svg.language-flag path').count(), 3);
    }
    await options.reload();
    await options.waitForFunction(tag => document.documentElement.lang === tag, language.tag);
    assert.equal(await options.locator('.language-picker__trigger').getAttribute('title'), catalog.language_label.message);
    if (requested.has(language.id)) {
      await options.locator('.language-picker__trigger').click();
      await options.screenshot({ path: join(artifact, language.id + '-options.png'), fullPage: false });
      await options.keyboard.press('Escape');
    }
    evidence.languages.push({ id: language.id, tag: language.tag, surfaces: Object.keys(pages), persisted: true, flag: language.flag,
      managementTabs: managementTabs.length, documentTitle: expectedTitle, precursorSurfaces: ['popup', 'sidepanel'] });
  }
  evidence.checks.push('21 languages selected through the rendered picker', 'four UI surfaces update on storage changes', 'management brand, localized tabs, settings heading and document title', 'native picker labels', '21 source and packaged Precursor catalogs match authored copy', 'Precursor labels and unknown mode in popup and sidepanel', 'RTL/LTR document direction', 'saved choice restored after reload', 'de/pl/id/ko SVG flags execute in Preact');
  assert.deepEqual(evidence.errors, [], 'no uncaught UI exceptions');
  assert.deepEqual(evidence.outbound, [], 'no HTTP requests from tested extension UI');
  evidence.checks.push('no uncaught UI exceptions', 'no extension UI HTTP requests observed');
  console.log('PASS: Chromium ' + evidence.browser + ', 21 languages × 4 UI surfaces, persisted choices and new SVG flags');
} finally {
  writeFileSync(join(artifact, 'chrome.json'), JSON.stringify(evidence, null, 2) + '\n');
  await context.close();
  assert.ok(profile.startsWith(temporary + sep));
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
