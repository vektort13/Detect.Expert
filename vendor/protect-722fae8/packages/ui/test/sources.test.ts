// S08 / E10-01 / ADR-018 / CLM-06: «Источники» view model and the third-party count rules (FOLLOWUPS item 4).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BUDGETS, HOST_CATEGORIES, SITE_RELATIONS } from '@detect-expert/contracts';
import type { HostEntry, ReportProjection } from '@detect-expert/contracts';
import { countsView, hostsOf, isHostEntryLike, thirdPartyHosts } from '../src/view-models/counts';
import { filterSourceRows, hostCategoryKey, relationKey, sourceLabel, sourcesEmptyKey, sourcesNoteKey, sourcesPausedKey, sourcesView } from '../src/view-models/sources';
import { report } from './fixtures';

function host(overrides: Partial<HostEntry>): HostEntry {
  return {
    relation: 'cross-site',
    evidenceSource: 'browser-network',
    integrity: 'browser-observed',
    requestCount: 2,
    firstSeenBucket: 0,
    lastSeenBucket: 1,
    ruleIds: [],
    ...overrides,
  };
}

const translate = (key: string, subs?: ReadonlyArray<string>): string =>
  key === 'host_category_loopback' ? 'loopback address of this device' : subs === undefined ? key : key + '[' + subs.join(',') + ']';

describe('isHostEntryLike (FOLLOWUPS item 4)', () => {
  it('accepts exactly one of registrableDomain / category with a known relation and a finite count', () => {
    expect(isHostEntryLike(host({ registrableDomain: 'example.net' }))).toBe(true);
    for (const category of HOST_CATEGORIES) expect(isHostEntryLike(host({ category })), category).toBe(true);
    for (const relation of SITE_RELATIONS) expect(isHostEntryLike(host({ category: 'loopback', relation })), relation).toBe(true);
  });

  it('rejects both fields, no field, unknown category or relation, unsanitized domains and non-finite counts', () => {
    const bad: unknown[] = [
      host({ registrableDomain: 'example.net', category: 'loopback' }),
      host({}),
      { ...host({}), category: 'intranet' },
      { ...host({ registrableDomain: 'example.net' }), relation: 'third-party' },
      { ...host({ registrableDomain: 'example.net' }), relation: undefined },
      host({ registrableDomain: 'https://example.net/path?q=1' }),
      host({ registrableDomain: 'not a host' }),
      host({ registrableDomain: 'example.net', requestCount: Number.NaN }),
      { ...host({ registrableDomain: 'example.net' }), requestCount: '3' },
      null,
      'example.net',
    ];
    for (const value of bad) expect(isHostEntryLike(value), JSON.stringify(value)).toBe(false);
  });

  it('hostsOf keeps valid entries in order and is bounded by maxHostsPerDocument', () => {
    const many = Array.from({ length: BUDGETS.maxHostsPerDocument + 5 }, (_, i) => host({ registrableDomain: 'h' + String(i) + '.example' }));
    expect(hostsOf(report({ hosts: many }))).toHaveLength(BUDGETS.maxHostsPerDocument);
    const mixed = report({ hosts: [host({ category: 'loopback', relation: 'same-site' }), { bogus: true } as unknown as HostEntry, host({ registrableDomain: 'example.net' })] });
    expect(hostsOf(mixed).map((entry) => entry.registrableDomain ?? entry.category)).toEqual(['loopback', 'example.net']);
  });
});

describe('third-party count rules (S08 table)', () => {
  const thirdOnly = [host({ registrableDomain: 'example.net' }), host({ category: 'private', relation: 'opaque' }), host({ category: 'unknown', relation: 'unknown' })];
  const sameOnly = [host({ category: 'loopback', relation: 'same-origin' }), host({ registrableDomain: 'example.com', relation: 'same-site' })];

  it('third party = relation outside {same-origin, same-site}', () => {
    const rep = report({ hosts: [...thirdOnly, ...sameOnly] });
    expect(thirdPartyHosts(rep)).toHaveLength(3);
  });

  it('no hosts field -> null / unavailable', () => {
    const { hosts: _hosts, ...legacy } = report();
    expect(countsView(legacy as ReportProjection, true)).toMatchObject({ thirdParty: null, thirdPartyNote: 'unavailable' });
    expect(countsView(null)).toMatchObject({ thirdParty: null, thirdPartyNote: 'unavailable' });
  });

  it('network-limited and n = 0 -> null / limited (never an exact zero)', () => {
    const vm = countsView(report({ coverageFlags: ['network-limited'], hosts: sameOnly }), true);
    expect(vm).toMatchObject({ thirdParty: null, thirdPartyNote: 'limited' });
  });

  it('network-limited and n > 0 -> n / lower-bound', () => {
    const vm = countsView(report({ coverageFlags: ['network-limited'], hosts: [...sameOnly, thirdOnly[0]!] }), true);
    expect(vm).toMatchObject({ thirdParty: 1, thirdPartyQuality: 'lower-bound', thirdPartyNote: null });
  });

  it('dropped hosts -> n / lower-bound', () => {
    const rep = report({ hosts: thirdOnly });
    const vm = countsView({ ...rep, dropped: { ...rep.dropped, hosts: 4 } }, true);
    expect(vm).toMatchObject({ thirdParty: 3, thirdPartyQuality: 'lower-bound', thirdPartyNote: null });
  });

  it('otherwise -> n / exact, including an observed zero with the full network scope', () => {
    expect(countsView(report({ hosts: thirdOnly }), true)).toMatchObject({ thirdParty: 3, thirdPartyQuality: 'exact', thirdPartyNote: null });
    expect(countsView(report({ hosts: sameOnly }), true)).toMatchObject({ thirdParty: 0, thirdPartyQuality: 'exact', thirdPartyNote: null });
  });
});

describe('sourcesView', () => {
  it('splits rows into other sites/addresses and the same site, keeping the projection order', () => {
    const vm = sourcesView(report({
      coverageFlags: ['network-limited'],
      hosts: [
        host({ registrableDomain: 'example.net', requestCount: 3 }),
        host({ category: 'ULA', relation: 'unknown', requestCount: 1 }),
        host({ category: 'loopback', relation: 'same-origin', requestCount: 5 }),
        host({ registrableDomain: 'example.com', relation: 'same-site', requestCount: 2 }),
      ],
    }));
    expect(vm.known).toBe(true);
    expect(vm.limited).toBe(true);
    expect(vm.dropped).toBe(0);
    expect(vm.thirdParty.map((row) => [row.name, row.categoryKey, row.relationKey, row.requests])).toEqual([
      ['example.net', null, 'relation_cross_site', 3],
      [null, 'host_category_ula', 'relation_unknown', 1],
    ]);
    expect(vm.sameSite.map((row) => [row.name, row.categoryKey, row.relationKey, row.requests])).toEqual([
      [null, 'host_category_loopback', 'relation_same_origin', 5],
      ['example.com', null, 'relation_same_site', 2],
    ]);
    expect(new Set([...vm.thirdParty, ...vm.sameSite].map((row) => row.id)).size).toBe(4);
  });

  it('distinguishes no host list from an empty one and reports dropped destinations', () => {
    const { hosts: _hosts, ...legacy } = report();
    expect(sourcesView(legacy as ReportProjection)).toMatchObject({ known: false, thirdParty: [], sameSite: [] });
    expect(sourcesView(null)).toMatchObject({ known: false, limited: false, dropped: 0 });
    const empty = report();
    expect(sourcesView(empty)).toMatchObject({ known: true, limited: false, thirdParty: [], sameSite: [] });
    expect(sourcesView({ ...empty, dropped: { ...empty.dropped, hosts: 7 } }).dropped).toBe(7);
  });

  it('keys: host_category_<code> with "-" -> "_" and ULA -> ula; relation_<code>', () => {
    expect(HOST_CATEGORIES.map(hostCategoryKey)).toEqual([
      'host_category_loopback',
      'host_category_link_local',
      'host_category_private',
      'host_category_ula',
      'host_category_public',
      'host_category_localhost',
      'host_category_local',
      'host_category_single_label',
      'host_category_unknown',
    ]);
    expect(SITE_RELATIONS.map(relationKey)).toEqual(['relation_same_origin', 'relation_same_site', 'relation_cross_site', 'relation_opaque', 'relation_unknown']);
  });

  it('search matches the localized name of a category and the domain, case-insensitively', () => {
    const vm = sourcesView(report({ hosts: [host({ registrableDomain: 'example.net' }), host({ category: 'loopback', relation: 'same-site' })] }));
    const rows = [...vm.thirdParty, ...vm.sameSite];
    expect(sourceLabel(rows[1]!, translate)).toBe('loopback address of this device');
    expect(filterSourceRows(rows, 'DEVICE', translate).map((row) => row.categoryKey)).toEqual(['host_category_loopback']);
    expect(filterSourceRows(rows, ' Example.NET ', translate).map((row) => row.name)).toEqual(['example.net']);
    expect(filterSourceRows(rows, '', translate)).toHaveLength(2);
    expect(filterSourceRows(rows, 'cross', translate)).toEqual([]);
  });

  it('rows carry no address, port, path or label beyond the projected domain/category', () => {
    const vm = sourcesView(report({ hosts: [host({ registrableDomain: 'example.net' }), host({ category: 'private' })] }));
    const text = JSON.stringify(vm);
    for (const forbidden of ['://', '192.168', ':4174', '?', '#']) expect(text).not.toContain(forbidden);
  });
});

describe('CW-02: an unobserved network never reads as "Chrome registered no requests"', () => {
  const locales = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'apps', 'extension', '_locales');
  const load = (locale: string) => JSON.parse(readFileSync(join(locales, locale, 'messages.json'), 'utf8')) as Record<string, { message: string }>;

  it('active-tab with an empty host list: active-tab note and sources_none, never sources_empty', () => {
    const vm = sourcesView(report({ scopeMode: 'active-tab', coverageState: 'late-start', coverageFlags: ['late-start', 'network-limited'], hosts: [] }));
    expect(vm).toMatchObject({ known: true, limited: true, unobserved: 'active-tab', thirdParty: [], sameSite: [] });
    expect(sourcesNoteKey(vm)).toBe('sources_active_tab_unobserved');
    expect(sourcesEmptyKey(vm)).toBe('sources_none');
  });

  it('active-tab with rows: the rows are shown under the active-tab note (the list may be incomplete)', () => {
    const vm = sourcesView(report({ scopeMode: 'active-tab', coverageFlags: ['network-limited'], hosts: [host({ category: 'loopback', relation: 'same-origin' })] }));
    expect(vm.unobserved).toBe('active-tab');
    expect(sourcesNoteKey(vm)).toBe('sources_active_tab_unobserved');
    expect(sourcesEmptyKey(vm)).toBeNull();
    expect(vm.sameSite).toHaveLength(1);
  });

  it('mode off or a revoked document: sources_no_access and sources_none', () => {
    for (const rep of [
      report({ scopeMode: 'off', coverageState: 'no-access', coverageFlags: ['no-host-permission'], hosts: [] }),
      report({ scopeMode: 'site', coverageState: 'no-access', coverageFlags: ['revoked'], hosts: [] }),
      report({ scopeMode: 'all-sites', coverageState: 'no-access', coverageFlags: ['revoked'], hosts: [] }),
    ]) {
      const vm = sourcesView(rep);
      expect(vm.unobserved, rep.scopeMode).toBe('no-access');
      expect(sourcesNoteKey(vm)).toBe('sources_no_access');
      expect(sourcesEmptyKey(vm)).toBe('sources_none');
    }
  });

  it('site / all-sites with an observed network: an empty list stays sources_empty under the scope or limited note', () => {
    const site = sourcesView(report({ scopeMode: 'site', coverageState: 'partial', coverageFlags: ['network-limited'], hosts: [] }));
    expect(site.unobserved).toBeNull();
    expect(sourcesNoteKey(site)).toBe('sources_network_limited');
    expect(sourcesEmptyKey(site)).toBe('sources_empty');
    const all = sourcesView(report({ scopeMode: 'all-sites', hosts: [] }));
    expect(sourcesNoteKey(all)).toBe('sources_network_scope');
    expect(sourcesEmptyKey(all)).toBe('sources_empty');
    expect(sourcesEmptyKey(sourcesView(null))).toBe('sources_none');
    const { hosts: _hosts, ...legacy } = report({ scopeMode: 'site' });
    expect(sourcesEmptyKey(sourcesView(legacy as ReportProjection))).toBe('sources_none');
  });

  it('the new keys exist in ru and en; mode_active_tab_desc says the network is not observed', () => {
    const ru = load('ru');
    const en = load('en');
    for (const key of ['sources_active_tab_unobserved', 'sources_no_access']) {
      expect(ru[key]?.message, key).toBeTruthy();
      expect(en[key]?.message, key).toBeTruthy();
    }
    expect(ru['sources_active_tab_unobserved']!.message).toContain('не означает, что запросов не было');
    expect(ru['mode_active_tab_desc']!.message).toContain('Сеть в этом режиме не наблюдается');
    expect(en['mode_active_tab_desc']!.message).toContain('The network is not observed in this mode');
  });
});

describe('CW-05: a pause leaves network counts incomplete', () => {
  it('a paused (or resumed) report gets the paused-gap note; an empty list is sources_none, never sources_empty', () => {
    const resumed = sourcesView(report({ scopeMode: 'all-sites', coverageState: 'active', coverageFlags: ['paused'], hosts: [host({ registrableDomain: 'other.net', requestCount: 5 })] }));
    expect(resumed.pausedGap).toBe(true);
    expect(sourcesNoteKey(resumed)).toBe('sources_network_scope');
    expect(sourcesPausedKey(resumed)).toBe('sources_paused_gap');
    const pausedEmpty = sourcesView(report({ scopeMode: 'site', coverageState: 'paused', coverageFlags: ['network-limited', 'paused'], hosts: [] }));
    expect(sourcesEmptyKey(pausedEmpty)).toBe('sources_none');
    // Never paused: no note, and an empty observed list keeps sources_empty.
    const plain = sourcesView(report({ scopeMode: 'all-sites', hosts: [] }));
    expect(plain.pausedGap).toBe(false);
    expect(sourcesPausedKey(plain)).toBeNull();
    expect(sourcesEmptyKey(plain)).toBe('sources_empty');
    // Where the network is not observed at all, the no-access / active-tab note already covers it.
    expect(sourcesPausedKey(sourcesView(report({ scopeMode: 'active-tab', coverageFlags: ['paused'], hosts: [] })))).toBeNull();
    expect(sourcesPausedKey(sourcesView(null))).toBeNull();
  });
});
