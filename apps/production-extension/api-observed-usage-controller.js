// E22-21 / ADR-067: read-only current-document metadata; no values or config writes.
import { emptyObservedUsage, projectObservedUsage } from './api-observed-usage.js';

const MAX_ID = 2147483647, MAX_FRAMES = 32, PARALLEL = 4;
const id = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_ID;
const frameId = value => Number.isSafeInteger(value) && value >= 0;
const documentId = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,120}$/.test(value);

export function observedSourceTabId(href) {
  try {
    const values = new URL(href).searchParams.getAll('tabId');
    if (values.length !== 1 || !/^(0|[1-9][0-9]{0,9})$/.test(values[0])) return null;
    const value = Number(values[0]); return id(value) ? value : null;
  } catch { return null; }
}

function frameSnapshot(raw, tabId) {
  if (!Array.isArray(raw) || raw.length > 8192) return null;
  const seen = new Set(), rows = []; let truncated = raw.length > MAX_FRAMES;
  // Verify the top document even if the browser enumerates it last.
  const ordered = [...raw.filter(row => row.frameId === 0), ...raw.filter(row => row.frameId !== 0)];
  for (const row of ordered) {
    if (!frameId(row.frameId) || !documentId(row.documentId) || seen.has(row.frameId) || row.errorOccurred ||
        row.documentLifecycle !== undefined && row.documentLifecycle !== 'active') { truncated = true; continue; }
    seen.add(row.frameId);
    if (rows.length >= MAX_FRAMES) { truncated = true; continue; }
    let origin = null, scheme = null;
    try { const url = new URL(row.url); origin = url.origin === 'null' ? null : url.origin; scheme = url.protocol; } catch { /* Unknown native origin. */ }
    rows.push({ frameId: row.frameId, documentKey: `${tabId}:${row.frameId}:${row.documentId}`, origin, scheme });
  }
  return rows.some(row => row.frameId === 0) ? { rows, truncated } : null;
}

function relation(mainFrame, childFrame, main, child) {
  if (childFrame.frameId === 0) return 'same-origin';
  if (!mainFrame.origin || !childFrame.origin || !['http:', 'https:'].includes(childFrame.scheme)) return 'opaque';
  if (mainFrame.origin === childFrame.origin) return 'same-origin';
  // Report hosts are canonical registrable domains, including the PRIVATE PSL.
  if (!main.host || !child.host) return 'unknown';
  return mainFrame.scheme === childFrame.scheme && main.host === child.host ? 'same-site' : 'cross-site';
}

export function createApiObservedUsageController(browserApi = globalThis.chrome, {
  sendRequest, onChange = () => {}, tabId = observedSourceTabId(globalThis.location?.href),
  pollMs = 1000, deadlineMs = 4000,
} = {}) {
  // Firefox's existing adapter supplies the same verified document identity as
  // the background. Its native getAllFrames alone has no documentId on Firefox138.
  const api = browserApi;
  const events = globalThis.browser?.runtime?.id === browserApi?.runtime?.id ? globalThis.browser : browserApi;
  let active = false, disposed = false, closed = false, epoch = 0, timer = null, job = null;
  let state = context('no-site'), signature = '';
  function context(status, extra = {}) {
    return { ...emptyObservedUsage(status), tabId: id(tabId) ? tabId : null, host: null, documentKey: null,
      coverageState: null, coverageFlags: [], ...extra };
  }
  function trusted() {
    try {
      const expected = new URL(api.runtime.getURL('options.html')), actual = new URL(globalThis.location.href);
      return !disposed && globalThis.window === globalThis.window.top && !actual.username && !actual.password &&
        ['chrome-extension:', 'moz-extension:'].includes(expected.protocol) && actual.protocol === expected.protocol &&
        actual.host === expected.host && actual.pathname === expected.pathname && observedSourceTabId(actual.href) === tabId;
    } catch { return false; }
  }
  function visible() { return active && !disposed && !closed && globalThis.document?.visibilityState !== 'hidden'; }
  function fresh(token) {
    if (token !== epoch || !visible()) return false;
    if (!trusted()) { invalidate('no-site'); return false; }
    return true;
  }
  function publish(next) {
    state = next;
    const serialized = JSON.stringify(next);
    if (serialized === signature) return;
    signature = serialized;
    try { onChange(next); } catch { /* A view failure cannot affect the observed tab. */ }
  }
  function cancelTimer() { if (timer !== null) clearTimeout(timer); timer = null; }
  function invalidate(status = 'loading') { ++epoch; cancelTimer(); publish(context(status)); }
  function schedule(delay = pollMs) {
    cancelTimer();
    if (visible() && trusted() && id(tabId) && !job) timer = setTimeout(() => { timer = null; void refresh(); }, delay);
  }
  async function refresh() {
    if (job) return job;
    if (!visible()) return state;
    if (!trusted() || !id(tabId)) { publish(context('no-site')); return state; }
    const token = epoch;
    // Timeout invalidates the result but keeps the physical job reserved until settlement.
    const deadline = setTimeout(() => { if (fresh(token)) invalidate('error'); }, Math.max(100, deadlineMs));
    job = (async () => {
      try {
        if (typeof sendRequest !== 'function') { publish(context('error')); return state; }
        const before = frameSnapshot(await api.webNavigation.getAllFrames({ tabId }), tabId);
        if (!fresh(token)) return state;
        if (!before) { publish(context('unsupported')); return state; }
        const mainFrame = before.rows.find(row => row.frameId === 0);
        const read = async frame => {
          try {
            const response = await sendRequest({ schemaVersion: 1, type: 'ui-get-report', tabId, ...(frame.frameId ? { frameId: frame.frameId } : {}) });
            const report = response?.ok && response.response?.type === 'report' ? response.response.report : null;
            return report?.documentKey === frame.documentKey ? report : null;
          } catch { return null; }
        };
        const main = await read(mainFrame);
        if (!fresh(token)) return state;
        if (!main) { publish(context('no-access')); return state; }
        if (['no-access', 'unsupported', 'paused'].includes(main.coverageState) || main.scopeMode === 'off') {
          const status = main.scopeMode === 'off' ? 'paused' : main.coverageState;
          publish(context(status));
          return state;
        }
        const documents = [{ report: main, frame: mainFrame }]; let partial = before.truncated || main.coverageState !== 'active';
        const children = before.rows.filter(row => row.frameId !== 0);
        for (let index = 0; index < children.length; index += PARALLEL) {
          const batch = children.slice(index, index + PARALLEL);
          const result = await Promise.all(batch.map(async frame => ({ frame, report: await read(frame) })));
          if (!fresh(token)) return state;
          for (const item of result) {
            if (!item.report || ['no-access', 'unsupported', 'paused'].includes(item.report.coverageState) || item.report.scopeMode === 'off') partial = true;
            else { documents.push(item); if (item.report.coverageState !== 'active') partial = true; }
          }
        }
        const after = frameSnapshot(await api.webNavigation.getAllFrames({ tabId }), tabId);
        if (!fresh(token)) return state;
        if (!after || after.rows.find(row => row.frameId === 0)?.documentKey !== main.documentKey) { invalidate('loading'); return state; }
        const admitted = documents.filter(item => after.rows.some(frame => frame.documentKey === item.frame.documentKey));
        if (admitted.length !== documents.length || after.rows.length !== before.rows.length) partial = true;
        const projected = projectObservedUsage(admitted.map(item => ({ report: item.report, relation: relation(mainFrame, item.frame, main, item.report) })), { truncated: partial || after.truncated });
        const flags = [...new Set(admitted.flatMap(item => item.report.coverageFlags))];
        publish({ ...projected, tabId, host: main.host, documentKey: main.documentKey,
          coverageState: main.coverageState === 'active' && partial ? 'partial' : main.coverageState, coverageFlags: flags });
      } catch {
        if (fresh(token)) publish(context('error'));
      } finally { clearTimeout(deadline); }
      return state;
    })();
    try { return await job; } finally { job = null; schedule(); }
  }
  function navigation(details) {
    if (details?.tabId !== tabId) return;
    invalidate('loading'); schedule(0);
  }
  function updated(changedTabId, change) {
    if (changedTabId !== tabId || change.status !== 'loading' && change.url === undefined) return;
    navigation({ tabId });
  }
  function removed(removedTabId) { if (removedTabId === tabId) { closed = true; invalidate('no-site'); } }
  function replaced(added, removedTabId) { if (removedTabId === tabId) { closed = true; invalidate('no-site'); } }
  function accessChanged() { if (!disposed) { invalidate('loading'); schedule(0); } }
  function storageChanged(changes, area) {
    if (area === 'local' && Object.keys(changes).some(key => ['data-consent:v1', 'scope', 'scope:full-access-default-v1'].includes(key)) ||
        area === 'session' && Object.hasOwn(changes, 'data-consent:pending-v1')) accessChanged();
  }
  function visibilityChanged() { invalidate('loading'); if (visible()) schedule(0); }
  events.webNavigation?.onCommitted?.addListener(navigation);
  events.tabs?.onUpdated?.addListener(updated); events.tabs?.onRemoved?.addListener(removed); events.tabs?.onReplaced?.addListener(replaced);
  events.permissions?.onRemoved?.addListener(accessChanged); events.permissions?.onAdded?.addListener(accessChanged);
  events.storage?.onChanged?.addListener(storageChanged);
  globalThis.document?.addEventListener?.('visibilitychange', visibilityChanged);
  return { refresh, getState: () => { if (!disposed && !trusted()) invalidate('no-site'); return state; },
    setActive(next) {
      if (disposed || active === (next === true)) return;
      active = next === true; invalidate(active && id(tabId) ? 'loading' : 'no-site'); if (visible()) schedule(0);
    },
    dispose() {
      if (disposed) return; disposed = true; ++epoch; cancelTimer(); state = context('no-site');
      events.webNavigation?.onCommitted?.removeListener(navigation);
      events.tabs?.onUpdated?.removeListener(updated); events.tabs?.onRemoved?.removeListener(removed); events.tabs?.onReplaced?.removeListener(replaced);
      events.permissions?.onRemoved?.removeListener(accessChanged); events.permissions?.onAdded?.removeListener(accessChanged);
      events.storage?.onChanged?.removeListener(storageChanged);
      globalThis.document?.removeEventListener?.('visibilitychange', visibilityChanged);
    },
  };
}
