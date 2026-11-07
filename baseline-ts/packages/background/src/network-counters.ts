// ADR-025: internal browser-owned aggregates. No request or endpoint fields survive admission.
import { MAX_COUNT, REQUESTED_LOCAL_PORTS_LIMIT, counterKey } from '@detect-expert/contracts';
import type { CounterEntry, RequestedLocalPorts } from '@detect-expert/contracts';

export function addRequestedLocalPort(value: RequestedLocalPorts | undefined, port: number | undefined, incomplete = false): RequestedLocalPorts {
  const ports = value?.ports.slice() ?? [];
  let truncated = value?.truncated === true || incomplete;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 0 || port > 65535 || Object.is(port, -0)) truncated = true;
  else if (!ports.includes(port)) {
    if (ports.length >= REQUESTED_LOCAL_PORTS_LIMIT) truncated = true;
    else { ports.push(port); ports.sort((first, second) => first - second); }
  }
  return { ports, truncated };
}

export function readNetworkCounters(value: unknown): CounterEntry[] {
  if (!Array.isArray(value) || value.length > 4) return [];
  const result: CounterEntry[] = [], keys = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const c = item as Record<string, unknown>;
    if (Object.keys(c).length !== 7 || !['DET-058', 'DET-060', 'DET-061'].includes(c['techniqueId'] as string) ||
        c['phase'] !== 'attempted' || !['exact', 'lower-bound'].includes(c['countQuality'] as string) ||
        !Array.isArray(c['signalCodes']) || !(c['techniqueId'] !== 'DET-061' && c['signalCodes'].length === 1 && c['signalCodes'][0] === 'api-use' ||
          c['techniqueId'] === 'DET-060' && c['signalCodes'].length === 2 && c['signalCodes'][0] === 'api-use' && c['signalCodes'][1] === 'local-multi-port' ||
          c['techniqueId'] === 'DET-061' && c['countQuality'] === 'lower-bound' && c['signalCodes'].length === 2 && c['signalCodes'][0] === 'api-use' && c['signalCodes'][1] === 'unique-subdomains') ||
        !['count', 'firstBucket', 'lastBucket'].every(key => Number.isSafeInteger(c[key]) && (c[key] as number) >= 0 && (c[key] as number) <= MAX_COUNT) ||
        (c['firstBucket'] as number) > (c['lastBucket'] as number)) return [];
    const counter: CounterEntry = { techniqueId: c['techniqueId'] as CounterEntry['techniqueId'], phase: 'attempted',
      signalCodes: [...c['signalCodes']] as CounterEntry['signalCodes'], count: c['count'] as number,
      countQuality: c['countQuality'] as CounterEntry['countQuality'], firstBucket: c['firstBucket'] as number, lastBucket: c['lastBucket'] as number };
    const key = counterKey(counter.techniqueId, counter.phase, counter.signalCodes);
    if (keys.has(key)) return [];
    keys.add(key); result.push(counter);
  }
  return result;
}

export function incrementNetworkCounters(value: readonly CounterEntry[], websocket: boolean, local: boolean,
  multiPort: boolean, limited: boolean, bucket: number, dnsUnique = 0): CounterEntry[] {
  const result = readNetworkCounters(value);
  for (const techniqueId of ['DET-058', 'DET-060'] as const) {
    if (techniqueId === 'DET-058' ? !websocket : !local) continue;
    const signalCodes: CounterEntry['signalCodes'] = techniqueId === 'DET-060' && multiPort ? ['api-use', 'local-multi-port'] : ['api-use'];
    let entry = result.find(c => c.techniqueId === techniqueId && c.signalCodes.length === signalCodes.length);
    if (!entry) { entry = { techniqueId, phase: 'attempted', signalCodes, count: 0, countQuality: 'exact', firstBucket: bucket, lastBucket: bucket }; result.push(entry); }
    if (entry.count === MAX_COUNT) entry.countQuality = 'lower-bound';
    entry.count = Math.min(MAX_COUNT, entry.count + 1);
    entry.firstBucket = Math.min(entry.firstBucket, bucket); entry.lastBucket = Math.max(entry.lastBucket, bucket);
  }
  if (Number.isSafeInteger(dnsUnique) && dnsUnique > 0 && dnsUnique <= 64) {
    let entry = result.find(counter => counter.techniqueId === 'DET-061');
    if (!entry) {
      entry = { techniqueId: 'DET-061', phase: 'attempted', signalCodes: ['api-use', 'unique-subdomains'],
        count: 0, countQuality: 'lower-bound', firstBucket: bucket, lastBucket: bucket };
      result.push(entry);
    }
    entry.count = Math.min(MAX_COUNT, entry.count + dnsUnique);
    entry.firstBucket = Math.min(entry.firstBucket, bucket); entry.lastBucket = Math.max(entry.lastBucket, bucket);
  }
  if (limited) for (const entry of result) entry.countQuality = 'lower-bound';
  return result;
}
