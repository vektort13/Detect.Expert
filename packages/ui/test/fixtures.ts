import { createExportPreview } from '../../export/src/index';
// Fixture projections for the view-model tests (no chrome.*).

import { EMPTY_DROPPED } from '@detect-expert/contracts';
import type { ExportPreview, Finding, ReportProjection, TechniqueSummary, VendorSummary } from '@detect-expert/contracts';

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
    ...overrides,
  };
}

export function preview(overrides: Partial<ExportPreview> = {}): ExportPreview {
  return { ...createExportPreview(report(), 1_757_680_500_000, true), ...overrides };
}
