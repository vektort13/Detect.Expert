import { makeDocumentKey, sanitizeHost } from '@detect-expert/contracts';
import type { CoverageState, UiResponse } from '@detect-expert/contracts';
import { GOOGLE_IDS_DOMAINS, GOOGLE_IDS_LIMITS, isClientDataHeader, isGoogleIdsHost, readGoogleIdsRequest } from '../../contracts/src/google-ids';
import type { GoogleIdsEntry, GoogleIdsRequest, GoogleIdsState } from '../../contracts/src/google-ids';
import type { MessageSenderLike, RequestDetailsLike, RequestHeadersDetailsLike } from './chrome-api';
import type { DocumentEvent } from './documents';
import { bindingKey } from './documents';
import { RateLimiter } from './rate-limit';
import type { BackgroundRuntime } from './runtime';
import { verifyUiSender } from './sender';

export const GOOGLE_IDS_FILTER = { urls: GOOGLE_IDS_DOMAINS.map(host => 'https://*.' + host + '/*') };
const active = (lifecycle: string | null | undefined): boolean => lifecycle === undefined || lifecycle === null || lifecycle === 'active';
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const validNumber = (value: number): boolean => Number.isSafeInteger(value) && value >= 0 && value <= 2147483647;

export function normalizeGoogleClientData(headers: unknown, host: string): GoogleIdsEntry {
  const empty = (status: GoogleIdsEntry['status']): GoogleIdsEntry => ({ host, status, header: null });
  if (!Array.isArray(headers) || headers.length > 128) return empty('unavailable');
  let selected: GoogleIdsEntry | null = null;
  for (let index = 0; index < headers.length; index++) {
    const item = Object.getOwnPropertyDescriptor(headers, index);
    if (!item || !Object.hasOwn(item, 'value') || typeof item.value !== 'object' || item.value === null) return empty('unavailable');
    const name = Object.getOwnPropertyDescriptor(item.value, 'name');
    if (!name || !Object.hasOwn(name, 'value') || typeof name.value !== 'string' || name.value.length > 128) return empty('unavailable');
    if (name.value.toLowerCase() !== 'x-client-data') continue;
    if (selected) return empty('invalid');
    const field = Object.getOwnPropertyDescriptor(item.value, 'value');
    if (!field || !Object.hasOwn(field, 'value') || typeof field.value !== 'string') selected = empty('unavailable');
    else if (field.value.length > GOOGLE_IDS_LIMITS.headerChars) selected = empty('too-large');
    else if (!isClientDataHeader(field.value)) selected = empty('invalid');
    else selected = { host, status: 'observed', header: field.value };
  }
  return selected ?? empty('not-present');
}

interface Snapshot { entries: Map<string, { row: GoogleIdsEntry; at: number }>; truncated: boolean }
interface Navigation {
  at: number;
  generation: number;
  requestId: string | null;
  ambiguous: boolean;
  committedHostMatches: boolean;
  observation: { row: GoogleIdsEntry; at: number } | null;
}
interface ReadOperation { epoch: number; invalid: boolean }

export class GoogleIdsManager {
  private readonly snapshots = new Map<string, Snapshot>();
  private readonly navigations = new Map<string, Navigation>();
  private readonly limiter = new RateLimiter();
  private readonly operations = new Set<ReadOperation>();
  private supported = false;
  private epoch = 0;
  private limited = false;

  constructor(private readonly runtime: BackgroundRuntime) {}

  setSupported(value: boolean): void { this.supported = value; if (!value) this.clear(); }

  clear(): void {
    this.snapshots.clear(); this.navigations.clear(); this.limited = false; this.epoch++;
    for (const operation of this.operations) operation.invalid = true;
  }

  private prune(): void {
    const now = this.runtime.now();
    for (const [key, snapshot] of this.snapshots) {
      for (const [host, entry] of snapshot.entries) if (now - entry.at >= GOOGLE_IDS_LIMITS.ttlMs) {
        snapshot.entries.delete(host); snapshot.truncated = true;
      }
      if (snapshot.entries.size === 0) { this.snapshots.delete(key); this.limited = true; }
    }
    for (const [slot, navigation] of this.navigations) {
      if (navigation.observation && now - navigation.observation.at >= GOOGLE_IDS_LIMITS.navigationMs) {
        navigation.observation = null; navigation.ambiguous = true; this.limited = true;
      }
      if (now - navigation.at >= 60000) { this.navigations.delete(slot); this.limited = true; }
    }
  }

  private discard(tabId: number, frameId?: number): void {
    const prefix = tabId + ':' + (frameId === undefined ? '' : frameId + ':');
    for (const key of this.snapshots.keys()) if (key.startsWith(prefix)) this.snapshots.delete(key);
    this.epoch++;
  }

  onBrowserEvent(event: DocumentEvent): void {
    if (!this.runtime.scope.hasDataConsent) return;
    this.prune();
    if (event.type === 'navigation:before') {
      const slot = bindingKey(event.tabId, event.frameId);
      const previous = this.navigations.get(slot);
      if (this.navigations.size >= GOOGLE_IDS_LIMITS.pending && !previous) {
        const first = this.navigations.keys().next();
        if (!first.done) this.navigations.delete(first.value);
        this.limited = true;
      }
      this.navigations.set(slot, { at: this.runtime.now(), generation: this.runtime.scope.accessGeneration,
        requestId: null, ambiguous: previous !== undefined, committedHostMatches: false, observation: null });
    } else if (event.type === 'navigation:committed') {
      const navigation = this.navigations.get(bindingKey(event.tabId, event.frameId));
      if (navigation) navigation.committedHostMatches = event.scheme === 'https' && event.host === navigation.observation?.row.host;
    } else if (event.type === 'navigation:error') this.navigations.delete(bindingKey(event.tabId, event.frameId));
  }

  afterEvent(event: DocumentEvent): void {
    this.prune();
    if (event.type === 'navigation:committed') {
      if (!active(event.documentLifecycle)) return;
      const slot = bindingKey(event.tabId, event.frameId);
      const navigation = this.navigations.get(slot);
      this.navigations.delete(slot);
      this.discard(event.tabId, event.frameId === 0 ? undefined : event.frameId);
      if (event.frameId === 0) for (const pending of this.navigations.keys()) if (pending.startsWith(event.tabId + ':')) this.navigations.delete(pending);
      const key = makeDocumentKey(event.tabId, event.frameId, event.documentId);
      if (!navigation?.observation) return;
      if (navigation.ambiguous || navigation.generation !== this.runtime.scope.accessGeneration ||
        !navigation.committedHostMatches || !this.runtime.canObserveNetworkDocument(key)) { this.limited = true; return; }
      this.store(key, navigation.observation.row, navigation.observation.at);
    } else if (event.type === 'ui:pause' || event.type === 'ui:clear' || event.type === 'transport:stopped' || event.type === 'scope:access' && !event.accessGranted) {
      this.snapshots.delete(event.documentKey);
      const [tab, frame] = event.documentKey.split(':');
      this.navigations.delete(bindingKey(Number(tab), Number(frame)));
      this.epoch++;
    } else if (event.type === 'scope:revoked' || event.type === 'frames:retired' || event.type === 'document:evict') {
      for (const key of event.documentKeys) {
        this.snapshots.delete(key);
        const [tab, frame] = key.split(':');
        this.navigations.delete(bindingKey(Number(tab), Number(frame)));
      }
      this.epoch++;
    } else if (event.type === 'tab:removed' || event.type === 'tab:replaced') {
      const tabId = event.type === 'tab:removed' ? event.tabId : event.removedTabId;
      this.discard(tabId);
      for (const slot of this.navigations.keys()) if (slot.startsWith(tabId + ':')) this.navigations.delete(slot);
    }
  }

  onBeforeRequest(details: RequestDetailsLike): void {
    if (!this.runtime.scope.hasDataConsent) return;
    if (details.type !== 'main_frame' && details.type !== 'sub_frame') return;
    const navigation = this.navigations.get(bindingKey(details.tabId, details.frameId));
    if (!navigation || typeof details.requestId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(details.requestId)) return;
    if (navigation.requestId !== null && navigation.requestId !== details.requestId) { navigation.ambiguous = true; navigation.observation = null; this.limited = true; }
    else navigation.requestId = details.requestId;
  }

  private store(key: string, row: GoogleIdsEntry, at: number): void {
    let snapshot = this.snapshots.get(key);
    if (!snapshot) {
      if (this.snapshots.size >= GOOGLE_IDS_LIMITS.documents) {
        const first = this.snapshots.keys().next();
        if (!first.done) { this.snapshots.delete(first.value); this.epoch++; }
        this.limited = true;
      }
      snapshot = { entries: new Map(), truncated: false };
      this.snapshots.set(key, snapshot);
    }
    if (!snapshot.entries.has(row.host) && snapshot.entries.size >= GOOGLE_IDS_LIMITS.rows) {
      const first = snapshot.entries.keys().next();
      if (!first.done) { snapshot.entries.delete(first.value); this.epoch++; }
      snapshot.truncated = true;
    }
    snapshot.entries.set(row.host, { row, at });
    if (row.status !== 'observed' && row.status !== 'not-present') snapshot.truncated = true;
  }

  readonly onSendHeaders = (details: RequestHeadersDetailsLike): void => {
    const runtime = this.runtime;
    this.prune();
    if (!this.supported || !runtime.hydrationComplete || !runtime.scope.accessReady || !runtime.scope.hasAnyHostAccess() ||
      !validNumber(details.tabId) || !validNumber(details.frameId) || !active(details.documentLifecycle) ||
      typeof details.url !== 'string' || !details.url.startsWith('https://')) return;
    const host = sanitizeHost(details.url);
    if (!isGoogleIdsHost(host) || !runtime.scope.isHostGrantedSync(host, 'https')) return;
    if (details.type !== 'main_frame') {
      const initiator = details.initiator;
      const origin = typeof initiator === 'string' ? sanitizeHost(initiator) : null;
      const scheme = initiator?.startsWith('https://') ? 'https' : initiator?.startsWith('http://') ? 'http' : null;
      if (!origin || !scheme || !runtime.scope.isHostGrantedSync(origin, scheme)) return;
    }
    const navigation = details.type === 'main_frame' || details.type === 'sub_frame';
    const slot = bindingKey(details.tabId, details.frameId);
    const owner = navigation ? this.navigations.get(slot) : undefined;
    if (navigation && (runtime.scope.getScopeMode() !== 'all-sites' || !runtime.scope.getState().grantedAllSites ||
      !owner || owner.ambiguous || owner.requestId !== details.requestId || owner.generation !== runtime.scope.accessGeneration)) { this.limited = true; return; }
    const key = !navigation && validId(details.documentId) ? makeDocumentKey(details.tabId, details.frameId, details.documentId) : null;
    if (!navigation && (!key || !runtime.canObserveNetworkDocument(key))) return;
    const now = runtime.now();
    if (!this.limiter.tryConsume(key ?? 'navigation:' + slot, details.tabId, now)) { this.limited = true; return; }
    let row: GoogleIdsEntry;
    try { row = normalizeGoogleClientData(details.requestHeaders, host); }
    catch { row = { host, status: 'unavailable', header: null }; }
    if (navigation && owner) {
      if (owner.observation && owner.observation.row.host !== host) this.limited = true;
      owner.observation = { row, at: now };
    } else if (key) this.store(key, row, now);
  };

  private state(key: string, coverageState: CoverageState, entries: GoogleIdsEntry[] = [], truncated = true): GoogleIdsState {
    return { schemaVersion: 1, type: 'google-ids-state', documentKey: key, evidenceSource: 'browser-network', integrity: 'browser-observed',
      coverageState, entries, truncated };
  }

  private async read(request: GoogleIdsRequest, operation: ReadOperation): Promise<GoogleIdsState> {
    const runtime = this.runtime;
    await runtime.whenReady();
    this.prune();
    if (!this.supported) return this.state(request.documentKey, 'unsupported');
    if (runtime.state.metas.get(request.documentKey)?.paused) return this.state(request.documentKey, 'paused');
    const generation = runtime.scope.accessGeneration;
    const allowed = (): boolean => !operation.invalid && operation.epoch === this.epoch && generation === runtime.scope.accessGeneration &&
      runtime.canObserveNetworkDocument(request.documentKey) && runtime.getProjection(request.tabId, request.frameId)?.documentKey === request.documentKey;
    if (!allowed()) return this.state(request.documentKey, 'no-access');
    const frames = await runtime.api.webNavigation.getAllFrames({ tabId: request.tabId });
    if (!allowed() || !Array.isArray(frames) || frames.length > 1024) return this.state(request.documentKey, 'no-access');
    const frame = frames.find(item => item.frameId === request.frameId && makeDocumentKey(request.tabId, item.frameId, item.documentId ?? '') === request.documentKey &&
      active(item.documentLifecycle) && !item.errorOccurred);
    if (!frame) return this.state(request.documentKey, 'no-access');
    let current = frame;
    for (let depth = 0; depth < 128 && (current.url === 'about:blank' || current.url === 'about:srcdoc'); depth++) {
      const parent = frames.find(item => item.documentId === current.parentDocumentId && active(item.documentLifecycle) && !item.errorOccurred);
      if (!parent) return this.state(request.documentKey, 'no-access');
      current = parent;
    }
    const host = sanitizeHost(current.url);
    const scheme = current.url.startsWith('https://') ? 'https' : current.url.startsWith('http://') ? 'http' : null;
    if (!host || !scheme || !await runtime.scope.isGranted(scheme + '://' + host + '/*', request.tabId, frame.documentId) || !allowed())
      return this.state(request.documentKey, 'no-access');
    const snapshot = this.snapshots.get(request.documentKey);
    const captured = [...snapshot?.entries.values() ?? []].map(entry => ({ row: { ...entry.row }, at: entry.at }));
    for (const { row } of captured) {
      if (!runtime.scope.isHostGrantedSync(row.host, 'https') || !await runtime.api.permissions.contains({ origins: ['https://' + row.host + '/*'] }) || !allowed())
        return this.state(request.documentKey, 'no-access');
    }
    const currentFrames = await runtime.api.webNavigation.getAllFrames({ tabId: request.tabId });
    if (!allowed() || !Array.isArray(currentFrames) || currentFrames.length > 1024 || !currentFrames.some(item => item.frameId === request.frameId &&
      item.documentId === frame.documentId && active(item.documentLifecycle) && !item.errorOccurred)) return this.state(request.documentKey, 'no-access');
    this.prune();
    const entries = captured.filter(entry => runtime.now() - entry.at < GOOGLE_IDS_LIMITS.ttlMs).map(entry => entry.row);
    return this.state(request.documentKey, 'partial', entries, this.limited || entries.length !== captured.length || (snapshot?.truncated ?? false));
  }

  route(message: unknown, sender: MessageSenderLike): Promise<GoogleIdsState | UiResponse> | null {
    if (typeof message !== 'object' || message === null || Object.getOwnPropertyDescriptor(message, 'type')?.value !== 'ui-google-ids') return null;
    if (!verifyUiSender(sender, this.runtime.api.runtime.id)) return Promise.resolve({ schemaVersion: 1, type: 'error', code: 'unauthorized-sender' });
    const request = readGoogleIdsRequest(message);
    if (!request) return Promise.resolve({ schemaVersion: 1, type: 'error', code: 'invalid-request' });
    if (this.operations.size >= 4) return Promise.resolve(this.state(request.documentKey, 'degraded'));
    const operation = { epoch: this.epoch, invalid: false };
    this.operations.add(operation);
    const work = this.read(request, operation).catch(() => this.state(request.documentKey, 'no-access')).finally(() => this.operations.delete(operation));
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([work, new Promise<GoogleIdsState>(resolve => {
      timer = setTimeout(() => { operation.invalid = true; resolve(this.state(request.documentKey, 'degraded')); }, 2000);
    })]).finally(() => { if (timer !== undefined) clearTimeout(timer); });
  }
}