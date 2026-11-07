// ADR-032 / REQ-004/005/011/012: selected tracking-cookie test with ephemeral comparison.
import { cookieValueIdentity } from './cookie-values.js';
import { projectCookieMetadata } from './cookie-catalog.js';
import { readCookieProbeRequest, readCookieProbeSnapshot } from './cookie-probe-contracts.js';
import { selectedCookieStorageProbe } from './cookie-storage-probe.js';
const own = (value, key) => value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
const WINDOW_MS = 10000, MAX_VALUE_CHARS = 16384, MAX_RESULTS = 16;
const error = code => ({ schemaVersion: 1, type: 'error', code });
const sensitive = /(?:auth|session|sessid|token|csrf|xsrf|password|credential|login|jwt|sso)/i;
const blank = documentKey => ({ schemaVersion: 1, type: 'cookie-probe-state', documentKey, status: 'idle', result: 'none', reason: 'none', cookieName: '', domain: '', owner: '', removalConfirmed: false, observedRestorations: 0, source: 'unknown', cleanup: 'none', startedAt: 0, completedAt: 0, windowMs: WINDOW_MS, matchedStores: [], storageCoverage: 'not-checked' });

export class CookieProbe {
  constructor(inspector, options = {}) {
    this.inspector = inspector;
    this.onUpdate = options.onUpdate ?? (() => {});
    this.clock = options.clock ?? { setTimeout: (callback, delay) => setTimeout(callback, delay), clearTimeout: timer => clearTimeout(timer) };
  }
  active = null;
  results = new Map();
  physical = new Set();
  snapshot(documentKey) {
    const now = this.inspector.runtime.now();
    for (const [key, row] of this.results) if (now - (row.completedAt || row.startedAt) > 600000) this.results.delete(key);
    const snapshot = this.active?.request.documentKey === documentKey ? this.active.snapshot : this.results.get(documentKey);
    return readCookieProbeSnapshot(snapshot ?? blank(documentKey));
  }
  publish(operation) {
    const snapshot = readCookieProbeSnapshot(operation.snapshot);
    if (!snapshot) return;
    if (this.results.size >= MAX_RESULTS && !this.results.has(snapshot.documentKey)) this.results.delete(this.results.keys().next().value);
    this.results.set(snapshot.documentKey, snapshot);
    try { this.onUpdate(snapshot); } catch {}
  }
  consistent(operation, cleanup = false) {
    const inspector = this.inspector, runtime = inspector.runtime, projection = runtime.getProjection?.(operation.request.tabId, 0);
    return this.active === operation && (cleanup || !operation.invalid && !operation.finishing) && operation.entry.epoch === inspector.epoch && operation.entry.generation === runtime.scope.accessGeneration && runtime.scope.hasDataConsent && !inspector.clears.size && !inspector.physicalRemoves.size && (!runtime.getProjection || projection?.documentKey === operation.request.documentKey && !['paused', 'no-access', 'unsupported'].includes(projection.coverageState));
  }
  async allowed(operation, cleanup = false) {
    const inspector = this.inspector, runtime = inspector.runtime, consistent = () => this.consistent(operation, cleanup);
    if (!consistent()) return false;
    const authorization = cleanup ? { invalid: false } : operation;
    if (!await inspector.bounded(() => runtime.apiResults.authorize(operation.request, authorization)) || !consistent()) return false;
    if (!await inspector.bounded(() => runtime.api.permissions.contains({ permissions: ['cookies'] })) || !consistent()) return false;
    const stores = await inspector.bounded(() => runtime.api.cookies.getAllCookieStores());
    if (!consistent() || !Array.isArray(stores) || stores.length > 64) return false;
    let matches = 0, selected;
    for (let i = 0; i < stores.length; i++) {
      const store = own(stores, i), tabs = own(store, 'tabIds'), id = own(store, 'id');
      if (!Array.isArray(tabs) || tabs.length > 1024 || typeof id !== 'string' || id.length > 128) continue;
      for (let j = 0; j < tabs.length; j++) if (own(tabs, j) === operation.request.tabId) { matches++; selected = id; break; }
    }
    return consistent() && matches === 1 && selected === operation.entry.identity.storeId;
  }
  query(operation, url = false) {
    const identity = operation.entry.identity;
    return { ...(url ? { url: operation.url } : { domain: identity.domain, path: identity.path }), name: identity.name, storeId: identity.storeId, ...(identity.partitionKey ? { partitionKey: identity.partitionKey } : {}), ...(identity.firstPartyDomain ? { firstPartyDomain: identity.firstPartyDomain } : {}) };
  }
  async call(operation, callback, cleanup = false) {
    return this.inspector.bounded(() => {
      if (!this.consistent(operation, cleanup) || this.physical.size >= 2) throw new Error('probe-stale');
      const job = Promise.resolve(callback()); this.physical.add(job);
      const release = () => this.physical.delete(job);
      job.then(release, release); return job;
    });
  }
  exact(operation, rows, sole = false) {
    if (!Array.isArray(rows) || rows.length > 1024 || sole && rows.length > 1) throw new Error('ambiguous-cookie');
    let selected;
    for (let i = 0; i < rows.length; i++) {
      const cookie = own(rows, i), identity = cookieValueIdentity(cookie, operation.entry.identity.storeId, operation.entry.partitionSite);
      if (!identity || identity.key !== operation.entry.identity.key) { if (sole) throw new Error('ambiguous-cookie'); continue; }
      if (selected) throw new Error('ambiguous-cookie');
      selected = cookie;
    }
    return selected;
  }
  observe(operation, details) {
    try {
      if (this.active !== operation || !operation.deleteIssued || !operation.entry) return;
      const cookie = own(details, 'cookie'), identity = cookieValueIdentity(cookie, operation.entry.identity.storeId, operation.entry.partitionSite);
      if (identity?.key !== operation.entry.identity.key) return;
      if (operation.finishing) {
        if (own(details, 'removed') === false && !operation.cleanupWriteIssued) operation.cleanupConflict = true;
        return;
      }
      if (!this.consistent(operation)) return;
      if (own(details, 'removed') === true) {
        if (own(details, 'cause') === 'explicit') operation.snapshot.removalConfirmed = true;
        return;
      }
      if (own(details, 'removed') !== false || !operation.snapshot.removalConfirmed) return;
      const value = own(cookie, 'value');
      if (typeof value !== 'string' || value.length > MAX_VALUE_CHARS) { operation.invalid = true; void this.finish(operation, 'failed', 'cookie-changed'); return; }
      operation.snapshot.observedRestorations = Math.min(32, operation.snapshot.observedRestorations + 1);
      operation.observedResult = value === operation.value ? 'restored-same' : 'recreated-different';
      // Confirm cookies.remove completed before attributing this event to the experiment.
      if (operation.removeReturned) void this.finish(operation, operation.observedResult);
    } catch { operation.invalid = true; void this.finish(operation, 'failed', 'observation-unavailable'); }
  }
  async start(raw) {
    const request = readCookieProbeRequest(raw);
    if (!request || request.type !== 'ui-start-cookie-probe') return error('invalid-request');
    if (this.active || this.physical.size || this.inspector.values.operations.size || this.inspector.clears.size || this.inspector.physicalRemoves.size) return error('busy');
    this.inspector.values.prune();
    const entry = this.inspector.values.handles.get(request.handle), runtime = this.inspector.runtime;
    if (!entry || entry.request.tabId !== request.tabId || entry.request.frameId !== 0 || entry.request.documentKey !== request.documentKey || entry.topRequest.documentKey !== request.documentKey || runtime.now() >= entry.expiresAt) return error('no-access');
    const operation = { request, entry, snapshot: { ...blank(request.documentKey), status: 'preparing', startedAt: Math.floor(runtime.now()) }, invalid: false, finishing: false, value: null, backup: null, listener: null, timer: null, removeReturned: false, deleteIssued: false, observedResult: null, cleanupConflict: false, cleanupWriteIssued: false, removeJob: null, removeSettled: false };
    this.active = operation; runtime.apiResults.operations?.add(operation); this.publish(operation);
    try {
      if (!await this.allowed(operation)) return await this.fail(operation, 'access-changed');
      if (typeof runtime.api.cookies?.onChanged?.addListener !== 'function' || typeof runtime.api.cookies?.onChanged?.removeListener !== 'function') return await this.fail(operation, 'observation-unavailable');
      if (typeof runtime.api.cookies.set !== 'function' || typeof runtime.api.cookies.remove !== 'function') return await this.fail(operation, 'observation-unavailable');
      const frames = await this.call(operation, () => runtime.api.webNavigation.getAllFrames({ tabId: request.tabId }));
      if (!this.consistent(operation) || !Array.isArray(frames) || frames.length > 256) return await this.fail(operation, 'access-changed');
      let top;
      for (let i = 0; i < frames.length; i++) if (own(own(frames, i), 'frameId') === 0) { if (top) return await this.fail(operation, 'access-changed'); top = own(frames, i); }
      const topUrl = own(top, 'url');
      if (typeof topUrl !== 'string' || topUrl.length > 8192) return await this.fail(operation, 'access-changed');
      const parsed = new URL(topUrl), identity = entry.identity;
      if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || !(parsed.hostname === identity.domain || !identity.hostOnly && parsed.hostname.endsWith('.' + identity.domain)) || (this.inspector.helpers.site(parsed.hostname) ?? parsed.hostname) !== entry.site || identity.firstPartyDomain && identity.firstPartyDomain !== entry.site || identity.partitionKey?.hasCrossSiteAncestor === true) return await this.fail(operation, 'not-eligible');
      const url = new URL((identity.secure ? 'https://' : parsed.protocol + '//') + parsed.hostname + '/'); url.pathname = identity.path;
      if (url.pathname !== identity.path || url.search || url.hash || url.hostname !== parsed.hostname) return await this.fail(operation, 'not-eligible');
      operation.url = url.href;
      const rows = await this.call(operation, () => runtime.api.cookies.getAll(this.query(operation, true)));
      if (!this.consistent(operation)) return await this.fail(operation, 'access-changed');
      const cookie = this.exact(operation, rows, true);
      if (!cookie) return await this.fail(operation, 'cookie-missing');
      const metadata = projectCookieMetadata(cookie), expirationDate = own(cookie, 'expirationDate'), value = own(cookie, 'value');
      if (!metadata || !metadata.tracking || metadata.confidence !== 'documented' || metadata.httpOnly || metadata.session || sensitive.test(identity.name) || typeof expirationDate !== 'number' || !Number.isFinite(expirationDate) || expirationDate * 1000 < runtime.now() + WINDOW_MS + 5000 || typeof value !== 'string' || value.length < 8 || value.length > MAX_VALUE_CHARS) return await this.fail(operation, 'not-eligible');
      operation.value = value;
      operation.backup = { url: operation.url, name: identity.name, value, path: identity.path, secure: metadata.secure, httpOnly: false, sameSite: metadata.sameSite, expirationDate, storeId: identity.storeId, ...(!identity.hostOnly ? { domain: identity.rawDomain } : {}), ...(identity.partitionKey ? { partitionKey: identity.partitionKey } : {}), ...(identity.firstPartyDomain ? { firstPartyDomain: identity.firstPartyDomain } : {}) };
      Object.assign(operation.snapshot, { cookieName: metadata.name, domain: metadata.domain, owner: metadata.owner });
      // Explicit read-only diagnostic; raw selected-cookie values remain inside ISOLATED.
      if (typeof runtime.api.scripting?.executeScript === 'function' && identity.name.length <= 128) {
        try {
          if (!await this.allowed(operation)) return await this.fail(operation, 'access-changed');
          const rows = await this.call(operation, () => runtime.api.scripting.executeScript({ target: { tabId: request.tabId, frameIds: [0] }, world: 'ISOLATED', func: selectedCookieStorageProbe, args: [identity.name] }));
          if (!this.consistent(operation)) return await this.fail(operation, 'access-changed');
          if (Array.isArray(rows) && rows.length === 1 && own(own(rows, 0), 'frameId') === 0) {
            const result = own(own(rows, 0), 'result');
            const check = readCookieProbeSnapshot({ ...operation.snapshot, matchedStores: own(result, 'matchedStores'), storageCoverage: own(result, 'storageCoverage') });
            if (check) { operation.snapshot.matchedStores = check.matchedStores; operation.snapshot.storageCoverage = check.storageCoverage; }
            else operation.snapshot.storageCoverage = 'partial';
          } else operation.snapshot.storageCoverage = 'partial';
        } catch { operation.snapshot.storageCoverage = 'partial'; }
      }
      if (!await this.allowed(operation)) return await this.fail(operation, 'access-changed');
      const latest = this.exact(operation, await this.call(operation, () => runtime.api.cookies.getAll(this.query(operation, true))), true);
      if (!this.consistent(operation)) return await this.fail(operation, 'access-changed');
      if (!latest || own(latest, 'value') !== operation.value || own(latest, 'httpOnly') !== false || own(latest, 'session') !== false) return await this.fail(operation, 'cookie-changed');
      operation.listener = details => this.observe(operation, details);
      runtime.api.cookies.onChanged.addListener(operation.listener);
      if (!this.consistent(operation)) return await this.fail(operation, 'access-changed');
      operation.deleteIssued = true;
      const removed = await this.call(operation, () => {
        const job = Promise.resolve(runtime.api.cookies.remove(this.query(operation, true)));
        operation.removeJob = job;
        const release = () => { operation.removeSettled = true; };
        job.then(release, release);
        return job;
      });
      operation.removeReturned = true;
      if (own(removed, 'name') !== identity.name || own(removed, 'storeId') !== identity.storeId) return await this.fail(operation, 'delete-failed');
      if (!this.consistent(operation)) return await this.fail(operation, 'access-changed');
      if (operation.observedResult && operation.snapshot.removalConfirmed) return await this.finish(operation, operation.observedResult);
      // An exact empty re-read can confirm removal if the event delivery is delayed.
      const after = this.exact(operation, await this.call(operation, () => runtime.api.cookies.getAll(this.query(operation))));
      if (!this.consistent(operation)) return await this.fail(operation, 'access-changed');
      if (!after) operation.snapshot.removalConfirmed = true;
      if (!operation.snapshot.removalConfirmed) return await this.fail(operation, 'delete-failed');
      if (after) {
        const currentValue = own(after, 'value');
        if (typeof currentValue !== 'string' || currentValue.length > MAX_VALUE_CHARS) return await this.fail(operation, 'cookie-changed');
        operation.snapshot.observedRestorations = Math.max(1, operation.snapshot.observedRestorations);
        return await this.finish(operation, currentValue === operation.value ? 'restored-same' : 'recreated-different');
      }
      operation.snapshot.status = 'watching'; this.publish(operation);
      operation.timer = this.clock.setTimeout(() => { void this.finish(operation, 'not-restored'); }, WINDOW_MS);
      operation.timer?.unref?.();
      return this.snapshot(request.documentKey);
    } catch (cause) {
      return await this.fail(operation, cause?.message === 'ambiguous-cookie' ? 'ambiguous-cookie' : cause?.message === 'inspection-timeout' ? 'timeout' : 'observation-unavailable');
    }
  }
  fail(operation, reason) { return this.finish(operation, 'failed', reason); }
  async finish(operation, result, reason = 'none') {
    if (operation.finishing) return operation.finishJob;
    operation.finishing = true;
    operation.finishJob = this.finishWork(operation, result, reason);
    return operation.finishJob;
  }
  async finishWork(operation, result, reason) {
    const runtime = this.inspector.runtime;
    let pendingRemoval = false;
    this.clock.clearTimeout(operation.timer);
    try {
      // Browser mutations cannot be cancelled. Give an already dispatched native remove
      // one bounded grace interval to settle before checking whether cleanup is needed.
      if (operation.removeJob && !operation.removeSettled) {
        try { await this.inspector.bounded(() => operation.removeJob); }
        catch { pendingRemoval = !operation.removeSettled; }
      }
      // Native cookie events have no documentId; reauthorize the selected browser context.
      if (['restored-same', 'recreated-different'].includes(result) && !await this.allowed(operation, true)) {
        result = 'cancelled'; reason = 'access-changed'; operation.snapshot.cleanup = 'skipped';
      }
      if (operation.deleteIssued && operation.backup && !['restored-same', 'recreated-different'].includes(result)) {
        if (pendingRemoval || !await this.allowed(operation, true)) {
          operation.snapshot.cleanup = 'skipped';
          if (result === 'not-restored') { result = 'cancelled'; reason = 'access-changed'; }
        }
        else {
          const existing = this.exact(operation, await this.call(operation, () => runtime.api.cookies.getAll(this.query(operation)), true));
          if (!this.consistent(operation, true)) {
            operation.snapshot.cleanup = 'skipped';
            if (result === 'not-restored') { result = 'cancelled'; reason = 'access-changed'; }
          }
          else if (existing || operation.cleanupConflict) operation.snapshot.cleanup = 'not-needed';
          else {
            // Only write after checking absence, current authorization and unchanged site epoch.
            const restored = await this.call(operation, () => {
              if (operation.cleanupConflict) throw new Error('probe-cleanup-conflict');
              operation.cleanupWriteIssued = true;
              return runtime.api.cookies.set(operation.backup);
            }, true);
            operation.snapshot.cleanup = cookieValueIdentity(restored, operation.entry.identity.storeId, operation.entry.partitionSite)?.key === operation.entry.identity.key ? 'restored' : 'failed';
          }
        }
      } else operation.snapshot.cleanup = operation.deleteIssued ? 'not-needed' : 'none';
    } catch { operation.snapshot.cleanup = 'failed'; }
    finally {
      if (operation.listener) try { runtime.api.cookies.onChanged.removeListener(operation.listener); } catch {}
      operation.value = null; operation.backup = null; operation.entry = null; operation.removeJob = null;
      runtime.apiResults.operations?.delete(operation);
      Object.assign(operation.snapshot, { status: 'complete', result, reason, completedAt: Math.max(operation.snapshot.startedAt, Math.floor(runtime.now())) });
      this.publish(operation);
      if (this.active === operation) this.active = null;
    }
    return this.snapshot(operation.request.documentKey);
  }
  async read(raw) {
    const request = readCookieProbeRequest(raw);
    if (!request || request.type !== 'ui-get-cookie-probe') return error('invalid-request');
    const runtime = this.inspector.runtime, generation = runtime.scope.accessGeneration, epoch = this.inspector.epoch, operation = { invalid: false };
    try {
      if (!runtime.scope.hasDataConsent || !await this.inspector.bounded(() => runtime.apiResults.authorize(request, operation)) || operation.invalid || !runtime.scope.hasDataConsent || generation !== runtime.scope.accessGeneration || epoch !== this.inspector.epoch || runtime.getProjection && runtime.getProjection(request.tabId, 0)?.documentKey !== request.documentKey) return error('no-access');
      return this.snapshot(request.documentKey);
    } catch { return error('no-access'); }
  }
  async cancel(raw) {
    const request = readCookieProbeRequest(raw);
    if (!request || request.type !== 'ui-cancel-cookie-probe') return error('invalid-request');
    if (this.active?.request.documentKey !== request.documentKey || this.active.request.tabId !== request.tabId) return this.read({ ...request, type: 'ui-get-cookie-probe' });
    if (!await this.allowed(this.active, true)) return error('no-access');
    return this.finish(this.active, 'cancelled');
  }
  async invalidate(documentKey = null) {
    const operation = this.active;
    if (operation && (!documentKey || operation.request.documentKey === documentKey)) { operation.invalid = true; await this.finish(operation, 'cancelled', 'access-changed'); }
    if (documentKey) this.results.delete(documentKey); else this.results.clear();
  }
}
