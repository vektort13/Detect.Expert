// ADR-020 §C (S08): pure logic of the firewall — receiver checks, rule compilation, the local DNR evaluation and the
// preset table. No chrome.*, no clock, no network.

export { checkReceiver, isPresetReceiverHost } from './receiver';
export type { ReceiverCheck } from './receiver';
export {
  DECISION_RULE_ID_BASE,
  PRESET_RULE_ID_BASE,
  SESSION_RULE_ID_BASE,
  activePresetEntries,
  compileOnceRules,
  compileRules,
  decisionKeyOf,
  onceRuleKey,
  parseDecisionKey,
  presetRuleKey,
  receiverOfRuleKey,
  ruleSignature,
} from './rules';
export type {
  CompileInput,
  CompileOnceInput,
  CompileOnceResult,
  CompileResult,
  CompiledFirewallRule,
  DormantDecision,
  FirewallDecision,
  FirewallDormantReason,
  FirewallFeatures,
  FirewallPresetEntry,
  FirewallRuleKind,
  FirewallRuleRange,
  OnceRuleSpec,
} from './rules';
export { FirewallIndex, evaluateFirewall, ruleMatches } from './evaluate';
export type { FirewallMatch, FirewallRequest } from './evaluate';
export {
  PRESET_ENTRY_ID_PATTERN,
  PRESET_LIFECYCLES,
  PRESET_PATH_PREFIX_PATTERN,
  isSafePathPrefix,
  lintPresetEntries,
  parsePresetEntries,
  presetGatePassed,
} from './preset';
export type { FirewallPresetSeedEntry, PresetLifecycle, PresetLintOptions, PresetLintResult } from './preset';
