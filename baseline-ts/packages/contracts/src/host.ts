// Host normalization (REQ-005): only an ASCII lowercase hostname survives; userinfo, port, path, query and
// fragment are dropped. Opaque or invalid inputs yield null. Never throws.

/** Hostname labels: ASCII letters/digits/hyphen, 1..63 chars each; whole host <= 253. Also matches IPv4 literals. */
const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
/** Bracketed IPv6 literal as produced by the URL parser. */
const IPV6_RE = /^\[[0-9a-f:.]{2,45}\]$/;
const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'ws:', 'wss:']);
const MAX_HOST_CHARS = 253;
/** Guard against pathological inputs before parsing; legitimate URLs are far shorter. */
const MAX_URL_CHARS = 65536;

/** True when `value` is already a sanitized host (what sanitizeHost returns). */
export function isSanitizedHost(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_HOST_CHARS &&
    (HOST_RE.test(value) || IPV6_RE.test(value))
  );
}

export function sanitizeHost(url: string): string | null {
  if (typeof url !== 'string' || url.length === 0 || url.length > MAX_URL_CHARS) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return null;
  // WHATWG parsing already lowercases and punycode-encodes the host (IDN -> xn--).
  let host = parsed.hostname;
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (host.length === 0 || host.length > MAX_HOST_CHARS) return null;
  if (IPV6_RE.test(host)) return host;
  if (!HOST_RE.test(host)) return null;
  return host;
}
