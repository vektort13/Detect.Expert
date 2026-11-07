// ADR-020 §G, REQ-013 (S12): the history export is an explicit allowlist, redacts sites to site-N by default (same
// numbering with names), keeps days only, is deterministic, valid against history-export.v1.schema.json and bounded
// by maxExportBytes with `truncated`. The file text is exactly serializeHistoryExport(preview).

import { describe, expect, it } from 'vitest';
import { HISTORY_EXPORT_SITE_REF_PATTERN } from '@detect-expert/contracts';
import type { HistoryDropped, HistoryMechanismSummary } from '@detect-expert/contracts';
import { compileSchema } from '../../contracts/test/helpers';
import { createHistoryExport, historyExportFileName, serializeHistoryExport } from '../src/protect-history';
import type { HistoryExportInput, HistoryExportOptions } from '../src/protect-history';

const DROPPED: HistoryDropped = { pending: 1, evictedSightings: 0, evictedReceivers: 0, evictedSites: 0, unresolvedSite: 2, malformed: 0 };
const REQUESTS: HistoryMechanismSummary = { mechanism: 'requests-only', sites: 2, evidenceSource: 'browser-network', integrity: 'browser-observed', attributionConfidence: 'unknown', interpretationConfidence: 'unassessed' };

function input(): HistoryExportInput {
  return {
    receivers: [
      {
        rowKey: 'd:tracker.net',
        domains: ['tracker.net'],
        vendorConfidence: 'none',
        mechanisms: [
          { ...REQUESTS },
          { mechanism: 'frame-techniques', sites: 1, families: ['webgl', 'canvas'], interpretation: 'api-use', evidenceSource: 'page-hook', integrity: 'page-controlled', attributionConfidence: 'frame-only', interpretationConfidence: 'low' },
        ],
        families: [{ family: 'canvas', days: 1, sites: 1, interpretation: 'api-use', attributionConfidence: 'frame-only' }],
        sites: [
          { site: 'shop.com', days: 2, first: '2026-10-10', last: '2026-10-18' },
          { site: 'news.org', days: 1, first: '2026-10-01', last: '2026-10-01' },
        ],
      },
    ],
    sites: [
      { site: 'shop.com', days: 3, first: '2026-10-10', last: '2026-10-18', limited: true, families: ['webgl', 'canvas'] },
      { site: 'news.org', days: 1, first: '2026-10-01', last: '2026-10-01', limited: false, families: [] },
    ],
  };
}

function options(over: Partial<HistoryExportOptions> = {}): HistoryExportOptions {
  return { includeSites: false, exportedOn: '2026-10-18', retentionDays: 30, since: '2026-10-01', limitations: ['history-truncated', 'attribution-frame-only'], dropped: DROPPED, ...over };
}

describe('history export', () => {
  const validate = compileSchema('history-export.v1.schema.json');

  it('redacts sites to site-N by default: numbered by first day, the same reference everywhere', () => {
    const preview = createHistoryExport(input(), options());
    expect(validate(preview)).toBe(true);
    expect(preview.sitesIncluded).toBe(false);
    expect(preview.redacted).toBe(true);
    expect(preview.sites.map((s) => s.site)).toEqual(['site-2', 'site-1']);
    expect(preview.receivers[0]!.sites.map((s) => s.site)).toEqual(['site-2', 'site-1']);
    for (const s of preview.sites) expect(s.site).toMatch(HISTORY_EXPORT_SITE_REF_PATTERN);
    const text = serializeHistoryExport(preview);
    expect(text).not.toContain('shop.com');
    expect(text).not.toContain('news.org');
    expect(text).toContain('tracker.net');
  });

  it('includes site names only when asked; everything else is identical', () => {
    const named = createHistoryExport(input(), options({ includeSites: true }));
    expect(validate(named)).toBe(true);
    expect(named.sites.map((s) => s.site)).toEqual(['shop.com', 'news.org']);
    const redacted = createHistoryExport(input(), options());
    expect({ ...named, sitesIncluded: false, sites: [], receivers: [] }).toEqual({ ...redacted, sites: [], receivers: [] });
  });

  it('copies fields by allowlist: unknown fields of the input never reach the file', () => {
    const raw = input() as unknown as { receivers: Array<Record<string, unknown>>; sites: Array<Record<string, unknown>> };
    raw.receivers[0]!['url'] = 'https://tracker.net/collect?id=CANARY';
    (raw.receivers[0]!['sites'] as Array<Record<string, unknown>>)[0]!['path'] = '/secret';
    (raw.receivers[0]!['mechanisms'] as Array<Record<string, unknown>>)[0]!['value'] = 'CANARY-EMAIL';
    raw.sites[0]!['query'] = 'q=CANARY';
    const preview = createHistoryExport(raw as unknown as HistoryExportInput, options());
    const text = serializeHistoryExport(preview);
    expect(text).not.toMatch(/CANARY|secret|https?:|"url"|"path"|"query"|"value"/);
    expect(validate(preview)).toBe(true);
  });

  it('is deterministic: the same input gives byte-identical files; families and mechanisms in canonical order', () => {
    const a = serializeHistoryExport(createHistoryExport(input(), options()));
    const b = serializeHistoryExport(createHistoryExport(input(), options()));
    expect(a).toBe(b);
    const preview = createHistoryExport(input(), options());
    expect(preview.sites[0]!.families).toEqual(['canvas', 'webgl']);
    expect(preview.receivers[0]!.mechanisms.map((m) => m.mechanism)).toEqual(['frame-techniques', 'requests-only']);
    expect(preview.receivers[0]!.mechanisms[0]!.families).toEqual(['canvas', 'webgl']);
    expect(preview.limitations).toEqual(['attribution-frame-only', 'history-truncated']);
    expect(text(preview)).toMatch(/"exportedOn": "2026-10-18"/);
    expect(text(preview)).not.toMatch(/T\d\d:\d\d/);
  });

  it('cuts receivers (then sites) beyond maxExportBytes and says so', () => {
    const big: HistoryExportInput = { receivers: [], sites: [] };
    for (let i = 0; i < 300; i++) {
      (big.receivers as HistoryExportInput['receivers'][number][]).push({
        rowKey: 'd:r' + String(i) + '.net', domains: ['r' + String(i) + '.net'], vendorConfidence: 'none', mechanisms: [{ ...REQUESTS }], families: [],
        sites: Array.from({ length: 10 }, (_, j) => ({ site: 's' + String(j) + '.com', days: 1, first: '2026-10-18', last: '2026-10-18' })),
      });
    }
    for (let j = 0; j < 10; j++) (big.sites as HistoryExportInput['sites'][number][]).push({ site: 's' + String(j) + '.com', days: 1, first: '2026-10-18', last: '2026-10-18', limited: false, families: [] });
    const full = createHistoryExport(big, options());
    expect(full.truncated).toBe(false);
    const fullBytes = serializeHistoryExport(full).length;
    const cut = createHistoryExport(big, options({ maxBytes: Math.floor(fullBytes / 3) }));
    expect(cut.truncated).toBe(true);
    expect(cut.receivers.length).toBeLessThan(300);
    expect(cut.receivers.length).toBeGreaterThan(0);
    expect(serializeHistoryExport(cut).length).toBeLessThanOrEqual(Math.floor(fullBytes / 3));
    expect(validate(cut)).toBe(true);
  });

  it('file name has the day only', () => {
    expect(historyExportFileName({ exportedOn: '2026-10-18', sitesIncluded: false })).toBe('detect-expert-history-2026-10-18.json');
    expect(historyExportFileName({ exportedOn: '2026-10-18', sitesIncluded: true })).toBe('detect-expert-history-2026-10-18-sites.json');
  });
});

function text(preview: ReturnType<typeof createHistoryExport>): string {
  return serializeHistoryExport(preview);
}
