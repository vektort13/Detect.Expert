// ADR-077: unchanged packaged picker, native UI controls and real unsaved-plan handoff.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AUTOSURF_SITES_DATA } from '../../apps/production-extension/autosurf-sites-data.js';
import { validateAutosurfSitesData, searchAutosurfSites, SITE_CATEGORY_IDS, SITE_TRACKING_CATEGORY_IDS } from '../../apps/production-extension/autosurf-sites.js';
import { launchOwnedManagement, until, pause } from './management-browser-fixture.mjs';

const root = resolve(import.meta.dirname, '../..'), browser = process.argv.includes('--firefox') ? 'firefox' : 'chrome';
const artifactFlag = process.argv.indexOf('--artifact-dir');
const artifact = artifactFlag < 0 ? join(root, 'test-results/autosurf-sites-2026-10-30') : resolve(root, process.argv[artifactFlag + 1]); mkdirSync(artifact, { recursive: true });
mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/autosurf-sites-native-' + browser + '-')), extension = join(run, 'extension');
cpSync(join(root, 'dist', browser), extension, { recursive: true });
const files = ['manifest.json', 'options.html', 'options.js', 'autosurf-ui.js', 'autosurf-client.js', 'autosurf-controller.js', 'autosurf-sites.js', 'autosurf-sites-data.js', 'autosurf-sites-ui.js', 'autosurf-sites.css', 'ui-typography.css', 'company-branding.js', 'system-branding.js', 'system-branding-data.js', 'system-mark-ui.js', 'icons/countries/PROVENANCE.json'];
const evidence = { at: new Date().toISOString(), result: 'RUNNING', browser, run, scope: 'owned native profile; local bundled catalog; no website navigation', checks: [], errors: [], network: [], layouts: [], screenshots: [],
  hashes: Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(join(extension, file))).digest('hex')])) };
for (const file of ['autosurf-sites.js', 'autosurf-sites-data.js', 'autosurf-sites-ui.js', 'autosurf-sites.css', 'ui-typography.css', 'company-branding.js', 'system-branding.js', 'system-branding-data.js', 'system-mark-ui.js']) {
  assert.equal(evidence.hashes[file], createHash('sha256').update(readFileSync(join(root, 'apps/production-extension', file))).digest('hex'), 'native artifact must match reviewed source: ' + file);
}
const data = validateAutosurfSitesData(AUTOSURF_SITES_DATA);
if (process.argv.includes('--require-systems')) assert.ok(data.trackingSystems.length > 0, 'this release must contain populated tracking-system filters');
const candidates = data.sites.filter(site => site.countries.includes('ME') && site.categories.includes('automotive'));
assert.ok(candidates.length >= 2); const existingSite = candidates[0], selectedSite = candidates[1];
const manual = 'https://manual.example/retain?owned=1#keep\n' + existingSite.origin + '/';
let opened, phase = 'startup';
const check = message => { evidence.checks.push(message); console.log('  ok ' + message); };
const request = op => opened.evaluate(op => new Promise((resolve, reject) => {
  const api = globalThis.browser ?? chrome, port = api.runtime.connect({ name: 'detect-expert/autosurf/v1' });
  const id = 'site-picker-native-' + Math.random().toString(16).slice(2); let done = false;
  const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); port.disconnect(); error ? reject(error) : resolve(value); };
  const timer = setTimeout(() => finish(Error('load-timeout')), 15000);
  port.onMessage.addListener(value => { if (value.id === id) finish(null, value); });
  port.onDisconnect.addListener(() => { void api.runtime.lastError; if (!done) finish(Error('load-disconnected')); });
  port.postMessage({ v: 1, id, op });
}), op);
const state = async () => { const value = await request('load'); assert.equal(value.ok, true); return value.snapshot; };
const readDraft = () => opened.evaluate(() => document.querySelector('[data-autosurf-field="urls"]').value);
// ADR-103: a resting chip sits on one calm surface token; its own hue is painted by the border stroke and the icon.
const calmSurface = () => opened.evaluate(() => {
  const swatch = document.createElement('i'); swatch.style.background = 'var(--rd-surface)'; document.querySelector('[data-autosurf-sites]').append(swatch);
  try { return getComputedStyle(swatch).backgroundColor; } finally { swatch.remove(); }
});
const chooseCategory = id => opened.click('[data-autosurf-sites-category="' + id + '"]');
const chooseSystemCategory = id => opened.click('[data-autosurf-sites-system-category="' + id + '"]');
async function chooseCountry(code) {
  await opened.click('[data-autosurf-sites-country]');
  if (code !== 'all') await opened.fill('[data-autosurf-sites-country-search]', code);
  await until(() => opened.evaluate(code => Boolean(document.querySelector('[data-autosurf-sites-country-option="' + code + '"]')), code), 'country option ' + code);
  await opened.click('[data-autosurf-sites-country-option="' + code + '"]');
  await until(() => opened.evaluate(code => document.querySelector('[data-autosurf-sites-country]').dataset.autosurfSitesCountry === code, code), 'country chosen ' + code);
}
async function trackingSystemsFlow(baseline) {
  evidence.trackingSystems = { available: data.trackingSystems.length };
  if (!data.trackingSystems.length) return;
  await opened.evaluate(() => (globalThis.browser ?? chrome).storage.local.set({ 'ui-language-v1': 'en' }));
  await until(() => opened.evaluate(() => document.documentElement.lang.startsWith('en')), 'English tracking controls');
  await chooseSystemCategory('all');
  const target = data.sites.find(site => site.trackingSystems.length && site.countries.length && site.categories.length) ?? data.sites.find(site => site.trackingSystems.length);
  assert.ok(target, 'delivered system filters must have at least one associated site');
  const system = data.trackingSystems.find(item => item.id === target.trackingSystems[0]); assert.ok(system);
  const category = target.categories[0] ?? 'all', country = target.countries[0] ?? 'all';
  evidence.trackingSystems.target = { id: target.id, system: system.id, category, country };
  if (data.trackingSystems.length > 12) {
    await opened.fill('[data-autosurf-sites-system-search]', system.name);
    await until(() => opened.evaluate(id => Boolean(document.querySelector('[data-autosurf-sites-system="' + id + '"]')), system.id), 'system-name search returns association filter');
  }
  await opened.click('[data-autosurf-sites-system="' + system.id + '"]');
  await chooseCategory(category); if (country !== 'all') await chooseCountry(country);
  const expected = searchAutosurfSites(data, { category, country, trackingSystem: system.id, limit: 12 });
  assert.ok(expected.total > 0);
  await until(() => opened.evaluate(expected => {
    const actual = [...document.querySelectorAll('[data-autosurf-site]')].map(element => element.dataset.autosurfSite);
    return JSON.stringify(actual) === JSON.stringify(expected);
  }, expected.rows.map(site => site.id)), 'three facets use the shared catalog');
  const displayed = await opened.evaluate(() => ({
    title: document.querySelector('#autosurf-sites-systems-title')?.textContent,
    categoriesTitle: document.querySelector('#autosurf-sites-categories-title')?.textContent,
    systemPressed: [...document.querySelectorAll('[data-autosurf-sites-system]')].filter(element => element.getAttribute('aria-pressed') === 'true').map(element => element.dataset.autosurfSitesSystem),
    total: document.querySelector('.autosurf-sites-results-heading strong')?.textContent,
  }));
  assert.deepEqual(displayed.systemPressed, [system.id]); assert.equal(displayed.categoriesTitle, 'Categories'); assert.equal(displayed.title, 'Tracking systems');
  assert.equal(Number(displayed.total.replace(/[^0-9]/g, '')), expected.total);
  if (data.trackingSystems.length > 12) {
    await opened.fill('[data-autosurf-sites-system-search]', '');
    await until(() => opened.evaluate(id => Boolean(document.querySelector('[data-autosurf-sites-system="' + id + '"][aria-pressed="true"]')), system.id), 'selected system remains visible after clearing name search');
    await opened.click('[data-autosurf-sites-systems-toggle]');
    await until(() => opened.evaluate(() => document.querySelector('[data-autosurf-sites-systems-toggle]').getAttribute('aria-expanded') === 'true'), 'expand tracking systems');
    assert.equal(await opened.evaluate(() => document.querySelectorAll('[data-autosurf-sites-system]').length), data.trackingSystems.length + 1);
    evidence.trackingSystems.icons = await opened.evaluate(async () => {
      const images = [...document.querySelectorAll('[data-autosurf-sites-system] img[data-system-logo]')];
      for (const image of images) image.loading = 'eager';
      return Promise.race([Promise.all(images.map(async image => {
        let decoded = false; try { await image.decode(); decoded = true; } catch {}
        const box = image.getBoundingClientRect();
        return { id: image.dataset.systemLogo, kind: image.dataset.systemIconKind, source: new URL(image.src).pathname,
          local: image.src.startsWith(location.protocol + '//' + location.host + '/icons/'), decoded, complete: image.complete,
          width: image.naturalWidth, height: image.naturalHeight, renderedWidth: box.width, renderedHeight: box.height };
      })), new Promise(resolve => setTimeout(() => resolve(null), 5000))]);
    });
    assert.ok(evidence.trackingSystems.icons, 'all packaged system icons decode within the shared deadline');
    assert.deepEqual(evidence.trackingSystems.icons.map(icon => icon.id).sort(), data.trackingSystems.map(system => system.id).sort());
    for (const icon of evidence.trackingSystems.icons) {
      assert.equal(icon.local, true, icon.id); assert.equal(icon.decoded, true, icon.id); assert.equal(icon.complete, true, icon.id);
      assert.ok(icon.renderedWidth > 0 && icon.renderedHeight > 0, icon.id);
      assert.match(icon.source, /^\/icons\/(?:brands|systems)\/[a-z0-9.-]+$/);
      assert.ok(['brand', 'generic'].includes(icon.kind), icon.id);
    }
    check('every tracking-system filter decodes its packaged decorative icon in the native browser');
    await opened.click('[data-autosurf-sites-systems-toggle]');
  }
  const draft = 'https://manual.example/tracking-test?retain=owned#fragment\nhttps://already-planned.example/';
  await opened.fill('[data-autosurf-field="urls"]', draft);
  await opened.fill('[data-autosurf-sites-search]', target.id);
  await until(() => opened.evaluate(id => document.querySelector('[data-autosurf-site-select="' + id + '"]')?.disabled === false, target.id), 'associated target selectable');
  await opened.click('[data-autosurf-site-select="' + target.id + '"]');
  assert.equal(await readDraft(), draft); assert.equal((await state()).revision, baseline.revision);
  await opened.click('[data-autosurf-sites-system="all"]');
  await until(() => opened.evaluate(() => document.querySelector('[data-autosurf-sites-selected]').dataset.autosurfSitesSelected === '1'), 'selection survives changing system filter');
  await opened.click('[data-autosurf-sites-add]');
  await until(async () => await readDraft() === draft + '\n' + target.origin + '/', 'associated site appended only to current draft');
  const unchanged = await state(); assert.equal(unchanged.revision, baseline.revision); assert.deepEqual(unchanged.configuration.urls, []); assert.equal(unchanged.status, 'idle');
  assert.equal(await opened.evaluate(() => document.querySelector('[data-autosurf-sites-selected]').dataset.autosurfSitesSelected), '0');
  evidence.trackingSystems.intersection = { total: expected.total, rows: expected.rows.map(site => site.id), displayed };
  evidence.trackingSystems.draftPreserved = true; evidence.trackingSystems.savedRevisionUnchanged = true;
  await opened.fill('[data-autosurf-sites-search]', ''); await chooseCategory('all'); if (country !== 'all') await chooseCountry('all');
  check('actual tracking-system search, category/country intersections and Add preserve the unsaved draft without Save or Start');
}
async function trackingCategoriesFlow(baseline) {
  if (!data.trackingSystems.length) return;
  evidence.trackingCategories = { facets: [] };
  const appearance = await opened.evaluate(() => {
    const group = document.querySelector('[aria-labelledby="autosurf-sites-system-categories-title"]');
    const chips = [...document.querySelectorAll('[data-autosurf-sites-system-category]')].filter(element => element.dataset.autosurfSitesSystemCategory !== 'all');
    return { title: document.querySelector('#autosurf-sites-system-categories-title')?.textContent, role: group?.getAttribute('role'),
      ids: chips.map(element => element.dataset.autosurfSitesSystemCategory), colors: chips.map(element => element.style.getPropertyValue('--site-color')),
      paths: chips.map(element => element.querySelector('svg path')?.getAttribute('d')),
      paintedIconColors: chips.map(element => getComputedStyle(element.querySelector('svg')).color),
      paintedBorderColors: chips.map(element => getComputedStyle(element).borderTopColor),
      paintedBackgrounds: chips.map(element => getComputedStyle(element).backgroundColor) };
  });
  assert.equal(appearance.title, 'System categories'); assert.equal(appearance.role, 'group');
  assert.deepEqual(appearance.ids, [...SITE_TRACKING_CATEGORY_IDS]);
  // ADR-103: the hue lives in the border stroke and the icon; the resting fill is the shared calm surface.
  for (const key of ['colors', 'paths', 'paintedIconColors', 'paintedBorderColors']) assert.equal(new Set(appearance[key]).size, 6, key);
  appearance.calmSurface = await calmSurface();
  assert.notEqual(appearance.calmSurface, 'rgba(0, 0, 0, 0)', 'the shared --rd-surface token resolves to an opaque colour');
  assert.deepEqual([...new Set(appearance.paintedBackgrounds)], [appearance.calmSurface], 'resting system-category chips paint the shared calm surface');
  assert.ok(appearance.paths.every(Boolean)); evidence.trackingCategories.appearance = appearance;
  check('six accessible tracking-system categories render distinct local SVG icons and actual themed hues (icon and border stroke)');

  async function verify(options, label) {
    const expected = searchAutosurfSites(data, { ...options, limit: 12 });
    await until(() => opened.evaluate(({ rows, category }) => {
      const actual = [...document.querySelectorAll('[data-autosurf-site]')].map(element => element.dataset.autosurfSite);
      return JSON.stringify(actual) === JSON.stringify(rows) && document.querySelector('[data-autosurf-sites-system-category="' + category + '"]')?.getAttribute('aria-pressed') === 'true';
    }, { rows: expected.rows.map(site => site.id), category: options.trackingCategory }), label + ' results');
    const toggle = await opened.evaluate(() => document.querySelector('[data-autosurf-sites-systems-toggle]')?.getAttribute('aria-expanded'));
    if (toggle === 'false') {
      await opened.click('[data-autosurf-sites-systems-toggle]');
      await until(() => opened.evaluate(() => document.querySelector('[data-autosurf-sites-systems-toggle]')?.getAttribute('aria-expanded') === 'true'), label + ' expanded systems');
    }
    const actual = await opened.evaluate(() => ({
      ids: [...document.querySelectorAll('[data-autosurf-sites-system]')].map(element => element.dataset.autosurfSitesSystem),
      counts: Object.fromEntries([...document.querySelectorAll('[data-autosurf-sites-system]')].map(element => [element.dataset.autosurfSitesSystem, Number(element.querySelector('small').textContent.replace(/[^0-9]/g, ''))])),
      categoryCounts: Object.fromEntries([...document.querySelectorAll('[data-autosurf-sites-system-category]')].map(element => [element.dataset.autosurfSitesSystemCategory, Number(element.querySelector('small').textContent.replace(/[^0-9]/g, ''))])),
      system: document.querySelector('[data-autosurf-sites-system][aria-pressed="true"]')?.dataset.autosurfSitesSystem,
      total: Number(document.querySelector('.autosurf-sites-results-heading strong').textContent.replace(/[^0-9]/g, '')),
    }));
    const systems = data.trackingSystems.filter(system => options.trackingCategory === 'all' || system.categories.includes(options.trackingCategory));
    assert.deepEqual(actual.ids.sort(), ['all', ...systems.map(system => system.id)].sort(), label + ' systems');
    assert.equal(actual.system, options.trackingSystem ?? 'all', label + ' selected system'); assert.equal(actual.total, expected.total, label + ' total');
    assert.deepEqual(actual.counts, Object.fromEntries(['all', ...systems.map(system => system.id)].map(id => [id, expected.trackingSystemCounts[id]])), label + ' distinct site counts');
    assert.deepEqual(actual.categoryCounts, expected.trackingCategoryCounts, label + ' category facets');
    evidence.trackingCategories.facets.push({ ...options, total: actual.total, systems: systems.length });
  }
  for (const trackingCategory of SITE_TRACKING_CATEGORY_IDS) {
    await chooseSystemCategory(trackingCategory);
    await verify({ trackingCategory }, trackingCategory);
  }
  check('all six category filters restrict systems and site results with exact shared-model facet counts');

  const draft = await readDraft();
  const selectableWithFacets = site => site.countries.length > 0 && site.categories.length > 0 && !draft.split('\n').includes(site.origin + '/');
  const single = data.trackingSystems.find(system => system.categories.length === 1 && data.sites.some(site => site.trackingSystems.includes(system.id) && selectableWithFacets(site)));
  assert.ok(single, 'a single-category system has a selectable site with country and topic evidence');
  const target = data.sites.find(site => site.trackingSystems.includes(single.id) && selectableWithFacets(site));
  const trackingCategory = single.categories[0], country = target.countries[0] ?? 'all', category = target.categories[0] ?? 'all';
  await chooseSystemCategory(trackingCategory); await chooseCategory(category); if (country !== 'all') await chooseCountry(country);
  await verify({ trackingCategory, country, category }, 'country/topic/category intersection');
  await opened.fill('[data-autosurf-sites-system-search]', single.name); await opened.click('[data-autosurf-sites-system="' + single.id + '"]');
  await opened.fill('[data-autosurf-sites-system-search]', '');
  await opened.fill('[data-autosurf-sites-search]', target.id);
  await until(() => opened.evaluate(id => document.querySelector('[data-autosurf-site-select="' + id + '"]')?.disabled === false, target.id), 'category-associated target selectable');
  await opened.click('[data-autosurf-site-select="' + target.id + '"]');
  await opened.fill('[data-autosurf-sites-search]', ''); await chooseCategory('all'); if (country !== 'all') await chooseCountry('all');
  const incompatible = SITE_TRACKING_CATEGORY_IDS.find(id => !single.categories.includes(id));
  await chooseSystemCategory(incompatible); await verify({ trackingCategory: incompatible }, 'incompatible selected system clears');
  assert.equal(await readDraft(), draft);
  assert.equal(await opened.evaluate(() => document.querySelector('[data-autosurf-sites-selected]').dataset.autosurfSitesSelected), '1', 'hidden selected site survives category changes');

  const multiple = data.trackingSystems.find(system => system.categories.length > 1 && data.sites.some(site => site.trackingSystems.includes(system.id)));
  assert.ok(multiple, 'a multi-category system has associated sites');
  await chooseSystemCategory(multiple.categories[0]);
  await opened.fill('[data-autosurf-sites-system-search]', multiple.name); await opened.click('[data-autosurf-sites-system="' + multiple.id + '"]');
  await opened.fill('[data-autosurf-sites-system-search]', '');
  await chooseSystemCategory(multiple.categories[1]);
  await verify({ trackingCategory: multiple.categories[1], trackingSystem: multiple.id }, 'compatible selected system stays selected');
  await chooseSystemCategory('all'); await verify({ trackingCategory: 'all', trackingSystem: multiple.id }, 'all categories retain selected system');
  assert.equal(await opened.evaluate(() => document.querySelector('[data-autosurf-sites-selected]').dataset.autosurfSitesSelected), '1');
  await opened.click('[data-autosurf-sites-add]');
  await until(async () => await readDraft() === draft + '\n' + target.origin + '/', 'hidden category selection appends only to current draft');
  const unchanged = await state(); assert.equal(unchanged.revision, baseline.revision); assert.deepEqual(unchanged.configuration.urls, []); assert.equal(unchanged.status, 'idle');
  assert.equal(await opened.evaluate(() => document.querySelector('[data-autosurf-sites-selected]').dataset.autosurfSitesSelected), '0');
  evidence.trackingCategories.selection = { single: single.id, incompatible, multiple: multiple.id, target: target.id, draftPreserved: true, savedRevisionUnchanged: true };
  await opened.click('[data-autosurf-sites-system="all"]');
  check('category switches clear incompatible systems, retain compatible systems and hidden site choices; Add changes only the unsaved plan');
}
async function activeTrackingFiltersFlow(baseline) {
  const aws = data.trackingSystems.find(system => system.id === 'amazon-aws-waf-captcha');
  if (!data.trackingSystems.length) return;
  assert.ok(aws, 'the packaged AWS system is available for active-filter regression');
  const second = data.trackingSystems.find(system => system.id === 'recaptcha'); assert.ok(second);
  const record = evidence.activeTrackingFilters = { systems: [aws.id, second.id] };
  const activeSystemIds = () => opened.evaluate(() => [...document.querySelectorAll('[data-autosurf-sites-active-system]')].map(element => element.dataset.autosurfSitesActiveSystem).sort());
  const removeFilter = id => opened.click('[data-autosurf-sites-remove-filter="' + id + '"]');
  async function selectSystem(system) {
    await opened.fill('[data-autosurf-sites-system-search]', system.name);
    await until(() => opened.evaluate(id => Boolean(document.querySelector('[data-autosurf-sites-system="' + id + '"]')), system.id), 'named system ' + system.id);
    await opened.click('[data-autosurf-sites-system="' + system.id + '"]');
    await until(async () => (await activeSystemIds()).includes(system.id), 'active system chip ' + system.id);
  }
  async function expectSystems(ids, label) {
    const model = searchAutosurfSites(data, { trackingSystems: ids, limit: 12 });
    const reference = data.sites.filter(site => ids.length === 0 || ids.some(id => site.trackingSystems.includes(id)));
    assert.equal(model.total, reference.length, label + ' independent union count');
    assert.deepEqual(model.rows.map(site => site.id), reference.slice(0, 12).map(site => site.id), label + ' independent union rows');
    await until(() => opened.evaluate(({ rows, total }) => {
      const actual = [...document.querySelectorAll('[data-autosurf-site]')].map(element => element.dataset.autosurfSite);
      const count = Number(document.querySelector('.autosurf-sites-results-heading strong').textContent.replace(/[^0-9]/g, ''));
      return JSON.stringify(actual) === JSON.stringify(rows) && count === total && new Set(actual).size === actual.length;
    }, { rows: reference.slice(0, 12).map(site => site.id), total: reference.length }), label + ' native union');
    assert.deepEqual(await activeSystemIds(), [...ids].sort(), label + ' active chips');
    assert.equal(await opened.evaluate(() => Number(document.querySelector('[data-autosurf-sites-selected-systems]')?.dataset.autosurfSitesSelectedSystems ?? 0)), ids.length, label + ' selected-system count');
    return { ids, total: reference.length, rows: reference.slice(0, 12).map(site => site.id) };
  }
  if (browser === 'chrome') {
    const expand = await opened.evaluate(() => document.querySelector('[data-autosurf-sites-systems-toggle]')?.getAttribute('aria-expanded'));
    if (expand === 'false') await opened.click('[data-autosurf-sites-systems-toggle]');
    await until(() => opened.evaluate(id => Boolean(document.querySelector('[data-autosurf-sites-system="' + id + '"]')), aws.id), 'expanded AWS keyboard target');
    const page = opened.context.pages().find(page => page.url().startsWith(opened.base + 'options.html'));
    await opened.evaluate(() => {
      document.defaultView.__trackingSystemKeys = [];
      document.addEventListener('keydown', event => { const id = event.target.dataset?.autosurfSitesSystem; if (id) document.defaultView.__trackingSystemKeys.push({ id, key: event.key, trusted: event.isTrusted }); });
    });
    await page.locator('[data-autosurf-sites-system="' + aws.id + '"]').focus();
    await page.keyboard.press('Enter'); await until(async () => (await activeSystemIds()).includes(aws.id), 'keyboard Enter selects AWS');
    assert.equal(await opened.evaluate(() => document.activeElement?.dataset.autosurfSitesSystem), aws.id, 'selected-first reorder retains focus on AWS');
    await page.keyboard.press('Space'); await until(async () => !(await activeSystemIds()).includes(aws.id), 'keyboard Space deselects the same AWS system');
    assert.equal(await opened.evaluate(() => document.activeElement?.dataset.autosurfSitesSystem), aws.id, 'deselection reorder retains focus on AWS');
    await page.keyboard.press('Enter'); await until(async () => (await activeSystemIds()).includes(aws.id), 'keyboard Enter reselects AWS');
    record.keyboard = await opened.evaluate(() => document.defaultView.__trackingSystemKeys);
    assert.deepEqual(record.keyboard.map(item => item.id), [aws.id, aws.id, aws.id]); assert.ok(record.keyboard.every(item => item.trusted));
    check('native Enter and Space keep keyboard focus on the same AWS system through selected-first reordering');
  } else { record.keyboard = { result: 'not-run', reason: 'management helper has no native button-keypress operation' }; await selectSystem(aws); }
  await opened.fill('[data-autosurf-sites-system-search]', '');
  const expanded = await opened.evaluate(() => document.querySelector('[data-autosurf-sites-systems-toggle]')?.getAttribute('aria-expanded'));
  if (expanded === 'true') {
    await opened.click('[data-autosurf-sites-systems-toggle]');
    await until(() => opened.evaluate(() => document.querySelector('[data-autosurf-sites-systems-toggle]')?.getAttribute('aria-expanded') === 'false'), 'collapsed system list');
  }
  if (browser === 'chrome') {
    const page = opened.context.pages().find(page => page.url().startsWith(opened.base + 'options.html'));
    await page.locator('[data-autosurf-sites-system="' + aws.id + '"]').focus(); await page.keyboard.press('Space');
    await until(async () => !(await activeSystemIds()).includes(aws.id), 'Space deselects pinned AWS in collapsed list');
    await until(() => opened.evaluate(id => !document.querySelector('[data-autosurf-sites-system="' + id + '"]'), aws.id), 'deselected distant AWS leaves the collapsed list');
    assert.equal(await opened.evaluate(() => document.activeElement?.dataset.autosurfSitesSystem), 'all', 'removed collapsed keyboard target restores focus to All systems');
    record.collapsedKeyboard = { target: aws.id, restoredFocus: 'all', event: (await opened.evaluate(() => document.defaultView.__trackingSystemKeys)).at(-1) };
    assert.equal(record.collapsedKeyboard.event.id, aws.id); assert.equal(record.collapsedKeyboard.event.trusted, true);
    await selectSystem(aws); await opened.fill('[data-autosurf-sites-system-search]', '');
    check('native Space on a pinned distant system restores All systems focus when deselection removes that button from the collapsed list');
  }
  await opened.fill('[data-autosurf-sites-system-search]', 'no-other-system-matches-538219');
  record.topChip = await opened.evaluate(id => {
    const bar = document.querySelector('[data-autosurf-sites-active-filters]'), chip = document.querySelector('[data-autosurf-sites-active-system="' + id + '"]');
    const controls = document.querySelector('.autosurf-sites-filters'), categories = document.querySelector('#autosurf-sites-categories-title');
    const box = chip?.getBoundingClientRect(), barBox = bar?.getBoundingClientRect();
    return { text: chip?.textContent, label: chip?.getAttribute('aria-label'), icon: chip?.querySelector('img[data-system-logo]')?.dataset.systemLogo,
      visible: Boolean(box && box.width > 0 && box.height > 0 && getComputedStyle(chip).visibility === 'visible'),
      afterControls: Boolean(bar && controls && controls.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING),
      beforeTopics: Boolean(bar && categories && bar.compareDocumentPosition(categories) & Node.DOCUMENT_POSITION_FOLLOWING),
      separated: Boolean(barBox && controls && categories && controls.getBoundingClientRect().bottom <= barBox.top + 1 && barBox.bottom <= categories.getBoundingClientRect().top + 1),
      search: document.querySelector('[data-autosurf-sites-system-search]').value };
  }, aws.id);
  assert.ok(record.topChip.text.includes(aws.name)); assert.ok(record.topChip.label.includes(aws.name)); assert.equal(record.topChip.icon, aws.id);
  for (const key of ['visible', 'afterControls', 'beforeTopics', 'separated']) assert.equal(record.topChip[key], true, key);
  assert.equal(record.topChip.search, 'no-other-system-matches-538219');
  await opened.evaluate(() => { document.activeElement?.blur(); scrollTo({ top: 0, left: 0 }); });
  const awsScreenshot = 'sites-' + browser + '-active-aws.png'; await opened.screenshot(join(artifact, awsScreenshot));
  evidence.screenshots.push({ file: awsScreenshot, sha256: createHash('sha256').update(readFileSync(join(artifact, awsScreenshot))).digest('hex') });
  check('selected AWS filter has a visible removable logo chip above categories even with a collapsed list and unrelated system search');

  await opened.fill('[data-autosurf-sites-system-search]', ''); await selectSystem(second); await opened.fill('[data-autosurf-sites-system-search]', '');
  record.union = await expectSystems([aws.id, second.id], 'AWS plus second system');
  record.overlap = data.sites.filter(site => site.trackingSystems.includes(aws.id) && site.trackingSystems.includes(second.id)).length;
  assert.ok(record.overlap > 0, 'the native OR fixture contains coinstalled systems');
  assert.ok(record.union.total < data.sites.filter(site => site.trackingSystems.includes(aws.id)).length + data.sites.filter(site => site.trackingSystems.includes(second.id)).length, 'coinstalled sites count only once');
  record.layouts = [];
  for (const locale of ['ru', 'ar']) {
    await opened.evaluate(locale => (globalThis.browser ?? chrome).storage.local.set({ 'ui-language-v1': locale }), locale);
    await until(() => opened.evaluate(locale => document.documentElement.lang.startsWith(locale), locale), 'active-filter locale ' + locale);
    await opened.viewport(browser === 'firefox' ? 520 : 390, 1100); await opened.media({ colorScheme: 'light', reducedMotion: 'reduce' });
    await opened.evaluate(() => { document.activeElement?.blur(); scrollTo({ top: 0, left: 0 }); }); await pause(100);
    const value = await opened.evaluate(() => {
      const bar = document.querySelector('[data-autosurf-sites-active-filters]'), box = bar.getBoundingClientRect();
      const chips = [...bar.querySelectorAll('[data-autosurf-sites-remove-filter]')].map(element => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, width: rect.width, label: element.getAttribute('aria-label') }; });
      return { width: innerWidth, dir: document.documentElement.dir, overflow: document.documentElement.scrollWidth > innerWidth + 1, chips,
        title: document.querySelector('#autosurf-sites-active-filters-title').textContent, contained: chips.every(chip => chip.width > 0 && chip.left >= box.left && chip.right <= box.right), unresolved: /autosurf_sites_[a-z_]+/.test(bar.textContent) };
    });
    assert.equal(value.overflow, false); assert.equal(value.contained, true); assert.equal(value.unresolved, false); assert.equal(value.dir, locale === 'ar' ? 'rtl' : 'ltr');
    const filename = 'sites-' + browser + '-active-systems-' + locale + '-' + value.width + '.png'; await opened.screenshot(join(artifact, filename));
    evidence.screenshots.push({ file: filename, sha256: createHash('sha256').update(readFileSync(join(artifact, filename))).digest('hex') });
    record.layouts.push({ locale, ...value });
  }
  await opened.evaluate(() => (globalThis.browser ?? chrome).storage.local.set({ 'ui-language-v1': 'en' }));
  await until(() => opened.evaluate(() => document.documentElement.lang.startsWith('en')), 'restore English active filters');
  await opened.viewport(1180, 900);
  await removeFilter('system:' + aws.id); record.single = await expectSystems([second.id], 'remove one active system');
  await until(() => opened.evaluate(() => document.activeElement?.hasAttribute('data-autosurf-sites-clear-all-filters')), 'remove chip restores focus inside the remaining active filters');
  await removeFilter('system:' + second.id); record.cleared = await expectSystems([], 'remove final active system');
  await until(() => opened.evaluate(() => document.activeElement?.hasAttribute('data-autosurf-sites-search')), 'remove final chip restores main site-search focus');
  record.removeFocus = { remainingBar: 'clear-all-filters', emptyBar: 'site-search' };
  assert.equal(await opened.evaluate(() => Boolean(document.querySelector('[data-autosurf-sites-active-filters]'))), false, 'last removal restores the unfiltered picker');
  check('system multiselect uses exact OR union without duplicate sites; removing each active chip restores one filter then the full catalog');

  const draft = await readDraft();
  await selectSystem(aws); await opened.fill('[data-autosurf-sites-system-search]', '');
  const incompatible = data.trackingSystems.find(system => !system.categories.includes('captcha') && data.sites.some(site => site.trackingSystems.includes(system.id)));
  assert.ok(incompatible); await selectSystem(incompatible); await opened.fill('[data-autosurf-sites-system-search]', '');
  await chooseSystemCategory('captcha');
  await until(async () => JSON.stringify(await activeSystemIds()) === JSON.stringify([aws.id]), 'category switch keeps only compatible selected systems');
  const target = data.sites.find(site => site.trackingSystems.includes(aws.id) && site.countries.length > 0 && site.categories.length > 0 && !draft.split('\n').includes(site.origin + '/'));
  assert.ok(target, 'AWS target has country/topic facets and is not already in the manual draft');
  await chooseCountry(target.countries[0]); await chooseCategory(target.categories[0]);
  await opened.fill('[data-autosurf-sites-search]', target.id);
  await until(() => opened.evaluate(id => document.querySelector('[data-autosurf-site-select="' + id + '"]')?.disabled === false, target.id), 'AWS target selectable under intersected facets');
  await opened.click('[data-autosurf-site-select="' + target.id + '"]');
  await opened.fill('[data-autosurf-sites-system-search]', 'AWS');
  const beforeClear = await opened.evaluate(() => [...document.querySelectorAll('[data-autosurf-sites-remove-filter]')].map(element => element.dataset.autosurfSitesRemoveFilter).sort());
  assert.deepEqual(beforeClear, ['category', 'country', 'query', 'system-query', 'tracking-category', 'system:' + aws.id].sort(), 'all filter types have individual remove controls');
  await opened.click('[data-autosurf-sites-clear-all-filters]'); await expectSystems([], 'clear all active filters');
  await until(() => opened.evaluate(() => document.activeElement?.hasAttribute('data-autosurf-sites-search')), 'Clear all restores main site-search focus');
  const reset = await opened.evaluate(() => ({
    country: document.querySelector('[data-autosurf-sites-country]').dataset.autosurfSitesCountry,
    category: document.querySelector('[data-autosurf-sites-category][aria-pressed="true"]').dataset.autosurfSitesCategory,
    trackingCategory: document.querySelector('[data-autosurf-sites-system-category][aria-pressed="true"]').dataset.autosurfSitesSystemCategory,
    query: document.querySelector('[data-autosurf-sites-search]').value, systemQuery: document.querySelector('[data-autosurf-sites-system-search]').value,
    selected: document.querySelector('[data-autosurf-sites-selected]').dataset.autosurfSitesSelected,
    activeBar: Boolean(document.querySelector('[data-autosurf-sites-active-filters]')),
  }));
  assert.deepEqual(reset, { country: 'all', category: 'all', trackingCategory: 'all', query: '', systemQuery: '', selected: '1', activeBar: false });
  assert.equal(await readDraft(), draft, 'Clear all preserves the exact current URL draft');
  const unchanged = await state(); assert.equal(unchanged.revision, baseline.revision); assert.deepEqual(unchanged.configuration.urls, []); assert.equal(unchanged.status, 'idle');
  record.reset = reset; record.target = target.id; record.incompatible = incompatible.id; record.draftPreserved = true;
  await opened.click('[data-autosurf-sites-clear-selection]');
  check('Clear all resets all six filter types while retaining selected sites, exact manual draft and idle unsaved state');
}
async function keyboardCountry() {
  await opened.click('[data-autosurf-sites-country]');
  await opened.evaluate(() => {
    document.defaultView.__siteCountryKeyboard = { enterCount: 0, trustedEnterCount: 0 };
    document.querySelector('[data-autosurf-sites-country-search]').addEventListener('keydown', event => {
      if (event.key === 'Enter') { document.defaultView.__siteCountryKeyboard.enterCount++; if (event.isTrusted) document.defaultView.__siteCountryKeyboard.trustedEnterCount++; }
    });
  });
  await opened.fill('[data-autosurf-sites-country-search]', 'Montenegro');
  await until(() => opened.evaluate(() => [...document.querySelectorAll('[data-autosurf-sites-country-option]')].length === 1 && Boolean(document.querySelector('[data-autosurf-sites-country-option="ME"]'))), 'country search render before Enter');
  if (browser === 'chrome') {
    const page = opened.context.pages().find(page => page.url().startsWith(opened.base + 'options.html'));
    await page.locator('[data-autosurf-sites-country-search]').press('Enter');
  } else {
    // The Firefox helper's ElementClear emits no input event. Send Enter in a
    // second native command after the country filter has actually rendered.
    await opened.fill('[data-autosurf-sites-country-search]', '\uE007');
  }
  await until(() => opened.evaluate(() => document.querySelector('[data-autosurf-sites-country]').dataset.autosurfSitesCountry === 'ME'), 'keyboard selects Montenegro');
  evidence.countryKeyboard = await opened.evaluate(() => document.defaultView.__siteCountryKeyboard);
  assert.equal(evidence.countryKeyboard.enterCount, 1); assert.equal(evidence.countryKeyboard.trustedEnterCount, 1);
}
async function layout(locale, width, scheme) {
  await opened.evaluate(locale => (globalThis.browser ?? chrome).storage.local.set({ 'ui-language-v1': locale }), locale);
  await until(() => opened.evaluate(locale => document.documentElement.lang === locale || document.documentElement.lang.startsWith(locale), locale), 'saved locale ' + locale);
  await opened.viewport(width, 1100); await opened.media({ colorScheme: scheme, reducedMotion: 'reduce' });
  await opened.evaluate(() => document.querySelector('[data-autosurf-sites]').scrollIntoView({ block: 'start' })); await pause(150);
  let decodedFlags;
  await until(async () => {
    decodedFlags = await opened.evaluate(async () => {
      const images = [...document.querySelectorAll('[data-autosurf-sites] img')].filter(image => { const box = image.getBoundingClientRect(); return box.top < innerHeight && box.bottom > 0; });
      return Promise.race([Promise.all(images.map(async image => {
        let decoded = false; try { await image.decode(); decoded = true; } catch {}
        return { kind: image.hasAttribute('data-site-country-flag') ? 'country' : 'brand', country: image.dataset.siteCountryFlag, complete: image.complete, width: image.naturalWidth, height: image.naturalHeight, decoded };
      })), new Promise(resolve => setTimeout(() => resolve(null), 1000))]);
    });
    return decodedFlags?.every(image => image.complete && image.decoded);
  }, 'visible local flag and brand image decoding');
  evidence.flagDecoding ??= []; evidence.flagDecoding.push({ locale, images: decodedFlags });
  await opened.evaluate(() => document.querySelector('[data-autosurf-sites-search]').focus({ preventScroll: true }));
  const value = await opened.evaluate(() => {
    const picker = document.querySelector('[data-autosurf-sites]'), box = picker.getBoundingClientRect();
    const input = picker.querySelector('[data-autosurf-sites-search]'), searchStyle = getComputedStyle(input), wrapperStyle = getComputedStyle(input.closest('label'));
    const add = picker.querySelector('[data-autosurf-sites-add]'), addStyle = getComputedStyle(add);
    const footer = picker.querySelector('.autosurf-sites-footer'), footerBox = footer.getBoundingClientRect();
    const intersect = (first, second) => Math.min(first.right, second.right) - Math.max(first.left, second.left) > 1 && Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top) > 1;
    // Cards are clipped by their scroll container. Check its visible rectangle,
    // plus every filter group and pagination, against the actual footer box.
    const footerOverlaps = [...picker.querySelectorAll('.autosurf-sites-filters, .autosurf-sites-topics, .autosurf-sites-results, .autosurf-sites-pagination')].filter(element => intersect(footerBox, element.getBoundingClientRect())).map(element => element.className);
    const heading = id => {
      const title = picker.querySelector('#' + id), container = title?.closest('.autosurf-sites-heading');
      const badge = container?.querySelector(':scope > .autosurf-sites-heading__icon'), svg = badge?.querySelector('svg');
      if (!title || !container || !badge || !svg) return null;
      const titleStyle = getComputedStyle(title), titleBox = title.getBoundingClientRect(), badgeBox = badge.getBoundingClientRect(), svgBox = svg.getBoundingClientRect(), containerBox = container.getBoundingClientRect();
      const size = rect => ({ width: rect.width, height: rect.height });
      const contained = rect => rect.left >= box.left - 1 && rect.right <= box.right + 1 && rect.left >= containerBox.left - 1 && rect.right <= containerBox.right + 1;
      return { tag: title.tagName, commonTitle: title.classList.contains('autosurf-sites-section-title'), fontSize: parseFloat(titleStyle.fontSize), fontWeight: titleStyle.fontWeight, lineHeight: parseFloat(titleStyle.lineHeight),
        titleWidth: titleBox.width, titleHeight: titleBox.height, titleClipped: title.scrollWidth > title.clientWidth + 1 || title.scrollHeight > title.clientHeight + 1,
        titleContained: contained(titleBox), iconContained: contained(badgeBox) && svgBox.left >= badgeBox.left - 1 && svgBox.right <= badgeBox.right + 1 && svgBox.top >= badgeBox.top - 1 && svgBox.bottom <= badgeBox.bottom + 1,
        iconTitleOverlap: intersect(titleBox, badgeBox), badge: size(badgeBox), svg: size(svgBox), svgAriaHidden: svg.getAttribute('aria-hidden'), svgFocusable: svg.getAttribute('focusable'), svgTabIndex: svg.tabIndex,
        decorative: svg.getAttribute('aria-hidden') === 'true' && svg.tabIndex < 0 && svg.getAttribute('focusable')?.toLowerCase() !== 'true' };
    };
    const focusRules = [];
    const inspect = (rules, source) => { for (const rule of rules) { if (rule.cssRules) inspect(rule.cssRules, source); if (!rule.selectorText || !rule.style) continue; try { if (input.matches(rule.selectorText) && rule.style.outline) focusRules.push({ source, selector: rule.selectorText, outline: rule.style.outline }); } catch {} } };
    for (const sheet of document.styleSheets) try { inspect(sheet.cssRules, sheet.href?.split('/').at(-1)); } catch {}
    return { width: innerWidth, dir: document.documentElement.dir, overflow: document.documentElement.scrollWidth > innerWidth + 1,
      actualScheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      unresolved: /autosurf_sites_[a-z_]+/.test(picker.textContent), cards: picker.querySelectorAll('[data-autosurf-site]').length,
      flagCount: picker.querySelectorAll('img[data-site-country-flag]').length, brandCount: picker.querySelectorAll('img.autosurf-sites-system__logo').length, pickerWidth: box.width, inputType: input.type, inputOutline: searchStyle.outlineStyle, inputOutlineWidth: searchStyle.outlineWidth, focusRules,
      searchWrapperShadow: wrapperStyle.boxShadow, searchWrapperOutline: wrapperStyle.outlineStyle, searchWrapperOutlineWidth: wrapperStyle.outlineWidth,
      footerPosition: getComputedStyle(footer).position, footerOverlaps,
      managementScope: Boolean(picker.closest('.management-shell')), sectionRole: { size: parseFloat(getComputedStyle(picker).getPropertyValue('--ui-type-section-size')), weight: parseFloat(getComputedStyle(picker).getPropertyValue('--ui-type-section-weight')), line: parseFloat(getComputedStyle(picker).getPropertyValue('--ui-type-section-line')) }, headings: { find: heading('autosurf-sites-title'), systems: heading('autosurf-sites-systems-title') },
      disabledAdd: add.disabled, addColor: addStyle.color, addBackground: addStyle.backgroundColor };
  });
  evidence.layouts.push({ locale, scheme, ...value });
  assert.equal(value.overflow, false, locale + ' overflow'); assert.equal(value.unresolved, false); assert.equal(value.dir, locale === 'ar' ? 'rtl' : 'ltr');
  assert.ok(['static', 'relative'].includes(value.footerPosition), 'selection footer stays in normal flow');
  assert.deepEqual(value.footerOverlaps, [], 'selection footer cannot cover filters, visible cards or pagination');
  assert.equal(value.inputOutline, 'none', 'one search focus indicator');
  assert.ok(value.searchWrapperShadow !== 'none' || value.searchWrapperOutline !== 'none' && parseFloat(value.searchWrapperOutlineWidth) > 0, 'search wrapper retains focus indication');
  assert.equal(value.disabledAdd, true); assert.notEqual(value.addColor, value.addBackground, 'disabled Add retains a readable foreground'); assert.notEqual(value.addColor, 'rgba(0, 0, 0, 0)');
  assert.equal(value.managementScope, true, 'typography is measured in the actual internal management workspace');
  assert.ok(value.headings.find, 'Find sites title and decorative heading SVG exist');
  if (data.trackingSystems.length) {
    assert.ok(value.headings.systems, 'Tracking systems title and decorative heading SVG exist');
    // ADR-103: redesign.css sets the shared section role on body (16px/650/1.4); the legacy 18px :root default in ui-typography.css no longer applies inside the page.
    assert.deepEqual(value.sectionRole, { size: 16, weight: 650, line: 1.4 }, 'the picker inherits the approved shared section role');
    assert.equal(value.headings.find.tag, 'H3'); assert.equal(value.headings.systems.tag, 'H4', 'existing accessible heading level remains intact');
    for (const [name, heading] of Object.entries(value.headings)) {
      assert.equal(heading.commonTitle, true, name + ' uses the shared section-title presentation');
      assert.equal(heading.fontSize, value.sectionRole.size, name + ' computed size matches the approved 16px section token');
      assert.equal(Number(heading.fontWeight), value.sectionRole.weight, name + ' computed weight matches the approved 650 section token');
      assert.ok(Math.abs(heading.lineHeight - heading.fontSize * value.sectionRole.line) <= .05, name + ' computed line height matches the approved 1.4 section token');
      assert.equal(heading.decorative, true, name + ' SVG stays outside the accessible label');
      assert.ok(heading.titleWidth > 0 && heading.titleHeight > 0, name + ' rendered title');
      assert.equal(heading.titleClipped, false, name + ' title text is not clipped');
      assert.equal(heading.titleContained, true, name + ' title fits the actual narrow heading/picker');
      assert.equal(heading.iconContained, true, name + ' SVG fits its heading badge');
      assert.equal(heading.iconTitleOverlap, false, name + ' icon does not overlap title text');
      for (const dimension of ['width', 'height']) {
        assert.ok(Math.abs(heading.badge[dimension] - 34) <= .05, name + ' existing heading badge ' + dimension);
        assert.ok(Math.abs(heading.svg[dimension] - 20) <= .05, name + ' existing heading SVG ' + dimension);
      }
    }
    for (const property of ['fontSize', 'fontWeight', 'lineHeight']) assert.equal(value.headings.systems[property], value.headings.find[property], 'Tracking systems and Find sites computed ' + property);
    assert.deepEqual(value.headings.systems.badge, value.headings.find.badge, 'decorative heading badges have matching native dimensions');
    assert.deepEqual(value.headings.systems.svg, value.headings.find.svg, 'decorative heading SVGs have matching native dimensions');
  }
  if (browser === 'chrome') assert.equal(value.actualScheme, scheme);
  const filename = 'sites-' + browser + '-' + locale + '-' + value.actualScheme + '-' + width + '.png';
  // Full-page capture while scrolled can paint sticky navigation midway through
  // the document. Restore its actual initial position for faithful screenshots.
  await opened.evaluate(() => { document.activeElement?.blur(); scrollTo({ top: 0, left: 0 }); }); await pause(50);
  await opened.screenshot(join(artifact, filename));
  evidence.screenshots.push({ file: filename, sha256: createHash('sha256').update(readFileSync(join(artifact, filename))).digest('hex') });
}

try {
  opened = await launchOwnedManagement({ root, run, extension, browser, evidence }); evidence.browserVersion = opened.version;
  if (opened.context) {
    opened.context.on('page', page => page.on('pageerror', error => evidence.errors.push(error.message)));
    await opened.context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (['http:', 'https:'].includes(url.protocol)) { evidence.network.push(url.origin); await route.abort(); } else await route.continue();
    });
  }
  await opened.goto(opened.base + 'options.html#autosurf');
  await until(() => opened.evaluate(() => Boolean(document.querySelector('[data-autosurf-sites]')) && document.querySelector('[data-autosurf-field="urls"]')?.disabled === false), 'picker and saved controller state');
  await opened.evaluate(() => {
    const api = globalThis.browser ?? chrome, own = api.runtime.getURL(''); document.defaultView.__autosurfSiteEgress = [];
    api.webRequest.onBeforeRequest.addListener(details => {
      if (![details.originUrl, details.documentUrl, details.initiator].some(value => typeof value === 'string' && (value.startsWith(own) || value === own.slice(0, -1)))) return;
      const url = new URL(details.url); if (['http:', 'https:'].includes(url.protocol)) document.defaultView.__autosurfSiteEgress.push(url.origin);
    }, { urls: ['http://*/*', 'https://*/*'] });
  });
  const baseline = await state(), permissions = await opened.evaluate(() => (globalThis.browser ?? chrome).permissions.getAll());
  const tabCount = await opened.evaluate(() => (globalThis.browser ?? chrome).tabs.query({}).then(tabs => tabs.length));
  assert.equal(baseline.status, 'idle'); assert.equal(baseline.configuration.urls.length, 0);
  const appearance = await opened.evaluate(() => {
    const categories = [...document.querySelectorAll('[data-autosurf-sites-category]')].filter(element => element.dataset.autosurfSitesCategory !== 'all');
    return { count: categories.length, colors: categories.map(element => element.style.getPropertyValue('--site-color')), icons: categories.map(element => element.querySelector('svg path')?.getAttribute('d')),
      paintedIconColors: categories.map(element => getComputedStyle(element.querySelector('svg')).color), paintedBorderColors: categories.map(element => getComputedStyle(element).borderTopColor), paintedBackgrounds: categories.map(element => getComputedStyle(element).backgroundColor),
      flagsLocal: [...document.querySelectorAll('[data-autosurf-sites] img[data-site-country-flag]')].every(image => image.src.startsWith(location.protocol + '//' + location.host + '/icons/countries/')),
      brandsLocal: [...document.querySelectorAll('[data-autosurf-sites] img.autosurf-sites-system__logo')].every(image => image.src.startsWith(location.protocol + '//' + location.host + '/icons/brands/') || image.src.startsWith(location.protocol + '//' + location.host + '/icons/systems/')),
      allImagesLocal: [...document.querySelectorAll('[data-autosurf-sites] img')].every(image => image.src.startsWith(location.protocol + '//' + location.host + '/icons/') && !new URL(image.src).search) };
  });
  assert.equal(appearance.count, SITE_CATEGORY_IDS.length); assert.equal(new Set(appearance.colors).size, 20); assert.equal(new Set(appearance.icons).size, 20); assert.equal(appearance.flagsLocal, true); assert.equal(appearance.brandsLocal, true); assert.equal(appearance.allImagesLocal, true);
  assert.equal(new Set(appearance.paintedIconColors).size, 20, 'actual themed SVG colors survive shared controls CSS');
  // ADR-103 (redesign.css): resting chips share one calm surface, so each category hue must survive in the painted border stroke instead of the fill.
  assert.equal(new Set(appearance.paintedBorderColors).size, 20, 'actual themed category border strokes survive shared controls CSS');
  appearance.calmSurface = await calmSurface();
  assert.notEqual(appearance.calmSurface, 'rgba(0, 0, 0, 0)', 'the shared --rd-surface token resolves to an opaque colour');
  assert.deepEqual([...new Set(appearance.paintedBackgrounds)], [appearance.calmSurface], 'resting category chips paint the shared calm surface, not a transparent or foreign fill');
  evidence.appearance = appearance;
  check('packaged catalog renders 20 distinct category hues (icon and border stroke on one calm surface) and local flag images');

  phase = 'tracking systems'; await trackingSystemsFlow(baseline);
  phase = 'tracking-system categories'; await trackingCategoriesFlow(baseline);
  phase = 'active tracking filters'; await activeTrackingFiltersFlow(baseline);

  phase = 'empty search'; await opened.fill('[data-autosurf-sites-search]', 'owned-query-with-no-real-matches-638462');
  await until(() => opened.evaluate(() => Boolean(document.querySelector('[data-autosurf-sites-empty]'))), 'empty search state');
  await opened.click('[data-autosurf-sites-clear-filters]');
  await until(() => opened.evaluate(() => document.querySelectorAll('[data-autosurf-site]').length > 0), 'clear filters restores results');
  check('site search has a real empty state and clearing filters restores catalog results');

  phase = 'country keyboard'; await keyboardCountry(); await chooseCategory('automotive');
  await until(() => opened.evaluate(() => document.querySelector('[data-autosurf-sites-category="automotive"]').getAttribute('aria-pressed') === 'true'), 'automotive selected');
  assert.ok(await opened.evaluate(() => document.querySelectorAll('[data-autosurf-site]').length > 0));
  // ADR-103: only the selected chip tints its fill with its own hue; the other chips keep the calm resting surface.
  evidence.selectedChip = await until(() => opened.evaluate(() => {
    const selected = getComputedStyle(document.querySelector('[data-autosurf-sites-category="automotive"]')), resting = getComputedStyle(document.querySelector('[data-autosurf-sites-category="news"]'));
    return selected.backgroundColor !== resting.backgroundColor ? { selected: selected.backgroundColor, resting: resting.backgroundColor } : null;
  }), 'the selected category tints its own surface');
  assert.equal(evidence.selectedChip.resting, appearance.calmSurface, 'an unselected category keeps the calm resting surface');
  check('native country search and Enter choose Montenegro; category filter returns real matching sites');

  phase = 'unsaved draft'; await opened.fill('[data-autosurf-field="urls"]', manual);
  await opened.fill('[data-autosurf-sites-search]', existingSite.id);
  await until(() => opened.evaluate(id => document.querySelector('[data-autosurf-site-select="' + id + '"]')?.disabled === true, existingSite.id), 'canonical existing root is already planned');
  await opened.fill('[data-autosurf-sites-search]', selectedSite.id);
  await until(() => opened.evaluate(id => document.querySelector('[data-autosurf-site-select="' + id + '"]')?.disabled === false, selectedSite.id), 'new root selectable');
  await opened.click('[data-autosurf-site-select="' + selectedSite.id + '"]');
  assert.equal(await readDraft(), manual); assert.equal((await state()).revision, baseline.revision);
  await opened.click('[data-autosurf-sites-add]');
  await until(async () => (await readDraft()).includes(selectedSite.origin + '/'), 'explicit add updates draft');
  const combined = await readDraft(); assert.equal(combined, manual + '\n' + selectedSite.origin + '/');
  const unchanged = await state(); assert.equal(unchanged.revision, baseline.revision); assert.deepEqual(unchanged.configuration.urls, []); assert.equal(unchanged.status, 'idle');
  check('selection and Add change only the unsaved draft; manual path/query/fragment and existing roots remain exact');

  phase = 'layouts'; await opened.fill('[data-autosurf-sites-search]', '');
  await layout('ru', 1180, 'light'); if (browser === 'chrome') await layout('ru', 1180, 'dark');
  await layout('ru', browser === 'firefox' ? 520 : 390, 'light');
  await layout('ar', browser === 'firefox' ? 520 : 390, 'light');
  check('localized RU desktop and Arabic narrow layouts load local flags without overflow; Chrome also covers dark mode');
  if (data.trackingSystems.length) check('Tracking systems and Find sites match the native computed 16px/650/1.4 section tokens and retain 34px badges/20px decorative SVGs without narrow-layout clipping');

  phase = 'save explicitly'; await opened.click('[data-autosurf-save]');
  await until(async () => (await state()).configuration.urls.length === 3, 'explicit Save persists three URLs');
  const saved = await state(); assert.equal(saved.revision, baseline.revision + 1); assert.equal(saved.status, 'idle');
  assert.equal(await opened.evaluate(() => (globalThis.browser ?? chrome).tabs.query({}).then(tabs => tabs.length)), tabCount);
  assert.deepEqual(await opened.evaluate(() => (globalThis.browser ?? chrome).permissions.getAll()), permissions);
  evidence.nativeEgress = await opened.evaluate(() => document.defaultView.__autosurfSiteEgress); assert.deepEqual(evidence.nativeEgress, []); assert.deepEqual(evidence.network, []);
  assert.equal(saved.capabilities.supported, browser === 'chrome');
  check('only explicit Save persists the plan; picker creates no tabs, grants no permissions and never starts browsing');
  assert.deepEqual(evidence.errors, []); evidence.result = 'PASS'; console.log('PASS site picker ' + browser + ': ' + evidence.checks.length + ' groups');
} catch (error) {
  evidence.result = 'FAIL'; evidence.failure = { phase, message: error.stack }; process.exitCode = 1;
  try { await opened?.screenshot(join(artifact, 'sites-' + browser + '-failure.png')); } catch {}
  console.error(error);
} finally { await opened?.close(); evidence.finishedAt = new Date().toISOString(); writeFileSync(join(artifact, 'native-sites-' + browser + '.json'), JSON.stringify(evidence, null, 2) + '\n'); }
