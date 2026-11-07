import { mergeResponseHeaders } from '@detect-expert/contracts';
import type { ResponseHeadersSummary } from '@detect-expert/contracts';
import { attachResponseHeaders } from '../../engine/src/projection';
// ADR-023: explicit, bounded browser-session recording. MAIN cannot control this manager.
import { MAX_COUNT, PRO_LIMITS, counterKey, validateProRequest, validateProSession } from '@detect-expert/contracts';
import type { CounterEntry, ProLimitation, ProPage, ProSession, ProStateResponse, ReportProjection, UiErrorResponse } from '@detect-expert/contracts';
import { lookupVendorResourceRule, matchVendorResource } from '../../catalog/src/index';
import { registrableDomain, toAsciiHost } from '../../attribution/src/index';
import type { BackgroundRuntime } from './runtime';
import type { DocumentEvent, DocumentsState } from './documents';
import type { NavigationDetailsLike, RequestDetailsLike, TabDetailsLike } from './chrome-api';
import { verifyUiSender } from './sender';
import type { MessageSenderLike } from './chrome-api';
import { safeProResourceUrl, safeProTitle, safeProUrl } from './pro-redaction';
import type { SafeProUrl } from './pro-redaction';
import { createProCounterHistory, mergeProCounterHistory, readProCounterHistory } from './pro-counter-history';
import type { ProCounterHistory } from './pro-counter-history';
import { mergeVendorSummaries } from './projection';
import { addRequestedLocalPort } from './network-counters';

export const PRO_STORAGE_KEY = 'pro-recording-v1';
export const PRO_ALARM_NAME = 'detect-expert-pro-deadline';
export const PRO_NETWORK_FILTER = { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] };
const TYPES = new Set(['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport', 'other']);
const MAX_PENDING = 256;
const MAX_INFLIGHT = 512;
const MAX_EVENTS = 50000;
const PERSIST_MS = 250;
type Result = ProStateResponse | UiErrorResponse;
type Phase = 'before' | 'completed' | 'redirect' | 'error';
interface Baseline { pageId: string; documentKey: string; counts: Array<[string, number]>; browserCounts: Array<[string, number]>; vendors: string[]; rtcKeys: string[]; localPortsIncomplete?: boolean }
interface Request {
  id: string; tabId: number; pageId: string | null; resourceId: string | null; target: SafeProUrl; type: string;
  documentKey: string | null;
  /** Reviewed constant IDs only; preserves early completion until browser ancestry is bound. */
  ruleIds: string[];
  at: number; completed: number; failed: number; redirects: number; status: number | null; endedAt: number | null;
}
interface Stored { version: 1; session: ProSession; trackedTabs: number[]; currentPages: Array<[number, string]>; baselines: Baseline[]; requests: Request[]; counterHistory: ProCounterHistory[]; events: number }
const sat = (a: number, b = 1): number => Math.min(MAX_COUNT, a + b);
const error = (code: UiErrorResponse['code']): UiErrorResponse => ({ schemaVersion: 1, type: 'error', code });
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export class ProRecordingManager {
  private session: ProSession | null = null;
  private readonly trackedTabs = new Set<number>();
  private readonly currentPages = new Map<number, string>();
  private readonly baselines = new Map<string, Baseline>();
  private readonly requests = new Map<string, Request>();
  private readonly counterHistory = new Map<string, ProCounterHistory>();
  private readonly pending: Array<() => void> = [];
  private hydrated = false;
  private disposed = false;
  private commandBusy = false;
  private commandEpoch = 0;
  private events = 0;
  private pendingDropped = 0;
  private revision = 0;
  private persistedRevision = 0;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  private write: Promise<void> | null = null;
  private alarmOperation: Promise<void> = Promise.resolve();
  private nextPage = 1;
  private nextResource = 1;
  private estimatedBytes = 4096;
  private readonly sizes = new Map<string, number>();

  constructor(private readonly runtime: BackgroundRuntime) {}
  hasSession(): boolean { return this.session !== null; }

  headerPeriod(tabId: number, documentKey?: string): { sessionId: string; pageId: string } | null {
    if (!this.hydrated || !this.checkDeadline()) return null;
    const page = this.pageFor(tabId);
    return page && (documentKey === undefined || page.documentKey === documentKey) ? { sessionId: this.session!.id, pageId: page.id } : null;
  }

  async start(): Promise<void> {
    try {
      const saved = (await this.runtime.api.storage.session.get(PRO_STORAGE_KEY))[PRO_STORAGE_KEY];
      this.restore(saved);
    } catch { /* Empty startup remains usable; later writes are checked. */ }
    this.hydrated = true;
    if (this.session?.status === 'recording') {
      this.limit('service-worker-restarted');
      if (this.runtime.now() >= this.session.deadlineAt) this.finish('timeout', this.session.deadlineAt);
      else {
        // Reconcile browser identities before accepting a resumed tab's new requests.
        const tabs = await this.runtime.api.tabs.query({}).catch(() => []);
        const live = new Set(tabs.flatMap(t => typeof t.id === 'number' ? [t.id] : []));
        for (const tabId of this.trackedTabs) if (!live.has(tabId)) { this.closePage(tabId); this.trackedTabs.delete(tabId); }
        for (const tab of tabs) if (typeof tab.id === 'number' && this.trackedTabs.has(tab.id)) {
          const frames = await this.runtime.api.webNavigation.getAllFrames({ tabId: tab.id }).catch(() => null);
          const top = frames?.find(f => f.frameId === 0 && f.documentLifecycle !== 'prerender' && f.documentLifecycle !== 'cached');
          const safe = safeProUrl(top?.url ?? tab.url);
          const current = this.pageFor(tab.id);
          if (!safe || !this.sameSite(safe)) this.closePage(tab.id);
          else if (top?.documentId && (!current || current.documentKey !== `${tab.id}:0:${top.documentId}` || current.url !== safe.url)) {
            this.limit('navigation-gap');
            this.newPage(tab.id, `${tab.id}:0:${top.documentId}`, safe, this.runtime.now(), true);
          }
        }
        if (this.trackedTabs.size === 0) this.finish('tab-closed');
        else if (!this.rootAccess()) { this.limit('permission-limited'); this.finish('access-revoked'); }
        else {
          this.armDeadline();
          // Light ACKs may have committed just before worker suspension, ahead of the debounced Pro write.
          const before = { ...this.runtime.state, reports: new Map() };
          for (const binding of this.runtime.state.bindings.values()) if (this.currentPages.has(binding.tabId)) {
            this.afterEvent({ type: 'scope:access', documentKey: binding.documentKey, host: binding.host, accessGranted: true, at: this.runtime.now() }, before);
          }
        }
      }
    }
    for (const action of this.pending.splice(0)) action();
    if (this.session && this.pendingDropped > 0) { this.limit('event-limit'); this.session.dropped.events = sat(this.session.dropped.events, this.pendingDropped); }
    this.pendingDropped = 0;
    if (this.session) { this.mark(); await this.flush(); }
  }

  private restore(value: unknown): void {
    if (!record(value) || value['version'] !== 1) return;
    const checked = validateProSession(value['session']);
    if (!checked.ok) return;
    const session = checked.value;
    // Session bounds are checked by the contracts validator before serialization.
    if (JSON.stringify(session).length * 2 > PRO_LIMITS.maxBytes) return;
    this.session = session;
    const tabs = value['trackedTabs'];
    if (Array.isArray(tabs) && tabs.length <= PRO_LIMITS.maxTabs) for (const id of tabs) if (Number.isSafeInteger(id) && id >= 0) this.trackedTabs.add(id);
    const pages = value['currentPages'];
    if (Array.isArray(pages) && pages.length <= PRO_LIMITS.maxTabs) for (const pair of pages) {
      if (Array.isArray(pair) && pair.length === 2 && this.trackedTabs.has(pair[0]) && session.pages.some(p => p.id === pair[1] && p.tabId === pair[0] && p.endedAt === null)) this.currentPages.set(pair[0], pair[1]);
    }
    const baselines = value['baselines'];
    if (Array.isArray(baselines) && baselines.length <= PRO_LIMITS.maxTabs * PRO_LIMITS.maxDocumentsPerPage) for (const b of baselines) {
      if (!record(b) || typeof b['pageId'] !== 'string' || typeof b['documentKey'] !== 'string' || b['documentKey'].length > 128 || ![...this.currentPages.values()].includes(b['pageId']) || !Array.isArray(b['counts']) || b['counts'].length > 128 || !Array.isArray(b['vendors']) || b['vendors'].length > 128) continue;
      const counts: Baseline['counts'] = [];
      for (const pair of b['counts']) if (Array.isArray(pair) && typeof pair[0] === 'string' && pair[0].length <= 512 && /^[A-Za-z0-9.|,_-]+$/.test(pair[0]) && Number.isSafeInteger(pair[1]) && pair[1] >= 0 && pair[1] <= MAX_COUNT) counts.push([pair[0], pair[1]]);
      const vendors = b['vendors'].filter((v): v is string => typeof v === 'string' && /^[a-z0-9_-]{1,64}$/i.test(v));
      const rtcKeys = Array.isArray(b['rtcKeys']) ? b['rtcKeys'].slice(0, 256).filter((v): v is string => typeof v === 'string' && /^[a-z0-9_:-]{1,128}$/i.test(v)) : [];
      const browserCounts: Baseline['browserCounts'] = [];
      if (Object.hasOwn(b, 'browserCounts')) {
        const entries = b['browserCounts'], seen = new Set<string>();
        if (!Array.isArray(entries) || entries.length > 4) { this.limit('storage-error'); this.finish('storage-error'); return; }
        for (const pair of entries) {
          if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' ||
            !/^(?:DET-058\|attempted\|api-use|DET-060\|attempted\|api-use(?:,local-multi-port)?|DET-061\|attempted\|api-use,unique-subdomains)$/.test(pair[0]) ||
            seen.has(pair[0]) || !Number.isSafeInteger(pair[1]) || pair[1] < 0 || pair[1] > MAX_COUNT) {
            this.limit('storage-error'); this.finish('storage-error'); return;
          }
          seen.add(pair[0]); browserCounts.push([pair[0], pair[1]]);
        }
      }
      const baseline: Baseline = { pageId: b['pageId'], documentKey: b['documentKey'], counts, browserCounts, vendors, rtcKeys };
      const portsIncomplete = Object.getOwnPropertyDescriptor(b, 'localPortsIncomplete');
      if (portsIncomplete) {
        if (!portsIncomplete.enumerable || !Object.hasOwn(portsIncomplete, 'value') || typeof portsIncomplete.value !== 'boolean') {
          this.limit('storage-error'); this.finish('storage-error'); return;
        }
        baseline.localPortsIncomplete = portsIncomplete.value as boolean;
      }
      this.baselines.set(baseline.pageId + '|' + baseline.documentKey, baseline);
    }
    // Unfinished requests survive worker suspension with only already-redacted browser metadata.
    const requests = value['requests'];
    if (Array.isArray(requests) && requests.length <= MAX_INFLIGHT) for (const r of requests) {
      if (!record(r) || typeof r['id'] !== 'string' || !/^[a-z0-9_.:-]{1,128}$/i.test(r['id']) || !Number.isSafeInteger(r['tabId']) || !this.trackedTabs.has(r['tabId'] as number) || !record(r['target']) || !TYPES.has(r['type'] as string)) continue;
      const target = safeProUrl(r['target']['url']);
      if (!target || target.url !== r['target']['url'] || typeof r['at'] !== 'number' || r['at'] < session.startedAt || r['at'] > session.deadlineAt) continue;
      const pageId = typeof r['pageId'] === 'string' && session.pages.some(p => p.id === r['pageId']) ? r['pageId'] : null;
      const resourceId = typeof r['resourceId'] === 'string' && session.pages.some(p => p.id === pageId && p.resources.some(resource => resource.id === r['resourceId'])) ? r['resourceId'] : null;
      const documentKey = typeof r['documentKey'] === 'string' && r['documentKey'].length <= 128 && /^[A-Za-z0-9_:.-]+$/.test(r['documentKey']) ? r['documentKey'] : null;
      const bit = (n: unknown): number => n === 1 ? 1 : 0;
      const endedAt = typeof r['endedAt'] === 'number' && Number.isSafeInteger(r['endedAt']) && r['endedAt'] >= r['at'] && r['endedAt'] <= session.deadlineAt ? r['endedAt'] : null;
      const status = typeof r['status'] === 'number' && Number.isInteger(r['status']) && r['status'] >= 100 && r['status'] <= 599 ? r['status'] : null;
      const ruleIds = Array.isArray(r['ruleIds']) ? r['ruleIds'].slice(0, 32).filter((id): id is string => typeof id === 'string' && lookupVendorResourceRule(id, this.runtime.now()) !== null) : [];
      this.requests.set(r['id'], { id: r['id'], tabId: r['tabId'] as number, pageId, resourceId, documentKey, ruleIds, target, type: r['type'] as string, at: r['at'], completed: bit(r['completed']), failed: bit(r['failed']), redirects: bit(r['redirects']), status, endedAt });
    }
    this.events = typeof value['events'] === 'number' && Number.isSafeInteger(value['events']) ? Math.max(0, Math.min(MAX_EVENTS, value['events'])) : 0;
    this.nextPage = session.pages.length + 1;
    this.nextResource = session.pages.reduce((n, p) => n + p.resources.length, 0) + 1;
    for (const page of session.pages) {
      this.size('page:' + page.id, 2048);
      for (const report of page.reports) this.size('report:' + page.id + '|' + report.documentKey, JSON.stringify(report).length * 2 + 256);
      for (const resource of page.resources) this.size('resource:' + resource.id, 1024 + 2 * (resource.url.length + resource.domain.length));
    }
    for (const [key, base] of this.baselines) this.size('baseline:' + key, JSON.stringify(base).length * 2 + 128);
    for (const [key, request] of this.requests) this.size('request:' + key, JSON.stringify(request).length * 2 + 256);
    const histories = value['counterHistory'];
    if (histories !== undefined) {
      if (!Array.isArray(histories) || histories.length > PRO_LIMITS.maxTabs * PRO_LIMITS.maxDocumentsPerPage) { this.limit('storage-error'); this.finish('storage-error'); }
      else for (const raw of histories) {
        const history = readProCounterHistory(raw);
        if (!history || !this.currentPages.has(history.tabId) || this.counterHistory.has(history.documentKey)) { this.limit('storage-error'); this.finish('storage-error'); break; }
        if (this.size('history:' + history.documentKey, JSON.stringify(history).length * 2 + 256)) this.counterHistory.set(history.documentKey, history);
      }
    }
  }

  route(message: unknown, sender: MessageSenderLike): Promise<Result> | null {
    if (!record(message) || typeof message['type'] !== 'string' || !message['type'].startsWith('ui-pro-')) return null;
    if (!verifyUiSender(sender, this.runtime.api.runtime.id)) return Promise.resolve(error('unauthorized-sender'));
    const checked = validateProRequest(message);
    if (!checked.ok) return Promise.resolve(error('invalid-request'));
    return (async () => {
      await this.runtime.whenReady();
      const request = checked.value;
      this.checkDeadline();
      if (request.type === 'ui-pro-get') return this.stateResponse(request.tabId);
      if (this.commandBusy) return error('invalid-request');
      this.commandBusy = true;
      try {
        if (request.type === 'ui-pro-start') return await this.begin(request.tabId);
        if (!this.session || this.session.id !== request.sessionId) return error('stale-revision');
        if (request.type === 'ui-pro-stop') { this.finish('manual'); await this.flush(); return this.stateResponse(); }
        await this.clear();
        return this.stateResponse();
      } finally { this.commandBusy = false; }
    })();
  }

  private async currentTab(tabId: number): Promise<{ safe: SafeProUrl; permissionHost: string; tab: TabDetailsLike; documentId: string } | null> {
    if (!Number.isSafeInteger(tabId) || tabId < 0) return null;
    const generation = this.runtime.scope.accessGeneration;
    if (!this.runtime.scope.accessReady) return null;
    const tab = this.runtime.api.tabs.get ? await this.runtime.api.tabs.get(tabId).catch(() => null) : (await this.runtime.api.tabs.query({}).catch(() => [])).find(t => t.id === tabId) ?? null;
    if (!this.runtime.scope.accessReady || generation !== this.runtime.scope.accessGeneration) return null;
    const frames = await this.runtime.api.webNavigation.getAllFrames({ tabId }).catch(() => null);
    if (!this.runtime.scope.accessReady || generation !== this.runtime.scope.accessGeneration) return null;
    const top = frames?.find(f => f.frameId === 0 && f.documentLifecycle !== 'prerender' && f.documentLifecycle !== 'cached');
    const safe = safeProUrl(top?.url ?? tab?.url);
    const permissionHost = toAsciiHost(top?.url ?? tab?.url);
    return safe && permissionHost && typeof top?.documentId === 'string' ? { safe, permissionHost, tab: tab ?? {}, documentId: top.documentId } : null;
  }

  private async stateResponse(tabId?: number): Promise<ProStateResponse> {
    const current = tabId === undefined ? null : await this.currentTab(tabId);
    this.checkDeadline();
    return { schemaVersion: 1, type: 'pro-state', session: this.session === null ? null : structuredClone(this.session), currentDomain: current?.safe.domain ?? null,
      canStart: !!current && this.session?.status !== 'recording' && this.runtime.scope.hasAnyHostAccess() && this.runtime.scope.inScope(current.permissionHost, tabId!, current.documentId, current.safe.scheme) };
  }

  private async begin(tabId: number): Promise<Result> {
    if (this.session?.status === 'recording') return error('invalid-request');
    const epoch = this.commandEpoch;
    const current = await this.currentTab(tabId);
    if (epoch !== this.commandEpoch) return error('stale-revision');
    if (!current || !this.runtime.scope.inScope(current.permissionHost, tabId, current.documentId, current.safe.scheme)) return error('no-access');
    const now = this.runtime.now();
    this.resetMemory();
    this.session = { schemaVersion: 1, id: crypto.randomUUID(), domain: current.safe.domain, siteKey: current.safe.siteKey, startTabId: tabId,
      status: 'recording', startedAt: now, deadlineAt: now + PRO_LIMITS.durationMs, stoppedAt: null, stopReason: null, pages: [],
      limitations: ['started-mid-page', 'unsupported-contexts', 'redacted-urls'], dropped: { pages: 0, resources: 0, documents: 0, events: 0 } };
    if (!this.runtime.scope.getState().grantedAllSites) this.limit('permission-limited');
    this.trackedTabs.add(tabId);
    const page = this.newPage(tabId, `${tabId}:0:${current.documentId}`, current.safe, now, true);
    if (page && safeProUrl(current.tab.url)?.url === current.safe.url) page.title = safeProTitle(current.tab.title);
    this.armDeadline();
    this.mark();
    await this.flush();
    return this.stateResponse(tabId);
  }

  async clear(): Promise<void> {
    this.commandEpoch++;
    this.pending.length = 0;
    this.pendingDropped = 0;
    this.resetMemory();
    this.session = null;
    this.mark();
    await this.flush();
  }

  private resetMemory(): void {
    this.trackedTabs.clear(); this.currentPages.clear(); this.baselines.clear(); this.requests.clear(); this.counterHistory.clear();
    this.events = 0; this.nextPage = 1; this.nextResource = 1;
    this.sizes.clear(); this.estimatedBytes = 4096;
    this.cancelDeadline();
  }

  private limit(limitation: ProLimitation): void {
    if (this.session && !this.session.limitations.includes(limitation)) this.session.limitations.push(limitation);
  }

  private checkDeadline(): boolean {
    if (!this.runtime.scope.hasDataConsent || !this.session || this.session.status !== 'recording' || this.disposed) return false;
    if (this.runtime.now() >= this.session.deadlineAt) { this.finish('timeout', this.session.deadlineAt); return false; }
    return true;
  }

  onAlarm(name: string): void { if (name === PRO_ALARM_NAME) { this.enqueue(() => { this.checkDeadline(); void this.flush(); }); } }

  private armDeadline(): void {
    if (this.deadlineTimer !== null) { clearTimeout(this.deadlineTimer); this.deadlineTimer = null; }
    const session = this.session;
    if (!session || session.status !== 'recording') return;
    this.alarmOperation = this.alarmOperation.then(async () => {
      if (this.session?.id !== session.id || this.session.status !== 'recording') return;
      await this.runtime.api.alarms?.create(PRO_ALARM_NAME, { when: session.deadlineAt });
    }).catch(() => this.limit('unsupported-contexts'));
    this.deadlineTimer = setTimeout(() => { this.deadlineTimer = null; this.checkDeadline(); void this.flush(); }, Math.max(0, session.deadlineAt - this.runtime.now()));
  }

  private cancelDeadline(): void {
    if (this.deadlineTimer !== null) { clearTimeout(this.deadlineTimer); this.deadlineTimer = null; }
    this.alarmOperation = this.alarmOperation.then(async () => { await this.runtime.api.alarms?.clear(PRO_ALARM_NAME); }).catch(() => undefined);
  }

  private finish(reason: NonNullable<ProSession['stopReason']>, at = this.runtime.now()): void {
    if (!this.session || this.session.status !== 'recording') return;
    const ended = Math.max(this.session.startedAt, Math.min(this.session.deadlineAt, at));
    for (const tabId of this.currentPages.keys()) this.closePage(tabId, ended);
    this.session.status = 'stopped'; this.session.stopReason = reason; this.session.stoppedAt = ended;
    if (this.requests.size > 0) this.limit('navigation-gap');
    this.requests.clear(); this.baselines.clear(); this.counterHistory.clear();
    for (const key of this.sizes.keys()) if (key.startsWith('request:') || key.startsWith('baseline:') || key.startsWith('history:')) this.size(key, 0);
    this.cancelDeadline(); this.mark();
  }

  private enqueue(action: () => void): void {
    if (this.disposed) return;
    if (this.hydrated) { action(); return; }
    if (this.pending.length < MAX_PENDING) this.pending.push(action);
    else this.pendingDropped = sat(this.pendingDropped);
    // No raw browser URL is captured in pending closures.
  }

  private sameSite(safe: SafeProUrl): boolean { return this.session?.siteKey === safe.siteKey; }
  private pageFor(tabId: number): ProPage | undefined { const id = this.currentPages.get(tabId); return this.session?.pages.find(page => page.id === id); }
  private pageById(id: string | null): ProPage | undefined { return this.session?.pages.find(page => page.id === id); }

  private closePage(tabId: number, at = this.runtime.now(), preserveCounterHistory = false): void {
    const page = this.pageFor(tabId);
    if (page) { page.endedAt = Math.max(page.startedAt, Math.min(this.session!.deadlineAt, at)); for (const [key, base] of this.baselines) if (base.pageId === page.id) { this.baselines.delete(key); this.size('baseline:' + key, 0); } }
    this.currentPages.delete(tabId);
    if (!preserveCounterHistory) for (const [key, history] of this.counterHistory) if (history.tabId === tabId) { this.counterHistory.delete(key); this.size('history:' + key, 0); }
  }

  private baseline(page: ProPage, documentKey: string, projection: ReportProjection | null): void {
    const key = page.id + '|' + documentKey;
    if (!this.baselines.has(key) && [...this.baselines.values()].filter(base => base.pageId === page.id).length >= PRO_LIMITS.maxDocumentsPerPage) {
      this.limit('document-limit'); this.session!.dropped.documents = sat(this.session!.dropped.documents); return;
    }
    const counters = this.counterHistory.has(documentKey) ? this.effectiveCounters(documentKey) ?? [] : projection ? this.runtime.state.reports.get(documentKey)?.counters ?? [] : [];
    const browserCounters = this.counterHistory.get(documentKey)?.browser?.counters ??
      (projection ? this.runtime.state.metas.get(documentKey)?.networkCounters ?? [] : []);
    if (!this.checkDeadline()) return;
    const base: Baseline = { pageId: page.id, documentKey, counts: counters.map(c => [counterKey(c.techniqueId, c.phase, c.signalCodes, c.apiOperation, c.extensionResource), c.count]),
      browserCounts: browserCounters.map(c => [counterKey(c.techniqueId, c.phase, c.signalCodes), c.count]),
      vendors: projection?.vendors.map(v => v.vendorId) ?? [],
      rtcKeys: projection ? this.runtime.rtc.vendorEvidence(documentKey).observations.map(item => item.occurrenceId) : [] };
    if (this.size('baseline:' + key, JSON.stringify(base).length * 2 + 128)) this.baselines.set(key, base);
  }

  private newPage(tabId: number, documentKey: string, safe: SafeProUrl, at: number, baseline: boolean): ProPage | null {
    const session = this.session;
    if (!session || session.status !== 'recording') return null;
    // An explicit new recording/visit begins a fresh classification window. Old totals stay in Light.
    this.runtime.resetNetworkProbeWindows([...this.runtime.state.bindings.values()].filter(binding => binding.tabId === tabId).map(binding => binding.documentKey), tabId, at);
    this.closePage(tabId, at, this.pageFor(tabId)?.documentKey === documentKey);
    if (session.pages.length >= PRO_LIMITS.maxPages) { session.dropped.pages = sat(session.dropped.pages); this.limit('page-limit'); this.finish('limit', at); return null; }
    const page: ProPage = { id: 'page-' + this.nextPage++, tabId, documentKey, url: safe.url, title: '', startedAt: at, endedAt: null, reports: [], resources: [] };
    if (!this.size('page:' + page.id, 2048)) { session.dropped.pages = sat(session.dropped.pages); return null; }
    session.pages.push(page); this.currentPages.set(tabId, page.id);
    if (baseline) for (const binding of this.runtime.state.bindings.values()) if (binding.tabId === tabId && this.belongsToPage(binding.documentKey, page)) this.baseline(page, binding.documentKey, this.runtime.projectionByKey(binding.documentKey));
    for (const request of this.requests.values()) if (request.pageId === null && request.tabId === tabId && (request.type === 'main_frame' ? request.target.url === safe.url : request.documentKey === documentKey)) {
      request.pageId = page.id; this.addRequest(page, request);
      // A top commit is delivered to Pro before the Light document binding exists.
      // Completed vendor resources wait for afterEvent so they keep their exact document.
      if (request.endedAt !== null && request.ruleIds.length === 0) { this.completeResource(request); this.dropRequest(request.id); }
    }
    this.mark(); return page;
  }

  /** Sanitization happens synchronously, before any pre-hydration buffering. */
  onNavigation(details: NavigationDetailsLike, route = false): void {
    if (!this.runtime.scope.hasDataConsent) return;
    if (this.hydrated && !this.checkDeadline()) return;
    if (!Number.isSafeInteger(details.tabId) || details.tabId < 0 || details.frameId !== 0 || typeof details.documentId !== 'string' || details.documentId.length > 128 || details.documentLifecycle === 'prerender' || details.documentLifecycle === 'cached') return;
    const safe = safeProUrl(details.url), tabId = details.tabId, documentKey = `${tabId}:0:${details.documentId}`, at = this.runtime.now();
    this.enqueue(() => {
      if (!this.checkDeadline() || !this.trackedTabs.has(tabId)) return;
      if (!safe || !this.sameSite(safe)) { this.closePage(tabId, at); this.limit('navigation-gap'); this.mark(); return; }
      const current = this.pageFor(tabId);
      if (!route && current?.documentKey === documentKey && current.url === safe.url) return;
      this.newPage(tabId, documentKey, safe, at, route);
      void this.updateTitle(tabId, documentKey, safe.url);
    });
  }

  private async updateTitle(tabId: number, documentKey: string, url: string): Promise<void> {
    if (!this.runtime.api.tabs.get) return;
    const tab = await this.runtime.api.tabs.get(tabId).catch(() => null);
    const page = this.pageFor(tabId);
    if (!this.checkDeadline() || !page || page.documentKey !== documentKey || page.url !== url || safeProUrl(tab?.url)?.url !== url) return;
    page.title = safeProTitle(tab?.title); this.mark();
  }

  onTabUpdated(tabId: number, tab: TabDetailsLike): void {
    if (!this.runtime.scope.hasDataConsent) return;
    if (this.hydrated && !this.checkDeadline()) return;
    const safe = safeProUrl(tab.url), title = safeProTitle(tab.title);
    this.enqueue(() => { const page = this.pageFor(tabId); if (this.checkDeadline() && page && safe && this.sameSite(safe) && page.url === safe.url) { page.title = title; this.mark(); } });
  }

  onTabCreated(tab: TabDetailsLike): void {
    if (!this.runtime.scope.hasDataConsent) return;
    const id = tab.id, opener = tab.openerTabId;
    this.enqueue(() => {
      if (!this.checkDeadline() || typeof id !== 'number' || typeof opener !== 'number' || !this.trackedTabs.has(opener) || !this.pageFor(opener)) return;
      if (this.trackedTabs.size >= PRO_LIMITS.maxTabs) { this.limit('page-limit'); this.session!.dropped.pages = sat(this.session!.dropped.pages); this.mark(); return; }
      this.trackedTabs.add(id); this.mark();
    });
  }

  onTabRemoved(tabId: number): void {
    this.enqueue(() => { if (!this.checkDeadline() || !this.trackedTabs.has(tabId)) return; this.closePage(tabId); this.trackedTabs.delete(tabId); if (this.trackedTabs.size === 0) this.finish('tab-closed'); this.mark(); });
  }

  onTabReplaced(added: number, removed: number): void {
    this.enqueue(() => { if (!this.checkDeadline() || !this.trackedTabs.has(removed)) return; this.closePage(removed); this.trackedTabs.delete(removed); this.trackedTabs.add(added); this.limit('navigation-gap'); this.mark(); });
  }

  onPermissionsChanged(): void {
    if (!this.checkDeadline()) return;
    this.limit('permission-limited');
    if (!this.rootAccess()) this.finish('access-revoked');
    this.mark();
  }

  private rootAccess(): boolean {
    if (!this.session || !this.runtime.scope.hasAnyHostAccess() || this.runtime.scope.getScopeMode() === 'off') return false;
    for (const pageId of this.currentPages.values()) {
      const page = this.pageById(pageId), safe = safeProUrl(page?.url);
      const documentId = page?.documentKey.split(':').slice(2).join(':');
      if (page && safe && documentId && this.runtime.scope.inScope(safe.domain, page.tabId, documentId, safe.scheme)) return true;
    }
    return this.runtime.scope.isHostGrantedSync(this.session.domain, 'https') || this.runtime.scope.isHostGrantedSync(this.session.domain, 'http');
  }

  private belongsToPage(documentKey: string, page: ProPage): boolean {
    if (documentKey === page.documentKey) return true;
    const bindings = [...this.runtime.state.bindings.values()].filter(b => b.tabId === page.tabId && b.documentLifecycle !== 'cached' && b.documentLifecycle !== 'prerender');
    let cursor = bindings.find(b => b.documentKey === documentKey);
    const seen = new Set<string>();
    while (cursor && seen.size < 128) {
      if (cursor.documentKey === page.documentKey) return true;
      if (seen.has(cursor.documentKey)) return false;
      seen.add(cursor.documentKey);
      cursor = bindings.find(b => b.documentId === cursor!.parentDocumentId);
    }
    return false;
  }

  afterEvent(event: DocumentEvent, before: DocumentsState): void {
    if (!this.hydrated || !this.checkDeadline()) return;
    if (event.type === 'network:reset' || event.type === 'scope:revoked') {
      const keys = event.type === 'network:reset' ? [event.documentKey] : event.documentKeys;
      for (const key of keys) {
        const history = this.counterHistory.get(key);
        if (history?.browser) { delete history.browser; this.size('history:' + key, JSON.stringify(history).length * 2 + 256); }
        for (const base of this.baselines.values()) if (base.documentKey === key) base.browserCounts = [];
      }
    }
    if (event.type === 'ui:pause' || event.type === 'scope:revoked') {
      const keys = event.type === 'ui:pause' ? [event.documentKey] : event.documentKeys;
      for (const base of this.baselines.values()) if (keys.includes(base.documentKey)) base.rtcKeys = [];
    }
    if (event.type === 'navigation:committed') {
      const page = this.pageFor(event.tabId);
      if (page) for (const request of this.requests.values()) {
        if (request.tabId !== event.tabId || (request.pageId !== null && request.pageId !== page.id) || request.type === 'main_frame' || !request.documentKey || !this.belongsToPage(request.documentKey, page)) continue;
        if (request.pageId === null) { request.pageId = page.id; this.addRequest(page, request); }
        if (request.endedAt !== null) {
          this.completeResource(request);
          this.addVendors(page, request.documentKey, request.ruleIds, request.endedAt);
          this.dropRequest(request.id);
        }
        this.mark();
      }
    }
    let key: string | null = null;
    if (event.type === 'batch') key = event.sender.documentKey;
    else if ('documentKey' in event) key = event.documentKey;
    else if (event.type === 'navigation:committed' || event.type === 'navigation:completed' || event.type === 'navigation:route') key = `${event.tabId}:${event.frameId}:${event.documentId}`;
    else if (event.type === 'network:host') key = `${event.tabId}:${event.resourceType === 'sub_frame' ? event.parentFrameId : event.frameId}:${event.resourceType === 'sub_frame' ? event.parentDocumentId : event.documentId}`;
    if (!key || before.reports.get(key) === this.runtime.state.reports.get(key)) return;
    const report = this.runtime.state.reports.get(key);
    if (!report) return;
    const headerPeriod = event.type === 'network:headers' && event.proPeriod?.sessionId === this.session?.id ? event.proPeriod : null;
    const page = headerPeriod ? this.pageById(headerPeriod.pageId) : this.pageFor(report.tabId);
    if (!page || !this.belongsToPage(key, page)) return;
    if (event.type === 'network:observed' && (event.at < page.startedAt || event.preVisitAt === page.startedAt)) {
      // A browser attempt can wait for its child binding across Start/SPA. Keep it in Light,
      // and advance only the Pro baseline so a delayed delivery cannot turn old activity into new work.
      const baseKey = page.id + '|' + key;
      if (!this.baselines.has(baseKey)) this.baseline(page, key, null);
      const base = this.baselines.get(baseKey);
      if (base) {
        const previous = new Map((before.metas.get(key)?.networkCounters ?? []).map(c => [counterKey(c.techniqueId, c.phase, c.signalCodes), c.count]));
        const baseline = new Map(base.browserCounts);
        for (const counter of this.runtime.state.metas.get(key)?.networkCounters ?? []) {
          const slot = counterKey(counter.techniqueId, counter.phase, counter.signalCodes);
          baseline.set(slot, sat(baseline.get(slot) ?? 0, Math.max(0, counter.count - (previous.get(slot) ?? 0))));
        }
        base.browserCounts = [...baseline];
        this.size('baseline:' + baseKey, JSON.stringify(base).length * 2 + 128);
      }
    }
    const localAttempt = event.type === 'network:observed' && event.local && event.at >= page.startedAt && event.preVisitAt !== page.startedAt;
    this.updateReport(page, key, localAttempt ? event.localPort : undefined, event.type === 'network:limited' || localAttempt && event.localPort === undefined,
      event.type === 'network:headers' && event.proPeriod && event.proPeriod.sessionId === this.session?.id &&
        event.proPeriod.pageId === page.id ? event.headers : undefined);
  }

  private updateReport(page: ProPage, key: string, localPort?: number, portsLimited = false, headerDelta?: ResponseHeadersSummary): ReportProjection | null {
    const baseKey = page.id + '|' + key;
    let baseline = this.baselines.get(baseKey);
    if (!baseline) { this.baseline(page, key, null); baseline = this.baselines.get(baseKey); }
    if (!baseline || !this.checkDeadline()) return null;
    if (portsLimited && !baseline.localPortsIncomplete) {
      baseline.localPortsIncomplete = true;
      if (!this.size('baseline:' + baseKey, JSON.stringify(baseline).length * 2 + 128)) return null;
    }
    const retainedCounters = this.effectiveCounters(key);
    if (!this.checkDeadline()) return null;
    const retainedBrowser = this.counterHistory.get(key)?.browser?.counters;
    const index = page.reports.findIndex(report => report.documentKey === key);
    const previousReport = index >= 0 ? page.reports[index] : undefined;
    const previousCount = previousReport?.techniques.find(item => item.techniqueId === 'DET-060' && item.evidenceSource === 'browser-network' && item.integrity === 'browser-observed')?.count ?? 0;
    const saturatedLocal = (retainedBrowser ?? this.runtime.state.metas.get(key)?.networkCounters ?? [])
      .some(counter => counter.techniqueId === 'DET-060' && counter.count === MAX_COUNT);
    const projection = this.runtime.recordingProjection(key, new Map(baseline.counts), page.startedAt, retainedCounters,
      new Map(baseline.browserCounts), retainedBrowser, sat(previousCount, localPort === undefined ? 0 : 1));
    if (!projection) return null;
    const rtc = this.runtime.rtc.vendorEvidence(key);
    const newRtcVendors = rtc.observations.filter(item => !baseline!.rtcKeys.includes(item.occurrenceId)).map(item => item.vendor);
    let snapshot: ReportProjection = { ...projection, vendors: mergeVendorSummaries(
      projection.vendors.filter(v => v.evidenceSource === 'browser-network' && !baseline!.vendors.includes(v.vendorId)), newRtcVendors) };
    const headers = headerDelta ? mergeResponseHeaders(previousReport?.responseHeaders, headerDelta) : previousReport?.responseHeaders;
    if (headers) {
      snapshot = attachResponseHeaders(snapshot, headers);
      if (headers.entries.length) {
        const previousSince = previousReport?.observedSince ?? Math.max(page.startedAt, Math.min(page.endedAt ?? this.runtime.now(), this.runtime.now()));
        snapshot.observedSince = snapshot.observedSince === null ? previousSince : Math.min(snapshot.observedSince, previousSince);
      }
    }
    if (newRtcVendors.length > 0 && rtc.observedAt !== null) snapshot.observedSince ??= Math.max(page.startedAt, rtc.observedAt);
    const localCount = snapshot.techniques.find(item => item.techniqueId === 'DET-060' && item.evidenceSource === 'browser-network' && item.integrity === 'browser-observed')?.count ?? 0;
    if (localCount > 0) {
      const previousPorts = previousReport?.requestedLocalPorts;
      const incomplete = saturatedLocal || baseline.localPortsIncomplete === true || localCount > previousCount + (localPort === undefined ? 0 : 1) || previousPorts === undefined && previousCount > 0;
      if (localPort !== undefined) snapshot.requestedLocalPorts = addRequestedLocalPort(previousPorts, localPort,
        incomplete);
      else if (previousPorts) snapshot.requestedLocalPorts = { ports: previousPorts.ports.slice(), truncated: previousPorts.truncated || incomplete };
      else snapshot.requestedLocalPorts = { ports: [], truncated: true };
    }
    if (index >= 0) {
      // Vendor resource callbacks can add repeat loads after a SPA boundary.
      snapshot.vendors = mergeVendorSummaries(snapshot.vendors, page.reports[index]!.vendors);
      if (snapshot.vendors.length > 0) snapshot.observedSince ??= page.reports[index]!.observedSince;
      if (!this.size('report:' + baseKey, JSON.stringify(snapshot).length * 2 + 256)) return null;
      page.reports[index] = snapshot;
    } else if (page.reports.length < PRO_LIMITS.maxDocumentsPerPage) {
      if (!this.size('report:' + baseKey, JSON.stringify(snapshot).length * 2 + 256)) return null;
      page.reports.push(snapshot);
    } else { this.limit('document-limit'); this.session!.dropped.documents = sat(this.session!.dropped.documents); this.baselines.delete(baseKey); this.size('baseline:' + baseKey, 0); return null; }
    this.mark();
    return snapshot;
  }

  onRequest(details: RequestDetailsLike, phase: Phase): void {
    if (!this.runtime.scope.hasDataConsent) return;
    if (this.hydrated && !this.checkDeadline()) return;
    if (!Number.isSafeInteger(details.tabId) || details.tabId < 0 || !TYPES.has(details.type) || typeof details.requestId !== 'string' || !/^[a-z0-9_.:-]{1,128}$/i.test(details.requestId)) return;
    const rawTarget = safeProUrl(details.url);
    if (!rawTarget) return;
    const target = safeProResourceUrl(rawTarget, this.session?.siteKey ?? null);
    const tabId = details.tabId, id = details.requestId, type = details.type, at = this.runtime.now();
    const status = typeof details.statusCode === 'number' && Number.isInteger(details.statusCode) && details.statusCode >= 100 && details.statusCode <= 599 ? details.statusCode : null;
    const rules = phase === 'completed' && status !== null && ((status >= 200 && status < 300) || status === 304) ? matchVendorResource(details.url, type, at) : [];
    const documentKey = typeof details.documentId === 'string' ? `${tabId}:${details.frameId}:${details.documentId}` : null;
    // The browser provides these strings; only the sanitized object survives this callback.
    const scheme = details.url.startsWith('wss:') ? 'wss' : details.url.startsWith('ws:') ? 'ws' : target.scheme;
    const granted = this.runtime.scope.isHostGrantedSync(toAsciiHost(details.url) ?? '', scheme);
    this.enqueue(() => {
      if (!this.checkDeadline() || !granted || !this.trackedTabs.has(tabId)) return;
      if (phase === 'before') {
        const current = this.pageFor(tabId);
        const pendingNavigation = [...this.requests.values()].some(r => r.tabId === tabId && r.type === 'main_frame' && r.pageId === null && this.sameSite(r.target));
        if (type === 'main_frame' ? !this.sameSite(target) : !current && !pendingNavigation) return;
        if (this.requests.has(id)) return;
        if (++this.events > MAX_EVENTS) { this.session!.dropped.events = sat(this.session!.dropped.events); this.limit('event-limit'); this.finish('limit'); return; }
        if (this.requests.size >= MAX_INFLIGHT) { this.limit('event-limit'); this.session!.dropped.events = sat(this.session!.dropped.events); this.mark(); return; }
        const belongs = current && (!documentKey || this.belongsToPage(documentKey, current));
        const request: Request = { id, tabId, pageId: type === 'main_frame' || !belongs ? null : current!.id, resourceId: null, documentKey, ruleIds: [], target, type, at, completed: 0, failed: 0, redirects: 0, status: null, endedAt: null };
        if (!this.size('request:' + id, JSON.stringify(request).length * 2 + 256)) { this.session!.dropped.events = sat(this.session!.dropped.events); return; }
        this.requests.set(id, request);
        if (request.pageId) this.addRequest(current!, request);
      } else {
        const request = this.requests.get(id);
        if (!request || request.target.url !== target.url) return;
        request.completed = phase === 'completed' ? 1 : 0; request.failed = phase === 'error' ? 1 : 0; request.redirects = phase === 'redirect' ? 1 : 0; request.endedAt = at; request.status = status;
        request.ruleIds = rules.map(rule => rule.ruleId);
        if (!this.size('request:' + id, JSON.stringify(request).length * 2 + 256)) return;
        const page = this.pageById(request.pageId);
        if (page) {
          this.completeResource(request);
          if (request.ruleIds.length && documentKey === request.documentKey) this.addVendors(page, documentKey, request.ruleIds, at);
          this.dropRequest(id);
        } else if (request.type === 'main_frame' && (phase === 'error' || phase === 'redirect')) {
          // A navigation can fail/redirect before a document exists. Keep its resource on the initiating visit.
          const origin = this.pageFor(tabId);
          if (origin) { request.pageId = origin.id; this.addRequest(origin, request); this.completeResource(request); }
          else this.limit('navigation-gap');
          this.dropRequest(id);
        }
      }
      this.mark();
    });
  }

  private addRequest(page: ProPage, request: Request): void {
    const session = this.session!;
    let resource = page.resources.find(r => r.url === request.target.url && r.type === request.type);
    if (!resource) {
      if (page.resources.length >= PRO_LIMITS.maxResourcesPerPage || this.nextResource > PRO_LIMITS.maxResources) { this.limit('resource-limit'); session.dropped.resources = sat(session.dropped.resources); return; }
      resource = { id: 'resource-' + this.nextResource++, url: request.target.url, domain: request.target.domain, relation: request.target.siteKey === session.siteKey ? 'same-site' : registrableDomain(request.target.domain) ? 'cross-site' : 'unknown', type: request.type,
        requestCount: 0, completedCount: 0, failedCount: 0, redirectCount: 0, firstSeenAt: request.at, lastSeenAt: request.at, statusCodes: [], durationTotalMs: 0 };
      if (!this.size('resource:' + resource.id, 1024 + 2 * (resource.url.length + resource.domain.length))) { session.dropped.resources = sat(session.dropped.resources); return; }
      page.resources.push(resource);
    }
    resource.requestCount = sat(resource.requestCount); resource.firstSeenAt = Math.min(resource.firstSeenAt, request.at); resource.lastSeenAt = Math.max(resource.lastSeenAt, request.at); request.resourceId = resource.id;
  }

  private completeResource(request: Request): void {
    const resource = this.pageById(request.pageId)?.resources.find(r => r.id === request.resourceId);
    if (!resource) return;
    resource.completedCount = sat(resource.completedCount, request.completed); resource.failedCount = sat(resource.failedCount, request.failed); resource.redirectCount = sat(resource.redirectCount, request.redirects);
    resource.lastSeenAt = Math.max(resource.lastSeenAt, request.endedAt ?? request.at);
    resource.durationTotalMs = sat(resource.durationTotalMs, Math.max(0, (request.endedAt ?? request.at) - request.at));
    if (request.status !== null && !resource.statusCodes.includes(request.status) && resource.statusCodes.length < 16) resource.statusCodes.push(request.status);
  }

  private addVendors(page: ProPage, documentKey: string | null, ruleIds: readonly string[], at: number): void {
    if (ruleIds.length === 0 || documentKey === null || !this.belongsToPage(documentKey, page)) return;
    const meta = this.runtime.state.metas.get(documentKey);
    if (!meta || meta.paused || meta.revoked || meta.accessGranted === false) return;
    const report = this.updateReport(page, documentKey);
    if (!report) return;
    for (const id of ruleIds) {
      const rule = lookupVendorResourceRule(id, this.runtime.now());
      if (!rule) continue;
      report.vendors = mergeVendorSummaries(report.vendors, [{ vendorId: rule.vendorId, vendorConfidence: 'documented-resource',
        ruleIds: [rule.ruleId], evidenceSource: 'browser-network', integrity: 'browser-observed' }]);
    }
    if (report.vendors.length > 0) report.observedSince ??= Math.max(page.startedAt, at);
    this.size('report:' + page.id + '|' + documentKey, JSON.stringify(report).length * 2 + 256);
  }

  /** Called before Light removes its document model. This affects only an active recording's current documents. */
  onLightClear(documentKey: string): void {
    if (!this.checkDeadline()) return;
    for (const base of this.baselines.values()) if (base.documentKey === documentKey) base.rtcKeys = [];
    const report = this.runtime.state.reports.get(documentKey), meta = this.runtime.state.metas.get(documentKey);
    if (!report || !meta) return;
    const page = this.pageFor(report.tabId);
    if (!page || !this.belongsToPage(documentKey, page)) return;
    if (!this.baselines.has(page.id + '|' + documentKey) && !page.reports.some(item => item.documentKey === documentKey)) return;
    const previous = this.counterHistory.get(documentKey);
    if (!previous && [...this.counterHistory.values()].filter(item => item.tabId === report.tabId).length >= PRO_LIMITS.maxDocumentsPerPage) {
      this.limit('document-limit'); this.session!.dropped.documents = sat(this.session!.dropped.documents); this.finish('limit'); return;
    }
    const history = previous ? mergeProCounterHistory(previous, report, meta) : createProCounterHistory(report, meta);
    if (this.size('history:' + documentKey, JSON.stringify(history).length * 2 + 256)) this.counterHistory.set(documentKey, history);
    this.mark();
  }

  private effectiveCounters(documentKey: string): CounterEntry[] | undefined {
    const previous = this.counterHistory.get(documentKey);
    if (!previous) return undefined;
    const report = this.runtime.state.reports.get(documentKey), meta = this.runtime.state.metas.get(documentKey);
    if (!report || !meta) return previous.counters;
    const history = mergeProCounterHistory(previous, report, meta);
    if (!this.size('history:' + documentKey, JSON.stringify(history).length * 2 + 256)) return previous.counters;
    this.counterHistory.set(documentKey, history);
    if (history.limited) this.limit('event-limit');
    return history.counters;
  }

  private mark(): void {
    this.revision++;
    if (this.disposed || this.persistTimer !== null) return;
    this.persistTimer = setTimeout(() => { this.persistTimer = null; void this.flush(); }, PERSIST_MS);
  }

  /** Per-entry estimates bound admission synchronously; no full-session serialization on hot events. */
  private size(key: string, bytes: number): boolean {
    const previous = this.sizes.get(key) ?? 0;
    if (this.estimatedBytes + bytes - previous > PRO_LIMITS.maxBytes) {
      this.limit('resource-limit'); this.finish('limit'); return false;
    }
    this.estimatedBytes += bytes - previous;
    if (bytes === 0) this.sizes.delete(key); else this.sizes.set(key, bytes);
    return true;
  }

  private dropRequest(id: string): void { this.requests.delete(id); this.size('request:' + id, 0); }

  async flush(): Promise<void> {
    if (this.persistTimer !== null) { clearTimeout(this.persistTimer); this.persistTimer = null; }
    if (this.write) { await this.write; if (this.persistedRevision < this.revision) return this.flush(); return; }
    if (this.persistedRevision === this.revision) return;
    const revision = this.revision;
    let stored: Stored | null = this.session ? { version: 1, session: this.session, trackedTabs: [...this.trackedTabs], currentPages: [...this.currentPages], baselines: [...this.baselines.values()], requests: [...this.requests.values()], counterHistory: [...this.counterHistory.values()], events: this.events } : null;
    // Shape/count bounds precede the byte check; never serialize unbounded page input.
    if (stored && JSON.stringify(stored).length * 2 > PRO_LIMITS.maxBytes) {
      this.limit('resource-limit'); this.finish('limit');
      // Unexpected migrated/envelope overhead: remove each last page at most once, measuring its bounded shape.
      let bytes = JSON.stringify(stored).length * 2;
      while (this.session!.pages.length && bytes > PRO_LIMITS.maxBytes) {
        const page = this.session!.pages.pop()!;
        bytes -= JSON.stringify(page).length * 2;
        this.session!.dropped.pages = sat(this.session!.dropped.pages);
        this.session!.dropped.resources = sat(this.session!.dropped.resources, page.resources.length);
        this.session!.dropped.documents = sat(this.session!.dropped.documents, page.reports.length);
      }
      stored = { ...stored, currentPages: [], baselines: [], requests: [], counterHistory: [] };
    }
    const snapshot = stored === null ? null : structuredClone(stored);
    this.write = (async () => {
      try {
        if (snapshot === null) await this.runtime.api.storage.session.remove(PRO_STORAGE_KEY);
        else await this.runtime.api.storage.session.set({ [PRO_STORAGE_KEY]: snapshot });
        this.persistedRevision = revision;
      } catch {
        this.limit('storage-error'); this.finish('storage-error');
        // One bounded fallback persist. The visible session reports failure even if storage remains unavailable.
        this.persistedRevision = this.revision;
        if (this.session) try { await this.runtime.api.storage.session.set({ [PRO_STORAGE_KEY]: { version: 1, session: structuredClone(this.session), trackedTabs: [], currentPages: [], baselines: [], requests: [], counterHistory: [], events: this.events } }); } catch { /* no retries */ }
      }
    })();
    try { await this.write; } finally { this.write = null; }
  }

  dispose(): void {
    this.disposed = true;
    if (this.persistTimer !== null) { clearTimeout(this.persistTimer); this.persistTimer = null; }
    if (this.deadlineTimer !== null) { clearTimeout(this.deadlineTimer); this.deadlineTimer = null; }
    // Disposal models worker suspension; keep the browser alarm and saved active recording.
  }
}
