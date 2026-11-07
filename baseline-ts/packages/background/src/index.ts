// @detect-expert/background — service-worker side: sender verification, document reducer, session repository,
// scope/permissions, minimal network observer, onMessage dispatcher (spec Part II A3, A5–A7, A9, A10).
// No chrome.* global is touched here: everything receives a BackgroundChromeApi (the SW entry passes `chrome`).

import type { BackgroundChromeApi } from './chrome-api';
import { createMessageListener } from './handlers';
import type { MessageListener } from './handlers';
import { createNetworkListener, NETWORK_FILTER } from './network';
import { NETWORK_ATTEMPT_FILTER } from './network-attempts';
import { createResponseHeadersListener, RESPONSE_HEADERS_FILTER } from './response-headers';
import { createNavigationObservers } from './observers';
import type { NavigationObservers } from './observers';
import { BackgroundRuntime } from './runtime';
import type { RuntimeOptions } from './runtime';

export type {
  BackgroundChromeApi,
  Clock,
  EventLike,
  FrameDetailsLike,
  MessageSenderLike,
  NavigationDetailsLike,
  PermissionsLike,
  RegisteredContentScriptLike,
  RequestDetailsLike,
  ResponseHeadersDetailsLike,
  RequestFilterLike,
  ScriptInjectionLike,
  StorageAreaLike,
  TabDetailsLike,
} from './chrome-api';
export { systemClock } from './chrome-api';
export { noopEngine } from './engine-port';
export type { EnginePort } from './engine-port';
export {
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
  NavigationAttempt,
  QuarantineEntry,
  ReduceResult,
  ReducerDeps,
  SessionWatermark,
  StateNotes,
  TabProjection,
  UnattributedCounters,
} from './documents';
export { projectReport, projectTechniques, projectVendors } from './projection';
export { RateLimiter } from './rate-limit';
export {
  DOC_KEY_PREFIX,
  INDEX_KEY,
  SessionRepository,
  STORED_VERSION,
  readStoredDocument,
  readStoredIndex,
} from './repository';
export type { CommitFailure, CommitResult, LoadResult, StoredDocument, StoredIndex } from './repository';
export {
  ALL_SITES_PATTERNS,
  ALL_NETWORK_ACCESS_PATTERNS,
  FULL_ACCESS_DEFAULT_KEY,
  ISOLATED_SCRIPT_FILE,
  ISOLATED_SCRIPT_ID,
  MAIN_SCRIPT_FILE,
  MAIN_SCRIPT_ID,
  SCOPE_PREFS_KEY,
  ScopeController,
  hostPatterns,
  hostAccessPatterns,
  patternCoversHost,
  requestScopeAccess,
} from './scope';
export type { ScopePrefs, SetScopeResult } from './scope';
export { NETWORK_FILTER, NETWORK_RESOURCE_TYPES, createNetworkListener } from './network';
export { NETWORK_ATTEMPT_FILTER } from './network-attempts';
export type { NetworkResourceType } from './network';
export { createNavigationObservers } from './observers';
export type { NavigationObservers } from './observers';
export { BackgroundRuntime, uiError } from './runtime';
export type { RuntimeDiagnostics, RuntimeOptions } from './runtime';
export { createMessageListener, route } from './handlers';
export type { MessageListener, MessageResponse } from './handlers';
export { ProRecordingManager, PRO_STORAGE_KEY, PRO_ALARM_NAME, PRO_NETWORK_FILTER } from './pro-recording';
export { GOOGLE_IDS_FILTER } from './google-ids';

export interface Background {
  runtime: BackgroundRuntime;
  /** For chrome.runtime.onMessage.addListener — synchronous, returns true. */
  onMessage: MessageListener;
  navigation: NavigationObservers;
  network: { onCompleted: (details: import('./chrome-api').RequestDetailsLike) => void; filter: typeof NETWORK_FILTER;
    onResponseCompleted: (details: import('./chrome-api').ResponseHeadersDetailsLike) => void; responseHeadersFilter: typeof RESPONSE_HEADERS_FILTER;
    onBeforeRequest: (details: import('./chrome-api').RequestDetailsLike) => undefined; attemptFilter: typeof NETWORK_ATTEMPT_FILTER };
  /** Hydration; call after all listeners are registered. Resolves when the runtime is ready. */
  start(): Promise<void>;
}

/** Builds the runtime and its listener callbacks. Registration stays in the SW entrypoint (top level, synchronous). */
export function createBackground(api: BackgroundChromeApi, options: RuntimeOptions = {}): Background {
  const runtime = new BackgroundRuntime(api, options);
  return {
    runtime,
    onMessage: createMessageListener(runtime),
    navigation: createNavigationObservers(runtime),
    network: { onCompleted: createNetworkListener(runtime), filter: NETWORK_FILTER,
      onResponseCompleted: createResponseHeadersListener(runtime), responseHeadersFilter: RESPONSE_HEADERS_FILTER,
      onBeforeRequest: details => { runtime.networkAttempts.onBeforeRequest(details); return undefined; }, attemptFilter: NETWORK_ATTEMPT_FILTER },
    start: () => runtime.start(),
  };
}
