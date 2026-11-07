import { describe, expect, it } from 'vitest';
import { BUDGETS, TECHNIQUE_IDS, type Finding } from '@detect-expert/contracts';
import { RULES, applyBatch, interpretReport, runRules, type CoverageContext } from '../src/index';
import { FP_POSITIVE, batch, counter, obs, report } from './fixtures';

const granted: CoverageContext = { scopeMode: 'site', accessGranted: true, restricted: false, paused: false, inaccessibleFrames: 0 };

describe('applyBatch / interpretReport', () => {
  it('runs the full pipeline: merge -> rules -> coverage, one revision bump per applied batch', () => {
    const r0 = report();
    const b1 = batch({ batchSeq: 1, observations: [obs({ techniqueId: 'DET-003', signalCodes: ['api-use', 'text-drawn'], count: 6, intervalBucket: 1 })] });
    const a1 = applyBatch(r0, b1, granted, { now: 10 });
    expect(a1.changed).toBe(true);
    expect(a1.report.revision).toBe(1);
    expect(a1.report.coverageState).toBe('active');
    expect(a1.report.findings.map((f) => f.interpretation)).toEqual(['api-use']);

    const b2 = batch({ batchSeq: 2, observations: [obs({ techniqueId: 'DET-002', count: 2, signalCodes: ['api-use', 'readback-after-text'], intervalBucket: 2 })] });
    const a2 = applyBatch(a1.report, b2, granted, { now: 20 });
    expect(a2.report.revision).toBe(2);
    expect(a2.report.updatedAt).toBe(20);
    const fp = a2.report.findings.find((f) => f.interpretation !== 'api-use');
    expect(fp?.interpretation).toBe('possible-fingerprinting');
    expect(fp?.coverageRef).toBe('cov-active-0000');

    // duplicate redelivery after a lost ACK: nothing changes, same object
    const dup = applyBatch(a2.report, b2, granted, { now: 30 });
    expect(dup.duplicate).toBe(true);
    expect(dup.report).toBe(a2.report);

    // a batch with only stale totals: watermark advances, no revision bump
    const stale = applyBatch(a2.report, batch({ batchSeq: 3, observations: [obs({ techniqueId: 'DET-003', signalCodes: ['api-use', 'text-drawn'], count: 6, intervalBucket: 1 })] }), granted);
    expect(stale.changed).toBe(false);
    expect(stale.report.revision).toBe(2);
    expect(stale.report.watermark?.lastCommittedBatchSeq).toBe(3);
  });

  it('coverage flags in the batch lower the state and the findings confidence together', () => {
    const late = applyBatch(report(), batch({ observations: FP_POSITIVE.map((c) => obs({ techniqueId: c.techniqueId, count: c.count, signalCodes: c.signalCodes })), coverageDelta: ['late-start'] }), granted);
    expect(late.report.coverageState).toBe('late-start');
    const fp = late.report.findings.find((f) => f.interpretation !== 'api-use');
    expect(fp?.interpretationConfidence).toBe('low');
    expect(fp?.coverageRef).toBe('cov-late-start-0001');
  });

  it('interpretReport is idempotent and reacts to a context change', () => {
    const r = interpretReport(report({ counters: FP_POSITIVE }), granted);
    expect(r.changed).toBe(true);
    expect(r.report.revision).toBe(1);
    const again = interpretReport(r.report, granted);
    expect(again.changed).toBe(false);
    expect(again.report).toBe(r.report);
    const paused = interpretReport(r.report, { ...granted, paused: true });
    expect(paused.changed).toBe(true);
    expect(paused.report.coverageState).toBe('paused');
    expect(paused.report.revision).toBe(2);
    expect(paused.report.findings).toHaveLength(r.report.findings.length);
  });

  it('bounds findings to the per-document cap and counts the overflow', () => {
    const fake = {
      ruleId: 'flood',
      ruleVersion: '1',
      techniqueIds: [],
      evaluate: (): Finding[] =>
        Array.from({ length: BUDGETS.maxFindingsPerDocument + 5 }, (_, i) => ({
          findingId: 'f' + String(i),
          ruleId: 'flood',
          ruleVersion: '1',
          techniqueId: 'DET-001',
          interpretation: 'api-use',
          interpretationConfidence: 'unassessed',
          evidenceIds: [],
          counterEvidenceCodes: [],
          limitationCodes: [],
          vendorMatchIds: [],
        })),
    };
    const out = runRules({ counters: [], coverageFlags: [] }, [fake, fake]);
    expect(out.findings).toHaveLength(BUDGETS.maxFindingsPerDocument);
    expect(out.dropped).toBe(5 + BUDGETS.maxFindingsPerDocument + 5);
  });

  it('the generic api-use rule covers every technique the canvas rule does not own', () => {
    const owned = new Set(RULES.flatMap((r) => r.techniqueIds));
    expect(owned.size).toBe(TECHNIQUE_IDS.length);
    const r = interpretReport(report({ counters: [counter({ techniqueId: 'DET-022', count: 9 }), counter({ techniqueId: 'DET-056', count: 1 })] }), granted).report;
    expect(r.findings.map((f) => [f.techniqueId, f.interpretation, f.ruleId])).toEqual([
      ['DET-022', 'api-use', 'api-use-generic'],
      ['DET-056', 'api-use', 'api-use-generic'],
    ]);
  });
});
