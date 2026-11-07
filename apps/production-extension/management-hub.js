// ADR-103: «Пульт» — one overview of every module. Switches are the existing launchers
// (same CAS and activation paths, ADR-098 for Firewall); other tiles only read state and navigate.
import { redesignLabels } from './redesign-labels.js';
import { managementNavigationLabels } from './management-navigation-labels.js';
import { createObservationControl } from './observation-control.js';
import { createTourEntry } from './ui-tour.js';

export const HUB_STATE_TONE = Object.freeze({ active: 'ok', off: 'off', paused: 'warn', connecting: 'warn', inactive: 'warn', error: 'err', unknown: 'off' });

// ADR-107 palette search. Folding: lower case, accents removed — which also turns ё into е, since NFKD splits it into е and a
// combining diaeresis — while й stays a letter of its own; compatibility forms unified (full-width Latin, ligatures); Hangul and
// kana are recomposed. Nothing typed is stored or sent.
// The Combining Diacritical Marks block, U+0300 to U+036F, built from code points so the source stays plain ASCII here.
const ACCENTS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'gu');
export const PALETTE_QUERY_MAX = 128, PALETTE_TERMS_MAX = 8, PALETTE_RESULTS = 20;
export function foldSearchText(text) {
  if (typeof text !== 'string') return '';
  return text.toLowerCase().split('й').map(part => part.normalize('NFKD').replace(ACCENTS, '').normalize('NFC')).join('й');
}
const searchWords = text => foldSearchText(text).split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
// 4 whole word, 3 prefix, 2 inside a word, 1 initials of consecutive words (two letters or more), 0 no match.
function termLevel(term, words) {
  let best = 0;
  for (const word of words) {
    if (word === term) return 4;
    if (word.startsWith(term)) best = Math.max(best, 3); else if (word.includes(term)) best = Math.max(best, 2);
  }
  if (best === 0 && term.length >= 2 && words.map(word => word[0]).join('').includes(term)) best = 1;
  return best;
}
/**
 * Every typed word must match the label, the group or the keywords (English names among them). Order: the weakest matching word
 * first (whole > prefix > inside > initials), then the sum, then matches in the label itself, a shorter label, the given order.
 */
export function rankPaletteEntries(entries, query, limit = PALETTE_RESULTS) {
  const list = Array.isArray(entries) ? entries : [];
  const terms = [...new Set(searchWords(typeof query === 'string' ? query.slice(0, PALETTE_QUERY_MAX) : ''))].slice(0, PALETTE_TERMS_MAX);
  if (!terms.length) return list.slice(0, limit);
  const scored = [];
  list.forEach((entry, index) => {
    const label = searchWords(entry?.label), other = searchWords([entry?.group, entry?.keywords].filter(value => typeof value === 'string').join(' '));
    let weakest = 4, sum = 0, inLabel = 0;
    for (const term of terms) {
      const own = termLevel(term, label), elsewhere = termLevel(term, other), level = Math.max(own, elsewhere);
      if (level === 0) return;
      weakest = Math.min(weakest, level); sum += level; if (own >= elsewhere) inLabel++;
    }
    scored.push({ entry, key: [weakest, sum, inLabel, -label.length, -index] });
  });
  scored.sort((a, b) => { for (let at = 0; at < a.key.length; at++) if (a.key[at] !== b.key[at]) return b.key[at] - a.key[at]; return 0; });
  return scored.slice(0, limit).map(item => item.entry);
}

/** Read-only attention checks: no permission request, no storage write, no message to the backend. */
export async function readHubAttention(browserApi) {
  let scripts = false, cookies = false;
  try {
    const manifest = browserApi.runtime.getManifest();
    const required = Array.isArray(manifest.permissions) && manifest.permissions.includes('userScripts');
    const optional = Array.isArray(manifest.optional_permissions) && manifest.optional_permissions.includes('userScripts');
    if (required) scripts = typeof browserApi.userScripts !== 'object' || browserApi.userScripts === null;
    else if (optional && typeof browserApi.permissions?.contains === 'function') scripts = !(await browserApi.permissions.contains({ permissions: ['userScripts'] }));
  } catch { scripts = false; }
  try {
    const manifest = browserApi.runtime.getManifest();
    const listed = Array.isArray(manifest.optional_permissions) && manifest.optional_permissions.includes('cookies');
    if (listed && typeof browserApi.permissions?.contains === 'function') cookies = !(await browserApi.permissions.contains({ permissions: ['cookies'] }));
  } catch { cookies = false; }
  return { scripts, cookies };
}

export function hubAttentionItems(states, attention, labels, sectionLabel) {
  const items = [];
  if (attention.scripts && ['active', 'inactive', 'error'].includes(states.antidetect)) items.push({ id: 'scripts', title: labels.attnScripts, text: labels.attnScriptsText, section: 'antidetect' });
  for (const section of ['detector', 'api', 'firewall', 'antidetect', 'autosurf', 'proxy']) {
    if (states[section] === 'error') items.push({ id: 'error-' + section, title: sectionLabel(section) + ': ' + labels.attnError, text: null, section });
    else if (states[section] === 'inactive') items.push({ id: 'inactive-' + section, title: sectionLabel(section) + ': ' + labels.attnInactive, text: null, section });
  }
  if (attention.cookies) items.push({ id: 'cookies', title: labels.attnCookies, text: labels.attnCookiesText, section: 'cookies' });
  return items;
}

export function createManagementHub({ h, useState, useEffect, useRef, useLocale, translate, browserApi = globalThis.chrome, launchers = {}, sectionLabel, icon }) {
  const ObservationControl = createObservationControl({ h, useState, useEffect, useRef, useLocale, translate, browserApi });
  const { TourButton } = createTourEntry({ h, useState, useEffect, useLocale });
  const glyph = (d, extra = []) => h('svg', { class: 'management-icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.75, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': true, focusable: false, children: [h('path', { d }), ...extra] });
  const alertIcon = () => glyph('M12 3.5 2.5 20h19L12 3.5Z', [h('path', { d: 'M12 10v4.5M12 17.4v.1' })]);
  const chevron = () => glyph('m9.5 6 6 6-6 6');

  function StateChip({ state, nav }) {
    const tone = HUB_STATE_TONE[state] ?? 'off';
    return h('span', { class: 'rd-chip rd-chip--' + tone, 'data-hub-state': state, children: nav[state] ?? nav.unknown });
  }

  function Group({ id, title, note, children }) {
    return h('section', { class: 'hub-group hub-group--' + id, 'data-hub-group': id, 'aria-labelledby': 'hub-group-' + id, children: [
      h('h3', { class: 'hub-group__title', id: 'hub-group-' + id, children: [h('span', { children: title }), note ? h('small', { children: note }) : null] }),
      h('div', { class: 'hub-group__grid', children }),
    ] });
  }

  function LauncherTile({ section, state, note, nav, soon = null, children }) {
    return h('article', { class: 'hub-tile hub-tile--launcher' + (soon ? ' hub-tile--soon' : ''), 'data-hub-tile': section, children: [
      h('span', { class: 'hub-tile__icon', children: icon(section) }),
      h('div', { class: 'hub-tile__launcher', children }),
      h('div', { class: 'hub-tile__meta', children: [
        soon ? h('span', { class: 'rd-chip rd-chip--soon', children: soon }) : state ? h(StateChip, { state, nav }) : null,
        h('p', { class: 'hub-tile__note', children: note }),
      ] }),
    ] });
  }

  function StatusTile({ section, state, note, nav, labels, onOpen, control = null, extra = null }) {
    return h('article', { class: 'hub-tile', 'data-hub-tile': section, children: [
      h('span', { class: 'hub-tile__icon', children: icon(section) }),
      h('div', { class: 'hub-tile__head', children: [
        h('div', { class: 'hub-tile__title', children: [h('h4', { children: sectionLabel(section) }), state ? h(StateChip, { state, nav }) : null] }),
        control,
      ] }),
      h('p', { class: 'hub-tile__note', children: note }),
      extra,
      h('div', { class: 'hub-tile__foot', children: h('button', { type: 'button', class: 'button', 'data-hub-open': section, onClick: () => onOpen(section), children: [h('span', { children: labels.open }), chevron()] }) }),
    ] });
  }

  function LinkTile({ section, label, note, onOpen }) {
    return h('button', { type: 'button', class: 'hub-link', 'data-hub-link': section, onClick: () => onOpen(section), children: [
      h('span', { class: 'hub-tile__icon', children: icon(section) }),
      h('span', { class: 'hub-link__text', children: [h('strong', { children: label }), h('span', { children: note })] }),
      chevron(),
    ] });
  }

  function ManagementHub({ moduleStates, onOpen, active = true }) {
    const locale = useLocale();
    const labels = redesignLabels(locale), nav = managementNavigationLabels(locale);
    const [attention, setAttention] = useState({ scripts: false, cookies: false });
    useEffect(() => {
      if (!active) return undefined;
      let alive = true;
      readHubAttention(browserApi).then(value => { if (alive) setAttention(value); }, () => {});
      return () => { alive = false; };
    }, [active]);
    const items = hubAttentionItems(moduleStates, attention, labels, sectionLabel);
    const { AntidetectLauncher, ProtectionLauncher, DpiGuardLauncher, FirewallLauncher } = launchers;
    const api = ProtectionLauncher
      ? h(LauncherTile, { section: 'api', state: moduleStates.api, note: labels.apiNote, nav, children: h(ProtectionLauncher, { tabId: null }) })
      : h(StatusTile, { section: 'api', state: moduleStates.api, note: labels.apiNote, nav, labels, onOpen });
    const antidetect = AntidetectLauncher
      ? h(LauncherTile, { section: 'antidetect', state: moduleStates.antidetect, note: labels.antidetectNote, nav, children: h(AntidetectLauncher, { tabId: null }) })
      : h(StatusTile, { section: 'antidetect', state: moduleStates.antidetect, note: labels.antidetectNote, nav, labels, onOpen });
    const firewall = FirewallLauncher
      ? h(LauncherTile, { section: 'firewall', state: moduleStates.firewall, note: labels.firewallNote, nav, children: FirewallLauncher() })
      : h(StatusTile, { section: 'firewall', state: moduleStates.firewall, note: labels.firewallNote, nav, labels, onOpen });
    return h('div', { class: 'hub', 'data-management-hub': true, children: [
      h('header', { class: 'hub__head', children: [
        h('div', { class: 'workspace-titlebar', children: [h('h2', { class: 'management-page-title', children: labels.hub }), h('div', { class: 'workspace-tools', children: h(TourButton, { tour: 'hub' }) })] }),
        h('p', { class: 'hub__lead', children: labels.hubLead }),
      ] }),
      items.length ? h('section', { class: 'hub-attention', 'data-hub-attention-list': true, 'aria-labelledby': 'hub-attention-title', children: [
        h('div', { class: 'hub-attention__head', children: [h('h3', { id: 'hub-attention-title', children: labels.attention }), h('span', { class: 'rd-chip rd-chip--warn', children: String(items.length) })] }),
        h('ul', { class: 'hub-attention__list', children: items.map(item => h('li', { class: 'hub-attention__item', 'data-hub-attention': item.id, children: [
          alertIcon(),
          h('div', { class: 'hub-attention__text', children: [h('strong', { children: item.title }), item.text ? h('p', { children: item.text }) : null] }),
          h('button', { type: 'button', class: 'button', 'data-hub-attention-open': item.section, onClick: () => onOpen(item.section), children: labels.open }),
        ] }, item.id)) }),
      ] }) : null,
      h(Group, { id: 'analysis', title: labels.analysis, note: labels.noteAnalysis, children: [
        h(StatusTile, { section: 'detector', state: moduleStates.detector, note: labels.detectorNote, nav, labels, onOpen, control: h(ObservationControl, { tabId: null }),
          extra: h('p', { class: 'hub-tile__scope', children: labels.outOfScope }) }),
      ] }),
      h(Group, { id: 'defense', title: nav.defense, note: labels.noteDefense, children: [
        api, firewall,
        h(LauncherTile, { section: 'dpi', state: null, soon: labels.soon, note: labels.dpiNote, nav, children: DpiGuardLauncher ? h(DpiGuardLauncher, {}) : h('span', { children: 'DPI Guard' }) }),
      ] }),
      h(Group, { id: 'attack', title: nav.attack, note: labels.noteAttack, children: [
        antidetect,
        h(StatusTile, { section: 'autosurf', state: moduleStates.autosurf, note: labels.autosurfNote, nav, labels, onOpen }),
        h(StatusTile, { section: 'cookies', state: null, note: labels.cookiesNote, nav, labels, onOpen }),
        h(StatusTile, { section: 'proxy', state: moduleStates.proxy, note: labels.proxyNote, nav, labels, onOpen }),
      ] }),
      h(Group, { id: 'tools', title: nav.tools, note: null, children: [
        // ADR-109: two integrations now live in the Integrations section, so the tile opens that section instead of one page.
        h(LinkTile, { section: 'integrations', label: labels.integrations, note: 'Cloudflare Precursor, Geolocation API', onOpen }),
        h(LinkTile, { section: 'browser-debug', label: sectionLabel('browser-debug'), note: labels.debugNote, onOpen }),
        h(LinkTile, { section: 'settings', label: sectionLabel('settings'), note: labels.settingsNote, onOpen }),
        h(LinkTile, { section: 'contacts', label: sectionLabel('contacts'), note: labels.contactsNote, onOpen }),
      ] }),
    ] });
  }

  /** Local search of sections, Antidetect levels and the commands mounted editors offer; it never stores queries or recent items. */
  function CommandPalette({ open, onClose, entries }) {
    const locale = useLocale();
    const labels = redesignLabels(locale);
    const dialog = useRef(null), input = useRef(null);
    const [query, setQuery] = useState(''), [index, setIndex] = useState(0);
    useEffect(() => {
      const element = dialog.current;
      if (!element) return;
      if (open && !element.open) {
        setQuery(''); setIndex(0);
        try { element.showModal(); } catch { element.setAttribute('open', ''); }
        requestAnimationFrame(() => { try { input.current?.focus(); } catch { /* Closed meanwhile. */ } });
      } else if (!open && element.open) {
        try { element.close(); } catch { element.removeAttribute('open'); }
      }
    }, [open]);
    const results = rankPaletteEntries(entries, query);
    const current = results.length ? Math.min(index, results.length - 1) : -1;
    // The dialog closes before the command runs: focus returns to the page first and the regions outside the modal are live again.
    const run = entry => { try { if (dialog.current?.open) dialog.current.close(); } catch { /* Already closing. */ } onClose(); entry.run(); };
    function keydown(event) {
      if (event.key === 'ArrowDown') { event.preventDefault(); setIndex(value => Math.min(results.length - 1, value + 1)); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); setIndex(value => Math.max(0, value - 1)); }
      else if (event.key === 'Enter' && current >= 0) { event.preventDefault(); run(results[current]); }
    }
    return h('dialog', { class: 'command-palette', ref: dialog, 'aria-label': labels.search, 'data-command-palette': true, onClose: () => onClose(), onClick: event => { if (event.target === dialog.current) onClose(); }, children:
      h('div', { class: 'command-palette__box', children: [
        h('label', { class: 'command-palette__field', children: [
          glyph('M20 20l-3.6-3.6', [h('circle', { cx: 11, cy: 11, r: 7 })]),
          h('input', { ref: input, type: 'search', role: 'combobox', 'aria-expanded': true, 'aria-controls': 'command-palette-list', 'aria-autocomplete': 'list',
            // Option ids follow the position: entry ids may carry saved profile ids, which never become element ids.
            'aria-activedescendant': current >= 0 ? 'command-palette-option-' + current : undefined, 'aria-label': labels.search, maxLength: PALETTE_QUERY_MAX,
            placeholder: labels.searchPlaceholder, value: query, 'data-command-palette-input': true,
            onInput: event => { setQuery(event.currentTarget.value); setIndex(0); }, onKeyDown: keydown }),
          h('kbd', { children: 'Esc' }),
        ] }),
        h('ul', { id: 'command-palette-list', role: 'listbox', class: 'command-palette__list', 'aria-label': labels.search, children: results.length
          ? results.map((entry, position) => h('li', { id: 'command-palette-option-' + position, role: 'option', 'aria-selected': position === current, 'data-command-option': entry.id,
            class: 'command-palette__option' + (position === current ? ' is-active' : ''), onMouseMove: () => setIndex(position), onClick: () => run(entry), children: [
              entry.icon ?? null, h('span', { class: 'command-palette__label', children: entry.display ?? entry.label }), entry.group ? h('span', { class: 'command-palette__group', children: entry.group }) : null,
            ] }, entry.id))
          : h('li', { class: 'command-palette__empty', role: 'presentation', children: labels.searchEmpty }) }),
      ] }) });
  }

  return { ManagementHub, CommandPalette };
}
