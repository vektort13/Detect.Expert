// DET-049 / REQ-004/005/009/011/012: current-document cookie setter metadata.
import { readCookieWriterRequest, readCookieWriterCache, readCookieWriterRows, readCookieWriterSnapshot, cookieWriterRowKey } from './cookie-writers-contracts.js';
const TTL = 600000, MAX_DOCUMENTS = 32;
export class CookieWriterObserver {
  constructor(runtime, helpers, timers = globalThis) { this.runtime = runtime; this.helpers = helpers; this.timers = timers; }
  documents = new Map();
  operations = new Set();
  physical = new Set();
  pending = new Map();
  epoch = 0;
  limited = false;
  clear() { ++this.epoch; this.documents.clear(); this.pending.clear(); this.limited = false; for (const operation of this.operations) operation.invalid = true; }
  forget(key) { ++this.epoch; this.documents.delete(key); this.pending.clear(); for (const operation of this.operations) operation.invalid = true; }
  prune() {
    const runtime = this.runtime, now = runtime.now();
    for (const [key, entry] of this.documents) if (entry.generation !== runtime.scope.accessGeneration || now < entry.at || now - entry.at >= TTL || !runtime.scope.hasDataConsent || runtime.apiResults.binding?.(key)?.apiResultsResetRequired || !runtime.canObserveNetworkDocument(key)) this.documents.delete(key);
  }
  snapshot(key, coverageState = 'partial') {
    this.prune();
    const entry = ['active', 'partial', 'late-start', 'degraded'].includes(coverageState) ? this.documents.get(key) : null;
    return readCookieWriterSnapshot({ schemaVersion: 1, type: 'cookie-writers-state', documentKey: key, coverageState, rows: entry?.rows ?? [], truncated: this.limited || (entry?.truncated ?? false) });
  }
  async bounded(operation) {
    if (this.physical.size >= 2) throw new Error('cookie-writer-operation-limit');
    const job = Promise.resolve().then(operation); this.physical.add(job);
    const release = () => this.physical.delete(job); job.then(release, release);
    let timer;
    try { return await Promise.race([job, new Promise((_, reject) => { timer = this.timers.setTimeout(() => reject(new Error('cookie-writer-timeout')), 1500); })]); }
    finally { this.timers.clearTimeout(timer); }
  }
  read(input) {
    const request = readCookieWriterRequest(input);
    if (!request) return Promise.resolve(null);
    const key = request.documentKey, previous = this.pending.get(key);
    if (previous && previous.epoch === this.epoch && previous.generation === this.runtime.scope.accessGeneration) return previous.promise;
    if (this.operations.size >= 2) return Promise.resolve(this.snapshot(key, 'degraded'));
    const state = { epoch: this.epoch, generation: this.runtime.scope.accessGeneration, promise: null };
    state.promise = this.readWork(request).finally(() => { if (this.pending.get(key) === state) this.pending.delete(key); });
    this.pending.set(key, state);
    return state.promise;
  }
  async readWork(request) {
    const runtime = this.runtime, generation = runtime.scope.accessGeneration, epoch = this.epoch, operation = { invalid: false };
    this.operations.add(operation);
    const current = () => {
      const projection = runtime.getProjection(request.tabId, request.frameId);
      return !operation.invalid && this.epoch === epoch && generation === runtime.scope.accessGeneration && runtime.scope.hasDataConsent && !runtime.apiResults.binding?.(request.documentKey)?.apiResultsResetRequired && projection?.documentKey === request.documentKey && !['paused', 'no-access', 'unsupported'].includes(projection.coverageState) && runtime.canObserveNetworkDocument(request.documentKey);
    };
    const denied = () => { const entry = this.documents.get(request.documentKey); if (entry?.generation === generation && entry.epoch === epoch) this.documents.delete(request.documentKey); return this.snapshot(request.documentKey, 'no-access'); };
    try {
      if (!current() || !await this.bounded(() => runtime.apiResults.authorize(request, operation)) || !current()) return denied();
      const documentId = request.documentKey.slice((request.tabId + ':' + request.frameId + ':').length);
      let response;
      try { response = await this.bounded(() => current() ? runtime.api.tabs.sendMessage(request.tabId, { schemaVersion: 1, type: 'cookie-writers-query' }, { frameId: request.frameId, documentId }) : null); } catch { response = null; }
      if (!current() || !await this.bounded(() => runtime.apiResults.authorize(request, operation)) || !current()) return denied();
      const cache = readCookieWriterCache(response);
      if (!cache) { this.documents.delete(request.documentKey); return this.snapshot(request.documentKey, 'partial'); }
      const rows = [], indexed = new Map(); let truncated = cache.truncated || !cache.available;
      for (const row of cache.rows) {
        const host = row.script ? this.helpers.redact(row.script.host) : null;
        const script = host?.kind === 'registrable' ? { ...row.script, host: host.value } : null;
        if (row.script && !script) truncated = true;
        const output = { ...row, script, attributionConfidence: script ? row.attributionConfidence : 'unknown' };
        const key = cookieWriterRowKey(output), prior = indexed.get(key);
        if (prior) { const sum = prior.count + output.count; if (sum >= 2147483647) truncated = true; prior.count = Math.min(2147483647, sum); }
        else { indexed.set(key, output); rows.push(output); }
      }
      const clean = readCookieWriterRows(rows);
      if (!clean) { this.documents.delete(request.documentKey); return this.snapshot(request.documentKey, 'degraded'); }
      this.prune();
      if (!current()) return denied();
      if (!this.documents.has(request.documentKey) && this.documents.size >= MAX_DOCUMENTS) { this.documents.delete(this.documents.keys().next().value); this.limited = true; }
      // The MAIN snapshot is cumulative. Re-reading replaces it rather than adding counts.
      this.documents.set(request.documentKey, { rows: clean, truncated, generation, epoch, at: runtime.now() });
      return this.snapshot(request.documentKey, 'partial');
    } catch { return denied(); }
    finally { operation.invalid = true; this.operations.delete(operation); }
  }
}
