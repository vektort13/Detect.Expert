// UI -> SW channel helpers (privileged: the SW authorizes extension pages by sender.origin, ADR-004 §8).
// Every call is bounded: an unanswered or malformed response becomes { ok: false, code: 'unavailable' }.

import type { UiClearSessionRequest, UiErrorCode, UiRequest, UiResponse } from '@detect-expert/contracts';

export type { UiClearSessionRequest };

/** Clears every session report (contract `ui-clear-session`, ADR-004 changelog); the SW answers ok. */
export const UI_CLEAR_SESSION_REQUEST: Readonly<UiClearSessionRequest> = Object.freeze({
  schemaVersion: 1,
  type: 'ui-clear-session',
});

export type SendFailureCode = UiErrorCode | 'unavailable';

export type SendResult = { ok: true; response: Exclude<UiResponse, { type: 'error' }> } | { ok: false; code: SendFailureCode };

export function isUiResponse(value: unknown): value is UiResponse {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as { schemaVersion?: unknown; type?: unknown };
  return record.schemaVersion === 1 && typeof record.type === 'string';
}

export async function sendUiRequest(request: UiRequest): Promise<SendResult> {
  try {
    const raw: unknown = await chrome.runtime.sendMessage(request);
    if (!isUiResponse(raw)) return { ok: false, code: 'unavailable' };
    if (raw.type === 'error') return { ok: false, code: raw.code };
    return { ok: true, response: raw };
  } catch {
    return { ok: false, code: 'unavailable' };
  }
}

export interface ActiveTab {
  id: number | null;
  /** Present only when the browser exposes it (host permission / activeTab); undefined otherwise. */
  url: string | undefined;
}

/**
 * Test/debug override: an extension page opened as `popup.html?tabId=<n>` reports on that tab instead of the
 * active one (Playwright opens extension pages as ordinary tabs, so the active tab would be the page itself).
 * Only extension pages can carry this query string; web pages cannot open extension URLs (no web-accessible resources).
 */
export function readTabIdOverride(search: string): number | null {
  const match = /(?:^\?|&)tabId=(\d{1,10})(?:&|$)/.exec(search);
  if (match === null || match[1] === undefined) return null;
  const tabId = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(tabId) && tabId >= 0 ? tabId : null;
}

/** tabs.query needs no `tabs` permission for the id; `url` is omitted by Chrome without host access. */
export async function queryActiveTab(): Promise<ActiveTab> {
  try {
    // F141: fail closed until the release owner supplies the compile-time profile.
    const override = typeof __BUILD_PROFILE__ !== 'undefined' && (__BUILD_PROFILE__ === 'test' || __BUILD_PROFILE__ === 'test-optional') && typeof location !== 'undefined'
      ? readTabIdOverride(location.search) : null;
    if (override !== null) {
      const tab = await chrome.tabs.get(override);
      return { id: typeof tab.id === 'number' ? tab.id : override, url: typeof tab.url === 'string' ? tab.url : undefined };
    }
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (tab === undefined || typeof tab.id !== 'number' || tab.id < 0) return { id: null, url: undefined };
    return { id: tab.id, url: typeof tab.url === 'string' ? tab.url : undefined };
  } catch {
    return { id: null, url: undefined };
  }
}

export function errorMessageKey(code: SendFailureCode): string {
  return 'error_' + code.replace(/-/g, '_');
}
