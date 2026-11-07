// ADR-075: bounded local site discovery; selection only prepares the existing URL draft.
import { AUTOSURF_LIMITS, AUTOSURF_DEFAULT_CONFIGURATION, autosurfRecord, validateAutosurfConfiguration, validateAutosurfUrl } from './autosurf-shared.js';

export const SITE_CATEGORY_IDS = Object.freeze(['news', 'automotive', 'gaming', 'shopping', 'classifieds', 'finance', 'government', 'education', 'sports', 'travel', 'real-estate', 'jobs', 'video', 'music', 'health', 'food', 'technology', 'forums', 'weather', 'reference']);
export const SITE_TRACKING_CATEGORY_IDS = Object.freeze(['fraud-prevention', 'bot-management', 'ecommerce-intelligence', 'device-fingerprinting', 'bot-detection', 'captcha']);
export const SITE_COUNTRY_CODES = Object.freeze(['DE', 'FR', 'IT', 'ES', 'PT', 'NL', 'BE', 'CH', 'AT', 'IE', 'GB', 'SE', 'NO', 'DK', 'FI', 'PL', 'CZ', 'SK', 'HU', 'RO', 'BG', 'GR', 'HR', 'SI', 'RS', 'BA', 'ME', 'UA', 'RU', 'TR', 'KZ', 'IL', 'AE', 'SA', 'IN', 'PK', 'ID', 'VN', 'TH', 'PH', 'MY', 'SG', 'JP', 'KR', 'TW', 'US', 'CA', 'MX', 'BR', 'AR', 'CL', 'CO', 'EG', 'NG', 'ZA', 'AU', 'NZ']);
export const SITE_LIMITS = Object.freeze({ rows: 50000, trackingSystems: 500, systemsPerSite: 64, query: 120, page: 24 });

const catalogs = new WeakMap(), indexes = new WeakMap();
const trackingCategoryBits = new Map(SITE_TRACKING_CATEGORY_IDS.map((id, index) => [id, 1 << index]));
const fail = () => { throw new TypeError('invalid-autosurf-sites-data'); };
const optional = (value, fields, extras) => autosurfRecord(value) && fields.every(field => Object.hasOwn(value, field)) && Object.keys(value).every(field => fields.includes(field) || extras.includes(field));
const string = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value);
const dense = (value, max) => Array.isArray(value) && value.length <= max && Reflect.ownKeys(value).length === value.length + 1 && Array.from({ length: value.length }, (_, index) => Object.getOwnPropertyDescriptor(value, String(index))).every(field => field?.enumerable && Object.hasOwn(field, 'value'));
const stamp = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}(?:-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?)?$/.test(value)) return false;
  const parsed = Date.parse(value.length === 7 ? value + '-01' : value);
  return Number.isFinite(parsed) && (value.length === 7 ? new Date(parsed).toISOString().startsWith(value + '-') : new Date(parsed).toISOString().startsWith(value.slice(0, 10)));
};
const fold = value => value.normalize('NFKD').replace(/\p{Mark}/gu, '').toLowerCase();
function rootOrigin(value) {
  if (!string(value, 512)) fail();
  const canonical = validateAutosurfUrl(value), url = new URL(canonical);
  if (url.protocol !== 'https:' || url.port || url.pathname !== '/' || url.search || url.hash || url.hostname.length > 253 || !url.hostname.includes('.') || /^[0-9.]+$/.test(url.hostname) || !url.hostname.split('.').every(label => /^(?:[a-z0-9]|[a-z0-9][a-z0-9-]{0,61}[a-z0-9])$/.test(label))) fail();
  return url.origin;
}
function identifiers(value, available, max, empty = false) {
  if (!dense(value, max) || !empty && !value.length || value.some(item => typeof item !== 'string' || !available.has(item)) || new Set(value).size !== value.length) fail();
  return Object.freeze([...value]);
}

/** Returns a frozen, validated copy; a subsequently modified input cannot alter the index. */
export function validateAutosurfSitesData(value) {
  if (value && typeof value === 'object' && catalogs.has(value)) return catalogs.get(value);
  if (!optional(value, ['version', 'revision', 'publishedAt', 'countries', 'categories', 'sources', 'sites'], ['trackingSystems', 'trackingSourceId', 'trackingSnapshotAt']) || value.version !== 1 || !string(value.revision, 96) || !/^[A-Za-z0-9._-]+$/.test(value.revision) || !stamp(value.publishedAt)) fail();
  const countries = identifiers(value.countries, new Set(SITE_COUNTRY_CODES), SITE_COUNTRY_CODES.length);
  const categories = identifiers(value.categories, new Set(SITE_CATEGORY_IDS), SITE_CATEGORY_IDS.length);
  if (!dense(value.sources, 16) || !value.sources.length || !dense(value.sites, SITE_LIMITS.rows)) fail();
  const sourceIds = new Set(), siteIds = new Set(), origins = new Set(), countrySet = new Set(countries), categorySet = new Set(categories), systemIds = new Set();
  const rawSystems = Object.hasOwn(value, 'trackingSystems') ? value.trackingSystems : [];
  if (!dense(rawSystems, SITE_LIMITS.trackingSystems)) fail();
  const trackingSystems = rawSystems.map(system => {
    if (!optional(system, ['id', 'name', 'categories'], ['sourceUrl']) || !string(system.id, 96) || system.id === 'all' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(system.id) || systemIds.has(system.id) || !string(system.name, 160) || /[<>]/.test(system.name) || !/[\p{Letter}\p{Number}]/u.test(system.name) || !dense(system.categories, 16) || !system.categories.length || new Set(system.categories).size !== system.categories.length || system.categories.some(id => !string(id, 64) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))) fail();
    let sourceUrl;
    if (Object.hasOwn(system, 'sourceUrl')) {
      const url = new URL(validateAutosurfUrl(system.sourceUrl));
      if (url.protocol !== 'https:' || url.search || url.hash) fail();
      sourceUrl = url.href;
    }
    systemIds.add(system.id);
    return Object.freeze({ id: system.id, name: system.name, categories: Object.freeze([...system.categories]), ...(sourceUrl ? { sourceUrl } : {}) });
  });
  const sources = value.sources.map(source => {
    if (!optional(source, ['id', 'title', 'license', 'asOf'], ['url']) || !string(source.id, 64) || !/^[a-z0-9-]+$/.test(source.id) || sourceIds.has(source.id) || !string(source.title, 200) || !string(source.license, 64) || !stamp(source.asOf)) fail();
    let sourceUrl;
    if (Object.hasOwn(source, 'url')) {
      const url = new URL(validateAutosurfUrl(source.url));
      if (url.protocol !== 'https:' || source.url.length > 2048) fail();
      sourceUrl = url.href;
    }
    sourceIds.add(source.id);
    return Object.freeze({ id: source.id, title: source.title, ...(sourceUrl ? { url: sourceUrl } : {}), license: source.license, asOf: source.asOf });
  });
  const hasTrackingSource = Object.hasOwn(value, 'trackingSourceId'), hasTrackingDate = Object.hasOwn(value, 'trackingSnapshotAt');
  if (hasTrackingSource !== hasTrackingDate || hasTrackingSource && (!sourceIds.has(value.trackingSourceId) || !stamp(value.trackingSnapshotAt) || !/^\d{4}-\d{2}-\d{2}$/.test(value.trackingSnapshotAt))) fail();
  if (hasTrackingSource) {
    const source = sources.find(source => source.id === value.trackingSourceId);
    if (Object.hasOwn(source, 'url')) {
      const url = new URL(source.url);
      if (url.search || url.hash) fail();
    }
  }
  const sites = value.sites.map(site => {
    if (!optional(site, ['id', 'name', 'origin', 'countries', 'categories', 'rankBuckets'], ['trackingSystems']) || !string(site.id, 253) || !string(site.name, 160) || /[<>]/.test(site.name)) fail();
    const origin = rootOrigin(site.origin), hostname = new URL(origin).hostname;
    if (site.id !== hostname || siteIds.has(site.id) || origins.has(origin)) fail();
    const rowSystems = identifiers(Object.hasOwn(site, 'trackingSystems') ? site.trackingSystems : [], systemIds, SITE_LIMITS.systemsPerSite, true);
    const rowCountries = identifiers(site.countries, countrySet, countries.length, rowSystems.length > 0), rowCategories = identifiers(site.categories, categorySet, categories.length, rowSystems.length > 0);
    if (!autosurfRecord(site.rankBuckets) || Object.keys(site.rankBuckets).length !== rowCountries.length) fail();
    const rankBuckets = {};
    for (const country of rowCountries) {
      const bucket = site.rankBuckets[country];
      if (!Object.hasOwn(site.rankBuckets, country) || !Number.isSafeInteger(bucket) || bucket < 1 || bucket > 1000000000) fail();
      rankBuckets[country] = bucket;
    }
    siteIds.add(site.id); origins.add(origin);
    return Object.freeze({ id: site.id, name: site.name, origin, countries: rowCountries, categories: rowCategories, rankBuckets: Object.freeze(rankBuckets), trackingSystems: rowSystems });
  });
  const checked = Object.freeze({ version: 1, revision: value.revision, publishedAt: value.publishedAt, countries, categories, sources: Object.freeze(sources), trackingSystems: Object.freeze(trackingSystems), ...(hasTrackingSource ? { trackingSourceId: value.trackingSourceId, trackingSnapshotAt: value.trackingSnapshotAt } : {}), sites: Object.freeze(sites) });
  catalogs.set(value, checked); catalogs.set(checked, checked);
  // ADR-078: cache category unions once; a site counts once even with several matching systems.
  const systemCategories = new Map(trackingSystems.map(system => [system.id, system.categories.reduce((mask, id) => mask | (trackingCategoryBits.get(id) || 0), 0)]));
  const siteTrackingCategories = Uint8Array.from(sites, site => site.trackingSystems.reduce((mask, id) => mask | systemCategories.get(id), 0));
  indexes.set(checked, { texts: sites.map(site => fold([site.name, site.origin, ...site.countries, ...site.categories].join(' '))), names: new Map(sites.map(site => [site.id, fold(site.name)])), systemCategories, siteTrackingCategories });
  return checked;
}

/** Facets apply the text query and the other facet, rather than hiding alternatives. */
export function searchAutosurfSites(value, { query = '', country = 'all', category = 'all', trackingSystem = 'all', trackingSystems = [], trackingCategory = 'all', offset = 0, limit = SITE_LIMITS.page } = {}) {
  const data = validateAutosurfSitesData(value), indexData = indexes.get(data);
  if (typeof query !== 'string' || typeof country !== 'string' || typeof category !== 'string' || typeof trackingSystem !== 'string' || typeof trackingCategory !== 'string' || country !== 'all' && !data.countries.includes(country) || category !== 'all' && !data.categories.includes(category) || trackingSystem !== 'all' && !data.trackingSystems.some(system => system.id === trackingSystem) || trackingCategory !== 'all' && !trackingCategoryBits.has(trackingCategory) || !Number.isSafeInteger(offset) || offset < 0 || offset > SITE_LIMITS.rows || !Number.isSafeInteger(limit) || limit < 1 || limit > SITE_LIMITS.page) fail();
  if (!dense(trackingSystems, SITE_LIMITS.trackingSystems) || trackingSystem !== 'all' && trackingSystems.length) fail();
  const selectedSystems = new Set();
  for (let index = 0; index < trackingSystems.length; index++) {
    const id = trackingSystems[index];
    if (typeof id !== 'string' || !indexData.systemCategories.has(id) || selectedSystems.has(id)) fail();
    selectedSystems.add(id);
  }
  if (trackingSystem !== 'all') selectedSystems.add(trackingSystem);
  const hasSystemSelection = selectedSystems.size > 0;
  const tokens = fold(query.slice(0, SITE_LIMITS.query)).trim().split(/\s+/u).filter(Boolean).slice(0, 8);
  const countryCounts = Object.fromEntries(['all', ...data.countries].map(id => [id, 0])), categoryCounts = Object.fromEntries(['all', ...data.categories].map(id => [id, 0]));
  const trackingSystemCounts = Object.fromEntries(['all', ...data.trackingSystems.map(system => system.id)].map(id => [id, 0]));
  const trackingCategoryCounts = Object.fromEntries(['all', ...SITE_TRACKING_CATEGORY_IDS].map(id => [id, 0])), selectedTrackingBit = trackingCategoryBits.get(trackingCategory) || 0;
  // ADR-082: selected systems are alternatives; category scope admits only compatible alternatives.
  if (selectedTrackingBit) for (const id of selectedSystems) if (!(indexData.systemCategories.get(id) & selectedTrackingBit)) selectedSystems.delete(id);
  const matches = [];
  for (let index = 0; index < data.sites.length; index++) {
    const site = data.sites[index];
    if (tokens.some(token => !indexData.texts[index].includes(token))) continue;
    const siteTrackingMask = indexData.siteTrackingCategories[index], inTrackingCategory = !selectedTrackingBit || (siteTrackingMask & selectedTrackingBit) !== 0;
    const inCountry = country === 'all' || site.countries.includes(country), inCategory = category === 'all' || site.categories.includes(category), inSystem = !hasSystemSelection || site.trackingSystems.some(id => selectedSystems.has(id));
    if (inCategory && inSystem && inTrackingCategory) { countryCounts.all++; for (const id of site.countries) countryCounts[id]++; }
    if (inCountry && inSystem && inTrackingCategory) { categoryCounts.all++; for (const id of site.categories) categoryCounts[id]++; }
    if (inCountry && inCategory) {
      // Category navigation ignores both tracking selections, while system choices stay in its category.
      trackingCategoryCounts.all++;
      for (const [id, bit] of trackingCategoryBits) if (siteTrackingMask & bit) trackingCategoryCounts[id]++;
      if (inTrackingCategory) {
        trackingSystemCounts.all++;
        for (const id of site.trackingSystems) if (!selectedTrackingBit || indexData.systemCategories.get(id) & selectedTrackingBit) trackingSystemCounts[id]++;
      }
    }
    if (inCountry && inCategory && inSystem && inTrackingCategory) matches.push(site);
  }
  // A bucket is a range, not an exact rank. Within it use stable name/id order.
  if (country !== 'all') matches.sort((first, second) => {
    const bucket = first.rankBuckets[country] - second.rankBuckets[country]; if (bucket) return bucket;
    const left = indexData.names.get(first.id), right = indexData.names.get(second.id);
    return left < right ? -1 : left > right ? 1 : first.id < second.id ? -1 : first.id > second.id ? 1 : 0;
  });
  return { rows: matches.slice(offset, offset + limit), total: matches.length, countryCounts, categoryCounts, trackingSystemCounts, trackingCategoryCounts, offset, limit };
}

/** All-or-nothing draft addition: existing text is never normalized, removed or truncated. */
export function mergeAutosurfSiteUrls(existingText, candidates) {
  const unchanged = error => ({ text: typeof existingText === 'string' ? existingText : '', added: 0, duplicates: 0, changed: false, error });
  if (Array.isArray(candidates) && candidates.length > AUTOSURF_LIMITS.urls) return unchanged('limit');
  if (typeof existingText !== 'string' || existingText.length > AUTOSURF_LIMITS.configBytes || !dense(candidates, AUTOSURF_LIMITS.urls)) return unchanged('invalid-input');
  const urls = [], seen = new Set(), appended = []; let duplicates = 0;
  for (const line of existingText.split(/\r?\n/)) {
    const trimmed = line.trim(); if (!trimmed) continue;
    let canonical; try { canonical = validateAutosurfUrl(trimmed); } catch { return unchanged('invalid-url'); }
    if (seen.has(canonical)) return unchanged('invalid-input');
    seen.add(canonical); urls.push(canonical);
    if (urls.length > AUTOSURF_LIMITS.urls) return unchanged('limit');
  }
  for (const value of candidates) {
    let canonical; try { canonical = new URL(rootOrigin(value)).href; } catch { return unchanged('invalid-url'); }
    if (seen.has(canonical)) { duplicates++; continue; }
    seen.add(canonical); urls.push(canonical); appended.push(canonical);
  }
  if (urls.length > AUTOSURF_LIMITS.urls) return unchanged('limit');
  try { validateAutosurfConfiguration({ ...AUTOSURF_DEFAULT_CONFIGURATION, urls }); } catch { return unchanged('limit'); }
  if (!appended.length) return { text: existingText, added: 0, duplicates, changed: false, error: null };
  const separator = existingText && !/[\r\n]$/.test(existingText) ? '\n' : '';
  const text = existingText + separator + appended.join('\n');
  if (text.length > AUTOSURF_LIMITS.configBytes || new TextEncoder().encode(text).length > AUTOSURF_LIMITS.configBytes) return unchanged('limit');
  return { text, added: appended.length, duplicates, changed: true, error: null };
}
