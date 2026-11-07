// ADR-020 §E (S11): the session-recording lane of the module «Защита» in the service worker (feature `session-replay`).
// Inputs (all SW memory; nothing here reads a value, a field, a URL query or a response):
//   - protect-events (page-controlled MAIN registration samples of S10, relayed by ISOLATED; the document key comes
//     from MessageSender only): window / document listeners of the input and pointer groups (S1) and
//     MutationObserver.observe of the document (S2), each with its sampled script site (sampled-stack, page-controlled).
//     Registrations made before this lane started are read once, conservatively, from the attribution port
//     (ctx.ports.attribution.scriptActivity, S10);
//   - webRequest.onSendHeaders of every tab (net-hub shared listener): cross-site xhr / beacon POST, PUT or PATCH to a
//     registrable receiver feed the ReplayCadenceTracker (S3); body sizes only for armed tabs (onRequest carries the
//     body: only its byteLength is taken, the bytes are never read); `script` requests and sends are matched against
//     ENABLED replay-table rules (S5; none in production until REQ-008).
// Output: ReplaySummary (engine deriveReplay) in ProtectProjection.replay (contributeReport, fresh) and in the
// document's `replay` section of storage.session (debounced), plus a `replay-pattern` evidence event for the history
// when a document reaches replay-like / replay-recording towards a receiver. A summary kept from before a SW restart
// (or an LRU eviction) is never lowered; the restarted cadence is reported as `cadence-reset`.

import { MAX_COUNT, PROTECT_BUDGETS, PROTECT_LIMITATIONS, PROTECT_WIRE_LIMITS, isDomainName } from '@detect-expert/contracts';
import type {
  FrameContext,
  ProtectLimitation,
  ProtectPageMessage,
  ProtectProjection,
  ProtectReplayEvidence,
  RegistrationSampleSw,
  ReplaySummary,
  ScriptActivityEntry,
  ScriptRef,
} from '@detect-expert/contracts';
import {
  REPLAY_INPUT_EVENTS,
  REPLAY_LEVEL_RANK,
  REPLAY_POINTER_EVENTS,
  REPLAY_RULE_ID,
  REPLAY_THRESHOLDS,
  createReplayFacts,
  deriveReplayDetailed,
  higherReplay,
  matchReplayEntry,
  noteReplayRegistration,
  parseReplayEntries,
  sameReplaySummary,
} from '@detect-expert/engine';
import type { ReplayDerivation, ReplayDeriveOptions, ReplayFacts, ReplayRequestView, ReplayTableEntry, ReplayThresholds } from '@detect-expert/engine';
import type { RequestBodyLike, RequestDetailsLike } from '../../chrome-api';
import type { PageSenderContext } from '../../sender';
import { siteOfMaskedHost } from '../attribution/index';
import type { AttributionPort } from '../attribution/index';
import type { ProtectRequestContext } from '../net-hub';
import type { ProtectFeatureService, ProtectServiceContext, ProtectStopReason } from '../services';
import { siteOfHost } from '../tab-model';
import { ReplayCadenceTracker } from './cadence';

/** Frame documents with registration facts (LRU), as the cadence tracker. */
export const MAX_REPLAY_FRAMES = PROTECT_BUDGETS.replayCadenceDocuments;
/** Top-level documents with summary state (LRU). */
export const MAX_REPLAY_TOPS = PROTECT_BUDGETS.replayCadenceDocuments;
/** Body sizes of armed tabs waiting for their onSendHeaders (requestId -> bytes); oldest dropped first. */
export const MAX_PENDING_BODIES = 64;
/** Debounce of the storage.session write and the history event. */
export const REPLAY_FLUSH_MS = 500;
/** Vendors with matched resources per frame document. */
const MAX_FRAME_VENDORS = PROTECT_BUDGETS.maxReplayVendors;
/** Limitations an evidence record carries (at most maxEvidenceLimitations), most relevant first. */
const EVIDENCE_LIMITATIONS: readonly ProtectLimitation[] = [
  'uncalibrated-threshold',
  'masking-not-verifiable',
  'no-script-attribution',
  'body-size-not-observed',
  'cadence-reset',
  'loaded-before-enable',
  'websocket-not-observed',
  'element-listeners-not-observed',
];
const SEND_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH']);

export interface ReplayHookAvailability {
  listen: boolean;
  observe: boolean;
}

export interface ReplayServiceOptions {
  /** MAIN hooks of this build (S10 PROTECT_HOOK_CONFIG): a hook group 'off' makes its signal unavailable. */
  hooks: ReplayHookAvailability;
  thresholds?: Readonly<ReplayThresholds>;
  /** Timer seam (tests); default setTimeout / clearTimeout. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Evidence id source (tests); default 8 random base-36 characters. */
  evidenceId?: () => string;
}

interface VendorHit {
  ruleIds: Set<string>;
  count: number;
}

interface FrameState {
  frameKey: string;
  topKey: string;
  tabId: number;
  frameId: number;
  frameContext: FrameContext;
  frameSite: string | null;
  facts: ReplayFacts;
  vendors: Map<string, VendorHit>;
}

interface TopState {
  topKey: string;
  tabId: number;
  /** Summary stored before this memory existed (SW restart, eviction): the floor of the level. */
  seed: ReplaySummary | null;
  cadenceReset: boolean;
  dirty: boolean;
  /** Receiver -> level rank already published for the history. */
  published: Map<string, number>;
}

interface Running {
  ctx: ProtectServiceContext;
  startedAt: number;
  resources: ReplayTableEntry[];
  endpoints: ReplayTableEntry[];
  rulesEnabled: boolean;
}

function randomEvidenceId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  let out = 'pe-';
  for (const b of bytes) out += (b % 36).toString(36);
  return out;
}

function canonical(codes: Iterable<ProtectLimitation>, max: number): ProtectLimitation[] {
  const set = new Set(codes);
  return PROTECT_LIMITATIONS.filter((l) => set.has(l)).slice(0, max);
}

/** byteLength of a raw body; null when Chrome gave no body, an error, form data (never read) or a file part. */
export function replayBodyBytes(body: RequestBodyLike | null | undefined): number | null {
  if (body === null || body === undefined || body.error !== undefined || body.formData !== undefined) return null;
  const raw = body.raw;
  if (raw === undefined || raw.length === 0) return null;
  let total = 0;
  for (const part of raw) {
    const bytes = part.bytes;
    if (bytes === undefined || typeof bytes.byteLength !== 'number') return null;
    total += bytes.byteLength;
  }
  return total;
}

/** Scheme, host, port and path of an http(s) URL, for table matching only (callback memory; never stored). */
function requestView(url: string, kind: ReplayRequestView['kind']): ReplayRequestView | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const scheme = u.protocol === 'https:' ? 'https' : u.protocol === 'http:' ? 'http' : null;
  if (scheme === null) return null;
  const port = u.port === '' ? null : Number(u.port);
  return { scheme, host: u.hostname.toLowerCase(), port: Number.isSafeInteger(port) ? port : null, path: u.pathname, kind };
}

export class ReplayService implements ProtectFeatureService {
  readonly name = 'replay' as const;
  readonly features = ['session-replay'] as const;

  private run: Running | null = null;
  private readonly tracker: ReplayCadenceTracker;
  private readonly frames = new Map<string, FrameState>();
  private readonly tops = new Map<string, TopState>();
  private readonly bodies = new Map<string, number | null>();
  private timer: unknown = null;
  private readonly hooks: ReplayHookAvailability;
  private readonly thresholds: Readonly<ReplayThresholds>;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly newEvidenceId: () => string;
  private stats = { registrations: 0, sends: 0, scripts: 0, vendorHits: 0, published: 0, writes: 0, seededFromPort: 0 };

  constructor(options: ReplayServiceOptions) {
    this.hooks = { listen: options.hooks.listen === true, observe: options.hooks.observe === true };
    this.thresholds = options.thresholds ?? REPLAY_THRESHOLDS;
    this.tracker = new ReplayCadenceTracker(this.thresholds);
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.newEvidenceId = options.evidenceId ?? randomEvidenceId;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  start(ctx: ProtectServiceContext): void {
    const entries = parseReplayEntries(ctx.tables.REPLAY_ENTRIES, { allowSynthetic: ctx.testProfile });
    this.run = {
      ctx,
      startedAt: ctx.clock.now(),
      resources: entries.filter((e) => e.role === 'resource'),
      endpoints: entries.filter((e) => e.role === 'endpoint'),
      rulesEnabled: entries.length > 0,
    };
  }

  stop(reason: ProtectStopReason): void {
    const r = this.run;
    if (r !== null && reason === 'feature-off') this.clearStoredSummaries(r.ctx);
    this.clearMemory();
    this.run = null;
  }

  private clearMemory(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.tracker.clear();
    this.frames.clear();
    this.tops.clear();
    this.bodies.clear();
  }

  /** Feature off while the module stays on: the lane's sections go (the projection shows no replay any more). */
  private clearStoredSummaries(ctx: ProtectServiceContext): void {
    for (const entry of ctx.tabModel.entries()) {
      for (const [key, doc] of ctx.docStore.docsOfTab(entry.tabId)) {
        if (doc.replay !== undefined) ctx.docStore.update(key, entry.tabId, 'replay', () => undefined);
      }
    }
  }

  onClearSession(): void {
    this.clearMemory();
  }

  onTabRemoved(tabId: number): void {
    this.tracker.forgetTab(tabId);
    for (const [key, f] of [...this.frames]) if (f.tabId === tabId) this.frames.delete(key);
    for (const [key, t] of [...this.tops]) if (t.tabId === tabId) this.tops.delete(key);
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  private top(r: Running, topKey: string, tabId: number): TopState {
    let t = this.tops.get(topKey);
    if (t !== undefined) {
      this.tops.delete(topKey);
      this.tops.set(topKey, t);
      return t;
    }
    while (this.tops.size >= MAX_REPLAY_TOPS) {
      const oldest = this.tops.keys().next();
      if (oldest.done) break;
      this.tops.delete(oldest.value);
    }
    const seed = r.ctx.docStore.doc(topKey)?.replay ?? null;
    t = { topKey, tabId, seed, cadenceReset: seed !== null, dirty: false, published: new Map() };
    this.tops.set(topKey, t);
    return t;
  }

  private frame(r: Running, frameKey: string, topKey: string, tabId: number, frameId: number, frameSite: string | null): FrameState {
    const existing = this.frames.get(frameKey);
    if (existing !== undefined) {
      this.frames.delete(frameKey);
      this.frames.set(frameKey, existing);
      return existing;
    }
    while (this.frames.size >= MAX_REPLAY_FRAMES) {
      const oldest = this.frames.keys().next();
      if (oldest.done) break;
      this.frames.delete(oldest.value);
    }
    let frameContext: FrameContext = 'top';
    if (frameId !== 0) {
      const topSite = r.ctx.tabModel.get(tabId)?.site ?? null;
      frameContext = frameSite !== null && topSite !== null && frameSite === topSite ? 'same-site-frame' : 'cross-site-frame';
    }
    const f: FrameState = { frameKey, topKey, tabId, frameId, frameContext, frameSite, facts: createReplayFacts(), vendors: new Map() };
    this.frames.set(frameKey, f);
    if (this.loadedBeforeStart(r, tabId)) this.seedFromAttribution(r, f);
    return f;
  }

  /** The tab's top document committed before this lane started (or the module never saw it commit). */
  private loadedBeforeStart(r: Running, tabId: number): boolean {
    const entry = r.ctx.tabModel.get(tabId);
    return entry === undefined || entry.topDocumentId === null || entry.committedAt < r.startedAt;
  }

  /**
   * Registrations made before this lane started, from the attribution lane (S10) that may have run for another
   * feature. Conservative: ScriptActivityEntry folds event codes and targets per script, so a script counts for S1
   * only when ALL its targets are window / document (then every listener of it was page-level); counts become
   * lower bounds.
   */
  private seedFromAttribution(r: Running, f: FrameState): void {
    const port = r.ctx.ports.attribution as AttributionPort | null;
    if (port === null || typeof port !== 'object' || typeof port.scriptActivity !== 'function') return;
    let activity: ScriptActivityEntry[];
    try {
      activity = port.scriptActivity(f.frameKey);
    } catch {
      return;
    }
    let seeded = false;
    for (const a of activity) {
      const site = a.sampledCount > 0 && a.scriptSite !== null && isDomainName(a.scriptSite) ? a.scriptSite : null;
      const rootOnly = a.targetKinds.length > 0 && a.targetKinds.every((k) => k === 'window' || k === 'document');
      if (a.hookPoints.includes('listen') && rootOnly) {
        const input = a.eventCodes.find((c) => REPLAY_INPUT_EVENTS.has(c));
        const pointer = a.eventCodes.find((c) => REPLAY_POINTER_EVENTS.has(c));
        if (input !== undefined) seeded = noteReplayRegistration(f.facts, { hookPoint: 'listen', eventCode: input, targetKind: 'document', count: 1, site }) || seeded;
        if (pointer !== undefined) seeded = noteReplayRegistration(f.facts, { hookPoint: 'listen', eventCode: pointer, targetKind: 'document', count: 1, site }) || seeded;
      }
      if (a.hookPoints.includes('observe-document')) seeded = noteReplayRegistration(f.facts, { hookPoint: 'observe-document', targetKind: 'document', count: 1, site }) || seeded;
    }
    if (seeded) {
      f.facts.registrationQuality = 'lower-bound';
      this.stats.seededFromPort++;
    }
  }

  private markDirty(r: Running, topKey: string, tabId: number): void {
    const t = this.top(r, topKey, tabId);
    t.dirty = true;
    if (this.timer !== null) return;
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.flush();
    }, REPLAY_FLUSH_MS);
  }

  // ---------------------------------------------------------------------------
  // S1 / S2: registrations (page-controlled)
  // ---------------------------------------------------------------------------

  /** Site of a sampled script: an external script's registrable domain, inline code = the document's own site. */
  private siteOf(script: ScriptRef, sampled: boolean, senderHost: string | null): string | null {
    if (!sampled) return null;
    let site: string | null = null;
    if (script.kind === 'external') site = siteOfMaskedHost(script.host);
    else if (script.kind === 'document') site = siteOfHost(senderHost);
    return site !== null && isDomainName(site) ? site : null;
  }

  onPageMessage(sender: PageSenderContext, message: ProtectPageMessage): void {
    const r = this.run;
    if (r === null || message.type !== 'protect-events') return;
    if (r.ctx.isTabExcluded(sender.tabId)) return;
    const topKey = sender.frameId === 0 ? sender.documentKey : r.ctx.tabModel.topDocumentKey(sender.tabId);
    if (topKey === null) return; // the tab's top document is unknown: fail closed
    const frameSite = sender.frameId === 0 ? null : siteOfHost(sender.host);
    const f = this.frame(r, sender.documentKey, topKey, sender.tabId, sender.frameId, frameSite !== null && isDomainName(frameSite) ? frameSite : null);
    let changed = false;
    for (const reg of message.registrations) changed = this.noteRegistration(f, reg, sender.host) || changed;
    if (message.dropped.registrations > 0 || message.limitations.includes('budget-exceeded')) {
      if (f.facts.registrationQuality !== 'lower-bound') changed = true;
      f.facts.registrationQuality = 'lower-bound';
    }
    if (changed) this.markDirty(r, topKey, sender.tabId);
  }

  private noteRegistration(f: FrameState, reg: RegistrationSampleSw, senderHost: string | null): boolean {
    this.stats.registrations = Math.min(MAX_COUNT, this.stats.registrations + 1);
    return noteReplayRegistration(f.facts, {
      hookPoint: reg.hookPoint,
      eventCode: reg.eventCode,
      targetKind: reg.targetKind,
      count: reg.count,
      site: this.siteOf(reg.script, reg.sampled, senderHost),
    });
  }

  // ---------------------------------------------------------------------------
  // S3 / S5: requests (browser-observed; synchronous inside the webRequest callback)
  // ---------------------------------------------------------------------------

  /** Armed tabs only: remember the body size of a send until its onSendHeaders (bytes are never read). */
  onRequest(details: RequestDetailsLike, _request: ProtectRequestContext): void {
    if (this.run === null) return;
    const type = details.type;
    if (type !== 'xmlhttprequest' && type !== 'ping') return;
    const method = typeof details.method === 'string' ? details.method.toUpperCase() : '';
    if (!SEND_METHODS.has(method)) return;
    const id = details.requestId;
    if (typeof id !== 'string' || id.length === 0 || id.length > 64) return;
    if (this.bodies.size >= MAX_PENDING_BODIES) {
      const oldest = this.bodies.keys().next();
      if (!oldest.done) this.bodies.delete(oldest.value);
    }
    this.bodies.set(id, replayBodyBytes(details.requestBody));
  }

  onSendHeaders(details: RequestDetailsLike, request: ProtectRequestContext): void {
    const r = this.run;
    if (r === null) return;
    const type = details.type;
    if (type === 'script') {
      if (r.resources.length > 0) this.noteScript(r, details, request);
      return;
    }
    if (type !== 'xmlhttprequest' && type !== 'ping') return;
    const id = typeof details.requestId === 'string' ? details.requestId : null;
    const bytes = id !== null && this.bodies.has(id) ? this.bodies.get(id)! : null;
    if (id !== null) this.bodies.delete(id);
    const method = typeof details.method === 'string' ? details.method.toUpperCase() : '';
    if (!SEND_METHODS.has(method)) return;
    if (!Number.isSafeInteger(details.tabId) || details.tabId < 0 || r.ctx.isTabExcluded(details.tabId)) return;
    const resolved = request.resolved;
    if (resolved === null || resolved.relation !== 'cross-site' || resolved.receiver === null || !isDomainName(resolved.receiver)) return;
    const topKey = resolved.topDocumentKey;
    const frameKey = resolved.documentKey ?? topKey;
    if (topKey === null || frameKey === null) return;
    let vendorId: string | null = null;
    if (r.endpoints.length > 0) {
      const view = requestView(details.url, type === 'ping' ? 'beacon' : 'xhr');
      if (view !== null) for (const e of r.endpoints) if (matchReplayEntry(e, view)) vendorId = e.vendorId;
    }
    const t = typeof details.timeStamp === 'number' && Number.isFinite(details.timeStamp) ? details.timeStamp : r.ctx.clock.now();
    this.stats.sends = Math.min(MAX_COUNT, this.stats.sends + 1);
    this.tracker.note(frameKey, resolved.receiver, t, bytes, vendorId);
    this.frame(r, frameKey, topKey, resolved.tabId, resolved.frameId, resolved.frameSite !== null && isDomainName(resolved.frameSite) ? resolved.frameSite : null);
    this.markDirty(r, topKey, resolved.tabId);
  }

  /** A `script` request of an ENABLED resource rule (S5). Production tables are empty: never reached there. */
  private noteScript(r: Running, details: RequestDetailsLike, request: ProtectRequestContext): void {
    if (!Number.isSafeInteger(details.tabId) || details.tabId < 0 || r.ctx.isTabExcluded(details.tabId)) return;
    const view = requestView(details.url, 'script');
    if (view === null) return;
    const hits = r.resources.filter((e) => matchReplayEntry(e, view));
    if (hits.length === 0) return;
    const resolved = request.resolved;
    if (resolved === null) return;
    const topKey = resolved.topDocumentKey;
    const frameKey = resolved.documentKey ?? topKey;
    if (topKey === null || frameKey === null) return;
    this.stats.scripts = Math.min(MAX_COUNT, this.stats.scripts + 1);
    const f = this.frame(r, frameKey, topKey, resolved.tabId, resolved.frameId, resolved.frameSite !== null && isDomainName(resolved.frameSite) ? resolved.frameSite : null);
    for (const e of hits) {
      let hit = f.vendors.get(e.vendorId);
      if (hit === undefined) {
        if (f.vendors.size >= MAX_FRAME_VENDORS) continue;
        hit = { ruleIds: new Set(), count: 0 };
        f.vendors.set(e.vendorId, hit);
      }
      if (hit.ruleIds.size < 8) hit.ruleIds.add(e.ruleId);
      hit.count = Math.min(MAX_COUNT, hit.count + 1);
      this.stats.vendorHits = Math.min(MAX_COUNT, this.stats.vendorHits + 1);
    }
    this.markDirty(r, topKey, resolved.tabId);
  }

  // ---------------------------------------------------------------------------
  // Derivation
  // ---------------------------------------------------------------------------

  private factsOf(f: FrameState): ReplayFacts {
    const vendorResources = [...f.vendors].map(([vendorId, hit]) => ({ vendorId, ruleIds: [...hit.ruleIds], count: hit.count }));
    return {
      ...f.facts,
      periodic: this.tracker.periodic(f.frameKey),
      periodicTruncated: this.tracker.truncated(f.frameKey),
      vendorResources,
    };
  }

  private options(r: Running, topKey: string, tabId: number, cadenceReset: boolean): ReplayDeriveOptions {
    const doc = r.ctx.docStore.doc(topKey);
    const valueSeenReceivers: string[] = [];
    for (const e of doc?.evidence ?? []) {
      if (e.protectKind !== 'value-match' || e.receiver === undefined) continue;
      if (e.deliveryState === 'stopped' || e.deliveryState === 'stopped-other') continue;
      valueSeenReceivers.push(e.receiver);
    }
    return {
      hooks: this.hooks,
      vendorRulesEnabled: r.rulesEnabled,
      valueSeenReceivers,
      loadedBeforeEnable: !cadenceReset && this.loadedBeforeStart(r, tabId),
      cadenceReset,
      thresholds: this.thresholds,
    };
  }

  /** The tab document's derivation: the best frame document (top frame first on ties), never below a kept summary. */
  private derive(r: Running, topKey: string, tabId: number): { derivation: ReplayDerivation; frame: FrameState | null; summary: ReplaySummary } {
    const t = this.tops.get(topKey);
    const cadenceReset = t?.cadenceReset === true;
    const options = this.options(r, topKey, tabId, cadenceReset);
    let best: { derivation: ReplayDerivation; frame: FrameState | null } | null = null;
    for (const f of this.frames.values()) {
      if (f.topKey !== topKey) continue;
      const d = deriveReplayDetailed(this.factsOf(f), options);
      if (best === null) {
        best = { derivation: d, frame: f };
        continue;
      }
      const rank = REPLAY_LEVEL_RANK[d.summary.level] - REPLAY_LEVEL_RANK[best.derivation.summary.level];
      const better = rank > 0 || (rank === 0 && (d.summary.signals.length > best.derivation.summary.signals.length || (d.summary.signals.length === best.derivation.summary.signals.length && f.frameId === 0 && best.frame?.frameId !== 0)));
      if (better) best = { derivation: d, frame: f };
    }
    if (best === null) best = { derivation: deriveReplayDetailed(createReplayFacts(), options), frame: null };
    let summary = best.derivation.summary;
    const seed = t?.seed ?? null;
    if (seed !== null) {
      const kept = higherReplay(seed, summary);
      summary = { ...kept, limitationCodes: canonical([...kept.limitationCodes, 'cadence-reset'], PROTECT_WIRE_LIMITS.maxReplayLimitations) };
    }
    return { derivation: best.derivation, frame: best.frame, summary };
  }

  /** ProtectProjection.replay of the tab's current top-level document (fresh; no side effects). */
  contributeReport(tabId: number, projection: ProtectProjection): ProtectProjection | void {
    const r = this.run;
    if (r === null) return;
    const topKey = projection.documentKey;
    if (r.ctx.tabModel.topDocumentKey(tabId) !== topKey || r.ctx.isTabExcluded(tabId)) return;
    // A summary stored before this memory existed is the floor (its state is created with the reset marked).
    if (!this.tops.has(topKey) && r.ctx.docStore.doc(topKey)?.replay !== undefined) this.top(r, topKey, tabId);
    // A document loaded before this lane started and silent since: its registrations come from the attribution port.
    if (this.loadedBeforeStart(r, tabId) && !this.frames.has(topKey)) this.frame(r, topKey, topKey, tabId, 0, null);
    return { ...projection, replay: this.derive(r, topKey, tabId).summary };
  }

  /** Writes changed summaries (storage.session, via the doc-store) and publishes history events. */
  flush(): void {
    const r = this.run;
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    if (r === null) return;
    for (const t of [...this.tops.values()]) {
      if (!t.dirty) continue;
      t.dirty = false;
      if (r.ctx.isTabExcluded(t.tabId)) continue;
      const { derivation, frame, summary } = this.derive(r, t.topKey, t.tabId);
      const stored = r.ctx.docStore.doc(t.topKey)?.replay ?? null;
      if (!sameReplaySummary(stored, summary)) {
        r.ctx.docStore.update(t.topKey, t.tabId, 'replay', () => summary);
        this.stats.writes = Math.min(MAX_COUNT, this.stats.writes + 1);
      }
      this.publish(r, t, derivation, frame);
    }
  }

  /** One `replay-pattern` evidence per receiver and level step (replay-like, then replay-recording). */
  private publish(r: Running, t: TopState, d: ReplayDerivation, frame: FrameState | null): void {
    const summary = d.summary;
    const rank = REPLAY_LEVEL_RANK[summary.level];
    if (rank < REPLAY_LEVEL_RANK['replay-like'] || d.linkedReceivers.length === 0) return;
    const ctx = r.ctx;
    const doc = ctx.docStore.ensure(t.topKey, t.tabId);
    const second = Math.max(0, Math.min(PROTECT_WIRE_LIMITS.maxEvidenceSecond, Math.floor((ctx.clock.now() - doc.createdAt) / 1000)));
    const limitationCodes = canonical(EVIDENCE_LIMITATIONS.filter((l) => summary.limitationCodes.includes(l)), PROTECT_WIRE_LIMITS.maxEvidenceLimitations);
    const site = ctx.tabModel.get(t.tabId)?.site ?? null;
    for (const receiver of d.linkedReceivers) {
      if ((t.published.get(receiver) ?? 0) >= rank) continue;
      const host = summary.periodicHosts.find((h) => h.registrableDomain === receiver);
      const frameContext = frame?.frameContext ?? 'top';
      const frameSite = frameContext !== 'top' ? (frame?.frameSite ?? null) : null;
      const evidence: ProtectReplayEvidence = {
        evidenceId: this.newEvidenceId(),
        frameContext,
        ...(frameSite !== null ? { frameSite } : {}),
        attributionConfidence: summary.attributionConfidence,
        count: Math.max(1, Math.min(MAX_COUNT, host?.sends ?? 1)),
        countQuality: summary.limitationCodes.includes('cadence-reset') ? 'lower-bound' : 'exact',
        firstSecond: second,
        lastSecond: second,
        evidenceSource: 'derived',
        integrity: 'derived',
        ruleVersion: this.thresholds.ruleVersion,
        limitationCodes,
        protectKind: 'replay-pattern',
        ruleId: REPLAY_RULE_ID,
        receiver,
        relation: 'cross-site',
        interpretationConfidence: summary.interpretationConfidence === 'medium' ? 'medium' : 'low',
      };
      t.published.set(receiver, rank);
      this.stats.published = Math.min(MAX_COUNT, this.stats.published + 1);
      ctx.eventBus.publish({ kind: 'evidence', documentKey: t.topKey, tabId: t.tabId, site, evidence });
    }
  }

  // ---------------------------------------------------------------------------
  // Diagnostics and the test harness (numbers and enums only)
  // ---------------------------------------------------------------------------

  debug(): Record<string, number | boolean> {
    const s = this.tracker.stats();
    return {
      frames: this.frames.size,
      tops: this.tops.size,
      trackerDocuments: s.documents,
      trackerDomains: s.domains,
      pendingBodies: this.bodies.size,
      rulesEnabled: this.run?.rulesEnabled === true,
      listenHook: this.hooks.listen,
      observeHook: this.hooks.observe,
      ...this.stats,
    };
  }

  /**
   * Test profile only (the controller refuses it elsewhere). `{op:'flush'}` writes now; `{op:'summary', tabId}` the
   * current summary of the tab's top document (enums, counters and registrable domains only).
   */
  debugInject(payload: unknown): unknown {
    const p = (typeof payload === 'object' && payload !== null ? payload : {}) as { op?: unknown; tabId?: unknown };
    const r = this.run;
    if (r === null) throw new Error('replay: not running');
    if (p.op === 'flush') {
      this.flush();
      return this.debug();
    }
    if (p.op === 'summary' && typeof p.tabId === 'number') {
      const topKey = r.ctx.tabModel.topDocumentKey(p.tabId);
      return topKey === null ? null : this.derive(r, topKey, p.tabId).summary;
    }
    throw new Error('replay: unknown debug op');
  }
}
