// ADR-077/078: exact HTTPS-origin country evidence from the pinned public CrUX snapshot.
import assert from 'node:assert/strict';
import { SITE_COUNTRY_CODES, validateAutosurfSitesData } from '../apps/production-extension/autosurf-sites.js';

const COMMIT = '1db09887a9952d7f25abc480c6e1edc444a87673', MONTH = '202609';
const BUCKETS = new Set([1000, 5000, 10000, 50000, 100000, 500000, 1000000]);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [null, Object.prototype].includes(Object.getPrototypeOf(value));
const keys = (value, required, optional = []) => { assert.ok(record(value)); assert.ok(required.every(key => Object.hasOwn(value, key))); assert.ok(Object.keys(value).every(key => required.includes(key) || optional.includes(key))); };

function jsonData(value, budget = { nodes: 0 }, depth = 0) {
  assert.ok(++budget.nodes <= 10000000 && depth <= 16, 'CrUX evidence input budget');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') { assert.ok(value.length <= 2048); return; }
  if (typeof value === 'number') { assert.ok(Number.isFinite(value)); return; }
  assert.equal(typeof value, 'object', 'CrUX evidence must be JSON data');
  const array = Array.isArray(value); assert.ok(array ? Object.getPrototypeOf(value) === Array.prototype : record(value), 'CrUX evidence prototype');
  const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
  assert.ok(names.every(name => typeof name === 'string' && Object.hasOwn(descriptors[name], 'value')), 'CrUX evidence accessor');
  if (array) {
    const length = descriptors.length.value; assert.ok(length <= 50000 && names.length === length + 1, 'CrUX evidence dense array');
    for (let i = 0; i < length; i++) assert.ok(Object.hasOwn(descriptors, String(i)), 'CrUX evidence sparse array');
  }
  for (const name of names) {
    if (array && name === 'length') continue;
    assert.ok(!['__proto__', 'prototype', 'constructor'].includes(name) && descriptors[name].enumerable, 'CrUX evidence descriptor');
    jsonData(descriptors[name].value, budget, depth + 1);
  }
}

function sourceMetadata(evidence, pinned) {
  keys(pinned, ['version', 'commit', 'month', 'publishedAt', 'seedSha256', 'countrySources', 'rows']);
  assert.equal(pinned.version, 1); assert.equal(pinned.commit, COMMIT); assert.equal(pinned.month, MONTH);
  assert.equal(pinned.publishedAt, '2026-10-13');
  assert.ok(Array.isArray(pinned.countrySources)); assert.deepEqual(pinned.countrySources.map(source => source.code), SITE_COUNTRY_CODES);
  keys(evidence, ['version', 'commit', 'month', 'sources', 'rows'], ['publishedAt', 'generatedAt', 'inputs', 'selection']);
  assert.equal(evidence.version, 1); assert.equal(evidence.commit, COMMIT); assert.equal(evidence.month, MONTH);
  if (Object.hasOwn(evidence, 'publishedAt')) assert.equal(evidence.publishedAt, pinned.publishedAt);
  assert.ok(Array.isArray(evidence.sources) && evidence.sources.length === SITE_COUNTRY_CODES.length);
  const expected = new Map();
  for (const source of pinned.countrySources) {
    keys(source, ['code', 'path', 'compressedBytes', 'sha256', 'sourceRows', 'matchedRows']);
    assert.equal(source.path, 'data/country/' + source.code.toLowerCase() + '/' + MONTH + '.csv.gz');
    assert.match(source.sha256, /^[a-f0-9]{64}$/); assert.ok(Number.isSafeInteger(source.compressedBytes) && source.compressedBytes > 0 && source.compressedBytes <= 32 * 1024 * 1024);
    assert.ok(Number.isSafeInteger(source.sourceRows) && source.sourceRows > 0 && source.sourceRows <= 1500000);
    assert.ok(Number.isSafeInteger(source.matchedRows) && source.matchedRows >= 0 && source.matchedRows <= source.sourceRows);
    expected.set(source.code, source);
  }
  const seen = new Set();
  for (const source of evidence.sources) {
    keys(source, ['code', 'url', 'path', 'compressedBytes', 'sha256', 'sourceRows']);
    const reference = expected.get(source.code); assert.ok(reference && !seen.has(source.code), 'Unknown or duplicate CrUX source'); seen.add(source.code);
    assert.equal(source.url, 'https://raw.githubusercontent.com/InternetHealthReport/crux-top-lists-country/' + COMMIT + '/' + reference.path);
    assert.equal(source.path, 'crux-' + source.code + '.csv.gz'); assert.equal(source.sha256, reference.sha256);
    assert.equal(source.compressedBytes, reference.compressedBytes); assert.equal(source.sourceRows, reference.sourceRows);
  }
  keys(evidence.rows, [] , SITE_COUNTRY_CODES);
}

/**
 * Optional original base IDs make the protection explicit. Otherwise every site
 * with existing country metadata is protected. New rows receive only countries
 * where their precise packaged HTTPS origin occurs; www/HTTP never alias it.
 */
export function mergeTrackingCountryEvidence(value, evidence, pinned, options = {}) {
  jsonData(evidence); jsonData(pinned); keys(options, [], ['baseSiteIds']);
  assert.ok(Reflect.ownKeys(options).every(key => typeof key === 'string' && Object.getOwnPropertyDescriptor(options, key)?.enumerable && Object.hasOwn(Object.getOwnPropertyDescriptor(options, key), 'value')), 'CrUX options accessor');
  sourceMetadata(evidence, pinned);
  const data = validateAutosurfSitesData(value);
  assert.ok(data.sources.some(source => source.id === 'crux-country-202609' && source.license === 'CC-BY-4.0' && source.asOf === '2026-09' && source.url === 'https://github.com/InternetHealthReport/crux-top-lists-country/tree/' + COMMIT + '/data/country'), 'CrUX attribution missing');
  let suppliedIds = options.baseSiteIds;
  if (suppliedIds instanceof Set) { assert.equal(Object.getPrototypeOf(suppliedIds), Set.prototype); assert.equal(Reflect.ownKeys(suppliedIds).length, 0); suppliedIds = [...suppliedIds]; }
  if (suppliedIds !== undefined) { jsonData(suppliedIds); assert.ok(Array.isArray(suppliedIds) && suppliedIds.length <= 50000 && suppliedIds.every(id => typeof id === 'string') && new Set(suppliedIds).size === suppliedIds.length); }
  const byOrigin = new Map(data.sites.map(site => [site.origin, site]));
  const siteIds = new Set(data.sites.map(site => site.id));
  const protectedIds = new Set(suppliedIds ?? data.sites.filter(site => site.countries.length).map(site => site.id));
  assert.ok([...protectedIds].every(id => siteIds.has(id)), 'Unknown base site ID');
  const memberships = new Map(); let total = 0;
  for (const [country, rows] of Object.entries(evidence.rows)) {
    assert.ok(data.countries.includes(country), 'Country absent from shared catalogue'); assert.ok(Array.isArray(rows) && rows.length <= 50000);
    const seen = new Set();
    for (const row of rows) {
      assert.ok(++total <= 3000000 && Array.isArray(row) && row.length === 2);
      const [origin, bucket] = row; assert.equal(typeof origin, 'string'); assert.ok(!seen.has(origin), 'Duplicate origin-country evidence'); seen.add(origin);
      let url; try { url = new URL(origin); } catch { assert.fail('Invalid CrUX origin'); }
      assert.ok(url.protocol === 'https:' && url.origin === origin && !url.port && !url.username && !url.password, 'CrUX evidence requires an exact HTTPS root origin');
      assert.ok(url.hostname.length <= 253 && url.hostname.includes('.') && !/^[0-9.]+$/.test(url.hostname) && url.hostname.split('.').every(label => /^(?:[a-z0-9]|[a-z0-9][a-z0-9-]{0,61}[a-z0-9])$/.test(label)), 'CrUX evidence hostname');
      assert.ok(Number.isSafeInteger(bucket) && BUCKETS.has(bucket), 'Unsupported pinned CrUX bucket');
      const site = byOrigin.get(origin); if (!site) continue;
      if (protectedIds.has(site.id)) {
        assert.ok(site.countries.includes(country) && site.rankBuckets[country] === bucket, 'Existing site country metadata differs from pinned evidence');
        continue;
      }
      const ranks = memberships.get(site.id) ?? {}; ranks[country] = bucket; memberships.set(site.id, ranks);
    }
  }
  const sites = data.sites.map(site => {
    const ranks = memberships.get(site.id); if (!ranks) return site;
    const rankBuckets = { ...site.rankBuckets };
    for (const [country, bucket] of Object.entries(ranks)) { if (Object.hasOwn(rankBuckets, country)) assert.equal(rankBuckets[country], bucket, 'Conflicting country rank'); rankBuckets[country] = bucket; }
    const countries = data.countries.filter(country => Object.hasOwn(rankBuckets, country));
    return { ...site, countries, rankBuckets: Object.fromEntries(countries.map(country => [country, rankBuckets[country]])) };
  });
  // The shared validator creates an immutable independent copy and keeps unknown
  // topics unchanged. No inferred category or domain alias is introduced here.
  return validateAutosurfSitesData({ ...data, sites });
}
