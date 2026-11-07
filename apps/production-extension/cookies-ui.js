// ADR-069: explicit, local cookie management in the exact owned Options document.
import { createCookiesWorkspaceController } from './cookies-workspace-controller.js';
import { encryptCookieTransfer, decryptCookieTransfer, isEncryptedCookieTransfer } from './cookie-transfer-crypto.js';
import { COOKIE_TRANSFER_LIMITS } from './cookie-transfer-core.js';
import { parseUnixSeconds, unixSecondsToDateTime, dateTimeToUnixSeconds, localOffsetMinutes, offsetLabel, readableDateTime, relativeTime } from './cookie-time.js';
import { cookieByteSize, cookieScope, editorProblems, sameCookieIdentity, isDefaultStore } from './cookie-details.js';

const PAGE_SIZE = 100;
const MAX_IMPORT_BYTES = 22 * 1024 * 1024;
const SAME_SITES = ['unspecified', 'lax', 'strict', 'no_restriction'];
const ERROR_LABELS = Object.freeze({
  'permission-required': 'permission_required', 'permission-denied': 'permission_denied', unsupported: 'unsupported',
  unauthorized: 'inactive', inactive: 'inactive', 'not-visible': 'inactive', stale: 'stale', 'stale-record': 'stale',
    'stale-handle': 'stale', 'stale-snapshot': 'stale', 'expired-handle': 'stale', 'operation-timeout': 'timeout', timeout: 'timeout',
  busy: 'busy', 'invalid-input': 'invalid_input', 'not-applied': 'not_applied',
});
const TRANSFER_ERRORS = Object.freeze({
  'invalid-json': 'invalid_json', 'invalid-format': 'unsupported_format', 'unsupported-format': 'unsupported_format', 'unsupported-version': 'unsupported_format',
  'duplicate-cookie': 'duplicate_cookie', 'duplicate-key': 'duplicate_cookie', 'duplicate-store': 'duplicate_cookie', 'duplicate-target': 'duplicate_cookie',
  'target-required': 'store_unmapped', 'unknown-store': 'store_unmapped', 'invalid-store': 'store_unmapped', 'store-unmapped': 'store_unmapped',
  'unsupported-partition': 'unsupported_context', 'unsupported-first-party-domain': 'unsupported_context', 'unsupported-context': 'unsupported_context',
  'too-large': 'file_too_large', capacity: 'file_too_large', 'limit-exceeded': 'file_too_large', 'file-too-large': 'file_too_large',
  'decryption-failed': 'decryption_failed', 'invalid-encrypted': 'decryption_failed', 'invalid-password': 'invalid_password',
  'lossy-export': 'lossy_format', 'lossy-format': 'lossy_format', 'netscape-attributes-lost': 'lossy_format', 'netscape-store-lost': 'lossy_format',
});

export function cookieWorkspaceRows(rows, query = '', sort = 'domain') {
  const normalized = query.trim().toLocaleLowerCase();
  const filtered = rows.filter(row => !normalized || [row.name, row.domain, row.path, row.storeId, row.partitionKey?.topLevelSite ?? '', row.firstPartyDomain ?? ''].some(value => typeof value === 'string' && value.toLocaleLowerCase().includes(normalized)));
  // A domain sorts by its host name: case and the leading dot of a domain cookie (".example.com") do not matter.
  const sortValue = (row, key) => { const value = typeof row[key] === 'string' ? row[key] : ''; return key === 'domain' ? value.replace(/^\./u, '').toLowerCase() : value; };
  return [...filtered].sort((left, right) => {
    const keys = sort === 'name' ? ['name', 'domain', 'path', 'id'] : sort === 'path' ? ['path', 'domain', 'name', 'id'] : ['domain', 'path', 'name', 'id'];
    for (const key of keys) {
      const a = sortValue(left, key), b = sortValue(right, key);
      if (a < b) return -1; if (a > b) return 1;
    }
    return 0;
  });
}

export function cookieWorkspaceEditorRecord(values) {
  if (!values || typeof values !== 'object' || !SAME_SITES.includes(values.sameSite)) return null;
  // Strict decimal Unix seconds (the converter's rule); the digits go to Number() unchanged, so a fractional value from Chrome survives a save.
  let expirationDate = null;
  if (!values.session) { const parsed = parseUnixSeconds(typeof values.expirationDate === 'number' ? String(values.expirationDate) : values.expirationDate); if (!parsed.ok) return null; expirationDate = parsed.seconds; }
  let partitionKey = null;
  if (values.partitioned) {
    let site;
    try { site = new URL(values.partitionTopLevelSite); } catch { return null; }
    if (!['http:', 'https:'].includes(site.protocol) || site.username || site.password || site.pathname !== '/' || site.search || site.hash) return null;
    if (!['unspecified', 'true', 'false'].includes(values.partitionAncestor)) return null;
    partitionKey = { topLevelSite: site.origin, hasCrossSiteAncestor: values.partitionAncestor === 'unspecified' ? null : values.partitionAncestor === 'true' };
  }
  return {
    name: values.name, value: values.value, domain: values.domain, path: values.path, hostOnly: values.hostOnly === true,
    secure: values.secure === true, httpOnly: values.httpOnly === true, sameSite: values.sameSite, session: values.session === true,
    expirationDate, storeId: values.storeId, partitionKey, firstPartyDomain: values.firstPartyDomain === '' ? null : values.firstPartyDomain,
  };
}

function editorValues(record, storeId) {
  return { name: record?.name ?? '', value: record?.value ?? '', domain: record?.domain ?? '', path: record?.path ?? '/',
    hostOnly: record?.hostOnly ?? true, secure: record?.secure ?? true, httpOnly: record?.httpOnly ?? false,
    sameSite: record?.sameSite ?? 'unspecified', session: record?.session ?? true,
    expirationDate: record?.expirationDate === null || record?.expirationDate === undefined ? '' : String(record.expirationDate),
    storeId: record?.storeId ?? storeId ?? '', partitioned: record?.partitionKey !== null && record?.partitionKey !== undefined,
    partitionTopLevelSite: record?.partitionKey?.topLevelSite ?? '',
    partitionAncestor: record?.partitionKey?.hasCrossSiteAncestor === true ? 'true' : record?.partitionKey?.hasCrossSiteAncestor === false ? 'false' : 'unspecified',
    firstPartyDomain: record?.firstPartyDomain ?? '',
  };
}

export function createCookiesUi({ h, useState, useEffect, useRef, useLocale, translate, browserApi = globalThis.chrome,
  createController = createCookiesWorkspaceController, downloadFile = null }) {
  const t = (key, substitutions) => translate('cookies_workspace_' + key, substitutions);
  const common = (key, substitutions) => translate('browser_debug_' + key, substitutions);
  const fieldLabel = key => translate('browser_debug_field_' + key);
  const errorText = failure => {
    if (failure?.outcome === 'unknown') return t('unknown') + ': ' + errorText({ code: failure.code });
    const code = failure?.code;
    if (ERROR_LABELS[code]) return common(ERROR_LABELS[code]);
    if (TRANSFER_ERRORS[code]) return t('error_' + TRANSFER_ERRORS[code]);
    if (['conflict', 'ambiguous', 'expired', 'identity-change'].includes(code)) return common('stale');
    if (['invalid-cookie', 'invalid-domain', 'invalid-path', 'invalid-expiration', 'invalid-samesite', 'invalid-prefix', 'unsupported-field'].includes(code)) return common('invalid_input');
    if (code === 'existing') return t('skip_existing');
    if (code === 'unsupported-crypto' || code === 'unsupported-samesite') return common('unsupported');
    return t('operation_failed');
  };
  const yesNo = value => common(value ? 'yes' : 'no');
  function icon(kind) {
    const paths = { cookie: ['M20.8 13.2a8.9 8.9 0 1 1-10-10A5.2 5.2 0 0 0 16 8.4a5.2 5.2 0 0 0 4.8 4.8Z', 'M7 9h.01M8 15h.01M13 17h.01M14 12h.01'], import: ['M12 3v12m-4-4 4 4 4-4', 'M4 16v4h16v-4'], export: ['M12 16V4m-4 4 4-4 4 4', 'M4 16v4h16v-4'], plus: ['M12 5v14M5 12h14'], close: ['m6 6 12 12M18 6 6 18'], eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z', 'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z'], refresh: ['M20 7v5h-5', 'M19 12a7 7 0 1 0-1.3 4.1M20 7l-2-2'], undo: ['M9 5 4 10l5 5M4 10h9a6 6 0 0 1 6 6v3'], search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14', 'm20 20-4.2-4.2'], sort: ['M8 4v15m-4-4 4 4 4-4', 'M16 20V5m-4 4 4-4 4 4'], edit: ['m15 4 5 5M4 20l1-6L16 3l5 5L10 19z'], arrow: ['M5 12h14', 'm13 6 6 6-6 6'], copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'], remove: ['M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15', 'M10 10v7m4-7v7'] };
    return h('svg', { class: 'cookies-workspace-icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': true, focusable: false, children: (paths[kind] ?? paths.cookie).map(d => h('path', { d })) });
  }
  function button(label, properties = {}, glyph = null) { return h('button', { type: 'button', class: 'button', ...properties, children: [glyph ? icon(glyph) : null, h('span', { children: label })] }); }

  function CookiesApp({ active = true, tourButton = null }) {
    const locale = useLocale();
    const [foreground, setForeground] = useState(() => globalThis.document?.visibilityState !== 'hidden');
    const [access, setAccess] = useState(null), [snapshot, setSnapshot] = useState(null), [storeId, setStoreId] = useState(''), [domain, setDomain] = useState('');
    const [query, setQuery] = useState(''), [sort, setSort] = useState('domain'), [page, setPage] = useState(0), [selected, setSelected] = useState([]);
    const [revealed, setRevealed] = useState({}), [editor, setEditor] = useState(null), [transfer, setTransfer] = useState(null), [removal, setRemoval] = useState(null);
    const [result, setResult] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
    const controller = useRef(null), visible = useRef(active), mounted = useRef(false), epoch = useRef(0), operation = useRef(null), invalidation = useRef(null);
    const dialog = useRef(null), dialogOrigin = useRef(null), importFile = useRef(null);
    const viewEpoch = epoch.current;
    visible.current = active && foreground;
    const secretReset = () => { setRevealed({}); setEditor(null); setTransfer(null); setRemoval(null); };
    invalidation.current = event => {
      if (event?.reason === 'snapshot' || event?.reason === 'mutation') return;
      ++epoch.current; operation.current = null;
      if (!mounted.current) return;
      setBusy(false); secretReset(); setSnapshot(null); setSelected([]); setResult(null); setError(''); setNotice('');
      if (event?.reason === 'permissions' || event?.reason === 'disposed') setAccess(null);
    };
    if (!controller.current) controller.current = createController(browserApi, { onInvalidate: event => invalidation.current?.(event) });
    const fresh = token => mounted.current && visible.current && operation.current === token && epoch.current === token.epoch;
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; ++epoch.current; operation.current = null; controller.current.dispose(); }; }, []);
    useEffect(() => {
      const document = globalThis.document;
      const changed = () => {
        const next = document?.visibilityState !== 'hidden';
        if (!next) {
          visible.current = false; ++epoch.current; operation.current = null; controller.current.setActive(false);
          setBusy(false); secretReset(); setSnapshot(null); setSelected([]); setResult(null);
        }
        setForeground(next);
      };
      document?.addEventListener?.('visibilitychange', changed);
      return () => document?.removeEventListener?.('visibilitychange', changed);
    }, []);
    useEffect(() => {
      controller.current.setActive(active && foreground);
      if (!active || !foreground) { ++epoch.current; operation.current = null; setBusy(false); secretReset(); setSnapshot(null); setSelected([]); setResult(null); }
    }, [active, foreground]);
    // Access is read once per view epoch (activation, return to the foreground, a revoked permission); learning the answer must not trigger a second
    // read, which would meet the automatic load below inside the controller (it runs one operation at a time).
    const accessEpoch = useRef(-1), [accessRead, setAccessRead] = useState(-1);
    useEffect(() => {
      if (!active || !foreground) return undefined;
      if (access !== null && accessEpoch.current === epoch.current) return undefined;
      accessEpoch.current = epoch.current;
      let cancelled = false; const before = epoch.current;
      Promise.resolve(controller.current.access()).then(next => {
        if (cancelled || !mounted.current || !visible.current || before !== epoch.current) return;
        setAccess(next); setAccessRead(before); if (!storeId && next.stores?.length) setStoreId('*');
      }).catch(failure => { if (!cancelled && mounted.current && visible.current && before === epoch.current) setError(errorText(failure)); });
      return () => { cancelled = true; };
    }, [active, foreground, access === null]);
    const hasDialog = Boolean(editor || transfer || removal);
    useEffect(() => {
      const element = dialog.current;
      if (!hasDialog || !element) return undefined;
      const origin = dialogOrigin.current;
      try { if (!element.open) element.showModal(); } catch { element.setAttribute?.('open', ''); }
      const frame = requestAnimationFrame(() => { if (mounted.current && visible.current && element.open && element.isConnected !== false) element.querySelector('[autofocus], input:not([type=checkbox]), textarea, button')?.focus(); });
      return () => {
        cancelAnimationFrame(frame);
        try { element.close(); } catch { /* Detached dialog. */ }
        if (dialogOrigin.current === origin) dialogOrigin.current = null;
        try { if (mounted.current && visible.current && origin?.isConnected !== false) origin?.focus({ preventScroll: true }); } catch { /* Removed trigger. */ }
      };
    }, [hasDialog]);

    function rememberDialogOrigin() { if (!hasDialog) dialogOrigin.current = globalThis.document?.activeElement ?? null; }

    function begin() {
      if (!visible.current || operation.current) return null;
      const token = { epoch: epoch.current }; operation.current = token; setBusy(true); setError(''); setNotice(''); return token;
    }
    function end(token) { if (operation.current === token) { operation.current = null; if (mounted.current) setBusy(false); } }
    async function run(work, apply = () => {}, reject = () => {}) {
      const token = begin(); if (!token) return;
      try { const value = await work(() => fresh(token)); if (fresh(token)) apply(value); }
      catch (failure) { if (fresh(token)) { setError(errorText(failure)); reject(failure); } }
      finally { end(token); }
    }
    function close() {
      if (busy) return;
      if (transfer?.preview?.token) { try { controller.current.cancelImport(transfer.preview.token); } catch { /* Already expired. */ } }
      secretReset(); setError('');
    }
    function changeScope(nextStore, nextDomain) {
      if (busy || hasDialog) return;
      setStoreId(nextStore); setDomain(nextDomain); setSnapshot(null); setSelected([]); setRevealed({}); setResult(null); setPage(0); setError(''); setNotice('');
    }
    async function grant() {
      const token = begin(); if (!token) return;
      try {
        const pending = controller.current.grant(), granted = await pending;
        if (!fresh(token)) return;
        const next = await controller.current.access();
        if (fresh(token)) { setAccess(next); if (!storeId && next.stores?.length) setStoreId('*'); if (!granted) setError(common('permission_denied')); }
      } catch (failure) { if (fresh(token)) setError(errorText(failure)); }
      finally { end(token); }
    }
    const refresh = () => run(() => controller.current.load({ storeId, domain: domain.trim() }), next => { setSnapshot(next); setSelected([]); setRevealed({}); setPage(0); });
    // Once access exists the section reads every cookie of the profile by itself (all stores, all domains; the list is sorted by domain). One attempt per
    // view epoch: a page that was hidden and is shown again reads again, a failed read is not retried in a loop, and a scope the person changed is read only
    // by the button. Nothing is read while access is missing, and the values stay in the memory of this page as before.
    const autoRead = useRef(-1);
    useEffect(() => {
      if (access?.status !== 'ready' || accessRead !== epoch.current || !storeId || snapshot !== null || busy || hasDialog || !visible.current || autoRead.current === epoch.current) return;
      autoRead.current = epoch.current; refresh();
    }, [access?.status, accessRead, storeId, snapshot === null, busy, hasDialog, active, foreground]);
    const reveal = id => run(() => controller.current.reveal(id), value => setRevealed(previous => ({ ...previous, [id]: value })));
    const edit = id => {
      if (!visible.current || operation.current) return;
      rememberDialogOrigin();
      return run(() => controller.current.describe(id), record => {
        const values = editorValues(record, storeId === '*' ? stores[0]?.id : storeId);
        if (id === null && access?.capabilities?.hasCrossSiteAncestor === true) values.partitionAncestor = 'false';
        setEditor({ id, values, showValue: false, ...converterStart(values) }); setTransfer(null); setRemoval(null);
      });
    };
    function changeField(key, value) { setEditor(previous => ({ ...previous, values: { ...previous.values, [key]: value }, ...(key === 'expirationDate' || key === 'session' ? { converter: null } : {}) })); setError(''); }
    // The date/time field is a scratch pad beside the Unix-seconds value that is actually saved: only the two arrow buttons convert, nothing syncs by itself.
    function converterStart(values) {
      const shown = values.session ? null : unixSecondsToDateTime(values.expirationDate, { zone: 'local' }), text = shown?.ok ? shown.text : '';
      return { zone: 'local', datetime: text, datetimeApplied: text, converter: null, copyOf: null };
    }
    const converterFailure = (field, code) => setEditor(previous => previous ? { ...previous, converter: { field, code } } : previous);
    const focusField = id => globalThis.requestAnimationFrame?.(() => globalThis.document?.getElementById?.(id)?.focus?.());
    function changeDateTime(value) { setEditor(previous => previous ? { ...previous, datetime: value, converter: previous.converter?.field === 'datetime' ? null : previous.converter } : previous); setError(''); }
    function changeZone(value) { setEditor(previous => previous ? { ...previous, zone: value === 'utc' ? 'utc' : 'local', converter: null } : previous); }
    function convertToDateTime() {
      if (!editor || busy || editor.values.session) return;
      const converted = unixSecondsToDateTime(editor.values.expirationDate, { zone: editor.zone });
      if (!converted.ok) { converterFailure('seconds', converted.code); focusField('cookies-editor-expirationDate'); return; }
      setEditor(previous => previous ? { ...previous, datetime: converted.text, datetimeApplied: converted.text, converter: null } : previous);
    }
    function convertToSeconds() {
      if (!editor || busy || editor.values.session) return;
      const text = editor.datetime ?? '', converted = dateTimeToUnixSeconds(text, { zone: editor.zone });
      if (!converted.ok) { converterFailure('datetime', converted.code); focusField('cookies-editor-datetime'); return; }
      setEditor(previous => previous ? { ...previous, values: { ...previous.values, expirationDate: converted.text }, datetimeApplied: text, converter: null } : previous); setError('');
    }
    // Identity fields stay locked for an existing cookie; a copy unlocks them, keeps the rest and must end up as a different cookie.
    function copyAsNew() {
      if (!editor || busy || editor.id === null) return;
      setEditor(previous => previous && previous.id !== null ? { ...previous, id: null, copyOf: { ...previous.values }, converter: null } : previous); setError(''); focusField('cookies-editor-name');
    }
    const successful = next => { secretReset(); setSnapshot(null); setSelected([]); setResult(next); setNotice((next?.succeeded ?? 0) > 0 && !next.failed && !next.unknown ? common('saved') : ''); };
    function save(event) {
      event.preventDefault(); if (!editor) return;
      // Typed-but-unconverted date/time would be silently ignored (only the Unix seconds are saved): stop and say so.
      if (!editor.values.session && (editor.datetime ?? '').trim() !== '' && editor.datetime !== editor.datetimeApplied) { converterFailure('datetime', 'unapplied'); focusField('cookies-editor-datetime'); return; }
      if (editor.copyOf && sameCookieIdentity(editor.copyOf, editor.values)) { setError(t('copy_same_identity')); return; }
      const record = cookieWorkspaceEditorRecord(editor.values);
      if (!record) { setError(common('invalid_input')); return; }
      void run(() => controller.current.save(editor.id, record), successful);
    }
    function openImport() { if (busy) return; rememberDialogOrigin(); setTransfer({ mode: 'import', text: '', password: '', preview: null, storeMap: {}, policy: 'skip' }); setEditor(null); setError(''); }
    function openExport() {
      if (busy || !snapshot) return;
      rememberDialogOrigin();
      setTransfer({ mode: 'export', format: 'json', allowLossy: false, password: '', text: null, filename: '', warnings: [] }); setEditor(null); setError('');
    }
    function openRemoval(ids) { if (busy) return; rememberDialogOrigin(); setRemoval(ids); }
    function changeTransfer(key, value) {
      if (transfer?.preview?.token) { try { controller.current.cancelImport(transfer.preview.token); } catch { /* Already expired. */ } }
      setTransfer(previous => ({ ...previous, [key]: value, preview: null, ...(previous.mode === 'export' ? { text: null } : {}) })); setError('');
    }
    async function fileChange(event) {
      const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
      if (!file) return;
      if (file.size > MAX_IMPORT_BYTES) { setError(t('error_file_too_large')); return; }
      const token = begin(); if (!token) return;
      try { const text = await file.text(); if (fresh(token)) setTransfer(previous => ({ ...previous, text, preview: null })); }
      catch { if (fresh(token)) setError(common('operation_failed')); }
      finally { end(token); }
    }
    function previewImport() {
      const current = transfer;
      if (!current || !current.text) return;
      void run(async stillCurrent => {
        let text = current.text;
        if (isEncryptedCookieTransfer(text)) text = await decryptCookieTransfer(text, current.password);
        if (!stillCurrent()) return null;
        return controller.current.prepareImport(text, { storeMap: current.storeMap, policy: current.policy });
      }, preview => setTransfer(previous => ({ ...previous, preview, text: '', password: '' })));
    }
    function updateImport(patch) {
      if (!transfer?.preview?.token) { setTransfer(previous => ({ ...previous, ...patch })); return; }
      const current = transfer;
      void run(() => controller.current.updateImport(current.preview.token, { storeMap: patch.storeMap ?? current.storeMap, policy: patch.policy ?? current.policy }), preview => setTransfer(previous => ({ ...previous, ...patch, preview })), () => setTransfer(previous => ({ ...previous, preview: null, text: '', password: '' })));
    }
    function previewExport() {
      const current = transfer; if (!snapshot || !current) return;
      setTransfer(previous => ({ ...previous, text: null }));
      void run(async stillCurrent => {
        const prepared = await controller.current.prepareExport(snapshot.token, selected.length ? selected : null, { format: current.format === 'encrypted-json' ? 'json' : current.format, allowLossy: current.allowLossy });
        if (!stillCurrent()) return null;
        if (current.format !== 'encrypted-json') return prepared;
        return { ...prepared, text: await encryptCookieTransfer(prepared.text, current.password), filename: prepared.filename.replace(/\.json$/i, '') + '.encrypted.json' };
      }, prepared => setTransfer(previous => ({ ...previous, ...prepared, password: '' })));
    }
    function download() {
      if (!mounted.current || !visible.current || epoch.current !== viewEpoch || busy || typeof transfer?.text !== 'string' || transfer.mode !== 'export') return;
      if (downloadFile) { downloadFile(transfer.filename, transfer.text); return; }
      const url = URL.createObjectURL(new Blob([transfer.text], { type: transfer.format === 'netscape' ? 'text/plain' : 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = transfer.filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
    }
    function toggleSelection(id, value) { setSelected(previous => value ? [...new Set([...previous, id])] : previous.filter(item => item !== id)); }
    const rows = cookieWorkspaceRows(snapshot?.rows ?? [], query, sort), pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE)), currentPage = Math.min(page, pages - 1), shown = rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
    const available = access?.status === 'ready', stores = access?.stores ?? [], chosen = new Set(selected);
    const checkLabel = (key, value, onChange, properties = {}) => h('label', { class: 'cookies-workspace-check', children: [h('input', { type: 'checkbox', checked: value, onChange: event => onChange(event.currentTarget.checked), ...properties }), h('span', { children: key })] });
    const sameSiteLabel = value => ({ lax: 'Lax', strict: 'Strict', no_restriction: 'None' })[value] ?? t('unspecified');
    function scopePills(row) { return h('div', { class: 'cookies-workspace-pills', children: [row.hostOnly ? h('span', { class: 'cookies-workspace-pill', children: t('host_only') }) : null, row.httpOnly ? h('span', { class: 'cookies-workspace-pill cookies-workspace-pill--http', children: 'HttpOnly' }) : null, row.secure ? h('span', { class: 'cookies-workspace-pill cookies-workspace-pill--secure', children: 'Secure' }) : null, row.partitionKey ? h('span', { class: 'cookies-workspace-pill cookies-workspace-pill--partition', children: t('partitioned') }) : null, SAME_SITES.includes(row.sameSite) ? h('span', { class: 'cookies-workspace-pill cookies-workspace-pill--samesite', title: t('same_site'), children: 'SameSite: ' + sameSiteLabel(row.sameSite) }) : null] }); }
    // Expiry is cookie metadata already present in the row; the value itself stays masked until Reveal.
    function expiryCell(row) {
      if (row.session) return h('span', { class: 'cookies-workspace-pill cookies-workspace-pill--session', children: t('session') });
      const seconds = Number(row.expirationDate);
      if (!Number.isFinite(seconds) || seconds <= 0) return h('span', { class: 'cookies-workspace-path', children: '—' });
      const date = new Date(seconds * 1000), tag = (typeof locale === 'string' ? locale : locale?.id ?? 'en').replace('_', '-');
      const format = options => { try { return date.toLocaleString(tag, options); } catch { return date.toLocaleString(undefined, options); } };
      return h('span', { class: 'cookies-workspace-expiry', children: [h('span', { class: 'cookies-workspace-expiry-date', children: format({ year: 'numeric', month: 'short', day: 'numeric' }) }), h('span', { class: 'cookies-workspace-path', dir: 'ltr', children: format({ hour: '2-digit', minute: '2-digit' }) })] });
    }
    function metadataTable(items, preview = false) {
      return h('div', { class: 'cookies-workspace-table-scroll', tabIndex: 0, children: h('table', { class: 'cookies-workspace-table', children: [
        h('thead', { children: h('tr', { children: [!preview ? h('th', { class: 'cookies-workspace-select', children: checkLabel(t('select_page'), shown.length > 0 && shown.every(row => chosen.has(row.id)), checked => setSelected(previous => checked ? [...new Set([...previous, ...shown.map(row => row.id)])] : previous.filter(id => !shown.some(row => row.id === id))), { disabled: busy, 'data-cookies-select-page': true }) }) : null, h('th', { children: fieldLabel('name') }), h('th', { children: fieldLabel('domain') }), h('th', { class: 'cookies-workspace-expiry-column', children: fieldLabel('expirationDate') }), h('th', { children: preview ? common('actions') : fieldLabel('value') }), h('th', { children: preview ? common('details') : common('actions') })] }) }),
        h('tbody', { children: items.map(row => h('tr', { key: row.id, 'data-cookies-record': row.id, class: chosen.has(row.id) ? 'is-selected' : '', children: [
          !preview ? h('td', { children: checkLabel(row.name || '—', chosen.has(row.id), checked => toggleSelection(row.id, checked), { disabled: busy, 'data-cookies-select': row.id }) }) : null,
          h('td', { children: [h('strong', { dir: 'auto', class: 'cookies-workspace-name', children: row.name || '—' }), scopePills(row)] }),
          h('td', { children: [h('span', { dir: 'ltr', class: 'cookies-workspace-domain', children: row.domain }), h('span', { dir: 'ltr', class: 'cookies-workspace-path', children: row.path }), row.partitionKey ? h('span', { dir: 'ltr', class: 'cookies-workspace-path', children: row.partitionKey.topLevelSite }) : null] }),
          h('td', { class: 'cookies-workspace-expiry-column', children: expiryCell(row) }),
          h('td', { children: preview ? h('span', { class: 'cookies-workspace-action cookies-workspace-action--' + row.action, children: t('action_' + row.action) }) : Object.hasOwn(revealed, row.id) ? h('span', { class: 'cookies-workspace-value', dir: 'auto', 'data-cookies-value': row.id, children: revealed[row.id] === '' ? '""' : revealed[row.id] }) : h('span', { class: 'cookies-workspace-masked', 'aria-label': t('hidden'), children: '••••••••' }) }),
          h('td', { class: 'cookies-workspace-row-actions', children: preview ? row.code ? h('span', { children: errorText({ code: row.code }) }) : h('span', { class: 'cookies-workspace-path', dir: 'auto', children: row.storeId }) : h('div', { class: 'cookies-workspace-row-buttons', children: [button(Object.hasOwn(revealed, row.id) ? t('hide') : t('show'), { class: 'cookies-workspace-text-button', disabled: busy, 'data-cookies-reveal': row.id, onClick: () => Object.hasOwn(revealed, row.id) ? setRevealed(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => id !== row.id))) : reveal(row.id) }, 'eye'), button(common('action_edit'), { class: 'cookies-workspace-text-button', disabled: busy, 'data-cookies-edit': row.id, onClick: () => edit(row.id) }, 'edit'), button(common('action_remove'), { class: 'cookies-workspace-text-button cookies-workspace-text-button--danger', disabled: busy, 'data-cookies-remove': row.id, onClick: () => openRemoval([row.id]) }, 'remove')] }) }),
        ] })) }),
      ] }) });
    }
    function textField(key, label, properties = {}) {
      const id = 'cookies-editor-' + key;
      const limits = { name: COOKIE_TRANSFER_LIMITS.name, value: COOKIE_TRANSFER_LIMITS.value, domain: COOKIE_TRANSFER_LIMITS.domain, path: COOKIE_TRANSFER_LIMITS.path, firstPartyDomain: COOKIE_TRANSFER_LIMITS.string, partitionTopLevelSite: COOKIE_TRANSFER_LIMITS.string, expirationDate: 24 };
      return h('label', { class: 'cookies-workspace-field', htmlFor: id, children: [h('span', { children: label }), h('input', { id, value: editor.values[key], type: 'text', maxLength: limits[key] ?? 4096, autoComplete: 'off', spellcheck: false, dir: ['name', 'value', 'domain', 'path', 'expirationDate', 'partitionTopLevelSite', 'firstPartyDomain'].includes(key) ? 'ltr' : undefined, onInput: event => changeField(key, event.currentTarget.value), 'data-cookies-field': key, ...properties })] });
    }
    function editorContent() {
      if (!editor) return null;
      const values = editor.values, locked = editor.id !== null, copying = !locked && Boolean(editor.copyOf), capabilities = access?.capabilities ?? {}, browser = access?.browser ?? 'unknown', now = Date.now();
      const localeId = typeof locale === 'string' ? locale : locale?.id ?? 'en';
      const unsupported = label => label + ': ' + common('unsupported');
      const withHint = (node, id, text) => text ? h('div', { class: 'cookies-workspace-cell', children: [node, h('small', { id, class: 'cookies-workspace-hint', children: text })] }) : node;
      const sameSiteHint = capabilities.unspecifiedSameSite === false ? unsupported(t('unspecified')) : null, partitionHint = capabilities.partitionKey === false ? unsupported(t('partitioned')) : null;
      const ancestorHint = capabilities.hasCrossSiteAncestor === false ? unsupported(fieldLabel('hasCrossSiteAncestor')) : capabilities.hasCrossSiteAncestor === true && values.partitioned ? unsupported(t('unspecified')) : null, firstPartyHint = capabilities.firstPartyDomain === false ? unsupported(fieldLabel('firstPartyDomain')) : null;
      // Unix seconds are the value that is saved. The date/time field is a scratch pad beside it; only the two arrow buttons convert between them.
      const seconds = values.session ? null : parseUnixSeconds(values.expirationDate);
      const failure = editor.converter ?? (seconds && !seconds.ok ? { field: 'seconds', code: seconds.code } : null);
      const failureText = !failure ? '' : failure.field === 'seconds' ? t('converter_error_seconds')
        : failure.code === 'range' ? t('converter_error_range') : failure.code === 'gap' ? t('converter_error_gap') : failure.code === 'ambiguous' ? t('converter_error_ambiguous')
        : failure.code === 'unapplied' ? t('converter_unapplied') : t('converter_error_format');
      const described = failure ? 'cookies-converter-hint cookies-converter-message' : 'cookies-converter-hint';
      const convertButton = (kind, label, onClick) => button(label, { class: 'button cookies-workspace-convert cookies-workspace-convert--' + kind, 'aria-label': label, title: label, disabled: values.session, 'data-cookies-convert': kind, onClick }, 'arrow');
      const datetimeField = h('label', { class: 'cookies-workspace-field', htmlFor: 'cookies-editor-datetime', children: [h('span', { children: t('expiry_datetime') }),
        h('input', { id: 'cookies-editor-datetime', value: editor.datetime ?? '', type: 'text', maxLength: 48, autoComplete: 'off', spellcheck: false, dir: 'ltr', placeholder: 'YYYY-MM-DD HH:mm:ss', disabled: values.session,
          'aria-invalid': failure?.field === 'datetime' ? true : undefined, 'aria-describedby': described, onInput: event => changeDateTime(event.currentTarget.value), 'data-cookies-datetime': true })] });
      const zoneField = h('label', { class: 'cookies-workspace-field', children: [h('span', { children: t('timezone') }),
        h('select', { value: editor.zone ?? 'local', disabled: values.session, 'data-cookies-zone': true, onChange: event => changeZone(event.currentTarget.value),
          children: [h('option', { value: 'local', children: t('timezone_local', [offsetLabel(localOffsetMinutes(now))]) }), h('option', { value: 'utc', children: 'UTC' })] })] });
      // Read-only facts about the cookie as it is in the form now: when it ends, how large it is and where the browser sends it.
      const size = cookieByteSize(values.name, values.value), limit = String(COOKIE_TRANSFER_LIMITS.chromePairBytes), scope = cookieScope(values);
      let expiry = '—';
      if (values.session) expiry = t('details_session_value');
      else if (seconds?.ok) {
        const left = seconds.seconds - now / 1000;
        expiry = [left <= 0 ? h('span', { class: 'cookies-workspace-pill cookies-workspace-pill--session', children: t('details_expired') }) : null, [readableDateTime(seconds.seconds, localeId), relativeTime(left, localeId)].filter(Boolean).join(' · ')];
      }
      const detail = (key, label, children) => h('div', { class: 'cookies-workspace-detail', 'data-cookies-detail': key, children: [h('dt', { children: label }), h('dd', { children })] });
      // A host or a path inside translated text keeps its own left-to-right order in right-to-left languages: the sentence is split at the placeholder and the value isolated.
      const isolated = (key, shown) => { const marker = '\uE000', parts = t(key, [marker]).split(marker); return parts.length === 2 ? [parts[0], h('bdi', { dir: 'ltr', children: shown }), parts[1]] : t(key, [shown]); };
      // The three cookie-name prefixes keep their own left-to-right order inside right-to-left text (otherwise "__Secure-" is drawn as "-Secure__").
      const withPrefixes = message => message.split(/(__(?:Secure|Host|Http)-)/u).filter(part => part !== '').map(part => /^__(?:Secure|Host|Http)-$/u.test(part) ? h('bdi', { dir: 'ltr', children: part }) : part);
      const details = [detail('expires', fieldLabel('expirationDate'), expiry),
        detail('size', t('details_size'), browser === 'chrome' ? t('details_size_limit', [String(size), limit]) : t('details_size_value', [String(size)])),
        scope ? detail('host', t('details_host'), isolated(scope.hostOnly ? 'details_host_only' : 'details_host_domain', scope.host)) : null,
        scope?.path ? detail('path', fieldLabel('path'), isolated('details_path_value', scope.path)) : null,
        detail('connection', t('details_connection'), values.secure ? t('details_https_only') : t('details_http_https'))];
      const problems = editorProblems(values, { browser, pairLimit: COOKIE_TRANSFER_LIMITS.chromePairBytes, now });
      const problemText = { size: () => t('problem_size', [String(size), limit]), 'samesite-none': () => t('problem_samesite_none'), 'partition-secure': () => t('problem_partition_secure'), prefix: () => withPrefixes(t('problem_prefix')), expired: () => t('problem_expired'), reach: () => t('problem_reach') };
      return h('form', { onSubmit: save, class: 'cookies-workspace-dialog-body cookies-workspace-editor', children: [
        h('fieldset', { disabled: busy, class: 'cookies-workspace-fields', children: [
          locked ? h('div', { class: 'cookies-workspace-lock', 'data-cookies-lock-note': true, children: [h('p', { children: t('identity_locked') }), button(t('copy_as_new'), { class: 'button cookies-workspace-copy', 'data-cookies-copy-as-new': true, onClick: copyAsNew }, 'copy')] })
            : copying ? h('p', { class: 'cookies-workspace-lock', 'data-cookies-copy-note': true, children: t('copy_same_identity') }) : null,
          textField('name', fieldLabel('name'), { disabled: locked }), textField('domain', fieldLabel('domain'), { required: true, disabled: locked }), textField('path', fieldLabel('path'), { required: true, disabled: locked }),
          h('label', { class: 'cookies-workspace-field', children: [h('span', { children: t('store') }), h('select', { value: values.storeId, disabled: locked, 'data-cookies-field': 'storeId', onChange: event => changeField('storeId', event.currentTarget.value), children: stores.map(store => h('option', { value: store.id, children: isDefaultStore(store.id, browser) ? store.id + ' (' + t('store_default') + ')' : store.id })) })] }),
          h('div', { class: 'cookies-workspace-value-field', children: [textField('value', fieldLabel('value'), { type: editor.showValue ? 'text' : 'password' }), button(editor.showValue ? t('hide') : t('show'), { class: 'cookies-workspace-text-button', 'data-cookies-editor-reveal': true, onClick: () => setEditor(previous => ({ ...previous, showValue: !previous.showValue })) }, 'eye')] }),
          withHint(h('label', { class: 'cookies-workspace-field', children: [h('span', { children: t('same_site') }), h('select', { value: values.sameSite, 'aria-describedby': sameSiteHint ? 'cookies-hint-samesite' : undefined, 'data-cookies-field': 'sameSite', onChange: event => changeField('sameSite', event.currentTarget.value), children: SAME_SITES.map(value => h('option', { value, disabled: value === 'unspecified' && capabilities.unspecifiedSameSite === false, children: value === 'unspecified' ? t('unspecified') : value === 'no_restriction' ? 'None' : value === 'lax' ? 'Lax' : 'Strict' })) })] }), 'cookies-hint-samesite', sameSiteHint),
          h('div', { class: 'cookies-workspace-converter', 'data-cookies-converter': true, children: [
            h('div', { class: 'cookies-workspace-converter__seconds', children: textField('expirationDate', t('expiry_seconds'), { inputMode: 'decimal', disabled: values.session, 'aria-invalid': failure?.field === 'seconds' ? true : undefined, 'aria-describedby': described }) }),
            h('div', { class: 'cookies-workspace-converter__actions', children: [convertButton('forward', t('convert_to_datetime'), convertToDateTime), convertButton('back', t('convert_to_seconds'), convertToSeconds)] }),
            h('div', { class: 'cookies-workspace-converter__datetime', children: datetimeField }),
            h('div', { class: 'cookies-workspace-converter__zone', children: zoneField }),
            h('p', { id: 'cookies-converter-hint', class: 'cookies-workspace-hint cookies-workspace-converter__hint', children: t('datetime_hint') }),
            failureText ? h('p', { id: 'cookies-converter-message', role: 'alert', class: 'cookies-workspace-field-error cookies-workspace-converter__message', 'data-cookies-converter-error': failure.field + ':' + failure.code, children: failureText }) : null] }),
          h('div', { class: 'cookies-workspace-checks', children: [checkLabel(t('host_only'), values.hostOnly, value => changeField('hostOnly', value), { disabled: locked, 'data-cookies-field': 'hostOnly' }), checkLabel('Secure', values.secure, value => changeField('secure', value), { 'data-cookies-field': 'secure' }), checkLabel('HttpOnly', values.httpOnly, value => changeField('httpOnly', value), { 'data-cookies-field': 'httpOnly' }), checkLabel(t('session'), values.session, value => changeField('session', value), { 'data-cookies-field': 'session' })] }),
          h('section', { class: 'cookies-workspace-partition', children: [
            checkLabel(t('partitioned'), values.partitioned, value => changeField('partitioned', value), { disabled: locked || capabilities.partitionKey === false, 'data-cookies-field': 'partitioned' }),
            h('p', { class: 'cookies-workspace-hint cookies-workspace-partition__hint', children: partitionHint ? t('partition_hint') + ' ' + partitionHint : t('partition_hint') }),
            textField('partitionTopLevelSite', fieldLabel('partitionTopLevelSite'), { disabled: locked || !values.partitioned, type: 'url' }),
            withHint(h('label', { class: 'cookies-workspace-field', children: [h('span', { children: fieldLabel('hasCrossSiteAncestor') }), h('select', { value: values.partitionAncestor, disabled: locked || !values.partitioned || capabilities.hasCrossSiteAncestor === false, 'aria-describedby': ancestorHint ? 'cookies-hint-ancestor' : undefined, 'data-cookies-field': 'partitionAncestor', onChange: event => changeField('partitionAncestor', event.currentTarget.value), children: ['unspecified', 'true', 'false'].map(value => h('option', { value, disabled: value === 'unspecified' && capabilities.hasCrossSiteAncestor === true, children: value === 'unspecified' ? t('unspecified') : yesNo(value === 'true') })) })] }), 'cookies-hint-ancestor', ancestorHint),
            withHint(textField('firstPartyDomain', fieldLabel('firstPartyDomain'), { disabled: locked || capabilities.firstPartyDomain === false, 'aria-describedby': firstPartyHint ? 'cookies-hint-first-party' : undefined }), 'cookies-hint-first-party', firstPartyHint)] }),
          problems.length ? h('ul', { class: 'cookies-workspace-problems', role: 'status', 'data-cookies-problems': true, children: problems.map(code => h('li', { 'data-cookies-problem': code, children: problemText[code]() })) }) : null,
          h('section', { class: 'cookies-workspace-details', 'data-cookies-details': true, 'aria-labelledby': 'cookies-details-title', children: [h('h4', { id: 'cookies-details-title', children: common('details') }), h('dl', { children: details }), h('p', { class: 'cookies-workspace-hint', children: t('details_api_limits') })] }),
        ] }),
        h('footer', { class: 'cookies-workspace-dialog-actions', children: [button(common('cancel'), { disabled: busy, onClick: close, 'data-cookies-cancel': true }), button(common('save'), { type: 'submit', class: 'button button--primary', disabled: busy, 'data-cookies-save': true })] }),
      ] });
    }
    function counts(values, className = 'cookies-workspace-counts') {
      if (!values) return null;
      return h('div', { class: className, children: Object.entries(values).filter(([key, value]) => typeof value === 'number' && ['create', 'overwrite', 'skip', 'error', 'succeeded', 'failed', 'skipped', 'conflicts', 'adjusted', 'unknown', 'expired', 'total'].includes(key)).map(([key, value]) => h('span', { children: [h('strong', { children: value }), h('span', { children: t(['create', 'overwrite', 'skip', 'error'].includes(key) ? 'action_' + key : key) })] })) });
    }
    function transferContent() {
      if (!transfer) return null;
      const preview = transfer.preview;
      if (transfer.mode === 'export') return h('div', { class: 'cookies-workspace-dialog-body', children: [
        h('div', { class: 'cookies-workspace-fields', children: [h('label', { class: 'cookies-workspace-field', children: [h('span', { children: t('format') }), h('select', { value: transfer.format, disabled: busy, 'data-cookies-export-format': true, onChange: event => changeTransfer('format', event.currentTarget.value), children: ['json', 'encrypted-json', 'netscape'].map(value => h('option', { value, children: t(value.replaceAll('-', '_')) })) })] }),
          transfer.format === 'encrypted-json' ? h('label', { class: 'cookies-workspace-field', children: [h('span', { children: t('password') }), h('input', { type: 'password', value: transfer.password, autoComplete: 'new-password', minLength: 8, disabled: busy, 'data-cookies-password': true, onInput: event => changeTransfer('password', event.currentTarget.value) })] }) : null] }),
        transfer.format === 'netscape' ? checkLabel(t('allow_lossy'), transfer.allowLossy, value => changeTransfer('allowLossy', value), { disabled: busy, 'data-cookies-allow-lossy': true }) : null,
        h('p', { class: 'cookies-workspace-status', children: t('selected') + ': ' + (selected.length || snapshot?.rows.length || 0) }),
        transfer.warnings?.length ? h('div', { class: 'cookies-workspace-issues', 'data-cookies-warnings': true, children: transfer.warnings.map(item => h('p', { children: typeof item === 'string' ? errorText({ code: item }) : errorText(item) })) }) : null,
        transfer.text !== null ? h('label', { class: 'cookies-workspace-field', 'data-cookies-export-preview': true, children: [h('span', { children: common('export_preview') }), h('textarea', { readOnly: true, value: transfer.text, spellcheck: false, dir: 'ltr' })] }) : null,
        h('footer', { class: 'cookies-workspace-dialog-actions', children: [button(common('cancel'), { disabled: busy, onClick: close, 'data-cookies-cancel': true }), button(common('export_preview'), { disabled: busy || transfer.format === 'encrypted-json' && transfer.password.length < 8, onClick: previewExport, 'data-cookies-export-prepare': true }), button(common('download'), { class: 'button button--primary', disabled: busy || typeof transfer.text !== 'string', onClick: download, 'data-cookies-download': true }, 'export')] }),
      ] });
      const sourceStores = preview?.sourceStores ?? [];
      return h('div', { class: 'cookies-workspace-dialog-body', children: [
        !preview ? h('div', { class: 'cookies-workspace-import-input', children: [h('input', { type: 'file', accept: '.json,.txt,application/json,text/plain', hidden: true, ref: importFile, disabled: busy, onChange: fileChange, 'data-cookies-import-file': true }), button(t('choose_file'), { disabled: busy, onClick: () => importFile.current?.click(), 'data-cookies-file-open': true }, 'import'), h('label', { class: 'cookies-workspace-field', children: [h('span', { children: t('import_text') }), h('textarea', { value: transfer.text, maxLength: MAX_IMPORT_BYTES, disabled: busy, spellcheck: false, dir: 'ltr', 'data-cookies-import-text': true, onInput: event => changeTransfer('text', event.currentTarget.value) })] }), isEncryptedCookieTransfer(transfer.text) ? h('label', { class: 'cookies-workspace-field', children: [h('span', { children: t('password') }), h('input', { type: 'password', value: transfer.password, autoComplete: 'current-password', disabled: busy, 'data-cookies-password': true, onInput: event => changeTransfer('password', event.currentTarget.value) })] }) : null] }) : null,
        h('label', { class: 'cookies-workspace-field', children: [h('span', { children: t('conflict_policy') }), h('select', { value: transfer.policy, disabled: busy, 'data-cookies-import-policy': true, onChange: event => updateImport({ policy: event.currentTarget.value }), children: [h('option', { value: 'skip', children: t('skip_existing') }), h('option', { value: 'overwrite', children: t('overwrite_existing') })] })] }),
        sourceStores.length ? h('div', { class: 'cookies-workspace-store-map', 'data-cookies-store-map': true, children: sourceStores.map(source => { const sourceId = typeof source === 'string' ? source : source.id; return h('label', { class: 'cookies-workspace-field', children: [h('span', { children: t('source_store') + ': ' + sourceId }), h('select', { value: transfer.storeMap[sourceId] ?? '', disabled: busy, 'aria-label': t('target_store') + ': ' + sourceId, 'data-cookies-map-store': sourceId, onChange: event => updateImport({ storeMap: { ...transfer.storeMap, [sourceId]: event.currentTarget.value } }), children: [h('option', { value: '', children: t('choose_store') }), ...stores.map(store => h('option', { value: store.id, children: store.id }))] })] }); }) }) : null,
        preview ? h('section', { class: 'cookies-workspace-import-preview', 'data-cookies-import-preview': true, children: [counts(preview.counts), preview.errors?.length ? h('div', { class: 'cookies-workspace-issues', children: preview.errors.slice(0, 30).map(item => h('p', { children: (Number.isInteger(item.index) ? String(item.index + 1) + ': ' : '') + errorText(item) })) }) : null, metadataTable((preview.rows ?? []).slice((transfer.page ?? 0) * PAGE_SIZE, ((transfer.page ?? 0) + 1) * PAGE_SIZE), true), h('div', { class: 'cookies-workspace-pagination', children: [button(common('previous'), { disabled: busy || !(transfer.page > 0), 'data-cookies-preview-previous': true, onClick: () => setTransfer(previous => ({ ...previous, page: previous.page - 1 })) }), h('span', { children: String((transfer.page ?? 0) + 1) + ' / ' + Math.max(1, Math.ceil((preview.rows?.length ?? 0) / PAGE_SIZE)) }), button(common('next'), { disabled: busy || ((transfer.page ?? 0) + 1) * PAGE_SIZE >= (preview.rows?.length ?? 0), 'data-cookies-preview-next': true, onClick: () => setTransfer(previous => ({ ...previous, page: (previous.page ?? 0) + 1 })) })] })] }) : null,
        h('footer', { class: 'cookies-workspace-dialog-actions', children: [button(common('cancel'), { disabled: busy, onClick: close, 'data-cookies-cancel': true }), !preview ? button(t('preview'), { class: 'button button--primary', disabled: busy || !transfer.text, onClick: previewImport, 'data-cookies-import-prepare': true }) : button(t('apply_import'), { class: 'button button--primary', disabled: busy || Boolean(preview.errors?.length) || !preview.rows?.some(row => ['create', 'overwrite'].includes(row.action)), onClick: () => run(() => controller.current.applyImport(preview.token, null), successful, () => setTransfer(previous => ({ ...previous, preview: null, text: '', password: '' }))), 'data-cookies-import-apply': true })] }),
      ] });
    }
    const title = editor ? t(editor.id === null ? 'editor_create' : 'editor_edit') : removal ? t('delete_selected') : transfer?.mode === 'import' ? t('import') : t('export');
    return h('main', { class: 'cookies-workspace', 'data-cookies-workspace': true, 'aria-busy': busy, children: [
      h('header', { class: 'cookies-workspace-header', children: [h('div', { class: 'cookies-workspace-heading', children: [h('span', { class: 'cookies-workspace-emblem', children: icon('cookie') }), h('div', { children: h('h2', { children: 'Cookies' }) })] }), h('div', { class: 'cookies-workspace-actions', children: [button(t('import'), { disabled: busy || !available || hasDialog, 'data-cookies-import': true, onClick: openImport }, 'import'), button(t('export'), { disabled: busy || !snapshot || hasDialog, 'data-cookies-export': true, onClick: openExport }, 'export'), tourButton] })] }),
      h('section', { class: 'cookies-workspace-card', children: [
        h('div', { class: 'cookies-workspace-scope', children: [h('label', { class: 'cookies-workspace-field', children: [h('span', { children: t('store') }), h('select', { value: storeId, disabled: busy || hasDialog || !available, 'data-cookies-store': true, onChange: event => changeScope(event.currentTarget.value, domain), children: stores.length ? [h('option', { value: '*', children: t('all_stores') }), ...stores.map(store => h('option', { value: store.id, children: store.id }))] : [h('option', { value: '', children: '—' })] })] }), h('label', { class: 'cookies-workspace-field', children: [h('span', { children: fieldLabel('domain') }), h('input', { type: 'text', value: domain, maxLength: 253, dir: 'ltr', placeholder: t('all_domains'), disabled: busy || hasDialog, 'data-cookies-domain': true, autoComplete: 'off', spellcheck: false, onInput: event => changeScope(storeId, event.currentTarget.value) })] }), button(common(snapshot ? 'refresh' : 'load'), { class: 'button button--primary', disabled: busy || !available || !storeId || hasDialog, onClick: refresh, 'data-cookies-load': true }, 'refresh')] }),
        access?.status === 'permission-required' ? h('div', { class: 'cookies-workspace-access', 'data-cookies-status': 'permission-required', children: [h('p', { children: common('permission_required') }), button(common('grant'), { disabled: busy, onClick: grant, 'data-cookies-grant': true })] }) : access?.status === 'unsupported' ? h('p', { class: 'cookies-workspace-status', 'data-cookies-status': 'unsupported', children: common('unsupported') }) : null,
        error ? h('p', { role: 'alert', class: 'cookies-workspace-error', 'data-cookies-error': true, children: error }) : null,
        notice ? h('p', { role: 'status', class: 'cookies-workspace-status', children: notice }) : null,
        result ? h('section', { class: 'cookies-workspace-result', 'data-cookies-result': true, children: [counts(result), result.undoAvailable ? button(t('undo'), { disabled: busy, onClick: () => run(() => controller.current.undo(), successful), 'data-cookies-undo': true }, 'undo') : null] }) : null,
        h('div', { class: 'cookies-workspace-toolbar', children: [h('label', { class: 'cookies-workspace-field cookies-workspace-search cookies-workspace-filter', children: [h('span', { class: 'cookies-workspace-sr', children: common('search') }), icon('search'), h('input', { type: 'search', value: query, maxLength: 512, placeholder: common('search'), disabled: busy || hasDialog, 'data-cookies-search': true, onInput: event => { setQuery(event.currentTarget.value); setPage(0); } })] }), h('label', { class: 'cookies-workspace-field cookies-workspace-filter', children: [h('span', { class: 'cookies-workspace-sr', children: t('sort') }), icon('sort'), h('select', { value: sort, title: t('sort'), disabled: busy || hasDialog, 'data-cookies-sort': true, onChange: event => { setSort(event.currentTarget.value); setPage(0); }, children: ['domain', 'name', 'path'].map(key => h('option', { value: key, children: fieldLabel(key) })) })] }), button(common('action_create'), { disabled: busy || !available || !storeId || hasDialog, 'data-cookies-create': true, onClick: () => edit(null) }, 'plus')] }),
        snapshot ? h('div', { class: 'cookies-workspace-results', children: [h('div', { class: 'cookies-workspace-selection', children: [h('p', { class: 'cookies-workspace-status', 'data-cookies-count': rows.length, children: common('records') + ': ' + rows.length + (snapshot.truncated ? ' · ' + common('limited') : '') }), selected.length ? h('div', { class: 'cookies-workspace-actions', children: [h('span', { children: t('selected') + ': ' + selected.length }), button(t('clear_selection'), { disabled: busy, onClick: () => setSelected([]), 'data-cookies-clear-selection': true }), button(t('delete_selected'), { disabled: busy, onClick: () => openRemoval([...selected]), 'data-cookies-delete-selected': true })] }) : null] }), rows.length ? metadataTable(shown) : h('p', { class: 'cookies-workspace-status', children: common('empty') }), h('div', { class: 'cookies-workspace-pagination', children: [button(common('previous'), { disabled: busy || currentPage === 0, 'data-cookies-previous': true, onClick: () => setPage(currentPage - 1) }), h('span', { children: String(currentPage + 1) + ' / ' + pages }), button(common('next'), { disabled: busy || currentPage + 1 >= pages, 'data-cookies-next': true, onClick: () => setPage(currentPage + 1) })] })] }) : available ? h('p', { class: 'cookies-workspace-status', 'data-cookies-status': 'not-loaded', children: common('not_loaded') }) : null,
      ] }),
      hasDialog ? h('dialog', { class: 'cookies-workspace-dialog', ref: dialog, 'aria-labelledby': 'cookies-dialog-title', 'data-cookies-dialog': editor ? 'editor' : removal ? 'remove' : transfer.mode, onCancel: event => { event.preventDefault(); close(); }, onClose: close, children: [h('header', { class: 'cookies-workspace-dialog-header', children: [h('h3', { id: 'cookies-dialog-title', children: title }), button(t('close'), { class: 'cookies-workspace-close', disabled: busy, onClick: close, 'aria-label': t('close'), 'data-cookies-close': true }, 'close')] }), editorContent(), transferContent(), removal ? h('div', { class: 'cookies-workspace-dialog-body', children: [h('p', { children: t('delete_confirmation') + ' ' + removal.length }), h('footer', { class: 'cookies-workspace-dialog-actions', children: [button(common('cancel'), { disabled: busy, onClick: close, 'data-cookies-cancel': true }), button(common('action_remove'), { class: 'button cookies-workspace-danger', disabled: busy, 'data-cookies-delete-confirm': true, onClick: () => run(() => controller.current.remove(removal), successful) })] })] }) : null, error ? h('p', { role: 'alert', class: 'cookies-workspace-error', children: error }) : null] }) : null,
    ] });
  }
  return { CookiesApp };
}
