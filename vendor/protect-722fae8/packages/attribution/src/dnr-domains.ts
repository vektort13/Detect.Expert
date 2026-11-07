// ADR-020 §C (S08): domain helpers of the firewall in DNR terms. DNR `requestDomains` / `topDomains` / `initiatorDomains`
// match a host and every subdomain of it by whole labels; a receiver that is the parent of a public suffix (a shared
// platform such as a cloud bucket host) would block other people's sites, so the firewall never writes a rule for it.
// Offline PSL only (the same index as ./index.ts): no DNS, no network, no URL is kept.

import packed from './psl-index.json';
import { unpackRules } from './psl';

/** DNR label semantics: `host` equals `ruleDomain` or is a subdomain of it (`a.b.example.com` vs `example.com`). */
export function domainMatches(host: string, ruleDomain: string): boolean {
  if (host.length === ruleDomain.length) return host === ruleDomain;
  if (host.length < ruleDomain.length + 2 || ruleDomain.length === 0) return false;
  return host.charCodeAt(host.length - ruleDomain.length - 1) === 46 && host.endsWith(ruleDomain);
}

let suffixParents: ReadonlySet<string> | null = null;

/**
 * Every public suffix of the PSL (ICANN and PRIVATE sections) and every proper ancestor of one: `com`, `github.io`,
 * `amazonaws.com` (parent of `s3.amazonaws.com`), `compute.amazonaws.com` (from `*.compute.amazonaws.com`). Exception
 * rules (`!www.ck`) are registrable names and are not added. Built once, lazily.
 */
function suffixParentSet(): ReadonlySet<string> {
  if (suffixParents !== null) return suffixParents;
  const out = new Set<string>();
  for (const raw of unpackRules(packed.rules.join('\n'))) {
    if (raw.length === 0 || raw.startsWith('!')) continue;
    const rule = raw.startsWith('*.') ? raw.slice(2) : raw;
    let rest = rule;
    for (;;) {
      if (out.has(rest)) break;
      out.add(rest);
      const dot = rest.indexOf('.');
      if (dot < 0) break;
      rest = rest.slice(dot + 1);
    }
  }
  suffixParents = out;
  return out;
}

/**
 * True when `domain` is a public suffix or the parent of one (a rule on it would also cover sites registered under the
 * suffix, e.g. `amazonaws.com` covers `bucket.s3.amazonaws.com`). Expects an ASCII lowercase DNS name.
 */
export function isPslParentDomain(domain: string): boolean {
  return suffixParentSet().has(domain);
}
