// REQ-004/005/009/011/012: origin inventory reads authorized before and after await.
import { readBackgroundCache, readBackgroundSnapshot } from './background-activity-contracts.js';

const TTL = 600000, MAX_DOCUMENTS = 32;
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
export function emptyBackgroundInventory() {
  return { status: 'unavailable', secureContext: false, supported: { serviceWorker: false, push: false, sync: false, periodicSync: false }, permissions: { notifications: 'unknown', push: 'unknown', sync: 'unknown', periodicSync: 'unknown' }, registrationCount: null, pushSubscriptionCount: null, syncTagCount: null, periodicTagCount: null, registrations: [], truncated: false, checkedAt: 0 };
}
export class BackgroundActivityObserver {
  constructor(runtime, helpers) { this.runtime = runtime; this.helpers = helpers; }
  documents = new Map();
  operations = new Set();
  physical = new Set();
  epoch = 0;
  limited = false;
  clear() { ++this.epoch; this.documents.clear(); this.limited = false; for (const operation of this.operations) operation.invalid = true; }
  forget(key) { ++this.epoch; this.documents.delete(key); for (const operation of this.operations) operation.invalid = true; }
  prune() {
    const runtime = this.runtime, now = runtime.now();
    for (const [key, entry] of this.documents) if (entry.generation !== runtime.scope.accessGeneration || now < entry.at || now - entry.at >= TTL || !runtime.canObserveNetworkDocument(key)) this.documents.delete(key);
  }
  redact(resource) {
    if (!resource) return null;
    const host = this.helpers.redact(resource.host);
    return host?.kind === 'registrable' ? { ...resource, host: host.value } : null;
  }
  snapshot(key, coverageState = 'partial') {
    this.prune();
    const entry = ['active', 'partial', 'degraded'].includes(coverageState) ? this.documents.get(key) : null;
    return readBackgroundSnapshot({ schemaVersion: 1, type: 'background-activity-state', documentKey: key, coverageState, observedAt: this.runtime.now(), rows: entry?.rows ?? [], inventory: entry?.inventory ?? emptyBackgroundInventory(), truncated: this.limited || (entry?.truncated ?? false) });
  }
  async bounded(operation) {
    if (this.physical.size >= 2) throw new Error('background-operation-limit');
    const job = Promise.resolve().then(operation); this.physical.add(job);
    const release = () => this.physical.delete(job); job.then(release, release);
    let timer;
    try { return await Promise.race([job, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('background-timeout')), 1500); })]); }
    finally { clearTimeout(timer); }
  }
  async read(request) {
    if (this.operations.size >= 2) return this.snapshot(request.documentKey, 'degraded');
    const runtime = this.runtime, generation = runtime.scope.accessGeneration, epoch = this.epoch, operation = { invalid: false };
    this.operations.add(operation);
    const current = () => {
      const projection = runtime.getProjection(request.tabId, request.frameId);
      return !operation.invalid && this.epoch === epoch && generation === runtime.scope.accessGeneration && runtime.scope.hasDataConsent && projection?.documentKey === request.documentKey && !['paused', 'no-access', 'unsupported'].includes(projection.coverageState) && runtime.canObserveNetworkDocument(request.documentKey);
    };
    try {
      if (!current() || !await this.bounded(() => runtime.apiResults.authorize(request, operation)) || !current()) return this.snapshot(request.documentKey, 'no-access');
      const documentId = request.documentKey.slice(`${request.tabId}:${request.frameId}:`.length);
      if (!id(documentId)) return this.snapshot(request.documentKey, 'no-access');
      let response;
      try { response = await this.bounded(() => runtime.api.tabs.sendMessage(request.tabId, { schemaVersion: 1, type: 'background-values-query', refresh: request.type === 'ui-refresh-background-activity' }, { frameId: request.frameId, documentId })); } catch { response = null; }
      if (!current() || !await this.bounded(() => runtime.apiResults.authorize(request, operation)) || !current()) return this.snapshot(request.documentKey, 'no-access');
      const cache = readBackgroundCache(response);
      if (!cache) { this.documents.delete(request.documentKey); return this.snapshot(request.documentKey, 'partial'); }
      this.prune();
      if (!this.documents.has(request.documentKey) && this.documents.size >= MAX_DOCUMENTS) { this.documents.delete(this.documents.keys().next().value); this.limited = true; }
      const rows = [], seen = new Map(); let truncated = cache.truncated || !cache.available;
      for (const row of cache.rows) {
        const script = this.redact(row.script), worker = this.redact(row.worker);
        const output = { ...row, script, worker, attributionConfidence: script ? row.attributionConfidence : 'unknown' };
        if (row.script && !script || row.worker && !worker) truncated = true;
        const key = [output.operation, output.phase, output.attributionConfidence, script?.host ?? '', script?.pathTemplate ?? '', worker?.host ?? '', worker?.pathTemplate ?? ''].join('|');
        const previous = seen.get(key);
        if (previous) previous.count = Math.min(2147483647, previous.count + output.count);
        else { seen.set(key, output); rows.push(output); }
      }
      const sourceInventory = request.type === 'ui-get-background-activity' ? this.documents.get(request.documentKey)?.inventory ?? cache.inventory : cache.inventory;
      const inventory = { ...sourceInventory, supported: { ...sourceInventory.supported }, permissions: { ...sourceInventory.permissions }, registrations: [] };
      for (const registration of sourceInventory.registrations) {
        const scope = this.redact(registration.scope), script = this.redact(registration.script);
        if (!scope) { inventory.truncated = true; continue; }
        if (registration.script && !script) inventory.truncated = true;
        inventory.registrations.push({ ...registration, scope, script });
      }
      if (JSON.stringify({ rows, inventory }).length > 65536) { this.documents.delete(request.documentKey); return this.snapshot(request.documentKey, 'degraded'); }
      this.documents.set(request.documentKey, { rows, inventory, truncated, generation, at: runtime.now() });
      return this.snapshot(request.documentKey, 'partial');
    } catch { this.documents.delete(request.documentKey); return this.snapshot(request.documentKey, 'no-access'); }
    finally { operation.invalid = true; this.operations.delete(operation); }
  }
}
