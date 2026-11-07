// ADR-053 production adapter: exact launcher enable sender and fail-closed OFF persistence. Vendor stays byte-exact.
// ADR-020 §A, §3, §6–§8 (S04): controller of the opt-in module «Защита» in the service worker. The module is enabled or
// disabled as a whole; while it is off nothing of it runs: no IndexedDB, no webRequest listener, no registration, no
// DNR call and no storage write (observation behaves exactly as without the module). Mutations (load, enable, disable,
// settings, sites, purge, permission and policy changes) run one at a time through a promise chain.
//
// Enable (exact owned launcher UI): sender → organization policy → consent version → permissions → persist settings → IndexedDB →
// registrations → net-hub → lane services → DNR reconcile → protect-state. A failure in registrations / net-hub /
// services rolls the activation back and leaves `degraded` (one attempt per trigger, no retry loop); a DNR write failure
// only degrades enforcement (SP-1: writes may hang until the browser restarts after a runtime grant).
// Suspension (permission removed, organization policy, new consent version): lanes stopped, listeners removed, our DNR
// rules removed, our registrations removed, protect-control stop to the documents; settings and data are kept.

import {
  MAX_COUNT,
  PROTECT_BUDGETS,
  PROTECT_CONSENT_VERSION,
  PROTECT_LIMITATIONS,
  PROTECT_WIRE_LIMITS,
  isSanitizedHost,
  isSiteName,
  validateProtectAck,
  validateProtectPageMessage,
} from '@detect-expert/contracts';
import type {
  CoverageState,
  DocumentReport,
  EnforcementDegraded,
  FirewallTabView,
  HistoryRetentionDays,
  ProtectAck,
  ProtectFeature,
  ProtectLimitation,
  ProtectModuleState,
  ProtectPreset,
  ProtectProjection,
  ProtectPurgeTarget,
  ProtectState,
  ProtectUiRequest,
  UiErrorCode,
  UiResponse,
} from '@detect-expert/contracts';
import { DEFAULT_PROTECT_SETTINGS, PROTECT_SETTINGS_KEY, canonicalFeatures, effectiveProtectState, needsDnr, parseProtectSettings } from '@detect-expert/engine';
import type { EffectiveProtectState, ProtectSettings } from '@detect-expert/engine';
import type { BackgroundChromeApi, Clock, MessageSenderLike, NavigationDetailsLike, PermissionsLike, RequestDetailsLike } from '../../../../vendor/protect-722fae8/packages/background/src/chrome-api';
import { systemClock } from '../../../../vendor/protect-722fae8/packages/background/src/chrome-api';
import type { FrameBinding } from '../../../../vendor/protect-722fae8/packages/background/src/documents';
import { isOptionsSender } from '../../../../vendor/protect-722fae8/packages/background/src/sender';
import { isFirewallLauncherSender } from '../firewall-launcher-sender';
import type { PageSenderContext, SenderTabTop } from '../../../../vendor/protect-722fae8/packages/background/src/sender';
import { prefixRange } from '../../../../vendor/protect-722fae8/packages/background/src/protect/db-port';
import type { ProtectDb } from '../../../../vendor/protect-722fae8/packages/background/src/protect/db-port';
import { DnrPort } from '../../../../vendor/protect-722fae8/packages/background/src/protect/dnr-port';
import { ProtectDocStore } from '../../../../vendor/protect-722fae8/packages/background/src/protect/doc-store';
import type { ProtectDocState, ProtectDocStoreOptions } from '../../../../vendor/protect-722fae8/packages/background/src/protect/doc-store';
import { ProtectEventBus } from '../../../../vendor/protect-722fae8/packages/background/src/protect/event-bus';
import { IdbProtectDb, browserIdbFactory } from '../../../../vendor/protect-722fae8/packages/background/src/protect/idb';
import { NetHub } from '../../../../vendor/protect-722fae8/packages/background/src/protect/net-hub';
import type { ProtectRequestContext } from '../../../../vendor/protect-722fae8/packages/background/src/protect/net-hub';
import { OutcomeTracker, noFirewallEvaluate } from '../../../../vendor/protect-722fae8/packages/background/src/protect/outcomes';
import type { OutcomeEvent } from '../../../../vendor/protect-722fae8/packages/background/src/protect/outcomes';
import { concernsProtect, readProtectPermissions } from '../../../../vendor/protect-722fae8/packages/background/src/protect/permissions';
import type { ProtectPermissions } from '../../../../vendor/protect-722fae8/packages/background/src/protect/permissions';
import { ProtectRegistration, protectGroupMask } from '../../../../vendor/protect-722fae8/packages/background/src/protect/registration';
import type { ProtectTripwireFiles } from '../../../../vendor/protect-722fae8/packages/background/src/protect/registration';
import { EMPTY_PROTECT_TABLES, PROTECT_LANE_ROUTES, serviceEnabled } from '../../../../vendor/protect-722fae8/packages/background/src/protect/services';
import type { PersistedReportInfo, ProtectFeatureService, ProtectPorts, ProtectServiceContext, ProtectServiceName, ProtectStopReason, ProtectTables } from '../../../../vendor/protect-722fae8/packages/background/src/protect/services';
import { ProtectTabModel, siteOfHost } from '../../../../vendor/protect-722fae8/packages/background/src/protect/tab-model';
import { createAttributionService } from '../../../../vendor/protect-722fae8/packages/background/src/protect/attribution/index';
import { createFirewallService } from '../../../../vendor/protect-722fae8/packages/background/src/protect/firewall/index';
import { createGpcService } from '../../../../vendor/protect-722fae8/packages/background/src/protect/gpc/index';
import { createHistoryService } from '../../../../vendor/protect-722fae8/packages/background/src/protect/history/index';
import { createReplayService } from '../../../../vendor/protect-722fae8/packages/background/src/protect/replay/index';
import { INACTIVE_REQUEST_TYPES, createRequestsService, emptyRequestsResponse, handleInactiveRequests } from '../../../../vendor/protect-722fae8/packages/background/src/protect/requests/index';
import { createValueMatchService } from '../../../../vendor/protect-722fae8/packages/background/src/protect/value-match/index';

/** Managed policy (managed_schema.json): any delivered value except `false` disables the module (fail-closed). */
export const PROTECT_MANAGED_POLICY = 'ProtectModuleDisabled';
/** Degraded reason when the activation (registrations, listeners, lanes) failed and was rolled back. */
export const ACTIVATION_FAILED_REASON: ProtectLimitation = 'outcome-not-observed';
const MAX_HELLO_DOCS = 256;
/** Page messages wait for the startup activation at most this long. */
const READY_WAIT_MS = 3000;
/**
 * Review COV-01 / COV-02: document limitations that mean the module covered the page only partly (fields not read in
 * the document with a payment field, fingerprints lost by a SW restart, module memory over its budget). With one of
 * them, or any dropped count, an `active` page is reported `partial`, next to the conclusion (REQ-006).
 */
const PARTIAL_LIMITATIONS: ReadonlySet<ProtectLimitation> = new Set<ProtectLimitation>(['values-suspended-payment', 'values-reset', 'budget-exceeded']);

export interface ProtectControllerOptions {
  clock?: Clock;
  /** Host access check for webRequest events (runtime: scope.isHostGrantedSync). Default: the broad grant. */
  hostGranted?: (host: string, scheme: 'http' | 'https') => boolean;
  /** Storage port factory (tests: MemoryProtectDb). Default: IndexedDB through idbFactory. */
  dbFactory?: () => ProtectDb;
  /** IndexedDB factory (SW entry: browserIdbFactory from idb.ts, the only owner of indexedDB). */
  idbFactory?: () => IDBFactory | null;
  tables?: ProtectTables;
  /** Test profile: the harness may inject into lanes and replace the managed policy. */
  testProfile?: boolean;
  /** Test profile only: password tripwire bundles first in both registrations (names come from the SW entry). */
  tripwireFiles?: ProtectTripwireFiles;
  /** Lane services (tests); default: the seven lane modules. */
  services?: readonly ProtectFeatureService[];
  /** Perf-gate decision per MAIN group (S10 PROTECT_HOOK_CONFIG). */
  groupGate?: (group: 'send' | 'listen') => boolean;
  dnrTimeoutMs?: number;
  docStore?: ProtectDocStoreOptions;
}

type Ack = ProtectAck;

const INACTIVE_ACK: Readonly<Ack> = Object.freeze({ schemaVersion: 1, type: 'protect-ack', active: false, groups: 0 });

function protectError(code: UiErrorCode): UiResponse {
  return { schemaVersion: 1, type: 'error', code };
}

function canonicalLimitations(list: Iterable<ProtectLimitation>, max: number): ProtectLimitation[] {
  const set = new Set(list);
  return PROTECT_LIMITATIONS.filter((l) => set.has(l)).slice(0, max);
}

/** Token buckets for module page messages (PROTECT_BUDGETS.protectMessagesPerSecond: document, tab, global). */
class ProtectRateLimiter {
  private readonly docs = new Map<string, { tokens: number; at: number }>();
  private readonly tabs = new Map<number, { tokens: number; at: number }>();
  private readonly global = { tokens: PROTECT_BUDGETS.protectMessagesPerSecond.global, at: 0 };

  private static refill(b: { tokens: number; at: number }, capacity: number, now: number): void {
    if (now > b.at) {
      b.tokens = Math.min(capacity, b.tokens + ((now - b.at) / 1000) * capacity);
      b.at = now;
    }
  }

  private bucket<K>(map: Map<K, { tokens: number; at: number }>, key: K, capacity: number, now: number): { tokens: number; at: number } {
    let b = map.get(key);
    if (b === undefined) {
      if (map.size >= 1024) {
        const first = map.keys().next();
        if (!first.done) map.delete(first.value);
      }
      b = { tokens: capacity, at: now };
      map.set(key, b);
    } else ProtectRateLimiter.refill(b, capacity, now);
    return b;
  }

  tryConsume(documentKey: string, tabId: number, now: number): boolean {
    const rate = PROTECT_BUDGETS.protectMessagesPerSecond;
    const d = this.bucket(this.docs, documentKey, rate.document, now);
    const t = this.bucket(this.tabs, tabId, rate.tab, now);
    ProtectRateLimiter.refill(this.global, rate.global, now);
    if (d.tokens < 1 || t.tokens < 1 || this.global.tokens < 1) return false;
    d.tokens -= 1;
    t.tokens -= 1;
    this.global.tokens -= 1;
    return true;
  }

  clear(): void {
    this.docs.clear();
    this.tabs.clear();
  }
}

interface HelloDoc {
  tabId: number;
  frameId: number;
  documentId: string;
  site: string | null;
  /** Top-level site of the tab when the document said hello (browser-trusted; review r2). */
  topSite: string | null;
}

export class ProtectController {
  readonly docStore: ProtectDocStore;
  readonly tabModel: ProtectTabModel;
  readonly eventBus = new ProtectEventBus();
  readonly netHub: NetHub;
  readonly outcomes: OutcomeTracker;
  readonly dnrPort: DnrPort;
  readonly registration: ProtectRegistration;

  private readonly api: BackgroundChromeApi;
  private readonly clock: Clock;
  private readonly testProfile: boolean;
  private readonly tables: ProtectTables;
  private readonly services: readonly ProtectFeatureService[];
  private readonly running = new Set<ProtectServiceName>();
  private readonly limiter = new ProtectRateLimiter();
  private readonly helloDocs = new Map<string, HelloDoc>();
  private readonly ports: ProtectPorts;
  private readonly dbFactory: () => ProtectDb;
  private readonly hostGrantedOption: ((host: string, scheme: 'http' | 'https') => boolean) | undefined;

  private settings: ProtectSettings = { ...DEFAULT_PROTECT_SETTINGS, features: [] };
  private settingsPresent = false;
  private org = { disabled: false, invalid: false };
  private orgOverride: { items: Record<string, unknown> } | null = null;
  private perms: ProtectPermissions = { broadHosts: false, dnr: false };
  private readonly degraded = new Set<ProtectLimitation>();
  private active = false;
  private chain: Promise<unknown> = Promise.resolve();
  private excluded = new Set<string>();
  private dbInstance: ProtectDb | null = null;
  private counts = { decisions: 0, history: 0 };
  private readonly ready: Promise<void>;
  private resolveReady: () => void = () => undefined;
  private isReady = false;
  private stats = { pageMessages: 0, throttled: 0, rejected: 0, serviceFailures: 0, activations: 0, rollbacks: 0, mainReordered: 0 };

  constructor(api: BackgroundChromeApi, options: ProtectControllerOptions = {}) {
    this.api = api;
    this.clock = options.clock ?? systemClock;
    this.testProfile = options.testProfile === true;
    this.tables = options.tables ?? EMPTY_PROTECT_TABLES;
    this.hostGrantedOption = options.hostGranted;
    const idbFactory = options.idbFactory ?? browserIdbFactory;
    this.dbFactory = options.dbFactory ?? (() => new IdbProtectDb(idbFactory, this.clock));
    this.tabModel = new ProtectTabModel(this.clock, () => {
      if (this.settings.enabled) this.docStore.setTabs(this.tabModel.entries());
    }, (entry) => this.isExcluded(entry.site));
    this.docStore = new ProtectDocStore(api.storage.session, this.clock, (key) => this.isTopDocument(key), options.docStore ?? {});
    this.dnrPort = new DnrPort(api, {
      get: (range) => this.docStore.runtime().dnr[range] ?? null,
      set: (range, hash) => this.docStore.updateRuntime((cur) => {
        const dnr = { ...cur.dnr };
        if (hash === null) delete dnr[range];
        else dnr[range] = hash;
        return { ...cur, dnr };
      }),
    }, options.dnrTimeoutMs);
    this.ports = { firewallEvaluate: noFirewallEvaluate, attribution: null, pendingCount: () => 0 };
    this.outcomes = new OutcomeTracker(this.clock, (event) => this.onOutcomeEvent(event), () => this.ports.firewallEvaluate);
    this.netHub = new NetHub(api, this.clock, this.tabModel, (host, scheme) => this.hostGranted(host, scheme), {
      onRequest: (details, request) => this.dispatchRequest('onRequest', details, request),
      onSendHeaders: (details, request) => {
        this.outcomes.onSendHeaders(details);
        this.dispatchRequest('onSendHeaders', details, request);
      },
      onErrorOccurred: (details) => this.outcomes.onErrorOccurred(details),
      onCompleted: (details) => this.outcomes.onCompleted(details),
      onArmEvicted: (tabId) => {
        const key = this.tabModel.topDocumentKey(tabId);
        if (key !== null) this.docStore.addLimitations(key, tabId, ['budget-exceeded']);
      },
    });
    this.registration = new ProtectRegistration(api, { tripwireFiles: options.tripwireFiles, groupGate: options.groupGate });
    this.services = options.services ?? [
      createValueMatchService(),
      createFirewallService(),
      createAttributionService(),
      createReplayService(),
      createHistoryService(),
      createGpcService(),
      createRequestsService(),
    ];
    this.ready = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });
    this.eventBus.subscribe(null, (event) => {
      for (const s of this.runningServices()) this.guard(() => s.onEvent?.(event));
    });
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  private markReady(): void {
    if (this.isReady) return;
    this.isReady = true;
    this.resolveReady();
  }

  private async waitReady(): Promise<void> {
    if (this.isReady) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([this.ready, new Promise<void>((resolve) => { timer = setTimeout(resolve, READY_WAIT_MS); })]);
    clearTimeout(timer);
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const next = this.chain.then(task, task);
    this.chain = next.catch(() => undefined);
    return next;
  }

  /** The broad grant covers every http(s) host; otherwise the runtime's scope grants decide (target AND initiator). */
  private hostGranted(host: string, scheme: 'http' | 'https'): boolean {
    if (this.perms.broadHosts) return true;
    return this.hostGrantedOption !== undefined && this.hostGrantedOption(host, scheme);
  }

  private isTopDocument(key: string): boolean {
    const colon = key.indexOf(':');
    if (colon <= 0) return false;
    return this.tabModel.topDocumentKey(Number(key.slice(0, colon))) === key;
  }

  /**
   * Review W3: observation registered detector-main-v1 afresh (scope change, SW start). While the module is active our
   * MAIN registration goes after it again (SP-7: registration order = execution order), so observation's bootstrap
   * still finds the native window.addEventListener. A no-op while the module is off (observation unchanged).
   */
  onObservationMainRegistered(): Promise<void> {
    if (!this.active) return Promise.resolve();
    return this.serialize(async () => {
      if (!this.active) return;
      try {
        if (await this.registration.reregisterMain({ features: this.settings.features, excludedSites: [...this.excluded] })) this.stats.mainReordered++;
      } catch {
        // Best effort: the next observation registration or module reconcile tries again.
        this.stats.serviceFailures++;
      }
    });
  }

  /** True while the module runs (listeners, registrations and lanes are live). */
  get isActive(): boolean {
    return this.active;
  }

  get enabled(): boolean {
    return this.settings.enabled;
  }

  private consentRequired(): boolean {
    return this.settings.consentVersion !== PROTECT_CONSENT_VERSION;
  }

  private enforcementDegraded(): EnforcementDegraded | null {
    return needsDnr(this.settings.features) ? this.dnrPort.degraded : null;
  }

  private degradedReasons(): ProtectLimitation[] {
    const reasons = new Set(this.degraded);
    if (this.enforcementDegraded() !== null) reasons.add('blocking-unavailable');
    // S08 (foundation follow-up): our rules could not be removed (SP-5 / SP-1) — also after a disable or a purge, so
    // the UI never says «правила блокировки удалены» then.
    if (this.dnrPort.degraded === 'cleanup-pending') reasons.add('blocking-unavailable');
    return canonicalLimitations(reasons, PROTECT_WIRE_LIMITS.maxDegradedReasons);
  }

  private effective(): EffectiveProtectState {
    const enforcementDegraded = this.enforcementDegraded();
    return effectiveProtectState({
      settings: this.settings,
      consentRequired: this.consentRequired(),
      orgDisabled: this.org.disabled,
      broadHosts: this.perms.broadHosts,
      dnr: this.perms.dnr,
      degraded: this.degradedReasons().length > 0,
      enforcementDegraded: enforcementDegraded !== null,
    });
  }

  private snoozedUntil(): number | null {
    const until = this.settings.snoozeUntil;
    return until !== null && until > this.clock.now() ? until : null;
  }

  getState(): ProtectState {
    const eff = this.effective();
    return {
      state: eff.state,
      consentVersion: this.settings.consentVersion,
      requiredConsentVersion: PROTECT_CONSENT_VERSION,
      features: [...this.settings.features],
      preset: this.settings.preset,
      snoozedUntil: this.snoozedUntil(),
      excludedSites: [...this.excluded].sort(),
      historyRetentionDays: this.settings.historyRetentionDays,
      history: this.settings.features.includes('history') ? { records: this.counts.history, truncated: false } : null,
      decisions: this.counts.decisions,
      permissions: { ...this.perms },
      organizationDisabled: this.org.disabled,
      organizationPolicyInvalid: this.org.invalid,
      degradedReasons: this.degradedReasons(),
    };
  }

  // ---------------------------------------------------------------------------
  // Settings and policy
  // ---------------------------------------------------------------------------

  private async readSettings(): Promise<void> {
    let raw: unknown;
    try {
      raw = (await this.api.storage.local.get(PROTECT_SETTINGS_KEY))[PROTECT_SETTINGS_KEY];
    } catch {
      raw = undefined;
    }
    this.settingsPresent = raw !== undefined;
    this.settings = parseProtectSettings(raw, this.clock.now());
  }

  /** Managed ProtectModuleDisabled: absent or `false` → allowed; anything else → disabled (invalid when not boolean). */
  private async readManaged(): Promise<void> {
    let items: Record<string, unknown> | null;
    if (this.orgOverride !== null) items = this.orgOverride.items;
    else {
      const managed = this.api.storage.managed;
      if (managed === undefined) items = {};
      else {
        try {
          items = await managed.get(PROTECT_MANAGED_POLICY);
        } catch {
          items = null; // unreadable: keep the last known state (candidate: managed storage errors are rare)
        }
      }
    }
    if (items === null) return;
    const value = Object.prototype.hasOwnProperty.call(items, PROTECT_MANAGED_POLICY) ? items[PROTECT_MANAGED_POLICY] : undefined;
    this.org = { disabled: value !== undefined && value !== false, invalid: value !== undefined && typeof value !== 'boolean' };
  }

  private async persistSettings(): Promise<boolean> {
    try {
      await this.api.storage.local.set({ [PROTECT_SETTINGS_KEY]: { ...this.settings, features: [...this.settings.features] } });
      this.settingsPresent = true;
      return true;
    } catch {
      return false;
    }
  }

  /** Test profile only (DevTools harness): replaces the managed items; undefined restores storage.managed. */
  async setManagedOverrideForTest(items: unknown): Promise<ProtectState> {
    if (!this.testProfile) throw new Error('protect-managed-override-disabled');
    this.orgOverride = items === undefined ? null : { items: typeof items === 'object' && items !== null ? (items as Record<string, unknown>) : { [PROTECT_MANAGED_POLICY]: items } };
    await this.onManagedChanged();
    return this.getState();
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * SW start: settings and policy. Off → nothing else (no IndexedDB, listeners, DNR or writes) except an orphan check
   * of our registrations (a read of our ids; review W5: also without a settings record, so registrations left by a
   * failed unregister before a purge go at the next start). On → activation (registrations and lanes again, SP-7).
   */
  load(): Promise<void> {
    return this.serialize(async () => {
      try {
        await this.readSettings();
        await this.readManaged();
        if (!this.settings.enabled) {
          await this.cleanupOrphanRegistrations();
          return;
        }
        await this.reconcileState('startup');
      } finally {
        this.markReady();
      }
    });
  }

  private async cleanupOrphanRegistrations(): Promise<void> {
    try {
      await this.registration.unregisterAll();
    } catch {
      // Best effort: the next start checks again.
    }
  }

  private db(): ProtectDb {
    if (this.dbInstance === null) this.dbInstance = this.dbFactory();
    return this.dbInstance;
  }

  /** Brings the module to what settings, policy and permissions allow (inside the mutation chain). */
  private async reconcileState(trigger: 'startup' | 'enable' | 'settings' | 'permissions' | 'managed'): Promise<void> {
    this.perms = await readProtectPermissions(this.api);
    const eff = this.effective();
    const allowed = this.settings.enabled && eff.state !== 'organization-disabled' && eff.state !== 'off' && eff.state !== 'needs-consent' && eff.state !== 'needs-permission';
    if (!allowed) {
      if (this.active || trigger === 'startup') await this.suspend(this.settings.enabled ? 'suspended' : 'module-off');
      this.markReady();
      return;
    }
    await this.activate();
  }

  private serviceContext(): ProtectServiceContext {
    const db = this.dbInstance !== null && this.dbInstance.status === 'open' ? this.dbInstance : null;
    return {
      db,
      docStore: this.docStore,
      tabModel: this.tabModel,
      eventBus: this.eventBus,
      dnrPort: this.dnrPort,
      netHub: this.netHub,
      outcomes: this.outcomes,
      clock: this.clock,
      tables: this.tables,
      ports: this.ports,
      testProfile: this.testProfile,
      settings: () => this.settings,
      isExcluded: (site) => this.isExcluded(site),
      isTabExcluded: (tabId) => this.isTabExcluded(tabId),
      excludedSites: () => [...this.excluded].sort(),
      sendControl: (documentKey, command) => this.sendControl(documentKey, command),
    };
  }

  private async activate(): Promise<void> {
    const wasActive = this.active;
    // 6. IndexedDB (a failure degrades the module; value matching still works without it).
    const db = this.db();
    if (await db.open()) {
      this.degraded.delete('storage-unavailable');
      await this.loadExclusions();
    } else this.degraded.add('storage-unavailable');
    if (!this.docStore.hydrated) {
      const { tabs } = await this.docStore.hydrate();
      if (this.tabModel.size === 0) this.tabModel.load(tabs);
    }
    try {
      // 7. Registrations (our ids only).
      await this.registration.reconcile({ features: this.settings.features, excludedSites: [...this.excluded] });
      // 8. Listeners.
      this.active = true;
      this.netHub.refresh(true, this.settings.features);
      // 9. Lanes.
      await this.syncServices();
      this.degraded.delete(ACTIVATION_FAILED_REASON);
    } catch {
      this.stats.rollbacks++;
      await this.suspend('suspended');
      this.degraded.add(ACTIVATION_FAILED_REASON);
      this.markReady();
      return;
    }
    if (!wasActive) {
      this.stats.activations++;
      if (this.docStore.runtime().activeSince === undefined) this.docStore.updateRuntime((cur) => ({ ...cur, activeSince: this.clock.now() }));
    }
    this.markReady();
    // 10. DNR: orphans in the ranges of disabled features (lanes own the ranges of their features).
    if (this.perms.dnr) await this.dnrPort.reconcile(this.settings.features);
    await this.refreshCounts();
  }

  private runningServices(): ProtectFeatureService[] {
    return this.services.filter((s) => this.running.has(s.name));
  }

  /** Starts lanes whose features are on, stops the others ('feature-off'). Throws when a start fails. */
  private async syncServices(): Promise<void> {
    const ctx = this.serviceContext();
    for (const s of this.services) {
      const want = serviceEnabled(s, this.settings.features);
      if (want && !this.running.has(s.name)) {
        await s.start(ctx);
        this.running.add(s.name);
      } else if (!want && this.running.has(s.name)) {
        this.running.delete(s.name);
        await this.guardAsync(() => s.stop('feature-off'));
      }
    }
  }

  /** Steps 1–5 of a stop: lanes, listeners, our DNR rules, our registrations, protect-control stop. Data stays. */
  private async suspend(reason: ProtectStopReason): Promise<void> {
    this.active = false;
    // 1. Page messages are refused from now on; lane memory goes.
    for (const s of this.runningServices()) await this.guardAsync(() => s.stop(reason));
    this.running.clear();
    this.outcomes.clear();
    this.limiter.clear();
    this.ports.firewallEvaluate = noFirewallEvaluate;
    this.ports.attribution = null;
    this.ports.pendingCount = () => 0;
    // 2. Listeners.
    this.netHub.refresh(false, []);
    // 3. Our DNR rules (SP-5: before the Options page removes the permission).
    await this.dnrPort.removeAllOurs();
    // 4. Our registrations.
    await this.cleanupOrphanRegistrations();
    // 5. Documents with an active module part stop it.
    for (const [key] of this.helloDocs) this.sendControl(key, 'stop');
    this.helloDocs.clear();
    if (this.docStore.hydrated && this.docStore.runtime().activeSince !== undefined) {
      this.docStore.updateRuntime((cur) => {
        const next = { ...cur };
        delete next.activeSince;
        return next;
      });
    }
  }

  private async loadExclusions(): Promise<void> {
    const sites = new Set<string>();
    try {
      await this.db().iterate<{ site?: unknown }>('exclusions', { chunk: PROTECT_BUDGETS.maxExcludedSites }, (records) => {
        for (const r of records) if (isSiteName(r.site) && sites.size < PROTECT_BUDGETS.maxExcludedSites) sites.add(r.site);
        return sites.size < PROTECT_BUDGETS.maxExcludedSites;
      });
      this.excluded = sites;
    } catch {
      this.degraded.add('storage-unavailable');
    }
  }

  private async refreshCounts(): Promise<void> {
    const db = this.dbInstance;
    if (db === null || db.status !== 'open') return;
    try {
      this.counts.decisions = await db.count('decisions');
      this.counts.history = this.settings.features.includes('history') ? await db.count('sightings') : 0;
    } catch {
      // Counts are informational; storage errors surface through the degraded state.
    }
  }

  // ---------------------------------------------------------------------------
  // UI channel
  // ---------------------------------------------------------------------------

  private stateResponse(): UiResponse {
    return { schemaVersion: 1, type: 'protect-state', state: this.getState() };
  }

  private inactiveCode(): UiErrorCode {
    switch (this.effective().state) {
      case 'organization-disabled': return 'disabled-by-organization';
      case 'needs-consent': return 'consent-required';
      case 'needs-permission': return 'permission-required';
      default: return 'module-disabled';
    }
  }

  /** One route for the 22 ui-protect-* types (privileged UI channel only; handlers.ts verified the sender). */
  async routeUi(request: ProtectUiRequest, sender: MessageSenderLike): Promise<UiResponse> {
    await this.waitReady();
    const runtimeId = this.api.runtime.id;
    switch (request.type) {
      case 'ui-protect-get-state':
        return this.serialize(async () => {
          if (this.settings.enabled) {
            this.perms = await readProtectPermissions(this.api);
            await this.refreshCounts();
          }
          return this.stateResponse();
        });
      case 'ui-protect-enable':
        if (!isFirewallLauncherSender(sender, runtimeId)) return protectError('unauthorized-sender');
        return this.enable(request.consentVersion, request.features, request.preset, !isOptionsSender(sender, runtimeId));
      case 'ui-protect-disable':
        return this.disable(request.purge);
      case 'ui-protect-set-settings':
        if (!isOptionsSender(sender, runtimeId)) return protectError('unauthorized-sender');
        return this.setSettings(request.features, request.preset, request.historyRetentionDays);
      case 'ui-protect-snooze':
        return this.snooze(request.minutes);
      case 'ui-protect-set-site':
        if (!request.excluded && !isOptionsSender(sender, runtimeId)) return protectError('unauthorized-sender');
        return this.setSite(request.host, request.excluded);
      case 'ui-protect-purge':
        return this.purge(request.what, request, sender);
      case 'ui-protect-get-report': {
        const report = this.getReport(request.tabId, request.frameId);
        return { schemaVersion: 1, type: 'protect-report', report };
      }
      default:
        return this.routeLane(request, sender);
    }
  }

  private async routeLane(request: ProtectUiRequest, sender: MessageSenderLike): Promise<UiResponse> {
    const lane = PROTECT_LANE_ROUTES[request.type];
    if (lane === undefined) return protectError('invalid-request');
    if (!this.active) {
      // S14 (ADR-020 §I): the user's own journal of data requests stays viewable, deletable and exportable while the
      // module is not active; drafts, saves and status changes need the active module.
      if (lane === 'requests' && INACTIVE_REQUEST_TYPES.has(request.type)) return this.serialize(() => this.inactiveRequests(request, sender));
      return protectError(this.inactiveCode());
    }
    const service = this.services.find((s) => s.name === lane);
    if (service === undefined || !this.running.has(lane)) return protectError('feature-disabled');
    if (service.handleUi === undefined) return protectError('not-implemented');
    try {
      return (await service.handleUi(request.type, request, sender)) ?? protectError('not-implemented');
    } catch {
      this.stats.serviceFailures++;
      return protectError('invalid-request');
    }
  }

  /**
   * S14: journal requests while the module is not active. Never creates the database (no settings record, or the
   * browser does not report the database → an empty journal / not-found) and closes it afterwards.
   */
  private async inactiveRequests(request: ProtectUiRequest, sender: MessageSenderLike): Promise<UiResponse> {
    if (this.active) return this.routeLane(request, sender);
    if (!this.settingsPresent) return protectError('module-disabled');
    const db = this.db();
    try {
      if (db.status !== 'open' && (await db.exists()) !== true) {
        return request.type === 'ui-protect-requests-get' ? emptyRequestsResponse(request.view) : protectError('not-found');
      }
      return await handleInactiveRequests(db, this.clock, request);
    } finally {
      if (!this.active) db.close();
    }
  }

  private enable(consentVersion: number, features: readonly ProtectFeature[], preset: ProtectPreset, launcher = false): Promise<UiResponse> {
    return this.serialize(async () => {
      await this.readManaged();
      if (this.org.disabled) return protectError('disabled-by-organization');
      if (consentVersion !== PROTECT_CONSENT_VERSION) return protectError('consent-required');
      // A consented launcher resumes the current choices atomically; a stale UI cannot overwrite Options edits.
      const resume = launcher && !this.consentRequired() && this.settings.features.length > 0;
      const list = canonicalFeatures(resume ? this.settings.features : features);
      const selectedPreset = resume ? this.settings.preset : preset;
      if (list === null || list.length === 0) return protectError('invalid-request');
      this.perms = await readProtectPermissions(this.api);
      if (!this.perms.broadHosts || (needsDnr(list) && !this.perms.dnr)) return protectError('permission-required');
      const before = this.settings;
      this.settings = { ...this.settings, v: 1, enabled: true, consentVersion, features: list, preset: selectedPreset, snoozeUntil: null };
      if (!(await this.persistSettings())) {
        this.settings = before;
        return protectError('storage-unavailable');
      }
      await this.reconcileState('enable');
      return this.stateResponse();
    });
  }

  private disable(purge: boolean): Promise<UiResponse> {
    return this.serialize(async () => {
      const saved = await this.disableNow(purge);
      return saved ? this.stateResponse() : protectError('storage-unavailable');
    });
  }

  private async disableNow(purge: boolean): Promise<boolean> {
    if (this.settings.enabled || this.active) await this.suspend('module-off');
    this.settings = { ...this.settings, enabled: false };
    if (!this.settingsPresent && !purge) return true;
    // One bounded retry preserves the same consent and choices. Failed persistence never reactivates this SW.
    // REQ-012 / PP-03: persist OFF before purge so a failed removal cannot retain a durable ON record.
    const saved = !this.settingsPresent || await this.persistSettings() || await this.persistSettings();
    if (!saved) this.degraded.add('storage-unavailable');
    if (purge) return this.purgeEverything();
    // Session data of the module goes with the module (the index names the documents); IndexedDB stays until purge.
    await this.clearSessionState();
    this.tabModel.clear();
    this.dbInstance?.close();
    this.degraded.delete(ACTIVATION_FAILED_REASON);
    return saved;
  }

  private async clearSessionState(): Promise<boolean> {
    let cleared = true;
    try {
      if (!this.docStore.hydrated) await this.docStore.hydrate();
      await this.docStore.clearAll();
    } catch {
      // storage.session is cleared by the browser at the end of the session anyway.
      cleared = false;
    }
    this.tabModel.clear();
    return cleared;
  }

  /** Purge: IndexedDB deleted, protect-* session keys and storage.local['protect'] removed (DNR rules already gone). */
  private async purgeEverything(): Promise<boolean> {
    let cleared = true;
    try {
      await this.db().destroy();
    } catch {
      cleared = false;
    }
    if (!(await this.clearSessionState())) cleared = false;
    if (!cleared) {
      this.degraded.add('storage-unavailable');
      this.dbInstance?.close();
      return false;
    }
    try {
      await this.api.storage.local.remove(PROTECT_SETTINGS_KEY);
    } catch {
      this.degraded.add('storage-unavailable');
      return false;
    }
    this.settings = { ...DEFAULT_PROTECT_SETTINGS, features: [] };
    this.settingsPresent = false;
    this.excluded = new Set();
    this.counts = { decisions: 0, history: 0 };
    this.degraded.clear();
    return true;
  }

  private setSettings(features: readonly ProtectFeature[] | undefined, preset: ProtectPreset | undefined, retention: HistoryRetentionDays | undefined): Promise<UiResponse> {
    return this.serialize(async () => {
      if (!this.settings.enabled) return protectError('module-disabled');
      await this.readManaged();
      if (this.org.disabled) return protectError('disabled-by-organization');
      const list = features === undefined ? this.settings.features : canonicalFeatures(features);
      if (list === null || list.length === 0) return protectError('invalid-request');
      this.perms = await readProtectPermissions(this.api);
      const added = list.filter((f) => !this.settings.features.includes(f));
      if (needsDnr(added) && !this.perms.dnr) return protectError('permission-required');
      const before = this.settings;
      this.settings = { ...this.settings, features: list, ...(preset === undefined ? {} : { preset }), ...(retention === undefined ? {} : { historyRetentionDays: retention }) };
      if (!(await this.persistSettings())) {
        this.settings = before;
        return protectError('storage-unavailable');
      }
      await this.reconcileState('settings');
      return this.stateResponse();
    });
  }

  private snooze(minutes: 0 | 60): Promise<UiResponse> {
    return this.serialize(async () => {
      if (!this.settings.enabled) return protectError('module-disabled');
      const until = minutes === 0 ? null : this.clock.now() + Math.min(PROTECT_BUDGETS.snoozeMs, minutes * 60_000);
      this.settings = { ...this.settings, snoozeUntil: until };
      if (!(await this.persistSettings())) return protectError('storage-unavailable');
      return this.stateResponse();
    });
  }

  /** Site name of a sanitized host (registrable domain through the PSL; IPv4 / localhost / single label as is). */
  normalizeSite(host: string): string | null {
    if (!isSanitizedHost(host)) return null;
    const site = siteOfHost(host);
    return site !== null && isSiteName(site) ? site : null;
  }

  isExcluded(site: string | null): boolean {
    return site !== null && this.excluded.has(site);
  }

  /** Lanes (review r2): the tab's top-level site is excluded, or unknown to the module (fail closed). */
  isTabExcluded(tabId: number): boolean {
    const site = this.tabModel.get(tabId)?.site ?? null;
    return site === null || this.isExcluded(site);
  }

  private setSite(host: string, excluded: boolean): Promise<UiResponse> {
    return this.serialize(async () => {
      if (!this.settings.enabled) return protectError('module-disabled');
      if (!excluded && this.org.disabled) return protectError('disabled-by-organization');
      const site = this.normalizeSite(host);
      if (site === null) return protectError('invalid-request');
      if (excluded === this.excluded.has(site)) return this.stateResponse();
      if (excluded && this.excluded.size >= PROTECT_BUDGETS.maxExcludedSites) return protectError('limit-reached');
      const db = this.db();
      try {
        if (excluded) await db.put('exclusions', { site });
        else await db.delete('exclusions', site);
      } catch {
        this.degraded.add('storage-unavailable');
        return protectError('storage-unavailable');
      }
      if (excluded) this.excluded.add(site);
      else this.excluded.delete(site);
      if (this.active) {
        try {
          await this.registration.reconcile({ features: this.settings.features, excludedSites: [...this.excluded] });
        } catch {
          this.degraded.add(ACTIVATION_FAILED_REASON);
        }
        if (excluded) {
          // Documents of the site stop their module part now; lanes drop the site's memory through isExcluded().
          for (const [key, doc] of [...this.helloDocs]) {
            if (doc.site === site || doc.topSite === site || this.tabModel.get(doc.tabId)?.site === site) {
              this.sendControl(key, 'stop');
              this.helloDocs.delete(key);
            }
          }
        }
        // S13: lanes whose rules list the excluded sites (GPC) follow the change now.
        const sites = [...this.excluded].sort();
        for (const s of this.runningServices()) if (s.onExclusionsChanged !== undefined) await this.guardAsync(() => s.onExclusionsChanged!(sites));
      } else if (this.dbInstance !== null && !this.active) this.dbInstance.close();
      return this.stateResponse();
    });
  }

  private purge(target: ProtectPurgeTarget, request: ProtectUiRequest, sender: MessageSenderLike): Promise<UiResponse> {
    if (target === 'all') return this.disable(true);
    return this.serialize(async () => {
      // Lanes reset their memory and derived state first (S08: decisions + rules; S12: history; S14: journal).
      const owner: ProtectServiceName = target === 'decisions' ? 'firewall' : target === 'history' ? 'history' : 'requests';
      const service = this.services.find((s) => s.name === owner);
      if (this.active && service !== undefined && this.running.has(owner) && service.handleUi !== undefined) {
        await this.guardAsync(() => service.handleUi!('ui-protect-purge', request, sender));
      }
      const db = this.db();
      const wasOpen = db.status === 'open';
      // S15 (foundation follow-up): `exists()` is null when indexedDB.databases() is missing; treat it as "does not
      // exist" so a purge never creates the database just to clear it.
      if (!wasOpen && (await db.exists()) !== true) return this.stateResponse();
      try {
        if (target === 'decisions') {
          await db.clear('decisions');
          await db.deleteWhere('meta', null, prefixRange('firewall'));
        } else if (target === 'history') {
          await db.clear('sightings');
          await db.clear('receivers');
          await db.clear('sites');
          await db.deleteWhere('meta', null, prefixRange('history'));
        } else {
          await db.clear('requests');
          await db.deleteWhere('meta', null, prefixRange('request'));
        }
      } catch {
        this.degraded.add('storage-unavailable');
        return protectError('storage-unavailable');
      }
      if (target === 'decisions' && this.dnrPort.available()) {
        for (const range of ['decisions', 'preset', 'session'] as const) await this.dnrPort.clearRange(range);
      }
      if (!this.active) db.close();
      await this.refreshCounts();
      if (target === 'decisions') this.counts.decisions = 0;
      if (target === 'history') this.counts.history = 0;
      return this.stateResponse();
    });
  }

  // ---------------------------------------------------------------------------
  // Report projection (SW -> UI)
  // ---------------------------------------------------------------------------

  private coverage(tabId: number, doc: Readonly<ProtectDocState> | undefined, eff: EffectiveProtectState): { state: CoverageState; limitations: ProtectLimitation[] } {
    const limitations: ProtectLimitation[] = [];
    if (!this.perms.broadHosts) return { state: 'no-access', limitations };
    const entry = this.tabModel.get(tabId);
    if (this.isExcluded(entry?.site ?? null)) return { state: 'paused', limitations: ['site-excluded'] };
    if (eff.state === 'degraded') return { state: 'degraded', limitations };
    const since = this.docStore.runtime().activeSince;
    const loadedBefore = entry === undefined || since === undefined || entry.committedAt < since;
    if (loadedBefore) return { state: 'late-start', limitations: ['late-start', 'loaded-before-enable'] };
    if (doc?.startedLate === true) return { state: 'late-start', limitations: ['late-start'] };
    return { state: 'active', limitations };
  }

  /** ProtectProjection of the tab's top-level document; null when the module is off or the tab is unknown. */
  getReport(tabId: number, _frameId?: number): ProtectProjection | null {
    if (!this.settings.enabled) return null;
    const key = this.tabModel.topDocumentKey(tabId);
    if (key === null) return null;
    const doc = this.docStore.doc(key);
    const eff = this.effective();
    const coverage = this.active ? this.coverage(tabId, doc, eff) : { state: (this.perms.broadHosts ? 'paused' : 'no-access') as CoverageState, limitations: [] as ProtectLimitation[] };
    let previous = 0;
    for (const [k, d] of this.docStore.docsOfTab(tabId)) if (k !== key) previous = Math.min(MAX_COUNT, previous + d.evidence.length);
    const degradedCode = eff.enforcement === 'degraded' ? this.enforcementDegraded() : null;
    const firewall: FirewallTabView = {
      enforcement: eff.enforcement,
      ...(degradedCode === null ? {} : { degradedCode }),
      preset: this.settings.preset,
      topDomainsSupported: this.dnrPort.features().topDomains,
      stoppedToday: { count: 0, countQuality: 'lower-bound' },
      snoozedUntil: this.snoozedUntil(),
      prompt: this.snoozedUntil() === null ? (doc?.firewall.prompt ?? null) : null,
      receivers: (doc?.firewall.receivers ?? []).slice(0, PROTECT_WIRE_LIMITS.maxFirewallReceivers),
      notices: (doc?.firewall.notices ?? []).slice(0, PROTECT_BUDGETS.maxNoticesPerTab),
      onceRules: [],
    };
    let projection: ProtectProjection = {
      protectRevision: doc?.protectRevision ?? 0,
      documentKey: key,
      site: this.tabModel.get(tabId)?.site ?? null,
      moduleState: eff.state,
      features: [...this.settings.features],
      coverageState: coverage.state,
      limitations: canonicalLimitations([...(doc?.limitations ?? []), ...coverage.limitations], PROTECT_WIRE_LIMITS.maxProjectionLimitations),
      evidence: [...(doc?.evidence ?? [])].slice(0, PROTECT_BUDGETS.maxEvidencePerDocument),
      previousDocumentEvidence: previous,
      firewall,
      replay: doc?.replay ?? null,
      gpc: doc?.gpc ?? null,
      dropped: { ...(doc?.dropped ?? { evidence: 0, fingerprints: 0, bodies: 0, events: 0 }) },
    };
    for (const s of this.runningServices()) {
      if (s.contributeReport === undefined) continue;
      try {
        projection = s.contributeReport(tabId, projection) ?? projection;
      } catch {
        this.stats.serviceFailures++;
      }
    }
    const d = projection.dropped;
    const dropped = d.evidence > 0 || d.fingerprints > 0 || d.bodies > 0 || d.events > 0;
    if (projection.coverageState === 'active' && (dropped || projection.limitations.some((l) => PARTIAL_LIMITATIONS.has(l)))) projection = { ...projection, coverageState: 'partial' };
    return projection;
  }

  /** Firewall prompts waiting in a tab (badge, S09); 0 while off or snoozed. */
  pendingCount(tabId: number): number {
    if (!this.active || this.snoozedUntil() !== null) return 0;
    try {
      const n = this.ports.pendingCount(tabId);
      return Number.isSafeInteger(n) && n > 0 ? n : 0;
    } catch {
      return 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Page channel (protect.js; ids from MessageSender only)
  // ---------------------------------------------------------------------------

  /**
   * `tabTop`: top-level document of the sender's tab from MessageSender.tab.url (handlers.ts, readSenderTabTop); null
   * when the browser gave none.
   */
  async onPageMessage(sender: PageSenderContext, message: unknown, tabTop: SenderTabTop | null = null): Promise<Ack> {
    await this.waitReady();
    if (!this.active) return INACTIVE_ACK;
    this.stats.pageMessages++;
    const valid = validateProtectPageMessage(message);
    if (!valid.ok) {
      this.stats.rejected++;
      return INACTIVE_ACK;
    }
    // Admission before the rate limit (cheap): origin grant (the module needs every site) and exclusions of the
    // frame's and the tab's site. A throttled answer never bypasses them.
    const scheme = sender.originPattern?.startsWith('https:') === true ? 'https' : 'http';
    if (sender.host === null || sender.originPattern === null || !this.perms.broadHosts || !this.hostGranted(sender.host, scheme)) return INACTIVE_ACK;
    const site = siteOfHost(sender.host);
    // Review r2: the tab's top-level site from browser-trusted sources. Frame 0 is the top itself; another frame takes
    // MessageSender.tab.url, else the tab model (onCommitted). The tab model alone misses tabs loaded before enable
    // and evicted tabs. A prerendered document's tab URL belongs to the page the tab shows, so it is not used there.
    const prerender = sender.documentLifecycle === 'prerender';
    const tabSite = prerender || tabTop === null ? null : siteOfHost(tabTop.host);
    const known = this.tabModel.get(sender.tabId);
    const modelSite = known?.site ?? null;
    const topSite = sender.frameId === 0 ? site : prerender ? null : (tabSite ?? modelSite);
    if (known === undefined && !prerender) {
      if (tabSite !== null) this.tabModel.learnTopSite(sender.tabId, tabSite, tabTop?.scheme ?? null);
      else if (sender.frameId === 0 && site !== null) this.tabModel.learnTopSite(sender.tabId, site, scheme);
    }
    if (this.isExcluded(site) || this.isExcluded(topSite) || this.isExcluded(tabSite) || this.isExcluded(modelSite)) return INACTIVE_ACK;
    // Fail closed: a frame whose tab's top-level site is unknown never starts (it could be an excluded site's tab).
    if (sender.frameId !== 0 && topSite === null) return INACTIVE_ACK;
    const msg = valid.value;
    const now = this.clock.now();
    const groups = protectGroupMask(this.registration.groups(this.settings.features));
    if (!this.limiter.tryConsume(sender.documentKey, sender.tabId, now)) {
      this.stats.throttled++;
      const top = this.tabModel.topDocumentKey(sender.tabId);
      if (top !== null) this.docStore.update(top, sender.tabId, 'dropped', (d) => ({ ...d, events: Math.min(MAX_COUNT, d.events + 1) }));
      // A throttled message is never the first activation of a document: its first hello is answered inactive (the
      // module does not start there; the drop is counted above). Documents already active keep running.
      if (msg.type === 'protect-hello' && !this.helloDocs.has(sender.documentKey)) return INACTIVE_ACK;
      return { schemaVersion: 1, type: 'protect-ack', active: true, groups };
    }
    if (msg.type === 'protect-hello') {
      this.helloDocs.delete(sender.documentKey);
      this.helloDocs.set(sender.documentKey, { tabId: sender.tabId, frameId: sender.frameId, documentId: sender.documentId, site, topSite });
      while (this.helloDocs.size > MAX_HELLO_DOCS) {
        const oldest = this.helloDocs.keys().next();
        if (oldest.done) break;
        this.helloDocs.delete(oldest.value);
      }
      if (msg.startedLate && sender.frameId === 0) this.docStore.update(sender.documentKey, sender.tabId, 'startedLate', () => true);
    }
    let ack: Ack = { schemaVersion: 1, type: 'protect-ack', active: true, groups };
    for (const s of this.runningServices()) {
      if (s.onPageMessage === undefined) continue;
      try {
        const extra = await s.onPageMessage(sender, msg);
        if (extra !== undefined && typeof extra.saltId === 'string' && typeof extra.salt === 'string') ack = { ...ack, saltId: extra.saltId, salt: extra.salt };
      } catch {
        this.stats.serviceFailures++;
      }
    }
    if (!this.active) return INACTIVE_ACK;
    return validateProtectAck(ack).ok ? ack : { schemaVersion: 1, type: 'protect-ack', active: true, groups };
  }

  private sendControl(documentKey: string, command: 'stop' | 'rekey' | 'pause' | 'resume'): void {
    const parts = documentKey.split(':');
    if (parts.length !== 3) return;
    const tabId = Number(parts[0]);
    const frameId = Number(parts[1]);
    const documentId = parts[2]!;
    if (!Number.isSafeInteger(tabId) || tabId < 0 || !Number.isSafeInteger(frameId) || frameId < 0 || documentId.length === 0) return;
    try {
      void this.api.tabs.sendMessage(tabId, { schemaVersion: 1, type: 'protect-control', command }, { frameId, documentId }).catch(() => undefined);
    } catch {
      // No such tab or no listener: the document learns the state from its next ack.
    }
  }

  // ---------------------------------------------------------------------------
  // Browser events (observers.ts / entry); empty calls while the module is off
  // ---------------------------------------------------------------------------

  private guard(fn: () => unknown): void {
    try {
      fn();
    } catch {
      this.stats.serviceFailures++;
    }
  }

  private async guardAsync(fn: () => unknown): Promise<void> {
    try {
      await fn();
    } catch {
      this.stats.serviceFailures++;
    }
  }

  private dispatchRequest(hook: 'onRequest' | 'onSendHeaders', details: RequestDetailsLike, request: ProtectRequestContext): void {
    for (const s of this.runningServices()) {
      const fn = s[hook];
      if (fn !== undefined) this.guard(() => fn.call(s, details, request));
    }
  }

  private onOutcomeEvent(event: OutcomeEvent): void {
    for (const s of this.runningServices()) if (s.onOutcome !== undefined) this.guard(() => s.onOutcome!(event));
    this.eventBus.publish(event);
  }

  onCommitted(details: NavigationDetailsLike): void {
    if (!this.active) return;
    const entry = this.tabModel.noteCommitted(details);
    if (entry === null) return;
    for (const s of this.runningServices()) if (s.onCommitted !== undefined) this.guard(() => s.onCommitted!(details, entry));
    this.docStore.sweep();
    this.outcomes.sweep();
  }

  onTabRemoved(tabId: number): void {
    if (!this.active) return;
    this.tabModel.noteRemoved(tabId);
    this.docStore.forgetTab(tabId);
    this.netHub.disarm(tabId);
    this.outcomes.forgetTab(tabId);
    for (const [key, doc] of [...this.helloDocs]) if (doc.tabId === tabId) this.helloDocs.delete(key);
    for (const s of this.runningServices()) if (s.onTabRemoved !== undefined) this.guard(() => s.onTabRemoved!(tabId));
  }

  onTabReplaced(addedTabId: number, removedTabId: number): void {
    if (!this.active) return;
    this.tabModel.noteReplaced(addedTabId, removedTabId);
    this.docStore.forgetTab(removedTabId);
    this.netHub.disarm(removedTabId);
    for (const s of this.runningServices()) if (s.onTabRemoved !== undefined) this.guard(() => s.onTabRemoved!(removedTabId));
  }

  /** Persisted observation report (runtime, after a successful commit): history source (S12). */
  onReportPersisted(report: Readonly<DocumentReport>, binding: Readonly<FrameBinding> | null, info: PersistedReportInfo): void {
    if (!this.active) return;
    for (const s of this.runningServices()) if (s.onReportPersisted !== undefined) this.guard(() => s.onReportPersisted!(report, binding, info));
  }

  /** Cheap check for the runtime: is any lane interested in persisted reports right now. */
  get wantsReports(): boolean {
    if (!this.active) return false;
    for (const s of this.runningServices()) if (s.onReportPersisted !== undefined) return true;
    return false;
  }

  /** permissions.onAdded: auto-resume when consent is current; SP-11: our listeners are added again. */
  onPermissionsAdded(change?: PermissionsLike): Promise<void> {
    if (!this.settingsPresent && !this.settings.enabled) return Promise.resolve();
    return this.serialize(async () => {
      if (!this.settings.enabled || !concernsProtect(change)) return;
      await this.reconcileState('permissions');
      if (this.active) this.netHub.reregister();
    });
  }

  /** permissions.onRemoved (broad hosts or DNR): steps 1–5 and needs-permission; settings stay. */
  onPermissionsRemoved(change?: PermissionsLike): Promise<void> {
    if (!this.settings.enabled) return Promise.resolve();
    return this.serialize(async () => {
      if (!this.settings.enabled || !concernsProtect(change)) return;
      await this.reconcileState('permissions');
    });
  }

  /** storage.managed.onChanged: ProtectModuleDisabled applies on the fly. */
  onManagedChanged(): Promise<void> {
    return this.serialize(async () => {
      await this.readManaged();
      if (this.settings.enabled) await this.reconcileState('managed');
    });
  }

  /** ui-clear-session: the module's session documents go (only when the module ever stored any). */
  async clearSession(): Promise<void> {
    if (!this.docStore.hydrated) return;
    for (const s of this.runningServices()) if (s.onClearSession !== undefined) this.guard(() => s.onClearSession!());
    await this.docStore.clearDocs();
  }

  /** Timers only (runtime.stop in tests); never a state change. */
  stop(): void {
    this.docStore.stop();
  }

  // ---------------------------------------------------------------------------
  // Diagnostics and the test harness (numbers only)
  // ---------------------------------------------------------------------------

  diagnostics(): Record<string, number> {
    const hub = this.netHub.debug();
    const docs = this.docStore.debug();
    return {
      enabled: this.settings.enabled ? 1 : 0,
      active: this.active ? 1 : 0,
      state: PROTECT_STATE_INDEX[this.effective().state],
      servicesRunning: this.running.size,
      armedTabs: hub.armedTabs.length,
      sharedListeners: hub.sendHeaders ? 1 : 0,
      docs: docs.docs,
      docBytes: docs.bytes,
      pendingOutcomes: this.outcomes.size,
      helloDocs: this.helloDocs.size,
      degradedReasons: this.degradedReasons().length,
      pageMessages: this.stats.pageMessages,
      throttled: this.stats.throttled,
      rejected: this.stats.rejected,
      serviceFailures: this.stats.serviceFailures,
      activations: this.stats.activations,
      rollbacks: this.stats.rollbacks,
      mainReordered: this.stats.mainReordered,
    };
  }

  /** Listeners the module added (harness): armed tab ids and the shared listeners. */
  listeners(): { beforeRequestTabs: number[]; sendHeaders: boolean; requestHeaders: boolean; errorOccurred: boolean; completed: boolean } {
    const hub = this.netHub.debug();
    return { beforeRequestTabs: hub.armedTabs, sendHeaders: hub.sendHeaders, requestHeaders: hub.requestHeaders, errorOccurred: hub.errorOccurred, completed: hub.completed };
  }

  serviceDebug(name: string): Record<string, number | boolean> {
    const s = this.services.find((x) => x.name === name);
    if (s === undefined) throw new Error('protect-unknown-service');
    return { running: this.running.has(s.name), ...(s.debug?.() ?? {}) };
  }

  /** Test profile only: a synthetic input of one lane (the lane validates it). */
  async inject(name: string, payload: unknown): Promise<unknown> {
    if (!this.testProfile) throw new Error('protect-inject-disabled');
    const s = this.services.find((x) => x.name === name);
    if (s === undefined || !this.running.has(s.name) || s.debugInject === undefined) throw new Error('protect-inject-unavailable');
    return s.debugInject(payload);
  }

  /** Ack groups for tests and the harness. */
  groupsMask(): number {
    return protectGroupMask(this.registration.groups(this.settings.features));
  }

  /** Wait for pending mutations (tests). */
  async idle(): Promise<void> {
    await this.chain;
  }
}

const PROTECT_STATE_INDEX: Readonly<Record<ProtectModuleState, number>> = {
  off: 0,
  active: 1,
  'needs-consent': 2,
  'needs-permission': 3,
  'organization-disabled': 4,
  degraded: 5,
};
