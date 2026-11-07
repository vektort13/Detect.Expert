import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { COVERAGE_FLAGS, EMPTY_DROPPED, type ReportProjection } from '@detect-expert/contracts';
import {
  EngineInvariantError,
  LIMITATION_CODES,
  interpretReport,
  projectReport,
  summarizeSources,
  verifyProjection,
  type CoverageContext,
  type SiteRelationClassifier,
} from '../src/index';
import { EDITOR, FP_POSITIVE, hostEntry, report } from './fixtures';

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

  it('states vendors: [] and a catalog-disabled limitation on every finding in slice 1', () => {
    const p = projectReport(fpReport(), { scopeMode: 'site' });
    expect(p.vendors).toEqual([]);
    expect(p.findings.length).toBeGreaterThan(0);
    for (const f of p.findings) {
      expect(f.limitationCodes).toContain(LIMITATION_CODES.catalogDisabled);
      expect(f.vendorMatchIds).toEqual([]);
    }
    const withCatalog = projectReport(fpReport(), { scopeMode: 'site', catalogEnabled: true });
    for (const f of withCatalog.findings) expect(f.limitationCodes).not.toContain(LIMITATION_CODES.catalogDisabled);
  });

  it('never lists network hosts inside the projection', () => {
    const text = JSON.stringify(projectReport(fpReport(), { scopeMode: 'site' }));
    expect(text).not.toContain('tracker.net');
    expect(text).not.toContain('cdn.example.com');
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

describe('summarizeSources', () => {
  it('counts hosts by site relation without listing them unless asked', () => {
    const s = summarizeSources(fpReport());
    expect(s.total).toBe(3);
    expect(s.requests).toBe(11);
    // default classifier is host equality: sub-domains count as cross-site until a PSL classifier is injected
    expect(s.byRelation).toEqual({ 'same-origin': 1, 'same-site': 0, 'cross-site': 2, opaque: 0, unknown: 0 });
    expect(s.hosts).toBeUndefined();
    expect(JSON.stringify(s)).not.toContain('tracker.net');
    const listed = summarizeSources(fpReport(), { includeHosts: true });
    expect(listed.hosts).toEqual(['cdn.example.com', 'example.com', 'tracker.net']);
  });

  it('accepts an injected PSL-aware classifier and reports unknown without a document host', () => {
    const psl: SiteRelationClassifier = (host, doc) => (doc === null ? 'unknown' : host === doc ? 'same-origin' : host.endsWith('.' + doc) ? 'same-site' : 'cross-site');
    const s = summarizeSources(fpReport(), { siteRelation: psl });
    expect(s.byRelation['same-site']).toBe(1);
    expect(s.byRelation['cross-site']).toBe(1);
    const noHost = summarizeSources({ ...fpReport(), host: null }, { siteRelation: psl });
    expect(noHost.byRelation.unknown).toBe(3);
  });

  it('skips unsanitized stored hosts and carries the evicted count', () => {
    const r = fpReport();
    const s = summarizeSources({ ...r, hosts: [...r.hosts, hostEntry('https://bad.example/x')], dropped: { ...r.dropped, hosts: 4 } }, { includeHosts: true });
    expect(s.total).toBe(3);
    expect(s.hosts).not.toContain('https://bad.example/x');
    expect(s.dropped).toBe(4);
  });
});
