import { reportHost } from '../../attribution/src/index';
// Trust boundary of the two runtime.onMessage channels (REQ-004, spec A5, A6, V §2, ADR-004 §3/§8).
// tabId / frameId / documentId / host come ONLY from MessageSender; the payload can never supply them.

import { makeDocumentKey, sanitizeHost } from '@detect-expert/contracts';
import type { MessageSenderLike } from './chrome-api';

export type FrameType = 'outermost_frame' | 'fenced_frame' | 'sub_frame';
export type BrowserDocumentLifecycle = 'prerender' | 'active' | 'cached' | 'pending_deletion';

/** Trusted context of a content-script sender. Never contains the URL, only the sanitized host. */
export interface PageSenderContext {
  tabId: number;
  frameId: number;
  documentId: string;
  documentKey: string;
  host: string | null;
  /** Match pattern for the scope check (scheme + host), or null when the origin is opaque. */
  originPattern: string | null;
  documentLifecycle: BrowserDocumentLifecycle | null;
  frameType: FrameType | null;
}

export type PageSenderReject =
  | 'foreign-extension'
  | 'no-tab'
  | 'no-frame'
  | 'no-document-id'
  | 'extension-page'
  | 'bad-url'
  | 'opaque-origin';

export type PageSenderResult = { ok: true; context: PageSenderContext } | { ok: false; reason: PageSenderReject };

/** Chrome documentId is a 32-char hex string; keep the same alphabet/bounds as contract ids. */
const DOCUMENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const LIFECYCLES: ReadonlySet<string> = new Set(['prerender', 'active', 'cached', 'pending_deletion']);
const FRAME_TYPES: ReadonlySet<string> = new Set(['outermost_frame', 'fenced_frame', 'sub_frame']);

export function selfOrigin(runtimeId: string): string {
  return 'chrome-extension://' + runtimeId;
}

function schemeOf(url: string): 'http:' | 'https:' | null {
  if (url.startsWith('https://')) return 'https:';
  if (url.startsWith('http://')) return 'http:';
  return null;
}

export function readLifecycle(value: unknown): BrowserDocumentLifecycle | null {
  return typeof value === 'string' && LIFECYCLES.has(value) ? (value as BrowserDocumentLifecycle) : null;
}

export function readFrameType(value: unknown): FrameType | null {
  return typeof value === 'string' && FRAME_TYPES.has(value) ? (value as FrameType) : null;
}

/** Pure part: shape checks on MessageSender. Scope membership is checked separately (async). */
export function readPageSender(sender: MessageSenderLike, runtimeId: string): PageSenderResult {
  if (sender.id !== runtimeId) return { ok: false, reason: 'foreign-extension' };
  if (sender.origin === selfOrigin(runtimeId)) return { ok: false, reason: 'extension-page' };
  const tabId = sender.tab?.id;
  if (typeof tabId !== 'number' || !Number.isInteger(tabId) || tabId < 0) return { ok: false, reason: 'no-tab' };
  const frameId = sender.frameId;
  if (typeof frameId !== 'number' || !Number.isInteger(frameId) || frameId < 0) return { ok: false, reason: 'no-frame' };
  const documentId = sender.documentId;
  if (typeof documentId !== 'string' || !DOCUMENT_ID_RE.test(documentId)) return { ok: false, reason: 'no-document-id' };

  const url = typeof sender.url === 'string' ? sender.url : '';
  const origin = typeof sender.origin === 'string' ? sender.origin : '';
  // Host from the frame URL; about:blank / data: frames (matchOriginAsFallback) fall back to sender.origin.
  let scheme = schemeOf(url);
  let host = scheme !== null ? sanitizeHost(url) : null;
  if (host === null) {
    scheme = schemeOf(origin);
    host = scheme !== null ? sanitizeHost(origin) : null;
  }
  if (host === null || scheme === null) {
    if (url.length === 0 && origin.length === 0) return { ok: false, reason: 'bad-url' };
    return { ok: false, reason: 'opaque-origin' };
  }
  const documentLifecycle = readLifecycle((sender as { documentLifecycle?: unknown }).documentLifecycle);
  // frameType is not part of MessageSender today; read it defensively if a future Chrome adds it.
  const frameType = readFrameType((sender as { frameType?: unknown }).frameType);

  return {
    ok: true,
    context: {
      tabId,
      frameId,
      documentId,
      documentKey: makeDocumentKey(tabId, frameId, documentId),
      host,
      originPattern: scheme + '//' + host + '/*',
      documentLifecycle,
      frameType,
    },
  };
}

export interface ScopeAccess {
  /** True when the origin pattern is covered by granted host permissions (permissions.contains) or the tab is activeTab-granted. */
  isGranted(originPattern: string, tabId: number): Promise<boolean>;
}

export type VerifiedPageSender = PageSenderResult | { ok: false; reason: 'out-of-scope' };

/** Shape checks + scope membership. Never throws. */
export async function verifyPageSender(
  sender: MessageSenderLike,
  runtimeId: string,
  access: ScopeAccess,
): Promise<VerifiedPageSender> {
  const read = readPageSender(sender, runtimeId);
  if (!read.ok) return read;
  const pattern = read.context.originPattern;
  let granted = false;
  try {
    granted = pattern !== null && (await access.isGranted(pattern, read.context.tabId));
  } catch {
    granted = false;
  }
  if (!granted) return { ok: false, reason: 'out-of-scope' };
  return read;
}

/**
 * Privileged UI channel: only pages of this extension. `sender.tab` is absent for the popup and side panel;
 * an extension page opened in a tab (options_ui open_in_tab) is accepted only when its URL is our own
 * chrome-extension://<id>/ page. A content script always carries the site origin, never ours.
 */
export function verifyUiSender(sender: MessageSenderLike, runtimeId: string): boolean {
  if (sender.id !== runtimeId) return false;
  const own = selfOrigin(runtimeId);
  if (sender.origin !== own) return false;
  if (sender.tab === undefined) return true;
  return typeof sender.url === 'string' && sender.url.startsWith(own + '/');
}

/**
 * ADR-020 §6 (S04): widening actions of the module «Защита» (enable, set-settings, set-site with excluded:false) are
 * accepted only from the Options page: a verified UI sender whose URL is our own options.html. The popup and the side
 * panel pass verifyUiSender but not this check.
 */
export function isOptionsSender(sender: MessageSenderLike, runtimeId: string): boolean {
  if (!verifyUiSender(sender, runtimeId)) return false;
  const page = selfOrigin(runtimeId) + '/options.html';
  const url = sender.url;
  return typeof url === 'string' && (url === page || url.startsWith(page + '#') || url.startsWith(page + '?'));
}

/** Host and scheme of the top-level document of a sender's tab (never a URL). */
export interface SenderTabTop {
  host: string;
  scheme: 'http' | 'https';
}

/**
 * ADR-020 (S04, review r2): top-level document of the sender's tab from MessageSender.tab.url, which the browser
 * fills with the tab's last committed top-level URL when the extension has host access to that page (the module
 * requires the broad grant). Reduced to a sanitized host here; the URL lives in a local variable only. Null without a
 * tab URL or for a non-http(s) top-level document. For a prerendered document the tab URL belongs to the page the
 * tab shows, not to the prerendered one; the caller decides. Not part of PageSenderContext: observation never reads it.
 */
export function readSenderTabTop(sender: MessageSenderLike): SenderTabTop | null {
  const url = sender.tab?.url;
  if (typeof url !== 'string') return null;
  const scheme = schemeOf(url);
  if (scheme === null) return null;
  const host = sanitizeHost(url);
  return host === null ? null : { host, scheme: scheme === 'https:' ? 'https' : 'http' };
}

/** P01: after the exact-origin permission check, discard the permission identity before queuing. */
export function redactSenderContext(context: PageSenderContext): PageSenderContext {
  return { ...context, host: reportHost(context.host), originPattern: null };
}
