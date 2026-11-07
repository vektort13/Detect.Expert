// Narrow, injectable view of the chrome.* surface used by the background package (spec A5, A10).
// The service-worker entrypoint passes the real `chrome`; unit tests pass test/fake-chrome.ts.
// Only Promise-returning forms are used. Nothing here reads page content, headers or bodies.

export interface EventLike<F extends (...args: never[]) => void> {
  addListener(callback: F): void;
}

/** Subset of chrome.runtime.MessageSender (Chrome 106+ carries documentId/documentLifecycle). */
export interface MessageSenderLike {
  id?: string | undefined;
  tab?: { id?: number | undefined } | undefined;
  frameId?: number | undefined;
  url?: string | undefined;
  origin?: string | undefined;
  documentId?: string | undefined;
  documentLifecycle?: string | undefined;
}

export interface StorageAreaLike {
  /** Keys-only enumeration; required before any session-only credential can coexist. */
  getKeys?(): Promise<string[]>;
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  clear(): Promise<void>;
  /** Present on Chrome storage areas; optional so a minimal fake can omit it. */
  getBytesInUse?(keys: string | string[] | null): Promise<number>;
  /** Chrome 102+. */
  setAccessLevel?(options: { accessLevel: 'TRUSTED_CONTEXTS' | 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }): Promise<void>;
}

export interface PermissionsLike {
  origins?: string[] | undefined;
  permissions?: string[] | undefined;
}

export interface RegisteredContentScriptLike {
  id: string;
  js?: string[] | undefined;
  matches?: string[] | undefined;
  allFrames?: boolean | undefined;
  runAt?: 'document_start' | 'document_end' | 'document_idle' | undefined;
  world?: 'ISOLATED' | 'MAIN' | undefined;
  /** Chrome 119+; feature-detected at registration time. */
  matchOriginAsFallback?: boolean | undefined;
  persistAcrossSessions?: boolean | undefined;
}

/** Optional members intentionally exclude `undefined` so this stays assignable to chrome.scripting.ScriptInjection. */
export interface ScriptInjectionLike {
  target: { tabId: number } & ({ allFrames?: boolean; documentIds?: never } | { documentIds: string[]; allFrames?: false });
  files: string[];
  world?: 'ISOLATED' | 'MAIN';
  injectImmediately?: boolean;
}

/** webNavigation details: only ids, lifecycle, frame type and the URL (sanitized to a host before use). */
export interface NavigationDetailsLike {
  tabId: number;
  frameId: number;
  url: string;
  timeStamp: number;
  documentId?: string | undefined;
  parentDocumentId?: string | undefined;
  parentFrameId?: number | undefined;
  frameType?: string | undefined;
  documentLifecycle?: string | undefined;
}

export interface FrameDetailsLike {
  frameId: number;
  url: string;
  documentId?: string | undefined;
  parentDocumentId?: string | undefined;
  parentFrameId?: number | undefined;
  frameType?: string | undefined;
  documentLifecycle?: string | undefined;
  errorOccurred?: boolean | undefined;
}

/** webRequest details: no headers, no bodies; the URL is reduced to a host inside the listener. */
export interface RequestDetailsLike {
  initiator?: string | undefined;
  tabId: number;
  frameId: number;
  url: string;
  type: string;
  timeStamp: number;
  documentId?: string | undefined;
  parentDocumentId?: string | undefined;
  parentFrameId?: number | undefined;
  documentLifecycle?: string | undefined;
}

export interface RequestFilterLike {
  urls: string[];
  types?: string[] | undefined;
}

export interface BackgroundChromeApi {
  runtime: {
    id: string;
    /** chrome.runtime.Manifest (V2 | V3 union); only `host_permissions` is read, defensively. */
    getManifest(): object;
  };
  storage: {
    session: StorageAreaLike;
    local: StorageAreaLike;
  };
  permissions: {
    contains(permissions: PermissionsLike): Promise<boolean>;
    getAll(): Promise<PermissionsLike>;
    onAdded: EventLike<(permissions: PermissionsLike) => void>;
    onRemoved: EventLike<(permissions: PermissionsLike) => void>;
  };
  scripting: {
    registerContentScripts(scripts: RegisteredContentScriptLike[]): Promise<void>;
    updateContentScripts(scripts: RegisteredContentScriptLike[]): Promise<void>;
    unregisterContentScripts(filter?: { ids?: string[] | undefined }): Promise<void>;
    getRegisteredContentScripts(filter?: { ids?: string[] | undefined }): Promise<RegisteredContentScriptLike[]>;
    executeScript(injection: ScriptInjectionLike): Promise<unknown>;
  };
  tabs: {
    query(queryInfo: Record<string, never>): Promise<Array<{ id?: number | undefined }>>;
    /** SW -> bridge control targeted at one document (ADR-004 changelog). Rejects when nothing listens. */
    sendMessage(tabId: number, message: unknown, options?: { frameId?: number; documentId?: string }): Promise<unknown>;
    onRemoved: EventLike<(tabId: number) => void>;
    onReplaced: EventLike<(addedTabId: number, removedTabId: number) => void>;
  };
  webNavigation: {
    getAllFrames(details: { tabId: number }): Promise<FrameDetailsLike[] | null | undefined>;
    onBeforeNavigate: EventLike<(details: NavigationDetailsLike) => void>;
    onCommitted: EventLike<(details: NavigationDetailsLike) => void>;
    onErrorOccurred: EventLike<(details: NavigationDetailsLike) => void>;
    onHistoryStateUpdated: EventLike<(details: NavigationDetailsLike) => void>;
    onReferenceFragmentUpdated: EventLike<(details: NavigationDetailsLike) => void>;
    onCompleted: EventLike<(details: NavigationDetailsLike) => void>;
  };
  webRequest: {
    onCompleted: {
      addListener(callback: (details: RequestDetailsLike) => void, filter: RequestFilterLike): void;
    };
  };
}

/** Injectable clock so tests control TTL/quarantine timing. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };
