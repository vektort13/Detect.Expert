// ADR-020 §I (S14): `mailto:` link of a data request (RFC 6068). The recipient passed isRequestEmail (no `?`, `&`, `#`,
// `%`, comma, space or line break by construction); subject and body are percent-encoded as UTF-8, so a `?`, `&` or `#`
// inside them cannot start another header. Mail programs truncate long links: above REQUEST_MAILTO_MAX_CHARS
// (candidate, ~2000 characters is the conservative common limit) the link carries a short body and the full text is
// copied to the clipboard by the same click (the UI does it).

import { isRequestEmail } from '@detect-expert/contracts';

/** Longest mailto: link the extension builds (candidate; not verified against every mail program). */
export const REQUEST_MAILTO_MAX_CHARS = 2000;

/** Percent-encoding of an hfvalue: every character except RFC 3986 unreserved ones; CRLF stays %0D%0A. */
export function encodeMailtoValue(text: string): string {
  return encodeURIComponent(text.replace(/\r?\n/g, '\r\n')).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

/** `mailto:<to>?subject=…&body=…`; null when the address is not a valid request e-mail. */
export function buildRequestMailto(to: string, subject: string, body: string): string | null {
  if (!isRequestEmail(to)) return null;
  return 'mailto:' + to + '?subject=' + encodeMailtoValue(subject) + '&body=' + encodeMailtoValue(body);
}

export interface RequestMailtoLink {
  href: string;
  /** The full body did not fit: the link has `shortBody`, the full text must be copied by the same click. */
  shortened: boolean;
}

/** The link with the full body when it fits, else with `shortBody`; null for an invalid address. */
export function requestMailtoLink(to: string, subject: string, body: string, shortBody: string, maxChars = REQUEST_MAILTO_MAX_CHARS): RequestMailtoLink | null {
  const full = buildRequestMailto(to, subject, body);
  if (full === null) return null;
  if (full.length <= maxChars) return { href: full, shortened: false };
  const short = buildRequestMailto(to, subject, shortBody);
  return short === null ? null : { href: short, shortened: true };
}
