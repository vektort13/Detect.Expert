// ADR-020 §G (S12): linking mechanisms and ranking of the «Кто вас узнаёт» history.

import { describe, expect, it } from 'vitest';
import { PROTECT_BUDGETS } from '@detect-expert/contracts';
import type { HistoryFamily, Interpretation } from '@detect-expert/contracts';
import { historyMechanisms } from '../src/protect/history/mechanisms';
import { applySightingDelta, applySiteDelta } from '../src/protect/history/merge';
import { historyExportData, historyReceiverCard, historyWindow, rankHistory } from '../src/protect/history/rank';
import { HISTORY_SIGNAL_BITS } from '../src/protect/history/records';
import type { HistorySightingDelta, HistorySightingRecord, HistorySiteRecord, HistoryValueStrength } from '../src/protect/history/records';

const D = 20_000;
const W = { from: D - 29, to: D };

function sighting(receiver: string, site: string, parts: Array<{ day?: number; signals: number; families?: Partial<Record<HistoryFamily, Interpretation>>; valueStrength?: HistoryValueStrength }>): HistorySightingRecord {
  let rec: HistorySightingRecord | undefined;
  for (const p of parts) {
    const d: HistorySightingDelta = { receiver, site, day: p.day ?? D, signals: p.signals };
    if (p.families !== undefined) d.families = p.families;
    if (p.valueStrength !== undefined) d.valueStrength = p.valueStrength;
    rec = applySightingDelta(rec, d);
  }
  return rec!;
}

const REQ = HISTORY_SIGNAL_BITS.request;
const VM = HISTORY_SIGNAL_BITS['value-match'];
const FRAME = HISTORY_SIGNAL_BITS.frame;

describe('history mechanisms', () => {
  it('requests only → requests-only, unassessed, browser-observed', () => {
    const m = historyMechanisms([sighting('t.example', 'a.example', [{ signals: REQ }]), sighting('t.example', 'b.example', [{ signals: REQ }])], W);
    expect(m).toEqual([{ mechanism: 'requests-only', sites: 2, evidenceSource: 'browser-network', integrity: 'browser-observed', attributionConfidence: 'unknown', interpretationConfidence: 'unassessed' }]);
  });

  it('attempts-only receiver (request attempts + our blocks, no reported send) → requests-only only (review round 2)', () => {
    // Observation hosts are onBeforeRequest attempts; a DNR-stopped request is one too (SP-2). Blocks never add a
    // mechanism and never turn attempts into value-match.
    const BLOCKED = HISTORY_SIGNAL_BITS['request-blocked'];
    const m = historyMechanisms([
      sighting('t.example', 'a.example', [{ signals: REQ | BLOCKED }]),
      sighting('t.example', 'b.example', [{ signals: REQ }, { day: D - 1, signals: BLOCKED }]),
      sighting('t.example', 'c.example', [{ signals: BLOCKED }]),
    ], W);
    expect(m).toEqual([{ mechanism: 'requests-only', sites: 2, evidenceSource: 'browser-network', integrity: 'browser-observed', attributionConfidence: 'unknown', interpretationConfidence: 'unassessed' }]);
    // Blocked-only sightings show no mechanism at all.
    expect(historyMechanisms([sighting('t.example', 'c.example', [{ signals: BLOCKED }]), sighting('t.example', 'd.example', [{ signals: BLOCKED }])], W)).toEqual([]);
  });

  it('value-match needs two sites; high only for a hash of an e-mail or phone', () => {
    const one = historyMechanisms([sighting('t.example', 'a.example', [{ signals: VM | REQ, valueStrength: 'hash' }])], W);
    expect(one.map((x) => x.mechanism)).toEqual(['requests-only']);
    const plain = historyMechanisms([sighting('t.example', 'a.example', [{ signals: VM, valueStrength: 'plain' }]), sighting('t.example', 'b.example', [{ signals: VM, valueStrength: 'plain' }])], W);
    expect(plain[0]).toMatchObject({ mechanism: 'value-match', sites: 2, interpretationConfidence: 'medium', integrity: 'derived' });
    const hash = historyMechanisms([sighting('t.example', 'a.example', [{ signals: VM, valueStrength: 'hash' }]), sighting('t.example', 'b.example', [{ signals: VM, valueStrength: 'plain' }])], W);
    expect(hash[0]).toMatchObject({ mechanism: 'value-match', interpretationConfidence: 'high' });
  });

  it('frame techniques: families of the receiver frames, frame-only and page-controlled', () => {
    const m = historyMechanisms([
      sighting('w.example', 'a.example', [{ signals: FRAME, families: { canvas: 'possible-fingerprinting' } }]),
      sighting('w.example', 'b.example', [{ signals: FRAME, families: { webgl: 'api-use', canvas: 'api-use' } }]),
    ], W);
    expect(m).toEqual([{
      mechanism: 'frame-techniques', sites: 2, families: ['canvas', 'webgl'], interpretation: 'possible-fingerprinting',
      evidenceSource: 'page-hook', integrity: 'page-controlled', attributionConfidence: 'frame-only', interpretationConfidence: 'low',
    }]);
  });

  it('replay-pattern is low; signals outside the window do not count', () => {
    const m = historyMechanisms([sighting('r.example', 'a.example', [{ signals: HISTORY_SIGNAL_BITS['replay-pattern'] }, { day: D - 50, signals: VM }])], W);
    expect(m.map((x) => [x.mechanism, x.interpretationConfidence])).toEqual([['replay-pattern', 'low']]);
  });
});

describe('history ranking', () => {
  const sightings = [
    sighting('one.example', 'a.example', [{ signals: REQ }]),
    sighting('two.example', 'a.example', [{ signals: REQ, day: D - 3 }]),
    sighting('two.example', 'b.example', [{ signals: REQ, day: D - 2 }]),
    sighting('vm.example', 'a.example', [{ signals: VM, valueStrength: 'hash' }]),
    sighting('vm.example', 'b.example', [{ signals: VM, valueStrength: 'plain' }]),
    sighting('three.example', 'a.example', [{ signals: REQ, day: D - 10 }]),
    sighting('three.example', 'b.example', [{ signals: REQ, day: D - 10 }]),
    sighting('three.example', 'c.example', [{ signals: REQ, day: D - 10 }]),
    sighting('old.example', 'a.example', [{ signals: REQ, day: D - 60 }]),
    sighting('old.example', 'b.example', [{ signals: REQ, day: D - 61 }]),
  ];
  const sites: HistorySiteRecord[] = [
    applySiteDelta(undefined, { site: 'a.example', day: D, limited: true, families: ['canvas'] }),
    applySiteDelta(undefined, { site: 'b.example', day: D - 2, limited: false }),
    applySiteDelta(undefined, { site: 'c.example', day: D - 10, limited: false }),
    applySiteDelta(undefined, { site: 'z.example', day: D - 70, limited: false }),
  ];

  it('sorts by sites ↓, confidence ↓, last seen ↓, row key ↑; minSites 2 by default', () => {
    const r = rankHistory(sightings, sites, { today: D, retentionDays: 30, windowDays: 30, offset: 0, limit: 50 });
    expect(r.rows.map((x) => x.rowKey)).toEqual(['d:three.example', 'd:vm.example', 'd:two.example']);
    expect(r.totalRows).toBe(3);
    expect(r.singleSiteReceivers).toBe(1);
    expect(r.sitesInWindow).toBe(3);
    expect(r.limitedSitesInWindow).toBe(1);
    const vm = r.rows[1]!;
    expect(vm).toMatchObject({ domains: ['vm.example'], vendorConfidence: 'none', sites: 2, days: 1, lastSeen: '2024-10-04' });
    expect(vm.vendorId).toBeUndefined();
  });

  it('filters: minSites 1, mechanisms only, domain substring, site; 90-day window limited by the retention', () => {
    expect(rankHistory(sightings, sites, { today: D, retentionDays: 30, windowDays: 30, offset: 0, limit: 50, minSites: 1 }).totalRows).toBe(4);
    expect(rankHistory(sightings, sites, { today: D, retentionDays: 30, windowDays: 30, offset: 0, limit: 50, mechanismsOnly: true }).rows.map((x) => x.rowKey)).toEqual(['d:vm.example']);
    expect(rankHistory(sightings, sites, { today: D, retentionDays: 30, windowDays: 30, offset: 0, limit: 50, domainFilter: 'thr' }).rows.map((x) => x.rowKey)).toEqual(['d:three.example']);
    const onSite = rankHistory(sightings, sites, { today: D, retentionDays: 30, windowDays: 30, offset: 0, limit: 50, site: 'c.example' });
    expect(onSite.rows.map((x) => x.rowKey)).toEqual(['d:three.example']);
    expect(onSite.site).toEqual({ site: 'c.example', receivers: [{ rowKey: 'd:three.example', sites: 3 }], unattributedFamilies: [] });
    expect(rankHistory(sightings, sites, { today: D, retentionDays: 30, windowDays: 30, offset: 0, limit: 50, site: 'a.example' }).site?.unattributedFamilies).toEqual(['canvas']);
    expect(historyWindow(D, 90, 30)).toEqual({ from: D - 29, to: D });
    expect(rankHistory(sightings, sites, { today: D, retentionDays: 90, windowDays: 90, offset: 0, limit: 50 }).rows.map((x) => x.rowKey)).toContain('d:old.example');
  });

  it('pages of at most maxRowsPerPage', () => {
    const many: HistorySightingRecord[] = [];
    for (let i = 0; i < 120; i++) for (const site of ['a.example', 'b.example']) many.push(sighting('r' + String(i) + '.example', site, [{ signals: REQ }]));
    const first = rankHistory(many, [], { today: D, retentionDays: 30, windowDays: 30, offset: 0, limit: 500 });
    expect(first.rows).toHaveLength(PROTECT_BUDGETS.maxRowsPerPage);
    expect(first.totalRows).toBe(120);
    const last = rankHistory(many, [], { today: D, retentionDays: 30, windowDays: 30, offset: 100, limit: 50 });
    expect(last.rows).toHaveLength(20);
    expect(new Set([...first.rows, ...last.rows].map((x) => x.rowKey)).size).toBe(70);
  });

  it('receiver card: site lines (newest first), families, mechanisms; ≤ maxCardSites', () => {
    const card = historyReceiverCard(sightings, 'd:two.example', { today: D, retentionDays: 30, windowDays: 30 })!;
    expect(card.sites).toEqual([
      { site: 'b.example', days: 1, first: '2024-10-02', last: '2024-10-02' },
      { site: 'a.example', days: 1, first: '2024-10-01', last: '2024-10-01' },
    ]);
    expect(card.moreSites).toBe(0);
    expect(historyReceiverCard(sightings, 'd:absent.example', { today: D, retentionDays: 30, windowDays: 30 })).toBeNull();
    const wide: HistorySightingRecord[] = [];
    for (let i = 0; i < PROTECT_BUDGETS.maxCardSites + 5; i++) wide.push(sighting('wide.example', 's' + String(i) + '.example', [{ signals: FRAME, families: { audio: 'api-use' } }]));
    const big = historyReceiverCard(wide, 'd:wide.example', { today: D, retentionDays: 30, windowDays: 30 })!;
    expect(big.sites).toHaveLength(PROTECT_BUDGETS.maxCardSites);
    expect(big.moreSites).toBe(5);
    expect(big.families).toEqual([{ family: 'audio', days: 1, sites: PROTECT_BUDGETS.maxCardSites + 5, interpretation: 'api-use', attributionConfidence: 'frame-only' }]);
  });

  it('export data: every row in rank order, sites ordered by first day', () => {
    const data = historyExportData(sightings, sites, { today: D, retentionDays: 30 });
    expect(data.receivers.map((x) => x.rowKey)).toEqual(['d:three.example', 'd:vm.example', 'd:two.example', 'd:one.example']);
    expect(data.sites.map((x) => x.site)).toEqual(['c.example', 'b.example', 'a.example']);
    expect(data.sites[2]).toMatchObject({ limited: true, families: ['canvas'], first: '2024-10-04' });
  });
});
