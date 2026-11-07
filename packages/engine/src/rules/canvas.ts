// Rule 'canvas-readback-after-text' v2 (E07-01; DET-001..DET-004; spec III §2.1 rows DET-001..004, §3.3 rule
// style, I §4.1; REQ-001, REQ-007). Traceability: CLM-01..CLM-04 in PRD §6.
//
// What it says and what it does not:
// - 'api-use' per canvas technique that was observed: an observation, never a verdict.
// - A single readout after text remains 'api-use'; the signal is retained in its evidence id and projection.
// - Repeated readouts with 'readback-after-text' / 'export-after-text' support only
//   'possible-fingerprinting' / 'low'. Purpose, uniqueness and transmission are not established.
// - Counts cover the document lifetime, not a bounded window. Bucket endpoints cannot reconstruct windows.
// - P04: only text-drawn supports text association; measurements remain API observations.
//   Drawing volume still cannot establish purpose or a probe ratio (F122).
// - Tainted-canvas / any synchronous throw on a readout is an attempt ('readback-attempted-failed'), not a read.
// - ADR-001 §7 requires low/unassessed before calibration. A stronger tier needs reviewed calibration and
//   bounded-window evidence; changing a parameter alone must not enable it (F041/F042).
// - Legacy undifferentiated DET-003 counters cannot supply drawing evidence.
//
// THRESHOLDS ARE PROPOSED (RULE_PARAMS.calibrated === false). They were not fitted to fixtures and must not be
// tuned to make a test pass (project rules). Calibration corpus: ADR-010 / E09-03 / E15-01.

import type {
  CounterEntry,
  CoverageFlag,
  Finding,
  InterpretationConfidence,
  SignalCode,
  TechniqueId,
} from '@detect-expert/contracts';
import { LIMITATION_CODES } from '../codes';
import parameters from './thresholds/canvas-readback.v2.json';
import {
  CANVAS_READOUT_TECHNIQUE_IDS,
  CANVAS_TECHNIQUE_IDS,
  isCanvasTechnique,
  type CanvasTechniqueId,
} from '../techniques';
import { evidenceIdsOf, makeFinding, type Rule, type RuleInput } from './types';

export const CANVAS_RULE_ID = 'canvas-readback-after-text';
export const CANVAS_RULE_VERSION = parameters.ruleVersion;

/** PROPOSED parameters — not calibrated. Changing a number = new ruleVersion + reviewer sign-off. */
export const RULE_PARAMS = Object.freeze({
  ...parameters,
  // Legacy ratio/volume values are preserved for audit history, but are not evaluated in v2.
  patternConfidence: parameters.patternConfidence as InterpretationConfidence,
  possibleConfidence: parameters.possibleConfidence as InterpretationConfidence,
  maxConfidence: parameters.maxConfidence as InterpretationConfidence,
});

const READOUT_SIGNALS: ReadonlySet<SignalCode> = new Set<SignalCode>(['readback-after-text', 'export-after-text']);
const READOUT_SET: ReadonlySet<string> = new Set<string>(CANVAS_READOUT_TECHNIQUE_IDS);
/** Signal codes on a counter that mean the sensor itself was degraded while counting. */
const DEGRADING_SIGNALS: ReadonlySet<SignalCode> = new Set<SignalCode>([
  'late-start',
  'hook-failed',
  'hook-replaced',
  'sample-budget-exceeded',
]);
/** Document-level flags that mean the window may be incomplete. */
const DEGRADING_FLAGS: ReadonlySet<CoverageFlag> = new Set<CoverageFlag>([
  'late-start',
  'hook-failed',
  'descriptor-nonconfigurable',
  'truncated',
  'throttled',
  'channel-gap',
  'budget-exceeded',
  'bridge-ring-overflow',
  'protocol-mismatch',
]);

export interface CanvasStats {
  /** Synchronous readouts (DET-002/001/004) carrying a readout-after-text signal. */
  readouts: number;
  readoutsByTechnique: Partial<Record<CanvasTechniqueId, number>>;
  /** Readout calls that threw synchronously (tainted canvas or bad arguments): attempts only. */
  failedAttempts: number;
  /** Successful DET-003 drawing calls, excluding measureText and legacy unsplit counters. */
  textOps: number;
  /** Counters or coverage were degraded; confidence must be capped to 'low'. */
  degraded: boolean;
  readoutCounters: CounterEntry[];
  textCounters: CounterEntry[];
}

function isReadoutTechnique(id: TechniqueId): id is CanvasTechniqueId {
  return READOUT_SET.has(id);
}

export function canvasStats(counters: readonly CounterEntry[], coverageFlags: readonly CoverageFlag[]): CanvasStats {
  const stats: CanvasStats = {
    readouts: 0,
    readoutsByTechnique: {},
    failedAttempts: 0,
    textOps: 0,
    degraded: coverageFlags.some((f) => DEGRADING_FLAGS.has(f)),
    readoutCounters: [],
    textCounters: [],
  };
  for (const c of counters) {
    if (!isCanvasTechnique(c.techniqueId)) continue;
    if (c.countQuality !== 'exact' || c.signalCodes.some((s) => DEGRADING_SIGNALS.has(s))) stats.degraded = true;
    if (c.techniqueId === 'DET-003') {
      if (c.phase === 'returned-sync' && c.signalCodes.includes('text-drawn')) {
        stats.textOps += c.count;
        stats.textCounters.push(c);
      }
      continue;
    }
    if (!isReadoutTechnique(c.techniqueId)) continue;
    if (c.phase === 'threw-sync') {
      stats.failedAttempts += c.count;
      continue;
    }
    // P04: an export Promise may reject; unobserved settlement cannot establish a successful readout.
    if (c.phase === 'returned-sync' && c.signalCodes.some((s) => READOUT_SIGNALS.has(s))) {
      stats.readouts += c.count;
      stats.readoutsByTechnique[c.techniqueId] = (stats.readoutsByTechnique[c.techniqueId] ?? 0) + c.count;
      stats.readoutCounters.push(c);
    }
  }
  return stats;
}

/** Readout technique with the most readouts; ties resolve in CANVAS_READOUT_TECHNIQUE_IDS order. */
function primaryReadoutTechnique(stats: CanvasStats): CanvasTechniqueId {
  let best: CanvasTechniqueId = CANVAS_READOUT_TECHNIQUE_IDS[0];
  let bestCount = -1;
  for (const id of CANVAS_READOUT_TECHNIQUE_IDS) {
    const n = stats.readoutsByTechnique[id] ?? 0;
    if (n > bestCount) {
      best = id;
      bestCount = n;
    }
  }
  return best;
}

const CONFIDENCE_RANK: Readonly<Record<InterpretationConfidence, number>> = {
  unassessed: 0,
  low: 1,
  medium: 2,
  high: 3,
};

function capConfidence(c: InterpretationConfidence): InterpretationConfidence {
  // Unwindowed evidence cannot justify more than low, even if calibration metadata changes.
  const ceiling = CONFIDENCE_RANK[RULE_PARAMS.maxConfidence] < CONFIDENCE_RANK.low ? RULE_PARAMS.maxConfidence : 'low';
  return CONFIDENCE_RANK[c] > CONFIDENCE_RANK[ceiling] ? ceiling : c;
}

export function evaluateCanvas(input: RuleInput): Finding[] {
  const byTechnique = new Map<CanvasTechniqueId, CounterEntry[]>();
  for (const c of input.counters) {
    if (!isCanvasTechnique(c.techniqueId)) continue;
    const list = byTechnique.get(c.techniqueId);
    if (list === undefined) byTechnique.set(c.techniqueId, [c]);
    else list.push(c);
  }
  if (byTechnique.size === 0) return [];

  const findings: Finding[] = [];
  const base = {
    ruleId: CANVAS_RULE_ID,
    ruleVersion: CANVAS_RULE_VERSION,
    ...(input.coverageRef !== undefined ? { coverageRef: input.coverageRef } : {}),
  };

  // Observation level: one 'api-use' per observed technique (CLM-01..03).
  for (const id of CANVAS_TECHNIQUE_IDS) {
    const list = byTechnique.get(id);
    if (list === undefined) continue;
    const attemptFailed = isReadoutTechnique(id) && list.some((c) => c.phase === 'threw-sync');
    findings.push(
      makeFinding({
        ...base,
        techniqueId: id,
        interpretation: 'api-use',
        interpretationConfidence: 'unassessed',
        evidenceIds: evidenceIdsOf(list),
        counterEvidenceCodes: [],
        limitationCodes: [
          LIMITATION_CODES.pageControlledEvidence,
          LIMITATION_CODES.purposeUnknown,
          ...(attemptFailed ? [LIMITATION_CODES.readbackAttemptedFailed] : []),
        ],
      }),
    );
  }

  // Interpretation level (CLM-04, F043): repetition uses the existing minimum, never a single export.
  const stats = canvasStats(input.counters, input.coverageFlags);
  if (stats.textOps === 0 || stats.readouts < RULE_PARAMS.minReadoutsForPattern) return findings;

  const confidence = capConfidence(stats.degraded ? 'low' : RULE_PARAMS.possibleConfidence);

  findings.push(
    makeFinding({
      ...base,
      techniqueId: primaryReadoutTechnique(stats),
      interpretation: 'possible-fingerprinting',
      interpretationConfidence: confidence,
      evidenceIds: evidenceIdsOf([...stats.readoutCounters, ...stats.textCounters]),
      counterEvidenceCodes: [],
      limitationCodes: [
        LIMITATION_CODES.pageControlledEvidence,
        LIMITATION_CODES.purposeUnknown,
        LIMITATION_CODES.uniquenessNotEstablished,
        LIMITATION_CODES.uncalibratedThreshold,
        LIMITATION_CODES.noTimeWindow,
        ...(stats.failedAttempts > 0 ? [LIMITATION_CODES.readbackAttemptedFailed] : []),
        ...(stats.degraded ? [LIMITATION_CODES.coverageIncomplete] : []),
      ],
    }),
  );
  return findings;
}

export const canvasRule: Rule = Object.freeze({
  ruleId: CANVAS_RULE_ID,
  ruleVersion: CANVAS_RULE_VERSION,
  techniqueIds: CANVAS_TECHNIQUE_IDS,
  evaluate: evaluateCanvas,
});
