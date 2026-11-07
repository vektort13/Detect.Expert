// ADR-023: narrow continuity checkpoint for a live Pro document whose Light report was cleared.
import { BUDGETS, COUNT_QUALITIES, MAX_COUNT, PHASES, SIGNAL_CODES, TECHNIQUE_IDS, apiOperationAllows, isApiOperation, counterKey, extensionResourceAllows, readExtensionResource } from '@detect-expert/contracts';
import type { CounterEntry, DocumentReport } from '@detect-expert/contracts';
import { MAX_BOOTS_PER_DOCUMENT } from './documents';
import type { DocumentMeta } from './documents';
import { readNetworkCounters } from './network-counters';

interface HistoryBoot { sensorBootId: string; counts: Array<[string, number]> }
interface BrowserHistory { counters: CounterEntry[]; boots: HistoryBoot[]; limited: boolean }
export interface ProCounterHistory { documentKey: string; tabId: number; counters: CounterEntry[]; boots: HistoryBoot[]; limited: boolean; browser?: BrowserHistory }

/** Reuse the bounded per-generation accumulator; never mix browser and page counter namespaces. */
function browserSource(report: DocumentReport, meta: DocumentMeta): { report: DocumentReport; meta: DocumentMeta } | null {
  if (!meta.networkCounterEpoch || !meta.networkCounters?.length) return null;
  const { networkCounters, ...ordinaryMeta } = meta;
  return { report: { ...report, counters: networkCounters }, meta: { ...ordinaryMeta, counterKeyFormat: 'index-v1',
    boots: [{ sensorBootId: meta.networkCounterEpoch, counts: Object.fromEntries(networkCounters.map((c, index) => [String(index), c.count])) }] } };
}

function bootCounters(report: DocumentReport, meta: DocumentMeta): HistoryBoot[] {
  const keys = report.counters.map(c => counterKey(c.techniqueId, c.phase, c.signalCodes, c.apiOperation, c.extensionResource));
  const known = new Set(keys);
  return meta.boots.map(boot => ({ sensorBootId: boot.sensorBootId, counts: Object.entries(boot.counts).flatMap(([slot, count]): Array<[string, number]> => {
    const key = meta.counterKeyFormat === 'index-v1' ? keys[Number(slot)] : slot;
    return key !== undefined && known.has(key) ? [[key, count]] : [];
  }) }));
}

export function createProCounterHistory(report: DocumentReport, meta: DocumentMeta): ProCounterHistory {
  const limited = report.dropped.counters > 0;
  const counters = structuredClone(report.counters);
  if (limited) for (const counter of counters) counter.countQuality = 'lower-bound';
  const result: ProCounterHistory = { documentKey: report.documentKey, tabId: report.tabId, counters, boots: bootCounters(report, meta), limited };
  const browser = browserSource(report, meta);
  if (browser) {
    const value = createProCounterHistory(browser.report, browser.meta);
    result.browser = { counters: value.counters, boots: value.boots, limited: value.limited };
  }
  return result;
}

/** Maxima are kept per sensor boot, so a replay after Light clear/restart never adds the whole boot twice. */
export function mergeProCounterHistory(history: ProCounterHistory, report: DocumentReport, meta: DocumentMeta): ProCounterHistory {
  const result = structuredClone(history);
  result.limited ||= report.dropped.counters > 0;
  const counters = new Map(result.counters.map(c => [counterKey(c.techniqueId, c.phase, c.signalCodes, c.apiOperation, c.extensionResource), c]));
  const source = new Map(report.counters.map(c => [counterKey(c.techniqueId, c.phase, c.signalCodes, c.apiOperation, c.extensionResource), c]));
  for (const incoming of bootCounters(report, meta)) {
    let boot = result.boots.find(item => item.sensorBootId === incoming.sensorBootId);
    if (!boot) {
      if (result.boots.length >= MAX_BOOTS_PER_DOCUMENT) { result.limited = true; continue; }
      boot = { sensorBootId: incoming.sensorBootId, counts: [] }; result.boots.push(boot);
    }
    const maxima = new Map(boot.counts);
    for (const [key, count] of incoming.counts) {
      const old = maxima.get(key) ?? 0, current = source.get(key)!;
      let counter = counters.get(key);
      if (!counter && counters.size >= BUDGETS.maxCountersPerDocumentGroup) { result.limited = true; continue; }
      if (!counter) { counter = { ...current, count: 0, signalCodes: [...current.signalCodes] }; counters.set(key, counter); }
      const sum = counter.count + Math.max(0, count - old);
      if (sum > MAX_COUNT) result.limited = true;
      counter.count = Math.min(MAX_COUNT, sum);
      counter.countQuality = counter.countQuality === 'lower-bound' || current.countQuality === 'lower-bound' ? 'lower-bound' : counter.countQuality === 'sampled' || current.countQuality === 'sampled' ? 'sampled' : 'exact';
      counter.firstBucket = Math.min(counter.firstBucket, current.firstBucket); counter.lastBucket = Math.max(counter.lastBucket, current.lastBucket);
      maxima.set(key, Math.max(old, count));
    }
    boot.counts = [...maxima];
  }
  result.counters = [...counters.values()];
  if (result.limited) for (const counter of result.counters) counter.countQuality = 'lower-bound';
  const browser = browserSource(report, meta);
  if (browser) {
    const value = result.browser
      ? mergeProCounterHistory({ documentKey: history.documentKey, tabId: history.tabId, ...result.browser }, browser.report, browser.meta)
      : createProCounterHistory(browser.report, browser.meta);
    result.browser = { counters: value.counters, boots: value.boots, limited: value.limited };
    result.limited ||= value.limited;
  }
  return result;
}

function shape(v: unknown, keys: string[]): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v) || Object.getOwnPropertySymbols(v).length || Object.getOwnPropertyNames(v).length !== keys.length) return false;
  if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) return false;
  return keys.every(key => Object.getOwnPropertyDescriptor(v, key)?.get === undefined && Object.getOwnPropertyDescriptor(v, key)?.set === undefined && Object.hasOwn(v, key));
}
function array(v: unknown, max: number): v is unknown[] {
  if (!Array.isArray(v) || v.length > max || Object.getOwnPropertyNames(v).length !== v.length + 1 || Object.getOwnPropertySymbols(v).length) return false;
  return Array.from({ length: v.length }, (_, index) => Object.getOwnPropertyDescriptor(v, String(index))).every(d => d && Object.hasOwn(d, 'value'));
}
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= MAX_COUNT;

/** Decode only canonical counters/boot maxima; no arbitrary text, accessors, pixels or request data. */
export function readProCounterHistory(value: unknown): ProCounterHistory | null {
  try {
    const hasBrowser = typeof value === 'object' && value !== null && Object.hasOwn(value, 'browser');
    if (!shape(value, ['documentKey', 'tabId', 'counters', 'boots', 'limited', ...(hasBrowser ? ['browser'] : [])]) || typeof value['documentKey'] !== 'string' || !/^[A-Za-z0-9_:.-]{1,128}$/.test(value['documentKey']) || !count(value['tabId']) || !value['documentKey'].startsWith(String(value['tabId']) + ':') || typeof value['limited'] !== 'boolean' || !array(value['counters'], BUDGETS.maxCountersPerDocumentGroup) || !array(value['boots'], MAX_BOOTS_PER_DOCUMENT)) return null;
    const counters: CounterEntry[] = [], keys = new Set<string>();
    for (const item of value['counters']) {
      const hasOperation = typeof item === 'object' && item !== null && Object.hasOwn(item, 'apiOperation');
      const hasResource = typeof item === 'object' && item !== null && Object.hasOwn(item, 'extensionResource');
      if (hasOperation && hasResource) return null;
      if (!shape(item, ['techniqueId', 'phase', 'signalCodes', 'count', 'countQuality', 'firstBucket', 'lastBucket', ...(hasOperation ? ['apiOperation'] : []), ...(hasResource ? ['extensionResource'] : [])]) || !TECHNIQUE_IDS.includes(item['techniqueId'] as CounterEntry['techniqueId']) || !PHASES.includes(item['phase'] as CounterEntry['phase']) || !COUNT_QUALITIES.includes(item['countQuality'] as CounterEntry['countQuality']) || !count(item['count']) || !count(item['firstBucket']) || !count(item['lastBucket']) || item['firstBucket'] > item['lastBucket'] || !array(item['signalCodes'], BUDGETS.maxSignalCodesPerObservation) || !item['signalCodes'].every(s => SIGNAL_CODES.includes(s as CounterEntry['signalCodes'][number])) || new Set(item['signalCodes']).size !== item['signalCodes'].length) return null;
      const counter = item as unknown as CounterEntry;
      if (hasOperation && (!isApiOperation(counter.apiOperation) || !apiOperationAllows(counter.apiOperation, counter.techniqueId, counter.phase) ||
          counter.signalCodes.length !== 1 || counter.signalCodes[0] !== 'api-use')) return null;
        const resource = hasResource ? readExtensionResource(counter.extensionResource) : null;
        if (hasResource && (!resource || !extensionResourceAllows(resource, counter.techniqueId, counter.phase) ||
          counter.signalCodes.length !== 1 || counter.signalCodes[0] !== 'api-use')) return null;
        const key = counterKey(counter.techniqueId, counter.phase, counter.signalCodes, counter.apiOperation, counter.extensionResource);
      if (keys.has(key)) return null;
      keys.add(key); counters.push({ ...counter, signalCodes: [...counter.signalCodes] });
    }
    const boots: HistoryBoot[] = [], ids = new Set<string>();
    for (const item of value['boots']) {
      if (!shape(item, ['sensorBootId', 'counts']) || typeof item['sensorBootId'] !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(item['sensorBootId']) || ids.has(item['sensorBootId']) || !array(item['counts'], BUDGETS.maxCountersPerDocumentGroup)) return null;
      const entries: Array<[string, number]> = [], seen = new Set<string>();
      for (const entry of item['counts']) {
        if (!array(entry, 2) || entry.length !== 2 || typeof entry[0] !== 'string' || !keys.has(entry[0]) || seen.has(entry[0]) || !count(entry[1])) return null;
        seen.add(entry[0]); entries.push([entry[0], entry[1]]);
      }
      ids.add(item['sensorBootId']); boots.push({ sensorBootId: item['sensorBootId'], counts: entries });
    }
    const result: ProCounterHistory = { documentKey: value['documentKey'], tabId: value['tabId'], counters, boots, limited: value['limited'] };
    if (hasBrowser) {
      const browser = value['browser'];
      if (!shape(browser, ['counters', 'boots', 'limited'])) return null;
      const parsed = readProCounterHistory({ documentKey: result.documentKey, tabId: result.tabId, ...browser });
      if (!parsed || readNetworkCounters(parsed.counters).length !== parsed.counters.length) return null;
      result.browser = { counters: parsed.counters, boots: parsed.boots, limited: parsed.limited };
    }
    return result;
  } catch { return null; }
}
