// ADR-020 §I (S14): observations quoted in a data request. Adapters copy fields BY NAME from a module evidence record
// (ProtectEvidence, storage.session) or a history sighting into RequestEvidenceFact — nothing is spread, so a field
// added to the source later never reaches a letter or the journal. A fact has no value, hash, mask, length, URL or
// query: days, registrable domains, an endpoint template, enums and a parameter name only.

import { PROTECT_BUDGETS, VALUE_ENCODINGS, isDomainName, isEndpointPathTemplate, isLocalDay } from '@detect-expert/contracts';
import type {
  InterpretationConfidence,
  LocalDay,
  ProtectEvidence,
  RequestEndpoint,
  RequestEvidenceFact,
  ScriptRef,
  ValueEncoding,
} from '@detect-expert/contracts';
import { historyDayString, lastDayOf } from '../history/day-mask';
import type { HistorySightingRecord } from '../history/records';

function copyScript(s: ScriptRef): ScriptRef {
  if (s.kind === 'external' && s.scheme !== undefined && s.host !== undefined && s.pathTemplate !== undefined) {
    return { kind: 'external', scheme: s.scheme, host: s.host, pathTemplate: s.pathTemplate };
  }
  return { kind: s.kind };
}

function copyEndpoint(e: RequestEndpoint): RequestEndpoint {
  return { scheme: e.scheme, host: e.host, pathTemplate: e.pathTemplate };
}

/** Field-by-field copy of a validated fact (journal records, export, letters). */
export function copyRequestFact(f: Readonly<RequestEvidenceFact>): RequestEvidenceFact {
  return {
    factKind: f.factKind,
    day: f.day,
    site: f.site,
    receiverDomain: f.receiverDomain,
    endpoint: f.endpoint === null ? null : copyEndpoint(f.endpoint),
    script: f.script === null ? null : copyScript(f.script),
    dataKind: f.dataKind,
    encoding: f.encoding,
    location: f.location,
    parameterName: f.parameterName,
    submitTiming: f.submitTiming,
    techniqueIds: [...f.techniqueIds],
    vendorId: f.vendorId,
    evidenceSource: f.evidenceSource,
    integrity: f.integrity,
    interpretationConfidence: f.interpretationConfidence,
  };
}

/** The encoding a letter names: the first of the record's encodings in VALUE_ENCODINGS order (plain before hashes). */
export function primaryRequestEncoding(encodings: readonly ValueEncoding[]): ValueEncoding | null {
  for (const e of VALUE_ENCODINGS) if (encodings.includes(e)) return e;
  return null;
}

export interface EvidenceFactContext {
  /** Local day of the observation. */
  day: LocalDay;
  /** Registrable domain of the top-level site of the document. */
  site: string;
  /**
   * Scheme of the endpoint when it is known; the evidence itself carries host + path template only. The SW passes
   * 'https' for a non-navigation request of an https top-level document (Chrome blocks or upgrades mixed content), else
   * null: then the fact names no endpoint, only the receiver.
   */
  endpointScheme: 'https' | null;
}

/**
 * Fact of one evidence record, or null when it says nothing a letter may quote: a transfer whose request was not
 * observed as sent (ADR-020 §11: stopped or outcome unknown), or a record without a usable site / day.
 */
export function requestFactFromEvidence(e: Readonly<ProtectEvidence>, ctx: EvidenceFactContext): RequestEvidenceFact | null {
  if (!isLocalDay(ctx.day) || !isDomainName(ctx.site)) return null;
  const script = e.attributionConfidence === 'sampled-stack' && e.script !== undefined ? copyScript(e.script) : null;
  const base: Pick<RequestEvidenceFact, 'day' | 'site' | 'script' | 'techniqueIds' | 'vendorId' | 'evidenceSource' | 'integrity'> = {
    day: ctx.day,
    site: ctx.site,
    script,
    techniqueIds: [],
    vendorId: null,
    evidenceSource: e.evidenceSource,
    integrity: e.integrity,
  };
  switch (e.protectKind) {
    case 'value-match':
    case 'opaque-after-input': {
      if (e.deliveryState !== 'sent') return null;
      const receiverDomain = e.receiver !== undefined && isDomainName(e.receiver) ? e.receiver : null;
      const endpoint =
        ctx.endpointScheme !== null && e.requestKind !== 'navigation' && e.endpointHost !== null && isDomainName(e.endpointHost) && isEndpointPathTemplate(e.endpointPathTemplate)
          ? { scheme: ctx.endpointScheme, host: e.endpointHost, pathTemplate: e.endpointPathTemplate }
          : null;
      const encoding = e.protectKind === 'value-match' ? primaryRequestEncoding(e.encodings) : null;
      if (e.protectKind === 'value-match' && encoding === null) return null;
      return {
        ...base,
        factKind: e.protectKind,
        receiverDomain,
        endpoint,
        dataKind: e.fieldKind,
        encoding,
        location: e.location ?? null,
        parameterName: e.paramName ?? null,
        submitTiming: e.submitTiming,
        interpretationConfidence: e.interpretationConfidence,
      };
    }
    case 'password-field-listener':
      return {
        ...base,
        factKind: 'password-field-listener',
        receiverDomain: null,
        endpoint: null,
        dataKind: null,
        encoding: null,
        location: null,
        parameterName: null,
        submitTiming: null,
        interpretationConfidence: e.interpretationConfidence,
      };
    case 'replay-pattern':
      return {
        ...base,
        factKind: 'session-replay',
        receiverDomain: isDomainName(e.receiver) ? e.receiver : null,
        endpoint: null,
        dataKind: null,
        encoding: null,
        location: null,
        parameterName: null,
        submitTiming: null,
        interpretationConfidence: e.interpretationConfidence,
      };
  }
}

/**
 * Last UTC day index on which a history sighting holds a signal Chrome reported as SENT, or null (ADR-020 §11). Sent
 * signals: `valueMatch` (counted only for `deliveryState: 'sent'`, webRequest.onSendHeaders) and `replay` (the
 * session-recording cadence counts onSendHeaders sends only). Not sends: `request` (onBeforeRequest attempts of the
 * observation report — a request a DNR rule stopped is one too, SP-2), `blocked` (our rule stopped it) and `frame`.
 */
export function requestSightingSentDay(s: Readonly<Pick<HistorySightingRecord, 'endDay' | 'valueMatch' | 'replay'>>): number | null {
  const valueMatch = lastDayOf(s.valueMatch, s.endDay);
  const replay = lastDayOf(s.replay, s.endDay);
  if (valueMatch === null) return replay;
  return replay === null ? valueMatch : Math.max(valueMatch, replay);
}

/**
 * One receiver on one site from the history «Кто вас узнаёт»: the sighting record's day masks (only the value-match
 * and replay days are read; the request / blocked / frame masks are deliberately not part of the input).
 */
export type RequestSightingInput = Pick<HistorySightingRecord, 'receiver' | 'site' | 'endDay' | 'valueMatch' | 'replay'>;

/**
 * Fact of a history sighting: the browser sent requests to the receiver while the user was on the site, on the last
 * day Chrome reported such a send (requestSightingSentDay). A sighting without one — request attempts only, blocked
 * only — gives no fact (null), so a letter never says «sent» about a request that may have been stopped (ADR-020 §11).
 * Presence on several sites alone is no evidence of recognising the user, so the interpretation is `unassessed`.
 */
export function requestFactFromSighting(s: Readonly<RequestSightingInput>): RequestEvidenceFact | null {
  if (!isDomainName(s.receiver) || !isDomainName(s.site)) return null;
  const sentDay = requestSightingSentDay(s);
  if (sentDay === null) return null;
  const day = historyDayString(sentDay);
  if (!isLocalDay(day)) return null;
  return {
    factKind: 'cross-site-sighting',
    day,
    site: s.site,
    receiverDomain: s.receiver,
    endpoint: null,
    script: null,
    dataKind: null,
    encoding: null,
    location: null,
    parameterName: null,
    submitTiming: null,
    techniqueIds: [],
    vendorId: null,
    evidenceSource: 'browser-network',
    integrity: 'browser-observed',
    interpretationConfidence: 'unassessed',
  };
}

const CONFIDENCE_RANK: Readonly<Record<InterpretationConfidence, number>> = { high: 3, medium: 2, low: 1, unassessed: 0 };

/** Identity of a fact for de-duplication (the same observation quoted twice reads as two). */
export function requestFactKey(f: Readonly<RequestEvidenceFact>): string {
  return [f.factKind, f.day, f.site, f.receiverDomain ?? '', f.endpoint === null ? '' : f.endpoint.host + f.endpoint.pathTemplate, f.dataKind ?? '', f.encoding ?? '', f.location ?? '', f.parameterName ?? ''].join('|');
}

/** De-duplicated facts by confidence (high first), then day (newest first); at most maxFactsPerRequest. */
export function rankRequestFacts(facts: readonly RequestEvidenceFact[]): RequestEvidenceFact[] {
  const seen = new Set<string>();
  const unique: RequestEvidenceFact[] = [];
  for (const f of facts) {
    const key = requestFactKey(f);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(f);
  }
  unique.sort((a, b) => CONFIDENCE_RANK[b.interpretationConfidence] - CONFIDENCE_RANK[a.interpretationConfidence] || (a.day === b.day ? 0 : a.day > b.day ? -1 : 1));
  return unique.slice(0, PROTECT_BUDGETS.maxFactsPerRequest);
}

/** Facts ticked by default in the composer: low and unassessed are not (the user decides to quote them). */
export function requestFactCheckedByDefault(f: Readonly<RequestEvidenceFact>): boolean {
  return f.interpretationConfidence === 'medium' || f.interpretationConfidence === 'high';
}
