// ADR-023 / REQ-004/005/011/012/013: explicit local, ephemeral cookie value inspection.
import { readCookieValueRequest } from './inspection-contracts.js';

const own = (value, key) => value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
const data = (value, key) => {
  const descriptor = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key) : undefined;
  return !descriptor || Object.hasOwn(descriptor, 'value');
};
const MAX_HANDLES = 512, MAX_IDENTITY_BYTES = 131072, HANDLE_TTL_MS = 60000, MAX_VALUE_CHARS = 16384;
const error = code => ({ schemaVersion: 1, type: 'error', code });

// No value is read here. The exact raw domain and host-only flag distinguish native identities.
export function cookieValueIdentity(cookie, storeId, partitionSite) {
  try {
    const name = own(cookie, 'name'), rawDomain = own(cookie, 'domain'), path = own(cookie, 'path');
    const hostOnly = own(cookie, 'hostOnly'), secure = own(cookie, 'secure'), actualStore = own(cookie, 'storeId');
    if (typeof name !== 'string' || name.length > 4096 || typeof rawDomain !== 'string' || rawDomain.length > 253 || typeof path !== 'string' || path.length > 1024 || !path.startsWith('/') || typeof hostOnly !== 'boolean' || typeof secure !== 'boolean' || actualStore !== storeId || typeof storeId !== 'string' || storeId.length > 128) return null;
    const domain = rawDomain.replace(/^\./, '').toLowerCase();
    if (!/^[a-z0-9.-]+$/.test(domain) || domain.startsWith('.') || domain.endsWith('.') || domain.includes('..') || !data(cookie, 'partitionKey') || !data(cookie, 'firstPartyDomain')) return null;
    let partitionKey;
    const partition = own(cookie, 'partitionKey');
    if (partition !== undefined && partition !== null) {
      if (!data(partition, 'topLevelSite') || !data(partition, 'hasCrossSiteAncestor')) return null;
      const site = own(partition, 'topLevelSite'), ancestor = own(partition, 'hasCrossSiteAncestor');
      if (typeof site !== 'string' || site.length > 512 || ancestor !== undefined && typeof ancestor !== 'boolean') return null;
      const parsed = new URL(site);
      if (parsed.origin !== partitionSite || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) return null;
      partitionKey = { topLevelSite: partitionSite, ...(ancestor === undefined ? {} : { hasCrossSiteAncestor: ancestor }) };
    }
    const firstPartyDomain = own(cookie, 'firstPartyDomain');
    if (firstPartyDomain !== undefined && (typeof firstPartyDomain !== 'string' || firstPartyDomain.length > 253)) return null;
    const key = JSON.stringify([name, rawDomain, path, hostOnly, storeId, partitionKey?.topLevelSite ?? '', partitionKey?.hasCrossSiteAncestor ?? null, firstPartyDomain ?? '']);
    return { name, rawDomain, domain, path, hostOnly, storeId, partitionKey, firstPartyDomain, key };
  } catch { return null; }
}

export class CookieValues {
  constructor(inspector) { this.inspector = inspector; }
  handles = new Map();
  identityBytes = 0;
  operations = new Set();
  physicalQueries = new Set();
  expiryTimer;
  remove(handle) {
    const entry = this.handles.get(handle);
    if (entry) { this.identityBytes -= entry.bytes; this.handles.delete(handle); }
  }
  invalidateDocument(documentKey) {
    for (const [handle, entry] of this.handles) if (entry.request.documentKey === documentKey) this.remove(handle);
    for (const operation of this.operations) if (operation.documentKey === documentKey) operation.invalid = true;
    this.scheduleExpiry();
  }
  invalidate() {
    this.handles.clear(); this.identityBytes = 0;
    for (const operation of this.operations) operation.invalid = true;
    clearTimeout(this.expiryTimer); this.expiryTimer = undefined;
  }
  scheduleExpiry() {
    clearTimeout(this.expiryTimer); this.expiryTimer = undefined;
    if (!this.handles.size) return;
    let expiresAt = Infinity;
    for (const entry of this.handles.values()) expiresAt = Math.min(expiresAt, entry.expiresAt);
    this.expiryTimer = setTimeout(() => { this.expiryTimer = undefined; this.prune(); this.scheduleExpiry(); }, Math.max(1, expiresAt - this.inspector.runtime.now()));
    this.expiryTimer?.unref?.();
  }
  prune() {
    const { runtime, epoch } = this.inspector, now = runtime.now();
    for (const [handle, entry] of this.handles) if (now >= entry.expiresAt || entry.epoch !== epoch || entry.generation !== runtime.scope.accessGeneration || !runtime.scope.hasDataConsent) this.remove(handle);
  }
  createView(request, snapshot, identities, context) {
    this.prune(); this.invalidateDocument(request.documentKey);
    const { runtime, epoch } = this.inspector, handles = [], now = runtime.now();
    for (let index = 0; index < snapshot.entries.length; index++) {
      const identity = identities[index];
      if (!identity) { handles.push(null); continue; }
      // Count both key and retained fields, including escaped strings, with fixed object overhead.
      const bytes = JSON.stringify(identity).length * 2 + request.documentKey.length * 2 + context.topRequest.documentKey.length * 2 + context.partitionSite.length * 2 + context.site.length * 2 + 256;
      if (this.handles.size >= MAX_HANDLES || this.identityBytes + bytes > MAX_IDENTITY_BYTES) { handles.push(null); continue; }
      let handle;
      for (let attempt = 0; attempt < 4; attempt++) {
        const candidate = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
        if (!this.handles.has(candidate)) { handle = candidate; break; }
      }
      if (!handle) { handles.push(null); continue; }
      const storedRequest = { schemaVersion: 1, type: 'ui-get-cookie-value', tabId: request.tabId, frameId: request.frameId, documentKey: request.documentKey };
      this.handles.set(handle, { identity, request: storedRequest, topRequest: context.topRequest, partitionSite: context.partitionSite, site: context.site, epoch, generation: runtime.scope.accessGeneration, expiresAt: now + HANDLE_TTL_MS, bytes });
      this.identityBytes += bytes; handles.push(handle);
    }
    this.scheduleExpiry();
    return { schemaVersion: 1, type: 'cookies-view-state', snapshot, handles };
  }
  async reveal(rawRequest) {
    const request = readCookieValueRequest(rawRequest);
    if (!request) return error('invalid-request');
    const inspector = this.inspector, runtime = inspector.runtime;
    this.prune();
    const entry = this.handles.get(request.handle);
    if (!entry || entry.request.tabId !== request.tabId || entry.request.frameId !== request.frameId || entry.request.documentKey !== request.documentKey) return error('no-access');
    if (inspector.clears.size || inspector.physicalRemoves.size || this.operations.size >= 2 || this.physicalQueries.size >= 2) return error('no-access');
    const operation = { documentKey: request.documentKey, tabId: request.tabId, invalid: false };
    this.operations.add(operation); runtime.apiResults.operations?.add(operation);
    const deadline = Date.now() + 5000;
    const consistent = () => {
      const projection = runtime.getProjection?.(request.tabId, request.frameId);
      return !operation.invalid && this.handles.get(request.handle) === entry && runtime.now() < entry.expiresAt && Date.now() < deadline && entry.epoch === inspector.epoch && entry.generation === runtime.scope.accessGeneration && runtime.scope.hasDataConsent && !inspector.clears.size && !inspector.physicalRemoves.size && (!runtime.getProjection || projection?.documentKey === request.documentKey && !['paused', 'no-access', 'unsupported'].includes(projection.coverageState));
    };
    const allowed = async () => {
      if (!consistent()) return false;
      if (!await inspector.bounded(() => runtime.apiResults.authorize(request, operation)) || !consistent()) return false;
      if (!await inspector.bounded(() => runtime.apiResults.authorize(entry.topRequest, operation)) || !consistent()) return false;
      if (!await inspector.bounded(() => runtime.api.permissions.contains({ permissions: ['cookies'] })) || !consistent()) return false;
      const stores = await inspector.bounded(() => runtime.api.cookies.getAllCookieStores());
      if (!consistent() || !Array.isArray(stores) || stores.length > 64) return false;
      const selected = [];
      for (let index = 0; index < stores.length; index++) {
        const store = own(stores, index), id = own(store, 'id'), tabIds = own(store, 'tabIds');
        if (typeof id !== 'string' || id.length > 128 || !Array.isArray(tabIds) || tabIds.length > 1024) continue;
        for (let cursor = 0; cursor < tabIds.length; cursor++) if (own(tabIds, cursor) === request.tabId) { selected.push(id); break; }
      }
      return consistent() && selected.length === 1 && selected[0] === entry.identity.storeId;
    };
    try {
      if (!await allowed()) return error('no-access');
      const identity = entry.identity;
      const query = { domain: identity.domain, name: identity.name, path: identity.path, storeId: identity.storeId, ...(identity.partitionKey ? { partitionKey: identity.partitionKey } : {}), ...(identity.firstPartyDomain ? { firstPartyDomain: identity.firstPartyDomain } : {}) };
      const rows = await inspector.bounded(() => {
        if (!consistent() || this.physicalQueries.size >= 2) throw new Error('cookie-value-capacity');
        const job = Promise.resolve(runtime.api.cookies.getAll(query)); this.physicalQueries.add(job);
        const release = () => this.physicalQueries.delete(job);
        job.then(release, release); return job;
      });
      if (!consistent() || !Array.isArray(rows) || rows.length > 1024) return error('no-access');
      let candidate;
      for (let index = 0; index < rows.length; index++) {
        const cookie = own(rows, index), native = cookieValueIdentity(cookie, identity.storeId, entry.partitionSite);
        if (native?.key !== identity.key || native.firstPartyDomain && native.firstPartyDomain !== entry.site) continue;
        if (candidate !== undefined) return error('no-access');
        candidate = cookie;
      }
      if (!candidate || !await allowed() || !consistent()) return error('no-access');
      // This is the only cookie value access. Never call an accessor or persist the native result.
      const descriptor = Object.getOwnPropertyDescriptor(candidate, 'value');
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string') return error('no-access');
      const value = descriptor.value;
      if (!consistent()) return error('no-access');
      return { schemaVersion: 1, type: 'cookie-value-state', documentKey: request.documentKey, handle: request.handle, value: value.slice(0, MAX_VALUE_CHARS), truncated: value.length > MAX_VALUE_CHARS };
    } catch { return error('no-access'); }
    finally { this.operations.delete(operation); runtime.apiResults.operations?.delete(operation); this.prune(); }
  }
}
