// ADR-020 «Защита» (opt-in module, OFF by default): service-worker part of the module. See controller.ts.

export { ACTIVATION_FAILED_REASON, PROTECT_MANAGED_POLICY, ProtectController } from './controller';
export type { ProtectControllerOptions } from './controller';
export {
  PROTECT_DB_NAME,
  PROTECT_DB_SCHEMA,
  PROTECT_DB_VERSION,
  PROTECT_STORES,
  ProtectStorageError,
  compareProtectKeys,
  keyInRange,
  keyOf,
  prefixRange,
} from './db-port';
export type { ProtectDb, ProtectDbStatus, ProtectIterateOptions, ProtectKey, ProtectKeyRange, ProtectStoreName } from './db-port';
export { IdbProtectDb, PROTECT_DB_COOLDOWN_MS, browserIdbFactory, createProtectSchema } from './idb';
export { MAX_PROTECT_DOCS, PROTECT_DOC_PREFIX, PROTECT_DOC_TTL_MS, PROTECT_RUNTIME_KEY, PROTECT_TABS_KEY, ProtectDocStore } from './doc-store';
export type { ProtectDocSection, ProtectDocState, ProtectDocStoreOptions, ProtectFirewallSection, ProtectRuntimeState, ProtectUndoEntry } from './doc-store';
export { MAX_PROTECT_TABS, ProtectTabModel, methodOf, requestKindOf, siteOfHost, siteOfUrl } from './tab-model';
export type { ProtectTabEntry, ResolvedRequest } from './tab-model';
export { MAX_EVENT_SUBSCRIBERS, ProtectEventBus } from './event-bus';
export type { ProtectEvent, ProtectEventKind, ProtectEventListener } from './event-bus';
export { NetHub, PROTECT_REQUEST_TYPES, PROTECT_REQUEST_URLS, fastHost, needsSharedListeners } from './net-hub';
export type { NetHubSink, ProtectRequestContext } from './net-hub';
export { BLOCKED_BY_CLIENT, OutcomeTracker, noFirewallEvaluate } from './outcomes';
export type { FirewallEvaluatePort, FirewallVerdict, OutcomeEvent } from './outcomes';
export { DNR_WRITE_TIMEOUT_MS, DnrPort, hashRules } from './dnr-port';
export type { DnrApplyResult, DnrHashStore } from './dnr-port';
export {
  GPC_MAIN_FILE,
  PROTECT_ISOLATED_FILE,
  PROTECT_ISOLATED_SCRIPT_ID,
  PROTECT_MAIN_FILE,
  PROTECT_MAIN_SCRIPT_ID,
  PROTECT_POLICY_FILE,
  PROTECT_SCRIPT_IDS,
  ProtectRegistration,
  excludeMatchesFor,
  protectGroupMask,
  protectGroupsFor,
  protectIsolatedFiles,
  protectMainFiles,
  protectOnFile,
} from './registration';
export type { ProtectRegistrationDesired, ProtectRegistrationOptions, ProtectTripwireFiles } from './registration';
export { PROTECT_BROAD_ORIGINS, PROTECT_DNR_PERMISSION, concernsProtect, readProtectPermissions } from './permissions';
export type { ProtectPermissions } from './permissions';
export { EMPTY_PROTECT_TABLES, PROTECT_LANE_ROUTES, PROTECT_SERVICE_NAMES, createNoopService, serviceEnabled } from './services';
export type {
  PersistedReportInfo,
  ProtectAckContribution,
  ProtectFeatureService,
  ProtectPorts,
  ProtectServiceContext,
  ProtectServiceName,
  ProtectStopReason,
  ProtectTables,
} from './services';
