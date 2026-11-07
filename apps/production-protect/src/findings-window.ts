// ADR-052: browser bindings only. Chrome chooses a valid initial position; the owned page
// reanchors against its actual screen.avail*. Browser-window bounds may exceed the display.
import { readFindingsTarget } from './findings-target';
import type { FindingsTarget } from './findings-target';

export const FINDINGS_PAGE = 'findings.html';
export const FINDINGS_WINDOW_WIDTH = 420;
export const FINDINGS_WINDOW_HEIGHT = 500;
const pendingWindows = new Map<number, FindingsTarget & { at: number; nativeTabId: number }>();
const PENDING_WINDOW_MS = 5000;

function validId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Exact ownership: never close an unrelated popup or a window with additional tabs. */
export function ownedFindingsTarget(window: chrome.windows.Window): FindingsTarget | null {
  if (!validId(window.id) || window.type !== 'popup' || window.tabs?.length !== 1) return null;
  const raw = window.tabs[0]?.pendingUrl ?? window.tabs[0]?.url;
  if (typeof raw !== 'string' || raw.length > 512) return null;
  try {
    const url = new URL(raw);
    if (url.protocol + '//' + url.host + url.pathname !== chrome.runtime.getURL(FINDINGS_PAGE) || url.username !== '' || url.password !== '' || url.hash !== '') return null;
    return readFindingsTarget(url.search);
  } catch {
    return null;
  }
}

/** Chrome redacts extension tab URLs without the tabs permission; own runtime contexts are authoritative. */
export function contextFindingsTarget(window: chrome.windows.Window, contexts: readonly chrome.runtime.ExtensionContext[]): FindingsTarget | null {
  if (!validId(window.id) || window.type !== 'popup' || window.tabs?.length !== 1 || !validId(window.tabs[0]?.id)) return null;
  // A pending navigation always wins over an earlier context, including a foreign destination.
  if (typeof (window.tabs[0].pendingUrl ?? window.tabs[0].url) === 'string') return ownedFindingsTarget(window);
  const own = chrome.runtime.getURL('').replace(/\/$/, '');
  const matches = contexts.filter(context => context.contextType === 'TAB' && context.frameId === 0 && context.windowId === window.id && context.tabId === window.tabs?.[0]?.id && context.documentOrigin === own);
  if (matches.length !== 1) return null;
  return ownedFindingsTarget({ ...window, tabs: [{ ...window.tabs[0], url: matches[0]?.documentUrl }] });
}

function pendingTarget(window: chrome.windows.Window): FindingsTarget | null {
  if (!validId(window.id)) return null;
  const pending = pendingWindows.get(window.id);
  if (pending === undefined) return null;
  if (Date.now() - pending.at > PENDING_WINDOW_MS || window.type !== 'popup' || window.tabs?.length !== 1 || window.tabs[0]?.id !== pending.nativeTabId) {
    pendingWindows.delete(window.id); return null;
  }
  if (typeof (window.tabs[0]?.pendingUrl ?? window.tabs[0]?.url) === 'string') return null;
  return { tabId: pending.tabId, documentKey: pending.documentKey };
}

async function readOwnedWindow(window: chrome.windows.Window, reservePending = false): Promise<FindingsTarget | null> {
  const direct = ownedFindingsTarget(window);
  if (direct !== null) return direct;
  if (!validId(window.id)) return null;
  if (typeof (window.tabs?.[0]?.pendingUrl ?? window.tabs?.[0]?.url) === 'string') return null;
  const contexts = await chrome.runtime.getContexts({ windowIds: [window.id], contextTypes: ['TAB' as chrome.runtime.ContextType], frameIds: [0] });
  if (contexts.length > 32) return null;
  return contextFindingsTarget(window, contexts) ?? (reservePending && contexts.length === 0 ? pendingTarget(window) : null);
}

export function forgetFindingsWindow(windowId: number): void { pendingWindows.delete(windowId); }

export async function findingsWindowExists(windowId: number): Promise<boolean> {
  try {
    const window = await chrome.windows.get(windowId, { populate: true });
    return await readOwnedWindow(window, true) !== null;
  } catch {
    return false;
  }
}

export async function removeFindingsWindow(windowId: number): Promise<void> {
  let window: chrome.windows.Window;
  try { window = await chrome.windows.get(windowId, { populate: true }); } catch { pendingWindows.delete(windowId); return; }
  if (await readOwnedWindow(window) === null) {
    // Creation provenance reserves a slot while loading, but never authorizes closing an unknown document.
    if (pendingTarget(window) !== null) throw new Error('findings-window-not-ready');
    return;
  }
  try { await chrome.windows.remove(windowId); }
  catch (error) { if (await findingsWindowExists(windowId)) throw error; }
  pendingWindows.delete(windowId);
}

export async function createFindingsWindow(tabId: number, documentKey: string, sourceWindowId: number, eligible: () => boolean): Promise<number | null> {
  // A restart or interrupted adoption must never create a second automatic window.
  if ((await openFindingsWindows()).length > 0) return null;
  const [source, tab] = await Promise.all([chrome.windows.get(sourceWindowId), chrome.tabs.get(tabId)]);
  if (!source.focused || source.type !== 'normal' || tab.active !== true || tab.windowId !== sourceWindowId || !eligible()) return null;
  const width = FINDINGS_WINDOW_WIDTH, height = FINDINGS_WINDOW_HEIGHT;
  const target = readFindingsTarget('?tab=' + String(tabId) + '&document=' + encodeURIComponent(documentKey));
  if (target === null) return null;
  const made = await chrome.windows.create({
    url: chrome.runtime.getURL(FINDINGS_PAGE) + '?tab=' + String(tabId) + '&document=' + encodeURIComponent(documentKey),
    type: 'popup', focused: false, incognito: source.incognito === true, width, height,
  });
  if (validId(made?.id) && made.tabs?.length === 1 && validId(made.tabs[0]?.id)) {
    pendingWindows.set(made.id, { tabId, documentKey, at: Date.now(), nativeTabId: made.tabs[0].id });
    while (pendingWindows.size > 16) {
      const oldest = pendingWindows.keys().next().value;
      if (oldest === undefined) break;
      pendingWindows.delete(oldest);
    }
  }
  return validId(made?.id) ? made.id : null;
}

/** Restart recovery, bounded to the module's single-window policy; only exact own pages are returned. */
export async function openFindingsWindows(): Promise<Array<FindingsTarget & { windowId: number }>> {
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['popup'] });
  if (windows.length > 256) throw new Error('findings-window-budget');
  const found: Array<FindingsTarget & { windowId: number }> = [];
  for (const window of windows) {
    const target = await readOwnedWindow(window, true);
    if (target !== null && validId(window.id)) found.push({ ...target, windowId: window.id });
  }
  return found;
}
