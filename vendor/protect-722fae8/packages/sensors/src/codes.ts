// Numeric composition of counter keys for the MAIN-world hot path (REQ-011, ADR-006 §2, ADR-017 §4).
// A counter is identified by (techniqueId, phase, signalCodes, operationCode?). On the hot path the sensor composes a
// single integer from small indices and a local bit mask instead of building strings, so an increment of an existing
// key allocates nothing. Decoding back to canonical wire names happens only when a new key is created.
//
// Key layout v2 (ADR-017 §4), always < 2^24 and therefore a Smi:
//   bits 0..7   local signal mask: bit i = techniqueSignals(t)[i], bit 0 = api-use
//   bits 8..13  operation index: 0 = none, k = pageOperations(t)[k - 1]
//   bits 14..16 phase index
//   bits 17..23 technique index
// Per-technique tables are copied at module evaluation (document_start), so decoding never consults prototype
// chains a page script could pollute later; indices are bounds-checked before every element read.

import { PAGE_OPERATIONS, PHASES, TECHNIQUE_IDS, TECHNIQUE_SIGNALS } from '@detect-expert/contracts';
import { arrayPush, arraySlice, arraySort } from './intrinsics';
import type { OperationCode, Phase, SignalCode, TechniqueId } from '@detect-expert/contracts';

const SIGNAL_WIDTH = 8;
const OP_SHIFT = 8;
const PHASE_SHIFT = 14;
const TECHNIQUE_SHIFT = 17;
const MASK_BITS = 0xff;
const OP_BITS = 0x3f;
const PHASE_BITS = 0x7;
const TECHNIQUE_LIMIT = 128;
const PHASE_LIMIT = 8;
const OP_LIMIT = 63;

/** Bit 0 of every technique's local mask (`techniqueSignals(t)[0]` is always 'api-use'). */
export const API_USE = 1;

const hasOwn = Function.prototype.call.bind(Object.prototype.hasOwnProperty) as (o: object, k: PropertyKey) => boolean;
const DEFAULT_SIGNALS: readonly SignalCode[] = Object.freeze(['api-use'] as const);
const NO_OPERATIONS: readonly OperationCode[] = Object.freeze([]);

/** Own entry of a contracts table (same result as techniqueSignals/pageOperations, without prototype lookups). */
function ownList<T>(table: Readonly<Partial<Record<TechniqueId, readonly T[]>>>, id: TechniqueId, fallback: readonly T[]): readonly T[] {
  return hasOwn(table, id) ? table[id]! : fallback;
}

function indexOf<T extends string>(list: readonly T[]): Readonly<Record<T, number>> {
  // Null prototype: install-time lookups never reach an inherited (possibly page-planted) property.
  const out = Object.create(null) as Record<T, number>;
  for (let i = 0; i < list.length; i++) out[list[i]!] = i;
  return Object.freeze(out);
}

function layoutError(what: string): Error {
  // Static invariant of the key layout; a contract change that breaks it must also change this module.
  return new Error('codes: key layout cannot represent ' + what);
}

if (TECHNIQUE_IDS.length > TECHNIQUE_LIMIT) throw layoutError('the technique enum');
if (PHASES.length > PHASE_LIMIT) throw layoutError('the phase enum');

/** Per technique index: local signal list and operation list, frozen copies taken at load. */
const SIGNALS_BY_TECHNIQUE: ReadonlyArray<readonly SignalCode[]> = (() => {
  const out: Array<readonly SignalCode[]> = [];
  for (let t = 0; t < TECHNIQUE_IDS.length; t++) {
    const list = ownList(TECHNIQUE_SIGNALS, TECHNIQUE_IDS[t]!, DEFAULT_SIGNALS);
    if (list.length < 1 || list.length > SIGNAL_WIDTH || list[0] !== 'api-use') throw layoutError('the signals of ' + TECHNIQUE_IDS[t]);
    for (let i = 1; i < list.length; i++) {
      for (let j = 0; j < i; j++) if (list[i] === list[j]) throw layoutError('duplicate signals of ' + TECHNIQUE_IDS[t]);
    }
    arrayPush(out, Object.freeze(arraySlice(list)));
  }
  return Object.freeze(out);
})();

const OPERATIONS_BY_TECHNIQUE: ReadonlyArray<readonly OperationCode[]> = (() => {
  const out: Array<readonly OperationCode[]> = [];
  for (let t = 0; t < TECHNIQUE_IDS.length; t++) {
    const list = ownList(PAGE_OPERATIONS, TECHNIQUE_IDS[t]!, NO_OPERATIONS);
    if (list.length > OP_LIMIT) throw layoutError('the operations of ' + TECHNIQUE_IDS[t]);
    arrayPush(out, Object.freeze(arraySlice(list)));
  }
  return Object.freeze(out);
})();

export const TECHNIQUE_INDEX: Readonly<Record<TechniqueId, number>> = indexOf(TECHNIQUE_IDS);
export const PHASE_INDEX: Readonly<Record<Phase, number>> = indexOf(PHASES);

function techniqueIndexOf(techniqueId: TechniqueId): number {
  for (let t = 0; t < TECHNIQUE_IDS.length; t++) if (TECHNIQUE_IDS[t] === techniqueId) return t;
  throw new Error('codes: unknown technique');
}

/**
 * Local bit of `code` in the mask of `techniqueId`. Install-time only: throws for a pair the technique does not
 * declare in TECHNIQUE_SIGNALS, so a sensor cannot silently emit an undeclared signal.
 */
export function signalBit(techniqueId: TechniqueId, code: SignalCode): number {
  const list = SIGNALS_BY_TECHNIQUE[techniqueIndexOf(techniqueId)]!;
  for (let i = 0; i < list.length; i++) if (list[i] === code) return 1 << i;
  throw new Error('codes: signal not declared for the technique');
}

/** Local operation index (1-based) of `op` for `techniqueId`. Install-time only: throws for an undeclared pair. */
export function operationIndex(techniqueId: TechniqueId, op: OperationCode): number {
  const list = OPERATIONS_BY_TECHNIQUE[techniqueIndexOf(techniqueId)]!;
  for (let i = 0; i < list.length; i++) if (list[i] === op) return i + 1;
  throw new Error('codes: operation not declared for the technique');
}

/** Hot path: pure integer arithmetic. `op` is the local index from operationIndex (0 = no operation). */
export function compositeKey(techniqueIndex: number, phaseIndex: number, signalMask: number, op = 0): number {
  return (
    ((techniqueIndex & (TECHNIQUE_LIMIT - 1)) << TECHNIQUE_SHIFT) |
    ((phaseIndex & PHASE_BITS) << PHASE_SHIFT) |
    ((op & OP_BITS) << OP_SHIFT) |
    (signalMask & MASK_BITS)
  );
}

/** Technique index of a key (used to find the fold target of an overflowing key). */
export function keyTechniqueIndex(key: number): number {
  return (key >>> TECHNIQUE_SHIFT) & (TECHNIQUE_LIMIT - 1);
}

export interface DecodedKey {
  techniqueId: TechniqueId;
  phase: Phase;
  /** Sorted, unique (matches contracts.counterKey ordering). */
  signalCodes: SignalCode[];
  /** Present only when the key carries an operation index. */
  operationCode?: OperationCode;
}

/** Null for a key outside the layout or with a bit/index the technique does not declare (never produced here). */
export function decodeKey(key: number): DecodedKey | null {
  if (key < 0 || key >= 1 << 24 || key !== (key | 0)) return null;
  const t = key >>> TECHNIQUE_SHIFT;
  const p = (key >>> PHASE_SHIFT) & PHASE_BITS;
  if (t >= TECHNIQUE_IDS.length || p >= PHASES.length) return null;
  const signals = SIGNALS_BY_TECHNIQUE[t]!;
  const mask = key & MASK_BITS;
  if (mask >>> signals.length !== 0) return null;
  const signalCodes: SignalCode[] = [];
  for (let i = 0; i < signals.length; i++) {
    if ((mask & (1 << i)) !== 0) arrayPush(signalCodes, signals[i]!);
  }
  arraySort(signalCodes);
  const op = (key >>> OP_SHIFT) & OP_BITS;
  const techniqueId = TECHNIQUE_IDS[t]!;
  const phase = PHASES[p]!;
  if (op === 0) return { techniqueId, phase, signalCodes };
  const operations = OPERATIONS_BY_TECHNIQUE[t]!;
  if (op > operations.length) return null;
  return { techniqueId, phase, signalCodes, operationCode: operations[op - 1]! };
}
