// Fake chrome.* surface for unit tests: in-memory storage areas with fault injection and quota,
// recordable events, permission grants and scripting registrations. Test-only; never bundled.

import type {
  BackgroundChromeApi,
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
import { DATA_CONSENT_KEY, DATA_CONSENT_VERSION } from '../../contracts/src/data-consent';

export const RUNTIME_ID = 'abcdefghijklmnopabcdefghijklmnop';

export class FakeEvent<F extends (...args: never[]) => void> {
  readonly listeners: F[] = [];
  addListener(callback: F): void {
    this.listeners.push(callback);
  }
  emit(...args: Parameters<F>): void {
    for (const l of this.listeners) (l as (...a: Parameters<F>) => void)(...args);
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
  dataConsent?: boolean;
  runtimeId?: string;
  /** Static manifest host_permissions (test profile). */
  hostPermissions?: string[];
  /** Origin patterns the browser reports as granted. */
  grantedOrigins?: string[];
}

export interface FakeChrome extends BackgroundChromeApi {
  session: FakeStorageArea;
  local: FakeStorageArea;
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
    webRequestCompleted: { listeners: Array<{ cb: (d: RequestDetailsLike) => void; filter: RequestFilterLike }>; emit(d: RequestDetailsLike): void };
  };
  /** Simulates the browser granting/revoking origins and firing the permissions events. */
  grant(origins: string[]): void;
  revoke(origins: string[]): void;
}

function hostOfPattern(pattern: string): string {
  const start = pattern.indexOf('://') + 3;
  return pattern.slice(start, pattern.indexOf('/', start));
}

export function createFakeChrome(options: FakeChromeOptions = {}): FakeChrome {
  const runtimeId = options.runtimeId ?? RUNTIME_ID;
  const session = new FakeStorageArea();
  const local = new FakeStorageArea();
  if (options.dataConsent !== false) local.data.set(DATA_CONSENT_KEY, { version: DATA_CONSENT_VERSION, accepted: true });
  const grantedOrigins = new Set<string>(options.grantedOrigins ?? []);
  const registered = new Map<string, RegisteredContentScriptLike>();
  const executeScriptCalls: ScriptInjectionLike[] = [];
  const onAdded = new FakeEvent<(p: PermissionsLike) => void>();
  const onRemoved = new FakeEvent<(p: PermissionsLike) => void>();
  const webRequestListeners: Array<{ cb: (d: RequestDetailsLike) => void; filter: RequestFilterLike }> = [];

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
      webRequestCompleted: {
        listeners: webRequestListeners,
        emit(d: RequestDetailsLike) {
          for (const l of webRequestListeners) l.cb(d);
        },
      },
    },
    grant(origins: string[]) {
      for (const o of origins) grantedOrigins.add(o);
      onAdded.emit({ origins });
    },
    revoke(origins: string[]) {
      for (const o of origins) grantedOrigins.delete(o);
      onRemoved.emit({ origins });
    },
    runtime: {
      id: runtimeId,
      getManifest: () => (options.hostPermissions === undefined ? {} : { host_permissions: [...options.hostPermissions] }),
    },
    storage: { session, local },
    permissions: {
      async contains(p: PermissionsLike) {
        return (p.origins ?? []).every(covered);
      },
      async getAll() {
        return { origins: [...grantedOrigins], permissions: [] };
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
      onCompleted: {
        addListener(cb, filter) {
          webRequestListeners.push({ cb, filter });
        },
      },
    },
  };
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
