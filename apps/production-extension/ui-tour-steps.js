// ADR-111: the steps of every guided tour of the Options UI (ui-tour.js runs them). Data only, no imports: one tour per Options section,
// 3 to 7 steps each, every step a real part of that section. `view` is where the step lives (a section and, in Antidetect, a level);
// `target` is a key of TOUR_TARGETS. Copy keys are derived from the step id: step_<id>_title and step_<id>_body (ui-tour-labels.js), so a
// step id is unique across all tours. A tour is named like its section, which is also the id of its header button.
const step = (id, view, target) => Object.freeze({ id, view: Object.freeze({ ...view }), target });
const only = (section, ...ids) => ids.map(id => step(id, { section }, id));

export const DEFAULT_TOUR = 'antidetect';
export const TOURS = Object.freeze({
  hub: Object.freeze([
    step('hub-overview', { section: 'hub' }, 'hub-head'),
    ...only('hub', 'hub-defense', 'hub-attack', 'hub-tools'),
  ]),
  detector: Object.freeze(only('detector', 'detector-switch', 'detector-source', 'detector-report', 'detector-history')),
  api: Object.freeze(only('api', 'api-switch', 'api-scope', 'api-find', 'api-rules', 'api-transfer')),
  firewall: Object.freeze(only('firewall', 'firewall-switch', 'firewall-features', 'firewall-mode')),
  // The first tour (round 5). Its Proxy step moved to the Proxy tour, so each tour stays inside its own section.
  antidetect: Object.freeze([
    step('levels', { section: 'antidetect', level: 'quick' }, 'levels'),
    step('generator', { section: 'antidetect', level: 'quick' }, 'generator'),
    step('region', { section: 'antidetect', level: 'os' }, 'region'),
    step('hints', { section: 'antidetect', level: 'os' }, 'hints'),
    step('library', { section: 'antidetect', level: 'quick' }, 'library'),
    step('apply', { section: 'antidetect', level: 'quick' }, 'apply'),
    step('finish', { section: 'antidetect', level: 'quick' }, 'master'),
  ]),
  autosurf: Object.freeze(only('autosurf', 'autosurf-switch', 'autosurf-sites', 'autosurf-plan', 'autosurf-run', 'autosurf-results')),
  cookies: Object.freeze(only('cookies', 'cookies-scope', 'cookies-list', 'cookies-transfer')),
  proxy: Object.freeze([
    ...only('proxy', 'proxy-switch', 'proxy-route', 'proxy-protect'),
    step('proxy-list', { section: 'proxy' }, 'proxy'),
    step('proxy-panels', { section: 'proxy' }, 'proxy-panels'),
  ]),
  integrations: Object.freeze(only('integrations', 'integrations-list', 'integrations-precursor', 'integrations-geo')),
  settings: Object.freeze(only('settings', 'settings-observation', 'settings-scope', 'settings-clear', 'settings-debug')),
  contacts: Object.freeze(only('contacts', 'contacts-sites', 'contacts-social', 'contacts-copy')),
  'browser-debug': Object.freeze(only('browser-debug', 'debug-datasets', 'debug-load', 'debug-export')),
});
export const TOUR_IDS = Object.freeze(Object.keys(TOURS));

const inPanel = (section, ...selectors) => Object.freeze(selectors.map(selector => '[data-management-panel="' + section + '"] ' + selector));

// Dedicated anchors win: any element with `data-tour="<key>"` (several keys may share one attribute, separated by spaces). The
// selectors below are the older hooks of the same parts: they find a part while no anchor exists, and they are scoped to the panel of
// their section, so a part of another section can never be taken. A key without a visible match skips its step.
export const TOUR_TARGETS = Object.freeze({
  // Antidetect
  levels: Object.freeze(['[data-antidetect-navigation]']),
  generator: Object.freeze(['[data-profile-presets]', '[data-profile-generate]']),
  region: Object.freeze(['[data-profile-region]']),
  hints: Object.freeze(['[data-profile-level="os"] [data-profile-source]']),
  library: Object.freeze(['[data-profile-library-panel]']),
  apply: Object.freeze(['[data-profile-apply]']),
  master: Object.freeze(['[data-antidetect-master]']),
  // Proxy: the anchor of the list header, then the two older hooks
  proxy: Object.freeze(['[data-proxy-manager]', '[data-proxy-workspace]']),
  'proxy-switch': inPanel('proxy', '[data-proxy-master]', '[data-proxy-disconnect][role="switch"]'),
  'proxy-route': inPanel('proxy', '.pm-mode'),
  'proxy-protect': inPanel('proxy', '.pm-protect'),
  'proxy-panels': inPanel('proxy', '.pm-disclosures'),
  // Control center
  'hub-head': inPanel('hub', '.hub__head'),
  'hub-defense': inPanel('hub', '[data-hub-group="defense"]'),
  'hub-attack': inPanel('hub', '[data-hub-group="attack"]'),
  'hub-tools': inPanel('hub', '[data-hub-group="tools"]'),
  // Detector
  'detector-switch': inPanel('detector', '[data-observation-master]'),
  'detector-source': inPanel('detector', '.detector-workspace__source'),
  'detector-report': inPanel('detector', '[data-detector-state]', '[data-detector-host]'),
  'detector-history': inPanel('detector', '[data-detector-history]'),
  // API Guard
  'api-switch': inPanel('api', '[data-protection-master]'),
  'api-scope': inPanel('api', '.api-config-toolbar__settings', '[data-protection-scope]'),
  'api-find': inPanel('api', '[data-protection-search]'),
  'api-rules': inPanel('api', '.api-config-rule', '[data-protection-group]'),
  'api-transfer': inPanel('api', '[data-api-config-transfer]'),
  // Firewall
  'firewall-switch': inPanel('firewall', '[data-workspace-master="firewall"] [data-protect-toggle="status"]'),
  'firewall-features': inPanel('firewall', '[data-protect-features]'),
  'firewall-mode': inPanel('firewall', '[data-protect-preset-preview]', '[data-protect-preset]'),
  // Autosurfer
  'autosurf-switch': inPanel('autosurf', '[data-autosurf-master]'),
  'autosurf-sites': inPanel('autosurf', '[data-autosurf-sites] .autosurf-sites-filters', '[data-autosurf-sites]'),
  'autosurf-plan': inPanel('autosurf', 'form[aria-labelledby="autosurf-settings-title"]'),
  'autosurf-run': inPanel('autosurf', '.autosurf-run'),
  'autosurf-results': inPanel('autosurf', 'section[aria-labelledby="autosurf-results-title"]'),
  // Cookies
  'cookies-scope': inPanel('cookies', '.cookies-workspace-scope'),
  'cookies-list': inPanel('cookies', '.cookies-workspace-toolbar'),
  'cookies-transfer': inPanel('cookies', '.cookies-workspace-header .cookies-workspace-actions', '[data-cookies-import]'),
  // Integrations
  'integrations-list': inPanel('integrations', '[data-management-integrations]'),
  'integrations-precursor': inPanel('integrations', '[data-api-precursor]'),
  'integrations-geo': inPanel('integrations', '[data-api-proxy-geo]'),
  // Settings
  'settings-observation': inPanel('settings', 'details.section'),
  'settings-scope': inPanel('settings', 'form.scope'),
  'settings-clear': inPanel('settings', 'section:has(> #options-clear-title)', '#options-clear-title'),
  'settings-debug': inPanel('settings', '[data-settings-browser-debug]'),
  // Contacts
  'contacts-sites': inPanel('contacts', '[data-contacts-group="sites"]'),
  'contacts-social': inPanel('contacts', '[data-contacts-group="social"]'),
  'contacts-copy': inPanel('contacts', '[data-contact-copy]'),
  // Browser Debug
  'debug-datasets': inPanel('browser-debug', '.browser-debug-datasets'),
  'debug-load': inPanel('browser-debug', '[data-browser-debug-view]'),
  'debug-export': inPanel('browser-debug', '[data-browser-debug-export]'),
});
