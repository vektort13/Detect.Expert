// Same-origin child realm manager; the extension bootstrap controls activation.
// REQ-001/003/004/005/011/012, ADR-004/006: parent-owned wrappers for same-origin child realms whose
// own MAIN bootstrap cannot execute. The child's ISOLATED collector still owns its browser sender identity.
// Announcements and synthetic metadata events are page-controlled routing, never authentication.

import { BUDGETS, CHANNEL, validateBridgeMessage } from '@detect-expert/contracts';
import { installCanvasSensor } from './canvas';
import { SensorRuntime } from './runtime';
import type { RuntimeEnv } from './runtime';
import { mapForEach, mapSize } from './intrinsics';
import { createHookContext, wrapGetter } from './wrap';

export const CHILD_REALM_CHANNEL = 'detect.expert/child-realm/v1';
const SENSOR_MARK = Symbol.for('detect.expert/sensor/v1');
const apply = Reflect.apply;
const define = Object.defineProperty;
const descriptor = Object.getOwnPropertyDescriptor;
const create = Object.create;
const functionSource = Function.prototype.call.bind(Function.prototype.toString) as (fn: Function) => string;
const includes = Function.prototype.call.bind(String.prototype.includes) as (text: string, part: string) => boolean;
const getPrototype = Object.getPrototypeOf;
const NO_ARGS: readonly unknown[] = Object.freeze([]);
const MapCtor = Map;
const mapGet = Function.prototype.call.bind(Map.prototype.get) as <K, V>(map: Map<K, V>, key: K) => V | undefined;
const mapSet = Function.prototype.call.bind(Map.prototype.set) as <K, V>(map: Map<K, V>, key: K, value: V) => void;
const mapDelete = Function.prototype.call.bind(Map.prototype.delete) as <K, V>(map: Map<K, V>, key: K) => void;
const mapClear = Function.prototype.call.bind(Map.prototype.clear) as <K, V>(map: Map<K, V>) => void;

export interface ChildRealmManager {
  readonly size: number;
  stop(): void;
}
export type ChildRealmInstaller = (runtime: SensorRuntime, realm: object) => void;

interface ChildRecord {
  window: object;
  document: object;
  index: number;
  runtime: SensorRuntime | null;
  active: boolean;
  retiring: boolean;
  listeners: Map<(event: unknown) => void, { type: string; callback: (event: unknown) => void }>;
}

function native(value: unknown): Function {
  if (typeof value !== 'function' || !includes(functionSource(value), '[native code]')) throw new Error('child realm environment unavailable');
  return value;
}

function ownData(object: object, key: PropertyKey): unknown {
  const found = descriptor(object, key);
  return found && descriptor(found, 'value') ? found.value : undefined;
}

function nativeMember(object: object, key: string): Function {
  let current: object | null = object;
  for (let depth = 0; current !== null && depth < 16; depth++) {
    const found = descriptor(current, key);
    if (found) return native(ownData(found, 'value'));
    current = getPrototype(current);
  }
  throw new Error('child realm environment unavailable');
}

/**
 * Installs a bounded listener in the parent. The immediate child's isolated bridge announces itself via
 * parent.postMessage(CHILD_REALM_CHANNEL, '*'). No canvas calls are made; primitive data invokes no getters.
 * The caller must stop this manager whenever it locally stops the parent sensor; bridge controls also stop it.
 */
export function startChildRealmManager(
  parentRuntime: SensorRuntime,
  parentWindow: Window & typeof globalThis = window,
  installForRealm: ChildRealmInstaller = (runtime, realm) => { installCanvasSensor(runtime, realm); },
): ChildRealmManager {
  // The runtime validated/captured this environment before installing any hooks. Recapturing now
  // would reject our own Performance.now wrapper and silently disable the sandbox fallback.
  const parentEnv = parentRuntime.visualEnv;
  if (parentEnv.self !== parentWindow) throw new Error('child realm parent environment mismatch');
  // Window.document is an unforgeable own accessor. Applying this captured native getter brands the
  // event source as a genuine Window and enforces the same-origin check, without a page-supplied getter.
  const documentDescriptor = descriptor(parentWindow, 'document');
  if (!documentDescriptor || documentDescriptor.configurable !== false) throw new Error('child realm identity unavailable');
  const getDocument = native(ownData(documentDescriptor, 'get'));
  const add = nativeMember(parentWindow, 'addEventListener');
  const remove = nativeMember(parentWindow, 'removeEventListener');
  const dispatch = nativeMember(parentWindow, 'dispatchEvent');
  const MessageEventCtor = native(ownData(parentWindow, 'MessageEvent')) as typeof MessageEvent;
  const transitionEvent = native(ownData(parentWindow, 'PageTransitionEvent'));
  const transitionPrototype = ownData(transitionEvent, 'prototype') as object;
  const getPersisted = native(ownData(descriptor(transitionPrototype, 'persisted')!, 'get'));
  const clone = nativeMember(parentWindow, 'structuredClone');
  const children = new MapCtor<object, ChildRecord>();
  let stopped = false;
  let stopping = false;

  // Window.parent is replaceable. Numeric own data descriptors prove direct membership without calling
  // it, contentDocument, defaultView, frameElement or any other extra page-visible DOM getter.
  const childIndex = (source: object, hint = -1): number => {
    if (hint >= 0 && ownData(parentWindow, '' + hint) === source) return hint;
    for (let i = 0; i < BUDGETS.maxOutOfOrderEntriesGlobal; i++) if (ownData(parentWindow, '' + i) === source) return i;
    return -1;
  };

  const closingDocument = (event: unknown): boolean => {
    if (typeof event !== 'object' || event === null) return false;
    try {
      const trusted = descriptor(event, 'isTrusted');
      return trusted?.configurable === false && apply(native(ownData(trusted, 'get')), event, NO_ARGS) === true &&
        apply(getPersisted, event, NO_ARGS) === false;
    } catch { return false; }
  };

  const current = (record: ChildRecord): boolean => {
    if (!record.active || stopped) return false;
    try {
      if (apply(getDocument, record.window, NO_ARGS) !== record.document) return false;
      record.index = childIndex(record.window, record.index);
      return record.index >= 0;
    }
    catch { return false; }
  };

  const retire = (record: ChildRecord, finalDiagnostic = false): void => {
    if (!record.active || record.retiring) return;
    record.retiring = true;
    // Explicit parent stop may report loss through the still-current child collector. Navigation or
    // WindowProxy reuse always disables transport first, before stop's final flush can reach a new doc.
    if (finalDiagnostic && current(record)) {
      try { record.runtime?.stop('local'); } catch { /* Final diagnostic is best effort. */ }
    }
    // Disable transport before stop's final flush; a reused WindowProxy must never receive old counters.
    record.active = false;
    mapDelete(children, record.window);
    try { record.runtime?.stop('local'); } catch { /* Cleanup cannot affect page behavior. */ }
    mapForEach(record.listeners, (listener) => {
      try { apply(remove, record.window, [listener.type, listener.callback]); } catch { /* Old document may be inaccessible. */ }
    });
    mapClear(record.listeners);
  };

  const manager: ChildRealmManager = {
    get size() { return mapSize(children); },
    stop() {
      if (stopped || stopping) return;
      stopping = true;
      parentEnv.removeEventListener('message', onMessage);
      parentEnv.removeEventListener('pagehide', onPageHide);
      mapForEach(children, (record) => retire(record, true));
      stopped = true;
    },
  };

  const install = (source: object): void => {
    if (source === parentWindow || stopped || stopping) return;
    const old = mapGet(children, source);
    if (old && current(old)) return;
    if (old) retire(old);
    mapForEach(children, (record) => { if (!current(record)) retire(record); });
    if (mapSize(children) >= BUDGETS.maxOutOfOrderEntriesGlobal) { parentRuntime.addFlag('budget-exceeded'); return; }
    const childDocument = apply(getDocument, source, NO_ARGS) as unknown;
    const index = childIndex(source);
    if (typeof childDocument !== 'object' || childDocument === null || index < 0) return;
    if (descriptor(source, SENSOR_MARK) !== undefined) return;
    const record: ChildRecord = { window: source, document: childDocument, index, runtime: null, active: true, retiring: false, listeners: new MapCtor() };
    const childEnv: RuntimeEnv = {
      self: source,
      startedLate: true,
      earlyCaptureGuaranteed: false,
      now: parentEnv.now,
      randomBytes: parentEnv.randomBytes,
      clearTimeout: parentEnv.clearTimeout,
      readMessage: parentEnv.readMessage,
      setTimeout(callback, ms) {
        return parentEnv.setTimeout(() => {
          if (!current(record)) { retire(record); return; }
          callback();
        }, ms);
      },
      addEventListener(type, listener) {
        const wrapped = (event: unknown): void => {
          if (!current(record)) { retire(record); return; }
          let childStop = false;
          if (type === 'message' && typeof event === 'object' && event !== null) {
            try {
              const message = parentEnv.readMessage(event);
              if (message.source === source && typeof message.data === 'object' && message.data !== null && ownData(message.data, 'channel') === CHANNEL) {
                const parsed = validateBridgeMessage(message.data);
                if (parsed.ok && parsed.value.sensorBootId === record.runtime?.sensorBootId) {
                  childStop = parsed.value.type === 'bridge-stop';
                }
              }
            } catch { return; }
          }
          listener(event);
          if (childStop || (type === 'pagehide' && closingDocument(event))) retire(record);
        };
        mapSet(record.listeners, listener, { type, callback: wrapped });
        apply(add, source, [type, wrapped]);
      },
      removeEventListener(type, listener) {
        const wrapped = mapGet(record.listeners, listener);
        if (!wrapped) return;
        apply(remove, source, [type, wrapped.callback]);
        mapDelete(record.listeners, listener);
      },
      postMessage(message) {
        if (!current(record)) { retire(record); return; }
        // Only the existing bounded metadata leaves SensorRuntime. Use a fresh structured clone before
        // synchronous dispatch; the synthetic source is routing and grants no SW or browser identity.
        const data = apply(clone, parentWindow, [message]) as unknown;
        const event = new MessageEventCtor('message', { source: source as Window, data });
        apply(dispatch, source, [event]);
      },
    };
    const guard = create(null) as PropertyDescriptor;
    guard.value = true;
    guard.writable = false;
    guard.enumerable = false;
    guard.configurable = false;
    mapSet(children, source, record);
    try {
      define(source, SENSOR_MARK, guard);
      const runtime = new SensorRuntime(childEnv);
      record.runtime = runtime;
      // Announcement is asynchronous; earlier calls in this child were outside this capture window.
      runtime.addFlag('hook-failed');
      installForRealm(runtime, source);
      runtime.start();
    } catch {
      retire(record);
      parentRuntime.addFlag('hook-failed');
    }
  };

  function onMessage(event: unknown): void {
    try {
      if (stopped || typeof event !== 'object' || event === null) return;
      const { source, data } = parentEnv.readMessage(event);
      if (source === parentWindow && typeof data === 'object' && data !== null && ownData(data, 'channel') === CHANNEL) {
        const parsed = validateBridgeMessage(data);
        if (!parsed.ok || parsed.value.sensorBootId !== parentRuntime.sensorBootId) return;
        if (parsed.value.type === 'bridge-stop') manager.stop();
        // Pause/resume are document-specific: only this child's own collector controls its observer.
        return;
      }
      if (typeof source !== 'object' || source === null || data !== CHILD_REALM_CHANNEL) return;
      install(source);
    } catch { /* A forged announcement or cross-origin source never escapes the listener. */ }
  }
  function onPageHide(event: unknown): void { if (closingDocument(event)) manager.stop(); }
  // Cached site scripts may read the child's API before its asynchronous announcement is delivered.
  // Observe only the ORIGINAL iframe getter return that the page itself requested, synchronously.
  // Numeric Window descriptors plus the captured unforgeable document getter avoid extra page getters.
  const iframeConstructor = ownData(parentWindow, 'HTMLIFrameElement');
  const iframePrototype = typeof iframeConstructor === 'function' ? ownData(iframeConstructor, 'prototype') : null;
  if (typeof iframePrototype === 'object' && iframePrototype !== null) {
    const context = createHookContext();
    const windowHook = wrapGetter(iframePrototype, 'contentWindow', (_receiver, threw, _error, result) => {
      if (!threw && typeof result === 'object' && result !== null) install(result);
    }, { context });
    const documentHook = wrapGetter(iframePrototype, 'contentDocument', (_receiver, threw, _error, result) => {
      if (threw || typeof result !== 'object' || result === null) return;
      for (let index = 0; index < BUDGETS.maxOutOfOrderEntriesGlobal; index++) {
        const child = ownData(parentWindow, '' + index);
        if (typeof child !== 'object' || child === null) continue;
        try { if (apply(getDocument, child, NO_ARGS) === result) { install(child); return; } } catch { /* Different origin. */ }
      }
    }, { context });
    parentRuntime.attach([windowHook, documentHook]);
  }
  parentRuntime.onStop(manager.stop);
  parentEnv.addEventListener('message', onMessage);
  parentEnv.addEventListener('pagehide', onPageHide);
  return manager;
}
