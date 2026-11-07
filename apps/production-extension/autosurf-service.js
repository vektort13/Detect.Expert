// ADR-075: an exact top-level Options port and a dedicated local database.
import { AUTOSURF_PORT, AUTOSURF_SESSION_KEY, AUTOSURF_LIMITS, autosurfFail, autosurfSafeCode, isAutosurfUiSender, validateAutosurfCommand, validateAutosurfConfiguration } from './autosurf-shared.js';
import { createAutosurfController } from './autosurf-controller.js';
import { createAutosurfDriver } from './autosurf-driver.js';
import { createAutosurfMetrics } from './autosurf-metrics.js';

export function createAutosurfStorage(api, { env = globalThis } = {}) {
  let database = null, opening = null, transaction = null, sessionJob = null, closed = false;
  const schedule = env.setTimeout?.bind(env) ?? setTimeout, cancel = env.clearTimeout?.bind(env) ?? clearTimeout;
  function bounded(promise, abort = null) { let timer; return Promise.race([promise, new Promise((_, reject) => { timer = schedule(() => { try { abort?.(); } catch {} reject(Object.assign(new Error('storage-unavailable'), { code: 'storage-unavailable' })); }, AUTOSURF_LIMITS.nativeMs); })]).finally(() => cancel(timer)); }
  async function open() {
    if (closed || !env.indexedDB) autosurfFail('storage-unavailable');
    if (database) return database;
    if (!opening) {
      const pending = new Promise((resolve, reject) => {
        let request; try { request = env.indexedDB.open('detect-expert-autosurf', 1); } catch { reject(new Error('storage-unavailable')); return; }
        request.onupgradeneeded = () => { const db = request.result; if (!db.objectStoreNames.contains('workspace')) db.createObjectStore('workspace'); };
        request.onerror = () => reject(new Error('storage-unavailable'));
        request.onblocked = () => { /* The timeout exposes a factual unavailable state; no other DB is removed. */ };
        request.onsuccess = () => { const db = request.result; if (closed) { db.close(); reject(new Error('storage-unavailable')); return; } database = db; db.onversionchange = () => { db.close(); if (database === db) database = null; }; resolve(db); };
      });
      opening = pending; pending.then(() => { if (opening === pending) opening = null; }, () => { if (opening === pending) opening = null; });
    }
    return bounded(opening);
  }
  async function access(mode, action) {
    const db = await open(); if (closed || transaction) autosurfFail(transaction ? 'busy' : 'storage-unavailable');
    let native;
    const pending = new Promise((resolve, reject) => {
      try { native = db.transaction('workspace', mode); transaction = native; const request = action(native.objectStore('workspace')); let result;
        request.onsuccess = () => { result = request.result; };
        native.oncomplete = () => { if (transaction === native) transaction = null; resolve(result); };
        native.onerror = native.onabort = () => { if (transaction === native) transaction = null; reject(new Error('storage-unavailable')); };
      } catch { if (transaction === native) transaction = null; reject(new Error('storage-unavailable')); }
    });
    return bounded(pending, () => native?.abort());
  }
  async function session(action) {
    if (closed || sessionJob) autosurfFail(closed ? 'storage-unavailable' : 'busy');
    const pending = Promise.resolve().then(action); sessionJob = pending;
    pending.then(() => { if (sessionJob === pending) sessionJob = null; }, () => { if (sessionJob === pending) sessionJob = null; });
    return bounded(pending);
  }
  return {
    loadConfiguration: () => access('readonly', store => store.get('configuration')),
    saveConfiguration: value => access('readwrite', store => store.put(validateAutosurfConfiguration(value), 'configuration')),
    loadLastReport: () => access('readonly', store => store.get('last-report')),
    saveLastReport: value => access('readwrite', store => store.put(structuredClone(value), 'last-report')),
    async loadCheckpoint() { return (await session(() => api.storage.session.get(AUTOSURF_SESSION_KEY)))[AUTOSURF_SESSION_KEY]; },
    async saveCheckpoint(value) { await session(() => api.storage.session.set({ [AUTOSURF_SESSION_KEY]: value })); },
    async clearCheckpoint() { await session(() => api.storage.session.remove(AUTOSURF_SESSION_KEY)); },
    dispose() { closed = true; try { transaction?.abort(); } catch {} database?.close(); database = null; },
  };
}

export function installAutosurfService(api = globalThis.chrome, { env = globalThis, storage: suppliedStorage = null, driver: suppliedDriver = null, metrics: suppliedMetrics = null, now = Date.now } = {}) {
  const ports = new Map(); let disposed = false, controller;
  const storage = suppliedStorage ?? createAutosurfStorage(api, { env });
  const driver = suppliedDriver ?? createAutosurfDriver(api, { now, onDetach: details => controller?.debuggerDetached(details) });
  const metrics = suppliedMetrics ?? createAutosurfMetrics(api, { now });
  const broadcast = snapshot => { for (const port of ports.keys()) { try { port.postMessage({ v: 1, type: 'snapshot', snapshot }); } catch {} } };
  controller = createAutosurfController(api, { storage, driver, metrics, now, env, onChange: broadcast });
  const connected = port => {
    if (port.name !== AUTOSURF_PORT) return;
    if (disposed || !isAutosurfUiSender(api, port.sender) || ports.size >= AUTOSURF_LIMITS.ports) { try { port.disconnect(); } catch {} return; }
    const pending = new Set(); ports.set(port, pending);
    port.onDisconnect.addListener(() => ports.delete(port));
    port.onMessage.addListener(raw => {
      if (disposed || !ports.has(port)) return;
      let message;
      try { message = validateAutosurfCommand(raw); } catch { try { port.disconnect(); } catch {} return; }
      if (pending.has(message.id) || pending.size >= 2) { try { port.postMessage({ v: 1, id: message.id, ok: false, error: { code: 'busy' } }); } catch {} return; }
      pending.add(message.id);
      controller.command(message.op, message.payload).then(value => {
        if (!ports.has(port) || disposed) return;
        try { port.postMessage({ v: 1, id: message.id, ok: true, ...(message.op === 'export' ? { result: value } : { snapshot: value }) }); } catch {}
      }, error => {
        if (!ports.has(port) || disposed) return;
        try { port.postMessage({ v: 1, id: message.id, ok: false, error: { code: autosurfSafeCode(error) }, snapshot: controller.snapshot() }); } catch {}
      }).finally(() => pending.delete(message.id));
    });
  };
  // Registered synchronously, before the controller's first storage read resolves.
  api.runtime.onConnect.addListener(connected);
  return { ready: controller.ready, snapshot: controller.snapshot, controller, async dispose() { if (disposed) return; disposed = true; api.runtime.onConnect.removeListener?.(connected); for (const port of ports.keys()) { try { port.disconnect(); } catch {} } ports.clear(); await controller.dispose(); await driver.dispose?.(); storage.dispose?.(); } };
}
