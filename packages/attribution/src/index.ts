// P01 / ADR-008: offline PSL, no DNS and no retained URLs.
import packed from './psl-index.json';
import { unpackRules } from './psl';
export { parsePsl, packRules, unpackRules } from './psl';
const rules = new Set(unpackRules(packed.rules.join('\n')));
export type IpClass = 'loopback' | 'link-local' | 'private' | 'ULA' | 'public';
export type SiteRelation = 'same-origin' | 'same-site' | 'cross-site' | 'opaque' | 'unknown';
export function toAsciiHost(input: unknown): string | null {
  if (typeof input !== 'string' || !input || input.length > 65536 || /[\s\\]/.test(input)) return null;
  try {
    const isUrl = input.includes('://');
    if (!isUrl && ['/', '@', '?', '#'].some((part) => input.includes(part))) return null;
    const u = new URL(isUrl ? input : 'http://' + input);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol)) return null;
    const h = u.hostname.toLowerCase().replace(/\.$/, '');
    if (h.startsWith('[')) return h;
    return h.length <= 253 && h.split('.').every((l) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l)) ? h : null;
  } catch { return null; }
}
function v4Class(n: number[]): IpClass {
  const a = n[0]!, b = n[1]!;
  if (a === 127) return 'loopback';
  if (a === 169 && b === 254) return 'link-local';
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'private';
  return 'public';
}
/** Classification only; WHATWG also canonicalizes mapped and legacy IPv4 forms. */
export function parseIpLiteral(input: unknown): { version: 4 | 6; category: IpClass } | null {
  const h = toAsciiHost(input);
  if (h === null) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return { version: 4, category: v4Class(h.split('.').map(Number)) };
  if (!h.startsWith('[')) return null;
  const parts = h.slice(1, -1).split('::');
  const left = parts[0] ? parts[0].split(':').map((x) => parseInt(x, 16)) : [];
  const right = parts[1] ? parts[1].split(':').map((x) => parseInt(x, 16)) : [];
  const words = parts.length === 2 ? [...left, ...Array<number>(8 - left.length - right.length).fill(0), ...right] : left;
  let category: IpClass = 'public';
  if (words.slice(0, 7).every((w) => w === 0) && words[7] === 1) category = 'loopback';
  else if ((words[0]! & 0xffc0) === 0xfe80) category = 'link-local';
  else if ((words[0]! & 0xfe00) === 0xfc00) category = 'ULA';
  else if (words.slice(0, 5).every((w) => w === 0) && words[5] === 0xffff) category = v4Class([words[6]! >> 8, words[6]! & 255, words[7]! >> 8, words[7]! & 255]);
  return { version: 6, category };
}
export function registrableDomain(input: unknown, index: ReadonlySet<string> = rules): string | null {
  const h = toAsciiHost(input);
  if (h === null || parseIpLiteral(h) !== null) return null;
  const labels = h.split('.');
  let suffix = 0;
  for (let i = 0; i < labels.length; i++) {
    const candidate = labels.slice(i).join('.');
    if (index.has('!' + candidate)) return labels.slice(i).join('.');
    if (index.has(candidate)) suffix = Math.max(suffix, labels.length - i);
    if (i > 0 && index.has('*.' + candidate)) suffix = Math.max(suffix, labels.length - i + 1);
  }
  // No implicit '*' fallback for unrecognized suffixes (REQ-005).
  return suffix > 0 && labels.length > suffix ? labels.slice(-suffix - 1).join('.') : null;
}
export type RedactedHost = { kind: 'registrable'; value: string } | { kind: 'ip'; value: IpClass } |
  { kind: 'local'; value: 'localhost' | 'local' | 'single-label' } | { kind: 'unknown' };
export function redactHost(input: unknown): RedactedHost {
  const h = toAsciiHost(input);
  if (h === null) return { kind: 'unknown' };
  const ip = parseIpLiteral(h);
  if (ip) return { kind: 'ip', value: ip.category };
  if (h === 'localhost' || h.endsWith('.localhost')) return { kind: 'local', value: 'localhost' };
  if (h.endsWith('.local')) return { kind: 'local', value: 'local' };
  if (!h.includes('.')) return { kind: 'local', value: 'single-label' };
  const domain = registrableDomain(h);
  return domain === null ? { kind: 'unknown' } : { kind: 'registrable', value: domain };
}
/** Nullable report host holds only registrable domains; categories live in hosts[]. */
export function reportHost(input: unknown): string | null {
  const h = redactHost(input);
  return h.kind === 'registrable' ? h.value : null;
}
export function siteRelation(a: unknown, b: unknown): SiteRelation {
  if (typeof a !== 'string' || typeof b !== 'string') return 'unknown';
  try {
    const ua = new URL(a), ub = new URL(b);
    if (ua.origin === 'null' || ub.origin === 'null' || !/^https?:$/.test(ua.protocol) || !/^https?:$/.test(ub.protocol)) return 'opaque';
    if (ua.origin === ub.origin) return 'same-origin';
    if (ua.protocol === ub.protocol && ua.hostname === ub.hostname && (parseIpLiteral(ua.hostname) || redactHost(ua.hostname).kind === 'local')) return 'same-site';
    const da = registrableDomain(ua.hostname), db = registrableDomain(ub.hostname);
    if (!da || !db) return 'unknown';
    return ua.protocol === ub.protocol && da === db ? 'same-site' : 'cross-site';
  } catch { return 'unknown'; }
}
