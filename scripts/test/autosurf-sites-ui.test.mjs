// ADR-077: actual site-picker component, bounded selection and parent draft handoff.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAutosurfSitesUi, AUTOSURF_SITE_THEMES, AUTOSURF_TRACKING_CATEGORY_THEMES, autosurfSiteCountryName } from '../../apps/production-extension/autosurf-sites-ui.js';
import { SITE_CATEGORY_IDS, SITE_TRACKING_CATEGORY_IDS, mergeAutosurfSiteUrls } from '../../apps/production-extension/autosurf-sites.js';
import { AUTOSURF_SITES_UI_MESSAGES } from '../production-locales-autosurf-sites.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';
import { AUTOSURF_SITES_DATA } from '../../apps/production-extension/autosurf-sites-data.js';

const fixture = () => ({ version: 1, revision: 'owned-test', publishedAt: '2026-10-13', countries: ['US', 'ME', 'FR'], categories: [...SITE_CATEGORY_IDS],
  sources: [{ id: 'owned-metadata', title: 'Owned metadata fixture', url: 'https://source.example/catalog', license: 'CC0-1.0', asOf: '2026-09' }],
  sites: Array.from({ length: 30 }, (_, index) => ({ id: 'site' + index + '.example', name: 'Café ' + String(index).padStart(2, '0'), origin: 'https://site' + index + '.example', countries: index % 2 ? ['FR'] : ['US', 'ME'], categories: [SITE_CATEGORY_IDS[index % SITE_CATEGORY_IDS.length]], rankBuckets: Object.fromEntries((index % 2 ? ['FR'] : ['US', 'ME']).map(code => [code, 1000])) })) });

const trackingFixture = () => {
  const catalog = fixture();
  catalog.trackingSystems = [
    { id: 'forter', name: 'Forter', categories: ['fraud-prevention'] },
    { id: 'datadome', name: 'DataDome', categories: ['fraud-prevention', 'bot-management', 'bot-detection'] },
    { id: 'fingerprint', name: 'Fingerprint', categories: ['device-fingerprinting'] },
    { id: 'hcaptcha', name: 'hCaptcha', categories: ['captcha'] },
    { id: 'truefit', name: 'TrueFit', categories: ['ecommerce-intelligence'] },
  ];
  catalog.sites[0].trackingSystems = ['forter', 'datadome'];
  catalog.sites[1].trackingSystems = ['forter'];
  catalog.sites[2].trackingSystems = ['datadome', 'fingerprint'];
  catalog.sites[3].trackingSystems = ['hcaptcha'];
  catalog.sites[4].trackingSystems = ['truefit'];
  return catalog;
};

const searchableTrackingFixture = () => {
  const catalog = trackingFixture();
  catalog.trackingSystems.push(...Array.from({ length: 15 }, (_, index) => ({ id: 'extra-' + index, name: 'Extra ' + String(index).padStart(2, '0'), categories: ['ecommerce-intelligence'] })));
  return catalog;
};

function harness(initial = {}, options = {}) {
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const listeners = new Map(); Object.defineProperty(globalThis, 'document', { configurable: true, value: { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name), getElementById: () => null } });
  const slots = [], effects = [], additions = []; let cursor = 0, dirty = true, tree;
  const props = { locale: 'en', currentUrls: '', disabled: false, ...initial };
  props.onAdd ??= origins => { additions.push(origins); const result = mergeAutosurfSiteUrls(props.currentUrls, origins); if (!result.error) { props.currentUrls = result.text; dirty = true; } return result; };
  const hooks = { useState(initialValue) { const slot = slots[cursor++] ??= { value: typeof initialValue === 'function' ? initialValue() : initialValue }; return [slot.value, next => { const value = typeof next === 'function' ? next(slot.value) : next; if (!Object.is(value, slot.value)) { slot.value = value; dirty = true; } }]; }, useRef(value) { return (slots[cursor++] ??= { ref: { current: value } }).ref; }, useEffect(callback, dependencies) { const slot = slots[cursor++] ??= {}; if (!slot.dependencies || dependencies.some((value, index) => !Object.is(value, slot.dependencies[index]))) { slot.dependencies = dependencies; effects.push(() => { slot.cleanup?.(); slot.cleanup = callback(); }); } } };
  const { AutosurfSites } = createAutosurfSitesUi({ ...hooks, h: (type, properties, key) => ({ type, props: properties, key }), catalog: options.catalog ?? fixture(), translate: key => AUTOSURF_SITES_UI_MESSAGES[props.locale]?.[key] ?? key });
  function render() { cursor = 0; dirty = false; tree = AutosurfSites(props); while (effects.length) effects.shift()(); }
  function settle() { for (let count = 0; dirty && count < 20; count++) render(); assert.equal(dirty, false, 'component state settles'); }
  function nodes(predicate, start = tree) { const found = []; const visit = node => { if (Array.isArray(node)) return node.forEach(visit); if (!node?.props) return; if (predicate(node)) found.push(node); visit(node.props.children); }; visit(start); return found; }
  const attr = (key, value = true) => nodes(node => node.props[key] === value)[0];
  const text = node => Array.isArray(node) ? node.map(text).join(' ') : node?.props ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
  render(); settle();
  return { additions, props, nodes, attr, text: () => text(tree).replace(/\s+/gu, ' ').trim(), settle, update(patch) { Object.assign(props, patch); dirty = true; settle(); }, click(key, value = true) { const node = attr(key, value); assert.ok(node, key); if (!node.props.disabled) node.props.onClick?.(); settle(); }, input(key, value) { attr(key).props.onInput({ currentTarget: { value } }); settle(); }, select(id) { const node = attr('data-autosurf-site-select', id); assert.ok(node, id); if (!node.props.disabled) node.props.onChange(); settle(); }, cleanup() { for (const slot of slots) slot.cleanup?.(); if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else delete globalThis.document; } };
}

test('twenty categories have distinct authored colors and icons; results and flags are bounded local assets', () => {
  const h = harness(); try {
    assert.deepEqual(Object.keys(AUTOSURF_SITE_THEMES), SITE_CATEGORY_IDS); assert.equal(new Set(Object.values(AUTOSURF_SITE_THEMES).map(value => value[0])).size, 20);
    assert.equal(h.nodes(node => Object.hasOwn(node.props, 'data-autosurf-sites-category')).length, 21);
    assert.equal(h.nodes(node => Object.hasOwn(node.props, 'data-autosurf-site')).length, 12);
    assert.ok(h.nodes(node => node.type === 'img').every(node => /^icons\/countries\/(?:us|me|fr)\.svg$/.test(node.props.src) && node.props.alt === ''));
    assert.match(h.text(), /Find sites/); assert.doesNotMatch(h.text(), /autosurf_sites_category_real-estate/);
  } finally { h.cleanup(); }
});

test('site search, empty reset and category filters use actual rows and exact result counts', () => {
  const h = harness(); try {
    h.input('data-autosurf-sites-search', 'site23.example'); assert.equal(h.nodes(node => Object.hasOwn(node.props, 'data-autosurf-site')).length, 1); assert.ok(h.attr('data-autosurf-site', 'site23.example'));
    h.input('data-autosurf-sites-search', 'not-a-site-never-matches'); assert.ok(h.attr('data-autosurf-sites-empty'));
    h.click('data-autosurf-sites-clear-filters'); assert.equal(h.nodes(node => Object.hasOwn(node.props, 'data-autosurf-site')).length, 12);
    h.click('data-autosurf-sites-category', 'real-estate'); assert.ok(h.attr('data-autosurf-site', 'site10.example')); assert.match(h.text(), /Real estate/);
    h.click('data-autosurf-sites-category', 'all'); h.click('data-autosurf-sites-next'); assert.match(h.text(), /Page 2 \/ 3/);
  } finally { h.cleanup(); }
});

test('separate tracking facet filters the common catalog, preserves selection and adds only on explicit handoff', () => {
  const catalog = fixture();
  catalog.trackingSystems = [{ id: 'forter', name: 'Forter', categories: ['fraud-prevention'], sourceUrl: 'https://source.example/forter' }, { id: 'fingerprint', name: 'Fingerprint', categories: ['bot-management'], sourceUrl: 'https://source.example/fingerprint' }];
  catalog.sites[0].trackingSystems = ['forter', 'fingerprint']; catalog.sites[1].trackingSystems = ['forter'];
  const h = harness({ locale: 'ru' }, { catalog }); try {
    assert.match(h.text(), /Категории/); assert.match(h.text(), /Трекинг-системы/);
    assert.equal(h.nodes(node => node.type === 'h4').length, 2);
    h.select('site0.example'); h.click('data-autosurf-sites-system', 'forter');
    assert.equal(h.nodes(node => Object.hasOwn(node.props, 'data-autosurf-site')).length, 2); assert.ok(h.attr('data-autosurf-sites-selected', 1));
    assert.equal(h.attr('data-autosurf-sites-system', 'forter').props['aria-pressed'], true);
    const brands = h.nodes(node => node.type === 'img' && node.props.class === 'autosurf-sites-system__logo');
    assert.ok(brands.length >= 2); assert.ok(brands.every(node => /\/icons\/(?:brands|systems)\/[a-z0-9.-]+$/.test(node.props.src)));
    h.click('data-autosurf-sites-category', 'automotive'); assert.ok(h.attr('data-autosurf-site', 'site1.example')); assert.equal(h.additions.length, 0);
    h.click('data-autosurf-sites-add'); assert.deepEqual(h.additions, [['https://site0.example']]); assert.ok(h.attr('data-autosurf-sites-selected', 0));
    h.click('data-autosurf-sites-system', 'all'); h.click('data-autosurf-sites-system', 'fingerprint'); assert.ok(h.attr('data-autosurf-sites-empty'));
    h.click('data-autosurf-sites-clear-filters'); assert.equal(h.attr('data-autosurf-sites-system', 'all').props['aria-pressed'], true); assert.equal(h.nodes(node => Object.hasOwn(node.props, 'data-autosurf-site')).length, 12);
  } finally { h.cleanup(); }
});

test('six tracking categories have distinct colors and icons, accessible native buttons and distinct-site counts', () => {
  const h = harness({}, { catalog: trackingFixture() }); try {
    assert.deepEqual(Object.keys(AUTOSURF_TRACKING_CATEGORY_THEMES), SITE_TRACKING_CATEGORY_IDS);
    assert.equal(new Set(Object.values(AUTOSURF_TRACKING_CATEGORY_THEMES).map(value => value[0])).size, 6);
    assert.equal(new Set(Object.values(AUTOSURF_TRACKING_CATEGORY_THEMES).map(value => value[1])).size, 6);
    const group = h.nodes(node => node.props['aria-labelledby'] === 'autosurf-sites-system-categories-title')[0];
    assert.equal(group.props.role, 'group');
    assert.equal(h.nodes(node => node.props.id === 'autosurf-sites-system-categories-title')[0].props.children, 'System categories');
    const chips = h.nodes(node => Object.hasOwn(node.props, 'data-autosurf-sites-system-category'), group);
    assert.equal(chips.length, 7);
    for (const chip of chips) {
      assert.equal(chip.type, 'button'); assert.equal(chip.props.type, 'button');
      assert.equal(typeof chip.props['aria-pressed'], 'boolean'); assert.notEqual(chip.props.tabIndex, -1);
      assert.equal(chip.props.onKeyDown, undefined, 'native button activation handles Enter and Space');
      const marks = h.nodes(node => node.type === 'svg', chip); assert.equal(marks.length, 1);
      assert.equal(marks[0].props['aria-hidden'], true); assert.equal(marks[0].props.focusable, false);
    }
    const count = id => h.nodes(node => node.type === 'small', h.attr('data-autosurf-sites-system-category', id))[0].props.children;
    assert.equal(count('fraud-prevention'), '3', 'multiple matching systems count one site');
    assert.equal(count('bot-management'), '2'); assert.equal(count('device-fingerprinting'), '1');
    assert.equal(count('ecommerce-intelligence'), '1'); assert.equal(count('bot-detection'), '2'); assert.equal(count('captcha'), '1');
    h.click('data-autosurf-sites-system-category', 'fraud-prevention');
    assert.equal(h.nodes(node => Object.hasOwn(node.props, 'data-autosurf-site')).length, 3);
    assert.equal(h.attr('data-autosurf-sites-system-count', 2).props.children, '2');
    assert.deepEqual(h.nodes(node => Object.hasOwn(node.props, 'data-autosurf-sites-system')).map(node => node.props['data-autosurf-sites-system']), ['all', 'forter', 'datadome']);
    assert.equal(count('captcha'), '1', 'other category counts remain useful while scoped');
    assert.equal(h.additions.length, 0);
  } finally { h.cleanup(); }
});

test('tracking categories reset an incompatible system, retain a multi-category system and preserve selected sites and draft', () => {
  const draft = 'https://manual.example/path?keep=1';
  const h = harness({ currentUrls: draft }, { catalog: trackingFixture() }); try {
    h.select('site4.example'); h.click('data-autosurf-sites-system', 'forter');
    h.click('data-autosurf-sites-system-category', 'bot-management');
    assert.equal(h.attr('data-autosurf-sites-system', 'all').props['aria-pressed'], true);
    assert.equal(h.attr('data-autosurf-sites-system', 'forter'), undefined);
    assert.ok(h.attr('data-autosurf-site', 'site0.example')); assert.ok(h.attr('data-autosurf-site', 'site2.example'));
    assert.ok(h.attr('data-autosurf-sites-selected', 1)); assert.equal(h.props.currentUrls, draft);
    h.click('data-autosurf-sites-system', 'datadome'); h.click('data-autosurf-sites-system-category', 'fraud-prevention');
    assert.equal(h.attr('data-autosurf-sites-system', 'datadome').props['aria-pressed'], true);
    assert.equal(h.attr('data-autosurf-site', 'site1.example'), undefined);
    h.click('data-autosurf-sites-system-category', 'bot-detection');
    assert.equal(h.attr('data-autosurf-sites-system', 'datadome').props['aria-pressed'], true);
    h.click('data-autosurf-sites-system-category', 'all');
    assert.equal(h.attr('data-autosurf-sites-system', 'datadome').props['aria-pressed'], true, 'all categories keeps an individual system');
    h.click('data-autosurf-sites-system-category', 'captcha');
    assert.equal(h.attr('data-autosurf-sites-system', 'all').props['aria-pressed'], true);
    assert.ok(h.attr('data-autosurf-site', 'site3.example')); assert.equal(h.props.currentUrls, draft);
    assert.equal(h.additions.length, 0, 'filters never invoke Add, Save or Start');
    h.click('data-autosurf-sites-add'); assert.deepEqual(h.additions, [['https://site4.example']]);
    assert.equal(h.props.currentUrls, draft + '\nhttps://site4.example/');
    assert.ok(h.attr('data-autosurf-sites-selected', 0));
  } finally { h.cleanup(); }
});

test('tracking categories intersect country, site topic and text while reset restores every scope', () => {
  const h = harness({}, { catalog: trackingFixture() }); try {
    h.click('data-autosurf-sites-system-category', 'fraud-prevention');
    h.click('data-autosurf-sites-country', 'all'); h.click('data-autosurf-sites-country-option', 'FR');
    assert.ok(h.attr('data-autosurf-site', 'site1.example'));
    assert.equal(h.nodes(node => Object.hasOwn(node.props, 'data-autosurf-site')).length, 1);
    h.click('data-autosurf-sites-category', 'automotive'); h.input('data-autosurf-sites-search', 'site1.example');
    assert.ok(h.attr('data-autosurf-site', 'site1.example'));
    h.click('data-autosurf-sites-system-category', 'captcha'); assert.ok(h.attr('data-autosurf-sites-empty'));
    h.click('data-autosurf-sites-clear-filters');
    assert.equal(h.attr('data-autosurf-sites-system-category', 'all').props['aria-pressed'], true);
    assert.equal(h.attr('data-autosurf-sites-system', 'all').props['aria-pressed'], true);
    assert.equal(h.nodes(node => Object.hasOwn(node.props, 'data-autosurf-site')).length, 12);
  } finally { h.cleanup(); }
});

test('tracking categories remain browsable in readonly mode without changing the draft or calling Add', () => {
  const draft = 'https://manual.example/';
  const h = harness({ disabled: true, currentUrls: draft }, { catalog: trackingFixture() }); try {
    h.click('data-autosurf-sites-system-category', 'captcha');
    assert.equal(h.attr('data-autosurf-sites-system-category', 'captcha').props['aria-pressed'], true);
    assert.ok(h.attr('data-autosurf-site', 'site3.example'));
    h.select('site3.example'); h.click('data-autosurf-sites-select-page'); h.click('data-autosurf-sites-add');
    assert.equal(h.additions.length, 0); assert.equal(h.props.currentUrls, draft); assert.ok(h.attr('data-autosurf-sites-selected', 0));
  } finally { h.cleanup(); }
});

test('production AWS filter has a visible removable chip and removing it restores the full catalogue', () => {
  const h = harness({}, { catalog: AUTOSURF_SITES_DATA }); try {
    h.input('data-autosurf-sites-system-search', 'Amazon AWS');
    h.click('data-autosurf-sites-system', 'amazon-aws-waf-captcha');
    const count = () => h.nodes(node => node.type === 'strong', h.nodes(node => node.props.class === 'autosurf-sites-results-heading')[0])[0].props.children;
    assert.equal(count(), '177');
    const selected = h.attr('data-autosurf-sites-active-system', 'amazon-aws-waf-captcha');
    assert.equal(selected.type, 'button'); assert.match(selected.props['aria-label'], /Amazon AWS WAF Captcha/);
    assert.equal(h.nodes(node => node.type === 'img' && Object.hasOwn(node.props, 'data-system-logo'), selected).length, 1);
    h.click('data-autosurf-sites-remove-filter', 'system:amazon-aws-waf-captcha');
    assert.equal(h.attr('data-autosurf-sites-system', 'all').props['aria-pressed'], true);
    assert.equal(count(), new Intl.NumberFormat('en').format(AUTOSURF_SITES_DATA.sites.length));
    assert.equal(h.attr('data-autosurf-sites-remove-filter', 'system:amazon-aws-waf-captcha'), undefined);
    assert.ok(h.attr('data-autosurf-sites-remove-filter', 'system-query'), 'removing a system preserves the independent system-name search');
    h.click('data-autosurf-sites-clear-all-filters'); assert.equal(h.attr('data-autosurf-sites-active-filters'), undefined);
    assert.equal(h.additions.length, 0);
  } finally { h.cleanup(); }
});

test('multiple system filters match any selected system, deduplicate sites, and support remove-one and remove-last', () => {
  const h = harness({}, { catalog: trackingFixture() }); try {
    const rows = () => h.nodes(node => Object.hasOwn(node.props, 'data-autosurf-site')).map(node => node.props['data-autosurf-site']);
    h.click('data-autosurf-sites-system', 'forter'); assert.deepEqual(rows(), ['site0.example', 'site1.example']);
    h.click('data-autosurf-sites-system', 'datadome');
    assert.deepEqual(rows(), ['site0.example', 'site1.example', 'site2.example']);
    assert.ok(h.attr('data-autosurf-sites-selected-systems', 2)); assert.match(h.text(), /Sites with any selected system/);
    assert.equal(h.attr('data-autosurf-sites-system', 'forter').props['aria-pressed'], true);
    assert.equal(h.attr('data-autosurf-sites-system', 'datadome').props['aria-pressed'], true);
    h.click('data-autosurf-sites-remove-filter', 'system:forter');
    assert.deepEqual(rows(), ['site0.example', 'site2.example']); assert.ok(h.attr('data-autosurf-sites-selected-systems', 1));
    assert.equal(h.attr('data-autosurf-sites-system', 'forter').props['aria-pressed'], false);
    assert.ok(h.attr('data-autosurf-sites-active-system', 'datadome'));
    h.click('data-autosurf-sites-remove-filter', 'system:datadome');
    assert.equal(rows().length, 12); assert.equal(h.attr('data-autosurf-sites-selected-systems', 0), undefined);
    assert.equal(h.attr('data-autosurf-sites-active-filters'), undefined);
    h.click('data-autosurf-sites-system', 'forter'); h.click('data-autosurf-sites-system', 'forter');
    assert.equal(h.attr('data-autosurf-sites-system', 'all').props['aria-pressed'], true, 'clicking a selected system toggles it off');
  } finally { h.cleanup(); }
});

test('category changes retain only compatible selected systems and All systems clears only the system selection', () => {
  const h = harness({}, { catalog: trackingFixture() }); try {
    h.click('data-autosurf-sites-system', 'forter'); h.click('data-autosurf-sites-system', 'datadome');
    h.click('data-autosurf-sites-system-category', 'fraud-prevention'); assert.ok(h.attr('data-autosurf-sites-selected-systems', 2));
    h.click('data-autosurf-sites-system-category', 'bot-management'); assert.ok(h.attr('data-autosurf-sites-selected-systems', 1));
    assert.equal(h.attr('data-autosurf-sites-active-system', 'forter'), undefined);
    assert.equal(h.attr('data-autosurf-sites-system', 'datadome').props['aria-pressed'], true);
    h.click('data-autosurf-sites-system-category', 'all'); assert.ok(h.attr('data-autosurf-sites-selected-systems', 1));
    h.click('data-autosurf-sites-system-category', 'fraud-prevention');
    h.click('data-autosurf-sites-category', 'news'); h.input('data-autosurf-sites-search', 'site0');
    h.click('data-autosurf-sites-system', 'all');
    assert.equal(h.attr('data-autosurf-sites-system', 'all').props['aria-pressed'], true);
    assert.equal(h.attr('data-autosurf-sites-system-category', 'fraud-prevention').props['aria-pressed'], true);
    assert.equal(h.attr('data-autosurf-sites-category', 'news').props['aria-pressed'], true);
    assert.equal(h.attr('data-autosurf-sites-search').props.value, 'site0');
    assert.ok(h.attr('data-autosurf-sites-remove-filter', 'tracking-category'));
  } finally { h.cleanup(); }
});

test('Clear all resets every visible filter while preserving site selection and the unsaved plan', () => {
  const draft = 'https://manual.example/unsaved?keep=1';
  const h = harness({ currentUrls: draft }, { catalog: searchableTrackingFixture() }); try {
    h.select('site5.example'); h.click('data-autosurf-sites-system', 'forter'); h.click('data-autosurf-sites-system', 'datadome');
    h.click('data-autosurf-sites-country', 'all'); h.click('data-autosurf-sites-country-option', 'US');
    h.click('data-autosurf-sites-category', 'news'); h.click('data-autosurf-sites-system-category', 'fraud-prevention');
    h.input('data-autosurf-sites-search', 'site0'); h.input('data-autosurf-sites-system-search', 'does not match');
    const bar = h.attr('data-autosurf-sites-active-filters');
    assert.equal(h.nodes(node => Object.hasOwn(node.props, 'data-autosurf-sites-remove-filter'), bar).length, 7);
    assert.ok(h.attr('data-autosurf-sites-selected', 1)); assert.equal(h.props.currentUrls, draft);
    h.click('data-autosurf-sites-clear-all-filters');
    assert.equal(h.attr('data-autosurf-sites-active-filters'), undefined);
    assert.equal(h.attr('data-autosurf-sites-search').props.value, ''); assert.equal(h.attr('data-autosurf-sites-system-search').props.value, '');
    assert.ok(h.attr('data-autosurf-sites-country', 'all')); assert.equal(h.attr('data-autosurf-sites-category', 'all').props['aria-pressed'], true);
    assert.equal(h.attr('data-autosurf-sites-system-category', 'all').props['aria-pressed'], true);
    assert.equal(h.attr('data-autosurf-sites-system', 'all').props['aria-pressed'], true);
    assert.ok(h.attr('data-autosurf-sites-selected', 1)); assert.equal(h.props.currentUrls, draft); assert.equal(h.additions.length, 0);
    h.click('data-autosurf-sites-add'); assert.deepEqual(h.additions, [['https://site5.example']]);
  } finally { h.cleanup(); }
});

test('each active-filter remove button clears only its own filter and zero-results reset stays reachable', () => {
  const h = harness({}, { catalog: searchableTrackingFixture() }); try {
    h.click('data-autosurf-sites-system', 'forter');
    h.click('data-autosurf-sites-country', 'all'); h.click('data-autosurf-sites-country-option', 'FR');
    h.click('data-autosurf-sites-category', 'automotive'); h.click('data-autosurf-sites-system-category', 'fraud-prevention');
    h.input('data-autosurf-sites-search', 'no matching site'); h.input('data-autosurf-sites-system-search', 'nothing');
    assert.ok(h.attr('data-autosurf-sites-empty')); assert.ok(h.attr('data-autosurf-sites-clear-all-filters'));
    h.click('data-autosurf-sites-remove-filter', 'query');
    assert.ok(h.attr('data-autosurf-site', 'site1.example'));
    assert.equal(h.attr('data-autosurf-sites-system-search').props.value, 'nothing');
    h.click('data-autosurf-sites-remove-filter', 'country');
    assert.ok(h.attr('data-autosurf-sites-country', 'all')); assert.ok(h.attr('data-autosurf-sites-remove-filter', 'category'));
    h.click('data-autosurf-sites-remove-filter', 'category');
    assert.equal(h.attr('data-autosurf-sites-category', 'all').props['aria-pressed'], true);
    assert.equal(h.attr('data-autosurf-sites-system-category', 'fraud-prevention').props['aria-pressed'], true);
    h.click('data-autosurf-sites-remove-filter', 'tracking-category');
    assert.equal(h.attr('data-autosurf-sites-system-category', 'all').props['aria-pressed'], true);
    assert.equal(h.attr('data-autosurf-sites-system', 'forter').props['aria-pressed'], true);
    h.click('data-autosurf-sites-remove-filter', 'system-query');
    assert.equal(h.attr('data-autosurf-sites-system-search').props.value, '');
    h.click('data-autosurf-sites-remove-filter', 'system:forter');
    assert.equal(h.attr('data-autosurf-sites-active-filters'), undefined); assert.equal(h.additions.length, 0);
  } finally { h.cleanup(); }
});

test('selected systems remain pinned before other options in collapsed lists and unrelated name searches', () => {
  const h = harness({}, { catalog: searchableTrackingFixture() }); try {
    h.input('data-autosurf-sites-system-search', 'TrueFit'); h.click('data-autosurf-sites-system', 'truefit');
    h.input('data-autosurf-sites-system-search', '');
    const systems = () => h.nodes(node => Object.hasOwn(node.props, 'data-autosurf-sites-system'));
    assert.equal(systems()[1].props['data-autosurf-sites-system'], 'truefit'); assert.equal(systems().length, 13);
    assert.equal(systems()[1].key, 'truefit', 'the shipped JSX factory takes VNode keys as its third argument');
    h.input('data-autosurf-sites-system-search', 'Fingerprint');
    assert.deepEqual(systems().map(node => node.props['data-autosurf-sites-system']), ['all', 'truefit', 'fingerprint']);
    assert.equal(h.attr('data-autosurf-sites-system', 'truefit').props['aria-pressed'], true);
    assert.ok(h.attr('data-autosurf-sites-active-system', 'truefit'));
    h.input('data-autosurf-sites-system-search', 'absent');
    assert.deepEqual(systems().map(node => node.props['data-autosurf-sites-system']), ['all', 'truefit']);
    assert.match(h.text(), /No systems found/); assert.ok(h.attr('data-autosurf-sites-remove-filter', 'system:truefit'));
  } finally { h.cleanup(); }
});

test('active filters are accessible native buttons above categories and restore keyboard focus after removal', () => {
  const h = harness({}, { catalog: trackingFixture() }); try {
    h.click('data-autosurf-sites-system', 'forter'); h.click('data-autosurf-sites-category', 'news');
    const section = h.nodes(node => node.type === 'section')[0], children = section.props.children;
    const bar = h.attr('data-autosurf-sites-active-filters');
    assert.ok(children.indexOf(bar) > children.findIndex(node => node?.props?.class === 'autosurf-sites-filters'));
    assert.ok(children.indexOf(bar) < children.findIndex(node => node?.props?.class === 'autosurf-sites-facet'));
    assert.equal(bar.props.role, 'group'); assert.equal(bar.props['aria-labelledby'], 'autosurf-sites-active-filters-title');
    for (const button of h.nodes(node => Object.hasOwn(node.props, 'data-autosurf-sites-remove-filter'), bar)) {
      assert.equal(button.type, 'button'); assert.equal(button.props.type, 'button'); assert.match(button.props['aria-label'], /^Remove filter: /);
      assert.equal(button.props.onKeyDown, undefined); assert.notEqual(button.props.tabIndex, -1);
      const close = h.nodes(node => node.props.class?.includes?.('autosurf-sites-active-filter__close'), button)[0];
      assert.equal(close.type, 'svg'); assert.equal(close.props['aria-hidden'], true);
    }
    let remainingFocus = 0, searchFocus = 0;
    bar.props.ref.current = { querySelector: () => ({ focus() { remainingFocus++; } }) };
    h.click('data-autosurf-sites-remove-filter', 'category'); assert.equal(remainingFocus, 1);
    h.attr('data-autosurf-sites-active-filters').props.ref.current = null;
    h.attr('data-autosurf-sites-search').props.ref.current = { focus() { searchFocus++; } };
    h.click('data-autosurf-sites-remove-filter', 'system:forter'); assert.equal(searchFocus, 1);
    assert.equal(h.attr('data-autosurf-sites-active-filters'), undefined);
  } finally { h.cleanup(); }
});

test('keyboard system toggling restores the same identity after DOM reorder without taking focus from other controls', () => {
  const h = harness({}, { catalog: trackingFixture() }); try {
    const document = globalThis.document, body = {}, source = {}, moved = {}, otherControl = {};
    document.body = body; document.activeElement = source; let focused = 0;
    const commit = () => h.nodes(node => node.props.id === 'autosurf-sites-system-options')[0].props.ref({ querySelector(selector) {
      assert.equal(selector, '[data-autosurf-sites-system="forter"]');
      return { focus() { focused++; document.activeElement = moved; } };
    } });
    const click = (currentTarget, detail) => { h.attr('data-autosurf-sites-system', 'forter').props.onClick({ currentTarget, detail }); h.settle(); };
    click(source, 0); commit(); assert.equal(focused, 1); assert.equal(document.activeElement, moved);
    assert.equal(h.attr('data-autosurf-sites-system', 'forter').key, 'forter');
    assert.equal(h.attr('data-autosurf-sites-active-system', 'forter').key, 'system:forter');
    assert.equal(h.attr('data-autosurf-site', 'site0.example').key, 'site0.example');
    click(moved, 0); document.activeElement = body; commit(); assert.equal(focused, 2);
    assert.equal(h.attr('data-autosurf-sites-system', 'forter').props['aria-pressed'], false);
    document.activeElement = source; click(source, 1); commit(); assert.equal(focused, 2, 'pointer activation does not force keyboard focus');
    document.activeElement = source; click(source, 0); document.activeElement = otherControl; commit();
    assert.equal(focused, 2, 'a user who moved to another control keeps that focus');
    click(source, 0); commit(); assert.equal(focused, 2, 'an unfocused synthetic click does not request focus');
  } finally { h.cleanup(); }
});

test('keyboard deselection of a pinned distant system in a collapsed list restores focus to All systems', () => {
  const catalog = fixture();
  catalog.trackingSystems = Array.from({ length: 28 }, (_, index) => ({ id: 'system-' + index, name: 'System ' + String(index).padStart(2, '0'), categories: ['fraud-prevention'] }));
  const h = harness({}, { catalog }); try {
    h.input('data-autosurf-sites-system-search', 'System 27'); h.click('data-autosurf-sites-system', 'system-27');
    h.input('data-autosurf-sites-system-search', '');
    const pinned = h.attr('data-autosurf-sites-system', 'system-27'); assert.equal(pinned.props['aria-pressed'], true);
    const document = globalThis.document, source = {}, body = {}, allButton = {}; let focused = 0;
    document.body = body; document.activeElement = source;
    pinned.props.onClick({ currentTarget: source, detail: 0 }); h.settle();
    assert.equal(h.attr('data-autosurf-sites-system', 'system-27'), undefined, 'deselected distant system leaves the collapsed twelve');
    document.activeElement = body;
    h.nodes(node => node.props.id === 'autosurf-sites-system-options')[0].props.ref({ querySelector(selector) {
      if (selector === '[data-autosurf-sites-system="system-27"]') return null;
      assert.equal(selector, '[data-autosurf-sites-system="all"]');
      return { focus() { focused++; document.activeElement = allButton; } };
    } });
    assert.equal(focused, 1); assert.equal(document.activeElement, allButton);
    assert.equal(h.attr('data-autosurf-sites-system', 'all').props['aria-pressed'], true);
  } finally { h.cleanup(); }
});

test('readonly mode permits filter removal and Clear all but never mutates the plan', () => {
  const draft = 'https://manual.example/';
  const h = harness({ currentUrls: draft }, { catalog: trackingFixture() }); try {
    h.select('site4.example'); h.click('data-autosurf-sites-system', 'forter'); h.update({ disabled: true });
    h.click('data-autosurf-sites-system', 'datadome'); assert.ok(h.attr('data-autosurf-sites-selected-systems', 2));
    h.click('data-autosurf-sites-remove-filter', 'system:forter');
    h.click('data-autosurf-sites-clear-all-filters');
    assert.ok(h.attr('data-autosurf-sites-selected', 1)); h.click('data-autosurf-sites-add');
    assert.equal(h.props.currentUrls, draft); assert.equal(h.additions.length, 0);
  } finally { h.cleanup(); }
});

test('site badges show the matching category and chosen system first without changing catalogue associations', () => {
  const catalog = trackingFixture(), original = ['forter', 'datadome', 'hcaptcha'];
  catalog.sites[0].trackingSystems = [...original];
  const h = harness({}, { catalog }); try {
    const visible = () => h.nodes(node => node.props.class === 'autosurf-sites-result__system', h.attr('data-autosurf-site', 'site0.example')).map(node => node.props.title);
    const hidden = () => h.nodes(node => node.type === 'small' && node.props.children === '+1', h.attr('data-autosurf-site', 'site0.example'))[0].props.title;
    assert.deepEqual(visible(), ['Forter', 'DataDome']); assert.equal(hidden(), 'hCaptcha');
    h.click('data-autosurf-sites-system-category', 'captcha');
    assert.deepEqual(visible(), ['hCaptcha', 'Forter']); assert.equal(hidden(), 'DataDome');
    h.click('data-autosurf-sites-system-category', 'fraud-prevention');
    assert.deepEqual(visible(), ['Forter', 'DataDome']);
    h.click('data-autosurf-sites-system', 'datadome');
    assert.deepEqual(visible(), ['DataDome', 'Forter']); assert.equal(hidden(), 'hCaptcha');
    h.click('data-autosurf-sites-system-category', 'all');
    assert.deepEqual(visible(), ['DataDome', 'Forter']); assert.equal(hidden(), 'hCaptcha');
    assert.deepEqual(catalog.sites[0].trackingSystems, original);
  } finally { h.cleanup(); }
});

test('category scope keeps name search, collapses the system list and resets site pagination', () => {
  const catalog = fixture();
  catalog.trackingSystems = Array.from({ length: 28 }, (_, index) => ({ id: 'system-' + index, name: 'System ' + String(index).padStart(2, '0'), categories: index < 20 ? ['fraud-prevention'] : ['bot-management'] }));
  for (const site of catalog.sites) site.trackingSystems = ['system-19'];
  const h = harness({}, { catalog }); try {
    h.click('data-autosurf-sites-next'); assert.match(h.text(), /Page 2 \/ 3/);
    h.click('data-autosurf-sites-systems-toggle');
    h.click('data-autosurf-sites-system-category', 'fraud-prevention');
    assert.match(h.text(), /Page 1 \/ 3/); assert.equal(h.attr('data-autosurf-sites-systems-toggle').props['aria-expanded'], false);
    assert.equal(h.nodes(node => Object.hasOwn(node.props, 'data-autosurf-sites-system')).length, 13);
    h.input('data-autosurf-sites-system-search', 'System 2');
    assert.equal(h.attr('data-autosurf-sites-system-count', 0).props.children, '0'); assert.match(h.text(), /No systems found/);
    h.click('data-autosurf-sites-system-category', 'bot-management');
    assert.equal(h.attr('data-autosurf-sites-system-search').props.value, 'System 2');
    assert.equal(h.attr('data-autosurf-sites-system-count', 8).props.children, '8');
    assert.equal(h.nodes(node => Object.hasOwn(node.props, 'data-autosurf-sites-system')).length, 9);
    assert.equal(h.attr('data-autosurf-sites-systems-toggle'), undefined);
    assert.equal(h.nodes(node => Object.hasOwn(node.props, 'data-autosurf-sites-system-category')).length, 7, 'category choices remain outside the collapsed system list');
  } finally { h.cleanup(); }
});

test('large tracking lists collapse to twelve, search every system and retain the chosen system visibly', () => {
  const catalog = fixture();
  catalog.trackingSystems = Array.from({ length: 28 }, (_, index) => ({ id: 'system-' + index, name: 'System ' + String(index).padStart(2, '0'), categories: ['fraud-prevention'], sourceUrl: 'https://source.example/system-' + index }));
  catalog.sites[0].trackingSystems = ['system-27'];
  const h = harness({}, { catalog }); try {
    assert.equal(h.nodes(node => Object.hasOwn(node.props, 'data-autosurf-sites-system')).length, 13);
    assert.equal(h.nodes(node => Object.hasOwn(node.props, 'data-autosurf-sites-system'))[1].props['data-autosurf-sites-system'], 'system-27', 'systems with matching sites precede empty filters');
    h.click('data-autosurf-sites-systems-toggle'); assert.equal(h.nodes(node => Object.hasOwn(node.props, 'data-autosurf-sites-system')).length, 29);
    assert.equal(h.attr('data-autosurf-sites-systems-toggle').props['aria-expanded'], true);
    h.input('data-autosurf-sites-system-search', 'System 27'); assert.equal(h.nodes(node => Object.hasOwn(node.props, 'data-autosurf-sites-system')).length, 2);
    h.click('data-autosurf-sites-system', 'system-27'); assert.ok(h.attr('data-autosurf-site', 'site0.example'));
    h.input('data-autosurf-sites-system-search', ''); h.click('data-autosurf-sites-systems-toggle');
    assert.ok(h.attr('data-autosurf-sites-system', 'system-27')); assert.equal(h.attr('data-autosurf-sites-system', 'system-27').props['aria-pressed'], true);
    h.input('data-autosurf-sites-system-search', 'absent'); assert.match(h.text(), /No systems found/); assert.ok(h.attr('data-autosurf-site', 'site0.example'), 'searching system names leaves the chosen site filter active');
  } finally { h.cleanup(); }
});

test('tracking-only rows show a neutral category and no invented country flag', () => {
  const catalog = fixture(); catalog.trackingSystems = [{ id: 'owned-system', name: 'Owned system', categories: ['fraud-prevention'], sourceUrl: 'https://source.example/system' }];
  catalog.sites = [{ id: 'unknown.example', name: 'Unknown', origin: 'https://unknown.example', categories: [], countries: [], rankBuckets: {}, trackingSystems: ['owned-system'] }];
  const h = harness({}, { catalog }); try {
    assert.match(h.text(), /Other sites/); assert.doesNotMatch(h.text(), /category_undefined/);
    assert.equal(h.nodes(node => Object.hasOwn(node.props, 'data-site-country-flag')).length, 0);
    const marks = h.nodes(node => node.props['data-system-fallback'] === true);
    assert.equal(marks.length, 2); assert.ok(marks.every(node => node.type === 'svg' && node.props['aria-hidden'] === true));
    assert.equal(h.nodes(node => node.props.class === 'autosurf-sites-system__monogram').length, 0);
    h.select('unknown.example'); h.click('data-autosurf-sites-add'); assert.deepEqual(h.additions, [['https://unknown.example']]);
  } finally { h.cleanup(); }
});

test('localized country combobox supports search, keyboard selection, Escape and explicit no matches', () => {
  const h = harness({ locale: 'ru' }); try {
    assert.equal(autosurfSiteCountryName('ME', 'ru'), 'Черногория'); h.click('data-autosurf-sites-country', 'all');
    h.input('data-autosurf-sites-country-search', 'Черногория'); assert.ok(h.attr('data-autosurf-sites-country-option', 'ME'));
    let prevented = false; h.attr('data-autosurf-sites-country-search').props.onKeyDown({ key: 'Enter', preventDefault() { prevented = true; } }); h.settle();
    assert.equal(prevented, true); assert.equal(h.attr('data-autosurf-sites-country', 'ME').props['aria-expanded'], false);
    for (const node of h.nodes(node => Object.hasOwn(node.props, 'data-autosurf-site'))) assert.equal(Number(node.props['data-autosurf-site'].match(/site(\d+)/)[1]) % 2, 0);
    h.click('data-autosurf-sites-country', 'ME'); h.input('data-autosurf-sites-country-search', 'zz-not-country'); assert.match(h.text(), /Страны не найдены/);
    h.attr('data-autosurf-sites-country-search').props.onKeyDown({ key: 'Escape', preventDefault() {} }); h.settle(); assert.equal(h.attr('data-autosurf-sites-country', 'ME').props['aria-expanded'], false);
  } finally { h.cleanup(); }
});

test('a multi-topic card reflects the chosen topic and puts the selected audience country flag first', () => {
  const catalog = fixture(); catalog.sites[0].categories = ['news', 'sports'];
  const h = harness({}, { catalog }); try {
    h.click('data-autosurf-sites-category', 'sports');
    const first = h.attr('data-autosurf-site', 'site0.example'); assert.equal(first.props.style['--site-color'], AUTOSURF_SITE_THEMES.sports[0]);
    assert.equal(h.nodes(node => node.props.class === 'autosurf-sites-result__category', first)[0].props.children, 'Sports');
    h.click('data-autosurf-sites-country', 'all'); h.click('data-autosurf-sites-country-option', 'ME');
    const card = h.attr('data-autosurf-site', 'site0.example'); assert.equal(h.nodes(node => Object.hasOwn(node.props, 'data-site-country-flag'), card)[0].props['data-site-country-flag'], 'ME');
    h.click('data-autosurf-sites-select-page'); assert.equal(h.attr('data-autosurf-sites-select-page').props['aria-pressed'], true);
    h.click('data-autosurf-sites-select-page'); assert.equal(h.attr('data-autosurf-sites-select-page').props['aria-pressed'], false);
  } finally { h.cleanup(); }
});

test('an exact country code wins over substring name matches before keyboard Enter', () => {
  const catalog = fixture(); catalog.countries.unshift('AT');
  const h = harness({}, { catalog }); try {
    h.click('data-autosurf-sites-country', 'all'); h.input('data-autosurf-sites-country-search', 'us');
    const options = h.nodes(node => node.props.role === 'option');
    assert.equal(options[0].props['data-autosurf-sites-country-option'], 'US');
    assert.ok(options.some(option => option.props['data-autosurf-sites-country-option'] === 'AT'), 'Austria remains a valid substring result');
    h.attr('data-autosurf-sites-country-search').props.onKeyDown({ key: 'Enter', preventDefault() {} }); h.settle();
    assert.equal(h.attr('data-autosurf-sites-country', 'US').props['aria-expanded'], false);
  } finally { h.cleanup(); }
});

test('IME composition Enter does not select a country until composition has finished', () => {
  const h = harness(); try {
    h.click('data-autosurf-sites-country', 'all'); h.input('data-autosurf-sites-country-search', 'Montenegro');
    let prevented = false;
    h.attr('data-autosurf-sites-country-search').props.onKeyDown({ key: 'Enter', isComposing: true, preventDefault() { prevented = true; } }); h.settle();
    assert.equal(prevented, false); assert.equal(h.attr('data-autosurf-sites-country', 'all').props['aria-expanded'], true);
    h.attr('data-autosurf-sites-country-search').props.onKeyDown({ key: 'Enter', keyCode: 229, preventDefault() { prevented = true; } }); h.settle();
    assert.equal(prevented, false); assert.equal(h.attr('data-autosurf-sites-country', 'all').props['aria-expanded'], true);
    h.attr('data-autosurf-sites-country-search').props.onKeyDown({ key: 'Enter', preventDefault() {} }); h.settle();
    assert.equal(h.attr('data-autosurf-sites-country', 'ME').props['aria-expanded'], false);
  } finally { h.cleanup(); }
});

test('selection appends only on explicit parent handoff and canonical slash duplicates are already in plan', () => {
  const h = harness({ currentUrls: 'https://manual.example/path?keep=1\nhttps://site0.example/' }); try {
    const planned = h.attr('data-autosurf-site-select', 'site0.example'); assert.equal(planned.props.checked, true); assert.equal(planned.props.disabled, true);
    h.select('site1.example'); h.select('site2.example'); assert.equal(h.additions.length, 0); assert.ok(h.attr('data-autosurf-sites-selected', 2));
    h.click('data-autosurf-sites-add'); assert.deepEqual(h.additions, [['https://site1.example', 'https://site2.example']]);
    assert.match(h.props.currentUrls, /^https:\/\/manual\.example\/path\?keep=1\nhttps:\/\/site0\.example\//); assert.match(h.props.currentUrls, /https:\/\/site2\.example\//);
    assert.ok(h.attr('data-autosurf-sites-selected', 0)); assert.match(h.text(), /Added : 2/); assert.equal(h.attr('data-autosurf-site-select', 'site1.example').props.disabled, true);
  } finally { h.cleanup(); }
});

test('selections survive filters, page selection is bounded by remaining capacity, and a full plan never appends', () => {
  const existing = Array.from({ length: 198 }, (_, index) => 'https://existing' + index + '.example/').join('\n');
  const h = harness({ currentUrls: existing }); try {
    h.click('data-autosurf-sites-select-page'); assert.ok(h.attr('data-autosurf-sites-selected', 2));
    h.click('data-autosurf-sites-category', 'news'); assert.ok(h.attr('data-autosurf-sites-selected', 2));
    h.click('data-autosurf-sites-add'); assert.equal(h.props.currentUrls.split(/\r?\n/).filter(Boolean).length, 200);
    assert.equal(h.attr('data-autosurf-sites-select-page').props.disabled, true); assert.equal(h.additions.length, 1);
  } finally { h.cleanup(); }
});

test('readonly and invalid plan states never call onAdd; atomic parent errors preserve selection for retry', () => {
  const readonly = harness({ disabled: true }); try { readonly.select('site0.example'); readonly.click('data-autosurf-sites-select-page'); readonly.click('data-autosurf-sites-add'); assert.equal(readonly.additions.length, 0); assert.ok(readonly.attr('data-autosurf-sites-selected', 0)); } finally { readonly.cleanup(); }
  const invalid = harness({ currentUrls: 'javascript:invalid' }); try { invalid.select('site0.example'); assert.equal(invalid.attr('data-autosurf-sites-add').props.disabled, true); assert.match(invalid.text(), /Fix the addresses/); assert.equal(invalid.additions.length, 0); } finally { invalid.cleanup(); }
  let result = { error: 'inactive' }; const h = harness({ onAdd: () => result }); try {
    h.select('site0.example'); h.click('data-autosurf-sites-add'); assert.ok(h.attr('data-autosurf-sites-selected', 1)); assert.equal(h.attr('data-autosurf-sites-feedback').props.role, 'alert');
    result = { error: null, added: 1, duplicates: 0 }; h.click('data-autosurf-sites-add'); assert.ok(h.attr('data-autosurf-sites-selected', 0)); assert.match(h.text(), /Added : 1/);
  } finally { h.cleanup(); }
});

test('a site added to the draft elsewhere keeps the selection without consuming a second capacity slot', () => {
  const existing = Array.from({ length: 198 }, (_, index) => 'https://existing' + index + '.example/').join('\n');
  const h = harness({ currentUrls: existing }); try {
    h.select('site0.example'); h.update({ currentUrls: existing + '\nhttps://site0.example/' });
    h.select('site1.example'); assert.ok(h.attr('data-autosurf-sites-selected', 2));
    h.click('data-autosurf-sites-add'); assert.equal(h.props.currentUrls.split(/\r?\n/).filter(Boolean).length, 200);
    assert.match(h.text(), /Added\s*:\s*1/); assert.match(h.text(), /Already in plan\s*:\s*1/);
  } finally { h.cleanup(); }
});

test('catalogue source without a public URL stays readable and never creates an empty or invented link', () => {
  const catalog = fixture();
  catalog.sources = [{ id: 'site-catalogue', title: 'Site catalogue', license: 'Proprietary', asOf: '2026-10-30' }];
  catalog.trackingSourceId = 'site-catalogue'; catalog.trackingSnapshotAt = '2026-10-30';
  catalog.trackingSystems = [{ id: 'owned-system', name: 'Owned system', categories: ['fraud-prevention'] }];
  catalog.sites[0].trackingSystems = ['owned-system'];
  const h = harness({}, { catalog }); try {
    assert.match(h.text(), /Site catalogue/); assert.match(h.text(), /2026-10-30/);
    assert.equal(h.nodes(node => node.type === 'span' && node.props.children === 'Site catalogue').length, 1);
    assert.equal(h.nodes(node => node.type === 'a' && node.props.children === 'Site catalogue').length, 0);
    assert.equal(h.nodes(node => node.type === 'a').length, 0);
    assert.equal(h.nodes(node => node.type === 'span' && node.props.children === 'Proprietary').length, 1);
    h.click('data-autosurf-sites-system', 'owned-system');
    assert.equal(h.nodes(node => Object.hasOwn(node.props, 'data-autosurf-site')).length, 1);
    h.select('site0.example'); h.click('data-autosurf-sites-add');
    assert.deepEqual(h.additions, [['https://site0.example']]);
  } finally { h.cleanup(); }
});

test('neutral dated source labels use the existing locale without exposing an unrelated license link', () => {
  const catalog = fixture();
  catalog.sources.push({ id: 'site-catalogue-20261030', title: 'Site catalogue', license: 'Proprietary', asOf: '2026-10-30' });
  const h = harness({ locale: 'ru' }, { catalog }); try {
    assert.equal(h.nodes(node => node.type === 'span' && node.props.children === 'Каталог').length, 1);
    assert.equal(h.nodes(node => node.props.children === 'Site catalogue').length, 0);
    assert.equal(h.nodes(node => node.type === 'a' && node.props.children === 'Proprietary').length, 0);
    assert.equal(h.nodes(node => node.type === 'a' && node.props.children === 'CC0-1.0' && node.props.href === 'autosurf-sites-LICENSE.txt').length, 1);
  } finally { h.cleanup(); }
});

test('all production languages resolve labels and localized country names; source attribution is explicit', () => {
  for (const language of PRODUCTION_LANGUAGES) {
    const h = harness({ locale: language.id }, { catalog: trackingFixture() }); try {
      assert.doesNotMatch(h.text(), /autosurf_sites_/); assert.match(h.text(), /Owned metadata fixture/); assert.match(h.text(), /CC0-1.0/);
      h.click('data-autosurf-sites-country', 'all'); assert.ok(h.attr('data-autosurf-sites-country-option', 'ME')); assert.equal(typeof autosurfSiteCountryName('ME', language.id), 'string');
    } finally { h.cleanup(); }
  }
});

test('idle parent rerenders reuse expensive localized country names and preserve the selection', () => {
  const Original = Intl.DisplayNames; let builds = 0;
  Intl.DisplayNames = class extends Original { constructor(...args) { super(...args); builds++; } };
  let h; try {
    h = harness(); const before = builds; h.select('site0.example');
    for (let count = 0; count < 20; count++) h.update({ disabled: count % 2 === 0 });
    assert.equal(builds, before); assert.ok(h.attr('data-autosurf-sites-selected', 1)); h.update({ locale: 'ru' }); assert.equal(builds, before + 2);
  } finally { h?.cleanup(); Intl.DisplayNames = Original; }
});
