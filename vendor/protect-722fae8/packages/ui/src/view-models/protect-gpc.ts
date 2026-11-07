// ADR-020 §H (S13): view models of the GPC UI — the Options section (description, rule state, visibility, legal
// block, coverage gaps) and the popup line for the shown site (state, «Не отправлять на этом сайте», what Chrome
// reported for the page's requests). Pure: no chrome.*, returns message keys.
// Wording (docs/ui-copy.md §6.14.H): «добавлен к запросу (по данным Chrome)»; never «сервер получил», never a verdict
// about the site (honours / ignores / violates). Legal texts are candidate until a lawyer's review.

import { GPC_HEADER_EVIDENCE, GPC_SITE_STATES, MAX_COUNT, isSiteName } from '@detect-expert/contracts';
import type { GpcHeaderEvidence, GpcSiteState, GpcTabFact, ProtectProjection, ProtectState } from '@detect-expert/contracts';
import type { Tone } from './coverage';
import { msg } from './message';
import type { Message } from './message';

/** Legal block of the Options section (candidate texts until the lawyer's review, docs/ui-copy.md). */
export const GPC_LEGAL_KEYS = ['protect_gpc_legal_us', 'protect_gpc_legal_eu', 'protect_gpc_legal_ru', 'protect_gpc_legal_note'] as const;

export const GPC_NAV_KEYS: Readonly<Record<GpcHeaderEvidence, string>> = {
  observed: 'protect_gpc_nav_observed',
  'not-observed': 'protect_gpc_nav_not_observed',
  'not-applicable': 'protect_gpc_nav_not_applicable',
  unknown: 'protect_gpc_nav_unknown',
};

const SITE_KEYS: Readonly<Record<Exclude<GpcSiteState, 'no-access'>, string>> = {
  on: 'protect_gpc_site_on',
  excluded: 'protect_gpc_site_excluded',
  off: 'protect_gpc_site_off',
};

const SITE_TONES: Readonly<Record<Exclude<GpcSiteState, 'no-access'>, Tone>> = { on: 'neutral', excluded: 'muted', off: 'attention' };

const SITE_STATE_SET: ReadonlySet<string> = new Set(GPC_SITE_STATES);
const HEADER_SET: ReadonlySet<string> = new Set(GPC_HEADER_EVIDENCE);
const FACT_KEYS: ReadonlySet<string> = new Set([
  'site', 'siteState', 'navigationHeader', 'requestsWithHeader', 'requestsWithoutHeader', 'countQuality', 'propertyAtLoad', 'reloadNeeded',
  'evidenceSource', 'integrity',
]);

function isCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= MAX_COUNT;
}

/** Strict reading of ProtectProjection.gpc: exactly the contract keys and enums; anything else = no fact (null). */
export function parseGpcFact(value: unknown): GpcTabFact | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  for (const key of Object.keys(v)) if (!FACT_KEYS.has(key)) return null;
  const site = v['site'];
  if (site !== null && !isSiteName(site)) return null;
  const siteState = v['siteState'];
  const nav = v['navigationHeader'];
  if (typeof siteState !== 'string' || !SITE_STATE_SET.has(siteState)) return null;
  if (typeof nav !== 'string' || !HEADER_SET.has(nav)) return null;
  if (!isCount(v['requestsWithHeader']) || !isCount(v['requestsWithoutHeader'])) return null;
  const quality = v['countQuality'];
  if (quality !== 'exact' && quality !== 'sampled' && quality !== 'lower-bound') return null;
  if (typeof v['propertyAtLoad'] !== 'boolean' || typeof v['reloadNeeded'] !== 'boolean') return null;
  if (v['evidenceSource'] !== 'browser-network' || v['integrity'] !== 'browser-observed') return null;
  return {
    site: site as string | null,
    siteState: siteState as GpcSiteState,
    navigationHeader: nav as GpcHeaderEvidence,
    requestsWithHeader: v['requestsWithHeader'],
    requestsWithoutHeader: v['requestsWithoutHeader'],
    countQuality: quality,
    propertyAtLoad: v['propertyAtLoad'],
    reloadNeeded: v['reloadNeeded'],
    evidenceSource: 'browser-network',
    integrity: 'browser-observed',
  };
}

function running(state: ProtectState): boolean {
  return state.state === 'active' || state.state === 'degraded';
}

/** Chrome did not apply the request rules (dnr-port degraded: SP-1 hang after a runtime grant, rejection). */
export function gpcRuleFailed(state: ProtectState): boolean {
  return state.features.includes('gpc') && state.degradedReasons.includes('blocking-unavailable');
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options state of the header rule, as far as the module state tells it (Options has no tab to read back). */
export type GpcSectionRuleState = 'off' | 'suspended' | 'error' | 'written';

export interface GpcSectionVM {
  /** The feature box of ProtectSection is ticked. */
  enabled: boolean;
  ruleState: GpcSectionRuleState;
  /** State of the signal and of its rule, in order. */
  lines: Message[];
  tone: Tone;
  legal: Message[];
}

/** Options section; null while the module is off (the section shows only with the module, like the other lanes). */
export function gpcSectionView(state: ProtectState): GpcSectionVM | null {
  if (state.state === 'off') return null;
  const enabled = state.features.includes('gpc');
  const lines: Message[] = [];
  let tone: Tone = 'neutral';
  let ruleState: GpcSectionRuleState;
  if (!enabled) {
    lines.push(msg('protect_gpc_off'));
    tone = 'muted';
    ruleState = 'off';
  } else if (!running(state)) {
    lines.push(msg('protect_gpc_suspended'));
    tone = 'attention';
    ruleState = 'suspended';
  } else if (gpcRuleFailed(state)) {
    // ADR-020 §7 (SP-1): after a runtime grant Chrome applies the rule only after a browser restart.
    lines.push(msg('protect_gpc_rule_error'), msg('protect_gpc_restart_hint'));
    tone = 'attention';
    ruleState = 'error';
  } else {
    lines.push(msg('protect_gpc_rule_written'));
    ruleState = 'written';
  }
  if (enabled && state.excludedSites.length > 0) lines.push(msg('protect_gpc_excluded_sites', state.excludedSites.length));
  return { enabled, ruleState, lines, tone, legal: GPC_LEGAL_KEYS.map((key) => msg(key)) };
}

// ---------------------------------------------------------------------------
// Popup
// ---------------------------------------------------------------------------

export interface GpcSiteLineVM {
  site: string;
  siteState: Exclude<GpcSiteState, 'no-access'>;
  /** «GPC: …» line; null when only the reload note is shown (the feature is off now). */
  line: Message | null;
  tone: Tone;
  /** «Не отправлять на этом сайте» (= ui-protect-set-site excluded:true; the way back is in Options only). */
  canExclude: boolean;
  /** Rule failure and the restart hint (SP-1): only with `blocking-unavailable` in the module state. */
  ruleError: Message[];
  excludedHint: Message | null;
  reload: Message | null;
  /** What Chrome reported for the page (collapsed details). */
  details: Message[];
}

/**
 * Popup line for the shown tab. Hidden: no well-formed fact, a page without a site (not http/https), or the feature off
 * without a pending reload note.
 */
export function gpcSiteLineView(state: ProtectState, report: ProtectProjection | null): GpcSiteLineVM | null {
  const fact = parseGpcFact(report?.gpc ?? null);
  if (fact === null || fact.site === null || fact.siteState === 'no-access') return null;
  const featureOn = state.features.includes('gpc') && running(state);
  if (!featureOn && !fact.reloadNeeded) return null;
  const siteState = fact.siteState;
  const reload = fact.reloadNeeded ? msg('protect_gpc_reload_needed') : null;
  if (!featureOn) {
    return { site: fact.site, siteState, line: null, tone: 'muted', canExclude: false, ruleError: [], excludedHint: null, reload, details: [] };
  }
  const details: Message[] = [msg(GPC_NAV_KEYS[fact.navigationHeader])];
  if (fact.requestsWithHeader > 0 || fact.requestsWithoutHeader > 0) {
    details.push(msg('protect_gpc_counts', fact.requestsWithHeader, fact.requestsWithoutHeader));
    if (fact.countQuality === 'lower-bound') details.push(msg('protect_gpc_counts_lower_bound'));
  }
  if (fact.navigationHeader === 'observed' || fact.requestsWithHeader > 0) details.push(msg('protect_gpc_sent_note'));
  return {
    site: fact.site,
    siteState,
    line: msg(SITE_KEYS[siteState], fact.site),
    tone: SITE_TONES[siteState],
    canExclude: siteState !== 'excluded',
    // The rule failure is said only when Chrome refused or did not finish the write (dnr-port degraded); while a write is
    // still pending the line alone says the signal is not being sent now.
    ruleError: siteState === 'off' && gpcRuleFailed(state) ? [msg('protect_gpc_rule_error'), msg('protect_gpc_restart_hint')] : [],
    excludedHint: siteState === 'excluded' ? msg('protect_gpc_excluded_hint') : null,
    reload,
    details,
  };
}
