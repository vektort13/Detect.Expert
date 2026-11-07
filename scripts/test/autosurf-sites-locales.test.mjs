import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTOSURF_SITES_UI_KEYS, AUTOSURF_SITES_UI_MESSAGES, applyAutosurfSitesCopy } from '../production-locales-autosurf-sites.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';
import { SITE_CATEGORY_IDS, SITE_TRACKING_CATEGORY_IDS } from '../../apps/production-extension/autosurf-sites.js';

test('all production languages have complete site-picker copy with Chrome-compatible message identifiers', () => {
  for (const language of PRODUCTION_LANGUAGES) {
    const copy = AUTOSURF_SITES_UI_MESSAGES[language.id];
    assert.deepEqual(Object.keys(copy).sort(), [...AUTOSURF_SITES_UI_KEYS].sort(), language.id);
    for (const [key, value] of Object.entries(copy)) {
      assert.match(key, /^[A-Za-z0-9_@]+$/, key);
      assert.ok(typeof value === 'string' && value.trim().length > 0, language.id + '/' + key);
    }
    for (const category of SITE_CATEGORY_IDS) assert.ok(copy['autosurf_sites_category_' + category.replaceAll('-', '_')]);
    for (const category of SITE_TRACKING_CATEGORY_IDS) assert.ok(copy['autosurf_sites_system_category_' + category.replaceAll('-', '_')]);
    if (language.id !== 'en') assert.notEqual(copy.autosurf_sites_subtitle, AUTOSURF_SITES_UI_MESSAGES.en.autosurf_sites_subtitle);
    if (language.id !== 'en') {
      assert.notEqual(copy.autosurf_sites_system_categories, AUTOSURF_SITES_UI_MESSAGES.en.autosurf_sites_system_categories, language.id);
      assert.notEqual(copy.autosurf_sites_system_category_fraud_prevention, AUTOSURF_SITES_UI_MESSAGES.en.autosurf_sites_system_category_fraud_prevention, language.id);
      for (const key of ['active_filters', 'clear_all_filters', 'remove_filter', 'any_selected_system', 'selected_systems']) assert.notEqual(copy['autosurf_sites_' + key], AUTOSURF_SITES_UI_MESSAGES.en['autosurf_sites_' + key], language.id + '/' + key);
    }
  }
});

test('site-picker localization preserves existing messages and rejects unknown locales', () => {
  const table = { existing_feature: { message: 'keep' } };
  assert.equal(applyAutosurfSitesCopy(table, 'ru'), undefined);
  assert.equal(table.existing_feature.message, 'keep');
  assert.equal(table.autosurf_sites_category_real_estate.message, 'Недвижимость');
  assert.equal(table.autosurf_sites_system_categories.message, 'Категории систем');
  assert.equal(table.autosurf_sites_system_category_device_fingerprinting.message, 'Отпечатки устройств');
  assert.equal(table.autosurf_sites_active_filters.message, 'Активные фильтры');
  assert.equal(table.autosurf_sites_any_selected_system.message, 'Сайты с любой выбранной системой');
  assert.throws(() => applyAutosurfSitesCopy({}, 'unknown'));
});
