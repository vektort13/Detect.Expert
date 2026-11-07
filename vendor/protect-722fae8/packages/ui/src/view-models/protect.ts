// ADR-020 «Защита» (S06): pure view models of the module's UI foundation — the state parser of `protect-state`,
// the Options section, the consent screen, the permission request of the gesture, the Options tabs and the
// popup / side-panel status line. No chrome.*, returns message keys; components resolve them through i18n.
// Wording rules (docs/ui-copy.md §6.14): «передача», not «утечка»; no safety verdict; red only for product errors.

import {
  COVERAGE_STATES,
  HISTORY_RETENTION_DAYS,
  PROTECT_BUDGETS,
  PROTECT_DNR_FEATURES,
  PROTECT_FEATURES,
  PROTECT_LIMITATIONS,
  PROTECT_MODULE_STATES,
  PROTECT_PRESETS,
  PROTECT_WIRE_LIMITS,
  isSiteName,
} from '@detect-expert/contracts';
import type {
  CoverageState,
  HistoryRetentionDays,
  ProtectFeature,
  ProtectLimitation,
  ProtectModuleState,
  ProtectPreset,
  ProtectProjection,
  ProtectState,
} from '@detect-expert/contracts';
import type { Tone } from './coverage';
import { msg } from './message';
import type { Message } from './message';
import { ALL_SITES_ORIGINS, parseHostInput } from './scope';

/** The optional permission of the DNR features (firewall, gpc); requested only in the Options gesture. */
export const PROTECT_DNR_PERMISSION = 'declarativeNetRequestWithHostAccess' as const;

/** Consent screen defaults (S06 brief): value-match, firewall, session-replay on; history and gpc off; preset normal. */
export const PROTECT_DEFAULT_CONSENT_FEATURES: ReadonlyArray<ProtectFeature> = Object.freeze(['value-match', 'firewall', 'session-replay']);
export const PROTECT_DEFAULT_PRESET: ProtectPreset = 'normal';
/** «Выключить» deletes the module data unless the user unticks the box. */
export const PROTECT_DISABLE_PURGE_DEFAULT = true;

/** Options hashes that open the «Защита» tab (lanes anchor their sections under it). */
export const PROTECT_OPTIONS_HASHES = ['protect', 'firewall', 'history', 'requests'] as const;
export type ProtectOptionsHash = (typeof PROTECT_OPTIONS_HASHES)[number];
export const OPTIONS_TAB_IDS = ['observation', 'protect'] as const;
export type OptionsTabId = (typeof OPTIONS_TAB_IDS)[number];

export const PROTECT_STATE_KEYS: Readonly<Record<ProtectModuleState, string>> = {
  off: 'protect_state_off',
  active: 'protect_state_active',
  'needs-consent': 'protect_state_needs_consent',
  'needs-permission': 'protect_state_needs_permission',
  'organization-disabled': 'protect_state_organization_disabled',
  degraded: 'protect_state_degraded',
};

export const PROTECT_FEATURE_KEYS: Readonly<Record<ProtectFeature, string>> = {
  'value-match': 'protect_feature_value_match',
  firewall: 'protect_feature_firewall',
  'session-replay': 'protect_feature_session_replay',
  history: 'protect_feature_history',
  gpc: 'protect_feature_gpc',
};

export const PROTECT_PRESET_KEYS: Readonly<Record<ProtectPreset, string>> = {
  strict: 'protect_preset_strict',
  normal: 'protect_preset_normal',
  'warn-only': 'protect_preset_warn_only',
};

/** Coverage of the module for the shown document (ProtectProjection.coverageState). */
export const PROTECT_COVERAGE_KEYS: Readonly<Record<CoverageState, string>> = {
  active: 'protect_coverage_active',
  partial: 'protect_coverage_partial',
  'late-start': 'protect_coverage_late_start',
  paused: 'protect_coverage_paused',
  unsupported: 'protect_coverage_unsupported',
  'no-access': 'protect_coverage_no_access',
  degraded: 'protect_coverage_degraded',
};

/** degradedReasons with their own text; the rest use `protect_reason_other` with the code. */
export const PROTECT_REASON_KEYS: Readonly<Partial<Record<ProtectLimitation, string>>> = {
  'storage-unavailable': 'protect_reason_storage_unavailable',
  'outcome-not-observed': 'protect_reason_outcome_not_observed',
  'blocking-unavailable': 'protect_reason_blocking_unavailable',
};

// ---------------------------------------------------------------------------
// protect-state parser (the SW is trusted, but the UI reads only a well-formed state; anything else = unavailable)
// ---------------------------------------------------------------------------

const STATE_KEYS = new Set([
  'state', 'consentVersion', 'requiredConsentVersion', 'features', 'preset', 'snoozedUntil', 'excludedSites',
  'historyRetentionDays', 'history', 'decisions', 'permissions', 'organizationDisabled', 'organizationPolicyInvalid',
  'degradedReasons',
]);
const MODULE_STATE_SET: ReadonlySet<string> = new Set(PROTECT_MODULE_STATES);
const FEATURE_SET: ReadonlySet<string> = new Set(PROTECT_FEATURES);
const PRESET_SET: ReadonlySet<string> = new Set(PROTECT_PRESETS);
const LIMITATION_SET: ReadonlySet<string> = new Set(PROTECT_LIMITATIONS);
const RETENTION_SET: ReadonlySet<number> = new Set(HISTORY_RETENTION_DAYS);
const COVERAGE_SET: ReadonlySet<string> = new Set(COVERAGE_STATES);
const MAX_COUNT_VALUE = 2 ** 31 - 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_COUNT_VALUE;
}

function versionOrNull(value: unknown): number | null | undefined {
  if (value === null) return null;
  return isCount(value) ? value : undefined;
}

/** Unique members of `set`, in the order of `order`; null when the input is not an array, too long or has an unknown entry. */
function enumList<T extends string>(value: unknown, set: ReadonlySet<string>, order: ReadonlyArray<T>, max: number): T[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || !set.has(item)) return null;
    seen.add(item);
  }
  return order.filter((item) => seen.has(item));
}

/**
 * Strict reading of `UiProtectStateResponse.state`: exactly the contract keys, enums from the contract, bounded arrays.
 * Returns a normalized copy, or null (the caller treats null as «state unavailable», never as «off»).
 */
export function parseProtectState(value: unknown): ProtectState | null {
  if (!isRecord(value)) return null;
  for (const key of Object.keys(value)) if (!STATE_KEYS.has(key)) return null;
  const state = value['state'];
  if (typeof state !== 'string' || !MODULE_STATE_SET.has(state)) return null;
  const consentVersion = versionOrNull(value['consentVersion']);
  const required = value['requiredConsentVersion'];
  if (consentVersion === undefined || !isCount(required)) return null;
  const features = enumList(value['features'], FEATURE_SET, PROTECT_FEATURES, PROTECT_FEATURES.length);
  if (features === null) return null;
  const preset = value['preset'];
  if (typeof preset !== 'string' || !PRESET_SET.has(preset)) return null;
  const snoozed = value['snoozedUntil'];
  if (snoozed !== null && !(typeof snoozed === 'number' && Number.isSafeInteger(snoozed) && snoozed > 0)) return null;
  const sitesRaw = value['excludedSites'];
  if (!Array.isArray(sitesRaw) || sitesRaw.length > PROTECT_BUDGETS.maxExcludedSites) return null;
  const sites: string[] = [];
  for (const site of sitesRaw) {
    if (!isSiteName(site)) return null;
    if (!sites.includes(site)) sites.push(site);
  }
  const retention = value['historyRetentionDays'];
  if (typeof retention !== 'number' || !RETENTION_SET.has(retention)) return null;
  const historyRaw = value['history'];
  let history: ProtectState['history'] = null;
  if (historyRaw !== null) {
    if (!isRecord(historyRaw) || !isCount(historyRaw['records']) || typeof historyRaw['truncated'] !== 'boolean') return null;
    history = { records: historyRaw['records'], truncated: historyRaw['truncated'] };
  }
  const decisions = value['decisions'];
  if (!isCount(decisions)) return null;
  const perms = value['permissions'];
  if (!isRecord(perms) || typeof perms['broadHosts'] !== 'boolean' || typeof perms['dnr'] !== 'boolean') return null;
  const orgDisabled = value['organizationDisabled'];
  const orgInvalid = value['organizationPolicyInvalid'];
  if (typeof orgDisabled !== 'boolean' || typeof orgInvalid !== 'boolean') return null;
  const reasons = enumList(value['degradedReasons'], LIMITATION_SET, PROTECT_LIMITATIONS, PROTECT_WIRE_LIMITS.maxDegradedReasons);
  if (reasons === null) return null;
  return {
    state: state as ProtectModuleState,
    consentVersion,
    requiredConsentVersion: required,
    features,
    preset: preset as ProtectPreset,
    snoozedUntil: snoozed as number | null,
    excludedSites: sites,
    historyRetentionDays: retention as HistoryRetentionDays,
    history,
    decisions,
    permissions: { broadHosts: perms['broadHosts'], dnr: perms['dnr'] },
    organizationDisabled: orgDisabled,
    organizationPolicyInvalid: orgInvalid,
    degradedReasons: reasons,
  };
}

/**
 * Cheap shape check of `UiProtectReportResponse.report` (null allowed). Lanes validate their own sections in their
 * view models; the foundation only needs the identity, the module state and the coverage of the document.
 */
export function isProtectProjectionShape(value: unknown): value is ProtectProjection | null {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  return isCount(value['protectRevision'])
    && typeof value['documentKey'] === 'string' && value['documentKey'].length <= 512
    && (value['site'] === null || isSiteName(value['site']))
    && typeof value['moduleState'] === 'string' && MODULE_STATE_SET.has(value['moduleState'])
    && enumList(value['features'], FEATURE_SET, PROTECT_FEATURES, PROTECT_FEATURES.length) !== null
    && typeof value['coverageState'] === 'string' && COVERAGE_SET.has(value['coverageState'])
    && enumList(value['limitations'], LIMITATION_SET, PROTECT_LIMITATIONS, PROTECT_WIRE_LIMITS.maxProjectionLimitations) !== null
    && Array.isArray(value['evidence']) && value['evidence'].length <= PROTECT_BUDGETS.maxEvidencePerDocument
    && isCount(value['previousDocumentEvidence'])
    && isRecord(value['firewall'])
    && (value['replay'] === null || isRecord(value['replay']))
    && (value['gpc'] === null || isRecord(value['gpc']))
    && isRecord(value['dropped']);
}

// ---------------------------------------------------------------------------
// Permissions of the gesture (ADR-020 §6, §7)
// ---------------------------------------------------------------------------

export interface ProtectPermissionRequest {
  origins: string[];
  /** Empty, or exactly the DNR permission. */
  permissions: Array<typeof PROTECT_DNR_PERMISSION>;
}

export function needsDnrPermission(features: ReadonlyArray<ProtectFeature>): boolean {
  return features.some((feature) => (PROTECT_DNR_FEATURES as ReadonlyArray<ProtectFeature>).includes(feature));
}

/**
 * chrome.permissions.request of the consent gesture: all sites always (the module needs them), the request rules
 * permission only for firewall or gpc.
 */
export function protectPermissionRequest(features: ReadonlyArray<ProtectFeature>): ProtectPermissionRequest {
  return { origins: [...ALL_SITES_ORIGINS], permissions: needsDnrPermission(features) ? [PROTECT_DNR_PERMISSION] : [] };
}

/**
 * Changing the features in Options: turning on firewall or gpc without the DNR grant asks for it in the same gesture
 * (same request shape as the consent screen); anything else needs no request (null).
 */
export function featureChangePermissionRequest(state: ProtectState, next: ReadonlyArray<ProtectFeature>): ProtectPermissionRequest | null {
  const added = next.filter((feature) => !state.features.includes(feature));
  return needsDnrPermission(added) && !state.permissions.dnr ? protectPermissionRequest(next) : null;
}

/** Features in PROTECT_FEATURES order after toggling one. */
export function toggleFeature(features: ReadonlyArray<ProtectFeature>, feature: ProtectFeature, on: boolean): ProtectFeature[] {
  const set = new Set(features);
  if (on) set.add(feature);
  else set.delete(feature);
  return PROTECT_FEATURES.filter((f) => set.has(f));
}

// ---------------------------------------------------------------------------
// Where the module UI appears
// ---------------------------------------------------------------------------

/** The user turned the module on (it may be suspended): the settings record says enabled. */
const ENABLED_STATES: ReadonlySet<ProtectModuleState> = new Set(['active', 'degraded', 'needs-consent', 'needs-permission']);

export function protectEnabledByUser(state: ProtectState | null): boolean {
  return state !== null && ENABLED_STATES.has(state.state);
}

/**
 * Popup area and side-panel tabs: only while the module is not off. A policy-disabled module the user never accepted
 * shows nothing there (module-off surfaces stay as before); Options explains the policy.
 */
export function protectSurfaceVisible(state: ProtectState | null): boolean {
  if (state === null || state.state === 'off') return false;
  if (state.state === 'organization-disabled') return state.consentVersion !== null && state.features.length > 0;
  return true;
}

/**
 * Options shows the tabs «Наблюдение» / «Защита» under the same rule as the popup and the side panel
 * (protectSurfaceVisible), or while the module keeps data; otherwise one section. S09 (foundation follow-up): a user
 * whose organization disabled the module and who never enabled it sees no layout change (the section explains the
 * policy).
 */
export function optionsHasProtectTabs(state: ProtectState | null): boolean {
  if (state === null) return false;
  return protectSurfaceVisible(state) || state.decisions > 0 || (state.history?.records ?? 0) > 0;
}

/** Initial Options tab from location.hash (`#protect`, `#firewall`, `#history`, `#requests` → «Защита»). */
export function optionsTabFromHash(hash: string): OptionsTabId {
  const name = hash.startsWith('#') ? hash.slice(1) : hash;
  return (PROTECT_OPTIONS_HASHES as ReadonlyArray<string>).includes(name) ? 'protect' : 'observation';
}

/** Hash after a tab change: «Защита» keeps a lane hash it was opened with, «Наблюдение» drops it. */
export function optionsHashForTab(tab: OptionsTabId, currentHash: string): string {
  if (tab === 'observation') return '';
  return optionsTabFromHash(currentHash) === 'protect' && currentHash.length > 1 ? currentHash : '#protect';
}

// ---------------------------------------------------------------------------
// Options section
// ---------------------------------------------------------------------------

export interface ProtectSectionVM {
  stateKey: string;
  tone: Tone;
  /** «Включить «Защиту»…» (consent screen): off and the suspended states; never under the organization policy. */
  enable: boolean;
  /** Features, preset, snooze and excluded sites: the module runs (active / degraded). */
  controls: boolean;
  /** «Выключить «Защиту»»: the user turned the module on (also while suspended). */
  disable: boolean;
  /** «Удалить все данные модуля»: every state except plain off without data (that layout is «только включение»). */
  purge: boolean;
  /** Extra explanations under the state plaque. */
  notices: Message[];
  /** degraded: one line per reason. */
  reasons: Message[];
  historyRecords: number | null;
  decisions: number;
  snoozedUntil: number | null;
  excludedSites: string[];
  canAddSite: boolean;
}

const STATE_TONES: Readonly<Record<ProtectModuleState, Tone>> = {
  off: 'muted',
  active: 'neutral',
  'needs-consent': 'attention',
  'needs-permission': 'attention',
  'organization-disabled': 'muted',
  degraded: 'attention',
};

export function reasonMessage(code: ProtectLimitation): Message {
  const key = PROTECT_REASON_KEYS[code];
  return key === undefined ? msg('protect_reason_other', code) : msg(key);
}

export function protectSectionView(state: ProtectState, now: number): ProtectSectionVM {
  const running = state.state === 'active' || state.state === 'degraded';
  const notices: Message[] = [];
  if (state.state === 'organization-disabled') notices.push(msg('protect_org_policy'));
  return {
    stateKey: PROTECT_STATE_KEYS[state.state],
    tone: STATE_TONES[state.state],
    enable: state.state === 'off' || state.state === 'needs-consent' || state.state === 'needs-permission',
    controls: running,
    disable: protectEnabledByUser(state),
    purge: optionsHasProtectTabs(state),
    notices,
    reasons: state.state === 'degraded' ? state.degradedReasons.map(reasonMessage) : [],
    historyRecords: state.history === null ? null : state.history.records,
    decisions: state.decisions,
    snoozedUntil: state.snoozedUntil !== null && state.snoozedUntil > now ? state.snoozedUntil : null,
    excludedSites: [...state.excludedSites],
    canAddSite: state.excludedSites.length < PROTECT_BUDGETS.maxExcludedSites,
  };
}

/** Excluded-site input → a sanitized host (the SW normalizes it to the registrable domain), or null. */
export function parseSiteInput(input: string): string | null {
  if (input.length > 2048) return null;
  return parseHostInput(input);
}

// ---------------------------------------------------------------------------
// Consent screen
// ---------------------------------------------------------------------------

export interface ConsentDraft {
  features: ProtectFeature[];
  preset: ProtectPreset;
  ack: boolean;
}

/** Defaults on first consent; a renewed consent (needs-consent / needs-permission) starts from the stored choice. */
export function initialConsentDraft(state: ProtectState | null): ConsentDraft {
  const renew = state !== null && (state.state === 'needs-consent' || state.state === 'needs-permission') && state.features.length > 0;
  return {
    features: renew ? [...state.features] : [...PROTECT_DEFAULT_CONSENT_FEATURES],
    preset: renew ? state.preset : PROTECT_DEFAULT_PRESET,
    ack: false,
  };
}

export interface ConsentVM {
  /** The confirm button is aria-disabled (still focusable) until ack is ticked and a feature is chosen. */
  confirmDisabled: boolean;
  /** Visible reason next to the disabled button. */
  hintKey: 'protect_consent_ack_required' | 'protect_consent_features_required' | null;
  permissionRequest: ProtectPermissionRequest;
}

export function consentView(draft: ConsentDraft): ConsentVM {
  const hintKey = draft.features.length === 0 ? 'protect_consent_features_required' : !draft.ack ? 'protect_consent_ack_required' : null;
  return { confirmDisabled: hintKey !== null, hintKey, permissionRequest: protectPermissionRequest(draft.features) };
}

// ---------------------------------------------------------------------------
// Popup / side panel status line
// ---------------------------------------------------------------------------

export interface ProtectStatusVM {
  state: Message;
  coverage: Message | null;
  tone: Tone;
}

/**
 * The module's coverage of the shown document (S09, foundation follow-up). `paused` says «сайт исключён» only with the
 * `site-excluded` limitation (an inactive or degraded module is «приостановлен»); `late-start` of a page loaded before
 * the module was turned on (`loaded-before-enable`) says the module does not work there until the page reloads —
 * protect.js is not running in it.
 */
export function protectCoverageMessage(report: Pick<ProtectProjection, 'coverageState' | 'limitations'>): Message {
  if (report.coverageState === 'paused' && !report.limitations.includes('site-excluded')) return msg('protect_coverage_suspended');
  if (report.coverageState === 'late-start' && report.limitations.includes('loaded-before-enable')) return msg('protect_coverage_reload');
  return msg(PROTECT_COVERAGE_KEYS[report.coverageState]);
}

export function protectStatusView(state: ProtectState, report: ProtectProjection | null): ProtectStatusVM {
  const coverage = report === null || (state.state !== 'active' && state.state !== 'degraded')
    ? null
    : msg('protect_coverage_line', protectCoverageMessage(report));
  return { state: msg('protect_status_line', msg(PROTECT_STATE_KEYS[state.state])), coverage, tone: STATE_TONES[state.state] };
}
