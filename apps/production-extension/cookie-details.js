// ADR-069: pure, read-only facts shown beside the cookie editor fields. Nothing here reads, writes or stores a cookie; every input is the form state
// of the open editor and every output is a number, a flag or a code that the interface turns into text.
import { parseUnixSeconds } from './cookie-time.js';

/** Name + value in UTF-8 bytes: the quantity that the browser's per-cookie limit (4096 bytes in Chrome) is measured on. */
export function cookieByteSize(name, value) {
  return new TextEncoder().encode(String(name ?? '') + String(value ?? '')).byteLength;
}

/** How far ahead Chrome lets a cookie expire. */
export const CHROME_MAX_LIFETIME_DAYS = 400;
const hostOf = domain => String(domain ?? '').trim().replace(/^\./u, '');

/** Where the cookie is sent: the host (without the leading dot of a domain cookie), whether subdomains are included, the path prefix and HTTPS-only. */
export function cookieScope(values) {
  const host = hostOf(values?.domain);
  if (host === '') return null;
  const path = String(values.path ?? '').trim();
  return { host, hostOnly: values.hostOnly === true, path: path === '' ? null : path, secure: values.secure === true };
}

/** True when the name carries a cookie prefix whose attribute rules the form currently breaks (same rules as the record validator). */
export function cookiePrefixProblem(values) {
  const name = String(values?.name ?? '');
  const secure = values?.secure === true, hostOnly = values?.hostOnly === true, httpOnly = values?.httpOnly === true;
  return name.startsWith('__Secure-') && !secure
    || name.startsWith('__Host-') && (!secure || !hostOnly || values.path !== '/')
    || (name.startsWith('__Http-') || name.startsWith('__Host-Http-')) && (!secure || !httpOnly);
}

/** Combinations that the browser or the record validator refuses, found while the person is still editing. Codes, in display order;
 * `now` (ms) lets an expiry that is already in the past be flagged, since Save refuses to write it. */
export function editorProblems(values, { browser = 'unknown', pairLimit = 4096, now = null } = {}) {
  const problems = [];
  if (browser === 'chrome' && cookieByteSize(values.name, values.value) > pairLimit) problems.push('size');
  if (values.sameSite === 'no_restriction' && values.secure !== true) problems.push('samesite-none');
  if (values.partitioned === true && values.secure !== true) problems.push('partition-secure');
  if (cookiePrefixProblem(values)) problems.push('prefix');
  if (now !== null && values.session !== true) {
    const expiry = parseUnixSeconds(values.expirationDate);
    if (expiry.ok && expiry.seconds <= now / 1000) problems.push('expired');
    // Observed natively in Chrome 153: an expiry 700 days away is stored as 400 days (the browser's own lifetime cap); a note, not a refusal.
    else if (expiry.ok && browser === 'chrome' && expiry.seconds > now / 1000 + CHROME_MAX_LIFETIME_DAYS * 86400) problems.push('reach');
  }
  return problems;
}

const siteOf = text => { const value = String(text ?? '').trim(); try { return new URL(value).origin; } catch { return value; } };
const identityKey = values => JSON.stringify([values.storeId, hostOf(values.domain).toLowerCase(), values.hostOnly === true, values.path, values.name,
  values.partitioned === true ? [siteOf(values.partitionTopLevelSite), values.partitionAncestor] : null, values.firstPartyDomain ?? '']);

/** Whether two editor states name the same cookie (store, host, host-only, path, name, partition and first-party domain). */
export const sameCookieIdentity = (left, right) => identityKey(left) === identityKey(right);

/** The store the browser opens by default: Chrome's '0', Firefox's 'firefox-default'. */
export const isDefaultStore = (id, browser) => browser === 'chrome' ? id === '0' : browser === 'firefox' ? id === 'firefox-default' : false;
