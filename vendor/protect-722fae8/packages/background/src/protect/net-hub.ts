// ADR-020 §A, §4 (S04): webRequest listeners of the module «Защита». The only file allowed to ask Chrome for request
// bodies or request headers (scripts/code-checks.mjs: the 'requestBody' / 'requestHeaders' literals live only here).
// - Listeners exist only while the module is active; they are added after the async state check (not at the top level
//   of the SW), so requests right after a wake-up may be missed (counts are lower bounds).
// - Bodies: one onBeforeRequest closure PER ARMED TAB with filter.tabId and ['requestBody']; at most maxArmedTabs (LRU,
//   the evicted tab gets `budget-exceeded`), disarmed armTtlMs after its last activity or when the tab closes. There is
//   never a shared body listener: bodies of tabs without input are not seen.
// - onSendHeaders (['requestHeaders'] only with the gpc feature), onErrorOccurred, onCompleted: shared, only while a
//   feature needs outcomes or the GPC check.
// - Cheap checks first (tab, extension initiator, scheme, host grants of target AND initiator); the trusted resolution
//   (tab-model) is computed lazily, only when a lane reads it. Bodies and URLs stay in the callback (memory only).

import { PROTECT_BUDGETS } from '@detect-expert/contracts';
import type { ProtectFeature } from '@detect-expert/contracts';
import type { BackgroundChromeApi, Clock, RequestDetailsLike, RequestFilterLike, WebRequestEventLike } from '../chrome-api';
import type { ProtectTabModel, ResolvedRequest } from './tab-model';

export const PROTECT_REQUEST_URLS: readonly string[] = ['http://*/*', 'https://*/*'];
/** webRequest types of the module (SP-14: fetch/XHR = xmlhttprequest, sendBeacon = ping). */
export const PROTECT_REQUEST_TYPES: readonly string[] = ['main_frame', 'sub_frame', 'xmlhttprequest', 'ping', 'image', 'script', 'other'];

/** Lazily resolved, trusted view of the request (tab-model.resolveRequest), memoized per event. */
export interface ProtectRequestContext {
  readonly resolved: ResolvedRequest | null;
}

export interface NetHubSink {
  /** Armed tabs only: details carry requestBody (memory only, this callback only). */
  onRequest(details: RequestDetailsLike, request: ProtectRequestContext): void;
  onSendHeaders(details: RequestDetailsLike, request: ProtectRequestContext): void;
  onErrorOccurred(details: RequestDetailsLike, request: ProtectRequestContext): void;
  onCompleted(details: RequestDetailsLike, request: ProtectRequestContext): void;
  /** An armed tab was evicted from the pool (LRU): its documents get `budget-exceeded`. */
  onArmEvicted(tabId: number): void;
}

/** Features that need the shared outcome / header listeners (session-replay: periodic sends, S11). */
export function needsSharedListeners(features: readonly ProtectFeature[]): boolean {
  return features.includes('value-match') || features.includes('firewall') || features.includes('gpc') || features.includes('session-replay');
}

type Callback = (details: RequestDetailsLike) => undefined;

interface Armed {
  cb: Callback;
  lastActivity: number;
}

/** Host and scheme of an http(s) URL or origin without URL parsing (lowercased; userinfo and port dropped). */
export function fastHost(url: string): { host: string; scheme: 'http' | 'https' } | null {
  let rest: string;
  let scheme: 'http' | 'https';
  if (url.startsWith('https://')) {
    scheme = 'https';
    rest = url.slice(8);
  } else if (url.startsWith('http://')) {
    scheme = 'http';
    rest = url.slice(7);
  } else return null;
  let end = rest.length;
  for (let i = 0; i < rest.length; i++) {
    const c = rest.charCodeAt(i);
    if (c === 47 || c === 63 || c === 35 || c === 92) {
      end = i;
      break;
    }
  }
  let authority = rest.slice(0, end);
  const at = authority.lastIndexOf('@');
  if (at >= 0) authority = authority.slice(at + 1);
  let host = authority;
  if (host.startsWith('[')) {
    const close = host.indexOf(']');
    host = close < 0 ? host : host.slice(0, close + 1);
  } else {
    const colon = host.indexOf(':');
    if (colon >= 0) host = host.slice(0, colon);
  }
  host = host.toLowerCase();
  if (host.endsWith('.')) host = host.slice(0, -1);
  return host.length === 0 || host.length > 253 ? null : { host, scheme };
}

export class NetHub {
  private active = false;
  private features: ProtectFeature[] = [];
  private readonly armed = new Map<number, Armed>();
  private sharedOn = false;
  private sharedHeaders = false;
  private sweepTimer: ReturnType<typeof setTimeout> | null = null;
  private evictions = 0;
  private readonly onSendHeadersCb: Callback;
  private readonly onErrorCb: Callback;
  private readonly onCompletedCb: Callback;

  constructor(
    private readonly api: BackgroundChromeApi,
    private readonly clock: Clock,
    private readonly tabModel: ProtectTabModel,
    /** Host access of the extension (scope.isHostGrantedSync): target and initiator must both be granted. */
    private readonly hostGranted: (host: string, scheme: 'http' | 'https') => boolean,
    private readonly sink: NetHubSink,
  ) {
    this.onSendHeadersCb = (details) => {
      if (this.admit(details)) this.sink.onSendHeaders(details, this.context(details));
      return undefined;
    };
    this.onErrorCb = (details) => {
      if (this.admit(details)) this.sink.onErrorOccurred(details, this.context(details));
      return undefined;
    };
    this.onCompletedCb = (details) => {
      if (this.admit(details)) this.sink.onCompleted(details, this.context(details));
      return undefined;
    };
  }

  private context(details: RequestDetailsLike): ProtectRequestContext {
    const model = this.tabModel;
    let cached: ResolvedRequest | null | undefined;
    return {
      get resolved(): ResolvedRequest | null {
        if (cached === undefined) cached = model.resolveRequest(details);
        return cached;
      },
    };
  }

  /** Cheap checks before any lane work (ADR-020 §A). */
  private admit(details: RequestDetailsLike): boolean {
    if (!this.active) return false;
    if (!Number.isSafeInteger(details.tabId) || details.tabId < 0) return false;
    const initiator = details.initiator;
    if (typeof initiator === 'string' && initiator.startsWith('chrome-extension://')) return false;
    const target = fastHost(details.url);
    if (target === null || !this.hostGranted(target.host, target.scheme)) return false;
    if (typeof initiator === 'string' && initiator !== 'null') {
      const from = fastHost(initiator);
      if (from === null || !this.hostGranted(from.host, from.scheme)) return false;
    }
    return true;
  }

  private filter(tabId?: number): RequestFilterLike {
    return { urls: [...PROTECT_REQUEST_URLS], types: [...PROTECT_REQUEST_TYPES], ...(tabId === undefined ? {} : { tabId }) };
  }

  private add(event: WebRequestEventLike | undefined, cb: Callback, filter: RequestFilterLike, extra: string[]): boolean {
    if (event === undefined) return false;
    try {
      event.addListener(cb, filter, extra);
      return true;
    } catch {
      return false;
    }
  }

  private remove(event: WebRequestEventLike | undefined, cb: Callback): void {
    try {
      event?.removeListener?.(cb);
    } catch {
      // An event that cannot remove (absent API) holds nothing of ours.
    }
  }

  private addShared(): void {
    const headers = this.features.includes('gpc');
    this.add(this.api.webRequest.onSendHeaders, this.onSendHeadersCb, this.filter(), headers ? ['requestHeaders'] : []);
    this.add(this.api.webRequest.onErrorOccurred, this.onErrorCb, this.filter(), []);
    this.add(this.api.webRequest.onCompleted, this.onCompletedCb, this.filter(), []);
    this.sharedOn = true;
    this.sharedHeaders = headers;
  }

  private removeShared(): void {
    if (!this.sharedOn) return;
    this.remove(this.api.webRequest.onSendHeaders, this.onSendHeadersCb);
    this.remove(this.api.webRequest.onErrorOccurred, this.onErrorCb);
    this.remove(this.api.webRequest.onCompleted, this.onCompletedCb);
    this.sharedOn = false;
    this.sharedHeaders = false;
  }

  /**
   * Applies the module state: inactive → every listener removed and the pool emptied; active → shared listeners
   * exactly when a feature needs them (re-added when the GPC header need changes).
   */
  refresh(active: boolean, features: readonly ProtectFeature[]): void {
    this.active = active;
    this.features = [...features];
    if (!active) {
      this.stopAll();
      return;
    }
    const want = needsSharedListeners(features);
    if (!want) this.removeShared();
    else if (!this.sharedOn) this.addShared();
    else if (this.sharedHeaders !== features.includes('gpc')) {
      this.removeShared();
      this.addShared();
    }
  }

  /** SP-11: listeners added before a host grant receive nothing; after permissions.onAdded every listener is re-added. */
  reregister(): void {
    if (!this.active) return;
    if (this.sharedOn) {
      this.removeShared();
      this.addShared();
    }
    for (const [tabId, a] of this.armed) {
      this.remove(this.api.webRequest.onBeforeRequest, a.cb);
      this.add(this.api.webRequest.onBeforeRequest, a.cb, this.filter(tabId), ['requestBody']);
    }
  }

  /**
   * Arms the body listener of a tab (focus on a tracked field). Already armed: refreshes its activity. A full pool
   * evicts the least recently active tab. False when inactive or the listener could not be added.
   */
  arm(tabId: number): boolean {
    if (!this.active || !Number.isSafeInteger(tabId) || tabId < 0) return false;
    const now = this.clock.now();
    const existing = this.armed.get(tabId);
    if (existing !== undefined) {
      this.armed.delete(tabId);
      existing.lastActivity = now;
      this.armed.set(tabId, existing);
      this.scheduleSweep();
      return true;
    }
    while (this.armed.size >= PROTECT_BUDGETS.maxArmedTabs) {
      const oldest = this.armed.keys().next();
      if (oldest.done) break;
      this.disarm(oldest.value);
      this.evictions++;
      try {
        this.sink.onArmEvicted(oldest.value);
      } catch {
        // The sink records a limitation; a failure there must not stop arming.
      }
    }
    const cb: Callback = (details) => {
      const a = this.armed.get(tabId);
      if (a === undefined || details.tabId !== tabId || !this.admit(details)) return undefined;
      a.lastActivity = this.clock.now();
      this.sink.onRequest(details, this.context(details));
      return undefined;
    };
    if (!this.add(this.api.webRequest.onBeforeRequest, cb, this.filter(tabId), ['requestBody'])) return false;
    this.armed.set(tabId, { cb, lastActivity: now });
    this.scheduleSweep();
    return true;
  }

  disarm(tabId: number): boolean {
    const a = this.armed.get(tabId);
    if (a === undefined) return false;
    this.armed.delete(tabId);
    this.remove(this.api.webRequest.onBeforeRequest, a.cb);
    return true;
  }

  isArmed(tabId: number): boolean {
    return this.armed.has(tabId);
  }

  /** Disarms tabs idle for armTtlMs (timer for the earliest expiry; also called from events). */
  sweep(): void {
    const now = this.clock.now();
    for (const [tabId, a] of [...this.armed]) if (now - a.lastActivity >= PROTECT_BUDGETS.armTtlMs) this.disarm(tabId);
    this.scheduleSweep();
  }

  private scheduleSweep(): void {
    if (this.sweepTimer !== null) {
      clearTimeout(this.sweepTimer);
      this.sweepTimer = null;
    }
    if (this.armed.size === 0) return;
    let earliest = Number.POSITIVE_INFINITY;
    for (const a of this.armed.values()) earliest = Math.min(earliest, a.lastActivity + PROTECT_BUDGETS.armTtlMs);
    const delay = Math.max(1000, Math.min(PROTECT_BUDGETS.armTtlMs, earliest - this.clock.now()));
    this.sweepTimer = setTimeout(() => {
      this.sweepTimer = null;
      this.sweep();
    }, delay);
  }

  /** Every listener of the module removed (disable, suspension); the pool is empty afterwards. */
  stopAll(): void {
    this.active = false;
    for (const tabId of [...this.armed.keys()]) this.disarm(tabId);
    this.removeShared();
    if (this.sweepTimer !== null) {
      clearTimeout(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  debug(): { active: boolean; armedTabs: number[]; sendHeaders: boolean; requestHeaders: boolean; errorOccurred: boolean; completed: boolean; evictions: number } {
    return {
      active: this.active,
      armedTabs: [...this.armed.keys()],
      sendHeaders: this.sharedOn,
      requestHeaders: this.sharedHeaders,
      errorOccurred: this.sharedOn,
      completed: this.sharedOn,
      evictions: this.evictions,
    };
  }
}
