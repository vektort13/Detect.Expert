// Catalog governance constants (ADR-009 v1.1, rules/sources/README.md). Single source for the TypeScript
// catalog and for scripts/catalog-registry.mjs, which loads this module through an in-memory esbuild bundle.
// Data only: type-only imports, no side effects; top-level calls are marked pure for tree shaking.

import type { ObservedResourceType, RuleLifecycle } from './types';

/** Promotion order; deprecated/revoked are terminal and never part of a production catalog. */
export const RULE_LIFECYCLE: readonly RuleLifecycle[] = /* @__PURE__ */ Object.freeze([
  'documented_candidate',
  'lab_fixture_verified',
  'security_privacy_reviewed',
  'release_candidate',
  'production_approved',
  'deprecated',
  'revoked',
] as const);

/** Stages whose gates accumulate (each stage requires every earlier one). */
export const PROMOTION_CHAIN: readonly RuleLifecycle[] = /* @__PURE__ */ Object.freeze(RULE_LIFECYCLE.slice(0, 5));

export const TERMINAL_LIFECYCLE: readonly RuleLifecycle[] = /* @__PURE__ */ Object.freeze(['deprecated', 'revoked'] as const);

/** Only disable at runtime; a stale rule never silently stays "matched" (ADR-009 §6, v1.1). */
export const RUNTIME_EXPIRY_ACTIONS = /* @__PURE__ */ Object.freeze(['disable'] as const);

export const VENDOR_CATEGORIES = /* @__PURE__ */ Object.freeze([
  'bot_challenge',
  'bot',
  'bot_fraud',
  'challenge',
  'device_fraud',
  'fraud',
  'behavioral_fraud',
  'identity_fraud',
  'payment_fraud',
] as const);
export type VendorCategory = (typeof VENDOR_CATEGORIES)[number];

export const CATEGORY_PURPOSE_KEYS: Readonly<Record<VendorCategory, string>> = /* @__PURE__ */ Object.freeze({
  bot_challenge: 'card_vendor_category_bot_challenge',
  bot: 'card_vendor_category_bot',
  bot_fraud: 'card_vendor_category_bot_fraud',
  challenge: 'card_vendor_category_challenge',
  device_fraud: 'card_vendor_category_device_fraud',
  fraud: 'card_vendor_category_fraud',
  behavioral_fraud: 'card_vendor_category_behavioral_fraud',
  identity_fraud: 'card_vendor_category_identity_fraud',
  payment_fraud: 'card_vendor_category_payment_fraud',
});

/** Purpose wording fixed by the spec for specific vendors (overrides the category key). */
export const SPEC_PURPOSE_OVERRIDES: Readonly<Record<string, string>> = /* @__PURE__ */ Object.freeze({
  threatmetrix: 'card_vendor_threatmetrix_purpose',
});

export const GENERIC_PURPOSE_KEY = 'card_vendor_purpose_generic';

export const OBSERVED_RESOURCE_TYPES: readonly ObservedResourceType[] = /* @__PURE__ */ Object.freeze([
  'script',
  'xmlhttprequest',
  'sub_frame',
  'ping',
  'image',
  'media',
  'font',
  'stylesheet',
  'other',
] as const);

/** Browser-pipeline negatives every rule needs before lab_fixture_verified (rules/sources/README.md §5). */
export const PIPELINE_NEGATIVE_CLASSES = /* @__PURE__ */ Object.freeze([
  'documentation-text',
  'dom-without-load',
  'aborted-request',
  'not-received',
  'nested-cross-origin-iframe',
  'late-consent',
  'spa-navigation',
  'self-hosted',
  'no-host-permission',
  'page-forgery',
  'loaded-but-unused',
] as const);

/** Vendor-specific negatives from the spec (Part IV); required in addition to the pipeline set. */
export const VENDOR_SPECIFIC_NEGATIVES: Readonly<Record<string, readonly string[]>> = /* @__PURE__ */ Object.freeze({
  cloudflare: Object.freeze(['cdn-only', 'load-balancer-cookie', 'rate-limiting-cookie']),
  aws_waf: Object.freeze(['challenge-sdk-without-bot-control']),
  stripe: Object.freeze(['payment-sdk-without-risk-endpoint']),
  google_recaptcha: Object.freeze(['hcaptcha-grecaptcha-compat']),
  human: Object.freeze(['generic-px-cookie-collision']),
});

/** Negative record classes of a synthetic matcher fixture (parser/normalization only). */
export const MATCHER_NEGATIVE_CLASSES = /* @__PURE__ */ Object.freeze([
  'similar-hostname',
  'scheme',
  'port',
  'path',
  'resource-type',
  'not-received',
  'url-substring',
  'shared-cdn',
  'encoded-path',
  'label-shape',
] as const);
export type MatcherNegativeClass = (typeof MATCHER_NEGATIVE_CLASSES)[number];

/** Minimum number of records per class that every network matcher fixture carries. */
export const MATCHER_NEGATIVE_MINIMUMS: Readonly<Partial<Record<MatcherNegativeClass, number>>> = /* @__PURE__ */ Object.freeze({
  'similar-hostname': 3,
  scheme: 1,
  port: 1,
  'not-received': 2,
  'url-substring': 1,
  'shared-cdn': 2,
});

/** Hosts shared by many sites; a host-only rule on them would be meaningless (shared-cdn negatives). */
export const SHARED_CDN_HOSTS = /* @__PURE__ */ Object.freeze(['cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com', 'www.google.com'] as const);

export const FIXTURE_KINDS = /* @__PURE__ */ Object.freeze(['synthetic-matcher', 'browser-synthetic', 'authorized-integration'] as const);
export type FixtureKind = (typeof FIXTURE_KINDS)[number];

/** Fixture kinds that never raise maturity of a non-testOnly rule ("a mock does not promote"). */
export const MOCK_FIXTURE_KINDS = /* @__PURE__ */ Object.freeze(['synthetic-matcher', 'browser-synthetic'] as const);

export const SYNTHETIC_MATCHER_NOTE =
  'Synthetic URL records derived from documented conditions; they test parser/normalization only and do not prove the signature exists in the real SDK.';

/** Hard limits of the compiled catalog and matcher (REQ-011). */
export const CATALOG_LIMITS = /* @__PURE__ */ Object.freeze({
  maxRules: 256,
  maxHostsPerRule: 16,
  maxPathsPerRule: 16,
  maxPathChars: 512,
  maxUrlChars: 8192,
  maxHostChars: 253,
  maxLabelChars: 63,
  maxMatchedRules: 8,
  maxIdChars: 64,
  maxTextChars: 512,
  maxFixturePositives: 32,
  maxFixtureNegatives: 64,
  maxFixtureUrlChars: 2048,
});

export const RULE_ID_PATTERN = /^[a-z0-9-]{1,64}$/;
export const VENDOR_ID_PATTERN = /^[a-z0-9_-]{1,64}$/;
export const CATALOG_VERSION_PATTERN = /^[A-Za-z0-9.-]{1,64}$/;
export const RULE_VERSION_PATTERN = /^[A-Za-z0-9.-]{1,32}$/;
export const HOST_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
