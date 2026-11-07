// ADR-020 §B, §8 (S04): bounded merging of the module's evidence records and confidence ceilings. Pure. Evidence never
// carries a value, hash, mask, value length, URL or query: only enums, a parameter name, hosts and a path template.

import { COUNT_QUALITIES, MAX_COUNT, PARAM_NAME_PATTERN, PROTECT_BUDGETS, PROTECT_LIMITATIONS, PROTECT_WIRE_LIMITS, VALUE_ENCODINGS } from '@detect-expert/contracts';
import type { CountQuality, FieldKind, ProtectDropped, ProtectEvidence, ProtectKind, ProtectLimitation, ValueEncoding } from '@detect-expert/contracts';

export type ProtectConfidence = 'low' | 'medium' | 'high';

const CONFIDENCE_ORDER: Readonly<Record<ProtectConfidence, number>> = { low: 0, medium: 1, high: 2 };
/** Encodings that do not hide the value: a plain name match can be a coincidence (common words). */
const PLAIN_ENCODINGS: ReadonlySet<ValueEncoding> = /* @__PURE__ */ new Set<ValueEncoding>(['plain', 'plain-normalized', 'url-encoded']);

/**
 * Highest interpretation confidence a record may carry (ADR-020 §B, §E, §F):
 * password-field-listener ≤ low; replay-pattern ≤ medium; opaque-after-input = low; a `name` value found only in plain
 * encodings ≤ medium; otherwise high.
 */
export function confidenceCeiling(kind: ProtectKind, fieldKind: FieldKind | null, encodings: readonly ValueEncoding[]): ProtectConfidence {
  switch (kind) {
    case 'password-field-listener':
    case 'opaque-after-input':
      return 'low';
    case 'replay-pattern':
      return 'medium';
    case 'value-match':
      if (fieldKind === 'name' && (encodings.length === 0 || encodings.every((e) => PLAIN_ENCODINGS.has(e)))) return 'medium';
      return 'high';
  }
}

/** `level` lowered to `ceiling` when above it. */
export function capConfidence(level: ProtectConfidence, ceiling: ProtectConfidence): ProtectConfidence {
  return CONFIDENCE_ORDER[level] > CONFIDENCE_ORDER[ceiling] ? ceiling : level;
}

function maxConfidence(a: ProtectConfidence, b: ProtectConfidence): ProtectConfidence {
  return CONFIDENCE_ORDER[a] >= CONFIDENCE_ORDER[b] ? a : b;
}

const LONG_DIGITS_RE = /\d{6,}/;
const LONG_HEX_RE = /[0-9a-f]{12,}/i;

/**
 * A request parameter NAME as it may appear in evidence: PARAM_NAME_PATTERN (≤ maxParamNameChars), no ID-like runs
 * (≥ 6 digits or ≥ 12 hex characters). Anything else → null (the evidence then omits the name).
 */
export function sanitizeParamName(name: unknown): string | null {
  if (typeof name !== 'string' || name.length === 0 || name.length > PROTECT_BUDGETS.maxParamNameChars) return null;
  if (!PARAM_NAME_PATTERN.test(name)) return null;
  if (LONG_DIGITS_RE.test(name) || LONG_HEX_RE.test(name)) return null;
  return name;
}

/**
 * Merge key (ADR-020 §B): protectKind, fieldKind, transferClass, receiver|receiverCategory, location+paramName,
 * endpointHost+endpointPathTemplate, deliveryState; listener/replay records by kind, frame and receiver.
 */
export function evidenceKey(e: ProtectEvidence): string {
  const frame = e.frameContext + '|' + (e.frameSite ?? '');
  switch (e.protectKind) {
    case 'value-match':
    case 'opaque-after-input':
      return [
        e.protectKind,
        e.fieldKind,
        e.transferClass,
        e.receiver !== undefined ? 'r:' + e.receiver : 'c:' + (e.receiverCategory ?? ''),
        (e.location ?? '') + '|' + (e.paramName ?? '') + '|' + (e.pathSegment ?? ''),
        (e.endpointHost ?? '') + '|' + e.endpointPathTemplate,
        e.deliveryState,
        frame,
      ].join('\u0001');
    case 'password-field-listener':
      return [e.protectKind, frame, e.script?.kind ?? '', e.script?.host ?? '', e.script?.pathTemplate ?? ''].join('\u0001');
    case 'replay-pattern':
      return [e.protectKind, frame, e.receiver].join('\u0001');
  }
}

function canonicalEncodings(list: readonly ValueEncoding[]): ValueEncoding[] {
  const set = new Set(list);
  return VALUE_ENCODINGS.filter((e) => set.has(e)).slice(0, PROTECT_WIRE_LIMITS.maxEvidenceEncodings);
}

function canonicalLimitations(list: readonly ProtectLimitation[], max: number): ProtectLimitation[] {
  const set = new Set(list);
  return PROTECT_LIMITATIONS.filter((l) => set.has(l)).slice(0, max);
}

function worseQuality(a: CountQuality, b: CountQuality): CountQuality {
  return COUNT_QUALITIES.indexOf(a) >= COUNT_QUALITIES.indexOf(b) ? a : b;
}

function satAdd(a: number, b: number): number {
  return Math.min(MAX_COUNT, Math.max(0, a) + Math.max(0, b));
}

export interface MergeEvidenceResult {
  evidence: ProtectEvidence[];
  dropped: ProtectDropped;
  /** True when `next` was dropped because the document already holds maxEvidencePerDocument records. */
  budgetExceeded: boolean;
  /** Index of the merged or inserted record, or -1 when dropped. */
  index: number;
}

/**
 * Adds `next` to `list` (a new array; inputs are not mutated). Same key: counts saturate, the time span widens,
 * encodings (≤ 4) and limitations (≤ 8) are unions in canonical order, countQuality takes the worse one and the
 * confidence the higher one, both under the ceiling. Beyond maxEvidencePerDocument records the new one is dropped
 * (`dropped.evidence + 1`, budgetExceeded: the caller adds the `budget-exceeded` limitation).
 */
export function mergeEvidence(list: readonly ProtectEvidence[], next: ProtectEvidence, dropped: ProtectDropped): MergeEvidenceResult {
  const key = evidenceKey(next);
  const out = list.slice();
  for (let i = 0; i < out.length; i++) {
    const cur = out[i]!;
    if (evidenceKey(cur) !== key) continue;
    const merged = mergeOne(cur, next);
    out[i] = merged;
    return { evidence: out, dropped, budgetExceeded: false, index: i };
  }
  if (out.length >= PROTECT_BUDGETS.maxEvidencePerDocument) {
    return { evidence: out, dropped: { ...dropped, evidence: satAdd(dropped.evidence, 1) }, budgetExceeded: true, index: -1 };
  }
  out.push(next);
  return { evidence: out, dropped, budgetExceeded: false, index: out.length - 1 };
}

function mergeOne(cur: ProtectEvidence, next: ProtectEvidence): ProtectEvidence {
  const base = {
    count: satAdd(cur.count, next.count),
    countQuality: worseQuality(cur.countQuality, next.countQuality),
    firstSecond: Math.min(cur.firstSecond, next.firstSecond),
    lastSecond: Math.max(cur.lastSecond, next.lastSecond),
    limitationCodes: canonicalLimitations([...cur.limitationCodes, ...next.limitationCodes], PROTECT_WIRE_LIMITS.maxEvidenceLimitations),
  };
  switch (cur.protectKind) {
    case 'value-match':
    case 'opaque-after-input': {
      const n = next as typeof cur;
      const encodings = cur.protectKind === 'opaque-after-input' ? [] : canonicalEncodings([...cur.encodings, ...n.encodings]);
      const ceiling = confidenceCeiling(cur.protectKind, cur.fieldKind, encodings);
      return { ...cur, ...base, encodings, interpretationConfidence: capConfidence(maxConfidence(cur.interpretationConfidence, n.interpretationConfidence), ceiling) };
    }
    case 'password-field-listener':
      return { ...cur, ...base, interpretationConfidence: 'low' };
    case 'replay-pattern': {
      const n = next as typeof cur;
      return { ...cur, ...base, interpretationConfidence: capConfidence(maxConfidence(cur.interpretationConfidence, n.interpretationConfidence), 'medium') as 'low' | 'medium' };
    }
  }
}
