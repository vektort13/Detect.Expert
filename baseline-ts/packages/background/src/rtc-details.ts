// ADR-020: user-requested server endpoints; separate bounded session data, never ordinary reports/export.
import { RTC_LIMITS, sanitizeHost, validateRtcPageRequest, validateRtcSnapshot, validateRtcUiRequest } from '@detect-expert/contracts';
import type { RtcAck, RtcControl, RtcSnapshot, RtcStateResponse, RtcUiRequest, UiResponse, VendorSummary } from '@detect-expert/contracts';
import { matchVendorRtcServer } from '../../catalog/src/index';
import type { FrameDetailsLike, MessageSenderLike } from './chrome-api';
import type { DocumentEvent } from './documents';
import type { BackgroundRuntime } from './runtime';
import { readPageSender, verifyUiSender } from './sender';
import type { PageSenderContext } from './sender';

export const RTC_STORAGE_KEY = 'rtc-details-v1';
export const RTC_MAX_DOCUMENTS = RTC_LIMITS.maxDocuments;
export const RTC_MAX_GRANTS = 128;
export const RTC_IDLE_MS = RTC_LIMITS.idleMs;
export const RTC_MAX_PENDING = 8;
export type RtcResponse = RtcAck | RtcControl | RtcStateResponse | UiResponse;
type Context = Pick<PageSenderContext, 'tabId' | 'frameId' | 'documentId' | 'documentKey'>;
type Ancestor = { frameId: number; documentId: string };
type Grant = { context: Context; topDocumentId: string; ancestors: Ancestor[]; token: string; lastUsedAt: number; snapshot: RtcSnapshot | null; acceptedRevision: number; bytes: number };
export interface RtcVendorEvidence { observations: Array<{ occurrenceId: string; vendor: VendorSummary }>; observedAt: number | null }
type Operation = { context: Context; ancestors: Ancestor[]; invalid: boolean };
type BrowserFrames = { top: FrameDetailsLike & { documentId: string }; frames: FrameDetailsLike[] };
const active = (value: string | null | undefined): boolean => value === undefined || value === null || value === 'active';
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const token = (): string => Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('');
const denied = (): RtcControl => ({ schemaVersion: 1, type: 'rtc-control', enabled: false, token: null, reset: true });
const enabled = (grant: Grant): RtcControl => ({ schemaVersion: 1, type: 'rtc-control', enabled: true, token: grant.token, reset: false });
const ack = (accepted: boolean, reset = false): RtcAck => ({ schemaVersion: 1, type: 'rtc-ack', accepted, reset });
const error = (code: 'invalid-request' | 'unauthorized-sender' | 'not-found' | 'document-mismatch' | 'no-access'): UiResponse => ({ schemaVersion: 1, type: 'error', code });
const clone = (snapshot: RtcSnapshot): RtcSnapshot => ({ ...snapshot, connections: snapshot.connections.map(connection => ({ ...connection, servers: connection.servers.map(server => ({ ...server })) })) });

/** Tokens are private ISOLATED routing epochs, not authentication of page-controlled sensor claims. */
export class RtcDetailsManager {
  private readonly grants = new Map<string, Grant>();
  private readonly operations = new Set<Operation>();
  private readonly writingDocuments = new Set<string>();
  private readonly rates = new Map<string, { at: number; count: number }>();
  private rateGlobal = { at: 0, count: 0 };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private started: Promise<void> | null = null;
  private loaded = false;
  private stopped = false;
  private discardOnLoad = false;
  private dirty = false;
  private writer: Promise<void> | null = null;

  constructor(private readonly runtime: BackgroundRuntime) {}

  /** ADR-024: expose reviewed identities only, from an accepted, live, authorized snapshot. */
  vendorEvidence(documentKey: string): RtcVendorEvidence {
    const empty = (): RtcVendorEvidence => ({ observations: [], observedAt: null });
    const grant = this.grants.get(documentKey), meta = this.runtime.state.metas.get(documentKey);
    if (!this.loaded || this.stopped || !grant?.snapshot || grant.acceptedRevision !== grant.snapshot.revision ||
        this.runtime.now() - grant.lastUsedAt >= RTC_IDLE_MS || !meta?.bound || meta.paused || meta.revoked || meta.accessGranted === false ||
        !this.runtime.scope.accessReady || this.runtime.scope.getScopeMode() === 'off') return empty();
    const binding = [...this.runtime.state.bindings.values()].find(item => item.documentKey === documentKey && active(item.documentLifecycle));
    const top = this.runtime.state.tabs.get(grant.context.tabId)?.activeTopDocumentKey;
    if (!binding || top !== `${grant.context.tabId}:0:${grant.topDocumentId}`) return empty();
    const observations: RtcVendorEvidence['observations'] = [];
    const seen = new Set<string>();
    for (const connection of grant.snapshot.connections) for (const server of connection.servers) {
      if (!server.configured && !server.candidate && !server.error) continue;
      for (const match of matchVendorRtcServer(server.host, server.scheme, this.runtime.now())) {
        const occurrenceId = `${match.ruleId}:${connection.id}:${connection.configurationChanges}`;
        if (seen.has(occurrenceId)) continue;
        seen.add(occurrenceId);
        observations.push({ occurrenceId, vendor: { vendorId: match.vendorId, vendorConfidence: match.vendorConfidence,
          ruleIds: [match.ruleId], evidenceSource: match.evidenceSource, integrity: match.integrity } });
      }
    }
    return { observations, observedAt: observations.length ? grant.lastUsedAt : null };
  }

  /** Structural upper estimate includes all eight bounded snapshots and their storage identities. */
  estimatedBytes(): number {
    let bytes = 128;
    for (const grant of this.grants.values()) if (grant.snapshot) bytes += grant.bytes + 1024;
    return bytes;
  }

  private sendReset(context: Context): void {
    try { void this.runtime.api.tabs.sendMessage(context.tabId, { schemaVersion: 1, type: 'rtc-reset' },
      { frameId: context.frameId, documentId: context.documentId }).catch(() => undefined); } catch { /* Unloaded collector. */ }
  }

  /** Coalesce writes: at most one storage request plus one current bounded snapshot, never a payload queue. */
  private persist(): Promise<void> {
    if (!this.loaded || this.stopped) return Promise.resolve();
    this.dirty = true;
    if (this.writer) return this.writer;
    const write = async (): Promise<void> => {
      while (this.dirty && !this.stopped) {
        this.dirty = false;
        const documents = [...this.grants.values()].filter(grant => grant.snapshot !== null).map(grant => ({
          tabId: grant.context.tabId, frameId: grant.context.frameId, documentId: grant.context.documentId,
          topDocumentId: grant.topDocumentId, token: grant.token,
          lastUsedAt: Math.floor(grant.lastUsedAt / 1000) * 1000, snapshot: clone(grant.snapshot!),
        }));
        await this.runtime.api.storage.session.set({ [RTC_STORAGE_KEY]: { v: 1, documents } });
      }
    };
    const next = write();
    this.writer = next;
    void next.then(() => { if (this.writer === next) this.writer = null; }, () => {
      if (this.writer === next) this.writer = null;
      this.dirty = true; // Policy flush may retry; failed storage never grants an accepted snapshot.
    });
    return next;
  }

  async flush(): Promise<void> {
    if (this.started) await this.started;
    if (this.dirty) await this.persist();
    else if (this.writer) await this.writer;
  }

  start(): Promise<void> { if (!this.started) this.started = this.load(); return this.started; }

  private async load(): Promise<void> {
    let hadData = false;
    try {
      const raw = (await this.runtime.api.storage.session.get(RTC_STORAGE_KEY))[RTC_STORAGE_KEY];
      hadData = raw !== undefined;
      const value = raw as { v?: unknown; documents?: unknown } | undefined;
      if (!this.discardOnLoad && value?.v === 1 && Array.isArray(value.documents) && value.documents.length <= RTC_MAX_DOCUMENTS) {
        for (const candidate of value.documents) {
          if (!candidate || typeof candidate !== 'object' || Object.keys(candidate).sort().join(',') !== 'documentId,frameId,lastUsedAt,snapshot,tabId,token,topDocumentId') continue;
          const entry = candidate as Record<string, unknown>;
          const tabId = entry['tabId'], frameId = entry['frameId'], documentId = entry['documentId'], topDocumentId = entry['topDocumentId'];
          const savedToken = entry['token'], lastUsedAt = entry['lastUsedAt'];
          if (typeof tabId !== 'number' || !Number.isSafeInteger(tabId) || tabId < 0 || tabId > 2_147_483_647 ||
              typeof frameId !== 'number' || !Number.isSafeInteger(frameId) || frameId < 0 || frameId > 2_147_483_647 ||
              !id(documentId) || !id(topDocumentId) || typeof savedToken !== 'string' || !/^[a-f0-9]{32}$/.test(savedToken) ||
              typeof lastUsedAt !== 'number' || !Number.isSafeInteger(lastUsedAt) || lastUsedAt < 0 || lastUsedAt % 1000 !== 0 ||
              lastUsedAt > this.runtime.now() || this.runtime.now() - lastUsedAt >= RTC_IDLE_MS) continue;
          const checked = validateRtcSnapshot(entry['snapshot']);
          if (!checked.ok || checked.value.total === 0) continue;
          const context = { tabId, frameId, documentId, documentKey: tabId + ':' + frameId + ':' + documentId };
          const operation = this.begin(context, true);
          if (!operation) continue;
          try {
            const browser = await this.authorize(context, operation);
            if (!browser || browser.top.documentId !== topDocumentId || this.discardOnLoad) continue;
            this.grants.set(context.documentKey, { context, topDocumentId, ancestors: operation.ancestors, token: savedToken, lastUsedAt,
              snapshot: checked.value, acceptedRevision: checked.value.revision, bytes: this.snapshotBytes(checked.value) });
          } finally { this.operations.delete(operation); }
        }
      }
    } catch { /* Unavailable or malformed storage cannot authorize stale details. */ }
    this.loaded = true;
    if (!this.stopped) { if (hadData) await this.persist().catch(() => undefined); this.armExpiry(); }
  }

  stop(): void {
    this.stopped = true;
    for (const operation of this.operations) operation.invalid = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.grants.clear();
  }

  private begin(context: Context, hydration = false): Operation | null {
    // Pre-ready payload waiters must not consume the slot needed to reauthorize saved history.
    const maximum = this.loaded || hydration ? RTC_MAX_PENDING : RTC_MAX_PENDING - 1;
    if (this.stopped || this.operations.size >= maximum) return null;
    const operation: Operation = { context, ancestors: [], invalid: false };
    this.operations.add(operation);
    return operation;
  }

  private invalidate(test: (context: Context) => boolean): void {
    for (const operation of this.operations) if (test(operation.context)) operation.invalid = true;
  }

  private discard(key: string): void {
    this.invalidate(context => context.documentKey === key);
    const grant = this.grants.get(key);
    if (!grant) return;
    this.grants.delete(key);
    this.sendReset(grant.context);
    if (grant.snapshot) {
      this.runtime.dispatch({ type: 'vendor:updated', documentKey: key, at: this.runtime.now() });
      void this.persist().catch(() => undefined);
    }
  }

  clearDocument(key: string): void { this.discard(key); }
  clear(): void {
    this.discardOnLoad = true;
    this.invalidate(() => true);
    for (const key of this.grants.keys()) this.discard(key);
    void this.persist().catch(() => undefined);
    this.armExpiry();
  }

  /** Budget pressure drops this optional detail channel before degrading ordinary observation counters. */
  async dropForBudget(): Promise<void> { this.clear(); await this.flush(); }

  private prune(): void {
    const now = this.runtime.now();
    for (const [key, grant] of this.grants) if (now - grant.lastUsedAt >= RTC_IDLE_MS) this.discard(key);
  }

  private armExpiry(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    let next = Infinity;
    for (const grant of this.grants.values()) next = Math.min(next, grant.lastUsedAt + RTC_IDLE_MS);
    if (!this.stopped && Number.isFinite(next)) this.timer = setTimeout(() => { this.timer = null; this.prune(); this.armExpiry(); }, Math.max(1, next - this.runtime.now()));
  }

  onBrowserEvent(event: DocumentEvent): void {
    if (event.type === 'tab:removed' || event.type === 'tab:replaced') {
      const tabId = event.type === 'tab:removed' ? event.tabId : event.removedTabId;
      this.invalidate(context => context.tabId === tabId);
      for (const [key, grant] of this.grants) if (grant.context.tabId === tabId) this.discard(key);
    }
    if (event.type === 'navigation:committed' && active(event.documentLifecycle)) {
      this.invalidate(context => context.tabId === event.tabId && (event.frameId === 0 || context.frameId === event.frameId));
      for (const operation of this.operations) if (operation.context.tabId === event.tabId && operation.ancestors.some(ancestor => ancestor.frameId === event.frameId && ancestor.documentId !== event.documentId)) operation.invalid = true;
      for (const [key, grant] of this.grants) if (grant.context.tabId === event.tabId &&
        (event.frameId === 0 ? grant.topDocumentId !== event.documentId :
          (grant.context.frameId === event.frameId && grant.context.documentId !== event.documentId) ||
          grant.ancestors.some(ancestor => ancestor.frameId === event.frameId && ancestor.documentId !== event.documentId))) this.discard(key);
    }
  }

  afterEvent(event: DocumentEvent): void {
    if (event.type === 'ui:clear' || event.type === 'ui:pause' || event.type === 'transport:stopped') this.discard(event.documentKey);
    if (event.type === 'scope:revoked' || event.type === 'frames:retired' || event.type === 'document:evict') for (const key of event.documentKeys) this.discard(key);
    if (event.type === 'scope:access' && !event.accessGranted) this.discard(event.documentKey);
    if (event.type === 'navigation:committed') {
      for (const operation of this.operations) if (this.runtime.state.metas.get(operation.context.documentKey)?.bound === false) operation.invalid = true;
      for (const key of this.grants.keys()) if (this.runtime.state.metas.get(key)?.bound === false) this.discard(key);
    }
  }

  private permitted(key: string): boolean {
    const meta = this.runtime.state.metas.get(key);
    return !meta || (meta.bound && !meta.paused && !meta.revoked);
  }

  private async authorize(context: Context, operation: Operation, sender?: PageSenderContext): Promise<BrowserFrames | null> {
    if (operation.invalid || this.stopped || !this.permitted(context.documentKey)) return null;
    let frames: FrameDetailsLike[] | null | undefined;
    try { frames = await this.runtime.api.webNavigation.getAllFrames({ tabId: context.tabId }); } catch { return null; }
    if (!Array.isArray(frames) || frames.length > 1024) return null;
    const top = frames.find(frame => frame.frameId === 0 && active(frame.documentLifecycle));
    const frame = frames.find(item => item.frameId === context.frameId && item.documentId === context.documentId && active(item.documentLifecycle));
    if (!top || !id(top.documentId) || top.errorOccurred || !frame || frame.errorOccurred) return null;
    // Only browser-derived ancestry, kept in memory for early frames which do not yet have a report.
    const ancestors: Ancestor[] = [];
    let parentFrame = frame;
    for (let depth = 0; depth < 128 && parentFrame.frameId !== 0; depth++) {
      const parent = frames.find(item => active(item.documentLifecycle) && (parentFrame.parentDocumentId ?
        item.documentId === parentFrame.parentDocumentId : item.frameId === parentFrame.parentFrameId));
      if (!parent || !id(parent.documentId) || parent === parentFrame) break;
      ancestors.push({ frameId: parent.frameId, documentId: parent.documentId }); parentFrame = parent;
    }
    operation.ancestors = ancestors;
    let origin = frame;
    for (let depth = 0; depth < 128; depth++) {
      const host = sanitizeHost(origin.url);
      const scheme = origin.url.startsWith('https://') ? 'https' : origin.url.startsWith('http://') ? 'http' : null;
      if (host && scheme) {
        const pattern = scheme + '://' + host + '/*';
        if (sender && (sender.originPattern !== pattern || sender.host !== host)) return null;
        if (!(await this.runtime.scope.isGranted(pattern, context.tabId, context.documentId))) return null;
        if (operation.invalid || this.stopped || !this.permitted(context.documentKey)) return null;
        const binding = [...this.runtime.state.bindings.values()].find(item => item.tabId === context.tabId && item.frameId === context.frameId && active(item.documentLifecycle));
        if (binding && binding.documentId !== context.documentId) return null;
        return { top: top as BrowserFrames['top'], frames };
      }
      if ((origin.url !== 'about:blank' && origin.url !== 'about:srcdoc') || !origin.parentDocumentId) return null;
      const parent = frames.find(item => item.documentId === origin.parentDocumentId && active(item.documentLifecycle));
      if (!parent) return null;
      origin = parent;
    }
    return null;
  }

  private snapshotBytes(snapshot: RtcSnapshot): number { return new TextEncoder().encode(JSON.stringify(snapshot)).byteLength; }

  private consume(key: string): boolean {
    const now = this.runtime.now();
    if (now - this.rateGlobal.at >= 1000 || now < this.rateGlobal.at) this.rateGlobal = { at: now, count: 0 };
    if (this.rateGlobal.count >= 64) return false;
    let bucket = this.rates.get(key);
    if (!bucket || now - bucket.at >= 1000 || now < bucket.at) {
      if (!bucket && this.rates.size >= RTC_MAX_GRANTS) this.rates.delete(this.rates.keys().next().value!);
      bucket = { at: now, count: 0 }; this.rates.set(key, bucket);
    }
    if (bucket.count >= 8) return false; // At most four snapshots/s plus readiness/retry headroom.
    bucket.count++; this.rateGlobal.count++;
    return true;
  }

  private admit(context: Context, topDocumentId: string, ancestors: Ancestor[]): Grant {
    this.prune();
    const existing = this.grants.get(context.documentKey);
    if (existing) return existing;
    if (this.grants.size >= RTC_MAX_GRANTS) {
      let oldest: Grant | undefined;
      for (const grant of this.grants.values()) if (!grant.snapshot && (!oldest || grant.lastUsedAt < oldest.lastUsedAt)) oldest = grant;
      if (oldest) this.discard(oldest.context.documentKey);
    }
    const grant = { context, topDocumentId, ancestors, token: token(), lastUsedAt: this.runtime.now(), snapshot: null, acceptedRevision: 0, bytes: 0 };
    this.grants.set(context.documentKey, grant);
    this.armExpiry();
    return grant;
  }

  private admitSnapshot(grant: Grant): void {
    if (grant.snapshot) return;
    const records = [...this.grants.values()].filter(item => item.snapshot !== null);
    if (records.length < RTC_MAX_DOCUMENTS) return;
    let oldest = records[0]!;
    for (const item of records) if (item.lastUsedAt < oldest.lastUsedAt) oldest = item;
    this.discard(oldest.context.documentKey);
  }

  private async page(message: unknown, context: PageSenderContext): Promise<RtcResponse> {
    if (!this.runtime.scope.dataConsentLoaded) return error('no-access');
    if (!this.runtime.scope.hasDataConsent) return Object.getOwnPropertyDescriptor(message as object, 'type')?.value === 'rtc-ready' ? denied() : ack(false, true);
    if (!this.consume(context.documentKey)) return ack(false);
    const checked = validateRtcPageRequest(message);
    if (!checked.ok) return error('invalid-request');
    const reject = () => checked.value.type === 'rtc-ready' ? denied() : ack(false, true);
    if (!active(context.documentLifecycle) || !context.originPattern || !this.permitted(context.documentKey)) return reject();
    if (this.writingDocuments.has(context.documentKey)) return ack(false);
    const operation = this.begin(context);
    if (!operation) return ack(false);
    this.writingDocuments.add(context.documentKey);
    try {
      if (!(await this.runtime.whenPageReady(context.documentKey))) return reject();
      await this.start();
      const browser = await this.authorize(context, operation, context);
      if (!browser) return reject();
      this.prune();
      const request = checked.value;
      if (request.type === 'rtc-ready') return enabled(this.admit(context, browser.top.documentId, operation.ancestors));
      const grant = this.grants.get(context.documentKey);
      if (!grant || grant.token !== request.token || grant.topDocumentId !== browser.top.documentId) return ack(false, true);
      if (grant.snapshot && request.snapshot.revision <= grant.snapshot.revision) return ack(true);
      if (request.snapshot.total === 0) return ack(true); // Empty snapshots cannot consume/evict persisted slots.
      const bytes = this.snapshotBytes(request.snapshot);
      if (bytes > RTC_LIMITS.maxBytes) return error('invalid-request');
      this.admitSnapshot(grant);
      grant.snapshot = request.snapshot;
      grant.bytes = bytes;
      grant.lastUsedAt = this.runtime.now();
      this.armExpiry();
      try { await this.persist(); } catch { this.discard(context.documentKey); return error('invalid-request'); }
      if (operation.invalid || this.grants.get(context.documentKey) !== grant || !this.permitted(context.documentKey)) return ack(false, true);
      const current = await this.authorize(context, operation, context);
      if (!current || current.top.documentId !== grant.topDocumentId || this.grants.get(context.documentKey) !== grant) {
        if (this.grants.get(context.documentKey) === grant) this.discard(context.documentKey);
        return ack(false, true);
      }
      grant.acceptedRevision = request.snapshot.revision;
      this.runtime.dispatch({ type: 'vendor:updated', documentKey: context.documentKey, at: this.runtime.now() });
      void this.runtime.enforceTotalBudget();
      return ack(true);
    } finally { this.writingDocuments.delete(context.documentKey); this.operations.delete(operation); }
  }

  private async ui(request: RtcUiRequest): Promise<RtcResponse> {
    await this.runtime.whenReady();
    await this.start();
    const report = this.runtime.state.reports.get(request.documentKey);
    if (!report) return error('not-found');
    if (report.tabId !== request.tabId) return error('document-mismatch');
    const context = { tabId: report.tabId, frameId: report.frameId, documentId: report.documentId, documentKey: request.documentKey };
    const operation = this.begin(context);
    if (!operation) return error('no-access');
    try {
      const browser = await this.authorize(context, operation);
      if (!browser) return error('no-access');
      const binding = [...this.runtime.state.bindings.values()].find(item => item.documentKey === context.documentKey && active(item.documentLifecycle));
      if (!binding) return error('no-access');
      this.prune();
      const grant = this.grants.get(context.documentKey);
      if (grant && grant.topDocumentId !== browser.top.documentId) { this.discard(context.documentKey); return error('no-access'); }
      return { schemaVersion: 1, type: 'rtc-state', documentKey: context.documentKey, snapshot: grant?.snapshot ? clone(grant.snapshot) : null };
    } finally { this.operations.delete(operation); }
  }

  route(message: unknown, sender: MessageSenderLike): Promise<RtcResponse> | null {
    const type = typeof message === 'object' && message !== null ? Object.getOwnPropertyDescriptor(message, 'type')?.value : undefined;
    if (type !== 'rtc-ready' && type !== 'rtc-snapshot' && type !== 'ui-rtc-get') return null;
    if (verifyUiSender(sender, this.runtime.api.runtime.id)) {
      const checked = validateRtcUiRequest(message);
      return checked.ok ? this.ui(checked.value) : Promise.resolve(error('invalid-request'));
    }
    const read = readPageSender(sender, this.runtime.api.runtime.id);
    if (!read.ok || type === 'ui-rtc-get') return Promise.resolve(error('unauthorized-sender'));
    return this.page(message, read.context);
  }
}
