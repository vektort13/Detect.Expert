// Approximate activity timeline of the side panel (S13, E13-02, spec V §7). Pure. Only page-hook summaries take part:
// their buckets count INTERVAL_BUCKET_MS from sensor boot in the page realm (page-controlled, local ordering only);
// browser-network buckets are seconds from the report's createdAt — a different scale that is never mixed in.

import { INTERVAL_BUCKET_MS, TECHNIQUE_IDS } from '@detect-expert/contracts';
import type { TechniqueId, TechniqueSummary } from '@detect-expert/contracts';
import { msg } from './message';
import type { Message } from './message';
import { TECHNIQUE_INFO } from './techniques';

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** At most one row per technique of the registry (69). */
export const MAX_TIMELINE_ROWS = TECHNIQUE_IDS.length;

/** A non-negative safe integer bucket pair with first <= last; anything else is not shown. */
export function validBuckets(first: unknown, last: unknown): boolean {
  return Number.isSafeInteger(first) && Number.isSafeInteger(last) && (first as number) >= 0 && (first as number) <= (last as number);
}

/**
 * Rounded-down offset of a bucket from sensor boot: under a second, whole seconds, whole minutes, or over a day.
 * A negative or non-integer input (never produced by valid data) reads as "under a second".
 */
export function bucketOffsetMessage(bucket: number): Message {
  const ms = Number.isSafeInteger(bucket) && bucket > 0 ? bucket * INTERVAL_BUCKET_MS : 0;
  if (ms < SECOND_MS) return msg('time_offset_under_second');
  if (ms < MINUTE_MS) return msg('time_offset_seconds', Math.floor(ms / SECOND_MS));
  if (ms < DAY_MS) return msg('time_offset_minutes', Math.floor(ms / MINUTE_MS));
  return msg('time_offset_over_day');
}

/** Card detail «Активность»: first and last activity after sensor start (approximate, page-context data). */
export function activityMessage(first: number, last: number): Message {
  return msg('detail_activity_value', bucketOffsetMessage(first), bucketOffsetMessage(last));
}

export interface TimelineRow {
  techniqueId: TechniqueId;
  firstBucket: number;
  lastBucket: number;
  /** Decorative bar position on a 0…100 axis (one decimal); start + width <= 100. */
  startPct: number;
  widthPct: number;
  /** Text of the row (the bar is aria-hidden). */
  label: Message;
}

function tenth(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * One row per technique among page-hook summaries (several summaries of one technique merge to min first / max last);
 * pairs that are not valid buckets are skipped. `include` limits the rows to the techniques shown by the current
 * search and filters (null = all). Axis: 0…max(1, largest last bucket); bars at least 0.5 % wide and never past 100 %.
 * Sorted by first bucket, then technique id; at most MAX_TIMELINE_ROWS.
 */
export function timelineRows(techniques: ReadonlyArray<TechniqueSummary>, include: ReadonlySet<TechniqueId> | null = null): TimelineRow[] {
  const merged = new Map<TechniqueId, { first: number; last: number }>();
  for (const summary of techniques) {
    if (summary.evidenceSource !== 'page-hook') continue;
    if (include !== null && !include.has(summary.techniqueId)) continue;
    if (!validBuckets(summary.firstBucket, summary.lastBucket)) continue;
    const existing = merged.get(summary.techniqueId);
    if (existing === undefined) merged.set(summary.techniqueId, { first: summary.firstBucket, last: summary.lastBucket });
    else merged.set(summary.techniqueId, { first: Math.min(existing.first, summary.firstBucket), last: Math.max(existing.last, summary.lastBucket) });
  }
  let axisMax = 1;
  for (const range of merged.values()) axisMax = Math.max(axisMax, range.last);
  const rows: TimelineRow[] = [];
  for (const [techniqueId, range] of merged) {
    const width = Math.min(100, Math.max(0.5, Math.floor(((range.last - range.first) / axisMax) * 1000) / 10));
    const start = Math.min(Math.floor((range.first / axisMax) * 1000) / 10, tenth(100 - width));
    const technique = techniqueId + ' ' + TECHNIQUE_INFO[techniqueId].api;
    rows.push({
      techniqueId,
      firstBucket: range.first,
      lastBucket: range.last,
      startPct: start,
      widthPct: width,
      label: msg('timeline_row', technique, bucketOffsetMessage(range.first), bucketOffsetMessage(range.last)),
    });
  }
  rows.sort((a, b) => a.firstBucket - b.firstBucket || (a.techniqueId < b.techniqueId ? -1 : a.techniqueId > b.techniqueId ? 1 : 0));
  return rows.slice(0, MAX_TIMELINE_ROWS);
}

/**
 * Card detail «Документ»: the report is about the tab's main document when the frame segment of
 * `tabId:frameId:documentId` is 0. null for any other key (no row is shown).
 */
export function documentScopeKey(documentKey: string): 'detail_document_top' | null {
  const parts = documentKey.split(':');
  return parts.length >= 3 && parts[1] === '0' ? 'detail_document_top' : null;
}
