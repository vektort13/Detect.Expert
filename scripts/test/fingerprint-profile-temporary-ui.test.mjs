// ADR-107 round 5 in the profile panel: temporary profiles (the banner in every view, "New temporary identity", "Apply temporarily", End and "Save to
// library"), the list of library changes in the preview (an import shows tags and notes before anything is written) and the proxy-country hint.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createFingerprintProfileUi } from '../../apps/production-extension/fingerprint-profile-ui.js';
import { createApiConfiguration, validateApiConfiguration, exportApiConfiguration, updateApiConfiguration } from '../../apps/production-extension/api-configuration.js';
import { storeFingerprintProfile } from '../../apps/production-extension/fingerprint-profiles.js';
import { TEMPORARY_KEY, TEMPORARY_LIVE_KEY } from '../../apps/production-extension/fingerprint-temporary.js';
import { fingerprintIdentityLabels } from '../../apps/production-extension/fingerprint-identity-labels.js';
import { fingerprintDeviceLabels } from '../../apps/production-extension/fingerprint-device-labels.js';
import { applyAntidetectCopy } from '../production-locales-antidetect.mjs';
import { applyFingerprintCopy } from '../production-locales-fingerprint.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';
import { device, fakeStorage, clone, turn, LF } from './fingerprint-identity-fixtures.mjs';
import { captureAnnouncements } from './fingerprint-library-harness.mjs';

const iw = fingerprintIdentityLabels('en'), dw = fingerprintDeviceLabels('en');
function messages(locale) { const language = PRODUCTION_LANGUAGES.find(item => item.id === locale); return applyFingerprintCopy(applyAntidetectCopy(JSON.parse(readFileSync(new URL('../../apps/production-extension/' + (language.uiOnly ? 'ui-locales' : '_locales') + '/' + locale + '/messages.json', import.meta.url))), locale), locale); }
function event() { const listeners = new Set(); return { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn), emit: (...args) => { for (const fn of listeners) fn(...args); } }; }
// The service worker as a CAS over one configuration; the browser storage has both areas (the temporary profile needs the session area).
function server({ configuration = createApiConfiguration(), session = true, local = {} } = {}) {
  const calls = [], value = { configuration, revision: 7 }, storage = fakeStorage({ local, session: session ? {} : null }), changed = event();
  storage.onChanged.addListener((changes, area) => changed.emit(changes, area));
  const snapshot = () => ({ schemaVersion: 1, type: 'api-config-state', configuration: clone(value.configuration), revision: value.revision, registration: 'inactive', reloadRequired: false, earlyAccess: 'ready' });
  const api = { runtime: { id: 'profile-fixture', getURL: path => 'chrome-extension://profile-fixture/' + path, sendMessage: async request => { calls.push(clone(request)); const intercepted = value.intercept?.(request); if (intercepted !== undefined) return intercepted;
    if (request.type === 'ui-api-config-set') { if (request.expectedRevision !== value.revision) return { schemaVersion: 1, type: 'api-config-error', code: 'stale-revision' }; const checked = validateApiConfiguration(request.configuration); assert.equal(checked.ok, true); value.configuration = checked.value; value.revision++; } return snapshot(); } },
    storage: { local: storage.local, ...(session ? { session: storage.session } : {}), onChanged: changed }, permissions: { onRemoved: event() }, tabs: { create: async () => ({}) } };
  return { api, calls, value, storage, changed, writes: () => calls.filter(call => call.type === 'ui-api-config-set') };
}
function harness({ s = server(), locale = 'en', props: initialProps = {}, proxy = null } = {}) {
  const previous = Object.fromEntries(['window', 'location', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const own = {}; own.top = own; Object.defineProperty(globalThis, 'window', { configurable: true, value: own }); Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: 'chrome-extension://profile-fixture/options.html#antidetect' } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153.0.0.0 Safari/537.36', appVersion: '5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32', vendor: 'Google Inc.', language: 'en-US', languages: ['en-US', 'en'], userAgentData: { brands: [{ brand: 'Chromium', version: '153' }], mobile: false, platform: 'Windows' } } });
  const slots = [], effects = [], table = messages(locale), applied = []; let cursor = 0, changed = true, tree, props = { active: true, onApplied: state => applied.push(state), ...initialProps };
  const hooks = { useState(initial) { const slot = slots[cursor++] ??= { value: initial }; return [slot.value, next => { const value = typeof next === 'function' ? next(slot.value) : next; if (!Object.is(slot.value, value)) { slot.value = value; changed = true; } }]; }, useRef(initial) { return (slots[cursor++] ??= { ref: { current: initial } }).ref; }, useEffect(fn, dependencies) { const slot = slots[cursor++] ??= {}; if (!slot.dependencies || dependencies.some((value, index) => !Object.is(value, slot.dependencies[index]))) { slot.dependencies = dependencies; effects.push(() => { slot.cleanup?.(); slot.cleanup = fn(); }); } } };
  const { FingerprintProfilePanel } = createFingerprintProfileUi({ ...hooks, h: (type, props) => ({ type, props }), useLocale: () => locale, translate: key => table[key]?.message ?? key, browserApi: s.api, ...(proxy ? { proxyFactory: () => proxy } : {}) });
  function render() { cursor = 0; changed = false; tree = FingerprintProfilePanel(props); while (effects.length) effects.shift()(); return tree; }
  async function settle() { for (let i = 0; i < 16; i++) { if (changed) render(); await turn(); } await new Promise(resolve => setTimeout(resolve, 30)); for (let i = 0; i < 8; i++) { if (changed) render(); await turn(); } if (changed) render(); }
  function nodes(predicate) { const results = []; function visit(node) { if (Array.isArray(node)) { node.forEach(visit); return; } if (!node?.props) return; if (predicate(node)) results.push(node); visit(node.props.children); } visit(tree); return results; }
  const attr = key => nodes(node => node.props['data-profile-' + key] === true)[0];
  return { s, applied, table, render, settle, nodes, attr, update(patch) { props = { ...props, ...patch }; changed = true; render(); }, unmount() { for (const slot of slots) slot?.cleanup?.(); for (const [key, descriptor] of Object.entries(previous)) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]; } };
}
function descend(node, predicate) { if (Array.isArray(node)) { for (const item of node) { const found = descend(item, predicate); if (found) return found; } return undefined; } if (!node?.props) return undefined; if (predicate(node)) return node; return descend(node.props.children, predicate); }
const text = node => { const parts = []; (function visit(item) { if (Array.isArray(item)) item.forEach(visit); else if (typeof item === 'string' || typeof item === 'number') parts.push(String(item)); else if (item?.props) visit(item.props.children); })(node); return parts.join('').replace(/\s+/gu, ' ').trim(); };
const click = async (h, node) => { assert.ok(node, 'the control exists'); await node.props.onClick(); await h.settle(); };
const banner = h => h.attr('temporary');
const rowsOf = configuration => configuration.apis.map(row => [row.id, row.mode, row.selected]);
const pid = number => 'fp-' + number.toString(16).padStart(32, '0');
const within = (node, key) => descend(node, child => child.props['data-profile-' + key] === true);

test('"New temporary identity" applies a fresh generated identity at once, remembers the previous rows, keeps it out of the library and shows the banner with End and Save to library', async () => {
  const s = server(), h = harness({ s }), heard = captureAnnouncements();
  try {
    h.render(); await h.settle(); const before = rowsOf(s.value.configuration);
    assert.equal(banner(h), undefined, 'no banner without a temporary profile'); const button = h.attr('temporary-new'); assert.ok(button); assert.equal(button.props['aria-disabled'], false); assert.equal(text(button), iw.tempNew);
    await click(h, button);
    assert.equal(s.writes().length, 1, 'one revision-checked write'); assert.notDeepEqual(rowsOf(s.value.configuration), before, 'the generated identity is applied'); assert.deepEqual(s.value.configuration.fingerprintProfiles, [], 'and it is NOT added to the library');
    assert.ok(banner(h)); assert.equal(text(h.attr('temporary-text')), 'Temporary profile active: Temporary identity. The previous settings return when you end it or restart the browser.');
    assert.equal(descend(h.attr('temporary-text'), node => node.type === 'bdi').props.children, 'Temporary identity', 'the name is isolated in <bdi>'); assert.equal(text(h.attr('temporary-keys')), iw.tempKeys);
    assert.ok(h.attr('temporary-end')); assert.ok(h.attr('temporary-save'), 'a generated identity can be saved explicitly');
    const record = s.storage.data.local[TEMPORARY_KEY]; assert.deepEqual(Object.keys(record), ['version', 'startedAt', 'label', 'previous']); assert.deepEqual(rowsOf({ apis: record.previous.apis }), before); assert.ok(s.storage.data.session[TEMPORARY_LIVE_KEY]);
    assert.equal(h.applied.length, 1, 'the parent view was told'); await heard.flush(); assert.match(heard.all(), /Temporary profile applied: “Temporary identity”\./u);
  } finally { heard.stop(); h.unmount(); }
});

test('End puts the remembered rows back and removes the banner and the record; the library and the masters set meanwhile stay', async () => {
  const s = server(), h = harness({ s }), heard = captureAnnouncements();
  try {
    h.render(); await h.settle(); const before = rowsOf(s.value.configuration);
    await click(h, h.attr('temporary-new')); assert.ok(banner(h));
    await click(h, h.attr('temporary-end'));
    assert.deepEqual(rowsOf(s.value.configuration), before, 'the earlier state is back'); assert.equal(banner(h), undefined); assert.equal(Object.hasOwn(s.storage.data.local, TEMPORARY_KEY), false); assert.equal(Object.hasOwn(s.storage.data.session, TEMPORARY_LIVE_KEY), false);
    assert.equal(s.writes().length, 2); await heard.flush(); assert.match(heard.all(), /Temporary profile ended\. The previous settings are back\./u);
    assert.ok(h.attr('temporary-new'), 'a new one can be started');
  } finally { heard.stop(); h.unmount(); }
});

test('a second temporary profile never stacks: ending returns to the very first state', async () => {
  const s = server(), h = harness({ s });
  try {
    h.render(); await h.settle(); const before = rowsOf(s.value.configuration);
    await click(h, h.attr('temporary-new')); const first = rowsOf(s.value.configuration); await click(h, h.attr('temporary-new')); assert.notDeepEqual(rowsOf(s.value.configuration), first, 'another identity');
    assert.equal(s.writes().length, 2); await click(h, h.attr('temporary-end')); assert.deepEqual(rowsOf(s.value.configuration), before);
  } finally { h.unmount(); }
});

test('"Apply temporarily" from the library applies the saved profile for this session without touching the library; a profile that is in the library needs no "Save to library"', async () => {
  const profile = device('Berlin exit', { id: pid(1), seed: 21, rows: { 'hardware-concurrency': 6 } }), s = server({ configuration: storeFingerprintProfile(createApiConfiguration(), profile) }), h = harness({ s });
  try {
    h.render(); await h.settle(); const before = rowsOf(s.value.configuration), library = clone(s.value.configuration.fingerprintProfiles);
    within(h.nodes(node => node.props['data-profile-row'] === profile.id)[0], 'pick').props.onClick(); await h.settle();
    await click(h, h.attr('peek-temporary'));
    assert.equal(s.value.configuration.apis.find(row => row.id === 'hardware-concurrency').selected.value, 6, 'the profile rows are applied'); assert.deepEqual(s.value.configuration.fingerprintProfiles, library, 'the library is exactly as it was');
    assert.ok(banner(h)); assert.equal(descend(h.attr('temporary-text'), node => node.type === 'bdi').props.children, 'Berlin exit'); assert.equal(h.attr('temporary-save'), undefined, 'the applied rows are a library profile already');
    await click(h, h.attr('temporary-end')); assert.deepEqual(rowsOf(s.value.configuration), before); assert.equal(banner(h), undefined);
  } finally { h.unmount(); }
});

test('"Save to library" stores the applied temporary rows as a new profile with the temporary name, and only then does the button go', async () => {
  const s = server(), h = harness({ s }), heard = captureAnnouncements();
  try {
    h.render(); await h.settle(); await click(h, h.attr('temporary-new')); const applied = rowsOf(s.value.configuration);
    await click(h, h.attr('temporary-save'));
    const stored = s.value.configuration.fingerprintProfiles; assert.equal(stored.length, 1); assert.equal(stored[0].label, 'Temporary identity'); assert.deepEqual(rowsOf({ apis: stored[0].apis }), applied, 'the applied rows'); assert.deepEqual(stored[0].tags, []); assert.equal(stored[0].note, '');
    assert.deepEqual(rowsOf(s.value.configuration), applied, 'the applied settings did not change'); assert.ok(banner(h), 'it is still temporary'); assert.equal(h.attr('temporary-save'), undefined, 'now it matches a library profile');
    await heard.flush(); assert.match(heard.all(), /Saved to the library: “Temporary identity”\./u);
  } finally { heard.stop(); h.unmount(); }
});

test('the banner shows in every view (quick setup, device, OS, browser) and a page opened later finds an active temporary profile', async () => {
  const s = server(), h = harness({ s });
  try {
    h.render(); await h.settle(); await click(h, h.attr('temporary-new'));
    for (const view of ['quick', 'device', 'os', 'browser']) { h.update({ view }); await h.settle(); assert.ok(banner(h), view); assert.ok(h.attr('temporary-end'), view); }
  } finally { h.unmount(); }
  const later = harness({ s });
  try { later.render(); await later.settle(); assert.ok(banner(later), 'the record is read when the page opens'); assert.equal(later.attr('temporary-text') !== undefined, true); } finally { later.unmount(); }
});

test('a temporary profile waits for pending changes: the buttons are aria-disabled with the reason, End as well, and nothing is written', async () => {
  const s = server(), h = harness({ s });
  try {
    h.render(); await h.settle(); await click(h, h.attr('generate')); assert.equal(h.attr('apply').props['aria-disabled'], false, 'there is a pending preview');
    const button = h.attr('temporary-new'); assert.equal(button.props['aria-disabled'], true); assert.equal(text(h.attr('temporary-new-reason')), iw.tempDirty); assert.equal(button.props['aria-describedby'], 'fp-temporary-new-reason');
    await click(h, button); assert.equal(s.writes().length, 0); assert.equal(banner(h), undefined);
    await click(h, h.attr('cancel')); assert.equal(h.attr('temporary-new').props['aria-disabled'], false); await click(h, h.attr('temporary-new')); assert.ok(banner(h));
    await click(h, h.attr('generate')); assert.equal(h.attr('temporary-end').props['aria-disabled'], true); assert.equal(text(h.attr('temporary-reason')), iw.tempDirty); const writes = s.writes().length;
    await click(h, h.attr('temporary-end')); assert.equal(s.writes().length, writes); assert.ok(banner(h), 'ending waits too');
  } finally { h.unmount(); }
});

test('a refused write shows the usual message, leaves no banner and no record; without session storage nothing of this is offered', async () => {
  const s = server(), h = harness({ s });
  try {
    h.render(); await h.settle(); s.value.intercept = request => request.type === 'ui-api-config-set' ? { schemaVersion: 1, type: 'api-config-error', code: 'early-access-required' } : undefined;
    await click(h, h.attr('temporary-new')); assert.ok(h.attr('error')); assert.equal(banner(h), undefined); assert.equal(Object.hasOwn(s.storage.data.local, TEMPORARY_KEY), false); assert.equal(Object.hasOwn(s.storage.data.session, TEMPORARY_LIVE_KEY), false);
  } finally { h.unmount(); }
  const bare = harness({ s: server({ session: false }) });
  try {
    bare.render(); await bare.settle(); assert.equal(bare.attr('temporary-new'), undefined); assert.equal(banner(bare), undefined);
    assert.ok(bare.attr('generate'), 'the rest of the panel is unchanged');
  } finally { bare.unmount(); }
});

// --- the library changes of the preview --------------------------------------------------------------------------------
const importFile = async (h, text) => { const file = { size: text.length, text: async () => text }, target = { files: [file], value: 'x' }; await h.attr('file').props.onChange({ currentTarget: target }); await h.settle(); };
const changesNode = h => h.nodes(node => node.props['data-profile-library-changes'] !== undefined)[0];
const changeEntries = h => h.nodes(node => node.props['data-profile-library-change'] !== undefined);

test('an import shows the profiles it would add, change or remove with their tags and a note excerpt, before anything is written', async () => {
  const kept = device('Kept', { id: pid(1) }), edited = device('Edited', { id: pid(2), tags: ['old'] }), removed = device('Removed', { id: pid(3) });
  let base = createApiConfiguration(); for (const profile of [kept, edited, removed]) base = storeFingerprintProfile(base, profile);
  const s = server({ configuration: base }), h = harness({ s });
  try {
    h.render(); await h.settle(); assert.equal(changesNode(h), undefined, 'no library change, no list');
    const incoming = clone(base); incoming.fingerprintProfiles = [clone(kept), { ...clone(edited), tags: ['b', 'a'], note: 'Edited note' }, { ...device('Brand new', { id: pid(4), tags: ['fresh', 'eu'], note: 'Line one' + LF + 'line two ' + 'x'.repeat(300) }) }];
    await importFile(h, exportApiConfiguration(incoming));
    assert.equal(s.writes().length, 0, 'nothing is written by an import'); const list = changesNode(h); assert.ok(list); assert.equal(list.props['data-profile-library-changes'], 3);
    const byKind = Object.fromEntries(changeEntries(h).map(node => [node.props['data-profile-library-change'], node])); assert.deepEqual(Object.keys(byKind).sort(), ['changed', 'new', 'removed']);
    assert.equal(byKind.new.props['data-profile-library-change-id'], pid(4)); assert.equal(descend(byKind.new, node => node.type === 'bdi' && node.props.class === 'fingerprint-library__name').props.children, 'Brand new');
    assert.deepEqual(descend(byKind.new, node => node.props['data-profile-library-change-tags'] === true).props.children.map(node => node.props.children), ['eu', 'fresh'], 'the new profile\'s tags (stored order)');
    const note = text(descend(byKind.new, node => node.props['data-profile-library-change-note'] === true)); assert.ok(note.startsWith('Line one'), note); assert.ok(note.endsWith('…') && Array.from(note).length <= 161, 'a long note is cut with an ellipsis');
    assert.deepEqual(descend(byKind.changed, node => node.props['data-profile-library-change-tags'] === true).props.children.map(node => node.props.children), ['a', 'b']); assert.equal(text(descend(byKind.changed, node => node.props['data-profile-library-change-note'] === true)), 'Edited note');
    assert.equal(descend(byKind.removed, node => node.props['data-profile-library-change-tags'] === true), undefined, 'no tag line without tags'); assert.deepEqual(['New', 'Changed', 'Removed'].map(word => text(list).includes(word)), [true, true, true]);
    await click(h, h.attr('cancel')); assert.equal(changesNode(h), undefined, 'cancelling the preview clears the list');
  } finally { h.unmount(); }
});

test('the list is bounded: twelve entries and "and N more"', async () => {
  const s = server(), h = harness({ s });
  try {
    h.render(); await h.settle();
    const incoming = clone(s.value.configuration); incoming.fingerprintProfiles = Array.from({ length: 20 }, (_, index) => device('Imported ' + index, { id: pid(index + 1) }));
    await importFile(h, exportApiConfiguration(incoming)); assert.equal(changeEntries(h).length, 12); assert.equal(changesNode(h).props['data-profile-library-changes'], 20); assert.match(text(changesNode(h)), /and 8 more/u);
  } finally { h.unmount(); }
});

// --- the proxy-country hint -------------------------------------------------------------------------------------------------
const proxyClient = (country, state = 'connected') => ({ load: async () => ({ configuration: { profiles: [{ id: 'proxy-de', name: 'Berlin exit', type: 'socks5', host: 'de.example', port: 1080, native: false, ...(country ? { country } : {}) }], protectWebRTC: false, disablePrediction: false }, status: { state, ...(state === 'connected' ? { profileId: 'proxy-de' } : {}) }, host: { available: false } }), dispose() {} });
const tokyo = () => { let config = createApiConfiguration(); for (const [id, value] of [['timezone', { timeZone: 'Asia/Tokyo', offsetMinutes: -540 }], ['navigator-language', 'ja-JP']]) config = updateApiConfiguration(config, id, { mode: 'custom', selected: { kind: 'value', value } }).value; return config; };

test('with a proxy connected and tagged Germany, Tokyo rows raise the hint with the country in the text and «Match region» stages the region rows as a preview', async () => {
  const s = server({ configuration: tokyo() }), h = harness({ s, proxy: proxyClient('DE') }), heard = captureAnnouncements();
  try {
    h.render(); await h.settle();
    const issue = h.nodes(node => node.props['data-profile-issue'] === 'proxy-country-region')[0]; assert.ok(issue, 'the hint is in the list');
    const message = descend(issue, node => node.props['data-profile-issue-message'] === true).props.children; assert.match(message, /\(DE\)/u); assert.match(message, /Germany/u); assert.doesNotMatch(message, /\{country\}/u); assert.match(message, /your own note/u);
    const fix = descend(issue, node => node.props['data-profile-issue-fix'] === 'proxy-country-region'); assert.ok(fix, 'a repair is offered'); assert.equal(fix.props.children, dw.issue_match_region); assert.equal(fix.props['aria-label'], dw.issue_match_region + ': ' + dw.region_label);
    await click(h, fix); assert.equal(s.writes().length, 0, 'a preview, never applied by itself');
    const draft = clone(s.value.configuration); void draft;
    assert.equal(h.attr('apply').props['aria-disabled'], false, 'there is something to apply now'); const staged = h.nodes(node => node.props['data-profile-change'] !== undefined).map(node => node.props['data-profile-change']);
    assert.ok(staged.some(entry => entry.includes('timezone')) && staged.some(entry => entry.includes('navigator-language')), staged.join(' '));
    assert.equal(h.nodes(node => node.props['data-profile-issue'] === 'proxy-country-region').length, 0, 'the hint is gone from the preview');
  } finally { heard.stop(); h.unmount(); }
});

test('the hint is silent for a matching country, an untagged proxy, a proxy that is not connected and no proxy at all', async () => {
  for (const [name, proxy] of [['matching', proxyClient('JP')], ['untagged', proxyClient(null)], ['disconnected', proxyClient('DE', 'off')], ['no proxy port', null]]) {
    const h = harness({ s: server({ configuration: tokyo() }), proxy });
    try { h.render(); await h.settle(); assert.equal(h.nodes(node => node.props['data-profile-issue'] === 'proxy-country-region').length, 0, name); } finally { h.unmount(); }
  }
});
