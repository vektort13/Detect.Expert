import { createExportPreview } from '../../export/src/index';
// Fixture projections for the view-model tests (no chrome.*).

import { buildCatalogIndex } from '@detect-expert/catalog';
import type { CatalogIndex, CompiledRule } from '@detect-expert/catalog';
import { EMPTY_DROPPED, SENSOR_IDS } from '@detect-expert/contracts';
import type { ExportPreview, Finding, ReportProjection, ScopeState, SensorSetting, TechniqueSummary, VendorSummary } from '@detect-expert/contracts';

export function technique(overrides: Partial<TechniqueSummary> & { techniqueId: TechniqueSummary['techniqueId'] }): TechniqueSummary {
  return {
    count: 3,
    countQuality: 'exact',
    phases: ['returned-sync'],
    signalCodes: ['api-use'],
    evidenceSource: 'page-hook',
    integrity: 'page-controlled',
    interpretation: 'api-use',
    interpretationConfidence: 'unassessed',
    attributionConfidence: 'unknown',
    firstBucket: 1,
    lastBucket: 4,
    ...overrides,
  };
}

export function finding(overrides: Partial<Finding> & { findingId: string; techniqueId: Finding['techniqueId'] }): Finding {
  return {
    ruleId: 'rule-canvas-sequence',
    ruleVersion: '1',
    interpretation: 'possible-fingerprinting',
    interpretationConfidence: 'medium',
    evidenceIds: ['ev-1'],
    counterEvidenceCodes: ['image-editor'],
    limitationCodes: ['page-controlled-data'],
    vendorMatchIds: [],
    ...overrides,
  };
}

export function vendor(overrides: Partial<VendorSummary> & { vendorId: string }): VendorSummary {
  return {
    vendorConfidence: 'documented-resource',
    ruleIds: ['tmx-tags-endpoint'],
    evidenceSource: 'browser-network',
    integrity: 'browser-observed',
    ...overrides,
  };
}

export function report(overrides: Partial<ReportProjection> = {}): ReportProjection {
  return {
    reportRevision: 7,
    documentKey: '12:0:doc-a',
    host: 'example.com',
    coverageState: 'active',
    coverageFlags: [],
    techniques: [],
    findings: [],
    vendors: [],
    dropped: { ...EMPTY_DROPPED },
    observedSince: 1_700_000_000_000,
    scopeMode: 'active-tab',
    // S07: required since ADR-018; the UI logic for hosts is S08.
    hosts: [],
    // S10: required; null = the build's catalog has no active rules (local / production default).
    catalogVersion: null,
    ...overrides,
  };
}

/** S11: ScopeState with every sensor family enabled unless overridden per id. */
export function scope(overrides: Partial<ScopeState> = {}, sensors: Partial<Record<SensorSetting['sensorId'], Partial<SensorSetting>>> = {}): ScopeState {
  return {
    scopeMode: 'site',
    hosts: ['example.com'],
    grantedAllSites: false,
    managed: false,
    sensorSettings: {
      sensors: SENSOR_IDS.map((sensorId) => ({ sensorId, enabled: true, disabledBy: [], ...sensors[sensorId] })),
      organizationPolicy: 'absent',
      rejectedPolicyEntries: 0,
    },
    ...overrides,
  };
}

export function preview(overrides: Partial<ExportPreview> = {}): ExportPreview {
  return { ...createExportPreview(report(), 1_757_680_500_000, true), ...overrides };
}

/**
 * S10: a small production-kind catalog for view-model tests. Vendor names follow the seed; hosts are reserved
 * example names, and the rules exist only here (they are not real signatures and never ship).
 */
export function testCatalog(): CatalogIndex {
  const text = (ru: string, en: string) => ({ ru, en });
  const network = (host: string, path: string): CompiledRule['network'] => ({ scheme: 'https', port: null, hosts: [host], suffix: null, paths: [path], pathPattern: null, resourceType: 'script' });
  return buildCatalogIndex({
    kind: 'production',
    catalogVersion: '2026-10-17.ui000001',
    vendors: [
      { vendorId: 'threatmetrix', displayName: 'LexisNexis ThreatMetrix', category: 'device_fraud', purposeKey: 'card_vendor_threatmetrix_purpose' },
      { vendorId: 'datadome', displayName: 'DataDome Bot Protect', category: 'bot', purposeKey: 'card_vendor_category_bot' },
    ],
    rules: [
      { ruleId: 'tmx-tags-endpoint', ruleVersion: '3', vendorId: 'threatmetrix', evidenceOrigin: 'network_request', strength: 'documented-resource',
        network: network('tags.vendor-a.example', '/fp/tags.js'), expiresAtMs: 4_102_444_800_000, testOnly: false,
        meaning: text('Браузер получил тестовый ресурс A.', 'The browser received test resource A.'), limitations: text('Не означает исполнения A.', 'Does not mean A ran.') },
      { ruleId: 'datadome-host', ruleVersion: '1', vendorId: 'datadome', evidenceOrigin: 'network_request', strength: 'weak-signal',
        network: { scheme: 'https', port: null, hosts: ['js.vendor-b.example'], suffix: null, paths: [], pathPattern: null, resourceType: null },
        expiresAtMs: 4_102_444_800_000, testOnly: false,
        meaning: text('Запрос к адресу B.', 'A request to address B.'), limitations: text('Не означает исполнения B.', 'Does not mean B ran.') },
    ],
    candidateRuleCount: 20,
  });
}
