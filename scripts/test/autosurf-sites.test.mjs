import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { SITE_CATEGORY_IDS, SITE_TRACKING_CATEGORY_IDS, SITE_COUNTRY_CODES, SITE_LIMITS, validateAutosurfSitesData, searchAutosurfSites, mergeAutosurfSiteUrls } from '../../apps/production-extension/autosurf-sites.js';
import { AUTOSURF_SITES_DATA } from '../../apps/production-extension/autosurf-sites-data.js';

const site = (id, name, countries, categories, bucket = 1000) => ({ id, name, origin: 'https://' + id, countries, categories, rankBuckets: Object.fromEntries(countries.map(country => [country, bucket])) });
const fixture = () => ({ version: 1, revision: 'test-1', publishedAt: '2026-10-13', countries: ['US', 'ME', 'FR'], categories: ['news', 'automotive', 'weather'],
  sources: [{ id: 'test-source', title: 'Owned metadata fixture', url: 'https://source.test/catalog', license: 'CC0-1.0', asOf: '2026-09' }],
  sites: [site('car.test', 'Café Cars', ['US', 'ME'], ['automotive'], 5000), site('news.test', 'Новости', ['ME'], ['news']), site('weather.test', 'Météo', ['FR', 'US'], ['weather'], 50000), site('auto-news.test', 'Auto News', ['FR'], ['news', 'automotive'])] });
const rejects = value => assert.throws(() => validateAutosurfSitesData(value), /invalid/);
const names = result => result.rows.map(row => row.id);

test('delivered dated catalog satisfies the production schema and covers every displayed filter', () => {
  const data = validateAutosurfSitesData(AUTOSURF_SITES_DATA);
  assert.deepEqual(data.countries, [...SITE_COUNTRY_CODES]); assert.deepEqual(data.categories, [...SITE_CATEGORY_IDS]); assert.ok(data.sites.length > 500);
  const results = searchAutosurfSites(data); assert.equal(results.total, data.sites.length); assert.equal(results.rows.length, SITE_LIMITS.page);
  for (const country of data.countries) assert.ok(results.countryCounts[country] > 0, country);
  for (const category of data.categories) assert.ok(results.categoryCounts[category] > 0, category);
  assert.equal(data.sources[0].license, 'CC-BY-4.0'); assert.equal(data.publishedAt, '2026-10-13');
});

test('validated catalog keeps actual country buckets and freezes an independent bounded copy', () => {
  const input = fixture(), data = validateAutosurfSitesData(input);
  assert.notEqual(data, input); assert.equal(Object.isFrozen(data.sites[0].rankBuckets), true); assert.equal(data.sites[0].rankBuckets.ME, 5000);
  input.sites[0].name = 'MUTATED'; input.sites.push(site('late.test', 'Late', ['US'], ['news']));
  assert.equal(validateAutosurfSitesData(input), data); assert.equal(searchAutosurfSites(input, { query: 'mutated' }).total, 0);
  assert.equal(searchAutosurfSites(data).total, 4); assert.equal(data.sites[0].origin, 'https://car.test');
});

test('catalog validation rejects unknown dimensions, duplicate rows and incomplete country evidence', () => {
  for (const mutate of [
    value => { value.countries.push('XX'); }, value => { value.categories.push('not-a-category'); },
    value => { value.sites.push(structuredClone(value.sites[0])); }, value => { value.sites[0].countries.push('FR'); },
    value => { value.sites[0].rankBuckets.US = 0; }, value => { value.sites[0].rankBuckets.US = Infinity; },
    value => { value.sites[0].rankBuckets.UNUSED = 1000; }, value => { value.sites[0].id = 'alias.test'; },
    value => { value.sources[0].url = 'http://source.test/'; }, value => { value.publishedAt = '2026-02-31'; },
  ]) { const value = fixture(); mutate(value); rejects(value); }
});

test('catalog URL validation allows only ordinary HTTPS domain roots', () => {
  const numericPrefix = fixture(); numericPrefix.sites[0].origin = 'https://2gis.test'; numericPrefix.sites[0].id = '2gis.test'; assert.equal(validateAutosurfSitesData(numericPrefix).sites[0].id, '2gis.test');
  for (const origin of ['http://car.test', 'https://user:pass@car.test/', 'https://car.test/checkout', 'https://car.test/?token=SECRET', 'https://car.test/#part', 'https://127.0.0.1/', 'https://[::1]/', 'https://car.test:8443/', 'https://a..test/', 'https://bad-.test/']) {
    const value = fixture(); value.sites[0].origin = origin; rejects(value);
  }
});

test('malformed metadata never executes accessors and sparse or oversized arrays are rejected', () => {
  let reads = 0; const accessor = fixture(); Object.defineProperty(accessor.sites[0], 'name', { enumerable: true, get() { reads++; return 'poison'; } }); rejects(accessor); assert.equal(reads, 0);
  const sparse = fixture(); delete sparse.sites[1]; rejects(sparse);
  const extra = fixture(); extra.sites.extra = 'poison'; rejects(extra);
  const big = fixture(); big.sites = Array(SITE_LIMITS.rows + 1).fill(big.sites[0]); rejects(big);
  const title = fixture(); title.sites[0].name = '<img onerror=alert(1)>'; rejects(title);
});

test('search uses case and accent independent words while preserving real Unicode names', () => {
  const data = fixture(); assert.deepEqual(names(searchAutosurfSites(data, { query: 'CAFE cars' })), ['car.test']);
  assert.deepEqual(names(searchAutosurfSites(data, { query: 'météo' })), ['weather.test']); assert.deepEqual(names(searchAutosurfSites(data, { query: 'НОВОСТИ' })), ['news.test']);
  assert.equal(searchAutosurfSites(data, { query: 'Café ' + ' '.repeat(200) }).total, 1);
});

test('country and category facets count the query and opposite filter without double counting rows', () => {
  const data = fixture(), all = searchAutosurfSites(data);
  assert.equal(all.total, 4); assert.equal(all.countryCounts.all, 4); assert.equal(all.countryCounts.US, 2); assert.equal(all.categoryCounts.news, 2);
  const country = searchAutosurfSites(data, { country: 'ME' }); assert.deepEqual(names(country), ['news.test', 'car.test']); assert.equal(country.categoryCounts.automotive, 1); assert.equal(country.categoryCounts.weather, 0); assert.equal(country.countryCounts.FR, 2);
  const both = searchAutosurfSites(data, { country: 'ME', category: 'automotive' }); assert.deepEqual(names(both), ['car.test']); assert.equal(both.countryCounts.FR, 1); assert.equal(both.categoryCounts.news, 1);
  const text = searchAutosurfSites(data, { query: 'Auto', country: 'FR' }); assert.deepEqual(names(text), ['auto-news.test']); assert.equal(text.countryCounts.ME, 1); assert.equal(text.categoryCounts.news, 1);
});

test('country ordering uses its actual bucket then stable accent-folded name and ID', () => {
  const data = fixture(); data.sites = [site('zeta.test', 'Zeta', ['ME'], ['news'], 1000), site('cafe-b.test', 'Café', ['ME'], ['news'], 5000), site('beta.test', 'Beta', ['ME'], ['news'], 1000), site('cafe-a.test', 'Cafe', ['ME'], ['news'], 5000)];
  assert.deepEqual(names(searchAutosurfSites(data)), ['zeta.test', 'cafe-b.test', 'beta.test', 'cafe-a.test']);
  assert.deepEqual(names(searchAutosurfSites(data, { country: 'ME' })), ['beta.test', 'zeta.test', 'cafe-a.test', 'cafe-b.test']);
  assert.deepEqual(names(searchAutosurfSites(data, { country: 'ME', offset: 1, limit: 2 })), ['zeta.test', 'cafe-a.test']);
});

const trackedFixture = () => {
  const data = fixture();
  data.trackingSystems = [{ id: 'forter', name: 'Forter', categories: ['fraud-prevention'], sourceUrl: 'https://source.test/forter' }, { id: 'fingerprint', name: 'Fingerprint', categories: ['fraud-prevention', 'bot-management'], sourceUrl: 'https://source.test/fingerprint' }];
  data.trackingSourceId = 'test-source'; data.trackingSnapshotAt = '2026-10-30';
  data.sites[0].trackingSystems = ['forter', 'fingerprint']; data.sites[1].trackingSystems = ['forter']; data.sites[2].trackingSystems = ['fingerprint'];
  return data;
};

test('tracking systems share canonical rows and all three facets count intersections independently', () => {
  const data = trackedFixture(), checked = validateAutosurfSitesData(data);
  const all = searchAutosurfSites(checked); assert.equal(all.total, 4); assert.deepEqual(all.trackingSystemCounts, { all: 4, forter: 2, fingerprint: 2 });
  const forter = searchAutosurfSites(checked, { trackingSystem: 'forter' });
  assert.deepEqual(names(forter), ['car.test', 'news.test']); assert.equal(forter.rows[0], checked.sites[0]); assert.equal(forter.countryCounts.FR, 0); assert.equal(forter.categoryCounts.news, 1);
  const intersection = searchAutosurfSites(checked, { country: 'ME', category: 'automotive', trackingSystem: 'forter' });
  assert.deepEqual(names(intersection), ['car.test']); assert.equal(intersection.categoryCounts.news, 1); assert.equal(intersection.countryCounts.US, 1); assert.equal(intersection.trackingSystemCounts.fingerprint, 1);
  const query = searchAutosurfSites(checked, { query: 'News', country: 'FR', trackingSystem: 'forter' });
  assert.equal(query.total, 0); assert.equal(query.countryCounts.ME, 1); assert.equal(query.trackingSystemCounts.all, 1); assert.equal(query.trackingSystemCounts.forter, 0);
  assert.ok(Object.isFrozen(checked.trackingSystems[0].categories)); assert.ok(Object.isFrozen(checked.sites[0].trackingSystems));
  data.trackingSystems[0].name = 'Mutation'; data.sites[0].trackingSystems.length = 0;
  assert.equal(checked.trackingSystems[0].name, 'Forter'); assert.equal(searchAutosurfSites(checked, { trackingSystem: 'forter' }).total, 2);
});

test('independent tracking associations without country or topic evidence remain unassigned', () => {
  const data = trackedFixture(); data.sites.push({ ...site('unknown.test', 'Unknown', [], []), trackingSystems: ['forter'] });
  const checked = validateAutosurfSitesData(data), all = searchAutosurfSites(checked, { trackingSystem: 'forter' });
  assert.equal(all.total, 3); assert.equal(all.countryCounts.all, 3); assert.equal(all.countryCounts.US, 1); assert.equal(all.categoryCounts.news, 1);
  assert.equal(searchAutosurfSites(checked, { country: 'US', trackingSystem: 'forter' }).total, 1);
  assert.equal(searchAutosurfSites(checked, { category: 'news', trackingSystem: 'forter' }).total, 1);
  const empty = fixture(); empty.sites[0].countries = []; empty.sites[0].rankBuckets = {}; rejects(empty);
});

const trackingCategoryFixture = () => {
  const data = trackedFixture();
  data.trackingSystems = [
    { id: 'fraud-a', name: 'Fraud A', categories: ['fraud-prevention'] },
    { id: 'fraud-b', name: 'Fraud B', categories: ['fraud-prevention', 'device-fingerprinting'] },
    { id: 'bot-a', name: 'Bot A', categories: ['bot-management', 'bot-detection'] },
    { id: 'shop', name: 'Shop', categories: ['ecommerce-intelligence'] },
    { id: 'captcha', name: 'Captcha', categories: ['captcha', 'bot-detection'] },
  ];
  data.sites = [
    { ...site('shared.test', 'Shared', ['US'], ['automotive']), trackingSystems: ['fraud-a', 'fraud-b', 'bot-a'] },
    { ...site('news.test', 'News', ['ME'], ['news']), trackingSystems: ['fraud-a', 'captcha'] },
    { ...site('shop.test', 'Shop', ['FR'], ['news']), trackingSystems: ['shop'] },
    { ...site('unknown.test', 'Unknown', [], []), trackingSystems: ['fraud-b'] },
    site('plain.test', 'Plain', ['FR'], ['weather']),
  ];
  return data;
};

test('system categories are a fixed immutable navigation set and count distinct associated sites', () => {
  assert.equal(Object.isFrozen(SITE_TRACKING_CATEGORY_IDS), true);
  assert.deepEqual(SITE_TRACKING_CATEGORY_IDS, ['fraud-prevention', 'bot-management', 'ecommerce-intelligence', 'device-fingerprinting', 'bot-detection', 'captcha']);
  const checked = validateAutosurfSitesData(trackingCategoryFixture()), all = searchAutosurfSites(checked);
  assert.deepEqual(all.trackingCategoryCounts, { all: 5, 'fraud-prevention': 3, 'bot-management': 1, 'ecommerce-intelligence': 1, 'device-fingerprinting': 2, 'bot-detection': 2, captcha: 1 });
  const fraud = searchAutosurfSites(checked, { trackingCategory: 'fraud-prevention' });
  assert.deepEqual(names(fraud), ['shared.test', 'news.test', 'unknown.test']);
  assert.equal(fraud.rows[0], checked.sites[0]);
  assert.equal(fraud.total, 3); assert.equal(fraud.trackingSystemCounts.all, 3);
  assert.deepEqual(fraud.trackingSystemCounts, { all: 3, 'fraud-a': 2, 'fraud-b': 2, 'bot-a': 0, shop: 0, captcha: 0 });
  assert.deepEqual(fraud.trackingCategoryCounts, all.trackingCategoryCounts);
  const bothBotCategories = searchAutosurfSites(checked, { trackingCategory: 'bot-detection' });
  assert.deepEqual(names(bothBotCategories), ['shared.test', 'news.test']);
  assert.equal(bothBotCategories.trackingSystemCounts['bot-a'], 1); assert.equal(bothBotCategories.trackingSystemCounts.captcha, 1);
});

test('system-category facets intersect country, topic and text while leaving category alternatives available', () => {
  const data = trackingCategoryFixture();
  const country = searchAutosurfSites(data, { country: 'ME', trackingCategory: 'fraud-prevention' });
  assert.deepEqual(names(country), ['news.test']); assert.equal(country.countryCounts.US, 1); assert.equal(country.categoryCounts.news, 1); assert.equal(country.trackingSystemCounts['fraud-b'], 0);
  assert.deepEqual(country.trackingCategoryCounts, { all: 1, 'fraud-prevention': 1, 'bot-management': 0, 'ecommerce-intelligence': 0, 'device-fingerprinting': 0, 'bot-detection': 1, captcha: 1 });
  const topic = searchAutosurfSites(data, { category: 'news', trackingCategory: 'fraud-prevention', trackingSystem: 'fraud-a' });
  assert.deepEqual(names(topic), ['news.test']); assert.equal(topic.categoryCounts.automotive, 1); assert.equal(topic.countryCounts.US, 0);
  assert.deepEqual(topic.trackingCategoryCounts, { all: 2, 'fraud-prevention': 1, 'bot-management': 0, 'ecommerce-intelligence': 1, 'device-fingerprinting': 0, 'bot-detection': 1, captcha: 1 });
  const text = searchAutosurfSites(data, { query: 'news', country: 'ME', category: 'news', trackingCategory: 'captcha', trackingSystem: 'captcha' });
  assert.deepEqual(names(text), ['news.test']); assert.equal(text.trackingCategoryCounts.all, 1); assert.equal(text.trackingCategoryCounts['fraud-prevention'], 1); assert.equal(text.trackingCategoryCounts.captcha, 1);
  assert.equal(text.trackingSystemCounts['fraud-a'], 0); assert.equal(text.trackingSystemCounts.captcha, 1);
});

test('incompatible individual system cannot use a coinstalled system to enter another category', () => {
  const data = trackingCategoryFixture(), incompatible = searchAutosurfSites(data, { trackingCategory: 'captcha', trackingSystem: 'fraud-a' });
  assert.equal(incompatible.total, 0); assert.deepEqual(incompatible.rows, []);
  assert.ok(Object.values(incompatible.countryCounts).every(count => count === 0));
  assert.ok(Object.values(incompatible.categoryCounts).every(count => count === 0));
  assert.equal(incompatible.trackingSystemCounts.all, 1); assert.equal(incompatible.trackingSystemCounts.captcha, 1); assert.equal(incompatible.trackingSystemCounts['fraud-a'], 0);
  assert.equal(incompatible.trackingCategoryCounts['fraud-prevention'], 3); assert.equal(incompatible.trackingCategoryCounts.captcha, 1);
  assert.deepEqual(names(searchAutosurfSites(data, { trackingCategory: 'device-fingerprinting', trackingSystem: 'fraud-b' })), ['shared.test', 'unknown.test']);
});

test('tracking-category navigation preserves unknown country/topic evidence and immutable cached membership', () => {
  const input = trackingCategoryFixture(), data = validateAutosurfSitesData(input);
  const unknown = searchAutosurfSites(data, { trackingCategory: 'device-fingerprinting', query: 'unknown' });
  assert.deepEqual(names(unknown), ['unknown.test']); assert.equal(unknown.countryCounts.all, 1); assert.equal(unknown.categoryCounts.all, 1);
  assert.ok(Object.entries(unknown.countryCounts).filter(([id]) => id !== 'all').every(([, count]) => count === 0));
  assert.ok(Object.entries(unknown.categoryCounts).filter(([id]) => id !== 'all').every(([, count]) => count === 0));
  assert.equal(searchAutosurfSites(data, { trackingCategory: 'device-fingerprinting', country: 'US' }).total, 1);
  assert.equal(searchAutosurfSites(data, { trackingCategory: 'device-fingerprinting', category: 'news' }).total, 0);
  input.trackingSystems[1].categories = ['captcha']; input.sites[0].trackingSystems = ['shop'];
  assert.deepEqual(names(searchAutosurfSites(input, { trackingCategory: 'device-fingerprinting' })), ['shared.test', 'unknown.test']);
  assert.equal(searchAutosurfSites(input, { trackingCategory: 'captcha' }).total, 1);
});

test('tracking-category filters reject unknown IDs without coercion and keep existing defaults compatible', () => {
  const data = trackingCategoryFixture(), defaultSearch = searchAutosurfSites(data);
  assert.deepEqual(defaultSearch, searchAutosurfSites(data, { trackingCategory: 'all' }));
  let coercions = 0;
  for (const trackingCategory of ['unknown', '../../captcha', 'CAPTCHA', '', null, 0, [], { toString() { coercions++; return 'captcha'; } }]) assert.throws(() => searchAutosurfSites(data, { trackingCategory }), /invalid/);
  assert.equal(coercions, 0);
  const old = fixture(), all = searchAutosurfSites(old);
  assert.equal(all.total, 4); assert.equal(all.trackingCategoryCounts.all, 4);
  assert.ok(SITE_TRACKING_CATEGORY_IDS.every(id => all.trackingCategoryCounts[id] === 0));
  assert.equal(searchAutosurfSites(old, { trackingCategory: 'captcha' }).total, 0);
  const custom = trackedFixture(); custom.trackingSystems[0].categories = ['custom-category'];
  assert.equal(searchAutosurfSites(custom, { trackingSystem: 'forter' }).total, 2);
  assert.equal(searchAutosurfSites(custom, { trackingCategory: 'bot-management', trackingSystem: 'forter' }).total, 0);
});

test('every delivered tracking system belongs to navigation categories with matching distinct-site coverage', () => {
  const checked = validateAutosurfSitesData(AUTOSURF_SITES_DATA), all = searchAutosurfSites(checked);
  assert.ok(checked.trackingSystems.every(system => system.categories.every(id => SITE_TRACKING_CATEGORY_IDS.includes(id))));
  for (const id of SITE_TRACKING_CATEGORY_IDS) {
    const systems = new Set(checked.trackingSystems.filter(system => system.categories.includes(id)).map(system => system.id));
    const expected = checked.sites.filter(site => site.trackingSystems.some(system => systems.has(system))).length;
    assert.ok(expected > 0, id);
    const result = searchAutosurfSites(checked, { trackingCategory: id });
    assert.equal(result.total, expected, id); assert.equal(all.trackingCategoryCounts[id], expected, id); assert.equal(result.trackingSystemCounts.all, expected, id);
    assert.ok(checked.trackingSystems.filter(system => !systems.has(system.id)).every(system => result.trackingSystemCounts[system.id] === 0), id);
  }
});

test('multiple selected systems form a distinct-site union and keep country/topic facets intersected', () => {
  const data = trackingCategoryFixture(), options = { trackingSystems: ['fraud-a', 'fraud-b'] };
  const union = searchAutosurfSites(data, options);
  assert.deepEqual(names(union), ['shared.test', 'news.test', 'unknown.test']); assert.equal(union.total, 3);
  assert.deepEqual(union.countryCounts, { all: 3, US: 1, ME: 1, FR: 0 });
  assert.deepEqual(union.categoryCounts, { all: 3, news: 1, automotive: 1, weather: 0 });
  const country = searchAutosurfSites(data, { ...options, country: 'ME' });
  assert.deepEqual(names(country), ['news.test']); assert.equal(country.countryCounts.US, 1); assert.equal(country.categoryCounts.all, 1);
  const topic = searchAutosurfSites(data, { ...options, category: 'automotive' });
  assert.deepEqual(names(topic), ['shared.test']); assert.equal(topic.countryCounts.all, 1); assert.equal(topic.categoryCounts.news, 1);
  const query = searchAutosurfSites(data, { ...options, country: 'ME', category: 'news', query: 'news' });
  assert.deepEqual(names(query), ['news.test']); assert.equal(query.countryCounts.all, 1);
  const all = searchAutosurfSites(data);
  assert.deepEqual(union.trackingSystemCounts, all.trackingSystemCounts, 'system alternatives ignore their own OR selection');
  assert.deepEqual(union.trackingCategoryCounts, all.trackingCategoryCounts, 'parent navigation ignores the OR selection');
  assert.equal(searchAutosurfSites(data, { ...options, query: 'plain' }).total, 0);
});

test('category scope removes incompatible OR alternatives without admitting a coinstalled foreign selection', () => {
  const data = trackingCategoryFixture(), selection = Object.freeze(['fraud-a', 'bot-a', 'captcha']);
  const fraud = searchAutosurfSites(data, { trackingSystems: selection, trackingCategory: 'fraud-prevention' });
  assert.deepEqual(fraud, searchAutosurfSites(data, { trackingSystem: 'fraud-a', trackingCategory: 'fraud-prevention' }));
  const bots = searchAutosurfSites(data, { trackingSystems: selection, trackingCategory: 'bot-management' });
  assert.deepEqual(names(bots), ['shared.test']); assert.equal(bots.trackingSystemCounts['fraud-a'], 0); assert.equal(bots.trackingSystemCounts['bot-a'], 1);
  const none = searchAutosurfSites(data, { trackingSystems: ['fraud-a', 'shop'], trackingCategory: 'captcha' });
  assert.equal(none.total, 0, 'a different installed CAPTCHA cannot make the selected foreign systems compatible');
  assert.ok(Object.values(none.countryCounts).every(count => count === 0));
  assert.ok(Object.values(none.categoryCounts).every(count => count === 0));
  assert.equal(none.trackingSystemCounts.captcha, 1); assert.equal(none.trackingCategoryCounts['fraud-prevention'], 3);
  assert.deepEqual(selection, ['fraud-a', 'bot-a', 'captcha'], 'scope filtering never mutates the supplied selection');
});

test('plural selection keeps single-system parity, empty defaults and current input across successive calls', () => {
  const data = trackingCategoryFixture();
  assert.deepEqual(searchAutosurfSites(data, { trackingSystems: [] }), searchAutosurfSites(data));
  for (const trackingSystem of data.trackingSystems.map(system => system.id)) {
    for (const options of [{}, { country: 'US' }, { category: 'news', query: 'news' }, { trackingCategory: 'captcha' }]) {
      assert.deepEqual(searchAutosurfSites(data, { ...options, trackingSystems: [trackingSystem] }), searchAutosurfSites(data, { ...options, trackingSystem }));
    }
    assert.deepEqual(searchAutosurfSites(data, { trackingSystem, trackingSystems: [] }), searchAutosurfSites(data, { trackingSystem }));
  }
  const selection = ['fraud-b'];
  assert.deepEqual(names(searchAutosurfSites(data, { trackingSystems: selection })), ['shared.test', 'unknown.test']);
  selection[0] = 'shop';
  assert.deepEqual(names(searchAutosurfSites(data, { trackingSystems: selection })), ['shop.test']);
  assert.equal(searchAutosurfSites(fixture(), { trackingSystems: [] }).total, 4);
});

test('plural selection rejects ambiguous, sparse, accessor, duplicate and oversized values without coercion', () => {
  const data = trackingCategoryFixture(); let reads = 0, coercions = 0;
  const sparse = ['fraud-a']; sparse.length = 2;
  const extra = ['fraud-a']; extra.extra = 'captcha';
  const accessor = []; Object.defineProperty(accessor, '0', { enumerable: true, get() { reads++; return 'fraud-a'; } });
  const oversized = Array(SITE_LIMITS.trackingSystems + 1).fill('fraud-a'); Object.defineProperty(oversized, '0', { enumerable: true, get() { reads++; return 'fraud-a'; } });
  const customIteration = ['fraud-a']; Object.defineProperty(customIteration, Symbol.iterator, { value() { reads++; return ['captcha'][Symbol.iterator](); } });
  for (const trackingSystems of [null, {}, 'fraud-a', 7, [null], [7], ['all'], ['unknown'], ['fraud-a', 'fraud-a'], sparse, extra, accessor, oversized, customIteration, [{ toString() { coercions++; return 'fraud-a'; } }]]) {
    assert.throws(() => searchAutosurfSites(data, { trackingSystems }), /invalid/);
  }
  assert.equal(reads, 0); assert.equal(coercions, 0);
  assert.throws(() => searchAutosurfSites(data, { trackingSystem: 'fraud-a', trackingSystems: ['captcha'] }), /invalid/);
  assert.throws(() => searchAutosurfSites(data, { trackingSystem: 'fraud-a', trackingSystems: ['fraud-a'] }), /invalid/);
  const bounded = fixture();
  bounded.trackingSystems = Array.from({ length: SITE_LIMITS.trackingSystems }, (_, index) => ({ id: 'bounded-' + index, name: 'Bounded ' + index, categories: ['fraud-prevention'] }));
  bounded.sites[0].trackingSystems = [bounded.trackingSystems.at(-1).id];
  const selected = bounded.trackingSystems.map(system => system.id);
  assert.deepEqual(names(searchAutosurfSites(bounded, { trackingSystems: selected })), ['car.test'], 'all 500 distinct known IDs are accepted within the limit');
});

test('actual AWS CAPTCHA plus another system returns the full union rather than its small overlap', () => {
  const data = validateAutosurfSitesData(AUTOSURF_SITES_DATA), trackingSystems = ['amazon-aws-waf-captcha', 'accertify'];
  const sets = trackingSystems.map(id => new Set(data.sites.filter(site => site.trackingSystems.includes(id)).map(site => site.id)));
  const overlap = [...sets[0]].filter(id => sets[1].has(id)).length;
  const expected = data.sites.filter(site => site.trackingSystems.some(id => trackingSystems.includes(id)));
  assert.ok(overlap > 0); assert.ok(expected.length > sets[0].size && expected.length > sets[1].size);
  assert.equal(expected.length, sets[0].size + sets[1].size - overlap);
  const union = searchAutosurfSites(data, { trackingSystems });
  assert.equal(union.total, expected.length); assert.deepEqual(names(union), expected.slice(0, SITE_LIMITS.page).map(site => site.id));
  const awsOnly = searchAutosurfSites(data, { trackingSystem: trackingSystems[0] });
  assert.deepEqual(searchAutosurfSites(data, { trackingSystems, trackingCategory: 'captcha' }), searchAutosurfSites(data, { trackingSystem: trackingSystems[0], trackingCategory: 'captcha' }));
  assert.equal(awsOnly.total, sets[0].size);
});

test('dated catalogue metadata may omit publication links without changing site associations', () => {
  const input = trackedFixture();
  delete input.sources[0].url;
  for (const system of input.trackingSystems) delete system.sourceUrl;
  const data = validateAutosurfSitesData(input);
  assert.equal(Object.hasOwn(data.sources[0], 'url'), false);
  assert.ok(data.trackingSystems.every(system => !Object.hasOwn(system, 'sourceUrl')));
  assert.equal(data.trackingSnapshotAt, input.trackingSnapshotAt);
  assert.deepEqual(searchAutosurfSites(data, { trackingSystem: 'forter' }).rows.map(site => site.id), searchAutosurfSites(trackedFixture(), { trackingSystem: 'forter' }).rows.map(site => site.id));
  assert.ok(Object.isFrozen(data.sources[0]) && Object.isFrozen(data.trackingSystems[0]));
});

test('optional publication links still reject malformed values and never execute accessors', () => {
  for (const value of [undefined, null, '', 'http://source.test/', 'javascript:alert(1)', 'https://user:password@source.test/', 'https://source.test/?key=PRIVATE', 'https://source.test/#PRIVATE']) {
    const source = trackedFixture(); source.sources[0].url = value; rejects(source);
    const system = trackedFixture(); system.trackingSystems[0].sourceUrl = value; rejects(system);
  }
  let reads = 0;
  const input = trackedFixture();
  Object.defineProperty(input.sources[0], 'url', { enumerable: true, get() { reads++; return 'https://source.test/'; } });
  rejects(input); assert.equal(reads, 0);
});

test('tracking metadata rejects unknown references, credential URLs and ambiguous optional values', () => {
  for (const mutate of [
    value => { value.trackingSystems = null; }, value => { value.trackingSystems[0].id = 'all'; },
    value => { value.sites[0].trackingSystems = null; }, value => { value.sites[0].trackingSystems = ['missing']; },
    value => { value.sites[0].trackingSystems = ['forter', 'forter']; }, value => { value.trackingSystems.push({ ...value.trackingSystems[0] }); },
    value => { value.trackingSystems[0].sourceUrl = 'https://source.test/?KEY=PRIVATE'; }, value => { value.trackingSystems[0].sourceUrl = 'http://source.test/'; },
    value => { value.trackingSystems[0].sourceUrl = 'https://user:password@source.test/'; }, value => { value.trackingSystems[0].name = '<img>'; },
    value => { value.trackingSystems[0].categories = ['bot-management', 'bot-management']; }, value => { value.trackingSystems[0].extra = true; },
    value => { value.trackingSourceId = 'unknown'; }, value => { delete value.trackingSnapshotAt; }, value => { value.trackingSnapshotAt = '2026-02-31'; },
    value => { value.sources[0].url = 'https://source.test/?KEY=PRIVATE'; }, value => { value.sources[0].url = 'https://source.test/#PRIVATE'; },
  ]) { const value = trackedFixture(); mutate(value); rejects(value); }
  let reads = 0; const poisoned = trackedFixture(); Object.defineProperty(poisoned.trackingSystems[0], 'sourceUrl', { enumerable: true, get() { reads++; return 'https://source.test'; } }); rejects(poisoned); assert.equal(reads, 0);
  for (const trackingSystem of ['missing', '../../path', null, {}, 7]) assert.throws(() => searchAutosurfSites(trackedFixture(), { trackingSystem }));
});

test('search pagination and query bounds remain explicit; invalid filter IDs do not become asset paths', () => {
  const data = fixture(); assert.deepEqual(names(searchAutosurfSites(data, { offset: 1, limit: 2 })), ['news.test', 'weather.test']);
  assert.equal(searchAutosurfSites(data, { offset: 4 }).rows.length, 0);
  assert.equal(searchAutosurfSites(data, { query: 'x'.repeat(10000) }).total, 0);
  for (const options of [{ country: '../../x' }, { category: 'bad' }, { offset: -1 }, { limit: 25 }, { limit: 0 }, { query: {} }]) assert.throws(() => searchAutosurfSites(data, options));
});

test('draft addition preserves original whitespace, private queries and deep paths exactly', () => {
  const original = '  https://car.test/deep?token=OWNED_QUERY#fragment  \r\n\r\n';
  const result = mergeAutosurfSiteUrls(original, ['https://car.test', 'https://news.test']);
  assert.equal(result.error, null); assert.equal(result.added, 2); assert.equal(result.text, original + 'https://car.test/\nhttps://news.test/');
  assert.equal(result.changed, true);
});

test('canonical duplicates are skipped without rewriting the draft or silently collapsing paths', () => {
  const original = ' https://CAR.test:443/ \nhttps://car.test/article';
  const result = mergeAutosurfSiteUrls(original, ['https://car.test', 'https://CAR.test:443/', 'https://news.test']);
  assert.equal(result.error, null); assert.equal(result.duplicates, 2); assert.equal(result.added, 1); assert.equal(result.text, original + '\nhttps://news.test/');
  const noChange = mergeAutosurfSiteUrls(original, ['https://car.test']); assert.deepEqual(noChange, { text: original, added: 0, duplicates: 1, changed: false, error: null });
});

test('invalid existing plans and invalid additions are unchanged as one atomic operation', () => {
  for (const existing of ['https://valid.test/\nnot-url', 'https://same.test\nhttps://same.test/']) {
    const result = mergeAutosurfSiteUrls(existing, ['https://fresh.test']); assert.ok(result.error); assert.equal(result.text, existing); assert.equal(result.changed, false); assert.equal(result.added, 0);
  }
  const original = 'https://original.test/';
  for (const candidates of [['https://fresh.test', 'javascript:alert(1)'], ['https://fresh.test/path'], ['http://fresh.test'], ['https://u:p@fresh.test']]) {
    const result = mergeAutosurfSiteUrls(original, candidates); assert.equal(result.error, 'invalid-url'); assert.equal(result.text, original); assert.equal(result.added, 0);
  }
});

test('200 URL capacity is atomic, counts only new URLs and never truncates', () => {
  const original = Array.from({ length: 199 }, (_, index) => 'https://site-' + index + '.test/').join('\n');
  const last = mergeAutosurfSiteUrls(original, ['https://last.test']); assert.equal(last.error, null); assert.equal(last.added, 1);
  const overflow = mergeAutosurfSiteUrls(original, ['https://one.test', 'https://two.test']); assert.equal(overflow.error, 'limit'); assert.equal(overflow.text, original);
  const duplicate = mergeAutosurfSiteUrls(last.text, ['https://last.test']); assert.equal(duplicate.error, null); assert.equal(duplicate.changed, false);
  const tooMany = mergeAutosurfSiteUrls('', Array.from({ length: 201 }, (_, index) => 'https://many-' + index + '.test')); assert.equal(tooMany.error, 'limit'); assert.equal(tooMany.text, '');
});

test('byte limits and malformed candidate arrays cannot replace a partial draft', () => {
  const original = '\n'.repeat(262140); const full = mergeAutosurfSiteUrls(original, ['https://fresh.test']); assert.equal(full.error, 'limit'); assert.equal(full.text, original);
  const sparse = ['https://first.test']; sparse.length = 2; assert.equal(mergeAutosurfSiteUrls('https://original.test/', sparse).error, 'invalid-input');
});

test('all 57 flags are pinned local SVG image documents with matching provenance and MIT notice', () => {
  const directory = new URL('../../apps/production-extension/icons/countries/', import.meta.url);
  const provenance = JSON.parse(readFileSync(new URL('PROVENANCE.json', directory), 'utf8'));
  assert.equal(provenance.commit, 'ac7e0eb3259eb62aa6100c435607e2fe03896a97'); assert.equal(provenance.license, 'MIT');
  assert.deepEqual(provenance.entries.map(entry => entry.country), [...SITE_COUNTRY_CODES]); assert.equal(new Set(provenance.entries.map(entry => entry.file)).size, 57);
  assert.equal(readdirSync(directory).filter(file => file.endsWith('.svg')).length, 57);
  for (const entry of provenance.entries) {
    assert.equal(entry.file, entry.country.toLowerCase() + '.svg'); const bytes = readFileSync(new URL(entry.file, directory)), svg = bytes.toString('utf8');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256); assert.equal(bytes.length, entry.bytes);
    assert.doesNotMatch(svg, /<(?:script|foreignObject|image|iframe|object|embed|style)\b|\bon[a-z]+\s*=|(?:href|xlink:href)\s*=\s*["'](?!#)|url\(\s*(?!["']?#)|<!DOCTYPE|<!ENTITY/i);
  }
  const license = readFileSync(new URL('LICENSE.txt', directory)); assert.equal(createHash('sha256').update(license).digest('hex'), provenance.licenseSha256); assert.match(license.toString(), /MIT License/);
  assert.match(readFileSync(new URL('NOTICE.txt', directory), 'utf8'), /Panayiotis Lipiridis/);
  assert.equal(new Set(SITE_CATEGORY_IDS).size, 20);
});
