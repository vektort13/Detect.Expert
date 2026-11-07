// ADR-020 §B (S07): the `form-leak` rule — transfer class, severity and interpretation confidence of a typed value found
// in an outgoing request. Pure (no chrome.*, no clock). Thresholds: thresholds/form-leak.v1.json (`calibrated:false`:
// there is no corpus; the numbers are design defaults, never tuned to a result). Every result describes a send that
// had already started (ADR-020 §11): the class never says "held" or "will not receive".

import type { FieldKind, ProtectLimitation, SiteRelation, SubmitTiming, TransferClass, ValueEncoding } from '@detect-expert/contracts';
import type { ProtectConfidence } from './evidence';
import thresholds from './thresholds/form-leak.v1.json';

export const FORM_LEAK_THRESHOLDS = Object.freeze({
  ruleId: 'form-leak' as const,
  version: thresholds.version,
  calibrated: thresholds.calibrated,
  plaintextMinChars: thresholds.plaintextMinChars,
  hashMinChars: thresholds.hashMinChars,
  ringWindowMs: thresholds.ringWindowMs,
  opaqueWindowMs: thresholds.opaqueWindowMs,
  submitCarryMs: thresholds.submitCarryMs,
  crossSiteGraceMs: thresholds.crossSiteGraceMs,
  phoneMediumDigits: thresholds.phoneMediumDigits,
  piiNameKeys: Object.freeze([...thresholds.piiNameKeys]) as readonly string[],
});

/** ruleVersion of every form-leak evidence record. */
export const FORM_LEAK_RULE_VERSION: string = thresholds.version;

export interface TransferInput {
  /** Relation of the receiver to the top-level site; `unknown` / `opaque` = no registrable receiver. */
  relation: SiteRelation;
  submitTiming: SubmitTiming;
  /** The request body could not be read (compressed, binary, Blob, stream). */
  opaque: boolean;
}

/**
 * Transfer class of a matched request, or null when it is not reported: a first-party request at or after the submit
 * (or with an unknown moment) is the form doing its job. An opaque body counts only towards a third party.
 */
export function classifyTransfer(input: TransferInput): TransferClass | null {
  const { relation, submitTiming, opaque } = input;
  const firstParty = relation === 'same-origin' || relation === 'same-site';
  if (opaque) return relation === 'cross-site' ? 'opaque-after-input' : null;
  if (firstParty) return submitTiming === 'before-submit' ? 'first-party-before-submit' : null;
  if (relation === 'cross-site') {
    if (submitTiming === 'before-submit') return 'third-party-before-submit';
    if (submitTiming === 'after-submit') return 'third-party-at-submit';
    return 'third-party-moment-unknown';
  }
  return 'receiver-unknown';
}

export type TransferSeverity = 'high' | 'medium' | 'low' | 'info';

/** UI weight of a class (a color, never a word like "dangerous"; docs/ui-copy.md §6.14). */
export function severityOf(transferClass: TransferClass): TransferSeverity {
  switch (transferClass) {
    case 'third-party-before-submit':
      return 'high';
    case 'third-party-at-submit':
    case 'third-party-moment-unknown':
      return 'medium';
    case 'first-party-before-submit':
      return 'low';
    case 'receiver-unknown':
    case 'opaque-after-input':
      return 'info';
  }
}

const HASH_ENCODINGS: ReadonlySet<ValueEncoding> = /* @__PURE__ */ new Set<ValueEncoding>([
  'md5-hex', 'sha1-hex', 'sha256-hex', 'sha512-hex', 'md5-base64', 'sha1-base64', 'sha256-base64', 'sha512-base64',
]);

export function isHashEncoding(enc: ValueEncoding): boolean {
  return HASH_ENCODINGS.has(enc);
}

export interface ConfidenceInput {
  fieldKind: FieldKind;
  /** Encodings the value was found in (1..4); [] for an opaque body. */
  encodings: readonly ValueEncoding[];
  /** Phone: digits of the matched text (counted in the SW callback, never kept); other kinds: ignored. */
  baseLength: number;
  /** Parameter name where the value was found (already sanitized), or null. */
  paramName: string | null;
  /** Only normalized forms matched (lower case, digits): one level lower for phone and name. */
  normalizedOnly: boolean;
  /** The value was typed in an earlier document of the tab: at most medium. */
  fromPreviousDocument: boolean;
  opaque: boolean;
}

export interface ConfidenceResult {
  level: ProtectConfidence;
  limitationCodes: ProtectLimitation[];
}

const ORDER: readonly ProtectConfidence[] = ['low', 'medium', 'high'];

function lower(level: ProtectConfidence): ProtectConfidence {
  return ORDER[Math.max(0, ORDER.indexOf(level) - 1)]!;
}

function atMost(level: ProtectConfidence, ceiling: ProtectConfidence): ProtectConfidence {
  return ORDER.indexOf(level) > ORDER.indexOf(ceiling) ? ceiling : level;
}

/** Whether a parameter name is a personal-name key (fn, ln, name, first_name, … — the last name component). */
export function isPiiNameKey(paramName: string | null): boolean {
  if (paramName === null) return false;
  const parts = paramName.toLowerCase().split(/[.[\]]+/).filter((p) => p.length > 0);
  const last = parts[parts.length - 1];
  return last !== undefined && FORM_LEAK_THRESHOLDS.piiNameKeys.includes(last);
}

/**
 * Interpretation confidence of a match (ADR-020 §B, form-leak.v1): a hash of an e-mail or phone → high, of a name →
 * medium; an e-mail as plain text → high; a phone as plain text → medium with ≥ 10 digits, else low; a name as plain
 * text → medium only under a personal-name key, else low with `name-plaintext-ambiguous`; normalized-only matches are
 * one level lower for phone and name; a value from a previous document is at most medium; an opaque body is low.
 */
export function assessConfidence(input: ConfidenceInput): ConfidenceResult {
  const limitationCodes: ProtectLimitation[] = [];
  if (input.opaque) return { level: 'low', limitationCodes: ['body-opaque'] };
  const hashed = input.encodings.some(isHashEncoding);
  let level: ProtectConfidence;
  switch (input.fieldKind) {
    case 'email':
      level = 'high';
      break;
    case 'phone':
      level = hashed ? 'high' : input.baseLength >= FORM_LEAK_THRESHOLDS.phoneMediumDigits ? 'medium' : 'low';
      break;
    case 'name':
      if (hashed) level = 'medium';
      else if (isPiiNameKey(input.paramName)) level = 'medium';
      else {
        level = 'low';
        limitationCodes.push('name-plaintext-ambiguous');
      }
      break;
  }
  if (input.normalizedOnly && !hashed && input.fieldKind !== 'email') level = lower(level);
  if (input.fromPreviousDocument) {
    level = atMost(level, 'medium');
    limitationCodes.push('value-from-previous-document');
  }
  return { level, limitationCodes };
}
