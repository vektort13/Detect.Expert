// ADR-107 (round 4): hints under their controls, value sources, the explainer and hint actions, combobox and keyboard
// accessibility, Apply reasons, shared shortcuts, «Keep my changes» and the pending-tab marks of the profile panel.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createFingerprintProfileUi } from '../../apps/production-extension/fingerprint-profile-ui.js';
import { createApiConfiguration, validateApiConfiguration, updateApiConfiguration } from '../../apps/production-extension/api-configuration.js';
import { generateConsistentDevice, applyDevicePatch } from '../../apps/production-extension/fingerprint-profiles.js';
import { CPU_STEPS, RAM_STEPS } from '../../apps/production-extension/fingerprint-device-presets.js';
import { FINGERPRINT_DEVICE_KEYS, FINGERPRINT_DEVICE_LABELS, fingerprintDeviceLabels } from '../../apps/production-extension/fingerprint-device-labels.js';
import { redesignLabels } from '../../apps/production-extension/redesign-labels.js';
import { antidetectEditorLabels } from '../../apps/production-extension/antidetect-editor-labels.js';
import { collectPaletteCommands } from '../../apps/production-extension/ui-shortcuts.js';
import { applyAntidetectCopy } from '../production-locales-antidetect.mjs';
import { applyFingerprintCopy } from '../production-locales-fingerprint.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';

const clone = value => structuredClone(value), turn = () => new Promise(resolve => setImmediate(resolve));
function event() { const listeners = new Set(); return { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn), emit: (...args) => { for (const fn of listeners) fn(...args); } }; }
function messages(locale) { const language = PRODUCTION_LANGUAGES.find(item => item.id === locale); return applyFingerprintCopy(applyAntidetectCopy(JSON.parse(readFileSync(new URL('../../apps/production-extension/' + (language.uiOnly ? 'ui-locales' : '_locales') + '/' + locale + '/messages.json', import.meta.url))), locale), locale); }
function server() {
  const calls = [], value = { configuration: createApiConfiguration(), revision: 7, windowUpdates: [] };
  const snapshot = () => ({ schemaVersion: 1, type: 'api-config-state', configuration: clone(value.configuration), revision: value.revision, registration: value.configuration.enabled ? 'ready' : 'inactive', reloadRequired: false, earlyAccess: value.earlyAccess ?? 'ready' });
  const api = {
    runtime: { id: 'profile-fixture', getURL: path => 'chrome-extension://profile-fixture/' + path, sendMessage: async request => {
      calls.push(clone(request));
      if (request.type === 'ui-api-config-set') { if (request.expectedRevision !== value.revision) return { schemaVersion: 1, type: 'api-config-error', code: 'stale-revision' }; const checked = validateApiConfiguration(request.configuration); assert.equal(checked.ok, true); value.configuration = checked.value; value.revision++; }
      return snapshot(); } },
    storage: { onChanged: event() }, permissions: { onRemoved: event() }, tabs: { create: async () => ({}) },
    windows: { getCurrent: async () => ({ id: 5 }), update: async (id, info) => { if (value.windowFail) throw new Error('refused'); value.windowUpdates.push([id, info]); return { id, width: info.width, height: info.height }; } },
  };
  return { api, calls, value, writes: () => calls.filter(call => call.type === 'ui-api-config-set') };
}
function realNavigator({ major = 156, hardwareConcurrency = 16, deviceMemory = undefined, platform = 'Windows' } = {}) {
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + major + '.0.0.0 Safari/537.36';
  return { userAgent: ua, appVersion: ua.replace('Mozilla/', ''), platform: 'Win32', vendor: 'Google Inc.', language: 'en-US', languages: ['en-US', 'en'], hardwareConcurrency, ...(deviceMemory === undefined ? {} : { deviceMemory }),
    userAgentData: { brands: [{ brand: 'Not:A-Brand', version: '8' }, { brand: 'Chromium', version: String(major) }, { brand: 'Google Chrome', version: String(major) }], mobile: false, platform, getHighEntropyValues: async () => ({ platformVersion: '19.0.0' }) } };
}
// A document stand-in: focus targets by id, a WebGL2 context with the debug renderer extension (no drawing methods at all) and the
// announcer's polite region, so what the panel announces can be read back.
function fakeDocument({ renderer = null } = {}) {
  const focused = [], announced = [], elements = new Map();
  const element = id => { if (!elements.has(id)) elements.set(id, { id, offsetTop: 0, offsetHeight: 10, scrollTop: 0, clientHeight: 100, focus() { focused.push(id); } }); return elements.get(id); };
  const region = { isConnected: true, append(node) { announced.push(node.textContent); }, contains: () => true };
  const gl = { MAX_TEXTURE_SIZE: 1, MAX_VIEWPORT_DIMS: 2, MAX_RENDERBUFFER_SIZE: 3, MAX_SAMPLES: 4, MAX_COMBINED_TEXTURE_IMAGE_UNITS: 5, MAX_VERTEX_UNIFORM_VECTORS: 6,
    getExtension: name => name === 'WEBGL_debug_renderer_info' ? { UNMASKED_VENDOR_WEBGL: 37445, UNMASKED_RENDERER_WEBGL: 37446 } : name === 'WEBGL_lose_context' ? { loseContext() {} } : null,
    getParameter: name => ({ 37445: 'Google Inc. (NVIDIA)', 37446: renderer, 1: 32768, 2: Int32Array.of(32768, 32768), 3: 32768, 4: 16, 5: 192, 6: 4096 })[name] ?? null };
  return { focused, announced, visibilityState: 'visible', addEventListener() {}, removeEventListener() {}, getElementById: element,
    querySelector: selector => selector === '[data-ui-announcer="polite"]' || selector === '[data-ui-announcer="assertive"]' ? region : null,
    createElement: tag => tag === 'canvas' ? { getContext: kind => renderer && kind === 'webgl2' ? gl : null } : { textContent: '', remove() {} } };
}
// `root` stands for the panel's DOM element: like Preact, the fake h assigns it to the section's ref before the effects run.
function harness({ s = server(), locale = 'en', props: initialProps = {}, nav = null, display = {}, doc = null, root = null } = {}) {
  const keys = ['window', 'location', 'navigator', 'screen', 'devicePixelRatio', 'outerWidth', 'outerHeight', 'document', 'addEventListener', 'removeEventListener'];
  const previous = Object.fromEntries(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])), windowListeners = new Map();
  const own = {}; own.top = own;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: own }); Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: 'chrome-extension://profile-fixture/options.html#antidetect' } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: nav ?? realNavigator() });
  if (doc) Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  Object.defineProperty(globalThis, 'addEventListener', { configurable: true, value: (type, fn) => windowListeners.set(type, [...(windowListeners.get(type) ?? []), fn]) });
  Object.defineProperty(globalThis, 'removeEventListener', { configurable: true, value: (type, fn) => windowListeners.set(type, (windowListeners.get(type) ?? []).filter(item => item !== fn)) });
  for (const [key, value] of Object.entries(display)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const slots = [], effects = [], table = messages(locale); let cursor = 0, changed = true, tree, props = { active: true, ...initialProps };
  const hooks = {
    useState(initial) { const slot = slots[cursor++] ??= { value: initial }; return [slot.value, next => { const value = typeof next === 'function' ? next(slot.value) : next; if (!Object.is(slot.value, value)) { slot.value = value; changed = true; } }]; },
    useRef(initial) { return (slots[cursor++] ??= { ref: { current: initial } }).ref; },
    useEffect(fn, dependencies) { const slot = slots[cursor++] ??= {}; if (!slot.dependencies || dependencies.some((value, index) => !Object.is(value, slot.dependencies[index]))) { slot.dependencies = dependencies; effects.push(() => { slot.cleanup?.(); slot.cleanup = fn(); }); } },
  };
  const h = (type, props) => { if (root && props?.ref && props['data-fingerprint-profile-panel']) props.ref.current = root; return { type, props }; };
  const { FingerprintProfilePanel } = createFingerprintProfileUi({ ...hooks, h, useLocale: () => locale, translate: key => table[key]?.message ?? key, browserApi: s.api });
  function render() { cursor = 0; changed = false; tree = FingerprintProfilePanel(props); while (effects.length) effects.shift()(); return tree; }
  async function settle() { for (let i = 0; i < 12; i++) { if (changed) render(); await turn(); } if (changed) render(); }
  function nodes(predicate) { const results = []; (function visit(node) { if (Array.isArray(node)) { node.forEach(visit); return; } if (!node?.props) return; if (predicate(node)) results.push(node); visit(node.props.children); })(tree); return results; }
  const attr = key => nodes(node => node.props['data-profile-' + key] === true)[0];
  return { s, table, render, settle, nodes, attr, windowListeners, update(patch) { props = { ...props, ...patch }; changed = true; render(); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); for (const [key, descriptor] of Object.entries(previous)) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]; } };
}
const flat = node => { const parts = []; (function visit(item) { if (Array.isArray(item)) item.forEach(visit); else if (typeof item === 'string' || typeof item === 'number') parts.push(String(item)); else if (item?.props) visit(item.props.children); })(node); return parts.join(''); };
function descend(node, predicate) { if (Array.isArray(node)) { for (const item of node) { const found = descend(item, predicate); if (found) return found; } return undefined; } if (!node?.props) return undefined; if (predicate(node)) return node; return descend(node.props.children, predicate); }
const click = async (h, key) => { await h.attr(key).props.onClick(); await h.settle(); };
const slide = (h, key, index) => h.attr('slider-' + key).props.onInput({ currentTarget: { value: String(index) } });
const sliderValue = (h, key) => flat(h.nodes(node => node.props['data-profile-slider-value'] === key)[0]);
const api = (configuration, id) => configuration.apis.find(row => row.id === id);
const issueNode = (h, code) => h.nodes(node => node.props['data-profile-issue'] === code)[0];
const within = (node, attribute, value = true) => descend(node, child => child.props[attribute] === value);
const source = (h, field) => h.nodes(node => node.props['data-profile-source'] === field)[0]?.props['data-source'];
const savedWith = build => { const s = server(); s.value.configuration = build(createApiConfiguration()); return s; };
const windowsClaim = (version = 156) => configuration => generateConsistentDevice(configuration, { os: 'windows-11', browser: 'chrome', version, seed: 7 }, {}).configuration;
const typeInto = async (h, name, text) => { h.attr(name + '-input').props.onFocus(); await h.settle(); h.attr(name + '-input').props.onInput({ currentTarget: { value: text } }); await h.settle(); };
const pickRegion = async (h, code) => { h.nodes(node => node.props['data-profile-region-option'] === code)[0].props.onMouseDown({ preventDefault() {} }); await h.settle(); };
function external(h, mutate) { const next = clone(h.s.value.configuration); mutate(next); h.s.value.configuration = next; h.s.value.revision++; h.s.api.storage.onChanged.emit({ 'api-configuration:v1': {} }, 'local'); }

test('a hint sits under the control it concerns (aria-describedby), hints of other levels stay in the list with Show', async () => {
  const words = fingerprintDeviceLabels('en'), navigated = [], doc = fakeDocument();
  const h = harness({ s: savedWith(windowsClaim()), nav: realNavigator({ hardwareConcurrency: 8, platform: 'macOS' }), doc, props: { view: 'device', onNavigate: level => navigated.push(level) } });
  try {
    h.render(); await h.settle(); slide(h, 'cpu', CPU_STEPS.indexOf(32)); await h.settle();
    const field = h.nodes(node => node.props['data-profile-field-issues'] === 'cpu')[0];
    assert.ok(field, 'the CPU control has its own hint list'); assert.equal(field.props.id, 'fp-issues-cpu');
    assert.ok(within(field, 'data-profile-issue', 'cores-above-real'), 'the core-count hint is under the CPU slider');
    assert.ok(h.attr('slider-cpu').props['aria-describedby'].split(' ').includes('fp-issues-cpu'), 'the slider points at its hints');
    const list = h.attr('issues');
    assert.ok(list && !within(list, 'data-profile-issue', 'cores-above-real'), 'not repeated in the list below');
    const host = within(list, 'data-profile-issue', 'host-os'); assert.ok(host, 'a hint of the OS level stays in the list');
    // Severity is a word and an icon, never colour alone.
    const cores = issueNode(h, 'cores-above-real');
    assert.equal(cores.props['data-severity'], 'warning'); assert.equal(flat(descend(cores, node => node.props.class === 'fp-issue__severity')), words.severity_warning);
    assert.equal(descend(cores, node => node.props.class === 'fp-issue__severity').props.children[0].props.name, 'warning');
    assert.equal(host.props['data-severity'], 'info'); assert.equal(flat(descend(host, node => node.props.class === 'fp-issue__severity')), words.severity_info);
    // «Claimed / this browser» with the facts the snapshot has.
    assert.equal(flat(within(cores, 'data-profile-issue-explain', 'cores-above-real')), words.explain_claimed.replace('{value}', '32') + ' · ' + words.explain_real.replace('{value}', '8'));
    assert.equal(within(cores, 'data-profile-issue-show', 'cores-above-real'), undefined, 'a hint under its control needs no Show');
    const show = within(host, 'data-profile-issue-show', 'host-os');
    assert.equal(show.props['aria-label'], words.issue_show + ': ' + words.os_label, 'the button is named after its target');
    show.props.onClick(); await h.settle(); assert.deepEqual(navigated, ['os'], 'Show opens the other level');
    h.update({ view: 'os' }); await h.settle(); assert.deepEqual(doc.focused.filter(id => id === 'fp-field-os'), ['fp-field-os'], 'then focuses the control');
    assert.ok(h.nodes(node => node.props['data-profile-field-issues'] === 'os')[0], 'on its own level the hint sits under the OS choice');
    assert.equal(h.attr('level-os').props['aria-describedby'], 'fp-issues-os');
    assert.equal(h.s.writes().length, 0);
  } finally { h.unmount(); }
  const plain = harness({ s: savedWith(windowsClaim()), nav: realNavigator({ platform: 'macOS' }), props: { view: 'device' } });
  try { plain.render(); await plain.settle(); assert.equal(within(issueNode(plain, 'host-os'), 'data-profile-issue-show', 'host-os'), undefined, 'without a way to switch levels there is no Show'); }
  finally { plain.unmount(); }
});

test('Auto reads «As in the browser · value» with the thumb on the real value; each control says where its value comes from', async () => {
  const words = fingerprintDeviceLabels('en');
  const h = harness({ nav: realNavigator({ hardwareConcurrency: 16, deviceMemory: 8 }), props: { view: 'device' } });
  try {
    h.render(); await h.settle();
    assert.equal(sliderValue(h, 'cpu'), words.value_browser + ' · 16'); assert.equal(h.attr('slider-cpu').props.value, CPU_STEPS.indexOf(16), 'the thumb sits on the real value');
    assert.equal(sliderValue(h, 'ram'), words.value_browser + ' · 8 GB'); assert.equal(h.attr('slider-ram').props.value, RAM_STEPS.indexOf(8));
    assert.equal(h.attr('slider-cpu').props['aria-valuetext'], words.value_browser + ' · 16', 'screen readers hear the same');
    assert.equal(source(h, 'cpu'), 'real'); assert.equal(flat(h.nodes(node => node.props['data-profile-source'] === 'cpu')[0]), words.source_real);
    slide(h, 'cpu', CPU_STEPS.indexOf(4)); await h.settle();
    assert.equal(sliderValue(h, 'cpu'), '4'); assert.equal(source(h, 'cpu'), 'custom');
    const reset = h.nodes(node => node.props['data-profile-slider-reset'] === 'cpu')[0];
    assert.equal(reset.props.children, words.value_auto); assert.equal(reset.props['aria-label'], words.value_auto + ': ' + words.cpu_label, 'named in context');
  } finally { h.unmount(); }
  const os = harness({ props: { view: 'os' } });
  try {
    os.render(); await os.settle();
    for (const field of ['region', 'language', 'timezone']) assert.equal(source(os, field), 'real', field);
    assert.ok(os.attr('timezone-input').props.placeholder.startsWith(words.value_browser + ' · '), 'the empty zone box names the real zone');
    await typeInto(os, 'region', 'germany'); await pickRegion(os, 'DE');
    for (const field of ['region', 'language', 'timezone']) assert.equal(source(os, field), 'region', field + ' follows the region');
    await typeInto(os, 'timezone', 'tokyo'); os.attr('timezone-input').props.onKeyDown({ key: 'Enter', preventDefault() {} }); await os.settle();
    assert.equal(source(os, 'timezone'), 'custom', 'another zone than the region\'s is a custom value');
    assert.equal(source(os, 'language'), 'custom', 'the shown region now follows the zone (Japan), so the German language is a custom value');
    const language = os.attr('level-language').props.children[0];
    assert.equal(language.props.value, 'preserve'); assert.ok(language.props.children.startsWith(words.value_browser), 'one word for the real value');
  } finally { os.unmount(); }
});

test('the GPU list starts with this computer\'s real card by name; the generator\'s empty choice stays «Auto»; the snapshot never leaves the page', async () => {
  const words = fingerprintDeviceLabels('en'), doc = fakeDocument({ renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)' });
  const h = harness({ doc, props: { view: 'device' } });
  try {
    h.render(); await h.settle();
    const select = h.attr('level-gpu'), first = select.props.children[0];
    assert.deepEqual([first.props.value, first.props.children], ['', words.gpu_real_option + ' · NVIDIA GeForce RTX 3060']);
    assert.ok(select.props['aria-describedby'].split(' ').includes('fp-gpu-help')); assert.equal(flat(h.attr('gpu-help')), words.gpu_real_help);
    assert.equal(select.props.id, 'fp-field-gpu');
    h.update({ view: 'quick' }); await h.settle();
    assert.deepEqual(h.attr('gpu').props.children[0].props.children, words.value_auto, 'in the generator an empty GPU means «pick one that fits»');
    assert.doesNotMatch(JSON.stringify(h.s.calls), /RTX 3060|NVIDIA/u, 'the real GPU is never sent anywhere');
  } finally { h.unmount(); }
});

test('Fix stages the generator\'s repair as a preview and Update the claim retargets the version; nothing is written until Apply', async (t) => {
  const words = fingerprintDeviceLabels('en'), doc = fakeDocument();
  const far = configuration => updateApiConfiguration(applyDevicePatch(configuration, { region: 'DE' }, {}).configuration, 'geolocation', { mode: 'custom', selected: { kind: 'value', value: { latitude: 35.6895, longitude: 139.6917, accuracy: 25 } } }).value;
  const h = harness({ s: savedWith(far), doc, props: { view: 'os' } });
  try {
    h.render(); await h.settle();
    const field = h.nodes(node => node.props['data-profile-field-issues'] === 'region')[0];
    const fix = within(field, 'data-profile-issue-fix', 'geolocation-timezone-mismatch');
    assert.ok(fix, 'a repairable hint offers Fix'); assert.equal(fix.props.children, words.issue_fix); assert.equal(fix.props['aria-label'], words.issue_fix + ': ' + words.region_label);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    fix.props.onClick(); t.mock.timers.tick(1);
    await h.settle();
    assert.equal(h.s.writes().length, 0, 'Fix never writes'); assert.equal(issueNode(h, 'geolocation-timezone-mismatch'), undefined, 'the preview is consistent');
    assert.deepEqual(doc.announced, [words.fix_staged], 'the staged repair is announced');
    t.mock.timers.reset();
    const place = h.s.calls.length && h.nodes(node => node.props['data-profile-change'])?.length;
    assert.equal(place, 0, 'the level view has no change list; the preview lives in the draft');
    await click(h, 'apply'); assert.equal(h.s.writes().length, 1);
    const written = api(h.s.value.configuration, 'geolocation').selected.value; assert.ok(Math.abs(written.latitude - 52.5) < 1 && Math.abs(written.longitude - 13.4) < 1, 'the coordinates moved to the zone');
  } finally { t.mock.timers.reset(); h.unmount(); }
  const b = harness({ s: savedWith(windowsClaim(156)), nav: realNavigator({ major: 150 }), props: { view: 'browser' } });
  try {
    b.render(); await b.settle();
    const field = b.nodes(node => node.props['data-profile-field-issues'] === 'version')[0];
    assert.ok(within(field, 'data-profile-issue', 'engine-version'), 'the version hint sits under the Version select');
    assert.equal(within(field, 'data-profile-issue-fix', 'engine-version'), undefined, 'one button, not Fix and Update for the same repair');
    const update = within(field, 'data-profile-issue-retarget', 'engine-version'); assert.equal(update.props.children, words.retarget_button.replace('{version}', '150'));
    assert.equal(flat(b.attr('retarget')), words.retarget_button.replace('{version}', '150'), 'the same action beside the select');
    update.props.onClick(); await b.settle();
    assert.equal(b.attr('level-version').props.value, '150'); assert.equal(issueNode(b, 'engine-version'), undefined); assert.equal(b.attr('retarget'), undefined);
    assert.equal(b.s.writes().length, 0); await click(b, 'apply'); assert.match(api(b.s.value.configuration, 'navigator-user-agent').selected.value, /Chrome\/150\./u);
  } finally { b.unmount(); }
});

test('Fit the window is an explicit click: chrome.windows.update sizes this window, the result is reported, nothing is written', async () => {
  const words = fingerprintDeviceLabels('en'), display = { screen: { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040, colorDepth: 24, pixelDepth: 24 }, outerWidth: 1900, outerHeight: 1000 };
  const h = harness({ display, props: { view: 'device' } });
  try {
    h.render(); await h.settle(); assert.equal(h.attr('fit-window'), undefined, 'nothing to fit while the screen is the browser\'s');
    slide(h, 'screen', 0); await h.settle();
    assert.equal(h.s.value.windowUpdates.length, 0, 'never resized by itself');
    const card = issueNode(h, 'screen-vs-real'); assert.ok(card); assert.ok(within(card, 'data-profile-issue-fit', 'screen-vs-real'), 'the screen hint offers the fit');
    await click(h, 'fit-window');
    assert.deepEqual(h.s.value.windowUpdates, [[5, { state: 'normal', width: 1536, height: 815 }]], 'the claimed available screen, one pixel short of maximized');
    assert.match(flat(h.nodes(node => node.props.class === 'fp-fit')[0]), new RegExp(words.fit_window_done.replace('{width}', '1536').replace('{height}', '815').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
    assert.match(flat(h.nodes(node => node.props.class === 'fp-fit')[0]), new RegExp(words.fit_window_note.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'), 'Firefox may ignore it: the note says so');
    h.s.value.windowFail = true; await click(h, 'fit-window');
    assert.ok(flat(h.nodes(node => node.props.class === 'fp-fit')[0]).includes(words.fit_window_failed));
    assert.equal(h.s.writes().length, 0);
  } finally { h.unmount(); }
});

test('combobox: IME composition never picks, leaving the box closes it, the highlight and the current value are separate', async () => {
  const h = harness({ props: { view: 'os' } });
  try {
    h.render(); await h.settle(); await typeInto(h, 'timezone', 'berlin');
    const input = () => h.attr('timezone-input').props;
    assert.equal(input()['aria-expanded'], true); assert.equal(input()['aria-activedescendant'], 'fp-timezone-list-0');
    input().onKeyDown({ key: 'Enter', isComposing: true, preventDefault() { throw new Error('composition must not be handled'); } }); await h.settle();
    input().onKeyDown({ key: 'Enter', keyCode: 229, preventDefault() { throw new Error('composition must not be handled'); } }); await h.settle();
    assert.equal(input()['aria-expanded'], true, 'still open'); assert.equal(h.s.calls.filter(call => call.type === 'ui-api-config-set').length, 0);
    input().onKeyDown({ key: 'Enter', preventDefault() {} }); await h.settle();
    assert.equal(input()['aria-expanded'], false, 'a real Enter picks');
    input().onFocus(); await h.settle();
    const options = h.nodes(node => node.props['data-profile-timezone-option']), berlin = options.find(node => node.props['data-profile-timezone-option'] === 'Europe/Berlin');
    assert.ok(berlin.props.class.includes('is-selected') && !berlin.props.class.includes('is-highlighted'), 'the current value is marked, not highlighted');
    assert.equal(berlin.props['aria-selected'], true); assert.ok(descend(berlin, node => node.props.class === 'fp-combobox__check'), 'with a check mark');
    assert.equal(options.filter(node => node.props.class.includes('is-highlighted')).length, 0, 'focus alone highlights nothing');
    const box = h.attr('timezone');
    box.props.onFocusOut({ currentTarget: { contains: () => true }, relatedTarget: {} }); await h.settle(); assert.equal(input()['aria-expanded'], true, 'moving inside the box keeps it open');
    box.props.onFocusOut({ currentTarget: { contains: () => false }, relatedTarget: null }); await h.settle(); assert.equal(input()['aria-expanded'], false, 'leaving closes it at once');
    await typeInto(h, 'timezone', 'qqqq');
    const status = h.attr('timezone-status'); assert.equal(status.props.role, 'status'); assert.equal(flat(status), fingerprintDeviceLabels('en').region_none);
    await typeInto(h, 'timezone', 'sao paulo'); assert.equal(flat(h.attr('timezone-status')), '', 'the status stays, empty');
    assert.equal(h.nodes(node => node.props['data-profile-timezone-option'])[0].props['data-profile-timezone-option'], 'America/Sao_Paulo', 'words in any order, accents ignored');
  } finally { h.unmount(); }
  const ru = harness({ locale: 'ru', props: { view: 'os' } });
  try { ru.render(); await ru.settle(); await typeInto(ru, 'timezone', 'германия'); assert.ok(ru.nodes(node => node.props['data-profile-timezone-option'] === 'Europe/Berlin').length, 'the country in the UI language'); }
  finally { ru.unmount(); }
});

test('presets rove with the arrow keys; on/off read in the UI language; the one-row editor uses the API page mode names and order', async () => {
  const ru = fingerprintDeviceLabels('ru'), focused = [];
  const h = harness({ locale: 'ru' });
  try {
    h.render(); await h.settle();
    const preset = id => h.nodes(node => node.props['data-profile-preset'] === id)[0];
    assert.deepEqual(['compatibility', 'balanced', 'strict'].map(id => preset(id).props.tabIndex), [-1, 0, -1], 'one tab stop');
    const prevented = [];
    preset('balanced').props.onKeyDown({ key: 'ArrowRight', preventDefault: () => prevented.push(true), currentTarget: { parentElement: { querySelector: selector => ({ focus: () => focused.push(selector) }) } } }); await h.settle();
    assert.equal(preset('strict').props['aria-checked'], true); assert.deepEqual(focused, ['[data-profile-preset="strict"]']); assert.deepEqual(prevented, [true]);
    preset('strict').props.onKeyDown({ key: 'Home', preventDefault() {}, currentTarget: { parentElement: { querySelector: () => ({ focus() {} }) } } }); await h.settle();
    assert.equal(preset('compatibility').props['aria-checked'], true);
    const chips = h.nodes(node => node.props['data-profile-chip'] && node.props['data-state'] !== 'uncovered');
    assert.ok(chips.length >= 4); for (const chip of chips) assert.ok([ru.value_on, ru.value_off].includes(flat(chip.props.children[1])), 'chip state in Russian');
    assert.ok([ru.value_on, ru.value_off].includes(flat(h.attr('antidetect-master').props.children[1])));
    const modes = redesignLabels('ru'), options = h.attr('api-mode').props.children;
    assert.deepEqual(options.map(option => option.props.value), ['bypass', 'off', 'on', 'custom'], 'the API page order');
    assert.deepEqual(options.map(option => option.props.children), [modes.modeInherit, modes.modeAllow, modes.modeBlock, modes.modeCustom]);
    assert.doesNotMatch(JSON.stringify(options.map(option => option.props.children)), /"(?:ON|OFF|BYPASS)"/u);
  } finally { h.unmount(); }
  const b = harness({ locale: 'ru', props: { view: 'browser' } });
  try {
    b.render(); await b.settle();
    const options = b.attr('protect-canvas').props.children.map(option => flat(option.props.children));
    assert.deepEqual(options, [ru.value_off, ru.value_on]);
  } finally { b.unmount(); }
});

test('Apply stays focusable and says why it cannot run; warnings are counted, never blocking; the change list reads before → after', async () => {
  const words = fingerprintDeviceLabels('en'), parent = antidetectEditorLabels('en');
  const h = harness({ nav: realNavigator({ hardwareConcurrency: 8 }), props: { view: 'device' } });
  try {
    h.render(); await h.settle();
    const apply = () => h.attr('apply').props;
    assert.equal(apply()['aria-disabled'], true); assert.equal(apply().disabled, undefined, 'focusable'); assert.equal(flat(h.attr('apply-reason')), words.reason_no_changes);
    assert.equal(apply()['aria-describedby'], 'fp-apply-reason'); await apply().onClick(); await h.settle(); assert.equal(h.s.writes().length, 0);
    slide(h, 'cpu', CPU_STEPS.indexOf(32)); await h.settle();
    assert.equal(apply()['aria-disabled'], false); assert.equal(flat(h.attr('apply-reason')), ''); assert.equal(apply()['aria-describedby'], undefined);
    const warned = h.nodes(node => node.props['data-profile-warned-fields'])[0];
    assert.equal(warned.props['data-profile-warned-fields'], 1); assert.equal(flat(warned), words.reason_fields.replace('{count}', '1'));
    for (const [reason, text] of [['network-dirty', words.reason_parent], ['unverified', parent.reasonUnverified], ['busy', parent.reasonBusy]]) {
      h.update({ disabled: true, disabledReason: reason }); await h.settle();
      assert.equal(apply()['aria-disabled'], true, reason); assert.equal(flat(h.attr('apply-reason')), text, reason);
    }
    h.update({ disabled: false, disabledReason: null }); await h.settle();
    h.update({ view: 'quick' }); await h.settle();
    const change = h.nodes(node => node.props['data-profile-change'] === 'global:hardware-concurrency:selected')[0];
    assert.equal(flat(within(change, 'data-profile-change-before')), JSON.stringify({ kind: 'unset' }));
    assert.equal(flat(within(change, 'data-profile-change-after')), JSON.stringify({ kind: 'value', value: 32 }));
    const hidden = h.nodes(node => node.props.class === 'fingerprint-visually-hidden').map(flat);
    assert.ok(hidden.includes(words.change_before + ': ') && hidden.includes(' ' + words.change_after + ': '), 'screen readers hear Before / After');
    assert.equal(within(change, 'data-profile-change-conflict'), undefined);
    await h.attr('apply-inline').props.onClick(); await h.settle(); assert.equal(h.s.writes().length, 1, 'a warning never blocks Apply');
  } finally { h.unmount(); }
  // The user-script gate mirrors the worker: with both masters off a Custom row is stored inactive, so Apply stays available.
  const s = server(); s.value.earlyAccess = 'browser-toggle-required';
  const off = harness({ s, props: { view: 'device' } });
  try {
    off.render(); await off.settle(); slide(off, 'cpu', CPU_STEPS.indexOf(4)); await off.settle();
    assert.equal(off.attr('apply').props['aria-disabled'], false, 'nothing for the worker to refuse'); assert.equal(flat(off.attr('apply-reason')), '');
    external(off, next => { next.antidetectEnabled = true; }); await off.settle();
    assert.equal(off.attr('apply').props['aria-disabled'], true, 'with Antidetect on the same draft would be refused'); assert.equal(flat(off.attr('apply-reason')), words.reason_scripts);
  } finally { off.unmount(); }
});

test('Ctrl/Cmd+S applies only inside the panel with pending changes; leaving with a draft asks first; palette commands follow the draft', async () => {
  const listeners = new Map(), inner = {};
  const root = { addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type), contains: target => target === inner };
  const h = harness({ root, props: { view: 'device' } });
  const press = (target, extra = {}) => { const record = { prevented: false }; listeners.get('keydown')({ ctrlKey: true, key: 's', code: 'KeyS', target, preventDefault: () => { record.prevented = true; }, ...extra }); return record; };
  const leave = () => { const record = { prevented: false }; for (const fn of h.windowListeners.get('beforeunload') ?? []) fn({ preventDefault: () => { record.prevented = true; } }); return record; };
  const kinds = () => collectPaletteCommands().filter(command => command.source === 'fingerprint-profiles').map(command => command.kind);
  try {
    h.render(); await h.settle();
    assert.ok(listeners.has('keydown'), 'the shortcut is scoped to the panel root');
    assert.equal(press(inner).prevented, false, 'nothing to apply: the browser keeps its own Save'); assert.equal(leave().prevented, false, 'a clean panel never asks');
    assert.deepEqual(kinds(), ['randomize', 'export-profile']);
    slide(h, 'cpu', CPU_STEPS.indexOf(4)); await h.settle();
    assert.deepEqual(kinds(), ['randomize', 'apply-profile', 'export-profile'], 'Apply is offered only while it would be accepted');
    assert.equal(leave().prevented, true, 'a pending draft asks before leaving');
    assert.equal(press({}).prevented, false, 'focus outside the panel is not this editor'); assert.equal(h.s.writes().length, 0);
    assert.equal(press(inner).prevented, true, 'handled synchronously'); await h.settle();
    assert.equal(h.s.writes().length, 1); assert.equal(api(h.s.value.configuration, 'hardware-concurrency').selected.value, 4);
    assert.equal(leave().prevented, false); assert.deepEqual(kinds(), ['randomize', 'export-profile']);
    collectPaletteCommands().find(command => command.id === 'fingerprint-profiles:randomize:randomize').run(); await h.settle();
    assert.equal(h.s.writes().length, 1, 'Randomize from the palette only stages'); assert.ok(kinds().includes('apply-profile'));
    collectPaletteCommands().find(command => command.kind === 'apply-profile').run(); await h.settle(); assert.equal(h.s.writes().length, 2);
  } finally { h.unmount(); }
  assert.deepEqual(kinds(), [], 'the commands leave with the panel'); assert.equal(listeners.has('keydown'), false);
});

test('«Keep my changes» on a real conflict lays my rows onto the newer revision as a preview, conflicting rows first', async () => {
  const words = fingerprintDeviceLabels('en'), doc = fakeDocument(), h = harness({ doc, props: { view: 'device' } });
  try {
    // Mine: CPU (catalog row 41) and RAM (row 42). Theirs: RAM differently (a conflict) and the language (a row I did not touch).
    h.render(); await h.settle(); slide(h, 'cpu', CPU_STEPS.indexOf(12)); slide(h, 'ram', RAM_STEPS.indexOf(32)); await h.settle();
    external(h, next => { const memory = api(next, 'device-memory'); memory.mode = 'custom'; memory.selected = { kind: 'value', value: 4 }; const language = api(next, 'navigator-language'); language.mode = 'custom'; language.selected = { kind: 'value', value: 'fr-FR' }; });
    await h.settle();
    const bar = h.nodes(node => node.props['data-profile-bar'] === 'stale')[0]; assert.ok(bar, 'a real conflict');
    assert.equal(flat(h.attr('bar-keep')), words.keep_mine); assert.ok(h.attr('bar-discard'), 'next to Discard');
    await click(h, 'bar-keep');
    assert.equal(h.nodes(node => node.props['data-profile-bar'] === 'stale').length, 0); assert.equal(h.s.writes().length, 0, 'nothing written');
    h.update({ view: 'quick' }); await h.settle();
    const rows = h.nodes(node => typeof node.props['data-profile-change'] === 'string');
    assert.match(rows[0].props['data-profile-change'], /^global:device-memory:/u, 'the conflicting row comes first, before the earlier catalog row');
    assert.equal(rows[0].props['data-profile-change-conflict'], true); assert.equal(flat(within(rows[0], 'data-profile-change-conflict-mark')), words.change_conflict);
    const cores = rows.find(row => /^global:hardware-concurrency:/u.test(row.props['data-profile-change']));
    assert.ok(cores, 'my other change is still listed'); assert.equal(cores.props['data-profile-change-conflict'], undefined, 'without a conflict mark');
    assert.ok(!rows.some(row => /navigator-language:/u.test(row.props['data-profile-change'])), 'their row is part of the new base, not a change');
    await click(h, 'apply');
    assert.equal(h.s.writes().length, 1); assert.equal(h.s.writes()[0].expectedRevision, 8, 'written on the newer revision');
    assert.equal(api(h.s.value.configuration, 'hardware-concurrency').selected.value, 12, 'mine'); assert.notEqual(api(h.s.value.configuration, 'device-memory').selected.value, 4, 'mine wins the conflict');
    assert.equal(api(h.s.value.configuration, 'navigator-language').selected.value, 'fr-FR', 'theirs is kept');
  } finally { h.unmount(); }
});

test('the views holding unapplied changes are reported once per change, as one frozen array, and cleared when the panel goes', async () => {
  const reported = [], h = harness({ props: { view: 'device', onPendingLevels: views => reported.push(views) } });
  try {
    h.render(); await h.settle();
    assert.equal(reported.length, 1); assert.deepEqual(reported[0], []); assert.ok(Object.isFrozen(reported[0]));
    slide(h, 'cpu', CPU_STEPS.indexOf(4)); await h.settle();
    assert.deepEqual(reported.at(-1), ['quick', 'device']); const count = reported.length;
    slide(h, 'cpu', CPU_STEPS.indexOf(6)); await h.settle(); h.render();
    assert.equal(reported.length, count, 'the same set is not reported again');
    h.update({ view: 'os' }); await h.settle(); await typeInto(h, 'region', 'germany'); await pickRegion(h, 'DE');
    assert.deepEqual(reported.at(-1), ['quick', 'device', 'os']); assert.ok(Object.isFrozen(reported.at(-1)));
    await click(h, 'cancel'); assert.deepEqual(reported.at(-1), [], 'Cancel clears the marks'); assert.equal(reported.at(-1), reported[0], 'the same empty array');
    h.update({ view: 'device' }); await h.settle(); slide(h, 'cpu', CPU_STEPS.indexOf(4)); await h.settle(); assert.deepEqual(reported.at(-1), ['quick', 'device']);
  } finally { h.unmount(); }
  assert.deepEqual(reported.at(-1), [], 'the marks leave with the panel');
});

test('round-4 labels: complete in all 21 languages, runtime tokens kept, build-time tokens resolved, not English leftovers', () => {
  const KEYS = ['severity_warning', 'severity_info', 'value_browser', 'value_not_checked', 'source_real', 'source_region', 'source_custom', 'gpu_real_option', 'gpu_real_help', 'explain_claimed', 'explain_real', 'issue_show', 'issue_fix', 'issue_rows', 'retarget_button', 'fit_window_button', 'fit_window_note', 'fit_window_done', 'fit_window_failed', 'fix_staged', 'value_on', 'value_off', 'reason_no_changes', 'reason_scripts', 'reason_fields', 'reason_parent', 'change_before', 'change_after', 'change_conflict', 'keep_mine', 'keep_mine_done',
    'issue_memory_above_real', 'issue_language_timezone', 'issue_proxy_locale_host', 'issue_webgpu_missing', 'issue_real_gpu_software', 'issue_real_gpu_limits', 'issue_real_gpu_vendor', 'issue_real_gpu_webgpu', 'issue_storage_quota_shape', 'issue_plugins_pdf', 'issue_clock_precision_shape'];
  const TOKENS = { explain_claimed: ['{value}'], explain_real: ['{value}'], retarget_button: ['{version}'], fit_window_done: ['{width}', '{height}'], reason_fields: ['{count}'] };
  for (const key of KEYS) assert.ok(FINGERPRINT_DEVICE_KEYS.includes(key), key);
  assert.equal(Object.keys(FINGERPRINT_DEVICE_LABELS).length, 21);
  // The only round-4 strings that may equal English: «Real» is the same word in Spanish and Portuguese.
  const ALLOWED = { es: ['source_real'], pt_BR: ['source_real'] };
  for (const [language, table] of Object.entries(FINGERPRINT_DEVICE_LABELS)) {
    const same = [];
    for (const key of KEYS) {
      const text = table[key];
      assert.equal(typeof text, 'string', language + '.' + key); assert.ok(text.trim().length > 0 && text.length <= 512, language + '.' + key);
      for (const token of TOKENS[key] ?? []) assert.ok(text.includes(token), language + '.' + key + ' keeps ' + token);
      assert.doesNotMatch(text, /\{(?:auto|network|real)\}/u, language + '.' + key);
      if (language !== 'en' && text === FINGERPRINT_DEVICE_LABELS.en[key]) same.push(key);
    }
    assert.deepEqual(same, ALLOWED[language] ?? [], language + ': round-4 strings left in English');
    assert.ok(table.gpu_hint.includes(table.gpu_real_option), language + ': the GPU hint names the real-card option');
    assert.ok(table.disk_hint.includes('navigator.storage.estimate') && table.disk_hint.includes('10'), language + ': the disk hint explains the fixed Chrome quota');
  }
});
