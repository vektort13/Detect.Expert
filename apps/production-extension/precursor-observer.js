// DET-CF-PRECURSOR-001 / REQ-005/008/009/011/012, ADR-009/073/074: passive browser evidence only.
import { PRECURSOR_RULE_IDS, readPrecursorRequest, readPrecursorSnapshot } from './precursor-contracts.js';
import { readPrecursorTimingCache } from './precursor-timing.js';

export const PRECURSOR_LIMITS = Object.freeze({ maxDocuments: 128, ttlMs: 600000, maxUrlLength: 16384, maxPhysical: 4, timeoutMs: 1500, maxHeaders: 256 });
// ADR-074 review: runtime confirmation and observations of the Precursor zone modes.
// Independent delivery/reviewer evidence validates the resource shape, never the zone's configuration.
export const PRECURSOR_POLICY = Object.freeze({ enabled: true, stage: 'production-approved', reviewDueAt: 1801094400000 }); // 2027-01-28T00:00:00Z
const CANDIDATE_RULE_IDS = Object.freeze(['precursor-loader-candidate-v1', 'precursor-versioned-loader-candidate-v1']);
const own = (value, key) => value !== null && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const blocked = state => ['paused', 'unsupported', 'no-access'].includes(state);

function safeUrl(raw, fragmentAllowed = false) {
  if (typeof raw !== 'string' || raw.length > PRECURSOR_LIMITS.maxUrlLength || !raw.startsWith('https://') || /[\\\u0000-\u0020\u007f]/.test(raw)) return null;
  try { const url = new URL(raw); return url.protocol === 'https:' && !url.username && !url.password && url.hostname && (fragmentAllowed || !url.hash) ? url : null; }
  catch { return null; }
}
/** A path-shape candidate, never a statement that the site uses Cloudflare. */
export function classifyPrecursorCandidate(raw) {
  const url = safeUrl(raw);
  if (!url) return null;
  if (url.pathname === '/cdn-cgi/challenge-platform/scripts/precursor/main.js') return CANDIDATE_RULE_IDS[0];
  return /^\/cdn-cgi\/challenge-platform\/h\/[bg]\/scripts\/precursor\/[A-Za-z0-9_-]{1,64}\/main\.js$/.test(url.pathname) ? CANDIDATE_RULE_IDS[1] : null;
}
/** Runtime-verified resource shape; successful loading still does not attest vendor configuration. */
export function classifyPrecursorResource(raw) {
  const url = safeUrl(raw);
  return url && /^\/cdn-cgi\/challenge-platform\/h\/g\/scripts\/precursor\/[a-f0-9]{12}\/main\.js$/.test(url.pathname) ? PRECURSOR_RULE_IDS[0] : null;
}
/** Only the Content-Type value is examined; unrelated response header values are never read. */
export function precursorJavaScriptResponse(headers) {
  try {
    const length = own(headers, 'length');
    if (!Array.isArray(headers) || !integer(length) || length > PRECURSOR_LIMITS.maxHeaders) return false;
    let found = false;
    for (let index = 0; index < length; ++index) {
      const header = own(headers, String(index)), name = own(header, 'name');
      if (typeof name !== 'string' || name.length > 256) return false;
      if (name.toLowerCase() !== 'content-type') continue;
      if (found) return false;
      const value = own(header, 'value');
      if (typeof value !== 'string' || value.length > 256 || /[\r\n\u0000]/.test(value) || !['application/javascript', 'text/javascript'].includes(value.split(';', 1)[0].trim().toLowerCase())) return false;
      found = true;
    }
    return found;
  } catch { return false; }
}

export class PrecursorObserver {
  constructor(runtime, options = {}) {
    this.runtime = runtime;
    const policy = own(options, 'policy') ?? PRECURSOR_POLICY;
    // Copy only bounded policy primitives; later caller mutation cannot enable a candidate.
    this.policy = Object.freeze({ enabled: own(policy, 'enabled') === true, stage: own(policy, 'stage') === 'production-approved' ? 'production-approved' : 'documented-candidate', reviewDueAt: integer(own(policy, 'reviewDueAt')) ? own(policy, 'reviewDueAt') : null });
    try { this.timingSessionId = crypto.randomUUID().replaceAll('-', ''); } catch { this.timingSessionId = null; }
  }
  documents = new Map();
  pending = new Map();
  physical = new Set();
  // Commit tokens stay outside the metadata records and cannot be serialized into a snapshot.
  identities = new WeakMap();
  epoch = 0;
  limited = false;
  timingResets = new Map();
  timingResetSerial = 0;
  timingResetOverflow = false;
  enabled(now = this.runtime.now()) {
    return integer(now) && this.policy.enabled && this.policy.stage === 'production-approved' && this.policy.reviewDueAt !== null && now < this.policy.reviewDueAt;
  }
  networkSupported() { return this.runtime.api?.__detectExpertCapabilities?.networkDocumentIdentity !== false && typeof this.runtime.api?.webNavigation?.getFrame === 'function'; }
  timingSupported() { return !this.timingResetOverflow && id(this.timingSessionId) && this.runtime.api?.__detectExpertCapabilities?.networkDocumentIdentity === false && typeof this.runtime.api?.tabs?.sendMessage === 'function'; }
  supported() { return this.networkSupported() || this.timingSupported(); }
  binding(key) {
    const binding = this.runtime.state.bindings.get(key.slice(0, key.lastIndexOf(':')));
    return binding?.documentKey === key && (binding.documentLifecycle == null || binding.documentLifecycle === 'active') ? binding : null;
  }
  rememberIdentity(record, key) {
    const binding = this.binding(key);
    // Native onCommitted supplies boundAt. Preserve identity across harmless binding metadata copies.
    // The reference fallback supports older isolated fixtures which have no commit timestamp.
    this.identities.set(record, binding && integer(binding.boundAt) ? { documentKey: key, boundAt: binding.boundAt } :
      binding && binding.boundAt === undefined ? { binding } : null);
  }
  sameIdentity(record, key) {
    const token = this.identities.get(record), binding = this.binding(key);
    if (!token || !binding) return false;
    return token.binding !== undefined ? token.binding === binding : integer(binding.boundAt) && token.documentKey === binding.documentKey && token.boundAt === binding.boundAt;
  }
  allowed(key) {
    const runtime = this.runtime;
    return runtime.isReady === true && runtime.scope.hasDataConsent === true && runtime.scope.accessReady === true &&
      integer(runtime.scope.accessGeneration) && this.supported() && this.binding(key) !== null && runtime.canObserveNetworkDocument(key);
  }
  markTimingReset(key) {
    if (!this.timingSupported()) return;
    if (!this.timingResets.has(key) && this.timingResets.size >= 1024 || this.timingResetSerial >= 2147483647) { this.timingResetOverflow = true; this.limited = true; return; }
    this.timingResets.set(key, this.timingSessionId + '_' + ++this.timingResetSerial);
  }
  clear() {
    ++this.epoch; this.documents.clear(); this.limited = false;
    for (const binding of this.runtime.state?.bindings?.values() ?? []) this.markTimingReset(binding.documentKey);
    for (const operation of this.pending.values()) operation.invalid = true;
  }
  forget(key, reason) {
    this.documents.delete(key); const operation = this.pending.get(key); if (operation) operation.invalid = true;
    // The native onCommitted listener also calls this for a never-observed new document.
    // Its fresh document_start collector needs its buffered evidence, not a clear fence.
    if (reason !== 'navigation') this.markTimingReset(key);
  }
  clearTab(tabId) {
    if (!integer(tabId)) return;
    const prefix = tabId + ':';
    for (const key of this.documents.keys()) if (key.startsWith(prefix)) this.documents.delete(key);
    for (const key of this.timingResets.keys()) if (key.startsWith(prefix)) this.timingResets.delete(key);
    for (const [key, operation] of this.pending) if (key.startsWith(prefix)) operation.invalid = true;
  }
  prune() {
    const now = this.runtime.now();
    if (!this.enabled(now)) { this.clear(); return; }
    for (const [key, entry] of this.documents) if (!this.allowed(key) || !this.sameIdentity(entry, key) || entry.generation !== this.runtime.scope.accessGeneration || now < entry.at || now - entry.at >= PRECURSOR_LIMITS.ttlMs) this.documents.delete(key);
    for (const [key, operation] of this.pending) if (!this.allowed(key) || operation.generation !== this.runtime.scope.accessGeneration || !this.sameIdentity(operation, key)) operation.invalid = true;
  }
  /** Called only from the existing browser webRequest completion listener. */
  observe(details, phase = 'completed') {
    try {
      this.prune();
      if (phase !== 'completed' || !this.enabled() || !this.networkSupported()) return false;
      const tabId = own(details, 'tabId'), frameId = own(details, 'frameId'), documentId = own(details, 'documentId'), lifecycle = own(details, 'documentLifecycle');
      const status = own(details, 'statusCode');
      if (!integer(tabId) || !integer(frameId) || !id(documentId) || lifecycle != null && lifecycle !== 'active' || own(details, 'type') !== 'script' ||
        !Number.isInteger(status) || !(status >= 200 && status <= 299 || status === 304)) return false;
      const key = `${tabId}:${frameId}:${documentId}`;
      if (!this.allowed(key)) return false;
      const raw = own(details, 'url'), ruleId = classifyPrecursorResource(raw);
      if (ruleId === null || !precursorJavaScriptResponse(own(details, 'responseHeaders'))) return false;
      const target = safeUrl(raw), initiator = safeUrl(own(details, 'initiator'));
      // These candidate paths are first-party deployment hypotheses, not a shared-CDN rule.
      if (!target || !initiator || target.origin !== initiator.origin ||
        !this.runtime.scope.isHostGrantedSync(target.hostname, 'https') || !this.runtime.scope.isHostGrantedSync(initiator.hostname, 'https')) return false;
      // Do not retain details, URL, headers, query or path across the asynchronous native identity lookup.
      return this.confirm({ key, tabId, frameId, documentId, origin: target.origin, ruleId,
        generation: this.runtime.scope.accessGeneration, epoch: this.epoch, startedAt: this.runtime.now(), invalid: false });
    } catch { return false; }
  }
  async confirm(operation) {
    const { key } = operation;
    if (this.pending.has(key)) return false;
    if (this.physical.size >= PRECURSOR_LIMITS.maxPhysical) { this.limited = true; return false; }
    this.rememberIdentity(operation, key);
    const current = () => !operation.invalid && operation.epoch === this.epoch && operation.generation === this.runtime.scope.accessGeneration &&
      this.sameIdentity(operation, key) && this.runtime.now() >= operation.startedAt && this.runtime.now() - operation.startedAt < PRECURSOR_LIMITS.timeoutMs && this.enabled() && this.allowed(key);
    if (!current()) return false;
    this.pending.set(key, operation);
    const job = Promise.resolve().then(() => current() ? this.runtime.api.webNavigation.getFrame({ tabId: operation.tabId, frameId: operation.frameId, documentId: operation.documentId }) : null);
    this.physical.add(job);
    const release = () => { this.physical.delete(job); if (this.pending.get(key) === operation) this.pending.delete(key); };
    job.then(release, release);
    let timer;
    try {
      const frame = await Promise.race([job, new Promise(resolve => { timer = setTimeout(() => { operation.invalid = true; this.limited = true; resolve(null); }, PRECURSOR_LIMITS.timeoutMs); })]);
      if (!current() || own(frame, 'documentId') !== operation.documentId || own(frame, 'documentLifecycle') !== 'active' || own(frame, 'errorOccurred') === true ||
        own(frame, 'frameId') !== undefined && own(frame, 'frameId') !== operation.frameId) return false;
      const frameUrl = safeUrl(own(frame, 'url'), true);
      if (!frameUrl || frameUrl.origin !== operation.origin || !this.runtime.scope.isHostGrantedSync(frameUrl.hostname, 'https')) return false;
      const now = this.runtime.now();
      if (!current()) return false;
      this.prune();
      let entry = this.documents.get(key);
      if (!entry) {
        if (this.documents.size >= PRECURSOR_LIMITS.maxDocuments) { this.limited = true; return false; }
        entry = { generation: this.runtime.scope.accessGeneration, at: now, ruleIds: [] };
        this.documents.set(key, entry);
        this.rememberIdentity(entry, key);
      }
      entry.at = now;
      if (!entry.ruleIds.includes(operation.ruleId)) entry.ruleIds.push(operation.ruleId);
      return true;
    } catch { return false; }
    finally { clearTimeout(timer); }
  }
  snapshot(key) {
    this.prune();
    const binding = this.binding(key), projection = binding ? this.runtime.getProjection(binding.tabId, binding.frameId) : null;
    const current = projection?.documentKey === key;
    let coverageState = current ? projection.coverageState : 'no-access';
    if (!['active', 'partial', 'late-start', 'paused', 'unsupported', 'no-access', 'degraded'].includes(coverageState)) coverageState = 'no-access';
    if (!this.allowed(key) && !blocked(coverageState)) coverageState = this.supported() ? 'no-access' : 'unsupported';
    let presenceDetection = current && !blocked(coverageState) && this.enabled() && this.allowed(key);
    const entry = presenceDetection ? this.documents.get(key) : null;
    if (presenceDetection && this.timingSupported()) {
      if (entry?.available === false) { coverageState = entry.failure ? 'degraded' : 'unsupported'; presenceDetection = false; }
      else coverageState = 'partial';
    }
    const observed = presenceDetection && entry?.ruleIds.length > 0;
    return readPrecursorSnapshot({ schemaVersion: 1, type: 'precursor-state', documentKey: key, coverageState,
      presence: observed ? 'observed' : 'not-observed', mode: 'unknown', lastObservedAt: observed ? entry.at : null,
      ruleIds: observed ? entry.ruleIds.slice() : [], evidenceSource: observed ? entry.source ?? 'browser-network' : null, integrity: observed ? 'browser-observed' : null,
      capabilities: { presenceDetection, modeDetection: false }, truncated: presenceDetection && (this.limited || entry?.truncated === true) });
  }
  async timingRequest(operation, message) {
    if (!operation.current() || this.physical.size >= PRECURSOR_LIMITS.maxPhysical) throw Error('precursor-capacity');
    const job = Promise.resolve().then(() => operation.current() ? this.runtime.api.tabs.sendMessage(operation.tabId, message, { frameId: operation.frameId, documentId: operation.documentId }) : null);
    this.physical.add(job); ++operation.jobs;
    const release = () => { this.physical.delete(job); --operation.jobs; if (operation.finished && !operation.jobs && this.pending.get(operation.key) === operation) this.pending.delete(operation.key); };
    job.then(release, release);
    let timer;
    try { return await Promise.race([job, new Promise((_, reject) => { timer = setTimeout(() => { operation.invalid = true; this.limited = true; reject(Error('precursor-timeout')); }, Math.max(1, PRECURSOR_LIMITS.timeoutMs - (this.runtime.now() - operation.startedAt))); })]); }
    finally { clearTimeout(timer); }
  }
  async readTiming(request) {
    this.prune();
    const key = request.documentKey;
    if (!this.enabled() || !this.allowed(key)) return this.snapshot(key);
    if (this.pending.has(key) || this.physical.size >= PRECURSOR_LIMITS.maxPhysical) { this.limited = true; return this.snapshot(key); }
    const operation = { key, tabId: request.tabId, frameId: request.frameId, documentId: key.slice(key.lastIndexOf(':') + 1),
      epoch: this.epoch, generation: this.runtime.scope.accessGeneration, startedAt: this.runtime.now(), invalid: false, jobs: 0, finished: false };
    this.rememberIdentity(operation, key);
    operation.current = () => !operation.invalid && this.epoch === operation.epoch && operation.generation === this.runtime.scope.accessGeneration &&
      this.runtime.now() >= operation.startedAt && this.runtime.now() - operation.startedAt < PRECURSOR_LIMITS.timeoutMs && this.sameIdentity(operation, key) &&
      this.enabled() && this.allowed(key) && this.runtime.getProjection(request.tabId, request.frameId)?.documentKey === key;
    const store = (cache, failure = false) => {
      if (!operation.current()) return;
      if (!this.documents.has(key) && this.documents.size >= PRECURSOR_LIMITS.maxDocuments) { this.limited = true; return; }
      const previous = this.documents.get(key), at = previous?.source === 'browser-resource-timing' && previous.producerRevision === cache.revision && previous.ruleIds.length && cache.ruleIds.length ? previous.at : this.runtime.now();
      const entry = { generation: operation.generation, at, ruleIds: cache.ruleIds.slice(), available: cache.available, truncated: cache.truncated,
        producerRevision: cache.revision, source: 'browser-resource-timing', failure };
      this.documents.set(key, entry); this.rememberIdentity(entry, key);
    };
    this.pending.set(key, operation);
    try {
      const resetId = this.timingResets.get(key);
      if (resetId) {
        const reset = await this.timingRequest(operation, { schemaVersion: 1, type: 'precursor-timing-reset', resetId });
        if (!operation.current() || own(reset, 'schemaVersion') !== 1 || own(reset, 'type') !== 'precursor-timing-reset-ack' || own(reset, 'resetId') !== resetId || Reflect.ownKeys(reset).length !== 3) throw Error('precursor-reset');
        if (this.timingResets.get(key) === resetId) this.timingResets.delete(key);
      }
      const raw = await this.timingRequest(operation, { schemaVersion: 1, type: 'precursor-timing-query', sessionId: this.timingSessionId });
      const cache = readPrecursorTimingCache(raw);
      if (!cache) throw Error('precursor-timing-invalid');
      store(cache);
    } catch {
      store({ available: false, ruleIds: [], revision: 0, truncated: true }, true);
    } finally {
      operation.finished = true;
      if (!operation.jobs && this.pending.get(key) === operation) this.pending.delete(key);
    }
    return this.snapshot(key);
  }
  /** The caller must verify the existing privileged UI sender before routing. */
  read(value) {
    const request = readPrecursorRequest(value);
    return request ? this.timingSupported() ? this.readTiming(request) : this.snapshot(request.documentKey) : null;
  }
}
