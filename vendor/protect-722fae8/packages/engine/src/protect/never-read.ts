// ADR-020 §3, §12 (S04): field classification of the module «Защита». Pure: the input is a view of ATTRIBUTES only
// (built by packages/collector/src/protect/classify.ts); a value is never an input here. Never-read classes are decided
// before any kind, so a password (now or ever), a payment field, a one-time code or a credential-like name is never read.

import { PROTECT_BUDGETS } from '@detect-expert/contracts';
import type { FieldKind, NeverReadClass } from '@detect-expert/contracts';

/** Attribute view of one form control. Every string is lowercased and at most 64 characters (classify.ts). */
export interface FieldView {
  /** localName, e.g. 'input', 'textarea', 'select'. */
  tag: string;
  /** The `type` attribute ('' when absent). */
  type: string;
  autocomplete: string;
  name: string;
  id: string;
  placeholder: string;
  ariaLabel: string;
  readOnly: boolean;
  disabled: boolean;
  /** The element was a password field at any time while observed (type toggled by «show password»). */
  everPassword: boolean;
}

export type FieldClass = { kind: FieldKind } | { never: NeverReadClass };

const MAX_ATTR = 64;
const TEXT_TYPES: ReadonlySet<string> = /* @__PURE__ */ new Set(['text', 'email', 'tel', '']);

const CREDENTIAL_HINT_RE = /pass|pwd|парол|secret|token|otp|\bpin\b|cvv|cvc|card|карт|iban|account|сч[её]т|snils|снилс|\binn\b|инн|passport|паспорт|ssn|code|код/i;
const PAYMENT_HINT_RE = /cvv|cvc|card|iban/i;
const EMAIL_HINT_RE = /e-?mail|почт/;
const PHONE_HINT_RE = /phone|\btel\b|телефон|mobile/;
const NAME_ATTR_RE = /^(first|last|full|given|family|sur)?[_-]?name$/;
const NAME_TEXT_RE = /имя|фамил|\bfio\b|фио/;
/** Not a person's name: account identifiers and organisations (S04: «логин»/«пользовател» added, stricter). */
const NOT_NAME_RE = /username|nickname|company|login|логин|пользовател/;
const NAME_AUTOCOMPLETE: ReadonlySet<string> = /* @__PURE__ */ new Set(['name', 'given-name', 'family-name', 'additional-name']);

function norm(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, MAX_ATTR).toLowerCase() : '';
}

function tokens(autocomplete: string): string[] {
  return autocomplete.split(/\s+/).filter((t) => t.length > 0);
}

/** name, id, placeholder and aria-label (normalized): the texts the hint rules look at. */
function hints(view: FieldView): string[] {
  return [norm(view.name), norm(view.id), norm(view.placeholder), norm(view.ariaLabel)];
}

function anyHint(texts: readonly string[], re: RegExp): boolean {
  for (const t of texts) if (t.length > 0 && re.test(t)) return true;
  return false;
}

function isPaymentAutocomplete(list: readonly string[]): boolean {
  for (const t of list) if (t.startsWith('cc-')) return true;
  return false;
}

/**
 * Classification, in order (ADR-020 §3):
 * 1. not an `input` → null; `type=password` → never `password`; ever a password → never `was-password`
 *    (checked before the type filter, so a password field is always reported as never-read);
 * 2. `type` not in {text, email, tel, ''} → null;
 * 3. autocomplete `current-password|new-password` → `password`; `one-time-code` → `one-time-code`; `cc-*` → `payment`;
 * 4. name/id/placeholder/aria-label credential hints → `credential-hint` (`payment` for card/cvv/cvc/iban);
 * 5. read-only or disabled → null;
 * 6. e-mail; 7. phone (never `telegram`); 8. person name (never username/nickname/company/login); 9. otherwise null.
 */
export function classifyField(view: FieldView): FieldClass | null {
  if (norm(view.tag) !== 'input') return null;
  const type = norm(view.type);
  if (type === 'password') return { never: 'password' };
  if (view.everPassword) return { never: 'was-password' };
  if (!TEXT_TYPES.has(type)) return null;

  const auto = tokens(norm(view.autocomplete));
  if (auto.includes('current-password') || auto.includes('new-password')) return { never: 'password' };
  if (auto.includes('one-time-code')) return { never: 'one-time-code' };
  if (isPaymentAutocomplete(auto)) return { never: 'payment' };

  const texts = hints(view);
  if (anyHint(texts, CREDENTIAL_HINT_RE)) return { never: anyHint(texts, PAYMENT_HINT_RE) ? 'payment' : 'credential-hint' };

  if (view.readOnly || view.disabled) return null;

  if (type === 'email' || auto.includes('email') || anyHint(texts, EMAIL_HINT_RE)) return { kind: 'email' };

  const telegram = anyHint(texts, /telegram/);
  if (!telegram && (type === 'tel' || auto.some((t) => t.startsWith('tel')) || anyHint(texts, PHONE_HINT_RE))) return { kind: 'phone' };

  const nameAuto = auto.some((t) => NAME_AUTOCOMPLETE.has(t));
  const nameAttr = NAME_ATTR_RE.test(norm(view.name)) || NAME_ATTR_RE.test(norm(view.id)) || anyHint(texts, NAME_TEXT_RE);
  if ((nameAuto || nameAttr) && !anyHint(texts, NOT_NAME_RE) && !auto.includes('username') && !auto.includes('nickname')) return { kind: 'name' };

  return null;
}

/**
 * A payment control anywhere in the document suspends reading of the other fields (ADR-020 §4). Any input type except
 * hidden: autocomplete `cc-*`, or card/cvv/cvc/iban in name/id/placeholder/aria-label.
 */
export function isPaymentField(view: FieldView): boolean {
  const tag = norm(view.tag);
  if (tag !== 'input' && tag !== 'select') return false;
  if (norm(view.type) === 'hidden') return false;
  if (isPaymentAutocomplete(tokens(norm(view.autocomplete)))) return true;
  return anyHint(hints(view), PAYMENT_HINT_RE);
}

const EMAIL_SHAPE_RE = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/;
const PHONE_CHARS_RE = /^[+\d\s().-]+$/;
const DIGIT_RE = /\d/;

/**
 * Shape check of a value read for `kind` (the reader calls it once and drops the value): length within
 * minValueChars..maxValueChars[kind]; e-mail pattern; phone = 7..15 digits in phone punctuation; a name has no digits.
 */
export function isValueShapeOk(kind: FieldKind, value: string): boolean {
  if (typeof value !== 'string') return false;
  if (value.length < PROTECT_BUDGETS.minValueChars || value.length > PROTECT_BUDGETS.maxValueChars[kind]) return false;
  switch (kind) {
    case 'email':
      return EMAIL_SHAPE_RE.test(value);
    case 'phone': {
      if (!PHONE_CHARS_RE.test(value)) return false;
      let digits = 0;
      for (let i = 0; i < value.length; i++) {
        const c = value.charCodeAt(i);
        if (c >= 48 && c <= 57) digits++;
      }
      return digits >= 7 && digits <= 15;
    }
    case 'name':
      return value.trim().length >= PROTECT_BUDGETS.minValueChars && !DIGIT_RE.test(value);
  }
}
