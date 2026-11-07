// ADR-020 §F (S10, E11-lite): script attribution in the service worker. Everything here is SW memory only (no storage,
// no IndexedDB): at most maxCorrelationDocuments documents (LRU), send samples kept SAMPLE_TTL_MS (3 s), decided
// attributions kept RESULT_TTL_MS for the lanes that read them. Inputs:
//   - protect-events from protect.js (page-controlled MAIN samples relayed by ISOLATED; the document key comes from
//     MessageSender only, never from the payload; REQ-004);
//   - webRequest requests of the classes with a MAIN send hook (xmlhttprequest, ping, image) and `script` requests
//     (scriptLoadObserved). net-hub hands bodies only for armed tabs (onRequest); onSendHeaders covers every tab while
//     the shared listeners run; the requestId de-duplicates the two. A request stopped by DNR has no onSendHeaders, so
//     outside armed tabs it is never attributed (limitation of the browser events, ADR-020 §11).
// Output: the port `attributionFor(requestId)` -> ScriptAttribution (value-match S07 `ProtectEvidence.script`, firewall
// S08 `sender.script`), `onResolved` (once per request when it leaves `pending`), `scriptActivity(documentKey)` (S11),
// and `password-field-listener` facts (registration of an input listener on a password field; the value is never read
// by any layer). The level is at most `sampled-stack` and every attribution is page-controlled.

import { MAX_COUNT, PROTECT_BUDGETS, PROTECT_WIRE_LIMITS, makeDocumentKey } from '@detect-expert/contracts';
import type {
  CountQuality,
  FrameContext,
  ListenEventCode,
  ListenTargetKind,
  ProtectEventsMessage,
  ProtectHookPoint,
  ProtectLimitation,
  ProtectListenerEvidence,
  ProtectPageMessage,
  RegistrationSampleSw,
  ScriptActivityEntry,
  ScriptAttribution,
  ScriptRef,
  SendCorrelation,
  SendSampleSw,
  SiteRelation,
} from '@detect-expert/contracts';
import { correlateSends, requestClassOf, sendClassOf } from '@detect-expert/engine';
import type { CorrelationClass, CorrelationDecision, CorrelationInterval, CorrelationRequest, CorrelationSend } from '@detect-expert/engine';
import { maskHost, scriptRefKey } from '../../../../attribution/src/script-ref';
import { registrableDomain } from '../../../../attribution/src/index';
import type { RequestDetailsLike } from '../../chrome-api';
import type { PageSenderContext } from '../../sender';
import { fastHost } from '../net-hub';
import type { ProtectRequestContext } from '../net-hub';
import type { ProtectFeatureService, ProtectServiceContext, ProtectStopReason } from '../services';
import { siteOfHost } from '../tab-model';

/** Send samples older than this (SW clock) can no longer pair with a new request (lag ≤ 2 s) and are dropped. */
export const SAMPLE_TTL_MS = 3000;
/** Decided attributions stay readable this long (the outcome TTL: lanes may read them while showing a request). */
export const RESULT_TTL_MS = PROTECT_BUDGETS.outcomeTtlMs;
/** Bound of decided attributions kept (as the pending outcomes). */
export const MAX_RESULTS = PROTECT_BUDGETS.maxPendingOutcomes;
/**
 * A request with a candidate is decided after this delay: a competing sample of the next MAIN flush (flushMs) and
 * relay window may still arrive within the ambiguity window.
 */
export const SETTLE_MS = 2 * PROTECT_BUDGETS.flushMs + PROTECT_BUDGETS.correlationAmbiguityMs;
/** Correlation tick while anything is pending. */
export const TICK_MS = PROTECT_BUDGETS.flushMs;
/** Gap / saturation intervals remembered per document. */
export const MAX_INTERVALS = 8;
/** Masked hosts of `script` requests remembered per document (scriptLoadObserved). */
export const MAX_SCRIPT_HOSTS = 32;
/** MAIN boots tracked per document (re-injection races; as the relay's bound). */
export const MAX_BOOTS = 4;
/** Subscribers of onResolved. */
export const MAX_RESOLVED_LISTENERS = 8;
/** Event codes of a password-field registration that make a `password-field-listener` fact. */
export const PASSWORD_LISTENER_EVENTS: ReadonlySet<ListenEventCode> = new Set<ListenEventCode>(['input', 'keydown', 'keyup', 'keypress', 'beforeinput', 'change']);
export const PASSWORD_LISTENER_RULE_VERSION = '1';

export type AttributionListener = (requestId: string, documentKey: string, attribution: ScriptAttribution) => void;

/** The attribution port (ctx.ports.attribution while the lane runs). Page-controlled data, memory only. */
export interface AttributionPort {
  /** Attribution of a request by its webRequest requestId: `pending` until decided; null for a request never seen. */
  attributionFor(requestId: string): ScriptAttribution | null;
  /** Called once per request when its correlation leaves `pending`. Returns the unsubscribe function. */
  onResolved(listener: AttributionListener): () => void;
  /** Script activity of a document (send and registration samples), at most maxScriptActivityPerDocument entries. */
  scriptActivity(documentKey: string): ScriptActivityEntry[];
}

interface SendEntry extends CorrelationSend {
  script: ScriptRef;
  sampled: boolean;
}

interface RequestEntry extends CorrelationRequest {
  /** Exact host of the request initiator (memory only; site computed lazily). */
  initiatorHost: string | null;
}

interface BootState {
  lastSendSeq: number;
  lastSendT: number;
}

interface ActivityEntry {
  script: ScriptRef;
  hookPoints: Set<ProtectHookPoint>;
  eventCodes: Set<ListenEventCode>;
  targetKinds: Set<ListenTargetKind>;
  count: number;
  sampledCount: number;
  countQuality: CountQuality;
}

interface DocState {
  documentKey: string;
  tabId: number;
  touchedAt: number;
  boots: Map<string, BootState>;
  relay: { id: string; batchSeq: number } | null;
  sends: SendEntry[];
  nextSendId: number;
  requests: RequestEntry[];
  gaps: CorrelationInterval[];
  saturated: CorrelationInterval[];
  scriptHosts: Set<string>;
  activity: Map<string, ActivityEntry>;
  /** MAIN reported `stack-unavailable` (the page changed the error mechanism). */
  stackUnavailable: boolean;
  /** At least one protect-events message arrived (MAIN hooks run in this document). */
  sawEvents: boolean;
}

interface ResultEntry {
  documentKey: string;
  attribution: ScriptAttribution;
  at: number;
  /** Request class and masked host token (test harness only; never stored). */
  cls: CorrelationClass;
  hostToken: string | null;
}

const ORDERED_HOOK_POINTS: readonly ProtectHookPoint[] = ['send-fetch', 'send-xhr', 'send-beacon', 'send-image', 'listen', 'observe-document'];
const ORDERED_TARGET_KINDS: readonly ListenTargetKind[] = ['window', 'document', 'root', 'field', 'field-password', 'other'];
const UNKNOWN_KEY = 'unknown';

function satAdd(a: number, b: number): number {
  return Math.min(MAX_COUNT, Math.max(0, a) + Math.max(0, b));
}

function pushInterval(list: CorrelationInterval[], from: number, to: number): void {
  list.push({ from: Math.min(from, to), to: Math.max(from, to) });
  while (list.length > MAX_INTERVALS) list.shift();
}

/** Registrable domain of a masked host: leading `*` labels are dropped; a `*` left inside -> null. */
export function siteOfMaskedHost(host: string | undefined): string | null {
  if (typeof host !== 'string') return null;
  let rest = host;
  while (rest.startsWith('*.')) rest = rest.slice(2);
  if (rest.includes('*')) return null;
  return registrableDomain(rest);
}

function pendingAttribution(): ScriptAttribution {
  return {
    script: null,
    scriptSite: null,
    scriptRelation: 'unknown',
    attributionConfidence: 'unknown',
    evidenceSource: 'page-hook',
    integrity: 'page-controlled',
    correlation: 'pending',
    scriptLoadObserved: false,
    limitationCodes: [],
  };
}

function canonicalLimitations(codes: readonly ProtectLimitation[]): ProtectLimitation[] {
  const out: ProtectLimitation[] = [];
  for (const c of codes) if (!out.includes(c)) out.push(c);
  return out.slice(0, PROTECT_WIRE_LIMITS.maxEvidenceLimitations);
}

export interface AttributionServiceOptions {
  /** Timer seam (tests); default setTimeout / clearTimeout. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Evidence id source (tests); default 8 random base-36 characters. */
  evidenceId?: () => string;
}

function randomEvidenceId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  let out = 'pe-';
  for (const b of bytes) out += (b % 36).toString(36);
  return out;
}

export class AttributionService implements ProtectFeatureService {
  readonly name = 'attribution' as const;
  readonly features = ['value-match', 'firewall', 'session-replay'] as const;

  private ctx: ProtectServiceContext | null = null;
  private readonly docs = new Map<string, DocState>();
  private readonly results = new Map<string, ResultEntry>();
  /** requestId -> documentKey of requests still pending. */
  private readonly pendingIndex = new Map<string, string>();
  private readonly listeners: AttributionListener[] = [];
  private timer: unknown = null;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly newEvidenceId: () => string;
  private stats = { requests: 0, events: 0, rejectedSamples: 0, listenerFacts: 0, unique: 0, ambiguous: 0, none: 0, gap: 0, saturated: 0 };
  readonly port: AttributionPort;

  constructor(options: AttributionServiceOptions = {}) {
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.newEvidenceId = options.evidenceId ?? randomEvidenceId;
    this.port = {
      attributionFor: (requestId) => this.attributionFor(requestId),
      onResolved: (listener) => this.subscribe(listener),
      scriptActivity: (documentKey) => this.scriptActivity(documentKey),
    };
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  start(ctx: ProtectServiceContext): void {
    this.ctx = ctx;
    ctx.ports.attribution = this.port;
  }

  stop(_reason: ProtectStopReason): void {
    if (this.ctx !== null && this.ctx.ports.attribution === this.port) this.ctx.ports.attribution = null;
    this.clearAll();
    this.listeners.length = 0;
    this.ctx = null;
  }

  private clearAll(): void {
    this.docs.clear();
    this.results.clear();
    this.pendingIndex.clear();
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  onClearSession(): void {
    this.clearAll();
  }

  // A new top-level document does not drop the tab's earlier documents: samples flushed on pagehide (beacons on
  // unload) still pair with their requests; the LRU bound and the TTLs clean them up.
  onTabRemoved(tabId: number): void {
    this.forgetTab(tabId);
  }

  private forgetTab(tabId: number): void {
    for (const [key, doc] of [...this.docs]) {
      if (doc.tabId !== tabId) continue;
      for (const r of doc.requests) this.pendingIndex.delete(r.id);
      this.docs.delete(key);
    }
  }

  // ---------------------------------------------------------------------------
  // Port
  // ---------------------------------------------------------------------------

  attributionFor(requestId: string): ScriptAttribution | null {
    if (typeof requestId !== 'string') return null;
    const r = this.results.get(requestId);
    if (r !== undefined) {
      if (this.now() - r.at <= RESULT_TTL_MS) return r.attribution;
      this.results.delete(requestId);
      return null;
    }
    return this.pendingIndex.has(requestId) ? pendingAttribution() : null;
  }

  private subscribe(listener: AttributionListener): () => void {
    if (typeof listener !== 'function' || this.listeners.length >= MAX_RESOLVED_LISTENERS) return () => undefined;
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  scriptActivity(documentKey: string): ScriptActivityEntry[] {
    const doc = this.docs.get(documentKey);
    if (doc === undefined) return [];
    const out: ScriptActivityEntry[] = [];
    for (const a of doc.activity.values()) {
      out.push({
        script: a.script,
        scriptSite: a.script.kind === 'external' ? siteOfMaskedHost(a.script.host) : null,
        hookPoints: ORDERED_HOOK_POINTS.filter((h) => a.hookPoints.has(h)),
        eventCodes: [...a.eventCodes],
        targetKinds: ORDERED_TARGET_KINDS.filter((k) => a.targetKinds.has(k)),
        count: a.count,
        sampledCount: a.sampledCount,
        countQuality: a.countQuality,
      });
      if (out.length >= PROTECT_BUDGETS.maxScriptActivityPerDocument) break;
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Documents
  // ---------------------------------------------------------------------------

  private now(): number {
    return this.ctx?.clock.now() ?? Date.now();
  }

  private doc(documentKey: string, tabId: number, now: number): DocState {
    let doc = this.docs.get(documentKey);
    if (doc !== undefined) {
      this.docs.delete(documentKey);
      this.docs.set(documentKey, doc);
      doc.touchedAt = now;
      return doc;
    }
    doc = {
      documentKey,
      tabId,
      touchedAt: now,
      boots: new Map(),
      relay: null,
      sends: [],
      nextSendId: 1,
      requests: [],
      gaps: [],
      saturated: [],
      scriptHosts: new Set(),
      activity: new Map(),
      stackUnavailable: false,
      sawEvents: false,
    };
    this.docs.set(documentKey, doc);
    while (this.docs.size > PROTECT_BUDGETS.maxCorrelationDocuments) {
      const oldest = this.docs.keys().next();
      if (oldest.done) break;
      const evicted = this.docs.get(oldest.value)!;
      // Pending requests of an evicted document can no longer pair: decided as `saturated` (a budget was hit).
      for (const r of [...evicted.requests]) this.decide(evicted, { requestId: r.id, correlation: 'saturated', sendId: null, viaUnreadTarget: false }, r, now);
      this.docs.delete(oldest.value);
    }
    return doc;
  }

  // ---------------------------------------------------------------------------
  // Page channel: protect-events (page-controlled)
  // ---------------------------------------------------------------------------

  onPageMessage(sender: PageSenderContext, message: ProtectPageMessage): void {
    if (message.type !== 'protect-events' || this.ctx === null) return;
    if (this.ctx.isTabExcluded(sender.tabId)) return;
    this.stats.events++;
    const now = this.now();
    const doc = this.doc(sender.documentKey, sender.tabId, now);
    doc.sawEvents = true;
    this.noteRelay(doc, message, now);
    if (message.limitations.includes('stack-unavailable')) doc.stackUnavailable = true;
    const lost = message.dropped.sends + message.dropped.unsampled;
    if (lost > 0 || message.limitations.includes('budget-exceeded')) pushInterval(doc.gaps, now - PROTECT_BUDGETS.maxSampleAgeMs, now);
    for (const s of message.sends) this.noteSend(doc, message.sensorBootId, s, now);
    for (const r of message.registrations) this.noteRegistration(doc, sender, r, now);
    if (message.dropped.registrations > 0) for (const a of doc.activity.values()) a.countQuality = 'lower-bound';
    this.correlate(doc, now);
    this.schedule();
  }

  /** A jump of the relay's batch sequence = a lost protect-events message (a gap of unknown samples). */
  private noteRelay(doc: DocState, message: ProtectEventsMessage, now: number): void {
    const relay = doc.relay;
    if (relay !== null && relay.id === message.relaySessionId) {
      if (message.batchSeq > relay.batchSeq + 1) pushInterval(doc.gaps, now - PROTECT_BUDGETS.maxSampleAgeMs, now);
      if (message.batchSeq > relay.batchSeq) relay.batchSeq = message.batchSeq;
      return;
    }
    doc.relay = { id: message.relaySessionId, batchSeq: message.batchSeq };
    if (message.batchSeq > 1) pushInterval(doc.gaps, now - PROTECT_BUDGETS.maxSampleAgeMs, now);
  }

  private noteSend(doc: DocState, bootId: string, s: SendSampleSw, now: number): void {
    const t = now - s.ageMs;
    let boot = doc.boots.get(bootId);
    if (boot === undefined) {
      while (doc.boots.size >= MAX_BOOTS) {
        const oldest = doc.boots.keys().next();
        if (oldest.done) break;
        doc.boots.delete(oldest.value);
      }
      boot = { lastSendSeq: 0, lastSendT: t };
      doc.boots.set(bootId, boot);
      if (s.sensorSeq > 1) pushInterval(doc.gaps, t - PROTECT_BUDGETS.maxSampleAgeMs, t);
    } else if (s.sensorSeq <= boot.lastSendSeq) {
      // Replayed or reordered by the page: never paired twice.
      this.stats.rejectedSamples++;
      return;
    } else if (s.sensorSeq > boot.lastSendSeq + 1) {
      pushInterval(doc.gaps, boot.lastSendT, t);
    }
    boot.lastSendSeq = s.sensorSeq;
    boot.lastSendT = t;
    this.expireSends(doc, now);
    if (doc.sends.length >= PROTECT_BUDGETS.maxPendingSendsPerDocument) {
      // 64/64: the oldest sample goes; requests around it are decided as `saturated` when they find no pair.
      const evicted = doc.sends.shift()!;
      pushInterval(doc.saturated, evicted.t, t);
    }
    const sampledScript = s.sampled && s.script.kind !== 'unknown';
    doc.sends.push({
      id: doc.nextSendId++,
      cls: sendClassOf(s.hookPoint),
      t,
      scriptKey: sampledScript ? scriptRefKey(s.script) : UNKNOWN_KEY,
      target: s.target,
      matched: false,
      script: s.script,
      sampled: s.sampled,
    });
    this.noteActivity(doc, s.script, s.sampled, s.hookPoint, null, null, 1);
  }

  /** Drops samples older than SAMPLE_TTL_MS, except those a still pending request may pair with (a late tick). */
  private expireSends(doc: DocState, now: number): void {
    let cutoff = now - SAMPLE_TTL_MS;
    for (const r of doc.requests) cutoff = Math.min(cutoff, r.t - PROTECT_BUDGETS.correlationImageLagMs);
    while (doc.sends.length > 0 && doc.sends[0]!.t < cutoff) doc.sends.shift();
  }

  private noteActivity(doc: DocState, script: ScriptRef, sampled: boolean, hookPoint: ProtectHookPoint, eventCode: ListenEventCode | null, targetKind: ListenTargetKind | null, count: number): void {
    let key = sampled && script.kind !== 'unknown' ? scriptRefKey(script) : UNKNOWN_KEY;
    let entry = doc.activity.get(key);
    if (entry === undefined) {
      // One slot stays for the unattributed entry: a new script beyond the bound folds into it (lower bound).
      if (key !== UNKNOWN_KEY && doc.activity.size >= PROTECT_BUDGETS.maxScriptActivityPerDocument - (doc.activity.has(UNKNOWN_KEY) ? 0 : 1)) {
        key = UNKNOWN_KEY;
        entry = doc.activity.get(key);
        if (entry !== undefined) entry.countQuality = 'lower-bound';
      }
      if (entry === undefined) {
        entry = {
          script: key === UNKNOWN_KEY ? { kind: 'unknown' } : script,
          hookPoints: new Set(),
          eventCodes: new Set(),
          targetKinds: new Set(),
          count: 0,
          sampledCount: 0,
          countQuality: 'exact',
        };
        doc.activity.set(key, entry);
      }
    }
    entry.hookPoints.add(hookPoint);
    if (eventCode !== null) entry.eventCodes.add(eventCode);
    if (targetKind !== null) entry.targetKinds.add(targetKind);
    entry.count = satAdd(entry.count, count);
    if (sampled) entry.sampledCount = satAdd(entry.sampledCount, count);
  }

  private noteRegistration(doc: DocState, sender: PageSenderContext, r: RegistrationSampleSw, now: number): void {
    const eventCode = r.eventCode ?? null;
    this.noteActivity(doc, r.script, r.sampled, r.hookPoint, eventCode, r.targetKind, r.count);
    if (r.hookPoint === 'listen' && r.targetKind === 'field-password' && eventCode !== null && PASSWORD_LISTENER_EVENTS.has(eventCode)) {
      this.passwordListenerFact(sender, r, now);
    }
  }

  /**
   * `password-field-listener` (ADR-020 §F): a page script registered an input listener on a password field. The
   * registration only: the module never reads the value (no layer wraps or calls the `value` getter). Stored under the
   * tab's top-level document with the frame context; interpretationConfidence is always `low`.
   */
  private passwordListenerFact(sender: PageSenderContext, r: RegistrationSampleSw, now: number): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    const topKey = sender.frameId === 0 ? sender.documentKey : ctx.tabModel.topDocumentKey(sender.tabId);
    if (topKey === null) return; // the tab's top document is unknown: fail closed (no record)
    let frameContext: FrameContext = 'top';
    let frameSite: string | null = null;
    if (sender.frameId !== 0) {
      frameSite = siteOfHost(sender.host);
      const topSite = ctx.tabModel.get(sender.tabId)?.site ?? null;
      frameContext = frameSite !== null && topSite !== null && frameSite === topSite ? 'same-site-frame' : 'cross-site-frame';
    }
    const attributed = r.sampled && r.script.kind !== 'unknown';
    const doc = ctx.docStore.ensure(topKey, sender.tabId);
    const second = Math.max(0, Math.min(PROTECT_WIRE_LIMITS.maxEvidenceSecond, Math.floor((now - doc.createdAt) / 1000)));
    const limitationCodes: ProtectLimitation[] = attributed ? ['nearest-frame-only'] : [r.sampled ? 'stack-unavailable' : 'stack-budget'];
    const evidence: ProtectListenerEvidence = {
      evidenceId: this.newEvidenceId(),
      frameContext,
      ...(frameContext !== 'top' && frameSite !== null ? { frameSite } : {}),
      ...(attributed ? { script: r.script } : {}),
      attributionConfidence: attributed ? 'sampled-stack' : 'unknown',
      count: Math.max(1, Math.min(MAX_COUNT, r.count)),
      countQuality: 'exact',
      firstSecond: second,
      lastSecond: second,
      evidenceSource: 'derived',
      integrity: 'derived',
      ruleVersion: PASSWORD_LISTENER_RULE_VERSION,
      limitationCodes,
      protectKind: 'password-field-listener',
      ruleId: 'password-listener',
      interpretationConfidence: 'low',
    };
    const merged = ctx.docStore.addEvidence(topKey, sender.tabId, evidence);
    if (merged === null || merged.index < 0) return;
    this.stats.listenerFacts++;
    const stored = merged.evidence[merged.index]!;
    ctx.eventBus.publish({ kind: 'evidence', documentKey: topKey, tabId: sender.tabId, site: ctx.tabModel.get(sender.tabId)?.site ?? null, evidence: stored });
  }

  // ---------------------------------------------------------------------------
  // Requests (webRequest; synchronous inside the callback)
  // ---------------------------------------------------------------------------

  onRequest(details: RequestDetailsLike, request: ProtectRequestContext): void {
    this.noteRequest(details, request);
  }

  onSendHeaders(details: RequestDetailsLike, request: ProtectRequestContext): void {
    this.noteRequest(details, request);
  }

  /** Cheap path first: type, ids, de-duplication; then two host scans. The URL lives only in this call. */
  noteRequest(details: RequestDetailsLike, _request?: ProtectRequestContext): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    const type = details.type;
    const cls: CorrelationClass | null = requestClassOf(type);
    if (cls === null && type !== 'script') return;
    const tabId = details.tabId;
    const documentId = details.documentId;
    if (!Number.isSafeInteger(tabId) || tabId < 0 || typeof documentId !== 'string' || documentId.length === 0) return;
    if (ctx.isTabExcluded(tabId)) return;
    const target = fastHost(details.url);
    if (target === null) return;
    const now = this.now();
    const documentKey = makeDocumentKey(tabId, details.frameId, documentId);
    if (cls === null) {
      // A script request of this document: remembered by its masked host (scriptLoadObserved).
      const masked = maskHost(target.host);
      if (masked === null) return;
      const doc = this.doc(documentKey, tabId, now);
      if (doc.scriptHosts.size < MAX_SCRIPT_HOSTS) doc.scriptHosts.add(masked);
      return;
    }
    const requestId = details.requestId;
    if (typeof requestId !== 'string' || requestId.length === 0 || requestId.length > 64) return;
    if (this.pendingIndex.has(requestId) || this.results.has(requestId)) return;
    this.stats.requests++;
    const doc = this.doc(documentKey, tabId, now);
    const initiator = typeof details.initiator === 'string' && details.initiator !== 'null' ? fastHost(details.initiator) : null;
    const entry: RequestEntry = {
      id: requestId,
      cls,
      t: typeof details.timeStamp === 'number' && Number.isFinite(details.timeStamp) ? details.timeStamp : now,
      hostToken: maskHost(target.host),
      sameHostAsInitiator: initiator !== null && initiator.host === target.host,
      initiatorHost: initiator?.host ?? null,
    };
    if (doc.requests.length >= PROTECT_BUDGETS.maxPendingSendsPerDocument) {
      const oldest = doc.requests[0]!;
      this.decide(doc, { requestId: oldest.id, correlation: 'saturated', sendId: null, viaUnreadTarget: false }, oldest, now);
    }
    doc.requests.push(entry);
    this.pendingIndex.set(requestId, documentKey);
    this.trimResults(now);
    this.schedule();
  }

  // ---------------------------------------------------------------------------
  // Correlation
  // ---------------------------------------------------------------------------

  private correlate(doc: DocState, now: number): void {
    this.expireSends(doc, now);
    if (doc.requests.length === 0) return;
    const outcome = correlateSends(doc.requests, doc.sends, {
      now,
      leadMs: PROTECT_BUDGETS.correlationLeadMs,
      lagMs: PROTECT_BUDGETS.correlationLagMs,
      imageLagMs: PROTECT_BUDGETS.correlationImageLagMs,
      ambiguityMs: PROTECT_BUDGETS.correlationAmbiguityMs,
      waitMs: PROTECT_BUDGETS.attributionWaitMs,
      settleMs: SETTLE_MS,
      gaps: doc.gaps,
      saturated: doc.saturated,
    });
    if (outcome.decisions.length === 0) return;
    const used = new Set(outcome.matchedSendIds);
    for (const s of doc.sends) if (used.has(s.id)) s.matched = true;
    const byId = new Map(doc.requests.map((r) => [r.id, r]));
    for (const d of outcome.decisions) {
      const r = byId.get(d.requestId);
      if (r !== undefined) this.decide(doc, d, r, now);
    }
  }

  private decide(doc: DocState, d: CorrelationDecision, r: RequestEntry, now: number): void {
    const i = doc.requests.indexOf(r);
    if (i >= 0) doc.requests.splice(i, 1);
    this.pendingIndex.delete(r.id);
    const send = d.sendId === null ? undefined : doc.sends.find((s) => s.id === d.sendId);
    const attribution = this.attributionOf(doc, d.correlation, send, d.viaUnreadTarget, r);
    this.stats[d.correlation]++;
    this.results.delete(r.id);
    this.results.set(r.id, { documentKey: doc.documentKey, attribution, at: now, cls: r.cls, hostToken: r.hostToken });
    this.trimResults(now);
    for (const listener of [...this.listeners]) {
      try {
        listener(r.id, doc.documentKey, attribution);
      } catch {
        // A failing consumer never stops the others.
      }
    }
  }

  private attributionOf(doc: DocState, correlation: SendCorrelation, send: SendEntry | undefined, viaUnread: boolean, r: RequestEntry): ScriptAttribution {
    const base = pendingAttribution();
    base.correlation = correlation;
    const limits: ProtectLimitation[] = [];
    switch (correlation) {
      case 'unique': {
        const script = send?.script;
        if (send !== undefined && script !== undefined && send.sampled && script.kind !== 'unknown') {
          base.script = script;
          base.attributionConfidence = 'sampled-stack';
          base.scriptSite = script.kind === 'external' ? siteOfMaskedHost(script.host) : null;
          base.scriptRelation = this.relationOf(script, base.scriptSite, r);
          base.scriptLoadObserved = script.kind === 'external' && script.host !== undefined && doc.scriptHosts.has(script.host);
          limits.push('nearest-frame-only');
        } else limits.push(send !== undefined && send.sampled ? 'stack-unavailable' : doc.stackUnavailable ? 'stack-unavailable' : 'stack-budget');
        if (viaUnread) limits.push('target-unread');
        break;
      }
      case 'ambiguous':
        limits.push('correlation-ambiguous');
        break;
      case 'none':
        limits.push(doc.sawEvents ? 'no-call-sample' : 'no-script-attribution');
        break;
      case 'gap':
        limits.push('correlation-gap');
        break;
      case 'saturated':
        limits.push('correlation-saturated');
        break;
      case 'pending':
        break;
    }
    base.limitationCodes = canonicalLimitations(limits);
    return base;
  }

  /** Relation of the script to the request's initiator: sites compared; inline code of the document is same-origin. */
  private relationOf(script: ScriptRef, scriptSite: string | null, r: RequestEntry): SiteRelation {
    if (script.kind === 'document') return 'same-origin';
    if (script.kind !== 'external' || scriptSite === null || r.initiatorHost === null) return 'unknown';
    const initiatorSite = registrableDomain(r.initiatorHost);
    if (initiatorSite === null) return 'unknown';
    if (script.host === maskHost(r.initiatorHost)) return 'same-origin';
    return initiatorSite === scriptSite ? 'same-site' : 'cross-site';
  }

  private trimResults(now: number): void {
    for (const [id, e] of this.results) {
      if (this.results.size <= MAX_RESULTS && now - e.at <= RESULT_TTL_MS) break;
      this.results.delete(id);
    }
  }

  // ---------------------------------------------------------------------------
  // Timer (only while something is pending)
  // ---------------------------------------------------------------------------

  private schedule(): void {
    if (this.timer !== null || this.pendingIndex.size === 0 || this.ctx === null) return;
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.tick();
    }, TICK_MS);
  }

  /** One correlation round over every document with pending requests (also called by tests). */
  tick(): void {
    if (this.ctx === null) return;
    const now = this.now();
    for (const doc of [...this.docs.values()]) {
      if (doc.requests.length > 0) this.correlate(doc, now);
      else this.expireSends(doc, now);
    }
    this.trimResults(now);
    this.schedule();
  }

  // ---------------------------------------------------------------------------
  // Diagnostics and the test harness (numbers / masked tokens only)
  // ---------------------------------------------------------------------------

  debug(): Record<string, number | boolean> {
    let pendingRequests = 0;
    let pendingSends = 0;
    for (const d of this.docs.values()) {
      pendingRequests += d.requests.length;
      pendingSends += d.sends.length;
    }
    return { docs: this.docs.size, pendingRequests, pendingSends, results: this.results.size, ...this.stats };
  }

  /**
   * Test profile only (the controller refuses it elsewhere). `{op:'results'}` -> the decided attributions of the
   * last RESULT_TTL_MS with their request class (masked tokens and enums only, never a URL); `{op:'activity'}` -> the
   * script activity of every document of `tabId`; `{op:'tick'}` -> one correlation round now.
   */
  debugInject(payload: unknown): unknown {
    const p = (typeof payload === 'object' && payload !== null ? payload : {}) as { op?: unknown; tabId?: unknown };
    if (p.op === 'tick') {
      this.tick();
      return this.debug();
    }
    if (p.op === 'activity') {
      const out: Array<{ frame: number; activity: ScriptActivityEntry[] }> = [];
      for (const d of this.docs.values()) {
        if (d.tabId !== p.tabId) continue;
        out.push({ frame: Number(d.documentKey.split(':')[1]), activity: this.scriptActivity(d.documentKey) });
      }
      return out;
    }
    if (p.op === 'results') {
      const out: Array<{ cls: CorrelationClass; host: string | null; frame: number; attribution: ScriptAttribution }> = [];
      for (const e of this.results.values()) {
        if (p.tabId !== undefined && !e.documentKey.startsWith(String(p.tabId) + ':')) continue;
        out.push({ cls: e.cls, host: e.hostToken, frame: Number(e.documentKey.split(':')[1]), attribution: e.attribution });
      }
      return out;
    }
    throw new Error('attribution: unknown debug op');
  }
}
