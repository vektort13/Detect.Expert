// ADR-020 §H (S13): the one dynamic DNR rule of the GPC feature and its read-back check. Pure: no chrome.*.
// The rule sets exactly `Sec-GPC: 1` (dnr-guard rejects anything else), id = first id of the GPC range, priority 100
// (above every allow rule of the firewall: an allow with a higher priority would drop the header), on every resource
// type Chrome 119+ knows except webtransport / webbundle; the module's excluded sites are excluded both as initiator
// and as request domain (SP-9: exclusions match the registrable domain, its subdomains and IP literals).

import { DNR_PRIORITIES, DNR_RULE_IDS, PROTECT_BUDGETS, isSiteName } from '@detect-expert/contracts';
import type { AllowedDnrRule } from '@detect-expert/engine';
import type { DnrRuleLike } from '../../chrome-api';

export const GPC_RULE_ID: number = DNR_RULE_IDS.gpc[0];
export const GPC_HEADER = 'Sec-GPC';
export const GPC_HEADER_VALUE = '1';

/**
 * Resource types that get the header (brief S13). All of them are values of chrome.declarativeNetRequest.ResourceType
 * in Chrome 119+ (SP-1 read the enum in Chromium 153: these 13 plus webbundle and webtransport). The runtime enum is
 * not read here: only dnr-port.ts / chrome-api.ts may name the namespace; `available` narrows the list when a caller
 * has it.
 */
export const GPC_RESOURCE_TYPES: readonly string[] = Object.freeze([
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report',
  'media', 'websocket', 'other',
]);

/** GPC_RESOURCE_TYPES ∩ `available` (order of GPC_RESOURCE_TYPES); the full list when `available` is unknown. */
export function gpcResourceTypes(available?: readonly string[] | null): string[] {
  if (available === undefined || available === null) return [...GPC_RESOURCE_TYPES];
  const known = new Set(available);
  return GPC_RESOURCE_TYPES.filter((t) => known.has(t));
}

/** Excluded sites as the rule lists them: valid site names, unique, sorted, at most maxExcludedSites. */
export function gpcExclusions(sites: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const s of sites) if (isSiteName(s)) out.add(s);
  return [...out].sort().slice(0, PROTECT_BUDGETS.maxExcludedSites);
}

/** The rule for `excluded` (already canonical: gpcExclusions). Empty exclusion lists are omitted. */
export function buildGpcRule(excluded: readonly string[], available?: readonly string[] | null): AllowedDnrRule {
  const condition: AllowedDnrRule['condition'] = { resourceTypes: gpcResourceTypes(available) };
  if (excluded.length > 0) {
    condition.excludedInitiatorDomains = [...excluded];
    condition.excludedRequestDomains = [...excluded];
  }
  return {
    id: GPC_RULE_ID,
    priority: DNR_PRIORITIES.gpc,
    action: { type: 'modifyHeaders', requestHeaders: [{ header: GPC_HEADER, operation: 'set', value: GPC_HEADER_VALUE }] },
    condition,
  };
}

/** Result of reading the GPC range back from Chrome after a write. */
export type GpcRuleCheck = 'installed' | 'absent' | 'error';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Same members regardless of order (absent ≡ empty). */
function sameSet(a: unknown, b: readonly string[] | undefined): boolean {
  const left = a === undefined ? [] : a;
  const right = b ?? [];
  if (!Array.isArray(left) || left.length !== right.length) return false;
  const set = new Set(right);
  for (const x of left) if (typeof x !== 'string' || !set.has(x)) return false;
  return new Set(left).size === set.size;
}

const CHECKED_CONDITION_KEYS: ReadonlySet<string> = new Set(['resourceTypes', 'excludedInitiatorDomains', 'excludedRequestDomains']);
/** Keys of a modifyHeaders action, built from identifiers ('requestHeaders' as a string literal lives only in net-hub.ts). */
const ACTION_KEYS: ReadonlySet<string> = new Set(Object.keys({ type: 0, requestHeaders: 0 }));

/** A condition field Chrome may echo with a default: undefined, false or an empty list. Anything else is a mismatch. */
function inertValue(v: unknown): boolean {
  return v === undefined || v === false || (Array.isArray(v) && v.length === 0);
}

/**
 * Compares what Chrome returns for our GPC range with `desired`: no rule → 'absent'; exactly the desired rule (header
 * name compared case-insensitively, lists as sets, no other effective condition) → 'installed'; anything else
 * (unreadable, extra rules in the range, another action or condition) → 'error'.
 */
export function verifyGpcRule(readBack: readonly DnrRuleLike[] | null, desired: AllowedDnrRule): GpcRuleCheck {
  if (readBack === null) return 'error';
  if (readBack.length === 0) return 'absent';
  if (readBack.length !== 1) return 'error';
  const rule = readBack[0]!;
  if (rule.id !== desired.id || rule.priority !== desired.priority) return 'error';
  const action: unknown = rule.action;
  if (!isRecord(action) || action['type'] !== 'modifyHeaders') return 'error';
  const headers = (action as { requestHeaders?: unknown }).requestHeaders;
  if (!Array.isArray(headers) || headers.length !== 1) return 'error';
  const h: unknown = headers[0];
  if (!isRecord(h) || typeof h['header'] !== 'string' || h['header'].toLowerCase() !== GPC_HEADER.toLowerCase() || h['operation'] !== 'set' || h['value'] !== GPC_HEADER_VALUE) return 'error';
  for (const key of Object.keys(action)) if (!ACTION_KEYS.has(key) && !inertValue(action[key])) return 'error';
  const condition: unknown = rule.condition;
  if (!isRecord(condition)) return 'error';
  const want = desired.condition;
  if (!sameSet(condition['resourceTypes'], want.resourceTypes)) return 'error';
  if (!sameSet(condition['excludedInitiatorDomains'], want.excludedInitiatorDomains)) return 'error';
  if (!sameSet(condition['excludedRequestDomains'], want.excludedRequestDomains)) return 'error';
  for (const key of Object.keys(condition)) if (!CHECKED_CONDITION_KEYS.has(key) && !inertValue(condition[key])) return 'error';
  return 'installed';
}
