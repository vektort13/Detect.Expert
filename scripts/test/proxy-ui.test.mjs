// ADR-070 / E22-25: proxy actions, optional permission gestures and transient credentials.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { createProxyUi, proxyVisibleProfiles, proxySortedProfiles, proxyProfileDraft, proxyDraftFromBundle, proxyProfileInput, proxyBulkInput } from '../../apps/production-extension/proxy-ui.js';
import { createDefaultProxyConfiguration, PROXY_LIMITS, PROXY_LIST_LIMITS, PROXY_COMPANION_DOWNLOAD_URL } from '../../apps/production-extension/proxy-shared.js';
import { createProxyHistoryStore, PROXY_HISTORY_KEY } from '../../apps/production-extension/proxy-history.js';
import { PROXY_WORKSPACE_KEYS, PROXY_WORKSPACE_MESSAGES, applyProxyCopy } from '../production-locales-proxy.mjs';
import { applyBrowserDebugCopy } from '../production-locales-browser-debug.mjs';
import { PROXY_UI_FIELDS } from '../production-locales-proxy-ui.mjs';
import { PROXY_VIEW_KEY } from '../../apps/production-extension/proxy-ui-model.js';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';
import { GEO_COLUMNS, defaultGeoSettings, geoEmptyFlags } from '../../apps/production-extension/proxy-geo-shared.js';
import { GEO_BANNER_KEY } from '../../apps/production-extension/proxy-geo-ui-model.js';
import { GEO_MANAGER_LABELS } from '../../apps/production-extension/proxy-geo-manager-labels.js';

const turn = () => new Promise(resolve => setImmediate(resolve));
const direct = { id: 'direct', name: 'Direct SOCKS', type: 'socks5', host: 'proxy.example.test', port: 1080, native: false };
const native = { id: 'native-vless', name: 'VLESS profile', type: 'vless', host: 'relay.example.test', port: 443, native: true };
const uri = 'vless://5e7b5c1f-8b45-4e1f-9b9d-0eed6882f4cc@relay.example.test:443?encryption=none&security=tls&type=tcp#Example';
function server() {
  const calls = [], state = { snapshot: { configuration: { ...createDefaultProxyConfiguration(), profiles: [direct, native] }, status: { state: 'off' } }, onChange: null, failure: null, pendingSave: null, pendingGrant: null, pendingDiagnostic: null, diagnosticResult: null, pendingCheck: null, pendingExport: null, checkResults: {}, connections: {}, clipboardFailure: false };
  const track = (name, value) => { calls.push({ name, value }); if (state.failure?.name === name) throw Object.assign(Error('UNTRUSTED_NATIVE_TEXT_CANARY'), { code: state.failure.code, phase: state.failure.phase, retryable: state.failure.retryable }); };
  const client = {
    async load() { track('load'); return state.snapshot; },
    async restartNative() { track('restartNative'); return state.snapshot; },
    requestAccess(options) { track('requestAccess', options); return state.pendingGrant ?? Promise.resolve(state.snapshot); },
    async saveProfile(input) { track('saveProfile', structuredClone(input)); if (state.pendingSave) return state.pendingSave; const existing = state.snapshot.configuration.profiles.find(value => value.id === input.id), metadataOnly = existing && !['username', 'password', 'uri', 'config'].some(key => key in input), country = Object.hasOwn(input, 'country') ? input.country : existing?.country; const profile = { id: input.id ?? 'saved', name: input.name, type: input.type, host: input.host ?? 'relay.example.test', port: input.port ?? 443, native: metadataOnly ? existing.native : !['socks5', 'http', 'https'].includes(input.type) || Boolean(input.username), ...(country ? { country } : {}) }; state.snapshot = { ...state.snapshot, configuration: { ...state.snapshot.configuration, revision: state.snapshot.configuration.revision + 1, selectedId: state.snapshot.configuration.selectedId ?? profile.id, profiles: [...state.snapshot.configuration.profiles.filter(value => value.id !== profile.id), profile] } }; return state.snapshot; },
    async deleteProfile(id) { track('deleteProfile', id); state.snapshot = { ...state.snapshot, configuration: { ...state.snapshot.configuration, profiles: state.snapshot.configuration.profiles.filter(profile => profile.id !== id) } }; return state.snapshot; },
    async saveSettings(configuration) { track('saveSettings', configuration); state.snapshot = { ...state.snapshot, configuration: { ...configuration, revision: configuration.revision + 1 } }; return state.snapshot; },
    async connect(id) { track('connect', id); state.snapshot = { ...state.snapshot, configuration: { ...state.snapshot.configuration, enabled: true, selectedId: id }, status: { state: 'connected', profileId: id } }; return state.snapshot; },
    async disconnect() { track('disconnect'); state.snapshot = { ...state.snapshot, configuration: { ...state.snapshot.configuration, enabled: false }, status: { state: 'off' } }; return state.snapshot; },
    async hostStatus() { track('hostStatus'); state.snapshot = { ...state.snapshot, host: { available: true, version: 1, capabilities: state.hostCapabilities ?? { socks5: true, vless: true, openvpn: true, vault: true } } }; return state.snapshot; },
    async diagnose(url) { track('diagnose', url); if (state.pendingDiagnostic) return state.pendingDiagnostic; const diagnostic = state.diagnosticResult ?? { state: 'pass', reachable: true, remoteDns: true, tlsVerified: true, httpStatus: 200, ip: '203.0.113.41', elapsedMs: 42 }; state.snapshot = { ...state.snapshot, diagnostic }; return state.snapshot; },
    async checkProfile(input) { track('checkProfile', structuredClone(input)); if (state.pendingCheck) return typeof state.pendingCheck === 'function' ? state.pendingCheck(input) : state.pendingCheck; return { profileId: input.id, diagnostic: state.checkResults[input.id] ?? { state: 'pass', reachable: true, remoteDns: true, tlsVerified: true, httpStatus: 200, ip: '203.0.113.117', elapsedMs: 17 } }; },
    async exportProfiles(id) {
      track('exportProfiles', id); if (state.pendingExport) return state.pendingExport;
      const configuration = state.snapshot.configuration, profiles = configuration.profiles.filter(profile => id === null || profile.id === id).map(profile => ({ ...profile, connection: structuredClone(state.connections[profile.id] ?? (profile.type === 'socks5' ? { type: 'socks5', host: profile.host, port: profile.port, username: '', password: '' } : profile.type === 'vless' ? { type: 'vless', uri } : { type: 'openvpn', config: 'client\nremote vpn.example.test 1194\n', username: '', password: '' })) }));
      return { format: 'detect.expert.proxy.bundle', version: 1, revision: configuration.revision, selectedId: profiles.some(profile => profile.id === configuration.selectedId) ? configuration.selectedId : null, enabled: configuration.enabled && profiles.some(profile => profile.id === configuration.selectedId), routing: structuredClone(configuration.routing), protectWebRTC: configuration.protectWebRTC, disablePrediction: configuration.disablePrediction, autoConnect: configuration.autoConnect, killSwitch: configuration.killSwitch, profiles };
    },
    dispose() { track('dispose'); },
  };
  return { calls, state, client, count: name => calls.filter(call => call.name === name).length };
}
function harness({ source = server(), locale = 'en', props: initial = {}, runtimeId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', history = null, browser = null, geoController = null, createGeo = null } = {}) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document'), previousAdd = Object.getOwnPropertyDescriptor(globalThis, 'addEventListener'), previousRemove = Object.getOwnPropertyDescriptor(globalThis, 'removeEventListener'), listeners = new Map(), windowListeners = new Map(), document = { visibilityState: 'visible', addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name, fn) { if (listeners.get(name) === fn) listeners.delete(name); } };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  Object.defineProperty(globalThis, 'addEventListener', { configurable: true, value: (name, fn) => windowListeners.set(name, fn) });
  Object.defineProperty(globalThis, 'removeEventListener', { configurable: true, value: (name, fn) => { if (windowListeners.get(name) === fn) windowListeners.delete(name); } });
  const slots = [], effects = [], downloads = [], clipboard = [], announcements = [], table = applyProxyCopy(applyBrowserDebugCopy({}, locale), locale); let cursor = 0, dirty = true, tree, props = { active: true, ...initial };
  const hooks = {
    useState(initialValue) { const slot = slots[cursor++] ??= { value: typeof initialValue === 'function' ? initialValue() : initialValue }; return [slot.value, next => { const value = typeof next === 'function' ? next(slot.value) : next; if (!Object.is(value, slot.value)) { slot.value = value; dirty = true; } }]; },
    useRef(initialValue) { return (slots[cursor++] ??= { ref: { current: initialValue } }).ref; },
    useEffect(callback, dependencies) { const slot = slots[cursor++] ??= {}; if (!slot.dependencies || dependencies?.some((value, index) => !Object.is(value, slot.dependencies[index]))) { slot.dependencies = dependencies; effects.push(() => { slot.cleanup?.(); slot.cleanup = callback(); }); } },
  };
  const { ProxyApp } = createProxyUi({ ...hooks, h: (type, properties) => ({ type, props: properties }), useLocale: () => locale, translate: key => table[key]?.message ?? key, browserApi: { runtime: { id: runtimeId }, ...(browser ?? {}) }, createClient: (_api, options) => { source.state.onChange = options.onChange; return source.client; }, downloadFile: (filename, text) => downloads.push({ filename, text }), writeClipboard: async text => { if (source.state.clipboardFailure) throw Error('UNTRUSTED_CLIPBOARD_ERROR'); clipboard.push(text); }, announce: message => announcements.push(message), ...(history ? { createHistory: () => history } : {}), ...(geoController ? { geoController } : {}), ...(createGeo ? { createGeo } : {}) });
  function render() { cursor = 0; dirty = false; tree = ProxyApp(props); while (effects.length) effects.shift()(); return tree; }
  async function settle() { for (let index = 0; index < 8; index++) { if (dirty) render(); await turn(); } if (dirty) render(); return tree; }
  function nodes(predicate) { const found = []; function visit(node) { if (Array.isArray(node)) return node.forEach(visit); if (!node?.props) return; if (predicate(node)) found.push(node); visit(node.props.children); } visit(tree); return found; }
  const attr = (key, value = true) => nodes(node => node.props[key] === value)[0];
  function text(node) { if (arguments.length === 0) node = tree; if (Array.isArray(node)) return node.map(value => text(value)).join(' '); if (node?.props) return text(node.props.children); return typeof node === 'string' || typeof node === 'number' ? String(node) : ''; }
  return { source, render, settle, nodes, attr, text, downloads, clipboard, announcements, table, slots,
    update(next) { props = { ...props, ...next }; dirty = true; render(); },
    hide() { document.visibilityState = 'hidden'; listeners.get('visibilitychange')?.(); },
    show() { document.visibilityState = 'visible'; listeners.get('visibilitychange')?.(); },
    pagehide() { windowListeners.get('pagehide')?.(); }, pageshow() { windowListeners.get('pageshow')?.(); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); for (const [key, descriptor] of [['document', previous], ['addEventListener', previousAdd], ['removeEventListener', previousRemove]]) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } },
  };
}
// Round 5 redesign: some controls live behind a disclosure (the row menu, the Add sheet, a route-card section). The helpers below do the
// click a person would do to reach them, so every test still drives the real control by its hook. Opening is synchronous: the
// harness renders between the steps.
const hook = (harness, key) => harness.nodes(node => node.props && key in node.props)[0];
const ROW_MENU = new Set(['data-proxy-edit', 'data-proxy-copy-profile', 'data-proxy-remove', 'data-proxy-duplicate']);
const ANALYZER = new Set(['data-proxy-check', 'data-proxy-check-target', 'data-proxy-check-results', 'data-proxy-check-failure', 'data-proxy-check-ip', 'data-proxy-check-state']);
const ROUTING = new Set(['data-proxy-domain-input', 'data-proxy-local', 'data-proxy-grant-privacy']);
const COMPANION = new Set(['data-proxy-grant-native', 'data-proxy-companion-check', 'data-proxy-companion-status']);
function openPanel(harness, name) { if (!harness.attr('data-proxy-panel-body', name)) { harness.attr('data-proxy-panel', name).props.onClick(); harness.render(); } }
function openNew(harness, type = 'socks5') { if (!hook(harness, 'data-proxy-editor')) { harness.attr('data-proxy-new').props.onClick(); harness.render(); } if (type !== 'socks5' || harness.attr('data-proxy-type-option', type)) { harness.attr('data-proxy-type-option', type).props.onClick(); harness.render(); } }
function openPeek(harness, id) { if (!harness.attr('data-proxy-peek', id)) { harness.attr('data-proxy-open', id).props.onClick(); harness.render(); } return harness.attr('data-proxy-peek', id); }
const historyEntries = harness => harness.nodes(node => node.props && 'data-proxy-history-entry' in node.props).length;
function chooseType(harness, type) { harness.attr('data-proxy-type-option', type).props.onClick(); harness.render(); }
function reveal(harness, attribute, value) {
  if (ROW_MENU.has(attribute)) { harness.attr('data-proxy-more', value).props.onClick(); harness.render(); }
  else if (ANALYZER.has(attribute)) openPanel(harness, 'analyzer');
  else if (ROUTING.has(attribute)) openPanel(harness, 'routing');
  else if (COMPANION.has(attribute)) openPanel(harness, 'companion');
  else if (attribute === 'data-proxy-bulk-open') { harness.attr('data-proxy-menu', 'add').props.onClick(); harness.render(); }
  else if (attribute === 'data-proxy-copy-all') { harness.attr('data-proxy-menu', 'list').props.onClick(); harness.render(); }
  return harness.attr(attribute, value);
}
function click(harness, attribute, value = true) {
  if (attribute === 'data-proxy-new-type') return openNew(harness, value);
  const node = harness.attr(attribute, value) ?? reveal(harness, attribute, value);
  return node.props.onClick();
}
const input = (harness, attribute, value, attributeValue = true) => (harness.attr(attribute, attributeValue) ?? reveal(harness, attribute, attributeValue)).props.onInput({ currentTarget: { value } });
async function opened(options) { const current = harness(options); current.render(); await current.settle(); return current; }

test('all 21 Proxy catalogs are complete, authored, and contain no locale fallback', () => {
  assert.equal(PROXY_WORKSPACE_KEYS.length, 166 + PROXY_UI_FIELDS.length);
  assert.equal(new Set(PROXY_WORKSPACE_KEYS).size, PROXY_WORKSPACE_KEYS.length);
  for (const language of PRODUCTION_LANGUAGES) {
    assert.deepEqual(Object.keys(PROXY_WORKSPACE_MESSAGES[language.id]).sort(), [...PROXY_WORKSPACE_KEYS].sort());
    assert.ok(PROXY_WORKSPACE_MESSAGES[language.id].proxy_workspace_subtitle.trim());
    if (language.id !== 'en') assert.notEqual(PROXY_WORKSPACE_MESSAGES[language.id].proxy_workspace_subtitle, PROXY_WORKSPACE_MESSAGES.en.proxy_workspace_subtitle);
  }
  assert.throws(() => applyProxyCopy({}, 'unknown'));
});

test('empty Proxy master opens profile setup from every panel without permission, connection or storage writes', async () => {
  for (const panel of ['profiles', 'routing', 'companion']) {
    const source = server(); source.state.snapshot.configuration.profiles = []; const current = await opened({ source });
    try {
      if (panel !== 'profiles') { click(current, 'data-proxy-panel', panel); await current.settle(); }
      assert.equal(current.attr('data-proxy-master').props.disabled, false);
      assert.equal(current.attr('data-proxy-master').props['aria-checked'], false);
      assert.equal(current.attr('data-proxy-master').props['aria-describedby'], 'proxy-setup-hint');
      assert.equal(current.text(current.attr('data-proxy-setup-hint')), current.table.proxy_workspace_setup_required.message);
      await click(current, 'data-proxy-master'); await current.settle();
      assert.ok(current.attr('data-proxy-editor', 'socks5'));
      assert.ok(current.attr('data-proxy-save-profile')); assert.ok(current.attr('data-proxy-field', 'host'));
      assert.equal(current.attr('data-proxy-field', 'host').props.value, '');
      for (const name of ['requestAccess', 'connect', 'saveProfile', 'saveSettings', 'hostStatus']) assert.equal(source.count(name), 0);
      assert.equal(source.state.snapshot.configuration.enabled, false);
    } finally { current.unmount(); }
  }
});

test('repeated empty-master clicks preserve the current draft; explicit Save prepares but never connects the first profile', async () => {
  const source = server(); source.state.snapshot.configuration.profiles = []; const current = await opened({ source });
  try {
    await click(current, 'data-proxy-master'); await current.settle();
    for (const [key, value] of [['name', 'Local profile'], ['host', '127.0.0.1'], ['port', '1080']]) input(current, 'data-proxy-field', value, key);
    await current.settle(); await click(current, 'data-proxy-master'); await current.settle();
    assert.equal(current.attr('data-proxy-field', 'name').props.value, 'Local profile');
    await click(current, 'data-proxy-save-profile'); await current.settle();
    assert.equal(source.count('saveProfile'), 1); assert.equal(source.count('connect'), 0); assert.equal(source.count('requestAccess'), 0);
    assert.equal(source.state.snapshot.configuration.selectedId, 'saved'); assert.equal(source.state.snapshot.configuration.enabled, false);
    assert.match(current.text(current.attr('data-workspace-master', 'proxy')), /Local profile/);
    assert.equal(current.attr('data-proxy-setup-hint'), undefined);
    await click(current, 'data-proxy-master'); await current.settle();
    assert.equal(source.count('connect'), 1); assert.equal(source.calls.find(row => row.name === 'connect').value, 'saved');
  } finally { current.unmount(); }
});

test('empty-master cancel and hidden or obsolete callbacks never create a profile or connect', async () => {
  const source = server(); source.state.snapshot.configuration.profiles = []; const current = await opened({ source });
  try {
    const oldClick = current.attr('data-proxy-master').props.onClick;
    await oldClick(); await current.settle(); click(current, 'data-proxy-cancel'); await current.settle();
    assert.equal(current.attr('data-proxy-save-profile'), undefined); assert.equal(source.count('saveProfile'), 0);
    current.hide(); await current.settle(); await oldClick(); await current.settle(); assert.equal(current.attr('data-proxy-save-profile'), undefined);
    assert.equal(source.count('connect'), 0); assert.equal(source.count('requestAccess'), 0);
  } finally { current.unmount(); }
});

test('existing profiles without a selected target lead to the list without choosing or starting any profile', async () => {
  const current = await opened(); try {
    click(current, 'data-proxy-panel', 'companion'); await current.settle();
    await click(current, 'data-proxy-master'); await current.settle();
    assert.ok(current.attr('data-proxy-manager'));
    assert.equal(current.attr('data-proxy-save-profile'), undefined);
    assert.equal(current.text(current.attr('data-proxy-setup-hint')), current.table.proxy_workspace_choose_profile.message);
    assert.equal(current.source.state.snapshot.configuration.selectedId, null);
    assert.equal(current.source.count('connect'), 0); assert.equal(current.source.count('requestAccess'), 0);
  } finally { current.unmount(); }
});

test('unloaded Proxy remains disabled and a retained master callback cannot treat it as an empty configuration', async () => {
  const source = server(); source.state.snapshot = { configuration: null, status: { state: 'off' } }; const current = await opened({ source });
  try {
    assert.equal(current.attr('data-proxy-master').props.disabled, true);
    await click(current, 'data-proxy-master'); await current.settle();
    assert.equal(current.attr('data-proxy-save-profile'), undefined);
    assert.equal(source.count('connect'), 0); assert.equal(source.count('requestAccess'), 0);
  } finally { current.unmount(); }
});
test('metadata filtering never reads credentials; editor clones no secret fields from saved profiles', () => {
  const poisoned = { ...native, get password() { throw Error('secret read'); }, get uri() { throw Error('secret read'); } };
  assert.deepEqual(proxyVisibleProfiles([direct, poisoned], 'VLESS', 'vless').map(profile => profile.id), ['native-vless']);
  assert.deepEqual(proxyVisibleProfiles([direct, poisoned], 'proxy.example', 'all').map(profile => profile.id), ['direct']);
  const draft = proxyProfileDraft(poisoned); assert.equal(draft.password, ''); assert.equal(draft.uri, ''); assert.equal(draft.config, '');
});
test('profile input rejects invalid ports/hosts and preserves native vault by omitting empty secret keys', () => {
  const base = { ...proxyProfileDraft(), name: 'Proxy', host: 'proxy.example.test' };
  assert.deepEqual(proxyProfileInput(base), { name: 'Proxy', type: 'socks5', host: 'proxy.example.test', port: 1080 });
  for (const port of ['', '0', '65536', '1e3', '-1', '1.5']) assert.equal(proxyProfileInput({ ...base, port }), null);
  for (const host of ['https://host', 'u:p@host', 'host/path', 'host?key']) assert.equal(proxyProfileInput({ ...base, host }), null);
  assert.equal(proxyProfileInput({ ...base, name: ' ' }), null);
  assert.deepEqual(proxyProfileInput({ ...proxyProfileDraft(native), name: 'Renamed' }), { id: native.id, name: 'Renamed', type: 'vless' });
  assert.deepEqual(proxyProfileInput({ ...proxyProfileDraft(null, 'openvpn'), id: 'saved', name: 'VPN' }), { id: 'saved', name: 'VPN', type: 'openvpn' });
  assert.equal(proxyProfileInput({ ...proxyProfileDraft(null, 'vless'), name: 'V', uri: 'not-a-link' }), null);
  assert.equal(proxyProfileInput({ ...proxyProfileDraft(null, 'vless'), name: 'V', uri }).uri, uri);
});
test('mount loads local metadata only; visiting Companion never probes host or grants access', async () => {
  const current = await opened(); try {
    assert.equal(current.source.count('load'), 1); assert.equal(current.source.count('connect'), 0); assert.equal(current.source.count('hostStatus'), 0); assert.equal(current.source.count('requestAccess'), 0);
    click(current, 'data-proxy-panel', 'companion'); await current.settle(); assert.ok(current.attr('data-proxy-companion-status', 'unknown'));
    assert.equal(current.source.count('hostStatus'), 0); assert.match(current.text(), /Install\.ps1 -ChromeExtensionId a{32}/);
    assert.doesNotMatch(current.text(), /UNTRUSTED_NATIVE_TEXT_CANARY/);
  } finally { current.unmount(); }
});
test('native and privacy grants invoke the native permission method on the original click stack', async () => {
  const current = await opened(); try {
    click(current, 'data-proxy-panel', 'companion'); await current.settle();
    const pending = click(current, 'data-proxy-grant-native'); assert.equal(current.source.count('requestAccess'), 1); assert.deepEqual(current.source.calls.at(-1).value, { native: true }); await pending; await current.settle();
    click(current, 'data-proxy-panel', 'routing'); await current.settle();
    const privacy = click(current, 'data-proxy-grant-privacy'); assert.equal(current.source.count('requestAccess'), 2); assert.deepEqual(current.source.calls.at(-1).value, { privacy: true }); await privacy;
    assert.equal(current.source.count('connect'), 0);
  } finally { current.unmount(); }
});
test('explicit companion check shows only returned capabilities, version and factual status', async () => {
  const current = await opened(); try {
    click(current, 'data-proxy-panel', 'companion'); await current.settle(); await click(current, 'data-proxy-companion-check'); await current.settle();
    assert.equal(current.source.count('hostStatus'), 1); assert.ok(current.attr('data-proxy-companion-status', 'available')); assert.match(current.text(), /Version 1/); assert.match(current.text(), /SOCKS5, VLESS, OpenVPN/);
  } finally { current.unmount(); }
});
test('manual SOCKS credentials remain in the masked RAM draft until Save succeeds while metadata renders no secrets', async () => {
  const source = server(); let complete; source.state.pendingSave = new Promise(resolve => { complete = resolve; }); const current = await opened({ source });
  try {
    click(current, 'data-proxy-new-type', 'socks5'); await current.settle();
    for (const [key, value] of Object.entries({ name: 'My proxy', host: 'proxy.example.test', port: '1081', username: 'LOGIN_CANARY', password: 'PASSWORD_CANARY' })) input(current, 'data-proxy-field', value, key);
    await current.settle(); assert.equal(current.attr('data-proxy-field', 'password').props.type, 'password');
    const pending = click(current, 'data-proxy-save-profile'); await current.settle();
    assert.equal(source.count('saveProfile'), 1); assert.equal(current.attr('data-proxy-field', 'password').props.value, 'PASSWORD_CANARY'); assert.equal(current.attr('data-proxy-field', 'username').props.value, 'LOGIN_CANARY');
    assert.equal(source.calls.find(call => call.name === 'saveProfile').value.password, 'PASSWORD_CANARY');
    assert.doesNotMatch(current.text(), /PASSWORD_CANARY|LOGIN_CANARY/);
    complete(source.state.snapshot); await pending; await current.settle(); assert.equal(current.attr('data-proxy-editor', 'socks5'), undefined);
    assert.doesNotMatch(JSON.stringify(current.slots.map(slot => slot?.value ?? slot?.ref?.current)), /PASSWORD_CANARY|LOGIN_CANARY/);
    assert.equal(source.count('connect'), 0);
  } finally { current.unmount(); }
});
test('smart paste masks source credentials, parses SOCKS and clears source without connecting', async () => {
  const current = await opened(); try {
    click(current, 'data-proxy-new'); await current.settle(); input(current, 'data-proxy-field', 'Imported', 'name');
    input(current, 'data-proxy-paste', 'socks5://LOGIN_CANARY:PASSWORD_CANARY@proxy.example.test:2345'); await current.settle();
    assert.equal(current.attr('data-proxy-paste').props.type, 'password'); click(current, 'data-proxy-parse'); await current.settle();
    assert.equal(current.attr('data-proxy-paste').props.value, ''); assert.equal(current.attr('data-proxy-field', 'host').props.value, 'proxy.example.test'); assert.equal(current.attr('data-proxy-field', 'port').props.value, '2345'); assert.equal(current.attr('data-proxy-field', 'password').props.value, 'PASSWORD_CANARY'); assert.equal(current.attr('data-proxy-field', 'name').props.value, 'Imported');
    assert.equal(current.source.count('saveProfile') + current.source.count('connect'), 0);
  } finally { current.unmount(); }
});
test('VLESS is masked, Markdown escapes normalize through the shared parser, and save clears link', async () => {
  const current = await opened(); try {
    click(current, 'data-proxy-new-type', 'vless'); await current.settle(); input(current, 'data-proxy-field', 'VLESS', 'name'); input(current, 'data-proxy-field', uri.replace('vless:', 'vless\\:'), 'uri'); await current.settle();
    assert.equal(current.attr('data-proxy-field', 'uri').props.type, 'password'); await click(current, 'data-proxy-save-profile'); await current.settle();
    assert.equal(current.source.calls.find(call => call.name === 'saveProfile').value.uri, uri); assert.doesNotMatch(current.text(), /5e7b5c1f/); assert.equal(current.source.count('connect'), 0);
  } finally { current.unmount(); }
});
test('OpenVPN file is bounded, only fills the current editor, and credentials clear on tab change', async () => {
  const current = await opened(); let complete;
  try {
    click(current, 'data-proxy-new-type', 'openvpn'); await current.settle();
    const target = { files: [{ size: 50, text: () => new Promise(resolve => { complete = resolve; }) }], value: 'file' };
    const pending = current.attr('data-proxy-file').props.onChange({ currentTarget: target }); assert.equal(target.value, '');
    current.update({ active: false }); await current.settle(); complete('remote SECRET_CONFIG_CANARY 1194'); await pending; await current.settle();
    assert.equal(current.attr('data-proxy-editor', 'openvpn'), undefined); assert.doesNotMatch(JSON.stringify(current.slots.map(slot => slot?.value)), /SECRET_CONFIG_CANARY/);
    current.update({ active: true }); await current.settle(); click(current, 'data-proxy-new-type', 'openvpn'); await current.settle();
    const large = { files: [{ size: 1024 * 1024 + 1, text: () => { throw Error('must not read'); } }], value: 'file' };
    await current.attr('data-proxy-file').props.onChange({ currentTarget: large }); await current.settle(); assert.ok(current.attr('data-proxy-error')); assert.equal(current.source.count('saveProfile'), 0);
    input(current, 'data-proxy-field', 'OVPN_CANARY', 'config'); input(current, 'data-proxy-field', 'PASS_CANARY', 'password'); await current.settle(); current.update({ active: false }); await current.settle();
    assert.doesNotMatch(JSON.stringify(current.slots.map(slot => slot?.value)), /OVPN_CANARY|PASS_CANARY/);
  } finally { current.unmount(); }
});
test('visibility hide clears all unsaved secrets and ignores late Save replies', async () => {
  const source = server(); let complete; source.state.pendingSave = new Promise(resolve => { complete = resolve; }); const current = await opened({ source });
  try {
    click(current, 'data-proxy-new'); await current.settle();
    for (const [key, value] of Object.entries({ name: 'P', host: 'proxy.example.test', password: 'PASSWORD_CANARY', username: 'LOGIN_CANARY' })) input(current, 'data-proxy-field', value, key);
    await current.settle(); const pending = click(current, 'data-proxy-save-profile'); current.hide(); await current.settle(); complete({ ...source.state.snapshot, host: { available: true, version: 'LATE_REPLY_CANARY' } }); await pending; await current.settle();
    assert.doesNotMatch(JSON.stringify(current.slots.map(slot => slot?.value)), /PASSWORD_CANARY|LOGIN_CANARY|LATE_REPLY_CANARY/);
    current.show(); await current.settle(); assert.equal(source.count('load'), 2); assert.equal(source.count('connect'), 0);
  } finally { current.unmount(); }
});
test('native Save permission denial retains the masked draft and retry saves the same authenticated SOCKS profile', async () => {
  const source = server(); source.state.failure = { name: 'requestAccess', code: 'permission-denied' }; const current = await opened({ source });
  try {
    click(current, 'data-proxy-new-type', 'socks5'); await current.settle();
    for (const [key, value] of Object.entries({ name: 'Retry auth proxy', host: 'proxy.example.test', port: '1081', username: 'RETRY_LOGIN_CANARY', password: 'RETRY_PASSWORD_CANARY' })) input(current, 'data-proxy-field', value, key);
    await current.settle();
    const pending = click(current, 'data-proxy-save-profile'); assert.equal(source.count('requestAccess'), 1); await pending; await current.settle();
    assert.equal(source.count('saveProfile'), 0); assert.equal(current.attr('data-proxy-field', 'username').props.value, 'RETRY_LOGIN_CANARY'); assert.equal(current.attr('data-proxy-field', 'password').props.value, 'RETRY_PASSWORD_CANARY'); assert.equal(current.attr('data-proxy-field', 'password').props.type, 'password'); assert.ok(current.attr('data-proxy-error')); assert.doesNotMatch(current.text(), /UNTRUSTED_NATIVE_TEXT_CANARY|RETRY_LOGIN_CANARY|RETRY_PASSWORD_CANARY/);
    assert.equal(current.slots.filter(slot => slot?.ref?.current?.password === 'RETRY_PASSWORD_CANARY' && !Object.hasOwn(slot.ref.current, 'id')).length, 0, 'dispatched private payload cleared after denial while the editor draft remains available');
    source.state.failure = null;
    await click(current, 'data-proxy-save-profile'); await current.settle();
    assert.equal(source.count('requestAccess'), 2); assert.equal(source.count('saveProfile'), 1);
    assert.deepEqual(source.calls.find(call => call.name === 'saveProfile').value, { name: 'Retry auth proxy', type: 'socks5', host: 'proxy.example.test', port: 1081, username: 'RETRY_LOGIN_CANARY', password: 'RETRY_PASSWORD_CANARY' });
    assert.equal(source.state.snapshot.configuration.profiles.find(profile => profile.id === 'saved').native, true, 'retry cannot silently downgrade to unauthenticated SOCKS');
    assert.equal(current.attr('data-proxy-editor', 'socks5'), undefined); assert.doesNotMatch(JSON.stringify(current.slots.map(slot => slot?.value ?? slot?.ref?.current)), /RETRY_LOGIN_CANARY|RETRY_PASSWORD_CANARY/);
  } finally { current.unmount(); }
});

test('native backend Save failures preserve every protocol draft and retry sends the same credentials or config', async () => {
  for (const [type, fields] of [
    ['socks5', { name: 'Auth retry', host: 'proxy.example.test', port: '1081', username: 'BACKEND_USER_CANARY', password: 'BACKEND_PASSWORD_CANARY' }],
    ['vless', { name: 'VLESS retry', uri }],
    ['openvpn', { name: 'VPN retry', config: 'client\nremote vpn.example.test 1194\nPRIVATE_CONFIG_CANARY', username: 'VPN_USER_CANARY', password: 'VPN_PASSWORD_CANARY' }],
  ]) {
    const source = server(); source.state.failure = { name: 'saveProfile', code: 'native-unavailable' }; const current = await opened({ source });
    try {
      click(current, 'data-proxy-new-type', type); await current.settle();
      for (const [key, value] of Object.entries(fields)) input(current, 'data-proxy-field', value, key);
      await current.settle(); await click(current, 'data-proxy-save-profile'); await current.settle();
      assert.ok(current.attr('data-proxy-error')); assert.ok(current.attr('data-proxy-editor', type));
      for (const [key, value] of Object.entries(fields)) assert.equal(current.attr('data-proxy-field', key).props.value, value);
      const first = source.calls.find(call => call.name === 'saveProfile').value;
      source.state.failure = null;
      await click(current, 'data-proxy-save-profile'); await current.settle();
      assert.equal(source.count('requestAccess'), 2); assert.equal(source.count('saveProfile'), 2);
      assert.deepEqual(source.calls.filter(call => call.name === 'saveProfile')[1].value, first);
      assert.equal(source.state.snapshot.configuration.profiles.find(profile => profile.id === 'saved').native, true);
      assert.equal(current.attr('data-proxy-editor', type), undefined); assert.doesNotMatch(JSON.stringify(current.slots.map(slot => slot?.value ?? slot?.ref?.current)), /BACKEND_USER_CANARY|BACKEND_PASSWORD_CANARY|PRIVATE_CONFIG_CANARY|VPN_USER_CANARY|VPN_PASSWORD_CANARY|5e7b5c1f/);
    } finally { current.unmount(); }
  }
});

test('missing native API after grant shows a localized explicit restart action, retains draft and never writes a UI recovery marker', async () => {
  const previous = new Map(['localStorage', 'sessionStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])), storageCalls = [];
  for (const key of previous.keys()) Object.defineProperty(globalThis, key, { configurable: true, value: { getItem(name) { storageCalls.push([key, 'get', name]); return null; }, setItem(name, value) { storageCalls.push([key, 'set', name, value]); }, removeItem(name) { storageCalls.push([key, 'remove', name]); } } });
  const source = server(); source.state.failure = { name: 'saveProfile', code: 'reconnect-required', phase: 'native', retryable: true }; const current = await opened({ source, locale: 'ru' });
  try {
    const before = structuredClone(source.state.snapshot);
    click(current, 'data-proxy-new-type', 'socks5'); await current.settle();
    for (const [key, value] of Object.entries({ name: 'Recovery auth', host: 'proxy.example.test', port: '1081', username: 'RECOVERY_USER_CANARY', password: 'RECOVERY_PASSWORD_CANARY' })) input(current, 'data-proxy-field', value, key);
    await current.settle(); await click(current, 'data-proxy-save-profile'); await current.settle();
    assert.match(current.text(), /Доступ предоставлен/); assert.match(current.text(), /перезапустите расширение/);
    assert.match(current.text(), /Перезапустить расширение/); assert.doesNotMatch(current.text(), /permission-required|reconnect-required|native \/|UNTRUSTED_NATIVE_TEXT_CANARY|RECOVERY_USER_CANARY|RECOVERY_PASSWORD_CANARY/);
    assert.equal(current.attr('data-proxy-field', 'username').props.value, 'RECOVERY_USER_CANARY'); assert.equal(current.attr('data-proxy-field', 'password').props.value, 'RECOVERY_PASSWORD_CANARY'); assert.equal(current.attr('data-proxy-field', 'password').props.type, 'password');
    assert.equal(source.count('restartNative'), 0); assert.equal(current.attr('data-proxy-restart-native').props.disabled, false);
    assert.deepEqual(source.state.snapshot, before); assert.deepEqual(storageCalls.filter(call => call[2] !== PROXY_VIEW_KEY), []); assert.equal(source.count('connect') + source.count('hostStatus') + source.count('saveSettings'), 0);
    await click(current, 'data-proxy-restart-native'); await current.settle();
    assert.equal(source.count('restartNative'), 1); assert.deepEqual(source.state.snapshot, before); assert.deepEqual(storageCalls.filter(call => call[2] !== PROXY_VIEW_KEY), []);
  } finally {
    current.unmount();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
});

test('native restart is disabled and its handler refuses invocation while a proxy profile is enabled', async () => {
  const source = server(); source.state.snapshot = { configuration: { ...source.state.snapshot.configuration, enabled: true, selectedId: direct.id }, status: { state: 'blocked', profileId: direct.id, code: 'reconnect-required', phase: 'native', retryable: true } }; const current = await opened({ source });
  try {
    const action = current.attr('data-proxy-restart-native'); assert.ok(action); assert.equal(action.props.disabled, true);
    await action.props.onClick(); await current.settle();
    assert.equal(source.count('restartNative'), 0); assert.equal(source.count('disconnect'), 0); assert.equal(source.state.snapshot.configuration.enabled, true);
    assert.doesNotMatch(current.text(), /reconnect-required|native \/|permission-required/);
  } finally { current.unmount(); }
});

test('a captured recovery click cannot restart after hiding, deactivation or unmount', async () => {
  for (const mode of ['hidden', 'inactive', 'unmounted']) {
    const source = server(); source.state.failure = { name: 'saveProfile', code: 'reconnect-required', phase: 'native', retryable: true }; const current = await opened({ source }); let unmounted = false;
    try {
      click(current, 'data-proxy-new-type', 'vless'); await current.settle(); input(current, 'data-proxy-field', 'Recovery VLESS', 'name'); input(current, 'data-proxy-field', uri, 'uri'); await current.settle();
      await click(current, 'data-proxy-save-profile'); await current.settle(); const action = current.attr('data-proxy-restart-native'); assert.ok(action); assert.equal(source.count('restartNative'), 0);
      if (mode === 'hidden') current.hide(); else if (mode === 'inactive') current.update({ active: false }); else { current.unmount(); unmounted = true; }
      if (!unmounted) await current.settle();
      await action.props.onClick(); if (!unmounted) await current.settle();
      assert.equal(source.count('restartNative'), 0); assert.doesNotMatch(JSON.stringify(current.slots.map(slot => slot?.value ?? slot?.ref?.current)), /5e7b5c1f/);
    } finally { if (!unmounted) current.unmount(); }
  }
});

test('failed native rename retains the original editor so retry remains metadata-only', async () => {
  const source = server(); const current = await opened({ source });
  try {
    await click(current, 'data-proxy-edit', native.id); await current.settle(); input(current, 'data-proxy-field', 'Retry rename', 'name'); await current.settle();
    source.state.failure = { name: 'saveProfile', code: 'operation-failed' };
    await click(current, 'data-proxy-save-profile'); await current.settle();
    assert.equal(current.attr('data-proxy-field', 'uri').props.value, uri);
    const permissionCalls = source.count('requestAccess'); source.state.failure = null;
    await click(current, 'data-proxy-save-profile'); await current.settle();
    assert.equal(source.count('requestAccess'), permissionCalls);
    const expected = { id: native.id, name: 'Retry rename', type: 'vless', host: native.host, port: native.port };
    assert.deepEqual(source.calls.filter(call => call.name === 'saveProfile').map(call => call.value), [expected, expected]);
    assert.equal(current.attr('data-proxy-editor', 'vless'), undefined); assert.doesNotMatch(JSON.stringify(current.slots.map(slot => slot?.value ?? slot?.ref?.current)), /5e7b5c1f/);
  } finally { current.unmount(); }
});
test('hiding or deactivating during the native permission prompt aborts deferred Save before credentials are dispatched', async () => {
  for (const mode of ['hidden', 'inactive', 'unmounted']) {
    const source = server(); let grant; source.state.pendingGrant = new Promise(resolve => { grant = resolve; }); const current = await opened({ source }); let unmounted = false;
    try {
      click(current, 'data-proxy-new-type', 'vless'); await current.settle(); input(current, 'data-proxy-field', 'V', 'name'); input(current, 'data-proxy-field', uri, 'uri'); await current.settle(); const pending = click(current, 'data-proxy-save-profile');
      assert.equal(source.count('requestAccess'), 1); assert.equal(source.count('saveProfile'), 0);
      if (mode === 'hidden') current.hide(); else if (mode === 'inactive') current.update({ active: false }); else { current.unmount(); unmounted = true; }
      if (!unmounted) await current.settle();
      grant(source.state.snapshot); await pending; if (!unmounted) await current.settle();
      assert.equal(source.count('saveProfile'), 0); assert.doesNotMatch(JSON.stringify(current.slots.map(slot => slot?.value ?? slot?.ref?.current)), /5e7b5c1f/);
    } finally { if (!unmounted) current.unmount(); }
  }
});
test('BFCache pagehide clears credentials even before visibility changes; pageshow cannot resurrect a late response', async () => {
  const source = server(); let complete; source.state.pendingSave = new Promise(resolve => { complete = resolve; }); const current = await opened({ source });
  try {
    click(current, 'data-proxy-new'); await current.settle(); input(current, 'data-proxy-field', 'Proxy', 'name'); input(current, 'data-proxy-field', 'proxy.example.test', 'host'); await current.settle(); const pending = click(current, 'data-proxy-save-profile');
    current.pagehide(); await current.settle(); source.state.onChange({ ...source.state.snapshot, host: { available: true, version: 'HIDDEN_REPLY_CANARY' } }); complete({ ...source.state.snapshot, host: { available: true, version: 'LATE_REPLY_CANARY' } }); await pending; await current.settle();
    assert.doesNotMatch(JSON.stringify(current.slots.map(slot => slot?.value)), /HIDDEN_REPLY_CANARY|LATE_REPLY_CANARY/); assert.equal(current.attr('data-proxy-editor', 'socks5'), undefined);
    current.pageshow(); await current.settle(); assert.equal(source.count('load'), 2); assert.equal(source.count('connect'), 0);
  } finally { current.unmount(); }
});
test('Connect permission prompt is synchronous and a hidden view never dispatches the deferred connection', async () => {
  const source = server(); let grant; source.state.pendingGrant = new Promise(resolve => { grant = resolve; }); const current = await opened({ source });
  try {
    const pending = click(current, 'data-proxy-connect', native.id); assert.equal(source.count('requestAccess'), 1); assert.deepEqual(source.calls.at(-1).value, { native: true, privacy: true }); current.update({ active: false }); await current.settle(); grant(source.state.snapshot); await pending; await current.settle();
    assert.equal(source.count('connect'), 0); assert.equal(current.attr('data-proxy-state', 'off').props.children[1].props.children, 'Off', 'ADR-103: localized off state');
  } finally { current.unmount(); }
});
test('explicit native Edit reads the current connection into masked fields and keeps protocol locked', async () => {
  const current = await opened(); try {
    assert.equal(current.source.count('exportProfiles'), 0); const pending = click(current, 'data-proxy-edit', native.id); assert.equal(current.source.count('requestAccess'), 1); await pending; await current.settle(); assert.ok(current.nodes(node => node.props['data-proxy-type-option']).every(node => node.props.disabled === true)); assert.equal(current.attr('data-proxy-field', 'uri').props.value, uri); assert.equal(current.attr('data-proxy-field', 'uri').props.type, 'password'); input(current, 'data-proxy-field', 'Renamed', 'name'); await current.settle(); await click(current, 'data-proxy-save-profile'); await current.settle();
    assert.deepEqual(current.source.calls.find(call => call.name === 'saveProfile').value, { id: native.id, name: 'Renamed', type: 'vless', host: native.host, port: native.port });
  } finally { current.unmount(); }
});
test('Connect and Disconnect act only on explicit clicks; duplicate gestures serialize', async () => {
  const current = await opened(); try {
    const pending = click(current, 'data-proxy-connect', direct.id); click(current, 'data-proxy-connect', direct.id); await pending; await current.settle();
    assert.equal(current.source.count('connect'), 1); assert.equal(current.source.calls.find(call => call.name === 'connect').value, direct.id); assert.ok(current.attr('data-proxy-state', 'connected'));
    assert.ok(current.attr('data-proxy-disconnect-profile', direct.id)); assert.equal(current.attr('data-proxy-connect', direct.id), undefined); current.attr('data-proxy-more', direct.id).props.onClick(); current.render(); assert.equal(current.attr('data-proxy-remove', direct.id).props.disabled, true);
    await click(current, 'data-proxy-disconnect'); await current.settle(); assert.equal(current.source.count('disconnect'), 1); assert.ok(current.attr('data-proxy-state', 'off'));
  } finally { current.unmount(); }
});

test('the top Proxy intent switch never chooses a first profile and reuses only the current retained selection', async () => {
  const source = server(), current = await opened({ source });
  try {
    const workspace = current.nodes(node => node.props['data-proxy-workspace'])[0];
    assert.equal(workspace.props.children[0], current.attr('data-proxy-skip'), 'the skip link is the first stop of the section'); assert.equal(workspace.props.children[1], current.attr('data-workspace-master', 'proxy'));
    assert.equal(current.attr('data-proxy-master').props.disabled, false);
    await click(current, 'data-proxy-master'); assert.equal(source.count('requestAccess'), 0); assert.equal(source.count('connect'), 0);
    source.state.snapshot.configuration = { ...source.state.snapshot.configuration, selectedId: native.id };
    source.state.onChange(source.state.snapshot); await current.settle();
    const captured = current.attr('data-proxy-master').props.onClick;
    assert.equal(current.attr('data-proxy-master').props.disabled, false);
    source.state.snapshot.configuration = { ...source.state.snapshot.configuration, selectedId: null };
    source.state.onChange(source.state.snapshot); await current.settle();
    await captured(); assert.equal(source.count('connect'), 0); assert.equal(source.count('requestAccess'), 0, 'a removed retained selection cannot be replayed');
    source.state.snapshot.configuration = { ...source.state.snapshot.configuration, selectedId: direct.id };
    source.state.onChange(source.state.snapshot); await current.settle();
    const pending = click(current, 'data-proxy-master'); assert.equal(source.count('requestAccess'), 1); await pending; await current.settle();
    assert.equal(source.calls.find(call => call.name === 'connect').value, direct.id);
    assert.equal(current.attr('data-proxy-disconnect').props['aria-checked'], true);
    assert.equal(current.attr('data-proxy-disconnect').props.hidden, false);
    await click(current, 'data-proxy-disconnect'); await current.settle();
    assert.equal(source.count('disconnect'), 1); assert.equal(source.state.snapshot.configuration.selectedId, direct.id);
    assert.equal(current.attr('data-proxy-master').props.hidden, false);
  } finally { current.unmount(); }
});

test('Proxy intent ON preserves a blocked effective status and the original cleanup action', async () => {
  const source = server(); source.state.snapshot.configuration = { ...source.state.snapshot.configuration, enabled: true, selectedId: direct.id }; source.state.snapshot.status = { state: 'blocked', profileId: direct.id };
  const current = await opened({ source });
  try {
    assert.equal(current.attr('data-proxy-disconnect').props['aria-checked'], true);
    assert.ok(current.attr('data-proxy-state', 'blocked')); assert.equal(source.count('connect'), 0);
    assert.equal(current.attr('data-proxy-master').props.hidden, true);
    await click(current, 'data-proxy-disconnect'); await current.settle(); assert.equal(source.count('disconnect'), 1);
    assert.equal(source.count('requestAccess'), 0);
  } finally { current.unmount(); }
});
test('deletion needs explicit confirmation and does not connect another profile', async () => {
  const current = await opened(); try {
    click(current, 'data-proxy-remove', native.id); await current.settle(); assert.equal(current.source.count('deleteProfile'), 0); assert.ok(current.attr('data-proxy-removal')); await click(current, 'data-proxy-remove-confirm'); await current.settle();
    assert.equal(current.source.calls.find(call => call.name === 'deleteProfile').value, native.id); assert.equal(current.attr('data-proxy-profile', native.id), undefined); assert.equal(current.source.count('connect'), 0);
  } finally { current.unmount(); }
});
test('route draft preserves revision, explicit include/direct rules, bypass, privacy flags and fixed Kill Switch', async () => {
  const current = await opened(); try {
    openPanel(current, 'routing'); await current.settle(); const kill = current.attr('data-proxy-kill-switch'); assert.equal(kill.props.checked, true); assert.equal(kill.props.disabled, true);
    current.attr('data-proxy-route-mode', 'include').props.onChange(); input(current, 'data-proxy-domain-input', ' owned.example.test\n\n*.third.example.test ', 'proxyDomains'); current.render(); current.attr('data-proxy-domain-input', 'proxyDomains').props.onBlur(); current.render(); input(current, 'data-proxy-domain-input', 'direct.example.test', 'directDomains'); current.render(); current.attr('data-proxy-domain-input', 'directDomains').props.onBlur(); current.render(); current.attr('data-proxy-setting', 'autoConnect').props.onChange({ currentTarget: { checked: true } }); await current.settle(); assert.equal(current.source.count('saveSettings'), 0);
    await click(current, 'data-proxy-save-settings'); await current.settle(); const config = current.source.calls.find(call => call.name === 'saveSettings').value;
    assert.equal(config.revision, 0); assert.equal(config.killSwitch, true); assert.deepEqual(config.routing, { mode: 'include', proxyDomains: ['owned.example.test', '*.third.example.test'], directDomains: ['direct.example.test'], bypassLocal: true }); assert.equal(config.autoConnect, true); assert.equal(config.protectWebRTC, true); assert.equal(config.disablePrediction, true); assert.equal(current.source.count('connect'), 0);
  } finally { current.unmount(); }
});
test('safe diagnostic codes are translated while raw exception text and unknown code strings never render', async () => {
  const source = server(); source.state.failure = { name: 'connect', code: 'auth-failed' }; const current = await opened({ source, locale: 'ru' }); try {
    await click(current, 'data-proxy-connect', direct.id); await current.settle(); assert.match(current.text(), /Ошибка авторизации/); assert.doesNotMatch(current.text(), /UNTRUSTED_NATIVE_TEXT_CANARY/);
    source.state.onChange({ ...source.state.snapshot, status: { state: 'blocked', code: 'dns-failed', phase: 'resolve', retryable: true } }); await current.settle();
    assert.ok(current.attr('data-proxy-diagnostic', 'dns-failed')); assert.match(current.text(), /DNS-имя/); assert.match(current.text(), /resolve \/ dns-failed/);
    source.state.onChange({ ...source.state.snapshot, status: { state: 'error', code: 'SECRET_UNKNOWN_CODE_CANARY' } }); await current.settle(); assert.doesNotMatch(current.text(), /SECRET_UNKNOWN_CODE_CANARY/);
  } finally { current.unmount(); }
});
test('metadata export is explicit, canonical and excludes transient credentials and VLESS links', async () => {
  const current = await opened(); try {
    assert.equal(current.downloads.length, 0); click(current, 'data-proxy-new-type', 'vless'); await current.settle(); input(current, 'data-proxy-field', uri, 'uri'); await current.settle(); click(current, 'data-proxy-export');
    assert.equal(current.downloads.length, 1); const exported = JSON.parse(current.downloads[0].text); assert.equal(exported.format, 'detect.expert.proxy'); assert.equal(exported.profiles.length, 2); assert.doesNotMatch(current.downloads[0].text, /5e7b5c1f|password|username|uri|config\"/); assert.equal(current.source.count('saveProfile'), 0);
  } finally { current.unmount(); }
});
test('inactive workspace does not load or handle queued privileged actions; unmount disposes the client', async () => {
  const source = server(), current = await opened({ source, props: { active: false } });
  assert.equal(source.count('load'), 0); current.update({ active: true }); await current.settle(); assert.equal(source.count('load'), 1);
  const queued = current.attr('data-proxy-connect', direct.id).props.onClick; current.update({ active: false }); await current.settle(); await queued(); assert.equal(source.count('connect'), 0); current.unmount(); assert.equal(source.count('dispose'), 1);
});
test('workspace styles retain narrow screens, RTL logical spacing, dark palettes, focus and reduced motion', async () => {
  const css = await readFile(new URL('../../apps/production-extension/proxy-ui.css', import.meta.url), 'utf8');
  for (const token of ['max-width: 720px','max-width: 480px','forced-colors: active','prefers-reduced-motion: no-preference',':focus-visible','margin-inline-start','padding-inline-start','minmax(0, 1fr)']) assert.ok(css.includes(token), token);
  // ADR-107: the dark palette is light-dark() pairs read through the root color-scheme, i.e. the chosen theme, not the system query.
  assert.doesNotMatch(css, /prefers-color-scheme/u, 'no palette follows the system instead of the chosen theme');
  for (const pair of ['--proxy-tint: light-dark(#2866ce14, #6a9bea18)', '--pm-type: light-dark(#1f5fc4, #8db6ff)', '--pm-type: light-dark(#7438b0, #d3acff)', '--pm-err: var(--rd-err, light-dark(#ae1f38, #ff8f9c))', '@container pm-list (max-width: 485px)', '&[dir="rtl"] { --pm-flip: -1; }']) assert.ok(css.includes(pair), pair);
  for (const locale of ['ar', 'ur']) { const current = await opened({ locale }); try { assert.equal(current.attr('data-proxy-workspace').props.dir, 'rtl'); assert.ok(current.attr('data-proxy-manager')); assert.equal(current.nodes(node => node.type === 'button' && !node.props.type).length, 0); assert.doesNotMatch(current.text(), /proxy_workspace_|browser_debug_/); } finally { current.unmount(); } }
});
function connectedSource() { const source = server(); source.state.snapshot.configuration.enabled = true; source.state.snapshot.configuration.selectedId = direct.id; source.state.snapshot.status = { state: 'connected', profileId: direct.id }; return source; }
test('connection analyzer never probes on mount, host check or Connect; its action stays disabled while OFF', async () => {
  const current = await opened(); try {
    openPanel(current, 'analyzer'); assert.equal(current.attr('data-proxy-check-target').props.value, 'https://api.ipify.org/?format=json'); assert.equal(current.attr('data-proxy-check').props.disabled, true);
    await click(current, 'data-proxy-check'); await current.settle(); assert.equal(current.source.count('diagnose'), 0); assert.equal(current.source.count('requestAccess'), 0);
    await click(current, 'data-proxy-connect', direct.id); await current.settle(); assert.equal(current.attr('data-proxy-check').props.disabled, false); assert.equal(current.source.count('diagnose'), 0);
    click(current, 'data-proxy-panel', 'companion'); await current.settle(); await click(current, 'data-proxy-companion-check'); await current.settle(); assert.equal(current.source.count('diagnose'), 0);
  } finally { current.unmount(); }
});
test('explicit analyzer check grants native access in its click stack and renders only actual reply metadata', async () => {
  const source = connectedSource(), current = await opened({ source, locale: 'ru' }); try {
    input(current, 'data-proxy-check-target', 'https://owned.example.test/ip?check=1'); await current.settle();
    const pending = click(current, 'data-proxy-check'); assert.equal(source.count('requestAccess'), 1); assert.deepEqual(source.calls.at(-1).value, { native: true }); await pending; await current.settle();
    assert.equal(source.calls.find(call => call.name === 'diagnose').value, 'https://owned.example.test/ip?check=1'); assert.ok(current.attr('data-proxy-check-state', 'pass')); assert.equal(current.attr('data-proxy-check-ip').props.children, '203.0.113.41'); assert.equal(current.attr('data-proxy-check-http').props.children, '200'); assert.match(current.attr('data-proxy-check-dns').props.children, /DNS через прокси/); assert.match(current.attr('data-proxy-check-tls').props.children, /Сертификат проверен/); assert.equal(current.attr('data-proxy-check-elapsed').props.children, '42 ms');
    assert.doesNotMatch(JSON.stringify(source.state.snapshot.configuration), /owned\.example|203\.0\.113\.41/);
  } finally { current.unmount(); }
});
test('HTTP error replies remain reachable responses with actual status and no invented TLS verification or IP', async () => {
  const source = connectedSource(); source.state.diagnosticResult = { state: 'pass', reachable: true, remoteDns: false, tlsVerified: false, httpStatus: 503, ip: null, elapsedMs: 17 }; const current = await opened({ source }); try {
    input(current, 'data-proxy-check-target', 'http://owned.example.test/'); await current.settle(); await click(current, 'data-proxy-check'); await current.settle();
    assert.equal(plainText(current, current.attr('data-proxy-check-state', 'pass')), 'Response received'); assert.equal(current.attr('data-proxy-check-http').props.children, '503'); assert.equal(current.attr('data-proxy-check-ip').props.children, '—'); assert.equal(current.attr('data-proxy-check-dns').props.children, '—'); assert.equal(current.attr('data-proxy-check-tls').props.children, 'Not used (HTTP)');
  } finally { current.unmount(); }
});
test('analyzer invalid URLs are rejected before permission or diagnosis and its failures expose only safe localized metadata', async () => {
  const source = connectedSource(), current = await opened({ source }); try {
    for (const target of ['file:///private', 'https://user:PRIVATE_PASSWORD@example.test/', 'https://owned.example.test/#fragment', 'not a URL']) { input(current, 'data-proxy-check-target', target); await current.settle(); await click(current, 'data-proxy-check'); await current.settle(); assert.ok(current.attr('data-proxy-check-failure')); }
    assert.equal(source.count('requestAccess') + source.count('diagnose'), 0);
    source.state.failure = { name: 'diagnose', code: 'tls-failed', phase: 'tls', retryable: true }; input(current, 'data-proxy-check-target', 'https://owned.example.test/'); await current.settle(); await click(current, 'data-proxy-check'); await current.settle();
    assert.ok(current.attr('data-proxy-check-state', 'fail')); assert.match(current.text(), /TLS negotiation failed/); assert.match(current.text(), /tls \/ tls-failed/); assert.doesNotMatch(current.text(), /UNTRUSTED_NATIVE_TEXT_CANARY|PRIVATE_PASSWORD/);
  } finally { current.unmount(); }
});
test('analyzer permission refusal never dispatches a request and displays no stale successful result', async () => {
  const source = connectedSource(), current = await opened({ source }); try {
    await click(current, 'data-proxy-check'); await current.settle(); assert.ok(current.attr('data-proxy-check-ip')); source.state.failure = { name: 'requestAccess', code: 'permission-denied' }; await click(current, 'data-proxy-check'); await current.settle();
    assert.equal(source.count('diagnose'), 1); assert.equal(current.attr('data-proxy-check-ip'), undefined); assert.ok(current.attr('data-proxy-check-state', 'fail')); assert.match(current.text(), /Access was not granted/);
  } finally { current.unmount(); }
});
test('analyzer permission continuation cannot dispatch private URLs after hidden, inactive or unmounted lifecycle', async () => {
  for (const mode of ['hidden', 'inactive', 'unmounted']) {
    const source = connectedSource(); let grant; source.state.pendingGrant = new Promise(resolve => { grant = resolve; }); const current = await opened({ source }); let unmounted = false;
    try {
      input(current, 'data-proxy-check-target', 'https://owned.example.test/?PRIVATE_QUERY_CANARY=1'); await current.settle(); const pending = click(current, 'data-proxy-check');
      if (mode === 'hidden') current.hide(); else if (mode === 'inactive') current.update({ active: false }); else { current.unmount(); unmounted = true; }
      if (!unmounted) await current.settle(); grant(source.state.snapshot); await pending; if (!unmounted) await current.settle();
      assert.equal(source.count('diagnose'), 0);
      const retainedRequests = current.slots.filter(slot => slot?.ref?.current && typeof slot.ref.current === 'object' && 'url' in slot.ref.current).map(slot => slot.ref.current); assert.doesNotMatch(JSON.stringify(retainedRequests), /PRIVATE_QUERY_CANARY/);
      if (!unmounted) assert.doesNotMatch(JSON.stringify(current.slots.map(slot => slot?.value)), /PRIVATE_QUERY_CANARY/);
    } finally { if (!unmounted) current.unmount(); }
  }
});
test('analyzer result and private target clear on panel hide, parent-tab hide, pagehide and late response', async () => {
  const source = connectedSource(), current = await opened({ source }); try {
    input(current, 'data-proxy-check-target', 'https://owned.example.test/?PRIVATE_QUERY_CANARY=1'); await current.settle(); await click(current, 'data-proxy-check'); await current.settle(); assert.ok(current.attr('data-proxy-check-ip'));
    click(current, 'data-proxy-panel', 'routing'); await current.settle(); openPanel(current, 'analyzer'); await current.settle(); assert.equal(current.attr('data-proxy-check-target').props.value, 'https://api.ipify.org/?format=json'); assert.equal(current.attr('data-proxy-check-ip'), undefined); assert.doesNotMatch(JSON.stringify(current.slots.map(slot => slot?.value)), /PRIVATE_QUERY_CANARY/); // the exit IP of a checked profile stays in the list like after any list check; pagehide clears it below
    let complete; source.state.pendingDiagnostic = new Promise(resolve => { complete = resolve; }); input(current, 'data-proxy-check-target', 'https://owned.example.test/?PRIVATE_QUERY_CANARY=2'); await current.settle(); const pending = click(current, 'data-proxy-check'); await turn(); current.pagehide(); await current.settle(); complete({ ...source.state.snapshot, diagnostic: { state: 'pass', reachable: true, remoteDns: true, tlsVerified: true, httpStatus: 200, ip: '203.0.113.117', elapsedMs: 99 } }); await pending; await current.settle();
    assert.doesNotMatch(JSON.stringify(current.slots.map(slot => slot?.value)), /PRIVATE_QUERY_CANARY|203\.0\.113\.117/); current.pageshow(); await current.settle(); assert.equal(current.attr('data-proxy-check-ip'), undefined);
  } finally { current.unmount(); }
});
test('external connected routing changes clear this view’s previous IP, and another Options result is never copied into it', async () => {
  const source = connectedSource(), current = await opened({ source }); try {
    await click(current, 'data-proxy-check'); await current.settle(); assert.ok(current.attr('data-proxy-check-ip'));
    source.state.onChange({ ...source.state.snapshot, configuration: { ...source.state.snapshot.configuration, revision: 1, routing: { ...source.state.snapshot.configuration.routing, mode: 'include', proxyDomains: ['owned.example.test'] } }, diagnostic: undefined }); await current.settle();
    assert.equal(current.attr('data-proxy-check-ip'), undefined); assert.equal(current.attr('data-proxy-check-state', 'pass'), undefined);
    source.state.onChange({ ...source.state.snapshot, diagnostic: { state: 'pass', reachable: true, remoteDns: true, tlsVerified: true, httpStatus: 200, ip: '203.0.113.117', elapsedMs: 5 } }); await current.settle();
    assert.equal(current.attr('data-proxy-check-ip'), undefined); assert.doesNotMatch(JSON.stringify(current.slots.map(slot => slot?.value)), /203\.0\.113\.117/);
  } finally { current.unmount(); }
});
test('manager holds the saved rows and the way to add one, keeps nine named columns and accessible row actions', async () => {
  const current = await opened(); try {
    const manager = current.attr('data-proxy-manager'); assert.ok(manager);
    const tour = current.nodes(node => node.props?.['data-tour'] === 'proxy'); assert.equal(tour.length, 1, 'the guided tour anchors on exactly one element'); assert.equal(tour[0].type, 'header'); assert.equal(within(tour[0], node => node.props?.['data-proxy-search']).length + within(tour[0], node => node.props?.['data-proxy-new']).length, 2, 'the header with the title, the search and New profile, not the whole manager'); assert.equal(within(tour[0], node => node.props?.['data-proxy-table']).length, 0);
    assert.equal(within(manager, node => node.props?.['data-proxy-table']).length, 1, 'the saved rows are the manager'); assert.equal(within(manager, node => node.props?.['data-proxy-new']).length, 1, 'and adding one is part of its header, not a separate area');
    const all = current.nodes(() => true); assert.ok(all.indexOf(current.attr('data-proxy-new')) < all.indexOf(current.attr('data-proxy-table')), 'the header comes before the rows');
    assert.equal(current.attr('data-proxy-table').props.role, 'grid'); assert.equal(current.nodes(node => node.props.role === 'columnheader').length, 9);
    for (const profile of [direct, native]) { assert.equal(current.attr('data-proxy-health', profile.id).props['data-state'], 'unknown'); assert.equal(current.attr('data-proxy-profile-ip', profile.id).props.children, '—'); for (const key of ['data-proxy-connect','data-proxy-check-profile','data-proxy-more']) assert.ok(current.attr(key, profile.id).props['aria-label'].includes(profile.name)); current.attr('data-proxy-more', profile.id).props.onClick(); current.render(); for (const key of ['data-proxy-edit','data-proxy-duplicate','data-proxy-copy-profile','data-proxy-remove']) assert.ok(current.attr(key, profile.id)); current.attr('data-proxy-more', profile.id).props.onClick(); current.render(); }
    assert.equal(current.source.count('exportProfiles') + current.source.count('checkProfile'), 0);
  } finally { current.unmount(); }
});
test('sortable column headers reuse the existing sort keys and expose one aria-sort state', async () => {
  const current = await opened(); try {
    const sorted = () => current.nodes(node => node.props.role === 'columnheader' && node.props['aria-sort'] && node.props['aria-sort'] !== 'none');
    assert.deepEqual(current.nodes(node => node.props['data-proxy-sort-column']).map(node => node.props['data-proxy-sort-column']), ['name','type','host','country','latency','checked']);
    assert.equal(current.nodes(node => node.props['data-proxy-sort-column'] && node.props.type !== 'button').length, 0);
    assert.equal(sorted().length, 1); assert.equal(sorted()[0].props['aria-sort'], 'ascending');
    click(current, 'data-proxy-sort-column', 'latency'); await current.settle(); assert.equal(current.attr('data-proxy-sort').props.value, 'latency'); assert.equal(sorted().length, 1);
    click(current, 'data-proxy-sort-column', 'checked'); await current.settle(); assert.equal(current.attr('data-proxy-sort').props.value, 'checked'); assert.equal(sorted()[0].props['aria-sort'], 'descending');
    assert.equal(current.nodes(node => node.props.role === 'columnheader').length, 9); assert.equal(current.source.count('checkProfile') + current.source.count('exportProfiles'), 0);
  } finally { current.unmount(); }
});
test('manager sort is deterministic and uses only real last-check metadata without mutating the registry', () => {
  const vpn = { id: 'vpn', name: 'Middle VPN', type: 'openvpn', host: null, port: null, native: true }, rows = [{ ...direct, name: 'Z Socks' }, { ...native, name: 'A Vless' }, vpn];
  const checks = { direct: { diagnostic: { state: 'pass', elapsedMs: 42 }, checkedAt: 10 }, 'native-vless': { diagnostic: { state: 'fail', code: 'auth-failed' }, checkedAt: 30 }, vpn: { diagnostic: { state: 'pass', elapsedMs: 5 }, checkedAt: 20 } };
  const sorted = sort => proxySortedProfiles(rows, '', 'all', sort, checks).map(profile => profile.id);
  assert.deepEqual(sorted('name'), ['native-vless','vpn','direct']); assert.deepEqual(sorted('type'), ['vpn','direct','native-vless']); assert.deepEqual(sorted('latency'), ['vpn','direct','native-vless']); assert.deepEqual(sorted('health'), ['vpn','direct','native-vless']); assert.deepEqual(sorted('checked'), ['native-vless','vpn','direct']); assert.deepEqual(rows.map(profile => profile.id), ['direct','native-vless','vpn']);
  assert.deepEqual(proxySortedProfiles(rows, 'vless', 'vless', 'latency', checks).map(profile => profile.id), ['native-vless']);
});
test('checking an OFF or inactive saved profile requires a manual gesture and never changes the active connection', async () => {
  for (const active of [false, true]) {
    const source = active ? connectedSource() : server(), current = await opened({ source });
    try { const before = structuredClone(source.state.snapshot.configuration); const pending = click(current, 'data-proxy-check-profile', native.id); assert.equal(source.count('requestAccess'), 1); assert.deepEqual(source.calls.at(-1).value, { native: true }); await pending; await current.settle();
      assert.equal(source.count('checkProfile'), 1); assert.deepEqual(source.calls.find(call => call.name === 'checkProfile').value, { id: native.id, url: 'https://api.ipify.org/?format=json' }); assert.deepEqual(source.state.snapshot.configuration, before); assert.equal(source.count('connect') + source.count('disconnect') + source.count('saveSettings'), 0); assert.equal(current.attr('data-proxy-health', native.id).props['data-state'], 'pass'); assert.equal(current.attr('data-proxy-profile-ip', native.id).props.children, '203.0.113.117'); assert.equal(current.attr('data-proxy-profile-latency', native.id).props.children, '17 ms');
    } finally { current.unmount(); }
  }
});
test('manual Check visible respects current filters and reports safe row failures including active OpenVPN restriction', async () => {
  const source = server(); source.state.checkResults[native.id] = { state: 'fail', code: 'active-vpn', phase: 'tunnel', retryable: false }; const current = await opened({ source, locale: 'ru' });
  try {
    input(current, 'data-proxy-search', 'VLESS'); await current.settle(); await click(current, 'data-proxy-check-visible'); await current.settle();
    assert.deepEqual(source.calls.filter(call => call.name === 'checkProfile').map(call => call.value.id), [native.id]); assert.equal(current.attr('data-proxy-health', native.id).props['data-state'], 'fail'); assert.match(current.text(current.attr('data-proxy-profile-error', native.id)), /Активно другое соединение OpenVPN/); assert.equal(current.attr('data-proxy-health', direct.id), undefined);
  } finally { current.unmount(); }
});
test('manual batch serializes checks and Cancel prevents later dispatch while the current bounded request settles', async () => {
  const source = server(); let finish; source.state.pendingCheck = input => new Promise(resolve => { finish = () => resolve({ profileId: input.id, diagnostic: { state: 'pass', reachable: true, remoteDns: true, tlsVerified: true, httpStatus: 200, ip: null, elapsedMs: 10 } }); }); const current = await opened({ source });
  try {
    const pending = click(current, 'data-proxy-check-visible'); await current.settle(); assert.equal(source.count('checkProfile'), 1); assert.ok(current.attr('data-proxy-stop-checks')); click(current, 'data-proxy-stop-checks'); await current.settle(); assert.equal(current.attr('data-proxy-stop-checks').props.disabled, true); finish(); await finishes(pending); await current.settle(); assert.equal(source.count('checkProfile'), 1); assert.equal(current.attr('data-proxy-stop-checks'), undefined); assert.equal(current.attr('data-proxy-health', direct.id).props['data-state'], 'unknown');
  } finally { current.unmount(); }
});
test('hiding a manual batch wipes its private URL, suppresses late health results and starts no further checks', async () => {
  const source = server(); let finish; source.state.pendingCheck = input => new Promise(resolve => { finish = () => resolve({ profileId: input.id, diagnostic: { state: 'pass', reachable: true, remoteDns: true, tlsVerified: true, httpStatus: 200, ip: '203.0.113.117', elapsedMs: 10 } }); }); const current = await opened({ source });
  try {
    input(current, 'data-proxy-check-target', 'https://owned.example.test/?PRIVATE_BATCH_QUERY=1'); await current.settle(); const pending = click(current, 'data-proxy-check-visible'); await current.settle(); current.update({ active: false }); await current.settle(); finish(); await finishes(pending); await current.settle(); assert.equal(source.count('checkProfile'), 1); assert.doesNotMatch(JSON.stringify(current.slots.map(slot => slot?.value)), /PRIVATE_BATCH_QUERY|203\.0\.113\.117/);
    current.update({ active: true }); await current.settle(); assert.equal(current.attr('data-proxy-health', direct.id).props['data-state'], 'unknown'); assert.equal(current.attr('data-proxy-health', native.id).props['data-state'], 'unknown');
  } finally { current.unmount(); }
});
test('full JSON Copy includes complete connection secrets and settings only in the explicit clipboard write', async () => {
  const source = server(); const vpn = { id: 'vpn', name: 'VPN', type: 'openvpn', host: null, port: null, native: true }; source.state.snapshot.configuration.profiles.push(vpn); source.state.connections[native.id] = { type: 'vless', uri: uri.replace('Example', 'FULL_URI_CANARY') }; source.state.connections.vpn = { type: 'openvpn', config: 'client\n<key>\nFULL_KEY_CANARY\n</key>\n', username: 'FULL_LOGIN_CANARY', password: 'FULL_PASSWORD_CANARY' }; const current = await opened({ source });
  try {
    assert.equal(current.clipboard.length + source.count('exportProfiles'), 0); const pending = click(current, 'data-proxy-copy-all'); assert.equal(source.count('requestAccess'), 1); assert.deepEqual(source.calls.at(-1).value, { native: true, clipboard: true }); await pending; await current.settle();
    assert.equal(current.clipboard.length, 1); const exported = JSON.parse(current.clipboard[0]); assert.equal(exported.format, 'detect.expert.proxy.bundle'); assert.equal(exported.profiles.length, 3); assert.equal(exported.profiles.find(profile => profile.id === 'vpn').connection.password, 'FULL_PASSWORD_CANARY'); assert.match(exported.profiles.find(profile => profile.id === 'vpn').connection.config, /FULL_KEY_CANARY/); assert.equal(exported.killSwitch, true); assert.deepEqual(exported.routing, source.state.snapshot.configuration.routing); assert.ok(current.attr('data-proxy-copied', 'all'));
    assert.doesNotMatch(JSON.stringify(current.slots.map(slot => slot?.value)), /FULL_URI_CANARY|FULL_KEY_CANARY|FULL_PASSWORD_CANARY|FULL_LOGIN_CANARY/); assert.doesNotMatch(current.text(), /FULL_URI_CANARY|FULL_KEY_CANARY|FULL_PASSWORD_CANARY|FULL_LOGIN_CANARY/); assert.doesNotMatch(JSON.stringify(source.state.snapshot), /FULL_URI_CANARY|FULL_PASSWORD_CANARY/);
  } finally { current.unmount(); }
});
test('single direct Copy requests clipboard permission without native access and contains exactly that profile', async () => {
  const current = await opened(); try { await click(current, 'data-proxy-copy-profile', direct.id); await current.settle(); assert.deepEqual(current.source.calls.find(call => call.name === 'requestAccess').value, { native: false, clipboard: true }); assert.deepEqual(current.source.calls.find(call => call.name === 'exportProfiles').value, direct.id); assert.deepEqual(JSON.parse(current.clipboard[0]).profiles.map(profile => profile.id), [direct.id]); assert.ok(current.attr('data-proxy-copied', direct.id)); } finally { current.unmount(); }
});
test('hidden Copy never fetches or writes deferred secrets, and clipboard errors never show copied success', async () => {
  for (const mode of ['grant', 'export']) {
    const source = server(); let finish; if (mode === 'grant') source.state.pendingGrant = new Promise(resolve => { finish = () => resolve(source.state.snapshot); }); else { const bundle = await source.client.exportProfiles(native.id); source.calls.length = 0; source.state.pendingExport = new Promise(resolve => { finish = () => resolve(bundle); }); }
    const current = await opened({ source }); try { const pending = click(current, 'data-proxy-copy-profile', native.id); await current.settle(); current.hide(); await current.settle(); finish(); await pending; await current.settle(); assert.equal(current.clipboard.length, 0); assert.equal(source.count('exportProfiles'), mode === 'grant' ? 0 : 1); assert.doesNotMatch(JSON.stringify(current.slots.map(slot => slot?.value)), /5e7b5c1f/); } finally { current.unmount(); }
  }
  const source = server(); source.state.clipboardFailure = true; const current = await opened({ source }); try { await click(current, 'data-proxy-copy-profile', direct.id); await current.settle(); assert.equal(current.clipboard.length, 0); assert.equal(current.attr('data-proxy-copied', direct.id), undefined); assert.ok(current.attr('data-proxy-error')); assert.doesNotMatch(current.text(), /UNTRUSTED_CLIPBOARD_ERROR/); } finally { current.unmount(); }
});
test('native Edit explicitly loads current username/password and clears the editor on navigation without touching list metadata', async () => {
  const source = server(), authenticated = { id: 'authenticated', name: 'Auth SOCKS', type: 'socks5', host: 'proxy.example.test', port: 1080, native: true }; source.state.snapshot.configuration.profiles.push(authenticated); source.state.connections.authenticated = { type: 'socks5', host: authenticated.host, port: authenticated.port, username: 'EDITOR_LOGIN_CANARY', password: 'EDITOR_PASSWORD_CANARY' }; const current = await opened({ source });
  try { assert.equal(source.count('exportProfiles'), 0); await click(current, 'data-proxy-edit', authenticated.id); await current.settle(); assert.equal(current.attr('data-proxy-field', 'username').props.value, 'EDITOR_LOGIN_CANARY'); assert.equal(current.attr('data-proxy-field', 'password').props.value, 'EDITOR_PASSWORD_CANARY'); assert.equal(current.attr('data-proxy-field', 'password').props.type, 'password'); assert.doesNotMatch(current.text(), /EDITOR_PASSWORD_CANARY/); current.update({ active: false }); await current.settle(); assert.doesNotMatch(JSON.stringify(current.slots.map(slot => slot?.value)), /EDITOR_LOGIN_CANARY|EDITOR_PASSWORD_CANARY/); assert.doesNotMatch(JSON.stringify(source.state.snapshot.configuration), /EDITOR_LOGIN_CANARY|EDITOR_PASSWORD_CANARY/); } finally { current.unmount(); }
});
test('hidden native Edit never fetches deferred vault data and ignores an already in-flight export reply', async () => {
  for (const mode of ['grant','export']) { const source = server(); let finish; if (mode === 'grant') source.state.pendingGrant = new Promise(resolve => { finish = () => resolve(source.state.snapshot); }); else { const bundle = await source.client.exportProfiles(native.id); source.calls.length = 0; source.state.pendingExport = new Promise(resolve => { finish = () => resolve(bundle); }); } const current = await opened({ source }); try { const pending = click(current, 'data-proxy-edit', native.id); await current.settle(); current.update({ active: false }); await current.settle(); finish(); await pending; await current.settle(); assert.equal(source.count('exportProfiles'), mode === 'grant' ? 0 : 1); assert.doesNotMatch(JSON.stringify(current.slots.map(slot => slot?.value)), /5e7b5c1f/); } finally { current.unmount(); } }
});
test('saving changed connection secrets invalidates prior successful health even if endpoint metadata stays identical', async () => {
  const source = server(), current = await opened({ source }); try {
    await click(current, 'data-proxy-check-profile', native.id); await current.settle(); assert.equal(current.attr('data-proxy-health', native.id).props['data-state'], 'pass'); await click(current, 'data-proxy-edit', native.id); await current.settle(); input(current, 'data-proxy-field', uri.replace('Example', 'Changed'), 'uri'); await current.settle(); await click(current, 'data-proxy-save-profile'); await current.settle(); assert.equal(current.attr('data-proxy-health', native.id).props['data-state'], 'unknown'); assert.equal(current.attr('data-proxy-profile-ip', native.id).props.children, '—');
  } finally { current.unmount(); }
});
test('Companion installation commands use the actual Chrome or Firefox parameter without shell interpolation', async () => {
  const current = await opened({ runtimeId: 'detect.expert@detect.expert' }); try { click(current, 'data-proxy-panel', 'companion'); await current.settle(); assert.match(current.text(), /\.\\Install\.ps1 -FirefoxExtensionId 'detect\.expert@detect\.expert'/); assert.doesNotMatch(current.text(), /-ChromeExtensionId/); } finally { current.unmount(); }
});

test('renaming any active saved profile omits unchanged connection data and preserves the active route', async () => {
  const authenticated = { ...direct, id: 'auth-socks', native: true }, vpn = { id: 'vpn', name: 'VPN', type: 'openvpn', host: null, port: null, native: true };
  for (const profile of [direct, authenticated, native, vpn]) {
    const source = server(); source.state.snapshot = { configuration: { ...source.state.snapshot.configuration, profiles: [profile], selectedId: profile.id, enabled: true }, status: { state: 'connected', profileId: profile.id } };
    if (profile.id === authenticated.id) source.state.connections[profile.id] = { type: 'socks5', host: profile.host, port: profile.port, username: 'ACTIVE_LOGIN_CANARY', password: 'ACTIVE_PASSWORD_CANARY' };
    const originalSave = source.client.saveProfile;
    source.client.saveProfile = input => {
      assert.equal(['username', 'password', 'uri', 'config'].some(key => Object.hasOwn(input, key)), false, 'an active rename must reach the backend metadata-only branch');
      assert.equal(input.host, profile.host); assert.equal(input.port, profile.port);
      return originalSave(input);
    };
    const current = await opened({ source }); try {
      await click(current, 'data-proxy-edit', profile.id); await current.settle(); const grants = source.count('requestAccess');
      input(current, 'data-proxy-field', 'Active renamed', 'name'); await current.settle(); await click(current, 'data-proxy-save-profile'); await current.settle();
      assert.equal(source.count('saveProfile'), 1); assert.equal(source.count('requestAccess'), grants); assert.equal(source.count('connect'), 0); assert.equal(source.count('disconnect'), 0);
      assert.equal(source.state.snapshot.configuration.selectedId, profile.id); assert.equal(source.state.snapshot.configuration.enabled, true); assert.equal(source.state.snapshot.status.state, 'connected'); assert.equal(current.attr('data-proxy-editor', profile.type), undefined);
    } finally { current.unmount(); }
  }
});

test('editing an active connection still submits the changed full connection and surfaces a busy response', async () => {
  for (const profile of [direct, native, { id: 'vpn', name: 'VPN', type: 'openvpn', host: null, port: null, native: true }]) {
    const source = server(); source.state.snapshot = { configuration: { ...source.state.snapshot.configuration, profiles: [profile], selectedId: profile.id, enabled: true }, status: { state: 'connected', profileId: profile.id } }; source.state.failure = { name: 'saveProfile', code: 'busy' };
    const current = await opened({ source }); try {
      await click(current, 'data-proxy-edit', profile.id); await current.settle();
      const field = profile.type === 'socks5' ? 'host' : profile.type === 'vless' ? 'uri' : 'config', value = profile.type === 'socks5' ? 'new.example.test' : profile.type === 'vless' ? uri.replace('relay.example', 'changed.example') : 'client\nremote changed.example.test 1194\n';
      input(current, 'data-proxy-field', value, field); await current.settle(); await click(current, 'data-proxy-save-profile'); await current.settle();
      const saved = source.calls.find(call => call.name === 'saveProfile').value; assert.equal(saved[field], value); assert.ok(current.attr('data-proxy-error')); assert.equal(source.state.snapshot.status.state, 'connected'); assert.equal(source.count('disconnect'), 0);
    } finally { current.unmount(); }
  }
});

test('the loaded original connection survives a failed Save and is wiped on cancel, hide, inactive or unmount', async () => {
  for (const action of ['cancel', 'hide', 'inactive', 'unmount', 'save-failure']) {
    const source = server(), current = await opened({ source }); let unmounted = false;
    try {
      await click(current, 'data-proxy-edit', native.id); await current.settle(); const originalSlot = current.slots.find(slot => slot?.ref?.current?.draft?.uri === uri); assert.ok(originalSlot); const held = originalSlot.ref.current;
      if (action === 'cancel') click(current, 'data-proxy-cancel');
      else if (action === 'hide') current.hide();
      else if (action === 'inactive') current.update({ active: false });
      else if (action === 'unmount') { current.unmount(); unmounted = true; }
      else { source.state.failure = { name: 'saveProfile', code: 'busy' }; await click(current, 'data-proxy-save-profile'); await current.settle(); assert.equal(originalSlot.ref.current, held); assert.equal(held.draft.uri, uri); click(current, 'data-proxy-cancel'); }
      if (!unmounted) await current.settle();
      assert.equal(originalSlot.ref.current, null); assert.doesNotMatch(JSON.stringify(held), /5e7b5c1f/); assert.equal(Object.hasOwn(held.draft, 'uri'), false);
    } finally { if (!unmounted) current.unmount(); }
  }
});

// ADR-107: list import, list status UX, live paste preview, session helper and honest notes.
const within = (root, predicate) => { const found = []; const visit = node => { if (Array.isArray(node)) return node.forEach(visit); if (!node?.props) return; if (predicate(node)) found.push(node); visit(node.props.children); }; visit(root); return found; };
const held = current => JSON.stringify(current.slots.map(slot => slot?.value ?? slot?.ref?.current));
const plainText = (current, node) => current.text(node).replace(/\s+/g, ' ').trim();
async function bulkPreview(current, text, order = null) {
  click(current, 'data-proxy-bulk-open'); await current.settle();
  if (order) { current.attr('data-proxy-bulk-format').props.onChange({ currentTarget: { value: order } }); await current.settle(); }
  input(current, 'data-proxy-bulk-text', text); await current.settle();
  click(current, 'data-proxy-bulk-parse'); await current.settle();
}
test('list import previews every line, grants native access once in the click and saves selected rows one by one', async () => {
  const source = server(), current = await opened({ source });
  try {
    click(current, 'data-proxy-bulk-open'); await current.settle();
    assert.ok(current.attr('data-proxy-bulk', 'paste')); assert.equal(source.count('requestAccess') + source.count('saveProfile'), 0);
    assert.match(current.attr('data-proxy-bulk-text').props.placeholder, /203\.0\.113\.10:1080/);
    input(current, 'data-proxy-bulk-text', ['203.0.113.21:1080:BULK_LOGIN_CANARY:BULK_PASSWORD#CANARY #Office', 'socks5://203.0.113.22:1080', 'socks4://203.0.113.23:1080', '203.0.113.21:1080:BULK_LOGIN_CANARY:BULK_PASSWORD#CANARY #Again', 'proxy.example.test:1080'].join('\r\n')); await current.settle();
    click(current, 'data-proxy-bulk-parse'); await current.settle();
    assert.ok(current.attr('data-proxy-bulk', 'preview'));
    assert.deepEqual([1, 2, 3, 4, 5].map(line => current.attr('data-proxy-bulk-line', line).props['data-state']), ['ready', 'ready', 'error', 'duplicate', 'warning']);
    assert.match(current.text(current.attr('data-proxy-bulk-status', 3)), /Only SOCKS5, HTTP, HTTPS and VLESS/); assert.match(current.text(current.attr('data-proxy-bulk-status', 4)), /Duplicate · Line 1/); assert.match(current.text(current.attr('data-proxy-bulk-status', 5)), /already uses this address/);
    assert.match(current.text(current.attr('data-proxy-bulk-line', 1)), /BULK_LOGIN_CANARY/); assert.doesNotMatch(current.text(), /BULK_PASSWORD/);
    assert.match(plainText(current, current.attr('data-proxy-bulk-summary')), /Free slots 98 \/ 100/);
    // Back keeps the pasted text for correction; parsing again restores the same rows.
    click(current, 'data-proxy-bulk-back'); await current.settle(); assert.match(current.attr('data-proxy-bulk-text').props.value, /BULK_PASSWORD#CANARY/); click(current, 'data-proxy-bulk-parse'); await current.settle();
    const pending = click(current, 'data-proxy-bulk-save');
    assert.equal(source.count('requestAccess'), 1); assert.deepEqual(source.calls.find(call => call.name === 'requestAccess').value, { native: true }); assert.equal(source.count('saveProfile'), 0);
    await pending; await current.settle();
    const saves = source.calls.filter(call => call.name === 'saveProfile').map(call => call.value);
    assert.deepEqual(saves.map(save => [save.name, save.type, save.host, save.port, save.username ?? null, save.password ?? null]), [['Office', 'socks5', '203.0.113.21', 1080, 'BULK_LOGIN_CANARY', 'BULK_PASSWORD#CANARY'], ['203.0.113.22:1080', 'socks5', '203.0.113.22', 1080, null, null], ['proxy.example.test:1080', 'socks5', 'proxy.example.test', 1080, null, null]]);
    assert.ok(saves.every(save => /^p-[0-9a-f-]{36}$/.test(save.id))); assert.equal(new Set(saves.map(save => save.id)).size, 3);
    assert.equal(current.attr('data-proxy-bulk', 'preview'), undefined); assert.ok(current.attr('data-proxy-imported', '3')); assert.match(current.text(current.attr('data-proxy-notice')), /Saved: 3/);
    assert.equal(source.count('connect') + source.count('checkProfile'), 0); assert.doesNotMatch(held(current), /BULK_PASSWORD|BULK_LOGIN_CANARY/);
  } finally { current.unmount(); }
});
test('list import text and parsed credentials clear on Cancel, Escape, close, hide, BFCache, deactivation and unmount', async () => {
  for (const mode of ['cancel', 'escape', 'close', 'hide', 'pagehide', 'inactive', 'unmount']) {
    const source = server(), current = await opened({ source }); let unmounted = false;
    try {
      await bulkPreview(current, '203.0.113.31:1080:LIST_LOGIN_CANARY:LIST_PASSWORD_CANARY\n' + uri);
      assert.match(held(current), /LIST_PASSWORD_CANARY/, 'parsed rows stay in RAM until an exit');
      if (mode === 'cancel') click(current, 'data-proxy-bulk-cancel');
      else if (mode === 'escape') { let prevented = false; current.attr('data-proxy-bulk', 'preview').props.onCancel({ preventDefault() { prevented = true; } }); assert.equal(prevented, true); }
      else if (mode === 'close') click(current, 'data-proxy-bulk-close');
      else if (mode === 'hide') current.hide(); else if (mode === 'pagehide') current.pagehide(); else if (mode === 'inactive') current.update({ active: false });
      else { current.unmount(); unmounted = true; }
      if (!unmounted) await current.settle();
      assert.doesNotMatch(held(current), /LIST_PASSWORD_CANARY|LIST_LOGIN_CANARY|5e7b5c1f/, mode);
      if (!unmounted) assert.equal(current.nodes(node => node.props?.['data-proxy-bulk']).length, 0, mode);
      assert.equal(source.count('saveProfile') + source.count('requestAccess'), 0, mode);
    } finally { if (!unmounted) current.unmount(); }
  }
});
test('list import respects the 100-profile limit, shows the free slots and refuses extra selection', async () => {
  const source = server(); source.state.snapshot.configuration.profiles = Array.from({ length: PROXY_LIMITS.profiles - 1 }, (_, index) => ({ id: 'p' + index, name: 'P' + index, type: 'socks5', host: '198.51.100.' + index, port: 1080, native: false }));
  const current = await opened({ source });
  try {
    await bulkPreview(current, ['203.0.113.41:1080', '203.0.113.42:1080', '203.0.113.43:1080'].join('\n'));
    const checked = () => [1, 2, 3].map(line => current.attr('data-proxy-bulk-select', line).props.checked);
    assert.deepEqual(checked(), [true, false, false]); assert.ok(current.attr('data-proxy-bulk-room', 1)); assert.ok(current.attr('data-proxy-bulk-limit')); assert.equal(current.attr('data-proxy-bulk-select', 2).props.disabled, true);
    current.attr('data-proxy-bulk-select', 2).props.onChange({ currentTarget: { checked: true } }); await current.settle(); assert.deepEqual(checked(), [true, false, false]);
    current.attr('data-proxy-bulk-select', 1).props.onChange({ currentTarget: { checked: false } }); await current.settle();
    current.attr('data-proxy-bulk-select', 3).props.onChange({ currentTarget: { checked: true } }); await current.settle(); assert.deepEqual(checked(), [false, false, true]);
    current.attr('data-proxy-bulk-all').props.onChange({ currentTarget: { checked: false } }); await current.settle(); assert.deepEqual(checked(), [false, false, false]); assert.equal(current.attr('data-proxy-bulk-save').props.disabled, true);
    current.attr('data-proxy-bulk-all').props.onChange({ currentTarget: { checked: true } }); await current.settle(); assert.deepEqual(checked(), [true, false, false]);
    await click(current, 'data-proxy-bulk-save'); await current.settle();
    assert.deepEqual(source.calls.filter(call => call.name === 'saveProfile').map(call => call.value.host), ['203.0.113.41']); assert.equal(source.count('requestAccess'), 0, 'direct SOCKS rows need no vault grant');
  } finally { current.unmount(); }
});
test('a failed row stops the list save, keeps unsaved rows selected and a retry never saves a row twice', async () => {
  const source = server(), original = source.client.saveProfile.bind(source.client); let calls = 0;
  source.client.saveProfile = async value => { if (++calls === 2) throw Object.assign(Error('UNTRUSTED_NATIVE_TEXT_CANARY'), { code: 'vault-unavailable', phase: 'vault' }); return original(value); };
  const current = await opened({ source });
  try {
    await bulkPreview(current, ['203.0.113.51:1080:u1:RETRY_PASSWORD_ONE #One', '203.0.113.52:1080:u2:RETRY_PASSWORD_TWO #Two', '203.0.113.53:1080:u3:RETRY_PASSWORD_THREE #Three'].join('\n'));
    await click(current, 'data-proxy-bulk-save'); await current.settle();
    assert.deepEqual([1, 2, 3].map(line => current.attr('data-proxy-bulk-line', line).props['data-state']), ['saved', 'failed', 'ready']);
    assert.ok(current.attr('data-proxy-bulk-error')); assert.doesNotMatch(current.text(), /UNTRUSTED_NATIVE_TEXT_CANARY/); assert.match(current.text(current.attr('data-proxy-bulk-status', 2)), /credential vault is unavailable/);
    assert.equal(current.attr('data-proxy-bulk-back').props.disabled, true); assert.equal(current.attr('data-proxy-bulk-select', 1).props.disabled, true);
    assert.doesNotMatch(held(current), /RETRY_PASSWORD_ONE/); assert.match(held(current), /RETRY_PASSWORD_TWO/);
    await click(current, 'data-proxy-bulk-save'); await current.settle();
    assert.deepEqual(source.calls.filter(call => call.name === 'saveProfile').map(call => call.value.name), ['One', 'Two', 'Three']); assert.equal(source.count('requestAccess'), 2);
    assert.equal(current.nodes(node => node.props?.['data-proxy-bulk']).length, 0); assert.ok(current.attr('data-proxy-imported', '3')); assert.doesNotMatch(held(current), /RETRY_PASSWORD/);
  } finally { current.unmount(); }
});
test('list import permission refusal saves nothing and keeps parsed rows only until an explicit exit', async () => {
  const source = server(); source.client.requestAccess = options => { source.calls.push({ name: 'requestAccess', value: options }); return Promise.reject(Object.assign(Error('denied'), { code: 'permission-denied' })); };
  const current = await opened({ source });
  try {
    await bulkPreview(current, 'vless://5e7b5c1f-8b45-4e1f-9b9d-0eed6882f4cc@relay.example.test:443?security=tls#Relay');
    await click(current, 'data-proxy-bulk-save'); await current.settle();
    assert.equal(source.count('requestAccess'), 1); assert.equal(source.count('saveProfile'), 0); assert.ok(current.attr('data-proxy-bulk', 'preview')); assert.match(current.text(current.attr('data-proxy-bulk-error')), /Access was not granted/);
    click(current, 'data-proxy-bulk-cancel'); await current.settle(); assert.doesNotMatch(held(current), /5e7b5c1f/);
  } finally { current.unmount(); }
});
test('a native grant that settles after hiding or deactivation never starts a hidden list save', async () => {
  for (const exit of ['hide', 'inactive', 'pagehide']) {
    const source = server(); let grant; source.state.pendingGrant = new Promise(resolve => { grant = () => resolve(source.state.snapshot); });
    const current = await opened({ source });
    try {
      await bulkPreview(current, '203.0.113.91:1080:LATE_LOGIN:LATE_GRANT_CANARY #Late');
      const pending = click(current, 'data-proxy-bulk-save'); assert.equal(source.count('requestAccess'), 1);
      if (exit === 'hide') current.hide(); else if (exit === 'inactive') current.update({ active: false }); else current.pagehide();
      await current.settle(); grant(); await pending; await current.settle();
      assert.equal(source.count('saveProfile'), 0, exit); assert.doesNotMatch(held(current), /LATE_GRANT_CANARY|LATE_LOGIN/, exit); assert.equal(current.nodes(node => node.props?.['data-proxy-imported']).length, 0, exit);
    } finally { current.unmount(); }
  }
});
test('Cancel during a list save stops after the request in flight and still lists the saved row', async () => {
  const source = server(), original = source.client.saveProfile.bind(source.client); let release, saves = 0;
  // Only the first request is held, so a missing stop fails an assertion instead of hanging.
  source.client.saveProfile = value => ++saves > 1 ? original(value) : new Promise(resolve => { release = () => resolve(original(value)); });
  const current = await opened({ source });
  try {
    await bulkPreview(current, '203.0.113.81:1080 #A\n203.0.113.82:1080 #B');
    const pending = click(current, 'data-proxy-bulk-save'); await current.settle(); assert.ok(current.attr('data-proxy-bulk-progress'));
    click(current, 'data-proxy-bulk-cancel'); await current.settle(); assert.equal(current.nodes(node => node.props?.['data-proxy-bulk']).length, 0);
    release(); await pending; await current.settle();
    assert.deepEqual(source.calls.filter(call => call.name === 'saveProfile').map(call => call.value.name), ['A']); assert.ok(current.attr('data-proxy-imported', '1'));
  } finally { current.unmount(); }
});
test('imported rows are checked only on request and only failed imported profiles are deleted after one confirmation', async () => {
  const source = server(), current = await opened({ source });
  try {
    await bulkPreview(current, '203.0.113.61:1080 #Good\n203.0.113.62:1080 #Bad'); await click(current, 'data-proxy-bulk-save'); await current.settle();
    const ids = source.calls.filter(call => call.name === 'saveProfile').map(call => call.value.id);
    source.state.checkResults[ids[1]] = { state: 'fail', code: 'connection-refused', phase: 'connect', retryable: true };
    assert.equal(current.attr('data-proxy-delete-failed').props.disabled, true); assert.equal(source.count('checkProfile'), 0);
    await click(current, 'data-proxy-check-imported'); await current.settle();
    assert.deepEqual(source.calls.filter(call => call.name === 'checkProfile').map(call => call.value.id), ids);
    assert.equal(current.attr('data-proxy-health', ids[1]).props['data-state'], 'fail'); assert.match(current.text(current.attr('data-proxy-imported', '2')), /Response received: 1 · Check failed: 1/);
    click(current, 'data-proxy-delete-failed'); await current.settle(); assert.ok(current.attr('data-proxy-imported-confirm')); assert.equal(source.count('deleteProfile'), 0);
    click(current, 'data-proxy-imported-keep'); await current.settle(); assert.equal(current.attr('data-proxy-imported-confirm'), undefined);
    click(current, 'data-proxy-delete-failed'); await current.settle(); await click(current, 'data-proxy-imported-delete'); await current.settle();
    assert.deepEqual(source.calls.filter(call => call.name === 'deleteProfile').map(call => call.value), [ids[1]]);
    assert.ok(source.state.snapshot.configuration.profiles.some(profile => profile.id === direct.id)); assert.ok(current.attr('data-proxy-imported', '1'));
  } finally { current.unmount(); }
});
test('status filter, result glyphs and DNS/TLS badges reflect only real manual results', async () => {
  const source = server(); source.state.checkResults[native.id] = { state: 'fail', code: 'auth-failed', phase: 'auth', retryable: false };
  const current = await opened({ source });
  try {
    const glyph = id => within(current.attr('data-proxy-health', id), node => node.type === 'svg')[0]?.props['data-glyph'];
    assert.deepEqual([glyph(direct.id), glyph(native.id)], ['unknown', 'unknown']);
    await click(current, 'data-proxy-check-visible'); await current.settle();
    assert.deepEqual([glyph(direct.id), glyph(native.id)], ['pass', 'fail']);
    assert.deepEqual(within(current.attr('data-proxy-health', direct.id), node => node.props['data-proxy-badge']).map(node => node.props['data-proxy-badge']), ['dns', 'tls']);
    assert.equal(within(current.attr('data-proxy-health', native.id), node => node.props['data-proxy-badge']).length, 0);
    const filter = value => current.attr('data-proxy-status-chip', value).props.onClick();
    assert.match(plainText(current, current.attr('data-proxy-status-chip', 'pass')), /1$/); assert.match(plainText(current, current.attr('data-proxy-status-chip', 'fail')), /1$/); assert.match(plainText(current, current.attr('data-proxy-status-chip', 'unchecked')), /0$/);
    filter('fail'); await current.settle(); assert.ok(current.attr('data-proxy-profile', native.id)); assert.equal(current.attr('data-proxy-profile', direct.id), undefined);
    filter('pass'); await current.settle(); assert.ok(current.attr('data-proxy-profile', direct.id)); assert.equal(current.attr('data-proxy-profile', native.id), undefined);
    filter('unchecked'); await current.settle(); assert.equal(current.nodes(node => node.props?.['data-proxy-profile']).length, 0);
    filter('all'); await current.settle(); assert.equal(current.attr('data-proxy-status-chip', 'all').props['aria-pressed'], true); assert.equal(current.attr('data-proxy-status-chip', 'unchecked').props['aria-pressed'], false);
    assert.equal(source.count('checkProfile'), 2);
    const plain = server(); plain.state.checkResults[direct.id] = { state: 'pass', reachable: true, remoteDns: false, tlsVerified: false, httpStatus: 403, ip: null, elapsedMs: 3 };
    const other = await opened({ source: plain }); try { await click(other, 'data-proxy-check-profile', direct.id); await other.settle(); assert.equal(within(other.attr('data-proxy-health', direct.id), node => node.props['data-proxy-badge']).length, 0); assert.match(other.text(other.attr('data-proxy-health-meta', direct.id)), /HTTP 403/); } finally { other.unmount(); }
  } finally { current.unmount(); }
});
test('profiles with equal names show their endpoint beside the name and in nothing else', async () => {
  const source = server(); source.state.snapshot.configuration.profiles = [direct, { ...direct, id: 'twin', name: 'direct socks ', host: '2001:db8::7', port: 1081 }, native];
  const current = await opened({ source });
  try {
    assert.equal(current.attr('data-proxy-duplicate-endpoint', direct.id).props.children, 'proxy.example.test:1080'); assert.equal(current.attr('data-proxy-duplicate-endpoint', 'twin').props.children, '[2001:db8::7]:1081'); assert.equal(current.attr('data-proxy-duplicate-endpoint', native.id), undefined);
  } finally { current.unmount(); }
});
test('the paste field previews what Parse would fill without revealing the login or password', async () => {
  const current = await opened(); try {
    click(current, 'data-proxy-new'); await current.settle(); assert.equal(current.nodes(node => node.props?.['data-proxy-paste-preview']).length, 0);
    input(current, 'data-proxy-paste', 'socks5://LOGIN_CANARY:PASSWORD_CANARY@proxy.example.test:2345'); await current.settle();
    const preview = current.attr('data-proxy-paste-preview', 'ok'); assert.equal(preview.props.role, 'status'); assert.match(plainText(current, preview), /Recognized: SOCKS5 · proxy\.example\.test:2345 · with login/);
    assert.doesNotMatch(current.text(), /LOGIN_CANARY|PASSWORD_CANARY/); assert.equal(current.attr('data-proxy-field', 'host').props.value, '');
    input(current, 'data-proxy-paste', 'socks4://203.0.113.1:1080'); await current.settle(); assert.match(current.text(current.attr('data-proxy-paste-preview', 'invalid')), /Only SOCKS5, HTTP, HTTPS and VLESS/);
    input(current, 'data-proxy-paste', 'user:pass:203.0.113.9:1080'); await current.settle(); assert.match(plainText(current, current.attr('data-proxy-paste-preview', 'ok')), /203\.0\.113\.9:1080 · with login/);
    input(current, 'data-proxy-paste', ''); await current.settle(); assert.equal(current.nodes(node => node.props?.['data-proxy-paste-preview']).length, 0);
    assert.equal(current.source.count('saveProfile') + current.source.count('requestAccess'), 0);
  } finally { current.unmount(); }
});
test('random session follows the visible editable format and changes only the chosen editor field', async () => {
  const current = await opened(); try {
    click(current, 'data-proxy-new'); await current.settle(); assert.equal(current.attr('data-proxy-random-session').props.disabled, true);
    assert.match(plainText(current, current.attr('data-proxy-session')), /Session format: -session-\{session\}/);
    input(current, 'data-proxy-field', 'customer', 'username'); await current.settle();
    click(current, 'data-proxy-random-session'); await current.settle(); const first = current.attr('data-proxy-field', 'username').props.value; assert.match(first, /^customer-session-[a-z0-9]{10}$/);
    click(current, 'data-proxy-random-session'); await current.settle(); const second = current.attr('data-proxy-field', 'username').props.value; assert.match(second, /^customer-session-[a-z0-9]{10}$/); assert.notEqual(second, first);
    input(current, 'data-proxy-session-format', '-sessid-{session}-sesstime-10'); await current.settle();
    click(current, 'data-proxy-random-session'); await current.settle(); assert.match(current.attr('data-proxy-field', 'username').props.value, /^customer-session-[a-z0-9]{10}-sessid-[a-z0-9]{10}-sesstime-10$/);
    input(current, 'data-proxy-session-format', 'no-token-here'); await current.settle(); assert.equal(current.attr('data-proxy-random-session').props.disabled, true); assert.ok(current.attr('data-proxy-session-note', 'invalid')); assert.equal(current.attr('data-proxy-session-format').props['aria-invalid'], 'true');
    input(current, 'data-proxy-session-format', '_session-{session}'); current.attr('data-proxy-session-target').props.onChange({ currentTarget: { value: 'password' } }); await current.settle();
    assert.equal(current.attr('data-proxy-random-session').props.disabled, true, 'empty target field');
    input(current, 'data-proxy-field', 'secret', 'password'); await current.settle(); const username = current.attr('data-proxy-field', 'username').props.value;
    click(current, 'data-proxy-random-session'); await current.settle();
    assert.match(current.attr('data-proxy-field', 'password').props.value, /^secret_session-[a-z0-9]{10}$/); assert.equal(current.attr('data-proxy-field', 'username').props.value, username);
    assert.equal(current.source.count('saveProfile') + current.source.count('requestAccess'), 0);
  } finally { current.unmount(); }
});
test('routing and analyzer state the honest limits of direct domains, WebRTC protection and the TCP/IP fingerprint in all 21 languages', async () => {
  for (const language of PRODUCTION_LANGUAGES) {
    const messages = PROXY_WORKSPACE_MESSAGES[language.id], get = key => messages['proxy_workspace_' + key];
    assert.match(get('direct_domains_detail'), /IP/); assert.match(get('direct_domains_detail'), /DNS/);
    assert.match(get('protect_webrtc_detail'), /TURN/); assert.match(get('protect_webrtc_detail'), /TCP/);
    assert.match(get('tcp_fingerprint_detail'), /p0f/); for (const word of ['SOCKS5', 'HTTP', 'HTTPS', 'VLESS', 'OpenVPN']) assert.ok(get('tcp_fingerprint_detail').includes(word), language.id + ' ' + word);
    assert.ok(get('bulk_limit').includes(String(PROXY_LIMITS.profiles)), language.id); assert.ok(get('reason_too_many_lines').includes(String(PROXY_LIST_LIMITS.lines)), language.id);
    for (const key of ['session_format_detail', 'session_format_invalid']) assert.ok(get(key).includes('{session}'), language.id + ' ' + key);
    const placeholder = get('bulk_placeholder'); assert.equal(placeholder.split('\n').length, 7, language.id); assert.ok([...placeholder.matchAll(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g)].every(match => match[0].startsWith('203.0.113.')), language.id); assert.ok(placeholder.includes('[2001:db8::1]:1080'), language.id);
    if (['ar', 'ur'].includes(language.id)) for (const key of ['bulk_format_host_first', 'bulk_format_login_first']) assert.match(get(key), /^[a-z:]+$/, 'RTL field order stays Latin and readable left to right');
  }
  const current = await opened(); try {
    openPanel(current, 'analyzer'); assert.ok(current.attr('data-proxy-tcp-note'));
    openPanel(current, 'routing'); await current.settle();
    assert.ok(current.attr('data-proxy-direct-note')); assert.match(current.attr('data-proxy-domain-input', 'directDomains').props['aria-describedby'], /pm-domains-directDomains-note/);
    const webrtc = current.attr('data-proxy-setting', 'protectWebRTC'); assert.equal(webrtc.props['aria-describedby'], 'pm-tile-protectWebRTC-detail'); assert.equal(current.nodes(node => node.props?.id === 'pm-tile-protectWebRTC-detail').length, 1);
  } finally { current.unmount(); }
});

// ---- Round 5: HTTP and HTTPS profiles, the country tag, the saved check history -------------------------------------------------
const httpDraft = (patch = {}) => ({ ...proxyProfileDraft(null, 'http'), name: 'HTTP proxy', host: 'proxy.example.test', ...patch });
function memoryArea(initial) {
  const state = { value: initial, sets: 0, removes: 0 };
  return { state, local: { async get(key) { return state.value === undefined ? {} : { [key]: structuredClone(state.value) }; }, async set(value) { state.sets++; state.value = structuredClone(value[PROXY_HISTORY_KEY]); }, async remove() { state.removes++; state.value = undefined; } } };
}
const historyStore = area => createProxyHistoryStore({ storage: { local: area.local } });
const regionOptions = current => current.nodes(node => node.props?.['data-proxy-country-option']).map(node => node.props['data-proxy-country-option']);
const keyDown = (current, key, extra = {}) => { let prevented = false; current.attr('data-proxy-country-input').props.onKeyDown({ key, preventDefault() { prevented = true; }, ...extra }); return prevented; };
const typeIn = async (current, text) => { current.attr('data-proxy-country-input').props.onInput({ currentTarget: { value: text } }); await current.settle(); };
const passCheck = (ip, elapsedMs = 17, patch = {}) => ({ state: 'pass', reachable: true, remoteDns: true, tlsVerified: true, httpStatus: 200, ip, elapsedMs, ...patch });
const NL = String.fromCharCode(10);

test('pure editor helpers cover the five kinds and the tag: draft ports, bundle drafts, inputs and bulk inputs', () => {
  assert.deepEqual(['socks5', 'http', 'https', 'vless', 'openvpn'].map(type => proxyProfileDraft(null, type).port), ['1080', '8080', '443', '1080', '1080']);
  assert.equal(proxyProfileDraft({ id: 'x', name: 'x', type: 'http', host: 'h.example', port: 3128, country: 'DE' }).country, 'DE'); assert.equal(proxyProfileDraft().country, '');
  assert.deepEqual(proxyProfileInput(httpDraft({ port: '3128' })), { name: 'HTTP proxy', type: 'http', host: 'proxy.example.test', port: 3128 });
  assert.deepEqual(proxyProfileInput(httpDraft({ type: 'https', port: '443', username: 'u', password: 'p', country: 'JP' })), { name: 'HTTP proxy', type: 'https', host: 'proxy.example.test', port: 443, username: 'u', password: 'p', country: 'JP' });
  assert.equal(proxyProfileInput(httpDraft({ host: 'http.proxy/example' })), null); assert.equal(proxyProfileInput({ ...httpDraft(), type: 'ftp' }), null);
  assert.deepEqual(proxyProfileInput({ ...proxyProfileDraft(native), name: 'Renamed', country: 'FR' }), { id: native.id, name: 'Renamed', type: 'vless', country: 'FR' });
  const bundle = { format: 'detect.expert.proxy.bundle', version: 1, profiles: [{ id: 'h1', name: 'H', type: 'https', host: 'h.example', port: 8443, native: true, country: 'NL', connection: { type: 'https', host: 'h.example', port: 8443, username: 'u', password: 'p' } }] };
  assert.deepEqual(proxyDraftFromBundle({ id: 'h1', type: 'https' }, bundle), { ...proxyProfileDraft(bundle.profiles[0]), username: 'u', password: 'p' });
  assert.equal(proxyDraftFromBundle({ id: 'h1', type: 'http' }, bundle), null, 'a record of another kind never fills the editor');
  assert.deepEqual(proxyBulkInput({ name: 'A', profile: { type: 'http', host: 'h.example', port: 8080, username: '', password: '' } }, 'p-1'), { id: 'p-1', name: 'A', type: 'http', host: 'h.example', port: 8080 });
  assert.deepEqual(proxyBulkInput({ name: 'B', profile: { type: 'https', host: 'h.example', port: 443, username: 'u', password: 'p' } }, 'p-2'), { id: 'p-2', name: 'B', type: 'https', host: 'h.example', port: 443, username: 'u', password: 'p' });
  assert.deepEqual(proxyVisibleProfiles([{ ...direct, country: 'DE' }, native], 'de', 'all').map(profile => profile.id), ['direct'], 'the tag is searchable by its code');
  assert.deepEqual(proxyVisibleProfiles([{ ...direct, type: 'http' }, direct], 'http', 'all').map(profile => profile.type), ['http']);
});

test('five kinds in the selector and on the cards, and each editor says what is true of its kind', async () => {
  const current = await opened(); try {
    assert.deepEqual([...new Set(current.nodes(node => node.props?.['data-proxy-type-pill']).map(node => node.props['data-proxy-type-pill']))].sort(), ['socks5', 'vless'], 'the cards name their kind');
    click(current, 'data-proxy-new-type', 'http'); await current.settle();
    assert.equal(current.attr('data-proxy-type', 'http').props.role, 'radiogroup');
    assert.deepEqual(current.nodes(node => node.props?.['data-proxy-type-option']).map(node => node.props['data-proxy-type-option']), ['socks5', 'http', 'https', 'vless', 'openvpn']);
    assert.equal(current.attr('data-proxy-type-option', 'http').props['aria-checked'], true); assert.equal(current.attr('data-proxy-type-option', 'socks5').props['aria-checked'], false);
    assert.ok(current.attr('data-proxy-editor', 'http')); assert.equal(current.attr('data-proxy-field', 'port').props.value, '8080');
    assert.match(current.text(current.attr('data-proxy-type-detail', 'http')), /not encrypted/); assert.match(current.text(current.attr('data-proxy-relay-detail')), /CONNECT/);
    click(current, 'data-proxy-new-type', 'https'); await current.settle();
    assert.match(current.text(current.attr('data-proxy-type-detail', 'https')), /certificate is checked/); assert.ok(current.attr('data-proxy-relay-detail')); assert.equal(current.attr('data-proxy-field', 'port').props.value, '443');
    click(current, 'data-proxy-new-type', 'socks5'); await current.settle();
    assert.doesNotMatch(current.text(current.attr('data-proxy-type-detail', 'socks5')), /not encrypted/); assert.equal(current.attr('data-proxy-relay-detail'), undefined);
    assert.ok(current.attr('data-proxy-random-session'), 'the session helper stays for the kinds a provider hands out sessions for');
  } finally { current.unmount(); }
});

test('an HTTP or HTTPS profile saves like SOCKS5: no login needs no companion, a login asks for it once, the tag rides along', async () => {
  const source = server(), current = await opened({ source }); try {
    click(current, 'data-proxy-new-type', 'http'); await current.settle();
    for (const [key, value] of Object.entries({ name: 'Office HTTP', host: 'proxy.example.test' })) input(current, 'data-proxy-field', value, key);
    await current.settle(); await click(current, 'data-proxy-save-profile'); await current.settle();
    assert.equal(source.count('requestAccess'), 0); assert.deepEqual(source.calls.find(call => call.name === 'saveProfile').value, { name: 'Office HTTP', type: 'http', host: 'proxy.example.test', port: 8080 });
    assert.equal(source.state.snapshot.configuration.profiles.find(profile => profile.id === 'saved').native, false);
    click(current, 'data-proxy-new-type', 'https'); await current.settle();
    for (const [key, value] of Object.entries({ name: 'Secure HTTPS', host: 'secure.example.test', username: 'LOGIN_CANARY', password: 'PASSWORD_CANARY' })) input(current, 'data-proxy-field', value, key);
    await current.settle(); assert.equal(current.attr('data-proxy-field', 'password').props.type, 'password');
    const pending = click(current, 'data-proxy-save-profile'); assert.equal(source.count('requestAccess'), 1); assert.deepEqual(source.calls.at(-1).value, { native: true }); await pending; await current.settle();
    assert.deepEqual(source.calls.filter(call => call.name === 'saveProfile')[1].value, { name: 'Secure HTTPS', type: 'https', host: 'secure.example.test', port: 443, username: 'LOGIN_CANARY', password: 'PASSWORD_CANARY' });
    assert.doesNotMatch(current.text(), /LOGIN_CANARY|PASSWORD_CANARY/); assert.doesNotMatch(held(current), /LOGIN_CANARY|PASSWORD_CANARY/);
    assert.equal(source.count('connect'), 0);
  } finally { current.unmount(); }
});

test('switching among SOCKS5, HTTP and HTTPS keeps what was typed and moves only a prefilled port; VLESS starts clean but keeps name and tag', async () => {
  const current = await opened(); try {
    click(current, 'data-proxy-new-type', 'socks5'); await current.settle();
    for (const [key, value] of Object.entries({ name: 'Moving', host: 'move.example.test', username: 'LOGIN', password: 'SECRET' })) input(current, 'data-proxy-field', value, key);
    current.attr('data-proxy-country-input').props.onFocus(); await current.settle(); current.attr('data-proxy-country-option', 'DE').props.onMouseDown({ preventDefault() {} }); await current.settle();
    const select = value => { chooseType(current, value); return current.settle(); };
    await select('http'); assert.equal(current.attr('data-proxy-field', 'port').props.value, '8080'); assert.equal(current.attr('data-proxy-field', 'host').props.value, 'move.example.test'); assert.equal(current.attr('data-proxy-field', 'username').props.value, 'LOGIN'); assert.equal(current.attr('data-proxy-field', 'password').props.value, 'SECRET'); assert.match(current.attr('data-proxy-country-input').props.value, /DE$/);
    input(current, 'data-proxy-field', '3128', 'port'); await current.settle(); await select('https'); assert.equal(current.attr('data-proxy-field', 'port').props.value, '3128', 'a port the user chose stays');
    await select('vless'); assert.equal(current.attr('data-proxy-field', 'name').props.value, 'Moving'); assert.match(current.attr('data-proxy-country-input').props.value, /DE$/); assert.equal(current.attr('data-proxy-field', 'host'), undefined);
    await select('http'); assert.equal(current.attr('data-proxy-field', 'host').props.value, '', 'nothing of the old connection returns after a clean kind');
  } finally { current.unmount(); }
});

test('single-line paste reads a line without a scheme in the editor kind, and a scheme names its own kind', async () => {
  const current = await opened(); try {
    click(current, 'data-proxy-new-type', 'http'); await current.settle();
    input(current, 'data-proxy-paste', '203.0.113.5:8080:LOGIN_CANARY:PASSWORD_CANARY'); await current.settle();
    assert.match(plainText(current, current.attr('data-proxy-paste-preview', 'ok')), /Recognized: HTTP · 203\.0\.113\.5:8080 · with login/); assert.doesNotMatch(current.text(), /LOGIN_CANARY|PASSWORD_CANARY/);
    click(current, 'data-proxy-parse'); await current.settle();
    assert.ok(current.attr('data-proxy-editor', 'http')); assert.equal(current.attr('data-proxy-field', 'host').props.value, '203.0.113.5'); assert.equal(current.attr('data-proxy-field', 'username').props.value, 'LOGIN_CANARY');
    input(current, 'data-proxy-paste', 'https://203.0.113.6:8443'); await current.settle(); click(current, 'data-proxy-parse'); await current.settle();
    assert.ok(current.attr('data-proxy-editor', 'https')); assert.equal(current.attr('data-proxy-field', 'port').props.value, '8443');
    input(current, 'data-proxy-paste', 'socks4://203.0.113.7:1080'); await current.settle(); assert.ok(current.attr('data-proxy-paste-preview', 'invalid'));
    assert.equal(current.source.count('saveProfile') + current.source.count('requestAccess'), 0);
  } finally { current.unmount(); }
});

test('list import offers a type for lines without a scheme; each scheme keeps its own; only rows with a login need the companion', async () => {
  const source = server(), current = await opened({ source }); try {
    click(current, 'data-proxy-bulk-open'); await current.settle();
    assert.deepEqual(current.attr('data-proxy-bulk-type').props.children.map(option => option.props.value), ['socks5', 'http', 'https']); assert.equal(current.attr('data-proxy-bulk-type').props.value, 'socks5');
    current.attr('data-proxy-bulk-type').props.onChange({ currentTarget: { value: 'http' } }); await current.settle();
    input(current, 'data-proxy-bulk-text', ['203.0.113.1:8080 #Plain', 'socks5://203.0.113.2:1080', 'https://203.0.113.3:8443 #TLS', 'ftp://203.0.113.9:21'].join(NL)); await current.settle();
    click(current, 'data-proxy-bulk-parse'); await current.settle();
    assert.deepEqual([1, 2, 3, 4].map(line => current.attr('data-proxy-bulk-line', line).props['data-state']), ['ready', 'ready', 'ready', 'error']);
    assert.deepEqual([1, 2, 3].map(line => within(current.attr('data-proxy-bulk-line', line), node => node.props?.['data-proxy-type-pill'])[0].props['data-proxy-type-pill']), ['http', 'socks5', 'https']);
    assert.match(current.text(current.attr('data-proxy-bulk-status', 4)), /Only SOCKS5, HTTP, HTTPS and VLESS/);
    await click(current, 'data-proxy-bulk-save'); await current.settle();
    assert.equal(source.count('requestAccess'), 0, 'direct rows need no companion');
    assert.deepEqual(source.calls.filter(call => call.name === 'saveProfile').map(call => [call.value.type, call.value.host, call.value.port, 'username' in call.value]), [['http', '203.0.113.1', 8080, false], ['socks5', '203.0.113.2', 1080, false], ['https', '203.0.113.3', 8443, false]]);
    click(current, 'data-proxy-bulk-open'); await current.settle();
    current.attr('data-proxy-bulk-type').props.onChange({ currentTarget: { value: 'https' } }); input(current, 'data-proxy-bulk-text', '203.0.113.4:8443:BULK_USER:BULK_PASS #Login'); await current.settle(); click(current, 'data-proxy-bulk-parse'); await current.settle();
    const pending = click(current, 'data-proxy-bulk-save'); assert.equal(source.count('requestAccess'), 1); assert.deepEqual(source.calls.find(call => call.name === 'requestAccess').value, { native: true }); await pending; await current.settle();
    const last = source.calls.filter(call => call.name === 'saveProfile').at(-1).value;
    assert.deepEqual([last.type, last.host, last.port, last.username, last.password], ['https', '203.0.113.4', 8443, 'BULK_USER', 'BULK_PASS']);
    assert.doesNotMatch(held(current), /BULK_PASS/);
  } finally { current.unmount(); }
});

test('an HTTP or HTTPS profile that the installed companion is too old for says so; other kinds keep the generic message', async () => {
  for (const code of ['native-unsupported', 'unsupported-profile']) {
    const source = server(); source.state.failure = { name: 'saveProfile', code }; const current = await opened({ source }); try {
      click(current, 'data-proxy-new-type', 'https'); await current.settle();
      for (const [key, value] of Object.entries({ name: 'Old companion', host: 'proxy.example.test', username: 'u', password: 'p' })) input(current, 'data-proxy-field', value, key);
      await current.settle(); await click(current, 'data-proxy-save-profile'); await current.settle();
      assert.match(current.text(current.attr('data-proxy-error')), /companion is too old for HTTP and HTTPS/); assert.equal(current.attr('data-proxy-field', 'password').props.value, 'p');
      click(current, 'data-proxy-new-type', 'vless'); await current.settle(); input(current, 'data-proxy-field', 'V', 'name'); input(current, 'data-proxy-field', uri, 'uri'); await current.settle(); await click(current, 'data-proxy-save-profile'); await current.settle();
      assert.match(current.text(current.attr('data-proxy-error')), /not supported/); assert.doesNotMatch(current.text(current.attr('data-proxy-error')), /too old/);
    } finally { current.unmount(); }
  }
  const source = server(); source.state.snapshot.configuration.profiles = [{ ...direct, id: 'tls', type: 'https', port: 443 }, direct]; source.state.checkResults.tls = { state: 'fail', code: 'native-unsupported' }; source.state.checkResults.direct = { state: 'fail', code: 'native-unsupported' };
  const current = await opened({ source }); try {
    await click(current, 'data-proxy-check-visible'); await current.settle();
    assert.match(current.text(current.attr('data-proxy-profile-error', 'tls')), /too old/); assert.doesNotMatch(current.text(current.attr('data-proxy-profile-error', 'direct')), /too old/);
  } finally { current.unmount(); }
});

test('the three new fixed codes render fixed localized messages and no raw text', async () => {
  const source = server(); const current = await opened({ source, locale: 'ru' }); try {
    for (const [code, key] of [['proxy-denied', 'error_proxy_denied'], ['network-unreachable', 'error_network_unreachable'], ['host-unreachable', 'error_host_unreachable']]) {
      source.state.onChange({ ...source.state.snapshot, status: { state: 'blocked', code, phase: 'connect', retryable: false } }); await current.settle();
      assert.ok(current.attr('data-proxy-diagnostic', code)); assert.ok(current.text(current.attr('data-proxy-diagnostic', code)).includes(PROXY_WORKSPACE_MESSAGES.ru['proxy_workspace_' + key])); assert.doesNotMatch(current.text(), /UNTRUSTED/);
    }
  } finally { current.unmount(); }
  for (const language of PRODUCTION_LANGUAGES) for (const key of ['error_proxy_denied', 'error_network_unreachable', 'error_host_unreachable']) { const message = PROXY_WORKSPACE_MESSAGES[language.id]['proxy_workspace_' + key]; assert.ok(message.trim(), language.id + key); if (language.id !== 'en') assert.notEqual(message, PROXY_WORKSPACE_MESSAGES.en['proxy_workspace_' + key], language.id + ' ' + key); }
});

test('the country picker is a real combobox: it filters by name or code, selects by keyboard, ignores IME, closes on Escape and clears', async () => {
  const source = server(), current = await opened({ source }); try {
    click(current, 'data-proxy-new-type', 'http'); await current.settle();
    const field = current.attr('data-proxy-country-input'); assert.equal(field.props.role, 'combobox'); assert.equal(field.props['aria-expanded'], false); assert.equal(field.props['aria-autocomplete'], 'list'); assert.equal(field.props['aria-describedby'], 'proxy-country-hint proxy-country-status'); assert.match(current.text(current.attr('data-proxy-country-hint')), /never detected or filled in from an IP address/);
    current.attr('data-proxy-country-input').props.onFocus(); await current.settle(); assert.equal(current.attr('data-proxy-country-input').props['aria-expanded'], true); assert.ok(regionOptions(current).length > 200); assert.equal(current.attr('data-proxy-country-list').props.role, 'listbox');
    await typeIn(current, 'germ'); assert.equal(regionOptions(current)[0], 'DE'); assert.equal(current.attr('data-proxy-country-option', 'DE').props.role, 'option');
    await typeIn(current, 'fr'); assert.equal(regionOptions(current)[0], 'FR', 'an exact code ranks first');
    await typeIn(current, 'zzzz'); assert.equal(regionOptions(current).length, 0); assert.match(current.text(current.attr('data-proxy-country-status')), /No countries found/);
    await typeIn(current, 'ger'); assert.equal(keyDown(current, 'ArrowDown'), true); await current.settle(); assert.equal(current.attr('data-proxy-country-input').props['aria-activedescendant'], 'proxy-country-list-1');
    keyDown(current, 'ArrowUp'); await current.settle(); keyDown(current, 'ArrowUp'); await current.settle(); assert.equal(current.attr('data-proxy-country-input').props['aria-activedescendant'], 'proxy-country-list-' + (regionOptions(current).length - 1), 'the list wraps');
    await typeIn(current, 'germ'); keyDown(current, 'Enter', { isComposing: true }); await current.settle(); assert.equal(current.attr('data-proxy-country-input').props['aria-expanded'], true, 'an IME composition never picks');
    keyDown(current, 'Enter', { keyCode: 229 }); await current.settle(); assert.equal(current.attr('data-proxy-country-clear'), undefined);
    keyDown(current, 'Escape'); await current.settle(); assert.equal(current.attr('data-proxy-country-input').props['aria-expanded'], false);
    await typeIn(current, 'germ'); keyDown(current, 'Enter'); await current.settle();
    assert.equal(current.attr('data-proxy-country-input').props.value, 'Germany · DE'); assert.equal(current.attr('data-proxy-country-input').props['aria-expanded'], false); assert.ok(current.attr('data-proxy-country-clear'));
    for (const [key, value] of Object.entries({ name: 'Tagged', host: 'tagged.example.test' })) input(current, 'data-proxy-field', value, key);
    await current.settle(); await click(current, 'data-proxy-save-profile'); await current.settle();
    assert.deepEqual(source.calls.find(call => call.name === 'saveProfile').value, { name: 'Tagged', type: 'http', host: 'tagged.example.test', port: 8080, country: 'DE' });
    click(current, 'data-proxy-new-type', 'http'); await current.settle(); await typeIn(current, 'ja'); keyDown(current, 'ArrowDown'); keyDown(current, 'Enter'); await current.settle(); click(current, 'data-proxy-country-clear'); await current.settle();
    assert.equal(current.attr('data-proxy-country-input').props.value, ''); assert.equal(current.attr('data-proxy-country-clear'), undefined);
  } finally { current.unmount(); }
});

test('country names follow the interface language and the tag is shown as a chip with its code and name', async () => {
  const source = server(); source.state.snapshot.configuration.profiles = [{ ...direct, country: 'DE' }, native]; const current = await opened({ source, locale: 'ru' }); try {
    const chip = current.attr('data-proxy-country', 'DE'); assert.ok(chip); assert.equal(chip.props.title, PROXY_WORKSPACE_MESSAGES.ru.proxy_workspace_country_title); assert.equal(plainText(current, chip), 'DE Германия');
    assert.equal(current.attr('data-proxy-country', 'US'), undefined, 'a profile without a tag has no chip');
    click(current, 'data-proxy-new'); await current.settle(); current.attr('data-proxy-country-input').props.onFocus(); await typeIn(current, 'герм'); assert.equal(regionOptions(current)[0], 'DE');
    assert.match(current.text(current.attr('data-proxy-country-option', 'DE')), /Германия/);
  } finally { current.unmount(); }
  const english = await opened({ source }); try { assert.equal(plainText(english, english.attr('data-proxy-country', 'DE')), 'DE Germany'); input(english, 'data-proxy-search', 'de'); await english.settle(); assert.ok(english.attr('data-proxy-profile', 'direct')); assert.equal(english.attr('data-proxy-profile', 'native-vless'), undefined); } finally { english.unmount(); }
});

test('editing only the tag of a saved profile is metadata-only (no companion, no connection resent) and clearing it sends null', async () => {
  const source = server(); source.state.snapshot.configuration.profiles = [{ ...direct, country: 'US' }, native]; const current = await opened({ source }); try {
    await click(current, 'data-proxy-edit', direct.id); await current.settle();
    assert.match(current.attr('data-proxy-country-input').props.value, /US$/);
    await typeIn(current, 'ital'); keyDown(current, 'Enter'); await current.settle(); await click(current, 'data-proxy-save-profile'); await current.settle();
    assert.deepEqual(source.calls.filter(call => call.name === 'saveProfile')[0].value, { id: 'direct', type: 'socks5', host: direct.host, port: direct.port, name: direct.name, country: 'IT' });
    await click(current, 'data-proxy-edit', direct.id); await current.settle(); click(current, 'data-proxy-country-clear'); await current.settle(); await click(current, 'data-proxy-save-profile'); await current.settle();
    assert.deepEqual(source.calls.filter(call => call.name === 'saveProfile')[1].value, { id: 'direct', type: 'socks5', host: direct.host, port: direct.port, name: direct.name, country: null });
    assert.equal(source.count('requestAccess'), 0); assert.equal(current.attr('data-proxy-country', 'IT'), undefined);
  } finally { current.unmount(); }
  const plain = server(), untouched = await opened({ source: plain }); try {
    await click(untouched, 'data-proxy-edit', direct.id); await untouched.settle(); input(untouched, 'data-proxy-field', 'Only renamed', 'name'); await untouched.settle(); await click(untouched, 'data-proxy-save-profile'); await untouched.settle();
    assert.deepEqual(plain.calls.find(call => call.name === 'saveProfile').value, { id: 'direct', type: 'socks5', host: direct.host, port: direct.port, name: 'Only renamed' }, 'a profile that never had a tag is not given a country key');
  } finally { untouched.unmount(); }
});

test('history stays hidden while the store is unavailable and appears once it is readable', async () => {
  const plain = await opened(); try { openPeek(plain, direct.id); assert.ok(plain.attr('data-proxy-peek', direct.id)); assert.equal(plain.attr('data-proxy-history', direct.id), undefined); assert.equal(plain.attr('data-proxy-history-footer'), undefined); } finally { plain.unmount(); }
  const area = memoryArea(undefined), current = await opened({ history: historyStore(area) }); try {
    assert.ok(current.attr('data-proxy-history-footer')); assert.equal(current.attr('data-proxy-history-clear-all'), undefined, 'nothing to clear yet'); assert.equal(current.attr('data-proxy-history', direct.id), undefined, 'the timeline belongs to the details of one profile');
    openPeek(current, direct.id); await current.settle();
    assert.ok(current.attr('data-proxy-history', direct.id)); assert.match(current.text(current.attr('data-proxy-history-empty', direct.id)), /No manual checks recorded yet/); assert.equal(current.attr('data-proxy-history-clear', direct.id), undefined);
    assert.equal(current.attr('data-proxy-help-panel'), undefined); click(current, 'data-proxy-help'); await current.settle(); assert.match(current.text(current.attr('data-proxy-help-panel')), /Kept only on this computer/);
    assert.equal(area.state.sets + area.state.removes, 0, 'looking at the history writes nothing');
  } finally { current.unmount(); }
});

test('a completed manual check is recorded as one stay: the same exit IP extends it, a new IP starts a row with the changed badge and an announcement', async () => {
  const area = memoryArea(undefined), source = server(), current = await opened({ source, history: historyStore(area) }); try {
    input(current, 'data-proxy-check-target', 'https://owned.example.test/?PRIVATE_QUERY_CANARY=1'); await current.settle();
    openPeek(current, direct.id); await current.settle();
    source.state.checkResults.direct = passCheck('203.0.113.117', 17);
    await click(current, 'data-proxy-check-profile', direct.id); await current.settle();
    assert.equal(historyEntries(current), 1); assert.equal(current.attr('data-proxy-ip-changed-summary', direct.id), undefined);
    source.state.checkResults.direct = passCheck('203.0.113.117', 41, { httpStatus: 204 });
    await click(current, 'data-proxy-check-profile', direct.id); await current.settle();
    assert.equal(historyEntries(current), 1, 'the same exit IP is the same stay');
    const row = current.attr('data-proxy-history-entry', 0); assert.equal(row.props['data-state'], 'pass');
    assert.equal(current.attr('data-proxy-history-ip', 0).props.children, '203.0.113.117'); assert.equal(current.attr('data-proxy-history-ms', 0).props.children, '41 ms'); assert.equal(current.attr('data-proxy-history-status', 0).props.children, 'HTTP 204');
    assert.match(plainText(current, current.attr('data-proxy-history-stay', 0)), /^Same exit IP since .+ · checks: 2$/); assert.equal(current.attr('data-proxy-history-stay', 0).props['data-checks'], 2);
    assert.deepEqual(current.nodes(node => node.props?.['data-proxy-history-flag']).map(node => [node.props['data-proxy-history-flag'], node.props['data-state']]), [['dns', 'ok'], ['tls', 'ok']]);
    source.state.checkResults.direct = passCheck('203.0.113.200', 23);
    await click(current, 'data-proxy-check-profile', direct.id); await current.settle();
    assert.equal(historyEntries(current), 2); assert.ok(current.attr('data-proxy-ip-changed-summary', direct.id)); assert.ok(current.attr('data-proxy-ip-changed', 0)); assert.equal(current.attr('data-proxy-ip-changed', 1), undefined);
    assert.equal(current.attr('data-proxy-history-ip', 0).props.children, '203.0.113.200'); assert.equal(current.attr('data-proxy-history-stay', 0), undefined, 'a single check has no stay line'); assert.equal(current.attr('data-proxy-history-stay', 1).props['data-checks'], 2);
    assert.ok(current.announcements.includes('Direct SOCKS: Exit IP changed'));
    assert.deepEqual(Object.keys(area.state.value.items), ['direct']); assert.equal(area.state.value.items.direct.length, 2);
    assert.doesNotMatch(JSON.stringify(area.state.value), /PRIVATE_QUERY_CANARY|owned\.example|http/i); assert.doesNotMatch(current.text(), /PRIVATE_QUERY_CANARY/);
  } finally { current.unmount(); }
});

test('failed checks are history only when the companion reported them; checks that could not run leave no trace', async () => {
  const area = memoryArea(undefined), source = server(), current = await opened({ source, history: historyStore(area) }); try {
    source.state.checkResults.direct = { state: 'fail', code: 'auth-failed', phase: 'auth', retryable: false };
    await click(current, 'data-proxy-check-profile', direct.id); await current.settle();
    source.state.checkResults.direct = { state: 'fail', code: 'native-unavailable', phase: 'native', retryable: true };
    await click(current, 'data-proxy-check-profile', direct.id); await current.settle();
    source.client.checkProfile = async () => { throw Object.assign(Error('UNTRUSTED'), { code: 'timeout' }); };
    await click(current, 'data-proxy-check-profile', direct.id); await current.settle();
    source.client.checkProfile = async () => { throw Object.assign(Error('UNTRUSTED'), { code: 'busy', phase: 'tunnel' }); };
    await click(current, 'data-proxy-check-profile', direct.id); await current.settle();
    // Even a code and a phase that would be history in a reply are not history when the call itself failed.
    source.client.checkProfile = async () => { throw Object.assign(Error('UNTRUSTED'), { code: 'timeout', phase: 'tunnel', retryable: true }); };
    await click(current, 'data-proxy-check-profile', direct.id); await current.settle();
    assert.equal(area.state.value.items.direct.length, 1); assert.equal(area.state.value.items.direct[0].code, 'auth-failed');
    openPeek(current, direct.id); await current.settle();
    assert.equal(current.attr('data-proxy-history-entry', 0).props['data-state'], 'fail'); assert.match(plainText(current, current.attr('data-proxy-history-result', 0)), /Check failed.*auth-failed/);
    assert.equal(current.attr('data-proxy-history-ms', 0).props.children, '—'); assert.equal(current.attr('data-proxy-history-ip', 0), undefined, 'a failed check has no address'); assert.equal(current.attr('data-proxy-history-status', 0), undefined, 'and no HTTP status');
    assert.equal(current.attr('data-proxy-ip-changed', 0), undefined);
  } finally { current.unmount(); }
});

test('the connected-profile analyzer records its result for the active profile as well', async () => {
  const area = memoryArea(undefined), source = connectedSource(), current = await opened({ source, history: historyStore(area) }); try {
    await click(current, 'data-proxy-check'); await current.settle();
    assert.equal(area.state.value.items.direct[0].ip, '203.0.113.41'); assert.equal(area.state.value.items.direct[0].ms, 42);
    source.state.failure = { name: 'diagnose', code: 'tls-failed', phase: 'tls', retryable: false }; input(current, 'data-proxy-check-target', 'https://owned.example.test/'); await current.settle(); await click(current, 'data-proxy-check'); await current.settle();
    assert.deepEqual(area.state.value.items.direct.map(entry => entry.code), ['', 'tls-failed']); assert.equal(area.state.value.items.direct[1].tls, 'fail');
    source.state.failure = { name: 'requestAccess', code: 'permission-denied' }; await click(current, 'data-proxy-check'); await current.settle();
    assert.equal(area.state.value.items.direct.length, 2, 'a refused permission is not a check result');
  } finally { current.unmount(); }
});

test('clearing history asks first, works for one profile or all, and says so', async () => {
  const area = memoryArea(undefined), source = server(), current = await opened({ source, history: historyStore(area) }); try {
    for (const id of [direct.id, native.id]) { await click(current, 'data-proxy-check-profile', id); await current.settle(); }
    assert.deepEqual(Object.keys(area.state.value.items).sort(), ['direct', 'native-vless']);
    openPeek(current, direct.id); await current.settle(); click(current, 'data-proxy-history-clear', direct.id); await current.settle();
    assert.ok(current.attr('data-proxy-history-confirm', direct.id)); assert.match(current.text(current.attr('data-proxy-history-confirm', direct.id)), /Delete the saved check history of this profile\?/); assert.equal(Object.keys(area.state.value.items).length, 2);
    click(current, 'data-proxy-history-keep'); await current.settle(); assert.equal(current.attr('data-proxy-history-confirm', direct.id), undefined); assert.equal(Object.keys(area.state.value.items).length, 2);
    click(current, 'data-proxy-history-clear', direct.id); await current.settle(); await click(current, 'data-proxy-history-clear-confirm', direct.id); await current.settle();
    assert.deepEqual(Object.keys(area.state.value.items), ['native-vless']); assert.match(current.text(current.attr('data-proxy-notice')), /Check history cleared/); assert.ok(current.attr('data-proxy-history-empty', direct.id));
    click(current, 'data-proxy-history-clear-all'); await current.settle(); assert.match(current.text(current.attr('data-proxy-history-confirm', 'all')), /all profiles/); await click(current, 'data-proxy-history-clear-confirm', 'all'); await current.settle();
    assert.equal(area.state.value, undefined); assert.equal(current.attr('data-proxy-history-clear-all'), undefined);
  } finally { current.unmount(); }
});

test('deleting a profile or changing its connection clears that profile history; a rename or a tag edit keeps it', async () => {
  const area = memoryArea(undefined), source = server(), current = await opened({ source, history: historyStore(area) }); try {
    for (const id of [direct.id, native.id]) { await click(current, 'data-proxy-check-profile', id); await current.settle(); }
    await click(current, 'data-proxy-edit', direct.id); await current.settle(); input(current, 'data-proxy-field', 'Renamed only', 'name'); await current.settle(); await click(current, 'data-proxy-save-profile'); await current.settle();
    assert.deepEqual(Object.keys(area.state.value.items).sort(), ['direct', 'native-vless'], 'a rename keeps the history');
    await click(current, 'data-proxy-edit', direct.id); await current.settle(); await typeIn(current, 'ital'); keyDown(current, 'Enter'); await current.settle(); await click(current, 'data-proxy-save-profile'); await current.settle();
    assert.deepEqual(Object.keys(area.state.value.items).sort(), ['direct', 'native-vless'], 'a tag edit keeps the history');
    await click(current, 'data-proxy-edit', direct.id); await current.settle(); input(current, 'data-proxy-field', 'other.example.test', 'host'); await current.settle(); await click(current, 'data-proxy-save-profile'); await current.settle();
    assert.deepEqual(Object.keys(area.state.value.items), ['native-vless'], 'the old results described another server');
    click(current, 'data-proxy-remove', native.id); await current.settle(); await click(current, 'data-proxy-remove-confirm'); await current.settle();
    assert.equal(area.state.value, undefined);
  } finally { current.unmount(); }
});

test('hiding the page drops the displayed history and showing it reads the store again', async () => {
  const area = memoryArea(undefined), source = server(), current = await opened({ source, history: historyStore(area) }); try {
    await click(current, 'data-proxy-check-profile', direct.id); await current.settle(); openPeek(current, direct.id); await current.settle();
    assert.equal(historyEntries(current), 1); assert.ok(current.attr('data-proxy-history-footer'));
    current.hide(); await current.settle(); assert.equal(current.attr('data-proxy-history', direct.id), undefined); assert.equal(current.attr('data-proxy-history-footer'), undefined); assert.equal(historyEntries(current), 0);
    current.show(); await current.settle(); assert.ok(current.attr('data-proxy-history-footer')); assert.equal(historyEntries(current), 1, 'the store is read again');
    current.pagehide(); await current.settle(); assert.equal(current.attr('data-proxy-history-footer'), undefined); assert.equal(historyEntries(current), 0);
  } finally { current.unmount(); }
});

test('the history panel is labelled, keyboard reachable and localized in every language, with no placeholder left unreplaced', async () => {
  for (const language of PRODUCTION_LANGUAGES) {
    const area = memoryArea(undefined), source = server(), current = await opened({ source, history: historyStore(area), locale: language.id }); try {
      for (const ip of ['203.0.113.1', '203.0.113.1', '203.0.113.2']) { source.state.checkResults.direct = passCheck(ip); await click(current, 'data-proxy-check-profile', direct.id); await current.settle(); }
      openPeek(current, direct.id); await current.settle();
      const messages = PROXY_WORKSPACE_MESSAGES[language.id], panel = current.attr('data-proxy-history', direct.id), title = current.nodes(node => node.props?.id === 'proxy-history-title-direct');
      assert.equal(panel.props['aria-labelledby'], 'proxy-history-title-direct'); assert.equal(title.length, 1); assert.ok(plainText(current, title[0]).includes(messages.proxy_workspace_history_title), language.id);
      assert.equal(current.nodes(node => node.type === 'button' && node.props['data-proxy-open'] && node.props.type !== 'button').length, 0);
      assert.doesNotMatch(current.text(panel), /\{time\}|\{count\}|proxy_workspace_/); assert.ok(current.text(current.attr('data-proxy-history-stay', 1)).includes('2'), language.id);
      const table = current.attr('data-proxy-history-table', direct.id); assert.equal(table.type, 'ol', language.id); assert.ok(table.props['aria-label'].includes(messages.proxy_workspace_history_title), language.id); assert.equal(historyEntries(current), 2, language.id);
    } finally { current.unmount(); }
  }
});

test('the new copy exists, is authored per language and says only what is true', () => {
  const keys = ['http_detail', 'https_detail', 'http_relay_detail', 'bulk_default_type', 'error_update_companion', 'country_label', 'country_hint', 'country_none', 'country_no_results', 'country_clear', 'country_title', 'history', 'history_title', 'history_empty', 'history_note', 'history_time', 'history_clear', 'history_clear_all', 'history_clear_confirm', 'history_clear_all_confirm', 'history_cleared', 'history_stay', 'history_unknown', 'ip_changed', 'ip_changed_detail', 'login_unchecked', 'error_auth_required'];
  for (const language of PRODUCTION_LANGUAGES) {
    const messages = PROXY_WORKSPACE_MESSAGES[language.id], get = key => messages['proxy_workspace_' + key];
    for (const key of keys) { assert.ok(get(key) && get(key) === get(key).trim(), language.id + ' ' + key); if (language.id !== 'en') assert.notEqual(get(key), PROXY_WORKSPACE_MESSAGES.en['proxy_workspace_' + key], language.id + ' ' + key + ' is untranslated'); }
    assert.ok(get('history_stay').includes('{time}') && get('history_stay').includes('{count}'), language.id);
    for (const key of ['http_detail', 'https_detail', 'http_relay_detail']) assert.match(get(key), /HTTPS?/, language.id + ' ' + key);
    assert.match(get('http_relay_detail'), /CONNECT/, language.id); assert.match(get('history_note'), /30/, language.id); assert.match(get('history_note'), /10/, language.id);
    assert.match(get('country_hint'), /IP/, language.id); assert.match(get('country_hint'), /Antidetect/, language.id);
    assert.match(get('reason_unsupported_scheme'), /HTTPS/, language.id); assert.match(get('reason_invalid_credentials'), /255/, language.id); assert.match(get('bulk_detail'), /HTTPS/, language.id);
    assert.match(get('companion_detail'), /HTTPS/, language.id); assert.match(get('companion_detail'), /TCP/, language.id);
    for (const key of ['http_detail', 'https_detail']) { assert.match(get(key), /Basic/, language.id + ' ' + key); assert.match(get(key), /Digest/, language.id + ' ' + key); assert.match(get(key), /NTLM/, language.id + ' ' + key); }
    assert.match(get('http_relay_detail'), /80/, language.id); assert.ok(get('http_relay_detail').includes(get('check_connection')), language.id + ': the relay note names the button that verifies the login');
    for (const key of ['bulk_format', 'reason_wrong_order']) assert.ok(!/\(SOCKS5\)/.test(get(key)), language.id + ' ' + key);
    assert.ok(get('reason_wrong_order').includes(get('bulk_format')), language.id + ': the hint quotes the label it asks to change');
  }
  const en = PROXY_WORKSPACE_MESSAGES.en;
  assert.match(en.proxy_workspace_login_unchecked, /not verified/); assert.doesNotMatch(en.proxy_workspace_login_unchecked, /works|valid|correct/); assert.match(en.proxy_workspace_http_relay_detail, /Connecting only checks that the proxy answers/);
  assert.match(en.proxy_workspace_http_detail, /not encrypted/); assert.match(en.proxy_workspace_https_detail, /certificate is checked/); assert.match(en.proxy_workspace_country_hint, /never detected/);
  assert.doesNotMatch(Object.values(en).join(NL), /anonym|invisib|undetectab|stealth|100 ?%|guarantee|legitimate/i);
});

test('auth-required has its own message: the proxy asked for a login this profile does not have', async () => {
  const source = server(), current = await opened({ source }); try {
    source.state.onChange({ ...source.state.snapshot, status: { state: 'blocked', code: 'auth-required', phase: 'auth', retryable: false } }); await current.settle();
    const missing = current.text(current.attr('data-proxy-diagnostic', 'auth-required'));
    assert.ok(missing.includes('The proxy asks for a login, but this profile has none.'), missing); assert.ok(!missing.includes('Authentication failed'), 'a missing login is not a rejected one');
    source.state.onChange({ ...source.state.snapshot, status: { state: 'blocked', code: 'auth-failed', phase: 'auth', retryable: false } }); await current.settle();
    const rejected = current.text(current.attr('data-proxy-diagnostic', 'auth-failed')); assert.ok(rejected.includes('Authentication failed'), rejected); assert.ok(!rejected.includes('has none'));
  } finally { current.unmount(); }
  const checked = server(); checked.state.snapshot.configuration.profiles = [{ ...direct, id: 'web', type: 'http', port: 8080 }];
  checked.state.checkResults.web = { state: 'fail', code: 'auth-required', phase: 'auth', retryable: false };
  const rows = await opened({ source: checked }); try {
    await click(rows, 'data-proxy-check-visible'); await rows.settle();
    assert.match(rows.text(rows.attr('data-proxy-profile-error', 'web')), /asks for a login, but this profile has none/); assert.doesNotMatch(rows.text(rows.attr('data-proxy-profile-error', 'web')), /Authentication failed/);
  } finally { rows.unmount(); }
  for (const language of PRODUCTION_LANGUAGES) {
    const messages = PROXY_WORKSPACE_MESSAGES[language.id], get = key => messages['proxy_workspace_' + key];
    assert.notEqual(get('error_auth_required'), get('error_auth'), language.id + ': missing and rejected logins read differently');
    assert.notEqual(get('error_proxy_denied'), get('error_auth_required'), language.id);
  }
});

test('connecting to an HTTP or HTTPS proxy with a login says the login is not verified yet and offers the check; a result or another profile removes the note', async () => {
  const withLogin = { id: 'tls', name: 'HTTPS login', type: 'https', host: 'proxy.example.test', port: 443, native: true };
  const withLogin2 = { ...withLogin, id: 'tls2', name: 'HTTPS login two' }, withLogin3 = { ...withLogin, id: 'tls3', name: 'HTTPS login three' };
  const plain = { id: 'plain', name: 'HTTP plain', type: 'http', host: 'proxy.example.test', port: 8080, native: false };
  const socksLogin = { ...direct, id: 'socks-login', name: 'SOCKS login', native: true };
  const source = server(); source.state.snapshot.configuration.profiles = [withLogin, withLogin2, withLogin3, plain, socksLogin, native, direct];
  const current = await opened({ source }); try {
    const note = () => current.attr('data-proxy-login-note', 'https');
    assert.equal(current.nodes(node => 'data-proxy-login-note' in node.props).length, 0, 'nothing is connected yet');
    await click(current, 'data-proxy-connect', 'tls'); await current.settle();
    assert.ok(note()); assert.equal(note().props.role, 'status'); assert.match(current.text(note()), /login of an HTTP or HTTPS proxy is not verified while connecting/);
    assert.equal(current.attr('data-proxy-check-after-connect').props.disabled, false); assert.equal(source.count('diagnose'), 0, 'nothing is requested by showing the note');
    let complete; source.state.pendingDiagnostic = new Promise(resolve => { complete = resolve; }); const accessBefore = source.count('requestAccess');
    const pending = click(current, 'data-proxy-check-after-connect'); await current.settle();
    assert.equal(source.count('requestAccess') - accessBefore, 1); assert.equal(source.count('diagnose'), 1); assert.equal(current.attr('data-proxy-check-after-connect').props.disabled, true, 'one check at a time'); assert.match(current.text(note()), /Checking/);
    complete({ ...source.state.snapshot, diagnostic: { state: 'pass', reachable: true, remoteDns: true, tlsVerified: true, httpStatus: 200, ip: '203.0.113.41', elapsedMs: 42 } }); await pending; await current.settle();
    assert.equal(current.nodes(node => 'data-proxy-login-note' in node.props).length, 0, 'a result replaces the note'); assert.ok(current.attr('data-proxy-check-state', 'pass'));
    // Another profile starts without a result; a failed check removes the note as well, because the failure is what the user needs to read.
    source.state.pendingDiagnostic = null; source.state.diagnosticResult = { state: 'fail', code: 'auth-failed', phase: 'auth', retryable: false };
    await click(current, 'data-proxy-disconnect'); await current.settle(); await click(current, 'data-proxy-connect', 'tls2'); await current.settle(); assert.ok(current.attr('data-proxy-login-note', 'https'), 'another profile has no result yet');
    await click(current, 'data-proxy-check-after-connect'); await current.settle(); assert.equal(current.nodes(node => 'data-proxy-login-note' in node.props).length, 0); assert.match(current.text(current.attr('data-proxy-check-failure')), /Authentication failed/);
    // A result stays with its profile for as long as its configuration does not change, so a reconnect does not repeat the reminder.
    await click(current, 'data-proxy-disconnect'); await current.settle(); await click(current, 'data-proxy-connect', 'tls'); await current.settle();
    assert.equal(current.nodes(node => 'data-proxy-login-note' in node.props).length, 0, 'a profile that was just checked needs no reminder');
    // The check of a saved profile in the manager verifies the login too.
    await click(current, 'data-proxy-disconnect'); await current.settle(); source.state.diagnosticResult = null; await click(current, 'data-proxy-check-profile', 'tls3'); await current.settle(); await click(current, 'data-proxy-connect', 'tls3'); await current.settle();
    assert.equal(current.nodes(node => 'data-proxy-login-note' in node.props).length, 0, 'the manager check counts');
    // No note where connecting does verify what is needed: no login, a SOCKS5 negotiation, an engine.
    for (const id of ['plain', 'socks-login', 'native-vless', 'direct']) { await click(current, 'data-proxy-disconnect'); await current.settle(); await click(current, 'data-proxy-connect', id); await current.settle(); assert.equal(current.nodes(node => 'data-proxy-login-note' in node.props).length, 0, id); }
    await click(current, 'data-proxy-disconnect'); await current.settle(); assert.equal(current.nodes(node => 'data-proxy-login-note' in node.props).length, 0, 'disconnected');
  } finally { current.unmount(); }
  for (const language of PRODUCTION_LANGUAGES) {
    const messages = PROXY_WORKSPACE_MESSAGES[language.id]; assert.match(messages.proxy_workspace_login_unchecked, /HTTP/, language.id); assert.ok(messages.proxy_workspace_login_unchecked.includes(messages.proxy_workspace_check_connection), language.id + ' names the button it points to');
  }
});

test('an older companion is called outdated on the companion panel only while HTTP or HTTPS is missing from its capabilities', async () => {
  const source = server(), current = await opened({ source }); try {
    const hint = value => current.attr('data-proxy-companion-outdated', value), anyHint = () => current.nodes(node => 'data-proxy-companion-outdated' in node.props);
    click(current, 'data-proxy-panel', 'companion'); await current.settle(); assert.equal(anyHint().length, 0, 'nothing is known before the companion is asked');
    await click(current, 'data-proxy-companion-check'); await current.settle();
    assert.ok(hint('http https')); assert.match(current.text(hint('http https')), /too old for HTTP and HTTPS/); assert.equal(hint('http https').props.role, 'status');
    source.state.hostCapabilities = { socks5: true, http: true, https: false, vless: true, openvpn: true, vault: true };
    await click(current, 'data-proxy-companion-check'); await current.settle(); assert.ok(hint('https')); assert.equal(anyHint().length, 1);
    source.state.hostCapabilities = { socks5: true, http: 'yes', https: true, vless: true, openvpn: true, vault: true };
    await click(current, 'data-proxy-companion-check'); await current.settle(); assert.ok(hint('http'), 'only the boolean true counts');
    source.state.hostCapabilities = { socks5: true, http: true, https: true, vless: true, openvpn: true, vault: true };
    await click(current, 'data-proxy-companion-check'); await current.settle(); assert.equal(anyHint().length, 0); assert.ok(current.text().includes('SOCKS5, HTTP, HTTPS, VLESS, OpenVPN'), 'the listed kinds name HTTP and HTTPS');
  } finally { current.unmount(); }
});

// ======================================================================================================================================
// ADR-070 (UI only): the companion download notice. The Windows companion is a separate download from GitHub Releases that the extension
// never fetches. The notice says which proxy types need it and links to the download; it is a function of the loaded state alone.
const NOTICE = 'data-proxy-companion-notice', DOWNLOAD = 'data-proxy-companion-download';
const noticeNodes = current => current.nodes(node => NOTICE in node.props);
const downloadLinks = (current, place) => current.nodes(node => node.props[DOWNLOAD] === place);
const sourceWithHost = host => { const source = server(); source.state.snapshot = { ...source.state.snapshot, host }; return source; };
const COMPANION_MISSING = { available: false };
const COMPANION_FOUND = { available: true, version: 1, capabilities: { socks5: true, http: true, https: true, vless: true, openvpn: true, vault: true } };
const NOTICE_FIELDS = ['companion_notice_title', 'companion_notice', 'companion_download', 'companion_new_tab'];
function walk(node, visit) { if (Array.isArray(node)) return node.forEach(child => walk(child, visit)); if (!node?.props) return; visit(node); walk(node.props.children, visit); }

test('the companion download address is one pinned GitHub Releases link, written once in the Proxy sources and never inside the copy', async () => {
  assert.equal(PROXY_COMPANION_DOWNLOAD_URL, 'https://github.com/vektort13/Detect.Expert/releases/latest');
  const url = new URL(PROXY_COMPANION_DOWNLOAD_URL);
  assert.deepEqual([url.protocol, url.hostname, url.pathname, url.port, url.username, url.password, url.search, url.hash], ['https:', 'github.com', '/vektort13/Detect.Expert/releases/latest', '', '', '', '', '']);
  assert.equal(url.href, PROXY_COMPANION_DOWNLOAD_URL, 'already in canonical form: nothing is normalised away');
  const written = [], extension = new URL('../../apps/production-extension/', import.meta.url), scripts = new URL('../', import.meta.url);
  for (const [directory, pattern] of [[extension, /^proxy-.*\.(?:js|html|css)$/], [scripts, /^production-locales-proxy.*\.mjs$/]]) {
    for (const name of (await readdir(directory)).filter(name => pattern.test(name))) if (/github\.com/i.test(await readFile(new URL(name, directory), 'utf8'))) written.push(name);
  }
  assert.deepEqual(written, ['proxy-shared.js'], 'the address is written in one place: no Proxy page, stylesheet or copy repeats it');
  for (const language of PRODUCTION_LANGUAGES) for (const key of NOTICE_FIELDS) assert.doesNotMatch(PROXY_WORKSPACE_MESSAGES[language.id]['proxy_workspace_' + key], /github\.com|https?:\/\//i, language.id + ' ' + key + ': the copy names GitHub, it holds no address');
});

test('the companion notice never shows while the state loads, and shows only from a loaded state that does not know the companion to be available', async () => {
  const source = sourceWithHost(COMPANION_MISSING); let release = null;
  source.client.load = () => new Promise(resolve => { release = () => resolve(source.state.snapshot); });
  const current = harness({ source }); try {
    for (let index = 0; index < 5; index++) { current.render(); await current.settle(); assert.equal(noticeNodes(current).length, 0, 'render ' + index + ' while the state loads'); }
    assert.equal(typeof release, 'function', 'the load was requested and is still pending');
    release(); await current.settle(); assert.equal(noticeNodes(current).length, 1, 'once the state has loaded');
  } finally { current.unmount(); }
  for (const [label, host, shown] of [['no host information', undefined, false], ['a companion that is available', COMPANION_FOUND, false], ['a companion that is missing', COMPANION_MISSING, true], ['an available flag that is not the boolean true', { available: 'true' }, true]]) {
    const other = await opened({ source: sourceWithHost(host) }); try { assert.equal(noticeNodes(other).length, shown ? 1 : 0, label); } finally { other.unmount(); }
  }
  const failing = sourceWithHost(COMPANION_MISSING); failing.state.failure = { name: 'load', code: 'timeout' };
  const failed = await opened({ source: failing }); try { assert.equal(failed.source.count('load'), 1); assert.equal(noticeNodes(failed).length, 0, 'a state that failed to load shows its error and no notice'); } finally { failed.unmount(); }
});

test('the companion notice names the proxy types, says where the program comes from and links to the download in a new tab without opener or referrer', async () => {
  const current = await opened({ source: sourceWithHost(COMPANION_MISSING) }); try {
    const notice = current.attr(NOTICE, 'download'); assert.ok(notice); assert.equal(noticeNodes(current).length, 1);
    const text = current.text(notice), messages = current.table;
    assert.equal(notice.props.role, 'region'); assert.equal(notice.props['aria-label'], messages.proxy_workspace_companion_notice_title.message);
    assert.ok(text.includes(messages.proxy_workspace_companion_notice_title.message)); assert.ok(text.includes(messages.proxy_workspace_companion_notice.message));
    for (const phrase of ['VLESS', 'OpenVPN', 'SOCKS5', 'HTTP or HTTPS proxies with a login', 'small companion program for Windows', 'separate download from GitHub', 'never downloads or installs it', 'Extract the archive and run the installer', 'without a login work without it']) assert.ok(text.includes(phrase), phrase);
    const links = downloadLinks(current, 'notice'); assert.equal(links.length, 1); const link = links[0];
    assert.equal(link.type, 'a'); assert.equal(link.props.href, PROXY_COMPANION_DOWNLOAD_URL); assert.equal(link.props.target, '_blank');
    assert.deepEqual([...new Set(link.props.rel.split(' '))].sort(), ['noopener', 'noreferrer'], 'no opener and no referrer');
    assert.equal(link.props.onClick, undefined, 'a plain link: the browser opens it and the page does not intercept the click'); assert.equal(link.props.download, undefined);
    assert.match(current.text(link), /^Download from GitHub \(opens in a new tab\)\s*$/, 'a name for people and screen readers; it says the link leaves for a new tab');
    assert.doesNotMatch(current.text(link), /github\.com|https?:/i, 'the text of the link is not the address');
    const inside = []; walk(notice, node => inside.push(node));
    assert.deepEqual(inside.filter(node => node.type === 'a').length, 1, 'one link'); assert.equal(inside.filter(node => node.type === 'button' || node.props.onClick || node.props.onKeyDown).length, 0, 'no button, no handler: nothing to dismiss or confirm');
    assert.equal(current.source.count('hostStatus'), 0); assert.equal(current.source.count('requestAccess'), 0); assert.equal(current.source.count('load'), 1, 'showing the notice asks the service for nothing');
  } finally { current.unmount(); }
  const routeSource = await readFile(new URL('../../apps/production-extension/proxy-route-ui.js', import.meta.url), 'utf8');
  const body = routeSource.slice(routeSource.indexOf('function companionNotice'), routeSource.indexOf('function companionPanel'));
  assert.ok(body.length > 200 && body.includes('data-proxy-companion-notice'), 'the notice function was found');
  assert.doesNotMatch(body, /storage|useState|useEffect|setTimeout|setInterval|fetch|connectNative|onClick|dismiss/i, 'it keeps no state, stores nothing and cannot be dismissed');
});

test('the companion notice follows the companion state without a flash: it stays while a check runs, goes when the check finds the companion and returns if it is lost', async () => {
  const source = sourceWithHost(COMPANION_MISSING); let finish = null;
  source.client.hostStatus = () => new Promise(resolve => { finish = () => { source.state.snapshot = { ...source.state.snapshot, host: COMPANION_FOUND }; resolve(source.state.snapshot); }; });
  const current = await opened({ source }); try {
    assert.equal(noticeNodes(current).length, 1);
    const pending = current.attr('data-proxy-companion-check-banner').props.onClick();
    for (let index = 0; index < 4; index++) { current.render(); await current.settle(); assert.equal(noticeNodes(current).length, 1, 'still shown while the check runs (' + index + ')'); }
    finish(); await pending; await current.settle();
    assert.equal(noticeNodes(current).length, 0, 'gone once the companion is found'); assert.equal(downloadLinks(current, 'notice').length, 0);
    source.state.onChange({ ...source.state.snapshot, host: COMPANION_MISSING }); await current.settle(); assert.equal(noticeNodes(current).length, 1, 'back when the service reports the companion lost');
    source.state.onChange({ ...source.state.snapshot, host: COMPANION_FOUND }); await current.settle(); assert.equal(noticeNodes(current).length, 0);
  } finally { current.unmount(); }
});

test('the notice sits above the existing companion banner, which keeps its own actions, and the Companion section repeats the download link', async () => {
  const current = await opened({ source: sourceWithHost(COMPANION_MISSING) }); try {
    assert.ok(current.attr('data-proxy-companion-banner', 'missing'), 'a saved profile needs the companion, so the status banner is there too');
    assert.deepEqual(current.nodes(node => NOTICE in node.props || 'data-proxy-companion-banner' in node.props).map(node => NOTICE in node.props ? 'notice' : 'banner'), ['notice', 'banner']);
    assert.ok(current.attr('data-proxy-companion-steps')); assert.ok(current.attr('data-proxy-companion-check-banner'));
    assert.equal(downloadLinks(current, 'panel').length, 0, 'the closed section has no link');
    click(current, 'data-proxy-panel', 'companion'); await current.settle();
    const panel = current.attr('data-proxy-panel-body', 'companion'), link = downloadLinks(current, 'panel')[0]; assert.ok(link);
    assert.equal(link.props.href, PROXY_COMPANION_DOWNLOAD_URL); assert.equal(link.props.target, '_blank'); assert.deepEqual([...new Set(link.props.rel.split(' '))].sort(), ['noopener', 'noreferrer']); assert.equal(link.props.onClick, undefined);
    assert.match(current.text(panel), /Download the companion archive from GitHub \(Releases\), extract it and run the installer:/);
    assert.match(current.text(link), /^Download from GitHub \(opens in a new tab\)\s*$/);
    assert.equal(downloadLinks(current, 'notice').length, 1, 'both links lead to the same place');
  } finally { current.unmount(); }
});

// The word each language already uses for the companion in its neighbouring Proxy strings: [in the notice, in the install line].
const COMPANION_TERMS = Object.freeze({
  ru: ['компаньон', 'компаньон'], en: ['companion', 'companion'], zh_CN: ['助手', '助手'], vi: ['đi kèm', 'đi kèm'], es: ['auxiliar', 'auxiliar'], ar: ['مرافق', 'المرافق'], uk: ['компаньйон', 'компаньйон'],
  fr: ['compagnon', 'compagnon'], pt_BR: ['auxiliar', 'auxiliar'], hi: ['सहायक', 'सहायक'], ur: ['معاون', 'معاون'], ja: ['補助アプリ', '補助アプリ'], de: ['Begleit', 'Begleit'], pl: ['pomocnicz', 'aplikacji'],
  id: ['pendamping', 'pendamping'], mr: ['सहायक', 'सहायक'], te: ['సహాయక', 'సహాయక'], ko: ['도우미', '도우미'], ta: ['துணை', 'துணை'], yue: ['助手', '助手'], wuu: ['助手', '助手'],
});
test('all 21 catalogs word the companion notice in the interface\'s own term and say what needs the program and where it comes from', () => {
  assert.deepEqual(Object.keys(COMPANION_TERMS).sort(), PRODUCTION_LANGUAGES.map(language => language.id).sort());
  for (const key of NOTICE_FIELDS) assert.ok(PROXY_UI_FIELDS.includes(key), key + ' is part of the Proxy UI catalogue');
  const english = PROXY_WORKSPACE_MESSAGES.en;
  assert.match(english.proxy_workspace_companion_notice, /^VLESS, OpenVPN, and SOCKS5, HTTP or HTTPS proxies with a login need a small companion program for Windows\. It is a separate download from GitHub; the extension never downloads or installs it\./);
  assert.match(english.proxy_workspace_companion_install, /^Download the companion archive from GitHub \(Releases\), extract it and run the installer:$/);
  for (const language of PRODUCTION_LANGUAGES) {
    const id = language.id, messages = PROXY_WORKSPACE_MESSAGES[id], get = key => messages['proxy_workspace_' + key], [bodyTerm, installTerm] = COMPANION_TERMS[id], lower = value => value.toLowerCase();
    for (const key of NOTICE_FIELDS) { assert.ok(get(key) && get(key) === get(key).trim(), id + ' ' + key); if (id !== 'en') assert.notEqual(get(key), english['proxy_workspace_' + key], id + ' ' + key + ' is authored, not the English fallback'); }
    assert.ok(lower(get('companion')).includes(lower(bodyTerm)), id + ': the section name uses the term ' + bodyTerm);
    assert.ok(lower(get('companion_notice')).includes(lower(bodyTerm)), id + ': the notice uses the term ' + bodyTerm);
    assert.ok(lower(get('companion_install')).includes(lower(installTerm)), id + ': the install line uses the term ' + installTerm);
    for (const word of ['VLESS', 'OpenVPN', 'SOCKS5', 'HTTP', 'HTTPS', 'Windows', 'GitHub']) assert.ok(get('companion_notice').includes(word), id + ': the notice names ' + word);
    assert.ok(get('companion_download').includes('GitHub'), id + ': the link says where it goes');
    assert.ok(get('companion_install').includes('GitHub') && get('companion_install').includes('Releases'), id + ': the install line says where to get the archive');
    assert.equal(get('companion_new_tab'), GEO_MANAGER_LABELS[id].banner_new_tab, id + ': the new-tab hint repeats the wording of the geolocation link');
    assert.ok(get('companion_notice').length >= 120 && get('companion_notice').length <= 520, id + ': a compact notice (' + get('companion_notice').length + ' characters)');
    assert.ok(get('companion_notice_title').length <= 80, id + ': a short heading');
  }
});

test('in every language the notice shows its own copy, the link keeps its label and the page direction follows the language', async () => {
  for (const language of PRODUCTION_LANGUAGES) {
    const current = await opened({ source: sourceWithHost(COMPANION_MISSING), locale: language.id }); try {
      const notice = current.attr(NOTICE, 'download'), messages = PROXY_WORKSPACE_MESSAGES[language.id]; assert.ok(notice, language.id);
      const text = current.text(notice);
      for (const key of NOTICE_FIELDS) assert.ok(text.includes(messages['proxy_workspace_' + key]), language.id + ' ' + key);
      assert.doesNotMatch(text, /proxy_workspace_|browser_debug_|[{][a-z]+[}]/, language.id + ': no key or placeholder shows');
      assert.equal(notice.props['aria-label'], messages.proxy_workspace_companion_notice_title, language.id);
      assert.equal(current.attr('data-proxy-workspace').props.dir, ['ar', 'ur'].includes(language.id) ? 'rtl' : undefined, language.id);
      assert.equal(downloadLinks(current, 'notice')[0].props.href, PROXY_COMPANION_DOWNLOAD_URL, language.id);
    } finally { current.unmount(); }
  }
});


// ======================================================================================================================================
// Round 5 redesign: the manager. Selection, the grid keyboard, filters, bulk checks, the details panel, view preferences and the
// loading, empty and error states. The tests drive the real handlers the way the browser delegates them (one keydown on the grid,
// whose target is a row), so a broken handler or a lost attribute fails here and not only in the screenshots.
const rosterProfiles = () => [
  { id: 'p-a', name: 'Alpha', type: 'socks5', host: 'a.example.test', port: 1080, native: false, country: 'DE' },
  { id: 'p-b', name: 'Bravo', type: 'http', host: 'b.example.test', port: 8080, native: false, country: 'FR' },
  { id: 'p-c', name: 'Charlie', type: 'https', host: 'c.example.test', port: 443, native: false },
  { id: 'p-d', name: 'Delta', type: 'vless', host: 'd.example.test', port: 443, native: true, country: 'DE' },
  { id: 'p-e', name: 'Echo', type: 'socks5', host: 'e.example.test', port: 1081, native: false },
];
function rosterSource() { const source = server(); source.state.snapshot.configuration.profiles = rosterProfiles(); return source; }
const rowIds = harness => harness.nodes(node => node.props?.role === 'row' && node.props['data-proxy-profile']).map(node => node.props['data-proxy-profile']);
const selectedIds = harness => harness.nodes(node => node.props?.role === 'row' && node.props['aria-selected'] === true).map(node => node.props['data-proxy-profile']);
const tabStops = harness => harness.nodes(node => node.props?.role === 'row' && node.props['data-proxy-profile'] && node.props.tabIndex === 0).map(node => node.props['data-proxy-profile']);
// One key pressed with the focus on a row (or on its checkbox), as the grid's delegated handler receives it.
function press(harness, id, key, extra = {}, kind = 'row') {
  const row = { tagName: 'DIV', closest: () => row, getAttribute: name => name === 'data-proxy-profile' ? id : null };
  const target = kind === 'row' ? row : { tagName: 'INPUT', type: 'checkbox', closest: () => row, getAttribute: () => null };
  let prevented = false;
  harness.attr('data-proxy-table').props.onKeyDown({ key, target, defaultPrevented: false, preventDefault() { prevented = true; }, stopPropagation() {}, ...extra });
  harness.render();
  return prevented;
}
function pressRoot(harness, key, extra = {}) {
  let prevented = false;
  harness.attr('data-proxy-workspace').props.onKeyDown({ key, target: { tagName: 'DIV', closest: () => null }, defaultPrevented: false, preventDefault() { prevented = true; }, ...extra });
  harness.render();
  return prevented;
}
const waitMs = ms => new Promise(resolve => setTimeout(resolve, ms));
const finishes = (promise, ms = 2500) => { let timer; const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(Error('the check queue did not finish: it started a check that was never released')), ms); }); return Promise.race([promise, limit]).finally(() => clearTimeout(timer)); };
const passResult = (ms = 80, ip = '203.0.113.50') => ({ state: 'pass', reachable: true, remoteDns: true, tlsVerified: true, httpStatus: 200, ip, elapsedMs: ms });
// A controllable check service: every checkProfile call waits for its gate, in the order the calls arrive.
function gatedChecks(source) {
  const gates = [];
  source.state.pendingCheck = input => new Promise(resolve => gates.push({ id: input.id, release: diagnostic => resolve({ profileId: input.id, diagnostic }) }));
  return gates;
}
// Controls without an accessible name: a button needs text or a label, a field a label around it or pointing at it, a landmark a name.
function unnamedControls(harness) {
  const labelled = new Set(harness.nodes(node => node.type === 'label' && node.props.for).map(node => node.props.for)), problems = [];
  const named = props => Boolean(props['aria-label'] || props['aria-labelledby']);
  const describe = node => node.type + ' ' + Object.keys(node.props).filter(key => key.startsWith('data-')).join(',');
  const visit = (node, insideLabel) => {
    if (Array.isArray(node)) return node.forEach(child => visit(child, insideLabel));
    if (!node?.props) return;
    const props = node.props;
    if (node.type === 'button' && !named(props) && !harness.text(node).trim()) problems.push(describe(node));
    if (['input', 'select', 'textarea'].includes(node.type) && props.type !== 'hidden' && !named(props) && !insideLabel && !(props.id && labelled.has(props.id))) problems.push(describe(node));
    if (['grid', 'toolbar', 'radiogroup', 'listbox', 'menu', 'progressbar', 'img', 'region', 'group'].includes(props.role) && props['aria-hidden'] !== 'true' && !named(props)) problems.push('role ' + props.role + ' ' + describe(node));
    if (node.type === 'dialog' && !named(props)) problems.push(describe(node));
    visit(props.children, insideLabel || node.type === 'label');
  };
  visit(harness.nodes(() => true)[0], false);
  return problems;
}

test('the list is an ARIA grid: indexed rows, one header row, named columns, a single aria-sort and exactly one tab stop', async () => {
  const current = await opened({ source: rosterSource() }); try {
    const grid = current.attr('data-proxy-table'); assert.equal(grid.props.role, 'grid'); assert.equal(grid.props['aria-multiselectable'], 'true'); assert.equal(grid.props['aria-rowcount'], 6); assert.ok(grid.props['aria-label']);
    assert.equal(current.nodes(node => node.props?.id === grid.props['aria-describedby']).length, 1, 'the keyboard hint is attached to the grid');
    const rows = current.nodes(node => node.props?.role === 'row'); assert.deepEqual(rows.map(row => row.props['aria-rowindex']), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(rowIds(current), ['p-a', 'p-b', 'p-c', 'p-d', 'p-e']); assert.ok(rows.slice(1).every(row => row.props['aria-selected'] === false), 'every row says whether it is selected');
    const heads = current.nodes(node => node.props?.role === 'columnheader'); assert.equal(grid.props['aria-colcount'], heads.length); assert.ok(heads.every(head => current.text(head).trim() !== '' || within(head, node => node.props?.['aria-label']).length > 0), 'every column header has a name');
    for (const row of rows.slice(1)) assert.equal(within(row, node => node.props?.role === 'gridcell').length, heads.length, 'a cell for every column in ' + row.props['data-proxy-profile']);
    assert.equal(heads.filter(node => ['ascending', 'descending'].includes(node.props['aria-sort'])).length, 1); assert.equal(current.attr('data-proxy-sort-column', 'name').type, 'button');
    assert.equal(heads.filter(node => node.props['aria-sort'] === 'none').length, heads.filter(node => node.props['aria-sort']).length - 1, 'the other sortable columns say none');
    assert.deepEqual(tabStops(current), ['p-a'], 'before anything is chosen the first row is the tab stop');
    for (const id of ['p-b', 'p-c', 'p-d', 'p-e']) for (const node of within(current.attr('data-proxy-profile', id), candidate => ['button', 'input'].includes(candidate.type))) assert.equal(node.props.tabIndex, -1, id + ': ' + Object.keys(node.props).filter(key => key.startsWith('data-')).join(','));
    for (const node of within(current.attr('data-proxy-profile', 'p-a'), candidate => ['button', 'input'].includes(candidate.type))) assert.equal(node.props.tabIndex, 0, 'the controls of the current row are the ones Tab reaches');
    assert.deepEqual(unnamedControls(current), [], 'every control of the list has an accessible name');
  } finally { current.unmount(); }
});

test('grid keyboard: arrows, Home/End and PageUp/PageDown move the one tab stop; Space and Shift select; Ctrl+A selects all and a second one clears', async () => {
  const current = await opened({ source: rosterSource() }); try {
    assert.equal(press(current, 'p-a', 'ArrowDown'), true); assert.deepEqual(tabStops(current), ['p-b']);
    press(current, 'p-b', 'End'); assert.deepEqual(tabStops(current), ['p-e']); press(current, 'p-e', 'ArrowDown'); assert.deepEqual(tabStops(current), ['p-e'], 'no wrap at the end');
    press(current, 'p-e', 'Home'); assert.deepEqual(tabStops(current), ['p-a']); press(current, 'p-a', 'PageDown'); assert.deepEqual(tabStops(current), ['p-e'], 'a page never goes past the list'); press(current, 'p-e', 'PageUp'); assert.deepEqual(tabStops(current), ['p-a']);
    assert.deepEqual(selectedIds(current), [], 'moving never selects');
    press(current, 'p-a', ' '); assert.deepEqual(selectedIds(current), ['p-a']); press(current, 'p-a', ' '); assert.deepEqual(selectedIds(current), []);
    press(current, 'p-b', ' '); press(current, 'p-b', 'ArrowDown', { shiftKey: true }); press(current, 'p-c', 'ArrowDown', { shiftKey: true });
    assert.deepEqual(selectedIds(current), ['p-b', 'p-c', 'p-d'], 'Shift extends from where the selection started'); assert.deepEqual(tabStops(current), ['p-d']);
    press(current, 'p-d', 'a', { ctrlKey: true }); assert.deepEqual(selectedIds(current), ['p-a', 'p-b', 'p-c', 'p-d', 'p-e']); press(current, 'p-d', 'A', { metaKey: true }); assert.deepEqual(selectedIds(current), [], 'a second Ctrl+A clears');
    assert.equal(press(current, 'p-d', 'x'), false, 'a key the grid does not own is not swallowed'); assert.equal(press(current, 'p-d', 'ArrowDown', { isComposing: true }), false); assert.equal(press(current, 'p-d', 'ArrowDown', { altKey: true }), false);
    assert.equal(press(current, 'p-d', ' ', {}, 'checkbox'), false, 'Space on the checkbox is the checkbox own key, so it is not toggled twice');
    click(current, 'data-proxy-select', 'p-b'); click(current, 'data-proxy-select', 'p-d'); current.render(); assert.deepEqual(selectedIds(current), ['p-b', 'p-d'], 'a checkbox click toggles one row');
    current.attr('data-proxy-select', 'p-e').props.onClick({ shiftKey: true }); current.render(); assert.deepEqual(selectedIds(current), ['p-b', 'p-d', 'p-e'], 'a Shift click extends to the clicked row');
    click(current, 'data-proxy-select-all'); current.render(); assert.equal(selectedIds(current).length, 5); click(current, 'data-proxy-select-all'); current.render(); assert.deepEqual(selectedIds(current), []);
  } finally { current.unmount(); }
});

test('grid keyboard: Enter opens the details, C checks the row, Delete asks first, / searches and Escape clears the selection before it closes the details', async () => {
  const source = rosterSource(), current = await opened({ source }); let focused = 0; try {
    current.attr('data-proxy-search').props.ref.current = { focus() { focused++; } };
    assert.equal(press(current, 'p-b', '/'), true); assert.equal(focused, 1, '/ moves the focus to the search field'); assert.equal(pressRoot(current, '/'), true); assert.equal(focused, 2);
    assert.equal(pressRoot(current, '/', { target: { tagName: 'INPUT', type: 'text', closest: () => null } }), false); assert.equal(focused, 2, 'typing a slash in a field stays a slash');
    press(current, 'p-b', 'Enter'); assert.ok(current.attr('data-proxy-peek', 'p-b'), 'Enter opens the details of the row'); assert.equal(source.count('checkProfile'), 0);
    press(current, 'p-c', 'c'); await current.settle(); assert.deepEqual(source.calls.filter(call => call.name === 'checkProfile').map(call => call.value.id), ['p-c'], 'C checks that row only');
    press(current, 'p-c', 'c', { ctrlKey: true }); press(current, 'p-c', 'c', {}, 'checkbox'); await current.settle(); assert.equal(source.count('checkProfile'), 1, 'Ctrl+C is copy and a letter typed on a checkbox does nothing');
    press(current, 'p-c', 'Delete'); await current.settle(); assert.match(plainText(current, current.attr('data-proxy-removal')), /Charlie/); assert.equal(source.count('deleteProfile'), 0, 'Delete only asks');
    click(current, 'data-proxy-remove-cancel'); await current.settle(); assert.equal(current.attr('data-proxy-removal'), undefined); assert.equal(source.count('deleteProfile'), 0);
    press(current, 'p-a', ' '); assert.deepEqual(selectedIds(current), ['p-a']);
    pressRoot(current, 'Escape'); assert.deepEqual(selectedIds(current), [], 'the first Escape clears the selection'); assert.ok(current.attr('data-proxy-peek', 'p-b'), 'and leaves the details open');
    pressRoot(current, 'Escape'); assert.equal(current.attr('data-proxy-peek', 'p-b'), undefined, 'the next Escape closes the details');
    press(current, 'p-b', 'Enter'); current.attr('data-proxy-peek', 'p-b').props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} }); current.render(); assert.equal(current.attr('data-proxy-peek', 'p-b'), undefined, 'Escape inside the details closes them as well');
    assert.equal(source.count('checkProfile') + source.count('connect') + source.count('saveProfile'), 1, 'none of this started anything else');
  } finally { current.unmount(); }
});

test('the selection bar names the count, announces it once it settles, and offers Check, Delete and Clear for exactly the selected rows', async () => {
  const source = rosterSource(), current = await opened({ source }); try {
    assert.equal(hook(current, 'data-proxy-bulkbar'), undefined, 'nothing selected, no bar');
    click(current, 'data-proxy-select', 'p-a'); click(current, 'data-proxy-select', 'p-c'); current.render();
    const bar = hook(current, 'data-proxy-bulkbar'); assert.ok(bar); assert.equal(bar.props.role, 'toolbar'); assert.equal(bar.props['aria-label'], '2 selected'); assert.equal(current.text(hook(current, 'data-proxy-selected-count')), '2 selected');
    for (const hook of ['data-proxy-check-selected', 'data-proxy-delete-selected', 'data-proxy-clear-selection']) assert.ok(current.attr(hook), hook);
    await waitMs(520); assert.deepEqual(current.announcements.filter(message => /selected$/.test(message)), ['2 selected'], 'one announcement for the settled count, not one per row');
    click(current, 'data-proxy-delete-selected'); await current.settle(); assert.match(plainText(current, current.attr('data-proxy-removal')), /Delete the selected profiles \(2\)\?/); assert.equal(source.count('deleteProfile'), 0);
    click(current, 'data-proxy-remove-confirm'); await current.settle();
    assert.deepEqual(source.calls.filter(call => call.name === 'deleteProfile').map(call => call.value), ['p-a', 'p-c']); assert.deepEqual(rowIds(current), ['p-b', 'p-d', 'p-e']); assert.equal(hook(current, 'data-proxy-bulkbar'), undefined, 'the deleted rows leave the selection');
    click(current, 'data-proxy-select', 'p-b'); current.render(); assert.ok(hook(current, 'data-proxy-bulkbar')); click(current, 'data-proxy-clear-selection'); current.render(); assert.deepEqual(selectedIds(current), []); assert.equal(hook(current, 'data-proxy-bulkbar'), undefined);
  } finally { current.unmount(); }
});

test('the connected profile is never deleted by the selection bar or the Delete key', async () => {
  const source = rosterSource(); source.state.snapshot = { ...source.state.snapshot, configuration: { ...source.state.snapshot.configuration, enabled: true, selectedId: 'p-a' }, status: { state: 'connected', profileId: 'p-a' } }; const current = await opened({ source }); try {
    press(current, 'p-a', 'Delete'); await current.settle(); assert.equal(current.attr('data-proxy-removal'), undefined, 'asking is refused for the connected profile');
    click(current, 'data-proxy-select', 'p-a'); current.render(); assert.equal(current.attr('data-proxy-delete-selected').props.disabled, true);
    click(current, 'data-proxy-select', 'p-b'); current.render(); assert.equal(current.attr('data-proxy-delete-selected').props.disabled, false); click(current, 'data-proxy-delete-selected'); await current.settle();
    assert.match(plainText(current, current.attr('data-proxy-removal')), /Bravo/, 'only the other profile is offered for deletion'); click(current, 'data-proxy-remove-confirm'); await current.settle();
    assert.deepEqual(source.calls.filter(call => call.name === 'deleteProfile').map(call => call.value), ['p-b']);
    assert.equal(current.attr('data-proxy-peek-remove', 'p-a'), undefined); openPeek(current, 'p-a'); assert.equal(current.attr('data-proxy-peek-remove', 'p-a').props.disabled, true);
  } finally { current.unmount(); }
});

test('Check selected runs one check at a time for the selected rows only, shows its progress and per-row spinner, writes every result to the history and ends with a summary', async () => {
  const area = memoryArea(undefined), source = rosterSource(), gates = gatedChecks(source), current = await opened({ source, history: historyStore(area) }); try {
    assert.equal(source.count('checkProfile'), 0, 'opening the page checks nothing');
    click(current, 'data-proxy-select', 'p-a'); click(current, 'data-proxy-select', 'p-c'); click(current, 'data-proxy-select', 'p-e'); current.render();
    const pending = click(current, 'data-proxy-check-selected'); await current.settle();
    assert.deepEqual(gates.map(gate => gate.id), ['p-a'], 'the next check does not start before the first has finished');
    assert.equal(hook(current, 'data-proxy-bulkbar'), undefined, 'the progress replaces the selection bar'); const progress = current.attr('data-proxy-check-progress'); assert.equal(progress.props.role, 'status'); assert.match(plainText(current, progress), /0 of 3 checked, 0 failed/);
    assert.equal(current.attr('data-proxy-health', 'p-a').props['data-state'], 'checking'); assert.equal(current.attr('data-proxy-health', 'p-b').props['data-state'], 'unknown', 'a row that is not selected stays unchecked');
    const meter = within(progress, node => node.props?.role === 'progressbar')[0]; assert.deepEqual([meter.props['aria-valuemin'], meter.props['aria-valuemax'], meter.props['aria-valuenow']], [0, 3, 0]);
    gates[0].release(passResult(120)); await current.settle(); assert.deepEqual(gates.map(gate => gate.id), ['p-a', 'p-c']);
    assert.match(plainText(current, current.attr('data-proxy-check-progress')), /1 of 3 checked, 0 failed/); assert.equal(current.attr('data-proxy-health', 'p-a').props['data-state'], 'pass'); assert.equal(current.attr('data-proxy-health', 'p-c').props['data-state'], 'checking');
    gates[1].release({ state: 'fail', code: 'timeout', phase: 'tunnel', retryable: true }); await current.settle(); assert.deepEqual(gates.map(gate => gate.id), ['p-a', 'p-c', 'p-e']); assert.match(plainText(current, current.attr('data-proxy-check-progress')), /2 of 3 checked, 1 failed/);
    gates[2].release(passResult(900)); await finishes(pending); await current.settle();
    assert.equal(current.attr('data-proxy-check-progress'), undefined); assert.equal(source.count('requestAccess'), 1, 'one permission request for the whole run');
    assert.equal(current.attr('data-proxy-health', 'p-c').props['data-state'], 'fail'); assert.equal(current.attr('data-proxy-health', 'p-e').props['data-state'], 'pass');
    assert.match(plainText(current, hook(current, 'data-proxy-check-summary')), /Checked 3 of 3: 2 responded, 1 failed\./); assert.equal(hook(current, 'data-proxy-bulkbar').props['data-proxy-bulkbar'], '3', 'the selection stays and its bar is back, with the summary in it');
    assert.deepEqual(Object.keys(area.state.value.items).sort(), ['p-a', 'p-c', 'p-e'], 'every result is history, exactly like a single check'); assert.equal(area.state.value.items['p-a'][0].ms, 120); assert.equal(area.state.value.items['p-c'][0].code, 'timeout');
    assert.ok(current.announcements.includes('Checked 3 of 3: 2 responded, 1 failed.'), 'the summary is announced'); assert.ok(current.announcements.some(message => message.startsWith('Alpha')), 'and each result');
    click(current, 'data-proxy-summary-close'); current.render(); assert.equal(hook(current, 'data-proxy-check-summary'), undefined); assert.equal(hook(current, 'data-proxy-bulkbar').props['data-proxy-bulkbar'], '3');
    assert.equal(source.count('connect') + source.count('disconnect') + source.count('saveSettings'), 0, 'checking never changes the connection');
  } finally { current.unmount(); }
});

test('Cancel stops the bulk check after the one in flight, and a hidden page stops it as well', async () => {
  const source = rosterSource(), gates = gatedChecks(source), current = await opened({ source }); try {
    const pending = click(current, 'data-proxy-check-visible'); await current.settle(); assert.deepEqual(gates.map(gate => gate.id), ['p-a']);
    click(current, 'data-proxy-stop-checks'); await current.settle(); assert.equal(current.attr('data-proxy-stop-checks').props.disabled, true); assert.match(plainText(current, current.attr('data-proxy-check-progress')), /Stopping/);
    gates[0].release(passResult()); await finishes(pending); await current.settle();
    assert.equal(gates.length, 1, 'nothing new started after Cancel'); assert.equal(current.attr('data-proxy-health', 'p-a').props['data-state'], 'unknown', 'a reply that arrives after Cancel is dropped, as before'); assert.equal(current.attr('data-proxy-health', 'p-b').props['data-state'], 'unknown');
    assert.equal(hook(current, 'data-proxy-check-summary'), undefined, 'a cancelled run leaves no summary'); assert.equal(hook(current, 'data-proxy-check-progress'), undefined);
  } finally { current.unmount(); }
  const second = rosterSource(), more = gatedChecks(second), page = await opened({ source: second }); try {
    const pending = click(page, 'data-proxy-check-visible'); await page.settle(); page.hide(); await page.settle(); more[0].release(passResult()); await finishes(pending); await page.settle();
    assert.equal(more.length, 1, 'hiding the page stops the queue'); page.show(); await page.settle(); assert.equal(page.attr('data-proxy-check-progress'), undefined); assert.equal(hook(page, 'data-proxy-check-summary'), undefined);
  } finally { page.unmount(); }
});

test('filter chips, the country menu and the search narrow the list, show what each choice would leave, and one action clears them', async () => {
  const source = rosterSource(); source.state.checkResults['p-a'] = passResult(100); source.state.checkResults['p-b'] = { state: 'fail', code: 'timeout', phase: 'tunnel', retryable: true };
  const current = await opened({ source }); try {
    assert.equal(current.text(current.attr('data-proxy-count', 'all')).trim(), '5'); assert.equal(hook(current, 'data-proxy-active-filters'), undefined);
    const chipCount = (hook, value) => plainText(current, current.attr(hook, value)).match(/(\d+)$/)?.[1];
    assert.deepEqual(['all', 'socks5', 'http', 'https', 'vless'].map(type => chipCount('data-proxy-filter-type', type)), ['5', '2', '1', '1', '1']); assert.equal(current.attr('data-proxy-filter-type', 'openvpn'), undefined, 'a kind nobody uses has no chip');
    await click(current, 'data-proxy-check-visible'); await current.settle();
    assert.deepEqual(['all', 'pass', 'fail', 'unchecked'].map(status => chipCount('data-proxy-status-chip', status)), ['5', '4', '1', '0'], 'every check passes except the one configured to fail');
    click(current, 'data-proxy-filter-type', 'socks5'); await current.settle(); assert.deepEqual(rowIds(current), ['p-a', 'p-e']); assert.equal(current.attr('data-proxy-filter-type', 'socks5').props['aria-pressed'], true);
    assert.equal(current.text(current.attr('data-proxy-count', 'filtered')).trim(), '2 of 5'); assert.equal(hook(current, 'data-proxy-active-filters').props['data-proxy-active-filters'], '1');
    assert.equal(chipCount('data-proxy-status-chip', 'fail'), '0', 'the status chips count what the type filter leaves');
    click(current, 'data-proxy-filter-type', 'socks5'); await current.settle(); assert.deepEqual(rowIds(current), ['p-a', 'p-b', 'p-c', 'p-d', 'p-e'], 'the same chip again switches it off');
    click(current, 'data-proxy-menu', 'country'); current.render(); click(current, 'data-proxy-country-option-filter', 'DE'); await current.settle(); assert.deepEqual(rowIds(current), ['p-a', 'p-d']);
    click(current, 'data-proxy-status-chip', 'fail'); await current.settle(); assert.deepEqual(rowIds(current), [], 'filters combine'); assert.ok(current.attr('data-proxy-no-results')); assert.match(current.text(current.attr('data-proxy-no-results')), /No profiles match these filters\./);
    click(current, 'data-proxy-filter-remove', 'country'); await current.settle(); assert.deepEqual(rowIds(current), ['p-b'], 'a single filter can be removed');
    input(current, 'data-proxy-search', 'echo'); await current.settle(); assert.deepEqual(rowIds(current), []); click(current, 'data-proxy-filters-clear'); await current.settle();
    assert.deepEqual(rowIds(current), ['p-a', 'p-b', 'p-c', 'p-d', 'p-e']); assert.equal(hook(current, 'data-proxy-active-filters'), undefined); assert.equal(current.attr('data-proxy-search').props.value, '');
    await waitMs(520); assert.ok(current.announcements.includes('5 of 5'), 'the result count is announced once the filters settle: ' + JSON.stringify(current.announcements));
    assert.equal(source.count('checkProfile'), 5, 'filtering never checks anything');
  } finally { current.unmount(); }
});

test('sorting by a header, the sort menu and the direction button keep one order and one aria-sort', async () => {
  const source = rosterSource(); source.state.checkResults['p-a'] = passResult(300); source.state.checkResults['p-b'] = passResult(100); source.state.checkResults['p-c'] = { state: 'fail', code: 'timeout', phase: 'tunnel', retryable: true }; source.state.checkResults['p-d'] = passResult(200); source.state.checkResults['p-e'] = passResult(50);
  const current = await opened({ source }); try {
    await click(current, 'data-proxy-check-visible'); await current.settle();
    const sorted = () => current.nodes(node => node.props?.role === 'columnheader' && ['ascending', 'descending'].includes(node.props['aria-sort'])).map(node => node.props['data-col'] + ':' + node.props['aria-sort']);
    assert.deepEqual(sorted(), ['name:ascending']);
    click(current, 'data-proxy-sort-column', 'latency'); await current.settle(); assert.deepEqual(rowIds(current), ['p-e', 'p-b', 'p-d', 'p-a', 'p-c'], 'fast first, the failed check without a time last'); assert.deepEqual(sorted(), ['check:ascending']);
    click(current, 'data-proxy-sort-column', 'latency'); await current.settle(); assert.deepEqual(rowIds(current), ['p-a', 'p-d', 'p-b', 'p-e', 'p-c'], 'the second click reverses and the failed row is still last'); assert.deepEqual(sorted(), ['check:descending']);
    current.attr('data-proxy-sort-dir', 'desc').props.onClick(); await current.settle(); assert.deepEqual(sorted(), ['check:ascending']);
    current.attr('data-proxy-sort').props.onChange({ currentTarget: { value: 'country' } }); await current.settle(); assert.deepEqual(rowIds(current), ['p-a', 'p-d', 'p-b', 'p-c', 'p-e'], 'country A to Z, the untagged last'); assert.deepEqual(sorted(), ['country:ascending']);
    current.attr('data-proxy-sort').props.onChange({ currentTarget: { value: 'bogus' } }); await current.settle(); assert.deepEqual(sorted(), ['country:ascending'], 'an unknown sort key changes nothing');
  } finally { current.unmount(); }
});

test('view preferences (density, columns, sort) are kept in one small local value, read strictly, and never touch the proxy configuration', async () => {
  const store = new Map(), writes = [], previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const fake = { getItem: key => store.has(key) ? store.get(key) : null, setItem: (key, value) => { writes.push(key); store.set(key, value); }, removeItem: key => { store.delete(key); } };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: fake });
  try {
    const source = rosterSource(), before = structuredClone(source.state.snapshot.configuration), current = await opened({ source }); try {
      assert.equal(hook(current, 'data-proxy-density').props['data-proxy-density'], 'comfortable'); assert.equal(current.attr('data-proxy-table').props.class.includes('pm-density--comfortable'), true);
      click(current, 'data-proxy-density-option', 'compact'); await current.settle(); assert.equal(current.attr('data-proxy-density-option', 'compact').props['aria-pressed'], true); assert.ok(current.attr('data-proxy-table').props.class.includes('pm-density--compact'));
      click(current, 'data-proxy-menu', 'columns'); current.render(); click(current, 'data-proxy-column-toggle', 'ip'); await current.settle(); assert.equal(hook(current, 'data-proxy-column-toggle'), undefined, 'choosing closes the menu'); click(current, 'data-proxy-menu', 'columns'); current.render(); click(current, 'data-proxy-column-toggle', 'checked'); await current.settle();
      assert.ok(current.attr('data-proxy-table').props.class.includes('pm-off-ip') && current.attr('data-proxy-table').props.class.includes('pm-off-checked'), 'a hidden column is hidden by the grid, not by the data');
      assert.equal(current.nodes(node => node.props?.role === 'columnheader').length, 7); assert.equal(current.attr('data-proxy-table').props['aria-colcount'], 7);
      click(current, 'data-proxy-sort-column', 'host'); await current.settle();
      assert.deepEqual(JSON.parse(store.get(PROXY_VIEW_KEY)), { version: 1, density: 'compact', columns: ['type', 'address', 'country', 'linked', 'check'], sort: 'host', dir: 'asc' });
      assert.ok(writes.length >= 4 && writes.every(key => key === PROXY_VIEW_KEY), 'only the view key is written');
      assert.deepEqual(source.state.snapshot.configuration, before, 'the proxy configuration is untouched'); assert.doesNotMatch(store.get(PROXY_VIEW_KEY), /proxy\.example|p-a|Alpha|203\.0\.113/);
    } finally { current.unmount(); }
    const again = await opened({ source: rosterSource() }); try { assert.ok(again.attr('data-proxy-table').props.class.includes('pm-density--compact'), 'the next visit starts the way the last ended'); assert.equal(again.attr('data-proxy-table').props['aria-colcount'], 7); } finally { again.unmount(); }
    for (const bad of ['{not json', JSON.stringify({ version: 1, density: 'compact', columns: ['type'], sort: 'host', dir: 'asc', extra: 1 }), JSON.stringify({ version: 1, density: 'tight', columns: [], sort: 'name', dir: 'asc' }), JSON.stringify({ version: 1, density: 'compact', columns: ['password'], sort: 'name', dir: 'asc' }), 'x'.repeat(5000)]) {
      store.set(PROXY_VIEW_KEY, bad); const fresh = await opened({ source: rosterSource() }); try { assert.ok(fresh.attr('data-proxy-table').props.class.includes('pm-density--comfortable'), 'unexpected stored data is the default: ' + bad.slice(0, 30)); assert.equal(fresh.attr('data-proxy-table').props['aria-colcount'], 9); } finally { fresh.unmount(); }
    }
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw Error('storage is blocked'); } });
    const blocked = await opened({ source: rosterSource() }); try { click(blocked, 'data-proxy-density-option', 'compact'); await blocked.settle(); assert.ok(blocked.attr('data-proxy-table').props.class.includes('pm-density--compact'), 'blocked storage still lets the choice work for this visit'); } finally { blocked.unmount(); }
  } finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage; }
});

test('Reset view in the Columns menu is the clear path of the stored view: the key is removed and the defaults return', async () => {
  const store = new Map([[PROXY_VIEW_KEY, JSON.stringify({ version: 1, density: 'compact', columns: ['type', 'check'], sort: 'host', dir: 'desc' })]]), previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => store.has(key) ? store.get(key) : null, setItem: (key, value) => { store.set(key, value); }, removeItem: key => { store.delete(key); } } });
  try {
    const current = await opened({ source: rosterSource() }); try {
      assert.equal(hook(current, 'data-proxy-density').props['data-proxy-density'], 'compact', 'the stored view is read'); assert.equal(current.attr('data-proxy-table').props['aria-colcount'], 5);
      click(current, 'data-proxy-menu', 'columns'); current.render(); click(current, 'data-proxy-view-reset'); await current.settle();
      assert.equal(store.has(PROXY_VIEW_KEY), false, 'the stored view is removed'); assert.equal(hook(current, 'data-proxy-density').props['data-proxy-density'], 'comfortable'); assert.equal(current.attr('data-proxy-table').props['aria-colcount'], 9); assert.deepEqual(rowIds(current), ['p-a', 'p-b', 'p-c', 'p-d', 'p-e'], 'the sort is back to name');
      assert.equal(hook(current, 'data-proxy-column-toggle'), undefined, 'choosing closes the menu');
    } finally { current.unmount(); }
  } finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage; }
});

test('the details panel shows the facts, honest limits, history and a latency trend, acts on its profile, and Escape closes it', async () => {
  const area = memoryArea(undefined), source = rosterSource(), current = await opened({ source, history: historyStore(area) }); try {
    for (const [index, ms] of [200, 100, 300].entries()) { source.state.checkResults['p-b'] = passResult(ms, '203.0.113.' + (index + 1)); await click(current, 'data-proxy-check-profile', 'p-b'); await current.settle(); }
    assert.equal(current.attr('data-proxy-peek', 'p-b'), undefined, 'checking does not open the details');
    const peek = openPeek(current, 'p-b'); assert.equal(peek.type, 'aside'); assert.equal(peek.props.role, 'region'); assert.equal(peek.props['aria-labelledby'], 'pm-peek-title'); assert.equal(current.text(current.nodes(node => node.props?.id === 'pm-peek-title')[0]).trim(), 'Bravo');
    assert.equal(current.attr('data-proxy-open', 'p-b').props['aria-expanded'], true); assert.equal(current.attr('data-proxy-open', 'p-a').props['aria-expanded'], false);
    assert.match(plainText(current, peek), /b\.example\.test:8080/); assert.match(plainText(current, peek), /FR/); assert.ok(within(peek, node => node.props?.['data-proxy-type-detail'] === 'http').length === 1, 'what this kind of proxy can and cannot do'); assert.ok(within(peek, node => node.props?.['data-proxy-relay-detail']).length === 1);
    const spark = within(peek, node => node.props?.['data-proxy-spark'])[0]; assert.equal(spark.props['data-proxy-spark'], '3'); const svg = within(spark, node => node.type === 'svg')[0]; assert.equal(svg.props.role, 'img'); assert.match(svg.props['aria-label'], /100 – 300 ms/); assert.equal(svg.props.dir, 'ltr');
    assert.equal(historyEntries(current), 3, 'three exit IPs are three stays, newest first');
    const check = current.attr('data-proxy-peek-check', 'p-b'); assert.equal(check.props.disabled, false); source.state.checkResults['p-b'] = passResult(150); await check.props.onClick(); await current.settle(); assert.equal(source.count('checkProfile'), 4);
    source.state.connections['p-b'] = { type: 'http', host: 'b.example.test', port: 8080, username: '', password: '' };
    await current.attr('data-proxy-peek-edit', 'p-b').props.onClick(); await current.settle(); assert.ok(current.attr('data-proxy-editor', 'http'), 'Edit opens the sheet of this profile'); assert.equal(current.attr('data-proxy-field', 'name').props.value, 'Bravo'); click(current, 'data-proxy-cancel'); await current.settle(); assert.equal(hook(current, 'data-proxy-editor'), undefined);
    assert.ok(current.attr('data-proxy-peek-connect', 'p-b')); await current.attr('data-proxy-peek-connect', 'p-b').props.onClick(); await current.settle(); assert.deepEqual(source.calls.filter(call => call.name === 'connect').map(call => call.value), ['p-b']); assert.ok(current.attr('data-proxy-peek-disconnect', 'p-b'), 'the action turns into Disconnect');
    current.attr('data-proxy-peek-close').props.onClick(); current.render(); assert.equal(current.attr('data-proxy-peek', 'p-b'), undefined); assert.equal(current.attr('data-proxy-open', 'p-b').props['aria-expanded'], false);
    openPeek(current, 'p-a'); assert.ok(current.attr('data-proxy-peek', 'p-a')); openPeek(current, 'p-b'); assert.equal(current.attr('data-proxy-peek', 'p-a'), undefined, 'one details panel at a time'); assert.ok(current.attr('data-proxy-peek', 'p-b'));
    assert.deepEqual(unnamedControls(current), [], 'every control of the details panel has an accessible name');
  } finally { current.unmount(); }
});

test('the linked fingerprint profiles are a read-only count from the local links record; without the record the column and the section are absent', async () => {
  const link = (profile, proxy) => ['fp-' + profile.repeat(32), proxy];
  const record = { version: 1, links: Object.fromEntries([link('a', 'p-a'), link('b', 'p-a'), link('c', 'p-d')]) };
  const reads = [], writes = []; const browser = { storage: { local: { async get(key) { reads.push(key); return key === 'identity-bundles:v1' ? { [key]: structuredClone(record) } : {}; }, async set(value) { writes.push(Object.keys(value)); }, async remove(key) { writes.push(key); } }, onChanged: { addListener() {}, removeListener() {} } } };
  const current = await opened({ source: rosterSource(), browser }); try {
    assert.ok(reads.includes('identity-bundles:v1')); assert.deepEqual(writes, [], 'reading the links writes nothing'); assert.equal(current.attr('data-proxy-table').props['aria-colcount'], 10, 'the linked column joins the grid');
    assert.equal(current.attr('data-proxy-linked', 'p-a').props['data-count'], '2'); assert.equal(current.attr('data-proxy-linked', 'p-d').props['data-count'], '1'); assert.equal(current.attr('data-proxy-linked', 'p-b').props['data-count'], '0');
    const linkedCell = id => within(current.attr('data-proxy-profile', id), node => node.props?.['data-col'] === 'linked')[0]; assert.equal(String(linkedCell('p-a').props.class).includes('is-empty'), false); assert.equal(String(linkedCell('p-b').props.class).includes('is-empty'), true, 'no link leaves the cell empty, so a card drops it');
    openPeek(current, 'p-a'); assert.equal(hook(current, 'data-proxy-peek-linked').props['data-proxy-peek-linked'], '2'); assert.equal(hook(current, 'data-proxy-fit'), undefined, 'no region verdict is invented');
    openPeek(current, 'p-b'); assert.equal(hook(current, 'data-proxy-peek-linked'), undefined); assert.ok(current.attr('data-proxy-linked-section', 'p-b')); assert.equal(writes.length, 0);
  } finally { current.unmount(); }
  const bad = await opened({ source: rosterSource(), browser: { storage: { local: { async get() { return { 'identity-bundles:v1': { version: 1, links: { 'fp-x': 'p-a', ['fp-' + 'a'.repeat(32)]: '../etc' } } }; } } } } }); try {
    assert.equal(bad.attr('data-proxy-table').props['aria-colcount'], 9, 'malformed links count for nothing, so the column stays out'); assert.equal(bad.attr('data-proxy-linked', 'p-a'), undefined);
  } finally { bad.unmount(); }
  const none = await opened({ source: rosterSource() }); try { assert.equal(none.attr('data-proxy-linked', 'p-a'), undefined); openPeek(none, 'p-a'); assert.equal(none.attr('data-proxy-linked-section', 'p-a'), undefined); } finally { none.unmount(); }
});

test('loading waits before it shows a skeleton and keeps it long enough not to flash; a failed load is an error with a retry; no profiles is an empty state with three actions', async () => {
  const source = rosterSource(); let release; source.client.load = () => new Promise(resolve => { release = () => resolve(source.state.snapshot); });
  const current = harness({ source }); try {
    current.render(); await current.settle(); assert.ok(current.attr('data-proxy-loading'), 'a quick load shows nothing but a quiet placeholder'); assert.equal(current.attr('data-proxy-skeleton'), undefined);
    await waitMs(200); await current.settle(); assert.ok(current.attr('data-proxy-skeleton'), 'after a moment the skeleton appears'); assert.equal(current.attr('data-proxy-skeleton').props.role, 'status'); assert.equal(current.attr('data-proxy-skeleton').props['aria-busy'], 'true');
    release(); await current.settle(); assert.ok(current.attr('data-proxy-skeleton'), 'a skeleton that appeared stays at least a little'); assert.equal(current.attr('data-proxy-table'), undefined);
    await waitMs(480); await current.settle(); assert.equal(current.attr('data-proxy-skeleton'), undefined); assert.ok(current.attr('data-proxy-table'), 'then the list');
  } finally { current.unmount(); }
  const failing = server(); failing.state.failure = { name: 'load', code: 'timeout', phase: 'tunnel', retryable: true }; const broken = await opened({ source: failing }); try {
    const failed = broken.attr('data-proxy-load-failed'); assert.ok(failed); assert.equal(failed.props.role, 'alert'); assert.equal(broken.attr('data-proxy-table'), undefined); assert.equal(broken.attr('data-proxy-skeleton'), undefined);
    failing.state.failure = null; await click(broken, 'data-proxy-retry'); await broken.settle(); assert.equal(broken.attr('data-proxy-load-failed'), undefined); assert.ok(broken.attr('data-proxy-table'), 'retry loads the list'); assert.equal(failing.count('load'), 2);
  } finally { broken.unmount(); }
  const emptySource = server(); emptySource.state.snapshot.configuration.profiles = []; const empty = await opened({ source: emptySource }); try {
    assert.ok(empty.attr('data-proxy-empty')); assert.equal(empty.attr('data-proxy-table'), undefined); assert.deepEqual(['data-proxy-empty-new', 'data-proxy-empty-bulk', 'data-proxy-empty-file'].map(hook => Boolean(empty.attr(hook))), [true, true, true]);
    assert.match(empty.text(empty.attr('data-proxy-empty')), /Nothing is checked or contacted until you ask\./); assert.equal(emptySource.count('checkProfile') + emptySource.count('requestAccess') + emptySource.count('diagnose'), 0);
    empty.attr('data-proxy-empty-new').props.onClick(); empty.render(); assert.ok(empty.attr('data-proxy-editor', 'socks5'));
  } finally { empty.unmount(); }
});

test('the Add sheet validates per field: each reason is tied to its input, the first failing field is announced, and a password can be revealed only on request', async () => {
  const source = rosterSource(), current = await opened({ source }); try {
    openNew(current, 'http'); await current.settle(); click(current, 'data-proxy-save-profile'); await current.settle();
    assert.equal(source.count('saveProfile'), 0, 'nothing is sent while a field is invalid');
    for (const [key, text] of [['name', /Enter a name/], ['host', /Enter a host name/]]) { const field = current.attr('data-proxy-field', key), error = current.attr('data-proxy-field-error', key); assert.ok(error, key); assert.equal(error.props.role, 'alert'); assert.equal(field.props['aria-invalid'], 'true'); assert.equal(field.props['aria-describedby'], error.props.id); assert.match(current.text(error), text); }
    assert.equal(current.attr('data-proxy-field', 'port').props['aria-invalid'], undefined, 'a valid field is not flagged'); assert.ok(current.announcements.some(message => /Enter a name/.test(message)), 'the first failing field is announced');
    input(current, 'data-proxy-field', 'Office', 'name'); input(current, 'data-proxy-field', 'bad host', 'host'); input(current, 'data-proxy-field', '70000', 'port'); await current.settle(); click(current, 'data-proxy-save-profile'); await current.settle();
    assert.equal(current.attr('data-proxy-field-error', 'name'), undefined); assert.match(current.text(current.attr('data-proxy-field-error', 'host')), /without spaces/); assert.match(current.text(current.attr('data-proxy-field-error', 'port')), /1 to 65535/); assert.doesNotMatch(current.text(), /bad host|70000/, 'the reason never repeats the typed text');
    input(current, 'data-proxy-field', 'proxy.example.test', 'host'); input(current, 'data-proxy-field', '8080', 'port'); input(current, 'data-proxy-field', 'LOGIN_CANARY', 'username'); input(current, 'data-proxy-field', 'PASSWORD_CANARY', 'password'); await current.settle();
    const password = () => current.attr('data-proxy-field', 'password'); assert.equal(password().props.type, 'password'); assert.equal(current.attr('data-proxy-reveal', 'password').props['aria-pressed'], false);
    click(current, 'data-proxy-reveal', 'password'); await current.settle(); assert.equal(password().props.type, 'text'); assert.equal(current.attr('data-proxy-reveal', 'password').props['aria-pressed'], true); assert.doesNotMatch(current.text(), /PASSWORD_CANARY/, 'revealing changes the input type, it renders no text');
    click(current, 'data-proxy-reveal', 'password'); await current.settle(); assert.equal(password().props.type, 'password');
    assert.deepEqual(unnamedControls(current), [], 'every control of the sheet has an accessible name');
    assert.ok(hook(current, 'data-proxy-editor')); click(current, 'data-proxy-cancel'); await current.settle(); assert.equal(hook(current, 'data-proxy-editor'), undefined); assert.doesNotMatch(held(current), /PASSWORD_CANARY|LOGIN_CANARY/);
  } finally { current.unmount(); }
});

test('every control of the manager has an accessible name in LTR and RTL, with the row menu, the add menu and the three panels open', async () => {
  for (const locale of ['en', 'ar']) {
    const current = await opened({ source: rosterSource(), locale }); try {
      assert.deepEqual(unnamedControls(current), [], locale + ': list');
      click(current, 'data-proxy-menu', 'add'); current.render(); assert.deepEqual(unnamedControls(current), [], locale + ': add menu'); click(current, 'data-proxy-menu', 'add'); current.render();
      click(current, 'data-proxy-more', 'p-b'); current.render(); assert.deepEqual(unnamedControls(current), [], locale + ': row menu'); click(current, 'data-proxy-more', 'p-b'); current.render();
      click(current, 'data-proxy-menu', 'columns'); current.render(); assert.deepEqual(unnamedControls(current), [], locale + ': columns menu'); click(current, 'data-proxy-menu', 'columns'); current.render();
      click(current, 'data-proxy-select', 'p-a'); current.render(); assert.deepEqual(unnamedControls(current), [], locale + ': selection bar'); click(current, 'data-proxy-clear-selection'); current.render();
      for (const panel of ['routing', 'analyzer', 'companion']) { openPanel(current, panel); await current.settle(); assert.deepEqual(unnamedControls(current), [], locale + ': ' + panel); }
      click(current, 'data-proxy-help'); await current.settle(); assert.deepEqual(unnamedControls(current), [], locale + ': help');
      if (locale === 'ar') assert.equal(current.attr('data-proxy-workspace').props.dir, 'rtl', 'Arabic lays the manager out right to left'); else assert.equal(current.attr('data-proxy-workspace').props.dir, undefined);
    } finally { current.unmount(); }
  }
});

test('phone helpers: the filters sit behind one named button that shows how many are applied, cells without a value are marked so cards can drop them, and names follow their own direction', async () => {
  const source = rosterSource(), current = await opened({ source }); try {
    const toggle = current.attr('data-proxy-filters-toggle'); assert.equal(toggle.type, 'button'); assert.equal(toggle.props['aria-expanded'], false); assert.equal(toggle.props['aria-controls'], 'pm-filters'); assert.equal(current.nodes(node => node.props?.id === 'pm-filters').length, 1, 'the button controls an element that exists');
    assert.equal(within(toggle, node => String(node.props?.class ?? '').includes('pm-filters-count')).length, 0, 'no count while nothing is applied');
    const wrap = () => current.nodes(node => String(node.props?.class ?? '').includes('pm-filters-wrap'))[0];
    toggle.props.onClick(); current.render(); assert.equal(current.attr('data-proxy-filters-toggle').props['aria-expanded'], true); assert.ok(String(wrap().props.class).includes('is-open'), 'the wrapper says it is open');
    await click(current, 'data-proxy-check-profile', 'p-a'); await current.settle(); click(current, 'data-proxy-filter-type', 'socks5'); await current.settle(); click(current, 'data-proxy-status-chip', 'pass'); await current.settle();
    const count = within(current.attr('data-proxy-filters-toggle'), node => String(node.props?.class ?? '').includes('pm-filters-count')); assert.equal(count.length, 1); assert.equal(count[0].props.children, '2', 'the button says two filters are applied');
    const body = current.nodes(node => node.props?.id === 'pm-filters')[0]; assert.equal(within(body, node => node.props && 'data-proxy-active-filters' in node.props).length, 0, 'the applied filters are not inside the part that folds away');
    assert.ok(hook(current, 'data-proxy-active-filters'), 'so they stay visible on a phone'); assert.ok(within(body, node => node.props?.['data-proxy-filter-type']).length > 0, 'the chips are inside the part that folds away');
    click(current, 'data-proxy-filters-clear'); await current.settle(); assert.equal(within(current.attr('data-proxy-filters-toggle'), node => String(node.props?.class ?? '').includes('pm-filters-count')).length, 0);
    const cell = (id, column) => within(current.attr('data-proxy-profile', id), node => node.props?.['data-col'] === column)[0], empty = (id, column) => String(cell(id, column).props.class).includes('is-empty');
    assert.deepEqual([empty('p-a', 'ip'), empty('p-a', 'checked'), empty('p-a', 'country'), empty('p-a', 'address')], [false, false, false, false], 'a row with a result, a tag and an address has no empty cell');
    assert.deepEqual([empty('p-b', 'ip'), empty('p-b', 'checked'), empty('p-c', 'country')], [true, true, true], 'no result and no tag leave empty cells');
    assert.ok(current.nodes(node => String(node.props?.class ?? '') === 'pm-name-main').every(node => node.props.dir === 'auto'), 'a name in another script keeps its own direction (and its ellipsis on the right side)');
  } finally { current.unmount(); }
});

// ======================================================================================================================================
// Keyboard: the chip groups and the density switch are toolbars with one tab stop each, and the section starts with a skip link.
const TOOLBARS = ['data-proxy-filter', 'data-proxy-status-filter', 'data-proxy-density'];
const buttonsIn = (harness, name) => within(hook(harness, name), node => node.type === 'button');
// A key press inside a toolbar as the browser delivers it: the toolbar is the currentTarget, a button is the target, buttons answer focus().
function pressToolbar(harness, name, index, key, extra = {}) {
  const items = buttonsIn(harness, name).map(() => { const spy = { focused: 0, disabled: false, focus() { this.focused++; }, closest() { return spy; } }; return spy; });
  let prevented = false;
  hook(harness, name).props.onKeyDown({ key, target: items[index], currentTarget: { querySelectorAll: () => items }, defaultPrevented: false, preventDefault() { prevented = true; }, ...extra });
  return { items, prevented, moved: items.findIndex(item => item.focused > 0), focusedCount: items.reduce((total, item) => total + item.focused, 0) };
}

test('the chip groups and the density switch are toolbars with one tab stop each: the chip that last had the focus, or the one that is on', async () => {
  const source = rosterSource(), current = await opened({ source }); try {
    for (const name of TOOLBARS) { const group = hook(current, name); assert.equal(group.props.role, 'toolbar', name); assert.equal(group.props['aria-orientation'], 'horizontal', name); assert.ok(group.props['aria-label'], name + ' is named'); assert.equal(typeof group.props.onKeyDown, 'function', name); }
    const stops = name => buttonsIn(current, name).map(node => node.props.tabIndex), pressedChips = name => buttonsIn(current, name).map(node => node.props['aria-pressed']);
    for (const name of TOOLBARS) { assert.equal(stops(name).filter(value => value === 0).length, 1, name + ': exactly one tab stop'); assert.ok(stops(name).every(value => value === 0 || value === -1), name); assert.deepEqual(stops(name).map(value => value === 0), pressedChips(name), name + ': before anything is focused the stop is the chip that is on'); }
    assert.deepEqual([buttonsIn(current, 'data-proxy-filter').length, buttonsIn(current, 'data-proxy-status-filter').length, buttonsIn(current, 'data-proxy-density').length], [5, 4, 2], 'eleven buttons, three tab stops');
    // The stop follows the focus: a chip reached with the arrows is where Tab returns to.
    buttonsIn(current, 'data-proxy-filter')[3].props.onFocus(); buttonsIn(current, 'data-proxy-status-filter')[2].props.onFocus(); buttonsIn(current, 'data-proxy-density')[1].props.onFocus(); current.render();
    assert.deepEqual(stops('data-proxy-filter'), [-1, -1, -1, 0, -1]); assert.deepEqual(stops('data-proxy-status-filter'), [-1, -1, 0, -1]); assert.deepEqual(stops('data-proxy-density'), [-1, 0]);
    assert.deepEqual(pressedChips('data-proxy-filter'), [true, false, false, false, false], 'moving the focus filtered nothing'); assert.equal(hook(current, 'data-proxy-active-filters'), undefined);
    // A remembered chip that is no longer there gives the stop back to the chip that is on.
    buttonsIn(current, 'data-proxy-filter')[4].props.onFocus(); current.render(); assert.deepEqual(stops('data-proxy-filter'), [-1, -1, -1, -1, 0]);
    click(current, 'data-proxy-status-chip', 'fail'); await current.settle();
    assert.deepEqual(stops('data-proxy-filter'), [0], 'only the All chip is left (nothing failed), and it is the stop');
    assert.equal(buttonsIn(current, 'data-proxy-status-filter').filter(node => node.props.tabIndex === 0).length, 1);
  } finally { current.unmount(); }
});

test('arrows, Home and End move the focus inside a toolbar (mirrored in Arabic, wrapping at the ends), other keys stay with the page, and a key never presses a chip by itself', async () => {
  for (const [locale, forward, back] of [['en', 'ArrowRight', 'ArrowLeft'], ['ar', 'ArrowLeft', 'ArrowRight']]) {
    const source = rosterSource(), current = await opened({ source, locale }); try {
      for (const name of TOOLBARS) {
        const count = buttonsIn(current, name).length, step = (index, key, extra) => pressToolbar(current, name, index, key, extra), label = locale + ' ' + name;
        let result = step(0, forward); assert.deepEqual([result.moved, result.prevented, result.focusedCount], [1, true, 1], label + ': forward moves one chip');
        assert.equal(step(count - 1, forward).moved, 0, label + ': forward from the last wraps to the first'); assert.equal(step(0, back).moved, count - 1, label + ': back from the first wraps to the last'); assert.equal(step(count - 1, back).moved, count - 2, label + ': back');
        assert.equal(step(count - 1, 'Home').moved, 0, label + ': Home'); assert.equal(step(0, 'End').moved, count - 1, label + ': End');
        for (const [key, extra] of [['ArrowDown', {}], ['ArrowUp', {}], ['Tab', {}], [' ', {}], ['Enter', {}], ['Escape', {}], ['x', {}], [forward, { shiftKey: true }], [forward, { ctrlKey: true }], [forward, { metaKey: true }], [forward, { altKey: true }], [forward, { isComposing: true }]]) { result = step(0, key, extra); assert.deepEqual([result.focusedCount, result.prevented], [0, false], label + ': ' + key + ' ' + JSON.stringify(extra) + ' is left to the page'); }
      }
      assert.equal(hook(current, 'data-proxy-active-filters'), undefined, 'no key filtered anything'); assert.equal(source.count('checkProfile') + source.count('requestAccess'), 0);
      current.hide(); await current.settle(); assert.equal(pressToolbar(current, 'data-proxy-filter', 0, forward).focusedCount, 0, 'a hidden page ignores keys');
    } finally { current.unmount(); }
  }
});

test('the section starts with a named skip link that moves the focus to the row Tab would reach, or to the search when there are no rows', async () => {
  const spy = () => ({ focused: 0, focus() { this.focused++; } });
  for (const locale of ['en', 'ru', 'ar']) {
    const source = rosterSource(), current = await opened({ source, locale }); try {
      const workspace = hook(current, 'data-proxy-workspace'), skip = current.attr('data-proxy-skip');
      assert.equal(workspace.props.children[0], skip, 'the first child of the section'); assert.equal(current.nodes(node => node.type === 'button')[0], skip, 'and the first button, so the first stop'); assert.equal(skip.props.type, 'button');
      const label = PROXY_WORKSPACE_MESSAGES[locale].proxy_workspace_skip_to_list; assert.equal(current.text(skip).trim(), label); assert.ok(label.length > 8 && !/proxy_workspace_|[{}]/.test(label), locale + ' ' + label);
      const rows = { 'p-a': spy(), 'p-b': spy() }, search = spy();
      workspace.props.ref.current = { querySelector: selector => { const match = /^\[data-proxy-profile="(.+)"\]$/.exec(selector); return match ? rows[match[1]] ?? null : selector === '[data-proxy-search]' ? search : null; } };
      current.attr('data-proxy-skip').props.onClick(); await current.settle(); assert.deepEqual([rows['p-a'].focused, rows['p-b'].focused, search.focused], [1, 0, 0], 'the first row (by name)');
      press(current, 'p-a', 'ArrowDown'); current.render(); const before = rows['p-b'].focused; current.attr('data-proxy-skip').props.onClick(); await current.settle(); assert.equal(rows['p-b'].focused, before + 1, 'after moving, the row that is the tab stop now'); assert.equal(rows['p-a'].focused, 1);
      current.hide(); await current.settle(); const after = [rows['p-a'].focused, rows['p-b'].focused]; current.attr('data-proxy-skip').props.onClick(); assert.deepEqual([rows['p-a'].focused, rows['p-b'].focused], after, 'a hidden page moves nothing');
    } finally { current.unmount(); }
  }
  const empty = rosterSource(); empty.state.snapshot.configuration.profiles = []; const none = await opened({ source: empty }); try {
    const search = spy(); hook(none, 'data-proxy-workspace').props.ref.current = { querySelector: selector => selector === '[data-proxy-search]' ? search : null };
    none.attr('data-proxy-skip').props.onClick(); assert.equal(search.focused, 1, 'no rows: the search field');
  } finally { none.unmount(); }
});

// ---- ADR-109: the Proxy Manager Geolocation API in the manager ------------------------------------------------------------------------
// The controller is a fake that follows the contract of docs/coverage/proxy-geolocation.md (GeoState and the methods); the page reads
// its state, renders the notice, the five columns, the cell states and the details, and starts a lookup ONLY from a person's action or
// from a completed manual check (noteExitIp, which the controller answers for). Exit addresses are seeded through the saved check
// history, which must never start anything.
const GEO_MIN = 60000, GEO_HOUR = 3600000;
const geoDict = entries => Object.assign(Object.create(null), entries);
const geoRecord = (patch = {}) => ({ provider: 'maxmind', service: 'geolite-city', at: Date.now() - 5 * GEO_MIN, ip: '8.8.8.8', country: 'US', countryName: 'United States', region: 'California', city: 'Mountain View', timezone: 'America/Los_Angeles', asn: 15169, org: 'Google LLC', isp: 'Google Fiber', kind: 'hosting', flags: { ...geoEmptyFlags(), hosting: true }, ...patch });
const geoState = (patch = {}) => Object.freeze({ loaded: true, revision: 1, settings: { ...defaultGeoSettings(), enabled: true }, enabled: true, ready: true, readyProviders: ['maxmind'], hasCredentials: { maxmind: true, ipgeolocation: false, ipdata: false, ipapi: false },
  providers: { maxmind: { enabled: true, ready: true, reason: '', status: 'idle', error: null, okAt: null, remaining: null, pausedUntil: null } }, records: geoDict({}), pending: geoDict({}), errors: geoDict({}), cacheCount: 0, ...patch });
function fakeGeo(initial = {}) {
  const calls = { load: 0, lookup: [], note: [], columns: [], dispose: 0, subscribe: 0, unsubscribe: 0 }, listeners = new Set();
  let current = geoState(initial);
  const controller = {
    async load() { calls.load++; return current; }, getState: () => current,
    subscribe(listener) { calls.subscribe++; listeners.add(listener); return () => { calls.unsubscribe++; listeners.delete(listener); }; },
    async lookup(ip, options) { calls.lookup.push([ip, options]); return controller.answer(ip); },
    noteExitIp(ip) { calls.note.push(ip); },
    async setColumns(list) { calls.columns.push([...list]); controller.set({ settings: { ...current.settings, columns: list } }); return { ok: true }; },
    dispose() { calls.dispose++; },
    answer: ip => ({ ok: true, record: geoRecord({ ip }), fromCache: false }),
    set(patch) { current = Object.freeze({ ...current, ...patch, revision: current.revision + 1 }); for (const listener of [...listeners]) listener(); },
  };
  return { controller, calls };
}
// Saved checks give the rows their exit addresses without any live check: { profileId: ip }.
function geoHistory(entries, now = Date.now()) {
  const items = Object.fromEntries(Object.entries(entries).map(([id, ip]) => [id, [{ firstAt: now - 3 * GEO_MIN, lastAt: now - 3 * GEO_MIN, checks: 1, ok: true, code: '', ms: 40, dns: 'ok', tls: 'ok', status: 200, ip }]]));
  return historyStore(memoryArea({ version: 1, enabled: true, items }));
}
const GEO_EXITS = { 'p-a': '8.8.8.8', 'p-b': '1.1.1.1', 'p-c': '9.9.9.9', 'p-d': '10.0.0.7' };
const geoOpen = (geo, extra = {}) => opened({ source: rosterSource(), history: geoHistory(GEO_EXITS), geoController: geo.controller, ...extra });
const geoCell = (current, id, column) => within(current.attr('data-proxy-profile', id), node => node.props?.['data-col'] === column)[0];
const geoHeads = current => current.nodes(node => node.props?.role === 'columnheader').map(node => node.props['data-col']);
const geoCells = (current, id) => within(current.attr('data-proxy-profile', id), node => node.props?.role === 'gridcell').map(node => node.props['data-col']);
const geoText = (current, node) => current.text(node).replace(/\s+/g, ' ').trim();
const geoShape = (node, skip = () => false) => { if (Array.isArray(node)) return node.map(child => geoShape(child, skip)).filter(child => child !== undefined); if (!node?.props) return node ?? null; if (skip(node)) return null; return { type: typeof node.type === 'function' ? 'component:' + node.type.name : node.type, props: Object.fromEntries(Object.entries(node.props).filter(([key]) => !['ref', 'children'].includes(key)).map(([key, value]) => [key, typeof value === 'function' ? '[fn]' : value])), children: geoShape(node.props.children, skip) }; };
function geoStorage(initial = {}) {
  const store = new Map(Object.entries(initial)), calls = [];
  return { store, calls, area: { getItem(key) { calls.push(['get', key]); return store.has(key) ? store.get(key) : null; }, setItem(key, value) { calls.push(['set', key]); store.set(key, String(value)); }, removeItem(key) { calls.push(['remove', key]); store.delete(key); } } };
}
async function withGeoStorage(area, body) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: area });
  try { return await body(); } finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage; }
}

test('without a controller, with a broken one, or while its state is unread, the manager is exactly what it was and no notice appears', async () => {
  const never = fakeGeo(); never.controller.load = () => new Promise(() => {});
  const rejecting = fakeGeo(); rejecting.controller.load = async () => { throw new Error('storage is gone'); };
  const brokenSubscribe = fakeGeo(); brokenSubscribe.controller.subscribe = () => { throw new Error('no listeners'); };
  const unread = fakeGeo({ loaded: false });
  const variants = [['no controller', {}], ['load never resolves', { geoController: never.controller }], ['load rejects', { geoController: rejecting.controller }], ['subscribe throws', { geoController: brokenSubscribe.controller }], ['state not loaded', { geoController: unread.controller }],
    ['the factory throws', { browser: { storage: { local: { get() {} } } }, history: geoHistory({}), createGeo: () => { throw new Error('no controller'); } }]];
  for (const [label, extra] of variants) {
    const current = await opened({ source: rosterSource(), ...extra });
    try {
      assert.equal(hook(current, 'data-proxy-geo-banner'), undefined, label + ': no notice'); assert.equal(rowIds(current).length, 5, label + ': the list is intact');
      assert.equal(current.attr('data-proxy-table').props['aria-colcount'], 9, label); assert.deepEqual(geoHeads(current), ['select', 'name', 'type', 'address', 'country', 'check', 'ip', 'checked', 'actions'], label);
      assert.equal(hook(current, 'data-proxy-geo-detail'), undefined); assert.equal(current.nodes(node => node.props && Object.keys(node.props).some(key => key.startsWith('data-proxy-geo'))).length, 0, label + ': no geolocation hook anywhere');
    } finally { current.unmount(); }
  }
  assert.equal(brokenSubscribe.calls.lookup.length + rejecting.calls.lookup.length + never.calls.lookup.length, 0);
});

test('with the feature off and the notice not dismissed, the notice is the ONLY visible change of the manager', async () => {
  const at = Date.now() - 7 * GEO_MIN;
  const baseline = await opened({ source: rosterSource(), history: geoHistory(GEO_EXITS, at) }); const plain = geoShape(baseline.render()); baseline.unmount();
  const off = fakeGeo({ enabled: false, ready: false, readyProviders: [], settings: defaultGeoSettings() });
  const current = await opened({ source: rosterSource(), history: geoHistory(GEO_EXITS, at), geoController: off.controller });
  try {
    const banner = current.attr('data-proxy-geo-banner', 'invite'); assert.ok(banner, 'the invitation is shown');
    const withBanner = geoShape(current.render(), node => node.props['data-proxy-geo-banner'] !== undefined);
    assert.deepEqual(withBanner, plain, 'removing the notice leaves the page byte-for-byte what it was');
    assert.equal(current.attr('data-proxy-table').props['aria-colcount'], 9); assert.equal(hook(current, 'data-proxy-geo-detail'), undefined);
    click(current, 'data-proxy-menu', 'columns'); current.render(); assert.equal(hook(current, 'data-proxy-geo-column'), undefined, 'no geolocation entry in the columns menu'); click(current, 'data-proxy-menu', 'columns'); current.render();
    click(current, 'data-proxy-menu', 'list'); current.render(); assert.equal(hook(current, 'data-proxy-geo-lookup-all'), undefined, 'no bulk lookup while the feature is off');
    assert.deepEqual(off.calls.lookup, []); assert.deepEqual(off.calls.note, []);
  } finally { current.unmount(); }
});

test('the notice: an invitation while off (dismissible, remembered), a reminder while on without a provider (not dismissible), nothing when ready; a named region with a real link', async () => {
  const off = fakeGeo({ enabled: false, ready: false, readyProviders: [], settings: defaultGeoSettings() });
  const storage = geoStorage();
  await withGeoStorage(storage.area, async () => {
    const current = await geoOpen(off);
    try {
      const banner = current.attr('data-proxy-geo-banner', 'invite');
      assert.equal(banner.props.role, 'region'); assert.equal(banner.props['aria-label'], GEO_MANAGER_LABELS.en.banner_region);
      assert.equal(geoText(current, banner).includes(GEO_MANAGER_LABELS.en.banner_invite), true); assert.match(geoText(current, banner), /Nothing is sent until you turn it on/);
      const link = current.attr('data-proxy-geo-banner-link'); assert.equal(link.type, 'a'); assert.deepEqual([link.props.href, link.props.target, link.props.rel], ['proxy-geo-settings.html', '_blank', 'noopener']); assert.match(geoText(current, link), /Set up Proxy Manager Geolocation API/);
      const dismiss = current.attr('data-proxy-geo-banner-dismiss'); assert.equal(dismiss.type, 'button'); assert.equal(dismiss.props['aria-label'], GEO_MANAGER_LABELS.en.banner_dismiss);
      const section = current.attr('data-proxy-manager'); const order = section.props.children.flat(3).filter(Boolean).map(node => node.type + ':' + (node.props?.class ?? '')).slice(0, 3);
      assert.match(order[0], /^header:pm-listhead/); assert.equal(current.attr('data-tour', 'proxy').type, 'header', 'the tour anchor is still the list header'); assert.match(order[1], /pm-geo-banner/, 'the notice sits right under the header, above the filters and the grid');
      assert.deepEqual(storage.calls.filter(call => call[1] === GEO_BANNER_KEY && call[0] === 'set'), [], 'nothing is written before the person dismisses it');
      dismiss.props.onClick(); await current.settle();
      assert.equal(hook(current, 'data-proxy-geo-banner'), undefined, 'dismissed'); assert.equal(storage.store.get(GEO_BANNER_KEY), '{"version":1,"dismissed":true}'); assert.deepEqual(current.announcements.at(-1), GEO_MANAGER_LABELS.en.banner_dismissed);
      assert.equal(storage.calls.filter(call => call[0] === 'set').length, 1, 'one write, to its own key'); assert.equal(storage.calls.filter(call => call[0] === 'set').every(call => call[1] === GEO_BANNER_KEY), true);
      off.controller.set({ enabled: true, ready: false, settings: { ...defaultGeoSettings(), enabled: true } }); await current.settle();
      const reminder = current.attr('data-proxy-geo-banner', 'not-ready'); assert.ok(reminder, 'a dismissed invitation does not hide the reminder'); assert.equal(current.attr('data-proxy-geo-banner-dismiss'), undefined, 'the reminder cannot be dismissed');
      assert.match(geoText(current, reminder), /Geolocation API is on, but no provider is ready — add a key\./); assert.ok(current.attr('data-proxy-geo-banner-link'));
      off.controller.set({ ready: true, readyProviders: ['maxmind'] }); await current.settle(); assert.equal(hook(current, 'data-proxy-geo-banner'), undefined, 'ready: no notice');
      off.controller.set({ enabled: false, ready: false, settings: defaultGeoSettings() }); await current.settle(); assert.equal(hook(current, 'data-proxy-geo-banner'), undefined, 'switching off again stays quiet: the dismissal is kept');
    } finally { current.unmount(); }
    const again = await geoOpen(fakeGeo({ enabled: false, ready: false, readyProviders: [], settings: defaultGeoSettings() }));
    try { assert.equal(hook(again, 'data-proxy-geo-banner'), undefined, 'the dismissal survives a new visit'); } finally { again.unmount(); }
    const ready = await geoOpen(fakeGeo());
    try { assert.equal(hook(ready, 'data-proxy-geo-banner'), undefined, 'a ready provider needs no notice'); } finally { ready.unmount(); }
    const reminder = await geoOpen(fakeGeo({ ready: false, readyProviders: [] }));
    try { assert.ok(reminder.attr('data-proxy-geo-banner', 'not-ready'), 'the reminder shows although the invitation was dismissed'); } finally { reminder.unmount(); }
  });
  const russian = await opened({ source: rosterSource(), locale: 'ru', geoController: fakeGeo({ enabled: false, ready: false, readyProviders: [], settings: defaultGeoSettings() }).controller });
  try { const text = geoText(russian, hook(russian, 'data-proxy-geo-banner')); assert.match(text, /^Улучшите результаты: укажите ключ API геолокации — менеджер покажет страну, город, сеть и признаки прокси\/VPN для внешнего IP каждого прокси\. Без вашего включения ничего не отправляется\./); assert.match(text, /Настроить Proxy Manager Geolocation API/); } finally { russian.unmount(); }
});

test('the notice survives a blocked localStorage: it renders, and dismissing hides it for this visit without throwing', async () => {
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  await withGeoStorage(blocked, async () => {
    const current = await geoOpen(fakeGeo({ enabled: false, ready: false, readyProviders: [], settings: defaultGeoSettings() }));
    try { assert.ok(current.attr('data-proxy-geo-banner', 'invite')); current.attr('data-proxy-geo-banner-dismiss').props.onClick(); await current.settle(); assert.equal(hook(current, 'data-proxy-geo-banner'), undefined); assert.equal(rowIds(current).length, 5); } finally { current.unmount(); }
  });
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'); delete globalThis.localStorage;
  try { const current = await geoOpen(fakeGeo({ enabled: false, ready: false, readyProviders: [], settings: defaultGeoSettings() })); try { assert.ok(current.attr('data-proxy-geo-banner', 'invite'), 'no localStorage at all'); } finally { current.unmount(); } } finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); }
});

test('the notice link opens the settings page in a new tab through the tabs API, swallows every failure, and leaves the plain link alone without that API', async () => {
  const off = () => fakeGeo({ enabled: false, ready: false, readyProviders: [], settings: defaultGeoSettings() });
  const created = [], browser = { runtime: { id: 'x'.repeat(32), getURL: path => 'chrome-extension://' + 'x'.repeat(32) + '/' + path }, tabs: { create: async options => { created.push(options); } } };
  const current = await opened({ source: rosterSource(), geoController: off().controller, browser });
  try {
    let prevented = 0; current.attr('data-proxy-geo-banner-link').props.onClick({ preventDefault() { prevented++; } });
    assert.deepEqual(created, [{ url: 'chrome-extension://' + 'x'.repeat(32) + '/proxy-geo-settings.html' }]); assert.equal(prevented, 1, 'the click is handled by the tabs API');
  } finally { current.unmount(); }
  for (const create of [() => { throw new Error('closing'); }, () => Promise.reject(new Error('closing'))]) {
    const failing = await opened({ source: rosterSource(), geoController: off().controller, browser: { ...browser, tabs: { create } } });
    try { failing.attr('data-proxy-geo-banner-link').props.onClick({ preventDefault() {} }); await failing.settle(); assert.ok(failing.attr('data-proxy-geo-banner', 'invite'), 'a failing tabs API changes nothing'); } finally { failing.unmount(); }
  }
  const plain = await opened({ source: rosterSource(), geoController: off().controller });
  try { let prevented = 0; plain.attr('data-proxy-geo-banner-link').props.onClick({ preventDefault() { prevented++; } }); assert.equal(prevented, 0, 'without the tabs API the link works by itself'); } finally { plain.unmount(); }
});

test('the controller is created once per mount, read once and disposed with the page when it is ours; an injected one is never disposed by the page', async () => {
  const ours = fakeGeo(), created = [];
  const current = await opened({ source: rosterSource(), browser: { storage: { local: { get() {} } } }, createGeo: api => { created.push(api); return ours.controller; } });
  try { current.update({ active: true }); await current.settle(); current.update({ active: false }); await current.settle(); current.update({ active: true }); await current.settle(); } finally { current.unmount(); }
  assert.equal(created.length, 1, 'one controller for the mount'); assert.equal(ours.calls.load, 1); assert.equal(ours.calls.subscribe, 1); assert.equal(ours.calls.unsubscribe, 1); assert.equal(ours.calls.dispose, 1);
  const injected = fakeGeo(), page = await opened({ source: rosterSource(), geoController: injected.controller }); page.unmount();
  assert.equal(injected.calls.dispose, 0, 'the owner of an injected controller disposes it'); assert.equal(injected.calls.unsubscribe, 1, 'but the page stops listening');
  const none = await opened({ source: rosterSource(), createGeo: () => { throw new Error('must not be asked: this browser has no storage API'); } }); none.unmount();
});

test('the five columns appear between the exit IP and the check time while the feature is on, in canonical order, and leave with it', async () => {
  const geo = fakeGeo(), current = await geoOpen(geo);
  try {
    assert.deepEqual(geoHeads(current), ['select', 'name', 'type', 'address', 'country', 'check', 'ip', 'geo', 'geonet', 'geokind', 'geoflags', 'geotime', 'checked', 'actions']);
    assert.equal(current.attr('data-proxy-table').props['aria-colcount'], 14); assert.equal(current.attr('data-proxy-table').props['aria-rowcount'], 6, 'rows plus the header');
    for (const id of ['p-a', 'p-b', 'p-e']) assert.deepEqual(geoCells(current, id), ['select', 'name', 'type', 'address', 'country', 'check', 'ip', 'geo', 'geonet', 'geokind', 'geoflags', 'geotime', 'checked', 'actions'], id + ': a cell for every column');
    const grid = current.attr('data-proxy-table').props.class; assert.match(grid, /\bpm-geo\b/); for (const column of GEO_COLUMNS) assert.match(grid, new RegExp('\\bpm-on-' + column + '\\b'));
    assert.equal(current.attr('data-proxy-table').props['aria-colcount'], current.nodes(node => node.props?.role === 'columnheader').length, 'colcount equals the number of column headers');
    for (const head of current.nodes(node => node.props?.role === 'columnheader' && String(node.props['data-col']).startsWith('geo'))) { assert.equal(head.props['aria-sort'], undefined, head.props['data-col'] + ' is not sortable'); assert.equal(within(head, node => node.type === 'button').length, 0); assert.ok(geoText(current, head).length > 0); }
    assert.deepEqual(current.nodes(node => node.props?.role === 'columnheader' && String(node.props['data-col']).startsWith('geo')).map(node => geoText(current, node)), ['Location', 'Network', 'Address type', 'Flags', 'Time']);
    geo.controller.set({ settings: { ...defaultGeoSettings(), enabled: true, columns: ['geotime', 'geo'] } }); await current.settle();
    assert.deepEqual(geoHeads(current), ['select', 'name', 'type', 'address', 'country', 'check', 'ip', 'geo', 'geotime', 'checked', 'actions']); assert.equal(current.attr('data-proxy-table').props['aria-colcount'], 11);
    assert.match(current.attr('data-proxy-table').props.class, /pm-on-geo\b/); assert.doesNotMatch(current.attr('data-proxy-table').props.class, /pm-on-geonet|pm-on-geokind|pm-on-geoflags/);
    geo.controller.set({ settings: { ...defaultGeoSettings(), enabled: true, columns: [] } }); await current.settle();
    assert.deepEqual(geoHeads(current), ['select', 'name', 'type', 'address', 'country', 'check', 'ip', 'checked', 'actions']); assert.doesNotMatch(current.attr('data-proxy-table').props.class, /pm-geo\b|pm-on-geo/, 'no columns chosen: the plain grid');
    geo.controller.set({ settings: { ...defaultGeoSettings(), enabled: true } }); await current.settle(); assert.equal(geoHeads(current).filter(column => column.startsWith('geo')).length, 5);
    geo.controller.set({ enabled: false, ready: false, readyProviders: [], settings: defaultGeoSettings() }); await current.settle();
    assert.deepEqual(geoHeads(current), ['select', 'name', 'type', 'address', 'country', 'check', 'ip', 'checked', 'actions'], 'off: the columns are gone'); assert.equal(current.attr('data-proxy-table').props['aria-colcount'], 9);
    geo.controller.set({ enabled: true, ready: true, readyProviders: ['maxmind'], settings: { ...defaultGeoSettings(), enabled: true } }); await current.settle(); assert.equal(geoHeads(current).filter(column => column.startsWith('geo')).length, 5, 'back on: they return');
    click(current, 'data-proxy-menu', 'columns'); current.render(); click(current, 'data-proxy-column-toggle', 'ip'); await current.settle();
    assert.match(current.attr('data-proxy-table').props.class, /pm-off-ip/, 'the base columns keep their own switches'); assert.deepEqual(geoHeads(current), ['select', 'name', 'type', 'address', 'country', 'check', 'geo', 'geonet', 'geokind', 'geoflags', 'geotime', 'checked', 'actions']); assert.equal(current.attr('data-proxy-table').props['aria-colcount'], 13);
  } finally { current.unmount(); }
});

test('every cell shows one phase: the reason, the busy marker, the error with its retry, the lookup, the data, and old data dimmed with its age', async () => {
  const geo = fakeGeo({ records: geoDict({ '8.8.8.8': geoRecord(), '1.1.1.1': geoRecord({ ip: '1.1.1.1', at: Date.now() - 25 * GEO_HOUR, country: 'DE', countryName: 'Germany', city: 'Berlin', region: 'Berlin', timezone: 'Europe/Berlin', asn: 3320, org: 'Deutsche Telekom AG', isp: '', kind: 'residential', flags: { ...geoEmptyFlags(), proxy: false } }) }), pending: geoDict({ '9.9.9.9': true }) });
  const current = await geoOpen(geo);
  try {
    const state = id => geoCell(current, id, 'geo').props['data-proxy-geo-state'];
    assert.deepEqual(['p-a', 'p-b', 'p-c', 'p-d', 'p-e'].map(state), ['data', 'data', 'empty', 'private', 'no-ip']);
    // fresh data: location, network, kind, flags, time
    assert.match(geoText(current, geoCell(current, 'p-a', 'geo')), /Mountain View\s*,\s*California\s+US United States/); assert.equal(geoCell(current, 'p-a', 'geo').props.class.includes('is-stale'), false);
    assert.match(geoText(current, geoCell(current, 'p-a', 'geonet')), /AS15169 Google LLC\s+Google Fiber/); assert.equal(within(geoCell(current, 'p-a', 'geokind'), node => node.props?.['data-proxy-geo-kind'] === 'hosting').length, 1); assert.match(geoText(current, geoCell(current, 'p-a', 'geokind')), /Hosting/);
    assert.deepEqual(within(geoCell(current, 'p-a', 'geoflags'), node => node.props?.['data-proxy-geo-flag']).map(node => node.props['data-proxy-geo-flag']), ['hosting']);
    const clock = geoText(current, geoCell(current, 'p-a', 'geotime')); assert.match(clock, /UTC[+-]\d\d:\d\d/); assert.match(clock, /America\/Los_Angeles/);
    assert.equal(geoCell(current, 'p-a', 'geo').props.title.startsWith('MaxMind GeoIP / GeoLite (GeoLite City), received'), true, 'a fresh cell names its source and age');
    // the mismatch marker: the tag of p-a is DE, the provider says US; p-b's tag is FR against DE (also a mismatch); p-d has DE against nothing
    const mark = within(geoCell(current, 'p-a', 'geo'), node => node.props?.['data-proxy-geo-mismatch'])[0]; assert.ok(mark, 'tag DE against provider US'); assert.match(mark.props.title, /The provider's country \(US\) differs from your tag \(DE\)/); assert.ok(within(mark, node => node.props?.['data-glyph'] === 'warning' || node.props?.children === 'differs from your tag').length >= 1, 'a shape and words, not only a colour');
    assert.equal(within(geoCell(current, 'p-b', 'geo'), node => node.props?.['data-proxy-geo-mismatch']).length, 1, 'FR against DE');
    // stale: dimmed, the age in the title
    assert.equal(geoCell(current, 'p-b', 'geo').props.class.includes('is-stale'), true); assert.match(geoCell(current, 'p-b', 'geo').props.title, /^Out of date: received /); assert.match(geoText(current, geoCell(current, 'p-b', 'geonet')), /AS3320 Deutsche Telekom AG/);
    assert.equal(within(geoCell(current, 'p-b', 'geonet'), node => node.props?.class === 'pm-geo-secondary').length, 0, 'an empty ISP adds no second line');
    assert.equal(geoText(current, geoCell(current, 'p-b', 'geoflags')), 'None flagged'); assert.equal(within(geoCell(current, 'p-b', 'geoflags'), node => node.props?.['data-proxy-geo-flags'] === 'none')[0].props.title, 'The provider did not flag anything');
    // pending: a busy marker, aria-busy, a button that does nothing
    const busy = geoCell(current, 'p-c', 'geo'); assert.equal(busy.props['aria-busy'], 'true'); assert.match(geoText(current, busy), /Looking up…/); const pendingButton = within(busy, node => node.props?.['data-proxy-geo-lookup'])[0]; assert.equal(pendingButton.props['aria-disabled'], 'true'); pendingButton.props.onClick(); assert.deepEqual(geo.calls.lookup, [], 'a running lookup is not started twice');
    for (const column of ['geonet', 'geokind', 'geoflags', 'geotime']) assert.equal(geoCell(current, 'p-c', column).props['aria-busy'], 'true', column + ' is busy too');
    // private and unchecked rows: a dash with the reason for assistive technology, no button
    assert.match(geoText(current, geoCell(current, 'p-d', 'geo')), /Not a public address — nothing is sent/); assert.equal(within(current.attr('data-proxy-profile', 'p-d'), node => node.props?.['data-proxy-geo-lookup']).length, 0, 'a private exit IP is never offered to a provider');
    assert.match(geoText(current, geoCell(current, 'p-e', 'geo')), /Run a check first/); assert.equal(within(current.attr('data-proxy-profile', 'p-e'), node => node.props?.['data-proxy-geo-lookup']).length, 0);
    for (const id of ['p-d', 'p-e']) for (const column of ['geo', 'geonet', 'geokind', 'geoflags', 'geotime']) assert.match(geoCell(current, id, column).props.class, /is-empty/, id + '/' + column + ' is marked empty so cards drop it');
    // empty with a ready provider: the lookup button (here: p-c once nothing is pending)
    geo.controller.set({ pending: geoDict({}) }); await current.settle();
    const lookup = within(geoCell(current, 'p-c', 'geo'), node => node.props?.['data-proxy-geo-lookup'])[0]; assert.equal(lookup.type, 'button'); assert.equal(lookup.props['data-proxy-geo-lookup'], 'p-c'); assert.match(lookup.props['aria-label'], /^Look up the location: Charlie$/); assert.equal(geoCell(current, 'p-c', 'geo').props.class.includes('is-empty'), false);
    // the error with its retry
    geo.controller.set({ errors: geoDict({ '9.9.9.9': { code: 'quota', at: Date.now() } }) }); await current.settle();
    assert.equal(geoCell(current, 'p-c', 'geo').props['data-proxy-geo-state'], 'error'); const error = within(geoCell(current, 'p-c', 'geo'), node => node.props?.['data-proxy-geo-error'])[0]; assert.deepEqual([error.props['data-proxy-geo-error'], error.props['data-code']], ['p-c', 'quota']); assert.match(geoText(current, error), /Quota used up/);
    const retry = within(geoCell(current, 'p-c', 'geo'), node => node.props?.['data-proxy-geo-lookup'])[0]; assert.match(retry.props['aria-label'], /^Retry the lookup: Charlie$/); assert.match(geoText(current, retry), /Retry/);
    // not ready: no button, the reason in words
    geo.controller.set({ errors: geoDict({}), ready: false, readyProviders: [] }); await current.settle();
    assert.equal(within(current.attr('data-proxy-profile', 'p-c'), node => node.props?.['data-proxy-geo-lookup']).length, 0); assert.match(geoText(current, geoCell(current, 'p-c', 'geo')), /No provider is ready — add a key/);
    assert.equal(geoCell(current, 'p-a', 'geo').props['data-proxy-geo-state'], 'data', 'stored data stays visible without a ready provider');
  } finally { current.unmount(); }
});

test('flags, kinds and empty fields: chips only for what the provider said, "None flagged", and a dash with the reason when it reports no flags at all', async () => {
  const records = geoDict({
    '8.8.8.8': geoRecord({ flags: { ...geoEmptyFlags(), proxy: true, vpn: true, tor: false, threat: true }, kind: 'business' }),
    '1.1.1.1': geoRecord({ ip: '1.1.1.1', provider: 'ipapi', service: '', flags: { ...geoEmptyFlags(), proxy: true }, kind: '', timezone: '', asn: null, org: '', isp: '' }),
    '9.9.9.9': geoRecord({ ip: '9.9.9.9', flags: geoEmptyFlags(), kind: 'cdn', country: '', countryName: '', region: '', city: '' }),
  });
  const current = await geoOpen(fakeGeo({ records }));
  try {
    const chips = id => within(geoCell(current, id, 'geoflags'), node => node.props?.['data-proxy-geo-flag']);
    assert.deepEqual(chips('p-a').map(node => node.props['data-proxy-geo-flag']), ['proxy', 'vpn', 'threat'], 'true flags only, in catalogue order'); assert.deepEqual(chips('p-a').map(node => geoText(current, node)), ['Proxy', 'VPN', 'Threat']);
    for (const chip of chips('p-a')) assert.match(chip.props.title, /as reported by the provider/);
    assert.match(chips('p-b')[0].props.title, /For ip-api\.com this flag also covers VPN and Tor/, 'the ip-api proxy flag says what it covers'); assert.doesNotMatch(chips('p-a')[0].props.title, /ip-api/);
    assert.match(geoText(current, geoCell(current, 'p-a', 'geokind')), /Business/);
    assert.match(geoCell(current, 'p-b', 'geokind').props.class, /is-empty/); assert.match(geoText(current, geoCell(current, 'p-b', 'geokind')), /Not reported/); assert.match(geoCell(current, 'p-b', 'geonet').props.class, /is-empty/); assert.match(geoCell(current, 'p-b', 'geotime').props.class, /is-empty/);
    const none = geoCell(current, 'p-c', 'geoflags'); assert.match(none.props.class, /is-empty/); assert.match(geoText(current, none), /This provider or plan does not report flags/); assert.equal(within(none, node => node.props?.['data-proxy-geo-flag']).length, 0, 'unreported is not "no"');
    assert.match(geoText(current, geoCell(current, 'p-c', 'geokind')), /CDN/); assert.match(geoCell(current, 'p-c', 'geo').props.class, /is-empty/, 'a record without a place is an empty location cell');
  } finally { current.unmount(); }
});

test('provider text is only ever a text node: a hostile city, organisation or zone creates no element, no attribute and no handler', async () => {
  const hostile = '<img src=x onerror=alert(1)>', closing = '</bdi><script>alert(2)</script>';
  const records = geoDict({ '8.8.8.8': geoRecord({ city: hostile, region: closing, countryName: hostile, org: closing, isp: hostile, timezone: 'Europe/Berlin' }) });
  const current = await geoOpen(fakeGeo({ records }));
  try {
    openPeek(current, 'p-a'); current.render();
    const all = current.nodes(() => true);
    assert.equal(all.filter(node => ['img', 'script', 'iframe', 'svg:script'].includes(node.type)).length, 0, 'no element is created from provider text');
    for (const node of all) for (const [key, value] of Object.entries(node.props)) { if (key === 'children') continue; assert.equal(typeof value === 'string' && /onerror|<script|<img/i.test(value), false, 'attribute ' + key + ' of ' + node.type + ' holds provider text'); assert.equal(/^on[A-Z]/.test(key) && typeof value === 'string', false); }
    assert.match(geoText(current, geoCell(current, 'p-a', 'geo')), /<img src=x onerror=alert\(1\)>/, 'it is shown, as text');
    const bdis = within(geoCell(current, 'p-a', 'geo'), node => node.type === 'bdi'); assert.ok(bdis.length >= 2, 'provider text is isolated in <bdi>');
    for (const column of ['geo', 'geonet']) for (const bdi of within(geoCell(current, 'p-a', column), node => node.type === 'bdi' && typeof node.props.children === 'string')) assert.equal(bdi.props.title, undefined);
    const detail = current.attr('data-proxy-geo-detail', 'p-a'); assert.ok(detail); assert.match(geoText(current, detail), /<img src=x onerror=alert\(1\)>/);
  } finally { current.unmount(); }
});

test('nothing is looked up by opening the list, rendering, the clock or the saved history: only a person or a completed manual check starts a lookup', async () => {
  const geo = fakeGeo(), current = await geoOpen(geo);
  try {
    assert.deepEqual(geoCell(current, 'p-c', 'geo').props['data-proxy-geo-state'], 'empty', 'a saved exit IP with no record is only offered a button');
    for (let index = 0; index < 5; index++) { current.update({ active: true }); await current.settle(); }
    current.hide(); await current.settle(); current.show(); await current.settle(); current.pagehide(); current.pageshow(); await current.settle();
    openPeek(current, 'p-c'); current.render(); click(current, 'data-proxy-menu', 'list'); current.render(); click(current, 'data-proxy-menu', 'columns'); current.render();
    geo.controller.set({ revision: 99 }); await current.settle();
    assert.deepEqual(geo.calls.lookup, [], 'no lookup'); assert.deepEqual(geo.calls.note, [], 'no automatic lookup either');
  } finally { current.unmount(); }
});

test('the lookup button asks for one address with force, for a public exit IP only, and reports the outcome; a failure of this page is shown and cleared by the next success', async () => {
  const geo = fakeGeo(), current = await geoOpen(geo);
  try {
    const button = () => within(geoCell(current, 'p-c', 'geo'), node => node.props?.['data-proxy-geo-lookup'])[0];
    geo.controller.answer = () => ({ ok: false, error: 'timeout' });
    await button().props.onClick(); await current.settle();
    assert.deepEqual(geo.calls.lookup, [['9.9.9.9', { force: true }]]); assert.equal(geoCell(current, 'p-c', 'geo').props['data-proxy-geo-state'], 'error', 'a transient failure (which the controller does not remember) is still shown to the person who asked');
    assert.match(geoText(current, geoCell(current, 'p-c', 'geo')), /No reply/); assert.match(current.announcements.at(-1), /^Charlie: No reply\.$/);
    geo.controller.answer = ip => ({ ok: true, record: geoRecord({ ip }), fromCache: false });
    await button().props.onClick(); await current.settle();
    assert.equal(geo.calls.lookup.length, 2); assert.deepEqual(geo.calls.lookup[1], ['9.9.9.9', { force: true }]); assert.equal(geoCell(current, 'p-c', 'geo').props['data-proxy-geo-state'], 'empty', 'the failure is gone; the record arrives through the controller state'); assert.match(current.announcements.at(-1), /^Charlie: location received\.$/);
    geo.controller.set({ records: geoDict({ '9.9.9.9': geoRecord({ ip: '9.9.9.9' }) }) }); await current.settle(); assert.equal(geoCell(current, 'p-c', 'geo').props['data-proxy-geo-state'], 'data');
    geo.controller.answer = () => ({ ok: false, error: 'no-key' }); assert.equal(within(current.attr('data-proxy-profile', 'p-c'), node => node.props?.['data-proxy-geo-lookup']).length, 0, 'a row with data offers no button in the grid; the details panel offers Refresh');
    openPeek(current, 'p-c'); current.render(); const detailButton = within(current.attr('data-proxy-geo-detail', 'p-c'), node => node.props?.['data-proxy-geo-lookup'])[0]; assert.match(geoText(current, detailButton), /Refresh/); await detailButton.props.onClick(); await current.settle();
    assert.deepEqual(geo.calls.lookup.at(-1), ['9.9.9.9', { force: true }]); assert.equal(geoCell(current, 'p-c', 'geo').props['data-proxy-geo-state'], 'data', 'a local set-up problem is not a failure of the address');
    geo.controller.answer = () => { throw new Error('the controller broke'); }; await detailButton.props.onClick(); await current.settle(); assert.equal(rowIds(current).length, 5, 'a throwing controller changes nothing');
  } finally { current.unmount(); }
  const privateOnly = fakeGeo(), other = await geoOpen(privateOnly);
  try { assert.equal(within(other.attr('data-proxy-profile', 'p-d'), node => node.props?.['data-proxy-geo-lookup']).length, 0); openPeek(other, 'p-d'); other.render(); assert.equal(within(other.attr('data-proxy-geo-detail', 'p-d'), node => node.props?.['data-proxy-geo-lookup']).length, 0, 'not in the details either'); assert.deepEqual(privateOnly.calls.lookup, []); } finally { other.unmount(); }
});

test('after a COMPLETED manual check with a public exit IP the controller is told about it: once per result, never for a failure, a private address or a missing one', async () => {
  const geo = fakeGeo(), source = rosterSource(); source.state.checkResults = { 'p-a': passCheck('8.8.8.8'), 'p-b': passCheck('10.1.2.3'), 'p-c': { state: 'fail', code: 'timeout', phase: 'tunnel' }, 'p-d': passCheck(null), 'p-e': passCheck('2606:4700:4700:0:0:0:0:1111') };
  const current = await opened({ source, geoController: geo.controller });
  try {
    assert.deepEqual(geo.calls.note, [], 'nothing on open');
    await click(current, 'data-proxy-check-profile', 'p-a'); await current.settle(); assert.deepEqual(geo.calls.note, ['8.8.8.8']);
    await click(current, 'data-proxy-check-profile', 'p-b'); await current.settle(); assert.deepEqual(geo.calls.note, ['8.8.8.8'], 'a private exit IP is never passed on');
    await click(current, 'data-proxy-check-profile', 'p-c'); await current.settle(); await click(current, 'data-proxy-check-profile', 'p-d'); await current.settle(); assert.deepEqual(geo.calls.note, ['8.8.8.8'], 'a failed check and a check without an address say nothing');
    await click(current, 'data-proxy-check-profile', 'p-e'); await current.settle(); assert.deepEqual(geo.calls.note, ['8.8.8.8', '2606:4700:4700::1111'], 'IPv6 goes on in its canonical form');
    geo.calls.note.length = 0; source.state.checkResults = { 'p-a': passCheck('8.8.8.8'), 'p-b': passCheck('1.1.1.1'), 'p-c': passCheck('8.8.8.8'), 'p-d': { state: 'fail', code: 'auth-failed', phase: 'auth' }, 'p-e': passCheck('172.16.0.9') };
    await click(current, 'data-proxy-check-visible'); await current.settle();
    assert.deepEqual(geo.calls.note, ['8.8.8.8', '1.1.1.1', '8.8.8.8'], 'a batch tells the controller about every completed passing result, in order; it removes duplicates itself');
    assert.deepEqual(geo.calls.lookup, [], 'the page itself never calls lookup after a check');
  } finally { current.unmount(); }
  const throwing = fakeGeo(); throwing.controller.noteExitIp = () => { throw new Error('controller broke'); }; const second = rosterSource(); second.state.checkResults = { 'p-a': passCheck('8.8.8.8') };
  const page = await opened({ source: second, geoController: throwing.controller });
  try { await click(page, 'data-proxy-check-profile', 'p-a'); await page.settle(); assert.equal(page.attr('data-proxy-health', 'p-a').props['data-state'], 'pass', 'a controller that throws never breaks a check'); } finally { page.unmount(); }
});

test('the analyzer check of the connected proxy also tells the controller, and only when it passed with a public address', async () => {
  for (const [diagnostic, expected] of [[passCheck('8.8.8.8'), ['8.8.8.8']], [passCheck('192.168.0.4'), []], [{ state: 'fail', code: 'timeout', phase: 'tunnel' }, []]]) {
    const geo = fakeGeo(), source = server(); source.state.diagnosticResult = diagnostic;
    source.state.snapshot = { configuration: { ...source.state.snapshot.configuration, enabled: true, selectedId: direct.id }, status: { state: 'connected', profileId: direct.id } };
    const current = await opened({ source, geoController: geo.controller });
    try { assert.deepEqual(geo.calls.note, []); await click(current, 'data-proxy-check'); await current.settle(); assert.equal(source.count('diagnose'), 1); assert.deepEqual(geo.calls.note, expected, JSON.stringify(diagnostic)); } finally { current.unmount(); }
  }
});

test('"look up all": shown while the feature is on, says why it is unavailable, asks first (count and provider), and sends only the confirmed, still-wanted public addresses', async () => {
  const geo = fakeGeo({ records: geoDict({ '1.1.1.1': geoRecord({ ip: '1.1.1.1' }) }) }), current = await geoOpen(geo, {});
  try {
    const open = () => { click(current, 'data-proxy-menu', 'list'); current.render(); return current.attr('data-proxy-geo-lookup-all'); };
    let item = open(); assert.ok(item); assert.equal(item.props.disabled, false); assert.equal(item.props.role, 'menuitem'); assert.match(geoText(current, item), /Look up the location of every checked proxy/); click(current, 'data-proxy-menu', 'list'); current.render();
    geo.controller.set({ ready: false, readyProviders: [] }); await current.settle(); item = open(); assert.equal(item.props.disabled, true); assert.match(geoText(current, item), /No provider is ready — add a key/); assert.equal(item.props.title, GEO_MANAGER_LABELS.en.cell_not_ready, 'disabled with a reason, not hidden'); click(current, 'data-proxy-menu', 'list'); current.render();
    geo.controller.set({ ready: true, readyProviders: ['maxmind'] }); await current.settle();
    item = open(); item.props.onClick(); await current.settle();
    const confirm = hook(current, 'data-proxy-geo-confirm'); assert.ok(confirm); assert.equal(confirm.props['data-proxy-geo-confirm'], '2', 'two distinct public addresses without fresh data: 8.8.8.8 and 9.9.9.9 (1.1.1.1 is fresh, 10.0.0.7 is private)');
    assert.equal(confirm.props.role, 'group'); assert.equal(confirm.props['aria-label'], GEO_MANAGER_LABELS.en.confirm_label); assert.match(geoText(current, confirm), /^Send 2 addresses to MaxMind GeoIP \/ GeoLite\?/); assert.match(geoText(current, confirm), /hosts, ports and logins are not sent/);
    assert.deepEqual(geo.calls.lookup, [], 'asking sends nothing');
    // the situation changes while the question is open: 9.9.9.9 gets a fresh record elsewhere
    geo.controller.set({ records: geoDict({ '1.1.1.1': geoRecord({ ip: '1.1.1.1' }), '9.9.9.9': geoRecord({ ip: '9.9.9.9' }) }) }); await current.settle();
    current.attr('data-proxy-geo-confirm-yes').props.onClick(); await current.settle();
    assert.deepEqual(geo.calls.lookup, [['8.8.8.8', { force: true }]], 'only what was confirmed and is still wanted'); assert.equal(hook(current, 'data-proxy-geo-confirm'), undefined, 'the question closes'); assert.equal(current.announcements.at(-1), 'Looking up locations: 1.');
    geo.calls.lookup.length = 0; geo.controller.set({ records: geoDict({}) }); await current.settle();
    open().props.onClick(); await current.settle(); assert.equal(hook(current, 'data-proxy-geo-confirm').props['data-proxy-geo-confirm'], '3'); assert.match(geoText(current, hook(current, 'data-proxy-geo-confirm')), /^Send 3 addresses/);
    current.attr('data-proxy-geo-confirm-no').props.onClick(); await current.settle(); assert.equal(hook(current, 'data-proxy-geo-confirm'), undefined); assert.deepEqual(geo.calls.lookup, [], 'Cancel sends nothing');
    open().props.onClick(); await current.settle(); const prevented = []; hook(current, 'data-proxy-workspace').props.onKeyDown({ key: 'Escape', target: { tagName: 'DIV', closest: () => null }, preventDefault() { prevented.push(1); } }); await current.settle();
    assert.equal(hook(current, 'data-proxy-geo-confirm'), undefined, 'Escape cancels'); assert.deepEqual(geo.calls.lookup, []);
    open().props.onClick(); await current.settle(); current.attr('data-proxy-geo-confirm-yes').props.onClick(); await current.settle();
    assert.deepEqual(geo.calls.lookup, [['8.8.8.8', { force: true }], ['1.1.1.1', { force: true }], ['9.9.9.9', { force: true }]], 'list order, each distinct public address once, always with force'); assert.equal(current.announcements.at(-1), 'Looking up locations: 3.');
    geo.calls.lookup.length = 0; geo.controller.set({ pending: geoDict({ '8.8.8.8': true, '1.1.1.1': true, '9.9.9.9': true }) }); await current.settle(); item = open(); assert.equal(item.props.disabled, true); assert.match(geoText(current, item), /No addresses without fresh data/, 'nothing left to ask while all are running');
  } finally { current.unmount(); }
  const another = fakeGeo(), page = await geoOpen(another);
  try { click(page, 'data-proxy-menu', 'list'); page.render(); page.attr('data-proxy-geo-lookup-all').props.onClick(); await page.settle(); assert.ok(hook(page, 'data-proxy-geo-confirm')); another.controller.set({ ready: false, readyProviders: [] }); await page.settle(); assert.equal(hook(page, 'data-proxy-geo-confirm'), undefined, 'the question goes away with the provider'); assert.deepEqual(another.calls.lookup, []); page.hide(); await page.settle(); } finally { page.unmount(); }
});

test('the plural forms of the confirmation follow the language: Russian one, few and many', async () => {
  for (const [exits, expected] of [[{ 'p-a': '8.8.8.8' }, /^Отправить 1 адрес провайдеру MaxMind GeoIP \/ GeoLite\?/], [{ 'p-a': '8.8.8.8', 'p-b': '1.1.1.1' }, /^Отправить 2 адреса провайдеру/], [{ 'p-a': '8.8.8.8', 'p-b': '1.1.1.1', 'p-c': '9.9.9.9', 'p-d': '8.8.4.4', 'p-e': '1.0.0.1' }, /^Отправить 5 адресов провайдеру/]]) {
    const geo = fakeGeo(), current = await opened({ source: rosterSource(), locale: 'ru', history: geoHistory(exits), geoController: geo.controller });
    try { click(current, 'data-proxy-menu', 'list'); current.render(); assert.match(geoText(current, current.attr('data-proxy-geo-lookup-all')), /Определить геолокацию для всех проверенных/); current.attr('data-proxy-geo-lookup-all').props.onClick(); await current.settle(); assert.match(geoText(current, hook(current, 'data-proxy-geo-confirm')), expected); } finally { current.unmount(); }
  }
  const english = fakeGeo(), page = await opened({ source: rosterSource(), history: geoHistory({ 'p-a': '8.8.8.8' }), geoController: english.controller });
  try { click(page, 'data-proxy-menu', 'list'); page.render(); page.attr('data-proxy-geo-lookup-all').props.onClick(); await page.settle(); assert.match(geoText(page, hook(page, 'data-proxy-geo-confirm')), /^Send 1 address to MaxMind/); } finally { page.unmount(); }
});

test('the columns menu has a second group for the geolocation columns; a choice goes to the controller in canonical order and never touches the stored view', async () => {
  const geo = fakeGeo(), storage = geoStorage();
  await withGeoStorage(storage.area, async () => {
    const current = await geoOpen(geo);
    try {
      click(current, 'data-proxy-menu', 'columns'); current.render();
      const group = current.nodes(node => node.props?.role === 'group' && node.props['aria-label'] === 'Geolocation (API)')[0]; assert.ok(group, 'a named group');
      const items = within(group, node => node.props?.['data-proxy-geo-column']); assert.deepEqual(items.map(node => node.props['data-proxy-geo-column']), GEO_COLUMNS); for (const item of items) { assert.equal(item.props.role, 'menuitemcheckbox'); assert.equal(item.props['aria-checked'], true); }
      assert.deepEqual(items.map(node => geoText(current, node)), ['Location', 'Network', 'Address type', 'Flags', 'Time']);
      assert.ok(current.attr('data-proxy-column-toggle', 'ip'), 'the base group is still there'); assert.ok(current.attr('data-proxy-view-reset'));
      const before = storage.calls.length; click(current, 'data-proxy-geo-column', 'geoflags'); await current.settle();
      assert.deepEqual(geo.calls.columns, [['geo', 'geonet', 'geokind', 'geotime']]); assert.equal(storage.calls.length, before, 'no localStorage access at all'); assert.equal(geoHeads(current).includes('geoflags'), false, 'the column leaves when the controller says so');
      click(current, 'data-proxy-menu', 'columns'); current.render(); assert.equal(current.attr('data-proxy-geo-column', 'geoflags').props['aria-checked'], false); click(current, 'data-proxy-geo-column', 'geoflags'); await current.settle();
      assert.deepEqual(geo.calls.columns.at(-1), ['geo', 'geonet', 'geokind', 'geoflags', 'geotime'], 'canonical order again'); assert.deepEqual(geoHeads(current).filter(column => column.startsWith('geo')), GEO_COLUMNS);
      click(current, 'data-proxy-menu', 'columns'); current.render(); click(current, 'data-proxy-column-toggle', 'ip'); await current.settle();
      assert.deepEqual(storage.calls.filter(call => call[0] === 'set').map(call => call[1]), [PROXY_VIEW_KEY], 'a base column choice writes only the view'); assert.equal(geo.calls.columns.length, 2, 'and never reaches the geolocation controller');
    } finally { current.unmount(); }
    const failing = fakeGeo(); failing.controller.setColumns = () => Promise.reject(new Error('storage gone')); const page = await geoOpen(failing);
    try { click(page, 'data-proxy-menu', 'columns'); page.render(); click(page, 'data-proxy-geo-column', 'geo'); await page.settle(); assert.equal(rowIds(page).length, 5, 'a failing store changes nothing'); } finally { page.unmount(); }
  });
});

test('the details panel shows the provider, the age, every field, the three-state flags, the quota and the caveat; without data it says why, in plain words', async () => {
  const geo = fakeGeo({ providers: { maxmind: { enabled: true, ready: true, reason: '', status: 'ok', error: null, okAt: Date.now(), remaining: 481, pausedUntil: null } }, records: geoDict({ '8.8.8.8': geoRecord({ flags: { ...geoEmptyFlags(), proxy: true, vpn: false } }), '1.1.1.1': geoRecord({ ip: '1.1.1.1', at: Date.now() - 30 * GEO_HOUR }) }), pending: geoDict({ '9.9.9.9': true }) });
  const current = await geoOpen(geo);
  try {
    const detail = id => { openPeek(current, id); current.render(); return current.attr('data-proxy-geo-detail', id); };
    let panel = detail('p-a'); assert.ok(panel); assert.equal(panel.props['aria-labelledby'], 'proxy-geo-title-p-a'); assert.match(geoText(current, panel), /^Geolocation \(as reported by the provider\)/);
    const text = geoText(current, panel); assert.match(text, /MaxMind GeoIP \/ GeoLite \(GeoLite City\) · updated 5 min\. ago/); for (const expected of ['US', 'United States', 'California', 'Mountain View', 'America/Los_Angeles', 'AS15169', 'Google LLC', 'Google Fiber', 'Hosting']) assert.ok(text.includes(expected), expected);
    assert.match(text, /Requests left with the provider: 481/); assert.match(text, /Provider data is approximate and may differ from other sources\./);
    const flagState = Object.fromEntries(within(panel, node => node.props?.['data-proxy-geo-flag-state']).map(node => [node.props['data-proxy-geo-flag-state'], node.props['data-state']])); assert.deepEqual(flagState, { proxy: 'yes', vpn: 'no', tor: 'unreported', hosting: 'unreported', mobile: 'unreported', relay: 'unreported', residentialProxy: 'unreported', threat: 'unreported' });
    assert.match(geoText(current, within(panel, node => node.props?.['data-proxy-geo-flag-state'] === 'proxy')[0]), /Proxy\s*:\s*yes/); assert.match(geoText(current, within(panel, node => node.props?.['data-proxy-geo-flag-state'] === 'tor')[0]), /Tor\s*:\s*not reported/);
    for (const item of within(panel, node => node.props?.['data-proxy-geo-flag-state'])) assert.match(item.props.title, /as reported by the provider/);
    assert.ok(within(panel, node => node.props?.['data-proxy-geo-mismatch'] === 'p-a').length === 1, 'tag DE against US: a visible note in the details'); assert.match(text, /differs from your tag \(DE\)/);
    assert.equal(within(panel, node => node.props?.['data-proxy-geo-stale']).length, 0); const refresh = within(panel, node => node.props?.['data-proxy-geo-lookup'])[0]; assert.match(geoText(current, refresh), /Refresh/);
    panel = detail('p-b'); assert.ok(within(panel, node => node.props?.['data-proxy-geo-stale'] === 'p-b').length === 1, 'old data says so'); assert.match(geoText(current, panel), /Out of date: received/);
    panel = detail('p-c'); assert.equal(panel.props['aria-busy'], 'true'); assert.match(geoText(current, panel), /Looking up…/); assert.equal(panel.props['data-state'], 'empty');
    panel = detail('p-d'); assert.match(geoText(current, panel), /The exit address is not public, so it is not sent to a provider\./); assert.equal(within(panel, node => node.props?.['data-proxy-geo-lookup']).length, 0);
    panel = detail('p-e'); assert.match(geoText(current, panel), /The exit IP appears after this proxy is checked\./);
    geo.controller.set({ pending: geoDict({}) }); await current.settle(); panel = detail('p-c'); assert.match(geoText(current, panel), /No data yet\. Press "Look up now"\./); const lookup = within(panel, node => node.props?.['data-proxy-geo-lookup'])[0]; assert.match(geoText(current, lookup), /Look up now/);
    await lookup.props.onClick(); await current.settle(); assert.deepEqual(geo.calls.lookup.at(-1), ['9.9.9.9', { force: true }]);
    geo.controller.set({ errors: geoDict({ '9.9.9.9': { code: 'unauthorized', at: Date.now() } }) }); await current.settle(); panel = detail('p-c'); assert.match(geoText(current, panel), /The lookup failed: Key rejected\./);
    geo.controller.set({ errors: geoDict({}), ready: false, readyProviders: [] }); await current.settle(); panel = detail('p-c'); assert.match(geoText(current, panel), /No provider is ready\. Add a key on the settings page\./); assert.equal(within(panel, node => node.props?.['data-proxy-geo-lookup']).length, 0);
    geo.controller.set({ enabled: false, ready: false, settings: defaultGeoSettings() }); await current.settle(); openPeek(current, 'p-a'); current.render(); assert.equal(hook(current, 'data-proxy-geo-detail'), undefined, 'off: the panel is what it was');
  } finally { current.unmount(); }
});

test('the roving grid keyboard still works across the new cells: one tab stop per row, buttons follow it, arrows move between rows', async () => {
  const geo = fakeGeo(), current = await geoOpen(geo);
  try {
    const stops = () => current.nodes(node => node.props?.['data-proxy-geo-lookup']).map(node => [node.props['data-proxy-geo-lookup'], node.props.tabIndex]);
    const first = tabStops(current)[0]; assert.equal(first, 'p-a', 'the first row is the tab stop'); assert.deepEqual(stops(), [['p-a', 0], ['p-b', -1], ['p-c', -1]], 'only the buttons of the current row are tab stops');
    press(current, first, 'ArrowDown'); current.render(); const next = tabStops(current)[0]; assert.equal(next, 'p-b', 'ArrowDown moves the roving stop across rows that have geolocation cells');
    for (const [id, tab] of stops()) assert.equal(tab, id === next ? 0 : -1, 'the lookup button of ' + id + ' follows the row');
    const before = geo.calls.lookup.length; press(current, next, 'Enter'); press(current, next, ' '); assert.equal(geo.calls.lookup.length, before, 'row keys never start a lookup');
    const cells = geoCells(current, next); assert.equal(cells.filter(column => column.startsWith('geo')).length, 5);
  } finally { current.unmount(); }
});

test('geolocation cells hold no secret and the page reads nothing but the state: no key, token or request body ever reaches a slot or a node', async () => {
  const geo = fakeGeo({ hasCredentials: { maxmind: true, ipgeolocation: true, ipdata: false, ipapi: false } }), current = await geoOpen(geo);
  try {
    const dump = JSON.stringify(current.slots.map(slot => slot?.value ?? slot?.ref?.current)) + JSON.stringify(geoShape(current.render()));
    assert.doesNotMatch(dump, /licenseKey|accountId|apiKey|Authorization|CANARY_KEY/i); assert.equal(typeof geo.controller.getState().hasCredentials.maxmind, 'boolean');
  } finally { current.unmount(); }
});
