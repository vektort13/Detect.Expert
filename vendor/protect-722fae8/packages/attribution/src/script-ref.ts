// ADR-020 §F (S10, E11-lite): masked identity of a page script from a sampled stack, and the masked target of a send.
// MAIN-safe: runs inside the MAIN-world observers of protect.main.js, so it uses only string methods captured at module
// evaluation (document_start), never URL, RegExp, the PSL or live prototype methods (a page patch of
// String.prototype.* can never run from here). No arrays are grown: fixed-size literals only (an inherited index
// setter is never reached). Bounded work: at most maxStackScanLines frames and maxStackScanChars characters of a stack,
// MAX_TARGET_SCAN characters of a send address. Never throws for a string input.
// Output never carries a query, fragment, userinfo, port, function name, line:column or a raw frame (REQ-005): only
// ScriptRef { kind, scheme, host (random labels -> '*'), pathTemplate } and SendTarget { kind, host }.
// Also used by the SW (correlation): one masking function on both sides keeps the host tokens comparable.

import { PROTECT_BUDGETS } from '../../contracts/src/protect';
import type { ScriptRef } from '../../contracts/src/protect';
import type { SendTarget } from '../../contracts/src/protect-main';

// Captured at module evaluation (document_start in MAIN): later page patches of String.prototype never run from here.
const charCodeAt = Function.prototype.call.bind(String.prototype.charCodeAt) as (s: string, i: number) => number;
const slice = Function.prototype.call.bind(String.prototype.slice) as (s: string, start: number, end?: number) => string;
const indexOf = Function.prototype.call.bind(String.prototype.indexOf) as (s: string, search: string, from?: number) => number;
const lastIndexOf = Function.prototype.call.bind(String.prototype.lastIndexOf) as (s: string, search: string, from?: number) => number;
const toLowerCase = Function.prototype.call.bind(String.prototype.toLowerCase) as (s: string) => string;

/** Random-looking host labels / path words: same thresholds as network-observed.v1.json (12 chars, 2 digits, 2 letters). */
export const RANDOM_LABEL_MIN_CHARS = 12;
export const RANDOM_LABEL_MIN_DIGITS = 2;
export const RANDOM_LABEL_MIN_LETTERS = 2;
/** Characters of a send address examined for its scheme and authority (the rest of a long URL is never read). */
export const MAX_TARGET_SCAN = 2048;

const MAX_SEGMENTS = PROTECT_BUDGETS.maxScriptPathSegments;
// templatePathSafe keeps segments in fixed 8-slot literals (no array growth): the budget must fit them.
if (!(MAX_SEGMENTS >= 1 && MAX_SEGMENTS <= 7)) throw new Error('script-ref: maxScriptPathSegments out of range');
const MAX_TEMPLATE_CHARS = PROTECT_BUDGETS.maxScriptPathTemplateChars;
const MAX_SEGMENT_CHARS = 40;
const MAX_LITERAL_WORD_CHARS = 32;
const SKIP_TOKEN = ':skip';
const ID_TOKEN = ':id';
const X_TOKEN = ':x';

const UNKNOWN: ScriptRef = Object.freeze({ kind: 'unknown' }) as ScriptRef;
const DOCUMENT: ScriptRef = Object.freeze({ kind: 'document' }) as ScriptRef;
const EVAL: ScriptRef = Object.freeze({ kind: 'eval' }) as ScriptRef;
const OPAQUE: ScriptRef = Object.freeze({ kind: 'opaque' }) as ScriptRef;
const EXTENSION: ScriptRef = Object.freeze({ kind: 'extension' }) as ScriptRef;

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

function isDigit(c: number): boolean {
  return c >= 48 && c <= 57;
}

function isLower(c: number): boolean {
  return c >= 97 && c <= 122;
}

function isUpper(c: number): boolean {
  return c >= 65 && c <= 90;
}

function isAlnum(c: number): boolean {
  return isDigit(c) || isLower(c) || isUpper(c);
}

function isHexLetter(c: number): boolean {
  return (c >= 97 && c <= 102) || (c >= 65 && c <= 70);
}

/** `.`, `-`, `_`, `~` separate the words of a segment and are kept literally (as templateScriptPath). */
function isWordDelimiter(c: number): boolean {
  return c === 46 || c === 45 || c === 95 || c === 126;
}

/** `s` starts with the ASCII-lowercase `prefix`, compared case-insensitively. */
function startsWithCi(s: string, prefix: string, at = 0): boolean {
  if (s.length - at < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    let c = charCodeAt(s, at + i);
    if (isUpper(c)) c += 32;
    if (c !== charCodeAt(prefix, i)) return false;
  }
  return true;
}

function startsWith(s: string, prefix: string, at = 0): boolean {
  if (s.length - at < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (charCodeAt(s, at + i) !== charCodeAt(prefix, i)) return false;
  return true;
}

function endsWith(s: string, suffix: string): boolean {
  return startsWith(s, suffix, s.length - suffix.length);
}

// ---------------------------------------------------------------------------
// Hosts
// ---------------------------------------------------------------------------

/** A label of [a-z0-9-] that does not start or end with `-`, 1..63 characters (lowercase input). */
function isPlainLabel(host: string, start: number, end: number): boolean {
  const n = end - start;
  if (n < 1 || n > 63) return false;
  for (let i = start; i < end; i++) {
    const c = charCodeAt(host, i);
    if (!(isDigit(c) || isLower(c) || c === 45)) return false;
  }
  return charCodeAt(host, start) !== 45 && charCodeAt(host, end - 1) !== 45;
}

function isRandomLabel(host: string, start: number, end: number): boolean {
  if (end - start < RANDOM_LABEL_MIN_CHARS) return false;
  let digits = 0;
  let letters = 0;
  for (let i = start; i < end; i++) {
    const c = charCodeAt(host, i);
    if (isDigit(c)) digits++;
    else if (isLower(c)) letters++;
  }
  return digits >= RANDOM_LABEL_MIN_DIGITS && letters >= RANDOM_LABEL_MIN_LETTERS;
}

/**
 * Masked host token (isScriptHost): ASCII DNS name of >= 2 labels, lowercased, a trailing dot dropped, random-looking
 * labels replaced by `*`, the last label a real label with a letter. Null for IP literals, single labels, non-ASCII or
 * any other character, and over-long names.
 */
export function maskHost(input: string): string | null {
  if (typeof input !== 'string') return null;
  let host = input;
  if (host.length > 0 && charCodeAt(host, host.length - 1) === 46) host = slice(host, 0, host.length - 1);
  if (host.length < 3 || host.length > 253) return null;
  let upper = false;
  for (let i = 0; i < host.length; i++) {
    const c = charCodeAt(host, i);
    if (c > 127) return null;
    if (isUpper(c)) upper = true;
  }
  if (upper) host = toLowerCase(host);
  let out = '';
  let start = 0;
  let labels = 0;
  let lastStart = 0;
  for (let i = 0; i <= host.length; i++) {
    if (i < host.length && charCodeAt(host, i) !== 46) continue;
    if (!isPlainLabel(host, start, i)) return null;
    out += (labels > 0 ? '.' : '') + (isRandomLabel(host, start, i) ? '*' : slice(host, start, i));
    lastStart = start;
    labels++;
    start = i + 1;
  }
  if (labels < 2) return null;
  // The last label stays a real label with a letter: never an IP literal or a masked suffix.
  let letter = false;
  for (let i = lastStart; i < host.length; i++) if (isLower(charCodeAt(host, i))) letter = true;
  if (!letter || isRandomLabel(host, lastStart, host.length)) return null;
  return out;
}

// ---------------------------------------------------------------------------
// Path template (identical output to templateScriptPath of the contracts; captured methods only)
// ---------------------------------------------------------------------------

function templateWord(word: string): string {
  if (word.length === 0 || word === ID_TOKEN || word === X_TOKEN) return word;
  let digits = 0;
  let letters = 0;
  let run = 0;
  let maxRun = 0;
  let hexOnly = true;
  for (let i = 0; i < word.length; i++) {
    const c = charCodeAt(word, i);
    if (!isAlnum(c)) return X_TOKEN;
    if (isDigit(c)) {
      digits++;
      run++;
      if (run > maxRun) maxRun = run;
    } else {
      letters++;
      run = 0;
      if (!isHexLetter(c)) hexOnly = false;
    }
  }
  if (maxRun >= 4) return ID_TOKEN;
  if (hexOnly && digits > 0 && word.length >= 8) return ID_TOKEN;
  if (word.length >= RANDOM_LABEL_MIN_CHARS && digits >= RANDOM_LABEL_MIN_DIGITS && letters >= RANDOM_LABEL_MIN_LETTERS) return ID_TOKEN;
  if (word.length > MAX_LITERAL_WORD_CHARS) return ID_TOKEN;
  return word;
}

function templateSegment(segment: string): string {
  let out = '';
  let start = 0;
  for (let i = 0; i <= segment.length; i++) {
    if (i === segment.length || isWordDelimiter(charCodeAt(segment, i))) {
      out += templateWord(slice(segment, start, i));
      if (i < segment.length) out += slice(segment, i, i + 1);
      start = i + 1;
    }
  }
  return out.length > MAX_SEGMENT_CHARS ? X_TOKEN : out;
}

/**
 * Safe template of a script path (no query or fragment: the caller cuts them): same result as templateScriptPath of
 * packages/contracts (unit-tested for equality), computed with captured string methods only. At most
 * maxScriptPathSegments segments (a cut prefix -> leading `:skip`), ID-like words -> `:id`, other characters -> `:x`,
 * at most maxScriptPathTemplateChars. Idempotent.
 */
export function templatePathSafe(path: string): string {
  // Up to MAX_SEGMENTS non-empty segments from the end, kept in a fixed-size literal (own slots only).
  const raw: string[] = ['', '', '', '', '', '', '', ''];
  let count = 0;
  let cut = false;
  let end = path.length;
  for (let i = path.length - 1; i >= -1; i--) {
    if (i === -1 || charCodeAt(path, i) === 47) {
      if (end - i - 1 > 0) {
        if (count === MAX_SEGMENTS) {
          cut = true;
          break;
        }
        raw[count] = slice(path, i + 1, end);
        count++;
      }
      end = i;
    }
  }
  // raw holds the segments last-first: raw[count - 1] is the first kept segment.
  let first = count - 1;
  let skip = cut;
  if (!skip && count >= 2 && raw[first] === SKIP_TOKEN) {
    skip = true;
    first--;
  }
  const segs: string[] = ['', '', '', '', '', '', '', ''];
  let n = 0;
  for (let i = first; i >= 0; i--) {
    segs[n] = templateSegment(raw[i]!);
    n++;
  }
  let from = 0;
  if (cut) from = n - (MAX_SEGMENTS - 1);
  const build = (): string => {
    let out = skip ? '/' + SKIP_TOKEN : '';
    for (let i = from; i < n; i++) out += '/' + segs[i]!;
    return out.length === 0 ? '/' : out;
  };
  let out = build();
  while (out.length > MAX_TEMPLATE_CHARS && n - from > 1) {
    from++;
    skip = true;
    out = build();
  }
  return out;
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

interface ParsedHttp {
  scheme: 'http' | 'https';
  /** Raw host (lowercased later by maskHost); '' when absent. */
  host: string;
  /** Path without query and fragment; '/' when absent. */
  path: string;
  /** False for a bracketed (IPv6) host. */
  plainHost: boolean;
}

/** Index of the first `/`, `?`, `#` or `\` at or after `from`, or `limit`. */
function authorityEnd(s: string, from: number, limit: number): number {
  for (let i = from; i < limit; i++) {
    const c = charCodeAt(s, i);
    if (c === 47 || c === 63 || c === 35 || c === 92) return i;
  }
  return limit;
}

/** Host part of an authority (userinfo and port dropped); `plainHost` false for `[...]`. */
function hostOfAuthority(s: string, start: number, end: number): { host: string; plainHost: boolean } {
  const at = lastIndexOf(s, '@', end - 1);
  if (at >= start) start = at + 1;
  if (start < end && charCodeAt(s, start) === 91) return { host: '', plainHost: false };
  let stop = end;
  for (let i = start; i < end; i++) {
    if (charCodeAt(s, i) === 58) {
      stop = i;
      break;
    }
  }
  return { host: slice(s, start, stop), plainHost: true };
}

/** `http(s)://authority/path` of `s` (s starts at `at` with the scheme); null when it is not http(s). */
function parseHttp(s: string, at: number, limit: number, keepPath: boolean): ParsedHttp | null {
  let scheme: 'http' | 'https';
  let rest: number;
  if (startsWithCi(s, 'https://', at)) {
    scheme = 'https';
    rest = at + 8;
  } else if (startsWithCi(s, 'http://', at)) {
    scheme = 'http';
    rest = at + 7;
  } else return null;
  const aEnd = authorityEnd(s, rest, limit);
  const { host, plainHost } = hostOfAuthority(s, rest, aEnd);
  let path = '/';
  if (keepPath && aEnd < limit && charCodeAt(s, aEnd) === 47) {
    let pEnd = limit;
    for (let i = aEnd; i < limit; i++) {
      const c = charCodeAt(s, i);
      if (c === 63 || c === 35) {
        pEnd = i;
        break;
      }
    }
    path = slice(s, aEnd, pEnd);
  }
  return { scheme, host, path, plainHost };
}

/**
 * Masked target of a send address (a primitive string the page passed; nothing is coerced). absolute http(s) URL ->
 * `{kind:'absolute', host}` (a host equal to the document host -> `relative`: it resolves to the document's own host);
 * a relative reference (no scheme) -> `{kind:'relative'}`; an http(s) URL whose host cannot be masked (IP literal,
 * single label) -> `{kind:'unread'}`; any other scheme (data:, blob:, about:, javascript:, ...) -> null: no web
 * request follows, so no sample is emitted. Reads at most MAX_TARGET_SCAN characters.
 */
export function reduceTargetUrl(input: string, docHost: string): SendTarget | null {
  if (typeof input !== 'string') return { kind: 'unread' };
  const limit = input.length < MAX_TARGET_SCAN ? input.length : MAX_TARGET_SCAN;
  // The URL parser strips leading C0 controls and spaces.
  let at = 0;
  while (at < limit && charCodeAt(input, at) <= 32) at++;
  if (at >= limit) return { kind: 'relative' };
  // Protocol-relative `//host/...`: the document's scheme, an absolute host.
  if (limit - at >= 2 && (charCodeAt(input, at) === 47 || charCodeAt(input, at) === 92) && (charCodeAt(input, at + 1) === 47 || charCodeAt(input, at + 1) === 92)) {
    const aEnd = authorityEnd(input, at + 2, limit);
    const { host, plainHost } = hostOfAuthority(input, at + 2, aEnd);
    return absoluteTarget(host, plainHost, docHost);
  }
  // A scheme: [A-Za-z][A-Za-z0-9+.-]* followed by ':' before any '/', '?' or '#'.
  const c0 = charCodeAt(input, at);
  if (isLower(c0) || isUpper(c0)) {
    for (let i = at + 1; i < limit; i++) {
      const c = charCodeAt(input, i);
      if (c === 58) {
        const parsed = parseHttp(input, at, limit, false);
        if (parsed === null) return null;
        return absoluteTarget(parsed.host, parsed.plainHost, docHost);
      }
      if (!(isAlnum(c) || c === 43 || c === 45 || c === 46)) break;
    }
  }
  return { kind: 'relative' };
}

/** Exact host comparison (ASCII case-insensitive, a trailing dot ignored); never on masked tokens. */
function sameHost(a: string, b: string): boolean {
  let na = a.length;
  let nb = b.length;
  if (na > 0 && charCodeAt(a, na - 1) === 46) na--;
  if (nb > 0 && charCodeAt(b, nb - 1) === 46) nb--;
  if (na === 0 || na !== nb) return false;
  for (let i = 0; i < na; i++) {
    let x = charCodeAt(a, i);
    let y = charCodeAt(b, i);
    if (isUpper(x)) x += 32;
    if (isUpper(y)) y += 32;
    if (x !== y) return false;
  }
  return true;
}

function absoluteTarget(host: string, plainHost: boolean, docHost: string): SendTarget {
  if (!plainHost) return { kind: 'unread' };
  const masked = maskHost(host);
  if (masked === null) return { kind: 'unread' };
  if (typeof docHost === 'string' && sameHost(host, docHost)) return { kind: 'relative' };
  return { kind: 'absolute', host: masked };
}

// ---------------------------------------------------------------------------
// Stack frames
// ---------------------------------------------------------------------------

/** Position `:line:column` at the end of `loc` (digits only): index of the first ':' of it, or -1. */
function positionStart(loc: string): number {
  const last = lastIndexOf(loc, ':');
  if (last <= 0 || last === loc.length - 1) return -1;
  for (let i = last + 1; i < loc.length; i++) if (!isDigit(charCodeAt(loc, i))) return -1;
  const prev = lastIndexOf(loc, ':', last - 1);
  if (prev < 0 || prev === last - 1) return -1;
  for (let i = prev + 1; i < last; i++) if (!isDigit(charCodeAt(loc, i))) return -1;
  return prev;
}

/** Classification of one frame location: a ScriptRef, 'skip' (no position, native) or 'extension'. */
function classifyLocation(loc: string, docHost: string): ScriptRef | 'skip' | 'extension' {
  if (startsWithCi(loc, 'wasm:')) return OPAQUE;
  const pos = positionStart(loc);
  if (pos < 0) return 'skip';
  const url = slice(loc, 0, pos);
  if (startsWithCi(url, 'chrome-extension://') || startsWithCi(url, 'moz-extension://')) return 'extension';
  if (url === '<anonymous>') return EVAL;
  if (startsWithCi(url, 'blob:') || startsWithCi(url, 'data:') || startsWithCi(url, 'file:')) return OPAQUE;
  const parsed = parseHttp(url, 0, url.length, true);
  if (parsed === null || !parsed.plainHost) return UNKNOWN;
  const masked = maskHost(parsed.host);
  if (masked === null) return UNKNOWN;
  if (sameHost(parsed.host, docHost) && !endsWith(toLowerCase(parsed.path), '.js')) return DOCUMENT;
  return { kind: 'external', scheme: parsed.scheme, host: masked, pathTemplate: templatePathSafe(parsed.path) };
}

/**
 * The first page frame of a V8 stack as a ScriptRef (ADR-020 §F; SP-12 format). Reads at most maxStackScanLines frame
 * lines and maxStackScanChars characters. `async ` / `new ` prefixes are dropped; eval frames -> `eval`; frames
 * without line and column (native) are skipped; chrome-extension:// and moz-extension:// frames are skipped, and a
 * stack of only such frames -> `extension`; blob: / data: / file: / wasm: -> `opaque`; an http(s) frame of the
 * document's own host that is not a `.js` file -> `document` (inline code); IP literals, non-ASCII or unparsable
 * locations -> `unknown`. Function names, positions, query, fragment, userinfo and port never leave this function.
 */
export function parseFirstPageFrame(stack: string, docHost: string): ScriptRef {
  if (typeof stack !== 'string') return UNKNOWN;
  const host = typeof docHost === 'string' ? docHost : '';
  const limit = stack.length < PROTECT_BUDGETS.maxStackScanChars ? stack.length : PROTECT_BUDGETS.maxStackScanChars;
  let frames = 0;
  let extensionFrames = 0;
  let lineStart = 0;
  while (lineStart < limit && frames < PROTECT_BUDGETS.maxStackScanLines) {
    let lineEnd = indexOf(stack, '\n', lineStart);
    if (lineEnd < 0 || lineEnd > limit) lineEnd = limit;
    let a = lineStart;
    while (a < lineEnd && (charCodeAt(stack, a) === 32 || charCodeAt(stack, a) === 9)) a++;
    let b = lineEnd;
    while (b > a && (charCodeAt(stack, b - 1) === 13 || charCodeAt(stack, b - 1) === 32)) b--;
    lineStart = lineEnd + 1;
    if (!startsWith(stack, 'at ', a)) continue; // the header line ("Error") and anything that is not a frame
    frames++;
    let rest = slice(stack, a + 3, b);
    if (startsWith(rest, 'async ')) rest = slice(rest, 6);
    if (startsWith(rest, 'new ')) rest = slice(rest, 4);
    let loc: string;
    if (indexOf(rest, '(eval at ') >= 0 || startsWith(rest, 'eval at ')) {
      return EVAL;
    } else if (rest.length > 0 && charCodeAt(rest, rest.length - 1) === 41) {
      const open = lastIndexOf(rest, ' (');
      if (open < 0) continue;
      loc = slice(rest, open + 2, rest.length - 1);
    } else loc = rest;
    const r = classifyLocation(loc, host);
    if (r === 'skip') continue;
    if (r === 'extension') {
      extensionFrames++;
      continue;
    }
    return r;
  }
  return extensionFrames > 0 ? EXTENSION : UNKNOWN;
}

/** Stable identity string of a ScriptRef (memory keys only; never sent). */
export function scriptRefKey(ref: ScriptRef): string {
  return ref.kind === 'external' ? 'x|' + (ref.scheme ?? '') + '|' + (ref.host ?? '') + '|' + (ref.pathTemplate ?? '') : ref.kind;
}
