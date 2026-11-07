// Saturating integer helpers (REQ-011). Counters never exceed MAX_COUNT and never go negative.

import { MAX_COUNT, type CountQuality } from '@detect-expert/contracts';

/** a + b saturated at MAX_COUNT. Inputs are expected to be non-negative integers. */
export function satAdd(a: number, b: number): number {
  const sum = a + b;
  return sum >= MAX_COUNT ? MAX_COUNT : sum;
}

/** Clamp any number into 0..MAX_COUNT (non-finite -> 0, -0 -> 0). */
export function clampCount(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 0;
  return v >= MAX_COUNT ? MAX_COUNT : Math.floor(v);
}

const QUALITY_RANK: Readonly<Record<CountQuality, number>> = { exact: 0, sampled: 1, 'lower-bound': 2 };

/** The less precise of two count qualities: exact < sampled < lower-bound. */
export function worstQuality(a: CountQuality, b: CountQuality): CountQuality {
  return QUALITY_RANK[a] >= QUALITY_RANK[b] ? a : b;
}

/** Unique values in the order the enum declares them (deterministic arrays). */
export function sortByEnumOrder<T extends string>(values: Iterable<T>, order: readonly T[]): T[] {
  const index = new Map<T, number>();
  order.forEach((v, i) => index.set(v, i));
  return [...new Set(values)].sort((x, y) => (index.get(x) ?? 0) - (index.get(y) ?? 0));
}

/** Shallow equality of two string arrays (same length, same order). */
export function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
