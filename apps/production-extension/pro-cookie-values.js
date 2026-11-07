// ADR-037: actual outgoing Cookie headers enter only an explicitly started Pro recording.
import { PRO_COOKIE_VALUE_LIMITS as LIMITS, validProCookieName, validProCookieValue, proCookieRowKey, proCookieRowBytes, readProCookieValues } from './pro-cookie-values-contracts.js';
const own = (value, key) => value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);

export function parseOutgoingCookies(headers) {
  const rows = []; let truncated = false, chars = 0, pairs = 0;
  if (!Array.isArray(headers)) return { rows, truncated: true };
  if (headers.length > LIMITS.headerCount) truncated = true;
  for (let index = 0; index < Math.min(headers.length, LIMITS.headerCount); ++index) {
    const header = own(headers, index), name = own(header, 'name');
    if (typeof name !== 'string' || name.length > 64 || name.toLowerCase() !== 'cookie') continue;
    // Values of Authorization, Set-Cookie and every unrelated header are never read.
    const raw = own(header, 'value');
    if (typeof raw !== 'string' || raw.length > LIMITS.headerChars - chars || /[\r\n\0]/.test(raw)) { truncated = true; continue; }
    chars += raw.length;
    let position = 0;
    while (position < raw.length) {
      if (++pairs > LIMITS.pairs) { truncated = true; break; }
      let end = raw.indexOf(';', position); if (end < 0) end = raw.length;
      let start = position; while (start < end && (raw[start] === ' ' || raw[start] === '\t')) ++start;
      const equal = raw.indexOf('=', start);
      if (equal >= start && equal < end) {
        const cookieName = raw.slice(start, equal), value = raw.slice(equal + 1, end);
        // Oversized values are omitted, never presented as complete clipped strings.
        if (validProCookieName(cookieName) && validProCookieValue(value)) rows.push({ name: cookieName, value }); else truncated = true;
      } else if (start < end) truncated = true;
      position = end + 1;
    }
    if (pairs > LIMITS.pairs) break;
  }
  return { rows, truncated };
}

export class ProCookieValuesObserver {
  constructor(runtime, helpers = {}) { this.runtime = runtime; this.site = helpers.site ?? (() => null); this.timers = helpers.timers ?? globalThis; }
  supported = false;
  windowAt = 0;
  windowCount = 0;
  pending = new Map();
  pendingBytes = 0;
  pendingTimer = null;
  setSupported(value) { this.supported = value === true && this.runtime.api.__detectExpertCapabilities?.networkDocumentIdentity !== false; }
  beginPage(page) {
    const pro = this.runtime.pro;
    if (!pro.checkDeadline() || !this.runtime.scope.hasDataConsent) return;
    const snapshot = { documentKey: page.documentKey, rows: [], truncated: false, supported: this.supported };
    if (pro.size('cookieValues:' + page.id, 512)) { page.cookieValues = snapshot; pro.mark(); }
  }
  clear() {
    this.stop();
    const pro = this.runtime.pro;
    for (const page of pro?.session?.pages ?? []) if (page.cookieValues) { delete page.cookieValues; pro.size('cookieValues:' + page.id, 0); }
    pro?.mark();
  }
  forget(key) {
    for (const [id, item] of this.pending) if (item.documentKey === key) this.dropPending(id);
    const pro = this.runtime.pro;
    for (const page of pro?.session?.pages ?? []) if (page.cookieValues?.rows.some(row => row.documentKey === key)) {
      const snapshot = { ...page.cookieValues, rows: page.cookieValues.rows.filter(row => row.documentKey !== key) };
      if (pro.size('cookieValues:' + page.id, snapshot.rows.reduce((bytes, row) => bytes + proCookieRowBytes(row), 512))) page.cookieValues = snapshot;
    }
    pro?.mark();
  }
  stop() {
    this.timers.clearTimeout(this.pendingTimer); this.pendingTimer = null;
    this.pending.clear(); this.pendingBytes = 0;
    this.runtime.pro?.size('cookieValues:pending', 0);
  }
  gap(page) {
    const pro = this.runtime.pro;
    if (!pro.checkDeadline()) return;
    if (page && !page.cookieValues?.truncated) {
      page.cookieValues = { ...(page.cookieValues ?? { documentKey: page.documentKey, rows: [], supported: this.supported }), truncated: true };
    }
    pro.limit('event-limit'); pro.mark();
  }
  dropPending(id) {
    const item = this.pending.get(id);
    if (item) { this.pendingBytes -= item.bytes; this.pending.delete(id); this.runtime.pro.size('cookieValues:pending', this.pendingBytes); this.schedulePending(); }
  }
  schedulePending() {
    this.timers.clearTimeout(this.pendingTimer); this.pendingTimer = null;
    if (!this.pending.size) return;
    let expiresAt = Infinity;
    for (const item of this.pending.values()) expiresAt = Math.min(expiresAt, item.receivedAt + 10000);
    this.pendingTimer = this.timers.setTimeout(() => { this.pendingTimer = null; this.prune(); this.schedulePending(); }, Math.max(1, expiresAt - this.runtime.now()));
    this.pendingTimer?.unref?.();
  }
  prune() {
    const runtime = this.runtime, pro = runtime.pro, now = runtime.now();
    for (const [id, item] of this.pending) if (item.session !== pro.session || item.generation !== runtime.scope.accessGeneration || !runtime.scope.hasDataConsent || !pro.trackedTabs.has(item.tabId) || !pro.checkDeadline() || now - item.receivedAt >= 10000 || pro.requests?.get(id) !== item.request) {
      this.dropPending(id); this.gap(pro.pageFor(item.tabId));
    }
  }
  queue(details, destination, at) {
    const runtime = this.runtime, pro = runtime.pro, tabId = own(details, 'tabId'), frameId = own(details, 'frameId'), documentId = own(details, 'documentId');
    const requestId = own(details, 'requestId'), request = pro.requests?.get(requestId), page = pro.pageFor(tabId);
    if (page && !runtime.canObserveNetworkDocument(page.documentKey)) return;
    const destinationSite = this.site(destination.hostname) ?? destination.hostname;
    if (!id(documentId) || !request || request.tabId !== tabId || request.target?.domain !== destinationSite || request.target?.scheme !== destination.protocol.slice(0, -1) || request.at > at || (own(details, 'type') === 'main_frame' ? !pro.sameSite(request.target) : !page || request.pageId !== page.id)) { this.gap(page); return; }
    const parsed = parseOutgoingCookies(own(details, 'requestHeaders'));
    if (!parsed.rows.length && !parsed.truncated) return;
    this.prune();
    if (this.pending.has(requestId)) { this.dropPending(requestId); this.gap(page); }
    const bytes = 512 + JSON.stringify(parsed).length * 2;
    if (this.pending.size >= 32 || bytes + this.pendingBytes > 131072 || !pro.size('cookieValues:pending', bytes + this.pendingBytes) || !pro.checkDeadline()) { this.gap(page); return; }
    this.pending.set(requestId, { request, session: pro.session, generation: runtime.scope.accessGeneration, tabId, frameId,
      documentKey: tabId + ':' + frameId + ':' + documentId, destinationHost: destination.hostname, scheme: destination.protocol.slice(0, -1), at, receivedAt: runtime.now(), parsed, bytes, committed: false });
    this.pendingBytes += bytes;
    this.schedulePending();
  }
  onEvent(event) {
    this.prune();
    const runtime = this.runtime, pro = runtime.pro;
    for (const [requestId, item] of this.pending) {
      if (event.type === 'navigation:committed' && item.tabId === event.tabId && item.frameId === event.frameId) {
        if (item.documentKey !== event.tabId + ':' + event.frameId + ':' + event.documentId) { this.dropPending(requestId); this.gap(pro.pageFor(item.tabId)); continue; }
        item.committed = true;
      }
      const page = pro.pageFor(item.tabId);
      if (!item.committed || !page || page.endedAt !== null || item.request.pageId !== page.id || !pro.belongsToPage(item.documentKey, page) || !runtime.canObserveNetworkDocument(item.documentKey) || !runtime.canObserveNetworkDocument(page.documentKey)) continue;
      if (!runtime.scope.isHostGrantedSync(item.destinationHost, item.scheme)) { this.dropPending(requestId); this.gap(page); continue; }
      this.dropPending(requestId);
      this.retain(page, item.documentKey, item.destinationHost, item.at, item.parsed);
    }
  }
  observe(details) {
    const runtime = this.runtime, pro = runtime.pro;
    // Reject before reading any header, and never buffer raw headers during hydration.
    if (!this.supported || !runtime.isReady || !runtime.scope.hasDataConsent || !runtime.scope.accessReady || !pro.hydrated || !pro.checkDeadline()) return;
    const tabId = own(details, 'tabId'), frameId = own(details, 'frameId'), documentId = own(details, 'documentId'), lifecycle = own(details, 'documentLifecycle');
    if (!integer(tabId) || !integer(frameId) || lifecycle && lifecycle !== 'active' || !pro.trackedTabs.has(tabId)) return;
    const page = pro.pageFor(tabId), timestamp = own(details, 'timeStamp');
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp < 0 || timestamp > runtime.now() + 1000 || timestamp > pro.session.deadlineAt) return;
    const at = Math.floor(timestamp), navigation = ['main_frame', 'sub_frame'].includes(own(details, 'type'));
    if (at < (navigation ? pro.session.startedAt : page?.startedAt) || !navigation && (!page || page.endedAt !== null || !id(documentId))) return;
    const key = tabId + ':' + frameId + ':' + documentId;
    if (!navigation && (!pro.belongsToPage(key, page) || !runtime.canObserveNetworkDocument(key) || !runtime.canObserveNetworkDocument(page.documentKey) || runtime.getProjection(tabId, frameId)?.documentKey !== key)) return;
    const rawUrl = own(details, 'url'); if (typeof rawUrl !== 'string' || rawUrl.length > 65536) return;
    let destination;
    try { destination = new URL(rawUrl); } catch { return; }
    if (!['http:', 'https:'].includes(destination.protocol) || destination.username || destination.password || !runtime.scope.isHostGrantedSync(destination.hostname, destination.protocol.slice(0, -1))) return;
    if (navigation) { this.queue(details, destination, at); return; }
    const now = Math.floor(runtime.now());
    if (now < page.startedAt || now > pro.session.deadlineAt) return;
    if (now < this.windowAt || now - this.windowAt >= 1000) { this.windowAt = now; this.windowCount = 0; }
    if (++this.windowCount > 200) {
      this.gap(page);
      return;
    }
    const parsed = parseOutgoingCookies(own(details, 'requestHeaders'));
    this.retain(page, key, destination.hostname, at, parsed);
  }
  retain(page, key, destinationHost, at, parsed) {
    const pro = this.runtime.pro, current = page.cookieValues ?? { documentKey: page.documentKey, rows: [], truncated: false, supported: true };
    if (!parsed.rows.length && !parsed.truncated) return;
    const rows = current.rows.map(row => ({ ...row })), indexed = new Map(rows.map(row => [proCookieRowKey(row), row]));
    let bytes = rows.reduce((total, row) => total + proCookieRowBytes(row), 512), truncated = current.truncated || parsed.truncated;
    for (const pair of parsed.rows) {
      const row = { documentKey: key, destinationHost, ...pair, count: 1, firstSeenAt: at, lastSeenAt: at };
      const rowKey = proCookieRowKey(row), previous = indexed.get(rowKey);
      if (previous) {
        const updated = { ...previous, count: Math.min(2147483647, previous.count + 1), firstSeenAt: Math.min(previous.firstSeenAt, at), lastSeenAt: Math.max(previous.lastSeenAt, at) };
        const newBytes = bytes - proCookieRowBytes(previous) + proCookieRowBytes(updated);
        if (newBytes > LIMITS.bytes) { truncated = true; continue; }
        Object.assign(previous, updated); bytes = newBytes; continue;
      }
      const cost = proCookieRowBytes(row);
      if (rows.length >= LIMITS.rows || bytes + cost > LIMITS.bytes) { truncated = true; continue; }
      bytes += cost; rows.push(row); indexed.set(rowKey, row);
    }
    const snapshot = readProCookieValues({ documentKey: page.documentKey, rows, truncated, supported: true });
    if (!snapshot || !pro.checkDeadline() || pro.pageFor(page.tabId) !== page || !pro.size('cookieValues:' + page.id, bytes) || !pro.checkDeadline()) return;
    page.cookieValues = snapshot;
    if (truncated) pro.limit('event-limit');
    pro.mark();
  }
}
