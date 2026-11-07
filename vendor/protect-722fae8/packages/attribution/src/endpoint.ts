// ADR-020 §B (S07): value-free endpoint description of a request for the module's evidence. Used transiently inside
// the SW webRequest callback; the URL itself is never returned or kept (REQ-005): only a host with random labels
// folded, a safe path template (≤ 4 segments, ID-like segments and segments that carried a typed value → `:id`, no
// query or fragment) and safe parameter names.

import { PARAM_NAME_PATTERN, PROTECT_BUDGETS, isDomainName, isEndpointPathTemplate } from '@detect-expert/contracts';
import { registrableDomain, toAsciiHost } from './index';

/** Labels longer than this are folded into the registrable domain (long labels carry IDs). */
export const MAX_ENDPOINT_LABEL_CHARS = 32;
const MAX_SEGMENT_CHARS = 32;

/**
 * Random-looking DNS label: the thresholds of network-observed.v1.json (≥ 12 characters without '-', ≥ 2 digits,
 * ≥ 2 letters), the same rule as engine looksRandomLabel (checked against it in protect-match-endpoint.test.ts).
 */
export function looksRandomEndpointLabel(label: string): boolean {
  let chars = 0;
  let digits = 0;
  let letters = 0;
  for (let i = 0; i < label.length; i++) {
    const c = label.charCodeAt(i);
    if (c === 45) continue;
    chars++;
    if (c >= 48 && c <= 57) digits++;
    else if ((c >= 97 && c <= 122) || (c >= 65 && c <= 90)) letters++;
  }
  return chars >= 12 && digits >= 2 && letters >= 2;
}

/**
 * Digits a parameter name or a host label may carry in total: more is a phone number or an ID split by separators
 * (`912-555-01-37`, `p79125550137`), not a name (review round 3).
 */
const MAX_NAME_DIGITS = 5;

function digitCount(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 48 && c <= 57) n++;
  }
  return n;
}

/**
 * Host of a request URL for evidence: the full DNS name when every label left of the registrable domain is short, not
 * random-looking and carries ≤ 5 digits, otherwise the registrable domain itself. IP literals, local names and hosts
 * without a known public suffix → null. A label that carries a typed value is folded by the matcher (fingerprints).
 */
export function endpointHost(url: string): string | null {
  const host = toAsciiHost(url);
  if (host === null) return null;
  const registrable = registrableDomain(host);
  if (registrable === null) return null;
  if (host !== registrable) {
    const sub = host.slice(0, host.length - registrable.length - 1);
    for (const label of sub.split('.')) {
      if (label.length === 0 || label.length > MAX_ENDPOINT_LABEL_CHARS || looksRandomEndpointLabel(label) || digitCount(label) > MAX_NAME_DIGITS) {
        return isDomainName(registrable) ? registrable : null;
      }
    }
  }
  return isDomainName(host) ? host : isDomainName(registrable) ? registrable : null;
}

const SEGMENT_RE = /^[A-Za-z0-9._-]{1,32}$/;
const LETTER_RE = /[A-Za-z]/;
const DIGIT_RUN_RE = /[0-9]{4,}/;
const HEX_RUN_RE = /[0-9a-fA-F]{8,}/;

/** One path segment as it may appear in a template: a short literal word, otherwise `:id`. */
export function templateEndpointSegment(segment: string): string {
  if (segment.length > MAX_SEGMENT_CHARS || !SEGMENT_RE.test(segment) || !LETTER_RE.test(segment)) return ':id';
  if (DIGIT_RUN_RE.test(segment) || HEX_RUN_RE.test(segment)) return ':id';
  return segment;
}

/** Path of an absolute http(s) URL without the query and fragment ('' when it cannot be found). */
function rawPath(url: string): string {
  const scheme = url.indexOf('://');
  if (scheme < 0) return '';
  const start = url.indexOf('/', scheme + 3);
  const q = url.indexOf('?', scheme + 3);
  const f = url.indexOf('#', scheme + 3);
  let end = url.length;
  if (q >= 0) end = Math.min(end, q);
  if (f >= 0) end = Math.min(end, f);
  if (start < 0 || start > end) return '/';
  return url.slice(start, end);
}

/**
 * Template segments of a request path: at most maxEndpointPathSegments (literal or `:id`), index i = `pathSegment` i
 * of pathSegments(); `more` when further segments followed. SW memory only, while the request is matched.
 */
export interface PathTemplateParts {
  readonly segments: readonly string[];
  readonly more: boolean;
}

export function pathTemplateParts(url: string): PathTemplateParts {
  const max = PROTECT_BUDGETS.maxEndpointPathSegments;
  const segments: string[] = [];
  let more = false;
  for (const part of rawPath(url).split('/')) {
    if (part.length === 0) continue;
    if (segments.length >= max) {
      more = true;
      break;
    }
    segments.push(templateEndpointSegment(part));
  }
  return { segments, more };
}

/**
 * The template of `parts` (ENDPOINT_PATH_TEMPLATE_PATTERN): `/`, the segments and `/…` when more followed. Segments at
 * `masked` indices become `:id`: a segment that carried a typed value or one of its variants never stays a literal
 * (REQ-005, ADR-020 §B).
 */
export function joinPathTemplate(parts: PathTemplateParts, masked: ReadonlySet<number> | null = null): string {
  const segments = masked === null || masked.size === 0 ? parts.segments : parts.segments.map((s, i) => (masked.has(i) ? ':id' : s));
  const out = '/' + segments.join('/') + (parts.more ? '/…' : '');
  return isEndpointPathTemplate(out) ? out : '/';
}

/**
 * Safe path template of a request URL (ENDPOINT_PATH_TEMPLATE_PATTERN): `/`, at most maxEndpointPathSegments segments
 * (literal or `:id`) and `/…` when more followed. The query and fragment are dropped, empty segments skipped.
 * Evidence of the module masks the segments that carried a typed value (joinPathTemplate).
 */
export function pathTemplate(url: string): string {
  return joinPathTemplate(pathTemplateParts(url));
}

/**
 * Raw non-empty path segments of a request URL (at most `max`), for the SW decoder only: segment i of the result is
 * `pathSegment` i of an evidence record. Never stored.
 */
export function pathSegments(url: string, max = 16): string[] {
  const out: string[] = [];
  for (const part of rawPath(url).split('/')) {
    if (part.length === 0) continue;
    if (out.length >= max) break;
    out.push(part);
  }
  return out;
}

const LONG_DIGITS_RE = /[0-9]{6,}/;
const LONG_HEX_RE = /[0-9a-fA-F]{12,}/;
const NAME_SEPARATORS_RE = /[.[\]]+/;
const ENCODED_COMPONENT_RE = /^[A-Za-z0-9_-]{22,}$/;
const UPPER_RE = /[A-Z]/;
const LOWER_RE = /[a-z]/;

/**
 * Base64 / base64url-looking component of a parameter name: ≥ 22 characters of the base64url alphabet with upper- and
 * lower-case letters (an unpadded MD5 digest has 22). Hash digests in base64url are not among the matched variants,
 * so the fingerprints cannot recognize them; the shape refuses them (review round 3).
 */
export function looksEncodedNameComponent(component: string): boolean {
  return ENCODED_COMPONENT_RE.test(component) && UPPER_RE.test(component) && LOWER_RE.test(component);
}

/**
 * A request parameter NAME as evidence may carry it: ≤ maxParamNameChars, PARAM_NAME_PATTERN, no run of ≥ 6 digits,
 * no run of ≥ 12 hex characters (ID-like keys), ≤ 5 digits in total, and no component (split on `.`, `[`, `]`) that
 * looks random or Base64-encoded. Anything else → null. A name that carries a typed value or one of its variants is
 * dropped later by the matcher (fingerprints; review round 3).
 */
export function safeParamName(name: unknown): string | null {
  if (typeof name !== 'string' || name.length === 0 || name.length > PROTECT_BUDGETS.maxParamNameChars) return null;
  if (!PARAM_NAME_PATTERN.test(name)) return null;
  if (LONG_DIGITS_RE.test(name) || LONG_HEX_RE.test(name) || digitCount(name) > MAX_NAME_DIGITS) return null;
  for (const component of name.split(NAME_SEPARATORS_RE)) {
    if (component.length > 0 && (looksRandomEndpointLabel(component) || looksEncodedNameComponent(component))) return null;
  }
  return name;
}
