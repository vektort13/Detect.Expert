// ADR-017/018: pixels stay in volatile SW/ISOLATED memory; session storage contains only four owner records.
import { VISUAL_LIMITS, VISUAL_CACHE_IDLE_MS, retainVisualImage, sanitizeHost, validateVisualCacheState, validateVisualPageRequest, validateVisualUiRequest } from '@detect-expert/contracts';
import type { BridgeVisualControl, UiResponse, VisualImage, VisualStateResponse, VisualUiRequest, VisualFrameAck } from '@detect-expert/contracts';
import type { FrameDetailsLike, MessageSenderLike } from './chrome-api';
import type { DocumentEvent } from './documents';
import type { BackgroundRuntime } from './runtime';
import { readPageSender, verifyUiSender } from './sender';
import type { PageSenderContext } from './sender';

export type VisualResponse = BridgeVisualControl | VisualFrameAck | VisualStateResponse | UiResponse;
export const MAX_VISUAL_DOCUMENTS = VISUAL_LIMITS.maxDocuments;
export const VISUAL_IDLE_MS = VISUAL_CACHE_IDLE_MS;
export const VISUAL_OWNER_KEY = 'visual-owners-v1';
export const VISUAL_READ_TIMEOUT_MS = 1500;
const TOUCH_MS = 60_000;
type DocumentImages = { context: PageSenderContext; topDocumentId: string; cacheToken: string; images: Map<string, VisualImage>; truncated: boolean; needsRecovery: boolean; lastUsedAt: number; lastTouchAt: number };
type BrowserFrames = { top: FrameDetailsLike & { documentId: string }; frames: FrameDetailsLike[] };
type FrameOrigin = { host: string; scheme: 'http' | 'https'; pattern: string };
type Operation = { context: Pick<PageSenderContext, 'documentKey' | 'tabId' | 'frameId'>; invalid: boolean };
const disabled = (): BridgeVisualControl => ({ schemaVersion: 1, type: 'visual-control', enabled: false, remainingMs: 0 });
const control = (): BridgeVisualControl => ({ schemaVersion: 1, type: 'visual-control', enabled: true, remainingMs: VISUAL_LIMITS.leaseMs });
const rejected = (): VisualFrameAck => ({ schemaVersion: 1, type: 'visual-frame-ack', accepted: false, cacheToken: null, remainingMs: 0 });
const error = (code: 'unauthorized-sender' | 'invalid-request' | 'not-found' | 'document-mismatch' | 'stale-revision' | 'no-access'): UiResponse => ({ schemaVersion: 1, type: 'error', code });
const active = (lifecycle: string | null | undefined): boolean => lifecycle === undefined || lifecycle === null || lifecycle === 'active';
const documentId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const token = (): string => Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('');

/** The owner registry is metadata only; images never enter DocumentsState, repository or export. */
export class VisualPreviewManager {
  private readonly documents = new Map<string, DocumentImages>();
  private readonly operations = new Set<Operation>();
  private readonly recoveries = new Map<string, Promise<boolean>>();
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private writeTail: Promise<void> = Promise.resolve();
  private started: Promise<void> | null = null;
  private loaded = false;
  private discardOnLoad = false;
  private stopped = false;

  constructor(private readonly runtime: BackgroundRuntime) {}

  private send(context: PageSenderContext, message: unknown): void {
    try { void this.runtime.api.tabs.sendMessage(context.tabId, message, { frameId: context.frameId, documentId: context.documentId }).catch(() => undefined); } catch { /* Missing collector. */ }
  }

  private persist(): Promise<void> {
    if (!this.loaded || this.stopped) return Promise.resolve();
    const owners = [...this.documents.values()].map(record => ({
      tabId: record.context.tabId, frameId: record.context.frameId, documentId: record.context.documentId,
      topDocumentId: record.topDocumentId, cacheToken: record.cacheToken,
      lastUsedAt: Math.floor(record.lastUsedAt / 1000) * 1000,
    }));
    const next = this.writeTail.catch(() => undefined).then(() => this.runtime.api.storage.session.set({ [VISUAL_OWNER_KEY]: { v: 1, owners } }));
    this.writeTail = next;
    void next.catch(() => undefined);
    return next;
  }

  /** Explicit policy changes await this before acknowledging success to privileged UI. */
  async flush(): Promise<void> { if (this.started) await this.started; await this.writeTail; }

  /** Called once after normal document/scope hydration, before buffered events are released. */
  start(): Promise<void> {
    if (this.started) return this.started;
    this.started = this.load();
    return this.started;
  }

  private async load(): Promise<void> {
    let hadRegistry = false;
    try {
      const raw = (await this.runtime.api.storage.session.get(VISUAL_OWNER_KEY))[VISUAL_OWNER_KEY];
      hadRegistry = raw !== undefined;
      if (!this.discardOnLoad && raw && typeof raw === 'object') {
        const value = raw as Record<string, unknown>;
        const owners = value['owners'];
        if (value['v'] === 1 && Array.isArray(owners) && owners.length <= MAX_VISUAL_DOCUMENTS) {
          for (const candidate of owners) {
            if (!candidate || typeof candidate !== 'object') continue;
            const entry = candidate as Record<string, unknown>;
            const tabId = entry['tabId'], frameId = entry['frameId'], id = entry['documentId'], topDocumentId = entry['topDocumentId'];
            const cacheToken = entry['cacheToken'], lastUsedAt = entry['lastUsedAt'];
            if (Object.keys(entry).sort().join(',') !== 'cacheToken,documentId,frameId,lastUsedAt,tabId,topDocumentId' ||
                typeof tabId !== 'number' || !Number.isSafeInteger(tabId) || tabId < 0 || tabId > 2_147_483_647 ||
                typeof frameId !== 'number' || !Number.isSafeInteger(frameId) || frameId < 0 || frameId > 2_147_483_647 ||
                !documentId(id) || !documentId(topDocumentId) || typeof cacheToken !== 'string' || !/^[a-f0-9]{32}$/.test(cacheToken) ||
                typeof lastUsedAt !== 'number' || !Number.isSafeInteger(lastUsedAt) || lastUsedAt < 0 ||
                lastUsedAt > this.runtime.now() || this.runtime.now() - lastUsedAt >= VISUAL_IDLE_MS) continue;
            const context: PageSenderContext = { tabId, frameId, documentId: id, documentKey: tabId + ':' + frameId + ':' + id,
              host: null, originPattern: null, documentLifecycle: 'active', frameType: null };
            const browser = await this.authorize(context);
            if (!browser || browser.top.documentId !== topDocumentId || this.discardOnLoad || this.stopped) continue;
            this.documents.set(context.documentKey, { context, topDocumentId, cacheToken, lastUsedAt,
              lastTouchAt: lastUsedAt, images: new Map(), truncated: false, needsRecovery: true });
          }
        }
      }
    } catch { /* Invalid/unavailable metadata cannot authorize replay. */ }
    this.loaded = true;
    if (!this.stopped) { if (hadRegistry) await this.persist().catch(() => undefined); this.armExpiry(); }
  }

  /** Worker disposal is not a user clear. Retained copies/metadata survive normal SW suspension. */
  stop(): void {
    this.stopped = true;
    for (const operation of this.operations) operation.invalid = true;
    if (this.expiryTimer !== null) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    this.documents.clear();
  }

  private invalidate(test: (context: Operation['context']) => boolean): void {
    for (const operation of this.operations) if (test(operation.context)) operation.invalid = true;
  }

  private discard(key: string): void {
    this.invalidate(context => context.documentKey === key);
    const record = this.documents.get(key);
    if (!record) return;
    this.send(record.context, disabled());
    this.documents.delete(key);
    void this.persist();
  }

  clear(): void {
    this.discardOnLoad = true;
    this.invalidate(() => true);
    if (this.expiryTimer !== null) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    for (const key of this.documents.keys()) this.discard(key);
    void this.persist();
  }

  clearDocument(documentKey: string): void { this.discard(documentKey); }

  private prune(): void {
    const now = this.runtime.now();
    for (const [key, record] of this.documents) if (now - record.lastUsedAt >= VISUAL_IDLE_MS) this.discard(key);
  }

  private armExpiry(): void {
    if (this.expiryTimer !== null) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    let next = Infinity;
    for (const record of this.documents.values()) next = Math.min(next, record.lastUsedAt + VISUAL_IDLE_MS);
    if (!this.stopped && Number.isFinite(next)) this.expiryTimer = setTimeout(() => { this.expiryTimer = null; this.prune(); this.armExpiry(); }, Math.max(1, next - this.runtime.now()));
  }

  onBrowserEvent(event: DocumentEvent): void {
    if (event.type === 'tab:removed' || event.type === 'tab:replaced') {
      const tabId = event.type === 'tab:removed' ? event.tabId : event.removedTabId;
      this.invalidate(context => context.tabId === tabId);
      for (const [key, record] of this.documents) if (record.context.tabId === tabId) this.discard(key);
    }
    if (event.type === 'navigation:committed' && active(event.documentLifecycle)) {
      this.invalidate(context => context.tabId === event.tabId && (event.frameId === 0 || context.frameId === event.frameId));
      for (const [key, record] of this.documents) {
        if (record.context.tabId !== event.tabId) continue;
        if (event.frameId === 0 ? record.topDocumentId !== event.documentId : record.context.frameId === event.frameId && record.context.documentId !== event.documentId) this.discard(key);
      }
    }
  }

  afterEvent(event: DocumentEvent): void {
    if (event.type === 'ui:clear') { this.clearDocument(event.documentKey); return; }
    if (event.type === 'navigation:committed') {
      for (const operation of this.operations) if (this.runtime.state.metas.get(operation.context.documentKey)?.bound === false) operation.invalid = true;
      for (const key of this.documents.keys()) if (this.runtime.state.metas.get(key)?.bound === false) this.discard(key);
    }
    if (event.type === 'ui:pause' || event.type === 'transport:stopped') this.discard(event.documentKey);
    if (event.type === 'scope:revoked' || event.type === 'frames:retired' || event.type === 'document:evict') {
      for (const key of event.documentKeys) this.discard(key);
    }
    if (event.type === 'scope:access' && !event.accessGranted) this.discard(event.documentKey);
  }

  private async browserFrames(tabId: number): Promise<BrowserFrames | null> {
    let frames: FrameDetailsLike[] | null | undefined;
    try { frames = await this.runtime.api.webNavigation.getAllFrames({ tabId }); } catch { return null; }
    if (!Array.isArray(frames) || frames.length > 1024) return null;
    const top = frames.find(frame => frame.frameId === 0 && active(frame.documentLifecycle));
    if (!top || typeof top.documentId !== 'string' || top.errorOccurred) return null;
    return { top: top as BrowserFrames['top'], frames };
  }

  private frameOrigin(frame: FrameDetailsLike, frames: readonly FrameDetailsLike[]): FrameOrigin | null {
    let current: FrameDetailsLike | undefined = frame;
    for (let depth = 0; current && depth < 128; depth++) {
      const host = sanitizeHost(current.url);
      const scheme = current.url.startsWith('https://') ? 'https' : current.url.startsWith('http://') ? 'http' : null;
      if (host && scheme) return { host, scheme, pattern: scheme + '://' + host + '/*' };
      if (current.url !== 'about:blank' && current.url !== 'about:srcdoc') return null;
      const parentId: string | undefined = current.parentDocumentId;
      if (!parentId) return null;
      current = frames.find(candidate => candidate.documentId === parentId && active(candidate.documentLifecycle));
    }
    return null;
  }

  private permittedMeta(key: string): boolean {
    const meta = this.runtime.state.metas.get(key);
    return !meta || (meta.bound && !meta.paused && !meta.revoked);
  }

  private async authorize(context: PageSenderContext, operation?: Operation): Promise<BrowserFrames | null> {
    if (operation?.invalid || this.stopped || !this.permittedMeta(context.documentKey)) return null;
    const browser = await this.browserFrames(context.tabId);
    const frame = browser?.frames.find(candidate => candidate.frameId === context.frameId && candidate.documentId === context.documentId && active(candidate.documentLifecycle));
    const origin = browser && frame ? this.frameOrigin(frame, browser.frames) : null;
    if (!browser || !frame || frame.errorOccurred || !origin || (context.originPattern !== null && (origin.pattern !== context.originPattern || origin.host !== context.host))) return null;
    const granted = await this.runtime.scope.isGranted(origin.pattern, context.tabId, context.documentId);
    if (!granted || operation?.invalid || this.stopped || !this.permittedMeta(context.documentKey)) return null;
    const binding = [...this.runtime.state.bindings.values()].find(item => item.tabId === context.tabId && item.frameId === context.frameId && active(item.documentLifecycle));
    if (binding && binding.documentId !== context.documentId) return null;
    return browser;
  }

  private begin(context: Operation['context']): Operation | null {
    if (this.stopped || this.operations.size >= VISUAL_LIMITS.maxPending) return null;
    const operation = { context, invalid: false };
    this.operations.add(operation);
    return operation;
  }

  private admit(context: PageSenderContext, topDocumentId: string): DocumentImages {
    this.prune();
    const existing = this.documents.get(context.documentKey);
    if (existing) return existing;
    if (this.documents.size >= MAX_VISUAL_DOCUMENTS) {
      let oldestKey: string | undefined, oldestAt = Infinity;
      for (const [key, record] of this.documents) if (record.lastUsedAt < oldestAt) { oldestAt = record.lastUsedAt; oldestKey = key; }
      if (oldestKey !== undefined) this.discard(oldestKey);
    }
    const record: DocumentImages = { context, topDocumentId, cacheToken: token(), images: new Map(), truncated: false, needsRecovery: false,
      lastUsedAt: this.runtime.now(), lastTouchAt: this.runtime.now() };
    this.documents.set(context.documentKey, record);
    this.armExpiry();
    return record;
  }

  private touch(record: DocumentImages, notify: boolean): void {
    const now = this.runtime.now();
    record.lastUsedAt = now;
    if (now - record.lastTouchAt >= TOUCH_MS) {
      record.lastTouchAt = now;
      if (notify) this.send(record.context, { schemaVersion: 1, type: 'visual-cache-touch', cacheToken: record.cacheToken });
      void this.persist();
    }
    this.armExpiry();
  }

  private state(documentKey: string, enabled = true): VisualStateResponse {
    this.prune();
    const record = this.documents.get(documentKey);
    return { schemaVersion: 1, type: 'visual-state', documentKey, enabled, remainingMs: enabled ? VISUAL_LIMITS.leaseMs : 0,
      images: record ? [...record.images.values()].map(image => ({ ...image })) : [], ...(record?.truncated ? { truncated: true } : {}) };
  }

  private recover(record: DocumentImages): Promise<boolean> {
    const old = this.recoveries.get(record.context.documentKey);
    if (old) return old;
    const recovery = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const raw = await Promise.race([
          this.runtime.api.tabs.sendMessage(record.context.tabId,
            { schemaVersion: 1, type: 'visual-cache-read', cacheToken: record.cacheToken },
            { frameId: record.context.frameId, documentId: record.context.documentId }),
          new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), VISUAL_READ_TIMEOUT_MS); }),
        ]);
        if (this.documents.get(record.context.documentKey) !== record || this.stopped || this.runtime.now() - record.lastUsedAt >= VISUAL_IDLE_MS) return false;
        const checked = validateVisualCacheState(raw);
        if (!checked.ok || checked.value.cacheToken !== record.cacheToken) return false;
        const browser = await this.authorize(record.context);
        if (!browser || browser.top.documentId !== record.topDocumentId || this.documents.get(record.context.documentKey) !== record) return false;
        for (const image of checked.value.images) if (!retainVisualImage(record.images, image)) record.truncated = true;
        if (checked.value.truncated) record.truncated = true;
        record.needsRecovery = false;
        this.touch(record, false);
        return true;
      } catch { return false; }
      finally { if (timer !== undefined) clearTimeout(timer); }
    })();
    this.recoveries.set(record.context.documentKey, recovery);
    void recovery.finally(() => { if (this.recoveries.get(record.context.documentKey) === recovery) this.recoveries.delete(record.context.documentKey); });
    return recovery;
  }

  private async ui(request: VisualUiRequest): Promise<VisualResponse> {
    await this.runtime.whenReady();
    await this.start();
    const report = this.runtime.state.reports.get(request.documentKey);
    if (!report) return error('not-found');
    if (report.tabId !== request.tabId) return error('document-mismatch');
    if (request.type === 'ui-visual-set' && report.revision !== request.reportRevision) return error('stale-revision');
    if (request.type === 'ui-visual-set' && !request.enabled) { this.discard(request.documentKey); await this.flush(); return this.state(request.documentKey, false); }
    const context: PageSenderContext = { tabId: request.tabId, frameId: report.frameId, documentId: report.documentId,
      documentKey: request.documentKey, host: null, originPattern: null, documentLifecycle: 'active', frameType: null };
    const operation = this.begin(context);
    if (!operation) return error('no-access');
    try {
      const browser = await this.authorize(context, operation);
      if (!browser) return error('no-access');
      const binding = [...this.runtime.state.bindings.values()].find(item => item.tabId === request.tabId && item.frameId === report.frameId && active(item.documentLifecycle));
      if (!binding || binding.documentId !== report.documentId) return error('no-access');
      if (request.type === 'ui-visual-set' && this.runtime.state.reports.get(request.documentKey) !== report) return error('stale-revision');
      this.prune();
      const record = this.documents.get(request.documentKey);
      if (record) {
        if (record.topDocumentId !== browser.top.documentId) { this.discard(request.documentKey); await this.flush(); return error('no-access'); }
        if (record.needsRecovery && !(await this.recover(record))) return operation.invalid ? error('no-access') : this.state(request.documentKey);
        if (operation.invalid || this.documents.get(request.documentKey) !== record || !this.permittedMeta(request.documentKey)) return error('no-access');
        this.touch(record, true);
      } else if (request.type === 'ui-visual-set') this.send(context, control());
      return this.state(request.documentKey);
    } finally { this.operations.delete(operation); }
  }

  private async page(message: unknown, context: PageSenderContext): Promise<VisualResponse> {
    if (!this.runtime.scope.dataConsentLoaded) return error('no-access');
    if (!this.runtime.scope.hasDataConsent) return Object.getOwnPropertyDescriptor(message as object, 'type')?.value === 'visual-ready' ? disabled() : rejected();
    const request = validateVisualPageRequest(message);
    if (!request.ok) return error('invalid-request');
    const reject = () => request.value.type === 'visual-ready' ? disabled() : rejected();
    if (!active(context.documentLifecycle) || !context.originPattern || !this.permittedMeta(context.documentKey)) return reject();
    const operation = this.begin(context);
    if (!operation) return reject();
    try {
      if (!(await this.runtime.whenPageReady(context.documentKey))) return reject();
      await this.start();
      const browser = await this.authorize(context, operation);
      if (!browser) return reject();
      // Empty handshakes never allocate an owner or evict a useful image.
      if (request.value.type === 'visual-ready') return control();
      const record = this.admit(context, browser.top.documentId);
      const retained = request.value.type === 'visual-frame' && retainVisualImage(record.images, request.value.image);
      if (!retained) record.truncated = true;
      this.touch(record, false);
      try { await this.persist(); }
      catch { this.discard(context.documentKey); return rejected(); }
      if (operation.invalid || this.documents.get(context.documentKey) !== record || !this.permittedMeta(context.documentKey)) return rejected();
      return { schemaVersion: 1, type: 'visual-frame-ack', accepted: true, cacheToken: record.cacheToken, remainingMs: VISUAL_IDLE_MS,
        ...(!retained ? { retained: false } : {}), ...(record.truncated ? { truncated: true } : {}) };
    } finally { this.operations.delete(operation); }
  }

  route(message: unknown, sender: MessageSenderLike): Promise<VisualResponse> | null {
    const type = typeof message === 'object' && message !== null ? Object.getOwnPropertyDescriptor(message, 'type')?.value : undefined;
    if (type !== 'ui-visual-get' && type !== 'ui-visual-set' && type !== 'visual-ready' && type !== 'visual-frame' && type !== 'visual-limited') return null;
    if (verifyUiSender(sender, this.runtime.api.runtime.id)) {
      const checked = validateVisualUiRequest(message);
      return checked.ok ? this.ui(checked.value) : Promise.resolve(error('invalid-request'));
    }
    const read = readPageSender(sender, this.runtime.api.runtime.id);
    if (!read.ok || (type !== 'visual-ready' && type !== 'visual-frame' && type !== 'visual-limited')) return Promise.resolve(error('unauthorized-sender'));
    return this.page(message, read.context);
  }
}

export function createVisualPreviewHandler(runtime: BackgroundRuntime): VisualPreviewManager['route'] {
  return runtime.visual.route.bind(runtime.visual);
}
