// ADR-097: saved local PRO snapshots are independent of the selected source tab.
import { proReportHistoryLabels } from './pro-report-history-labels.js';

const validId = value => typeof value === 'string' && /^[A-Za-z0-9_:.-]{1,64}$/u.test(value);
export function createDetectorHistoryController({ browserApi, getHistoryStore, timeoutMs = 5000 } = {}) {
  let active = false, disposed = false, generation = 0, reading = false, acting = false, queued = false, store = null, unsubscribeStore = null;
  let state = { items: [], loading: false, loaded: false, opening: null, removing: null, error: null };
  const listeners = new Set(), physical = new Set(), snapshot = () => ({ ...state, items: state.items.map(row => ({ ...row })) });
  const fresh = token => active && !disposed && generation === token;
  const notify = () => { if (active && !disposed) for (const listener of [...listeners]) try { listener(snapshot()); } catch {} };
  async function bounded(operation) {
    if (physical.size >= 4) throw Error('history-unavailable');
    const native = Promise.resolve().then(operation);physical.add(native);const release = () => physical.delete(native);void native.then(release, release);
    let timer;try { return await Promise.race([native, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('history-unavailable')), timeoutMs); })]); } finally { clearTimeout(timer); }
  }
  async function consent() {
    const value = await bounded(() => browserApi.runtime.sendMessage({ schemaVersion: 1, type: 'ui-data-consent-get' }));
    if (value?.schemaVersion !== 1 || value.type !== 'data-consent-state' || value.version !== 1 || typeof value.accepted !== 'boolean') throw Error('history-unavailable');return value.accepted;
  }
  async function history() {
    if (!store) {
      const loaded = await bounded(getHistoryStore);
      if (!loaded || !['list', 'get', 'remove'].every(name => typeof loaded[name] === 'function')) throw Error('history-unavailable');store = loaded;
    }
    if (!unsubscribeStore && active && !disposed && typeof store.subscribe === 'function') unsubscribeStore = store.subscribe(changed);
    return store;
  }
  function continueQueued() { if (queued && active && !disposed && !reading && !acting) { queued = false;queueMicrotask(() => { void refresh(); }); } }
  async function refresh() {
    if (!active || disposed) return;
    if (reading || acting) { queued = true;return; }
    reading = true;const token = ++generation;state = { ...state, loading: true, error: null };notify();
    try {
      if (!await consent()) { if (fresh(token)) state = { ...state, items: [], loaded: true, error: null };return; }
      const archive = await history(), rows = await bounded(() => archive.list());
      if (!fresh(token)) return;
      if (!Array.isArray(rows) || rows.length > 20 || rows.some(row => !validId(row?.id)) || new Set(rows.map(row => row.id)).size !== rows.length) throw Error('history-unavailable');
      state = { ...state, items: rows, loaded: true, error: null };
    } catch { if (fresh(token)) state = { ...state, items: [], loaded: true, error: 'loadFailed' }; }
    finally { reading = false;if (fresh(token)) { state = { ...state, loading: false };notify(); }continueQueued(); }
  }
  function changed() { generation++;state = { ...state, items: [], opening: null, removing: null };notify();void refresh(); }
  const storageChanged = (changes, area) => { if (area === 'local' && Object.hasOwn(changes ?? {}, 'data-consent:v1') || area === 'session' && Object.hasOwn(changes ?? {}, 'data-consent:pending-v1')) changed(); };
  async function open(id, savePdf = false) {
    if (!active || disposed || reading || acting || !validId(id) || !state.items.some(row => row.id === id)) return false;
    acting = true;const token = ++generation;state = { ...state, opening: id, error: null };notify();
    try {
      if (!await consent() || !fresh(token)) return false;
      const archive = await history(), report = await bounded(() => archive.get(id));
      if (!fresh(token)) return false;if (!report || report.id !== id || report.status !== 'stopped') throw Error('history-unavailable');
      const url = browserApi.runtime.getURL('report.html') + '?id=' + encodeURIComponent(id) + '&history=1' + (savePdf ? '&print=1' : '');
      await bounded(() => browserApi.tabs.create({ url }));return fresh(token);
    } catch { if (fresh(token)) state = { ...state, error: 'openFailed' };return false; }
    finally { acting = false;state = { ...state, opening: null };if (fresh(token)) notify();continueQueued(); }
  }
  async function remove(id) {
    if (!active || disposed || reading || acting || !validId(id) || !state.items.some(row => row.id === id)) return false;
    acting = true;const token = ++generation;state = { ...state, removing: id, error: null };notify();
    try { const archive = await history();if (!fresh(token)) return false;await bounded(() => archive.remove(id));if (!fresh(token)) return false;state = { ...state, items: state.items.filter(row => row.id !== id) };return true; }
    catch { if (fresh(token)) state = { ...state, error: 'loadFailed' };return false; }
    finally { acting = false;state = { ...state, removing: null };if (fresh(token)) notify();continueQueued(); }
  }
  return Object.freeze({
    getSnapshot: snapshot, refresh, open, remove,
    subscribe(listener) { listeners.add(listener);return () => listeners.delete(listener); },
    setActive(value) {
      if (disposed || active === value) return;active = value === true;generation++;
      if (active) { browserApi.storage?.onChanged?.addListener(storageChanged);state = { ...state, items: [], opening: null, removing: null };void refresh(); }
      else { browserApi.storage?.onChanged?.removeListener(storageChanged);unsubscribeStore?.();unsubscribeStore = null;queued = false; }
    },
    dispose() { if (disposed) return;active = false;disposed = true;generation++;browserApi.storage?.onChanged?.removeListener(storageChanged);unsubscribeStore?.();unsubscribeStore = null;listeners.clear(); },
  });
}

export function formatProHistoryDate(timestamp, locale) {
  try { return new Intl.DateTimeFormat((typeof locale === 'string' ? locale : locale?.id ?? 'en').replaceAll('_', '-'), { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp); } catch { return new Date(timestamp).toISOString().slice(0, 16).replace('T', ' '); }
}
export function createDetectorHistoryUi({ h, useState, useEffect, useRef, useLocale, browserApi = globalThis.browser ?? globalThis.chrome, getHistoryStore }) {
  function Icon({ kind }) {
    const paths = { history: 'M12 8v4l3 2M3 12a9 9 0 1 0 3-6.7M3 3v5h5', refresh: 'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12 0M6 17a7 7 0 0 0 12 0', open: 'M3 7h7l2 2h9l-3 10H3zM3 7V4h7l2 3', pdf: 'M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4', remove: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7' };
    return h('svg', { viewBox: '0 0 24 24', width: 20, height: 20, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': true, children: h('path', { d: paths[kind] }) });
  }
  function DetectorHistory({ active = true }) {
    const locale = useLocale(), labels = proReportHistoryLabels(locale), controller = useRef(null);
    if (!controller.current) controller.current = createDetectorHistoryController({ browserApi, getHistoryStore });
    const [state, setState] = useState(() => controller.current.getSnapshot()), [confirm, setConfirm] = useState(null);
    const cancelButton = useRef(null), refreshButton = useRef(null), deleteButtons = useRef(new Map()), restoreDelete = useRef(null);
    useEffect(() => { const unsubscribe = controller.current.subscribe(setState);controller.current.setActive(active);setState(controller.current.getSnapshot());return () => { unsubscribe();controller.current.setActive(false); }; }, [active]);
    useEffect(() => () => controller.current.dispose(), []);
    useEffect(() => { if (confirm !== null) cancelButton.current?.focus();else if (restoreDelete.current !== null) { (deleteButtons.current.get(restoreDelete.current) ?? refreshButton.current)?.focus();restoreDelete.current = null; } }, [confirm]);
    if (!active) return null;
    const busy = state.loading || state.opening !== null || state.removing !== null;
    return h('section', { class: 'detector-history', 'data-detector-history': true, 'aria-busy': busy, children: [
      h('div', { class: 'detector-history__heading', children: [h('h2', { children: [h(Icon, { kind: 'history' }), labels.title, h('span', { class: 'detector-history__count', children: String(state.items.length) })] }), h('button', { type: 'button', class: 'button ui-button-icon', ref: refreshButton, disabled: busy, 'data-history-refresh': true, onClick: () => { void controller.current.refresh(); }, children: [h(Icon, { kind: 'refresh' }), labels.refresh] })] }),
      state.error ? h('p', { class: 'detector-history__error', role: 'alert', children: labels[state.error] ?? labels.loadFailed }) : null,
      state.loading && !state.loaded ? h('p', { class: 'muted', role: 'status', children: labels.loading }) : !state.items.length && !state.error ? h('p', { class: 'muted', role: 'status', children: labels.empty }) : null,
      state.items.length ? h('ul', { class: 'detector-history__list', children: state.items.map(row => h('li', { class: 'detector-history__item', 'data-history-id': row.id, key: row.id, children: [
        h('div', { class: 'detector-history__summary', children: [h('strong', { children: h('bdi', { children: row.domain ?? 'PRO' }) }), h('div', { class: 'detector-history__meta', children: [h('time', { dateTime: new Date(row.savedAt).toISOString(), children: formatProHistoryDate(row.savedAt, locale) }), h('span', { children: labels.pages + ': ' + row.pages })] })] }),
        confirm === row.id ? h('div', { class: 'detector-history__actions', role: 'group', 'aria-label': labels.confirm, children: [h('span', { children: labels.confirm }), h('button', { type: 'button', class: 'button', ref: cancelButton, disabled: busy, onClick: () => { setConfirm(null); }, children: labels.cancel }), h('button', { type: 'button', class: 'button detector-history__delete', disabled: busy, 'data-history-delete-confirm': row.id, onClick: async () => { await controller.current.remove(row.id);setConfirm(null); }, children: labels.remove })] }) : h('div', { class: 'detector-history__actions', children: [
          h('button', { type: 'button', class: 'button button--primary ui-button-icon', disabled: busy, 'data-history-open': row.id, onClick: () => { void controller.current.open(row.id); }, children: [h(Icon, { kind: 'open' }), labels.open] }),
          h('button', { type: 'button', class: 'button ui-button-icon', disabled: busy, 'data-history-pdf': row.id, onClick: () => { void controller.current.open(row.id, true); }, children: [h(Icon, { kind: 'pdf' }), labels.pdf] }),
          h('button', { type: 'button', class: 'button ui-button-icon detector-history__delete', ref: element => { if (element) deleteButtons.current.set(row.id, element);else deleteButtons.current.delete(row.id); }, disabled: busy, 'data-history-delete': row.id, onClick: () => { restoreDelete.current = row.id;setConfirm(row.id); }, children: [h(Icon, { kind: 'remove' }), labels.remove] }),
        ] }),
      ] })) }) : null,
    ] });
  }
  return { DetectorHistory };
}
