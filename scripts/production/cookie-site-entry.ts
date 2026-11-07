// ADR-069: validate partition targets before a write can normalize into another cookie.
import { registrableDomain, toAsciiHost, parseIpLiteral } from '../../packages/attribution/src/index';
import packed from '../../packages/attribution/src/psl-index.json';
import { unpackRules } from '../../packages/attribution/src/psl';

const suffixes = new Set(unpackRules(packed.rules.join('\n')));
export function cookieDomainScopeSupported(host: unknown): boolean {
  return typeof host === 'string' && toAsciiHost(host) === host && registrableDomain(host) !== null;
}
export function canonicalCookieSite(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 4096) return null;
  try {
    const url = new URL(input);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash || url.pathname !== '/' && url.pathname !== '') return null;
    const host = toAsciiHost(url.hostname);
    if (!host || host !== url.hostname || host.endsWith('.')) return null;
    const domain = registrableDomain(host);
    // Unknown multi-label suffixes are held rather than guessed from another browser's PSL.
    if (!domain && !parseIpLiteral(host) && host.includes('.') && !suffixes.has(host)) return null;
    return url.protocol + '//' + (domain ?? host);
  } catch { return null; }
}
