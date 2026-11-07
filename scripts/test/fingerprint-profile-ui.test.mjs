// E22-19 / ADR-066: previews, library-only commits, hostile imports and revision fencing.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createFingerprintProfileUi } from '../../apps/production-extension/fingerprint-profile-ui.js';
import { createApiConfiguration, validateApiConfiguration, updateApiConfiguration, exportApiConfiguration, API_CONFIG_CATALOG, API_CONFIGURATION_MAX_BYTES } from '../../apps/production-extension/api-configuration.js';
import { snapshotFingerprintProfile, storeFingerprintProfile, generateConsistentDevice } from '../../apps/production-extension/fingerprint-profiles.js';
import { applyAntidetectCopy } from '../production-locales-antidetect.mjs';
import { applyFingerprintCopy, FINGERPRINT_UI_KEYS, FINGERPRINT_UI_MESSAGES } from '../production-locales-fingerprint.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';
import { FINGERPRINT_LIBRARY_KEYS, FINGERPRINT_LIBRARY_LABELS, fingerprintLibraryLabels } from '../../apps/production-extension/fingerprint-library-labels.js';
import { FINGERPRINT_DEVICE_KEYS, FINGERPRINT_DEVICE_LABELS, fingerprintDeviceLabels } from '../../apps/production-extension/fingerprint-device-labels.js';
import { languageLabel } from '../../apps/production-extension/fingerprint-field-hints.js';
const clone = value => structuredClone(value), turn = () => new Promise(resolve => setImmediate(resolve));
function event() { const listeners = new Set(); return { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn), emit: (...args) => { for (const fn of listeners) fn(...args); }, get size() { return listeners.size; } }; }
function messages(locale) { const language = PRODUCTION_LANGUAGES.find(item => item.id === locale); return applyFingerprintCopy(applyAntidetectCopy(JSON.parse(readFileSync(new URL('../../apps/production-extension/' + (language.uiOnly ? 'ui-locales' : '_locales') + '/' + locale + '/messages.json', import.meta.url))), locale), locale); }
function server() {
  const calls = [], value = { configuration: createApiConfiguration(), revision: 7 };
  const snapshot = () => ({ schemaVersion: 1, type: 'api-config-state', configuration: clone(value.configuration), revision: value.revision, registration: value.registration ?? (value.configuration.enabled ? 'ready' : 'inactive'), reloadRequired: false, earlyAccess: value.earlyAccess ?? 'ready' });
  const api = { runtime: { id: 'profile-fixture', getURL: path => 'chrome-extension://profile-fixture/' + path, sendMessage: async request => { calls.push(clone(request)); const intercepted = value.intercept?.(request); if (intercepted !== undefined) return intercepted;
    if (request.type === 'ui-api-config-set') { if (request.expectedRevision !== value.revision) return { schemaVersion: 1, type: 'api-config-error', code: 'stale-revision' }; const checked = validateApiConfiguration(request.configuration); assert.equal(checked.ok, true); value.configuration = checked.value; value.revision++; } return snapshot(); } }, storage: { onChanged: event() }, permissions: { onRemoved: event() }, tabs: { create: async options => { (value.opened ??= []).push(options); return {}; } } };
  return { api, calls, value, snapshot, writes: () => calls.filter(call => call.type === 'ui-api-config-set') };
}
// `nav` replaces the fake real browser (see realNavigator below); `display` defines window-level globals the real-environment snapshot reads.
function harness({ s = server(), locale = 'en', props: initialProps = {}, nav = null, display = {} } = {}) {
  const previous = Object.fromEntries(['window', 'location', 'navigator', 'screen', 'devicePixelRatio', 'outerWidth', 'outerHeight'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const own = {}; own.top = own; Object.defineProperty(globalThis, 'window', { configurable: true, value: own }); Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: 'chrome-extension://profile-fixture/options.html#antidetect' } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: nav ?? { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153.0.0.0 Safari/537.36', appVersion: '5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32', vendor: 'Google Inc.', language: 'en-US', languages: ['en-US', 'en'], userAgentData: { brands: [{ brand: 'Chromium', version: '153' }], mobile: false, platform: 'Windows' } } });
  for (const [key, value] of Object.entries(display)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const slots = [], effects = [], table = messages(locale), applied = []; let cursor = 0, changed = true, tree, props = { active: true, onApplied: state => applied.push(state), ...initialProps };
  const hooks = { useState(initial) { const slot = slots[cursor++] ??= { value: initial }; return [slot.value, next => { const value = typeof next === 'function' ? next(slot.value) : next; if (!Object.is(slot.value, value)) { slot.value = value; changed = true; } }]; }, useRef(initial) { return (slots[cursor++] ??= { ref: { current: initial } }).ref; }, useEffect(fn, dependencies) { const slot = slots[cursor++] ??= {}; if (!slot.dependencies || dependencies.some((value, index) => !Object.is(value, slot.dependencies[index]))) { slot.dependencies = dependencies; effects.push(() => { slot.cleanup?.(); slot.cleanup = fn(); }); } } };
  const { FingerprintProfilePanel } = createFingerprintProfileUi({ ...hooks, h: (type, props) => ({ type, props }), useLocale: () => locale, translate: key => table[key]?.message ?? key, browserApi: s.api });
  function render() { cursor = 0; changed = false; tree = FingerprintProfilePanel(props); while (effects.length) effects.shift()(); return tree; }
  async function settle() { for (let i = 0; i < 12; i++) { if (changed) render(); await turn(); } if (changed) render(); }
  function nodes(predicate) { const results = []; function visit(node) { if (Array.isArray(node)) { node.forEach(visit); return; } if (!node?.props) return; if (predicate(node)) results.push(node); visit(node.props.children); } visit(tree); return results; }
  const attr = key => nodes(node => node.props['data-profile-' + key] === true)[0];
  return { s, applied, table, render, settle, nodes, attr, update(patch) { props = { ...props, ...patch }; changed = true; render(); }, setLocale(next) { locale = next; Object.assign(table, messages(next)); changed = true; render(); }, unmount() { for (const slot of slots) slot?.cleanup?.(); for (const [key, descriptor] of Object.entries(previous)) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]; } };
}
const input = (h, key, value) => h.attr(key).props.onInput({ currentTarget: { value } });
const select = (h, key, value) => h.attr(key).props.onChange({ currentTarget: { value } });
const click = async (h, key) => { await h.attr(key).props.onClick(); await h.settle(); };
// Library rows and segmented generator choices are addressed through their own row/option nodes.
function descend(node, predicate) { if (Array.isArray(node)) { for (const item of node) { const found = descend(item, predicate); if (found) return found; } return undefined; } if (!node?.props) return undefined; if (predicate(node)) return node; return descend(node.props.children, predicate); }
const choose = (h, key, value) => h.attr(key).props.children.find(option => option.props['data-profile-option'] === value).props.onClick();
const row = (h, id) => h.nodes(node => node.props['data-profile-row'] === id)[0];
const within = (node, key) => descend(node, child => child.props['data-profile-' + key] === true);
const pick = (h, id) => within(row(h, id), 'pick').props.onClick();
const act = async (h, id, key) => { await within(row(h, id), key).props.onClick(); await h.settle(); };
const rowLabels = h => h.attr('library').props.children.map(item => descend(item, node => node.props.class === 'fingerprint-row__name').props.children);
const api = (configuration, id) => configuration.apis.find(row => row.id === id);
// Another surface (the header master switch, another window) saves a newer revision.
function external(h, mutate) { const next = clone(h.s.value.configuration); mutate(next); h.s.value.configuration = next; h.s.value.revision++; h.s.api.storage.onChanged.emit({ 'api-configuration:v1': {} }, 'local'); }
const conflict = next => { const row = api(next, 'hardware-concurrency'); row.mode = 'custom'; row.selected = { kind: 'value', value: 3 }; };
// ADR-107 hint cards: severity (icon + word), message, «claimed / this browser», rows and actions; read the parts by attribute.
const issueText = issue => descend(issue, node => node.props['data-profile-issue-message'] === true)?.props.children;
const issueRowList = issue => descend(issue, node => node.props['data-profile-issue-rows'] === true)?.props.children ?? '';

test('compact profile header shows the global context and keeps preview notices and Apply actions separate', async () => {
  const h = harness();
  try {
    h.render(); await h.settle();
    const header = h.nodes(node => node.type === 'header' && node.props.class === 'fingerprint-header')[0];
    assert.equal(h.attr('scope').props.children, h.table.antidetect_editor_global.message);
    assert.equal(header.props.children[0].props.children[1], h.attr('scope'));
    assert.equal(h.nodes(node => node.props['data-profile-scope']).length, 1);
    assert.equal(h.nodes(node => node.type === 'p' && node.props.children === h.table.fingerprint_description.message).length, 0);
    await click(h, 'generate');
    assert.equal(h.attr('apply').props['aria-disabled'], false);
    assert.equal(h.attr('notice').props.children, h.table.fingerprint_preview_ready.message);
    assert.equal(h.s.writes().length, 0);
    await click(h, 'cancel');
    assert.equal(h.attr('apply').props['aria-disabled'], true);
    assert.equal(h.s.writes().length, 0);
  } finally { h.unmount(); }
});

test('generation, device/system choices and preview never write; Apply performs one CAS without enabling the master', async () => {
  const h = harness(); try { h.render(); await h.settle(); const before = clone(h.s.value.configuration); assert.equal(h.s.calls.length, 1); choose(h, 'device-type', 'laptop'); choose(h, 'os', 'windows-10'); choose(h, 'browser', 'edge'); select(h, 'language', 'ru-RU'); select(h, 'screen', '1920x1080'); await h.settle(); await click(h, 'generate'); assert.deepEqual(h.s.value.configuration, before); assert.equal(h.s.writes().length, 0); assert.equal(h.attr('apply').props['aria-disabled'], false); await click(h, 'apply'); assert.equal(h.s.writes().length, 1); assert.equal(h.s.writes()[0].expectedRevision, 7); assert.equal(h.s.value.configuration.enabled, false); assert.deepEqual(h.s.value.configuration.sites, before.sites); assert.equal(api(h.s.value.configuration, 'hardware-concurrency').mode, 'custom'); assert.equal(api(h.s.value.configuration, 'navigator-platform').selected.value, 'Win32'); assert.equal(api(h.s.value.configuration, 'navigator-language').selected.value, 'ru-RU'); assert.equal(api(h.s.value.configuration, 'screen-width').selected.value, 1920); assert.equal(h.applied.length, 1); assert.equal(h.attr('apply').props['aria-disabled'], true); } finally { h.unmount(); }
});

test('Save as profile writes only the reusable library, retains generated preview and applies only through the separate Apply action', async () => {
  const h = harness(); try { h.render(); await h.settle(); const before = clone(h.s.value.configuration); await click(h, 'generate'); input(h, 'name', 'Portable workstation'); await h.settle(); await click(h, 'save-named'); const saved = h.s.value.configuration; assert.equal(saved.fingerprintProfiles.length, 1); assert.match(saved.fingerprintProfiles[0].id, /^fp-[a-f0-9]{32}$/); assert.equal(saved.fingerprintProfiles[0].label, 'Portable workstation'); assert.equal(saved.fingerprintProfiles[0].apis.find(row => row.id === 'hardware-concurrency').mode, 'custom'); assert.deepEqual(saved.apis, before.apis); assert.equal(saved.enabled, false); assert.equal(h.attr('apply').props['aria-disabled'], false); await click(h, 'apply'); assert.equal(h.s.writes().length, 2); assert.equal(h.s.writes()[1].expectedRevision, 8); assert.equal(api(h.s.value.configuration, 'hardware-concurrency').mode, 'custom'); assert.equal(h.s.value.configuration.fingerprintProfiles.length, 1); } finally { h.unmount(); }
});

test('library-only Save, Rename and Delete preserve the unsubmitted active API editor without applying or parsing its raw JSON', async () => {
  const s = server(), profile = snapshotFingerprintProfile(s.value.configuration, 'Existing profile'); s.value.configuration = storeFingerprintProfile(s.value.configuration, profile); const appliedRows = clone(s.value.configuration.apis), h = harness({ s });
  try {
    h.render(); await h.settle(); select(h, 'api-mode', 'custom'); select(h, 'value-kind', 'value'); await h.settle(); input(h, 'api-json', '{"unfinished":'); input(h, 'name', 'New saved profile'); await h.settle();
    const checkBuffer = () => { assert.equal(h.attr('api').props.value, 'hardware-concurrency'); assert.equal(h.attr('api-mode').props.value, 'custom'); assert.equal(h.attr('value-kind').props.value, 'value'); assert.equal(h.attr('api-json').props.value, '{"unfinished":'); assert.deepEqual(s.value.configuration.apis, appliedRows); assert.equal(h.attr('error'), undefined); };
    await click(h, 'save-named'); assert.equal(s.writes().length, 1); checkBuffer(); assert.equal(s.value.configuration.fingerprintProfiles.at(-1).apis.find(row => row.id === 'hardware-concurrency').mode, 'bypass');
    // ADR-107: rename is inline with its own text; Delete commits at once (Undo is offered afterwards).
    await act(h, profile.id, 'rename'); input(h, 'rename-input', 'Renamed existing'); await h.settle(); await click(h, 'rename-save'); assert.equal(s.writes().length, 2); checkBuffer();
    await act(h, profile.id, 'delete'); assert.equal(s.writes().length, 3); checkBuffer();
    select(h, 'api', 'webgpu'); await h.settle(); select(h, 'api-mode', 'custom'); select(h, 'value-kind', 'null'); input(h, 'name', 'Keep explicit null editor'); await h.settle(); await click(h, 'save-named');
    assert.equal(h.attr('api').props.value, 'webgpu'); assert.equal(h.attr('api-mode').props.value, 'custom'); assert.equal(h.attr('value-kind').props.value, 'null'); assert.deepEqual(s.value.configuration.apis, appliedRows); assert.equal(s.writes().length, 4);
  } finally { h.unmount(); }
});

test('a hundred complete profiles remain searchable and loadable without applying or truncating the library', async () => {
  const s = server(), profile = snapshotFingerprintProfile(s.value.configuration, 'Fixture');
  s.value.configuration.fingerprintProfiles = Array.from({ length: 100 }, (_, index) => ({ ...clone(profile), id: 'fp-' + index.toString(16).padStart(32, '0'), label: 'Hardware ' + index }));
  assert.equal(validateApiConfiguration(s.value.configuration).ok, true);
  const h = harness({ s }); try { h.render(); await h.settle(); assert.equal(h.attr('library').props.children.length, 100); input(h, 'search', 'Hardware 97'); await h.settle(); assert.equal(h.attr('library').props.children.length, 1); const id = s.value.configuration.fingerprintProfiles[97].id; pick(h, id); await h.settle(); await act(h, id, 'load'); assert.equal(s.value.configuration.fingerprintProfiles.length, 100); assert.equal(s.writes().length, 0); assert.equal(within(row(h, id), 'pick').props['aria-expanded'], true); assert.deepEqual(rowLabels(h), ['Hardware 97']); } finally { h.unmount(); }
});

test('searching and editing a label reuse validated derived data for an unchanged hundred-profile configuration', async () => {
  const s = server(), profile = snapshotFingerprintProfile(s.value.configuration, 'Fixture');
  s.value.configuration.fingerprintProfiles = Array.from({ length: 100 }, (_, index) => ({ ...clone(profile), id: 'fp-' + index.toString(16).padStart(32, '0'), label: 'Hardware ' + index }));
  const h = harness({ s }); const ownKeys = Reflect.ownKeys; let validations = 0;
  try {
    h.render(); await h.settle();
    Reflect.ownKeys = value => { if (value?.format === 'detect.expert/api-configuration' && Array.isArray(value.apis)) validations++; return ownKeys(value); };
    for (const value of ['H', 'Ha', 'Hardware 9']) { input(h, 'search', value); await h.settle(); }
    input(h, 'name', 'Typing a new label'); await h.settle(); h.setLocale('ru'); await h.settle();
    assert.equal(validations, 0, 'text-only updates do not revalidate full profile/configuration trees'); assert.equal(h.attr('library').props.children.length, 11); assert.equal(s.writes().length, 0);
    select(h, 'api-mode', 'custom'); select(h, 'value-kind', 'value'); await h.settle(); input(h, 'api-json', '16'); await h.settle(); await click(h, 'stage-api');
    assert.ok(validations > 0, 'a real configuration change validates before staging and refreshes derived data');
  } finally { Reflect.ownKeys = ownKeys; h.unmount(); }
});

test('typing beside a large imported-library preview reuses its formatted value instead of serializing it again', async () => {
  const h = harness(), stringify = JSON.stringify; let largeSerializations = 0;
  try {
    h.render(); await h.settle(); const configuration = createApiConfiguration(), profile = snapshotFingerprintProfile(configuration, 'Fixture');
    configuration.fingerprintProfiles = Array.from({ length: 100 }, (_, index) => ({ ...clone(profile), id: 'fp-' + index.toString(16).padStart(32, '0'), label: 'Imported ' + index })); const json = exportApiConfiguration(configuration);
    await h.attr('file').props.onChange({ currentTarget: { files: [{ size: Buffer.byteLength(json), text: async () => json }], value: 'fixture.json' } }); await h.settle();
    JSON.stringify = (value, ...args) => { if (Array.isArray(value) && value.length === 100 && Array.isArray(value[0]?.apis)) largeSerializations++; return stringify(value, ...args); };
    for (const query of ['I', 'Im', 'Imported']) { input(h, 'search', query); await h.settle(); } input(h, 'name', 'Pending label'); await h.settle();
    assert.equal(largeSerializations, 0); assert.equal(h.s.writes().length, 0);
  } finally { JSON.stringify = stringify; h.unmount(); }
});

test('search, Load, confirmed Rename and Delete preserve applied APIs and an uncommitted preview', async () => {
  const s = server(), cpu = updateApiConfiguration(s.value.configuration, 'hardware-concurrency', { mode: 'custom', selected: { kind: 'value', value: 24 } }).value;
  s.value.configuration = storeFingerprintProfile(s.value.configuration, snapshotFingerprintProfile(cpu, 'CPU 24')); const id = s.value.configuration.fingerprintProfiles[0].id, before = clone(s.value.configuration.apis), h = harness({ s });
  try { h.render(); await h.settle(); input(h, 'search', '24'); pick(h, id); await h.settle(); await act(h, id, 'load'); assert.equal(s.writes().length, 0); assert.equal(h.attr('api-json').props.value, '24'); await act(h, id, 'rename'); input(h, 'rename-input', 'Renamed'); await h.settle(); assert.equal(s.writes().length, 0); await click(h, 'rename-save'); assert.equal(s.value.configuration.fingerprintProfiles[0].label, 'Renamed'); assert.deepEqual(s.value.configuration.apis, before); assert.equal(h.attr('api-json').props.value, '24'); input(h, 'search', ''); await h.settle(); await act(h, id, 'delete'); assert.equal(s.writes().length, 2); assert.equal(s.value.configuration.fingerprintProfiles.length, 0); assert.deepEqual(s.value.configuration.apis, before); assert.equal(h.attr('api-json').props.value, '24'); } finally { h.unmount(); }
});

test('one-row JSON editing validates typed API values and explicit null/unset states before staging without writes', async () => {
  const h = harness(); try { h.render(); await h.settle(); select(h, 'api-mode', 'custom'); select(h, 'value-kind', 'value'); await h.settle(); input(h, 'api-json', '"not a processor count"'); await h.settle(); await click(h, 'stage-api'); assert.equal(h.attr('error').props.children, h.table.antidetect_invalid.message); assert.equal(h.attr('apply').props['aria-disabled'], true); input(h, 'api-json', '16'); await h.settle(); await click(h, 'stage-api'); assert.equal(h.attr('error'), undefined); assert.equal(h.s.writes().length, 0); await click(h, 'apply'); assert.equal(api(h.s.value.configuration, 'hardware-concurrency').selected.value, 16); select(h, 'api', 'webgpu'); await h.settle(); const kinds = h.attr('value-kind').props.children.map(option => option.props.value); assert.ok(kinds.includes('null')); select(h, 'api-mode', 'custom'); select(h, 'value-kind', 'null'); await h.settle(); await click(h, 'stage-api'); await click(h, 'apply'); assert.deepEqual(api(h.s.value.configuration, 'webgpu').selected, { kind: 'null' }); } finally { h.unmount(); }
});

test('JSON import is bounded and validated before replacing preview; export includes dormant settings and the complete named library', async () => {
  const h = harness(); try { h.render(); await h.settle(); const before = clone(h.s.value.configuration); const read = file => h.attr('file').props.onChange({ currentTarget: { files: [file], value: 'fixture.json' } }); let readCount = 0;
    await read({ size: API_CONFIGURATION_MAX_BYTES + 1, text: async () => { readCount++; return '{}'; } }); await h.settle(); assert.equal(readCount, 0); assert.equal(h.attr('error').props.children, h.table.antidetect_editor_tooLarge.message);
    await read({ size: 30, text: async () => '{"formatVersion":4,"formatVersion":4}' }); await h.settle(); assert.equal(h.attr('error').props.children, h.table.antidetect_editor_invalidJson.message); assert.deepEqual(h.s.value.configuration, before);
    const cpu = updateApiConfiguration(before, 'hardware-concurrency', { mode: 'custom', selected: { kind: 'value', value: 12 } }).value, imported = storeFingerprintProfile(cpu, snapshotFingerprintProfile(cpu, 'Imported profile')), json = exportApiConfiguration(imported);
    await read({ size: Buffer.byteLength(json), text: async () => json }); await h.settle(); assert.equal(h.s.writes().length, 0); assert.equal(h.attr('api-json').props.value, '12'); await click(h, 'export'); const exported = JSON.parse(h.attr('export-json').props.value); assert.equal(exported.apis.length, 158); assert.equal(exported.fingerprintProfiles[0].label, 'Imported profile'); assert.equal(exported.enabled, false); await click(h, 'apply'); assert.equal(h.s.value.configuration.fingerprintProfiles.length, 1); } finally { h.unmount(); }
});

test('every change in a large import is reachable through bounded localized pages, including the named-library field', async () => {
  const h = harness(); try {
    h.render(); await h.settle(); const configuration = createApiConfiguration(); configuration.apis = configuration.apis.map(row => ({ ...row, mode: 'off' }));
    const imported = storeFingerprintProfile(configuration, snapshotFingerprintProfile(configuration, 'Imported named library')), json = exportApiConfiguration(imported);
    await h.attr('file').props.onChange({ currentTarget: { files: [{ size: Buffer.byteLength(json), text: async () => json }], value: 'fixture.json' } }); await h.settle();
    const seen = new Set(), rows = () => h.nodes(node => typeof node.props['data-profile-change'] === 'string');
    assert.equal(h.nodes(node => typeof node.props['data-profile-changes-count'] === 'number')[0].props['data-profile-changes-count'], 159);
    assert.equal(h.attr('change-page').props.children, '1 / 3'); assert.equal(rows().length, 64); for (const row of rows()) seen.add(row.props['data-profile-change']); const library = rows().find(row => row.props['data-profile-change'] === 'global::fingerprintProfiles');
    await click(h, 'next'); assert.equal(h.attr('change-page').props.children, '2 / 3'); assert.equal(rows().length, 64); for (const row of rows()) seen.add(row.props['data-profile-change']);
    await click(h, 'next'); assert.equal(h.attr('change-page').props.children, '3 / 3'); assert.equal(rows().length, 31); for (const row of rows()) seen.add(row.props['data-profile-change']);
    assert.equal(library.props.children[1].props.children, h.table.fingerprint_library.message); assert.equal(seen.size, 159); assert.equal(h.attr('next').props.disabled, true); assert.equal(h.s.writes().length, 0);
    await click(h, 'previous'); assert.equal(h.attr('change-page').props.children, '2 / 3'); await click(h, 'generate'); assert.match(h.attr('change-page').props.children, /^1 \/ /);
  } finally { h.unmount(); }
});

test('a valid fixed UTC profile shows the precise Date/DST scope without falsely claiming a timezone inconsistency', async () => {
  const s = server(); s.value.configuration = updateApiConfiguration(s.value.configuration, 'timezone', { mode: 'custom', selected: { kind: 'value', value: { timeZone: 'UTC', offsetMinutes: 0 } } }).value; const h = harness({ s });
  try { h.render(); await h.settle(); const issue = h.nodes(node => node.props['data-profile-issue'] === 'timezone-metadata')[0]; assert.ok(issue); assert.equal(issueText(issue), h.table.fingerprint_issue_timezone_metadata.message); assert.match(issueText(issue), /Date.*daylight-saving/); assert.doesNotMatch(issueText(issue), /inconsistent|mismatch/); assert.equal(s.writes().length, 0); } finally { h.unmount(); }
});

test('library-only Save rebases a pending imported library without replacing it; conflicting Rename/Delete fail visibly before any write', async () => {
  const s = server(), original = snapshotFingerprintProfile(s.value.configuration, 'Applied library'); s.value.configuration = storeFingerprintProfile(s.value.configuration, original);
  const h = harness({ s });
  try {
    h.render(); await h.settle();
    const draft = updateApiConfiguration(createApiConfiguration(), 'hardware-concurrency', { mode: 'custom', selected: { kind: 'value', value: 12 } }).value;
    const importedProfile = snapshotFingerprintProfile(draft, 'Imported library'), imported = storeFingerprintProfile(draft, importedProfile), json = exportApiConfiguration(imported);
    await h.attr('file').props.onChange({ currentTarget: { files: [{ size: Buffer.byteLength(json), text: async () => json }], value: 'fixture.json' } }); await h.settle();
    input(h, 'name', 'Named from imported preview'); await h.settle(); await click(h, 'save-named');
    assert.equal(s.writes().length, 1); assert.equal(api(s.value.configuration, 'hardware-concurrency').mode, 'bypass');
    assert.ok(s.value.configuration.fingerprintProfiles.some(profile => profile.id === original.id)); assert.ok(!s.value.configuration.fingerprintProfiles.some(profile => profile.id === importedProfile.id));
    await click(h, 'export'); const pending = JSON.parse(h.attr('export-json').props.value);
    assert.equal(api(pending, 'hardware-concurrency').selected.value, 12); assert.ok(pending.fingerprintProfiles.some(profile => profile.id === importedProfile.id)); assert.ok(!pending.fingerprintProfiles.some(profile => profile.id === original.id)); assert.ok(pending.fingerprintProfiles.some(profile => profile.label === 'Named from imported preview'));
    const conflicting = clone(s.value.configuration); conflicting.fingerprintProfiles.find(profile => profile.id === original.id).label = 'Pending imported rename'; const conflictJson = exportApiConfiguration(conflicting);
    await h.attr('file').props.onChange({ currentTarget: { files: [{ size: Buffer.byteLength(conflictJson), text: async () => conflictJson }], value: 'fixture.json' } }); await h.settle();
    await act(h, original.id, 'rename'); input(h, 'rename-input', 'Rename applied profile'); await h.settle(); await click(h, 'rename-save');
    assert.equal(s.writes().length, 1); assert.equal(h.attr('error').props.children, h.table.antidetect_stale.message);
    await act(h, original.id, 'delete'); assert.equal(s.writes().length, 1); await click(h, 'export'); assert.equal(JSON.parse(h.attr('export-json').props.value).fingerprintProfiles.find(profile => profile.id === original.id).label, 'Pending imported rename');
  } finally { h.unmount(); }
});

for (const sameId of [true, false]) test(`FP05: Load uses the displayed saved profile while preserving an imported draft with ${sameId ? 'the same profile ID' : 'a different profile ID'}`, async () => {
  const s = server(), savedId = 'fp-' + '05'.repeat(16);
  const savedRecipe = updateApiConfiguration(createApiConfiguration(), 'hardware-concurrency', { mode: 'custom', selected: { kind: 'value', value: 4 } }).value;
  savedRecipe.preset = 'strict'; savedRecipe.webrtcNetworkPolicy = 'default_public_interface_only';
  const savedProfile = snapshotFingerprintProfile(savedRecipe, 'Saved four threads', savedId);
  s.value.configuration = storeFingerprintProfile(s.value.configuration, savedProfile);
  let imported = updateApiConfiguration(createApiConfiguration(), 'hardware-concurrency', { mode: 'custom', selected: { kind: 'value', value: 12 }, userValues: [{ id: 'retained', label: 'Retained', value: { kind: 'value', value: 24 } }] }).value;
  imported = updateApiConfiguration(imported, 'hardware-concurrency', { mode: 'custom', selected: { kind: 'value', value: 32 } }, 'pending.fixture.invalid').value;
  imported.enabled = true; imported.antidetectEnabled = false;
  const importedRecipe = updateApiConfiguration(createApiConfiguration(), 'hardware-concurrency', { mode: 'custom', selected: { kind: 'value', value: 64 } }).value;
  const importedProfile = snapshotFingerprintProfile(importedRecipe, 'Imported sixty-four threads', sameId ? savedId : 'fp-' + '15'.repeat(16));
  imported = storeFingerprintProfile(imported, importedProfile);
  if (!sameId) imported.fingerprintProfiles = Array.from({ length: 128 }, (_, index) => ({ ...clone(importedProfile), id: 'fp-' + (0x1500 + index).toString(16).padStart(32, '0') }));
  const h = harness({ s });
  try {
    h.render(); await h.settle(); const json = exportApiConfiguration(imported);
    await h.attr('file').props.onChange({ currentTarget: { files: [{ size: Buffer.byteLength(json), text: async () => json }], value: 'fixture.json' } }); await h.settle();
    assert.deepEqual(rowLabels(h), ['Saved four threads']);
    pick(h, savedId); await h.settle(); await act(h, savedId, 'load');
    assert.equal(h.attr('error'), undefined); assert.equal(h.attr('api-json').props.value, '4');
    await click(h, 'export'); const pending = JSON.parse(h.attr('export-json').props.value);
    assert.deepEqual(pending.apis.map(({ id, mode, selected, settings }) => ({ id, mode, selected, settings })), savedProfile.apis);
    assert.deepEqual(pending.fingerprintProfiles, imported.fingerprintProfiles, 'Load retains same-ID imported content or a full 128-profile pending library without adding a lookup row');
    assert.deepEqual(pending.sites, imported.sites); assert.equal(pending.enabled, true); assert.equal(pending.antidetectEnabled, false);
    assert.equal(pending.preset, savedProfile.preset); assert.equal(pending.webrtcNetworkPolicy, savedProfile.webrtcNetworkPolicy);
    assert.deepEqual(api(pending, 'hardware-concurrency').userValues, api(imported, 'hardware-concurrency').userValues);
    assert.equal(s.writes().length, 0, 'Load only stages a preview'); assert.equal(api(s.value.configuration, 'hardware-concurrency').mode, 'bypass');
  } finally { h.unmount(); }
});

test('parent draft and external revisions block every commit while preserving preview; Cancel then Refresh recovers explicitly', async () => {
  const h = harness(); try { h.render(); await h.settle(); await click(h, 'generate'); h.update({ disabled: true }); await h.settle(); assert.equal(h.attr('apply').props['aria-disabled'], true); input(h, 'name', 'Cannot write'); await h.settle(); await click(h, 'save-named'); await click(h, 'apply'); assert.equal(h.s.writes().length, 0); h.update({ disabled: false }); await h.settle(); external(h, conflict); await h.settle(); assert.ok(h.attr('stale')); await click(h, 'apply'); assert.equal(h.s.writes().length, 0); assert.equal(h.attr('refresh').props.disabled, true); await click(h, 'cancel'); await click(h, 'refresh'); assert.equal(h.attr('stale'), undefined); assert.equal(h.attr('apply').props['aria-disabled'], true); } finally { h.unmount(); } assert.equal(h.s.api.storage.onChanged.size, 0);
});

test('hiding fences delayed file reads, and returning detects changed revisions without discarding an existing draft', async () => {
  const h = harness(); let finish; try { h.render(); await h.settle(); await click(h, 'generate'); const previous = h.attr('api-json').props.value; const promise = h.attr('file').props.onChange({ currentTarget: { files: [{ size: 1, text: () => new Promise(resolve => { finish = resolve; }) }], value: 'fixture.json' } }); await h.settle(); h.update({ active: false }); await h.settle(); finish('{}'); await promise; await h.settle(); assert.equal(h.attr('api-json').props.value, previous); external(h, conflict); h.update({ active: true }); await h.settle(); assert.ok(h.attr('stale')); assert.equal(h.attr('api-json').props.value, previous); assert.equal(h.s.writes().length, 0); } finally { h.unmount(); }
});

test('safe status/error codes translate live and all 21 catalogs have exact profile keys and consistency notices', async () => {
  assert.equal(FINGERPRINT_UI_KEYS.length, 44); assert.equal(Object.keys(FINGERPRINT_UI_MESSAGES).length, 21); for (const language of PRODUCTION_LANGUAGES) { const table = messages(language.id); for (const key of FINGERPRINT_UI_KEYS) assert.ok(table[key]?.message.trim(), language.id + '/' + key); assert.equal(table.antidetect_category_profiles.message, table.fingerprint_title.message); assert.match(table.fingerprint_scope.message, /API/); assert.match(table.fingerprint_scope.message, /TLS/); }
  const h = harness(); try { h.render(); await h.settle(); await click(h, 'generate'); h.s.value.intercept = request => request.type === 'ui-api-config-set' ? { schemaVersion: 1, type: 'api-config-error', code: 'storage-error', message: 'private-backend-detail' } : undefined; await click(h, 'apply'); assert.equal(h.attr('error').props.children, h.table.antidetect_failed.message); const count = h.s.calls.length; h.setLocale('ar'); await h.settle(); assert.equal(h.attr('error').props.children, h.table.antidetect_failed.message); assert.equal(h.s.calls.length, count); assert.doesNotMatch(h.attr('error').props.children, /private-backend/); } finally { h.unmount(); }
});

test('all 158 API choices render localized labels or canonical technical names across every locale, never translation keys', async () => {
  const h = harness(); try {
    h.render(); await h.settle();
    for (const language of PRODUCTION_LANGUAGES) {
      h.setLocale(language.id); await h.settle(); const options = h.attr('api').props.children; assert.equal(options.length, 158);
      for (let index = 0; index < options.length; index++) {
        const entry = API_CONFIG_CATALOG[index], key = 'protection_feature_' + entry.id.replaceAll('-', '_'), text = options[index].props.children;
        assert.doesNotMatch(text, /protection_feature_/, language.id + '/' + entry.id);
        if (!h.table[key]?.message) { assert.match(entry.name, /^(Navigator\.|Screen\.|ScreenOrientation\.|Window\.|Intl\.|WebAssembly|CSS\.|WebGLRenderingContext\.|GPUAdapter\.|CanvasRenderingContext2D\.|AudioBuffer\.|AudioContext\.|Performance\.)/, 'only technical API names bypass human translation'); assert.equal(text, entry.name + ' · ' + entry.id); }
        else assert.equal(text, h.table[key].message + ' · ' + entry.id);
      }
    }
    assert.equal(h.s.writes().length, 0);
  } finally { h.unmount(); }
});

test('all fifteen catalog7 bundles stage through the JSON editor and commit once without enabling either master', async () => {
  const h = harness();try {
    h.render();await h.settle();
    for (const entry of API_CONFIG_CATALOG.slice(143)) {
      select(h, 'api', entry.id);await h.settle();
      assert.equal(h.attr('api-mode').props.children.some(option => option.props.value === 'on'), false, entry.id);
      select(h, 'api-mode', 'custom');select(h, 'value-kind', 'value');await h.settle();
      input(h, 'api-json', JSON.stringify(entry.presets[0].value.value));await h.settle();await click(h, 'stage-api');
      assert.equal(h.attr('error'), undefined, entry.id);assert.equal(h.s.writes().length, 0);
    }
    await click(h, 'apply');assert.equal(h.s.writes().length, 1);
    for (const entry of API_CONFIG_CATALOG.slice(143)) {
      assert.equal(api(h.s.value.configuration, entry.id).mode, 'custom');
      assert.deepEqual(api(h.s.value.configuration, entry.id).selected, entry.presets[0].value);
    }
    assert.equal(h.s.value.configuration.enabled, false);assert.equal(h.s.value.configuration.antidetectEnabled, false);
  } finally { h.unmount(); }
});

test('library rows show an empty state, device facts, derived status pills, inline rename and immediate delete with Undo', async () => {
  const h = harness(), words = FINGERPRINT_LIBRARY_LABELS.en, text = node => { const parts = []; (function visit(item) { if (Array.isArray(item)) item.forEach(visit); else if (typeof item === 'string' || typeof item === 'number') parts.push(String(item)); else if (item?.props) visit(item.props.children); })(node); return parts.join(' '); };
  try {
    h.render(); await h.settle();
    assert.equal(h.attr('library').props.hidden, true); assert.match(text(h.nodes(node => node.props.class === 'fingerprint-empty')[0]), new RegExp(words.emptyTitle));
    choose(h, 'os', 'windows-10'); select(h, 'language', 'de-DE'); select(h, 'screen', '1920x1080'); await h.settle(); await click(h, 'generate');
    input(h, 'name', 'Linux desk'); await h.settle(); await click(h, 'save-named'); const first = h.s.value.configuration.fingerprintProfiles[0].id;
    assert.equal(h.attr('library').props.hidden, false); assert.equal(h.nodes(node => node.props.class === 'fingerprint-empty').length, 0);
    const meta = text(descend(row(h, first), node => node.props.class === 'fingerprint-row__meta'));
    // ADR-107: facts the profile claims (Windows version, browser, screen, language/region) instead of navigator.platform.
    for (const part of ['Windows 10', '1920 × 1080', 'de-DE']) assert.ok(meta.includes(part), meta); assert.ok(!meta.includes('Win32'), meta);
    assert.equal(descend(row(h, first), node => node.props['data-profile-status']).props.children, words.inPreview, 'a saved snapshot of the pending preview is marked as previewed, not applied');
    await click(h, 'apply'); assert.equal(descend(row(h, first), node => node.props['data-profile-status']).props['data-profile-status'], 'applied');
    choose(h, 'browser', 'edge'); await h.settle(); await click(h, 'generate'); input(h, 'name', 'Windows desk'); await h.settle(); await click(h, 'save-named');
    // Stored profiles are ordered by random ID; rows follow the stored order.
    const second = h.s.value.configuration.fingerprintProfiles.find(profile => profile.label === 'Windows desk').id; assert.deepEqual(rowLabels(h), h.s.value.configuration.fingerprintProfiles.map(profile => profile.label)); assert.deepEqual([...rowLabels(h)].sort(), ['Linux desk', 'Windows desk']);
    assert.equal(descend(row(h, first), node => node.props['data-profile-status']).props['data-profile-status'], 'applied'); assert.equal(descend(row(h, second), node => node.props['data-profile-status']).props['data-profile-status'], 'preview');
    pick(h, first); await h.settle(); assert.equal(h.attr('name').props.value, '', 'opening a row never fills the Save-as name'); assert.equal(within(row(h, first), 'pick').props['aria-expanded'], true);
    assert.equal(h.nodes(node => node.props['data-profile-peek'] === first).length, 1, 'the row opens its read-only Peek');
    await act(h, second, 'rename'); assert.equal(h.attr('rename-input').props.value, 'Windows desk', 'inline rename has its own text'); assert.equal(h.attr('name').props.value, '');
    assert.equal(descend(row(h, first), node => node.props['data-profile-rename-input']), undefined); await click(h, 'rename-cancel');
    const writes = h.s.writes().length; await act(h, second, 'delete'); assert.equal(h.s.writes().length, writes + 1, 'Delete commits at once'); assert.deepEqual(rowLabels(h), ['Linux desk']); assert.ok(h.attr('undo-button'));
    input(h, 'search', 'missing'); await h.settle(); assert.equal(h.attr('library').props.hidden, true); assert.match(text(h.nodes(node => String(node.props.class).includes('fingerprint-empty'))[0]), new RegExp(h.table.fingerprint_no_profiles.message.replace('.', '\.')));
  } finally { h.unmount(); }
});

test('segmented device-type choice is a radio group with one tab stop and Home/End/arrow navigation', async () => {
  const h = harness(); try {
    h.render(); await h.settle(); const keys = key => ({ key, preventDefault() {}, currentTarget: { parentElement: null } });
    const options = () => h.attr('device-type').props.children, selected = () => options().find(option => option.props['aria-checked'] === true).props['data-profile-option'];
    assert.equal(h.attr('device-type').props.role, 'radiogroup'); assert.equal(selected(), 'desktop'); assert.deepEqual(options().map(option => option.props.tabIndex), [-1, 0]);
    options()[1].props.onKeyDown(keys('ArrowRight')); await h.settle(); assert.equal(selected(), 'laptop'); assert.equal(options()[0].props.tabIndex, 0);
    options()[0].props.onKeyDown(keys('End')); await h.settle(); assert.equal(selected(), 'desktop');
    options()[1].props.onKeyDown(keys('Home')); await h.settle(); assert.equal(selected(), 'laptop');
    options()[0].props.onKeyDown(keys('ArrowUp')); await h.settle(); assert.equal(selected(), 'desktop');
    assert.equal(h.attr('language').type, 'select'); assert.equal(h.s.writes().length, 0);
  } finally { h.unmount(); }
});

test('library labels cover exactly the 21 product languages and resolve locale variants', async () => {
  assert.deepEqual(Object.keys(FINGERPRINT_LIBRARY_LABELS).sort(), PRODUCTION_LANGUAGES.map(language => language.id).sort());
  for (const [locale, table] of Object.entries(FINGERPRINT_LIBRARY_LABELS)) { assert.deepEqual(Object.keys(table), [...FINGERPRINT_LIBRARY_KEYS], locale); for (const key of FINGERPRINT_LIBRARY_KEYS) assert.ok(table[key].trim(), locale + '/' + key); }
  assert.equal(fingerprintLibraryLabels('pt-BR'), FINGERPRINT_LIBRARY_LABELS.pt_BR); assert.equal(fingerprintLibraryLabels({ id: 'zh_CN' }), FINGERPRINT_LIBRARY_LABELS.zh_CN); assert.equal(fingerprintLibraryLabels('de-AT'), FINGERPRINT_LIBRARY_LABELS.de); assert.equal(fingerprintLibraryLabels('xx'), FINGERPRINT_LIBRARY_LABELS.en);
  const h = harness({ locale: 'ar' }); try { h.render(); await h.settle(); assert.ok(h.nodes(node => node.props.children === FINGERPRINT_LIBRARY_LABELS.ar.emptyTitle).length); h.setLocale('ja'); await h.settle(); assert.ok(h.nodes(node => node.props.children === FINGERPRINT_LIBRARY_LABELS.ja.emptyTitle).length); } finally { h.unmount(); }
});

// ADR-104: the device/quick-setup labels must cover every product language with the full key set.
test('device labels cover exactly the 21 product languages with the complete honest key set', () => {
  assert.deepEqual(Object.keys(FINGERPRINT_DEVICE_LABELS).sort(), PRODUCTION_LANGUAGES.map(language => language.id).sort());
  for (const [locale, table] of Object.entries(FINGERPRINT_DEVICE_LABELS)) { assert.deepEqual(Object.keys(table), [...FINGERPRINT_DEVICE_KEYS], locale); for (const key of FINGERPRINT_DEVICE_KEYS) assert.ok(table[key].trim(), locale + '/' + key); }
  for (const key of ['disclose_ip', 'disclose_tls', 'disclose_engine', 'preset_balanced', 'randomize_button', 'device_laptop', 'value_auto']) assert.ok(FINGERPRINT_DEVICE_KEYS.includes(key), key);
  assert.equal(fingerprintDeviceLabels('pt-BR'), FINGERPRINT_DEVICE_LABELS.pt_BR); assert.equal(fingerprintDeviceLabels('de-AT'), FINGERPRINT_DEVICE_LABELS.de); assert.equal(fingerprintDeviceLabels('xx'), FINGERPRINT_DEVICE_LABELS.en);
  assert.notEqual(FINGERPRINT_DEVICE_LABELS.ja.disclose_tls, FINGERPRINT_DEVICE_LABELS.en.disclose_tls);
});

// --- ADR-104 level views: the same retained panel renders Device, OS and Browser controls ---------------
import { CPU_STEPS, RAM_STEPS, DISK_STEPS, SCREEN_PRESETS, GPU_PRESETS, gpusFor } from '../../apps/production-extension/fingerprint-device-presets.js';
const flat = node => { const parts = []; (function visit(item) { if (Array.isArray(item)) item.forEach(visit); else if (typeof item === 'string' || typeof item === 'number') parts.push(String(item)); else if (item?.props) visit(item.props.children); })(node); return parts.join(' '); };
const sliderValue = (h, key) => flat(h.nodes(node => node.props['data-profile-slider-value'] === key)[0]);
const slide = (h, key, index) => h.attr('slider-' + key).props.onInput({ currentTarget: { value: String(index) } });

test('level views replace the generator and library with their own controls', async () => {
  for (const view of ['device', 'os', 'browser']) {
    const h = harness({ props: { view } });
    try {
      h.render(); await h.settle();
      assert.ok(h.nodes(node => node.props['data-profile-level'] === view).length, view + ' level card');
      for (const absent of ['generate', 'library', 'search', 'save-named', 'presets']) assert.equal(h.attr(absent), undefined, view + ' has no ' + absent);
      assert.ok(h.attr('apply') && h.attr('cancel') && h.attr('refresh'), view + ' keeps its own Apply, Cancel and Refresh');
      assert.equal(h.attr('apply').props['aria-disabled'], true, 'nothing staged yet');
    } finally { h.unmount(); }
  }
});

test('Device level: stepped sliders stage fixed values, never write and Apply commits one CAS', async () => {
  const h = harness({ props: { view: 'device' } });
  try {
    h.render(); await h.settle();
    const before = clone(h.s.value.configuration);
    for (const [key, steps] of [['cpu', CPU_STEPS], ['ram', RAM_STEPS], ['disk', DISK_STEPS]]) {
      const input = h.attr('slider-' + key).props;
      assert.deepEqual([input.type, input.min, input.max, input.step], ['range', 0, steps.length - 1, 1], key + ' has fixed positions only');
      assert.ok(sliderValue(h, key).startsWith(fingerprintDeviceLabels('en').value_browser), key + ' starts as not overridden: ' + sliderValue(h, key));
    }
    // ADR-107: Chrome reports one quota shape on any disk, so with a Chromium identity the disk slider is locked and stages nothing.
    assert.equal(h.attr('slider-disk').props.disabled, true); assert.equal(h.attr('slider-disk').props['data-locked'], true);
    slide(h, 'cpu', CPU_STEPS.indexOf(12)); slide(h, 'ram', RAM_STEPS.indexOf(32)); slide(h, 'disk', DISK_STEPS.indexOf(2048)); await h.settle();
    assert.equal(sliderValue(h, 'cpu'), '12'); assert.equal(sliderValue(h, 'ram'), '32 GB'); assert.ok(sliderValue(h, 'disk').startsWith(fingerprintDeviceLabels('en').value_browser), 'the quota stays native');
    assert.match(flat(h.nodes(node => node.props.id === 'fp-slider-ram-hint')[0]), /navigator\.deviceMemory = 32/u, 'sites are told the reported bucket of the claimed Chrome major');
    assert.match(flat(h.nodes(node => node.props.id === 'fp-slider-cpu-hint')[0]), /hardwareConcurrency = 12/u);
    assert.deepEqual(h.s.value.configuration, before); assert.equal(h.s.writes().length, 0); assert.equal(h.attr('apply').props['aria-disabled'], false);
    await click(h, 'apply');
    assert.equal(h.s.writes().length, 1); assert.equal(h.s.writes()[0].expectedRevision, 7); assert.equal(h.s.value.configuration.enabled, false);
    assert.equal(api(h.s.value.configuration, 'hardware-concurrency').selected.value, 12);
    assert.equal(api(h.s.value.configuration, 'device-memory').selected.value, 32, 'Chrome 147+ reports the 32 GB bucket itself');
    assert.equal(api(h.s.value.configuration, 'storage-estimate').mode, 'bypass', 'no quota is written for a Chromium identity');
    assert.equal(h.applied.length, 1); assert.equal(h.attr('apply').props['aria-disabled'], true);
  } finally { h.unmount(); }
  // Another engine (here a Firefox without a Chromium claim) keeps the Disk control: the quota share is written.
  const fox = harness({ props: { view: 'device' }, nav: realNavigator({ clientHints: false, agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0' }) });
  try {
    fox.render(); await fox.settle();
    assert.equal(fox.attr('slider-disk').props.disabled, false, 'the disk slider is usable for another engine');
    slide(fox, 'disk', DISK_STEPS.indexOf(2048)); await fox.settle(); assert.equal(sliderValue(fox, 'disk'), '2 TB');
    await click(fox, 'apply'); assert.equal(api(fox.s.value.configuration, 'storage-estimate').mode, 'custom');
  } finally { fox.unmount(); }
});

test('Device level: the screen slider, GPU select and the Auto action keep dependent values together', async () => {
  const h = harness({ props: { view: 'device' } });
  try {
    h.render(); await h.settle();
    select(h, 'level-gpu', 'nvidia-rtx-3060'); await h.settle();
    const laptops = SCREEN_PRESETS.filter(entry => entry.types.includes('desktop'));
    slide(h, 'screen', laptops.findIndex(entry => entry.id === '2560x1440')); await h.settle();
    assert.equal(sliderValue(h, 'screen'), '2560 × 1440');
    await click(h, 'apply');
    const config = h.s.value.configuration;
    assert.match(api(config, 'webgl').selected.value.unmaskedRenderer, /RTX 3060/u); assert.ok(api(config, 'webgl-capabilities').mode === 'custom', 'capabilities follow the GPU');
    assert.equal(api(config, 'screen-width').selected.value, 2560); assert.equal(api(config, 'window-device-pixel-ratio').selected.value, 1);
    slide(h, 'cpu', CPU_STEPS.indexOf(8)); await h.settle(); assert.equal(sliderValue(h, 'cpu'), '8');
    h.nodes(node => node.props['data-profile-slider-reset'] === 'cpu')[0].props.onClick(); await h.settle();
    assert.ok(sliderValue(h, 'cpu').startsWith(fingerprintDeviceLabels('en').value_browser), 'Auto returns the row to the browser value');
    await click(h, 'apply'); assert.equal(api(h.s.value.configuration, 'hardware-concurrency').mode, 'bypass');
    assert.equal(api(h.s.value.configuration, 'screen-width').mode, 'custom', 'other controls are untouched');
  } finally { h.unmount(); }
});

test('Device level: a value between steps is shown as stored, never rounded away', async () => {
  const s = server(); s.value.configuration = updateApiConfiguration(s.value.configuration, 'hardware-concurrency', { mode: 'custom', selected: { kind: 'value', value: 3 } }).value;
  const h = harness({ s, props: { view: 'device' } });
  try {
    h.render(); await h.settle();
    assert.equal(sliderValue(h, 'cpu'), '3', 'the bubble reports the stored value');
    assert.equal(h.attr('slider-cpu').props.value, 0, 'the thumb rests on the nearest fixed step');
    assert.equal(h.s.writes().length, 0);
  } finally { h.unmount(); }
});

test('OS level: version, language, searchable time zone and the font baseline stage together', async () => {
  const h = harness({ props: { view: 'os' } });
  try {
    h.render(); await h.settle();
    choose(h, 'level-os', 'windows-10'); select(h, 'level-language', 'de-DE'); choose(h, 'fonts', 'windows'); await h.settle();
    h.attr('timezone-input').props.onFocus(); await h.settle();
    h.attr('timezone-input').props.onInput({ currentTarget: { value: 'berlin' } }); await h.settle();
    const options = h.nodes(node => node.props['data-profile-timezone-option']);
    assert.deepEqual(options.map(node => node.props['data-profile-timezone-option']), ['Europe/Berlin'], 'search narrows the list');
    h.attr('timezone-input').props.onKeyDown({ key: 'Enter', preventDefault() {} }); await h.settle();
    assert.equal(h.s.writes().length, 0);
    await click(h, 'apply');
    const config = h.s.value.configuration;
    assert.equal(api(config, 'client-hints').selected.value.platformVersion, '10.0.0');
    assert.deepEqual(api(config, 'navigator-languages').selected.value, ['de-DE', 'de', 'en-US', 'en'], 'the generator writes the Chrome form of the list');
    assert.equal(api(config, 'timezone').selected.value.timeZone, 'Europe/Berlin');
    assert.ok(api(config, 'canvas-font-policy').selected.value.families.includes('Segoe UI'));
    assert.ok(h.nodes(node => node.props['data-profile-coverage']).length, 'the uncovered font metrics are stated, not hidden');
    h.nodes(node => node.props['data-profile-timezone-reset'])[0].props.onClick(); await h.settle(); await click(h, 'apply');
    assert.equal(api(h.s.value.configuration, 'timezone').mode, 'bypass');
  } finally { h.unmount(); }
});

test('OS level: arrow keys move through the matching zones and Escape closes the list', async () => {
  const h = harness({ props: { view: 'os' } });
  try {
    h.render(); await h.settle();
    const input = () => h.attr('timezone-input').props, key = async name => { input().onKeyDown({ key: name, preventDefault() {} }); await h.settle(); };
    input().onFocus(); await h.settle(); input().onInput({ currentTarget: { value: 'york' } }); await h.settle();
    assert.equal(input()['aria-expanded'], true); assert.equal(input().role, 'combobox');
    await key('ArrowDown'); assert.match(input()['aria-activedescendant'], /^fp-timezone-list-\d+$/u);
    await key('Escape'); assert.equal(input()['aria-expanded'], false);
  } finally { h.unmount(); }
});

test('Browser level: family, version, User-Agent and the render switches stay consistent with the GPU', async () => {
  const h = harness({ props: { view: 'browser' } });
  try {
    h.render(); await h.settle();
    choose(h, 'level-browser', 'edge'); select(h, 'level-version', '141'); choose(h, 'protect-canvas', 'on'); choose(h, 'protect-webgl', 'on'); choose(h, 'protect-audio', 'on'); await h.settle();
    assert.match(flat(h.attr('ua')), /Edg\/141\.0\.0\.0$/u);
    assert.equal(h.attr('protect-canvas').props.children.find(option => option.props['aria-checked']).props['data-profile-option'], 'on');
    const coverage = h.nodes(node => node.props['data-profile-coverage']).map(node => flat(node));
    assert.ok(coverage.some(text => /Client Rects/u.test(text)), 'Client Rects is honestly shown as not covered');
    assert.ok(coverage.some(text => /WebGPU/u.test(text)), 'WebGPU and Workers are honestly shown as not covered');
    await click(h, 'apply');
    const config = h.s.value.configuration;
    assert.match(api(config, 'navigator-user-agent').selected.value, /Edg\/141/u); assert.equal(api(config, 'canvas-readback').mode, 'custom');
    assert.equal(api(config, 'webgl-readback').mode, 'custom'); assert.match(api(config, 'audio-fingerprint').selected.value.seed, /^[a-f0-9]{32}$/u);
    choose(h, 'protect-canvas', 'off'); await h.settle(); await click(h, 'apply'); assert.equal(api(h.s.value.configuration, 'canvas-readback').mode, 'bypass');
  } finally { h.unmount(); }
});

test('level labels are localized in every product language and never show raw keys', async () => {
  for (const language of PRODUCTION_LANGUAGES) {
    const words = FINGERPRINT_DEVICE_LABELS[language.id];
    for (const [view, key] of [['device', 'level_device_title'], ['os', 'level_os_title'], ['browser', 'level_browser_title']]) {
      const h = harness({ locale: language.id, props: { view } });
      try { h.render(); await h.settle(); const all = flat(h.nodes(node => node.props['data-profile-level'] === view)[0]); assert.ok(all.includes(words[key]), language.id + '/' + view); assert.doesNotMatch(all, /\b(?:fingerprint|antidetect)_[a-z_]+\b/u, language.id + '/' + view + ' shows a raw key'); }
      finally { h.unmount(); }
    }
  }
});

// --- ADR-104: the Laptop/Desktop toggle owns the device type ----------------------------------------------
import { applyDevicePatch } from '../../apps/production-extension/fingerprint-profiles.js';
const selectedType = h => h.attr('device-type').props.children.find(option => option.props['aria-checked']).props['data-profile-option'];
// GPU selects are grouped by vendor: an Auto option followed by optgroups.
const gpuNodes = (h, attribute) => h.attr(attribute).props.children;
const gpuValues = (h, attribute) => gpuNodes(h, attribute).flatMap(node => node.type === 'optgroup' ? node.props.children : [node]).map(option => option.props.value);

test('Device level: the Laptop/Desktop toggle is not overridden by the current GPU and keeps it selectable', async () => {
  const h = harness({ props: { view: 'device' } });
  try {
    h.render(); await h.settle();
    select(h, 'level-gpu', 'nvidia-rtx-3060'); await h.settle();
    assert.equal(selectedType(h), 'desktop');
    choose(h, 'device-type', 'laptop'); await h.settle();
    assert.equal(selectedType(h), 'laptop', 'a desktop GPU does not pin the toggle');
    const options = gpuValues(h, 'level-gpu');
    assert.ok(options.includes('nvidia-rtx-3060'), 'the current GPU stays in the list');
    assert.ok(options.includes('intel-iris-xe'), 'laptop GPUs are offered');
    assert.equal(h.attr('level-gpu').props.value, 'nvidia-rtx-3060');
    assert.equal(h.s.writes().length, 0);
  } finally { h.unmount(); }
});

test('Device level: a loaded laptop configuration seeds the toggle once, then the user decides', async () => {
  const s = server(); s.value.configuration = applyDevicePatch(s.value.configuration, { gpu: 'intel-uhd-620', screen: '1366x768' }).configuration;
  const h = harness({ s, props: { view: 'device' } });
  try {
    h.render(); await h.settle();
    assert.equal(selectedType(h), 'laptop', 'the loaded integrated GPU implies a laptop');
    assert.equal(sliderValue(h, 'screen'), '1366 × 768');
    choose(h, 'device-type', 'desktop'); await h.settle();
    assert.equal(selectedType(h), 'desktop');
    assert.equal(sliderValue(h, 'screen'), '1366 × 768', 'the current screen stays visible after the type changes');
  } finally { h.unmount(); }
});

test('GPU selects list every card of the device type, grouped by vendor, in both the quick form and the Device level', async () => {
  for (const [view, attribute] of [['quick', 'gpu'], ['device', 'level-gpu']]) {
    const h = harness({ props: { view } });
    try {
      h.render(); await h.settle();
      const nodes = gpuNodes(h, attribute);
      assert.equal(nodes[0].type, 'option'); assert.equal(nodes[0].props.value, '', view + ': Auto stays first');
      const groups = nodes.slice(1); assert.ok(groups.length && groups.every(node => node.type === 'optgroup'), view + ': vendor groups');
      assert.deepEqual(groups.map(node => node.props.label), ['NVIDIA', 'AMD', 'Intel']);
      const listed = gpuValues(h, attribute).filter(Boolean), expected = gpusFor('desktop').map(entry => entry.id);
      assert.deepEqual([...listed].sort(), [...expected].sort(), view + ': every desktop card is offered exactly once');
      assert.ok(listed.length >= 25, view + ': a real choice, not five presets');
      for (const group of groups) assert.ok(group.props.children.every(option => option.props.children === GPU_PRESETS.find(entry => entry.id === option.props.value).label), 'option text is the card label');
    } finally { h.unmount(); }
  }
});

test('another surface saving only the master flag is merged into the preview: Apply stays usable and keeps both edits', async () => {
  const h = harness();
  try {
    h.render(); await h.settle(); await click(h, 'generate');
    external(h, next => { next.antidetectEnabled = true; }); await h.settle();
    assert.equal(h.attr('stale'), undefined, 'a master switch must not lock the editor');
    assert.equal(h.attr('apply').props['aria-disabled'], false);
    await click(h, 'apply');
    assert.equal(h.s.writes().length, 1); assert.equal(h.s.writes()[0].expectedRevision, 8);
    const saved = h.s.value.configuration;
    assert.equal(saved.antidetectEnabled, true, 'the master flag saved elsewhere survives Apply');
    assert.equal(api(saved, 'hardware-concurrency').mode, 'custom', 'the previewed rows are applied');
  } finally { h.unmount(); }
});

test('a bare revision bump or a master-only save on a clean editor refreshes silently', async () => {
  const h = harness();
  try {
    h.render(); await h.settle();
    external(h, next => { next.antidetectEnabled = true; }); await h.settle();
    assert.equal(h.attr('stale'), undefined);
    await click(h, 'generate'); assert.equal(h.attr('apply').props['aria-disabled'], false);
    await click(h, 'apply'); assert.equal(h.s.writes()[0].expectedRevision, 8); assert.equal(h.s.value.configuration.antidetectEnabled, true);
  } finally { h.unmount(); }
});

test('a real conflict keeps the draft locked and the action bar offers one click to discard it and refresh', async () => {
  const h = harness();
  try {
    h.render(); await h.settle(); await click(h, 'generate');
    external(h, conflict); await h.settle();
    const bar = h.nodes(node => node.props['data-profile-bar'] === 'stale')[0]; assert.ok(bar, 'stale bar');
    assert.equal(h.nodes(node => node.props['data-profile-bar-apply'] === true).length, 0, 'no Apply while the draft conflicts');
    await click(h, 'bar-discard');
    assert.equal(h.attr('stale'), undefined); assert.equal(h.nodes(node => node.props['data-profile-bar']).length, 0);
    assert.equal(api(h.s.value.configuration, 'hardware-concurrency').selected.value, 3, 'the newer settings win after discarding');
    assert.equal(h.s.writes().length, 0);
  } finally { h.unmount(); }
});

test('Apply and Cancel are reachable in a floating action bar and Apply is duplicated next to Randomize', async () => {
  const h = harness();
  try {
    h.render(); await h.settle();
    assert.equal(h.nodes(node => node.props['data-profile-bar']).length, 0, 'no bar without pending changes');
    assert.equal(h.attr('apply-inline'), undefined);
    await click(h, 'generate');
    const bar = h.nodes(node => node.props['data-profile-bar'])[0]; assert.equal(bar.props['data-profile-bar'], 'dirty');
    assert.ok(bar.props.class.includes('fp-actionbar')); assert.equal(bar.props.role, 'region');
    assert.equal(h.attr('bar-apply').props.children, fingerprintDeviceLabels('en').bar_apply);
    assert.ok(h.attr('apply-inline'), 'Apply next to Randomize'); assert.equal(h.attr('apply-inline').props['aria-disabled'], false);
    const toolbar = h.nodes(node => node.props.class === 'fingerprint-toolbar fingerprint-generator__actions')[0];
    const names = toolbar.props.children.filter(Boolean).map(node => Object.keys(node.props).find(key => key.startsWith('data-profile-')));
    assert.deepEqual(names, ['data-profile-generate', 'data-profile-apply-inline'], 'inline Apply sits right after Randomize');
    await click(h, 'bar-cancel'); assert.equal(h.nodes(node => node.props['data-profile-bar']).length, 0); assert.equal(h.s.writes().length, 0);
    await click(h, 'generate'); await click(h, 'bar-apply');
    assert.equal(h.s.writes().length, 1); assert.equal(h.nodes(node => node.props['data-profile-bar']).length, 0, 'the bar closes after Apply');
    await click(h, 'generate'); await click(h, 'apply-inline'); assert.equal(h.s.writes().length, 2);
  } finally { h.unmount(); }
});

test('without Chrome user-script access Apply explains the exact fix instead of a generic failure, and recovers by itself', async () => {
  const s = server(); s.value.earlyAccess = 'browser-toggle-required';
  s.value.intercept = request => request.type === 'ui-api-config-set' && s.value.earlyAccess !== 'ready' ? { schemaVersion: 1, type: 'api-config-error', code: 'early-access-required', message: 'Enable the browser early Custom API before activating this configuration.' } : undefined;
  const h = harness({ s });
  try {
    h.render(); await h.settle(); await click(h, 'generate');
    external(h, next => { next.antidetectEnabled = true; }); await h.settle();
    // ADR-107: the refusal is named before the click (aria-disabled plus the reason); the click itself writes nothing.
    const words = fingerprintDeviceLabels('en');
    assert.equal(h.attr('apply').props['aria-disabled'], true); assert.equal(h.attr('apply-reason').props.children, words.reason_scripts);
    assert.equal(h.attr('apply').props['aria-describedby'], 'fp-apply-reason');
    const writes = h.s.writes().length; await click(h, 'apply'); assert.equal(h.s.writes().length, writes, 'no write while user scripts are not allowed');
    const bar = h.nodes(node => node.props['data-profile-bar'] === 'early')[0]; assert.ok(bar, 'guidance bar');
    assert.equal(h.s.value.configuration.apis.some(row => row.mode === 'custom'), false, 'nothing was saved');
    assert.equal(h.attr('bar-apply').props['aria-disabled'], true, 'the bar Apply says the same');
    await click(h, 'bar-settings'); assert.deepEqual(s.value.opened, [{ url: 'chrome://extensions/?id=profile-fixture' }]);
    s.value.earlyAccess = 'ready'; await click(h, 'bar-recheck');
    assert.equal(h.nodes(node => node.props['data-profile-bar'] === 'early').length, 0, 'guidance disappears once access is ready');
    assert.equal(h.attr('error'), undefined, 'no error was raised'); assert.equal(h.attr('bar-apply').props['aria-disabled'], false);
    await click(h, 'bar-apply'); assert.equal(h.s.writes().length, writes + 1); assert.equal(api(h.s.value.configuration, 'hardware-concurrency').mode, 'custom');
  } finally { h.unmount(); }
  // The worker still decides: access lost between the load and the click gets its own message, not a generic failure.
  const race = server(); race.value.configuration.antidetectEnabled = true; let refused = false;
  race.value.intercept = request => request.type === 'ui-api-config-set' && !refused ? (refused = true, { schemaVersion: 1, type: 'api-config-error', code: 'early-access-required', message: 'Enable the browser early Custom API before activating this configuration.' }) : undefined;
  const r = harness({ s: race });
  try {
    r.render(); await r.settle(); await click(r, 'generate'); assert.equal(r.attr('apply').props['aria-disabled'], false);
    await click(r, 'apply');
    assert.equal(r.attr('error').props.children, r.table.antidetect_early_required.message, 'the SW code has its own message');
    assert.notEqual(r.attr('error').props.children, r.table.antidetect_failed.message);
    assert.equal(r.s.value.configuration.apis.some(row => row.mode === 'custom'), false, 'nothing was saved');
  } finally { r.unmount(); }
});

test('the action-bar and guidance labels exist in all 21 languages', () => {
  const keys = ['bar_label', 'bar_pending', 'bar_hint', 'bar_apply', 'bar_cancel', 'early_blocked_title', 'early_blocked_steps', 'early_recheck', 'stale_discard', 'status_needs_scripts'];
  assert.equal(Object.keys(FINGERPRINT_DEVICE_LABELS).length, 21);
  for (const [language, labels] of Object.entries(FINGERPRINT_DEVICE_LABELS)) for (const key of keys) assert.ok(FINGERPRINT_DEVICE_KEYS.includes(key) && labels[key]?.trim(), language + '/' + key);
  assert.notEqual(fingerprintDeviceLabels('ru').bar_apply, fingerprintDeviceLabels('en').bar_apply);
});

test('an edit staged while the newer revision is still loading is kept, merged and applied (the editor is never blocked by the merge)', async () => {
  const h = harness(); let release;
  try {
    h.render(); await h.settle(); await click(h, 'generate');
    h.s.value.intercept = request => request.type === 'ui-api-config-get' ? new Promise(resolve => { release = () => resolve(h.s.snapshot()); }) : undefined;
    external(h, next => { next.antidetectEnabled = true; }); await h.settle();
    assert.ok(release, 'the newer revision is loading'); assert.equal(h.attr('api-mode').props.disabled, false, 'controls stay enabled during the merge');
    select(h, 'api-mode', 'custom'); select(h, 'value-kind', 'value'); await h.settle(); input(h, 'api-json', '24'); await h.settle(); await click(h, 'stage-api');
    h.s.value.intercept = undefined; release(); await h.settle();
    assert.equal(h.attr('stale'), undefined); assert.equal(h.attr('apply').props['aria-disabled'], false);
    await click(h, 'apply');
    const written = h.s.writes().at(-1).configuration;
    assert.equal(api(written, 'hardware-concurrency').selected.value, 24, 'the edit made during the merge is applied'); assert.equal(written.antidetectEnabled, true, 'and so is the neighbour\'s master flag');
  } finally { h.unmount(); }
});

test('the device card says honestly when Antidetect is off and offers the switch', async () => {
  let enabled = 0, h = harness({ props: { antidetectOn: false, onEnable: () => { enabled++; } } });
  try {
    h.render(); await h.settle();
    assert.ok(h.attr('master-off'), 'the card warns that the values are not reported'); assert.equal(h.attr('master-off').props.role, 'status');
    await h.attr('master-enable').props.onClick(); assert.equal(enabled, 1);
  } finally { h.unmount(); }
  h = harness({ props: { antidetectOn: true } });
  try { h.render(); await h.settle(); assert.equal(h.attr('master-off'), undefined, 'no warning while the master is on'); } finally { h.unmount(); }
});

test('Block rows that cannot act (API Guard off) are called out instead of letting Strict look active', async () => {
  const s = server(); const configuration = clone(s.value.configuration); for (const id of ['battery', 'usb']) configuration.apis.find(row => row.id === id).mode = 'on'; s.value.configuration = configuration;
  let h = harness({ s });
  try {
    h.render(); await h.settle();
    const note = h.nodes(node => node.props['data-profile-parked-blocks'])[0]; assert.ok(note); assert.equal(note.props['data-profile-parked-blocks'], 2);
    assert.match(flat(note), new RegExp(fingerprintDeviceLabels('en').blocks_parked.slice(0, 20)));
  } finally { h.unmount(); }
  configuration.enabled = true; s.value.configuration = configuration; h = harness({ s });
  try { h.render(); await h.settle(); assert.equal(h.nodes(node => node.props['data-profile-parked-blocks']).length, 0, 'with API Guard on the blocks act'); } finally { h.unmount(); }
});

test('a missing network-policy permission has its own message, not "Permission was not granted"', async () => {
  const s = server(); s.value.intercept = request => request.type === 'ui-api-config-set' ? { schemaVersion: 1, type: 'api-config-error', code: 'privacy-permission-required' } : undefined;
  const h = harness({ s });
  try {
    h.render(); await h.settle(); await click(h, 'generate'); await click(h, 'apply');
    assert.equal(h.attr('error').props.children, fingerprintDeviceLabels('en').privacy_required);
  } finally { h.unmount(); }
});

test('the quick form is seeded once from the loaded configuration so reopening the tab does not flip the identity', async () => {
  const s = server(); s.value.configuration = generateConsistentDevice(s.value.configuration, { os: 'windows-10', browser: 'edge', version: 148, language: 'de-DE', deviceType: 'laptop', seed: 5 }).configuration;
  const h = harness({ s });
  try {
    h.render(); await h.settle();
    const picked = key => h.attr(key).props.children.find(option => option.props['aria-checked']).props['data-profile-option'];
    assert.equal(picked('os'), 'windows-10'); assert.equal(picked('browser'), 'edge'); assert.equal(picked('device-type'), 'laptop');
    assert.equal(h.attr('version').props.value, '148'); assert.equal(h.attr('language').props.value, 'de-DE');
    // The user then decides: choosing another value is kept (no re-seeding after Randomize/Apply).
    choose(h, 'os', 'windows-11'); await h.settle(); await click(h, 'generate'); await click(h, 'apply');
    assert.equal(picked('os'), 'windows-11');
  } finally { h.unmount(); }
});

// --- U1-U3: defaults, hints and strings that follow this real browser ---------------------------------------
import { FINGERPRINT_ISSUE_CODES } from '../../apps/production-extension/fingerprint-profiles.js';
import { issueMessage, environmentDefaults } from '../../apps/production-extension/fingerprint-profile-ui.js';
import { browserVersions } from '../../apps/production-extension/fingerprint-device-presets.js';

const OLD_ISSUE_CODES = ['platform-agent', 'client-hints-agent', 'language-list', 'screen-available', 'screen-depth', 'orientation-size', 'gpu-pair', 'memory-bucket', 'timezone-metadata', 'network-ua', 'network-language', 'screen-css', 'worker-scope'];
const NEW_ISSUE_CODES = ['dpr-step', 'window-bounds', 'window-chrome', 'media-geometry', 'touch-range', 'touch-media', 'screen-shape', 'color-depth', 'gpu-os', 'gpu-shape', 'webgpu-gpu', 'host-os', 'engine-version', 'cores-above-real', 'screen-vs-real', 'webrtc-shape', 'geolocation-timezone-mismatch'];
const issueKey = code => 'issue_' + code.replaceAll('-', '_');
const pickedOption = (h, key) => h.attr(key).props.children.find(option => option.props['aria-checked']).props['data-profile-option'];
const hintNodes = (h, name = 'engine-version') => h.nodes(node => node.props['data-profile-hint'] === name);
const issueNode = (h, code) => h.nodes(node => node.props['data-profile-issue'] === code)[0];
// A fake real browser: `brand` chrome|edge, `major`, the Windows platformVersion the client hints report, core count and the OS name of the hints.
function realNavigator({ brand = 'chrome', major = 156, platformVersion = '19.0.0', hardwareConcurrency = 16, platform = 'Windows', clientHints = true, agent = null } = {}) {
  const edge = brand === 'edge', ua = agent ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + major + '.0.0.0 Safari/537.36' + (edge ? ' Edg/' + major + '.0.0.0' : ''), name = edge ? 'Microsoft Edge' : 'Google Chrome';
  const list = [{ brand: 'Not:A-Brand', version: '8.0.0.0' }, { brand: 'Chromium', version: major + '.0.8078.80' }, { brand: name, version: major + (edge ? '.0.4314.58' : '.0.8078.80') }];
  return { userAgent: ua, appVersion: ua.replace('Mozilla/', ''), platform: 'Win32', vendor: 'Google Inc.', language: 'en-US', languages: ['en-US', 'en'], hardwareConcurrency,
    ...(clientHints ? { userAgentData: { brands: [{ brand: 'Not:A-Brand', version: '8' }, { brand: 'Chromium', version: String(major) }, { brand: name, version: String(major) }], mobile: false, platform, getHighEntropyValues: async () => ({ platformVersion, uaFullVersion: list[2].version, fullVersionList: list }) } } : {}), _list: list };
}

test('environmentDefaults: brand, nearest listed major and Windows 10 or 11 follow the real browser; unusable facts keep the static defaults', () => {
  const list = browserVersions(), newest = list[0], oldest = list.at(-1);
  const cases = [
    [undefined, { os: 'windows-11' }], [null, { os: 'windows-11' }], [{}, { os: 'windows-11' }], ['text', { os: 'windows-11' }],
    [{ brand: 'chrome', uaMajor: newest, platformVersion: '19.0.0' }, { os: 'windows-11', browser: 'chrome', version: newest }],
    [{ brand: 'edge', uaMajor: 148, platformVersion: '10.0.0' }, { os: 'windows-10', browser: 'edge', version: 148 }],
    [{ platformVersion: '13.0.0' }, { os: 'windows-11' }], [{ platformVersion: '15.0.0' }, { os: 'windows-11' }], [{ platformVersion: '14.0.0' }, { os: 'windows-11' }],
    [{ platformVersion: '10.0.0' }, { os: 'windows-10' }], [{ platformVersion: '10.1.2' }, { os: 'windows-10' }], [{ platformVersion: '0.3.0' }, { os: 'windows-11' }], [{ platformVersion: '' }, { os: 'windows-11' }],
    // Only Chrome's x.y.z shape counts (the generator reads the same shape); anything else keeps the Windows 11 default.
    [{ platformVersion: '10' }, { os: 'windows-11' }], [{ platformVersion: '10.0' }, { os: 'windows-11' }], [{ platformVersion: '10.0.0.0' }, { os: 'windows-11' }], [{ platformVersion: 10 }, { os: 'windows-11' }], [{ platformVersion: '10.0.0; DROP' }, { os: 'windows-11' }],
    [{ uaMajor: newest + 1 }, { os: 'windows-11', version: newest }], [{ uaMajor: 100000 }, { os: 'windows-11', version: newest }], [{ uaMajor: oldest - 1 }, { os: 'windows-11', version: oldest }], [{ uaMajor: 1 }, { os: 'windows-11', version: oldest }],
    [{ uaMajor: oldest }, { os: 'windows-11', version: oldest }],
    [{ brand: 'firefox', uaMajor: '156' }, { os: 'windows-11' }], [{ uaMajor: 0 }, { os: 'windows-11' }], [{ uaMajor: -3 }, { os: 'windows-11' }], [{ uaMajor: 150.5 }, { os: 'windows-11' }], [{ uaMajor: NaN }, { os: 'windows-11' }]];
  for (const [environment, expected] of cases) assert.deepEqual(environmentDefaults(environment), expected, JSON.stringify(environment));
  // Only own data properties count: an accessor is never run.
  const hostile = {}; for (const key of ['brand', 'uaMajor', 'platformVersion']) Object.defineProperty(hostile, key, { enumerable: true, get() { throw Error('accessor ran'); } });
  assert.deepEqual(environmentDefaults(hostile), { os: 'windows-11' });
});

test('the quick form starts from this browser: Edge 148 on Windows 10 without any saved profile, and nothing is written', async () => {
  const h = harness({ nav: realNavigator({ brand: 'edge', major: 148, platformVersion: '10.0.0' }) });
  try {
    h.render(); await h.settle();
    assert.equal(pickedOption(h, 'os'), 'windows-10'); assert.equal(pickedOption(h, 'browser'), 'edge'); assert.equal(h.attr('version').props.value, '148');
    assert.equal(hintNodes(h).length, 0, 'the chosen version is the real one: no hint');
    assert.equal(h.s.writes().length, 0); assert.equal(h.attr('apply').props['aria-disabled'], true);
  } finally { h.unmount(); }
  const g = harness({ nav: realNavigator({ brand: 'chrome', major: 150, platformVersion: '19.0.0' }) });
  try { g.render(); await g.settle(); assert.equal(pickedOption(g, 'os'), 'windows-11'); assert.equal(pickedOption(g, 'browser'), 'chrome'); assert.equal(g.attr('version').props.value, '150'); } finally { g.unmount(); }
});

test('Windows 11 builds map to Windows 11 and unknown platform versions keep the Windows 11 default', async () => {
  for (const [platformVersion, expected] of [['13.0.0', 'windows-11'], ['15.0.0', 'windows-11'], ['19.0.0', 'windows-11'], ['10.0.0', 'windows-10'], ['0.3.0', 'windows-11']]) {
    const h = harness({ nav: realNavigator({ platformVersion }) });
    try { h.render(); await h.settle(); assert.equal(pickedOption(h, 'os'), expected, platformVersion); } finally { h.unmount(); }
  }
});

test('a real major outside the list picks the nearest entry and the engine hint names the difference; no client hints still use the user-agent string', async () => {
  const words = fingerprintDeviceLabels('en');
  for (const [major, expected] of [[160, '156'], [120, '136'], [136, '136'], [156, '156']]) {
    const h = harness({ nav: realNavigator({ major }) });
    try {
      h.render(); await h.settle();
      assert.equal(h.attr('version').props.value, expected, String(major));
      const hint = hintNodes(h); assert.equal(hint.length, String(major) === expected ? 0 : 1, 'hint for ' + major);
      if (hint.length) assert.equal(hint[0].props.children, words.issue_engine_version);
    } finally { h.unmount(); }
  }
  // Chromium without userAgentData: the version comes from the UA string, the OS and brand fall back to the defaults.
  const h = harness({ nav: realNavigator({ major: 141, clientHints: false }) });
  try { h.render(); await h.settle(); assert.equal(h.attr('version').props.value, '141'); assert.equal(pickedOption(h, 'browser'), 'chrome'); assert.equal(pickedOption(h, 'os'), 'windows-11'); } finally { h.unmount(); }
  // Not Chromium at all: the static defaults stay and no hint is shown.
  const f = harness({ nav: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0', appVersion: '5.0 (Windows)', platform: 'Win32', vendor: '', language: 'en-US', languages: ['en-US'], oscpu: 'Windows NT 10.0; Win64; x64', hardwareConcurrency: 8 } });
  try { f.render(); await f.settle(); assert.equal(f.attr('version').props.value, String(browserVersions()[0])); assert.equal(pickedOption(f, 'browser'), 'chrome'); assert.equal(pickedOption(f, 'os'), 'windows-11'); assert.equal(hintNodes(f).length, 0); } finally { f.unmount(); }
});

test('the engine hint follows the picked version in the quick form and is absent when it equals the real one', async () => {
  const h = harness({ nav: realNavigator({ major: 150 }) });
  try {
    h.render(); await h.settle(); assert.equal(hintNodes(h).length, 0);
    select(h, 'version', '156'); await h.settle(); assert.equal(hintNodes(h).length, 1); assert.equal(hintNodes(h)[0].props.children, fingerprintDeviceLabels('en').issue_engine_version);
    select(h, 'version', '150'); await h.settle(); assert.equal(hintNodes(h).length, 0);
    h.setLocale('ru'); select(h, 'version', '149'); await h.settle(); assert.equal(hintNodes(h)[0].props.children, fingerprintDeviceLabels('ru').issue_engine_version);
  } finally { h.unmount(); }
});

test('a saved profile beats the real browser per field; the environment only fills what the profile leaves open, and seeds once', async () => {
  const s = server(); s.value.configuration = generateConsistentDevice(s.value.configuration, { os: 'windows-10', browser: 'edge', version: 148, language: 'de-DE', deviceType: 'laptop', seed: 5 }).configuration;
  const h = harness({ s, nav: realNavigator({ brand: 'chrome', major: 156, platformVersion: '19.0.0' }) });
  try {
    h.render(); await h.settle();
    assert.equal(pickedOption(h, 'os'), 'windows-10'); assert.equal(pickedOption(h, 'browser'), 'edge'); assert.equal(h.attr('version').props.value, '148');
    // The saved edge/148 differs from the real chrome/156, so the hint is visible; the profile still decides the controls.
    assert.equal(hintNodes(h).length, 1);
  } finally { h.unmount(); }
  // A saved profile without any identity row leaves os, brand and version to the real browser.
  const t = server(); t.value.configuration = updateApiConfiguration(t.value.configuration, 'hardware-concurrency', { mode: 'custom', selected: { kind: 'value', value: 12 } }).value;
  const g = harness({ s: t, nav: realNavigator({ brand: 'edge', major: 150, platformVersion: '10.0.0' }) });
  try {
    g.render(); await g.settle();
    assert.equal(pickedOption(g, 'os'), 'windows-10'); assert.equal(pickedOption(g, 'browser'), 'edge'); assert.equal(g.attr('version').props.value, '150');
    // Seeded once: the user's choice survives a refresh of the same view.
    choose(g, 'browser', 'chrome'); select(g, 'version', '152'); await g.settle(); await click(g, 'refresh');
    assert.equal(pickedOption(g, 'browser'), 'chrome'); assert.equal(g.attr('version').props.value, '152');
  } finally { g.unmount(); }
});

test('Randomize and the level controls hand the real-browser snapshot to the generator: a claim equal to this browser reuses its real client-hint versions', async () => {
  const nav = realNavigator({ major: 156, platformVersion: '19.0.0' }), real = nav._list;
  const h = harness({ nav });
  try {
    h.render(); await h.settle(); await click(h, 'generate'); await click(h, 'apply');
    let hints = api(h.s.value.configuration, 'client-hints').selected.value;
    assert.equal(hints.uaFullVersion, real[2].version); assert.equal(hints.platformVersion, '19.0.0'); assert.deepEqual(hints.fullVersionList, real);
    // A different claimed version is a different engine: it keeps the generic build numbers.
    select(h, 'version', '150'); await h.settle(); await click(h, 'generate'); await click(h, 'apply');
    hints = api(h.s.value.configuration, 'client-hints').selected.value; assert.equal(hints.uaFullVersion, '150.0.0.0');
  } finally { h.unmount(); }
  const navigator = realNavigator({ major: 156 }), g = harness({ nav: navigator, props: { view: 'browser' } });
  try {
    g.render(); await g.settle(); select(g, 'level-version', '156'); await g.settle(); await click(g, 'bar-apply');
    const hints = api(g.s.value.configuration, 'client-hints').selected.value; assert.equal(hints.uaFullVersion, navigator._list[2].version, 'the Browser level patch carries the snapshot too');
  } finally { g.unmount(); }
});

test('hints from the real browser render with the device-label text: more cores than this computer, another host OS and another engine version', async () => {
  const words = fingerprintDeviceLabels('en');
  const h = harness({ nav: realNavigator({ hardwareConcurrency: 8 }), props: { view: 'device' } });
  try {
    h.render(); await h.settle(); slide(h, 'cpu', CPU_STEPS.indexOf(32)); await h.settle();
    const issue = issueNode(h, 'cores-above-real'); assert.ok(issue, 'a claim above the real core count is flagged');
    assert.equal(issueText(issue), words.issue_cores_above_real); assert.equal(h.s.writes().length, 0);
    h.setLocale('de'); await h.settle(); assert.equal(issueText(issueNode(h, 'cores-above-real')), FINGERPRINT_DEVICE_LABELS.de.issue_cores_above_real, 'the text follows the live locale');
    slide(h, 'cpu', CPU_STEPS.indexOf(8)); await h.settle(); assert.equal(issueNode(h, 'cores-above-real'), undefined, 'at or below the real count is quiet');
  } finally { h.unmount(); }
  const mac = harness({ nav: realNavigator({ platform: 'macOS' }) });
  try {
    mac.render(); await mac.settle(); await click(mac, 'generate');
    const issue = issueNode(mac, 'host-os'); assert.ok(issue, 'a Windows claim on a Mac is flagged'); assert.equal(issueText(issue), words.issue_host_os); assert.equal(issue.props['data-severity'], 'info');
  } finally { mac.unmount(); }
  const engine = harness({ nav: realNavigator({ major: 150 }) });
  try {
    engine.render(); await engine.settle(); select(engine, 'version', '156'); await engine.settle(); await click(engine, 'generate');
    const issue = issueNode(engine, 'engine-version'); assert.ok(issue, 'a claimed version other than the real one is flagged after generation');
    assert.equal(issueText(issue), words.issue_engine_version); assert.equal(hintNodes(engine).length, 1);
  } finally { engine.unmount(); }
});

test('every issue code has a message in all 21 languages: the original thirteen from the locale catalog, the new ones from the device labels', () => {
  for (const code of [...OLD_ISSUE_CODES, ...NEW_ISSUE_CODES]) assert.ok(FINGERPRINT_ISSUE_CODES.includes(code), 'the generator exports ' + code);
  assert.ok(Object.isFrozen(FINGERPRINT_ISSUE_CODES));
  for (const language of PRODUCTION_LANGUAGES) {
    const table = messages(language.id), words = FINGERPRINT_DEVICE_LABELS[language.id], translate = key => table[key]?.message ?? key;
    for (const code of FINGERPRINT_ISSUE_CODES) {
      const text = issueMessage(code, words, translate), key = issueKey(code);
      assert.ok(typeof text === 'string' && text.trim().length > 8, language.id + '/' + code);
      assert.doesNotMatch(text, /^(?:fingerprint_)?issue_/u, language.id + '/' + code + ' shows a raw key');
      if (OLD_ISSUE_CODES.includes(code)) { assert.equal(Object.hasOwn(words, key), false, language.id + '/' + code + ' keeps its catalog string'); assert.equal(text, table['fingerprint_' + key].message, language.id + '/' + code); }
      else { assert.ok(FINGERPRINT_DEVICE_KEYS.includes(key), key + ' is a device-label key'); assert.equal(text, words[key], language.id + '/' + code); }
    }
  }
  // The renderer lookup falls back to the catalog only when the device labels have no entry.
  assert.equal(issueMessage('platform-agent', { issue_platform_agent: 'override' }, key => key), 'override');
  assert.equal(issueMessage('platform-agent', {}, key => 'catalog:' + key), 'catalog:fingerprint_issue_platform_agent');
});

test('the new and rewritten device strings are translated, not English leftovers, in every non-English language', () => {
  const changed = [...NEW_ISSUE_CODES.map(issueKey), 'uncovered_webgpu', 'gpu_hint', 'timezone_hint'];
  const script = { ru: /\p{Script=Cyrillic}/u, uk: /\p{Script=Cyrillic}/u, zh_CN: /\p{Script=Han}/u, yue: /\p{Script=Han}/u, wuu: /\p{Script=Han}/u, ja: /[\p{Script=Hiragana}\p{Script=Katakana}]/u, ko: /\p{Script=Hangul}/u, hi: /\p{Script=Devanagari}/u, mr: /\p{Script=Devanagari}/u, ar: /\p{Script=Arabic}/u, ur: /\p{Script=Arabic}/u, te: /\p{Script=Telugu}/u, ta: /\p{Script=Tamil}/u };
  const english = /\b(?:the|and|is|are|not|with|should|does|differs|than|from|pick|your)\b/iu;
  const en = FINGERPRINT_DEVICE_LABELS.en;
  for (const key of changed) assert.ok(en[key].trim().length > 20, 'en/' + key);
  for (const [language, table] of Object.entries(FINGERPRINT_DEVICE_LABELS)) {
    if (language === 'en') continue;
    for (const key of changed) {
      assert.notEqual(table[key], en[key], language + '/' + key + ' equals the English text');
      if (script[language]) assert.match(table[key], script[language], language + '/' + key + ' has no native-script text');
      else assert.doesNotMatch(table[key], english, language + '/' + key + ' contains English words');
    }
  }
  // The honesty rules for the new hints: no promise of invisibility and no verdict wording in English.
  for (const key of NEW_ISSUE_CODES.map(issueKey)) assert.doesNotMatch(en[key], /invisible|undetectable|undetected|safe|legitimate|fake|spoof|bypass/iu, key);
});

test('the rewritten hints describe what the controls really do: WebGPU follows the card, Auto keeps the real GPU, the OS time zone stays in Date', () => {
  const en = FINGERPRINT_DEVICE_LABELS.en;
  assert.match(en.uncovered_webgpu, /WebGPU adapter vendor and architecture follow the selected card/u); assert.match(en.uncovered_webgpu, /features, limits and Workers still show your real GPU/u);
  assert.match(en.gpu_hint, /WebGL/u); assert.match(en.gpu_hint, /WebGPU/u); assert.match(en.gpu_hint, /real GPU/u);
  assert.match(en.timezone_hint, /Date#toString/u); assert.match(en.timezone_hint, /OS time zone/u);
  for (const [language, table] of Object.entries(FINGERPRINT_DEVICE_LABELS)) {
    assert.ok(table.gpu_hint.includes('WebGPU'), language + ' gpu_hint names WebGPU'); assert.ok(table.timezone_hint.includes('Date#toString'), language + ' timezone_hint names Date#toString');
    // ADR-107: the first GPU option is «This graphics card (real)»; the hint names it by that exact label, never a bare «Auto».
    assert.ok(table.gpu_hint.includes(table.gpu_real_option), language + ' gpu_hint names the real-card option by its own label');
  }
});

test('the WebGPU row is labelled Partial while Client Rects stays Not covered, and issue rows carry their severity', async () => {
  const words = fingerprintDeviceLabels('en');
  const rows = h => h.nodes(node => node.props['data-profile-coverage']).map(node => flat(node));
  for (const view of ['device', 'browser']) {
    const h = harness({ props: { view } });
    try {
      h.render(); await h.settle(); const coverage = rows(h);
      assert.ok(coverage.some(text => text.startsWith(words.coverage_partial) && text.includes(words.uncovered_webgpu)), view + ': WebGPU is partially covered');
      if (view === 'browser') assert.ok(coverage.some(text => text.startsWith(words.coverage_uncovered) && text.includes(words.uncovered_clientrects)), 'Client Rects stays uncovered');
    } finally { h.unmount(); }
  }
  // timezone-metadata is informational, screen-available is a warning; the generator's level reaches the markup.
  let configuration = updateApiConfiguration(createApiConfiguration(), 'timezone', { mode: 'custom', selected: { kind: 'value', value: { timeZone: 'UTC', offsetMinutes: 0 } } }).value;
  for (const [id, value] of [['screen-width', 1366], ['screen-avail-width', 1920]]) configuration = updateApiConfiguration(configuration, id, { mode: 'custom', selected: { kind: 'value', value } }).value;
  const s = server(); s.value.configuration = configuration; const h = harness({ s });
  try {
    h.render(); await h.settle();
    assert.equal(issueNode(h, 'timezone-metadata').props['data-severity'], 'info'); assert.equal(issueNode(h, 'screen-available').props['data-severity'], 'warning');
    assert.equal(issueText(issueNode(h, 'screen-available')), h.table.fingerprint_issue_screen_available.message, 'the original codes still use the locale catalog');
  } finally { h.unmount(); }
});

// ADR-110: the Fonts option now also shields HTML/CSS probing for a built-in list of names; the copy says so and keeps the gaps in a Partial row.
test('the Fonts option in the OS view shows its hint and a Partial coverage row naming what is not covered', async () => {
  for (const locale of ['en', 'ru']) {
    const words = fingerprintDeviceLabels(locale), h = harness({ locale, props: { view: 'os' } });
    try {
      h.render(); await h.settle();
      const rows = h.nodes(node => node.props['data-profile-coverage']).map(node => flat(node)), notes = h.nodes(node => node.props.class === 'fingerprint-note').map(node => flat(node));
      assert.ok(rows.some(text => text.startsWith(words.coverage_partial) && text.includes(words.uncovered_fonts_metrics)), locale + ': Partial row with the uncovered fonts text');
      assert.ok(!rows.some(text => text.startsWith(words.coverage_uncovered) && text.includes(words.uncovered_fonts_metrics)), locale + ': no longer a plain Not covered row');
      assert.ok(notes.includes(words.fonts_hint), locale + ': the hint under the Fonts control');
    } finally { h.unmount(); }
  }
});


// --- ADR-104 addendum 4: Region picker, the «Region and coordinates» card line, the Strict description, the new hint ---------
import { regionCodes, regionByCode, regionDefaults } from '../../apps/production-extension/fingerprint-region-data.js';
import { regionPicker } from '../../apps/production-extension/fingerprint-region-names.js';
import { DEVICE_ICON_PATHS } from '../../apps/production-extension/fingerprint-device-icons.js';

const regionProps = h => h.attr('region-input').props;
const regionRows = h => h.nodes(node => node.props['data-profile-region-option']);
const regionKey = async (h, key) => { regionProps(h).onKeyDown({ key, preventDefault() {} }); await h.settle(); };
const typeRegion = async (h, text) => { regionProps(h).onFocus(); await h.settle(); regionProps(h).onInput({ currentTarget: { value: text } }); await h.settle(); };
const pickRegion = async (h, code) => { regionRows(h).find(node => node.props['data-profile-region-option'] === code).props.onMouseDown({ preventDefault() {} }); await h.settle(); };
const savedWith = build => { const s = server(); s.value.configuration = build(createApiConfiguration()); return s; };
const patched = patch => configuration => applyDevicePatch(configuration, patch, {}).configuration;
const placed = (configuration, latitude, longitude) => updateApiConfiguration(configuration, 'geolocation', { mode: 'custom', selected: { kind: 'value', value: { latitude, longitude, accuracy: 25 } } }).value;
const squash = node => flat(node).replace(/\s+/gu, ' ').trim();
const twoDecimals = value => (Math.round(value * 100) / 100).toFixed(2);

test('Region: a labelled combobox right after the OS choice, before language and time zone, in the OS level only', async () => {
  const words = fingerprintDeviceLabels('en');
  const h = harness({ props: { view: 'os' } });
  try {
    h.render(); await h.settle();
    const input = regionProps(h);
    assert.equal(h.attr('region').props.class, 'fp-combobox', 'the same control as the time zone box');
    assert.equal(input.role, 'combobox'); assert.equal(input['aria-autocomplete'], 'list'); assert.equal(input['aria-controls'], 'fp-region-list'); assert.equal(input['aria-expanded'], false);
    assert.equal(input['aria-label'], words.region_label); assert.ok(input.placeholder.startsWith(words.value_browser), 'the empty box names the browser value: ' + input.placeholder); assert.equal(input.value, ''); assert.equal(input['aria-activedescendant'], undefined); assert.equal(input.disabled, false);
    const form = h.nodes(node => node.props.class === 'fingerprint-form' && node.props.children.some(row => row && descend(row, child => child.props['data-profile-region'] === true)))[0];
    // Empty hint slots (null) keep their positions for stable reconciliation; the order is read without them.
    const rows = form.props.children.filter(Boolean), at = key => rows.findIndex(row => descend(row, child => child.props['data-profile-' + key] === true));
    assert.ok(at('level-os') >= 0 && at('region') === at('level-os') + 1, 'Region follows the OS choice');
    assert.ok(at('region') < at('level-language') && at('level-language') < at('timezone'), 'Region comes before the language and the time zone it fills in');
    const caption = descend(rows[at('region')], child => child.props.class === 'fingerprint-form-label');
    assert.equal(flat(descend(caption, child => child.props.class === 'fp-label__text')), words.region_label);
    assert.equal(descend(caption, child => child.props['data-profile-source'] === 'region').props['data-source'], 'real', 'nothing chosen: the real value');
    assert.equal(flat(h.attr('region-hint')), words.region_hint); assert.equal(h.attr('region-reset'), undefined, 'nothing to reset yet');
  } finally { h.unmount(); }
  for (const view of ['device', 'browser', 'quick']) {
    const other = harness({ props: { view } });
    try { other.render(); await other.settle(); assert.equal(other.attr('region'), undefined, view); assert.equal(other.attr('region-input'), undefined, view); }
    finally { other.unmount(); }
  }
});

test('Region list: every region named in the UI language, the code and the English name on the second line, in the language\'s order', async () => {
  for (const [locale, name, second] of [['en', 'Germany', 'DE'], ['ru', 'Германия', 'DE · Germany'], ['ar', 'ألمانيا', 'DE · Germany'], ['zh_CN', '德国', 'DE · Germany']]) {
    const words = fingerprintDeviceLabels(locale), h = harness({ locale, props: { view: 'os' } });
    try {
      h.render(); await h.settle(); regionProps(h).onFocus(); await h.settle();
      const rows = regionRows(h), list = h.nodes(node => node.props.role === 'listbox' && node.props.id === 'fp-region-list')[0];
      assert.equal(regionProps(h)['aria-expanded'], true); assert.equal(list.props['aria-label'], words.region_label);
      assert.deepEqual(rows.map(node => node.props['data-profile-region-option']), regionPicker(locale).list.map(entry => entry.code), locale + ': all regions in the language order');
      assert.equal(rows.length, regionCodes().length);
      const option = rows.find(node => node.props['data-profile-region-option'] === 'DE');
      assert.equal(option.props.role, 'option'); assert.equal(option.props.id, 'fp-region-list-' + rows.indexOf(option)); assert.equal(option.props.children[0].props.children, name, locale);
      assert.equal(option.props.children[1].props.dir, 'ltr', locale + ': the code line stays left-to-right'); assert.equal(option.props.children[1].props.children, second, locale);
    } finally { h.unmount(); }
  }
});

test('Region search finds a country by its localized name, its English name or its code; an empty result says so', async () => {
  const h = harness({ locale: 'ru', props: { view: 'os' } });
  try {
    h.render(); await h.settle();
    for (const [query, first] of [['герм', 'DE'], ['ГЕРМАНИЯ', 'DE'], ['Germany', 'DE'], ['de', 'DE'], ['япон', 'JP'], ['JP', 'JP'], ['брази', 'BR'], ['united', 'GB']]) {
      await typeRegion(h, query);
      const found = regionRows(h).map(node => node.props['data-profile-region-option']);
      assert.ok(found.length > 0 && (query === 'united' ? found.includes(first) : found[0] === first), query + ' -> ' + found.slice(0, 3));
    }
    await typeRegion(h, 'qqqqq');
    assert.equal(regionRows(h).length, 0); assert.equal(regionProps(h)['aria-expanded'], false, 'no list, no expanded state');
    // ADR-107: the status is permanent (a live region present before it speaks), only its text changes.
    const status = () => h.attr('region-status');
    assert.equal(status().props.role, 'status'); assert.equal(status().props['aria-live'], 'polite'); assert.equal(flat(status()), fingerprintDeviceLabels('ru').region_none);
    assert.ok(regionProps(h)['aria-describedby'].split(' ').includes(status().props.id), 'the input points at its status');
    await typeRegion(h, 'germ'); assert.ok(status(), 'still present'); assert.equal(flat(status()), '');
    await typeRegion(h, '   '); assert.equal(flat(status()), '', 'blank text is not a failed search'); assert.equal(regionRows(h).length, regionCodes().length);
  } finally { h.unmount(); }
  const english = harness({ props: { view: 'os' } });
  try { english.render(); await english.settle(); await typeRegion(english, 'cote'); assert.equal(regionRows(english)[0].props['data-profile-region-option'], 'CI', 'a missing accent still finds Côte d’Ivoire'); }
  finally { english.unmount(); }
});

test('Region keyboard: arrows move the highlighted option, Escape closes, Enter picks into the preview without writing', async () => {
  const h = harness({ props: { view: 'os' } });
  try {
    h.render(); await h.settle(); regionProps(h).onFocus(); await h.settle();
    const total = regionCodes().length, active = () => regionProps(h)['aria-activedescendant'];
    assert.equal(regionProps(h)['aria-expanded'], true); assert.equal(active(), undefined, 'focus alone highlights nothing');
    await regionKey(h, 'ArrowDown'); assert.equal(active(), 'fp-region-list-0');
    await regionKey(h, 'ArrowDown'); assert.equal(active(), 'fp-region-list-1');
    await regionKey(h, 'ArrowUp'); assert.equal(active(), 'fp-region-list-0');
    await regionKey(h, 'ArrowUp'); assert.equal(active(), 'fp-region-list-' + (total - 1), 'the list wraps');
    await regionKey(h, 'ArrowDown'); assert.equal(active(), 'fp-region-list-0', 'and wraps back');
    assert.ok(regionRows(h)[0].props.class.includes('is-highlighted')); assert.ok(!regionRows(h)[1].props.class.includes('is-highlighted'));
    // Escape closes an open list and keeps the browser from clearing the search text in the same keystroke; on a closed list it is left to the browser.
    const prevented = []; regionProps(h).onKeyDown({ key: 'Escape', preventDefault: () => prevented.push('open') }); await h.settle();
    assert.equal(regionProps(h)['aria-expanded'], false); assert.equal(active(), undefined); assert.deepEqual(prevented, ['open']);
    regionProps(h).onKeyDown({ key: 'Escape', preventDefault: () => prevented.push('closed') }); await h.settle(); assert.deepEqual(prevented, ['open'], 'a second Escape on the closed list is not intercepted');
    await regionKey(h, 'ArrowDown'); assert.equal(regionProps(h)['aria-expanded'], true, 'an arrow key reopens the list');
    regionProps(h).onFocus(); await h.settle(); await regionKey(h, 'ArrowUp'); assert.equal(active(), 'fp-region-list-' + (total - 1), 'Up from nothing starts at the end');
    await regionKey(h, 'Enter'); assert.equal(regionProps(h)['aria-expanded'], false, 'Enter picks the highlighted option');
    assert.equal(h.s.writes().length, 0, 'nothing is written by choosing');
    // Typing narrows to the first match; Enter takes it.
    await typeRegion(h, 'germany'); assert.equal(active(), 'fp-region-list-0'); await regionKey(h, 'Enter');
    assert.equal(regionProps(h)['aria-expanded'], false); assert.equal(regionProps(h).value, 'Germany');
    assert.equal(h.attr('notice').props.children, h.table.fingerprint_preview_ready.message);
    // Enter with no highlighted option does nothing.
    regionProps(h).onFocus(); await h.settle(); await regionKey(h, 'Enter'); assert.equal(regionProps(h)['aria-expanded'], true);
    assert.equal(h.s.writes().length, 0);
  } finally { h.unmount(); }
});

test('Picking a region stages one {region} patch (zone, languages and coordinates together); Apply writes exactly that once', async () => {
  const defaults = regionDefaults('DE');
  const h = harness({ props: { view: 'os' } });
  try {
    h.render(); await h.settle(); const before = clone(h.s.value.configuration);
    await typeRegion(h, 'germany'); await pickRegion(h, 'DE');
    assert.equal(h.s.writes().length, 0, 'staged only'); assert.deepEqual(h.s.value.configuration, before);
    assert.equal(regionProps(h).value, 'Germany'); assert.equal(regionProps(h)['aria-expanded'], false);
    assert.ok(h.attr('region-reset'), 'the Auto action appears once something is set');
    await click(h, 'apply');
    const config = h.s.value.configuration;
    assert.equal(h.s.writes().length, 1); assert.equal(h.s.writes()[0].expectedRevision, 7);
    assert.equal(api(config, 'timezone').selected.value.timeZone, defaults.timeZone);
    assert.equal(api(config, 'navigator-language').selected.value, defaults.locale);
    assert.deepEqual(api(config, 'navigator-languages').selected.value, defaults.languages);
    assert.deepEqual(api(config, 'geolocation').selected.value, { latitude: defaults.latitude, longitude: defaults.longitude, accuracy: defaults.accuracy });
    assert.equal(api(config, 'intl-formatting').selected.value.timeZone, defaults.timeZone); assert.equal(api(config, 'intl-formatting').selected.value.locale, defaults.locale);
    // The panel issued the model's own single {region: code} patch and nothing else.
    assert.deepEqual(config, validateApiConfiguration(applyDevicePatch(before, { region: 'DE' }, {}).configuration).value);
  } finally { h.unmount(); }
});

test('The Auto action next to Region stages {region: null}: zone, languages and coordinates return to the browser, other rows stay', async () => {
  const words = fingerprintDeviceLabels('en');
  const s = savedWith(configuration => patched({ region: 'JP' })(patched({ cores: 8 })(configuration)));
  const h = harness({ s, props: { view: 'os' } });
  try {
    h.render(); await h.settle();
    assert.equal(regionProps(h).value, 'Japan', 'the saved zone shows its region');
    const reset = h.attr('region-reset');
    assert.equal(reset.props.children, words.value_auto); assert.ok(reset.props['aria-label'].startsWith(words.value_auto), 'the accessible name contains the visible text'); assert.ok(reset.props['aria-label'].includes(words.region_label));
    const before = clone(h.s.value.configuration);
    await click(h, 'region-reset');
    assert.equal(h.s.writes().length, 0, 'staged only'); assert.deepEqual(h.s.value.configuration, before);
    assert.equal(regionProps(h).value, ''); assert.equal(h.attr('region-reset'), undefined, 'nothing left to reset');
    await click(h, 'apply');
    const config = h.s.value.configuration;
    for (const id of ['timezone', 'navigator-language', 'navigator-languages', 'geolocation']) { assert.equal(api(config, id).mode, 'bypass', id); assert.equal(api(config, id).selected.kind, 'unset', id); }
    assert.equal(api(config, 'hardware-concurrency').selected.value, 8, 'an unrelated row keeps its value');
    assert.equal(h.s.writes().length, 1);
    assert.deepEqual(config, validateApiConfiguration(applyDevicePatch(before, { region: null }, {}).configuration).value, 'exactly the model\'s {region: null} patch');
  } finally { h.unmount(); }
  // Coordinates alone are also cleared from here.
  const lone = harness({ s: savedWith(configuration => placed(configuration, 1.234, -5.678)), props: { view: 'os' } });
  try {
    lone.render(); await lone.settle(); assert.equal(regionProps(lone).value, ''); assert.ok(lone.attr('region-reset'), 'coordinates without a zone can still be cleared');
    await click(lone, 'region-reset'); await click(lone, 'apply'); assert.equal(api(lone.s.value.configuration, 'geolocation').mode, 'bypass');
  } finally { lone.unmount(); }
});

test('The shown region follows the staged zone unless the user picked one; a zone with no region leaves the box empty', async () => {
  const s = savedWith(patched({ timezone: { timeZone: 'Europe/Paris', offsetMinutes: -60 } }));
  const h = harness({ s, props: { view: 'os' } });
  try {
    h.render(); await h.settle();
    assert.equal(regionProps(h).value, 'France', 'derived from the saved zone'); assert.ok(h.attr('region-reset'));
    await typeRegion(h, 'germany'); await pickRegion(h, 'DE'); assert.equal(regionProps(h).value, 'Germany', 'an explicit pick');
    h.attr('timezone-input').props.onFocus(); await h.settle(); h.attr('timezone-input').props.onInput({ currentTarget: { value: 'tokyo' } }); await h.settle();
    h.attr('timezone-input').props.onKeyDown({ key: 'Enter', preventDefault() {} }); await h.settle();
    assert.equal(h.attr('timezone-input').props.value, 'Tokyo · Asia/Tokyo');
    assert.equal(regionProps(h).value, 'Japan', 'a later zone edit shows the zone\'s own region, not the old pick');
    await click(h, 'region-reset'); assert.equal(regionProps(h).value, '');
  } finally { h.unmount(); }
  const utc = harness({ s: savedWith(patched({ timezone: { timeZone: 'UTC', offsetMinutes: 0 } })), props: { view: 'os' } });
  try { utc.render(); await utc.settle(); assert.equal(regionProps(utc).value, '', 'no region lists UTC'); assert.equal(utc.attr('region-reset'), undefined); }
  finally { utc.unmount(); }
});

test('A region\'s own locale is selected in the language list once, under a readable name in the UI language', async () => {
  const h = harness({ props: { view: 'os' } });
  try {
    h.render(); await h.settle(); const optionsOf = () => h.attr('level-language').props.children.map(option => option.props.value);
    // The generator list now carries every region locale (G, ADR-107), so a picked region never needs an extra option.
    assert.ok(optionsOf().includes(regionDefaults('BR').locale));
    await typeRegion(h, 'brazil'); await pickRegion(h, 'BR');
    assert.equal(h.attr('level-language').props.value, regionDefaults('BR').locale); assert.equal(optionsOf().filter(value => value === regionDefaults('BR').locale).length, 1);
    const label = h.attr('level-language').props.children.find(option => option.props.value === regionDefaults('BR').locale).props.children;
    assert.equal(label, languageLabel(regionDefaults('BR').locale, 'en')); assert.match(label, / · pt-BR$/u); assert.notEqual(label, 'pt-BR', 'a name, with the tag beside it');
    const first = h.attr('level-language').props.children[0];
    assert.equal(first.props.value, 'preserve'); assert.ok(first.props.children.startsWith(fingerprintDeviceLabels('en').value_browser), 'the first option is the browser language');
    await typeRegion(h, 'germany'); await pickRegion(h, 'DE'); assert.equal(h.attr('level-language').props.value, 'de-DE');
  } finally { h.unmount(); }
  const ru = harness({ locale: 'ru', props: { view: 'os' } });
  try { ru.render(); await ru.settle(); assert.match(ru.attr('level-language').props.children.find(option => option.props.value === 'de-DE').props.children, /^немецкий/u, 'names follow the UI language'); }
  finally { ru.unmount(); }
});

test('Region in a right-to-left UI: Arabic and Urdu names and labels, codes stay left-to-right, the row is not forced to a direction', async () => {
  for (const locale of ['ar', 'ur']) {
    const words = fingerprintDeviceLabels(locale), h = harness({ locale, props: { view: 'os' } });
    try {
      h.render(); await h.settle();
      assert.equal(regionProps(h)['aria-label'], words.region_label, locale); assert.ok(regionProps(h).placeholder.startsWith(words.value_browser), locale); assert.equal(flat(h.attr('region-hint')), words.region_hint, locale);
      await typeRegion(h, regionPicker(locale).byCode.get('DE').name.slice(0, 3));
      const option = regionRows(h).find(node => node.props['data-profile-region-option'] === 'DE');
      assert.ok(option, locale + ': found by the localized name'); assert.equal(option.props.children[0].props.children, regionPicker(locale).byCode.get('DE').name);
      assert.equal(option.props.children[0].props.dir, undefined, 'the name follows the UI direction'); assert.equal(option.props.children[1].props.dir, 'ltr', 'the code and the English name do not');
      await pickRegion(h, 'DE'); assert.equal(regionProps(h).value, regionPicker(locale).byCode.get('DE').name, locale);
      assert.equal(h.attr('region-reset').props.children, words.value_auto);
      assert.equal(h.attr('region').props.dir, undefined);
    } finally { h.unmount(); }
  }
  // The shared combobox, the card rows and the headers list use logical properties only, so mirroring is automatic.
  const css = readFileSync(new URL('../../apps/production-extension/antidetect-ui.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].filter(([, selector]) => /fp-combobox|fp-device-card|antidetect-headers/u.test(selector));
  assert.ok(rules.length >= 12);
  for (const [, selector, body] of rules) assert.doesNotMatch(body, /(?:^|[\s;])(?:margin|padding|border)-(?:left|right)\s*:|text-align\s*:\s*(?:left|right)|(?:^|[\s;])(?:left|right)\s*:/u, selector.trim() + ' uses a physical side');
});

test('Device card: «Region and coordinates» shows country, city and two-decimal coordinates, or says it is not set', async () => {
  const line = h => h.nodes(node => node.props['data-profile-device-region'] !== undefined)[0];
  const words = fingerprintDeviceLabels('en');
  const first = harness();
  try {
    first.render(); await first.settle();
    assert.equal(squash(line(first)), words.region_card_unset); assert.equal(line(first).props['data-profile-device-region'], '');
    const row = first.nodes(node => node.props.class === 'fp-device-card__row' && squash(node).startsWith(words.region_card_label))[0];
    assert.ok(row, 'a card row named «Region and coordinates»'); assert.equal(row.props.children[1], line(first), 'the value is the line itself, not forced to left-to-right');
  } finally { first.unmount(); }
  const germany = regionDefaults('DE'), full = harness({ s: savedWith(patched({ region: 'DE' })) });
  try {
    full.render(); await full.settle();
    assert.equal(squash(line(full)), 'Germany · Berlin · ' + twoDecimals(germany.latitude) + ', ' + twoDecimals(germany.longitude)); assert.equal(line(full).props['data-profile-device-region'], 'DE');
    assert.doesNotMatch(squash(line(full)), /\d\.\d{3}/u, 'never more than two decimals');
  } finally { full.unmount(); }
  const russian = harness({ locale: 'ru', s: savedWith(patched({ region: 'JP' })) });
  try { russian.render(); await russian.settle(); assert.match(squash(line(russian)), /^Япония · Tokyo · \d+\.\d\d, \d+\.\d\d$/u); } finally { russian.unmount(); }
  // The zone alone names a city but no coordinates; coordinates alone name no country; coordinates elsewhere name no city.
  const zoneOnly = harness({ s: savedWith(patched({ timezone: { timeZone: 'Europe/Paris', offsetMinutes: -60 } })) });
  try { zoneOnly.render(); await zoneOnly.settle(); assert.equal(squash(line(zoneOnly)), 'France · Paris'); } finally { zoneOnly.unmount(); }
  const coordinatesOnly = harness({ s: savedWith(configuration => placed(configuration, 1.234, -5.678)) });
  try { coordinatesOnly.render(); await coordinatesOnly.settle(); assert.equal(squash(line(coordinatesOnly)), '1.23, -5.68'); assert.equal(line(coordinatesOnly).props['data-profile-device-region'], '-'); } finally { coordinatesOnly.unmount(); }
  const elsewhere = harness({ s: savedWith(configuration => placed(patched({ region: 'DE' })(configuration), 35.6895, 139.6917)) });
  try { elsewhere.render(); await elsewhere.settle(); assert.equal(squash(line(elsewhere)), 'Germany · 35.69, 139.69'); } finally { elsewhere.unmount(); }
  // Mixed scripts: only the city and the numbers are isolated left-to-right; the country follows the UI direction.
  const arabic = harness({ locale: 'ar', s: savedWith(patched({ region: 'DE' })) });
  try {
    arabic.render(); await arabic.settle(); const parts = line(arabic).props.children.filter(part => part?.type === 'bdi');
    assert.equal(parts.length, 3); assert.equal(parts[0].props.dir, undefined); assert.equal(parts[0].props.children, 'ألمانيا'); assert.equal(parts[1].props.dir, 'ltr'); assert.equal(parts[2].props.dir, 'ltr');
  } finally { arabic.unmount(); }
});

test('Device card: the not-set wording and the row name exist in all 21 languages and never show a raw key', async () => {
  for (const language of PRODUCTION_LANGUAGES) {
    const words = FINGERPRINT_DEVICE_LABELS[language.id], h = harness({ locale: language.id });
    try {
      h.render(); await h.settle(); const line = h.nodes(node => node.props['data-profile-device-region'] !== undefined)[0];
      assert.equal(squash(line), words.region_card_unset, language.id);
      assert.ok(h.nodes(node => node.props.class === 'fp-device-card__row' && squash(node).includes(words.region_card_label)).length === 1, language.id + ': one labelled row');
      assert.doesNotMatch(squash(h.nodes(node => node.props['data-profile-device-card'])[0]), /\b(?:region|headers)_[a-z_]+\b/u, language.id + ' shows a raw key');
    } finally { h.unmount(); }
  }
});

test('Strict: the description says neutral values instead of removed APIs, still names the blocked sensors, and exists in all 21 languages', async () => {
  const old = 'Maximum fingerprint leveling; some sites may break', en = FINGERPRINT_DEVICE_LABELS.en.preset_strict_desc;
  assert.notEqual(en, old);
  assert.match(en, /neutral values/u); assert.match(en, /sensors and motion stay blocked/u); assert.match(en, /may still break/u);
  assert.doesNotMatch(en, /(?:battery|network|memory|Bluetooth|USB|HID|Serial|gamepad|voice)[^;]*\b(?:blocked|removed|hidden|disabled)\b/iu, 'the neutral APIs are not described as removed');
  const english = /\b(?:the|and|is|are|not|with|should|does|differs|than|from|pick|your|may|stay|still|report)\b/iu;
  const script = { ru: /\p{Script=Cyrillic}/u, uk: /\p{Script=Cyrillic}/u, zh_CN: /\p{Script=Han}/u, yue: /\p{Script=Han}/u, wuu: /\p{Script=Han}/u, ja: /\p{Script=Hiragana}/u, ko: /\p{Script=Hangul}/u, hi: /\p{Script=Devanagari}/u, mr: /\p{Script=Devanagari}/u, ar: /\p{Script=Arabic}/u, ur: /\p{Script=Arabic}/u, te: /\p{Script=Telugu}/u, ta: /\p{Script=Tamil}/u };
  for (const language of PRODUCTION_LANGUAGES) {
    const text = FINGERPRINT_DEVICE_LABELS[language.id].preset_strict_desc;
    for (const name of ['Bluetooth', 'USB', 'HID', 'Serial']) assert.ok(text.includes(name), language.id + ' names ' + name);
    assert.ok(text.length > 80 && text.length < 420, language.id + ' stays one sentence-sized text (' + text.length + ')');
    if (language.id !== 'en') { assert.notEqual(text, en, language.id); if (script[language.id]) assert.match(text, script[language.id], language.id); else assert.doesNotMatch(text, english, language.id + ' has English words'); }
    const h = harness({ locale: language.id });
    try {
      h.render(); await h.settle(); const button = h.nodes(node => node.props['data-profile-preset'] === 'strict')[0];
      assert.equal(button.props.children[1].props.children, text, language.id + ': the card shows the new text'); assert.equal(button.props.children[0].props.children, FINGERPRINT_DEVICE_LABELS[language.id].preset_strict);
    } finally { h.unmount(); }
  }
});

test('geolocation-timezone-mismatch: the hint is shown with its own message in every language and is quiet for a matching place', async () => {
  assert.ok(FINGERPRINT_ISSUE_CODES.includes('geolocation-timezone-mismatch'));
  assert.ok(FINGERPRINT_DEVICE_KEYS.includes('issue_geolocation_timezone_mismatch'));
  const far = placed(patched({ region: 'DE' })(createApiConfiguration()), 35.6895, 139.6917);
  for (const language of PRODUCTION_LANGUAGES) {
    const h = harness({ locale: language.id, s: savedWith(() => far), props: { view: 'os' } });
    try {
      h.render(); await h.settle(); const issue = issueNode(h, 'geolocation-timezone-mismatch');
      assert.ok(issue, language.id + ': coordinates far from the zone are flagged');
      assert.equal(issueText(issue), FINGERPRINT_DEVICE_LABELS[language.id].issue_geolocation_timezone_mismatch, language.id);
      assert.match(issue.props['data-severity'], /^(?:warning|info)$/u); assert.ok(issueRowList(issue).includes('geolocation'), 'the rows involved are listed');
    } finally { h.unmount(); }
  }
  const near = harness({ s: savedWith(patched({ region: 'DE' })), props: { view: 'os' } });
  try { near.render(); await near.settle(); assert.equal(issueNode(near, 'geolocation-timezone-mismatch'), undefined); } finally { near.unmount(); }
  // Moving the place with the Region control removes the hint again, and the hint text promises nothing about being undetectable.
  const fix = harness({ s: savedWith(() => far), props: { view: 'os' } });
  try { fix.render(); await fix.settle(); await typeRegion(fix, 'japan'); await pickRegion(fix, 'JP'); assert.equal(issueNode(fix, 'geolocation-timezone-mismatch'), undefined); } finally { fix.unmount(); }
  assert.doesNotMatch(FINGERPRINT_DEVICE_LABELS.en.issue_geolocation_timezone_mismatch, /invisible|undetectable|undetected|safe|legitimate|fake|spoof|bypass/iu);
});

// The new round-3 strings: every one exists, is translated and cross-refers to the language's own words.
// German and Polish write «Region» exactly like English.
const COGNATES = new Set(['de/region_label', 'pl/region_label']);
const ROUND3_KEYS = ['issue_geolocation_timezone_mismatch', 'region_label', 'region_hint', 'region_none', 'region_card_label', 'region_card_unset', 'headers_label', 'headers_applied', 'headers_set', 'headers_removed', 'headers_inactive', 'headers_scope', 'headers_site_overrides', 'headers_engine', 'headers_invalid'];
test('round-3 labels: 15 new keys plus the rewritten Strict and header disclosures, complete and translated in all 21 languages', () => {
  for (const key of [...ROUND3_KEYS, 'preset_strict_desc', 'disclose_headers']) assert.ok(FINGERPRINT_DEVICE_KEYS.includes(key), key);
  assert.equal(new Set(FINGERPRINT_DEVICE_KEYS).size, FINGERPRINT_DEVICE_KEYS.length, 'no duplicate key');
  const english = /\b(?:the|and|is|are|not|with|should|does|differs|than|from|pick|your|may|stay|still|report|only|this|have)\b/iu;
  const script = { ru: /\p{Script=Cyrillic}/u, uk: /\p{Script=Cyrillic}/u, zh_CN: /\p{Script=Han}/u, yue: /\p{Script=Han}/u, wuu: /\p{Script=Han}/u, ja: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u, ko: /\p{Script=Hangul}/u, hi: /\p{Script=Devanagari}/u, mr: /\p{Script=Devanagari}/u, ar: /\p{Script=Arabic}/u, ur: /\p{Script=Arabic}/u, te: /\p{Script=Telugu}/u, ta: /\p{Script=Tamil}/u };
  const en = FINGERPRINT_DEVICE_LABELS.en;
  for (const language of PRODUCTION_LANGUAGES) {
    const words = FINGERPRINT_DEVICE_LABELS[language.id];
    for (const key of [...ROUND3_KEYS, 'disclose_headers']) {
      const text = words[key];
      assert.equal(typeof text, 'string', language.id + '/' + key); assert.ok(text.trim() === text && text.length >= 2, language.id + '/' + key + ' is empty or padded');
      assert.doesNotMatch(text, /[{}]|undefined|\bnull\b|^(?:region|headers|issue)_/u, language.id + '/' + key + ' has a placeholder or raw key');
      if (language.id === 'en') continue;
      if (!COGNATES.has(language.id + '/' + key)) assert.notEqual(text, en[key], language.id + '/' + key + ' equals the English text');
      if (script[language.id]) assert.match(text, script[language.id], language.id + '/' + key + ' has no native-script text');
      else if (!COGNATES.has(language.id + '/' + key)) assert.doesNotMatch(text, english, language.id + '/' + key + ' contains English words');
    }
    // Cross-references use the language's own words for the controls they name.
    assert.ok(words.region_hint.includes(words.value_auto), language.id + ': the hint names the Auto action as the language calls it');
    assert.ok(words.disclose_headers.includes(words.level_network_title), language.id + ': the disclosure names the Network level as the language calls it');
    for (const token of ['User-Agent', 'Accept-Language', 'Client Hints']) assert.ok(words.headers_applied.includes(token), language.id + ' headers_applied names ' + token);
    assert.ok(words.headers_inactive.includes('Antidetect'), language.id + ' names the product the way the page does');
    for (const key of ['headers_applied', 'headers_inactive', 'headers_scope', 'headers_site_overrides', 'headers_engine', 'headers_invalid', 'headers_label']) assert.ok(words[key].includes('HTTP'), language.id + '/' + key + ' names HTTP');
    assert.ok(words.headers_engine.includes('Chrome'), language.id + ' says which browser'); assert.ok(!words.headers_engine.includes('Edge'), language.id + ': Edge is not measured, so it is not promised');
    for (const token of ['Chrome', 'User-Agent', 'Accept-Language', 'Sec-CH-UA', 'Client Hints']) assert.ok(words.disclose_headers.includes(token), language.id + ' disclose_headers names ' + token);
    assert.ok(!words.disclose_headers.includes('Edge'), language.id + ' disclose_headers promises no Edge');
    assert.ok(words.issue_geolocation_timezone_mismatch.includes('2500'), language.id + ' states the distance rule');
  }
  // Honest wording in English: no verdict, no promise of invisibility.
  for (const key of [...ROUND3_KEYS, 'preset_strict_desc', 'disclose_headers']) assert.doesNotMatch(en[key], /invisible|undetectable|undetected|safe|legitimate|fake|spoof|bypass|anonymous/iu, key);
  assert.match(en.headers_applied, /^HTTP headers \(User-Agent, Accept-Language, Client Hints\) follow the selected profile$/u);
  // What is now true, with its limits: Chrome and all-sites access; the other lines of the list keep IP, TLS and the engine.
  assert.match(en.disclose_headers, /follow the selected profile only in Chrome with all-sites access/u); assert.match(en.disclose_headers, /User-Agent, Accept-Language and Sec-CH-UA change/u); assert.match(en.disclose_headers, /high-entropy Client Hints are not sent/u);
  assert.match(en.disclose_headers, /Other browsers and scopes keep the real headers/u); assert.match(en.disclose_headers, /the Network level shows the current state/u);
  assert.doesNotMatch(en.disclose_headers, /are not changed|not changed/u, 'no longer claims the headers never change'); assert.doesNotMatch(en.disclose_headers, /\b(?:IP|TLS|engine)\b/u, 'the IP, TLS and engine lines keep their own sentences');
  assert.equal(en.headers_engine, 'Chrome only: this browser does not change HTTP headers');
  assert.match(en.region_hint, /IP is not changed/u); assert.match(en.region_hint, /only if you allow geolocation/u);
});

test('the Region and header icons are plain stroke paths in the shared set', () => {
  for (const name of ['region', 'headers']) {
    const paths = [DEVICE_ICON_PATHS[name]].flat(); assert.ok(paths.length >= 1 && paths.every(path => typeof path === 'string' && path.length > 8), name);
    for (const path of paths) assert.match(path, /^[MmLlHhVvCcSsQqTtAaZz0-9\s.,-]+$/u, name + ' uses only path commands and numbers');
  }
});

test('the one-row JSON editor handles the Custom geolocation row: typed, bounded, previewed, applied once, and clearable with the Region action', async () => {
  const h = harness();
  try {
    h.render(); await h.settle();
    const optionLabel = () => h.attr('api').props.children.find(option => option.props.value === 'geolocation')?.props.children;
    assert.ok(optionLabel(), 'the row is in the API list'); assert.match(optionLabel(), / · geolocation$/u); assert.doesNotMatch(optionLabel(), /^geolocation · /u, 'it has a readable name, not only its id');
    select(h, 'api', 'geolocation'); await h.settle();
    const kinds = () => h.attr('value-kind').props.children.map(option => option.props.value), modes = () => h.attr('api-mode').props.children.map(option => option.props.value);
    assert.deepEqual(kinds(), ['unset', 'value'], 'a coordinate pair has no null or undefined form'); assert.ok(modes().includes('custom'));
    select(h, 'api-mode', 'custom'); select(h, 'value-kind', 'value'); await h.settle();
    for (const bad of ['{"latitude":91,"longitude":0,"accuracy":25}', '{"latitude":0,"longitude":-181,"accuracy":25}', '{"latitude":0,"longitude":0,"accuracy":0}', '{"latitude":0,"longitude":0}', '{"latitude":0,"longitude":0,"accuracy":25,"altitude":3}', '"Berlin"', 'null', '[]', '{']) {
      input(h, 'api-json', bad); await h.settle(); await click(h, 'stage-api');
      assert.equal(h.attr('error').props.children, h.table.antidetect_invalid.message, bad); assert.equal(h.attr('apply').props['aria-disabled'], true, bad + ': nothing staged');
    }
    input(h, 'api-json', '{"latitude":48.8566,"longitude":2.3522,"accuracy":30}'); await h.settle(); await click(h, 'stage-api');
    assert.equal(h.attr('error'), undefined); assert.equal(h.s.writes().length, 0); assert.equal(h.attr('apply').props['aria-disabled'], false);
    assert.ok(h.nodes(node => node.props['data-profile-change'] === 'global:geolocation:mode' || String(node.props['data-profile-change']).startsWith('global:geolocation')).length, 'the preview lists the geolocation change');
    await click(h, 'apply');
    assert.equal(h.s.writes().length, 1); assert.deepEqual(api(h.s.value.configuration, 'geolocation').selected, { kind: 'value', value: { latitude: 48.8566, longitude: 2.3522, accuracy: 30 } }); assert.equal(api(h.s.value.configuration, 'geolocation').mode, 'custom');
    // The saved row is shown in the editor again, and the card names the place without inventing a region.
    assert.equal(h.attr('api-json').props.value.includes('48.8566'), true);
    assert.equal(squash(h.nodes(node => node.props['data-profile-device-region'] !== undefined)[0]), '48.86, 2.35');
  } finally { h.unmount(); }
});

test('the mDNS host round-trips through JSON import, export, the one-row editor and Apply, and is rejected anywhere but a Host slot', async () => {
  const h = harness();
  try {
    h.render(); await h.settle(); const before = clone(h.s.value.configuration);
    const family = extra => ({ host: null, stun: null, turn: null, ...extra }), profile = addresses => ({ addresses, iceTransportPolicy: 'preserve', randomizeDevices: false, freshCertificates: false, deviceLifetime: 'session' });
    const withProfile = addresses => updateApiConfiguration(before, 'webrtc', { mode: 'custom', selected: { kind: 'value', value: profile(addresses) } }).value;
    const good = withProfile({ ipv4: family({ host: 'mdns' }), ipv6: family({ host: '2001:db8::10', stun: '2001:db8::20' }) }), json = exportApiConfiguration(good);
    const read = text => h.attr('file').props.onChange({ currentTarget: { files: [{ size: Buffer.byteLength(text), text: async () => text }], value: 'fixture.json' } });
    const tampered = change => { const parsed = JSON.parse(json); change(parsed.apis.find(row => row.id === 'webrtc').selected.value.addresses); return JSON.stringify(parsed); };
    await read(json); await h.settle();
    assert.equal(h.attr('error'), undefined); assert.equal(h.s.writes().length, 0); assert.deepEqual(h.s.value.configuration, before, 'import is a preview');
    await click(h, 'export'); const exported = JSON.parse(h.attr('export-json').props.value).apis.find(row => row.id === 'webrtc');
    assert.equal(exported.mode, 'custom'); assert.deepEqual(exported.selected.value.addresses, { ipv4: family({ host: 'mdns' }), ipv6: family({ host: '2001:db8::10', stun: '2001:db8::20' }) });
    await click(h, 'apply'); assert.equal(h.s.writes().length, 1);
    assert.deepEqual(api(h.s.value.configuration, 'webrtc').selected.value.addresses, exported.selected.value.addresses, 'stored exactly as exported');
    assert.equal(exportApiConfiguration(h.s.value.configuration), json, 'a second export is byte-identical to the file that was imported');
    // Every other use of the word is refused on import, before anything is staged.
    const stored = clone(h.s.value.configuration);
    for (const [name, change] of [['STUN', a => { a.ipv4.stun = 'mdns'; }], ['TURN', a => { a.ipv6.turn = 'mdns'; }], ['upper case', a => { a.ipv4.host = 'MDNS'; }], ['trailing space', a => { a.ipv4.host = 'mdns '; }], ['name', a => { a.ipv6.host = 'mdns.local'; }]]) {
      await read(tampered(change)); await h.settle(); assert.equal(h.attr('error').props.children, h.table.antidetect_editor_invalidJson.message, name); assert.equal(h.s.writes().length, 1, name + ': nothing written'); assert.deepEqual(h.s.value.configuration, stored);
    }
    // The one-row editor accepts the same value and refuses the word elsewhere.
    select(h, 'api', 'webrtc'); await h.settle(); select(h, 'api-mode', 'custom'); select(h, 'value-kind', 'value'); await h.settle();
    input(h, 'api-json', JSON.stringify(profile({ ipv4: family({ host: '192.0.2.10' }), ipv6: family({ host: 'mdns' }) }))); await h.settle(); await click(h, 'stage-api');
    assert.equal(h.attr('error'), undefined); await click(h, 'apply'); assert.deepEqual(api(h.s.value.configuration, 'webrtc').selected.value.addresses, { ipv4: family({ host: '192.0.2.10' }), ipv6: family({ host: 'mdns' }) });
    input(h, 'api-json', JSON.stringify(profile({ ipv4: family({ host: 'mdns', turn: 'mdns' }), ipv6: family() }))); await h.settle(); await click(h, 'stage-api');
    assert.equal(h.attr('error').props.children, h.table.antidetect_invalid.message); assert.equal(h.attr('apply').props['aria-disabled'], true, 'nothing staged');
  } finally { h.unmount(); }
});


// --- ADR-110 addendum (2026-11-07): the font list noise switch of the generator ----------------------------------------------------------
import { describeDevice } from '../../apps/production-extension/fingerprint-device-presets.js';
import { windowsFonts } from '../../apps/production-extension/fingerprint-font-groups.js';
import { noisyFontList, removedByNoise } from '../../apps/production-extension/fingerprint-font-noise.js';
const noiseGroup = h => h.attr('font-noise'), noiseOption = (h, id) => noiseGroup(h).props.children.find(option => option.props['data-profile-option'] === id);
const noiseState = h => noiseGroup(h).props.children.map(option => [option.props['data-profile-option'], option.props['aria-checked'], option.props.disabled]);
const chooseStrict = async h => { h.nodes(node => node.props['data-profile-preset'] === 'strict')[0].props.onClick(); await h.settle(); };
const fontList = configuration => api(configuration, 'canvas-font-policy').selected.value?.families;
const described = configuration => describeDevice(id => { const found = api(configuration, id); return found?.mode === 'custom' && found.selected.kind === 'value' ? found.selected.value : undefined; });
const withFontList = (configuration, families) => { const result = updateApiConfiguration(configuration, 'canvas-font-policy', { mode: 'custom', selected: { kind: 'value', value: { families, fallback: 'sans-serif' } } }); assert.equal(result.ok, true, result.error?.message); return result.value; };

test('font list noise: one switch in the quick setup, On by default, locked outside Strict, its hint attached; the OS view has none', async () => {
  const h = harness(), words = fingerprintDeviceLabels('en');
  try {
    h.render(); await h.settle();
    assert.equal(h.nodes(node => node.props['data-profile-font-noise'] === true).length, 1, 'exactly one switch');
    assert.equal(noiseGroup(h).props.role, 'radiogroup'); assert.equal(noiseGroup(h).props['aria-label'], words.font_noise_label); assert.equal(noiseGroup(h).props['aria-describedby'], 'fp-font-noise-hint');
    assert.equal(h.attr('font-noise-hint').props.id, 'fp-font-noise-hint'); assert.equal(h.attr('font-noise-hint').props.children, words.font_noise_hint);
    assert.deepEqual(noiseState(h), [['off', false, true], ['on', true, true]], 'On when the panel first shows (owner decision 2026-11-07), and locked while the preset is Balanced');
    assert.match(noiseGroup(h).props.class, /(?:^| )is-locked(?: |$)/u, 'a locked switch looks locked');
    assert.deepEqual(noiseGroup(h).props.children.map(option => option.props.children), [words.value_off, words.value_on]);
    noiseOption(h, 'off').props.onClick(); noiseOption(h, 'on').props.onKeyDown({ key: 'Home', preventDefault() {}, currentTarget: { parentElement: null } }); await h.settle();
    assert.deepEqual(noiseState(h), [['off', false, true], ['on', true, true]], 'a locked switch ignores a click and the keyboard');
    await chooseStrict(h);
    assert.deepEqual(noiseState(h), [['off', false, false], ['on', true, false]], 'Strict unlocks it, still On');
    assert.doesNotMatch(noiseGroup(h).props.class, /is-locked/u); assert.equal(h.attr('level-os'), undefined);
    assert.ok(h.attr('device-type').props.class === 'fingerprint-segmented', 'the other segmented controls are unchanged');
    noiseOption(h, 'off').props.onClick(); await h.settle();
    assert.deepEqual(noiseState(h), [['off', true, false], ['on', false, false]]);
    // Back to Balanced: the choice (Off) is kept but locked again.
    h.nodes(node => node.props['data-profile-preset'] === 'balanced')[0].props.onClick(); await h.settle();
    assert.deepEqual(noiseState(h), [['off', true, true], ['on', false, true]]);
    // A generator choice, not a configuration row: nothing is staged, nothing is written.
    assert.equal(h.attr('apply').props['aria-disabled'], true); assert.equal(h.s.writes().length, 0);
  } finally { h.unmount(); }
  const os = harness({ props: { view: 'os' } });
  try { os.render(); await os.settle(); assert.equal(os.attr('font-noise'), undefined, 'the OS view has no second switch'); assert.equal(os.attr('font-noise-hint'), undefined); } finally { os.unmount(); }
});

test('font list noise: Randomize in Strict writes the noisy Windows list while the switch is On (the default) and the plain list once it is Off', async () => {
  const h = harness();
  try {
    h.render(); await h.settle(); await chooseStrict(h); choose(h, 'os', 'windows-10'); await h.settle();
    const plain = windowsFonts(), lists = new Set();
    await click(h, 'generate'); assert.equal(fontList(h.s.value.configuration), undefined, 'a preview, nothing written yet'); await click(h, 'apply');
    for (let round = 0; round < 6; round++) {
      if (round > 0) { await click(h, 'generate'); await click(h, 'apply'); }
      const written = fontList(h.s.value.configuration);
      assert.equal(written.length, plain.length - 2, 'about 3 % of the optional names are left out (2 of the 57), without touching the switch');
      assert.equal(removedByNoise(plain, written)?.length, 2); assert.equal(described(h.s.value.configuration).fontNoise, true); assert.equal(described(h.s.value.configuration).fonts, 'windows');
      for (const name of ['Arial', 'Segoe UI', 'Times New Roman', 'Courier New', 'Helvetica']) assert.ok(written.includes(name), name + ' is never left out');
      lists.add(written.join('|'));
    }
    assert.ok(lists.size > 1, 'each generation draws its own seed, so the lists differ');
    noiseOption(h, 'off').props.onClick(); await h.settle(); await click(h, 'generate'); await click(h, 'apply');
    assert.deepEqual(fontList(h.s.value.configuration), plain, 'Off: the plain Windows 10 list'); assert.equal(described(h.s.value.configuration).fontNoise, false);
    // Windows 11 claims the six Windows 11 names and the limit follows the longer list.
    choose(h, 'os', 'windows-11'); noiseOption(h, 'on').props.onClick(); await h.settle(); await click(h, 'generate'); await click(h, 'apply');
    assert.equal(fontList(h.s.value.configuration).length, windowsFonts({ windows11: true }).length - 2); assert.ok(fontList(h.s.value.configuration).includes('Segoe UI Variable'));
  } finally { h.unmount(); }
});

test('font list noise: the OS control of a noisy profile keeps the noise, and its Windows choice writes the plain list', async () => {
  const h = harness({ props: { view: 'os' } }), noisy = noisyFontList(windowsFonts({ windows11: true }), 4242);
  h.s.value.configuration = withFontList(h.s.value.configuration, noisy);
  try {
    h.render(); await h.settle();
    choose(h, 'level-os', 'windows-10'); await h.settle(); await click(h, 'apply');
    const ten = fontList(h.s.value.configuration);
    assert.equal(ten.length, windowsFonts().length - 2, 'still noisy after the OS change'); assert.equal(described(h.s.value.configuration).fontNoise, true); assert.ok(!ten.includes('Segoe UI Variable'));
    choose(h, 'fonts', 'windows'); await h.settle(); await click(h, 'apply');
    assert.deepEqual(fontList(h.s.value.configuration), windowsFonts(), 'the explicit Windows choice writes the plain list'); assert.equal(described(h.s.value.configuration).fontNoise, false);
  } finally { h.unmount(); }
});

test('font list noise: a saved Windows list decides the switch (noisy On, plain Off); a custom list or no list leaves the default On; nothing is migrated', async () => {
  const plain = windowsFonts({ windows11: true });
  for (const [label, families, expected] of [['noisy list', noisyFontList(plain, 21), true], ['plain list', plain, false], ['custom list', ['Arial', 'Verdana'], true], ['no list', null, true]]) {
    const s = server(); if (families) s.value.configuration = withFontList(s.value.configuration, families);
    const before = JSON.stringify(s.value.configuration), h = harness({ s });
    try {
      h.render(); await h.settle(); assert.deepEqual(noiseState(h).map(([id, checked]) => [id, checked]), [['off', !expected], ['on', expected]], label);
      assert.equal(JSON.stringify(s.value.configuration), before, label + ': the saved configuration is untouched'); assert.equal(s.writes().length, 0, label);
    } finally { h.unmount(); }
  }
  // The saved list wins only when the panel first shows: a later choice of the user is not overwritten by a refresh.
  const s = server(); s.value.configuration = withFontList(s.value.configuration, plain);
  const h = harness({ s });
  try { h.render(); await h.settle(); await chooseStrict(h); assert.deepEqual(noiseState(h).map(([id, checked]) => [id, checked]), [['off', true], ['on', false]], 'the saved plain list gave Off'); noiseOption(h, 'on').props.onClick(); await h.settle(); assert.deepEqual(noiseState(h).map(([id, checked]) => [id, checked]), [['off', false], ['on', true]], 'the user turned it On'); } finally { h.unmount(); }
});

// ADR-110 addendum 2: the claimed region adds its regional CJK group. The OS level has the Region control; the quick setup has the time zone, which gives the region too.
test('Region (OS level): with a Windows font list the region adds its regional CJK group, another region swaps it, Auto removes it, and the noise is kept', async () => {
  const s = server(); s.value.configuration = generateConsistentDevice(s.value.configuration, { deviceType: 'desktop', os: 'windows-11', protection: 'strict', seed: 5, fontNoise: true }).configuration;
  const h = harness({ s, props: { view: 'os' } });
  try {
    h.render(); await h.settle();
    assert.equal(described(s.value.configuration).fontRegion, null); assert.equal(fontList(s.value.configuration).length, 100);
    await typeRegion(h, 'japan'); await pickRegion(h, 'JP'); await click(h, 'apply');
    let device = described(h.s.value.configuration), list = fontList(h.s.value.configuration);
    assert.equal(device.region, 'JP'); assert.equal(device.fontRegion, 'regionJa'); assert.equal(device.fontNoise, true); assert.equal(list.length, 119 - 2);
    for (const name of ['Meiryo', 'Meiryo UI', 'Yu Mincho', 'MS Mincho', 'BIZ UDGothic']) assert.ok(list.includes(name), name);
    assert.ok(list.includes('Yu Gothic') && list.includes('MS PGothic'), 'the base-script families stay');
    await typeRegion(h, 'korea'); await pickRegion(h, 'KR'); await click(h, 'apply');
    device = described(h.s.value.configuration); list = fontList(h.s.value.configuration);
    assert.equal(device.fontRegion, 'regionKo'); assert.equal(device.fontNoise, true); assert.ok(list.includes('Batang') && list.includes('Gulim') && !list.includes('Meiryo'));
    await typeRegion(h, 'germany'); await pickRegion(h, 'DE'); await click(h, 'apply');
    device = described(h.s.value.configuration); list = fontList(h.s.value.configuration);
    assert.equal(device.region, 'DE'); assert.equal(device.fontRegion, null); assert.equal(device.fontNoise, true); assert.equal(list.length, 102 - 2); assert.ok(!list.includes('Batang'));
    await typeRegion(h, 'taiwan'); await pickRegion(h, 'TW'); await click(h, 'apply');
    assert.equal(described(h.s.value.configuration).fontRegion, 'regionZhHant'); assert.ok(fontList(h.s.value.configuration).includes('MingLiU'));
    h.attr('region-reset').props.onClick(); await h.settle(); await click(h, 'apply');
    device = described(h.s.value.configuration); assert.equal(device.region, null); assert.equal(device.fontRegion, null); assert.equal(fontList(h.s.value.configuration).length, 102 - 2, 'Auto: no regional group, the noise stays');
    // A configuration without a Windows font list gets no font row from the region control.
    const bare = harness({ props: { view: 'os' } });
    try { bare.render(); await bare.settle(); await typeRegion(bare, 'japan'); await pickRegion(bare, 'JP'); await click(bare, 'apply'); assert.equal(api(bare.s.value.configuration, 'canvas-font-policy').mode, 'bypass'); } finally { bare.unmount(); }
  } finally { h.unmount(); }
});

test('Quick setup: Strict with a Tokyo time zone writes the Japanese group, with Auto it writes none; the region does not change the number of names left out', async () => {
  const h = harness();
  try {
    h.render(); await h.settle(); await chooseStrict(h); choose(h, 'os', 'windows-10'); await h.settle();
    await click(h, 'generate'); await click(h, 'apply');
    assert.equal(described(h.s.value.configuration).fontRegion, null, 'Auto: no region, no regional group'); assert.equal(fontList(h.s.value.configuration).length, 96 - 2);
    h.attr('timezone-input').props.onFocus(); await h.settle(); h.attr('timezone-input').props.onInput({ currentTarget: { value: 'tokyo' } }); await h.settle(); h.attr('timezone-input').props.onKeyDown({ key: 'Enter', preventDefault() {} }); await h.settle();
    await click(h, 'generate'); await click(h, 'apply');
    const device = described(h.s.value.configuration), list = fontList(h.s.value.configuration);
    assert.equal(device.region, 'JP'); assert.equal(device.fontRegion, 'regionJa'); assert.equal(device.fontNoise, true);
    assert.equal(list.length, 113 - 2, 'the Japanese Windows 10 list leaves out two names (the floor of the noise)');
    for (const name of ['Meiryo', 'Meiryo UI', 'Yu Mincho', 'MS Mincho', 'BIZ UDGothic']) assert.ok(list.includes(name), name);
    noiseOption(h, 'off').props.onClick(); await h.settle(); await click(h, 'generate'); await click(h, 'apply');
    assert.deepEqual(fontList(h.s.value.configuration), windowsFonts({ regionGroup: 'regionJa' }), 'Off: the plain Windows 10 list of the Japanese claim');
  } finally { h.unmount(); }
});

test('font list noise: the label, the hint and the On / Off words are shown in all 21 languages', async () => {
  for (const language of PRODUCTION_LANGUAGES) {
    const words = FINGERPRINT_DEVICE_LABELS[language.id], h = harness({ locale: language.id });
    try {
      h.render(); await h.settle();
      assert.equal(noiseGroup(h).props['aria-label'], words.font_noise_label, language.id); assert.equal(h.attr('font-noise-hint').props.children, words.font_noise_hint, language.id);
      assert.deepEqual(noiseGroup(h).props.children.map(option => option.props.children), [words.value_off, words.value_on], language.id);
      assert.ok(FINGERPRINT_DEVICE_KEYS.includes('font_noise_label') && FINGERPRINT_DEVICE_KEYS.includes('font_noise_hint'));
    } finally { h.unmount(); }
  }
});

test('font list noise: the stylesheet dims a locked switch and shows it in GrayText under forced colors', () => {
  const css = readFileSync(new URL('../../apps/production-extension/fingerprint-profile-ui.css', import.meta.url), 'utf8');
  assert.match(css, /\.fingerprint-segmented\.is-locked \{ opacity: \.55; \}/u);
  assert.match(css, /:root body \.fingerprint-profiles \.fingerprint-segmented\.is-locked > \.fingerprint-segment \{ cursor: not-allowed; \}/u);
  const forced = css.slice(css.indexOf('@media (forced-colors: active)'));
  assert.match(forced, /\.fingerprint-segmented\.is-locked \{ opacity: 1; \}/u);
  assert.match(forced, /\.fingerprint-segmented\.is-locked > \.fingerprint-segment \{ color: GrayText; border-color: GrayText; \}/u);
});
