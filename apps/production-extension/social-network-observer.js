// ADR-026/028 / REQ-001/004/005/011/012: bounded, passive social observations.
import { socialNetworkDetector } from './social-network-detector.js';
import { readSocialRows, readSocialSnapshot } from './inspection-contracts.js';

const MAX_DOCUMENTS = 32, MAX_ROWS = 64, MAX_BYTES = 65536, TTL_MS = 600000;
const own = (object, key) => object && typeof object === 'object' ? Object.getOwnPropertyDescriptor(object, key)?.value : undefined;
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const rowKey = row => [row.service, row.kind, row.endpoint, row.method, row.requestType, row.evidenceSource, row.attributionConfidence, row.initiatorHost ?? '', row.script?.host ?? '', row.script?.pathTemplate ?? ''].join('|');

export class SocialNetworkObserver {
  constructor(runtime, helpers) { this.runtime = runtime; this.helpers = helpers; }
  documents = new Map();
  epoch = 0;
  operations = new Set();
  physical = new Set();
  windowAt = -Infinity;
  windowCount = 0;
  limited = false;
  clear() {
    ++this.epoch; this.documents.clear(); this.limited = false;
    for (const operation of this.operations) operation.invalid = true;
    for (const page of this.runtime.pro?.session?.pages ?? []) delete page.socialNetworks;
    this.runtime.pro?.mark();
  }
  forget(key) {
    ++this.epoch; this.documents.delete(key);
    for (const operation of this.operations) operation.invalid = true;
  }
  prune() {
    const runtime = this.runtime, now = runtime.now();
    for (const [key, entry] of this.documents) if (now < entry.at || now - entry.at >= TTL_MS || entry.generation !== runtime.scope.accessGeneration || !runtime.canObserveNetworkDocument(key)) this.documents.delete(key);
  }
  entry(key) {
    this.prune();
    let entry = this.documents.get(key);
    if (!entry) {
      if (this.documents.size >= MAX_DOCUMENTS) {
        this.documents.delete(this.documents.keys().next().value);
        this.limited = true;
      }
      entry = { network: new Map(), page: [], bytes: 512, truncated: false, generation: this.runtime.scope.accessGeneration, at: this.runtime.now(), windowAt: -Infinity, windowCount: 0 };
      this.documents.set(key, entry);
    }
    entry.at = this.runtime.now(); return entry;
  }
  redact(host) {
    const result = this.helpers.redact(host);
    return result?.kind === 'registrable' ? result.value : null;
  }
  observe(details) {
    const runtime = this.runtime;
    if (!runtime.isReady || !runtime.scope.hasDataConsent || !runtime.scope.accessReady || !runtime.scope.hasAnyHostAccess()) return;
    const tabId = own(details, 'tabId'), frameId = own(details, 'frameId'), documentId = own(details, 'documentId');
    const type = own(details, 'type'), lifecycle = own(details, 'documentLifecycle'), raw = own(details, 'url');
    if (!integer(tabId) || !integer(frameId) || !id(documentId) || lifecycle && lifecycle !== 'active') return;
    const parentDocumentId = own(details, 'parentDocumentId'), parentFrameId = own(details, 'parentFrameId');
    const parent = type === 'sub_frame' && id(parentDocumentId) && integer(parentFrameId);
    const key = `${tabId}:${parent ? parentFrameId : frameId}:${parent ? parentDocumentId : documentId}`;
    if (!runtime.canObserveNetworkDocument(key)) return;
    const match = socialNetworkDetector.classify(raw, type, own(details, 'method'));
    if (!match) return;
    const host = this.helpers.host(raw);
    if (!host || !runtime.scope.isHostGrantedSync(host, 'https')) return;
    const initiator = own(details, 'initiator'), initiatorHost = this.helpers.host(initiator);
    const initiatorScheme = typeof initiator === 'string' && initiator.startsWith('https://') ? 'https' : typeof initiator === 'string' && initiator.startsWith('http://') ? 'http' : null;
    if (type !== 'main_frame' && (!initiatorHost || !initiatorScheme || !runtime.scope.isHostGrantedSync(initiatorHost, initiatorScheme))) return;
    const entry = this.entry(key), now = runtime.now();
    if (now < this.windowAt || now - this.windowAt >= 1000) { this.windowAt = now; this.windowCount = 0; }
    if (now < entry.windowAt || now - entry.windowAt >= 1000) { entry.windowAt = now; entry.windowCount = 0; }
    // A global cap of 100 also enforces the per-tab cap without retaining a tab map.
    if (++this.windowCount > 100 || ++entry.windowCount > 20) { entry.truncated = true; return; }
    const row = { ...match, count: 1, evidenceSource: 'browser-network', integrity: 'browser-observed', attributionConfidence: initiatorHost ? 'frame-only' : 'unknown', initiatorHost: initiatorHost ? this.redact(initiatorHost) : null, script: null };
    const checked = readSocialRows([row]);
    if (!checked) { entry.truncated = true; return; }
    const rowId = rowKey(row), prior = entry.network.get(rowId);
    if (prior) { prior.count = Math.min(2147483647, prior.count + 1); return; }
    const cost = 256 + JSON.stringify(row).length * 2;
    if (entry.network.size + entry.page.length >= MAX_ROWS || entry.bytes + cost > MAX_BYTES) { entry.truncated = true; return; }
    entry.network.set(rowId, row); entry.bytes += cost;
  }
  recordPage(key, rows, truncated = false) {
    const runtime = this.runtime;
    if (!runtime.isReady || !runtime.scope.hasDataConsent || !runtime.canObserveNetworkDocument(key)) return false;
    const checked = readSocialRows(rows);
    if (!checked || checked.some(row => row.evidenceSource !== 'page-hook' || row.integrity !== 'page-controlled')) return false;
    const entry = this.entry(key), projected = [];
    let bytes = 512;
    for (const row of entry.network.values()) bytes += 256 + JSON.stringify(row).length * 2;
    for (const row of checked) {
      const script = row.script ? { ...row.script, host: this.redact(row.script.host) } : null;
      const output = { ...row, initiatorHost: row.initiatorHost ? this.redact(row.initiatorHost) : null, script: script?.host ? script : null };
      if (row.script && !output.script) { output.attributionConfidence = 'unknown'; entry.truncated = true; }
      const cost = 256 + JSON.stringify(output).length * 2;
      if (entry.network.size + projected.length >= MAX_ROWS || bytes + cost > MAX_BYTES) { entry.truncated = true; break; }
      bytes += cost; projected.push(output);
    }
    entry.page = projected; entry.bytes = bytes; entry.truncated ||= truncated; return true;
  }
  snapshot(key, coverageState = 'partial') {
    this.prune();
    const accessible = coverageState === 'partial' || coverageState === 'active';
    const entry = accessible ? this.documents.get(key) : null;
    return readSocialSnapshot({ schemaVersion: 1, type: 'social-networks-state', documentKey: key, coverageState,
      rows: entry ? [...entry.network.values(), ...entry.page].map(row => ({ ...row, script: row.script ? { ...row.script } : null })) : [],
      truncated: this.limited || (entry?.truncated ?? false) });
  }
  async bounded(operation) {
    if (this.physical.size >= 2) throw new Error('social-operation-limit');
    const job = Promise.resolve().then(operation); this.physical.add(job);
    const release = () => this.physical.delete(job); job.then(release, release);
    let timer;
    try { return await Promise.race([job, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('social-timeout')), 1500); })]); }
    finally { clearTimeout(timer); }
  }
  async read(request) {
    if (this.operations.size >= 2) return this.snapshot(request.documentKey, 'degraded');
    const runtime = this.runtime, epoch = this.epoch, generation = runtime.scope.accessGeneration;
    const operation = { invalid: false }; this.operations.add(operation);
    const current = () => {
      const projection = runtime.getProjection(request.tabId, request.frameId);
      return !operation.invalid && this.epoch === epoch && runtime.scope.accessGeneration === generation && runtime.scope.hasDataConsent &&
        projection?.documentKey === request.documentKey && !['paused', 'no-access', 'unsupported'].includes(projection.coverageState) &&
        runtime.canObserveNetworkDocument(request.documentKey);
    };
    try {
      if (!current() || !await this.bounded(() => runtime.apiResults.authorize(request, operation)) || !current()) return this.snapshot(request.documentKey, 'no-access');
      const documentId = request.documentKey.slice(`${request.tabId}:${request.frameId}:`.length);
      if (!id(documentId)) return this.snapshot(request.documentKey, 'no-access');
      // A missing MAIN bridge must not erase separately authorized browser evidence.
      let response;
      try { response = await this.bounded(() => runtime.api.tabs.sendMessage(request.tabId, { schemaVersion: 1, type: 'social-values-query' }, { frameId: request.frameId, documentId })); }
      catch { response = null; }
      if (!current()) return this.snapshot(request.documentKey, 'no-access');
      if (!await this.bounded(() => runtime.apiResults.authorize(request, operation)) || !current()) return this.snapshot(request.documentKey, 'no-access');
      const fields = ['schemaVersion', 'type', 'available', 'rows', 'truncated'];
      const valid = response && typeof response === 'object' && Reflect.ownKeys(response).length === fields.length && fields.every(field => Object.hasOwn(Object.getOwnPropertyDescriptor(response, field) ?? {}, 'value')) && own(response, 'schemaVersion') === 1 && own(response, 'type') === 'social-values-cache' && typeof own(response, 'available') === 'boolean' && typeof own(response, 'truncated') === 'boolean';
      if (!(valid && own(response, 'available') === true && this.recordPage(request.documentKey, own(response, 'rows'), own(response, 'truncated')))) {
        const entry = this.entry(request.documentKey);
        entry.page = []; entry.bytes = 512; entry.truncated = true;
        for (const row of entry.network.values()) entry.bytes += 256 + JSON.stringify(row).length * 2;
      }
      return this.snapshot(request.documentKey);
    } catch { return this.snapshot(request.documentKey, 'no-access'); }
    finally { operation.invalid = true; this.operations.delete(operation); }
  }
}
