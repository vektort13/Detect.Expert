// Rule webgl-capability-probe v1 (E07-03, S04; DET-011/012). Counter scenarios mirror the fixtures
// (fixtures/webgl-fp-positive.html, webgl-game-negative.html, webgl-engine-info-negative.html) at counter level.

import { describe, expect, it } from 'vitest';
import type { CounterEntry, CoverageFlag, Finding, OperationCode, Phase, TechniqueId } from '@detect-expert/contracts';
import {
  COUNTER_EVIDENCE_CODES,
  LIMITATION_CODES,
  WEBGL_RULE_ID,
  WEBGL_RULE_PARAMS,
  WEBGL_RULE_VERSION,
  capLow,
  evaluateWebgl,
  webglProbeMet,
  webglStats,
} from '../src/index';
import { counter } from './fixtures';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function op(operationCode: OperationCode, count: number, extra: { techniqueId?: TechniqueId; phase?: Phase; countQuality?: CounterEntry['countQuality'] } = {}): CounterEntry {
  const techniqueId = extra.techniqueId ?? (operationCode === 'read-pixels' ? 'DET-012' : 'DET-011');
  return {
    ...counter({ techniqueId, count, ...(extra.phase !== undefined ? { phase: extra.phase } : {}), ...(extra.countQuality !== undefined ? { countQuality: extra.countQuality } : {}) }),
    operationCode,
  };
}

/** Counter-level shape of fixtures/webgl-fp-positive.html (WebGL + WebGL2, values never recorded). */
const POSITIVE: CounterEntry[] = [
  op('supported-extensions', 2),
  op('ext-debug-renderer-info', 2),
  op('param-unmasked-vendor', 2),
  op('param-unmasked-renderer', 2),
  op('param-vendor', 2),
  op('param-renderer', 2),
  op('param-version', 2),
  op('param-shading-language-version', 2),
  op('param-limit', 40),
  op('shader-precision-format', 24),
];

/** fixtures/webgl-engine-info-negative.html: debug info + UNMASKED_RENDERER, 2 precision, a few limits. */
const ENGINE_INFO: CounterEntry[] = [
  op('ext-debug-renderer-info', 1),
  op('param-unmasked-renderer', 1),
  op('shader-precision-format', 2),
  op('param-limit', 3),
];

/** fixtures/webgl-game-negative.html: one extension, MAX_TEXTURE_SIZE, 2 precision, list, VIEWPORT per frame, 12 readPixels. */
const GAME: CounterEntry[] = [
  op('ext-other', 1),
  op('param-limit', 1),
  op('shader-precision-format', 2),
  op('supported-extensions', 1),
  op('param-other', 60),
  op('read-pixels', 12),
];

function run(counters: CounterEntry[], coverageFlags: CoverageFlag[] = []): Finding[] {
  return evaluateWebgl({ counters, coverageFlags, coverageRef: 'cov-active-0000' });
}

const interpretive = (findings: Finding[]): Finding[] => findings.filter((f) => f.interpretation !== 'api-use');
const apiUse = (findings: Finding[]): Finding[] => findings.filter((f) => f.interpretation === 'api-use');

describe('rule webgl-capability-probe v1 (E07-03, DET-011/012)', () => {
  it('declares proposed, uncalibrated parameters with the low ceiling', () => {
    expect(WEBGL_RULE_ID).toBe('webgl-capability-probe');
    expect(WEBGL_RULE_VERSION).toBe('1');
    expect(WEBGL_RULE_PARAMS).toMatchObject({
      calibrated: false,
      minPrecisionFormatCalls: 6,
      repeatedReadbackCounterEvidence: 10,
      possibleConfidence: 'low',
      maxConfidence: 'low',
    });
    expect(Object.isFrozen(WEBGL_RULE_PARAMS)).toBe(true);
  });

  it('positive: the full probe -> possible-fingerprinting / low on DET-011 with probe evidence only', () => {
    const findings = run(POSITIVE);
    expect(apiUse(findings).map((f) => [f.techniqueId, f.ruleId, f.interpretationConfidence])).toEqual([['DET-011', WEBGL_RULE_ID, 'unassessed']]);
    const fp = interpretive(findings);
    expect(fp).toHaveLength(1);
    const f = fp[0]!;
    expect(f).toMatchObject({
      techniqueId: 'DET-011',
      interpretation: 'possible-fingerprinting',
      interpretationConfidence: 'low',
      ruleId: WEBGL_RULE_ID,
      ruleVersion: '1',
      coverageRef: 'cov-active-0000',
      counterEvidenceCodes: [],
      vendorMatchIds: [],
    });
    expect(f.findingId).toBe('webgl-capability-probe-v1-DET-011-possible-fingerprinting');
    expect(f.findingId).toMatch(ID_RE);
    expect(f.limitationCodes).toEqual([
      LIMITATION_CODES.pageControlledEvidence,
      LIMITATION_CODES.purposeUnknown,
      LIMITATION_CODES.uniquenessNotEstablished,
      LIMITATION_CODES.uncalibratedThreshold,
      LIMITATION_CODES.noTimeWindow,
    ]);
    expect(f.evidenceIds).toEqual([
      'DET-011|returned-sync|api-use|ext-debug-renderer-info',
      'DET-011|returned-sync|api-use|param-limit',
      'DET-011|returned-sync|api-use|param-unmasked-renderer',
      'DET-011|returned-sync|api-use|param-unmasked-vendor',
      'DET-011|returned-sync|api-use|shader-precision-format',
      'DET-011|returned-sync|api-use|supported-extensions',
    ]);
    for (const id of [...f.evidenceIds, ...apiUse(findings)[0]!.evidenceIds]) expect(id).toMatch(/^DET-01[12]\|[a-z-]+\|[a-z,-]+(\|[a-z-]+)?$/);
  });

  it('engine-info negative: debug renderer + unmasked renderer + 2 precision + limits -> only api-use (documented boundary)', () => {
    const findings = run(ENGINE_INFO);
    expect(interpretive(findings)).toEqual([]);
    expect(findings.map((f) => [f.techniqueId, f.interpretation])).toEqual([['DET-011', 'api-use']]);
    const stats = webglStats(ENGINE_INFO, []);
    expect(stats).toMatchObject({ identity: true, supportedExtensions: false, limit: true, precisionCalls: 2 });
  });

  it('game negative: api-use for DET-011/012 and repeated-webgl-readback on the readPixels card', () => {
    const findings = run(GAME);
    expect(interpretive(findings)).toEqual([]);
    expect(findings.map((f) => [f.techniqueId, f.interpretation, f.counterEvidenceCodes])).toEqual([
      ['DET-011', 'api-use', []],
      ['DET-012', 'api-use', [COUNTER_EVIDENCE_CODES.repeatedWebglReadback]],
    ]);
  });

  it.each([
    ['identity (unmasked / debug extension)', ['ext-debug-renderer-info', 'param-unmasked-vendor', 'param-unmasked-renderer']],
    ['supported-extensions', ['supported-extensions']],
    ['param-limit', ['param-limit']],
  ] as const)('without %s the probe is not met -> api-use only', (_name, removed) => {
    const counters = POSITIVE.filter((c) => !(removed as readonly string[]).includes(c.operationCode!));
    expect(webglProbeMet(webglStats(counters, []))).toBe(false);
    expect(interpretive(run(counters))).toEqual([]);
  });

  it('precision boundary: 5 successful calls -> api-use, 6 -> possible-fingerprinting', () => {
    const withPrecision = (n: number) => [...POSITIVE.filter((c) => c.operationCode !== 'shader-precision-format'), op('shader-precision-format', n)];
    expect(interpretive(run(withPrecision(5)))).toEqual([]);
    expect(interpretive(run(withPrecision(6)))).toHaveLength(1);
  });

  it('any one identity code suffices: getExtension(debug) alone, or UNMASKED_VENDOR alone', () => {
    const base = POSITIVE.filter((c) => !['ext-debug-renderer-info', 'param-unmasked-vendor', 'param-unmasked-renderer'].includes(c.operationCode!));
    for (const identity of ['ext-debug-renderer-info', 'param-unmasked-vendor', 'param-unmasked-renderer'] as const) {
      expect(interpretive(run([...base, op(identity, 1)])), identity).toHaveLength(1);
    }
  });

  it('only returned-sync calls form the probe: thrown queries and count-0 markers do not count', () => {
    const thrown = POSITIVE.map((c) => (c.operationCode === 'supported-extensions' ? { ...c, phase: 'threw-sync' as const } : c));
    expect(interpretive(run(thrown))).toEqual([]);
    const marker = POSITIVE.map((c) => (c.operationCode === 'param-limit' ? { ...c, count: 0, countQuality: 'lower-bound' as const } : c));
    expect(interpretive(run(marker))).toEqual([]);
    const precisionThrew = [...POSITIVE.filter((c) => c.operationCode !== 'shader-precision-format'), op('shader-precision-format', 5), op('shader-precision-format', 10, { phase: 'threw-sync' })];
    expect(interpretive(run(precisionThrew))).toEqual([]);
  });

  it('counter-evidence: >= 10 readPixels marks the DET-012 api-use and the possible-fingerprinting finding; 9 does not', () => {
    const nine = run([...POSITIVE, op('read-pixels', 9)]);
    expect(nine.flatMap((f) => f.counterEvidenceCodes)).toEqual([]);
    const ten = run([...POSITIVE, op('read-pixels', 7), op('read-pixels', 3, { phase: 'threw-sync' })]);
    const byKind = new Map(ten.map((f) => [f.techniqueId + ' ' + f.interpretation, f]));
    expect(byKind.get('DET-012 api-use')?.counterEvidenceCodes).toEqual(['repeated-webgl-readback']);
    expect(byKind.get('DET-011 possible-fingerprinting')?.counterEvidenceCodes).toEqual(['repeated-webgl-readback']);
    expect(byKind.get('DET-011 possible-fingerprinting')?.interpretationConfidence).toBe('low');
    expect(byKind.get('DET-011 api-use')?.counterEvidenceCodes).toEqual([]);
    // A thrown readPixels is an attempt, not a read.
    expect(byKind.get('DET-012 api-use')?.limitationCodes).toContain(LIMITATION_CODES.readbackAttemptedFailed);
  });

  it.each([
    ['late-start flag', POSITIVE, ['late-start'] as CoverageFlag[]],
    ['budget-exceeded flag', POSITIVE, ['budget-exceeded'] as CoverageFlag[]],
    ['lower-bound counter', POSITIVE.map((c) => (c.operationCode === 'param-limit' ? { ...c, countQuality: 'lower-bound' as const } : c)), [] as CoverageFlag[]],
  ])('degradation (%s) -> coverage-incomplete on every finding; confidence stays low', (_name, counters, flags) => {
    const findings = run(counters, flags);
    expect(findings.length).toBe(2);
    for (const f of findings) expect(f.limitationCodes).toContain(LIMITATION_CODES.coverageIncomplete);
    expect(interpretive(findings)[0]?.interpretationConfidence).toBe('low');
  });

  it('a retirement marker adds hook-retired and coverage-incomplete; *-unclassified adds argument-not-classified', () => {
    const marker: CounterEntry = { ...counter({ techniqueId: 'DET-011', count: 0, signalCodes: ['api-use', 'sample-budget-exceeded'], countQuality: 'lower-bound' }) };
    const [finding] = run([op('param-unclassified', 2), op('param-limit', 4096, { countQuality: 'lower-bound' }), marker]);
    expect(finding?.limitationCodes).toEqual([
      LIMITATION_CODES.pageControlledEvidence,
      LIMITATION_CODES.purposeUnknown,
      LIMITATION_CODES.argumentNotClassified,
      LIMITATION_CODES.hookRetired,
      LIMITATION_CODES.coverageIncomplete,
    ]);
    const clean = run([op('param-other', 2)])[0];
    expect(clean?.limitationCodes).toEqual([LIMITATION_CODES.pageControlledEvidence, LIMITATION_CODES.purposeUnknown]);
  });

  it('confidence is never above low, whatever the volume, flags or ceiling requested', () => {
    const huge = POSITIVE.map((c) => ({ ...c, count: 1_000_000 }));
    for (const [counters, flags] of [
      [POSITIVE, []],
      [huge, []],
      [huge, ['late-start', 'throttled']],
      [[...POSITIVE, op('read-pixels', 500)], []],
    ] as Array<[CounterEntry[], CoverageFlag[]]>) {
      for (const f of run(counters, flags)) expect(['low', 'unassessed']).toContain(f.interpretationConfidence);
    }
    expect(capLow('high')).toBe('low');
    expect(capLow('medium', 'high')).toBe('low');
    expect(capLow('low')).toBe('low');
    expect(capLow('unassessed')).toBe('unassessed');
    expect(capLow('high', 'unassessed')).toBe('unassessed');
  });

  it('ignores other techniques and returns nothing without WebGL counters', () => {
    expect(run([counter({ techniqueId: 'DET-002', count: 3, signalCodes: ['api-use', 'readback-after-text'] })])).toEqual([]);
    expect(run([])).toEqual([]);
  });

  it('evidence ids and finding ids stay inside the contract alphabet; no value-like data appears', () => {
    const findings = run([...POSITIVE, ...GAME]);
    for (const f of findings) {
      expect(f.findingId).toMatch(ID_RE);
      expect(f.findingId.length).toBeLessThanOrEqual(64);
      // Besides technique ids and the coverage reference, no number of 3+ digits (a pname, a count) is carried.
      expect(JSON.stringify(f).replace(/DET-\d{3}/g, '').replace('cov-active-0000', '')).not.toMatch(/\d{3,}/);
    }
  });
});
