// ADR-070/071/103/107 E22-25: explicit proxy management in the owned Options document. This file owns the state and every action of
// the Proxy workspace (lifecycle, credentials in memory only, checks, history, import); how it looks lives in the proxy-*-ui modules.
import { createProxyClient } from './proxy-client.js';
import { exportProxyConfiguration, parseProxyProfileText, parseProxyProfileList, inspectProxyText, proxyEndpointLabel, normalizeVlessUri, validateProxyDiagnosticUrl, proxyNeedsNative, PROXY_LIMITS, PROXY_LIST_REASONS, PROXY_SAFE_CODES, PROXY_PHASES, PROXY_TYPES, PROXY_DIRECT_TYPES } from './proxy-shared.js';
import { createWorkspaceControlsUi } from './workspace-controls-ui.js';
import { createProxyHistoryStore, proxyHistoryEntry, proxyHistoryOf, proxyHistoryRows } from './proxy-history.js';
import { regionPicker, searchRegions, languageTag } from './fingerprint-region-names.js';
import { announce as announceDefault } from './ui-announcer.js';
import { BUNDLES_KEY, readBundles, profilesOfProxy } from './identity-bundles.js';
import { createProxyIcons } from './proxy-ui-icons.js';
import { createProxyListUi, TYPE_LABELS, formatText } from './proxy-list-ui.js';
import { createProxyPeekUi } from './proxy-peek-ui.js';
import { createProxySheetUi } from './proxy-sheet-ui.js';
import { createProxyRouteUi } from './proxy-route-ui.js';
import { createGeoController } from './proxy-geo-controller.js';
import { proxyGeoManagerLabels } from './proxy-geo-manager-labels.js';
import { GEO_COLUMNS, geoCanonicalIp, geoIsPublicIp } from './proxy-geo-shared.js';
import { readGeoBannerDismissed, writeGeoBannerDismissed, proxyGeoOn, proxyGeoReady, proxyGeoBannerState, proxyGeoColumns, proxyGeoRowInfo, proxyGeoPublicExitIp, proxyGeoLookupTargets, proxyGeoProviderName, proxyGeoPluralKey, proxyGeoErrorKey, proxyGeoShowsFailure } from './proxy-geo-ui-model.js';
import { proxyFilterProfiles, proxyCompare, proxyFacetCounts, proxyCountriesPresent, proxyHasFilters, proxyMergedChecks, proxyToggleSelection, proxySelectRange, proxyReconcileSelection, proxyGridKeyAction, proxyRovingTarget, runProxyCheckQueue, proxyDomainEntry, proxyDomainTokens, proxyDraftErrors, readProxyView, writeProxyView, clearProxyView, DEFAULT_PROXY_VIEW, proxyViewPatch, localViewStorage, PROXY_STATUS_FILTERS } from './proxy-ui-model.js';

const TYPES = PROXY_TYPES;
// SOCKS5, HTTP and HTTPS share one editor: host, port and an optional login. The browser reaches them itself until a login is set.
const DIRECT = PROXY_DIRECT_TYPES;
const LABELS = TYPE_LABELS;
// Prefilled in a new profile's port field and editable; a convention of each kind, not a claim about the user's provider.
const DEFAULT_PORTS = Object.freeze({ socks5: '1080', http: '8080', https: '443' });
const MAX_CONFIG = PROXY_LIMITS.openVpnBytes;
const SAFE_CODES = new Set(PROXY_SAFE_CODES);
const DEFAULT_CHECK_URL = 'https://api.ipify.org/?format=json';
const STATES = new Set(['off', 'connecting', 'connected', 'blocked', 'error', 'conflict', 'permission-required']);
const ERROR_KEYS = Object.freeze({ 'permission-required': 'permission_required', 'permission-denied': 'permission_denied', 'privacy-permission-required': 'permission_required', 'privacy-conflict': 'not_controllable', 'privacy-unavailable': 'unsupported', 'invalid-config': 'invalid_input', 'invalid-profile': 'invalid_input', 'invalid-input': 'invalid_input', 'stale': 'stale', 'stale-revision': 'stale', 'revision-conflict': 'stale', 'conflict': 'stale', 'not-controllable': 'not_controllable', 'operation-timeout': 'timeout', 'timeout': 'timeout', 'busy': 'busy', 'unsupported': 'unsupported', 'inactive': 'inactive', 'unauthorized': 'inactive' });
const DIAGNOSTICS = Object.freeze({ 'auth-failed': 'auth', 'auth-required': 'auth_required', 'dns-failed': 'dns', 'connection-refused': 'connection', 'connection-failed': 'connection', 'tls-failed': 'tls', 'reality-failed': 'reality', 'invalid-config': 'config', 'invalid-config-file': 'config', 'invalid-profile': 'config', 'engine-missing': 'engine_missing', 'engine-unavailable': 'engine_missing', 'engine-failed': 'engine_failed', 'proxy-error': 'proxy', 'tunnel-disconnected': 'disconnected', 'native-disconnected': 'disconnected', 'unsupported-profile': 'unsupported', 'native-unsupported': 'unsupported', 'vault-unavailable': 'vault', 'identity-required': 'identity', 'active-vpn': 'active_vpn', 'proxy-denied': 'proxy_denied', 'network-unreachable': 'network_unreachable', 'host-unreachable': 'host_unreachable' });
// An older companion cannot dial an HTTP or HTTPS upstream and says so with these codes; for such a profile the fix is an update.
const UPDATE_COMPANION = new Set(['unsupported-profile', 'native-unsupported']);
const FIELD_ERROR_KEYS = Object.freeze({ name: 'err_name', host: 'err_host', port: 'err_port', uri: 'err_uri', config: 'err_config' });
// How many manual checks may run at once. The service answers one request at a time (a second one is refused as busy), so the queue
// runs one; the queue itself is generic and tested with more.
export const PROXY_CHECK_CONCURRENCY = 1;
const TICK_MS = 30000, SKELETON_DELAY_MS = 150, SKELETON_MIN_MS = 400, ANNOUNCE_DELAY_MS = 450;

const STATUS_FILTERS = PROXY_STATUS_FILTERS;
const REASON_KEYS = Object.freeze(Object.fromEntries(PROXY_LIST_REASONS.map(reason => [reason, 'reason_' + reason.replaceAll('-', '_')])));
const SESSION_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
export const PROXY_SESSION_FORMAT = '-session-{session}';
// The last manual result only; a running check keeps the previous state.
export function proxyCheckState(checks, profile) {
  const state = checks && Object.hasOwn(checks, profile.id) ? checks[profile.id]?.diagnostic?.state : null;
  return state === 'pass' || state === 'fail' ? state : 'unchecked';
}
export function proxyVisibleProfiles(profiles, query = '', type = 'all', status = 'all', checks = {}, country = 'all') {
  return proxyFilterProfiles(profiles, { query, type, status, country }, checks);
}
// Editor-only session helper: the user-visible format names where the token
// goes. A matching part at the end of the field is replaced, otherwise the
// rendered part is appended; the start of a login is never rewritten.
export function proxySessionFormatValid(format) {
  if (typeof format !== 'string' || format.length > 64 || /[\s\x00-\x1f\x7f]/.test(format)) return false;
  const parts = format.split('{session}');
  return parts.length === 2 && parts[0].length > 0;
}
export function proxyApplySession(value, format, token) {
  if (typeof value !== 'string' || !proxySessionFormatValid(format) || typeof token !== 'string' || !/^[a-z0-9]{6,32}$/.test(token)) return null;
  const [before, after] = format.split('{session}'), escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rendered = before + token + after, previous = new RegExp(escape(before) + '[A-Za-z0-9]+' + escape(after) + '$');
  return previous.test(value) ? value.replace(previous, () => rendered) : value + rendered;
}
export function proxySessionToken(length = 10, random = globalThis.crypto) {
  let token = '';
  // Rejection sampling keeps all 36 characters equally likely.
  while (token.length < length) for (const byte of random.getRandomValues(new Uint8Array(length * 2))) if (byte < 252 && token.length < length) token += SESSION_ALPHABET[byte % 36];
  return token;
}
// One parsed list row becomes the same input the single editor sends to Save.
export function proxyBulkInput(entry, id) {
  const profile = entry?.profile;
  if (!profile || typeof id !== 'string' || typeof entry.name !== 'string') return null;
  if (profile.type === 'vless') return typeof profile.uri === 'string' ? { id, name: entry.name, type: 'vless', uri: profile.uri } : null;
  if (!DIRECT.includes(profile.type) || typeof profile.host !== 'string' || !Number.isInteger(profile.port) || typeof profile.username !== 'string' || typeof profile.password !== 'string') return null;
  return { id, name: entry.name, type: profile.type, host: profile.host, port: profile.port, ...(profile.username || profile.password ? { username: profile.username, password: profile.password } : {}) };
}
// The list order: filters first, then the sort. `sort` keeps the existing keys; `extra` adds the country filter and the direction
// ('checked' stays newest first unless a direction is given).
export function proxySortedProfiles(profiles, query = '', type = 'all', sort = 'name', checks = {}, status = 'all', extra = {}) {
  const dir = extra.dir ?? (sort === 'checked' ? 'desc' : 'asc');
  return proxyFilterProfiles(profiles, { query, type, status, country: extra.country ?? 'all' }, checks).sort(proxyCompare(sort, dir, checks));
}
export function proxyProfileDraft(profile = null, type = 'socks5') {
  const kind = profile?.type ?? type;
  return { id: profile?.id ?? null, name: profile?.name ?? '', type: kind, host: profile?.host ?? '', port: profile?.port == null ? DEFAULT_PORTS[kind] ?? '1080' : String(profile.port), username: '', password: '', uri: '', config: '', country: typeof profile?.country === 'string' ? profile.country : '' };
}
export function proxyDraftFromBundle(profile, bundle) {
  const record = bundle?.format === 'detect.expert.proxy.bundle' && bundle.version === 1 && Array.isArray(bundle.profiles) ? bundle.profiles.find(value => value.id === profile.id) : null;
  const connection = record?.connection;
  if (!record || record.type !== profile.type || connection?.type !== record.type) return null;
  const draft = proxyProfileDraft(record);
  if (DIRECT.includes(record.type)) {
    if (typeof connection.host !== 'string' || !Number.isInteger(connection.port) || typeof connection.username !== 'string' || typeof connection.password !== 'string') return null;
    return { ...draft, host: connection.host, port: String(connection.port), username: connection.username, password: connection.password };
  }
  if (record.type === 'vless') return typeof connection.uri === 'string' ? { ...draft, uri: connection.uri } : null;
  if (record.type === 'openvpn') return typeof connection.config === 'string' && typeof connection.username === 'string' && typeof connection.password === 'string' ? { ...draft, config: connection.config, username: connection.username, password: connection.password } : null;
  return null;
}
function releaseExport(bundle) { for (const profile of bundle?.profiles ?? []) if (profile?.connection && typeof profile.connection === 'object') for (const key of Object.keys(profile.connection)) profile.connection[key] = null; }
export function proxyProfileInput(draft) {
  if (!draft || !TYPES.includes(draft.type) || typeof draft.name !== 'string' || !draft.name.trim() || draft.name.length > 96) return null;
  const result = { ...(draft.id ? { id: draft.id } : {}), name: draft.name.trim(), type: draft.type };
  // The country tag is a plain code from the picker; the service checks it against the region table. A full save replaces the
  // profile, so an empty field simply leaves the tag out.
  if (typeof draft.country === 'string' && draft.country) result.country = draft.country;
  if (DIRECT.includes(draft.type)) {
    const port = Number(draft.port);
    if (!draft.host.trim() || /[\s/@?#]/.test(draft.host) || !/^\d{1,5}$/.test(draft.port) || !Number.isInteger(port) || port < 1 || port > 65535) return null;
    result.host = draft.host.trim(); result.port = port;
    if (draft.username || draft.password) { result.username = draft.username; result.password = draft.password; }
  } else if (draft.type === 'vless') {
    if (!draft.uri && !draft.id) return null;
    if (draft.uri) { try { result.uri = normalizeVlessUri(draft.uri); } catch { return null; } }
  } else {
    if (!draft.config && !draft.id || draft.config.length > MAX_CONFIG) return null;
    if (draft.config) result.config = draft.config;
    if (draft.username || draft.password) { result.username = draft.username; result.password = draft.password; }
  }
  return result;
}

export function createProxyUi({ h, useState, useEffect, useRef, useLocale, translate, browserApi = globalThis.chrome, createClient = createProxyClient, downloadFile = null, writeClipboard = null, createHistory = api => createProxyHistoryStore(api), announce = announceDefault, geoController = null, createGeo = api => createGeoController({ api }) }) {
  const { WorkspaceMaster, ToolButton } = createWorkspaceControlsUi({ h });
  const t = key => translate('proxy_workspace_' + key), c = key => translate('browser_debug_' + key);
  const icons = createProxyIcons({ h });
  const { icon, badgeIcon } = icons;
  const list = createProxyListUi({ h, t, c, icons });
  const peekUi = createProxyPeekUi({ h, t, c, icons, list });
  const sheetUi = createProxySheetUi({ h, t, c, icons, list });
  const routeUi = createProxyRouteUi({ h, t, c, icons, list });
  const { button } = list;
  const EMPTY_LINKS = Object.freeze({});

  function ProxyApp({ active = true }) {
    const locale = useLocale(), langTag = languageTag(locale), isRtl = ['ar', 'ur'].includes(typeof locale === 'string' ? locale : locale?.id);
    const geoLabels = proxyGeoManagerLabels(locale), geoText = (key, values) => values ? formatText(geoLabels[key] ?? key, values) : geoLabels[key] ?? key;
    const [snapshot, setSnapshot] = useState(null), [openPanelId, setOpenPanelId] = useState(null), [filters, setFilters] = useState({ query: '', type: 'all', status: 'all', country: 'all' });
    const [editor, setEditor] = useState(null), [paste, setPaste] = useState(''), [settings, setSettings] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [failureDiagnostic, setFailureDiagnostic] = useState(null), [notice, setNotice] = useState(''), [removing, setRemoving] = useState(null);
    const [checkTarget, setCheckTarget] = useState(DEFAULT_CHECK_URL), [checkResult, setCheckResult] = useState(null), [checking, setChecking] = useState(false);
    const [profileChecks, setProfileChecks] = useState({}), [checkingProfiles, setCheckingProfiles] = useState(null), [batchSummary, setBatchSummary] = useState(null);
    // Round 5: saved check history (null while unread or unavailable), a pending clear confirmation, and the country picker's own list state.
    const [history, setHistory] = useState(null), [historyConfirm, setHistoryConfirm] = useState(null);
    const [countryQuery, setCountryQuery] = useState(''), [countryOpen, setCountryOpen] = useState(false), [countryActive, setCountryActive] = useState(-1);
    const [foreground, setForeground] = useState(() => globalThis.document?.visibilityState !== 'hidden');
    // List import keeps its pasted text and parsed credentials in this page's
    // memory only; `imported` lists metadata IDs saved during this visit.
    const [bulk, setBulk] = useState(null), [imported, setImported] = useState(null), [sessionFormat, setSessionFormat] = useState(PROXY_SESSION_FORMAT), [sessionTarget, setSessionTarget] = useState('username');
    // View state: what the list shows (never the proxy configuration), the selection and the open menu, details panel and help.
    const [chipStops, setChipStops] = useState({ type: null, status: null, density: null }), [filtersOpen, setFiltersOpen] = useState(false), [view, setView] = useState(() => readProxyView(localViewStorage())), [selection, setSelection] = useState([]), [currentId, setCurrentId] = useState(null), [peekId, setPeekId] = useState(null), [menu, setMenu] = useState(null), [helpOpen, setHelpOpen] = useState(false);
    const [domainDrafts, setDomainDrafts] = useState({ proxyDomains: '', directDomains: '' }), [domainError, setDomainError] = useState(null);
    const [reveal, setReveal] = useState({}), [showErrors, setShowErrors] = useState(false), [editTitle, setEditTitle] = useState(null), [duplicateNote, setDuplicateNote] = useState(null);
    const [companionAsked, setCompanionAsked] = useState(false), [links, setLinks] = useState(EMPTY_LINKS), [linksRead, setLinksRead] = useState(false), [now, setNow] = useState(() => Date.now()), [skeleton, setSkeleton] = useState(false);
    const bulkRef = useRef(null), bulkDialog = useRef(null), editorDialog = useRef(null);
    bulkRef.current = bulk;
    const client = useRef(null), mounted = useRef(false), visible = useRef(false), generation = useRef(0), lock = useRef(null), dirtySettings = useRef(false), acceptedConfiguration = useRef(null), privatePayload = useRef(null), originalEditor = useRef(null), diagnosticRequest = useRef(null), batchRequest = useRef(null), fileInput = useRef(null), editorRef = useRef(null), pasteRef = useRef(null), editorDraft = useRef(null), profilesRef = useRef(null), historyRef = useRef(null), actionType = useRef(null);
    const rootRef = useRef(null), gridRef = useRef(null), searchRef = useRef(null), peekRef = useRef(null), pendingFocus = useRef(null), returnFocus = useRef(null), anchor = useRef(null), shownIds = useRef([]), fileRequest = useRef(false), skeletonSince = useRef(0), firstFilters = useRef(true), firstSelection = useRef(true), viewRef = useRef(view);
    viewRef.current = view;
    // ADR-109: the geolocation layer. The state of the controller (null until it was read), the dismissal of the invitation (this browser
    // profile; null until it had to be read) and the pending "look up all" confirmation. Without a controller everything below stays off and the manager is unchanged.
    const [geoState, setGeoState] = useState(null), [geoDismissed, setGeoDismissed] = useState(null), [geoConfirm, setGeoConfirm] = useState(null), [geoFailures, setGeoFailures] = useState({});
    const geoRef = useRef(null);
    visible.current = active && foreground;
    editorDraft.current = editor;
    const configuration = snapshot?.configuration, profiles = configuration?.profiles ?? [];
    const state = STATES.has(snapshot?.status?.state) ? snapshot.status.state : 'off';
    const accept = value => {
      if (!value || !mounted.current || !visible.current) return;
      const previous = acceptedConfiguration.current, next = value.configuration;
      if (previous && next && next.revision !== previous.revision) {
        const comparable = configuration => JSON.stringify({ profiles: configuration.profiles, routing: configuration.routing, protectWebRTC: configuration.protectWebRTC, disablePrediction: configuration.disablePrediction, autoConnect: configuration.autoConnect, killSwitch: configuration.killSwitch });
        const onlyActivity = (previous.enabled !== next.enabled || previous.selectedId !== next.selectedId) && comparable(previous) === comparable(next);
        if (!onlyActivity) setProfileChecks({});
      }
      acceptedConfiguration.current = next;
      setSnapshot({ configuration: value.configuration, status: value.status, ...(value.host ? { host: value.host } : {}) });
      if (value.status?.state !== 'connected' || !value.diagnostic) setCheckResult(null);
      if (!dirtySettings.current && value.configuration) setSettings(value.configuration);
      // A status that names its own code is newer than the note of an earlier failed action.
      if (SAFE_CODES.has(value.status?.code)) { setFailureDiagnostic(null); setError(''); }
    };
    const erasePayload = expected => { const payload = expected ?? privatePayload.current; if (payload) { for (const key of ['username', 'password', 'uri', 'config']) delete payload[key]; if (privatePayload.current === payload) privatePayload.current = null; } };
    const eraseOriginalEditor = () => { if (originalEditor.current) for (const key of ['username', 'password', 'uri', 'config']) delete originalEditor.current.draft[key]; originalEditor.current = null; };
    const eraseDiagnostic = expected => { const request = expected ?? diagnosticRequest.current; if (request) { request.url = ''; if (diagnosticRequest.current === request) diagnosticRequest.current = null; } };
    // Cancels a running list save after its current request and drops every
    // parsed credential; strings themselves are not claimed to be zeroed.
    const eraseBulk = () => { const current = bulkRef.current; if (current) { current.token.cancelled = true; current.text = ''; for (const entry of current.entries ?? []) if (entry.profile) for (const key of ['username', 'password', 'uri']) delete entry.profile[key]; } bulkRef.current = null; };
    const resetEditorUi = () => { setReveal({}); setShowErrors(false); setEditTitle(null); setDuplicateNote(null); };
    const clearPrivate = () => { eraseBulk(); setBulk(null); setImported(null); erasePayload(); eraseOriginalEditor(); eraseDiagnostic(); if (batchRequest.current) { batchRequest.current.cancelled = true; batchRequest.current.url = ''; batchRequest.current = null; } setProfileChecks({}); setCheckingProfiles(null); setBatchSummary(null); setGeoConfirm(null); setCheckTarget(DEFAULT_CHECK_URL); setCheckResult(null); setChecking(false); setEditor(null); setPaste(''); setRemoving(null); setFailureDiagnostic(null); setHistoryConfirm(null); setCountryOpen(false); setCountryQuery(''); setCountryActive(-1); setMenu(null); setDomainDrafts({ proxyDomains: '', directDomains: '' }); setDomainError(null); setCompanionAsked(false); resetEditorUi(); if (fileInput.current) fileInput.current.value = ''; };
    const diagnosticText = (code, type = null) => (type === 'http' || type === 'https') && UPDATE_COMPANION.has(code) ? t('error_update_companion') : DIAGNOSTICS[code] ? t('error_' + DIAGNOSTICS[code]) : ['native-required', 'native-unavailable', 'native-not-installed', 'host-unavailable', 'host-not-found', 'native-host-missing'].includes(code) ? t('companion_missing') : c(ERROR_KEYS[code] ?? 'operation_failed');
    const needsNativeRestart = failure => failure?.code === 'reconnect-required' && failure?.phase === 'native';
    const fail = (failure, type = actionType.current) => { setError(needsNativeRestart(failure) ? t('native_restart') : diagnosticText(failure?.code, type)); setFailureDiagnostic(SAFE_CODES.has(failure?.code) ? { code: failure.code, ...(PROXY_PHASES.includes(failure.phase) ? { phase: failure.phase } : {}), retryable: failure.retryable === true } : null); };
    function run(action, done = null, failed = null, type = null) {
      if (!mounted.current || !visible.current || lock.current) return Promise.resolve(null);
      const token = {}, epoch = generation.current; lock.current = token; actionType.current = type; setBusy(true); setError(''); setFailureDiagnostic(null); setNotice('');
      let pending;
      try { pending = action(); } catch (failure) { pending = Promise.reject(failure); }
      return Promise.resolve(pending).then(value => {
        if (mounted.current && visible.current && generation.current === epoch && lock.current === token) { if (value?.configuration && value?.status) accept(value); done?.(value); }
        return value;
      }, failure => { if (mounted.current && visible.current && generation.current === epoch && lock.current === token) { if (failed) failed(failure); else fail(failure); } return null; }).finally(() => { if (lock.current === token) { lock.current = null; if (mounted.current) setBusy(false); } });
    }
    // ---- Effects -------------------------------------------------------------------------------------------------------------------
    useEffect(() => {
      mounted.current = true; client.current = createClient(browserApi, { env: globalThis, onChange: accept }); historyRef.current = createHistory(browserApi);
      return () => { mounted.current = false; ++generation.current; lock.current = null; eraseBulk(); erasePayload(); eraseOriginalEditor(); eraseDiagnostic(); if (editorDraft.current) for (const key of ['username', 'password', 'uri', 'config']) delete editorDraft.current[key]; editorDraft.current = null; if (batchRequest.current) { batchRequest.current.cancelled = true; batchRequest.current.url = ''; batchRequest.current = null; } if (fileInput.current) fileInput.current.value = ''; client.current?.dispose(); client.current = null; historyRef.current = null; };
    }, []);
    useEffect(() => {
      let controller = geoController, owned = false, off = null, alive = true;
      try {
        if (!controller && typeof browserApi?.storage?.local?.get === 'function') { controller = createGeo(browserApi); owned = Boolean(controller); }
        if (controller) {
          geoRef.current = controller;
          off = controller.subscribe(() => { if (alive) setGeoState(controller.getState()); });
          Promise.resolve(controller.load()).then(() => { if (alive) setGeoState(controller.getState()); }).catch(() => {});
        }
      } catch { geoRef.current = null; }
      return () => { alive = false; geoRef.current = null; try { off?.(); if (owned) controller?.dispose?.(); } catch { /* Already gone. */ } };
    }, []);
    useEffect(() => { if (geoDismissed === null && geoState?.loaded === true && geoState.enabled !== true) setGeoDismissed(readGeoBannerDismissed(localViewStorage())); }, [geoState]);
    useEffect(() => {
      const document = globalThis.document;
      const changed = () => {
        const shown = document?.visibilityState !== 'hidden'; setForeground(shown);
        if (!shown) { visible.current = false; ++generation.current; lock.current = null; setBusy(false); clearPrivate(); setHistory(null); setError(''); setNotice(''); }
      };
      const hidden = () => { visible.current = false; setForeground(false); ++generation.current; lock.current = null; setBusy(false); clearPrivate(); setHistory(null); setError(''); setNotice(''); };
      document?.addEventListener?.('visibilitychange', changed); globalThis.addEventListener?.('pagehide', hidden); globalThis.addEventListener?.('pageshow', changed);
      return () => { document?.removeEventListener?.('visibilitychange', changed); globalThis.removeEventListener?.('pagehide', hidden); globalThis.removeEventListener?.('pageshow', changed); };
    }, []);
    useEffect(() => {
      if (!active || !foreground) { ++generation.current; lock.current = null; setBusy(false); clearPrivate(); setHistory(null); return; }
      run(() => client.current.load()); loadHistory(); loadLinks();
    }, [active, foreground]);
    // Relative times ("5 min ago") follow the clock while the page is shown.
    useEffect(() => {
      if (!active || !foreground) return undefined;
      setNow(Date.now());
      const timer = setInterval(() => setNow(Date.now()), TICK_MS); timer?.unref?.();
      return () => clearInterval(timer);
    }, [active, foreground]);
    // A skeleton appears only when loading takes longer than a moment and then stays long enough not to flash.
    const loading = active && foreground && snapshot === null && !error;
    useEffect(() => {
      if (loading && !skeleton) { const timer = setTimeout(() => { skeletonSince.current = Date.now(); setSkeleton(true); }, SKELETON_DELAY_MS); timer?.unref?.(); return () => clearTimeout(timer); }
      if (!loading && skeleton) { const timer = setTimeout(() => setSkeleton(false), Math.max(0, SKELETON_MIN_MS - (Date.now() - skeletonSince.current))); timer?.unref?.(); return () => clearTimeout(timer); }
      return undefined;
    }, [loading, skeleton]);
    // The native modal dialogs trap focus and return it to the opener on close; an opener that left the page (a menu item) is replaced
    // by the control that opened its menu.
    function handBack(opener) {
      const target = returnFocus.current; returnFocus.current = null;
      if (opener?.isConnected && opener !== globalThis.document?.body) opener.focus?.(); else if (target) pendingFocus.current = target;
    }
    useEffect(() => {
      const element = bulkDialog.current, opener = globalThis.document?.activeElement;
      if (!bulk || !element) return undefined;
      try { if (!element.open) element.showModal(); } catch { element.setAttribute?.('open', ''); }
      // Preact removes the element itself, so focus is handed back explicitly.
      return () => { try { element.close(); } catch { /* Detached dialog. */ } handBack(opener); };
    }, [bulk !== null]);
    // A step change replaces the focused control: move focus to the new step's start.
    useEffect(() => { bulkDialog.current?.querySelector?.(bulk?.step === 'preview' ? '[data-proxy-bulk-summary]' : '[data-proxy-bulk-text]')?.focus?.(); }, [bulk?.step]);
    useEffect(() => {
      const element = editorDialog.current, opener = globalThis.document?.activeElement;
      if (!editor || !element) return undefined;
      try { if (!element.open) element.showModal(); } catch { element.setAttribute?.('open', ''); }
      return () => { try { element.close(); } catch { /* Detached dialog. */ } handBack(opener); };
    }, [editor !== null]);
    // A failed Save puts its alert (and the restart action) after the last field of a scrolling sheet; bring it into view.
    useEffect(() => { if (editor && (error || failureDiagnostic)) editorDialog.current?.querySelector?.('.pm-sheet-body')?.lastElementChild?.scrollIntoView?.({ block: 'nearest' }); }, [editor !== null, error, failureDiagnostic]);
    useEffect(() => { if (editor) (editor.id ? editorRef.current : pasteRef.current ?? editorRef.current)?.focus?.(); }, [editor?.id, editor?.type]);
    // "Choose .ovpn file" from the add menu: the editor opens on OpenVPN and the file chooser follows in the same gesture.
    useEffect(() => { if (fileRequest.current && editor?.type === 'openvpn') { fileRequest.current = false; fileInput.current?.click?.(); } }, [editor?.type]);
    // Menus: focus the first item when one opens, and close it on a press outside.
    useEffect(() => {
      if (!menu) return undefined;
      rootRef.current?.querySelector?.('.pm-menu [role^="menuitem"]:not([disabled])')?.focus?.();
      const document = globalThis.document, outside = event => { if (!event.target?.closest?.('[data-menu-open]')) setMenu(null); };
      document?.addEventListener?.('pointerdown', outside, true);
      return () => document?.removeEventListener?.('pointerdown', outside, true);
    }, [menu]);
    // Focus requested by an action runs after the render that made its target exist.
    useEffect(() => {
      const target = pendingFocus.current; if (!target) return;
      const root = rootRef.current; let element = null;
      if (target.row) element = root?.querySelector?.('[data-proxy-profile="' + target.row + '"]');
      else if (target.peek) element = peekRef.current;
      else if (target.selector) element = root?.querySelector?.(target.selector);
      // An effect of an earlier render can run before the render that creates the target: keep the request for the next two renders.
      pendingFocus.current = element || (target.tries ?? 0) >= 2 ? null : { ...target, tries: (target.tries ?? 0) + 1 };
      element?.focus?.();
    });
    // The selection and the details panel only ever name profiles that still exist.
    useEffect(() => {
      if (!configuration) return;
      setSelection(previous => proxyReconcileSelection(previous, profiles.map(profile => profile.id)));
      if (peekId && !profiles.some(profile => profile.id === peekId)) setPeekId(null);
      if (currentId && !profiles.some(profile => profile.id === currentId)) setCurrentId(null);
    }, [configuration]);
    // Result counts are announced politely once the filters settle.
    useEffect(() => {
      if (firstFilters.current) { firstFilters.current = false; return undefined; }
      const timer = setTimeout(() => { if (visible.current) announce(formatText(t('count_filtered'), { shown: shownIds.current.length, total: profiles.length })); }, ANNOUNCE_DELAY_MS); timer?.unref?.();
      return () => clearTimeout(timer);
    }, [filters.query, filters.type, filters.status, filters.country]);
    // The number of selected rows is announced politely once it settles (a keyboard range selection changes it row by row).
    useEffect(() => {
      if (firstSelection.current) { firstSelection.current = false; return undefined; }
      const timer = setTimeout(() => { if (visible.current) announce(formatText(t('selected_count'), { count: selection.length })); }, ANNOUNCE_DELAY_MS); timer?.unref?.();
      return () => clearTimeout(timer);
    }, [selection.length]);
    // Linked fingerprint profiles (read only): the local links record, read when the page shows and whenever it changes.
    useEffect(() => {
      const onChanged = browserApi?.storage?.onChanged;
      if (typeof onChanged?.addListener !== 'function') return undefined;
      const listener = (changes, area) => { if (area === 'local' && changes && Object.hasOwn(changes, BUNDLES_KEY) && visible.current) loadLinks(); };
      onChanged.addListener(listener);
      return () => onChanged.removeListener?.(listener);
    }, []);
    // ---- Editor ---------------------------------------------------------------------------------------------------------------------
    function openEditor(profile = null, type = 'socks5') {
      if (lock.current || !visible.current) return;
      ++generation.current; const epoch = generation.current; eraseOriginalEditor(); setPaste(''); resetEditorUi(); setEditor(profile ? null : proxyProfileDraft(null, type)); setRemoving(null); setMenu(null); setError(''); setNotice('');
      if (!profile) return;
      return run(async () => {
        if (profile.native) await client.current.requestAccess({ native: true });
        if (!mounted.current || !visible.current || generation.current !== epoch) { const failure = new Error('inactive'); failure.code = 'inactive'; throw failure; }
        let bundle;
        try {
          bundle = await client.current.exportProfiles(profile.id);
          if (!mounted.current || !visible.current || generation.current !== epoch) { const failure = new Error('inactive'); failure.code = 'inactive'; throw failure; }
          const draft = proxyDraftFromBundle(profile, bundle);
          if (!draft) { const failure = new Error('invalid-profile'); failure.code = 'invalid-profile'; throw failure; }
          const record = bundle.profiles.find(value => value.id === profile.id);
          originalEditor.current = { draft: { ...draft }, metadata: { id: record.id, type: record.type, host: record.host, port: record.port, ...(record.country ? { country: record.country } : {}) } };
          setEditTitle(profile.name); setEditor(draft);
          return null;
        } finally { releaseExport(bundle); bundle = null; }
      }, null, null, profile.type);
    }
    // A copy starts from the saved metadata only (name, kind, address, country tag): credentials, links and configurations are never
    // read or copied, so the user enters the new ones.
    function duplicateProfile(profile) {
      if (lock.current || !visible.current) return;
      ++generation.current; eraseOriginalEditor(); setPaste(''); resetEditorUi(); setRemoving(null); setMenu(null); setError(''); setNotice('');
      const base = proxyProfileDraft(profile), name = (profile.name.length > 90 ? profile.name.slice(0, 90) : profile.name) + ' 2';
      setDuplicateNote(formatText(t('duplicate_note'), { name: profile.name }));
      setEditor({ ...base, id: null, name });
    }
    function change(key, value) { if (lock.current || !visible.current) return; setEditor(previous => previous ? { ...previous, [key]: value } : previous); }
    function cancelEditor() { if (!lock.current && visible.current) { erasePayload(); eraseOriginalEditor(); setEditor(null); setPaste(''); resetEditorUi(); if (fileInput.current) fileInput.current.value = ''; setError(''); setFailureDiagnostic(null); } }
    const editorErrors = editor ? proxyDraftErrors(editor, MAX_CONFIG) : {};
    function saveProfile() {
      if (lock.current || !visible.current || !mounted.current) return Promise.resolve(null);
      let input = proxyProfileInput(editor);
      if (!input) {
        setShowErrors(true); setError('');
        const first = ['name', 'host', 'port', 'uri', 'config'].find(key => editorErrors[key]);
        if (first) { pendingFocus.current = { selector: '[data-proxy-field="' + first + '"]' }; announce(t(FIELD_ERROR_KEYS[first]), { assertive: true }); } else setError(c('invalid_input'));
        return Promise.resolve(null);
      }
      const original = originalEditor.current;
      const metadataOnly = Boolean(original && ['id', 'type', 'host', 'port', 'username', 'password', 'uri', 'config'].every(key => editor[key] === original.draft[key]));
      // Metadata only: the saved connection is not resent. The country tag travels with it: set, kept, or cleared with null.
      if (metadataOnly) { input = { ...original.metadata, name: input.name }; if (editor.country) input.country = editor.country; else if (original.metadata.country) input.country = null; }
      const usesVault = DIRECT.includes(input.type) ? Boolean(input.username || input.password) : Boolean(input.uri || input.config);
      const epoch = generation.current; privatePayload.current = input;
      const dispatch = () => {
        if (!mounted.current || !visible.current || generation.current !== epoch) { erasePayload(input); const failure = new Error('inactive'); failure.code = 'inactive'; throw failure; }
        try { return client.current.saveProfile(input); } finally { erasePayload(input); }
      };
      // A changed connection invalidates the old results and the old history: they described another server.
      const pending = run(() => usesVault ? client.current.requestAccess({ native: true }).then(dispatch) : dispatch(), () => { if (!metadataOnly && input.id) { setProfileChecks(previous => { const next = { ...previous }; delete next[input.id]; return next; }); forgetHistory(input.id); } eraseOriginalEditor(); setEditor(null); resetEditorUi(); setNotice(c('saved')); }, null, input.type);
      setPaste('');
      if (fileInput.current) fileInput.current.value = '';
      return pending.finally(() => erasePayload(input));
    }
    // ---- Connection -----------------------------------------------------------------------------------------------------------------
    function connectProfile(profile) {
      const epoch = generation.current;
      return run(() => client.current.requestAccess({ native: profile.native, privacy: configuration?.protectWebRTC === true || configuration?.disablePrediction === true }).then(() => {
        if (!mounted.current || !visible.current || generation.current !== epoch) { const failure = new Error('inactive'); failure.code = 'inactive'; throw failure; }
        return client.current.connect(profile.id);
      }), null, null, profile.type);
    }
    function connectSelected() {
      if (!mounted.current || !visible.current || lock.current) return Promise.resolve(null);
      const current = acceptedConfiguration.current;
      if (!current || current.enabled) return Promise.resolve(null);
      const profile = current.profiles.find(item => item.id === current.selectedId);
      if (profile) return connectProfile(profile);
      if (current.profiles.length === 0) {
        if (editorDraft.current) editorRef.current?.focus?.();
        else openEditor();
      } else profilesRef.current?.focus?.();
      return Promise.resolve(null);
    }
    function diagnoseConnection() {
      if (lock.current || !visible.current || !mounted.current || state !== 'connected' || configuration?.enabled !== true) return Promise.resolve(null);
      let url;
      try { url = validateProxyDiagnosticUrl(checkTarget); } catch (failure) { setCheckResult({ state: 'fail', code: SAFE_CODES.has(failure?.code) ? failure.code : 'invalid-input' }); return Promise.resolve(null); }
      const request = { url }, epoch = generation.current, profileId = configuration?.selectedId ?? null; diagnosticRequest.current = request; setChecking(true); setCheckResult(null);
      const pending = run(() => client.current.requestAccess({ native: true }).then(() => {
        if (!mounted.current || !visible.current || generation.current !== epoch) { eraseDiagnostic(request); const failure = new Error('inactive'); failure.code = 'inactive'; throw failure; }
        try { return client.current.diagnose(request.url); } finally { eraseDiagnostic(request); }
      }), value => { const diagnostic = value.diagnostic ?? { state: 'fail', code: 'operation-failed' }; setCheckResult(diagnostic); if (profileId) { setProfileChecks(previous => ({ ...previous, [profileId]: { diagnostic, checkedAt: Date.now() } })); recordHistory(profileId, diagnostic); } noteGeoExit(diagnostic); }, failure => { const result = { state: 'fail', code: SAFE_CODES.has(failure?.code) ? failure.code : 'operation-failed', ...(PROXY_PHASES.includes(failure?.phase) ? { phase: failure.phase } : {}), retryable: failure?.retryable === true }; setCheckResult(result); if (profileId) recordHistory(profileId, result); });
      return pending.finally(() => { eraseDiagnostic(request); if (mounted.current && generation.current === epoch) setChecking(false); });
    }
    // Manual checks, one profile or many. Strictly user-initiated: a click, a key or a button, never a timer or a page load. The queue
    // runs PROXY_CHECK_CONCURRENCY checks at a time through the same per-profile call, writes each result to the history exactly like
    // a single check, shows its progress, and stops starting new ones on Cancel.
    function checkSavedProfiles(ids) {
      if (lock.current || !visible.current || !mounted.current || !ids.length) return Promise.resolve(null);
      let url;
      try { url = validateProxyDiagnosticUrl(checkTarget); } catch (failure) { fail(failure); return Promise.resolve(null); }
      const request = { url, cancelled: false }, epoch = generation.current; batchRequest.current = request;
      const tally = { done: 0, failed: 0, passed: 0 };
      setBatchSummary(null); setCheckingProfiles({ ids, index: 0, id: null, stopping: false, ...tally });
      const current = () => mounted.current && visible.current && generation.current === epoch && !request.cancelled;
      const pending = run(async () => {
        await client.current.requestAccess({ native: true });
        await runProxyCheckQueue({
          ids, limit: PROXY_CHECK_CONCURRENCY, stopped: () => !current(),
          onStart: id => { if (current()) setCheckingProfiles(previous => previous ? { ...previous, id, index: ids.indexOf(id) } : previous); },
          check: async id => {
            // Only a reply of the service is a completed check; a client error (busy, timeout) is not history.
            let diagnostic, completed = false;
            try { const result = await client.current.checkProfile({ id, url: request.url }); completed = result.profileId === id; diagnostic = completed ? result.diagnostic : { state: 'fail', code: 'operation-failed' }; }
            catch (failure) { diagnostic = { state: 'fail', code: SAFE_CODES.has(failure?.code) ? failure.code : 'operation-failed', ...(PROXY_PHASES.includes(failure?.phase) ? { phase: failure.phase } : {}), retryable: failure?.retryable === true }; }
            return { diagnostic, completed };
          },
          onResult: (id, result) => {
            if (!current() || !result?.diagnostic) return;
            const { diagnostic, completed } = result;
            tally.done++; if (diagnostic.state === 'pass') tally.passed++; else tally.failed++;
            setProfileChecks(previous => ({ ...previous, [id]: { diagnostic, checkedAt: Date.now() } }));
            setCheckingProfiles(previous => previous ? { ...previous, ...tally } : previous);
            if (completed) { recordHistory(id, diagnostic); noteGeoExit(diagnostic); }
            announce(profileName(id) + ': ' + (diagnostic.state === 'pass' ? diagnostic.elapsedMs + ' ms' : t('check_fail')));
          },
        });
        return null;
      });
      return pending.finally(() => {
        request.url = ''; if (batchRequest.current === request) batchRequest.current = null;
        if (mounted.current && generation.current === epoch) {
          setCheckingProfiles(null);
          if (ids.length > 1 && tally.done > 0) { setBatchSummary({ total: ids.length, ...tally }); announce(formatText(t('check_summary'), { total: ids.length, ...tally })); }
        }
      });
    }
    function stopChecks() { if (batchRequest.current) { batchRequest.current.cancelled = true; setCheckingProfiles(previous => previous ? { ...previous, stopping: true } : previous); } }
    function copyProfiles(id = null) {
      if (lock.current || !visible.current || !mounted.current || !configuration || !profiles.length) return Promise.resolve(null);
      const selected = id === null ? profiles : profiles.filter(profile => profile.id === id), epoch = generation.current;
      if (!selected.length) return Promise.resolve(null);
      const ownDocument = () => mounted.current && visible.current && generation.current === epoch;
      return run(async () => {
        await client.current.requestAccess({ native: selected.some(profile => profile.native), clipboard: true });
        if (!ownDocument()) return null;
        let bundle = null, text = '';
        try {
          bundle = await client.current.exportProfiles(id);
          if (!ownDocument()) return null;
          text = JSON.stringify(bundle, null, 2) + '\n';
          if (writeClipboard) await writeClipboard(text);
          else { if (typeof globalThis.navigator?.clipboard?.writeText !== 'function') { const failure = new Error('unsupported'); failure.code = 'unsupported'; throw failure; } await globalThis.navigator.clipboard.writeText(text); }
          return { copied: id ?? 'all' };
        } finally { releaseExport(bundle); bundle = null; text = ''; }
      }, result => { if (result?.copied) setNotice({ copied: result.copied, text: t('copied') }); });
    }
    // The address (host and port) is saved metadata, not a secret: one click copies it as plain text.
    function copyAddress(profile) {
      const text = proxyEndpointLabel(profile.host, profile.port);
      if (!text || !visible.current) return Promise.resolve(null);
      const write = writeClipboard ?? (value => { if (typeof globalThis.navigator?.clipboard?.writeText !== 'function') throw new Error('unsupported'); return globalThis.navigator.clipboard.writeText(value); });
      return Promise.resolve().then(() => write(text)).then(() => { if (mounted.current && visible.current) { setNotice({ copied: 'address', text: t('address_copied') }); announce(t('address_copied')); } }, () => { if (mounted.current && visible.current) setError(c('operation_failed')); });
    }
    function parsePasted() {
      if (lock.current || !visible.current || !editor || editor.id) return;
      try { const parsed = parseProxyProfileText(paste, { defaultType: pasteType() }); setEditor(previous => previous ? { ...proxyProfileDraft(null, parsed.type), name: previous.name, country: previous.country, ...parsed, port: parsed.port == null ? DEFAULT_PORTS[parsed.type] ?? '1080' : String(parsed.port) } : previous); setPaste(''); setError(''); } catch (failure) { fail(failure); setPaste(''); }
    }
    function randomSession() {
      if (lock.current || !visible.current || !editor || !DIRECT.includes(editor.type)) return;
      const key = sessionTarget === 'password' ? 'password' : 'username', current = editor[key] ?? '';
      if (!current) return;
      const next = proxyApplySession(current, sessionFormat, proxySessionToken());
      if (next === null || new TextEncoder().encode(next).length > 255) { setError(t('session_format_invalid')); return; }
      setError(''); change(key, next);
    }
    // ---- List import ------------------------------------------------------------------------------------------------------------------
    const bulkRoom = () => Math.max(0, PROXY_LIMITS.profiles - (acceptedConfiguration.current?.profiles.length ?? profiles.length));
    function openBulk() {
      if (lock.current || !visible.current || !configuration) return;
      eraseBulk(); setImported(null); setError(''); setFailureDiagnostic(null); setNotice(''); setMenu(null);
      setBulk({ token: { cancelled: false }, step: 'paste', text: '', order: 'host-first', defaultType: 'socks5', entries: [], selected: [], results: {}, saving: null });
    }
    function cancelBulk() {
      if (!bulkRef.current) return;
      eraseBulk(); setBulk(null); setError(''); setFailureDiagnostic(null);
    }
    function changeBulk(patch) {
      if (lock.current || !visible.current) return;
      setBulk(previous => previous?.step === 'paste' ? { ...previous, ...patch } : previous);
    }
    function parseBulk() {
      const current = bulkRef.current;
      if (!current || current.step !== 'paste' || lock.current || !visible.current) return;
      let result;
      try { result = parseProxyProfileList(current.text, { existing: acceptedConfiguration.current?.profiles ?? profiles, order: current.order, defaultType: current.defaultType }); } catch { setError(c('invalid_input')); return; }
      // Valid rows, including address warnings, are preselected up to the free slots.
      const selected = result.entries.filter(entry => entry.profile).slice(0, result.room).map(entry => entry.line);
      setError(''); setFailureDiagnostic(null);
      setBulk(previous => previous?.token === current.token ? { ...previous, step: 'preview', entries: result.entries, selected, results: {}, saving: null } : previous);
    }
    function backBulk() {
      const current = bulkRef.current;
      if (!current || current.step !== 'preview' || lock.current || !visible.current || Object.values(current.results).some(result => result.id)) return;
      for (const entry of current.entries) if (entry.profile) for (const key of ['username', 'password', 'uri']) delete entry.profile[key];
      setError(''); setFailureDiagnostic(null);
      setBulk(previous => previous?.token === current.token ? { ...previous, step: 'paste', entries: [], selected: [], results: {} } : previous);
    }
    function toggleBulk(line, checked) {
      if (lock.current || !visible.current) return;
      const room = bulkRoom();
      setBulk(previous => {
        if (previous?.step !== 'preview' || previous.results[line]?.id || !previous.entries.some(entry => entry.line === line && entry.profile)) return previous;
        const selected = previous.selected.filter(value => value !== line);
        if (checked) { if (selected.length >= room) return previous; selected.push(line); }
        return { ...previous, selected };
      });
    }
    function selectAllBulk(checked) {
      if (lock.current || !visible.current) return;
      const room = bulkRoom();
      setBulk(previous => previous?.step === 'preview' ? { ...previous, selected: checked ? previous.entries.filter(entry => entry.profile && !previous.results[entry.line]?.id).slice(0, room).map(entry => entry.line) : [] } : previous);
    }
    function saveBulk() {
      const current = bulkRef.current;
      if (!current || current.step !== 'preview' || lock.current || !visible.current || !mounted.current) return Promise.resolve(null);
      const queue = current.entries.filter(entry => entry.profile && current.selected.includes(entry.line) && !current.results[entry.line]?.id);
      if (!queue.length) return Promise.resolve(null);
      if (queue.length > bulkRoom()) { setError(t('bulk_limit')); return Promise.resolve(null); }
      const token = current.token, epoch = generation.current, taken = new Set((acceptedConfiguration.current?.profiles ?? profiles).map(profile => profile.id));
      const shown = () => mounted.current && visible.current && generation.current === epoch, still = () => shown() && !token.cancelled;
      const usesVault = queue.some(entry => proxyNeedsNative(entry.profile));
      const update = next => setBulk(previous => previous?.token === token ? next(previous) : previous);
      return run(async () => {
        // The optional grant stays in this click; rows are then saved one by one.
        if (usesVault) await client.current.requestAccess({ native: true });
        for (let index = 0; index < queue.length; index++) {
          if (!still()) return null;
          const entry = queue[index];
          let id;
          do id = 'p-' + globalThis.crypto.randomUUID(); while (taken.has(id));
          taken.add(id);
          const input = proxyBulkInput(entry, id);
          update(previous => ({ ...previous, saving: { index, total: queue.length } }));
          try {
            if (!input) { const failure = new Error('invalid-input'); failure.code = 'invalid-input'; throw failure; }
            const value = await client.current.saveProfile(input);
            if (shown() && value?.configuration && value?.status) accept(value);
          } catch (failure) {
            if (still()) update(previous => ({ ...previous, saving: null, results: { ...previous.results, [entry.line]: { code: SAFE_CODES.has(failure?.code) ? failure.code : 'operation-failed', ...(PROXY_PHASES.includes(failure?.phase) ? { phase: failure.phase } : {}) } } }));
            throw failure;
          } finally { if (input) for (const key of ['username', 'password', 'uri']) delete input[key]; }
          // The vault now owns these secrets; the page keeps the row's metadata only.
          for (const key of ['username', 'password', 'uri']) delete entry.profile[key];
          // A dialog Cancel still lists rows saved before it; a hidden page does not.
          if (shown()) setImported(previous => ({ ids: [...(previous?.ids ?? []), id], confirm: false }));
          // Back is closed once a row is saved, so the pasted text is no longer kept.
          if (still()) update(previous => ({ ...previous, text: '', saving: null, selected: previous.selected.filter(line => line !== entry.line), results: { ...previous.results, [entry.line]: { id } } }));
        }
        return { saved: queue.length };
      }, value => {
        if (!value?.saved || bulkRef.current?.token !== token) return;
        eraseBulk(); setBulk(null); setNotice(c('saved') + ': ' + value.saved);
      });
    }
    function checkImported() {
      const ids = (imported?.ids ?? []).filter(id => profiles.some(profile => profile.id === id));
      return checkSavedProfiles(ids);
    }
    function deleteFailedImported() {
      if (lock.current || !visible.current || !mounted.current || !imported) return Promise.resolve(null);
      const current = acceptedConfiguration.current, ids = imported.ids.filter(id => profileChecks[id]?.diagnostic?.state === 'fail' && current?.profiles.some(profile => profile.id === id) && !(current.enabled && current.selectedId === id));
      if (!ids.length) { setImported(previous => previous ? { ...previous, confirm: false } : previous); return Promise.resolve(null); }
      const epoch = generation.current, still = () => mounted.current && visible.current && generation.current === epoch;
      const removed = [];
      return run(async () => {
        if (ids.some(id => current.profiles.find(profile => profile.id === id)?.native)) await client.current.requestAccess({ native: true });
        for (const id of ids) { if (!still()) break; const value = await client.current.deleteProfile(id); removed.push(id); if (still() && value?.configuration && value?.status) accept(value); }
        return { removed: removed.length };
      }, value => { removed.forEach(forgetHistory); setImported(previous => previous ? { ids: previous.ids.filter(id => !removed.includes(id)), confirm: false } : previous); setNotice(c('saved') + ': ' + value.removed); }, failure => { removed.forEach(forgetHistory); fail(failure); setImported(previous => previous ? { ids: previous.ids.filter(id => !removed.includes(id)), confirm: false } : previous); });
    }
    async function fileChange(event) {
      const file = event.currentTarget.files?.[0], epoch = generation.current;
      event.currentTarget.value = '';
      if (!file || lock.current || !visible.current) return;
      if (file.size > MAX_CONFIG) { setError(c('invalid_input')); return; }
      try { const text = await file.text(); if (mounted.current && visible.current && epoch === generation.current) change('config', text); } catch { if (mounted.current && visible.current && epoch === generation.current) setError(c('operation_failed')); }
    }
    // ---- Settings and routing -------------------------------------------------------------------------------------------------------
    function changeSetting(key, value) { if (lock.current || !visible.current) return; dirtySettings.current = true; setSettings(previous => previous ? { ...previous, [key]: value } : previous); }
    function changeRouting(key, value) { if (lock.current || !visible.current) return; dirtySettings.current = true; setSettings(previous => previous ? { ...previous, routing: { ...previous.routing, [key]: value } } : previous); }
    function saveSettings() { return run(() => client.current.saveSettings(settings), value => { dirtySettings.current = false; setSettings(value.configuration); setDomainDrafts({ proxyDomains: '', directDomains: '' }); setDomainError(null); setNotice(c('saved')); }); }
    function discardSettings() { if (lock.current || !visible.current) return; dirtySettings.current = false; setSettings(acceptedConfiguration.current ?? configuration ?? null); setDomainDrafts({ proxyDomains: '', directDomains: '' }); setDomainError(null); }
    // Domain lists are chips; every entry is checked like the service checks it, and an entry that fails stays in the field with its reason.
    function commitDomains(key) {
      if (lock.current || !visible.current || !settings) return;
      const text = domainDrafts[key] ?? ''; if (!text.trim()) return;
      const otherKey = key === 'proxyDomains' ? 'directDomains' : 'proxyDomains';
      let list = [...(settings.routing?.[key] ?? [])]; const rest = []; let failure = null;
      for (const token of proxyDomainTokens(text)) {
        const result = proxyDomainEntry(token, { list, other: settings.routing?.[otherKey] ?? [] });
        if (result.ok) list = [...list, result.value]; else if (result.reason === 'duplicate') { /* Already there: nothing to add. */ } else { rest.push(token); failure ??= result.reason; }
      }
      if (list.length !== (settings.routing?.[key] ?? []).length) changeRouting(key, list);
      setDomainDrafts(previous => ({ ...previous, [key]: rest.join(' ') })); setDomainError(failure ? { key, reason: failure } : null);
    }
    function removeDomain(key, value) { if (lock.current || !visible.current || !settings) return; changeRouting(key, (settings.routing?.[key] ?? []).filter(item => item !== value)); setDomainError(null); }
    function onDomainKey(event, key) {
      if (event.isComposing || event.keyCode === 229) return;
      const draft = domainDrafts[key] ?? '';
      if (event.key === 'Enter' || event.key === ',' || event.key === ';' || event.key === ' ') { if (draft.trim()) { event.preventDefault?.(); commitDomains(key); } else if (event.key === 'Enter') event.preventDefault?.(); }
      else if (event.key === 'Backspace' && !draft && (settings?.routing?.[key] ?? []).length) { const items = settings.routing[key]; removeDomain(key, items[items.length - 1]); }
    }
    function exportMetadata() {
      if (!configuration || lock.current || !visible.current) return;
      let text;
      try { text = exportProxyConfiguration(configuration); } catch (failure) { fail(failure); return; }
      if (downloadFile) { downloadFile('Detect.Expert-proxy-profiles.json', text); return; }
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })), anchorElement = globalThis.document.createElement('a');
      anchorElement.href = url; anchorElement.download = 'Detect.Expert-proxy-profiles.json'; anchorElement.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
    }
    // ---- Editor pieces --------------------------------------------------------------------------------------------------------------
    const reasonText = reason => t(REASON_KEYS[reason] ?? 'reason_invalid_line');
    // What Parse would fill in, shown before it does: never the login itself.
    function pastePreview() {
      const summary = inspectProxyText(paste, { defaultType: pasteType() });
      if (summary.state === 'empty') return null;
      const recognized = summary.state === 'ok';
      return h('p', { id: 'proxy-paste-preview', class: 'pm-preview pm-preview--' + (recognized ? 'ok' : 'invalid'), role: 'status', 'data-proxy-paste-preview': summary.state, children: [badgeIcon(recognized ? 'pass' : 'fail'), h('span', { children: recognized ? [t('bulk_recognized') + ': ', h('strong', { children: LABELS[summary.type] }), summary.host ? [' · ', h('span', { dir: 'ltr', class: 'pm-mono', children: proxyEndpointLabel(summary.host, summary.port) })] : null, summary.credentials ? ' · ' + t('with_login') : null] : reasonText(summary.reason) })] });
    }
    function sessionView() {
      const valid = proxySessionFormatValid(sessionFormat);
      return h('details', { class: 'pm-session', 'data-proxy-session': true, children: [
        h('summary', { children: [icon('dice', 15), h('span', { children: t('session_format') + ': ' }), h('code', { dir: 'ltr', children: sessionFormat || '—' })] }),
        h('div', { class: 'pm-row2', children: [
          h('label', { class: 'pm-field pm-field--grow', children: [h('span', { class: 'pm-field-label', children: t('session_format') }), h('input', { type: 'text', class: 'pm-input', value: sessionFormat, disabled: busy, dir: 'ltr', spellcheck: false, autoComplete: 'off', maxLength: 64, 'aria-invalid': valid ? undefined : 'true', 'data-proxy-session-format': true, onInput: event => { if (!lock.current && visible.current) setSessionFormat(event.currentTarget.value); } })] }),
          h('label', { class: 'pm-field pm-field--grow', children: [h('span', { class: 'pm-field-label', children: t('session_target') }), h('select', { class: 'pm-input', value: sessionTarget, disabled: busy, 'data-proxy-session-target': true, onChange: event => { if (!lock.current && visible.current) setSessionTarget(event.currentTarget.value === 'password' ? 'password' : 'username'); }, children: [h('option', { value: 'username', children: t('username') }), h('option', { value: 'password', children: t('password') })] })] }),
        ] }),
        h('p', { class: 'pm-note', 'data-proxy-session-note': valid ? 'valid' : 'invalid', children: t(valid ? 'session_format_detail' : 'session_format_invalid') }),
      ] });
    }
    // The type used to read a pasted line without a scheme: the kind the editor is on, when it is one of the three URL kinds.
    const pasteType = () => DIRECT.includes(editor?.type) ? editor.type : 'socks5';
    // SOCKS5, HTTP and HTTPS share their fields: what was typed stays, and the port follows the kind only while it is still the
    // previous kind's prefilled one. The country tag is a note about the profile, so it stays for every kind.
    function switchType(next) {
      if (busy || !visible.current || !TYPES.includes(next)) return;
      setPaste(''); setShowErrors(false); setReveal({});
      setEditor(previous => {
        const base = proxyProfileDraft(null, next), shared = previous && DIRECT.includes(previous.type) && DIRECT.includes(next);
        const draft = { ...base, name: previous?.name ?? '', country: previous?.country ?? '' };
        return shared ? { ...draft, host: previous.host, username: previous.username, password: previous.password, port: previous.port === DEFAULT_PORTS[previous.type] ? base.port : previous.port } : draft;
      });
    }
    // Arrow keys move the choice inside the type radio group.
    function onTypeKey(event, type) {
      const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
      if (!step) return;
      event.preventDefault?.();
      const flip = isRtl && (event.key === 'ArrowLeft' || event.key === 'ArrowRight') ? -step : step;
      const next = TYPES[(TYPES.indexOf(type) + flip + TYPES.length) % TYPES.length];
      switchType(next); pendingFocus.current = { selector: '[data-proxy-type-option="' + next + '"]' };
    }
    // What is true of each kind, said where the kind is chosen: who sees which names, what is encrypted, how a login travels.
    function detailNotes() {
      const type = editor.type, key = type === 'socks5' ? 'socks_detail' : type === 'http' ? 'http_detail' : type === 'https' ? 'https_detail' : type === 'vless' ? 'vless_detail' : 'openvpn_detail';
      return h('div', { class: 'pm-info', children: [icon('info', 16), h('div', { class: 'pm-info-text', children: [h('p', { key: 'detail', class: 'pm-note', 'data-proxy-type-detail': type, children: t(key) }), type === 'http' || type === 'https' ? h('p', { key: 'relay', class: 'pm-note', 'data-proxy-relay-detail': true, children: t('http_relay_detail') }) : null] })] });
    }
    // A searchable list of the offline region table, in the interface language. The value is only ever a code from that table.
    function countryBox() {
      const picker = regionPicker(locale), code = editor?.country || '', results = searchRegions(picker.list, countryQuery), listId = 'proxy-country-list';
      const choose = value => { change('country', value); setCountryQuery(''); setCountryOpen(false); setCountryActive(-1); };
      const empty = countryOpen && countryQuery.trim() !== '' && results.length === 0;
      return h('div', { class: 'pm-field pm-country-field', 'data-proxy-country-field': true, onFocusOut: event => { if (!event.currentTarget?.contains?.(event.relatedTarget)) { setCountryOpen(false); setCountryActive(-1); } }, children: [
        h('label', { class: 'pm-field-label', for: 'proxy-country-input', children: t('country_label') }),
        h('div', { class: 'pm-combobox', children: [
          h('input', { type: 'text', class: 'pm-input', id: 'proxy-country-input', role: 'combobox', 'aria-expanded': countryOpen && results.length > 0, 'aria-controls': listId, 'aria-autocomplete': 'list', 'aria-activedescendant': countryOpen && countryActive >= 0 ? listId + '-' + countryActive : undefined, 'aria-describedby': 'proxy-country-hint proxy-country-status', value: countryOpen ? countryQuery : code ? (picker.byCode.get(code)?.name ?? code) + ' · ' + code : '', placeholder: t('country_none'), disabled: busy, autoComplete: 'off', spellcheck: false, 'data-proxy-country-input': true,
            onInput: event => { setCountryQuery(event.currentTarget.value); setCountryOpen(true); setCountryActive(0); },
            onFocus: () => { setCountryQuery(''); setCountryOpen(true); setCountryActive(-1); },
            onKeyDown: event => {
              // An IME composition never picks or closes.
              if (event.isComposing || event.keyCode === 229) return;
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setCountryOpen(true); const step = event.key === 'ArrowDown' ? 1 : -1; setCountryActive(index => results.length ? index < 0 ? (step > 0 ? 0 : results.length - 1) : (index + step + results.length) % results.length : -1); }
              else if (event.key === 'Enter' && countryOpen && results[countryActive]) { event.preventDefault(); choose(results[countryActive].code); }
              else if (event.key === 'Escape' && countryOpen) { event.preventDefault(); event.stopPropagation?.(); setCountryOpen(false); setCountryActive(-1); }
            } }),
          code ? button(null, { class: 'pm-iconbtn pm-combobox-clear', 'aria-label': t('country_clear'), title: t('country_clear'), disabled: busy, 'data-proxy-country-clear': true, onClick: () => choose('') }, 'close') : null,
          countryOpen && results.length ? h('ul', { class: 'pm-combobox-list', id: listId, role: 'listbox', 'aria-label': t('country_label'), 'data-proxy-country-list': true, children: results.map((entry, index) => h('li', { key: entry.code, id: listId + '-' + index, role: 'option', 'aria-selected': entry.code === code, class: 'pm-combobox-option' + (index === countryActive ? ' is-highlighted' : '') + (entry.code === code ? ' is-selected' : ''), 'data-proxy-country-option': entry.code, onMouseDown: event => { event.preventDefault(); choose(entry.code); }, children: [h('span', { children: entry.name }), h('span', { dir: 'ltr', children: entry.code })] })) }) : null,
        ] }),
        h('p', { class: 'pm-note', id: 'proxy-country-hint', 'data-proxy-country-hint': true, children: t('country_hint') }),
        h('p', { class: 'proxy-workspace-sr', id: 'proxy-country-status', role: 'status', 'aria-live': 'polite', 'data-proxy-country-status': true, children: empty ? t('country_no_results') : '' }),
      ] });
    }
    // ---- Geolocation (ADR-109) -----------------------------------------------------------------------------------------------------
    // A lookup starts only from a person (the button, "look up all") or, after a COMPLETED manual check, from the controller (noteExitIp:
    // it decides whether anything is sent). Opening the list, rendering, timers and the stored history never start one. Only public
    // addresses are ever passed on: a private or reserved exit IP stays on this page.
    function noteGeoExit(diagnostic) {
      const ip = diagnostic?.state === 'pass' ? geoCanonicalIp(diagnostic.ip) : null;
      if (ip === null || !geoIsPublicIp(ip)) return;
      try { geoRef.current?.noteExitIp(ip); } catch { /* The geolocation layer is optional. */ }
    }
    const geoTargets = () => proxyGeoLookupTargets({ profiles, checks, state: geoState, now });
    // The last failure of a lookup started here, per address (memory only, at most 64): the controller forgets transient errors.
    function noteGeoResult(ip, result) {
      setGeoFailures(previous => {
        const next = {};
        for (const key of Object.keys(previous)) if (key !== ip) next[key] = previous[key];
        if (result?.ok !== true && proxyGeoShowsFailure(result?.error)) next[ip] = { code: result.error, at: Date.now() };
        else if (!Object.hasOwn(previous, ip)) return previous;
        const keys = Object.keys(next);
        if (keys.length > 64) delete next[keys[0]];
        return next;
      });
    }
    const startGeoLookup = (controller, ip) => Promise.resolve().then(() => controller.lookup(ip, { force: true })).then(result => { if (mounted.current) noteGeoResult(ip, result); return result; }, () => null);
    function geoLookup(profileId) {
      const controller = geoRef.current, ip = proxyGeoPublicExitIp(Object.hasOwn(checks, profileId) ? checks[profileId] : null);
      if (!controller || ip === '' || !mounted.current || !visible.current || !proxyGeoReady(geoState)) return Promise.resolve(null);
      // A button that had the focus can leave the page with its result (the cell now shows data): the focus then goes to the row.
      const name = profileName(profileId), document = globalThis.document, hadFocus = Boolean(document?.activeElement?.closest?.('[data-proxy-geo-lookup]'));
      return startGeoLookup(controller, ip).then(result => {
        if (mounted.current && visible.current) {
          announce(result?.ok === true ? geoText('announce_lookup_done', { name }) : geoText('announce_lookup_failed', { name, reason: geoText(proxyGeoErrorKey(result?.error)) }));
          if (hadFocus && (!document.activeElement || document.activeElement === document.body)) { pendingFocus.current = { row: profileId }; setNow(Date.now()); }
        }
        return result;
      });
    }
    function askGeoLookupAll() {
      if (!mounted.current || !visible.current || !proxyGeoReady(geoState)) return;
      const ips = geoTargets();
      if (!ips.length) return;
      setGeoConfirm({ ips, name: proxyGeoProviderName(geoState) }); pendingFocus.current = { selector: '[data-proxy-geo-confirm-yes]' };
    }
    function cancelGeoLookupAll() { setGeoConfirm(null); pendingFocus.current = { selector: '[data-proxy-list-menu]' }; }
    // Only what was confirmed AND is still wanted is sent: an address that got a fresh record or left the list in the meantime is dropped.
    function confirmGeoLookupAll() {
      const controller = geoRef.current, asked = geoConfirm;
      setGeoConfirm(null); pendingFocus.current = { selector: '[data-proxy-list-menu]' };
      if (!controller || !asked || !mounted.current || !visible.current || !proxyGeoReady(geoState)) return;
      const wanted = geoTargets(), ips = asked.ips.filter(ip => wanted.includes(ip));
      if (!ips.length) return;
      announce(geoText('announce_lookup_started', { n: ips.length }));
      for (const ip of ips) startGeoLookup(controller, ip);
    }
    function toggleGeoColumn(column) {
      const controller = geoRef.current;
      if (!controller || !visible.current || !GEO_COLUMNS.includes(column)) return;
      const chosen = proxyGeoColumns(geoState), next = GEO_COLUMNS.filter(value => value === column ? !chosen.includes(column) : chosen.includes(value));
      try { Promise.resolve(controller.setColumns(next)).catch(() => {}); } catch { /* The geolocation layer is optional. */ }
    }
    function dismissGeoBanner() {
      writeGeoBannerDismissed(localViewStorage()); setGeoDismissed(true);
      pendingFocus.current = { selector: '[data-proxy-search]' }; announce(geoText('banner_dismissed'));
    }
    // Same pattern as the Precursor entry: a new tab on the settings page; failures are swallowed. Without the tabs API the link's own href works.
    function openGeoSettings(event) {
      if (typeof browserApi?.tabs?.create !== 'function' || typeof browserApi?.runtime?.getURL !== 'function') return;
      event?.preventDefault?.();
      try { Promise.resolve(browserApi.tabs.create({ url: browserApi.runtime.getURL('proxy-geo-settings.html') })).catch(() => {}); } catch { /* The browser may be closing. */ }
    }
    // ---- History --------------------------------------------------------------------------------------------------------------------
    const stamp = value => { try { return new Date(value).toLocaleString(langTag, { dateStyle: 'short', timeStyle: 'medium' }); } catch { return new Date(value).toLocaleString(); } };
    const profileName = id => (acceptedConfiguration.current?.profiles ?? profiles).find(profile => profile.id === id)?.name ?? '';
    function loadHistory() {
      const store = historyRef.current; if (!store?.available) return;
      store.read().then(next => { if (next && mounted.current && visible.current) setHistory(next); });
    }
    // Called only with the result of a completed manual check; the entry builder drops what says nothing about the proxy.
    function recordHistory(profileId, diagnostic) {
      const store = historyRef.current, entry = store?.available ? proxyHistoryEntry(diagnostic, Date.now()) : null;
      if (!entry) return;
      store.record(profileId, entry).then(next => {
        if (!next || !mounted.current || !visible.current) return;
        setHistory(next);
        const newest = proxyHistoryRows(proxyHistoryOf(next, profileId), 1)[0];
        if (newest?.ipChanged && newest.lastAt === entry.lastAt) announce(profileName(profileId) + ': ' + t('ip_changed'));
      });
    }
    function forgetHistory(profileId) {
      const store = historyRef.current; if (!store?.available) return;
      store.remove(profileId).then(next => { if (next && mounted.current && visible.current) setHistory(next); });
    }
    function clearHistory(profileId) {
      const store = historyRef.current; if (!store?.available || !visible.current) return;
      (profileId === null ? store.clear() : store.remove(profileId)).then(next => {
        if (!next || !mounted.current || !visible.current) return;
        setHistory(next); setHistoryConfirm(null); setNotice(t('history_cleared'));
      });
    }
    // The switch: on by default, stored next to the entries; turning it off stops new entries and keeps the saved ones.
    function setHistorySaving(flag) {
      const store = historyRef.current; if (typeof store?.setEnabled !== 'function' || !visible.current) return;
      store.setEnabled(flag).then(value => { if (typeof value === 'boolean' && mounted.current && visible.current) setHistory(previous => previous ? { ...previous, enabled: value } : previous); });
    }
    // The local links of fingerprint profiles to saved proxies: read as stored (never written here), kept only when well formed.
    function loadLinks() {
      const area = browserApi?.storage?.local;
      if (typeof area?.get !== 'function') return;
      const read = async () => {
        try {
          const stored = await area.get(BUNDLES_KEY);
          if (!mounted.current || !visible.current) return;
          setLinks(readBundles(Object.hasOwn(stored ?? {}, BUNDLES_KEY) ? stored[BUNDLES_KEY] : undefined).links); setLinksRead(true);
        } catch { if (mounted.current) { setLinks(EMPTY_LINKS); setLinksRead(false); } }
      };
      void read();
    }
    // ---- Selection, details, keyboard -----------------------------------------------------------------------------------------------
    const changeView = patch => { const next = proxyViewPatch(viewRef.current, patch); viewRef.current = next; setView(next); writeProxyView(localViewStorage(), next); };
    const setFilter = (key, value) => { if (!visible.current) return; setFilters(previous => ({ ...previous, [key]: key === 'status' ? (STATUS_FILTERS.includes(value) ? value : 'all') : value })); };
    const clearFilters = () => { if (visible.current) setFilters({ query: '', type: 'all', status: 'all', country: 'all' }); };
    function sortBy(key) { const current = viewRef.current; changeView(current.sort === key ? { dir: current.dir === 'desc' ? 'asc' : 'desc' } : { sort: key, dir: key === 'checked' ? 'desc' : 'asc' }); }
    const setSort = key => changeView({ sort: key, dir: key === 'checked' ? 'desc' : 'asc' });
    function resetView() { viewRef.current = DEFAULT_PROXY_VIEW; setView(DEFAULT_PROXY_VIEW); clearProxyView(localViewStorage()); }
    function toggleColumn(key) { const current = viewRef.current.columns; changeView({ columns: current.includes(key) ? current.filter(column => column !== key) : [...current, key] }); }
    function selectClick(id, event) {
      if (!visible.current) return;
      const order = shownIds.current;
      if (event?.shiftKey === true && anchor.current && order.includes(anchor.current)) { const range = proxySelectRange(order, anchor.current, id); setSelection(previous => [...new Set([...previous, ...range])]); }
      else { anchor.current = id; setSelection(previous => proxyToggleSelection(previous, id)); }
      setCurrentId(id);
    }
    function toggleAll() {
      if (!visible.current) return;
      const order = shownIds.current;
      setSelection(previous => order.length > 0 && order.every(id => previous.includes(id)) ? previous.filter(id => !order.includes(id)) : [...new Set([...previous, ...order])]);
    }
    const clearSelection = () => { setSelection([]); anchor.current = null; };
    function openPeek(id) { if (!visible.current) return; setPeekId(id); setCurrentId(id); setMenu(null); pendingFocus.current = { peek: true }; }
    function closePeek() { if (!peekId) return; const id = peekId; setPeekId(null); pendingFocus.current = { row: id }; }
    function toggleMenu(id) { if (!visible.current) return; returnFocus.current = { selector: '[data-proxy-menu="' + id + '"]' }; setMenu(previous => previous === id ? null : id); }
    const closeMenu = () => setMenu(null);
    function onMenuKey(event) {
      const items = [...(event.currentTarget?.querySelectorAll?.('[role^="menuitem"]:not([disabled])') ?? [])], index = items.indexOf(globalThis.document?.activeElement);
      const move = target => { event.preventDefault?.(); items[(target + items.length) % items.length]?.focus?.(); };
      if (event.key === 'ArrowDown') move(index + 1);
      else if (event.key === 'ArrowUp') move(index < 0 ? items.length - 1 : index - 1);
      else if (event.key === 'Home') move(0);
      else if (event.key === 'End') move(items.length - 1);
      else if (event.key === 'Escape') { event.preventDefault?.(); event.stopPropagation?.(); const id = menu; setMenu(null); if (id) pendingFocus.current = { selector: '[data-proxy-menu="' + id + '"]' }; }
      else if (event.key === 'Tab') setMenu(null);
    }
    function moveFocus(id) { setCurrentId(id); pendingFocus.current = { row: id }; }
    function onGridKey(event) {
      if (!visible.current || event.defaultPrevented) return;
      const target = event.target, tag = String(target?.tagName ?? '').toLowerCase();
      if (tag === 'textarea' || tag === 'select' || tag === 'input' && target.type !== 'checkbox') return;
      const row = target?.closest?.('[data-proxy-profile]'); if (!row) return;
      const id = row.getAttribute?.('data-proxy-profile'), order = shownIds.current, index = Math.max(0, order.indexOf(id));
      const action = proxyGridKeyAction(event, { index, count: order.length, page: 8 }), onRow = target === row, onCheckbox = tag === 'input';
      if (!action) return;
      if (action.type === 'focus') {
        event.preventDefault?.(); const next = order[action.index]; if (!next) return;
        if (action.extend) { anchor.current ??= id; setSelection(proxySelectRange(order, anchor.current, next)); }
        moveFocus(next);
      } else if (action.type === 'toggle') { if (onRow) { event.preventDefault?.(); anchor.current = id; setSelection(previous => proxyToggleSelection(previous, id)); } }
      else if (action.type === 'select-all') { event.preventDefault?.(); toggleAll(); }
      else if (action.type === 'open') { if (onRow) { event.preventDefault?.(); openPeek(id); } }
      else if (action.type === 'delete') { if (onRow || onCheckbox) { event.preventDefault?.(); askRemove(selection.includes(id) && selection.length > 1 ? selection : [id]); } }
      else if (action.type === 'check') { if (onRow) { event.preventDefault?.(); checkSavedProfiles([id]); } }
      else if (action.type === 'search') { event.preventDefault?.(); searchRef.current?.focus?.(); }
    }
    // The chip groups and the density switch: one tab stop each (the chip that last had the focus, or the one that is on), arrows, Home
    // and End move the focus inside (mirrored in right-to-left languages), Space and Enter press the focused chip as any button.
    const focusChip = (group, key) => setChipStops(previous => previous[group] === key ? previous : { ...previous, [group]: key });
    function onChipKey(event) {
      if (!visible.current || event.defaultPrevented) return;
      const items = [...(event.currentTarget?.querySelectorAll?.('button:not([disabled])') ?? [])], index = items.indexOf(event.target?.closest?.('button') ?? null);
      const next = proxyRovingTarget(event, { index, count: items.length, rtl: isRtl });
      if (next === null) return;
      event.preventDefault?.(); items[next]?.focus?.();
    }
    // "Skip to the profile list": the first stop of the page section; the focus goes to the row Tab would reach (or, with no rows yet, to the search).
    function skipToList() {
      if (!visible.current) return;
      const root = rootRef.current, id = currentId && shownIds.current.includes(currentId) ? currentId : shownIds.current[0] ?? null;
      const target = (id ? root?.querySelector?.('[data-proxy-profile="' + id + '"]') : null) ?? root?.querySelector?.('[data-proxy-search]') ?? profilesRef.current;
      if (id) setCurrentId(id);
      target?.focus?.();
    }
    function onRootKey(event) {
      if (!visible.current || event.defaultPrevented || event.isComposing) return;
      const target = event.target, tag = String(target?.tagName ?? '').toLowerCase();
      if (target?.closest?.('dialog')) return;
      const typing = tag === 'textarea' || tag === 'select' || tag === 'input' && target.type !== 'checkbox' && target.type !== 'radio' || target?.isContentEditable === true;
      if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !typing) { event.preventDefault?.(); searchRef.current?.focus?.(); return; }
      if (event.key === 'Escape' && !typing) {
        if (menu) { setMenu(null); return; }
        if (geoConfirm) { cancelGeoLookupAll(); event.preventDefault?.(); return; }
        if (selection.length) { clearSelection(); event.preventDefault?.(); return; }
        if (peekId) { closePeek(); event.preventDefault?.(); }
      }
    }
    const onPeekKey = event => { if (event.key === 'Escape' && peekId && !event.defaultPrevented) { event.preventDefault?.(); event.stopPropagation?.(); closePeek(); } };
    // ---- Removal ------------------------------------------------------------------------------------------------------------------
    // Profiles that can go: the connected one stays (the service refuses it).
    const deletableIds = ids => ids.filter(id => !(configuration?.enabled && configuration.selectedId === id));
    function askRemove(ids) { if (lock.current || !visible.current) return; const doomed = deletableIds(ids); if (doomed.length) { setRemoving(doomed); setMenu(null); pendingFocus.current = { selector: '[data-proxy-remove-cancel]' }; } }
    function confirmRemove() {
      const ids = removing; if (!ids?.length || lock.current || !visible.current || !mounted.current) return Promise.resolve(null);
      if (ids.length === 1) { const doomed = ids[0]; return run(() => client.current.deleteProfile(doomed), () => { setRemoving(null); setSelection(previous => previous.filter(id => id !== doomed)); setPeekId(previous => previous === doomed ? null : previous); forgetHistory(doomed); setNotice(c('saved')); pendingFocus.current = { selector: '[data-proxy-profile], [data-proxy-empty-new]' }; }); }
      const current = acceptedConfiguration.current, epoch = generation.current, still = () => mounted.current && visible.current && generation.current === epoch, removed = [];
      const finish = () => { removed.forEach(forgetHistory); setRemoving(null); pendingFocus.current = { selector: '[data-proxy-profile], [data-proxy-empty-new]' }; setSelection(previous => previous.filter(id => !removed.includes(id))); setPeekId(previous => removed.includes(previous) ? null : previous); };
      return run(async () => {
        if (ids.some(id => current?.profiles.find(profile => profile.id === id)?.native)) await client.current.requestAccess({ native: true });
        for (const id of ids) { if (!still()) break; const value = await client.current.deleteProfile(id); removed.push(id); if (still() && value?.configuration && value?.status) accept(value); }
        return { removed: removed.length };
      }, value => { finish(); setNotice(c('saved') + ': ' + value.removed); }, failure => { finish(); fail(failure); });
    }
    // ---- View model ---------------------------------------------------------------------------------------------------------------------
    const leaveAnalyzer = next => { if (openPanelId === 'analyzer' && next !== 'analyzer') { setCheckTarget(DEFAULT_CHECK_URL); setCheckResult(null); } };
    const diagnostic = failureDiagnostic ?? (SAFE_CODES.has(snapshot?.status?.code) ? snapshot.status : null);
    const selectedProfile = profiles.find(profile => profile.id === configuration?.selectedId), proxyEnabled = configuration?.enabled === true;
    const disconnectDisabled = busy || !configuration?.enabled && !['connecting', 'connected', 'blocked', 'error'].includes(state);
    // Connecting to an HTTP(S) proxy that needs a login only proves that the server answers (and, for HTTPS, its certificate): the
    // companion verifies the login with the first CONNECT, which is the first request or the check. Say so until a check has run.
    const loginUnchecked = proxyEnabled && state === 'connected' && selectedProfile?.native === true && (selectedProfile.type === 'http' || selectedProfile.type === 'https') && !checkResult && !(profileChecks && Object.hasOwn(profileChecks, selectedProfile.id));
    const checks = proxyMergedChecks(profileChecks, history, profiles);
    const shown = proxyFilterProfiles(profiles, filters, checks).sort(proxyCompare(view.sort, view.dir, checks));
    shownIds.current = shown.map(profile => profile.id);
    const facets = proxyFacetCounts(profiles, filters, checks), countries = proxyCountriesPresent(profiles);
    const linkedAvailable = linksRead, linkedOf = id => linkedAvailable ? profilesOfProxy(links, id) : [];
    const columns = view.columns.filter(column => column !== 'linked' || linkedAvailable && Object.keys(links).length > 0);
    const columnChoices = [['type', c('field_type'), 'proxy'], ['address', t('column_address'), 'globe'], ['country', t('country_short'), 'globe'], ...(linkedAvailable ? [['linked', t('column_linked'), 'link']] : []), ['check', t('check_result'), 'status'], ['ip', t('remote_ip'), 'route'], ['checked', t('column_checked'), 'history']].map(([key, label, glyph]) => ({ key, label, glyph }));
    const nameCounts = new Map();
    for (const profile of profiles) { const key = profile.name.trim().toLocaleLowerCase(); nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1); }
    // Equal names get their endpoint beside them; the endpoint is metadata, never a login.
    const duplicateEndpoint = profile => nameCounts.get(profile.name.trim().toLocaleLowerCase()) > 1 ? proxyEndpointLabel(profile.host, profile.port) : '';
    const peekProfile = peekId ? profiles.find(profile => profile.id === peekId) ?? null : null;
    const selectedSet = new Set(selection), hasFilters = proxyHasFilters(filters);
    const dialogOpen = editor !== null || bulk !== null, loadFailed = snapshot === null && Boolean(error);
    const geoReady = proxyGeoReady(geoState), geoTargetCount = geoReady ? geoTargets().length : 0;
    const geo = geoState ? {
      on: proxyGeoOn(geoState), ready: geoReady, columns: proxyGeoColumns(geoState), banner: proxyGeoBannerState(geoState, geoDismissed !== false), t: geoText, targets: geoTargetCount,
      row: (profile, check) => proxyGeoRowInfo({ state: geoState, check, profile, now, failures: geoFailures }),
      quota: provider => { const remaining = geoState.providers?.[provider]?.remaining; return Number.isSafeInteger(remaining) ? remaining : null; },
      confirm: geoReady && geoConfirm ? { count: geoConfirm.ips.length, name: geoConfirm.name } : null,
      confirmText: ({ count, name }) => formatText(geoLabels[proxyGeoPluralKey('confirm', count, langTag, key => Object.hasOwn(geoLabels, key))], { n: count, name }),
      lookup: geoLookup, askLookupAll: askGeoLookupAll, cancelLookupAll: cancelGeoLookupAll, confirmLookupAll: confirmGeoLookupAll, toggleColumn: toggleGeoColumn, dismissBanner: dismissGeoBanner, openSettings: openGeoSettings,
    } : null;
    const m = {
      geo, t, c, locale, langTag, now, stamp, active, busy, snapshot, configuration, profiles, shown, state, selectedProfile, proxyEnabled, disconnectDisabled, loginUnchecked, diagnostic, error, notice, settings, settingsDirty: dirtySettings.current && Boolean(settings),
      checks, checkingProfiles, batchSummary, checkResult, checkTarget, checking, filters, filtersOpen, toggleFilters: () => { if (visible.current) setFiltersOpen(previous => !previous); }, facets, countries, hasFilters, view: { ...view, columns }, columnChoices, selection, selectedSet, deletable: deletableIds(selection), currentId: currentId && shownIds.current.includes(currentId) ? currentId : shownIds.current[0] ?? null, peekId, menu, helpOpen, removing, history, historyConfirm,
      openPanelId, domainDrafts, domainError, editor, paste, reveal, showErrors, errors: editorErrors, sessionTarget, sessionValid: proxySessionFormatValid(sessionFormat), duplicateNote, originalName: editTitle, bulk, imported, extensionId: browserApi?.runtime?.id, linkedAvailable, errorText: error,
      gridRef, searchRef, peekRef, editorRef, editorDialog, bulkDialog, fileInput,
      duplicateEndpoint, linkedOf, diagnosticText, needsNativeRestart, reasonText, bulkRoom,
      setFilter, clearFilters, sortBy, setSort, setSortDir: dir => changeView({ dir }), setDensity: density => changeView({ density }), toggleColumn, resetView,
      selectClick, toggleAll, clearSelection, rowFocus: id => { if (currentId !== id) setCurrentId(id); }, openPeek, closePeek, toggleMenu, closeMenu, onMenuKey, onGridKey, onPeekKey, chipStops, focusChip, onChipKey, toggleHelp: () => setHelpOpen(previous => !previous), dismissSummary: () => setBatchSummary(null),
      checkOne: id => checkSavedProfiles([id]), checkVisible: () => checkSavedProfiles(shownIds.current), checkSelected: () => checkSavedProfiles(profiles.filter(profile => selectedSet.has(profile.id)).map(profile => profile.id)), stopChecks,
      connect: connectProfile, connectSelected, disconnect: () => run(() => client.current.disconnect()), edit: openEditor, duplicate: duplicateProfile, copyJson: copyProfiles, copyAddress, askRemove, cancelRemove: () => { if (!lock.current) { const id = removing?.[0]; setRemoving(null); if (id) pendingFocus.current = { row: id }; } }, confirmRemove,
      openNew: type => openEditor(null, TYPES.includes(type) ? type : 'socks5'), openOpenVpnFile: () => { fileRequest.current = true; openEditor(null, 'openvpn'); }, openBulk, cancelBulk, changeBulk, parseBulk, backBulk, toggleBulk, selectAllBulk, saveBulk,
      change, cancelEditor, saveProfile, switchType, onTypeKey, setPaste: value => { if (!busy && visible.current) setPaste(value); }, parsePasted, randomSession, toggleReveal: key => setReveal(previous => ({ ...previous, [key]: !previous[key] })), fileChange, pastePreview, sessionView, detailNotes, countryBox, pasteRef,
      reload: () => run(() => client.current.load()), checkImported, deleteFailedImported, keepImported: () => setImported(previous => previous ? { ...previous, confirm: false } : previous), askDeleteFailedImported: () => { if (!lock.current && visible.current) setImported(previous => previous ? { ...previous, confirm: true } : previous); }, closeImported: () => { if (!lock.current) setImported(null); },
      changeSetting, changeRouting, saveSettings, discardSettings, setDomainDraft: (key, value) => { if (!lock.current && visible.current) { setDomainDrafts(previous => ({ ...previous, [key]: value })); setDomainError(null); } }, commitDomains, removeDomain, onDomainKey, grantPrivacy: () => run(() => client.current.requestAccess({ privacy: true })), grantNative: () => run(() => client.current.requestAccess({ native: true })), companionAsked, checkCompanion: () => { setCompanionAsked(true); return run(() => client.current.hostStatus()); }, restartNative: () => configuration?.enabled === false ? run(() => client.current.restartNative()) : Promise.resolve(null),
      // Leaving the analyzer by any route drops its test address and result: the address may carry a private query.
      togglePanel: key => { if (!visible.current) return; leaveAnalyzer(openPanelId === key ? null : key); setOpenPanelId(previous => previous === key ? null : key); }, openPanel: key => { if (visible.current) { leaveAnalyzer(key); setOpenPanelId(key); } },
      setCheckTarget: value => { if (!lock.current && visible.current) { setCheckTarget(value); setCheckResult(null); } }, diagnoseConnection,
      setHistoryConfirm: value => { if (visible.current) setHistoryConfirm(value); }, clearHistory, setHistorySaving,
    };
    // ---- Page ------------------------------------------------------------------------------------------------------------------------
    // While a dialog is open its own notes show the error; behind it the page keeps quiet. A failed first load shows its error in the list.
    const messageNodes = routeUi.messages({ ...m, error: dialogOpen || loadFailed ? '' : error, diagnostic: dialogOpen || loadFailed ? null : diagnostic });
    function helpPanel() {
      if (!helpOpen) return null;
      return h('div', { class: 'pm-help', id: 'pm-help', role: 'region', 'aria-label': t('help'), 'data-proxy-help-panel': true, children: h('dl', { class: 'pm-help-list', children: [
        [t('kill_switch'), t('kill_switch_detail')], [t('protect_webrtc'), t('protect_webrtc_detail')], [t('direct_domains'), t('direct_domains_detail')], [t('country_label'), t('country_hint')], [t('history_title'), t('history_note')], [t('analyzer'), t('tcp_fingerprint_detail')],
      ].map(([term, text]) => h('div', { class: 'pm-help-item', key: term, children: [h('dt', { children: term }), h('dd', { children: text })] })) }) });
    }
    // History: the switch and what is kept, once under the list; one button clears everything.
    function listFoot() {
      if (!history) return null;
      const any = Object.keys(history.items).length > 0, saving = history.enabled !== false, canSwitch = typeof historyRef.current?.setEnabled === 'function';
      return h('div', { class: 'pm-listfoot', 'data-proxy-history-footer': true, children: [
        canSwitch ? h('label', { class: 'pm-checkrow pm-history-switch', children: [h('input', { type: 'checkbox', checked: saving, disabled: busy, 'aria-describedby': 'pm-history-save-note', 'data-proxy-history-save': true, onChange: event => setHistorySaving(event.currentTarget.checked) }), h('span', { class: 'pm-checkrow-text', children: [h('strong', { children: t('history_save') }), h('small', { id: 'pm-history-save-note', class: 'pm-muted', children: t('history_save_note') })] })] }) : null,
        !any ? null : historyConfirm === 'all'
          ? h('div', { class: 'pm-confirm', role: 'group', 'aria-label': t('history_clear_all_confirm'), 'data-proxy-history-confirm': 'all', children: [h('p', { children: t('history_clear_all_confirm') }), h('div', { class: 'pm-confirm-actions', children: [button(c('cancel'), { 'data-proxy-history-keep': true, onClick: () => setHistoryConfirm(null) }), button(c('action_remove'), { class: 'button pm-danger', 'data-proxy-history-clear-confirm': 'all', onClick: () => clearHistory(null) }, 'delete')] })] })
          : button(t('history_clear_all'), { class: 'button button--text pm-danger-text', 'data-proxy-history-clear-all': true, onClick: () => setHistoryConfirm('all') }, 'delete'),
      ] });
    }
    function body() {
      if (loadFailed) return list.errorState({ ...m, errorText: error, errorCode: diagnostic?.code ?? null });
      if (skeleton) return list.skeleton();
      if (snapshot === null) return h('div', { class: 'pm-blank pm-blank--loading', 'data-proxy-loading': true, 'aria-busy': 'true', children: h('span', { class: 'proxy-workspace-sr', children: t('loading') }) });
      if (!profiles.length) return list.emptyState(m);
      if (!shown.length) return h('div', { class: 'pm-body', children: [list.filters(m), list.noResults(m)] });
      return h('div', { class: 'pm-body', children: [
        list.filters(m),
        h('div', { class: 'pm-panes' + (peekProfile ? ' has-peek' : ''), children: [
          h('div', { class: 'pm-listcol', children: list.grid(m) }),
          peekProfile ? h('div', { class: 'pm-peek-wrap', children: [h('div', { class: 'pm-peek-scrim', 'aria-hidden': 'true', onClick: () => closePeek() }), peekUi.peek(m, peekProfile)] }) : null,
        ] }),
      ] });
    }
    return h('section', { class: 'proxy-workspace pm pm-density--' + view.density, ref: rootRef, hidden: !active, dir: isRtl ? 'rtl' : undefined, 'data-proxy-workspace': true, 'aria-busy': busy ? 'true' : 'false', onKeyDown: onRootKey, children: [
      h('button', { type: 'button', class: 'pm-skip', 'data-proxy-skip': true, onClick: skipToList, children: t('skip_to_list') }),
      WorkspaceMaster({ id: 'proxy', label: 'Proxy', busy, className: 'pm-master', tools: ToolButton({ icon: 'export', label: t('export'), disabled: busy || !configuration, 'data-proxy-export': true, onClick: exportMetadata }), control: [
        button('OFF', { class: 'button workspace-master-toggle workspace-master-toggle--off', role: 'switch', 'aria-checked': false, 'aria-label': 'Proxy', 'aria-describedby': configuration && !selectedProfile ? 'proxy-setup-hint' : undefined, title: t(selectedProfile ? 'connect' : profiles.length ? 'choose_profile' : 'new_profile'), hidden: proxyEnabled, disabled: busy || !configuration || state === 'connecting', 'data-proxy-master': true, onClick: connectSelected }),
        button(proxyEnabled ? 'ON' : t('disconnect'), { class: proxyEnabled ? 'button workspace-master-toggle workspace-master-toggle--on' : 'button', role: proxyEnabled ? 'switch' : undefined, 'aria-checked': proxyEnabled ? true : undefined, 'aria-label': proxyEnabled ? 'Proxy' : t('disconnect'), title: t('disconnect'), hidden: !proxyEnabled && disconnectDisabled, disabled: disconnectDisabled, 'data-proxy-disconnect': true, onClick: () => run(() => client.current.disconnect()) }),
      ], children: h('div', { class: 'pm-route', children: [routeUi.summary(m), routeUi.protections(m), routeUi.saveBar(m), routeUi.disclosures(m)] }) }),
      messageNodes.length ? h('div', { class: 'pm-messages', children: messageNodes }) : null,
      h('section', { class: 'pm-card pm-list-card', 'data-proxy-manager': true, ref: profilesRef, tabIndex: -1, children: [
        list.listHeader(m), list.geoBanner(m), list.geoConfirm(m), helpPanel(), sheetUi.importedBar(m), body(), listFoot(), configuration && profiles.length ? list.actionBar(m) : null,
      ] }),
      sheetUi.editorSheet({ ...m, error: editor !== null ? error : '', diagnosticNode: editor !== null ? routeUi.diagnosticBlock({ ...m, error, diagnostic }) : null }), sheetUi.bulkDialog({ ...m, error }),
    ] });
  }
  return { ProxyApp };
}
