// ADR-066: profile generation and editing are previews until an explicit revisioned commit.
import { API_CONFIG_CATALOG, API_CUSTOM_ONLY_IDS, API_CONFIGURATION_MAX_BYTES, API_CONFIGURATION_MAX_PROFILES, validateApiConfiguration, validateApiValue, updateApiConfiguration, importApiConfiguration, exportApiConfiguration, diffApiConfigurations } from './api-configuration.js';
import { FINGERPRINT_LANGUAGES, FINGERPRINT_ISSUE_CODES, generateConsistentDevice, applyDevicePatch, fingerprintProfileIssues, mergeConfigurations, applyFingerprintProfile, snapshotFingerprintProfile, storeFingerprintProfile } from './fingerprint-profiles.js';
import { createFingerprintProfilesController } from './fingerprint-profiles-controller.js';
// ADR-107: the saved-profiles library (rows, search, Save as profile, Load/Rename/Delete) lives in its own module.
import { createFingerprintLibraryUi, fillIssueDetail } from './fingerprint-library-ui.js';
// ADR-107 round 5: labels of tags, trash, temporary profiles and the proxy link; the cosmetic label of a temporary profile.
import { fingerprintIdentityLabels } from './fingerprint-identity-labels.js';
import { temporaryLabel } from './fingerprint-temporary.js';
// ADR-104: device/quick-setup model, offline timezone picker, device icons and honest labels.
import { DEVICE_OS, DEVICE_BROWSERS, GPU_PRESETS, SCREEN_PRESETS, CPU_STEPS, RAM_STEPS, DISK_STEPS, browserVersions, gpusFor, screensFor, describeDevice, ramImageFromReported, reportedDeviceMemory, reportedStorageQuota, chromiumIdentity } from './fingerprint-device-presets.js';
import { sameTimeZone, timezoneByIana } from './fingerprint-timezone-data.js';
import { DEVICE_ICON_PATHS } from './fingerprint-device-icons.js';
import { fingerprintDeviceLabels } from './fingerprint-device-labels.js';
// ADR-104 addendum 4: the offline Region picker (country names from Intl.DisplayNames, region data from the bundled table).
import { regionOfTimeZone } from './fingerprint-region-data.js';
import { regionPicker, regionName, searchRegions, formatCoordinates, regionCity } from './fingerprint-region-names.js';
// ADR-107: per-control hints, value sources, keyboard roving and the «keep my changes» rebase (pure helpers).
import { placeIssues, issueTarget, fieldSource, explainIssue, searchZones, zoneCountry, languageLabel, rovingIndex, rebaseConfiguration, gpuShortName, pendingViews } from './fingerprint-field-hints.js';
// The generator's optional repair helpers (issueFix, retargetIdentityVersion, fitWindowTarget) are read from the module namespace:
// a missing helper only hides its button.
import * as profileModel from './fingerprint-profiles.js';
import { announce } from './ui-announcer.js';
import { registerSaveShortcut, registerDirtyGuard, registerPaletteCommands } from './ui-shortcuts.js';
import { redesignLabels } from './redesign-labels.js';
import { antidetectEditorLabels } from './antidetect-editor-labels.js';

const clone = value => JSON.parse(JSON.stringify(value));
const NO_VIEWS = Object.freeze([]), NO_TEMPORARY = Object.freeze({ active: false, label: '', startedAt: null }), CHANGES_LISTED = 12, NOTE_EXCERPT = 160;
// The Custom value a configuration reports for a row, as `describeDevice` reads it.
const customValueOf = configuration => id => { const found = configuration.apis.find(row => row.id === id); return found?.mode === 'custom' && found.selected.kind === 'value' ? found.selected.value : undefined; };
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const ERROR_KEYS = Object.freeze({ 'stale-revision': 'antidetect_stale', 'invalid-value': 'antidetect_invalid', 'invalid-profile': 'antidetect_invalid', 'duplicate-profile': 'fingerprint_duplicate_profile', 'profile-limit': 'fingerprint_profile_limit', 'missing-profile': 'fingerprint_missing_profile', inactive: 'antidetect_scope_inactive', 'early-access-required': 'antidetect_early_required', 'privacy-permission-required': 'dw:privacy_required' });
// The generator owns the code list; every listed code has a message (locale catalog for the first thirteen, device labels for the rest).
const ISSUE_CODES = new Set(FINGERPRINT_ISSUE_CODES);
// New hints live in the device-labels module (`issue_<code>`); the original codes keep their `fingerprint_issue_*` catalog keys.
export function issueMessage(code, words, translate) {
  const key = 'issue_' + code.replaceAll('-', '_');
  return words[key] || translate('fingerprint_' + key);
}
// The quick form starts from this real browser: brand, nearest listed major and Windows 10 or 11 (all optional; a saved profile still wins in accept()).
// Rule (heuristic; only 19.0.0 on build 26200 was measured here): platformVersion 10.x is Windows 10, 13 or newer is Windows 11, anything else keeps the Windows 11 default.
export function environmentDefaults(environment) {
  const own = key => environment && typeof environment === 'object' ? Object.getOwnPropertyDescriptor(environment, key)?.value : undefined;
  const platformVersion = own('platformVersion'), platformMajor = typeof platformVersion === 'string' ? Number(/^(\d{1,4})\.\d{1,5}\.\d{1,5}$/u.exec(platformVersion)?.[1]) : NaN;
  const result = { os: platformMajor === 10 ? 'windows-10' : 'windows-11' }, brand = own('brand'), major = own('uaMajor'), list = browserVersions();
  if (DEVICE_BROWSERS.includes(brand)) result.browser = brand;
  if (Number.isSafeInteger(major) && major > 0) result.version = list.includes(major) ? major : major > list[0] ? list[0] : list[list.length - 1];
  return result;
}
// A profile "matches" a configuration when applying it would change no stored row.
function profileMatcher(configuration) {
  const current = new Map(configuration.apis.map(row => [row.id, row]));
  return profile => profile.preset === configuration.preset && same(profile.webrtcNetworkPolicy, configuration.webrtcNetworkPolicy) && profile.apis.every(row => { const other = current.get(row.id); return Boolean(other) && other.mode === row.mode && same(other.selected, row.selected) && same(other.settings, row.settings); });
}
const previewValue = value => { const text = JSON.stringify(value); return text?.length > 400 ? text.slice(0, 400) + '…' : text; };
function rebasePreviewLibrary(preview, before, after) {
  const fail = code => { throw Object.assign(new Error(code), { code }); };
  const old = new Map(before.fingerprintProfiles.map(profile => [profile.id, profile])), next = new Map(after.fingerprintProfiles.map(profile => [profile.id, profile])), retained = new Map(preview.fingerprintProfiles.map(profile => [profile.id, clone(profile)]));
  for (const [id, original] of old) {
    const replacement = next.get(id); if (replacement && same(original, replacement)) continue;
    const imported = retained.get(id);
    // An imported profile with the same ID is a real pending edit, not a disposable copy.
    if (imported && !same(imported, original) && (!replacement || !same(imported, replacement))) fail('stale-revision');
    if (!replacement) retained.delete(id); else if (imported) retained.set(id, clone(replacement));
  }
  for (const [id, profile] of next) if (!old.has(id)) {
    if (retained.has(id) && !same(retained.get(id), profile)) fail('duplicate-profile');
    retained.set(id, clone(profile));
  }
  if (retained.size > API_CONFIGURATION_MAX_PROFILES) fail('profile-limit');
  const checked = validateApiConfiguration({ ...preview, fingerprintProfiles: [...retained.values()] }); if (!checked.ok) fail('invalid-profile');
  return checked.value;
}

// `proxyFactory` (optional) replaces the Options-only proxy port client of the controller; only tests pass it.
export function createFingerprintProfileUi({ h, useState, useEffect, useRef, useLocale, translate, browserApi = globalThis.chrome, proxyFactory = undefined }) {
  const t = key => translate('fingerprint_' + key), editor = key => translate('antidetect_editor_' + key);
  const label = row => {
    const key = 'protection_feature_' + row.id.replaceAll('-', '_'), translated = translate(key);
    // Navigator/Screen/WebAssembly entries use their canonical technical API names.
    return translated && translated !== key ? translated : API_CONFIG_CATALOG.find(entry => entry.id === row.id)?.name ?? row.id;
  };
  function Icon({ name = 'profiles', size = 21 }) {
    const local = { profiles: 'M8 8a4 4 0 1 0 8 0 4 4 0 1 0-8 0ZM4 22v-3a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v3', generate: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4m-2-2h4', library: 'M4 3h16v18H4ZM8 3v7l4-2 4 2V3M8 15h8m-8 3h5', preview: 'M3 12s3-7 9-7 9 7 9 7-3 7-9 7-9-7-9-7Zm6 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0', edit: 'm15 4 5 5M3 21l5-1L21 7l-5-5L3 15Z', load: 'M12 3v11m-4.5-4.5L12 14l4.5-4.5M4 15v5h16v-5', delete: 'M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3', search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 1 0 0-13ZM20 20l-4.8-4.8', warning: 'M12 3.5 2.5 20h19L12 3.5ZM12 10v4.5M12 17.2v.3', info: 'M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0ZM12 11v6M12 7.5v.3', check: 'M5 12.5 10 17.5 19.5 7' };
    // ADR-104 device/OS/browser/network icons come from the shared device icon set.
    const raw = Object.hasOwn(local, name) ? local[name] : DEVICE_ICON_PATHS[name] ?? local.profiles;
    const paths = Array.isArray(raw) ? raw : [raw];
    return h('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': true, focusable: 'false', children: paths.map((d, index) => h('path', { d, key: index })) });
  }
  const { FingerprintLibrary } = createFingerprintLibraryUi({ h, useState, useEffect, useRef, useLocale, translate, Icon });
  // `onNavigate(level)` lets a hint card switch the Antidetect level (the parent owns the tabs); `disabledReason` says why the parent
  // keeps the panel disabled ('network-dirty' | 'unverified' | 'busy' | null).
  // `onPendingLevels(views)` receives the frozen subset of 'quick', 'device', 'os', 'browser' holding unapplied changes, only
  // when that subset changes (and an empty one when the panel goes away), so the parent can mark those tabs.
  function FingerprintProfilePanel({ active = true, disabled = false, tabId = null, view = 'quick', onApplied = () => {}, antidetectOn = true, onEnable = null, onNavigate = null, disabledReason = null, onPendingLevels = null }) {
    const locale = useLocale(), dwords = fingerprintDeviceLabels(locale), iw = fingerprintIdentityLabels(locale);
    const [temporary, setTemporary] = useState(NO_TEMPORARY);
    const [saved, setSaved] = useState(null), [draft, setDraft] = useState(null), [busy, setBusy] = useState(false), [stale, setStale] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''),
      [preset, setPreset] = useState('balanced'), [deviceType, setDeviceType] = useState('desktop'), [os, setOs] = useState('windows-11'), [browser, setBrowser] = useState('chrome'), [version, setVersion] = useState(browserVersions()[0]), [gpu, setGpu] = useState(''), [screen, setScreen] = useState(''), [language, setLanguage] = useState('preserve'), [timezone, setTimezone] = useState(null), [tzQuery, setTzQuery] = useState(''), [tzOpen, setTzOpen] = useState(false), [tzActive, setTzActive] = useState(-1), [ramImage, setRamImage] = useState(null),
      [regionQuery, setRegionQuery] = useState(''), [regionOpen, setRegionOpen] = useState(false), [regionActive, setRegionActive] = useState(-1), [regionPick, setRegionPick] = useState(null),
      [selectedApi, setSelectedApi] = useState('hardware-concurrency'), [apiMode, setApiMode] = useState('bypass'), [valueKind, setValueKind] = useState('unset'), [valueJson, setValueJson] = useState(''), [exportText, setExportText] = useState(''), [changePage, setChangePage] = useState(0),
      [conflicts, setConflicts] = useState([]), [windowNote, setWindowNote] = useState(''),
      // ADR-110 addendum: the generator's font list noise switch (a generator choice like the ones above: kept in this panel, not in the configuration).
      // On when the panel first shows (owner decision 2026-11-07); a saved Windows font list decides it instead (see accept()).
      [fontNoise, setFontNoise] = useState(true);
    const controller = useRef(null), savedRef = useRef(saved), draftRef = useRef(draft), live = useRef(true), pending = useRef(false), epoch = useRef(0), input = useRef(null), stateRef = useRef({ active, disabled }), derived = useRef(null), staleRef = useRef(false), seeded = useRef(false),
      root = useRef(null), pendingFocus = useRef(null), applyRef = useRef(() => false), dirtyRef = useRef(false), paletteRef = useRef(() => []), pendingRef = useRef({ key: '', views: NO_VIEWS }), pendingNotify = useRef(null);
    savedRef.current = saved; draftRef.current = draft; stateRef.current = { active, disabled }; staleRef.current = stale;
    if (!derived.current || derived.current.before !== saved?.configuration || derived.current.after !== draft || derived.current.environment !== saved?.environment) {
      const difference = saved && draft ? diffApiConfigurations(saved.configuration, draft) : null;
      const pendingChanges = Boolean(saved && draft && !same(saved.configuration, draft)), statuses = new Map();
      if (saved && draft) {
        const applied = profileMatcher(saved.configuration), previewed = pendingChanges ? profileMatcher(draft) : () => false;
        for (const profile of saved.configuration.fingerprintProfiles) { const status = applied(profile) ? 'applied' : previewed(profile) ? 'preview' : ''; if (status) statuses.set(profile.id, status); }
      }
      derived.current = { before: saved?.configuration, after: draft, environment: saved?.environment, dirty: pendingChanges, statuses, changed: difference?.ok ? difference.value : [], issues: draft ? fingerprintProfileIssues(draft, saved?.environment).filter(issue => ISSUE_CODES.has(issue.code)) : [], formatted: new Map() };
    }
    const { dirty, statuses, changed, issues } = derived.current, locked = busy || disabled || !active || stale;
    const formatChange = value => { const cache = derived.current.formatted; if (!cache.has(value)) cache.set(value, previewValue(value)); return cache.get(value); };
    if (!controller.current) controller.current = createFingerprintProfilesController(browserApi, { tabId, ...(proxyFactory ? { proxyFactory } : {}), onInvalidate: () => { if (live.current) { epoch.current++; pending.current = false; setBusy(false); setStale(true); setNotice(''); void rebase(); } },
      // ADR-107: the GPU, WebGPU and proxy facts arrive after the first load; only the hints are repainted, the draft is untouched.
      onEnvironment: environment => { if (live.current) setSaved(current => { if (!current) return current; const next = { ...current, environment }; savedRef.current = next; return next; }); } });
    const safeError = failure => ERROR_KEYS[failure?.code] ?? 'antidetect_failed';
    function showApi(configuration, id = selectedApi) {
      const row = configuration?.apis.find(item => item.id === id); if (!row) return;
      setApiMode(row.mode); setValueKind(row.selected.kind); setValueJson(row.selected.kind === 'value' ? JSON.stringify(row.selected.value, null, 2) : '');
    }
    function accept(loaded, retained = null) {
      // The slower facts (GPU, WebGPU, proxy) may have arrived after this state was read and before it reached the panel: the
      // controller's current snapshot is taken so they are never lost.
      const fresh = controller.current?.environment?.(), state = fresh && typeof fresh === 'object' ? { ...loaded, environment: fresh } : loaded;
      savedRef.current = state; setSaved(state);
      const next = clone(retained ?? state.configuration);
      const first = !seeded.current;
      const info = describeDevice(customValueOf(next));
      if (info.deviceType) setDeviceType(info.deviceType);
      if (first) {
        seeded.current = true;
        // Precedence per field: the saved profile, then this real browser, then the static defaults.
        const real = environmentDefaults(state.environment), nextOs = info.os ?? real.os, nextBrowser = info.browser ?? real.browser, nextVersion = info.version ?? real.version;
        if (nextOs) setOs(nextOs); if (nextBrowser) setBrowser(nextBrowser); if (nextVersion) setVersion(nextVersion);
        if (info.language && FINGERPRINT_LANGUAGES.includes(info.language)) setLanguage(info.language); if (info.timezone) setTimezone(info.timezone);
        // A saved Windows font list decides the switch: a list that lacks a few optional families (generated with the noise on) starts it On, a plain
        // Windows list Off. No list, or a custom one, keeps the default (On). Nothing is migrated: saved lists and profiles stay as they are.
        if (info.fontNoise !== null) setFontNoise(info.fontNoise === true);
      }
      const currentRow = draftRef.current?.apis.find(row => row.id === selectedApi), nextRow = next.apis.find(row => row.id === selectedApi);
      const keepEditor = retained && same(currentRow, nextRow);
      draftRef.current = next; setDraft(next); setStale(false); setExportText(''); setChangePage(0); setConflicts([]);
      if (!keepEditor) showApi(next);
      void refreshTemporary();
    }
    // ADR-107 round 5: whether a temporary profile is active (its record is one small machine-local key); a failed read keeps the banner as it was.
    async function refreshTemporary() {
      const api = controller.current?.temporary;
      if (!api?.available?.()) return;
      try { const found = await api.read(); if (live.current) setTemporary(previous => previous.active === found.active && previous.label === found.label && previous.startedAt === found.startedAt ? previous : { active: found.active, label: found.label, startedAt: found.startedAt }); }
      catch { /* The banner stays as it was. */ }
    }
    function stage(configuration) { draftRef.current = configuration; setDraft(configuration); setError(''); setNotice('fingerprint_preview_ready'); setExportText(''); setChangePage(0); showApi(configuration); }
    async function refresh() {
      if (pending.current || !stateRef.current.active) return;
      if (savedRef.current && draftRef.current && !same(savedRef.current.configuration, draftRef.current)) { setError('antidetect_refresh_dirty'); return; }
      const token = ++epoch.current; pending.current = true; setBusy(true); setError(''); setNotice('');
      try { const state = await controller.current.load(); if (live.current && token === epoch.current) accept(state); }
      catch (failure) { if (live.current && token === epoch.current) setError(safeError(failure)); }
      finally { if (live.current && token === epoch.current) { pending.current = false; setBusy(false); } }
    }
    useEffect(() => { live.current = true; return () => { live.current = false; epoch.current++; controller.current.dispose(); }; }, []);
    // A newer revision saved elsewhere (for example the header master switch) is merged into the pending draft when the edits do not
    // overlap, so Apply stays usable; only a real conflict keeps the editor locked until the user discards the draft.
    function adopt(before, state) {
      const mine = draftRef.current;
      if (!before || !mine || same(before.configuration, mine)) { accept(state); return; }
      const merged = mergeConfigurations(before.configuration, mine, state.configuration);
      if (merged) { accept(state, merged); if (state.earlyAccess === 'ready') setError(current => current === 'antidetect_early_required' ? '' : current); setNotice(''); }
      else { setStale(true); setNotice(''); }
    }
    async function rebase(onlyIfChanged = false) {
      if (!live.current || !stateRef.current.active || onlyIfChanged && pending.current) return;
      // The editor stays usable while the newer revision loads: edits made meanwhile are read from draftRef when adopting, never lost.
      const token = ++epoch.current; pending.current = true;
      try {
        const before = savedRef.current, state = await controller.current.load();
        if (live.current && token === epoch.current && (!onlyIfChanged || staleRef.current || !before || state.revision !== before.revision || state.earlyAccess !== before.earlyAccess)) adopt(before, state);
      } catch (failure) { if (live.current && token === epoch.current) { setError(safeError(failure)); setStale(true); } }
      finally { if (live.current && token === epoch.current) pending.current = false; }
    }
    const revalidate = () => rebase(true);
    async function discardAndRefresh() {
      if (pending.current || !savedRef.current) return;
      const next = clone(savedRef.current.configuration); draftRef.current = next; setDraft(next); setExportText(''); setChangePage(0);
      await refresh();
    }
    // ADR-107 «Keep my changes» on a real conflict: the newer revision is loaded and the rows I changed are laid onto it as a new
    // preview; rows both sides changed are reported as conflicts and listed first. Nothing is written until Apply.
    async function keepMine() {
      if (pending.current || !savedRef.current || !draftRef.current) return;
      const base = savedRef.current.configuration, mine = draftRef.current, token = ++epoch.current; pending.current = true; setBusy(true); setError('');
      try {
        const state = await controller.current.load(); if (!live.current || token !== epoch.current) return;
        const result = rebaseConfiguration(base, mine, state.configuration);
        if (!result) { setError('antidetect_invalid'); return; }
        accept(state, result.configuration); setConflicts(result.conflicts); setNotice('fingerprint_preview_ready'); announce(dwords.keep_mine_done);
      } catch (failure) { if (live.current && token === epoch.current) setError(safeError(failure)); }
      finally { if (live.current && token === epoch.current) { pending.current = false; setBusy(false); } }
    }
    async function grantScripts() {
      // Chrome: the per-extension switch lives on the extension page. Firefox: the optional permission prompt needs this click.
      try {
        if (savedRef.current?.earlyAccess === 'permission-required') { const granted = await browserApi.permissions.request({ permissions: ['userScripts'] }); if (granted) await rebase(false); else setError('antidetect_denied'); }
        else await browserApi.tabs.create({ url: 'chrome://extensions/?id=' + browserApi.runtime.id });
      } catch { setError('antidetect_failed'); }
    }
    useEffect(() => { controller.current.setVisible(active); if (!active) { epoch.current++; pending.current = false; setBusy(false); } else if (!savedRef.current) void refresh(); else void revalidate(); }, [active]);
    useEffect(() => {
      if (!active || !saved || saved.earlyAccess === 'ready') return undefined;
      const recheck = () => { if (globalThis.document?.visibilityState === 'visible') void rebase(true); };
      globalThis.addEventListener?.('focus', recheck); globalThis.document?.addEventListener?.('visibilitychange', recheck);
      return () => { globalThis.removeEventListener?.('focus', recheck); globalThis.document?.removeEventListener?.('visibilitychange', recheck); };
    }, [active, saved?.earlyAccess]);
    // ADR-107 shared shortcuts: Ctrl/Cmd+S applies while focus is inside this panel (the handler answers synchronously and starts the
    // commit with `void`), leaving the page with a pending draft asks first, and the command palette offers Randomize, Apply (only
    // while Apply would be accepted) and Export. The refs are refreshed on every render, the registrations live as long as the panel.
    useEffect(() => registerSaveShortcut(root.current, event => applyRef.current(event)), []);
    useEffect(() => registerDirtyGuard(() => dirtyRef.current === true), []);
    useEffect(() => registerPaletteCommands('fingerprint-profiles', () => paletteRef.current()), []);
    // Tabs with unapplied changes: one frozen array per distinct subset, reported once per change.
    const pendingKey = dirty ? pendingViews(changed).join(',') : '';
    if (pendingRef.current.key !== pendingKey) pendingRef.current = { key: pendingKey, views: pendingKey ? Object.freeze(pendingKey.split(',')) : NO_VIEWS };
    pendingNotify.current = onPendingLevels;
    useEffect(() => { try { pendingNotify.current?.(pendingRef.current.views); } catch { /* The marks are a convenience of the parent. */ } }, [pendingKey]);
    useEffect(() => () => { try { pendingNotify.current?.(NO_VIEWS); } catch { /* Same. */ } }, []);
    // «Show» on a hint of another level: the parent switches the level, then the control gets the focus once it is rendered.
    useEffect(() => {
      const field = pendingFocus.current; if (!field || !saved || !draft) return;
      pendingFocus.current = null; globalThis.document?.getElementById?.(controlId(field))?.focus?.();
    }, [view, Boolean(saved && draft)]);
    async function commit(configuration, retainPreview = false) {
      if (pending.current || stateRef.current.disabled || !stateRef.current.active || stale || !savedRef.current) return false;
      let preview = null;
      try { if (retainPreview) preview = rebasePreviewLibrary(draftRef.current, savedRef.current.configuration, configuration); }
      catch (failure) { setError(safeError(failure)); return false; }
      const token = ++epoch.current; pending.current = true; setBusy(true); setError(''); setNotice('');
      try {
        const state = await controller.current.commit(configuration, savedRef.current.revision);
        if (!live.current || token !== epoch.current) return false;
        accept(state, preview); setNotice(state.registration === 'error' ? 'antidetect_editor_activationFailed' : 'antidetect_saved');
        try { await onApplied(state); } catch { /* A persisted commit stays factual if the parent view cannot refresh. */ }
        return true;
      } catch (failure) { if (live.current && token === epoch.current) { setError(safeError(failure)); if (failure?.code === 'stale-revision') setStale(true); } return false; }
      finally { if (live.current && token === epoch.current) { pending.current = false; setBusy(false); } }
    }
    const generatorOptions = (seed, environment) => ({ deviceType, os, browser, version, protection: preset, seed, environment, fontNoise,
      ...(gpu ? { gpu } : {}), ...(screen ? { screen } : {}),
      ...(language !== 'preserve' ? { language } : {}), ...(timezone ? { timezone } : {}) });
    function randomize() {
      if (!draftRef.current || busy) return;
      try {
        const seed = globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
        // The real-browser snapshot is a read-only hint for the generator (real client-hint builds when the claim equals this browser, core cap); the snapshot object itself is never stored.
        const environment = savedRef.current.environment;
        stage(generateConsistentDevice(draftRef.current, generatorOptions(seed, environment), environment).configuration);
      } catch (failure) { setError(safeError(failure)); }
    }
    // --- ADR-107 round 5: temporary profiles. They apply at once and are remembered by the controller (record first, then the write), so
    // they wait for pending changes: a draft would be lost when the applied state changes under it. ---
    async function startTemporary(configuration, name) {
      if (pending.current || stateRef.current.disabled || !stateRef.current.active || staleRef.current || !savedRef.current || dirtyRef.current) return false;
      const token = ++epoch.current; pending.current = true; setBusy(true); setError(''); setNotice('');
      try {
        const result = await controller.current.temporary.start(configuration, name);
        if (!live.current || token !== epoch.current) return false;
        accept(result.state); setTemporary(result.temporary); setNotice(result.state.registration === 'error' ? 'antidetect_editor_activationFailed' : 'antidetect_saved');
        announce(iw.tempStarted.replace('{name}', () => result.temporary.label));
        try { await onApplied(result.state); } catch { /* A persisted commit stays factual if the parent view cannot refresh. */ }
        return true;
      } catch (failure) { if (live.current && token === epoch.current) { setError(safeError(failure)); if (failure?.code === 'stale-revision') setStale(true); } return false; }
      finally { if (live.current && token === epoch.current) { pending.current = false; setBusy(false); } }
    }
    async function endTemporary() {
      if (pending.current || stateRef.current.disabled || !stateRef.current.active || staleRef.current || !savedRef.current || dirtyRef.current) return false;
      const token = ++epoch.current; pending.current = true; setBusy(true); setError(''); setNotice('');
      try {
        const result = await controller.current.temporary.end();
        if (!live.current || token !== epoch.current) return false;
        accept(result.state); setTemporary(NO_TEMPORARY); setNotice(result.state.registration === 'error' ? 'antidetect_editor_activationFailed' : 'antidetect_saved'); announce(iw.tempEnded);
        try { await onApplied(result.state); } catch { /* Same as above. */ }
        return true;
      } catch (failure) { if (live.current && token === epoch.current) { setError(safeError(failure)); if (failure?.code === 'stale-revision') setStale(true); } return false; }
      finally { if (live.current && token === epoch.current) { pending.current = false; setBusy(false); } }
    }
    // A library profile laid over the SAVED rows, applied for this browser session only. The library itself is not touched.
    async function temporaryFromProfile(profile) {
      if (!savedRef.current) return false;
      let configuration; try { configuration = applyFingerprintProfile(savedRef.current.configuration, profile.id); } catch (failure) { setError(safeError(failure)); return false; }
      return startTemporary(configuration, profile.label);
    }
    // A fresh identity from the generator (with the options chosen above), applied temporarily and NOT added to the library.
    function newTemporaryIdentity() {
      if (!savedRef.current || busy || dirtyRef.current) return;
      try {
        const seed = globalThis.crypto.getRandomValues(new Uint32Array(1))[0], environment = savedRef.current.environment;
        void startTemporary(generateConsistentDevice(savedRef.current.configuration, generatorOptions(seed, environment), environment).configuration, iw.tempGenerated);
      } catch (failure) { setError(safeError(failure)); }
    }
    // The explicit "Save to library" of a generated temporary identity: the applied rows become a profile named like the temporary one.
    async function saveTemporaryToLibrary() {
      if (!savedRef.current || pending.current || stateRef.current.disabled || !stateRef.current.active || staleRef.current) return false;
      try {
        const name = temporaryLabel(temporary.label) || iw.tempGenerated, profile = snapshotFingerprintProfile(savedRef.current.configuration, name);
        if (!await commit(storeFingerprintProfile(savedRef.current.configuration, profile), true)) return false;
        announce(iw.tempSaved.replace('{name}', () => name)); return true;
      } catch (failure) { setError(safeError(failure)); return false; }
    }
    function chooseDeviceType(value) { if (busy) return; setDeviceType(value); setGpu(''); setScreen(''); }
    // ADR-104 level controls stage a patch into the preview draft; Apply commits it with one CAS write.
    function stagePatch(patch) {
      if (!draftRef.current || busy || !savedRef.current) return false;
      try { const environment = savedRef.current.environment; stage(applyDevicePatch(draftRef.current, { ...patch, environment }, environment).configuration); return true; }
      catch (failure) { setError(safeError(failure)); return false; }
    }
    // The Region control stages one patch: a code writes the zone, languages and coordinates together, null returns them to the browser.
    // The explicit pick is remembered only while the staged zone still belongs to it, so a later zone edit shows the derived region.
    function chooseRegion(code) {
      if (!stagePatch({ region: code })) return;
      setRegionPick(code === null ? null : { code, timeZone: describeDevice(customValueOf(draftRef.current)).timezone?.timeZone ?? null });
    }
    // Keep the highlighted option of an open list inside its scroll box without scrolling the page.
    useEffect(() => {
      const doc = globalThis.document; if (!doc?.getElementById) return;
      for (const [open, index, id] of [[tzOpen, tzActive, 'fp-timezone-list'], [regionOpen, regionActive, 'fp-region-list']]) {
        const list = open && index >= 0 ? doc.getElementById(id) : null, option = list ? doc.getElementById(id + '-' + index) : null;
        if (!list || !option) continue;
        if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
        else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
      }
    }, [tzOpen, tzActive, regionOpen, regionActive]);
    function cancel() { if (busy || !savedRef.current) return; const next = clone(savedRef.current.configuration); draftRef.current = next; setDraft(next); setError(''); setNotice(''); setExportText(''); setChangePage(0); setConflicts([]); showApi(next); }
    // ADR-107 hint actions. «Fix» stages the generator's repair as a preview (never applied by itself); «Update the claim» moves the
    // claimed version to this browser's; «Fit the window» resizes this window to the claimed screen after an explicit click.
    const environmentOf = () => savedRef.current?.environment ?? {};
    const repair = (name, ...args) => { const helper = profileModel[name]; if (typeof helper !== 'function') return null; try { const result = helper(...args); return result && typeof result === 'object' ? result : null; } catch { return null; } };
    function applyRepair(result) {
      if (!result?.configuration || busy) return;
      const checked = validateApiConfiguration(result.configuration); if (!checked.ok) { setError('antidetect_invalid'); return; }
      stage(checked.value); announce(dwords.fix_staged);
    }
    async function fitWindow(target) {
      if (!target || busy) return;
      try {
        const result = await controller.current.fitWindow(target), kept = result.actual;
        const text = kept.width && kept.height ? dwords.fit_window_done.replace('{width}', String(kept.width)).replace('{height}', String(kept.height)) : dwords.fit_window_failed;
        if (live.current) { setWindowNote(text); announce(text); }
      } catch { if (live.current) { setWindowNote(dwords.fit_window_failed); announce(dwords.fit_window_failed, { assertive: true }); } }
    }
    // «Show»: the control of the hint on this level gets the focus; another level is opened through the parent first.
    function showIssue(issue) {
      const target = issueTarget(issue); if (!target) return;
      if (target.level === view) { globalThis.document?.getElementById?.(controlId(target.field))?.focus?.(); return; }
      if (typeof onNavigate !== 'function') return;
      pendingFocus.current = target.field; onNavigate(target.level);
    }
    // The focusable element of each level control (the sliders keep their existing input ids).
    function controlId(field) { return ['cpu', 'ram', 'disk', 'screen'].includes(field) ? 'fp-slider-' + field : 'fp-field-' + field; }
    function editApi() {
      if (!draftRef.current || busy) return;
      try {
        const tagged = valueKind === 'value' ? { kind: 'value', value: JSON.parse(valueJson) } : { kind: valueKind };
        const checked = validateApiValue(selectedApi, tagged); if (!checked.ok) { setError('antidetect_invalid'); return; }
        const next = updateApiConfiguration(draftRef.current, selectedApi, { mode: apiMode, selected: checked.value }); if (!next.ok) { setError('antidetect_invalid'); return; }
        stage(next.value);
      } catch { setError('antidetect_invalid'); }
    }
    async function readFile(event) {
      const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
      if (!file || busy || !stateRef.current.active) return;
      if (file.size > API_CONFIGURATION_MAX_BYTES) { setError('antidetect_editor_tooLarge'); return; }
      const token = ++epoch.current; pending.current = true; setBusy(true); setError('');
      try {
        const text = await file.text(); if (!live.current || token !== epoch.current) return;
        const result = importApiConfiguration(text); if (!result.ok) { setError('antidetect_editor_invalidJson'); return; } stage(result.value);
      } catch { if (live.current && token === epoch.current) setError('antidetect_editor_invalidJson'); }
      finally { if (live.current && token === epoch.current) { pending.current = false; setBusy(false); } }
    }
    function exportPreview() { try { setExportText(exportApiConfiguration(draftRef.current)); setError(''); } catch (failure) { setError(safeError(failure)); } }
    function download() {
      if (!exportText) return;
      const url = URL.createObjectURL(new Blob([exportText], { type: 'application/json' })), anchor = document.createElement('a'); anchor.href = url; anchor.download = 'detect-expert-fingerprint-configuration.json'; anchor.hidden = true; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    function field(text, control) { return h('label', { class: 'fingerprint-field', children: [h('span', { children: text }), control] }); }
    function picker(attribute, value, onChange, options, extra = {}) {
      // An entry is either [value, text] or { group, items: [[value, text], …] } rendered as an optgroup.
      const option = ([id, text]) => h('option', { value: id, key: id, children: text });
      return h('select', { value, disabled: busy, id: extra.id, 'aria-describedby': extra.describedBy, ['data-profile-' + attribute]: true, onChange: event => onChange(event.currentTarget.value), children: options.map(entry => Array.isArray(entry) ? option(entry) : h('optgroup', { label: entry.group, key: entry.group, children: entry.items.map(option) })) });
    }
    function heading(title, icon) { return h('h4', { class: 'fingerprint-heading', children: [h('span', { class: 'fingerprint-icon fingerprint-icon--' + icon, children: h(Icon, { name: icon }) }), title] }); }
    // Radios keep one tab stop and follow the visual direction for arrow keys (the shared roving helper, also used by the presets).
    const rovingKey = (event, ids, id, select, attribute) => {
      const rtl = globalThis.getComputedStyle?.(event.currentTarget).direction === 'rtl', next = rovingIndex(event.key, ids.indexOf(id), ids.length, rtl);
      if (next < 0) return;
      event.preventDefault(); if (busy) return; select(ids[next]); event.currentTarget.parentElement?.querySelector('[' + attribute + '="' + ids[next] + '"]')?.focus();
    };
    // `extra`: the id of the checked radio (the «Show» target), a source chip and the id of the hints under the control.
    function segmented(attribute, caption, value, onChange, options, extra = {}) {
      // `extra.locked` keeps the choice visible but unavailable (the font list noise switch outside the Strict preset).
      const ids = options.map(([id]) => id), current = ids.includes(value) ? value : ids[0], blocked = busy || extra.locked === true;
      return h('div', { class: 'fingerprint-form-row', 'data-tour': extra.tour, children: [labelWithSource(caption, extra.source), h('div', { class: 'fingerprint-segmented' + (extra.locked === true ? ' is-locked' : ''), role: 'radiogroup', 'aria-label': caption, 'aria-describedby': extra.describedBy, ['data-profile-' + attribute]: true, children: options.map(([id, text]) => h('button', { type: 'button', role: 'radio', key: id, id: current === id ? extra.id : undefined, class: 'fingerprint-segment' + (value === id ? ' is-selected' : ''), 'aria-checked': value === id, tabIndex: current === id ? 0 : -1, disabled: blocked, 'data-profile-option': id, onClick: () => { if (!blocked) onChange(id); }, onKeyDown: event => { if (extra.locked !== true) rovingKey(event, ids, id, onChange, 'data-profile-option'); }, children: text })) })] });
    }
    // A form label with an optional source chip (Real / From the region / Custom) after the caption.
    function labelWithSource(caption, source) { return h('span', { class: 'fingerprint-form-label', children: source ? [h('span', { class: 'fp-label__text', children: caption }), source] : caption }); }
    function formSelect(attribute, caption, value, onChange, options, extra = {}) { return h('label', { class: 'fingerprint-form-row', children: [labelWithSource(caption, extra.source), picker(attribute, value, onChange, options, extra)] }); }
    // ADR-104: the card list, grouped by vendor so fifty adapters stay scannable. ADR-107: the first option names this computer's
    // real card (with its name when the snapshot read it) instead of a bare «Auto».
    const realGpuName = () => gpuShortName(saved?.environment?.gpu?.renderer);
    const gpuOptions = (list, first = dwords.gpu_real_option + (realGpuName() ? ' · ' + realGpuName() : '')) => [['', first], ...[['nvidia', 'NVIDIA'], ['amd', 'AMD'], ['intel', 'Intel']].map(([family, group]) => ({ group, items: list.filter(entry => entry.vendorFamily === family).map(entry => [entry.id, entry.label]) })).filter(entry => entry.items.length)];
    // ADR-104: icon pickers for the device type, Windows version and browser family (ТЗ §3, §8).
    const withIcon = (icon, text) => [h(Icon, { name: icon, size: 16 }), h('span', { children: text })];
    const typeOptions = () => [['laptop', withIcon('laptop', dwords.device_laptop)], ['desktop', withIcon('desktop', dwords.device_desktop)]];
    const osOptions = () => DEVICE_OS.map(id => [id, withIcon(id, id === 'windows-11' ? 'Windows 11' : 'Windows 10')]);
    const browserOptions = () => DEVICE_BROWSERS.map(id => [id, withIcon(id, id === 'edge' ? 'Microsoft Edge' : 'Google Chrome')]);
    // ADR-104 Quick-setup: honest presets, a device-identity picker and a reported-device card.
    const reported = id => { const row = draft?.apis.find(item => item.id === id); return row?.mode === 'custom' && row.selected.kind === 'value' ? row.selected.value : undefined; };
    function presetButtons() {
      const items = [['compatibility', dwords.preset_compatibility, dwords.preset_compatibility_desc], ['balanced', dwords.preset_balanced, dwords.preset_balanced_desc], ['strict', dwords.preset_strict, dwords.preset_strict_desc]];
      const ids = items.map(([id]) => id);
      return h('div', { class: 'fp-presets', role: 'radiogroup', 'aria-label': dwords.quick_title, 'data-profile-presets': true, 'data-tour': 'generator', children: items.map(([id, nameText, desc]) => h('button', { type: 'button', role: 'radio', key: id, 'aria-checked': preset === id, tabIndex: preset === id ? 0 : -1, class: 'fp-preset' + (preset === id ? ' is-selected' : ''), disabled: busy, 'data-profile-preset': id, onClick: () => { if (!busy) setPreset(id); }, onKeyDown: event => rovingKey(event, ids, id, setPreset, 'data-profile-preset'), children: [h('span', { class: 'fp-preset__name', children: nameText }), h('span', { class: 'fp-preset__desc', children: desc })] })) });
    }
    // One searchable combobox for the time zone and the Region (same keys, ARIA and styling). `box` carries the open/query/active
    // state of the list; `entries` are already filtered; `body` renders one option's two lines.
    // ADR-107 a11y: an IME composition never picks or closes; the list closes when the focus leaves the box (no timer); the keyboard
    // highlight and the current value are separate (the current one has a check mark); a permanent status says «No results».
    function comboBox({ name, icon, label, shown, box, entries, keyOf, selected, onChoose, body, placeholder = dwords.value_auto, id, describedBy }) {
      const listId = 'fp-' + name + '-list', statusId = 'fp-' + name + '-status', [query, setQuery, open, setOpen, active, setActive] = box;
      const choose = entry => { onChoose(entry); setQuery(''); setOpen(false); setActive(-1); };
      const empty = open && query.trim() !== '' && entries.length === 0;
      return h('div', { class: 'fp-combobox', ['data-profile-' + name]: true, onFocusOut: event => { if (!event.currentTarget?.contains?.(event.relatedTarget)) { setOpen(false); setActive(-1); } }, children: [
        h(Icon, { name: icon, size: 16 }),
        h('input', { type: 'search', class: 'fp-combobox__input', id, role: 'combobox', 'aria-expanded': open && entries.length > 0, 'aria-controls': listId, 'aria-autocomplete': 'list', 'aria-activedescendant': open && active >= 0 ? listId + '-' + active : undefined, 'aria-describedby': [statusId, describedBy].filter(Boolean).join(' '), value: open ? query : shown, placeholder, disabled: busy, autoComplete: 'off', spellcheck: false, 'aria-label': label, ['data-profile-' + name + '-input']: true,
          onInput: event => { setQuery(event.currentTarget.value); setOpen(true); setActive(0); },
          onFocus: () => { setQuery(''); setOpen(true); setActive(-1); },
          onKeyDown: event => {
            if (event.isComposing || event.keyCode === 229) return;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); const step = event.key === 'ArrowDown' ? 1 : -1; setActive(index => entries.length ? index < 0 ? (step > 0 ? 0 : entries.length - 1) : (index + step + entries.length) % entries.length : -1); }
            else if (event.key === 'Enter' && open && entries[active]) { event.preventDefault(); choose(entries[active]); }
            // Escape closes an open list first (and keeps the browser from clearing the search text at the same time); a second one clears it natively.
            else if (event.key === 'Escape' && open) { event.preventDefault(); setOpen(false); setActive(-1); }
          } }),
        open && entries.length ? h('ul', { class: 'fp-combobox__list', id: listId, role: 'listbox', 'aria-label': label, children: entries.map((entry, index) => h('li', { key: keyOf(entry), id: listId + '-' + index, role: 'option', 'aria-selected': selected(entry), class: 'fp-combobox__option' + (index === active ? ' is-highlighted' : '') + (selected(entry) ? ' is-selected' : ''), ['data-profile-' + name + '-option']: keyOf(entry), onMouseDown: event => { event.preventDefault(); choose(entry); }, children: [...body(entry), selected(entry) ? h('span', { class: 'fp-combobox__check', 'aria-hidden': true, children: h(Icon, { name: 'check', size: 14 }) }) : null] })) }) : null,
        h('p', { class: 'fp-combobox__status', id: statusId, role: 'status', 'aria-live': 'polite', ['data-profile-' + name + '-status']: true, children: empty ? dwords.region_none : '' })
      ] });
    }
    // ADR-107: every typed word must match (city, English or translated country, zone id, country code), accents ignored; the
    // country is shown in the UI language.
    function timezoneBox(current, onPick, extra = {}) {
      const results = searchZones(tzQuery, locale), zone = current?.timeZone ? timezoneByIana(current.timeZone) : null;
      return comboBox({ name: 'timezone', icon: 'timezone', label: dwords.timezone_label, shown: zone ? zone.city + ' · ' + zone.iana : current?.timeZone ?? '', ...extra,
        box: [tzQuery, setTzQuery, tzOpen, setTzOpen, tzActive, setTzActive], entries: results, keyOf: entry => entry.iana, selected: entry => sameTimeZone(current?.timeZone, entry.iana),
        onChoose: entry => onPick({ timeZone: entry.iana, offsetMinutes: entry.offsetMinutes }), body: entry => [h('span', { children: entry.city + ', ' + zoneCountry(entry, locale) }), h('span', { dir: 'ltr', children: entry.iana })] });
    }
    // Names follow the UI language; the code and the English name stay left-to-right so mixed scripts and RTL read correctly.
    function regionBox(current, results, extra = {}) {
      const picker = regionPicker(locale);
      return comboBox({ name: 'region', icon: 'region', label: dwords.region_label, shown: current ? picker.byCode.get(current)?.name ?? current : '', ...extra,
        box: [regionQuery, setRegionQuery, regionOpen, setRegionOpen, regionActive, setRegionActive], entries: results, keyOf: entry => entry.code, selected: entry => entry.code === current,
        onChoose: entry => chooseRegion(entry.code), body: entry => [h('span', { children: entry.name }), h('span', { dir: 'ltr', children: entry.code + (entry.english !== entry.name ? ' · ' + entry.english : '') })] });
    }
    // «As in the browser · value» for a control in its Auto state; a fact the snapshot lacks is left out rather than guessed.
    const browserValue = value => value === undefined || value === null || value === '' ? dwords.value_browser : dwords.value_browser + ' · ' + value;
    // The source chip of a level control: the real browser value, the region's defaults, or a custom value.
    function sourceChip(field, device) {
      const source = fieldSource(field, reported, currentRegion(device));
      return h('span', { class: 'fp-source fp-source--' + source, 'data-profile-source': field, 'data-source': source, children: dwords['source_' + source] });
    }
    // The region the staged time zone belongs to: an explicit pick while its zone is still staged, else the one derived from the zone.
    function currentRegion(device) {
      const zone = device.timezone?.timeZone ?? null;
      if (regionPick && zone && regionPick.timeZone && sameTimeZone(regionPick.timeZone, zone)) return regionPick.code;
      return device.region ?? (zone ? regionOfTimeZone(zone) : null);
    }
    // Country, city and coordinates (two decimals) as the card shows them; without any of them a plain «not set».
    function regionLine(device) {
      const code = currentRegion(device), place = device.geolocation ?? null;
      if (!code && !place) return h('span', { 'data-profile-device-region': '', children: dwords.region_card_unset });
      const city = code ? regionCity(code, place, device.timezone?.timeZone) : null, country = code ? regionName(locale, code) : null;
      const parts = [country ? h('bdi', { children: country }) : null, city ? h('bdi', { dir: 'ltr', children: city }) : null, place ? h('bdi', { dir: 'ltr', children: formatCoordinates(place.latitude, place.longitude) }) : null].filter(Boolean);
      return h('span', { 'data-profile-device-region': code ?? '-', children: parts.flatMap((part, index) => index ? [' · ', part] : [part]) });
    }
    function deviceCard() {
      const device = describeDevice(reported), width = reported('screen-width'), height = reported('screen-height'), dpr = reported('window-device-pixel-ratio');
      const osName = device.os === 'windows-11' ? 'Windows 11' : device.os === 'windows-10' ? 'Windows 10' : reported('navigator-platform') === 'Win32' ? 'Windows' : '\u2014';
      const family = device.browser === 'edge' ? 'Microsoft Edge' : device.browser === 'chrome' ? 'Google Chrome' : '\u2014';
      const zone = [device.timezone?.timeZone, device.language].filter(Boolean).join(' \u00b7 ');
      const quota = reported('storage-estimate')?.quota;
      const rows = [
        [device.os === 'windows-10' ? 'windows-10' : 'windows-11', dwords.os_label, osName],
        [device.browser === 'edge' ? 'edge' : 'chrome', dwords.browser_family_label, family + (device.version ? ' ' + device.version : '')],
        ['cpu', dwords.cpu_label, device.cores !== null ? String(device.cores) : '\u2014'],
        ['ram', dwords.ram_label, device.reportedMemory !== null ? device.reportedMemory + ' GB' : '\u2014'],
        ['disk', dwords.disk_label, typeof quota === 'number' ? '\u2248 ' + Math.round(quota / 1024 ** 3) + ' GiB' : '\u2014'],
        ['gpu', dwords.gpu_label, GPU_PRESETS.find(entry => entry.id === device.gpu)?.label ?? '\u2014'],
        ['monitor', dwords.screen_label, width && height ? width + '\u00d7' + height + (dpr && dpr !== 1 ? ' @' + dpr + 'x' : '') : '\u2014'],
        ['timezone', dwords.timezone_label, zone || '\u2014'],
        ['region', dwords.region_card_label, regionLine(device)],
        ['fonts', dwords.fonts_label, device.fonts === 'windows' ? 'Windows' : device.fonts === 'custom' ? dwords.source_custom : '\u2014'],
      ];
      const chips = [['canvas', 'Canvas', reported('canvas-readback') !== undefined], ['webgl', 'WebGL', reported('webgl-readback') !== undefined], ['audio', 'Audio', reported('audio-fingerprint') !== undefined], ['math', 'Math', reported('math-transcendentals') !== undefined]];
      return h('section', { class: 'fp-device-card', 'data-profile-device-card': true, children: [
        h('div', { class: 'fp-device-card__head', children: [h(Icon, { name: 'device', size: 18 }), dwords.preview_title] }),
        antidetectOn ? null : h('div', { class: 'fp-device-card__off', role: 'status', 'data-profile-master-off': true, children: [h('span', { children: dwords.master_off_note }), onEnable ? h('button', { type: 'button', class: 'button button--primary', disabled: busy, onClick: onEnable, 'data-profile-master-enable': true, children: dwords.master_enable }) : null] }),
        ...rows.map(([icon, key, value]) => h('div', { class: 'fp-device-card__row', key: key + icon, children: [h('span', { class: 'fp-device-card__key', children: [h(Icon, { name: icon, size: 15 }), key] }), typeof value === 'string' ? h('span', { dir: 'ltr', children: value }) : value] })),
        h('div', { class: 'fp-device-card__chips', 'data-profile-chips': true, children: [
          ...chips.map(([id, name, on]) => h('span', { class: 'fp-chip' + (on ? ' is-on' : ''), key: id, 'data-profile-chip': id, 'data-state': on ? 'on' : 'off', children: [name, h('b', { children: on ? dwords.value_on : dwords.value_off })] })),
          h('span', { class: 'fp-chip is-uncovered', key: 'rects', 'data-profile-chip': 'client-rects', 'data-state': 'uncovered', children: ['Client Rects', h('b', { children: dwords.coverage_uncovered })] })] }),
        h('p', { class: 'fp-device-card__note', children: dwords.preview_reported_note }),
        h('ul', { class: 'fp-device-card__disclosures', 'data-profile-disclosures': true, children: [dwords.disclose_ip, dwords.disclose_tls, dwords.disclose_engine, dwords.disclose_headers].map((text, index) => h('li', { key: index, children: h('span', { children: text }) })) })
      ] });
    }
    // ADR-107 hint cards: the severity as a word and an icon (never colour alone), the message, «claimed / this browser» when the
    // snapshot has the fact, the rows involved and the actions — Show (the control on another level), Fix (the generator's repair as a
    // preview), Update the claim (engine version) and Fit the window (screen and window hints). Repairs are computed once per draft.
    const WINDOW_CODES = new Set(['screen-vs-real', 'window-bounds', 'window-chrome', 'media-geometry']);
    const memoRepair = (key, compute) => { const cache = derived.current.repairs ??= new Map(); if (!cache.has(key)) cache.set(key, compute()); return cache.get(key); };
    const fieldCaption = field => ({ cpu: dwords.cpu_label, ram: dwords.ram_label, disk: dwords.disk_label, screen: dwords.screen_label, gpu: dwords.gpu_label, os: dwords.os_label, region: dwords.region_label, language: t('language'), timezone: dwords.timezone_label, fonts: dwords.fonts_label, browser: dwords.browser_family_label, version: dwords.browser_version_label, canvas: 'Canvas', webgl: 'WebGL', audio: 'Audio' })[field] ?? field;
    function issueCard(issue, index, inField) {
      const severity = issue.severity === 'info' ? 'info' : 'warning', environment = environmentOf(), device = describeDevice(reported), key = issue.code + ':' + (issue.ids ?? []).join(',');
      const explain = explainIssue(issue.code, device, environment, dwords), target = issueTarget(issue);
      // The engine-version repair is the retarget itself: it gets the one, more specific button.
      const retarget = issue.code === 'engine-version' ? memoRepair('retarget', () => repair('retargetIdentityVersion', draft, environment)) : null;
      const fix = issue.code === 'engine-version' ? null : memoRepair('fix:' + key, () => repair('issueFix', draft, issue, environment));
      const fitTarget = WINDOW_CODES.has(issue.code) ? memoRepair('fit', () => repair('fitWindowTarget', draft, environment)) : null;
      const retargetVersion = retarget ? describeDevice(customValueOf(retarget.configuration ?? draft)).version ?? environment.uaMajor : null;
      const showable = !inField && target !== null && (target.level === view || typeof onNavigate === 'function');
      const button = (attribute, text, onClick, ariaLabel) => h('button', { type: 'button', class: 'button button--text fp-issue__action', disabled: busy, 'aria-label': ariaLabel, ['data-profile-issue-' + attribute]: issue.code, onClick, children: text });
      return h('li', { key, class: 'fp-issue fp-issue--' + severity, 'data-profile-issue': issue.code, 'data-severity': severity, children: [
        h('span', { class: 'fp-issue__severity', children: [h(Icon, { name: severity, size: 15 }), h('span', { children: dwords['severity_' + severity] })] }),
        h('span', { class: 'fp-issue__message', 'data-profile-issue-message': true, children: fillIssueDetail(issueMessage(issue.code, dwords, translate), issue, locale) }),
        explain ? h('span', { class: 'fp-issue__explain', 'data-profile-issue-explain': issue.code, children: [h('bdi', { children: dwords.explain_claimed.replace('{value}', () => explain.claimed) }), ' · ', h('bdi', { children: dwords.explain_real.replace('{value}', () => explain.real) })] }) : null,
        issue.ids?.length ? h('span', { class: 'fp-issue__rows', children: [h('span', { class: 'fingerprint-visually-hidden', children: dwords.issue_rows + ': ' }), h('code', { dir: 'ltr', 'data-profile-issue-rows': true, children: issue.ids.join(', ') })] }) : null,
        showable || fix || retarget || fitTarget ? h('span', { class: 'fp-issue__actions', children: [
          showable ? button('show', dwords.issue_show, () => showIssue(issue), dwords.issue_show + ': ' + fieldCaption(target.field)) : null,
          fix ? button('fix', issue.code === 'proxy-country-region' ? dwords.issue_match_region : dwords.issue_fix, () => applyRepair(fix), target ? (issue.code === 'proxy-country-region' ? dwords.issue_match_region : dwords.issue_fix) + ': ' + fieldCaption(target.field) : undefined) : null,
          retarget && retargetVersion ? button('retarget', dwords.retarget_button.replace('{version}', String(retargetVersion)), () => applyRepair(retarget)) : null,
          fitTarget ? button('fit', dwords.fit_window_button, () => fitWindow(fitTarget)) : null] }) : null,
        fitTarget ? h('span', { class: 'fp-issue__note', children: [dwords.fit_window_note, windowNote ? ' ' + windowNote : ''] }) : null
      ] });
    }
    // `list` is the whole list on the quick view and only the hints no control of this level owns on a level view.
    const issuesNode = (list = issues) => list.length ? h('ul', { class: 'fingerprint-issues', 'data-profile-issues': true, children: list.map((issue, index) => issueCard(issue, index, false)) }) : null;
    // The hints a control owns, right under it; the control points at them with aria-describedby.
    const fieldIssueId = field => 'fp-issues-' + field;
    function fieldIssues(placement, field) {
      const list = placement.byField.get(field); if (!list?.length) return null;
      return h('ul', { id: fieldIssueId(field), class: 'fingerprint-issues fp-field-issues', 'data-profile-field-issues': field, children: list.map((issue, index) => issueCard(issue, index, true)) });
    }
    const describedBy = (placement, field) => placement.byField.get(field)?.length ? fieldIssueId(field) : undefined;
    // Quick form only: the version picked for the next generation differs from this browser's real engine version.
    const realMajor = saved?.environment?.uaMajor, engineNote = view === 'quick' && Number.isSafeInteger(realMajor) && Number(version) !== realMajor ? h('p', { class: 'fingerprint-note', 'data-profile-hint': 'engine-version', children: issueMessage('engine-version', dwords, translate) }) : null;
    // ADR-107: Apply stays focusable and says why it cannot run (aria-disabled plus a visible reason); warnings never block it, they
    // are only counted. The service worker refuses Custom rows while user scripts are not allowed, so that case is named up front.
    // Mirrors the service worker's refusal (api-configuration-controller set): the applied part (everything but the library) changes
    // and a master is on with a Custom row globally or on an enabled site. The worker still decides; this only names it up front.
    const scriptsMissing = Boolean(saved) && saved.earlyAccess !== 'ready' && saved.earlyAccess !== 'unsupported';
    const appliedPart = configuration => JSON.stringify({ ...configuration, fingerprintProfiles: [] });
    const activeCustom = configuration => (configuration.enabled || configuration.antidetectEnabled) && [configuration.apis, ...configuration.sites.filter(site => !site.disabled).map(site => site.apis)].some(rows => rows.some(row => row.mode === 'custom'));
    const scriptsBlocked = scriptsMissing && dirty && Boolean(draft) && activeCustom(draft) && appliedPart(draft) !== appliedPart(saved.configuration);
    const applyBlocked = locked || !dirty || scriptsBlocked;
    // The parent's own lock (its pending network draft, an unverified saved state or a running action) uses its wording.
    const parentWords = antidetectEditorLabels(locale);
    const parentReason = disabled ? ({ 'network-dirty': dwords.reason_parent, unverified: parentWords.reasonUnverified, busy: parentWords.reasonBusy })[disabledReason] ?? '' : '';
    const applyReason = !saved || !draft || busy ? '' : stale ? translate('antidetect_changed_external') : !dirty ? dwords.reason_no_changes : parentReason || (scriptsBlocked ? dwords.reason_scripts : '');
    const warnedFields = new Set(issues.filter(issue => issue.severity !== 'info').map(issue => issueTarget(issue)?.field).filter(Boolean)).size;
    const applyNow = () => { if (applyBlocked) return false; void commit(draftRef.current); return true; };
    const applyButton = (attribute, className, children) => h('button', { type: 'button', class: className, 'aria-disabled': applyBlocked, 'aria-describedby': applyReason ? 'fp-apply-reason' : undefined, title: applyReason || undefined, onClick: applyNow, ['data-profile-' + attribute]: true, 'data-tour': attribute === 'apply' ? 'apply' : undefined, children });
    const footerNode = (withRefresh = false) => h('footer', { class: 'fingerprint-footer', children: [h('p', { class: 'fingerprint-note', role: 'status', 'data-profile-notice': true, children: notice ? translate(notice) : dirty ? t('preview_ready') : '' }),
      h('div', { class: 'fp-apply-reasons', children: [h('p', { class: 'fp-apply-reason', id: 'fp-apply-reason', 'data-profile-apply-reason': true, children: applyReason }), warnedFields ? h('p', { class: 'fp-apply-reason fp-apply-reason--fields', 'data-profile-warned-fields': warnedFields, children: dwords.reason_fields.replace('{count}', String(warnedFields)) }) : null] }),
      h('div', { class: 'fingerprint-toolbar', children: [withRefresh ? h('button', { type: 'button', class: 'button', disabled: busy || dirty, onClick: refresh, 'data-profile-refresh': true, children: editor('refresh') }) : null, h('button', { type: 'button', class: 'button', disabled: busy || !dirty, onClick: cancel, 'data-profile-cancel': true, children: editor('cancel') }), applyButton('apply', 'button button--primary', t('apply'))] })] });
    // A stepped slider has fixed positions only; «Авто» means the row is not overridden (the native value is reported).
    // ADR-107: in the Auto state the value reads «As in the browser · <real value>» and the thumb sits on the step nearest to the
    // real value (`extra.real`, from the snapshot; without it the middle step as before); the reset button is named after its control.
    const nearestStep = (steps, value) => steps.reduce((best, step, index) => Math.abs(step - value) < Math.abs(steps[best] - value) ? index : best, 0);
    function stepSlider(key, caption, hint, steps, current, format, onPick, readout = null, icon = null, extra = {}) {
      const auto = current === null || current === undefined, exact = auto ? -1 : steps.indexOf(current), real = extra.real;
      const nearest = auto || exact >= 0 || typeof current !== 'number' ? exact : nearestStep(steps, current);
      const realIndex = auto && real !== undefined && real !== null ? (extra.realIndex ?? (typeof real === 'number' ? nearestStep(steps, real) : steps.indexOf(real))) : -1;
      const position = auto ? realIndex >= 0 ? realIndex : Math.floor((steps.length - 1) / 2) : Math.max(0, nearest), ratio = steps.length > 1 ? position / (steps.length - 1) : 0;
      const shown = auto ? browserValue(real === undefined || real === null ? null : (extra.formatReal ?? format)(real)) : format(exact >= 0 ? steps[exact] : current), inputId = 'fp-slider-' + key;
      return h('div', { class: 'fp-slider' + (auto ? ' is-auto' : ''), 'data-profile-slider': key, children: [
        h('div', { class: 'fp-slider__head', children: [
          h('label', { class: 'fp-slider__label', for: inputId, children: [icon ? h('span', { class: 'fp-slider__icon', 'aria-hidden': true, children: h(Icon, { name: icon, size: 16 }) }) : null, caption] }),
          extra.source ?? null,
          h('output', { class: 'fp-slider__value', for: inputId, 'data-profile-slider-value': key, dir: 'ltr', children: shown }),
          auto ? null : h('button', { type: 'button', class: 'button button--text fp-slider__reset', disabled: busy, 'aria-label': dwords.value_auto + ': ' + caption, 'data-profile-slider-reset': key, onClick: () => onPick(null), children: dwords.value_auto })] }),
        h('div', { class: 'fp-slider__track', style: '--fp-ratio:' + ratio.toFixed(4), 'aria-hidden': true, children: steps.map((_, index) => h('span', { class: 'fp-slider__tick', key: index })) }),
        h('input', { type: 'range', class: 'fp-slider__input', id: inputId, min: 0, max: steps.length - 1, step: 1, value: position, disabled: busy || extra.locked === true, 'data-locked': extra.locked === true ? true : undefined, 'aria-valuetext': shown, 'aria-describedby': [inputId + '-hint', extra.describedBy].filter(Boolean).join(' '), ['data-profile-slider-' + key]: true,
          onInput: event => { if (!busy) onPick(steps[Number(event.currentTarget.value)]); },
          onClick: () => { if (auto && !busy) onPick(steps[position]); } }),
        h('div', { class: 'fp-slider__scale', 'aria-hidden': true, children: [h('bdi', { key: 'min', children: format(steps[0]) }), h('bdi', { key: 'max', children: format(steps[steps.length - 1]) })] }),
        // The hint and what a card adds under it (field hints, the window button) share one cell, so the rails of neighbouring cards line up whatever their texts weigh.
        h('div', { class: 'fp-slider__tail', children: [h('p', { class: 'fp-slider__hint', id: inputId + '-hint', children: [hint, readout ? h('code', { class: 'fp-slider__readout', dir: 'ltr', children: readout }) : null] }), ...(extra.tail ?? [])] })
      ] });
    }
    const coverageRow = (status, text) => h('p', { class: 'fingerprint-note', 'data-profile-coverage': true, children: [h('span', { class: 'fingerprint-pill', children: status }), ' ', text] });
    const diskText = value => value >= 1024 ? (value / 1024) + ' TB' : value + ' GB';
    function deviceControls(device, type, placement) {
      const environment = environmentOf();
      const ram = ramImage !== null && reportedDeviceMemory(ramImage) === device.reportedMemory ? ramImage : ramImageFromReported(device.reportedMemory, type);
      const gpus = gpusFor(type), currentGpu = GPU_PRESETS.find(entry => entry.id === device.gpu); if (currentGpu && !gpus.includes(currentGpu)) gpus.push(currentGpu);
      const screens = screensFor(type), currentScreen = SCREEN_PRESETS.find(entry => entry.id === device.screen); if (currentScreen && !screens.includes(currentScreen)) { screens.push(currentScreen); screens.sort((a, b) => a.width - b.width); }
      // The real screen sits on the closest rung by area; the value itself is shown as measured.
      const realScreen = environment.screen?.width && environment.screen?.height ? environment.screen : null;
      const realScreenIndex = realScreen ? screens.reduce((best, entry, index) => Math.abs(entry.width * entry.height - realScreen.width * realScreen.height) < Math.abs(screens[best].width * screens[best].height - realScreen.width * realScreen.height) ? index : best, 0) : undefined;
      const fit = memoRepair('fit', () => repair('fitWindowTarget', draft, environment));
      return {
        lead: [segmented('device-type', dwords.device_type_label, type, chooseDeviceType, typeOptions())],
        grid: [
          stepSlider('cpu', dwords.cpu_label, dwords.cpu_hint, CPU_STEPS, device.cores, value => String(value), value => stagePatch({ cores: value }), device.cores !== null ? 'hardwareConcurrency = ' + device.cores : null, 'cpu', { real: environment.hardwareConcurrency, source: sourceChip('cpu', device), describedBy: describedBy(placement, 'cpu'), tail: [fieldIssues(placement, 'cpu')] }),
          stepSlider('ram', dwords.ram_label, dwords.ram_hint, RAM_STEPS, ram, value => value + ' GB', value => { if (value !== null) setRamImage(value); stagePatch({ ramGb: value }); }, device.reportedMemory !== null ? 'navigator.deviceMemory = ' + device.reportedMemory : null, 'ram', { real: environment.deviceMemory, source: sourceChip('ram', device), describedBy: describedBy(placement, 'ram'), tail: [fieldIssues(placement, 'ram')] }),
          stepSlider('disk', dwords.disk_label, dwords.disk_hint, DISK_STEPS, device.diskGb, diskText, value => stagePatch({ diskGb: value }), device.diskGb !== null ? 'storage.estimate().quota ≈ ' + Math.round(reportedStorageQuota(device.diskGb).quota / 1024 ** 3) + ' GiB' : null, 'disk', { source: sourceChip('disk', device), describedBy: describedBy(placement, 'disk'),
            // ADR-107: Chrome reports one quota shape on any disk, so a Chromium claim keeps it native and the slider has nothing to set.
            locked: device.diskGb === null && chromiumIdentity(reported('navigator-user-agent'), environment), tail: [fieldIssues(placement, 'disk')] }),
          stepSlider('screen', dwords.screen_label, dwords.screen_hint, screens.map(entry => entry.id), device.screen, id => id.replace('x', ' × '), id => stagePatch({ screen: id }), null, 'monitor', { real: realScreen ? realScreen.width + 'x' + realScreen.height : undefined, realIndex: realScreenIndex, formatReal: value => value.replace('x', ' × '), source: sourceChip('screen', device), describedBy: describedBy(placement, 'screen'), tail: [
            fit ? h('div', { class: 'fp-fit', children: [h('button', { type: 'button', class: 'button', disabled: busy, 'data-profile-fit-window': true, onClick: () => fitWindow(fit), children: dwords.fit_window_button }), h('p', { class: 'fingerprint-note', children: [dwords.fit_window_note, windowNote ? ' ' + windowNote : ''] })] }) : null, fieldIssues(placement, 'screen')] })],
        form: [
          formSelect('level-gpu', dwords.gpu_label, device.gpu ?? '', value => stagePatch({ gpu: value || null }), gpuOptions(gpus), { id: controlId('gpu'), source: sourceChip('gpu', device), describedBy: ['fp-gpu-help', describedBy(placement, 'gpu')].filter(Boolean).join(' ') }),
          h('p', { class: 'fingerprint-note', id: 'fp-gpu-help', 'data-profile-gpu-help': true, children: dwords.gpu_real_help }),
          fieldIssues(placement, 'gpu'),
          h('p', { class: 'fingerprint-note', children: dwords.gpu_hint }),
          coverageRow(dwords.coverage_partial, dwords.uncovered_webgpu)]
      };
    }
    // Language options read in the UI language («German (Germany) · de-DE»); the first one is this browser's own language.
    const languageOptions = list => list.map(id => [id, id === 'preserve' ? browserValue(environmentOf().language ? languageLabel(environmentOf().language, locale) : null) : languageLabel(id, locale)]);
    function osControls(device, placement) {
      const environment = environmentOf(), fonts = device.fonts === 'windows' ? 'windows' : device.fonts === 'custom' ? 'custom' : 'native';
      // A region writes its own locale, which may be outside the generator list: show it instead of a blank select.
      const languages = !device.language || FINGERPRINT_LANGUAGES.includes(device.language) ? FINGERPRINT_LANGUAGES : [...FINGERPRINT_LANGUAGES, device.language];
      const region = currentRegion(device), regionResults = searchRegions(regionPicker(locale).list, regionQuery), realZone = environment.timeZone, realRegion = realZone ? regionOfTimeZone(realZone) : null;
      return {
        lead: [], grid: [],
        form: [
          segmented('level-os', dwords.os_label, device.os ?? os, value => { setOs(value); stagePatch({ os: value }); }, osOptions(), { id: controlId('os'), source: sourceChip('os', device), describedBy: describedBy(placement, 'os'), tour: 'hints' }),
          fieldIssues(placement, 'os'),
          h('div', { class: 'fingerprint-form-row', 'data-tour': 'region', children: [labelWithSource(dwords.region_label, sourceChip('region', device)), h('div', { class: 'fp-combobox-row', children: [regionBox(region, regionResults, { id: controlId('region'), describedBy: describedBy(placement, 'region'), placeholder: browserValue(realRegion ? regionName(locale, realRegion) : null) }), region || device.geolocation ? h('button', { type: 'button', class: 'button button--text', disabled: busy, 'aria-label': dwords.value_auto + ': ' + dwords.region_label, 'data-profile-region-reset': true, onClick: () => chooseRegion(null), children: dwords.value_auto }) : null] })] }),
          fieldIssues(placement, 'region'),
          h('p', { class: 'fingerprint-note', 'data-profile-region-hint': true, children: dwords.region_hint }),
          formSelect('level-language', t('language'), device.language ?? 'preserve', value => stagePatch({ language: value === 'preserve' ? null : value }), languageOptions(languages), { id: controlId('language'), source: sourceChip('language', device), describedBy: describedBy(placement, 'language') }),
          fieldIssues(placement, 'language'),
          h('div', { class: 'fingerprint-form-row', children: [labelWithSource(dwords.timezone_label, sourceChip('timezone', device)), h('div', { class: 'fp-combobox-row', children: [timezoneBox(device.timezone, zone => stagePatch({ timezone: zone }), { id: controlId('timezone'), describedBy: describedBy(placement, 'timezone'), placeholder: browserValue(realZone) }), device.timezone ? h('button', { type: 'button', class: 'button button--text', disabled: busy, 'aria-label': dwords.value_auto + ': ' + dwords.timezone_label, 'data-profile-timezone-reset': true, onClick: () => stagePatch({ timezone: null }), children: dwords.value_auto }) : null] })] }),
          fieldIssues(placement, 'timezone'),
          h('p', { class: 'fingerprint-note', children: dwords.timezone_hint }),
          segmented('fonts', dwords.fonts_label, fonts, value => stagePatch({ fonts: value === 'windows' ? 'windows' : null }), [['native', dwords.value_browser], ['windows', 'Windows']], { id: controlId('fonts'), source: sourceChip('fonts', device), describedBy: describedBy(placement, 'fonts') }),
          fieldIssues(placement, 'fonts'),
          h('p', { class: 'fingerprint-note', children: dwords.fonts_hint }),
          coverageRow(dwords.coverage_partial, dwords.uncovered_fonts_metrics)]
      };
    }
    function browserControls(device, placement) {
      const gpuLabel = GPU_PRESETS.find(entry => entry.id === device.gpu)?.label ?? dwords.gpu_real_option + (realGpuName() ? ' · ' + realGpuName() : '');
      const protect = (key, id, caption) => [segmented('protect-' + key, caption, reported(id) !== undefined ? 'on' : 'off', value => stagePatch({ [key]: value === 'on' }), [['off', dwords.value_off], ['on', dwords.value_on]], { id: controlId(key), source: sourceChip(key, device), describedBy: describedBy(placement, key) }), fieldIssues(placement, key)];
      // ADR-107: one click moves the claimed version to this browser's own (the generator's retarget helper), as a preview.
      const retarget = memoRepair('retarget', () => repair('retargetIdentityVersion', draft, environmentOf()));
      const retargetVersion = retarget ? describeDevice(customValueOf(retarget.configuration ?? draft)).version ?? environmentOf().uaMajor : null;
      return {
        lead: [], grid: [],
        form: [
          segmented('level-browser', dwords.browser_family_label, device.browser ?? browser, value => { setBrowser(value); stagePatch({ browser: value }); }, browserOptions(), { id: controlId('browser'), source: sourceChip('browser', device), describedBy: describedBy(placement, 'browser') }),
          fieldIssues(placement, 'browser'),
          formSelect('level-version', dwords.browser_version_label, String(device.version ?? version), value => { setVersion(Number(value)); stagePatch({ version: Number(value) }); }, browserVersions().map(value => [String(value), String(value)]), { id: controlId('version'), source: sourceChip('version', device), describedBy: describedBy(placement, 'version') }),
          retarget && retargetVersion ? h('div', { class: 'fp-retarget', children: h('button', { type: 'button', class: 'button', disabled: busy, 'data-profile-retarget': true, onClick: () => applyRepair(retarget), children: dwords.retarget_button.replace('{version}', String(retargetVersion)) }) }) : null,
          fieldIssues(placement, 'version'),
          h('div', { class: 'fingerprint-form-row', children: [h('span', { class: 'fingerprint-form-label', children: 'User-Agent' }), h('code', { dir: 'ltr', 'data-profile-ua': true, children: reported('navigator-user-agent') ?? '—' })] }),
          h('div', { class: 'fingerprint-form-row', children: [h('span', { class: 'fingerprint-form-label', children: dwords.gpu_label }), h('span', { dir: 'ltr', 'data-profile-webgl-gpu': true, children: gpuLabel })] }),
          ...protect('canvas', 'canvas-readback', 'Canvas'), ...protect('webgl', 'webgl-readback', 'WebGL'), ...protect('audio', 'audio-fingerprint', 'Audio'),
          coverageRow(dwords.coverage_partial, dwords.uncovered_webgpu),
          coverageRow(dwords.coverage_uncovered, dwords.uncovered_clientrects)]
      };
    }
    function levelBody(placement) {
      const device = describeDevice(reported), type = deviceType;
      const [icon, title, sub] = { device: ['device', dwords.level_device_title, dwords.level_device_sub], os: [device.os === 'windows-10' ? 'windows-10' : 'windows-11', dwords.level_os_title, dwords.level_os_sub], browser: [device.browser === 'edge' ? 'edge' : 'chrome', dwords.level_browser_title, dwords.level_browser_sub] }[view];
      const controls = view === 'device' ? deviceControls(device, type, placement) : view === 'os' ? osControls(device, placement) : browserControls(device, placement);
      return h('section', { class: 'antidetect-level', 'data-profile-level': view, children: [
        h('div', { class: 'antidetect-level__header', children: [h('span', { class: 'antidetect-level__icon', children: h(Icon, { name: icon, size: 20 }) }), h('h3', { class: 'antidetect-level__title', children: title }), h('p', { class: 'antidetect-level__sub', children: sub })] }),
        controls.lead.length ? h('div', { class: 'fingerprint-form', children: controls.lead }) : null,
        controls.grid.length ? h('div', { class: 'antidetect-level__grid', children: controls.grid }) : null,
        controls.form.length ? h('div', { class: 'fingerprint-form', children: controls.form }) : null,
        // Only the hints no control of this level owns stay in the list below.
        issuesNode(placement.rest),
        footerNode(true)
      ] });
    }
    function overview(caption, value, attributes = {}) { return h('div', { class: 'fingerprint-summary__row', ...attributes, children: [h('dt', { children: caption }), h('dd', { children: value })] }); }
    const onOff = value => h('span', { class: 'fingerprint-pill' + (value ? ' fingerprint-pill--ok' : ''), children: value ? dwords.value_on : dwords.value_off });
    // ADR-107: the library hooks belong to this panel, so it is called once per render, unconditionally; it returns [card slot, library].
    const temporaryOffered = controller.current.temporary.available();
    const library = FingerprintLibrary({ visible: view === 'quick' && Boolean(saved && draft), saved, draft, savedRef, draftRef, statuses, busy, locked, dirty, commit, stage, setError, safeError, card: deviceCard, onRandomize: randomize, onImport: () => input.current?.click(),
      trash: controller.current.trash, bundles: controller.current.bundles, proxies: controller.current.proxies, onTemporary: temporaryOffered ? temporaryFromProfile : null });
    // ADR-107: after «Keep my changes» the rows both sides changed come first and are marked; a site conflict marks every site row.
    const isConflict = row => conflicts.length > 0 && (row.scope === 'global' ? conflicts.includes(row.id ?? row.field) : conflicts.includes('sites'));
    const ordered = conflicts.length ? [...changed.filter(isConflict), ...changed.filter(row => !isConflict(row))] : changed;
    const pages = Math.max(1, Math.ceil(ordered.length / 64)), page = Math.min(changePage, pages - 1), shown = ordered.slice(page * 64, (page + 1) * 64);
    // ADR-103 mode names and order (inherit, allow, block, custom), as on the API page.
    const modeWords = redesignLabels(locale), modeName = mode => ({ bypass: modeWords.modeInherit, off: modeWords.modeAllow, on: modeWords.modeBlock, custom: modeWords.modeCustom })[mode] ?? mode;
    const changeName = row => row.id ? label({ id: row.id }) : row.field === 'enabled' ? 'API Guard' : row.field === 'antidetectEnabled' ? editor('master') : row.field === 'fingerprintProfiles' ? t('library') : row.field === 'webrtcNetworkPolicy' ? translate('protection_webrtc_network_title') : row.field === 'site' ? row.scope : editor('preset');
    // One change: the row, then «before → after» (the words are read by screen readers, the arrow follows the text direction).
    function changeItem(row, index) {
      const conflict = isConflict(row);
      return h('li', { key: page * 64 + index, class: 'fp-change' + (conflict ? ' is-conflict' : ''), 'data-profile-change': [row.scope, row.id ?? '', row.field].join(':'), 'data-profile-change-conflict': conflict ? true : undefined, children: [
        h('code', { dir: 'ltr', children: row.id ?? row.field }),
        h('span', { children: conflict ? [changeName(row), h('span', { class: 'fp-change__conflict', 'data-profile-change-conflict-mark': true, children: [h(Icon, { name: 'warning', size: 14 }), dwords.change_conflict] })] : changeName(row) }),
        h('span', { class: 'fp-change__values', children: [
          h('span', { class: 'fingerprint-visually-hidden', children: dwords.change_before + ': ' }),
          h('code', { dir: 'ltr', class: 'fp-change__before', 'data-profile-change-before': true, children: formatChange(row.before) }),
          h('span', { class: 'fp-change__arrow', 'aria-hidden': true, children: '→' }),
          h('span', { class: 'fingerprint-visually-hidden', children: ' ' + dwords.change_after + ': ' }),
          h('code', { dir: 'ltr', class: 'fp-change__after', 'data-profile-change-after': true, children: formatChange(row.after) })] })] });
    }
    const entry = API_CONFIG_CATALOG.find(row => row.id === selectedApi), kinds = ['unset', ...(entry?.customSupported ? ['value', ...(entry.allowNull ? ['null'] : []), ...(entry.allowUndefined ? ['undefined'] : [])] : [])];
    const needsScripts = Boolean(saved) && saved.earlyAccess !== 'ready' && saved.earlyAccess !== 'unsupported';
    // Block rows only act while the API Guard master is on (api-custom-registration.js): say so instead of letting Strict look active.
    const parked = draft && !draft.enabled ? draft.apis.filter(row => row.mode === 'on').length : 0;
    // Pending changes can always be applied or cancelled from here, without scrolling to the library footer.
    function actionBar() {
      if (!saved || !draft) return null;
      const blocked = needsScripts && (error === 'antidetect_early_required' || dirty && draft.antidetectEnabled);
      const state = stale ? 'stale' : blocked ? 'early' : dirty ? 'dirty' : null; if (!state) return null;
      const count = new Set(changed.filter(row => row.id).map(row => row.id)).size;
      const copy = state === 'stale' ? [translate('antidetect_changed_external'), ''] : state === 'early' ? (saved.earlyAccess === 'browser-toggle-required' ? [dwords.early_blocked_title, dwords.early_blocked_steps] : [translate('antidetect_early_required'), '']) : [dwords.bar_pending + (count ? ' \u00b7 ' + count : ''), dwords.bar_hint];
      const button = (attribute, text, onClick, inactive, primary = false) => h('button', { type: 'button', class: 'button' + (primary ? ' button--primary' : ''), disabled: inactive, onClick, ['data-profile-bar-' + attribute]: true, children: text });
      return h('div', { class: 'fp-actionbar fp-actionbar--' + state, role: 'region', 'aria-label': dwords.bar_label, 'data-profile-bar': state, children: [
        h('span', { class: 'fp-actionbar__icon', 'aria-hidden': true, children: h(Icon, { name: state === 'dirty' ? 'preview' : 'warning', size: 19 }) }),
        h('div', { class: 'fp-actionbar__text', role: 'status', children: [h('strong', { children: copy[0] }), copy[1] ? h('span', { children: copy[1] }) : null] }),
        // ADR-107: on a real conflict «Keep my changes» lays my rows onto the newer revision as a new preview; «Discard» drops them.
        h('div', { class: 'fp-actionbar__buttons', children: state === 'stale' ? [button('keep', dwords.keep_mine, keepMine, busy, true), button('discard', dwords.stale_discard, discardAndRefresh, busy)] : [
          state === 'early' ? button('settings', translate(saved.earlyAccess === 'permission-required' ? 'antidetect_grant_early' : 'antidetect_early_settings'), grantScripts, busy) : null,
          state === 'early' ? button('recheck', dwords.early_recheck, () => rebase(false), busy) : null,
          dirty ? button('cancel', dwords.bar_cancel, cancel, busy) : null,
          dirty ? applyButton('bar-apply', 'button button--primary', dwords.bar_apply) : null] })
      ] });
    }
    // ADR-107 round 5: the banner is shown in every view (quick setup, device, OS, browser) while a temporary profile is active.
    function temporaryBanner() {
      if (!temporary.active) return null;
      const name = temporary.label || iw.tempGenerated, parts = iw.tempBanner.split('{name}'), blocked = busy || locked || dirty;
      const inLibrary = [...statuses.values()].includes('applied');
      const button = (attribute, caption, onClick, primary) => h('button', { type: 'button', class: 'button' + (primary ? ' button--primary' : ''), 'aria-disabled': blocked, 'aria-describedby': dirty ? 'fp-temporary-reason' : undefined, ['data-profile-temporary-' + attribute]: true, onClick: () => { if (!blocked) onClick(); }, children: caption });
      return h('section', { class: 'fp-temporary', role: 'region', 'aria-label': iw.tempEnd, 'data-profile-temporary': true, children: [
        h('span', { class: 'fp-temporary__icon', 'aria-hidden': true, children: h(Icon, { name: 'info', size: 19 }) }),
        h('div', { class: 'fp-temporary__text', role: 'status', children: [
          h('strong', { 'data-profile-temporary-text': true, children: parts.flatMap((part, index) => index ? [h('bdi', { key: 'name' + index, children: name }), part] : [part]) }),
          h('span', { 'data-profile-temporary-keys': true, children: iw.tempKeys }),
          dirty ? h('span', { id: 'fp-temporary-reason', 'data-profile-temporary-reason': true, children: iw.tempDirty }) : null] }),
        h('div', { class: 'fp-temporary__buttons', children: [!inLibrary ? button('save', iw.tempSave, () => { void saveTemporaryToLibrary(); }, false) : null, button('end', iw.tempEnd, () => { void endTemporary(); }, true)] })] });
    }
    // The preview lists the library profiles that applying this state would add, change or remove, with their tags and note (an import
    // shows them before anything is written).
    function libraryChangesNode() {
      if (!saved || !draft) return null;
      const entries = derived.current.libraryChanges ??= (() => {
        const before = new Map(saved.configuration.fingerprintProfiles.map(profile => [profile.id, profile])), after = new Map(draft.fingerprintProfiles.map(profile => [profile.id, profile])), found = [];
        for (const [id, profile] of after) { const old = before.get(id); if (!old) found.push(['new', profile]); else if (!same(old, profile)) found.push(['changed', profile]); }
        for (const [id, profile] of before) if (!after.has(id)) found.push(['removed', profile]);
        return found;
      })();
      if (!entries.length) return null;
      const shown = entries.slice(0, CHANGES_LISTED), more = entries.length - shown.length, kindWord = { new: iw.libraryNew, changed: iw.libraryChanged, removed: iw.libraryRemoved };
      const excerpt = note => { const clip = Array.from(note).slice(0, NOTE_EXCERPT).join(''); return clip.length < note.length ? clip + '\u2026' : clip; };
      return h('section', { class: 'fingerprint-library-changes', 'aria-label': iw.libraryChanges, 'data-profile-library-changes': entries.length, children: [
        h('h5', { class: 'fingerprint-peek__subtitle', children: iw.libraryChanges }),
        h('ul', { class: 'fingerprint-library-changes__list', children: shown.map(([kind, profile]) => h('li', { key: kind + profile.id, 'data-profile-library-change': kind, 'data-profile-library-change-id': profile.id, children: [
          h('span', { class: 'fingerprint-pill ' + (kind === 'removed' ? 'fingerprint-pill--warn' : 'fingerprint-pill--preview'), children: kindWord[kind] }),
          h('bdi', { class: 'fingerprint-library__name', children: profile.label }),
          (profile.tags ?? []).length ? h('span', { class: 'fingerprint-row__tags', 'data-profile-library-change-tags': true, children: profile.tags.map(tag => h('bdi', { key: tag, class: 'fingerprint-tag', children: tag })) }) : null,
          profile.note ? h('span', { class: 'fingerprint-library-changes__note', 'data-profile-library-change-note': true, children: excerpt(profile.note) }) : null] })) }),
        more > 0 ? h('p', { class: 'fingerprint-note', children: iw.libraryMore.replace('{n}', String(more)) }) : null] });
    }
    // The shared shortcut, leave guard and palette read these on demand (see the registrations above).
    applyRef.current = applyNow; dirtyRef.current = dirty;
    paletteRef.current = () => !saved || !draft ? [] : [
      { kind: 'randomize', run: randomize },
      ...(dirty && !applyBlocked ? [{ kind: 'apply-profile', run: () => { void commit(draftRef.current); } }] : []),
      { kind: 'export-profile', run: exportPreview }];
    return h('section', { class: 'fingerprint-profiles' + (view === 'quick' ? ' antidetect-card' : ''), ref: root, 'data-fingerprint-profile-panel': true, 'data-profile-panel': true, 'data-profile-parent-disabled': disabled, 'aria-busy': busy, children: [
      view !== 'quick' ? null : h('header', { class: 'fingerprint-header', children: [h('div', { children: [h('h3', { class: 'fingerprint-heading', children: [h('span', { class: 'fingerprint-icon', children: h(Icon, {}) }), dwords.quick_title] }), h('span', { class: 'fingerprint-scope', 'data-profile-scope': true, children: editor('global') })] }), h('button', { type: 'button', class: 'button', disabled: busy || dirty, onClick: refresh, 'data-profile-refresh': true, children: editor('refresh') })] }),
      temporaryBanner(),
      error ? h('p', { class: 'fingerprint-error', role: 'alert', 'data-profile-error': true, children: error.startsWith('dw:') ? dwords[error.slice(3)] : translate(error) }) : null,
      parked ? h('p', { class: 'fingerprint-warning', role: 'status', 'data-profile-parked-blocks': parked, children: dwords.blocks_parked + ' \u00b7 ' + parked }) : null,
      stale ? h('p', { class: 'fingerprint-warning', role: 'status', 'data-profile-stale': true, children: translate('antidetect_changed_external') }) : null,
      !saved || !draft ? h('p', { class: 'fingerprint-note', role: 'status', children: editor('loading') }) : view !== 'quick' ? levelBody(placeIssues(issues, view)) : [
        h('div', { class: 'fingerprint-generator', children: [
          h('p', { class: 'fingerprint-note', children: dwords.quick_sub }),
          presetButtons(),
          h('div', { class: 'fingerprint-form', children: [
            segmented('device-type', dwords.device_type_label, deviceType, chooseDeviceType, typeOptions()),
            segmented('os', dwords.os_label, os, setOs, osOptions()),
            segmented('browser', dwords.browser_family_label, browser, setBrowser, browserOptions()),
            formSelect('version', dwords.browser_version_label, String(version), value => setVersion(Number(value)), browserVersions().map(value => [String(value), String(value)])),
            engineNote,
            // In the generator an empty GPU or screen means «the generator draws one that fits this computer», not the real card.
            formSelect('gpu', dwords.gpu_label, gpu, setGpu, gpuOptions(gpusFor(deviceType), dwords.value_auto)),
            formSelect('screen', dwords.screen_label, screen, setScreen, [['', dwords.value_auto], ...screensFor(deviceType).map(entry => [entry.id, entry.id.replace('x', ' × ')])]),
            formSelect('language', t('language'), language, setLanguage, languageOptions(FINGERPRINT_LANGUAGES)),
          ] }),
          h('div', { class: 'fingerprint-form-row', children: [h('span', { class: 'fingerprint-form-label', children: dwords.timezone_label }), timezoneBox(timezone, setTimezone)] }),
          // ADR-110 addendum: only the Strict preset writes a font list, so the switch is locked in the others (its state is kept).
          segmented('font-noise', dwords.font_noise_label, fontNoise ? 'on' : 'off', value => setFontNoise(value === 'on'), [['off', dwords.value_off], ['on', dwords.value_on]], { id: 'fp-field-font-noise', describedBy: 'fp-font-noise-hint', locked: preset !== 'strict' }),
          h('p', { class: 'fingerprint-note', id: 'fp-font-noise-hint', 'data-profile-font-noise-hint': true, children: dwords.font_noise_hint }),
          h('div', { class: 'fingerprint-toolbar fingerprint-generator__actions', children: [h('button', { type: 'button', class: 'antidetect-randomize', disabled: busy, onClick: randomize, 'data-profile-generate': true, children: [h(Icon, { name: 'randomize', size: 17 }), dwords.randomize_button] }), dirty ? applyButton('apply-inline', 'antidetect-apply', [h(Icon, { name: 'preview', size: 17 }), t('apply')]) : null,
            temporaryOffered ? h('button', { type: 'button', class: 'button', 'aria-disabled': busy || locked || dirty, 'aria-describedby': dirty ? 'fp-temporary-new-reason' : undefined, onClick: () => { if (!(busy || locked || dirty)) newTemporaryIdentity(); }, 'data-profile-temporary-new': true, children: iw.tempNew }) : null,
            temporaryOffered && dirty ? h('span', { class: 'fingerprint-note', id: 'fp-temporary-new-reason', 'data-profile-temporary-new-reason': true, children: iw.tempDirty }) : null] }),
        ] }),
        h('div', { class: 'fp-quick-pair', children: library }),
        h('section', { class: 'fingerprint-preview', 'data-profile-preview': true, children: [heading(t('preview'), 'preview'), h('dl', { class: 'fingerprint-summary', children: [
            overview(editor('changed'), String(new Set(changed.filter(row => row.id).map(row => row.id)).size)),
            overview(translate('browser_debug_changes'), String(changed.length), { 'data-profile-changes-count': changed.length }),
            overview(editor('master'), onOff(draft.antidetectEnabled), { 'data-profile-antidetect-master': true }),
            overview('API Guard', onOff(draft.enabled), { 'data-profile-api-master': true }),
            overview(editor('format'), String(draft.formatVersion))
          ] }),
          libraryChangesNode(),
          h('div', { class: 'fingerprint-changes', role: 'region', tabIndex: 0, 'aria-label': translate('browser_debug_changes'), children: changed.length ? h('ul', { children: shown.map(changeItem) }) : h('p', { class: 'fingerprint-note', children: editor('noChanges') }) }),
          pages > 1 ? h('nav', { class: 'fingerprint-pagination', 'aria-label': translate('browser_debug_pages'), children: [h('button', { type: 'button', class: 'button', disabled: busy || page === 0, 'data-profile-previous': true, onClick: () => { if (!busy && page > 0) setChangePage(page - 1); }, children: translate('browser_debug_previous') }), h('span', { 'data-profile-change-page': true, children: (page + 1) + ' / ' + pages }), h('button', { type: 'button', class: 'button', disabled: busy || page + 1 >= pages, 'data-profile-next': true, onClick: () => { if (!busy && page + 1 < pages) setChangePage(page + 1); }, children: translate('browser_debug_next') })] }) : null,
          issuesNode(),
          h('details', { class: 'fingerprint-editor', children: [h('summary', { children: t('edit_api') }), h('div', { class: 'fingerprint-controls', children: [field('API', picker('api', selectedApi, id => { setSelectedApi(id); showApi(draft, id); }, API_CONFIG_CATALOG.map(row => [row.id, label(row) + ' · ' + row.id]))), field(translate('antidetect_mode'), picker('api-mode', apiMode, setApiMode, ['bypass', 'off', 'on', 'custom'].filter(mode => mode !== 'custom' || entry?.customSupported).filter(mode => mode !== 'on' || !API_CUSTOM_ONLY_IDS.includes(selectedApi)).map(mode => [mode, modeName(mode)]))), field(editor('valueType'), picker('value-kind', valueKind, setValueKind, kinds.map(kind => [kind, kind === 'value' ? editor('value') : kind === 'unset' ? editor('unset') : kind])))] }), valueKind === 'value' ? field('JSON', h('textarea', { value: valueJson, rows: 6, maxLength: 65536, dir: 'ltr', spellcheck: false, disabled: busy, 'data-profile-api-json': true, onInput: event => setValueJson(event.currentTarget.value) })) : null, h('button', { type: 'button', class: 'button', disabled: busy, onClick: editApi, 'data-profile-stage-api': true, children: t('stage_api') })] }),
          h('div', { class: 'fingerprint-toolbar fingerprint-transfer', children: [h('input', { type: 'file', accept: '.json,application/json', hidden: true, ref: input, onChange: readFile, 'data-profile-file': true }), h('button', { type: 'button', class: 'button', disabled: busy, onClick: () => input.current?.click(), 'data-profile-import': true, children: editor('import') }), h('button', { type: 'button', class: 'button', disabled: busy, onClick: exportPreview, 'data-profile-export': true, children: editor('export') })] }),
          exportText ? h('div', { class: 'fingerprint-export', children: [field(editor('previewExport'), h('textarea', { value: exportText, readOnly: true, rows: 7, dir: 'ltr', 'data-profile-export-json': true })), h('button', { type: 'button', class: 'button', onClick: download, 'data-profile-download': true, children: editor('download') })] }) : null,
          footerNode()
        ] })
      ],
      actionBar()
    ] });
  }
  return { FingerprintProfilePanel };
}
