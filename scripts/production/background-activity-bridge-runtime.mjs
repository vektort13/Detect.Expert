// REQ-001/004/005/011/012: isolated native read-only origin inventory.
import { createBackgroundActivityContracts } from '../../packages/contracts/src/background-activity.mjs';
import { createBackgroundResourceRedactor } from './background-activity-runtime.mjs';

export function createBackgroundInventoryReader(realm, redact, trustedNatives = false) {
  const descriptor = Object.getOwnPropertyDescriptor, apply = Reflect.apply, getPrototype = Object.getPrototypeOf;
  const fnString = Function.prototype.toString, exec = RegExp.prototype.exec;
  const native = value => { try { return typeof value === 'function' && (trustedNatives || apply(exec, /\[native code\]/, [apply(fnString, value, [])]) !== null); } catch { return false; } };
  const own = (value, key) => { try { return value && descriptor(value, key)?.value; } catch { return undefined; } };
  const getter = (target, key) => { try { for (let depth = 0; target && depth < 8; target = getPrototype(target), ++depth) { const value = descriptor(target, key); if (value) return native(value.get) ? value.get : null; } } catch { /* Inaccessible native surface. */ } return null; };
  const method = (target, key) => { const value = own(target, key); return native(value) ? value : null; };
  const read = (fn, receiver) => { try { return fn ? apply(fn, receiver, []) : null; } catch { return null; } };
  const root = key => {
    try {
      for (let target = realm, depth = 0; target && depth < 8; target = getPrototype(target), ++depth) {
        const value = descriptor(target, key);
        if (value) return Object.hasOwn(value, 'value') ? value.value : native(value.get) ? read(value.get, realm) : null;
      }
    } catch { /* Inaccessible isolated global. */ }
    return null;
  };
  // Firefox Xray globals expose WebIDL constructors on an inherited native global.
  // Only the trusted isolated global is inspected; argument/option objects are opaque.
  const constructors = new Map();
  const constructor = name => { if (!constructors.has(name)) constructors.set(name, root(name)); return constructors.get(name); };
  const prototype = name => own(constructor(name), 'prototype');
  const navigator = root('navigator'), notification = constructor('Notification'), secureContext = root('isSecureContext') === true;
  const document = root('document'), documentURL = getter(prototype('Document'), 'URL');
  const NativeURL = constructor('URL') ?? own(globalThis, 'URL'), originGetter = NativeURL && getter(own(NativeURL, 'prototype'), 'origin');
  const origin = raw => { try { return typeof raw === 'string' && native(NativeURL) && originGetter ? apply(originGetter, new NativeURL(raw), []) : null; } catch { return null; } };
  const documentOrigin = origin(read(documentURL, document));
  const container = read(getter(prototype('Navigator'), 'serviceWorker'), navigator);
  const permissions = read(getter(prototype('Navigator'), 'permissions'), navigator);
  const getRegistrations = method(prototype('ServiceWorkerContainer'), 'getRegistrations'), query = method(prototype('Permissions'), 'query');
  const state = getter(prototype('PermissionStatus'), 'state'), notificationPermission = getter(notification, 'permission');
  const registrationPrototype = prototype('ServiceWorkerRegistration');
  const scope = getter(registrationPrototype, 'scope'), active = getter(registrationPrototype, 'active'), waiting = getter(registrationPrototype, 'waiting'), installing = getter(registrationPrototype, 'installing');
  const pushManager = getter(registrationPrototype, 'pushManager'), sync = getter(registrationPrototype, 'sync'), periodic = getter(registrationPrototype, 'periodicSync');
  const workerURL = getter(prototype('ServiceWorker'), 'scriptURL'), workerState = getter(prototype('ServiceWorker'), 'state');
  const getSubscription = method(prototype('PushManager'), 'getSubscription'), getSyncTags = method(prototype('SyncManager'), 'getTags'), getPeriodicTags = method(prototype('PeriodicSyncManager'), 'getTags');
  const supported = { serviceWorker: secureContext && !!container && !!getRegistrations, push: !!pushManager && !!getSubscription, sync: !!sync && !!getSyncTags, periodicSync: !!periodic && !!getPeriodicTags };
  const now = Date.now;
  const empty = () => ({ status: supported.serviceWorker ? 'unavailable' : 'unsupported', secureContext, supported: { ...supported }, permissions: { notifications: notificationPermission ? 'unknown' : 'unsupported', push: supported.push ? 'unknown' : 'unsupported', sync: supported.sync ? 'unknown' : 'unsupported', periodicSync: supported.periodicSync ? 'unknown' : 'unsupported' }, registrationCount: null, pushSubscriptionCount: null, syncTagCount: null, periodicTagCount: null, registrations: [], truncated: false, checkedAt: 0 });
  let physical = null;
  async function inspect() {
    const output = empty(); output.checkedAt = now();
    if (!supported.serviceWorker) return output;
    const nativeNotification = read(notificationPermission, notification);
    output.permissions.notifications = nativeNotification === 'default' ? 'prompt' : ['granted', 'denied'].includes(nativeNotification) ? nativeNotification : notificationPermission ? 'unknown' : 'unsupported';
    const permission = async (name, available) => {
      if (!available) return 'unsupported';
      if (!query || !permissions || !state) return 'unknown';
      try { const status = await apply(query, permissions, [{ name }]), value = read(state, status); return ['granted', 'denied', 'prompt'].includes(value) ? value : 'unknown'; } catch { return 'unknown'; }
    };
    const results = await Promise.all([permission('push', supported.push), permission('background-sync', supported.sync), permission('periodic-background-sync', supported.periodicSync)]);
    [output.permissions.push, output.permissions.sync, output.permissions.periodicSync] = results;
    let registrations;
    try { registrations = await apply(getRegistrations, container, []); } catch { return output; }
    const length = Array.isArray(registrations) ? descriptor(registrations, 'length')?.value : null;
    if (!Number.isSafeInteger(length) || length < 0) return output;
    output.status = 'available'; output.registrationCount = Math.min(4096, length); output.truncated = length > 16;
    output.pushSubscriptionCount = supported.push ? 0 : null; output.syncTagCount = supported.sync ? 0 : null; output.periodicTagCount = supported.periodicSync ? 0 : null;
    const tagCount = async (fn, manager) => {
      if (!fn || !manager) return null;
      try { const tags = await apply(fn, manager, []), count = Array.isArray(tags) ? descriptor(tags, 'length')?.value : null; if (!Number.isSafeInteger(count) || count < 0) return null; if (count > 4096) output.truncated = true; return Math.min(4096, count); } catch { return null; }
    };
    for (let index = 0; index < Math.min(16, length); ++index) {
      const registration = descriptor(registrations, index)?.value;
      const rawScope = read(scope, registration), redactedScope = redact(rawScope, undefined, 'scope');
      if (!documentOrigin || origin(rawScope) !== documentOrigin) { output.truncated = true; continue; }
      if (!redactedScope) { output.truncated = true; continue; }
      const worker = read(active, registration) ?? read(waiting, registration) ?? read(installing, registration);
      const redactedScript = worker ? redact(read(workerURL, worker), undefined, 'worker') : null;
      const nativeState = worker ? read(workerState, worker) : null;
      const item = { scope: redactedScope, script: redactedScript, state: ['activated', 'installing', 'installed', 'activating', 'redundant'].includes(nativeState) ? nativeState : 'unknown', pushSubscribed: null, syncTagCount: null, periodicTagCount: null };
      if (supported.push) try { item.pushSubscribed = (await apply(getSubscription, read(pushManager, registration), [])) !== null; } catch { /* Unavailable remains null. */ }
      [item.syncTagCount, item.periodicTagCount] = await Promise.all([tagCount(getSyncTags, read(sync, registration)), tagCount(getPeriodicTags, read(periodic, registration))]);
      for (const [total, count] of [['pushSubscriptionCount', item.pushSubscribed === null ? null : item.pushSubscribed ? 1 : 0], ['syncTagCount', item.syncTagCount], ['periodicTagCount', item.periodicTagCount]]) output[total] = output[total] === null || count === null ? null : output[total] + count;
      output.registrations.push(item);
    }
    if (output.registrations.length !== length) { output.pushSubscriptionCount = null; output.syncTagCount = null; output.periodicTagCount = null; }
    return output;
  }
  return { empty, supported: { ...supported }, read() {
    if (physical) return Promise.resolve({ ...empty(), truncated: true });
    const job = inspect(); physical = job;
    const release = () => { if (physical === job) physical = null; }; job.then(release, release);
    return job;
  } };
}

export function startBackgroundValuesBridge(env, contracts, inventoryReader) {
  const descriptor = Object.getOwnPropertyDescriptor, ownKeys = Reflect.ownKeys, hasOwn = Object.hasOwn;
  const field = (value, key) => value && typeof value === 'object' ? descriptor(value, key)?.value : undefined;
  const exact = (value, names) => value && typeof value === 'object' && !Array.isArray(value) && ownKeys(value).length === names.length && names.every(name => hasOwn(descriptor(value, name) ?? {}, 'value'));
  let pending = null, sequence = 0, nextReadAt = -Infinity, active = true;
  const unavailable = () => ({ schemaVersion: 1, type: 'background-values-cache', available: false, rows: [], truncated: true, inventory: inventoryReader.empty() });
  const finish = current => {
    if (!active || pending !== current || !current.pageDone || !current.inventoryDone) return;
    pending = null; env.cancel(current.pageTimer); env.cancel(current.inventoryTimer); nextReadAt = env.now() + 500;
    current.respond({ schemaVersion: 1, type: 'background-values-cache', available: current.available, rows: current.rows, truncated: current.truncated, inventory: current.inventory });
  };
  env.onPage((sameWindow, data) => {
    const current = pending;
    if (!sameWindow || !current || !current.posted || current.pageDone || current.admitted++ >= 8 || !exact(data, ['channel', 'type', 'requestId', 'enabled', 'rows', 'truncated']) || field(data, 'channel') !== 'detect.expert/background/v1' || field(data, 'type') !== 'background-values-batch' || field(data, 'requestId') !== current.requestId || typeof field(data, 'enabled') !== 'boolean' || typeof field(data, 'truncated') !== 'boolean') return;
    const rows = contracts.readRows(field(data, 'rows')); if (!rows || JSON.stringify(rows).length > 12000) return;
    current.available = field(data, 'enabled'); current.rows = current.available ? rows : []; current.truncated = field(data, 'truncated') || !current.available; current.pageDone = true; finish(current);
  });
  env.onCommand((trusted, data, respond) => {
    if (!trusted || !exact(data, ['schemaVersion', 'type', 'refresh']) || field(data, 'schemaVersion') !== 1 || field(data, 'type') !== 'background-values-query' || typeof field(data, 'refresh') !== 'boolean') return false;
    if (!active || pending || sequence >= 2147483647) { respond(unavailable()); return false; }
    const current = { requestId: 'background-' + ++sequence, respond, admitted: 0, posted: false, pageDone: false, inventoryDone: !field(data, 'refresh'), available: false, rows: [], truncated: true, inventory: inventoryReader.empty(), pageTimer: null, inventoryTimer: null };
    pending = current;
    if (field(data, 'refresh')) {
      current.inventoryTimer = env.later(() => { current.inventoryDone = true; current.inventory = { ...inventoryReader.empty(), truncated: true }; finish(current); }, 1000);
      Promise.resolve().then(() => inventoryReader.read()).then(value => {
        if (!active || pending !== current || current.inventoryDone) return;
        const inventory = contracts.readInventory(value); current.inventoryDone = true; env.cancel(current.inventoryTimer);
        current.inventory = inventory ?? { ...inventoryReader.empty(), truncated: true }; finish(current);
      }, () => { if (!active || pending !== current || current.inventoryDone) return; current.inventoryDone = true; current.inventory = { ...inventoryReader.empty(), truncated: true }; finish(current); });
    }
    const post = () => { if (!active || pending !== current) return; current.posted = true; current.pageTimer = env.later(() => { current.pageDone = true; finish(current); }, 400); env.post({ channel: 'detect.expert/background/v1', type: 'background-values-read', requestId: current.requestId }); };
    const delay = Math.max(0, nextReadAt - env.now()); if (delay) current.pageTimer = env.later(post, delay); else post();
    return true;
  });
  env.onHide(() => { active = false; const current = pending; pending = null; if (current) { env.cancel(current.pageTimer); env.cancel(current.inventoryTimer); current.respond(unavailable()); } });
  env.onShow?.(() => { active = true; });
}

export const backgroundBridgeRuntimeSource = '  // packages/collector/src/background-activity.ts\n  var backgroundBridgeContracts = (' + createBackgroundActivityContracts.toString() + ')();\n  var backgroundBridgeRedactor = (' + createBackgroundResourceRedactor.toString() + ')();\n  var createBackgroundInventoryReader = (' + createBackgroundInventoryReader.toString() + ');\n  var startBackgroundValuesBridge = (' + startBackgroundValuesBridge.toString() + ');\n  function startBrowserBackgroundValuesBridge() {\n    startBackgroundValuesBridge({\n      onPage: listener => window.addEventListener("message", event => listener(event.source === window, event.data)),\n      onCommand: listener => chrome.runtime.onMessage.addListener((message, sender, respond) => listener(isOwnServiceWorker(sender), message, respond)),\n      onHide: listener => window.addEventListener("pagehide", listener), onShow: listener => window.addEventListener("pageshow", listener),\n      post: message => window.postMessage(message, "*"), later: (callback, delay) => setTimeout(callback, delay), cancel: timer => clearTimeout(timer), now: () => performance.now(),\n    }, backgroundBridgeContracts, createBackgroundInventoryReader(globalThis, backgroundBridgeRedactor));\n  }\n  // packages/collector/src/background-activity:end\n\n';
