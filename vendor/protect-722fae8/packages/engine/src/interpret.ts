// Interpretation pipeline: (report, batch, coverage context) -> report' with findings and coverageState.
// Findings are a pure function of counters + coverage, recomputed in full each time (idempotent).

import type { DocumentReport, Finding, PageBatch } from '@detect-expert/contracts';
import { sameStrings, satAdd } from './arith';
import { computeCoverageState, coverageRef, DEFAULT_COVERAGE_CONTEXT, type CoverageContext } from './coverage';
import { mergeObservations, type MergeOptions } from './merge';
import { runRules } from './rules/index';

export interface InterpretResult {
  report: DocumentReport;
  /** Findings, coverageState or dropped.findings changed. */
  changed: boolean;
}

function sameFinding(a: Finding, b: Finding): boolean {
  return (
    a.findingId === b.findingId &&
    a.ruleId === b.ruleId &&
    a.ruleVersion === b.ruleVersion &&
    a.techniqueId === b.techniqueId &&
    a.interpretation === b.interpretation &&
    a.interpretationConfidence === b.interpretationConfidence &&
    a.coverageRef === b.coverageRef &&
    sameStrings(a.evidenceIds, b.evidenceIds) &&
    sameStrings(a.counterEvidenceCodes, b.counterEvidenceCodes) &&
    sameStrings(a.limitationCodes, b.limitationCodes) &&
    sameStrings(a.vendorMatchIds, b.vendorMatchIds)
  );
}

export function sameFindings(a: readonly Finding[], b: readonly Finding[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined || !sameFinding(x, y)) return false;
  }
  return true;
}

function derive(report: DocumentReport, ctx: CoverageContext, bump: boolean): InterpretResult {
  const coverageState = computeCoverageState(report.coverageFlags, ctx);
  const ref = coverageRef(coverageState, report.coverageFlags);
  const { findings, dropped } = runRules({
    counters: report.counters,
    coverageFlags: report.coverageFlags,
    coverageRef: ref,
    // S07 / ADR-018: SW-written browser-network data, read only by the network rule.
    network: { counters: report.networkCounters, patterns: report.networkPatterns },
  });
  const changed =
    coverageState !== report.coverageState || dropped !== report.dropped.findings || !sameFindings(findings, report.findings);
  if (!changed) return { report, changed: false };
  return {
    report: {
      ...report,
      coverageState,
      findings,
      dropped: dropped === report.dropped.findings ? report.dropped : { ...report.dropped, findings: dropped },
      revision: bump ? satAdd(report.revision, 1) : report.revision,
    },
    changed: true,
  };
}

/** Recompute findings and coverageState; bumps revision when something changed. */
export function interpretReport(report: DocumentReport, ctx: CoverageContext = DEFAULT_COVERAGE_CONTEXT): InterpretResult {
  return derive(report, ctx, true);
}

export interface ApplyResult {
  report: DocumentReport;
  changed: boolean;
  duplicate: boolean;
}

/** Merge a batch, then re-interpret. One revision bump per applied batch. */
export function applyBatch(
  report: DocumentReport,
  batch: PageBatch,
  ctx: CoverageContext = DEFAULT_COVERAGE_CONTEXT,
  opts: MergeOptions = {},
): ApplyResult {
  const merged = mergeObservations(report, batch, opts);
  if (merged.duplicate) return { report, changed: false, duplicate: true };
  if (!merged.changed) return { report: merged.report, changed: false, duplicate: false };
  const interpreted = derive(merged.report, ctx, false);
  return { report: interpreted.report, changed: true, duplicate: false };
}
