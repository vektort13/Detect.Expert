// Rule registry invariants (S04): every technique is owned by exactly one rule, so no technique gets two api-use
// findings or none; findings of a technique come only from its owning rule.

import { describe, expect, it } from 'vitest';
import { TECHNIQUE_IDS, type TechniqueId } from '@detect-expert/contracts';
import { API_USE_RULE_ID, CANVAS_RULE_ID, RULES, WEBGL_RULE_ID, runRules } from '../src/index';
import { AUDIO_RULE_ID, PERMISSIONS_RULE_ID, audioRule, permissionsRule } from '../src/index';
import { NETWORK_RULE_ID, NETWORK_TECHNIQUE_IDS, networkRule } from '../src/index';
import { counter } from './fixtures';
import { networkCounter } from './fixtures';

function owners(id: TechniqueId): string[] {
  return RULES.filter((r) => r.techniqueIds.includes(id)).map((r) => r.ruleId);
}

describe('rule registry', () => {
  it('each technique is pinned to exactly one rule', () => {
    const multiple = TECHNIQUE_IDS.filter((id) => owners(id).length !== 1).map((id) => id + ':' + owners(id).join('+'));
    expect(multiple).toEqual([]);
    // The generic api-use rule covers exactly the techniques no specialized rule owns.
    const generic = RULES.find((r) => r.ruleId === API_USE_RULE_ID)!;
    const specialized = new Set(RULES.filter((r) => r !== generic).flatMap((r) => [...r.techniqueIds]));
    expect([...generic.techniqueIds].sort()).toEqual(TECHNIQUE_IDS.filter((id) => !specialized.has(id)).sort());
  });

  it('rule ids are unique and the family owners are the expected ones', () => {
    const ids = RULES.map((r) => r.ruleId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(owners('DET-002')).toEqual([CANVAS_RULE_ID]);
    expect(owners('DET-011')).toEqual([WEBGL_RULE_ID]);
    expect(owners('DET-012')).toEqual([WEBGL_RULE_ID]);
    expect(owners('DET-015')).toEqual([AUDIO_RULE_ID]);
    expect(owners('DET-016')).toEqual([AUDIO_RULE_ID]);
    expect(owners('DET-039')).toEqual([PERMISSIONS_RULE_ID]);
    expect(owners('DET-025')).toEqual([API_USE_RULE_ID]);
    expect(RULES[RULES.length - 1]!.ruleId).toBe(API_USE_RULE_ID);
  });

  it.each(TECHNIQUE_IDS.map((id) => [id]))('%s: findings for a lone counter come only from the owning rule', (id) => {
    const owner = owners(id)[0];
    const { findings } = runRules({ counters: [counter({ techniqueId: id, count: 2 })], coverageFlags: [] });
    for (const f of findings) {
      expect(f.techniqueId).toBe(id);
      expect(f.ruleId).toBe(owner);
    }
    expect(findings.filter((f) => f.interpretation === 'api-use').length).toBeLessThanOrEqual(1);
  });
});

// S07 / ADR-018: 'network-observed' v1 owns DET-058…061 and reads only the SW network input.
describe('rule registry: network-observed (S07)', () => {
  it('is registered once and owns exactly DET-058…061', () => {
    expect(RULES.filter((r) => r.ruleId === NETWORK_RULE_ID)).toEqual([networkRule]);
    expect(networkRule.ruleVersion).toBe('1');
    for (const id of NETWORK_TECHNIQUE_IDS) expect(owners(id)).toEqual([NETWORK_RULE_ID]);
  });

  it('page-hook counters of DET-058…061 yield no finding; the SW network counters do', () => {
    const page = NETWORK_TECHNIQUE_IDS.map((t) => counter({ techniqueId: t, count: 5, phase: 'attempted' }));
    expect(runRules({ counters: page, coverageFlags: [] }).findings).toEqual([]);
    const network = { counters: [networkCounter('DET-059', 2)], patterns: { localPortsMax: 0, localTargetsMax: 0, randomSubdomainsMax: 0 } };
    expect(runRules({ counters: page, coverageFlags: [], network }).findings.map((f) => f.findingId)).toEqual(['network-observed-v1-DET-059-api-use']);
  });
});

// S05: audio-offline-graph v1 owns DET-015/016, permissions-breadth v1 owns DET-039.
describe('rule registry: audio and permissions (S05)', () => {
  it('both rules are registered once, before the generic rule, with version 1', () => {
    expect(RULES.filter((r) => r.ruleId === AUDIO_RULE_ID)).toEqual([audioRule]);
    expect(RULES.filter((r) => r.ruleId === PERMISSIONS_RULE_ID)).toEqual([permissionsRule]);
    expect([audioRule.ruleVersion, permissionsRule.ruleVersion]).toEqual(['1', '1']);
    expect([...audioRule.techniqueIds]).toEqual(['DET-015', 'DET-016']);
    expect([...permissionsRule.techniqueIds]).toEqual(['DET-039']);
    const generic = RULES.findIndex((r) => r.ruleId === API_USE_RULE_ID);
    expect(RULES.indexOf(audioRule)).toBeLessThan(generic);
    expect(RULES.indexOf(permissionsRule)).toBeLessThan(generic);
  });

  it('lone DET-015 / DET-016 / DET-039 counters get exactly one api-use finding from their own rule', () => {
    for (const [id, rule] of [['DET-015', AUDIO_RULE_ID], ['DET-016', AUDIO_RULE_ID], ['DET-039', PERMISSIONS_RULE_ID]] as const) {
      const { findings } = runRules({ counters: [counter({ techniqueId: id, count: 1 })], coverageFlags: [] });
      expect(findings.map((f) => [f.techniqueId, f.ruleId, f.interpretation])).toEqual([[id, rule, 'api-use']]);
    }
  });
});
