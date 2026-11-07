import { reportHost } from '../../attribution/src/index';
import { attributionConfidence } from './attribution';
// Read-only projection for the UI/export (REQ-005, REQ-013, REQ-014; ADR-007 §5; E13/E14). The projection is
// built field by field from the stored report and then walked against PROJECTION_ALLOWLIST: a value outside the
// allowlist is an engine bug and throws (a thrown error is safer than a leaking projection).
//
// Facts stated by the projection:
// - vendor summaries are supplied by the reviewed browser-resource catalog, independently of API findings.
// - hosts are never listed in the projection (the contract has no field for them). summarizeSources() gives counts
//   by site relation for the popup's third number; raw hosts only with includeHosts.
// - page-hook counters have no script evidence: attributionConfidence stays unknown (ADR-008).

import {
  API_OPERATIONS,
  apiOperationAllows,
  readApiOperations,
  EXTENSION_TARGET_KEYS,
  EXTENSION_RESOURCE_METHODS,
  extensionResourceAllows,
  readExtensionResource,
  readExtensionResources,
  readRequestedLocalPorts,
  REQUESTED_LOCAL_PORTS_LIMIT,
  RESPONSE_HEADER_NAMES,
  CLIENT_HINT_NAMES,
  readResponseHeaders,
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
  MAX_PERMISSION_CHECKS,
  PERMISSION_NAMES,
  PERMISSION_CHECK_KINDS,
  PERMISSION_CHECK_RESULTS,
  readPermissionChecks,
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
  type RequestedLocalPorts,
  type ResponseHeadersSummary,
  type ScopeMode,
  type SignalCode,
  type TechniqueId,
  type TechniqueSummary,
  type VendorSummary,
} from '@detect-expert/contracts';
import { satAdd, sortByEnumOrder, worstQuality } from './arith';
import { LIMITATION_CODES } from './codes';
import { coverageRef } from './coverage';
import { browserNetworkFindings } from './network-findings';
import { summarizePermissionChecks } from './permission-checks';

export interface ProjectionOptions {
  scopeMode: ScopeMode;
  /** At least one reviewed resource rule is active at projection time. */
  catalogEnabled?: boolean;
  /** Already resolved browser-resource matches; never inferred from technique counters. */
  vendors?: readonly VendorSummary[];
  /** Override for observedSince (ms epoch); default = report.createdAt when any counter exists. */
  observedSince?: number | null;
  /** SW-owned request aggregates only; never sourced from MAIN or an ordinary PageBatch. */
  browserNetworkCounters?: readonly CounterEntry[];
  requestedLocalPorts?: RequestedLocalPorts;
  responseHeaders?: ResponseHeadersSummary;
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
  | { t: 'boolean' }
  | { t: 'string'; max: number; re: RegExp }
  | { t: 'host' }
  | { t: 'nullable'; inner: AllowSpec };

const enumSpec = (values: readonly string[]): AllowSpec => ({ t: 'enum', values: new Set(values) });
const count: AllowSpec = { t: 'int', min: 0, max: MAX_COUNT };
const id: AllowSpec = { t: 'string', max: BUDGETS.maxIdChars, re: /^[A-Za-z0-9_-]+$/ };
/** Enumerated codes: lowercase kebab-case only. */
const code: AllowSpec = { t: 'string', max: BUDGETS.maxIdChars, re: /^[a-z0-9-]+$/ };
/** Evidence ids are counter keys: 'DET-002|returned-sync|api-use,readback-after-text'. */
const evidenceId: AllowSpec = { t: 'string', max: BUDGETS.maxStringChars, re: /^[A-Za-z0-9.|,_-]+$/ };

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
      keys: { observations: count, batches: count, findings: count, hosts: count, counters: count, transport: count },
    },
    observedSince: { t: 'nullable', inner: { t: 'int', min: 0, max: Number.MAX_SAFE_INTEGER } },
    scopeMode: enumSpec(SCOPE_MODES),
    permissionChecks: { t: 'array', max: MAX_PERMISSION_CHECKS, items: { t: 'object', keys: {
      permission: enumSpec(PERMISSION_NAMES), kind: enumSpec(PERMISSION_CHECK_KINDS), result: enumSpec(PERMISSION_CHECK_RESULTS),
      count: { t: 'int', min: 1, max: MAX_COUNT }, countQuality: enumSpec(COUNT_QUALITIES),
    } } },
    apiOperations: { t: 'array', max: BUDGETS.maxCountersPerDocumentGroup, items: { t: 'object', keys: {
      apiOperation: enumSpec(API_OPERATIONS), phase: enumSpec(PHASES), count: { t: 'int', min: 1, max: MAX_COUNT },
      countQuality: enumSpec(COUNT_QUALITIES),
    } } },
    requestedLocalPorts: { t: 'object', keys: {
      ports: { t: 'array', items: { t: 'int', min: 0, max: 65535 }, max: REQUESTED_LOCAL_PORTS_LIMIT },
      truncated: { t: 'boolean' },
    } },
    extensionResources: { t: 'array', max: BUDGETS.maxCountersPerDocumentGroup, items: { t: 'object', keys: {
      target: enumSpec(EXTENSION_TARGET_KEYS), method: enumSpec(EXTENSION_RESOURCE_METHODS), phase: enumSpec(PHASES),
      count: { t: 'int', min: 1, max: MAX_COUNT }, countQuality: enumSpec(COUNT_QUALITIES),
    } } },
    responseHeaders: { t: 'object', keys: {
      entries: { t: 'array', max: RESPONSE_HEADER_NAMES.length, items: { t: 'object', keys: {
        name: enumSpec(RESPONSE_HEADER_NAMES), count: { t: 'int', min: 1, max: MAX_COUNT },
        clientHints: { t: 'array', max: CLIENT_HINT_NAMES.length, items: enumSpec(CLIENT_HINT_NAMES) },
      } } }, truncated: { t: 'boolean' },
    } },
  },
  optional: new Set(['permissionChecks', 'apiOperations', 'requestedLocalPorts', 'extensionResources', 'responseHeaders']),
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
    case 'boolean':
      if (typeof value !== 'boolean') out.push(path + ': not a boolean');
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
    if (isPlainObject(value) && Object.hasOwn(value, 'permissionChecks') && readPermissionChecks(value['permissionChecks']) === null) {
      out.push('$.permissionChecks: invalid paired permission checks');
    }
    if (isPlainObject(value) && Object.hasOwn(value, 'apiOperations') && readApiOperations(value['apiOperations']) === null) {
      out.push('$.apiOperations: invalid operation summaries');
    }
    if (isPlainObject(value) && Object.hasOwn(value, 'extensionResources') && readExtensionResources(value['extensionResources']) === null) {
      out.push('$.extensionResources: invalid resource summaries');
    }
    if (isPlainObject(value) && Object.hasOwn(value, 'requestedLocalPorts')) {
      if (readRequestedLocalPorts(value['requestedLocalPorts']) === null || !Array.isArray(value['techniques']) ||
          !value['techniques'].some(technique => technique.techniqueId === 'DET-060' && technique.count > 0 &&
            technique.evidenceSource === 'browser-network' && technique.integrity === 'browser-observed')) {
        out.push('$.requestedLocalPorts: invalid browser-owned port list');
      }
    }
    if (isPlainObject(value) && Array.isArray(value['techniques'])) {
        const headers = value['techniques'].filter(technique => technique.techniqueId === 'DET-074');
        const header = headers[0];
      const details = Object.hasOwn(value, 'responseHeaders') ? readResponseHeaders(value['responseHeaders']) : undefined;
      const total = details?.entries.reduce((sum, entry) => Math.min(MAX_COUNT, sum + entry.count), 0) ?? 0;
        if (details === null || headers.length !== (total > 0 ? 1 : 0) || header && (!details || header.count !== total || header.evidenceSource !== 'browser-network' ||
          header.integrity !== 'browser-observed' || header.phases.length !== 0 || header.signalCodes.length !== 0 || header.interpretation !== 'unknown' ||
          header.attributionConfidence !== 'frame-only' || header.firstBucket !== 0 || header.lastBucket !== 0 ||
          header.interpretationConfidence !== 'unassessed' || header.countQuality !== (details.truncated || total === MAX_COUNT ? 'lower-bound' : 'exact'))) {
        out.push('$.responseHeaders: invalid browser-owned header metadata');
      }
    }
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
    if (c.techniqueId === 'DET-074') continue;
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
      if (total + c.count > MAX_COUNT) quality = 'lower-bound';
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
  const network = opts.browserNetworkCounters ?? [];
  if (network.length > 4 || network.some(counter =>
    Object.hasOwn(counter, 'apiOperation') || Object.hasOwn(counter, 'extensionResource') ||
    !['DET-058', 'DET-060', 'DET-061'].includes(counter.techniqueId) || counter.phase !== 'attempted' ||
    !Number.isInteger(counter.count) || counter.count < 0 || counter.count > MAX_COUNT ||
    counter.signalCodes[0] !== 'api-use' || counter.signalCodes.length < 1 || counter.signalCodes.length > 2 ||
    (counter.techniqueId === 'DET-061' ? counter.signalCodes.length !== 2 || counter.signalCodes[1] !== 'unique-subdomains' || counter.countQuality !== 'lower-bound'
      : counter.signalCodes.length === 2 && (counter.techniqueId !== 'DET-060' || counter.signalCodes[1] !== 'local-multi-port')))) {
    throw new EngineInvariantError(['browser network counters outside the internal allowlist']);
  }
  const positiveNetwork = network.filter(counter => counter.count > 0);
  const browserIds = new Set(positiveNetwork.map(counter => counter.techniqueId));
  const networkFindings = browserNetworkFindings(positiveNetwork, coverageRef(report.coverageState, report.coverageFlags));
  // A page can spoof canonical IDs and signal codes. It cannot supply browser facts or their findings.
  // Keep the independently counted browser attempts when sources collide; do not add hook counts to them.
  const findings = [...networkFindings, ...report.findings.filter(finding => !browserIds.has(finding.techniqueId))];
  const findingOverflow = Math.max(0, findings.length - BUDGETS.maxFindingsPerDocument);
  const projectedReport = browserIds.size ? { ...report,
    counters: [...report.counters.filter(counter => !browserIds.has(counter.techniqueId)), ...positiveNetwork],
    findings,
  } : report;
  const catalogEnabled = opts.catalogEnabled === true;
  const vendors = catalogEnabled ? (opts.vendors ?? []).slice(0, BUDGETS.maxHostsPerDocument).map(v => ({
    vendorId: v.vendorId, vendorConfidence: v.vendorConfidence, ruleIds: v.ruleIds.slice(0, 32),
    evidenceSource: v.evidenceSource, integrity: v.integrity,
  })) : [];
  const observedSince =
    opts.observedSince !== undefined ? opts.observedSince : projectedReport.counters.length > 0 || vendors.length > 0 ? report.createdAt : null;
  const projection: ReportProjection = {
    reportRevision: report.revision,
    documentKey: report.documentKey,
    host: report.host === null || isSanitizedHost(report.host) ? reportHost(report.host) : report.host,
    coverageState: report.coverageState,
    coverageFlags: sortByEnumOrder(report.coverageFlags, COVERAGE_FLAGS),
    techniques: summarizeTechniques(projectedReport).map(technique => browserIds.has(technique.techniqueId)
      ? { ...technique, evidenceSource: 'browser-network', integrity: 'browser-observed', attributionConfidence: 'frame-only' }
      : technique),
    findings: findings.slice(0, BUDGETS.maxFindingsPerDocument).map((f) => projectFinding(f, catalogEnabled)),
    vendors,
    dropped: {
      observations: report.dropped.observations,
      batches: report.dropped.batches,
      findings: satAdd(report.dropped.findings, findingOverflow),
      hosts: report.dropped.hosts,
      counters: report.dropped.counters,
      transport: report.dropped.transport,
    },
    observedSince,
    scopeMode: opts.scopeMode,
  };
  const permissionChecks = summarizePermissionChecks(projectedReport.counters);
  if (permissionChecks.length) projection.permissionChecks = permissionChecks;
  const operations = projectedReport.counters.filter(counter => counter.apiOperation !== undefined && counter.count > 0);
  if (operations.some(counter => !apiOperationAllows(counter.apiOperation, counter.techniqueId, counter.phase) ||
      counter.signalCodes.length !== 1 || counter.signalCodes[0] !== 'api-use')) throw new EngineInvariantError(['invalid operation counter']);
  if (operations.length) projection.apiOperations = operations.map(counter => ({ apiOperation: counter.apiOperation!, phase: counter.phase,
    count: counter.count, countQuality: report.dropped.counters > 0 ? 'lower-bound' : counter.countQuality }));
  const resources = projectedReport.counters.filter(counter => counter.extensionResource !== undefined && counter.count > 0);
  if (resources.length) projection.extensionResources = resources.map(counter => {
    const resource = readExtensionResource(counter.extensionResource);
    if (!resource || counter.apiOperation !== undefined || !extensionResourceAllows(resource, counter.techniqueId, counter.phase) ||
        counter.signalCodes.length !== 1 || counter.signalCodes[0] !== 'api-use') throw new EngineInvariantError(['invalid extension resource counter']);
    return { ...resource, phase: counter.phase, count: counter.count,
      countQuality: report.dropped.counters > 0 ? 'lower-bound' : counter.countQuality };
  });
  if (opts.requestedLocalPorts !== undefined && browserIds.has('DET-060')) {
    const ports = readRequestedLocalPorts(opts.requestedLocalPorts);
    if (ports === null) throw new EngineInvariantError(['invalid requested local ports']);
    projection.requestedLocalPorts = ports;
  }
  if (findingOverflow > 0 && !projection.coverageFlags.includes('truncated')) {
    projection.coverageFlags = sortByEnumOrder([...projection.coverageFlags, 'truncated'], COVERAGE_FLAGS);
    if (['active', 'partial', 'late-start'].includes(projection.coverageState)) projection.coverageState = 'degraded';
    const ref = coverageRef(projection.coverageState, projection.coverageFlags);
    projection.findings = projection.findings.map(finding => ({ ...finding, coverageRef: ref }));
  }
  const violations = verifyProjection(projection);
  if (violations.length > 0) throw new EngineInvariantError(violations);
  return opts.responseHeaders === undefined ? projection : attachResponseHeaders(projection, opts.responseHeaders);
}

export function attachResponseHeaders(projection: ReportProjection, value: ResponseHeadersSummary): ReportProjection {
  const responseHeaders = readResponseHeaders(value);
  if (!responseHeaders) throw new EngineInvariantError(['invalid response headers']);
  const techniques = projection.techniques.filter(technique => technique.techniqueId !== 'DET-074');
  const count = responseHeaders.entries.reduce((sum, entry) => Math.min(MAX_COUNT, sum + entry.count), 0);
  if (count > 0) techniques.push({ techniqueId: 'DET-074', count, countQuality: responseHeaders.truncated || count === MAX_COUNT ? 'lower-bound' : 'exact',
    phases: [], signalCodes: [], evidenceSource: 'browser-network', integrity: 'browser-observed', interpretation: 'unknown',
    interpretationConfidence: 'unassessed', attributionConfidence: 'frame-only', firstBucket: 0, lastBucket: 0 });
  const result = { ...projection, techniques, responseHeaders };
  const violations = verifyProjection(result);
  if (violations.length) throw new EngineInvariantError(violations);
  return result;
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
