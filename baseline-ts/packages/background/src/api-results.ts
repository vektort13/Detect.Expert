import { readApiResultsCache, readApiResultsUiRequest, sanitizeHost } from '@detect-expert/contracts';
import type { ApiResultsState, ApiResultsUiRequest, UiResponse } from '@detect-expert/contracts';
import type { BackgroundRuntime } from './runtime';
import type { MessageSenderLike } from './chrome-api';
import type { DocumentEvent, FrameBinding } from './documents';
import { verifyUiSender } from './sender';

type Operation = { documentKey: string; tabId: number; invalid: boolean };
const active = (lifecycle: string | null | undefined): boolean => lifecycle === undefined || lifecycle === null || lifecycle === 'active';
const unavailable = (documentKey: string): ApiResultsState => ({ schemaVersion: 1, type: 'api-results-state', documentKey,
  available: false, integrity: 'page-controlled', rows: [], truncated: true });

export class ApiResultsManager {
  private readonly operations = new Set<Operation>();
  private readonly resets = new Map<string, Promise<boolean>>();

  constructor(private readonly runtime: BackgroundRuntime) {}

  // ADR-072: Pro retains its invalidation token across both authorization awaits.
  trackOperation(operation: Operation): boolean {
    if (this.operations.has(operation)) return !operation.invalid;
    if (this.operations.size >= 8 || operation.invalid) return false;
    this.operations.add(operation);
    return true;
  }

  releaseOperation(operation: Operation): void { this.operations.delete(operation); }

  private binding(documentKey: string): FrameBinding | undefined {
    return [...this.runtime.state.bindings.values()].find(binding => binding.documentKey === documentKey && active(binding.documentLifecycle));
  }

  invalidate(documentKey?: string): void {
    for (const operation of this.operations) if (documentKey === undefined || operation.documentKey === documentKey) operation.invalid = true;
  }

  afterEvent(event: DocumentEvent): void {
    if (event.type === 'ui:pause' || event.type === 'ui:clear' || event.type === 'transport:stopped') this.invalidate(event.documentKey);
    if (event.type === 'scope:access' && !event.accessGranted) this.invalidate(event.documentKey);
    if (event.type === 'scope:revoked' || event.type === 'frames:retired' || event.type === 'document:evict') {
      for (const key of event.documentKeys) this.invalidate(key);
    }
    if (event.type === 'navigation:committed' || event.type === 'tab:removed' || event.type === 'tab:replaced') {
      const tabId = event.type === 'tab:replaced' ? event.removedTabId : event.tabId;
      for (const operation of this.operations) if (operation.tabId === tabId) operation.invalid = true;
    }
  }

  async reset(documentKey: string): Promise<boolean> {
    const binding = this.binding(documentKey);
    if (!binding || this.resets.has(documentKey)) return false;
    let native = this.resets.get(documentKey);
    if (!native) {
      if (this.resets.size >= 4) return false;
      native = (async () => {
        try {
          const response: unknown = await this.runtime.api.tabs.sendMessage(binding.tabId, { schemaVersion: 1, type: 'api-results-reset' },
            { frameId: binding.frameId, documentId: binding.documentId });
          if (typeof response !== 'object' || response === null) return false;
          const fields = response as { schemaVersion?: unknown; type?: unknown; epoch?: unknown };
          return fields.schemaVersion === 1 && fields.type === 'api-results-reset-ack' && typeof fields.epoch === 'number' &&
            Number.isInteger(fields.epoch) && fields.epoch >= 0 && fields.epoch < 2147483647;
        } catch { return false; }
      })();
      this.resets.set(documentKey, native);
      void native.finally(() => { this.resets.delete(documentKey); });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([native, new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 1000); })]); }
    finally { if (timer !== undefined) clearTimeout(timer); }
  }

  async prepareClear(documentKey: string, markerPersisted = false): Promise<{ ready: boolean; reset: boolean }> {
    this.invalidate(documentKey);
    this.runtime.markApiResultsReset([documentKey], true);
    const reset = await this.reset(documentKey);
    const ready = reset || markerPersisted || await this.runtime.persistApiResultsReset();
    return { ready, reset };
  }

  private async authorize(request: ApiResultsUiRequest, operation: Operation): Promise<boolean> {
    if (operation.invalid || !this.runtime.scope.accessReady) return false;
    const projection = this.runtime.getProjection(request.tabId, request.frameId);
    if (projection?.documentKey !== request.documentKey || projection.coverageState === 'paused' || projection.coverageState === 'no-access') return false;
    const binding = this.binding(request.documentKey);
    const meta = this.runtime.state.metas.get(request.documentKey);
    if (!binding || binding.tabId !== request.tabId || binding.frameId !== request.frameId || binding.accessGranted === false || binding.originPending ||
      meta?.paused || meta?.revoked || meta?.accessGranted === false) return false;
    const frames = await this.runtime.api.webNavigation.getAllFrames({ tabId: request.tabId });
    if (!Array.isArray(frames) || frames.length > 1024) return false;
    const frame = frames.find(frame => frame.frameId === request.frameId && frame.documentId === binding.documentId && active(frame.documentLifecycle));
    if (!frame || frame.errorOccurred) return false;
    let current = frame;
    let host: string | null = null;
    let scheme: 'http' | 'https' | null = null;
    for (let depth = 0; depth < 128; depth++) {
      host = sanitizeHost(current.url);
      scheme = current.url.startsWith('https://') ? 'https' : current.url.startsWith('http://') ? 'http' : null;
      if (host !== null && scheme !== null) break;
      if (current.url !== 'about:blank' && current.url !== 'about:srcdoc') return false;
      const parent = frames.find(candidate => candidate.documentId === current.parentDocumentId && active(candidate.documentLifecycle));
      if (!parent) return false;
      current = parent;
    }
    if (host === null || scheme === null || operation.invalid) return false;
    const generation = this.runtime.scope.accessGeneration;
    const granted = await this.runtime.scope.isGranted(scheme + '://' + host + '/*', request.tabId, binding.documentId);
    const live = this.binding(request.documentKey), currentMeta = this.runtime.state.metas.get(request.documentKey);
    const currentProjection = this.runtime.getProjection(request.tabId, request.frameId);
    return granted &&
      !operation.invalid && generation === this.runtime.scope.accessGeneration && this.runtime.scope.accessReady &&
      live?.documentId === binding.documentId && live.accessGranted !== false && !live.originPending &&
      !currentMeta?.paused && !currentMeta?.revoked && currentMeta?.accessGranted !== false &&
      currentProjection?.documentKey === request.documentKey && currentProjection.coverageState !== 'paused' && currentProjection.coverageState !== 'no-access';
  }

  private async read(request: ApiResultsUiRequest, operation: Operation): Promise<ApiResultsState> {
    await this.runtime.whenReady();
    if (!await this.authorize(request, operation)) return unavailable(request.documentKey);
    if (this.binding(request.documentKey)?.apiResultsResetRequired) {
      if (!await this.reset(request.documentKey) || operation.invalid || !await this.authorize(request, operation)) return unavailable(request.documentKey);
      this.runtime.markApiResultsReset([request.documentKey], false);
      if (!await this.runtime.persistApiResultsReset()) return unavailable(request.documentKey);
    }
    const binding = this.binding(request.documentKey);
    if (!binding || operation.invalid) return unavailable(request.documentKey);
    const generation = this.runtime.scope.accessGeneration;
    const response: unknown = await this.runtime.api.tabs.sendMessage(request.tabId, { schemaVersion: 1, type: 'api-results-query' },
      { frameId: request.frameId, documentId: binding.documentId });
    const cache = readApiResultsCache(response);
    if (!cache || operation.invalid || generation !== this.runtime.scope.accessGeneration || this.binding(request.documentKey)?.apiResultsResetRequired ||
      !await this.authorize(request, operation)) return unavailable(request.documentKey);
    return { schemaVersion: 1, type: 'api-results-state', documentKey: request.documentKey, integrity: 'page-controlled',
      available: cache.available, rows: cache.rows, truncated: cache.truncated };
  }

  route(message: unknown, sender: MessageSenderLike): Promise<ApiResultsState | UiResponse> | null {
    if (typeof message !== 'object' || message === null || Object.getOwnPropertyDescriptor(message, 'type')?.value !== 'ui-api-results') return null;
    if (!verifyUiSender(sender, this.runtime.api.runtime.id)) return Promise.resolve({ schemaVersion: 1, type: 'error', code: 'unauthorized-sender' });
    const request = readApiResultsUiRequest(message);
    if (!request) return Promise.resolve({ schemaVersion: 1, type: 'error', code: 'invalid-request' });
    if (this.operations.size >= 4) return Promise.resolve(unavailable(request.documentKey));
    const operation = { documentKey: request.documentKey, tabId: request.tabId, invalid: false };
    this.operations.add(operation);
    const work = this.read(request, operation).catch(() => unavailable(request.documentKey)).finally(() => this.operations.delete(operation));
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([work, new Promise<ApiResultsState>(resolve => {
      timer = setTimeout(() => { operation.invalid = true; resolve(unavailable(request.documentKey)); }, 2000);
    })]).finally(() => { if (timer !== undefined) clearTimeout(timer); });
  }
}
