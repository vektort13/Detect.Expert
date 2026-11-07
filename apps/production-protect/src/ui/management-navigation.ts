// One owned Options document hosts management sections; navigation never changes product settings.
export type ManagementSection = 'hub' | 'firewall' | 'api' | 'antidetect' | 'settings' | 'browser-debug' | 'cookies' | 'autosurf' | 'proxy' | 'contacts' | 'protect' | 'history' | 'requests';

const SECTIONS: ReadonlySet<string> = new Set(['hub', 'firewall', 'api', 'antidetect', 'settings', 'browser-debug', 'cookies', 'autosurf', 'proxy', 'contacts', 'protect', 'history', 'requests']);
const MAX_CONTEXTS = 1024;
const MAX_PENDING = 16;
const LOCK_NAME = 'detect.expert/management-navigation/v1';
const queues = new WeakMap<object, { tail: Promise<void>; count: number }>();

function validTabId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 2147483647;
}

function ownOptions(raw: unknown, base: URL): URL | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  try {
    const url = new URL(raw);
    return url.protocol === base.protocol && url.host === base.host && url.pathname === '/options.html' &&
      url.username === '' && url.password === '' ? url : null;
  } catch { return null; }
}

function existingTarget(url: URL | null): number | null {
  const values = url?.searchParams.getAll('tabId') ?? [];
  if (values.length !== 1 || !/^(0|[1-9][0-9]{0,9})$/.test(values[0] ?? '')) return null;
  const value = Number(values[0]);
  return validTabId(value) ? value : null;
}

function destination(base: URL, section: ManagementSection, tabId: number | null, current: URL | null): string {
  const url = new URL('options.html', base);
  const target = section === 'api' || section === 'antidetect' ? tabId : existingTarget(current);
  if (target !== null) url.searchParams.set('tabId', String(target));
  url.hash = section;
  return url.href;
}

interface Candidate { tabId: number; windowId: number; url: URL; context: boolean }

async function candidates(api: typeof chrome, base: URL): Promise<Candidate[]> {
  if (typeof api.runtime.getContexts === 'function') {
    const contexts = await api.runtime.getContexts({ contextTypes: ['TAB' as chrome.runtime.ContextType] });
    if (!Array.isArray(contexts) || contexts.length > MAX_CONTEXTS) throw new Error('management-context-budget');
    const own = base.protocol + '//' + base.host;
    return contexts.flatMap(context => {
      const url = ownOptions(context.documentUrl, base);
      return context.contextType === 'TAB' && context.frameId === 0 && context.documentOrigin === own &&
        validTabId(context.tabId) && validTabId(context.windowId) && url !== null ?
        [{ tabId: context.tabId, windowId: context.windowId, url, context: true }] : [];
    });
  }
  // Firefox has no getContexts. Its native own-extension URL query is still checked by exact path below.
  if (typeof api.tabs.query !== 'function') return [];
  const tabs = await api.tabs.query({ url: new URL('options.html', base).href + '*' });
  if (!Array.isArray(tabs) || tabs.length > MAX_CONTEXTS) throw new Error('management-tab-budget');
  return tabs.flatMap(tab => {
    const url = ownOptions(tab.pendingUrl ?? tab.url, base);
    return validTabId(tab.id) && validTabId(tab.windowId) && url !== null ?
      [{ tabId: tab.id, windowId: tab.windowId, url, context: false }] : [];
  });
}

async function currentCandidate(api: typeof chrome, base: URL, candidate: Candidate): Promise<{ tab: chrome.tabs.Tab; url: URL } | null> {
  let tab: chrome.tabs.Tab;
  try { tab = await api.tabs.get(candidate.tabId); } catch { return null; }
  if (tab.id !== candidate.tabId || tab.windowId !== candidate.windowId) return null;
  let raw = tab.pendingUrl ?? tab.url;
  if (typeof raw === 'string') {
    const url = ownOptions(raw, base);
    return url === null ? null : { tab, url };
  }
  if (!candidate.context) return null;
  const contexts = await api.runtime.getContexts({ contextTypes: ['TAB' as chrome.runtime.ContextType], tabIds: [candidate.tabId], frameIds: [0] });
  if (!Array.isArray(contexts) || contexts.length > MAX_CONTEXTS) return null;
  const own = base.protocol + '//' + base.host;
  const matches = contexts.filter(context => context.contextType === 'TAB' && context.frameId === 0 &&
    context.tabId === candidate.tabId && context.windowId === candidate.windowId && context.documentOrigin === own && ownOptions(context.documentUrl, base) !== null);
  if (matches.length !== 1) return null;
  // A foreign pending navigation or replaced tab wins over a context read that just completed.
  try { tab = await api.tabs.get(candidate.tabId); } catch { return null; }
  if (tab.id !== candidate.tabId || tab.windowId !== candidate.windowId) return null;
  raw = tab.pendingUrl ?? tab.url;
  const url = typeof raw === 'string' ? ownOptions(raw, base) : ownOptions(matches[0]?.documentUrl, base);
  return url === null ? null : { tab, url };
}

async function navigate(section: ManagementSection, tabId: number | null, api: typeof chrome): Promise<boolean> {
  try {
    const base = new URL(api.runtime.getURL(''));
    if (!['chrome-extension:', 'moz-extension:'].includes(base.protocol) || base.host === '' || base.username !== '' || base.password !== '') return false;
    const seen = new Set<number>();
    const found = (await candidates(api, base)).sort((a, b) => a.tabId - b.tabId);
    for (const candidate of found) {
      if (seen.has(candidate.tabId)) continue;
      seen.add(candidate.tabId);
      const current = await currentCandidate(api, base, candidate);
      if (current === null) continue;
      await api.tabs.update(candidate.tabId, { url: destination(base, section, tabId, current.url), active: true });
      if (typeof api.windows?.update === 'function') await api.windows.update(current.tab.windowId, { focused: true });
      return true;
    }
    // A findings popup may invoke this helper: create its management tab in a normal browser window.
    let windowId: number | undefined;
    if (typeof api.windows?.getLastFocused === 'function') {
      try {
        const window = await api.windows.getLastFocused({ windowTypes: ['normal'] });
        if (window.type === 'normal' && validTabId(window.id)) windowId = window.id;
      } catch { /* tabs.create can select the browser's current normal window. */ }
    }
    const made = await api.tabs.create({ url: destination(base, section, tabId, null), active: true, ...(windowId === undefined ? {} : { windowId }) });
    const focus = made?.windowId ?? windowId;
    if (validTabId(focus) && typeof api.windows?.update === 'function') await api.windows.update(focus, { focused: true });
    if (validTabId(made?.id) && typeof api.runtime.getContexts === 'function') {
      // Keep the cross-document lock until another caller can discover this newly created tab.
      let ready = false;
      for (const delay of [0, 20, 50, 100, 200, 400, 800, 1200]) {
        if (delay > 0) await new Promise<void>(resolve => setTimeout(resolve, delay));
        if ((await candidates(api, base)).some(candidate => candidate.tabId === made.id)) { ready = true; break; }
      }
      if (!ready) return false;
    }
    return true;
  } catch { return false; }
}

/** One queue also covers canonical browser-created entries, so creation and adoption cannot race each other. */
function serial(browserApi: typeof chrome, action: () => Promise<boolean>): Promise<boolean> {
  let queue = queues.get(browserApi);
  if (queue === undefined) { queue = { tail: Promise.resolve(), count: 0 }; queues.set(browserApi, queue); }
  if (queue.count >= MAX_PENDING) return Promise.resolve(false);
  queue.count++;
  const run = queue.tail.then(async () => {
    const locks = globalThis.navigator?.locks;
    if (typeof locks?.request === 'function') {
      try { return await locks.request(LOCK_NAME, action); } catch { return false; }
    }
    return action();
  });
  queue.tail = run.then(() => undefined, () => undefined);
  return run.finally(() => { queue.count--; });
}

/** Reuses only the exact owned Options page; native locks also serialize simultaneous extension documents. */
export function openManagement(section: ManagementSection, tabId: number | null = null, browserApi: typeof chrome = chrome): Promise<boolean> {
  if (!SECTIONS.has(section) || (tabId !== null && !validTabId(tabId)) || browserApi === null || typeof browserApi !== 'object') return Promise.resolve(false);
  return serial(browserApi, () => navigate(section, tabId, browserApi));
}

/**
 * The browser's own Options command can create a queryless duplicate of an existing contextual tab.
 * Only that new canonical entry is adopted; deep links and API contexts retain their normal route.
 * true means render this document, false means forwarding succeeded and this exact entry was closed.
 */
export async function adoptManagementEntry(browserApi: typeof chrome = chrome): Promise<boolean> {
  if (browserApi === null || typeof browserApi !== 'object') return true;
  let entryWindow: Window, entryDocument: Document, entryHref: string;
  try {
    entryWindow = globalThis.window;
    if (entryWindow !== entryWindow.top) return true;
    entryDocument = entryWindow.document;
    entryHref = entryWindow.location.href;
    const base = new URL(browserApi.runtime.getURL(''));
    const url = ownOptions(entryHref, base);
    if (!['chrome-extension:', 'moz-extension:'].includes(base.protocol) || url === null || url.search !== '' || url.hash !== '') return true;
  } catch { return true; }
  let forwarded = false;
  await serial(browserApi, async () => {
    try {
      const base = new URL(browserApi.runtime.getURL(''));
      const initial = await browserApi.tabs.getCurrent();
      if (!validTabId(initial?.id) || !validTabId(initial.windowId)) return true;
      const ownEntry: Candidate = { tabId: initial.id, windowId: initial.windowId, url: new URL(entryHref), context: typeof browserApi.runtime.getContexts === 'function' };
      const remainsEntry = async (): Promise<boolean> => {
        if (entryWindow.closed || entryWindow.document !== entryDocument || entryWindow.location.href !== entryHref) return false;
        const current = await currentCandidate(browserApi, base, ownEntry);
        return current !== null && current.url.search === '' && current.url.hash === '' &&
          !entryWindow.closed && entryWindow.document === entryDocument && entryWindow.location.href === entryHref;
      };
      if (!await remainsEntry()) return true;
      const found = (await candidates(browserApi, base)).filter(candidate => candidate.tabId < ownEntry.tabId).sort((a, b) => a.tabId - b.tabId);
      for (const candidate of found) {
        if (!await remainsEntry()) return true;
        const winner = await currentCandidate(browserApi, base, candidate);
        if (winner === null) continue;
        await browserApi.tabs.update(candidate.tabId, { url: destination(base, 'hub', null, winner.url), active: true });
        if (typeof browserApi.windows?.update === 'function') await browserApi.windows.update(winner.tab.windowId, { focused: true });
        if (!await remainsEntry()) return true;
        entryWindow.close();
        forwarded = entryWindow.closed;
        return !forwarded;
      }
      return true;
    } catch { return true; }
  });
  // Queue/lock exhaustion must never suppress a valid management document.
  return !forwarded;
}
