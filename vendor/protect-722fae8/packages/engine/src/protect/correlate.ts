// ADR-020 §F (S10): correlation of MAIN send samples (page-controlled, sampled stack) with browser-observed requests.
// Pure: no chrome.*, no clock (the caller passes `now`), no URL (the caller passes masked host tokens). Classes by
// SP-14: fetch / XHR <-> `xmlhttprequest`, sendBeacon <-> `ping`, image <-> `image`. A request matches a send of its
// class whose address matches (absolute: the masked host token; relative: the request goes to the initiator's own
// host; unread: any) and whose time lies in [request - lagMs, request + leadMs] (image: imageLagMs). Greedy by request
// time (FIFO): the earliest unmatched candidate wins. Outcomes:
//   unique     one candidate script: no candidate of another script within ambiguityMs of the chosen send;
//   ambiguous  another script's candidate (matched or not) within ambiguityMs: the source cannot be told apart;
//   none       waitMs passed without a candidate;
//   gap        no candidate and samples may have been lost around the request (sequence gap or dropped sends);
//   saturated  no candidate and the document's pending-send buffer overflowed around the request.
// A request with a candidate is decided only after settleMs (a competing sample of the next MAIN flush may still come).
// The level is at most `sampled-stack`; `exact-resource` is unreachable (ADR-020 §F).

import type { ProtectSendHookPoint, SendCorrelation, SendTarget } from '@detect-expert/contracts';

export const CORRELATION_CLASSES = ['xmlhttprequest', 'ping', 'image'] as const;
export type CorrelationClass = (typeof CORRELATION_CLASSES)[number];

/** Request class of a MAIN send hook point (SP-14). */
export function sendClassOf(hookPoint: ProtectSendHookPoint): CorrelationClass {
  switch (hookPoint) {
    case 'send-fetch':
    case 'send-xhr':
      return 'xmlhttprequest';
    case 'send-beacon':
      return 'ping';
    case 'send-image':
      return 'image';
  }
}

/** Correlation class of a webRequest resource type, or null (the type has no MAIN send hook). */
export function requestClassOf(type: unknown): CorrelationClass | null {
  return type === 'xmlhttprequest' || type === 'ping' || type === 'image' ? type : null;
}

export interface CorrelationSend {
  /** Unique within the document (assigned by the caller). */
  id: number;
  cls: CorrelationClass;
  /** Time of the call on the SW clock (epoch ms; receipt time minus the sample's age). */
  t: number;
  /** Identity of the sample's ScriptRef (unsampled sends share one key). */
  scriptKey: string;
  target: SendTarget;
  /** Already paired with an earlier request (never chosen again; still counts for ambiguity). */
  matched: boolean;
}

export interface CorrelationRequest {
  id: string;
  cls: CorrelationClass;
  /** webRequest timeStamp (epoch ms). */
  t: number;
  /** Masked host token of the request (maskHost), or null when it cannot be masked (IP literal, single label). */
  hostToken: string | null;
  /** The request host equals the initiator's host (a relative address resolves there). */
  sameHostAsInitiator: boolean;
}

/** Interval of the SW clock (epoch ms) during which samples may be missing. */
export interface CorrelationInterval {
  from: number;
  to: number;
}

export interface CorrelationParams {
  now: number;
  leadMs: number;
  lagMs: number;
  imageLagMs: number;
  ambiguityMs: number;
  waitMs: number;
  settleMs: number;
  gaps: readonly CorrelationInterval[];
  saturated: readonly CorrelationInterval[];
}

export type DecidedCorrelation = Exclude<SendCorrelation, 'pending'>;

export interface CorrelationDecision {
  requestId: string;
  correlation: DecidedCorrelation;
  /** The paired send (unique / ambiguous), else null. */
  sendId: number | null;
  /** The pair was made through an unread send address (weaker: any request of the class matched). */
  viaUnreadTarget: boolean;
}

export interface CorrelationOutcome {
  /** Requests decided in this round (the others stay pending). */
  decisions: CorrelationDecision[];
  /** Sends newly paired in this round. */
  matchedSendIds: number[];
}

function lagOf(cls: CorrelationClass, params: CorrelationParams): number {
  return cls === 'image' ? params.imageLagMs : params.lagMs;
}

/** The send's address may be the request's. */
export function addressMatches(target: SendTarget, request: CorrelationRequest): boolean {
  switch (target.kind) {
    case 'absolute':
      return request.hostToken !== null && target.host === request.hostToken;
    case 'relative':
      return request.sameHostAsInitiator;
    case 'unread':
      return true;
  }
}

function inWindow(send: CorrelationSend, request: CorrelationRequest, params: CorrelationParams): boolean {
  const d = request.t - send.t;
  return d >= -params.leadMs && d <= lagOf(request.cls, params);
}

function overlaps(intervals: readonly CorrelationInterval[], from: number, to: number): boolean {
  for (const i of intervals) if (i.from <= to && i.to >= from) return true;
  return false;
}

/**
 * One correlation round over a document's pending requests and recent sends (inputs are not mutated). Requests are
 * taken in time order (stable: input order breaks ties, FIFO); each picks the earliest unmatched candidate.
 */
export function correlateSends(requests: readonly CorrelationRequest[], sends: readonly CorrelationSend[], params: CorrelationParams): CorrelationOutcome {
  const order = requests.map((r, i) => ({ r, i })).sort((a, b) => a.r.t - b.r.t || a.i - b.i);
  const byTime = sends.map((s, i) => ({ s, i })).sort((a, b) => a.s.t - b.s.t || a.s.id - b.s.id || a.i - b.i);
  const matched = new Set<number>();
  for (const s of sends) if (s.matched) matched.add(s.id);
  const decisions: CorrelationDecision[] = [];
  const matchedSendIds: number[] = [];
  for (const { r } of order) {
    const candidates: CorrelationSend[] = [];
    for (const { s } of byTime) if (s.cls === r.cls && inWindow(s, r, params) && addressMatches(s.target, r)) candidates.push(s);
    let chosen: CorrelationSend | null = null;
    for (const c of candidates) {
      if (!matched.has(c.id)) {
        chosen = c;
        break;
      }
    }
    if (chosen !== null) {
      if (params.now - r.t < params.settleMs) continue; // a competing sample may still arrive
      let ambiguous = false;
      for (const c of candidates) {
        if (c.id !== chosen.id && c.scriptKey !== chosen.scriptKey && Math.abs(c.t - chosen.t) <= params.ambiguityMs) {
          ambiguous = true;
          break;
        }
      }
      matched.add(chosen.id);
      matchedSendIds.push(chosen.id);
      decisions.push({ requestId: r.id, correlation: ambiguous ? 'ambiguous' : 'unique', sendId: chosen.id, viaUnreadTarget: chosen.target.kind === 'unread' });
      continue;
    }
    if (params.now - r.t < params.waitMs) continue;
    const from = r.t - lagOf(r.cls, params);
    const to = r.t + params.leadMs;
    const correlation: DecidedCorrelation = overlaps(params.saturated, from, to) ? 'saturated' : overlaps(params.gaps, from, to) ? 'gap' : 'none';
    decisions.push({ requestId: r.id, correlation, sendId: null, viaUnreadTarget: false });
  }
  return { decisions, matchedSendIds };
}
