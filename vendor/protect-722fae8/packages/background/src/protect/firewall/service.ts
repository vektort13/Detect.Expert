// ADR-020 §C, §11 (S08): the firewall lane of the module «Защита» in the service worker.
// - Decisions in IndexedDB are the source of truth; DNR rules (decisions / preset / session ranges) are their
//   projection, rebuilt through the dnr-port (atomic range replacement, every rule through assertAllowedRule, 5 s write
//   timeout). Mutations run one at a time (promise chain); a failed write leaves the previous rules in the local index.
// - «stopped» only by ADR-020 §11: the OutcomeTracker asks `firewallEvaluate` (this lane) which of our rules wins; the
//   local index holds only rules whose write Chrome confirmed, with their activation time. A first request to a new
//   receiver is never stopped (no rule existed before it). Counters are lower bounds and never claim user data.
// - A sent request (onSendHeaders) that our block rule, active ≥ ruleActivationSlackMs before it, should have stopped
//   is a bypass: counter + notice.
// - Prompts come from value-match evidence `third-party-before-submit` with confidence ≥ medium (receiver from the
//   browser-observed request host only); strict preset: an automatic site-level block with undo and daily limits.
// No URL, value, hash or query is kept: hosts are used inside the callbacks only.

import { MAX_COUNT, PROTECT_BUDGETS, PROTECT_WIRE_LIMITS, UNDO_ID_PATTERN, isDomainName, isSiteName } from '@detect-expert/contracts';
import type {
  DecisionScope,
  EnforcementDegraded,
  EnforcementState,
  FirewallAction,
  FirewallInactiveReason,
  FirewallNotice,
  FirewallRuleRef,
  FirewallRuleRow,
  FirewallTabView,
  ProtectEvidence,
  ProtectProjection,
  ProtectTransferEvidence,
  ProtectUiRequest,
  UiErrorCode,
  UiProtectDecideRequest,
  UiProtectDismissRequest,
  UiProtectListRulesRequest,
  UiProtectRemoveRulesRequest,
  UiProtectUndoRequest,
  UiResponse,
} from '@detect-expert/contracts';
import {
  FirewallIndex,
  checkReceiver,
  compileOnceRules,
  compileRules,
  decisionKeyOf,
  onceRuleKey,
  parseDecisionKey,
  parsePresetEntries,
  receiverOfRuleKey,
  ruleSignature,
} from '@detect-expert/engine';
import type { CompiledFirewallRule, FirewallDecision, FirewallDormantReason, FirewallPresetEntry, FirewallRequest, FirewallRuleRange } from '@detect-expert/engine';
import type { MessageSenderLike, NavigationDetailsLike, RequestDetailsLike } from '../../chrome-api';
import { DNR_WRITE_TIMEOUT_MS } from '../dnr-port';
import type { ProtectEvent } from '../event-bus';
import { fastHost } from '../net-hub';
import type { ProtectRequestContext } from '../net-hub';
import { noFirewallEvaluate } from '../outcomes';
import type { FirewallVerdict, OutcomeEvent } from '../outcomes';
import type { ProtectFeatureService, ProtectServiceContext, ProtectStopReason } from '../services';
import type { ProtectTabEntry } from '../tab-model';
import { FirewallOnceRules } from './once';
import type { OnceChange } from './once';
import { FirewallPromptBook, newFirewallId } from './prompts';
import type { TabFirewallState } from './prompts';
import { FirewallDecisionStore, localDayOf } from './store';

export interface FirewallServiceOptions {
  /**
   * Receivers with an active rule of the protection-service catalog: never blocked automatically by the strict preset
   * (REQ-008: none in production today). Default: none.
   */
  isProtectionService?: (receiver: string) => boolean;
  /** Statistics / counter flush interval (tests). */
  statsFlushMs?: number;
}

/** Undo payload kept in protect-runtime (domains, enums, a day and counters only). */
interface UndoPayload {
  kind: 'firewall';
  tabId: number;
  site: string;
  entries: Array<{ key: string; before: FirewallDecision | null; after: FirewallDecision | null }>;
  once: OnceChange[];
}

const RANGES: readonly FirewallRuleRange[] = ['decisions', 'preset', 'session'];
/** After a purge the controller clears our ranges; the preset rules come back after this delay (no write race). */
const PURGE_REBUILD_DELAY_MS = 1000;
/**
 * Review W2: stop() waits at most this long for the lane's chain (a rebuild already inside the DNR port finishes one
 * read and one write, each bounded by DNR_WRITE_TIMEOUT_MS), so the controller removes our rules after the lane's last
 * write, never before it.
 */
export const FIREWALL_STOP_DRAIN_MS = 2 * DNR_WRITE_TIMEOUT_MS + 500;

function error(code: UiErrorCode): UiResponse {
  return { schemaVersion: 1, type: 'error', code };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function sameDecision(a: FirewallDecision | null | undefined, b: FirewallDecision | null | undefined): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  return a.decisionKey === b.decisionKey && a.action === b.action && a.origin === b.origin && a.scope === b.scope && a.site === b.site && a.receiver === b.receiver;
}

function isTransfer(ev: ProtectEvidence): ev is ProtectTransferEvidence {
  return ev.protectKind === 'value-match' || ev.protectKind === 'opaque-after-input';
}

export class FirewallService implements ProtectFeatureService {
  readonly name = 'firewall' as const;
  readonly features = ['firewall'] as const;

  private ctx: ProtectServiceContext | null = null;
  private readonly store: FirewallDecisionStore;
  private once: FirewallOnceRules | null = null;
  private book: FirewallPromptBook | null = null;
  private presetEntries: FirewallPresetEntry[] = [];
  /** Rules whose write Chrome confirmed, per range. */
  private confirmed: Record<FirewallRuleRange, CompiledFirewallRule[]> = { decisions: [], preset: [], session: [] };
  /** Local DNR evaluation of the confirmed rules (verdicts, bypass). */
  private active = new FirewallIndex([]);
  /** Rules the decisions imply whatever the enforcement (effective rule of a receiver). */
  private logical = new FirewallIndex([]);
  private readonly activatedAt = new Map<CompiledFirewallRule, number>();
  private readonly activationBySignature = new Map<string, number>();
  private dormant = new Map<string, FirewallDormantReason>();
  private onceDormant = new Map<number, FirewallDormantReason>();
  private compiledPreset: string | null = null;
  private applyError: EnforcementDegraded | null = null;
  private rebuildQueued = false;
  private rebuildAfter = 0;
  private chain: Promise<unknown> = Promise.resolve();
  /** Incremented by stop(): a rebuild started before it writes nothing more (review W2). */
  private generation = 0;
  /** requestId -> (tab, receiver) of requests this lane asked the OutcomeTracker to follow (≤ maxPendingOutcomes). */
  private readonly tracked = new Map<string, { tabId: number; host: string }>();
  private readonly isProtectionService: (receiver: string) => boolean;
  private counters = { rebuilds: 0, writeFailures: 0, bypasses: 0, stopped: 0, prompts: 0, strictAuto: 0, strictAutoUnapplied: 0 };

  constructor(options: FirewallServiceOptions = {}) {
    this.isProtectionService = options.isProtectionService ?? (() => false);
    this.store = new FirewallDecisionStore({ now: () => this.ctx?.clock.now() ?? Date.now() }, options.statsFlushMs);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------------------------------------------

  async start(ctx: ProtectServiceContext): Promise<void> {
    this.ctx = ctx;
    this.book = new FirewallPromptBook(ctx.docStore);
    this.once = new FirewallOnceRules(ctx.tabModel);
    this.once.load();
    this.presetEntries = parsePresetEntries(ctx.tables.FIREWALL_PRESET_ENTRIES, { allowSynthetic: ctx.testProfile });
    await this.store.load(ctx.db);
    ctx.ports.firewallEvaluate = (details) => this.verdict(details);
    ctx.ports.pendingCount = (tabId) => this.pendingCount(tabId);
    // Reconcile: our ranges are replaced by the projection of the stored decisions (orphans in them go).
    await this.serialize(() => this.rebuild());
  }

  async stop(_reason: ProtectStopReason): Promise<void> {
    const ctx = this.ctx;
    this.ctx = null;
    this.generation++;
    // Review W2: a rebuild already writing (decide, strict-auto, once expiry, tab close) settles before the controller
    // removes our rules; bounded, and the rebuild checks the generation before every write.
    await this.drain();
    try {
      await this.store.flush();
    } catch {
      // Counters are lower bounds; a lost flush only lowers them.
    }
    this.store.stop();
    this.book?.flush();
    this.book?.clear();
    this.once?.reset();
    this.tracked.clear();
    this.confirmed = { decisions: [], preset: [], session: [] };
    this.active = new FirewallIndex([]);
    this.logical = new FirewallIndex([]);
    this.activatedAt.clear();
    // Our ranges may be removed and written again before the next start: no activation time is carried over.
    this.activationBySignature.clear();
    this.applyError = null;
    this.compiledPreset = null;
    if (ctx !== null) {
      ctx.ports.firewallEvaluate = noFirewallEvaluate;
      ctx.ports.pendingCount = () => 0;
    }
  }

  /** Review TRUTH-01: the excluded sites changed (controller chain): the «везде» and preset rules are rewritten. */
  async onExclusionsChanged(): Promise<void> {
    if (this.ctx === null) return;
    await this.serialize(() => this.rebuild());
  }

  private async drain(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([this.chain, new Promise<void>((resolve) => { timer = setTimeout(resolve, FIREWALL_STOP_DRAIN_MS); })]);
    } finally {
      clearTimeout(timer);
    }
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const next = this.chain.then(task, task);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private today(): string {
    return localDayOf(this.ctx?.clock.now() ?? Date.now());
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Rules
  // ---------------------------------------------------------------------------------------------------------------

  /** Settings change (preset) or a purge: a rebuild is queued (the controller has no settings hook for lanes). */
  private checkStale(): void {
    const ctx = this.ctx;
    if (ctx === null || this.rebuildQueued) return;
    const purgeDue = this.rebuildAfter > 0 && ctx.clock.now() >= this.rebuildAfter;
    if (ctx.settings().preset === this.compiledPreset && !purgeDue) return;
    this.rebuildQueued = true;
    this.rebuildAfter = 0;
    void this.serialize(async () => {
      this.rebuildQueued = false;
      await this.rebuild();
    });
  }

  /** Compiles the decisions, writes the three ranges and refreshes the indexes. Inside the chain only. */
  private async rebuild(): Promise<void> {
    const ctx = this.ctx;
    const once = this.once;
    if (ctx === null || once === null) return;
    const generation = this.generation;
    this.counters.rebuilds++;
    const preset = ctx.settings().preset;
    this.compiledPreset = preset;
    const features = ctx.dnrPort.features();
    const limits = ctx.dnrPort.limits();
    const decisions = this.store.all();
    // Review TRUTH-01: «везде» and preset block rules do not act on the module's excluded sites.
    const excludedSites = ctx.excludedSites();
    // What the decisions imply (warn-only included: the effective rule is shown, nothing is written).
    const logicalPreset = preset === 'warn-only' ? 'normal' : preset;
    const logical = compileRules({ decisions, presetEntries: this.presetEntries, preset: logicalPreset, features, maxDynamic: limits.dynamic, excludedSites });
    const logicalOnce = compileOnceRules({ once: once.all(), decisions, presetEntries: this.presetEntries, preset: logicalPreset, features });
    this.logical = new FirewallIndex([...logical.dynamic, ...logicalOnce.session]);
    const compiled = compileRules({ decisions, presetEntries: this.presetEntries, preset, features, maxDynamic: limits.dynamic, excludedSites });
    const onceCompiled = compileOnceRules({ once: once.all(), decisions, presetEntries: this.presetEntries, preset, features });
    this.dormant = new Map(compiled.dormant.map((d) => [d.decisionKey, d.reason]));
    this.onceDormant = new Map(onceCompiled.dormant.map((d) => [d.slot, d.reason]));
    const desired: Record<FirewallRuleRange, CompiledFirewallRule[]> = {
      decisions: compiled.dynamic.filter((r) => r.range === 'decisions'),
      preset: compiled.dynamic.filter((r) => r.range === 'preset'),
      session: onceCompiled.session,
    };
    if (!ctx.dnrPort.available()) {
      // No namespace (no grant): nothing can be written or read; our old rules may still act (SP-5), the index keeps
      // the last confirmed ones so a stop is still attributed truthfully.
      this.refreshActive();
      return;
    }
    let failure: EnforcementDegraded | null = null;
    for (const range of RANGES) {
      // Review W2: the lane was stopped meanwhile (module off, feature off, suspension): nothing more is written and
      // no lane state is touched; the controller removes what is there after stop() returned.
      if (this.generation !== generation || this.ctx !== ctx) return;
      const rules = desired[range];
      const result = range === 'session' ? await ctx.dnrPort.applySession(rules.map((r) => r.rule)) : await ctx.dnrPort.applyDynamic(range, rules.map((r) => r.rule));
      if (this.generation !== generation || this.ctx !== ctx) return;
      if (!result.ok) {
        failure ??= result.code;
        this.counters.writeFailures++;
        continue;
      }
      const now = ctx.clock.now();
      for (const r of rules) {
        const sig = ruleSignature(r.rule);
        const known = this.activationBySignature.get(sig);
        // Unchanged range: the rules were in Chrome before (since an unknown earlier time). Rewritten range: a rule
        // identical to a confirmed one stays active through the atomic replacement; a new rule is active from now.
        const at = known ?? (result.changed ? now : 0);
        this.activationBySignature.set(sig, at);
      }
      this.confirmed[range] = rules;
    }
    const live = new Set<string>();
    for (const range of RANGES) for (const r of this.confirmed[range]) live.add(ruleSignature(r.rule));
    for (const sig of [...this.activationBySignature.keys()]) if (!live.has(sig)) this.activationBySignature.delete(sig);
    this.applyError = failure;
    this.refreshActive();
  }

  private refreshActive(): void {
    const rules = [...this.confirmed.decisions, ...this.confirmed.preset, ...this.confirmed.session];
    this.activatedAt.clear();
    for (const r of rules) this.activatedAt.set(r, this.activationBySignature.get(ruleSignature(r.rule)) ?? Number.POSITIVE_INFINITY);
    this.active = new FirewallIndex(rules);
  }

  private enforcement(): { state: EnforcementState; code?: EnforcementDegraded } {
    const ctx = this.ctx;
    if (ctx === null) return { state: 'off' };
    if (!ctx.dnrPort.available()) return { state: 'no-permission' };
    if (ctx.settings().preset === 'warn-only') return { state: 'warn-only' };
    const code = this.applyError ?? (ctx.dnrPort.degraded === 'cleanup-pending' ? 'cleanup-pending' : null);
    return code === null ? { state: 'active' } : { state: 'degraded', code };
  }

  /** Trusted view of a webRequest event for the local evaluation (hosts from the URL inside the call). */
  private requestOf(details: RequestDetailsLike): FirewallRequest | null {
    const ctx = this.ctx;
    if (ctx === null) return null;
    const target = fastHost(details.url);
    if (target === null) return null;
    const initiator = typeof details.initiator === 'string' && details.initiator !== 'null' ? (fastHost(details.initiator)?.host ?? null) : null;
    // The top frame's own requests carry its origin as initiator; others take the tab model's top site.
    const top = details.frameId === 0 && initiator !== null ? initiator : (ctx.tabModel.get(details.tabId)?.site ?? null);
    return { receiverHost: target.host, topDomain: top, initiatorDomain: initiator, tabId: details.tabId, type: details.type, url: details.url };
  }

  /** OutcomeTracker port: our winning rule and when it became active in Chrome. */
  private verdict(details: RequestDetailsLike): FirewallVerdict | null {
    if (this.active.size === 0) return null;
    const req = this.requestOf(details);
    if (req === null) return null;
    const m = this.active.evaluate(req);
    if (m === null) return null;
    return { ruleKey: m.ruleKey, action: m.action, activatedAt: this.activatedAt.get(m.rule) ?? Number.POSITIVE_INFINITY };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // webRequest (hot paths: cheap checks first)
  // ---------------------------------------------------------------------------------------------------------------

  onRequest(details: RequestDetailsLike, _request: ProtectRequestContext): void {
    const ctx = this.ctx;
    if (ctx === null || this.active.size === 0 || details.type === 'main_frame') return;
    const target = fastHost(details.url);
    if (target === null || !this.active.targets(target.host)) return;
    const req = this.requestOf(details);
    const m = req === null ? null : this.active.evaluate(req);
    const id = details.requestId;
    if (m === null || m.action !== 'block' || typeof id !== 'string') return;
    // Armed tabs only: the stop of this request becomes observable (onErrorOccurred of a tracked request).
    if (!ctx.outcomes.track(id, details.tabId, details.timeStamp)) return;
    this.tracked.delete(id);
    this.tracked.set(id, { tabId: details.tabId, host: target.host });
    while (this.tracked.size > PROTECT_BUDGETS.maxPendingOutcomes) {
      const oldest = this.tracked.keys().next();
      if (oldest.done) break;
      this.tracked.delete(oldest.value);
    }
  }

  onSendHeaders(details: RequestDetailsLike, _request: ProtectRequestContext): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    if (this.compiledPreset !== ctx.settings().preset || this.rebuildAfter > 0) this.checkStale();
    const book = this.book;
    if (this.active.size === 0 && (book === null || book.size === 0)) return;
    if (details.type === 'main_frame') return;
    const target = fastHost(details.url);
    if (target === null) return;
    if (book !== null && book.has(details.tabId)) {
      const receiver = book.receiverOfHost(details.tabId, target.host);
      if (receiver !== null) book.countDelivery(details.tabId, receiver, 'sent');
    }
    if (this.active.size === 0 || !this.active.targets(target.host)) return;
    const req = this.requestOf(details);
    if (req === null || req.topDomain === null) return;
    const m = this.active.evaluate(req);
    if (m === null || m.action !== 'block') return;
    const at = this.activatedAt.get(m.rule) ?? Number.POSITIVE_INFINITY;
    if (at > details.timeStamp - PROTECT_BUDGETS.ruleActivationSlackMs) return;
    this.noteBypass(m.rule, details.tabId, target.host);
  }

  private noteBypass(rule: CompiledFirewallRule, tabId: number, host: string): void {
    this.counters.bypasses++;
    this.store.noteBypass(rule.range === 'decisions' ? rule.ruleKey : null);
    const book = this.book;
    const s = book?.peek(tabId);
    if (book === null || s === undefined) return;
    const receiver = book.receiverOfHost(tabId, host) ?? rule.receiver;
    if (!isDomainName(receiver)) return;
    const prev = s.notices.find((n) => n.kind === 'bypass' && n.receiver === receiver);
    book.addNotice(s, { kind: 'bypass', receiver, count: Math.min(MAX_COUNT, (prev?.count ?? 0) + 1) });
  }

  onOutcome(event: OutcomeEvent): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    const info = this.tracked.get(event.requestId);
    if (info !== undefined) this.tracked.delete(event.requestId);
    if (event.state === 'sent') return; // counted in onSendHeaders
    let host = info?.host ?? null;
    if (event.state === 'stopped' && event.ruleKey !== undefined) {
      this.counters.stopped++;
      const decisionKey = parseDecisionKey(event.ruleKey) === null ? null : event.ruleKey;
      this.store.noteStopped(decisionKey, this.today());
      const ruleReceiver = this.receiverOfKey(event.ruleKey);
      host ??= ruleReceiver;
      if (ruleReceiver !== null) {
        ctx.eventBus.publish({ kind: 'blocked', tabId: event.tabId, site: ctx.tabModel.get(event.tabId)?.site ?? null, receiver: ruleReceiver, ruleKey: event.ruleKey });
      }
    }
    if (host !== null && this.book !== null) {
      const receiver = this.book.receiverOfHost(event.tabId, host);
      if (receiver !== null) this.book.countDelivery(event.tabId, receiver, event.state);
    }
  }

  private receiverOfKey(ruleKey: string): string | null {
    if (ruleKey.startsWith('preset:')) {
      const id = ruleKey.slice('preset:'.length);
      return this.presetEntries.find((e) => e.entryId === id)?.host ?? null;
    }
    return receiverOfRuleKey(ruleKey);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Evidence -> prompts (and the strict preset)
  // ---------------------------------------------------------------------------------------------------------------

  onEvent(event: ProtectEvent): void {
    if (event.kind === 'evidence-scrubbed') {
      this.book?.dropScripts(event.tabId, event.receivers);
      return;
    }
    if (event.kind !== 'evidence') return;
    this.ingestEvidence(event.tabId, event.evidence);
  }

  private hasDecision(tabId: number, site: string, receiver: string): boolean {
    return (
      this.store.get(decisionKeyOf('site', site, receiver)) !== undefined ||
      this.store.get(decisionKeyOf('everywhere', null, receiver)) !== undefined ||
      this.once?.find(tabId, receiver) !== undefined
    );
  }

  private ingestEvidence(tabId: number, ev: ProtectEvidence): void {
    const ctx = this.ctx;
    const book = this.book;
    const once = this.once;
    if (ctx === null || book === null || once === null || !isTransfer(ev)) return;
    const receiver = ev.receiver;
    if (receiver === undefined || !ev.transferClass.startsWith('third-party')) return;
    if (ctx.isTabExcluded(tabId)) return;
    const site = ctx.tabModel.get(tabId)?.site ?? null;
    const topKey = ctx.tabModel.topDocumentKey(tabId);
    if (site === null || topKey === null) return;
    this.checkStale();
    const s = book.state(tabId, topKey, site);
    book.noteEvidence(s, ev);
    if (ev.transferClass !== 'third-party-before-submit' || ev.interpretationConfidence === 'low') return;
    if (checkReceiver(receiver, site) !== 'ok') return;
    if (this.hasDecision(tabId, site, receiver) || once.isDismissed(tabId, site)) return;
    if (ctx.settings().preset === 'strict' && !this.isProtectionService(receiver)) {
      void this.serialize(() => this.strictAuto(tabId, site, receiver));
      return;
    }
    if (book.addToPrompt(s, [receiver], (r) => this.hasDecision(tabId, site, r))) this.counters.prompts++;
  }

  /** Strict preset: a site-level block (origin preset, undo) within the daily limits; «везде» only by a click. */
  private async strictAuto(tabId: number, site: string, receiver: string): Promise<void> {
    const ctx = this.ctx;
    const book = this.book;
    if (ctx === null || book === null) return;
    const topKey = ctx.tabModel.topDocumentKey(tabId);
    if (topKey === null || ctx.tabModel.get(tabId)?.site !== site || this.hasDecision(tabId, site, receiver)) return;
    const s = book.state(tabId, topKey, site);
    const day = this.today();
    const usage = this.store.strictUsage(day, site);
    const slots = this.store.freeSlots(1);
    if (!this.store.available) {
      // No storage: the user decides in the card (a decision would fail with storage-unavailable there too).
      book.addToPrompt(s, [receiver], (r) => this.hasDecision(tabId, site, r));
      return;
    }
    if (usage.site >= PROTECT_BUDGETS.maxStrictAutoPerSitePerDay || usage.total >= PROTECT_BUDGETS.maxStrictAutoPerDay || slots === null) {
      book.addNotice(s, { kind: 'limit-reached', receiver, site });
      book.addToPrompt(s, [receiver], (r) => this.hasDecision(tabId, site, r));
      return;
    }
    const decision: FirewallDecision = {
      decisionKey: decisionKeyOf('site', site, receiver), receiver, site, scope: 'site', action: 'block', origin: 'preset', slot: slots[0]!, createdDay: day, stopped: 0, bypass: 0,
    };
    try {
      await this.store.apply([decision], []);
    } catch {
      book.addToPrompt(s, [receiver], (r) => this.hasDecision(tabId, site, r));
      return;
    }
    this.store.noteStrictAuto(day, site);
    this.counters.strictAuto++;
    await this.rebuild();
    // ADR-020 §11: «теперь останавливаются» only once Chrome confirmed our rule. A rejected or hung write (SP-1) keeps
    // the stored decision without that notice: the receiver stays in the card, whose degraded / restart notice says
    // that blocking does not act yet.
    if (this.ruleApplied(tabId, site, receiver, 'site')) {
      const undoId = this.pushUndo({ kind: 'firewall', tabId, site, entries: [{ key: decision.decisionKey, before: null, after: decision }], once: [] });
      book.addNotice(s, { kind: 'strict-auto', receiver, site, undoId });
    } else this.counters.strictAutoUnapplied++;
    // The card can keep the block, allow it, or widen it to «везде» (a click only).
    book.addToPrompt(s, [receiver], (r) => this.hasDecision(tabId, site, r));
    const sites = new Set(this.store.all().filter((d) => d.receiver === receiver && d.scope === 'site' && d.action === 'block').map((d) => d.site));
    if (sites.size >= 2) book.addNotice(s, { kind: 'strict-escalate', receiver, count: sites.size });
  }

  private pushUndo(payload: UndoPayload): string {
    const undoId = newFirewallId();
    const now = this.ctx?.clock.now() ?? Date.now();
    this.ctx?.docStore.updateRuntime((cur) => ({ ...cur, undo: [...cur.undo, { undoId, at: now, payload }] }));
    return undoId;
  }

  /** Receivers of the tab's prompt still waiting for a decision (badge, S09). */
  pendingCount(tabId: number): number {
    const ctx = this.ctx;
    const s = this.book?.peek(tabId);
    if (ctx === null || s === undefined || s.prompt === null || ctx.tabModel.get(tabId)?.site !== s.site) return 0;
    let n = 0;
    for (const r of s.prompt.receivers) if (!this.hasDecision(tabId, s.site, r)) n++;
    return n;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Tabs and navigation
  // ---------------------------------------------------------------------------------------------------------------

  onCommitted(_details: NavigationDetailsLike, entry: Readonly<ProtectTabEntry>): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    if (this.once?.onCommitted(entry.tabId, entry.site) === true) void this.serialize(() => this.rebuild());
    const book = this.book;
    const s = book?.peek(entry.tabId);
    if (book === null || s === undefined) return;
    const topKey = ctx.tabModel.topDocumentKey(entry.tabId);
    if (entry.site === s.site && topKey !== null) book.state(entry.tabId, topKey, entry.site);
    else book.forget(entry.tabId);
  }

  onTabRemoved(tabId: number): void {
    if (this.once?.onTabGone(tabId) === true) void this.serialize(() => this.rebuild());
    this.book?.forget(tabId);
    for (const [id, info] of [...this.tracked]) if (info.tabId === tabId) this.tracked.delete(id);
  }

  onClearSession(): void {
    this.book?.clear();
    this.tracked.clear();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------------------------------------------

  handleUi(type: ProtectUiRequest['type'], request: ProtectUiRequest, _sender: MessageSenderLike): Promise<UiResponse | undefined> | UiResponse | undefined {
    this.checkStale();
    switch (type) {
      case 'ui-protect-decide':
        return this.serialize(() => this.decide(request as UiProtectDecideRequest));
      case 'ui-protect-undo':
        return this.serialize(() => this.undo(request as UiProtectUndoRequest));
      case 'ui-protect-dismiss':
        return this.serialize(() => this.dismiss(request as UiProtectDismissRequest));
      case 'ui-protect-list-rules':
        return this.serialize(async () => this.listRules(request as UiProtectListRulesRequest));
      case 'ui-protect-remove-rules':
        return this.serialize(() => this.removeRules(request as UiProtectRemoveRulesRequest));
      case 'ui-protect-purge':
        return this.purgeDecisions();
      default:
        return undefined;
    }
  }

  /** Prompt of (tab, site) the request refers to, or the error to answer. */
  private promptFor(tabId: number, documentKey: string, revision: number, promptId: string): { s: TabFirewallState; site: string } | UiErrorCode {
    const ctx = this.ctx;
    const book = this.book;
    if (ctx === null || book === null) return 'module-disabled';
    const topKey = ctx.tabModel.topDocumentKey(tabId);
    const site = ctx.tabModel.get(tabId)?.site ?? null;
    if (topKey === null || topKey !== documentKey || site === null) return 'document-mismatch';
    const s = book.state(tabId, topKey, site);
    if (s.prompt === null || s.prompt.promptId !== promptId) return 'stale-revision';
    if (s.prompt.site !== site) return 'document-mismatch';
    if (revision > (ctx.docStore.doc(topKey)?.protectRevision ?? 0)) return 'stale-revision';
    return { s, site };
  }

  private ruleApplied(tabId: number, site: string, receiver: string, scope: DecisionScope): boolean {
    if (this.enforcement().state !== 'active') return false;
    if (scope === 'once') {
      const o = this.once?.find(tabId, receiver);
      if (o === undefined) return false;
      const onceReason = this.onceDormant.get(o.slot);
      // An allow that nothing overlaps needs no rule: the decision is in effect as stored.
      if (onceReason === 'not-needed') return true;
      if (onceReason !== undefined) return false;
      const onceKey = onceRuleKey(tabId, o.site, receiver);
      return this.confirmed.session.some((r) => r.ruleKey === onceKey);
    }
    const key = decisionKeyOf(scope, scope === 'site' ? site : null, receiver);
    const reason = this.dormant.get(key);
    if (reason === 'not-needed') return true;
    if (reason !== undefined) return false;
    return this.confirmed.decisions.some((r) => r.ruleKey === key);
  }

  private async decide(req: UiProtectDecideRequest): Promise<UiResponse> {
    const ctx = this.ctx;
    const book = this.book;
    const once = this.once;
    if (ctx === null || book === null || once === null) return error('module-disabled');
    const found = this.promptFor(req.tabId, req.documentKey, req.protectRevision, req.promptId);
    if (typeof found === 'string') return error(found);
    const { s, site } = found;
    if (!req.receivers.every((r) => s.prompt?.receivers.includes(r) === true)) return error('stale-revision');
    for (const r of req.receivers) {
      const check = checkReceiver(r, site);
      if (check === 'unsafe-receiver') return error('unsafe-receiver');
      if (check !== 'ok') return error('invalid-request');
    }
    const payload: UndoPayload = { kind: 'firewall', tabId: req.tabId, site, entries: [], once: [] };
    if (req.scope === 'once') {
      const changes = once.set(req.tabId, site, req.receivers, req.action);
      if (changes === null) return error('limit-reached');
      payload.once = changes;
    } else {
      const day = this.today();
      const puts: FirewallDecision[] = [];
      const deletes: string[] = [];
      const fresh = req.receivers.filter((r) => this.store.get(decisionKeyOf(req.scope as 'site' | 'everywhere', req.scope === 'site' ? site : null, r)) === undefined);
      const slots = fresh.length === 0 ? [] : this.store.freeSlots(fresh.length);
      if (slots === null) return error('limit-reached');
      if (!this.store.available) return error('storage-unavailable');
      let next = 0;
      for (const r of req.receivers) {
        const key = decisionKeyOf(req.scope, req.scope === 'site' ? site : null, r);
        const before = this.store.get(key) ?? null;
        const after: FirewallDecision = before === null
          ? { decisionKey: key, receiver: r, site: req.scope === 'site' ? site : null, scope: req.scope, action: req.action, origin: 'user', slot: slots[next++]!, createdDay: day, stopped: 0, bypass: 0 }
          : { ...before, action: req.action, origin: 'user', createdDay: day };
        puts.push(after);
        payload.entries.push({ key, before: before === null ? null : { ...before }, after: { ...after } });
        if (req.scope === 'everywhere') {
          // Decided on this site for every site: a different decision of this site for the receiver gives way.
          const siteKey = decisionKeyOf('site', site, r);
          const siteBefore = this.store.get(siteKey);
          if (siteBefore !== undefined && siteBefore.action !== req.action) {
            deletes.push(siteKey);
            payload.entries.push({ key: siteKey, before: { ...siteBefore }, after: null });
          }
        }
      }
      try {
        await this.store.apply(puts, deletes);
      } catch {
        return error('storage-unavailable');
      }
    }
    book.removeFromPrompt(s, req.receivers);
    book.removeNotices(s, (n) => req.receivers.includes(n.receiver) && (n.kind === 'strict-auto' || n.kind === 'strict-escalate' || n.kind === 'limit-reached'));
    const undoId = this.pushUndo(payload);
    await this.rebuild();
    return {
      schemaVersion: 1,
      type: 'protect-decision',
      applied: req.receivers.map((r) => ({ receiver: r, ruleApplied: this.ruleApplied(req.tabId, site, r, req.scope) })),
      undoId,
      report: null,
    };
  }

  private readUndo(v: unknown): UndoPayload | null {
    if (!isRecord(v) || v['kind'] !== 'firewall' || !Number.isSafeInteger(v['tabId']) || typeof v['site'] !== 'string' || !isSiteName(v['site'])) return null;
    if (!Array.isArray(v['entries']) || !Array.isArray(v['once'])) return null;
    return v as unknown as UndoPayload;
  }

  private async undo(req: UiProtectUndoRequest): Promise<UiResponse> {
    const ctx = this.ctx;
    const once = this.once;
    const book = this.book;
    if (ctx === null || once === null || book === null) return error('module-disabled');
    if (!UNDO_ID_PATTERN.test(req.undoId)) return error('invalid-request');
    const entry = ctx.docStore.runtime().undo.find((u) => u.undoId === req.undoId);
    const payload = entry === undefined ? null : this.readUndo(entry.payload);
    if (payload === null || payload.tabId !== req.tabId) return error('not-found');
    // Applied only when nothing changed since the decision.
    for (const e of payload.entries) if (!sameDecision(this.store.get(e.key) ?? null, e.after)) return error('stale-revision');
    for (const c of payload.once) if ((once.find(payload.tabId, c.receiver)?.action ?? null) !== c.after) return error('stale-revision');
    const puts: FirewallDecision[] = [];
    const deletes: string[] = [];
    const reserved = new Set<number>();
    for (const e of payload.entries) {
      if (e.before === null) deletes.push(e.key);
      else {
        const current = this.store.get(e.key);
        let slot = current?.slot ?? e.before.slot;
        const owner = this.store.all().find((d) => d.slot === slot && d.decisionKey !== e.key);
        if (owner !== undefined || reserved.has(slot)) {
          const free = this.store.freeSlots(1, reserved);
          if (free === null) return error('limit-reached');
          slot = free[0]!;
        }
        reserved.add(slot);
        puts.push({ ...e.before, slot });
      }
    }
    if (payload.entries.length > 0) {
      try {
        await this.store.apply(puts, deletes);
      } catch {
        return error('storage-unavailable');
      }
    }
    for (const c of payload.once) once.set(payload.tabId, payload.site, [c.receiver], c.before);
    ctx.docStore.updateRuntime((cur) => ({ ...cur, undo: cur.undo.filter((u) => u.undoId !== req.undoId) }));
    await this.rebuild();
    const receivers = [...new Set([...payload.entries.map((e) => (e.before ?? e.after)?.receiver), ...payload.once.map((c) => c.receiver)].filter((r): r is string => typeof r === 'string'))];
    // Undecided again on the same site: back into the prompt.
    const topKey = ctx.tabModel.topDocumentKey(payload.tabId);
    if (topKey !== null && ctx.tabModel.get(payload.tabId)?.site === payload.site) {
      const s = book.state(payload.tabId, topKey, payload.site);
      book.removeNotices(s, (n) => n.undoId === req.undoId);
      const open = receivers.filter((r) => !this.hasDecision(payload.tabId, payload.site, r));
      if (open.length > 0) book.addToPrompt(s, open, (r) => this.hasDecision(payload.tabId, payload.site, r));
    }
    return {
      schemaVersion: 1,
      type: 'protect-decision',
      applied: receivers.slice(0, PROTECT_BUDGETS.maxPromptReceivers).map((r) => ({ receiver: r, ruleApplied: false })),
      undoId: null,
      report: null,
    };
  }

  private async dismiss(req: UiProtectDismissRequest): Promise<UiResponse> {
    const found = this.promptFor(req.tabId, req.documentKey, req.protectRevision, req.promptId);
    if (typeof found === 'string') return error(found);
    this.once?.dismiss(req.tabId, found.site);
    this.book?.clearPrompt(found.s);
    return { schemaVersion: 1, type: 'protect-decision', applied: [], undoId: null, report: null };
  }

  private inactiveReason(key: string): FirewallInactiveReason | null {
    const e = this.enforcement();
    if (e.state === 'off' || e.state === 'warn-only' || e.state === 'no-permission' || e.state === 'degraded') return e.state;
    const dormant = this.dormant.get(key);
    if (dormant === 'rule-limit') return 'rule-limit';
    if (dormant === 'invalid') return 'degraded';
    return null;
  }

  private listRules(req: Pick<UiProtectListRulesRequest, 'offset' | 'limit' | 'domainFilter' | 'action'>): UiResponse {
    const ctx = this.ctx;
    if (ctx === null) return error('module-disabled');
    const filter = req.domainFilter;
    const rows = this.store
      .all()
      .filter((d) => (req.action === undefined || d.action === req.action) && (filter === undefined || d.receiver.includes(filter) || (d.site ?? '').includes(filter)))
      .sort((a, b) => (a.createdDay < b.createdDay ? 1 : a.createdDay > b.createdDay ? -1 : a.decisionKey < b.decisionKey ? -1 : a.decisionKey > b.decisionKey ? 1 : 0));
    const page: FirewallRuleRow[] = rows.slice(req.offset, req.offset + Math.min(req.limit, PROTECT_WIRE_LIMITS.maxRulesPageSize)).map((d) => {
      const reason = this.inactiveReason(d.decisionKey);
      return {
        ruleKey: d.decisionKey,
        receiver: d.receiver,
        site: d.site,
        scope: d.scope,
        action: d.action,
        origin: d.origin,
        createdDay: d.createdDay,
        active: reason === null,
        ...(reason === null ? {} : { inactiveReason: reason }),
        stopped: d.stopped,
        bypass: d.bypass,
      };
    });
    return { schemaVersion: 1, type: 'protect-rules', total: rows.length, rows: page, preset: ctx.settings().preset, stoppedDays: this.store.stoppedDays() };
  }

  private async removeRules(req: UiProtectRemoveRulesRequest): Promise<UiResponse> {
    const keys = req.ruleKeys.filter((k) => this.store.get(k) !== undefined);
    if (keys.length > 0) {
      try {
        await this.store.apply([], keys);
      } catch {
        return error('storage-unavailable');
      }
      await this.rebuild();
    }
    return this.listRules({ offset: 0, limit: PROTECT_WIRE_LIMITS.maxRulesPageSize });
  }

  /**
   * ui-protect-purge 'decisions' (called by the controller before it clears the store and our three ranges): memory
   * goes; the preset rules come back after the controller's writes (no write race on the dnr-port).
   */
  private purgeDecisions(): undefined {
    const ctx = this.ctx;
    this.store.clearMemory();
    this.once?.clearRules();
    this.tracked.clear();
    this.confirmed = { decisions: [], preset: [], session: [] };
    this.activationBySignature.clear();
    this.refreshActive();
    this.logical = new FirewallIndex([]);
    this.dormant.clear();
    this.applyError = null;
    if (ctx !== null) this.rebuildAfter = ctx.clock.now() + PURGE_REBUILD_DELAY_MS;
    return undefined;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Projection
  // ---------------------------------------------------------------------------------------------------------------

  private effectiveRule(tabId: number, site: string, receiver: string): FirewallRuleRef | null {
    const m = this.logical.evaluate({ receiverHost: receiver, topDomain: site, initiatorDomain: site, tabId, type: 'xmlhttprequest' });
    if (m === null) return null;
    return { action: m.action, scope: m.rule.scope, origin: m.rule.origin };
  }

  contributeReport(tabId: number, projection: ProtectProjection): ProtectProjection {
    const ctx = this.ctx;
    const book = this.book;
    if (ctx === null || book === null) return projection;
    this.checkStale();
    const site = ctx.tabModel.get(tabId)?.site ?? null;
    const topKey = ctx.tabModel.topDocumentKey(tabId);
    let s = book.peek(tabId);
    if (s === undefined && site !== null && topKey !== null && ctx.docStore.doc(topKey) !== undefined) s = book.state(tabId, topKey, site);
    if (s !== undefined && (s.site !== site || topKey === null)) s = undefined;
    const enforcement = this.enforcement();
    const snoozed = projection.firewall.snoozedUntil !== null;
    const { degradedCode: _ignored, ...base } = projection.firewall;
    const firewall: FirewallTabView = {
      ...base,
      enforcement: enforcement.state,
      ...(enforcement.state === 'degraded' && enforcement.code !== undefined ? { degradedCode: enforcement.code } : {}),
      preset: ctx.settings().preset,
      stoppedToday: { count: this.store.stoppedOn(this.today()), countQuality: 'lower-bound' },
      prompt: snoozed || s === undefined || s.prompt === null ? null : { ...s.prompt, receivers: [...s.prompt.receivers] },
      receivers: s === undefined || site === null ? [] : [...s.receivers.values()].slice(0, PROTECT_WIRE_LIMITS.maxFirewallReceivers).map((v) => ({ ...v, delivery: { ...v.delivery }, effectiveRule: this.effectiveRule(tabId, site, v.receiver) })),
      notices: s === undefined ? [] : s.notices.slice(-PROTECT_BUDGETS.maxNoticesPerTab).map((n): FirewallNotice => ({ ...n })),
      onceRules: (this.once?.forTab(tabId) ?? []).slice(0, PROTECT_WIRE_LIMITS.maxOnceRules).map((o) => ({ receiver: o.receiver, action: o.action })),
    };
    return { ...projection, firewall };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Diagnostics and the test harness
  // ---------------------------------------------------------------------------------------------------------------

  debug(): Record<string, number | boolean> {
    return {
      decisions: this.store.size,
      onceRules: this.once?.size ?? 0,
      activeRules: this.active.size,
      logicalRules: this.logical.size,
      presetEntries: this.presetEntries.length,
      prompts: this.book?.size ?? 0,
      tracked: this.tracked.size,
      degraded: this.applyError !== null,
      stoppedToday: this.store.stoppedOn(this.today()),
      rebuilds: this.counters.rebuilds,
      writeFailures: this.counters.writeFailures,
      bypasses: this.counters.bypasses,
      stopped: this.counters.stopped,
      strictAuto: this.counters.strictAuto,
      strictAutoUnapplied: this.counters.strictAutoUnapplied,
    };
  }

  /**
   * Test profile only (the controller refuses it elsewhere):
   * - `{op:'evidence', tabId, receiver, transferClass?, interpretationConfidence?, fieldKind?}` — a synthetic transfer
   *   record through the same path as value-match evidence (prompt, receiver view, strict preset);
   * - `{op:'arm', tabId}` — arms the tab's request listener as a focus on a tracked field would (stops observable);
   * - `{op:'bulk', count, action?}` — `count` synthetic everywhere decisions (limits and the DNR write record).
   */
  async debugInject(payload: unknown): Promise<unknown> {
    const ctx = this.ctx;
    if (ctx === null || !ctx.testProfile || !isRecord(payload)) throw new Error('firewall-inject-invalid');
    const op = payload['op'];
    const tabId = payload['tabId'];
    if (op === 'arm') {
      if (typeof tabId !== 'number') throw new Error('firewall-inject-invalid');
      return ctx.netHub.arm(tabId);
    }
    if (op === 'evidence') {
      const receiver = payload['receiver'];
      if (typeof tabId !== 'number' || typeof receiver !== 'string' || !isDomainName(receiver)) throw new Error('firewall-inject-invalid');
      const transferClass = typeof payload['transferClass'] === 'string' ? payload['transferClass'] : 'third-party-before-submit';
      const confidence = payload['interpretationConfidence'] === 'low' || payload['interpretationConfidence'] === 'medium' ? payload['interpretationConfidence'] : 'high';
      const fieldKind = payload['fieldKind'] === 'phone' || payload['fieldKind'] === 'name' ? payload['fieldKind'] : 'email';
      const ev: ProtectTransferEvidence = {
        evidenceId: 'pe-fw' + String(this.counters.prompts % 1000),
        protectKind: 'value-match',
        ruleId: 'form-leak',
        frameContext: 'top',
        attributionConfidence: 'unknown',
        count: 1,
        countQuality: 'exact',
        firstSecond: 0,
        lastSecond: 0,
        evidenceSource: 'derived',
        integrity: 'derived',
        ruleVersion: '1',
        limitationCodes: ['party-by-registrable-domain'],
        transferClass: transferClass as ProtectTransferEvidence['transferClass'],
        fieldKind,
        encodings: ['sha256-hex'],
        location: 'query',
        receiver,
        relation: 'cross-site',
        method: 'GET',
        requestKind: 'xhr',
        endpointHost: receiver,
        endpointPathTemplate: '/',
        submitTiming: 'before-submit',
        deliveryState: 'unknown',
        interpretationConfidence: confidence,
      };
      this.ingestEvidence(tabId, ev);
      await this.serialize(async () => undefined);
      return this.debug();
    }
    if (op === 'bulk') {
      const n = payload['count'];
      const action = payload['action'] === 'allow' ? 'allow' : 'block';
      if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1 || n > PROTECT_BUDGETS.maxDecisions) throw new Error('firewall-inject-invalid');
      return this.serialize(async () => {
        const slots = this.store.freeSlots(Math.min(n, PROTECT_BUDGETS.maxDecisions - this.store.size));
        const day = this.today();
        const puts: FirewallDecision[] = (slots ?? []).map((slot, i) => {
          const receiver = 'fwbulk' + String(slot) + '-' + String(i) + '.net';
          return { decisionKey: decisionKeyOf('everywhere', null, receiver), receiver, site: null, scope: 'everywhere', action, origin: 'user', slot, createdDay: day, stopped: 0, bypass: 0 };
        });
        await this.store.apply(puts, []);
        const started = ctx.clock.now();
        await this.rebuild();
        return { ...this.debug(), rebuildMs: ctx.clock.now() - started };
      });
    }
    throw new Error('firewall-inject-invalid');
  }
}

export function createFirewallService(options: FirewallServiceOptions = {}): ProtectFeatureService {
  return new FirewallService(options);
}
