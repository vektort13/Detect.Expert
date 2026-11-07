// Wire types for protocol v1 (docs/PROJECT_RULES.md «Протокол v1», spec Part II A6, Part I §4.3, Part VI I1).
// Every message from MAIN is page-controlled and untrusted; tabId/frameId/documentId are never taken from it.

import type {
  AttributionConfidence,
  BridgeControlCommand,
  BridgeStopReason,
  Channel,
  CountQuality,
  CoverageFlag,
  CoverageState,
  DocumentLifecycle,
  EvidenceSource,
  HostCategory,
  Integrity,
  Interpretation,
  InterpretationConfidence,
  OrganizationPolicyState,
  Phase,
  ScopeMode,
  SensorDisableSource,
  SensorId,
  SensorState,
  SignalCode,
  SiteRelation,
  TechniqueId,
  UiErrorCode,
  VendorMatch,
} from './enums';
import type { OperationCode } from './operations';
import type {
  HistoryRetentionDays,
  ProtectFeature,
  ProtectPreset,
  ProtectProjection,
  ProtectPurgeTarget,
  ProtectSnoozeMinutes,
  ProtectState,
} from './protect';
import type { DecisionScope, FirewallAction, FirewallRuleRow, FirewallStoppedDay } from './protect-firewall';
import type { HistoryDeleteTarget, HistoryExport, HistoryProjection, HistoryReceiverCard, HistoryWindowDays } from './protect-history';
import type {
  DeletionRequestRecord,
  LocalDay,
  NewRequestInput,
  RequestDraftContext,
  RequestJournalSummary,
  RequestPrefs,
  RequestSourceKind,
  RequestStatus,
  RequestView,
} from './protect-requests';

/** One normalized page-hook observation (integrity: page-controlled when received from MAIN). */
export interface PageObservation {
  techniqueId: TechniqueId;
  /** Saturating non-negative counter, 0..MAX_COUNT. */
  count: number;
  countQuality: CountQuality;
  phase: Phase;
  /** Unique; at most BUDGETS.maxSignalCodesPerObservation entries. */
  signalCodes: SignalCode[];
  /** Rounded time bucket on the sensor's local scale, 0..MAX_COUNT. Local ordering only, never a precise clock. */
  intervalBucket: number;
  /**
   * What the PAGE asked for (method/property, or the category of a primitive argument), only from
   * PAGE_OPERATIONS[techniqueId] (ADR-017). Never the browser's answer and never a page value. Absent = no detail.
   */
  operationCode?: OperationCode;
}

// ---------------------------------------------------------------------------
// MAIN <-> ISOLATED via window.postMessage. `event.source === window`, `channel` and
// `sensorBootId` are routing, not authentication (REQ-004).
// ---------------------------------------------------------------------------

interface PageMessageBase {
  channel: Channel;
  /** Local boot identifier of the MAIN sensor instance. No authentication promise. */
  sensorBootId: string;
}

export interface SensorHelloMessage extends PageMessageBase {
  type: 'sensor-hello';
  protocolVersion: number;
  /** True when the sensor installed after document scripts may already have run. */
  startedLate: boolean;
  coverageFlags: CoverageFlag[];
}

export interface SensorBatchMessage extends PageMessageBase {
  type: 'sensor-batch';
  /** Monotonic per sensor boot, starts at 1. */
  sensorSeq: number;
  /** 1..BUDGETS.maxBatchEvents entries. */
  observations: PageObservation[];
  coverageDelta: CoverageFlag[];
}

export interface SensorStatusMessage extends PageMessageBase {
  type: 'sensor-status';
  state: SensorState;
  coverageFlags: CoverageFlag[];
  /** Observations dropped inside the sensor since the previous status (saturating). */
  droppedSinceLast: number;
}

export interface BridgeHelloMessage extends PageMessageBase {
  type: 'bridge-hello';
  protocolVersion: number;
  bridgeSessionId: string;
  paused: boolean;
}

export interface BridgePauseMessage extends PageMessageBase {
  type: 'bridge-pause';
}

export interface BridgeResumeMessage extends PageMessageBase {
  type: 'bridge-resume';
}

export interface BridgeStopMessage extends PageMessageBase {
  type: 'bridge-stop';
  reason: BridgeStopReason;
}

export type SensorMessage = SensorHelloMessage | SensorBatchMessage | SensorStatusMessage;
export type BridgeMessage = BridgeHelloMessage | BridgePauseMessage | BridgeResumeMessage | BridgeStopMessage;
export type PageMessage = SensorMessage | BridgeMessage;
export type PageMessageType = PageMessage['type'];

// ---------------------------------------------------------------------------
// ISOLATED -> SW via chrome.runtime.sendMessage. tabId/frameId/documentId come from MessageSender only.
// ---------------------------------------------------------------------------

export interface PageBatch {
  schemaVersion: 1;
  type: 'sensor-events';
  sensorBootId: string;
  /** Assigned by ISOLATED; scopes `batchSeq` for redelivery and dedup. */
  bridgeSessionId: string;
  /** Monotonic per bridge session, starts at 1. Ack.lastCommittedBatchSeq === 0 means nothing committed yet. */
  batchSeq: number;
  /**
   * 0..BUDGETS.maxBatchEvents entries. Empty only in a coverage-only batch, i.e. together with a non-empty
   * `coverageDelta` (sensor diagnostics without observations; never a fabricated observation).
   */
  observations: PageObservation[];
  coverageDelta: CoverageFlag[];
}

/** Sent after snapshot + dedup watermark are persisted (REQ-009). */
export interface Ack {
  schemaVersion: 1;
  type: 'ack';
  lastCommittedBatchSeq: number;
  paused: boolean;
  protocolOk: boolean;
  /** Terminal access loss, independent of protocol compatibility (F020). */
  stopReason?: 'revoked';
}

// ---------------------------------------------------------------------------
// SW -> ISOLATED bridge via chrome.tabs.sendMessage(tabId, message, { frameId, documentId }).
// Trusted direction (the bridge verifies the sender is this extension's service worker, never a tab), used
// so that ui-pause / ui-resume reach a bridge that is not sending (a paused bridge never sees an Ack).
// ---------------------------------------------------------------------------

export interface BridgeControlMessage {
  schemaVersion: 1;
  type: 'bridge-control';
  command: BridgeControlCommand;
}

// ---------------------------------------------------------------------------
// UI (popup/sidepanel/options) -> SW. Privileged channel: the SW must verify the sender is an
// extension page (sender.id === chrome.runtime.id && sender.origin === chrome-extension://<id>).
// A page payload can never produce these commands (REQ-004).
// ---------------------------------------------------------------------------

export interface UiGetReportRequest {
  schemaVersion: 1;
  type: 'ui-get-report';
  tabId: number;
  frameId?: number;
}

export interface UiPauseRequest {
  schemaVersion: 1;
  type: 'ui-pause';
  tabId: number;
  /** Verified against the current document so that a navigation between click and handling is detected. */
  documentKey: string;
  reportRevision: number;
}

export interface UiResumeRequest {
  schemaVersion: 1;
  type: 'ui-resume';
  tabId: number;
  documentKey: string;
  /** Required for the stale-action check, including resume (ADR-004 §8, F039). */
  reportRevision: number;
}

export interface UiClearRequest {
  schemaVersion: 1;
  type: 'ui-clear';
  tabId: number;
  documentKey: string;
  reportRevision: number;
}

export interface UiSetScopeRequest {
  schemaVersion: 1;
  type: 'ui-set-scope';
  scopeMode: ScopeMode;
  /** Sanitized host; present only when scopeMode === 'site'. */
  host?: string;
}

export interface UiExportPreviewRequest {
  schemaVersion: 1;
  type: 'ui-export-preview';
  tabId: number;
  documentKey: string;
  reportRevision: number;
  includeHost?: boolean;
}

export interface UiGetScopeRequest {
  schemaVersion: 1;
  type: 'ui-get-scope';
}

/**
 * active-tab mode ("check from now on", ADR-003): inject both worlds into the open documents of `tabId` under the
 * activeTab grant of the toolbar click. The tab's documents get `late-start`. Answer: ok | error no-access.
 */
export interface UiInjectNowRequest {
  schemaVersion: 1;
  type: 'ui-inject-now';
  tabId: number;
}

/** Deletes every document report of the session (options page). Settings are kept. Answer: ok (reportRevision null). */
export interface UiClearSessionRequest {
  schemaVersion: 1;
  type: 'ui-clear-session';
}

/**
 * ADR-019 (options page): the user disables or enables one sensor family. A family disabled by the organization
 * stays disabled whatever the user chooses. Answer: UiScopeResponse with the resulting sensorSettings.
 */
export interface UiSetSensorRequest {
  schemaVersion: 1;
  type: 'ui-set-sensor';
  sensorId: SensorId;
  enabled: boolean;
}

/**
 * S12 / E13-03 (options page, ADR-003 v3): removes one host from the site list and stops observing it. Revoking the
 * browser grant itself is a separate chrome.permissions.remove call of the UI. Answer: UiScopeResponse.
 */
export interface UiRemoveSiteRequest {
  schemaVersion: 1;
  type: 'ui-remove-site';
  /** Sanitized host (isSanitizedHost); never a pattern. */
  host: string;
}

// ---------------------------------------------------------------------------
// ADR-020 «Защита»: UI -> SW requests of the opt-in module. One prefix `ui-protect-`, one route, one validator
// (validateProtectUiRequest). Privileged UI channel only; a page sender gets unauthorized-sender. Widening actions
// (enable, set-settings, set-site with excluded:false) are accepted from the Options page only (isOptionsSender).
// ---------------------------------------------------------------------------

export interface UiProtectGetStateRequest {
  schemaVersion: 1;
  type: 'ui-protect-get-state';
}

/** Options only. Sent after the consent screen and chrome.permissions.request in the same gesture (ADR-020 §6). */
export interface UiProtectEnableRequest {
  schemaVersion: 1;
  type: 'ui-protect-enable';
  consentVersion: number;
  /** 1..PROTECT_FEATURES.length, unique. */
  features: ProtectFeature[];
  preset: ProtectPreset;
}

export interface UiProtectDisableRequest {
  schemaVersion: 1;
  type: 'ui-protect-disable';
  /** Also delete IndexedDB, protect-* session keys, storage.local['protect'] (our DNR rules are removed in any case). */
  purge: boolean;
}

/** Options only. At least one field. */
export interface UiProtectSetSettingsRequest {
  schemaVersion: 1;
  type: 'ui-protect-set-settings';
  features?: ProtectFeature[];
  preset?: ProtectPreset;
  historyRetentionDays?: HistoryRetentionDays;
}

export interface UiProtectSnoozeRequest {
  schemaVersion: 1;
  type: 'ui-protect-snooze';
  minutes: ProtectSnoozeMinutes;
}

/** Exclude a site from the whole module (excluded:true from any UI page; excluded:false from Options only). */
export interface UiProtectSetSiteRequest {
  schemaVersion: 1;
  type: 'ui-protect-set-site';
  /** Sanitized host (isSanitizedHost); the SW normalizes it to the registrable domain. */
  host: string;
  excluded: boolean;
}

export interface UiProtectPurgeRequest {
  schemaVersion: 1;
  type: 'ui-protect-purge';
  what: ProtectPurgeTarget;
}

export interface UiProtectGetReportRequest {
  schemaVersion: 1;
  type: 'ui-protect-get-report';
  tabId: number;
  frameId?: number;
}

/** Decision on a prompt; checked against the current document, protectRevision and promptId (stale → stale-revision). */
export interface UiProtectDecideRequest {
  schemaVersion: 1;
  type: 'ui-protect-decide';
  tabId: number;
  documentKey: string;
  protectRevision: number;
  promptId: string;
  /** 1..PROTECT_BUDGETS.maxPromptReceivers registrable domains, unique. */
  receivers: string[];
  action: FirewallAction;
  scope: DecisionScope;
}

export interface UiProtectUndoRequest {
  schemaVersion: 1;
  type: 'ui-protect-undo';
  tabId: number;
  undoId: string;
}

export interface UiProtectDismissRequest {
  schemaVersion: 1;
  type: 'ui-protect-dismiss';
  tabId: number;
  documentKey: string;
  protectRevision: number;
  promptId: string;
}

export interface UiProtectListRulesRequest {
  schemaVersion: 1;
  type: 'ui-protect-list-rules';
  /** 0..PROTECT_WIRE_LIMITS.maxRulesOffset. */
  offset: number;
  /** 1..PROTECT_WIRE_LIMITS.maxRulesPageSize. */
  limit: number;
  /** Substring filter over receiver / site domains: 1..64 of [a-z0-9.-] (never a URL query). */
  domainFilter?: string;
  action?: FirewallAction;
}

export interface UiProtectRemoveRulesRequest {
  schemaVersion: 1;
  type: 'ui-protect-remove-rules';
  /** 1..PROTECT_WIRE_LIMITS.maxRemoveRuleKeys FIREWALL_RULE_KEY_PATTERN keys, unique. */
  ruleKeys: string[];
}

export interface UiProtectHistoryQueryRequest {
  schemaVersion: 1;
  type: 'ui-protect-history-query';
  windowDays: HistoryWindowDays;
  /** 0..PROTECT_WIRE_LIMITS.maxHistoryOffset. */
  offset: number;
  /** 1..PROTECT_BUDGETS.maxRowsPerPage. */
  limit: number;
  /** Default 2: receivers seen on at least two sites. */
  minSites?: 1 | 2;
  mechanismsOnly?: boolean;
  /** «На этом сайте»: site name. */
  site?: string;
  /** Substring filter over receiver domains: 1..64 of [a-z0-9.-] (never a URL query). */
  domainFilter?: string;
}

export interface UiProtectHistoryReceiverRequest {
  schemaVersion: 1;
  type: 'ui-protect-history-receiver';
  rowKey: string;
  windowDays: HistoryWindowDays;
}

/** Delete one history row (key = rowKey) or one site (key = site name). */
export interface UiProtectHistoryDeleteRequest {
  schemaVersion: 1;
  type: 'ui-protect-history-delete';
  target: HistoryDeleteTarget;
  key: string;
}

export interface UiProtectHistoryExportRequest {
  schemaVersion: 1;
  type: 'ui-protect-history-export';
  /** Site names instead of site-N references (the UI warns before). */
  includeSites: boolean;
}

export interface UiProtectRequestsGetRequest {
  schemaVersion: 1;
  type: 'ui-protect-requests-get';
  view: RequestView;
}

/** recordId: an evidenceId for `evidence`, a history rowKey for `history`, absent for `manual`. */
export interface UiProtectRequestDraftRequest {
  schemaVersion: 1;
  type: 'ui-protect-request-draft';
  sourceKind: RequestSourceKind;
  recordId?: string;
}

/** Adds a `prepared` record; expectedRevision must equal the journal revision (otherwise stale-revision). */
export interface UiProtectRequestSaveRequest {
  schemaVersion: 1;
  type: 'ui-protect-request-save';
  expectedRevision: number;
  request: NewRequestInput;
}

export interface UiProtectRequestStatusRequest {
  schemaVersion: 1;
  type: 'ui-protect-request-status';
  expectedRevision: number;
  requestId: string;
  /** Any status except `prepared`; REQUEST_STATUS_TRANSITIONS decides in the SW. */
  status: Exclude<RequestStatus, 'prepared'>;
  day: LocalDay;
}

export interface UiProtectRequestDeleteRequest {
  schemaVersion: 1;
  type: 'ui-protect-request-delete';
  expectedRevision: number;
  requestId: string;
}

export type ProtectUiRequest =
  | UiProtectGetStateRequest
  | UiProtectEnableRequest
  | UiProtectDisableRequest
  | UiProtectSetSettingsRequest
  | UiProtectSnoozeRequest
  | UiProtectSetSiteRequest
  | UiProtectPurgeRequest
  | UiProtectGetReportRequest
  | UiProtectDecideRequest
  | UiProtectUndoRequest
  | UiProtectDismissRequest
  | UiProtectListRulesRequest
  | UiProtectRemoveRulesRequest
  | UiProtectHistoryQueryRequest
  | UiProtectHistoryReceiverRequest
  | UiProtectHistoryDeleteRequest
  | UiProtectHistoryExportRequest
  | UiProtectRequestsGetRequest
  | UiProtectRequestDraftRequest
  | UiProtectRequestSaveRequest
  | UiProtectRequestStatusRequest
  | UiProtectRequestDeleteRequest;
export type ProtectUiRequestType = ProtectUiRequest['type'];

/** Common prefix of every module UI request type. */
export const PROTECT_UI_PREFIX = 'ui-protect-' as const;

/** The 22 module UI request types (core, firewall, history, requests). */
export const PROTECT_UI_REQUEST_TYPES = [
  'ui-protect-get-state',
  'ui-protect-enable',
  'ui-protect-disable',
  'ui-protect-set-settings',
  'ui-protect-snooze',
  'ui-protect-set-site',
  'ui-protect-purge',
  'ui-protect-get-report',
  'ui-protect-decide',
  'ui-protect-undo',
  'ui-protect-dismiss',
  'ui-protect-list-rules',
  'ui-protect-remove-rules',
  'ui-protect-history-query',
  'ui-protect-history-receiver',
  'ui-protect-history-delete',
  'ui-protect-history-export',
  'ui-protect-requests-get',
  'ui-protect-request-draft',
  'ui-protect-request-save',
  'ui-protect-request-status',
  'ui-protect-request-delete',
] as const satisfies readonly ProtectUiRequestType[];

/** Module types accepted only from the Options page (the SW also checks set-site with excluded:false). */
export const PROTECT_OPTIONS_ONLY_TYPES = ['ui-protect-enable', 'ui-protect-set-settings'] as const satisfies readonly ProtectUiRequestType[];

export type UiRequest =
  | UiGetReportRequest
  | UiPauseRequest
  | UiResumeRequest
  | UiClearRequest
  | UiSetScopeRequest
  | UiExportPreviewRequest
  | UiGetScopeRequest
  | UiInjectNowRequest
  | UiClearSessionRequest
  | UiSetSensorRequest
  | UiRemoveSiteRequest
  | ProtectUiRequest;
export type UiRequestType = UiRequest['type'];

// ---------------------------------------------------------------------------
// SW -> UI
// ---------------------------------------------------------------------------

export interface ScopeState {
  scopeMode: ScopeMode;
  /** Sanitized hosts enabled in site mode (bounded by BUDGETS.maxHostsPerDocument). */
  hosts: string[];
  /** Broad optional host access has actually been granted by the browser. */
  grantedAllSites: boolean;
  /** Managed policy restricts or defines the scope. Always false in v1: no managed scope policy exists (ADR-019). */
  managed: boolean;
  /** ADR-019: user and organization sensor family settings (S11). */
  sensorSettings: SensorSettings;
}

/** One sensor family in the options page (ADR-019). `enabled` is the effective state. */
export interface SensorSetting {
  sensorId: SensorId;
  enabled: boolean;
  /** Who disables it, in SENSOR_DISABLE_SOURCES order; empty when enabled. */
  disabledBy: SensorDisableSource[];
}

export interface SensorSettings {
  /** Every family of SENSOR_IDS, in registry order. */
  sensors: SensorSetting[];
  organizationPolicy: OrganizationPolicyState;
  /** Entries of the current managed value that were not applied (unknown id, wrong type, too long; saturating). */
  rejectedPolicyEntries: number;
}

/**
 * ADR-019: a sensor family that is not observed in this document. `disabledBy` is the current reason; empty when the
 * family was enabled again after the document loaded (it observes again only after a reload). `hooksMayRemain`: hooks
 * installed before the family was disabled may still be on the page until it reloads (their data is not stored).
 */
export interface DisabledSensorSummary {
  sensorId: SensorId;
  disabledBy: SensorDisableSource[];
  hooksMayRemain: boolean;
}

/** Only what is shown in the preview can be exported (REQ-013). Redacted by default. */
export interface ExportPreview {
  schemaVersion: 1;
  redacted: true;
  documentOrdinal: number;
  reportRevision: number;
  report: ExportReport;
}

/** Export-specific allowlist: no browser identities or absolute epochs (F027/F108). */
export interface ExportReport {
  host: string | null;
  coverageState: CoverageState;
  coverageFlags: CoverageFlag[];
  techniques: TechniqueSummary[];
  findings: Finding[];
  vendors: VendorSummary[];
  dropped: DroppedCounters;
  observationAgeMinutes: number | null;
  scopeMode: ScopeMode;
  /** Copied from ReportProjection.catalogVersion (S10, ADR-004 changelog); null: the build has no active rules. */
  catalogVersion: string | null;
  /** ADR-019 (S11): ids of the sensor families not observed in this document; absent when none. Ids only. */
  disabledSensors?: SensorId[];
}

export interface UiReportResponse {
  schemaVersion: 1;
  type: 'report';
  /** null when no document report exists for the requested tab/frame. */
  report: ReportProjection | null;
}

export interface UiOkResponse {
  schemaVersion: 1;
  type: 'ok';
  reportRevision: number | null;
}

export interface UiScopeResponse {
  schemaVersion: 1;
  type: 'scope';
  scope: ScopeState;
}

export interface UiExportPreviewResponse {
  schemaVersion: 1;
  type: 'export-preview';
  preview: ExportPreview;
}

export interface UiErrorResponse {
  schemaVersion: 1;
  type: 'error';
  code: UiErrorCode;
}

// ADR-020 «Защита»: SW -> UI answers of the module.

export interface UiProtectStateResponse {
  schemaVersion: 1;
  type: 'protect-state';
  state: ProtectState;
}

export interface UiProtectReportResponse {
  schemaVersion: 1;
  type: 'protect-report';
  /** null when no module data exists for the tab/frame (or the module is off). */
  report: ProtectProjection | null;
}

export interface UiProtectDecisionResponse {
  schemaVersion: 1;
  type: 'protect-decision';
  /** Per receiver: whether a DNR rule was applied (false: stored, but not in effect; never claim blocking then). */
  applied: { receiver: string; ruleApplied: boolean }[];
  undoId: string | null;
  report: ProtectProjection | null;
}

export interface UiProtectRulesResponse {
  schemaVersion: 1;
  type: 'protect-rules';
  total: number;
  rows: FirewallRuleRow[];
  preset: ProtectPreset;
  /** Lower bounds per local day, at most PROTECT_BUDGETS.maxStatDays. */
  stoppedDays: FirewallStoppedDay[];
}

export interface UiProtectHistoryResponse {
  schemaVersion: 1;
  type: 'protect-history';
  history: HistoryProjection;
}

export interface UiProtectHistoryReceiverResponse {
  schemaVersion: 1;
  type: 'protect-history-receiver';
  card: HistoryReceiverCard | null;
}

/** The export file equals this preview (REQ-013). */
export interface UiProtectHistoryExportResponse {
  schemaVersion: 1;
  type: 'protect-history-export';
  preview: HistoryExport;
}

export interface UiProtectRequestsResponse {
  schemaVersion: 1;
  type: 'protect-requests';
  revision: number;
  summary: RequestJournalSummary;
  prefs: RequestPrefs;
  /** Saturating count of stored records dropped as invalid on hydration. */
  droppedRecords: number;
  /** Present for view 'full' and after mutations. */
  requests?: DeletionRequestRecord[];
}

export interface UiProtectRequestDraftResponse {
  schemaVersion: 1;
  type: 'protect-request-draft';
  draft: RequestDraftContext;
}

export type ProtectUiResponse =
  | UiProtectStateResponse
  | UiProtectReportResponse
  | UiProtectDecisionResponse
  | UiProtectRulesResponse
  | UiProtectHistoryResponse
  | UiProtectHistoryReceiverResponse
  | UiProtectHistoryExportResponse
  | UiProtectRequestsResponse
  | UiProtectRequestDraftResponse;
export type ProtectUiResponseType = ProtectUiResponse['type'];

export type UiResponse =
  | UiReportResponse
  | UiOkResponse
  | UiScopeResponse
  | UiExportPreviewResponse
  | UiErrorResponse
  | ProtectUiResponse;
export type UiResponseType = UiResponse['type'];

// ---------------------------------------------------------------------------
// Findings (spec Part I §4.3). Derived by pure engine rules; never a site verdict (REQ-007).
// ---------------------------------------------------------------------------

export interface Finding {
  findingId: string;
  ruleId: string;
  ruleVersion: string;
  techniqueId: TechniqueId;
  interpretation: Interpretation;
  interpretationConfidence: InterpretationConfidence;
  evidenceIds: string[];
  /** Observed ordinary scenarios; not an excuse for the site. */
  counterEvidenceCodes: string[];
  limitationCodes: string[];
  /** Only justified links; may be empty. */
  vendorMatchIds: string[];
  /** Reference to the coverage snapshot the finding was derived under. */
  coverageRef?: string;
}

// ---------------------------------------------------------------------------
// Report projection: read-only view handed to UI. Always bound to reportRevision.
// ---------------------------------------------------------------------------

export interface TechniqueSummary {
  techniqueId: TechniqueId;
  count: number;
  countQuality: CountQuality;
  phases: Phase[];
  signalCodes: SignalCode[];
  evidenceSource: EvidenceSource;
  integrity: Integrity;
  interpretation: Interpretation;
  interpretationConfidence: InterpretationConfidence;
  attributionConfidence: AttributionConfidence;
  firstBucket: number;
  lastBucket: number;
  /**
   * Unique operation codes seen for the technique, in PAGE_OPERATIONS order (1..maxOperationCodesPerTechnique).
   * Present only when non-empty (ADR-017).
   */
  operationCodes?: OperationCode[];
}

/** "Recognized protection and identification services" — recognition is not trust (REQ-007). */
export interface VendorSummary {
  vendorId: string;
  /** Canonical wire field (ADR-001 §1, F040); vendorMatch names the confidence axis only. */
  vendorConfidence: VendorMatch;
  ruleIds: string[];
  evidenceSource: EvidenceSource;
  integrity: Integrity;
}

/** Saturating counters of what was dropped and why (REQ-009, REQ-011). */
export interface DroppedCounters {
  /** Lower bound on ring evictions; absent in older snapshots and when no overflow was reported. */
  ring?: number;
  observations: number;
  batches: number;
  findings: number;
  hosts: number;
  counters: number;
  transport: number;
}

export interface ReportProjection {
  reportRevision: number;
  documentKey: string;
  /** Sanitized host of the document, or null when unknown / not allowed. */
  host: string | null;
  coverageState: CoverageState;
  coverageFlags: CoverageFlag[];
  techniques: TechniqueSummary[];
  findings: Finding[];
  vendors: VendorSummary[];
  dropped: DroppedCounters;
  /** SW receipt-time scale (ms epoch) of the first observation, or null. */
  observedSince: number | null;
  scopeMode: ScopeMode;
  /**
   * Browser-observed network hosts of the document (ADR-018): at most BUDGETS.maxHostsPerDocument entries, each
   * with exactly one of registrableDomain (PSL) / category. Shown in the UI only; never exported (ExportReport).
   */
  hosts: HostEntry[];
  /**
   * Version of the vendor catalog the projection was matched against (S10, ADR-009 v1.1), CATALOG_VERSION_PATTERN.
   * null means the catalog of this build has no active rules: no recognition was attempted and `vendors` is [].
   */
  catalogVersion: string | null;
  /**
   * ADR-019 (S11): sensor families not observed in this document (registry order, at most SENSOR_IDS.length).
   * Absent when no family is disabled. Set by the SW only.
   */
  disabledSensors?: DisabledSensorSummary[];
}

/** Format of ReportProjection.catalogVersion / ExportReport.catalogVersion when not null (S10). */
export const WIRE_CATALOG_VERSION_PATTERN = /^[A-Za-z0-9.-]{1,64}$/;
/** Format of a catalog rule id in HostEntry.ruleIds / VendorSummary.ruleIds (S10). */
export const WIRE_RULE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// ---------------------------------------------------------------------------
// Stored document model (storage.session; the SW is the only writer). One report per documentId.
// ---------------------------------------------------------------------------

export interface CounterEntry {
  techniqueId: TechniqueId;
  phase: Phase;
  /** Sorted, unique. */
  signalCodes: SignalCode[];
  /** Saturating; merge takes the max of redelivered totals, never the sum. */
  count: number;
  countQuality: CountQuality;
  firstBucket: number;
  lastBucket: number;
  /** Allowlisted operation of the page request (ADR-017); part of the counter key when present. */
  operationCode?: OperationCode;
}

/** Browser-observed network host (webRequest). Host only; never a full URL. Exactly one of registrableDomain/category. */
export interface HostEntry {
  registrableDomain?: string;
  category?: HostCategory;
  /** Relation of the request target to its browser-reported initiator (ADR-008, ADR-018). */
  relation: SiteRelation;
  evidenceSource: 'browser-network';
  integrity: 'browser-observed';
  requestCount: number;
  firstSeenBucket: number;
  lastSeenBucket: number;
  /** Matched catalog rule ids (candidates stay candidates, REQ-008). */
  ruleIds: string[];
}

export interface DedupWatermark {
  bridgeSessionId: string;
  lastCommittedBatchSeq: number;
}

/**
 * Window maxima of the SW network pattern tracker (ADR-018): the largest number of distinct local ports of one local
 * target, distinct local targets, and distinct random-looking subdomains of one registrable domain seen inside one
 * BUDGETS.networkWindowMs window. Integers 0..BUDGETS.maxNetworkWindowDistinct; only counts, never the values.
 */
export interface NetworkPatterns {
  localPortsMax: number;
  localTargetsMax: number;
  randomSubdomainsMax: number;
}

export const EMPTY_NETWORK_PATTERNS: Readonly<NetworkPatterns> = Object.freeze({
  localPortsMax: 0,
  localTargetsMax: 0,
  randomSubdomainsMax: 0,
});

export interface DocumentReport {
  schemaVersion: 1;
  /** makeDocumentKey(tabId, frameId, documentId); assigned from MessageSender / webNavigation only. */
  documentKey: string;
  tabId: number;
  frameId: number;
  documentId: string;
  /** Sanitized host only (no scheme, port, path, query, fragment, userinfo), or null. */
  host: string | null;
  lifecycle: DocumentLifecycle;
  createdAt: number;
  updatedAt: number;
  revision: number;
  coverageState: CoverageState;
  coverageFlags: CoverageFlag[];
  /** Keyed by counterKey(techniqueId, phase, signalCodes, operationCode); at most BUDGETS.maxCountersPerDocumentGroup. */
  counters: CounterEntry[];
  /** At most BUDGETS.maxFindingsPerDocument. */
  findings: Finding[];
  /** At most BUDGETS.maxHostsPerDocument. */
  hosts: HostEntry[];
  /**
   * Browser-network counters written only by the SW (ADR-018): at most BUDGETS.maxNetworkCountersPerDocument,
   * only DET-058…061, phase `attempted`, signalCodes ['api-use'], no operationCode; buckets are seconds since
   * createdAt (not the sensor bucket scale). Page-hook observations of these techniques are ignored.
   */
  networkCounters: CounterEntry[];
  networkPatterns: NetworkPatterns;
  /** Dedup watermark for (documentKey, bridgeSessionId, batchSeq); null before the first commit. */
  watermark: DedupWatermark | null;
  dropped: DroppedCounters;
}

export const EMPTY_DROPPED: Readonly<DroppedCounters> = Object.freeze({
  observations: 0,
  batches: 0,
  findings: 0,
  hosts: 0,
  counters: 0,
  transport: 0,
});

/**
 * Stable counter key: techniqueId + phase + sorted signal codes, plus '|' + operationCode when present
 * ('DET-002|returned-sync|api-use,readback-after-text', 'DET-011|returned-sync|api-use|param-renderer').
 * Without an operation the format is the v1 format unchanged (ADR-017).
 */
export function counterKey(
  techniqueId: TechniqueId,
  phase: Phase,
  signalCodes: readonly SignalCode[],
  operationCode?: OperationCode,
): string {
  const base = techniqueId + '|' + phase + '|' + [...signalCodes].sort().join(',');
  return operationCode === undefined ? base : base + '|' + operationCode;
}

/** Document key from trusted sender/navigation ids only. */
export function makeDocumentKey(tabId: number, frameId: number, documentId: string): string {
  return String(tabId) + ':' + String(frameId) + ':' + documentId;
}
