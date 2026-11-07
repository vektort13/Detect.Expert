// Helpers shared by family rules (S04+). The degradation sets are a copy of rules/canvas.ts (left unchanged so the
// canvas rule keeps its reviewed v2 behaviour); a change here does not change canvas-readback-after-text.

import type {
  CounterEntry,
  CoverageFlag,
  InterpretationConfidence,
  OperationCode,
  Phase,
  SignalCode,
} from '@detect-expert/contracts';
import { satAdd } from '../arith';

/** Signal codes on a counter that mean the sensor itself was degraded while counting. */
export const DEGRADING_SIGNALS: ReadonlySet<SignalCode> = new Set<SignalCode>([
  'late-start',
  'hook-failed',
  'hook-replaced',
  'sample-budget-exceeded',
]);

/** Document-level flags that mean the window may be incomplete. */
export const DEGRADING_FLAGS: ReadonlySet<CoverageFlag> = new Set<CoverageFlag>([
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

/** True when a document flag or any of `counters` (inexact count or a degrading signal) marks incomplete data. */
export function isDegraded(counters: readonly CounterEntry[], coverageFlags: readonly CoverageFlag[]): boolean {
  if (coverageFlags.some((f) => DEGRADING_FLAGS.has(f))) return true;
  return counters.some((c) => c.countQuality !== 'exact' || c.signalCodes.some((s) => DEGRADING_SIGNALS.has(s)));
}

const CONFIDENCE_RANK: Readonly<Record<InterpretationConfidence, number>> = {
  unassessed: 0,
  low: 1,
  medium: 2,
  high: 3,
};

/**
 * Caps `c` at `low` (ADR-001 §7: uncalibrated, unwindowed evidence) or at `max` when that is lower. A parameter file
 * cannot raise the ceiling above low.
 */
export function capLow(c: InterpretationConfidence, max: InterpretationConfidence = 'low'): InterpretationConfidence {
  const ceiling = CONFIDENCE_RANK[max] < CONFIDENCE_RANK.low ? max : 'low';
  return CONFIDENCE_RANK[c] > CONFIDENCE_RANK[ceiling] ? ceiling : c;
}

/** Saturating sum of `count` over the counters accepted by `accept`. */
export function sumCount(counters: readonly CounterEntry[], accept: (c: CounterEntry) => boolean = () => true): number {
  let total = 0;
  for (const c of counters) if (accept(c)) total = satAdd(total, c.count);
  return total;
}

/** True when some counter of `op` in `phase` has a positive count (a count-0 retirement marker does not count). */
export function hasOp(counters: readonly CounterEntry[], op: OperationCode, phase: Phase = 'returned-sync'): boolean {
  return counters.some((c) => c.operationCode === op && c.phase === phase && c.count > 0);
}
