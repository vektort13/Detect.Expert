// ADR-075: build-time-only, pinned public CrUX inputs; no extension network channel.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { mergeAutosurfTrackingSites } from './build-autosurf-tracking.mjs';
import { mergeTrackingCountryEvidence } from './build-autosurf-tracking-countries.mjs';

const root = resolve(import.meta.dirname, '..');
const seedPath = join(root, 'packages/catalog/data/autosurf-sites.seed.json');
const inputPath = join(root, 'packages/catalog/data/autosurf-sites.country-inputs.json');
const outputPath = join(root, 'apps/production-extension/autosurf-sites-data.js');
const research = join(root, 'test-results/site-picker-2026-10-30');
const COMMIT = '1db09887a9952d7f25abc480c6e1edc444a87673', MONTH = '202609', PUBLISHED = '2026-10-13';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const hostname = value => typeof value === 'string' && value.length <= 253 && value.includes('.') && value.split('.').every(part => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part));
function curatedSeed(seed) {
  assert.equal(seed.version, 1); const countries = seed.countries.split(' '), categories = Object.keys(seed.categories), sites = new Map();
  assert.equal(countries.length, 57); assert.equal(new Set(countries).size, countries.length); assert.ok(countries.every(code => /^[A-Z]{2}$/.test(code)));
  assert.equal(categories.length, 20);
  for (const [category, rows] of Object.entries(seed.categories)) {
    assert.ok(/^[a-z]+(?:-[a-z]+)*$/.test(category)); assert.ok(Array.isArray(rows) && rows.length > 0 && rows.length <= 200);
    for (const row of rows) {
      assert.equal(typeof row, 'string'); const parts = row.split('|'); assert.equal(parts.length, 2);
      const [domain, name] = parts; assert.ok(hostname(domain) && domain === domain.toLowerCase());
      assert.ok(name.length > 0 && name.length <= 120 && !/[<>\u0000-\u001f]/.test(name));
      const site = sites.get(domain) ?? { domain, name, categories: [] }; assert.equal(site.name, name, 'Conflicting authored name: ' + domain);
      if (!site.categories.includes(category)) site.categories.push(category); sites.set(domain, site);
    }
  }
  assert.ok(sites.size >= 250 && sites.size <= 2000);
  const hosts = new Map();
  for (const site of sites.values()) for (const host of [site.domain, 'www.' + site.domain]) {
    assert.ok(!hosts.has(host) || hosts.get(host) === site.domain, 'Ambiguous curated host'); hosts.set(host, site.domain);
  }
  return { countries, categories, sites, hosts };
}
function eligibleRow(origin, rank, curated) {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password || url.port || !hostname(url.hostname) || !curated.hosts.has(url.hostname)) return null;
    if (!Number.isSafeInteger(rank) || rank < 1 || rank > 1000000) return null;
    return [origin, rank];
  } catch { return null; }
}
async function boundedDownload(url) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', headers: { 'User-Agent': 'DetectExpert-catalog-builder/1.0' } });
    assert.equal(response.status, 200, 'Pinned source download failed');
    const limit = 32 * 1024 * 1024, declared = response.headers.get('content-length');
    if (declared !== null) assert.ok(Number(declared) <= limit, 'Source compressed size exceeds limit');
    const reader = response.body.getReader(), chunks = []; let size = 0, reads = 0;
    try { while (true) { assert.ok(++reads <= 65536, 'Source read count exceeded'); const { value, done } = await reader.read(); if (done) break; size += value.byteLength; assert.ok(size <= limit, 'Source compressed size exceeds limit'); chunks.push(Buffer.from(value)); } }
    finally { reader.releaseLock(); }
    return Buffer.concat(chunks, size);
  } finally { clearTimeout(timer); }
}
async function refresh(curated, seedHash) {
  const rows = new Map(), countries = []; let next = 0;
  async function worker() {
    while (next < curated.countries.length) {
      const country = curated.countries[next++], path = `data/country/${country.toLowerCase()}/${MONTH}.csv.gz`;
      const url = 'https://raw.githubusercontent.com/InternetHealthReport/crux-top-lists-country/' + COMMIT + '/' + path;
      const bytes = await boundedDownload(url), raw = gunzipSync(bytes, { maxOutputLength: 64 * 1024 * 1024 }).toString('utf8'), lines = raw.trim().split(/\r?\n/);
      assert.equal(lines.shift(), 'origin,rank', 'Unexpected public CSV header'); const matched = [];
      for (const line of lines) {
        const fields = line.split(','); assert.equal(fields.length, 2, 'Unexpected public CSV row');
        const row = eligibleRow(fields[0], Number(fields[1]), curated); if (row) matched.push(row);
      }
      matched.sort((a, b) => a[0].localeCompare(b[0], 'en'));
      assert.ok(matched.length > 0, 'No curated origin in country ' + country);
      rows.set(country, matched); countries.push({ code: country, path, compressedBytes: bytes.length, sha256: hash(bytes), sourceRows: lines.length, matchedRows: matched.length });
      console.log('source ' + country + ': ' + matched.length + ' curated HTTPS origins');
    }
  }
  await Promise.all([worker(), worker()]);
  const input = { version: 1, commit: COMMIT, month: MONTH, publishedAt: PUBLISHED, seedSha256: seedHash, countrySources: curated.countries.map(country => countries.find(row => row.code === country)), rows: Object.fromEntries(curated.countries.map(country => [country, rows.get(country)])) };
  writeFileSync(inputPath, JSON.stringify(input, null, 2) + '\n'); return input;
}
export function assembleAutosurfSites(seed, input) {
  const curated = curatedSeed(seed), seedHash = hash(Buffer.from(JSON.stringify(seed)));
  assert.equal(input.version, 1); assert.equal(input.commit, COMMIT); assert.equal(input.month, MONTH); assert.equal(input.seedSha256, seedHash, 'Curation changed: refresh pinned source inputs');
  assert.deepEqual(Object.keys(input.rows), curated.countries); assert.equal(input.countrySources.length, curated.countries.length);
  const origins = new Map(), byDomain = new Map();
  for (const country of curated.countries) {
    const meta = input.countrySources.find(row => row.code === country);
    assert.ok(meta && /^[a-f0-9]{64}$/.test(meta.sha256) && meta.path === `data/country/${country.toLowerCase()}/${MONTH}.csv.gz`);
    assert.equal(meta.matchedRows, input.rows[country].length); const seen = new Set();
    for (const raw of input.rows[country]) {
      assert.ok(Array.isArray(raw) && raw.length === 2); const row = eligibleRow(raw[0], raw[1], curated); assert.ok(row, 'Invalid vendored filtered row');
      const [origin, rank] = row; assert.ok(!seen.has(origin)); seen.add(origin);
      const url = new URL(origin), domain = curated.hosts.get(url.hostname), item = origins.get(origin) ?? { origin, domain, countries: [], rankBuckets: {} };
      item.countries.push(country); item.rankBuckets[country] = rank; origins.set(origin, item);
      if (!byDomain.has(domain)) byDomain.set(domain, new Set()); byDomain.get(domain).add(origin);
    }
  }
  const sites = [];
  for (const [domain, alternatives] of byDomain) {
    // Choose an observed origin, then retain ONLY countries where that exact
    // origin occurs. A www alias never manufactures country membership.
    const candidates = [...alternatives].map(origin => origins.get(origin));
    candidates.sort((a, b) => b.countries.length - a.countries.length || Math.min(...Object.values(a.rankBuckets)) - Math.min(...Object.values(b.rankBuckets)) || a.origin.localeCompare(b.origin, 'en'));
    const item = candidates[0], authored = curated.sites.get(domain);
    sites.push({ id: new URL(item.origin).hostname, name: authored.name, origin: item.origin, countries: item.countries, categories: authored.categories, rankBuckets: item.rankBuckets });
  }
  sites.sort((a, b) => a.id.localeCompare(b.id, 'en')); assert.ok(sites.length >= 250 && sites.length <= 2000);
  assert.equal(new Set(sites.map(row => row.id)).size, sites.length);
  const data = { version: 1, revision: 'crux-202609-curation-v1', publishedAt: PUBLISHED, countries: curated.countries, categories: curated.categories,
    sources: [{ id: 'crux-country-202609', title: 'Chrome UX Report (Google) · Internet Health Report', url: 'https://github.com/InternetHealthReport/crux-top-lists-country/tree/' + COMMIT + '/data/country', license: 'CC-BY-4.0', asOf: '2026-09' }], sites };
  return { data, summary: { curatedDomains: curated.sites.size, packagedSites: sites.length, countryMemberships: sites.reduce((n, site) => n + site.countries.length, 0), countsByCountry: Object.fromEntries(curated.countries.map(country => [country, sites.filter(row => row.countries.includes(country)).length])), countsByCategory: Object.fromEntries(curated.categories.map(category => [category, sites.filter(row => row.categories.includes(category)).length])), rankBuckets: [...new Set(sites.flatMap(row => Object.values(row.rankBuckets)))].sort((a, b) => a - b), omittedCuratedDomains: [...curated.sites.keys()].filter(domain => !byDomain.has(domain)).sort() } };
}
async function main() {
  assert.ok(!(process.argv.includes('--check') && process.argv.includes('--refresh')), 'Check must not refresh network inputs');
  const seed = read(seedPath), curated = curatedSeed(seed), seedHash = hash(Buffer.from(JSON.stringify(seed)));
  const input = process.argv.includes('--refresh') ? await refresh(curated, seedHash) : read(inputPath);
  const { data: base, summary } = assembleAutosurfSites(seed, input);
  const trackingPath = join(root, 'packages/catalog/data/autosurf-sites.tracking-inputs.json');
  const tracking = existsSync(trackingPath) ? read(trackingPath) : null;
  const trackingCountriesPath = join(root, 'packages/catalog/data/autosurf-sites.tracking-country-inputs.json');
  const trackingCountries = existsSync(trackingCountriesPath) ? read(trackingCountriesPath) : null;
  const merged = mergeAutosurfTrackingSites(base, tracking);
  const data = trackingCountries ? mergeTrackingCountryEvidence(merged, trackingCountries, input, { baseSiteIds: base.sites.map(site => site.id) }) : merged;
  const source = '// ADR-075: bundled, dated CrUX country origins with project-authored categories.\n// Derived from Google CrUX via Internet Health Report, CC-BY-4.0; see docs/data/autosurf-sites.md.\nexport const AUTOSURF_SITES_DATA = ' + JSON.stringify(data) + ';\n';
  if (process.argv.includes('--check')) assert.equal(readFileSync(outputPath, 'utf8'), source, 'Packaged catalog differs from vendored inputs');
  else writeFileSync(outputPath, source);
  const result = { at: new Date().toISOString(), sourceCommit: COMMIT, collectionMonth: '2026-09', publishedAt: PUBLISHED, seedSha256: hash(readFileSync(seedPath)), inputsSha256: hash(readFileSync(inputPath)), moduleSha256: hash(Buffer.from(source)), moduleBytes: Buffer.byteLength(source), ...summary,
    packagedSites: data.sites.length, trackingSystems: data.trackingSystems?.length ?? 0,
    trackingMemberships: data.sites.reduce((n, site) => n + (site.trackingSystems?.length ?? 0), 0),
    trackingInputsSha256: tracking ? hash(readFileSync(trackingPath)) : null,
    trackingCountryInputsSha256: trackingCountries ? hash(readFileSync(trackingCountriesPath)) : null,
    countryMemberships: data.sites.reduce((n,site) => n + site.countries.length,0),
    countsByCountry: Object.fromEntries(data.countries.map(country => [country,data.sites.filter(site=>site.countries.includes(country)).length])) };
  if (!process.argv.includes('--check')) { const destination = tracking ? join(root,'test-results/site-catalogue-2026-10-30') : research; mkdirSync(destination, { recursive: true }); writeFileSync(join(destination, 'catalog-build.json'), JSON.stringify(result, null, 2) + '\n'); }
  console.log(JSON.stringify({ result: 'PASS', mode: process.argv.includes('--check') ? 'check' : 'build', ...result, omittedCuratedDomains: summary.omittedCuratedDomains.length }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
