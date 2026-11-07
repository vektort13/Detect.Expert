// Wire types for protocol v1 (docs/PROJECT_RULES.md «Протокол v1», spec Part II A6, Part I §4.3, Part VI I1).
// Every message from MAIN is page-controlled and untrusted; tabId/frameId/documentId are never taken from it.

import type { PermissionCheck } from './permission-checks';
import type { ApiOperation, ApiOperationSummary } from './api-operations';
import type { RequestedLocalPorts } from './local-ports';
import type { ResponseHeadersSummary } from './response-headers';
import type { ExtensionResource, ExtensionResourceSummary } from './extension-resources';

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
  Integrity,
  Interpretation,
  InterpretationConfidence,
  Phase,
  ScopeMode,
  SensorState,
  SignalCode,
  TechniqueId,
  UiErrorCode,
  VendorMatch,
} from './enums';

/** One normalized page-hook observation (integrity: page-controlled when received from MAIN). */
export interface PageObservation {
  techniqueId: TechniqueId;
  apiOperation?: ApiOperation;
  extensionResource?: ExtensionResource;
  /** Saturating non-negative counter, 0..MAX_COUNT. */
  count: number;
  countQuality: CountQuality;
  phase: Phase;
  /** Unique; at most BUDGETS.maxSignalCodesPerObservation entries. */
  signalCodes: SignalCode[];
  /** Rounded time bucket on the sensor's local scale, 0..MAX_COUNT. Local ordering only, never a precise clock. */
  intervalBucket: number;
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

/** ADR-073: reply to one explicit reset request; contains routing IDs only, never observations. */
export interface SensorResetMessage extends PageMessageBase {
  type: 'sensor-reset';
  resetId: string;
  nextSensorBootId: string;
  coverageFlags: CoverageFlag[];
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

/** ADR-073: ISOLATED asks a known MAIN boot to reset. Routing only; page-forgeable, grants no action. */
export interface BridgeResetMessage extends PageMessageBase {
  type: 'bridge-reset';
  resetId: string;
}

export type SensorMessage = SensorHelloMessage | SensorBatchMessage | SensorStatusMessage | SensorResetMessage;
export type BridgeMessage = BridgeHelloMessage | BridgePauseMessage | BridgeResumeMessage | BridgeStopMessage | BridgeResetMessage;
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

export interface BridgeSimpleControlMessage {
  schemaVersion: 1;
  type: 'bridge-control';
  command: Exclude<BridgeControlCommand, 'reset'>;
}

/** ADR-073: privileged only in the SW → exact-document ISOLATED direction. MAIN receives no privileged command. */
export interface BridgeResetControlMessage {
  schemaVersion: 1;
  type: 'bridge-control';
  command: 'reset';
  resetId: string;
}
export type BridgeControlMessage = BridgeSimpleControlMessage | BridgeResetControlMessage;

/** Native ISOLATED → SW reset acknowledgement: routing IDs only, the fresh epoch and its new boots. */
export interface BridgeResetAck {
  schemaVersion: 1;
  type: 'bridge-reset-ack';
  resetId: string;
  bridgeSessionId: string;
  sensorBootIds: string[];
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

export type UiRequest =
  | UiGetReportRequest
  | UiPauseRequest
  | UiResumeRequest
  | UiClearRequest
  | UiSetScopeRequest
  | UiExportPreviewRequest
  | UiGetScopeRequest
  | UiInjectNowRequest
  | UiClearSessionRequest;
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
  /** Managed policy restricts or defines the scope. */
  managed: boolean;
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
  permissionChecks?: PermissionCheck[];
  apiOperations?: ApiOperationSummary[];
  requestedLocalPorts?: RequestedLocalPorts;
  extensionResources?: ExtensionResourceSummary[];
  responseHeaders?: ResponseHeadersSummary;
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

export type UiResponse =
  | UiReportResponse
  | UiOkResponse
  | UiScopeResponse
  | UiExportPreviewResponse
  | UiErrorResponse;
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
  /** Derived from individual DET-039 counters, never from the flattened technique signal union. */
  permissionChecks?: PermissionCheck[];
  apiOperations?: ApiOperationSummary[];
  requestedLocalPorts?: RequestedLocalPorts;
  extensionResources?: ExtensionResourceSummary[];
  responseHeaders?: ResponseHeadersSummary;
}

// ---------------------------------------------------------------------------
// Stored document model (storage.session; the SW is the only writer). One report per documentId.
// ---------------------------------------------------------------------------

export interface CounterEntry {
  techniqueId: TechniqueId;
  apiOperation?: ApiOperation;
  extensionResource?: ExtensionResource;
  phase: Phase;
  /** Sorted, unique. */
  signalCodes: SignalCode[];
  /** Saturating; merge takes the max of redelivered totals, never the sum. */
  count: number;
  countQuality: CountQuality;
  firstBucket: number;
  lastBucket: number;
}

/** Browser-observed network host (webRequest). Host only; never a full URL. */
export interface HostEntry {
  registrableDomain?: string;
  category?: 'loopback' | 'link-local' | 'private' | 'ULA' | 'public' | 'localhost' | 'local' | 'single-label' | 'unknown';
  relation: 'same-origin' | 'same-site' | 'cross-site' | 'opaque' | 'unknown';
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
  /** Keyed by counterKey(techniqueId, phase, signalCodes); at most BUDGETS.maxCountersPerDocumentGroup. */
  counters: CounterEntry[];
  /** At most BUDGETS.maxFindingsPerDocument. */
  findings: Finding[];
  /** At most BUDGETS.maxHostsPerDocument. */
  hosts: HostEntry[];
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

/** Stable counter key: techniqueId + phase + sorted signal codes. */
export function counterKey(techniqueId: TechniqueId, phase: Phase, signalCodes: readonly SignalCode[], apiOperation?: ApiOperation, extensionResource?: ExtensionResource): string {
  const legacy = techniqueId + '|' + phase + '|' + [...signalCodes].sort().join(',');
  if (extensionResource !== undefined) return legacy + '|extension|' + extensionResource.target + '|' + extensionResource.method;
  return apiOperation === undefined ? legacy : legacy + '|' + apiOperation;
}

/** Document key from trusted sender/navigation ids only. */
export function makeDocumentKey(tabId: number, frameId: number, documentId: string): string {
  return String(tabId) + ':' + String(frameId) + ':' + documentId;
}
