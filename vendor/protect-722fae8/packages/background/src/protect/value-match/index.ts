// ADR-020 §B (S07): the value-match lane of the module «Защита» in the service worker. Runs only while the module is
// active and the `value-match` feature is on. Page messages: protect-hello / protect-arm / protect-input (keyed
// fingerprints only) — every answer carries this lane's salt (a stale salt is answered with the new one, so the
// document re-keys). Armed tabs: request bodies are matched in the webRequest callback (matcher.ts). Everything of
// this lane lives in SW memory (fingerprints ≤ 15 min, tokens ≤ 10 s); only value-free evidence reaches
// storage.session through the doc-store. Debug and diagnostics are numbers only. Review PT-1: those limits are kept by
// the lane's own expiry timer (the earliest field TTL, idle document, grace expiry or ring entry), not only by the next
// value-match event; the timer goes with the lane (stop, clear session).

import { MAX_COUNT, PROTECT_BUDGETS, PROTECT_LIMITATIONS, PROTECT_WIRE_LIMITS } from '@detect-expert/contracts';
import type { FrameContext, ProtectLimitation, ProtectPageMessage, ProtectProjection } from '@detect-expert/contracts';
import type { NavigationDetailsLike, RequestDetailsLike } from '../../chrome-api';
import type { PageSenderContext } from '../../sender';
import type { ProtectRequestContext } from '../net-hub';
import type { OutcomeEvent } from '../outcomes';
import type { ProtectAckContribution, ProtectFeatureService, ProtectServiceContext } from '../services';
import type { ProtectTabEntry } from '../tab-model';
import { siteOfHost } from '../tab-model';
import { FingerprintStore, defaultRandom } from './fingerprint-store';
import type { FieldRecord } from './fingerprint-store';
import { ValueMatcher, emptyStats } from './matcher';
import type { MatchStats } from './matcher';
import { TokenRing } from './ring';

export { containerViews, decodeContainer, looksBinary, requestViews, scanTokens, textViews, isCredentialKey } from './decode';
export type { DecodedRequest, RequestView } from './decode';
export { FingerprintStore, isRollingCandidate } from './fingerprint-store';
export { ValueMatcher, sinceInputOf } from './matcher';
export { RingBuilder, TokenRing, findHash } from './ring';

/** Bound of the documents remembered as holding the salt. */
export const MAX_SALTED_DOCS = 256;

/** Shortest delay of the expiry timer (no busy loop when an expiry is due now). */
export const EXPIRY_TIMER_MIN_MS = 100;

export interface ValueMatchOptions {
  /** Random bytes (salt, salt id, evidence id prefix); tests inject a deterministic source. */
  random?: (n: number) => Uint8Array;
}

interface Running {
  ctx: ProtectServiceContext;
  store: FingerprintStore;
  ring: TokenRing;
  matcher: ValueMatcher;
  stats: MatchStats;
  /** Top-level documents that held module state when the lane started (a SW restart lost their fingerprints). */
  preexisting: Set<string>;
  /** Tabs that sent fingerprints in this lane lifetime. */
  fedTabs: Set<number>;
  /** Documents answered with the salt (≤ MAX_SALTED_DOCS, oldest first): told to re-key when the feature goes off. */
  saltedDocs: Set<string>;
  staleSalt: number;
  inputs: number;
  arms: number;
  /** Expiry timer of the lane memory (review PT-1) and the moment it fires (+Infinity = none). */
  timer: ReturnType<typeof setTimeout> | null;
  timerAt: number;
}

export function createValueMatchService(options: ValueMatchOptions = {}): ProtectFeatureService {
  const random = options.random ?? defaultRandom;
  let run: Running | null = null;
  let generation = 0;

  const clearTimer = (r: Running): void => {
    if (r.timer !== null) clearTimeout(r.timer);
    r.timer = null;
    r.timerAt = Number.POSITIVE_INFINITY;
  };

  /** (Re)arms the expiry timer for `at` unless it already fires earlier. Cheap: no scan of the store. */
  const expireBy = (r: Running, at: number): void => {
    if (run !== r || !Number.isFinite(at) || (r.timer !== null && r.timerAt <= at)) return;
    clearTimer(r);
    const delay = Math.min(PROTECT_BUDGETS.fingerprintIdleTtlMs, Math.max(EXPIRY_TIMER_MIN_MS, at - r.ctx.clock.now()));
    r.timerAt = at;
    r.timer = setTimeout(() => {
      r.timer = null;
      r.timerAt = Number.POSITIVE_INFINITY;
      if (run !== r) return;
      try {
        r.matcher.sweep(r.ctx.clock.now(), true);
      } finally {
        // The next expiry over everything still held (bounded scan: ≤ 256 field records, ≤ 256 ring entries).
        expireBy(r, Math.min(r.store.nextExpiry(), r.ring.nextExpiry()));
      }
    }, delay);
  };

  const ack = (r: Running, documentKey: string): ProtectAckContribution => {
    r.saltedDocs.delete(documentKey);
    r.saltedDocs.add(documentKey);
    if (r.saltedDocs.size > MAX_SALTED_DOCS) {
      const oldest = r.saltedDocs.values().next();
      if (!oldest.done) r.saltedDocs.delete(oldest.value);
    }
    return { saltId: r.store.saltId, salt: r.store.salt };
  };

  function onInput(r: Running, sender: PageSenderContext, msg: Extract<ProtectPageMessage, { type: 'protect-input' }>): void {
    const { ctx, store } = r;
    const now = ctx.clock.now();
    r.inputs = Math.min(MAX_COUNT, r.inputs + 1);
    r.matcher.sweep(now);
    // Typing implies a tracked field has focus: (re)arm the tab's body listener (refreshes its activity).
    ctx.netHub.arm(sender.tabId);
    const doc = store.ensureDocument(sender.documentKey, sender.tabId, now);
    if (msg.submit !== 'none') doc.submitAt = now;
    const topKey = ctx.tabModel.topDocumentKey(sender.tabId) ?? (sender.frameId === 0 ? sender.documentKey : null);
    const notes: ProtectLimitation[] = [];
    if (msg.neverReadFields > 0 && !doc.neverReadNoted) {
      doc.neverReadNoted = true;
      notes.push('never-read-fields');
    }
    if (msg.paymentSuspended && !doc.paymentNoted) {
      doc.paymentNoted = true;
      notes.push('values-suspended-payment');
    }
    if (notes.length > 0 && topKey !== null) ctx.docStore.addLimitations(topKey, sender.tabId, notes);
    if (msg.saltId !== store.saltId) {
      // Keyed with an earlier salt (SW restart): useless here; the answer carries the new salt and the document
      // reads its fields again under it.
      r.staleSalt = Math.min(MAX_COUNT, r.staleSalt + 1);
      return;
    }
    if (msg.fields.length === 0) return;
    const site = siteOfHost(sender.host);
    const topSite = ctx.tabModel.get(sender.tabId)?.site ?? (sender.frameId === 0 ? site : null);
    if (ctx.isExcluded(site) || ctx.isExcluded(topSite) || ctx.isTabExcluded(sender.tabId)) return;
    const frameContext: FrameContext = sender.frameId === 0 ? 'top' : site !== null && site === topSite ? 'same-site-frame' : 'cross-site-frame';
    const meta = { site, topSite, topKey, frameContext, frameSite: sender.frameId === 0 ? null : site };
    const recs: FieldRecord[] = [];
    for (const f of msg.fields) {
      const rec = store.upsert(doc, f, meta, now);
      if (rec !== null) recs.push(rec);
    }
    if (recs.length > 0) {
      r.fedTabs.add(sender.tabId);
      expireBy(r, now + PROTECT_BUDGETS.fingerprintIdleTtlMs);
    }
    r.matcher.reverse(sender.tabId, recs, now);
  }

  return {
    name: 'value-match',
    features: ['value-match'],

    start(ctx) {
      const store = new FingerprintStore(random);
      const ring = new TokenRing();
      const stats = emptyStats();
      const preexisting = new Set<string>();
      for (const key of ctx.tabModel.topDocumentKeys()) if (ctx.docStore.doc(key) !== undefined) preexisting.add(key);
      run = { ctx, store, ring, stats, matcher: new ValueMatcher(ctx, store, ring, stats, random), preexisting, fedTabs: new Set(), saltedDocs: new Set(), staleSalt: 0, inputs: 0, arms: 0, timer: null, timerAt: Number.POSITIVE_INFINITY };
      generation = Math.min(MAX_COUNT, generation + 1);
      // A new salt: documents that kept fingerprints under an earlier one read their fields again (best effort; a
      // document without a listener learns the salt from its next ack).
      for (const key of preexisting) ctx.sendControl(key, 'rekey');
    },

    stop(reason) {
      if (run !== null) {
        // Feature off while the module stays on: documents holding the salt re-key; their hello is answered without a
        // salt, so they drop it and read nothing more (FOLLOWUPS 89). Module off / suspension: the controller stops
        // every document itself.
        if (reason === 'feature-off') for (const key of run.saltedDocs) run.ctx.sendControl(key, 'rekey');
        clearTimer(run);
        run.store.clear();
        run.ring.clear();
        run.matcher.clear();
      }
      run = null;
    },

    onPageMessage(sender: PageSenderContext, message: ProtectPageMessage): ProtectAckContribution | void {
      const r = run;
      if (r === null) return;
      switch (message.type) {
        case 'protect-arm':
          if (!r.ctx.isTabExcluded(sender.tabId)) {
            r.ctx.netHub.arm(sender.tabId);
            r.arms = Math.min(MAX_COUNT, r.arms + 1);
          }
          break;
        case 'protect-input':
          onInput(r, sender, message);
          break;
        default:
          break;
      }
      return ack(r, sender.documentKey);
    },

    onRequest(details: RequestDetailsLike, request: ProtectRequestContext) {
      const r = run;
      if (r === null) return;
      const before = r.ring.size;
      r.matcher.onRequest(details, request);
      // A new ring entry expires ringWindowMs after now (sweep drops `now - at > ringWindowMs`).
      if (r.ring.size > 0 && (r.ring.size !== before || r.timer === null)) expireBy(r, r.ctx.clock.now() + PROTECT_BUDGETS.ringWindowMs + 1);
    },

    onSendHeaders(details: RequestDetailsLike) {
      run?.matcher.onSendHeaders(details);
    },

    onOutcome(event: OutcomeEvent) {
      run?.matcher.onOutcome(event);
    },

    onTabRemoved(tabId: number) {
      if (run === null) return;
      run.store.forgetTab(tabId);
      run.ring.forgetTab(tabId);
      run.matcher.forgetTab(tabId);
      run.fedTabs.delete(tabId);
      const prefix = String(tabId) + ':';
      for (const key of [...run.saltedDocs]) if (key.startsWith(prefix)) run.saltedDocs.delete(key);
    },

    onClearSession() {
      if (run === null) return;
      clearTimer(run);
      run.store.clear();
      run.ring.clear();
      run.matcher.clear();
      run.preexisting.clear();
    },

    onCommitted(details: NavigationDetailsLike, tab: Readonly<ProtectTabEntry>) {
      if (run === null || details.frameId !== 0) return;
      const now = run.ctx.clock.now();
      run.store.startGrace(tab.tabId, tab.site, now);
      if (run.store.documentCount > 0) expireBy(run, now + PROTECT_BUDGETS.crossSiteGraceMs);
    },

    contributeReport(tabId: number, projection: ProtectProjection): ProtectProjection {
      const r = run;
      if (r === null) return projection;
      const fingerprints = r.store.droppedFor(tabId);
      const bodies = r.matcher.bodiesDropped(tabId);
      const limitations: ProtectLimitation[] = [...projection.limitations];
      // After a SW restart the fingerprints of this document are gone until it re-reads its fields.
      if (r.preexisting.has(projection.documentKey) && !r.fedTabs.has(tabId)) limitations.push('values-reset');
      const set = new Set(limitations);
      return {
        ...projection,
        limitations: PROTECT_LIMITATIONS.filter((l) => set.has(l)).slice(0, PROTECT_WIRE_LIMITS.maxProjectionLimitations),
        dropped: {
          ...projection.dropped,
          fingerprints: Math.min(MAX_COUNT, projection.dropped.fingerprints + fingerprints),
          bodies: Math.min(MAX_COUNT, projection.dropped.bodies + bodies),
        },
      };
    },

    debug() {
      const r = run;
      if (r === null) return { generation };
      return {
        generation,
        fields: r.store.fieldCount(),
        documents: r.store.documentCount,
        tabs: r.store.tabCount(),
        ringEntries: r.ring.size,
        ringTokens: r.ring.tokens(),
        pendingOutcomes: r.matcher.pendingOutcomes(),
        evictions: r.store.evictionCount,
        inputs: r.inputs,
        arms: r.arms,
        staleSalt: r.staleSalt,
        expiryTimer: r.timer !== null,
        ...r.stats,
      };
    },
  };
}
