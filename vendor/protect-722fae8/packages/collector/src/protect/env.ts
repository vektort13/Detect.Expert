// Browser environment of the ISOLATED part of the module «Защита» (ADR-020 §A, S05). Everything that touches `window`,
// `document` or `chrome.*` lives here, so session.ts and relay.ts stay testable against a fake. Only routing facts and
// attribute views cross this boundary; field values are read in field-value.ts only. Page -> ISOLATED posting is not
// here: protect.js calls postMessage from relay.ts only (scripts/build.mjs verifies it).
// Nothing here reads cookies, URLs or storage (SP-4: the module never touches storage.local from a content script).

import type { ProtectPageMessage } from '@detect-expert/contracts';
import type { FieldElementLike, TypeObserverPort, TypeRecordLike } from './classify';

export type ProtectTimer = unknown;

/** Window events the session listens to (capture, passive). */
export type ProtectWindowEvent = 'focusin' | 'input' | 'focusout' | 'submit' | 'click' | 'pagehide';

/** What the session needs from a DOM event: whether the browser dispatched it, and its innermost (open) target. */
export interface ProtectEvent {
  readonly isTrusted: boolean;
  /** composedPath()[0]: the innermost target in open shadow roots (a closed root yields its host). */
  readonly target: unknown;
}

export interface ProtectEnv {
  /** Adds a capture + passive listener on window; returns its remover. */
  listen(type: ProtectWindowEvent, handler: (event: ProtectEvent) => void): () => void;
  /** Window messages; `fromSelf` is `event.source === window` (routing, not authentication: REQ-004). */
  listenMessages(handler: (fromSelf: boolean, data: unknown) => void): () => void;
  /**
   * SW -> ISOLATED control (runtime.onMessage). `fromServiceWorker` is true only for this extension's own service
   * worker (sender.id === runtime.id, no tab, extension origin); a page can never reach this channel.
   */
  onControl(listener: (fromServiceWorker: boolean, data: unknown) => void): () => void;
  /** chrome.runtime.sendMessage, looked up at call time. Never throws synchronously; rejects on failure. */
  sendToBackground(message: ProtectPageMessage): Promise<unknown>;
  /** False once the extension context is invalidated (reload, uninstall). */
  isContextAlive(): boolean;
  /** document.readyState. */
  readyState(): string;
  /**
   * document.prerendering (Chrome 108+): the document is being prerendered and not shown yet. Optional; absent or
   * throwing counts as false.
   */
  prerendering?(): boolean;
  /** One callback on the document's activation (prerenderingchange); returns its remover. Optional. */
  onActivation?(callback: () => void): () => void;
  /** At most `limit` form controls (input, select) of the document, in tree order: the payment scan (attributes only). */
  formControls(limit: number): readonly FieldElementLike[];
  /** MutationObserver on `type` attributes of the whole document (attributeOldValue); null when unavailable. */
  observeTypeAttributes(callback: (records: readonly TypeRecordLike[]) => void): TypeObserverPort | null;
  /** Wall clock for local throttles (never compared with another process). */
  now(): number;
  /** performance.now(): MAIN and ISOLATED share timeOrigin (SP-12), so relay ages are computed on this clock. */
  monotonicNow(): number;
  setTimer(fn: () => void, ms: number): ProtectTimer;
  clearTimer(handle: ProtectTimer): void;
  /** 16 lowercase hex characters from crypto.getRandomValues (an id, never a secret). */
  randomId(): string;
}

const CONTEXT_INVALIDATED = 'Extension context invalidated';
const LISTENER_OPTIONS: AddEventListenerOptions = { capture: true, passive: true };
const FORM_CONTROLS = 'input, select';

/** Only this extension's own service worker: same extension id, not a tab, extension origin/url. */
function isOwnServiceWorker(sender: chrome.runtime.MessageSender): boolean {
  try {
    const id = chrome.runtime.id;
    if (typeof id !== 'string' || sender.id !== id || sender.tab !== undefined) return false;
    const own = 'chrome-extension://' + id;
    return sender.origin === own || (typeof sender.url === 'string' && sender.url.startsWith(own + '/'));
  } catch {
    return false;
  }
}

function contextAlive(): boolean {
  try {
    return typeof chrome !== 'undefined' && chrome.runtime !== undefined && typeof chrome.runtime.id === 'string';
  } catch {
    return false;
  }
}

/** The innermost target of the event's composed path (open shadow roots only), else the event target. */
function innermostTarget(event: Event): unknown {
  try {
    const path = event.composedPath();
    return path.length > 0 ? path[0] : event.target;
  } catch {
    return null;
  }
}

/** Real browser environment of protect.js (ISOLATED world). */
export function createBrowserProtectEnv(): ProtectEnv {
  const win = window;
  const doc = document;
  return {
    listen(type, handler) {
      const fn = (event: Event): void => {
        handler({ isTrusted: event.isTrusted === true, target: innermostTarget(event) });
      };
      win.addEventListener(type, fn, LISTENER_OPTIONS);
      return () => win.removeEventListener(type, fn, LISTENER_OPTIONS);
    },
    listenMessages(handler) {
      const fn = (event: MessageEvent<unknown>): void => {
        handler(event.source === win, event.data);
      };
      win.addEventListener('message', fn);
      return () => win.removeEventListener('message', fn);
    },
    onControl(listener) {
      const fn = (message: unknown, sender: chrome.runtime.MessageSender): boolean => {
        listener(isOwnServiceWorker(sender), message);
        return false; // no response: the SW sends control best-effort and never waits for an answer
      };
      try {
        chrome.runtime.onMessage.addListener(fn);
      } catch {
        return () => undefined; // no runtime (context invalidated at start): no control channel
      }
      return () => {
        try {
          chrome.runtime.onMessage.removeListener(fn);
        } catch {
          // Context gone: nothing left to remove.
        }
      };
    },
    sendToBackground(message) {
      if (!contextAlive()) return Promise.reject(new Error(CONTEXT_INVALIDATED));
      try {
        return chrome.runtime.sendMessage(message);
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(CONTEXT_INVALIDATED));
      }
    },
    isContextAlive: contextAlive,
    readyState: () => doc.readyState,
    prerendering: () => (doc as Document & { prerendering?: unknown }).prerendering === true,
    onActivation(callback) {
      const fn = (): void => callback();
      doc.addEventListener('prerenderingchange', fn, { once: true });
      return () => doc.removeEventListener('prerenderingchange', fn);
    },
    formControls(limit) {
      const out: FieldElementLike[] = [];
      try {
        const list = doc.querySelectorAll(FORM_CONTROLS);
        const n = Math.min(list.length, limit);
        for (let i = 0; i < n; i++) {
          const el = list[i];
          if (el !== undefined) out.push(el);
        }
      } catch {
        // No document element yet: nothing to scan.
      }
      return out;
    },
    observeTypeAttributes(callback) {
      try {
        const map = (records: readonly MutationRecord[]): TypeRecordLike[] => records.map((r) => ({ target: r.target, oldValue: r.oldValue }));
        const observer = new MutationObserver((records) => callback(map(records)));
        observer.observe(doc, { subtree: true, attributes: true, attributeFilter: ['type'], attributeOldValue: true });
        return {
          takeRecords: () => map(observer.takeRecords()),
          disconnect: () => observer.disconnect(),
        };
      } catch {
        return null;
      }
    },
    now: () => Date.now(),
    monotonicNow: () => performance.now(),
    setTimer: (fn, ms) => win.setTimeout(fn, ms),
    clearTimer: (handle) => {
      if (typeof handle === 'number') win.clearTimeout(handle);
    },
    randomId() {
      const buf = new Uint8Array(8);
      crypto.getRandomValues(buf);
      let out = '';
      for (const b of buf) out += (b < 16 ? '0' : '') + b.toString(16);
      return out;
    },
  };
}
