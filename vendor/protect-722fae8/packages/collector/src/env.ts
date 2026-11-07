// Environment boundary of the ISOLATED collector (E04-02, spec A5). Everything that touches `window` or
// `chrome.*` lives here so the core stays testable against a fake environment. Only routing facts cross this
// boundary: whether a message came from this window (`event.source === window`), its structured-clone payload
// and trusted lifecycle events. Nothing here reads DOM text, URLs, cookies or page globals (REQ-005); the SW
// derives the host from MessageSender alone (REQ-004).

import type { BridgeMessage, PageBatch } from '@detect-expert/contracts';

export type TimerHandle = unknown;

export interface CollectorEnv {
  /** Window messages. `fromSelf` is `event.source === window`: routing, not authentication (REQ-004). */
  onWindowMessage(listener: (fromSelf: boolean, data: unknown) => void): void;
  /** Trusted (browser-dispatched) pageshow; `persisted` is true on a BFCache restore (spec A7). */
  onPageShow(listener: (persisted: boolean) => void): void;
  /** Trusted pagehide; `persisted` is true when the document may enter BFCache. */
  onPageHide(listener: (persisted: boolean) => void): void;
  /**
   * SW -> bridge control (chrome.runtime.onMessage in the ISOLATED world, ADR-004 changelog). `fromExtension`
   * is true only when the sender is this extension's own service worker (sender.id === runtime.id, no
   * sender.tab, extension origin); a page can never reach this channel.
   */
  onControlMessage(listener: (fromExtension: boolean, data: unknown) => void): void;
  /** ISOLATED -> MAIN. Must never throw. */
  postToPage(message: BridgeMessage): void;
  /** chrome.runtime.sendMessage(PageBatch). Must never throw synchronously; rejects on transport failure. */
  sendToBackground(batch: PageBatch): Promise<unknown>;
  /** False once the extension context is invalidated (reload, uninstall, revoke). */
  isContextAlive(): boolean;
  /** Monotonic enough for local scheduling; never compared with another process's clock (ADR-004 §10). */
  now(): number;
  setTimer(fn: () => void, ms: number): TimerHandle;
  clearTimer(handle: TimerHandle): void;
  /** Random lowercase hex string of `bytes * 2` characters. */
  randomHex(bytes: number): string;
}

const CONTEXT_INVALIDATED = 'Extension context invalidated';

/** Only the extension's own service worker: same extension id, not a tab, extension origin/url. */
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

/** Real browser environment for the ISOLATED content script. */
export function createBrowserCollectorEnv(): CollectorEnv {
  const win = window;
  return {
    onWindowMessage(listener) {
      win.addEventListener('message', (event: MessageEvent<unknown>) => {
        listener(event.source === win, event.data);
      });
    },
    onPageShow(listener) {
      win.addEventListener('pageshow', (event: PageTransitionEvent) => {
        // A page can dispatch synthetic pageshow/pagehide on window; only browser-dispatched events count.
        if (event.isTrusted) listener(event.persisted);
      });
    },
    onPageHide(listener) {
      win.addEventListener('pagehide', (event: PageTransitionEvent) => {
        if (event.isTrusted) listener(event.persisted);
      });
    },
    onControlMessage(listener) {
      try {
        chrome.runtime.onMessage.addListener((message: unknown, sender: chrome.runtime.MessageSender) => {
          listener(isOwnServiceWorker(sender), message);
          return false; // no response: the SW sends control best-effort and never waits for an answer
        });
      } catch {
        // No runtime (context invalidated at start): no control channel; local pause/resume still work.
      }
    },
    postToPage(message) {
      try {
        win.postMessage(message, '*');
      } catch {
        // Nothing to do: the bridge never throws into the page.
      }
    },
    sendToBackground(batch) {
      if (!contextAlive()) return Promise.reject(new Error(CONTEXT_INVALIDATED));
      try {
        return chrome.runtime.sendMessage(batch);
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(CONTEXT_INVALIDATED));
      }
    },
    isContextAlive: contextAlive,
    now: () => Date.now(),
    setTimer: (fn, ms) => win.setTimeout(fn, ms),
    clearTimer: (handle) => {
      if (typeof handle === 'number') win.clearTimeout(handle);
    },
    randomHex(bytes) {
      const buf = new Uint8Array(bytes);
      crypto.getRandomValues(buf);
      let out = '';
      for (const b of buf) out += (b < 16 ? '0' : '') + b.toString(16);
      return out;
    },
  };
}
