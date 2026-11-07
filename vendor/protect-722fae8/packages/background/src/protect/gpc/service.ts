// ADR-020 §H (S13): the GPC lane of the module «Защита» in the service worker. Runs only while the module is active and
// the `gpc` feature is on.
// - Header: one dynamic DNR rule (rule.ts) written through the dnr-port, then read back and compared:
//   installed | absent | error. One attempt per trigger (start, a change of the excluded sites); no retry loop.
//   Feature off → the rule is removed here; module off / suspended → the controller removes all our rules.
// - Property: gpc.main.js is in detector-protect-main-v1 while the feature is on (registration.ts); this lane only
//   records whether the registration covered a document at load (propertyAtLoad) and whether the setting changed
//   after the commit (reloadNeeded).
// - Check: a fact per tab from webRequest.onSendHeaders (['requestHeaders'] is asked for by net-hub only with this
//   feature). Of the headers only Sec-GPC is read (header.ts). Main frame → pending per tab (memory, 60 s); the commit
//   of frame 0 turns it into the document's navigationHeader; sub_frame / xmlhttprequest / ping requests are counted
//   with / without the header (without: only when neither the target nor the initiator is excluded). Never «the
//   server received» and never a verdict about the site: Chrome's record of the outgoing request only.
// - Storage: doc-store section `gpc` of the tab's top-level document (debounced), at most maxGpcTabs tabs in memory
//   (LRU). After a SW restart the counts are lower bounds.

import { MAX_COUNT, PROTECT_BUDGETS, makeDocumentKey } from '@detect-expert/contracts';
import type { CountQuality, GpcHeaderEvidence, GpcSiteState, GpcTabFact, ProtectFeature, ProtectProjection } from '@detect-expert/contracts';
import type { AllowedDnrRule } from '@detect-expert/engine';
import type { NavigationDetailsLike, RequestDetailsLike } from '../../chrome-api';
import type { ProtectRequestContext } from '../net-hub';
import type { ProtectFeatureService, ProtectServiceContext, ProtectStopReason } from '../services';
import type { ProtectTabEntry } from '../tab-model';
import { siteOfUrl } from '../tab-model';
import { gpcHeaderOf } from './header';
import type { GpcHeaderState } from './header';
import { buildGpcRule, gpcExclusions, verifyGpcRule } from './rule';

/** A main-frame header record older than this is not used for the committed document (navigationHeader unknown). */
export const GPC_PENDING_TTL_MS = 60_000;
/** Debounce of the doc-store writes of the facts. */
export const GPC_FLUSH_MS = 1000;

export type GpcRuleStatus = 'pending' | 'installed' | 'absent' | 'error';
const RULE_STATUS_INDEX: Readonly<Record<GpcRuleStatus, number>> = { pending: 0, installed: 1, absent: 2, error: 3 };

/** Sub-request types whose header is counted (brief S13); images, scripts and others are not counted. */
const COUNTED_TYPES: ReadonlySet<string> = new Set(['sub_frame', 'xmlhttprequest', 'ping']);

interface TabFact {
  tabId: number;
  documentKey: string;
  site: string | null;
  navigationHeader: GpcHeaderEvidence;
  withHeader: number;
  withoutHeader: number;
  countQuality: CountQuality;
  propertyAtLoad: boolean;
  /** The load of the document was not seen (loaded before the lane ran): no reload claim is made. */
  unknownLoad: boolean;
  /** The lane stopped (feature off, module suspended): the signal no longer applies. */
  stopped: boolean;
}

interface PendingNavigation {
  header: GpcHeaderState;
  /** Neither the target nor the initiator was excluded (the rule applies). */
  expected: boolean;
  at: number;
}

export interface GpcServiceOptions {
  flushMs?: number;
}

export interface GpcDebug extends Record<string, number | boolean> {
  ruleStatus: number;
  ruleInstalled: boolean;
  excludedSites: number;
  tabs: number;
  pending: number;
  applies: number;
  applyFailures: number;
  verifyFailures: number;
  headersChecked: number;
  navigations: number;
}

function sat(n: number): number {
  return n >= MAX_COUNT ? MAX_COUNT : n + 1;
}

/** Reads a stored fact back (our own record; a malformed one is ignored). */
function storedFact(v: unknown, tabId: number, documentKey: string): TabFact | null {
  if (typeof v !== 'object' || v === null) return null;
  const f = v as Partial<GpcTabFact>;
  const counts = (n: unknown): number | null => (typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? Math.min(n, MAX_COUNT) : null);
  const withHeader = counts(f.requestsWithHeader);
  const withoutHeader = counts(f.requestsWithoutHeader);
  const nav = f.navigationHeader;
  if (withHeader === null || withoutHeader === null || typeof f.propertyAtLoad !== 'boolean') return null;
  if (nav !== 'observed' && nav !== 'not-observed' && nav !== 'not-applicable' && nav !== 'unknown') return null;
  const site = typeof f.site === 'string' ? f.site : null;
  return {
    tabId,
    documentKey,
    site,
    navigationHeader: nav,
    withHeader,
    withoutHeader,
    // Requests while the service worker slept were not seen.
    countQuality: 'lower-bound',
    propertyAtLoad: f.propertyAtLoad,
    unknownLoad: nav === 'unknown' && !f.propertyAtLoad,
    stopped: false,
  };
}

export class GpcService implements ProtectFeatureService {
  readonly name = 'gpc' as const;
  readonly features: readonly ProtectFeature[] = ['gpc'];

  private ctx: ProtectServiceContext | null = null;
  private status: GpcRuleStatus = 'pending';
  private excluded: string[] = [];
  private excludedSet: ReadonlySet<string> = new Set();
  private readonly facts = new Map<number, TabFact>();
  private readonly pending = new Map<number, PendingNavigation>();
  private readonly dirty = new Set<number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private readonly flushMs: number;
  private stats = { applies: 0, applyFailures: 0, verifyFailures: 0, headersChecked: 0, navigations: 0 };

  constructor(options: GpcServiceOptions = {}) {
    this.flushMs = options.flushMs ?? GPC_FLUSH_MS;
  }

  /** Current rule state (harness, tests). */
  get ruleStatus(): GpcRuleStatus {
    return this.status;
  }

  async start(ctx: ProtectServiceContext): Promise<void> {
    this.ctx = ctx;
    const generation = ++this.generation;
    this.status = 'pending';
    this.setExcluded(ctx.excludedSites());
    // Facts of the current top-level documents survive a SW restart in the doc-store (counts become lower bounds).
    for (const entry of ctx.tabModel.entries()) {
      const key = ctx.tabModel.topDocumentKey(entry.tabId);
      if (key === null) continue;
      const fact = storedFact(ctx.docStore.doc(key)?.gpc, entry.tabId, key);
      if (fact !== null) this.remember(fact);
    }
    await this.applyRule(generation);
  }

  async stop(reason: ProtectStopReason): Promise<void> {
    const ctx = this.ctx;
    this.generation++;
    this.cancelTimer();
    if (ctx !== null && reason !== 'module-off') {
      // The signal no longer applies: the facts say so (reloadNeeded where the property was set at load).
      for (const fact of this.facts.values()) {
        fact.stopped = true;
        this.dirty.add(fact.tabId);
      }
      this.flush();
    }
    if (ctx !== null && reason === 'feature-off') {
      // The header goes at once (the controller's DNR reconcile would remove the range too).
      await ctx.dnrPort.clearRange('gpc');
    }
    this.facts.clear();
    this.pending.clear();
    this.dirty.clear();
    this.status = 'pending';
    this.ctx = null;
  }

  async onExclusionsChanged(sites: readonly string[]): Promise<void> {
    if (this.ctx === null) return;
    this.setExcluded(sites);
    await this.applyRule(this.generation);
    for (const fact of this.facts.values()) this.dirty.add(fact.tabId);
    this.flush();
  }

  private setExcluded(sites: readonly string[]): void {
    this.excluded = gpcExclusions(sites);
    this.excludedSet = new Set(this.excluded);
  }

  /** One write of the rule and its read-back. Never throws; a hung or rejected write is `error` until the next trigger. */
  private async applyRule(generation: number): Promise<void> {
    const ctx = this.ctx;
    if (ctx === null) return;
    const rule: AllowedDnrRule = buildGpcRule(this.excluded);
    this.status = 'pending';
    this.stats.applies++;
    let written: boolean;
    try {
      written = (await ctx.dnrPort.applyDynamic('gpc', [rule])).ok;
    } catch {
      written = false;
    }
    if (generation !== this.generation) return;
    if (!written) {
      this.status = 'error';
      this.stats.applyFailures++;
      return;
    }
    const back = await ctx.dnrPort.readRules('gpc');
    if (generation !== this.generation) return;
    this.status = verifyGpcRule(back, rule);
    if (this.status !== 'installed') this.stats.verifyFailures++;
  }

  // ---------------------------------------------------------------------------
  // webRequest (synchronous, inside the callback)
  // ---------------------------------------------------------------------------

  private isExcludedSite(site: string | null): boolean {
    return site !== null && this.excludedSet.has(site);
  }

  /** The rule applies to the request: neither the target nor the initiator is an excluded site. */
  private expected(details: RequestDetailsLike): boolean {
    if (this.excludedSet.size === 0) return true;
    return !this.isExcludedSite(siteOfUrl(details.url)) && !this.isExcludedSite(siteOfUrl(details.initiator));
  }

  onSendHeaders(details: RequestDetailsLike, _request: ProtectRequestContext): void {
    if (this.ctx === null) return;
    const type = details.type;
    if (type === 'main_frame') {
      if (details.frameId !== 0) return;
      this.stats.headersChecked++;
      this.notePending(details.tabId, { header: gpcHeaderOf(details.requestHeaders), expected: this.expected(details), at: this.ctx.clock.now() });
      return;
    }
    if (!COUNTED_TYPES.has(type)) return;
    const tabId = details.tabId;
    let fact = this.facts.get(tabId);
    if (fact === undefined) {
      fact = this.unknownFact(tabId) ?? undefined;
      if (fact === undefined) return;
    }
    this.stats.headersChecked++;
    if (gpcHeaderOf(details.requestHeaders) === 'present') fact.withHeader = sat(fact.withHeader);
    else if (this.expected(details)) fact.withoutHeader = sat(fact.withoutHeader);
    else return;
    this.dirty.add(tabId);
    this.schedule();
  }

  private notePending(tabId: number, p: PendingNavigation): void {
    this.pending.delete(tabId);
    this.pending.set(tabId, p);
    while (this.pending.size > PROTECT_BUDGETS.maxGpcTabs) {
      const oldest = this.pending.keys().next();
      if (oldest.done) break;
      this.pending.delete(oldest.value);
    }
  }

  /** A fact for a tab whose current document committed before the lane saw it (navigation unknown, lower bound). */
  private unknownFact(tabId: number): TabFact | null {
    const ctx = this.ctx;
    if (ctx === null) return null;
    const key = ctx.tabModel.topDocumentKey(tabId);
    if (key === null) return null;
    const fact: TabFact = {
      tabId, documentKey: key, site: ctx.tabModel.get(tabId)?.site ?? null, navigationHeader: 'unknown', withHeader: 0, withoutHeader: 0,
      countQuality: 'lower-bound', propertyAtLoad: false, unknownLoad: true, stopped: false,
    };
    this.remember(fact);
    return fact;
  }

  private remember(fact: TabFact): void {
    this.facts.delete(fact.tabId);
    this.facts.set(fact.tabId, fact);
    while (this.facts.size > PROTECT_BUDGETS.maxGpcTabs) {
      const oldest = this.facts.keys().next();
      if (oldest.done) break;
      this.facts.delete(oldest.value);
      this.dirty.delete(oldest.value);
    }
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  onCommitted(_details: NavigationDetailsLike, tab: Readonly<ProtectTabEntry>): void {
    const ctx = this.ctx;
    if (ctx === null || tab.topDocumentId === null) return;
    const tabId = tab.tabId;
    const now = ctx.clock.now();
    const p = this.pending.get(tabId);
    this.pending.delete(tabId);
    const fresh = p !== undefined && now - p.at >= 0 && now - p.at <= GPC_PENDING_TTL_MS ? p : null;
    const site = tab.site;
    const excludedNow = this.isExcludedSite(site);
    let navigationHeader: GpcHeaderEvidence;
    if (fresh !== null && fresh.header === 'present') navigationHeader = 'observed';
    else if (excludedNow || (fresh !== null && !fresh.expected)) navigationHeader = 'not-applicable';
    else if (fresh !== null) navigationHeader = 'not-observed';
    else navigationHeader = 'unknown';
    this.stats.navigations++;
    this.remember({
      tabId,
      documentKey: makeDocumentKey(tabId, 0, tab.topDocumentId),
      site,
      navigationHeader,
      withHeader: 0,
      withoutHeader: 0,
      countQuality: 'exact',
      // The registration (gpc.main.js first in detector-protect-main-v1, excludeMatches from the same exclusions) was
      // in place before this lane started; an http(s) page of a site that is not excluded got the property at load.
      propertyAtLoad: site !== null && tab.scheme !== null && !excludedNow,
      unknownLoad: false,
      stopped: false,
    });
    // Written at once (the doc-store debounces storage): the fact of a load must survive a service-worker stop.
    this.persist(tabId);
  }

  onTabRemoved(tabId: number): void {
    this.facts.delete(tabId);
    this.pending.delete(tabId);
    this.dirty.delete(tabId);
  }

  onClearSession(): void {
    this.facts.clear();
    this.pending.clear();
    this.dirty.clear();
  }

  // ---------------------------------------------------------------------------
  // Projection and storage
  // ---------------------------------------------------------------------------

  private view(fact: TabFact): GpcTabFact {
    const site = fact.site;
    const excluded = this.isExcludedSite(site);
    let siteState: GpcSiteState;
    if (site === null) siteState = 'no-access';
    else if (excluded) siteState = 'excluded';
    else siteState = !fact.stopped && this.status === 'installed' ? 'on' : 'off';
    // Would the property be set if the page loaded now?
    const propertyNow = !fact.stopped && site !== null && !excluded;
    return {
      site,
      siteState,
      navigationHeader: fact.navigationHeader,
      requestsWithHeader: fact.withHeader,
      requestsWithoutHeader: fact.withoutHeader,
      countQuality: fact.countQuality,
      propertyAtLoad: fact.propertyAtLoad,
      reloadNeeded: !fact.unknownLoad && fact.propertyAtLoad !== propertyNow,
      evidenceSource: 'browser-network',
      integrity: 'browser-observed',
    };
  }

  contributeReport(tabId: number, projection: ProtectProjection): ProtectProjection {
    let fact = this.facts.get(tabId);
    if (fact === undefined || fact.documentKey !== projection.documentKey) {
      // The shown document committed before the lane saw it: nothing is known about its request.
      fact = {
        tabId, documentKey: projection.documentKey, site: projection.site, navigationHeader: 'unknown', withHeader: 0, withoutHeader: 0,
        countQuality: 'lower-bound', propertyAtLoad: false, unknownLoad: true, stopped: false,
      };
    }
    return { ...projection, gpc: this.view(fact) };
  }

  private schedule(): void {
    if (this.timer !== null || this.dirty.size === 0) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.flushMs);
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Writes one tab's fact into the doc-store section `gpc` of its document. */
  private persist(tabId: number): void {
    const ctx = this.ctx;
    const fact = this.facts.get(tabId);
    this.dirty.delete(tabId);
    if (ctx === null || fact === undefined) return;
    const stored = this.view(fact);
    ctx.docStore.update(fact.documentKey, tabId, 'gpc', () => stored);
  }

  /** Writes the dirty facts into the doc-store section `gpc` of their documents (the doc-store debounces storage). */
  flush(): void {
    this.cancelTimer();
    const ctx = this.ctx;
    if (ctx === null) {
      this.dirty.clear();
      return;
    }
    for (const tabId of [...this.dirty]) this.persist(tabId);
    this.dirty.clear();
  }

  debug(): GpcDebug {
    return {
      ruleStatus: RULE_STATUS_INDEX[this.status],
      ruleInstalled: this.status === 'installed',
      excludedSites: this.excluded.length,
      tabs: this.facts.size,
      pending: this.pending.size,
      ...this.stats,
    };
  }

  /** Test profile only (controller.inject): `{op:'status'}` → the rule state and the number of excluded sites. */
  debugInject(payload: unknown): unknown {
    const op = typeof payload === 'object' && payload !== null ? (payload as { op?: unknown }).op : undefined;
    if (op === 'status') return { status: this.status, excludedSites: this.excluded.length, tabs: this.facts.size };
    if (op === 'flush') {
      this.flush();
      return true;
    }
    throw new Error('gpc-inject: unknown op');
  }
}

export function createGpcService(options: GpcServiceOptions = {}): ProtectFeatureService {
  return new GpcService(options);
}
