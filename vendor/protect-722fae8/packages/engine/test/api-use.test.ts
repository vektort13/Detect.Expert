// Generic api-use rule (spec III §1) with ADR-017 operation codes: evidence ids carry the operation, and a
// '*-unclassified' operation adds the argument-not-classified limitation. Interpretation stays api-use.

import { describe, expect, it } from 'vitest';
import type { CounterEntry, OperationCode, TechniqueId } from '@detect-expert/contracts';
import { API_USE_RULE_ID, COMMON_SURFACE_TECHNIQUE_IDS, ENVIRONMENT_TECHNIQUE_IDS, EXTRA_LIMITATIONS, GEOMETRY_TECHNIQUE_IDS, LIMITATION_CODES, RULES, createGenericApiUseRule, runRules } from '../src/index';
import { counter } from './fixtures';

const rule = createGenericApiUseRule(new Set<TechniqueId>(['DET-001', 'DET-002', 'DET-003', 'DET-004']));

function withOp(techniqueId: TechniqueId, operationCode: OperationCode, count = 1): CounterEntry {
  return { ...counter({ techniqueId, count }), operationCode };
}

describe('generic api-use rule with operation codes (ADR-017)', () => {
  it('evidence ids are counter keys with the operation suffix; plain counters keep the v1 key', () => {
    const [finding] = rule.evaluate({ counters: [withOp('DET-025', 'user-agent'), withOp('DET-025', 'platform'), counter({ techniqueId: 'DET-025', count: 2 })], coverageFlags: [] });
    expect(finding?.techniqueId).toBe('DET-025');
    expect(finding?.evidenceIds).toEqual([
      'DET-025|returned-sync|api-use',
      'DET-025|returned-sync|api-use|platform',
      'DET-025|returned-sync|api-use|user-agent',
    ]);
    expect(finding).toMatchObject({ interpretation: 'api-use', interpretationConfidence: 'unassessed', ruleId: API_USE_RULE_ID });
  });

  it.each([
    ['DET-011', 'param-unclassified'],
    ['DET-011', 'ext-unclassified'],
    ['DET-039', 'state-unclassified'],
  ] as const)('%s + %s adds argument-not-classified', (techniqueId, op) => {
    const [finding] = rule.evaluate({ counters: [withOp(techniqueId, op), withOp(techniqueId, techniqueId === 'DET-011' ? 'param-vendor' : 'query')], coverageFlags: [] });
    expect(finding?.limitationCodes).toEqual([
      LIMITATION_CODES.pageControlledEvidence,
      LIMITATION_CODES.purposeUnknown,
      LIMITATION_CODES.argumentNotClassified,
    ]);
  });

  it('classified, *-other and plain counters do not add the limitation', () => {
    const findings = rule.evaluate({
      counters: [withOp('DET-011', 'param-other'), withOp('DET-039', 'state-other'), withOp('DET-029', 'width'), counter({ techniqueId: 'DET-022', count: 9 })],
      coverageFlags: [],
    });
    expect(findings.map((f) => f.techniqueId)).toEqual(['DET-011', 'DET-022', 'DET-029', 'DET-039']);
    for (const f of findings) expect(f.limitationCodes).toEqual([LIMITATION_CODES.pageControlledEvidence, LIMITATION_CODES.purposeUnknown]);
  });

  it('ADR-017 §5: a retirement marker (sample-budget-exceeded) adds hook-retired and coverage-incomplete, per technique', () => {
    const marker: CounterEntry = {
      ...counter({ techniqueId: 'DET-025', count: 0, signalCodes: ['api-use', 'sample-budget-exceeded'], countQuality: 'lower-bound' }),
      operationCode: 'user-agent',
    };
    const main: CounterEntry = { ...counter({ techniqueId: 'DET-025', count: 4096, countQuality: 'lower-bound' }), operationCode: 'user-agent' };
    const findings = rule.evaluate({ counters: [main, marker, withOp('DET-029', 'width', 3)], coverageFlags: [] });
    const byTechnique = new Map(findings.map((f) => [f.techniqueId, f]));
    expect(byTechnique.get('DET-025')?.limitationCodes).toEqual([
      LIMITATION_CODES.pageControlledEvidence,
      LIMITATION_CODES.purposeUnknown,
      LIMITATION_CODES.hookRetired,
      LIMITATION_CODES.coverageIncomplete,
    ]);
    expect(byTechnique.get('DET-025')?.evidenceIds).toEqual([
      'DET-025|returned-sync|api-use,sample-budget-exceeded|user-agent',
      'DET-025|returned-sync|api-use|user-agent',
    ]);
    expect(byTechnique.get('DET-025')).toMatchObject({ interpretation: 'api-use', interpretationConfidence: 'unassessed' });
    expect(byTechnique.get('DET-029')?.limitationCodes).toEqual([LIMITATION_CODES.pageControlledEvidence, LIMITATION_CODES.purposeUnknown]);
    expect(LIMITATION_CODES.hookRetired).toBe('hook-retired');
  });

  it('hook-retired combines with argument-not-classified without duplicates', () => {
    const marker: CounterEntry = { ...counter({ techniqueId: 'DET-011', count: 0, signalCodes: ['api-use', 'sample-budget-exceeded'], countQuality: 'lower-bound' }), operationCode: 'param-unclassified' };
    const [finding] = rule.evaluate({ counters: [marker, withOp('DET-011', 'param-unclassified', 5)], coverageFlags: [] });
    expect(finding?.limitationCodes).toEqual([
      LIMITATION_CODES.pageControlledEvidence,
      LIMITATION_CODES.purposeUnknown,
      LIMITATION_CODES.argumentNotClassified,
      LIMITATION_CODES.hookRetired,
      LIMITATION_CODES.coverageIncomplete,
    ]);
  });

  it('the limitation is per technique and the code is the documented one', () => {
    expect(LIMITATION_CODES.argumentNotClassified).toBe('argument-not-classified');
    const findings = runRules({ counters: [withOp('DET-011', 'param-unclassified'), withOp('DET-029', 'width')], coverageFlags: [] }, RULES).findings;
    const byTechnique = new Map(findings.map((f) => [f.techniqueId, f.limitationCodes]));
    expect(byTechnique.get('DET-011')).toContain('argument-not-classified');
    expect(byTechnique.get('DET-029')).not.toContain('argument-not-classified');
  });

  it('S06: DET-026 always carries hint-names-not-observed (EXTRA_LIMITATIONS); other environment techniques do not', () => {
    expect(LIMITATION_CODES.hintNamesNotObserved).toBe('hint-names-not-observed');
    expect(EXTRA_LIMITATIONS).toEqual({ 'DET-026': ['hint-names-not-observed'] });
    const findings = runRules({
      counters: [
        { ...counter({ techniqueId: 'DET-026', count: 1, phase: 'settlement-unobserved' }), operationCode: 'get-high-entropy-values' },
        withOp('DET-026', 'ua-brands', 3),
        withOp('DET-025', 'user-agent'),
        withOp('DET-029', 'width'),
        counter({ techniqueId: 'DET-032', count: 1 }),
        counter({ techniqueId: 'DET-033', count: 1 }),
        withOp('DET-005', 'offset-width', 9),
      ],
      coverageFlags: [],
    }, RULES).findings;
    const byTechnique = new Map(findings.map((f) => [f.techniqueId, f]));
    expect([...byTechnique.keys()].sort()).toEqual(['DET-005', 'DET-025', 'DET-026', 'DET-029', 'DET-032', 'DET-033']);
    expect(byTechnique.get('DET-026')?.limitationCodes).toEqual([
      LIMITATION_CODES.pageControlledEvidence,
      LIMITATION_CODES.purposeUnknown,
      LIMITATION_CODES.hintNamesNotObserved,
    ]);
    for (const id of ['DET-005', 'DET-025', 'DET-029', 'DET-032', 'DET-033'] as const) {
      expect(byTechnique.get(id)?.limitationCodes, id).toEqual([LIMITATION_CODES.pageControlledEvidence, LIMITATION_CODES.purposeUnknown]);
    }
    // No cross-surface heuristic: every environment/geometry finding is generic api-use, unassessed.
    for (const f of findings) expect(f).toMatchObject({ ruleId: API_USE_RULE_ID, interpretation: 'api-use', interpretationConfidence: 'unassessed' });
  });

  it('S06: DET-026 with a retirement marker keeps hint-names-not-observed before hook-retired, without duplicates', () => {
    const marker: CounterEntry = {
      ...counter({ techniqueId: 'DET-026', phase: 'settlement-unobserved', count: 0, signalCodes: ['api-use', 'sample-budget-exceeded'], countQuality: 'lower-bound' }),
      operationCode: 'get-high-entropy-values',
    };
    const [finding] = rule.evaluate({ counters: [marker, withOp('DET-026', 'get-high-entropy-values', 4096)], coverageFlags: [] });
    expect(finding?.limitationCodes).toEqual([
      LIMITATION_CODES.pageControlledEvidence,
      LIMITATION_CODES.purposeUnknown,
      LIMITATION_CODES.hintNamesNotObserved,
      LIMITATION_CODES.hookRetired,
      LIMITATION_CODES.coverageIncomplete,
    ]);
  });

  it('S06: technique id lists of the environment and geometry families and of the common surfaces', () => {
    expect(ENVIRONMENT_TECHNIQUE_IDS).toEqual(['DET-025', 'DET-026', 'DET-029', 'DET-032', 'DET-033']);
    expect(GEOMETRY_TECHNIQUE_IDS).toEqual(['DET-005']);
    expect(COMMON_SURFACE_TECHNIQUE_IDS).toEqual(['DET-005', 'DET-025', 'DET-029', 'DET-032', 'DET-033']);
    // No specialized rule claims them: the generic api-use rule owns every one.
    const generic = RULES[RULES.length - 1]!;
    expect(generic.ruleId).toBe(API_USE_RULE_ID);
    for (const id of [...ENVIRONMENT_TECHNIQUE_IDS, ...GEOMETRY_TECHNIQUE_IDS]) expect(generic.techniqueIds, id).toContain(id);
  });
});
