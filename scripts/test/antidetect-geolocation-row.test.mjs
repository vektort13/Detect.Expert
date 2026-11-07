// Contract V8 added a Custom geolocation row. It stays a generic row of the OS level (the Region control only knows each region's
// default city); these tests exercise it in the real generic editor, the real value modal and the profile panel's row editor.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApiConfigurationUi } from '../../apps/production-extension/api-configuration-ui.js';
import { ANTIDETECT_CATEGORY_OVERRIDES, antidetectApiCounts } from '../../apps/production-extension/antidetect-ui.js';
import { PROTECTION_FEATURE_FILTER } from '../../apps/production-extension/protection-ui.js';
import { API_CONFIG_CATALOG, createApiConfiguration, updateApiConfiguration, validateApiConfiguration } from '../../apps/production-extension/api-configuration.js';
import { applyDevicePatch } from '../../apps/production-extension/fingerprint-profiles.js';
import { ANTIDETECT_EDITOR_MESSAGES } from '../production-locales-antidetect.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';

const clone = value => JSON.parse(JSON.stringify(value));
const turn = () => new Promise(resolve => setImmediate(resolve));
const event = () => { const callbacks = new Set(); return { addListener: callback => callbacks.add(callback), removeListener: callback => callbacks.delete(callback), emit: (...args) => { for (const callback of callbacks) callback(...args); } }; };
function server(configuration = createApiConfiguration()) {
  const calls = [], value = { configuration: { ...configuration, antidetectEnabled: true }, revision: 5 };
  const snapshot = request => ({ schemaVersion: 1, type: 'api-config-state', revision: value.revision, configuration: clone(value.configuration), host: null, documentId: null, registration: 'ready', reloadRequired: false, earlyAccess: 'ready', webrtcNetwork: { desired: 'system', status: 'inactive', value: null, levelOfControl: null } });
  const api = { runtime: { id: 'fixture', sendMessage: async request => {
    calls.push(clone(request));
    if (request.type === 'ui-api-config-set') {
      if (request.expectedRevision !== value.revision) return { schemaVersion: 1, type: 'api-config-error', code: 'stale-revision' };
      const checked = validateApiConfiguration(request.configuration); assert.equal(checked.ok, true); value.configuration = checked.value; value.revision++;
    }
    return snapshot(request);
  } }, storage: { onChanged: event() }, webNavigation: { onCommitted: event() } };
  return { value, api, calls, writes: () => calls.filter(call => call.type === 'ui-api-config-set') };
}
function harness(component, initialProps, { api = server().api, locale = 'en', translate } = {}) {
  const slots = [], effects = []; let cursor = 0, dirty = true, tree, props = initialProps;
  const hooks = {
    useState(initial) { const slot = slots[cursor++] ??= { value: initial }; return [slot.value, next => { const value = typeof next === 'function' ? next(slot.value) : next; if (!Object.is(value, slot.value)) { slot.value = value; dirty = true; } }]; },
    useRef(initial) { return (slots[cursor++] ??= { ref: { current: initial } }).ref; },
    useEffect(callback, dependencies) { const slot = slots[cursor++] ??= {}; if (!slot.dependencies || dependencies?.some((value, index) => !Object.is(value, slot.dependencies[index]))) { slot.dependencies = dependencies; effects.push(() => { slot.cleanup?.(); slot.cleanup = callback(); }); } },
  };
  const ui = createApiConfigurationUi({ ...hooks, h: (type, props) => ({ type, props }), useLocale: () => locale, browserApi: api, translate, featureFilter: PROTECTION_FEATURE_FILTER });
  function render() { cursor = 0; dirty = false; tree = ui[component](props); while (effects.length) effects.shift()(); return tree; }
  async function settle() { for (let count = 0; count < 8; count++) { if (dirty) render(); await turn(); } if (dirty) render(); return tree; }
  function nodes(predicate) { const result = []; const visit = node => { if (Array.isArray(node)) { node.forEach(visit); return; } if (!node?.props) return; if (predicate(node)) result.push(node); visit(node.props.children); }; visit(tree); return result; }
  const attr = (name, value = true) => nodes(node => node.props[name] === value)[0];
  return { render, settle, nodes, attr, unmount: () => { for (const slot of slots) slot?.cleanup?.(); } };
}
// The props the Antidetect page hands the embedded editor for one level (see antidetect-ui.js).
const level = fixedCategory => ({ presentation: 'antidetect', fixedCategory, categoryOverrides: ANTIDETECT_CATEGORY_OVERRIDES, hideWebRtc: true, active: true, tabId: null, global: true, hideUsageContext: true });
const preventDefault = () => {};
const rowIds = h => h.nodes(node => node.type?.name === 'ModeControl').map(node => node.props.entry.id);
const geoEntry = () => ({ ...clone(API_CONFIG_CATALOG.find(item => item.id === 'geolocation')), mode: 'bypass', selected: { kind: 'unset' }, userValues: [], settings: {} });
const CITIES = ['New York', 'London', 'Berlin', 'Paris', 'Tokyo', 'Sydney'];

test('geolocation is a deliberate row of the OS level: placed and counted there, never hidden as a dedicated panel', () => {
  assert.equal(ANTIDETECT_CATEGORY_OVERRIDES.geolocation, 'os'); assert.equal(PROTECTION_FEATURE_FILTER.geolocation, 'os', 'the API Guard filter agrees');
  const row = API_CONFIG_CATALOG.find(entry => entry.id === 'geolocation'); assert.equal(row.customSupported, true); assert.equal(row.type, 'geolocation');
  const custom = updateApiConfiguration(createApiConfiguration(), 'geolocation', { mode: 'custom', selected: { kind: 'value', value: { latitude: 48.8566, longitude: 2.3522, accuracy: 25 } } });
  assert.equal(custom.ok, true);
  const counts = antidetectApiCounts(custom.value);
  assert.deepEqual({ os: counts.os.custom, all: counts.all.custom, device: counts.device.custom, browser: counts.browser.custom, network: counts.network.custom }, { os: 1, all: 1, device: 0, browser: 0, network: 0 });
  // A Region patch writes five OS rows; the overview shows every one of them, the coordinates included.
  const region = applyDevicePatch(createApiConfiguration(), { region: 'DE' }, {}).configuration, byRow = antidetectApiCounts(region);
  assert.equal(byRow.os.custom, 5); assert.equal(byRow.all.custom, 5); assert.equal(byRow.device.custom + byRow.browser.custom + byRow.network.custom, 0);
  const blocked = updateApiConfiguration(createApiConfiguration(), 'geolocation', { mode: 'on', selected: { kind: 'unset' } }).value;
  assert.deepEqual([antidetectApiCounts(blocked).os.on, antidetectApiCounts(blocked).all.on], [1, 1], 'a Block of the API counts too');
});

test('the real generic editor lists geolocation in the OS level only, once, and renders it without errors', async () => {
  const seen = {};
  for (const [name, fixedCategory] of [['device', 'hardware'], ['os', 'os'], ['browser', 'browser']]) {
    const s = server(), h = harness('ApiConfigurationEditor', level(fixedCategory), { api: s.api });
    try { h.render(); await h.settle(); seen[name] = rowIds(h); assert.equal(h.nodes(node => node.props.role === 'alert').length, 0, name + ': no error shown'); }
    finally { h.unmount(); }
  }
  assert.equal(seen.os.filter(id => id === 'geolocation').length, 1); assert.equal(seen.device.includes('geolocation'), false); assert.equal(seen.browser.includes('geolocation'), false);
  assert.ok(seen.os.includes('timezone') && seen.os.includes('navigator-language'), 'beside the time zone and the language it follows');
  for (const dedicated of ['webrtc', 'media-enumeration', 'websocket', 'webtransport', 'math-transcendentals']) for (const ids of Object.values(seen)) assert.equal(ids.includes(dedicated), false, dedicated + ' keeps its own panel');
});

test('geolocation Custom in the OS level: a mode click saves the first city, a chosen city is a draft until Save', async () => {
  const s = server(), h = harness('ApiConfigurationEditor', level('os'), { api: s.api });
  try {
    h.render(); await h.settle();
    const control = () => h.nodes(node => node.type?.name === 'ModeControl' && node.props.entry.id === 'geolocation')[0], editor = () => h.nodes(node => node.type?.name === 'CustomValueEditor' && node.props.entry.id === 'geolocation')[0];
    assert.equal(editor(), undefined, 'no value editor while the row follows the browser');
    control().props.onChange('custom'); await h.settle();
    assert.equal(control().props.entry.mode, 'custom'); assert.ok(editor(), 'the value editor appears for Custom');
    assert.deepEqual(control().props.entry.selected, { kind: 'value', value: { latitude: 40.7128, longitude: -74.006, accuracy: 25 } }, 'the first preset is selected');
    assert.equal(s.value.configuration.apis.find(item => item.id === 'geolocation').mode, 'custom', 'a mode click saves at once');
    assert.equal(h.nodes(node => node.props.role === 'alert').length, 0);
    const before = s.writes().length, tokyo = editor().props.entry.presets.find(preset => preset.label === 'Tokyo');
    await editor().props.onChange({ selected: clone(tokyo.value), mode: 'custom' }, { persist: false }); await h.settle();
    assert.deepEqual(control().props.entry.selected.value, { latitude: 35.6762, longitude: 139.6503, accuracy: 25 }, 'Tokyo is the draft');
    assert.equal(s.writes().length, before, 'choosing a preset is a draft, as for every row');
    h.attr('data-protection-action', 'save').props.onClick(); await h.settle();
    assert.deepEqual(s.value.configuration.apis.find(item => item.id === 'geolocation').selected.value, { latitude: 35.6762, longitude: 139.6503, accuracy: 25 });
    assert.equal(h.nodes(node => node.props.role === 'alert').length, 0);
  } finally { h.unmount(); }
});

test('the value picker of the geolocation row lists the six cities with their coordinates and reports the chosen one', async () => {
  const calls = [], item = { ...geoEntry(), mode: 'custom', selected: { kind: 'value', value: { latitude: 40.7128, longitude: -74.006, accuracy: 25 } } };
  const h = harness('CustomValueEditor', { entry: item, onChange: async (patch, options) => calls.push({ patch, options }) });
  try {
    h.render(); await h.settle();
    const picker = h.nodes(node => node.props.class === 'api-value-picker')[0]; assert.ok(picker, 'the picker button renders'); assert.equal(picker.props.disabled, false);
    picker.props.onClick(); await h.settle();
    const options = h.attr('data-api-value-list', 'geolocation').props.children.flatMap(child => child?.props?.children ?? []).filter(option => option?.type === 'option' && option.props.value.startsWith('p:'));
    assert.equal(options.length, 6);
    CITIES.forEach((city, index) => { assert.ok(String(options[index].props.children).startsWith(city + ' · '), city); assert.match(String(options[index].props.children), /"latitude":-?\d+(?:\.\d+)?,"longitude":-?\d+(?:\.\d+)?,"accuracy":25/u); });
    await h.attr('data-api-value-list', 'geolocation').props.onChange({ currentTarget: { value: 'p:preset-6' } }); await h.settle();
    assert.equal(calls.length, 1); assert.equal(calls[0].options.persist, false); assert.equal(calls[0].patch.mode, 'custom');
    assert.deepEqual(calls[0].patch.selected, { kind: 'value', value: { latitude: -33.8688, longitude: 151.2093, accuracy: 25 } }, 'Sydney');
    assert.equal(h.nodes(node => node.props.role === 'alert').length, 0);
  } finally { h.unmount(); }
});

test('the value modal validates geolocation coordinates before it saves anything, in every language', async () => {
  const bad = ['{"latitude":91,"longitude":0,"accuracy":25}', '{"latitude":-90.5,"longitude":0,"accuracy":25}', '{"latitude":0,"longitude":180.1,"accuracy":25}', '{"latitude":0,"longitude":0,"accuracy":0}', '{"latitude":0,"longitude":0,"accuracy":100001}',
    '{"latitude":0,"longitude":0}', '{"latitude":0,"longitude":0,"accuracy":25,"altitude":1}', '{"latitude":"0","longitude":0,"accuracy":25}', '{"latitude":null,"longitude":0,"accuracy":25}', '[0,0,25]', '25', '"Berlin"', 'not json', '', '{"latitude":1e999,"longitude":0,"accuracy":25}'];
  const good = ['{"latitude":48.8566,"longitude":2.3522,"accuracy":30}', '{"latitude":-90,"longitude":-180,"accuracy":1}', '{"latitude":90,"longitude":180,"accuracy":100000}', '{"latitude":0,"longitude":0,"accuracy":25}'];
  for (const language of PRODUCTION_LANGUAGES) {
    const messages = ANTIDETECT_EDITOR_MESSAGES[language.id], saved = [], h = harness('ValueModal', { entry: geoEntry(), onSave: async value => saved.push(value), onClose() {} }, { locale: language.id, translate: key => messages[key] ?? key });
    try {
      h.render(); await h.settle();
      assert.ok(h.nodes(node => node.type === 'small' && node.props.children === messages.antidetect_editor_hints_object + ' · geolocation').length, language.id + ': the localized JSON-object hint names the value type');
      const area = h.attr('data-api-value-input'); assert.equal(area.type, 'textarea'); assert.equal(area.props.dir, 'ltr');
      assert.deepEqual(JSON.parse(area.props.value), { latitude: 40.7128, longitude: -74.006, accuracy: 25 }, language.id + ': starts from the first city');
      h.attr('data-api-value-name').props.onInput({ currentTarget: { value: 'Place' } });
      for (const text of bad) {
        h.attr('data-api-value-input').props.onInput({ currentTarget: { value: text } }); await h.settle();
        await h.nodes(node => node.type === 'form')[0].props.onSubmit({ preventDefault }); await h.settle();
        assert.equal(saved.length, 0, language.id + ' saved ' + text); assert.ok(h.nodes(node => node.props.role === 'alert').length, language.id + ' shows no error for ' + text);
      }
    } finally { h.unmount(); }
  }
  const saved = [], h = harness('ValueModal', { entry: geoEntry(), onSave: async value => saved.push(value), onClose() {} });
  try {
    h.render(); await h.settle(); h.attr('data-api-value-name').props.onInput({ currentTarget: { value: 'Place' } });
    for (const text of good) { h.attr('data-api-value-input').props.onInput({ currentTarget: { value: text } }); await h.settle(); await h.nodes(node => node.type === 'form')[0].props.onSubmit({ preventDefault }); await h.settle(); }
    assert.deepEqual(saved.map(item => item.value), good.map(text => ({ kind: 'value', value: JSON.parse(text) })), 'every in-range pair is kept exactly');
  } finally { h.unmount(); }
});

test('an own place is stored with its name and coordinates, and the reloaded row renders without an error', async () => {
  const s = server(), h = harness('ApiConfigurationEditor', level('os'), { api: s.api });
  try {
    h.render(); await h.settle();
    h.nodes(node => node.type?.name === 'ModeControl' && node.props.entry.id === 'geolocation')[0].props.onChange('custom'); await h.settle();
    const editor = () => h.nodes(node => node.type?.name === 'CustomValueEditor' && node.props.entry.id === 'geolocation')[0];
    await editor().props.onChange({ mode: 'custom', selected: { kind: 'value', value: { latitude: 59.3293, longitude: 18.0686, accuracy: 40 } }, userValues: [{ id: 'custom-1', label: 'Stockholm', value: { kind: 'value', value: { latitude: 59.3293, longitude: 18.0686, accuracy: 40 } } }] }, { persist: true }); await h.settle();
    const stored = s.value.configuration.apis.find(item => item.id === 'geolocation');
    assert.deepEqual(stored.selected.value, { latitude: 59.3293, longitude: 18.0686, accuracy: 40 }); assert.deepEqual(stored.userValues.map(item => item.label), ['Stockholm']);
    assert.equal(h.nodes(node => node.props.role === 'alert').length, 0);
    // Reloading the saved reply renders the same row without an error.
    const again = harness('ApiConfigurationEditor', level('os'), { api: s.api });
    try { again.render(); await again.settle(); assert.equal(again.nodes(node => node.props.role === 'alert').length, 0); assert.ok(again.nodes(node => node.type?.name === 'CustomValueEditor' && node.props.entry.id === 'geolocation')[0]); } finally { again.unmount(); }
  } finally { h.unmount(); }
});
