// ADR-075: local catalog selection only; the parent applies additions to its draft.
import { AUTOSURF_SITES_DATA } from './autosurf-sites-data.js';
import { SITE_TRACKING_CATEGORY_IDS, validateAutosurfSitesData, searchAutosurfSites, mergeAutosurfSiteUrls } from './autosurf-sites.js';
import { validateAutosurfUrl } from './autosurf-shared.js';
import { createSystemMarkUi } from './system-mark-ui.js';

const PAGE_SIZE = 12, MAX_PLAN = 200;
export const AUTOSURF_SITE_THEMES = Object.freeze({
  news: ['#2563eb', 'M4 4h16v16H4zM8 8h8M8 12h3M8 16h3M14 12h2v4h-2z'],
  automotive: ['#ea580c', 'm4 10 2-5h12l2 5M3 10h18v8H3zM6 18v2m12-2v2M6 13h2m8 0h2'],
  gaming: ['#7c3aed', 'M8 7h8c3 0 4 3 5 9 .4 2-2 3-3 1l-2-2H8l-2 2c-1 2-3.4 1-3-1 1-6 2-9 5-9ZM7 10v4m-2-2h4m7-1h.01m2 2h.01'],
  shopping: ['#db2777', 'M5 7h14l1 14H4L5 7Zm3 1V6a4 4 0 0 1 8 0v2'],
  classifieds: ['#b45309', 'M3 11V4h7l11 11-6 6L3 11Zm4-4h.01'],
  finance: ['#059669', 'm3 9 9-6 9 6H3Zm2 3v6m5-6v6m4-6v6m5-6v6M3 21h18'],
  government: ['#475569', 'M4 21V9h16v12M8 21v-8h8v8M3 9l9-6 9 6M12 3V1m-7 20h14'],
  education: ['#0284c7', 'm2 9 10-5 10 5-10 5L2 9Zm4 2v6c4 3 8 3 12 0v-6m4-2v8'],
  sports: ['#16a34a', 'M8 3h8v7a4 4 0 0 1-8 0V3Zm0 2H4v4c0 3 3 4 4 4m8-8h4v4c0 3-3 4-4 4m-4 1v5m-5 2h10'],
  travel: ['#0d9488', 'm21 3-6 18-4-8-8-4L21 3Zm0 0L11 13'],
  'real-estate': ['#9333ea', 'm3 11 9-8 9 8M5 10v11h14V10M9 21v-8h6v8'],
  jobs: ['#4f46e5', 'M8 7V3h8v4M3 7h18v14H3V7Zm0 6c6 3 12 3 18 0M10 13h4v4h-4z'],
  video: ['#dc2626', 'M4 4h16v16H4zM10 8l6 4-6 4V8Z'],
  music: ['#c026d3', 'M9 17V5l11-2v12M9 9l11-2M9 17c0 4-6 4-6 1s6-4 6-1Zm11-2c0 4-6 4-6 1s6-4 6-1Z'],
  health: ['#e11d48', 'M20 5c-3-3-6 0-8 2-2-2-5-5-8-2-5 5 2 10 8 15 6-5 13-10 8-15ZM9 12h6m-3-3v6'],
  food: ['#c2410c', 'M5 3v7m3-7v7m-6-7v7c0 3 6 3 6 0m-3 3v8M19 3c-5 3-6 9-1 10h2V3h-1Zm1 10v8'],
  technology: ['#0891b2', 'M7 7h10v10H7zM10 10h4v4h-4zM9 3v4m6-4v4M9 17v4m6-4v4M3 9h4m-4 6h4m10-6h4m-4 6h4'],
  forums: ['#6366f1', 'M3 4h15v11H8l-5 5V4Zm5 4h6m-6 3h3m7-2h3v12l-4-4h-5'],
  weather: ['#0369a1', 'M10 5V2m-5 5L3 5m13 2 2-2M7 15a5 5 0 1 1 10-3M5 20a4 4 0 1 1 1-8 6 6 0 0 1 11-1 4.5 4.5 0 1 1 2 9H5Z'],
  reference: ['#57534e', 'M4 3h13v18H4c-3 0-3-4 0-4h13M4 3v14m4-9h5m-5 4h5'],
});
export const AUTOSURF_TRACKING_CATEGORY_THEMES = Object.freeze({
  'fraud-prevention': ['#db2777', 'm12 3 8 3v6c0 5-5 8-8 9-3-1-8-4-8-9V6l8-3Zm-4 9 3 3 5-6'],
  'bot-management': ['#7c3aed', 'M5 8h14v12H5zM12 8V4m-2-1h4M2 12v4m20-4v4M9 12h.01m6 0h.01M9 17h6'],
  'ecommerce-intelligence': ['#ea580c', 'M4 7h16l-1 14H5L4 7Zm4 0V6a4 4 0 0 1 8 0v1M8 17v-3m4 3v-6m4 6v-4'],
  'device-fingerprinting': ['#0891b2', 'M5 9a7 7 0 0 1 14 1v3m-10 6v-9a3 3 0 0 1 6 0v8M5 13v3m0 4v1m4 0v-2m3-9v12m7-5v3m-3 1v1'],
  'bot-detection': ['#2563eb', 'M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5M12 12l8-8M16 4h4v4M9 12h.01'],
  captcha: ['#059669', 'M4 4h16v16H4zM7 12l3 3 7-7'],
});

const localeTag = value => ({ zh_CN: 'zh-CN', pt_BR: 'pt-BR', yue: 'zh-CN', wuu: 'zh-CN' })[value] ?? value ?? 'en';
const fold = value => String(value).normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase();
export function autosurfTrackingSystemTheme(system) {
  let hash = 0;
  for (const character of system.id) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  return { '--site-color': 'hsl(' + hash % 360 + ' 64% 42%)' };
}
export function autosurfSiteCountryName(code, locale = 'en') {
  try { return new Intl.DisplayNames([localeTag(locale)], { type: 'region' }).of(code) ?? code; } catch { return code; }
}
function plannedUrls(text) {
  const urls = new Set(); let count = 0;
  if (typeof text !== 'string') return { urls, count };
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue; count++;
    try { urls.add(validateAutosurfUrl(line.trim())); } catch { /* Merge validation reports the existing invalid line. */ }
  }
  return { urls, count };
}

export function createAutosurfSitesUi({ h, useState, useEffect, useRef, translate, browserApi = globalThis.chrome, catalog = AUTOSURF_SITES_DATA }) {
  const { SystemMark } = createSystemMarkUi({ h });
  const t = key => translate('autosurf_sites_' + key);
  const sourceTitle = source => /^site-catalogue-\d{8}$/.test(source.id) ? t('catalog') : source.title;
  const categoryText = id => t('category_' + id.replaceAll('-', '_'));
  const trackingCategoryText = id => t('system_category_' + id.replaceAll('-', '_'));
  const siteUrl = site => site.origin + '/';
  const icon = (name, className = '') => {
    const path = ({ search: 'm21 21-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z', globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z', chevron: 'm7 10 5 5 5-5', check: 'm5 12 4 4L19 6', plus: 'M12 5v14M5 12h14', close: 'm6 6 12 12M18 6 6 18', grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z', arrow: 'M5 12h14m-6-6 6 6-6 6' })[name] ?? AUTOSURF_TRACKING_CATEGORY_THEMES[name]?.[1] ?? AUTOSURF_SITE_THEMES[name]?.[1] ?? AUTOSURF_SITE_THEMES.reference[1];
    return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'autosurf-sites-icon ' + className, 'aria-hidden': true, focusable: false, children: h('path', { d: path }) });
  };
  const flag = country => h('img', { src: 'icons/countries/' + country.toLowerCase() + '.svg', width: 25, height: 18, alt: '', class: 'autosurf-sites-flag', 'data-site-country-flag': country, loading: 'lazy', draggable: false });
  const theme = category => ({ '--site-color': AUTOSURF_SITE_THEMES[category]?.[0] ?? '#2563eb' });
  const trackingTheme = category => ({ '--site-color': AUTOSURF_TRACKING_CATEGORY_THEMES[category][0] });
  const systemIcon = system => SystemMark({ identity: system.id, className: 'autosurf-sites-system__logo' });

  function AutosurfSites({ locale = 'en', currentUrls = '', disabled = false, onAdd = () => null }) {
    const [query, setQuery] = useState(''), [country, setCountry] = useState('all'), [category, setCategory] = useState('all');
    // ADR-082: independent system toggles use OR; active filters remain visible above the lists.
    const [trackingCategory, setTrackingCategory] = useState('all'), [trackingSystems, setTrackingSystems] = useState(() => []), [systemQuery, setSystemQuery] = useState(''), [systemsExpanded, setSystemsExpanded] = useState(false);
    const [page, setPage] = useState(0), [selected, setSelected] = useState(() => new Set()), [feedback, setFeedback] = useState(null);
    const [countryOpen, setCountryOpen] = useState(false), [countrySearch, setCountrySearch] = useState(''), [activeCountry, setActiveCountry] = useState(0);
    const countryRoot = useRef(null), countryInput = useRef(null), countryTrigger = useRef(null), siteSearchInput = useRef(null), activeFilterRoot = useRef(null), restoreFilterFocus = useRef(false), pendingSystemFocus = useRef(null);
    const countryCache = useRef(null), planCache = useRef(null), selectionCache = useRef(null), mergeCache = useRef(null), searchCache = useRef(null), systemCache = useRef(null);
    const data = validateAutosurfSitesData(catalog);
    if (planCache.current?.text !== currentUrls) planCache.current = { text: currentUrls, plan: plannedUrls(currentUrls), error: mergeAutosurfSiteUrls(currentUrls, []).error };
    const plan = planCache.current.plan, available = Math.max(0, MAX_PLAN - plan.count);
    if (searchCache.current?.data !== data || searchCache.current?.query !== query || searchCache.current?.country !== country || searchCache.current?.category !== category || searchCache.current?.trackingCategory !== trackingCategory || searchCache.current?.trackingSystems !== trackingSystems || searchCache.current?.page !== page) searchCache.current = { data, query, country, category, trackingCategory, trackingSystems, page, result: searchAutosurfSites(data, { query, country, category, trackingCategory, trackingSystems, offset: page * PAGE_SIZE, limit: PAGE_SIZE }) };
    const search = searchCache.current.result;
    if (systemCache.current?.systems !== data.trackingSystems || systemCache.current?.category !== trackingCategory || systemCache.current?.query !== systemQuery || systemCache.current?.counts !== search.trackingSystemCounts) {
      const queryText = fold(systemQuery.trim());
      const matches = data.trackingSystems.filter(system => (trackingCategory === 'all' || system.categories.includes(trackingCategory)) && (!queryText || fold(system.name + ' ' + system.id).includes(queryText)));
      systemCache.current = { systems: data.trackingSystems, category: trackingCategory, query: systemQuery, counts: search.trackingSystemCounts, byId: new Map(data.trackingSystems.map(system => [system.id, system])), rows: [...matches.filter(system => search.trackingSystemCounts[system.id] > 0), ...matches.filter(system => !search.trackingSystemCounts[system.id])] };
    }
    const systemsById = systemCache.current.byId, filteredSystems = systemCache.current.rows, selectedSystemIds = new Set(trackingSystems);
    const chosenSystems = data.trackingSystems.filter(system => selectedSystemIds.has(system.id));
    const unselectedSystems = filteredSystems.filter(system => !selectedSystemIds.has(system.id));
    const listedSystemCount = chosenSystems.length + unselectedSystems.length;
    const shownSystems = [...chosenSystems, ...(systemsExpanded || systemQuery.trim() ? unselectedSystems : unselectedSystems.slice(0, Math.max(0, 12 - chosenSystems.length)))];
    const pageCount = Math.max(1, Math.ceil(search.total / PAGE_SIZE));
    if (countryCache.current?.locale !== locale || countryCache.current?.countries !== data.countries) {
      let local, english;
      try { local = new Intl.DisplayNames([localeTag(locale)], { type: 'region' }); } catch {}
      try { english = new Intl.DisplayNames(['en'], { type: 'region' }); } catch {}
      const names = new Map(data.countries.map(code => [code, local?.of(code) ?? code]));
      const aliases = new Map(data.countries.map(code => [code, fold(code + ' ' + names.get(code) + ' ' + (english?.of(code) ?? code))]));
      let sorted = [...data.countries];
      try { const collator = new Intl.Collator(localeTag(locale)); sorted.sort((a, b) => collator.compare(names.get(a), names.get(b))); } catch { sorted.sort(); }
      countryCache.current = { locale, countries: data.countries, names, aliases, sorted };
    }
    const names = countryCache.current.names;
    const countryQuery = fold(countrySearch.trim());
    const countryOptions = countryCache.current.sorted.filter(code => !countryQuery || countryCache.current.aliases.get(code).includes(countryQuery));
    const exactCountryIndex = countryOptions.findIndex(code => code.toLowerCase() === countryQuery);
    if (exactCountryIndex > 0) countryOptions.unshift(...countryOptions.splice(exactCountryIndex, 1));
    if (!countryQuery) countryOptions.unshift('all');
    const activeOption = Math.min(activeCountry, Math.max(0, countryOptions.length - 1));
    if (selectionCache.current?.selection !== selected || selectionCache.current?.sites !== data.sites) selectionCache.current = { selection: selected, sites: data.sites, rows: data.sites.filter(site => selected.has(site.id)) };
    const selectedRows = selectionCache.current.rows;
    if (mergeCache.current?.text !== currentUrls || mergeCache.current?.selection !== selected) mergeCache.current = { text: currentUrls, selection: selected, result: mergeAutosurfSiteUrls(currentUrls, selectedRows.map(site => site.origin)) };
    const preview = mergeCache.current.result;
    const selectedCount = selectedRows.length;
    const newSelectedCount = selectedRows.filter(site => !plan.urls.has(siteUrl(site))).length;
    const planInvalid = planCache.current.error && planCache.current.error !== 'limit';
    const currentRows = search.rows.filter(site => !plan.urls.has(siteUrl(site)));
    const pageSelected = currentRows.length > 0 && currentRows.every(site => selected.has(site.id));
    useEffect(() => { if (page >= pageCount) setPage(Math.max(0, pageCount - 1)); }, [pageCount, page]);
    useEffect(() => {
      if (!restoreFilterFocus.current) return;
      restoreFilterFocus.current = false;
      try { (activeFilterRoot.current?.querySelector('button') ?? siteSearchInput.current)?.focus(); } catch {}
    }, [query, country, category, trackingCategory, trackingSystems, systemQuery]);
    useEffect(() => {
      if (!countryOpen) return;
      try { countryInput.current?.focus(); } catch {}
      const outside = event => { if (!countryRoot.current?.contains?.(event.target)) setCountryOpen(false); };
      globalThis.document?.addEventListener('pointerdown', outside);
      return () => globalThis.document?.removeEventListener('pointerdown', outside);
    }, [countryOpen]);
    useEffect(() => {
      if (!countryOpen || !countryOptions[activeOption]) return;
      try { globalThis.document?.getElementById('autosurf-site-country-' + countryOptions[activeOption])?.scrollIntoView({ block: 'nearest' }); } catch {}
    }, [countryOpen, activeOption, countrySearch, locale]);
    const filter = (setter, value) => { setter(value); setPage(0); setFeedback(null); };
    const chooseTrackingCategory = value => {
      filter(setTrackingCategory, value); setSystemsExpanded(false);
      if (value !== 'all') setTrackingSystems(previous => previous.filter(id => systemsById.get(id).categories.includes(value)));
    };
    const toggleTrackingSystem = (id, event) => {
      const target = event?.currentTarget;
      if (target && event.detail === 0 && globalThis.document?.activeElement === target) pendingSystemFocus.current = { id, element: target };
      filter(setTrackingSystems, previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]);
    };
    const systemOptionsRef = element => {
      if (!element || !pendingSystemFocus.current) return;
      const pending = pendingSystemFocus.current; pendingSystemFocus.current = null;
      const document = globalThis.document;
      if (document?.activeElement !== pending.element && document?.activeElement !== document?.body) return;
      try { (element.querySelector('[data-autosurf-sites-system="' + pending.id + '"]') ?? element.querySelector('[data-autosurf-sites-system="all"]'))?.focus(); } catch {}
    };
    const chooseCountry = value => { filter(setCountry, value); setCountryOpen(false); setCountrySearch(''); setActiveCountry(0); try { countryTrigger.current?.focus(); } catch {} };
    const countryKey = event => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') { event.preventDefault(); setCountryOpen(false); try { countryTrigger.current?.focus(); } catch {} }
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const size = countryOptions.length;
        setActiveCountry(previous => event.key === 'Home' ? 0 : event.key === 'End' ? Math.max(0, size - 1) : size ? (previous + (event.key === 'ArrowDown' ? 1 : -1) + size) % size : 0);
      } else if (event.key === 'Enter' && countryOptions[activeOption]) { event.preventDefault(); chooseCountry(countryOptions[activeOption]); }
    };
    function toggle(site) {
      if (disabled || plan.urls.has(siteUrl(site))) return;
      setFeedback(null);
      setSelected(previous => { const next = new Set(previous); if (next.has(site.id)) next.delete(site.id); else if (data.sites.filter(row => next.has(row.id) && !plan.urls.has(siteUrl(row))).length < available) next.add(site.id); return next; });
    }
    function selectPage() {
      if (disabled) return;
      setFeedback(null);
      setSelected(previous => {
        const next = new Set(previous);
        if (pageSelected) for (const site of currentRows) next.delete(site.id);
        else {
          let count = data.sites.filter(site => next.has(site.id) && !plan.urls.has(siteUrl(site))).length;
          for (const site of currentRows) { if (next.has(site.id)) continue; if (count >= available) break; next.add(site.id); count++; }
        }
        return next;
      });
    }
    function add() {
      if (disabled || !selectedCount || preview.error) return;
      let result;
      try { result = onAdd(selectedRows.map(site => site.origin)); } catch { result = { error: 'invalid-input' }; }
      if (!result || result.error) { setFeedback({ error: result?.error ?? 'invalid-selection' }); return; }
      setFeedback({ added: result.added, duplicates: result.duplicates }); setSelected(new Set());
    }
    const resetFilters = () => { setQuery(''); setCountry('all'); setCategory('all'); setTrackingCategory('all'); setTrackingSystems([]); setSystemQuery(''); setCountryOpen(false); setCountrySearch(''); setActiveCountry(0); setSystemsExpanded(false); setPage(0); setFeedback(null); };
    const selectedLabel = country === 'all' ? t('all_countries') : names.get(country);
    const number = value => { try { return new Intl.NumberFormat(localeTag(locale)).format(value); } catch { return String(value); } };
    const activeFilters = [
      ...chosenSystems.map(system => ({ id: 'system:' + system.id, system: system.id, label: system.name, mark: systemIcon(system), style: autosurfTrackingSystemTheme(system), remove: () => toggleTrackingSystem(system.id) })),
      ...(country === 'all' ? [] : [{ id: 'country', label: selectedLabel, mark: flag(country), remove: () => filter(setCountry, 'all') }]),
      ...(category === 'all' ? [] : [{ id: 'category', label: categoryText(category), mark: icon(category), style: theme(category), remove: () => filter(setCategory, 'all') }]),
      ...(trackingCategory === 'all' ? [] : [{ id: 'tracking-category', label: trackingCategoryText(trackingCategory), mark: icon(trackingCategory), style: trackingTheme(trackingCategory), remove: () => chooseTrackingCategory('all') }]),
      ...(query.trim() ? [{ id: 'query', label: t('search') + ': ' + query.trim(), mark: icon('search'), remove: () => filter(setQuery, '') }] : []),
      ...(systemQuery.trim() ? [{ id: 'system-query', label: t('system_search') + ': ' + systemQuery.trim(), mark: icon('search'), remove: () => setSystemQuery('') }] : []),
    ];
    return h('section', { class: 'autosurf-sites', 'aria-labelledby': 'autosurf-sites-title', 'data-autosurf-sites': true, children: [
      h('header', { class: 'autosurf-sites-heading', children: [h('span', { class: 'autosurf-sites-heading__icon', children: icon('globe') }), h('div', { children: h('h3', { id: 'autosurf-sites-title', class: 'autosurf-sites-section-title', children: t('title') }) }), h('span', { class: 'autosurf-sites-catalog-count', children: [icon('grid'), t('catalog'), ' · ', number(data.sites.length)] })] }),
      h('div', { class: 'autosurf-sites-filters', children: [
        h('label', { class: 'autosurf-sites-search', children: [icon('search'), h('span', { class: 'autosurf-sites-sr', children: t('search') }), h('input', { ref: siteSearchInput, type: 'search', value: query, maxLength: 120, placeholder: t('search_placeholder'), autoComplete: 'off', 'data-autosurf-sites-search': true, onInput: event => filter(setQuery, event.currentTarget.value) })] }),
        h('div', { class: 'autosurf-sites-country', ref: countryRoot, onBlur: event => { if (!event.currentTarget.contains(event.relatedTarget)) setCountryOpen(false); }, children: [
          h('button', { type: 'button', class: 'autosurf-sites-country__trigger', ref: countryTrigger, 'aria-label': t('country') + ': ' + selectedLabel, 'aria-haspopup': 'listbox', 'aria-expanded': countryOpen, 'data-autosurf-sites-country': country, onClick: () => { setCountryOpen(value => !value); setCountrySearch(''); setActiveCountry(0); }, onKeyDown: event => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setCountryOpen(true); } }, children: [country === 'all' ? icon('globe') : flag(country), h('span', { children: selectedLabel }), icon('chevron')] }),
          countryOpen ? h('div', { class: 'autosurf-sites-country__popover', children: [
            h('label', { class: 'autosurf-sites-country__search', children: [icon('search'), h('span', { class: 'autosurf-sites-sr', children: t('country_search') }), h('input', { ref: countryInput, role: 'combobox', type: 'search', value: countrySearch, maxLength: 80, placeholder: t('country_search'), autoComplete: 'off', 'aria-autocomplete': 'list', 'aria-expanded': true, 'aria-controls': 'autosurf-sites-countries', 'aria-activedescendant': countryOptions[activeOption] ? 'autosurf-site-country-' + countryOptions[activeOption] : undefined, 'data-autosurf-sites-country-search': true, onKeyDown: countryKey, onInput: event => { setCountrySearch(event.currentTarget.value); setActiveCountry(0); } })] }),
            h('div', { id: 'autosurf-sites-countries', role: 'listbox', 'aria-label': t('country'), class: 'autosurf-sites-country__list', children: countryOptions.length ? countryOptions.map((code, index) => h('button', { type: 'button', role: 'option', id: 'autosurf-site-country-' + code, tabIndex: -1, class: 'autosurf-sites-country__option' + (index === activeOption ? ' is-highlighted' : ''), 'aria-selected': country === code, 'data-autosurf-sites-country-option': code, onMouseEnter: () => setActiveCountry(index), onClick: () => chooseCountry(code), children: [code === 'all' ? icon('globe') : flag(code), h('span', { children: code === 'all' ? t('all_countries') : names.get(code) }), h('small', { children: number(search.countryCounts[code] ?? 0) }), country === code ? icon('check') : null] })) : h('p', { class: 'autosurf-sites-country__empty', children: t('countries_empty') }) }),
          ] }) : null,
        ] }),
      ] }),
      activeFilters.length ? h('div', { ref: activeFilterRoot, class: 'autosurf-sites-active-filters', 'data-autosurf-sites-active-filters': true, role: 'group', 'aria-labelledby': 'autosurf-sites-active-filters-title', children: [
        h('div', { class: 'autosurf-sites-active-filters__heading', children: [h('h4', { id: 'autosurf-sites-active-filters-title', class: 'autosurf-sites-facet__title', children: t('active_filters') }), h('button', { type: 'button', class: 'autosurf-sites-text-button', 'data-autosurf-sites-clear-all-filters': true, onClick: () => { restoreFilterFocus.current = true; resetFilters(); }, children: [icon('close'), t('clear_all_filters')] })] }),
        h('div', { class: 'autosurf-sites-active-filters__chips', children: activeFilters.map(item => h('button', { key: item.id, type: 'button', class: 'autosurf-sites-active-filter', style: item.style, title: t('remove_filter') + ': ' + item.label, 'aria-label': t('remove_filter') + ': ' + item.label, 'data-autosurf-sites-remove-filter': item.id, 'data-autosurf-sites-active-system': item.system, onClick: () => { restoreFilterFocus.current = true; item.remove(); }, children: [item.mark, h('span', { children: item.label }), icon('close', 'autosurf-sites-active-filter__close')] }, item.id)) }),
      ] }) : null,
      h('div', { class: 'autosurf-sites-facet', children: [h('h4', { id: 'autosurf-sites-categories-title', class: 'autosurf-sites-facet__title', children: t('categories') }), h('div', { class: 'autosurf-sites-topics', role: 'group', 'aria-labelledby': 'autosurf-sites-categories-title', children: [
        h('button', { type: 'button', class: 'autosurf-sites-topic autosurf-sites-topic--all', 'aria-pressed': category === 'all', 'data-autosurf-sites-category': 'all', onClick: () => filter(setCategory, 'all'), children: [icon('grid'), h('span', { children: t('all_categories') }), h('small', { children: number(search.categoryCounts.all ?? search.total) })] }),
        ...data.categories.map(id => h('button', { type: 'button', class: 'autosurf-sites-topic', style: theme(id), 'aria-pressed': category === id, 'data-autosurf-sites-category': id, onClick: () => filter(setCategory, id), children: [icon(id), h('span', { children: categoryText(id) }), h('small', { children: number(search.categoryCounts[id] ?? 0) })] })),
      ] })] }),
      data.trackingSystems.length ? h('div', { class: 'autosurf-sites-facet autosurf-sites-systems', 'data-autosurf-sites-systems': true, children: [
        h('div', { class: 'autosurf-sites-facet__heading autosurf-sites-heading autosurf-sites-systems-heading', children: [h('span', { class: 'autosurf-sites-heading__icon', children: icon('bot-detection') }), h('div', { class: 'autosurf-sites-systems-heading__title', children: [h('h4', { id: 'autosurf-sites-systems-title', class: 'autosurf-sites-facet__title autosurf-sites-section-title', children: t('tracking_systems') }), h('span', { class: 'autosurf-sites-facet__count', 'data-autosurf-sites-system-count': listedSystemCount, children: number(listedSystemCount) })] }), data.trackingSystems.length > 12 ? h('label', { class: 'autosurf-sites-system-search', children: [icon('search'), h('span', { class: 'autosurf-sites-sr', children: t('system_search') }), h('input', { type: 'search', maxLength: 120, autoComplete: 'off', value: systemQuery, placeholder: t('system_search'), 'data-autosurf-sites-system-search': true, onInput: event => setSystemQuery(event.currentTarget.value) })] }) : null] }),
        h('div', { class: 'autosurf-sites-system-categories', children: [
          h('h5', { id: 'autosurf-sites-system-categories-title', class: 'autosurf-sites-facet__title', children: t('system_categories') }),
          h('div', { class: 'autosurf-sites-topics autosurf-sites-system-category-options', role: 'group', 'aria-labelledby': 'autosurf-sites-system-categories-title', children: [
            h('button', { type: 'button', class: 'autosurf-sites-topic autosurf-sites-topic--all', 'aria-pressed': trackingCategory === 'all', 'data-autosurf-sites-system-category': 'all', onClick: () => chooseTrackingCategory('all'), children: [icon('grid'), h('span', { children: t('all_system_categories') }), h('small', { children: number(search.trackingCategoryCounts.all) })] }),
            ...SITE_TRACKING_CATEGORY_IDS.map(id => h('button', { type: 'button', class: 'autosurf-sites-topic', style: trackingTheme(id), 'aria-pressed': trackingCategory === id, 'data-autosurf-sites-system-category': id, onClick: () => chooseTrackingCategory(id), children: [icon(id), h('span', { children: trackingCategoryText(id) }), h('small', { children: number(search.trackingCategoryCounts[id]) })] })),
          ] }),
        ] }),
        chosenSystems.length ? h('p', { class: 'autosurf-sites-system-selection', 'data-autosurf-sites-selected-systems': chosenSystems.length, children: [h('strong', { children: t('selected_systems') + ': ' + number(chosenSystems.length) }), h('span', { children: t('any_selected_system') })] }) : null,
        h('div', { id: 'autosurf-sites-system-options', ref: systemOptionsRef, class: 'autosurf-sites-topics autosurf-sites-system-options' + (systemsExpanded || systemQuery.trim() || chosenSystems.length > 12 ? ' is-expanded' : ''), role: 'group', 'aria-labelledby': 'autosurf-sites-systems-title', children: [
          h('button', { type: 'button', class: 'autosurf-sites-topic autosurf-sites-topic--all', 'aria-pressed': trackingSystems.length === 0, 'data-autosurf-sites-system': 'all', onClick: () => filter(setTrackingSystems, []), children: [icon('grid'), h('span', { children: t('all_systems') }), h('small', { children: number(search.trackingSystemCounts.all) })] }),
          ...shownSystems.map(system => h('button', { key: system.id, type: 'button', class: 'autosurf-sites-topic autosurf-sites-system', style: autosurfTrackingSystemTheme(system), 'aria-pressed': selectedSystemIds.has(system.id), 'data-autosurf-sites-system': system.id, onClick: event => toggleTrackingSystem(system.id, event), children: [systemIcon(system), h('span', { children: system.name }), h('small', { children: number(search.trackingSystemCounts[system.id]) })] }, system.id)),
        ] }),
        !filteredSystems.length ? h('p', { class: 'autosurf-sites-systems-empty', role: 'status', children: t('systems_empty') }) : null,
        listedSystemCount > 12 && !systemQuery.trim() ? h('button', { type: 'button', class: 'autosurf-sites-text-button autosurf-sites-systems-toggle', 'aria-expanded': systemsExpanded, 'aria-controls': 'autosurf-sites-system-options', 'data-autosurf-sites-systems-toggle': true, onClick: () => setSystemsExpanded(value => !value), children: [t(systemsExpanded ? 'show_fewer_systems' : 'show_all_systems'), icon('chevron')] }) : null,
      ] }) : null,
      h('div', { class: 'autosurf-sites-results-heading', children: [h('p', { role: 'status', 'aria-live': 'polite', 'aria-atomic': true, children: [t('results'), ': ', h('strong', { children: number(search.total) })] }), h('button', { type: 'button', class: 'autosurf-sites-text-button', 'aria-pressed': pageSelected, disabled: disabled || !currentRows.length || !pageSelected && newSelectedCount >= available, onClick: selectPage, 'data-autosurf-sites-select-page': true, children: [icon(pageSelected ? 'check' : 'plus'), t('select_page')] })] }),
      search.rows.length ? h('div', { class: 'autosurf-sites-results', 'data-autosurf-sites-results': true, children: search.rows.map(site => {
        const planned = plan.urls.has(siteUrl(site)), checked = selected.has(site.id), primary = category !== 'all' && site.categories.includes(category) ? category : site.categories[0], full = !checked && newSelectedCount >= available;
        const shownCountries = country === 'all' ? site.countries : [country, ...site.countries.filter(code => code !== country)];
        const categorySystems = trackingCategory === 'all' ? [] : site.trackingSystems.filter(id => !selectedSystemIds.has(id) && systemsById.get(id).categories.includes(trackingCategory));
        const orderedSystems = !trackingSystems.length && trackingCategory === 'all' ? site.trackingSystems : [...site.trackingSystems.filter(id => selectedSystemIds.has(id)), ...categorySystems, ...site.trackingSystems.filter(id => !selectedSystemIds.has(id) && !categorySystems.includes(id))];
        return h('label', { key: site.id, class: 'autosurf-sites-result' + (checked ? ' is-selected' : '') + (planned ? ' is-planned' : ''), style: theme(primary), 'data-autosurf-site': site.id, children: [
          h('input', { type: 'checkbox', checked: planned || checked, disabled: disabled || planned || full, 'data-autosurf-site-select': site.id, onChange: () => toggle(site) }),
          h('span', { class: 'autosurf-sites-result__icon', children: icon(primary) }),
          h('span', { class: 'autosurf-sites-result__body', children: [h('strong', { dir: 'auto', children: site.name }), h('span', { class: 'autosurf-sites-result__domain', dir: 'ltr', children: new URL(site.origin).hostname }), h('span', { class: 'autosurf-sites-result__meta', children: [h('span', { class: 'autosurf-sites-result__category', children: primary ? categoryText(primary) : t('uncategorized') }), h('span', { class: 'autosurf-sites-result__countries', children: [ ...shownCountries.slice(0, 3).map(code => h('span', { title: names.get(code), children: flag(code) })), site.countries.length > 3 ? h('small', { children: '+' + number(site.countries.length - 3) }) : null ] })] }), orderedSystems.length ? h('span', { class: 'autosurf-sites-result__systems', children: [ ...orderedSystems.slice(0, 2).map(id => { const system = systemsById.get(id); return h('span', { class: 'autosurf-sites-result__system', style: autosurfTrackingSystemTheme(system), title: system.name, children: [systemIcon(system), system.name] }); }), orderedSystems.length > 2 ? h('small', { title: orderedSystems.slice(2).map(id => systemsById.get(id).name).join(', '), children: '+' + number(orderedSystems.length - 2) }) : null ] }) : null, planned ? h('span', { class: 'autosurf-sites-result__planned', children: [icon('check'), t('in_plan')] }) : null ] }),
        ] }, site.id);
      }) }) : h('div', { class: 'autosurf-sites-empty', 'data-autosurf-sites-empty': true, children: [icon('search'), h('strong', { children: t('empty') }), h('p', { children: t('empty_hint') }), h('button', { type: 'button', class: 'autosurf-sites-text-button', onClick: resetFilters, 'data-autosurf-sites-clear-filters': true, children: t('clear_filters') })] }),
      search.total > PAGE_SIZE ? h('nav', { class: 'autosurf-sites-pagination', 'aria-label': t('page'), children: [h('button', { type: 'button', disabled: page === 0, onClick: () => setPage(value => Math.max(0, value - 1)), 'data-autosurf-sites-previous': true, children: t('previous') }), h('span', { children: [t('page'), ' ', number(Math.min(page + 1, pageCount)), ' / ', number(pageCount)] }), h('button', { type: 'button', disabled: page + 1 >= pageCount, onClick: () => setPage(value => Math.min(pageCount - 1, value + 1)), 'data-autosurf-sites-next': true, children: t('next') })] }) : null,
      h('footer', { class: 'autosurf-sites-footer', children: [h('div', { class: 'autosurf-sites-selection', children: [h('span', { class: 'autosurf-sites-selection__count', 'data-autosurf-sites-selected': selectedCount, children: number(selectedCount) }), h('div', { children: [h('strong', { children: t('selected') }), h('small', { children: [t('available'), ': ', number(available)] })] })] }), h('button', { type: 'button', class: 'autosurf-sites-text-button', disabled: !selectedCount, onClick: () => { setSelected(new Set()); setFeedback(null); }, 'data-autosurf-sites-clear-selection': true, children: t('clear_selection') }), h('button', { type: 'button', class: 'autosurf-sites-add', disabled: disabled || !selectedCount || Boolean(preview.error), onClick: add, 'data-autosurf-sites-add': true, children: [icon('plus'), t('add'), selectedCount ? h('span', { children: number(selectedCount) }) : null] })] }),
      feedback ? h('p', { class: 'autosurf-sites-feedback' + (feedback.error ? ' is-error' : ''), role: feedback.error ? 'alert' : 'status', 'data-autosurf-sites-feedback': true, children: feedback.error ? t(feedback.error === 'limit' ? 'error_capacity' : feedback.error === 'inactive' ? 'error_unavailable' : feedback.error === 'invalid-selection' ? 'error_selection' : 'error_existing') : [t('added'), ': ', number(feedback.added ?? 0), feedback.duplicates ? ' · ' + t('duplicates') + ': ' + number(feedback.duplicates) : ''] }) : planInvalid ? h('p', { class: 'autosurf-sites-feedback', children: t('error_existing') }) : preview.error === 'limit' ? h('p', { class: 'autosurf-sites-feedback', children: t('error_capacity') }) : null,
      Array.isArray(data.sources) && data.sources.length ? h('details', { class: 'autosurf-sites-sources', children: [h('summary', { children: t('sources') }), ...data.sources.map(source => h('p', { children: [source.url ? h('a', { href: source.url, target: '_blank', rel: 'noopener noreferrer', children: sourceTitle(source) }) : h('span', { children: sourceTitle(source) }), ' · ', source.url ? h('a', { href: browserApi?.runtime?.getURL?.('autosurf-sites-LICENSE.txt') ?? 'autosurf-sites-LICENSE.txt', target: '_blank', rel: 'noopener noreferrer', children: source.license }) : h('span', { children: source.license }), source.asOf ? ' · ' + source.asOf : ''] }))] }) : null,
    ] });
  }
  return { AutosurfSites };
}
