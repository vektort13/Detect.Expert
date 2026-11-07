import { describe, expect, it } from 'vitest';
import { COVERAGE_FLAGS, COVERAGE_STATES, type CoverageFlag, type CoverageState } from '@detect-expert/contracts';
import {
  COVERAGE_FLAG_STATE,
  COVERAGE_PRECEDENCE,
  DEFAULT_COVERAGE_CONTEXT,
  computeCoverageState,
  coverageRef,
  type CoverageContext,
} from '../src/index';

const granted: CoverageContext = { scopeMode: 'site', accessGranted: true, restricted: false, paused: false, inaccessibleFrames: 0 };

describe('computeCoverageState (REQ-006)', () => {
  it('precedence covers every contract state exactly once', () => {
    expect([...COVERAGE_PRECEDENCE].sort()).toEqual([...COVERAGE_STATES].sort());
    expect(new Set(COVERAGE_PRECEDENCE).size).toBe(COVERAGE_STATES.length);
  });

  it('every flag maps to a state and each state (except active) is reachable', () => {
    for (const f of COVERAGE_FLAGS) expect(COVERAGE_STATES).toContain(COVERAGE_FLAG_STATE[f]);
    const reachable = new Set<CoverageState>(Object.values(COVERAGE_FLAG_STATE));
    for (const s of COVERAGE_STATES) if (s !== 'active') expect(reachable.has(s)).toBe(true);
  });

  it('post-install default is no-access (scope off), even with an empty flag set', () => {
    expect(computeCoverageState([])).toBe('no-access');
    expect(computeCoverageState([], DEFAULT_COVERAGE_CONTEXT)).toBe('no-access');
  });

  const table: Array<{ name: string; flags: CoverageFlag[]; ctx: Partial<CoverageContext>; expected: CoverageState }> = [
    { name: 'granted, no flags', flags: [], ctx: {}, expected: 'active' },
    { name: 'restricted page beats everything', flags: ['late-start', 'truncated', 'paused'], ctx: { restricted: true }, expected: 'unsupported' },
    { name: 'restricted-page flag', flags: ['restricted-page'], ctx: {}, expected: 'unsupported' },
    { name: 'scope off beats paused/degraded', flags: ['paused', 'truncated'], ctx: { scopeMode: 'off' }, expected: 'no-access' },
    { name: 'not granted', flags: [], ctx: { accessGranted: false }, expected: 'no-access' },
    { name: 'revoked flag', flags: ['revoked', 'late-start'], ctx: {}, expected: 'no-access' },
    { name: 'no-host-permission flag', flags: ['no-host-permission'], ctx: {}, expected: 'no-access' },
    { name: 'paused beats degraded', flags: ['truncated', 'channel-gap'], ctx: { paused: true }, expected: 'paused' },
    { name: 'paused flag', flags: ['paused', 'late-start'], ctx: {}, expected: 'paused' },
    { name: 'degraded beats late-start', flags: ['late-start', 'truncated'], ctx: {}, expected: 'degraded' },
    { name: 'throttled', flags: ['throttled'], ctx: {}, expected: 'degraded' },
    { name: 'budget-exceeded', flags: ['budget-exceeded'], ctx: {}, expected: 'degraded' },
    { name: 'bridge-ring-overflow', flags: ['bridge-ring-overflow'], ctx: {}, expected: 'degraded' },
    { name: 'protocol-mismatch', flags: ['protocol-mismatch'], ctx: {}, expected: 'degraded' },
    { name: 'late-start beats partial', flags: ['hook-failed', 'late-start'], ctx: {}, expected: 'late-start' },
    { name: 'late-start beats inaccessible frames', flags: ['late-start'], ctx: { inaccessibleFrames: 2 }, expected: 'late-start' },
    { name: 'hook-failed on one API', flags: ['hook-failed'], ctx: {}, expected: 'partial' },
    { name: 'descriptor-nonconfigurable', flags: ['descriptor-nonconfigurable'], ctx: {}, expected: 'partial' },
    { name: 'unsupported-realm', flags: ['unsupported-realm'], ctx: {}, expected: 'partial' },
    { name: 'worker-not-observed', flags: ['worker-not-observed'], ctx: {}, expected: 'partial' },
    { name: 'network outside granted scope', flags: ['network-limited'], ctx: {}, expected: 'partial' },
    { name: 'frame coverage flag without context count', flags: ['frames-inaccessible'], ctx: {}, expected: 'partial' },
    { name: 'cross-origin frames inaccessible', flags: [], ctx: { inaccessibleFrames: 1 }, expected: 'partial' },
  ];

  for (const row of table) {
    it('precedence: ' + row.name + ' -> ' + row.expected, () => {
      expect(computeCoverageState(row.flags, { ...granted, ...row.ctx })).toBe(row.expected);
    });
  }

  it('each flag alone (with access) yields its declared state', () => {
    for (const f of COVERAGE_FLAGS) expect(computeCoverageState([f], granted)).toBe(COVERAGE_FLAG_STATE[f]);
  });

  it('is independent of flag order', () => {
    const flags: CoverageFlag[] = ['hook-failed', 'late-start', 'truncated'];
    expect(computeCoverageState(flags, granted)).toBe(computeCoverageState([...flags].reverse(), granted));
  });
});

describe('coverageRef', () => {
  it('fits the contract id alphabet and distinguishes flag sets', () => {
    const a = coverageRef('active', []);
    const b = coverageRef('late-start', ['late-start']);
    const c = coverageRef('late-start', ['late-start', 'hook-failed']);
    for (const r of [a, b, c]) expect(r).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(new Set([a, b, c]).size).toBe(3);
    expect(coverageRef('degraded', ['truncated', 'late-start'])).toBe(coverageRef('degraded', ['late-start', 'truncated']));
    expect(coverageRef('degraded', COVERAGE_FLAGS)).toBe('cov-degraded-1ffff');
  });
});
