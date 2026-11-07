// ADR-078: one exact-origin site database; importing technology lists cannot invent country or runtime evidence.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeAutosurfTrackingSites } from '../build-autosurf-tracking.mjs';
import { validateAutosurfSitesData, searchAutosurfSites } from '../../apps/production-extension/autosurf-sites.js';
import { lookupAutosurfSiteSystems } from '../../apps/production-extension/autosurf-site-systems.js';

const clone = value => JSON.parse(JSON.stringify(value));
function base() {
  return { version: 1, revision: 'base', publishedAt: '2026-10-13', countries: ['US', 'FR'], categories: ['news', 'shopping'],
    sources: [{ id: 'crux', title: 'CrUX', url: 'https://source.test/crux', license: 'CC-BY-4.0', asOf: '2026-09' }],
    sites: [{ id: 'existing.example', name: 'Authored existing name', origin: 'https://existing.example', countries: ['US', 'FR'], categories: ['news', 'shopping'], rankBuckets: { US: 1000, FR: 5000 } },
      { id: 'unrelated.example', name: 'Unrelated', origin: 'https://unrelated.example', countries: ['FR'], categories: ['news'], rankBuckets: { FR: 1000 } }] };
}
function input() {
  return { version: 1, snapshotAt: '2026-10-30', source: { id: 'publisher', title: 'Owned publisher source', url: 'https://publisher.test/catalog', license: 'Project-authored', asOf: '2026-10-30' },
    systems: [{ id: 'forter', name: 'Forter', categories: ['fraud-prevention'], sourceUrl: 'https://publisher.test/forter' },
      { id: 'other-system', name: 'Other System', categories: ['bot-management'], sourceUrl: 'https://publisher.test/other' }],
    sites: [{ host: 'existing.example', systems: ['forter'] }, { host: 'new.example', systems: ['other-system', 'forter'] }] };
}

test('offline tracking merge preserves existing authored metadata and only adds exact-host associations', () => {
  const beforeBase = base(), beforeInput = input(), b = clone(beforeBase), i = clone(beforeInput), data = mergeAutosurfTrackingSites(b, i);
  assert.deepEqual(b, beforeBase); assert.deepEqual(i, beforeInput); assert.equal(data.sites.length, 3);
  const old = data.sites.find(site => site.id === 'existing.example'), added = data.sites.find(site => site.id === 'new.example');
  assert.deepEqual(old, { ...b.sites[0], trackingSystems: ['forter'] }); assert.deepEqual(data.sites.find(site => site.id === 'unrelated.example'), b.sites[1]);
  assert.deepEqual(added, { id: 'new.example', name: 'new.example', origin: 'https://new.example', countries: [], categories: [], rankBuckets: {}, trackingSystems: ['forter', 'other-system'] });
  const checked = validateAutosurfSitesData(data); assert.equal(checked.trackingSourceId, 'publisher'); assert.equal(checked.trackingSnapshotAt, '2026-10-30');
  assert.equal(searchAutosurfSites(checked, { trackingSystem: 'forter' }).total, 2);
  assert.equal(searchAutosurfSites(checked, { country: 'FR', trackingSystem: 'forter' }).total, 1);
  assert.equal(lookupAutosurfSiteSystems(checked, 'new.example').source.title, 'Owned publisher source');
});

test('root and www names remain separate and new associations never inherit CrUX countries or topics', () => {
  const i = input(); i.sites = [{ host: 'www.existing.example', systems: ['other-system'] }];
  const data = mergeAutosurfTrackingSites(base(), i), root = data.sites.find(site => site.id === 'existing.example'), www = data.sites.find(site => site.id === 'www.existing.example');
  assert.equal(root.trackingSystems, undefined); assert.deepEqual(www.countries, []); assert.deepEqual(www.categories, []); assert.deepEqual(www.rankBuckets, {});
  assert.equal(searchAutosurfSites(data, { country: 'US', trackingSystem: 'other-system' }).total, 0);
  assert.equal(lookupAutosurfSiteSystems(data, 'existing.example'), null); assert.equal(lookupAutosurfSiteSystems(data, 'www.existing.example').systems[0].id, 'other-system');
});

test('missing tracking input preserves the original catalogue and repeated builds are deterministic', () => {
  const b = base(); assert.equal(mergeAutosurfTrackingSites(b, null), b);
  assert.deepEqual(mergeAutosurfTrackingSites(base(), input()), mergeAutosurfTrackingSites(base(), input()));
});

test('invalid or noncanonical hosts cannot become stored domains', () => {
  for (const host of ['https://new.example', 'new.example/path', 'new.example?KEY=PRIVATE', 'new.example#fragment', 'new.example:443', 'user@new.example', 'NEW.EXAMPLE', 'new.example.', '127.0.0.1', 'localhost', '[::1]', '-new.example', 'new..example', 'new%2eexample', 'new.example\n', '__proto__', 'a'.repeat(254) + '.com']) {
    const i = input(); i.sites = [{ host, systems: ['forter'] }]; assert.throws(() => mergeAutosurfTrackingSites(base(), i), Error, host);
  }
});

test('duplicate customer hosts, duplicate systems, unknown references and invalid dates fail atomically', () => {
  for (const mutate of [i => i.sites.push(clone(i.sites[0])), i => i.systems.push(clone(i.systems[0])), i => { i.sites[0].systems = ['forter', 'forter']; }, i => { i.sites[0].systems = ['missing']; }, i => { i.sites[0].systems = []; }, i => { i.snapshotAt = '2026-02-30'; }, i => { i.snapshotAt = '2026-10'; }, i => { i.source.asOf = '2026-02-30'; }, i => { i.source.id = 'crux'; }, i => { i.sites[0].extra = 'unknown'; }]) {
    const i = input(), b = base(), before = clone(b); mutate(i); assert.throws(() => mergeAutosurfTrackingSites(b, i), Error); assert.deepEqual(b, before);
  }
});

test('source metadata cannot ship API credentials, fragments, insecure or executable source URLs', () => {
  for (const url of ['https://publisher.test/catalog?KEY=PRIVATE', 'https://publisher.test/catalog#PRIVATE', 'http://publisher.test/catalog', 'https://user:PRIVATE@publisher.test/catalog', 'javascript:alert(1)']) {
    for (const slot of ['source', 'system']) { const i = input(); if (slot === 'source') i.source.url = url; else i.systems[0].sourceUrl = url; assert.throws(() => mergeAutosurfTrackingSites(base(), i), Error, slot + ': ' + url); }
  }
});

test('plain records and dense arrays are required before any getter, coercion or inherited input is consumed', () => {
  let reads = 0;
  for (const poison of [i => { Object.defineProperty(i, 'systems', { enumerable: true, get() { reads++; return []; } }); },
    i => { Object.defineProperty(i.source, 'id', { enumerable: true, get() { reads++; return 'publisher'; } }); },
    i => { Object.defineProperty(i.sites[0], 'host', { enumerable: true, get() { reads++; return 'existing.example'; } }); },
    i => { Object.defineProperty(i.systems[0], 'id', { enumerable: true, get() { reads++; return 'forter'; } }); }]) {
    const i = input(); poison(i); assert.throws(() => mergeAutosurfTrackingSites(base(), i), Error); assert.equal(reads, 0);
  }
  for (const mutate of [i => Object.setPrototypeOf(i, { token: 'PRIVATE' }), i => Object.setPrototypeOf(i.source, { inherited: true }), i => Object.setPrototypeOf(i.sites[0], { inherited: true }), i => { i.token = 'PRIVATE'; }, i => { delete i.sites[0]; }, i => { i.sites.extra = true; }]) {
    const i = input(); mutate(i); assert.throws(() => mergeAutosurfTrackingSites(base(), i), Error);
  }
});
