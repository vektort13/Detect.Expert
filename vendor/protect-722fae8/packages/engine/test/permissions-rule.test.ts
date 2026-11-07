// Rule permissions-breadth v1 (E08-03, S05; DET-039). Counter scenarios mirror the fixtures
// (fixtures/permissions-fp-positive.html, permissions-app-negative.html) at counter level.

import { describe, expect, it } from 'vitest';
import type { CounterEntry, CoverageFlag, OperationCode, Phase } from '@detect-expert/contracts';
import {
  LIMITATION_CODES,
  PERMISSION_CATEGORY_OPERATIONS,
  PERMISSIONS_RULE_ID,
  PERMISSIONS_RULE_PARAMS,
  PERMISSIONS_RULE_VERSION,
  evaluatePermissions,
  permissionStats,
  permissionsBreadthMet,
  runRules,
} from '../src/index';
import { counter } from './fixtures';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function op(operationCode: OperationCode, count: number, extra: { phase?: Phase; countQuality?: CounterEntry['countQuality'] } = {}): CounterEntry {
  const phase: Phase = extra.phase ?? (operationCode === 'query' ? 'settlement-unobserved' : 'returned-sync');
  return { ...counter({ techniqueId: 'DET-039', count, phase, ...(extra.countQuality !== undefined ? { countQuality: extra.countQuality } : {}) }), operationCode };
}

/** fixtures/permissions-fp-positive.html: 14 names, 8 categories (counts depend on support; shape only). */
const POSITIVE: CounterEntry[] = [
  op('query', 14),
  op('state-location', 1),
  op('state-notifications', 1),
  op('state-media', 2),
  op('state-sensors', 3),
  op('state-midi', 1),
  op('state-clipboard', 2),
  op('state-storage', 3),
  op('state-other', 1),
];

/** fixtures/permissions-app-negative.html: camera, microphone, notifications. */
const APP: CounterEntry[] = [op('query', 3), op('state-media', 2), op('state-notifications', 1)];

function categoriesOf(list: readonly CounterEntry[]): number {
  return permissionStats(list, []).categories.length;
}

describe('permissions-breadth v1', () => {
  it('parameters are proposed, not calibrated, with a low ceiling', () => {
    expect(PERMISSIONS_RULE_ID).toBe('permissions-breadth');
    expect(PERMISSIONS_RULE_VERSION).toBe('1');
    expect(PERMISSIONS_RULE_PARAMS).toEqual({ ruleVersion: '1', calibrated: false, minDistinctCategories: 5, possibleConfidence: 'low', maxConfidence: 'low' });
    expect(PERMISSION_CATEGORY_OPERATIONS).toHaveLength(8);
  });

  it('positive: api-use plus possible-fingerprinting/low; every DET-039 finding carries permission-name-from-status', () => {
    const findings = evaluatePermissions({ counters: POSITIVE, coverageFlags: [], coverageRef: 'cov-2' });
    expect(findings.map((f) => f.findingId)).toEqual(['permissions-breadth-v1-DET-039-api-use', 'permissions-breadth-v1-DET-039-possible-fingerprinting']);
    for (const f of findings) {
      expect(f.findingId).toMatch(ID_RE);
      expect(f.techniqueId).toBe('DET-039');
      expect(f.coverageRef).toBe('cov-2');
      expect(f.limitationCodes).toContain(LIMITATION_CODES.permissionNameFromStatus);
    }
    const [apiUse, fp] = findings;
    expect(apiUse!.interpretationConfidence).toBe('unassessed');
    expect(apiUse!.limitationCodes).toEqual([LIMITATION_CODES.pageControlledEvidence, LIMITATION_CODES.purposeUnknown, LIMITATION_CODES.permissionNameFromStatus]);
    expect(fp!.interpretationConfidence).toBe('low');
    expect(fp!.limitationCodes).toEqual([
      LIMITATION_CODES.pageControlledEvidence,
      LIMITATION_CODES.purposeUnknown,
      LIMITATION_CODES.uniquenessNotEstablished,
      LIMITATION_CODES.uncalibratedThreshold,
      LIMITATION_CODES.noTimeWindow,
      LIMITATION_CODES.permissionNameFromStatus,
    ]);
    // Evidence: the categorized state reads only (not the query counter).
    expect(fp!.evidenceIds).toHaveLength(8);
    expect(fp!.evidenceIds.every((id) => id.includes('|state-'))).toBe(true);
  });

  it('app negative (media + notifications) stays api-use', () => {
    const findings = evaluatePermissions({ counters: APP, coverageFlags: [] });
    expect(findings.map((f) => f.interpretation)).toEqual(['api-use']);
  });

  it('boundary: 4 distinct categories -> api-use, 5 -> possible; repeated reads of one category count once', () => {
    const four = [op('state-location', 5), op('state-media', 9), op('state-midi', 1), op('state-clipboard', 1)];
    expect(categoriesOf(four)).toBe(4);
    expect(permissionsBreadthMet(permissionStats(four, []))).toBe(false);
    const five = [...four, op('state-storage', 1)];
    expect(permissionsBreadthMet(permissionStats(five, []))).toBe(true);
    expect(evaluatePermissions({ counters: five, coverageFlags: [] }).map((f) => f.interpretation)).toEqual(['api-use', 'possible-fingerprinting']);
  });

  it("'other' counts as one category; unclassified, threw-sync and count-0 reads do not count", () => {
    expect(categoriesOf([op('state-other', 7)])).toBe(1);
    const four = [op('state-location', 1), op('state-media', 1), op('state-midi', 1), op('state-other', 3)];
    expect(categoriesOf([...four, op('state-unclassified', 20)])).toBe(4);
    expect(categoriesOf([...four, op('state-storage', 1, { phase: 'threw-sync' })])).toBe(4);
    expect(categoriesOf([...four, op('state-storage', 0)])).toBe(4);
    expect(categoriesOf([...four, op('query', 50)])).toBe(4);
    // A threw-sync state read without an operation is still an observation (api-use).
    const threw = { ...counter({ techniqueId: 'DET-039', count: 2, phase: 'threw-sync' }) };
    expect(evaluatePermissions({ counters: [threw], coverageFlags: [] }).map((f) => f.interpretation)).toEqual(['api-use']);
  });

  it('late start: all reads unclassified -> api-use with coverage-incomplete', () => {
    const late = [op('query', 14), op('state-unclassified', 14)];
    const findings = evaluatePermissions({ counters: late, coverageFlags: ['late-start', 'hook-failed'] as CoverageFlag[] });
    expect(findings.map((f) => f.interpretation)).toEqual(['api-use']);
    expect(findings[0]!.limitationCodes).toContain(LIMITATION_CODES.coverageIncomplete);
    expect(findings[0]!.limitationCodes).toContain(LIMITATION_CODES.permissionNameFromStatus);
  });

  it('degraded positive keeps the ceiling at low', () => {
    const findings = evaluatePermissions({ counters: POSITIVE, coverageFlags: ['budget-exceeded'] });
    expect(findings[1]!.interpretationConfidence).toBe('low');
    expect(findings[1]!.limitationCodes).toContain(LIMITATION_CODES.coverageIncomplete);
  });

  it('ignores other techniques; registered in runRules as the only DET-039 owner', () => {
    expect(evaluatePermissions({ counters: [counter({ techniqueId: 'DET-015', count: 1 })], coverageFlags: [] })).toEqual([]);
    const { findings } = runRules({ counters: [...POSITIVE, counter({ techniqueId: 'DET-032', count: 1 })], coverageFlags: [] });
    expect(findings.filter((f) => f.techniqueId === 'DET-039').map((f) => f.ruleId)).toEqual([PERMISSIONS_RULE_ID, PERMISSIONS_RULE_ID]);
    expect(JSON.stringify(findings)).not.toMatch(/granted|denied|prompt|geolocation|camera/);
  });
});
