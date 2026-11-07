// Toolbar badge of the extension action (E13-03, spec V §7, ADR-003 v3). Pure: the SW (packages/background badge.ts)
// resolves the message keys through chrome.i18n and applies them; the UI uses the same count.
//
// The number is "categories with findings", never a danger score: only interpretive findings count, api-use and
// unknown never do, and a recognized vendor is not a finding (REQ-007). The badge never shows '0', '?' or '!':
// with nothing to count, or without observation, it is empty and the tooltip explains the state next to coverage
// (REQ-006).
// ADR-020 §D (S09): while firewall prompts of the opt-in module «Защита» wait in a tab, the badge shows how many
// receivers wait for a decision (tone 'firewall'); the extension window never opens by itself.

import type { CoverageState, Finding, Interpretation, ReportProjection, ScopeMode } from '@detect-expert/contracts';
import { techniqueCategory } from './techniques';

/** Interpretations that count for the badge (api-use and unknown never do). */
export const BADGE_INTERPRETATIONS: ReadonlySet<Interpretation> = new Set<Interpretation>([
  'possible-fingerprinting',
  'fingerprinting-pattern',
  'local-probe-pattern',
  'dns-test-pattern',
]);

/** Coverage state -> status_* locale key (same keys as the UI status pill). */
export const BADGE_STATUS_KEYS: Readonly<Record<CoverageState, string>> = Object.freeze({
  active: 'status_active',
  partial: 'status_partial',
  'late-start': 'status_late_start',
  paused: 'status_paused',
  unsupported: 'status_unsupported',
  'no-access': 'status_no_access',
  degraded: 'status_degraded',
});

/** One substitution of the tooltip: a ready string (a formatted number) or a nested message key. */
export type BadgeSub = string | { key: string };

export interface BadgeTitle {
  key: string;
  subs: BadgeSub[];
}

/** ADR-020 §D (S09): the only non-default tone — firewall prompts of the module «Защита» wait in the tab. */
export type BadgeTone = 'firewall';

export interface BadgeView {
  /** '' or a positive count; never '0', '?' or '!'. */
  text: string;
  title: BadgeTitle;
  /** Present only for the firewall signal (S09); the observation badge carries no tone. */
  tone?: BadgeTone;
}

/** ADR-020 §D (S09): what the module contributes to a tab's badge; null / absent = nothing (module off, snoozed). */
export interface BadgeProtectInput {
  /** Receivers of the tab's firewall prompt still waiting for a decision. */
  pending: number;
}

/** Firewall badge text: '1'…'9', then '9+'. Never '0', '?' or '!' (anything not a positive count gives ''). */
export const BADGE_FIREWALL_MAX = 9;

export function firewallBadgeText(pending: number): string {
  if (!Number.isFinite(pending) || pending < 1) return '';
  const n = Math.floor(pending);
  return n > BADGE_FIREWALL_MAX ? String(BADGE_FIREWALL_MAX) + '+' : String(n);
}

/** Number of distinct technique categories among the findings with a badge interpretation. */
export function badgeCategoryCount(findings: readonly Finding[]): number {
  const categories = new Set<string>();
  for (const finding of findings) {
    if (!BADGE_INTERPRETATIONS.has(finding.interpretation)) continue;
    categories.add(techniqueCategory(finding.techniqueId));
  }
  return categories.size;
}

function title(key: string, subs: BadgeSub[] = []): BadgeTitle {
  return { key, subs };
}

/**
 * Badge text and tooltip of one tab. Rules apply in order, the first match wins:
 * firewall prompts waiting (module «Защита», S09) -> '1'…'9' / '9+' with tone 'firewall' (the module does not depend
 * on the observation scope; the popup never opens by itself, the badge is the signal);
 * no report -> ''; revoked -> ''; scope off -> ''; no-access -> ''; unsupported -> ''; N = 0 -> '';
 * paused -> N (before the pause); active -> N; partial / late-start / degraded -> N with the limitation in the tooltip.
 * Without `protect` (or with pending 0) the result is exactly the observation badge.
 */
export function badgeView(report: ReportProjection | null, scopeMode: ScopeMode, protect?: BadgeProtectInput | null): BadgeView {
  const pending = protect === undefined || protect === null ? 0 : protect.pending;
  const firewall = firewallBadgeText(pending);
  if (firewall !== '') return { text: firewall, title: title('badge_tooltip_firewall', [String(Math.floor(pending))]), tone: 'firewall' };
  if (report === null) return { text: '', title: title(scopeMode === 'off' ? 'badge_tooltip_off' : 'actionTitle') };
  if (report.coverageFlags.includes('revoked')) return { text: '', title: title('badge_tooltip_revoked') };
  if (scopeMode === 'off') return { text: '', title: title('badge_tooltip_off') };
  const state = report.coverageState;
  if (state === 'no-access') return { text: '', title: title('badge_tooltip_no_access') };
  if (state === 'unsupported') return { text: '', title: title('coverage_unsupported_title') };
  const n = badgeCategoryCount(report.findings);
  const status = { key: BADGE_STATUS_KEYS[state] };
  if (n === 0) return { text: '', title: title('badge_tooltip_none', [status]) };
  const count = String(n);
  if (state === 'paused') return { text: count, title: title('badge_tooltip_paused', [count]) };
  if (state === 'active') return { text: count, title: title('badge_tooltip', [count]) };
  return { text: count, title: title('badge_tooltip_limited', [count, status]) };
}
