import { attributionConfidence } from '@detect-expert/engine';
import { projectReport as engineProjectReport } from '@detect-expert/engine';
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

/** Vendor rows come from catalog rule matches on browser-observed hosts; no catalog is wired in v1. */
export function projectVendors(report: DocumentReport): VendorSummary[] {
  const byRule = new Map<string, VendorSummary>();
  for (const h of report.hosts) {
    for (const ruleId of h.ruleIds) {
      if (!byRule.has(ruleId)) {
        byRule.set(ruleId, {
          vendorId: ruleId,
          vendorConfidence: 'weak-signal',
          ruleIds: [ruleId],
          evidenceSource: 'browser-network',
          integrity: 'browser-observed',
        });
      }
    }
  }
  return [...byRule.values()];
}

export function projectReport(report: DocumentReport, meta: DocumentMeta, scopeMode: ScopeMode): ReportProjection {
  return engineProjectReport(report, { scopeMode, catalogEnabled: false, observedSince: meta.revoked || meta.accessGranted === false || scopeMode === 'off' ? null : meta.firstObservationAt });
}
