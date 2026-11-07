// SourceRule -> CompiledRule (ADR-009 v1.1). Pure functions used at release time by scripts/gen-catalog.mjs,
// by the fixture harness and by tests. The runtime bundle only sees the emitted module (regex literals).
// The strict regex dialect itself is enforced by scripts/catalog-checks.mjs before compilation.

import {
  CATALOG_LIMITS,
  CATEGORY_PURPOSE_KEYS,
  DATE_PATTERN,
  GENERIC_PURPOSE_KEY,
  HOST_PATTERN,
  OBSERVED_RESOURCE_TYPES,
  RULE_ID_PATTERN,
  RULE_VERSION_PATTERN,
  SPEC_PURPOSE_OVERRIDES,
  VENDOR_CATEGORIES,
  VENDOR_ID_PATTERN,
} from './lifecycle';
import type {
  CompiledRule,
  CompiledVendor,
  EvidenceOrigin,
  NetworkMatcher,
  ObservedResourceType,
  RuleScheme,
  SourceRule,
  SourceVendor,
  SuffixMatcher,
} from './types';

export class CompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompileError';
  }
}

const DAY_MS = 86_400_000;

/** URL-shaped keys that would let one string carry host and path together (F068). */
export const FORBIDDEN_CONDITION_KEYS: readonly string[] = /* @__PURE__ */ Object.freeze([
  'url',
  'urlRegex',
  'urlExact',
  'hostPath',
  'hostAndPath',
  'fullUrl',
  'urlPrefix',
  'pattern',
  'code',
  'script',
]);

const NETWORK_KEYS = /* @__PURE__ */ new Set([
  'scheme',
  'hostExact',
  'hostOneOf',
  'hostSuffixLabels',
  'leftmostLabelRegex',
  'pathExact',
  'pathOneOf',
  'pathRegex',
  'resourceType',
  'portExact',
]);
const PAGE_KEYS: Readonly<Record<string, ReadonlySet<string>>> = /* @__PURE__ */ Object.freeze({
  cookie_name: new Set(['nameExact', 'nameOneOf']),
  global_name: new Set(['ownDataPropertyOneOf', 'neverReadValues']),
  dom_attribute: new Set(['tagExact', 'attributeExact', 'attributeValueExact', 'neverReadElementContent']),
});
const EVIDENCE_ORIGINS: readonly EvidenceOrigin[] = ['network_request', 'cookie_name', 'global_name', 'dom_attribute'];

function fail(ruleId: string, message: string): never {
  throw new CompileError('rule ' + ruleId + ': ' + message);
}

/** 'YYYY-MM-DD' -> exclusive end of that UTC day (start of the next day). */
export function endOfUtcDayMs(date: string): number {
  if (!DATE_PATTERN.test(date)) throw new CompileError('date must be YYYY-MM-DD: ' + JSON.stringify(date));
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  const start = Date.UTC(y, m - 1, d);
  const check = new Date(start);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    throw new CompileError('date does not exist: ' + date);
  }
  return start + DAY_MS;
}

function hostList(ruleId: string, key: string, value: unknown): string[] {
  const list = key === 'hostExact' ? [value] : value;
  if (!Array.isArray(list) || list.length === 0) fail(ruleId, key + ' must be a non-empty list');
  if (list.length > CATALOG_LIMITS.maxHostsPerRule) fail(ruleId, key + ' has more than ' + CATALOG_LIMITS.maxHostsPerRule + ' hosts');
  for (const host of list) {
    if (typeof host !== 'string' || host.length > CATALOG_LIMITS.maxHostChars || !HOST_PATTERN.test(host)) {
      fail(ruleId, key + ' must contain bare lowercase hostnames');
    }
  }
  if (new Set(list).size !== list.length) fail(ruleId, key + ' contains duplicates');
  return list as string[];
}

function pathList(ruleId: string, key: string, value: unknown): string[] {
  const list = key === 'pathExact' ? [value] : value;
  if (!Array.isArray(list) || list.length === 0) fail(ruleId, key + ' must be a non-empty list');
  if (list.length > CATALOG_LIMITS.maxPathsPerRule) fail(ruleId, key + ' has more than ' + CATALOG_LIMITS.maxPathsPerRule + ' paths');
  for (const path of list) {
    if (typeof path !== 'string' || path.length > CATALOG_LIMITS.maxPathChars || !/^\/[\x21-\x7e]*$/.test(path)) {
      fail(ruleId, key + ' entries must start with "/" and contain printable ASCII only');
    }
    if (path.includes('?') || path.includes('#') || path.includes('://')) fail(ruleId, key + ' must not contain query, fragment or scheme');
  }
  if (new Set(list).size !== list.length) fail(ruleId, key + ' contains duplicates');
  return list as string[];
}

function anchoredRegex(ruleId: string, key: string, value: unknown): RegExp {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) fail(ruleId, key + ' must be a string of 1..256 chars');
  if (!value.startsWith('^') || !value.endsWith('$')) fail(ruleId, key + ' must be anchored');
  try {
    return new RegExp(value);
  } catch {
    return fail(ruleId, key + ' does not compile');
  }
}

function compileNetwork(rule: SourceRule, testOnly: boolean): NetworkMatcher {
  const c = rule.conditions;
  const id = rule.id;
  for (const key of Object.keys(c)) if (!NETWORK_KEYS.has(key)) fail(id, 'unknown network condition key ' + key);
  const hostKeys = ['hostExact', 'hostOneOf', 'hostSuffixLabels'].filter((k) => k in c);
  if (hostKeys.length !== 1) fail(id, 'exactly one of hostExact, hostOneOf, hostSuffixLabels is required');
  const pathKeys = ['pathExact', 'pathOneOf', 'pathRegex'].filter((k) => k in c);
  if (pathKeys.length > 1) fail(id, 'at most one of pathExact, pathOneOf, pathRegex is allowed');
  if ('leftmostLabelRegex' in c && !('hostSuffixLabels' in c)) fail(id, 'leftmostLabelRegex requires hostSuffixLabels');

  const scheme = c['scheme'];
  if (scheme !== 'https' && scheme !== 'http') fail(id, 'scheme must be "https" or "http"');

  let port: number | null = null;
  if ('portExact' in c) {
    if (!testOnly) fail(id, 'portExact is allowed for testOnly rules only');
    const value = c['portExact'];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535) fail(id, 'portExact must be an integer 1..65535');
    port = value;
  }

  let hosts: string[] = [];
  let suffix: SuffixMatcher | null = null;
  const hostKey = hostKeys[0] as string;
  if (hostKey === 'hostSuffixLabels') {
    const labels = c['hostSuffixLabels'];
    if (typeof labels !== 'string' || labels.length > CATALOG_LIMITS.maxHostChars || !HOST_PATTERN.test(labels) || !labels.includes('.')) {
      fail(id, 'hostSuffixLabels must be a lowercase registrable host with at least two labels');
    }
    const leftmost = 'leftmostLabelRegex' in c ? anchoredRegex(id, 'leftmostLabelRegex', c['leftmostLabelRegex']) : null;
    suffix = { labels, leftmost };
  } else {
    hosts = hostList(id, hostKey, c[hostKey]);
  }

  let paths: string[] = [];
  let pathPattern: RegExp | null = null;
  const pathKey = pathKeys[0];
  if (pathKey === 'pathRegex') pathPattern = anchoredRegex(id, 'pathRegex', c['pathRegex']);
  else if (pathKey !== undefined) paths = pathList(id, pathKey, c[pathKey]);

  let resourceType: ObservedResourceType | null = null;
  if ('resourceType' in c) {
    const value = c['resourceType'];
    if (typeof value !== 'string' || !(OBSERVED_RESOURCE_TYPES as readonly string[]).includes(value)) fail(id, 'unknown resourceType');
    resourceType = value as ObservedResourceType;
  }
  return { scheme: scheme as RuleScheme, port, hosts, suffix, paths, pathPattern, resourceType };
}

function checkPageConditions(rule: SourceRule): void {
  const allowed = PAGE_KEYS[rule.evidenceOrigin];
  if (!allowed) fail(rule.id, 'unknown evidenceOrigin');
  const c = rule.conditions;
  for (const [key, value] of Object.entries(c)) {
    if (!allowed.has(key)) fail(rule.id, 'unknown ' + rule.evidenceOrigin + ' condition key ' + key);
    if (Array.isArray(value) && value.length === 0) fail(rule.id, key + ' must not be empty');
    if (Array.isArray(value) && value.some((v) => typeof v !== 'string' || v.length === 0)) fail(rule.id, key + ' must contain non-empty strings');
  }
  // Values and element content are never read (REQ-005); the name/attribute keys are mandatory.
  if (rule.evidenceOrigin === 'cookie_name' && ('nameExact' in c) === ('nameOneOf' in c)) fail(rule.id, 'exactly one of nameExact, nameOneOf is required');
  if (rule.evidenceOrigin === 'global_name' && (!('ownDataPropertyOneOf' in c) || c['neverReadValues'] !== true)) fail(rule.id, 'ownDataPropertyOneOf and neverReadValues=true are required');
  if (rule.evidenceOrigin === 'dom_attribute' && (!('tagExact' in c) || !('attributeExact' in c) || c['neverReadElementContent'] !== true)) {
    fail(rule.id, 'tagExact, attributeExact and neverReadElementContent=true are required');
  }
}

function text(ruleId: string, field: string, value: unknown, required: boolean): string {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length === 0 || value.length > CATALOG_LIMITS.maxTextChars) {
    fail(ruleId, field + ' must be a non-empty string of at most ' + CATALOG_LIMITS.maxTextChars + ' chars');
  }
  return value;
}

/** Compiles one seed/overlay/synthetic rule. Throws CompileError on any shape outside ADR-009 v1.1. */
export function compileRule(rule: SourceRule): CompiledRule {
  if (rule === null || typeof rule !== 'object') throw new CompileError('rule must be an object');
  const id = typeof rule.id === 'string' && RULE_ID_PATTERN.test(rule.id) ? rule.id : fail(String(rule.id), 'id must match ' + RULE_ID_PATTERN.source);
  if (typeof rule.vendorId !== 'string' || !VENDOR_ID_PATTERN.test(rule.vendorId)) fail(id, 'vendorId must match ' + VENDOR_ID_PATTERN.source);
  if (!(EVIDENCE_ORIGINS as readonly string[]).includes(rule.evidenceOrigin)) fail(id, 'unknown evidenceOrigin');
  const c = rule.conditions;
  if (c === null || typeof c !== 'object' || Array.isArray(c) || Object.keys(c).length === 0) fail(id, 'conditions must be a non-empty object');
  for (const key of Object.keys(c)) {
    if (FORBIDDEN_CONDITION_KEYS.includes(key)) fail(id, 'combined URL key ' + key + ' is not allowed; use separate host* and path* fields');
  }
  if (rule.testOnly !== undefined && typeof rule.testOnly !== 'boolean') fail(id, 'testOnly must be a boolean');
  const testOnly = rule.testOnly === true;
  if (rule.ruleVersion !== undefined && rule.version !== undefined && rule.ruleVersion !== rule.version) fail(id, 'ruleVersion and version disagree');
  const ruleVersion = rule.ruleVersion ?? rule.version ?? '0';
  if (typeof ruleVersion !== 'string' || !RULE_VERSION_PATTERN.test(ruleVersion)) fail(id, 'ruleVersion must match ' + RULE_VERSION_PATTERN.source);
  if (typeof rule.expiresAt !== 'string') fail(id, 'expiresAt must be YYYY-MM-DD');
  let expiresAtMs: number;
  try {
    expiresAtMs = endOfUtcDayMs(rule.expiresAt);
  } catch (e) {
    return fail(id, (e as Error).message);
  }

  const evidenceOrigin = rule.evidenceOrigin as EvidenceOrigin;
  let network: NetworkMatcher | null = null;
  if (evidenceOrigin === 'network_request') network = compileNetwork(rule, testOnly);
  else checkPageConditions(rule);
  if (testOnly && network === null) fail(id, 'testOnly rules must be network rules');
  const strength = network !== null && (network.paths.length > 0 || network.pathPattern !== null) ? 'documented-resource' : 'weak-signal';

  const meaningRu = text(id, 'meaningRu', rule.meaningRu, true);
  const limitationsRu = text(id, 'limitationsRu', rule.limitationsRu, true);
  // Candidates without reviewed English texts fall back to Russian; security_privacy_reviewed requires en.
  const meaningEn = text(id, 'meaningEn', rule.meaningEn, false) || meaningRu;
  const limitationsEn = text(id, 'limitationsEn', rule.limitationsEn, false) || limitationsRu;

  return {
    ruleId: id,
    ruleVersion,
    vendorId: rule.vendorId,
    evidenceOrigin,
    strength,
    network,
    expiresAtMs,
    testOnly,
    meaning: { ru: meaningRu, en: meaningEn },
    limitations: { ru: limitationsRu, en: limitationsEn },
  };
}

export function purposeKeyFor(vendorId: string, category: string): string {
  return SPEC_PURPOSE_OVERRIDES[vendorId] ?? CATEGORY_PURPOSE_KEYS[category as keyof typeof CATEGORY_PURPOSE_KEYS] ?? GENERIC_PURPOSE_KEY;
}

export function compileVendor(vendor: SourceVendor): CompiledVendor {
  if (vendor === null || typeof vendor !== 'object') throw new CompileError('vendor must be an object');
  if (typeof vendor.id !== 'string' || !VENDOR_ID_PATTERN.test(vendor.id)) throw new CompileError('vendor id must match ' + VENDOR_ID_PATTERN.source);
  if (typeof vendor.name !== 'string' || vendor.name.length === 0 || vendor.name.length > 128) throw new CompileError('vendor ' + vendor.id + ': name must be 1..128 chars');
  if (!(VENDOR_CATEGORIES as readonly string[]).includes(vendor.category)) throw new CompileError('vendor ' + vendor.id + ': unknown category');
  return { vendorId: vendor.id, displayName: vendor.name, category: vendor.category, purposeKey: purposeKeyFor(vendor.id, vendor.category) };
}

// ---- deterministic emission ----

const byRuleId = (a: CompiledRule, b: CompiledRule): number => (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0);
const byVendorId = (a: CompiledVendor, b: CompiledVendor): number => (a.vendorId < b.vendorId ? -1 : a.vendorId > b.vendorId ? 1 : 0);

function plain(value: unknown): unknown {
  if (value instanceof RegExp) return { regex: value.source };
  if (Array.isArray(value)) return value.map(plain);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = plain((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

/** Canonical JSON (sorted keys, regex as source) hashed by gen-catalog into the catalog version. */
export function canonicalCatalogJson(vendors: readonly CompiledVendor[], rules: readonly CompiledRule[]): string {
  return JSON.stringify(plain({ vendors: [...vendors].sort(byVendorId), rules: [...rules].sort(byRuleId) }));
}

const str = (value: string): string => JSON.stringify(value);
const regexLiteral = (re: RegExp): string => '/' + re.source + '/';
const strList = (values: readonly string[]): string => '[' + values.map(str).join(', ') + ']';

function emitNetwork(n: NetworkMatcher | null, pad: string): string {
  if (n === null) return 'null';
  const inner = pad + '  ';
  const suffix = n.suffix === null
    ? 'null'
    : '{ labels: ' + str(n.suffix.labels) + ', leftmost: ' + (n.suffix.leftmost === null ? 'null' : regexLiteral(n.suffix.leftmost)) + ' }';
  return [
    '{',
    inner + 'scheme: ' + str(n.scheme) + ',',
    inner + 'port: ' + (n.port === null ? 'null' : String(n.port)) + ',',
    inner + 'hosts: ' + strList(n.hosts) + ',',
    inner + 'suffix: ' + suffix + ',',
    inner + 'paths: ' + strList(n.paths) + ',',
    inner + 'pathPattern: ' + (n.pathPattern === null ? 'null' : regexLiteral(n.pathPattern)) + ',',
    inner + 'resourceType: ' + (n.resourceType === null ? 'null' : str(n.resourceType)) + ',',
    pad + '}',
  ].join('\n');
}

function emitRule(r: CompiledRule): string {
  return [
    '  {',
    '    ruleId: ' + str(r.ruleId) + ',',
    '    ruleVersion: ' + str(r.ruleVersion) + ',',
    '    vendorId: ' + str(r.vendorId) + ',',
    '    evidenceOrigin: ' + str(r.evidenceOrigin) + ',',
    '    strength: ' + str(r.strength) + ',',
    '    network: ' + emitNetwork(r.network, '    ') + ',',
    '    expiresAtMs: ' + String(r.expiresAtMs) + ',',
    '    testOnly: ' + String(r.testOnly) + ',',
    '    meaning: { ru: ' + str(r.meaning.ru) + ', en: ' + str(r.meaning.en) + ' },',
    '    limitations: { ru: ' + str(r.limitations.ru) + ', en: ' + str(r.limitations.en) + ' },',
    '  },',
  ].join('\n');
}

function emitVendor(v: CompiledVendor): string {
  return '  { vendorId: ' + str(v.vendorId) + ', displayName: ' + str(v.displayName) + ', category: ' + str(v.category) + ', purposeKey: ' + str(v.purposeKey) + ' },';
}

export interface CatalogModuleSpec {
  /** Human-readable inputs named in the header comment (repository-relative paths, no URLs). */
  readonly sources: readonly string[];
  /** One-line description for the header comment (no URLs). */
  readonly note: string;
  readonly versionName: string;
  readonly version: string;
  readonly vendorsName: string;
  readonly rulesName: string;
  readonly vendors: readonly CompiledVendor[];
  readonly rules: readonly CompiledRule[];
  readonly numbers?: readonly (readonly [string, number])[];
}

/** Repository-relative inputs of the generated modules (named in their header comments). */
export const CATALOG_INPUTS = /* @__PURE__ */ Object.freeze({
  seed: 'packages/catalog/data/vendors.seed.json',
  sources: 'rules/sources',
  policy: 'rules/policy.json',
  synthetic: 'fixtures/vendors/synthetic/catalog.json',
});

/** Spec of generated/production-catalog.ts (shared by gen-catalog.mjs and the byte-for-byte test). */
export function productionModuleSpec(version: string, candidateRuleCount: number, vendors: readonly CompiledVendor[], rules: readonly CompiledRule[]): CatalogModuleSpec {
  return {
    sources: [CATALOG_INPUTS.seed, CATALOG_INPUTS.sources, CATALOG_INPUTS.policy],
    note: 'ADR-009 v1.1: only production_approved rules with productionEnabled=true and policy allowProductionRules=true.',
    versionName: 'PRODUCTION_CATALOG_VERSION',
    version,
    numbers: [['CANDIDATE_RULE_COUNT', candidateRuleCount]],
    vendorsName: 'PRODUCTION_VENDORS',
    rulesName: 'PRODUCTION_RULES',
    vendors,
    rules,
  };
}

/** Spec of generated/synthetic-catalog.ts (testOnly rules for the test profile). */
export function syntheticModuleSpec(version: string, vendors: readonly CompiledVendor[], rules: readonly CompiledRule[]): CatalogModuleSpec {
  return {
    sources: [CATALOG_INPUTS.synthetic],
    note: 'Test profile only: testOnly rules on loopback hosts; import via @detect-expert/catalog/synthetic.',
    versionName: 'SYNTHETIC_CATALOG_VERSION',
    version,
    vendorsName: 'SYNTHETIC_VENDORS',
    rulesName: 'SYNTHETIC_RULES',
    vendors,
    rules,
  };
}

const CONST_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

/** Deterministic TypeScript module (no dates, regex as literals, no scheme-qualified URLs). */
export function emitCatalogModule(spec: CatalogModuleSpec): string {
  if (!/^[\x20-\x7e]{1,160}$/.test(spec.note) || /https?:/i.test(spec.note)) throw new CompileError('note must be one printable line without URLs');
  for (const name of [spec.versionName, spec.vendorsName, spec.rulesName, ...(spec.numbers ?? []).map(([n]) => n)]) {
    if (!CONST_NAME.test(name)) throw new CompileError('invalid export name ' + name);
  }
  const vendors = [...spec.vendors].sort(byVendorId);
  const rules = [...spec.rules].sort(byRuleId);
  const lines = [
    '// GENERATED by scripts/gen-catalog.mjs; do not edit. Regenerate: node scripts/gen-catalog.mjs',
    '// Inputs: ' + spec.sources.join(', '),
    '// ' + spec.note,
    '',
    "import type { CompiledRule, CompiledVendor } from '../types';",
    '',
    'export const ' + spec.versionName + ' = ' + str(spec.version) + ';',
    ...(spec.numbers ?? []).map(([name, value]) => {
      if (!Number.isSafeInteger(value)) throw new CompileError('non-integer constant ' + name);
      return 'export const ' + name + ' = ' + String(value) + ';';
    }),
    '',
    vendors.length === 0
      ? 'export const ' + spec.vendorsName + ': readonly CompiledVendor[] = [];'
      : ['export const ' + spec.vendorsName + ': readonly CompiledVendor[] = [', ...vendors.map(emitVendor), '];'].join('\n'),
    '',
    rules.length === 0
      ? 'export const ' + spec.rulesName + ': readonly CompiledRule[] = [];'
      : ['export const ' + spec.rulesName + ': readonly CompiledRule[] = [', ...rules.map(emitRule), '];'].join('\n'),
    '',
  ];
  const out = lines.join('\n');
  if (/https?:\/\//i.test(out)) throw new CompileError('emitted catalog module must not contain scheme-qualified URLs');
  return out;
}
