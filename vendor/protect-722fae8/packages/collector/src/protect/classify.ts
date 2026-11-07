// Field classification of the module «Защита», ISOLATED side (ADR-020 §3, §12; S05). Builds the attribute view of a
// form control for the pure engine rule (packages/engine/src/protect/never-read.ts). A value is never read here: only
// attributes through getAttribute / hasAttribute and localName. A field that was a password at any time while
// observed ("show password" toggles `type`) stays never-read: a WeakSet, a MutationObserver on `type` with
// attributeOldValue, and a check at every focusin.

import { classifyField, isPaymentField } from '../../../engine/src/protect/never-read';
import type { FieldClass, FieldView } from '../../../engine/src/protect/never-read';

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
  disconnect(): void;
}

const MAX_ATTR = 64;

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

/** Attribute view of a control (FieldView of the engine). Never reads a value. */
export function fieldView(el: FieldElementLike, everPassword: boolean): FieldView {
  return {
    tag: el.localName.slice(0, MAX_ATTR).toLowerCase(),
    type: attr(el, 'type'),
    autocomplete: attr(el, 'autocomplete'),
    name: attr(el, 'name'),
    id: attr(el, 'id'),
    placeholder: attr(el, 'placeholder'),
    ariaLabel: attr(el, 'aria-label'),
    readOnly: el.hasAttribute('readonly'),
    disabled: el.hasAttribute('disabled'),
    everPassword,
  };
}

/**
 * Password memory of one document: an element that was `type=password` at any time while observed. Fed by the
 * MutationObserver on `type` (old and new value) and by `note()` at every focusin; `has()` first drains the pending
 * records, so a toggle earlier in the same task counts.
 */
export class EverPasswordTracker {
  private readonly seen = new WeakSet<object>();
  private observer: TypeObserverPort | null = null;

  constructor(observe: ((callback: (records: readonly TypeRecordLike[]) => void) => TypeObserverPort | null) | null) {
    if (observe !== null) this.observer = observe((records) => this.ingest(records));
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
        // A failed drain leaves the check below, which still covers a field that is a password right now.
      }
    }
    this.note(el);
    return this.seen.has(el);
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
  return classifyField(fieldView(el, tracker.has(el)));
}

/** A payment control (cc-*, card/cvv/cvc/iban hints; any type but hidden): reading in this document is suspended. */
export function isPaymentControl(el: FieldElementLike): boolean {
  return isPaymentField(fieldView(el, false));
}
