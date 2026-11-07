// ADR-064: explicit local drafts, migration-safe writes and truthful effective-state UI.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createAntidetectUi, ANTIDETECT_CATEGORIES, ANTIDETECT_OVERVIEW_CATEGORIES, ANTIDETECT_OVERVIEW_MODES, antidetectApiCounts } from '../../apps/production-extension/antidetect-ui.js';
import { ANTIDETECT_EDITOR_LABEL_KEYS, ANTIDETECT_EDITOR_LABEL_LANGUAGES, antidetectEditorLabels, antidetectEditorLabelRowLengths } from '../../apps/production-extension/antidetect-editor-labels.js';
import { redesignLabels } from '../../apps/production-extension/redesign-labels.js';
import { provideTourButton } from '../../apps/production-extension/ui-tour-slot.js';
import { fingerprintDeviceLabels } from '../../apps/production-extension/fingerprint-device-labels.js';
import { createApiConfiguration, updateApiConfiguration, validateApiConfiguration, API_CONFIG_CATALOG } from '../../apps/production-extension/api-configuration.js';
import { applyAntidetectCopy, ANTIDETECT_UI_KEYS, ANTIDETECT_EDITOR_KEYS, ANTIDETECT_EDITOR_FIELDS } from '../production-locales-antidetect.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';
import { FINGERPRINT_CUSTOM_LOCALE_IDS, FINGERPRINT_CUSTOM_LOCALE_KEYS } from '../production-locales-fingerprint-custom.mjs';

const clone = value => JSON.parse(JSON.stringify(value));
const turn = () => new Promise(resolve => setImmediate(resolve));
function event() { const listeners = new Set(); return { addListener: callback => listeners.add(callback), removeListener: callback => listeners.delete(callback), emit: (...args) => { for (const callback of listeners) callback(...args); }, get size() { return listeners.size; } }; }
function messages(locale) {
  const language = PRODUCTION_LANGUAGES.find(value => value.id === locale);
  return applyAntidetectCopy(JSON.parse(readFileSync(new URL('../../apps/production-extension/' + (language.uiOnly ? 'ui-locales' : '_locales') + '/' + locale + '/messages.json', import.meta.url), 'utf8')), locale);
}
function server() {
  const calls = [], permissions = [], value = { configuration: createApiConfiguration(), revision: 5, earlyAccess: 'ready', privacy: false, rules: [] };
  const snapshot = () => ({ schemaVersion: 1, type: 'api-config-state', configuration: clone(value.configuration), revision: value.revision, host: null, documentId: null,
    registration: value.registration ?? (value.configuration.enabled || value.configuration.antidetectEnabled ? 'ready' : 'inactive'), reloadRequired: value.reloadRequired ?? false, earlyAccess: value.earlyAccess,
    webrtcNetwork: clone(value.webrtcNetwork ?? { desired: value.configuration.webrtcNetworkPolicy, status: value.privacy ? value.configuration.webrtcNetworkPolicy === 'system' ? 'inactive' : 'applied' : 'permission-required', value: value.privacy ? value.configuration.webrtcNetworkPolicy === 'system' ? 'default' : value.configuration.webrtcNetworkPolicy : null, levelOfControl: value.privacy ? 'controlled_by_this_extension' : null }) });
  const api = { runtime: { id: 'antidetect-fixture', getURL: path => 'chrome-extension://antidetect-fixture/' + path, sendMessage: async request => {
    calls.push(clone(request)); const intercepted = value.intercept?.(request); if (intercepted !== undefined) return intercepted;
    if (request.type === 'ui-api-config-set') {
      if (request.expectedRevision !== value.revision) return { schemaVersion: 1, type: 'api-config-error', code: 'stale-revision' };
      const checked = validateApiConfiguration(request.configuration); assert.equal(checked.ok, true); value.configuration = checked.value; ++value.revision;
    }
    return snapshot();
  } }, storage: { onChanged: event() }, permissions: { onRemoved: event(), request: request => { permissions.push(clone(request)); value.privacy ||= request.permissions.includes('privacy'); value.earlyAccess = request.permissions.includes('userScripts') ? 'ready' : value.earlyAccess; return Promise.resolve(value.grant !== false); } },
  tabs: { create: async details => { calls.push({ type: 'tabs-create', ...details }); return { id: 99 }; } }, declarativeNetRequest: { getDynamicRules: async () => clone(value.rules) } };
  return { api, value, calls, permissions, snapshot, writes: () => calls.filter(call => call.type === 'ui-api-config-set') };
}
function harness({ server: s = server(), locale = 'en', props: initialProps = {}, describeHeaders } = {}) {
  const previous = Object.fromEntries(['window', 'location'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const ownWindow = {}; ownWindow.top = ownWindow;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: ownWindow });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: 'chrome-extension://antidetect-fixture/options.html#antidetect' } });
  const slots = [], effects = [], table = messages(locale); let cursor = 0, changed = true, tree, props = { active: true, ...initialProps };
  const hooks = {
    useState(initial) { const slot = slots[cursor++] ??= { value: initial }; return [slot.value, next => { const value = typeof next === 'function' ? next(slot.value) : next; if (!Object.is(value, slot.value)) { slot.value = value; changed = true; } }]; },
    useRef(initial) { return (slots[cursor++] ??= { ref: { current: initial } }).ref; },
    useEffect(callback, dependencies) { const slot = slots[cursor++] ??= {}; if (!slot.dependencies || dependencies?.some((value, index) => !Object.is(value, slot.dependencies[index]))) { slot.dependencies = dependencies; effects.push(() => { slot.cleanup?.(); slot.cleanup = callback(); }); } },
  };
  function ApiConfigurationEditor() { return null; }
  const ui = createAntidetectUi({ ...hooks, h: (type, props) => ({ type, props }), useLocale: () => locale, translate: key => table[key]?.message ?? key, browserApi: s.api, ApiConfigurationEditor, ...(describeHeaders ? { describeHeaders } : {}) });
  function render() { cursor = 0; changed = false; tree = ui.AntidetectApp(props); while (effects.length) effects.shift()(); return tree; }
  async function settle() { for (let index = 0; index < 10; index++) { if (changed) render(); await turn(); } if (changed) render(); return tree; }
  function nodes(predicate) { const result = []; function visit(node) { if (Array.isArray(node)) { node.forEach(visit); return; } if (!node?.props) return; if (predicate(node)) result.push(node); visit(node.props.children); } visit(tree); return result; }
  const attr = (key, value = true) => nodes(node => node.props[key] === value)[0];
  return { s, render, settle, nodes, attr, table, get tree() { return tree; }, setLocale(next) { locale = next; Object.assign(table, messages(next)); changed = true; render(); }, update(next) { props = { ...props, ...next }; changed = true; render(); }, unmount() { for (const slot of slots) slot?.cleanup?.(); for (const [key, descriptor] of Object.entries(previous)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } } };
}
const input = (h, key, value, attribute = 'data-antidetect-address') => h.attr(attribute, key).props.onInput({ currentTarget: { value } });
const select = (h, key, value) => h.attr(key).props.onChange({ currentTarget: { value } });
const click = (h, value, attribute = 'data-antidetect-mode') => h.attr(attribute, value).props.onClick();
const currentRtc = s => s.value.configuration.apis.find(row => row.id === 'webrtc');
const dualProfile = () => ({ addresses: { ipv4: { host: '192.0.2.10', stun: '198.51.100.20', turn: '203.0.113.30' }, ipv6: { host: '2001:db8::10', stun: '2001:db8::20', turn: '2001:db8::30' } }, iceTransportPolicy: 'preserve', randomizeDevices: false, freshCertificates: true, deviceLifetime: 'session' });
function seedRtc(s, mode = 'custom') { const value = { kind: 'value', value: dualProfile() }; s.value.configuration = updateApiConfiguration(s.value.configuration, 'webrtc', { mode, selected: value, userValues: [{ id: 'owned-profile', label: 'Existing profile', value }] }).value; }

// ADR-104: the two header panels (native session, page observation) were removed; the network
// draft must survive a switch to the embedded editor and the embedded editor hides its own filter.
test('switching between the network draft and the embedded editor preserves the Antidetect draft and never enables API modes', async () => {
  const s = server(); seedRtc(s); const h = harness({ server: s });
  try {
    h.render(); await h.settle(); input(h, 'ipv4:host', '192.0.2.99'); await h.settle();
    assert.deepEqual(h.nodes(node => node.props['data-antidetect-protocol']).map(node => node.props['data-antidetect-protocol']), ['webtransport', 'websocket']);
    assert.equal(h.nodes(node => node.type?.name === 'UsageContext').length, 0, 'the page-observation panel is gone');
    assert.equal(h.nodes(node => node.type?.name === 'FingerprintEnginePanel').length, 0, 'the native-session panel is gone');
    click(h, 'device', 'data-antidetect-category'); await h.settle();
    const embedded = h.nodes(node => node.type?.name === 'ApiConfigurationEditor')[0]; assert.equal(embedded.props.presentation, 'antidetect'); assert.equal(embedded.props.fixedCategory, 'hardware'); assert.equal(embedded.props.hideUsageContext, true);
    click(h, 'network', 'data-antidetect-category'); await h.settle();
    assert.equal(h.attr('data-antidetect-address', 'ipv4:host').props.value, '192.0.2.99');
    assert.equal(h.attr('data-antidetect-dirty').props['data-antidetect-dirty'], true); assert.equal(s.writes().length, 0); assert.equal(s.permissions.length, 0);
    assert.equal(s.calls.filter(call => call.type === 'ui-api-config-get').length, 1);
  } finally { h.unmount(); }
});

test('management header owns one immediate master while categories and Refresh retain their existing actions', async () => {
  const h = harness();
  provideTourButton(function TourButton() { return null; }); // the shell's button (ui-tour-slot.js); the header only reads it
  try {
    h.render(); await h.settle();
    const header = h.attr('data-workspace-master', 'antidetect');
    const master = h.nodes(node => node.props.class === 'antidetect-master');
    assert.equal(master.length, 1);
    assert.equal(master[0].props.children, h.attr('data-antidetect-master'), 'ON/OFF is the only repeated master content');
    assert.equal(h.attr('data-antidetect-master').props['aria-label'], h.table.antidetect_master.message);
    assert.equal(h.tree.props.children[0], header, 'the master is the first module row');
    assert.equal(header.props.children[0].props.children.type, 'h2');
    // ADR-111: no strip under the header. Refresh (icon-only), the shared Tour button (ui-tour.js) and the switch are one cluster at the end of the header row.
    const cluster = header.props.children[1], tools = cluster.props.children;
    assert.match(cluster.props.class, /workspace-master__control workspace-tools/u); assert.equal(tools.at(-1), master[0], 'the module switch ends the cluster');
    assert.equal(tools[0], h.attr('data-antidetect-refresh'), 'Refresh is a compact tool of the same row, before the Tour button');
    assert.deepEqual(tools.slice(1, -1).map(node => [node.type?.name, node.props.tour]), [['TourButton', 'antidetect']], 'the shared Tour button sits between Refresh and the switch');
    assert.equal(h.attr('data-antidetect-refresh').props['aria-label'], h.table.antidetect_refresh.message); assert.equal(h.attr('data-antidetect-refresh').props.title, h.table.antidetect_refresh.message); assert.match(h.attr('data-antidetect-refresh').props.class, /workspace-tool--icon/u);
    assert.equal(h.nodes(node => node.props.class === 'workspace-secondary-actions').length, 0, 'the full-width strip is gone'); assert.equal(h.tree.props.children[1].props['data-antidetect-layout'], true, 'the levels follow the header directly');
    assert.equal(header.props.children.some(node => node?.type === 'p'), false, 'no generic description above the actual controls');
    assert.equal(h.nodes(node => node.props.role === 'switch').length, 1);
    h.attr('data-antidetect-master').props.onClick(); await h.settle();
    click(h, 'browser', 'data-antidetect-category'); await h.settle();
    assert.equal(h.attr('data-antidetect-master').props['aria-checked'], true);
    assert.equal(h.attr('data-antidetect-dirty', false), undefined, 'ADR-104: the page save bar is shown only for the network draft or unsaved changes');
    assert.equal(h.attr('data-antidetect-refresh').props.disabled, false);
    click(h, 'network', 'data-antidetect-category'); await h.settle();
    assert.equal(h.attr('data-antidetect-dirty', false).props['data-antidetect-dirty'], false);
    assert.equal(h.s.writes().length, 1); assert.equal(h.s.permissions.length, 0);
    h.attr('data-antidetect-cancel').props.onClick(); await h.settle();
    assert.equal(h.attr('data-antidetect-master').props['aria-checked'], true, 'Cancel cannot undo a committed module switch');
    assert.equal(h.attr('data-antidetect-refresh').props.disabled, false);
  } finally { provideTourButton(null); h.unmount(); }
});

test('new workspace CSS is management-scoped and launcher documents do not load the Antidetect workspaces', () => {
  for (const [file, marker] of [
    ['antidetect-ui.css', '/* Internal management workspace.'],
    ['fingerprint-profile-ui.css', '/* Internal management layout;'],
  ]) {
    const source = readFileSync(new URL('../../apps/production-extension/' + file, import.meta.url), 'utf8');
    assert.equal(source.indexOf(marker), source.lastIndexOf(marker));
    const changes = source.slice(source.indexOf(marker)).replace(/\/\*[\s\S]*?\*\//gu, '');
    const rules = [...changes.matchAll(/([^{}]+)\{/gu)].map(match => match[1].trim());
    assert.ok(rules.length > 20);
    // A keyframes block (a name with the fp- prefix and its steps) styles nothing by itself: a management-scoped rule attaches the animation.
    const keyframes = /^@keyframes\s+fp-[a-z][\w-]*$/u, step = /^(?:from|to|\d+(?:\.\d+)?%(?:\s*,\s*\d+(?:\.\d+)?%)*)$/u;
    for (const rule of rules) if (!rule.startsWith('@media') && !keyframes.test(rule) && !step.test(rule)) for (const selector of rule.split(/,(?![^()]*\))/u)) {
      assert.match(selector.trim(), /^\.management-shell\s/u, file + ': every new selector is internal');
    }
  }
  for (const file of ['popup.html', 'sidepanel.html']) {
    const html = readFileSync(new URL('../../apps/production-extension/' + file, import.meta.url), 'utf8');
    assert.doesNotMatch(html, /(?:antidetect-ui|fingerprint-profile-ui)\.(?:css|js)/u);
  }
});

test('opening Antidetect reads once, starts in Network and never grants, enables or writes settings', async () => {
  const h = harness(); try { h.render(); await h.settle(); assert.ok(h.attr('data-antidetect-app')); assert.deepEqual(h.nodes(node => node.props['data-antidetect-category']).map(node => node.props['data-antidetect-category']), ANTIDETECT_CATEGORIES); assert.equal(h.attr('data-antidetect-category', 'network').props['aria-selected'], true); assert.equal(h.s.calls.filter(call => call.type === 'ui-api-config-get').length, 1); assert.equal(h.s.writes().length, 0); assert.equal(h.s.permissions.length, 0); assert.equal(h.attr('data-antidetect-master').props['aria-checked'], false); assert.equal(h.attr('data-antidetect-save').props.disabled, true); assert.equal(h.attr('data-antidetect-devices').props.disabled, true); } finally { h.unmount(); } assert.equal(h.s.api.storage.onChanged.size, 0); assert.equal(h.s.api.permissions.onRemoved.size, 0);
});

test('the Antidetect page master controls Custom while retaining active API Guard blocking', async () => {
  const s = server(); seedRtc(s); s.value.configuration.enabled = true;
  s.value.configuration = updateApiConfiguration(s.value.configuration, 'websocket', { mode: 'on' }).value;
  const before = clone(s.value.configuration), h = harness({ server: s, locale: 'ru' });
  try {
    h.render(); await h.settle();
    assert.equal(h.attr('data-antidetect-master').props['aria-checked'], false);
    assert.equal(h.attr('data-antidetect-effective', 'webrtc').props['data-antidetect-effective-state'], 'inactive');
    assert.equal(h.attr('data-antidetect-effective', 'webrtc').props.children[1], h.table.antidetect_inactive.message);
    assert.equal(h.attr('data-antidetect-effective', 'websocket').props['data-antidetect-effective-state'], 'block');
    assert.equal(h.attr('data-antidetect-block-owner', 'network').props.children, h.table.antidetect_block_owner.message);
    h.attr('data-antidetect-master').props.onClick(); await h.settle(); assert.equal(s.writes().length, 1);
    await h.attr('data-antidetect-save').props.onClick(); await h.settle();
    assert.equal(s.writes().length, 1, 'a clean Save does not replay the immediate master');
    assert.equal(s.value.configuration.antidetectEnabled, true); assert.equal(s.value.configuration.enabled, true);
    assert.deepEqual(s.value.configuration.apis, before.apis);
    assert.equal(h.attr('data-antidetect-effective', 'webrtc').props['data-antidetect-effective-state'], 'spoof');
    assert.equal(h.attr('data-antidetect-effective', 'websocket').props['data-antidetect-effective-state'], 'block');
    h.attr('data-antidetect-master').props.onClick(); await h.settle();
    await h.attr('data-antidetect-save').props.onClick(); await h.settle();
    assert.equal(s.value.configuration.antidetectEnabled, false); assert.equal(s.value.configuration.enabled, true);
    assert.equal(h.attr('data-antidetect-effective', 'websocket').props['data-antidetect-effective-state'], 'block');
  } finally { h.unmount(); }
});

test('inherited modes never pretend Allow; category changes reuse the editor without a write or permission request', async () => {
  const h = harness(); try { h.render(); await h.settle(); for (const name of ['webrtc', 'websocket', 'webtransport']) { assert.equal(h.nodes(node => node.props['data-antidetect-mode']?.startsWith(name + ':') && node.props['aria-checked']).length, 0); assert.ok(h.attr('data-antidetect-inherited', name)); } click(h, 'device', 'data-antidetect-category'); await h.settle(); const editor = () => h.nodes(node => node.type?.name === 'ApiConfigurationEditor')[0]; assert.equal(editor().props.presentation, 'antidetect'); assert.equal(editor().props.fixedCategory, 'hardware'); assert.equal(editor().props.hideWebRtc, true); click(h, 'network', 'data-antidetect-category'); await h.settle(); assert.equal(editor().props.active, false); assert.equal(h.s.writes().length, 0); assert.equal(h.s.permissions.length, 0); } finally { h.unmount(); }
});

test('the immediate master preserves even invalid draft fields and Save still validates them separately', async () => {
  const s = server(); seedRtc(s); const before = clone(s.value.configuration), h = harness({ server: s });
  try {
    h.render(); await h.settle(); input(h, 'ipv4:stun', 'unfinished-address'); await h.settle();
    await h.attr('data-antidetect-master').props.onClick(); await h.settle();
    assert.deepEqual(s.value.configuration, { ...before, antidetectEnabled: true });
    assert.equal(h.attr('data-antidetect-master').props['aria-checked'], true);
    assert.equal(h.attr('data-antidetect-address', 'ipv4:stun').props.value, 'unfinished-address');
    assert.equal(h.attr('data-antidetect-save').props.disabled, false);
    await h.attr('data-antidetect-save').props.onClick(); await h.settle();
    assert.equal(s.writes().length, 1); assert.ok(h.attr('data-antidetect-error'));
    assert.equal(h.attr('data-antidetect-address', 'ipv4:stun').props.value, 'unfinished-address');
    h.attr('data-antidetect-cancel').props.onClick(); await h.settle();
    assert.equal(h.attr('data-antidetect-master').props['aria-checked'], true);
    assert.equal(h.attr('data-antidetect-address', 'ipv4:stun').props.value, '198.51.100.20');
    assert.equal(s.permissions.length, 0);
  } finally { h.unmount(); }
});

test('a pending or rejected master never paints optimistic ON and cannot be double-submitted', async () => {
  const h = harness(); let release;
  try {
    h.render(); await h.settle(); input(h, 'ipv6:turn', '2001:db8::99'); await h.settle();
    h.s.value.intercept = request => request.type === 'ui-api-config-set' ? new Promise(resolve => { release = resolve; }) : undefined;
    const pending = h.attr('data-antidetect-master').props.onClick(); await h.settle();
    assert.equal(h.attr('data-antidetect-master').props['aria-checked'], false);
    assert.equal(h.attr('data-antidetect-master').props.disabled, true);
    await h.attr('data-antidetect-master').props.onClick(); assert.equal(h.s.writes().length, 1);
    release({ type: 'api-config-error', code: 'early-access-required' }); await pending; await h.settle();
    assert.equal(h.attr('data-antidetect-master').props['aria-checked'], false);
    assert.equal(h.attr('data-antidetect-master').props.disabled, false);
    assert.equal(h.attr('data-antidetect-address', 'ipv6:turn').props.value, '2001:db8::99');
    assert.equal(h.attr('data-antidetect-error').props.children, h.table.antidetect_early_required.message);
    assert.equal(h.s.permissions.length, 0); assert.equal(h.s.value.configuration.antidetectEnabled, false);
  } finally { h.unmount(); }
});

test('master toggles retain dormant address edits when the address override is disabled and re-enabled', async () => {
  const s = server(); seedRtc(s); const before = clone(s.value.configuration), h = harness({ server: s });
  try {
    h.render(); await h.settle(); input(h, 'ipv4:host', '192.0.2.99'); await h.settle();
    h.attr('data-antidetect-addresses-enabled').props.onChange({ currentTarget: { checked: false } }); await h.settle();
    await h.attr('data-antidetect-master').props.onClick(); await h.settle();
    assert.deepEqual(s.value.configuration, { ...before, antidetectEnabled: true });
    assert.equal(h.attr('data-antidetect-addresses-enabled').props.checked, false);
    h.attr('data-antidetect-addresses-enabled').props.onChange({ currentTarget: { checked: true } }); await h.settle();
    assert.equal(h.attr('data-antidetect-address', 'ipv4:host').props.value, '192.0.2.99');
    assert.equal(h.attr('data-antidetect-address', 'ipv6:turn').props.value, '2001:db8::30');
    h.attr('data-antidetect-cancel').props.onClick(); await h.settle();
    assert.equal(h.attr('data-antidetect-address', 'ipv4:host').props.value, '192.0.2.10');
    assert.equal(h.attr('data-antidetect-master').props['aria-checked'], true); assert.equal(s.writes().length, 1);
  } finally { h.unmount(); }
});

test('a stale master rejects further clicks until revalidated and preserves the unsaved editor', async () => {
  const h = harness();
  try {
    h.render(); await h.settle(); input(h, 'ipv6:turn', '2001:db8::99'); await h.settle();
    ++h.s.value.revision;
    await h.attr('data-antidetect-master').props.onClick(); await h.settle();
    assert.equal(h.attr('data-antidetect-master').props['aria-checked'], false);
    assert.equal(h.attr('data-antidetect-master').props.disabled, true);
    assert.ok(h.attr('data-antidetect-external-change'));
    assert.equal(h.attr('data-antidetect-address', 'ipv6:turn').props.value, '2001:db8::99');
    await h.attr('data-antidetect-master').props.onClick(); await h.settle();
    assert.equal(h.s.writes().length, 1); assert.equal(h.s.value.configuration.antidetectEnabled, false);
  } finally { h.unmount(); }
});

test('an enabled master without registered rules shows the localized inactive or error reason in the header', async () => {
  for (const registration of ['inactive', 'error']) {
    const s = server(); s.value.registration = registration; const h = harness({ server: s, locale: 'ru' });
    try {
      h.render(); await h.settle(); await h.attr('data-antidetect-master').props.onClick(); await h.settle();
      assert.equal(h.attr('data-antidetect-master').props['aria-checked'], true);
      const status = h.attr('data-antidetect-master-status', registration);
      assert.equal(status.props.role, 'status');
      assert.equal(status.props.children[2], registration === 'inactive' ? 'Нет активных правил' : h.table.antidetect_status_error.message);
      assert.equal(s.writes().length, 1);
    } finally { h.unmount(); }
  }
});

test('a delayed own storage event after the immediate master does not lock its accepted switch', async () => {
  const h = harness();
  try {
    h.render(); await h.settle(); await h.attr('data-antidetect-master').props.onClick(); await h.settle();
    const { revision, configuration } = h.s.snapshot();
    h.s.api.storage.onChanged.emit({ 'api-configuration:v1': { newValue: { revision, configuration } } }, 'local'); await h.settle();
    assert.equal(h.attr('data-antidetect-master').props['aria-checked'], true);
    assert.equal(h.attr('data-antidetect-master').props.disabled, false);
    assert.equal(h.attr('data-antidetect-external-change'), undefined);
    assert.equal(h.s.writes().length, 1);
  } finally { h.unmount(); }
});

test('hiding a pending master fences its late response and re-entry confirms the committed state without replay', async () => {
  const h = harness(); let release;
  try {
    h.render(); await h.settle(); input(h, 'ipv6:turn', '2001:db8::99'); await h.settle();
    h.s.value.intercept = request => request.type === 'ui-api-config-set' ? new Promise(resolve => { release = resolve; }) : undefined;
    const pending = h.attr('data-antidetect-master').props.onClick(); await h.settle();
    h.update({ active: false }); await h.settle();
    h.s.value.configuration.antidetectEnabled = true; ++h.s.value.revision;
    release(h.s.snapshot()); await pending; await h.settle();
    assert.equal(h.attr('data-antidetect-master').props['aria-checked'], false, 'a hidden late response cannot repaint accepted UI');
    assert.equal(h.attr('data-antidetect-master').props.disabled, true);
    await h.attr('data-antidetect-master').props.onClick(); assert.equal(h.s.writes().length, 1);
    h.s.value.intercept = null; h.update({ active: true }); await h.settle();
    assert.equal(h.attr('data-antidetect-master').props.disabled, true, 'changed baseline retains the existing conflict fence for a dirty editor');
    assert.ok(h.attr('data-antidetect-external-change'));
    assert.equal(h.attr('data-antidetect-address', 'ipv6:turn').props.value, '2001:db8::99');
    h.attr('data-antidetect-cancel').props.onClick(); await h.settle();
    await h.attr('data-antidetect-refresh').props.onClick(); await h.settle();
    assert.equal(h.attr('data-antidetect-master').props['aria-checked'], true);
    assert.equal(h.attr('data-antidetect-master').props.disabled, false); assert.equal(h.s.writes().length, 1);
  } finally { h.unmount(); }
});

test('the horizontal category tabs keep draft data while keyboard and pointer navigation share one selected panel', async () => {
  for (const locale of ['en', 'ar']) {
    const s = server(); seedRtc(s); const h = harness({ server: s, locale });
    try {
      h.render(); await h.settle();
      const layout = h.attr('data-antidetect-layout'), nav = h.attr('data-antidetect-navigation');
      assert.equal(nav.props.role, 'tablist'); assert.equal(nav.props['aria-orientation'], 'horizontal');
      assert.equal(layout.props.children[0], nav); assert.equal(layout.props.children[1], h.attr('data-antidetect-main'));
      assert.deepEqual(ANTIDETECT_CATEGORIES, ['quick', 'device', 'os', 'browser', 'network']);
      const focused = [], tabs = () => h.nodes(node => node.props['data-antidetect-category']);
      const iconFor = { quick: 'randomize', device: 'device', os: 'os', browser: 'browser', network: 'network' };
      for (const tab of tabs()) { const category = tab.props['data-antidetect-category']; assert.match(tab.props.class, new RegExp('antidetect-category--' + category)); assert.equal(tab.props.children[0].props.children.props.name, iconFor[category]); tab.props.ref({ focus: () => focused.push(category) }); }
      input(h, 'ipv4:stun', '198.51.100.77'); await h.settle();
      async function key(name, selected) {
        const current = tabs().find(tab => tab.props['aria-selected']); let prevented = false;
        current.props.onKeyDown({ key: name, preventDefault() { prevented = true; } }); await h.settle();
        assert.equal(prevented, true); assert.equal(h.attr('data-antidetect-category', selected).props['aria-selected'], true);
        assert.equal(focused.at(-1), selected); assert.equal(tabs().filter(tab => tab.props.tabIndex === 0).length, 1);
        assert.equal(h.nodes(node => node.props.role === 'tabpanel')[0].props['aria-labelledby'], 'antidetect-category-' + selected);
      }
      await key('Home', 'quick'); await key('ArrowDown', 'device'); await key('ArrowUp', 'quick');
      assert.equal(h.nodes(node => node.type?.name === 'ApiConfigurationEditor')[0].props.active, false);
      assert.equal(h.nodes(node => node.props.class === 'antidetect-api')[0].props.hidden, true);
      await key('ArrowUp', 'network'); await key('Home', 'quick'); await key('ArrowRight', locale === 'ar' ? 'network' : 'device'); await key('ArrowLeft', 'quick');
      click(h, 'network', 'data-antidetect-category'); await h.settle();
      assert.equal(h.attr('data-antidetect-address', 'ipv4:stun').props.value, '198.51.100.77'); assert.equal(s.writes().length, 0); assert.equal(s.permissions.length, 0); assert.equal(s.calls.filter(call => call.type === 'ui-api-config-get').length, 1);
    } finally { h.unmount(); }
  }
});

test('Quick setup uses its own actions and the immediate master never introduces a duplicate Save or Cancel', async () => {
  const h = harness();
  try {
    h.render(); await h.settle(); const panel = () => h.nodes(node => node.type?.name === 'FingerprintProfilePanel')[0];
    click(h, 'quick', 'data-antidetect-category'); await h.settle();
    assert.equal(panel().props.active, true); assert.equal(panel().props.disabled, false); assert.equal(h.nodes(node => node.props.class === 'antidetect-savebar').length, 0); assert.equal(h.attr('data-antidetect-save'), undefined); assert.equal(h.s.writes().length, 0);
    h.attr('data-antidetect-master').props.onClick(); await h.settle();
    assert.equal(panel().props.disabled, false); assert.equal(h.nodes(node => node.props.class === 'antidetect-savebar').length, 0); assert.equal(h.attr('data-antidetect-save'), undefined); assert.equal(h.attr('data-antidetect-cancel'), undefined);
    assert.equal(h.s.writes().length, 1); assert.equal(h.s.value.configuration.antidetectEnabled, true); assert.equal(h.s.value.configuration.enabled, false); assert.equal(h.attr('data-antidetect-save'), undefined); assert.equal(panel().props.disabled, false);
    await h.attr('data-antidetect-master').props.onClick(); await h.settle();
    assert.equal(h.s.writes().length, 2); assert.equal(h.s.value.configuration.antidetectEnabled, false); assert.equal(h.attr('data-antidetect-save'), undefined);
    click(h, 'network', 'data-antidetect-category'); await h.settle(); assert.equal(h.nodes(node => node.props.class === 'antidetect-savebar').length, 1); assert.equal(h.attr('data-antidetect-save').props.disabled, true);
  } finally { h.unmount(); }
});

test('dual-family typed addresses, mapped IPv6 and DTLS save atomically without enabling the shared master or replacing libraries', async () => {
  const s = server(); s.value.configuration = updateApiConfiguration(s.value.configuration, 'hardware-concurrency', { mode: 'custom', selected: { kind: 'value', value: 16 } }).value; const before = clone(s.value.configuration), h = harness({ server: s });
  try { h.render(); await h.settle(); click(h, 'webrtc:spoof'); await h.settle(); h.attr('data-antidetect-addresses-enabled').props.onChange({ currentTarget: { checked: true } }); await h.settle(); assert.equal(h.nodes(node => node.props['data-antidetect-address']).length, 6); for (const role of ['host', 'stun', 'turn']) input(h, 'ipv4:' + role, { host: '192.0.2.10', stun: '198.51.100.20', turn: '203.0.113.30' }[role]); await h.settle(); h.attr('data-antidetect-mapped-ipv6').props.onClick(); await h.settle(); assert.equal(h.attr('data-antidetect-address', 'ipv6:stun').props.value, '::ffff:c633:6414'); h.attr('data-antidetect-dtls').props.onChange({ currentTarget: { checked: true } }); await h.settle(); assert.equal(s.writes().length, 0); await h.attr('data-antidetect-save').props.onClick(); await h.settle(); assert.equal(s.writes().length, 1); assert.equal(s.writes()[0].expectedRevision, 5); assert.equal(s.value.configuration.enabled, false); assert.equal(currentRtc(s).mode, 'custom'); assert.equal(currentRtc(s).selected.value.addresses.ipv4.stun, '198.51.100.20'); assert.equal(currentRtc(s).selected.value.addresses.ipv6.stun, '::ffff:c633:6414'); assert.equal(currentRtc(s).selected.value.freshCertificates, true); assert.deepEqual(s.value.configuration.apis.filter(row => row.id !== 'webrtc'), before.apis.filter(row => row.id !== 'webrtc')); assert.equal(currentRtc(s).userValues.length, 1); assert.equal(h.attr('data-antidetect-save').props.disabled, true); } finally { h.unmount(); }
});

test('all six manual address fields are visible immediately and direct IPv6 input selects only a Custom draft', async () => {
  const h = harness(), before = clone(h.s.value.configuration);
  try {
    h.render(); await h.settle();
    assert.equal(h.nodes(node => node.props['data-antidetect-address']).length, 6);
    assert.equal(h.attr('data-antidetect-address-fields').props.disabled, false);
    for (const family of ['ipv4', 'ipv6']) for (const role of ['host', 'stun', 'turn']) assert.equal(h.attr('data-antidetect-address', family + ':' + role).props.disabled, false);
    input(h, 'ipv6:stun', '2001:db8:abcd::127'); await h.settle();
    assert.equal(h.attr('data-antidetect-mode', 'webrtc:spoof').props['aria-checked'], true);
    assert.equal(h.attr('data-antidetect-mode', 'webrtc:spoof').props.children, 'Custom value');
    assert.equal(h.attr('data-antidetect-addresses-enabled').props.checked, true);
    assert.equal(h.attr('data-antidetect-address', 'ipv6:stun').props.value, '2001:db8:abcd::127');
    assert.equal(h.attr('data-antidetect-dirty').props['data-antidetect-dirty'], true);
    assert.deepEqual(h.s.value.configuration, before); assert.equal(h.s.writes().length, 0); assert.equal(h.s.permissions.length, 0);
  } finally { h.unmount(); }
});

test('manual v4 and independent v6 values survive disabling the address override and Cancel clears the remembered draft', async () => {
  const h = harness();
  try {
    h.render(); await h.settle(); input(h, 'ipv4:turn', '203.0.113.119'); input(h, 'ipv6:turn', '2001:db8:abcd::c19'); await h.settle();
    h.attr('data-antidetect-addresses-enabled').props.onChange({ currentTarget: { checked: false } }); await h.settle();
    assert.equal(h.nodes(node => node.props['data-antidetect-address']).length, 6);
    assert.equal(h.attr('data-antidetect-address', 'ipv6:turn').props.value, '2001:db8:abcd::c19');
    h.attr('data-antidetect-addresses-enabled').props.onChange({ currentTarget: { checked: true } }); await h.settle();
    assert.equal(h.attr('data-antidetect-address', 'ipv4:turn').props.value, '203.0.113.119');
    assert.equal(h.attr('data-antidetect-address', 'ipv6:turn').props.value, '2001:db8:abcd::c19');
    h.attr('data-antidetect-cancel').props.onClick(); await h.settle();
    for (const family of ['ipv4', 'ipv6']) for (const role of ['host', 'stun', 'turn']) assert.equal(h.attr('data-antidetect-address', family + ':' + role).props.value, '');
    h.attr('data-antidetect-addresses-enabled').props.onChange({ currentTarget: { checked: true } }); await h.settle();
    assert.equal(h.attr('data-antidetect-address', 'ipv6:turn').props.value, ''); assert.equal(h.s.writes().length, 0);
  } finally { h.unmount(); }
});

test('manual IP entry from saved Allow or Block changes only a Custom draft and Cancel restores the stored mode', async () => {
  for (const mode of ['off', 'on']) {
    const s = server(); seedRtc(s, mode); s.value.configuration.enabled = true;
    const before = clone(s.value.configuration), h = harness({ server: s });
    try {
      h.render(); await h.settle();
      assert.equal(h.attr('data-antidetect-spoof-fields').props.disabled, true);
      assert.equal(h.attr('data-antidetect-address', 'ipv6:host').props.disabled, false);
      input(h, 'ipv6:host', '2001:db8:face::123'); await h.settle();
      assert.equal(h.attr('data-antidetect-mode', 'webrtc:spoof').props['aria-checked'], true);
      assert.equal(h.attr('data-antidetect-spoof-fields').props.disabled, false);
      assert.equal(h.attr('data-antidetect-master').props['aria-checked'], false);
      assert.equal(currentRtc(s).mode, mode); assert.deepEqual(s.value.configuration, before);
      assert.equal(s.writes().length, 0); assert.equal(s.permissions.length, 0);
      h.attr('data-antidetect-cancel').props.onClick(); await h.settle();
      assert.equal(h.attr('data-antidetect-mode', 'webrtc:' + (mode === 'off' ? 'allow' : 'block')).props['aria-checked'], true);
      assert.equal(h.attr('data-antidetect-address', 'ipv6:host').props.value, before.apis.find(row => row.id === 'webrtc').selected.value.addresses.ipv6.host);
      assert.deepEqual(s.value.configuration, before); assert.equal(s.writes().length, 0);
    } finally { h.unmount(); }
  }
});

test('Cancel and category switches discard address drafts while retaining the explicitly committed master', async () => {
  const s = server(); seedRtc(s); const before = clone(s.value.configuration), h = harness({ server: s });
  try { h.render(); await h.settle(); input(h, 'ipv6:turn', '2001:db8::99'); h.attr('data-antidetect-master').props.onClick(); await h.settle(); click(h, 'device', 'data-antidetect-category'); await h.settle(); click(h, 'network', 'data-antidetect-category'); await h.settle(); assert.equal(h.attr('data-antidetect-address', 'ipv6:turn').props.value, '2001:db8::99'); assert.equal(h.attr('data-antidetect-master').props['aria-checked'], true); h.attr('data-antidetect-cancel').props.onClick(); await h.settle(); assert.equal(h.attr('data-antidetect-address', 'ipv6:turn').props.value, '2001:db8::30'); assert.equal(h.attr('data-antidetect-master').props['aria-checked'], true); assert.deepEqual(s.value.configuration, { ...before, antidetectEnabled: true }); assert.equal(s.writes().length, 1); } finally { h.unmount(); }
});

test('Allow and Block preserve dormant Custom and device libraries while greying spoof controls', async () => {
  for (const mode of ['allow', 'block']) { const s = server(); seedRtc(s); const before = clone(currentRtc(s)), h = harness({ server: s }); try { h.render(); await h.settle(); click(h, 'webrtc:' + mode); await h.settle(); assert.equal(h.attr('data-antidetect-spoof-fields').props.disabled, true); assert.equal(h.attr('data-antidetect-devices').props.disabled, true); await h.attr('data-antidetect-save').props.onClick(); await h.settle(); assert.equal(currentRtc(s).mode, mode === 'allow' ? 'off' : 'on'); assert.deepEqual(currentRtc(s).selected, before.selected); assert.deepEqual(currentRtc(s).userValues, before.userValues); assert.equal(s.value.configuration.enabled, false); } finally { h.unmount(); } }
});

test('custom media list edits kind, label and identifiers; an empty list is an explicit reusable value', async () => {
  const h = harness(); try { h.render(); await h.settle(); click(h, 'webrtc:spoof'); await h.settle(); select(h, 'data-antidetect-device-mode', 'custom'); await h.settle(); h.attr('data-antidetect-device-add').props.onClick(); await h.settle(); input(h, '0:deviceId', 'owned-camera', 'data-antidetect-device-field'); input(h, '0:groupId', 'owned-group', 'data-antidetect-device-field'); input(h, '0:label', 'Камера для теста', 'data-antidetect-device-field'); h.attr('data-antidetect-device-field', '0:kind').props.onChange({ currentTarget: { value: 'videoinput' } }); await h.settle(); await h.attr('data-antidetect-save').props.onClick(); await h.settle(); let media = h.s.value.configuration.apis.find(row => row.id === 'media-enumeration'); assert.deepEqual(media.selected.value, [{ deviceId: 'owned-camera', groupId: 'owned-group', kind: 'videoinput', label: 'Камера для теста' }]); assert.equal(currentRtc(h.s).selected.value.randomizeDevices, false); h.attr('data-antidetect-device-remove', 0).props.onClick(); await h.settle(); await h.attr('data-antidetect-save').props.onClick(); await h.settle(); media = h.s.value.configuration.apis.find(row => row.id === 'media-enumeration'); assert.deepEqual(media.selected.value, []); assert.equal(media.mode, 'custom'); assert.equal(media.userValues.length, 1, 'the earlier camera profile remains reusable; the empty list matches the existing preset'); } finally { h.unmount(); }
});

test('invalid dual-family addresses and duplicate device keys stay editable without any persistence or raw error disclosure', async () => {
  const h = harness({ locale: 'ru' }); try { h.render(); await h.settle(); click(h, 'webrtc:spoof'); await h.settle(); h.attr('data-antidetect-addresses-enabled').props.onChange({ currentTarget: { checked: true } }); await h.settle(); input(h, 'ipv4:stun', 'secret.invalid'); await h.settle(); await h.attr('data-antidetect-save').props.onClick(); await h.settle(); assert.equal(h.s.writes().length, 0); assert.equal(h.attr('data-antidetect-error').props.children, h.table.antidetect_invalid.message); assert.doesNotMatch(h.attr('data-antidetect-error').props.children, /secret/); assert.equal(h.attr('data-antidetect-address', 'ipv4:stun').props.value, 'secret.invalid'); h.attr('data-antidetect-addresses-enabled').props.onChange({ currentTarget: { checked: false } }); select(h, 'data-antidetect-device-mode', 'custom'); await h.settle(); h.attr('data-antidetect-device-add').props.onClick(); await h.settle(); h.attr('data-antidetect-device-add').props.onClick(); await h.settle(); input(h, '1:deviceId', h.attr('data-antidetect-device-field', '0:deviceId').props.value, 'data-antidetect-device-field'); await h.settle(); await h.attr('data-antidetect-save').props.onClick(); await h.settle(); assert.equal(h.s.writes().length, 0); assert.equal(h.attr('data-antidetect-error').props.children, h.table.antidetect_invalid.message); } finally { h.unmount(); }
});

test('native policy grants are explicit and do not apply policy or page-mode drafts before Save', async () => {
  const h = harness(); try { h.render(); await h.settle(); click(h, 'webrtc:spoof'); select(h, 'data-antidetect-network-policy', 'disable_non_proxied_udp'); await h.settle(); assert.equal(h.s.permissions.length, 0); const pending = h.attr('data-antidetect-grant-privacy').props.onClick(); assert.deepEqual(h.s.permissions, [{ permissions: ['privacy'] }], 'request dispatched in the trusted click before awaiting'); await pending; await h.settle(); assert.equal(h.attr('data-antidetect-network-policy').props.value, 'disable_non_proxied_udp'); assert.equal(h.attr('data-antidetect-policy-status', 'inactive').props.children, h.table.protection_webrtc_inactive.message); assert.equal(h.s.value.configuration.webrtcNetworkPolicy, 'system'); assert.equal(currentRtc(h.s).mode, 'bypass'); assert.equal(h.s.writes().length, 0); await h.attr('data-antidetect-save').props.onClick(); await h.settle(); assert.equal(h.s.value.configuration.webrtcNetworkPolicy, 'disable_non_proxied_udp'); assert.equal(h.s.writes().length, 1); } finally { h.unmount(); }
});

test('external revision changes preserve the draft, disable Save and require explicit Cancel then Refresh', async () => {
  const h = harness(); try { h.render(); await h.settle(); click(h, 'webrtc:block'); await h.settle(); h.s.value.configuration = updateApiConfiguration(h.s.value.configuration, 'hardware-concurrency', { mode: 'custom', selected: { kind: 'value', value: 32 } }).value; ++h.s.value.revision; h.s.api.storage.onChanged.emit({ 'api-configuration:v1': {} }, 'local'); await h.settle(); assert.ok(h.attr('data-antidetect-external-change')); assert.equal(h.attr('data-antidetect-mode', 'webrtc:block').props['aria-checked'], true); assert.equal(h.attr('data-antidetect-save').props.disabled, true); assert.equal(h.attr('data-antidetect-refresh').props.disabled, true); h.attr('data-antidetect-cancel').props.onClick(); await h.settle(); assert.equal(h.attr('data-antidetect-refresh').props.disabled, false); await h.attr('data-antidetect-refresh').props.onClick(); await h.settle(); assert.equal(h.attr('data-antidetect-external-change'), undefined); assert.equal(h.s.writes().length, 0); assert.equal(h.s.value.configuration.apis.find(row => row.id === 'hardware-concurrency').selected.value, 32); } finally { h.unmount(); }
});

test('pending writes are not repeated and storage errors keep the local settings without claiming success', async () => {
  const h = harness({ locale: 'fr' }); let release; try { h.render(); await h.settle(); click(h, 'webrtc:block'); await h.settle(); h.s.value.intercept = request => request.type === 'ui-api-config-set' ? new Promise(resolve => { release = resolve; }) : undefined; const first = h.attr('data-antidetect-save').props.onClick(); await h.settle(); assert.equal(h.attr('data-antidetect-save').props.disabled, true); await h.attr('data-antidetect-save').props.onClick(); assert.equal(h.s.writes().length, 1); release({ schemaVersion: 1, type: 'api-config-error', code: 'storage-error', message: 'private backend failure' }); await first; await h.settle(); assert.equal(currentRtc(h.s).mode, 'bypass'); assert.equal(h.attr('data-antidetect-mode', 'webrtc:block').props['aria-checked'], true); assert.equal(h.attr('data-antidetect-error').props.children, h.table.antidetect_failed.message); assert.equal(h.attr('data-antidetect-dirty').props['data-antidetect-dirty'], true); } finally { h.unmount(); }
});

test('privacy revocation invalidates the view while retaining its draft and making no write', async () => {
  const h = harness(); try { h.render(); await h.settle(); click(h, 'webrtc:spoof'); await h.settle(); h.s.api.permissions.onRemoved.emit({ permissions: ['privacy'] }); await h.settle(); assert.ok(h.attr('data-antidetect-external-change')); assert.equal(h.attr('data-antidetect-mode', 'webrtc:spoof').props['aria-checked'], true); assert.equal(h.attr('data-antidetect-save').props.disabled, true); assert.equal(h.s.writes().length, 0); } finally { h.unmount(); }
});

test('invalidated effective badges and native policy values become unknown until Refresh without replacing the draft', async () => {
  const s = server(); seedRtc(s); s.value.configuration.antidetectEnabled = true; s.value.privacy = true; s.value.configuration.webrtcNetworkPolicy = 'default_public_interface_only'; const h = harness({ server: s });
  try {
    h.render(); await h.settle(); assert.equal(h.attr('data-antidetect-effective', 'webrtc').props['data-antidetect-effective-state'], 'spoof'); assert.ok(h.attr('data-antidetect-policy-effective')); assert.equal(h.attr('data-antidetect-network-scope').props.children, h.table.antidetect_editor_global.message);
    input(h, 'ipv4:stun', '198.51.100.99'); await h.settle(); s.api.permissions.onRemoved.emit({ permissions: ['privacy'] }); await h.settle();
    for (const protocol of ['webrtc', 'websocket', 'webtransport']) { const badge = h.attr('data-antidetect-effective', protocol); assert.equal(badge.props['data-antidetect-effective-state'], 'unknown'); assert.match(badge.props.class, /--neutral/); assert.equal(badge.props.children[1], h.table.antidetect_effective.message + ': —'); }
    assert.equal(h.attr('data-antidetect-policy-status', 'unknown').props.children, h.table.antidetect_effective.message + ': —'); assert.equal(h.attr('data-antidetect-policy-effective'), undefined); assert.equal(h.attr('data-antidetect-address', 'ipv4:stun').props.value, '198.51.100.99'); assert.equal(h.attr('data-antidetect-save').props.disabled, true); assert.equal(s.writes().length, 0);
  } finally { h.unmount(); }
});

test('inactive tabs cancel late reads and never update or write until explicitly visible', async () => {
  const s = server(); let release; s.value.intercept = () => new Promise(resolve => { release = resolve; }); const h = harness({ server: s }); try { h.render(); await h.settle(); h.update({ active: false }); await h.settle(); release(s.snapshot()); await h.settle(); assert.equal(h.attr('data-antidetect-master'), undefined); assert.equal(s.calls.length, 1); s.value.intercept = null; h.update({ active: true }); await h.settle(); assert.ok(h.attr('data-antidetect-master')); assert.equal(s.calls.length, 2); assert.equal(s.writes().length, 0); } finally { h.unmount(); }
});

test('returning to a clean retained panel reads once and replaces stale master and effective state without writes', async () => {
  const s = server(); seedRtc(s); s.value.configuration.antidetectEnabled = true;
  const h = harness({ server: s }); let release;
  try {
    h.render(); await h.settle();
    assert.equal(h.attr('data-antidetect-master').props['aria-checked'], true);
    assert.equal(h.attr('data-antidetect-effective', 'webrtc').props['data-antidetect-effective-state'], 'spoof');
    h.update({ active: false }); await h.settle();
    s.value.configuration.antidetectEnabled = false; ++s.value.revision;
    for (let index = 0; index < 100; index++) s.api.storage.onChanged.emit({ 'api-configuration:v1': {} }, 'local');
    await h.settle(); assert.equal(s.calls.length, 1, 'hidden notifications do not schedule reads');
    s.value.intercept = request => request.type === 'ui-api-config-get' ? new Promise(resolve => { release = resolve; }) : undefined;
    h.update({ active: true }); await h.settle();
    assert.equal(s.calls.length, 2);
    assert.equal(h.attr('data-antidetect-effective', 'webrtc').props['data-antidetect-effective-state'], 'unknown');
    assert.equal(h.attr('data-antidetect-external-change'), undefined, 'an in-flight validation does not claim a confirmed external change');
    h.update({ active: true }); h.update({ active: true });
    await h.attr('data-antidetect-refresh').props.onClick(); await h.settle();
    assert.equal(s.calls.length, 2, 'repeated visible renders and refresh clicks share the current read');
    release(s.snapshot()); await h.settle();
    assert.equal(h.attr('data-antidetect-master').props['aria-checked'], false);
    assert.equal(h.attr('data-antidetect-effective', 'webrtc').props['data-antidetect-effective-state'], 'inactive');
    assert.equal(h.attr('data-antidetect-external-change'), undefined); assert.equal(s.writes().length, 0); assert.equal(s.permissions.length, 0);
  } finally { h.unmount(); }
});

test('a retained dirty panel preserves its preview and fences Save when its hidden baseline revision changed', async () => {
  const s = server(); seedRtc(s); s.value.configuration.antidetectEnabled = true;
  const h = harness({ server: s });
  try {
    h.render(); await h.settle(); input(h, 'ipv4:stun', '198.51.100.99'); await h.settle();
    h.update({ active: false }); await h.settle();
    s.value.configuration.antidetectEnabled = false; ++s.value.revision;
    s.api.storage.onChanged.emit({ 'api-configuration:v1': {} }, 'local');
    h.update({ active: true }); await h.settle();
    assert.equal(s.calls.length, 2);
    assert.equal(h.attr('data-antidetect-address', 'ipv4:stun').props.value, '198.51.100.99');
    assert.ok(h.attr('data-antidetect-external-change'));
    assert.equal(h.attr('data-antidetect-effective', 'webrtc').props['data-antidetect-effective-state'], 'unknown');
    assert.equal(h.attr('data-antidetect-save').props.disabled, true);
    await h.attr('data-antidetect-save').props.onClick(); await h.settle();
    assert.equal(s.writes().length, 0, 'a stale handler cannot submit the preserved preview');
    h.attr('data-antidetect-cancel').props.onClick(); await h.settle();
    await h.attr('data-antidetect-refresh').props.onClick(); await h.settle();
    assert.equal(h.attr('data-antidetect-master').props['aria-checked'], false);
    assert.equal(h.attr('data-antidetect-external-change'), undefined);
  } finally { h.unmount(); }
});

test('re-entry validates even a missed hidden event and preserves a dirty preview when the revision is unchanged', async () => {
  const s = server(); seedRtc(s); s.value.configuration.antidetectEnabled = true;
  const h = harness({ server: s });
  try {
    h.render(); await h.settle(); input(h, 'ipv4:stun', '198.51.100.99'); await h.settle();
    h.update({ active: false }); await h.settle();
    s.value.registration = 'error';
    h.update({ active: true }); await h.settle();
    assert.equal(s.calls.length, 2);
    assert.equal(h.attr('data-antidetect-address', 'ipv4:stun').props.value, '198.51.100.99');
    assert.equal(h.attr('data-antidetect-external-change'), undefined);
    assert.equal(h.attr('data-antidetect-effective', 'webrtc').props['data-antidetect-effective-state'], 'error');
    assert.equal(h.attr('data-antidetect-dirty', true).props['data-antidetect-dirty'], true);
    assert.equal(h.attr('data-antidetect-save').props.disabled, false); assert.equal(s.writes().length, 0);
  } finally { h.unmount(); }
});

test('a failed re-entry read leaves effective state unknown and an explicit retry preserves the draft without mutation replay', async () => {
  const s = server(); seedRtc(s); s.value.configuration.antidetectEnabled = true;
  const h = harness({ server: s });
  try {
    h.render(); await h.settle(); input(h, 'ipv4:stun', '198.51.100.99'); await h.settle();
    h.update({ active: false }); await h.settle();
    s.value.intercept = request => request.type === 'ui-api-config-get' ? { schemaVersion: 1, type: 'api-config-error', code: 'storage-error' } : undefined;
    h.update({ active: true }); await h.settle();
    assert.equal(s.calls.length, 2); assert.ok(h.attr('data-antidetect-error'));
    assert.equal(h.attr('data-antidetect-effective', 'webrtc').props['data-antidetect-effective-state'], 'unknown');
    assert.equal(h.attr('data-antidetect-save').props.disabled, true);
    assert.equal(h.attr('data-antidetect-refresh').props.disabled, false, 'the read can be retried without discarding the preview');
    await h.attr('data-antidetect-save').props.onClick(); await h.settle(); assert.equal(s.writes().length, 0);
    s.value.intercept = null;
    await h.attr('data-antidetect-refresh').props.onClick(); await h.settle();
    assert.equal(s.calls.length, 3); assert.equal(h.attr('data-antidetect-error'), undefined);
    assert.equal(h.attr('data-antidetect-address', 'ipv4:stun').props.value, '198.51.100.99');
    assert.equal(h.attr('data-antidetect-effective', 'webrtc').props['data-antidetect-effective-state'], 'spoof');
    assert.equal(h.attr('data-antidetect-save').props.disabled, false); assert.equal(s.writes().length, 0);
  } finally { h.unmount(); }
});

test('owner: UDP, QUIC and IPv6 rows are not shown; native rule readback scopes only the corresponding protocol', async () => {
  const s = server(); s.value.configuration.enabled = true; s.value.configuration = updateApiConfiguration(s.value.configuration, 'websocket', { mode: 'on' }).value; s.value.rules = [{ id: 300000, priority: 1000, action: { type: 'block' }, condition: { resourceTypes: ['websocket'] } }]; const h = harness({ server: s }); try { h.render(); await h.settle(); for (const protocol of ['udp', 'quic', 'ipv6']) { assert.equal(h.nodes(node => node.props['data-antidetect-unavailable'] === protocol).length, 0); assert.equal(h.nodes(node => node.props['data-antidetect-mode'] === protocol + ':block').length, 0); } assert.equal(h.attr('data-antidetect-protocol-scope', 'websocket').props.children, h.table.antidetect_scope_browser.message); assert.equal(h.attr('data-antidetect-protocol-scope', 'webtransport').props.children, h.table.antidetect_scope_page.message); assert.equal(h.attr('data-antidetect-effective', 'websocket').props.children[1], h.table.antidetect_block.message); assert.equal(h.s.writes().length, 0); } finally { h.unmount(); }
});

test('failed registration and existing-document reload are displayed as actual outcomes separately from saved mode', async () => {
  const s = server(); s.value.configuration.enabled = true; s.value.registration = 'error'; s.value.reloadRequired = true; const h = harness({ server: s }); try { h.render(); await h.settle(); assert.ok(h.attr('data-antidetect-registration-error')); assert.ok(h.attr('data-antidetect-reload-required')); assert.equal(h.attr('data-antidetect-effective', 'webrtc').props['data-antidetect-effective-state'], 'error'); assert.equal(h.s.writes().length, 0); } finally { h.unmount(); }
});

test('all 21 catalogs cover the complete editor, values, hints, groups and UI controls without English fallback', () => {
  assert.equal(new Set(ANTIDETECT_EDITOR_FIELDS).size, 103); assert.equal(API_CONFIG_CATALOG.length, 158);
  assert.equal(API_CONFIG_CATALOG.filter(entry => entry.customSupported).length, 56);
  assert.deepEqual(API_CONFIG_CATALOG.slice(143).map(entry => entry.id), FINGERPRINT_CUSTOM_LOCALE_IDS);
  for (const language of PRODUCTION_LANGUAGES) {
    const shipped = JSON.parse(readFileSync(new URL(`../../apps/production-extension/${language.uiOnly ? 'ui-locales' : '_locales'}/${language.id}/messages.json`, import.meta.url), 'utf8'));
    const translated = messages(language.id);
    for (const key of FINGERPRINT_CUSTOM_LOCALE_KEYS) assert.equal(shipped[key]?.message, translated[key].message, language.id + '/' + key + ': actual shipped JSON');
  }
  for (const language of PRODUCTION_LANGUAGES) { const table = messages(language.id); for (const key of [...ANTIDETECT_UI_KEYS, ...ANTIDETECT_EDITOR_KEYS, ...FINGERPRINT_CUSTOM_LOCALE_KEYS]) { assert.equal(typeof table[key]?.message, 'string', language.id + '/' + key); assert.ok(table[key].message.trim(), language.id + '/' + key); assert.doesNotMatch(table[key].message, /Anti-Detect/); } assert.equal(table.management_tab_antidetect.message, 'Antidetect'); assert.ok(table.antidetect_editor_hints_string.message); assert.ok(table.antidetect_editor_hints_object.message); assert.ok(table.antidetect_editor_groups_graphics.message); }
});

test('saved notices and safe error codes follow live locale changes without writing, refreshing or replacing a draft', async () => {
  const h = harness();
  try {
    h.render(); await h.settle(); click(h, 'webrtc:block'); await h.settle(); await h.attr('data-antidetect-save').props.onClick(); await h.settle();
    assert.equal(h.attr('data-antidetect-dirty', false).props.children, messages('en').antidetect_saved.message);
    const afterSave = h.s.calls.length; h.setLocale('ru'); await h.settle(); assert.equal(h.attr('data-antidetect-dirty', false).props.children, messages('ru').antidetect_saved.message); assert.equal(h.s.calls.length, afterSave);
    click(h, 'webrtc:allow'); await h.settle(); h.s.value.intercept = request => request.type === 'ui-api-config-set' ? { schemaVersion: 1, type: 'api-config-error', code: 'storage-error', message: 'private backend detail' } : undefined;
    await h.attr('data-antidetect-save').props.onClick(); await h.settle(); assert.equal(h.attr('data-antidetect-error').props.children, messages('ru').antidetect_failed.message);
    const afterFailure = h.s.calls.length; h.setLocale('ar'); await h.settle(); assert.equal(h.attr('data-antidetect-error').props.children, messages('ar').antidetect_failed.message); assert.equal(h.attr('data-antidetect-dirty', true).props.children, messages('ar').antidetect_unsaved.message); assert.equal(h.attr('data-antidetect-mode', 'webrtc:allow').props['aria-checked'], true); assert.equal(currentRtc(h.s).mode, 'on'); assert.equal(h.s.calls.length, afterFailure); assert.equal(h.s.writes().length, 2);
  } finally { h.unmount(); }
});

// ADR-103 profile-editor presentation: same controls, a read-only overview and collapsible sections.
const overviewValue = (h, key) => { const value = h.attr('data-antidetect-overview-row', key).props.children[1].props.children[0].props.children; return Array.isArray(value) ? value.map(part => typeof part === 'string' ? part : part.props.children).join('') : value; };
function seededModes(s) {
  const preset = s.value.configuration.apis.find(row => row.id === 'hardware-concurrency').presets[0].value;
  for (const [id, patch] of [['hardware-concurrency', { mode: 'custom', selected: preset }], ['navigator-platform', { mode: 'on' }], ['client-hints', { mode: 'off' }], ['websocket', { mode: 'on' }]]) s.value.configuration = updateApiConfiguration(s.value.configuration, id, patch).value;
}

test('the overview sits inside the main column after the selected panel and before the save bar', async () => {
  const h = harness();
  try {
    h.render(); await h.settle();
    const layout = h.attr('data-antidetect-layout'), main = h.attr('data-antidetect-main'), workarea = h.attr('data-antidetect-workarea'), overview = h.attr('data-antidetect-overview');
    assert.deepEqual(layout.props.children, [h.attr('data-antidetect-navigation'), main], 'tabs stay above one main column');
    const items = main.props.children.filter(Boolean);
    assert.equal(items.at(-2), workarea); assert.equal(items.at(-1).props.class, 'antidetect-savebar');
    assert.equal(workarea.props.children[0].props.role, 'tabpanel'); assert.equal(workarea.props.children[1], overview);
    assert.equal(overview.type, 'aside'); assert.equal(overview.props['aria-labelledby'], 'antidetect-overview-title');
    assert.equal(h.nodes(node => node.props.id === 'antidetect-overview-title')[0].props.children, redesignLabels('en').overview);
    assert.deepEqual(h.nodes(node => node.props['data-antidetect-overview-row']).map(node => node.props['data-antidetect-overview-row']), ['master', 'api', 'webrtc', 'addresses', 'devices', 'websocket', 'webtransport', 'policy', 'math']);
    assert.equal(h.nodes(node => node.props.role === 'switch').length, 1, 'the overview never adds a second switch');
    for (const category of ANTIDETECT_CATEGORIES) { click(h, category, 'data-antidetect-category'); await h.settle(); assert.ok(h.attr('data-antidetect-overview'), category); }
    assert.equal(h.s.writes().length, 0); assert.equal(h.s.permissions.length, 0); assert.equal(h.s.calls.filter(call => call.type === 'ui-api-config-get').length, 1);
  } finally { h.unmount(); }
});

test('overview values follow the draft and the saved reply; unapplied rows say «Изменено» in words and stale state shows a dash', async () => {
  const s = server(); seededModes(s); s.value.configuration.enabled = true; const h = harness({ server: s, locale: 'ru' });
  try {
    h.render(); await h.settle();
    const ru = redesignLabels('ru'), own = antidetectEditorLabels('ru');
    const pendingRows = () => h.nodes(node => node.props['data-antidetect-overview-pending'] === true).map(node => node.props['data-antidetect-overview-row']);
    const pendingTabs = () => h.nodes(node => node.props['data-antidetect-category-pending']).map(node => node.props['data-antidetect-category-pending']);
    assert.equal(overviewValue(h, 'master'), own.off); assert.equal(overviewValue(h, 'api'), own.on);
    assert.equal(h.attr('data-antidetect-overview-row', 'api').props['data-antidetect-overview-changed'], true, 'the default comparison stays as data');
    assert.equal(overviewValue(h, 'webrtc'), ru.modeInherit); assert.equal(h.attr('data-antidetect-overview-row', 'webrtc').props['data-antidetect-overview-changed'], false);
    assert.equal(overviewValue(h, 'websocket'), ru.modeBlock); assert.equal(overviewValue(h, 'math'), ru.modeInherit + ' · 23/23');
    assert.deepEqual(pendingRows(), [], 'nothing unapplied after loading'); assert.deepEqual(pendingTabs(), []);
    assert.equal(h.nodes(node => String(node.props.class ?? '').includes('antidetect-overview__dot')).length, 0, 'no unexplained dot');
    const count = key => h.attr('data-antidetect-overview-count', key).props.children;
    assert.deepEqual([count('device:custom'), count('os:on'), count('browser:off'), count('network:on'), count('all:custom'), count('all:on'), count('all:off')], ['1', '1', '1', '0', '1', '1', '1'], 'the dedicated WebSocket row is not counted twice');
    click(h, 'webrtc:block'); await h.settle();
    assert.equal(overviewValue(h, 'webrtc'), ru.modeBlock);
    assert.deepEqual(pendingRows(), ['webrtc']); assert.equal(h.attr('data-antidetect-pending', 'webrtc').props.children, own.pending);
    assert.deepEqual(pendingTabs(), ['network'], 'the level tab says «Изменено» too'); assert.equal(h.attr('data-antidetect-category-pending', 'network').props.children, 'Изменено');
    assert.equal(h.attr('data-antidetect-dirty', true).props['data-antidetect-dirty'], true); assert.equal(s.writes().length, 0);
    s.value.configuration = updateApiConfiguration(s.value.configuration, 'navigator-platform', { mode: 'off' }).value; ++s.value.revision;
    s.api.storage.onChanged.emit({ 'api-configuration:v1': { newValue: { revision: s.value.revision, configuration: clone(s.value.configuration) } } }, 'local'); await h.settle();
    assert.equal(overviewValue(h, 'master'), '—'); assert.equal(count('os:on'), '—'); assert.equal(overviewValue(h, 'webrtc'), ru.modeBlock, 'the local draft stays visible');
    assert.equal(s.writes().length, 0); assert.equal(s.permissions.length, 0);
  } finally { h.unmount(); }
});

test('overview counts use the API editor categories and only explicit modes', () => {
  const s = server(); seededModes(s);
  const counts = antidetectApiCounts(s.value.configuration);
  assert.deepEqual(Object.keys(counts), [...ANTIDETECT_OVERVIEW_CATEGORIES, 'all']); assert.deepEqual(ANTIDETECT_OVERVIEW_MODES, ['custom', 'on', 'off']);
  assert.deepEqual(counts.all, { custom: 1, on: 1, off: 1 }); assert.deepEqual(counts.device, { custom: 1, on: 0, off: 0 });
  assert.deepEqual(antidetectApiCounts(createApiConfiguration()).all, { custom: 0, on: 0, off: 0 }, 'preset rows are not counted');
  assert.deepEqual(antidetectApiCounts(null).all, { custom: 0, on: 0, off: 0 });
});

test('network sections collapse by heading button without touching the draft, and keep label/control rows', async () => {
  const s = server(); seedRtc(s); const h = harness({ server: s });
  try {
    h.render(); await h.settle(); input(h, 'ipv4:host', '192.0.2.44'); await h.settle();
    for (const id of ['webrtc', 'channels']) {
      const toggle = () => h.attr('data-antidetect-section-toggle', id), body = () => h.attr('data-antidetect-section', id);
      assert.equal(toggle().type, 'button'); assert.equal(toggle().props.type, 'button'); assert.equal(toggle().props['aria-expanded'], true);
      assert.equal(toggle().props['aria-controls'], body().props.id); assert.equal(body().props.hidden, false);
      toggle().props.onClick(); await h.settle(); assert.equal(toggle().props['aria-expanded'], false); assert.equal(body().props.hidden, true);
      toggle().props.onClick(); await h.settle(); assert.equal(toggle().props['aria-expanded'], true); assert.equal(body().props.hidden, false);
    }
    assert.ok(h.nodes(node => node.props['data-antidetect-webrtc'])[0].props.children[0].props.children.includes(h.attr('data-antidetect-effective', 'webrtc')), 'WebRTC state stays visible when collapsed');
    assert.match(h.nodes(node => typeof node.props.class === 'string' && node.props.class.includes('antidetect-webrtc-mode'))[0].props.class, /antidetect-row/);
    for (const protocol of ['webtransport', 'websocket']) assert.match(h.attr('data-antidetect-protocol', protocol).props.class, /antidetect-row/);
    for (const protocol of ['udp', 'quic', 'ipv6']) assert.equal(h.nodes(node => node.props['data-antidetect-protocol'] === protocol).length, 0, 'owner: uncontrollable ' + protocol + ' row is not shown');
    assert.equal(h.nodes(node => node.props['data-antidetect-native-policy'])[0].props.children[0].props.children[0].props.children.type, 'h4');
    assert.equal(h.attr('data-antidetect-address', 'ipv4:host').props.value, '192.0.2.44'); assert.equal(s.writes().length, 0);
  } finally { h.unmount(); }
});

test('Antidetect editor labels: every production language has a complete localized row', () => {
  const lengths = antidetectEditorLabelRowLengths(), english = antidetectEditorLabels('en');
  assert.deepEqual(Object.keys(lengths).sort(), PRODUCTION_LANGUAGES.map(language => language.id).sort());
  assert.deepEqual([...ANTIDETECT_EDITOR_LABEL_LANGUAGES].sort(), PRODUCTION_LANGUAGES.map(language => language.id).sort());
  for (const [language, length] of Object.entries(lengths)) assert.equal(length, ANTIDETECT_EDITOR_LABEL_KEYS.length, language);
  for (const { id } of PRODUCTION_LANGUAGES) {
    const labels = antidetectEditorLabels(id);
    for (const key of ANTIDETECT_EDITOR_LABEL_KEYS) {
      assert.ok(typeof labels[key] === 'string' && labels[key].length > 0 && labels[key].trim() === labels[key], id + '/' + key);
      if (id !== 'en') assert.notEqual(labels[key], english[key], id + '/' + key + ': no English fallback');
    }
  }
  const ru = antidetectEditorLabels('ru');
  assert.deepEqual([ru.on, ru.off, ru.apiRules, ru.savedState, ru.changed], ['Включено', 'Выключено', 'Правила API', 'По сохранённой конфигурации', 'Отличается от значения по умолчанию'], 'ADR-103 labels unchanged');
  assert.deepEqual([ru.pending, ru.checklistTitle, ru.stateDone, ru.stepScripts, ru.stepMaster, ru.stepDevice], ['Изменено', 'Чтобы Antidetect заработал', 'Готово', 'Разрешить пользовательские скрипты', 'Включить Antidetect', 'Применить устройство']);
  // Sentences that quote a button or a tab use the names that language really shows there.
  for (const { id } of PRODUCTION_LANGUAGES) {
    const words = fingerprintDeviceLabels(id), labels = antidetectEditorLabels(id);
    assert.ok(labels.stepDeviceHint.includes(words.bar_apply), id + ': quotes the Apply button'); assert.ok(labels.stepDeviceHint.toLowerCase().includes(words.quick_title.toLowerCase().slice(0, 4)), id + ': names Quick setup');
    assert.match(labels.errorIpv4, /198\.51\.100\.10/u); assert.match(labels.errorIpv6, /2001:db8::10/u); assert.match(labels.errorMdns, /mDNS/u); assert.match(labels.errorMdns, /host/iu);
  }
  assert.equal(antidetectEditorLabels('pt-BR').on, 'Ativado'); assert.equal(antidetectEditorLabels('wuu').on, antidetectEditorLabels('zh_CN').on);
});

// ADR-107: one activation checklist at the top of the tab replaces the early-access callout, the master hint and the reload note.
import { antidetectChecklist, ANTIDETECT_CHECKLIST_STEPS, antidetectPanelReason, antidetectPendingLevels, antidetectAddressProblems } from '../../apps/production-extension/antidetect-ui.js';
import { antidetectDraft } from '../../apps/production-extension/antidetect-controller.js';
const steps = h => h.nodes(node => node.props['data-antidetect-checklist-step']).map(node => node.props['data-antidetect-checklist-step'] + ':' + node.props['data-antidetect-checklist-state']);
const checklistNode = h => h.nodes(node => Object.hasOwn(node.props, 'data-antidetect-checklist'))[0];
const checklistButtons = h => Object.fromEntries(['data-antidetect-early-settings', 'data-antidetect-early-recheck', 'data-antidetect-grant-early', 'data-antidetect-checklist-enable', 'data-antidetect-checklist-quick'].map(key => [key, h.attr(key)?.props.class ?? null]));
const notify = (s, patch = {}) => { Object.assign(s.value, patch); ++s.value.revision; s.api.storage.onChanged.emit({ 'api-configuration:v1': {} }, 'local'); };

test('ADR-107 checklist: without Chrome user-script access the first step names the exact fix, opens the extension page and re-checks; one primary button at a time', async () => {
  const s = server(); s.value.earlyAccess = 'browser-toggle-required'; const h = harness({ server: s }); const labels = fingerprintDeviceLabels('en'), own = antidetectEditorLabels('en');
  try {
    h.render(); await h.settle();
    assert.equal(h.attr('data-antidetect-checklist', 'scripts').type, 'section'); assert.equal(h.attr('data-antidetect-checklist', 'scripts').props['aria-labelledby'], 'antidetect-checklist-title');
    assert.deepEqual(steps(h), ['scripts:open', 'master:open', 'device:open']);
    const step = h.attr('data-antidetect-early-access', 'browser-toggle-required'); assert.equal(step.props['data-antidetect-checklist-step'], 'scripts', 'the early-access marker sits on the first step');
    const texts = h.nodes(node => node.type === 'strong' || node.type === 'p').map(node => node.props.children);
    assert.ok(texts.includes(labels.early_blocked_title) && texts.includes(labels.early_blocked_steps), 'title and steps');
    assert.deepEqual(checklistButtons(h), { 'data-antidetect-early-settings': 'button button--primary', 'data-antidetect-early-recheck': 'button', 'data-antidetect-grant-early': null, 'data-antidetect-checklist-enable': 'button', 'data-antidetect-checklist-quick': 'button' }, 'only the first open step is primary');
    await h.attr('data-antidetect-early-settings').props.onClick(); await h.settle();
    assert.deepEqual(s.calls.filter(call => call.type === 'tabs-create').map(call => call.url), ['chrome://extensions/?id=antidetect-fixture']);
    s.value.earlyAccess = 'ready'; await h.attr('data-antidetect-early-recheck').props.onClick(); await h.settle();
    assert.equal(h.attr('data-antidetect-early-access', 'browser-toggle-required'), undefined, 'the blocked marker disappears once access is ready');
    assert.deepEqual(steps(h), ['scripts:done', 'master:open', 'device:open']); assert.equal(h.attr('data-antidetect-checklist-chip', 'done').props.children, own.stateDone);
    assert.equal(checklistButtons(h)['data-antidetect-checklist-enable'], 'button button--primary', 'the next open step takes the primary button');
    await h.attr('data-antidetect-checklist-enable').props.onClick(); await h.settle();
    assert.equal(s.value.configuration.antidetectEnabled, true); assert.equal(s.writes().length, 1); assert.equal(s.permissions.length, 0, 'the checklist never requests a permission by itself');
    assert.deepEqual(steps(h), ['scripts:done', 'master:done', 'device:open']); assert.equal(checklistButtons(h)['data-antidetect-checklist-quick'], 'button button--primary');
    assert.ok(h.nodes(node => node.type === 'p' && node.props.children === own.stepDeviceHint).length === 1, 'the device step says how');
    h.attr('data-antidetect-checklist-quick').props.onClick(); await h.settle();
    assert.equal(h.attr('data-antidetect-category', 'quick').props['aria-selected'], true, 'Open Quick setup opens the level');
    s.value.configuration = updateApiConfiguration(s.value.configuration, 'hardware-concurrency', { mode: 'custom', selected: { kind: 'value', value: 8 } }).value; notify(s); await h.settle();
    assert.equal(checklistNode(h), undefined, 'everything done: the checklist disappears, nothing is stored');
    notify(s, { reloadRequired: true }); await h.settle();
    assert.deepEqual(steps(h), ['scripts:done', 'master:done', 'device:done', 'reload:instruction']);
    const reload = h.attr('data-antidetect-reload-required'); assert.equal(reload.props['data-antidetect-checklist-step'], 'reload');
    assert.equal(h.attr('data-antidetect-checklist-chip', 'instruction'), undefined, 'the reload line is an instruction and never ticked');
    assert.ok(h.nodes(node => node.type === 'strong' && node.props.children === h.table.antidetect_reload_required.message).length === 1);
    assert.equal(checklistNode(h).props['data-antidetect-checklist'], 'waiting', 'an instruction alone has no primary button');
    notify(s, { reloadRequired: false }); await h.settle(); assert.equal(checklistNode(h), undefined);
  } finally { h.unmount(); }
});

test('ADR-107 checklist: Firefox keeps its permission button; an unsupported browser reads «Недоступно» and is never counted as done', async () => {
  const s = server(); s.value.earlyAccess = 'permission-required'; const h = harness({ server: s });
  try {
    h.render(); await h.settle();
    assert.ok(h.attr('data-antidetect-early-access', 'permission-required')); assert.equal(h.attr('data-antidetect-grant-early').props.class, 'button button--primary');
    assert.equal(h.attr('data-antidetect-early-settings'), undefined); assert.equal(h.attr('data-antidetect-early-recheck'), undefined);
    assert.ok(h.nodes(node => node.type === 'p' && node.props.children === h.table.antidetect_early_required.message).length >= 1);
    await h.attr('data-antidetect-grant-early').props.onClick(); await h.settle();
    assert.deepEqual(s.permissions, [{ permissions: ['userScripts'] }], 'the existing grant path, from the user click'); assert.deepEqual(steps(h).slice(0, 1), ['scripts:done']);
  } finally { h.unmount(); }
  const u = server(); u.value.earlyAccess = 'unsupported'; u.value.configuration.antidetectEnabled = true;
  u.value.configuration = updateApiConfiguration(u.value.configuration, 'hardware-concurrency', { mode: 'custom', selected: { kind: 'value', value: 8 } }).value;
  const ru = harness({ server: u, locale: 'ru' }), own = antidetectEditorLabels('ru');
  try {
    ru.render(); await ru.settle();
    assert.deepEqual(steps(ru), ['scripts:unavailable', 'master:done', 'device:done'], 'stays visible: unavailable is not done');
    assert.equal(ru.attr('data-antidetect-checklist-chip', 'unavailable').props.children, 'Недоступно');
    assert.ok(ru.nodes(node => node.type === 'p' && node.props.children === own.stepScriptsUnsupported).length === 1);
    assert.equal(ru.attr('data-antidetect-grant-early'), undefined); assert.equal(ru.attr('data-antidetect-early-settings'), undefined, 'no Chrome instructions');
    assert.equal(checklistNode(ru).props['data-antidetect-checklist'], 'waiting', 'nothing to press: no primary button');
  } finally { ru.unmount(); }
});

test('ADR-107 network addresses: checked when a field is left, marked in words and aria-invalid; Save marks every wrong field and sends nothing', async () => {
  const s = server(), before = clone(s.value.configuration), h = harness({ server: s, locale: 'ru' }), own = antidetectEditorLabels('ru');
  const regions = { polite: { children: [], append(node) { this.children.push(node); } } }, created = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document'), focused = [];
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    querySelector: selector => selector === '[data-ui-announcer="polite"]' ? Object.assign(regions.polite, { isConnected: true, contains: () => false }) : null,
    createElement: () => { const node = { textContent: '', remove() {} }; created.push(node); return node; },
    getElementById: id => ({ focus: () => focused.push(id) }),
  } });
  const field = key => h.attr('data-antidetect-address', key), error = key => h.attr('data-antidetect-address-error', key);
  const spoken = async () => { await new Promise(resolve => setTimeout(resolve, 15)); return created.map(node => node.textContent); };
  try {
    h.render(); await h.settle();
    input(h, 'ipv4:host', '999.1.1.1'); await h.settle();
    assert.equal(field('ipv4:host').props['aria-invalid'], undefined, 'never while typing'); assert.equal(error('ipv4:host'), undefined);
    field('ipv4:host').props.onBlur(); await h.settle();
    assert.equal(field('ipv4:host').props['aria-invalid'], 'true'); assert.equal(field('ipv4:host').props['aria-describedby'], 'antidetect-address-ipv4-host-error');
    assert.equal(error('ipv4:host').props.id, 'antidetect-address-ipv4-host-error'); assert.equal(error('ipv4:host').props.children, own.errorIpv4);
    assert.deepEqual(await spoken(), [own.errorIpv4], 'the reason is spoken once, focus has already moved on');
    field('ipv4:host').props.onBlur(); await h.settle(); assert.deepEqual(await spoken(), [own.errorIpv4], 'not again for the same value');
    const label = h.nodes(node => node.type === 'label' && node.props.for === 'antidetect-address-ipv4-host')[0];
    assert.equal(label.props.children, h.table.protection_webrtc_host.message, 'the label is the name; the reason is a description');
    input(h, 'ipv6:turn', '198.51.100.20'); await h.settle();
    await h.attr('data-antidetect-save').props.onClick(); await h.settle();
    assert.equal(s.writes().length, 0); assert.deepEqual(s.value.configuration, before);
    assert.equal(h.attr('data-antidetect-error').props.children, h.table.antidetect_invalid.message);
    assert.equal(error('ipv6:turn').props.children, own.errorFamily, 'Save marks fields that were never left');
    assert.deepEqual(focused, ['antidetect-address-ipv4-host'], 'the first wrong field takes focus');
    input(h, 'ipv4:host', '192.0.2.10'); input(h, 'ipv6:turn', '2001:db8::30'); await h.settle();
    assert.equal(error('ipv4:host'), undefined); assert.equal(field('ipv6:turn').props['aria-invalid'], undefined, 'a fix clears the mark at once');
    await h.attr('data-antidetect-save').props.onClick(); await h.settle(); assert.equal(s.writes().length, 1);
    input(h, 'ipv4:stun', 'x'); await h.settle(); field('ipv4:stun').props.onBlur(); await h.settle(); assert.ok(error('ipv4:stun'));
    h.attr('data-antidetect-cancel').props.onClick(); await h.settle(); assert.equal(error('ipv4:stun'), undefined, 'Cancel forgets the marks');
    assert.deepEqual(antidetectAddressProblems(null), []);
    assert.deepEqual(antidetectAddressProblems({ ipv4: { host: 'mdns', stun: 'mdns', turn: null }, ipv6: { host: '1.2.3.4', stun: null, turn: '2001:db8::1' } }), ['ipv4:stun', 'ipv6:host']);
  } finally { h.unmount(); if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; }
});

test('ADR-107 network wording: the address checkbox does not repeat its heading and the master shows translated On/Off', async () => {
  for (const locale of PRODUCTION_LANGUAGES.map(language => language.id)) {
    const h = harness({ locale }); const own = antidetectEditorLabels(locale);
    try {
      h.render(); await h.settle();
      const heading = h.nodes(node => node.props.id === 'antidetect-addresses-label')[0].props.children, box = h.attr('data-antidetect-addresses-enabled');
      const text = h.nodes(node => node.type === 'label' && Array.isArray(node.props.children) && node.props.children.includes(box))[0].props.children[1].props.children;
      assert.equal(text, own.addressesUse, locale); assert.notEqual(text, heading, locale); assert.ok(!text.includes(heading) && !heading.includes(text), locale + ': neither repeats the other');
      assert.equal(h.attr('data-antidetect-master').props.children[1], own.off, locale);
      assert.ok(!['ON', 'OFF'].includes(h.attr('data-antidetect-master').props.children[1]) || locale === 'en', locale + ': no literal ON/OFF');
    } finally { h.unmount(); }
  }
});

test('ADR-107 save bar: blocked Save explains itself in words and points at the reason', async () => {
  const s = server(), h = harness({ server: s, locale: 'ru' }), own = antidetectEditorLabels('ru');
  try {
    h.render(); await h.settle();
    assert.equal(h.attr('data-antidetect-save').props['aria-disabled'], 'true', 'nothing to save'); assert.equal(h.nodes(node => node.props['data-antidetect-save-reason']).length, 0, 'no reason needed without changes');
    click(h, 'webrtc:block'); await h.settle();
    assert.equal(h.attr('data-antidetect-save').props.disabled, false); assert.equal(h.attr('data-antidetect-save').props['aria-disabled'], undefined);
    s.value.configuration = { ...clone(s.value.configuration), preset: 'limited' }; ++s.value.revision; s.api.storage.onChanged.emit({ 'api-configuration:v1': {} }, 'local'); await h.settle();
    const save = h.attr('data-antidetect-save'), reason = h.attr('data-antidetect-save-reason', 'external');
    assert.equal(save.props.disabled, true); assert.equal(save.props['aria-disabled'], 'true'); assert.equal(save.props['aria-describedby'], 'antidetect-save-reason');
    assert.equal(reason.props.id, 'antidetect-save-reason'); assert.equal(reason.props.children, own.reasonExternal);
    assert.equal(h.nodes(node => node.type?.name === 'FingerprintProfilePanel')[0].props.disabledReason, 'network-dirty');
  } finally { h.unmount(); }
});

test('ADR-107 palette: a level request selects that level once the section is shown; the network draft offers Save only while it can be saved', async () => {
  const { collectPaletteCommands } = await import('../../apps/production-extension/ui-shortcuts.js');
  const s = server(), h = harness({ server: s, props: { active: false } });
  try {
    h.render(); await h.settle();
    const request = { level: 'os' }; h.update({ request }); await h.settle();
    assert.equal(h.attr('data-antidetect-category', 'network').props['aria-selected'], true, 'waits while the section is hidden');
    h.update({ active: true }); await h.settle();
    assert.equal(h.attr('data-antidetect-category', 'os').props['aria-selected'], true);
    click(h, 'network', 'data-antidetect-category'); await h.settle(); h.update({}); await h.settle();
    assert.equal(h.attr('data-antidetect-category', 'network').props['aria-selected'], true, 'the same request is applied only once');
    h.update({ request: { level: 'bogus' } }); await h.settle(); assert.equal(h.attr('data-antidetect-category', 'network').props['aria-selected'], true);
    const network = () => collectPaletteCommands().filter(command => command.source === 'antidetect-network');
    assert.deepEqual(network(), [], 'nothing to save');
    click(h, 'webrtc:block'); await h.settle();
    assert.deepEqual(network().map(command => command.kind), ['apply-network']);
    network()[0].run(); await h.settle(); assert.equal(s.writes().length, 1); assert.deepEqual(network(), []);
  } finally { h.unmount(); }
  assert.equal(collectPaletteCommands().filter(command => command.source === 'antidetect-network').length, 0, 'unmounting removes the commands');
});

test('ADR-107 checklist model: derived only from the saved reply, honest about errors, scope and scripts', () => {
  const saved = (patch = {}, custom = 0) => {
    let configuration = createApiConfiguration();
    if (custom) configuration = updateApiConfiguration(configuration, 'hardware-concurrency', { mode: 'custom', selected: { kind: 'value', value: 8 } }).value;
    configuration.antidetectEnabled = patch.enabled ?? false;
    return { draft: { enabled: patch.enabled ?? false }, configuration, earlyAccess: patch.earlyAccess ?? 'ready', registration: patch.registration ?? (patch.enabled ? 'ready' : 'inactive'), reloadRequired: patch.reloadRequired ?? false };
  };
  const view = value => { const list = antidetectChecklist(value); return list && [list.steps.map(step => step.id + ':' + step.state + (step.reason ? '/' + step.reason : '')).join(' '), list.primary]; };
  assert.deepEqual(view(saved()), ['scripts:done master:open device:open', 'master']);
  assert.deepEqual(view(saved({ enabled: true })), ['scripts:done master:done device:open', 'device']);
  assert.deepEqual(view(saved({ enabled: true, registration: 'inactive' })), ['scripts:done master:done device:open/idle', 'device'], 'on, but nothing to register');
  assert.equal(view(saved({ enabled: true }, 1)), null, 'all done');
  assert.equal(view(saved({}, 1))?.[0], 'scripts:done master:open device:done', 'Custom rows saved while the master is off count as applied');
  assert.deepEqual(view(saved({ enabled: true, registration: 'error' }, 1)), ['scripts:done master:done device:error/error', null]);
  assert.deepEqual(view(saved({ enabled: true, registration: 'inactive' }, 1)), ['scripts:done master:done device:open/scope', 'device']);
  assert.deepEqual(view(saved({ enabled: true, registration: 'inactive', earlyAccess: 'browser-toggle-required' }, 1)), ['scripts:open master:done device:open/scripts', 'scripts']);
  assert.deepEqual(view(saved({ enabled: true, reloadRequired: true }, 1)), ['scripts:done master:done device:done reload:instruction', null]);
  assert.deepEqual(view(saved({ earlyAccess: 'unsupported', enabled: true }, 1)), ['scripts:unavailable master:done device:done', null]);
  assert.deepEqual(ANTIDETECT_CHECKLIST_STEPS, ['scripts', 'master', 'device', 'reload']);
  for (const broken of [null, undefined, {}, { draft: {} }]) assert.equal(antidetectChecklist(broken), null);
});

test('ADR-107: the profile panel learns why it is locked and can report its changed levels', async () => {
  assert.equal(antidetectPanelReason({}), null); assert.equal(antidetectPanelReason({ busy: true }), 'busy'); assert.equal(antidetectPanelReason({ uncertain: true, busy: true }), 'unverified');
  assert.equal(antidetectPanelReason({ dirty: true, uncertain: true, busy: true }), 'network-dirty', 'the actionable reason wins');
  const h = harness(); const panel = () => h.nodes(node => node.type?.name === 'FingerprintProfilePanel')[0];
  try {
    h.render(); await h.settle();
    assert.equal(panel().props.disabledReason, null); assert.equal(panel().props.disabled, false);
    input(h, 'ipv4:host', '192.0.2.10'); await h.settle();
    assert.equal(panel().props.disabled, true); assert.equal(panel().props.disabledReason, 'network-dirty');
    h.attr('data-antidetect-cancel').props.onClick(); await h.settle(); assert.equal(panel().props.disabledReason, null);
    const report = panel().props.onPendingLevels; assert.equal(typeof report, 'function');
    report(['os', 'browser', 'network', 'bogus', 7]); await h.settle();
    assert.deepEqual(h.nodes(node => node.props['data-antidetect-category-pending']).map(node => node.props['data-antidetect-category-pending']), ['os', 'browser'], 'only panel levels; the network level belongs to this page');
    assert.equal(panel().props.onPendingLevels, report, 'a stable callback');
    report([]); await h.settle(); assert.equal(h.nodes(node => node.props['data-antidetect-category-pending']).length, 0);
    report('os'); await h.settle(); assert.equal(h.nodes(node => node.props['data-antidetect-category-pending']).length, 0, 'non-arrays clear');
    // The panel's hint cards switch levels through this page, which owns the tabs.
    const navigate = panel().props.onNavigate; assert.equal(typeof navigate, 'function');
    navigate('os'); await h.settle(); assert.equal(h.attr('data-antidetect-category', 'os').props['aria-selected'], true);
    navigate('bogus'); await h.settle(); assert.equal(h.attr('data-antidetect-category', 'os').props['aria-selected'], true, 'unknown levels are ignored');
    assert.equal(panel().props.onNavigate, navigate, 'a stable callback');
  } finally { h.unmount(); }
  // The pure level helper: network fields and Math, never the master switch.
  const base = antidetectDraft(createApiConfiguration());
  assert.deepEqual([...antidetectPendingLevels(base, base)], []);
  assert.deepEqual([...antidetectPendingLevels(base, { ...base, enabled: !base.enabled })], [], 'the master is written at once');
  assert.deepEqual([...antidetectPendingLevels(base, { ...base, websocket: 'block' })], ['network']);
  assert.deepEqual([...antidetectPendingLevels(base, { ...base, math: { ...base.math, mode: 'spoof' } })], ['device']);
  assert.deepEqual([...antidetectPendingLevels(null, base)], []);
});

test('a switched-on master that applies nothing because user scripts are not allowed says why in the header', async () => {
  const s = server(); s.value.earlyAccess = 'browser-toggle-required'; s.value.registration = 'inactive'; const h = harness({ server: s }); const labels = fingerprintDeviceLabels('en');
  try {
    h.render(); await h.settle(); await h.attr('data-antidetect-master').props.onClick(); await h.settle();
    assert.equal(h.attr('data-antidetect-master').props['aria-checked'], true);
    assert.equal(h.attr('data-antidetect-master-status', 'inactive').props.children[2], labels.status_needs_scripts);
  } finally { h.unmount(); }
});

test('a newer revision saved by a neighbour (profile editor, popup, another window) is adopted silently while nothing is pending', async () => {
  const h = harness();
  try {
    h.render(); await h.settle();
    h.s.value.configuration = { ...clone(h.s.value.configuration), antidetectEnabled: true }; ++h.s.value.revision;
    h.s.api.storage.onChanged.emit({ 'api-configuration:v1': {} }, 'local'); await h.settle();
    assert.equal(h.attr('data-antidetect-external-change'), undefined, 'no lock without a pending draft');
    assert.equal(h.attr('data-antidetect-master').props['aria-checked'], true, 'the neighbour\'s master state is shown');
    assert.equal(h.attr('data-antidetect-master').props.disabled, false);
    const writes = h.s.writes().length; await h.attr('data-antidetect-master').props.onClick(); await h.settle();
    assert.equal(h.s.writes().length, writes + 1, 'the page can still write on top of the adopted revision'); assert.equal(h.s.value.configuration.antidetectEnabled, false);
  } finally { h.unmount(); }
});

test('a switched-on master with Custom rows but nothing registered while user scripts are allowed points at the access scope', async () => {
  const s = server(); s.value.registration = 'inactive'; s.value.configuration = updateApiConfiguration(s.value.configuration, 'hardware-concurrency', { mode: 'custom', selected: { kind: 'value', value: 8 } }).value; s.value.configuration.antidetectEnabled = true;
  const h = harness({ server: s }); const labels = fingerprintDeviceLabels('en');
  try {
    h.render(); await h.settle();
    assert.equal(h.attr('data-antidetect-master-status', 'inactive').props.children[2], labels.status_needs_scope);
  } finally { h.unmount(); }
});

test('a missing privacy permission in the Antidetect page has its own message', async () => {
  const s = server(); const h = harness({ server: s }); const labels = fingerprintDeviceLabels('en');
  try {
    h.render(); await h.settle(); s.value.intercept = request => request.type === 'ui-api-config-set' ? { schemaVersion: 1, type: 'api-config-error', code: 'privacy-permission-required' } : undefined;
    await h.attr('data-antidetect-master').props.onClick(); await h.settle();
    assert.equal(h.attr('data-antidetect-error').props.children, labels.privacy_required);
  } finally { h.unmount(); }
});


// --- ADR-105: one informational HTTP-headers line in the Network level --------------------------------------------------
import { antidetectHeaderLine, antidetectRegistrationProblem } from '../../apps/production-extension/antidetect-ui.js';
import { describeAntidetectHeaders } from '../../apps/production-extension/antidetect-header-controller.js';
import { applyDevicePatch } from '../../apps/production-extension/fingerprint-profiles.js';
import { FINGERPRINT_DEVICE_LABELS } from '../../apps/production-extension/fingerprint-device-labels.js';

function descend(node, predicate) { if (Array.isArray(node)) { for (const item of node) { const found = descend(item, predicate); if (found) return found; } return undefined; } if (!node?.props) return undefined; if (predicate(node)) return node; return descend(node.props.children, predicate); }
const textOf = node => { const parts = []; (function visit(item) { if (Array.isArray(item)) item.forEach(visit); else if (typeof item === 'string' || typeof item === 'number') parts.push(String(item)); else if (item?.props) visit(item.props.children); })(node); return parts.join(' ').replace(/\s+/gu, ' ').trim(); };
const headerRow = h => h.nodes(node => node.props['data-antidetect-headers'] !== undefined)[0];
const headerText = h => textOf(h.attr('data-antidetect-headers-text'));
const headerChips = (h, term) => { const item = h.nodes(node => node.type === 'div' && node.props.children?.[0]?.type === 'dt' && textOf(node.props.children[0]) === term)[0]; return item ? item.props.children[1].props.children.filter(code => code && code.props['data-antidetect-headers-more'] === undefined).map(code => code.props.children) : null; };
const headerMore = (h, term) => { const item = h.nodes(node => node.type === 'div' && node.props.children?.[0]?.type === 'dt' && textOf(node.props.children[0]) === term)[0]; const chip = item?.props.children[1].props.children.find(code => code?.props['data-antidetect-headers-more'] !== undefined); return chip ? { count: chip.props['data-antidetect-headers-more'], text: chip.props.children, dir: chip.props.dir } : null; };
const identityConfiguration = (extra = {}) => ({ ...applyDevicePatch(createApiConfiguration(), { os: 'windows-11', browser: 'chrome', version: 150 }, {}).configuration, antidetectEnabled: true, ...extra });
const planned = plan => () => plan;

test('the Network level shows one HTTP-headers row after the protocol rows, with no controls and its own label and icon', async () => {
  const words = FINGERPRINT_DEVICE_LABELS.en, h = harness({ describeHeaders: planned({ status: 'inactive', set: [], removed: [], reason: null }) });
  try {
    h.render(); await h.settle();
    const protocols = h.nodes(node => node.props.class === 'antidetect-protocols')[0], row = headerRow(h);
    assert.deepEqual(protocols.props.children.map(child => child.props.key), ['webtransport', 'websocket', 'headers'], 'the two protocol rows are untouched; the headers row follows');
    assert.equal(protocols.props.children[2], row); assert.equal(row.props['data-antidetect-headers'], 'inactive');
    assert.equal(textOf(descend(row, node => node.type === 'strong')), words.headers_label);
    assert.ok(descend(row, node => String(node.props.class).includes('antidetect-icon--headers')), 'its own icon class');
    assert.equal(headerText(h), words.headers_inactive); assert.equal(h.attr('data-antidetect-headers-text').props.role, 'status');
    // Informational only: nothing in the row can be pressed, typed into or followed.
    let interactive = 0; (function visit(node) { if (Array.isArray(node)) return node.forEach(visit); if (!node?.props) return; if (['button', 'input', 'select', 'textarea', 'a', 'details', 'summary'].includes(node.type) || node.props.onClick || node.props.onInput || node.props.onChange || node.props.tabIndex !== undefined || node.props.role === 'switch' || node.props.role === 'button') interactive++; visit(node.props.children); })(row);
    assert.equal(interactive, 0);
    assert.equal(h.attr('data-antidetect-headers-list'), undefined, 'no header names while nothing is applied');
    assert.equal(h.s.writes().length, 0); assert.equal(h.s.permissions.length, 0);
  } finally { h.unmount(); }
});

test('each header plan is stated honestly: applied lists the real names, every refusal gives its own reason, unknown results show a dash', async () => {
  const words = FINGERPRINT_DEVICE_LABELS.en;
  const cases = [
    ['applied', { status: 'applied', set: ['user-agent', 'accept-language', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'], removed: ['sec-ch-ua-arch', 'sec-ch-ua-full-version-list'], reason: null }, words.headers_applied],
    ['inactive', { status: 'inactive', set: [], removed: [], reason: null }, words.headers_inactive],
    ['unsupported', { status: 'unsupported', set: [], removed: [], reason: 'scope' }, words.headers_scope],
    ['unsupported', { status: 'unsupported', set: [], removed: [], reason: 'site-overrides' }, words.headers_site_overrides],
    ['unsupported', { status: 'unsupported', set: [], removed: [], reason: 'engine' }, words.headers_engine],
    ['unsupported', { status: 'unsupported', set: [], removed: [], reason: 'invalid' }, words.headers_invalid],
    ['unsupported', { status: 'unsupported', set: [], removed: [], reason: 'something-new' }, words.headers_inactive],
    ['error', { status: 'error', set: [], removed: [], reason: 'invalid' }, words.headers_invalid],
  ];
  for (const [state, plan, text] of cases) {
    const h = harness({ describeHeaders: planned(plan) });
    try {
      h.render(); await h.settle();
      assert.equal(headerRow(h).props['data-antidetect-headers'], state, plan.reason ?? plan.status); assert.equal(headerText(h), text, plan.status + '/' + plan.reason);
      if (state === 'applied') { assert.deepEqual(headerChips(h, words.headers_set), plan.set); assert.deepEqual(headerChips(h, words.headers_removed), plan.removed); assert.ok(h.nodes(node => node.type === 'code').every(code => code.props.dir === 'ltr'), 'header names stay left-to-right'); }
      else assert.equal(h.attr('data-antidetect-headers-list'), undefined, 'names are listed only when applied');
    } finally { h.unmount(); }
  }
  // A planner that throws, returns nothing or returns another shape never claims the headers follow the profile.
  for (const broken of [() => { throw new Error('boom'); }, () => undefined, () => null, () => ({}), () => ({ status: 'applied-ish' }), () => 'applied']) {
    const h = harness({ describeHeaders: broken });
    try { h.render(); await h.settle(); assert.equal(headerRow(h).props['data-antidetect-headers'], 'unknown'); assert.equal(headerText(h), h.table.antidetect_effective.message + ': —'); assert.equal(h.attr('data-antidetect-headers-list'), undefined); }
    finally { h.unmount(); }
  }
});

test('only header-shaped names are listed; beyond thirty-two a visible +N says how many more; an applied plan without names shows no empty list', async () => {
  const hostile = ['user-agent', 'User-Agent', 'a b', '<b>x</b>', 'x'.repeat(65), '', 5, null, { toString() { return 'x'; } }, 'sec-ch-ua'];
  const many = Array.from({ length: 40 }, (_, index) => 'x-header-' + index);
  const h = harness({ describeHeaders: planned({ status: 'applied', set: hostile, removed: many, reason: null }) });
  try {
    h.render(); await h.settle(); const words = FINGERPRINT_DEVICE_LABELS.en;
    assert.deepEqual(headerChips(h, words.headers_set), ['user-agent', 'sec-ch-ua']); assert.deepEqual(headerChips(h, words.headers_removed), many.slice(0, 32));
    assert.deepEqual(headerMore(h, words.headers_removed), { count: 8, text: '+8', dir: 'ltr' }, 'the hidden names are counted, not dropped silently'); assert.equal(headerMore(h, words.headers_set), null, 'invalid names are not counted as hidden');
  } finally { h.unmount(); }
  const exact = harness({ describeHeaders: planned({ status: 'applied', set: many.slice(0, 32), removed: [], reason: null }) });
  try { exact.render(); await exact.settle(); assert.equal(headerChips(exact, FINGERPRINT_DEVICE_LABELS.en.headers_set).length, 32); assert.equal(headerMore(exact, FINGERPRINT_DEVICE_LABELS.en.headers_set), null, 'exactly the limit needs no +N'); } finally { exact.unmount(); }
  const bare = harness({ describeHeaders: planned({ status: 'applied', set: [], removed: [], reason: null }) });
  try { bare.render(); await bare.settle(); assert.equal(headerText(bare), FINGERPRINT_DEVICE_LABELS.en.headers_applied); assert.equal(bare.attr('data-antidetect-headers-list'), undefined); }
  finally { bare.unmount(); }
  const text = harness({ describeHeaders: planned({ status: 'applied', set: 'user-agent', removed: { length: 3 }, reason: null }) });
  try { text.render(); await text.settle(); assert.equal(text.attr('data-antidetect-headers-list'), undefined, 'non-array lists are ignored'); } finally { text.unmount(); }
});

test('the planner gets the saved configuration, the global scope, the master state and the browser family', async () => {
  const calls = [], record = (...args) => { calls.push(args); return { status: 'inactive', set: [], removed: [], reason: null }; };
  const s = server(); s.value.configuration = identityConfiguration(); const h = harness({ server: s, describeHeaders: record });
  try {
    h.render(); await h.settle();
    const [configuration, scopeMatches, active, options] = calls.at(-1);
    assert.deepEqual(configuration, s.value.configuration, 'the saved configuration, not the draft'); assert.deepEqual(scopeMatches, ['http://*/*', 'https://*/*']); assert.equal(active, true); assert.deepEqual(options, { chrome: true });
  } finally { h.unmount(); }
  const off = harness({ describeHeaders: record });
  try { off.render(); await off.settle(); const [, , active] = calls.at(-1); assert.equal(active, false, 'both masters off'); } finally { off.unmount(); }
  // API Guard alone also counts as an active workspace for the planner (it decides what it needs itself).
  const guard = server(); guard.value.configuration = { ...createApiConfiguration(), enabled: true }; const g = harness({ server: guard, describeHeaders: record });
  try { g.render(); await g.settle(); assert.equal(calls.at(-1)[2], true); } finally { g.unmount(); }
  // A page editing the draft does not change what the saved reply says.
  const edit = harness({ server: s, describeHeaders: record });
  try { edit.render(); await edit.settle(); edit.attr('data-antidetect-mode', 'webrtc:block').props.onClick(); await edit.settle(); assert.deepEqual(calls.at(-1)[0], s.value.configuration); } finally { edit.unmount(); }
});

test('the planner is told the access scope does not cover the sites exactly when the page header says so', async () => {
  const seen = [], record = (_configuration, scopeMatches) => { seen.push([...scopeMatches]); return { status: 'unsupported', set: [], removed: [], reason: 'scope' }; };
  // Master on, Custom rows present, user scripts allowed, nothing registered: the access scope is the missing piece.
  const s = server(); s.value.configuration = identityConfiguration(); s.value.registration = 'inactive'; const h = harness({ server: s, describeHeaders: record });
  try {
    h.render(); await h.settle();
    assert.equal(antidetectRegistrationProblem(JSON.parse(JSON.stringify({ draft: { enabled: true }, registration: 'inactive', earlyAccess: 'ready', configuration: s.value.configuration }))), 'scope');
    assert.deepEqual(seen.at(-1), [], 'no scope reaches the planner'); assert.equal(headerText(h), FINGERPRINT_DEVICE_LABELS.en.headers_scope);
    assert.equal(h.attr('data-antidetect-master-status', 'inactive').props.children[2], FINGERPRINT_DEVICE_LABELS.en.status_needs_scope, 'the same inference drives the page header');
  } finally { h.unmount(); }
  // Registered, or a different problem: the global scope is assumed.
  for (const patch of [{ registration: 'ready' }, { registration: 'inactive', earlyAccess: 'browser-toggle-required' }, { registration: 'error' }]) {
    const t = server(); t.value.configuration = identityConfiguration(); Object.assign(t.value, patch); const g = harness({ server: t, describeHeaders: record });
    try { g.render(); await g.settle(); assert.deepEqual(seen.at(-1), ['http://*/*', 'https://*/*'], JSON.stringify(patch)); } finally { g.unmount(); }
  }
});

test('registration problems are told apart the same way for the header and for the headers line', () => {
  const base = { draft: { enabled: true }, registration: 'inactive', earlyAccess: 'ready', configuration: identityConfiguration() };
  const empty = { ...base, configuration: createApiConfiguration() };
  assert.equal(antidetectRegistrationProblem(null), null); assert.equal(antidetectRegistrationProblem(undefined), null); assert.equal(antidetectRegistrationProblem({}), null);
  assert.equal(antidetectRegistrationProblem({ ...base, draft: { enabled: false } }), null, 'a master that is off has no problem');
  assert.equal(antidetectRegistrationProblem({ ...base, registration: 'ready' }), null);
  assert.equal(antidetectRegistrationProblem({ ...base, registration: 'error' }), 'error');
  for (const earlyAccess of ['browser-toggle-required', 'permission-required']) assert.equal(antidetectRegistrationProblem({ ...base, earlyAccess }), 'scripts', earlyAccess);
  assert.equal(antidetectRegistrationProblem(base), 'scope'); assert.equal(antidetectRegistrationProblem({ ...base, earlyAccess: 'unsupported' }), 'scope');
  assert.equal(antidetectRegistrationProblem(empty), 'idle', 'nothing Custom to register is not a scope problem');
});

test('the real planner drives the line: inactive, applied, scope and Firefox follow the saved reply', async () => {
  const words = FINGERPRINT_DEVICE_LABELS.en;
  const off = harness();
  try { off.render(); await off.settle(); assert.equal(headerRow(off).props['data-antidetect-headers'], 'inactive'); assert.equal(headerText(off), words.headers_inactive); } finally { off.unmount(); }
  const s = server(); s.value.configuration = identityConfiguration(); const on = harness({ server: s });
  try {
    on.render(); await on.settle();
    assert.equal(headerRow(on).props['data-antidetect-headers'], 'applied'); assert.equal(headerText(on), words.headers_applied);
    const names = headerChips(on, words.headers_set); assert.ok(names.includes('user-agent') && names.includes('sec-ch-ua'), 'the actual header names of the plan are listed');
    assert.deepEqual(names, describeAntidetectHeaders(s.value.configuration, ['http://*/*', 'https://*/*'], true, { chrome: true }).set, 'the page lists exactly what the planner returns');
    assert.deepEqual(headerChips(on, words.headers_removed), describeAntidetectHeaders(s.value.configuration, ['http://*/*', 'https://*/*'], true, { chrome: true }).removed);
  } finally { on.unmount(); }
  const lacking = server(); lacking.value.configuration = identityConfiguration(); lacking.value.registration = 'inactive'; const scope = harness({ server: lacking });
  try { scope.render(); await scope.settle(); assert.equal(headerRow(scope).props['data-antidetect-headers'], 'unsupported'); assert.equal(headerText(scope), words.headers_scope); } finally { scope.unmount(); }
  // Firefox: the extension URL is moz-extension://, so the planner is told it is not a Chrome-family build.
  const fox = server(); fox.value.configuration = identityConfiguration(); fox.api.runtime.getURL = path => 'moz-extension://antidetect-fixture/' + path;
  const f = harness({ server: fox });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: 'moz-extension://antidetect-fixture/options.html#antidetect' } });
  try {
    f.render(); await f.settle();
    assert.equal(headerRow(f).props['data-antidetect-headers'], 'unsupported'); assert.equal(headerText(f), words.headers_engine); assert.equal(f.attr('data-antidetect-headers-list'), undefined);
  } finally { f.unmount(); }
});

test('a stale, unverified or failed state never claims the headers follow the profile', async () => {
  const words = FINGERPRINT_DEVICE_LABELS.en, applied = planned({ status: 'applied', set: ['user-agent'], removed: [], reason: null });
  // A registration the browser rejected: the plan would apply, the page says Not applied.
  const failed = server(); failed.value.configuration = identityConfiguration(); failed.value.registration = 'error'; const h = harness({ server: failed, describeHeaders: applied });
  try {
    h.render(); await h.settle();
    assert.equal(headerRow(h).props['data-antidetect-headers'], 'error'); assert.equal(headerText(h), h.table.antidetect_status_error.message); assert.equal(h.attr('data-antidetect-headers-list'), undefined);
  } finally { h.unmount(); }
  // The same rejected registration with nothing to apply keeps the plan's own wording.
  const idle = harness({ server: failed, describeHeaders: planned({ status: 'inactive', set: [], removed: [], reason: null }) });
  try { idle.render(); await idle.settle(); assert.equal(headerText(idle), words.headers_inactive); } finally { idle.unmount(); }
  // A newer revision saved elsewhere makes the whole view unverified until Refresh: a dash, as for every effective state.
  const s = server(); s.value.configuration = identityConfiguration(); const stale = harness({ server: s, describeHeaders: applied });
  try {
    stale.render(); await stale.settle(); assert.equal(headerRow(stale).props['data-antidetect-headers'], 'applied');
    stale.attr('data-antidetect-mode', 'webrtc:block').props.onClick(); await stale.settle();
    s.value.revision++; s.api.storage.onChanged.emit({ 'api-configuration:v1': { newValue: { revision: s.value.revision, configuration: s.value.configuration } } }, 'local'); await stale.settle();
    assert.equal(headerRow(stale).props['data-antidetect-headers'], 'unknown'); assert.equal(headerText(stale), stale.table.antidetect_effective.message + ': —'); assert.equal(stale.attr('data-antidetect-headers-list'), undefined);
  } finally { stale.unmount(); }
});

test('the HTTP-headers line follows the live locale in all 21 languages and never shows a raw key', async () => {
  const states = [
    [{ status: 'applied', set: ['user-agent'], removed: ['sec-ch-ua-arch'], reason: null }, 'headers_applied'],
    [{ status: 'inactive', set: [], removed: [], reason: null }, 'headers_inactive'],
    [{ status: 'unsupported', set: [], removed: [], reason: 'scope' }, 'headers_scope'],
    [{ status: 'unsupported', set: [], removed: [], reason: 'site-overrides' }, 'headers_site_overrides'],
    [{ status: 'unsupported', set: [], removed: [], reason: 'engine' }, 'headers_engine'],
    [{ status: 'error', set: [], removed: [], reason: 'invalid' }, 'headers_invalid'],
  ];
  for (const [plan, key] of states) {
    const h = harness({ describeHeaders: planned(plan) });
    try {
      h.render(); await h.settle();
      for (const language of PRODUCTION_LANGUAGES) {
        h.setLocale(language.id); await h.settle(); const words = FINGERPRINT_DEVICE_LABELS[language.id];
        assert.equal(headerText(h), words[key], language.id + '/' + key); assert.equal(textOf(descend(headerRow(h), node => node.type === 'strong')), words.headers_label, language.id);
        assert.doesNotMatch(textOf(headerRow(h)), /\b(?:headers|region|issue)_[a-z_]+\b|undefined|\[object/u, language.id + '/' + key + ' shows a raw key');
        if (plan.status === 'applied') { assert.ok(textOf(headerRow(h)).includes(words.headers_set) && textOf(headerRow(h)).includes(words.headers_removed), language.id + ': both list captions'); }
      }
    } finally { h.unmount(); }
  }
});

test('the line is gated like the controller: master on and user scripts allowed; a missing browser switch is named, not hidden behind «off»', async () => {
  const words = FINGERPRINT_DEVICE_LABELS.en, calls = [];
  // A planner that would apply the profile whenever it is told the workspace is active.
  const plan = (configuration, scopeMatches, active) => { calls.push(active); return active ? { status: 'applied', set: ['user-agent'], removed: [], reason: null } : { status: 'inactive', set: [], removed: [], reason: null }; };
  for (const earlyAccess of ['browser-toggle-required', 'permission-required']) {
    const s = server(); s.value.configuration = identityConfiguration(); s.value.earlyAccess = earlyAccess; s.value.registration = 'inactive'; calls.length = 0;
    const h = harness({ server: s, describeHeaders: plan });
    try {
      h.render(); await h.settle();
      assert.deepEqual([...new Set(calls)].sort(), [false, true], earlyAccess + ': asked with the controller gate (off) and once with the question «would it apply»');
      assert.equal(headerRow(h).props['data-antidetect-headers'], 'unsupported'); assert.equal(headerRow(h).props['data-antidetect-headers-reason'], 'scripts');
      assert.equal(headerText(h), words.status_needs_scripts, 'the real blocker, as the page header names it'); assert.equal(h.attr('data-antidetect-headers-list'), undefined, 'nothing is listed as applied');
    } finally { h.unmount(); }
  }
  // Scripts allowed again: the same planner is asked with the gate open and the profile is applied.
  const ready = server(); ready.value.configuration = identityConfiguration(); calls.length = 0; const open = harness({ server: ready, describeHeaders: plan });
  try { open.render(); await open.settle(); assert.deepEqual([...new Set(calls)], [true]); assert.equal(headerRow(open).props['data-antidetect-headers'], 'applied'); assert.equal(headerRow(open).props['data-antidetect-headers-reason'], undefined); } finally { open.unmount(); }
  // The blocker only matters when the profile would otherwise be applied; every other outcome keeps its own, more specific, sentence.
  for (const [result, key] of [[{ status: 'inactive', set: [], removed: [], reason: null }, 'headers_inactive'], [{ status: 'unsupported', set: [], removed: [], reason: 'site-overrides' }, 'headers_site_overrides'], [{ status: 'unsupported', set: [], removed: [], reason: 'engine' }, 'headers_engine']]) {
    const s = server(); s.value.configuration = identityConfiguration(); s.value.earlyAccess = 'browser-toggle-required'; const h = harness({ server: s, describeHeaders: planned(result) });
    try { h.render(); await h.settle(); assert.equal(headerText(h), words[key], key); assert.equal(headerRow(h).props['data-antidetect-headers-reason'], result.reason ?? undefined, key); } finally { h.unmount(); }
  }
  // Both masters off: scripts do not matter.
  const off = server(); off.value.earlyAccess = 'browser-toggle-required'; const quiet = harness({ server: off, describeHeaders: plan });
  try { quiet.render(); await quiet.settle(); assert.equal(headerRow(quiet).props['data-antidetect-headers'], 'inactive'); assert.equal(headerText(quiet), words.headers_inactive); } finally { quiet.unmount(); }
  // And with the real planner: the Chrome switch off turns «applied» into the user-scripts sentence.
  const real = server(); real.value.configuration = identityConfiguration(); real.value.earlyAccess = 'browser-toggle-required'; real.value.registration = 'inactive'; const r = harness({ server: real });
  try { r.render(); await r.settle(); assert.equal(headerText(r), words.status_needs_scripts); assert.equal(headerRow(r).props['data-antidetect-headers-reason'], 'scripts'); } finally { r.unmount(); }
});

test('the planner runs once per saved reply, not once per render: typing, draft edits and tab switches reuse it, a new reply asks again', async () => {
  let runs = 0; const record = () => { runs++; return { status: 'inactive', set: [], removed: [], reason: null }; };
  const s = server(); s.value.configuration = identityConfiguration(); const h = harness({ server: s, describeHeaders: record });
  try {
    h.render(); await h.settle(); assert.equal(runs, 1, 'one run for the loaded reply');
    for (let index = 0; index < 5; index++) { h.attr('data-antidetect-mode', 'webrtc:block').props.onClick(); await h.settle(); h.attr('data-antidetect-mode', 'webrtc:allow').props.onClick(); await h.settle(); }
    const address = h.attr('data-antidetect-address', 'ipv4:host'); address.props.onInput({ currentTarget: { value: '203.0.113.7' } }); await h.settle();
    h.attr('data-antidetect-category', 'os').props.onClick(); await h.settle(); h.attr('data-antidetect-category', 'network').props.onClick(); await h.settle();
    assert.equal(runs, 1, 'twelve more renders reuse the answer');
    h.attr('data-antidetect-save').props.onClick(); await h.settle();
    assert.equal(runs, 2, 'the saved reply is a new object, so the planner is asked again');
    await h.attr('data-antidetect-refresh').props.onClick(); await h.settle();
    assert.equal(runs, 3, 'a reload is a new reply too');
  } finally { h.unmount(); }
});

test('antidetectHeaderLine is a pure table of the planner outcomes: shape, reason, names and the +N counts', () => {
  const saved = (extra = {}) => ({ configuration: identityConfiguration(), draft: { enabled: true }, registration: 'ready', earlyAccess: 'ready', ...extra });
  const line = (result, extra, options = {}) => antidetectHeaderLine(saved(extra), { chrome: true, describe: () => result, ...options });
  const applied = { status: 'applied', set: ['user-agent', 'sec-ch-ua'], removed: ['sec-ch-ua-arch'], reason: null };
  assert.deepEqual(line(applied), { state: 'applied', textKey: 'headers_applied', reason: null, set: ['user-agent', 'sec-ch-ua'], setMore: 0, removed: ['sec-ch-ua-arch'], removedMore: 0 });
  assert.deepEqual(line({ status: 'unsupported', set: [], removed: [], reason: 'scope' }), { state: 'unsupported', textKey: 'headers_scope', reason: 'scope', set: [], setMore: 0, removed: [], removedMore: 0 });
  assert.equal(line({ status: 'unsupported', set: ['user-agent'], removed: [], reason: 'engine' }).set.length, 0, 'names of a refused plan are never shown');
  assert.equal(line({ status: 'inactive', set: ['user-agent'], removed: [], reason: null }).set.length, 0);
  assert.deepEqual(line({ status: 'error', set: [], removed: [], reason: 'invalid' }), { state: 'error', textKey: 'headers_invalid', reason: 'invalid', set: [], setMore: 0, removed: [], removedMore: 0 });
  for (const broken of [undefined, null, 'applied', 7, {}, { status: 'APPLIED' }, { status: 'fine' }]) assert.deepEqual(line(broken), { state: 'unknown', textKey: null, reason: null, set: [], setMore: 0, removed: [], removedMore: 0 }, String(broken));
  assert.equal(antidetectHeaderLine(saved(), { chrome: true, describe: () => { throw new Error('boom'); } }).state, 'unknown');
  // The planner is told exactly: configuration, scope, the gate and the family flag.
  const seen = []; const spy = (...args) => { seen.push(args); return { status: 'inactive', set: [], removed: [], reason: null }; };
  antidetectHeaderLine(saved(), { chrome: true, describe: spy }); antidetectHeaderLine(saved({ earlyAccess: 'browser-toggle-required' }), { chrome: false, describe: spy }); antidetectHeaderLine(saved({ draft: { enabled: false }, configuration: createApiConfiguration() }), { describe: spy });
  assert.deepEqual(seen.map(args => [args[1], args[2], args[3]]), [
    [['http://*/*', 'https://*/*'], true, { chrome: true }],
    [['http://*/*', 'https://*/*'], false, { chrome: false }], [['http://*/*', 'https://*/*'], true, { chrome: false }],
    [['http://*/*', 'https://*/*'], false, { chrome: false }]]);
  const long = Array.from({ length: 40 }, (_, index) => 'x-' + index); assert.equal(line({ ...applied, set: long }).setMore, 8); assert.equal(line({ ...applied, set: long }).set.length, 32);
});

test('the headers row is styled for dark mode, forced colours and mirroring, inside the management scope only', () => {
  const source = readFileSync(new URL('../../apps/production-extension/antidetect-ui.css', import.meta.url), 'utf8');
  assert.match(source, /\.antidetect-icon--headers \{ color: light-dark\(#[0-9a-f]{6}, #[0-9a-f]{6}\); background: #[0-9a-f]{8}; \}/u, 'light and dark icon colours follow the chosen theme');
  const block = source.slice(source.indexOf('/* ADR-105: the HTTP-headers row')).replace(/\/\*[\s\S]*?\*\//gu, '');
  const selectors = [...block.matchAll(/([^{}]+)\{/gu)].map(match => match[1].trim()).filter(selector => !selector.startsWith('@media'));
  assert.ok(selectors.length >= 5); for (const selector of selectors) assert.match(selector, /^\.management-shell\s/u, selector);
  assert.match(block, /@media \(forced-colors: active\)\s*\{[^}]*\.antidetect-headers__list code/u, 'chips are mapped to system colours');
  assert.doesNotMatch(block, /(?:margin|padding|border)-(?:left|right)|text-align\s*:\s*(?:left|right)|(?:^|[\s;{])(?:left|right)\s*:/u, 'logical properties only');
});

// ADR-107 theme bug: the Antidetect hues followed the operating system (prefers-color-scheme) and ignored the chosen theme, so
// Pearl on a dark system painted pale dark-mode hues on a light surface; the quick and device tabs had no theme mapping at all.
test('ADR-107: a light theme on a dark system keeps light Antidetect hues, a dark theme on a light system keeps dark ones', async () => {
  const { default: vm } = await import('node:vm');
  const css = readFileSync(new URL('../../apps/production-extension/antidetect-ui.css', import.meta.url), 'utf8');
  const themes = readFileSync(new URL('../../apps/production-extension/themes.css', import.meta.url), 'utf8');
  const redesign = readFileSync(new URL('../../apps/production-extension/redesign.css', import.meta.url), 'utf8');
  const bootstrap = readFileSync(new URL('../../apps/production-extension/theme-bootstrap.js', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /prefers-color-scheme/u, 'no hue is keyed on the operating system');
  // 1. The first paint sets color-scheme from the chosen theme; light-dark() reads exactly that.
  const SCHEME = { pearl: 'light', orchid: 'light', aurora: 'dark', graphite: 'dark', glass: 'dark' };
  const schemeFor = (id, osDark) => {
    const attributes = new Map(), element = { style: {}, getAttribute: key => attributes.get(key) ?? null, setAttribute: (key, value) => attributes.set(key, value), removeAttribute: key => attributes.delete(key) };
    const context = { document: { documentElement: element }, localStorage: { getItem: () => id, setItem() {} }, chrome: { storage: { local: { get: () => new Promise(() => {}) } } }, matchMedia: () => ({ matches: osDark }), setTimeout: () => 0, clearTimeout() {}, Symbol };
    vm.runInNewContext(bootstrap, context);
    return element.style.colorScheme;
  };
  for (const [id, scheme] of Object.entries(SCHEME)) for (const osDark of [false, true]) assert.equal(schemeFor(id, osDark), scheme, id + ' with a ' + (osDark ? 'dark' : 'light') + ' system');
  for (const osDark of [false, true]) assert.equal(schemeFor('system', osDark), osDark ? 'dark' : 'light', 'System follows the system');
  // 2. Every hue with a dark variant is a light-dark() pair, and each side has 3:1 on the surfaces of its own scheme.
  const pairs = [...css.matchAll(/\.(antidetect-(?:icon|category|state)--[a-z0-9-]+|antidetect-mode--[a-z]+)[^{]*\{[^}]*?(?:color|--antidetect-category-color): light-dark\((#[0-9a-f]{6}), (#[0-9a-f]{6})\)/gu)].map(match => ({ name: match[1], light: match[2], dark: match[3] }));
  assert.ok(pairs.length >= 15, 'icons, categories, states and modes: ' + pairs.length);
  const surfaces = scheme => [...redesign.matchAll(/:root(?:, :root)?\[data-ui-theme="(\w+)"\](?:\[data-ui-theme-effective="system-dark"\])? \{([^}]*)\}/gu)]
    .filter(([selector, id]) => (selector.includes('system-dark') ? 'dark' : SCHEME[id] ?? 'light') === scheme).map(([, , body]) => /--rd-surface: (#[0-9a-f]{6})/u.exec(body)[1]);
  const luminance = hex => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const contrast = (a, b) => { const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (high + 0.05) / (low + 0.05); };
  for (const scheme of ['light', 'dark']) {
    const list = surfaces(scheme); assert.ok(list.length >= 3, scheme + ' surfaces');
    for (const pair of pairs) for (const surface of list) assert.ok(contrast(pair[scheme], surface) >= 3, pair.name + ' ' + scheme + ' ' + pair[scheme] + ' on ' + surface);
  }
  assert.ok(pairs.some(pair => contrast(pair.dark, '#ffffff') < 3), 'the old behaviour (a dark-mode hue on a light surface) really failed');
  // 3. themes.css maps all five levels to palette hues; nothing maps classes that no longer exist.
  for (const category of ANTIDETECT_CATEGORIES) assert.match(themes, new RegExp(':root\\[data-ui-theme\\] body \\.antidetect-category--' + category + ' \\{ --antidetect-category-color: [^;]*var\\(--(?:theme-category-[a-z]+|accent)\\)', 'u'), category);
  assert.doesNotMatch(themes, /\.antidetect-category--(?:profiles|hardware|all)\b/u, 'stale category classes are gone');
});

// --- Catalog 8: the mDNS host choice in the Network level's address editor ----------------------------------------------------
import { WEBRTC_HOST_MDNS, webRtcText } from '../../apps/production-extension/webrtc-configuration-ui.js';

const mdnsBox = (h, family) => h.attr('data-antidetect-mdns', family);
const toggleMdns = async (h, family, checked) => { mdnsBox(h, family).props.onChange({ currentTarget: { checked } }); await h.settle(); };
const hostInput = (h, family) => h.attr('data-antidetect-address', family + ':host');
const addressesOf = s => currentRtc(s).selected.value.addresses;
const saveDraft = async h => { await h.attr('data-antidetect-save').props.onClick(); await h.settle(); };
const nothingElse = (s, before) => assert.deepEqual(s.value.configuration.apis.filter(row => row.id !== 'webrtc'), before.apis.filter(row => row.id !== 'webrtc'), 'no other row changed');
const dirtyOf = h => h.nodes(node => 'data-antidetect-dirty' in node.props)[0]?.props['data-antidetect-dirty'];
const emptyFamily = host => ({ host, stun: null, turn: null });

test('each family offers an mDNS host checkbox right under its Host field; ADR-107: one note under both families describes them', async () => {
  const h = harness();
  try {
    h.render(); await h.settle();
    assert.equal(WEBRTC_HOST_MDNS, 'mdns');
    const notes = h.nodes(node => node.props['data-antidetect-mdns-note']); assert.equal(notes.length, 1, 'the note is shown once, not once per family');
    const note = notes[0]; assert.equal(note.props.id, 'antidetect-mdns-note');
    assert.equal(note.type, 'p'); assert.match(note.props.class, /antidetect-note/u); assert.equal(textOf(note), h.table.protection_webrtc_host_mdns_note.message);
    const control = h.attr('data-antidetect-address-fields').props.children[1].props.children.filter(Boolean);
    assert.equal(control.indexOf(note), control.indexOf(control.find(node => node.props?.class === 'antidetect-address-families')) + 1, 'right after both families');
    for (const family of ['ipv4', 'ipv6']) {
      const box = mdnsBox(h, family), fieldset = h.attr('data-antidetect-family', family);
      assert.equal(box.props.type, 'checkbox'); assert.equal(box.props.checked, false); assert.equal(box.props.disabled, false);
      assert.equal(box.props['aria-describedby'], note.props.id, family + ' points at the one note');
      const label = descend(fieldset, node => node.type === 'label' && String(node.props.class).includes('antidetect-mdns'));
      assert.equal(textOf(label), h.table.protection_webrtc_host_mdns.message); assert.match(label.props.class, /antidetect-check/u, 'the existing checkbox row pattern');
      // legend, Host field, the choice, STUN, TURN: the choice belongs to Host, not to the next field.
      const order = fieldset.props.children.map(child => child.type === 'legend' ? 'legend' : descend(child, node => node.props['data-antidetect-address'])?.props['data-antidetect-address'] ?? (descend(child, node => node.props['data-antidetect-mdns']) ? 'mdns' : child.type));
      assert.deepEqual(order, ['legend', family + ':host', 'mdns', family + ':stun', family + ':turn']);
      assert.equal(hostInput(h, family).props.disabled, false); assert.equal(hostInput(h, family).props.placeholder, family === 'ipv4' ? '198.51.100.10' : '2001:db8::10');
    }
    assert.equal(h.nodes(node => node.props['data-antidetect-address']).length, 6, 'the six address fields are unchanged'); assert.equal(h.nodes(node => node.props['data-antidetect-mdns']).length, 2);
    assert.equal(h.s.writes().length, 0);
  } finally { h.unmount(); }
});

test('the mDNS label and note exist in all 21 languages, follow the live locale and never show a raw key', async () => {
  const h = harness();
  try {
    h.render(); await h.settle();
    for (const language of PRODUCTION_LANGUAGES) {
      h.setLocale(language.id); await h.settle(); const table = messages(language.id);
      for (const family of ['ipv4', 'ipv6']) {
        const label = textOf(descend(h.attr('data-antidetect-family', family), node => node.type === 'label' && String(node.props.class).includes('antidetect-mdns'))), note = textOf(h.attr('data-antidetect-mdns-note'));
        assert.equal(label, table.protection_webrtc_host_mdns.message, language.id); assert.equal(note, table.protection_webrtc_host_mdns_note.message, language.id);
        assert.ok(label.length >= 5 && note.length >= 20, language.id); assert.doesNotMatch(label + ' ' + note, /protection_webrtc|host_mdns/u, language.id + ' shows a raw key');
      }
    }
  } finally { h.unmount(); }
  // A catalog that lacks the keys still gets the English text of the shared WebRTC helper, so the choice is never unlabeled.
  const bare = harness();
  try {
    bare.render(); await bare.settle(); delete bare.table.protection_webrtc_host_mdns; delete bare.table.protection_webrtc_host_mdns_note; bare.update({}); await bare.settle();
    const label = textOf(descend(bare.attr('data-antidetect-family', 'ipv4'), node => node.type === 'label' && String(node.props.class).includes('antidetect-mdns')));
    assert.equal(label, webRtcText(key => key, 'host_mdns')); assert.equal(textOf(bare.attr('data-antidetect-mdns-note')), webRtcText(key => key, 'host_mdns_note')); assert.doesNotMatch(label, /protection_webrtc/u);
  } finally { bare.unmount(); }
});

test('checking mDNS stores the word «mdns» as the Host of its family only, switches the literal field off and unchecking restores the literal', async () => {
  const h = harness(), before = clone(h.s.value.configuration);
  try {
    h.render(); await h.settle();
    input(h, 'ipv4:host', '192.0.2.10'); input(h, 'ipv6:host', '2001:db8::10'); await h.settle();
    await toggleMdns(h, 'ipv4', true);
    assert.equal(mdnsBox(h, 'ipv4').props.checked, true); assert.equal(mdnsBox(h, 'ipv6').props.checked, false);
    const v4 = hostInput(h, 'ipv4').props; assert.equal(v4.value, ''); assert.equal(v4.disabled, true); assert.equal(v4.placeholder, h.table.protection_webrtc_host_mdns.message);
    assert.equal(hostInput(h, 'ipv6').props.value, '2001:db8::10'); assert.equal(hostInput(h, 'ipv6').props.disabled, false, 'the other family keeps its literal');
    for (const role of ['stun', 'turn']) assert.equal(h.attr('data-antidetect-address', 'ipv4:' + role).props.disabled, false, 'STUN and TURN stay editable');
    assert.equal(h.attr('data-antidetect-mode', 'webrtc:spoof').props['aria-checked'], true); assert.equal(h.attr('data-antidetect-addresses-enabled').props.checked, true);
    assert.equal(h.attr('data-antidetect-dirty').props['data-antidetect-dirty'], true);
    // The disabled literal field ignores input.
    hostInput(h, 'ipv4').props.onInput({ currentTarget: { value: '203.0.113.1' } }); await h.settle(); assert.equal(mdnsBox(h, 'ipv4').props.checked, true); assert.equal(hostInput(h, 'ipv4').props.value, '');
    await toggleMdns(h, 'ipv4', false);
    assert.equal(mdnsBox(h, 'ipv4').props.checked, false); assert.equal(hostInput(h, 'ipv4').props.value, '192.0.2.10', 'the literal typed before is back'); assert.equal(hostInput(h, 'ipv4').props.disabled, false);
    // Each family restores its own literal.
    await toggleMdns(h, 'ipv6', true); await toggleMdns(h, 'ipv6', false); assert.equal(hostInput(h, 'ipv6').props.value, '2001:db8::10');
    h.attr('data-antidetect-addresses-enabled').props.onChange({ currentTarget: { checked: false } }); await h.settle(); await toggleMdns(h, 'ipv6', true); assert.equal(hostInput(h, 'ipv6').props.disabled, true, 'toggling while the override is off turns it on with the choice');
    assert.equal(h.attr('data-antidetect-addresses-enabled').props.checked, true);
    assert.deepEqual(h.s.value.configuration, before); assert.equal(h.s.writes().length, 0, 'a draft until Save'); assert.equal(h.s.permissions.length, 0);
  } finally { h.unmount(); }
});

test('typing the word «mdns» into the literal Host field does not switch the mode: it stays an invalid literal that Save rejects', async () => {
  for (const [family, typed] of [['ipv4', 'mdns'], ['ipv6', 'mdns'], ['ipv4', 'MDNS'], ['ipv4', ' mdns'], ['ipv6', 'mdns.local']]) {
    const s = server(), before = clone(s.value.configuration), h = harness({ server: s });
    try {
      h.render(); await h.settle(); input(h, family + ':host', typed); await h.settle();
      assert.equal(mdnsBox(h, family).props.checked, false, typed + ': not switched'); assert.equal(hostInput(h, family).props.disabled, false); assert.notEqual(hostInput(h, family).props.value, WEBRTC_HOST_MDNS, typed + ' is never stored as the mode');
      await saveDraft(h); assert.equal(s.writes().length, 0, typed); assert.equal(h.attr('data-antidetect-error').props.children, h.table.antidetect_invalid.message, typed); assert.deepEqual(s.value.configuration, before);
      assert.equal(hostInput(h, family).props.value, typed === 'mdns' ? 'mdns ' : typed, 'the draft stays editable');
    } finally { h.unmount(); }
  }
});

test('mapping IPv4 to IPv6 skips an mDNS host, never overwrites an IPv6 mDNS host, and still maps the other roles', async () => {
  const mapped = h => h.attr('data-antidetect-mapped-ipv6').props.onClick();
  // IPv4 host is mDNS: STUN and TURN map, the IPv6 Host is left alone.
  const a = harness();
  try {
    a.render(); await a.settle(); input(a, 'ipv4:stun', '198.51.100.20'); input(a, 'ipv4:turn', '203.0.113.30'); await a.settle(); await toggleMdns(a, 'ipv4', true);
    mapped(a); await a.settle();
    assert.equal(a.attr('data-antidetect-error'), undefined, 'no invalid-value error for the mDNS host'); assert.equal(a.attr('data-antidetect-address', 'ipv6:stun').props.value, '::ffff:c633:6414'); assert.equal(a.attr('data-antidetect-address', 'ipv6:turn').props.value, '::ffff:cb00:711e');
    assert.equal(hostInput(a, 'ipv6').props.value, ''); assert.equal(mdnsBox(a, 'ipv6').props.checked, false); assert.equal(mdnsBox(a, 'ipv4').props.checked, true, 'the IPv4 choice is untouched');
  } finally { a.unmount(); }
  // Only the mDNS host on the IPv4 side: nothing to map, the same feedback as for an empty IPv4 side.
  const b = harness();
  try { b.render(); await b.settle(); await toggleMdns(b, 'ipv4', true); mapped(b); await b.settle(); assert.equal(b.attr('data-antidetect-error').props.children, b.table.antidetect_invalid.message); assert.equal(hostInput(b, 'ipv6').props.value, ''); assert.equal(b.attr('data-antidetect-address', 'ipv6:stun').props.value, ''); } finally { b.unmount(); }
  // An explicit IPv6 mDNS host survives mapping of a literal IPv4 host.
  const c = harness();
  try {
    c.render(); await c.settle(); input(c, 'ipv4:host', '192.0.2.10'); input(c, 'ipv4:stun', '198.51.100.20'); await c.settle(); await toggleMdns(c, 'ipv6', true); mapped(c); await c.settle();
    assert.equal(mdnsBox(c, 'ipv6').props.checked, true); assert.equal(hostInput(c, 'ipv6').props.value, ''); assert.equal(c.attr('data-antidetect-address', 'ipv6:stun').props.value, '::ffff:c633:6414');
    await saveDraft(c); assert.deepEqual(addressesOf(c.s), { ipv4: { host: '192.0.2.10', stun: '198.51.100.20', turn: null }, ipv6: { host: 'mdns', stun: '::ffff:c633:6414', turn: null } });
  } finally { c.unmount(); }
  // Without any mDNS choice the host maps exactly as before.
  const d = harness();
  try { d.render(); await d.settle(); input(d, 'ipv4:host', '192.0.2.10'); await d.settle(); mapped(d); await d.settle(); assert.equal(hostInput(d, 'ipv6').props.value, '::ffff:c000:20a'); assert.equal(d.attr('data-antidetect-error'), undefined); } finally { d.unmount(); }
});

test('Save writes the mDNS host in the exact shape for IPv4 only, IPv6 only and both, through the existing validator and one CAS', async () => {
  const cases = [
    [['ipv4'], { ipv4: emptyFamily('mdns'), ipv6: emptyFamily(null) }],
    [['ipv6'], { ipv4: emptyFamily(null), ipv6: emptyFamily('mdns') }],
    [['ipv4', 'ipv6'], { ipv4: emptyFamily('mdns'), ipv6: emptyFamily('mdns') }],
  ];
  for (const [families, expected] of cases) {
    const s = server(), before = clone(s.value.configuration), h = harness({ server: s });
    try {
      h.render(); await h.settle(); for (const family of families) await toggleMdns(h, family, true);
      await saveDraft(h);
      assert.equal(s.writes().length, 1, families.join('+')); assert.equal(s.writes()[0].expectedRevision, 5);
      assert.deepEqual(addressesOf(s), expected, families.join('+') + ': stored addresses'); assert.deepEqual(s.writes()[0].configuration.apis.find(row => row.id === 'webrtc').selected.value.addresses, expected, 'the payload has the same shape');
      assert.equal(currentRtc(s).mode, 'custom'); assert.equal(s.value.configuration.enabled, false, 'API Guard is not enabled'); nothingElse(s, before);
      assert.equal(currentRtc(s).userValues.at(-1).value.value.addresses.ipv4.host, expected.ipv4.host, 'the saved library keeps the same value');
      assert.equal(dirtyOf(h), false, 'a saved draft is clean'); assert.equal(h.attr('data-antidetect-error'), undefined);
      for (const family of ['ipv4', 'ipv6']) { assert.equal(mdnsBox(h, family).props.checked, families.includes(family), family + ' after Save'); assert.equal(hostInput(h, family).props.disabled, families.includes(family)); }
    } finally { h.unmount(); }
  }
  // An mDNS family beside literal values of the other family and of its own STUN/TURN slots.
  const s = server(), h = harness({ server: s });
  try {
    h.render(); await h.settle(); input(h, 'ipv4:stun', '198.51.100.20'); input(h, 'ipv6:host', '2001:db8::10'); input(h, 'ipv6:turn', '2001:db8::30'); await h.settle(); await toggleMdns(h, 'ipv4', true); await saveDraft(h);
    assert.deepEqual(addressesOf(s), { ipv4: { host: 'mdns', stun: '198.51.100.20', turn: null }, ipv6: { host: '2001:db8::10', stun: null, turn: '2001:db8::30' } });
  } finally { h.unmount(); }
});

test('values that are not the exact mode word are still rejected: wrong host spellings, and the word in STUN or TURN, with nothing written', async () => {
  for (const [key, text] of [['ipv4:stun', 'mdns'], ['ipv4:turn', 'mdns'], ['ipv6:stun', 'mdns'], ['ipv6:turn', 'mdns'], ['ipv4:host', 'Mdns'], ['ipv6:host', 'mdns:1']]) {
    const s = server(), before = clone(s.value.configuration), h = harness({ server: s });
    try {
      h.render(); await h.settle(); await toggleMdns(h, key.startsWith('ipv4') ? 'ipv6' : 'ipv4', true); input(h, key, text); await h.settle();
      await saveDraft(h);
      assert.equal(s.writes().length, 0, key + ' = ' + text + ': nothing is written, not even the valid mDNS family'); assert.deepEqual(s.value.configuration, before);
      assert.equal(h.attr('data-antidetect-error').props.children, h.table.antidetect_invalid.message, key);
      assert.equal(mdnsBox(h, key.startsWith('ipv4') ? 'ipv6' : 'ipv4').props.checked, true, 'the draft keeps the valid choice and stays editable');
    } finally { h.unmount(); }
  }
  // Correcting the field makes the same draft saveable.
  const s = server(), h = harness({ server: s });
  try { h.render(); await h.settle(); await toggleMdns(h, 'ipv4', true); input(h, 'ipv4:stun', 'mdns'); await h.settle(); await saveDraft(h); assert.equal(s.writes().length, 0); input(h, 'ipv4:stun', '198.51.100.20'); await h.settle(); await saveDraft(h); assert.equal(s.writes().length, 1); assert.equal(addressesOf(s).ipv4.host, 'mdns'); assert.equal(addressesOf(s).ipv4.stun, '198.51.100.20'); }
  finally { h.unmount(); }
});

test('a saved mDNS host shows checked and switched off after loading, Cancel returns to it, and Cancel forgets the literal remembered for the unchecked state', async () => {
  const s = server(); s.value.configuration = updateApiConfiguration(s.value.configuration, 'webrtc', { mode: 'custom', selected: { kind: 'value', value: { addresses: { ipv4: emptyFamily('mdns'), ipv6: emptyFamily('2001:db8::10') }, iceTransportPolicy: 'preserve', randomizeDevices: false, freshCertificates: false, deviceLifetime: 'session' } } }).value;
  const h = harness({ server: s });
  try {
    h.render(); await h.settle();
    assert.equal(mdnsBox(h, 'ipv4').props.checked, true); assert.equal(hostInput(h, 'ipv4').props.disabled, true); assert.equal(hostInput(h, 'ipv4').props.value, ''); assert.equal(mdnsBox(h, 'ipv6').props.checked, false); assert.equal(hostInput(h, 'ipv6').props.value, '2001:db8::10');
    assert.equal(dirtyOf(h), false, 'loading is clean'); assert.equal(h.attr('data-antidetect-addresses-enabled').props.checked, true);
    // Unchecking a loaded choice leaves an empty field; typing and re-checking remembers that literal ...
    await toggleMdns(h, 'ipv4', false); assert.equal(hostInput(h, 'ipv4').props.value, ''); input(h, 'ipv4:host', '192.0.2.10'); await h.settle(); await toggleMdns(h, 'ipv4', true);
    // ... but Cancel returns to the saved state and forgets it.
    h.attr('data-antidetect-cancel').props.onClick(); await h.settle();
    assert.equal(mdnsBox(h, 'ipv4').props.checked, true); assert.equal(dirtyOf(h), false);
    await toggleMdns(h, 'ipv4', false); assert.equal(hostInput(h, 'ipv4').props.value, '', 'no stale literal from before Cancel');
    h.attr('data-antidetect-cancel').props.onClick(); await h.settle();
    // Disabling the whole override keeps the dormant choice visible, as it does for literals; Save of an unchanged draft writes nothing.
    h.attr('data-antidetect-addresses-enabled').props.onChange({ currentTarget: { checked: false } }); await h.settle();
    assert.equal(mdnsBox(h, 'ipv4').props.checked, true, 'the dormant choice stays shown'); assert.equal(hostInput(h, 'ipv4').props.disabled, true);
    h.attr('data-antidetect-cancel').props.onClick(); await h.settle(); assert.equal(h.s.writes().length, 0);
    // Refreshing re-reads the saved choice.
    await h.attr('data-antidetect-refresh').props.onClick(); await h.settle(); assert.equal(mdnsBox(h, 'ipv4').props.checked, true); assert.equal(h.s.writes().length, 0);
  } finally { h.unmount(); }
  // Toggling back to the saved value leaves nothing to save.
  const t = server(), g = harness({ server: t });
  try { g.render(); await g.settle(); await toggleMdns(g, 'ipv4', true); await saveDraft(g); await toggleMdns(g, 'ipv4', false); assert.equal(g.attr('data-antidetect-save').props.disabled, false); await toggleMdns(g, 'ipv4', true); assert.equal(dirtyOf(g), false, 'back to the saved value is clean'); assert.equal(g.attr('data-antidetect-save').props.disabled, true); }
  finally { g.unmount(); }
});

test('the Network level styles the mDNS choice inside the management scope with logical properties only', () => {
  const source = readFileSync(new URL('../../apps/production-extension/antidetect-ui.css', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('/* Catalog 8 host choice')).replace(/\/\*[\s\S]*?\*\//gu, '');
  const selectors = [...block.matchAll(/([^{}]+)\{/gu)].map(match => match[1].trim()); assert.ok(selectors.length >= 4);
  for (const selector of selectors) assert.match(selector, /^\.management-shell\s+\.antidetect-family\s/u, selector);
  assert.doesNotMatch(block, /(?:margin|padding|border)-(?:left|right)|text-align\s*:\s*(?:left|right)|(?:^|[\s;{])(?:left|right)\s*:/u);
});

test('ADR-107 network addresses: a press on another control shows the mark only after its click; leaving by keyboard marks at once', async () => {
  const listeners = new Map(), doc = { addEventListener(type, listener, capture) { assert.equal(capture, true); if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(listener); } };
  const fire = type => { for (const listener of listeners.get(type) ?? []) listener({ type }); }, target = { ownerDocument: doc };
  const h = harness({ locale: 'en' }), own = antidetectEditorLabels('en');
  const field = key => h.attr('data-antidetect-address', key), error = key => h.attr('data-antidetect-address-error', key);
  try {
    h.render(); await h.settle();
    input(h, 'ipv4:host', '999.1.1.1'); await h.settle(); field('ipv4:host').props.onFocus({ currentTarget: target });
    assert.deepEqual([...listeners.keys()].sort(), ['keydown', 'pointercancel', 'pointerdown', 'pointerup'], 'the focused field watches its document');
    fire('pointerdown'); field('ipv4:host').props.onBlur({ currentTarget: target }); await h.settle();
    assert.equal(error('ipv4:host'), undefined, 'nothing moves under a pressed pointer'); assert.equal(field('ipv4:host').props['aria-invalid'], undefined);
    fire('pointerup'); h.render(); assert.equal(error('ipv4:host'), undefined, 'the click of that release comes first');
    await new Promise(resolve => setTimeout(resolve, 5)); await h.settle();
    assert.equal(field('ipv4:host').props['aria-invalid'], 'true'); assert.equal(error('ipv4:host').props.children, own.errorIpv4);
    input(h, 'ipv6:turn', '198.51.100.20'); await h.settle(); field('ipv6:turn').props.onBlur({ currentTarget: target }); h.render();
    assert.equal(error('ipv6:turn').props.children, own.errorFamily, 'leaving by keyboard marks at once');
  } finally { h.unmount(); }
});
