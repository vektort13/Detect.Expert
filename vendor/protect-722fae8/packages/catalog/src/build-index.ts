// Runtime catalog index (ADR-009 v1.1). Hand-written validation (no Ajv: MV3 CSP) of compiled data, then
// frozen lookup maps by exact host and by host suffix. Any violation throws CatalogInvariantError, so a
// malformed generated module fails at load/test time instead of matching silently.

import {
  CATALOG_LIMITS,
  CATALOG_VERSION_PATTERN,
  HOST_PATTERN,
  OBSERVED_RESOURCE_TYPES,
  RULE_ID_PATTERN,
  RULE_VERSION_PATTERN,
  VENDOR_CATEGORIES,
  VENDOR_ID_PATTERN,
} from './lifecycle';
import type { CatalogIndex, CatalogInput, CompiledRule, CompiledVendor, NetworkMatcher, SuffixMatcher } from './types';

export class CatalogInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogInvariantError';
  }
}

function invariant(condition: boolean, message: string): asserts condition {
  if (!condition) throw new CatalogInvariantError(message);
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const PURPOSE_KEY = /^[a-z0-9_]{1,64}$/;
const PRINTABLE_PATH = /^\/[\x21-\x7e]*$/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** Loopback or reserved .test names: the only hosts a testOnly rule may name. */
export function isTestHost(host: string): boolean {
  return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.test') || /^127(?:\.\d{1,3}){3}$/.test(host);
}

function isLocalOrIp(host: string): boolean {
  return host === 'localhost' || host.endsWith('.localhost') || IPV4.test(host);
}

function checkHost(host: unknown, where: string): asserts host is string {
  invariant(typeof host === 'string' && host.length <= CATALOG_LIMITS.maxHostChars && HOST_PATTERN.test(host), where + ': host must be lowercase without a trailing dot');
}

function checkPattern(re: unknown, where: string): asserts re is RegExp {
  invariant(re instanceof RegExp, where + ' must be a RegExp');
  invariant(re.flags === '', where + ' must have no flags');
  invariant(re.source.startsWith('^') && re.source.endsWith('$') && re.source.length <= 300, where + ' must be anchored');
}

function freezeNetwork(n: unknown, rule: string, testOnly: boolean): NetworkMatcher {
  const where = 'rule ' + rule + ' network';
  invariant(isObject(n), where + ' must be an object');
  invariant(n['scheme'] === 'https' || n['scheme'] === 'http', where + '.scheme must be https or http');
  const port = n['port'];
  invariant(port === null || (typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535), where + '.port must be null or 1..65535');
  invariant(port === null || testOnly, where + '.port is allowed for testOnly rules only');
  const hosts = n['hosts'];
  invariant(Array.isArray(hosts) && hosts.length <= CATALOG_LIMITS.maxHostsPerRule, where + '.hosts must be an array of at most 16');
  for (const h of hosts) checkHost(h, where + '.hosts');
  invariant(new Set(hosts).size === hosts.length, where + '.hosts must be unique');
  let suffix: SuffixMatcher | null = null;
  const rawSuffix = n['suffix'];
  if (rawSuffix !== null) {
    invariant(isObject(rawSuffix), where + '.suffix must be an object or null');
    checkHost(rawSuffix['labels'], where + '.suffix.labels');
    invariant((rawSuffix['labels'] as string).includes('.'), where + '.suffix.labels needs at least two labels');
    const leftmost = rawSuffix['leftmost'];
    if (leftmost !== null) checkPattern(leftmost, where + '.suffix.leftmost');
    suffix = Object.freeze({ labels: rawSuffix['labels'] as string, leftmost: leftmost === null ? null : Object.freeze(leftmost as RegExp) });
  }
  invariant((hosts.length > 0) !== (suffix !== null), where + ' needs exactly one of hosts or suffix');
  const names = suffix === null ? (hosts as string[]) : [suffix.labels];
  for (const h of names) {
    if (testOnly) invariant(isTestHost(h), where + ': testOnly hosts must be loopback or .test');
    else invariant(!isLocalOrIp(h) && !h.endsWith('.test'), where + ': IP, localhost and .test hosts need testOnly');
  }
  const paths = n['paths'];
  invariant(Array.isArray(paths) && paths.length <= CATALOG_LIMITS.maxPathsPerRule, where + '.paths must be an array of at most 16');
  for (const p of paths) {
    invariant(typeof p === 'string' && p.length <= CATALOG_LIMITS.maxPathChars && PRINTABLE_PATH.test(p), where + '.paths entries must start with "/" (<= 512 printable ASCII)');
  }
  invariant(new Set(paths).size === paths.length, where + '.paths must be unique');
  const pathPattern = n['pathPattern'];
  if (pathPattern !== null) checkPattern(pathPattern, where + '.pathPattern');
  invariant(!(paths.length > 0 && pathPattern !== null), where + ': paths and pathPattern are exclusive');
  const resourceType = n['resourceType'];
  invariant(resourceType === null || (typeof resourceType === 'string' && (OBSERVED_RESOURCE_TYPES as readonly string[]).includes(resourceType)), where + '.resourceType is unknown');
  return Object.freeze({
    scheme: n['scheme'] as NetworkMatcher['scheme'],
    port: port as number | null,
    hosts: Object.freeze([...(hosts as string[])]),
    suffix,
    paths: Object.freeze([...(paths as string[])]),
    pathPattern: pathPattern === null ? null : Object.freeze(pathPattern as RegExp),
    resourceType: resourceType as NetworkMatcher['resourceType'],
  });
}

function freezeText(v: unknown, where: string): { readonly ru: string; readonly en: string } {
  invariant(isObject(v), where + ' must be an object');
  const { ru, en } = v;
  invariant(typeof ru === 'string' && ru.length > 0 && ru.length <= CATALOG_LIMITS.maxTextChars, where + '.ru must be 1..512 chars');
  invariant(typeof en === 'string' && en.length > 0 && en.length <= CATALOG_LIMITS.maxTextChars, where + '.en must be 1..512 chars');
  return Object.freeze({ ru, en });
}

function freezeRule(r: unknown, kind: CatalogInput['kind'], vendors: ReadonlyMap<string, CompiledVendor>): CompiledRule {
  invariant(isObject(r), 'rule must be an object');
  const id = r['ruleId'];
  invariant(typeof id === 'string' && RULE_ID_PATTERN.test(id), 'ruleId must match ' + RULE_ID_PATTERN.source);
  const where = 'rule ' + id;
  invariant(typeof r['ruleVersion'] === 'string' && RULE_VERSION_PATTERN.test(r['ruleVersion']), where + ': ruleVersion is invalid');
  const vendorId = r['vendorId'];
  invariant(typeof vendorId === 'string' && vendors.has(vendorId), where + ': vendorId must reference a catalog vendor');
  const origin = r['evidenceOrigin'];
  invariant(origin === 'network_request' || origin === 'cookie_name' || origin === 'global_name' || origin === 'dom_attribute', where + ': unknown evidenceOrigin');
  const testOnly = r['testOnly'];
  invariant(typeof testOnly === 'boolean', where + ': testOnly must be boolean');
  invariant(!(testOnly && kind === 'production'), where + ': testOnly rules are forbidden in a production catalog');
  const expiresAtMs = r['expiresAtMs'];
  invariant(typeof expiresAtMs === 'number' && Number.isSafeInteger(expiresAtMs) && expiresAtMs > 0, where + ': expiresAtMs must be a positive integer');
  const network = r['network'] === null ? null : freezeNetwork(r['network'], id, testOnly);
  invariant((network !== null) === (origin === 'network_request'), where + ': network matcher iff evidenceOrigin is network_request');
  const expected = network !== null && (network.paths.length > 0 || network.pathPattern !== null) ? 'documented-resource' : 'weak-signal';
  invariant(r['strength'] === expected, where + ': strength must be ' + expected);
  if (testOnly) invariant(vendorId.startsWith('test-'), where + ': testOnly rules need a test- vendor');
  return Object.freeze({
    ruleId: id,
    ruleVersion: r['ruleVersion'] as string,
    vendorId,
    evidenceOrigin: origin,
    strength: expected,
    network,
    expiresAtMs,
    testOnly,
    meaning: freezeText(r['meaning'], where + '.meaning'),
    limitations: freezeText(r['limitations'], where + '.limitations'),
  });
}

function freezeVendor(v: unknown): CompiledVendor {
  invariant(isObject(v), 'vendor must be an object');
  const id = v['vendorId'];
  invariant(typeof id === 'string' && VENDOR_ID_PATTERN.test(id), 'vendorId must match ' + VENDOR_ID_PATTERN.source);
  const name = v['displayName'];
  invariant(typeof name === 'string' && name.length > 0 && name.length <= 128, 'vendor ' + id + ': displayName must be 1..128 chars');
  const category = v['category'];
  invariant(typeof category === 'string' && (VENDOR_CATEGORIES as readonly string[]).includes(category), 'vendor ' + id + ': unknown category');
  const purposeKey = v['purposeKey'];
  invariant(typeof purposeKey === 'string' && PURPOSE_KEY.test(purposeKey), 'vendor ' + id + ': purposeKey is invalid');
  return Object.freeze({ vendorId: id, displayName: name, category, purposeKey });
}

function group(map: Map<string, CompiledRule[]>, key: string, rule: CompiledRule): void {
  const list = map.get(key);
  if (list) list.push(rule);
  else map.set(key, [rule]);
}

function freezeGroups(map: Map<string, CompiledRule[]>): ReadonlyMap<string, readonly CompiledRule[]> {
  const out = new Map<string, readonly CompiledRule[]>();
  for (const [key, list] of map) out.set(key, Object.freeze([...list]));
  return out;
}

/** Validates compiled data and builds frozen lookup maps. Throws CatalogInvariantError on any violation. */
export function buildCatalogIndex(input: CatalogInput): CatalogIndex {
  invariant(isObject(input), 'catalog input must be an object');
  const kind = input.kind;
  invariant(kind === 'production' || kind === 'test', 'kind must be production or test');
  invariant(typeof input.catalogVersion === 'string' && CATALOG_VERSION_PATTERN.test(input.catalogVersion), 'catalogVersion must match ' + CATALOG_VERSION_PATTERN.source);
  invariant(Number.isSafeInteger(input.candidateRuleCount) && input.candidateRuleCount >= 0 && input.candidateRuleCount <= 10_000, 'candidateRuleCount must be a non-negative integer');
  invariant(Array.isArray(input.vendors) && input.vendors.length <= CATALOG_LIMITS.maxRules, 'vendors must be an array of at most 256');
  invariant(Array.isArray(input.rules) && input.rules.length <= CATALOG_LIMITS.maxRules, 'rules must be an array of at most 256');

  const vendorsById = new Map<string, CompiledVendor>();
  for (const raw of input.vendors) {
    const vendor = freezeVendor(raw);
    invariant(!vendorsById.has(vendor.vendorId), 'duplicate vendorId ' + vendor.vendorId);
    vendorsById.set(vendor.vendorId, vendor);
  }
  const rulesById = new Map<string, CompiledRule>();
  const byHost = new Map<string, CompiledRule[]>();
  const bySuffix = new Map<string, CompiledRule[]>();
  for (const raw of input.rules) {
    const rule = freezeRule(raw, kind, vendorsById);
    invariant(!rulesById.has(rule.ruleId), 'duplicate ruleId ' + rule.ruleId);
    rulesById.set(rule.ruleId, rule);
    if (rule.network === null) continue;
    if (rule.network.suffix !== null) group(bySuffix, rule.network.suffix.labels, rule);
    for (const host of rule.network.hosts) group(byHost, host, rule);
  }
  const rules = Object.freeze([...rulesById.values()].sort((a, b) => (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0)));
  return Object.freeze({
    kind,
    catalogVersion: input.catalogVersion,
    rules,
    rulesById,
    vendorsById,
    networkByHost: freezeGroups(byHost),
    networkBySuffix: freezeGroups(bySuffix),
    candidateRuleCount: input.candidateRuleCount,
  });
}

/** Catalog with no rules: the matcher returns immediately without parsing anything. */
export const EMPTY_CATALOG: CatalogIndex = /* @__PURE__ */ buildCatalogIndex({
  kind: 'production',
  catalogVersion: 'empty',
  vendors: [],
  rules: [],
  candidateRuleCount: 0,
});
