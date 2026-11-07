import { CLIENT_HINT_NAMES, RESPONSE_HEADER_NAMES } from '../../contracts/src/response-headers';
import type { ClientHintName, ResponseHeaderName, ResponseHeadersSummary } from '../../contracts/src/response-headers';
import { makeDocumentKey, sanitizeHost } from '@detect-expert/contracts';
import type { RequestDetailsLike, ResponseHeadersDetailsLike } from './chrome-api';
import type { DocumentEvent } from './documents';
import { bindingKey } from './documents';
import type { BackgroundRuntime } from './runtime';
import { RateLimiter } from './rate-limit';

export function normalizeResponseHeaders(value: unknown, readHints = true): ResponseHeadersSummary {
  const result: ResponseHeadersSummary = { entries: [], truncated: false };
  if (!Array.isArray(value)) return result;
  if (value.length > 64) result.truncated = true;
  for (let index = 0; index < Math.min(value.length, 64); index++) {
    const entry = Object.getOwnPropertyDescriptor(value, String(index));
    const row: unknown = entry && Object.hasOwn(entry, 'value') ? entry.value : null;
    if (!row || typeof row !== 'object') { result.truncated = true; continue; }
    const nameField = Object.getOwnPropertyDescriptor(row, 'name');
    const rawName: unknown = nameField && Object.hasOwn(nameField, 'value') ? nameField.value : null;
    if (typeof rawName !== 'string' || rawName.length > 128) { result.truncated = true; continue; }
    const name = rawName.toLowerCase();
    if (!RESPONSE_HEADER_NAMES.includes(name as ResponseHeaderName)) continue;
    let normalized = result.entries.find(entry => entry.name === name);
    if (!normalized) { normalized = { name: name as ResponseHeaderName, count: 1, clientHints: [] }; result.entries.push(normalized); }
    if (!readHints || name !== 'accept-ch' && name !== 'critical-ch') continue;
    const bodyField = Object.getOwnPropertyDescriptor(row, 'value');
    const body: unknown = bodyField && Object.hasOwn(bodyField, 'value') ? bodyField.value : null;
    if (typeof body !== 'string' || body.length > 4096) { result.truncated = true; continue; }
    for (const token of body.split(',')) {
      const hint = token.trim().toLowerCase();
      if (!CLIENT_HINT_NAMES.includes(hint as ClientHintName)) { if (hint !== '') result.truncated = true; continue; }
      if (!normalized.clientHints.includes(hint as ClientHintName)) normalized.clientHints.push(hint as ClientHintName);
    }
  }
  return result;
}

export const RESPONSE_HEADERS_FILTER = { urls: ['http://*/*', 'https://*/*'] };

interface HeaderObservation {
  headers: ResponseHeadersSummary;
  at: number;
  accessGeneration: number;
  requiresAllSitesAccess: boolean;
  proPeriod: { sessionId: string; pageId: string; navigation: boolean } | null;
}
interface NavigationHeaderOwner {
  requestId: string | null;
  documentKey: string | null;
  ambiguous: boolean;
  completed: boolean;
  response: HeaderObservation | null;
  at: number;
}
type HeaderEvent = Extract<DocumentEvent, { type: 'network:headers' }>;

export class ResponseHeadersObserver {
  private readonly navigations = new Map<string, NavigationHeaderOwner>();
  private readonly limiter = new RateLimiter();
  private navigationLoss = false;

  constructor(private readonly runtime: BackgroundRuntime) {}

  clear(): void {
    this.navigations.clear();
    this.navigationLoss = false;
  }

  onBrowserEvent(event: DocumentEvent): HeaderEvent | null {
    if (!this.runtime.canBufferRedactedBrowserData()) return null;
    const at = this.runtime.now();
    for (const [slot, owner] of this.navigations) {
      if (at - owner.at > 60000) {
        if (owner.response) this.navigationLoss = true;
        this.navigations.delete(slot);
      } else if (owner.response && at - owner.response.at > 2000) owner.response.headers = { entries: [], truncated: true };
    }
    if (event.type === 'navigation:before') {
      const slot = bindingKey(event.tabId, event.frameId);
      const previous = this.navigations.get(slot);
      if (previous?.response) this.navigationLoss = true;
      if (this.navigations.size >= 128 && !this.navigations.has(slot)) {
        const first = this.navigations.keys().next();
        if (!first.done) {
          if (this.navigations.get(first.value)?.response) this.navigationLoss = true;
          this.navigations.delete(first.value);
        }
      }
      this.navigations.set(slot, { requestId: null, documentKey: null, ambiguous: previous !== undefined && previous.documentKey === null,
        completed: false, response: null, at });
    } else if (event.type === 'navigation:committed') {
      const slot = bindingKey(event.tabId, event.frameId);
      const owner = this.navigations.get(slot);
      const documentKey = makeDocumentKey(event.tabId, event.frameId, event.documentId);
      if (owner) {
        if (!owner.requestId || owner.documentKey !== null) owner.ambiguous = true;
        owner.documentKey = documentKey;
        if (owner.completed) {
          this.navigations.delete(slot);
          if (owner.response) return this.observationEvent(documentKey, owner.response, owner.ambiguous);
        }
      }
      if (this.navigationLoss) return { type: 'network:headers', documentKey, headers: { entries: [], truncated: true },
        ...(!this.runtime.hydrationComplete ? { requiresAllSitesAccess: true as const } : {}), at };
    } else if (event.type === 'navigation:error') this.navigations.delete(bindingKey(event.tabId, event.frameId));
    else if (event.type === 'tab:removed' || event.type === 'tab:replaced') {
      const tabId = event.type === 'tab:removed' ? event.tabId : event.removedTabId;
      for (const slot of this.navigations.keys()) if (slot.startsWith(String(tabId) + ':')) this.navigations.delete(slot);
    }
    return null;
  }

  onBeforeRequest(details: RequestDetailsLike): void {
    if (!this.runtime.canBufferRedactedBrowserData()) return;
    if (details.type !== 'main_frame' && details.type !== 'sub_frame') return;
    const owner = this.navigations.get(bindingKey(details.tabId, details.frameId));
    if (!owner || typeof details.requestId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(details.requestId)) return;
    if (owner.documentKey !== null || owner.requestId !== null && owner.requestId !== details.requestId) owner.ambiguous = true;
    else owner.requestId = details.requestId;
  }

  private observationEvent(documentKey: string, observation: HeaderObservation, ambiguous = false): HeaderEvent {
    const expired = this.runtime.now() - observation.at > 2000;
    const accessChanged = !observation.requiresAllSitesAccess && observation.accessGeneration !== this.runtime.scope.accessGeneration;
    const headers = ambiguous || expired || accessChanged ? { entries: [], truncated: true } : observation.headers;
    let proPeriod = observation.proPeriod;
    if (proPeriod?.navigation) {
      const committed = this.runtime.pro.headerPeriod(Number(documentKey.split(':')[0]), documentKey);
      proPeriod = committed?.sessionId === proPeriod.sessionId ? { ...committed, navigation: false } : null;
    }
    return { type: 'network:headers', documentKey, headers: this.navigationLoss ? { ...headers, truncated: true } : headers,
      ...(observation.requiresAllSitesAccess ? { requiresAllSitesAccess: true } : {}), proPeriod, at: observation.at };
  }

  readonly onCompleted = (details: ResponseHeadersDetailsLike): void => {
    const runtime = this.runtime;
    if (!runtime.canBufferRedactedBrowserData()) return;
    const requiresAllSitesAccess = !runtime.hydrationComplete;
    if (!requiresAllSitesAccess && (!runtime.scope.accessReady || !runtime.scope.hasAnyHostAccess())) return;
    if (!Number.isSafeInteger(details.tabId) || details.tabId < 0 || !Number.isSafeInteger(details.frameId) || details.frameId < 0 || typeof details.url !== 'string') return;
    const host = sanitizeHost(details.url), scheme = details.url.startsWith('https://') ? 'https' : details.url.startsWith('http://') ? 'http' : null;
    if (!host || !scheme || !requiresAllSitesAccess && !runtime.scope.isHostGrantedSync(host, scheme)) return;
    if (details.type !== 'main_frame') {
      const initiator = typeof details.initiator === 'string' ? details.initiator : '';
      const initiatorHost = sanitizeHost(initiator), initiatorScheme = initiator.startsWith('https://') ? 'https' : initiator.startsWith('http://') ? 'http' : null;
      if (!initiatorHost || !initiatorScheme || !requiresAllSitesAccess && !runtime.scope.isHostGrantedSync(initiatorHost, initiatorScheme)) return;
    }
    const slot = bindingKey(details.tabId, details.frameId);
    const navigation = details.type === 'main_frame' || details.type === 'sub_frame';
    const candidate = navigation ? this.navigations.get(slot) : undefined;
    const owner = candidate && candidate.requestId === details.requestId && runtime.now() - candidate.at <= 60000 ? candidate : undefined;
    const explicitDocument = typeof details.documentId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(details.documentId);
    const documentKey = explicitDocument ? makeDocumentKey(details.tabId, details.frameId, details.documentId!) : owner?.documentKey ?? null;
    if (owner) owner.completed = true;
    if (documentKey !== null && !requiresAllSitesAccess && !runtime.canObserveNetworkDocument(documentKey)) return;
    const at = runtime.now();
    let headers: ResponseHeadersSummary;
    try {
      headers = normalizeResponseHeaders(details.responseHeaders, false);
      if (!headers.entries.length && !headers.truncated) {
        if (owner?.documentKey) this.navigations.delete(slot);
        return;
      }
      if (documentKey === null && !owner) {
        this.navigationLoss = true;
        const binding = runtime.state.bindings.get(slot);
        if (binding && runtime.canObserveNetworkDocument(binding.documentKey) && !runtime.state.metas.get(binding.documentKey)?.responseHeaders?.truncated)
          runtime.dispatch({ type: 'network:headers', documentKey: binding.documentKey, headers: { entries: [], truncated: true }, at });
        return;
      }
      if (this.limiter.tryConsume(documentKey ?? 'navigation:' + slot, details.tabId, at)) headers = normalizeResponseHeaders(details.responseHeaders);
      else {
        if (documentKey !== null && runtime.state.metas.get(documentKey)?.responseHeaders?.truncated) return;
        headers = { entries: [], truncated: true };
      }
    } catch { headers = { entries: [], truncated: true }; }
    const period = runtime.pro.headerPeriod(details.tabId);
    const observation = { headers, at, accessGeneration: runtime.scope.accessGeneration, requiresAllSitesAccess,
      proPeriod: period ? { ...period, navigation: details.type === 'main_frame' } : null };
    if (documentKey === null) {
      if (owner) owner.response = observation;
      return;
    }
    if (owner) this.navigations.delete(slot);
    runtime.dispatch(this.observationEvent(documentKey, observation, !explicitDocument && owner?.ambiguous === true));
  };
}

export function createResponseHeadersListener(runtime: BackgroundRuntime): (details: ResponseHeadersDetailsLike) => void {
  return runtime.responseHeaders.onCompleted;
}