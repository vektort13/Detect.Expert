// ADR-109: the settings page of the Proxy Manager Geolocation API. It only talks to the geo controller (proxy-geo-controller.js) and never
// touches the network itself. A key is typed into a password input, handed to the controller once and cleared; no key is ever shown again,
// echoed, stored or put into an attribute here. Provider text is rendered with textContent only. The DOM is built once and then updated
// in place, so a change made in another tab never wipes what is being typed or moves the focus.
import { GEO_ERRORS, GEO_LIMITS, GEO_MAXMIND_SERVICES, GEO_PROVIDERS, GEO_PROVIDER_INFO, GEO_TEST_IP, geoCleanAccountId, geoCleanKey, geoIntlTag } from './proxy-geo-shared.js';
import { createGeoController } from './proxy-geo-controller.js';
import { LANGUAGES } from './precursor-settings-locales.js';
import { proxyGeoFill, proxyGeoSettingsLabels, proxyGeoSettingsLocale } from './proxy-geo-settings-labels.js';
import { initializeTheme } from './theme-controller.js';

const LANGUAGE_KEY = 'ui-language-v1';
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const RTL = new Set(['ar', 'ur']);
const ARM_MS = 8000;
const OPTIONS = Object.freeze(['auto', 'failover', 'remember']);
const STAR_PATH = 'M12 2.7L14.65 9.26L21.7 9.75L16.28 14.29L18 21.15L12 17.4L6 21.15L7.72 14.29L2.3 9.75L9.35 9.26Z';

/** The overall status for the chip: { kind: 'loading' | 'off' | 'ready' | 'no-key', names } from a GeoState. */
export function proxyGeoMasterView(state) {
  if (state === null || typeof state !== 'object' || state.loaded !== true) return { kind: 'loading', names: [] };
  if (state.enabled !== true) return { kind: 'off', names: [] };
  const names = (Array.isArray(state.readyProviders) ? state.readyProviders : []).filter(id => GEO_PROVIDERS.includes(id)).map(id => GEO_PROVIDER_INFO[id].name);
  return state.ready === true && names.length > 0 ? { kind: 'ready', names } : { kind: 'no-key', names: [] };
}
/** The label key of a controller error code; a code this page does not know still gets a sentence of its own. */
export const proxyGeoErrorKey = code => (GEO_ERRORS.includes(code) ? 'error_' + code.replaceAll('-', '_') : 'error_unknown');
/** One line about a lookup record: country, city and organisation as the provider reported them. */
export function proxyGeoRecordSummary(record) {
  if (record === null || typeof record !== 'object') return '';
  return [record.countryName || record.country, record.city, record.org].filter(part => typeof part === 'string' && part !== '').join(' · ');
}

const providerSetting = (state, id) => state?.settings?.providers?.[id] ?? {};
const providerStatus = (state, id) => state?.providers?.[id] ?? {};
const hasKey = (state, id) => state?.hasCredentials?.[id] === true;
const ensure = result => { if (result !== null && typeof result === 'object' && result.ok === false) throw new Error('rejected'); };

export function mountProxyGeoSettings({ document: doc = globalThis.document, api = globalThis.browser ?? globalThis.chrome, env = globalThis, controller: injected = null, theme = initializeTheme } = {}) {
  const root = doc?.getElementById('proxy-geo-settings'), content = doc?.getElementById('pg-content');
  if (!root || !content || !api?.runtime) return null;
  const geo = injected ?? createGeoController({ api });
  const messageNode = root.querySelector('[data-geo-message]'), languageSelect = doc.getElementById('pg-language');
  let locale = proxyGeoSettingsLocale(api.i18n?.getUILanguage?.()), labels = proxyGeoSettingsLabels(locale);
  let busy = 0, armed = null, armTimer = null, message = null, dataNote = null, loadFailed = false, disposed = false, localeRevision = 0, unsubscribe = () => {};
  const results = Object.create(null);
  const texts = [], attributes = [], ui = { options: {}, cards: {} };

  // ---- DOM helpers ---------------------------------------------------------------------------------------------------------------
  const el = (tagName, attrs = {}, children = []) => {
    const node = doc.createElement(tagName);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'href') node.href = value;
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children) node.append(child);
    return node;
  };
  const svg = (tagName, attrs = {}, children = []) => {
    const node = doc.createElementNS(SVG_NAMESPACE, tagName);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    for (const child of children) node.append(child);
    return node;
  };
  // Text and attributes that follow the language: registered once, rewritten by localize().
  const say = (node, key, params) => { texts.push({ node, key, params }); node.textContent = proxyGeoFill(labels[key], params); return node; };
  const attr = (node, name, key, params) => { attributes.push({ node, name, key, params }); node.setAttribute(name, proxyGeoFill(labels[key], params)); return node; };
  const setText = (node, value) => { if (node.textContent !== value) node.textContent = value; };
  const tag = () => LANGUAGES.find(language => language.id === locale)?.tag ?? 'en';
  const formatTime = at => {
    if (!Number.isSafeInteger(at) || at < 0 || at > 8640000000000000) return '—';
    try { return new Intl.DateTimeFormat(geoIntlTag(tag()), { dateStyle: 'medium', timeStyle: 'short' }).format(at); } catch { return new Date(at).toISOString(); }
  };
  const formatNumber = value => { try { return new Intl.NumberFormat(geoIntlTag(tag())).format(value); } catch { return String(value); } };
  const toggle = (attrs, labelledBy, describedBy) => el('button', { type: 'button', role: 'switch', class: 'pg-switch', 'aria-checked': 'false', 'aria-labelledby': labelledBy, 'aria-describedby': describedBy, ...attrs });
  const button = (attrs, key, primary = false) => say(el('button', { type: 'button', class: primary ? 'pg-button pg-button-primary' : 'pg-button', ...attrs }), key);

  // ---- Build (once) --------------------------------------------------------------------------------------------------------------
  function buildMaster() {
    ui.chip = el('span', { class: 'pg-chip', 'data-geo-state': true, 'data-state': 'loading', role: 'status', 'aria-live': 'polite' });
    ui.hint = el('p', { class: 'pg-help', id: 'pg-master-hint' });
    ui.master = toggle({ 'data-geo-master': true }, 'pg-master-title', 'pg-master-hint');
    ui.master.addEventListener('click', () => operate(ui.master, async () => ensure(await geo.setEnabled(geo.getState().enabled !== true))));
    const options = OPTIONS.map(option => {
      const node = ui.options[option] = toggle({ 'data-geo-option': option }, 'pg-option-' + option, 'pg-option-' + option + '-help');
      node.addEventListener('click', () => operate(node, async () => ensure(await geo.setOption(option, geo.getState().settings?.[option] !== true))));
      const text = el('div', { class: 'pg-option-text' }, [say(el('span', { class: 'pg-option-label', id: 'pg-option-' + option }), 'option_' + option), say(el('p', { class: 'pg-help', id: 'pg-option-' + option + '-help' }), 'option_' + option + '_help')]);
      return el('div', { class: 'pg-option' }, [node, text]);
    });
    return el('section', { class: 'pg-card pg-master', 'aria-labelledby': 'pg-master-title' }, [
      el('div', { class: 'pg-master-row' }, [el('div', { class: 'pg-master-text' }, [say(el('h2', { id: 'pg-master-title' }), 'master_title'), ui.chip, ui.hint]), ui.master]),
      el('div', { class: 'pg-options' }, options),
    ]);
  }
  function buildSent() {
    const items = ['sent_ip', 'sent_key', 'sent_usual', 'sent_never', 'sent_learn', 'sent_claim'].map(key => say(el('li'), key));
    return el('section', { class: 'pg-card pg-sent', 'aria-labelledby': 'pg-sent-title' }, [say(el('h2', { id: 'pg-sent-title' }), 'sent_title'), el('ul', { class: 'pg-list' }, items)]);
  }
  function buildHead(info) {
    const docs = say(attr(el('a', { class: 'pg-docs', 'data-geo-docs': true, href: info.docsUrl, target: '_blank', rel: 'noopener noreferrer' }), 'aria-label', 'docs_aria', { name: info.name }), 'docs');
    const title = [el('h3', { id: 'pg-name-' + info.id }, [el('bdi', {}, [info.name])])];
    if (info.recommended) {
      const icon = svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' }, [svg('path', { d: STAR_PATH })]);
      title.unshift(attr(el('span', { class: 'pg-star', 'data-geo-star': true, role: 'img' }, [icon]), 'aria-label', 'recommended'));
      title.push(say(el('span', { class: 'pg-star-caption', 'aria-hidden': 'true' }), 'recommended'));
    }
    return el('div', { class: 'pg-provider-head' }, [el('div', { class: 'pg-provider-title' }, title), docs]);
  }
  function buildOptions(ref, info) {
    const id = info.id, rows = [];
    if (id === 'maxmind') {
      ref.service = el('select', { 'data-geo-opt': 'service', id: 'pg-service-' + id }, GEO_MAXMIND_SERVICES.map(service => say(el('option', { value: service }), 'service_' + service.replaceAll('-', '_'))));
      ref.service.addEventListener('change', () => { const value = ref.service.value; return operate(ref.service, async () => { results[id] = null; ensure(await geo.setProvider(id, { service: value })); }); });
      rows.push(el('label', { class: 'pg-field pg-select' }, [say(el('span'), 'opt_service'), ref.service]));
    }
    const option = id === 'ipgeolocation' ? 'security' : id === 'ipapi' ? 'http' : null;
    if (option !== null) {
      const box = ref[option] = el('input', { type: 'checkbox', 'data-geo-opt': option, id: 'pg-' + option + '-' + id, 'aria-describedby': option === 'http' ? 'pg-http-help-' + id : null });
      box.addEventListener('change', () => { const value = box.checked; return operate(box, async () => { results[id] = null; ensure(await geo.setProvider(id, { [option]: value })); }); });
      rows.push(el('label', { class: 'pg-check' }, [box, say(el('span'), 'opt_' + option)]));
      if (option === 'http') rows.push(say(el('p', { class: 'pg-help', id: 'pg-http-help-' + id }), 'opt_http_help'));
    }
    return rows;
  }
  function buildKeys(ref, info) {
    const id = info.id;
    const fields = info.credentials.map(field => {
      const input = ref.fields[field] = el('input', { type: 'password', class: 'pg-input', 'data-geo-field': field, autocomplete: 'off', spellcheck: 'false', autocapitalize: 'none', dir: 'ltr', maxlength: GEO_LIMITS.keyChars, inputmode: field === 'accountId' ? 'numeric' : null });
      input.addEventListener('input', () => { input.removeAttribute('aria-invalid'); if (results[id]?.kind === 'error' && results[id].key.startsWith('invalid_')) { results[id] = null; render(); } });
      input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault?.(); ref.save.click(); } });
      return el('label', { class: 'pg-field' }, [say(el('span'), field === 'apiKey' && info.keyOptional ? 'field_apiKey_optional' : 'field_' + field), input]);
    });
    ref.revealLabel = el('span');
    ref.reveal = el('button', { type: 'button', class: 'pg-button pg-reveal', 'data-geo-reveal': true, 'aria-pressed': 'false' }, [svg('svg', { class: 'pg-eye', viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' }, [svg('path', { d: 'M2 12S5.6 5 12 5s10 7 10 7-3.6 7-10 7S2 12 2 12Z' }), svg('circle', { cx: 12, cy: 12, r: 3 })]), ref.revealLabel]);
    ref.reveal.addEventListener('click', () => { ref.revealed = !ref.revealed; render(); });
    ref.keyChip = el('span', { class: 'pg-key', 'data-geo-key': true });
    ref.save = button({ 'data-geo-save': true }, 'save', true);
    ref.test = button({ 'data-geo-test': true, 'aria-describedby': 'pg-test-help-' + id }, 'test');
    ref.forget = button({ 'data-geo-forget': true }, 'forget');
    ref.save.addEventListener('click', () => operate(ref.save, async () => { results[id] = null; return (await saveKey(ref)) ? ref.save : ref.invalidFocus; }));
    ref.test.addEventListener('click', () => operate(ref.test, async () => { await testKey(ref); return results[id]?.kind === 'error' && results[id].key.startsWith('invalid_') ? ref.invalidFocus : ref.test; }));
    ref.forget.addEventListener('click', () => operate(ref.forget, async () => { ensure(await geo.forgetCredential(id)); clearFields(ref); results[id] = { kind: 'ok', key: 'result_forgot' }; return Object.values(ref.fields)[0]; }));
    ref.result = el('p', { class: 'pg-result', 'data-geo-result': true, 'aria-live': 'polite' });
    ref.status = el('p', { class: 'pg-status', 'data-geo-status': true, 'data-status': 'idle' });
    return [el('div', { class: 'pg-fields' }, fields), el('div', { class: 'pg-key-row' }, [ref.reveal, ref.keyChip]), el('div', { class: 'pg-actions' }, [ref.save, ref.test, ref.forget]),
      say(el('p', { class: 'pg-help', id: 'pg-test-help-' + id }), 'test_help', { ip: GEO_TEST_IP }), ref.result, ref.status];
  }
  function buildProvider(id) {
    const info = GEO_PROVIDER_INFO[id], ref = ui.cards[id] = { id, fields: {}, revealed: false, invalidFocus: null };
    ref.enabled = toggle({ 'data-geo-enabled': true }, 'pg-use-' + id + ' pg-name-' + id, 'pg-fact-' + id);
    ref.enabled.addEventListener('click', () => operate(ref.enabled, async () => { results[id] = null; ensure(await geo.setProvider(id, { enabled: providerSetting(geo.getState(), id).enabled !== true })); }));
    return el('article', { class: 'pg-card pg-provider', 'data-geo-provider': id, 'aria-labelledby': 'pg-name-' + id }, [
      buildHead(info), el('div', { class: 'pg-use-row' }, [say(el('span', { class: 'pg-use', id: 'pg-use-' + id }), 'use'), ref.enabled]),
      say(el('p', { class: 'pg-help', id: 'pg-fact-' + id }), 'fact_' + id), ...buildOptions(ref, info), ...buildKeys(ref, info),
    ]);
  }
  function buildProviders() {
    return el('section', { class: 'pg-providers', 'aria-labelledby': 'pg-providers-title' }, [
      say(el('h2', { id: 'pg-providers-title', class: 'pg-section-title' }), 'providers_title'), say(el('p', { class: 'pg-help' }), 'providers_help'),
      el('div', { class: 'pg-provider-grid' }, GEO_PROVIDERS.map(buildProvider)),
    ]);
  }
  function buildData() {
    ui.clear = button({ 'data-geo-clear-cache': true }, 'clear_cache');
    ui.forgetAll = button({ 'data-geo-forget-all': true }, 'forget_all');
    ui.cancel = button({ 'data-geo-confirm-cancel': true, hidden: true }, 'cancel');
    ui.confirmHint = el('p', { class: 'pg-help', 'data-geo-confirm-hint': true, role: 'status' });
    ui.dataNote = el('p', { class: 'pg-result', 'data-geo-data-note': true, 'aria-live': 'polite' });
    ui.clear.addEventListener('click', () => confirmed('cache', ui.clear, async () => { ensure(await geo.clearCache()); dataNote = { kind: 'ok', key: 'done_cache' }; }));
    ui.forgetAll.addEventListener('click', () => confirmed('keys', ui.forgetAll, async () => {
      ensure(await geo.forgetAllCredentials());
      for (const ref of Object.values(ui.cards)) { clearFields(ref); results[ref.id] = null; }
      dataNote = { kind: 'ok', key: 'done_forget_all' };
    }));
    ui.cancel.addEventListener('click', () => disarm(true));
    for (const node of [ui.clear, ui.forgetAll, ui.cancel]) node.addEventListener('keydown', event => { if (event.key === 'Escape' && armed !== null) { event.preventDefault?.(); disarm(true); } });
    const section = el('section', { class: 'pg-card pg-data', 'aria-labelledby': 'pg-data-title' }, [
      say(el('h2', { id: 'pg-data-title' }), 'data_title'), say(el('p', { class: 'pg-help' }), 'data_help'),
      el('div', { class: 'pg-actions' }, [ui.clear, ui.forgetAll, ui.cancel]), ui.confirmHint, ui.dataNote,
    ]);
    section.addEventListener('focusout', event => { if (armed !== null && !section.contains(event.relatedTarget)) disarm(false); });
    return section;
  }
  function build() {
    content.replaceChildren(buildMaster(), buildSent(), buildProviders(), buildData());
    for (const language of LANGUAGES) languageSelect.append(el('option', { value: language.id }, [language.name]));
  }

  // ---- Actions -------------------------------------------------------------------------------------------------------------------
  // One operation at a time: every control is disabled while one runs. A thrown or refused operation shows one page-level alert.
  async function operate(control, work) {
    if (disposed || busy > 0) return;
    disarm(false);
    busy++; message = null; dataNote = null; render();
    let target = control;
    try { target = (await work()) ?? control; } catch { message = 'err_save'; }
    finally { busy--; if (!disposed) { render(); restoreFocus(target, control); } }
  }
  // A disabled control cannot keep the focus: it goes to the control that ran, or the next enabled one, unless the user moved on.
  function restoreFocus(target, control) {
    const active = doc.activeElement;
    if (active && active !== doc.body && active !== control && active !== target) return;
    [target, control, ui.master].find(candidate => candidate && !candidate.disabled)?.focus();
  }
  const typed = ref => Object.values(ref.fields).some(field => field.value.trim() !== '');
  function clearFields(ref) {
    for (const field of Object.values(ref.fields)) { field.value = ''; field.removeAttribute('aria-invalid'); }
    ref.revealed = false; ref.invalidFocus = null;
  }
  function flagInvalid(ref, input) {
    let first = null;
    for (const [field, value] of Object.entries(input)) {
      const valid = (field === 'accountId' ? geoCleanAccountId(value) : geoCleanKey(value)) !== null;
      ref.fields[field].setAttribute('aria-invalid', String(!valid));
      if (!valid && first === null) first = ref.fields[field];
    }
    return first ?? Object.values(ref.fields)[0];
  }
  async function saveKey(ref) {
    const input = Object.fromEntries(Object.entries(ref.fields).map(([field, node]) => [field, node.value]));
    const outcome = await geo.saveCredential(ref.id, input);
    if (outcome?.ok === true) { clearFields(ref); results[ref.id] = { kind: 'ok', key: providerSetting(geo.getState(), ref.id).enabled === true ? 'result_saved' : 'result_saved_off' }; return true; }
    results[ref.id] = outcome?.error === 'invalid-key' ? { kind: 'error', key: ref.id === 'maxmind' ? 'invalid_maxmind' : 'invalid_key' } : { kind: 'error', key: 'error_unknown' };
    ref.invalidFocus = flagInvalid(ref, input);
    return false;
  }
  async function testKey(ref) {
    ref.invalidFocus = null; results[ref.id] = { kind: 'info', key: 'test_running' }; render();
    if (typed(ref) && !(await saveKey(ref))) return;
    const outcome = await geo.testProvider(ref.id);
    if (outcome?.ok !== true) { results[ref.id] = { kind: 'error', key: proxyGeoErrorKey(outcome?.error) }; return; }
    const summary = proxyGeoRecordSummary(outcome.record);
    results[ref.id] = summary === '' ? { kind: 'ok', key: 'test_ok_empty', params: { ip: GEO_TEST_IP } } : { kind: 'ok', key: 'test_ok', params: { ip: GEO_TEST_IP, summary } };
  }
  // The two destructive buttons of the data card confirm inline: the first press arms the button, the second one runs it.
  function confirmed(kind, control, work) {
    if (disposed || busy > 0) return;
    if (armed === kind) { void operate(control, work); return; }
    disarm(false); armed = kind; dataNote = null;
    armTimer = env.setTimeout(() => { armTimer = null; disarm(false); }, ARM_MS);
    render();
  }
  function disarm(focus) {
    if (armTimer !== null) { env.clearTimeout(armTimer); armTimer = null; }
    if (armed === null) return;
    const control = armed === 'cache' ? ui.clear : ui.forgetAll;
    armed = null; render();
    if (focus) control.focus();
  }

  // ---- Render (in place) ---------------------------------------------------------------------------------------------------------
  function renderResult(node, result) {
    if (!result) { setText(node, ''); node.removeAttribute('data-kind'); return; }
    setText(node, proxyGeoFill(labels[result.key], result.params));
    node.setAttribute('data-kind', result.kind);
  }
  function statusLine(state, id) {
    const setting = providerSetting(state, id), status = providerStatus(state, id), parts = [];
    const kind = status.status === 'ok' || status.status === 'error' ? status.status : 'idle';
    if (kind === 'error') parts.push(proxyGeoFill(labels.status_error, { error: labels[proxyGeoErrorKey(status.error)] }));
    else if (kind === 'ok') parts.push(proxyGeoFill(labels.status_ok, { time: formatTime(status.okAt) }));
    else if (setting.enabled !== true) parts.push(labels.status_idle_off);
    else if (status.ready === false && (status.reason === 'no-key' || status.reason === 'http-not-allowed')) parts.push(labels[proxyGeoErrorKey(status.reason)]);
    else parts.push(labels.status_idle_ready);
    if (typeof status.remaining === 'number' && Number.isFinite(status.remaining) && status.remaining >= 0) parts.push(proxyGeoFill(labels.status_remaining, { n: formatNumber(status.remaining) }));
    if (typeof status.pausedUntil === 'number' && Number.isFinite(status.pausedUntil) && status.pausedUntil > Date.now()) parts.push(proxyGeoFill(labels.status_paused, { time: formatTime(status.pausedUntil) }));
    return { kind, text: parts.join(' · ') };
  }
  function renderCard(ref, state, locked) {
    const id = ref.id, setting = providerSetting(state, id), idle = busy === 0;
    ref.enabled.setAttribute('aria-checked', String(setting.enabled === true)); ref.enabled.disabled = locked;
    // A select or a checkbox has already changed by the time its handler runs: keep what the user chose until the controller answers.
    if (ref.service) { if (idle && GEO_MAXMIND_SERVICES.includes(setting.service) && ref.service.value !== setting.service) ref.service.value = setting.service; ref.service.disabled = locked; }
    for (const option of ['security', 'http']) if (ref[option]) { if (idle) ref[option].checked = setting[option] === true; ref[option].disabled = locked; }
    for (const field of Object.values(ref.fields)) { field.disabled = locked; field.setAttribute('type', ref.revealed ? 'text' : 'password'); }
    ref.reveal.disabled = locked; ref.reveal.setAttribute('aria-pressed', String(ref.revealed)); setText(ref.revealLabel, ref.revealed ? labels.reveal_hide : labels.reveal_show);
    ref.save.disabled = locked; ref.test.disabled = locked; ref.forget.disabled = locked || !hasKey(state, id);
    ref.keyChip.setAttribute('data-has', String(hasKey(state, id))); setText(ref.keyChip, hasKey(state, id) ? labels.key_saved : labels.key_none);
    renderResult(ref.result, results[id]);
    const line = statusLine(state, id);
    ref.status.setAttribute('data-status', line.kind); setText(ref.status, line.text);
  }
  function renderChip(view) {
    ui.chip.setAttribute('data-state', view.kind);
    const text = view.kind === 'ready' ? proxyGeoFill(labels.state_ready, { list: view.names.join(', ') }) : labels['state_' + view.kind.replace('-', '_')];
    if (ui.chip.textContent === text) return;
    if (view.kind !== 'ready') { ui.chip.textContent = text; return; }
    // Provider names are proper names: each one is isolated so a right-to-left sentence cannot reorder it.
    const [before, after] = labels.state_ready.split('{list}');
    ui.chip.replaceChildren(before, ...view.names.flatMap((label, index) => [...(index ? [', '] : []), el('bdi', {}, [label])]), after);
  }
  function render() {
    if (disposed) return;
    const state = geo.getState(), loaded = state?.loaded === true, locked = !loaded || busy > 0, view = proxyGeoMasterView(state);
    root.setAttribute('aria-busy', String(locked));
    renderChip(view);
    setText(ui.hint, loaded ? labels[view.kind === 'off' ? 'hint_off' : view.kind === 'ready' ? 'hint_ready' : 'hint_no_key'] : '');
    ui.master.setAttribute('aria-checked', String(state?.enabled === true)); ui.master.disabled = locked;
    for (const option of OPTIONS) { ui.options[option].setAttribute('aria-checked', String(state?.settings?.[option] === true)); ui.options[option].disabled = locked; }
    for (const id of GEO_PROVIDERS) renderCard(ui.cards[id], state, locked);
    const count = Number.isSafeInteger(state?.cacheCount) && state.cacheCount > 0 ? state.cacheCount : 0, anyKey = GEO_PROVIDERS.some(id => hasKey(state, id));
    setText(ui.clear, proxyGeoFill(armed === 'cache' ? labels.clear_cache_armed : labels.clear_cache, { n: count }));
    setText(ui.forgetAll, armed === 'keys' ? labels.forget_all_armed : labels.forget_all);
    ui.clear.setAttribute('data-armed', String(armed === 'cache')); ui.forgetAll.setAttribute('data-armed', String(armed === 'keys'));
    ui.clear.disabled = locked || count === 0; ui.forgetAll.disabled = locked || !anyKey;
    ui.cancel.hidden = armed === null; ui.cancel.disabled = locked;
    setText(ui.confirmHint, armed === null ? '' : labels.confirm_hint);
    renderResult(ui.dataNote, dataNote);
    const alert = message ?? (!loaded && loadFailed ? 'err_load' : null);
    messageNode.hidden = alert === null; setText(messageNode, alert === null ? '' : labels[alert]);
  }
  function localize() {
    labels = proxyGeoSettingsLabels(locale);
    doc.documentElement.lang = tag(); doc.documentElement.dir = RTL.has(locale) ? 'rtl' : 'ltr';
    for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = labels[node.dataset.i18n] ?? '';
    for (const entry of texts) entry.node.textContent = proxyGeoFill(labels[entry.key], entry.params);
    for (const entry of attributes) entry.node.setAttribute(entry.name, proxyGeoFill(labels[entry.key], entry.params));
    languageSelect.value = locale; doc.title = labels.title + ' · Detect.Expert';
    render();
  }

  // ---- Language, secrets on hide, lifecycle ---------------------------------------------------------------------------------------
  function storageChanged(changes, area) {
    if (area !== 'local' || !Object.hasOwn(changes, LANGUAGE_KEY)) return;
    localeRevision++; locale = proxyGeoSettingsLocale(changes[LANGUAGE_KEY]?.newValue ?? api.i18n?.getUILanguage?.()); localize();
  }
  async function languageChanged() {
    const value = languageSelect.value;
    if (!LANGUAGES.some(language => language.id === value)) return;
    localeRevision++; locale = value; localize();
    try { await api.storage.local.set({ [LANGUAGE_KEY]: value }); } catch { message = 'err_save'; render(); }
  }
  // A key shown in clear text goes back to dots when the tab is left.
  function visibility() { if (doc.visibilityState === 'hidden') { for (const ref of Object.values(ui.cards)) ref.revealed = false; render(); } }
  function dispose() {
    if (disposed) return;
    disposed = true; disarm(false); unsubscribe();
    for (const ref of Object.values(ui.cards)) for (const field of Object.values(ref.fields)) field.value = '';
    languageSelect.removeEventListener('change', languageChanged); doc.removeEventListener('visibilitychange', visibility);
    api.storage?.onChanged?.removeListener(storageChanged); env.removeEventListener?.('pagehide', dispose);
    if (injected === null) geo.dispose();
  }

  build();
  languageSelect.addEventListener('change', languageChanged); doc.addEventListener('visibilitychange', visibility);
  api.storage?.onChanged?.addListener(storageChanged);
  unsubscribe = geo.subscribe(() => render());
  const initialRevision = localeRevision;
  Promise.resolve(api.storage?.local?.get(LANGUAGE_KEY)).then(value => { if (!disposed && localeRevision === initialRevision) { locale = proxyGeoSettingsLocale(value?.[LANGUAGE_KEY] ?? api.i18n?.getUILanguage?.()); localize(); } }, () => {});
  localize();
  try { Promise.resolve(theme?.()).catch(() => {}); } catch { /* The theme is only appearance. */ }
  // load() answers with the state even when the storage could not be read: that state says loaded: false.
  Promise.resolve().then(() => geo.load()).then(state => { loadFailed = state?.loaded !== true; if (!disposed) render(); }, () => { loadFailed = true; if (!disposed) render(); });
  env.addEventListener?.('pagehide', dispose, { once: true });
  return { dispose };
}

if (typeof document !== 'undefined') mountProxyGeoSettings();
