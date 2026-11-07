// @detect-expert/background — service-worker side: sender verification, document reducer, session repository,
// scope/permissions, network observer (webRequest onBeforeRequest, ADR-018), catalog matcher (webRequest onCompleted,
// S10 / ADR-009 v1.1), onMessage dispatcher (spec Part II A3, A5–A7, A9, A10).
// No chrome.* global is touched here: everything receives a BackgroundChromeApi (the SW entry passes `chrome`).

import type { BackgroundChromeApi, PermissionsLike } from './chrome-api';
import { createMessageListener } from './handlers';
import type { MessageListener } from './handlers';
import { buildNetworkFilter, createNetworkListener } from './network';
import type { NetworkFilter, NetworkListener } from './network';
import { createNavigationObservers } from './observers';
import type { NavigationObservers } from './observers';
import { BackgroundRuntime } from './runtime';
import type { RuntimeOptions } from './runtime';
import { VENDOR_MATCH_FILTER, createVendorMatchListener } from './vendor-match';
import type { VendorMatchFilter, VendorMatchListener } from './vendor-match';

export type {
  ActionLike,
  I18nLike,
  BackgroundChromeApi,
  Clock,
  DnrLike,
  DnrRuleLike,
  EventLike,
  FrameDetailsLike,
  MessageSenderLike,
  NavigationDetailsLike,
  PermissionsLike,
  RegisteredContentScriptLike,
  RequestBodyLike,
  RequestDetailsLike,
  RequestFilterLike,
  ScriptInjectionLike,
  StorageAreaLike,
  WebRequestEventLike,
} from './chrome-api';
export { systemClock } from './chrome-api';
// S12 / E13-03: per-tab toolbar badge.
export { BADGE_COLOR, BADGE_FLUSH_MS, BADGE_MAX_TABS_PER_FLUSH, BADGE_MAX_TRACKED, BADGE_TEXT_COLOR, BadgeController } from './badge';
export type { BadgeApi, BadgeInput } from './badge';
export { noopEngine } from './engine-port';
export type { EnginePort } from './engine-port';
export {
  isOptionsSender,
  readPageSender,
  verifyPageSender,
  verifyUiSender,
  selfOrigin,
  readFrameType,
  readLifecycle,
} from './sender';
export type {
  BrowserDocumentLifecycle,
  FrameType,
  PageSenderContext,
  PageSenderReject,
  PageSenderResult,
  ScopeAccess,
  VerifiedPageSender,
} from './sender';
export {
  bindingKey,
  hostAggregateKey,
  mergeRuleIds,
  MAX_HOST_RULE_IDS,
  createInitialState,
  deriveCoverageState,
  estimateReportBytes,
  isProjected,
  planEviction,
  reduce,
  selectDocumentKey,
  MAX_BOOTS_PER_DOCUMENT,
  MAX_EVICTED_KEYS,
  MAX_SESSIONS_PER_DOCUMENT,
} from './documents';
export type {
  BatchOutcome,
  BatchStatus,
  BootCounters,
  DocumentEvent,
  DocumentMeta,
  DocumentsState,
  Effect,
  FrameBinding,
  NetworkRequestClass,
  NavigationAttempt,
  QuarantineEntry,
  ReduceResult,
  ReducerDeps,
  SensorStamp,
  SessionWatermark,
  StateNotes,
  TabProjection,
  UnattributedCounters,
} from './documents';
export { disabledSensorsOf, projectReport } from './projection';
export type { SensorSources } from './projection';
export { RateLimiter } from './rate-limit';
export {
  DOC_KEY_PREFIX,
  INDEX_KEY,
  SessionRepository,
  STORED_VERSION,
  readStoredDocument,
  readStoredIndex,
  redactStoredHosts,
  redactStoredNetwork,
} from './repository';
export type { CommitFailure, CommitResult, LoadResult, StoredDocument, StoredIndex } from './repository';
export {
  ALL_SITES_PATTERNS,
  EARLY_MAIN_SCRIPT_FILE,
  ISOLATED_SCRIPT_FILE,
  ISOLATED_SCRIPT_ID,
  MAIN_SCRIPT_FILE,
  MAIN_SCRIPT_ID,
  SCOPE_PREFS_KEY,
  SENSOR_POLICY_FILE,
  ScopeController,
  hostPatterns,
  mainFiles,
  parseMainFiles,
  patternCoversHost,
  requestScopeAccess,
  sensorOffFile,
} from './scope';
export type { InjectResult, ScopeCoreState, ScopePrefs, SetScopeResult } from './scope';
export {
  MANAGED_POLICY_NAME,
  POLICY_LKG_KEY,
  SENSOR_PREFS_KEY,
  SensorPolicyController,
  inRegistryOrder,
  isSensorId,
  parseManagedPolicy,
  readSensorIdList,
} from './sensors';
export type { ManagedPolicyResult, ManagedPolicyStatus, SensorChange, SensorChangeHook, SensorPolicyOptions } from './sensors';
export {
  NETWORK_FILTER,
  NETWORK_RESOURCE_TYPES,
  OPTIONAL_NETWORK_RESOURCE_TYPES,
  buildNetworkFilter,
  classifyRequest,
  createNetworkListener,
  redactNetworkTarget,
} from './network';
export type { NetworkFilter, NetworkListener, NetworkResourceType } from './network';
export { NetworkWindowTracker, MAX_NETWORK_WINDOW_DOCUMENTS, MAX_LOCAL_TARGETS, MAX_SUBDOMAIN_DOMAINS } from './network-window';
export { VENDOR_MATCH_FILTER, VENDOR_MATCH_TYPES, catalogHasNetworkRules, createVendorMatchListener } from './vendor-match';
export type { VendorMatchFilter, VendorMatchListener, VendorMatchType } from './vendor-match';
export type { NetworkWindowOptions } from './network-window';
export { createNavigationObservers } from './observers';
export type { NavigationObservers } from './observers';
export { BackgroundRuntime, uiError } from './runtime';
export type { RuntimeDiagnostics, RuntimeOptions } from './runtime';
export { createMessageListener, route } from './handlers';
export type { MessageListener, MessageResponse } from './handlers';
// ADR-020 «Защита» (S04): service-worker part of the opt-in module (OFF by default).
export * from './protect/index';

export interface Background {
  runtime: BackgroundRuntime;
  /** For chrome.runtime.onMessage.addListener — synchronous, returns true. */
  onMessage: MessageListener;
  navigation: NavigationObservers;
  /** S07 / ADR-018: webRequest.onBeforeRequest listener and its feature-detected filter (no 'blocking'). */
  network: { onBeforeRequest: NetworkListener; filter: NetworkFilter };
  /**
   * S10 / ADR-009 v1.1: webRequest.onCompleted catalog matcher and its filter. The entry registers it only when the
   * build's catalog has network rules or in the test profile.
   */
  vendorMatch: { onCompleted: VendorMatchListener; filter: VendorMatchFilter };
  /**
   * ADR-019 (S11): for chrome.storage.managed.onChanged (the managed area's own event, registered at the top level of
   * the SW entry). The organization policy is re-read and applied on the fly.
   */
  policy: { onManagedChanged: () => void };
  /**
   * ADR-020 (S04): the module «Защита» reacts to permission and policy changes (called from the entry's existing
   * top-level listeners). Empty work while the module is off.
   */
  protect: {
    onPermissionsAdded: (permissions?: PermissionsLike) => void;
    onPermissionsRemoved: (permissions?: PermissionsLike) => void;
    onManagedChanged: () => void;
  };
  /** Hydration; call after all listeners are registered. Resolves when the runtime is ready. */
  start(): Promise<void>;
}

/** chrome.webRequest.ResourceType when the browser exposes it; never throws. */
function readResourceTypes(api: BackgroundChromeApi): Readonly<Record<string, string>> | null {
  try {
    const types = api.webRequest.ResourceType;
    return types !== undefined && types !== null && typeof types === 'object' ? types : null;
  } catch {
    return null;
  }
}

/** Builds the runtime and its listener callbacks. Registration stays in the SW entrypoint (top level, synchronous). */
export function createBackground(api: BackgroundChromeApi, options: RuntimeOptions = {}): Background {
  const runtime = new BackgroundRuntime(api, options);
  return {
    runtime,
    onMessage: createMessageListener(runtime),
    navigation: createNavigationObservers(runtime),
    network: { onBeforeRequest: createNetworkListener(runtime), filter: buildNetworkFilter(readResourceTypes(api)) },
    vendorMatch: { onCompleted: createVendorMatchListener(runtime), filter: VENDOR_MATCH_FILTER },
    policy: { onManagedChanged: () => { void runtime.onManagedPolicyChanged().catch(() => undefined); } },
    protect: {
      onPermissionsAdded: (permissions) => { void runtime.protect.onPermissionsAdded(permissions).catch(() => undefined); },
      onPermissionsRemoved: (permissions) => { void runtime.protect.onPermissionsRemoved(permissions).catch(() => undefined); },
      onManagedChanged: () => { void runtime.protect.onManagedChanged().catch(() => undefined); },
    },
    start: () => runtime.start(),
  };
}
