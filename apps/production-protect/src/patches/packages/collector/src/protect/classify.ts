// ADR-050 / audit F1: production adapter; the 722fae8 vendor snapshot remains unchanged.
// Field classification of the module «Защита», ISOLATED side (ADR-020 §3, §12; S05). Builds the attribute view of a
// form control for the pure engine rule (packages/engine/src/protect/never-read.ts). A value is never read here: only
// attributes through getAttribute / hasAttribute and localName. A field that was a password at any time while
// observed ("show password" toggles `type`) stays never-read: a WeakSet, a MutationObserver on `type` with
// attributeOldValue, and a check at every focusin.

import { classifyField, isPaymentField } from "../../../../../../../../vendor/protect-722fae8/packages/engine/src/protect/never-read";
import type { FieldClass, FieldView } from "../../../../../../../../vendor/protect-722fae8/packages/engine/src/protect/never-read";
import type { NeverReadClass } from '@detect-expert/contracts';

export type { FieldClass, FieldView };

/** What classification needs from an element (a real Element satisfies it). */
export interface FieldElementLike {
  readonly localName: string;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
}

/** One `type` attribute mutation (MutationRecord.target / oldValue). */
export interface TypeRecordLike {
  readonly target: unknown;
  readonly oldValue: string | null;
}

export interface TypeObserverPort {
  /** Pending records not yet delivered to the callback (so a toggle in the same task is never missed). */
  takeRecords(): readonly TypeRecordLike[];
  /** True only for a live control with continuous observation in this document. */
  isTracked(element: FieldElementLike): boolean;
  disconnect(): void;
}

const MAX_ATTR = 64;
// REQ-005 / PP-01: inspect complete bounded attributes before the vendor's 64-character hint matcher.
const MAX_SAFETY_ATTR = 4096;
const CREDENTIAL_HINT_RE = /pass|pwd|парол|secret|token|otp|\bpin\b|cvv|cvc|card|карт|iban|account|сч[её]т|snils|снилс|\binn\b|инн|passport|паспорт|ssn|code|код/i;
const PAYMENT_HINT_RE = /cvv|cvc|card|iban/i;
const PASSWORD_AUTOCOMPLETE_RE = /(?:^|\s)(?:current-password|new-password)(?=\s|$)/;
const OTP_AUTOCOMPLETE_RE = /(?:^|\s)one-time-code(?=\s|$)/;
const PAYMENT_AUTOCOMPLETE_RE = /(?:^|\s)cc-[^\s]*(?=\s|$)/;

/** An element-like object (structural check: classification never trusts a non-element). */
export function asFieldElement(target: unknown): FieldElementLike | null {
  if (typeof target !== 'object' || target === null) return null;
  const el = target as Partial<FieldElementLike>;
  return typeof el.localName === 'string' && typeof el.getAttribute === 'function' && typeof el.hasAttribute === 'function' ? (el as FieldElementLike) : null;
}

/** An attribute, at most 64 characters, lowercase; '' when absent. */
function attr(el: FieldElementLike, name: string): string {
  const v = el.getAttribute(name);
  return typeof v === 'string' ? v.slice(0, MAX_ATTR).toLowerCase() : '';
}

/** `type="password"` right now (attribute, ASCII case-insensitive, surrounding spaces ignored: stricter than HTML). */
export function isPasswordType(el: FieldElementLike): boolean {
  return attr(el, 'type').trim() === 'password';
}

/** Complete bounded attributes for safety checks; null means classification cannot safely inspect the field. */
export function fieldView(el: FieldElementLike, everPassword: boolean): FieldView | null {
  const attributes = { type: '', autocomplete: '', name: '', id: '', placeholder: '', 'aria-label': '' };
  for (const key of Object.keys(attributes) as (keyof typeof attributes)[]) {
    const raw = el.getAttribute(key);
    if (typeof raw === 'string') {
      if (raw.length > MAX_SAFETY_ATTR) return null;
      attributes[key] = raw.toLowerCase();
    }
  }
  return {
    tag: el.localName.slice(0, MAX_ATTR).toLowerCase(),
    type: attributes.type,
    autocomplete: attributes.autocomplete,
    name: attributes.name,
    id: attributes.id,
    placeholder: attributes.placeholder,
    ariaLabel: attributes['aria-label'],
    readOnly: el.hasAttribute('readonly'),
    disabled: el.hasAttribute('disabled'),
    everPassword,
  };
}

/** Negative checks use complete attributes; truncation may never turn a forbidden field into an allowed one. */
function safetyClass(view: FieldView): NeverReadClass | null {
  if (PASSWORD_AUTOCOMPLETE_RE.test(view.autocomplete)) return 'password';
  if (OTP_AUTOCOMPLETE_RE.test(view.autocomplete)) return 'one-time-code';
  if (safetyPayment(view)) return 'payment';
  const hints = [view.name, view.id, view.placeholder, view.ariaLabel];
  return hints.some(hint => CREDENTIAL_HINT_RE.test(hint)) ? 'credential-hint' : null;
}

function safetyPayment(view: FieldView): boolean {
  return PAYMENT_AUTOCOMPLETE_RE.test(view.autocomplete) || [view.name, view.id, view.placeholder, view.ariaLabel].some(hint => PAYMENT_HINT_RE.test(hint));
}

/**
 * Password memory of one document: an element that was `type=password` at any time while observed. Fed by the
 * MutationObserver on `type` (old and new value) and by `note()` at every focusin; `has()` first drains the pending
 * records, so a toggle earlier in the same task counts.
 */
export class EverPasswordTracker {
  private readonly seen = new WeakSet<object>();
  private observer: TypeObserverPort | null = null;
  private healthy = true;

  constructor(observe: ((callback: (records: readonly TypeRecordLike[]) => void) => TypeObserverPort | null) | null) {
    try { if (observe !== null) this.observer = observe((records) => this.ingest(records)); }
    catch { this.healthy = false; }
  }

  private ingest(records: readonly TypeRecordLike[]): void {
    for (const r of records) {
      const el = asFieldElement(r.target);
      if (el === null) continue;
      if ((typeof r.oldValue === 'string' && r.oldValue.slice(0, MAX_ATTR).toLowerCase().trim() === 'password') || isPasswordType(el)) this.seen.add(el);
    }
  }

  /** Focusin (and every classification): a field that is a password now is remembered. */
  note(el: FieldElementLike): void {
    if (isPasswordType(el)) this.seen.add(el);
  }

  /** The element was a password at any time while observed (or is one now). */
  has(el: FieldElementLike): boolean {
    if (this.observer !== null) {
      try {
        this.ingest(this.observer.takeRecords());
      } catch {
        this.healthy = false;
      }
    }
    this.note(el);
    return this.seen.has(el);
  }

  /** Unknown/failed observation is not evidence that a field was never a password. */
  isTracked(el: FieldElementLike): boolean {
    this.has(el); // Drain same-task type changes before asking about coverage.
    if (!this.healthy || this.observer === null) return false;
    try { return this.observer.isTracked(el) === true; }
    catch { this.healthy = false; return false; }
  }

  stop(): void {
    try {
      this.observer?.disconnect();
    } catch {
      // Nothing to release.
    }
    this.observer = null;
  }
}

/** Classification of one control: never-read classes before any kind (engine rule). */
export function classify(el: FieldElementLike, tracker: EverPasswordTracker): FieldClass | null {
  if (!tracker.isTracked(el)) return null;
  const view = fieldView(el, tracker.has(el));
  if (view === null) return { never: 'credential-hint' };
  const never = safetyClass(view);
  return never === null ? classifyField(view) : { never };
}

/** A payment control (cc-*, card/cvv/cvc/iban hints; any type but hidden): reading in this document is suspended. */
export function isPaymentControl(el: FieldElementLike): boolean {
  const tag = el.localName.slice(0, MAX_ATTR).toLowerCase();
  if ((tag !== 'input' && tag !== 'select') || attr(el, 'type') === 'hidden') return false;
  const view = fieldView(el, false);
  if (view === null) return true;
  return safetyPayment(view) || isPaymentField(view);
}
