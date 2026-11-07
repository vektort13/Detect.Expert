// Narrow, injectable view of the chrome.* surface used by the background package (spec A5, A10).
// The service-worker entrypoint passes the real `chrome`; unit tests pass test/fake-chrome.ts.
// Only Promise-returning forms are used. Observation reads no page content, headers or bodies; the opt-in module
// «Защита» (ADR-020, OFF by default) adds request bodies of armed tabs and, with GPC, request headers (net-hub.ts).

export interface EventLike<F extends (...args: never[]) => void> {
  addListener(callback: F): void;
  /** ADR-020 (S04): the module removes its own listeners; optional so a minimal fake can omit it. */
  removeListener?(callback: F): void;
}

/** Subset of chrome.runtime.MessageSender (Chrome 106+ carries documentId/documentLifecycle). */
export interface MessageSenderLike {
  id?: string | undefined;
  /**
   * `url`: the tab's last committed top-level URL (present with host access to that page). Read only by the module
   * «Защита» (ADR-020, readSenderTabTop in sender.ts: reduced to a host there); observation never reads it.
   */
  tab?: { id?: number | undefined; url?: string | undefined } | undefined;
  frameId?: number | undefined;
  url?: string | undefined;
  origin?: string | undefined;
  documentId?: string | undefined;
  documentLifecycle?: string | undefined;
}

export interface StorageAreaLike {
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
  /** ADR-020 (S04): the module's registrations exclude the user's excluded sites. */
  excludeMatches?: string[] | undefined;
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

/**
 * ADR-020 (S04): webRequest request body, delivered only to the module's per-tab listeners of armed tabs
 * (packages/background/src/protect/net-hub.ts). Lives in SW memory for the callback only; never stored or sent.
 */
export interface RequestBodyLike {
  error?: string | undefined;
  formData?: Readonly<Record<string, readonly unknown[]>> | undefined;
  raw?: ReadonlyArray<{ bytes?: ArrayBuffer | undefined; file?: string | undefined }> | undefined;
}

/**
 * webRequest details. Observation reads no headers and no bodies; the URL is reduced to a host inside the listener.
 * ADR-020 (S04): the module's listeners additionally see requestId, method, the body of armed tabs and, with the gpc
 * feature only, the request headers (Sec-GPC check); none of it is stored.
 */
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
  /** onCompleted only (catalog matching, S10): a match needs a received 2xx/304 response. Never stored. */
  statusCode?: number | undefined;
  /** ADR-020: Chrome's request id (SW memory only, outcome tracking). */
  requestId?: string | undefined;
  method?: string | undefined;
  requestBody?: RequestBodyLike | null | undefined;
  /** onErrorOccurred: the net error string (e.g. net::ERR_BLOCKED_BY_CLIENT). */
  error?: string | undefined;
  requestHeaders?: ReadonlyArray<{ name: string; value?: string | undefined }> | undefined;
}

export interface RequestFilterLike {
  urls: string[];
  types?: string[] | undefined;
  /** ADR-020 (S04): per-tab body listeners of the module. */
  tabId?: number | undefined;
}

/** A webRequest event the module adds and removes listeners on (extraInfoSpec as Chrome takes it). */
export interface WebRequestEventLike {
  addListener(callback: (details: RequestDetailsLike) => undefined, filter: RequestFilterLike, extraInfoSpec?: string[]): void;
  removeListener?(callback: (details: RequestDetailsLike) => undefined): void;
}

/** ADR-020 (S04): a declarativeNetRequest rule as read back (the module writes only dnr-guard-approved rules). */
export interface DnrRuleLike {
  id: number;
  priority?: number | undefined;
  action: object;
  condition: object;
}

/**
 * ADR-020 (S04): chrome.declarativeNetRequest subset. Present only after the optional
 * declarativeNetRequestWithHostAccess grant; packages/background/src/protect/dnr-port.ts reads it lazily on every call.
 */
export interface DnrLike {
  getDynamicRules(filter?: { ruleIds?: number[] | undefined }): Promise<DnrRuleLike[]>;
  getSessionRules(filter?: { ruleIds?: number[] | undefined }): Promise<DnrRuleLike[]>;
  updateDynamicRules(options: { removeRuleIds?: number[] | undefined; addRules?: DnrRuleLike[] | undefined }): Promise<void>;
  updateSessionRules(options: { removeRuleIds?: number[] | undefined; addRules?: DnrRuleLike[] | undefined }): Promise<void>;
  readonly MAX_NUMBER_OF_DYNAMIC_RULES?: number | undefined;
  readonly MAX_NUMBER_OF_SESSION_RULES?: number | undefined;
  /** Chrome's RuleConditionKeys enum (feature detection of topDomains); read defensively. */
  readonly RuleConditionKeys?: unknown;
}

/**
 * S12 / E13-03: chrome.action subset for the per-tab badge and tooltip (no permission needed). Promise forms only;
 * setBadgeTextColor is Chrome 110+ and feature-detected.
 */
export interface ActionLike {
  setBadgeText(details: { tabId?: number; text: string }): Promise<void>;
  setTitle(details: { tabId?: number; title: string }): Promise<void>;
  setBadgeBackgroundColor(details: { color: string; tabId?: number }): Promise<void>;
  setBadgeTextColor?(details: { color: string; tabId?: number }): Promise<void>;
}

/** S12: chrome.i18n.getMessage (available in the service worker) for the badge tooltip. */
export interface I18nLike {
  getMessage(messageName: string, substitutions?: string | string[]): string;
}

export interface BackgroundChromeApi {
  /** S12: optional so a minimal fake can omit it; absent means "no badge" (every badge call is a no-op). */
  action?: ActionLike | undefined;
  /** S12: optional; absent means the tooltip shows the message key. */
  i18n?: I18nLike | undefined;
  runtime: {
    id: string;
    /** chrome.runtime.Manifest (V2 | V3 union); only `host_permissions` is read, defensively. */
    getManifest(): object;
  };
  storage: {
    session: StorageAreaLike;
    local: StorageAreaLike;
    /**
     * ADR-019 (S11): read-only managed area (enterprise policy per apps/extension/managed_schema.json). Optional so a
     * minimal fake can omit it; absent means "no organization policy". Its onChanged is wired by the SW entry.
     */
    managed?: { get(keys: string | string[] | null): Promise<Record<string, unknown>> } | undefined;
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
  /**
   * ADR-020 (S04): present only after the optional declarativeNetRequestWithHostAccess grant (SP-1). Only
   * packages/background/src/protect/dnr-port.ts reads it (scripts/code-checks.mjs API ownership).
   */
  declarativeNetRequest?: DnrLike | undefined;
  webRequest: {
    /**
     * S07 / ADR-018: non-blocking observer of request attempts (hosts and browser-network counters). Non-blocking: the
     * callback returns undefined (no BlockingResponse, no 'blocking' extraInfoSpec). ADR-020: the module adds per-tab
     * body listeners of armed tabs here (extraInfoSpec only from net-hub.ts).
     */
    onBeforeRequest: WebRequestEventLike;
    /**
     * S10 / ADR-009 v1.1: non-blocking catalog matcher on received requests. Registered by the entry only when the
     * build's catalog has network rules or in the test profile. ADR-020: the module's outcome tracker listens too.
     */
    onCompleted: WebRequestEventLike;
    /** ADR-020 (S04): `sent` outcomes and the Sec-GPC check (headers only with the gpc feature). */
    onSendHeaders?: WebRequestEventLike | undefined;
    /** ADR-020 (S04): net::ERR_BLOCKED_BY_CLIENT and other errors of tracked requests. */
    onErrorOccurred?: WebRequestEventLike | undefined;
    /** chrome.webRequest.ResourceType enum: feature detection of optional types (webtransport). */
    ResourceType?: Readonly<Record<string, string>> | undefined;
  };
}

/** Injectable clock so tests control TTL/quarantine timing. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };
