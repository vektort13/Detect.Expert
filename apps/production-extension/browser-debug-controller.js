// ADR-063: direct browser data stays in the exact owned, top-level Options document.
import { BROWSER_DEBUG_DATASETS, BROWSER_DEBUG_LIMITS as LIMITS, BrowserDebugError, debugFail, debugHttpUrl } from './browser-debug-shared.js';
import { createBrowserDebugDataDriver } from './browser-debug-data.js';
import { createBrowserDebugEnvironmentDriver } from './browser-debug-environment.js';

const ACTIONS = new Set(['create', 'edit', 'move', 'remove', 'pause', 'resume', 'cancel', 'erase', 'activate', 'restore', 'clear', 'open', 'api-guard']);
const SAFE_CODES = new Set(['unauthorized', 'unsupported', 'permission-required', 'permission-denied', 'invalid-input', 'stale', 'stale-handle', 'stale-record', 'stale-snapshot', 'expired-handle', 'inactive', 'not-visible', 'busy', 'timeout', 'operation-timeout', 'not-controllable', 'not-applied', 'operation-failed']);
const safeError = error => new BrowserDebugError(error instanceof BrowserDebugError && SAFE_CODES.has(error.code) ? error.code : 'operation-failed');

function projection(value, depth = 0) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.slice(0, LIMITS.string);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (depth > 4) return null;
  if (Array.isArray(value)) return value.slice(0, 32).map(item => projection(item, depth + 1));
  if (value && Object.getPrototypeOf(value) === Object.prototype) return Object.fromEntries(Object.entries(value).slice(0, 48).filter(([key]) => !['__proto__', 'prototype', 'constructor'].includes(key)).map(([key, item]) => [key.slice(0, 96), projection(item, depth + 1)]));
  return null;
}

function ownOptions(api, env) {
  try {
    const expected = new URL(api.runtime.getURL('options.html')), actual = new URL(env.location.href);
    const win = env.window ?? env;
    return win.top === win && ['chrome-extension:', 'moz-extension:'].includes(expected.protocol) && expected.host !== '' &&
      actual.protocol === expected.protocol && actual.host === expected.host && actual.pathname === expected.pathname && !actual.username && !actual.password;
  } catch { return false; }
}

function validatePatch(description, patch) {
  if (!patch || Object.getPrototypeOf(patch) !== Object.prototype || !Array.isArray(description.fields)) debugFail('invalid-input');
  if (Reflect.ownKeys(patch).some(key => typeof key !== 'string' || !Object.hasOwn(Object.getOwnPropertyDescriptor(patch, key), 'value'))) debugFail('invalid-input');
  const fields = description.fields;
  if (Object.keys(patch).some(key => !fields.some(field => field.key === key))) debugFail('invalid-input');
  const result = {};
  for (const field of fields) {
    if (!Object.hasOwn(patch, field.key)) { if (field.required) debugFail('invalid-input'); continue; }
    const value = patch[field.key];
    if (field.type === 'boolean' && typeof value !== 'boolean' || field.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) debugFail('invalid-input');
    if (['text', 'string', 'url'].includes(field.type) && (typeof value !== 'string' || value.length > LIMITS.string || field.required && !value.trim())) debugFail('invalid-input');
    if (field.type === 'url' && value) debugHttpUrl(value);
    if (field.type === 'select' && !field.options?.some(option => Object.is(option, value))) debugFail('invalid-input');
    if (!['text', 'string', 'url', 'boolean', 'number', 'select'].includes(field.type)) debugFail('invalid-input');
    result[field.key] = value;
  }
  return result;
}

export function createBrowserDebugController(browserApi = globalThis.chrome, { env = globalThis, onInvalidate = () => {}, deadline = LIMITS.deadline } = {}) {
  const nativeBrowser = env.browser;
  const api = nativeBrowser?.runtime?.id && nativeBrowser.runtime.id === browserApi?.runtime?.id ? nativeBrowser : browserApi;
  const browser = typeof api?.runtime?.getBrowserInfo === 'function' ? 'firefox' : 'chrome';
  const catalog = new Map(BROWSER_DEBUG_DATASETS.map(item => [item.id, item]));
  const snapshots = new Map(), handles = new Map(), reads = new Map();
  let visible = true, disposed = false, epoch = 0, sequence = 0, writing = false;
  const notify = reason => { try { onInvalidate({ reason }); } catch { /* A view callback cannot grant access. */ } };
  function check(task = null) {
    if (!ownOptions(api, env)) debugFail('unauthorized');
    if (disposed || !visible) debugFail('inactive');
    if (task && (task.cancelled || task.epoch !== epoch || task.id && reads.get(task.id) !== task)) debugFail('stale');
  }
  function getDataset(id) { check(); const item = catalog.get(id); if (!item) debugFail('invalid-input'); return item; }
  function context(task = null) {
    return { api, env, browser, check: () => check(task), call: async (target, method, args = []) => {
      check(task);
      if (typeof target?.[method] !== 'function') debugFail('unsupported');
      // Exactly one dispatch. A rejected operation is never retried with another calling convention.
      const result = await Reflect.apply(target[method], target, args);
      check(task); return result;
    } };
  }
  function drivers(task) { const ctx = context(task); return [createBrowserDebugDataDriver(ctx), createBrowserDebugEnvironmentDriver(ctx)]; }
  function driverFor(id, task = null) { const driver = drivers(task).find(item => item.supports(id)); if (!driver) debugFail('unsupported'); return driver; }
  function declared(item) {
    try { const manifest = api.runtime.getManifest(); const granted = new Set([...(manifest.permissions ?? []), ...(manifest.optional_permissions ?? [])]); return item.permissions.every(permission => granted.has(permission)); } catch { return false; }
  }
  async function access(id, task = null) {
    const item = getDataset(id); check(task);
    if (!declared(item)) return { status: 'unsupported', permissions: [] };
    if (item.permissions.length) {
      if (!api.permissions?.contains) return { status: 'unsupported', permissions: [] };
      const granted = await context(task).call(api.permissions, 'contains', [{ permissions: [...item.permissions] }]);
      if (!granted) return { status: 'permission-required', permissions: [...item.permissions] };
    }
    return { status: drivers(task).some(driver => driver.supports(id)) ? 'ready' : 'unsupported', permissions: [...item.permissions] };
  }
  function grant(id) {
    try {
      const item = getDataset(id);
      if (!declared(item) || !api.permissions?.request) debugFail('unsupported');
      // Keep the native request on the trusted user-gesture stack, before any await.
      const request = api.permissions.request({ permissions: [...item.permissions] });
      return Promise.resolve(request).then(result => { check(); return result === true; }, error => { throw safeError(error); });
    } catch (error) { return Promise.reject(safeError(error)); }
  }
  function evict(id) {
    const existing = snapshots.get(id);
    if (existing) for (const handle of existing.handles) handles.delete(handle);
    snapshots.delete(id);
  }
  function invalidate(reason) {
    ++epoch; for (const task of reads.values()) task.cancelled = true; reads.clear();
    if (reason === 'permissions' || reason === 'disposed') { snapshots.clear(); handles.clear(); }
    notify(reason);
  }
  async function bounded(task, execute) {
    let timer;
    const physical = Promise.resolve().then(execute);
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { task.cancelled = true; reject(new BrowserDebugError('timeout')); }, deadline); });
    try { return await Promise.race([physical, timeout]); }
    catch (error) { throw safeError(error); }
    finally { clearTimeout(timer); }
  }
  async function load(id, options = {}) {
    const item = getDataset(id);
    if (!options || typeof options !== 'object' || Object.keys(options).some(key => !['query', 'origin', 'limit', 'days'].includes(key))) debugFail('invalid-input');
    const normalized = { query: options.query ?? '', limit: options.limit ?? LIMITS.rows, days: options.days ?? 30 };
    if (typeof normalized.query !== 'string' || normalized.query.length > 512 || !Number.isInteger(normalized.limit) || normalized.limit < 1 || normalized.limit > LIMITS.rows || !Number.isInteger(normalized.days) || normalized.days < 1 || normalized.days > 90) debugFail('invalid-input');
    if (item.origin) {
      normalized.origin = debugHttpUrl(options.origin, { origin: true });
      const supplied = new URL(options.origin);
      if (supplied.pathname !== '/' || supplied.search || supplied.hash) debugFail('invalid-input');
    }
    if (reads.has(id)) reads.get(id).cancelled = true;
    const task = { id, epoch, cancelled: false }; reads.set(id, task);
    evict(id);
    try {
      return await bounded(task, async () => {
        const allowed = await access(id, task); if (allowed.status !== 'ready') debugFail(allowed.status);
        const result = await driverFor(id, task).read(id, normalized); check(task);
        const rows = [], refs = [], generation = ++sequence; let bytes = 0, truncated = result.truncated === true;
        if (!Array.isArray(result.records)) debugFail('operation-failed');
        for (const record of result.records.slice(0, normalized.limit)) {
          const values = projection(record.values);
          if (!values || Array.isArray(values) || typeof values !== 'object') continue;
          const size = new TextEncoder().encode(JSON.stringify(values)).length;
          if (bytes + size > LIMITS.bytes) { truncated = true; break; } bytes += size;
          const handle = generation + ':' + rows.length, actions = Array.isArray(record.actions) ? record.actions.filter(action => ACTIONS.has(action)) : [];
          rows.push({ handle, values, actions }); refs.push([handle, { id, reference: record.reference, actions }]);
        }
        if (result.records.length > rows.length) truncated = true;
        let summary = projection(result.summary ?? []);
        if (new TextEncoder().encode(JSON.stringify(summary)).length > 8192) { summary = []; truncated = true; }
        const snapshot = { dataset: id, rows, columns: [...item.columns], truncated, summary, at: new Date().toISOString() };
        // Bound the complete public snapshot, including handles, actions and wrapper metadata.
        while (new TextEncoder().encode(JSON.stringify(snapshot)).length > LIMITS.bytes && rows.length) { rows.pop(); refs.pop(); snapshot.truncated = true; }
        snapshots.set(id, { snapshot, handles: refs.map(([handle]) => handle) }); for (const [handle, ref] of refs) handles.set(handle, ref);
        while (snapshots.size > LIMITS.snapshots) evict(snapshots.keys().next().value);
        return snapshot;
      });
    } finally { if (reads.get(id) === task) reads.delete(id); }
  }
  function referenceFor(id, operation, handle) {
    const item = getDataset(id);
    if (!ACTIONS.has(operation) || operation === 'api-guard') debugFail('invalid-input');
    if (operation === 'create' && item.create && handle === null) return null;
    const record = handles.get(handle);
    if (!record || record.id !== id || !record.actions.includes(operation)) debugFail('stale-handle');
    return record.reference;
  }
  function describe(id, operation, handle = null) {
    try { const ref = referenceFor(id, operation, handle); return projection(driverFor(id).describe(id, operation, ref)); }
    catch (error) { throw safeError(error); }
  }
  async function mutate(id, operation, handle = null, patch = {}) {
    check(); if (writing) debugFail('busy');
    const ref = referenceFor(id, operation, handle), description = describe(id, operation, handle), input = validatePatch(description, patch);
    const task = { epoch, cancelled: false }; writing = true;
    return bounded(task, async () => {
      try {
        const allowed = await access(id, task); if (allowed.status !== 'ready') debugFail(allowed.status);
        // References must still be current after an asynchronous permission check.
        if (referenceFor(id, operation, handle) !== ref) debugFail('stale-handle');
        const result = await driverFor(id, task).write(id, operation, ref, input); check(task); evict(id); return projection(result);
      } finally { writing = false; }
    });
  }
  const removed = () => invalidate('permissions');
  api?.permissions?.onRemoved?.addListener(removed);
  return {
    datasets: BROWSER_DEBUG_DATASETS, access, grant, load, describe, mutate,
    setVisible(value) { const next = value === true; if (next !== visible) { visible = next; invalidate('visibility'); } },
    dispose() { if (disposed) return; disposed = true; invalidate('disposed'); api?.permissions?.onRemoved?.removeListener(removed); },
  };
}

function exportValue(value) {
  if (typeof value === 'string') {
    try { const url = new URL(value); if (['http:', 'https:'].includes(url.protocol)) { url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.href; } } catch { /* An ordinary bounded scalar. */ }
    return value;
  }
  if (Array.isArray(value)) return value.map(exportValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, exportValue(item)]));
  return value;
}
export function exportBrowserDebugSnapshot(snapshot) {
  if (!snapshot || !BROWSER_DEBUG_DATASETS.some(item => item.id === snapshot.dataset) || !Array.isArray(snapshot.rows)) debugFail('invalid-input');
  return JSON.stringify({ format: 'detect.expert/browser-debug', formatVersion: 1, dataset: snapshot.dataset, observedAt: snapshot.at, columns: snapshot.columns, truncated: snapshot.truncated === true, summary: exportValue(projection(snapshot.summary)), records: snapshot.rows.slice(0, LIMITS.rows).map(row => {
    const values = exportValue(projection(row.values));
    return snapshot.dataset === 'account' ? { ...values, value: '[redacted]' } : values;
  }) }, null, 2);
}
