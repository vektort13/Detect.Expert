import { DEFAULT_PROTECTION_SETTINGS, PROTECTION_SETTINGS_KEY, PROTECTION_PENDING_KEY, effectiveProtection, readProtectionObservations,
  readProtectionSettings, readProtectionUiRequest, sanitizeHost } from '@detect-expert/contracts';
import type { ProtectionResponse, ProtectionSettings, ProtectionState, ProtectionErrorCode } from '@detect-expert/contracts';
import type { BackgroundChromeApi, MessageSenderLike } from './chrome-api';
import type { ScopeController } from './scope';
import { buildProtectionScripts, PROTECTION_SCRIPT_IDS } from './protection-plan';
import { verifyUiSender } from './sender';

function failure(code: ProtectionErrorCode): ProtectionResponse { return { schemaVersion: 1, type: 'protection-error', code }; }

async function bounded<T>(operation: Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation.catch(() => fallback), new Promise<T>(resolve => { timer = setTimeout(() => resolve(fallback), 1000); })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

export class ProtectionController {
  private settings: ProtectionSettings = DEFAULT_PROTECTION_SETTINGS;
  private registration: ProtectionState['registration'] = 'inactive';
  private cleanupIncomplete = false;
  private chain: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private startup: Promise<void> | null = null;
  private accessUnavailable = false;

  constructor(private readonly api: BackgroundChromeApi, private readonly scope: ScopeController) {}

  start(): Promise<void> {
    this.startup ??= this.serialize(async () => {
      let valid = true;
      let interrupted = false;
      try {
        const stored = await this.api.storage.local.get([PROTECTION_SETTINGS_KEY, PROTECTION_PENDING_KEY]);
        const saved = stored[PROTECTION_SETTINGS_KEY];
        interrupted = stored[PROTECTION_PENDING_KEY] === true;
        const parsed = saved === undefined ? DEFAULT_PROTECTION_SETTINGS : readProtectionSettings(saved);
        valid = parsed !== null;
        this.settings = parsed ?? DEFAULT_PROTECTION_SETTINGS;
      } catch { valid = false; }
      await this.reconcile();
      if (!valid || interrupted || this.registration !== 'ready') await this.stopOpenDocuments();
      if (!valid) this.registration = 'error';
      if (interrupted && this.registration !== 'error') await this.finishApplication();
    });
    return this.startup;
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.chain.then(operation, operation);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async reconcile(): Promise<void> {
    const desired = buildProtectionScripts(this.settings, this.accessUnavailable || !this.scope.accessReady ? [] : this.scope.desiredMatches());
    try {
      const existing = await this.api.scripting.getRegisteredContentScripts({ ids: PROTECTION_SCRIPT_IDS });
      const remove = existing.filter(script => !desired.some(next => next.id === script.id)).map(script => script.id);
      if (remove.length > 0) await this.api.scripting.unregisterContentScripts({ ids: remove });
      const update = desired.filter(script => existing.some(previous => previous.id === script.id));
      const add = desired.filter(script => !existing.some(previous => previous.id === script.id));
      if (update.length > 0) await this.api.scripting.updateContentScripts(update);
      if (add.length > 0) await this.api.scripting.registerContentScripts(add);
      const actual = await this.api.scripting.getRegisteredContentScripts({ ids: PROTECTION_SCRIPT_IDS });
      const list = (items: readonly string[] | undefined): string => [...(items ?? [])].sort().join('\n');
      if (actual.length !== desired.length || desired.some(script => !actual.some(registered => registered.id === script.id &&
        list(registered.matches) === list(script.matches) && list(registered.excludeMatches) === list(script.excludeMatches) &&
        list(registered.js) === list(script.js) && registered.world === 'MAIN' && registered.runAt === 'document_start' &&
        registered.allFrames === true && registered.persistAcrossSessions === true && registered.matchOriginAsFallback !== true))) throw new Error('registration-mismatch');
      this.registration = desired.length > 0 ? 'ready' : 'inactive';
    } catch {
      this.registration = 'error';
      try {
        const existing = await this.api.scripting.getRegisteredContentScripts({ ids: PROTECTION_SCRIPT_IDS });
        if (existing.length > 0) await this.api.scripting.unregisterContentScripts({ ids: existing.map(script => script.id) });
      } catch { this.cleanupIncomplete = true; }
    }
  }

  private async stopOpenDocuments(): Promise<void> {
    try {
      const tabs = await this.api.tabs.query({});
      if (tabs.length > 128) this.cleanupIncomplete = true;
      await Promise.all(tabs.slice(0, 128).map(async tab => {
        if (tab.id === undefined) return;
        await bounded(this.api.tabs.sendMessage(tab.id, { schemaVersion: 1, type: 'protection-stop' }), undefined);
      }));
    } catch { this.cleanupIncomplete = true; }
  }

  private async finishApplication(): Promise<void> {
    try { await this.api.storage.local.set({ [PROTECTION_PENDING_KEY]: false }); }
    catch { this.registration = 'error'; }
  }

  suspendAccess(): Promise<void> {
    this.accessUnavailable = true;
    return this.serialize(async () => {
      await this.reconcile();
      await this.stopOpenDocuments();
      this.registration = 'error';
    });
  }

  async accessChanged(): Promise<void> {
    await this.start();
    await this.serialize(async () => {
      const active = this.settings.enabled || this.registration !== 'inactive';
      this.accessUnavailable = false;
      await this.reconcile();
      if (active) await this.stopOpenDocuments();
    });
  }

  async get(tabId: number | null): Promise<ProtectionState> {
    await this.start();
    await this.chain;
    const state: ProtectionState = { schemaVersion: 1, type: 'protection-state', settings: readProtectionSettings(this.settings)!,
      registration: this.registration, cleanupIncomplete: this.cleanupIncomplete, tabId, host: null, documentId: null,
      configured: [], observations: [], liveRead: 'unavailable', integrity: 'page-controlled' };
    if (tabId === null) return state;
    try {
      const frame = (await this.api.webNavigation.getAllFrames({ tabId }))?.find(entry => entry.frameId === 0);
      if (!frame || !frame.documentId) return state;
      const host = sanitizeHost(frame.url);
      if (host === null || (!frame.url.startsWith('https://') && !frame.url.startsWith('http://'))) return state;
      state.host = host;
      state.documentId = frame.documentId;
      const scheme = frame.url.startsWith('https://') ? 'https' : 'http';
      const accessGeneration = this.scope.accessGeneration;
      if (this.accessUnavailable || !this.scope.accessReady || !(await this.scope.isGranted(scheme + '://' + host + '/*', tabId, frame.documentId))) return state;
      if (!this.scope.accessReady || accessGeneration !== this.scope.accessGeneration || this.accessUnavailable) return state;
      state.configured = effectiveProtection(this.settings, host);
      const response: unknown = await bounded(this.api.tabs.sendMessage(tabId, { schemaVersion: 1, type: 'protection-query' },
        { frameId: 0, documentId: frame.documentId }), undefined);
      const observations = readProtectionObservations(response);
      const current = (await this.api.webNavigation.getAllFrames({ tabId }))?.find(entry => entry.frameId === 0);
      if (current?.documentId !== frame.documentId || !this.scope.accessReady || this.accessUnavailable || accessGeneration !== this.scope.accessGeneration) {
        state.host = null; state.documentId = null; state.configured = []; return state;
      }
      if (observations !== null) { state.observations = observations; state.liveRead = 'received'; }
    } catch { /* Absence is not evidence of successful protection. */ }
    return state;
  }

  async set(settings: ProtectionSettings, tabId: number | null): Promise<ProtectionResponse> {
    await this.start();
    const result = await this.serialize(async (): Promise<ProtectionResponse | null> => {
      const parsed = readProtectionSettings(settings);
      if (!parsed) return failure('invalid-request');
      if (parsed.revision !== this.settings.revision || parsed.revision >= Number.MAX_SAFE_INTEGER) return failure('stale-revision');
      const next = { ...parsed, revision: parsed.revision + 1 };
      try { await this.api.storage.local.set({ [PROTECTION_SETTINGS_KEY]: next, [PROTECTION_PENDING_KEY]: true }); }
      catch { return failure('storage-error'); }
      const wasEnabled = this.settings.enabled;
      this.settings = next;
      this.cleanupIncomplete = false;
      await this.reconcile();
      if (wasEnabled || next.enabled) await this.stopOpenDocuments();
      if (this.registration !== 'error') await this.finishApplication();
      return null;
    });
    return result ?? this.get(tabId);
  }

  route(message: unknown, sender: MessageSenderLike, whenReady: () => Promise<void>): Promise<ProtectionResponse> | null {
    if (typeof message !== 'object' || message === null) return null;
    const type = Object.getOwnPropertyDescriptor(message, 'type')?.value as unknown;
    if (typeof type !== 'string' || !type.startsWith('ui-protection-')) return null;
    if (!verifyUiSender(sender, this.api.runtime.id)) return Promise.resolve(failure('unauthorized-sender'));
    const request = readProtectionUiRequest(message);
    if (!request) return Promise.resolve(failure('invalid-request'));
    if (this.pending >= 4) return Promise.resolve(failure('busy'));
    this.pending++;
    return (async (): Promise<ProtectionResponse> => {
      await whenReady();
      if (request.type === 'ui-protection-get') return this.get(request.tabId);
      if (request.type === 'ui-protection-set') return this.set(request.settings, request.tabId);
      await this.start();
      await this.chain;
      const frame = (await this.api.webNavigation.getAllFrames({ tabId: request.tabId }))?.find(entry => entry.frameId === 0);
      if (frame?.documentId !== request.documentId) return failure('stale-document');
      if (!frame.url.startsWith('https://') && !frame.url.startsWith('http://')) return failure('no-access');
      if (this.registration === 'error' || !this.api.tabs.reload) return failure('no-access');
      await this.api.tabs.reload(request.tabId);
      return this.get(request.tabId);
    })().catch(() => failure('no-access')).finally(() => { this.pending--; });
  }
}