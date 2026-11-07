// ADR-020 «Защита» (opt-in module, OFF by default): the single source of the module's names, budgets, DNR id ranges
// and core wire types (ISOLATED <-> SW, SW -> UI). Observation contracts (PageBatch, Ack, ReportProjection, ExportReport,
// COVERAGE_FLAGS, SENSOR_IDS) do not change. Changing a name or a number here = a new revision of ADR-020.
// No wire type of the module carries a value, a hash, a mask, a URL or a query, with one exception: `protect-input`
// (ISOLATED -> SW only) carries keyed fingerprints `{enc, len, h}` of value variants (ADR-020 §4, REQ-005 revision).

import type {
  AttributionConfidence,
  CountQuality,
  CoverageState,
  EvidenceSource,
  HostCategory,
  Integrity,
  SiteRelation,
} from './enums';
import type { VendorSummary } from './messages';
import type { FirewallTabView } from './protect-firewall';
import type { RegistrationSampleWire, SendSampleWire } from './protect-main';

// ---------------------------------------------------------------------------
// Module model (ADR-020 §3, §6)
// ---------------------------------------------------------------------------

/** Version of the consent screen; a change moves the module to `needs-consent` (data kept, listeners and rules removed). */
export const PROTECT_CONSENT_VERSION = 1 as const;

export const PROTECT_FEATURES = ['value-match', 'firewall', 'session-replay', 'history', 'gpc'] as const;
export type ProtectFeature = (typeof PROTECT_FEATURES)[number];

/** Features that need the optional declarativeNetRequestWithHostAccess permission. */
export const PROTECT_DNR_FEATURES = ['firewall', 'gpc'] as const satisfies readonly ProtectFeature[];
export type ProtectDnrFeature = (typeof PROTECT_DNR_FEATURES)[number];

/** Priority: organization-disabled > off > needs-consent > needs-permission > degraded > active (ADR-020 §3). */
export const PROTECT_MODULE_STATES = ['off', 'active', 'needs-consent', 'needs-permission', 'organization-disabled', 'degraded'] as const;
export type ProtectModuleState = (typeof PROTECT_MODULE_STATES)[number];

/** `normal` is the default; `strict` only by an explicit choice (site-level auto rules, daily limits). */
export const PROTECT_PRESETS = ['strict', 'normal', 'warn-only'] as const;
export type ProtectPreset = (typeof PROTECT_PRESETS)[number];

/** MAIN hook groups of the protect prelude mask; the bit of a group is `1 << index` (protect-on.<group>.js). */
export const PROTECT_MAIN_GROUPS = ['send', 'listen'] as const;
export type ProtectMainGroup = (typeof PROTECT_MAIN_GROUPS)[number];

/** Bit of `group` in the prelude mask, or 0 for an unknown group. */
export function protectGroupBit(group: ProtectMainGroup): number {
  const i = PROTECT_MAIN_GROUPS.indexOf(group);
  return i < 0 ? 0 : 1 << i;
}

/** What an evidence record is about. Only `value-match` / `opaque-after-input` describe a request. */
export const PROTECT_KINDS = ['value-match', 'opaque-after-input', 'password-field-listener', 'replay-pattern'] as const;
export type ProtectKind = (typeof PROTECT_KINDS)[number];

/** Field types whose value may be read (ISOLATED, field-value.ts only). There is no `password` by construction. */
export const FIELD_KINDS = ['email', 'phone', 'name'] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

/** Field classes that no layer ever reads (checked before the kind). */
export const NEVER_READ_CLASSES = ['password', 'was-password', 'payment', 'one-time-code', 'credential-hint'] as const;
export type NeverReadClass = (typeof NEVER_READ_CLASSES)[number];

export const VALUE_ENCODINGS = [
  'plain',
  'plain-normalized',
  'url-encoded',
  'base64',
  'in-base64-container',
  'md5-hex',
  'sha1-hex',
  'sha256-hex',
  'sha512-hex',
  'md5-base64',
  'sha1-base64',
  'sha256-base64',
  'sha512-base64',
] as const;
export type ValueEncoding = (typeof VALUE_ENCODINGS)[number];

/** Encodings of a fingerprint entry: VALUE_ENCODINGS without `in-base64-container` (found by the SW decoder only). */
export const FINGERPRINT_ENCODINGS = [
  'plain',
  'plain-normalized',
  'url-encoded',
  'base64',
  'md5-hex',
  'sha1-hex',
  'sha256-hex',
  'sha512-hex',
  'md5-base64',
  'sha1-base64',
  'sha256-base64',
  'sha512-base64',
] as const satisfies readonly Exclude<ValueEncoding, 'in-base64-container'>[];
export type FingerprintEncoding = (typeof FINGERPRINT_ENCODINGS)[number];

export const VALUE_LOCATIONS = ['query', 'path', 'body-form', 'body-json', 'body-text', 'body-opaque'] as const;
export type ValueLocation = (typeof VALUE_LOCATIONS)[number];

export const TRANSFER_CLASSES = [
  'third-party-before-submit',
  'third-party-at-submit',
  'third-party-moment-unknown',
  'first-party-before-submit',
  'receiver-unknown',
  'opaque-after-input',
] as const;
export type TransferClass = (typeof TRANSFER_CLASSES)[number];

export const SUBMIT_TIMINGS = ['before-submit', 'after-submit', 'unknown'] as const;
export type SubmitTiming = (typeof SUBMIT_TIMINGS)[number];

/** How a submit boundary was observed in the document (trusted events only; coordinates and text are never read). */
export const SUBMIT_SIGNALS = ['none', 'submit-event', 'submit-control'] as const;
export type SubmitSignal = (typeof SUBMIT_SIGNALS)[number];

/** Time from the value change to the request, as a bucket; `before-value` = matched in the token ring. */
export const SINCE_INPUT = ['before-value', 'lt-1s', '1-5s', '5-30s', 'gt-30s'] as const;
export type SinceInput = (typeof SINCE_INPUT)[number];

/**
 * ADR-020 §11: `sent` = webRequest.onSendHeaders; `stopped` = ERR_BLOCKED_BY_CLIENT and our block rule was active at
 * least ruleActivationSlackMs before the request; `stopped-other` = ERR_BLOCKED_BY_CLIENT otherwise; `unknown` = the rest.
 */
export const DELIVERY_STATES = ['sent', 'stopped', 'stopped-other', 'unknown'] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

/** webRequest type classes (SP-14: fetch and XHR are `xmlhttprequest`, sendBeacon is `ping`). */
export const PROTECT_REQUEST_KINDS = ['navigation', 'frame', 'xhr', 'beacon', 'image', 'script', 'other'] as const;
export type ProtectRequestKind = (typeof PROTECT_REQUEST_KINDS)[number];

export const PROTECT_HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OTHER'] as const;
export type ProtectHttpMethod = (typeof PROTECT_HTTP_METHODS)[number];

export const FRAME_CONTEXTS = ['top', 'same-site-frame', 'cross-site-frame'] as const;
export type FrameContext = (typeof FRAME_CONTEXTS)[number];

/** Rule ids of the module's derived records (engine rules; `calibrated:false` thresholds). */
export const PROTECT_RULE_IDS = ['form-leak', 'password-listener', 'session-replay-behavior'] as const;
export type ProtectRuleId = (typeof PROTECT_RULE_IDS)[number];

/** Module limitation codes (not COVERAGE_FLAGS: the coverageRef bit layout of the observation report stays as is). */
export const PROTECT_LIMITATIONS = [
  // Bodies and values
  'body-unavailable',
  'body-truncated',
  'body-opaque',
  'body-had-credential-fields',
  'values-reset',
  'values-suspended-payment',
  'never-read-fields',
  'value-from-page-dom',
  'value-from-previous-document',
  'matched-in-recent-request',
  'submit-moment-unknown',
  'receiver-hosts-form-frame',
  'name-plaintext-ambiguous',
  'party-by-registrable-domain',
  'late-start',
  'network-limited',
  'site-excluded',
  'outcome-not-observed',
  'budget-exceeded',
  // Firewall
  'blocking-unavailable',
  'rule-not-applied',
  'iframe-rule-gap',
  // Attribution
  'stack-unavailable',
  'stack-budget',
  'target-unread',
  'correlation-ambiguous',
  'correlation-gap',
  'correlation-saturated',
  'no-call-sample',
  'nearest-frame-only',
  'no-script-attribution',
  // Session recording
  'element-listeners-not-observed',
  'listener-hook-off',
  'mo-hook-off',
  'mo-options-not-read',
  'body-size-not-observed',
  'websocket-not-observed',
  'worker-requests-may-be-missed',
  'loaded-before-enable',
  'cadence-reset',
  'periodic-hosts-truncated',
  'vendor-rules-disabled',
  'masking-not-verifiable',
  'first-party-endpoints-not-assessed',
  'uncalibrated-threshold',
  // History
  'scope-not-all-sites',
  'attribution-frame-only',
  'history-truncated',
  'storage-unavailable',
  'storage-reset',
] as const;
export type ProtectLimitation = (typeof PROTECT_LIMITATIONS)[number];

/** Retention of the «Кто вас узнаёт» history (days); the default is 30. */
export const HISTORY_RETENTION_DAYS = [7, 30, 90] as const;
export type HistoryRetentionDays = (typeof HISTORY_RETENTION_DAYS)[number];

/** `ui-protect-purge` targets (module data only; observation reports are not affected). */
export const PROTECT_PURGE_TARGETS = ['history', 'decisions', 'requests', 'all'] as const;
export type ProtectPurgeTarget = (typeof PROTECT_PURGE_TARGETS)[number];

/** `ui-protect-snooze`: 0 ends the snooze, 60 = «Не беспокоить 1 час» (PROTECT_BUDGETS.snoozeMs). */
export const PROTECT_SNOOZE_MINUTES = [0, 60] as const;
export type ProtectSnoozeMinutes = (typeof PROTECT_SNOOZE_MINUTES)[number];

// ---------------------------------------------------------------------------
// Budgets (ADR-020 §13). Changing a number = a revision of ADR-020. Exceeding a budget degrades explicitly.
// ---------------------------------------------------------------------------

export const PROTECT_BUDGETS = {
  // Fields and values (ISOLATED)
  maxTrackedFieldsPerDocument: 8,
  minValueChars: 3,
  plaintextMinChars: 6,
  maxValueChars: { email: 254, phone: 32, name: 128 },
  maxVariantsPerField: 64,
  maxFieldsPerInputMessage: 4,
  maxInputMessageBytes: 16384,
  // Fingerprints and arming (SW memory)
  maxFingerprintDocuments: 32,
  fingerprintIdleTtlMs: 900000,
  crossSiteGraceMs: 60000,
  submitCarryMs: 60000,
  maxArmedTabs: 8,
  armTtlMs: 900000,
  armThrottleMs: 10000,
  inputDebounceMs: 300,
  // Request bodies (SW memory)
  maxScannedBodyBytes: 65536,
  maxUrlChars: 8192,
  maxFormDataEntries: 256,
  maxJsonNodes: 4096,
  maxJsonDepth: 8,
  maxBase64Containers: 16,
  maxBase64ContainerChars: 65536,
  maxTokensPerRequest: 32768,
  // Token ring
  ringWindowMs: 10000,
  ringMaxPerTab: 32,
  ringMaxTokensPerEntry: 4096,
  ringMaxEntriesGlobal: 256,
  opaqueWindowMs: 2000,
  // Evidence and storage.session
  maxEvidencePerDocument: 64,
  maxProtectDocBytes: 16384,
  maxProtectSessionBytes: 1048576,
  maxParamNameChars: 48,
  maxPathTemplateChars: 160,
  maxEndpointPathSegments: 4,
  // Outcomes and prompts
  maxPendingOutcomes: 512,
  outcomeTtlMs: 30000,
  maxPromptReceivers: 8,
  maxPendingPrompts: 32,
  maxNoticesPerTab: 8,
  maxUndoEntries: 16,
  undoTtlMs: 600000,
  // Firewall
  maxExcludedSites: 256,
  maxDecisions: 1000,
  maxPresetEntries: 24,
  maxDynamicRules: 1024,
  maxSessionRules: 128,
  maxStrictAutoPerSitePerDay: 8,
  maxStrictAutoPerDay: 64,
  ruleActivationSlackMs: 50,
  maxStatDays: 7,
  statsFlushMs: 5000,
  snoozeMs: 3600000,
  // Page message rate (token buckets in the SW)
  protectMessagesPerSecond: { document: 8, tab: 32, global: 100 },
  // MAIN hooks
  sampleWindowMs: 1000,
  sendSamplesPerWindow: 16,
  registrationSamplesPerWindow: 8,
  maxStackScanChars: 4096,
  maxStackScanLines: 10,
  maxItemsPerBatch: 32,
  flushMs: 250,
  startupQueueItems: 32,
  maxRegistrationKeysPerRealm: 64,
  maxScriptPathTemplateChars: 96,
  maxScriptPathSegments: 4,
  maxSampleAgeMs: 5000,
  // Correlation (SW)
  correlationLeadMs: 250,
  correlationLagMs: 1000,
  correlationImageLagMs: 2000,
  correlationAmbiguityMs: 150,
  attributionWaitMs: 2000,
  maxPendingSendsPerDocument: 64,
  maxCorrelationDocuments: 32,
  maxScriptActivityPerDocument: 32,
  // Session recording
  maxReplayPeriodicHosts: 8,
  replayCadenceDocuments: 32,
  replayCadenceDomainsPerDocument: 16,
  replayRunMaxCeiling: 1000,
  maxReplayVendors: 4,
  // History
  historyMaskDays: 90,
  historyRetentionDays: HISTORY_RETENTION_DAYS,
  defaultHistoryRetentionDays: 30,
  maxSightings: 16384,
  maxHistoryReceivers: 2048,
  maxHistorySites: 2048,
  maxRuleIdsPerSighting: 8,
  maxPendingDeltas: 1024,
  historyFlushMs: 5000,
  maxRowsPerPage: 50,
  maxCardSites: 200,
  maxExportBytes: 4194304,
  foldMemoDocuments: 256,
  purgeChunk: 512,
  // Request journal
  maxRequests: 100,
  maxFactsPerRequest: 8,
  maxHistoryPerRequest: 12,
  maxRecordChars: 8192,
  maxJournalChars: 524288,
  preparedTtlDays: 30,
  closedTtlDays: 365,
  maxAgeDays: 730,
  dueSoonDays: 3,
  // GPC
  maxGpcTabs: 64,
  maxGpcHeaderScan: 128,
} as const;
export type ProtectBudgets = typeof PROTECT_BUDGETS;

/**
 * Structural caps of the module's wire and projection shapes (ADR-020 §9, S02 brief). Not tunable budgets: they bound
 * arrays so that validators never serialize to measure.
 */
export const PROTECT_WIRE_LIMITS = {
  maxFeatures: PROTECT_FEATURES.length,
  maxDegradedReasons: 8,
  maxProjectionLimitations: 16,
  maxEvidenceLimitations: 8,
  maxEvidenceEncodings: 4,
  maxEvidencePathSegment: 15,
  /** Seconds since the document's createdAt (firstSecond / lastSecond). */
  maxEvidenceSecond: 86400,
  maxEventLimitations: 8,
  maxNeverReadFields: 64,
  minFingerprintLen: 3,
  maxFingerprintLen: 1024,
  maxReplaySignals: 4,
  maxReplayLimitations: 20,
  maxFirewallReceivers: 16,
  maxOnceRules: 16,
  maxRulesOffset: 1000,
  maxRulesPageSize: 200,
  maxRemoveRuleKeys: 200,
  maxDomainFilterChars: 64,
  maxHistoryOffset: 16384,
  /** Domains of one history row (a vendor row may group several domains of an active catalog rule). */
  maxRowDomains: 32,
  maxTechniquesPerFact: 8,
  maxKindsPerRequest: 3,
  maxEntityNameChars: 128,
  maxEmailChars: 254,
  maxEmailLocalChars: 64,
  maxPortalUrlChars: 512,
  maxSubjects: 2,
  maxRecipientCandidates: 8,
} as const;

// ---------------------------------------------------------------------------
// DNR (ADR-020 §C). Our id ranges and priorities; dnr-guard (engine) checks every rule against them.
// ---------------------------------------------------------------------------

export const DNR_RULE_IDS = {
  gpc: [1, 99],
  decisions: [100000, 100999],
  preset: [101000, 101023],
  session: [200000, 200127],
} as const;
export type DnrRangeName = keyof typeof DNR_RULE_IDS;

export const DNR_PRIORITIES = {
  receiverBlock: 10,
  presetBlock: 10,
  receiverAllow: 20,
  siteBlock: 30,
  siteAllow: 40,
  once: 50,
  gpc: 100,
} as const;
export type DnrPriorityName = keyof typeof DNR_PRIORITIES;

export const DNR_RANGE_NAMES = ['gpc', 'decisions', 'preset', 'session'] as const satisfies readonly DnrRangeName[];

/** Our range that contains `id`, or null (a rule id outside the module's ranges). */
export function dnrRangeOf(id: number): DnrRangeName | null {
  for (const name of DNR_RANGE_NAMES) {
    const [lo, hi] = DNR_RULE_IDS[name];
    if (id >= lo && id <= hi) return name;
  }
  return null;
}

// Load-time invariants: Sec-GPC (modifyHeaders) must win over every allow rule (an allow rule with a higher priority
// would drop the header); ranges are disjoint and sized to the module budgets.
if (!(DNR_PRIORITIES.gpc > Math.max(DNR_PRIORITIES.receiverAllow, DNR_PRIORITIES.siteAllow, DNR_PRIORITIES.once))) {
  throw new Error('protect: DNR gpc priority must exceed every allow priority');
}
if (
  DNR_RULE_IDS.decisions[1] - DNR_RULE_IDS.decisions[0] + 1 !== PROTECT_BUDGETS.maxDecisions ||
  DNR_RULE_IDS.preset[1] - DNR_RULE_IDS.preset[0] + 1 !== PROTECT_BUDGETS.maxPresetEntries ||
  DNR_RULE_IDS.session[1] - DNR_RULE_IDS.session[0] + 1 !== PROTECT_BUDGETS.maxSessionRules ||
  !(DNR_RULE_IDS.gpc[1] < DNR_RULE_IDS.decisions[0] && DNR_RULE_IDS.decisions[1] < DNR_RULE_IDS.preset[0] && DNR_RULE_IDS.preset[1] < DNR_RULE_IDS.session[0])
) {
  throw new Error('protect: DNR id ranges must be disjoint and match the module budgets');
}

// ---------------------------------------------------------------------------
// Formats shared by validators, schemas and producers. Hosts are ASCII lowercase (punycode); no URL ever crosses.
// ---------------------------------------------------------------------------

export const EVIDENCE_ID_PATTERN = /^pe-[0-9a-z]{1,12}$/;
export const PARAM_NAME_PATTERN = /^[A-Za-z0-9_.[\]-]{1,48}$/;
export const PROMPT_ID_PATTERN = /^[0-9a-f]{16}$/;
export const UNDO_ID_PATTERN = /^[0-9a-f]{16}$/;
export const SALT_ID_PATTERN = /^[A-Za-z0-9_-]{8,16}$/;
/** 16 random bytes, base64url without padding. */
export const SALT_PATTERN = /^[A-Za-z0-9_-]{22}$/;
export const FINGERPRINT_HASH_PATTERN = /^[0-9a-f]{13}$/;
/** Rule versions of the module's engine rules ('1', '1.2', ...). */
export const PROTECT_RULE_VERSION_PATTERN = /^[0-9]{1,4}(?:\.[0-9]{1,4}){0,2}$/;

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const HAS_LETTER_RE = /[a-z]/;

/**
 * A DNS name of at least two labels whose last label contains a letter (so never an IP literal): registrable domains
 * of receivers, frame and initiator sites, history domains.
 */
export function isDomainName(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 3 || value.length > 253) return false;
  const labels = value.split('.');
  if (labels.length < 2) return false;
  for (const label of labels) if (!LABEL_RE.test(label)) return false;
  return HAS_LETTER_RE.test(labels[labels.length - 1]!);
}

/** A site name: a DNS name (one label allowed, e.g. localhost) or an IPv4 literal; never IPv6, port or path. */
export function isSiteName(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 253) return false;
  for (const label of value.split('.')) if (!LABEL_RE.test(label)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// ScriptRef (ADR-020 §F): the masked identity of a page script. Page-controlled (sampled stack), never a URL.
// ---------------------------------------------------------------------------

export const SCRIPT_REF_KINDS = ['external', 'document', 'eval', 'opaque', 'extension', 'unknown'] as const;
export type ScriptRefKind = (typeof SCRIPT_REF_KINDS)[number];

/**
 * `scheme`, `host` and `pathTemplate` are present exactly when `kind === 'external'`. `host` is a masked host
 * (random-looking labels replaced by `*`), `pathTemplate` a safe template (templateScriptPath): no query, fragment,
 * userinfo or port.
 */
export interface ScriptRef {
  kind: ScriptRefKind;
  scheme?: 'http' | 'https';
  host?: string;
  pathTemplate?: string;
}

const MASKED_LABEL_RE = /^(?:\*|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/;

/** Masked script / send-target host: >= 2 labels of [a-z0-9-] or `*`, the last one a real label with a letter. */
export function isScriptHost(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 3 || value.length > 253) return false;
  const labels = value.split('.');
  if (labels.length < 2) return false;
  for (const label of labels) if (!MASKED_LABEL_RE.test(label)) return false;
  const last = labels[labels.length - 1]!;
  return last !== '*' && HAS_LETTER_RE.test(last);
}

const SKIP_TOKEN = ':skip';
const ID_TOKEN = ':id';
const X_TOKEN = ':x';
const MAX_SCRIPT_SEGMENT_CHARS = 40;
const MAX_LITERAL_WORD_CHARS = 32;

function isDigitCode(c: number): boolean {
  return c >= 48 && c <= 57;
}

function isAlnumCode(c: number): boolean {
  return isDigitCode(c) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

function isHexLetterCode(c: number): boolean {
  return (c >= 97 && c <= 102) || (c >= 65 && c <= 70);
}

/** `.`, `-`, `_`, `~` separate the words of a segment and are kept literally. */
function isWordDelimiter(c: number): boolean {
  return c === 46 || c === 45 || c === 95 || c === 126;
}

/** One word: kept when it is a short literal; ID-like runs become `:id`; anything with other characters `:x`. */
function templateWord(word: string): string {
  if (word.length === 0 || word === ID_TOKEN || word === X_TOKEN) return word;
  let digits = 0;
  let letters = 0;
  let run = 0;
  let maxRun = 0;
  let hexOnly = true;
  for (let i = 0; i < word.length; i++) {
    const c = word.charCodeAt(i);
    if (!isAlnumCode(c)) return X_TOKEN;
    if (isDigitCode(c)) {
      digits++;
      run++;
      if (run > maxRun) maxRun = run;
    } else {
      letters++;
      run = 0;
      if (!isHexLetterCode(c)) hexOnly = false;
    }
  }
  if (maxRun >= 4) return ID_TOKEN;
  if (hexOnly && digits > 0 && word.length >= 8) return ID_TOKEN;
  // Random-looking word: same thresholds as random host labels (network-observed.v1.json).
  if (word.length >= 12 && digits >= 2 && letters >= 2) return ID_TOKEN;
  if (word.length > MAX_LITERAL_WORD_CHARS) return ID_TOKEN;
  return word;
}

function templateSegment(segment: string): string {
  let out = '';
  let start = 0;
  for (let i = 0; i <= segment.length; i++) {
    if (i === segment.length || isWordDelimiter(segment.charCodeAt(i))) {
      out += templateWord(segment.slice(start, i));
      if (i < segment.length) out += segment[i];
      start = i + 1;
    }
  }
  return out.length > MAX_SCRIPT_SEGMENT_CHARS ? X_TOKEN : out;
}

/**
 * Safe template of a script path (no query or fragment; the caller strips them): the last segments only (more than
 * PROTECT_BUDGETS.maxScriptPathSegments → a leading `:skip`), ID-like words → `:id`, other characters → `:x`, at most
 * PROTECT_BUDGETS.maxScriptPathTemplateChars. Idempotent: templateScriptPath(t) === t for every valid template t.
 */
export function templateScriptPath(path: string): string {
  const maxSegments = PROTECT_BUDGETS.maxScriptPathSegments;
  // Collect up to maxSegments + 1 non-empty segments from the end (enough to know whether a prefix was cut).
  const reversed: string[] = [];
  let end = path.length;
  let cut = false;
  for (let i = path.length - 1; i >= -1; i--) {
    if (i === -1 || path.charCodeAt(i) === 47) {
      if (end - i - 1 > 0) {
        if (reversed.length === maxSegments) {
          cut = true;
          break;
        }
        reversed.push(path.slice(i + 1, end));
      }
      end = i;
    }
  }
  const raw = reversed.reverse();
  let skip = cut;
  // A template that already starts with `:skip` keeps it (idempotence); `:skip` anywhere else is not a token.
  if (!skip && raw.length >= 2 && raw[0] === SKIP_TOKEN) {
    skip = true;
    raw.shift();
  }
  let segments = raw.map(templateSegment);
  if (cut) segments = segments.slice(segments.length - (maxSegments - 1));
  const build = (): string => '/' + (skip ? [SKIP_TOKEN, ...segments] : segments).join('/');
  let out = build();
  while (out.length > PROTECT_BUDGETS.maxScriptPathTemplateChars && segments.length > 1) {
    segments = segments.slice(1);
    skip = true;
    out = build();
  }
  return out;
}

const SCRIPT_PATH_CHARS_RE = /^\/[A-Za-z0-9._~:/-]*$/;

/** Valid script path template: allowed characters, at most four segments, and a fixed point of templateScriptPath. */
export function isScriptPathTemplate(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > PROTECT_BUDGETS.maxScriptPathTemplateChars) return false;
  if (!SCRIPT_PATH_CHARS_RE.test(value)) return false;
  return templateScriptPath(value) === value;
}

/**
 * Endpoint path template of a request (ProtectEvidence.endpointPathTemplate, RequestEvidenceFact.endpoint): `/`, then
 * at most PROTECT_BUDGETS.maxEndpointPathSegments literal or `:id` segments and an optional `/…` tail. Never a query.
 */
export const ENDPOINT_PATH_TEMPLATE_PATTERN = /^\/(?:(?:[A-Za-z0-9._~-]{1,40}|:id)(?:\/(?:[A-Za-z0-9._~-]{1,40}|:id)){0,3}(?:\/…)?)?$/;

export function isEndpointPathTemplate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= PROTECT_BUDGETS.maxPathTemplateChars &&
    ENDPOINT_PATH_TEMPLATE_PATTERN.test(value)
  );
}

// ---------------------------------------------------------------------------
// Module state (SW -> UI)
// ---------------------------------------------------------------------------

export interface ProtectState {
  state: ProtectModuleState;
  /** Consent version the user accepted; null when never accepted. */
  consentVersion: number | null;
  requiredConsentVersion: number;
  /** Enabled features, PROTECT_FEATURES order. */
  features: ProtectFeature[];
  preset: ProtectPreset;
  /** Epoch ms until which prompts are snoozed (≤ now + snoozeMs), or null. */
  snoozedUntil: number | null;
  /** Excluded sites (site names), at most PROTECT_BUDGETS.maxExcludedSites. */
  excludedSites: string[];
  historyRetentionDays: HistoryRetentionDays;
  /** History volume indicator; null while the history feature is off. */
  history: { records: number; truncated: boolean } | null;
  /** Number of stored firewall decisions. */
  decisions: number;
  permissions: { broadHosts: boolean; dnr: boolean };
  organizationDisabled: boolean;
  /** The managed ProtectModuleDisabled value is invalid (fail-closed: treated as disabled). */
  organizationPolicyInvalid: boolean;
  /** At most PROTECT_WIRE_LIMITS.maxDegradedReasons. */
  degradedReasons: ProtectLimitation[];
}

// ---------------------------------------------------------------------------
// Evidence (stored in storage.session `protect-doc:*`, ≤ maxEvidencePerDocument per document). Derived, value-free.
// ---------------------------------------------------------------------------

interface ProtectEvidenceBase {
  /** EVIDENCE_ID_PATTERN; assigned by the SW, unique within the SW lifetime. */
  evidenceId: string;
  frameContext: FrameContext;
  /** Registrable domain of the frame (sub-frames only). */
  frameSite?: string;
  /** Masked script identity from a stack sample (page-controlled); only with attributionConfidence 'sampled-stack'. */
  script?: ScriptRef;
  attributionConfidence: AttributionConfidence;
  count: number;
  countQuality: CountQuality;
  /** Seconds since the document's createdAt, 0..PROTECT_WIRE_LIMITS.maxEvidenceSecond. */
  firstSecond: number;
  lastSecond: number;
  evidenceSource: 'derived';
  integrity: 'derived';
  ruleVersion: string;
  /** At most PROTECT_WIRE_LIMITS.maxEvidenceLimitations. */
  limitationCodes: ProtectLimitation[];
}

/**
 * The keyed fingerprint of a typed value was found in an outgoing request (`value-match`), or a request with an
 * unreadable body followed the input (`opaque-after-input`). Always an already started send (ADR-020 §11). No value,
 * hash, mask, value length, URL or query: only enums, a parameter name, hosts and a path template.
 */
export interface ProtectTransferEvidence extends ProtectEvidenceBase {
  protectKind: 'value-match' | 'opaque-after-input';
  ruleId: 'form-leak';
  transferClass: TransferClass;
  fieldKind: FieldKind;
  /** 1..PROTECT_BUDGETS.maxTrackedFieldsPerDocument; absent for a value from a previous document. */
  fieldRef?: number;
  /** value-match: 1..4 encodings; opaque-after-input: [] (the body cannot be read). */
  encodings: ValueEncoding[];
  location?: ValueLocation;
  /** PARAM_NAME_PATTERN; a key name, never its value. */
  paramName?: string;
  /** 0..PROTECT_WIRE_LIMITS.maxEvidencePathSegment; only with location 'path'. */
  pathSegment?: number;
  /** Exactly one of receiver (PSL registrable domain) and receiverCategory. */
  receiver?: string;
  receiverCategory?: HostCategory;
  /** Relation of the receiver to the top-level site. */
  relation: SiteRelation;
  method: ProtectHttpMethod;
  requestKind: ProtectRequestKind;
  /** Request host with random labels folded into the registrable domain; null without a DNS name. */
  endpointHost: string | null;
  /** ENDPOINT_PATH_TEMPLATE_PATTERN, ≤ maxPathTemplateChars, no query. */
  endpointPathTemplate: string;
  /** Registrable domain of the browser-reported initiator. */
  initiatorSite?: string;
  submitTiming: SubmitTiming;
  sinceInput?: SinceInput;
  deliveryState: DeliveryState;
  interpretationConfidence: 'low' | 'medium' | 'high';
}

/** A page script registered an input listener on a password field (registration only; the value is never read). */
export interface ProtectListenerEvidence extends ProtectEvidenceBase {
  protectKind: 'password-field-listener';
  ruleId: 'password-listener';
  interpretationConfidence: 'low';
}

/** Session recording behaviour towards a receiver (published for the history; the level lives in ReplaySummary). */
export interface ProtectReplayEvidence extends ProtectEvidenceBase {
  protectKind: 'replay-pattern';
  ruleId: 'session-replay-behavior';
  /** PSL registrable domain of the periodic receiver. */
  receiver: string;
  relation: SiteRelation;
  interpretationConfidence: 'low' | 'medium';
}

export type ProtectEvidence = ProtectTransferEvidence | ProtectListenerEvidence | ProtectReplayEvidence;

// ---------------------------------------------------------------------------
// Session recording summary (ADR-020 §E). `high` is never set.
// ---------------------------------------------------------------------------

export const REPLAY_LEVELS = ['none', 'signals-only', 'replay-like', 'replay-recording'] as const;
export type ReplayLevel = (typeof REPLAY_LEVELS)[number];

export const REPLAY_SIGNAL_CODES = ['root-input-listeners', 'root-mutation-observe', 'periodic-third-party-send', 'replay-vendor-resource'] as const;
export type ReplaySignalCode = (typeof REPLAY_SIGNAL_CODES)[number];

export const REPLAY_BODY_SIZES = ['not-observed', 'empty', 'under-1k', '1k-16k', 'over-16k'] as const;
export type ReplayBodySize = (typeof REPLAY_BODY_SIZES)[number];

export const REPLAY_INPUT_MASKING = ['unconfirmed', 'value-seen-in-traffic'] as const;
export type ReplayInputMasking = (typeof REPLAY_INPUT_MASKING)[number];

export interface ReplaySignal {
  code: ReplaySignalCode;
  /** Label only (root-input-listeners); the observation report does not change. */
  techniqueId?: 'DET-043';
  evidenceSource: EvidenceSource;
  integrity: Integrity;
  count: number;
  countQuality: CountQuality;
  /** Registrable domain the signal is linked to (periodic receiver or attributed script site). */
  linkedSite?: string;
}

export interface ReplayPeriodicHost {
  registrableDomain: string;
  /** Longest run of periodic sends, 0..PROTECT_BUDGETS.replayRunMaxCeiling. */
  runMax: number;
  sends: number;
  largeInRunMax: number;
  bodySize: ReplayBodySize;
}

export interface ReplaySummary {
  ruleId: 'session-replay-behavior';
  ruleVersion: string;
  level: ReplayLevel;
  interpretationConfidence: 'unassessed' | 'low' | 'medium';
  attributionConfidence: AttributionConfidence;
  /** At most PROTECT_WIRE_LIMITS.maxReplaySignals. */
  signals: ReplaySignal[];
  /** At most PROTECT_BUDGETS.maxReplayPeriodicHosts. */
  periodicHosts: ReplayPeriodicHost[];
  /** Only enabled catalog rules (none in production, REQ-008); at most PROTECT_BUDGETS.maxReplayVendors. */
  vendors: VendorSummary[];
  inputMasking: ReplayInputMasking;
  /** At most PROTECT_WIRE_LIMITS.maxReplayLimitations. */
  limitationCodes: ProtectLimitation[];
}

// ---------------------------------------------------------------------------
// GPC tab fact (ADR-020 §H): what Chrome reported for this tab; never "the server received" or a compliance verdict.
// ---------------------------------------------------------------------------

export const GPC_SITE_STATES = ['on', 'excluded', 'off', 'no-access'] as const;
export type GpcSiteState = (typeof GPC_SITE_STATES)[number];

export const GPC_HEADER_EVIDENCE = ['observed', 'not-observed', 'not-applicable', 'unknown'] as const;
export type GpcHeaderEvidence = (typeof GPC_HEADER_EVIDENCE)[number];

export interface GpcTabFact {
  site: string | null;
  siteState: GpcSiteState;
  navigationHeader: GpcHeaderEvidence;
  /** Saturating counts of sub-requests with / without Sec-GPC: 1 while the header was expected. */
  requestsWithHeader: number;
  requestsWithoutHeader: number;
  countQuality: CountQuality;
  /** The registration covered the document at load (navigator.globalPrivacyControl set by the module). */
  propertyAtLoad: boolean;
  /** The site state changed after the document committed. */
  reloadNeeded: boolean;
  evidenceSource: 'browser-network';
  integrity: 'browser-observed';
}

// ---------------------------------------------------------------------------
// Projection (SW -> UI, ui-protect-get-report). Bound to protectRevision; observation's ReportProjection is separate.
// ---------------------------------------------------------------------------

export interface ProtectDropped {
  evidence: number;
  fingerprints: number;
  bodies: number;
  events: number;
}

export interface ProtectProjection {
  protectRevision: number;
  documentKey: string;
  /** Site name of the top-level document, or null. */
  site: string | null;
  moduleState: ProtectModuleState;
  features: ProtectFeature[];
  /** Canonical coverage state of the module for this document. */
  coverageState: CoverageState;
  /** At most PROTECT_WIRE_LIMITS.maxProjectionLimitations. */
  limitations: ProtectLimitation[];
  /** Current top-level document and its frames; at most PROTECT_BUDGETS.maxEvidencePerDocument. */
  evidence: ProtectEvidence[];
  /** Evidence of earlier documents of this tab (count only). */
  previousDocumentEvidence: number;
  firewall: FirewallTabView;
  replay: ReplaySummary | null;
  gpc: GpcTabFact | null;
  dropped: ProtectDropped;
}

// ---------------------------------------------------------------------------
// ISOLATED (protect.js) -> SW (chrome.runtime.sendMessage). tabId / frameId / documentId come from MessageSender only.
// ---------------------------------------------------------------------------

export interface ProtectHelloMessage {
  schemaVersion: 1;
  type: 'protect-hello';
  startedLate: boolean;
}

/** Focus on a tracked field: arm the request-body listener of the tab (throttled by armThrottleMs). */
export interface ProtectArmMessage {
  schemaVersion: 1;
  type: 'protect-arm';
  fieldKind: FieldKind;
}

export const FINGERPRINT_TRIGGERS = ['input', 'blur', 'submit', 'rekey'] as const;
export type FingerprintTrigger = (typeof FINGERPRINT_TRIGGERS)[number];

/** Keyed fingerprint of one value variant: encoding, variant length, 13-hex keyed hash. ISOLATED -> SW only. */
export interface ProtectFingerprintEntry {
  enc: FingerprintEncoding;
  len: number;
  h: string;
}

export interface ProtectFieldFingerprint {
  fieldRef: number;
  fieldKind: FieldKind;
  trigger: FingerprintTrigger;
  /** 1..PROTECT_BUDGETS.maxVariantsPerField entries. */
  entries: ProtectFingerprintEntry[];
}

export interface ProtectInputMessage {
  schemaVersion: 1;
  type: 'protect-input';
  /** Identifies the SW salt the fingerprints were keyed with (a stale salt is ignored and answered with rekey). */
  saltId: string;
  seq: number;
  /** 0..PROTECT_BUDGETS.maxFieldsPerInputMessage, unique fieldRef. */
  fields: ProtectFieldFingerprint[];
  submit: SubmitSignal;
  /** Saturating count of never-read fields seen in the document, 0..PROTECT_WIRE_LIMITS.maxNeverReadFields. */
  neverReadFields: number;
  paymentSuspended: boolean;
}

/** SendSampleWire with the page-clock time replaced by its age on the ISOLATED clock (SP-12: shared timeOrigin). */
export type SendSampleSw = Omit<SendSampleWire, 'tMs'> & { ageMs: number };
export type RegistrationSampleSw = Omit<RegistrationSampleWire, 'tMs'> & { ageMs: number };

export interface ProtectMainDropped {
  sends: number;
  registrations: number;
  unsampled: number;
}

/** Relay of MAIN samples (page-controlled) to the SW; at most PROTECT_BUDGETS.maxItemsPerBatch items together. */
export interface ProtectEventsMessage {
  schemaVersion: 1;
  type: 'protect-events';
  sensorBootId: string;
  relaySessionId: string;
  /** Monotonic per relay session, starts at 1. */
  batchSeq: number;
  sends: SendSampleSw[];
  registrations: RegistrationSampleSw[];
  dropped: ProtectMainDropped;
  /** At most PROTECT_WIRE_LIMITS.maxEventLimitations. */
  limitations: ProtectLimitation[];
}

export type ProtectPageMessage = ProtectHelloMessage | ProtectArmMessage | ProtectInputMessage | ProtectEventsMessage;
export type ProtectPageMessageType = ProtectPageMessage['type'];

/** SW answer to every protect page message. `saltId`/`salt` only while active and the value-match feature is on. */
export interface ProtectAck {
  schemaVersion: 1;
  type: 'protect-ack';
  active: boolean;
  saltId?: string;
  salt?: string;
  /** Mask of PROTECT_MAIN_GROUPS enabled for this document. */
  groups: number;
}

export const PROTECT_CONTROL_COMMANDS = ['stop', 'rekey', 'pause', 'resume'] as const;
export type ProtectControlCommand = (typeof PROTECT_CONTROL_COMMANDS)[number];

/** SW -> ISOLATED (chrome.tabs.sendMessage with documentId). The receiver verifies the sender is the SW. */
export interface ProtectControlMessage {
  schemaVersion: 1;
  type: 'protect-control';
  command: ProtectControlCommand;
}
