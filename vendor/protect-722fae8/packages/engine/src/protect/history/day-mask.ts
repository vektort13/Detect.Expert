// ADR-020 §G (S12): 90-day bit masks of the «Кто вас узнаёт» history. A mask is three unsigned 32-bit words; bit b
// (0..89) stands for the UTC day `endDay - b` (bit 0 = the newest day of the record). Days are UTC day indices
// (floor(epoch ms / 86 400 000)): the history keeps days only, never a time of day. Pure functions, no clock.
// Clock protection: a shift of 90 days or more (forward or back) empties the mask instead of wrapping.

import { PROTECT_BUDGETS } from '@detect-expert/contracts';
import type { LocalDay } from '@detect-expert/contracts';

export type HistoryDayMask = [number, number, number];

/** Number of days a mask covers (PROTECT_BUDGETS.historyMaskDays). */
export const HISTORY_MASK_DAYS: number = PROTECT_BUDGETS.historyMaskDays;
const DAY_MS = 86_400_000;
/** Valid bits of the third word (90 - 64 = 26). */
const TOP_WORD_MASK = (HISTORY_MASK_DAYS - 64 >= 32 ? 0xffffffff : 2 ** (HISTORY_MASK_DAYS - 64) - 1) >>> 0;
/** 2000-01-01 and 2999-12-31 as UTC day indices: the LocalDay range of the contracts. */
export const HISTORY_MIN_DAY = 10957;
export const HISTORY_MAX_DAY = 376199;

if (HISTORY_MASK_DAYS <= 64 || HISTORY_MASK_DAYS > 96) throw new Error('history: day mask must span 65..96 days');

/** UTC day index of an epoch time, clamped to the LocalDay range (2000–2999). */
export function historyDayIndex(epochMs: number): number {
  if (!Number.isFinite(epochMs)) return HISTORY_MIN_DAY;
  const day = Math.floor(epochMs / DAY_MS);
  return day < HISTORY_MIN_DAY ? HISTORY_MIN_DAY : day > HISTORY_MAX_DAY ? HISTORY_MAX_DAY : day;
}

/** `YYYY-MM-DD` of a UTC day index (clamped to 2000–2999). */
export function historyDayString(day: number): LocalDay {
  const d = Number.isSafeInteger(day) ? Math.min(HISTORY_MAX_DAY, Math.max(HISTORY_MIN_DAY, day)) : HISTORY_MIN_DAY;
  return new Date(d * DAY_MS).toISOString().slice(0, 10);
}

export function emptyDayMask(): HistoryDayMask {
  return [0, 0, 0];
}

export function isEmptyDayMask(m: Readonly<HistoryDayMask>): boolean {
  return m[0] === 0 && m[1] === 0 && m[2] === 0;
}

/** A stored mask: three u32 words, no bit above the 90th. */
export function isDayMask(value: unknown): value is HistoryDayMask {
  if (!Array.isArray(value) || value.length !== 3) return false;
  for (let i = 0; i < 3; i++) {
    const w: unknown = value[i];
    if (typeof w !== 'number' || !Number.isInteger(w) || w < 0 || w > 0xffffffff) return false;
  }
  return ((value[2] as number) & ~TOP_WORD_MASK) === 0;
}

/** A valid stored day index. */
export function isHistoryDay(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= HISTORY_MIN_DAY && value <= HISTORY_MAX_DAY;
}

function popcount32(x: number): number {
  let v = x >>> 0;
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24) & 0xff;
}

/** Number of set days. */
export function dayCount(m: Readonly<HistoryDayMask>): number {
  return popcount32(m[0]) + popcount32(m[1]) + popcount32(m[2]);
}

/** Moves bits towards older days (n > 0: bit b → b + n) or newer days (n < 0); |n| ≥ 90 empties the mask. */
export function shiftDayMask(m: Readonly<HistoryDayMask>, n: number): HistoryDayMask {
  if (n === 0) return [m[0] >>> 0, m[1] >>> 0, (m[2] & TOP_WORD_MASK) >>> 0];
  if (!Number.isSafeInteger(n) || n >= HISTORY_MASK_DAYS || n <= -HISTORY_MASK_DAYS) return [0, 0, 0];
  const out: HistoryDayMask = [0, 0, 0];
  if (n > 0) {
    const w = n >>> 5;
    const s = n & 31;
    for (let i = 2; i >= 0; i--) {
      const word = i - w;
      if (word < 0) continue;
      let v = s === 0 ? m[word]! >>> 0 : (m[word]! << s) >>> 0;
      if (s !== 0 && word - 1 >= 0) v = (v | (m[word - 1]! >>> (32 - s))) >>> 0;
      out[i] = v;
    }
  } else {
    const k = -n;
    const w = k >>> 5;
    const s = k & 31;
    for (let i = 0; i <= 2; i++) {
      const word = i + w;
      if (word > 2) continue;
      let v = m[word]! >>> s;
      if (s !== 0 && word + 1 <= 2) v = (v | (m[word + 1]! << (32 - s))) >>> 0;
      out[i] = v >>> 0;
    }
  }
  out[2] = (out[2] & TOP_WORD_MASK) >>> 0;
  return out;
}

/** The mask of a record ending on `fromEnd`, re-anchored to `toEnd` (days outside the new 90-day span are dropped). */
export function alignDayMask(m: Readonly<HistoryDayMask>, fromEnd: number, toEnd: number): HistoryDayMask {
  return shiftDayMask(m, toEnd - fromEnd);
}

export function orDayMask(a: Readonly<HistoryDayMask>, b: Readonly<HistoryDayMask>): HistoryDayMask {
  return [(a[0] | b[0]) >>> 0, (a[1] | b[1]) >>> 0, ((a[2] | b[2]) & TOP_WORD_MASK) >>> 0];
}

function andDayMask(a: Readonly<HistoryDayMask>, b: Readonly<HistoryDayMask>): HistoryDayMask {
  return [(a[0] & b[0]) >>> 0, (a[1] & b[1]) >>> 0, (a[2] & b[2]) >>> 0];
}

/** OR of two masks anchored at different end days; the result ends on the newer end day. Commutative, idempotent. */
export function alignOrDayMask(a: Readonly<HistoryDayMask>, aEnd: number, b: Readonly<HistoryDayMask>, bEnd: number): { mask: HistoryDayMask; endDay: number } {
  const endDay = Math.max(aEnd, bEnd);
  return { mask: orDayMask(alignDayMask(a, aEnd, endDay), alignDayMask(b, bEnd, endDay)), endDay };
}

/** Bits b in [lo, hi] (clamped to 0..89); empty when lo > hi. */
function rangeMask(lo: number, hi: number): HistoryDayMask {
  const a = Math.max(0, lo);
  const b = Math.min(HISTORY_MASK_DAYS - 1, hi);
  const out: HistoryDayMask = [0, 0, 0];
  if (a > b) return out;
  for (let w = 0; w < 3; w++) {
    const wLo = Math.max(a, w * 32) - w * 32;
    const wHi = Math.min(b, w * 32 + 31) - w * 32;
    if (wLo > wHi) continue;
    const width = wHi - wLo + 1;
    const bits = width >= 32 ? 0xffffffff : 2 ** width - 1;
    out[w] = (bits * 2 ** wLo) >>> 0;
  }
  out[2] = (out[2] & TOP_WORD_MASK) >>> 0;
  return out;
}

/** The mask with only the days in [fromDay, toDay] kept (same anchor). */
export function windowDayMask(m: Readonly<HistoryDayMask>, endDay: number, fromDay: number, toDay: number): HistoryDayMask {
  return andDayMask(m, rangeMask(endDay - toDay, endDay - fromDay));
}

/** Number of set days in [fromDay, toDay]. */
export function daysIn(m: Readonly<HistoryDayMask>, endDay: number, fromDay: number, toDay: number): number {
  return dayCount(windowDayMask(m, endDay, fromDay, toDay));
}

/** Sets `day` in a mask ending on `endDay`; a newer day moves the anchor. Days ≥ 90 older than the anchor are ignored. */
export function setDay(m: Readonly<HistoryDayMask>, endDay: number, day: number): { mask: HistoryDayMask; endDay: number } {
  if (day > endDay) {
    const mask = shiftDayMask(m, day - endDay);
    mask[0] = (mask[0] | 1) >>> 0;
    return { mask, endDay: day };
  }
  const b = endDay - day;
  if (b >= HISTORY_MASK_DAYS) return { mask: [m[0] >>> 0, m[1] >>> 0, m[2] >>> 0], endDay };
  return { mask: orDayMask(m, rangeMask(b, b)), endDay };
}

/** Newest set day, or null for an empty mask. */
export function lastDayOf(m: Readonly<HistoryDayMask>, endDay: number): number | null {
  for (let w = 0; w < 3; w++) {
    const v = m[w]! >>> 0;
    if (v === 0) continue;
    // Lowest set bit of the word.
    const low = 31 - Math.clz32((v & -v) >>> 0);
    return endDay - (w * 32 + low);
  }
  return null;
}

/** Oldest set day, or null for an empty mask. */
export function firstDayOf(m: Readonly<HistoryDayMask>, endDay: number): number | null {
  for (let w = 2; w >= 0; w--) {
    const v = m[w]! >>> 0;
    if (v === 0) continue;
    const high = 31 - Math.clz32(v);
    return endDay - (w * 32 + high);
  }
  return null;
}

/** Newest set day within [fromDay, toDay], or null. */
export function lastDayIn(m: Readonly<HistoryDayMask>, endDay: number, fromDay: number, toDay: number): number | null {
  return lastDayOf(windowDayMask(m, endDay, fromDay, toDay), endDay);
}

/** Oldest set day within [fromDay, toDay], or null. */
export function firstDayIn(m: Readonly<HistoryDayMask>, endDay: number, fromDay: number, toDay: number): number | null {
  return firstDayOf(windowDayMask(m, endDay, fromDay, toDay), endDay);
}

/**
 * Retention: the mask re-anchored to `today` with only the last `keepDays` days (today included). Days newer than today
 * (the clock went back) are dropped; a jump of 90 days or more empties the mask.
 */
export function trimRetention(m: Readonly<HistoryDayMask>, endDay: number, today: number, keepDays: number): HistoryDayMask {
  const aligned = alignDayMask(m, endDay, today);
  return andDayMask(aligned, rangeMask(0, Math.min(HISTORY_MASK_DAYS, Math.max(0, keepDays)) - 1));
}
