// ADR-050 / audit F1: production adapter; the 722fae8 vendor snapshot remains unchanged.
// THE ONLY reader of a field value in the module «Защита» (ADR-020 §4, §12; S05). Lint (scripts/code-checks.mjs
// scanFieldReads) rejects `.value` in every other ISOLATED module file; the tripwire spec
// (tests/extension/protect/password-never-read.spec.ts) proves at runtime, with positive controls, that no password is
// ever read. Order of checks, all before the read:
//   1. classify again from attributes (never-read classes first): a password, a field that was ever a password, a
//      payment field, a one-time code or a credential-like name is never read; an untracked control neither;
//   2. a payment control anywhere in the document suspends reading of every field of this document;
//   3. right before the read: `type` is not password and the field was never a password.
// The value lives only inside this call: it goes to `use` (fingerprints and the dedup hash) and is dropped. It is
// never stored, logged, posted to the page or sent to the SW.

import { PROTECT_BUDGETS } from '@detect-expert/contracts';
import type { FieldKind, NeverReadClass } from '@detect-expert/contracts';
import { isValueShapeOk } from "../../../../../../../../vendor/protect-722fae8/packages/engine/src/protect/never-read";
import { classify, isPasswordType } from './classify';
import type { EverPasswordTracker, FieldElementLike } from './classify';

/** A form control with a value (in the browser: the ISOLATED world's own wrapper of the element). */
export interface FieldValueElement extends FieldElementLike {
  readonly value: unknown;
}

export interface ReadContext {
  readonly tracker: EverPasswordTracker;
  /** True when the document has a payment control (cc-*, card/cvv/cvc/iban): every read is suspended. */
  documentHasPaymentField(): boolean;
}

export type ReadOutcome<T> =
  | { status: 'read'; fieldKind: FieldKind; result: T }
  | { status: 'never'; never: NeverReadClass }
  | { status: 'not-tracked' }
  | { status: 'payment-suspended' }
  | { status: 'rejected-shape' };

/**
 * Reads the value of a tracked e-mail / phone / name field once and hands it to `use`; the value is not kept.
 * Returns why nothing was read otherwise (`never`, `not-tracked`, `payment-suspended`, `rejected-shape`).
 */
export function readTrackedValue<T>(el: FieldValueElement, ctx: ReadContext, use: (fieldKind: FieldKind, value: string) => T): ReadOutcome<T> {
  // 1. Classification from attributes only; never-read classes are decided before any kind.
  const cls = classify(el, ctx.tracker);
  if (cls === null) return { status: 'not-tracked' };
  if ('never' in cls) return { status: 'never', never: cls.never };
  const fieldKind = cls.kind;
  // 2. A payment control in the document suspends every read of this document.
  if (ctx.documentHasPaymentField()) return { status: 'payment-suspended' };
  // 3. Last check right before the read: not a password now and never one while observed.
  if (isPasswordType(el)) return { status: 'never', never: 'password' };
  if (ctx.tracker.has(el)) return { status: 'never', never: 'was-password' };
  if (!ctx.tracker.isTracked(el)) return { status: 'not-tracked' };
  const raw: unknown = el.value; // @protect-audited-read
  if (typeof raw !== 'string') return { status: 'rejected-shape' };
  if (raw.length < PROTECT_BUDGETS.minValueChars || raw.length > PROTECT_BUDGETS.maxValueChars[fieldKind] || !isValueShapeOk(fieldKind, raw)) {
    return { status: 'rejected-shape' };
  }
  return { status: 'read', fieldKind, result: use(fieldKind, raw) };
}
