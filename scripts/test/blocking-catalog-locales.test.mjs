// ADR-046: catalog labels and filter-chip copy for all 21 production languages, generated catalogs and embedded tables.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';
import { applyCatalogBlockingCopy, CATALOG_BLOCKING_KEYS } from '../production-locales-blocking-catalog.mjs';
import { applyBlockingFilterCopy, BLOCKING_FILTER_KEYS, ENGLISH_EQUAL_ALLOWED } from '../production-locales-blocking-filters.mjs';
import { PROTECTION_FEATURES, PROTECTION_FEATURES_V1 } from '../../packages/contracts/src/protection-features.mjs';
import { API_NAMES, PROTECTION_FILTERS, PROTECTION_GROUPS } from '../../apps/production-extension/protection-ui.js';
import { WASM_SURFACES } from '../../packages/contracts/src/webassembly-apis.mjs';
import { WEBASSEMBLY_UI_KEYS, WEBASSEMBLY_UI_MESSAGES } from '../production-locales-webassembly.mjs';

// No catalog label may fall back to English text; extend only with a written reason per entry.
const CATALOG_ENGLISH_EQUAL_ALLOWED = Object.freeze({});
const CHIP_KEYS = PROTECTION_FILTERS.map(id => 'protection_filter_' + id);
const SHOWN = 'protection_filter_shown';
const directory = resolve('apps/production-extension');
const english = { catalog: applyCatalogBlockingCopy({}, 'en'), filters: applyBlockingFilterCopy({}, 'en') };
const length = text => Array.from(text).length;
const occurrences = (text, token) => text.split(token).length - 1;

test('catalog overlay covers the 57 additive contract IDs and the five new groups in contract order', () => {
  assert.equal(new Set(CATALOG_BLOCKING_KEYS).size, CATALOG_BLOCKING_KEYS.length);
  assert.deepEqual(CATALOG_BLOCKING_KEYS.slice(0, 57), PROTECTION_FEATURES_V1.slice(32).map(id => 'protection_feature_' + id.replaceAll('-', '_')));
  assert.deepEqual(CATALOG_BLOCKING_KEYS.slice(57), ['system', 'ai', 'storage', 'network', 'identity'].map(id => 'protection_group_' + id));
  assert.deepEqual(CHIP_KEYS, BLOCKING_FILTER_KEYS.slice(1, 7), 'chip keys follow PROTECTION_FILTERS order');
  assert.equal(BLOCKING_FILTER_KEYS.includes('protection_partial'), false, 'legacy 1.0.0 key stays untouched');
  assert.equal(CATALOG_BLOCKING_KEYS.includes('protection_partial'), false);
});

for (const language of PRODUCTION_LANGUAGES) test('blocking catalog and filter copy: ' + language.id, () => {
  const catalog = applyCatalogBlockingCopy({}, language.id), filters = applyBlockingFilterCopy({}, language.id);
  assert.deepEqual(Object.keys(catalog), CATALOG_BLOCKING_KEYS);
  assert.deepEqual(Object.keys(filters), BLOCKING_FILTER_KEYS);
  for (const [key, entry] of [...Object.entries(catalog), ...Object.entries(filters)]) {
    assert.equal(typeof entry.message, 'string', language.id + '/' + key);
    assert.ok(entry.message.trim() && entry.message === entry.message.trim(), language.id + '/' + key + ': empty or padded');
    assert.doesNotMatch(entry.message, /�|TODO|\$\{|\||undefined/, language.id + '/' + key);
  }
  for (const key of CATALOG_BLOCKING_KEYS) {
    assert.deepEqual(Object.keys(catalog[key]), ['message'], language.id + '/' + key + ': no placeholders');
    assert.equal(catalog[key].message.includes('$'), false, language.id + '/' + key);
    assert.ok(length(catalog[key].message) <= 48, language.id + '/' + key + ': ' + length(catalog[key].message) + ' code points');
    if (language.id !== 'en' && catalog[key].message === english.catalog[key].message) {
      assert.ok((CATALOG_ENGLISH_EQUAL_ALLOWED[language.id] ?? []).includes(key), 'English fallback: ' + language.id + '/' + key);
    }
  }
  for (const key of [...CHIP_KEYS, 'protection_rule_partial']) assert.ok(length(filters[key].message) <= 24, language.id + '/' + key + ': ' + length(filters[key].message) + ' code points');
  for (const key of BLOCKING_FILTER_KEYS) {
    if (key === SHOWN) {
      assert.deepEqual(filters[key].placeholders, { shown: { content: '$1' }, total: { content: '$2' } }, language.id);
      assert.equal(occurrences(filters[key].message, '$SHOWN$'), 1, language.id + ': $SHOWN$');
      assert.equal(occurrences(filters[key].message, '$TOTAL$'), 1, language.id + ': $TOTAL$');
      assert.equal(occurrences(filters[key].message, '$'), 4, language.id + ': stray $');
    } else {
      assert.deepEqual(Object.keys(filters[key]), ['message'], language.id + '/' + key + ': no placeholders');
      assert.equal(filters[key].message.includes('$'), false, language.id + '/' + key);
    }
    if (language.id !== 'en' && filters[key].message === english.filters[key].message) {
      assert.ok((ENGLISH_EQUAL_ALLOWED[language.id] ?? []).includes(key), 'English fallback: ' + language.id + '/' + key);
    }
  }
  for (const key of ENGLISH_EQUAL_ALLOWED[language.id] ?? []) assert.equal(filters[key].message, english.filters[key].message, 'stale allowlist entry: ' + language.id + '/' + key);
  // Overlays are repeatable and leave unrelated keys alone.
  const preserved = { message: 'Unrelated', placeholders: { count: { content: '$1' } } };
  const table = { cookie_allow_access: preserved, protection_partial: { message: 'Legacy handler text' } };
  applyCatalogBlockingCopy(table, language.id); applyBlockingFilterCopy(table, language.id);
  const first = JSON.stringify(table);
  assert.equal(applyCatalogBlockingCopy(table, language.id), table);
  assert.equal(applyBlockingFilterCopy(table, language.id), table);
  assert.equal(JSON.stringify(table), first, 'overlay must be repeatable');
  assert.equal(table.cookie_allow_access, preserved);
  assert.deepEqual(table.protection_partial, { message: 'Legacy handler text' });
});

test('ADR-103: en keeps the Latin chip labels; ru and the other languages are localized', () => {
  const owner = ['All', 'Hardware', 'OS', 'Network', 'Browser', 'Social'];
  assert.deepEqual(CHIP_KEYS.map(key => applyBlockingFilterCopy({}, 'en')[key].message), owner, 'en');
  assert.deepEqual(CHIP_KEYS.map(key => applyBlockingFilterCopy({}, 'ru')[key].message), ['Все', 'Устройство', 'ОС', 'Сеть', 'Браузер', 'Соцсети'], 'ru');
  assert.deepEqual(ENGLISH_EQUAL_ALLOWED.ru, []);
  const ru = applyBlockingFilterCopy({}, 'ru');
  for (const key of BLOCKING_FILTER_KEYS) assert.match(ru[key].message, /[Ѐ-ӿ]/u, 'ru/' + key);
});

test('overlays refuse unknown locales and non-table targets without modifying the table', () => {
  for (const apply of [applyCatalogBlockingCopy, applyBlockingFilterCopy]) {
    for (const locale of ['unsupported', '__proto__', 'constructor', 'toString', '', undefined, null, 1]) {
      const table = { protection_feature_webxr: { message: 'Existing text' } };
      assert.throws(() => apply(table, locale), /unknown locale/);
      assert.deepEqual(table, { protection_feature_webxr: { message: 'Existing text' } });
    }
    assert.throws(() => apply([], 'en'), /message table/);
    assert.throws(() => apply(null, 'en'), /message table/);
  }
});

function embeddedTables(name) {
  const source = readFileSync(resolve(directory, name), 'utf8');
  const start = source.indexOf('// apps/production-extension/locales — generated by scripts/production-locales.mjs');
  const i18n = source.indexOf('// packages/ui/src/i18n.ts', start);
  const end = source.indexOf('\n// ', i18n + 1);
  assert.ok(start >= 0 && i18n > start && end > i18n, name + ': generated locale boundary');
  const context = vm.createContext({
    Intl, Set, document: { documentElement: {} }, setTimeout, clearTimeout,
    chrome: {
      i18n: { getUILanguage: () => 'en', getMessage: () => '' },
      storage: { onChanged: { addListener() {} }, local: { async get() { return {}; }, async set() {} } }
    }
  });
  vm.runInContext(source.slice(start, end), context);
  return JSON.parse(JSON.stringify(vm.runInContext('TABLES', context)));
}

test('generated catalogs and embedded UI tables carry every rule, group and filter message', () => {
  const required = [
    ...PROTECTION_FEATURES.filter(id => !id.startsWith('webassembly-')).map(id => 'protection_feature_' + id.replaceAll('-', '_')),
    ...PROTECTION_GROUPS.map(group => 'protection_group_' + group.id),
    ...BLOCKING_FILTER_KEYS, ...WEBASSEMBLY_UI_KEYS
  ];
  const files = {};
  for (const language of PRODUCTION_LANGUAGES) {
    const file = resolve(directory, language.uiOnly ? 'ui-locales' : '_locales', language.id, 'messages.json');
    const table = JSON.parse(readFileSync(file, 'utf8'));
    files[language.id] = table;
    for (const key of required) assert.ok(table[key] && typeof table[key].message === 'string' && table[key].message.trim(), language.id + ': missing ' + key);
    const catalog = applyCatalogBlockingCopy({}, language.id), filters = applyBlockingFilterCopy({}, language.id);
    for (const key of CATALOG_BLOCKING_KEYS) assert.deepEqual(table[key], catalog[key], language.id + '/' + key);
    for (const key of BLOCKING_FILTER_KEYS) assert.deepEqual(table[key], filters[key], language.id + '/' + key);
    for (const key of WEBASSEMBLY_UI_KEYS) assert.equal(table[key].message, WEBASSEMBLY_UI_MESSAGES[language.id][key], language.id + '/' + key);
  }
  for (const name of ['popup.js', 'sidepanel.js', 'options.js', 'report.js']) {
    const tables = embeddedTables(name);
    for (const language of PRODUCTION_LANGUAGES) {
      for (const key of required) assert.deepEqual(tables[language.id]?.[key], files[language.id][key], name + ':' + language.id + '/' + key);
    }
  }
});

test('37 WebAssembly child labels retain canonical technical operation names instead of untranslated catalog keys', () => {
  assert.equal(WASM_SURFACES.length, 37);
  for (const row of WASM_SURFACES) assert.equal(API_NAMES[row.feature], row.operation);
});
