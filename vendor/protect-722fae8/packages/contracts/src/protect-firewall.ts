// ADR-020 §C, §D, §11: firewall names and views. Decisions in IndexedDB are the source of truth; DNR rules are their
// projection. A receiver is a PSL registrable domain. «stopped» only when our rule was active before the request and
// Chrome reported ERR_BLOCKED_BY_CLIENT; counters of stopped requests are lower bounds and never claim user data.

import type { AttributionConfidence, SiteRelation, VendorMatch } from './enums';
import type { DeliveryState, FieldKind, ProtectPreset, ScriptRef, SinceInput, SubmitTiming, ValueEncoding } from './protect';
import type { LocalDay } from './protect-requests';

export const FIREWALL_ACTIONS = ['block', 'allow'] as const;
export type FirewallAction = (typeof FIREWALL_ACTIONS)[number];

/** `once` = session rule for one tab until it closes or leaves the site; `site` = receiver on one site; `everywhere`. */
export const DECISION_SCOPES = ['once', 'site', 'everywhere'] as const;
export type DecisionScope = (typeof DECISION_SCOPES)[number];

/** `preset` = created by the strict preset (site level only, with undo); never from page-controlled data. */
export const DECISION_ORIGINS = ['user', 'preset'] as const;
export type DecisionOrigin = (typeof DECISION_ORIGINS)[number];

export const ENFORCEMENT_STATES = ['off', 'active', 'warn-only', 'no-permission', 'degraded'] as const;
export type EnforcementState = (typeof ENFORCEMENT_STATES)[number];

/** Why enforcement is degraded (SP-1: rule writes may not complete until the extension reloads → api-unavailable). */
export const ENFORCEMENT_DEGRADED = ['rule-limit', 'update-rejected', 'api-unavailable', 'cleanup-pending'] as const;
export type EnforcementDegraded = (typeof ENFORCEMENT_DEGRADED)[number];

export const FIREWALL_NOTICE_KINDS = ['strict-auto', 'strict-escalate', 'bypass', 'limit-reached'] as const;
export type FirewallNoticeKind = (typeof FIREWALL_NOTICE_KINDS)[number];

/** Why a stored rule is not in effect: enforcement is not active, or the rule did not fit the DNR limits. */
export const FIREWALL_INACTIVE_REASONS = ['off', 'warn-only', 'no-permission', 'degraded', 'rule-limit'] as const;
export type FirewallInactiveReason = (typeof FIREWALL_INACTIVE_REASONS)[number];

/** Stored rule scopes (`once` lives in session rules only). */
export const FIREWALL_RULE_SCOPES = ['site', 'everywhere'] as const satisfies readonly DecisionScope[];
export type FirewallRuleScope = (typeof FIREWALL_RULE_SCOPES)[number];

/** `<scope>:<site or *>><receiver>`, e.g. `site:shop.example>collect.example` / `everywhere:*>collect.example`. */
export const FIREWALL_RULE_KEY_PATTERN = /^(site|everywhere):[a-z0-9.*-]{1,253}>[a-z0-9.-]{1,253}$/;

export interface FirewallRuleRef {
  action: FirewallAction;
  scope: DecisionScope;
  origin: DecisionOrigin;
}

/** Lower-bound counters of request outcomes to one receiver in this tab (ADR-020 §11). */
export interface FirewallDeliveryCounts {
  sent: number;
  stopped: number;
  stoppedOther: number;
  unknown: number;
}

export const FIREWALL_SENDER_FRAMES = ['top', 'subframe', 'opaque'] as const;
export type FirewallSenderFrame = (typeof FIREWALL_SENDER_FRAMES)[number];

export interface FirewallSender {
  frame: FirewallSenderFrame;
  /** Registrable domain of the browser-reported initiator, or null. */
  initiatorSite: string | null;
  /** Only with attributionConfidence 'sampled-stack' (page-controlled). */
  script?: ScriptRef;
  attributionConfidence: AttributionConfidence;
}

export interface FirewallReceiverView {
  receiver: string;
  relation: SiteRelation;
  effectiveRule: FirewallRuleRef | null;
  delivery: FirewallDeliveryCounts;
  countQuality: 'lower-bound';
  lastDelivery: DeliveryState;
  fieldKinds: FieldKind[];
  /** At most PROTECT_WIRE_LIMITS.maxEvidenceEncodings. */
  encodings: ValueEncoding[];
  submitTiming: SubmitTiming;
  sinceInput?: SinceInput;
  sender: FirewallSender;
  /** Only through an active catalog rule (none in production, REQ-008). */
  vendorId?: string;
  vendorConfidence: VendorMatch;
}

/** A pending decision prompt for (tab, site): at most PROTECT_BUDGETS.maxPromptReceivers receivers, the rest hidden. */
export interface FirewallPromptView {
  /** PROMPT_ID_PATTERN. */
  promptId: string;
  site: string;
  receivers: string[];
  /** Number of further receivers not shown. */
  hidden: number;
}

export interface FirewallNotice {
  kind: FirewallNoticeKind;
  receiver: string;
  site?: string;
  count?: number;
  /** UNDO_ID_PATTERN; for strict-auto decisions. */
  undoId?: string;
}

export interface FirewallOnceRule {
  receiver: string;
  action: FirewallAction;
}

export interface FirewallTabView {
  enforcement: EnforcementState;
  degradedCode?: EnforcementDegraded;
  preset: ProtectPreset;
  /** DNR supports topDomains (RuleConditionKeys); otherwise site rules fall back to initiatorDomains. */
  topDomainsSupported: boolean;
  stoppedToday: { count: number; countQuality: 'lower-bound' };
  snoozedUntil: number | null;
  prompt: FirewallPromptView | null;
  /** At most PROTECT_WIRE_LIMITS.maxFirewallReceivers. */
  receivers: FirewallReceiverView[];
  /** At most PROTECT_BUDGETS.maxNoticesPerTab. */
  notices: FirewallNotice[];
  /** At most PROTECT_WIRE_LIMITS.maxOnceRules. */
  onceRules: FirewallOnceRule[];
}

/** One stored rule in the Options list. */
export interface FirewallRuleRow {
  /** FIREWALL_RULE_KEY_PATTERN. */
  ruleKey: string;
  receiver: string;
  /** Null for `everywhere`. */
  site: string | null;
  scope: FirewallRuleScope;
  action: FirewallAction;
  origin: DecisionOrigin;
  createdDay: LocalDay;
  active: boolean;
  inactiveReason?: FirewallInactiveReason;
  /** Lower-bound counters (stopped by this rule / bypassed it). */
  stopped: number;
  bypass: number;
}

export interface FirewallStoppedDay {
  day: LocalDay;
  count: number;
}
