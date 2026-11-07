// ADR-020 §G, REQ-013 (S12): export of the «Кто вас узнаёт» history. The file is byte-for-byte the serialization of the
// preview the user saw (serializeHistoryExport). Explicit allowlist: every field is copied by name, nothing is spread.
// Sites are replaced by `site-<n>` unless the user ticked «Включить названия сайтов» (numbering: first day, last day,
// name — the same order in both modes); dates are days only; at most PROTECT_BUDGETS.maxExportBytes with `truncated`.

import { HISTORY_FAMILIES, LINK_MECHANISMS, PROTECT_BUDGETS, PROTECT_LIMITATIONS, PROTECT_WIRE_LIMITS, jsonLengthUpTo } from '@detect-expert/contracts';
import type {
  HistoryDropped,
  HistoryExport,
  HistoryExportReceiver,
  HistoryExportSite,
  HistoryExportSiteLine,
  HistoryFamily,
  HistoryFamilyLine,
  HistoryMechanismSummary,
  HistoryRetentionDays,
  LocalDay,
  ProtectLimitation,
  VendorMatch,
} from '@detect-expert/contracts';

/** Input rows (unredacted, rank order); the engine's historyExportData has this shape. */
export interface HistoryExportInput {
  receivers: ReadonlyArray<{
    rowKey: string;
    domains: readonly string[];
    vendorId?: string;
    vendorConfidence: VendorMatch;
    mechanisms: readonly HistoryMechanismSummary[];
    families: readonly HistoryFamilyLine[];
    sites: ReadonlyArray<{ site: string; days: number; first: LocalDay; last: LocalDay }>;
  }>;
  sites: ReadonlyArray<{ site: string; days: number; first: LocalDay; last: LocalDay; limited: boolean; families: readonly HistoryFamily[] }>;
}

export interface HistoryExportOptions {
  includeSites: boolean;
  exportedOn: LocalDay;
  retentionDays: HistoryRetentionDays;
  since: LocalDay | null;
  limitations: readonly ProtectLimitation[];
  dropped: Readonly<HistoryDropped>;
  /** Default PROTECT_BUDGETS.maxExportBytes (tests pass a smaller bound). */
  maxBytes?: number;
}

export const HISTORY_EXPORT_MIME = 'application/json';
/** Pretty JSON (2 spaces) is at most this factor longer than compact JSON for these shapes (depth ≤ 5). */
const PRETTY_FACTOR = 3;

function mechanismCopy(m: HistoryMechanismSummary): HistoryMechanismSummary {
  const out: HistoryMechanismSummary = {
    mechanism: m.mechanism,
    sites: m.sites,
    evidenceSource: m.evidenceSource,
    integrity: m.integrity,
    attributionConfidence: m.attributionConfidence,
    interpretationConfidence: m.interpretationConfidence,
  };
  if (m.families !== undefined) out.families = HISTORY_FAMILIES.filter((f) => m.families!.includes(f));
  if (m.interpretation !== undefined) out.interpretation = m.interpretation;
  return out;
}

function familyCopy(f: HistoryFamilyLine): HistoryFamilyLine {
  return { family: f.family, days: f.days, sites: f.sites, interpretation: f.interpretation, attributionConfidence: f.attributionConfidence };
}

function canonicalLimitations(list: readonly ProtectLimitation[]): ProtectLimitation[] {
  const set = new Set(list);
  return PROTECT_LIMITATIONS.filter((l) => set.has(l)).slice(0, PROTECT_WIRE_LIMITS.maxProjectionLimitations);
}

/**
 * Site references: every site of the input (site list and receiver lines) gets `site-<n>` by (first day, last day,
 * name) — or keeps its name with `includeSites`.
 */
function siteRefs(input: HistoryExportInput, includeSites: boolean): Map<string, string> {
  const span = new Map<string, { first: LocalDay; last: LocalDay }>();
  const note = (site: string, first: LocalDay, last: LocalDay): void => {
    const cur = span.get(site);
    if (cur === undefined) span.set(site, { first, last });
    else span.set(site, { first: first < cur.first ? first : cur.first, last: last > cur.last ? last : cur.last });
  };
  for (const s of input.sites) note(s.site, s.first, s.last);
  for (const r of input.receivers) for (const s of r.sites) note(s.site, s.first, s.last);
  const ordered = [...span.entries()].sort((a, b) =>
    a[1].first !== b[1].first ? (a[1].first < b[1].first ? -1 : 1) : a[1].last !== b[1].last ? (a[1].last < b[1].last ? -1 : 1) : a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
  );
  const refs = new Map<string, string>();
  ordered.forEach(([site], i) => refs.set(site, includeSites ? site : 'site-' + String(i + 1)));
  return refs;
}

/** The export preview (= the file). Receivers and sites beyond the byte bound are cut and `truncated` is set. */
export function createHistoryExport(input: HistoryExportInput, options: HistoryExportOptions): HistoryExport {
  const maxBytes = options.maxBytes ?? PROTECT_BUDGETS.maxExportBytes;
  const refs = siteRefs(input, options.includeSites);
  const ref = (site: string): string => refs.get(site) ?? 'site-0';
  const receivers: HistoryExportReceiver[] = input.receivers.slice(0, PROTECT_BUDGETS.maxHistoryReceivers).map((r) => {
    const sites: HistoryExportSiteLine[] = r.sites.slice(0, PROTECT_BUDGETS.maxHistorySites).map((s) => ({ site: ref(s.site), days: s.days, first: s.first, last: s.last }));
    const out: HistoryExportReceiver = {
      rowKey: r.rowKey,
      domains: r.domains.slice(0, PROTECT_WIRE_LIMITS.maxRowDomains).map((d) => d),
      vendorConfidence: r.vendorConfidence,
      mechanisms: [...r.mechanisms].sort((a, b) => LINK_MECHANISMS.indexOf(a.mechanism) - LINK_MECHANISMS.indexOf(b.mechanism)).slice(0, LINK_MECHANISMS.length).map(mechanismCopy),
      families: r.families.slice(0, HISTORY_FAMILIES.length).map(familyCopy),
      sites,
    };
    if (r.vendorId !== undefined) out.vendorId = r.vendorId;
    return out;
  });
  const sites: HistoryExportSite[] = input.sites.slice(0, PROTECT_BUDGETS.maxHistorySites).map((s) => ({
    site: ref(s.site),
    days: s.days,
    first: s.first,
    last: s.last,
    limited: s.limited,
    families: HISTORY_FAMILIES.filter((f) => s.families.includes(f)),
  }));
  const preview: HistoryExport = {
    schemaVersion: 1,
    kind: 'detect-expert-history',
    redacted: true,
    sitesIncluded: options.includeSites,
    exportedOn: options.exportedOn,
    retentionDays: options.retentionDays,
    since: options.since,
    receivers,
    sites,
    limitations: canonicalLimitations(options.limitations),
    dropped: {
      pending: options.dropped.pending,
      evictedSightings: options.dropped.evictedSightings,
      evictedReceivers: options.dropped.evictedReceivers,
      evictedSites: options.dropped.evictedSites,
      unresolvedSite: options.dropped.unresolvedSite,
      malformed: options.dropped.malformed,
    },
    truncated: input.receivers.length > receivers.length || input.sites.length > sites.length,
  };
  return fitHistoryExport(preview, maxBytes);
}

/**
 * Cheap bound first (compact length × pretty factor, measured item by item with early stop); only when that bound
 * exceeds `maxBytes` are receivers, then sites, cut from the tail until the serialized file fits.
 */
function fitHistoryExport(preview: HistoryExport, maxBytes: number): HistoryExport {
  const budget = Math.floor(maxBytes / PRETTY_FACTOR);
  if (jsonLengthUpTo(preview, budget + 1) <= budget) return preview;
  let receivers = preview.receivers;
  let sites = preview.sites;
  let cut = false;
  const fits = (): boolean => serializeHistoryExport({ ...preview, receivers, sites, truncated: true }).length <= maxBytes;
  // Binary search on the number of receivers kept (then sites), each probe serializes a candidate ≤ the bound.
  if (!fits()) {
    let lo = 0;
    let hi = receivers.length;
    const all = preview.receivers;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      receivers = all.slice(0, mid);
      if (fits()) lo = mid;
      else hi = mid - 1;
    }
    receivers = all.slice(0, lo);
    cut = lo < all.length;
    if (!fits()) {
      const allSites = preview.sites;
      let a = 0;
      let b = allSites.length;
      while (a < b) {
        const mid = Math.ceil((a + b) / 2);
        sites = allSites.slice(0, mid);
        if (fits()) a = mid;
        else b = mid - 1;
      }
      sites = allSites.slice(0, a);
      cut = cut || a < allSites.length;
    }
  }
  return { ...preview, receivers, sites, truncated: preview.truncated || cut };
}

/** The exact file text (UTF-8; every field is ASCII). */
export function serializeHistoryExport(preview: HistoryExport): string {
  return JSON.stringify(preview, null, 2) + '\n';
}

export function historyExportFileName(preview: Pick<HistoryExport, 'exportedOn' | 'sitesIncluded'>): string {
  return 'detect-expert-history-' + preview.exportedOn + (preview.sitesIncluded ? '-sites' : '') + '.json';
}
