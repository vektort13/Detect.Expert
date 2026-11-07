// ADR-020 §F (S10): stack sampler of the module's MAIN observers (SP-12). The intrinsics are captured at document_start
// (protect.main.js runs there); without that early capture the sampler is off (`late-start`). Before every sample:
//   1. the prototype chain Error -> Function.prototype -> Object.prototype equals the captured one;
//   2. none of these three objects has an own `prepareStackTrace` (checked by descriptor, never read);
//   3. Error.stackTraceLimit is an own data property holding an integer 1..100.
// Only then: holder = Object.create(null); Error.captureStackTrace(holder, omit); the own `stack` is read once. V8 looks
// up prepareStackTrace along exactly that chain when the stack is formatted, so a page accessor (or Proxy) planted
// there is never invoked (SP-12: 0 calls with the checks, 1 without). Otherwise `stack-unavailable`. `omit` is the
// installed wrapper: its frame and everything above it (our observer) are left out of the trace.
// Budgets per 1 s window: sendSamplesPerWindow (16) and registrationSamplesPerWindow (8); beyond -> `budget`.
// The raw stack never leaves this function: only the ScriptRef of the first page frame (packages/attribution).

import { PROTECT_BUDGETS } from '@detect-expert/contracts';
import type { ScriptRef } from '@detect-expert/contracts';
import { parseFirstPageFrame } from '../../../attribution/src/script-ref';

const apply = Reflect.apply;
const create = Object.create;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const hasOwn = Function.prototype.call.bind(Object.prototype.hasOwnProperty) as (o: object, k: PropertyKey) => boolean;
const isInteger = Number.isInteger;
const NO_ARGS: readonly unknown[] = Object.freeze([]);

export const MAX_STACK_TRACE_LIMIT = 100;

/** Captured at document_start from the realm (own data properties only; no accessor is invoked). */
export interface StackIntrinsics {
  readonly errorCtor: object;
  readonly captureStackTrace: Function;
  readonly functionProto: object;
  readonly objectProto: object;
}

function ownData(o: object, key: string): unknown {
  const d = getOwnPropertyDescriptor(o, key);
  return d !== undefined && hasOwn(d, 'value') ? d.value : undefined;
}

/** The realm's Error / Function / Object intrinsics through own data descriptors, or null when any is missing. */
export function captureStackIntrinsics(realm: object): StackIntrinsics | null {
  try {
    const errorCtor = ownData(realm, 'Error');
    const functionCtor = ownData(realm, 'Function');
    const objectCtor = ownData(realm, 'Object');
    if (typeof errorCtor !== 'function' || typeof functionCtor !== 'function' || typeof objectCtor !== 'function') return null;
    const captureStackTrace = ownData(errorCtor, 'captureStackTrace');
    const functionProto = ownData(functionCtor, 'prototype');
    const objectProto = ownData(objectCtor, 'prototype');
    if (typeof captureStackTrace !== 'function' || typeof functionProto !== 'function' || typeof objectProto !== 'object' || objectProto === null) return null;
    return { errorCtor, captureStackTrace, functionProto, objectProto };
  } catch {
    return null;
  }
}

/** Checks 1-3 of the header. Reads descriptors and [[Prototype]] of ordinary objects only (no trap, no accessor). */
export function stackIntegrityOk(i: StackIntrinsics): boolean {
  if (getPrototypeOf(i.errorCtor) !== i.functionProto) return false;
  if (getPrototypeOf(i.functionProto) !== i.objectProto) return false;
  if (getOwnPropertyDescriptor(i.errorCtor, 'prepareStackTrace') !== undefined) return false;
  if (getOwnPropertyDescriptor(i.functionProto, 'prepareStackTrace') !== undefined) return false;
  if (getOwnPropertyDescriptor(i.objectProto, 'prepareStackTrace') !== undefined) return false;
  const limit = getOwnPropertyDescriptor(i.errorCtor, 'stackTraceLimit');
  if (limit === undefined || !hasOwn(limit, 'value')) return false;
  const v: unknown = limit.value;
  return typeof v === 'number' && isInteger(v) && v >= 1 && v <= MAX_STACK_TRACE_LIMIT;
}

export type StackBudgetKind = 'send' | 'registration';

export type StackSample = { status: 'sampled'; script: ScriptRef } | { status: 'budget' } | { status: 'unavailable' };

export interface StackSamplerSnapshot {
  enabled: boolean;
  sampled: number;
  budget: number;
  unavailable: number;
}

export interface StackSampler {
  /** Samples the stack below `omit` (a function currently on the stack: the installed wrapper). */
  sample(kind: StackBudgetKind, omit: Function): StackSample;
  readonly enabled: boolean;
  snapshot(): StackSamplerSnapshot;
}

export interface StackSamplerOptions {
  /** Monotonic clock (captured performance.now). */
  now(): number;
  /** Host of the document (inline code of the document -> `document`). */
  docHost: string;
  /** The intrinsics were captured at document_start; false -> the sampler is off (late-start). */
  earlyCapture: boolean;
  /** Per-window budgets (tests and the perf probe); default PROTECT_BUDGETS. */
  budgets?: { send: number; registration: number };
  windowMs?: number;
}

const UNAVAILABLE: StackSample = Object.freeze({ status: 'unavailable' }) as StackSample;
const BUDGET: StackSample = Object.freeze({ status: 'budget' }) as StackSample;

export function createStackSampler(intrinsics: StackIntrinsics | null, options: StackSamplerOptions): StackSampler {
  const enabled = intrinsics !== null && options.earlyCapture;
  const sendBudget = options.budgets?.send ?? PROTECT_BUDGETS.sendSamplesPerWindow;
  const registrationBudget = options.budgets?.registration ?? PROTECT_BUDGETS.registrationSamplesPerWindow;
  const windowMs = options.windowMs ?? PROTECT_BUDGETS.sampleWindowMs;
  const docHost = options.docHost;
  const now = options.now;
  let windowStart = -Infinity;
  let sends = 0;
  let registrations = 0;
  const counts = { sampled: 0, budget: 0, unavailable: 0 };

  function take(kind: StackBudgetKind): boolean {
    const t = now();
    if (!(t - windowStart < windowMs) || t < windowStart) {
      windowStart = t;
      sends = 0;
      registrations = 0;
    }
    if (kind === 'send') {
      if (sends >= sendBudget) return false;
      sends++;
    } else {
      if (registrations >= registrationBudget) return false;
      registrations++;
    }
    return true;
  }

  return {
    enabled,
    sample(kind: StackBudgetKind, omit: Function): StackSample {
      if (!enabled || intrinsics === null) {
        counts.unavailable++;
        return UNAVAILABLE;
      }
      if (!take(kind)) {
        counts.budget++;
        return BUDGET;
      }
      try {
        if (!stackIntegrityOk(intrinsics)) {
          counts.unavailable++;
          return UNAVAILABLE;
        }
        const holder = create(null) as object;
        apply(intrinsics.captureStackTrace, intrinsics.errorCtor, [holder, omit]);
        const d = getOwnPropertyDescriptor(holder, 'stack');
        let stack: unknown;
        if (d !== undefined) {
          if (hasOwn(d, 'value')) stack = d.value;
          else if (typeof d.get === 'function') stack = apply(d.get, holder, NO_ARGS);
        }
        if (typeof stack !== 'string') {
          counts.unavailable++;
          return UNAVAILABLE;
        }
        counts.sampled++;
        return { status: 'sampled', script: parseFirstPageFrame(stack, docHost) };
      } catch {
        counts.unavailable++;
        return UNAVAILABLE;
      }
    },
    snapshot(): StackSamplerSnapshot {
      return { enabled, sampled: counts.sampled, budget: counts.budget, unavailable: counts.unavailable };
    },
  };
}
