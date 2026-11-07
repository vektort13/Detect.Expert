// ADR-048: delivered UI lifecycle, typed values, and reversible configuration transfer.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApiConfigurationUi, parseApiValueInput, formatApiValue, filterApiValues, sameApiValue, apiImportSummary } from '../../apps/production-extension/api-configuration-ui.js';
import { WEBRTC_UI_MESSAGES } from '../production-locales-webrtc.mjs';
import { WEBRTC_DISCOVERY_MESSAGES } from '../production-locales-webrtc-discovery.mjs';
import { API_CONFIG_CATALOG, API_CUSTOM_ONLY_IDS, createApiConfiguration, updateApiConfiguration, validateApiConfiguration, exportApiConfiguration } from '../../packages/contracts/src/api-configuration.mjs';
import { PROTECTION_FEATURE_FILTER } from '../../apps/production-extension/protection-ui.js';
import { WEBASSEMBLY_UI_MESSAGES } from '../production-locales-webassembly.mjs';
import { MODE_ACTION_KEYS, MODE_ACTION_MESSAGES, applyModeActionCopy } from '../production-locales-mode-actions.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';
import { ANTIDETECT_EDITOR_MESSAGES } from '../production-locales-antidetect.mjs';
import { FINGERPRINT_CUSTOM_LOCALE_IDS } from '../production-locales-fingerprint-custom.mjs';
import { API_GUARD_LABEL_KEYS, API_GUARD_LANGUAGES, apiGuardLabels, apiGuardRowLengths } from '../../apps/production-extension/api-guard-labels.js';

const clone = value => JSON.parse(JSON.stringify(value));
const turn = () => new Promise(resolve => setImmediate(resolve));
function event() { const callbacks = new Set(); return { addListener: callback => callbacks.add(callback), removeListener: callback => callbacks.delete(callback), emit: (...args) => { for (const callback of callbacks) callback(...args); }, get size() { return callbacks.size; } }; }
function server() {
  const calls = [], value = { configuration: createApiConfiguration(), revision: 5, host: 'example.com', documentId: 'document-1' };
  const snapshot = request => ({ schemaVersion: 1, type: 'api-config-state', revision: value.revision, configuration: clone(value.configuration), host: request.tabId === null ? null : value.host, documentId: request.tabId === null ? null : value.documentId, registration: value.registration ?? (value.configuration.enabled || value.configuration.antidetectEnabled ? 'ready' : 'inactive'), reloadRequired: value.reloadRequired ?? false, earlyAccess: value.earlyAccess ?? 'ready', webrtcNetwork: clone(value.webrtcNetwork ?? { desired: 'system', status: 'inactive', value: null, levelOfControl: null }) });
  const api = { runtime: { id: 'fixture', sendMessage: async request => {
    calls.push(clone(request));
    const intercepted = value.intercept?.(request); if (intercepted !== undefined) return intercepted;
    if (request.type === 'ui-api-config-set') {
      if (request.expectedRevision !== value.revision) return { schemaVersion: 1, type: 'api-config-error', code: 'stale-revision' };
      const checked = validateApiConfiguration(request.configuration); assert.equal(checked.ok, true);
      value.configuration = checked.value; value.revision++;
    }
    if (request.type === 'ui-protection-reload') { value.documentId = 'document-2'; return { schemaVersion: 1, type: 'protection-state' }; }
    return snapshot(request);
  } }, storage: { onChanged: event() }, webNavigation: { onCommitted: event() } };
  return { value, api, calls, snapshot };
}
function harness(component, initialProps, { api = server().api, locale = 'en', downloadFile, translate, featureFilter } = {}) {
  const slots = [], effects = []; let cursor = 0, dirty = true, tree, props = initialProps;
  const hooks = {
    useState(initial) { const slot = slots[cursor++] ??= { value: initial }; return [slot.value, next => { const value = typeof next === 'function' ? next(slot.value) : next; if (!Object.is(value, slot.value)) { slot.value = value; dirty = true; } }]; },
    useRef(initial) { return (slots[cursor++] ??= { ref: { current: initial } }).ref; },
    useEffect(callback, dependencies) { const slot = slots[cursor++] ??= {}; if (!slot.dependencies || dependencies?.some((value, index) => !Object.is(value, slot.dependencies[index]))) { slot.dependencies = dependencies; effects.push(() => { slot.cleanup?.(); slot.cleanup = callback(); }); } },
  };
  const ui = createApiConfigurationUi({ ...hooks, h: (type, props) => ({ type, props }), useLocale: () => locale, browserApi: api, downloadFile, translate, featureFilter });
  function render() { cursor = 0; dirty = false; tree = ui[component](props); while (effects.length) effects.shift()(); return tree; }
  async function settle() { for (let count = 0; count < 8; count++) { if (dirty) render(); await turn(); } if (dirty) render(); return tree; }
  function nodes(predicate) { const result = []; const visit = node => { if (Array.isArray(node)) { node.forEach(visit); return; } if (!node?.props) return; if (predicate(node)) result.push(node); visit(node.props.children); }; visit(tree); return result; }
  const attr = (name, value = true) => nodes(node => node.props[name] === value)[0];
  return { render, settle, nodes, attr, ui, get tree() { return tree; }, update: next => { props = { ...props, ...next }; dirty = true; render(); }, unmount: () => { for (const slot of slots) slot?.cleanup?.(); } };
}
const entry = id => ({ ...clone(API_CONFIG_CATALOG.find(item => item.id === id)), mode: 'bypass', selected: { kind: 'unset' }, userValues: [], settings: {} });
const preventDefault = () => {};
const cpu = h => h.nodes(node => node.type?.name === 'CustomValueEditor' && node.props.entry.id === 'hardware-concurrency')[0];
function seedCpu(s) { s.value.configuration = updateApiConfiguration(s.value.configuration, 'hardware-concurrency', { mode: 'custom', selected: { kind: 'value', value: 2 } }).value; }
async function draftCpu(h, value = 16) { await cpu(h).props.onChange({ selected: { kind: 'value', value } }, { persist: false }); await h.settle(); }

test('RTC typed modal validates addresses and saves a reusable complete profile without a raw JSON textarea', async () => {
  const values = [], h = harness('ValueModal', { entry: entry('webrtc'), onSave: async value => values.push(value), onClose() {} }); h.render(); await h.settle();
  assert.equal(h.nodes(node => node.type === 'textarea').length, 0);
  const typed = () => h.nodes(node => node.type?.name === 'WebRtcProfileFields')[0];
  h.attr('data-api-value-name').props.onInput({ currentTarget: { value: 'Owned RTC profile' } });
  typed().props.onChange({ addresses: { ipv4: { host: '192.0.2.1', stun: 'not-an-address', turn: null }, ipv6: { host: null, stun: null, turn: '2001:db8::3' } }, iceTransportPolicy: 'relay', randomizeDevices: true, deviceLifetime: 'session', freshCertificates: true }); await h.settle();
  await h.nodes(node => node.type === 'form')[0].props.onSubmit({ preventDefault }); await h.settle(); assert.equal(values.length, 0);
  assert.ok(h.nodes(node => node.props.role === 'alert').length);
  const profile = { addresses: { ipv4: { host: '192.0.2.1', stun: null, turn: null }, ipv6: { host: null, stun: '2001:db8::2', turn: '2001:db8::3' } }, iceTransportPolicy: 'relay', randomizeDevices: true, deviceLifetime: 'session', freshCertificates: true };
  typed().props.onChange(profile); await h.settle(); await h.nodes(node => node.type === 'form')[0].props.onSubmit({ preventDefault }); await h.settle();
  assert.equal(values.length, 1); assert.deepEqual(values[0].value, { kind: 'value', value: profile }); assert.equal(values[0].label, 'Owned RTC profile'); h.unmount();
});

const rtcText = locale => key => WEBRTC_DISCOVERY_MESSAGES[locale][key] ?? WEBRTC_UI_MESSAGES[locale][key] ?? key;

test('observed-only filtering and source refresh preserve pending configuration and an open value editor without backend writes', async () => {
  const s = server(); seedCpu(s); const observedUsage = { status: 'ready', host: 'owned.example', byApi: { 'canvas-readback': { count: 1, attempted: false, fingerprintPattern: false } } };
  const h = harness('ApiConfigurationEditor', { tabId: null, observedUsage }, { api: s.api });
  try {
    h.render(); await h.settle(); await draftCpu(h, 16); cpu(h).props.onEditingChange(true);
    const context = () => h.nodes(node => node.type?.name === 'UsageContext')[0];
    context().props.onFilterChange(true); await h.settle();
    assert.deepEqual(h.nodes(node => node.props['data-protection-feature']).map(node => node.props['data-protection-feature']).sort(), ['canvas-readback', 'hardware-concurrency']);
    assert.equal(h.attr('data-protection-feature', 'canvas-readback').props['data-api-observed'], 'canvas-readback');
    assert.equal(h.attr('data-protection-feature', 'hardware-concurrency').props['data-api-observed'], undefined);
    h.update({ observedUsage: { ...observedUsage, status: 'loading' } }); await h.settle();
    assert.equal(h.nodes(node => node.props['data-protection-feature']).length, API_CONFIG_CATALOG.length);
    assert.equal(h.nodes(node => node.props['data-api-observed']).length, 0);
    assert.equal(cpu(h).props.entry.selected.value, 16);
    assert.equal(s.calls.filter(call => call.type === 'ui-api-config-get').length, 1);
    assert.equal(s.calls.filter(call => call.type === 'ui-api-config-set').length, 0);
    h.attr('data-protection-save').props.onClick(); await h.settle();
    assert.equal(s.value.configuration.apis.find(row => row.id === 'hardware-concurrency').selected.value, 16);
    assert.equal(s.calls.filter(call => call.type === 'ui-api-config-set').length, 1);
  } finally { h.unmount(); }
});

test('WebRTC discovery searches STUN, TURN, IPv4, IPv6, DTLS, devices and certificates in English and Russian without a mode change', async () => {
  for (const locale of ['en', 'ru']) {
    const s = server(), before = clone(s.value.configuration), h = harness('ApiConfigurationEditor', { tabId: null }, { api: s.api, locale, translate: rtcText(locale) }); h.render(); await h.settle();
    for (const query of ['STUN', 'TURN', 'IPv4', 'IPv6', 'DTLS', ...(locale === 'ru' ? ['устройства', 'сертификаты'] : ['device', 'certificate'])]) {
      h.attr('data-protection-search').props.onInput({ currentTarget: { value: query } }); await h.settle();
      assert.ok(ruleIds(h).includes('webrtc'), locale + ': ' + query); assert.equal(h.nodes(node => node.type?.name === 'WebRtcProfileOverview').length, 0, 'the dedicated editor moved to Antidetect');
    }
    assert.deepEqual(s.value.configuration, before); assert.equal(s.calls.some(call => call.type === 'ui-api-config-set'), false); h.unmount();
  }
});

test('RTC conflicting device profiles show the localized reason and do not change settings or libraries', async () => {
  const s = server(); s.value.configuration.antidetectEnabled = true; s.value.configuration = updateApiConfiguration(s.value.configuration, 'media-enumeration', { mode: 'custom', selected: entry('media-enumeration').presets[1].value }).value;
  s.value.configuration = updateApiConfiguration(s.value.configuration, 'webrtc', { mode: 'custom', selected: entry('webrtc').presets[0].value }).value;
  const before = clone(s.value.configuration), h = harness('ApiConfigurationEditor', { tabId: null }, { api: s.api, translate: key => WEBRTC_UI_MESSAGES.ru[key] ?? key }); h.render(); await h.settle();
  const picker = h.nodes(node => node.type?.name === 'CustomValueEditor' && node.props.entry.id === 'webrtc')[0], profile = { ...clone(entry('webrtc').presets[0].value.value), randomizeDevices: true };
  await assert.rejects(picker.props.onChange({ selected: { kind: 'value', value: profile } }, { persist: true }), { message: WEBRTC_UI_MESSAGES.ru.protection_webrtc_conflict });
  assert.deepEqual(s.value.configuration, before); assert.equal(s.calls.filter(call => call.type === 'ui-api-config-set').length, 0); h.unmount();
});

test('WebRTC has a direct manual-address editor even outside Custom and saves only its profile without enabling masters', async () => {
  const s = server(), before = clone(s.value.configuration), h = harness('ApiConfigurationEditor', { tabId: null }, { api: s.api, translate: rtcText('ru') });
  try {
    h.render(); await h.settle();
    const configure = h.attr('data-webrtc-row-configure'); assert.ok(configure); assert.equal(configure.props.disabled, false);
    configure.props.onClick(); await h.settle();
    const modal = h.nodes(node => node.type?.name === 'ValueModal')[0]; assert.equal(modal.props.entry.id, 'webrtc');
    assert.deepEqual(s.value.configuration, before); assert.equal(s.calls.filter(call => call.type === 'ui-api-config-set').length, 0);
    const addresses = { ipv4: { host: '192.0.2.117', stun: '198.51.100.118', turn: '203.0.113.119' }, ipv6: { host: '2001:db8::a17', stun: '2001:db8::b18', turn: '2001:db8::c19' } };
    const value = { id: 'manual-addresses', label: 'Manual addresses', value: { kind: 'value', value: { ...clone(entry('webrtc').presets[0].value.value), addresses } } };
    await modal.props.onSave(value); await h.settle();
    const rtc = s.value.configuration.apis.find(row => row.id === 'webrtc');
    assert.equal(rtc.mode, 'custom'); assert.deepEqual(rtc.selected.value.addresses, addresses); assert.equal(rtc.userValues.some(row => row.id === value.id), true);
    assert.equal(s.value.configuration.enabled, before.enabled); assert.equal(s.value.configuration.antidetectEnabled, before.antidetectEnabled);
    assert.deepEqual(s.value.configuration.apis.filter(row => row.id !== 'webrtc'), before.apis.filter(row => row.id !== 'webrtc'));
    assert.equal(s.calls.filter(call => call.type === 'ui-api-config-set').length, 1);
  } finally { h.unmount(); }
});

test('the direct WebRTC editor keeps its opening revision and refuses to overwrite an external configuration', async () => {
  const s = server(), h = harness('ApiConfigurationEditor', { tabId: null }, { api: s.api, translate: rtcText('en') });
  try {
    h.render(); await h.settle(); h.attr('data-webrtc-row-configure').props.onClick(); await h.settle();
    const modal = () => h.nodes(node => node.type?.name === 'ValueModal')[0]; assert.ok(modal());
    const profile = { ...clone(entry('webrtc').presets[0].value.value), addresses: { ipv4: { host: null, stun: '198.51.100.123', turn: null }, ipv6: { host: null, stun: '2001:db8::123', turn: null } } };
    s.value.configuration = updateApiConfiguration(s.value.configuration, 'hardware-concurrency', { mode: 'custom', selected: { kind: 'value', value: 32 } }).value;
    ++s.value.revision; const external = clone(s.value.configuration);
    s.api.storage.onChanged.emit({ 'api-configuration:v1': {} }, 'local'); await h.settle(); assert.ok(modal());
    await assert.rejects(modal().props.onSave({ id: 'stale-manual-ip', label: 'Stale manual IP', value: { kind: 'value', value: profile } }), /another window/);
    assert.equal(s.calls.at(-1).expectedRevision, 5); assert.deepEqual(s.value.configuration, external);
    assert.equal(s.value.configuration.apis.find(row => row.id === 'webrtc').userValues.length, 0);
    assert.ok(modal(), 'a rejected save retains the editable modal');
  } finally { h.unmount(); }
});

test('RTC global native policy changes count in import preview even when no API row changes', () => {
  const before = createApiConfiguration(), after = { ...clone(before), webrtcNetworkPolicy: 'default_public_interface_only' }, summary = apiImportSummary(before, after);
  assert.equal(summary.policyChanged, true); assert.equal(summary.changed.length, 0); assert.equal(summary.sites.length, 0);
});

function modeFilterServer() {
  const s = server(), config = s.value.configuration;
  Object.assign(config.apis.find(row => row.id === 'hardware-concurrency'), { mode: 'custom', selected: { kind: 'value', value: 16 }, userValues: [{ id: 'cpu', label: 'CPU', value: { kind: 'value', value: 16 } }] });
  Object.assign(config.apis.find(row => row.id === 'webgl'), { mode: 'off', selected: { kind: 'value', value: clone(entry('webgl').presets[0].value.value) }, userValues: [{ id: 'gpu', label: 'GPU', value: clone(entry('webgl').presets[0].value) }] });
  config.apis.find(row => row.id === 'canvas-readback').mode = 'on';
  config.apis.find(row => row.id === 'webassembly-memory-grow').mode = 'on';
  return s;
}
const filterNode = h => h.nodes(node => node.type?.name === 'ModeFilters')[0];
const ruleIds = h => h.nodes(node => node.props['data-protection-feature']).map(node => node.props['data-protection-feature']);

test('mode filters distinguish explicit Custom/On from dormant saved values and Off without enabling the master', async () => {
  const s = modeFilterServer(), original = clone(s.value.configuration), h = harness('ApiConfigurationEditor', { tabId: null }, { api: s.api, featureFilter: PROTECTION_FEATURE_FILTER }); h.render(); await h.settle();
  assert.deepEqual(filterNode(h).props.counts, { spoofed: 1, blocked: 2 });
  filterNode(h).props.onChange('spoofed'); await h.settle(); assert.deepEqual(ruleIds(h), ['hardware-concurrency']);
  const categories = h.nodes(node => node.type?.name === 'CategoryFilters')[0]; assert.equal(categories.props.counts.all, 1); assert.equal(categories.props.counts.hardware, 1);
  filterNode(h).props.onChange('blocked'); await h.settle(); assert.deepEqual(ruleIds(h), ['canvas-readback', 'webassembly-memory-grow']);
  assert.equal(h.attr('data-api-wasm-children').props.hidden, false);
  assert.deepEqual(filterNode(h).props.counts, { spoofed: 1, blocked: 2 });
  assert.deepEqual(s.value.configuration, original); assert.equal(s.value.configuration.enabled, false);
  assert.equal(s.calls.filter(call => call.type === 'ui-api-config-set').length, 0); h.unmount();
});

test('mode filters intersect category, search and group; clear restores the whole catalogue', async () => {
  const s = modeFilterServer(), h = harness('ApiConfigurationEditor', { tabId: null }, { api: s.api, featureFilter: PROTECTION_FEATURE_FILTER }); h.render(); await h.settle();
  filterNode(h).props.onChange('blocked'); await h.settle();
  h.nodes(node => node.type?.name === 'CategoryFilters')[0].props.onChange('browser'); await h.settle();
  assert.deepEqual(ruleIds(h), ['webassembly-memory-grow']); assert.deepEqual(filterNode(h).props.counts, { spoofed: 0, blocked: 1 });
  h.attr('data-api-group-picker').props.onChange({ currentTarget: { value: 'webassembly' } }); await h.settle();
  h.attr('data-protection-search').props.onInput({ currentTarget: { value: 'missing-operation' } }); await h.settle();
  assert.deepEqual(ruleIds(h), []); assert.deepEqual(filterNode(h).props.counts, { spoofed: 0, blocked: 0 });
  h.attr('data-protection-filter-clear').props.onClick(); await h.settle();
  assert.equal(filterNode(h).props.value, 'all'); assert.equal(ruleIds(h).length, API_CONFIG_CATALOG.length);
  assert.equal(s.calls.filter(call => call.type === 'ui-api-config-set').length, 0); h.unmount();
});

test('saving a filtered mode removes the row, restores filter focus and preserves dormant Custom library', async () => {
  const s = modeFilterServer(), original = clone(s.value.configuration), h = harness('ApiConfigurationEditor', { tabId: null }, { api: s.api }); h.render(); await h.settle();
  filterNode(h).props.onChange('spoofed'); await h.settle(); let focused = false;
  filterNode(h).props.focusRef.current = { querySelector: () => ({ getClientRects: () => [{}], focus() { focused = true; } }) };
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document'), origin = { closest: () => ({ getAttribute: () => 'hardware-concurrency' }) };
  h.tree.props.ref.current = { contains: value => value === origin };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { activeElement: origin, body: {} } });
  try { h.nodes(node => node.type?.name === 'ModeControl')[0].props.onChange('off'); await h.settle(); }
  finally { if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else delete globalThis.document; }
  assert.deepEqual(ruleIds(h), []); assert.equal(filterNode(h).props.counts.spoofed, 0); assert.equal(focused, true);
  assert.deepEqual(s.value.configuration, updateApiConfiguration(original, 'hardware-concurrency', { mode: 'off' }).value);
  assert.equal(s.calls.filter(call => call.type === 'ui-api-config-set').length, 1);
  filterNode(h).props.onChange('all'); await h.settle();
  const cpu = h.nodes(node => node.type?.name === 'ModeControl' && node.props.entry.id === 'hardware-concurrency')[0].props.entry;
  assert.equal(cpu.mode, 'off'); assert.deepEqual(cpu.userValues, original.apis.find(row => row.id === cpu.id).userValues);
  assert.deepEqual(cpu.selected, original.apis.find(row => row.id === cpu.id).selected); h.unmount();
});

test('site filters include only the site own modes while preserving global inherited Custom and blocked settings', async () => {
  const s = modeFilterServer();
  s.value.configuration = updateApiConfiguration(s.value.configuration, 'navigator-language', { mode: 'custom', selected: { kind: 'value', value: 'de-DE' } }, 'example.com').value;
  s.value.configuration = updateApiConfiguration(s.value.configuration, 'webassembly-table-get', { mode: 'on' }, 'example.com').value;
  s.value.configuration.sites[0].disabled = true;
  const h = harness('ApiConfigurationEditor', { tabId: 11 }, { api: s.api }); h.render(); await h.settle();
  assert.deepEqual(filterNode(h).props.counts, { spoofed: 1, blocked: 1 });
  filterNode(h).props.onChange('spoofed'); await h.settle(); assert.deepEqual(ruleIds(h), ['navigator-language']);
  filterNode(h).props.onChange('blocked'); await h.settle(); assert.deepEqual(ruleIds(h), ['webassembly-table-get']);
  assert.equal(s.calls.filter(call => call.type === 'ui-api-config-set').length, 0); h.unmount();
});

test('two pressed mode chips toggle off and support keyboard selection/reset with decorative icons', async () => {
  const changes = [], h = harness('ModeFilters', { value: 'all', counts: { spoofed: 2, blocked: 3 }, onChange: value => changes.push(value) }); h.render();
  assert.equal(h.attr('data-api-mode-filters').props.role, 'group');
  assert.equal(h.attr('data-api-mode-filter', 'spoofed').props.tabIndex, 0); assert.equal(h.attr('data-api-mode-filter', 'blocked').props.tabIndex, -1);
  assert.equal(h.attr('data-api-mode-filter', 'spoofed').props['aria-pressed'], false);
  h.attr('data-api-mode-filter', 'spoofed').props.onClick(); assert.equal(changes.at(-1), 'spoofed');
  h.update({ value: 'spoofed' }); h.attr('data-api-mode-filter', 'spoofed').props.onClick(); assert.equal(changes.at(-1), 'all');
  h.attr('data-api-mode-filters').props.onKeyDown({ key: 'End', preventDefault }); assert.equal(changes.at(-1), 'blocked');
  h.update({ value: 'blocked' }); h.attr('data-api-mode-filters').props.onKeyDown({ key: 'Escape', preventDefault }); assert.equal(changes.at(-1), 'all');
  const icons = h.nodes(node => node.type === 'svg'); assert.equal(icons.length, 2); for (const icon of icons) assert.equal(icon.props['aria-hidden'], true);
  h.unmount();
});

test('typed input keeps empty strings, absent selection, null, and undefined distinct', () => {
  assert.deepEqual(parseApiValueInput(entry('navigator-vendor'), 'value', '').value, { kind: 'value', value: '' });
  assert.deepEqual(parseApiValueInput(entry('navigator-oscpu'), 'undefined', '').value, { kind: 'undefined' });
  assert.deepEqual(parseApiValueInput(entry('webgpu'), 'null', '').value, { kind: 'null' });
  assert.equal(parseApiValueInput(entry('hardware-concurrency'), 'value', '').ok, false);
  assert.equal(parseApiValueInput(entry('hardware-concurrency'), 'value', '8.5').ok, false);
  assert.equal(parseApiValueInput(entry('hardware-concurrency'), 'value', 'Infinity').ok, false);
  assert.equal(parseApiValueInput(entry('hardware-concurrency'), 'value', '0').ok, false);
  assert.equal(parseApiValueInput(entry('hardware-concurrency'), 'value', '16').value.value, 16);
  assert.equal(parseApiValueInput(entry('navigator-language'), 'value', 'ru-RU').value.value, 'ru-RU');
  assert.notEqual(formatApiValue({ kind: 'unset' }), formatApiValue({ kind: 'null' }));
  assert.notEqual(formatApiValue({ kind: 'value', value: '' }), formatApiValue({ kind: 'unset' }));
});

test('canonical object equality recognizes presets after core normalization', () => {
  const original = entry('webgl').presets[0].value, normalized = parseApiValueInput(entry('webgl'), 'value', JSON.stringify(original.value));
  assert.equal(normalized.ok, true); assert.equal(sameApiValue(original, normalized.value), true);
  assert.equal(sameApiValue({ kind: 'value', value: ['a', 'b'] }, { kind: 'value', value: ['b', 'a'] }), false);
});

test('value search includes hundreds of saved records and matches names and content', () => {
  const item = entry('hardware-concurrency'); item.userValues = Array.from({ length: 200 }, (_, index) => ({ id: 'custom-' + (index + 1), label: 'CPU configuration ' + (index + 1), value: { kind: 'value', value: index + 1 } }));
  assert.equal(filterApiValues(item).userValues.length, 200);
  assert.equal(filterApiValues(item, 'CPU configuration 200').userValues[0].id, 'custom-200');
  assert.ok(filterApiValues(item, ' 16 ').userValues.some(value => value.value.value === 16));
});

test('opening the unified editor only reads configuration and cleans up native event listeners', async () => {
  const s = server(), h = harness('ApiConfigurationEditor', { tabId: 11 }, { api: s.api });
  h.render(); await h.settle();
  assert.ok(h.attr('data-api-configuration-editor'));
  assert.equal(s.calls.length, 1); assert.equal(s.calls[0].type, 'ui-api-config-get');
  assert.equal(h.nodes(node => node.props['data-protection-feature']).length, API_CONFIG_CATALOG.length);
  assert.equal(h.nodes(node => node.type?.name === 'CustomValueEditor').length, 0, 'Bypass rows have no editable Custom values');
  assert.equal(s.api.storage.onChanged.size, 1);
  h.unmount(); assert.equal(s.api.storage.onChanged.size, 0); assert.equal(s.api.webNavigation.onCommitted.size, 0);
});

test('WebAssembly starts compact with its namespace control, 37 hidden technical operations and deterministic Browser counts', async () => {
  const s = server(), h = harness('ApiConfigurationEditor', { tabId: null }, { api: s.api, featureFilter: PROTECTION_FEATURE_FILTER }); h.render(); await h.settle();
  const children = h.attr('data-api-wasm-children'), toggle = h.attr('data-api-wasm-toggle');
  assert.equal(children.props['data-api-wasm-count'], 37); assert.equal(children.props.hidden, true); assert.equal(children.props.inert, true);
  assert.equal(toggle.props['aria-expanded'], false); assert.equal(toggle.props['aria-controls'], children.props.id);
  const group = h.attr('data-protection-group', 'webassembly');
  const controls = h.nodes(node => node.type?.name === 'ModeControl' && node.props.entry.group === 'webassembly');
  assert.equal(controls.length, 37);
  for (const control of controls) { assert.equal(control.props.label, control.props.entry.name); assert.equal(control.props.entry.customSupported, false); }
  assert.ok(group.props.children[1].props.children[0].props['data-protection-feature'] === 'webassembly', 'namespace control remains outside the collapsed children');
  const filters = h.nodes(node => node.type?.name === 'CategoryFilters')[0];
  assert.equal(filters.props.counts.all, 158); assert.equal(filters.props.counts.browser, 63);
  filters.props.onChange('browser'); await h.settle();
  assert.equal(h.nodes(node => node.props['data-protection-feature']).length, 63);
  assert.equal(h.attr('data-api-wasm-children').props.hidden, true, 'choosing the broad Browser filter preserves compact display');
  assert.equal(s.calls.filter(call => call.type === 'ui-api-config-set').length, 0);
  h.unmount();
});

test('collapsing WebAssembly preserves an unrelated draft after saving a mode; search and group selection reveal operations', async () => {
  const s = server(), original = clone(s.value.configuration.apis.filter(row => !row.id.startsWith('webassembly-'))), h = harness('ApiConfigurationEditor', { tabId: null }, { api: s.api }); h.render(); await h.settle();
  h.attr('data-api-wasm-toggle').props.onClick(); await h.settle();
  h.attr('data-protection-preset-select').props.onChange({ currentTarget: { value: 'strict' } }); await h.settle();
  const operation = () => h.nodes(node => node.type?.name === 'ModeControl' && node.props.entry.id === 'webassembly-memory-grow')[0];
  operation().props.onChange('on'); await h.settle();
  const focusedControl = {}, previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document'); let restoredFocus = 0;
  h.attr('data-api-wasm-toggle').props.ref.current = { focus() { restoredFocus++; } };
  h.attr('data-api-wasm-children').props.ref.current = { contains: value => value === focusedControl };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { activeElement: focusedControl } });
  try { h.attr('data-api-wasm-toggle').props.onClick(); }
  finally { if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else delete globalThis.document; }
  await h.settle(); assert.equal(restoredFocus, 1, 'collapse moves focus out of the hidden operation controls');
  assert.equal(h.attr('data-api-wasm-children').props.hidden, true);
  assert.equal(operation().props.entry.mode, 'on');
  assert.equal(s.calls.filter(call => call.type === 'ui-api-config-set').length, 1);
  assert.equal(s.value.configuration.preset, 'limited'); assert.equal(h.attr('data-protection-preset-select').props.value, 'strict');
  h.attr('data-protection-search').props.onInput({ currentTarget: { value: 'WebAssembly' } }); await h.settle();
  assert.equal(h.attr('data-api-wasm-children').props.hidden, false);
  assert.equal(h.nodes(node => node.props['data-protection-feature']).length, 38);
  h.attr('data-protection-search').props.onInput({ currentTarget: { value: 'Memory.grow' } }); await h.settle();
  assert.deepEqual(h.nodes(node => node.props['data-protection-feature']).map(node => node.props['data-protection-feature']), ['webassembly-memory-grow']);
  assert.equal(operation().props.entry.mode, 'on');
  h.attr('data-protection-search').props.onInput({ currentTarget: { value: '' } }); await h.settle();
  h.attr('data-api-group-picker').props.onChange({ currentTarget: { value: 'webassembly' } }); await h.settle();
  assert.equal(h.nodes(node => node.props['data-protection-feature']).length, 38);
  assert.equal(h.attr('data-api-wasm-children').props.hidden, false);
  h.attr('data-protection-action', 'save').props.onClick(); await h.settle();
  assert.equal(s.value.configuration.apis.find(row => row.id === 'webassembly-memory-grow').mode, 'on');
  assert.deepEqual(s.value.configuration.apis.filter(row => !row.id.startsWith('webassembly-')), original);
  h.unmount();
});

test('configured-only reveals a configured WebAssembly operation and its unsupported Custom has no value editor', async () => {
  const s = server(); s.value.configuration = updateApiConfiguration(s.value.configuration, 'webassembly-table-get', { mode: 'on' }).value;
  const h = harness('ApiConfigurationEditor', { tabId: null }, { api: s.api }); h.render(); await h.settle();
  const configured = h.nodes(node => node.type === 'input' && node.props.type === 'checkbox' && node.props.checked === false)[0];
  configured.props.onChange({ currentTarget: { checked: true } }); await h.settle();
  assert.deepEqual(h.nodes(node => node.props['data-protection-feature']).map(node => node.props['data-protection-feature']), ['webassembly-table-get']);
  assert.equal(h.attr('data-api-wasm-children').props.hidden, false);
  assert.equal(h.nodes(node => node.type?.name === 'CustomValueEditor').length, 0);
  const mode = harness('ModeControl', { entry: entry('webassembly-table-get'), disabled: false, onChange() {} }); mode.render();
  assert.equal(mode.attr('data-protection-state', 'custom').props.disabled, true);
  mode.unmount(); h.unmount();
});

test('WebAssembly expansion actions use the selected production locale and retain the technical name', async () => {
  const h = harness('ApiConfigurationEditor', { tabId: null }, { locale: 'ar', translate: key => WEBASSEMBLY_UI_MESSAGES.ar[key] ?? key }); h.render(); await h.settle();
  assert.equal(h.attr('data-api-wasm-toggle').props['aria-label'], WEBASSEMBLY_UI_MESSAGES.ar.protection_webassembly_expand + ' — WebAssembly');
  h.attr('data-api-wasm-toggle').props.onClick(); await h.settle();
  assert.equal(h.attr('data-api-wasm-toggle').props['aria-label'], WEBASSEMBLY_UI_MESSAGES.ar.protection_webassembly_collapse + ' — WebAssembly');
  h.unmount();
});

test('mode clicks save immediately with a valid selected Custom value and unsupported Custom remains disabled', async () => {
  const s = server(); s.value.configuration.antidetectEnabled = true; const h = harness('ApiConfigurationEditor', { tabId: null }, { api: s.api }); h.render(); await h.settle();
  const control = () => h.nodes(node => node.type?.name === 'ModeControl' && node.props.entry.id === 'hardware-concurrency')[0];
  control().props.onChange('custom'); await h.settle();
  assert.equal(s.calls.filter(call => call.type === 'ui-api-config-set').length, 1);
  assert.equal(control().props.entry.mode, 'custom'); assert.equal(control().props.entry.selected.value, 2);
  assert.equal(s.value.configuration.apis.find(item => item.id === 'hardware-concurrency').mode, 'custom');
  assert.equal(s.value.revision, 6);
  assert.equal(h.attr('data-protection-action', 'save').props.disabled, true);
  assert.match(h.attr('data-api-mode-status').props.children, /Mode saved.*Reload/);
  const unsupported = harness('ModeControl', { entry: entry('audio'), disabled: false, onChange() {} }); unsupported.render();
  assert.equal(unsupported.attr('data-protection-state', 'custom').props.disabled, true);
  assert.ok(unsupported.attr('data-protection-state', 'custom').props.title);
  unsupported.unmount(); h.unmount();
});

test('the API master commits only its own field and retains unrelated drafts for explicit Save', async () => {
  const s = server(); seedCpu(s); const before = clone(s.value.configuration);
  const h = harness('ApiConfigurationEditor', { tabId: null }, { api: s.api }); h.render(); await h.settle();
  await draftCpu(h, 16); h.attr('data-protection-preset-select').props.onChange({ currentTarget: { value: 'strict' } }); await h.settle();
  h.attr('data-protection-master').props.onClick(); await h.settle();
  const writes = s.calls.filter(call => call.type === 'ui-api-config-set');
  assert.equal(writes.length, 1); assert.deepEqual(writes[0].configuration, { ...before, enabled: true });
  assert.equal(cpu(h).props.entry.selected.value, 16); assert.equal(h.attr('data-protection-preset-select').props.value, 'strict');
  assert.equal(s.value.configuration.apis.find(row => row.id === 'hardware-concurrency').selected.value, 2);
  assert.equal(s.value.configuration.preset, 'limited'); assert.equal(s.value.configuration.antidetectEnabled, before.antidetectEnabled);
  h.attr('data-protection-save').props.onClick(); await h.settle();
  assert.equal(s.value.configuration.apis.find(row => row.id === 'hardware-concurrency').selected.value, 16);
  assert.equal(s.value.configuration.preset, 'strict'); assert.equal(s.value.configuration.enabled, true); h.unmount();
});

test('an immediate row save preserves unrelated API and preset drafts without writing them', async () => {
  const s = server(); seedCpu(s); const before = clone(s.value.configuration), h = harness('ApiConfigurationEditor', { tabId: null }, { api: s.api }); h.render(); await h.settle();
  await draftCpu(h); h.attr('data-protection-preset-select').props.onChange({ currentTarget: { value: 'strict' } });
  await h.settle();
  h.nodes(node => node.type?.name === 'ModeControl' && node.props.entry.id === 'webgl')[0].props.onChange('on'); await h.settle();
  const writes = s.calls.filter(call => call.type === 'ui-api-config-set'); assert.equal(writes.length, 1); assert.equal(writes[0].expectedRevision, 5);
  assert.deepEqual(writes[0].configuration, updateApiConfiguration(before, 'webgl', { mode: 'on' }).value);
  assert.equal(s.value.configuration.enabled, false); assert.equal(s.value.configuration.webrtcNetworkPolicy, 'system'); assert.equal(s.value.configuration.preset, 'limited');
  assert.equal(cpu(h).props.entry.selected.value, 16); assert.equal(h.attr('data-protection-preset-select').props.value, 'strict');
  assert.equal(h.attr('data-protection-save').props.disabled, false); assert.equal(s.calls.filter(call => call.type === 'ui-protection-reload').length, 0);
  assert.equal(h.attr('data-api-mode-status').props.children, 'Configuration saved. API management is off'); assert.equal(h.attr('data-api-row-status', 'webgl').props.children, 'Configuration saved. API management is off');
  const children = h.tree.props.children; assert.ok(children.indexOf(h.attr('data-api-mode-status')) < children.indexOf(h.nodes(node => node.props.class === 'blocking-groups')[0]));
  h.attr('data-protection-save').props.onClick(); await h.settle();
  assert.equal(s.calls.filter(call => call.type === 'ui-api-config-set')[1].expectedRevision, 6); assert.equal(s.value.configuration.apis.find(row => row.id === 'hardware-concurrency').selected.value, 16);
  assert.equal(s.value.configuration.preset, 'strict'); assert.equal(s.value.configuration.webrtcNetworkPolicy, 'system'); h.unmount();
});

test('an Antidetect-only Custom save reloads the exact source and preserves the inactive API Guard master', async () => {
  const s = server(); s.value.configuration.antidetectEnabled = true; s.value.reloadRequired = true;
  const h = harness('ApiConfigurationEditor', { tabId: 11 }, { api: s.api }); h.render(); await h.settle();
  h.nodes(node => node.type?.name === 'ModeControl' && node.props.entry.id === 'hardware-concurrency')[0].props.onChange('custom'); await h.settle();
  assert.equal(s.value.configuration.enabled, false); assert.equal(s.value.configuration.antidetectEnabled, true);
  assert.equal(s.calls.filter(call => call.type === 'ui-protection-reload').length, 1);
  assert.equal(s.calls.find(call => call.type === 'ui-protection-reload').documentId, 'document-1');
  assert.equal(s.value.documentId, 'document-2');
  assert.doesNotMatch(h.attr('data-api-mode-status').props.children, /OFF|management is off/); h.unmount();
});

test('import preview recognizes an Antidetect-only master change without inventing API or site edits', () => {
  const before = createApiConfiguration(), after = { ...clone(before), antidetectEnabled: true };
  assert.deepEqual(apiImportSummary(before, after), { changed: [], sites: [], policyChanged: true });
});

test('a row mode saves with the master OFF without reloading the real source document', async () => {
  const s = server(), before = clone(s.value.configuration), h = harness('ApiConfigurationEditor', { tabId: 11 }, { api: s.api }); h.render(); await h.settle();
  h.nodes(node => node.type?.name === 'ModeControl' && node.props.entry.id === 'webgl')[0].props.onChange('on'); await h.settle();
  assert.deepEqual(s.value.configuration, updateApiConfiguration(before, 'webgl', { mode: 'on' }, 'example.com').value);
  assert.equal(s.calls.filter(call => call.type === 'ui-api-config-set').length, 1); assert.equal(s.calls.filter(call => call.type === 'ui-protection-reload').length, 0);
  assert.equal(s.value.documentId, 'document-1'); assert.equal(s.value.configuration.enabled, false); assert.equal(h.attr('data-api-mode-status').props.children, 'Configuration saved. API management is off'); h.unmount();
});

test('switching back to Custom persists the selected draft value without losing its saved library', async () => {
  const s = server(), library = [{ id: 'cpu-2', label: 'Two', value: { kind: 'value', value: 2 } }, { id: 'cpu-16', label: 'Sixteen', value: { kind: 'value', value: 16 } }];
  s.value.configuration = updateApiConfiguration(s.value.configuration, 'hardware-concurrency', { mode: 'custom', selected: library[0].value, userValues: library }).value;
  const savedLibrary = clone(s.value.configuration.apis.find(row => row.id === 'hardware-concurrency').userValues);
  const h = harness('ApiConfigurationEditor', { tabId: null }, { api: s.api }); h.render(); await h.settle(); await draftCpu(h);
  const control = () => h.nodes(node => node.type?.name === 'ModeControl' && node.props.entry.id === 'hardware-concurrency')[0];
  control().props.onChange('on'); await h.settle(); assert.equal(s.value.configuration.apis.find(row => row.id === 'hardware-concurrency').selected.value, 2);
  assert.equal(control().props.entry.selected.value, 16); control().props.onChange('custom'); await h.settle();
  const saved = s.value.configuration.apis.find(row => row.id === 'hardware-concurrency'); assert.deepEqual(saved.selected, library[1].value); assert.deepEqual(saved.userValues, savedLibrary);
  assert.equal(s.calls.filter(call => call.type === 'ui-api-config-set').length, 2); assert.equal(h.attr('data-protection-save').props.disabled, true); h.unmount();
});

test('a pending or refused mode save never highlights an uncommitted mode or sends duplicate writes', async () => {
  const s = server(), before = clone(s.value.configuration); let release;
  s.value.intercept = request => request.type === 'ui-api-config-set' ? new Promise(resolve => { release = resolve; }) : undefined;
  const h = harness('ApiConfigurationEditor', { tabId: 11 }, { api: s.api }); h.render(); await h.settle();
  const control = () => h.nodes(node => node.type?.name === 'ModeControl' && node.props.entry.id === 'webgl')[0];
  control().props.onChange('on'); await h.settle(); assert.equal(control().props.entry.mode, 'bypass'); assert.equal(control().props.disabled, true);
  assert.match(h.attr('data-api-row-status', 'webgl').props.children, /Saving API mode/); control().props.onChange('off'); await h.settle();
  assert.equal(s.calls.filter(call => call.type === 'ui-api-config-set').length, 1); release({ schemaVersion: 1, type: 'api-config-error', code: 'stale-revision' }); await h.settle();
  assert.deepEqual(s.value.configuration, before); assert.equal(control().props.entry.mode, 'bypass'); assert.equal(control().props.disabled, false);
  assert.equal(h.attr('data-api-row-status', 'webgl').props.role, 'alert'); assert.match(h.attr('data-api-mode-status').props.children, /another window/);
  assert.equal(s.calls.filter(call => call.type === 'ui-protection-reload').length, 0); h.unmount();
});

test('a rejected cross-API mode transition explains the conflict beside the unchanged row without a write', async () => {
  const s = server(); s.value.configuration.antidetectEnabled = true;
  s.value.configuration = updateApiConfiguration(s.value.configuration, 'media-enumeration', { mode: 'custom', selected: entry('media-enumeration').presets[1].value }).value;
  const profile = { ...clone(entry('webrtc').presets[0].value.value), randomizeDevices: true };
  s.value.configuration = updateApiConfiguration(s.value.configuration, 'webrtc', { mode: 'off', selected: { kind: 'value', value: profile } }).value;
  const before = clone(s.value.configuration), h = harness('ApiConfigurationEditor', { tabId: null }, { api: s.api, translate: key => WEBRTC_UI_MESSAGES.ru[key] ?? key }); h.render(); await h.settle();
  h.nodes(node => node.type?.name === 'ModeControl' && node.props.entry.id === 'webrtc')[0].props.onChange('custom'); await h.settle();
  assert.deepEqual(s.value.configuration, before); assert.equal(s.calls.filter(call => call.type === 'ui-api-config-set').length, 0);
  assert.equal(h.nodes(node => node.type?.name === 'ModeControl' && node.props.entry.id === 'webrtc')[0].props.entry.mode, 'off');
  assert.equal(h.attr('data-api-row-status', 'webrtc').props.role, 'alert'); assert.equal(h.attr('data-api-mode-status').props.children, WEBRTC_UI_MESSAGES.ru.protection_webrtc_conflict); h.unmount();
});

test('automatic reload waits for verified registration and never reloads a page reached while Save was pending', async () => {
  for (const changedIdentity of [{ documentId: 'document-2', host: 'example.com' }, { documentId: 'document-1', host: 'other.example' }, { documentId: null, host: null }]) {
    const s = server(); s.value.configuration.enabled = true;
    s.value.intercept = request => { if (request.type === 'ui-api-config-set') Object.assign(s.value, changedIdentity); };
    const h = harness('ApiConfigurationEditor', { tabId: 11 }, { api: s.api }); h.render(); await h.settle();
    h.nodes(node => node.type?.name === 'ModeControl' && node.props.entry.id === 'webgl')[0].props.onChange('on'); await h.settle();
    assert.equal(s.calls.filter(call => call.type === 'ui-api-config-set').length, 1); assert.equal(s.calls.filter(call => call.type === 'ui-protection-reload').length, 0);
    assert.equal(s.value.configuration.sites[0].apis.find(row => row.id === 'webgl').mode, 'on'); assert.match(h.attr('data-api-mode-status').props.children, /Mode saved.*Reload/); h.unmount();
  }
  const s = server(); s.value.configuration.enabled = true; s.value.registration = 'error'; s.value.reloadRequired = true;
  const h = harness('ApiConfigurationEditor', { tabId: 11 }, { api: s.api }); h.render(); await h.settle();
  h.nodes(node => node.type?.name === 'ModeControl' && node.props.entry.id === 'webgl')[0].props.onChange('on'); await h.settle();
  assert.equal(s.value.configuration.sites[0].apis.find(row => row.id === 'webgl').mode, 'on'); assert.equal(s.calls.filter(call => call.type === 'ui-protection-reload').length, 0);
  assert.equal(h.attr('data-api-row-status', 'webgl').props.role, 'alert'); assert.match(h.attr('data-api-mode-status').props.children, /not applied/); h.unmount();
});

test('saving a new exact-site row creates only its minimum site and never reloads an unrelated source host', async () => {
  const s = server(), before = clone(s.value.configuration), h = harness('ApiConfigurationEditor', { tabId: 11 }, { api: s.api }); h.render(); await h.settle();
  h.attr('data-protection-host').props.onInput({ currentTarget: { value: 'other.example' } }); await h.settle();
  h.nodes(node => node.type === 'button' && node.props.children === 'Add site')[0].props.onClick(); await h.settle();
  h.nodes(node => node.type === 'input' && node.props.type === 'checkbox' && node.props.disabled === false && node.props.checked === false)[0].props.onChange({ currentTarget: { checked: true } }); await h.settle();
  h.nodes(node => node.type?.name === 'ModeControl' && node.props.entry.id === 'webgl')[0].props.onChange('on'); await h.settle();
  assert.deepEqual(s.value.configuration, updateApiConfiguration(before, 'webgl', { mode: 'on' }, 'other.example').value);
  assert.equal(s.value.configuration.sites[0].disabled, false); assert.equal(h.nodes(node => node.type === 'input' && node.props.type === 'checkbox' && node.props.checked === true)[0].props.checked, true);
  assert.equal(s.calls.filter(call => call.type === 'ui-protection-reload').length, 0); h.unmount();
});

test('source reload refreshes document identity before the next mode click and suppresses the global reload flag for that revision', async () => {
  const s = server(); s.value.configuration.enabled = true; s.value.reloadRequired = true; let count = 1;
  s.value.intercept = request => { if (request.type === 'ui-protection-reload') { assert.equal(request.documentId, 'document-' + count); s.value.documentId = 'document-' + (++count); s.api.webNavigation.onCommitted.emit({ tabId: 11, frameId: 0 }); return { schemaVersion: 1, type: 'protection-state' }; } };
  const h = harness('ApiConfigurationEditor', { tabId: 11 }, { api: s.api }); h.render(); await h.settle();
  const control = () => h.nodes(node => node.type?.name === 'ModeControl' && node.props.entry.id === 'webgl')[0];
  control().props.onChange('on'); await h.settle(); assert.equal(s.value.documentId, 'document-2'); assert.equal(h.attr('data-api-config-reload'), undefined);
  s.api.webNavigation.onCommitted.emit({ tabId: 11, frameId: 0 }); await h.settle(); assert.equal(h.attr('data-api-config-reload'), undefined); assert.equal(h.attr('data-api-mode-status').props.children, 'Configuration saved');
  control().props.onChange('bypass'); await h.settle(); assert.equal(s.value.documentId, 'document-3');
  assert.deepEqual(s.calls.filter(call => call.type === 'ui-protection-reload'), [{ schemaVersion: 1, type: 'ui-protection-reload', tabId: 11, documentId: 'document-1' }, { schemaVersion: 1, type: 'ui-protection-reload', tabId: 11, documentId: 'document-2' }]);
  assert.equal(h.attr('data-api-config-reload'), undefined); h.unmount();
});

test('a held reload keeps modes busy until a native new document is observed and preserves unrelated drafts', async () => {
  const s = server(); s.value.configuration.enabled = true; s.value.reloadRequired = true;
  s.value.intercept = request => { if (request.type === 'ui-protection-reload') { assert.equal(s.api.webNavigation.onCommitted.size, 2, 'the completion listener is installed before dispatch'); return { schemaVersion: 1, type: 'protection-state' }; } };
  const h = harness('ApiConfigurationEditor', { tabId: 11 }, { api: s.api }); h.render(); await h.settle();
  h.attr('data-protection-preset-select').props.onChange({ currentTarget: { value: 'strict' } }); await h.settle();
  const mode = () => h.nodes(node => node.type?.name === 'ModeControl' && node.props.entry.id === 'webgl')[0]; mode().props.onChange('on'); await h.settle();
  assert.equal(h.tree.props['aria-busy'], true); assert.equal(mode().props.disabled, true); assert.match(h.attr('data-api-row-status', 'webgl').props.children, /Saving/);
  mode().props.onChange('off'); await h.settle(); assert.equal(s.calls.filter(call => call.type === 'ui-api-config-set').length, 1);
  s.value.documentId = 'document-2'; s.api.webNavigation.onCommitted.emit({ tabId: 11, frameId: 0, documentId: 'document-2' }); await h.settle();
  assert.equal(h.tree.props['aria-busy'], false); assert.equal(mode().props.disabled, false); assert.equal(h.attr('data-api-config-reload'), undefined);
  assert.equal(h.attr('data-api-mode-status').props.children, 'Configuration saved'); assert.equal(s.api.webNavigation.onCommitted.size, 1);
  assert.equal(h.attr('data-protection-preset-select').props.value, 'strict'); assert.equal(s.value.configuration.preset, 'limited'); h.unmount();
});

test('a native document commit arriving before the reload ACK is retained without clearing busy early', async () => {
  const s = server(); s.value.configuration.enabled = true; let release;
  s.value.intercept = request => { if (request.type === 'ui-protection-reload') { s.value.documentId = 'document-2'; s.api.webNavigation.onCommitted.emit({ tabId: 11, frameId: 0 }); return new Promise(resolve => { release = resolve; }); } };
  const h = harness('ApiConfigurationEditor', { tabId: 11 }, { api: s.api }); h.render(); await h.settle();
  h.nodes(node => node.type?.name === 'ModeControl' && node.props.entry.id === 'webgl')[0].props.onChange('on'); await h.settle(); assert.equal(h.tree.props['aria-busy'], true);
  release({ schemaVersion: 1, type: 'protection-state' }); await h.settle(); assert.equal(h.tree.props['aria-busy'], false); assert.equal(h.attr('data-api-mode-status').props.children, 'Configuration saved');
  assert.equal(s.api.webNavigation.onCommitted.size, 1); h.unmount();
});

test('reload observation times out as saved and pending, then a late native commit clears only that pending intent', async () => {
  const s = server(); s.value.configuration.enabled = true; s.value.reloadRequired = true;
  s.value.intercept = request => request.type === 'ui-protection-reload' ? { schemaVersion: 1, type: 'protection-state' } : undefined;
  const h = harness('ApiConfigurationEditor', { tabId: 11 }, { api: s.api }); h.render(); await h.settle();
  h.attr('data-protection-preset-select').props.onChange({ currentTarget: { value: 'strict' } }); await h.settle();
  h.nodes(node => node.type?.name === 'ModeControl' && node.props.entry.id === 'webgl')[0].props.onChange('on'); await h.settle();
  await new Promise(resolve => setTimeout(resolve, 2050)); await h.settle();
  assert.equal(h.tree.props['aria-busy'], false); assert.equal(h.attr('data-api-mode-status').props.role, 'status'); assert.match(h.attr('data-api-mode-status').props.children, /Mode saved.*Reload/);
  assert.equal(s.calls.filter(call => call.type === 'ui-api-config-set').length, 1); assert.equal(s.calls.filter(call => call.type === 'ui-protection-reload').length, 1); assert.equal(s.api.webNavigation.onCommitted.size, 1);
  s.value.documentId = 'document-2'; s.api.webNavigation.onCommitted.emit({ tabId: 11, frameId: 0 }); await h.settle();
  assert.equal(h.attr('data-api-mode-status').props.children, 'Configuration saved'); assert.equal(h.attr('data-api-config-reload'), undefined);
  assert.equal(h.attr('data-protection-preset-select').props.value, 'strict'); assert.equal(s.value.configuration.preset, 'limited'); h.unmount();
});

test('a reload ACK arriving after its deadline reconciles an already observed new document without another write', async () => {
  const s = server(); s.value.configuration.enabled = true; s.value.reloadRequired = true; let release;
  s.value.intercept = request => request.type === 'ui-protection-reload' ? new Promise(resolve => { release = resolve; }) : undefined;
  const h = harness('ApiConfigurationEditor', { tabId: 11 }, { api: s.api }); h.render(); await h.settle();
  h.nodes(node => node.type?.name === 'ModeControl' && node.props.entry.id === 'webgl')[0].props.onChange('on'); await h.settle();
  s.value.documentId = 'document-2'; s.api.webNavigation.onCommitted.emit({ tabId: 11, frameId: 0 }); await h.settle();
  await new Promise(resolve => setTimeout(resolve, 2050)); await h.settle();
  assert.equal(h.tree.props['aria-busy'], false); assert.match(h.attr('data-api-mode-status').props.children, /Mode saved.*Reload/);
  s.api.webNavigation.onCommitted.emit({ tabId: 11, frameId: 0 }); await h.settle(); assert.match(h.attr('data-api-mode-status').props.children, /Reload/);
  release({ schemaVersion: 1, type: 'protection-state' }); await h.settle();
  assert.equal(h.attr('data-api-mode-status').props.children, 'Configuration saved'); assert.equal(h.attr('data-api-config-reload'), undefined);
  assert.equal(s.calls.filter(call => call.type === 'ui-api-config-set').length, 1); assert.equal(s.calls.filter(call => call.type === 'ui-protection-reload').length, 1); assert.equal(s.api.webNavigation.onCommitted.size, 1); h.unmount();
});

test('a completed filtered mode save does not take focus from a control chosen while saving', async () => {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  try {
    for (const moved of [false, true]) {
      const s = server(); seedCpu(s); let release, request, focused = 0;
      const body = {}, other = {}, document = { activeElement: null, body }, origin = { closest: () => ({ getAttribute: () => 'hardware-concurrency' }) };
      document.activeElement = origin; Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
      const h = harness('ApiConfigurationEditor', { tabId: null }, { api: s.api }); h.render(); await h.settle(); filterNode(h).props.onChange('spoofed'); await h.settle();
      h.tree.props.ref.current = { contains: value => value === origin }; filterNode(h).props.focusRef.current = { querySelector: () => ({ getClientRects: () => [{}], focus() { focused++; } }) };
      s.value.intercept = value => value.type === 'ui-api-config-set' ? (request = value, new Promise(resolve => { release = resolve; })) : undefined;
      h.nodes(node => node.type?.name === 'ModeControl')[0].props.onChange('on'); await h.settle(); document.activeElement = moved ? other : body;
      s.value.configuration = validateApiConfiguration(request.configuration).value; s.value.revision++; release(s.snapshot({ tabId: null })); await h.settle();
      assert.equal(focused, moved ? 0 : 1); if (moved) assert.equal(document.activeElement, other); h.unmount();
    }
  } finally { if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else delete globalThis.document; }
});

test('unmount cancels a pending source observation and late native events cannot write or revive UI', async () => {
  const s = server(); s.value.configuration.enabled = true;
  s.value.intercept = request => request.type === 'ui-protection-reload' ? new Promise(() => {}) : undefined;
  const h = harness('ApiConfigurationEditor', { tabId: 11 }, { api: s.api }); h.render(); await h.settle();
  h.nodes(node => node.type?.name === 'ModeControl' && node.props.entry.id === 'webgl')[0].props.onChange('on'); await h.settle(); assert.equal(s.api.webNavigation.onCommitted.size, 2);
  h.unmount(); await h.settle(); assert.equal(s.api.webNavigation.onCommitted.size, 0); const calls = s.calls.length;
  s.value.documentId = 'document-2'; s.api.webNavigation.onCommitted.emit({ tabId: 11, frameId: 0 }); await h.settle(); assert.equal(s.calls.length, calls);
});

test('an application failure observed in the new source document stays an explicit row error', async () => {
  const s = server(); s.value.configuration.enabled = true;
  s.value.intercept = request => { if (request.type === 'ui-protection-reload') { s.value.documentId = 'document-2'; s.value.registration = 'error'; return { schemaVersion: 1, type: 'protection-state' }; } };
  const h = harness('ApiConfigurationEditor', { tabId: 11 }, { api: s.api }); h.render(); await h.settle();
  h.nodes(node => node.type?.name === 'ModeControl' && node.props.entry.id === 'webgl')[0].props.onChange('on'); await h.settle();
  assert.equal(h.attr('data-api-row-status', 'webgl').props.role, 'alert'); assert.match(h.attr('data-api-mode-status').props.children, /not applied/); assert.equal(h.tree.props['aria-busy'], false); h.unmount();
});

test('mode completion restores only its radio focus, including refusals, without stealing another control focus', async () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  try {
    for (const scenario of ['success', 'refused', 'other-control', 'row-hidden']) {
      const s = server(), body = {}, other = {}, document = { activeElement: null, body }, focused = [], buttons = {};
      const row = { getAttribute: () => 'webgl', getClientRects: () => scenario === 'row-hidden' ? [] : [{}], querySelector: selector => { const mode = /state="([^"]+)"/.exec(selector)[1]; return buttons[mode] ??= { disabled: false, focus(options) { focused.push({ mode, options }); document.activeElement = this; } }; } };
      const origin = { closest: () => row }; document.activeElement = origin; Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
      const h = harness('ApiConfigurationEditor', { tabId: null }, { api: s.api }); h.render(); await h.settle(); h.tree.props.ref.current = { contains: value => value === origin, querySelector: () => row };
      s.value.intercept = request => { if (request.type === 'ui-api-config-set') { document.activeElement = scenario === 'other-control' ? other : body; if (scenario === 'refused') return { schemaVersion: 1, type: 'api-config-error', code: 'stale-revision' }; } };
      h.nodes(node => node.type?.name === 'ModeControl' && node.props.entry.id === 'webgl')[0].props.onChange('on'); await h.settle();
      if (scenario === 'success' || scenario === 'refused') { assert.deepEqual(focused, [{ mode: scenario === 'success' ? 'on' : 'bypass', options: { preventScroll: true } }]); }
      else assert.deepEqual(focused, []); h.unmount();
    }
  } finally { if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else delete globalThis.document; }
});

test('failed native reload reports the saved mode and error without claiming success', async () => {
  const s = server(); s.value.configuration.enabled = true;
  s.value.intercept = request => request.type === 'ui-protection-reload' ? { schemaVersion: 1, type: 'protection-error', code: 'stale-document', message: 'Source document changed' } : undefined;
  const h = harness('ApiConfigurationEditor', { tabId: 11 }, { api: s.api }); h.render(); await h.settle();
  h.nodes(node => node.type?.name === 'ModeControl' && node.props.entry.id === 'webgl')[0].props.onChange('on'); await h.settle();
  assert.equal(s.value.configuration.sites[0].apis.find(row => row.id === 'webgl').mode, 'on'); assert.equal(h.attr('data-api-mode-status').props.role, 'alert');
  assert.equal(h.attr('data-api-mode-status').props.children, 'Unable to save the configuration. Refresh and try again.'); assert.ok(!h.attr('data-api-mode-status').props.children.includes('Source document changed')); assert.equal(h.attr('data-api-row-status', 'webgl').props.role, 'alert'); h.unmount();
});

test('the manual Save and reload also pins the document before persistence', async () => {
  const s = server(); s.value.configuration.enabled = true;
  s.value.intercept = request => { if (request.type === 'ui-api-config-set') s.value.documentId = 'document-2'; };
  const h = harness('ApiConfigurationEditor', { tabId: 11 }, { api: s.api }); h.render(); await h.settle();
  h.attr('data-protection-preset-select').props.onChange({ currentTarget: { value: 'strict' } }); await h.settle();
  h.attr('data-protection-save-reload').props.onClick(); await h.settle(); assert.equal(s.value.configuration.preset, 'strict'); assert.equal(s.calls.filter(call => call.type === 'ui-protection-reload').length, 0); h.unmount();
});

test('all 21 locales expose progress, reload and explicit inherited Custom labels', () => {
  assert.deepEqual(Object.keys(MODE_ACTION_MESSAGES).sort(), PRODUCTION_LANGUAGES.map(language => language.id).sort());
  for (const language of PRODUCTION_LANGUAGES) {
    const table = applyModeActionCopy({}, language.id); assert.deepEqual(Object.keys(table), MODE_ACTION_KEYS);
    for (const key of MODE_ACTION_KEYS) assert.ok(typeof table[key].message === 'string' && table[key].message.trim());
    assert.match(table.protection_api_inherited_custom.message, /Custom/);
  }
});

test('WebGL values are editable only in Custom and every other mode preserves the saved selection and library', async () => {
  const s = server(), value = clone(entry('webgl').presets[1].value), userValues = [{ id: 'custom-1', label: 'Saved WebGL configuration', value }];
  s.value.configuration = updateApiConfiguration(s.value.configuration, 'webgl', { mode: 'custom', selected: value, userValues }).value;
  const h = harness('ApiConfigurationEditor', { tabId: null }, { api: s.api }); h.render(); await h.settle();
  const control = () => h.nodes(node => node.type?.name === 'ModeControl' && node.props.entry.id === 'webgl')[0];
  const editor = () => h.nodes(node => node.type?.name === 'CustomValueEditor' && node.props.entry.id === 'webgl')[0];
  assert.deepEqual(editor().props.entry.selected, value);
  for (const mode of ['bypass', 'on', 'off']) {
    const writes = s.calls.filter(call => call.type === 'ui-api-config-set').length;
    control().props.onChange(mode); await h.settle();
    assert.equal(editor(), undefined, mode + ' must not display an editable Custom value');
    assert.equal(h.attr('data-api-inherited-value', 'webgl'), undefined, 'global modes do not show inherited or stale own values');
    assert.deepEqual(control().props.entry.selected, value); assert.deepEqual(control().props.entry.userValues, userValues);
    assert.equal(s.calls.filter(call => call.type === 'ui-api-config-set').length, writes + 1, 'only the clicked mode is immediately saved');
    const saved = s.value.configuration.apis.find(row => row.id === 'webgl');
    assert.equal(saved.mode, mode); assert.deepEqual(saved.selected, value); assert.deepEqual(saved.userValues, userValues);
    control().props.onChange('custom'); await h.settle();
    assert.deepEqual(editor().props.entry.selected, value); assert.deepEqual(editor().props.entry.userValues, userValues);
  }
  h.unmount();
});

test('site Bypass shows only a read-only inherited global Custom value while retaining its own dormant selection', async () => {
  const s = server(), globalValue = clone(entry('webgl').presets[0].value), ownValue = clone(entry('webgl').presets[1].value), userValues = [{ id: 'custom-1', label: 'Own WebGL configuration', value: ownValue }];
  s.value.configuration = updateApiConfiguration(s.value.configuration, 'webgl', { mode: 'custom', selected: globalValue, userValues }).value;
  s.value.configuration = updateApiConfiguration(s.value.configuration, 'webgl', { mode: 'bypass', selected: ownValue }, 'example.com').value;
  const h = harness('ApiConfigurationEditor', { tabId: 11 }, { api: s.api, locale: 'ru' }); h.render(); await h.settle();
  const editor = () => h.nodes(node => node.type?.name === 'CustomValueEditor' && node.props.entry.id === 'webgl')[0];
  const control = () => h.nodes(node => node.type?.name === 'ModeControl' && node.props.entry.id === 'webgl')[0];
  const inherited = () => h.attr('data-api-inherited-value', 'webgl');
  assert.equal(editor(), undefined); assert.equal(inherited().props.children[0], 'Наследуется Custom из «Все сайты»: ');
  assert.deepEqual(JSON.parse(inherited().props.children[1].props.children), globalValue.value);
  assert.deepEqual(control().props.entry.selected, ownValue);
  control().props.onChange('off'); await h.settle(); assert.equal(editor(), undefined); assert.equal(inherited(), undefined);
  const global = s.value.configuration.apis.find(row => row.id === 'webgl'), site = s.value.configuration.sites[0].apis.find(row => row.id === 'webgl');
  assert.equal(global.mode, 'custom'); assert.deepEqual(global.selected, globalValue); assert.deepEqual(global.userValues, userValues);
  assert.equal(site.mode, 'off'); assert.deepEqual(site.selected, ownValue);
  control().props.onChange('custom'); await h.settle(); assert.deepEqual(editor().props.entry.selected, ownValue); assert.equal(inherited(), undefined);
  control().props.onChange('bypass'); await h.settle(); assert.ok(inherited()); assert.equal(editor(), undefined);
  s.value.configuration.sites[0].disabled = true; s.value.revision++;
  await h.attr('data-api-config-refresh').props.onClick(); await h.settle();
  assert.equal(inherited(), undefined, 'an excluded site does not claim to inherit Custom'); assert.equal(editor(), undefined); h.unmount();
});

test('modal Save validates before calling persistence and Cancel does not call Save', async () => {
  const calls = [], h = harness('ValueModal', { entry: entry('hardware-concurrency'), onSave: async value => calls.push(value), onClose: () => calls.push('closed') }); h.render();
  h.attr('data-api-value-name').props.onInput({ currentTarget: { value: '16 cores' } }); h.attr('data-api-value-input').props.onInput({ currentTarget: { value: '0' } }); await h.settle();
  await h.nodes(node => node.type === 'form')[0].props.onSubmit({ preventDefault }); await h.settle();
  assert.equal(calls.length, 0); assert.ok(h.nodes(node => node.props.role === 'alert').length);
  h.attr('data-api-value-input').props.onInput({ currentTarget: { value: '16' } }); await h.settle();
  await h.nodes(node => node.type === 'form')[0].props.onSubmit({ preventDefault }); await h.settle();
  assert.deepEqual(calls, [{ id: 'custom-1', label: '16 cores', value: { kind: 'value', value: 16 } }, 'closed']);
  h.unmount();
});

test('creating a saved value persists immediately while selecting a preset remains a draft', async () => {
  const calls = [], item = entry('hardware-concurrency'), h = harness('CustomValueEditor', { entry: item, onChange: async (patch, options) => calls.push({ patch, options }) }); h.render();
  h.nodes(node => node.props.class === 'api-value-picker')[0].props.onClick(); await h.settle();
  await h.attr('data-api-value-list', item.id).props.onChange({ currentTarget: { value: 'p:preset-2' } }); await h.settle();
  assert.equal(calls[0].options.persist, false); assert.equal(calls[0].patch.selected.value, 4);
  h.nodes(node => node.props.class === 'api-value-picker')[0].props.onClick(); await h.settle();
  await h.attr('data-api-value-list', item.id).props.onChange({ currentTarget: { value: ':create' } }); await h.settle();
  await h.nodes(node => node.type?.name === 'ValueModal')[0].props.onSave({ id: 'custom-1', label: 'CPU 16', value: { kind: 'value', value: 16 } }); await h.settle();
  assert.equal(calls[1].options.persist, true); assert.equal(calls[1].patch.userValues[0].label, 'CPU 16'); h.unmount();
});

test('a rejected concurrent save retains the draft and never overwrites stored configuration', async () => {
  const s = server(), h = harness('ApiConfigurationEditor', { tabId: null }, { api: s.api }); h.render(); await h.settle();
  h.attr('data-protection-preset-select').props.onChange({ currentTarget: { value: 'strict' } }); await h.settle();
  s.value.revision++; const initial = exportApiConfiguration(s.value.configuration);
  h.attr('data-protection-action', 'save').props.onClick(); await h.settle();
  assert.equal(exportApiConfiguration(s.value.configuration), initial);
  assert.equal(h.attr('data-protection-preset-select').props.value, 'strict');
  assert.ok(h.nodes(node => node.props.role === 'alert').length); h.unmount();
});

test('Save and reload retains a committed value library but never reloads after native registration fails', async () => {
  const s = server(); s.value.configuration.enabled = true;
  s.value.configuration = updateApiConfiguration(s.value.configuration, 'hardware-concurrency', { mode: 'custom', selected: { kind: 'value', value: 2 } }, 'example.com').value;
  const h = harness('ApiConfigurationEditor', { tabId: 11 }, { api: s.api }); h.render(); await h.settle();
  const value = { kind: 'value', value: 16 }, userValues = [{ id: 'custom-1', label: '16 cores', value }];
  const editor = () => h.nodes(node => node.type?.name === 'CustomValueEditor' && node.props.entry.id === 'hardware-concurrency')[0];
  await editor().props.onChange({ mode: 'custom', selected: value, userValues }, { persist: false }); await h.settle();
  s.value.registration = 'error'; s.value.reloadRequired = true;
  h.attr('data-protection-save-reload').props.onClick(); await h.settle();
  assert.equal(s.calls.filter(call => call.type === 'ui-api-config-set').length, 1);
  assert.equal(s.calls.filter(call => call.type === 'ui-protection-reload').length, 0);
  assert.equal(s.value.revision, 6); assert.deepEqual(s.value.configuration.apis.find(row => row.id === 'hardware-concurrency').userValues, userValues);
  assert.deepEqual(editor().props.entry.selected, value); assert.equal(editor().props.entry.mode, 'custom');
  const status = h.attr('data-protection-status'); assert.equal(status.props.role, 'alert');
  assert.match(status.props.children, /Settings saved, but API overrides were not applied/);
  assert.equal(h.attr('data-protection-action', 'save').props.disabled, true);
  assert.equal(h.attr('data-api-config-reload'), undefined); h.unmount();
});

test('loading failed registration shows a localized persistent alert and successful refresh clears it', async () => {
  const s = server(); s.value.configuration.enabled = true; s.value.registration = 'error'; s.value.reloadRequired = true;
  const h = harness('ApiConfigurationEditor', { tabId: null }, { api: s.api, locale: 'ru' }); h.render(); await h.settle();
  assert.equal(h.attr('data-protection-status').props.role, 'alert');
  assert.match(h.attr('data-protection-status').props.children, /Настройки сохранены, но переопределения API не применены/);
  assert.equal(h.attr('data-api-config-reload'), undefined);
  s.value.registration = 'ready'; await h.attr('data-api-config-refresh').props.onClick(); await h.settle();
  assert.equal(h.attr('data-protection-status').props.role, 'status');
  assert.equal(h.attr('data-protection-status').props.children, 'API Guard · ON'); h.unmount();
});

test('Save and reload still reloads the exact document after successful registration', async () => {
  const s = server(); s.value.configuration.enabled = true;
  s.value.configuration = updateApiConfiguration(s.value.configuration, 'hardware-concurrency', { mode: 'custom', selected: { kind: 'value', value: 2 } }, 'example.com').value;
  const h = harness('ApiConfigurationEditor', { tabId: 11 }, { api: s.api }); h.render(); await h.settle();
  await draftCpu(h);
  h.attr('data-protection-save-reload').props.onClick(); await h.settle();
  assert.deepEqual(s.calls.filter(call => call.type === 'ui-protection-reload'), [{ schemaVersion: 1, type: 'ui-protection-reload', tabId: 11, documentId: 'document-1' }]);
  assert.equal(h.attr('data-protection-status').props.role, 'status'); h.unmount();
});

test('storage refresh preserves local edits and explicit Refresh discards them', async () => {
  const s = server(); seedCpu(s); const h = harness('ApiConfigurationEditor', { tabId: null }, { api: s.api }); h.render(); await h.settle();
  await draftCpu(h); s.value.revision++;
  s.api.storage.onChanged.emit({ 'protection:v1': {} }, 'local'); await h.settle();
  assert.equal(cpu(h).props.entry.selected.value, 16); assert.ok(h.nodes(node => node.props.role === 'alert').length);
  await h.attr('data-api-config-refresh').props.onClick(); await h.settle(); assert.equal(cpu(h).props.entry.selected.value, 2); h.unmount();
});

async function editorTransferFixture(dirtyCpu = 16) {
  const s = server();
  s.value.configuration = updateApiConfiguration(s.value.configuration, 'hardware-concurrency', { mode: 'custom', selected: { kind: 'value', value: 4 } }).value;
  s.value.configuration.antidetectEnabled = true;
  const before = clone(s.value.configuration), editor = harness('ApiConfigurationEditor', { tabId: null }, { api: s.api });
  editor.render(); await editor.settle();
  if (dirtyCpu !== null) await draftCpu(editor, dirtyCpu);
  const props = () => editor.nodes(node => node.type?.name === 'ApiConfigurationTransfer')[0].props;
  const transfer = harness('ApiConfigurationTransfer', props(), { api: s.api }); transfer.render(); await transfer.settle();
  async function settle() { await editor.settle(); transfer.update(props()); await transfer.settle(); }
  async function previewImport() {
    const imported = updateApiConfiguration(before, 'hardware-concurrency', { mode: 'custom', selected: { kind: 'value', value: 32 } }).value;
    const json = exportApiConfiguration(imported);
    await transfer.attr('data-api-config-file').props.onChange({ currentTarget: { files: [{ size: Buffer.byteLength(json), text: async () => json }], value: 'owned-import.json' } });
    await settle();
  }
  const writes = () => s.calls.filter(call => call.type === 'ui-api-config-set');
  return { s, before, editor, transfer, settle, previewImport, writes, close() { transfer.unmount(); editor.unmount(); } };
}

for (const dirtyCpu of [null, 16]) test('import Undo restores the persisted Editor baseline with ' + (dirtyCpu === null ? 'a clean editor' : 'an unsaved Custom value'), async () => {
  const f = await editorTransferFixture(dirtyCpu);
  try {
    assert.equal(f.s.value.configuration.apis.find(row => row.id === 'hardware-concurrency').selected.value, 4);
    assert.equal(f.writes().length, 0);
    await f.previewImport(); assert.equal(f.writes().length, 0);
    await f.transfer.attr('data-api-config-apply', 'import').props.onClick(); await f.settle();
    assert.equal(f.s.value.configuration.apis.find(row => row.id === 'hardware-concurrency').selected.value, 32);
    assert.equal(f.s.value.revision, 6);
    await f.transfer.attr('data-api-config-undo').props.onClick(); await f.settle();
    assert.deepEqual(f.s.value.configuration, f.before);
    assert.deepEqual(f.writes().map(call => [call.expectedRevision, call.configuration.apis.find(row => row.id === 'hardware-concurrency').selected.value]), [[5, 32], [6, 4]]);
    assert.equal(f.transfer.attr('data-api-config-undo'), undefined);
  } finally { f.close(); }
});

test('Undo cannot overwrite an intervening revision even through a retained handler', async () => {
  const f = await editorTransferFixture();
  try {
    await f.previewImport(); await f.transfer.attr('data-api-config-apply', 'import').props.onClick(); await f.settle();
    const retainedUndo = f.transfer.attr('data-api-config-undo').props.onClick;
    f.s.value.configuration = updateApiConfiguration(f.s.value.configuration, 'hardware-concurrency', { mode: 'custom', selected: { kind: 'value', value: 64 } }).value;
    ++f.s.value.revision; f.s.api.storage.onChanged.emit({ 'api-configuration:v1': {} }, 'local'); await f.settle();
    const newer = clone(f.s.value.configuration);
    assert.equal(f.transfer.attr('data-api-config-undo').props.disabled, true);
    await retainedUndo(); await f.settle();
    assert.deepEqual(f.s.value.configuration, newer); assert.equal(f.s.value.revision, 7);
    assert.equal(f.writes().length, 2, 'one import and one rejected explicit Undo, without automatic mutation retry');
    assert.equal(f.writes()[1].expectedRevision, 6);
    assert.equal(f.writes()[1].configuration.apis.find(row => row.id === 'hardware-concurrency').selected.value, 4);
  } finally { f.close(); }
});

test('cancelling an import preserves an unsaved Editor preview and never applies either configuration', async () => {
  const f = await editorTransferFixture();
  try {
    await f.previewImport();
    f.transfer.nodes(node => node.type?.name === 'Modal')[0].props.onClose(); await f.settle();
    assert.deepEqual(f.s.value.configuration, f.before); assert.equal(f.s.value.revision, 5);
    assert.equal(cpu(f.editor).props.entry.selected.value, 16);
    assert.equal(f.writes().length, 0); assert.equal(f.transfer.attr('data-api-config-undo'), undefined);
  } finally { f.close(); }
});

test('import preview still compares the editable policy draft while Undo restores the saved policy', async () => {
  const saved = createApiConfiguration(), draft = { ...clone(saved), webrtcNetworkPolicy: 'default_public_interface_only' }, calls = [];
  const h = harness('ApiConfigurationTransfer', { configuration: draft, savedConfiguration: saved, revision: 5, onCommit: async (configuration, revision) => { calls.push({ configuration, revision }); return { revision: revision + 1 }; } });
  h.render(); await h.settle();
  try {
    const json = exportApiConfiguration(draft);
    await h.attr('data-api-config-file').props.onChange({ currentTarget: { files: [{ size: Buffer.byteLength(json), text: async () => json }], value: 'owned.json' } }); await h.settle();
    assert.equal(h.attr('data-webrtc-policy-import-change'), undefined, 'the import and visible policy draft are the same');
    await h.attr('data-api-config-apply', 'import').props.onClick(); await h.settle();
    h.update({ configuration: draft, savedConfiguration: draft, revision: 6 }); await h.settle();
    await h.attr('data-api-config-undo').props.onClick(); await h.settle();
    assert.equal(calls[0].configuration.webrtcNetworkPolicy, 'default_public_interface_only');
    assert.equal(calls[1].configuration.webrtcNetworkPolicy, 'system'); assert.equal(calls[1].revision, 6);
  } finally { h.unmount(); }
});

test('a failed Undo preserves its saved target for an explicit retry without applying the old dirty preview', async () => {
  const f = await editorTransferFixture();
  try {
    await f.previewImport(); await f.transfer.attr('data-api-config-apply', 'import').props.onClick(); await f.settle();
    let failUndo = true;
    f.s.value.intercept = request => request.type === 'ui-api-config-set' && failUndo ? { schemaVersion: 1, type: 'api-config-error', code: 'storage-error' } : undefined;
    await f.transfer.attr('data-api-config-undo').props.onClick(); await f.settle();
    assert.equal(f.s.value.revision, 6); assert.equal(f.s.value.configuration.apis.find(row => row.id === 'hardware-concurrency').selected.value, 32);
    assert.equal(f.writes().length, 2); assert.ok(f.transfer.attr('data-api-config-undo'));
    failUndo = false;
    await f.transfer.attr('data-api-config-undo').props.onClick(); await f.settle();
    assert.deepEqual(f.s.value.configuration, f.before);
    assert.deepEqual(f.writes().map(call => [call.expectedRevision, call.configuration.apis.find(row => row.id === 'hardware-concurrency').selected.value]), [[5, 32], [6, 4], [6, 4]]);
    assert.equal(f.s.value.revision, 7);
  } finally { f.close(); }
});

test('import validation and Cancel perform no writes; Apply and Undo use exact revisions', async () => {
  const before = createApiConfiguration(), after = updateApiConfiguration(before, 'hardware-concurrency', { mode: 'custom', selected: { kind: 'value', value: 16 } }).value, calls = [];
  const h = harness('ApiConfigurationTransfer', { configuration: before, revision: 5, onCommit: async (configuration, revision) => { calls.push({ configuration, revision }); return { revision: revision + 1 }; } }); h.render();
  const file = text => ({ currentTarget: { files: [{ size: text.length, text: async () => text }], value: 'file' } });
  await h.attr('data-api-config-file').props.onChange(file('{')); await h.settle(); assert.equal(calls.length, 0); assert.ok(h.nodes(node => node.props.role === 'alert').length);
  await h.attr('data-api-config-file').props.onChange(file(exportApiConfiguration(after))); await h.settle(); assert.equal(calls.length, 0);
  h.nodes(node => node.type?.name === 'Modal')[0].props.onClose(); await h.settle(); assert.equal(calls.length, 0);
  await h.attr('data-api-config-file').props.onChange(file(exportApiConfiguration(after))); await h.settle();
  await h.attr('data-api-config-apply', 'import').props.onClick(); await h.settle(); assert.equal(calls.length, 1); assert.equal(calls[0].revision, 5);
  h.update({ configuration: after, revision: 6 }); await h.settle(); await h.attr('data-api-config-undo').props.onClick(); await h.settle();
  assert.equal(calls.length, 2); assert.equal(calls[1].revision, 6); assert.equal(sameApiValue(calls[1].configuration, before), true); h.unmount();
});

test('an import preview cannot apply over a newer revision and export downloads only confirmed preview bytes', async () => {
  const configuration = createApiConfiguration(), json = exportApiConfiguration(configuration), calls = [], downloads = [];
  const h = harness('ApiConfigurationTransfer', { configuration, revision: 5, onCommit: async (...args) => calls.push(args) }, { downloadFile: value => downloads.push(value) }); h.render();
  await h.attr('data-api-config-file').props.onChange({ currentTarget: { files: [{ size: json.length, text: async () => json }], value: '' } }); await h.settle(); h.update({ revision: 6 }); await h.settle();
  assert.equal(h.attr('data-api-config-apply', 'import').props.disabled, true); assert.equal(calls.length, 0);
  h.nodes(node => node.type?.name === 'Modal')[0].props.onClose(); await h.settle(); h.attr('data-api-config-export').props.onClick(); await h.settle(); assert.equal(downloads.length, 0);
  h.attr('data-api-config-apply', 'export').props.onClick(); await h.settle(); assert.equal(downloads[0].text, json); assert.equal(downloads[0].mime, 'application/json'); h.unmount();
});

test('site editing shares the value library and leaves global selections unchanged', async () => {
  const s = server(), h = harness('ApiConfigurationEditor', { tabId: 11 }, { api: s.api }); h.render(); await h.settle();
  h.nodes(node => node.type?.name === 'ModeControl' && node.props.entry.id === 'hardware-concurrency')[0].props.onChange('custom'); await h.settle();
  const editor = h.nodes(node => node.type?.name === 'CustomValueEditor' && node.props.entry.id === 'hardware-concurrency')[0];
  await editor.props.onChange({ mode: 'custom', selected: { kind: 'value', value: 16 }, userValues: [{ id: 'custom-1', label: '16 cores', value: { kind: 'value', value: 16 } }] }, { persist: true }); await h.settle();
  const global = s.value.configuration.apis.find(item => item.id === 'hardware-concurrency'), site = s.value.configuration.sites.find(item => item.host === 'example.com');
  assert.equal(global.mode, 'bypass'); assert.deepEqual(global.selected, { kind: 'unset' }); assert.equal(global.userValues.length, 1); assert.equal(site.apis.find(item => item.id === 'hardware-concurrency').selected.value, 16); h.unmount();
});

test('the six existing category filters remain view-only and use roving keyboard selection', async () => {
  const s = server(), h = harness('ApiConfigurationEditor', { tabId: null }, { api: s.api }); h.render(); await h.settle();
  const filters = h.nodes(node => node.type?.name === 'CategoryFilters')[0];
  assert.equal(filters.props.counts.all, API_CONFIG_CATALOG.length);
  assert.equal(Object.keys(filters.props.counts).length, 6);
  filters.props.onChange('hardware'); await h.settle();
  assert.ok(h.nodes(node => node.props['data-protection-feature']).length < API_CONFIG_CATALOG.length);
  assert.equal(s.calls.some(call => call.type === 'ui-api-config-set'), false);
  const changes = [], chips = harness('CategoryFilters', { value: 'all', counts: {}, onChange: value => changes.push(value) }); chips.render();
  assert.deepEqual(chips.nodes(node => node.props['data-protection-filter']).map(node => node.props['data-protection-filter']), ['all', 'hardware', 'os', 'network', 'browser', 'social']);
  chips.tree.props.onKeyDown({ key: 'ArrowRight', preventDefault }); assert.deepEqual(changes, ['hardware']);
  chips.unmount(); h.unmount();
});

test('a superseded slow file cannot replace the newer import preview', async () => {
  const configuration = createApiConfiguration(), first = updateApiConfiguration(configuration, 'hardware-concurrency', { mode: 'custom', selected: { kind: 'value', value: 16 } }).value,
    second = updateApiConfiguration(configuration, 'hardware-concurrency', { mode: 'custom', selected: { kind: 'value', value: 32 } }).value;
  const h = harness('ApiConfigurationTransfer', { configuration, revision: 5, onCommit() {} }); h.render(); let release;
  const slow = h.attr('data-api-config-file').props.onChange({ currentTarget: { files: [{ size: 100, text: () => new Promise(resolve => { release = resolve; }) }], value: '' } });
  const json = exportApiConfiguration(second); await h.attr('data-api-config-file').props.onChange({ currentTarget: { files: [{ size: json.length, text: async () => json }], value: '' } }); await h.settle();
  release(exportApiConfiguration(first)); await slow; await h.settle();
  const preview = h.nodes(node => node.props.class === 'api-config-json')[0];
  assert.equal(JSON.parse(preview.props.children).apis.find(item => item.id === 'hardware-concurrency').selected.value, 32); h.unmount();
});

test('external updates while a value modal is open retain the modal base revision', async () => {
  const s = server(); seedCpu(s); const h = harness('ApiConfigurationEditor', { tabId: null }, { api: s.api }); h.render(); await h.settle();
  const editor = () => h.nodes(node => node.type?.name === 'CustomValueEditor' && node.props.entry.id === 'hardware-concurrency')[0];
  editor().props.onEditingChange(true); s.value.revision++;
  s.api.storage.onChanged.emit({ 'protection:v1': {} }, 'local'); await h.settle();
  await assert.rejects(editor().props.onChange({ mode: 'custom', selected: { kind: 'value', value: 16 }, userValues: [{ id: 'custom-1', label: '16 cores', value: { kind: 'value', value: 16 } }] }, { persist: true }), /another window/);
  assert.equal(s.calls.at(-1).expectedRevision, 5); assert.equal(s.value.configuration.apis.find(item => item.id === 'hardware-concurrency').userValues.length, 0); h.unmount();
});

test('timezone On is unavailable and keyboard navigation starts with Bypass', () => {
  const changes = [], h = harness('ModeControl', { entry: entry('timezone'), disabled: false, onChange: value => changes.push(value) }); h.render();
  assert.equal(h.attr('data-protection-state', 'on').props.disabled, true);
  assert.equal(h.attr('data-protection-state', 'custom').props.disabled, false);
  h.tree.props.onKeyDown({ key: 'Home', preventDefault }); assert.deepEqual(changes, ['bypass']); h.unmount();
});

test('catalog7 Custom-only controls reject unavailable ON navigation and every preset remains editable as JSON', () => {
  for (const id of API_CUSTOM_ONLY_IDS) {
    const changes = [], h = harness('ModeControl', { entry: entry(id), disabled: false, onChange: value => changes.push(value) });h.render();
    try {
      assert.equal(h.attr('data-protection-state', 'on').props.disabled, true, id);
      assert.equal(h.attr('data-protection-state', 'custom').props.disabled, false, id);
      h.tree.props.onKeyDown({ key: 'Home', preventDefault });assert.deepEqual(changes, ['bypass'], id);
      for (const preset of entry(id).presets) {
        const parsed = parseApiValueInput(entry(id), 'value', JSON.stringify(preset.value.value));
        assert.equal(parsed.ok, true, id);assert.deepEqual(parsed.value, preset.value);
      }
    } finally { h.unmount(); }
  }
});

test('all fifteen bundle value editors use the localized JSON-object hint in all21 locales', () => {
  for (const language of PRODUCTION_LANGUAGES) for (const id of FINGERPRINT_CUSTOM_LOCALE_IDS) {
    const messages = ANTIDETECT_EDITOR_MESSAGES[language.id], item = entry(id);
    const h = harness('ValueModal', { entry: item, onSave: async () => {}, onClose() {} }, {
      locale: language.id, translate: key => messages[key] ?? key,
    });
    try {
      h.render();assert.ok(h.attr('data-api-value-input'), id);
      const expected = messages.antidetect_editor_hints_object + ' · ' + item.valueHint;
      assert.ok(h.nodes(node => node.type === 'small' && node.props.children === expected).length, language.id + '/' + id);
    } finally { h.unmount(); }
  }
});

test('Firefox Custom setup requests optional userScripts only after a trusted action and refreshes after a grant', async () => {
  const requests = [], refreshes = [], api = { permissions: { request: async request => { requests.push(request); return true; } } };
  const h = harness('EarlyAccessNotice', { access: 'permission-required', onRefresh: async () => refreshes.push(true) }, { api }); h.render();
  assert.equal(requests.length, 0); assert.ok(h.attr('data-api-early-grant'));
  await h.attr('data-api-early-grant').props.onClick(); await h.settle();
  assert.deepEqual(requests, [{ permissions: ['userScripts'] }]); assert.equal(refreshes.length, 1); h.unmount();
});

test('a denied Custom permission leaves configuration untouched and shows a useful error', async () => {
  let refreshes = 0;
  const h = harness('EarlyAccessNotice', { access: 'permission-required', onRefresh: () => { refreshes++; } }, { api: { permissions: { request: async () => false } } }); h.render();
  await h.attr('data-api-early-grant').props.onClick(); await h.settle();
  assert.equal(refreshes, 0); assert.ok(h.nodes(node => node.props.role === 'alert').length); h.unmount();
});

test('Chrome Custom setup opens extension details and leaves restarting the browser to the user', async () => {
  const opened = []; let reloads = 0;
  const api = { runtime: { id: 'fixture', reload: () => { reloads++; } }, tabs: { create: async options => opened.push(options) } }, h = harness('EarlyAccessNotice', { access: 'browser-toggle-required', onRefresh() {} }, { api }); h.render();
  assert.equal(opened.length, 0); assert.equal(reloads, 0);
  await h.attr('data-api-early-settings').props.onClick(); await h.settle();
  assert.deepEqual(opened, [{ url: 'chrome://extensions/?id=fixture' }]); assert.equal(reloads, 0);
  assert.equal(h.attr('data-api-early-reload'), undefined); assert.equal(reloads, 0); h.unmount();
});

test('Custom controls remain disabled until the browser grants early access', async () => {
  const s = server(); s.value.earlyAccess = 'permission-required';
  s.value.configuration = updateApiConfiguration(s.value.configuration, 'hardware-concurrency', { mode: 'custom', selected: { kind: 'value', value: 16 } }).value;
  const h = harness('ApiConfigurationEditor', { tabId: null }, { api: s.api }); h.render(); await h.settle();
  const control = () => h.nodes(node => node.type?.name === 'ModeControl' && node.props.entry.id === 'hardware-concurrency')[0];
  assert.equal(control().props.earlyAccess, 'permission-required');
  assert.equal(h.nodes(node => node.type?.name === 'CustomValueEditor' && node.props.entry.id === 'hardware-concurrency')[0].props.disabled, true);
  const selected = [], modes = harness('ModeControl', { entry: entry('hardware-concurrency'), earlyAccess: 'permission-required', disabled: false, onChange: value => selected.push(value) }); modes.render();
  assert.equal(modes.attr('data-protection-state', 'custom').props.disabled, true); modes.tree.props.onKeyDown({ key: 'End', preventDefault }); assert.deepEqual(selected, ['on'], 'ADR-103 order: as in preset, allow, block, custom');
  modes.unmount(); h.unmount();
});

const nodesWithin = (root, predicate) => { const found = []; const visit = node => { if (Array.isArray(node)) { node.forEach(visit); return; } if (!node?.props) return; if (predicate(node)) found.push(node); visit(node.props.children); }; visit(root); return found; };

test('ADR-103 API Guard list labels cover all 21 production languages with complete local rows', () => {
  assert.deepEqual([...API_GUARD_LANGUAGES].sort(), PRODUCTION_LANGUAGES.map(language => language.id).sort());
  for (const [language, length] of Object.entries(apiGuardRowLengths())) assert.equal(length, API_GUARD_LABEL_KEYS.length, language);
  const english = apiGuardLabels('en');
  for (const { id } of PRODUCTION_LANGUAGES) {
    const labels = apiGuardLabels(id);
    for (const key of API_GUARD_LABEL_KEYS) assert.ok(typeof labels[key] === 'string' && labels[key].trim(), id + ': ' + key);
    if (id !== 'en') assert.ok(API_GUARD_LABEL_KEYS.every(key => labels[key] !== english[key]), id + ' is translated');
  }
  assert.equal(apiGuardLabels('zh-CN').collapse, apiGuardLabels('zh_CN').collapse); assert.equal(apiGuardLabels('xx').collapse, english.collapse);
});

test('one toolbar groups transfer, scope, preset, search, group picker and filters without new writes', async () => {
  const s = server(), h = harness('ApiConfigurationEditor', { tabId: 11 }, { api: s.api, locale: 'ru' }); h.render(); await h.settle();
  const toolbar = h.attr('data-api-config-toolbar'), inside = predicate => nodesWithin(toolbar, predicate);
  assert.equal(toolbar.props.role, 'group'); assert.equal(toolbar.props['aria-label'], apiGuardLabels('ru').toolbar);
  assert.ok(h.tree.props.children.includes(toolbar));
  for (const name of ['data-protection-search', 'data-protection-preset-select', 'data-api-group-picker', 'data-api-groups-collapse']) assert.equal(inside(node => node.props[name] !== undefined).length, 1, name);
  assert.equal(inside(node => node.props['data-protection-scope']).length, 2);
  for (const component of ['ApiConfigurationTransfer', 'CategoryFilters', 'ModeFilters']) assert.equal(inside(node => node.type?.name === component).length, 1, component);
  assert.equal(inside(node => node.props.class === 'blocking-checkbox api-config-toggle').length, 2, 'configured and Custom-supported toggles'); assert.equal(inside(node => node.type === 'input' && node.props.type === 'checkbox').length, 3, 'plus the exact-site off switch');
  assert.equal(h.nodes(node => node.props['data-protection-filter-live']).length, 1);
  assert.equal(s.calls.filter(call => call.type === 'ui-api-config-set').length, 0); h.unmount();
});

test('each row shows an effective state pill from existing global, site and master data only', async () => {
  const s = modeFilterServer(), h = harness('ApiConfigurationEditor', { tabId: null }, { api: s.api, locale: 'ru' }); h.render(); await h.settle();
  const pill = (harnessed, id) => nodesWithin(harnessed.attr('data-protection-feature', id), node => node.props['data-api-effective-state'])[0];
  const labels = apiGuardLabels('ru');
  assert.equal(pill(h, 'hardware-concurrency').props['data-api-effective-state'], 'custom'); assert.equal(pill(h, 'hardware-concurrency').props['data-api-effective-dormant'], 'true');
  assert.equal(pill(h, 'canvas-readback').props['data-api-effective-state'], 'blocked'); assert.equal(pill(h, 'canvas-readback').props.children[1].props.children, labels.stateBlocked);
  assert.equal(pill(h, 'webgl').props['data-api-effective-state'], 'allowed'); assert.equal(pill(h, 'webgl').props['data-api-effective-dormant'], undefined);
  assert.equal(pill(h, 'navigator-language').props['data-api-effective-state'], 'inherit');
  h.unmount();
  s.value.configuration.enabled = true;
  s.value.configuration = updateApiConfiguration(s.value.configuration, 'webgl', { mode: 'on' }, 'example.com').value;
  const site = harness('ApiConfigurationEditor', { tabId: 11 }, { api: s.api }); site.render(); await site.settle();
  assert.equal(pill(site, 'canvas-readback').props['data-api-effective-state'], 'blocked'); assert.equal(pill(site, 'canvas-readback').props['data-api-effective-inherited'], 'true'); assert.equal(pill(site, 'canvas-readback').props['data-api-effective-dormant'], undefined);
  assert.equal(pill(site, 'webgl').props['data-api-effective-state'], 'blocked'); assert.equal(pill(site, 'webgl').props['data-api-effective-inherited'], undefined);
  site.nodes(node => node.type === 'input' && node.props.type === 'checkbox')[0].props.onChange({ currentTarget: { checked: true } }); await site.settle();
  assert.equal(pill(site, 'canvas-readback').props['data-api-effective-state'], 'allowed'); assert.equal(pill(site, 'canvas-readback').props['data-api-effective-dormant'], 'true');
  assert.equal(s.calls.filter(call => call.type === 'ui-api-config-set').length, 0); site.unmount();
});

test('group sections collapse and expand as view-only state; search reveals collapsed matches', async () => {
  const s = server(), h = harness('ApiConfigurationEditor', { tabId: null }, { api: s.api }); h.render(); await h.settle();
  const toggle = value => h.attr('data-api-group-toggle', value), body = value => h.attr('data-protection-group', value).props.children[1];
  assert.equal(toggle('graphics').props['aria-expanded'], true); assert.equal(toggle('graphics').props['aria-controls'], body('graphics').props.id); assert.equal(body('graphics').props.hidden, false);
  toggle('graphics').props.onClick(); await h.settle();
  assert.equal(toggle('graphics').props['aria-expanded'], false); assert.equal(body('graphics').props.hidden, true); assert.equal(body('graphics').props.inert, true);
  assert.equal(body('device').props.hidden, false);
  assert.equal(h.attr('data-api-groups-collapse', 'collapse').props.children, apiGuardLabels('en').collapseAll);
  h.attr('data-api-groups-collapse', 'collapse').props.onClick(); await h.settle();
  const groups = h.nodes(node => node.props['data-api-group-toggle']).map(node => node.props['data-api-group-toggle']);
  assert.ok(groups.length > 5); for (const value of groups) assert.equal(body(value).props.hidden, true, value);
  assert.equal(h.attr('data-api-wasm-toggle').props.disabled, false, 'WebAssembly keeps its own namespace folding');
  assert.equal(h.attr('data-api-groups-collapse', 'expand').props.children, apiGuardLabels('en').expandAll);
  h.attr('data-protection-search').props.onInput({ currentTarget: { value: 'webgl' } }); await h.settle();
  assert.equal(body('graphics').props.hidden, false, 'a search reveals matches');
  h.attr('data-protection-search').props.onInput({ currentTarget: { value: '' } }); await h.settle();
  toggle('graphics').props.onClick(); await h.settle(); assert.equal(body('graphics').props.hidden, true);
  h.attr('data-api-groups-collapse', 'collapse').props.onClick(); await h.settle(); h.attr('data-api-groups-collapse', 'expand').props.onClick(); await h.settle();
  for (const value of groups) assert.equal(body(value).props.hidden, false, value);
  assert.equal(h.nodes(node => node.props['data-protection-feature']).length, API_CONFIG_CATALOG.length);
  assert.equal(s.calls.filter(call => call.type === 'ui-api-config-set').length, 0); h.unmount();
});
