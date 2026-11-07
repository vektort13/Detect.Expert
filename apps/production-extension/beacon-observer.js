// ADR-030 / REQ-001/004/005/009/011/012: passive, current-document beacons.
import { decodeBeacon, beaconProfile } from './beacon-decoder.js';
import { readBeaconRows, readBeaconSnapshot, readBeaconTiming, readBeaconScriptRows } from './beacon-contracts.js';

const MAX_DOCUMENTS = 32, MAX_ROWS = 64, MAX_BYTES = 65536, MAX_PENDING = 512, TTL = 600000;
const own = (object, key) => object && typeof object === 'object' ? Object.getOwnPropertyDescriptor(object, key)?.value : undefined;
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const keyOf = row => JSON.stringify({ ...row, count: 0, completedCount: 0, failedCount: 0, redirectCount: 0, statusCodes: [] });
const saturate = (value, delta = 1) => Math.min(2147483647, value + delta);

export class BeaconObserver {
  constructor(runtime, helpers) { this.runtime = runtime; this.helpers = helpers; }
  documents = new Map(); pending = new Map(); resets = new Set(); operations = new Set(); physical = new Set();
  epoch = 0; limited = false; windowAt = -Infinity; windowCount = 0;
  clear() {
    ++this.epoch;
    for (const operation of this.operations) operation.invalid = true;
    for (const binding of this.runtime.state?.bindings?.values() ?? []) if (this.resets.size < 128) this.resets.add(binding.documentKey);
    this.documents.clear(); this.pending.clear(); this.limited = false;
    for (const page of this.runtime.pro?.session?.pages ?? []) delete page.beacons;
    this.runtime.pro?.mark();
  }
  forget(key) {
    ++this.epoch; this.documents.delete(key);
    for (const operation of this.operations) operation.invalid = true;
    for (const [requestId, pending] of this.pending) if (pending.documentKey === key) this.pending.delete(requestId);
    if (this.resets.size < 128) this.resets.add(key);
  }
  prune() {
    const now = this.runtime.now();
    for (const [key, entry] of this.documents) if (entry.generation !== this.runtime.scope.accessGeneration || now < entry.at || now - entry.at >= TTL || !this.runtime.canObserveNetworkDocument(key)) this.documents.delete(key);
    for (const [requestId, pending] of this.pending) if (pending.generation !== this.runtime.scope.accessGeneration || now < pending.at || now - pending.at >= 30000 || !this.runtime.canObserveNetworkDocument(pending.documentKey)) this.pending.delete(requestId);
  }
  entry(key, source) {
    let entry = this.documents.get(key);
    if (!entry) {
      if (this.documents.size >= MAX_DOCUMENTS) { this.forget(this.documents.keys().next().value); this.limited = true; }
      entry = { rows: new Map(), scriptCalls: [], source, bytes: 256, truncated: false, generation: this.runtime.scope.accessGeneration, at: this.runtime.now(), windowAt: -Infinity, windowCount: 0 };
      this.documents.set(key, entry);
    }
    if (entry.source === null && source !== null) entry.source = source;
    entry.at = this.runtime.now(); return entry;
  }
  redact(host) { const result = this.helpers.redact(host); return result?.kind === 'registrable' ? result.value : null; }
  observe(details, phase = 'before') {
    const runtime = this.runtime;
    if (!runtime.isReady || !runtime.scope.hasDataConsent || !runtime.scope.accessReady || !runtime.scope.hasAnyHostAccess() || runtime.api.__detectExpertCapabilities?.networkDocumentIdentity === false || !['before', 'completed', 'error', 'redirect'].includes(phase)) return;
    const tabId = own(details, 'tabId'), frameId = own(details, 'frameId'), documentId = own(details, 'documentId'), lifecycle = own(details, 'documentLifecycle');
    const requestId = own(details, 'requestId');
    if (!integer(tabId) || !integer(frameId) || !id(documentId) || lifecycle && lifecycle !== 'active' || typeof requestId !== 'string' || !/^[a-z0-9_.:-]{1,128}$/i.test(requestId)) return;
    const key = `${tabId}:${frameId}:${documentId}`;
    if (!runtime.canObserveNetworkDocument(key)) return;
    this.prune();
    const pending = this.pending.get(requestId);
    if (phase !== 'before') {
      if (pending?.documentKey !== key || pending.generation !== runtime.scope.accessGeneration) return;
      const entry = this.documents.get(key), row = entry?.rows.get(pending.rowKey);
      if (!row || !runtime.scope.isHostGrantedSync(row.destinationHost, 'https')) { this.pending.delete(requestId); return; }
      if (phase === 'completed') row.completedCount = saturate(row.completedCount);
      if (phase === 'error') row.failedCount = saturate(row.failedCount);
      if (phase === 'redirect') row.redirectCount = saturate(row.redirectCount);
      const status = own(details, 'statusCode');
      if (Number.isSafeInteger(status) && status >= 100 && status <= 599 && !row.statusCodes.includes(status)) {
        if (row.statusCodes.length < 16) row.statusCodes.push(status); else entry.truncated = true;
      }
      this.pending.delete(requestId); return;
    }
    if (pending?.documentKey === key) return;
    const raw = own(details, 'url'), match = beaconProfile(raw);
    if (!match) return;
    const destinationHost = this.helpers.host(raw);
    if (!destinationHost || !runtime.scope.isHostGrantedSync(destinationHost, 'https')) return;
    const initiator = own(details, 'initiator'), initiatorHost = this.helpers.host(initiator);
    const scheme = typeof initiator === 'string' && initiator.startsWith('https://') ? 'https' : typeof initiator === 'string' && initiator.startsWith('http://') ? 'http' : null;
    if (!initiatorHost || !scheme || !runtime.scope.isHostGrantedSync(initiatorHost, scheme)) return;
    const entry = this.entry(key, 'browser-network'), now = runtime.now();
    if (now < this.windowAt || now - this.windowAt >= 1000) { this.windowAt = now; this.windowCount = 0; }
    if (now < entry.windowAt || now - entry.windowAt >= 1000) { entry.windowAt = now; entry.windowCount = 0; }
    if (++this.windowCount > 100 || ++entry.windowCount > 20) { entry.truncated = true; return; }
    const method = ['GET', 'POST', 'PUT'].includes(own(details, 'method')) ? own(details, 'method') : 'other';
    const decoded = decodeBeacon({ url: raw, method, body: own(details, 'requestBody'), bodyAvailable: Object.hasOwn(Object.getOwnPropertyDescriptor(details, 'requestBody') ?? {}, 'value') });
    if (!decoded) return;
    const row = { ...decoded, method, requestType: ['image', 'xmlhttprequest', 'ping', 'script'].includes(own(details, 'type')) ? own(details, 'type') : 'other', count: 1, completedCount: 0, failedCount: 0, redirectCount: 0, statusCodes: [], evidenceSource: 'browser-network', integrity: 'browser-observed', attributionConfidence: 'frame-only', initiatorHost: this.redact(initiatorHost), script: null };
    if (!readBeaconRows([row])) { entry.truncated = true; return; }
    // Native requests take priority over timing recovery, which has no body or
    // authoritative network identity. Do not count one request in both sources.
    if (entry.source === 'page-dom') {
      entry.truncated ||= entry.rows.size > 0;
      entry.rows.clear(); entry.bytes = 256; entry.source = 'browser-network';
    }
    const rowKey = keyOf(row), existing = entry.rows.get(rowKey), cost = 256 + JSON.stringify(row).length * 2;
    if (existing) existing.count = saturate(existing.count);
    else if (entry.rows.size >= MAX_ROWS || entry.bytes + cost > MAX_BYTES) { entry.truncated = true; return; }
    else { entry.rows.set(rowKey, row); entry.bytes += cost; }
    if (this.pending.size >= MAX_PENDING) { this.pending.delete(this.pending.keys().next().value); entry.truncated = true; }
    this.pending.set(requestId, { documentKey: key, rowKey, generation: runtime.scope.accessGeneration, at: now });
  }
  snapshot(key, coverageState = 'partial') {
    this.prune(); const entry = ['active', 'partial', 'late-start', 'degraded'].includes(coverageState) ? this.documents.get(key) : null;
    const rows = entry ? [...entry.rows.values()].map(row => ({ ...row, events: row.events.slice(), money: row.money.map(item => ({ ...item })), identifiers: { ...row.identifiers }, consent: { ...row.consent }, parameterNames: row.parameterNames.slice(), statusCodes: row.statusCodes.slice() })) : [];
    const scriptCalls = entry ? entry.scriptCalls.map(row => ({ ...row, events: row.events.slice(), money: row.money.map(item => ({ ...item })), identifiers: { ...row.identifiers }, consent: { ...row.consent }, parameterNames: row.parameterNames.slice(), statusCodes: [], script: row.script ? { ...row.script } : null })) : [];
    return readBeaconSnapshot({ schemaVersion: 1, type: 'beacons-state', documentKey: key, coverageState, requestCount: Math.min(2147483647, rows.reduce((sum, row) => sum + row.count, 0)), rows, scriptCalls, truncated: this.limited || (entry?.truncated ?? false) });
  }
  async bounded(operation) {
    if (this.physical.size >= 2) throw Error('beacon-operation-limit');
    const job = Promise.resolve().then(operation); this.physical.add(job);
    const release = () => this.physical.delete(job); job.then(release, release);
    let timer;
    try { return await Promise.race([job, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('beacon-timeout')), 1500); })]); }
    finally { clearTimeout(timer); }
  }
  async read(request) {
    if (this.operations.size >= 2) return this.snapshot(request.documentKey, 'degraded');
    const runtime = this.runtime, epoch = this.epoch, generation = runtime.scope.accessGeneration, operation = { invalid: false };
    this.operations.add(operation);
    const current = () => {
      const projection = runtime.getProjection(request.tabId, request.frameId);
      return !operation.invalid && this.epoch === epoch && runtime.scope.accessGeneration === generation && runtime.scope.hasDataConsent && projection?.documentKey === request.documentKey && !['paused', 'no-access', 'unsupported'].includes(projection.coverageState) && runtime.canObserveNetworkDocument(request.documentKey);
    };
    try {
      if (!current() || !await this.bounded(() => runtime.apiResults.authorize(request, operation)) || !current()) return this.snapshot(request.documentKey, 'no-access');
      const documentId = request.documentKey.slice(`${request.tabId}:${request.frameId}:`.length);
      if (!id(documentId)) return this.snapshot(request.documentKey, 'no-access');
      const options = { frameId: request.frameId, documentId };
      let page;
      try { page = await this.bounded(() => runtime.api.tabs.sendMessage(request.tabId, { schemaVersion: 1, type: 'beacon-values-query' }, options)); } catch { page = null; }
      if (!current() || !await this.bounded(() => runtime.apiResults.authorize(request, operation)) || !current()) return this.snapshot(request.documentKey, 'no-access');
      const fields = ['schemaVersion', 'type', 'available', 'rows', 'truncated'];
      const valid = page && typeof page === 'object' && Reflect.ownKeys(page).length === fields.length && fields.every(field => Object.hasOwn(Object.getOwnPropertyDescriptor(page, field) ?? {}, 'value')) && own(page, 'schemaVersion') === 1 && own(page, 'type') === 'beacon-values-cache' && own(page, 'available') === true && typeof own(page, 'truncated') === 'boolean';
      const calls = valid ? readBeaconScriptRows(own(page, 'rows')) : null;
      const pageEntry = this.entry(request.documentKey, null); pageEntry.scriptCalls = [];
      if (calls) for (const row of calls) {
        if (!runtime.scope.isHostGrantedSync(row.destinationHost, 'https')) { pageEntry.truncated = true; continue; }
        const script = row.script ? { ...row.script, host: this.redact(row.script.host) } : null;
        pageEntry.scriptCalls.push({ ...row, script: script?.host ? script : null, attributionConfidence: script?.host ? row.attributionConfidence : 'unknown' });
      }
      if (!calls || own(page, 'truncated') === true) pageEntry.truncated = true;
      if (pageEntry.source === 'browser-network') return this.snapshot(request.documentKey);
      if (this.resets.has(request.documentKey)) {
        const reset = await this.bounded(() => runtime.api.tabs.sendMessage(request.tabId, { schemaVersion: 1, type: 'beacon-timing-reset' }, options));
        if (!current() || own(reset, 'schemaVersion') !== 1 || own(reset, 'type') !== 'beacon-timing-reset-ack') return this.snapshot(request.documentKey, 'no-access');
        this.resets.delete(request.documentKey);
      }
      let raw;
      try { raw = await this.bounded(() => runtime.api.tabs.sendMessage(request.tabId, { schemaVersion: 1, type: 'beacon-timing-query' }, options)); }
      catch { raw = null; }
      if (!current() || !await this.bounded(() => runtime.apiResults.authorize(request, operation)) || !current()) return this.snapshot(request.documentKey, 'no-access');
      if (this.documents.get(request.documentKey)?.source === 'browser-network') return this.snapshot(request.documentKey);
      const cache = readBeaconTiming(raw);
      if (!cache?.available) {
        const entry = this.documents.get(request.documentKey); if (entry) entry.truncated = true;
        return this.snapshot(request.documentKey);
      }
      const entry = this.entry(request.documentKey, null); entry.rows = new Map(); entry.bytes = 256; entry.truncated ||= cache.truncated;
      for (const row of cache.rows) {
        if (!runtime.scope.isHostGrantedSync(row.destinationHost, 'https')) { entry.truncated = true; continue; }
        const cost = 256 + JSON.stringify(row).length * 2;
        if (entry.rows.size >= MAX_ROWS || entry.bytes + cost > MAX_BYTES) { entry.truncated = true; break; }
        entry.rows.set(keyOf(row), row); entry.bytes += cost;
      }
      // An empty recovery read must not reserve a document before its first hit.
      entry.source = entry.rows.size ? 'page-dom' : null;
      return this.snapshot(request.documentKey);
    } catch { return this.snapshot(request.documentKey, 'no-access'); }
    finally { operation.invalid = true; this.operations.delete(operation); }
  }
}

// Executed only in the extension-owned ISOLATED realm. URL/query is discarded here.
export function startBeaconTimingBridge(env) {
  const own = (value, key) => value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
  let rows = new Map(), bytes = 256, truncated = false, cutoff = -Infinity, observer = null, enabled = true, started = false, fallbackRead = false;
  const rowKey = row => JSON.stringify({ ...row, count: 0 });
  const record = entries => {
    if (!enabled) return;
    if (!Array.isArray(entries) || entries.length > 2048) { truncated = true; return; }
    for (const entry of entries) {
      try {
        const raw = env.name(entry), start = env.start(entry), kind = env.initiator(entry);
        if (typeof start !== 'number' || start < cutoff) continue;
        const decoded = env.decode({ url: raw, method: 'unknown', bodyAvailable: false });
        if (!decoded) continue;
        const requestType = kind === 'img' || kind === 'image' ? 'image' : kind === 'fetch' || kind === 'xmlhttprequest' ? 'xmlhttprequest' : kind === 'beacon' ? 'ping' : kind === 'script' ? 'script' : 'other';
        const row = { ...decoded, method: 'unknown', requestType, count: 1, completedCount: 0, failedCount: 0, redirectCount: 0, statusCodes: [], evidenceSource: 'page-dom', integrity: 'page-controlled', attributionConfidence: 'unknown', initiatorHost: null, script: null };
        const key = rowKey(row), prior = rows.get(key);
        if (prior) { prior.count = Math.min(2147483647, prior.count + 1); continue; }
        const cost = 256 + JSON.stringify(row).length * 2;
        if (rows.size >= 64 || bytes + cost > 65536) { truncated = true; continue; }
        rows.set(key, row); bytes += cost;
      } catch { truncated = true; }
    }
  };
  const connect = () => {
    if (observer || !enabled) return;
    try { observer = env.observe(record, !started); started = true; }
    catch { truncated = true; if (!fallbackRead) { fallbackRead = true; record(env.entries()); } }
  };
  const reset = () => { rows = new Map(); bytes = 256; truncated = false; cutoff = env.now(); fallbackRead = false; };
  connect();
  env.onCommand((trusted, message, respond) => {
    if (!trusted || !message || typeof message !== 'object') return false;
    const type = own(message, 'type');
    if (type === 'bridge-control' && ['pause', 'stop', 'resume'].includes(own(message, 'command'))) {
      reset(); enabled = own(message, 'command') === 'resume';
      if (!enabled) { observer?.disconnect(); observer = null; } else connect(); return false;
    }
    if (Reflect.ownKeys(message).length !== 2 || own(message, 'schemaVersion') !== 1 || !['beacon-timing-query', 'beacon-timing-reset'].includes(type)) return false;
    if (type === 'beacon-timing-reset') { reset(); respond({ schemaVersion: 1, type: 'beacon-timing-reset-ack' }); return false; }
    if (!enabled) { respond({ schemaVersion: 1, type: 'beacon-timing-cache', available: false, rows: [], truncated: true }); return false; }
    connect(); if (observer?.takeRecords) record(observer.takeRecords());
    respond({ schemaVersion: 1, type: 'beacon-timing-cache', available: true, rows: [...rows.values()], truncated }); return false;
  });
  env.onHide(() => { observer?.disconnect(); observer = null; });
  env.onRestore(() => connect());
  env.onBufferFull(() => { truncated = true; });
}
