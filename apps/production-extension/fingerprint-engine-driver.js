// ADR-101: fixed native commands on a service-owned, newly created blank tab.
import { readFingerprintWorkerSource } from './fingerprint-engine-worker.js';

export const FINGERPRINT_ENGINE_DRIVER_LIMITS = Object.freeze({ timeoutMs: 4000, maxWorkers: 64, maxQueue: 32, maxPending: 32, maxCleanupSessions: 128 });
const AUTO = Object.freeze({ autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{ type: 'worker', exclude: false }, { exclude: true }] });
const PAUSELESS = Object.freeze({ ...AUTO, waitForDebuggerOnStart: false });
const turn = () => new Promise(resolve => { const channel = new MessageChannel(); channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); }; channel.port2.postMessage(0); });
const UNSUPPORTED = Object.freeze(['shared-worker', 'service-worker', 'worklet']);
const PARAMS = Object.freeze({
  'Emulation.setDeviceMetricsOverride': ['width', 'height', 'deviceScaleFactor', 'mobile', 'screenWidth', 'screenHeight', 'screenOrientation'],
  'Emulation.setEmulatedMedia': ['features'], 'Emulation.setLocaleOverride': ['locale'],
  'Emulation.setTimezoneOverride': ['timezoneId'], 'Emulation.setHardwareConcurrencyOverride': ['hardwareConcurrency'],
  'Emulation.setUserAgentOverride': ['userAgent', 'platform', 'acceptLanguage', 'userAgentMetadata'],
  'Emulation.clearDeviceMetricsOverride': [],
});
const RESET = new Set(['Emulation.clearDeviceMetricsOverride', 'Emulation.setEmulatedMedia', 'Emulation.setLocaleOverride', 'Emulation.setTimezoneOverride', 'Emulation.setUserAgentOverride']);
const ERRORS = new Set(['invalid-profile', 'invalid-worker-source', 'session-busy', 'session-stale', 'native-timeout', 'native-error', 'native-busy', 'detach-failed', 'worker-out-of-scope', 'worker-bootstrap-failed']);
const own = (value, key) => value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
const current = check => { try { return typeof check === 'function' && check() === true; } catch { return false; } };
const failure = code => Object.assign(new Error(code), { code });
function data(value, depth = 0, budget = { remaining: 4096 }) {
  if (--budget.remaining < 0 || depth > 12) throw failure('invalid-profile');
  if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && value.length <= 2048) return value;
  if (!value || typeof value !== 'object') throw failure('invalid-profile');
  const array = Array.isArray(value), result = array ? [] : {};
  for (const key of Reflect.ownKeys(value)) {
    if (array && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || key === '__proto__' || !descriptor || !Object.hasOwn(descriptor, 'value')) throw failure('invalid-profile');
    Object.defineProperty(result, key, { value: data(descriptor.value, depth + 1, budget), enumerable: true, writable: false, configurable: false });
  }
  return Object.freeze(result);
}
function plan(value) {
  const commands = own(value, 'commands'), resets = own(value, 'resetCommands');
  if (own(value, 'ok') !== true || !Array.isArray(commands) || commands.length > 6 || !Array.isArray(resets) || resets.length > 5) throw failure('invalid-profile');
  const read = (rows, reset) => {
    const result = [];
    for (let index = 0; index < rows.length; index++) {
      const row = own(rows, String(index)), method = own(row, 'method');
      if (typeof method !== 'string' || !Object.hasOwn(PARAMS, method) || reset && !RESET.has(method)) throw failure('invalid-profile');
      const params = data(own(row, 'params'));
      if (!params || Array.isArray(params) || Reflect.ownKeys(params).some(key => !PARAMS[method].includes(key))) throw failure('invalid-profile');
      if (reset && method === 'Emulation.setUserAgentOverride' && (Reflect.ownKeys(params).length !== 1 || own(params, 'userAgent') !== '')) throw failure('invalid-profile');
      result.push(Object.freeze({ method, params }));
    }
    return result;
  };
  return { commands: read(commands, false), resets: read(resets, true), partial: own(value, 'status') === 'partial' };
}

export function createFingerprintEngineDriver(api, { onChange = () => {}, onDetach = () => {}, allowTarget = () => false } = {}) {
  let owned = null, disposed = false, operation = null, lastError = null, unsubscribed = false;
  const physical = new Set();
  const supported = () => !disposed && ['attach', 'detach', 'sendCommand'].every(key => typeof api?.debugger?.[key] === 'function') && typeof api?.debugger?.onEvent?.addListener === 'function' && typeof api?.debugger?.onDetach?.addListener === 'function';
  const valid = record => owned === record && !record.stopping && !disposed && current(record.isCurrent);
  const snapshot = () => Object.freeze({ status: owned ? owned.stopping ? owned.cleanupFinished ? 'unavailable' : 'stopping' : owned.starting ? 'starting' : owned.partial ? 'partial' : 'ready' : lastError ? 'unavailable' : 'idle', attached: owned?.attached === true, workerCount: owned?.workers.size ?? 0, bootstrappedWorkers: owned?.bootstrapped ?? 0, unsupported: UNSUPPORTED, error: lastError });
  function publish() { try { onChange(snapshot()); } catch {} }
  function release(record) { record.attached = false; record.workers.clear(); record.waiters.clear(); record.source = null; if (owned === record) owned = null; maybeUnsubscribe(); }
  function maybeUnsubscribe() { if (!disposed || owned || physical.size || unsubscribed) return; unsubscribed = true; api?.debugger?.onEvent?.removeListener?.(events); api?.debugger?.onDetach?.removeListener?.(detached); api?.tabs?.onRemoved?.removeListener?.(removed); }
  async function deadline(work) {
    let timer;
    try { return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(failure('native-timeout')), FINGERPRINT_ENGINE_DRIVER_LIMITS.timeoutMs); })]); }
    finally { clearTimeout(timer); }
  }
  async function bounded(action, late = null, priority = false) {
    // A logical timeout cannot cancel Chrome's physical command. Retain its slot
    // until actual completion, including across Stop and a later start attempt.
    if (physical.size >= FINGERPRINT_ENGINE_DRIVER_LIMITS.maxPending - (priority ? 0 : 2)) throw failure('native-busy');
    let expired = false, timer;
    const slot = {}; physical.add(slot);
    const work = Promise.resolve().then(action);
    work.then(value => { physical.delete(slot); if (expired) { try { late?.(value); } catch {} } maybeUnsubscribe(); }, () => { physical.delete(slot); maybeUnsubscribe(); });
    try { return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => { expired = true; reject(failure('native-timeout')); }, FINGERPRINT_ENGINE_DRIVER_LIMITS.timeoutMs); })]); }
    catch (error) { throw ERRORS.has(own(error, 'code')) ? error : failure('native-error'); }
    finally { clearTimeout(timer); }
  }
  const target = (record, sessionId = null) => sessionId === null ? { tabId: record.tabId } : { tabId: record.tabId, sessionId };
  async function send(record, sessionId, method, params = {}, cleanup = false, late = null) {
    if (cleanup && (owned !== record || !record.attached)) throw failure('session-stale');
    if (!cleanup && !valid(record)) throw failure('session-stale');
    const result = await bounded(() => { if (!cleanup && !valid(record)) throw failure('session-stale'); return api.debugger.sendCommand(target(record, sessionId), method, params); }, late, cleanup);
    if (!cleanup && !valid(record)) { try { late?.(result); } catch {} throw failure('session-stale'); }
    return result;
  }
  async function resume(record, worker) {
    if (worker.resumePromise) return worker.resumePromise;
    const resumed = () => { worker.waiting = false; record.waiters.delete(worker.id); };
    worker.resumePromise = (async () => { try { await send(record, worker.id, 'Runtime.runIfWaitingForDebugger', {}, true, resumed); resumed(); } catch { record.partial = true; if (record.stopping && (record.workers.has(worker.id) || record.waiters.has(worker.id))) record.cleanupFailed = true; } finally { worker.resumePromise = null; } })();
    return worker.resumePromise;
  }
  async function restore(record, worker) {
    if (worker.objectId) { try { const result = await send(record, worker.id, 'Runtime.callFunctionOn', { objectId: worker.objectId, functionDeclaration: 'function(){this.stop();}', returnByValue: true }, true); if (own(result, 'exceptionDetails')) throw failure('worker-bootstrap-failed'); worker.objectId = null; } catch { record.partial = true; if (record.workers.has(worker.id) || record.waiters.has(worker.id)) record.cleanupFailed = true; } }
    await resume(record, worker);
  }
  async function detachOwned(record) {
    await bounded(async () => {
      await api.debugger.detach({ tabId: record.tabId });
      record.attached = false;
      // A timed-out physical detach may finish after the logical Stop returned.
      if (record.cleanupFinished) { release(record); publish(); }
    }, null, true);
  }
  function cleanup(record) {
    if (record.cleanupPromise) return record.cleanupPromise;
    const attempt = { cancelled: false }; record.cleanupAttempt = attempt;
    const active = () => !attempt.cancelled && record.cleanupAttempt === attempt && owned === record && record.attached;
    const command = async (sessionId, method, params = {}) => { if (!active()) throw failure('session-stale'); const result = await send(record, sessionId, method, params, true); if (!active()) throw failure('session-stale'); return result; };
    record.cleanupPromise = Promise.resolve().then(async () => {
      for (const worker of [...record.workers.values(), ...record.waiters.values()]) { worker.cleanupHandled = false; worker.url = null; }
      let readyToDetach = false;
      try {
        await deadline((async () => {
          if (!record.attached) return;
          // Preserve existing child sessions while disabling future pauses.
          // autoAttach:false first would discard private restoration handles.
          await command(null, 'Target.setAutoAttach', PAUSELESS);
          let emptyTurns = 0;
          while (active()) {
            const batch = [];
            for (const worker of [...record.workers.values(), ...record.waiters.values()]) {
              if (worker.cleanupHandled) continue;
              worker.cleanupHandled = true; batch.push(worker); if (batch.length === 8) break;
            }
            if (!batch.length) { if (++emptyTurns > 2) break; await turn(); continue; }
            emptyTurns = 0;
            await Promise.all(batch.map(async worker => {
              try { await command(worker.id, 'Target.setAutoAttach', PAUSELESS); } catch { if (active() && (record.workers.has(worker.id) || record.waiters.has(worker.id))) record.cleanupFailed = true; }
              if (active()) await restore(record, worker);
            }));
          }
          if (!active()) return;
          // A bootstrap already physically sent may return its private handle
          // after cancellation. Keep transport until its late restoration settles.
          while ((record.draining || physical.size) && active()) await new Promise(resolve => setTimeout(resolve, 10));
          if (!active()) return;
          if (record.waiters.size || record.cleanupFailed || record.unknownPaused) throw failure('native-timeout');
          record.disablingAutoAttach = true;
          await command(null, 'Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true });
          for (const reset of record.plan.resets) { if (!active()) return; try { await command(null, reset.method, reset.params); } catch { if (active()) record.cleanupFailed = true; } }
          await turn();
          readyToDetach = active() && !record.waiters.size && !physical.size && !record.draining && !record.cleanupFailed && !record.unknownPaused;
        })());
      } catch { attempt.cancelled = true; if (record.cleanupAttempt === attempt) record.cleanupCancelled = true; if (owned === record && record.cleanupAttempt === attempt && !lastError) lastError = 'cleanup-incomplete'; }
      finally {
        if (owned === record && record.cleanupFailed && !lastError) lastError = 'cleanup-incomplete';
        try { if (readyToDetach && active()) await detachOwned(record); } catch { if (owned === record && record.cleanupAttempt === attempt) lastError = 'detach-failed'; }
        record.cleanupFinished = true;
        if (!record.attached && !record.pendingAttach) release(record);
        publish();
      }
      return snapshot();
    });
    return record.cleanupPromise;
  }
  function emergency(record, code) {
    if (record.emergencyPromise) return record.emergencyPromise;
    record.stopping = true; record.partial = true; record.queue.length = 0; lastError = code;
    record.emergencyPromise = cleanup(record);
    publish();
    try { onDetach({ reason: 'driver-failed' }); } catch {}
    return record.emergencyPromise;
  }
  async function drain(record) {
    if (record.draining) return;
    record.draining = true;
    try { while (record.queue.length && valid(record)) {
      const worker = record.queue.shift();
      try {
        const allowed = await bounded(() => allowTarget({ tabId: record.tabId, type: 'worker', url: worker.url }));
        worker.url = null;
        if (allowed !== true || !valid(record)) throw failure('worker-out-of-scope');
        await send(record, worker.id, 'Target.setAutoAttach', AUTO);
        await send(record, worker.id, 'Runtime.enable');
        const result = await send(record, worker.id, 'Runtime.evaluate', { expression: record.source, objectGroup: 'detect-expert-worker-private', returnByValue: false, silent: true }, false,
          value => { const objectId = own(own(value, 'result'), 'objectId'); if (typeof objectId === 'string') { worker.objectId = objectId; void restore(record, worker); } });
        const objectId = own(own(result, 'result'), 'objectId');
        if (own(result, 'exceptionDetails') || typeof objectId !== 'string' || objectId.length > 1024) throw failure('worker-bootstrap-failed');
        worker.objectId = objectId;
        if (!valid(record)) { await restore(record, worker); throw failure('session-stale'); }
        record.bootstrapped++;
      } catch (error) { record.partial = true; if (owned === record && !record.stopping && error?.code !== 'session-stale') lastError = error?.code === 'worker-out-of-scope' ? 'worker-out-of-scope' : 'worker-bootstrap-failed'; }
      finally { worker.url = null; await resume(record, worker); publish(); }
    } } finally { record.draining = false; }
  }
  const events = (source, method, params) => {
    const record = owned;
    if (!record || own(source, 'tabId') !== record.tabId) return;
    if (method === 'Target.detachedFromTarget') { const id = own(params, 'sessionId'); record.workers.delete(id); if (!record.disablingAutoAttach) record.waiters.delete(id); record.queue = record.queue.filter(row => row.id !== id); publish(); return; }
    if (method !== 'Target.attachedToTarget') return;
    const id = own(params, 'sessionId'), parent = own(source, 'sessionId'), info = own(params, 'targetInfo');
    if (typeof id !== 'string' || id.length < 1 || id.length > 256) { record.unknownPaused = true; void emergency(record, 'worker-target-limit'); return; }
    if (record.workers.has(id)) return;
    const worker = { id, waiting: own(params, 'waitingForDebugger') === true, objectId: null, url: own(info, 'url') };
    // During a wait-on-start transition Chrome can report false before the
    // startup barrier is actually released. Resume every teardown intake ID.
    if (worker.waiting || record.stopping) {
      let extra = 0; for (const waiting of record.waiters.keys()) if (!record.workers.has(waiting)) extra++;
      if (record.workers.size + extra >= FINGERPRINT_ENGINE_DRIVER_LIMITS.maxCleanupSessions && !record.waiters.has(id)) { worker.url = null; record.unknownPaused = true; record.cleanupFailed = true; void emergency(record, 'worker-target-limit'); return; }
      record.waiters.set(id, worker);
    }
    if (record.stopping) { worker.url = null; return; }
    if (!valid(record) || parent !== undefined && !record.workers.has(parent) || own(info, 'type') !== 'worker' || typeof worker.url !== 'string' || worker.url.length > 2048 || record.workers.size >= 64 || record.queue.length >= 32) {
      worker.url = null; void emergency(record, 'worker-target-limit'); return;
    }
    if (!worker.waiting) { record.partial = true; publish(); return; }
    record.workers.set(id, worker); record.queue.push(worker); void drain(record); publish();
  };
  const detached = (source, reason) => {
    const record = owned;
    if (!record || own(source, 'tabId') !== record.tabId) return;
    record.attached = false;
    if (record.stopping) { if (record.cleanupFinished) { release(record); publish(); } return; }
    release(record); lastError = 'debugger-detached'; publish();
    try { onDetach({ reason: reason === 'target_closed' ? 'target-closed' : 'debugger-detached' }); } catch {}
  };
  api?.debugger?.onEvent?.addListener(events);
  api?.debugger?.onDetach?.addListener(detached);
  const removed = tabId => { const record = owned; if (!record || tabId !== record.tabId) return; release(record); publish(); if (!record.stopping) try { onDetach({ reason: 'target-closed' }); } catch {} };
  api?.tabs?.onRemoved?.addListener?.(removed);
  async function stop() {
    const record = owned;
    if (!record) return snapshot();
    if (record.cleanupFinished && record.attached && physical.size) return snapshot();
    // Only an explicit Stop retry may repeat a failed teardown. Event floods
    // retain the existing emergency Promise instead of issuing more detaches.
    if (record.cleanupFinished && record.attached) { record.stopPromise = null; record.emergencyPromise = null; record.cleanupPromise = null; record.cleanupFinished = false; record.cleanupCancelled = false; record.cleanupFailed = false; record.disablingAutoAttach = false; lastError = null; }
    if (record.emergencyPromise) { await record.emergencyPromise; return snapshot(); }
    if (record.stopPromise) return record.stopPromise;
    record.stopping = true; record.queue.length = 0;
    record.stopPromise = cleanup(record);
    publish();
    return record.stopPromise;
  }
  return {
    supported, snapshot,
    async start({ tabId, profile, workerSource, isCurrent } = {}) {
      if (operation || owned || physical.size) throw failure('session-busy');
      if (!supported()) { lastError = 'unsupported'; publish(); return snapshot(); }
      if (!Number.isSafeInteger(tabId) || tabId < 0 || !current(isCurrent)) throw failure('session-stale');
      const compiled = plan(profile), source = readFingerprintWorkerSource(workerSource);
      if (source === null) throw failure('invalid-worker-source');
      const record = { tabId, isCurrent, plan: compiled, source, attached: false, pendingAttach: true, starting: true, stopping: false, partial: compiled.partial, workers: new Map(), waiters: new Map(), queue: [], bootstrapped: 0 };
      owned = record; operation = record; lastError = null; publish();
      try {
        await bounded(async () => {
          try { await api.debugger.attach({ tabId }, '1.3'); record.pendingAttach = false; record.attached = true; }
          catch (error) { record.pendingAttach = false; if (record.stopping && !record.attached) release(record); throw error; }
          if (owned !== record || record.stopping || disposed || !current(isCurrent)) {
            // Stop may have logically completed before Chrome's attach. Reclaim
            // that exact physical ownership until its teardown is confirmed.
            if (owned === null) owned = record;
            record.stopping = true; record.cleanupFinished = true;
            try { await detachOwned(record); }
            catch { lastError = 'detach-failed'; publish(); throw failure('detach-failed'); }
            throw failure('session-stale');
          }
        });
        if (!valid(record)) throw failure('session-stale');
        for (const command of compiled.commands) await send(record, null, command.method, command.params);
        await send(record, null, 'Target.setAutoAttach', AUTO);
        record.starting = false; publish(); return snapshot();
      } catch (error) { lastError = error?.code ?? 'native-error'; if (lastError !== 'detach-failed' || !record.attached) await stop(); else publish(); return snapshot(); }
      finally { if (operation === record) operation = null; }
    },
    stop,
    async dispose() { disposed = true; await stop(); maybeUnsubscribe(); },
  };
}
