// ADR-020 §G (S12): folds persisted observation reports and module events into history deltas (SW memory).
// Source (a), persisted reports: only committed / bfcache documents, not paused, with a host. The top-level site comes
// from the parentDocumentId chain of the frame bindings (≤ 8 steps, browser ids only). Third-party hosts of the
// document's requests → `request` (onBeforeRequest ATTEMPTS: a request a DNR rule stopped is one too, SP-2; never
// shown as «received» or «sent» and never quoted in a data-request letter); a third-party sub-frame → `frame` + the API families of its counters (frame-only,
// page-controlled); families of the top and same-site documents → `site.families` (no determined source);
// `network-limited` → `site.limited`. A memo of ≤ 256 documents skips revisions and deltas already folded today.
// Source (b), the module event bus: value-match evidence → `valueMatch`, replay-pattern → `replay`, blocked → `blocked`.
// value-match counts only a send Chrome reported (`deliveryState: 'sent'`, webRequest.onSendHeaders, ADR-020 §11): a
// record published at onBeforeRequest time is `unknown`; the service parks it by request id until the outcome tracker
// reports `sent` (`stopped`, `stopped-other` and `unknown` never count as received).
// Only registrable domains, enums and the UTC day leave this file: no URL, value, hash or time of day.

import { PROTECT_BUDGETS, isDomainName, isSiteName, sensorOfTechnique } from '@detect-expert/contracts';
import type { DocumentReport, HistoryFamily, Interpretation, ProtectEvidence, TechniqueId } from '@detect-expert/contracts';
import { HISTORY_SIGNAL_BITS, historyMaxInterpretation, isHistoryRuleId } from '@detect-expert/engine';
import type { HistorySightingDelta, HistorySiteDelta, HistoryValueStrength } from '@detect-expert/engine';
import type { FrameBinding } from '../../documents';
import type { ProtectEvent } from '../event-bus';
import type { PersistedReportInfo } from '../services';
import { siteOfHost } from '../tab-model';

/** Steps of the parentDocumentId chain to the top-level document. */
export const HISTORY_TOP_SITE_STEPS = 8;
/** Distinct delta signatures remembered per document and day. */
const MAX_MEMO_KEYS = 512;
const NETWORK_PATTERN_TECHNIQUES: ReadonlySet<TechniqueId> = new Set<TechniqueId>(['DET-060', 'DET-061']);
const HASH_ENCODINGS: ReadonlySet<string> = new Set([
  'md5-hex', 'sha1-hex', 'sha256-hex', 'sha512-hex', 'md5-base64', 'sha1-base64', 'sha256-base64', 'sha512-base64',
]);

export type HistoryFoldSkip = 'lifecycle' | 'paused' | 'no-host' | 'unchanged' | 'excluded' | 'unresolved-site';

export interface HistoryFoldResult {
  sightings: HistorySightingDelta[];
  sites: HistorySiteDelta[];
  skipped: HistoryFoldSkip | null;
}

interface MemoEntry {
  revision: number;
  day: number;
  keys: Set<string>;
}

/** LRU memo of folded documents (≤ PROTECT_BUDGETS.foldMemoDocuments). */
export class HistoryFoldMemo {
  private readonly docs = new Map<string, MemoEntry>();

  constructor(private readonly max: number = PROTECT_BUDGETS.foldMemoDocuments) {}

  get size(): number {
    return this.docs.size;
  }

  entry(documentKey: string, day: number): MemoEntry {
    let e = this.docs.get(documentKey);
    if (e !== undefined) {
      this.docs.delete(documentKey);
      if (e.day !== day) e = { revision: -1, day, keys: new Set() };
    } else e = { revision: -1, day, keys: new Set() };
    this.docs.set(documentKey, e);
    while (this.docs.size > this.max) {
      const oldest = this.docs.keys().next();
      if (oldest.done === true) break;
      this.docs.delete(oldest.value);
    }
    return e;
  }

  peek(documentKey: string): Readonly<MemoEntry> | undefined {
    return this.docs.get(documentKey);
  }

  /** True the first time `key` is seen for the document today (bounded: beyond the bound everything passes). */
  fresh(e: MemoEntry, key: string): boolean {
    if (e.keys.has(key)) return false;
    if (e.keys.size < MAX_MEMO_KEYS) e.keys.add(key);
    return true;
  }

  clear(): void {
    this.docs.clear();
  }
}

/** Top-level host of the document through the parentDocumentId chain (≤ 8 steps), or null when it cannot be resolved. */
export function topHostOf(report: Readonly<DocumentReport>, binding: Readonly<FrameBinding> | null, info: PersistedReportInfo): string | null {
  if (report.frameId === 0) return report.host;
  if (binding === null) return null;
  let cur: Readonly<FrameBinding> = binding;
  for (let step = 0; step < HISTORY_TOP_SITE_STEPS; step++) {
    const parent = cur.parentDocumentId;
    if (parent === null) return cur.frameId === 0 ? cur.host : null;
    const next = info.bindingOf(cur.tabId, parent);
    if (next === null) return null;
    if (next.documentLifecycle === 'prerender') return null;
    cur = next;
  }
  return cur.parentDocumentId === null && cur.frameId === 0 ? cur.host : null;
}

/** Family of a counter's technique, or null (network techniques and unobserved ones have no sensor family). */
function familyOfTechnique(techniqueId: TechniqueId): HistoryFamily | null {
  if (NETWORK_PATTERN_TECHNIQUES.has(techniqueId)) return 'network-patterns';
  return sensorOfTechnique(techniqueId);
}

/**
 * API families of a document with their strongest interpretation: sensor families of page-hook counters with
 * count > 0 (default 'api-use'), and network-patterns only through a DET-060/061 finding (a pattern, not one request).
 * The interpretation is the maximum over the findings of the family's techniques.
 */
export function documentFamilies(report: Readonly<DocumentReport>): Partial<Record<HistoryFamily, Interpretation>> {
  const out: Partial<Record<HistoryFamily, Interpretation>> = {};
  for (const c of report.counters) {
    if (c.count <= 0) continue;
    const f = sensorOfTechnique(c.techniqueId);
    if (f !== null && out[f] === undefined) out[f] = 'api-use';
  }
  for (const finding of report.findings) {
    const f = familyOfTechnique(finding.techniqueId);
    if (f === null) continue;
    if (f === 'network-patterns') out[f] = out[f] === undefined ? finding.interpretation : historyMaxInterpretation(out[f], finding.interpretation);
    else if (out[f] !== undefined) out[f] = historyMaxInterpretation(out[f], finding.interpretation);
  }
  return out;
}

function familiesKey(families: Partial<Record<HistoryFamily, Interpretation>>): string {
  let key = '';
  for (const [f, i] of Object.entries(families)) key += f + '=' + String(i) + ';';
  return key;
}

/**
 * Folds one persisted report into deltas for `day`. Pure apart from the memo; `isExcluded` = the module's site
 * exclusions (an excluded site writes no history).
 */
export function foldReport(
  report: Readonly<DocumentReport>,
  binding: Readonly<FrameBinding> | null,
  info: PersistedReportInfo,
  day: number,
  memo: HistoryFoldMemo,
  isExcluded: (site: string) => boolean,
): HistoryFoldResult {
  const none = (skipped: HistoryFoldSkip): HistoryFoldResult => ({ sightings: [], sites: [], skipped });
  if (report.lifecycle !== 'committed' && report.lifecycle !== 'bfcache') return none('lifecycle');
  if (info.paused) return none('paused');
  if (report.host === null) return none('no-host');
  const prior = memo.peek(report.documentKey);
  if (prior !== undefined && prior.day === day && prior.revision === report.revision) return none('unchanged');
  // The revision is remembered before the checks: an unresolved or excluded document is counted once per revision.
  const e = memo.entry(report.documentKey, day);
  e.revision = report.revision;
  const topHost = topHostOf(report, binding, info);
  const site = topHost === null ? null : siteOfHost(topHost);
  if (site === null || !isSiteName(site)) return none('unresolved-site');
  if (isExcluded(site)) return none('excluded');
  const docSite = siteOfHost(report.host);
  const thirdPartyFrame = report.frameId !== 0 && docSite !== null && docSite !== site && isDomainName(docSite);
  const families = documentFamilies(report);
  const sightings: HistorySightingDelta[] = [];
  const sites: HistorySiteDelta[] = [];
  const limited = report.coverageFlags.includes('network-limited');
  const siteFamilies = thirdPartyFrame ? [] : (Object.keys(families) as HistoryFamily[]);
  const siteKey = 's|' + (limited ? '1' : '0') + '|' + siteFamilies.join(',');
  if (memo.fresh(e, siteKey)) {
    const delta: HistorySiteDelta = { site, day, limited };
    if (siteFamilies.length > 0) delta.families = siteFamilies;
    sites.push(delta);
  }
  if (thirdPartyFrame) {
    const key = 'f|' + docSite + '|' + familiesKey(families);
    if (memo.fresh(e, key)) {
      const delta: HistorySightingDelta = { receiver: docSite, site, day, signals: HISTORY_SIGNAL_BITS.frame };
      if (Object.keys(families).length > 0) delta.families = families;
      sightings.push(delta);
    }
  }
  for (const h of report.hosts) {
    const receiver = h.registrableDomain;
    if (receiver === undefined || receiver === site || h.requestCount <= 0 || !isDomainName(receiver)) continue;
    const ruleIds = h.ruleIds.filter(isHistoryRuleId).slice(0, PROTECT_BUDGETS.maxRuleIdsPerSighting);
    const key = 'r|' + receiver + '|' + ruleIds.join(',');
    if (!memo.fresh(e, key)) continue;
    const delta: HistorySightingDelta = { receiver, site, day, signals: HISTORY_SIGNAL_BITS.request };
    if (ruleIds.length > 0) delta.ruleIds = ruleIds;
    sightings.push(delta);
  }
  return { sightings, sites, skipped: null };
}

/** value-match evidence strength: a hash of an e-mail or phone is 'hash'; everything else 'plain'. */
function valueStrength(evidence: Extract<ProtectEvidence, { protectKind: 'value-match' | 'opaque-after-input' }>): HistoryValueStrength {
  if (evidence.fieldKind === 'name') return 'plain';
  return evidence.encodings.some((enc) => HASH_ENCODINGS.has(enc)) ? 'hash' : 'plain';
}

export type HistoryEventResult = { delta: HistorySightingDelta } | { skipped: 'ignored' | 'unresolved-site' | 'excluded' };

type EvidenceEvent = Extract<ProtectEvent, { kind: 'evidence' }>;

/**
 * Request id of a value-match record whose send Chrome has not reported yet (`unknown` with the request id on the
 * event): the history waits for that request's outcome. Null for everything else.
 */
export function awaitedRequestId(event: Readonly<ProtectEvent>): string | null {
  if (event.kind !== 'evidence' || event.evidence.protectKind !== 'value-match' || event.evidence.deliveryState !== 'unknown') return null;
  const id = event.requestId;
  return typeof id === 'string' && id.length > 0 && id.length <= 64 ? id : null;
}

/** A parked value-match record once the outcome tracker reported `sent` for its request (onSendHeaders, §11). */
export function asSent(event: Readonly<EvidenceEvent>): EvidenceEvent {
  const ev = event.evidence;
  const evidence: ProtectEvidence = ev.protectKind === 'value-match' ? { ...ev, deliveryState: 'sent' } : ev;
  return { kind: 'evidence', documentKey: event.documentKey, tabId: event.tabId, site: event.site, evidence };
}

/** Source (b): one module event → at most one sighting delta for `day`. */
export function foldEvent(event: Readonly<ProtectEvent>, day: number, isExcluded: (site: string) => boolean): HistoryEventResult {
  let receiver: string | undefined;
  let signals = 0;
  let strength: HistoryValueStrength | undefined;
  if (event.kind === 'evidence') {
    const ev = event.evidence;
    if (ev.protectKind === 'value-match') {
      // Only a send Chrome reported (ADR-020 §11): `unknown` is not «received»; a send our rule or another extension
      // stopped did not reach the receiver.
      if (ev.deliveryState !== 'sent') return { skipped: 'ignored' };
      receiver = ev.receiver;
      signals = HISTORY_SIGNAL_BITS['value-match'];
      strength = valueStrength(ev);
    } else if (ev.protectKind === 'replay-pattern') {
      receiver = ev.receiver;
      signals = HISTORY_SIGNAL_BITS['replay-pattern'];
    } else return { skipped: 'ignored' };
  } else if (event.kind === 'blocked') {
    receiver = event.receiver;
    signals = HISTORY_SIGNAL_BITS['request-blocked'];
  } else return { skipped: 'ignored' };
  if (receiver === undefined || !isDomainName(receiver)) return { skipped: 'ignored' };
  const site = event.site;
  if (site === null || !isSiteName(site)) return { skipped: 'unresolved-site' };
  if (receiver === site) return { skipped: 'ignored' };
  if (isExcluded(site)) return { skipped: 'excluded' };
  const delta: HistorySightingDelta = { receiver, site, day, signals };
  if (strength !== undefined) delta.valueStrength = strength;
  return { delta };
}
