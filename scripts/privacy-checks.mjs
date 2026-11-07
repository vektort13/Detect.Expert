import { timestampAllowed } from './privacy-observers.mjs';
/** IP literals allowed in storage: only the loopback stand host. */
const ALLOWED_IPS = new Set(['127.0.0.1']);
/** Hosts allowed as literals in the release bundle: Preact's XML namespace constants only. */
const ALLOWED_DIST_HOSTS = new Set(['www.w3.org']);
/** Key names that must never exist in stored data (task list + wire allowlist deny-list). */
const FORBIDDEN_KEYS = new Set([
  'url', 'href', 'stack', 'args', 'pixels', 'dataurl', 'imagedata', 'readpixels', 'text', 'cookie', 'cookies',
  'token', 'authorization', 'ip', 'ipaddress', 'sdp', 'candidate', 'candidates', 'query', 'fragment', 'pathname',
]);

function preview(value) {
  const s = typeof value === 'string' ? value : String(value);
  return JSON.stringify(s.length > 48 ? s.slice(0, 48) + '…' : s);
}

export class Hits {
  constructor() {
    this.items = [];
  }
  add(rule, at, value) {
    if (this.items.length >= 1000) return;
    this.items.push({ rule, at, preview: value === undefined ? '' : preview(value) });
  }
  get count() {
    return this.items.length;
  }
}

const IPV4_RE = /(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\d.])/g;
export const PRIVATE_ADDRESS_PATTERNS = [
  /(?<![\d.])(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})(?![\d.])/i,
  /(?<![\d.])169\.254\.\d{1,3}\.\d{1,3}(?![\d.])/i,
  /(?:^|[\s\[])(?:f[cd][0-9a-f]{2}|fe[89ab][0-9a-f]):[0-9a-f:]+/i,
];
const IPV6_TOKEN_RE = /^[0-9a-f]{0,4}(:[0-9a-f]{0,4}){2,7}$/i;

export function scanString(hits, at, value, canaries) {
  for (const pattern of PRIVATE_ADDRESS_PATTERNS) if (pattern.test(value)) hits.add('private-address', at, value);
  for (const c of canaries) if (value.includes(c.value)) hits.add('canary:' + c.id, at, value);
  if (/data:image/i.test(value)) hits.add('data-url', at, value);
  if (/[A-Za-z0-9+/]{65,}={0,2}/.test(value)) hits.add('base64-run>64', at, value);
  if (/:\/\//.test(value)) hits.add('url-scheme', at, value);
  if (/[.:/]/.test(value) && /[?#@]/.test(value)) hits.add('url-parts(?#@ in host/path-like string)', at, value);
  for (const m of value.matchAll(IPV4_RE)) {
    const octets = m.slice(1, 5).map(Number);
    if (octets.every((o) => o <= 255) && !ALLOWED_IPS.has(m[0])) hits.add('ipv4-literal', at, value);
  }
  for (const token of value.split(/[\s"'[\],;()]+/)) {
    if (token === '' || token === '::') continue;
    const colons = (token.match(/:/g) ?? []).length;
    if (IPV6_TOKEN_RE.test(token) && (token.includes('::') || colons >= 3)) hits.add('ipv6-literal', at, value);
  }
  if (value.length > 512) hits.add('string>512', at, value);
  if (/[Ѐ-ӿ]{3,}/.test(value)) hits.add('cyrillic-text', at, value);
  if (value.trim().split(/\s+/).length >= 6) hits.add('free-text(>=6 words)', at, value);
}

export function scanNode(hits, at, node, canaries, depth = 0) {
  if (depth > 64) {
    hits.add('nesting>64', at);
    return;
  }
  if (typeof node === 'string') {
    scanString(hits, at, node, canaries);
    return;
  }
  if (typeof node === 'number') {
    if (Number.isInteger(node) && node > 1e12 && !timestampAllowed(at, node)) hits.add('unapproved-epoch-time', at, node);
    const s = String(node);
    for (const c of canaries) if (s === c.value) hits.add('canary:' + c.id, at, s);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((child, i) => scanNode(hits, at + '[' + String(i) + ']', child, canaries, depth + 1));
    return;
  }
  if (typeof node === 'object' && node !== null) {
    for (const [key, child] of Object.entries(node)) {
      const keyAt = at + '.' + key;
      if (FORBIDDEN_KEYS.has(key.toLowerCase())) hits.add('forbidden-key', keyAt);
      for (const c of canaries) if (key.includes(c.value)) hits.add('canary-in-key:' + c.id, keyAt, key);
      scanNode(hits, keyAt, child, canaries, depth + 1);
    }
  }
}

