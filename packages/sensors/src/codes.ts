// Numeric composition of counter keys for the MAIN-world hot path (REQ-011, ADR-006 §2).
// A counter is identified by (techniqueId, phase, signalCodes). On the hot path the sensor composes a single
// integer from small indices and a bit mask instead of building strings, so an increment of an existing key
// allocates nothing. Decoding back to canonical wire names happens only at flush time.

import { PHASES, SIGNAL_CODES, TECHNIQUE_IDS } from '@detect-expert/contracts';
import { arrayPush, arraySort } from './intrinsics';
import type { Phase, SignalCode, TechniqueId } from '@detect-expert/contracts';

function indexOf<T extends string>(list: readonly T[]): Readonly<Record<T, number>> {
  const out = {} as Record<T, number>;
  list.forEach((value, i) => {
    out[value] = i;
  });
  return Object.freeze(out);
}

/** P04: 17 signal bits + 4 phase bits + 10 technique bits fit in a positive 31-bit key. */
const PHASE_SHIFT = 17;
const TECHNIQUE_SHIFT = 21;
const PHASE_BITS = 0xf;
const MASK_BITS = 0x1ffff;

if (SIGNAL_CODES.length > 17 || PHASES.length > 16 || TECHNIQUE_IDS.length > 1024) {
  // Static invariant of the key layout; a contract change that breaks it must also change this module.
  throw new Error('codes: key layout cannot represent the contract enums');
}

export const TECHNIQUE_INDEX: Readonly<Record<TechniqueId, number>> = indexOf(TECHNIQUE_IDS);
export const PHASE_INDEX: Readonly<Record<Phase, number>> = indexOf(PHASES);

/** One bit per signal code; combine with `|`. */
export const SIGNAL_BIT: Readonly<Record<SignalCode, number>> = (() => {
  const out = {} as Record<SignalCode, number>;
  SIGNAL_CODES.forEach((code, i) => {
    out[code] = 1 << i;
  });
  return Object.freeze(out);
})();

export function compositeKey(techniqueIndex: number, phaseIndex: number, signalMask: number): number {
  return (techniqueIndex << TECHNIQUE_SHIFT) | (phaseIndex << PHASE_SHIFT) | (signalMask & MASK_BITS);
}

export interface DecodedKey {
  techniqueId: TechniqueId;
  phase: Phase;
  /** Sorted, unique (matches contracts.counterKey ordering). */
  signalCodes: SignalCode[];
}

/** Null for an index outside the enums (never produced by this package; defensive). */
export function decodeKey(key: number): DecodedKey | null {
  const techniqueId = TECHNIQUE_IDS[key >>> TECHNIQUE_SHIFT];
  const phase = PHASES[(key >>> PHASE_SHIFT) & PHASE_BITS];
  if (techniqueId === undefined || phase === undefined) return null;
  const signalCodes: SignalCode[] = [];
  const mask = key & MASK_BITS;
  for (let i = 0; i < SIGNAL_CODES.length; i++) {
    if ((mask & (1 << i)) !== 0) {
      const code = SIGNAL_CODES[i];
      if (code !== undefined) arrayPush(signalCodes, code);
    }
  }
  arraySort(signalCodes);
  return { techniqueId, phase, signalCodes };
}
