// ADR-020 §G (S12): UTC day masks of the history — bounds, shifts, clock changes, retention.

import { describe, expect, it } from 'vitest';
import {
  HISTORY_MAX_DAY,
  HISTORY_MIN_DAY,
  alignDayMask,
  alignOrDayMask,
  dayCount,
  daysIn,
  emptyDayMask,
  firstDayOf,
  firstDayIn,
  historyDayIndex,
  historyDayString,
  isDayMask,
  lastDayIn,
  lastDayOf,
  setDay,
  shiftDayMask,
  trimRetention,
  windowDayMask,
} from '../src/protect/history/day-mask';
import type { HistoryDayMask } from '../src/protect/history/day-mask';

const D = 20_000; // 2024-10-04 (UTC)

function maskOf(endDay: number, days: number[]): HistoryDayMask {
  let m = emptyDayMask();
  let end = endDay;
  for (const d of days) ({ mask: m, endDay: end } = setDay(m, end, d));
  expect(end).toBe(endDay);
  return m;
}

function daysOf(m: HistoryDayMask, endDay: number): number[] {
  const out: number[] = [];
  for (let b = 0; b < 90; b++) if (daysIn(m, endDay, endDay - b, endDay - b) === 1) out.push(endDay - b);
  return out.sort((a, b) => a - b);
}

describe('history day index (UTC, days only)', () => {
  it('maps epoch ms to UTC days and back to YYYY-MM-DD', () => {
    expect(historyDayIndex(Date.UTC(2026, 9, 18, 0, 0, 0))).toBe(historyDayIndex(Date.UTC(2026, 9, 18, 23, 59, 59)));
    expect(historyDayIndex(Date.UTC(2026, 9, 19)) - historyDayIndex(Date.UTC(2026, 9, 18, 23, 59, 59))).toBe(1);
    expect(historyDayString(historyDayIndex(Date.UTC(2026, 9, 18, 13, 0)))).toBe('2026-10-18');
  });

  it('clamps to the LocalDay range 2000–2999', () => {
    expect(historyDayIndex(0)).toBe(HISTORY_MIN_DAY);
    expect(historyDayString(HISTORY_MIN_DAY)).toBe('2000-01-01');
    expect(historyDayString(HISTORY_MAX_DAY)).toBe('2999-12-31');
    expect(historyDayIndex(Number.NaN)).toBe(HISTORY_MIN_DAY);
    expect(historyDayIndex(1e20)).toBe(HISTORY_MAX_DAY);
  });
});

describe('day mask bounds', () => {
  it('keeps exactly 90 days: bit 0 = end day, bit 89 = the oldest', () => {
    const m = maskOf(D, [D, D - 31, D - 32, D - 63, D - 64, D - 89]);
    expect(daysOf(m, D)).toEqual([D - 89, D - 64, D - 63, D - 32, D - 31, D]);
    expect(dayCount(m)).toBe(6);
    expect(isDayMask(m)).toBe(true);
    // Day 90 back is outside the mask: ignored.
    expect(setDay(m, D, D - 90).mask).toEqual(m);
    expect(lastDayOf(m, D)).toBe(D);
    expect(firstDayOf(m, D)).toBe(D - 89);
    expect(lastDayOf(emptyDayMask(), D)).toBeNull();
  });

  it('rejects masks with bits above day 89 or non-u32 words', () => {
    expect(isDayMask([0, 0, 2 ** 26])).toBe(false);
    expect(isDayMask([0, 0, 2 ** 26 - 1])).toBe(true);
    expect(isDayMask([-1, 0, 0])).toBe(false);
    expect(isDayMask([1.5, 0, 0])).toBe(false);
    expect(isDayMask([0, 0])).toBe(false);
  });

  it('daysIn / firstDayIn / lastDayIn respect the window', () => {
    const m = maskOf(D, [D, D - 5, D - 40, D - 70]);
    expect(daysIn(m, D, D - 6, D)).toBe(2);
    expect(daysIn(m, D, D - 89, D)).toBe(4);
    expect(daysIn(m, D, D + 1, D + 10)).toBe(0);
    expect(firstDayIn(m, D, D - 45, D)).toBe(D - 40);
    expect(lastDayIn(m, D, D - 45, D - 1)).toBe(D - 5);
    expect(dayCount(windowDayMask(m, D, D - 70, D - 40))).toBe(2);
  });
});

describe('day mask shifts and clock changes', () => {
  it('a newer day moves the anchor; older bits move with it', () => {
    const m = maskOf(D, [D, D - 1]);
    const { mask, endDay } = setDay(m, D, D + 3);
    expect(endDay).toBe(D + 3);
    expect(daysOf(mask, endDay)).toEqual([D - 1, D, D + 3]);
  });

  it('shifts across word boundaries in both directions', () => {
    const m = maskOf(D, [D - 30, D - 31, D - 33, D - 62, D - 63, D - 65]);
    for (const n of [1, 2, 7, 31, 32, 33, 50]) {
      const older = shiftDayMask(m, n);
      // The same days, relative to an anchor n days later.
      expect(daysOf(older, D + n).filter((d) => d >= D + n - 89)).toEqual(daysOf(m, D).filter((d) => d >= D + n - 89));
      const back = shiftDayMask(older, -n);
      expect(daysOf(back, D)).toEqual(daysOf(m, D).filter((d) => d >= D + n - 89));
    }
  });

  it('a jump of 90 days or more (either direction) empties the mask instead of wrapping', () => {
    const m = maskOf(D, [D, D - 10, D - 89]);
    expect(shiftDayMask(m, 90)).toEqual([0, 0, 0]);
    expect(shiftDayMask(m, -90)).toEqual([0, 0, 0]);
    expect(shiftDayMask(m, 10_000)).toEqual([0, 0, 0]);
    expect(alignDayMask(m, D, D + 400)).toEqual([0, 0, 0]);
    // The clock went back: realigning to an earlier anchor drops the "future" days.
    expect(daysOf(alignDayMask(m, D, D - 10), D - 10)).toEqual([D - 89, D - 10]);
  });

  it('alignOr is commutative and idempotent', () => {
    const a = maskOf(D, [D, D - 3, D - 60]);
    const b = maskOf(D + 5, [D + 5, D - 3, D - 80]);
    const ab = alignOrDayMask(a, D, b, D + 5);
    const ba = alignOrDayMask(b, D + 5, a, D);
    expect(ab).toEqual(ba);
    expect(alignOrDayMask(ab.mask, ab.endDay, ab.mask, ab.endDay)).toEqual(ab);
    expect(daysOf(ab.mask, ab.endDay)).toEqual([D - 80, D - 60, D - 3, D, D + 5]);
  });
});

describe('retention', () => {
  it('keeps the last 7/30/90 days, anchored at today', () => {
    const m = maskOf(D, [D, D - 6, D - 7, D - 29, D - 30, D - 89]);
    expect(daysOf(trimRetention(m, D, D, 7), D)).toEqual([D - 6, D]);
    expect(daysOf(trimRetention(m, D, D, 30), D)).toEqual([D - 29, D - 7, D - 6, D]);
    expect(daysOf(trimRetention(m, D, D, 90), D)).toEqual([D - 89, D - 30, D - 29, D - 7, D - 6, D]);
    // Two days later the 7-day window lost D-6 and D-7... and kept D.
    expect(daysOf(trimRetention(m, D, D + 2, 7), D + 2)).toEqual([D]);
  });

  it('drops days after today (the clock went back) and empties on long jumps', () => {
    const m = maskOf(D, [D, D - 1, D - 2]);
    expect(daysOf(trimRetention(m, D, D - 1, 30), D - 1)).toEqual([D - 2, D - 1]);
    expect(trimRetention(m, D, D - 200, 30)).toEqual([0, 0, 0]);
    expect(trimRetention(m, D, D + 200, 90)).toEqual([0, 0, 0]);
  });
});
