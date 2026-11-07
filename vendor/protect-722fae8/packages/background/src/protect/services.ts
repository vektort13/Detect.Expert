// ADR-020 §A (S04): the interface every lane of the module «Защита» implements in the service worker, and the context
// the controller hands to it. The foundation ships no-op services in protect/<lane>/index.ts; each lane replaces its own
// file (value-match S07, firewall S08, attribution S10, replay S11, history S12, gpc S13, requests S14).
// A service runs only while the module is active and one of its features is enabled; every hook is optional and is
// called inside try/catch by the controller (a failing lane never breaks another lane or observation).

import type { DocumentReport, ProtectAck, ProtectFeature, ProtectPageMessage, ProtectProjection, ProtectUiRequest, UiResponse } from '@detect-expert/contracts';
import type { ProtectSettings } from '@detect-expert/engine';
import type { Clock, MessageSenderLike, NavigationDetailsLike, RequestDetailsLike } from '../chrome-api';
import type { FrameBinding } from '../documents';
import type { PageSenderContext } from '../sender';
import type { ProtectDb } from './db-port';
import type { DnrPort } from './dnr-port';
import type { ProtectDocStore } from './doc-store';
import type { ProtectEvent, ProtectEventBus } from './event-bus';
import type { NetHub, ProtectRequestContext } from './net-hub';
import type { FirewallEvaluatePort, OutcomeEvent, OutcomeTracker } from './outcomes';
import type { ProtectTabEntry, ProtectTabModel } from './tab-model';

export const PROTECT_SERVICE_NAMES = ['value-match', 'firewall', 'attribution', 'replay', 'history', 'gpc', 'requests'] as const;
export type ProtectServiceName = (typeof PROTECT_SERVICE_NAMES)[number];

/** Catalog protect-tables of this build (production: empty until REQ-008; test profile: synthetic). JSON data only. */
export interface ProtectTables {
  FIREWALL_PRESET_ENTRIES: readonly unknown[];
  REPLAY_ENTRIES: readonly unknown[];
  PRIVACY_CONTACTS_ENTRIES: readonly unknown[];
}

export const EMPTY_PROTECT_TABLES: ProtectTables = Object.freeze({ FIREWALL_PRESET_ENTRIES: [], REPLAY_ENTRIES: [], PRIVACY_CONTACTS_ENTRIES: [] });

/**
 * Cross-lane ports: a lane registers its implementation in start() and resets it in stop(). The outcome tracker reads
 * `firewallEvaluate` (S08) for `stopped`; replay (S11) reads the attribution port (S10).
 */
export interface ProtectPorts {
  firewallEvaluate: FirewallEvaluatePort;
  /** Script activity of a document (S10 → S11); shape owned by those lanes. */
  attribution: unknown;
  /** Firewall prompts pending in a tab (S08 → badge S09). */
  pendingCount: (tabId: number) => number;
}

export interface ProtectServiceContext {
  /** Null while IndexedDB is unavailable (state `degraded`, `storage-unavailable`). */
  readonly db: ProtectDb | null;
  readonly docStore: ProtectDocStore;
  readonly tabModel: ProtectTabModel;
  readonly eventBus: ProtectEventBus;
  readonly dnrPort: DnrPort;
  readonly netHub: NetHub;
  readonly outcomes: OutcomeTracker;
  readonly clock: Clock;
  readonly tables: ProtectTables;
  readonly ports: ProtectPorts;
  readonly testProfile: boolean;
  /** Current settings (live). */
  settings(): Readonly<ProtectSettings>;
  /** The site (or its registrable parent) is excluded from the module. */
  isExcluded(site: string | null): boolean;
  /**
   * The top-level site of the tab is excluded, or the module does not know it (fail closed; review r2). Lanes decide
   * on a tab's site through this, not through `isExcluded(request.topSite)`: a tab loaded before enable has no topSite
   * until one of its documents sends a page message.
   */
  isTabExcluded(tabId: number): boolean;
  /** S13: the module's excluded sites (site names, sorted); the GPC rule excludes them as initiator and target. */
  excludedSites(): readonly string[];
  /** SW → ISOLATED protect-control to one document (best effort). */
  sendControl(documentKey: string, command: 'stop' | 'rekey' | 'pause' | 'resume'): void;
}

/** Why a service stops: its feature was turned off (lane data may be cleared), the module was turned off, or suspended. */
export type ProtectStopReason = 'feature-off' | 'module-off' | 'suspended';

/** Extra answer fields a lane contributes to protect-ack (value-match: the salt). */
export type ProtectAckContribution = Partial<Pick<ProtectAck, 'saltId' | 'salt'>>;

/** Persisted observation report (S12 history source); binding and pause state come from the runtime. */
export interface PersistedReportInfo {
  paused: boolean;
  /** Binding of another document of the same tab (top-site lookup through parentDocumentId, ≤ 8 steps). */
  bindingOf(tabId: number, documentId: string): Readonly<FrameBinding> | null;
}

export interface ProtectFeatureService {
  readonly name: ProtectServiceName;
  /** Features that run this service; 'module' = whenever the module is active. */
  readonly features: readonly ProtectFeature[] | 'module';
  start(ctx: ProtectServiceContext): void | Promise<void>;
  stop(reason: ProtectStopReason): void | Promise<void>;
  onPageMessage?(sender: PageSenderContext, message: ProtectPageMessage): ProtectAckContribution | void | Promise<ProtectAckContribution | void>;
  /** Armed tabs only (body available). Synchronous: called inside the webRequest callback. */
  onRequest?(details: RequestDetailsLike, request: ProtectRequestContext): void;
  onSendHeaders?(details: RequestDetailsLike, request: ProtectRequestContext): void;
  onOutcome?(event: OutcomeEvent): void;
  onEvent?(event: ProtectEvent): void;
  onTabRemoved?(tabId: number): void;
  /** ui-clear-session (Options): lane memory of documents goes too (fingerprints, rings). */
  onClearSession?(): void;
  onCommitted?(details: NavigationDetailsLike, tab: Readonly<ProtectTabEntry>): void;
  /**
   * S13: the excluded sites changed (ui-protect-set-site, module active); called after the registrations were
   * reconciled, inside the controller's mutation chain. `sites` = excludedSites().
   */
  onExclusionsChanged?(sites: readonly string[]): void | Promise<void>;
  onReportPersisted?(report: Readonly<DocumentReport>, binding: Readonly<FrameBinding> | null, info: PersistedReportInfo): void;
  /** Lane UI requests routed by the controller (module active, feature enabled); undefined = not handled. */
  handleUi?(type: ProtectUiRequest['type'], request: ProtectUiRequest, sender: MessageSenderLike): UiResponse | undefined | Promise<UiResponse | undefined>;
  /** Adds the lane's part to the tab's projection (returns the new projection or mutates nothing and returns void). */
  contributeReport?(tabId: number, projection: ProtectProjection): ProtectProjection | void;
  /** Numbers only (test harness, diagnostics). */
  debug?(): Record<string, number | boolean>;
  /** Test profile only (harness): a synthetic input of the lane. */
  debugInject?(payload: unknown): unknown;
}

/** Whether `service` runs with these features (module active). */
export function serviceEnabled(service: ProtectFeatureService, features: readonly ProtectFeature[]): boolean {
  if (service.features === 'module') return true;
  return service.features.some((f) => features.includes(f));
}

/**
 * UI request types routed to a lane (the controller handles the core types itself). firewall: decide, undo, dismiss,
 * list-rules, remove-rules; history: history-*; requests: requests-get and request-*.
 */
export const PROTECT_LANE_ROUTES: Readonly<Partial<Record<ProtectUiRequest['type'], ProtectServiceName>>> = {
  'ui-protect-decide': 'firewall',
  'ui-protect-undo': 'firewall',
  'ui-protect-dismiss': 'firewall',
  'ui-protect-list-rules': 'firewall',
  'ui-protect-remove-rules': 'firewall',
  'ui-protect-history-query': 'history',
  'ui-protect-history-receiver': 'history',
  'ui-protect-history-delete': 'history',
  'ui-protect-history-export': 'history',
  'ui-protect-requests-get': 'requests',
  'ui-protect-request-draft': 'requests',
  'ui-protect-request-save': 'requests',
  'ui-protect-request-status': 'requests',
  'ui-protect-request-delete': 'requests',
};

/** A no-op service (the foundation's stub of a lane). */
export function createNoopService(name: ProtectServiceName, features: readonly ProtectFeature[] | 'module'): ProtectFeatureService {
  return {
    name,
    features,
    start() {
      // stub: the lane's step replaces this service.
    },
    stop() {
      // stub
    },
  };
}
