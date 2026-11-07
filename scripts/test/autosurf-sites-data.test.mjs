import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { assembleAutosurfSites } from '../build-autosurf-sites.mjs';
import { mergeAutosurfTrackingSites } from '../build-autosurf-tracking.mjs';
import { mergeTrackingCountryEvidence } from '../build-autosurf-tracking-countries.mjs';
import { AUTOSURF_SITES_DATA } from '../../apps/production-extension/autosurf-sites-data.js';

const seed = JSON.parse(readFileSync(new URL('../../packages/catalog/data/autosurf-sites.seed.json', import.meta.url), 'utf8'));
const input = JSON.parse(readFileSync(new URL('../../packages/catalog/data/autosurf-sites.country-inputs.json', import.meta.url), 'utf8'));
const clone = value => structuredClone(value);

test('packaged catalog reconstructs exactly from pinned, vendored source rows', () => {
  const first = assembleAutosurfSites(seed, input), second = assembleAutosurfSites(clone(seed), clone(input));
  let tracking = null;
  try { tracking = JSON.parse(readFileSync(new URL('../../packages/catalog/data/autosurf-sites.tracking-inputs.json', import.meta.url), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let countryEvidence = null;
  try { countryEvidence = JSON.parse(readFileSync(new URL('../../packages/catalog/data/autosurf-sites.tracking-country-inputs.json', import.meta.url),'utf8')); } catch(error) { if(error.code !== 'ENOENT') throw error; }
  const merged = mergeAutosurfTrackingSites(first.data, tracking);
  assert.deepEqual(countryEvidence ? mergeTrackingCountryEvidence(merged,countryEvidence,input,{baseSiteIds:first.data.sites.map(site=>site.id)}) : merged, AUTOSURF_SITES_DATA); assert.deepEqual(second, first);
  assert.equal(first.data.countries.length, 57); assert.equal(first.data.categories.length, 20);
  assert.ok(first.data.sites.length >= 250);
  assert.ok(Object.values(first.summary.countsByCategory).every(count => count > 0));
  assert.ok(Object.values(first.summary.countsByCountry).every(count => count > 0));
});

test('every packaged origin-country bucket is present verbatim in that country input', () => {
  const rows = Object.fromEntries(Object.entries(input.rows).map(([country, values]) => [country, new Map(values)]));
  try {
    const extra = JSON.parse(readFileSync(new URL('../../packages/catalog/data/autosurf-sites.tracking-country-inputs.json', import.meta.url),'utf8'));
    for(const [country,values] of Object.entries(extra.rows)) for(const [origin,bucket] of values) {
      if(rows[country].has(origin)) assert.equal(rows[country].get(origin),bucket);
      rows[country].set(origin,bucket);
    }
  } catch(error) { if(error.code !== 'ENOENT') throw error; }
  for (const site of AUTOSURF_SITES_DATA.sites) {
    assert.equal(new URL(site.origin).origin, site.origin); assert.equal(new URL(site.origin).protocol, 'https:');
    assert.equal(site.id, new URL(site.origin).hostname);
    assert.deepEqual(Object.keys(site.rankBuckets), site.countries);
    for (const country of site.countries) assert.equal(rows[country].get(site.origin), site.rankBuckets[country], site.id + ' ' + country);
  }
  const buckets = new Set(AUTOSURF_SITES_DATA.sites.flatMap(site => Object.values(site.rankBuckets)));
  assert.ok(buckets.has(5000) && buckets.has(50000), 'Intermediate actual buckets must not be rounded into an invented rank');
});

test('an observed www alias never transfers its country membership to the selected origin', () => {
  const modified = clone(input), origin = 'https://www.bbc.com', alias = 'https://bbc.com', country = 'ME';
  assert.ok(modified.rows.DE.some(row => row[0] === origin));
  modified.rows[country] = modified.rows[country].filter(row => row[0] !== origin && row[0] !== alias);
  modified.rows[country].push([alias, 1000]);
  modified.countrySources.find(row => row.code === country).matchedRows = modified.rows[country].length;
  const { data } = assembleAutosurfSites(seed, modified), site = data.sites.find(row => row.id === 'www.bbc.com');
  assert.ok(site); assert.ok(!site.countries.includes(country)); assert.ok(!Object.hasOwn(site.rankBuckets, country));
});

test('vendored rows cannot introduce credentials, parameters, non-root paths or an unknown host', () => {
  for (const origin of ['http://www.bbc.com', 'https://user:secret@www.bbc.com', 'https://www.bbc.com/?secret=x', 'https://www.bbc.com/#x', 'https://www.bbc.com/news', 'https://www.bbc.com.evil.test', 'https://127.0.0.1']) {
    const modified = clone(input); modified.rows.ME.push([origin, 1000]); modified.countrySources.find(row => row.code === 'ME').matchedRows++;
    assert.throws(() => assembleAutosurfSites(seed, modified), /Invalid vendored filtered row/);
  }
});

test('changed curation cannot silently reuse a filtered input set produced for a different seed', () => {
  const changed = clone(seed); changed.categories.news.push('newly-authored.example|New entry');
  assert.throws(() => assembleAutosurfSites(changed, input), /Curation changed/);
  const wrongCommit = clone(input); wrongCommit.commit = 'f'.repeat(40); assert.throws(() => assembleAutosurfSites(seed, wrongCommit));
});

test('reviewed subject exceptions keep property, product and utility sites in their actual topics', () => {
  const find = domain => AUTOSURF_SITES_DATA.sites.find(site => site.id.replace(/^www\./, '') === domain && site.categories.length > 0);
  assert.deepEqual(find('591.com.tw').categories, ['real-estate']);
  assert.deepEqual(find('discourse.org').categories, ['technology']);
  for (const domain of ['speedtest.net', 'isitdownrightnow.com', 'downdetector.com']) assert.deepEqual(find(domain).categories, ['technology']);
  assert.deepEqual(find('mondo.rs').categories, ['news']);
  assert.ok(find('tarladalal.com').categories.includes('food'));
  assert.ok(!AUTOSURF_SITES_DATA.sites.some(site => site.id.replace(/^www\./, '') === 'tarla-dalal.com'));
  assert.equal(find('cambridge.org').name, 'Cambridge University Press & Assessment');
  assert.ok(find('cambridge.org').categories.includes('education') && find('cambridge.org').categories.includes('reference'));
});
