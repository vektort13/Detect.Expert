// ADR-020 §G (S12): linking mechanisms of a history row in a day window. v1 (no cookie, no URL identifier):
// - value-match: Chrome reported sending a typed value (or its hash) to the receiver on ≥ 2 sites (onSendHeaders only);
//   high only for a hash of an e-mail or phone;
// - replay-pattern: signs of session recording towards the receiver (low);
// - frame-techniques: API families called in the receiver's own third-party frames (frame-only, page-controlled);
// - requests-only: nothing above; requests alone do not show linking (unassessed). The `request` signal is an
//   onBeforeRequest ATTEMPT (a request a DNR rule stopped is one too, SP-2): the UI never says «received» or «sent».
// Being seen on several sites is not recognition by itself: no mechanism is a verdict.

import { HISTORY_FAMILIES } from '@detect-expert/contracts';
import type { HistoryFamily, HistoryMechanismSummary, Interpretation, InterpretationConfidence } from '@detect-expert/contracts';
import { daysIn } from './day-mask';
import { maxInterpretation } from './merge';
import type { HistorySightingRecord } from './records';

/** Inclusive window of UTC day indices. */
export interface HistoryDayWindow {
  from: number;
  to: number;
}

/** value-match needs the receiver on at least this many sites (one site does not link visits). */
export const VALUE_MATCH_MIN_SITES = 2;

const CONFIDENCE_RANK: Readonly<Record<InterpretationConfidence, number>> = { unassessed: 0, low: 1, medium: 2, high: 3 };

/** Strongest interpretationConfidence of the mechanisms (−1 when there is none). */
export function mechanismConfidenceRank(mechanisms: readonly HistoryMechanismSummary[]): number {
  let best = -1;
  for (const m of mechanisms) best = Math.max(best, CONFIDENCE_RANK[m.interpretationConfidence]);
  return best;
}

/** A mechanism other than requests-only («Только с механизмами связи»). */
export function hasLinkingMechanism(mechanisms: readonly HistoryMechanismSummary[]): boolean {
  return mechanisms.some((m) => m.mechanism !== 'requests-only');
}

function inWindow(mask: HistorySightingRecord['seen'], endDay: number, w: HistoryDayWindow): boolean {
  return daysIn(mask, endDay, w.from, w.to) > 0;
}

/** Families (canonical order) of a set of sightings in the window, with the strongest interpretation and site count. */
export function frameFamilies(sightings: readonly HistorySightingRecord[], w: HistoryDayWindow): { families: HistoryFamily[]; interpretation: Interpretation | null; sites: number } {
  const seen = new Set<HistoryFamily>();
  let interpretation: Interpretation | null = null;
  const sites = new Set<string>();
  for (const s of sightings) {
    for (const f of HISTORY_FAMILIES) {
      const e = s.families[f];
      if (e === undefined || !inWindow(e.days, s.endDay, w)) continue;
      seen.add(f);
      sites.add(s.site);
      interpretation = interpretation === null ? e.interpretation : maxInterpretation(interpretation, e.interpretation);
    }
  }
  return { families: HISTORY_FAMILIES.filter((f) => seen.has(f)), interpretation, sites: sites.size };
}

/** Mechanisms of one row (all sightings of its receivers) in the window, in LINK_MECHANISMS order. */
export function historyMechanisms(sightings: readonly HistorySightingRecord[], w: HistoryDayWindow): HistoryMechanismSummary[] {
  const out: HistoryMechanismSummary[] = [];
  const vmSites = new Set<string>();
  let vmHash = false;
  const replaySites = new Set<string>();
  const requestSites = new Set<string>();
  for (const s of sightings) {
    if (inWindow(s.valueMatch, s.endDay, w)) {
      vmSites.add(s.site);
      if (s.strongestValueEncoding === 'hash') vmHash = true;
    }
    if (inWindow(s.replay, s.endDay, w)) replaySites.add(s.site);
    if (inWindow(s.request, s.endDay, w) || inWindow(s.frame, s.endDay, w)) requestSites.add(s.site);
  }
  if (vmSites.size >= VALUE_MATCH_MIN_SITES) {
    out.push({
      mechanism: 'value-match',
      sites: vmSites.size,
      evidenceSource: 'derived',
      integrity: 'derived',
      attributionConfidence: 'unknown',
      interpretationConfidence: vmHash ? 'high' : 'medium',
    });
  }
  if (replaySites.size > 0) {
    out.push({
      mechanism: 'replay-pattern',
      sites: replaySites.size,
      evidenceSource: 'derived',
      integrity: 'derived',
      attributionConfidence: 'unknown',
      interpretationConfidence: 'low',
    });
  }
  const frames = frameFamilies(sightings, w);
  if (frames.families.length > 0) {
    const interpretation = frames.interpretation ?? 'api-use';
    out.push({
      mechanism: 'frame-techniques',
      sites: frames.sites,
      families: frames.families,
      interpretation,
      evidenceSource: 'page-hook',
      integrity: 'page-controlled',
      attributionConfidence: 'frame-only',
      interpretationConfidence: interpretation === 'fingerprinting-pattern' ? 'medium' : 'low',
    });
  }
  if (out.length === 0 && requestSites.size > 0) {
    out.push({
      mechanism: 'requests-only',
      sites: requestSites.size,
      evidenceSource: 'browser-network',
      integrity: 'browser-observed',
      attributionConfidence: 'unknown',
      interpretationConfidence: 'unassessed',
    });
  }
  return out;
}
