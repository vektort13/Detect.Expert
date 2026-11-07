// ADR-050 / audit F1: production adapter; the 722fae8 vendor snapshot remains unchanged.
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
  /** Bounded attribute-only payment scan, including reachable open shadow roots. */
  formControls(limit: number): readonly FieldElementLike[];
  /** Document and discovered light-DOM control type history; no values from untracked roots. */
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
const MAX_SCAN_NODES = 4096;
const MAX_SCAN_ROOTS = 64;
const MAX_PAYMENT_CONTROLS = 256;
const MAX_OBSERVED_CONTROLS = 512;

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
  // Capture native DOM accessors in this ISOLATED realm. The traversal never
  // invokes page getters and inspects no field text, value or event payload.
  const apply = Reflect.apply;
  const getOwn = Object.getOwnPropertyDescriptor;
  const localNameGet = getOwn(Element.prototype, 'localName')?.get;
  const shadowRootGet = getOwn(Element.prototype, 'shadowRoot')?.get;
  const connectedGet = getOwn(Node.prototype, 'isConnected')?.get;
  const ownerDocumentGet = getOwn(Node.prototype, 'ownerDocument')?.get;
  const getRootNode = Node.prototype.getRootNode;
  const createTreeWalker = Document.prototype.createTreeWalker;
  const nextNode = TreeWalker.prototype.nextNode;
  const observerPrototype = typeof MutationObserver === 'function' ? MutationObserver.prototype : null;
  const observe = observerPrototype?.observe;
  const takeRecords = observerPrototype?.takeRecords;
  const disconnect = observerPrototype?.disconnect;
  type Scan = { controls: FieldElementLike[]; lightControls: Element[]; complete: boolean };
  function scanControls(limit: number): Scan {
    const controls: FieldElementLike[] = [], lightControls: Element[] = [], roots: (Document | ShadowRoot)[] = [doc];
    let nodes = 0;
    try {
      if (!localNameGet || !shadowRootGet) return { controls, lightControls, complete: false };
      for (let index = 0; index < roots.length; index++) {
        const root = roots[index];
        const walker = apply(createTreeWalker, doc, [root, 1]) as TreeWalker;
        for (let node = apply(nextNode, walker, []) as Element | null; node !== null; node = apply(nextNode, walker, []) as Element | null) {
          if (++nodes > MAX_SCAN_NODES) return { controls, lightControls, complete: false };
          const name = apply(localNameGet, node, []) as string;
          if (name === 'input' || name === 'select') {
            if (controls.length >= limit) return { controls, lightControls, complete: false };
            controls.push(node);
            if (root === doc) lightControls.push(node);
          }
          const shadow = apply(shadowRootGet, node, []) as ShadowRoot | null;
          if (shadow !== null) {
            if (roots.length >= MAX_SCAN_ROOTS) return { controls, lightControls, complete: false };
            roots.push(shadow);
          }
        }
      }
      return { controls, lightControls, complete: true };
    } catch { return { controls, lightControls, complete: false }; }
  }
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
      return scanControls(Math.min(MAX_PAYMENT_CONTROLS, Math.max(0, limit))).controls;
    },
    observeTypeAttributes(callback) {
      try {
        if (!observe || !takeRecords || !disconnect) return null;
        const tracked = new WeakSet<object>();
        let active = true, healthy = true, count = 0;
        const options = { attributes: true, attributeFilter: ['type'], attributeOldValue: true };
        const discover = (): boolean => {
          const scan = scanControls(MAX_PAYMENT_CONTROLS);
          for (const element of scan.lightControls) {
            if (tracked.has(element)) continue;
            if (count >= MAX_OBSERVED_CONTROLS) { healthy = false; return false; }
            // A direct registration continues recording type transitions while
            // a previously observed control is temporarily detached.
            apply(observe, observer, [element, options]); tracked.add(element); count++;
            callback([{ target: element, oldValue: null }]);
          }
          return scan.complete;
        };
        const map = (records: readonly MutationRecord[]): TypeRecordLike[] => {
          const result = records.filter(record => record.type === 'attributes' && record.attributeName === 'type')
            .map(record => ({ target: record.target, oldValue: record.oldValue }));
          if (records.some(record => record.type === 'childList')) discover();
          return result;
        };
        const observer = new MutationObserver(records => {
          try { callback(map(records)); } catch { healthy = false; }
        });
        apply(observe, observer, [doc, { subtree: true, childList: true, ...options }]);
        discover();
        return {
          takeRecords: () => map(apply(takeRecords, observer, []) as MutationRecord[]),
          isTracked(element) {
            if (!active || !healthy || !connectedGet || !ownerDocumentGet || !discover()) return false;
            // Shadow-root fields, detached fields and foreign-realm controls
            // are not candidates for reading, even when an event is composed.
            return tracked.has(element) &&
              apply(connectedGet, element, []) === true && apply(ownerDocumentGet, element, []) === doc && apply(getRootNode, element, []) === doc;
          },
          disconnect: () => { active = false; apply(disconnect, observer, []); },
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
