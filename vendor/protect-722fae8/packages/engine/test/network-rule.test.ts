// S07 / ADR-018: rule 'network-observed' v1 (E10-01/02/03). Thresholds are PROPOSED (calibrated:false); the tests
// pin the documented boundaries (3/4 ports, 7/8 targets, 7/8 subdomains), the low ceiling and the input isolation.

import { BUDGETS, EMPTY_NETWORK_PATTERNS, type CoverageFlag, type NetworkPatterns } from '@detect-expert/contracts';
import { describe, expect, it } from 'vitest';
import {
  LIMITATION_CODES,
  NETWORK_RULE_PARAMS,
  NETWORK_WINDOW_MATCHES_BUDGET,
  evaluateNetwork,
  looksRandomLabel,
  networkPatternMet,
  runRules,
  type RuleInput,
} from '../src/index';
import { counter, networkCounter } from './fixtures';

function input(over: { counters?: RuleInput['counters']; patterns?: Partial<NetworkPatterns>; flags?: CoverageFlag[]; networkCounters?: RuleInput['counters'] } = {}): RuleInput {
  return {
    counters: over.counters ?? [],
    coverageFlags: over.flags ?? [],
    network: { counters: over.networkCounters ?? [], patterns: { ...EMPTY_NETWORK_PATTERNS, ...over.patterns } },
  };
}

describe('network-observed v1 parameters', () => {
  it('are proposed, capped at low and use the contract window', () => {
    expect(NETWORK_RULE_PARAMS.calibrated).toBe(false);
    expect(NETWORK_RULE_PARAMS.ruleVersion).toBe('1');
    expect(NETWORK_RULE_PARAMS.patternConfidence).toBe('low');
    expect(NETWORK_RULE_PARAMS.maxConfidence).toBe('low');
    expect(NETWORK_RULE_PARAMS.windowMs).toBe(BUDGETS.networkWindowMs);
    expect(NETWORK_WINDOW_MATCHES_BUDGET).toBe(true);
  });
});

describe('api-use findings per browser-network technique', () => {
  it('DET-058/059/060 with count > 0 are api-use/unassessed with their limitations; DET-061 alone gives none', () => {
    const findings = evaluateNetwork(input({ networkCounters: [networkCounter('DET-058', 1), networkCounter('DET-059', 5), networkCounter('DET-060', 2), networkCounter('DET-061', 3)] }));
    expect(findings.map((f) => [f.techniqueId, f.interpretation, f.interpretationConfidence])).toEqual([
      ['DET-058', 'api-use', 'unassessed'],
      ['DET-059', 'api-use', 'unassessed'],
      ['DET-060', 'api-use', 'unassessed'],
    ]);
    expect(findings[0]?.limitationCodes).toEqual(['handshake-only', 'purpose-unknown']);
    expect(findings[1]?.limitationCodes).toEqual(['no-causal-link', 'purpose-unknown']);
    expect(findings[2]?.limitationCodes).toEqual(['outcome-not-observed', 'purpose-unknown']);
    expect(findings[0]?.findingId).toBe('network-observed-v1-DET-058-api-use');
    expect(findings[1]?.evidenceIds).toEqual(['DET-059|attempted|api-use']);
    for (const f of findings) {
      expect(f.ruleId).toBe('network-observed');
      expect(f.ruleVersion).toBe('1');
      expect(f.counterEvidenceCodes).toEqual([]);
      expect(f.vendorMatchIds).toEqual([]);
    }
  });

  it('zero counts, foreign shapes and missing network input give nothing', () => {
    expect(evaluateNetwork({ counters: [], coverageFlags: [] })).toEqual([]);
    expect(evaluateNetwork(input({ networkCounters: [networkCounter('DET-059', 0)] }))).toEqual([]);
    expect(evaluateNetwork(input({ networkCounters: [networkCounter('DET-059', 3, { phase: 'returned-sync' })] }))).toEqual([]);
    expect(evaluateNetwork(input({ networkCounters: [networkCounter('DET-059', 3, { signalCodes: ['api-use', 'local-multi-port'] })] }))).toEqual([]);
    expect(evaluateNetwork(input({ networkCounters: [networkCounter('DET-001', 3)] }))).toEqual([]);
  });

  it('network-limited adds network-scope-limited; late-start/truncated/budget-exceeded/paused add coverage-incomplete', () => {
    const limited = evaluateNetwork(input({ networkCounters: [networkCounter('DET-059', 1)], flags: ['network-limited'] }));
    expect(limited[0]?.limitationCodes).toEqual(['no-causal-link', 'purpose-unknown', 'network-scope-limited']);
    // CW-05: a pause (current or historical after resume) leaves requests uncounted.
    for (const flag of ['late-start', 'truncated', 'budget-exceeded', 'paused'] as const) {
      const f = evaluateNetwork(input({ networkCounters: [networkCounter('DET-058', 1)], flags: ['network-limited', flag] }));
      expect(f[0]?.limitationCodes).toEqual(['handshake-only', 'purpose-unknown', 'network-scope-limited', 'coverage-incomplete']);
    }
    const unrelated = evaluateNetwork(input({ networkCounters: [networkCounter('DET-058', 1)], flags: ['worker-not-observed'] }));
    expect(unrelated[0]?.limitationCodes).toEqual(['handshake-only', 'purpose-unknown']);
  });
});

describe('DET-060 local-probe-pattern (uncalibrated)', () => {
  const local = [networkCounter('DET-060', 9)];
  it('ports 3 -> no pattern, 4 -> pattern; targets 7 -> no pattern, 8 -> pattern', () => {
    const interp = (patterns: Partial<NetworkPatterns>) => evaluateNetwork(input({ networkCounters: local, patterns })).map((f) => f.interpretation);
    expect(interp({ localPortsMax: 3 })).toEqual(['api-use']);
    expect(interp({ localPortsMax: 4 })).toEqual(['api-use', 'local-probe-pattern']);
    expect(interp({ localTargetsMax: 7 })).toEqual(['api-use']);
    expect(interp({ localTargetsMax: 8 })).toEqual(['api-use', 'local-probe-pattern']);
    expect(interp({ localPortsMax: 3, localTargetsMax: 7 })).toEqual(['api-use']);
  });
  it('pattern finding is low with outcome/threshold/purpose limitations and the counter evidence id', () => {
    const f = evaluateNetwork(input({ networkCounters: local, patterns: { localPortsMax: 32, localTargetsMax: 32 } }))[1];
    expect(f).toMatchObject({
      findingId: 'network-observed-v1-DET-060-local-probe-pattern',
      interpretation: 'local-probe-pattern',
      interpretationConfidence: 'low',
      evidenceIds: ['DET-060|attempted|api-use'],
      limitationCodes: [LIMITATION_CODES.outcomeNotObserved, LIMITATION_CODES.uncalibratedThreshold, LIMITATION_CODES.purposeUnknown],
    });
  });
  it('a page-hook DET-060 counter (page-controlled) never produces a pattern or a finding', () => {
    const page = [counter({ techniqueId: 'DET-060', count: 50, phase: 'attempted', signalCodes: ['api-use', 'local-multi-port'] })];
    expect(evaluateNetwork(input({ counters: page, patterns: { localPortsMax: 0 } }))).toEqual([]);
    const all = runRules(input({ counters: page })).findings;
    expect(all.filter((f) => f.techniqueId === 'DET-060')).toEqual([]);
    // Patterns without the SW counter are not evidence either.
    expect(evaluateNetwork(input({ counters: page, patterns: { localPortsMax: 32 } }))).toEqual([]);
  });
});

describe('DET-061 dns-test-pattern (uncalibrated)', () => {
  const dns = [networkCounter('DET-061', 12)];
  it('7 random subdomains -> nothing; 8 -> dns-test-pattern/low', () => {
    expect(evaluateNetwork(input({ networkCounters: dns, patterns: { randomSubdomainsMax: 7 } }))).toEqual([]);
    const f = evaluateNetwork(input({ networkCounters: dns, patterns: { randomSubdomainsMax: 8 } }));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      findingId: 'network-observed-v1-DET-061-dns-test-pattern',
      interpretation: 'dns-test-pattern',
      interpretationConfidence: 'low',
      limitationCodes: ['resolver-unknown', 'uncalibrated-threshold', 'purpose-unknown'],
    });
  });
  it('the ceiling is low whatever the maxima', () => {
    const f = evaluateNetwork(input({ networkCounters: [...dns, networkCounter('DET-060', 1)], patterns: { localPortsMax: 32, localTargetsMax: 32, randomSubdomainsMax: 32 } }));
    for (const x of f) expect(['unassessed', 'low']).toContain(x.interpretationConfidence);
    expect(f.filter((x) => x.interpretation !== 'api-use').every((x) => x.interpretationConfidence === 'low')).toBe(true);
  });
});

describe('determinism and helpers', () => {
  it('same input -> identical findings, independent of counter order', () => {
    const counters = [networkCounter('DET-061', 9), networkCounter('DET-058', 1), networkCounter('DET-060', 4), networkCounter('DET-059', 2)];
    const a = evaluateNetwork(input({ networkCounters: counters, patterns: { localPortsMax: 5, randomSubdomainsMax: 9 }, flags: ['network-limited'] }));
    const b = evaluateNetwork(input({ networkCounters: [...counters].reverse(), patterns: { localPortsMax: 5, randomSubdomainsMax: 9 }, flags: ['network-limited'] }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.map((f) => f.findingId)).toEqual([
      'network-observed-v1-DET-058-api-use',
      'network-observed-v1-DET-059-api-use',
      'network-observed-v1-DET-060-api-use',
      'network-observed-v1-DET-060-local-probe-pattern',
      'network-observed-v1-DET-061-dns-test-pattern',
    ]);
  });
  it.each([
    ['p3k9x2q8w1z7m4n6b5v0', true],
    ['a1b2c3d4e5f6', true],
    ['img1', false],
    ['eu-west-1', false],
    ['my-bucket', false],
    ['abcdefghijklmnop', false],
    ['123456789012345', false],
    ['www', false],
    ['', false],
  ])('looksRandomLabel(%s) -> %s', (label, expected) => expect(looksRandomLabel(label)).toBe(expected));
  it('networkPatternMet is false for techniques without a pattern', () => {
    const full = { localPortsMax: 32, localTargetsMax: 32, randomSubdomainsMax: 32 };
    expect(networkPatternMet('DET-058', full)).toBe(false);
    expect(networkPatternMet('DET-059', full)).toBe(false);
    expect(networkPatternMet('DET-060', full)).toBe(true);
    expect(networkPatternMet('DET-061', full)).toBe(true);
  });
});
