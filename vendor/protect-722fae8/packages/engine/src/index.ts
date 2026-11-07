// @detect-expert/engine — pure interpretation (spec Part VI I2): no chrome.*, no DOM, no network, no clock.
// Inputs are validated contract types; outputs are contract types plus UI view models with message keys.

export { satAdd, clampCount, worstQuality, sortByEnumOrder } from './arith';
export { mergeObservations, isDuplicateBatch, unionCoverageFlags } from './merge';
export type { MergeOptions, MergeResult } from './merge';
export {
  computeCoverageState,
  coverageStateOf,
  coverageRef,
  COVERAGE_PRECEDENCE,
  COVERAGE_FLAG_STATE,
  DEFAULT_COVERAGE_CONTEXT,
} from './coverage';
export type { CoverageContext } from './coverage';
export {
  RULES,
  runRules,
  canvasRule,
  evaluateCanvas,
  canvasStats,
  CANVAS_RULE_ID,
  CANVAS_RULE_VERSION,
  RULE_PARAMS,
  createGenericApiUseRule,
  API_USE_RULE_ID,
  API_USE_RULE_VERSION,
  findingId,
  evidenceIdsOf,
  makeFinding,
} from './rules/index';
export type { Rule, RuleInput, RulesResult, CanvasStats, FindingDraft } from './rules/index';
// S04 / E07-03: WebGL rule and the helpers shared by family rules.
export {
  webglRule,
  evaluateWebgl,
  webglStats,
  webglProbeMet,
  WEBGL_RULE_ID,
  WEBGL_RULE_VERSION,
  WEBGL_RULE_PARAMS,
  DEGRADING_FLAGS,
  DEGRADING_SIGNALS,
  isDegraded,
  capLow,
  sumCount,
  hasOp,
} from './rules/index';
export type { WebglStats } from './rules/index';
// S05 / E08-01, E08-03: Web Audio and Permissions rules.
export {
  audioRule,
  evaluateAudio,
  audioStats,
  audioSequenceMet,
  AUDIO_RULE_ID,
  AUDIO_RULE_VERSION,
  AUDIO_RULE_PARAMS,
  permissionsRule,
  evaluatePermissions,
  permissionStats,
  permissionsBreadthMet,
  PERMISSION_CATEGORY_OPERATIONS,
  PERMISSIONS_RULE_ID,
  PERMISSIONS_RULE_VERSION,
  PERMISSIONS_RULE_PARAMS,
} from './rules/index';
export type { AudioStats, PermissionStats } from './rules/index';
// S07 / ADR-018: browser-network rule.
export {
  networkRule,
  evaluateNetwork,
  looksRandomLabel,
  networkPatternMet,
  NETWORK_RULE_ID,
  NETWORK_RULE_VERSION,
  NETWORK_RULE_PARAMS,
  NETWORK_WINDOW_MATCHES_BUDGET,
} from './rules/index';
export type { NetworkRuleInput } from './rules/index';
export { interpretReport, applyBatch, sameFindings } from './interpret';
export type { InterpretResult, ApplyResult } from './interpret';
export {
  projectReport,
  verifyProjection,
  walkAllowlist,
  summarizeTechniques,
  summarizeSources,
  projectHosts,
  EngineInvariantError,
  PROJECTION_ALLOWLIST,
  HOST_ENTRY_ALLOWLIST,
  FINDING_ALLOWLIST,
  TECHNIQUE_SUMMARY_ALLOWLIST,
  VENDOR_SUMMARY_ALLOWLIST,
  SITE_RELATIONS,
} from './projection';
export type {
  ProjectionOptions,
  ProjectionCatalog,
  AllowSpec,
  SiteRelation,
  SourceOptions,
  SourceSummary,
} from './projection';
// S10 / ADR-009 v1.1: vendor aggregation (pure; the catalog itself lives in @detect-expert/catalog).
export { deriveVendors, deriveVendorsFromSignals, activeRule, catalogViewActive, MAX_RULE_IDS_PER_VENDOR, MAX_VENDORS } from './vendors';
export type { VendorRuleView, VendorCatalogView, VendorSignal } from './vendors';
export {
  toPopupViewModel,
  coverageViewModel,
  countViewModel,
  formatNumber,
  POPUP_MAX_CARDS,
  COVERAGE_TITLE_KEYS,
  COVERAGE_FLAG_KEYS,
  CONFIDENCE_KEYS,
  COUNT_QUALITY_KEYS,
  LIMITATION_KEYS,
  COUNTER_EVIDENCE_KEYS,
} from './viewmodel';
export type {
  MessageRef,
  MessageParam,
  CardType,
  CardViewModel,
  CountViewModel,
  CoverageViewModel,
  PopupViewModel,
  PopupViewModelOptions,
} from './viewmodel';
// S12 / E13-03: toolbar badge (categories with findings; empty instead of '0').
export { BADGE_INTERPRETATIONS, BADGE_STATUS_KEYS, badgeCategoryCount, badgeView } from './badge';
export type { BadgeSub, BadgeTitle, BadgeView } from './badge';
export { LIMITATION_CODES, COUNTER_EVIDENCE_CODES, ALL_LIMITATION_CODES, ALL_COUNTER_EVIDENCE_CODES } from './codes';
export type { LimitationCode, CounterEvidenceCode } from './codes';
export {
  TECHNIQUE_CATEGORIES,
  techniqueCategory,
  CANVAS_TECHNIQUE_IDS,
  CANVAS_READOUT_TECHNIQUE_IDS,
  isCanvasTechnique,
  TECHNIQUE_LABEL_KEYS,
  TECHNIQUE_API_NAMES,
} from './techniques';
export type { TechniqueCategory, CanvasTechniqueId } from './techniques';
// S04 / E07-03: WebGL family.
export { WEBGL_TECHNIQUE_IDS, isWebglTechnique } from './techniques';
export type { WebglTechniqueId } from './techniques';
// S05 / E08-01, E08-03: Web Audio and Permissions families.
export { AUDIO_TECHNIQUE_IDS, isAudioTechnique, PERMISSION_TECHNIQUE_IDS, isPermissionTechnique } from './techniques';
export type { AudioTechniqueId, PermissionTechniqueId } from './techniques';
// S06 / E08-02, E07-02: environment and geometry families (generic api-use only), common surfaces.
export {
  ENVIRONMENT_TECHNIQUE_IDS,
  isEnvironmentTechnique,
  GEOMETRY_TECHNIQUE_IDS,
  isGeometryTechnique,
  COMMON_SURFACE_TECHNIQUE_IDS,
  isCommonSurfaceTechnique,
} from './techniques';
export type { EnvironmentTechniqueId, GeometryTechniqueId } from './techniques';
export { EXTRA_LIMITATIONS } from './rules/api-use';
// S07 / ADR-018: browser-network techniques (SW only; excluded from page-hook summaries).
export { NETWORK_TECHNIQUE_IDS, PAGE_HOOK_EXCLUDED_TECHNIQUE_IDS, isNetworkTechnique } from './techniques';
export type { NetworkTechniqueId } from './techniques';

export { attributionConfidence } from './attribution';

// ADR-020 «Защита» (S04): pure logic of the opt-in module (no chrome.*); lanes add modules under ./protect.
export * from './protect/index';
