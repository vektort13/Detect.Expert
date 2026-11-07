// ADR-020 §G (S12): records of the «Кто вас узнаёт» history (IndexedDB `detect-expert-protect`, written by the SW only)
// and the deltas folded into them. Domains, UTC day masks, enums and counts only: no URL, value, hash, cookie or time
// of day. Readers validate every stored record (parse*) and drop malformed ones (counted in `dropped.malformed`).

import { HISTORY_FAMILIES, INTERPRETATIONS, MAX_COUNT, PROTECT_BUDGETS, isDomainName, isSiteName } from '@detect-expert/contracts';
import type { HistoryDropped, HistoryFamily, Interpretation } from '@detect-expert/contracts';
import { isDayMask, isHistoryDay } from './day-mask';
import type { HistoryDayMask } from './day-mask';

/** Signal bits of a sighting delta (HISTORY_SIGNALS of the contracts). */
export const HISTORY_SIGNAL_BITS = {
  request: 1,
  frame: 2,
  'value-match': 4,
  'replay-pattern': 8,
  'request-blocked': 16,
} as const;
export const HISTORY_SIGNAL_ALL = 31;

/** Strongest form in which a receiver got a typed value: a hash of an e-mail / phone, or anything else ('plain'). */
export type HistoryValueStrength = 'hash' | 'plain';

/** API family seen in a receiver's frames on a site: days, strongest interpretation; attribution is frame-only. */
export interface HistoryFamilyEntry {
  days: HistoryDayMask;
  interpretation: Interpretation;
  attributionConfidence: 'frame-only';
}

/** `sightings` store: one receiver on one site. Every mask is anchored at `endDay`; `lastDay` = newest day of `seen`. */
export interface HistorySightingRecord {
  v: 1;
  receiver: string;
  site: string;
  endDay: number;
  lastDay: number;
  seen: HistoryDayMask;
  request: HistoryDayMask;
  frame: HistoryDayMask;
  valueMatch: HistoryDayMask;
  replay: HistoryDayMask;
  blocked: HistoryDayMask;
  families: Partial<Record<HistoryFamily, HistoryFamilyEntry>>;
  /** Matched catalog rule ids (≤ PROTECT_BUDGETS.maxRuleIdsPerSighting, sorted). */
  ruleIds: string[];
  strongestValueEncoding?: HistoryValueStrength;
}

/** `receivers` store: days a receiver was seen on any site. */
export interface HistoryReceiverRecord {
  v: 1;
  receiver: string;
  endDay: number;
  lastDay: number;
  seen: HistoryDayMask;
}

/** `sites` store: days a site was visited, days observation was network-limited there, families without a source. */
export interface HistorySiteRecord {
  v: 1;
  site: string;
  endDay: number;
  lastDay: number;
  seen: HistoryDayMask;
  limited: HistoryDayMask;
  families: Partial<Record<HistoryFamily, HistoryDayMask>>;
}

export const HISTORY_STATE_KEY = 'history-state';

/** `meta['history-state']`: revision, purge day, counts, saturating drop counters, flags. */
export interface HistoryStateRecord {
  key: typeof HISTORY_STATE_KEY;
  v: 1;
  revision: number;
  lastPurgeDay: number | null;
  counts: { sightings: number; receivers: number; sites: number };
  dropped: HistoryDropped;
  /** Records were evicted by the storage limits (sticky until the history is cleared). */
  truncated: boolean;
  /** UTC day the history started (feature enabled, or history cleared). */
  enabledDay: number;
  /** UTC day the browser was seen to have removed the database while the history was on; null otherwise. */
  resetDay: number | null;
}

/** One signal of one receiver on one site on one day (accumulator unit). */
export interface HistorySightingDelta {
  receiver: string;
  site: string;
  day: number;
  /** OR of HISTORY_SIGNAL_BITS. */
  signals: number;
  families?: Partial<Record<HistoryFamily, Interpretation>>;
  ruleIds?: string[];
  valueStrength?: HistoryValueStrength;
}

export interface HistorySiteDelta {
  site: string;
  day: number;
  limited: boolean;
  families?: HistoryFamily[];
}

export const EMPTY_HISTORY_DROPPED: Readonly<HistoryDropped> = Object.freeze({
  pending: 0,
  evictedSightings: 0,
  evictedReceivers: 0,
  evictedSites: 0,
  unresolvedSite: 0,
  malformed: 0,
});

const FAMILY_SET: ReadonlySet<string> = new Set(HISTORY_FAMILIES);
const INTERPRETATION_SET: ReadonlySet<string> = new Set(INTERPRETATIONS);
const RULE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isHistoryFamily(value: unknown): value is HistoryFamily {
  return typeof value === 'string' && FAMILY_SET.has(value);
}

export function isHistoryRuleId(value: unknown): value is string {
  return typeof value === 'string' && RULE_ID_RE.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? Math.min(MAX_COUNT, value) : 0;
}

/** A stored sighting, or null when any field is malformed (the reader drops it). */
export function parseSightingRecord(raw: unknown): HistorySightingRecord | null {
  if (!isRecord(raw) || raw['v'] !== 1) return null;
  const { receiver, site, endDay, lastDay } = raw;
  if (!isDomainName(receiver) || !isSiteName(site) || !isHistoryDay(endDay) || !isHistoryDay(lastDay) || lastDay > endDay) return null;
  const masks = ['seen', 'request', 'frame', 'valueMatch', 'replay', 'blocked'] as const;
  for (const m of masks) if (!isDayMask(raw[m])) return null;
  const familiesRaw = raw['families'];
  if (!isRecord(familiesRaw)) return null;
  const families: Partial<Record<HistoryFamily, HistoryFamilyEntry>> = {};
  for (const [name, entry] of Object.entries(familiesRaw)) {
    if (!isHistoryFamily(name) || !isRecord(entry)) return null;
    if (!isDayMask(entry['days']) || typeof entry['interpretation'] !== 'string' || !INTERPRETATION_SET.has(entry['interpretation']) || entry['attributionConfidence'] !== 'frame-only') return null;
    families[name] = { days: entry['days'], interpretation: entry['interpretation'] as Interpretation, attributionConfidence: 'frame-only' };
  }
  const ruleIds = raw['ruleIds'];
  if (!Array.isArray(ruleIds) || ruleIds.length > PROTECT_BUDGETS.maxRuleIdsPerSighting || !ruleIds.every(isHistoryRuleId)) return null;
  const strength = raw['strongestValueEncoding'];
  if (strength !== undefined && strength !== 'hash' && strength !== 'plain') return null;
  const out: HistorySightingRecord = {
    v: 1,
    receiver,
    site,
    endDay,
    lastDay,
    seen: raw['seen'] as HistoryDayMask,
    request: raw['request'] as HistoryDayMask,
    frame: raw['frame'] as HistoryDayMask,
    valueMatch: raw['valueMatch'] as HistoryDayMask,
    replay: raw['replay'] as HistoryDayMask,
    blocked: raw['blocked'] as HistoryDayMask,
    families,
    ruleIds: [...(ruleIds as string[])],
  };
  if (strength !== undefined) out.strongestValueEncoding = strength;
  return out;
}

export function parseReceiverRecord(raw: unknown): HistoryReceiverRecord | null {
  if (!isRecord(raw) || raw['v'] !== 1) return null;
  const { receiver, endDay, lastDay, seen } = raw;
  if (!isDomainName(receiver) || !isHistoryDay(endDay) || !isHistoryDay(lastDay) || lastDay > endDay || !isDayMask(seen)) return null;
  return { v: 1, receiver, endDay, lastDay, seen };
}

export function parseSiteRecord(raw: unknown): HistorySiteRecord | null {
  if (!isRecord(raw) || raw['v'] !== 1) return null;
  const { site, endDay, lastDay, seen, limited } = raw;
  if (!isSiteName(site) || !isHistoryDay(endDay) || !isHistoryDay(lastDay) || lastDay > endDay || !isDayMask(seen) || !isDayMask(limited)) return null;
  const familiesRaw = raw['families'];
  if (!isRecord(familiesRaw)) return null;
  const families: Partial<Record<HistoryFamily, HistoryDayMask>> = {};
  for (const [name, mask] of Object.entries(familiesRaw)) {
    if (!isHistoryFamily(name) || !isDayMask(mask)) return null;
    families[name] = mask;
  }
  return { v: 1, site, endDay, lastDay, seen, limited, families };
}

/** The stored history state, or null when absent or malformed. */
export function parseHistoryState(raw: unknown): HistoryStateRecord | null {
  if (!isRecord(raw) || raw['key'] !== HISTORY_STATE_KEY || raw['v'] !== 1) return null;
  const counts = raw['counts'];
  const dropped = raw['dropped'];
  if (!isRecord(counts) || !isRecord(dropped)) return null;
  const enabledDay = raw['enabledDay'];
  if (!isHistoryDay(enabledDay)) return null;
  const lastPurgeDay = raw['lastPurgeDay'];
  const resetDay = raw['resetDay'];
  return {
    key: HISTORY_STATE_KEY,
    v: 1,
    revision: count(raw['revision']),
    lastPurgeDay: isHistoryDay(lastPurgeDay) ? lastPurgeDay : null,
    counts: { sightings: count(counts['sightings']), receivers: count(counts['receivers']), sites: count(counts['sites']) },
    dropped: {
      pending: count(dropped['pending']),
      evictedSightings: count(dropped['evictedSightings']),
      evictedReceivers: count(dropped['evictedReceivers']),
      evictedSites: count(dropped['evictedSites']),
      unresolvedSite: count(dropped['unresolvedSite']),
      malformed: count(dropped['malformed']),
    },
    truncated: raw['truncated'] === true,
    enabledDay,
    resetDay: isHistoryDay(resetDay) ? resetDay : null,
  };
}

export function newHistoryState(today: number): HistoryStateRecord {
  return {
    key: HISTORY_STATE_KEY,
    v: 1,
    revision: 0,
    lastPurgeDay: null,
    counts: { sightings: 0, receivers: 0, sites: 0 },
    dropped: { ...EMPTY_HISTORY_DROPPED },
    truncated: false,
    enabledDay: today,
    resetDay: null,
  };
}

/** Saturating add for the drop counters. */
export function addDropped(dropped: HistoryDropped, key: keyof HistoryDropped, n = 1): void {
  dropped[key] = Math.min(MAX_COUNT, dropped[key] + Math.max(0, n));
}
