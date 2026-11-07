// ADR-020 §I (S14): calendar arithmetic on journal days (`YYYY-MM-DD`, the user's local calendar) through a day number
// (days since 1970-01-01 of the proleptic Gregorian calendar). No clock and no time zone: the caller passes the local
// calendar parts of "today" (the SW reads them from Date in the browser's time zone).

import { isLocalDay } from '@detect-expert/contracts';
import type { LocalDay } from '@detect-expert/contracts';

const DAY_MS = 86_400_000;

function pad(n: number, width: number): string {
  let s = String(n);
  while (s.length < width) s = '0' + s;
  return s;
}

/** The local day of calendar parts (month 1..12), or null outside the journal range (years 2000–2999). */
export function requestLocalDay(year: number, month: number, date: number): LocalDay | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(date)) return null;
  const day = pad(year, 4) + '-' + pad(month, 2) + '-' + pad(date, 2);
  return isLocalDay(day) ? day : null;
}

/** Day number of a valid LocalDay. */
export function requestDayNumber(day: LocalDay): number {
  return Math.round(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / DAY_MS);
}

/** LocalDay of a day number, or null outside the journal range. */
export function requestDayFromNumber(n: number): LocalDay | null {
  if (!Number.isSafeInteger(n)) return null;
  const d = new Date(n * DAY_MS);
  return requestLocalDay(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** 0 = Sunday … 6 = Saturday (1970-01-01 was a Thursday). */
export function requestWeekday(day: LocalDay): number {
  return (((requestDayNumber(day) + 4) % 7) + 7) % 7;
}

export function addRequestDays(day: LocalDay, n: number): LocalDay | null {
  return requestDayFromNumber(requestDayNumber(day) + n);
}

/** Calendar months; a day that does not exist in the target month is clamped to its last day (31 Jan + 1 = 28/29 Feb). */
export function addRequestMonths(day: LocalDay, n: number): LocalDay | null {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7)) - 1 + n;
  const date = Number(day.slice(8, 10));
  const y = year + Math.floor(month / 12);
  const m = ((month % 12) + 12) % 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return requestLocalDay(y, m + 1, Math.min(date, last));
}

/** Working days Monday–Friday after `day` (public holidays are not known and not taken into account). */
export function addRequestBusinessDays(day: LocalDay, n: number): LocalDay | null {
  let num = requestDayNumber(day);
  let left = n;
  while (left > 0) {
    num++;
    const wd = (((num + 4) % 7) + 7) % 7;
    if (wd !== 0 && wd !== 6) left--;
  }
  return requestDayFromNumber(num);
}

/** b − a in days. */
export function requestDaysBetween(a: LocalDay, b: LocalDay): number {
  return requestDayNumber(b) - requestDayNumber(a);
}
