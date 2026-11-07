// E22-22: launcher-only master changes reuse the canonical configuration CAS.
import { validateApiConfiguration } from './api-configuration.js';

const MASTER_KEYS = new Set(['enabled', 'antidetectEnabled']);
const PAGES = new Set(['/popup.html', '/sidepanel.html', '/options.html']);
const ERRORS = new Set(['stale-revision', 'privacy-permission-required', 'early-access-required', 'storage-error', 'no-access', 'busy', 'invalid-value', 'unsupported']);
const own = (value, key) => value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
const code = value => ERRORS.has(value) ? value : 'operation-failed';

export function createGuardLauncherController(browserApi = globalThis.chrome, {
  onChange = () => {}, masterKey = 'enabled', deadlineMs = 5000,
} = {}) {
  const api = globalThis.browser?.runtime?.id === browserApi?.runtime?.id ? globalThis.browser : browserApi;
  let disposed = false, pending = null, queued = false, epoch = 0, storageSequence = 0, revision = -1;
  let state = { enabled: null, busy: false, error: null };
  function context() {
    try {
      const expected = new URL(api.runtime.getURL('')), actual = new URL(globalThis.location.href);
      if (disposed || !MASTER_KEYS.has(masterKey) || globalThis.window !== globalThis.window.top ||
          globalThis.document?.visibilityState === 'hidden' || !['chrome-extension:', 'moz-extension:'].includes(expected.protocol) ||
          actual.protocol !== expected.protocol || actual.host !== expected.host || actual.username || actual.password || !PAGES.has(actual.pathname)) return null;
      return actual.protocol + '//' + actual.host + actual.pathname;
    } catch { return null; }
  }
  function publish(next) {
    if (disposed) return;
    if (state.enabled === next.enabled && state.busy === next.busy && state.error === next.error) return;
    state = next;
    try { onChange({ ...state }); } catch { /* A view failure cannot repeat a write. */ }
  }
  function invalidate(error = null) {
    ++epoch;
    publish({ enabled: null, busy: pending !== null, error });
  }
  const current = job => !disposed && !job.expired && job.epoch === epoch && context() === job.context;
  function response(raw) {
    if (own(raw, 'schemaVersion') !== 1 || own(raw, 'type') !== 'api-config-state') throw Error(code(own(raw, 'code')));
    const nextRevision = own(raw, 'revision'), configuration = validateApiConfiguration(own(raw, 'configuration'));
    const registration = own(raw, 'registration');
    if (!Number.isSafeInteger(nextRevision) || nextRevision < 0 || !configuration.ok ||
        !['ready', 'inactive', 'error'].includes(registration) || typeof own(raw, 'reloadRequired') !== 'boolean') throw Error('operation-failed');
    if (typeof own(configuration.value, masterKey) !== 'boolean') throw Error('unsupported');
    return { configuration: configuration.value, revision: nextRevision, registration };
  }
  function adopt(job, value) {
    if (!current(job)) return false;
    if (value.revision < revision) throw Error('stale-revision');
    revision = value.revision;
    publish({ enabled: value.configuration[masterKey], busy: true, error: value.registration === 'error' ? 'operation-failed' : null });
    return true;
  }
  function send(request) { return api.runtime.sendMessage(request); }
  function run(action) {
    if (pending || disposed) return Promise.resolve({ ...state });
    const binding = context();
    if (!binding) { invalidate('inactive'); return Promise.resolve({ ...state }); }
    const job = { epoch, context: binding, expired: false, writes: false };
    pending = job;
    publish({ ...state, busy: true, error: null });
    let timer;
    const physical = Promise.resolve().then(() => action(job)).catch(reason => {
      if (current(job)) publish({ ...state, error: code(own(reason, 'message')) });
    }).finally(() => {
      clearTimeout(timer);
      if (pending !== job) return;
      pending = null;
      if (disposed) return;
      if (context() !== job.context) { invalidate('inactive'); queued = false; return; }
      publish({ ...state, busy: false });
      // Only a read is queued. A stale or timed-out mutation is never retried.
      const confirm = queued || job.expired && job.writes;
      queued = false;
      if (confirm) void load();
    });
    const deadline = new Promise(resolve => {
      timer = setTimeout(() => {
        if (pending === job && !disposed) {
          job.expired = true;
          if (context() === job.context && job.epoch === epoch) publish({ ...state, busy: true, error: 'timeout' });
        }
        resolve();
      }, Number.isFinite(deadlineMs) ? Math.max(1, deadlineMs) : 5000);
    });
    return Promise.race([physical, deadline]).then(() => ({ ...state }));
  }
  function load() {
    if (pending) { queued = true; return Promise.resolve({ ...state }); }
    return run(async job => {
      const before = storageSequence;
      const value = response(await send({ schemaVersion: 1, type: 'ui-api-config-get', tabId: null }));
      if (!current(job)) return;
      if (before !== storageSequence) { queued = true; return; }
      adopt(job, value);
    });
  }
  function toggle() {
    if (typeof state.enabled !== 'boolean' || pending || disposed) return Promise.resolve({ ...state });
    const target = !state.enabled;
    return run(async job => {
      const before = storageSequence;
      const fresh = response(await send({ schemaVersion: 1, type: 'ui-api-config-get', tabId: null }));
      if (!current(job)) return;
      if (before !== storageSequence) { queued = true; return; }
      if (fresh.revision < revision) throw Error('stale-revision');
      if (fresh.configuration[masterKey] === target) { adopt(job, fresh); return; }
      const configuration = { ...fresh.configuration, [masterKey]: target };
      job.writes = true;
      const value = response(await send({ schemaVersion: 1, type: 'ui-api-config-set', tabId: null, expectedRevision: fresh.revision, configuration }));
      if (!current(job)) return;
      if (value.revision <= fresh.revision || value.configuration[masterKey] !== target) throw Error('stale-revision');
      adopt(job, value);
    });
  }
  function changed(changes, area) {
    if (disposed || area !== 'local' || !changes || !Object.getOwnPropertyDescriptor(changes, 'api-configuration:v1')) return;
    ++storageSequence;
    if (pending) queued = true;
    else if (context()) void load();
  }
  function accessChanged() {
    if (disposed) return;
    invalidate();
    if (pending) queued = true;
    else if (context()) void load();
  }
  const subscriptions = [[api.storage?.onChanged, changed], [api.permissions?.onAdded, accessChanged], [api.permissions?.onRemoved, accessChanged]];
  for (const [event, listener] of subscriptions) event?.addListener?.(listener);
  globalThis.document?.addEventListener?.('visibilitychange', accessChanged);
  return {
    getState() { if (!disposed && !context()) invalidate('inactive'); return { ...state }; },
    load, toggle,
    dispose() {
      if (disposed) return;
      disposed = true; ++epoch; queued = false;
      state = { enabled: null, busy: false, error: null };
      for (const [event, listener] of subscriptions) event?.removeListener?.(listener);
      globalThis.document?.removeEventListener?.('visibilitychange', accessChanged);
    },
  };
}
