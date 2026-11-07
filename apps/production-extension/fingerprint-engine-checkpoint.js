// ADR-101: trusted session-only ownership journal. Never restores native effects.
export const FINGERPRINT_ENGINE_CHECKPOINT_KEY = 'fingerprint-engine:owned-window:v1';
export const FINGERPRINT_ENGINE_CHECKPOINT_LIMITS = Object.freeze({ timeoutMs: 5000, maxWindows: 256, maxTabs: 256 });
const own = (object, key) => object && typeof object === 'object' ? Object.getOwnPropertyDescriptor(object, key)?.value : undefined;
const id = value => Number.isSafeInteger(value) && value >= 0;
const fail = () => Object.assign(new Error('not-ready'), { code: 'not-ready' });
function journal(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 3 || keys.some(key => !['v', 'windowId', 'tabId'].includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) return null;
  return own(value, 'v') === 1 && id(own(value, 'windowId')) && id(own(value, 'tabId')) ? { v: 1, windowId: own(value, 'windowId'), tabId: own(value, 'tabId') } : null;
}
function array(value, max) {
  if (!Array.isArray(value) || value.length > max) throw fail();
  const result = [];
  for (let index = 0; index < value.length; index++) { const field = Object.getOwnPropertyDescriptor(value, String(index)); if (!field || !Object.hasOwn(field, 'value')) throw fail(); result.push(field.value); }
  return result;
}

export function createFingerprintEngineCheckpoint(api) {
  let physical = null, queued = null, reading = null;
  function available(method) { const session = api?.storage?.session; if (!session || typeof session[method] !== 'function') throw fail(); return session; }
  function finish(job, error, value) { clearTimeout(job.timer); if (job.done) return; job.done = true; error ? job.reject(fail()) : job.resolve(value); }
  function createJob(kind, value = null) {
    const job = { kind, value, done: false, expired: false, started: false, timer: null };
    job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
    job.timer = setTimeout(() => {
      job.expired = true; finish(job, true);
      // A queued read is safe to abandon. A write remains the latest desired
      // journal state and still executes when the physical slot becomes free.
      if (job.kind === 'restore' && !job.started && reading === job) reading = null;
    }, FINGERPRINT_ENGINE_CHECKPOINT_LIMITS.timeoutMs);
    return job;
  }
  const currentRead = job => { if (job.expired) throw fail(); };
  async function removeStale(job) { currentRead(job); await available('remove').remove(FINGERPRINT_ENGINE_CHECKPOINT_KEY); return null; }
  function validWindow(window, expected) {
    if (!window || typeof window !== 'object' || own(window, 'id') !== expected.windowId) throw fail();
    if (own(window, 'type') !== 'normal') return false;
    const tabs = array(own(window, 'tabs'), FINGERPRINT_ENGINE_CHECKPOINT_LIMITS.maxTabs);
    let found = false;
    for (const tab of tabs) { if (!id(own(tab, 'id')) || !id(own(tab, 'windowId'))) throw fail(); if (own(tab, 'id') === expected.tabId && own(tab, 'windowId') === expected.windowId) found = true; }
    return found;
  }
  async function restoreNative(job) {
    const values = await available('get').get(FINGERPRINT_ENGINE_CHECKPOINT_KEY); currentRead(job);
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw fail();
    const field = Object.getOwnPropertyDescriptor(values, FINGERPRINT_ENGINE_CHECKPOINT_KEY);
    if (!field) return null;
    if (!Object.hasOwn(field, 'value')) throw fail();
    const expected = journal(field.value);
    if (!expected) return removeStale(job);
    if (typeof api?.windows?.get !== 'function') throw fail();
    let window;
    try { window = await api.windows.get(expected.windowId, { populate: true }); }
    catch {
      currentRead(job);
      if (typeof api?.windows?.getAll !== 'function') throw fail();
      const windows = array(await api.windows.getAll({ populate: true, windowTypes: ['normal'] }), FINGERPRINT_ENGINE_CHECKPOINT_LIMITS.maxWindows); currentRead(job);
      for (const item of windows) {
        if (!id(own(item, 'id')) || own(item, 'type') !== 'normal') throw fail();
        if (own(item, 'id') === expected.windowId) window = item;
      }
      // Absence is established only by a complete bounded native list.
      if (!window) return removeStale(job);
    }
    currentRead(job);
    return validWindow(window, expected) ? window : removeStale(job);
  }
  function pump() {
    if (physical) return;
    const job = queued ?? (reading && !reading.started && !reading.expired ? reading : null);
    if (!job) return;
    if (queued === job) queued = null;
    job.started = true;
    const work = Promise.resolve().then(() => job.kind === 'restore' ? restoreNative(job) : job.kind === 'save' ? available('set').set({ [FINGERPRINT_ENGINE_CHECKPOINT_KEY]: job.value }) : available('remove').remove(FINGERPRINT_ENGINE_CHECKPOINT_KEY));
    physical = work;
    work.then(value => finish(job, false, value), () => finish(job, true)).finally(() => { if (physical === work) physical = null; if (reading === job) reading = null; pump(); });
  }
  function write(kind, value = null) {
    try { available(kind === 'save' ? 'set' : 'remove'); } catch { return Promise.reject(fail()); }
    const job = createJob(kind, value);
    if (queued) finish(queued, true);
    queued = job; pump(); return job.promise;
  }
  return {
    restore() {
      try { available('get'); } catch { return Promise.reject(fail()); }
      if (reading) return reading.promise;
      reading = createJob('restore'); const promise = reading.promise; pump(); return promise;
    },
    save(windowId, tabId) { if (!id(windowId) || !id(tabId)) return Promise.reject(fail()); return write('save', { v: 1, windowId, tabId }); },
    clear: () => write('clear'),
  };
}
