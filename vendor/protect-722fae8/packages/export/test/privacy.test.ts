import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { expect, it } from 'vitest';
import { createExportPreview, diagnosticPreview, serializeExportPreview } from '../src/index';
import { report, technique, vendor } from '../../ui/test/fixtures';

const schemasDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'contracts', 'schemas');
const loadSchema = (name: string): Record<string, unknown> => JSON.parse(readFileSync(join(schemasDir, name), 'utf8')) as Record<string, unknown>;
const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addSchema(loadSchema('common.v1.schema.json'));
const validateUiResponse = ajv.compile(loadSchema('ui-response.v1.schema.json'));

it('P07 ring lower bound is explicitly exported without copying unrelated dropped fields', () => {
  const source = report();
  Object.assign(source.dropped, { ring: 1, secret: 'canary-ring-secret' });
  const preview = createExportPreview(source, 1000);
  expect(preview.report.dropped.ring).toBe(1);
  expect(serializeExportPreview(preview)).not.toContain('canary-ring-secret');
  expect(createExportPreview(report(), 1000).report.dropped.ring).toBeUndefined();
});

it('ADR-017 operationCodes are copied explicitly; without them the preview is unchanged', () => {
  const plain = report({ techniques: [technique({ techniqueId: 'DET-025' })] });
  const before = serializeExportPreview(createExportPreview(plain, 1000));
  expect(before).not.toContain('operationCodes');
  const source = technique({ techniqueId: 'DET-025', operationCodes: ['user-agent', 'platform'] });
  const withOps = report({ techniques: [source] });
  const preview = createExportPreview(withOps, 1000);
  expect(preview.report.techniques[0]?.operationCodes).toEqual(['user-agent', 'platform']);
  expect(preview.report.techniques[0]?.operationCodes).not.toBe(source.operationCodes);
  const { operationCodes: _ops, ...rest } = preview.report.techniques[0]!;
  expect(rest).toEqual(createExportPreview(plain, 1000).report.techniques[0]);
  expect(serializeExportPreview(createExportPreview(plain, 1000))).toBe(before);
});

it('F027/F108 export strips browser identities and absolute time at both levels', () => {
  const source = report({ documentKey: 'SECRET-DOCUMENT', observedSince: 1_700_000_000_000, host: 'private.internal' });
  const preview = createExportPreview(source, 1_700_000_181_234);
  expect(preview.report.observationAgeMinutes).toBe(3);
  expect(preview.report.host).toBeNull();
  expect(serializeExportPreview(preview)).not.toMatch(/SECRET-DOCUMENT|1700000|documentKey|observedSince|exportedAt|private.internal/);
  expect(createExportPreview(source, 1_700_000_181_234, true).report.host).toBeNull();
  expect(source.host).toBe('private.internal');
});

it('F064 diagnostics reject unbounded or non-version strings and contain no report fields', () => {
  expect(diagnosticPreview('secret.internal/' + 'a'.repeat(500), Number.NaN, false)).toEqual({
    schemaVersion: 1, extensionVersion: 'unknown', chromeMajor: null, swAvailable: false,
  });
  expect(diagnosticPreview('0.1.0', 153, true)).toEqual({ schemaVersion: 1, extensionVersion: '0.1.0', chromeMajor: 153, swAvailable: true });
});

it('S11 / ADR-019 diagnostics list disabled sensor ids, the policy state and a count only', () => {
  expect(diagnosticPreview('0.1.0', 153, true, { off: ['webgl', 'canvas', 'canvas'], organizationPolicy: 'last-known-good', rejectedPolicyEntries: 2 })).toEqual({
    schemaVersion: 1, extensionVersion: '0.1.0', chromeMajor: 153, swAvailable: true,
    disabledSensors: ['canvas', 'webgl'], organizationPolicy: 'last-known-good', rejectedPolicyEntries: 2,
  });
  const hostile = diagnosticPreview('0.1.0', 153, true, { off: ['https://secret.example/', 'canvas', { id: 'x' }], organizationPolicy: 'DisabledSensorIds=secret', rejectedPolicyEntries: -1 });
  expect(hostile).toMatchObject({ disabledSensors: ['canvas'], organizationPolicy: 'absent', rejectedPolicyEntries: 0 });
  expect(JSON.stringify(hostile)).not.toMatch(/secret|https/);
  expect(diagnosticPreview('0.1.0', 153, true, { off: [], organizationPolicy: 'absent', rejectedPolicyEntries: 1e300 })).toMatchObject({ rejectedPolicyEntries: 2147483647 });
  expect(diagnosticPreview('0.1.0', 153, true, { off: [], organizationPolicy: 'absent', rejectedPolicyEntries: 1.5 })).toMatchObject({ rejectedPolicyEntries: 0 });
});

it('S11 / ADR-019 export copies disabled sensor ids only (no reasons, no hook state) and omits the field when empty', () => {
  const source = report({ disabledSensors: [
    { sensorId: 'webgl', disabledBy: ['organization'], hooksMayRemain: true },
    { sensorId: 'canvas', disabledBy: [], hooksMayRemain: false },
  ] });
  const preview = createExportPreview(source, 1000);
  expect(preview.report.disabledSensors).toEqual(['canvas', 'webgl']);
  const text = serializeExportPreview(preview);
  expect(text).not.toMatch(/organization|hooksMayRemain|disabledBy/);
  expect(validateUiResponse({ schemaVersion: 1, type: 'export-preview', preview })).toBe(true);
  expect(createExportPreview(report(), 1000).report).not.toHaveProperty('disabledSensors');
  expect(createExportPreview(report({ disabledSensors: [] }), 1000).report).not.toHaveProperty('disabledSensors');
});

it.each([
  ['random-canary.example.com', 'example.com'], ['https://random-canary.example.com/a?q=secret', 'example.com'],
  ['127.0.0.1', null], ['[fd12::1]', null], ['random.local', null], ['a.unknownsuffix', null],
])('P01 export re-redacts even explicitly included host %s', (host, expected) => {
  const preview = createExportPreview(report({ host }), 1000, true);
  expect(preview.report.host).toBe(expected);
  expect(serializeExportPreview(preview)).not.toMatch(/random-canary|secret|127\.0\.0\.1|fd12/);
});

it('S07 / ADR-018: buckets are relative per evidence source; hosts are never exported', () => {
  const source = report({
    techniques: [
      technique({ techniqueId: 'DET-002', firstBucket: 40, lastBucket: 44 }),
      technique({ techniqueId: 'DET-003', firstBucket: 42, lastBucket: 50 }),
      technique({ techniqueId: 'DET-059', evidenceSource: 'browser-network', integrity: 'browser-observed', attributionConfidence: 'frame-only', phases: ['attempted'], firstBucket: 7, lastBucket: 9 }),
      technique({ techniqueId: 'DET-058', evidenceSource: 'browser-network', integrity: 'browser-observed', attributionConfidence: 'frame-only', phases: ['attempted'], firstBucket: 3, lastBucket: 3 }),
    ],
    hosts: [
      { registrableDomain: 'secret-vendor.net', relation: 'cross-site', evidenceSource: 'browser-network', integrity: 'browser-observed', requestCount: 4, firstSeenBucket: 3, lastSeenBucket: 9, ruleIds: [] },
      { category: 'private', relation: 'unknown', evidenceSource: 'browser-network', integrity: 'browser-observed', requestCount: 4, firstSeenBucket: 3, lastSeenBucket: 9, ruleIds: [] },
    ],
  });
  const preview = createExportPreview(source, 1000, true);
  expect(preview.report.techniques.map((t) => [t.techniqueId, t.firstBucket, t.lastBucket])).toEqual([
    ['DET-002', 0, 4], ['DET-003', 2, 10], ['DET-059', 4, 6], ['DET-058', 0, 0],
  ]);
  const text = serializeExportPreview(preview);
  expect(Object.keys(preview.report)).not.toContain('hosts');
  expect(text).not.toContain('secret-vendor');
  expect(text).not.toContain('private');
  expect(text).not.toContain('firstSeenBucket');
});

it('S10: a preview with vendors passes Ajv; catalogVersion is copied; no path, query or port reaches the export', () => {
  const loader = 'http://127.0.0.1:4174/vendors/synthetic/loader.js?session=CANARY-E12-QUERY';
  const source = report({
    catalogVersion: 'synthetic-test-1',
    vendors: [{ ...vendor({ vendorId: 'test-synthetic', ruleIds: ['test-synthetic-loader'] }), url: loader } as never],
    hosts: [{ category: 'loopback', relation: 'unknown', evidenceSource: 'browser-network', integrity: 'browser-observed', requestCount: 2, firstSeenBucket: 0, lastSeenBucket: 1, ruleIds: ['test-synthetic-loader'], path: loader } as never],
  });
  const preview = createExportPreview(source, 1000, true);
  expect(preview.report.catalogVersion).toBe('synthetic-test-1');
  expect(preview.report.vendors).toEqual([
    { vendorId: 'test-synthetic', vendorConfidence: 'documented-resource', ruleIds: ['test-synthetic-loader'], evidenceSource: 'browser-network', integrity: 'browser-observed' },
  ]);
  expect(validateUiResponse({ schemaVersion: 1, type: 'export-preview', preview })).toBe(true);
  const text = serializeExportPreview(preview);
  expect(text).not.toMatch(/\/vendors\/synthetic|loader\.js|CANARY-E12-QUERY|session=|4174|127\.0\.0\.1|"hosts": \[|"url"|"path"/);
  expect(Object.keys(preview.report)).not.toContain('hosts');
});

it('S10: without an active catalog the export says catalogVersion null; a malformed version is never copied', () => {
  expect(createExportPreview(report(), 1000).report.catalogVersion).toBeNull();
  expect(createExportPreview(report({ catalogVersion: 'a/b?c' }), 1000).report.catalogVersion).toBeNull();
  const preview = createExportPreview(report(), 1000);
  expect(validateUiResponse({ schemaVersion: 1, type: 'export-preview', preview })).toBe(true);
});
