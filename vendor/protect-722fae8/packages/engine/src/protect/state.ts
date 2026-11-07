// ADR-020 §3, §6 (S04): settings of the opt-in module «Защита» and its effective state. Pure: no chrome.*, no clock
// (the caller passes `now`). A broken settings record is fail-closed: the module is off.

import { HISTORY_RETENTION_DAYS, PROTECT_BUDGETS, PROTECT_DNR_FEATURES, PROTECT_FEATURES, PROTECT_PRESETS } from '@detect-expert/contracts';
import type { EnforcementState, HistoryRetentionDays, ProtectFeature, ProtectModuleState, ProtectPreset } from '@detect-expert/contracts';

/** storage.local['protect'] (settings only; never data). */
export interface ProtectSettings {
  v: 1;
  enabled: boolean;
  /** Consent version the user accepted; null when never accepted. */
  consentVersion: number | null;
  /** Enabled features, PROTECT_FEATURES order, unique. */
  features: ProtectFeature[];
  preset: ProtectPreset;
  /** Epoch ms; null when not snoozed (an expired snooze reads as null). */
  snoozeUntil: number | null;
  historyRetentionDays: HistoryRetentionDays;
}

export const PROTECT_SETTINGS_KEY = 'protect';

export const DEFAULT_PROTECT_SETTINGS: Readonly<ProtectSettings> = Object.freeze({
  v: 1,
  enabled: false,
  consentVersion: null,
  features: [],
  preset: 'normal',
  snoozeUntil: null,
  historyRetentionDays: PROTECT_BUDGETS.defaultHistoryRetentionDays,
}) as Readonly<ProtectSettings>;

const SETTINGS_KEYS: ReadonlySet<string> = /* @__PURE__ */ new Set(['v', 'enabled', 'consentVersion', 'features', 'preset', 'snoozeUntil', 'historyRetentionDays']);
const FEATURE_SET: ReadonlySet<string> = /* @__PURE__ */ new Set<string>(PROTECT_FEATURES);
const PRESET_SET: ReadonlySet<string> = /* @__PURE__ */ new Set<string>(PROTECT_PRESETS);
const RETENTION_SET: ReadonlySet<number> = /* @__PURE__ */ new Set<number>(HISTORY_RETENTION_DAYS);

/** Features in PROTECT_FEATURES order, unique; null when any entry is unknown or the input is not an array. */
export function canonicalFeatures(value: unknown): ProtectFeature[] | null {
  if (!Array.isArray(value) || value.length > PROTECT_FEATURES.length * 2) return null;
  const seen = new Set<string>();
  for (const f of value) {
    if (typeof f !== 'string' || !FEATURE_SET.has(f)) return null;
    seen.add(f);
  }
  return PROTECT_FEATURES.filter((f) => seen.has(f));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Strict reading of storage.local['protect']. Absent → defaults (off). Any invalid field, unknown key or an enabled
 * record without features → `enabled: false` (fail-closed); the valid fields are kept so the user's choices survive.
 * `snoozeUntil` is bounded by `now + snoozeMs`; an expired snooze becomes null.
 */
export function parseProtectSettings(raw: unknown, now: number): ProtectSettings {
  const out: ProtectSettings = { ...DEFAULT_PROTECT_SETTINGS, features: [] };
  if (raw === undefined || raw === null) return out;
  if (!isRecord(raw)) return out;
  let valid = raw['v'] === 1;
  for (const key of Object.keys(raw)) if (!SETTINGS_KEYS.has(key)) valid = false;

  const features = canonicalFeatures(raw['features']);
  if (features === null) valid = false;
  else out.features = features;

  const preset = raw['preset'];
  if (typeof preset === 'string' && PRESET_SET.has(preset)) out.preset = preset as ProtectPreset;
  else valid = false;

  const consent = raw['consentVersion'];
  if (consent === null || (typeof consent === 'number' && Number.isSafeInteger(consent) && consent >= 0 && consent <= 1_000_000)) out.consentVersion = consent;
  else valid = false;

  const retention = raw['historyRetentionDays'];
  if (typeof retention === 'number' && RETENTION_SET.has(retention)) out.historyRetentionDays = retention as HistoryRetentionDays;
  else valid = false;

  const snooze = raw['snoozeUntil'];
  if (snooze === null) out.snoozeUntil = null;
  else if (typeof snooze === 'number' && Number.isFinite(snooze)) out.snoozeUntil = snooze > now ? Math.min(snooze, now + PROTECT_BUDGETS.snoozeMs) : null;
  else valid = false;

  const enabled = raw['enabled'];
  if (typeof enabled !== 'boolean') valid = false;
  out.enabled = valid && enabled === true && out.features.length > 0;
  return out;
}

/** Features that need the optional declarativeNetRequestWithHostAccess permission are enabled. */
export function needsDnr(features: readonly ProtectFeature[]): boolean {
  for (const f of PROTECT_DNR_FEATURES) if (features.includes(f)) return true;
  return false;
}

/**
 * How a missing DNR permission is treated while firewall or gpc is enabled:
 * - `required` (ADR-020 §7, current design): the module is `needs-permission`;
 * - `enforcement-only` (fallback F2): the module stays usable, enforcement is `no-permission`.
 */
export type DnrPermissionPolicy = 'required' | 'enforcement-only';

export interface ProtectStateInput {
  settings: Readonly<ProtectSettings>;
  /** The accepted consent version differs from PROTECT_CONSENT_VERSION. */
  consentRequired: boolean;
  /** Managed ProtectModuleDisabled is present and not `false` (fail-closed). */
  orgDisabled: boolean;
  /** http(s)://*\/* granted. */
  broadHosts: boolean;
  /** declarativeNetRequestWithHostAccess granted. */
  dnr: boolean;
  /** At least one degraded reason is recorded. */
  degraded: boolean;
  /** Enforcement could not write its rules (dnr-port degraded). */
  enforcementDegraded?: boolean;
  dnrPolicy?: DnrPermissionPolicy;
}

export interface EffectiveProtectState {
  state: ProtectModuleState;
  /** Firewall enforcement (FirewallTabView.enforcement) implied by the module state. */
  enforcement: EnforcementState;
}

/**
 * Priority (ADR-020 §3): organization-disabled > off > needs-consent > needs-permission > degraded > active.
 * needs-permission: no broad host grant, or firewall/gpc without the DNR permission under the `required` policy.
 */
export function effectiveProtectState(input: ProtectStateInput): EffectiveProtectState {
  const { settings } = input;
  const policy = input.dnrPolicy ?? 'required';
  const dnrNeeded = needsDnr(settings.features);
  const firewall = settings.features.includes('firewall');
  let state: ProtectModuleState;
  if (input.orgDisabled) state = 'organization-disabled';
  else if (!settings.enabled) state = 'off';
  else if (input.consentRequired) state = 'needs-consent';
  else if (!input.broadHosts || (dnrNeeded && !input.dnr && policy === 'required')) state = 'needs-permission';
  else if (input.degraded) state = 'degraded';
  else state = 'active';
  let enforcement: EnforcementState;
  if (!firewall || (state !== 'active' && state !== 'degraded')) enforcement = 'off';
  else if (!input.dnr) enforcement = 'no-permission';
  else if (settings.preset === 'warn-only') enforcement = 'warn-only';
  else if (input.enforcementDegraded === true) enforcement = 'degraded';
  else enforcement = 'active';
  return { state, enforcement };
}
