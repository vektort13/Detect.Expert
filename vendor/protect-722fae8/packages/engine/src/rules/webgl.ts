// Rule 'webgl-capability-probe' v1 (E07-03, S04; DET-011/012; spec III §2.1 rows DET-011/012, §3.3 rule style,
// I §4.1; REQ-001, REQ-007). Traceability: CLM-21 (api-use) and CLM-22 (possible-fingerprinting) in PRD §6.1.
//
// What it says and what it does not:
// - 'api-use' / unassessed per observed WebGL technique: an observation, never a verdict.
// - 'possible-fingerprinting' / low on DET-011 only when, over successful (returned-sync) calls in the document
//   lifetime, the page did all of: asked for the unmasked GPU identity (UNMASKED_VENDOR/RENDERER or the
//   WEBGL_debug_renderer_info extension), listed the supported extensions, read at least one implementation limit
//   and made >= minPrecisionFormatCalls shader-precision queries. Purpose, uniqueness, transmission and "this is not a
//   rendering engine" are not established: engines read the same facts, and fixtures/webgl-engine-info-negative.html
//   documents where this heuristic stops.
// - With FAMILY_CONFIG.webglGetParameter = 'off' (S03 perf-gate no-go) the sensor emits no param-* codes, so the
//   possible tier cannot be reached by that build. The condition is not relaxed for it (no fitting to the sensor).
// - Repeated readPixels (>= repeatedReadbackCounterEvidence calls) is counter-evidence: games and object picking.
// - Counts cover the document lifetime; no time window is established (no-time-window).
// - ADR-001 §7: low/unassessed before calibration; the parameter file cannot raise the ceiling (capLow).
//
// THRESHOLDS ARE PROPOSED (calibrated === false). They were not fitted to fixtures and must not be tuned to make a
// test pass. Calibration corpus: ADR-010 / E15-01 (not available, E09-01 BLOCKED).

import type { CounterEntry, Finding, InterpretationConfidence, OperationCode, SignalCode } from '@detect-expert/contracts';
import { COUNTER_EVIDENCE_CODES, LIMITATION_CODES } from '../codes';
import { WEBGL_TECHNIQUE_IDS, isWebglTechnique, type WebglTechniqueId } from '../techniques';
import { capLow, hasOp, isDegraded, sumCount } from './shared';
import parameters from './thresholds/webgl-capability-probe.v1.json';
import { evidenceIdsOf, makeFinding, type Rule, type RuleInput } from './types';

export const WEBGL_RULE_ID = 'webgl-capability-probe';
export const WEBGL_RULE_VERSION = parameters.ruleVersion;

/** PROPOSED parameters — not calibrated. Changing a number = new ruleVersion + reviewer sign-off. */
export const WEBGL_RULE_PARAMS = Object.freeze({
  ...parameters,
  possibleConfidence: parameters.possibleConfidence as InterpretationConfidence,
  maxConfidence: parameters.maxConfidence as InterpretationConfidence,
});

const T_PARAMS: WebglTechniqueId = 'DET-011';
const T_READBACK: WebglTechniqueId = 'DET-012';
const UNCLASSIFIED_SUFFIX = '-unclassified';
const RETIRED_SIGNAL: SignalCode = 'sample-budget-exceeded';
const IDENTITY_OPS: readonly OperationCode[] = ['param-unmasked-vendor', 'param-unmasked-renderer', 'ext-debug-renderer-info'];
const PROBE_OPS: ReadonlySet<OperationCode> = new Set<OperationCode>([
  ...IDENTITY_OPS,
  'supported-extensions',
  'param-limit',
  'shader-precision-format',
]);

export interface WebglStats {
  /** returned-sync UNMASKED_VENDOR / UNMASKED_RENDERER or getExtension('WEBGL_debug_renderer_info'). */
  identity: boolean;
  supportedExtensions: boolean;
  limit: boolean;
  /** Successful getShaderPrecisionFormat calls. */
  precisionCalls: number;
  /** All DET-012 readPixels calls (attempts included). */
  readPixels: number;
  /** WebGL counters or document coverage were degraded. */
  degraded: boolean;
  /** Successful counters that make up the probe (evidence of the possible-fingerprinting finding). */
  probeCounters: CounterEntry[];
}

export function webglStats(counters: readonly CounterEntry[], coverageFlags: RuleInput['coverageFlags']): WebglStats {
  const own = counters.filter((c) => isWebglTechnique(c.techniqueId));
  const params = own.filter((c) => c.techniqueId === T_PARAMS);
  return {
    identity: IDENTITY_OPS.some((op) => hasOp(params, op)),
    supportedExtensions: hasOp(params, 'supported-extensions'),
    limit: hasOp(params, 'param-limit'),
    precisionCalls: sumCount(params, (c) => c.phase === 'returned-sync' && c.operationCode === 'shader-precision-format'),
    readPixels: sumCount(own, (c) => c.techniqueId === T_READBACK),
    degraded: isDegraded(own, coverageFlags),
    probeCounters: params.filter(
      (c) => c.phase === 'returned-sync' && c.count > 0 && c.operationCode !== undefined && PROBE_OPS.has(c.operationCode),
    ),
  };
}

/** The conjunction of the v1 probe condition (all four parts). */
export function webglProbeMet(stats: WebglStats): boolean {
  return stats.identity && stats.supportedExtensions && stats.limit && stats.precisionCalls >= WEBGL_RULE_PARAMS.minPrecisionFormatCalls;
}

function hasUnclassified(list: readonly CounterEntry[]): boolean {
  return list.some((c) => c.operationCode !== undefined && c.operationCode.endsWith(UNCLASSIFIED_SUFFIX));
}

function hasRetired(list: readonly CounterEntry[]): boolean {
  return list.some((c) => c.signalCodes.includes(RETIRED_SIGNAL));
}

export function evaluateWebgl(input: RuleInput): Finding[] {
  const byTechnique = new Map<WebglTechniqueId, CounterEntry[]>();
  for (const c of input.counters) {
    if (!isWebglTechnique(c.techniqueId)) continue;
    const list = byTechnique.get(c.techniqueId);
    if (list === undefined) byTechnique.set(c.techniqueId, [c]);
    else list.push(c);
  }
  if (byTechnique.size === 0) return [];

  const stats = webglStats(input.counters, input.coverageFlags);
  const counterEvidence =
    stats.readPixels >= WEBGL_RULE_PARAMS.repeatedReadbackCounterEvidence ? [COUNTER_EVIDENCE_CODES.repeatedWebglReadback] : [];
  const base = {
    ruleId: WEBGL_RULE_ID,
    ruleVersion: WEBGL_RULE_VERSION,
    ...(input.coverageRef !== undefined ? { coverageRef: input.coverageRef } : {}),
  };
  const shared = (list: readonly CounterEntry[]): string[] => [
    ...(hasUnclassified(list) ? [LIMITATION_CODES.argumentNotClassified] : []),
    ...(hasRetired(list) ? [LIMITATION_CODES.hookRetired] : []),
    ...(stats.degraded ? [LIMITATION_CODES.coverageIncomplete] : []),
  ];

  // Observation level: one 'api-use' per observed technique (CLM-21; DET-012 readPixels).
  const findings: Finding[] = [];
  for (const id of WEBGL_TECHNIQUE_IDS) {
    const list = byTechnique.get(id);
    if (list === undefined) continue;
    const readbackFailed = id === T_READBACK && list.some((c) => c.phase === 'threw-sync');
    findings.push(
      makeFinding({
        ...base,
        techniqueId: id,
        interpretation: 'api-use',
        interpretationConfidence: 'unassessed',
        evidenceIds: evidenceIdsOf(list),
        counterEvidenceCodes: id === T_READBACK ? counterEvidence : [],
        limitationCodes: [
          LIMITATION_CODES.pageControlledEvidence,
          LIMITATION_CODES.purposeUnknown,
          ...(readbackFailed ? [LIMITATION_CODES.readbackAttemptedFailed] : []),
          ...shared(list),
        ],
      }),
    );
  }

  // Interpretation level (CLM-22): the full v1 conjunction, never a single query.
  if (!webglProbeMet(stats)) return findings;
  findings.push(
    makeFinding({
      ...base,
      techniqueId: T_PARAMS,
      interpretation: 'possible-fingerprinting',
      interpretationConfidence: capLow(stats.degraded ? 'low' : WEBGL_RULE_PARAMS.possibleConfidence, WEBGL_RULE_PARAMS.maxConfidence),
      evidenceIds: evidenceIdsOf(stats.probeCounters),
      counterEvidenceCodes: counterEvidence,
      limitationCodes: [
        LIMITATION_CODES.pageControlledEvidence,
        LIMITATION_CODES.purposeUnknown,
        LIMITATION_CODES.uniquenessNotEstablished,
        LIMITATION_CODES.uncalibratedThreshold,
        LIMITATION_CODES.noTimeWindow,
        ...shared(byTechnique.get(T_PARAMS) ?? []),
      ],
    }),
  );
  return findings;
}

export const webglRule: Rule = Object.freeze({
  ruleId: WEBGL_RULE_ID,
  ruleVersion: WEBGL_RULE_VERSION,
  techniqueIds: WEBGL_TECHNIQUE_IDS,
  evaluate: evaluateWebgl,
});
