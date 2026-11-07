// ADR-021/022 / REQ-004/005/011/012: metadata and explicit current-site cleanup.
import { projectCookieMetadata } from './cookie-catalog.js';
import { readCookieSnapshot } from './inspection-contracts.js';
import { CookieValues, cookieValueIdentity } from './cookie-values.js';

const own = (value, key) => value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
const withinSite = (domain, site) => domain === site || domain.endsWith('.' + site);
function nativeCookieIdentity(cookie, storeId, partitionSite) {
  const name = own(cookie, 'name'), rawDomain = own(cookie, 'domain'), path = own(cookie, 'path');
  const secure = own(cookie, 'secure'), actualStore = own(cookie, 'storeId');
  if (typeof name !== 'string' || name.length > 4096 || typeof rawDomain !== 'string' || rawDomain.length > 253 || typeof path !== 'string' || path.length > 1024 || !path.startsWith('/') || typeof secure !== 'boolean' || actualStore !== storeId) return null;
  for (const key of ['partitionKey', 'firstPartyDomain']) {
    const property = Object.getOwnPropertyDescriptor(cookie, key);
    if (property && !Object.hasOwn(property, 'value')) return null;
  }
  const domain = rawDomain.replace(/^\./, '').toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(domain) || domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) return null;
  const rawPartition = own(cookie, 'partitionKey');
  let partitionKey;
  if (rawPartition !== undefined && rawPartition !== null) {
    const topLevelSite = own(rawPartition, 'topLevelSite'), ancestor = own(rawPartition, 'hasCrossSiteAncestor');
    if (typeof topLevelSite !== 'string' || topLevelSite.length > 512 || ancestor !== undefined && typeof ancestor !== 'boolean') return null;
    try {
      const parsed = new URL(topLevelSite);
      if (parsed.origin !== partitionSite || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) return null;
    } catch { return null; }
    partitionKey = { topLevelSite: partitionSite, ...(ancestor === undefined ? {} : { hasCrossSiteAncestor: ancestor }) };
  }
  const firstPartyDomain = own(cookie, 'firstPartyDomain');
  if (firstPartyDomain !== undefined && (typeof firstPartyDomain !== 'string' || firstPartyDomain.length > 253)) return null;
  const key = JSON.stringify([name, domain, path, partitionKey?.topLevelSite ?? '', partitionKey?.hasCrossSiteAncestor ?? false, firstPartyDomain ?? '']);
  return { name, domain, path, secure, key, partitionKey, firstPartyDomain };
}

export class CookieInspector {
  constructor(runtime, helpers) { this.runtime = runtime; this.helpers = helpers; this.values = new CookieValues(this); }
  documents = new Map();
  jobs = new Set();
  reads = new Set();
  pendingReads = new Map();
  clears = new Set();
  physicalRemoves = new Set();
  epoch = 0;
  clear() {
    this.epoch++;
    this.values.invalidate();
    this.documents.clear();
    for (const page of this.runtime.pro?.session?.pages ?? []) delete page.cookies;
    this.runtime.pro?.mark();
  }
  forget(documentKey) {
    this.epoch++; this.documents.delete(documentKey);
    this.values.invalidate();
    for (const page of this.runtime.pro?.session?.pages ?? []) if (page.cookies?.documentKey === documentKey) delete page.cookies;
  }
  entry(key) {
    const now = this.runtime.now();
    for (const [id, entry] of this.documents) if (now - entry.at > 600000 || !this.runtime.canObserveNetworkDocument(id)) this.documents.delete(id);
    if (!this.documents.has(key)) {
      if (this.documents.size >= 64) this.documents.delete(this.documents.keys().next().value);
      this.documents.set(key, { hosts: new Map(), truncated: false, at: now });
    }
    const entry = this.documents.get(key); entry.at = now; return entry;
  }
  observe(details) {
    const runtime = this.runtime;
    if (!runtime.scope.hasDataConsent || !runtime.isReady || !Number.isInteger(details.tabId) || details.tabId < 0 || !Number.isInteger(details.frameId) || details.frameId < 0 || typeof details.documentId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(details.documentId)) return;
    const key = `${details.tabId}:${details.frameId}:${details.documentId}`;
    if (!runtime.canObserveNetworkDocument(key)) return;
    const host = this.helpers.host(details.url), scheme = typeof details.url === 'string' && details.url.startsWith('https:') ? 'https' : typeof details.url === 'string' && details.url.startsWith('http:') ? 'http' : null;
    if (!host || !scheme || !runtime.scope.isHostGrantedSync(host, scheme)) return;
    const entry = this.entry(key);
    if (entry.hosts.size < 24 || entry.hosts.has(host)) entry.hosts.set(host, scheme); else entry.truncated = true;
  }
  async bounded(operation, capacity = 8) {
    if (this.jobs.size >= capacity) throw new Error('inspection-capacity');
    const job = Promise.resolve().then(operation);
    this.jobs.add(job); job.then(() => this.jobs.delete(job), () => this.jobs.delete(job));
    let timer;
    try { return await Promise.race([job, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('inspection-timeout')), 1000); })]); }
    finally { clearTimeout(timer); }
  }
  read(request, capture = null) {
    if (this.clears.size || this.physicalRemoves.size) return Promise.resolve({ schemaVersion: 1, type: 'error', code: 'busy' });
    const key = request.documentKey + '|' + this.epoch + '|' + this.runtime.scope.accessGeneration + '|' + request.type + (capture ? '|' + capture.key : '');
    const previous = this.pendingReads.get(key); if (previous) return previous;
    if (this.pendingReads.size >= 2) return Promise.resolve({ schemaVersion: 1, type: 'error', code: 'no-access' });
    const live = request.type === 'ui-get-cookie-view';
    if (live) this.values.invalidateDocument(request.documentKey);
    const work = this.readWork(request, capture);
    const job = live ? work.then(result => result?.type === 'cookies-state' ? { schemaVersion: 1, type: 'cookies-view-state', snapshot: result, handles: result.entries.map(() => null) } : result) : work;
    this.pendingReads.set(key, job);
    const release = () => { if (this.pendingReads.get(key) === job) this.pendingReads.delete(key); };
    job.then(release, release); return job;
  }
  invalidateSite(site, subdomains = true) {
    ++this.epoch;
    this.values.invalidate();
    for (const page of this.runtime.pro?.session?.pages ?? []) {
      let matches = this.runtime.pro.session.siteKey === site;
      try { const host = new URL(page.url).hostname; matches ||= host === site || subdomains && withinSite(host, site); } catch {}
      if (matches && page.cookies) { delete page.cookies; this.runtime.pro?.size?.('cookies:' + page.id, 0); }
    }
    this.runtime.pro?.mark();
  }
  async clearSite(request) {
    if (this.clears.size || this.physicalRemoves.size) return { schemaVersion: 1, type: 'error', code: 'busy' };
    const token = {}; this.clears.add(token);
    const runtime = this.runtime, generation = runtime.scope.accessGeneration, operation = { invalid: false };
    const deadline = Date.now() + 8000;
    let epoch = this.epoch, site, subdomains = false, invalidated = false, storeId, topRequest, removedCount = 0, failedCount = 0, truncated = false;
    const result = () => ({ schemaVersion: 1, type: 'cookies-clear-state', documentKey: request.documentKey, removedCount, failedCount, truncated });
    const consistent = () => Date.now() < deadline && epoch === this.epoch && generation === runtime.scope.accessGeneration && runtime.scope.hasDataConsent && (typeof runtime.getProjection !== 'function' || runtime.getProjection(request.tabId, request.frameId)?.documentKey === request.documentKey);
    const allowed = async () => {
      if (!consistent()) return false;
      if (!await this.bounded(() => runtime.apiResults.authorize(request, operation)) || !consistent()) return false;
      if (topRequest && topRequest.documentKey !== request.documentKey && (!await this.bounded(() => runtime.apiResults.authorize(topRequest, operation)) || !consistent())) return false;
      if (!await this.bounded(() => runtime.api.permissions.contains({ permissions: ['cookies'] })) || !consistent()) return false;
      if (storeId !== undefined) {
        const stores = await this.bounded(() => runtime.api.cookies.getAllCookieStores());
        const current = Array.isArray(stores) && stores.length <= 64 ? stores.filter(store => typeof store?.id === 'string' && Array.isArray(store.tabIds) && store.tabIds.length <= 1024 && store.tabIds.includes(request.tabId)) : [];
        if (!consistent() || current.length !== 1 || current[0].id !== storeId) return false;
      }
      return consistent();
    };
    try {
      if (!await allowed()) return { schemaVersion: 1, type: 'error', code: 'no-access' };
      if (typeof runtime.api.cookies?.getAll !== 'function' || typeof runtime.api.cookies.getAllCookieStores !== 'function' || typeof runtime.api.cookies.remove !== 'function') return { schemaVersion: 1, type: 'error', code: 'no-access' };
      const frames = await this.bounded(() => runtime.api.webNavigation.getAllFrames({ tabId: request.tabId }));
      if (!consistent() || !Array.isArray(frames) || frames.length > 1024) return { schemaVersion: 1, type: 'error', code: 'stale-revision' };
      const top = frames.find(frame => frame.frameId === 0 && typeof frame.documentId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(frame.documentId));
      if (!top || typeof top.url !== 'string' || !/^https?:\/\//.test(top.url)) return { schemaVersion: 1, type: 'error', code: 'no-access' };
      const topUrl = new URL(top.url), registrable = this.helpers.site(topUrl.hostname); site = registrable ?? topUrl.hostname; subdomains = typeof registrable === 'string';
      if (!/^[a-z0-9.-]{1,253}$/.test(site)) return { schemaVersion: 1, type: 'error', code: 'no-access' };
      topRequest = { ...request, frameId: 0, documentKey: `${request.tabId}:0:${top.documentId}` };
      const stores = await this.bounded(() => runtime.api.cookies.getAllCookieStores());
      if (!consistent() || !Array.isArray(stores) || stores.length > 64) return { schemaVersion: 1, type: 'error', code: 'no-access' };
      const selected = stores.filter(store => typeof store?.id === 'string' && store.id.length <= 128 && Array.isArray(store.tabIds) && store.tabIds.length <= 1024 && store.tabIds.includes(request.tabId));
      if (selected.length !== 1) return { schemaVersion: 1, type: 'error', code: 'no-access' };
      storeId = selected[0].id;
      if (!await allowed()) return { schemaVersion: 1, type: 'error', code: 'stale-revision' };
      // Invalidate older reads before collection; new reads remain blocked until finish.
      this.invalidateSite(site, subdomains); epoch = this.epoch; invalidated = true;
      const partitionSite = topUrl.protocol + '//' + site;
      const queries = [{ domain: site, storeId }, { domain: site, storeId, partitionKey: { topLevelSite: partitionSite } }];
      const candidates = [], seen = new Set(); let scanned = 0, identityBytes = 0;
      for (const query of queries) {
        if (!await allowed() || Date.now() >= deadline) { truncated = true; break; }
        let rows;
        try { rows = await this.bounded(() => runtime.api.cookies.getAll(query)); } catch { truncated = true; continue; }
        if (!await allowed()) { truncated = true; break; }
        if (!Array.isArray(rows)) { truncated = true; continue; }
        if (rows.length > 1024) truncated = true;
        for (let index = 0; index < Math.min(rows.length, 1024) && scanned < 4096; ++index, ++scanned) {
          const cookie = nativeCookieIdentity(own(rows, index), storeId, partitionSite);
          if (!cookie || !(cookie.domain === site || subdomains && withinSite(cookie.domain, site)) || cookie.firstPartyDomain && cookie.firstPartyDomain !== site) { truncated = true; continue; }
          if (seen.has(cookie.key)) continue;
          if (identityBytes + cookie.key.length * 2 > 131072) { truncated = true; break; }
          seen.add(cookie.key); identityBytes += cookie.key.length * 2; candidates.push(cookie);
        }
        if (scanned >= 4096 || identityBytes >= 131072) { truncated = true; break; }
      }
      // Native remove selects the longest matching path; keep that order explicitly.
      candidates.sort((left, right) => right.path.length - left.path.length);
      for (const cookie of candidates) {
        if (Date.now() >= deadline || removedCount + failedCount >= 4096 || !await allowed()) { truncated = true; break; }
        const url = new URL((cookie.secure ? 'https://' : 'http://') + cookie.domain + '/'); url.pathname = cookie.path;
        if (url.hostname !== cookie.domain || url.pathname !== cookie.path || url.search || url.hash) { ++failedCount; truncated = true; continue; }
        const details = { url: url.href, name: cookie.name, storeId, ...(cookie.partitionKey ? { partitionKey: cookie.partitionKey } : {}), ...(cookie.firstPartyDomain ? { firstPartyDomain: cookie.firstPartyDomain } : {}) };
        try {
          const removed = await this.bounded(() => {
            if (!consistent()) throw new Error('stale-cookie-clear');
            const job = Promise.resolve(runtime.api.cookies.remove(details)); this.physicalRemoves.add(job);
            const release = () => { this.physicalRemoves.delete(job); if (!this.clears.has(token)) this.invalidateSite(site, subdomains); };
            job.then(release, release); return job;
          });
          if (own(removed, 'name') === cookie.name && own(removed, 'storeId') === storeId) ++removedCount; else ++failedCount;
          if (!consistent()) { truncated = true; break; }
        } catch { ++failedCount; truncated = true; break; }
      }
      return result();
    } catch { return removedCount || failedCount ? { ...result(), truncated: true } : { schemaVersion: 1, type: 'error', code: 'no-access' }; }
    finally {
      if (invalidated) { this.invalidateSite(site, subdomains); try { await this.bounded(() => runtime.pro?.flush?.()); } catch {} }
      this.clears.delete(token);
    }
  }
  async readWork(request, capture = null) {
    const runtime = this.runtime, epoch = this.epoch, generation = runtime.scope.accessGeneration;
    const recording = runtime.pro.session, recordingId = recording?.id, recordingPage = runtime.pro.pageFor(request.tabId);
    const recordingCurrent = () => recording && runtime.pro.session === recording && runtime.pro.session.id === recordingId && runtime.pro.pageFor(request.tabId) === recordingPage && recordingPage?.documentKey === request.documentKey && runtime.pro.checkDeadline();
    const bounded = operation => this.bounded(operation, capture ? 2 : 8);
    const readKey = request.documentKey + '|' + epoch + '|' + generation + '|' + request.type;
    if (this.reads.size >= 2) return { schemaVersion: 1, type: 'error', code: 'no-access' };
    this.reads.add(readKey);
    const operation = { invalid: false }; let topRequest;
    const consistent = () => (!capture || capture.current()) && epoch === this.epoch && generation === runtime.scope.accessGeneration && runtime.scope.hasDataConsent && (typeof runtime.getProjection !== 'function' || runtime.getProjection(request.tabId, request.frameId)?.documentKey === request.documentKey);
    const allowed = async () => {
      if (!consistent()) return false;
      if (!await bounded(() => runtime.apiResults.authorize(request, operation)) || !consistent()) return false;
      if (topRequest && topRequest.documentKey !== request.documentKey && (!await bounded(() => runtime.apiResults.authorize(topRequest, operation)) || !consistent())) return false;
      return consistent();
    };
    const permissionGranted = async () => { const granted = await bounded(() => runtime.api.permissions.contains({ permissions: ['cookies'] })); return granted && consistent(); };
    const empty = (permission, coverageState) => ({ schemaVersion: 1, type: 'cookies-state', documentKey: request.documentKey, coverageState, permission, trackingCount: 0, totalCount: 0, siteCount: 0, entries: [], truncated: false, observedAt: Math.floor(runtime.now()) });
    try {
      if (!await allowed()) return { schemaVersion: 1, type: 'error', code: 'stale-revision' };
      if (!await permissionGranted()) return empty('required', 'no-access');
      if (typeof runtime.api.cookies?.getAll !== 'function') return empty('unsupported', 'unsupported');
      if (typeof runtime.api.cookies.getAllCookieStores !== 'function') return empty('granted', 'unsupported');
      const stores = await bounded(() => runtime.api.cookies.getAllCookieStores());
      if (!Array.isArray(stores) || stores.length > 64) return empty('granted', 'unsupported');
      const selectedStores = stores.filter(candidate => typeof candidate?.id === 'string' && candidate.id.length <= 128 && Array.isArray(candidate.tabIds) && candidate.tabIds.length <= 1024 && candidate.tabIds.includes(request.tabId));
      if (selectedStores.length !== 1) return empty('granted', 'unsupported');
      const store = selectedStores[0];
      const frames = await bounded(() => runtime.api.webNavigation.getAllFrames({ tabId: request.tabId }));
      const selected = frames?.find(frame => frame.frameId === request.frameId && `${request.tabId}:${request.frameId}:${frame.documentId}` === request.documentKey);
      if (!selected || typeof selected.url !== 'string' || !/^https?:\/\//.test(selected.url)) return empty('granted', 'unsupported');
      const target = new URL(selected.url); target.search = ''; target.hash = ''; target.username = ''; target.password = '';
      const top = frames.find(frame => frame.frameId === 0), topUrl = top && /^https?:\/\//.test(top.url) ? new URL(top.url) : null;
      if (!topUrl || typeof top.documentId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(top.documentId)) return empty('granted', 'unsupported');
      topRequest = { ...request, frameId: 0, documentKey: `${request.tabId}:0:${top.documentId}` };
      if (!await allowed() || !await permissionGranted()) return empty('required', 'no-access');
      const registrable = this.helpers.site(topUrl.hostname), site = registrable ?? topUrl.hostname, partitionSite = topUrl.protocol + '//' + site;
      const siteCookie = domain => domain === site || typeof registrable === 'string' && withinSite(domain, site);
      const queries = [{ domain: site, storeId: store.id }, { url: target.href, storeId: store.id }], hosts = this.documents.get(request.documentKey)?.hosts ?? new Map();
      for (const [host, scheme] of hosts) if (host !== target.hostname && runtime.scope.isHostGrantedSync(host, scheme)) queries.push({ url: scheme + '://' + host + '/', storeId: store.id }, { domain: host, storeId: store.id });
      // Partition queries select only this top-level site; never enumerate other sites' partitions.
      if (topUrl) {
        const partitionKey = { topLevelSite: partitionSite };
        for (const query of [...queries]) queries.push({ ...query, partitionKey });
      }
      const observed = this.documents.get(request.documentKey), entries = [], seen = new Set(), valueIdentities = new Map();
      let truncated = observed?.truncated ?? false, bytes = 512, scanned = 0, identityBytes = 0, totalCount = 0, siteCount = 0;
      if (queries.length > 48) truncated = true;
      const deadline = Date.now() + 3000;
      const concurrency = capture ? 1 : 4;
      for (let index = 0; index < Math.min(queries.length, 48); index += concurrency) {
        if (Date.now() >= deadline || scanned >= 4096) { truncated = true; break; }
        if (!await allowed() || !await permissionGranted()) return empty('required', 'no-access');
        const results = await Promise.allSettled(queries.slice(index, index + concurrency).map(query => bounded(async () => {
          const cookies = await runtime.api.cookies.getAll(query);
          if (!Array.isArray(cookies)) throw new Error('invalid-cookie-result');
          if (!consistent()) return { truncated: true };
          let limited = cookies.length > 1024;
          for (let cursor = 0; cursor < Math.min(cookies.length, 1024); cursor++) {
            if (scanned >= 4096) { limited = true; break; }
            ++scanned;
            const cookie = own(cookies, cursor);
            const native = nativeCookieIdentity(cookie, store.id, partitionSite);
            if (!native || native.firstPartyDomain && native.firstPartyDomain !== site || query.domain && !withinSite(native.domain, query.domain)) { limited = true; continue; }
            if (query.domain === site && !siteCookie(native.domain)) continue;
            if (seen.has(native.key)) continue;
            if (totalCount >= 4096 || identityBytes + native.key.length * 2 > 131072) { limited = true; break; }
            // This bounded transient key only deduplicates browser results; it never enters storage or a message.
            seen.add(native.key); identityBytes += native.key.length * 2; ++totalCount;
            if (siteCookie(native.domain)) ++siteCount;
            const metadata = projectCookieMetadata(cookie);
            if (!metadata || typeof metadata.domain !== 'string') { limited = true; continue; }
            const redacted = this.helpers.redact(metadata.domain);
            const entry = { ...metadata, domain: redacted.kind === 'registrable' ? redacted.value : 'local' };
            const cost = 256 + JSON.stringify(entry).length * 2;
            if (entries.length >= 256 || bytes + cost > 98304) { limited = true; continue; }
            bytes += cost; entries.push(entry);
            if (request.type === 'ui-get-cookie-view' && siteCookie(native.domain)) valueIdentities.set(entry, cookieValueIdentity(cookie, store.id, partitionSite));
          }
          return { truncated: limited };
        })));
        for (const result of results) {
          if (result.status !== 'fulfilled') { truncated = true; continue; }
          truncated ||= result.value.truncated;
        }
      }
      if (!await allowed() || !await permissionGranted()) return empty('required', 'no-access');
      entries.sort((a, b) => Number(b.tracking) - Number(a.tracking) || a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name));
      const snapshot = readCookieSnapshot({ ...empty('granted', 'partial'), entries, trackingCount: entries.filter(entry => entry.tracking).length, totalCount, siteCount, truncated });
      if (!snapshot) return { schemaVersion: 1, type: 'error', code: 'invalid-request' };
      const page = recordingPage;
      if (recordingCurrent() && runtime.pro.size('cookies:' + page.id, bytes) && recordingCurrent() && consistent()) {
        page.cookies = snapshot; runtime.pro.mark();
        try { await runtime.pro.flush(); }
        finally {
          if (!consistent() && page.cookies === snapshot) {
            delete page.cookies;
            if (runtime.pro.session === recording) { runtime.pro.size('cookies:' + page.id, 0); runtime.pro.mark(); await runtime.pro.flush(); }
          }
        }
      }
      if (!await allowed() || !await permissionGranted()) {
        if (page?.cookies === snapshot) {
          delete page.cookies;
          if (runtime.pro.session === recording) { runtime.pro.size('cookies:' + page.id, 0); runtime.pro.mark(); await runtime.pro.flush(); }
        }
        return empty('required', 'no-access');
      }
      return request.type === 'ui-get-cookie-view' ? this.values.createView(request, snapshot, entries.map(entry => valueIdentities.get(entry) ?? null), { topRequest, partitionSite, site }) : snapshot;
    } catch { return { schemaVersion: 1, type: 'error', code: 'no-access' }; }
    finally { this.reads.delete(readKey); }
  }
}
