// @detect-expert/catalog — vendor catalog types, governance constants, compiler, frozen index, matcher and
// display helpers (ADR-009 v1.1). Pure code: no chrome.*, no network, no remote rules (REQ-010).
// The synthetic test catalog is exported separately as '@detect-expert/catalog/synthetic'.

export type {
  CatalogIndex,
  CatalogInput,
  CatalogKind,
  CompiledRule,
  CompiledVendor,
  EvidenceOrigin,
  LocalizedText,
  MatchResult,
  NetworkMatcher,
  NetworkRequestInput,
  ObservedResourceType,
  ParsedRequestInput,
  RuleLifecycle,
  RuleScheme,
  RuleStrength,
  SourceRule,
  SourceVendor,
  SuffixMatcher,
} from './types';
export {
  CATALOG_LIMITS,
  CATALOG_VERSION_PATTERN,
  CATEGORY_PURPOSE_KEYS,
  FIXTURE_KINDS,
  GENERIC_PURPOSE_KEY,
  MATCHER_NEGATIVE_CLASSES,
  MATCHER_NEGATIVE_MINIMUMS,
  MOCK_FIXTURE_KINDS,
  OBSERVED_RESOURCE_TYPES,
  PIPELINE_NEGATIVE_CLASSES,
  PROMOTION_CHAIN,
  RULE_LIFECYCLE,
  RUNTIME_EXPIRY_ACTIONS,
  SHARED_CDN_HOSTS,
  SPEC_PURPOSE_OVERRIDES,
  SYNTHETIC_MATCHER_NOTE,
  TERMINAL_LIFECYCLE,
  VENDOR_CATEGORIES,
  VENDOR_SPECIFIC_NEGATIVES,
} from './lifecycle';
export type { FixtureKind, MatcherNegativeClass, VendorCategory } from './lifecycle';
export {
  CATALOG_INPUTS,
  CompileError,
  FORBIDDEN_CONDITION_KEYS,
  canonicalCatalogJson,
  compileRule,
  compileVendor,
  emitCatalogModule,
  endOfUtcDayMs,
  productionModuleSpec,
  purposeKeyFor,
  syntheticModuleSpec,
} from './compile';
export type { CatalogModuleSpec } from './compile';
export { CatalogInvariantError, EMPTY_CATALOG, buildCatalogIndex, isTestHost } from './build-index';
export { EMPTY_MATCH, isReceivedStatus, matchNetworkRequest, matchParsedRequest } from './match';
export { MatcherFixtureError, negativeClassCounts, parseMatcherFixture, runMatcherFixture } from './harness';
export type { MatcherCollision, MatcherFailure, MatcherFixture, MatcherNegative, MatcherRecord, MatcherRunResult } from './harness';
export { ruleDisplay, vendorDisplay } from './display';
export type { RuleDisplay, VendorDisplay } from './display';
export { PRODUCTION_CATALOG } from './production';
