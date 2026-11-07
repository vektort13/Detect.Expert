// REQ-008/010, ADR-009, E12-01: offline evidence catalog, never an enabled runtime rule pack.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RESEARCH = join(ROOT, 'packages/catalog/research/antifraud-2026-10');
const DATA = join(ROOT, 'packages/catalog/data');
export const CATALOG_PATH = join(DATA, 'antifraud.v1.json');
const DATE = '2026-10-09';
const REVIEW_DUE = '2027-04-09';
const INPUT_FILES = ['vendors-a.json', 'vendors-b.json', 'vendors-c.json', 'vendors-d.json'];
const SORT = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const KINDS = new Set(['script-resource', 'request-resource', 'request-host', 'image-resource',
  'global-name', 'cookie-name', 'dom-class', 'dom-element', 'dom-element-id', 'dom-attribute',
  'dom-event', 'header-name', 'sdk-package', 'sdk-description', 'sdk-file', 'script-basename']);
const KIND_ALIASES = { 'javascript-global': 'global-name', 'browser-request-resource': 'request-resource',
  'dom-class-name': 'dom-class', 'dom-custom-element': 'dom-element', 'dom-attribute-name': 'dom-attribute',
  'script-name': 'script-basename', 'script-path-template': 'script-resource', 'sdk-name': 'sdk-description' };
const SCOPES = new Set(['unassessed', 'product', 'provider-family', 'generic-sdk', 'deployment-specific']);
const NETWORK_KINDS = new Set(['script-resource', 'request-resource', 'request-host', 'image-resource']);
const NAME_KINDS = new Set([...KINDS].filter(k => !NETWORK_KINDS.has(k)));
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const KEYS = new Set(['id', 'kind', 'scheme', 'host', 'hostTemplate', 'path', 'pathMatch', 'name',
  'resourceType', 'sourceUrls', 'status', 'scope', 'lifecycle', 'limitations', 'requiresCorroboration',
  'passiveObservable', 'artifactGroupId', 'relatedVendorIds', 'productionEnabled', 'fixtureVerified',
  'reviewDueAt', 'expiryAction', 'parameterPolicy']);
const HASH = v => createHash('sha256').update(v).digest('hex');
const unique = values => [...new Set(values)].sort(SORT);
const markerKey = s => JSON.stringify([s.kind, s.scheme ?? '', s.host ?? s.hostTemplate ?? '', s.path ?? '', s.pathMatch ?? '', s.name ?? '']);
const SCOPE_ORDER = { product: 0, unassessed: 1, 'deployment-specific': 2, 'provider-family': 3, 'generic-sdk': 4 };
const REQUIREMENTS = ['primary-source-claim', 'positive-and-negative-browser-fixtures', 'semantic-and-privacy-review',
  'two-rule-reviewers', 'browser-compatibility-matrix', 'review-expiry-and-disable-procedure', 'extension-release'];
const TOP_KEYS = new Set(['schemaVersion', 'catalogVersion', 'researchDate', 'researchOnly', 'productionEnabled', 'fixtureVerified',
  'scope', 'ranking', 'sourcePolicy', 'productionGate', 'statistics', 'vendors', 'domainIndex']);
const VENDOR_KEYS = new Set(['id', 'name', 'provider', 'category', 'officialWebsite', 'aliases', 'sources', 'browserSignals',
  'webrtc', 'notes', 'productionEnabled', 'fixtureVerified', 'browserRecognitionPromised', 'evidenceStatus']);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function isHost(value) {
  return typeof value === 'string' && HOST.test(value) && !/^\d+(?:\.\d+){3}$/.test(value) &&
    !/(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(value);
}
function isUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && isHost(u.hostname) && !u.username && !u.password && !u.port &&
      [...u.searchParams].every(([key, val]) => ['hsLang', 'locale', 'lang', 'language', 'hl'].includes(key) && /^[a-zA-Z_-]{1,32}$/.test(val));
  } catch { return false; }
}
function hostTemplateValid(value) {
  return value === '{company}-api.arkoselabs.com' || value === '*.ravelin.click';
}
function isPath(value) {
  return typeof value === 'string' && value.length <= 512 && value.startsWith('/') && !/[?#\s\\]/.test(value) && !value.includes('://');
}
function recordList(input) {
  const records = Array.isArray(input) ? input : input.records ?? input.vendors;
  if (!Array.isArray(records)) throw new Error('research input requires a records array');
  return records;
}
function normalizeSignal(raw, vendor) {
  const kind = raw.kind === 'network-resource' ? (raw.resourceType === 'script' || /\.m?js$/.test(raw.path ?? '') ? 'script-resource' : 'request-resource') : KIND_ALIASES[raw.kind] ?? raw.kind;
  const network = NETWORK_KINDS.has(kind);
  const s = { kind, ...(network ? { scheme: raw.scheme ?? 'unknown' } : {}),
    ...(raw.host ? (raw.host.includes('{') || raw.host.startsWith('*.') ? { hostTemplate: raw.host } : { host: raw.host }) : {}),
    ...(raw.path ? { path: raw.path, pathMatch: raw.pathMatch ?? (raw.path.includes('{') ? 'template' : 'exact') } : {}),
    ...(raw.name ? { name: raw.name } : {}),
    ...(kind === 'script-resource' ? { resourceType: 'script' } : raw.resourceType ? { resourceType: raw.resourceType } : {}),
    sourceUrls: [raw.sourceUrl], status: 'documented-candidate', scope: raw.scope ?? 'unassessed',
    lifecycle: raw.lifecycle ?? (/deprecated|\/v0\//.test(raw.sourceUrl) || vendor.id === 'accertify' ? 'legacy' : 'current'),
    limitations: raw.limitations ? [raw.limitations] : [],
    requiresCorroboration: true, passiveObservable: !['sdk-package', 'sdk-description', 'sdk-file'].includes(kind),
    productionEnabled: false, fixtureVerified: false, reviewDueAt: REVIEW_DUE, expiryAction: 'disable',
    parameterPolicy: 'never-read-or-store-values' };
  if (vendor.id.startsWith('human-') && kind === 'cookie-name') {
    s.scope = 'provider-family';
    s.limitations.push('Shared HUMAN-family name; does not independently distinguish product, deployment or execution.');
  }
  if (vendor.id.startsWith('cloudflare-') && kind === 'cookie-name') {
    s.scope = 'provider-family';
    s.limitations.push('Shared Cloudflare feature/challenge marker; CDN and exact product must be distinguished.');
  }
  if (vendor.id.startsWith('aws-waf-') && s.name !== 'AwsWafCaptcha') {
    s.scope = 'provider-family';
    s.limitations.push('Shared AWS WAF integration cannot distinguish Bot Control, ATP, ACFP or challenge deployment.');
  }
  if (vendor.id.startsWith('friendly-captcha') && ['script-resource', 'sdk-package'].includes(kind)) {
    s.scope = 'provider-family';
    s.limitations.push('Shared Friendly Captcha SDK includes CAPTCHA and Risk Intelligence integrations.');
  }
  if (kind === 'sdk-description') {
    s.limitations.push('Descriptive SDK name, not a literal browser marker.');
  }
  if (!network || kind === 'request-host') {
    s.limitations.push('Name or host alone requires corroboration; page-controlled markers cannot establish execution.');
  }
  if (s.hostTemplate) {
    s.scope = 'deployment-specific';
    s.limitations.push('Published template, not a list of deployed hosts.');
  }
  if (vendor.id === 'tencent-captcha' && /^\/TCaptcha(?:-global)?\.js$/.test(s.path ?? '')) {
    s.lifecycle = 'legacy';
    s.limitations.push('Legacy browser entry; current Tencent guidance publishes TJCaptcha.js.');
  }
  if (vendor.id === 'keycaptcha') s.lifecycle = 'legacy';
  if (!s.limitations.length) s.limitations.push('Documented candidate only; positive/negative browser fixtures and production review are still required.');
  s.limitations = unique(s.limitations);
  return s;
}

export function createResearchCatalog(inputs) {
  const vendors = new Map();
  for (const input of inputs) for (const raw of recordList(input)) {
    const signals = raw.browserSignals.map(s => normalizeSignal(s, raw));
    const v = vendors.get(raw.id) ?? {
      id: raw.id, name: raw.name, provider: raw.provider, category: raw.category,
      officialWebsite: raw.officialWebsite, aliases: [], sources: [], browserSignals: [],
      webrtc: { status: 'unknown', sourceUrls: [] }, notes: [],
      productionEnabled: false, fixtureVerified: false, browserRecognitionPromised: false
    };
    if (raw.name !== v.name) v.aliases.push(raw.name);
    for (const source of raw.sources) if (!v.sources.some(s => s.url === source.url && s.claim === source.claim)) v.sources.push({ ...source });
    for (const signal of signals) {
      const old = v.browserSignals.find(s => markerKey(s) === markerKey(signal));
      if (old) {
        old.sourceUrls = unique([...old.sourceUrls, ...signal.sourceUrls]);
        old.limitations = unique([...old.limitations, ...signal.limitations]);
        if (SCOPE_ORDER[signal.scope] > SCOPE_ORDER[old.scope]) old.scope = signal.scope;
        if (signal.lifecycle === 'legacy') old.lifecycle = 'legacy';
      } else v.browserSignals.push(signal);
    }
    v.notes = unique([...v.notes, ...raw.notes]);
    vendors.set(v.id, v);
  }
  const records = [...vendors.values()].sort((a, b) => SORT(a.id, b.id));
  const groups = new Map();
  for (const v of records) for (const s of v.browserSignals) {
    const key = markerKey(s);
    const g = groups.get(key) ?? [];
    g.push(v.id); groups.set(key, g);
  }
  for (const v of records) {
    v.aliases = unique(v.aliases);
    v.sources.sort((a, b) => SORT(a.url + a.claim, b.url + b.claim));
    v.browserSignals.sort((a, b) => SORT(markerKey(a), markerKey(b)));
    v.evidenceStatus = v.browserSignals.length ? 'documented_candidate' : 'product_catalog_only';
    for (const s of v.browserSignals) {
      const key = markerKey(s);
      s.id = v.id + '--' + HASH(key).slice(0, 12);
      s.artifactGroupId = 'artifact-' + HASH(key).slice(0, 16);
      s.relatedVendorIds = unique(groups.get(key));
      if (s.relatedVendorIds.length > 1 && s.scope === 'unassessed') s.scope = 'provider-family';
      if (s.relatedVendorIds.length > 1) s.limitations = unique([...s.limitations, 'This artifact is documented for several product records; it is not independent proof of each product.']);
    }
  }
  return {
    schemaVersion: 1, catalogVersion: 'research-' + DATE + '.1', researchDate: DATE,
    researchOnly: true, productionEnabled: false, fixtureVerified: false,
    scope: 'Public primary-source browser integration evidence; no server asset inventory.',
    ranking: 'unranked-product-catalog', sourcePolicy: 'official-vendor-or-official-integrator-documentation',
    productionGate: { stage: 'documented-candidate', positiveFixtureIds: [], negativeFixtureIds: [], reviewerIds: [], requirements: REQUIREMENTS },
    statistics: computeStatistics(records), vendors: records, domainIndex: computeDomainIndex(records)
  };
}

function computeDomainIndex(records) {
  const domains = new Map();
  const addDomain = (host, role, vendorId, sourceUrls, exact) => {
    const d = domains.get(host) ?? { host, exact, roles: [], vendorIds: [], sourceUrls: [] };
    d.roles = unique([...d.roles, role]); d.vendorIds = unique([...d.vendorIds, vendorId]);
    d.sourceUrls = unique([...d.sourceUrls, ...sourceUrls]); domains.set(host, d);
  };
  for (const v of records) {
    addDomain(new URL(v.officialWebsite).hostname, 'official-website', v.id, [v.officialWebsite], true);
    for (const s of v.browserSignals) if (s.host || s.hostTemplate) addDomain(s.host ?? s.hostTemplate, 'documented-browser-artifact', v.id, s.sourceUrls, Boolean(s.host));
  }
  return [...domains.values()].sort((a, b) => SORT(a.host, b.host));
}

function computeStatistics(records) {
  const signals = records.flatMap(v => v.browserSignals);
  return { products: records.length, providerLabels: unique(records.map(v => v.provider)).length,
      productsWithCandidates: records.filter(v => v.browserSignals.length).length,
      productsWithoutCandidates: records.filter(v => !v.browserSignals.length).length,
      productsWithPassiveCandidates: records.filter(v => v.browserSignals.some(s => s.passiveObservable)).length,
      signals: signals.length, distinctArtifacts: unique(signals.map(markerKey)).length,
      passiveObservableCandidates: signals.filter(s => s.passiveObservable).length,
      legacySignals: signals.filter(s => s.lifecycle === 'legacy').length,
      sources: unique(records.flatMap(v => v.sources.map(s => s.url))).length,
      exactBrowserHosts: unique(signals.flatMap(s => s.host ? [s.host] : [])).length,
      unknownSchemeSignals: signals.filter(s => s.scheme === 'unknown').length,
      verifiedNewWebRtcEndpoints: 0, newlyEnabledRuntimeRules: 0
  };
}

export function validateResearchCatalog(catalog) {
  const errors = [];
  const check = (ok, message) => { if (!ok) errors.push(message); };
  if (!object(catalog)) return ['catalog must be an object'];
  check(Object.keys(catalog).every(k => TOP_KEYS.has(k)), 'unexpected catalog field');
  check(catalog?.schemaVersion === 1, 'schemaVersion must be 1');
  check(catalog?.researchOnly === true && catalog?.productionEnabled === false && catalog?.fixtureVerified === false, 'research-only gate must stay disabled');
  check(catalog?.ranking === 'unranked-product-catalog', 'unsupported prevalence ranking');
  check(catalog.sourcePolicy === 'official-vendor-or-official-integrator-documentation' &&
    catalog.scope === 'Public primary-source browser integration evidence; no server asset inventory.', 'catalog source/scope mismatch');
  check(catalog.researchDate === DATE && catalog.catalogVersion === 'research-' + DATE + '.1', 'catalog version/date mismatch');
  const gate = catalog.productionGate;
  check(object(gate) && Object.keys(gate).length === 5 && gate.stage === 'documented-candidate' &&
    ['positiveFixtureIds', 'negativeFixtureIds', 'reviewerIds'].every(k => Array.isArray(gate[k]) && gate[k].length === 0) &&
    JSON.stringify(gate.requirements) === JSON.stringify(REQUIREMENTS), 'productionGate must remain an unapproved documented candidate');
  const vendors = Array.isArray(catalog?.vendors) ? catalog.vendors : [];
  check(vendors.length >= 100 && vendors.length <= 256, 'catalog requires 100..256 unique products');
  const ids = new Set(); const signalIds = new Set();
  for (const v of vendors) {
    if (!object(v)) { errors.push('vendor must be an object'); continue; }
    const at = String(v.id);
    check(Object.keys(v).every(k => VENDOR_KEYS.has(k)), at + ': unexpected vendor field');
    check(ID.test(v.id) && !ids.has(v.id), at + ': invalid/duplicate id'); ids.add(v.id);
    for (const key of ['name', 'provider', 'category']) check(typeof v[key] === 'string' && v[key].length > 0 && v[key].length <= 256, at + ': ' + key + ' required');
    check(v.productionEnabled === false && v.fixtureVerified === false && v.browserRecognitionPromised === false, at + ': production gate must stay disabled');
    check(isUrl(v.officialWebsite), at + ': officialWebsite must be a public HTTPS URL');
    check(v.webrtc?.status === 'unknown' && Array.isArray(v.webrtc.sourceUrls) && v.webrtc.sourceUrls.length === 0 && Object.keys(v.webrtc).length === 2, at + ': unverified WebRTC endpoint');
    const sources = Array.isArray(v.sources) ? v.sources : [];
    const sourceUrls = new Set(sources.map(s => s?.url));
    check(sources.length > 0 && sources.length <= 32, at + ': bounded nonempty source ledger required');
    for (const s of sources) {
      if (!object(s)) { errors.push(at + ': source must be an object'); continue; }
      check(Object.keys(s).every(k => ['url', 'accessedAt', 'claim', 'title'].includes(k)), at + ': unexpected source field');
      check(isUrl(s.url), at + ': invalid source URL');
      check(s.accessedAt === DATE && typeof s.claim === 'string' && s.claim.length > 0 && typeof s.title === 'string', at + ': source needs dated claim/title');
    }
    check(Array.isArray(v.notes) && v.notes.every(n => typeof n === 'string' && n.length <= 4096), at + ': notes invalid');
    const signals = Array.isArray(v.browserSignals) ? v.browserSignals : [];
    check(Array.isArray(v.browserSignals) && signals.length <= 64, at + ': bounded signals required');
    check(v.evidenceStatus === (signals.length ? 'documented_candidate' : 'product_catalog_only'), at + ': evidence status mismatch');
    check(Array.isArray(v.aliases) && v.aliases.length <= 16 && v.aliases.every(n => typeof n === 'string' && n.length <= 256), at + ': aliases invalid');
    for (const s of signals) {
      if (!object(s)) { errors.push(at + ': signal must be an object'); continue; }
      const where = at + '/' + String(s.id);
      check(Object.keys(s).every(k => KEYS.has(k)), where + ': unexpected signal field');
      check(typeof s.id === 'string' && s.id.startsWith(v.id + '--') && !signalIds.has(s.id), where + ': invalid/duplicate signal id'); signalIds.add(s.id);
      check(KINDS.has(s.kind) && SCOPES.has(s.scope), where + ': unknown kind/scope');
      check(['current', 'legacy'].includes(s.lifecycle), where + ': unknown lifecycle');
      check(s.status === 'documented-candidate' && s.productionEnabled === false && s.fixtureVerified === false, where + ': production gate must stay disabled');
      check(s.parameterPolicy === 'never-read-or-store-values' && s.requiresCorroboration === true, where + ': evidence/privacy policy required');
      check(s.reviewDueAt === REVIEW_DUE && s.expiryAction === 'disable', where + ': review expiry required');
      check(Array.isArray(s.sourceUrls) && s.sourceUrls.length > 0 && s.sourceUrls.every(url => sourceUrls.has(url)), where + ': source linkage broken');
      check(Array.isArray(s.limitations) && s.limitations.length > 0 && s.limitations.every(n => typeof n === 'string' && n.length <= 1024), where + ': bounded limitations required');
      if (NETWORK_KINDS.has(s.kind)) {
        check(['https', 'http', 'document-context', 'unknown'].includes(s.scheme), where + ': network scheme required');
        check(s.host !== undefined ? isHost(s.host) && s.hostTemplate === undefined : hostTemplateValid(s.hostTemplate), where + ': invalid host/template');
        if (s.kind !== 'request-host') check(isPath(s.path) && ['exact', 'prefix', 'template'].includes(s.pathMatch), where + ': resource requires separated safe path');
        else check(s.path === undefined && s.pathMatch === undefined && s.resourceType === undefined, where + ': host-only marker cannot carry a path/resource type');
        check(s.name === undefined, where + ': network marker cannot carry a name');
        check(s.kind !== 'script-resource' || s.resourceType === 'script', where + ': script resource must retain its script type');
        if (s.pathMatch !== 'template') check(s.path === undefined || !/[{}]/.test(s.path), where + ': template must be explicit');
        if (s.pathMatch === 'template') {
          const tokens = typeof s.path === 'string' ? s.path.match(/\{[^{}]+\}/g) ?? [] : [];
          check(tokens.length > 0 && tokens.every(t => ['{version}', '{public-key}'].includes(t)), where + ': unsupported template token');
        }
      } else if (NAME_KINDS.has(s.kind)) {
        check(typeof s.name === 'string' && s.name.length > 0 && s.name.length <= 256, where + ': name required');
        check(['scheme', 'host', 'hostTemplate', 'path', 'pathMatch', 'resourceType'].every(k => s[k] === undefined), where + ': named marker cannot carry network fields');
      }
      check(typeof s.passiveObservable === 'boolean' && (!['sdk-package', 'sdk-description', 'sdk-file'].includes(s.kind) || !s.passiveObservable), where + ': SDK build metadata is not passively observable');
    }
  }
  // Derive indexes only after records are valid. These are exports, not trusted input.
  if (errors.length) return errors;
  const groups = new Map();
  for (const v of vendors) for (const s of v.browserSignals) {
    const key = markerKey(s); const group = groups.get(key) ?? [];
    group.push(v.id); groups.set(key, group);
  }
  for (const v of vendors) for (const s of v.browserSignals) {
    const key = markerKey(s);
    check(s.id === v.id + '--' + HASH(key).slice(0, 12) && s.artifactGroupId === 'artifact-' + HASH(key).slice(0, 16), String(s.id) + ': artifact identity mismatch');
    check(JSON.stringify(s.relatedVendorIds) === JSON.stringify(unique(groups.get(key))), String(s.id) + ': artifact group membership mismatch');
  }
  check(JSON.stringify(catalog.statistics) === JSON.stringify(computeStatistics(vendors)), 'statistics do not match records');
  check(JSON.stringify(catalog.domainIndex) === JSON.stringify(computeDomainIndex(vendors)), 'domain index does not match documented public resources');
  return errors;
}

function csvCell(value) {
  // Avoid spreadsheet formulas while preserving machine-readable JSON as canonical data.
  const s = String(value ?? '');
  return '"' + (/^[=+@-]/.test(s) ? "'" + s : s).replaceAll('"', '""') + '"';
}
function csv(rows) { return rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'; }
export function exportCatalogCsv(catalog) {
  return {
    vendors: csv([['id', 'name', 'provider', 'category', 'website', 'candidate_count', 'webrtc_status', 'evidence_status'],
      ...catalog.vendors.map(v => [v.id, v.name, v.provider, v.category, v.officialWebsite, v.browserSignals.length, v.webrtc.status, v.evidenceStatus])]),
    signals: csv([['id', 'vendor_id', 'kind', 'scheme', 'host', 'host_template', 'path', 'path_match', 'name', 'scope', 'lifecycle', 'passive_observable', 'source_urls', 'limitations'],
      ...catalog.vendors.flatMap(v => v.browserSignals.map(s => [s.id, v.id, s.kind, s.scheme, s.host, s.hostTemplate, s.path, s.pathMatch, s.name, s.scope, s.lifecycle, s.passiveObservable, s.sourceUrls.join(' | '), s.limitations.join(' | ')]))]),
    sources: csv([['vendor_id', 'url', 'title', 'claim', 'accessed_at'], ...catalog.vendors.flatMap(v => v.sources.map(s => [v.id, s.url, s.title, s.claim, s.accessedAt]))])
  };
}

export function buildResearchCatalog() {
  const inputs = INPUT_FILES.map(file => JSON.parse(readFileSync(join(RESEARCH, file), 'utf8')));
  const catalog = createResearchCatalog(inputs);
  const errors = validateResearchCatalog(catalog);
  if (errors.length) throw new Error(errors.join('\n'));
  writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + '\n');
  for (const [name, data] of Object.entries(exportCatalogCsv(catalog))) writeFileSync(join(DATA, 'antifraud.' + name + '.csv'), data);
  return catalog;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const catalog = process.argv.includes('--check') ? JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) : buildResearchCatalog();
    const errors = validateResearchCatalog(catalog);
    if (errors.length) throw new Error(errors.join('\n'));
    if (process.argv.includes('--check')) {
      const expected = createResearchCatalog(INPUT_FILES.map(file => JSON.parse(readFileSync(join(RESEARCH, file), 'utf8'))));
      if (JSON.stringify(catalog) !== JSON.stringify(expected)) throw new Error('generated JSON differs from primary-source inputs');
      for (const [name, data] of Object.entries(exportCatalogCsv(catalog))) if (readFileSync(join(DATA, 'antifraud.' + name + '.csv'), 'utf8') !== data) throw new Error('stale CSV ' + name);
    }
    console.log('antifraud-catalog: PASS ' + JSON.stringify(catalog.statistics));
  } catch (error) { console.error('antifraud-catalog: ' + error.message); process.exitCode = 1; }
}
