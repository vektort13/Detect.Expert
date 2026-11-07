// ADR-020 §G (S12): ranking of the «Кто вас узнаёт» history. Sightings are grouped by row key (`d:<domain>`; `v:<vendorId>`
// only through an active catalog rule — none in production, REQ-008), filtered (window, minSites, mechanismsOnly,
// domain substring, site), sorted (sites ↓, confidence ↓, lastSeen ↓, rowKey ↑) and paged (≤ maxRowsPerPage).
// Pure: the caller passes the records, today and the retention; nothing here reads a clock or storage.

import { HISTORY_FAMILIES, PROTECT_BUDGETS, PROTECT_WIRE_LIMITS } from '@detect-expert/contracts';
import type {
  HistoryFamily,
  HistoryFamilyLine,
  HistoryMechanismSummary,
  HistoryReceiverCard,
  HistoryRow,
  HistorySiteLine,
  HistorySiteSummary,
  HistoryWindowDays,
  Interpretation,
  LocalDay,
} from '@detect-expert/contracts';
import { HISTORY_MASK_DAYS, alignDayMask, dayCount, daysIn, emptyDayMask, firstDayIn, historyDayString, lastDayIn, orDayMask, windowDayMask } from './day-mask';
import { maxInterpretation } from './merge';
import { hasLinkingMechanism, historyMechanisms, mechanismConfidenceRank } from './mechanisms';
import type { HistoryDayWindow } from './mechanisms';
import type { HistorySightingRecord, HistorySiteRecord } from './records';

/** Maps a catalog rule id to a vendor id only for an ACTIVE rule; v1 production: always null. */
export type HistoryVendorOfRule = (ruleId: string) => string | null;

export const NO_HISTORY_VENDOR: HistoryVendorOfRule = () => null;

/** Window of `windowDays` ending today, never longer than the retention (older days are being purged). */
export function historyWindow(today: number, windowDays: number, retentionDays: number): HistoryDayWindow {
  const span = Math.max(1, Math.min(windowDays, retentionDays, HISTORY_MASK_DAYS));
  return { from: today - span + 1, to: today };
}

/** Row key of a sighting: `v:<vendorId>` through an active rule, otherwise `d:<receiver>`. */
export function historyRowKey(s: Readonly<HistorySightingRecord>, vendorOf: HistoryVendorOfRule = NO_HISTORY_VENDOR): string {
  for (const id of s.ruleIds) {
    const vendor = vendorOf(id);
    if (vendor !== null) return 'v:' + vendor;
  }
  return 'd:' + s.receiver;
}

interface RowAgg {
  rowKey: string;
  sightings: HistorySightingRecord[];
}

/** Groups sightings by row key (insertion order of first appearance). */
export function groupHistoryRows(sightings: readonly HistorySightingRecord[], vendorOf: HistoryVendorOfRule = NO_HISTORY_VENDOR): Map<string, RowAgg> {
  const rows = new Map<string, RowAgg>();
  for (const s of sightings) {
    const key = historyRowKey(s, vendorOf);
    let agg = rows.get(key);
    if (agg === undefined) {
      agg = { rowKey: key, sightings: [] };
      rows.set(key, agg);
    }
    agg.sightings.push(s);
  }
  return rows;
}

interface RowSummary {
  row: HistoryRow;
  sites: Set<string>;
  confidence: number;
  lastSeenDay: number;
}

/** Summary of one row in the window, or null when none of its sightings has a day in the window. */
function summarizeRow(agg: RowAgg, w: HistoryDayWindow): RowSummary | null {
  const sites = new Set<string>();
  const domains = new Set<string>();
  const inWin: HistorySightingRecord[] = [];
  let union = emptyDayMask();
  let lastSeenDay = -1;
  for (const s of agg.sightings) {
    const masked = windowDayMask(s.seen, s.endDay, w.from, w.to);
    if (dayCount(masked) === 0) continue;
    inWin.push(s);
    sites.add(s.site);
    domains.add(s.receiver);
    union = orDayMask(union, alignDayMask(masked, s.endDay, w.to));
    const last = lastDayIn(s.seen, s.endDay, w.from, w.to);
    if (last !== null && last > lastSeenDay) lastSeenDay = last;
  }
  if (inWin.length === 0) return null;
  const mechanisms = historyMechanisms(inWin, w);
  const row: HistoryRow = {
    rowKey: agg.rowKey,
    domains: [...domains].sort().slice(0, PROTECT_WIRE_LIMITS.maxRowDomains),
    vendorConfidence: 'none',
    sites: sites.size,
    days: dayCount(union),
    lastSeen: historyDayString(lastSeenDay),
    mechanisms,
  };
  if (agg.rowKey.startsWith('v:')) {
    // Conservative: a vendor row exists only through an active catalog rule (none in production, REQ-008).
    row.vendorId = agg.rowKey.slice(2);
    row.vendorConfidence = 'weak-signal';
  }
  return { row, sites, confidence: mechanismConfidenceRank(mechanisms), lastSeenDay };
}

function compareRows(a: RowSummary, b: RowSummary): number {
  if (a.row.sites !== b.row.sites) return b.row.sites - a.row.sites;
  if (a.confidence !== b.confidence) return b.confidence - a.confidence;
  if (a.lastSeenDay !== b.lastSeenDay) return b.lastSeenDay - a.lastSeenDay;
  return a.row.rowKey < b.row.rowKey ? -1 : a.row.rowKey > b.row.rowKey ? 1 : 0;
}

export interface HistoryRankOptions {
  today: number;
  retentionDays: number;
  windowDays: HistoryWindowDays;
  offset: number;
  limit: number;
  /** Default 2. */
  minSites?: 1 | 2;
  mechanismsOnly?: boolean;
  /** Substring of a row domain (already validated: [a-z0-9.-]). */
  domainFilter?: string;
  /** Rows seen on this site in the window. */
  site?: string;
  vendorOf?: HistoryVendorOfRule;
}

export interface HistoryRankResult {
  rows: HistoryRow[];
  totalRows: number;
  /** Rows seen on exactly one site (shown as a count only), with the domain / site filters applied. */
  singleSiteReceivers: number;
  sitesInWindow: number;
  limitedSitesInWindow: number;
  site?: HistorySiteSummary;
  /** Some shown row has a frame-techniques mechanism (attribution is frame-only). */
  frameOnly: boolean;
}

/** Ranked page of history rows (plus window counts and the «На этом сайте» summary when `site` is given). */
export function rankHistory(sightings: readonly HistorySightingRecord[], sites: readonly HistorySiteRecord[], options: HistoryRankOptions): HistoryRankResult {
  const w = historyWindow(options.today, options.windowDays, options.retentionDays);
  const minSites = options.minSites ?? 2;
  const filter = options.domainFilter;
  const summaries: RowSummary[] = [];
  for (const agg of groupHistoryRows(sightings, options.vendorOf).values()) {
    const sum = summarizeRow(agg, w);
    if (sum !== null) summaries.push(sum);
  }
  let single = 0;
  const kept: RowSummary[] = [];
  for (const s of summaries) {
    if (filter !== undefined && !s.row.domains.some((d) => d.includes(filter))) continue;
    if (options.site !== undefined && !s.sites.has(options.site)) continue;
    if (s.row.sites === 1) single++;
    if (s.row.sites < minSites) continue;
    if (options.mechanismsOnly === true && !hasLinkingMechanism(s.row.mechanisms)) continue;
    kept.push(s);
  }
  kept.sort(compareRows);
  const limit = Math.max(1, Math.min(PROTECT_BUDGETS.maxRowsPerPage, options.limit));
  const page = kept.slice(Math.max(0, options.offset), Math.max(0, options.offset) + limit).map((s) => s.row);
  let sitesInWindow = 0;
  let limitedSitesInWindow = 0;
  let siteRecord: HistorySiteRecord | undefined;
  for (const r of sites) {
    if (daysIn(r.seen, r.endDay, w.from, w.to) === 0) continue;
    sitesInWindow++;
    if (daysIn(r.limited, r.endDay, w.from, w.to) > 0) limitedSitesInWindow++;
    if (r.site === options.site) siteRecord = r;
  }
  const result: HistoryRankResult = {
    rows: page,
    totalRows: kept.length,
    singleSiteReceivers: single,
    sitesInWindow,
    limitedSitesInWindow,
    frameOnly: page.some((r) => r.mechanisms.some((m) => m.mechanism === 'frame-techniques')),
  };
  if (options.site !== undefined) result.site = historySiteSummary(options.site, summaries, siteRecord, w);
  return result;
}

/** «На этом сайте»: rows seen on the site in the window (by their total sites) and its families without a source. */
function historySiteSummary(site: string, summaries: readonly RowSummary[], record: HistorySiteRecord | undefined, w: HistoryDayWindow): HistorySiteSummary {
  const receivers = summaries
    .filter((s) => s.sites.has(site))
    .sort(compareRows)
    .slice(0, PROTECT_BUDGETS.maxHistoryReceivers)
    .map((s) => ({ rowKey: s.row.rowKey, sites: s.row.sites }));
  const unattributedFamilies: HistoryFamily[] = [];
  if (record !== undefined) {
    for (const f of HISTORY_FAMILIES) {
      const m = record.families[f];
      if (m !== undefined && daysIn(m, record.endDay, w.from, w.to) > 0) unattributedFamilies.push(f);
    }
  }
  return { site, receivers, unattributedFamilies };
}

/** Site lines of a row (newest last day first, then by name). */
function siteLines(sightings: readonly HistorySightingRecord[], w: HistoryDayWindow): HistorySiteLine[] {
  const bySite = new Map<string, { mask: ReturnType<typeof emptyDayMask>; first: number; last: number }>();
  for (const s of sightings) {
    const masked = windowDayMask(s.seen, s.endDay, w.from, w.to);
    if (dayCount(masked) === 0) continue;
    const first = firstDayIn(s.seen, s.endDay, w.from, w.to)!;
    const last = lastDayIn(s.seen, s.endDay, w.from, w.to)!;
    const cur = bySite.get(s.site);
    const aligned = alignDayMask(masked, s.endDay, w.to);
    if (cur === undefined) bySite.set(s.site, { mask: aligned, first, last });
    else bySite.set(s.site, { mask: orDayMask(cur.mask, aligned), first: Math.min(cur.first, first), last: Math.max(cur.last, last) });
  }
  return [...bySite.entries()]
    .sort((a, b) => (b[1].last - a[1].last) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([site, v]) => ({ site, days: dayCount(v.mask), first: historyDayString(v.first), last: historyDayString(v.last) }));
}

/** Family lines of a row: days (union), sites, strongest interpretation; attribution is frame-only. */
function familyLines(sightings: readonly HistorySightingRecord[], w: HistoryDayWindow): HistoryFamilyLine[] {
  const out: HistoryFamilyLine[] = [];
  for (const f of HISTORY_FAMILIES) {
    let union = emptyDayMask();
    const sites = new Set<string>();
    let interpretation: Interpretation | null = null;
    for (const s of sightings) {
      const e = s.families[f];
      if (e === undefined) continue;
      const masked = windowDayMask(e.days, s.endDay, w.from, w.to);
      if (dayCount(masked) === 0) continue;
      union = orDayMask(union, alignDayMask(masked, s.endDay, w.to));
      sites.add(s.site);
      interpretation = interpretation === null ? e.interpretation : maxInterpretation(interpretation, e.interpretation);
    }
    if (interpretation !== null) out.push({ family: f, days: dayCount(union), sites: sites.size, interpretation, attributionConfidence: 'frame-only' });
  }
  return out;
}

/** The receiver card of a row in the window, or null when the row has nothing in the window. */
export function historyReceiverCard(
  sightings: readonly HistorySightingRecord[],
  rowKey: string,
  options: { today: number; retentionDays: number; windowDays: number; vendorOf?: HistoryVendorOfRule },
): HistoryReceiverCard | null {
  const w = historyWindow(options.today, options.windowDays, options.retentionDays);
  const mine = sightings.filter((s) => historyRowKey(s, options.vendorOf) === rowKey && daysIn(s.seen, s.endDay, w.from, w.to) > 0);
  if (mine.length === 0) return null;
  const lines = siteLines(mine, w);
  const shown = lines.slice(0, PROTECT_BUDGETS.maxCardSites);
  const mechanisms: HistoryMechanismSummary[] = historyMechanisms(mine, w);
  return {
    rowKey,
    domains: [...new Set(mine.map((s) => s.receiver))].sort().slice(0, PROTECT_WIRE_LIMITS.maxRowDomains),
    sites: shown,
    moreSites: lines.length - shown.length,
    families: familyLines(mine, w),
    mechanisms,
  };
}

/** Everything the export needs, unredacted (the export package redacts and bounds it). Rows in rank order. */
export interface HistoryExportData {
  receivers: Array<{
    rowKey: string;
    domains: string[];
    vendorId?: string;
    vendorConfidence: HistoryRow['vendorConfidence'];
    mechanisms: HistoryMechanismSummary[];
    families: HistoryFamilyLine[];
    sites: HistorySiteLine[];
  }>;
  sites: Array<{ site: string; days: number; first: LocalDay; last: LocalDay; limited: boolean; families: HistoryFamily[] }>;
  frameOnly: boolean;
}

/** All rows (minSites 1) and all sites within the retention window, for the export preview. */
export function historyExportData(
  sightings: readonly HistorySightingRecord[],
  sites: readonly HistorySiteRecord[],
  options: { today: number; retentionDays: number; vendorOf?: HistoryVendorOfRule },
): HistoryExportData {
  const w = historyWindow(options.today, options.retentionDays, options.retentionDays);
  const summaries: Array<RowSummary & { agg: RowAgg }> = [];
  for (const agg of groupHistoryRows(sightings, options.vendorOf).values()) {
    const sum = summarizeRow(agg, w);
    if (sum !== null) summaries.push({ ...sum, agg });
  }
  summaries.sort(compareRows);
  const receivers: HistoryExportData['receivers'] = summaries.map((s) => {
    const inWin = s.agg.sightings.filter((x) => daysIn(x.seen, x.endDay, w.from, w.to) > 0);
    const item: HistoryExportData['receivers'][number] = {
      rowKey: s.row.rowKey,
      domains: s.row.domains,
      vendorConfidence: s.row.vendorConfidence,
      mechanisms: s.row.mechanisms,
      families: familyLines(inWin, w),
      sites: siteLines(inWin, w),
    };
    if (s.row.vendorId !== undefined) item.vendorId = s.row.vendorId;
    return item;
  });
  const siteItems: Array<{ site: string; days: number; first: number; last: number; limited: boolean; families: HistoryFamily[] }> = [];
  for (const r of sites) {
    const first = firstDayIn(r.seen, r.endDay, w.from, w.to);
    const last = lastDayIn(r.seen, r.endDay, w.from, w.to);
    if (first === null || last === null) continue;
    const families = HISTORY_FAMILIES.filter((f) => {
      const m = r.families[f];
      return m !== undefined && daysIn(m, r.endDay, w.from, w.to) > 0;
    });
    siteItems.push({ site: r.site, days: daysIn(r.seen, r.endDay, w.from, w.to), first, last, limited: daysIn(r.limited, r.endDay, w.from, w.to) > 0, families });
  }
  siteItems.sort((a, b) => (a.first - b.first) || (a.last - b.last) || (a.site < b.site ? -1 : a.site > b.site ? 1 : 0));
  return {
    receivers,
    sites: siteItems.map((x) => ({ ...x, first: historyDayString(x.first), last: historyDayString(x.last) })),
    frameOnly: receivers.some((r) => r.families.length > 0),
  };
}
