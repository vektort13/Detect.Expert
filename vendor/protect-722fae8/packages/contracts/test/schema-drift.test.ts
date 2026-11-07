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
  EMPTY_NETWORK_PATTERNS,
  EVIDENCE_SOURCES,
  HOST_CATEGORIES,
  INTEGRITIES,
  INTERPRETATIONS,
  INTERPRETATION_CONFIDENCES,
  OPERATION_CODES,
  ORGANIZATION_POLICY_STATES,
  PAGE_OPERATIONS,
  PHASES,
  SCOPE_MODES,
  SENSOR_DISABLE_SOURCES,
  SENSOR_IDS,
  SENSOR_STATES,
  SIGNAL_CODES,
  SITE_RELATIONS,
  TECHNIQUE_IDS,
  UI_ERROR_CODES,
  VENDOR_MATCHES,
  DECISION_ORIGINS,
  DECISION_SCOPES,
  DELIVERY_STATES,
  ENFORCEMENT_DEGRADED,
  ENFORCEMENT_STATES,
  FIELD_KINDS,
  FINGERPRINT_ENCODINGS,
  FINGERPRINT_TRIGGERS,
  FIREWALL_ACTIONS,
  FIREWALL_INACTIVE_REASONS,
  FIREWALL_NOTICE_KINDS,
  FIREWALL_RULE_SCOPES,
  FIREWALL_SENDER_FRAMES,
  FRAME_CONTEXTS,
  GPC_HEADER_EVIDENCE,
  GPC_SITE_STATES,
  HISTORY_FAMILIES,
  HISTORY_STORAGE_STATES,
  LINK_MECHANISMS,
  LISTEN_EVENT_CODES,
  LISTEN_TARGET_KINDS,
  PROTECT_CONTROL_COMMANDS,
  PROTECT_FEATURES,
  PROTECT_HTTP_METHODS,
  PROTECT_KINDS,
  PROTECT_LIMITATIONS,
  PROTECT_MODULE_STATES,
  PROTECT_PRESETS,
  PROTECT_PURGE_TARGETS,
  PROTECT_REGISTRATION_HOOK_POINTS,
  PROTECT_REQUEST_KINDS,
  PROTECT_SEND_HOOK_POINTS,
  RECIPIENT_CHANNELS,
  REPLAY_BODY_SIZES,
  REPLAY_INPUT_MASKING,
  REPLAY_LEVELS,
  REPLAY_SIGNAL_CODES,
  REQUEST_DELIVERIES,
  REQUEST_ENDPOINT_SCHEMES,
  REQUEST_FACT_KINDS,
  REQUEST_IDENTITY_KINDS,
  REQUEST_JURISDICTIONS,
  REQUEST_KINDS,
  REQUEST_LETTER_LANGS,
  REQUEST_SOURCE_KINDS,
  REQUEST_STATUSES,
  REQUEST_SUBJECT_ROLES,
  REQUEST_VIEWS,
  SCRIPT_REF_KINDS,
  SINCE_INPUT,
  SUBMIT_SIGNALS,
  SUBMIT_TIMINGS,
  TRANSFER_CLASSES,
  VALUE_ENCODINGS,
  VALUE_LOCATIONS,
  counterKey,
  makeDocumentKey,
  type FirewallTabView,
  type GpcTabFact,
  type HistoryExport,
  type HistoryProjection,
  type ProtectEvidence,
  type ProtectLimitation,
  type ProtectProjection,
  type ProtectState,
  type ReplaySummary,
  type RequestDraftContext,
  type Ack,
  type DisabledSensorSummary,
  type DocumentReport,
  type ExportPreview,
  type ReportProjection,
  type ScopeState,
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
    ['operationCode', OPERATION_CODES],
    ['hostCategory', HOST_CATEGORIES],
    ['siteRelation', SITE_RELATIONS],
    ['sensorId', SENSOR_IDS],
    ['sensorDisableSource', SENSOR_DISABLE_SOURCES],
    ['organizationPolicyState', ORGANIZATION_POLICY_STATES],
    // ADR-020 «Защита» (S02)
    ['protectFeature', PROTECT_FEATURES],
    ['protectModuleState', PROTECT_MODULE_STATES],
    ['protectPreset', PROTECT_PRESETS],
    ['protectKind', PROTECT_KINDS],
    ['fieldKind', FIELD_KINDS],
    ['valueEncoding', VALUE_ENCODINGS],
    ['fingerprintEncoding', FINGERPRINT_ENCODINGS],
    ['fingerprintTrigger', FINGERPRINT_TRIGGERS],
    ['valueLocation', VALUE_LOCATIONS],
    ['transferClass', TRANSFER_CLASSES],
    ['submitTiming', SUBMIT_TIMINGS],
    ['submitSignal', SUBMIT_SIGNALS],
    ['sinceInput', SINCE_INPUT],
    ['deliveryState', DELIVERY_STATES],
    ['protectRequestKind', PROTECT_REQUEST_KINDS],
    ['protectHttpMethod', PROTECT_HTTP_METHODS],
    ['frameContext', FRAME_CONTEXTS],
    ['protectLimitation', PROTECT_LIMITATIONS],
    ['protectPurgeTarget', PROTECT_PURGE_TARGETS],
    ['protectControlCommand', PROTECT_CONTROL_COMMANDS],
    ['scriptRefKind', SCRIPT_REF_KINDS],
    ['replayLevel', REPLAY_LEVELS],
    ['replaySignalCode', REPLAY_SIGNAL_CODES],
    ['replayBodySize', REPLAY_BODY_SIZES],
    ['replayInputMasking', REPLAY_INPUT_MASKING],
    ['gpcSiteState', GPC_SITE_STATES],
    ['gpcHeaderEvidence', GPC_HEADER_EVIDENCE],
    ['protectSendHookPoint', PROTECT_SEND_HOOK_POINTS],
    ['protectRegistrationHookPoint', PROTECT_REGISTRATION_HOOK_POINTS],
    ['listenEventCode', LISTEN_EVENT_CODES],
    ['listenTargetKind', LISTEN_TARGET_KINDS],
    ['firewallAction', FIREWALL_ACTIONS],
    ['decisionScope', DECISION_SCOPES],
    ['decisionOrigin', DECISION_ORIGINS],
    ['enforcementState', ENFORCEMENT_STATES],
    ['enforcementDegraded', ENFORCEMENT_DEGRADED],
    ['firewallNoticeKind', FIREWALL_NOTICE_KINDS],
    ['firewallInactiveReason', FIREWALL_INACTIVE_REASONS],
    ['firewallSenderFrame', FIREWALL_SENDER_FRAMES],
    ['firewallRuleScope', FIREWALL_RULE_SCOPES],
    ['linkMechanism', LINK_MECHANISMS],
    ['historyFamily', HISTORY_FAMILIES],
    ['historyStorageState', HISTORY_STORAGE_STATES],
    ['requestJurisdiction', REQUEST_JURISDICTIONS],
    ['requestKind', REQUEST_KINDS],
    ['requestLetterLang', REQUEST_LETTER_LANGS],
    ['requestStatus', REQUEST_STATUSES],
    ['requestFactKind', REQUEST_FACT_KINDS],
    ['requestSourceKind', REQUEST_SOURCE_KINDS],
    ['requestIdentityKind', REQUEST_IDENTITY_KINDS],
    ['recipientChannel', RECIPIENT_CHANNELS],
    ['requestDelivery', REQUEST_DELIVERIES],
    ['requestSubjectRole', REQUEST_SUBJECT_ROLES],
    ['requestEndpointScheme', REQUEST_ENDPOINT_SCHEMES],
    ['requestView', REQUEST_VIEWS],
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
    'protect-page.v1.schema.json',
    'protect-main.v1.schema.json',
    'request-journal.v1.schema.json',
    'history-export.v1.schema.json',
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

const SCOPE_SAMPLE: ScopeState = {
  scopeMode: 'off',
  hosts: [],
  grantedAllSites: false,
  managed: false,
  sensorSettings: {
    sensors: SENSOR_IDS.map((sensorId) => ({ sensorId, enabled: true, disabledBy: [] })),
    organizationPolicy: 'absent',
    rejectedPolicyEntries: 0,
  },
};

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
    hosts: [
      { registrableDomain: 'cdn-vendor.net', relation: 'cross-site', evidenceSource: 'browser-network', integrity: 'browser-observed', requestCount: 3, firstSeenBucket: 0, lastSeenBucket: 2, ruleIds: [] },
      { category: 'loopback', relation: 'cross-site', evidenceSource: 'browser-network', integrity: 'browser-observed', requestCount: 1, firstSeenBucket: 1, lastSeenBucket: 1, ruleIds: [] },
    ],
    catalogVersion: null,
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
      networkCounters: [
        { techniqueId: 'DET-059', phase: 'attempted', signalCodes: ['api-use'], count: 4, countQuality: 'exact', firstBucket: 0, lastBucket: 3 },
      ],
      networkPatterns: { localPortsMax: 0, localTargetsMax: 0, randomSubdomainsMax: 0 },
      watermark: { bridgeSessionId: 'bridge-1', lastCommittedBatchSeq: 3 },
      dropped: { ...EMPTY_DROPPED, transport: 1 },
    };
    expect(compileSchema('document-report.v1.schema.json')(report)).toBe(true);
  });

  it('S07 / ADR-018 hosts in ReportProjection: exactly one of domain/category, enums, at most 128', () => {
    const validate = compileSchema('report-projection.v1.schema.json');
    const base = projection.hosts[0]!;
    const { registrableDomain: _domain, ...noFields } = base;
    expect(validate(projection)).toBe(true);
    expect(validate({ ...projection, hosts: [] })).toBe(true);
    expect(validate({ ...projection, hosts: [{ ...base, category: 'loopback' }] })).toBe(false); // both fields
    expect(validate({ ...projection, hosts: [noFields] })).toBe(false); // neither field
    expect(validate({ ...projection, hosts: Array.from({ length: 128 }, () => base) })).toBe(true);
    expect(validate({ ...projection, hosts: Array.from({ length: 129 }, () => base) })).toBe(false);
    expect(validate({ ...projection, hosts: [{ ...noFields, category: '192.168.1.1' }] })).toBe(false);
    expect(validate({ ...projection, hosts: [{ ...base, relation: 'first-party' }] })).toBe(false);
    expect(validate({ ...projection, hosts: [{ ...base, registrableDomain: 'https://x.example/path' }] })).toBe(false);
    expect(validate({ ...projection, hosts: [{ ...base, url: 'https://x.example/' }] })).toBe(false);
    const { hosts: _hosts, ...withoutHosts } = projection;
    expect(validate(withoutHosts)).toBe(false); // required since S07
  });

  it('S07 / ADR-018 DocumentReport network fields: required, bounded, DET-058…061 attempted/api-use only', () => {
    const validate = compileSchema('document-report.v1.schema.json');
    const counter = { techniqueId: 'DET-060', phase: 'attempted', signalCodes: ['api-use'], count: 2, countQuality: 'exact', firstBucket: 0, lastBucket: 1 };
    const doc = {
      schemaVersion: 1, documentKey: '1:0:D', tabId: 1, frameId: 0, documentId: 'D', host: null, lifecycle: 'committed',
      createdAt: 0, updatedAt: 0, revision: 0, coverageState: 'partial', coverageFlags: ['network-limited'], counters: [], findings: [], hosts: [],
      networkCounters: [counter], networkPatterns: { ...EMPTY_NETWORK_PATTERNS }, watermark: null, dropped: { ...EMPTY_DROPPED },
    };
    expect(validate(doc)).toBe(true);
    expect(validate({ ...doc, networkPatterns: { localPortsMax: 32, localTargetsMax: 32, randomSubdomainsMax: 32 } })).toBe(true);
    expect(validate({ ...doc, networkPatterns: { localPortsMax: 33, localTargetsMax: 0, randomSubdomainsMax: 0 } })).toBe(false);
    expect(validate({ ...doc, networkPatterns: { localPortsMax: -1, localTargetsMax: 0, randomSubdomainsMax: 0 } })).toBe(false);
    expect(validate({ ...doc, networkPatterns: { localPortsMax: 1.5, localTargetsMax: 0, randomSubdomainsMax: 0 } })).toBe(false);
    expect(validate({ ...doc, networkPatterns: { localPortsMax: 0, localTargetsMax: 0 } })).toBe(false);
    expect(validate({ ...doc, networkPatterns: { ...EMPTY_NETWORK_PATTERNS, ports: [45123] } })).toBe(false);
    expect(validate({ ...doc, networkCounters: Array.from({ length: 8 }, () => counter) })).toBe(true);
    expect(validate({ ...doc, networkCounters: Array.from({ length: 9 }, () => counter) })).toBe(false);
    expect(validate({ ...doc, networkCounters: [{ ...counter, techniqueId: 'DET-001' }] })).toBe(false);
    expect(validate({ ...doc, networkCounters: [{ ...counter, phase: 'returned-sync' }] })).toBe(false);
    expect(validate({ ...doc, networkCounters: [{ ...counter, signalCodes: ['api-use', 'local-multi-port'] }] })).toBe(false);
    expect(validate({ ...doc, networkCounters: [{ ...counter, operationCode: 'query' }] })).toBe(false);
    const { networkCounters: _c, ...noCounters } = doc;
    const { networkPatterns: _p, ...noPatterns } = doc;
    expect(validate(noCounters)).toBe(false);
    expect(validate(noPatterns)).toBe(false);
  });

  it('Ack and UiResponse', () => {
    const ack: Ack = { schemaVersion: 1, type: 'ack', lastCommittedBatchSeq: 0, paused: false, protocolOk: true };
    expect(compileSchema('ack.v1.schema.json')(ack)).toBe(true);
    const preview: ExportPreview = createExportPreview(projection, 1_757_000_002_000);
    const responses: UiResponse[] = [
      { schemaVersion: 1, type: 'report', report: projection },
      { schemaVersion: 1, type: 'report', report: null },
      { schemaVersion: 1, type: 'ok', reportRevision: 5 },
      { schemaVersion: 1, type: 'scope', scope: SCOPE_SAMPLE },
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

  it('ADR-017 counterKey: v1 format without an operation, "|op" suffix with one', () => {
    expect(counterKey('DET-002', 'returned-sync', ['readback-after-text', 'api-use'])).toBe('DET-002|returned-sync|api-use,readback-after-text');
    expect(counterKey('DET-002', 'returned-sync', ['api-use'], undefined)).toBe('DET-002|returned-sync|api-use');
    expect(counterKey('DET-011', 'returned-sync', ['api-use'], 'param-renderer')).toBe('DET-011|returned-sync|api-use|param-renderer');
    expect(counterKey('DET-039', 'async-returned', [], 'query')).toBe('DET-039|async-returned||query');
    expect(counterKey('DET-011', 'returned-sync', ['api-use'], 'param-renderer')).not.toBe(counterKey('DET-011', 'returned-sync', ['api-use'], 'param-vendor'));
  });

  it('ADR-017 TechniqueSummary.operationCodes: optional, non-empty, unique, registry enum', () => {
    const validate = compileSchema('report-projection.v1.schema.json');
    const base = projection.techniques[0]!;
    const withOps = (operationCodes: unknown): unknown => ({ ...projection, techniques: [{ ...base, techniqueId: 'DET-011', operationCodes }] });
    expect(validate(projection)).toBe(true);
    expect(validate(withOps(['param-vendor', 'param-renderer']))).toBe(true);
    expect(validate(withOps([]))).toBe(false);
    expect(validate(withOps(['param-vendor', 'param-vendor']))).toBe(false);
    expect(validate(withOps(['bogus']))).toBe(false);
    expect(validate(withOps('param-vendor'))).toBe(false);
    expect(validate(withOps(Array.from({ length: 64 }, () => 'param-vendor')))).toBe(false);
  });

  it('ADR-017 CounterEntry.operationCode is an optional registry enum', () => {
    const validate = makeAjv().compile({ $ref: 'urn:detect-expert:contracts:common:v1#/$defs/counterEntry' });
    const entry = { techniqueId: 'DET-025', phase: 'returned-sync', signalCodes: ['api-use'], count: 1, countQuality: 'exact', firstBucket: 0, lastBucket: 0 };
    expect(validate(entry)).toBe(true);
    expect(validate({ ...entry, operationCode: 'user-agent' })).toBe(true);
    expect(validate({ ...entry, operationCode: 'https://x' })).toBe(false);
    expect(validate({ ...entry, operationCode: '' })).toBe(false);
  });

  it('ADR-017 pageObservation has one if/then per technique with an allowlist and one forbidding branch', () => {
    const def = defs()['pageObservation'] as JsonSchema;
    const branches = def['allOf'] as JsonSchema[];
    const withOps = TECHNIQUE_IDS.filter((t) => (PAGE_OPERATIONS[t] ?? []).length > 0);
    expect(branches).toHaveLength(withOps.length + 1);
    for (const [i, t] of withOps.entries()) {
      const branch = branches[i] as { if: { properties: { techniqueId: { const: string } } }; then: { properties: { operationCode: { enum: string[] } } } };
      expect(branch.if.properties.techniqueId.const).toBe(t);
      expect(branch.then.properties.operationCode.enum).toEqual([...(PAGE_OPERATIONS[t] ?? [])]);
    }
    const last = branches[withOps.length] as { then: { properties: { operationCode: unknown } } };
    expect(last.then.properties.operationCode).toBe(false);
  });

  it('D2-06 vendors: vendorConfidence passes, vendorMatch is rejected', () => {
    const validate = compileSchema('report-projection.v1.schema.json');
    const vendor = { vendorId: 'candidate', ruleIds: ['r1'], evidenceSource: 'browser-network', integrity: 'browser-observed' };
    expect(validate({ ...projection, vendors: [{ ...vendor, vendorConfidence: 'documented-resource' }] })).toBe(true);
    expect(validate({ ...projection, vendors: [{ ...vendor, vendorMatch: 'documented-resource' }] })).toBe(false);
  });

  it('S10 catalogVersion: required, null or the catalog version pattern, in projections and export previews', () => {
    const validateReport = compileSchema('report-projection.v1.schema.json');
    const validateResponse = compileSchema('ui-response.v1.schema.json');
    const exportOf = (catalogVersion: unknown): unknown => {
      const preview = createExportPreview(projection, 0);
      return { schemaVersion: 1, type: 'export-preview', preview: { ...preview, report: { ...preview.report, catalogVersion } } };
    };
    for (const catalogVersion of [null, '2026-09-12.3f9a1c2e', 'synthetic-test-1', 'a'.repeat(64)]) {
      expect(validateReport({ ...projection, catalogVersion })).toBe(true);
      expect(validateResponse(exportOf(catalogVersion))).toBe(true);
    }
    for (const catalogVersion of ['', 'a/b', 'a b', 'a'.repeat(65), 'v1?x=1', 1, true]) {
      expect(validateReport({ ...projection, catalogVersion })).toBe(false);
      expect(validateResponse(exportOf(catalogVersion))).toBe(false);
    }
    const { catalogVersion: _v, ...withoutVersion } = projection;
    expect(validateReport(withoutVersion)).toBe(false);
    const preview = createExportPreview(projection, 0);
    expect(preview.report.catalogVersion).toBeNull();
    const { catalogVersion: _e, ...exportWithout } = preview.report;
    expect(validateResponse({ schemaVersion: 1, type: 'export-preview', preview: { ...preview, report: exportWithout } })).toBe(false);
  });

  it('S11 / ADR-019 ScopeState.sensorSettings: required, registry ids, enum sources and policy states', () => {
    const validate = compileSchema('ui-response.v1.schema.json');
    const scope = (s: unknown): unknown => ({ schemaVersion: 1, type: 'scope', scope: s });
    expect(validate(scope(SCOPE_SAMPLE))).toBe(true);
    const settings = SCOPE_SAMPLE.sensorSettings;
    const off = { ...settings, sensors: [{ sensorId: 'canvas', enabled: false, disabledBy: ['user', 'organization'] }], organizationPolicy: 'last-known-good', rejectedPolicyEntries: 3 };
    expect(validate(scope({ ...SCOPE_SAMPLE, sensorSettings: off }))).toBe(true);
    const { sensorSettings: _s, ...withoutSettings } = SCOPE_SAMPLE;
    expect(validate(scope(withoutSettings))).toBe(false);
    for (const bad of [
      { ...settings, organizationPolicy: 'unknown' },
      { ...settings, rejectedPolicyEntries: -1 },
      { ...settings, sensors: [{ sensorId: 'math', enabled: true, disabledBy: [] }] },
      { ...settings, sensors: [{ sensorId: 'canvas', enabled: 'no', disabledBy: [] }] },
      { ...settings, sensors: [{ sensorId: 'canvas', enabled: false, disabledBy: ['admin'] }] },
      { ...settings, sensors: [{ sensorId: 'canvas', enabled: false, disabledBy: ['user', 'user'] }] },
      { ...settings, sensors: Array.from({ length: SENSOR_IDS.length + 1 }, () => settings.sensors[0]) },
      { ...settings, policyValue: ['canvas'] },
    ]) expect(validate(scope({ ...SCOPE_SAMPLE, sensorSettings: bad }))).toBe(false);
  });

  it('S11 / ADR-019 disabledSensors: optional, non-empty, bounded in projections; ids only in export previews', () => {
    const validateReport = compileSchema('report-projection.v1.schema.json');
    const validateResponse = compileSchema('ui-response.v1.schema.json');
    const entry: DisabledSensorSummary = { sensorId: 'canvas', disabledBy: ['user'], hooksMayRemain: true };
    expect(validateReport(projection)).toBe(true);
    expect(validateReport({ ...projection, disabledSensors: [entry] })).toBe(true);
    expect(validateReport({ ...projection, disabledSensors: [{ ...entry, disabledBy: [] }] })).toBe(true);
    expect(validateReport({ ...projection, disabledSensors: SENSOR_IDS.map((sensorId) => ({ ...entry, sensorId })) })).toBe(true);
    for (const bad of [
      [],
      [{ ...entry, sensorId: 'nope' }],
      [{ ...entry, hooksMayRemain: 'yes' }],
      [{ ...entry, disabledBy: ['admin'] }],
      [{ ...entry, extra: 1 }],
      Array.from({ length: SENSOR_IDS.length + 1 }, () => entry),
      'canvas',
    ]) expect(validateReport({ ...projection, disabledSensors: bad })).toBe(false);
    const withSensors: ReportProjection = { ...projection, disabledSensors: [entry, { sensorId: 'webgl', disabledBy: ['organization'], hooksMayRemain: false }] };
    const preview = createExportPreview(withSensors, 0);
    expect(preview.report.disabledSensors).toEqual(['canvas', 'webgl']);
    expect(validateResponse({ schemaVersion: 1, type: 'export-preview', preview })).toBe(true);
    expect(createExportPreview(projection, 0).report).not.toHaveProperty('disabledSensors');
    const exportOf = (disabledSensors: unknown): unknown => ({ schemaVersion: 1, type: 'export-preview', preview: { ...preview, report: { ...preview.report, disabledSensors } } });
    for (const bad of [[], [entry], ['nope'], ['canvas', 'canvas']]) expect(validateResponse(exportOf(bad))).toBe(false);
  });

  it('S10 ruleIds in hosts and vendors: [A-Za-z0-9_-]{1,64}, at most 32', () => {
    const validate = compileSchema('report-projection.v1.schema.json');
    const vendor = projection.vendors[0]!;
    const host = projection.hosts[0]!;
    const ok = ['test-synthetic-loader', 'cloudflare_bot', 'R1', 'a'.repeat(64)];
    expect(validate({ ...projection, vendors: [{ ...vendor, ruleIds: ok }], hosts: [{ ...host, ruleIds: ok }] })).toBe(true);
    expect(validate({ ...projection, vendors: [{ ...vendor, ruleIds: Array.from({ length: 32 }, (_, i) => 'r' + String(i)) }] })).toBe(true);
    for (const bad of [['a/b'], ['https://x.example/a'], [''], ['a'.repeat(65)], ['a.b'], ['a b'], Array.from({ length: 33 }, (_, i) => 'r' + String(i))]) {
      expect(validate({ ...projection, vendors: [{ ...vendor, ruleIds: bad }] })).toBe(false);
      expect(validate({ ...projection, hosts: [{ ...host, ruleIds: bad }] })).toBe(false);
    }
    const validateDocument = compileSchema('document-report.v1.schema.json');
    const doc = {
      schemaVersion: 1, documentKey: '1:0:D', tabId: 1, frameId: 0, documentId: 'D', host: null, lifecycle: 'committed',
      createdAt: 0, updatedAt: 0, revision: 0, coverageState: 'active', coverageFlags: [], counters: [], findings: [],
      hosts: [{ ...host, ruleIds: ['test-synthetic-loader'] }], networkCounters: [], networkPatterns: { ...EMPTY_NETWORK_PATTERNS },
      watermark: null, dropped: { ...EMPTY_DROPPED },
    };
    expect(validateDocument(doc)).toBe(true);
    expect(validateDocument({ ...doc, hosts: [{ ...host, ruleIds: ['a/b'] }] })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ADR-020 «Защита» (S02): typed samples of the module and the wire allowlist.
// ---------------------------------------------------------------------------

const SCRIPT = { kind: 'external', scheme: 'https', host: '*.cdn.tracker.example', pathTemplate: '/js/:id/rec.js' } as const;
const EVIDENCE_BASE = {
  frameContext: 'top' as const,
  attributionConfidence: 'sampled-stack' as const,
  script: SCRIPT,
  count: 2,
  countQuality: 'exact' as const,
  firstSecond: 3,
  lastSecond: 9,
  evidenceSource: 'derived' as const,
  integrity: 'derived' as const,
  ruleVersion: '1',
  limitationCodes: ['party-by-registrable-domain'] as ProtectLimitation[],
};
const TRANSFER: ProtectEvidence = {
  ...EVIDENCE_BASE,
  evidenceId: 'pe-1',
  protectKind: 'value-match',
  ruleId: 'form-leak',
  transferClass: 'third-party-before-submit',
  fieldKind: 'email',
  fieldRef: 1,
  encodings: ['sha256-hex'],
  location: 'query',
  paramName: 'ud[em]',
  receiver: 'collect.example',
  relation: 'cross-site',
  method: 'GET',
  requestKind: 'image',
  endpointHost: 'px.collect.example',
  endpointPathTemplate: '/tr',
  initiatorSite: 'shop.example',
  submitTiming: 'before-submit',
  sinceInput: 'lt-1s',
  deliveryState: 'sent',
  interpretationConfidence: 'high',
};
const LISTENER: ProtectEvidence = { ...EVIDENCE_BASE, evidenceId: 'pe-2', protectKind: 'password-field-listener', ruleId: 'password-listener', interpretationConfidence: 'low' };
const REPLAY_EVIDENCE: ProtectEvidence = {
  ...EVIDENCE_BASE,
  evidenceId: 'pe-3',
  protectKind: 'replay-pattern',
  ruleId: 'session-replay-behavior',
  receiver: 'rec.example',
  relation: 'cross-site',
  interpretationConfidence: 'low',
};
const FIREWALL: FirewallTabView = {
  enforcement: 'degraded',
  degradedCode: 'api-unavailable',
  preset: 'normal',
  topDomainsSupported: true,
  stoppedToday: { count: 0, countQuality: 'lower-bound' },
  snoozedUntil: null,
  prompt: { promptId: '0123456789abcdef', site: 'shop.example', receivers: ['collect.example'], hidden: 0 },
  receivers: [
    {
      receiver: 'collect.example',
      relation: 'cross-site',
      effectiveRule: null,
      delivery: { sent: 1, stopped: 0, stoppedOther: 0, unknown: 0 },
      countQuality: 'lower-bound',
      lastDelivery: 'sent',
      fieldKinds: ['email'],
      encodings: ['sha256-hex'],
      submitTiming: 'before-submit',
      sender: { frame: 'top', initiatorSite: 'shop.example', script: SCRIPT, attributionConfidence: 'sampled-stack' },
      vendorConfidence: 'none',
    },
  ],
  notices: [{ kind: 'strict-auto', receiver: 'collect.example', site: 'shop.example', undoId: 'fedcba9876543210' }],
  onceRules: [],
};
const REPLAY: ReplaySummary = {
  ruleId: 'session-replay-behavior',
  ruleVersion: '1',
  level: 'replay-like',
  interpretationConfidence: 'low',
  attributionConfidence: 'unknown',
  signals: [
    { code: 'root-input-listeners', techniqueId: 'DET-043', evidenceSource: 'page-hook', integrity: 'page-controlled', count: 4, countQuality: 'sampled' },
    { code: 'periodic-third-party-send', evidenceSource: 'browser-network', integrity: 'browser-observed', count: 6, countQuality: 'lower-bound', linkedSite: 'rec.example' },
  ],
  periodicHosts: [{ registrableDomain: 'rec.example', runMax: 6, sends: 6, largeInRunMax: 6, bodySize: '1k-16k' }],
  vendors: [],
  inputMasking: 'unconfirmed',
  limitationCodes: ['uncalibrated-threshold', 'masking-not-verifiable', 'websocket-not-observed', 'element-listeners-not-observed', 'mo-options-not-read', 'no-script-attribution'],
};
const GPC: GpcTabFact = {
  site: 'shop.example',
  siteState: 'on',
  navigationHeader: 'observed',
  requestsWithHeader: 12,
  requestsWithoutHeader: 0,
  countQuality: 'lower-bound',
  propertyAtLoad: true,
  reloadNeeded: false,
  evidenceSource: 'browser-network',
  integrity: 'browser-observed',
};
const PROTECT_PROJECTION: ProtectProjection = {
  protectRevision: 3,
  documentKey: makeDocumentKey(4, 0, 'DOC'),
  site: 'shop.example',
  moduleState: 'active',
  features: ['value-match', 'firewall', 'session-replay', 'gpc'],
  coverageState: 'partial',
  limitations: ['late-start', 'loaded-before-enable'],
  evidence: [TRANSFER, LISTENER, REPLAY_EVIDENCE],
  previousDocumentEvidence: 1,
  firewall: FIREWALL,
  replay: REPLAY,
  gpc: GPC,
  dropped: { evidence: 0, fingerprints: 0, bodies: 0, events: 0 },
};
const PROTECT_STATE: ProtectState = {
  state: 'needs-permission',
  consentVersion: 1,
  requiredConsentVersion: 1,
  features: ['value-match', 'firewall'],
  preset: 'normal',
  snoozedUntil: null,
  excludedSites: ['bank.example', '127.0.0.1'],
  historyRetentionDays: 30,
  history: null,
  decisions: 0,
  permissions: { broadHosts: false, dnr: true },
  organizationDisabled: false,
  organizationPolicyInvalid: false,
  degradedReasons: [],
};
const HISTORY_DROPPED = { pending: 0, evictedSightings: 0, evictedReceivers: 0, evictedSites: 0, unresolvedSite: 1, malformed: 0 };
const MECHANISM = {
  mechanism: 'value-match',
  sites: 2,
  evidenceSource: 'derived',
  integrity: 'derived',
  attributionConfidence: 'unknown',
  interpretationConfidence: 'high',
} as const;
const HISTORY: HistoryProjection = {
  historyRevision: 5,
  retentionDays: 30,
  storage: 'ok',
  today: '2026-10-17',
  since: '2026-10-01',
  windowDays: 30,
  rows: [{ rowKey: 'd:collect.example', domains: ['collect.example'], vendorConfidence: 'none', sites: 2, days: 3, lastSeen: '2026-10-17', mechanisms: [MECHANISM] }],
  totalRows: 1,
  singleSiteReceivers: 4,
  sitesInWindow: 6,
  limitedSitesInWindow: 0,
  limitations: ['party-by-registrable-domain'],
  site: { site: 'shop.example', receivers: [{ rowKey: 'd:collect.example', sites: 2 }], unattributedFamilies: ['canvas'] },
  dropped: HISTORY_DROPPED,
};
const HISTORY_EXPORT: HistoryExport = {
  schemaVersion: 1,
  kind: 'detect-expert-history',
  redacted: true,
  sitesIncluded: false,
  exportedOn: '2026-10-17',
  retentionDays: 30,
  since: '2026-10-01',
  receivers: [
    {
      rowKey: 'd:collect.example',
      domains: ['collect.example'],
      vendorConfidence: 'none',
      mechanisms: [MECHANISM],
      families: [{ family: 'network-patterns', days: 1, sites: 1, interpretation: 'unknown', attributionConfidence: 'frame-only' }],
      sites: [{ site: 'site-1', days: 2, first: '2026-10-02', last: '2026-10-17' }],
    },
  ],
  sites: [{ site: 'site-1', days: 2, first: '2026-10-02', last: '2026-10-17', limited: false, families: [] }],
  limitations: [],
  dropped: HISTORY_DROPPED,
  truncated: false,
};
const DRAFT: RequestDraftContext = {
  sourceKind: 'evidence',
  sourceMissing: false,
  subjects: [{ role: 'receiver', vendorId: null, domain: 'collect.example', entityName: 'collect.example' }],
  facts: [],
  recipients: {
    receiver: [
      {
        contactId: 'collect-example',
        contactsVersion: '2026-10-17.1',
        entityName: 'Collect Example Ltd',
        channel: 'email',
        address: 'privacy@collect.example',
        jurisdictions: ['gdpr-eu-eea'],
        accessedAt: '2026-10-10',
        reviewedAt: '2026-10-12',
      },
    ],
    site: [],
  },
  prefs: { jurisdiction: null, letterLang: null },
  gpcAvailable: true,
};

describe('ADR-020 typed samples validate against their schemas', () => {
  const validateResponse = compileSchema('ui-response.v1.schema.json');

  it('every protect-* answer', () => {
    const responses: UiResponse[] = [
      { schemaVersion: 1, type: 'protect-state', state: PROTECT_STATE },
      { schemaVersion: 1, type: 'protect-report', report: PROTECT_PROJECTION },
      { schemaVersion: 1, type: 'protect-report', report: null },
      { schemaVersion: 1, type: 'protect-decision', applied: [{ receiver: 'collect.example', ruleApplied: false }], undoId: '0123456789abcdef', report: PROTECT_PROJECTION },
      {
        schemaVersion: 1,
        type: 'protect-rules',
        total: 1,
        rows: [
          {
            ruleKey: 'site:shop.example>collect.example',
            receiver: 'collect.example',
            site: 'shop.example',
            scope: 'site',
            action: 'block',
            origin: 'user',
            createdDay: '2026-10-17',
            active: false,
            inactiveReason: 'no-permission',
            stopped: 0,
            bypass: 0,
          },
        ],
        preset: 'normal',
        stoppedDays: [{ day: '2026-10-17', count: 0 }],
      },
      { schemaVersion: 1, type: 'protect-history', history: HISTORY },
      {
        schemaVersion: 1,
        type: 'protect-history-receiver',
        card: {
          rowKey: 'd:collect.example',
          domains: ['collect.example'],
          sites: [{ site: 'shop.example', days: 2, first: '2026-10-02', last: '2026-10-17' }],
          moreSites: 0,
          families: [],
          mechanisms: [MECHANISM],
        },
      },
      { schemaVersion: 1, type: 'protect-history-export', preview: HISTORY_EXPORT },
      { schemaVersion: 1, type: 'protect-requests', revision: 0, summary: { total: 0, open: 0, dueSoon: 0, overdue: 0 }, prefs: { jurisdiction: null, letterLang: null }, droppedRecords: 0 },
      { schemaVersion: 1, type: 'protect-request-draft', draft: DRAFT },
      { schemaVersion: 1, type: 'error', code: 'module-disabled' },
    ];
    for (const r of responses) expect(validateResponse(r), r.type).toBe(true);
  });

  it('history-export.v1 accepts the preview', () => {
    expect(compileSchema('history-export.v1.schema.json')(HISTORY_EXPORT)).toBe(true);
  });

  it('evidence invariants: exactly one receiver form; value-match needs an encoding; opaque has none; pathSegment only in the path', () => {
    const report = (evidence: unknown): unknown => ({ schemaVersion: 1, type: 'protect-report', report: { ...PROTECT_PROJECTION, evidence: [evidence] } });
    const t = TRANSFER as unknown as Record<string, unknown>;
    const { receiver: _r, ...noReceiver } = t;
    expect(validateResponse(report(t))).toBe(true);
    expect(validateResponse(report({ ...noReceiver, receiverCategory: 'private' }))).toBe(true);
    expect(validateResponse(report({ ...t, receiverCategory: 'private' }))).toBe(false);
    expect(validateResponse(report(noReceiver))).toBe(false);
    expect(validateResponse(report({ ...t, encodings: [] }))).toBe(false);
    expect(validateResponse(report({ ...t, protectKind: 'opaque-after-input', transferClass: 'opaque-after-input', location: 'body-opaque', encodings: [] }))).toBe(true);
    expect(validateResponse(report({ ...t, protectKind: 'opaque-after-input', encodings: ['plain'] }))).toBe(false);
    expect(validateResponse(report({ ...t, pathSegment: 2 }))).toBe(false);
    expect(validateResponse(report({ ...t, location: 'path', pathSegment: 2 }))).toBe(true);
    expect(validateResponse(report({ ...t, endpointPathTemplate: '/tr?em=1' }))).toBe(false);
    expect(validateResponse(report({ ...t, fieldKind: 'password' }))).toBe(false);
    expect(validateResponse(report({ ...t, interpretationConfidence: 'unassessed' }))).toBe(false);
    expect(validateResponse(report({ ...(LISTENER as unknown as Record<string, unknown>), interpretationConfidence: 'medium' }))).toBe(false);
    expect(validateResponse(report({ ...(LISTENER as unknown as Record<string, unknown>), receiver: 'collect.example' }))).toBe(false);
  });

  it('the projection rejects value-carrying fields', () => {
    const report = (evidence: unknown): unknown => ({ schemaVersion: 1, type: 'protect-report', report: { ...PROTECT_PROJECTION, evidence: [evidence] } });
    for (const extra of [{ value: 'x' }, { hash: 'ab' }, { mask: 'a***@g***.com' }, { url: 'https://collect.example/tr?em=1' }, { query: 'em=1' }, { valueLength: 12 }]) {
      expect(validateResponse(report({ ...TRANSFER, ...extra })), Object.keys(extra)[0]).toBe(false);
    }
  });
});

describe('ADR-020 wire allowlist: no value, hash, mask, URL or query field on any module wire type', () => {
  const COMMON = 'urn:detect-expert:contracts:common:v1#/$defs/';
  const FORBIDDEN = new Set([
    'value', 'values', 'hash', 'hashes', 'mask', 'masked', 'url', 'urls', 'href', 'uri', 'fullUrl', 'sourceUrl', 'query', 'queryString', 'search', 'fragment',
    'stack', 'cookie', 'cookies', 'body', 'text', 'password', 'identity', 'identifier', 'email', 'name', 'typedValue', 'rawValue',
    'length', 'valueLength',
  ]);
  type Hit = { owner: string; prop: string; schema: JsonSchema };

  function collect(root: JsonSchema, owner: string, hits: Hit[], seen: Set<string>): void {
    const walk = (node: unknown, current: string): void => {
      if (node === null || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (const item of node) walk(item, current);
        return;
      }
      const schema = node as JsonSchema;
      const target = schema['$ref'];
      if (typeof target === 'string' && target.startsWith(COMMON)) {
        const def = target.slice(COMMON.length);
        if (!seen.has(def)) {
          seen.add(def);
          walk(defs()[def], def);
        }
      }
      const props = schema['properties'];
      if (props && typeof props === 'object') {
        for (const [prop, sub] of Object.entries(props as Record<string, JsonSchema>)) {
          hits.push({ owner: current, prop, schema: sub });
          walk(sub, current);
        }
      }
      for (const key of ['oneOf', 'anyOf', 'allOf', 'if', 'then', 'else', 'items', 'contains', 'not']) walk(schema[key], current);
    };
    walk(root, owner);
  }

  const hits: Hit[] = [];
  const seen = new Set<string>();
  for (const name of ['protect-page.v1.schema.json', 'protect-main.v1.schema.json', 'request-journal.v1.schema.json', 'history-export.v1.schema.json']) {
    collect(loadSchema(name), name, hits, seen);
  }
  for (const name of ['ui-request.v1.schema.json', 'ui-response.v1.schema.json']) {
    for (const branch of loadSchema(name)['oneOf'] as JsonSchema[]) {
      const type = ((branch['properties'] as Record<string, JsonSchema>)['type'] as JsonSchema)['const'] as string;
      if (type.startsWith('ui-protect-') || type.startsWith('protect-')) collect(branch, type, hits, seen);
    }
  }

  it('walks the module schemas (sanity)', () => {
    expect(hits.length).toBeGreaterThan(300);
    expect(seen.has('protectProjection')).toBe(true);
    expect(seen.has('storedRequestJournal')).toBe(true);
  });

  it('no forbidden property name anywhere', () => {
    expect(hits.filter((h) => FORBIDDEN.has(h.prop)).map((h) => h.owner + '.' + h.prop)).toEqual([]);
  });

  it('fingerprints {h, len} exist only in protect-input entries (ISOLATED -> SW)', () => {
    const owners = new Set(hits.filter((h) => h.prop === 'h' || h.prop === 'len').map((h) => h.owner));
    expect([...owners]).toEqual(['protectFingerprintEntry']);
    const referencedBy = hits.filter((h) => JSON.stringify(h.schema).includes('protectFieldFingerprint')).map((h) => h.owner);
    expect([...new Set(referencedBy)]).toEqual(['protect-page.v1.schema.json']);
  });

  it('no `query` field; the domain filter of two UI requests cannot carry a URL query', () => {
    expect(hits.filter((h) => h.prop === 'query')).toEqual([]);
    const filters = hits.filter((h) => h.prop === 'domainFilter');
    expect(filters.map((h) => h.owner).sort()).toEqual(['ui-protect-history-query', 'ui-protect-list-rules']);
    for (const h of filters) expect(h.schema['$ref']).toBe(COMMON + 'domainFilter');
    expect((defs()['domainFilter'] as JsonSchema)['pattern']).toBe('^[a-z0-9.-]{1,64}$');
  });

  it('URL-like fields exist only for company contacts of the request journal', () => {
    const urlish = hits.filter((h) => /url|href|address/i.test(h.prop)).map((h) => h.owner + '.' + h.prop);
    expect([...new Set(urlish)].sort()).toEqual(['recipientCandidate.address', 'recipientRef.address']);
  });
});
