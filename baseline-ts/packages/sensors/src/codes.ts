// Numeric composition of counter keys for the MAIN-world hot path (REQ-011, ADR-006 §2).
// A counter is identified by (techniqueId, phase, signalCodes). On the hot path the sensor composes a single
// integer from small indices and a bit mask instead of building strings, so an increment of an existing key
// allocates nothing. Decoding back to canonical wire names happens only at flush time.

import { API_OPERATIONS, API_OPERATION_DEFINITIONS, apiOperationAllows, EXTENSION_TARGET_KEYS, EXTENSION_RESOURCE_METHODS, extensionResourceAllows, PHASES, SIGNAL_CODES, TECHNIQUE_IDS } from '@detect-expert/contracts';
import { arrayPush, arraySort } from './intrinsics';
import type { ApiOperation, ExtensionResource, Phase, SignalCode, TechniqueId } from '@detect-expert/contracts';

function indexOf<T extends string>(list: readonly T[]): Readonly<Record<T, number>> {
  const out = Object.create(null) as Record<T, number>;
  list.forEach((value, i) => {
    out[value] = i;
  });
  return Object.freeze(out);
}

/** P04: preserve the original positive 31-bit keys and allocation-free legacy hot path. */
const PHASE_SHIFT = 17;
const TECHNIQUE_SHIFT = 21;
const PHASE_BITS = 0xf;
const MASK_BITS = 0x1ffff;
const LEGACY_SIGNALS = 17;
// ADR-026: extended signal sets use a separate negative safe-integer namespace. JS bitwise
// operators truncate above 32 bits, so only the old low-17-bit path uses shifts/OR.
const EXTENDED_BASE = 2 ** 43;
const EXTENDED_PHASES = 8;
const OPERATION_BASE = 2 ** 31;
const EXTENSION_RESOURCE_BASE = 2 ** 32;
const floor = Math.floor;
const safeInteger = Number.isSafeInteger;

if (SIGNAL_CODES.length > 43 || PHASES.length > EXTENDED_PHASES || TECHNIQUE_IDS.length > 128) {
  // Static invariant of the key layout; a contract change that breaks it must also change this module.
  throw new Error('codes: key layout cannot represent the contract enums');
}

export const TECHNIQUE_INDEX: Readonly<Record<TechniqueId, number>> = indexOf(TECHNIQUE_IDS);
export const PHASE_INDEX: Readonly<Record<Phase, number>> = indexOf(PHASES);
export const API_OPERATION_INDEX: Readonly<Record<ApiOperation, number>> = indexOf(API_OPERATIONS);
export const EXTENSION_METHOD_INDEX = indexOf(EXTENSION_RESOURCE_METHODS);

export function extensionResourceKey(resourceIndex: number, phaseIndex: number): number {
  return EXTENSION_RESOURCE_BASE + resourceIndex * EXTENDED_PHASES + phaseIndex;
}

export function operationKey(operationIndex: number, phaseIndex: number): number {
  return OPERATION_BASE + operationIndex * EXTENDED_PHASES + phaseIndex;
}

/** One numeric bit per code. New code sets MUST use signalMaskOf; bitwise OR is legacy-only. */
export const SIGNAL_BIT: Readonly<Record<SignalCode, number>> = (() => {
  const out = {} as Record<SignalCode, number>;
  SIGNAL_CODES.forEach((code, i) => {
    out[code] = 2 ** i;
  });
  return Object.freeze(out);
})();

/** Compile fixed, allowlisted code sets once at sensor installation, outside the observed call path. */
export function signalMaskOf(codes: readonly SignalCode[]): number {
  let mask = 0;
  for (let i = 0; i < codes.length; i++) {
    let duplicate = false;
    for (let j = 0; j < i; j++) if (codes[j] === codes[i]) { duplicate = true; break; }
    if (!duplicate) mask += SIGNAL_BIT[codes[i]!];
  }
  return mask;
}

export function compositeKey(techniqueIndex: number, phaseIndex: number, signalMask: number): number {
  if (signalMask > MASK_BITS) return -((techniqueIndex * EXTENDED_PHASES + phaseIndex) * EXTENDED_BASE + signalMask);
  return (techniqueIndex << TECHNIQUE_SHIFT) | (phaseIndex << PHASE_SHIFT) | (signalMask & MASK_BITS);
}

export interface DecodedKey {
  techniqueId: TechniqueId;
  apiOperation?: ApiOperation;
  extensionResource?: ExtensionResource;
  phase: Phase;
  /** Sorted, unique (matches contracts.counterKey ordering). */
  signalCodes: SignalCode[];
}

/** Null for an index outside the enums (never produced by this package; defensive). */
export function decodeKey(key: number): DecodedKey | null {
  if (!safeInteger(key)) return null;
  if (key >= EXTENSION_RESOURCE_BASE) {
    const offset = key - EXTENSION_RESOURCE_BASE;
    const resourceIndex = floor(offset / EXTENDED_PHASES);
    const target = EXTENSION_TARGET_KEYS[floor(resourceIndex / EXTENSION_RESOURCE_METHODS.length)];
    const method = EXTENSION_RESOURCE_METHODS[resourceIndex % EXTENSION_RESOURCE_METHODS.length];
    const phase = PHASES[offset % EXTENDED_PHASES];
    if (target === undefined || method === undefined || phase === undefined || !extensionResourceAllows({ target, method }, 'DET-059', phase)) return null;
    return { techniqueId: 'DET-059', phase, signalCodes: ['api-use'], extensionResource: { target, method } };
  }
  if (key >= OPERATION_BASE) {
    const offset = key - OPERATION_BASE;
    const definition = API_OPERATION_DEFINITIONS[floor(offset / EXTENDED_PHASES)];
    const phase = PHASES[offset % EXTENDED_PHASES];
    if (!definition || phase === undefined || !apiOperationAllows(definition[0], definition[1], phase)) return null;
    return { techniqueId: definition[1], apiOperation: definition[0], phase, signalCodes: ['api-use'] };
  }
  let techniqueIndex: number, phaseIndex: number, mask: number;
  const extended = key < 0;
  if (extended) {
    const packed = floor(-key / EXTENDED_BASE);
    mask = -key - packed * EXTENDED_BASE;
    if (mask <= MASK_BITS || mask >= 2 ** SIGNAL_CODES.length) return null;
    techniqueIndex = floor(packed / EXTENDED_PHASES);
    phaseIndex = packed % EXTENDED_PHASES;
  } else {
    if (key >= 2 ** 31) return null;
    techniqueIndex = key >>> TECHNIQUE_SHIFT;
    phaseIndex = (key >>> PHASE_SHIFT) & PHASE_BITS;
    mask = key & MASK_BITS;
  }
  const techniqueId = TECHNIQUE_IDS[techniqueIndex];
  const phase = PHASES[phaseIndex];
  if (techniqueId === undefined || phase === undefined) return null;
  const signalCodes: SignalCode[] = [];
  for (let i = 0; i < (extended ? SIGNAL_CODES.length : LEGACY_SIGNALS); i++) {
    if (extended ? floor(mask / 2 ** i) % 2 !== 0 : (mask & (1 << i)) !== 0) {
      const code = SIGNAL_CODES[i];
      if (code !== undefined) arrayPush(signalCodes, code);
    }
  }
  arraySort(signalCodes);
  return { techniqueId, phase, signalCodes };
}
