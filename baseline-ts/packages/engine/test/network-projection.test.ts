import { describe, expect, it } from 'vitest';
import { MAX_COUNT, type CounterEntry } from '@detect-expert/contracts';
import { EngineInvariantError, projectReport, verifyProjection } from '../src/projection';
import { LIMITATION_CODES } from '../src/codes';
import { counter, report } from './fixtures';
import { makeFinding } from '../src/rules/types';

const attempt = (id: 'DET-058' | 'DET-060', count: number, pattern = false): CounterEntry => counter({
  techniqueId: id, count, phase: 'attempted', signalCodes: pattern ? ['api-use', 'local-multi-port'] : ['api-use'],
});
const opts = { scopeMode: 'all-sites' as const, catalogEnabled: true };

describe('DET-058/060 browser request projection / ADR-025', () => {
  it('projects only a bounded lower-confidence DNS hypothesis from independent browser counters', () => {
    const dns: CounterEntry = counter({ techniqueId: 'DET-061', phase: 'attempted', count: 8,
      signalCodes: ['api-use', 'unique-subdomains'], countQuality: 'lower-bound' });
    const spoofed = makeFinding({ ruleId: 'page-dns', ruleVersion: '1', techniqueId: 'DET-061',
      interpretation: 'fingerprinting-pattern', interpretationConfidence: 'high', evidenceIds: ['fake'], limitationCodes: [], counterEvidenceCodes: [] });
    const projected = projectReport(report({ counters: [{ ...dns, count: MAX_COUNT }], findings: [spoofed] }), { ...opts, browserNetworkCounters: [dns] });
    expect(projected.techniques[0]).toMatchObject({ techniqueId: 'DET-061', count: 8, countQuality: 'lower-bound',
      evidenceSource: 'browser-network', integrity: 'browser-observed', interpretation: 'dns-test-pattern', interpretationConfidence: 'low' });
    expect(projected.findings[0]).toMatchObject({ ruleId: 'browser-dns-series', vendorMatchIds: [] });
    expect(projected.findings[0]?.limitationCodes).toContain(LIMITATION_CODES.uncalibratedThreshold);
    expect(verifyProjection(projected)).toEqual([]);
    for (const changed of [{ ...dns, countQuality: 'exact' as const }, { ...dns, signalCodes: ['api-use'] as CounterEntry['signalCodes'] },
      { ...dns, signalCodes: ['api-use', 'local-multi-port'] as CounterEntry['signalCodes'] }]) {
      expect(() => projectReport(report(), { ...opts, browserNetworkCounters: [changed] })).toThrow(EngineInvariantError);
    }
  });

  it('keeps one local connection neutral and reports a browser attempt, not its result', () => {
    const projected = projectReport(report(), { ...opts, browserNetworkCounters: [attempt('DET-058', 1), attempt('DET-060', 1)] });
    expect(projected.techniques).toHaveLength(2);
    for (const technique of projected.techniques) expect(technique).toMatchObject({ count: 1, phases: ['attempted'],
      evidenceSource: 'browser-network', integrity: 'browser-observed', attributionConfidence: 'frame-only',
      interpretation: 'api-use', interpretationConfidence: 'unassessed' });
    expect(projected.findings.every(f => f.limitationCodes.includes(LIMITATION_CODES.purposeUnknown))).toBe(true);
    expect(projected.findings.every(f => !f.limitationCodes.includes(LIMITATION_CODES.pageControlledEvidence))).toBe(true);
    expect(projected.observedSince).toBe(report().createdAt);
    expect(verifyProjection(projected)).toEqual([]);
  });

  it('counts a pattern-marked subset once and caps its interpretation at low confidence', () => {
    const network = [attempt('DET-060', 3), attempt('DET-060', 1, true), attempt('DET-058', 4)];
    const projected = projectReport(report(), { ...opts, browserNetworkCounters: network });
    expect(projected.techniques.find(t => t.techniqueId === 'DET-060')).toMatchObject({ count: 4,
      interpretation: 'local-probe-pattern', interpretationConfidence: 'low', phases: ['attempted'] });
    expect(projected.techniques.find(t => t.techniqueId === 'DET-058')?.interpretation).toBe('api-use');
    const finding = projected.findings.find(f => f.techniqueId === 'DET-060')!;
    expect(finding.limitationCodes).toContain(LIMITATION_CODES.uncalibratedThreshold);
    expect(finding.coverageRef).toBeDefined();
    expect(verifyProjection(projected)).toEqual([]);
  });

  it('cannot promote page-spoofed count, signal or finding to browser evidence', () => {
    const forged = attempt('DET-060', MAX_COUNT, true);
    const injected = makeFinding({ ruleId: 'fake-page-rule', ruleVersion: '1', techniqueId: 'DET-060',
      interpretation: 'fingerprinting-pattern', interpretationConfidence: 'high', evidenceIds: ['fake'],
      limitationCodes: [], counterEvidenceCodes: [] });
    const original = report({ counters: [forged, counter({ techniqueId: 'DET-001', count: 2 })], findings: [injected] });
    const pageOnly = projectReport(original, opts);
    expect(pageOnly.techniques.find(t => t.techniqueId === 'DET-060')?.integrity).toBe('page-controlled');
    const projected = projectReport(original, { ...opts, browserNetworkCounters: [attempt('DET-060', 1)] });
    expect(projected.techniques.find(t => t.techniqueId === 'DET-060')).toMatchObject({ count: 1,
      signalCodes: ['api-use'], interpretation: 'api-use', integrity: 'browser-observed' });
    expect(projected.findings.some(f => f.ruleId === 'fake-page-rule')).toBe(false);
    expect(projected.techniques.find(t => t.techniqueId === 'DET-001')).toMatchObject({ count: 2, integrity: 'page-controlled' });
    expect(original.counters[0]?.count).toBe(MAX_COUNT);
    expect(original.findings).toEqual([injected]);
  });

  it('does not elevate a zero-count browser entry or convert failed nonlocal calls into local probes', () => {
    const projected = projectReport(report({ counters: [attempt('DET-060', 1)] }), {
      ...opts, browserNetworkCounters: [attempt('DET-060', 0), attempt('DET-058', 30)],
    });
    expect(projected.techniques.find(t => t.techniqueId === 'DET-060')?.integrity).toBe('page-controlled');
    expect(projected.techniques.find(t => t.techniqueId === 'DET-058')).toMatchObject({ interpretation: 'api-use', count: 30 });
    expect(projected.findings.some(f => f.interpretation === 'local-probe-pattern')).toBe(false);
  });

  it('keeps bounded lower bounds, loss and coverage next to browser facts', () => {
    const first = { ...attempt('DET-060', MAX_COUNT), countQuality: 'lower-bound' as const, firstBucket: 2, lastBucket: 8 };
    const projected = projectReport(report({ coverageState: 'partial', coverageFlags: ['worker-not-observed'] }), {
      ...opts, browserNetworkCounters: [first, { ...attempt('DET-060', 4, true), firstBucket: 10, lastBucket: 11 }],
    });
    expect(projected.techniques[0]).toMatchObject({ count: MAX_COUNT, countQuality: 'lower-bound', firstBucket: 2, lastBucket: 11 });
    expect(projected.coverageFlags).toEqual(['worker-not-observed']);
    expect(verifyProjection(projected)).toEqual([]);
  });

  it('copies only canonical fields and cannot export addresses, ports or caller data from internal entries', () => {
    const internal = { ...attempt('DET-060', 1), rawUrl: 'http://127.0.0.1:49123/CANARY', endpoint: 'CANARY' };
    const projected = projectReport(report(), { ...opts, browserNetworkCounters: [internal] });
    expect(JSON.stringify(projected)).not.toMatch(/CANARY|49123|127\.0\.0\.1|rawUrl|endpoint|browserNetworkCounters/);
    projected.techniques[0]!.signalCodes.push('late-start');
    expect(internal.signalCodes).toEqual(['api-use']);
  });

  it('does not label a saturated sum of independently exact attempt counters as exact', () => {
    const projected = projectReport(report(), { ...opts,
      browserNetworkCounters: [attempt('DET-060', MAX_COUNT), attempt('DET-060', 1, true)] });
    expect(projected.techniques[0]).toMatchObject({ count: MAX_COUNT, countQuality: 'lower-bound' });
  });

  it.each([
    [counter({ techniqueId: 'DET-001', count: 1, phase: 'attempted' })],
    [{ ...attempt('DET-060', 1), phase: 'returned-sync' }],
    [attempt('DET-058', 1, true)],
    [attempt('DET-060', -1)],
    Array.from({ length: 5 }, () => attempt('DET-060', 1)),
  ])('rejects malformed trusted aggregate input %j', (...entries) => {
    expect(() => projectReport(report(), { ...opts, browserNetworkCounters: entries as CounterEntry[] })).toThrow(EngineInvariantError);
  });
});
