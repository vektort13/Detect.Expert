import { createExportPreview } from '../../export/src/index';
// Guards against drift between the TypeScript source of truth, the committed JSON Schemas, the pack's
// baseline budgets and the pack's proposed page-batch schema.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTION_CONFIDENCES,
  BRIDGE_CONTROL_COMMANDS,
  BRIDGE_STOP_REASONS,
  BUDGETS,
  COUNT_QUALITIES,
  COVERAGE_FLAGS,
  COVERAGE_STATES,
  DOCUMENT_LIFECYCLES,
  EMPTY_DROPPED,
  EVIDENCE_SOURCES,
  INTEGRITIES,
  INTERPRETATIONS,
  INTERPRETATION_CONFIDENCES,
  PHASES,
  SCOPE_MODES,
  SENSOR_STATES,
  SIGNAL_CODES,
  TECHNIQUE_IDS,
  UI_ERROR_CODES,
  VENDOR_MATCHES,
  counterKey,
  makeDocumentKey,
  type Ack,
  type DocumentReport,
  type ExportPreview,
  type ReportProjection,
  type UiResponse,
} from '../src/index';
import { compileSchema, loadSchema, makeAjv, repoRoot, schemasDir, type JsonSchema } from './helpers';

const packDir = join(repoRoot, 'Doc', 'Detector_Implementation_Pack', 'Detector_Implementation_Pack');

function defs(): Record<string, JsonSchema> {
  return loadSchema('common.v1.schema.json')['$defs'] as Record<string, JsonSchema>;
}

describe('schema enums match TypeScript enums', () => {
  const table: Array<[string, readonly string[]]> = [
    ['techniqueId', TECHNIQUE_IDS],
    ['signalCode', SIGNAL_CODES],
    ['coverageFlag', COVERAGE_FLAGS],
    ['evidenceSource', EVIDENCE_SOURCES],
    ['integrity', INTEGRITIES],
    ['interpretation', INTERPRETATIONS],
    ['interpretationConfidence', INTERPRETATION_CONFIDENCES],
    ['attributionConfidence', ATTRIBUTION_CONFIDENCES],
    ['vendorConfidence', VENDOR_MATCHES],
    ['coverageState', COVERAGE_STATES],
    ['countQuality', COUNT_QUALITIES],
    ['phase', PHASES],
    ['scopeMode', SCOPE_MODES],
    ['sensorState', SENSOR_STATES],
    ['bridgeStopReason', BRIDGE_STOP_REASONS],
    ['bridgeControlCommand', BRIDGE_CONTROL_COMMANDS],
    ['documentLifecycle', DOCUMENT_LIFECYCLES],
    ['uiErrorCode', UI_ERROR_CODES],
  ];
  for (const [def, values] of table) {
    it(def, () => {
      expect(defs()[def]?.['enum']).toEqual([...values]);
    });
  }

  it('technique ids are exactly DET-001..DET-069', () => {
    expect(TECHNIQUE_IDS).toHaveLength(69);
    expect(TECHNIQUE_IDS[0]).toBe('DET-001');
    expect(TECHNIQUE_IDS[68]).toBe('DET-069');
    expect(new Set(TECHNIQUE_IDS).size).toBe(69);
  });

  it('canonical enum values from docs/PROJECT_RULES.md are present verbatim', () => {
    expect([...EVIDENCE_SOURCES]).toEqual(['browser-network', 'browser-navigation', 'page-hook', 'page-dom', 'derived']);
    expect([...INTEGRITIES]).toEqual(['browser-observed', 'page-controlled', 'derived']);
    expect([...COVERAGE_STATES]).toEqual(['active', 'partial', 'late-start', 'paused', 'unsupported', 'no-access', 'degraded']);
    expect([...COUNT_QUALITIES]).toEqual(['exact', 'sampled', 'lower-bound']);
    expect([...PHASES]).toEqual(['attempted', 'returned-sync', 'threw-sync', 'async-returned', 'settlement-unobserved']);
  });
});

describe('all schemas compile under Ajv strict mode', () => {
  for (const name of [
    'page-batch.v1.schema.json',
    'ack.v1.schema.json',
    'page-message.v1.schema.json',
    'bridge-control.v1.schema.json',
    'ui-request.v1.schema.json',
    'ui-response.v1.schema.json',
    'report-projection.v1.schema.json',
    'document-report.v1.schema.json',
  ]) {
    it(name, () => {
      expect(() => compileSchema(name)).not.toThrow();
      expect(loadSchema(name)['$schema']).toBe('https://json-schema.org/draft/2020-12/schema');
    });
  }

  it('common schema compiles', () => {
    const validate = makeAjv().getSchema('urn:detect-expert:contracts:common:v1');
    expect(typeof validate).toBe('function');
  });

  it('schemas directory is where the package exports point', () => {
    expect(schemasDir.endsWith('schemas')).toBe(true);
  });
});

describe('BUDGETS match the pack baseline budgets (Part VI, I1)', () => {
  const baseline = JSON.parse(readFileSync(join(packDir, 'contracts', 'baseline-budgets.json'), 'utf8')) as Record<string, unknown>;
  it('numbers agree', () => {
    expect(BUDGETS.maxBatchEvents).toBe(baseline['maxBatchEvents']);
    expect(BUDGETS.maxBatchBytes).toBe(baseline['maxBatchBytes']);
    expect(BUDGETS.maxStringChars).toBe(baseline['maxStringChars']);
    expect(BUDGETS.maxBatchesPerSecondPerDocument).toBe(baseline['maxBatchesPerSecondPerDocument']);
    expect(BUDGETS.maxBatchesPerSecondPerTab).toBe(baseline['maxBatchesPerSecondPerTab']);
    expect(BUDGETS.maxBatchesPerSecondGlobal).toBe(baseline['maxBatchesPerSecondGlobal']);
    expect(BUDGETS.maxBridgeRecordsPerDocument).toBe(baseline['maxBridgeRecordsPerDocument']);
    expect([BUDGETS.flushMinMs, BUDGETS.flushMaxMs]).toEqual(baseline['flushMsRange']);
    expect(BUDGETS.maxReportSerializedBytes).toBe(baseline['maxReportSerializedBytes']);
    expect(BUDGETS.maxSessionTotalBytes).toBe(baseline['maxSessionTotalBytes']);
    expect(BUDGETS.inactiveDocumentTtlMs).toBe((baseline['inactiveDocumentTtlSeconds'] as number) * 1000);
    expect(BUDGETS.maxDiagnosticsBytes).toBe(baseline['maxDiagnosticsBytesIncludedInTotal']);
    expect(BUDGETS.diagnosticsTtlMs).toBe((baseline['diagnosticTtlSeconds'] as number) * 1000);
    expect(BUDGETS.maxOutOfOrderEntriesGlobal).toBe(baseline['maxOutOfOrderEntriesGlobal']);
    expect(BUDGETS.outOfOrderTtlMs).toBe(baseline['outOfOrderTtlMs']);
    expect(BUDGETS.maxMathStackSamplesPerWindow).toBe(baseline['maxMathStackSamplesPerTwoSeconds']);
    expect(BUDGETS.mathSampleWindowMs).toBe(2000);
    expect(BUDGETS.maxCountersPerDocumentGroup).toBe(128);
    expect(BUDGETS.maxFindingsPerDocument).toBe(256);
    expect(BUDGETS.maxHostsPerDocument).toBe(128);
    expect(BUDGETS.mathAttributionSlots).toBe(32);
    expect(BUDGETS.maxCount).toBe(2 ** 31 - 1);
  });
});

describe('pack page-batch.schema.json is a subset of v1', () => {
  const pack = JSON.parse(readFileSync(join(packDir, 'contracts', 'page-batch.schema.json'), 'utf8')) as JsonSchema;
  const items = ((pack['properties'] as JsonSchema)['observations'] as JsonSchema)['items'] as JsonSchema;
  const props = items['properties'] as Record<string, JsonSchema>;
  it('technique enum identical', () => {
    expect(props['techniqueId']?.['enum']).toEqual([...TECHNIQUE_IDS]);
  });
  it('pack signal codes are all known in v1', () => {
    const packCodes = ((props['signalCodes'] as JsonSchema)['items'] as JsonSchema)['enum'] as string[];
    for (const code of packCodes) expect(SIGNAL_CODES).toContain(code);
  });
});

describe('typed samples validate against their schemas', () => {
  const projection: ReportProjection = {
    reportRevision: 4,
    documentKey: makeDocumentKey(12, 0, 'A1B2C3'),
    host: 'example.com',
    coverageState: 'partial',
    coverageFlags: ['late-start', 'worker-not-observed', 'network-limited', 'frames-inaccessible'],
    techniques: [
      {
        techniqueId: 'DET-001',
        count: 2,
        countQuality: 'exact',
        phases: ['attempted', 'returned-sync'],
        signalCodes: ['api-use', 'readback-after-text'],
        evidenceSource: 'page-hook',
        integrity: 'page-controlled',
        interpretation: 'possible-fingerprinting',
        interpretationConfidence: 'low',
        attributionConfidence: 'unknown',
        firstBucket: 1,
        lastBucket: 9,
      },
    ],
    findings: [
      {
        findingId: 'f-1',
        ruleId: 'canvas-readback-after-text',
        ruleVersion: '1',
        techniqueId: 'DET-001',
        interpretation: 'possible-fingerprinting',
        interpretationConfidence: 'low',
        evidenceIds: ['e-1'],
        counterEvidenceCodes: ['editor-like-usage'],
        limitationCodes: ['late-start'],
        vendorMatchIds: [],
      },
    ],
    vendors: [{ vendorId: 'cloudflare', vendorConfidence: 'weak-signal', ruleIds: ['cloudflare-bot-cookie'], evidenceSource: 'browser-network', integrity: 'browser-observed' }],
    dropped: { ...EMPTY_DROPPED },
    observedSince: 1_757_000_000_000,
    scopeMode: 'site',
  };

  it('ReportProjection', () => {
    expect(compileSchema('report-projection.v1.schema.json')(projection)).toBe(true);
  });

  it('P07: optional ring loss lower bound is a bounded integer, old projections remain valid', () => {
    const validate = compileSchema('report-projection.v1.schema.json');
    expect(validate(projection)).toBe(true);
    for (const ring of [0, 1, 2147483647]) expect(validate({ ...projection, dropped: { ...projection.dropped, ring } })).toBe(true);
    for (const ring of [-1, 1.5, 2147483648, '1', null]) expect(validate({ ...projection, dropped: { ...projection.dropped, ring } })).toBe(false);
  });

  it('F040 accepts every vendorConfidence tier in projections and export previews', () => {
    const validateReport = compileSchema('report-projection.v1.schema.json');
    const validateResponse = compileSchema('ui-response.v1.schema.json');
    for (const vendorConfidence of VENDOR_MATCHES) {
      const report: ReportProjection = {
        ...projection,
        vendors: [{ vendorId: 'candidate', vendorConfidence, ruleIds: [], evidenceSource: 'browser-network', integrity: 'browser-observed' }],
      };
      expect(validateReport(report)).toBe(true);
      expect(validateResponse({
        schemaVersion: 1,
        type: 'export-preview',
        preview: createExportPreview(report, 0),
      })).toBe(true);
    }
  });

  it('F040 rejects the legacy vendorMatch field, dual aliases and invalid confidence', () => {
    const validate = compileSchema('report-projection.v1.schema.json');
    const base = { vendorId: 'candidate', ruleIds: [], evidenceSource: 'browser-network', integrity: 'browser-observed' };
    for (const fields of [
      {},
      { vendorMatch: 'weak-signal' },
      { vendorConfidence: 'weak-signal', vendorMatch: 'weak-signal' },
      { vendorConfidence: 'high' },
      { vendorConfidence: null },
    ]) {
      expect(validate({ ...projection, vendors: [{ ...base, ...fields }] })).toBe(false);
    }
  });

  it('DocumentReport', () => {
    const report: DocumentReport = {
      schemaVersion: 1,
      documentKey: projection.documentKey,
      tabId: 12,
      frameId: 0,
      documentId: 'A1B2C3',
      host: 'example.com',
      lifecycle: 'committed',
      createdAt: 1_757_000_000_000,
      updatedAt: 1_757_000_001_000,
      revision: 4,
      coverageState: 'partial',
      coverageFlags: ['late-start', 'network-limited', 'frames-inaccessible'],
      counters: [
        { techniqueId: 'DET-001', phase: 'attempted', signalCodes: ['api-use'], count: 2, countQuality: 'exact', firstBucket: 1, lastBucket: 9 },
      ],
      findings: projection.findings,
      hosts: [
        { registrableDomain: 'cloudflare.com', relation: 'cross-site', evidenceSource: 'browser-network', integrity: 'browser-observed', requestCount: 1, firstSeenBucket: 0, lastSeenBucket: 0, ruleIds: [] },
      ],
      watermark: { bridgeSessionId: 'bridge-1', lastCommittedBatchSeq: 3 },
      dropped: { ...EMPTY_DROPPED, transport: 1 },
    };
    expect(compileSchema('document-report.v1.schema.json')(report)).toBe(true);
  });

  it('Ack and UiResponse', () => {
    const ack: Ack = { schemaVersion: 1, type: 'ack', lastCommittedBatchSeq: 0, paused: false, protocolOk: true };
    expect(compileSchema('ack.v1.schema.json')(ack)).toBe(true);
    const preview: ExportPreview = createExportPreview(projection, 1_757_000_002_000);
    const responses: UiResponse[] = [
      { schemaVersion: 1, type: 'report', report: projection },
      { schemaVersion: 1, type: 'report', report: null },
      { schemaVersion: 1, type: 'ok', reportRevision: 5 },
      { schemaVersion: 1, type: 'scope', scope: { scopeMode: 'off', hosts: [], grantedAllSites: false, managed: false } },
      { schemaVersion: 1, type: 'export-preview', preview },
      { schemaVersion: 1, type: 'error', code: 'stale-revision' },
    ];
    const validate = compileSchema('ui-response.v1.schema.json');
    for (const r of responses) expect(validate(r)).toBe(true);
    expect(validate({ schemaVersion: 1, type: 'report', report: { ...projection, host: 'https://example.com' } })).toBe(false);
  });

  it('counterKey is order-insensitive for signal codes', () => {
    expect(counterKey('DET-001', 'attempted', ['readback-after-text', 'api-use'])).toBe('DET-001|attempted|api-use,readback-after-text');
    expect(makeDocumentKey(3, 1, 'X')).toBe('3:1:X');
  });
});
