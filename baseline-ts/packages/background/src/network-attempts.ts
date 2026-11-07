// ADR-025 / DET-058/060. Passive onBeforeRequest metadata, including failed handshakes.
// Terminal request events and unstable error strings never imply port state or add a second attempt.
import { makeDocumentKey } from '@detect-expert/contracts';
import { redactHost, toAsciiHost } from '../../attribution/src/index';
import type { RequestDetailsLike } from './chrome-api';
import type { DocumentEvent, DocumentsState } from './documents';
import { LocalProbeWindow, LOCAL_PROBE_WINDOW_MS } from './local-probe-window';
import { DnsProbeWindow, DNS_PROBE_LIMITS, isDnsProbeHostname } from './dns-probe-window';
import type { BackgroundRuntime } from './runtime';
import type { NetworkScheme } from './scope';

export const NETWORK_ATTEMPT_FILTER = { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] };
export const NETWORK_PENDING_LIMIT = 128;
export const NETWORK_PENDING_MS = 2000;
interface Attempt {
  documentKey: string; tabId: number; documentId: string; requestId: string;
  // These normalized native fields exist only in this bounded 2s queue / 10s classifier memory.
  host: string; port: number; scheme: NetworkScheme; sourceHost: string; sourceScheme: 'http' | 'https';
  websocket: boolean; local: boolean; at: number; startup: boolean; generation: number;
  preVisitAt?: number;
  dnsDomain?: string;
  dnsToken?: string;
  dnsTargetGranted?: boolean;
}

export class NetworkAttemptObserver {
  private readonly window = new LocalProbeWindow();
  private readonly dnsWindow = new DnsProbeWindow();
  private readonly hashing = new Set<Attempt>();
  private hashSalt: Uint8Array | null = null;
  private pending: Attempt[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerAt = Infinity;
  private flushing = false;
  private startupLoss = false;
  private readonly resets = new Map<number, number>();
  /** Identity-only loss markers can be attached if the exact pending document later commits. */
  private readonly losses = new Map<string, number>();
  constructor(private readonly runtime: BackgroundRuntime) {}

  resetWindows(documentKeys?: readonly string[], tabId?: number, cutoffAt = this.runtime.now()): void {
    if (documentKeys === undefined) this.window.clear(); else for (const key of documentKeys) this.window.clear(key);
    if (documentKeys === undefined) this.dnsWindow.clear(); else for (const key of documentKeys) this.dnsWindow.clear(key);
    const tabs = tabId === undefined ? new Set(documentKeys?.map(key => Number(key.split(':')[0])) ?? [...this.runtime.state.tabs.keys()]) : new Set([tabId]);
    for (const id of tabs) { if (this.resets.size >= 32) this.resets.delete(this.resets.keys().next().value!); this.resets.set(id, cutoffAt); }
    for (const event of this.pending) if (tabs.has(event.tabId)) event.preVisitAt = cutoffAt;
  }

  clear(documentKey?: string): void {
    this.window.clear(documentKey);
    this.dnsWindow.clear(documentKey);
    if (documentKey === undefined) this.losses.clear(); else this.losses.delete(documentKey);
    this.pending = documentKey === undefined ? [] : this.pending.filter(event => event.documentKey !== documentKey);
    if (documentKey === undefined) {
      this.startupLoss = false;
      this.resets.clear();
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null;
      this.timerAt = Infinity;
    }
  }

  onBeforeRequest(details: RequestDetailsLike): void {
    if (!this.runtime.canCollectBrowserData()) return;
    try {
      if (typeof details.url !== 'string' || details.url.length > 65536) return;
      if (this.runtime.hydrationComplete && (!this.runtime.scope.accessReady || !this.runtime.scope.hasAnyHostAccess())) return;
      const url = new URL(details.url), scheme = url.protocol.slice(0, -1);
      if (scheme !== 'http' && scheme !== 'https' && scheme !== 'ws' && scheme !== 'wss') return;
      const host = toAsciiHost(url.hostname);
      if (host === null) return;
      const category = redactHost(host);
      const local = category.kind === 'ip' && category.value !== 'public' || category.kind === 'local' && category.value !== 'single-label';
      const websocket = details.type === 'websocket' && (scheme === 'ws' || scheme === 'wss');
      const dnsDomain = !local && !websocket && (scheme === 'http' || scheme === 'https') && details.type === 'xmlhttprequest' &&
        category.kind === 'registrable' && isDnsProbeHostname(host, category.value) ? category.value : null;
      if (!local && !websocket && dnsDomain === null) return;
      // Browser-supplied identity only: an initiator/worker/blob origin never assigns an owner.
      if (!Number.isInteger(details.tabId) || details.tabId < 0 || !Number.isInteger(details.frameId) || details.frameId < 0 ||
          typeof details.documentId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(details.documentId) ||
          typeof details.requestId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(details.requestId)) {
        // Without an owner a narrow selected scope cannot be established. Startup/off likewise
        // cannot authorize even a diagnostic counter from a retained browser host grant.
        if (this.runtime.hydrationComplete && this.runtime.scope.getScopeMode() === 'all-sites' && this.runtime.scope.hasBroadNetworkAccess()) {
          const source = new URL(details.initiator ?? '');
          if (source.protocol === 'http:' || source.protocol === 'https:') this.runtime.dispatch({ type: 'network:unattributed', at: this.runtime.now() });
        }
        return;
      }
      if (details.documentLifecycle !== undefined && details.documentLifecycle !== 'active') return;
      const source = new URL(details.initiator ?? '');
      const origin = new URL(source.origin);
      const sourceHost = toAsciiHost(origin.hostname);
      if (sourceHost === null || origin.protocol !== 'http:' && origin.protocol !== 'https:') return;
      const event: Attempt = { documentKey: makeDocumentKey(details.tabId, details.frameId, details.documentId), tabId: details.tabId,
        documentId: details.documentId, requestId: details.requestId, host: dnsDomain ?? host, port: dnsDomain === null ? (url.port ? Number(url.port) : scheme === 'https' || scheme === 'wss' ? 443 : 80) : 0,
        scheme, sourceHost, sourceScheme: origin.protocol === 'https:' ? 'https' : 'http', websocket, local,
        at: this.runtime.now(), startup: !this.runtime.hydrationComplete, generation: this.runtime.scope.accessGeneration,
        ...(dnsDomain === null ? {} : { dnsDomain, dnsTargetGranted: this.runtime.scope.isHostGrantedSync(host, scheme) }) };
      const meta = this.runtime.state.metas.get(event.documentKey);
      if (meta?.paused || meta?.revoked) return;
      if ((!event.startup || dnsDomain !== null) && !this.allowed(event)) return;
      const authorized = this.runtime.hydrationComplete && this.runtime.canObserveNetworkDocument(event.documentKey);
      if (authorized && dnsDomain === null) this.accept(event);
      else {
        if (this.runtime.hydrationComplete && !authorized && !this.waitingForDocument(event)) return;
        if (dnsDomain !== null && this.hashing.size >= DNS_PROBE_LIMITS.hashes) { this.lost(event); return; }
        if (this.pending.length >= NETWORK_PENDING_LIMIT) this.lost(this.pending.shift()!);
        this.pending.push(event);
        if (dnsDomain !== null) this.hashDnsHost(event, host);
      }
      this.schedule();
    } catch { /* Invalid/native-inaccessible URL metadata supplies no trusted evidence. */ }
  }

  private allowed(event: Attempt): boolean {
    const scope = this.runtime.scope;
    return scope.accessReady && (!event.startup || scope.getScopeMode() === 'all-sites' && scope.hasBroadNetworkAccess()) &&
      (event.startup || event.generation === scope.accessGeneration) &&
      scope.inScope(event.sourceHost, event.tabId, event.documentId, event.sourceScheme) &&
      scope.isHostGrantedSync(event.sourceHost, event.sourceScheme) &&
      (event.dnsDomain === undefined ? scope.isHostGrantedSync(event.host, event.scheme) : event.dnsTargetGranted === true);
  }

  private hashDnsHost(event: Attempt, host: string): void {
    this.hashing.add(event);
    let input: Uint8Array<ArrayBuffer>;
    try {
      const salt = this.hashSalt ??= crypto.getRandomValues(new Uint8Array(16));
      const encoded = new TextEncoder().encode(host);
      input = new Uint8Array(salt.length + encoded.length);
      input.set(salt); input.set(encoded, salt.length); encoded.fill(0);
    } catch {
      this.hashing.delete(event);
      this.pending = this.pending.filter(pending => pending !== event);
      this.lost(event);
      return;
    }
    void (async () => {
      try {
        const pendingDigest = crypto.subtle.digest('SHA-256', input);
        input.fill(0);
        const digest = await pendingDigest;
        if (!this.pending.includes(event)) return;
        event.dnsToken = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
        this.flush();
      } catch {
        if (this.pending.includes(event)) {
          this.pending = this.pending.filter(pending => pending !== event);
          this.lost(event);
        }
      } finally {
        input.fill(0);
        this.hashing.delete(event);
        this.schedule();
      }
    })();
  }

  private waitingForDocument(event: Attempt): boolean {
    const meta = this.runtime.state.metas.get(event.documentKey);
    if (!meta) return true;
    if (meta.paused || meta.revoked) return false;
    return [...this.runtime.state.bindings.values()].some(binding => binding.documentKey === event.documentKey &&
      binding.originPending === true && (binding.documentLifecycle === null || binding.documentLifecycle === 'active'));
  }

  private accept(event: Attempt): void {
    const resetAt = this.resets.get(event.tabId);
    if (event.dnsDomain !== undefined) {
      if (!event.dnsToken || event.preVisitAt !== undefined || resetAt !== undefined && event.at < resetAt) return;
      const result = this.dnsWindow.record(event.documentKey, event.requestId, event.dnsDomain, event.dnsToken, event.at, this.runtime.now());
      if (result.evictedDocumentKey && this.runtime.canObserveNetworkDocument(result.evictedDocumentKey)) this.runtime.dispatch({ type: 'network:limited', documentKey: result.evictedDocumentKey, at: this.runtime.now() });
      if (result.count > 0) this.runtime.dispatch({ type: 'network:observed', documentKey: event.documentKey,
        websocket: false, local: false, multiPort: false, dnsUnique: result.count, limited: result.limited,
        epoch: this.runtime.state.metas.get(event.documentKey)?.networkCounterEpoch ?? crypto.randomUUID(), at: event.at });
      else if (result.limited) this.runtime.dispatch({ type: 'network:limited', documentKey: event.documentKey, at: this.runtime.now() });
      return;
    }
    const result = this.window.record(event.documentKey, event.requestId, event.local && event.preVisitAt === undefined && (resetAt === undefined || event.at >= resetAt) ? event.host : null, event.port, event.at, this.runtime.now());
    if (result.evictedDocumentKey && this.runtime.canObserveNetworkDocument(result.evictedDocumentKey)) this.runtime.dispatch({ type: 'network:limited', documentKey: result.evictedDocumentKey, at: this.runtime.now() });
    if (result.duplicate) {
      if (result.limited) this.runtime.dispatch({ type: 'network:limited', documentKey: event.documentKey, at: this.runtime.now() });
      return;
    }
    this.runtime.dispatch({ type: 'network:observed', documentKey: event.documentKey, websocket: event.websocket,
      local: event.local, multiPort: result.multiPort, limited: result.limited,
      ...(event.local ? { localPort: event.port } : {}),
      epoch: this.runtime.state.metas.get(event.documentKey)?.networkCounterEpoch ?? crypto.randomUUID(),
      ...(event.preVisitAt === undefined ? {} : { preVisitAt: event.preVisitAt }), at: event.at });
  }

  private lost(event: Attempt): void {
    if (!this.runtime.hydrationComplete) { if (event.startup) this.startupLoss = true; return; }
    if (!this.allowed(event)) return;
    if (this.runtime.canObserveNetworkDocument(event.documentKey)) this.runtime.dispatch({ type: 'network:limited', documentKey: event.documentKey, at: this.runtime.now() });
    else {
      if (this.losses.size >= NETWORK_PENDING_LIMIT) this.losses.delete(this.losses.keys().next().value!);
      this.losses.set(event.documentKey, this.runtime.now());
    }
    this.runtime.dispatch({ type: 'network:unattributed', at: this.runtime.now() });
  }

  flush(): void {
    if (this.flushing) return;
    this.flushing = true;
    try {
      const now = this.runtime.now();
      this.window.expire(now);
      this.dnsWindow.expire(now);
      for (const [tabId, at] of this.resets) if (now < at || now - at >= LOCAL_PROBE_WINDOW_MS) this.resets.delete(tabId);
      for (const [key, at] of this.losses) {
        if (now < at || now - at >= LOCAL_PROBE_WINDOW_MS) this.losses.delete(key);
        else if (this.runtime.canObserveNetworkDocument(key)) {
          this.losses.delete(key); this.runtime.dispatch({ type: 'network:limited', documentKey: key, at: now });
        }
      }
      const pending = this.pending; this.pending = [];
      for (const event of pending) {
        if (now < event.at || now - event.at >= NETWORK_PENDING_MS) { this.lost(event); continue; }
        if (!this.runtime.hydrationComplete) { this.pending.push(event); continue; }
        if (!this.allowed(event)) continue;
        if (this.runtime.canObserveNetworkDocument(event.documentKey)) {
          if (event.dnsDomain !== undefined && event.dnsToken === undefined) this.pending.push(event);
          else this.accept(event);
        }
        else if (this.waitingForDocument(event)) this.pending.push(event);
      }
      if (this.runtime.hydrationComplete && this.startupLoss) {
        this.startupLoss = false;
        if (this.runtime.scope.getScopeMode() === 'all-sites' && this.runtime.scope.hasBroadNetworkAccess()) {
          this.runtime.dispatch({ type: 'network:unattributed', at: now });
          for (const key of this.runtime.state.reports.keys()) if (this.runtime.canObserveNetworkDocument(key)) this.runtime.dispatch({ type: 'network:limited', documentKey: key, at: now });
        }
      }
    } finally { this.flushing = false; this.schedule(); }
  }

  afterEvent(event: DocumentEvent, before: DocumentsState): void {
    if (event.type === 'network:observed' || event.type === 'network:host' || event.type === 'network:limited' || event.type === 'network:unattributed') return;
    if (event.type === 'network:reset') this.clear(event.documentKey);
    if (event.type === 'tab:removed' || event.type === 'tab:replaced') {
      const tabId = event.type === 'tab:removed' ? event.tabId : event.removedTabId;
      this.pending = this.pending.filter(attempt => attempt.tabId !== tabId);
      this.resets.delete(tabId);
      for (const key of this.losses.keys()) if (key.startsWith(String(tabId) + ':')) this.losses.delete(key);
    }
    if (event.type === 'scope:revoked' || event.type === 'frames:retired' || event.type === 'document:evict') for (const key of event.documentKeys) this.clear(key);
    if (event.type === 'ui:clear' || event.type === 'ui:pause') this.clear(event.documentKey);
    const current = new Set([...this.runtime.state.bindings.values()].filter(b => b.documentLifecycle === null || b.documentLifecycle === 'active').map(b => b.documentKey));
    this.window.retain(current);
    this.dnsWindow.retain(current);
    for (const binding of before.bindings.values()) if (!current.has(binding.documentKey)) this.clear(binding.documentKey);
    if (event.type === 'navigation:committed' || event.type === 'scope:access' || event.type === 'batch') this.flush();
  }

  private schedule(): void {
    let deadline = Math.min(this.window.nextExpiry, this.dnsWindow.nextExpiry);
    for (const event of this.pending) deadline = Math.min(deadline, event.at + NETWORK_PENDING_MS);
    for (const at of this.losses.values()) deadline = Math.min(deadline, at + LOCAL_PROBE_WINDOW_MS);
    if (this.timer !== null && deadline >= this.timerAt) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null; this.timerAt = deadline;
    if (deadline === Infinity) return;
    this.timer = setTimeout(() => { this.timer = null; this.timerAt = Infinity; this.flush(); }, Math.max(1, deadline - this.runtime.now()));
  }
}
