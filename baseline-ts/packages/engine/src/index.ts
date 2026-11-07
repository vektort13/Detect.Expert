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
export { interpretReport, applyBatch, sameFindings } from './interpret';
export type { InterpretResult, ApplyResult } from './interpret';
export {
  projectReport,
  verifyProjection,
  walkAllowlist,
  summarizeTechniques,
  summarizeSources,
  hostEqualityRelation,
  EngineInvariantError,
  PROJECTION_ALLOWLIST,
  FINDING_ALLOWLIST,
  TECHNIQUE_SUMMARY_ALLOWLIST,
  VENDOR_SUMMARY_ALLOWLIST,
  SITE_RELATIONS,
} from './projection';
export type {
  ProjectionOptions,
  AllowSpec,
  SiteRelation,
  SiteRelationClassifier,
  SourceOptions,
  SourceSummary,
} from './projection';
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

export { attributionConfidence } from './attribution';
