// ADR-064 / E22-24: one revisioned configuration and directly editable IPv4/IPv6 drafts.
import { createAntidetectController, ipv4MappedIpv6, antidetectDraft } from './antidetect-controller.js';
import { createApiConfiguration, API_MATH_FUNCTIONS } from './api-configuration.js';
import { PROTECTION_FEATURE_FILTER } from './protection-ui.js';
import { antidetectEditorLabels } from './antidetect-editor-labels.js';
import { createMathTranscendentalsUi } from './antidetect-math-ui.js';
import { createFingerprintProfileUi } from './fingerprint-profile-ui.js';
import { createWorkspaceControlsUi } from './workspace-controls-ui.js';
import { managementNavigationLabels } from './management-navigation-labels.js';
import { fingerprintDeviceLabels } from './fingerprint-device-labels.js';
import { DEVICE_ICON_PATHS } from './fingerprint-device-icons.js';
import { redesignLabels } from './redesign-labels.js';
// Catalog 8: the literal host mode «mdns» and its labels belong to the WebRTC profile module; this editor only offers the same choice.
// ADR-107: the same module owns the one address check shared with the API Guard dialog.
import { WEBRTC_HOST_MDNS, webRtcText, webRtcAddressProblem, webRtcAddressMessage, watchPointer, afterPointerRelease, webRtcPolicyChoices, webRtcFirefoxBuild, webRtcPolicyLabelKey } from './webrtc-configuration-ui.js';
// ADR-105: the pure plan of the HTTP header rules, shown here as one informational line.
import { describeAntidetectHeaders } from './antidetect-header-controller.js';
import { announce } from './ui-announcer.js';
import { registerSaveShortcut, registerDirtyGuard, registerPaletteCommands } from './ui-shortcuts.js';
// Round 5: the entry points of the guided tour (the checklist block and the link beside Refresh); the tour itself lives in ui-tour.js.
import { createTourEntry } from './ui-tour.js';
// ADR-113: the setting "do not run the observation sensors while Antidetect is on" (a card of the Network level).
import { createAntidetectQuietUi } from './antidetect-quiet-ui.js';

// ADR-104: the quick-setup tab followed by the four device levels.
export const ANTIDETECT_CATEGORIES = Object.freeze(['quick', 'device', 'os', 'browser', 'network']);
// These four tabs are views of one retained profile panel, so staged edits survive switching between them.
export const ANTIDETECT_PANEL_CATEGORIES = Object.freeze(['quick', 'device', 'os', 'browser']);
const ROLES = Object.freeze(['host', 'stun', 'turn']);
const DEVICE_KINDS = Object.freeze(['audioinput', 'videoinput', 'audiooutput']);
const clone = value => JSON.parse(JSON.stringify(value));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const emptyAddresses = () => ({ ipv4: { host: null, stun: null, turn: null }, ipv6: { host: null, stun: null, turn: null } });
const ERROR_KEYS = Object.freeze({
  'stale-revision': 'stale', stale: 'stale', 'stale-record': 'stale', 'stale-state': 'stale',
  'invalid-value': 'invalid', 'invalid-input': 'invalid', 'invalid-configuration': 'invalid',
  'conflicting-webrtc-devices': 'conflict_devices', 'permission-denied': 'denied',
  'permission-required': 'denied', 'inactive': 'scope_inactive', 'not-visible': 'scope_inactive',
  'privacy-permission-required': 'privacy_required', 'early-access-required': 'early_required', 'browser-toggle-required': 'early_required', unsupported: 'unavailable',
});
// Overview: rows edited by the embedded API editor, grouped as that editor groups them.
export const ANTIDETECT_OVERVIEW_CATEGORIES = Object.freeze(['device', 'os', 'browser', 'network']);
export const ANTIDETECT_OVERVIEW_MODES = Object.freeze(['custom', 'on', 'off']);
const DEDICATED_ROWS = Object.freeze(['webrtc', 'media-enumeration', 'websocket', 'webtransport', 'math-transcendentals']);
// Mirrors categoryFor of api-configuration-ui.js with the same PROTECTION_FEATURE_FILTER tags.
// ADR-104 (ТЗ §4–§6): level placement of rows for this tab only; API Guard keeps PROTECTION_FEATURE_FILTER.
// Ids are the embedded editor's categories (hardware = the «Устройство» level).
export const ANTIDETECT_CATEGORY_OVERRIDES = Object.freeze({
  // 01 Устройство: processor, memory, storage quota, screen.
  'hardware-concurrency': 'hardware', 'device-memory': 'hardware', 'storage-estimate': 'hardware', 'touch-points': 'hardware', 'performance-memory': 'hardware',
  // 02 ОС: platform, language, time zone and the font fingerprint.
  'navigator-platform': 'os', 'navigator-oscpu': 'os', 'navigator-language': 'os', 'navigator-languages': 'os', timezone: 'os', 'intl-formatting': 'os',
  'local-fonts': 'os', 'canvas-font-policy': 'os', 'canvas-text-metrics': 'os',
  // The Region control writes these coordinates; the generic row stays in the same level for the six city presets and explicit
  // coordinates (it is not in DEDICATED_ROWS on purpose: the picker only knows each region's default city).
  geolocation: 'os',
  // 03 Браузер: User-Agent and the render fingerprints.
  'navigator-user-agent': 'browser', 'navigator-app-version': 'browser', 'navigator-vendor': 'browser', 'navigator-metadata': 'browser', 'navigator-plugins': 'browser', 'client-hints': 'browser',
  'canvas-readback': 'browser', webgl: 'browser', 'webgl-capabilities': 'browser', 'webgl-readback': 'browser', webgpu: 'browser', 'webgpu-capabilities': 'browser',
  audio: 'browser', 'audio-fingerprint': 'browser', 'audio-metadata': 'browser',
});
function apiCategory(entry) {
  const tag = Object.hasOwn(ANTIDETECT_CATEGORY_OVERRIDES, entry.id) ? ANTIDETECT_CATEGORY_OVERRIDES[entry.id] : Object.hasOwn(PROTECTION_FEATURE_FILTER, entry.id) ? PROTECTION_FEATURE_FILTER[entry.id] : null;
  const category = tag ?? (entry.id.startsWith('screen-') || entry.id === 'window-device-pixel-ratio' ? 'hardware'
    : entry.group === 'system' || entry.id.startsWith('navigator-') || entry.id === 'timezone' ? 'os'
    : ['device', 'graphics', 'hardware', 'media'].includes(entry.group) ? 'hardware'
    : entry.group === 'network' ? 'network' : entry.group === 'identity' ? 'social' : 'browser');
  // ADR-104: the Antidetect level is named «device»; the embedded editor keeps its own «hardware» id.
  return category === 'hardware' ? 'device' : category;
}
// Read-only counts of explicit saved modes; «Как в пресете» rows are not counted.
export function antidetectApiCounts(configuration) {
  const counts = Object.fromEntries([...ANTIDETECT_OVERVIEW_CATEGORIES, 'all'].map(id => [id, { custom: 0, on: 0, off: 0 }]));
  for (const entry of Array.isArray(configuration?.apis) ? configuration.apis : []) {
    if (!entry?.customSupported || DEDICATED_ROWS.includes(entry.id) || !ANTIDETECT_OVERVIEW_MODES.includes(entry.mode)) continue;
    counts.all[entry.mode]++;
    const category = apiCategory(entry); if (Object.hasOwn(counts, category)) counts[category][entry.mode]++;
  }
  return counts;
}
// Why a switched-on master registers nothing: the browser rejected it, user scripts are not allowed, or the access scope does not reach
// the sites. The saved reply carries no scope list, so the page header and the HTTP-headers line share this inference.
export function antidetectRegistrationProblem(saved) {
  if (!saved?.draft?.enabled || saved.registration === 'ready') return null;
  if (saved.registration === 'error') return 'error';
  if (saved.earlyAccess === 'browser-toggle-required' || saved.earlyAccess === 'permission-required') return 'scripts';
  return antidetectApiCounts(saved.configuration).all.custom > 0 ? 'scope' : 'idle';
}
// ADR-105: the HTTP-headers line is the pure plan of antidetect-header-controller.js for the saved configuration; it never reads or
// writes the browser. Header names come from that plan and are shown only when they have the shape of a header name; more than
// HEADER_NAME_LIMIT valid names end in a visible «+N» instead of being dropped silently.
const HEADER_GLOBAL_SCOPE = Object.freeze(['http://*/*', 'https://*/*']);
const HEADER_REASON_KEYS = Object.freeze({ scope: 'headers_scope', 'site-overrides': 'headers_site_overrides', engine: 'headers_engine', invalid: 'headers_invalid' });
const HEADER_NAME = /^[a-z0-9-]{1,64}$/u, HEADER_NAME_LIMIT = 32;
function headerNames(list) {
  const valid = Array.isArray(list) ? list.filter(name => typeof name === 'string' && HEADER_NAME.test(name)) : [];
  return { names: valid.slice(0, HEADER_NAME_LIMIT), more: Math.max(0, valid.length - HEADER_NAME_LIMIT) };
}
// The controller applies the rule only while the master is on AND user scripts are allowed (data consent is not visible here and is
// assumed). The plan is asked with exactly that gate; when only the browser's user-script switch is missing, a second question says
// whether the profile would otherwise have been applied, so the line names the real blocker instead of «Antidetect is off».
export function antidetectHeaderLine(saved, { chrome, describe = describeAntidetectHeaders } = {}) {
  const configuration = saved.configuration, masterOn = configuration.antidetectEnabled === true || configuration.enabled === true;
  const scope = antidetectRegistrationProblem(saved) === 'scope' ? [] : HEADER_GLOBAL_SCOPE, ready = saved.earlyAccess === 'ready';
  const ask = active => { try { return describe(configuration, scope, active, { chrome: chrome === true }); } catch { return null; } };
  const plan = ask(masterOn && ready), line = (state, textKey, extra = {}) => ({ state, textKey, reason: null, set: [], setMore: 0, removed: [], removedMore: 0, ...extra });
  if (masterOn && !ready && ask(true)?.status === 'applied') return line('unsupported', 'status_needs_scripts', { reason: 'scripts' });
  switch (plan?.status) {
    case 'applied': { const set = headerNames(plan.set), removed = headerNames(plan.removed); return line('applied', 'headers_applied', { set: set.names, setMore: set.more, removed: removed.names, removedMore: removed.more }); }
    case 'inactive': return line('inactive', 'headers_inactive');
    case 'unsupported': return line('unsupported', HEADER_REASON_KEYS[plan.reason] ?? 'headers_inactive', { reason: typeof plan.reason === 'string' ? plan.reason : null });
    case 'error': return line('error', 'headers_invalid', { reason: 'invalid' });
    default: return line('unknown', null);
  }
}
// One planner run costs milliseconds (up to ~50 ms with 128 site entries): ask once per saved reply, not once per render.
const headerLines = new WeakMap();
function headerLineFor(saved, chrome, describe) {
  const cached = headerLines.get(saved);
  if (cached && cached.chrome === chrome && cached.describe === describe) return cached.line;
  const line = antidetectHeaderLine(saved, { chrome, describe });
  headerLines.set(saved, { chrome, describe, line }); return line;
}
let defaultDraft = null;
const defaults = () => defaultDraft ??= antidetectDraft(createApiConfiguration());

// ADR-107: the activation checklist is derived only from the saved reply, so nothing is stored and it disappears once every step is
// done. Steps: user scripts allowed, the master on, a device applied (Custom rows saved and nothing keeps them from registering) and,
// while the backend reports it, the instruction to reload open tabs, which is never ticked. 'unavailable' is never counted as done.
export const ANTIDETECT_CHECKLIST_STEPS = Object.freeze(['scripts', 'master', 'device', 'reload']);
export function antidetectChecklist(saved) {
  if (!saved?.draft || !saved.configuration) return null;
  const problem = antidetectRegistrationProblem(saved), custom = antidetectApiCounts(saved.configuration).all.custom;
  const steps = [
    { id: 'scripts', state: saved.earlyAccess === 'ready' ? 'done' : saved.earlyAccess === 'unsupported' ? 'unavailable' : 'open' },
    { id: 'master', state: saved.draft.enabled === true ? 'done' : 'open' },
    { id: 'device', state: problem === 'error' ? 'error' : custom > 0 && problem === null ? 'done' : 'open', reason: problem },
  ];
  if (saved.reloadRequired === true) steps.push({ id: 'reload', state: 'instruction' });
  if (steps.every(step => step.state === 'done')) return null;
  return { steps, primary: steps.find(step => step.state === 'open')?.id ?? null };
}
// ADR-107: levels with unapplied changes of this page's own draft: the network controls and the Math panel of «Устройство».
const NETWORK_DRAFT_KEYS = Object.freeze(['mode', 'profile', 'devices', 'websocket', 'webtransport', 'networkPolicy']);
export function antidetectPendingLevels(savedDraft, draft) {
  const levels = new Set();
  if (!savedDraft || !draft) return levels;
  if (NETWORK_DRAFT_KEYS.some(key => !same(savedDraft[key], draft[key]))) levels.add('network');
  if (!same(savedDraft.math, draft.math)) levels.add('device');
  return levels;
}
// The reason the profile panel is locked while this page has its own pending or unverified draft (prop `disabledReason`).
export function antidetectPanelReason({ busy = false, dirty = false, uncertain = false } = {}) {
  return dirty ? 'network-dirty' : uncertain ? 'unverified' : busy ? 'busy' : null;
}
// Fields left at least once; each update creates a new set, this one is never mutated.
const NO_FIELDS = new Set();
const NO_LEVELS = Object.freeze([]);
const SAVE_REASON_KEYS = Object.freeze({ busy: 'reasonBusy', external: 'reasonExternal', unverified: 'reasonUnverified' });
const ADDRESS_FIELDS = Object.freeze(['ipv4', 'ipv6'].flatMap(family => ROLES.map(role => family + ':' + role)));
export function antidetectAddressProblems(addresses) {
  if (!addresses) return [];
  return ADDRESS_FIELDS.filter(name => { const [family, role] = name.split(':'); return webRtcAddressProblem(family, role, addresses[family]?.[role] ?? null) !== null; });
}

export function createAntidetectUi({ h, useState, useEffect, useRef, useLocale, translate, browserApi = globalThis.chrome, ApiConfigurationEditor, describeHeaders = describeAntidetectHeaders }) {
  const { WorkspaceMaster, ToolButton } = createWorkspaceControlsUi({ h });
  const { MathTranscendentalsPanel } = createMathTranscendentalsUi({ h, useState, useEffect, useRef, useLocale, translate });
  const { FingerprintProfilePanel } = createFingerprintProfileUi({ h, useState, useEffect, useRef, useLocale, translate, browserApi });
  const { TourStart } = createTourEntry({ h, useState, useEffect, useLocale });
  const { QuietSensorsCard } = createAntidetectQuietUi({ h, useState, useEffect, useRef, useLocale, browserApi });
  const t = key => translate('antidetect_' + key);
  const rtc = key => translate('protection_webrtc_' + key);
  const policyLabel = value => {
    const key = value === 'default' ? 'policy_system' : webRtcPolicyLabelKey(value);
    return key ? rtc(key) : typeof value === 'string' ? value : '—';
  };
  function Icon({ name, size = 21 }) {
    const paths = {
      profiles: 'M8 9a4 4 0 1 0 8 0 4 4 0 1 0-8 0ZM4 22v-3a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v3M3 3h4m10 0h4',
      hardware: 'M8 3v3m4-3v3m4-3v3M8 18v3m4-3v3m4-3v3M3 8h3m-3 4h3m-3 4h3m12-8h3m-3 4h3m-3 4h3M8 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Zm1 3h6v6H9Z',
      os: 'M3 4h18v16H3ZM3 9h18M8 9v11M6 6.5h.01M9 6.5h.01',
      network: 'M12 8v7M5 18v-3h14v3M12 15v3M9 2h6v6H9ZM2 18h6v4H2Zm7 0h6v4H9Zm7 0h6v4h-6Z',
      all: 'M3 3h7v7H3Zm11 0h7v7h-7ZM3 14h7v7H3Zm11 0h7v7h-7Z',
      browser: 'M3 4h18v16H3ZM3 9h18M6 6.5h.01M9 6.5h.01M12 6.5h.01M9 13l-2 2 2 2m6-4 2 2-2 2',
      webrtc: 'M7 5a4 4 0 1 1 0 8H5v4h7m0 0-3-3m3 3-3 3m8-1a4 4 0 1 1 0-8h2V7h-7m0 0 3-3m-3 3 3 3',
      devices: 'M3 4h14v12H3ZM6 20h8m-4-4v4m7-9h5v10h-5Z',
      certificates: 'M14 3H5v18h9m0-18 6 6v3M14 3v6h6m-6 5 3-1 3 1v4l-3 3-3-3Z',
      leak: 'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6Zm-4 9 3 3 5-6',
      udp: 'M5 4h14v4H5Zm0 12h14v4H5ZM8 8v8m8-8v8m-8-4h8',
      quic: 'm13 2-8 12h6l-1 8 9-13h-6Z',
      websocket: 'm8 5-5 7 5 7m8-14 5 7-5 7M8 12h8',
      webtransport: 'M3 7h14m-4-4 4 4-4 4M21 17H7m4-4-4 4 4 4',
      ipv6: 'M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0Zm0 0h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z',
    };
    // ADR-104: device/OS/browser level icons fall back to the shared device icon set.
    const raw = Object.hasOwn(paths, name) ? paths[name] : DEVICE_ICON_PATHS[name] ?? paths.network;
    const list = Array.isArray(raw) ? raw : [raw];
    return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': true, focusable: 'false', children: list.map((d, index) => h('path', { d, key: index })) });
  }

  // `request` ({ level, focus? }) comes from the Options command palette or the guided tour: a new object selects that level once this
  // section is shown, and moves focus to its tab unless `focus` is false (the tour keeps focus in its own popover).
  function AntidetectApp({ active = true, tabId = null, request = null }) {
    const locale = useLocale(), dwords = fingerprintDeviceLabels(locale), [category, setCategory] = useState('network'), [apiVisited, setApiVisited] = useState(false),
      [saved, setSaved] = useState(null), [draft, setDraft] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [external, setExternal] = useState(false), [unverified, setUnverified] = useState(false), [collapsed, setCollapsed] = useState({});
    const controller = useRef(null), mounted = useRef(false), visible = useRef(active), epoch = useRef(0), operation = useRef(null), savedRef = useRef(null), draftRef = useRef(null), invalidate = useRef(null), tabs = useRef(new Map()), nextDeviceId = useRef(1), externalRef = useRef(false), unverifiedRef = useRef(false), rememberedAddresses = useRef(null), literalHosts = useRef({ ipv4: null, ipv6: null });
    // ADR-107: fields left at least once (address check), levels the profile panel reports as changed, palette and keyboard hooks.
    const [touched, setTouched] = useState(NO_FIELDS), [panelPending, setPanelPending] = useState(NO_LEVELS);
    const mainRoot = useRef(null), announcedProblems = useRef(null), handledRequest = useRef(null), saveRef = useRef(null), dirtyRef = useRef(false), canSaveRef = useRef(false);
    visible.current = active; savedRef.current = saved; draftRef.current = draft; externalRef.current = external; unverifiedRef.current = unverified;
    const dirty = saved !== null && draft !== null && !same(saved.draft, draft);
    const uncertain = external || unverified;
    const own = antidetectEditorLabels(locale), pending = antidetectPendingLevels(saved?.draft, draft);
    for (const level of panelPending) pending.add(level);
    dirtyRef.current = dirty; canSaveRef.current = dirty && !busy && !uncertain; saveRef.current = save;
    const failureKey = failure => ERROR_KEYS[failure?.code] ?? 'failed';
    invalidate.current = event => {
      if (!mounted.current || event?.reason === 'visibility' || event?.reason === 'disposed') return;
      // Nothing of ours is pending, so a newer revision (the profile editor, another window, the popup) is adopted silently;
      // only a pending draft needs the explicit refresh, so the page never locks itself on its own neighbours' saves.
      if (event?.reason === 'configuration' && !operation.current && savedRef.current && draftRef.current && same(savedRef.current.draft, draftRef.current)) { void refresh(); return; }
      ++epoch.current; operation.current = null; externalRef.current = true; setBusy(false); setExternal(true); setNotice('');
    };
    if (!controller.current) controller.current = createAntidetectController(browserApi, { tabId, onChange: event => invalidate.current?.(event), onInvalidate: event => invalidate.current?.(event) });

    useEffect(() => {
      mounted.current = true;
      return () => { mounted.current = false; ++epoch.current; operation.current = null; controller.current.dispose(); };
    }, []);
    useEffect(() => {
      controller.current.setVisible(active);
      if (!active) { ++epoch.current; operation.current = null; setBusy(false); unverifiedRef.current = true; setUnverified(true); }
      else if (!savedRef.current) void refresh();
      else void revalidate();
    }, [active]);
    useEffect(() => {
      if (!active || !saved || saved.earlyAccess === 'ready' || saved.earlyAccess === 'unsupported') return undefined;
      const recheck = () => { if (globalThis.document?.visibilityState === 'visible') void refresh(true); };
      globalThis.addEventListener?.('focus', recheck); globalThis.document?.addEventListener?.('visibilitychange', recheck);
      return () => { globalThis.removeEventListener?.('focus', recheck); globalThis.document?.removeEventListener?.('visibilitychange', recheck); };
    }, [active, saved?.earlyAccess]);
    // ADR-107: leaving the page with an unsaved network draft asks first; the palette can save it; Ctrl/Cmd+S saves it from the Network level.
    useEffect(() => registerDirtyGuard(() => dirtyRef.current), []);
    useEffect(() => registerPaletteCommands('antidetect-network', () => canSaveRef.current ? [{ kind: 'apply-network', run: () => { void saveRef.current?.(); } }] : []), []);
    // Only this page's own draft (Network level, Math panel, save bar): the profile panel and the embedded API editor keep their own keys.
    useEffect(() => registerSaveShortcut(mainRoot.current, event => {
      let inside = false;
      try { inside = Boolean(event.target?.closest?.('[data-antidetect-network], [data-antidetect-math-usage], [data-antidetect-savebar]')); } catch { inside = false; }
      if (!inside || !canSaveRef.current) return false;
      void saveRef.current?.(); return true;
    }), []);
    // A palette request selects its level once the section is visible, then moves focus to that tab.
    useEffect(() => {
      if (!active || !request || handledRequest.current === request || !ANTIDETECT_CATEGORIES.includes(request.level)) return;
      handledRequest.current = request; choose(request.level);
      if (request.focus === false) return;
      try { tabs.current.get(request.level)?.focus(); } catch { /* The tab is not mounted in a static preview. */ }
    }, [request, active]);

    function begin() {
      if (!visible.current || operation.current) return null;
      const token = { epoch: epoch.current }; operation.current = token; setBusy(true); setError(''); setNotice(''); return token;
    }
    function fresh(token) { return mounted.current && visible.current && epoch.current === token.epoch && operation.current === token; }
    function end(token) { if (operation.current === token) { operation.current = null; if (mounted.current) setBusy(false); } }
    function accept(state, keepDraft = false) {
      if (!state?.draft) throw Error('Invalid state');
      setSaved(state); savedRef.current = state;
      if (!keepDraft || !draftRef.current) { const value = clone(state.draft); setDraft(value); draftRef.current = value; rememberedAddresses.current = value.profile.addresses === null ? null : clone(value.profile.addresses); literalHosts.current = { ipv4: null, ipv6: null }; setTouched(NO_FIELDS); }
      externalRef.current = false; setExternal(false); unverifiedRef.current = false; setUnverified(false);
    }
    // ADR-083 / FP-07: retained panels verify the current revision without replaying a write.
    async function revalidate() {
      const token = begin(); if (!token) return;
      const baseline = savedRef.current;
      unverifiedRef.current = true; setUnverified(true);
      try {
        const state = await controller.current.load();
        if (!fresh(token)) return;
        const retainDraft = baseline && draftRef.current && !same(baseline.draft, draftRef.current);
        if (retainDraft && state.revision !== baseline.revision) {
          externalRef.current = true; setExternal(true); unverifiedRef.current = false; setUnverified(false);
        } else accept(state, retainDraft);
      } catch (failure) { if (fresh(token)) setError(failureKey(failure)); }
      finally { end(token); }
    }
    async function refresh(keepDraft = false) {
      if (!keepDraft && savedRef.current && draftRef.current && !same(savedRef.current.draft, draftRef.current)) { setError('refresh_dirty'); return; }
      const token = begin(); if (!token) return;
      try { const state = await controller.current.load(); if (fresh(token)) accept(state, keepDraft); }
      catch (failure) { if (fresh(token)) setError(failureKey(failure)); }
      finally { end(token); }
    }
    async function save(event) {
      event?.preventDefault();
      if (!draftRef.current || !savedRef.current || same(savedRef.current.draft, draftRef.current) || externalRef.current || unverifiedRef.current) return;
      // ADR-107: the same address check as the fields; every wrong field is marked and the first one takes focus, nothing is sent.
      const problems = antidetectAddressProblems(draftRef.current.profile.addresses);
      if (problems.length) {
        setTouched(current => new Set([...current, ...problems])); setError('invalid'); setNotice('');
        const [family, role] = problems[0].split(':');
        try { globalThis.document?.getElementById?.('antidetect-address-' + family + '-' + role)?.focus(); } catch { /* Static preview. */ }
        return;
      }
      const token = begin(); if (!token) return;
      try {
        const state = await controller.current.save(clone(draftRef.current));
        if (fresh(token)) { accept(state); setNotice(state.registration === 'error' ? 'status_error' : 'saved'); if (state.reloadRequired) announce(t('reload_required')); }
      } catch (failure) { if (fresh(token)) { setError(failureKey(failure)); if (ERROR_KEYS[failure?.code] === 'stale') { externalRef.current = true; setExternal(true); } } }
      finally { end(token); }
    }
    async function toggleMaster() {
      if (!draftRef.current || !savedRef.current || externalRef.current || unverifiedRef.current) return;
      const token = begin(); if (!token) return;
      const retained = clone(draftRef.current);
      try {
        const state = await controller.current.setEnabled(!savedRef.current.draft.enabled);
        if (!fresh(token)) return;
        accept(state, true);
        if (state.reloadRequired) announce(t('reload_required'));
        const next = { ...retained, enabled: state.draft.enabled };
        draftRef.current = next; setDraft(next);
      } catch (failure) {
        if (fresh(token)) {
          setError(failureKey(failure));
          if (ERROR_KEYS[failure?.code] === 'stale') { externalRef.current = true; setExternal(true); }
        }
      } finally { end(token); }
    }
    function discard() {
      if (busy || !savedRef.current) return;
      const value = clone(savedRef.current.draft); draftRef.current = value; rememberedAddresses.current = value.profile.addresses === null ? null : clone(value.profile.addresses); literalHosts.current = { ipv4: null, ipv6: null }; setDraft(value); setError(''); setNotice(''); setTouched(NO_FIELDS);
    }
    async function grant(kind) {
      if (externalRef.current) return;
      const token = begin(); if (!token) return;
      try {
        // Permission requests run in the originating trusted click before the first await.
        const pending = kind === 'privacy' ? controller.current.grantPrivacy() : kind === 'settings' ? controller.current.openEarlySettings() : controller.current.grantEarlyAccess();
        const accepted = await pending;
        if (!fresh(token)) return;
        if (accepted === false) { setError('denied'); return; }
        const state = accepted?.draft ? accepted : await controller.current.load(); if (fresh(token)) accept(state, true);
      } catch (failure) { if (fresh(token)) setError(failureKey(failure)); }
      finally { end(token); }
    }
    function change(patch) {
      if (busy || !draftRef.current) return;
      const next = { ...draftRef.current, ...patch }; draftRef.current = next; setDraft(next); setError(''); setNotice('');
    }
    function changeProfile(patch) {
      if (busy || !draftRef.current) return;
      if (patch.addresses) rememberedAddresses.current = clone(patch.addresses);
      change({ profile: { ...draftRef.current.profile, ...patch } });
    }
    function changeAddresses(addresses) {
      if (busy || !draftRef.current) return;
      if (addresses) rememberedAddresses.current = clone(addresses);
      else if (draftRef.current.profile.addresses) rememberedAddresses.current = clone(draftRef.current.profile.addresses);
      change({ ...(addresses ? { mode: 'spoof' } : {}), profile: { ...draftRef.current.profile, addresses } });
    }
    function choose(next) { if (!ANTIDETECT_CATEGORIES.includes(next)) return; if (['device', 'os', 'browser'].includes(next)) setApiVisited(true); setCategory(next); }
    const levelLabel = value => ({ quick: dwords.quick_title, device: dwords.level_device_title, os: dwords.level_os_title, browser: dwords.level_browser_title, network: dwords.level_network_title })[value] ?? t('category_' + value);
    const navIcon = value => ({ quick: 'randomize', device: 'device', os: 'os', browser: 'browser', network: 'network' })[value] ?? value;
    function navigation(event, index) {
      const rtl = /^(ar|ur)(?:[-_]|$)/i.test(locale); let next;
      if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = ANTIDETECT_CATEGORIES.length - 1;
      else if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(event.key)) next = (index + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : (event.key === 'ArrowRight' ? 1 : -1) * (rtl ? -1 : 1)) + ANTIDETECT_CATEGORIES.length) % ANTIDETECT_CATEGORIES.length;
      else return;
      event.preventDefault(); choose(ANTIDETECT_CATEGORIES[next]); tabs.current.get(ANTIDETECT_CATEGORIES[next])?.focus();
    }
    const statusKey = status => ({ block: 'block_active', spoof: 'spoof_active', allow: 'allow_active', inactive: 'inactive', inherited: 'inherited', 'scope-inactive': 'scope_inactive', unsupported: 'unavailable', error: 'status_error', 'reload-required': 'status_reload' })[status] ?? 'unavailable';
    const stateBadge = (name, status) => h('span', { class: 'antidetect-state antidetect-state--' + (!uncertain && ['allow', 'block', 'spoof'].includes(status) ? status : 'neutral'), 'data-antidetect-effective': name, 'data-antidetect-effective-state': uncertain ? 'unknown' : status ?? 'unsupported', children: [h('span', { class: 'antidetect-state__dot', 'aria-hidden': true }), uncertain ? t('effective') + ': —' : t(status === 'inactive' && (name !== 'webrtc' || saved?.draft.mode !== 'spoof') ? 'api_inactive' : name !== 'webrtc' && ['allow', 'block'].includes(status) ? status : statusKey(status))] });
    const modeOptions = (key, value, options, onChange, disabled = false) => h('div', { class: 'antidetect-segmented', role: 'radiogroup', 'aria-label': key === 'webrtc' ? t('mode') : key, 'data-antidetect-mode-control': key, children: options.map(mode => h('button', { type: 'button', role: 'radio', 'aria-checked': value === mode, tabIndex: value === mode || value === 'inherit' && mode === options[0] ? 0 : -1, class: 'antidetect-mode antidetect-mode--' + mode + (value === mode ? ' is-selected' : ''), disabled: busy || disabled, 'data-antidetect-mode': key + ':' + mode, onClick: () => onChange(mode), onKeyDown: event => {
      const index = options.indexOf(mode), rtl = /^(ar|ur)(?:[-_]|$)/i.test(locale); let next;
      if (event.key === 'Home') next = 0; else if (event.key === 'End') next = options.length - 1;
      else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft' || event.key === 'ArrowDown' || event.key === 'ArrowUp') next = (index + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : (event.key === 'ArrowRight' ? 1 : -1) * (rtl ? -1 : 1)) + options.length) % options.length;
      else return;
      event.preventDefault(); if (busy || disabled) return; onChange(options[next]); event.currentTarget.parentElement?.querySelector('[data-antidetect-mode="' + key + ':' + options[next] + '"]')?.focus();
    }, children: key === 'webrtc' && mode === 'spoof' ? redesignLabels(locale).modeCustom : t(mode) })) });
    // The Host slot of a family is either a literal address or the word «mdns» (checkbox below it); then the literal field is empty and off.
    const mdnsText = key => webRtcText(translate, key);
    const hostIsMdns = family => (draft.profile.addresses ?? rememberedAddresses.current)?.[family]?.host === WEBRTC_HOST_MDNS;
    // ADR-107: a field is checked when it is left (and on Save); afterwards its mark follows every edit, so a fix clears it at once.
    // The reason is also spoken once per wrong value, because the mark appears after focus has already moved on.
    // A press on another control blurs the field before that control's click: the visible mark waits for the release.
    function leaveAddress(name, target) {
      afterPointerRelease(target, () => setTouched(current => current.has(name) ? current : new Set([...current, name])));
      const [family, role] = name.split(':'), value = (draftRef.current?.profile.addresses ?? rememberedAddresses.current)?.[family]?.[role] ?? null;
      const problem = webRtcAddressProblem(family, role, value), seen = announcedProblems.current ??= new Map();
      if (!problem) { seen.delete(name); return; }
      if (seen.get(name) === value) return;
      seen.set(name, value); announce(webRtcAddressMessage(problem, locale));
    }
    function addressInput(family, role) {
      const value = (draft.profile.addresses ?? rememberedAddresses.current)?.[family]?.[role] ?? '', hidden = role === 'host' && value === WEBRTC_HOST_MDNS;
      const name = family + ':' + role, id = 'antidetect-address-' + family + '-' + role, errorId = id + '-error';
      const problem = !hidden && touched.has(name) ? webRtcAddressProblem(family, role, value === '' ? null : value) : null;
      return h('div', { class: 'antidetect-field antidetect-address', key: role, children: [
        h('label', { for: id, children: rtc(role) }),
        h('input', { id, type: 'text', value: hidden ? '' : value, dir: 'ltr', disabled: busy || hidden, maxLength: family === 'ipv4' ? 15 : 45, spellcheck: false, autoComplete: 'off', autoCapitalize: 'off', placeholder: hidden ? mdnsText('host_mdns') : family === 'ipv4' ? '198.51.100.10' : '2001:db8::10',
          'aria-invalid': problem ? 'true' : undefined, 'aria-describedby': problem ? errorId : undefined, 'data-antidetect-address': name, onFocus: event => watchPointer(event?.currentTarget), onBlur: event => leaveAddress(name, event?.currentTarget), onInput: event => {
            if (busy || !draftRef.current) return;
            const addresses = draftRef.current.profile.addresses ?? rememberedAddresses.current ?? emptyAddresses();
            if (role === 'host' && addresses[family]?.host === WEBRTC_HOST_MDNS) return;
            const text = event.currentTarget.value;
            // Typing the word «mdns» must not silently switch the mode (it has its own checkbox): the draft keeps an invalid literal that Save rejects.
            changeAddresses({ ...addresses, [family]: { ...addresses[family], [role]: role === 'host' && text === WEBRTC_HOST_MDNS ? text + ' ' : text || null } });
          } }),
        problem ? h('span', { id: errorId, class: 'antidetect-field__error', 'data-antidetect-address-error': name, children: webRtcAddressMessage(problem, locale) }) : null,
      ] });
    }
    // Checking replaces only the Host slot of its family and remembers the literal typed before; unchecking restores it.
    function toggleMdns(family, checked) {
      if (busy || !draftRef.current) return;
      const addresses = draftRef.current.profile.addresses ?? rememberedAddresses.current ?? emptyAddresses(), current = addresses[family]?.host ?? null;
      if (checked && current !== WEBRTC_HOST_MDNS) literalHosts.current[family] = current;
      changeAddresses({ ...addresses, [family]: { ...addresses[family], host: checked ? WEBRTC_HOST_MDNS : literalHosts.current[family] } });
    }
    // ADR-107: one note under both families explains the choice; each checkbox points at it instead of repeating it.
    function mdnsChoice(family) {
      return h('label', { class: 'antidetect-check antidetect-mdns', key: 'mdns', children: [h('input', { type: 'checkbox', checked: hostIsMdns(family), disabled: busy, 'aria-describedby': 'antidetect-mdns-note', 'data-antidetect-mdns': family, onChange: event => toggleMdns(family, event.currentTarget.checked) }), h('span', { children: mdnsText('host_mdns') })] });
    }
    function mapped() {
      const addresses = draftRef.current.profile.addresses; if (!addresses) return;
      try {
        // An mDNS host has no address to map, and an mDNS host on the IPv6 side is an explicit choice that mapping must not overwrite.
        const keep = role => role !== 'host' || addresses.ipv4.host !== WEBRTC_HOST_MDNS && addresses.ipv6.host !== WEBRTC_HOST_MDNS;
        const values = Object.fromEntries(ROLES.filter(role => addresses.ipv4[role] !== null && keep(role)).map(role => [role, ipv4MappedIpv6(addresses.ipv4[role])]));
        if (!Object.keys(values).length) { setError('invalid'); return; }
        changeProfile({ addresses: { ...addresses, ipv6: { ...addresses.ipv6, ...values } } });
      } catch { setError('invalid'); }
    }
    function addDevice() {
      const current = draftRef.current.devices; if (current.values.length >= 128) return;
      let id; do { id = 'test-device-' + nextDeviceId.current++; } while (current.values.some(value => value.deviceId === id));
      change({ devices: { ...current, values: [...current.values, { deviceId: id, groupId: '', kind: 'audioinput', label: '' }] } });
    }
    function editDevice(index, patch) { const current = draftRef.current.devices; change({ devices: { ...current, values: current.values.map((device, at) => at === index ? { ...device, ...patch } : device) } }); }
    function sectionHeading(id, icon, title, extra = null) {
      const open = !collapsed[id];
      return h('div', { class: 'antidetect-card-heading antidetect-section__heading', children: [
        h('h3', { class: 'antidetect-section__title', children: h('button', { type: 'button', class: 'antidetect-section__toggle', 'aria-expanded': open, 'aria-controls': 'antidetect-section-' + id, 'data-antidetect-section-toggle': id, onClick: () => setCollapsed(current => ({ ...current, [id]: !current[id] })), children: [
          h('span', { class: 'antidetect-icon antidetect-icon--' + icon, children: h(Icon, { name: icon, size: 19 }) }),
          h('span', { class: 'antidetect-section__label', dir: id === 'webrtc' ? 'ltr' : undefined, children: title }),
          h('span', { class: 'antidetect-section__chevron', 'aria-hidden': true })] }) }),
        extra] });
    }
    const sectionBody = (id, children) => h('div', { id: 'antidetect-section-' + id, class: 'antidetect-section__body', hidden: collapsed[id] === true, 'data-antidetect-section': id, children });
    function deviceEditor() {
      const devices = draft.devices, devicesDisabled = busy || draft.mode !== 'spoof';
      return h('fieldset', { class: 'antidetect-subsection', disabled: devicesDisabled, 'data-antidetect-devices': true, children: [
        h('label', { class: 'antidetect-row antidetect-field', children: [h('span', { class: 'antidetect-row__label antidetect-subheading', children: [h('span', { class: 'antidetect-icon antidetect-icon--devices', children: h(Icon, { name: 'devices' }) }), h('span', { class: 'antidetect-row__title', children: t('media_mode') })] }), h('span', { class: 'antidetect-row__control', children: h('select', { value: devices.mode, disabled: busy, 'data-antidetect-device-mode': true, onChange: event => change({ devices: { ...draftRef.current.devices, mode: event.currentTarget.value } }), children: [devices.mode === 'inherit' ? h('option', { value: 'inherit', disabled: true, children: t('inherited') }) : devices.mode === 'blocked' ? h('option', { value: 'blocked', disabled: true, children: t('block') }) : null, ...['original', 'random', 'custom'].map(mode => h('option', { value: mode, children: t(mode), key: mode }))] }) })] }),
        devices.mode === 'random' ? h('label', { class: 'antidetect-row antidetect-field', children: [h('span', { class: 'antidetect-row__label', children: rtc('lifetime') }), h('span', { class: 'antidetect-row__control', children: h('select', { value: devices.lifetime, disabled: busy, 'data-antidetect-device-lifetime': true, onChange: event => change({ devices: { ...draftRef.current.devices, lifetime: event.currentTarget.value } }), children: ['session', 'site'].map(value => h('option', { value, key: value, children: rtc(value) })) }) })] }) : null,
        devices.mode === 'custom' ? h('div', { class: 'antidetect-device-list', children: [devices.values.length ? devices.values.map((device, index) => h('div', { class: 'antidetect-device', key: index, 'data-antidetect-device': index, children: [
          h('label', { class: 'antidetect-field', children: [h('span', { children: t('device_kind') }), h('select', { value: device.kind, disabled: busy, 'data-antidetect-device-field': index + ':kind', onChange: event => editDevice(index, { kind: event.currentTarget.value }), children: DEVICE_KINDS.map(kind => h('option', { key: kind, value: kind, children: t({ audioinput: 'microphone', videoinput: 'camera', audiooutput: 'speaker' }[kind]) })) })] }),
          ...[['label', 'device_label'], ['deviceId', 'device_id'], ['groupId', 'group_id']].map(([key, label]) => h('label', { class: 'antidetect-field', key, children: [h('span', { children: t(label) }), h('input', { type: 'text', value: device[key], disabled: busy, maxLength: 512, dir: key === 'label' ? undefined : 'ltr', autoComplete: 'off', spellcheck: false, 'data-antidetect-device-field': index + ':' + key, onInput: event => editDevice(index, { [key]: event.currentTarget.value }) })] })),
          h('button', { type: 'button', class: 'button button--text antidetect-device-remove', disabled: busy, 'data-antidetect-device-remove': index, onClick: () => change({ devices: { ...draftRef.current.devices, values: draftRef.current.devices.values.filter((_, at) => at !== index) } }), children: t('remove_device') })
        ] })) : h('p', { class: 'antidetect-note', children: t('no_devices') }), h('button', { type: 'button', class: 'button', disabled: busy || devices.values.length >= 128, onClick: addDevice, 'data-antidetect-device-add': true, children: t('add_device') })] }) : null,
      ] });
    }
    // One informational row, no controls. A stale or failed read never claims the headers follow the profile.
    function headersRow() {
      const chrome = (() => { try { return String(browserApi.runtime.getURL('')).startsWith('chrome-extension://'); } catch { return false; } })();
      const line = headerLineFor(saved, chrome, describeHeaders);
      const failed = line.state === 'applied' && saved.registration === 'error';
      const state = uncertain ? 'unknown' : failed ? 'error' : line.state;
      const text = uncertain || line.textKey === null ? t('effective') + ': —' : failed ? t('status_error') : dwords[line.textKey];
      const names = (key, list, more) => list.length ? h('div', { key, children: [h('dt', { children: dwords[key] }), h('dd', { children: [...list.map(name => h('code', { key: name, dir: 'ltr', children: name })), more ? h('code', { key: '+', dir: 'ltr', 'data-antidetect-headers-more': more, children: '+' + more }) : null] })] }) : null;
      return h('div', { class: 'antidetect-protocol antidetect-row antidetect-headers', key: 'headers', 'data-antidetect-headers': state, 'data-antidetect-headers-reason': uncertain ? undefined : line.reason ?? undefined, children: [
        h('div', { class: 'antidetect-protocol__copy antidetect-row__label', children: h('div', { class: 'antidetect-title-with-icon', children: [h('span', { class: 'antidetect-icon antidetect-icon--headers', children: h(Icon, { name: 'headers' }) }), h('strong', { children: dwords.headers_label })] }) }),
        h('div', { class: 'antidetect-protocol__control antidetect-row__control', children: [
          h('p', { class: 'antidetect-note', role: 'status', 'data-antidetect-headers-text': true, children: text }),
          state === 'applied' && (line.set.length || line.removed.length) ? h('dl', { class: 'antidetect-headers__list', 'data-antidetect-headers-list': true, children: [names('headers_set', line.set, line.setMore), names('headers_removed', line.removed, line.removedMore)] }) : null] })
      ] });
    }
    const policyStatus = policy => uncertain ? t('effective') + ': —' : rtc(({ 'permission-required': 'permission_required', 'not-controllable': 'not_controllable' })[policy?.status] ?? (['inactive', 'unsupported', 'error', 'applied'].includes(policy?.status) ? policy.status : 'unsupported'));
    function network() {
      const spoof = draft.mode === 'spoof', policy = saved.webrtcNetwork, disabled = busy || !spoof;
      return h('div', { class: 'antidetect-network', 'data-antidetect-network': true, children: [
        h('ul', { class: 'fp-device-card__disclosures', 'data-antidetect-disclosures': true, children: [dwords.disclose_ip, dwords.disclose_tls, dwords.disclose_engine].map((text, index) => h('li', { key: index, children: h('span', { children: text }) })) }),
        h('form', { onSubmit: save, class: 'antidetect-form', children: [
          h('section', { class: 'antidetect-card antidetect-section', 'data-antidetect-webrtc': true, children: [
            sectionHeading('webrtc', 'webrtc', 'WebRTC', stateBadge('webrtc', saved.effective?.webrtc)),
            sectionBody('webrtc', [
              h('div', { class: 'antidetect-webrtc-mode antidetect-row', children: [
                h('div', { class: 'antidetect-mode-label antidetect-row__label', children: [h('span', { class: 'antidetect-label', children: t('mode') }), h('span', { class: 'antidetect-scope', 'data-antidetect-network-scope': true, children: translate('antidetect_editor_global') })] }),
                h('div', { class: 'antidetect-row__control', children: [modeOptions('webrtc', draft.mode, ['allow', 'block', 'spoof'], mode => change({ mode })),
                  h('p', { class: 'antidetect-note', 'data-antidetect-block-owner': 'webrtc', children: t('block_owner') }),
                  draft.mode === 'inherit' ? h('p', { class: 'antidetect-note', 'data-antidetect-inherited': 'webrtc', children: t('inherited') }) : null] })] }),
              h('fieldset', { class: 'antidetect-address-editor antidetect-row', disabled: busy, 'aria-labelledby': 'antidetect-addresses-label', 'data-antidetect-address-fields': true, children: [
                h('div', { class: 'antidetect-row__label', children: h('span', { id: 'antidetect-addresses-label', class: 'antidetect-label', children: rtc('addresses') }) }),
                h('div', { class: 'antidetect-row__control', children: [
                  // ADR-107: the checkbox says what it does; the row heading already names the group.
                  h('label', { class: 'antidetect-check', children: [h('input', { type: 'checkbox', checked: draft.profile.addresses !== null, disabled: busy, 'data-antidetect-addresses-enabled': true, onChange: event => changeAddresses(event.currentTarget.checked ? clone(rememberedAddresses.current ?? emptyAddresses()) : null) }), h('span', { children: own.addressesUse })] }),
                  h('div', { class: 'antidetect-address-families', children: ['ipv4', 'ipv6'].map(family => h('fieldset', { class: 'antidetect-family antidetect-family--' + family, key: family, 'data-antidetect-family': family, children: [h('legend', { dir: 'ltr', children: family === 'ipv4' ? 'IPv4' : 'IPv6' }), ...ROLES.flatMap(role => role === 'host' ? [addressInput(family, role), mdnsChoice(family)] : [addressInput(family, role)])] })) }),
                  h('p', { class: 'antidetect-note antidetect-mdns-note', id: 'antidetect-mdns-note', 'data-antidetect-mdns-note': true, children: mdnsText('host_mdns_note') }),
                  draft.profile.addresses !== null ? h('div', { class: 'antidetect-mapped', children: h('button', { type: 'button', class: 'button button--text', onClick: mapped, disabled, 'data-antidetect-mapped-ipv6': true, children: t('mapped') }) }) : null] })
              ] }),
              h('fieldset', { class: 'antidetect-spoof', disabled, 'data-antidetect-spoof-fields': true, children: [
                h('label', { class: 'antidetect-row antidetect-field', children: [h('span', { class: 'antidetect-row__label', children: rtc('transport') }), h('span', { class: 'antidetect-row__control', children: [h('select', { value: draft.profile.iceTransportPolicy, 'data-antidetect-transport': true, onChange: event => changeProfile({ iceTransportPolicy: event.currentTarget.value }), children: ['preserve', 'relay'].map(value => h('option', { value, key: value, children: rtc(value) })) }),
                  draft.profile.iceTransportPolicy === 'relay' ? h('span', { class: 'antidetect-note', children: rtc('relay_note') }) : null] })] }),
                h('div', { class: 'antidetect-row', children: [
                  h('div', { class: 'antidetect-row__label antidetect-subheading', children: [h('span', { class: 'antidetect-icon antidetect-icon--certificates', children: h(Icon, { name: 'certificates' }) }), h('h4', { children: rtc('profile_certificates') })] }),
                  h('div', { class: 'antidetect-row__control', children: [h('label', { class: 'antidetect-check', children: [h('input', { type: 'checkbox', checked: draft.profile.freshCertificates, 'data-antidetect-dtls': true, onChange: event => changeProfile({ freshCertificates: event.currentTarget.checked }) }), h('span', { children: rtc('certificates') })] }),
                    !draft.profile.freshCertificates ? h('p', { class: 'antidetect-note', children: t('native_certificates') }) : null] })] })
              ] }),
              h('div', { class: 'antidetect-device-usage', children: [deviceEditor()] }),
              h('section', { class: 'antidetect-subsection', 'data-antidetect-native-policy': true, children: [
                h('div', { class: 'antidetect-row', children: [h('div', { class: 'antidetect-row__label', children: h('h4', { id: 'antidetect-policy-label', children: rtc('network_title') }) }), h('div', { class: 'antidetect-row__control', children: [
                  h('select', { value: draft.networkPolicy, 'aria-labelledby': 'antidetect-policy-label', disabled: busy || policy?.status === 'unsupported', 'data-antidetect-network-policy': true, onChange: event => change({ networkPolicy: event.currentTarget.value }), children: webRtcPolicyChoices({ firefox: webRtcFirefoxBuild(browserApi), current: draft.networkPolicy }).map(value => h('option', { value, key: value, children: rtc(webRtcPolicyLabelKey(value)) })) }),
                  draft.networkPolicy === 'proxy_only' ? h('p', { class: 'antidetect-note', 'data-antidetect-policy-note': true, children: rtc('proxy_only_note') }) : null,
                  h('p', { class: 'antidetect-note', role: !uncertain && (policy?.status === 'error' || policy?.status === 'not-controllable') ? 'alert' : 'status', 'data-antidetect-policy-status': uncertain ? 'unknown' : policy?.status ?? 'unsupported', children: policyStatus(policy) }),
                  !uncertain && policy?.value !== null && policy?.value !== undefined ? h('p', { class: 'antidetect-note', 'data-antidetect-policy-effective': true, children: [rtc('effective') + ': ', h('span', { dir: 'ltr', children: policyLabel(policy.value) })] }) : null,
                  policy?.status === 'permission-required' || draft.networkPolicy !== 'system' && policy?.status === 'inactive' && policy.levelOfControl === null ? h('button', { type: 'button', class: 'button', disabled: busy || uncertain, onClick: () => grant('privacy'), 'data-antidetect-grant-privacy': true, children: rtc('grant') }) : null] })] })
              ] })
            ])
          ] }),
          h('section', { class: 'antidetect-card antidetect-section', 'data-antidetect-leak-prevention': true, children: [sectionHeading('channels', 'leak', t('leak_title')),
            sectionBody('channels', [h('p', { class: 'antidetect-note', 'data-antidetect-block-owner': 'network', children: t('block_owner') }),
              h('div', { class: 'antidetect-protocols', children: [...['webtransport', 'websocket'] /* owner: rows the extension cannot control (UDP, QUIC, IPv6) are not shown */.map(protocol => {
                const supported = protocol === 'websocket' || protocol === 'webtransport', value = supported ? draft[protocol] : 'allow', label = { udp: 'UDP', quic: 'QUIC', webtransport: 'WebTransport', websocket: 'WebSocket', ipv6: 'IPv6' }[protocol], effective = saved.effective?.[protocol];
                return h('div', { class: 'antidetect-protocol antidetect-row' + (supported ? '' : ' is-unavailable'), key: protocol, 'data-antidetect-protocol': protocol, children: [
                  h('div', { class: 'antidetect-protocol__copy antidetect-row__label', children: [h('div', { class: 'antidetect-title-with-icon', children: [h('span', { class: 'antidetect-icon antidetect-icon--' + protocol, children: h(Icon, { name: protocol }) }), h('strong', { dir: 'ltr', children: label })] })] }),
                  h('div', { class: 'antidetect-protocol__control antidetect-row__control', children: [h('div', { class: 'antidetect-row__line', children: [modeOptions(protocol, supported ? value : 'inherit', ['allow', 'block'], mode => change({ [protocol]: mode }), !supported), supported ? stateBadge(protocol, effective) : h('span', { class: 'antidetect-unavailable', 'data-antidetect-unavailable': protocol, children: t('unavailable') })] }),
                    h('p', { class: 'antidetect-note', children: t(protocol + '_note') }), supported ? h('p', { class: 'antidetect-protocol__scope', 'data-antidetect-protocol-scope': protocol, children: t(saved.networkEnforcement?.[protocol] === 'browser' ? 'scope_browser' : 'scope_page') }) : null, supported && value === 'inherit' ? h('p', { class: 'antidetect-note', 'data-antidetect-inherited': protocol, children: t('inherited') }) : null] })] });
              }), headersRow()] })])
          ] })
        ] }),
        // ADR-113: outside the form on purpose: the setting is applied at once by the service worker and is not part of the Save draft.
        h(QuietSensorsCard, { active })
      ] });
    }
    // ADR-103 overview: draft values the page edits, saved masters and saved API modes; nothing new is read or written.
    // ADR-107: a row whose draft differs from the saved value says «Изменено» in words (it was an unexplained dot for «differs from
    // the default»); the default comparison stays only as data-antidetect-overview-changed.
    function overview() {
      const labels = redesignLabels(locale), base = defaults(), policy = saved.webrtcNetwork, before = saved.draft;
      const unapplied = key => !uncertain && !same(before[key], draft[key]);
      const modeName = mode => ({ inherit: labels.modeInherit, allow: labels.modeAllow, block: labels.modeBlock, spoof: labels.modeCustom })[mode] ?? '—';
      const onOff = value => uncertain ? '—' : value ? own.on : own.off;
      const deviceName = mode => ({ inherit: labels.modeInherit, blocked: labels.modeBlock, original: t('original'), random: t('random'), custom: t('custom') })[mode] ?? '—';
      const functions = draft.math.profile.functions.length;
      // [key, label, value, differs from the default, hint, left-to-right label, unapplied draft change]
      const rows = [
        ['master', 'Antidetect', onOff(saved.draft.enabled), !uncertain && saved.draft.enabled !== base.enabled, null, true, false],
        ['api', translate('management_tab_api'), onOff(saved.apiEnabled), !uncertain && saved.apiEnabled !== false, null, true, false],
        ['webrtc', 'WebRTC', modeName(draft.mode), draft.mode !== base.mode, null, true, unapplied('mode') || !uncertain && !same({ ...before.profile, addresses: null }, { ...draft.profile, addresses: null })],
        ['addresses', rtc('addresses'), draft.profile.addresses !== null ? own.on : own.off, draft.profile.addresses !== null, null, false, !uncertain && !same(before.profile.addresses, draft.profile.addresses)],
        ['devices', t('media_mode'), deviceName(draft.devices.mode), draft.devices.mode !== base.devices.mode, null, false, unapplied('devices')],
        ['websocket', 'WebSocket', modeName(draft.websocket), draft.websocket !== base.websocket, null, true, unapplied('websocket')],
        ['webtransport', 'WebTransport', modeName(draft.webtransport), draft.webtransport !== base.webtransport, null, true, unapplied('webtransport')],
        ['policy', rtc('network_title'), policyLabel(draft.networkPolicy), draft.networkPolicy !== base.networkPolicy, policyStatus(policy), false, unapplied('networkPolicy')],
        ['math', 'Math', [modeName(draft.math.mode), ' · ', h('span', { dir: 'ltr', children: functions + '/' + API_MATH_FUNCTIONS.length })], draft.math.mode !== base.math.mode || !same(draft.math.profile, base.math.profile), null, true, unapplied('math')],
      ];
      const counts = antidetectApiCounts(saved.configuration), modeLabel = { custom: labels.modeCustom, on: labels.modeBlock, off: labels.modeAllow };
      return h('aside', { class: 'antidetect-overview', 'aria-labelledby': 'antidetect-overview-title', 'data-antidetect-overview': true, children: [
        h('h3', { id: 'antidetect-overview-title', class: 'antidetect-overview__title', children: labels.overview }),
        h('dl', { class: 'antidetect-overview__list', children: rows.map(([key, label, value, changed, hint, ltr, pendingRow]) => h('div', { class: 'antidetect-overview__row', key, 'data-antidetect-overview-row': key, 'data-antidetect-overview-changed': changed, 'data-antidetect-overview-pending': pendingRow, children: [
          h('dt', { children: ltr ? h('span', { dir: 'ltr', children: label }) : label }),
          h('dd', { children: [h('span', { class: 'antidetect-overview__value', children: value }), pendingRow ? h('span', { class: 'antidetect-pending', 'data-antidetect-pending': key, children: own.pending }) : null, hint ? h('span', { class: 'antidetect-overview__hint', children: hint }) : null] })
        ] })) }),
        h('section', { class: 'antidetect-overview__api', 'aria-labelledby': 'antidetect-overview-api', 'data-antidetect-overview-counts': true, children: [
          h('h4', { id: 'antidetect-overview-api', class: 'antidetect-overview__subtitle', children: own.apiRules }),
          h('p', { class: 'antidetect-overview__hint', children: own.savedState }),
          h('div', { class: 'antidetect-overview__scroll', children: h('table', { id: 'antidetect-overview-table', class: 'antidetect-overview__table', children: [
            h('thead', { children: h('tr', { children: [h('td', {}), ...ANTIDETECT_OVERVIEW_MODES.map(mode => h('th', { scope: 'col', key: mode, class: 'antidetect-overview__mode antidetect-overview__mode--' + mode, children: modeLabel[mode] }))] }) }),
            h('tbody', { children: [...ANTIDETECT_OVERVIEW_CATEGORIES, 'all'].map(category => h('tr', { key: category, 'data-antidetect-overview-category': category, children: [
              h('th', { scope: 'row', children: levelLabel(category) }),
              ...ANTIDETECT_OVERVIEW_MODES.map(mode => h('td', { key: mode, 'data-antidetect-overview-count': category + ':' + mode, children: uncertain ? '—' : String(counts[category][mode]) }))] })) })
          ] }) })
        ] })
      ] });
    }

    // ADR-107: the activation checklist replaces the separate early-access callout and reload note. Only the first open step's
    // button is primary; a finished step says so in words; the reload line is an instruction and is never ticked.
    function checklist() {
      const list = antidetectChecklist(saved); if (!list) return null;
      const access = saved.earlyAccess;
      const button = (step, props, text, secondary = false) => h('button', { type: 'button', class: !secondary && list.primary === step ? 'button button--primary' : 'button', ...props, children: text });
      const view = step => {
        if (step.id === 'scripts') {
          if (step.state === 'done') return { title: own.stepScripts };
          if (step.state === 'unavailable') return { title: own.stepScripts, text: own.stepScriptsUnsupported };
          if (access === 'browser-toggle-required') return { title: dwords.early_blocked_title, text: dwords.early_blocked_steps, actions: [
            button('scripts', { disabled: busy || uncertain, onClick: () => grant('settings'), 'data-antidetect-early-settings': true }, t('early_settings')),
            button('scripts', { disabled: busy, onClick: () => refresh(true), 'data-antidetect-early-recheck': true }, dwords.early_recheck, true)] };
          return { title: own.stepScripts, text: t('early_required'), actions: access === 'permission-required' ? [button('scripts', { disabled: busy || uncertain, onClick: () => grant('early'), 'data-antidetect-grant-early': true }, t('grant_early'))] : [] };
        }
        if (step.id === 'master') return step.state === 'done' ? { title: own.stepMaster } : { title: own.stepMaster, text: own.stepMasterHint,
          actions: [button('master', { disabled: busy || uncertain || !active, onClick: () => { if (savedRef.current?.draft.enabled === false) void toggleMaster(); }, 'data-antidetect-checklist-enable': true }, own.enable)] };
        if (step.id === 'device') {
          if (step.state === 'done') return { title: own.stepDevice };
          if (step.state === 'error') return { title: own.stepDevice };
          if (step.reason === 'scope') return { title: own.stepDevice, text: dwords.status_needs_scope };
          if (step.reason === 'scripts') return { title: own.stepDevice, text: dwords.status_needs_scripts };
          return { title: own.stepDevice, text: own.stepDeviceHint, actions: [button('device', { onClick: () => { choose('quick'); try { tabs.current.get('quick')?.focus(); } catch { /* Static preview. */ } }, 'data-antidetect-checklist-quick': true }, own.openQuick)] };
        }
        return { title: t('reload_required') };
      };
      const stateText = { done: own.stateDone, open: own.stateOpen, unavailable: t('unavailable'), error: t('status_error') };
      return h('section', { class: 'antidetect-checklist', 'aria-labelledby': 'antidetect-checklist-title', 'data-antidetect-checklist': list.primary ?? 'waiting', children: [
        h('h3', { id: 'antidetect-checklist-title', class: 'antidetect-checklist__title', children: own.checklistTitle }),
        h('ol', { class: 'antidetect-checklist__steps', children: list.steps.map(step => {
          const { title, text = null, actions = [] } = view(step);
          return h('li', { key: step.id, class: 'antidetect-checklist__step is-' + step.state, 'data-antidetect-checklist-step': step.id, 'data-antidetect-checklist-state': step.state,
            ...(step.id === 'scripts' && access !== 'ready' ? { 'data-antidetect-early-access': access } : {}), ...(step.id === 'reload' ? { 'data-antidetect-reload-required': true } : {}), children: [
              h('span', { class: 'antidetect-checklist__marker', 'aria-hidden': true }),
              h('div', { class: 'antidetect-checklist__text', children: [h('strong', { children: title }), text ? h('p', { class: 'antidetect-note', children: text }) : null] }),
              step.state === 'instruction' ? null : h('span', { class: 'antidetect-checklist__state', 'data-antidetect-checklist-chip': step.state, children: stateText[step.state] }),
              actions.length ? h('div', { class: 'antidetect-checklist__actions', children: actions }) : null,
            ] });
        }) }),
        // Round 5: the guided tour is offered here for as long as the checklist is shown; it changes no setting.
        h(TourStart, { variant: 'checklist' }),
      ] });
    }
    // The profile panel reports which of its levels hold unapplied changes; the list is checked and kept only when it changed.
    const reportPanelPending = useRef(null);
    reportPanelPending.current ??= levels => {
      const next = Array.isArray(levels) ? ANTIDETECT_PANEL_CATEGORIES.filter(level => levels.includes(level)) : [];
      setPanelPending(current => same(current, next) ? current : next.length ? Object.freeze(next) : NO_LEVELS);
    };
    // The panel's hint cards switch the level through the parent, which owns the tabs; the panel then focuses its own target field.
    const navigatePanel = useRef(null);
    navigatePanel.current ??= level => { if (ANTIDETECT_CATEGORIES.includes(level)) choose(level); };
    const saveBlock = !dirty ? null : busy ? 'busy' : external ? 'external' : unverified ? 'unverified' : null;
    const panelShown = ANTIDETECT_PANEL_CATEGORIES.includes(category);
    const problem = antidetectRegistrationProblem(saved);
    const masterStatus = uncertain ? t('effective') + ': —' : problem === 'error' ? t('status_error') : problem === 'scripts' ? dwords.status_needs_scripts : problem === 'scope' ? dwords.status_needs_scope : problem === 'idle' ? managementNavigationLabels(locale).inactive : '';
    return h('section', { class: 'antidetect', 'data-antidetect-app': true, 'aria-busy': busy, children: [
      WorkspaceMaster({ id: 'antidetect', className: 'antidetect-header', busy, reserve: true, tools: ToolButton({ icon: 'refresh', label: t('refresh'), onClick: () => unverifiedRef.current ? revalidate() : refresh(), disabled: busy || dirty && !unverified, 'data-antidetect-refresh': true }), label: h('h2', { dir: 'ltr', children: 'Antidetect' }), control: saved && draft ? h('div', { class: 'antidetect-master', children: h('button', { type: 'button', role: 'switch', 'aria-checked': saved.draft.enabled, 'aria-label': t('master'), disabled: busy || uncertain || !active, class: 'blocking-master ' + (saved.draft.enabled ? 'blocking-master--on' : 'blocking-master--off'), 'data-antidetect-master': true, 'data-tour': 'master', onClick: toggleMaster, children: [h('span', { class: 'blocking-master__dot', 'aria-hidden': true }), saved.draft.enabled ? own.on : own.off] }) }) : null, children: dirty || masterStatus ? h('span', { role: 'status', 'data-antidetect-master-status': uncertain ? 'unknown' : saved?.registration, children: [dirty ? t('unsaved') : null, dirty && masterStatus ? ' · ' : null, masterStatus] }) : null }),
      h('div', { class: 'antidetect-layout', 'data-antidetect-layout': true, children: [
      h('div', { class: 'antidetect-categories', role: 'tablist', 'aria-orientation': 'horizontal', 'aria-label': t('navigation'), 'data-antidetect-navigation': true, 'data-tour': 'levels', children: ANTIDETECT_CATEGORIES.map((value, index) => h('button', { type: 'button', class: 'antidetect-category antidetect-category--' + value + (category === value ? ' is-selected' : ''), role: 'tab', id: 'antidetect-category-' + value, 'aria-controls': 'antidetect-category-content', 'aria-selected': category === value, tabIndex: category === value ? 0 : -1, key: value, ref: element => { if (element) tabs.current.set(value, element); else tabs.current.delete(value); }, onClick: () => choose(value), onKeyDown: event => navigation(event, index), 'data-antidetect-category': value, children: [h('span', { class: 'antidetect-icon antidetect-icon--' + value, children: h(Icon, { name: navIcon(value), size: 19 }) }), h('span', { class: 'antidetect-category__label', children: levelLabel(value) }),
        // ADR-107: a level with unapplied changes says so in words (part of the tab name for screen readers).
        pending.has(value) && !uncertain ? h('span', { class: 'antidetect-pending', 'data-antidetect-category-pending': value, children: own.pending }) : null] })) }),
      h('div', { class: 'antidetect-main', ref: mainRoot, 'data-antidetect-main': true, children: [
      error ? h('p', { class: 'antidetect-error', role: 'alert', 'data-antidetect-error': true, children: error === 'privacy_required' ? dwords.privacy_required : t(error) }) : null,
      external ? h('div', { class: 'antidetect-warning', role: 'status', 'data-antidetect-external-change': true, children: t('changed_external') }) : null,
      saved ? checklist() : null,
      saved?.registration === 'error' ? h('p', { class: 'antidetect-error', role: 'alert', 'data-antidetect-registration-error': true, children: t('status_error') }) : null,
      h('div', { class: 'antidetect-workarea', 'data-antidetect-workarea': true, children: [
      h('div', { id: 'antidetect-category-content', role: 'tabpanel', 'aria-labelledby': 'antidetect-category-' + category, tabIndex: 0, class: 'antidetect-content', children: [
        // ADR-107: `disabledReason` ('network-dirty' | 'unverified' | 'busy' | null) lets the panel say why it is locked; `onPendingLevels`
        // receives the panel levels that hold unapplied changes, so their tabs can say «Изменено».
        h('div', { hidden: !panelShown, inert: !panelShown, children: h(FingerprintProfilePanel, { active: active && panelShown, view: panelShown ? category : 'quick', disabled: busy || dirty || uncertain, disabledReason: antidetectPanelReason({ busy, dirty, uncertain }), onPendingLevels: reportPanelPending.current, onNavigate: navigatePanel.current, tabId, onApplied: () => refresh(), antidetectOn: saved?.draft.enabled === true, onEnable: () => { if (savedRef.current?.draft.enabled === false) void toggleMaster(); } }) }),
        draft && saved ? h('div', { hidden: category !== 'network', inert: category !== 'network', children: network() }) : h('p', { class: 'antidetect-note', role: 'status', children: t('loading') }),
        draft?.math && saved ? h('div', { class: 'antidetect-math-usage', 'data-antidetect-math-usage': true, hidden: category !== 'device', inert: category !== 'device', children: h(MathTranscendentalsPanel, { value: draft.math, busy, disabled: !active, stale: uncertain, effective: saved.effective?.math, onChange: math => change({ math }) }) }) : null,
        apiVisited && ApiConfigurationEditor ? h('div', { class: 'antidetect-api', hidden: ['network', 'quick'].includes(category), inert: ['network', 'quick'].includes(category), children: h(ApiConfigurationEditor, { presentation: 'antidetect', fixedCategory: ['network', 'quick'].includes(category) ? 'all' : category === 'device' ? 'hardware' : category, categoryOverrides: ANTIDETECT_CATEGORY_OVERRIDES, hideWebRtc: true, active: active && !['network', 'quick'].includes(category), tabId, global: true, hideUsageContext: true }) }) : null
      ] }),
      draft && saved ? overview() : null
      ] }),
      // ADR-107: when changes exist but Save is blocked, the bar says why in words and the button points at that text.
      draft && saved && (category === 'network' || dirty) ? h('div', { class: 'antidetect-savebar', 'data-antidetect-savebar': true, children: [
        h('div', { class: 'antidetect-savebar__text', children: [h('span', { class: 'antidetect-note', role: 'status', 'data-antidetect-dirty': dirty, children: dirty ? t('unsaved') : notice ? t(notice) : '' }),
          saveBlock ? h('span', { id: 'antidetect-save-reason', class: 'antidetect-note antidetect-savebar__reason', 'data-antidetect-save-reason': saveBlock, children: own[SAVE_REASON_KEYS[saveBlock]] }) : null] }),
        h('div', { class: 'antidetect-actions', children: [h('button', { type: 'button', class: 'button', disabled: busy || !dirty, onClick: discard, 'data-antidetect-cancel': true, children: t('cancel') }),
          h('button', { type: 'button', class: 'button button--primary', onClick: save, disabled: busy || !dirty || uncertain, 'aria-disabled': busy || !dirty || uncertain ? 'true' : undefined, 'aria-describedby': saveBlock ? 'antidetect-save-reason' : undefined, 'data-antidetect-save': true, children: t('save') })] })] }) : null
      ] })
      ] })
    ] });
  }
  return { AntidetectApp };
}
