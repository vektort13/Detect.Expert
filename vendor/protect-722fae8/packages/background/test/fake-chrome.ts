// Fake chrome.* surface for unit tests: in-memory storage areas with fault injection and quota,
// recordable events, permission grants and scripting registrations. Test-only; never bundled.

import { readFileSync } from 'node:fs';
import type {
  ActionLike,
  BackgroundChromeApi,
  DnrLike,
  DnrRuleLike,
  I18nLike,
  FrameDetailsLike,
  MessageSenderLike,
  NavigationDetailsLike,
  PermissionsLike,
  RegisteredContentScriptLike,
  RequestDetailsLike,
  RequestFilterLike,
  ScriptInjectionLike,
  StorageAreaLike,
} from '../src/index';
import { patternCoversHost } from '../src/index';

export const RUNTIME_ID = 'abcdefghijklmnopabcdefghijklmnop';

type LocaleTable = Record<string, { message: string; placeholders?: Record<string, { content: string }> }>;

/** S12: chrome.i18n.getMessage over the shipped locale (placeholders by position, like Chrome). Unknown key -> ''. */
export function createFakeI18n(locale: 'en' | 'ru' = 'en'): I18nLike & { calls: Array<{ key: string; subs: string[] }> } {
  const table = JSON.parse(readFileSync(new URL('../../../apps/extension/_locales/' + locale + '/messages.json', import.meta.url), 'utf8')) as LocaleTable;
  const calls: Array<{ key: string; subs: string[] }> = [];
  return {
    calls,
    getMessage(key: string, substitutions?: string | string[]) {
      const subs = substitutions === undefined ? [] : Array.isArray(substitutions) ? substitutions : [substitutions];
      calls.push({ key, subs: [...subs] });
      const entry = table[key];
      if (entry === undefined) return '';
      return entry.message.replace(/\$([A-Za-z_]+)\$/g, (_, name: string) => {
        const index = Number(entry.placeholders?.[name.toLowerCase()]?.content.slice(1)) - 1;
        return subs[index] ?? '';
      });
    },
  };
}

/** S12: chrome.action with per-tab badge state, call log and fault injection. */
export class FakeAction implements ActionLike {
  readonly text = new Map<number, string>();
  readonly title = new Map<number, string>();
  readonly calls: Array<{ method: string; details: Record<string, unknown> }> = [];
  backgroundColor: string | null = null;
  textColor: string | null = null;
  /** The next N setBadgeText/setTitle calls reject (closed tab). */
  failNext = 0;
  setBadgeTextColor?: (details: { color: string; tabId?: number }) => Promise<void>;

  constructor(withTextColor = true) {
    if (withTextColor) {
      this.setBadgeTextColor = async (details) => {
        this.calls.push({ method: 'setBadgeTextColor', details: { ...details } });
        this.textColor = details.color;
      };
    }
  }

  private fail(): boolean {
    if (this.failNext <= 0) return false;
    this.failNext--;
    return true;
  }

  async setBadgeText(details: { tabId?: number; text: string }): Promise<void> {
    this.calls.push({ method: 'setBadgeText', details: { ...details } });
    if (this.fail()) throw new Error('No tab with id: ' + String(details.tabId));
    this.text.set(details.tabId ?? -1, details.text);
  }

  async setTitle(details: { tabId?: number; title: string }): Promise<void> {
    this.calls.push({ method: 'setTitle', details: { ...details } });
    if (this.fail()) throw new Error('No tab with id: ' + String(details.tabId));
    this.title.set(details.tabId ?? -1, details.title);
  }

  async setBadgeBackgroundColor(details: { color: string; tabId?: number }): Promise<void> {
    this.calls.push({ method: 'setBadgeBackgroundColor', details: { ...details } });
    this.backgroundColor = details.color;
  }

  count(method: string): number {
    return this.calls.filter((c) => c.method === method).length;
  }
}

export class FakeEvent<F extends (...args: never[]) => void> {
  readonly listeners: F[] = [];
  addListener(callback: F): void {
    this.listeners.push(callback);
  }
  removeListener(callback: F): void {
    const i = this.listeners.indexOf(callback);
    if (i >= 0) this.listeners.splice(i, 1);
  }
  emit(...args: Parameters<F>): void {
    for (const l of [...this.listeners]) (l as (...a: Parameters<F>) => void)(...args);
  }
}

/** ADR-020 (S04): one registered webRequest listener with its filter and extraInfoSpec (as Chrome stores them). */
export interface FakeWebRequestListener {
  cb: (d: RequestDetailsLike) => void;
  filter: RequestFilterLike;
  extra: string[] | undefined;
}

/** Like Chrome: a filter scheme/type/tab mismatch means the listener is not called. */
export function webRequestFilterMatches(filter: RequestFilterLike, d: RequestDetailsLike): boolean {
  const scheme = d.url.slice(0, Math.max(0, d.url.indexOf('://')));
  const urlOk = filter.urls.some((u) => u === '<all_urls>' || u.startsWith(scheme + '://') || u.startsWith('*://'));
  return urlOk && (filter.types === undefined || filter.types.includes(d.type)) && (filter.tabId === undefined || filter.tabId === d.tabId);
}

/** webRequest event fake: emit() honours the filter's urls scheme, types and tabId like Chrome; additions are logged. */
export class FakeWebRequestEvent {
  readonly listeners: FakeWebRequestListener[] = [];
  readonly added: FakeWebRequestListener[] = [];
  removed = 0;
  constructor(private readonly knownTypes: string[] | undefined) {}
  addListener(cb: (d: RequestDetailsLike) => undefined, filter: RequestFilterLike, extra?: string[]): void {
    // Chrome rejects an unknown resource type synchronously.
    if (this.knownTypes !== undefined) for (const t of filter.types ?? []) if (!this.knownTypes.includes(t)) throw new Error('Invalid value for argument 2. Property "types": unknown type ' + t);
    const entry: FakeWebRequestListener = { cb, filter, extra: extra === undefined ? undefined : [...extra] };
    this.listeners.push(entry);
    this.added.push(entry);
  }
  removeListener(cb: (d: RequestDetailsLike) => undefined): void {
    for (let i = this.listeners.length - 1; i >= 0; i--) {
      if (this.listeners[i]!.cb === cb) {
        this.listeners.splice(i, 1);
        this.removed++;
      }
    }
  }
  emit(d: RequestDetailsLike): void {
    for (const l of [...this.listeners]) if (webRequestFilterMatches(l.filter, d)) l.cb(d);
  }
}

/** ADR-020 (S04): chrome.declarativeNetRequest fake (rules by id, call log, hang / failure injection). */
export class FakeDnr implements DnrLike {
  readonly dynamic = new Map<number, DnrRuleLike>();
  readonly session = new Map<number, DnrRuleLike>();
  readonly calls: Array<{ method: string; removeRuleIds?: number[]; addRuleIds?: number[] }> = [];
  /** Writes never settle (SP-1: after a runtime grant until the extension reloads). */
  hangWrites = false;
  /** Every call rejects (SP-5: the namespace stays after permissions.remove, calls throw). */
  unavailable = false;
  failNextWrite: Error | null = null;
  readonly MAX_NUMBER_OF_DYNAMIC_RULES = 30000;
  readonly MAX_NUMBER_OF_SESSION_RULES = 5000;
  readonly RuleConditionKeys: unknown = Object.freeze({ REQUEST_DOMAINS: 'requestDomains', TOP_DOMAINS: 'topDomains', EXCLUDED_TOP_DOMAINS: 'excludedTopDomains' });

  private check(method: string): void {
    if (this.unavailable) throw new Error('declarativeNetRequest.' + method + ' is not available in this context.');
  }

  async getDynamicRules(): Promise<DnrRuleLike[]> {
    this.calls.push({ method: 'getDynamicRules' });
    this.check('getDynamicRules');
    return [...this.dynamic.values()].map((r) => structuredClone(r));
  }

  async getSessionRules(): Promise<DnrRuleLike[]> {
    this.calls.push({ method: 'getSessionRules' });
    this.check('getSessionRules');
    return [...this.session.values()].map((r) => structuredClone(r));
  }

  private update(target: Map<number, DnrRuleLike>, method: string, options: { removeRuleIds?: number[]; addRules?: DnrRuleLike[] }): Promise<void> {
    this.calls.push({ method, ...(options.removeRuleIds === undefined ? {} : { removeRuleIds: [...options.removeRuleIds] }), ...(options.addRules === undefined ? {} : { addRuleIds: options.addRules.map((r) => r.id) }) });
    try {
      this.check(method);
    } catch (e) {
      return Promise.reject(e);
    }
    if (this.hangWrites) return new Promise<void>(() => undefined);
    if (this.failNextWrite !== null) {
      const e = this.failNextWrite;
      this.failNextWrite = null;
      return Promise.reject(e);
    }
    for (const id of options.removeRuleIds ?? []) target.delete(id);
    for (const r of options.addRules ?? []) {
      if (target.has(r.id)) return Promise.reject(new Error('Rule with id ' + String(r.id) + ' does not have a unique ID.'));
      target.set(r.id, structuredClone(r));
    }
    return Promise.resolve();
  }

  updateDynamicRules(options: { removeRuleIds?: number[]; addRules?: DnrRuleLike[] }): Promise<void> {
    return this.update(this.dynamic, 'updateDynamicRules', options);
  }

  updateSessionRules(options: { removeRuleIds?: number[]; addRules?: DnrRuleLike[] }): Promise<void> {
    return this.update(this.session, 'updateSessionRules', options);
  }
}

function bytesOf(value: unknown): number {
  return JSON.stringify(value).length;
}

export class FakeStorageArea implements StorageAreaLike {
  readonly data = new Map<string, unknown>();
  readonly setCalls: Array<Record<string, unknown>> = [];
  readonly removeCalls: string[][] = [];
  /** Fault injection: the next N set() calls reject with `failWith`. */
  failNextSets = 0;
  failWith: Error = new Error('Quota bytes exceeded (QUOTA_BYTES)');
  /** Hard quota simulation; null disables. */
  quotaBytes: number | null = null;
  /** When set, getBytesInUse(null) reports this instead of the computed size. */
  bytesInUseOverride: number | null = null;
  accessLevel: string | null = null;
  hasGetBytesInUse = true;

  async get(keys: string | string[] | null): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    const wanted = keys === null ? [...this.data.keys()] : Array.isArray(keys) ? keys : [keys];
    for (const k of wanted) if (this.data.has(k)) out[k] = JSON.parse(JSON.stringify(this.data.get(k))) as unknown;
    return out;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    if (this.failNextSets > 0) {
      this.failNextSets--;
      throw this.failWith;
    }
    const clone = JSON.parse(JSON.stringify(items)) as Record<string, unknown>;
    if (this.quotaBytes !== null) {
      let total = 0;
      for (const [k, v] of this.data) if (!(k in clone)) total += k.length + bytesOf(v);
      for (const k of Object.keys(clone)) total += k.length + bytesOf(clone[k]);
      if (total > this.quotaBytes) throw new Error('Quota bytes exceeded (QUOTA_BYTES)');
    }
    for (const k of Object.keys(clone)) this.data.set(k, clone[k]);
    this.setCalls.push(clone);
  }

  async remove(keys: string | string[]): Promise<void> {
    const list = Array.isArray(keys) ? keys : [keys];
    this.removeCalls.push(list);
    for (const k of list) this.data.delete(k);
  }

  async clear(): Promise<void> {
    this.data.clear();
  }

  async getBytesInUse(keys: string | string[] | null): Promise<number> {
    if (this.bytesInUseOverride !== null && keys === null) return this.bytesInUseOverride;
    let total = 0;
    const wanted = keys === null ? [...this.data.keys()] : Array.isArray(keys) ? keys : [keys];
    for (const k of wanted) if (this.data.has(k)) total += k.length + bytesOf(this.data.get(k));
    return total;
  }

  async setAccessLevel(options: { accessLevel: 'TRUSTED_CONTEXTS' | 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }): Promise<void> {
    this.accessLevel = options.accessLevel;
  }
}

export interface FakeChromeOptions {
  runtimeId?: string;
  /** Static manifest host_permissions (test profile). */
  hostPermissions?: string[];
  /** Origin patterns the browser reports as granted. */
  grantedOrigins?: string[];
  /** chrome.webRequest.ResourceType values this fake browser knows (S07 feature detection); default: none exposed. */
  resourceTypes?: string[];
  /** S11 / ADR-019: initial managed (enterprise policy) items; default {} (no policy). */
  managed?: Record<string, unknown>;
  /** S12: expose chrome.action (and chrome.i18n over the shipped locale); default: absent (badge is a no-op). */
  action?: boolean | { textColor?: boolean; locale?: 'en' | 'ru' };
  /** ADR-020 (S04): API permissions granted at start (declarativeNetRequestWithHostAccess exposes the DNR namespace). */
  permissions?: string[];
}

export interface FakeChrome extends BackgroundChromeApi {
  session: FakeStorageArea;
  local: FakeStorageArea;
  /** S11: chrome.storage.managed (read-only for the extension; tests write `managed.data`). */
  managed: FakeStorageArea;
  /** S11: the next managed.get() calls reject (unreadable policy). */
  failManagedGets: number;
  grantedOrigins: Set<string>;
  registered: Map<string, RegisteredContentScriptLike>;
  executeScriptCalls: ScriptInjectionLike[];
  /** tabs.sendMessage calls (SW -> bridge control). */
  sentToTabs: Array<{ tabId: number; message: unknown; options: { frameId?: number; documentId?: string } | undefined }>;
  failExecuteScript: boolean;
  rejectMatchOriginAsFallback: boolean;
  tabList: Array<{ id?: number | undefined }>;
  framesByTab: Map<number, FrameDetailsLike[]>;
  events: {
    onAdded: FakeEvent<(p: PermissionsLike) => void>;
    onRemoved: FakeEvent<(p: PermissionsLike) => void>;
    tabRemoved: FakeEvent<(tabId: number) => void>;
    tabReplaced: FakeEvent<(added: number, removed: number) => void>;
    onBeforeNavigate: FakeEvent<(d: NavigationDetailsLike) => void>;
    onCommitted: FakeEvent<(d: NavigationDetailsLike) => void>;
    onErrorOccurred: FakeEvent<(d: NavigationDetailsLike) => void>;
    onHistoryStateUpdated: FakeEvent<(d: NavigationDetailsLike) => void>;
    onReferenceFragmentUpdated: FakeEvent<(d: NavigationDetailsLike) => void>;
    onCompleted: FakeEvent<(d: NavigationDetailsLike) => void>;
    /** S10: webRequest.onCompleted (catalog matcher); emit() honours the registered filter like onBeforeRequest. */
    webRequestCompleted: FakeWebRequestEvent;
    /** S07: webRequest.onBeforeRequest; emit() honours the registered filter's urls scheme, types and tabId like Chrome. */
    webRequestBefore: FakeWebRequestEvent;
  };
  /** S12: chrome.action fake, present only with options.action. */
  badgeAction?: FakeAction;
  /** ADR-020 (S04): granted API permissions (optional_permissions). */
  grantedPermissions: Set<string>;
  /** ADR-020 (S04): the DNR fake; exposed as `declarativeNetRequest` once the DNR permission was granted. */
  dnr: FakeDnr;
  /** Reads of the `declarativeNetRequest` property (the module-off test asserts 0). */
  dnrAccesses: number;
  /** ADR-020 (S04): webRequest events with filters and extraInfoSpec. */
  webRequestEvents: { beforeRequest: FakeWebRequestEvent; sendHeaders: FakeWebRequestEvent; errorOccurred: FakeWebRequestEvent; completed: FakeWebRequestEvent };
  /** Simulates the browser granting/revoking origins and firing the permissions events. */
  grant(origins: string[]): void;
  revoke(origins: string[]): void;
  /** Optional API permission grant / removal (SP-1, SP-5: the namespace stays after a removal; its calls throw). */
  grantPermission(permission: string): void;
  revokePermission(permission: string): void;
}

function hostOfPattern(pattern: string): string {
  const start = pattern.indexOf('://') + 3;
  return pattern.slice(start, pattern.indexOf('/', start));
}

export function createFakeChrome(options: FakeChromeOptions = {}): FakeChrome {
  const runtimeId = options.runtimeId ?? RUNTIME_ID;
  const session = new FakeStorageArea();
  const local = new FakeStorageArea();
  const managed = new FakeStorageArea();
  for (const [k, v] of Object.entries(options.managed ?? {})) managed.data.set(k, v);
  const grantedOrigins = new Set<string>(options.grantedOrigins ?? []);
  const grantedPermissions = new Set<string>(options.permissions ?? []);
  const registered = new Map<string, RegisteredContentScriptLike>();
  const executeScriptCalls: ScriptInjectionLike[] = [];
  const onAdded = new FakeEvent<(p: PermissionsLike) => void>();
  const onRemoved = new FakeEvent<(p: PermissionsLike) => void>();
  const knownTypes = options.resourceTypes;
  const beforeRequest = new FakeWebRequestEvent(knownTypes);
  const completed = new FakeWebRequestEvent(knownTypes);
  const sendHeaders = new FakeWebRequestEvent(knownTypes);
  const errorOccurred = new FakeWebRequestEvent(knownTypes);
  const dnr = new FakeDnr();
  /** SP-1/SP-5: the namespace appears with the grant and stays (throwing) after a removal. */
  let dnrExposed = grantedPermissions.has('declarativeNetRequestWithHostAccess');

  const covered = (pattern: string): boolean => {
    if (grantedOrigins.has(pattern)) return true;
    const host = hostOfPattern(pattern);
    if (host === '*') return false;
    for (const g of grantedOrigins) {
      const gScheme = g.slice(0, g.indexOf('://'));
      const pScheme = pattern.slice(0, pattern.indexOf('://'));
      if (gScheme !== '*' && gScheme !== pScheme) continue;
      if (patternCoversHost(g, host)) return true;
    }
    return false;
  };

  const fake: FakeChrome = {
    session,
    local,
    managed,
    failManagedGets: 0,
    grantedOrigins,
    registered,
    executeScriptCalls,
    sentToTabs: [],
    failExecuteScript: false,
    rejectMatchOriginAsFallback: false,
    tabList: [],
    framesByTab: new Map(),
    events: {
      onAdded,
      onRemoved,
      tabRemoved: new FakeEvent(),
      tabReplaced: new FakeEvent(),
      onBeforeNavigate: new FakeEvent(),
      onCommitted: new FakeEvent(),
      onErrorOccurred: new FakeEvent(),
      onHistoryStateUpdated: new FakeEvent(),
      onReferenceFragmentUpdated: new FakeEvent(),
      onCompleted: new FakeEvent(),
      webRequestCompleted: completed,
      webRequestBefore: beforeRequest,
    },
    grantedPermissions,
    dnr,
    dnrAccesses: 0,
    webRequestEvents: { beforeRequest, sendHeaders, errorOccurred, completed },
    grant(origins: string[]) {
      for (const o of origins) grantedOrigins.add(o);
      onAdded.emit({ origins });
    },
    revoke(origins: string[]) {
      for (const o of origins) grantedOrigins.delete(o);
      onRemoved.emit({ origins });
    },
    grantPermission(permission: string) {
      grantedPermissions.add(permission);
      if (permission === 'declarativeNetRequestWithHostAccess') {
        dnrExposed = true;
        dnr.unavailable = false;
      }
      onAdded.emit({ permissions: [permission], origins: [] });
    },
    revokePermission(permission: string) {
      grantedPermissions.delete(permission);
      if (permission === 'declarativeNetRequestWithHostAccess') dnr.unavailable = true;
      onRemoved.emit({ permissions: [permission], origins: [] });
    },
    runtime: {
      id: runtimeId,
      getManifest: () => (options.hostPermissions === undefined ? {} : { host_permissions: [...options.hostPermissions] }),
    },
    storage: {
      session,
      local,
      managed: {
        async get(keys: string | string[] | null) {
          if (fake.failManagedGets > 0) {
            fake.failManagedGets--;
            throw new Error('Managed storage unavailable');
          }
          return managed.get(keys);
        },
      },
    },
    permissions: {
      async contains(p: PermissionsLike) {
        return (p.origins ?? []).every(covered) && (p.permissions ?? []).every((x) => grantedPermissions.has(x));
      },
      async getAll() {
        return { origins: [...grantedOrigins], permissions: [...grantedPermissions] };
      },
      onAdded,
      onRemoved,
    },
    scripting: {
      async registerContentScripts(scripts) {
        for (const s of scripts) {
          if (fake.rejectMatchOriginAsFallback && s.matchOriginAsFallback !== undefined) {
            throw new Error("Unexpected property: 'matchOriginAsFallback'.");
          }
          if (registered.has(s.id)) throw new Error('Duplicate script ID ' + s.id);
        }
        for (const s of scripts) registered.set(s.id, structuredClone(s));
      },
      async updateContentScripts(scripts) {
        for (const s of scripts) {
          if (!registered.has(s.id)) throw new Error('Nonexistent script ID ' + s.id);
          if (fake.rejectMatchOriginAsFallback && s.matchOriginAsFallback !== undefined) {
            throw new Error("Unexpected property: 'matchOriginAsFallback'.");
          }
        }
        for (const s of scripts) registered.set(s.id, structuredClone(s));
      },
      async unregisterContentScripts(filter) {
        if (filter?.ids === undefined) registered.clear();
        else {
          if (filter.ids.some((id) => !registered.has(id))) throw new Error('Nonexistent script ID');
          for (const id of filter.ids) registered.delete(id);
        }
      },
      async getRegisteredContentScripts(filter) {
        const all = [...registered.values()].map((s) => structuredClone(s));
        return filter?.ids === undefined ? all : all.filter((s) => filter.ids?.includes(s.id));
      },
      async executeScript(injection) {
        if (fake.failExecuteScript) throw new Error('Cannot access contents of the page');
        executeScriptCalls.push(structuredClone(injection));
        return [];
      },
    },
    tabs: {
      async query() {
        return fake.tabList.map((t) => ({ ...t }));
      },
      async sendMessage(tabId, message, options) {
        fake.sentToTabs.push({ tabId, message: structuredClone(message), options: options === undefined ? undefined : { ...options } });
        return undefined;
      },
      onRemoved: new FakeEvent(),
      onReplaced: new FakeEvent(),
    },
    webNavigation: {
      async getAllFrames(details) {
        return fake.framesByTab.get(details.tabId) ?? null;
      },
      onBeforeNavigate: new FakeEvent(),
      onCommitted: new FakeEvent(),
      onErrorOccurred: new FakeEvent(),
      onHistoryStateUpdated: new FakeEvent(),
      onReferenceFragmentUpdated: new FakeEvent(),
      onCompleted: new FakeEvent(),
    },
    webRequest: {
      onBeforeRequest: beforeRequest,
      onCompleted: completed,
      onSendHeaders: sendHeaders,
      onErrorOccurred: errorOccurred,
      ...(knownTypes === undefined ? {} : { ResourceType: Object.freeze(Object.fromEntries(knownTypes.map((t) => [t.toUpperCase(), t]))) }),
    },
  };
  Object.defineProperty(fake, 'declarativeNetRequest', {
    enumerable: true,
    get() {
      fake.dnrAccesses++;
      return dnrExposed ? dnr : undefined;
    },
  });
  if (options.action !== undefined && options.action !== false) {
    const spec = options.action === true ? {} : options.action;
    const action = new FakeAction(spec.textColor ?? true);
    fake.badgeAction = action;
    fake.action = action;
    fake.i18n = createFakeI18n(spec.locale ?? 'en');
  }
  fake.tabs.onRemoved = fake.events.tabRemoved;
  fake.tabs.onReplaced = fake.events.tabReplaced;
  fake.webNavigation.onBeforeNavigate = fake.events.onBeforeNavigate;
  fake.webNavigation.onCommitted = fake.events.onCommitted;
  fake.webNavigation.onErrorOccurred = fake.events.onErrorOccurred;
  fake.webNavigation.onHistoryStateUpdated = fake.events.onHistoryStateUpdated;
  fake.webNavigation.onReferenceFragmentUpdated = fake.events.onReferenceFragmentUpdated;
  fake.webNavigation.onCompleted = fake.events.onCompleted;
  return fake;
}

/** Content-script sender as Chrome builds it (ids come from here, never from the payload). */
export function pageSender(over: Partial<MessageSenderLike> & { tabId?: number; docId?: string } = {}): MessageSenderLike {
  const { tabId, docId, ...rest } = over;
  return {
    id: RUNTIME_ID,
    tab: { id: tabId ?? 7 },
    frameId: 0,
    url: 'https://example.com/path?q=1#frag',
    origin: 'https://example.com',
    documentId: docId ?? 'DOC000000000000000000000000000001',
    documentLifecycle: 'active',
    ...rest,
  };
}

/** Extension page sender (popup / side panel). */
export function uiSender(over: Partial<MessageSenderLike> = {}): MessageSenderLike {
  return { id: RUNTIME_ID, origin: 'chrome-extension://' + RUNTIME_ID, url: 'chrome-extension://' + RUNTIME_ID + '/popup.html', ...over };
}

export function committed(over: Partial<NavigationDetailsLike> = {}): NavigationDetailsLike {
  return {
    tabId: 7,
    frameId: 0,
    url: 'https://example.com/path?q=1',
    timeStamp: 1000,
    documentId: 'DOC000000000000000000000000000001',
    frameType: 'outermost_frame',
    documentLifecycle: 'active',
    parentFrameId: -1,
    ...over,
  };
}

/** Waits for pending microtasks/macrotasks (debounced persists use timers). */
export async function settle(ms = 5): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}
