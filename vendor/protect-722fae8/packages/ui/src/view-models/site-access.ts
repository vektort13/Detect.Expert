// Options «Доступ к сайтам» view model (S12 / E13-03, ADR-003 v3). Pure: the browser's granted origins
// (chrome.permissions.getAll) and the build's required host_permissions come in as plain strings; the rows show only
// sanitized hosts. Chrome keeps the grants; the extension's list (ScopeState.hosts) decides what is observed.

import { BUDGETS, isSanitizedHost } from '@detect-expert/contracts';
import type { ScopeState } from '@detect-expert/contracts';

/** Granted origin patterns and the build's required host_permissions (bounded strings; see messaging.readGrantedAccess). */
export interface GrantedAccess {
  origins: string[];
  required: string[];
}

export type SiteStatusKey = 'site_status_required' | 'site_status_observed' | 'site_status_listed_inactive' | 'site_status_granted_only';

export interface SiteRow {
  host: string;
  statusKey: SiteStatusKey;
  /** In the extension's site list (ScopeState.hosts). */
  listed: boolean;
  /** Exact host patterns of this host that the browser granted and the build does not require. */
  revocable: string[];
  /** A pattern of this host is a required host_permission (cannot be revoked). */
  required: boolean;
}

export interface SiteAccessVM {
  rows: SiteRow[];
  /** Rows beyond MAX_SITE_ROWS (shown as a count only). */
  hidden: number;
  /** observed (CW-06): mode all-sites with the broad grant — the SW observes every http(s) host (scope.inScope). */
  allSites: { granted: boolean; required: boolean; revocable: string[]; observed: boolean };
  /** Granted patterns that are neither an exact host of a row nor an all-sites pattern (shown as a count). */
  otherGrants: number;
  /** What «Выключено» with revoke removes: every optional http/https grant except <all_urls> (bounded). */
  offRevocable: string[];
  managed: boolean;
}

export const MAX_SITE_ROWS = BUDGETS.maxHostsPerDocument;
export const MAX_ACCESS_PATTERNS = 512;
export const ALL_SITES_PATTERNS: readonly string[] = ['http://*/*', 'https://*/*'];

const EXACT_HOST_RE = /^(https?):\/\/([^/*]+)\/\*$/;

export function hostPatternsOf(host: string): string[] {
  return ['http://' + host + '/*', 'https://' + host + '/*'];
}

/** Host of an exact `http(s)://<host>/*` grant; null for wildcards, other schemes, paths or unsanitized hosts. */
export function exactGrantHost(pattern: string): string | null {
  const match = EXACT_HOST_RE.exec(pattern);
  const host = match?.[2];
  return host !== undefined && isSanitizedHost(host) ? host : null;
}

function isHttpFamily(pattern: string): boolean {
  return pattern.startsWith('http://') || pattern.startsWith('https://') || pattern.startsWith('*://');
}

export function allSitesGranted(origins: readonly string[]): boolean {
  return origins.includes('<all_urls>') || ALL_SITES_PATTERNS.every((p) => origins.includes(p));
}

/** Patterns to remove for one host: its exact grants minus the build's required ones. */
export function revocableFor(host: string, access: GrantedAccess): string[] {
  return hostPatternsOf(host).filter((p) => access.origins.includes(p) && !access.required.includes(p));
}

/** Every optional http/https grant except <all_urls> (the «Выключено» revoke set), bounded. */
export function offRevocableOf(access: GrantedAccess | null): string[] {
  if (access === null) return [];
  const out: string[] = [];
  for (const origin of access.origins) {
    if (out.length >= MAX_ACCESS_PATTERNS) break;
    if (origin === '<all_urls>' || !isHttpFamily(origin) || access.required.includes(origin) || out.includes(origin)) continue;
    out.push(origin);
  }
  return out;
}

export function siteAccessView(scope: ScopeState | null, access: GrantedAccess | null): SiteAccessVM {
  const origins = access?.origins ?? [];
  const required = access?.required ?? [];
  const granted: GrantedAccess = { origins, required };
  const listed = scope?.hosts.filter((h) => isSanitizedHost(h)) ?? [];
  const hosts: string[] = [...listed];
  const exact = new Set<string>();
  for (const origin of origins) {
    const host = exactGrantHost(origin);
    if (host === null) continue;
    exact.add(origin);
    if (!hosts.includes(host)) hosts.push(host);
  }
  const siteMode = scope?.scopeMode === 'site';
  // CW-06: in all-sites mode with the broad grant every host is observed, listed or not (matches the SW's inScope).
  const observedEverywhere = scope?.scopeMode === 'all-sites' && allSitesGranted(origins);
  const rows: SiteRow[] = hosts.slice(0, MAX_SITE_ROWS).map((host) => {
    const patterns = hostPatternsOf(host);
    const isRequired = patterns.some((p) => required.includes(p));
    const hasGrant = patterns.some((p) => origins.includes(p)) || allSitesGranted(origins);
    const isListed = listed.includes(host);
    const statusKey: SiteStatusKey = isRequired
      ? 'site_status_required'
      : observedEverywhere || (isListed && siteMode && hasGrant)
        ? 'site_status_observed'
        : isListed
          ? 'site_status_listed_inactive'
          : 'site_status_granted_only';
    return { host, statusKey, listed: isListed, revocable: revocableFor(host, granted), required: isRequired };
  });
  const allSitesPatterns = ALL_SITES_PATTERNS.filter((p) => origins.includes(p));
  const otherGrants = origins.filter((o) => !exact.has(o) && !ALL_SITES_PATTERNS.includes(o) && o !== '<all_urls>').length;
  return {
    rows,
    hidden: Math.max(0, hosts.length - MAX_SITE_ROWS),
    allSites: {
      granted: allSitesGranted(origins),
      required: ALL_SITES_PATTERNS.some((p) => required.includes(p)) || required.includes('<all_urls>'),
      revocable: allSitesPatterns.filter((p) => !required.includes(p)),
      observed: observedEverywhere,
    },
    otherGrants,
    offRevocable: offRevocableOf(access),
    managed: scope?.managed === true,
  };
}

/** Which notice follows a removal (ADR-003 v3): all-sites still covers the host, a grant remained, or all revoked. */
export function siteRemovedNoticeKey(allSitesStillGranted: boolean, revokeOk: boolean, grantRemains: boolean): 'site_removed_all_sites_kept' | 'site_removed_access_kept' | 'site_removed' {
  if (allSitesStillGranted) return 'site_removed_all_sites_kept';
  if (!revokeOk || grantRemains) return 'site_removed_access_kept';
  return 'site_removed';
}
