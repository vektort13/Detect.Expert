// ADR-020 §11, §C (S08): local evaluation of the module's own DNR rules — the subset DNR semantics the firewall uses.
// It answers «which of our rules wins for this request» so that `stopped` is claimed only for our block rule
// (OutcomeTracker port) and a sent request our rule should have stopped is reported as a bypass. Semantics:
//   - requestDomains / topDomains / initiatorDomains match a host and its subdomains by whole labels;
//   - excluded* conditions win over the positive ones; an unknown top / initiator never satisfies a positive condition;
//   - tabIds restricts to the tab; rules without resourceTypes never match main_frame;
//   - urlFilter `||host[/prefix]`: host by labels, no explicit port, path prefix (case-insensitive);
//   - the highest priority wins; on equal priority allow wins over block.
// Pure: the URL (only for urlFilter rules) lives in the call; nothing is kept.

import { domainMatches } from '../../../../attribution/src/dnr-domains';
import type { CompiledFirewallRule, FirewallRuleKind } from './rules';

export interface FirewallRequest {
  /** Host of the request URL: ASCII lowercase, no port, no trailing dot. */
  receiverHost: string;
  /** Host or site of the tab's top-level document; null when unknown. */
  topDomain: string | null;
  /** Host or site of the request initiator; null when the browser started it or it is opaque. */
  initiatorDomain: string | null;
  tabId: number;
  /** webRequest resource type (`main_frame`, `xmlhttprequest`, `ping`, ...). */
  type: string;
  /** The request URL, read inside the call only (preset urlFilter rules); never stored. */
  url?: string;
}

export interface FirewallMatch {
  ruleId: number;
  action: 'block' | 'allow';
  ruleKey: string;
  priority: number;
  kind: FirewallRuleKind;
  rule: CompiledFirewallRule;
}

function anyMatch(host: string, list: readonly string[]): boolean {
  for (const d of list) if (domainMatches(host, d)) return true;
  return false;
}

/** Path of an http(s) URL after its authority, and whether the authority had an explicit port. */
function pathOf(url: string): { path: string; port: boolean } | null {
  const scheme = url.indexOf('://');
  if (scheme < 0) return null;
  const start = scheme + 3;
  let end = url.length;
  for (let i = start; i < url.length; i++) {
    const c = url.charCodeAt(i);
    if (c === 47 || c === 63 || c === 35) {
      end = i;
      break;
    }
  }
  const authority = url.slice(start, end);
  const at = authority.lastIndexOf('@');
  const hostPort = at >= 0 ? authority.slice(at + 1) : authority;
  const port = hostPort.startsWith('[') ? hostPort.includes(']:') : hostPort.includes(':');
  let pathEnd = url.length;
  for (let i = end; i < url.length; i++) {
    const c = url.charCodeAt(i);
    if (c === 63 || c === 35) {
      pathEnd = i;
      break;
    }
  }
  const path = end < url.length && url.charCodeAt(end) === 47 ? url.slice(end, pathEnd) : '/';
  return { path, port };
}

function urlFilterMatches(filter: string, req: FirewallRequest): boolean {
  if (!filter.startsWith('||')) return false;
  const body = filter.slice(2);
  const slash = body.indexOf('/');
  const host = slash < 0 ? body : body.slice(0, slash);
  if (!domainMatches(req.receiverHost, host)) return false;
  if (slash < 0) return true;
  if (req.url === undefined) return false;
  const parsed = pathOf(req.url);
  if (parsed === null || parsed.port) return false;
  return parsed.path.toLowerCase().startsWith(body.slice(slash).toLowerCase());
}

/** Whether one of our rules matches the request (DNR condition subset above). */
export function ruleMatches(compiled: CompiledFirewallRule, req: FirewallRequest): boolean {
  const c = compiled.rule.condition;
  if (c.resourceTypes === undefined ? req.type === 'main_frame' : !c.resourceTypes.includes(req.type)) return false;
  if (c.tabIds !== undefined && !c.tabIds.includes(req.tabId)) return false;
  if (c.requestDomains !== undefined) {
    if (!anyMatch(req.receiverHost, c.requestDomains)) return false;
  } else if (c.urlFilter !== undefined) {
    if (!urlFilterMatches(c.urlFilter, req)) return false;
  } else return false;
  if (c.excludedRequestDomains !== undefined && anyMatch(req.receiverHost, c.excludedRequestDomains)) return false;
  if (c.topDomains !== undefined && (req.topDomain === null || !anyMatch(req.topDomain, c.topDomains))) return false;
  if (c.excludedTopDomains !== undefined && req.topDomain !== null && anyMatch(req.topDomain, c.excludedTopDomains)) return false;
  if (c.initiatorDomains !== undefined && (req.initiatorDomain === null || !anyMatch(req.initiatorDomain, c.initiatorDomains))) return false;
  if (c.excludedInitiatorDomains !== undefined && req.initiatorDomain !== null && anyMatch(req.initiatorDomain, c.excludedInitiatorDomains)) return false;
  return true;
}

function better(a: FirewallMatch | null, rule: CompiledFirewallRule): boolean {
  if (a === null) return true;
  if (rule.rule.priority !== a.priority) return rule.rule.priority > a.priority;
  return rule.action === 'allow' && a.action === 'block';
}

function toMatch(rule: CompiledFirewallRule): FirewallMatch {
  return { ruleId: rule.rule.id, action: rule.action, ruleKey: rule.ruleKey, priority: rule.rule.priority, kind: rule.kind, rule };
}

/**
 * Rules indexed by their target domain (requestDomains entries, urlFilter host): a request looks up each label suffix
 * of its host, so the cost depends on the host's labels, not on the number of rules.
 */
export class FirewallIndex {
  private readonly byDomain = new Map<string, CompiledFirewallRule[]>();
  readonly size: number;

  constructor(rules: readonly CompiledFirewallRule[]) {
    let n = 0;
    for (const r of rules) {
      const c = r.rule.condition;
      const keys: string[] = [];
      if (c.requestDomains !== undefined) keys.push(...c.requestDomains);
      else if (c.urlFilter !== undefined && c.urlFilter.startsWith('||')) {
        const body = c.urlFilter.slice(2);
        const slash = body.indexOf('/');
        keys.push(slash < 0 ? body : body.slice(0, slash));
      }
      if (keys.length === 0) continue;
      n++;
      for (const k of new Set(keys)) {
        const list = this.byDomain.get(k);
        if (list === undefined) this.byDomain.set(k, [r]);
        else list.push(r);
      }
    }
    this.size = n;
  }

  /** The winning rule of ours for the request, or null. */
  evaluate(req: FirewallRequest): FirewallMatch | null {
    if (this.size === 0 || req.type === 'main_frame') return null;
    const host = req.receiverHost;
    let best: FirewallMatch | null = null;
    let i = 0;
    for (;;) {
      const candidates = this.byDomain.get(i === 0 ? host : host.slice(i));
      if (candidates !== undefined) {
        for (const r of candidates) if (better(best, r) && ruleMatches(r, req)) best = toMatch(r);
      }
      const dot = host.indexOf('.', i);
      if (dot < 0) break;
      i = dot + 1;
    }
    return best;
  }

  /** Whether any rule targets the host or one of its parents (cheap pre-check). */
  targets(host: string): boolean {
    if (this.size === 0) return false;
    let i = 0;
    for (;;) {
      if (this.byDomain.has(i === 0 ? host : host.slice(i))) return true;
      const dot = host.indexOf('.', i);
      if (dot < 0) return false;
      i = dot + 1;
    }
  }
}

/** One-shot evaluation (tests, cold paths). Hot paths keep a FirewallIndex. */
export function evaluateFirewall(rules: readonly CompiledFirewallRule[], req: FirewallRequest): FirewallMatch | null {
  return new FirewallIndex(rules).evaluate(req);
}
