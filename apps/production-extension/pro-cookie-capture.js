// ADR-025/026/028 / REQ-004/005/011/012: bounded Pro metadata without an open UI.
import { readSocialSnapshot } from './inspection-contracts.js';
import { captureAdvancedChannels } from './pro-advanced-capture.js';
const MAX_CAPTURES = 2;
const MAX_PAGES = 16;
const REFRESH_MS = 5000;
const POLL_MS = 750;
const WAIT_MS = 6000;

export class ProCookieCapture {
  constructor(pro, timers = globalThis) { this.pro = pro; this.timers = timers; }
  epoch = 0;
  running = false;
  timer = null;
  requested = false;
  cursor = 0;
  nextAt = new Map();
  pending = new Map();
  inventoryRead = new Set();

  start() {
    this.stop();
    this.running = true;
    this.request();
  }
  stop() {
    ++this.epoch;
    this.running = false;
    this.requested = false;
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
    this.nextAt.clear();
    this.inventoryRead.clear();
    this.cursor = 0;
    // Unsettled physical operations keep their slots after cancellation.
  }
  active() { return this.running && this.pro.checkDeadline(); }
  current(session, page, epoch, generation, cookieEpoch) {
    const runtime = this.pro.runtime;
    if (epoch !== this.epoch || !this.active() || this.pro.session !== session || this.pro.session.id !== session.id ||
        runtime.scope.accessGeneration !== generation || runtime.cookies.epoch !== cookieEpoch || !runtime.scope.hasDataConsent ||
        this.pro.pageFor(page.tabId) !== page || page.endedAt !== null) return false;
    const projection = runtime.getProjection(page.tabId, 0);
    return projection?.documentKey === page.documentKey && !['paused', 'no-access', 'unsupported'].includes(projection.coverageState) &&
      runtime.canObserveNetworkDocument(page.documentKey);
  }
  request() {
    if (!this.running || this.requested) return;
    this.requested = true;
    const epoch = this.epoch;
    // Navigation observers commit the authoritative document before this turn.
    Promise.resolve().then(() => {
      if (epoch !== this.epoch) return;
      this.requested = false;
      this.capture().catch(() => {});
    });
  }
  schedule() {
    if (!this.active() || this.timer !== null) return;
    const epoch = this.epoch;
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      if (epoch === this.epoch) this.capture().catch(() => {});
    }, POLL_MS);
  }
  async capture(force = false) {
    if (!this.active()) return;
    const pro = this.pro, runtime = pro.runtime, session = pro.session, epoch = this.epoch;
    const generation = runtime.scope.accessGeneration, cookieEpoch = runtime.cookies.epoch;
    const pages = [...pro.currentPages.values()].slice(0, MAX_PAGES).map(id => pro.pageById(id)).filter(Boolean);
    const live = new Set(pages.map(page => page.id));
    for (const key of this.inventoryRead) if (!runtime.canObserveNetworkDocument(key)) this.inventoryRead.delete(key);
    for (const key of this.nextAt.keys()) if (!live.has(key)) this.nextAt.delete(key);
    const now = runtime.now();
    try {
      const start = pages.length ? this.cursor % pages.length : 0;
      for (let offset = 0; offset < pages.length && this.pending.size < MAX_CAPTURES; ++offset) {
        const index = (start + offset) % pages.length, page = pages[index];
        this.cursor = index + 1;
        if (!Number.isSafeInteger(page.tabId) || !/^[0-9]+:0:[A-Za-z0-9_-]{1,64}$/.test(page.documentKey) || !page.documentKey.startsWith(page.tabId + ':0:') ||
            !this.current(session, page, epoch, generation, cookieEpoch) || !force && (this.nextAt.get(page.id) ?? 0) > now ||
            [...this.pending.values()].some(token => token.page === page)) continue;
        this.nextAt.set(page.id, now + REFRESH_MS);
        const token = { page, promise: null }, key = session.id + '|' + epoch + '|' + page.id;
        const context = { key, current: () => this.current(session, page, epoch, generation, cookieEpoch) };
        const request = { schemaVersion: 1, type: 'ui-get-cookies', tabId: page.tabId, frameId: 0, documentKey: page.documentKey };
        const work = Promise.resolve().then(async () => {
          if (!context.current()) return;
          // Independent metadata channels retain their own access checks.
          try { await runtime.cookies.read(request, context); } catch {}
          if (context.current()) await captureAdvancedChannels(pro, page, request, context, this.inventoryRead);
          if (!context.current() || !runtime.social) return;
          const requests = [request]; let documentOverflow = false;
          for (const report of runtime.state?.reports?.values() ?? []) {
            if (report.tabId === page.tabId && report.frameId > 0 && pro.belongsToPage?.(report.documentKey, page) &&
                runtime.getProjection(page.tabId, report.frameId)?.documentKey === report.documentKey && runtime.canObserveNetworkDocument(report.documentKey)) {
              if (requests.length >= 24) { documentOverflow = true; break; }
              requests.push({ ...request, frameId: report.frameId, documentKey: report.documentKey });
            }
          }
          const documents = []; let remaining = 256;
          for (const target of requests) {
            if (!context.current()) return;
            const social = readSocialSnapshot(await runtime.social.read({ ...target, type: 'ui-get-social-networks' }));
            if (!context.current()) return;
            if (!social || social.documentKey !== target.documentKey || !['active', 'partial', 'late-start', 'degraded'].includes(social.coverageState) ||
                runtime.getProjection(page.tabId, target.frameId)?.documentKey !== target.documentKey || !runtime.canObserveNetworkDocument(target.documentKey)) continue;
            documents.push({ ...social, rows: social.rows.slice(0, remaining), truncated: social.truncated || social.rows.length > remaining });
            remaining -= documents.at(-1).rows.length;
          }
          if (documentOverflow && documents.length) documents[0].truncated = true;
          const bytes = 256 + JSON.stringify(documents).length * 2;
          if (documents.length && pro.size('social:' + page.id, bytes) && context.current()) {
            page.socialNetworks = documents; pro.mark();
            try { await pro.flush(); }
            finally {
              if (!context.current() && page.socialNetworks === documents) {
                delete page.socialNetworks;
                if (pro.session === session) { pro.size('social:' + page.id, 0); pro.mark(); await pro.flush(); }
              }
            }
          }
        });
        token.promise = work;
        this.pending.set(key, token);
        const release = () => { if (this.pending.get(key) === token) this.pending.delete(key); };
        work.then(release, release);
      }
      const work = [...this.pending.values()].map(token => token.promise);
      if (work.length) {
        let timeout;
        try { await Promise.race([Promise.allSettled(work), new Promise(resolve => { timeout = this.timers.setTimeout(resolve, WAIT_MS); })]); }
        finally { if (timeout !== undefined) this.timers.clearTimeout(timeout); }
      }
    } finally {
      if (epoch === this.epoch) this.schedule();
    }
  }
}
