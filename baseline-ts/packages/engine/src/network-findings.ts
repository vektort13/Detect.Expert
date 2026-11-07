// DET-058/060 / ADR-025: only trusted browser request aggregates enter this path.
// The threshold is evaluated before projection; these canonical counters contain no endpoints.
import type { CounterEntry, Finding } from '@detect-expert/contracts';
import { LIMITATION_CODES } from './codes';
import { evidenceIdsOf, makeFinding } from './rules/types';

export function browserNetworkFindings(counters: readonly CounterEntry[], coverageRef: string): Finding[] {
  const out: Finding[] = [];
  for (const techniqueId of ['DET-058', 'DET-060', 'DET-061'] as const) {
    const entries = counters.filter(counter => counter.techniqueId === techniqueId && counter.count > 0);
    if (!entries.length) continue;
    const pattern = techniqueId === 'DET-060' && entries.some(counter => counter.signalCodes.includes('local-multi-port'));
    const dns = techniqueId === 'DET-061' && entries.some(counter => counter.signalCodes.includes('unique-subdomains'));
    out.push(makeFinding({
      ruleId: dns ? 'browser-dns-series' : 'browser-network-attempt', ruleVersion: '1', techniqueId,
      interpretation: dns ? 'dns-test-pattern' : pattern ? 'local-probe-pattern' : 'api-use',
      interpretationConfidence: pattern || dns ? 'low' : 'unassessed',
      evidenceIds: evidenceIdsOf(entries), counterEvidenceCodes: [],
      limitationCodes: [LIMITATION_CODES.purposeUnknown, ...(pattern || dns ? [LIMITATION_CODES.uncalibratedThreshold] : [])],
      coverageRef,
    }));
  }
  return out;
}
