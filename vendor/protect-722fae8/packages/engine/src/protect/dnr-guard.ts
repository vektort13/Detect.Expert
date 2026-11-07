// ADR-020 §C, §5 (S04): the only gate every declarativeNetRequest rule of the module passes before it is written.
// Allowed: `block` / `allow`, and `modifyHeaders` that sets exactly `Sec-GPC: 1`. Never redirect, upgradeScheme,
// allowAllRequests, removed or other headers, regex filters or methods. Rule ids stay in the module's ranges.
// The names of the forbidden actions appear in the extension bundle only here (scripts/release-verify.mjs checks).

import { DNR_PRIORITIES, DNR_RULE_IDS, dnrRangeOf } from '@detect-expert/contracts';
import type { DnrRangeName } from '@detect-expert/contracts';

/** DNR actions the module never writes (ADR-020 §5). Header removal is rejected through the header check below. */
export const FORBIDDEN_DNR_ACTIONS = ['redirect', 'upgradeScheme', 'allowAllRequests'] as const;

export type AllowedDnrActionType = 'block' | 'allow' | 'modifyHeaders';

export interface GpcHeaderInfo {
  header: 'Sec-GPC';
  operation: 'set';
  value: '1';
}

export interface AllowedDnrCondition {
  requestDomains?: string[];
  excludedRequestDomains?: string[];
  initiatorDomains?: string[];
  excludedInitiatorDomains?: string[];
  topDomains?: string[];
  excludedTopDomains?: string[];
  tabIds?: number[];
  resourceTypes?: string[];
  /** Preset range only: `||domain` or `||domain/path-prefix`. */
  urlFilter?: string;
}

export interface AllowedDnrRule {
  id: number;
  priority: number;
  action: { type: 'block' } | { type: 'allow' } | { type: 'modifyHeaders'; requestHeaders: [GpcHeaderInfo] };
  condition: AllowedDnrCondition;
}

const RULE_KEYS: ReadonlySet<string> = /* @__PURE__ */ new Set(['id', 'priority', 'action', 'condition']);
const SIMPLE_ACTION_KEYS: ReadonlySet<string> = /* @__PURE__ */ new Set(['type']);
const DOMAIN_LIST_KEYS = ['requestDomains', 'excludedRequestDomains', 'initiatorDomains', 'excludedInitiatorDomains', 'topDomains', 'excludedTopDomains'] as const;
const CONDITION_KEYS: ReadonlySet<string> = /* @__PURE__ */ new Set<string>([...DOMAIN_LIST_KEYS, 'tabIds', 'resourceTypes', 'urlFilter']);
/** Key set of a modifyHeaders action, built from identifiers (no header-name string literal in this module). */
const MODIFY_KEYS: ReadonlySet<string> = /* @__PURE__ */ new Set(Object.keys({ type: 0, requestHeaders: 0 }));
const HEADER_KEYS: ReadonlySet<string> = /* @__PURE__ */ new Set(['header', 'operation', 'value']);
/** chrome.declarativeNetRequest.ResourceType values (Chrome 119+). */
const RESOURCE_TYPES: ReadonlySet<string> = /* @__PURE__ */ new Set([
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report',
  'media', 'websocket', 'webtransport', 'webbundle', 'other',
]);
const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
/** `||domain` with an optional literal path prefix: no wildcard, separator, anchor, query or fragment. */
const URL_FILTER_RE = /^\|\|[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?(?:\/[A-Za-z0-9._~/-]{0,160})?$/;
const MAX_DOMAINS = 1000;
const MAX_TAB_IDS = 128;

/** Priorities allowed per range: GPC header rules, user decisions, preset entries and per-tab `once` rules. */
const RANGE_PRIORITIES: Readonly<Record<DnrRangeName, readonly number[]>> = {
  gpc: [DNR_PRIORITIES.gpc],
  decisions: [DNR_PRIORITIES.receiverBlock, DNR_PRIORITIES.receiverAllow, DNR_PRIORITIES.siteBlock, DNR_PRIORITIES.siteAllow],
  preset: [DNR_PRIORITIES.presetBlock],
  session: [DNR_PRIORITIES.once],
};

export class DnrGuardError extends Error {
  constructor(reason: string) {
    super('dnr-guard: ' + reason);
    this.name = 'DnrGuardError';
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function onlyKeys(v: Record<string, unknown>, allowed: ReadonlySet<string>, path: string): void {
  for (const key of Object.keys(v)) if (!allowed.has(key)) throw new DnrGuardError(path + ': key not allowed');
}

function checkDomains(value: unknown, path: string): void {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_DOMAINS) throw new DnrGuardError(path + ': not a bounded list');
  for (const d of value) if (typeof d !== 'string' || d.length > 253 || !DOMAIN_RE.test(d)) throw new DnrGuardError(path + ': not a domain');
}

function checkAction(action: unknown, range: DnrRangeName): AllowedDnrActionType {
  if (!isRecord(action)) throw new DnrGuardError('action: not an object');
  const type = action['type'];
  if (typeof type !== 'string') throw new DnrGuardError('action.type');
  if ((FORBIDDEN_DNR_ACTIONS as readonly string[]).includes(type)) throw new DnrGuardError('action.type forbidden');
  if (type === 'block' || type === 'allow') {
    onlyKeys(action, SIMPLE_ACTION_KEYS, 'action');
    if (range === 'gpc') throw new DnrGuardError('gpc range holds header rules only');
    if (range === 'preset' && type !== 'block') throw new DnrGuardError('preset range holds block rules only');
    return type;
  }
  if (type !== 'modifyHeaders') throw new DnrGuardError('action.type not allowed');
  if (range !== 'gpc') throw new DnrGuardError('modifyHeaders only in the gpc range');
  onlyKeys(action, MODIFY_KEYS, 'action');
  const { requestHeaders: headers } = action as { requestHeaders?: unknown };
  if (!Array.isArray(headers) || headers.length !== 1) throw new DnrGuardError('action: exactly one request header');
  const h: unknown = headers[0];
  if (!isRecord(h)) throw new DnrGuardError('action: header not an object');
  onlyKeys(h, HEADER_KEYS, 'action.header');
  if (h['header'] !== 'Sec-GPC' || h['operation'] !== 'set' || h['value'] !== '1') throw new DnrGuardError('action: only Sec-GPC set 1');
  return 'modifyHeaders';
}

/**
 * Throws DnrGuardError unless `rule` is one the module may write (ADR-020 §C): id in one of DNR_RULE_IDS, priority of
 * that range (DNR_PRIORITIES), an allowed action, and only the allowed condition keys. Block/allow rules must name
 * their targets (requestDomains, or a preset urlFilter): a rule without a target would stop every request.
 */
export function assertAllowedRule(rule: unknown): asserts rule is AllowedDnrRule {
  if (!isRecord(rule)) throw new DnrGuardError('rule: not an object');
  onlyKeys(rule, RULE_KEYS, 'rule');
  const id = rule['id'];
  if (typeof id !== 'number' || !Number.isSafeInteger(id)) throw new DnrGuardError('id');
  const range = dnrRangeOf(id);
  if (range === null) throw new DnrGuardError('id outside the module ranges');
  const priority = rule['priority'];
  if (typeof priority !== 'number' || !RANGE_PRIORITIES[range].includes(priority)) throw new DnrGuardError('priority not allowed for the range');
  const type = checkAction(rule['action'], range);
  const condition = rule['condition'];
  if (!isRecord(condition)) throw new DnrGuardError('condition: not an object');
  onlyKeys(condition, CONDITION_KEYS, 'condition');
  for (const key of DOMAIN_LIST_KEYS) if (condition[key] !== undefined) checkDomains(condition[key], 'condition.' + key);
  const tabIds = condition['tabIds'];
  if (tabIds !== undefined) {
    if (!Array.isArray(tabIds) || tabIds.length === 0 || tabIds.length > MAX_TAB_IDS) throw new DnrGuardError('condition.tabIds');
    for (const t of tabIds) if (typeof t !== 'number' || !Number.isSafeInteger(t) || t < 0) throw new DnrGuardError('condition.tabIds');
  }
  const types = condition['resourceTypes'];
  if (types !== undefined) {
    if (!Array.isArray(types) || types.length === 0 || types.length > RESOURCE_TYPES.size) throw new DnrGuardError('condition.resourceTypes');
    for (const t of types) if (typeof t !== 'string' || !RESOURCE_TYPES.has(t)) throw new DnrGuardError('condition.resourceTypes');
  }
  const urlFilter = condition['urlFilter'];
  if (urlFilter !== undefined) {
    if (range !== 'preset') throw new DnrGuardError('urlFilter only in the preset range');
    if (typeof urlFilter !== 'string' || !URL_FILTER_RE.test(urlFilter)) throw new DnrGuardError('condition.urlFilter');
  }
  if (type !== 'modifyHeaders' && condition['requestDomains'] === undefined && urlFilter === undefined) {
    throw new DnrGuardError('block/allow rule without a target');
  }
  if (range === 'session' && tabIds === undefined) throw new DnrGuardError('session rules are per tab');
}

/** Non-throwing form: true when assertAllowedRule accepts the rule. */
export function isAllowedRule(rule: unknown): rule is AllowedDnrRule {
  try {
    assertAllowedRule(rule);
    return true;
  } catch {
    return false;
  }
}

/** Our id range bounds (inclusive), for reading and clearing a range. */
export function dnrRangeBounds(range: DnrRangeName): readonly [number, number] {
  return DNR_RULE_IDS[range];
}
