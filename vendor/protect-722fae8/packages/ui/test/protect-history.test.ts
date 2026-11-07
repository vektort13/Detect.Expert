// ADR-020 §G (S12): view model of the history «Кто вас узнаёт» — defensive readers, mechanism wording (no verdict),
// coverage lines (scope, truncation, storage, reset), export download = preview, and the locale keys the history
// components use (both locales, same placeholders, no forbidden wording).

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HistoryExport, HistoryMechanismSummary, HistoryProjection } from '@detect-expert/contracts';
import { serializeHistoryExport } from '../../export/src/protect-history';
import { resolveMessage } from '../src/view-models/message';
import {
  appendHistoryRows,
  formatHistoryDay,
  historyCoverageLines,
  historyEnabled,
  historyExportDownload,
  historyRowView,
  mechanismMessage,
  parseHistoryCard,
  parseHistoryExport,
  parseHistoryProjection,
} from '../src/view-models/protect-history';

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

const REQUESTS: HistoryMechanismSummary = { mechanism: 'requests-only', sites: 2, evidenceSource: 'browser-network', integrity: 'browser-observed', attributionConfidence: 'unknown', interpretationConfidence: 'unassessed' };

function projection(over: Partial<HistoryProjection> = {}): HistoryProjection {
  return {
    historyRevision: 3, retentionDays: 30, storage: 'ok', today: '2026-10-18', since: '2026-10-01', windowDays: 30,
    rows: [{ rowKey: 'd:tracker.net', domains: ['tracker.net'], vendorConfidence: 'none', sites: 2, days: 2, lastSeen: '2026-10-18', mechanisms: [REQUESTS] }],
    totalRows: 1, singleSiteReceivers: 4, sitesInWindow: 3, limitedSitesInWindow: 0, limitations: [],
    dropped: { pending: 0, evictedSightings: 0, evictedReceivers: 0, evictedSites: 0, unresolvedSite: 0, malformed: 0 }, ...over,
  };
}

describe('history view model: readers', () => {
  it('accepts a well-formed projection and rejects malformed ones', () => {
    expect(parseHistoryProjection({ type: 'protect-history', history: projection() })).not.toBeNull();
    expect(parseHistoryProjection({ type: 'protect-history', history: projection({ rows: [{ ...projection().rows[0]!, rowKey: 'https://x' }] }) })).toBeNull();
    expect(parseHistoryProjection({ type: 'protect-history', history: projection({ today: '2026-10-18T10:00' }) })).toBeNull();
    expect(parseHistoryProjection({ type: 'protect-history', history: { ...projection(), limitations: ['no-such-code'] } })).toBeNull();
    expect(parseHistoryProjection({ type: 'protect-history' })).toBeNull();
    expect(parseHistoryProjection(null)).toBeNull();
  });

  it('reads cards; a card that is null means «nothing in the window»', () => {
    const card = { rowKey: 'd:tracker.net', domains: ['tracker.net'], sites: [{ site: 'shop.com', days: 1, first: '2026-10-18', last: '2026-10-18' }], moreSites: 0, families: [], mechanisms: [REQUESTS] };
    expect(parseHistoryCard({ type: 'protect-history-receiver', card })).toEqual(card);
    expect(parseHistoryCard({ type: 'protect-history-receiver', card: null })).toBeNull();
    expect(parseHistoryCard({ type: 'protect-history-receiver', card: { ...card, sites: [{ site: 'https://shop.com/a?b' }] } })).toBeNull();
  });

  it('a redacted export must not carry a site name anywhere', () => {
    const preview: HistoryExport = {
      schemaVersion: 1, kind: 'detect-expert-history', redacted: true, sitesIncluded: false, exportedOn: '2026-10-18', retentionDays: 30, since: null,
      receivers: [{ rowKey: 'd:tracker.net', domains: ['tracker.net'], vendorConfidence: 'none', mechanisms: [REQUESTS], families: [], sites: [{ site: 'site-1', days: 1, first: '2026-10-18', last: '2026-10-18' }] }],
      sites: [{ site: 'site-1', days: 1, first: '2026-10-18', last: '2026-10-18', limited: false, families: [] }],
      limitations: [], dropped: projection().dropped, truncated: false,
    };
    expect(parseHistoryExport({ preview })).toEqual(preview);
    expect(parseHistoryExport({ preview: { ...preview, sites: [{ ...preview.sites[0]!, site: 'shop.com' }] } })).toBeNull();
    expect(parseHistoryExport({ preview: { ...preview, sitesIncluded: true, sites: [{ ...preview.sites[0]!, site: 'shop.com' }] } })).not.toBeNull();
    const download = historyExportDownload(preview);
    expect(download.text).toBe(serializeHistoryExport(preview));
    expect(download.fileName).toBe('detect-expert-history-2026-10-18.json');
  });

  it('history is shown only while the module is on with the history feature', () => {
    const base = { state: 'active', features: ['history'] } as never;
    expect(historyEnabled(base)).toBe(true);
    expect(historyEnabled({ state: 'active', features: ['value-match'] } as never)).toBe(false);
    expect(historyEnabled({ state: 'off', features: ['history'] } as never)).toBe(false);
    expect(historyEnabled(null)).toBe(false);
  });
});

describe('history view model: wording', () => {
  const tru = translate(ru);
  const ten = translate(en);

  it('mechanisms are possibilities with counts; requests-only says requests do not show linking', () => {
    expect(resolveMessage(tru, mechanismMessage({ ...REQUESTS, mechanism: 'value-match', sites: 3, interpretationConfidence: 'high' }))).toBe('Введённые вами данные (или их хэш) отправлялись ему на 3 сайтах (по данным Chrome)');
    expect(resolveMessage(ten, mechanismMessage({ ...REQUESTS, mechanism: 'value-match', sites: 3, interpretationConfidence: 'high' }))).toBe('Data you typed (or its hash) was sent to it on 3 sites (as reported by Chrome)');
    expect(resolveMessage(tru, mechanismMessage({ ...REQUESTS, mechanism: 'frame-techniques', families: ['canvas', 'network-patterns'], sites: 2 }))).toBe('В его встроенных фреймах вызывались API, пригодные для отпечатка: Canvas, сетевые шаблоны (локальная сеть, DNS) (сайтов: 2)');
    expect(resolveMessage(ten, mechanismMessage(REQUESTS))).toBe("Pages made requests to it (request attempts reported by Chrome; some may have been stopped by blocking rules, yours or another extension's). Requests alone do not show whether it links visits: server-side matching cannot be observed");
    expect(resolveMessage(tru, mechanismMessage(REQUESTS))).toBe('Страницы обращались к нему (попытки запросов по данным Chrome; часть могла быть остановлена правилами блокировки — вашими или другого расширения). По одним запросам нельзя установить, связывает ли он визиты: сопоставление на сервере не наблюдается');
    const row = historyRowView(projection().rows[0]!, 'ru');
    expect(resolveMessage(tru, row.sites)).toBe('Сайтов: 2');
    expect(row.domain).toBe('tracker.net');
    expect(row.domainOnly).toBe(true);
  });

  it('coverage lines: since (UTC days), scope other than all-sites, limited sites, truncation, storage, reset', () => {
    const keys = (p: HistoryProjection, scope: Parameters<typeof historyCoverageLines>[1]) => historyCoverageLines(p, scope, 'ru').map((l) => l.id);
    expect(keys(projection(), 'all-sites')).toEqual(['since']);
    expect(keys(projection(), 'site')).toEqual(['since', 'scope']);
    expect(keys(projection(), null)).toEqual(['since', 'scope']);
    expect(keys(projection({ limitedSitesInWindow: 2, limitations: ['history-truncated'], storage: 'degraded' }), 'all-sites')).toEqual(['since', 'limited', 'truncated', 'storage']);
    expect(keys(projection({ storage: 'reset', limitations: ['storage-reset'], since: null }), 'all-sites')).toEqual(['reset']);
    const since = historyCoverageLines(projection(), 'all-sites', 'ru')[0]!;
    expect(resolveMessage(tru, since.message)).toMatch(/^История ведётся с .*2026.* \(дни по UTC\), срок хранения — 30 дн\.$/);
  });

  it('days are formatted as UTC days (no time of day)', () => {
    expect(formatHistoryDay('2026-01-01', 'en')).toMatch(/2026/);
    expect(formatHistoryDay('2026-01-01', 'en')).not.toMatch(/:/);
    expect(formatHistoryDay('2026-01-01', 'en')).toMatch(/Jan/);
  });

  it('pages append without duplicates', () => {
    const a = projection().rows[0]!;
    const b = { ...a, rowKey: 'd:ads.net', domains: ['ads.net'] };
    expect(appendHistoryRows([a], [a, b]).map((r) => r.rowKey)).toEqual(['d:tracker.net', 'd:ads.net']);
  });
});

describe('history locale keys', () => {
  const dir = resolve('packages/ui/src/components/protect/history');
  const sources = readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n') + readFileSync(resolve('packages/ui/src/view-models/protect-history.ts'), 'utf8');
  const used = [...new Set([...sources.matchAll(/'((?:history|sensor_name|confidence|attribution|integrity|evidence|export|action|protect)_[a-z_]+)'/g)].map((m) => m[1]!))]
    .filter((k) => !k.endsWith('_'));

  it('every key used by the history UI exists in ru and en with the same placeholders', () => {
    expect(used.length).toBeGreaterThan(30);
    for (const key of used) {
      expect(ru[key], 'ru ' + key).toBeDefined();
      expect(en[key], 'en ' + key).toBeDefined();
      expect(Object.keys(en[key]!.placeholders ?? {}).sort(), key).toEqual(Object.keys(ru[key]!.placeholders ?? {}).sort());
    }
  });

  it('no verdict and no prototype wording in the history texts', () => {
    for (const table of [ru, en]) {
      for (const [key, entry] of Object.entries(table)) {
        if (!key.startsWith('history_')) continue;
        expect(entry.message, key).not.toMatch(/пытается отправить|придерживает|узнал(?:и)? вас|вас узнают|следит за вами|ворует|опасн|вредон|recognized you|tracks you|steal|dangerous|malicious/i);
      }
    }
    expect(ru['history_intro']?.message).toContain('само по себе ещё не значит, что вас узнали');
    expect(en['history_intro']?.message).toContain('not recognition by itself');
  });

  it('ADR-020 §11 (review round 2): no history text claims receipt; requests are attempts, value-match is «sent» per Chrome', () => {
    for (const table of [ru, en]) {
      for (const [key, entry] of Object.entries(table)) {
        if (!key.startsWith('history_')) continue;
        expect(entry.message, key).not.toMatch(/получал|получил|сервер получ|не получит|received|\breceives?\b|will not receive|held/i);
      }
    }
    // The `request` signal is an onBeforeRequest attempt (a DNR-stopped request is one too, SP-2): never «sent».
    expect(ru['history_mech_requests']?.message).not.toMatch(/отправ/i);
    expect(en['history_mech_requests']?.message).not.toMatch(/\bsent\b|\bsend/i);
    expect(ru['history_mech_requests']?.message).toContain('попытки запросов по данным Chrome');
    expect(en['history_mech_requests']?.message).toContain('request attempts reported by Chrome');
    expect(ru['history_mech_value_match']?.message).toContain('(по данным Chrome)');
    expect(en['history_mech_value_match']?.message).toContain('(as reported by Chrome)');
  });
});
