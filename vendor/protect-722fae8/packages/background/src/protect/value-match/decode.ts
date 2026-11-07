// ADR-020 §B (S07): views of one outgoing request for value matching, inside the webRequest callback only (SW memory,
// nothing is kept by this module). The URL (≤ maxUrlChars) gives path segments and query parameters (raw and
// percent-decoded); the body gives form fields (Chrome's formData, ≤ maxFormDataEntries) or the first
// maxScannedBodyBytes of the raw bytes (SP-3: Chrome hands the whole body over; only a view of the first 64 KiB is
// decoded, nothing is copied or held), parsed as JSON (≤ maxJsonNodes, depth ≤ maxJsonDepth), urlencoded text or
// plain text. Keys named like passwords, secrets, one-time codes or cards are dropped BEFORE tokenization
// (`body-had-credential-fields`). File parts are never read (opaque). Base64 containers are decoded one level.

import { PROTECT_BUDGETS } from '@detect-expert/contracts';
import type { ProtectLimitation, ValueLocation } from '@detect-expert/contracts';
import { fromBase64, isBase64Char, isHexChar, isTokenChar } from '@detect-expert/engine';
import { pathSegments, safeParamName } from '../../../../attribution/src/index';
import type { RequestDetailsLike } from '../../chrome-api';

/**
 * Keys never tokenized (ADR-020 §12): passwords, secrets, tokens, one-time codes, PINs, card data, IBAN. Review PT-2 /
 * PT-3: long unambiguous stems match anywhere in the key (`newpassword`); short ones only as a whole component of the
 * key (split at non-letters and camelCase), so `shipping_email`, `company`, `spanId`, `expand`, `opinion`, `discard`
 * are ordinary keys and `pw`, `psw`, `parol`, `kennwort`, `senha`, `contraseña`, `mdp`, `hasło` are credentials.
 */
const CREDENTIAL_STEMS: readonly string[] = [
  'password', 'passwd', 'passwort', 'passcode', 'passphrase', 'парол', 'пароль', 'kennwort', 'contrase', 'wachtwoord', 'motdepasse',
  'salasana', 'secret', 'token', 'creditcard', 'debitcard', 'giftcard', 'cardnum', 'cvv', 'cvc',
];
const CREDENTIAL_WORDS: ReadonlySet<string> = new Set([
  'pass', 'pwd', 'pw', 'psw', 'pswd', 'parol', 'mdp', 'senha', 'haslo', 'hasło', 'heslo', 'sifre', 'şifre', 'lozinka', 'passord',
  'otp', 'totp', 'hotp', 'pin', 'pincode', 'csc', 'cc', 'ccnum', 'ccnumber', 'pan', 'iban',
]);
const CAMEL_RE = /(\p{Ll})(\p{Lu})/gu;
const NON_LETTERS_RE = /[^\p{L}]+/u;

export function isCredentialKey(key: string): boolean {
  const lower = key.toLowerCase();
  for (const stem of CREDENTIAL_STEMS) if (lower.includes(stem)) return true;
  for (const part of key.replace(CAMEL_RE, '$1 $2').toLowerCase().split(NON_LETTERS_RE)) {
    if (part.length === 0) continue;
    if (CREDENTIAL_WORDS.has(part)) return true;
    if ((part.startsWith('pass') && !part.startsWith('passeng')) || part.startsWith('card') || part.startsWith('iban')) return true;
  }
  return false;
}

export interface RequestView {
  location: ValueLocation;
  /** Sanitized parameter name (safeParamName), or null. */
  paramName: string | null;
  /** Index of the path segment (location 'path'), else null. */
  pathSegment: number | null;
  text: string;
  /** Percent-decoding changed this text (a plain match here means the value travelled URL-encoded). */
  urlDecoded: boolean;
  /** Decoded from a Base64 container (one level). */
  container: boolean;
}

export interface DecodedRequest {
  views: RequestView[];
  /** The body exists but cannot be read (compressed / binary / file / Blob / stream). */
  opaque: boolean;
  limitations: Set<ProtectLimitation>;
  /** A key named like a credential was dropped before tokenization (the request never enters the token ring). */
  credentialDropped: boolean;
  /** Characters of body text scanned (perf, debug). */
  bodyChars: number;
}

function safeDecode(text: string, plusAsSpace: boolean): string {
  const s = plusAsSpace ? text.replace(/\+/g, ' ') : text;
  if (s.indexOf('%') < 0) return s;
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Raw query string of an absolute URL (without '?' and the fragment), or ''. */
function rawQuery(url: string): string {
  const q = url.indexOf('?');
  if (q < 0) return '';
  const f = url.indexOf('#', q);
  return url.slice(q + 1, f < 0 ? url.length : f);
}

export interface ParamSink {
  views: RequestView[];
  credentialDropped: boolean;
}

/** `k=v&k2=v2` pairs as views (raw and decoded value); credential keys are dropped first. */
function addPairs(text: string, location: ValueLocation, sink: ParamSink, container: boolean, maxPairs: number): void {
  let count = 0;
  for (const pair of text.split('&')) {
    if (pair.length === 0) continue;
    if (++count > maxPairs) break;
    const eq = pair.indexOf('=');
    const rawKey = eq < 0 ? pair : pair.slice(0, eq);
    const rawValue = eq < 0 ? '' : pair.slice(eq + 1);
    const key = safeDecode(rawKey, true);
    if (isCredentialKey(key)) {
      sink.credentialDropped = true;
      continue;
    }
    if (rawValue.length === 0) continue;
    const paramName = safeParamName(key);
    const decoded = safeDecode(rawValue, true);
    sink.views.push({ location, paramName, pathSegment: null, text: rawValue, urlDecoded: false, container });
    if (decoded !== rawValue) sink.views.push({ location, paramName, pathSegment: null, text: decoded, urlDecoded: true, container });
  }
}

const URLENCODED_RE = /^[^\s=&]{1,256}=[^\s]*$/;

/** Key path name of a JSON leaf: the last two object keys joined by '.', sanitized; array indices are skipped. */
function jsonName(path: readonly string[]): string | null {
  const tail = path.slice(-2).join('.');
  return tail.length === 0 ? null : safeParamName(tail);
}

/** Leaves of a parsed JSON value as views (≤ maxJsonNodes nodes, depth ≤ maxJsonDepth); credential keys pruned. */
function addJson(root: unknown, sink: ParamSink, container: boolean): void {
  const stack: Array<{ value: unknown; path: string[]; depth: number }> = [{ value: root, path: [], depth: 0 }];
  let nodes = 0;
  while (stack.length > 0) {
    const { value, path, depth } = stack.pop()!;
    if (++nodes > PROTECT_BUDGETS.maxJsonNodes) break;
    if (typeof value === 'string') {
      if (value.length > 0) sink.views.push({ location: 'body-json', paramName: jsonName(path), pathSegment: null, text: value, urlDecoded: false, container });
      continue;
    }
    if (typeof value === 'number') {
      // Our own parsed number (never page code): a phone sent as a JSON number.
      if (Number.isFinite(value)) sink.views.push({ location: 'body-json', paramName: jsonName(path), pathSegment: null, text: String(value), urlDecoded: false, container });
      continue;
    }
    if (typeof value !== 'object' || value === null || depth >= PROTECT_BUDGETS.maxJsonDepth) continue;
    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i--) stack.push({ value: value[i], path, depth: depth + 1 });
      continue;
    }
    const keys = Object.keys(value);
    for (let i = keys.length - 1; i >= 0; i--) {
      const k = keys[i]!;
      if (isCredentialKey(k)) {
        sink.credentialDropped = true;
        continue;
      }
      stack.push({ value: (value as Record<string, unknown>)[k], path: [...path, k], depth: depth + 1 });
    }
  }
}

/**
 * Views of a body text (or of a decoded Base64 container): JSON when it starts with `{` / `[` and parses, urlencoded
 * pairs when it looks like `k=v&…`, otherwise one plain-text view.
 */
export function textViews(text: string, sink: ParamSink, container: boolean): void {
  let i = 0;
  while (i < text.length && (text.charCodeAt(i) <= 32)) i++;
  const first = text.charCodeAt(i);
  if (first === 123 || first === 91) {
    try {
      addJson(JSON.parse(text) as unknown, sink, container);
      return;
    } catch {
      // Not JSON (or cut at the scan limit): scanned as text below.
    }
  }
  if (URLENCODED_RE.test(text.slice(0, 4096)) && text.indexOf('=') > 0) {
    addPairs(text, 'body-form', sink, container, PROTECT_BUDGETS.maxFormDataEntries);
    return;
  }
  sink.views.push({ location: 'body-text', paramName: null, pathSegment: null, text, urlDecoded: false, container });
}

/** Share of U+FFFD and C0 controls (except tab, LF, CR) in the first KiB: above 10 % the body is binary / compressed. */
export function looksBinary(text: string): boolean {
  const n = Math.min(text.length, 1024);
  if (n === 0) return false;
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c === 0xfffd || (c < 32 && c !== 9 && c !== 10 && c !== 13)) bad++;
  }
  return bad * 10 > n;
}

/**
 * Views of the request (URL first, then the body). The raw body is decoded from views of its first
 * maxScannedBodyBytes; longer bodies add `body-truncated`. Never throws.
 */
export function requestViews(details: RequestDetailsLike, options: { decodeBody: boolean } = { decodeBody: true }): DecodedRequest {
  const out: DecodedRequest = { views: [], opaque: false, limitations: new Set(), credentialDropped: false, bodyChars: 0 };
  const url = typeof details.url === 'string' ? details.url.slice(0, PROTECT_BUDGETS.maxUrlChars) : '';
  // Path segments: raw and percent-decoded.
  const segments = pathSegments(url, 16);
  for (let i = 0; i < segments.length; i++) {
    const raw = segments[i]!;
    out.views.push({ location: 'path', paramName: null, pathSegment: i, text: raw, urlDecoded: false, container: false });
    const decoded = safeDecode(raw, false);
    if (decoded !== raw) out.views.push({ location: 'path', paramName: null, pathSegment: i, text: decoded, urlDecoded: true, container: false });
  }
  // Query parameters.
  addPairs(rawQuery(url), 'query', out, false, PROTECT_BUDGETS.maxFormDataEntries);
  if (!options.decodeBody) return out;
  const body = details.requestBody;
  if (body === undefined || body === null) {
    // SP-3: Chrome gives no body for PATCH (Blob and stream bodies come as `error`, below).
    if (typeof details.method === 'string' && details.method.toUpperCase() === 'PATCH') out.limitations.add('body-unavailable');
    return out;
  }
  if (typeof body.error === 'string') {
    out.opaque = true;
    out.limitations.add('body-unavailable');
    return out;
  }
  if (body.formData !== undefined && body.formData !== null) {
    let entries = 0;
    for (const key of Object.keys(body.formData)) {
      if (isCredentialKey(key)) {
        out.credentialDropped = true;
        continue;
      }
      const values = body.formData[key];
      if (!Array.isArray(values)) continue;
      const paramName = safeParamName(key);
      for (const v of values) {
        if (++entries > PROTECT_BUDGETS.maxFormDataEntries) break;
        if (typeof v === 'string' && v.length > 0) out.views.push({ location: 'body-form', paramName, pathSegment: null, text: v, urlDecoded: false, container: false });
      }
      if (entries > PROTECT_BUDGETS.maxFormDataEntries) {
        out.limitations.add('body-truncated');
        break;
      }
    }
    return out;
  }
  const raw = body.raw;
  if (!Array.isArray(raw) || raw.length === 0) {
    out.opaque = true;
    out.limitations.add('body-unavailable');
    return out;
  }
  for (const part of raw) {
    if (part !== null && typeof part === 'object' && typeof part.file === 'string') {
      // A file part: never opened, never read.
      out.opaque = true;
      out.limitations.add('body-opaque');
      return out;
    }
  }
  const max = PROTECT_BUDGETS.maxScannedBodyBytes;
  const decoder = new TextDecoder('utf-8');
  let remaining = max;
  let total = 0;
  let text = '';
  let sawBytes = false;
  for (const part of raw) {
    const bytes = part?.bytes;
    if (!(bytes instanceof ArrayBuffer)) continue;
    sawBytes = true;
    total += bytes.byteLength;
    if (remaining <= 0) continue;
    const take = Math.min(remaining, bytes.byteLength);
    // A view of the first bytes: the rest of a large body is never copied.
    text += decoder.decode(new Uint8Array(bytes, 0, take), { stream: true });
    remaining -= take;
  }
  text += decoder.decode();
  if (!sawBytes) {
    out.opaque = true;
    out.limitations.add('body-unavailable');
    return out;
  }
  if (total > max) out.limitations.add('body-truncated');
  if (looksBinary(text)) {
    out.opaque = true;
    out.limitations.add('body-opaque');
    return out;
  }
  out.bodyChars = text.length;
  textViews(text, out, false);
  return out;
}

export type TokenKind = 'word' | 'hex' | 'b64';

const MIN_RUN = 22;

/**
 * Tokens of a text: maximal runs of token characters (isTokenChar), plus hex runs and Base64 runs of ≥ 22 characters
 * whose bounds differ from a word (a hash glued to a prefix, Base64 with `/` or `=`). Pure-hex runs are reported
 * with `lowerHex` (hex is compared in lower case). `visit` returning false stops.
 */
export function scanTokens(text: string, visit: (start: number, end: number, lowerHex: boolean, kind: TokenKind) => boolean): void {
  const n = text.length;
  let w = -1;
  let wHexOnly = true;
  let h = -1;
  let b = -1;
  for (let i = 0; i <= n; i++) {
    const c = i < n ? text.charCodeAt(i) : -1;
    const tok = c >= 0 && isTokenChar(c);
    const hex = c >= 0 && isHexChar(c);
    const b64 = c >= 0 && isBase64Char(c);
    // Hex run ends.
    if (!hex && h >= 0) {
      if (i - h >= MIN_RUN && !(h === w && !tok && wHexOnly)) {
        if (!visit(h, i, true, 'hex')) return;
      }
      h = -1;
    }
    // Base64 run ends (with up to two '=' of padding).
    if (!b64 && b >= 0) {
      let end = i;
      if (c === 61) {
        end++;
        if (end < n && text.charCodeAt(end) === 61) end++;
      }
      if (end - b >= MIN_RUN && !(b === w && end === i && !tok)) {
        if (!visit(b, end, false, 'b64')) return;
      }
      b = -1;
    }
    // Word ends.
    if (!tok && w >= 0) {
      const lowerHex = wHexOnly && i - w >= MIN_RUN;
      if (!visit(w, i, lowerHex, 'word')) return;
      w = -1;
    }
    if (tok) {
      if (w < 0) {
        w = i;
        wHexOnly = true;
      }
      if (!hex) wHexOnly = false;
    }
    if (hex && h < 0) h = i;
    if (b64 && b < 0) b = i;
  }
}

/** Base64 / base64url token of ≥ 16 characters that is not pure hex: a container candidate. */
export function isContainerCandidate(text: string, start: number, end: number): boolean {
  let len = end - start;
  while (len > 0 && text.charCodeAt(start + len - 1) === 61) len--;
  if (len < 16) return false;
  let hexOnly = true;
  for (let i = start; i < start + len; i++) {
    const c = text.charCodeAt(i);
    if (!isBase64Char(c)) return false;
    if (!isHexChar(c)) hexOnly = false;
  }
  return !hexOnly;
}

/** One level of Base64 decoding to readable UTF-8 text, or null (not Base64, binary, or empty). */
export function decodeContainer(token: string, maxChars: number): string | null {
  const bytes = fromBase64(token, maxChars);
  if (bytes === null || bytes.length < 3) return null;
  const text = new TextDecoder('utf-8').decode(bytes);
  return looksBinary(text) ? null : text;
}

/**
 * Views of a decoded container: its structure is parsed like a body (so credential keys inside are dropped before
 * tokenization), then every view takes the place of the container (location, parameter name, path segment).
 */
export function containerViews(decoded: string, parent: RequestView): ParamSink {
  const sink: ParamSink = { views: [], credentialDropped: false };
  textViews(decoded, sink, true);
  for (const v of sink.views) {
    v.location = parent.location;
    v.paramName = parent.paramName;
    v.pathSegment = parent.pathSegment;
    v.container = true;
    v.urlDecoded = false;
  }
  return sink;
}
