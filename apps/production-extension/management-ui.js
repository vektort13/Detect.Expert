// ADR-055 / ADR-063: one local management window; panels reuse the existing authorized editors.
import { createBrowserDebugUi } from './browser-debug-ui.js';
import { createAntidetectUi, ANTIDETECT_CATEGORIES } from './antidetect-ui.js';
import { fingerprintDeviceLabels } from './fingerprint-device-labels.js';
import { collectPaletteCommands } from './ui-shortcuts.js';
import { createApiObservedUsageController } from './api-observed-usage-controller.js';
import { emptyObservedUsage } from './api-observed-usage.js';
import { createCookiesUi } from './cookies-ui.js';
import { createAutosurfUi } from './autosurf-ui.js';
import { createProxyUi } from './proxy-ui.js';
import { createThemePicker } from './theme-picker.js';
import { createDetectorUi } from './detector-ui.js';
import { createContactsUi } from './contacts-ui.js';
import { managementNavigationLabels, MANAGEMENT_SECTION_ENGLISH } from './management-navigation-labels.js';
import { createModuleStatusController, STATUS_MODULES } from './management-module-status.js';
import { createGuardLaunchersUi } from './guard-launchers-ui.js';
import { createManagementHub } from './management-hub.js';
import { redesignLabels } from './redesign-labels.js';
import { announcerRegions } from './ui-announcer.js';
import { createTourUi, createTourEntry, tourToolSlot, TOUR_PALETTE_KEYWORDS } from './ui-tour.js';
import { tourLabels } from './ui-tour-labels.js';
import { provideTourButton } from './ui-tour-slot.js';
import { proxyGeoSettingsLabels } from './proxy-geo-settings-labels.js';
// ADR-103: the Пульт (hub) leads; Detector has its own «Анализ» group.
export const MANAGEMENT_HOME = 'hub';
export const MANAGEMENT_GROUPS = Object.freeze([
  Object.freeze({id:'analysis',tabs:Object.freeze(['detector'])}),
  Object.freeze({id:'defense',tabs:Object.freeze(['api','firewall'])}),
  Object.freeze({id:'attack',tabs:Object.freeze(['antidetect','autosurf','cookies','proxy'])}),
  Object.freeze({id:'tools',tabs:Object.freeze(['integrations','settings','contacts'])}),
]);
export const MANAGEMENT_SECTIONS = Object.freeze([MANAGEMENT_HOME, ...MANAGEMENT_GROUPS.flatMap(group=>group.tabs), 'browser-debug']);
// Browser Debug remains a deep link within Settings, outside the primary tabs.
export const MANAGEMENT_TABS = Object.freeze(MANAGEMENT_SECTIONS.filter(section => section !== 'browser-debug'));
const tabForSection = section => section === 'browser-debug' ? 'settings' : section;
const FIREWALL_HASHES = new Set(['#protect', '#firewall', '#history', '#requests']);
const API_HASHES = new Set(['#api', '#protection']);
const DEFAULT_HASHES = Object.freeze({ hub: '#hub', firewall: '#protect', api: '#api', integrations: '#integrations', detector: '#detector', antidetect: '#antidetect', settings: '#settings', 'browser-debug': '#browser-debug', cookies: '#cookies', autosurf: '#autosurf', proxy: '#proxy', contacts: '#contacts' });
const FIREWALL_ANCHORS = Object.freeze({ '#firewall': 'fw-rules-panel-title', '#history': 'history-settings-title', '#requests': 'requests-options-title' });

export function managementSectionForHash(hash) {
  if (FIREWALL_HASHES.has(hash)) return 'firewall';
  if (API_HASHES.has(hash)) return 'api';
  if (hash === '#antidetect') return 'antidetect';
  if (hash === '#detector') return 'detector';
  if (hash === '#cookies') return 'cookies';
  if (hash === '#autosurf') return 'autosurf';
  if (hash === '#proxy') return 'proxy';
  if (hash === '#integrations') return 'integrations';
  if (hash === '#settings') return 'settings';
  return hash === '#contacts' ? 'contacts' : hash === '#browser-debug' ? 'browser-debug' : MANAGEMENT_HOME;
}

export function managementHashForSection(section) {
  return Object.hasOwn(DEFAULT_HASHES, section) ? DEFAULT_HASHES[section] : DEFAULT_HASHES.settings;
}

export function managementHasFirewall(browserApi) {
  try {
    const permissions = browserApi.runtime.getManifest().permissions;
    return Array.isArray(permissions) && permissions.includes('declarativeNetRequestWithHostAccess');
  } catch { return false; }
}

// ADR-107 command palette entries: every section (the existing hashes), the five Antidetect levels and the commands that mounted
// editors offer (ui-shortcuts.js). English names are extra keywords in every language. No entry requests a permission.
const PALETTE_COMMAND_LEVEL = Object.freeze({ 'load-profile': 'quick', randomize: 'quick', 'apply-profile': 'quick', 'export-profile': 'quick', 'apply-network': 'network' });
const PALETTE_COMMAND_LABEL = Object.freeze({ randomize: 'paletteRandomize', 'apply-profile': 'paletteApplyProfile', 'apply-network': 'paletteApplyNetwork', 'export-profile': 'paletteExport' });
// Round 5, ADR-111: the guided tours (ui-tour.js), one command per section, the one of the section on screen first. A tour moves between
// levels and sections by itself, so these commands open no Antidetect level first.
const PALETTE_TOUR_LABEL = Object.freeze({ 'start-tour': 'start', 'resume-tour': 'resume' });
const levelName = (words, level) => ({ quick: words.quick_title, device: words.level_device_title, os: words.level_os_title, browser: words.level_browser_title, network: words.level_network_title })[level];
export function buildPaletteEntries({ h, icon, sectionLabel, translate, locale, labels, groupLabel, choose, openAntidetect, openPrecursor, openProxyGeo, commands = [], currentSection = null }) {
  const english = MANAGEMENT_SECTION_ENGLISH, englishLabels = redesignLabels('en'), englishNavigation = managementNavigationLabels('en');
  const groupWord = section => { const group = MANAGEMENT_GROUPS.find(item => item.tabs.includes(section)); return group ? englishNavigation[group.id] ?? englishLabels[group.id] ?? '' : ''; };
  const words = fingerprintDeviceLabels(locale), englishWords = fingerprintDeviceLabels('en');
  const sections = [...MANAGEMENT_TABS, 'browser-debug'].map(section => ({ id: section, label: sectionLabel(section), group: section === 'browser-debug' ? sectionLabel('settings') : groupLabel(section),
    keywords: [english[section], section === 'browser-debug' ? english.settings : groupWord(section)].filter(Boolean).join(' '), icon: icon(section), run: () => choose(section) }));
  const precursor = { id: 'precursor', label: translate('precursor_title'), group: labels.integrations, keywords: english.precursor + ' ' + english.integrations, icon: icon('integrations'), run: openPrecursor };
  // ADR-109: the second Integrations entry; only when the caller can open its page (an older caller passes nothing and gets none).
  const proxyGeo = typeof openProxyGeo === 'function' ? [{ id: 'proxy-geo', label: proxyGeoSettingsLabels(locale).title, group: labels.integrations, keywords: 'geolocation geoip location country city ip api key ' + english.proxy + ' ' + english.integrations, icon: icon('proxy'), run: openProxyGeo }] : [];
  const levels =ANTIDETECT_CATEGORIES.map(level => ({ id: 'antidetect:' + level, label: levelName(words, level), group: sectionLabel('antidetect'),
    keywords: levelName(englishWords, level) + ' ' + english.antidetect, icon: icon('antidetect'), run: () => openAntidetect(level) }));
  const ordered = (Array.isArray(commands) ? commands : []).slice().sort((a, b) => Number(currentSection !== null && b.section === currentSection) - Number(currentSection !== null && a.section === currentSection));
  const actions = ordered.map(command => {
    if (Object.hasOwn(PALETTE_TOUR_LABEL, command.kind)) {
      const section = typeof command.section === 'string' && Object.hasOwn(english, command.section) ? command.section : 'antidetect';
      return { id: command.id, label: tourLabels(locale)[PALETTE_TOUR_LABEL[command.kind]], group: sectionLabel(section), keywords: TOUR_PALETTE_KEYWORDS + ' ' + english[section], icon: icon(section),
        run: () => { try { command.run(); } catch { /* The tour layer went away meanwhile. */ } } };
    }
    const run = () => { openAntidetect(PALETTE_COMMAND_LEVEL[command.kind]); try { command.run(); } catch { /* The editor went away meanwhile. */ } };
    if (command.kind === 'load-profile') {
      // The saved name is user text: isolated in the visible label, plain in the searchable one.
      const [before, after = ''] = labels.paletteLoadProfile.split('{name}');
      return { id: command.id, label: before + command.name + after, display: [before, h('bdi', { children: command.name }), after], group: translate('fingerprint_library'),
        keywords: englishLabels.paletteLoadProfile.replace('{name}', ' ') + ' ' + english.antidetect, icon: icon('antidetect'), run };
    }
    const key = PALETTE_COMMAND_LABEL[command.kind];
    return { id: command.id, label: labels[key], group: sectionLabel('antidetect'), keywords: englishLabels[key] + ' ' + english.antidetect, icon: icon('antidetect'), run };
  });
  return [...sections, precursor, ...proxyGeo, ...levels, ...actions];
}

const currentHash = () => { try { return globalThis.location.hash; } catch { return ''; } };
const currentScroll = () => ({ x: globalThis.scrollX ?? 0, y: globalThis.scrollY ?? 0 });
const currentFocus = () => { try { return globalThis.document.activeElement; } catch { return null; } };

/** Leave through each dialog's existing cancellation path; never save an unfinished modal. */
function cancelPanelDialogs(panel) {
  if (!panel) return;
  for (const dialog of panel.querySelectorAll('dialog[open]')) {
    try { dialog.close(); } catch { /* Already closing. */ }
  }
  for (const dialog of panel.querySelectorAll('[role="dialog"][aria-modal="true"]:not(dialog)')) {
    try { dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: false, cancelable: true })); } catch { /* Detached dialog. */ }
  }
}

export function createManagementUi({ h, useState, useEffect, useRef, useLocale, translate, LanguagePicker, OptionsApp, ProtectionPageApp, ProtectIsland, ProtectionLauncher, ApiConfigurationEditor, sendUiRequest, browserApi = globalThis.chrome }) {
  const { ContactsApp } = createContactsUi({ h, useState, useEffect, useRef, useLocale, translate });
  const { ThemePicker } = createThemePicker({ h, useState, useEffect, useRef, useLocale });
  const { DetectorApp } = createDetectorUi({ h, useState, useEffect, useRef, useLocale, translate, browserApi });
  const { AntidetectLauncher, DpiGuardLauncher, UnavailableFirewallLauncher } = createGuardLaunchersUi({ h, useState, useEffect, useRef, useLocale, translate, browserApi });
  const { BrowserDebugApp } = createBrowserDebugUi({ h, useState, useEffect, useRef, useLocale, translate, browserApi });
  const { AntidetectApp } = createAntidetectUi({ h, useState, useEffect, useRef, useLocale, translate, browserApi, ApiConfigurationEditor });
  const { CookiesApp } = createCookiesUi({ h, useState, useEffect, useRef, useLocale, translate, browserApi });
  const { AutosurfApp } = createAutosurfUi({ h, useState, useEffect, useRef, useLocale, translate, browserApi });
  const { ProxyApp } = createProxyUi({ h, useState, useEffect, useRef, useLocale, translate, browserApi });
  const { TourLayer } = createTourUi({ h, useState, useEffect, useRef, useLocale });
  const { TourButton } = createTourEntry({ h, useState, useEffect, useLocale });
  // The headers built for other pages too (the master header, the Detector) draw this button; they only read it from the slot (ui-tour-slot.js).
  provideTourButton(TourButton);
  // The Firewall header is drawn by the module «Защита» with its own copy of Preact, where this page's hooks cannot run. The launcher therefore gets a maker
  // (not a vnode) and draws the button itself between its title and its switch: one stable function, so the launcher builds the button once.
  const firewallTourSlot = tourToolSlot('firewall');
  // A page title row without a module switch: the Tour button is the last item of the row.
  const titleRow = (tour, title) => h('div', { class: 'workspace-titlebar', children: [h('h2', { class: 'management-page-title', children: title }), h('div', { class: 'workspace-tools', children: h(TourButton, { tour }) })] });
  let renderLocale = 'en';
  const sectionLabel = section => section === 'hub' ? redesignLabels(renderLocale).hub : section === 'integrations' ? redesignLabels(renderLocale).integrations : section === 'detector' ? 'Detector' : section === 'dpi' ? 'DPI Guard' : translate('management_tab_' + section.replaceAll('-', '_'));
  const openOwnPage = page => { try { Promise.resolve(browserApi.tabs.create({ url: browserApi.runtime.getURL(page) })).catch(() => {}); } catch { /* The browser may be closing. */ } };
  const openPrecursor = () => openOwnPage('precursor-settings.html');
  const openProxyGeo = () => openOwnPage('proxy-geo-settings.html');
  function icon(section, className = 'management-icon') {
    const paths = {
      hub: [h('rect', { x: 3, y: 3, width: 8, height: 8, rx: 2 }), h('rect', { x: 13, y: 3, width: 8, height: 5, rx: 2 }), h('rect', { x: 13, y: 10, width: 8, height: 11, rx: 2 }), h('rect', { x: 3, y: 13, width: 8, height: 8, rx: 2 })],
      analysis: [h('path', { d: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z' }), h('circle', { cx: 12, cy: 12, r: 3 })],
      dpi: [h('path', { d: 'M3 9.5c1.5-1.6 3-1.6 4.5 0s3 1.6 4.5 0 3-1.6 4.5 0 3 1.6 4.5 0M3 15c1.5-1.6 3-1.6 4.5 0s3 1.6 4.5 0 3-1.6 4.5 0 3 1.6 4.5 0' })],
      search: [h('circle', { cx: 11, cy: 11, r: 7 }), h('path', { d: 'm20 20-3.6-3.6' })],
      firewall: [h('path', { d: 'M12 3 20 6v6c0 4-3.2 7.2-8 9-4.8-1.8-8-5-8-9V6l8-3Z' }), h('path', { d: 'm8.5 12 2.3 2.3 4.7-4.8' })],
      api: [h('path', { d: 'm8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16' })],
      integrations: [h('rect', { x: 7, y: 7, width: 10, height: 10, rx: 2 }), h('path', { d: 'M10 3v4m4-4v4m-4 10v4m4-4v4M3 10h4m-4 4h4m10-4h4m-4 4h4' })],
      antidetect: [h('path', { d: 'M3 12s3-7 9-7 9 7 9 7-3 7-9 7-9-7-9-7Z' }), h('circle', { cx: 12, cy: 12, r: 3 }), h('path', { d: 'm3 3 18 18' })],
      settings: [h('path', { d: 'M4 7h9m4 0h3M4 17h3m4 0h9' }), h('circle', { cx: 15, cy: 7, r: 2 }), h('circle', { cx: 9, cy: 17, r: 2 })],
      back: [h('path', { d: 'm14 5-7 7 7 7' })],
      'browser-debug': [h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 3 }), h('path', { d: 'M3 9h18M7 6.5h.01M10 6.5h.01m-1 6-2 2 2 2m6-4 2 2-2 2m-2-5-2 6' })],
      cookies: [h('path', { d: 'M20.8 13.2a8.9 8.9 0 1 1-10-10A5.2 5.2 0 0 0 16 8.4a5.2 5.2 0 0 0 4.8 4.8Z' }), h('path', { d: 'M7 9h.01M8 15h.01M13 17h.01M14 12h.01' })],
      autosurf: [h('circle', { cx: 12, cy: 12, r: 9 }), h('path', { d: 'm10 8 6 4-6 4V8ZM3 12h3m12 0h3' })],
      proxy: [h('circle', { cx: 12, cy: 12, r: 9 }), h('path', { d: 'M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Zm-4 7 4-3 4 3m-8 4 4 3 4-3' })],
      contacts: [h('rect', { x: 3, y: 5, width: 18, height: 14, rx: 3 }), h('path', { d: 'm4 7 8 6 8-6' })],
      detector: [h('circle',{cx:11,cy:11,r:7}),h('path',{d:'m16 16 5 5M7 11h2l2-3 2 6 2-3h2'})],
      attack: [h('circle',{cx:12,cy:12,r:7}),h('path',{d:'M12 2v5m0 10v5M2 12h5m10 0h5m-7-12-4 7h4l-4 7'})],
      defense: [h('path',{d:'m12 3 8 3v6c0 4-3 7-8 9-5-2-8-5-8-9V6l8-3Z'}),h('path',{d:'m8 12 3 3 5-6'})],
      tools: [h('path',{d:'M20 7a6 6 0 0 1-8 7L5 21l-3-3 7-7a6 6 0 0 1 8-8l-4 4 4 4 3-4Z'})],
    };
    return h('svg', { class: className, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': true, focusable: false, children: paths[section] });
  }

  function brand() {
    return h('div', { class: 'management-brand', dir: 'ltr', children: [
      h('svg', { class: 'management-brand__logo', viewBox: '0 0 38 22', fill: 'none', 'aria-hidden': true, focusable: false, children: [
        h('path', { d: 'M0.0138095 17.126C0.474424 12.1227 2.88868 7.31189 7.12951 3.97639C15.2776 -2.45406 27.1424 -0.914601 33.4481 7.36C36.2753 11.0804 37.5142 15.5384 37.2759 19.8842C37.26 20.2209 36.9424 20.4775 36.6088 20.4454C36.2912 20.4133 36.0688 20.1247 36.0847 19.804C36.3706 16.4524 35.5129 12.9887 33.4481 10.0701C28.6672 3.33495 19.2167 1.95585 12.7522 7.05532C9.35316 9.73334 7.44717 13.6461 7.20892 17.6872C7.09774 19.4191 5.8112 20.8303 4.11169 21.0708C1.80862 21.3915 -0.192673 19.4672 0.0138095 17.126Z', fill: 'currentColor' }),
        h('path', { d: 'M17.0259 14.3195C19.1384 14.3195 20.8697 12.5876 20.8697 10.4388C20.8697 9.30025 20.3773 8.27395 19.6149 7.56836C23.0616 7.85701 25.7617 10.7595 25.7617 14.3195C25.7617 18.0559 22.7598 21.0868 19.059 21.0868C15.3582 21.0868 12.3563 18.0559 12.3563 14.3195C12.3563 13.1008 12.6739 11.9462 13.2457 10.952C13.4681 12.8603 15.0723 14.3195 17.0259 14.3195Z', fill: 'currentColor' }),
      ] }),
      h('h1', { children: 'Detect Expert' }),
    ] });
  }

  const firewallLauncher = () => managementHasFirewall(browserApi) && ProtectIsland ? h(ProtectIsland, { surface: 'launcher' }) : h(UnavailableFirewallLauncher, {});
  const { ManagementHub, CommandPalette } = createManagementHub({ h, useState, useEffect, useRef, useLocale, translate, browserApi, sectionLabel, icon,
    launchers: { AntidetectLauncher, ProtectionLauncher, DpiGuardLauncher, FirewallLauncher: firewallLauncher } });

  function ManagementApp() {
    const locale = useLocale();
    renderLocale = locale;
    const labels = redesignLabels(locale);
    const navigationLabels = managementNavigationLabels(locale);
    const [paletteOpen, setPaletteOpen] = useState(false);
    // ADR-107: the Antidetect level the palette asked for; a new object each time, applied once the section is shown.
    const [antidetectRequest, setAntidetectRequest] = useState(null);
    const direction = typeof locale === 'string' && /^(ar|ur)(?:[-_]|$)/i.test(locale) ? 'rtl' : 'ltr';
    const [hash, setHash] = useState(currentHash);
    const selected = managementSectionForHash(hash);
    const [visited, setVisited] = useState(() => [selected]);
    const [roving, setRoving] = useState(() => tabForSection(selected));
    const [wide, setWide] = useState(() => globalThis.matchMedia?.('(min-width: 1120px)').matches ?? true);
    const [menuOpen, setMenuOpen] = useState(false);
    const menuButton = useRef(null);
    const resizeFocus = useRef(null);
    const tabs = useRef(new Map()), panels = useRef(new Map()), scrolls = useRef(new Map());
    const route = useRef(hash), selectedRef = useRef(selected), savedHashes = useRef(new Map());
    const focusAfterRoute = useRef(null), previousSelection = useRef(selected);
    const tabNavigation = useRef(null), anchorRequest = useRef(null);
    const hasFirewall = managementHasFirewall(browserApi);
    const [observedUsage, setObservedUsage] = useState(() => emptyObservedUsage('no-site'));
    const usageController = useRef(null);
    const statusController = useRef(null);
    const [moduleStates, setModuleStates] = useState(() => Object.fromEntries(STATUS_MODULES.map(section=>[section,'unknown'])));
    if (!statusController.current) statusController.current = createModuleStatusController(browserApi, {onChange:setModuleStates});
    if (!usageController.current) usageController.current = createApiObservedUsageController(browserApi, { sendRequest: sendUiRequest, onChange: setObservedUsage });
    selectedRef.current = selected;

    useEffect(() => {
      const media = globalThis.matchMedia?.('(min-width: 1120px)');
      if (!media) return undefined;
      const update = () => {
        const focus = currentFocus();
        const transfer = media.matches ? focus === menuButton.current : [...tabs.current.values()].includes(focus);
        resizeFocus.current = transfer ? { from: focus, wide: media.matches } : null;
        setWide(media.matches);
        setMenuOpen(false);
      };
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }, []);

    useEffect(() => {
      const intent = resizeFocus.current;
      if (!intent || intent.wide !== wide) return undefined;
      // Focus only after the new control is visible; another resize or user focus wins.
      const frame = requestAnimationFrame(() => {
        if (resizeFocus.current !== intent) return;
        resizeFocus.current = null;
        const focus = currentFocus(), document = globalThis.document;
        if (focus && focus !== intent.from && focus !== document?.body && focus !== document?.documentElement) return;
        const target = wide ? tabs.current.get(tabForSection(selectedRef.current)) : menuButton.current;
        try { target?.focus({ preventScroll: true }); } catch { /* The window can close during resize. */ }
      });
      return () => cancelAnimationFrame(frame);
    }, [wide]);

    useEffect(() => () => usageController.current.dispose(), []);
    // ADR-103: Ctrl K / ⌘K opens the local section search.
    useEffect(() => {
      const shortcut = event => {
        if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && (event.code === 'KeyK' || event.key === 'k' || event.key === 'K')) { event.preventDefault(); setPaletteOpen(true); }
      };
      globalThis.addEventListener('keydown', shortcut);
      return () => globalThis.removeEventListener('keydown', shortcut);
    }, []);
    useEffect(() => {
      const update=()=>statusController.current.setActive(globalThis.document?.visibilityState !== 'hidden');
      update(); globalThis.document?.addEventListener?.('visibilitychange',update);
      return()=>{globalThis.document?.removeEventListener?.('visibilitychange',update);statusController.current.dispose();};
    },[]);
    useEffect(() => { usageController.current.setActive(selected === 'api'); }, [selected]);

    useEffect(() => {
      const follow = () => {
        const nextHash = currentHash(), next = managementSectionForHash(nextHash), previous = selectedRef.current;
        const fromTab = tabNavigation.current === nextHash;
        tabNavigation.current = null;
        anchorRequest.current = next === 'firewall' && Object.hasOwn(FIREWALL_ANCHORS, nextHash) && !fromTab ? nextHash : null;
        savedHashes.current.set(next, nextHash);
        if (previous !== next) {
          const panel = panels.current.get(previous);
          scrolls.current.set(previous, currentScroll());
          if (panel?.contains(currentFocus())) focusAfterRoute.current = next;
          cancelPanelDialogs(panel);
          setRoving(tabForSection(next));
        }
        route.current = nextHash;
        selectedRef.current = next;
        setVisited(values => values.includes(next) ? values : [...values, next]);
        setHash(nextHash);
      };
      savedHashes.current.set(selectedRef.current, route.current);
      globalThis.addEventListener('hashchange', follow);
      follow();
      return () => globalThis.removeEventListener('hashchange', follow);
    }, []);

    useEffect(() => {
      if (previousSelection.current === selected) return undefined;
      previousSelection.current = selected;
      if (focusAfterRoute.current === selected) {
        focusAfterRoute.current = null;
        try { (wide || menuOpen ? tabs.current.get(tabForSection(selected)) : menuButton.current)?.focus({ preventScroll: true }); } catch { /* The window can close during navigation. */ }
      }
      if (anchorRequest.current !== null) return undefined;
      const position = scrolls.current.get(selected) ?? { x: 0, y: 0 };
      const frame = requestAnimationFrame(() => {
        try { globalThis.scrollTo(position.x, position.y); } catch { /* Static preview. */ }
      });
      return () => cancelAnimationFrame(frame);
    }, [selected]);

    useEffect(() => {
      try { globalThis.document.title = sectionLabel(selected) + ' — Detect Expert'; } catch { /* Static preview. */ }
    }, [selected, locale]);

    // Deep links still reveal a section after its already-mounted panel becomes visible again.
    useEffect(() => {
      if (selected !== 'firewall' || anchorRequest.current !== hash || !Object.hasOwn(FIREWALL_ANCHORS, hash)) return undefined;
      const panel = panels.current.get('firewall');
      if (!panel) return undefined;
      let stopped = false, observer = null, timer = null;
      const reveal = () => {
        if (stopped || selectedRef.current !== 'firewall' || currentHash() !== hash || panel.hidden) return false;
        const heading = panel.querySelector('#' + FIREWALL_ANCHORS[hash]);
        if (!heading || heading.getClientRects().length === 0) return false;
        heading.tabIndex = -1;
        heading.scrollIntoView({ block: 'start' });
        heading.focus({ preventScroll: true });
        anchorRequest.current = null;
        stopped = true;
        observer?.disconnect();
        if (timer !== null) clearTimeout(timer);
        return true;
      };
      if (!reveal() && typeof MutationObserver === 'function') {
        observer = new MutationObserver(reveal);
        observer.observe(panel, { childList: true, subtree: true });
        timer = setTimeout(() => { stopped = true; observer.disconnect(); }, 5000);
      }
      return () => { stopped = true; observer?.disconnect(); if (timer !== null) clearTimeout(timer); };
    }, [selected, hash]);

    function choose(section) {
      if (!MANAGEMENT_SECTIONS.includes(section)) return;
      if (!wide) {
        setMenuOpen(false);
        if ([...tabs.current.values()].includes(currentFocus())) menuButton.current?.focus({ preventScroll: true });
      }
      setRoving(tabForSection(section));
      const remembered = savedHashes.current.get(section);
      const target = section === 'firewall' && FIREWALL_HASHES.has(remembered) ? remembered : managementHashForSection(section);
      try {
        if (globalThis.location.hash !== target) { tabNavigation.current = target; globalThis.location.hash = target; }
      } catch { tabNavigation.current = null; }
    }

    function keyboard(event, section) {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(section); return; }
      const index = MANAGEMENT_TABS.indexOf(section);
      let next;
      if (event.key === 'Home') next = MANAGEMENT_TABS[0];
      else if (event.key === 'End') next = MANAGEMENT_TABS.at(-1);
      else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const step = event.key === 'ArrowDown' ? 1 : -1;
        next = MANAGEMENT_TABS[(index + step + MANAGEMENT_TABS.length) % MANAGEMENT_TABS.length];
      }
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const step = (event.key === 'ArrowRight' ? 1 : -1) * (direction === 'rtl' ? -1 : 1);
        next = MANAGEMENT_TABS[(index + step + MANAGEMENT_TABS.length) % MANAGEMENT_TABS.length];
      } else return;
      event.preventDefault(); setRoving(next);
      const button = tabs.current.get(next);
      button?.focus();
      try { button?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch { /* Static preview. */ }
    }

    function content(section) {
      if (section === 'hub') return h(ManagementHub, { moduleStates, onOpen: choose, active: selected === 'hub' });
      if (section === 'integrations') return h('div', { class: 'management-settings', 'data-management-integrations': true, children: [
        titleRow('integrations', sectionLabel('integrations')),
        h('button', { type: 'button', class: 'management-settings-entry', 'data-api-precursor': true,
          onClick: openPrecursor,
          children: [
            h('span', { class: 'management-settings-entry__icon', children: icon('integrations') }),
            h('span', { class: 'management-settings-entry__text', children: [h('strong', { dir: 'ltr', children: translate('precursor_title') }), h('span', { class: 'small', children: translate('precursor_modes_settings') })] }),
            h('span', { class: 'management-settings-entry__arrow', 'aria-hidden': true, children: '›' }),
          ] }),
        // ADR-109: the product name is a proper name; only the line under it follows the language.
        h('button', { type: 'button', class: 'management-settings-entry', 'data-api-proxy-geo': true,
          onClick: openProxyGeo,
          children: [
            h('span', { class: 'management-settings-entry__icon', children: icon('proxy') }),
            h('span', { class: 'management-settings-entry__text', children: [h('strong', { dir: 'ltr', children: proxyGeoSettingsLabels(renderLocale).title }), h('span', { class: 'small', children: proxyGeoSettingsLabels(renderLocale).entry_subtitle })] }),
            h('span', { class: 'management-settings-entry__arrow', 'aria-hidden': true, children: '›' }),
          ] }),
      ] });
      if (section === 'settings') return h('div', { class: 'management-settings', children: [
        titleRow('settings', sectionLabel('settings')),
        h(OptionsApp, { embedded: true }),
        h('button', { type: 'button', class: 'management-settings-entry', 'data-settings-browser-debug': true, onClick: () => choose('browser-debug'), children: [
          h('span', { class: 'management-settings-entry__icon', children: icon('browser-debug') }),
          h('span', { class: 'management-settings-entry__text', children: h('strong', { children: sectionLabel('browser-debug') }) }),
          h('span', { class: 'management-settings-entry__arrow', 'aria-hidden': true, children: '›' }),
        ] }),
      ] });
      if (section === 'api') return h(ProtectionPageApp, { embedded: true, active: selected === 'api', observedUsage });
      if (section === 'antidetect') return h(AntidetectApp, { active: selected === 'antidetect', request: antidetectRequest });
      if (section === 'detector') {
        let tabId=null;
        try { const values=new URLSearchParams(globalThis.location.search).getAll('tabId'); const raw=values.length===1?values[0]:null; if(typeof raw==='string'&&/^(0|[1-9][0-9]{0,9})$/.test(raw)&&Number(raw)<=2147483647)tabId=Number(raw); } catch { /* A direct Options entry can have no selected website. */ }
        return h(DetectorApp,{active:selected==='detector',tabId});
      }
      if (section === 'browser-debug') return h('div', { class: 'management-settings-debug', children: [
        h('button', { type: 'button', class: 'button management-back', 'data-browser-debug-back': true, onClick: () => choose('settings'), children: [icon('back'), h('span', { children: sectionLabel('settings') })] }),
        h(BrowserDebugApp, { active: selected === 'browser-debug', onOpenApi: () => choose('api') }),
      ] });
      // ADR-111: the Cookies header receives the shared Tour button as `tourButton` and draws it at the end of its actions.
      if (section === 'cookies') return h(CookiesApp, { active: selected === 'cookies', tourButton: h(TourButton, { tour: 'cookies' }) });
      if (section === 'autosurf') return h(AutosurfApp, { active: selected === 'autosurf' });
      if (section === 'proxy') return h(ProxyApp, { active: selected === 'proxy' });
      if (section === 'contacts') return h(ContactsApp, { active: selected === 'contacts' });
      return h('main', { class: 'app app--options blocking-page protect-page management-firewall', children: [
        h('section',{class:'workspace-master workspace-master--firewall','data-workspace-master':'firewall','aria-label':sectionLabel('firewall'),children:hasFirewall?h(ProtectIsland,{surface:'launcher',toolSlot:firewallTourSlot}):h(UnavailableFirewallLauncher,{})}),
        hasFirewall?h(ProtectIsland, { surface: 'options-page' }):h('section',{class:'management-unavailable','data-management-unavailable':'firewall',children:h('p',{children:translate('management_firewall_unavailable')})}),
      ] });
    }

    const rendered = visited.includes(selected) ? visited : [...visited, selected];
    const languageTag = typeof locale === 'string' ? locale.replaceAll('_', '-') : 'en';
    const stateLabel = section => navigationLabels[moduleStates[section]] ?? navigationLabels.unknown;
    function tabButton(section) {
      return h('button', {
        type: 'button', id: 'management-tab-' + section, class: 'management-tab' + (tabForSection(selected) === section ? ' is-selected' : ''), role: 'tab', 'aria-selected': tabForSection(selected) === section, 'aria-controls': 'management-panel-' + (section === 'settings' && selected === 'browser-debug' ? 'browser-debug' : section), tabIndex: roving === section ? 0 : -1,
        'data-management-tab': section, ref: element => { if (element) tabs.current.set(section, element); else tabs.current.delete(section); },
        onFocus: () => setRoving(section), onKeyDown: event => keyboard(event, section), onClick: () => choose(section),
        children: [icon(section), h('span', { children: sectionLabel(section) }), STATUS_MODULES.includes(section) ? h('span', { class: 'management-status-dot ' + (moduleStates[section] === 'active' ? 'management-status-dot--active' : 'management-status-dot--off'), role: 'img', 'data-module-indicator': section, 'data-module-state': moduleStates[section], title: stateLabel(section), 'aria-label': stateLabel(section) }) : null],
      }, section);
    }
    const groupLabel = section => { const group = MANAGEMENT_GROUPS.find(item => item.tabs.includes(section)); return group ? navigationLabels[group.id] ?? labels[group.id] : null; };
    const paletteEntries = paletteOpen ? buildPaletteEntries({ h, icon, sectionLabel, translate, locale, labels, groupLabel, choose, openPrecursor, openProxyGeo,
      openAntidetect: level => { setAntidetectRequest({ level }); choose('antidetect'); }, commands: collectPaletteCommands().filter(command => hasFirewall || command.section !== 'firewall' || !Object.hasOwn(PALETTE_TOUR_LABEL, command.kind)), currentSection: selected }) : [];
    // Round 5: the guided tour shows sections and Antidetect levels through the same routes as the palette, without moving focus.
    const tourNavigate = view => { if (view.section === 'antidetect' && view.level) setAntidetectRequest({ level: view.level, focus: false }); choose(view.section); };
    const tourView = () => ({ section: selectedRef.current });
    const shortcut = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '') ? '⌘K' : 'Ctrl K';
    return h('div', { class: 'management-shell', 'data-management-shell': true, 'data-management-active': selected, lang: languageTag, dir: direction, children: [
      h('header', { class: 'management-header', children: [brand(),
        h('button', { type: 'button', class: 'management-search', 'data-management-search': true, 'aria-haspopup': 'dialog', 'aria-keyshortcuts': 'Control+K Meta+K', onClick: () => setPaletteOpen(true), children: [icon('search'), h('span', { class: 'management-search__label', children: labels.search }), h('kbd', { children: shortcut })] }),
        h('div', { class: 'management-header__actions', children: [
          h('button', { type: 'button', class: 'management-menu-toggle', hidden: wide, 'data-management-menu-toggle': true, 'aria-label': translate('management_navigation'), 'aria-controls': 'management-navigation', 'aria-expanded': menuOpen, ref: element => { menuButton.current = element; }, onClick: () => setMenuOpen(value => !value), children: [
            h('svg', { class: 'management-icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'aria-hidden': true, children: h('path', { d: menuOpen ? 'm6 6 12 12M6 18 18 6' : 'M4 6h16M4 12h16M4 18h16' }) }),
            h('span', { children: sectionLabel(tabForSection(selected)) }),
          ] }),
          h(ThemePicker, {}),
          h('div', { class: 'management-language', children: h(LanguagePicker, {}) }),
        ] }),
      ] }),
      h('nav', { id: 'management-navigation', class: 'management-navigation', hidden: !wide && !menuOpen, 'data-management-navigation': true, 'aria-label': translate('management_navigation'), onKeyDown: event => {
        if (event.key === 'Escape' && !wide && menuOpen) { event.preventDefault(); event.stopPropagation(); setMenuOpen(false); menuButton.current?.focus({ preventScroll: true }); }
      }, children: h('div', { class: 'management-tabs', role: 'tablist', 'aria-label': translate('management_navigation'), 'aria-orientation': 'vertical', children: [tabButton(MANAGEMENT_HOME), ...MANAGEMENT_GROUPS.map(group => h('fieldset', {class:'management-nav-group management-nav-group--'+group.id,'data-management-group':group.id,children:[
        h('legend',{class:'management-nav-group__legend',children:[icon(group.id),h('span',{children:navigationLabels[group.id]??labels[group.id]})]}),
        h('div',{class:'management-nav-group__items',children:group.tabs.map(tabButton)}),
      ]},group.id))] }) }),
      h('div', { class: 'management-workspace', children: MANAGEMENT_SECTIONS.map(section => h('section', {
        id: 'management-panel-' + section, class: 'management-panel management-panel--' + section, role: 'tabpanel', 'aria-labelledby': 'management-tab-' + tabForSection(section), tabIndex: 0, hidden: selected !== section, inert: selected !== section,
        'data-management-panel': section, ref: element => { if (element) panels.current.set(section, element); else panels.current.delete(section); }, children: rendered.includes(section) ? content(section) : null,
      }, section)) }),
      h(CommandPalette, { open: paletteOpen, onClose: () => setPaletteOpen(false), entries: paletteEntries }),
      h(TourLayer, { navigate: tourNavigate, getView: tourView }),
      // ADR-107: the shared live regions stay mounted at the shell root, outside every inert panel.
      ...announcerRegions(h),
    ] });
  }

  return { ManagementApp };
}
