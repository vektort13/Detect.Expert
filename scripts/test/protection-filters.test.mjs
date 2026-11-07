// ADR-046: the category chips are a pure, view-only filter over the existing groups.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PROTECTION_FEATURES } from '../../packages/contracts/src/protection-features.mjs';
import { PROTECTION_FEATURE_FILTER, PROTECTION_FILTERS, PROTECTION_GROUPS, PROTECTION_PARTIAL, protectionFilterView, rovingIndex } from '../../apps/production-extension/protection-ui.js';

const TAGS = ['hardware', 'os', 'network', 'browser', 'social'];
const EXPECTED = { hardware: 32, os: 17, network: 11, browser: 60, social: 6 };
const everything = () => true;
const isSubsequence = (part, whole) => { let index = 0; for (const value of whole) if (value === part[index]) index++; return index === part.length; };
const deepFreeze = value => { if (value && typeof value === 'object') { for (const key of Reflect.ownKeys(value)) deepFreeze(value[key]); Object.freeze(value); } return value; };

test('six filters in the owner order and exactly one tag per contract feature', () => {
  assert.deepEqual([...PROTECTION_FILTERS], ['all', 'hardware', 'os', 'network', 'browser', 'social']);
  assert.equal(Object.keys(PROTECTION_FEATURE_FILTER).length, PROTECTION_FEATURES.length);
  assert.deepEqual(new Set(Object.keys(PROTECTION_FEATURE_FILTER)), new Set(PROTECTION_FEATURES));
  for (const feature of PROTECTION_FEATURES) assert.ok(TAGS.includes(PROTECTION_FEATURE_FILTER[feature]), feature + ': ' + PROTECTION_FEATURE_FILTER[feature]);
  const counts = Object.fromEntries(TAGS.map(tag => [tag, Object.values(PROTECTION_FEATURE_FILTER).filter(value => value === tag).length]));
  assert.deepEqual(counts, EXPECTED);
  for (const tag of TAGS) assert.ok(counts[tag] >= 1, tag);
  for (const feature of PROTECTION_GROUPS.find(group => group.id === 'hardware').features) assert.equal(PROTECTION_FEATURE_FILTER[feature], 'hardware', feature);
  for (const feature of PROTECTION_GROUPS.find(group => group.id === 'network').features) assert.equal(PROTECTION_FEATURE_FILTER[feature], 'network', feature);
});

test('partial-coverage badge list is a duplicate-free subset of the contract and all view data is frozen', () => {
  assert.deepEqual([...PROTECTION_PARTIAL], ['device-motion', 'send-beacon', 'fetch-later', 'cookie-store', 'document-cookie', 'clipboard-write', 'storage-access', 'private-state-tokens']);
  assert.equal(new Set(PROTECTION_PARTIAL).size, PROTECTION_PARTIAL.length);
  for (const feature of PROTECTION_PARTIAL) assert.ok(PROTECTION_FEATURES.includes(feature), feature);
  for (const value of [PROTECTION_FILTERS, PROTECTION_FEATURE_FILTER, PROTECTION_PARTIAL]) assert.equal(Object.isFrozen(value), true);
});

test('All keeps every group and row in canonical order with faceted counts', () => {
  const view = protectionFilterView(PROTECTION_GROUPS, PROTECTION_FEATURE_FILTER, everything, 'all');
  assert.equal(view.category, 'all');
  assert.deepEqual(view.groups.map(group => group.id), PROTECTION_GROUPS.map(group => group.id));
  view.groups.forEach((group, index) => {
    assert.deepEqual(group.features, PROTECTION_GROUPS[index].features);
    assert.equal(group.icon, PROTECTION_GROUPS[index].icon);
  });
  assert.deepEqual(view.counts, { all: PROTECTION_FEATURES.length, ...EXPECTED });
  assert.equal(view.shown, PROTECTION_FEATURES.length);
});

test('each category shows only its own rows inside the existing groups and drops empty groups', () => {
  const canonical = PROTECTION_GROUPS.flatMap(group => group.features);
  for (const tag of TAGS) {
    const view = protectionFilterView(PROTECTION_GROUPS, PROTECTION_FEATURE_FILTER, everything, tag);
    assert.equal(view.category, tag);
    assert.ok(view.groups.length >= 1, tag);
    assert.ok(isSubsequence(view.groups.map(group => group.id), PROTECTION_GROUPS.map(group => group.id)), tag + ': group order');
    for (const group of view.groups) {
      assert.ok(group.features.length > 0, tag + '/' + group.id + ' is not empty');
      assert.ok(isSubsequence(group.features, PROTECTION_GROUPS.find(entry => entry.id === group.id).features), tag + '/' + group.id + ': row order');
      for (const feature of group.features) assert.equal(PROTECTION_FEATURE_FILTER[feature], tag, feature);
    }
    const rows = view.groups.flatMap(group => group.features);
    assert.deepEqual(rows, canonical.filter(feature => PROTECTION_FEATURE_FILTER[feature] === tag));
    assert.equal(view.shown, rows.length);
    assert.equal(view.shown, EXPECTED[tag]);
    assert.deepEqual(view.counts, { all: PROTECTION_FEATURES.length, ...EXPECTED }, 'counts do not depend on the selected chip');
  }
});

test('the category is combined with search/configured matches by AND and counts stay faceted', () => {
  const matches = feature => feature.startsWith('web') || feature === 'push' || feature === 'storage-access';
  const matched = PROTECTION_FEATURES.filter(matches);
  const all = protectionFilterView(PROTECTION_GROUPS, PROTECTION_FEATURE_FILTER, matches, 'all');
  assert.equal(all.counts.all, matched.length);
  assert.equal(all.shown, matched.length);
  for (const tag of TAGS) assert.equal(all.counts[tag], matched.filter(feature => PROTECTION_FEATURE_FILTER[feature] === tag).length, tag);
  const network = protectionFilterView(PROTECTION_GROUPS, PROTECTION_FEATURE_FILTER, matches, 'network');
  assert.deepEqual(network.groups.flatMap(group => group.features).sort(), matched.filter(feature => PROTECTION_FEATURE_FILTER[feature] === 'network').sort());
  assert.deepEqual(network.counts, all.counts);
  const none = protectionFilterView(PROTECTION_GROUPS, PROTECTION_FEATURE_FILTER, () => false, 'hardware');
  assert.deepEqual(none, { category: 'hardware', groups: [], counts: { all: 0, hardware: 0, os: 0, network: 0, browser: 0, social: 0 }, shown: 0 });
  const empty = protectionFilterView(PROTECTION_GROUPS, PROTECTION_FEATURE_FILTER, matches, 'os');
  assert.equal(empty.shown, 0, 'a selected chip may legitimately show no rows');
  assert.deepEqual(empty.groups, []);
});

test('unknown, inherited or differently cased categories fall back to All', () => {
  for (const category of ['__proto__', 'constructor', 'toString', undefined, null, 'Hardware', 'ALL', '', 1, {}]) {
    const view = protectionFilterView(PROTECTION_GROUPS, PROTECTION_FEATURE_FILTER, everything, category);
    assert.equal(view.category, 'all', String(category));
    assert.equal(view.shown, PROTECTION_FEATURES.length);
  }
});

test('only own tags count; rows without a tag appear only under All', () => {
  const groups = [{ id: 'mixed', icon: 'M0 0', features: ['constructor', '__proto__', 'webgl', 'untagged'] }];
  const filter = Object.assign(Object.create({ untagged: 'network', constructor: 'os' }), { webgl: 'hardware' });
  const all = protectionFilterView(groups, filter, everything, 'all');
  assert.deepEqual(all.counts, { all: 4, hardware: 1, os: 0, network: 0, browser: 0, social: 0 });
  assert.deepEqual(all.groups[0].features, ['constructor', '__proto__', 'webgl', 'untagged']);
  for (const tag of ['os', 'network']) assert.deepEqual(protectionFilterView(groups, filter, everything, tag).groups, [], tag);
  assert.deepEqual(protectionFilterView(groups, filter, everything, 'hardware').groups, [{ id: 'mixed', icon: 'M0 0', features: ['webgl'] }]);
});

test('protectionFilterView never mutates or retains its inputs', () => {
  // Mutable copies detect writes; deep-frozen copies prove no write is attempted.
  for (const freeze of [false, true]) {
    const copy = structuredClone(PROTECTION_GROUPS.map(group => ({ ...group, features: [...group.features] })));
    const groups = freeze ? deepFreeze(copy) : copy, filter = freeze ? deepFreeze({ ...PROTECTION_FEATURE_FILTER }) : { ...PROTECTION_FEATURE_FILTER };
    const before = structuredClone(groups), filterBefore = structuredClone(filter);
    for (const category of PROTECTION_FILTERS) {
      const view = protectionFilterView(groups, filter, feature => feature !== 'webgl', category);
      for (const group of view.groups) assert.equal(groups.some(entry => entry.features === group.features || entry === group), false, 'returns fresh groups and row arrays');
      view.counts.all = -1; view.groups.length = 0;
    }
    assert.deepEqual(groups, before);
    assert.deepEqual(filter, filterBefore);
    assert.equal(protectionFilterView(groups, filter, everything, 'all').shown, PROTECTION_FEATURES.length);
  }
  assert.deepEqual(PROTECTION_GROUPS.map(group => Object.keys(group)), PROTECTION_GROUPS.map(() => ['id', 'icon', 'features']));
});

test('rovingIndex follows LTR and RTL arrows, vertical arrows, Home/End and wraps', () => {
  const last = PROTECTION_FILTERS.length - 1;
  assert.equal(rovingIndex('ArrowRight', 0, 6), 1);
  assert.equal(rovingIndex('ArrowLeft', 0, 6), last);
  assert.equal(rovingIndex('ArrowRight', last, 6), 0);
  assert.equal(rovingIndex('ArrowLeft', 3, 6), 2);
  assert.equal(rovingIndex('ArrowLeft', 0, 6, true), 1, 'RTL: left moves forward');
  assert.equal(rovingIndex('ArrowRight', 0, 6, true), last, 'RTL: right moves backward');
  assert.equal(rovingIndex('ArrowLeft', last, 6, true), 0);
  for (const rtl of [false, true]) {
    assert.equal(rovingIndex('ArrowDown', 2, 6, rtl), 3);
    assert.equal(rovingIndex('ArrowUp', 2, 6, rtl), 1);
    assert.equal(rovingIndex('ArrowDown', last, 6, rtl), 0);
    assert.equal(rovingIndex('ArrowUp', 0, 6, rtl), last);
    assert.equal(rovingIndex('Home', 4, 6, rtl), 0);
    assert.equal(rovingIndex('End', 1, 6, rtl), last);
  }
  for (const key of ['Enter', ' ', 'Tab', 'a', 'arrowright', undefined]) assert.equal(rovingIndex(key, 1, 6), null, String(key));
  assert.equal(rovingIndex('ArrowRight', -1, 6), 1, 'index -1 is treated as 0');
  assert.equal(rovingIndex('ArrowLeft', -1, 6), last);
  assert.equal(rovingIndex('ArrowRight', 0, 1), 0);
  for (const length of [0, -1, 1.5, NaN, undefined, '6']) assert.equal(rovingIndex('ArrowRight', 0, length), null, String(length));
});

test('filter code never touches rule markup attributes, storage or protection messages', () => {
  const source = readFileSync(new URL('../../apps/production-extension/protection-ui.js', import.meta.url), 'utf8');
  const occurrences = (text, needle) => text.split(needle).length - 1;
  // Native tests count these attributes: they belong only to the rule row markup.
  assert.equal(occurrences(source, "'data-protection-state'"), 1);
  assert.equal(occurrences(source, "'data-protection-feature'"), 1);
  const rowStart = source.indexOf('const ruleRow = feature =>'), rowEnd = source.indexOf('\n    };\n', rowStart);
  assert.ok(rowStart > 0 && rowEnd > rowStart);
  const row = source.slice(rowStart, rowEnd);
  assert.ok(row.includes("'data-protection-state'") && row.includes("'data-protection-feature'"));
  const slice = (start, end) => { const from = source.indexOf(start), to = source.indexOf(end, from); assert.ok(from >= 0 && to > from, start); return source.slice(from, to); };
  const filterCode = [
    slice('export const PROTECTION_FILTERS', 'export function createProtectionUi('),
    slice('const pageRtl = ()', 'function ProtectionSettings('),
    slice("const [category, setCategory] = useState('all')", 'const edit = next =>'),
    slice('const matching = new Set(features);', 'const updateSite = ')
  ];
  for (const code of filterCode) {
    for (const forbidden of ['data-protection-state', 'data-protection-feature', '.storage', 'localStorage', 'sessionStorage', 'indexedDB', 'protection:v1', 'ui-protection-', 'sendMessage', 'browserApi', 'save(', 'setDraft', 'edit(']) {
      assert.equal(code.includes(forbidden), false, forbidden + ' in filter code');
    }
  }
});
