// ADR-029 / REQ-001/004/005/009/011/012: current-root passive resource inventory.
import { readThirdPartySnapshot, readThirdPartyTiming, thirdPartyPathTemplate, THIRD_PARTY_RESOURCE_TYPES } from './third-party-contracts.js';

const MAX_DOCUMENTS = 32, MAX_DOCUMENT_BYTES = 100 * 1024, MAX_BYTES = 1024 * 1024;
const MAX_ROWS = 256, MAX_VIEW_ROWS = 1024, MAX_VIEW_DOCUMENTS = 24, MAX_PENDING = 512, TTL = 600000;
const own = (value, key) => value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const saturate = (value, delta = 1) => Math.min(2147483647, value + delta);
const rowKey = row => [row.domain, row.pathTemplate, row.type, row.initiatorHost ?? ''].join('|');
const live = frame => frame.documentLifecycle == null || frame.documentLifecycle === 'active';

export class ThirdPartyObserver {
  constructor(runtime, helpers) { this.runtime = runtime; this.helpers = helpers; }
  documents = new Map();
  pending = new Map();
  operations = new Set();
  physical = new Set();
  resets = new Set();
  epoch = 0;
  bytes = 0;
  limited = false;
  lastPruneAt = -Infinity;
  indexedBindings = null;
  parentIndex = new Map();
  binding(key) {
    const binding = this.runtime.state.bindings.get(key.slice(0, key.lastIndexOf(':')));
    return binding?.documentKey === key ? binding : null;
  }
  root(key) {
    const state = this.runtime.state;
    let current = this.binding(key);
    if (!current || !this.runtime.canObserveNetworkDocument(key)) return null;
    const top = state.tabs.get(current.tabId)?.activeTopDocumentKey;
    if (current.documentKey === top && current.frameId === 0) return current;
    if (this.indexedBindings !== state.bindings) {
      this.indexedBindings = state.bindings; this.parentIndex = new Map();
      for (const binding of state.bindings.values()) this.parentIndex.set(binding.tabId + ':' + binding.documentId, binding);
    }
    for (let depth = 0; current && depth < 128; ++depth) {
      if (current.documentKey === top && current.frameId === 0 && this.runtime.canObserveNetworkDocument(top)) return current;
      current = this.parentIndex.get(current.tabId + ':' + current.parentDocumentId);
      if (current && !live(current)) return null;
    }
    return null;
  }
  currentDocuments(rootKey) {
    return [...this.runtime.state.bindings.values()].filter(binding => this.root(binding.documentKey)?.documentKey === rootKey);
  }
  remove(key) {
    const prior = this.documents.get(key);
    if (prior) this.bytes -= prior.bytes;
    this.documents.delete(key);
    for (const [requestId, pending] of this.pending) if (pending.documentKey === key) this.pending.delete(requestId);
  }
  clear() {
    ++this.epoch;
    for (const operation of this.operations) operation.invalid = true;
    for (const binding of this.runtime.state.bindings.values()) if (this.resets.size < 128) this.resets.add(binding.documentKey);
    this.documents.clear(); this.pending.clear(); this.bytes = 0; this.limited = false;
  }
  forget(key) {
    ++this.epoch;
    for (const operation of this.operations) operation.invalid = true;
    const keys = [key, ...this.currentDocuments(key).map(binding => binding.documentKey)];
    for (const source of keys) { this.remove(source); if (this.resets.size < 128) this.resets.add(source); }
  }
  prune(force = false) {
    const now = this.runtime.now();
    if (!force && now >= this.lastPruneAt && now - this.lastPruneAt < 1000) return;
    this.lastPruneAt = now;
    for (const [key, entry] of this.documents) if (entry.generation !== this.runtime.scope.accessGeneration || now < entry.at || now - entry.at >= TTL || !this.root(key)) this.remove(key);
    for (const [requestId, pending] of this.pending) if (pending.generation !== this.runtime.scope.accessGeneration || now < pending.at || now - pending.at >= 30000) this.pending.delete(requestId);
    if (this.resets.size > 64) for (const key of this.resets) if (![...this.runtime.state.bindings.values()].some(binding => binding.documentKey === key)) this.resets.delete(key);
  }
  entry(key, root) {
    let entry = this.documents.get(key);
    if (!entry) {
      if (this.documents.size >= MAX_DOCUMENTS) { this.remove(this.documents.keys().next().value); this.limited = true; }
      entry = { rootKey: root.documentKey, source: null, stickyTiming: false, rows: new Map(), bytes: 256, truncated: false, generation: this.runtime.scope.accessGeneration, at: this.runtime.now() };
      this.documents.set(key, entry); this.bytes += entry.bytes;
    }
    entry.at = this.runtime.now(); return entry;
  }
  domain(host) {
    const result = this.helpers.redact(host);
    return result?.kind === 'registrable' ? result.value : ((result?.kind === 'unknown' ? 'unknown' : result?.value ?? 'unknown').toLowerCase() + '.invalid');
  }
  regular(host) {
    const result = this.helpers.redact(host);
    return result?.kind === 'registrable' ? result.value : null;
  }
  target(raw, root) {
    if (typeof raw !== 'string' || raw.length > 16384) return null;
    try {
      const url = new URL(raw);
      if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return null;
      const host = this.helpers.host(raw);
      if (!host || !this.runtime.scope.isHostGrantedSync(host, url.protocol.slice(0, -1))) return null;
      const domain = this.domain(host), topDomain = this.regular(root.host);
      if (topDomain && domain === topDomain) return null;
      const pathTemplate = thirdPartyPathTemplate(url.pathname);
      if (pathTemplate === null || pathTemplate.length > 512) return null;
      return { domain, pathTemplate, relation: topDomain && !domain.endsWith('.invalid') ? 'cross-site' : 'unknown' };
    } catch { return null; }
  }
  row(key, root, target, type, source, initiatorHost) {
    const binding = this.binding(key);
    return { ...target, type, requestCount: 0, completedCount: 0, failedCount: 0, redirectCount: 0, statusCodes: [],
      documentKey: key, documentHost: binding?.host ? this.regular(binding.host) : null, initiatorHost,
      evidenceSource: source, integrity: source === 'browser-network' ? 'browser-observed' : 'page-controlled',
      attributionConfidence: initiatorHost ? 'frame-only' : 'unknown', script: null };
  }
  admit(entry, row) {
    const key = rowKey(row), prior = entry.rows.get(key);
    if (prior) return prior;
    const bytes = 256 + JSON.stringify(row).length * 2;
    if (entry.rows.size >= MAX_ROWS || entry.bytes + bytes > MAX_DOCUMENT_BYTES || this.bytes + bytes > MAX_BYTES) { entry.truncated = true; this.limited = true; return null; }
    entry.rows.set(key, row); entry.bytes += bytes; this.bytes += bytes; return row;
  }
  observe(details, phase = 'before') {
    const runtime = this.runtime;
    if (!runtime.isReady || !runtime.scope.hasDataConsent || !runtime.scope.accessReady || !runtime.scope.hasAnyHostAccess() || runtime.api.__detectExpertCapabilities?.networkDocumentIdentity === false) return;
    const tabId = own(details, 'tabId'), type = own(details, 'type'), lifecycle = own(details, 'documentLifecycle');
    if (!integer(tabId) || !THIRD_PARTY_RESOURCE_TYPES.includes(type) || lifecycle && lifecycle !== 'active' || !['before', 'completed', 'error', 'redirect'].includes(phase)) return;
    const parent = type === 'sub_frame' && id(own(details, 'parentDocumentId')) && integer(own(details, 'parentFrameId'));
    const frameId = parent ? own(details, 'parentFrameId') : own(details, 'frameId'), documentId = parent ? own(details, 'parentDocumentId') : own(details, 'documentId');
    const requestId = own(details, 'requestId');
    if (!integer(frameId) || !id(documentId) || typeof requestId !== 'string' || !/^[a-z0-9_.:-]{1,128}$/i.test(requestId)) return;
    this.prune();
    const key = `${tabId}:${frameId}:${documentId}`, root = this.root(key);
    if (!root) return;
    // A document recovered from its existing timing buffer keeps that source
    // until clear/navigation; a later native pixel must not erase its history.
    if (this.documents.get(key)?.source === 'page-dom') {
      if (this.documents.get(key).stickyTiming) return;
      this.remove(key);
    }
    const target = this.target(own(details, 'url'), root);
    if (!target) return;
    const rawInitiator = own(details, 'initiator'), initiator = this.helpers.host(rawInitiator);
    const scheme = typeof rawInitiator === 'string' && rawInitiator.startsWith('https://') ? 'https' : typeof rawInitiator === 'string' && rawInitiator.startsWith('http://') ? 'http' : null;
    const missingInitiator = rawInitiator === undefined || rawInitiator === null || rawInitiator === '' || rawInitiator === 'null';
    if (!missingInitiator && (!initiator || !scheme || !runtime.scope.isHostGrantedSync(initiator, scheme))) return;
    const entry = this.entry(key, root), incoming = this.row(key, root, target, type, 'browser-network', this.regular(initiator));
    entry.source = 'browser-network';
    const row = this.admit(entry, incoming);
    if (!row) return;
    const pending = this.pending.get(requestId), same = pending?.documentKey === key && pending.rowKey === rowKey(row) && pending.generation === runtime.scope.accessGeneration;
    if (phase === 'before') {
      if (same) return;
      row.requestCount = saturate(row.requestCount);
      if (this.pending.size >= MAX_PENDING) { entry.truncated = true; this.limited = true; return; }
      this.pending.set(requestId, { documentKey: key, rowKey: rowKey(row), at: runtime.now(), generation: runtime.scope.accessGeneration });
      return;
    }
    if (phase === 'completed') row.completedCount = saturate(row.completedCount);
    if (phase === 'error') row.failedCount = saturate(row.failedCount);
    if (phase === 'redirect') row.redirectCount = saturate(row.redirectCount);
    // Missing/evicted before records cannot be counted a second time on completion.
    // Terminal-only evidence establishes this conservative lower bound.
    if (!same) row.requestCount = Math.max(row.requestCount, Math.min(2147483647, row.completedCount + row.failedCount + row.redirectCount));
    const status = own(details, 'statusCode');
    if (Number.isSafeInteger(status) && status >= 100 && status <= 599 && !row.statusCodes.includes(status)) {
      if (row.statusCodes.length < 16) row.statusCodes.push(status);
      else entry.truncated = true;
    }
    this.pending.delete(requestId);
  }
  snapshot(rootKey, coverageState = 'partial', sourceKeys = null, truncated = false) {
    this.prune(true);
    const rows = [], keys = sourceKeys ?? this.currentDocuments(rootKey).map(binding => binding.documentKey);
    if (!['no-access', 'paused', 'unsupported'].includes(coverageState)) for (const key of keys.slice(0, MAX_VIEW_DOCUMENTS)) {
      const entry = this.documents.get(key);
      if (!entry || entry.rootKey !== rootKey) continue;
      truncated ||= entry.truncated;
      for (const row of entry.rows.values()) {
        if (rows.length >= MAX_VIEW_ROWS) { truncated = true; break; }
        rows.push({ ...row, statusCodes: row.statusCodes.slice() });
      }
    }
    return readThirdPartySnapshot({ schemaVersion: 1, type: 'third-party-state', documentKey: rootKey, coverageState, rows, truncated: this.limited || truncated || keys.length > MAX_VIEW_DOCUMENTS });
  }
  async bounded(operation, deadline) {
    if (this.physical.size >= 2 || this.runtime.now() >= deadline) throw Error('third-party-operation-limit');
    const job = Promise.resolve().then(operation); this.physical.add(job);
    job.then(() => this.physical.delete(job), () => this.physical.delete(job));
    let timer;
    try { return await Promise.race([job, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('third-party-operation-timeout')), Math.max(1, Math.min(1500, deadline - this.runtime.now()))); })]); }
    finally { clearTimeout(timer); }
  }
  async read(request) {
    const runtime = this.runtime; await runtime.whenReady();
    if (this.operations.size >= 2) return this.snapshot(request.documentKey, 'no-access');
    const epoch = this.epoch, generation = runtime.scope.accessGeneration, deadline = runtime.now() + 5000;
    const operation = { invalid: false }; this.operations.add(operation);
    const current = () => !operation.invalid && epoch === this.epoch && generation === runtime.scope.accessGeneration && runtime.scope.hasDataConsent && runtime.getProjection(request.tabId, 0)?.documentKey === request.documentKey && this.root(request.documentKey)?.documentKey === request.documentKey;
    try {
      if (!current() || !await this.bounded(() => runtime.apiResults.authorize(request, operation), deadline) || !current()) return this.snapshot(request.documentKey, 'no-access');
      const frames = await this.bounded(() => runtime.api.webNavigation.getAllFrames({ tabId: request.tabId }), deadline);
      if (!current() || !Array.isArray(frames) || frames.length > 1024) return this.snapshot(request.documentKey, 'no-access');
      let sources = this.currentDocuments(request.documentKey).filter(binding => frames.some(frame => frame.frameId === binding.frameId && frame.documentId === binding.documentId && live(frame) && !frame.errorOccurred));
      let truncated = sources.length > MAX_VIEW_DOCUMENTS;
      const timingSources = sources.slice(0, MAX_VIEW_DOCUMENTS).filter(binding => runtime.api.__detectExpertCapabilities?.networkDocumentIdentity === false || this.documents.get(binding.documentKey)?.source !== 'browser-network');
      if (timingSources.length) {
        const selected = timingSources; let next = 0;
        const readNext = async () => {
          while (next < selected.length && current()) {
            const binding = selected[next++];
            try {
              if (this.resets.has(binding.documentKey)) {
                const reset = await this.bounded(() => runtime.api.tabs.sendMessage(request.tabId, { schemaVersion: 1, type: 'third-party-timing-reset' }, { frameId: binding.frameId, documentId: binding.documentId }), deadline);
                if (own(reset, 'schemaVersion') !== 1 || own(reset, 'type') !== 'third-party-timing-reset-ack' || !current()) throw Error('timing-reset-failed');
                this.resets.delete(binding.documentKey);
              }
              const raw = await this.bounded(() => runtime.api.tabs.sendMessage(request.tabId, { schemaVersion: 1, type: 'third-party-timing-query' }, { frameId: binding.frameId, documentId: binding.documentId }), deadline);
              if (!current() || this.root(binding.documentKey)?.documentKey !== request.documentKey) continue;
              if (this.documents.get(binding.documentKey)?.source === 'browser-network') continue;
              const cache = readThirdPartyTiming(raw);
              this.remove(binding.documentKey);
              if (!cache?.available) { truncated = true; continue; }
              const root = this.root(request.documentKey), entry = this.entry(binding.documentKey, root);
              entry.truncated ||= cache.truncated;
              const topDomain = this.regular(root.host);
              for (const timing of cache.rows) {
                const domain = this.domain(timing.domain);
                if (topDomain && domain === topDomain) continue;
                const target = { domain, pathTemplate: timing.pathTemplate, relation: topDomain && !domain.endsWith('.invalid') ? 'cross-site' : 'unknown' };
                const row = this.row(binding.documentKey, root, target, timing.type, 'page-dom', binding.host ? this.regular(binding.host) : null);
                row.requestCount = timing.requestCount; this.admit(entry, row);
              }
              // An empty or first-party-only buffer does not recover any
              // history and must not disable later authoritative native rows.
              if (entry.rows.size) {
                entry.source = 'page-dom';
                entry.stickyTiming = [...entry.rows.values()].some(row => row.relation === 'cross-site');
              }
              else { truncated ||= entry.truncated; this.remove(binding.documentKey); }
            } catch { if (this.documents.get(binding.documentKey)?.source !== 'browser-network') this.remove(binding.documentKey); truncated = true; }
          }
        };
        await Promise.all([readNext(), readNext()]);
      }
      if (!current() || !await this.bounded(() => runtime.apiResults.authorize(request, operation), deadline) || !current()) return this.snapshot(request.documentKey, 'no-access');
      // The root staying alive does not authenticate a child reply. Validate
      // every source identity after all asynchronous Firefox/Chrome reads.
      const finalFrames = await this.bounded(() => runtime.api.webNavigation.getAllFrames({ tabId: request.tabId }), deadline);
      if (!current() || !Array.isArray(finalFrames) || finalFrames.length > 1024 || !finalFrames.some(frame => frame.frameId === 0 && frame.documentId === this.binding(request.documentKey)?.documentId && live(frame) && !frame.errorOccurred)) return this.snapshot(request.documentKey, 'no-access');
      sources = sources.filter(binding => {
        const valid = this.root(binding.documentKey)?.documentKey === request.documentKey && finalFrames.some(frame => frame.frameId === binding.frameId && frame.documentId === binding.documentId && live(frame) && !frame.errorOccurred);
        if (!valid) { this.remove(binding.documentKey); truncated = true; }
        return valid;
      });
      return this.snapshot(request.documentKey, 'partial', sources.map(binding => binding.documentKey), truncated);
    } catch { return this.snapshot(request.documentKey, 'no-access'); }
    finally { operation.invalid = true; this.operations.delete(operation); }
  }
}

// Runs only in the extension-owned ISOLATED realm. No raw resource URL crosses the bridge.
export function startThirdPartyTimingBridge(env) {
  const own = (value, key) => value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
  let rows = new Map(), bytes = 256, truncated = false, cutoff = -Infinity, observer = null, enabled = true, started = false, fallbackRead = false;
  const types = new Map([['script', 'script'], ['img', 'image'], ['image', 'image'], ['iframe', 'sub_frame'], ['css', 'stylesheet'], ['fetch', 'xmlhttprequest'], ['xmlhttprequest', 'xmlhttprequest'], ['beacon', 'ping'], ['audio', 'media'], ['video', 'media'], ['object', 'object']]);
  const type = (value, path) => value === 'link' ? path.endsWith('.css') ? 'stylesheet' : /\.(?:woff2?|ttf)$/.test(path) ? 'font' : 'other' : (types.get(value) ?? 'other');
  const record = entries => {
    if (!enabled) return;
    if (!Array.isArray(entries) || entries.length > 2048) { truncated = true; return; }
    for (const entry of entries) {
      try {
        const raw = env.name(entry), start = env.start(entry), kind = env.initiator(entry);
        if (typeof raw !== 'string' || raw.length > 16384 || typeof start !== 'number' || start < cutoff) continue;
        const url = new URL(raw);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
        const redacted = env.redact(url.hostname), domain = redacted.kind === 'registrable' ? redacted.value : ((redacted.kind === 'unknown' ? 'unknown' : redacted.value).toLowerCase() + '.invalid');
        const pathTemplate = env.path(url.pathname);
        if (!pathTemplate || pathTemplate.length > 512) { truncated = true; continue; }
        const row = { domain, pathTemplate, type: type(kind, pathTemplate), requestCount: 1 }, key = domain + '|' + pathTemplate + '|' + row.type, prior = rows.get(key);
        if (prior) { prior.requestCount = Math.min(2147483647, prior.requestCount + 1); continue; }
        const cost = 128 + JSON.stringify(row).length * 2;
        if (rows.size >= 256 || bytes + cost > 65536) { truncated = true; continue; }
        rows.set(key, row); bytes += cost;
      } catch { truncated = true; }
    }
  };
  const connect = () => {
    if (observer || !enabled) return;
    try { observer = env.observe(record, !started); started = true; }
    catch {
      truncated = true;
      // A missing native observer provides one bounded buffer snapshot, not a
      // fresh copy of the same requests on every popup refresh.
      if (!fallbackRead) { fallbackRead = true; record(env.entries()); }
    }
  };
  const reset = () => { rows = new Map(); bytes = 256; truncated = false; cutoff = env.now(); fallbackRead = false; };
  const empty = () => ({ schemaVersion: 1, type: 'third-party-timing-cache', available: false, rows: [], truncated: true });
  connect();
  env.onCommand((trusted, message, respond) => {
    if (!trusted || !message || typeof message !== 'object') return false;
    const messageType = own(message, 'type');
    if (messageType === 'bridge-control' && ['pause', 'stop', 'resume'].includes(own(message, 'command'))) {
      reset(); enabled = own(message, 'command') === 'resume';
      if (!enabled) { observer?.disconnect(); observer = null; } else connect();
      return false;
    }
    if (Reflect.ownKeys(message).length !== 2 || own(message, 'schemaVersion') !== 1 || !['third-party-timing-query', 'third-party-timing-reset'].includes(messageType)) return false;
    if (messageType === 'third-party-timing-reset') { reset(); respond({ schemaVersion: 1, type: 'third-party-timing-reset-ack' }); return false; }
    if (!enabled) { respond(empty()); return false; }
    connect();
    if (observer?.takeRecords) record(observer.takeRecords());
    respond({ schemaVersion: 1, type: 'third-party-timing-cache', available: true, rows: [...rows.values()].map(row => ({ ...row })), truncated });
    return false;
  });
  env.onHide(() => { observer?.disconnect(); observer = null; });
  env.onRestore(() => connect());
  env.onBufferFull(() => { truncated = true; });
}
