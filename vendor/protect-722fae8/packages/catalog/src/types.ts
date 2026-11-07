// Vendor catalog types (ADR-009 v1.1). Compiled rules are plain frozen data built at release time from the
// local evidence registry; nothing here is fetched or interpreted from remote data (REQ-010).

/** Ordered rule lifecycle; deprecated and revoked are terminal states outside the promotion chain. */
export type RuleLifecycle =
  | 'documented_candidate'
  | 'lab_fixture_verified'
  | 'security_privacy_reviewed'
  | 'release_candidate'
  | 'production_approved'
  | 'deprecated'
  | 'revoked';

/** webRequest resource types a network rule may name (main_frame is never matched). */
export type ObservedResourceType =
  | 'script'
  | 'xmlhttprequest'
  | 'sub_frame'
  | 'ping'
  | 'image'
  | 'media'
  | 'font'
  | 'stylesheet'
  | 'other';

export type RuleScheme = 'https' | 'http';

export type EvidenceOrigin = 'network_request' | 'cookie_name' | 'global_name' | 'dom_attribute';

/** Rule strength before any per-document aggregation; never a site-safety verdict (REQ-007). */
export type RuleStrength = 'documented-resource' | 'weak-signal';

export interface LocalizedText {
  readonly ru: string;
  readonly en: string;
}

/** Host-suffix condition: the request host is `labels` or exactly one extra label in front of it. */
export interface SuffixMatcher {
  readonly labels: string;
  /** Applied to the single leftmost label only; strict local dialect (scripts/catalog-checks.mjs). */
  readonly leftmost: RegExp | null;
}

export interface NetworkMatcher {
  readonly scheme: RuleScheme;
  /** null means the scheme's default port; an explicit port is allowed for testOnly rules only. */
  readonly port: number | null;
  readonly hosts: readonly string[];
  readonly suffix: SuffixMatcher | null;
  /** Exact pathnames (as WHATWG serializes them, not decoded). Empty with pathPattern null: any path. */
  readonly paths: readonly string[];
  readonly pathPattern: RegExp | null;
  readonly resourceType: ObservedResourceType | null;
}

export interface CompiledRule {
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly vendorId: string;
  readonly evidenceOrigin: EvidenceOrigin;
  readonly strength: RuleStrength;
  /** null for cookie/global/DOM rules: there is no browser-network matcher for them. */
  readonly network: NetworkMatcher | null;
  /** Exclusive end of the UTC day named by expiresAt; the rule never matches at or after it. */
  readonly expiresAtMs: number;
  readonly testOnly: boolean;
  readonly meaning: LocalizedText;
  readonly limitations: LocalizedText;
}

export interface CompiledVendor {
  readonly vendorId: string;
  readonly displayName: string;
  readonly category: string;
  /** Locale message key for the general purpose of the vendor category. */
  readonly purposeKey: string;
}

export type CatalogKind = 'production' | 'test';

export interface CatalogIndex {
  readonly kind: CatalogKind;
  readonly catalogVersion: string;
  readonly rules: readonly CompiledRule[];
  readonly rulesById: ReadonlyMap<string, CompiledRule>;
  readonly vendorsById: ReadonlyMap<string, CompiledVendor>;
  readonly networkByHost: ReadonlyMap<string, readonly CompiledRule[]>;
  readonly networkBySuffix: ReadonlyMap<string, readonly CompiledRule[]>;
  /** Unverified research candidates that exist in the registry but are not part of this index. */
  readonly candidateRuleCount: number;
}

export interface CatalogInput {
  readonly kind: CatalogKind;
  readonly catalogVersion: string;
  readonly vendors: readonly CompiledVendor[];
  readonly rules: readonly CompiledRule[];
  readonly candidateRuleCount: number;
}

/** Seed/overlay rule as stored in packages/catalog/data/vendors.seed.json and rules/sources (JSON shape). */
export interface SourceRule {
  readonly id: string;
  readonly vendorId: string;
  readonly evidenceOrigin: string;
  readonly conditions: Readonly<Record<string, unknown>>;
  readonly expiresAt: string;
  readonly meaningRu: string;
  readonly limitationsRu: string;
  readonly meaningEn?: string;
  readonly limitationsEn?: string;
  readonly ruleVersion?: string;
  readonly version?: string;
  readonly testOnly?: boolean;
}

export interface SourceVendor {
  readonly id: string;
  readonly name: string;
  readonly category: string;
}

export interface NetworkRequestInput {
  readonly url: unknown;
  readonly resourceType: unknown;
  readonly statusCode: unknown;
}

export interface ParsedRequestInput {
  readonly scheme: unknown;
  readonly hostname: unknown;
  readonly port: unknown;
  readonly pathname: unknown;
  readonly resourceType: unknown;
  readonly statusCode: unknown;
}

/** Sorted unique rule ids, at most MAX_MATCHED_RULES, frozen. */
export type MatchResult = readonly string[];
