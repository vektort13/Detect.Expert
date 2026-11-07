// ADR-077/078: exact CrUX evidence can annotate new catalogue rows, never a sibling origin.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { SITE_COUNTRY_CODES, searchAutosurfSites } from '../../apps/production-extension/autosurf-sites.js';
import { mergeTrackingCountryEvidence } from '../build-autosurf-tracking-countries.mjs';

const pinned = JSON.parse(readFileSync(new URL('../../packages/catalog/data/autosurf-sites.country-inputs.json', import.meta.url)));
const clone = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const evidence = { version: 1, commit: pinned.commit, month: pinned.month, publishedAt: pinned.publishedAt,
    sources: pinned.countrySources.map(source => ({ code: source.code, path: 'crux-' + source.code + '.csv.gz', url: 'https://raw.githubusercontent.com/InternetHealthReport/crux-top-lists-country/' + pinned.commit + '/' + source.path, compressedBytes: source.compressedBytes, sha256: source.sha256, sourceRows: source.sourceRows })),
    rows: { DE: [['https://new.example', 5000], ['https://old.example', 50000], ['https://www.alias.example', 10000]], FR: [['https://new.example', 50000]], US: [['https://ignored.example', 1000]] } };
  const data = { version: 1, revision: 'owned-tracking-countries', publishedAt: '2026-10-13', countries: [...SITE_COUNTRY_CODES], categories: ['news'], trackingSourceId: 'publisher', trackingSnapshotAt: '2026-10-30',
    sources: [{ id: 'crux-country-202609', title: 'Chrome UX Report (Google) · Internet Health Report', url: 'https://github.com/InternetHealthReport/crux-top-lists-country/tree/' + pinned.commit + '/data/country', license: 'CC-BY-4.0', asOf: '2026-09' },
      { id: 'publisher', title: 'Owned association fixture', url: 'https://publisher.test/catalog', license: 'Project-authored', asOf: '2026-10-30' }],
    trackingSystems: [{ id: 'forter', name: 'Forter', categories: ['fraud-prevention'], sourceUrl: 'https://publisher.test/forter' }],
    sites: [{ id: 'old.example', name: 'Existing authored name', origin: 'https://old.example', countries: ['DE'], categories: ['news'], rankBuckets: { DE: 50000 }, trackingSystems: [] },
      ...['new.example', 'alias.example', 'www.alias.example', 'unmatched.example'].map(host => ({ id: host, name: host, origin: 'https://' + host, countries: [], categories: [], rankBuckets: {}, trackingSystems: ['forter'] }))] };
  return { data, evidence };
}

test('new sites receive only exact HTTPS origin-country buckets and country×system filters become usable', () => {
  const { data, evidence } = fixture(), beforeData = clone(data), beforeEvidence = clone(evidence), beforePinned = clone(pinned);
  const result = mergeTrackingCountryEvidence(data, evidence, pinned), added = result.sites.find(site => site.id === 'new.example');
  assert.deepEqual(added.countries, ['DE', 'FR']); assert.deepEqual(added.rankBuckets, { DE: 5000, FR: 50000 }); assert.deepEqual(added.categories, []);
  assert.deepEqual(result.sites.find(site => site.id === 'old.example'), data.sites[0]);
  assert.deepEqual(result.sites.find(site => site.id === 'alias.example').countries, []);
  assert.deepEqual(result.sites.find(site => site.id === 'www.alias.example').countries, ['DE']);
  assert.deepEqual(result.sites.find(site => site.id === 'unmatched.example').countries, []);
  assert.equal(result.sites.some(site => site.id === 'ignored.example'), false);
  assert.equal(searchAutosurfSites(result, { country: 'FR', trackingSystem: 'forter' }).total, 1);
  assert.equal(searchAutosurfSites(result, { country: 'DE', trackingSystem: 'forter' }).total, 2);
  assert.deepEqual(data, beforeData); assert.deepEqual(evidence, beforeEvidence); assert.deepEqual(pinned, beforePinned);
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(added)); assert.ok(Object.isFrozen(added.rankBuckets));
});

test('explicit base IDs protect original metadata and repeated enrichment is deterministic and idempotent', () => {
  const { data, evidence } = fixture(), options = { baseSiteIds: new Set(['old.example']) };
  const first = mergeTrackingCountryEvidence(data, evidence, pinned, options), second = mergeTrackingCountryEvidence(first, evidence, pinned, options);
  assert.deepEqual(first, second); assert.equal(options.baseSiteIds.size, 1);
  assert.deepEqual(mergeTrackingCountryEvidence(data, evidence, pinned, { baseSiteIds: ['old.example'] }), first);
});

test('a country row for www cannot annotate its root or another subdomain and an absent origin cannot create a site', () => {
  const { data, evidence } = fixture(); evidence.rows = { DE: [['https://www.new.example', 5000], ['https://sub.new.example', 5000], ['https://other.example', 5000]] };
  const result = mergeTrackingCountryEvidence(data, evidence, pinned);
  assert.deepEqual(result.sites.find(site => site.id === 'new.example').countries, []); assert.equal(result.sites.length, data.sites.length);
});

test('existing country membership and buckets cannot be rewritten or expanded by an imported sidecar', () => {
  for (const change of [e => { e.rows.DE[1][1] = 5000; }, e => { e.rows.US.push(['https://old.example', 50000]); }]) {
    const { data, evidence } = fixture(); change(evidence); assert.throws(() => mergeTrackingCountryEvidence(data, evidence, pinned), Error);
    assert.deepEqual(data.sites[0].rankBuckets, { DE: 50000 }); assert.deepEqual(data.sites[0].countries, ['DE']);
  }
});

test('all 57 raw source hashes and the pinned commit, month, size, row count and URLs are checked', () => {
  for (const mutate of [e => { e.commit = '0'.repeat(40); }, e => { e.month = '202610'; }, e => { e.sources[0].sha256 = '0'.repeat(64); }, e => { e.sources[0].compressedBytes++; }, e => { e.sources[0].sourceRows--; }, e => { e.sources[0].url += '?KEY=PRIVATE'; }, e => { e.sources[0].path = '../outside.csv.gz'; }, e => { e.sources.pop(); }, e => { e.sources[1] = clone(e.sources[0]); }, e => { e.rows.XX = []; }]) {
    const { data, evidence } = fixture(); mutate(evidence); assert.throws(() => mergeTrackingCountryEvidence(data, evidence, pinned), Error);
  }
  const { data, evidence } = fixture(), invalidPinned = clone(pinned); invalidPinned.commit = '0'.repeat(40); assert.throws(() => mergeTrackingCountryEvidence(data, evidence, invalidPinned), Error);
});

test('HTTP, paths, ports, credentials, fragments, malformed hosts and unsupported buckets are rejected', () => {
  for (const origin of ['http://new.example', 'https://new.example/', 'https://new.example/path', 'https://new.example:8443', 'https://user@new.example', 'https://new.example?x=1', 'https://new.example#x', 'https://new..example', 'https://127.0.0.1']) {
    const { data, evidence } = fixture(); evidence.rows.DE = [[origin, 5000]]; assert.throws(() => mergeTrackingCountryEvidence(data, evidence, pinned), Error, origin);
  }
  for (const rank of [-1, 0, 1, 1234, 5000.5, '5000', null, 1000001]) {
    const { data, evidence } = fixture(); evidence.rows.DE[0][1] = rank; assert.throws(() => mergeTrackingCountryEvidence(data, evidence, pinned), Error, String(rank));
  }
  const { data, evidence } = fixture(); evidence.rows.DE.push(clone(evidence.rows.DE[0])); assert.throws(() => mergeTrackingCountryEvidence(data, evidence, pinned), Error);
});

test('accessors, inherited records, sparse arrays and unknown source fields are rejected before getters run', () => {
  let reads = 0;
  for (const mutate of [e => Object.defineProperty(e, 'rows', { enumerable: true, get() { reads++; return {}; } }), e => Object.defineProperty(e.sources[0], 'sha256', { enumerable: true, get() { reads++; return '0'.repeat(64); } }), e => Object.defineProperty(e.rows.DE[0], '0', { enumerable: true, get() { reads++; return 'https://new.example'; } })]) {
    const { data, evidence } = fixture(); mutate(evidence); assert.throws(() => mergeTrackingCountryEvidence(data, evidence, pinned), Error); assert.equal(reads, 0);
  }
  for (const mutate of [e => Object.setPrototypeOf(e, { inherited: true }), e => Object.setPrototypeOf(e.sources[0], { inherited: true }), e => { delete e.rows.DE[0]; }, e => { e.sources[0].extra = 'unknown'; }]) {
    const { data, evidence } = fixture(); mutate(evidence); assert.throws(() => mergeTrackingCountryEvidence(data, evidence, pinned), Error);
  }
  const { data, evidence } = fixture(), options = {}; Object.defineProperty(options, 'baseSiteIds', { enumerable: true, get() { reads++; return []; } });
  assert.throws(() => mergeTrackingCountryEvidence(data, evidence, pinned, options), Error); assert.equal(reads, 0);
});

test('CrUX licence attribution must remain present in the shared catalogue', () => {
  const { data, evidence } = fixture(); data.sources[0].license = 'Unknown'; assert.throws(() => mergeTrackingCountryEvidence(data, evidence, pinned), Error);
});
