import { describe, expect, it } from 'vitest';
import type { CounterEntry, Finding } from '@detect-expert/contracts';
import {
  CANVAS_RULE_ID,
  CANVAS_RULE_VERSION,
  COUNTER_EVIDENCE_CODES,
  LIMITATION_CODES,
  RULE_PARAMS,
  canvasStats,
  evaluateCanvas,
} from '../src/index';
import { CHART, EDITOR, FP_POSITIVE, PIXELS_NO_TEXT, SINGLE_READBACK, TAINTED_ONLY, counter } from './fixtures';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function run(counters: CounterEntry[], coverageFlags: Parameters<typeof evaluateCanvas>[0]['coverageFlags'] = []): Finding[] {
  return evaluateCanvas({ counters, coverageFlags, coverageRef: 'cov-active-0000' });
}

function interpretive(findings: Finding[]): Finding[] {
  return findings.filter((f) => f.interpretation !== 'api-use');
}

function apiUse(findings: Finding[]): Finding[] {
  return findings.filter((f) => f.interpretation === 'api-use');
}

describe('rule canvas-readback-after-text v2 (E07-01, DET-001..004)', () => {
  it.each([{ signals: ['api-use'] }, { signals: ['api-use', 'text-measured'] }] as const)('P04: $signals without drawing evidence never promotes repeated readouts', ({ signals }) => {
    const counters = [
      counter({ techniqueId: 'DET-003', count: 500, signalCodes: [...signals] }),
      counter({ techniqueId: 'DET-002', count: 2, signalCodes: ['api-use', 'readback-after-text'] }),
    ];
    expect(canvasStats(counters, []).textOps).toBe(0);
    expect(interpretive(run(counters))).toEqual([]);
  });

  it('P04: measurements cannot dilute drawing evidence or count as drawing; failed draws cannot arm the rule', () => {
    const measured = counter({ techniqueId: 'DET-003', count: 500, signalCodes: ['api-use', 'text-measured'] });
    const counters = [...FP_POSITIVE, measured];
    expect(canvasStats(counters, []).textOps).toBe(6);
    const fp = interpretive(run(counters))[0];
    expect(fp?.evidenceIds).toContain('DET-003|returned-sync|api-use,text-drawn');
    expect(fp?.evidenceIds).not.toContain('DET-003|returned-sync|api-use,text-measured');
    expect(fp?.interpretationConfidence).toBe('low');
    expect(interpretive(run(counters.map((c) => c.signalCodes.includes('text-drawn') ? { ...c, phase: 'threw-sync' } : c)))).toEqual([]);
  });

  it('declares proposed, uncalibrated parameters and enforces the ADR-001 low confidence ceiling', () => {
    expect(RULE_PARAMS.calibrated).toBe(false);
    expect(RULE_PARAMS.maxConfidence).toBe('low');
    expect(RULE_PARAMS.patternConfidence).toBe('low');
    expect(RULE_PARAMS.possibleConfidence).toBe('low');
  });

  it('fp-positive: 2 readbacks after text with few draws -> possible-fingerprinting / low', () => {
    const findings = run(FP_POSITIVE);
    expect(apiUse(findings).map((f) => f.techniqueId)).toEqual(['DET-002', 'DET-003']);
    const fp = interpretive(findings);
    expect(fp).toHaveLength(1);
    const f = fp[0];
    expect(f?.interpretation).toBe('possible-fingerprinting');
    expect(f?.interpretationConfidence).toBe('low');
    expect(f?.techniqueId).toBe('DET-002');
    expect(f?.ruleId).toBe(CANVAS_RULE_ID);
    expect(f?.ruleVersion).toBe(CANVAS_RULE_VERSION);
    expect(f?.counterEvidenceCodes).toEqual([]);
    expect(f?.vendorMatchIds).toEqual([]);
    expect(f?.coverageRef).toBe('cov-active-0000');
    expect(f?.limitationCodes).toEqual(
      expect.arrayContaining([
        LIMITATION_CODES.pageControlledEvidence,
        LIMITATION_CODES.purposeUnknown,
        LIMITATION_CODES.uniquenessNotEstablished,
        LIMITATION_CODES.uncalibratedThreshold,
        LIMITATION_CODES.noTimeWindow,
      ]),
    );
    expect(f?.limitationCodes).not.toContain(LIMITATION_CODES.readbackAttemptedFailed);
    // evidence ids are counter keys (enum-only), never page data
    expect(f?.evidenceIds).toEqual(['DET-002|returned-sync|api-use,readback-after-text', 'DET-003|returned-sync|api-use,text-drawn']);
  });

  it.each([
    ['single readback', SINGLE_READBACK, 'DET-002|returned-sync|api-use,readback-after-text'],
    ['editor export', EDITOR, 'DET-001|attempted|api-use,export-after-text'],
  ])('%s remains api-use with its observed signal retained (F043)', (_name, counters, evidenceId) => {
    const findings = run(counters);
    expect(findings).toHaveLength(2);
    expect(interpretive(findings)).toEqual([]);
    expect(findings.every((f) => f.interpretationConfidence === 'unassessed')).toBe(true);
    expect(findings.flatMap((f) => f.evidenceIds)).toContain(evidenceId);
    expect(findings.flatMap((f) => f.counterEvidenceCodes)).toEqual([]);
  });

  it('chart with text metrics only -> api-use only', () => {
    const findings = run(CHART);
    expect(findings.map((f) => [f.techniqueId, f.interpretation])).toEqual([['DET-003', 'api-use']]);
    expect(findings[0]?.interpretationConfidence).toBe('unassessed');
    expect(findings[0]?.limitationCodes).toEqual([LIMITATION_CODES.pageControlledEvidence, LIMITATION_CODES.purposeUnknown]);
  });

  it('tainted canvas only -> api-use with readback-attempted-failed, no fingerprinting hypothesis', () => {
    const findings = run(TAINTED_ONLY);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.interpretation).toBe('api-use');
    expect(findings[0]?.techniqueId).toBe('DET-002');
    expect(findings[0]?.limitationCodes).toContain(LIMITATION_CODES.readbackAttemptedFailed);
    const stats = canvasStats(TAINTED_ONLY, []);
    expect(stats.readouts).toBe(0);
    expect(stats.failedAttempts).toBe(3);
  });

  it('pixel reads without any text are api-use only (no readback-after-text signal)', () => {
    const findings = run(PIXELS_NO_TEXT);
    expect(interpretive(findings)).toEqual([]);
    expect(apiUse(findings).map((f) => f.techniqueId)).toEqual(['DET-001', 'DET-002']);
  });

  it('a failed attempt next to real readbacks is a limitation on the hypothesis', () => {
    const findings = run([...FP_POSITIVE, ...TAINTED_ONLY]);
    const fp = interpretive(findings)[0];
    expect(fp?.limitationCodes).toContain(LIMITATION_CODES.readbackAttemptedFailed);
    expect(fp?.interpretation).toBe('possible-fingerprinting');
  });

  it('degraded coverage or sampled counters cap the confidence to low (spec III §3.3 rule 5)', () => {
    const late = interpretive(run(FP_POSITIVE, ['late-start']))[0];
    expect(late?.interpretation).toBe('possible-fingerprinting');
    expect(late?.interpretationConfidence).toBe('low');
    expect(late?.limitationCodes).toContain(LIMITATION_CODES.coverageIncomplete);

    const sampled = FP_POSITIVE.map((c) => ({ ...c, countQuality: 'sampled' as const }));
    expect(interpretive(run(sampled))[0]?.interpretationConfidence).toBe('low');

    const replaced = [FP_POSITIVE[0] as CounterEntry, { ...(FP_POSITIVE[1] as CounterEntry), signalCodes: ['api-use', 'hook-replaced', 'readback-after-text'] as CounterEntry['signalCodes'] }];
    expect(interpretive(run(replaced))[0]?.interpretationConfidence).toBe('low');
  });

  it('legacy ratio boundary R=2,T=16 cannot enable a stronger tier (F041/F042)', () => {
    const at = [counter({ techniqueId: 'DET-003', signalCodes: ['api-use', 'text-drawn'], count: RULE_PARAMS.maxTextOpsPerReadout * 2 }), counter({ techniqueId: 'DET-002', count: 2, signalCodes: ['api-use', 'readback-after-text'] })];
    expect(interpretive(run(at))[0]).toMatchObject({ interpretation: 'possible-fingerprinting', interpretationConfidence: 'low' });
    const above = [counter({ techniqueId: 'DET-003', signalCodes: ['api-use', 'text-drawn'], count: RULE_PARAMS.maxTextOpsPerReadout * 2 + 1 }), counter({ techniqueId: 'DET-002', count: 2, signalCodes: ['api-use', 'readback-after-text'] })];
    expect(interpretive(run(above))[0]).toMatchObject({ interpretation: 'possible-fingerprinting', interpretationConfidence: 'low' });
  });

  it('synchronous OffscreenCanvas readouts count as readouts', () => {
    const offscreen = [counter({ techniqueId: 'DET-003', signalCodes: ['api-use', 'text-drawn'], count: 4 }), counter({ techniqueId: 'DET-004', count: 2, phase: 'returned-sync', signalCodes: ['api-use', 'readback-after-text'] })];
    const fp = interpretive(run(offscreen))[0];
    expect(fp?.interpretation).toBe('possible-fingerprinting');
    expect(fp?.techniqueId).toBe('DET-004');
  });

  it.each(['attempted', 'async-returned', 'settlement-unobserved'] as const)('P04: %s exports cannot establish successful readback hypotheses', (phase) => {
    const counters = [FP_POSITIVE[0]!, counter({ techniqueId: 'DET-004', count: 20, phase, signalCodes: ['api-use', 'readback-after-text'] })];
    expect(canvasStats(counters, []).readouts).toBe(0);
    expect(interpretive(run(counters))).toEqual([]);
    expect(apiUse(run(counters))).toHaveLength(2);
  });

  it('never produces a stronger tier or confidence over a grid of readout/text-op combinations', () => {
    const seen = new Set<string>();
    for (const r of [1, 2, 3, 10, 50, 1000]) {
      for (const t of [0, 1, 8, 16, 17, 100, 200, 201, 5000]) {
        const counters = [counter({ techniqueId: 'DET-003', signalCodes: ['api-use', 'text-drawn'], count: t }), counter({ techniqueId: 'DET-002', count: r, signalCodes: ['api-use', 'readback-after-text'] })];
        for (const f of run(counters)) {
          expect(['low', 'unassessed']).toContain(f.interpretationConfidence);
          expect(['api-use', 'possible-fingerprinting']).toContain(f.interpretation);
          seen.add(f.interpretationConfidence);
          expect(f.findingId).toMatch(ID_RE);
        }
      }
    }
    expect([...seen].sort()).toEqual(['low', 'unassessed']);
  });

  it('is deterministic and yields nothing for non-canvas counters', () => {
    expect(run(FP_POSITIVE)).toEqual(run(FP_POSITIVE));
    expect(run([counter({ techniqueId: 'DET-011', count: 3 })])).toEqual([]);
  });

  it('discloses lifetime aggregation for widely separated activity without inventing window counts (F122)', () => {
    const separated = [
      counter({ techniqueId: 'DET-003', signalCodes: ['api-use', 'text-drawn'], count: 10, firstBucket: 1, lastBucket: 7201 }),
      counter({ techniqueId: 'DET-002', count: 2, firstBucket: 2, lastBucket: 7202, signalCodes: ['api-use', 'readback-after-text'] }),
    ];
    expect(canvasStats(separated, []).readouts).toBe(2);
    const fp = interpretive(run(separated));
    expect(fp).toHaveLength(1);
    expect(fp[0]).toMatchObject({ interpretation: 'possible-fingerprinting', interpretationConfidence: 'low' });
    expect(fp[0]?.limitationCodes).toContain(LIMITATION_CODES.noTimeWindow);
    expect(fp[0]?.counterEvidenceCodes).toEqual([]);
  });

  it.each([200, 201, 401, 5000])('DET-003 volume %i cannot establish rendering counter-evidence (F122)', (textOps) => {
    // Even explicitly observed drawing volume does not establish ordinary rendering.
    const counters = [
      counter({ techniqueId: 'DET-003', signalCodes: ['api-use', 'text-drawn'], count: textOps }),
      counter({ techniqueId: 'DET-002', count: 2, signalCodes: ['api-use', 'readback-after-text'] }),
    ];
    const fp = interpretive(run(counters));
    expect(fp).toHaveLength(1);
    expect(fp[0]).toMatchObject({ interpretation: 'possible-fingerprinting', interpretationConfidence: 'low' });
    expect(fp[0]?.counterEvidenceCodes).toEqual([]);
    expect(fp[0]?.counterEvidenceCodes).not.toContain(COUNTER_EVIDENCE_CODES.highVolumeRendering);
    expect(fp[0]?.limitationCodes).not.toContain(LIMITATION_CODES.textOpsUndifferentiated);
  });

  it.each(['DET-001', 'DET-002', 'DET-004'] as const)('one %s readout remains api-use regardless of text volume (F043)', (techniqueId) => {
    for (const textOps of [1, 16, 200, 300]) {
      const counters = [
        counter({ techniqueId: 'DET-003', signalCodes: ['api-use', 'text-drawn'], count: textOps }),
        counter({ techniqueId, count: 1, signalCodes: ['api-use', 'export-after-text'] }),
      ];
      expect(interpretive(run(counters))).toEqual([]);
      expect(run(counters).find((f) => f.techniqueId === techniqueId)?.evidenceIds).toContain(
        techniqueId + '|returned-sync|api-use,export-after-text',
      );
    }
  });
});
