// ADR-020 §H (S13): GPC view models — strict reading of the tab fact, the Options section per module state (rule error
// with the restart hint, SP-1), the popup line per site state (exclude button, Options-only way back, reload note,
// what Chrome reported) and the wording of every GPC string in both locales: no verdict about the site, no «the server
// received», no prototype wording.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GpcTabFact, ProtectProjection, ProtectState } from '@detect-expert/contracts';
import { resolveMessage } from '../src/view-models/message';
import type { Message } from '../src/view-models/message';
import { GPC_LEGAL_KEYS, GPC_NAV_KEYS, gpcRuleFailed, gpcSectionView, gpcSiteLineView, parseGpcFact } from '../src/view-models/protect-gpc';

type Table = Record<string, { message: string; placeholders?: Record<string, { content: string }> }>;
const ru = JSON.parse(readFileSync(resolve('apps/extension/_locales/ru/messages.json'), 'utf8')) as Table;
const en = JSON.parse(readFileSync(resolve('apps/extension/_locales/en/messages.json'), 'utf8')) as Table;

function translate(table: Table) {
  return (key: string, subs: ReadonlyArray<string> = []): string => {
    const entry = table[key];
    if (entry === undefined) throw new Error('missing locale key ' + key);
    return entry.message.replace(/\$([A-Z_]+)\$/gi, (_, name: string) => subs[Number(entry.placeholders?.[name.toLowerCase()]?.content.slice(1)) - 1] ?? '');
  };
}
const text = (m: Message, table: Table = ru): string => resolveMessage(translate(table), m);

function state(over: Partial<ProtectState> = {}): ProtectState {
  return {
    state: 'active', consentVersion: 1, requiredConsentVersion: 1, features: ['gpc'], preset: 'normal', snoozedUntil: null, excludedSites: [],
    historyRetentionDays: 30, history: null, decisions: 0, permissions: { broadHosts: true, dnr: true }, organizationDisabled: false,
    organizationPolicyInvalid: false, degradedReasons: [], ...over,
  };
}

function fact(over: Partial<GpcTabFact> = {}): GpcTabFact {
  return {
    site: 'shop.example', siteState: 'on', navigationHeader: 'observed', requestsWithHeader: 4, requestsWithoutHeader: 0, countQuality: 'exact',
    propertyAtLoad: true, reloadNeeded: false, evidenceSource: 'browser-network', integrity: 'browser-observed', ...over,
  };
}

function report(gpc: unknown): ProtectProjection {
  return {
    protectRevision: 1, documentKey: '7:0:DOC', site: 'shop.example', moduleState: 'active', features: ['gpc'], coverageState: 'active', limitations: [],
    evidence: [], previousDocumentEvidence: 0, firewall: {} as ProtectProjection['firewall'], replay: null, gpc: gpc as GpcTabFact | null,
    dropped: { evidence: 0, fingerprints: 0, bodies: 0, events: 0 },
  };
}

const GPC_KEYS = Object.keys(ru).filter((k) => k.startsWith('protect_gpc_'));

describe('locale strings of GPC', () => {
  it('ru and en have the same keys and placeholders; the brief keys exist', () => {
    expect(Object.keys(en).filter((k) => k.startsWith('protect_gpc_')).sort()).toEqual([...GPC_KEYS].sort());
    for (const key of GPC_KEYS) expect(Object.keys(en[key]!.placeholders ?? {}).sort(), key).toEqual(Object.keys(ru[key]!.placeholders ?? {}).sort());
    for (const key of [
      'protect_gpc_title', 'protect_gpc_desc', 'protect_gpc_rule_error', 'protect_gpc_visibility', 'protect_gpc_legal_title', ...GPC_LEGAL_KEYS,
      'protect_gpc_gaps', 'protect_gpc_site_on', 'protect_gpc_site_excluded', 'protect_gpc_site_exclude', 'protect_gpc_nav_observed',
      'protect_gpc_nav_not_observed', 'protect_gpc_nav_unknown', 'protect_gpc_counts', 'protect_gpc_reload_needed', 'protect_gpc_sent_note',
    ]) expect(ru[key], key).toBeDefined();
    expect(ru['protect_gpc_title']!.message).toBe('Сигнал Global Privacy Control (GPC)');
    expect(en['protect_gpc_site_exclude']!.message).toBe('Don’t send on this site (exclude the site from the module)');
  });

  it('no verdict about the site, no «the server received», no prototype wording', () => {
    const forbidden = [/нарушает/i, /игнорирует/i, /violates/i, /ignores/i, /сервер получил/i, /пытается отправить/i, /придерж/i, /соблюдает/i, /complies/i, /гарантир/i, /guarantee/i];
    for (const table of [ru, en]) for (const key of GPC_KEYS) for (const p of forbidden) expect(p.test(table[key]!.message), key + ' ' + String(p)).toBe(false);
    // «Добавлен к запросу» is the wording of the fact (Chrome's record of the outgoing request).
    expect(ru['protect_gpc_sent_note']!.message).toContain('данные Chrome об исходящем запросе');
    expect(ru['protect_gpc_nav_observed']!.message).toContain('по данным Chrome');
    // The English note is a negation of knowledge, never a claim of receipt.
    expect(en['protect_gpc_sent_note']!.message).toContain('does not know whether the server received');
  });
});

describe('parseGpcFact', () => {
  it('accepts exactly the contract shape', () => {
    expect(parseGpcFact(fact())).toEqual(fact());
    expect(parseGpcFact(null)).toBeNull();
    expect(parseGpcFact({ ...fact(), extra: 1 })).toBeNull();
    expect(parseGpcFact({ ...fact(), siteState: 'honoured' })).toBeNull();
    expect(parseGpcFact({ ...fact(), navigationHeader: 'received' })).toBeNull();
    expect(parseGpcFact({ ...fact(), requestsWithHeader: -1 })).toBeNull();
    expect(parseGpcFact({ ...fact(), site: 'https://shop.example/x' })).toBeNull();
    expect(parseGpcFact({ ...fact(), integrity: 'page-controlled' })).toBeNull();
  });
});

describe('Options section', () => {
  it('module off: hidden; feature off: says how to turn it on', () => {
    expect(gpcSectionView(state({ state: 'off', features: [] }))).toBeNull();
    const off = gpcSectionView(state({ features: ['value-match'] }))!;
    expect(off).toMatchObject({ enabled: false, ruleState: 'off', tone: 'muted' });
    expect(off.lines.map((m) => m.key)).toEqual(['protect_gpc_off']);
  });

  it('rule written, rule failed (with the restart hint), suspended; excluded sites are counted', () => {
    const ok = gpcSectionView(state({ excludedSites: ['a.example', 'b.example'] }))!;
    expect(ok.ruleState).toBe('written');
    expect(ok.lines.map((m) => text(m))).toEqual([ru['protect_gpc_rule_written']!.message, 'Сайтов-исключений модуля: 2. К запросам к ним и с их страниц сигнал не добавляется; встроенные в них кадры других сайтов могут его получать (не проверено).']);
    const failed = state({ state: 'degraded', degradedReasons: ['blocking-unavailable'] });
    expect(gpcRuleFailed(failed)).toBe(true);
    const err = gpcSectionView(failed)!;
    expect(err).toMatchObject({ ruleState: 'error', tone: 'attention' });
    expect(err.lines.map((m) => m.key)).toEqual(['protect_gpc_rule_error', 'protect_gpc_restart_hint']);
    expect(text(err.lines[1]!)).toContain('после перезапуска браузера');
    expect(text(err.lines[1]!, en)).toContain('after the browser restarts');
    const suspended = gpcSectionView(state({ state: 'needs-permission' }))!;
    expect(suspended.ruleState).toBe('suspended');
    expect(err.legal.map((m) => m.key)).toEqual([...GPC_LEGAL_KEYS]);
  });
});

describe('popup line', () => {
  it('on: the site line, the exclude button, the facts with the «added to the request» note', () => {
    const vm = gpcSiteLineView(state(), report(fact()))!;
    expect(text(vm.line!)).toBe('GPC: сигнал отправляется на shop.example');
    expect(vm).toMatchObject({ siteState: 'on', canExclude: true, tone: 'neutral', reload: null, ruleError: [], excludedHint: null });
    expect(vm.details.map((m) => m.key)).toEqual([GPC_NAV_KEYS.observed, 'protect_gpc_counts', 'protect_gpc_sent_note']);
    expect(text(vm.details[1]!)).toBe('Проверено запросов: с заголовком — 4, без заголовка — 0.');
    expect(text(vm.details[1]!, en)).toBe('Requests checked: 4 with the header, 0 without it.');
  });

  it('excluded: no button (the way back is in Options), a hint; reload note when the property is still set', () => {
    const vm = gpcSiteLineView(state({ excludedSites: ['shop.example'] }), report(fact({ siteState: 'excluded', reloadNeeded: true })))!;
    expect(vm).toMatchObject({ siteState: 'excluded', canExclude: false, tone: 'muted' });
    expect(text(vm.line!)).toBe('GPC: shop.example в исключениях модуля');
    expect(vm.excludedHint?.key).toBe('protect_gpc_excluded_hint');
    expect(vm.reload?.key).toBe('protect_gpc_reload_needed');
  });

  it('off (rule not applied): attention; rule error and restart hint only when Chrome did not apply the rules; lower bounds are said', () => {
    const offFact = fact({ siteState: 'off', navigationHeader: 'not-observed', requestsWithHeader: 0, requestsWithoutHeader: 3, countQuality: 'lower-bound' });
    const vm = gpcSiteLineView(state({ state: 'degraded', degradedReasons: ['blocking-unavailable'] }), report(offFact))!;
    expect(vm).toMatchObject({ siteState: 'off', tone: 'attention', canExclude: true });
    expect(text(vm.line!)).toBe('GPC: сейчас сигнал не отправляется на shop.example');
    expect(vm.ruleError.map((m) => m.key)).toEqual(['protect_gpc_rule_error', 'protect_gpc_restart_hint']);
    // A write still in flight (no degradation recorded): the line alone, no failure claim.
    expect(gpcSiteLineView(state(), report(offFact))!.ruleError).toEqual([]);
    expect(vm.details.map((m) => m.key)).toEqual([GPC_NAV_KEYS['not-observed'], 'protect_gpc_counts', 'protect_gpc_counts_lower_bound']);
  });

  it('hidden without a fact, without a site, on a page without access; feature off shows only a pending reload note', () => {
    expect(gpcSiteLineView(state(), null)).toBeNull();
    expect(gpcSiteLineView(state(), report(null))).toBeNull();
    expect(gpcSiteLineView(state(), report(fact({ site: null, siteState: 'no-access' })))).toBeNull();
    expect(gpcSiteLineView(state({ features: ['value-match'] }), report(fact({ siteState: 'off' })))).toBeNull();
    const reloadOnly = gpcSiteLineView(state({ features: ['value-match'] }), report(fact({ siteState: 'off', reloadNeeded: true })))!;
    expect(reloadOnly).toMatchObject({ line: null, canExclude: false, details: [] });
    expect(reloadOnly.reload?.key).toBe('protect_gpc_reload_needed');
    // A suspended module: no exclude action from the popup either.
    expect(gpcSiteLineView(state({ state: 'needs-permission' }), report(fact({ siteState: 'off', reloadNeeded: true })))?.canExclude).toBe(false);
  });

  it('unknown and not-applicable navigation facts have their own text, without the sent note', () => {
    for (const nav of ['unknown', 'not-applicable'] as const) {
      const vm = gpcSiteLineView(state(), report(fact({ navigationHeader: nav, requestsWithHeader: 0 })))!;
      expect(vm.details.map((m) => m.key)).toEqual([GPC_NAV_KEYS[nav]]);
    }
  });
});
