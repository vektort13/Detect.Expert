// ADR-020 §G: local history «Кто вас узнаёт» (receiver × site × day × signals) in the module's IndexedDB, written by
// the SW only. Domains, days, enums and counts; no values, URLs or cookies (the cookie mechanism is not in v1). Being
// seen on several sites is not proof of recognition: mechanisms carry interpretationConfidence, never a verdict.

import { SENSOR_IDS } from './enums';
import type { AttributionConfidence, EvidenceSource, Integrity, Interpretation, InterpretationConfidence, VendorMatch } from './enums';
import type { HistoryRetentionDays, ProtectLimitation } from './protect';
import type { LocalDay } from './protect-requests';

/** Signals folded into a sighting day mask. */
export const HISTORY_SIGNALS = ['request', 'frame', 'value-match', 'replay-pattern', 'request-blocked'] as const;
export type HistorySignal = (typeof HISTORY_SIGNALS)[number];

/** Linking mechanisms of v1 (no cookie, no URL identifier). */
export const LINK_MECHANISMS = ['value-match', 'replay-pattern', 'frame-techniques', 'requests-only'] as const;
export type LinkMechanism = (typeof LINK_MECHANISMS)[number];

function withNetworkPatterns<T extends readonly string[]>(ids: T): readonly [...T, 'network-patterns'] {
  return [...ids, 'network-patterns'] as const;
}

/** API families seen in a receiver's frames: the observation sensor families plus network patterns (DET-060/061). */
export const HISTORY_FAMILIES = /* @__PURE__ */ withNetworkPatterns(SENSOR_IDS);
export type HistoryFamily = (typeof HISTORY_FAMILIES)[number];

export const HISTORY_WINDOW_DAYS = [7, 30, 90] as const;
export type HistoryWindowDays = (typeof HISTORY_WINDOW_DAYS)[number];

export const HISTORY_STORAGE_STATES = ['ok', 'degraded', 'unavailable', 'reset'] as const;
export type HistoryStorageState = (typeof HISTORY_STORAGE_STATES)[number];

/** `d:<registrable domain>` or `v:<vendorId>` (vendor rows only through an active catalog rule; none in production). */
export const HISTORY_ROW_KEY_PATTERN = /^(d:[a-z0-9.-]{1,253}|v:[A-Za-z0-9_-]{1,64})$/;

export const HISTORY_DELETE_TARGETS = ['row', 'site'] as const;
export type HistoryDeleteTarget = (typeof HISTORY_DELETE_TARGETS)[number];

export interface HistoryMechanismSummary {
  mechanism: LinkMechanism;
  /** Number of sites in the window where the mechanism was seen. */
  sites: number;
  /** frame-techniques only. */
  families?: HistoryFamily[];
  interpretation?: Interpretation;
  evidenceSource: EvidenceSource;
  integrity: Integrity;
  attributionConfidence: AttributionConfidence;
  interpretationConfidence: InterpretationConfidence;
}

export interface HistoryRow {
  rowKey: string;
  /** Registrable domains of the row (one for a `d:` row). */
  domains: string[];
  vendorId?: string;
  vendorConfidence: VendorMatch;
  sites: number;
  days: number;
  lastSeen: LocalDay;
  mechanisms: HistoryMechanismSummary[];
}

/** «На этом сайте»: receivers of the current site and families without a determined source. */
export interface HistorySiteSummary {
  site: string;
  receivers: { rowKey: string; sites: number }[];
  unattributedFamilies: HistoryFamily[];
}

/** Saturating counters of what the history dropped or evicted. */
export interface HistoryDropped {
  pending: number;
  evictedSightings: number;
  evictedReceivers: number;
  evictedSites: number;
  unresolvedSite: number;
  malformed: number;
}

export interface HistoryProjection {
  historyRevision: number;
  retentionDays: HistoryRetentionDays;
  storage: HistoryStorageState;
  /** Days are UTC days (history day masks). */
  today: LocalDay;
  /** First day of the kept history, or null when nothing is kept yet. */
  since: LocalDay | null;
  windowDays: HistoryWindowDays;
  /** At most PROTECT_BUDGETS.maxRowsPerPage. */
  rows: HistoryRow[];
  totalRows: number;
  singleSiteReceivers: number;
  sitesInWindow: number;
  limitedSitesInWindow: number;
  limitations: ProtectLimitation[];
  site?: HistorySiteSummary;
  dropped: HistoryDropped;
}

export interface HistorySiteLine {
  site: string;
  days: number;
  first: LocalDay;
  last: LocalDay;
}

export interface HistoryFamilyLine {
  family: HistoryFamily;
  days: number;
  sites: number;
  interpretation: Interpretation;
  attributionConfidence: AttributionConfidence;
}

export interface HistoryReceiverCard {
  rowKey: string;
  domains: string[];
  /** At most PROTECT_BUDGETS.maxCardSites. */
  sites: HistorySiteLine[];
  moreSites: number;
  families: HistoryFamilyLine[];
  mechanisms: HistoryMechanismSummary[];
}

/** Export site reference: the site name only with `sitesIncluded`, otherwise `site-<n>`. */
export const HISTORY_EXPORT_SITE_REF_PATTERN = /^site-[1-9][0-9]{0,4}$/;

export interface HistoryExportSiteLine {
  /** Site name (sitesIncluded) or `site-<n>`. */
  site: string;
  days: number;
  first: LocalDay;
  last: LocalDay;
}

export interface HistoryExportReceiver {
  rowKey: string;
  domains: string[];
  vendorId?: string;
  vendorConfidence: VendorMatch;
  mechanisms: HistoryMechanismSummary[];
  families: HistoryFamilyLine[];
  sites: HistoryExportSiteLine[];
}

export interface HistoryExportSite {
  /** Site name (sitesIncluded) or `site-<n>`. */
  site: string;
  days: number;
  first: LocalDay;
  last: LocalDay;
  /** Observation was network-limited on this site (requests and frames partly invisible). */
  limited: boolean;
  families: HistoryFamily[];
}

/** Exported file = preview (REQ-013): explicit allowlist, sites redacted by default, days only, ≤ maxExportBytes. */
export interface HistoryExport {
  schemaVersion: 1;
  kind: 'detect-expert-history';
  redacted: true;
  sitesIncluded: boolean;
  exportedOn: LocalDay;
  retentionDays: HistoryRetentionDays;
  since: LocalDay | null;
  receivers: HistoryExportReceiver[];
  sites: HistoryExportSite[];
  limitations: ProtectLimitation[];
  dropped: HistoryDropped;
  truncated: boolean;
}
