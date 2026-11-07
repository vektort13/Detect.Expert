// ADR-026: retain name/result pairing from each counter. A summary's union loses that pairing.
import { MAX_COUNT, PERMISSION_NAMES, type CounterEntry, type PermissionCheck, type PermissionName } from '@detect-expert/contracts';
import { worstQuality } from './arith';

const names = new Map(PERMISSION_NAMES.map(name => ['permission-' + name, name]));
const results = new Map<string, Pick<PermissionCheck, 'kind' | 'result'>>([
  ['permission-granted', { kind: 'permission', result: 'granted' }],
  ['permission-denied', { kind: 'permission', result: 'denied' }],
  ['permission-prompt', { kind: 'permission', result: 'prompt' }],
  ['policy-allowed', { kind: 'policy', result: 'allowed' }],
  ['policy-blocked', { kind: 'policy', result: 'blocked' }],
]);

export function summarizePermissionChecks(counters: readonly CounterEntry[]): PermissionCheck[] {
  const rows = new Map<string, PermissionCheck>();
  for (const counter of counters) {
    if (counter.techniqueId !== 'DET-039' || counter.phase !== 'returned-sync' || counter.count <= 0) continue;
    // Exactly one name and one result, with only api-use besides them. Ambiguous/page-forged
    // tuples stay generic observations; never form a cross-product of names and states.
    if (counter.signalCodes.length !== 3 || !counter.signalCodes.includes('api-use')) continue;
    let permission: PermissionName | undefined, result: Pick<PermissionCheck, 'kind' | 'result'> | undefined;
    let nameCount = 0, resultCount = 0;
    for (const code of counter.signalCodes) {
      const name = names.get(code), state = results.get(code);
      if (name !== undefined) { permission = name; nameCount++; }
      if (state !== undefined) { result = state; resultCount++; }
    }
    if (nameCount !== 1 || resultCount !== 1 || permission === undefined || result === undefined) continue;
    const key = permission + '|' + result.kind + '|' + result.result;
    const previous = rows.get(key);
    if (previous) {
      const total = previous.count + counter.count;
      previous.count = Math.min(MAX_COUNT, total);
      previous.countQuality = total > MAX_COUNT ? 'lower-bound' : worstQuality(previous.countQuality, counter.countQuality);
    } else rows.set(key, { permission, ...result, count: counter.count, countQuality: counter.countQuality });
  }
  return [...rows].sort(([a], [b]) => a.localeCompare(b)).map(([, row]) => row);
}
