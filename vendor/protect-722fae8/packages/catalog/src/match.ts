// Browser-observed request -> rule ids (ADR-009 v1.1). Only scheme, WHATWG hostname, port, pathname,
// resource type and a received status take part; query, fragment and userinfo never do, and there is no
// substring search over the URL. The function never throws: any malformed input yields the shared EMPTY.

import { CATALOG_LIMITS, OBSERVED_RESOURCE_TYPES } from './lifecycle';
import type { CatalogIndex, CompiledRule, MatchResult, NetworkRequestInput, ParsedRequestInput, RuleScheme } from './types';

/** Shared frozen "no match" result. */
export const EMPTY_MATCH: MatchResult = /* @__PURE__ */ Object.freeze([] as string[]);

const RESOURCE_TYPES: ReadonlySet<string> = /* @__PURE__ */ new Set<string>(OBSERVED_RESOURCE_TYPES);
const PRINTABLE_PATH = /^\/[\x21-\x7e]*$/;

/** 2xx or 304: the browser actually received the resource (not aborted, blocked, 404 or unknown). */
export function isReceivedStatus(code: unknown): boolean {
  return typeof code === 'number' && Number.isInteger(code) && ((code >= 200 && code <= 299) || code === 304);
}

function hasNetworkRules(index: CatalogIndex): boolean {
  return index.networkByHost.size > 0 || index.networkBySuffix.size > 0;
}

function matchParts(
  index: CatalogIndex,
  scheme: RuleScheme,
  rawHost: string,
  port: number | null,
  pathname: string,
  resourceType: string,
  nowMs: number,
): MatchResult {
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) return EMPTY_MATCH;
  let host = rawHost.toLowerCase();
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (host.length === 0 || host.length > CATALOG_LIMITS.maxHostChars) return EMPTY_MATCH;
  // Regex and exact paths run only on bounded printable-ASCII pathnames (WHATWG output); longer: no match.
  if (pathname.length > CATALOG_LIMITS.maxPathChars || !PRINTABLE_PATH.test(pathname)) return EMPTY_MATCH;

  const hits: string[] = [];
  const consider = (rule: CompiledRule): void => {
    const n = rule.network;
    if (n === null || hits.includes(rule.ruleId)) return;
    if (n.scheme !== scheme || n.port !== port) return;
    if (n.resourceType !== null && n.resourceType !== resourceType) return;
    if (!(nowMs < rule.expiresAtMs)) return;
    if (n.paths.length > 0) {
      if (!n.paths.includes(pathname)) return;
    } else if (n.pathPattern !== null && !n.pathPattern.test(pathname)) {
      return;
    }
    hits.push(rule.ruleId);
  };

  for (const rule of index.networkByHost.get(host) ?? []) consider(rule);
  // Suffix rules: the host equals the labels (only without a leftmost-label pattern), or exactly one extra
  // label (no dots, <= 63 chars) precedes them and passes the pattern.
  for (const rule of index.networkBySuffix.get(host) ?? []) {
    if (rule.network?.suffix?.leftmost === null) consider(rule);
  }
  const dot = host.indexOf('.');
  if (dot > 0 && dot <= CATALOG_LIMITS.maxLabelChars) {
    const label = host.slice(0, dot);
    for (const rule of index.networkBySuffix.get(host.slice(dot + 1)) ?? []) {
      const leftmost = rule.network?.suffix?.leftmost;
      if (leftmost === undefined) continue;
      if (leftmost === null || leftmost.test(label)) consider(rule);
    }
  }
  if (hits.length === 0) return EMPTY_MATCH;
  hits.sort();
  return Object.freeze(hits.slice(0, CATALOG_LIMITS.maxMatchedRules));
}

/** Matches a webRequest-shaped record. URL parsing happens only when the index has network rules. */
export function matchNetworkRequest(index: CatalogIndex, input: NetworkRequestInput, nowMs: number): MatchResult {
  try {
    if (!hasNetworkRules(index)) return EMPTY_MATCH;
    const url = input.url;
    const resourceType = input.resourceType;
    if (!isReceivedStatus(input.statusCode)) return EMPTY_MATCH;
    if (typeof resourceType !== 'string' || !RESOURCE_TYPES.has(resourceType)) return EMPTY_MATCH;
    if (typeof url !== 'string' || url.length > CATALOG_LIMITS.maxUrlChars) return EMPTY_MATCH;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return EMPTY_MATCH;
    }
    const scheme = parsed.protocol === 'https:' ? 'https' : parsed.protocol === 'http:' ? 'http' : null;
    if (scheme === null) return EMPTY_MATCH;
    const port = parsed.port === '' ? null : Number(parsed.port);
    return matchParts(index, scheme, parsed.hostname, port, parsed.pathname, resourceType, nowMs);
  } catch {
    return EMPTY_MATCH;
  }
}

/** Same rules for callers that already hold WHATWG components (hostname, default port as null). */
export function matchParsedRequest(index: CatalogIndex, input: ParsedRequestInput, nowMs: number): MatchResult {
  try {
    if (!hasNetworkRules(index)) return EMPTY_MATCH;
    const { scheme, hostname, port, pathname, resourceType, statusCode } = input;
    if (!isReceivedStatus(statusCode)) return EMPTY_MATCH;
    if (typeof resourceType !== 'string' || !RESOURCE_TYPES.has(resourceType)) return EMPTY_MATCH;
    if (scheme !== 'https' && scheme !== 'http') return EMPTY_MATCH;
    if (typeof hostname !== 'string' || typeof pathname !== 'string') return EMPTY_MATCH;
    if (port !== null && (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535)) return EMPTY_MATCH;
    // WHATWG serializes the scheme's default port as ''; normalize it the same way.
    const effectivePort = (scheme === 'https' && port === 443) || (scheme === 'http' && port === 80) ? null : port;
    return matchParts(index, scheme, hostname, effectivePort, pathname, resourceType, nowMs);
  } catch {
    return EMPTY_MATCH;
  }
}
