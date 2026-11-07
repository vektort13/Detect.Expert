import { checkRegex, validAlternatives } from './catalog-checks.mjs';
// Catalog lint (REQ-008, REQ-010, spec Part IV). Seeds packages/catalog/data/vendors.seed.json from the
// implementation pack when the file is missing (or with --sync), then lints it:
//   - every rule and vendor stays productionEnabled=false and fixtureVerified=false,
//   - every vendor has sources[].url (https), every rule has source.url,
//   - matchers use separate host/path fields (no "host/path" strings, no scheme in paths),
//   - regex fields are anchored, compile, and contain no backreferences, lookbehind or nested quantifiers,
//   - referential integrity between vendors and rules; distribution policy forbids remote regex/logic.
// Exits 1 on any failure. Usage: node scripts/catalog-lint.mjs [--sync]

import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packSeed = join(root, 'Doc', 'Detector_Implementation_Pack', 'Detector_Implementation_Pack', 'catalog', 'vendors.seed.json');
const dataDir = join(root, 'packages', 'catalog', 'data');
const seed = join(dataDir, 'vendors.seed.json');
const sync = process.argv.includes('--sync');

if (sync || !existsSync(seed)) {
  if (!existsSync(packSeed)) {
    console.error('catalog-lint: pack seed not found: ' + packSeed);
    process.exit(1);
  }
  mkdirSync(dataDir, { recursive: true });
  copyFileSync(packSeed, seed);
  console.log('catalog-lint: copied pack seed -> packages/catalog/data/vendors.seed.json');
} else if (existsSync(packSeed) && readFileSync(packSeed, 'utf8') !== readFileSync(seed, 'utf8')) {
  console.log('catalog-lint: note: packages/catalog/data/vendors.seed.json differs from the pack seed (use --sync to overwrite)');
}

const catalog = JSON.parse(readFileSync(seed, 'utf8'));
const errors = [];
const warnings = [];
const err = (m) => errors.push(m);

const HOST_KEYS = new Set(['hostExact', 'hostOneOf', 'hostSuffixLabels']);
const PATH_KEYS = new Set(['pathExact', 'pathOneOf']);
const REGEX_KEYS = new Set(['pathRegex', 'leftmostLabelRegex']);
const OTHER_KEYS = new Set([
  'scheme',
  'resourceType',
  'nameExact',
  'nameOneOf',
  'ownDataPropertyOneOf',
  'neverReadValues',
  'tagExact',
  'attributeExact',
  'attributeValueExact',
  'neverReadElementContent',
]);
const FORBIDDEN_CONDITION_KEYS = ['url', 'urlRegex', 'urlExact', 'hostPath', 'hostAndPath', 'fullUrl', 'urlPrefix', 'pattern', 'code', 'script'];
const RULE_STATUSES = new Set(['documented_candidate', 'documented_legacy_candidate']);
const VENDOR_STATUSES = new Set(['documented_candidate', 'product_catalog_only', 'official_index_only', 'documented_legacy_candidate']);
const EVIDENCE_ORIGINS = new Set(['cookie_name', 'network_request', 'global_name', 'dom_attribute']);
const HOST_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

function isHttpsUrl(u) {
  return typeof u === 'string' && /^https:\/\/[a-z0-9.-]+\/?/i.test(u);
}

function checkHost(value, where) {
  if (typeof value !== 'string' || !HOST_RE.test(value)) err(where + ': host must be a bare lowercase hostname (no scheme, port, path); got ' + JSON.stringify(value));
}

function checkPath(value, where) {
  if (typeof value !== 'string' || !value.startsWith('/')) err(where + ': path must start with "/"');
  else if (value.includes('://') || value.includes('?') || value.includes('#') || /\s/.test(value)) err(where + ': path must not contain scheme, host, query, fragment or whitespace');
}

// --- top level ---
if (catalog.schemaVersion !== 1) err('schemaVersion must be 1');
if (catalog.researchOnly !== true) err('researchOnly must be true');
if (catalog.productionEnabled !== false) err('top-level productionEnabled must be false');
if (catalog.fixtureVerified !== false) err('top-level fixtureVerified must be false');
const policy = catalog.ruleDistributionPolicy ?? {};
if (policy.remoteNewRegexAllowed !== false) err('ruleDistributionPolicy.remoteNewRegexAllowed must be false (REQ-010)');
if (policy.remoteNewLogicAllowed !== false) err('ruleDistributionPolicy.remoteNewLogicAllowed must be false (REQ-010)');
if (policy.newMatchersRequireExtensionRelease !== true) err('ruleDistributionPolicy.newMatchersRequireExtensionRelease must be true');
if (!Array.isArray(catalog.vendors) || !Array.isArray(catalog.rules)) {
  err('vendors and rules must be arrays');
}

const vendors = Array.isArray(catalog.vendors) ? catalog.vendors : [];
const rules = Array.isArray(catalog.rules) ? catalog.rules : [];
const vendorIds = new Map();
const ruleIds = new Map();

// --- vendors ---
for (const v of vendors) {
  const where = 'vendor ' + String(v && v.id);
  // Vendor ids follow the seed's snake_case convention; rule ids are kebab-case.
  if (!v || typeof v.id !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(v.id)) {
    err(where + ': id must match ^[a-z0-9_-]{1,64}$');
    continue;
  }
  if (vendorIds.has(v.id)) err(where + ': duplicate vendor id');
  vendorIds.set(v.id, v);
  if (typeof v.name !== 'string' || v.name.length === 0) err(where + ': name required');
  if (!VENDOR_STATUSES.has(v.evidenceStatus)) err(where + ': unknown evidenceStatus ' + JSON.stringify(v.evidenceStatus));
  if (v.productionEnabled !== false) err(where + ': productionEnabled must be false (REQ-008)');
  if (v.fixtureVerified !== false) err(where + ': fixtureVerified must be false (REQ-008)');
  if (v.browserRecognitionPromised !== false) err(where + ': browserRecognitionPromised must be false');
  if (!Array.isArray(v.sources) || v.sources.length === 0) err(where + ': sources[] must be non-empty');
  else {
    v.sources.forEach((s, i) => {
      if (!s || !isHttpsUrl(s.url)) err(where + ': sources[' + i + '].url must be an https URL');
      if (!s || typeof s.accessedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.accessedAt)) err(where + ': sources[' + i + '].accessedAt must be YYYY-MM-DD');
      if (!s || typeof s.claim !== 'string' || typeof s.verification !== 'string') err(where + ': sources[' + i + '] needs claim and verification');
    });
  }
  if (!Array.isArray(v.ruleIds)) err(where + ': ruleIds must be an array');
}

// --- rules ---
for (const r of rules) {
  const where = 'rule ' + String(r && r.id);
  if (!r || typeof r.id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(r.id)) {
    err(where + ': id must match ^[a-z0-9-]{1,64}$');
    continue;
  }
  if (ruleIds.has(r.id)) err(where + ': duplicate rule id');
  ruleIds.set(r.id, r);
  if (r.productionEnabled !== false) err(where + ': productionEnabled must be false (REQ-008)');
  if (r.fixtureVerified !== false) err(where + ': fixtureVerified must be false (REQ-008)');
  if (!RULE_STATUSES.has(r.status)) err(where + ': unknown status ' + JSON.stringify(r.status));
  if (!EVIDENCE_ORIGINS.has(r.evidenceOrigin)) err(where + ': unknown evidenceOrigin ' + JSON.stringify(r.evidenceOrigin));
  if (!vendorIds.has(r.vendorId)) err(where + ': unknown vendorId ' + JSON.stringify(r.vendorId));
  else if (!(vendorIds.get(r.vendorId).ruleIds ?? []).includes(r.id)) err(where + ': vendor ' + r.vendorId + ' does not list this rule in ruleIds');
  if (!r.source || !isHttpsUrl(r.source.url)) err(where + ': source.url must be an https URL');
  if (typeof r.meaningRu !== 'string' || typeof r.limitationsRu !== 'string') err(where + ': meaningRu and limitationsRu are required');
  if (!Array.isArray(r.fixtureIds)) err(where + ': fixtureIds must be an array');
  else if (r.fixtureIds.length > 0) err(where + ': fixtureIds must be empty while fixtureVerified=false');
  if (typeof r.expiresAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.expiresAt)) err(where + ': expiresAt must be YYYY-MM-DD');

  const c = r.conditions;
  if (!c || typeof c !== 'object' || Array.isArray(c) || Object.keys(c).length === 0) {
    err(where + ': conditions must be a non-empty object');
    continue;
  }
  for (const [key, value] of Object.entries(c)) {
    const at = where + '.conditions.' + key;
    if (FORBIDDEN_CONDITION_KEYS.includes(key)) {
      err(at + ': combined host/path or URL matchers are not allowed; use separate host* and path* fields');
      continue;
    }
    if (['hostOneOf', 'pathOneOf', 'nameOneOf', 'ownDataPropertyOneOf'].includes(key) &&
        !validAlternatives(value)) {
      err(at + ': alternatives must contain 1..16 nonempty strings');
      continue;
    }
    if (HOST_KEYS.has(key)) {
      const values = Array.isArray(value) ? value : [value];
      if (key === 'hostOneOf' && !Array.isArray(value)) err(at + ': must be an array');
      values.forEach((h) => checkHost(h, at));
    } else if (PATH_KEYS.has(key)) {
      const values = Array.isArray(value) ? value : [value];
      if (key === 'pathOneOf' && !Array.isArray(value)) err(at + ': must be an array');
      values.forEach((p) => checkPath(p, at));
    } else if (REGEX_KEYS.has(key)) {
      checkRegex(value, at, err);
      if (key === 'pathRegex' && typeof value === 'string' && (value.includes('://') || value.includes('\\.com') && !value.startsWith('^/'))) {
        err(at + ': pathRegex must match a path only (no scheme/host)');
      }
    } else if (OTHER_KEYS.has(key)) {
      if (key === 'scheme' && !['https', 'http'].includes(value)) err(at + ': scheme must be https or http');
      if (key === 'resourceType' && typeof value !== 'string') err(at + ': must be a string');
      if ((key === 'nameOneOf' || key === 'ownDataPropertyOneOf') && (!Array.isArray(value) || value.some((x) => typeof x !== 'string'))) err(at + ': must be an array of strings');
      if ((key === 'neverReadValues' || key === 'neverReadElementContent') && value !== true) err(at + ': must be true (values/content are never read)');
    } else {
      err(at + ': unknown condition key');
    }
  }
  if (r.evidenceOrigin === 'network_request') {
    const hasHost = Object.entries(c).some(([k, v]) => HOST_KEYS.has(k) && (Array.isArray(v) ? v.length > 0 && v.length <= 16 && v.every((h) => typeof h === 'string' && HOST_RE.test(h)) : typeof v === 'string' && HOST_RE.test(v)));
    if (!hasHost) err(where + ': network_request rules need a host condition');
    if (!Object.keys(c).some((k) => PATH_KEYS.has(k) || REGEX_KEYS.has(k)) && r.status !== 'documented_candidate') warnings.push(where + ': no path condition');
  }
}

// vendors referencing unknown rules
for (const v of vendors) {
  for (const id of v.ruleIds ?? []) if (!ruleIds.has(id)) err('vendor ' + v.id + ': unknown ruleId ' + id);
}

for (const w of warnings) console.log('catalog-lint: warning: ' + w);
if (errors.length > 0) {
  for (const e of errors) console.error('catalog-lint: ' + e);
  console.error('catalog-lint: FAILED (' + errors.length + ' error(s), ' + vendors.length + ' vendors, ' + rules.length + ' rules)');
  process.exit(1);
}
console.log('catalog-lint: OK (' + vendors.length + ' vendors, ' + rules.length + ' rules, all productionEnabled=false and fixtureVerified=false, ' + warnings.length + ' warning(s))');
