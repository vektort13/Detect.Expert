// ADR-020 §C (S08): compilation of firewall decisions into DNR rules. Decisions (IndexedDB) are the source of truth;
// the rules are their projection. Pure: no chrome.*, no clock, no randomness. Every rule passes assertAllowedRule.
//   receiver-block «везде»  p10  requestDomains [R] + excludedTopDomains [R]   (fallback excludedInitiatorDomains)
//   receiver-allow          p20  requestDomains [R]            — only when a block (preset) overlaps it
//   site-block              p30  requestDomains [R] + topDomains [S]           (fallback initiatorDomains: iframe gap)
//   site-allow              p40  requestDomains [R] + topDomains [S] — only when a block overlaps it
//   once (session)          p50  site condition + tabIds [T]   (allow only when a block overlaps it)
//   preset (strict only)    p10  requestDomains [H] (or urlFilter ||H/prefix) + excludedTopDomains [site of H]
// resourceTypes is never set: DNR then matches every type except main_frame (navigations are never blocked).
// `warn-only` compiles to no rule at all.
// Review TRUTH-01: the module's excluded sites are added to the excluded top-level domains (fallback: excluded
// initiators) of the receiver-block «везде» and preset rules, so these rules do not act on an excluded site. Rules the
// user made for one site (site, once) are not changed by an exclusion; they act until the user removes them.

import { DNR_PRIORITIES, DNR_RULE_IDS, FIREWALL_RULE_KEY_PATTERN, PROTECT_BUDGETS } from '@detect-expert/contracts';
import type { DecisionOrigin, DecisionScope, FirewallAction, FirewallRuleScope, LocalDay, ProtectPreset } from '@detect-expert/contracts';
import { domainMatches } from '../../../../attribution/src/dnr-domains';
import { registrableDomain } from '../../../../attribution/src/index';
import { isAllowedRule } from '../dnr-guard';
import type { AllowedDnrCondition, AllowedDnrRule } from '../dnr-guard';

export const DECISION_RULE_ID_BASE = DNR_RULE_IDS.decisions[0];
export const PRESET_RULE_ID_BASE = DNR_RULE_IDS.preset[0];
export const SESSION_RULE_ID_BASE = DNR_RULE_IDS.session[0];

/** One stored decision (IndexedDB `decisions`): domains, enums, a local day and counters only. */
export interface FirewallDecision {
  /** = decisionKeyOf(scope, site, receiver); FIREWALL_RULE_KEY_PATTERN. */
  decisionKey: string;
  receiver: string;
  /** Null for `everywhere`. */
  site: string | null;
  scope: FirewallRuleScope;
  action: FirewallAction;
  origin: DecisionOrigin;
  /** 0..maxDecisions-1; the DNR id is DECISION_RULE_ID_BASE + slot. */
  slot: number;
  createdDay: LocalDay;
  /** Lower-bound counters: requests stopped by this rule / sent although it should have stopped them. */
  stopped: number;
  bypass: number;
}

/** A preset entry after the REQ-008 gate (generated catalog table). `host` is a registrable domain or a host below. */
export interface FirewallPresetEntry {
  entryId: string;
  host: string;
  /** Literal path prefix (`/collect`), only for entries that need it; never a query or an ID. */
  pathPrefix?: string;
}

/** One `once` decision: a session rule for one tab on one site. */
export interface OnceRuleSpec {
  /** 0..maxSessionRules-1; the DNR id is SESSION_RULE_ID_BASE + slot. */
  slot: number;
  tabId: number;
  site: string;
  receiver: string;
  action: FirewallAction;
}

export type FirewallRuleKind = 'receiver-block' | 'receiver-allow' | 'site-block' | 'site-allow' | 'once-block' | 'once-allow' | 'preset-block';
export type FirewallRuleRange = 'decisions' | 'preset' | 'session';

export interface CompiledFirewallRule {
  rule: AllowedDnrRule;
  range: FirewallRuleRange;
  kind: FirewallRuleKind;
  /** Decision key, `preset:<entryId>` or `once:<tabId>:<site>><receiver>` (outcome events carry it). */
  ruleKey: string;
  /** Receiver domain (preset: the entry host). */
  receiver: string;
  site: string | null;
  action: FirewallAction;
  scope: DecisionScope;
  origin: DecisionOrigin;
}

/** Why a decision has no DNR rule: an allow nothing overlaps, warn-only, over the rule limit, or rejected by the guard. */
export type FirewallDormantReason = 'not-needed' | 'warn-only' | 'rule-limit' | 'invalid';

export interface DormantDecision {
  decisionKey: string;
  reason: FirewallDormantReason;
}

export interface FirewallFeatures {
  /** DNR supports topDomains / excludedTopDomains (RuleConditionKeys); otherwise initiator conditions are used. */
  topDomains: boolean;
}

export function decisionKeyOf(scope: FirewallRuleScope, site: string | null, receiver: string): string {
  return scope === 'site' ? 'site:' + String(site) + '>' + receiver : 'everywhere:*>' + receiver;
}

/** Inverse of decisionKeyOf; null for anything else (preset / once keys included). */
export function parseDecisionKey(key: string): { scope: FirewallRuleScope; site: string | null; receiver: string } | null {
  if (typeof key !== 'string' || key.length > 512 || !FIREWALL_RULE_KEY_PATTERN.test(key)) return null;
  const colon = key.indexOf(':');
  const gt = key.indexOf('>');
  const scope = key.slice(0, colon) as FirewallRuleScope;
  const site = key.slice(colon + 1, gt);
  const receiver = key.slice(gt + 1);
  if (scope === 'everywhere') return site === '*' ? { scope, site: null, receiver } : null;
  return site === '*' ? null : { scope, site, receiver };
}

export function presetRuleKey(entryId: string): string {
  return 'preset:' + entryId;
}

export function onceRuleKey(tabId: number, site: string, receiver: string): string {
  return 'once:' + String(tabId) + ':' + site + '>' + receiver;
}

/** Receiver of a rule key of any kind (decision, preset excluded: the caller maps entry ids), or null. */
export function receiverOfRuleKey(key: string): string | null {
  if (key.startsWith('once:')) {
    const gt = key.indexOf('>');
    return gt < 0 ? null : key.slice(gt + 1);
  }
  return parseDecisionKey(key)?.receiver ?? null;
}

function siteCondition(site: string, features: FirewallFeatures): AllowedDnrCondition {
  return features.topDomains ? { topDomains: [site] } : { initiatorDomains: [site] };
}

function notOnOwnSite(domain: string, features: FirewallFeatures, excludedSites: readonly string[] = []): AllowedDnrCondition {
  const domains = [domain];
  for (const s of excludedSites) if (s !== domain && !domains.includes(s)) domains.push(s);
  return features.topDomains ? { excludedTopDomains: domains } : { excludedInitiatorDomains: domains };
}

/** The module's excluded sites as rules list them: unique, sorted, at most maxExcludedSites. */
export function ruleExclusions(sites: readonly string[] | undefined): string[] {
  if (sites === undefined) return [];
  return [...new Set(sites)].sort().slice(0, PROTECT_BUDGETS.maxExcludedSites);
}

function presetOverlaps(entries: readonly FirewallPresetEntry[], receiver: string): boolean {
  for (const e of entries) if (domainMatches(e.host, receiver) || domainMatches(receiver, e.host)) return true;
  return false;
}

/** The preset entries that are compiled: only with the strict preset, at most maxPresetEntries, unique ids. */
export function activePresetEntries(entries: readonly FirewallPresetEntry[], preset: ProtectPreset): FirewallPresetEntry[] {
  if (preset !== 'strict') return [];
  const out: FirewallPresetEntry[] = [];
  const ids = new Set<string>();
  for (const e of entries) {
    if (out.length >= PROTECT_BUDGETS.maxPresetEntries) break;
    if (ids.has(e.entryId)) continue;
    ids.add(e.entryId);
    out.push(e);
  }
  return out;
}

function presetRule(entry: FirewallPresetEntry, index: number, features: FirewallFeatures, excludedSites: readonly string[]): CompiledFirewallRule | null {
  const site = registrableDomain(entry.host);
  if (site === null) return null;
  const target: AllowedDnrCondition = entry.pathPrefix === undefined ? { requestDomains: [entry.host] } : { urlFilter: '||' + entry.host + entry.pathPrefix };
  const rule: AllowedDnrRule = {
    id: PRESET_RULE_ID_BASE + index,
    priority: DNR_PRIORITIES.presetBlock,
    action: { type: 'block' },
    condition: { ...target, ...notOnOwnSite(site, features, excludedSites) },
  };
  if (!isAllowedRule(rule)) return null;
  return { rule, range: 'preset', kind: 'preset-block', ruleKey: presetRuleKey(entry.entryId), receiver: entry.host, site: null, action: 'block', scope: 'everywhere', origin: 'preset' };
}

export interface CompileInput {
  decisions: readonly FirewallDecision[];
  presetEntries: readonly FirewallPresetEntry[];
  preset: ProtectPreset;
  features: FirewallFeatures;
  /** Limit of dynamic rules (decisions + preset); default PROTECT_BUDGETS.maxDynamicRules. */
  maxDynamic?: number;
  /** The module's excluded sites (site names): «везде» and preset block rules do not act there (review TRUTH-01). */
  excludedSites?: readonly string[];
}

export interface CompileResult {
  /** Rules of the `decisions` and `preset` ranges, ids ascending. */
  dynamic: CompiledFirewallRule[];
  /** Decisions without a DNR rule and why. */
  dormant: DormantDecision[];
}

/** Decisions (slot order) and preset entries -> dynamic rules. Deterministic; never throws on stored data. */
export function compileRules(input: CompileInput): CompileResult {
  const decisions = [...input.decisions].sort((a, b) => a.slot - b.slot);
  if (input.preset === 'warn-only') return { dynamic: [], dormant: decisions.map((d) => ({ decisionKey: d.decisionKey, reason: 'warn-only' })) };
  const maxDynamic = Math.max(0, Math.min(input.maxDynamic ?? PROTECT_BUDGETS.maxDynamicRules, PROTECT_BUDGETS.maxDynamicRules));
  const presetEntries = activePresetEntries(input.presetEntries, input.preset);
  const excludedSites = ruleExclusions(input.excludedSites);
  const dynamic: CompiledFirewallRule[] = [];
  for (let i = 0; i < presetEntries.length && dynamic.length < maxDynamic; i++) {
    const r = presetRule(presetEntries[i]!, i, input.features, excludedSites);
    if (r !== null) dynamic.push(r);
  }
  const receiverBlocks = new Set<string>();
  for (const d of decisions) if (d.scope === 'everywhere' && d.action === 'block') receiverBlocks.add(d.receiver);
  const dormant: DormantDecision[] = [];
  for (const d of decisions) {
    let kind: FirewallRuleKind;
    let priority: number;
    let condition: AllowedDnrCondition;
    if (d.scope === 'everywhere') {
      if (d.action === 'block') {
        kind = 'receiver-block';
        priority = DNR_PRIORITIES.receiverBlock;
        condition = { requestDomains: [d.receiver], ...notOnOwnSite(d.receiver, input.features, excludedSites) };
      } else {
        if (!presetOverlaps(presetEntries, d.receiver)) {
          dormant.push({ decisionKey: d.decisionKey, reason: 'not-needed' });
          continue;
        }
        kind = 'receiver-allow';
        priority = DNR_PRIORITIES.receiverAllow;
        condition = { requestDomains: [d.receiver] };
      }
    } else {
      if (d.site === null) {
        dormant.push({ decisionKey: d.decisionKey, reason: 'invalid' });
        continue;
      }
      if (d.action === 'block') {
        kind = 'site-block';
        priority = DNR_PRIORITIES.siteBlock;
      } else {
        if (!receiverBlocks.has(d.receiver) && !presetOverlaps(presetEntries, d.receiver)) {
          dormant.push({ decisionKey: d.decisionKey, reason: 'not-needed' });
          continue;
        }
        kind = 'site-allow';
        priority = DNR_PRIORITIES.siteAllow;
      }
      condition = { requestDomains: [d.receiver], ...siteCondition(d.site, input.features) };
    }
    if (dynamic.length >= maxDynamic) {
      dormant.push({ decisionKey: d.decisionKey, reason: 'rule-limit' });
      continue;
    }
    const rule: AllowedDnrRule = { id: DECISION_RULE_ID_BASE + d.slot, priority, action: { type: d.action }, condition };
    if (!Number.isSafeInteger(d.slot) || d.slot < 0 || d.slot >= PROTECT_BUDGETS.maxDecisions || !isAllowedRule(rule)) {
      dormant.push({ decisionKey: d.decisionKey, reason: 'invalid' });
      continue;
    }
    dynamic.push({ rule, range: 'decisions', kind, ruleKey: d.decisionKey, receiver: d.receiver, site: d.site, action: d.action, scope: d.scope, origin: d.origin });
  }
  dynamic.sort((a, b) => a.rule.id - b.rule.id);
  return { dynamic, dormant };
}

export interface CompileOnceInput {
  once: readonly OnceRuleSpec[];
  decisions: readonly FirewallDecision[];
  presetEntries: readonly FirewallPresetEntry[];
  preset: ProtectPreset;
  features: FirewallFeatures;
}

export interface CompileOnceResult {
  session: CompiledFirewallRule[];
  /** Slots of once decisions without a rule (allow that nothing overlaps, warn-only, invalid). */
  dormant: Array<{ slot: number; reason: FirewallDormantReason }>;
}

/** `once` decisions -> session rules (tabIds [T]). Allow rules only where a block could match the same requests. */
export function compileOnceRules(input: CompileOnceInput): CompileOnceResult {
  const once = [...input.once].sort((a, b) => a.slot - b.slot);
  if (input.preset === 'warn-only') return { session: [], dormant: once.map((o) => ({ slot: o.slot, reason: 'warn-only' })) };
  const presetEntries = activePresetEntries(input.presetEntries, input.preset);
  const blocks = new Set<string>();
  for (const d of input.decisions) {
    if (d.action !== 'block') continue;
    blocks.add(d.scope === 'everywhere' ? '*>' + d.receiver : String(d.site) + '>' + d.receiver);
  }
  const session: CompiledFirewallRule[] = [];
  const dormant: Array<{ slot: number; reason: FirewallDormantReason }> = [];
  for (const o of once) {
    if (o.action === 'allow' && !blocks.has('*>' + o.receiver) && !blocks.has(o.site + '>' + o.receiver) && !presetOverlaps(presetEntries, o.receiver)) {
      dormant.push({ slot: o.slot, reason: 'not-needed' });
      continue;
    }
    const rule: AllowedDnrRule = {
      id: SESSION_RULE_ID_BASE + o.slot,
      priority: DNR_PRIORITIES.once,
      action: { type: o.action },
      condition: { requestDomains: [o.receiver], ...siteCondition(o.site, input.features), tabIds: [o.tabId] },
    };
    if (!Number.isSafeInteger(o.slot) || o.slot < 0 || o.slot >= PROTECT_BUDGETS.maxSessionRules || !isAllowedRule(rule)) {
      dormant.push({ slot: o.slot, reason: 'invalid' });
      continue;
    }
    session.push({
      rule,
      range: 'session',
      kind: o.action === 'block' ? 'once-block' : 'once-allow',
      ruleKey: onceRuleKey(o.tabId, o.site, o.receiver),
      receiver: o.receiver,
      site: o.site,
      action: o.action,
      scope: 'once',
      origin: 'user',
    });
  }
  return { session, dormant };
}

/** Deterministic text of a rule (change detection of a rule's activation time). */
export function ruleSignature(rule: AllowedDnrRule): string {
  return JSON.stringify(rule);
}
