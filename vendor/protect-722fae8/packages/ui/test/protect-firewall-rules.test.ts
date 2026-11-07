// ADR-020 §D (S09): view model of the firewall rules in Options — search normalization (domain substring, never a URL
// query), the list request (pages of ≤ 200), defensive reading of protect-rules, rows «адрес · где · решение · когда ·
// кем создано», rules not in effect, tri-state selection, removal keys, «Сегодня».

import { describe, expect, it } from 'vitest';
import { PROTECT_WIRE_LIMITS } from '@detect-expert/contracts';
import type { FirewallRuleRow } from '@detect-expert/contracts';
import {
  RULES_PAGE_SIZE,
  RULES_SEARCH_DEBOUNCE_MS,
  localDayOf,
  normalizeDomainFilter,
  readRulesAnswer,
  removalKeys,
  ruleLine,
  rulesRequest,
  rulesView,
  stoppedToday,
  toggleAllShown,
  triStateOf,
} from '../src/view-models/protect-firewall-rules';
import { fwRuleRows } from './protect-firewall-support';

const day = (d: string): string => 'D(' + d + ')';

function answer(rows: FirewallRuleRow[], total = rows.length, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { schemaVersion: 1, type: 'protect-rules', total, rows, preset: 'normal', stoppedDays: [{ day: '2026-10-18', count: 9 }, { day: '2026-10-17', count: 4 }], ...extra };
}

describe('search', () => {
  it('domain substring: lowercase host of an address, punycode; empty = no filter; anything else invalid', () => {
    expect(RULES_SEARCH_DEBOUNCE_MS).toBe(300);
    expect(normalizeDomainFilter('')).toBeUndefined();
    expect(normalizeDomainFilter('   ')).toBeUndefined();
    expect(normalizeDomainFilter('Collect.Example.NET')).toBe('collect.example.net');
    expect(normalizeDomainFilter('https://www.Shop.example/path?q=secret#x')).toBe('www.shop.example');
    expect(normalizeDomainFilter('shop.example:8443')).toBe('shop.example');
    expect(normalizeDomainFilter('user@shop.example')).toBe('shop.example');
    expect(normalizeDomainFilter('пример.рф')).toBe('xn--e1afmkfd.xn--p1ai');
    expect(normalizeDomainFilter('exa mple')).toBeNull();
    expect(normalizeDomainFilter('a'.repeat(65))).toBeNull();
    expect(normalizeDomainFilter('x'.repeat(3000))).toBeNull();
    expect(normalizeDomainFilter('...')).toBeNull();
  });

  it('request: pages of 200, offset bounded by the contract, optional filter and action', () => {
    expect(RULES_PAGE_SIZE).toBe(200);
    expect(rulesRequest({ filter: undefined, action: 'all', page: 0 })).toEqual({ offset: 0, limit: 200 });
    expect(rulesRequest({ filter: 'example', action: 'block', page: 2 })).toEqual({ offset: 400, limit: 200, domainFilter: 'example', action: 'block' });
    expect(rulesRequest({ filter: undefined, action: 'allow', page: 99 }).offset).toBe(PROTECT_WIRE_LIMITS.maxRulesOffset);
    expect(rulesRequest({ filter: undefined, action: 'all', page: -3 }).offset).toBe(0);
  });
});

describe('readRulesAnswer', () => {
  it('reads rows, total, preset and days; skips malformed rows; ≤ 200 rows', () => {
    const rows = fwRuleRows(5);
    const parsed = readRulesAnswer(answer([...rows, { ...rows[0]!, ruleKey: 'site:https://x>y' }, { ...rows[1]!, receiver: 'not a domain' }] as FirewallRuleRow[], 7))!;
    expect(parsed.rows.map((r) => r.ruleKey)).toEqual(rows.map((r) => r.ruleKey));
    expect(parsed.total).toBe(7);
    expect(parsed.preset).toBe('normal');
    expect(parsed.stoppedDays).toHaveLength(2);
    expect(readRulesAnswer(answer(fwRuleRows(250)))!.rows).toHaveLength(200);
    expect(readRulesAnswer({ ...answer([]), type: 'protect-state' })).toBeNull();
    expect(readRulesAnswer({ ...answer([]), preset: 'paranoid' })).toBeNull();
    expect(readRulesAnswer(null)).toBeNull();
  });

  it('a site rule needs a site, an everywhere rule has none; inactiveReason only for rules not in effect', () => {
    const [site, , everywhere] = fwRuleRows(3);
    expect(readRulesAnswer(answer([{ ...site!, site: null }]))!.rows).toHaveLength(0);
    expect(readRulesAnswer(answer([{ ...everywhere!, site: 'x.example' }]))!.rows).toHaveLength(0);
    expect(readRulesAnswer(answer([{ ...site!, active: true, inactiveReason: 'rule-limit' }]))!.rows[0]).not.toHaveProperty('inactiveReason');
  });
});

describe('rows and selection', () => {
  it('row line: receiver — where — decision — when, origin; everywhere and preset', () => {
    const [site, , everywhere, allow, , preset] = fwRuleRows(6);
    expect(ruleLine(site!, day)).toEqual({ key: 'fw_rule_line', subs: ['rcv0.example.net', 'site0.example', { key: 'fw_rule_blocked' }, 'D(2026-10-10)', { key: 'fw_rule_origin_user' }] });
    expect(ruleLine(everywhere!, day).subs![1]).toEqual({ key: 'fw_rule_everywhere' });
    expect(ruleLine(allow!, day).subs![2]).toEqual({ key: 'fw_rule_allowed' });
    expect(ruleLine({ ...preset!, origin: 'preset' }, day).subs![4]).toEqual({ key: 'fw_rule_origin_preset' });
  });

  it('a rule not in effect says why', () => {
    const rows = fwRuleRows(6);
    const vm = rulesView(readRulesAnswer(answer(rows)), { filter: undefined, action: 'all', page: 0 }, new Set(), '2026-10-18', day);
    expect(vm.rows[0]!.inactive).toBeNull();
    expect(vm.rows[5]!.inactive).toEqual({ key: 'fw_rule_inactive', subs: [{ key: 'fw_rule_inactive_rule_limit' }] });
  });

  it('tri-state «select all shown», toggling keeps other pages, removal keys only from the shown page (≤ 200)', () => {
    const rows = fwRuleRows(4);
    expect(triStateOf(rows, new Set())).toBe('none');
    expect(triStateOf(rows, new Set([rows[0]!.ruleKey]))).toBe('some');
    const all = toggleAllShown(rows, new Set(['other-page-key']));
    expect(triStateOf(rows, all)).toBe('all');
    expect(all.has('other-page-key')).toBe(true);
    const none = toggleAllShown(rows, all);
    expect(triStateOf(rows, none)).toBe('none');
    expect(none.has('other-page-key')).toBe(true);
    expect(removalKeys(rows, new Set([rows[1]!.ruleKey, 'other-page-key']))).toEqual([rows[1]!.ruleKey]);
    const many = fwRuleRows(200);
    expect(removalKeys(many, new Set(many.map((r) => r.ruleKey)))).toHaveLength(PROTECT_WIRE_LIMITS.maxRemoveRuleKeys);
  });

  it('view: count label, empty texts (none yet / nothing found), paging, «Сегодня» lower bound', () => {
    const q = { filter: undefined, action: 'all' as const, page: 0 };
    const empty = rulesView(readRulesAnswer(answer([])), q, new Set(), '2026-10-18', day);
    expect(empty.empty).toEqual({ key: 'fw_rules_empty' });
    expect(empty.shown).toBeNull();
    expect(empty.today).toEqual({ key: 'fw_counter_today', subs: [9] });
    expect(empty.todayNote).toEqual({ key: 'fw_counter_note' });
    expect(rulesView(readRulesAnswer(answer([])), { ...q, filter: 'zzz' }, new Set(), '2026-10-18', day).empty).toEqual({ key: 'fw_rules_none_found' });
    const page = rulesView(readRulesAnswer(answer(fwRuleRows(200), 450)), q, new Set([fwRuleRows(1)[0]!.ruleKey]), '2026-10-19', day);
    expect(page.rows).toHaveLength(200);
    expect(page.shown).toEqual({ key: 'fw_rules_shown', subs: [200, 450] });
    expect(page.selectedCount).toBe(1);
    expect(page.removeLabel).toEqual({ key: 'fw_rules_remove_selected', subs: [1] });
    expect(page.hasPrev).toBe(false);
    expect(page.hasNext).toBe(true);
    expect(page.today).toEqual({ key: 'fw_counter_today', subs: [0] });
    expect(rulesView(null, q, new Set(), '2026-10-18', day).empty).toBeNull();
  });

  it('local day and the stopped counter of today', () => {
    expect(localDayOf(new Date(2026, 9, 18, 23, 59).getTime())).toBe('2026-10-18');
    expect(localDayOf(new Date(2026, 0, 5, 0, 1).getTime())).toBe('2026-01-05');
    expect(stoppedToday([{ day: '2026-10-18', count: 3 }], '2026-10-18')).toBe(3);
    expect(stoppedToday([], '2026-10-18')).toBe(0);
  });
});
