// ADR-063: explicit, local Browser Debug views; no collection starts on navigation.
import { createBrowserDebugController, exportBrowserDebugSnapshot } from './browser-debug-controller.js';
import { createTourEntry } from './ui-tour.js';

const PAGE_SIZE = 25;
const EMPTY = Object.freeze({ query: '', origin: '', snapshot: null, access: null, editor: null, exportText: null, page: 0, error: '', notice: '' });
const FIELD_TYPES = new Set(['text', 'string', 'url', 'boolean', 'number', 'select']);
const LABEL_FIELDS = new Set(['name', 'value', 'title', 'url', 'lastVisitTime', 'visitCount', 'parentId', 'dateAdded', 'state', 'bytesReceived', 'totalBytes', 'domain', 'path', 'expirationDate', 'secure', 'httpOnly', 'windowId', 'pinned', 'muted', 'lastModified', 'hasBeenRead', 'creationTime', 'version', 'enabled', 'type', 'installType', 'levelOfControl', 'origin', 'setting', 'primaryPattern', 'secondaryPattern', 'scope', 'storeId', 'partitionTopLevelSite', 'hasCrossSiteAncestor', 'firstPartyDomain']);
const ERROR_KEYS = Object.freeze({
  'permission-required': 'permission_required', 'permission-denied': 'permission_denied', 'unsupported': 'unsupported',
  'invalid-input': 'invalid_input', 'not-controllable': 'not_controllable', 'stale-handle': 'stale', 'stale-record': 'stale',
  'stale-snapshot': 'stale', 'expired-handle': 'stale', 'stale': 'stale', 'inactive': 'inactive', 'not-visible': 'inactive', 'not-applied': 'not_applied',
  'operation-timeout': 'timeout', 'timeout': 'timeout', 'busy': 'busy',
});

export function browserDebugValueText(value, yes = 'Yes', no = 'No') {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? yes : no;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(item => browserDebugValueText(item, yes, no)).join(', ');
  return JSON.stringify(value);
}

export function browserDebugOrigin(value) {
  let parsed;
  try { parsed = new URL(value); } catch { return null; }
  return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password && parsed.pathname === '/' && !parsed.search && !parsed.hash ? parsed.origin : null;
}

export function browserDebugEditorPatch(fields, values) {
  const patch = {};
  for (const field of fields) {
    let value = values[field.key];
    if (field.type === 'number') {
      if (value === '' && !field.required) continue;
      value = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(value)) return null;
    }
    if (field.required && (value === null || value === undefined || typeof value === 'string' && !value.trim())) return null;
    if (field.type === 'url' && value) {
      try { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null; } catch { return null; }
    }
    if (field.type === 'select' && (!Array.isArray(field.options) || !field.options.some(option => Object.is(option, value)))) return null;
    if (field.type === 'boolean' && typeof value !== 'boolean') return null;
    patch[field.key] = value;
  }
  return patch;
}

export function createBrowserDebugUi({ h, useState, useEffect, useRef, useLocale, translate, browserApi = globalThis.chrome }) {
  const { TourButton } = createTourEntry({ h, useState, useEffect, useLocale });
  const t = (key, substitutions) => translate('browser_debug_' + key, substitutions);
  function fieldLabel(key) { return LABEL_FIELDS.has(key) ? t('field_' + key) : key; }
  const text = value => browserDebugValueText(value, t('yes'), t('no'));

  function BrowserDebugApp({ active = true, onOpenApi = () => {} }) {
    const locale = useLocale(), [selected, setSelected] = useState('overview'), [views, setViews] = useState({}), [busy, setBusy] = useState(false), [accessEpoch, setAccessEpoch] = useState(0);
    const controller = useRef(null), mounted = useRef(false), visible = useRef(active), epoch = useRef(0), operation = useRef(null);
    const invalidate = useRef(null), selectedRef = useRef(selected), editorHeading = useRef(null), rail = useRef(new Map());
    selectedRef.current = selected; visible.current = active;
    function update(id, value) {
      setViews(previous => ({ ...previous, [id]: typeof value === 'function' ? value(previous[id] ?? EMPTY) : { ...(previous[id] ?? EMPTY), ...value } }));
    }
    invalidate.current = event => {
      ++epoch.current; operation.current = null;
      if (!mounted.current) return;
      setBusy(false);
      if (event?.reason === 'permissions' || event?.reason === 'disposed') {
        setViews(previous => Object.fromEntries(Object.entries(previous).map(([id, view]) => [id, { ...view, snapshot: null, editor: null, exportText: null, access: null, page: 0, error: '', notice: event.reason === 'permissions' ? t('access_changed') : '' }])));
        setAccessEpoch(value => value + 1);
      }
    };
    if (!controller.current) controller.current = createBrowserDebugController(browserApi, { onInvalidate: event => invalidate.current?.(event) });
    const datasets = controller.current.datasets;
    const dataset = datasets.find(item => item.id === selected) ?? datasets[0], id = dataset.id, view = views[id] ?? EMPTY;
    const error = failure => t(ERROR_KEYS[failure?.code] ?? 'operation_failed');
    const fresh = token => mounted.current && visible.current && epoch.current === token.epoch && operation.current === token;

    useEffect(() => {
      mounted.current = true;
      return () => { mounted.current = false; ++epoch.current; operation.current = null; controller.current.dispose(); };
    }, []);
    useEffect(() => {
      controller.current.setVisible(active);
      if (!active) { ++epoch.current; operation.current = null; setBusy(false); }
    }, [active]);
    useEffect(() => {
      if (!active) return undefined;
      let cancelled = false;
      const before = epoch.current;
      Promise.resolve(controller.current.access(id)).then(access => {
        if (!cancelled && mounted.current && visible.current && epoch.current === before) update(id, { access });
      }).catch(failure => { if (!cancelled && mounted.current && visible.current && epoch.current === before) update(id, { error: error(failure) }); });
      return () => { cancelled = true; };
    }, [id, active, accessEpoch]);

    function begin() {
      if (!visible.current || operation.current) return null;
      const token = { epoch: epoch.current };
      operation.current = token; setBusy(true); return token;
    }
    function end(token) { if (operation.current === token) { operation.current = null; if (mounted.current) setBusy(false); } }
    function choose(next) { if (!busy && datasets.some(item => item.id === next)) setSelected(next); }
    function navigation(event, index) {
      const rtl = /^(ar|ur)(?:[-_]|$)/i.test(locale), horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
      let next;
      if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = datasets.length - 1;
      else if (horizontal || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const step = horizontal ? (event.key === 'ArrowRight' ? 1 : -1) * (rtl ? -1 : 1) : event.key === 'ArrowDown' ? 1 : -1;
        next = (index + step + datasets.length) % datasets.length;
      } else return;
      event.preventDefault(); if (busy) return;
      choose(datasets[next].id); rail.current.get(datasets[next].id)?.focus();
    }
    async function load() {
      if (view.editor) return;
      const origin = dataset.origin ? browserDebugOrigin(view.origin) : undefined;
      if (dataset.origin && !origin) { update(id, { error: t('invalid_origin'), notice: '' }); return; }
      const token = begin(); if (!token) return;
      update(id, { error: '', notice: '', exportText: null });
      try {
        const snapshot = await controller.current.load(id, { query: view.query, ...(origin ? { origin } : {}), limit: 200, days: 30 });
        if (fresh(token)) update(id, { snapshot, page: 0, access: { status: 'ready', permissions: [] } });
      } catch (failure) { if (fresh(token)) update(id, { error: error(failure) }); }
      finally { end(token); }
    }
    async function grant() {
      const token = begin(); if (!token) return;
      update(id, { error: '', notice: '' });
      try {
        // Native permissions.request must run in this trusted click, before the first await.
        const request = controller.current.grant(id), granted = await request;
        if (!fresh(token)) return;
        const access = await controller.current.access(id);
        if (fresh(token)) update(id, { access, notice: granted ? t('access_granted') : '', error: granted ? '' : t('permission_denied') });
      } catch (failure) { if (fresh(token)) update(id, { error: error(failure) }); }
      finally { end(token); }
    }
    async function perform(action, handle, patch) {
      const token = begin(); if (!token) return;
      update(id, { error: '', notice: '', exportText: null });
      try {
        await controller.current.mutate(id, action, handle, patch);
        if (!fresh(token)) return;
        update(id, { editor: null, snapshot: null, notice: t('saved') });
        const origin = dataset.origin ? browserDebugOrigin(view.origin) : undefined;
        const snapshot = await controller.current.load(id, { query: view.query, ...(origin ? { origin } : {}), limit: 200, days: 30 });
        if (fresh(token)) update(id, { snapshot, page: 0 });
      } catch (failure) { if (fresh(token)) update(id, { error: error(failure) }); }
      finally { end(token); }
    }
    function start(action, row = null) {
      if (busy || !active) return;
      if (action === 'api-guard') { onOpenApi(); return; }
      if (view.editor) { editorHeading.current?.focus({ preventScroll: true }); return; }
      try {
        const description = controller.current.describe(id, action, row?.handle ?? null);
        const fields = description.fields;
        if (!Array.isArray(fields) || fields.some(field => typeof field.key !== 'string' || !FIELD_TYPES.has(field.type))) throw Error('invalid fields');
        if (!description.destructive && fields.length === 0) { void perform(action, row?.handle ?? null, {}); return; }
        const values = Object.fromEntries(fields.map(field => [field.key, field.value ?? (field.type === 'boolean' ? false : '')]));
        update(id, { editor: { action, handle: row?.handle ?? null, fields, values, original: { ...values }, destructive: description.destructive === true, label: row ? text(row.values.title ?? row.values.name ?? row.values.url ?? '') : '' }, error: '', notice: '', exportText: null });
        requestAnimationFrame(() => { if (mounted.current && selectedRef.current === id) editorHeading.current?.focus({ preventScroll: true }); });
      } catch (failure) { update(id, { error: error(failure) }); }
    }
    function cancel() { if (!busy) update(id, { editor: null, error: '', notice: '' }); }
    function changeField(field, value) { update(id, previous => ({ ...previous, error: '', editor: { ...previous.editor, values: { ...previous.editor.values, [field.key]: value } } })); }
    function save(event) {
      event.preventDefault(); if (busy || !view.editor) return;
      const patch = browserDebugEditorPatch(view.editor.fields, view.editor.values);
      if (!patch) { update(id, { error: t('invalid_input') }); return; }
      void perform(view.editor.action, view.editor.handle, patch);
    }
    function previewExport() {
      if (!view.snapshot || busy || view.editor) return;
      try { update(id, { exportText: exportBrowserDebugSnapshot(view.snapshot), error: '' }); }
      catch (failure) { update(id, { error: error(failure) }); }
    }
    function download() {
      if (typeof view.exportText !== 'string') return;
      const url = URL.createObjectURL(new Blob([view.exportText], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'browser-debug-' + id + '.json'; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    function valueNode(value, column) {
      if (typeof value === 'boolean') return h('span', { class: 'browser-debug-value browser-debug-value--boolean', children: text(value) });
      return h('span', { class: 'browser-debug-value', dir: ['url', 'origin', 'domain', 'path', 'parentId', 'windowId'].includes(column) ? 'ltr' : 'auto', children: text(value) });
    }
    function editor() {
      const current = view.editor; if (!current) return null;
      const changes = current.fields.filter(field => !Object.is(current.values[field.key], current.original[field.key]));
      return h('form', { class: 'browser-debug-editor', 'data-browser-debug-editor': current.action, onSubmit: save, 'aria-busy': busy, children: [
        h('div', { class: 'browser-debug-editor__heading', children: [h('h3', { tabIndex: -1, ref: editorHeading, children: t('action_' + current.action) }), current.label ? h('p', { dir: 'auto', children: current.label }) : null] }),
        current.destructive ? h('p', { class: 'browser-debug-destructive-note', 'data-browser-debug-confirmation': true, children: t('confirm_action') }) : null,
        h('fieldset', { disabled: busy, class: 'browser-debug-editor__fields', children: current.fields.map(field => {
          const inputId = 'browser-debug-field-' + id + '-' + field.key, common = { id: inputId, required: field.required === true, 'data-browser-debug-field': field.key, disabled: busy };
          const input = field.type === 'boolean' ? h('input', { ...common, type: 'checkbox', checked: current.values[field.key], onChange: event => changeField(field, event.currentTarget.checked) })
            : field.type === 'select' ? h('select', { ...common, value: String(field.options.findIndex(option => Object.is(option, current.values[field.key]))), onChange: event => changeField(field, field.options[Number(event.currentTarget.value)]), children: field.options.map((option, index) => h('option', { key: index, value: String(index), children: text(option) })) })
              : h('input', { ...common, type: field.type === 'string' ? 'text' : field.type, value: current.values[field.key], maxLength: 4096, spellcheck: false, autoComplete: 'off', dir: field.type === 'url' || ['origin', 'parentId', 'primaryPattern', 'secondaryPattern'].includes(field.key) ? 'ltr' : undefined, onInput: event => changeField(field, event.currentTarget.value) });
          return h('label', { key: field.key, class: field.type === 'boolean' ? 'browser-debug-field browser-debug-field--check' : 'browser-debug-field', htmlFor: inputId, children: field.type === 'boolean' ? [input, h('span', { children: fieldLabel(field.key) })] : [h('span', { children: fieldLabel(field.key) }), input] });
        }) }),
        changes.length ? h('section', { class: 'browser-debug-diff', 'data-browser-debug-diff': true, children: [h('h4', { children: t('changes') }), h('dl', { children: changes.map(field => h('div', { key: field.key, children: [h('dt', { children: fieldLabel(field.key) }), h('dd', { children: [h('del', { dir: 'auto', children: text(current.original[field.key]) }), h('span', { 'aria-hidden': true, children: ' → ' }), h('ins', { dir: 'auto', children: text(current.values[field.key]) })] })] })) })] }) : null,
        h('div', { class: 'browser-debug-actions', children: [h('button', { type: 'submit', class: 'button button--primary', disabled: busy, 'data-browser-debug-save': true, children: t(current.destructive ? 'confirm' : 'save') }), h('button', { type: 'button', class: 'button', disabled: busy, 'data-browser-debug-cancel': true, onClick: cancel, children: t('cancel') })] }),
      ] });
    }

    const rows = view.snapshot?.rows ?? [], query = view.query.trim().toLocaleLowerCase(), filtered = query ? rows.filter(row => Object.values(row.values).some(value => text(value).toLocaleLowerCase().includes(query))) : rows;
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)), page = Math.min(view.page, pages - 1), shown = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const columns = view.snapshot?.columns ?? dataset.columns;
    const unavailable = view.access?.status === 'unsupported', permissionRequired = view.access?.status === 'permission-required';
    return h('main', { class: 'browser-debug', 'data-browser-debug': true, 'aria-busy': busy, children: [
      h('header', { class: 'browser-debug-header', children: [h('div', { children: h('h2', { children: 'Browser Debug' }) }), h('div', { class: 'workspace-tools', children: [h('button', { type: 'button', class: 'button', disabled: !view.snapshot || busy || Boolean(view.editor), 'data-browser-debug-export': true, onClick: previewExport, children: t('export') }), h(TourButton, { tour: 'browser-debug' })] })] }),
      h('div', { class: 'browser-debug-layout', children: [
        h('nav', { class: 'browser-debug-datasets', 'aria-label': t('datasets'), children: datasets.map((item, index) => h('button', { key: item.id, type: 'button', class: 'browser-debug-dataset' + (id === item.id ? ' is-selected' : ''), disabled: busy, tabIndex: id === item.id ? 0 : -1, 'aria-current': id === item.id ? 'page' : undefined, 'data-browser-debug-dataset': item.id, ref: node => { if (node) rail.current.set(item.id, node); else rail.current.delete(item.id); }, onClick: () => choose(item.id), onKeyDown: event => navigation(event, index), children: [h('span', { children: t('dataset_' + item.id.replaceAll('-', '_')) }), views[item.id]?.editor ? h('span', { class: 'browser-debug-draft', children: t('draft') }) : null] })) }),
        h('section', { class: 'browser-debug-content', 'aria-label': t('dataset_' + id.replaceAll('-', '_')), 'data-browser-debug-view': id, children: [
          h('div', { class: 'browser-debug-toolbar', children: [h('h3', { children: t('dataset_' + id.replaceAll('-', '_')) }), h('div', { class: 'browser-debug-actions', children: [dataset.create ? h('button', { type: 'button', class: 'button', disabled: busy || unavailable || permissionRequired || !view.snapshot || Boolean(view.editor), 'data-browser-debug-create': true, onClick: () => start('create'), children: t('action_create') }) : null, h('button', { type: 'button', class: 'button button--primary', disabled: busy || unavailable || permissionRequired || Boolean(view.editor), 'data-browser-debug-load': true, onClick: load, children: t(view.snapshot ? 'refresh' : 'load') })] })] }),
          h('div', { class: 'browser-debug-filters', children: [h('label', { children: [h('span', { children: t('search') }), h('input', { type: 'search', value: view.query, disabled: busy || Boolean(view.editor), 'data-browser-debug-search': true, onInput: event => update(id, { query: event.currentTarget.value, page: 0 }), maxLength: 512 })] }), dataset.origin ? h('label', { children: [h('span', { children: t('origin') }), h('input', { type: 'url', value: view.origin, dir: 'ltr', placeholder: t('origin_placeholder'), disabled: busy || Boolean(view.editor), autoComplete: 'off', spellcheck: false, 'data-browser-debug-origin': true, onInput: event => update(id, { origin: event.currentTarget.value, snapshot: null, exportText: null, page: 0, notice: '' }) })] }) : null] }),
          unavailable ? h('p', { class: 'browser-debug-status', 'data-browser-debug-status': 'unsupported', children: t('unsupported') }) : permissionRequired ? h('div', { class: 'browser-debug-access', 'data-browser-debug-status': 'permission-required', children: [h('p', { children: t('permission_required') }), h('button', { type: 'button', class: 'button', disabled: busy, 'data-browser-debug-grant': true, onClick: grant, children: t('grant') })] }) : !view.snapshot ? h('p', { class: 'browser-debug-status', 'data-browser-debug-status': 'not-loaded', children: t('not_loaded') }) : null,
          view.editor ? h('p', { class: 'browser-debug-status', children: t('finish_edit') }) : null,
          view.error ? h('p', { class: 'browser-debug-error', role: 'alert', 'data-browser-debug-error': true, children: view.error }) : null,
          busy ? h('p', { class: 'browser-debug-status', role: 'status', children: t('busy') }) : null,
          view.notice ? h('p', { class: 'browser-debug-status', role: 'status', 'data-browser-debug-notice': true, children: view.notice }) : null,
          editor(),
          view.exportText !== null ? h('section', { class: 'browser-debug-export', 'data-browser-debug-export-preview': true, children: [h('h3', { children: t('export_preview') }), h('textarea', { value: view.exportText, readOnly: true, dir: 'ltr', 'aria-label': t('export_preview'), spellcheck: false }), h('div', { class: 'browser-debug-actions', children: [h('button', { type: 'button', class: 'button button--primary', 'data-browser-debug-download': true, onClick: download, children: t('download') }), h('button', { type: 'button', class: 'button', onClick: () => update(id, { exportText: null }), children: t('cancel') })] })] }) : null,
          view.snapshot ? h('div', { class: 'browser-debug-results', children: [
            h('p', { class: 'browser-debug-count', 'data-browser-debug-count': filtered.length, children: [t('records'), ': ', filtered.length.toLocaleString(locale.replaceAll('_', '-')), view.snapshot.truncated ? ' · ' + t('limited') : ''] }),
            shown.length ? h('div', { class: 'browser-debug-table-scroll', tabIndex: 0, role: 'region', 'aria-label': t('records'), children: h('table', { class: 'browser-debug-table', children: [h('thead', { children: h('tr', { children: [...columns.map(column => h('th', { key: column, scope: 'col', children: fieldLabel(column) })), h('th', { scope: 'col', children: t('actions') })] }) }), h('tbody', { children: shown.map(row => h('tr', { key: row.handle, 'data-browser-debug-record': row.handle, children: [
              ...columns.map(column => h('td', { key: column, children: valueNode(row.values[column], column) })),
              h('td', { class: 'browser-debug-row-actions', children: [h('details', { children: [h('summary', { 'data-browser-debug-details': true, children: t('details') }), h('dl', { class: 'browser-debug-record-details', children: Object.entries(row.values).map(([column, value]) => h('div', { key: column, children: [h('dt', { children: fieldLabel(column) }), h('dd', { children: valueNode(value, column) })] })) })] }), ...(row.actions ?? []).map(action => h('button', { key: action, type: 'button', class: 'button button--text', disabled: busy || Boolean(view.editor), 'data-browser-debug-action': action, onClick: () => start(action, row), children: t('action_' + action.replaceAll('-', '_')) }))] }),
            ] })) })] }) }) : h('p', { class: 'browser-debug-status', children: t('empty') }),
            pages > 1 ? h('nav', { class: 'browser-debug-pagination', 'aria-label': t('pages'), children: [h('button', { type: 'button', class: 'button', disabled: busy || page === 0, onClick: () => update(id, { page: page - 1 }), children: t('previous') }), h('span', { children: String(page + 1) + ' / ' + pages }), h('button', { type: 'button', class: 'button', disabled: busy || page + 1 >= pages, onClick: () => update(id, { page: page + 1 }), children: t('next') })] }) : null,
          ] }) : null,
        ] }),
      ] }),
    ] });
  }
  return { BrowserDebugApp };
}
