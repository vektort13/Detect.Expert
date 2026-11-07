import { reportHost } from '../../attribution/src/index';
import { attributionConfidence } from './attribution';
// Read-only projection for the UI/export (REQ-005, REQ-013, REQ-014; ADR-007 §5; E13/E14). The projection is
// built field by field from the stored report and then walked against PROJECTION_ALLOWLIST: a value outside the
// allowlist is an engine bug and throws (a thrown error is safer than a leaking projection).
//
// Slice 1 facts stated by the projection:
// - vendors: [] and every finding carries the 'catalog-disabled' limitation (no vendor linkage was attempted).
// - hosts are never listed in the projection (the contract has no field for them). summarizeSources() gives counts
//   by site relation for the popup's third number; raw hosts only with includeHosts.
// - page-hook counters have no script evidence: attributionConfidence stays unknown (ADR-008).

import {
  ATTRIBUTION_CONFIDENCES,
  BUDGETS,
  COUNT_QUALITIES,
  COVERAGE_FLAGS,
  COVERAGE_STATES,
  EVIDENCE_SOURCES,
  INTEGRITIES,
  INTERPRETATIONS,
  INTERPRETATION_CONFIDENCES,
  MAX_COUNT,
  PHASES,
  SCOPE_MODES,
  SIGNAL_CODES,
  TECHNIQUE_IDS,
  VENDOR_MATCHES,
  isSanitizedHost,
  type CounterEntry,
  type CountQuality,
  type DocumentReport,
  type Finding,
  type Interpretation,
  type InterpretationConfidence,
  type Phase,
  type ReportProjection,
  type ScopeMode,
  type SignalCode,
  type TechniqueId,
  type TechniqueSummary,
} from '@detect-expert/contracts';
import { satAdd, sortByEnumOrder, worstQuality } from './arith';
import { LIMITATION_CODES } from './codes';

export interface ProjectionOptions {
  scopeMode: ScopeMode;
  /** Vendor catalog active in this build (slice 1: false). */
  catalogEnabled?: boolean;
  /** Override for observedSince (ms epoch); default = report.createdAt when any counter exists. */
  observedSince?: number | null;
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
  },
};

export const VENDOR_SUMMARY_ALLOWLIST: AllowSpec = {
  t: 'object',
  keys: {
    vendorId: id,
    vendorMatch: enumSpec(VENDOR_MATCHES),
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
  },
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
  } catch {
    out.push('$: exception while walking');
  }
  return out;
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

export function summarizeTechniques(report: DocumentReport): TechniqueSummary[] {
  const groups = new Map<TechniqueId, CounterEntry[]>();
  for (const c of report.counters) {
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
    for (const c of list) {
      total = satAdd(total, c.count);
      quality = worstQuality(quality, c.countQuality);
      first = Math.min(first, c.firstBucket);
      last = Math.max(last, c.lastBucket);
      phases.push(c.phase);
      for (const s of c.signalCodes) signals.push(s);
    }
    // Keys rejected by the counter cap may belong to any technique: every total is then only a lower bound.
    if (report.dropped.counters > 0) quality = 'lower-bound';
    const f = strongestFinding(report.findings, techniqueId);
    const interpretation: Interpretation = f?.interpretation ?? 'api-use';
    const interpretationConfidence: InterpretationConfidence = f?.interpretationConfidence ?? 'unassessed';
    out.push({
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
    });
  }
  return out;
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

/** Build the UI/export projection. Throws EngineInvariantError if the result leaves the allowlist (engine bug). */
export function projectReport(report: DocumentReport, opts: ProjectionOptions): ReportProjection {
  const catalogEnabled = opts.catalogEnabled === true;
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
    // Slice 1: the catalog is disabled; recognition would need production-enabled rules (REQ-008, ADR-009).
    vendors: [],
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
  };
  const violations = verifyProjection(projection);
  if (violations.length > 0) throw new EngineInvariantError(violations);
  return projection;
}

// ---------------------------------------------------------------------------
// Sources (browser-observed hosts) summarized without listing them.
// ---------------------------------------------------------------------------

/** Site relation of a network host to the document (docs/data-inventory.md §2). */
export const SITE_RELATIONS = ['same-origin', 'same-site', 'cross-site', 'opaque', 'unknown'] as const;
export type SiteRelation = (typeof SITE_RELATIONS)[number];

export type SiteRelationClassifier = (host: string, documentHost: string | null) => SiteRelation;

/** Host-only compatibility classifier cannot establish an origin (scheme/port were removed). */
export const hostEqualityRelation: SiteRelationClassifier = (host, documentHost) => {
  if (documentHost === null) return 'unknown';
  return host === documentHost ? 'same-site' : 'cross-site';
};

export interface SourceOptions {
  /** List the sanitized hosts (sorted). Off by default: the popup shows counts only. */
  includeHosts?: boolean;
  siteRelation?: SiteRelationClassifier;
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

export function summarizeSources(report: DocumentReport, opts: SourceOptions = {}): SourceSummary {
  const classify = opts.siteRelation ?? hostEqualityRelation;
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
    // A stored host that is not sanitized is never counted or listed (defence in depth, REQ-005).
    if (h.registrableDomain !== undefined && !isSanitizedHost(h.registrableDomain)) continue;
    total++;
    byRelation[opts.siteRelation && h.registrableDomain ? classify(h.registrableDomain, report.host) : h.relation]++;
    requests = satAdd(requests, h.requestCount);
    if (opts.includeHosts === true) hosts.push(h.registrableDomain ?? h.category ?? 'unknown');
  }
  const summary: SourceSummary = { total, byRelation, requests, dropped: report.dropped.hosts };
  if (opts.includeHosts === true) summary.hosts = hosts.sort();
  return summary;
}
