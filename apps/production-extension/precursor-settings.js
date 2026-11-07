// ADR-076: explicit own-page API connection; this UI never stores credentials.
import { PRECURSOR_MODES_PORT, readModesCommand, readModesReply, readModesState } from './precursor-modes-contracts.js';
import { MESSAGES, LANGUAGES } from './precursor-settings-locales.js';

const LANGUAGE_KEY = 'ui-language-v1';
const error = code => Object.assign(new Error('Precursor operation failed'), { code });
const emptyState = () => ({ status: 'disconnected', zone: null, mode: 'unknown', checkedAt: null, lastKnownMode: 'unknown', lastKnownAt: null, errorCode: null, history: [], notifications: false, connected: false });
const FRESH_MS = 180000;

export function precursorSettingsDisplayState(value, at, { timedOut = false } = {}) {
  if (timedOut) return { ...value, status: 'stale', mode: 'unknown', errorCode: 'timeout' };
  if (value.mode === 'unknown' || value.status !== 'ready') return value;
  const age = at - value.checkedAt;
  if (!Number.isSafeInteger(at) || age < 0) return { ...value, status: 'stale', mode: 'unknown', errorCode: 'clock-changed' };
  if (age > FRESH_MS) return { ...value, status: 'stale', mode: 'unknown' };
  return value;
}

export function createPrecursorSettingsClient(api, { onState = () => {}, onBusy = () => {}, onLost = () => {}, deadline = 20000, env = globalThis } = {}) {
  let port = null, pending = null, sequence = 0, disposed = false;
  const busy = () => { try { onBusy(Boolean(pending)); } catch { /* Rendering is not authority. */ } };
  const accept = state => { try { onState(state); } catch { /* Rendering is not authority. */ } };
  const ownPage = () => {
    try { const page = new URL(env.location.href), own = new URL(api.runtime.getURL('')); return env.top === env.self && page.protocol === own.protocol && page.host === own.host && page.pathname === '/precursor-settings.html' && !page.search && !page.hash; } catch { return false; }
  };
  function cancel(code) { if (!pending) return; const item = pending; pending = null; clearTimeout(item.timer); item.reject(error(code)); busy(); }
  function open() {
    if (disposed || !ownPage()) throw error('unauthorized');
    if (port) return port;
    const current = api.runtime.connect({ name: PRECURSOR_MODES_PORT }); port = current;
    current.onMessage.addListener(message => {
      if (port !== current || disposed) return;
      if (message?.schemaVersion === 1 && message.type === 'state' && Object.keys(message).length === 3) {
        if (pending?.action === 'disconnect' || pending?.expired) return;
        const state = readModesState(message.state); if (state) accept(state); return;
      }
      const reply = readModesReply(message), item = pending;
      if (!reply || !item || reply.id !== item.id) return;
      pending = null; clearTimeout(item.timer); busy();
      if (item.expired) return;
      accept(reply.state);
      if (reply.ok) item.resolve(reply.state); else item.reject(error(reply.errorCode ?? 'invalid-response'));
    });
    current.onDisconnect.addListener(() => {
      if (port !== current) return;
      void api.runtime.lastError; port = null; cancel('disconnected');
      if (!disposed) try { onLost(); } catch { /* Rendering is not authority. */ }
    });
    return current;
  }
  function request(action, payload = {}) {
    try {
      if (disposed || !ownPage() || env.document?.visibilityState === 'hidden') throw error('unauthorized');
      if (pending && action !== 'disconnect') throw error('busy');
      if (action === 'disconnect') cancel('disconnected');
      const command = readModesCommand({ schemaVersion: 1, id: ++sequence, action, ...payload });
      if (!command) throw error('invalid-input');
      const current = open();
      return new Promise((resolve, reject) => {
        const item = { id: command.id, action, resolve, reject, timer: null, expired: false }; pending = item; busy();
        // A display timeout does not release the outstanding request slot.
        item.timer = setTimeout(() => { item.expired = true; reject(error('timeout')); }, deadline);
        try { current.postMessage(command); } catch { cancel('disconnected'); }
      });
    } catch (failure) { return Promise.reject(error(failure?.code ?? 'disconnected')); }
  }
  return { request, isBusy: () => Boolean(pending), dispose() { disposed = true; cancel('disconnected'); const previous = port; port = null; previous?.disconnect(); } };
}

export function precursorSettingsLocale(value) {
  if (LANGUAGES.some(language => language.id === value)) return value;
  const base = typeof value === 'string' ? value.toLowerCase().replaceAll('_', '-').split('-')[0] : '';
  return base === 'zh' || base === 'cmn' ? 'zh_CN' : base === 'pt' ? 'pt_BR' : LANGUAGES.some(language => language.id === base) ? base : 'en';
}

export function mountPrecursorSettings({ document: doc = globalThis.document, api = globalThis.browser ?? globalThis.chrome, env = globalThis } = {}) {
  const root = doc.getElementById('precursor-settings');
  if (!root || !api?.runtime) return null;
  const find = id => doc.getElementById('pm-' + id);
  const nodes = Object.fromEntries(['form','zone-id','token','connect','disconnect','refresh','notifications','message','status','mode','zone','checked','last-known-row','last-known','history-count','empty','history-table','history-body','language'].map(id => [id, find(id)]));
  let locale = precursorSettingsLocale(api.i18n?.getUILanguage?.()), revision = 0, state = emptyState(), loaded = false, busy = false, permissionBusy = false, lastError = null, actionEpoch = 0, disposed = false, freshnessTimer = null;
  const t = key => MESSAGES[locale]['precursor_modes_' + key] ?? MESSAGES.en['precursor_modes_' + key] ?? '';
  const mode = value => t('mode_' + value);
  const date = at => {
    if (!Number.isSafeInteger(at) || at < 0 || at > 8640000000000000) return '—';
    try { return new Intl.DateTimeFormat(LANGUAGES.find(language => language.id === locale).tag, { dateStyle: 'medium', timeStyle: 'medium' }).format(at); } catch { return new Date(at).toISOString(); }
  };
  const errorText = code => t(['api-unauthorized','api-forbidden','api-not-found'].includes(code) ? 'auth_error' : ['rate-limited','cooldown'].includes(code) ? 'rate_error' : code === 'invalid-input' ? 'invalid_error' : ['permission-required','notifications-unavailable'].includes(code) ? 'permission_error' : code === 'consent-required' ? 'consent_error' : code === 'disconnected' ? 'disconnected' : code === 'session-unavailable' ? 'unavailable' : 'api_error');
  function render() {
    if (disposed) return;
    state = precursorSettingsDisplayState(state, Date.now());
    const blocked = busy || permissionBusy;
    root.setAttribute('aria-busy', String(!loaded || blocked));
    nodes.status.textContent = t(state.status); nodes.status.dataset.status = state.status;
    nodes.mode.textContent = mode(state.mode); nodes.mode.dataset.mode = state.mode;
    nodes.zone.textContent = state.zone?.name ?? '—'; nodes.checked.textContent = date(state.checkedAt);
    nodes['last-known-row'].hidden = state.mode !== 'unknown' || state.lastKnownMode === 'unknown';
    nodes['last-known'].textContent = mode(state.lastKnownMode) + (state.lastKnownAt === null ? '' : ' · ' + date(state.lastKnownAt));
    nodes.connect.disabled = !loaded || blocked || state.connected;
    nodes['zone-id'].disabled = blocked || state.connected; nodes.token.disabled = blocked || state.connected;
    nodes.disconnect.disabled = !state.connected && state.status !== 'connecting' && !busy;
    nodes.refresh.disabled = !loaded || blocked || !state.connected;
    nodes.notifications.disabled = !loaded || blocked || !api.permissions?.request;
    nodes.notifications.setAttribute('aria-checked', String(state.notifications));
    nodes.message.hidden = !(lastError || state.errorCode); nodes.message.textContent = lastError || state.errorCode ? errorText(lastError || state.errorCode) : '';
    nodes['history-count'].textContent = String(state.history.length); nodes.empty.hidden = state.history.length > 0; nodes['history-table'].hidden = state.history.length === 0;
    const rows = doc.createDocumentFragment();
    for (const event of [...state.history].reverse()) {
      const row = doc.createElement('tr');
      for (const text of [date(event.at), mode(event.from), mode(event.to)]) { const cell = doc.createElement('td'); cell.textContent = text; row.append(cell); }
      rows.append(row);
    }
    nodes['history-body'].replaceChildren(rows);
  }
  function localize() {
    doc.documentElement.lang = LANGUAGES.find(language => language.id === locale).tag; doc.documentElement.dir = ['ar','ur'].includes(locale) ? 'rtl' : 'ltr';
    for (const element of root.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
    nodes.language.value = locale; doc.title = t('title') + ' · Detect.Expert'; render();
  }
  const client = createPrecursorSettingsClient(api, { env,
    onState(value) { state = precursorSettingsDisplayState(value, Date.now()); loaded = true; if (state.status === 'ready' && ['timeout','disconnected'].includes(lastError)) lastError = null; if (state.zone && !nodes['zone-id'].value) nodes['zone-id'].value = state.zone.id; render(); },
    onBusy(value) { busy = value; render(); },
    onLost() { state = { ...state, status: 'disconnected', mode: 'unknown', checkedAt: null, connected: false }; loaded = true; lastError = 'disconnected'; render(); }
  });
  async function run(action, payload) {
    const epoch = ++actionEpoch; lastError = null; render();
    try { const operation = client.request(action, payload); payload = undefined; await operation; if (!disposed && epoch === actionEpoch) lastError = null; }
    catch (failure) { if (!disposed && epoch === actionEpoch) { lastError = failure?.code ?? 'invalid-response'; if (lastError === 'timeout') state = precursorSettingsDisplayState(state, Date.now(), { timedOut: true }); } }
    finally { if (!disposed) { loaded = true; render(); } }
  }
  function submit(event) {
    event.preventDefault(); let token = nodes.token.value; nodes.token.value = '';
    nodes.token.removeAttribute('aria-invalid'); nodes['zone-id'].removeAttribute('aria-invalid');
    const zoneId = nodes['zone-id'].value.trim();
    if (!/^[a-fA-F0-9]{32}$/.test(zoneId) || !/^[\x21-\x7e]{1,2048}$/.test(token)) {
      nodes['zone-id'].setAttribute('aria-invalid', String(!/^[a-fA-F0-9]{32}$/.test(zoneId))); nodes.token.setAttribute('aria-invalid', String(!/^[\x21-\x7e]{1,2048}$/.test(token)));
      token = ''; lastError = 'invalid-input'; render(); return;
    }
    void run('connect', { zoneId, token }); token = '';
  }
  function disconnect() { nodes.token.value = ''; void run('disconnect'); }
  function refresh() { void run('refresh'); }
  function notifications() {
    if (busy || permissionBusy || doc.visibilityState === 'hidden') return;
    if (state.notifications) { void run('notifications', { enabled: false }); return; }
    let permission; const epoch = actionEpoch;
    try {
      // The browser permission request stays in the original user gesture stack.
      permission = api.permissions.request({ permissions: ['notifications'] });
    } catch { lastError = 'permission-required'; render(); return; }
    permissionBusy = true; lastError = null; render();
    Promise.resolve(permission).then(granted => {
      if (disposed || doc.visibilityState === 'hidden' || epoch !== actionEpoch) return;
      if (granted === true) return run('notifications', { enabled: true });
      lastError = 'permission-required';
    }, () => { if (!disposed) lastError = 'permission-required'; }).finally(() => { permissionBusy = false; render(); });
  }
  function stopFreshness() { if (freshnessTimer !== null) { env.clearInterval(freshnessTimer); freshnessTimer = null; } }
  function startFreshness() {
    if (disposed || freshnessTimer !== null || doc.visibilityState === 'hidden') return;
    freshnessTimer = env.setInterval(() => {
      if (disposed || doc.visibilityState === 'hidden') { stopFreshness(); return; }
      const next = precursorSettingsDisplayState(state, Date.now());
      if (next !== state) { state = next; render(); }
    }, 1000);
  }
  function visibility() {
    if (doc.visibilityState === 'hidden') { nodes.token.value = ''; stopFreshness(); }
    else { render(); startFreshness(); if (!client.isBusy()) void run('read'); }
  }
  function storageChanged(changes, area) {
    if (area !== 'local' || !Object.hasOwn(changes, LANGUAGE_KEY)) return;
    revision++; locale = precursorSettingsLocale(changes[LANGUAGE_KEY]?.newValue ?? api.i18n?.getUILanguage?.()); localize();
  }
  async function languageChanged() {
    const value = nodes.language.value;
    if (!LANGUAGES.some(language => language.id === value)) return;
    try { await api.storage.local.set({ [LANGUAGE_KEY]: value }); } catch { lastError = 'storage-unavailable'; render(); }
  }
  for (const language of LANGUAGES) { const option = doc.createElement('option'); option.value = language.id; option.textContent = language.name; nodes.language.append(option); }
  nodes.form.addEventListener('submit', submit); nodes.disconnect.addEventListener('click', disconnect); nodes.refresh.addEventListener('click', refresh); nodes.notifications.addEventListener('click', notifications); nodes.language.addEventListener('change', languageChanged);
  doc.addEventListener('visibilitychange', visibility); api.storage.onChanged?.addListener(storageChanged);
  const initialRevision = revision;
  Promise.resolve(api.storage.local.get(LANGUAGE_KEY)).then(value => { if (!disposed && revision === initialRevision) { locale = precursorSettingsLocale(value[LANGUAGE_KEY] ?? api.i18n?.getUILanguage?.()); localize(); } }, () => {});
  localize(); startFreshness(); void run('read');
  function dispose() {
    if (disposed) return; disposed = true; actionEpoch++; stopFreshness(); nodes.token.value = ''; client.dispose();
    nodes.form.removeEventListener('submit', submit); nodes.disconnect.removeEventListener('click', disconnect); nodes.refresh.removeEventListener('click', refresh); nodes.notifications.removeEventListener('click', notifications); nodes.language.removeEventListener('change', languageChanged);
    doc.removeEventListener('visibilitychange', visibility); api.storage.onChanged?.removeListener(storageChanged); env.removeEventListener?.('pagehide', dispose);
  }
  env.addEventListener?.('pagehide', dispose, { once: true });
  return { dispose };
}

if (typeof document !== 'undefined') mountPrecursorSettings();
