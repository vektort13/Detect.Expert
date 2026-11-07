import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { COVERAGE_FLAGS, EMPTY_DROPPED, MAX_COUNT, type CounterEntry, type HostEntry, type OperationCode, type ReportProjection, type VendorSummary } from '@detect-expert/contracts';
import {
  EngineInvariantError,
  LIMITATION_CODES,
  VENDOR_SUMMARY_ALLOWLIST,
  interpretReport,
  projectReport,
  summarizeSources,
  summarizeTechniques,
  verifyProjection,
  walkAllowlist,
  type CoverageContext,
  type VendorCatalogView,
  type VendorRuleView,
} from '../src/index';
import { EDITOR, FP_POSITIVE, TAINTED_ONLY, counter, hostEntry, networkCounter, report } from './fixtures';

const schemasDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'contracts', 'schemas');

function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(schemasDir, name), 'utf8')) as Record<string, unknown>;
}

const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addSchema(loadSchema('common.v1.schema.json'));
const validateProjectionSchema = ajv.compile(loadSchema('report-projection.v1.schema.json'));

const granted: CoverageContext = { scopeMode: 'site', accessGranted: true, restricted: false, paused: false, inaccessibleFrames: 0 };

function fpReport() {
  return interpretReport(report({ counters: FP_POSITIVE, hosts: [hostEntry('example.com', 3), hostEntry('cdn.example.com'), hostEntry('tracker.net', 7)] }), granted).report;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// S10: structural catalog views (the engine never imports @detect-expert/catalog).
const NOW = 1_000;
const rule = (ruleId: string, vendorId: string, strength: VendorRuleView['strength'], expiresAtMs = 10_000): VendorRuleView =>
  ({ ruleId, vendorId, strength, evidenceOrigin: 'network_request', expiresAtMs });
const VIEW: VendorCatalogView = {
  catalogVersion: 'synthetic-test-1',
  rulesById: new Map([['syn-a', rule('syn-a', 'syn', 'documented-resource')], ['old', rule('old', 'syn', 'documented-resource', NOW)]]),
};
const EMPTY_VIEW: VendorCatalogView = { catalogVersion: '2026-09-12.ca2d4012', rulesById: new Map() };

describe('projectReport (REQ-005, REQ-013)', () => {
  it('P07: ring lower bound survives the projection allowlist and rejects non-count values', () => {
    const source = fpReport();
    source.dropped.ring = 1;
    const projection = projectReport(source, { scopeMode: 'site' });
    expect(projection.dropped.ring).toBe(1);
    expect(validateProjectionSchema(projection)).toBe(true);
    expect(verifyProjection({ ...projection, dropped: { ...projection.dropped, ring: 'secret' } })).not.toEqual([]);
  });
  it('builds a contract-shaped projection that the JSON Schema accepts', () => {
    const p = projectReport(fpReport(), { scopeMode: 'site' });
    expect(validateProjectionSchema(p)).toBe(true);
    expect(verifyProjection(p)).toEqual([]);
    expect(p.reportRevision).toBe(1);
    expect(p.host).toBe('example.com');
    expect(p.coverageState).toBe('active');
    expect(p.scopeMode).toBe('site');
    expect(p.observedSince).toBe(1_700_000_000_000);
    expect(p.dropped).toEqual(EMPTY_DROPPED);
  });

  it('summarizes techniques per technique with strongest interpretation, unions and totals', () => {
    const p = projectReport(fpReport(), { scopeMode: 'site' });
    expect(p.techniques.map((t) => t.techniqueId)).toEqual(['DET-002', 'DET-003']);
    const t2 = p.techniques[0];
    expect(t2?.count).toBe(2);
    expect(t2?.countQuality).toBe('exact');
    expect(t2?.phases).toEqual(['returned-sync']);
    expect(t2?.signalCodes).toEqual(['api-use', 'readback-after-text']);
    expect(t2?.interpretation).toBe('possible-fingerprinting');
    expect(t2?.interpretationConfidence).toBe('low');
    expect(t2?.evidenceSource).toBe('page-hook');
    expect(t2?.integrity).toBe('page-controlled');
    expect(t2?.attributionConfidence).toBe('unknown');
    const t3 = p.techniques[1];
    expect(t3?.interpretation).toBe('api-use');
    expect(t3?.interpretationConfidence).toBe('unassessed');
  });

  it('aggregates several counters of one technique and downgrades to lower-bound when keys were dropped', () => {
    const r = interpretReport(report({ counters: [...EDITOR, { ...(EDITOR[0] as (typeof EDITOR)[number]), phase: 'threw-sync', count: 2, firstBucket: 0, lastBucket: 9 }] }), granted).report;
    const p = projectReport(r, { scopeMode: 'site' });
    const t3 = p.techniques.find((t) => t.techniqueId === 'DET-003');
    expect(t3?.count).toBe(302);
    expect(t3?.phases).toEqual(['returned-sync', 'threw-sync']);
    expect(t3?.firstBucket).toBe(0);
    expect(t3?.lastBucket).toBe(9);
    const dropped = projectReport({ ...r, dropped: { ...r.dropped, counters: 1 } }, { scopeMode: 'site' });
    for (const t of dropped.techniques) expect(t.countQuality).toBe('lower-bound');
  });

  it('retains the single editor export signal without projecting a fingerprint hypothesis (F043)', () => {
    const p = projectReport(interpretReport(report({ counters: EDITOR }), granted).report, { scopeMode: 'site' });
    expect(p.findings).toHaveLength(2);
    expect(p.findings.every((f) => f.interpretation === 'api-use' && f.interpretationConfidence === 'unassessed')).toBe(true);
    expect(p.techniques.find((t) => t.techniqueId === 'DET-001')).toMatchObject({
      count: 1,
      signalCodes: ['api-use', 'export-after-text'],
      interpretation: 'api-use',
      interpretationConfidence: 'unassessed',
    });
  });

  it('preserves the unwindowed low-confidence limitation on projected findings (F041/F122)', () => {
    const p = projectReport(fpReport(), { scopeMode: 'site' });
    const fp = p.findings.filter((f) => f.interpretation !== 'api-use');
    expect(fp).toHaveLength(1);
    expect(fp[0]).toMatchObject({ interpretation: 'possible-fingerprinting', interpretationConfidence: 'low', ruleVersion: '2' });
    expect(fp[0]?.limitationCodes).toContain(LIMITATION_CODES.noTimeWindow);
    expect(fp[0]?.limitationCodes).toContain(LIMITATION_CODES.uncalibratedThreshold);
  });

  it('without an active catalog: vendors [], catalogVersion null and catalog-disabled on every finding', () => {
    for (const catalog of [undefined, null, { view: EMPTY_VIEW, nowMs: NOW }]) {
      const p = projectReport(fpReport(), catalog === undefined ? { scopeMode: 'site' } : { scopeMode: 'site', catalog });
      expect(p.vendors).toEqual([]);
      expect(p.catalogVersion).toBeNull();
      expect(p.findings.length).toBeGreaterThan(0);
      for (const f of p.findings) {
        expect(f.limitationCodes).toContain(LIMITATION_CODES.catalogDisabled);
        expect(f.vendorMatchIds).toEqual([]);
      }
    }
    const withCatalog = projectReport(fpReport(), { scopeMode: 'site', catalog: { view: VIEW, nowMs: NOW } });
    expect(withCatalog.catalogVersion).toBe('synthetic-test-1');
    for (const f of withCatalog.findings) expect(f.limitationCodes).not.toContain(LIMITATION_CODES.catalogDisabled);
  });

  it('S10: vendors and host ruleIds come from hosts only under an active catalog; expired or unknown rules are dropped', () => {
    const base = fpReport();
    const tagged = { ...base, hosts: base.hosts.map((h) => (h.registrableDomain === 'tracker.net' ? { ...h, ruleIds: ['syn-a', 'gone', 'old'] } : h)) };
    const p = projectReport(tagged, { scopeMode: 'site', catalog: { view: VIEW, nowMs: NOW } });
    expect(p.vendors).toEqual([{ vendorId: 'syn', vendorConfidence: 'documented-resource', ruleIds: ['syn-a'], evidenceSource: 'browser-network', integrity: 'browser-observed' }]);
    expect(p.hosts.find((h) => h.registrableDomain === 'tracker.net')?.ruleIds).toEqual(['syn-a']);
    expect(verifyProjection(p)).toEqual([]);
    expect(validateProjectionSchema(p)).toBe(true);
    const off = projectReport(tagged, { scopeMode: 'site' });
    expect(off.vendors).toEqual([]);
    expect(off.hosts.every((h) => h.ruleIds.length === 0)).toBe(true);
    expect(validateProjectionSchema(off)).toBe(true);
    const later = projectReport(tagged, { scopeMode: 'site', catalog: { view: VIEW, nowMs: 10_000 } });
    expect(later.vendors).toEqual([]);
    expect(later.hosts.every((h) => h.ruleIds.length === 0)).toBe(true);
    expect(later.catalogVersion).toBe('synthetic-test-1');
  });

  it('S10: a catalog version outside the wire pattern is an engine invariant violation', () => {
    const bad = { catalogVersion: 'a/b', rulesById: VIEW.rulesById };
    expect(() => projectReport(fpReport(), { scopeMode: 'site', catalog: { view: bad, nowMs: NOW } })).toThrow(EngineInvariantError);
  });

  it('S07: lists only PSL-normalized browser-observed hosts, third-party first (cdn.example.com is not a registrable domain)', () => {
    const p = projectReport(fpReport(), { scopeMode: 'site' });
    expect(p.hosts.map((h) => [h.registrableDomain, h.relation, h.requestCount])).toEqual([
      ['tracker.net', 'cross-site', 7],
      ['example.com', 'same-origin', 3],
    ]);
    expect(JSON.stringify(p)).not.toContain('cdn.example.com');
    expect(validateProjectionSchema(p)).toBe(true);
  });

  it('observedSince is null without observations and can be overridden', () => {
    expect(projectReport(report(), { scopeMode: 'off' }).observedSince).toBeNull();
    expect(projectReport(fpReport(), { scopeMode: 'site', observedSince: 5 }).observedSince).toBe(5);
    expect(projectReport(fpReport(), { scopeMode: 'site', observedSince: null }).observedSince).toBeNull();
  });

  it('throws EngineInvariantError instead of emitting an unsanitized host', () => {
    const r = fpReport();
    expect(() => projectReport({ ...r, host: 'https://example.com/path?q=1' }, { scopeMode: 'site' })).toThrow(EngineInvariantError);
    expect(() => projectReport({ ...r, host: 'Example.COM' }, { scopeMode: 'site' })).toThrow(EngineInvariantError);
  });

  it('throws when a stored finding carries a code outside the enum alphabet', () => {
    const r = fpReport();
    const bad = clone(r);
    bad.findings[0]?.limitationCodes.push('see https://example.com/x');
    expect(() => projectReport(bad, { scopeMode: 'site' })).toThrow(EngineInvariantError);
  });
});

describe('S11 / ADR-019 disabledSensors in the projection', () => {
  it('is omitted without disabled families and for an empty list', () => {
    expect(projectReport(fpReport(), { scopeMode: 'site' })).not.toHaveProperty('disabledSensors');
    expect(projectReport(fpReport(), { scopeMode: 'site', disabledSensors: [] })).not.toHaveProperty('disabledSensors');
  });

  it('copies registry ids in registry order, unique, with ordered sources; the schema accepts it; rules are unchanged', () => {
    const base = projectReport(fpReport(), { scopeMode: 'site' });
    const projection = projectReport(fpReport(), {
      scopeMode: 'site',
      disabledSensors: [
        { sensorId: 'geometry', disabledBy: [], hooksMayRemain: false },
        { sensorId: 'canvas', disabledBy: ['organization', 'user'], hooksMayRemain: true },
        { sensorId: 'canvas', disabledBy: ['user'], hooksMayRemain: false },
      ],
    });
    expect(projection.disabledSensors).toEqual([
      { sensorId: 'canvas', disabledBy: ['user', 'organization'], hooksMayRemain: true },
      { sensorId: 'geometry', disabledBy: [], hooksMayRemain: false },
    ]);
    expect(validateProjectionSchema(projection)).toBe(true);
    const { disabledSensors: _d, ...rest } = projection;
    expect(rest).toEqual(base);
  });

  it('an unknown id, source or a non-boolean is an engine invariant violation', () => {
    expect(() => projectReport(fpReport(), { scopeMode: 'site', disabledSensors: [{ sensorId: 'math' as never, disabledBy: ['user'], hooksMayRemain: false }] })).toThrow(EngineInvariantError);
    expect(() => projectReport(fpReport(), { scopeMode: 'site', disabledSensors: [{ sensorId: 'canvas', disabledBy: ['admin' as never], hooksMayRemain: false }] })).toThrow(EngineInvariantError);
    expect(() => projectReport(fpReport(), { scopeMode: 'site', disabledSensors: [{ sensorId: 'canvas', disabledBy: ['user'], hooksMayRemain: 'yes' as never }] })).toThrow(EngineInvariantError);
    const projection = projectReport(fpReport(), { scopeMode: 'site' });
    expect(verifyProjection({ ...projection, disabledSensors: [{ sensorId: 'canvas', disabledBy: [], hooksMayRemain: false, url: 'https://x' }] })).not.toEqual([]);
  });
});

describe('projection allowlist walker (redaction)', () => {
  const base = (): ReportProjection => projectReport(fpReport(), { scopeMode: 'site' });

  it('rejects an injected raw url field on a finding', () => {
    const p = clone(base()) as unknown as { findings: Array<Record<string, unknown>> };
    (p.findings[0] as Record<string, unknown>)['url'] = 'https://example.com/account/12345?token=abc';
    const v = verifyProjection(p);
    expect(v).toEqual(['$.findings[0].url: key not in allowlist']);
  });

  it('rejects unknown top-level and nested keys', () => {
    const p = clone(base()) as unknown as Record<string, unknown>;
    p['rawUrl'] = 'https://example.com/';
    (p['dropped'] as Record<string, unknown>)['stack'] = 'Error at foo';
    (p['techniques'] as Array<Record<string, unknown>>)[0]!['text'] = 'canary';
    const v = verifyProjection(p);
    expect(v).toEqual(expect.arrayContaining(['$.rawUrl: key not in allowlist', '$.dropped.stack: key not in allowlist', '$.techniques[0].text: key not in allowlist']));
    expect(v).toHaveLength(3);
  });

  it('rejects strings outside the enum/id alphabets (a URL smuggled into an evidence id or a code)', () => {
    const p = clone(base());
    p.findings[0]?.evidenceIds.push('https://example.com/a');
    p.findings[0]?.counterEvidenceCodes.push('Http://x');
    const v = verifyProjection(p);
    expect(v.some((s) => s.startsWith('$.findings[0].evidenceIds['))).toBe(true);
    expect(v.some((s) => s.startsWith('$.findings[0].counterEvidenceCodes['))).toBe(true);
  });

  it('rejects missing required keys, wrong types, unsanitized hosts and oversized arrays', () => {
    const p = clone(base()) as unknown as Record<string, unknown>;
    delete p['dropped'];
    p['host'] = 'Example.com/path';
    p['reportRevision'] = -1;
    p['coverageFlags'] = Array.from({ length: COVERAGE_FLAGS.length + 1 }, () => 'late-start');
    const v = verifyProjection(p);
    expect(v).toEqual(expect.arrayContaining(['$.dropped: missing', '$.host: not a sanitized host', '$.reportRevision: not an integer in range', '$.coverageFlags: too many items']));
  });

  it('rejects non-plain objects and never throws on hostile input', () => {
    expect(verifyProjection(null)).toEqual(['$: not a plain object']);
    expect(verifyProjection(new Map())).toEqual(['$: not a plain object']);
    const hostile = new Proxy({}, { ownKeys() { throw new Error('boom'); } });
    expect(verifyProjection(hostile)).toEqual(['$: exception while walking']);
  });

  it('accepts the optional coverageRef being absent', () => {
    const p = clone(base());
    for (const f of p.findings) delete f.coverageRef;
    expect(verifyProjection(p)).toEqual([]);
  });
});

describe('ADR-017 operationCodes in technique summaries', () => {
  const withOp = (techniqueId: CounterEntry['techniqueId'], operationCode: OperationCode, count = 1): CounterEntry => ({
    ...counter({ techniqueId, count }),
    operationCode,
  });

  it('lists unique codes in PAGE_OPERATIONS order, whatever the counter order', () => {
    const counters = [
      withOp('DET-011', 'supported-extensions'),
      withOp('DET-011', 'param-unmasked-renderer', 3),
      withOp('DET-011', 'param-vendor'),
      { ...withOp('DET-011', 'param-vendor', 2), phase: 'threw-sync' as const },
      counter({ techniqueId: 'DET-011', count: 4 }),
    ];
    const [summary] = summarizeTechniques(report({ counters }));
    expect(summary?.operationCodes).toEqual(['param-vendor', 'param-unmasked-renderer', 'supported-extensions']);
    expect(summary?.count).toBe(11);
    const p = projectReport(interpretReport(report({ counters }), granted).report, { scopeMode: 'site' });
    expect(p.techniques[0]?.operationCodes).toEqual(['param-vendor', 'param-unmasked-renderer', 'supported-extensions']);
    expect(validateProjectionSchema(p)).toBe(true);
    expect(verifyProjection(p)).toEqual([]);
  });

  it('omits the field when no counter of the technique carries an operation', () => {
    const [summary] = summarizeTechniques(report({ counters: [counter({ techniqueId: 'DET-025', count: 2 })] }));
    expect(summary).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(summary, 'operationCodes')).toBe(false);
  });

  it('verifyProjection rejects an unknown operation code and a non-array; the schema rejects an empty list', () => {
    const p = projectReport(interpretReport(report({ counters: [withOp('DET-025', 'user-agent')] }), granted).report, { scopeMode: 'site' });
    expect(verifyProjection(p)).toEqual([]);
    const bad = clone(p) as unknown as { techniques: Array<Record<string, unknown>> };
    bad.techniques[0]!['operationCodes'] = ['user-agent', 'https://x'];
    expect(verifyProjection(bad)).toEqual(['$.techniques[0].operationCodes[1]: not an allowed enum member']);
    bad.techniques[0]!['operationCodes'] = 'user-agent';
    expect(verifyProjection(bad)).toEqual(['$.techniques[0].operationCodes: not an array']);
    expect(validateProjectionSchema({ ...p, techniques: [{ ...p.techniques[0], operationCodes: [] }] })).toBe(false);
  });

  it('canvas projections are deep-equal to the pre-ADR-017 output (no operation field, v1 evidence ids)', () => {
    const project = (counters: CounterEntry[]) => projectReport(interpretReport(report({ counters }), granted).report, { scopeMode: 'site' });
    const common = { evidenceSource: 'page-hook', integrity: 'page-controlled', attributionConfidence: 'unknown', firstBucket: 1, lastBucket: 1 } as const;
    const fp = project(FP_POSITIVE);
    expect(fp.techniques).toEqual([
      { techniqueId: 'DET-002', count: 2, countQuality: 'exact', phases: ['returned-sync'], signalCodes: ['api-use', 'readback-after-text'], interpretation: 'possible-fingerprinting', interpretationConfidence: 'low', ...common },
      { techniqueId: 'DET-003', count: 6, countQuality: 'exact', phases: ['returned-sync'], signalCodes: ['api-use', 'text-drawn'], interpretation: 'api-use', interpretationConfidence: 'unassessed', ...common },
    ]);
    expect(fp.findings.map((f) => f.evidenceIds)).toEqual([
      ['DET-002|returned-sync|api-use,readback-after-text'],
      ['DET-003|returned-sync|api-use,text-drawn'],
      ['DET-002|returned-sync|api-use,readback-after-text', 'DET-003|returned-sync|api-use,text-drawn'],
    ]);
    expect(project(EDITOR).techniques).toEqual([
      { techniqueId: 'DET-001', count: 1, countQuality: 'exact', phases: ['attempted'], signalCodes: ['api-use', 'export-after-text'], interpretation: 'api-use', interpretationConfidence: 'unassessed', ...common },
      { techniqueId: 'DET-003', count: 300, countQuality: 'exact', phases: ['returned-sync'], signalCodes: ['api-use', 'text-drawn'], interpretation: 'api-use', interpretationConfidence: 'unassessed', ...common },
    ]);
    const tainted = project(TAINTED_ONLY);
    expect(tainted.techniques).toEqual([
      { techniqueId: 'DET-002', count: 3, countQuality: 'exact', phases: ['threw-sync'], signalCodes: ['api-use', 'tainted-canvas-attempt'], interpretation: 'api-use', interpretationConfidence: 'unassessed', ...common },
    ]);
    expect(tainted.findings.map((f) => f.evidenceIds)).toEqual([['DET-002|threw-sync|api-use,tainted-canvas-attempt']]);
  });
});

describe('D2-06/D4-01 vendor allowlist uses the canonical vendorConfidence', () => {
  const vendor: VendorSummary = { vendorId: 'candidate', vendorConfidence: 'weak-signal', ruleIds: ['r-1'], evidenceSource: 'browser-network', integrity: 'browser-observed' };

  it('a non-empty vendors list passes the allowlist and the JSON Schema', () => {
    const p = { ...projectReport(fpReport(), { scopeMode: 'site' }), vendors: [vendor] };
    expect(verifyProjection(p)).toEqual([]);
    expect(validateProjectionSchema(p)).toBe(true);
  });

  it('an object with vendorMatch is rejected: key not in allowlist and vendorConfidence missing', () => {
    const legacy = { vendorId: 'candidate', vendorMatch: 'weak-signal', ruleIds: [], evidenceSource: 'browser-network', integrity: 'browser-observed' };
    const out: string[] = [];
    walkAllowlist(legacy, VENDOR_SUMMARY_ALLOWLIST, '$', out);
    expect(out).toEqual(['$.vendorMatch: key not in allowlist', '$.vendorConfidence: missing']);
    const p = { ...projectReport(fpReport(), { scopeMode: 'site' }), vendors: [legacy] };
    expect(verifyProjection(p)).toEqual(['$.vendors[0].vendorMatch: key not in allowlist', '$.vendors[0].vendorConfidence: missing']);
    expect(validateProjectionSchema(p)).toBe(false);
  });
});

describe('summarizeSources', () => {
  it('counts hosts by their stored relation without listing them unless asked', () => {
    const s = summarizeSources(fpReport());
    // cdn.example.com is not a PSL registrable domain: a malformed stored entry is not counted (S07).
    expect(s.total).toBe(2);
    expect(s.requests).toBe(10);
    expect(s.byRelation).toEqual({ 'same-origin': 1, 'same-site': 0, 'cross-site': 1, opaque: 0, unknown: 0 });
    expect(s.hosts).toBeUndefined();
    expect(JSON.stringify(s)).not.toContain('tracker.net');
    const listed = summarizeSources(fpReport(), { includeHosts: true });
    expect(listed.hosts).toEqual(['example.com', 'tracker.net']);
  });

  it('uses the relation recorded by the SW (initiator-based), including categories', () => {
    const hosts: HostEntry[] = [
      { ...hostEntry('vendor.net'), relation: 'same-site' },
      { category: 'loopback', relation: 'unknown', evidenceSource: 'browser-network', integrity: 'browser-observed', requestCount: 2, firstSeenBucket: 0, lastSeenBucket: 0, ruleIds: [] },
    ];
    const s = summarizeSources(report({ hosts }), { includeHosts: true });
    expect(s.byRelation).toEqual({ 'same-origin': 0, 'same-site': 1, 'cross-site': 0, opaque: 0, unknown: 1 });
    expect(s.hosts).toEqual(['loopback', 'vendor.net']);
  });

  it('skips unsanitized stored hosts and carries the evicted count', () => {
    const r = fpReport();
    const s = summarizeSources({ ...r, hosts: [...r.hosts, hostEntry('https://bad.example/x')], dropped: { ...r.dropped, hosts: 4 } }, { includeHosts: true });
    expect(s.total).toBe(2);
    expect(s.hosts).not.toContain('https://bad.example/x');
    expect(s.dropped).toBe(4);
  });
});

describe('S07 / ADR-018 hosts in the projection', () => {
  const category = (c: NonNullable<HostEntry['category']>, requestCount = 1, relation: HostEntry['relation'] = 'cross-site'): HostEntry => ({
    category: c, relation, evidenceSource: 'browser-network', integrity: 'browser-observed', requestCount, firstSeenBucket: 0, lastSeenBucket: 2, ruleIds: [],
  });

  it('copies only allowlisted keys and skips entries with both fields, neither field or a non-PSL domain', () => {
    const extra = { ...hostEntry('vendor.net', 2), path: '/collect?id=1', ip: '192.168.1.5' } as unknown as HostEntry;
    const both = { ...hostEntry('both.net'), category: 'loopback' } as HostEntry;
    const { registrableDomain: _d, ...neither } = hostEntry('neither.net');
    const r = report({ hosts: [extra, both, neither as HostEntry, hostEntry('a.b.vendor.net'), hostEntry('Vendor.NET'), category('private', 4)] });
    const p = projectReport(r, { scopeMode: 'all-sites' });
    expect(p.hosts).toEqual([
      category('private', 4),
      { registrableDomain: 'vendor.net', relation: 'cross-site', evidenceSource: 'browser-network', integrity: 'browser-observed', requestCount: 2, firstSeenBucket: 0, lastSeenBucket: 1, ruleIds: [] },
    ]);
    expect(JSON.stringify(p)).not.toMatch(/collect|192\.168|both\.net|neither\.net|a\.b\.vendor/);
    expect(verifyProjection(p)).toEqual([]);
    expect(validateProjectionSchema(p)).toBe(true);
  });

  it('sorts cross-site first, then by request count desc, then by name; bounded to 128', () => {
    const hosts: HostEntry[] = [
      { ...hostEntry('example.com', 50), relation: 'same-origin' },
      hostEntry('b-vendor.net', 3),
      hostEntry('a-vendor.net', 3),
      category('loopback', 9),
      hostEntry('z-vendor.net', 1),
    ];
    const p = projectReport(report({ hosts }), { scopeMode: 'all-sites' });
    expect(p.hosts.map((h) => h.registrableDomain ?? h.category)).toEqual(['loopback', 'a-vendor.net', 'b-vendor.net', 'z-vendor.net', 'example.com']);
    const many = Array.from({ length: 140 }, (_, i) => hostEntry('v' + String(i) + '.net', i));
    expect(projectReport(report({ hosts: many }), { scopeMode: 'all-sites' }).hosts).toHaveLength(128);
  });

  it('I1: the third-party group is cross-site, opaque and unknown (as in the UI), then request count desc, then name', () => {
    const hosts: HostEntry[] = [
      { ...hostEntry('example.com', 90), relation: 'same-origin' },
      { ...hostEntry('cdn-example.com', 80), relation: 'same-site' },
      category('loopback', 2, 'unknown'), // an IP target has no registrable domain (ADR-008)
      { ...hostEntry('sandbox.net', 2), relation: 'opaque' },
      hostEntry('a-vendor.net', 5),
      category('private', 7, 'same-origin'),
    ];
    const p = projectReport(report({ hosts }), { scopeMode: 'all-sites' });
    expect(p.hosts.map((h) => [h.registrableDomain ?? h.category, h.relation])).toEqual([
      ['a-vendor.net', 'cross-site'],
      ['loopback', 'unknown'],
      ['sandbox.net', 'opaque'],
      ['example.com', 'same-origin'],
      ['cdn-example.com', 'same-site'],
      ['private', 'same-origin'],
    ]);
    // The 128 cap keeps third-party entries first: an opaque/unknown one is never cut in favour of a same-site one.
    const mixed = [
      ...Array.from({ length: 127 }, (_, i): HostEntry => ({ ...hostEntry('s' + String(i) + '.net', 1000), relation: 'same-site' })),
      category('loopback', 1, 'unknown'),
      { ...hostEntry('opaque.net', 1), relation: 'opaque' as const },
    ];
    const capped = projectReport(report({ hosts: mixed }), { scopeMode: 'all-sites' }).hosts;
    expect(capped).toHaveLength(128);
    expect(capped.slice(0, 2).map((h) => h.relation)).toEqual(['unknown', 'opaque']);
  });

  it('verifyProjection enforces exactly one of registrableDomain/category, the enums and PSL domains', () => {
    const p = projectReport(report({ hosts: [hostEntry('vendor.net')] }), { scopeMode: 'all-sites' });
    expect(verifyProjection(p)).toEqual([]);
    const withBoth = clone(p) as unknown as { hosts: Array<Record<string, unknown>> };
    withBoth.hosts[0]!['category'] = 'loopback';
    expect(verifyProjection(withBoth)).toEqual(['$.hosts[0]: exactly one of registrableDomain/category']);
    const neither = clone(p) as unknown as { hosts: Array<Record<string, unknown>> };
    delete neither.hosts[0]!['registrableDomain'];
    expect(verifyProjection(neither)).toEqual(['$.hosts[0]: exactly one of registrableDomain/category']);
    const sub = clone(p) as unknown as { hosts: Array<Record<string, unknown>> };
    sub.hosts[0]!['registrableDomain'] = 'cdn.vendor.net';
    expect(verifyProjection(sub)).toEqual(['$.hosts[0].registrableDomain: not a registrable domain']);
    const badCategory = clone(p) as unknown as { hosts: Array<Record<string, unknown>> };
    delete badCategory.hosts[0]!['registrableDomain'];
    badCategory.hosts[0]!['category'] = '192.168.1.5';
    expect(verifyProjection(badCategory)).toEqual(['$.hosts[0].category: not an allowed enum member']);
    const url = clone(p) as unknown as { hosts: Array<Record<string, unknown>> };
    url.hosts[0]!['url'] = 'https://vendor.net/collect?id=1';
    url.hosts[0]!['relation'] = 'first-party';
    expect(verifyProjection(url)).toEqual(['$.hosts[0].relation: not an allowed enum member', '$.hosts[0].url: key not in allowlist']);
    const { hosts: _h, ...missing } = p;
    expect(verifyProjection(missing)).toEqual(['$.hosts: missing']);
  });
});

describe('S07 / ADR-018 browser-network technique summaries', () => {
  const project = (over: Parameters<typeof report>[0]) => projectReport(interpretReport(report(over), granted).report, { scopeMode: 'all-sites' });

  it('one browser-network summary per technique after the page-hook ones; frame-only; phases attempted', () => {
    const p = project({ counters: FP_POSITIVE, networkCounters: [networkCounter('DET-059', 6, { firstBucket: 2, lastBucket: 9 }), networkCounter('DET-058', 1)] });
    expect(p.techniques.map((t) => [t.techniqueId, t.evidenceSource])).toEqual([
      ['DET-002', 'page-hook'], ['DET-003', 'page-hook'], ['DET-058', 'browser-network'], ['DET-059', 'browser-network'],
    ]);
    expect(p.techniques[3]).toEqual({
      techniqueId: 'DET-059', count: 6, countQuality: 'exact', phases: ['attempted'], signalCodes: ['api-use'],
      evidenceSource: 'browser-network', integrity: 'browser-observed', interpretation: 'api-use', interpretationConfidence: 'unassessed',
      attributionConfidence: 'frame-only', firstBucket: 2, lastBucket: 9,
    });
    expect(validateProjectionSchema(p)).toBe(true);
    expect(p.findings.find((f) => f.techniqueId === 'DET-059')?.limitationCodes).toEqual(['no-causal-link', 'purpose-unknown', 'catalog-disabled']);
  });

  it('DET-060 gains local-multi-port with its pattern; DET-061 appears only with its pattern and unique-subdomains', () => {
    const counters = [networkCounter('DET-060', 5), networkCounter('DET-061', 9)];
    const below = project({ networkCounters: counters, networkPatterns: { localPortsMax: 3, localTargetsMax: 1, randomSubdomainsMax: 7 } });
    expect(below.techniques.map((t) => [t.techniqueId, t.signalCodes, t.interpretation])).toEqual([['DET-060', ['api-use'], 'api-use']]);
    const met = project({ networkCounters: counters, networkPatterns: { localPortsMax: 4, localTargetsMax: 1, randomSubdomainsMax: 8 } });
    expect(met.techniques.map((t) => [t.techniqueId, t.signalCodes, t.interpretation, t.interpretationConfidence])).toEqual([
      ['DET-060', ['api-use', 'local-multi-port'], 'local-probe-pattern', 'low'],
      ['DET-061', ['api-use', 'unique-subdomains'], 'dns-test-pattern', 'low'],
    ]);
    expect(validateProjectionSchema(met)).toBe(true);
  });

  it('countQuality is lower-bound under network-limited, late-start, truncated, paused (CW-05) or a saturated count', () => {
    for (const flag of ['network-limited', 'late-start', 'truncated', 'paused'] as const) {
      const p = project({ coverageFlags: [flag], networkCounters: [networkCounter('DET-059', 2)] });
      expect(p.techniques[0]?.countQuality).toBe('lower-bound');
    }
    expect(project({ coverageFlags: ['worker-not-observed'], networkCounters: [networkCounter('DET-059', 2)] }).techniques[0]?.countQuality).toBe('exact');
    expect(project({ networkCounters: [networkCounter('DET-059', MAX_COUNT)] }).techniques[0]?.countQuality).toBe('lower-bound');
  });

  it('page-hook counters of DET-058…061 are never summarized and never produce findings', () => {
    const page = [counter({ techniqueId: 'DET-060', count: 40, phase: 'attempted', signalCodes: ['api-use', 'local-multi-port'] }), counter({ techniqueId: 'DET-059', count: 3 })];
    const p = project({ counters: page });
    expect(p.techniques).toEqual([]);
    expect(p.findings).toEqual([]);
  });
});
