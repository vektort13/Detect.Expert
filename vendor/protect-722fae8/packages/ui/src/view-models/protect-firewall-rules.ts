// ADR-020 §D (S09): view model of the firewall rules in Options (#firewall): the blocking mode, «Сегодня» (lower
// bounds), the rule list with search, an action filter, a tri-state «select all shown», removal of the selected rules
// (confirmed first) and «Удалить все правила фаервола». Pure; returns message keys. A page holds at most
// PROTECT_WIRE_LIMITS.maxRulesPageSize (200) rows. The search is a domain substring (never a URL query).

import {
  FIREWALL_ACTIONS,
  FIREWALL_INACTIVE_REASONS,
  FIREWALL_RULE_KEY_PATTERN,
  PROTECT_PRESETS,
  PROTECT_WIRE_LIMITS,
  isLocalDay,
  isSiteName,
  isDomainName,
} from '@detect-expert/contracts';
import type {
  FirewallAction,
  FirewallInactiveReason,
  FirewallRuleRow,
  FirewallStoppedDay,
  ProtectPreset,
  UiProtectListRulesRequest,
} from '@detect-expert/contracts';
import { msg } from './message';
import type { Message } from './message';

/** Rows per page (≤ PROTECT_WIRE_LIMITS.maxRulesPageSize). */
export const RULES_PAGE_SIZE = PROTECT_WIRE_LIMITS.maxRulesPageSize;
/** Debounce of the search field (ms). */
export const RULES_SEARCH_DEBOUNCE_MS = 300;

export type RulesActionFilter = FirewallAction | 'all';

export const INACTIVE_REASON_KEYS: Readonly<Record<FirewallInactiveReason, string>> = {
  off: 'fw_rule_inactive_off',
  'warn-only': 'fw_rule_inactive_warn_only',
  'no-permission': 'fw_rule_inactive_no_permission',
  degraded: 'fw_rule_inactive_degraded',
  'rule-limit': 'fw_rule_inactive_rule_limit',
};

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

const MAX_FILTER_CHARS = 64;

// Character checks without regular-expression literals: the token scanner of scripts/code-checks.mjs does not parse
// a '/' inside a character class (FOLLOWUPS S08-1), so this file keeps to plain string code.

/** [a-z0-9.-]{1,64} */
function isFilter(text: string): boolean {
  if (text.length < 1 || text.length > MAX_FILTER_CHARS) return false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (!((c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 46 || c === 45)) return false;
  }
  return true;
}

/** First index of one of `chars` in `text`, or -1. */
function firstOf(text: string, chars: string): number {
  for (let i = 0; i < text.length; i++) if (chars.includes(text.charAt(i))) return i;
  return -1;
}

function hasNonAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 32 || c > 126) return true;
  }
  return false;
}

/**
 * The search field → `domainFilter` of ui-protect-list-rules: '' → undefined (no filter); a host or an address →
 * its lowercase host (punycode); anything else → null (the field shows fw_rules_search_invalid, nothing is sent).
 * Userinfo, port, path, query and fragment of an address are dropped, never sent.
 */
export function normalizeDomainFilter(input: string): string | undefined | null {
  let text = input.trim().toLowerCase();
  if (text === '') return undefined;
  if (text.length > 2048) return null;
  const scheme = text.indexOf('://');
  if (scheme >= 0) text = text.slice(scheme + 3);
  const authorityEnd = firstOf(text, '/?#');
  const at = text.lastIndexOf('@', authorityEnd < 0 ? text.length : authorityEnd);
  if (at >= 0) text = text.slice(at + 1);
  const cut = firstOf(text, '/?#:@');
  if (cut >= 0) text = text.slice(0, cut);
  while (text.endsWith('.')) text = text.slice(0, -1);
  if (text === '') return null;
  if (hasNonAscii(text)) {
    try {
      text = new URL('http://' + text + '/').hostname;
    } catch {
      return null;
    }
  }
  return isFilter(text) ? text : null;
}

export interface RulesQuery {
  filter: string | undefined;
  action: RulesActionFilter;
  /** 0-based page. */
  page: number;
}

/** ui-protect-list-rules body of a query (offset bounded by the contract). */
export function rulesRequest(query: RulesQuery): Omit<UiProtectListRulesRequest, 'schemaVersion' | 'type'> {
  const offset = Math.min(Math.max(0, query.page) * RULES_PAGE_SIZE, PROTECT_WIRE_LIMITS.maxRulesOffset);
  return {
    offset,
    limit: RULES_PAGE_SIZE,
    ...(query.filter === undefined ? {} : { domainFilter: query.filter }),
    ...(query.action === 'all' ? {} : { action: query.action }),
  };
}

// ---------------------------------------------------------------------------
// The SW answer (protect-rules), read defensively
// ---------------------------------------------------------------------------

export interface RulesAnswer {
  total: number;
  rows: FirewallRuleRow[];
  preset: ProtectPreset;
  stoppedDays: FirewallStoppedDay[];
}

const MAX_COUNT_VALUE = 2 ** 31 - 1;
const ACTION_SET: ReadonlySet<string> = new Set(FIREWALL_ACTIONS);
const PRESET_SET: ReadonlySet<string> = new Set(PROTECT_PRESETS);
const REASON_SET: ReadonlySet<string> = new Set(FIREWALL_INACTIVE_REASONS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_COUNT_VALUE;
}

function readRow(value: unknown): FirewallRuleRow | null {
  if (!isRecord(value)) return null;
  const { ruleKey, receiver, site, scope, action, origin, createdDay, active, inactiveReason, stopped, bypass } = value;
  if (typeof ruleKey !== 'string' || !FIREWALL_RULE_KEY_PATTERN.test(ruleKey) || !isDomainName(receiver)) return null;
  if (scope !== 'site' && scope !== 'everywhere') return null;
  if (scope === 'site' ? !isSiteName(site) : site !== null) return null;
  if (typeof action !== 'string' || !ACTION_SET.has(action) || (origin !== 'user' && origin !== 'preset')) return null;
  if (!isLocalDay(createdDay) || typeof active !== 'boolean' || !isCount(stopped) || !isCount(bypass)) return null;
  if (inactiveReason !== undefined && (typeof inactiveReason !== 'string' || !REASON_SET.has(inactiveReason))) return null;
  return {
    ruleKey,
    receiver,
    site: scope === 'site' ? (site as string) : null,
    scope,
    action: action as FirewallAction,
    origin,
    createdDay,
    active,
    ...(inactiveReason === undefined || active ? {} : { inactiveReason: inactiveReason as FirewallInactiveReason }),
    stopped,
    bypass,
  };
}

/** `protect-rules` → rows (≤ 200, malformed rows skipped), total, preset, stopped days (≤ 7); null when malformed. */
export function readRulesAnswer(value: unknown): RulesAnswer | null {
  if (!isRecord(value) || value['type'] !== 'protect-rules' || !isCount(value['total']) || !Array.isArray(value['rows'])) return null;
  const preset = value['preset'];
  if (typeof preset !== 'string' || !PRESET_SET.has(preset) || !Array.isArray(value['stoppedDays'])) return null;
  const rows: FirewallRuleRow[] = [];
  for (const raw of value['rows'].slice(0, RULES_PAGE_SIZE)) {
    const row = readRow(raw);
    if (row !== null && !rows.some((r) => r.ruleKey === row.ruleKey)) rows.push(row);
  }
  const stoppedDays: FirewallStoppedDay[] = [];
  for (const raw of value['stoppedDays'].slice(0, 7)) {
    if (isRecord(raw) && isLocalDay(raw['day']) && isCount(raw['count'])) stoppedDays.push({ day: raw['day'], count: raw['count'] });
  }
  return { total: value['total'], rows, preset: preset as ProtectPreset, stoppedDays };
}

// ---------------------------------------------------------------------------
// Rows, selection, «Сегодня»
// ---------------------------------------------------------------------------

/** Local calendar day of an epoch (the SW keys its stopped counters by the same local day). */
export function localDayOf(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number): string => (n < 10 ? '0' + String(n) : String(n));
  return String(d.getFullYear()) + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/** Lower bound of the requests our rules stopped today (0 when no counter exists for today). */
export function stoppedToday(days: ReadonlyArray<FirewallStoppedDay>, today: string): number {
  return days.find((d) => d.day === today)?.count ?? 0;
}

export interface RuleRowVM {
  ruleKey: string;
  line: Message;
  /** fw_rule_inactive with the reason, or null while the rule is in effect. */
  inactive: Message | null;
  checked: boolean;
  action: FirewallAction;
}

export type TriState = 'none' | 'some' | 'all';

export interface RulesVM {
  rows: RuleRowVM[];
  empty: Message | null;
  shown: Message | null;
  /** «Выбрать все показанные»: checked = all, indeterminate = some. */
  selectAll: TriState;
  selectedCount: number;
  removeLabel: Message;
  hasPrev: boolean;
  hasNext: boolean;
  today: Message;
  todayNote: Message;
}

/**
 * One row: «адрес · где · решение · когда · кем создано». `formatDay` turns a local day (YYYY-MM-DD) into the UI
 * locale's date; the site is a site name or «на всех сайтах».
 */
export function ruleLine(row: FirewallRuleRow, formatDay: (day: string) => string): Message {
  return msg(
    'fw_rule_line',
    row.receiver,
    row.site === null ? msg('fw_rule_everywhere') : row.site,
    msg(row.action === 'block' ? 'fw_rule_blocked' : 'fw_rule_allowed'),
    formatDay(row.createdDay),
    msg(row.origin === 'preset' ? 'fw_rule_origin_preset' : 'fw_rule_origin_user'),
  );
}

export function triStateOf(rows: ReadonlyArray<{ ruleKey: string }>, selected: ReadonlySet<string>): TriState {
  let n = 0;
  for (const r of rows) if (selected.has(r.ruleKey)) n++;
  return n === 0 ? 'none' : n === rows.length ? 'all' : 'some';
}

/** «Выбрать все показанные»: all shown rows are added (or, when all are selected, removed); other pages keep theirs. */
export function toggleAllShown(rows: ReadonlyArray<{ ruleKey: string }>, selected: ReadonlySet<string>): Set<string> {
  const next = new Set(selected);
  if (triStateOf(rows, selected) === 'all') for (const r of rows) next.delete(r.ruleKey);
  else for (const r of rows) next.add(r.ruleKey);
  return next;
}

/** Removal request: selected keys that are on the shown page, at most PROTECT_WIRE_LIMITS.maxRemoveRuleKeys. */
export function removalKeys(rows: ReadonlyArray<{ ruleKey: string }>, selected: ReadonlySet<string>): string[] {
  return rows.filter((r) => selected.has(r.ruleKey)).map((r) => r.ruleKey).slice(0, PROTECT_WIRE_LIMITS.maxRemoveRuleKeys);
}

export function rulesView(answer: RulesAnswer | null, query: RulesQuery, selected: ReadonlySet<string>, today: string, formatDay: (day: string) => string): RulesVM {
  const rows = answer?.rows ?? [];
  const vmRows: RuleRowVM[] = rows.map((row) => ({
    ruleKey: row.ruleKey,
    line: ruleLine(row, formatDay),
    inactive: row.active ? null : msg('fw_rule_inactive', msg(INACTIVE_REASON_KEYS[row.inactiveReason ?? 'degraded'])),
    checked: selected.has(row.ruleKey),
    action: row.action,
  }));
  const keys = removalKeys(rows, selected);
  const total = answer?.total ?? 0;
  const searching = query.filter !== undefined || query.action !== 'all';
  const offset = query.page * RULES_PAGE_SIZE;
  const count = answer === null ? 0 : stoppedToday(answer.stoppedDays, today);
  return {
    rows: vmRows,
    empty: answer !== null && rows.length === 0 ? msg(searching ? 'fw_rules_none_found' : 'fw_rules_empty') : null,
    shown: answer !== null && rows.length > 0 ? msg('fw_rules_shown', rows.length, total) : null,
    selectAll: triStateOf(rows, selected),
    selectedCount: keys.length,
    removeLabel: msg('fw_rules_remove_selected', keys.length),
    hasPrev: query.page > 0,
    hasNext: offset + rows.length < total && offset + RULES_PAGE_SIZE <= PROTECT_WIRE_LIMITS.maxRulesOffset,
    today: msg('fw_counter_today', count),
    todayNote: msg('fw_counter_note'),
  };
}
