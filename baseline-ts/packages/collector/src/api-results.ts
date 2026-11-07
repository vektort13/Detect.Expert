import { API_RESULTS_CHANNEL, API_RESULTS_LIMITS, apiResultEntryBytes, readApiResultsBatch } from '@detect-expert/contracts';
import type { ApiResultEntry, ApiResultsCache, ApiResultsControl } from '@detect-expert/contracts';
import { isOwnServiceWorker } from './env';

type Response = ApiResultsCache | { schemaVersion: 1; type: 'api-results-reset-ack'; epoch: number };

export interface ApiResultsBridgeEnv {
  onPage(listener: (sameWindow: boolean, data: unknown) => void): void;
  onCommand(listener: (trusted: boolean, data: unknown, respond: (response: Response) => void) => boolean): void;
  onRestore(listener: () => void): void;
  post(message: ApiResultsControl): void;
  later(callback: () => void, ms: number): unknown;
  cancel(timer: unknown): void;
  now(): number;
}

export function startApiResultsBridge(env: ApiResultsBridgeEnv): void {
  let epoch = 0, sequence = 0, expectedBatch = 0, admitted = 0, bytes = 512;
  let requestId = '';
  let timer: unknown = null;
  let cacheTimer: unknown = null;
  let cached: ApiResultsCache | null = null;
  let nextReadAt = -Infinity;
  let waiting: Array<(response: Response) => void> | null = null;
  let truncated = false;
  const rows = new Map<string, ApiResultEntry>();
  const empty = (): ApiResultsCache => ({ schemaVersion: 1, type: 'api-results-cache', epoch, available: false, rows: [], truncated: true });
  const clearCache = (): void => {
    cached = null;
    if (cacheTimer !== null) env.cancel(cacheTimer);
    cacheTimer = null;
  };
  const finish = (available: boolean): void => {
    if (timer !== null) env.cancel(timer);
    timer = null;
    const callbacks = waiting;
    waiting = null;
    const result: ApiResultsCache = { schemaVersion: 1, type: 'api-results-cache', epoch, available,
      rows: available ? [...rows.values()] : [], truncated: truncated || !available };
    rows.clear();
    clearCache();
    if (available) {
      cached = result;
      nextReadAt = env.now() + 1000;
      cacheTimer = env.later(clearCache, 1000);
    }
    if (callbacks) for (const respond of callbacks) respond(result);
  };
  const reset = (): void => {
    epoch = epoch < 2147483647 ? epoch + 1 : 2147483647;
    finish(false);
    nextReadAt = -Infinity;
    env.post({ channel: API_RESULTS_CHANNEL, type: 'api-results-reset', requestId: 'reset-' + epoch, epoch });
  };
  env.onRestore(reset);
  env.onPage((sameWindow, data) => {
    if (!sameWindow || waiting === null || admitted >= 64) return;
    if (typeof data !== 'object' || data === null || Object.getOwnPropertyDescriptor(data, 'channel')?.value !== API_RESULTS_CHANNEL) return;
    admitted++;
    const message = readApiResultsBatch(data);
    if (!message || message.requestId !== requestId || message.epoch !== epoch || message.batchSeq !== expectedBatch) { truncated = true; return; }
    expectedBatch++;
    for (const row of message.rows) {
      const key = row.operation + ':' + row.phase;
      if (rows.has(key)) { truncated = true; continue; }
      const cost = apiResultEntryBytes(row);
      if (rows.size >= API_RESULTS_LIMITS.rows || bytes + cost > API_RESULTS_LIMITS.bytes) { truncated = true; continue; }
      rows.set(key, row); bytes += cost;
    }
    truncated ||= message.truncated;
    if (message.final) finish(message.enabled);
  });
  env.onCommand((trusted, data, respond) => {
    if (!trusted || typeof data !== 'object' || data === null || Array.isArray(data) || Reflect.ownKeys(data).length !== 2 ||
      Object.getOwnPropertyDescriptor(data, 'schemaVersion')?.value !== 1) return false;
    const type = Object.getOwnPropertyDescriptor(data, 'type')?.value as unknown;
    if (type === 'api-results-reset') { reset(); respond({ schemaVersion: 1, type: 'api-results-reset-ack', epoch }); return false; }
    if (type !== 'api-results-query') return false;
    if (epoch === 2147483647 || sequence === 2147483647) { respond(empty()); return false; }
    if (waiting !== null) {
      if (waiting.length < 4) waiting.push(respond);
      else respond(empty());
      return true;
    }
    if (cached !== null && env.now() < nextReadAt) { respond(cached); return false; }
    if (env.now() < nextReadAt) { respond(empty()); return false; }
    clearCache();
    sequence++; requestId = 'query-' + sequence; expectedBatch = 0; admitted = 0; bytes = 512; truncated = false;
    rows.clear(); waiting = [respond];
    timer = env.later(() => finish(false), API_RESULTS_LIMITS.queryMs);
    env.post({ channel: API_RESULTS_CHANNEL, type: 'api-results-read', requestId, epoch });
    return true;
  });
}

export function startBrowserApiResultsBridge(): void {
  startApiResultsBridge({
    onPage: listener => window.addEventListener('message', event => listener(event.source === window, event.data as unknown)),
    onCommand: listener => chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => listener(isOwnServiceWorker(sender), message, respond)),
    onRestore: listener => window.addEventListener('pageshow', event => { if (event.persisted) listener(); }),
    post: message => window.postMessage(message, '*'),
    later: (callback, delay) => setTimeout(callback, delay),
    cancel: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
    now: () => performance.now(),
  });
}