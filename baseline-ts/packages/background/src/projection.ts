import { attributionConfidence } from '@detect-expert/engine';
import { projectReport as engineProjectReport } from '@detect-expert/engine';
import { hasEnabledVendorResourceRules, lookupVendorResourceRule } from '../../catalog/src/index';
// Read-only projection of a stored DocumentReport for the UI (docs/PROJECT_RULES.md protocol v1, spec A5 §5).
// The projection is already redacted by construction: the stored model contains hosts, enum codes and
// saturating counters only (REQ-005). Export returns exactly this projection (REQ-013).

import { MAX_COUNT, PHASES } from '@detect-expert/contracts';
import type {
  CountQuality,
  CounterEntry,
  DocumentReport,
  Finding,
  Interpretation,
  InterpretationConfidence,
  Phase,
  ReportProjection,
  ScopeMode,
  TechniqueId,
  TechniqueSummary,
  VendorSummary,
} from '@detect-expert/contracts';
import type { DocumentMeta } from './documents';

const PHASE_ORDER: ReadonlyMap<Phase, number> = new Map(PHASES.map((p, i) => [p, i]));
const CONFIDENCE_RANK: ReadonlyMap<InterpretationConfidence, number> = new Map(
  // unassessed < low < medium < high
  [['unassessed', 0], ['low', 1], ['medium', 2], ['high', 3]],
);
const QUALITY_RANK: Record<CountQuality, number> = { exact: 0, sampled: 1, 'lower-bound': 2 };

function bestFinding(findings: readonly Finding[], techniqueId: TechniqueId): Finding | null {
  let best: Finding | null = null;
  for (const f of findings) {
    if (f.techniqueId !== techniqueId) continue;
    if (best === null || (CONFIDENCE_RANK.get(f.interpretationConfidence) ?? 0) > (CONFIDENCE_RANK.get(best.interpretationConfidence) ?? 0)) {
      best = f;
    }
  }
  return best;
}

function satAdd(a: number, b: number): number {
  const sum = a + b;
  return sum > MAX_COUNT ? MAX_COUNT : sum;
}

/**
 * One summary per techniqueId. Counters are per (technique, phase, signalCodes) and every observed call lands in
 * exactly one key (the sensor assigns one static phase per API call: `attempted` is used only where the outcome
 * is never observed, never as a superset), so the technique count is the saturating sum across its entries.
 * A bfcache-restore re-key (same technique, extra signal code) therefore adds up instead of hiding the growth.
 */
export function projectTechniques(counters: readonly CounterEntry[], findings: readonly Finding[]): TechniqueSummary[] {
  const byTechnique = new Map<TechniqueId, TechniqueSummary>();
  for (const c of counters) {
    const existing = byTechnique.get(c.techniqueId);
    if (existing === undefined) {
      const finding = bestFinding(findings, c.techniqueId);
      const interpretation: Interpretation = finding?.interpretation ?? 'api-use';
      const confidence: InterpretationConfidence = finding?.interpretationConfidence ?? 'unassessed';
      byTechnique.set(c.techniqueId, {
        techniqueId: c.techniqueId,
        count: c.count,
        countQuality: c.countQuality,
        phases: [c.phase],
        signalCodes: [...c.signalCodes],
        evidenceSource: 'page-hook',
        integrity: 'page-controlled',
        interpretation,
        interpretationConfidence: confidence,
        attributionConfidence: attributionConfidence({ evidenceSource: 'page-hook', integrity: 'page-controlled', frameBound: true, scriptKind: 'unknown' }),
        firstBucket: c.firstBucket,
        lastBucket: c.lastBucket,
      });
      continue;
    }
    existing.count = satAdd(existing.count, c.count);
    if (QUALITY_RANK[c.countQuality] > QUALITY_RANK[existing.countQuality]) existing.countQuality = c.countQuality;
    if (!existing.phases.includes(c.phase)) existing.phases.push(c.phase);
    for (const s of c.signalCodes) if (!existing.signalCodes.includes(s)) existing.signalCodes.push(s);
    existing.firstBucket = Math.min(existing.firstBucket, c.firstBucket);
    existing.lastBucket = Math.max(existing.lastBucket, c.lastBucket);
  }
  const out = [...byTechnique.values()];
  for (const t of out) {
    t.phases.sort((a, b) => (PHASE_ORDER.get(a) ?? 0) - (PHASE_ORDER.get(b) ?? 0));
    t.signalCodes.sort();
  }
  out.sort((a, b) => (a.techniqueId < b.techniqueId ? -1 : a.techniqueId > b.techniqueId ? 1 : 0));
  return out;
}

/** Resolve persisted IDs against the current reviewed catalog; hosts never leave this layer. */
export function projectVendors(report: DocumentReport, at = Date.now()): VendorSummary[] {
  const byVendor = new Map<string, VendorSummary>();
  for (const h of report.hosts) {
    for (const ruleId of h.ruleIds) {
      const match = lookupVendorResourceRule(ruleId, at);
      if (match === null) continue;
      const existing = byVendor.get(match.vendorId);
      if (existing === undefined) {
        byVendor.set(match.vendorId, {
          vendorId: match.vendorId,
          vendorConfidence: 'documented-resource',
          ruleIds: [ruleId],
          evidenceSource: 'browser-network',
          integrity: 'browser-observed',
        });
      } else if (existing.ruleIds.length < 32 && !existing.ruleIds.includes(ruleId)) {
        existing.ruleIds.push(ruleId);
      }
    }
  }
  const vendors = [...byVendor.values()];
  for (const vendor of vendors) vendor.ruleIds.sort();
  return vendors.sort((a, b) => a.vendorId < b.vendorId ? -1 : a.vendorId > b.vendorId ? 1 : 0);
}

/** ADR-024: a weaker page-controlled rule must never inherit browser-network provenance. */
export function mergeVendorSummaries(...groups: readonly (readonly VendorSummary[])[]): VendorSummary[] {
  const vendors = new Map<string, VendorSummary>();
  const rank = { none: 0, 'weak-signal': 1, 'multi-signal': 2, 'documented-resource': 3 };
  for (const group of groups) for (const value of group) {
    const previous = vendors.get(value.vendorId);
    if (!previous || rank[value.vendorConfidence] > rank[previous.vendorConfidence]) {
      if (vendors.size < 128 || previous) vendors.set(value.vendorId, { ...value, ruleIds: value.ruleIds.slice(0, 32) });
    } else if (value.vendorConfidence === previous.vendorConfidence && value.evidenceSource === previous.evidenceSource && value.integrity === previous.integrity) {
      for (const ruleId of value.ruleIds) if (previous.ruleIds.length < 32 && !previous.ruleIds.includes(ruleId)) previous.ruleIds.push(ruleId);
    }
  }
  for (const value of vendors.values()) value.ruleIds.sort();
  return [...vendors.values()].sort((a, b) => a.vendorId.localeCompare(b.vendorId));
}

export function projectReport(report: DocumentReport, meta: DocumentMeta, scopeMode: ScopeMode, at = Date.now(),
  additionalVendors: readonly VendorSummary[] = [], vendorObservedAt: number | null = null): ReportProjection {
  const denied = meta.revoked || meta.accessGranted === false || scopeMode === 'off';
  const vendors = denied ? [] : mergeVendorSummaries(projectVendors(report, at), additionalVendors);
  const observedSince = meta.firstObservationAt === null ? vendorObservedAt : vendorObservedAt === null ? meta.firstObservationAt : Math.min(meta.firstObservationAt, vendorObservedAt);
  return engineProjectReport(report, { scopeMode, catalogEnabled: hasEnabledVendorResourceRules(at) || additionalVendors.length > 0,
    vendors, observedSince: denied ? null : observedSince, browserNetworkCounters: denied ? [] : meta.networkCounters ?? [],
    ...(!denied && meta.responseHeaders ? { responseHeaders: meta.responseHeaders } : {}),
    ...(!denied && meta.requestedLocalPorts ? { requestedLocalPorts: meta.requestedLocalPorts } : {}) });
}
