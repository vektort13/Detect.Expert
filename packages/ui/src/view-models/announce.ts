// aria-live announcements: aggregated report changes, throttled to one announcement per interval
// (spec V §7: announce the aggregate, not every API call). Pure state machine with an injected clock.

import type { ReportProjection } from '@detect-expert/contracts';
import { msg } from './message';
import type { Message } from './message';

export const ANNOUNCE_MIN_INTERVAL_MS = 2000;

export interface AnnouncerState {
  lastAt: number | null;
  lastText: string | null;
  pending: string | null;
}

export const INITIAL_ANNOUNCER: Readonly<AnnouncerState> = Object.freeze({ lastAt: null, lastText: null, pending: null });

export interface AnnounceStep {
  state: AnnouncerState;
  /** Text to put into the live region now, or null. */
  emit: string | null;
  /** When non-null, call flushAnnouncer after this many ms. */
  retryInMs: number | null;
}

export function announce(state: AnnouncerState, text: string, now: number, minIntervalMs = ANNOUNCE_MIN_INTERVAL_MS): AnnounceStep {
  if (text === state.lastText && state.pending === null) return { state, emit: null, retryInMs: null };
  if (state.lastAt === null || now - state.lastAt >= minIntervalMs) {
    return { state: { lastAt: now, lastText: text, pending: null }, emit: text, retryInMs: null };
  }
  if (text === state.lastText) return { state: { ...state, pending: null }, emit: null, retryInMs: null };
  return { state: { ...state, pending: text }, emit: null, retryInMs: state.lastAt + minIntervalMs - now };
}

export function flushAnnouncer(state: AnnouncerState, now: number, minIntervalMs = ANNOUNCE_MIN_INTERVAL_MS): AnnounceStep {
  if (state.pending === null) return { state, emit: null, retryInMs: null };
  if (state.lastAt !== null && now - state.lastAt < minIntervalMs) {
    return { state, emit: null, retryInMs: state.lastAt + minIntervalMs - now };
  }
  return { state: { lastAt: now, lastText: state.pending, pending: null }, emit: state.pending, retryInMs: null };
}

/** Aggregate announcement: number of findings and the observation state. */
export function announcementFor(report: ReportProjection | null, status: Message): Message | null {
  if (report === null) return null;
  return msg('aria_live_update', report.findings.length, status);
}
