import { reportHost } from '../../attribution/src/index';
import { attributionConfidence } from './attribution';
// Read-only projection for the UI/export (REQ-005, REQ-013, REQ-014; ADR-007 §5; E13/E14). The projection is
// built field by field from the stored report and then walked against PROJECTION_ALLOWLIST: a value outside the
// allowlist is an engine bug and throws (a thrown error is safer than a leaking projection).
//
// Facts stated by the projection:
// - vendors (S10, ADR-009 v1.1): only when a non-empty catalog view is passed (options.catalog). Then vendors are
//   derived from the rule ids the SW merged into hosts (deriveVendors), catalogVersion is the view's version and host
//   ruleIds keep only rules valid at nowMs. Without an active catalog: vendors [], catalogVersion null, host ruleIds
//   [] and every finding carries the 'catalog-disabled' limitation (no vendor linkage was attempted).
// - hosts (S07, ADR-018): an allowlisted copy of the browser-observed HostEntry list — exactly one of
//   registrableDomain (PSL-normalized) / category, relation to the request initiator, request count and second
//   buckets. Malformed stored entries are skipped. Sorted: third party first (cross-site, opaque, unknown; I1), then
//   requestCount desc, then name.
//   Hosts are shown in the UI only; the export never carries them. summarizeSources() counts them by stored relation.
// - page-hook counters have no script evidence: attributionConfidence stays unknown (ADR-008).
// - browser-network summaries (DET-058…061, S07) come only from report.networkCounters, after the page-hook ones:
//   integrity browser-observed, attributionConfidence frame-only, phases [attempted]; buckets are seconds since
//   createdAt (not the sensor bucket scale). DET-061 appears only when its window pattern is met. Page-hook counters
//   of DET-058…061 are never summarized (PAGE_HOOK_EXCLUDED_TECHNIQUE_IDS).
// - disabledSensors (S11, ADR-019): the SW passes the families not observed in this document (its own record, never a
//   page assertion); the projection copies them in registry order, deduplicated, and omits the field when empty. Rules
//   and findings do not change: a disabled family simply has no new observations.

import {
  ATTRIBUTION_CONFIDENCES,
  BUDGETS,
  COUNT_QUALITIES,
  COVERAGE_FLAGS,
  COVERAGE_STATES,
  EVIDENCE_SOURCES,
  HOST_CATEGORIES,
  INTEGRITIES,
  INTERPRETATIONS,
  INTERPRETATION_CONFIDENCES,
  MAX_COUNT,
  OPERATION_CODES,
  PHASES,
  SCOPE_MODES,
  SENSOR_DISABLE_SOURCES,
  SENSOR_IDS,
  SIGNAL_CODES,
  SITE_RELATIONS,
  TECHNIQUE_IDS,
  VENDOR_MATCHES,
  isSanitizedHost,
  pageOperations,
  type CounterEntry,
  type CountQuality,
  type CoverageFlag,
  type DisabledSensorSummary,
  type DocumentReport,
  type Finding,
  type HostEntry,
  type Interpretation,
  type InterpretationConfidence,
  type OperationCode,
  type Phase,
  type ReportProjection,
  type ScopeMode,
  type SignalCode,
  type SiteRelation,
  type TechniqueId,
  type TechniqueSummary,
} from '@detect-expert/contracts';
import { satAdd, sortByEnumOrder, worstQuality } from './arith';
import { LIMITATION_CODES } from './codes';
import { networkPatternMet } from './rules/network';
import { NETWORK_TECHNIQUE_IDS, PAGE_HOOK_EXCLUDED_TECHNIQUE_IDS } from './techniques';
import { activeRule, catalogViewActive, deriveVendors } from './vendors';
import type { VendorCatalogView } from './vendors';

export interface ProjectionCatalog {
  view: VendorCatalogView;
  /** Time against which rule expiry is checked (the engine has no clock). */
  nowMs: number;
}

export interface ProjectionOptions {
  scopeMode: ScopeMode;
  /**
   * S10: vendor catalog of this build. Recognition is active only when a view with at least one rule is passed;
   * otherwise (absent, null or empty) vendors are [], catalogVersion is null and findings get 'catalog-disabled'.
   */
  catalog?: ProjectionCatalog | null;
  /** Override for observedSince (ms epoch); default = report.createdAt when any counter exists. */
  observedSince?: number | null;
  /** S11 / ADR-019: sensor families not observed in this document (SW record). Empty or absent: field omitted. */
  disabledSensors?: readonly DisabledSensorSummary[];
}

export class EngineInvariantError extends Error {
  readonly violations: readonly string[];
  constructor(violations: readonly string[]) {
    super('projection violates the redaction allowlist: ' + violations.join('; '));
    this.name = 'EngineInvariantError';
    this.violations = violations;
  }
}

// ---------------------------------------------------------------------------
// Allowlist DSL (reused by the export package for its own preview checks).
// ---------------------------------------------------------------------------

export type AllowSpec =
  | { t: 'object'; keys: Readonly<Record<string, AllowSpec>>; optional?: ReadonlySet<string> }
  | { t: 'array'; items: AllowSpec; max: number }
  | { t: 'enum'; values: ReadonlySet<string> }
  | { t: 'int'; min: number; max: number }
  | { t: 'string'; max: number; re: RegExp }
  | { t: 'host' }
  | { t: 'bool' }
  | { t: 'nullable'; inner: AllowSpec };

const enumSpec = (values: readonly string[]): AllowSpec => ({ t: 'enum', values: new Set(values) });
const count: AllowSpec = { t: 'int', min: 0, max: MAX_COUNT };
const id: AllowSpec = { t: 'string', max: BUDGETS.maxIdChars, re: /^[A-Za-z0-9_-]+$/ };
/** Enumerated codes: lowercase kebab-case only. */
const code: AllowSpec = { t: 'string', max: BUDGETS.maxIdChars, re: /^[a-z0-9-]+$/ };
/** Evidence ids are counter keys: 'DET-002|returned-sync|api-use,readback-after-text'. */
const evidenceId: AllowSpec = { t: 'string', max: BUDGETS.maxStringChars, re: /^[A-Za-z0-9|,_-]+$/ };

export const FINDING_ALLOWLIST: AllowSpec = {
  t: 'object',
  keys: {
    findingId: id,
    ruleId: id,
    ruleVersion: { t: 'string', max: BUDGETS.maxIdChars, re: /^[A-Za-z0-9.-]+$/ },
    techniqueId: enumSpec(TECHNIQUE_IDS),
    interpretation: enumSpec(INTERPRETATIONS),
    interpretationConfidence: enumSpec(INTERPRETATION_CONFIDENCES),
    evidenceIds: { t: 'array', items: evidenceId, max: 64 },
    counterEvidenceCodes: { t: 'array', items: code, max: 32 },
    limitationCodes: { t: 'array', items: code, max: 32 },
    vendorMatchIds: { t: 'array', items: id, max: 32 },
    coverageRef: id,
  },
  optional: new Set(['coverageRef']),
};

export const TECHNIQUE_SUMMARY_ALLOWLIST: AllowSpec = {
  t: 'object',
  keys: {
    techniqueId: enumSpec(TECHNIQUE_IDS),
    count,
    countQuality: enumSpec(COUNT_QUALITIES),
    phases: { t: 'array', items: enumSpec(PHASES), max: PHASES.length },
    signalCodes: { t: 'array', items: enumSpec(SIGNAL_CODES), max: SIGNAL_CODES.length },
    evidenceSource: enumSpec(EVIDENCE_SOURCES),
    integrity: enumSpec(INTEGRITIES),
    interpretation: enumSpec(INTERPRETATIONS),
    interpretationConfidence: enumSpec(INTERPRETATION_CONFIDENCES),
    attributionConfidence: enumSpec(ATTRIBUTION_CONFIDENCES),
    firstBucket: count,
    lastBucket: count,
    // ADR-017: registry enum only; present only when non-empty (summarizeTechniques).
    operationCodes: { t: 'array', items: enumSpec(OPERATION_CODES), max: BUDGETS.maxOperationCodesPerTechnique },
  },
  optional: new Set(['operationCodes']),
};

/** S07 / ADR-018: browser-observed host entry; exactly one of registrableDomain/category (checked by verifyProjection). */
export const HOST_ENTRY_ALLOWLIST: AllowSpec = {
  t: 'object',
  keys: {
    registrableDomain: { t: 'host' },
    category: enumSpec(HOST_CATEGORIES),
    relation: enumSpec(SITE_RELATIONS),
    evidenceSource: enumSpec(['browser-network']),
    integrity: enumSpec(['browser-observed']),
    requestCount: count,
    firstSeenBucket: count,
    lastSeenBucket: count,
    ruleIds: { t: 'array', items: id, max: 32 },
  },
  optional: new Set(['registrableDomain', 'category']),
};

/** S11 / ADR-019: one disabled sensor family of the document. */
export const DISABLED_SENSOR_ALLOWLIST: AllowSpec = {
  t: 'object',
  keys: {
    sensorId: enumSpec(SENSOR_IDS),
    disabledBy: { t: 'array', items: enumSpec(SENSOR_DISABLE_SOURCES), max: SENSOR_DISABLE_SOURCES.length },
    hooksMayRemain: { t: 'bool' },
  },
};

/** Canonical wire field is vendorConfidence (ADR-001 §1, F040, D2-06/D4-01); vendorMatch is not a wire key. */
export const VENDOR_SUMMARY_ALLOWLIST: AllowSpec = {
  t: 'object',
  keys: {
    vendorId: id,
    vendorConfidence: enumSpec(VENDOR_MATCHES),
    ruleIds: { t: 'array', items: id, max: 32 },
    evidenceSource: enumSpec(EVIDENCE_SOURCES),
    integrity: enumSpec(INTEGRITIES),
  },
};

export const PROJECTION_ALLOWLIST: AllowSpec = {
  t: 'object',
  keys: {
    reportRevision: count,
    documentKey: { t: 'string', max: BUDGETS.maxDocumentKeyChars, re: /^[A-Za-z0-9_:.-]+$/ },
    host: { t: 'nullable', inner: { t: 'host' } },
    coverageState: enumSpec(COVERAGE_STATES),
    coverageFlags: { t: 'array', items: enumSpec(COVERAGE_FLAGS), max: COVERAGE_FLAGS.length },
    techniques: { t: 'array', items: TECHNIQUE_SUMMARY_ALLOWLIST, max: BUDGETS.maxCountersPerDocumentGroup },
    findings: { t: 'array', items: FINDING_ALLOWLIST, max: BUDGETS.maxFindingsPerDocument },
    vendors: { t: 'array', items: VENDOR_SUMMARY_ALLOWLIST, max: BUDGETS.maxHostsPerDocument },
    dropped: {
      t: 'object',
      keys: { observations: count, batches: count, findings: count, hosts: count, counters: count, transport: count, ring: count },
      optional: new Set(['ring']),
    },
    observedSince: { t: 'nullable', inner: { t: 'int', min: 0, max: Number.MAX_SAFE_INTEGER } },
    scopeMode: enumSpec(SCOPE_MODES),
    hosts: { t: 'array', items: HOST_ENTRY_ALLOWLIST, max: BUDGETS.maxHostsPerDocument },
    // S10: WIRE_CATALOG_VERSION_PATTERN; null without an active catalog.
    catalogVersion: { t: 'nullable', inner: { t: 'string', max: 64, re: /^[A-Za-z0-9.-]+$/ } },
    // S11 / ADR-019: optional, registry ids and enum sources only.
    disabledSensors: { t: 'array', items: DISABLED_SENSOR_ALLOWLIST, max: SENSOR_IDS.length },
  },
  optional: new Set(['disabledSensors']),
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Walk `value` against `spec`; every deviation (unknown key, wrong type, unbounded string, ...) is reported. */
export function walkAllowlist(value: unknown, spec: AllowSpec, path: string, out: string[]): void {
  switch (spec.t) {
    case 'nullable':
      if (value === null) return;
      walkAllowlist(value, spec.inner, path, out);
      return;
    case 'host':
      if (!isSanitizedHost(value)) out.push(path + ': not a sanitized host');
      return;
    case 'bool':
      if (typeof value !== 'boolean') out.push(path + ': not a boolean');
      return;
    case 'enum':
      if (typeof value !== 'string' || !spec.values.has(value)) out.push(path + ': not an allowed enum member');
      return;
    case 'int':
      if (typeof value !== 'number' || !Number.isInteger(value) || value < spec.min || value > spec.max) {
        out.push(path + ': not an integer in range');
      }
      return;
    case 'string':
      if (typeof value !== 'string' || value.length < 1 || value.length > spec.max || !spec.re.test(value)) {
        out.push(path + ': string outside the allowed alphabet or length');
      }
      return;
    case 'array': {
      if (!Array.isArray(value)) {
        out.push(path + ': not an array');
        return;
      }
      if (value.length > spec.max) out.push(path + ': too many items');
      value.forEach((item, i) => walkAllowlist(item, spec.items, path + '[' + String(i) + ']', out));
      return;
    }
    case 'object': {
      if (!isPlainObject(value)) {
        out.push(path + ': not a plain object');
        return;
      }
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(spec.keys, key)) {
          out.push(path + '.' + key + ': key not in allowlist');
          continue;
        }
        const child = spec.keys[key];
        if (child !== undefined) walkAllowlist(value[key], child, path + '.' + key, out);
      }
      for (const key of Object.keys(spec.keys)) {
        if (spec.optional?.has(key) === true) continue;
        if (!Object.prototype.hasOwnProperty.call(value, key)) out.push(path + '.' + key + ': missing');
      }
      return;
    }
  }
}

/** Violations of the projection allowlist (empty = clean). Never throws. */
export function verifyProjection(value: unknown): string[] {
  const out: string[] = [];
  try {
    walkAllowlist(value, PROJECTION_ALLOWLIST, '$', out);
    checkHostEntries(value, out);
  } catch {
    out.push('$: exception while walking');
  }
  return out;
}

/** The allowlist DSL cannot say "exactly one of"; hosts also need a PSL registrable domain, not any sanitized host. */
function checkHostEntries(value: unknown, out: string[]): void {
  if (!isPlainObject(value) || !Array.isArray(value['hosts'])) return;
  value['hosts'].forEach((h: unknown, i: number) => {
    if (!isPlainObject(h)) return;
    const at = '$.hosts[' + String(i) + ']';
    const hasDomain = Object.prototype.hasOwnProperty.call(h, 'registrableDomain');
    if (hasDomain === Object.prototype.hasOwnProperty.call(h, 'category')) out.push(at + ': exactly one of registrableDomain/category');
    if (hasDomain && reportHost(h['registrableDomain']) !== h['registrableDomain']) out.push(at + '.registrableDomain: not a registrable domain');
  });
}

// ---------------------------------------------------------------------------
// Technique summaries
// ---------------------------------------------------------------------------

const INTERPRETATION_STRENGTH: Readonly<Record<Interpretation, number>> = {
  'fingerprinting-pattern': 0,
  'possible-fingerprinting': 1,
  'local-probe-pattern': 1,
  'dns-test-pattern': 1,
  unknown: 2,
  'api-use': 3,
};

function strongestFinding(findings: readonly Finding[], techniqueId: TechniqueId): Finding | undefined {
  let best: Finding | undefined;
  for (const f of findings) {
    if (f.techniqueId !== techniqueId) continue;
    if (best === undefined || INTERPRETATION_STRENGTH[f.interpretation] < INTERPRETATION_STRENGTH[best.interpretation]) {
      best = f;
    }
  }
  return best;
}

const PAGE_HOOK_EXCLUDED: ReadonlySet<TechniqueId> = new Set<TechniqueId>(PAGE_HOOK_EXCLUDED_TECHNIQUE_IDS);

export function summarizeTechniques(report: DocumentReport): TechniqueSummary[] {
  const groups = new Map<TechniqueId, CounterEntry[]>();
  for (const c of report.counters) {
    // S07: DET-058…061 are browser-network only; a stored page counter of them is never summarized as page-hook.
    if (PAGE_HOOK_EXCLUDED.has(c.techniqueId)) continue;
    const list = groups.get(c.techniqueId);
    if (list === undefined) groups.set(c.techniqueId, [c]);
    else list.push(c);
  }
  const out: TechniqueSummary[] = [];
  for (const techniqueId of TECHNIQUE_IDS) {
    const list = groups.get(techniqueId);
    if (list === undefined) continue;
    let total = 0;
    let quality: CountQuality = 'exact';
    let first = MAX_COUNT;
    let last = 0;
    const phases: Phase[] = [];
    const signals: SignalCode[] = [];
    const operations = new Set<OperationCode>();
    for (const c of list) {
      total = satAdd(total, c.count);
      quality = worstQuality(quality, c.countQuality);
      first = Math.min(first, c.firstBucket);
      last = Math.max(last, c.lastBucket);
      phases.push(c.phase);
      for (const s of c.signalCodes) signals.push(s);
      if (c.operationCode !== undefined) operations.add(c.operationCode);
    }
    // Keys rejected by the counter cap may belong to any technique: every total is then only a lower bound.
    if (report.dropped.counters > 0) quality = 'lower-bound';
    const f = strongestFinding(report.findings, techniqueId);
    const interpretation: Interpretation = f?.interpretation ?? 'api-use';
    const interpretationConfidence: InterpretationConfidence = f?.interpretationConfidence ?? 'unassessed';
    const summary: TechniqueSummary = {
      techniqueId,
      count: total,
      countQuality: quality,
      phases: sortByEnumOrder(phases, PHASES),
      signalCodes: sortByEnumOrder(signals, SIGNAL_CODES),
      evidenceSource: 'page-hook',
      integrity: 'page-controlled',
      interpretation,
      interpretationConfidence,
      attributionConfidence: attributionConfidence({ evidenceSource: 'page-hook', integrity: 'page-controlled', frameBound: true, scriptKind: 'unknown' }),
      firstBucket: first,
      lastBucket: last,
    };
    const operationCodes = orderedOperations(techniqueId, operations);
    if (operationCodes.length > 0) summary.operationCodes = operationCodes;
    out.push(summary);
  }
  for (const summary of summarizeNetwork(report)) out.push(summary);
  return out;
}

/**
 * Flags under which a browser-network count can only be a minimum (requests outside the observed scope/time).
 * CW-05: 'paused' stays after resume (E06-02 #2); requests during the pause were not counted (onNetworkHost drops them).
 */
const NETWORK_LOWER_BOUND_FLAGS: ReadonlySet<CoverageFlag> = new Set<CoverageFlag>(['network-limited', 'late-start', 'truncated', 'paused']);

/** S07 / ADR-018: one browser-network summary per technique, from report.networkCounters only. */
function summarizeNetwork(report: DocumentReport): TechniqueSummary[] {
  const out: TechniqueSummary[] = [];
  const counters: readonly CounterEntry[] = Array.isArray(report.networkCounters) ? report.networkCounters : [];
  if (counters.length === 0) return out;
  const lowerBound = report.coverageFlags.some((f) => NETWORK_LOWER_BOUND_FLAGS.has(f));
  for (const techniqueId of NETWORK_TECHNIQUE_IDS) {
    const c = counters.find((x) => x.techniqueId === techniqueId && x.phase === 'attempted' && x.count > 0);
    if (c === undefined) continue;
    const pattern = networkPatternMet(techniqueId, report.networkPatterns);
    // A single random-looking subdomain is ordinary: DET-061 is shown only with its window pattern.
    if (techniqueId === 'DET-061' && !pattern) continue;
    const signals: SignalCode[] = ['api-use'];
    if (techniqueId === 'DET-060' && pattern) signals.push('local-multi-port');
    if (techniqueId === 'DET-061') signals.push('unique-subdomains');
    const f = strongestFinding(report.findings, techniqueId);
    out.push({
      techniqueId,
      count: c.count,
      countQuality: lowerBound || c.count >= MAX_COUNT ? 'lower-bound' : c.countQuality,
      phases: ['attempted'],
      signalCodes: sortByEnumOrder(signals, SIGNAL_CODES),
      evidenceSource: 'browser-network',
      integrity: 'browser-observed',
      interpretation: f?.interpretation ?? 'api-use',
      interpretationConfidence: f?.interpretationConfidence ?? 'unassessed',
      attributionConfidence: attributionConfidence({ evidenceSource: 'browser-network', integrity: 'browser-observed', frameBound: true }),
      firstBucket: c.firstBucket,
      lastBucket: c.lastBucket,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hosts (S07, ADR-018): allowlisted copy, never exported.
// ---------------------------------------------------------------------------

const HOST_CATEGORY_SET: ReadonlySet<string> = new Set<string>(HOST_CATEGORIES);
const SITE_RELATION_SET: ReadonlySet<string> = new Set<string>(SITE_RELATIONS);

/** A stored entry is shown/counted only with exactly one of domain/category, a PSL domain and canonical provenance. */
function projectableHost(h: HostEntry): boolean {
  const hasDomain = h.registrableDomain !== undefined;
  if (hasDomain === (h.category !== undefined)) return false;
  if (h.evidenceSource !== 'browser-network' || h.integrity !== 'browser-observed' || !SITE_RELATION_SET.has(h.relation)) return false;
  if (hasDomain) return isSanitizedHost(h.registrableDomain) && reportHost(h.registrableDomain) === h.registrableDomain;
  return HOST_CATEGORY_SET.has(h.category as string);
}

function hostName(h: HostEntry): string {
  return h.registrableDomain ?? h.category ?? 'unknown';
}

/**
 * I1: third party = relation outside {same-origin, same-site} — cross-site, opaque and unknown (an IP target has no
 * registrable domain, ADR-008), the same group as packages/ui counts.ts isThirdPartyRelation.
 */
export function isThirdPartyRelation(relation: SiteRelation): boolean {
  return relation !== 'same-origin' && relation !== 'same-site';
}

function compareHosts(a: HostEntry, b: HostEntry): number {
  const thirdParty = (h: HostEntry): number => (isThirdPartyRelation(h.relation) ? 0 : 1);
  const byParty = thirdParty(a) - thirdParty(b);
  if (byParty !== 0) return byParty;
  if (a.requestCount !== b.requestCount) return b.requestCount - a.requestCount;
  const an = hostName(a);
  const bn = hostName(b);
  if (an !== bn) return an < bn ? -1 : 1;
  return SITE_RELATIONS.indexOf(a.relation) - SITE_RELATIONS.indexOf(b.relation);
}

/**
 * Allowlisted, bounded and sorted copy of the stored hosts (never exported). `keepRule` (S10) filters the stored
 * catalog rule ids: the projection passes "valid in the active catalog" or "none" without one.
 */
export function projectHosts(report: DocumentReport, keepRule: (ruleId: string) => boolean = () => true): HostEntry[] {
  const out: HostEntry[] = [];
  for (const h of report.hosts) {
    if (!projectableHost(h)) continue;
    out.push({
      ...(h.registrableDomain !== undefined ? { registrableDomain: h.registrableDomain } : { category: h.category as NonNullable<HostEntry['category']> }),
      relation: h.relation,
      evidenceSource: h.evidenceSource,
      integrity: h.integrity,
      requestCount: h.requestCount,
      firstSeenBucket: h.firstSeenBucket,
      lastSeenBucket: h.lastSeenBucket,
      ruleIds: (Array.isArray(h.ruleIds) ? h.ruleIds : []).filter((id) => typeof id === 'string' && keepRule(id)).slice(0, 32),
    });
  }
  out.sort(compareHosts);
  return out.slice(0, BUDGETS.maxHostsPerDocument);
}

/**
 * ADR-017: unique operation codes in PAGE_OPERATIONS order. A stored code outside the technique allowlist is not
 * projected here; it would be an engine/storage bug and the repository already discards such snapshots.
 */
function orderedOperations(techniqueId: TechniqueId, seen: ReadonlySet<OperationCode>): OperationCode[] {
  if (seen.size === 0) return [];
  return pageOperations(techniqueId).filter((op) => seen.has(op));
}

function projectFinding(f: Finding, catalogEnabled: boolean): Finding {
  const limitationCodes =
    catalogEnabled || f.limitationCodes.includes(LIMITATION_CODES.catalogDisabled)
      ? f.limitationCodes.slice()
      : [...f.limitationCodes, LIMITATION_CODES.catalogDisabled].slice(0, 32);
  const out: Finding = {
    findingId: f.findingId,
    ruleId: f.ruleId,
    ruleVersion: f.ruleVersion,
    techniqueId: f.techniqueId,
    interpretation: f.interpretation,
    interpretationConfidence: f.interpretationConfidence,
    evidenceIds: f.evidenceIds.slice(0, 64),
    counterEvidenceCodes: f.counterEvidenceCodes.slice(0, 32),
    limitationCodes,
    vendorMatchIds: f.vendorMatchIds.slice(0, 32),
  };
  if (f.coverageRef !== undefined) out.coverageRef = f.coverageRef;
  return out;
}

/**
 * S11 / ADR-019: registry order, one entry per family, sources in SENSOR_DISABLE_SOURCES order. Values outside the
 * enums are copied as they are and then rejected by the allowlist walk (an SW bug, never silently repaired).
 */
function projectDisabledSensors(list: readonly DisabledSensorSummary[] | undefined): DisabledSensorSummary[] {
  if (list === undefined || list.length === 0) return [];
  const out: DisabledSensorSummary[] = [];
  const seen = new Set<string>();
  const ordered = [...list].sort((a, b) => rankOf(SENSOR_IDS, a.sensorId) - rankOf(SENSOR_IDS, b.sensorId));
  for (const entry of ordered) {
    if (seen.has(entry.sensorId)) continue;
    seen.add(entry.sensorId);
    out.push({
      sensorId: entry.sensorId,
      disabledBy: sortByEnumOrder([...new Set(entry.disabledBy)], SENSOR_DISABLE_SOURCES),
      hooksMayRemain: entry.hooksMayRemain,
    });
  }
  return out;
}

function rankOf(order: readonly string[], value: string): number {
  const i = order.indexOf(value);
  return i < 0 ? order.length : i;
}

/** Build the UI/export projection. Throws EngineInvariantError if the result leaves the allowlist (engine bug). */
export function projectReport(report: DocumentReport, opts: ProjectionOptions): ReportProjection {
  const catalog = opts.catalog ?? null;
  const catalogEnabled = catalog !== null && catalogViewActive(catalog.view);
  const keepRule = catalogEnabled ? (ruleId: string): boolean => activeRule(catalog.view, ruleId, catalog.nowMs) !== null : (): boolean => false;
  const hosts = projectHosts(report, keepRule);
  const observedSince =
    opts.observedSince !== undefined ? opts.observedSince : report.counters.length > 0 ? report.createdAt : null;
  const projection: ReportProjection = {
    reportRevision: report.revision,
    documentKey: report.documentKey,
    host: report.host === null || isSanitizedHost(report.host) ? reportHost(report.host) : report.host,
    coverageState: report.coverageState,
    coverageFlags: sortByEnumOrder(report.coverageFlags, COVERAGE_FLAGS),
    techniques: summarizeTechniques(report),
    findings: report.findings.slice(0, BUDGETS.maxFindingsPerDocument).map((f) => projectFinding(f, catalogEnabled)),
    // S10: recognition only with an active catalog (production rules passed the ADR-009 gate, or the test profile's
    // synthetic catalog); otherwise nothing is linked (REQ-008).
    vendors: catalogEnabled ? deriveVendors(hosts, catalog.view, catalog.nowMs) : [],
    dropped: {
      observations: report.dropped.observations,
      batches: report.dropped.batches,
      findings: report.dropped.findings,
      hosts: report.dropped.hosts,
      counters: report.dropped.counters,
      transport: report.dropped.transport,
      ...(report.dropped.ring === undefined ? {} : { ring: report.dropped.ring }),
    },
    observedSince,
    scopeMode: opts.scopeMode,
    hosts,
    catalogVersion: catalogEnabled ? catalog.view.catalogVersion : null,
  };
  const disabledSensors = projectDisabledSensors(opts.disabledSensors);
  if (disabledSensors.length > 0) projection.disabledSensors = disabledSensors;
  const violations = verifyProjection(projection);
  if (violations.length > 0) throw new EngineInvariantError(violations);
  return projection;
}

// ---------------------------------------------------------------------------
// Sources (browser-observed hosts) summarized without listing them.
// ---------------------------------------------------------------------------

/** Site relation of a network host to its request initiator (contracts SITE_RELATIONS; ADR-008, ADR-018). */
export { SITE_RELATIONS };
export type { SiteRelation };

export interface SourceOptions {
  /** List the hosts (registrable domain or category, sorted). Off by default: the popup shows counts only. */
  includeHosts?: boolean;
}

export interface SourceSummary {
  /** Distinct hosts recorded (bounded by BUDGETS.maxHostsPerDocument). */
  total: number;
  byRelation: Record<SiteRelation, number>;
  /** Total requests across hosts (saturating). */
  requests: number;
  /** Hosts evicted by the per-document cap. */
  dropped: number;
  /** Only with includeHosts. */
  hosts?: string[];
}

/** Counts stored hosts by their recorded relation (computed by the SW from scheme/host/port before redaction). */
export function summarizeSources(report: DocumentReport, opts: SourceOptions = {}): SourceSummary {
  const byRelation: Record<SiteRelation, number> = {
    'same-origin': 0,
    'same-site': 0,
    'cross-site': 0,
    opaque: 0,
    unknown: 0,
  };
  let requests = 0;
  let total = 0;
  const hosts: string[] = [];
  for (const h of report.hosts) {
    // A malformed stored host is never counted or listed (defence in depth, REQ-005).
    if (!projectableHost(h)) continue;
    total++;
    byRelation[h.relation]++;
    requests = satAdd(requests, h.requestCount);
    if (opts.includeHosts === true) hosts.push(h.registrableDomain ?? h.category ?? 'unknown');
  }
  const summary: SourceSummary = { total, byRelation, requests, dropped: report.dropped.hosts };
  if (opts.includeHosts === true) summary.hosts = hosts.sort();
  return summary;
}
