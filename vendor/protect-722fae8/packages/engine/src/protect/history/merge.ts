// ADR-020 §G (S12): merging of history deltas and records. Every merge is commutative and idempotent: masks are
// OR-ed after aligning to the newer end day, interpretations take the maximum of a fixed total order, bounded sets keep
// a deterministic (sorted) order and size. Pure functions; records are never mutated.

import { HISTORY_FAMILIES, PROTECT_BUDGETS } from '@detect-expert/contracts';
import type { HistoryFamily, Interpretation } from '@detect-expert/contracts';
import { HISTORY_MASK_DAYS, alignDayMask, emptyDayMask, isEmptyDayMask, lastDayOf, orDayMask, setDay, trimRetention } from './day-mask';
import type { HistoryDayMask } from './day-mask';
import { HISTORY_SIGNAL_BITS } from './records';
import type {
  HistoryFamilyEntry,
  HistoryReceiverRecord,
  HistorySightingDelta,
  HistorySightingRecord,
  HistorySiteDelta,
  HistorySiteRecord,
  HistoryValueStrength,
} from './records';

/** Total order of interpretations for "max" (weakest first). */
const INTERPRETATION_RANK: Readonly<Record<Interpretation, number>> = {
  unknown: 0,
  'api-use': 1,
  'possible-fingerprinting': 2,
  'dns-test-pattern': 3,
  'local-probe-pattern': 4,
  'fingerprinting-pattern': 5,
};

export function maxInterpretation(a: Interpretation, b: Interpretation): Interpretation {
  return INTERPRETATION_RANK[b] > INTERPRETATION_RANK[a] ? b : a;
}

export function maxValueStrength(a: HistoryValueStrength | undefined, b: HistoryValueStrength | undefined): HistoryValueStrength | undefined {
  if (a === 'hash' || b === 'hash') return 'hash';
  if (a === 'plain' || b === 'plain') return 'plain';
  return undefined;
}

/** Sorted union, at most `max` entries (the smallest ones: deterministic whatever the merge order). */
export function boundedUnion(a: readonly string[], b: readonly string[], max: number): string[] {
  const set = new Set<string>(a);
  for (const x of b) set.add(x);
  return [...set].sort().slice(0, max);
}

const MAX_RULE_IDS = PROTECT_BUDGETS.maxRuleIdsPerSighting;
const MASK_KEYS = ['seen', 'request', 'frame', 'valueMatch', 'replay', 'blocked'] as const;
type MaskKey = (typeof MASK_KEYS)[number];

function emptySighting(receiver: string, site: string, day: number): HistorySightingRecord {
  return {
    v: 1,
    receiver,
    site,
    endDay: day,
    lastDay: day,
    seen: emptyDayMask(),
    request: emptyDayMask(),
    frame: emptyDayMask(),
    valueMatch: emptyDayMask(),
    replay: emptyDayMask(),
    blocked: emptyDayMask(),
    families: {},
    ruleIds: [],
  };
}

function signalMask(signals: number): Partial<Record<MaskKey, true>> {
  const out: Partial<Record<MaskKey, true>> = {};
  if ((signals & HISTORY_SIGNAL_BITS.request) !== 0) out.request = true;
  if ((signals & HISTORY_SIGNAL_BITS.frame) !== 0) out.frame = true;
  if ((signals & HISTORY_SIGNAL_BITS['value-match']) !== 0) out.valueMatch = true;
  if ((signals & HISTORY_SIGNAL_BITS['replay-pattern']) !== 0) out.replay = true;
  if ((signals & HISTORY_SIGNAL_BITS['request-blocked']) !== 0) out.blocked = true;
  return out;
}

/** Families in canonical order (deterministic key order of stored objects). */
function canonicalFamilies<T>(families: Partial<Record<HistoryFamily, T>>): Partial<Record<HistoryFamily, T>> {
  const out: Partial<Record<HistoryFamily, T>> = {};
  for (const f of HISTORY_FAMILIES) {
    const v = families[f];
    if (v !== undefined) out[f] = v;
  }
  return out;
}

/** Applies one delta (one day) to a sighting record (or creates it). Idempotent for the same delta. */
export function applySightingDelta(record: Readonly<HistorySightingRecord> | undefined, delta: Readonly<HistorySightingDelta>): HistorySightingRecord {
  const base = record ?? emptySighting(delta.receiver, delta.site, delta.day);
  const endDay = Math.max(base.endDay, delta.day);
  const out = { ...base, endDay } as HistorySightingRecord;
  const marks = signalMask(delta.signals);
  for (const key of MASK_KEYS) {
    let mask = alignDayMask(base[key], base.endDay, endDay);
    if (key === 'seen' || marks[key] === true) mask = setDay(mask, endDay, delta.day).mask;
    out[key] = mask;
  }
  const families: Partial<Record<HistoryFamily, HistoryFamilyEntry>> = {};
  // Only entries with days inside the 90-day span contribute their interpretation (keeps merges associative).
  const deltaInSpan = endDay - delta.day < HISTORY_MASK_DAYS;
  for (const f of HISTORY_FAMILIES) {
    const old = base.families[f];
    const add = deltaInSpan ? delta.families?.[f] : undefined;
    if (old === undefined && add === undefined) continue;
    let days = old === undefined ? emptyDayMask() : alignDayMask(old.days, base.endDay, endDay);
    const oldLive = old !== undefined && !isEmptyDayMask(days);
    if (add !== undefined) days = setDay(days, endDay, delta.day).mask;
    if (isEmptyDayMask(days)) continue;
    const interpretation = !oldLive ? add! : add === undefined ? old.interpretation : maxInterpretation(old.interpretation, add);
    families[f] = { days, interpretation, attributionConfidence: 'frame-only' };
  }
  out.families = families;
  out.ruleIds = delta.ruleIds === undefined || delta.ruleIds.length === 0 ? [...base.ruleIds] : boundedUnion(base.ruleIds, delta.ruleIds, MAX_RULE_IDS);
  const strength = maxValueStrength(base.strongestValueEncoding, delta.valueStrength);
  if (strength === undefined) delete out.strongestValueEncoding;
  else out.strongestValueEncoding = strength;
  out.lastDay = lastDayOf(out.seen, endDay) ?? endDay;
  return out;
}

/** Merges two records of the same (receiver, site). Commutative and idempotent (up to the canonical form). */
export function mergeSightingRecords(a: Readonly<HistorySightingRecord>, b: Readonly<HistorySightingRecord>): HistorySightingRecord {
  const endDay = Math.max(a.endDay, b.endDay);
  const out = emptySighting(a.receiver, a.site, endDay);
  for (const key of MASK_KEYS) out[key] = orDayMask(alignDayMask(a[key], a.endDay, endDay), alignDayMask(b[key], b.endDay, endDay));
  const families: Partial<Record<HistoryFamily, HistoryFamilyEntry>> = {};
  for (const f of HISTORY_FAMILIES) {
    const x = a.families[f];
    const y = b.families[f];
    if (x === undefined && y === undefined) continue;
    const dx = x === undefined ? emptyDayMask() : alignDayMask(x.days, a.endDay, endDay);
    const dy = y === undefined ? emptyDayMask() : alignDayMask(y.days, b.endDay, endDay);
    const xLive = x !== undefined && !isEmptyDayMask(dx);
    const yLive = y !== undefined && !isEmptyDayMask(dy);
    if (!xLive && !yLive) continue;
    const interpretation = !xLive ? y!.interpretation : !yLive ? x.interpretation : maxInterpretation(x.interpretation, y!.interpretation);
    families[f] = { days: orDayMask(dx, dy), interpretation, attributionConfidence: 'frame-only' };
  }
  out.families = families;
  out.ruleIds = boundedUnion(a.ruleIds, b.ruleIds, MAX_RULE_IDS);
  const strength = maxValueStrength(a.strongestValueEncoding, b.strongestValueEncoding);
  if (strength !== undefined) out.strongestValueEncoding = strength;
  out.lastDay = lastDayOf(out.seen, endDay) ?? endDay;
  return out;
}

/** Merges two deltas of the same (receiver, site, day). Commutative and idempotent. */
export function mergeSightingDeltas(a: Readonly<HistorySightingDelta>, b: Readonly<HistorySightingDelta>): HistorySightingDelta {
  const out: HistorySightingDelta = { receiver: a.receiver, site: a.site, day: a.day, signals: (a.signals | b.signals) >>> 0 };
  if (a.families !== undefined || b.families !== undefined) {
    const families: Partial<Record<HistoryFamily, Interpretation>> = {};
    for (const f of HISTORY_FAMILIES) {
      const x = a.families?.[f];
      const y = b.families?.[f];
      if (x === undefined && y === undefined) continue;
      families[f] = x === undefined ? y! : y === undefined ? x : maxInterpretation(x, y);
    }
    out.families = families;
  }
  const rules = boundedUnion(a.ruleIds ?? [], b.ruleIds ?? [], MAX_RULE_IDS);
  if (rules.length > 0) out.ruleIds = rules;
  const strength = maxValueStrength(a.valueStrength, b.valueStrength);
  if (strength !== undefined) out.valueStrength = strength;
  return out;
}

/** Merges two site deltas of the same (site, day). */
export function mergeSiteDeltas(a: Readonly<HistorySiteDelta>, b: Readonly<HistorySiteDelta>): HistorySiteDelta {
  const out: HistorySiteDelta = { site: a.site, day: a.day, limited: a.limited || b.limited };
  if (a.families !== undefined || b.families !== undefined) {
    const set = new Set<HistoryFamily>([...(a.families ?? []), ...(b.families ?? [])]);
    out.families = HISTORY_FAMILIES.filter((f) => set.has(f));
  }
  return out;
}

export function applySiteDelta(record: Readonly<HistorySiteRecord> | undefined, delta: Readonly<HistorySiteDelta>): HistorySiteRecord {
  const base: HistorySiteRecord = record ?? { v: 1, site: delta.site, endDay: delta.day, lastDay: delta.day, seen: emptyDayMask(), limited: emptyDayMask(), families: {} };
  const endDay = Math.max(base.endDay, delta.day);
  const seen = setDay(alignDayMask(base.seen, base.endDay, endDay), endDay, delta.day).mask;
  let limited = alignDayMask(base.limited, base.endDay, endDay);
  if (delta.limited) limited = setDay(limited, endDay, delta.day).mask;
  const families: Partial<Record<HistoryFamily, HistoryDayMask>> = {};
  const add = new Set<HistoryFamily>(delta.families ?? []);
  for (const f of HISTORY_FAMILIES) {
    const old = base.families[f];
    if (old === undefined && !add.has(f)) continue;
    let days = old === undefined ? emptyDayMask() : alignDayMask(old, base.endDay, endDay);
    if (add.has(f)) days = setDay(days, endDay, delta.day).mask;
    if (!isEmptyDayMask(days)) families[f] = days;
  }
  return { v: 1, site: base.site, endDay, lastDay: lastDayOf(seen, endDay) ?? endDay, seen, limited, families };
}

export function mergeSiteRecords(a: Readonly<HistorySiteRecord>, b: Readonly<HistorySiteRecord>): HistorySiteRecord {
  const endDay = Math.max(a.endDay, b.endDay);
  const seen = orDayMask(alignDayMask(a.seen, a.endDay, endDay), alignDayMask(b.seen, b.endDay, endDay));
  const limited = orDayMask(alignDayMask(a.limited, a.endDay, endDay), alignDayMask(b.limited, b.endDay, endDay));
  const families: Partial<Record<HistoryFamily, HistoryDayMask>> = {};
  for (const f of HISTORY_FAMILIES) {
    const x = a.families[f];
    const y = b.families[f];
    if (x === undefined && y === undefined) continue;
    const days = orDayMask(x === undefined ? emptyDayMask() : alignDayMask(x, a.endDay, endDay), y === undefined ? emptyDayMask() : alignDayMask(y, b.endDay, endDay));
    if (!isEmptyDayMask(days)) families[f] = days;
  }
  return { v: 1, site: a.site, endDay, lastDay: lastDayOf(seen, endDay) ?? endDay, seen, limited, families: canonicalFamilies(families) };
}

export function applyReceiverDay(record: Readonly<HistoryReceiverRecord> | undefined, receiver: string, day: number): HistoryReceiverRecord {
  const base: HistoryReceiverRecord = record ?? { v: 1, receiver, endDay: day, lastDay: day, seen: emptyDayMask() };
  const endDay = Math.max(base.endDay, day);
  const seen = setDay(alignDayMask(base.seen, base.endDay, endDay), endDay, day).mask;
  return { v: 1, receiver: base.receiver, endDay, lastDay: lastDayOf(seen, endDay) ?? endDay, seen };
}

/** Accumulator key of a sighting delta. */
export function sightingDeltaKey(d: Readonly<Pick<HistorySightingDelta, 'receiver' | 'site' | 'day'>>): string {
  return d.receiver + '|' + d.site + '|' + String(d.day);
}

export function siteDeltaKey(d: Readonly<Pick<HistorySiteDelta, 'site' | 'day'>>): string {
  return d.site + '|' + String(d.day);
}

// ---------------------------------------------------------------------------
// Retention (ADR-020 §8: 7/30/90 days, applied at the next extension event). A trimmed record is re-anchored to
// `today`; days newer than today (the clock went back) are dropped; null = nothing left (delete the record).
// ---------------------------------------------------------------------------

/** True when the record has days older than the retention window or newer than today (it must be rewritten). */
export function needsRetention(endDay: number, firstDay: number | null, today: number, keepDays: number): boolean {
  return endDay > today || (firstDay !== null && firstDay < today - keepDays + 1);
}

export function retainSighting(record: Readonly<HistorySightingRecord>, today: number, keepDays: number): HistorySightingRecord | null {
  const seen = trimRetention(record.seen, record.endDay, today, keepDays);
  if (isEmptyDayMask(seen)) return null;
  const out = emptySighting(record.receiver, record.site, today);
  out.seen = seen;
  for (const key of MASK_KEYS) if (key !== 'seen') out[key] = trimRetention(record[key], record.endDay, today, keepDays);
  const families: Partial<Record<HistoryFamily, HistoryFamilyEntry>> = {};
  for (const f of HISTORY_FAMILIES) {
    const e = record.families[f];
    if (e === undefined) continue;
    const days = trimRetention(e.days, record.endDay, today, keepDays);
    if (!isEmptyDayMask(days)) families[f] = { days, interpretation: e.interpretation, attributionConfidence: 'frame-only' };
  }
  out.families = families;
  out.ruleIds = [...record.ruleIds];
  if (record.strongestValueEncoding !== undefined && !isEmptyDayMask(out.valueMatch)) out.strongestValueEncoding = record.strongestValueEncoding;
  out.lastDay = lastDayOf(seen, today) ?? today;
  return out;
}

export function retainSite(record: Readonly<HistorySiteRecord>, today: number, keepDays: number): HistorySiteRecord | null {
  const seen = trimRetention(record.seen, record.endDay, today, keepDays);
  if (isEmptyDayMask(seen)) return null;
  const families: Partial<Record<HistoryFamily, HistoryDayMask>> = {};
  for (const f of HISTORY_FAMILIES) {
    const m = record.families[f];
    if (m === undefined) continue;
    const days = trimRetention(m, record.endDay, today, keepDays);
    if (!isEmptyDayMask(days)) families[f] = days;
  }
  return { v: 1, site: record.site, endDay: today, lastDay: lastDayOf(seen, today) ?? today, seen, limited: trimRetention(record.limited, record.endDay, today, keepDays), families };
}

export function retainReceiver(record: Readonly<HistoryReceiverRecord>, today: number, keepDays: number): HistoryReceiverRecord | null {
  const seen = trimRetention(record.seen, record.endDay, today, keepDays);
  if (isEmptyDayMask(seen)) return null;
  return { v: 1, receiver: record.receiver, endDay: today, lastDay: lastDayOf(seen, today) ?? today, seen };
}
