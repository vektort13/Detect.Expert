// ADR-075: explicit local run controls and redacted report previews.
import { createAutosurfClient, autosurfReportProjection } from './autosurf-client.js';
import { AUTOSURF_LIMITS, createDefaultAutosurfConfiguration, validateAutosurfConfiguration, validateAutosurfUrl } from './autosurf-shared.js';
import { createAutosurfSitesUi } from './autosurf-sites-ui.js';
import { mergeAutosurfSiteUrls } from './autosurf-sites.js';
import { createWorkspaceControlsUi } from './workspace-controls-ui.js';

const NUMBERS = Object.freeze({ sampleCount: [0, 200], cycles: [1, 5], depth: [0, 3], seed: [0, 4294967295], dwellMinSec: [5, 600], dwellMaxSec: [5, 600], gapMinSec: [1, 300], gapMaxSec: [1, 300], maxRunMinutes: [1, 480] });
const FIELD_KEYS = Object.freeze({ sampleCount: 'sample', cycles: 'cycles', depth: 'depth', seed: 'seed', dwellMinSec: 'dwell_min', dwellMaxSec: 'dwell_max', gapMinSec: 'gap_min', gapMaxSec: 'gap_max', maxRunMinutes: 'duration' });
const ERRORS = Object.freeze({ 'invalid-input': 'invalid_input', unauthorized: 'inactive', inactive: 'inactive', unsupported: 'unsupported', 'permission-required': 'permission_required', 'permission-revoked': 'access_changed', 'stale-revision': 'stale', busy: 'busy', timeout: 'timeout', 'storage-unavailable': 'operation_failed', 'native-error': 'operation_failed' });
const REASONS = Object.freeze({ challenge: 'challenge', 'http-403': 'http403', 'http-429': 'http429', 'tab-closed': 'tab_closed', 'tab-replaced': 'tab_closed', 'tab-discarded': 'tab_closed', 'window-blurred': 'foreground', 'manual-navigation': 'navigation', 'external-navigation': 'navigation', 'navigation-error': 'navigation', 'navigation-timeout': 'navigation', 'debugger-detached': 'debugger', restored: 'restored', 'run-limit': 'limit', 'result-limit': 'limit', 'clock-changed': 'clock' });
const PAGE_SIZE = 20;
const IDLE_RECONNECT_LIMIT = 3, IDLE_RECONNECT_WINDOW_MS = 60000;

export function autosurfDraft(configuration = createDefaultAutosurfConfiguration()) {
  const config = validateAutosurfConfiguration(configuration);
  return { ...config, urls: config.urls.join('\n'), ...Object.fromEntries(Object.keys(NUMBERS).map(key => [key, String(config[key])])) };
}

export function autosurfDraftResult(draft) {
  if (!draft || typeof draft.urls !== 'string' || draft.urls.length > AUTOSURF_LIMITS.configBytes) return { error: 'invalid_input', field: 'urls' };
  const lines = draft.urls.split(/\r?\n/), urls = [], seen = new Set();
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim(); if (!line) continue;
    let value; try { value = validateAutosurfUrl(line); } catch { return { error: 'invalid_url', field: 'urls', line: index + 1 }; }
    if (seen.has(value)) return { error: 'duplicate_url', field: 'urls', line: index + 1 };
    seen.add(value); urls.push(value);
  }
  if (urls.length > AUTOSURF_LIMITS.urls) return { error: 'invalid_input', field: 'urls' };
  const config = { ...draft, urls };
  for (const [key, [min, max]] of Object.entries(NUMBERS)) {
    if (typeof draft[key] !== 'string' || !/^\d{1,10}$/.test(draft[key])) return { error: 'invalid_range', field: key };
    const number = Number(draft[key]); if (!Number.isSafeInteger(number) || number < min || number > max) return { error: 'invalid_range', field: key };
    config[key] = number;
  }
  if (config.dwellMinSec > config.dwellMaxSec) return { error: 'invalid_range', field: 'dwellMinSec' };
  if (config.gapMinSec > config.gapMaxSec) return { error: 'invalid_range', field: 'gapMinSec' };
  try { return { configuration: validateAutosurfConfiguration(config) }; } catch { return { error: 'invalid_input', field: 'urls' }; }
}

export function autosurfCsvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[\s\u0000-\u001f]*[=+@-]/u.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function autosurfReportText(report, format = 'json') {
  const safe = autosurfReportProjection(report);
  if (format === 'json') return JSON.stringify(safe, null, 2);
  if (format !== 'csv') throw new Error('invalid-format');
  const columns = ['record', 'at_utc', 'origin', 'status', 'duration_ms', 'depth', 'scrolls', 'hovers', 'system_cpu_percent', 'system_memory_used_bytes', 'renderer_js_heap_bytes', 'renderer_task_duration_ms'];
  const iso = at => typeof at === 'number' && at >= 0 && at <= 8640000000000000 ? new Date(at).toISOString() : '';
  const rows = safe.visits.map(visit => ['visit', iso(visit.startedAt), visit.origin, visit.status, visit.durationMs, visit.depth, visit.scrolls, visit.hovers, '', '', '', '']);
  rows.push(...safe.samples.map(sample => ['sample', iso(sample.at), '', sample.status, '', '', '', '', sample.systemCpuPercent, sample.systemMemoryUsedBytes, sample.rendererJsHeapBytes, sample.rendererTaskDurationMs]));
  rows.push(...safe.events.map(event => ['event', iso(event.at), '', event.reason ?? event.type, '', '', '', '', '', '', '', '']));
  return [columns, ...rows].map(row => row.map(autosurfCsvCell).join(',')).join('\r\n') + '\r\n';
}

export function createAutosurfUi({ h, useState, useEffect, useRef, useLocale, translate, browserApi = globalThis.chrome, createClient = createAutosurfClient, downloadFile = null, monotonicNow = () => globalThis.performance.now() }) {
  const { WorkspaceMaster, ToolButton } = createWorkspaceControlsUi({ h });
  const { AutosurfSites } = createAutosurfSitesUi({ h, useState, useEffect, useRef, translate });
  const t = key => translate('autosurf_' + key), c = key => translate('browser_debug_' + key);
  const button = (label, props = {}) => h('button', { type: 'button', class: 'button', ...props, children: label });
  const runIcon = name => h('svg', { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': true, focusable: 'false', children: h('path', { d: ({ play: 'M8 4.5 20 12 8 19.5Z', pause: 'M6 5h4v14H6Zm8 0h4v14h-4Z', stop: 'M6 6h12v12H6Z' })[name] }) });
  const errorText = code => code === 'stale-revision' ? t('stale') : REASONS[code] ? t('reason_' + REASONS[code]) : c(ERRORS[code] ?? 'operation_failed');
  function AutosurfApp({ active = true }) {
    const locale = useLocale();
    const [snapshot, setSnapshot] = useState(null), [draft, setDraft] = useState(() => autosurfDraft()), [dirty, setDirty] = useState(false);
    const [physicalBusy, setPhysicalBusy] = useState(false), [transportReady, setTransportReady] = useState(true), [working, setWorking] = useState(false), [error, setError] = useState(null), [notice, setNotice] = useState('');
    const [foreground, setForeground] = useState(() => globalThis.document?.visibilityState !== 'hidden'), [now, setNow] = useState(Date.now), [preview, setPreview] = useState(null), [page, setPage] = useState(0);
    const [idleLoss, setIdleLoss] = useState(0);
    const client = useRef(null), mounted = useRef(false), visible = useRef(false), dirtyRef = useRef(false), draftRef = useRef(draft), transportReadyRef = useRef(true), draftRevision = useRef(null), snapshotRef = useRef(null), snapshotConnection = useRef(null), epoch = useRef(0), lock = useRef(null), form = useRef(null), previewRef = useRef(null), previewOrigin = useRef(null);
    const idleReconnect = useRef({ pending: false, attempts: [] });
    visible.current = active && foreground; dirtyRef.current = dirty;
    draftRef.current = draft;
    const updateDraft = value => { draftRef.current = value; setDraft(value); };
    const accept = (value, connection = snapshotConnection.current) => {
      if (!mounted.current || !visible.current || globalThis.document?.visibilityState === 'hidden' || !value || connection !== null && snapshotConnection.current !== null && connection < snapshotConnection.current || connection === snapshotConnection.current && value.revision < (snapshotRef.current?.revision ?? -1)) return;
      // A new native port can reach a restarted worker with a lower revision.
      // Draft edits keep their original CAS base; they are never silently rebased.
      snapshotConnection.current = connection;
      snapshotRef.current = value; setSnapshot(value);
      if (!client.current?.isBusy?.()) setError(previous => ['timeout', 'native-error'].includes(previous?.code) ? null : previous);
      if (!dirtyRef.current) { draftRevision.current = value.revision; updateDraft(autosurfDraft(value.configuration)); }
    };
    const currentStatus = snapshot?.status ?? 'not-loaded', running = currentStatus === 'running', paused = currentStatus === 'paused';
    const busy = physicalBusy || working, unavailable = !transportReady || snapshot?.reason === 'storage-unavailable';
    const editable = visible.current && snapshot !== null && !unavailable && !busy && !running && !paused;
    const recoverable = client.current?.canRecover?.() === true;
    const parsed = autosurfDraftResult(draft), supported = snapshot?.capabilities?.supported === true;
    const formatNumber = value => { try { return new Intl.NumberFormat(typeof locale === 'string' ? locale.replace('_', '-') : 'en', { maximumFractionDigits: 1 }).format(value); } catch { return String(value); } };
    const duration = value => { const seconds = Math.max(0, Math.floor((value ?? 0) / 1000)); return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0'); };
    const metric = (value, unit) => typeof value === 'number' && Number.isFinite(value) ? formatNumber(unit === 'MiB' ? value / 1048576 : value) + ' ' + unit : t('unavailable');
    function run(action, done = null, recovery = false) {
      if (!mounted.current || !visible.current || globalThis.document?.visibilityState === 'hidden' || lock.current || client.current?.isBusy?.() && !(recovery && client.current?.canRecover?.())) return Promise.resolve(null);
      const token = {}, generation = epoch.current; lock.current = token; setWorking(true); setError(null); setNotice('');
      const current = () => mounted.current && visible.current && globalThis.document?.visibilityState !== 'hidden' && epoch.current === generation && lock.current === token;
      let pending; try { pending = action(current); } catch (failure) { pending = Promise.reject(failure); }
      return Promise.resolve(pending).then(value => { if (current()) { if (value?.configuration && value?.capabilities) accept(value); done?.(value); } return value; }).catch(failure => { if (current()) setError({ code: failure?.code }); return null; }).finally(() => { if (lock.current === token) { lock.current = null; if (mounted.current) setWorking(false); } });
    }
    const change = (key, value) => { if (!editable || lock.current || client.current?.isBusy?.()) return; if (!dirtyRef.current) draftRevision.current = snapshotRef.current?.revision ?? null; dirtyRef.current = true; setDirty(true); updateDraft({ ...draftRef.current, [key]: value }); setError(null); setNotice(''); };
    function addSites(origins) {
      const value = snapshotRef.current;
      if (!editable || !mounted.current || !visible.current || !transportReadyRef.current || client.current?.isBusy?.() || lock.current || !value || value.reason === 'storage-unavailable' || ['running', 'paused'].includes(value.status)) {
        return { text: draftRef.current.urls, added: 0, duplicates: 0, changed: false, error: 'inactive' };
      }
      const result = mergeAutosurfSiteUrls(draftRef.current.urls, origins);
      if (!result.error && result.changed) change('urls', result.text);
      return result;
    }
    function save() {
      if (!editable || !snapshot) return;
      if (!parsed.configuration) { setError({ validation: parsed }); try { form.current?.querySelector('[data-autosurf-field="' + parsed.field + '"]')?.focus(); } catch {} return; }
      return run(() => client.current.save(draftRevision.current, parsed.configuration), value => { dirtyRef.current = false; draftRevision.current = value.revision; setDirty(false); updateDraft(autosurfDraft(value.configuration)); setNotice(c('saved')); });
    }
    const operate = op => {
      const value = snapshotRef.current; if (!value || !visible.current) return;
      if (op === 'pause' && value.status !== 'running' || op === 'stop' && !['running', 'paused'].includes(value.status) || op === 'resume' && (value.status !== 'paused' || !value.capabilities.supported || !transportReadyRef.current || value.reason === 'storage-unavailable')) return;
      return run(() => client.current[op](value.revision));
    };
    function invalidPlan(validation) {
      setError({ validation });
      const field = form.current?.querySelector('[data-autosurf-field="' + validation.field + '"]');
      try { field?.focus(); field?.scrollIntoView({ block: 'center' }); } catch { /* The panel can close while focusing. */ }
    }
    function play() {
      const value = snapshotRef.current;
      if (!value || !mounted.current || !visible.current || globalThis.document?.visibilityState === 'hidden' || lock.current || client.current?.isBusy?.() || !transportReadyRef.current || !value.capabilities.supported || value.reason === 'storage-unavailable') return;
      if (value.status === 'paused') return operate('resume');
      if (value.status === 'running') return;
      const candidate = autosurfDraftResult(draftRef.current);
      if (!candidate.configuration) { invalidPlan(candidate); return; }
      if (!candidate.configuration.urls.length) { invalidPlan({ field: 'urls', error: 'empty_plan' }); return; }
      // ADR-075/090: one explicit Start saves its draft and starts exactly that revision.
      const needsSave = dirtyRef.current, base = draftRevision.current;
      return run(async current => {
        let accepted = value;
        if (needsSave) {
          accepted = await client.current.save(base, candidate.configuration);
          if (!current()) return accepted;
          if (snapshotRef.current?.revision > accepted.revision) throw Object.assign(Error('stale-revision'), { code: 'stale-revision' });
          accept(accepted);
          dirtyRef.current = false; draftRevision.current = accepted.revision; setDirty(false); updateDraft(autosurfDraft(accepted.configuration));
        }
        if (!current()) return accepted;
        return client.current.start(accepted.revision);
      });
    }
    const refresh = () => {
      idleReconnect.current.pending = false;
      return run(() => {
      const current = client.current;
      // Retrying failed initialization may legitimately reset the revision after
      // the old checkpoint was cleared. A new read port establishes that boundary.
      return (current.canRecover?.() || snapshotRef.current?.reason === 'storage-unavailable') && typeof current.recover === 'function' ? current.recover() : current.load();
      }, null, true);
    };
    function showPreview(format) { previewOrigin.current = globalThis.document?.activeElement; return run(() => client.current.export(), value => { const text = autosurfReportText(value, format); if (text.length > 2 * AUTOSURF_LIMITS.checkpointBytes) { setError({ code: 'invalid-input' }); return; } setPreview({ format, text, runId: value.runId ?? 'report' }); }); }
    function closePreview() { setPreview(null); try { previewOrigin.current?.focus?.({ preventScroll: true }); } catch {} }
    function download() {
      if (!visible.current || !preview) return;
      const filename = 'detect-expert-autosurf-' + preview.runId + '.' + preview.format;
      try {
        if (downloadFile) downloadFile(filename, preview.text, preview.format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8');
        else { const blob = new Blob([preview.text], { type: preview.format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8' }), url = URL.createObjectURL(blob), anchor = document.createElement('a'); try { anchor.href = url; anchor.download = filename; anchor.hidden = true; document.body.appendChild(anchor); anchor.click(); } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); } }
      } catch { setError({ code: 'native-error' }); }
    }
    useEffect(() => {
      mounted.current = true;
      client.current = createClient(browserApi, { env: globalThis, onChange: accept, onBusyChange: (value, ready = true) => { if (mounted.current) { transportReadyRef.current = ready; setPhysicalBusy(value); setTransportReady(ready); } }, onIdleDisconnect: () => { if (mounted.current) { idleReconnect.current.pending = true; setIdleLoss(value => value + 1); } } });
      return () => { mounted.current = false; ++epoch.current; client.current?.dispose(); client.current = null; };
    }, []);
    useEffect(() => { const follow = () => setForeground(globalThis.document?.visibilityState !== 'hidden'); globalThis.document?.addEventListener('visibilitychange', follow); return () => globalThis.document?.removeEventListener('visibilitychange', follow); }, []);
    useEffect(() => {
      const shown = active && foreground; client.current?.setActive?.(shown);
      // Returning to the workspace already performs its own authoritative read.
      idleReconnect.current.pending = false;
      if (!shown) { ++epoch.current; setPreview(null); return; }
      if (!client.current?.isBusy?.()) void run(() => client.current.load());
      const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer);
    }, [active, foreground]);
    useEffect(() => {
      const recovery = idleReconnect.current;
      if (!recovery.pending) return;
      if (!visible.current || transportReadyRef.current) { recovery.pending = false; return; }
      if (lock.current || client.current?.isBusy?.()) return;
      // Consume before starting: a failed read cannot schedule another read.
      recovery.pending = false;
      const stamp = monotonicNow();
      recovery.attempts = recovery.attempts.filter(at => at <= stamp && stamp - at < IDLE_RECONNECT_WINDOW_MS);
      if (recovery.attempts.length >= IDLE_RECONNECT_LIMIT) { setError({ code: 'native-error' }); return; }
      recovery.attempts.push(stamp);
      void run(() => client.current.load());
    }, [idleLoss, active, foreground, physicalBusy, working, transportReady]);
    useEffect(() => { const before = event => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ''; } }; globalThis.addEventListener?.('beforeunload', before); return () => globalThis.removeEventListener?.('beforeunload', before); }, []);
    useEffect(() => { if (preview) { try { previewRef.current?.focus(); } catch {} } }, [preview]);
    useEffect(() => { setPage(0); }, [snapshot?.runId]);
    const visits = snapshot?.visits ?? [], pageCount = Math.max(1, Math.ceil(visits.length / PAGE_SIZE)), currentPage = Math.min(page, pageCount - 1), sample = snapshot?.samples?.at(-1);
    const elapsedClock = ['completed', 'stopped', 'error'].includes(currentStatus) ? snapshot?.events?.at(-1)?.at ?? now : now;
    const field = key => h('label', { class: 'autosurf-field', children: [h('span', { children: t(FIELD_KEYS[key]) }), h('input', { type: 'number', inputMode: 'numeric', min: NUMBERS[key][0], max: NUMBERS[key][1], step: 1, value: draft[key], disabled: !editable, 'data-autosurf-field': key, 'aria-invalid': error?.validation?.field === key ? 'true' : undefined, onInput: event => change(key, event.currentTarget.value) })] });
    const checkbox = key => h('label', { class: 'autosurf-check', children: [h('input', { type: 'checkbox', checked: draft[key], disabled: !editable, 'data-autosurf-field': key, onChange: event => change(key, event.currentTarget.checked) }), h('span', { children: t(key) })] });
    const validationText = error?.validation ? (error.validation.error === 'invalid_input' ? c('invalid_input') : t(error.validation.error)) + (error.validation.line ? ' · ' + t('line') + ' ' + error.validation.line : '') : null;
    return h('div', { class: 'autosurf-workspace', hidden: !active, 'data-autosurf-workspace': true, children: [
      WorkspaceMaster({ id: 'autosurf', label: t('title'), busy, tools: ToolButton({ icon: 'refresh', label: c('refresh'), disabled: !visible.current || busy && !recoverable, onClick: refresh, 'data-autosurf-refresh': true }), control: button(running || paused ? 'ON' : 'OFF', { class: 'button workspace-master-toggle workspace-master-toggle--' + (running || paused ? 'on' : 'off'), role: 'switch', 'aria-checked': running || paused, 'aria-label': t('title'), title: running || paused ? t('stop') : t('start'), disabled: !visible.current || !transportReady || busy || !snapshot || !running && !paused && (unavailable || !supported), onClick: () => ['running', 'paused'].includes(snapshotRef.current?.status) ? operate('stop') : play(), 'data-autosurf-master': true }), children: h('span', { class: 'autosurf-status autosurf-status--' + currentStatus, role: 'status', 'aria-live': 'polite', 'data-autosurf-status': currentStatus, children: snapshot ? t('status_' + currentStatus) : c('not_loaded') }) }),
      error ? h('p', { class: 'autosurf-message autosurf-error', role: 'alert', 'data-autosurf-error': true, children: validationText ?? errorText(error.code) }) : null,
      notice ? h('p', { class: 'autosurf-message', role: 'status', children: notice }) : null,
      snapshot && !supported ? h('p', { class: 'autosurf-message', 'data-autosurf-unsupported': true, children: t('chrome_required') }) : null,
      h(AutosurfSites, { locale, currentUrls: draft.urls, disabled: !editable, onAdd: addSites }),
      h('section', { class: 'autosurf-card autosurf-run', 'aria-labelledby': 'autosurf-run-title', children: [
        h('div', { class: 'autosurf-toolbar', children: h('h3', { id: 'autosurf-run-title', children: t('status') }) }),
        snapshot?.reason && !['user-paused', 'user-stopped', 'complete'].includes(snapshot.reason) ? h('p', { class: 'autosurf-reason', children: errorText(snapshot.reason) }) : null,
        h('div', { class: 'autosurf-progress-heading', children: [h('span', { children: t('progress') }), h('strong', { children: (snapshot?.progress.completed ?? 0) + ' / ' + (snapshot?.progress.total ?? 0) })] }),
        h('progress', { max: Math.max(1, snapshot?.progress.total ?? 1), value: snapshot?.progress.completed ?? 0, 'aria-label': t('progress') }),
        h('dl', { class: 'autosurf-summary', children: [h('div', { children: [h('dt', { children: t('current') }), h('dd', { dir: 'ltr', children: snapshot?.current?.origin || '—' })] }), h('div', { children: [h('dt', { children: t('phase') }), h('dd', { children: snapshot?.phase ? t('phase_' + snapshot.phase) : '—' })] }), h('div', { children: [h('dt', { children: t('elapsed') }), h('dd', { dir: 'ltr', children: snapshot?.startedAt ? duration(elapsedClock - snapshot.startedAt) : '—' })] }), h('div', { children: [h('dt', { children: t('remaining') }), h('dd', { dir: 'ltr', children: running && snapshot?.deadlineAt ? duration(snapshot.deadlineAt - now) : '—' })] })] }),
        h('div', { class: 'autosurf-run-controls', role: 'group', 'aria-label': t('status'), children: [
          button(runIcon('play'), { class: 'autosurf-run-control autosurf-run-control--play', 'aria-label': paused ? c('action_resume') : t('start'), title: paused ? c('action_resume') : t('start'), disabled: !visible.current || unavailable || busy || !snapshot || !supported || running, onClick: play, 'data-autosurf-action': paused ? 'resume' : 'start', 'data-autosurf-run-control': 'play' }),
          button(runIcon('pause'), { class: 'autosurf-run-control autosurf-run-control--pause', 'aria-label': c('action_pause'), title: c('action_pause'), disabled: !visible.current || !transportReady || busy || !running, onClick: () => operate('pause'), 'data-autosurf-action': 'pause', 'data-autosurf-run-control': 'pause' }),
          button(runIcon('stop'), { class: 'autosurf-run-control autosurf-run-control--stop', 'aria-label': t('stop'), title: t('stop'), disabled: !visible.current || !transportReady || busy || !running && !paused, onClick: () => operate('stop'), 'data-autosurf-action': 'stop', 'data-autosurf-run-control': 'stop' }),
        ] }),
      ] }),
      h('form', { class: 'autosurf-card', ref: form, onSubmit: event => { event.preventDefault(); void save(); }, 'aria-labelledby': 'autosurf-settings-title', children: [
        h('div', { class: 'autosurf-toolbar', children: [h('h3', { id: 'autosurf-settings-title', children: t('settings') }), dirty ? h('span', { role: 'status', class: 'autosurf-dirty', children: t('dirty') }) : null] }),
        h('label', { class: 'autosurf-field', children: [h('span', { children: t('urls') }), h('textarea', { value: draft.urls, rows: 7, maxLength: AUTOSURF_LIMITS.configBytes, disabled: !editable, dir: 'ltr', spellcheck: false, autocapitalize: 'off', autocomplete: 'off', 'aria-describedby': 'autosurf-urls-help', 'aria-invalid': error?.validation?.field === 'urls' ? 'true' : undefined, 'data-autosurf-field': 'urls', onInput: event => change('urls', event.currentTarget.value) }), h('small', { id: 'autosurf-urls-help', children: t('urls_help') })] }),
        h('div', { class: 'autosurf-fields', children: [field('sampleCount'), field('cycles'), field('depth'), field('seed'), h('label', { class: 'autosurf-field', children: [h('span', { children: t('order') }), h('select', { value: draft.order, disabled: !editable, 'data-autosurf-field': 'order', onChange: event => change('order', event.currentTarget.value), children: ['sequential', 'shuffle'].map(value => h('option', { value, children: t(value) })) })] }), field('maxRunMinutes'), field('dwellMinSec'), field('dwellMaxSec'), field('gapMinSec'), field('gapMaxSec')] }),
        h('div', { class: 'autosurf-checks', children: [checkbox('scroll'), checkbox('hover'), checkbox('metrics')] }),
        draft.metrics ? button(t('grant_metrics'), { disabled: !visible.current || unavailable || busy || !supported, onClick: () => run(() => client.current.requestMetricsAccess(), () => setNotice(t('metrics_granted'))), 'data-autosurf-grant': true }) : null,
        h('div', { class: 'autosurf-toolbar', children: [button(c('save'), { disabled: !editable || !dirty || !snapshot, onClick: save, 'data-autosurf-save': true }), button(t('discard'), { disabled: !editable || !dirty || !snapshot, onClick: () => { dirtyRef.current = false; draftRevision.current = snapshot.revision; setDirty(false); updateDraft(autosurfDraft(snapshot.configuration)); setError(null); }, 'data-autosurf-discard': true })] }),
      ] }),
      h('section', { class: 'autosurf-card', 'aria-labelledby': 'autosurf-metrics-title', children: [h('h3', { id: 'autosurf-metrics-title', children: t('metrics_title') }), h('dl', { class: 'autosurf-metrics', children: [['system_cpu', sample?.systemCpuPercent, '%'], ['system_ram', sample?.systemMemoryUsedBytes, 'MiB'], ['renderer_heap', sample?.rendererJsHeapBytes, 'MiB'], ['renderer_task', sample?.rendererTaskDurationMs, 'ms'], ['gpu', null, '%']].map(([label, value, unit]) => h('div', { children: [h('dt', { children: t(label) }), h('dd', { 'data-autosurf-metric': label, children: metric(value, unit) })] })) }), sample?.at ? h('small', { children: t('sample_time') + ': ' + new Date(sample.at).toISOString() }) : null] }),
      h('section', { class: 'autosurf-card', 'aria-labelledby': 'autosurf-results-title', children: [h('div', { class: 'autosurf-toolbar', children: [h('h3', { id: 'autosurf-results-title', children: t('results') }), h('div', { class: 'autosurf-actions', children: [button(t('preview') + ' JSON', { disabled: !visible.current || busy || !snapshot?.runId, onClick: () => showPreview('json'), 'data-autosurf-export': 'json' }), button(t('preview') + ' CSV', { disabled: !visible.current || busy || !snapshot?.runId, onClick: () => showPreview('csv'), 'data-autosurf-export': 'csv' }), button(t('clear_report'), { disabled: !visible.current || unavailable || busy || running || !snapshot?.runId, onClick: () => operate('clear'), 'data-autosurf-action': 'clear' })] })] }),
        visits.length ? h('div', { class: 'autosurf-table-wrap', children: h('table', { class: 'autosurf-visits', children: [h('thead', { children: h('tr', { children: ['current', 'status', 'elapsed', 'depth', 'scroll', 'hover'].map(key => h('th', { scope: 'col', children: t(key) })) }) }), h('tbody', { children: visits.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((visit, index) => h('tr', { key: currentPage * PAGE_SIZE + index, children: [h('td', { dir: 'ltr', class: 'autosurf-visit-origin', children: visit.origin }), h('td', { children: h('span', { class: 'autosurf-visit-status autosurf-visit-status--' + (visit.status === 'completed' ? 'completed' : 'interrupted'), children: visit.status === 'completed' ? t('status_completed') : t('interrupted') }) }), h('td', { dir: 'ltr', class: 'autosurf-visit-number', children: duration(visit.durationMs) }), h('td', { class: 'autosurf-visit-number', children: visit.depth }), h('td', { class: 'autosurf-visit-number', children: visit.scrolls ?? 0 }), h('td', { class: 'autosurf-visit-number', children: visit.hovers ?? 0 })] })) })] }) }) : h('p', { class: 'autosurf-empty', children: t('no_results') }),
        pageCount > 1 ? h('div', { class: 'autosurf-toolbar', children: [button(c('previous'), { disabled: currentPage === 0, onClick: () => setPage(currentPage - 1) }), h('span', { children: (currentPage + 1) + ' / ' + pageCount }), button(c('next'), { disabled: currentPage >= pageCount - 1, onClick: () => setPage(currentPage + 1) })] }) : null,
      ] }),
      preview ? h('section', { class: 'autosurf-card autosurf-preview', role: 'region', 'aria-labelledby': 'autosurf-preview-title', tabIndex: -1, ref: previewRef, onKeyDown: event => { if (event.key === 'Escape') { event.preventDefault(); closePreview(); } }, 'data-autosurf-preview': preview.format, children: [h('div', { class: 'autosurf-toolbar', children: [h('h3', { id: 'autosurf-preview-title', children: t('preview') + ' ' + preview.format.toUpperCase() }), button(t('close'), { onClick: closePreview })] }), h('textarea', { readOnly: true, value: preview.text, dir: 'ltr', rows: 12, spellcheck: false, 'aria-label': t('preview') + ' ' + preview.format.toUpperCase() }), button(t('download') + ' ' + preview.format.toUpperCase(), { onClick: download, 'data-autosurf-download': true })] }) : null,
    ] });
  }
  return { AutosurfApp };
}
