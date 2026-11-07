// ADR-107: the saved-profiles library — extraction, read-only Peek, one-Tab-stop keyboard, inline rename, Duplicate,
// Delete with Undo (CAS + stale check), row facts, fit hints, filters and search, empty states, the cookies line, palette
// and unsaved-rename guard, unsafe labels and the 21-language label table.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createFingerprintLibraryUi, restoreFingerprintProfile, duplicateFingerprintProfile, copyLabel, sanitizeLabel, shortGpuName, rendererName, profileProtection, profileFacts, profileFit, profileDifference, libraryKey, searchProfiles, foldText, fillTemplate, LIBRARY_UNDO_MS, LIBRARY_PALETTE_MAX, LIBRARY_FILTER_GROUPS, LIBRARY_FILTER_OPTIONS } from '../../apps/production-extension/fingerprint-library-ui.js';
import { FINGERPRINT_LIBRARY_KEYS, FINGERPRINT_LIBRARY_LABELS, fingerprintLibraryLabels, fingerprintLibraryPlural } from '../../apps/production-extension/fingerprint-library-labels.js';
import { createFingerprintProfileUi } from '../../apps/production-extension/fingerprint-profile-ui.js';
import { createApiConfiguration, validateApiConfiguration, updateApiConfiguration, apiLabelSafe, API_CONFIGURATION_MAX_PROFILES } from '../../apps/production-extension/api-configuration.js';
import { snapshotFingerprintProfile, storeFingerprintProfile, generateConsistentDevice } from '../../apps/production-extension/fingerprint-profiles.js';
import { GPU_PRESETS } from '../../apps/production-extension/fingerprint-device-presets.js';
import { fingerprintDeviceLabels } from '../../apps/production-extension/fingerprint-device-labels.js';
import { collectPaletteCommands } from '../../apps/production-extension/ui-shortcuts.js';
import { applyAntidetectCopy } from '../production-locales-antidetect.mjs';
import { applyFingerprintCopy } from '../production-locales-fingerprint.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';

const clone = value => structuredClone(value), turn = () => new Promise(resolve => setImmediate(resolve));
function messages(locale) { const language = PRODUCTION_LANGUAGES.find(item => item.id === locale); return applyFingerprintCopy(applyAntidetectCopy(JSON.parse(readFileSync(new URL('../../apps/production-extension/' + (language.uiOnly ? 'ui-locales' : '_locales') + '/' + locale + '/messages.json', import.meta.url))), locale), locale); }
const ENVIRONMENT = Object.freeze({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36', uaMajor: 153, brand: 'chrome', platform: 'windows', platformVersion: '19.0.0', hardwareConcurrency: 8 });
// A realistic saved profile from the real generator (seeded), optionally adjusted row by row.
function device(label, input = {}, rows = {}) {
  let configuration = generateConsistentDevice(createApiConfiguration(), { deviceType: 'desktop', os: 'windows-11', browser: 'chrome', version: 153, protection: 'balanced', seed: 7, ...input }, ENVIRONMENT).configuration;
  for (const [id, value] of Object.entries(rows)) configuration = updateApiConfiguration(configuration, id, { mode: 'custom', selected: { kind: 'value', value } }).value;
  return snapshotFingerprintProfile(configuration, label);
}
const text = node => { const parts = []; (function visit(item) { if (Array.isArray(item)) item.forEach(visit); else if (typeof item === 'string' || typeof item === 'number') parts.push(String(item)); else if (item?.props) visit(item.props.children); })(node); return parts.join(' '); };
function descend(node, predicate) { if (Array.isArray(node)) { for (const item of node) { const found = descend(item, predicate); if (found) return found; } return undefined; } if (!node?.props) return undefined; if (predicate(node)) return node; return descend(node.props.children, predicate); }
const keyEvent = (key, extra = {}) => ({ key, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, currentTarget: {}, ...extra });

// The library alone, with the panel's props simulated: a CAS-like commit, a preview stage, a fake clock and an idle queue.
function libraryHarness({ profiles = [], environment = ENVIRONMENT, locale: initialLocale = 'en', layout: initialLayout = 'wide', statuses = null, extra = {} } = {}) {
  let configuration = createApiConfiguration(); for (const profile of profiles) configuration = storeFingerprintProfile(configuration, profile);
  let locale = initialLocale, layout = initialLayout;
  const env = { saved: { configuration, environment, revision: 1, earlyAccess: 'ready' } }; env.draft = clone(configuration);
  const savedRef = { current: env.saved }, draftRef = { current: env.draft };
  const slots = [], effects = []; let cursor = 0, changed = true, tree;
  const hooks = { useState(initial) { const slot = slots[cursor++] ??= { value: initial }; return [slot.value, next => { const value = typeof next === 'function' ? next(slot.value) : next; if (!Object.is(slot.value, value)) { slot.value = value; changed = true; } }]; }, useRef(initial) { return (slots[cursor++] ??= { ref: { current: initial } }).ref; }, useEffect(fn, dependencies) { const slot = slots[cursor++] ??= {}; if (!slot.dependencies || dependencies.some((value, index) => !Object.is(value, slot.dependencies[index]))) { slot.dependencies = dependencies; effects.push(() => { slot.cleanup?.(); slot.cleanup = fn(); }); } } };
  const table = messages(locale), time = { now: 0, timers: [], next: 1 }, idle = [];
  const clock = { now: () => time.now, set: (task, ms) => { const id = time.next++; time.timers.push({ id, at: time.now + ms, task }); return id; }, clear: id => { time.timers = time.timers.filter(timer => timer.id !== id); } };
  const defer = task => { const entry = { task, cancelled: false }; idle.push(entry); return () => { entry.cancelled = true; }; };
  const log = { commits: [], staged: [], errors: [], randomize: 0, import: 0 }, state = { busy: false, locked: false, failNext: false, statuses };
  async function commit(next, retainPreview) {
    log.commits.push(clone(next)); await turn();
    if (state.failNext) { state.failNext = false; return false; }
    const checked = validateApiConfiguration(next); assert.ok(checked.ok, 'every library write is a valid configuration');
    env.saved = { ...env.saved, configuration: checked.value, revision: env.saved.revision + 1 }; savedRef.current = env.saved;
    env.draft = retainPreview ? { ...env.draft, fingerprintProfiles: clone(checked.value.fingerprintProfiles) } : clone(checked.value); draftRef.current = env.draft;
    changed = true; return true;
  }
  const stage = next => { env.draft = next; draftRef.current = next; log.staged.push(next); changed = true; };
  const { FingerprintLibrary } = createFingerprintLibraryUi({ ...hooks, h: (type, props) => ({ type, props }), useLocale: () => locale, translate: key => table[key]?.message ?? key, Icon: function Icon() { return null; }, clock, defer });
  function render() {
    // Like the panel, the refs follow the rendered state.
    cursor = 0; changed = false; savedRef.current = env.saved; draftRef.current = env.draft;
    tree = FingerprintLibrary({ visible: true, saved: env.saved, draft: env.draft, savedRef, draftRef, statuses: state.statuses ?? new Map(), busy: state.busy, locked: state.locked, dirty: false, commit, stage,
      setError: code => { log.errors.push(code); changed = true; }, safeError: failure => failure?.code ?? 'antidetect_failed', card: () => ({ type: 'section', props: { 'data-test-card': true } }),
      onRandomize: () => { log.randomize++; }, onImport: () => { log.import++; }, layout, ...extra });
    while (effects.length) effects.shift()(); return tree;
  }
  async function settle() { for (let index = 0; index < 10; index++) { if (changed) render(); await turn(); } if (changed) render(); }
  function nodes(predicate) { const results = []; (function visit(node) { if (Array.isArray(node)) { node.forEach(visit); return; } if (!node?.props) return; if (predicate(node)) results.push(node); visit(node.props.children); })(tree); return results; }
  const attr = key => nodes(node => node.props['data-profile-' + key] === true)[0];
  function advance(ms) { time.now += ms; for (;;) { const due = time.timers.filter(timer => timer.at <= time.now).sort((a, b) => a.at - b.at)[0]; if (!due) break; time.timers = time.timers.filter(timer => timer !== due); due.task(); } changed = true; render(); }
  function flushIdle() { while (idle.length) { const entry = idle.shift(); if (!entry.cancelled) entry.task({ timeRemaining: () => 50 }); } changed = true; render(); }
  function external(mutate) { const next = clone(env.saved.configuration); mutate(next); const checked = validateApiConfiguration(next); assert.ok(checked.ok); env.saved = { ...env.saved, configuration: checked.value, revision: env.saved.revision + 1 }; savedRef.current = env.saved; changed = true; render(); }
  return { env, log, state, time, idle, table, render, settle, nodes, attr, advance, flushIdle, external, get tree() { return tree; },
    setLocale(next) { locale = next; Object.assign(table, messages(next)); changed = true; render(); }, setLayout(next) { layout = next; changed = true; render(); }, unmount() { for (const slot of slots) slot?.cleanup?.(); } };
}
const rowOf = (h, id) => h.nodes(node => node.props['data-profile-row'] === id)[0];
const inRow = (h, id, key) => descend(rowOf(h, id), node => node.props['data-profile-' + key] === true);
const rowIds = h => h.attr('library').props.children.map(row => row.props['data-profile-row']);
const tabStops = h => h.nodes(node => typeof node.props['data-profile-focus'] === 'string' && node.props.tabIndex === 0).map(node => node.props['data-profile-focus']);
const peek = h => h.nodes(node => typeof node.props['data-profile-peek'] === 'string')[0];
const cellKey = async (h, id, col, key, extra) => { const node = h.nodes(item => item.props['data-profile-focus'] === id + ':' + col)[0]; const event = keyEvent(key, extra); node.props.onKeyDown(event); await h.settle(); return event; };

// --- Pure helpers -------------------------------------------------------------------------------------------------

test('restoreFingerprintProfile puts a deleted profile back at its old position and refuses instead of replacing', () => {
  const profiles = ['A', 'B', 'C'].map(label => device(label));
  let configuration = createApiConfiguration(); for (const profile of profiles) configuration = storeFingerprintProfile(configuration, profile);
  // The contract keeps the library in canonical id order, so the same id always returns to the same place.
  const order = configuration.fingerprintProfiles.map(profile => profile.id), middle = configuration.fingerprintProfiles[1];
  const without = { ...configuration, fingerprintProfiles: configuration.fingerprintProfiles.filter(profile => profile.id !== middle.id) }, frozen = JSON.stringify(without);
  const restored = restoreFingerprintProfile(without, middle, 1);
  assert.deepEqual(restored.fingerprintProfiles.map(profile => profile.id), order); assert.deepEqual(restored.fingerprintProfiles[1], middle);
  assert.equal(JSON.stringify(without), frozen, 'the input configuration is not mutated');
  for (const index of [99, -5, 0, undefined]) assert.deepEqual(restoreFingerprintProfile(without, middle, index).fingerprintProfiles.map(profile => profile.id), order, 'any index ends in the canonical place');
  assert.throws(() => restoreFingerprintProfile(configuration, middle, 1), { code: 'duplicate-profile' });
  assert.throws(() => restoreFingerprintProfile(without, { ...middle, label: middle.label + '\u202e' }, 1), { code: 'unsafe-label' });
  assert.throws(() => restoreFingerprintProfile(without, { ...middle, apis: [] }, 1), { code: 'invalid-profile' });
  assert.throws(() => restoreFingerprintProfile(without, null, 1), { code: 'invalid-profile' });
  const full = { ...configuration, fingerprintProfiles: Array.from({ length: API_CONFIGURATION_MAX_PROFILES }, (_, index) => ({ ...clone(profiles[0]), id: 'fp-' + index.toString(16).padStart(32, '0') })) };
  assert.throws(() => restoreFingerprintProfile(full, profiles[1], 0), { code: 'profile-limit' });
});

test('duplicateFingerprintProfile adds a copy with a new id and a numbered suffix through the library writer', () => {
  const source = device('Office desk');
  let configuration = storeFingerprintProfile(createApiConfiguration(), source);
  const first = duplicateFingerprintProfile(configuration, source.id, 'copy');
  assert.match(first.profile.id, /^fp-[a-f0-9]{32}$/u); assert.notEqual(first.profile.id, source.id); assert.equal(first.profile.label, 'Office desk (copy)');
  assert.deepEqual(first.profile.apis, source.apis); assert.equal(first.configuration.fingerprintProfiles.length, 2); assert.deepEqual(first.configuration.fingerprintProfiles.find(profile => profile.id === first.profile.id), first.profile);
  configuration = first.configuration;
  assert.equal(duplicateFingerprintProfile(configuration, source.id, 'copy').profile.label, 'Office desk (copy 2)');
  assert.throws(() => duplicateFingerprintProfile(configuration, 'fp-' + 'f'.repeat(32), 'copy'), { code: 'missing-profile' });
  const full = { ...configuration, fingerprintProfiles: Array.from({ length: API_CONFIGURATION_MAX_PROFILES }, (_, index) => ({ ...clone(source), id: 'fp-' + index.toString(16).padStart(32, '0'), label: 'P' + index })) };
  assert.throws(() => duplicateFingerprintProfile(full, full.fingerprintProfiles[0].id, 'copy'), { code: 'profile-limit' });
});

test('copy labels stay within 160 code units, never split a surrogate pair and drop characters the contract refuses', () => {
  const long = 'x'.repeat(150) + '😀😀😀😀😀', label = copyLabel(long, 'копия');
  assert.ok(label.length <= 160); assert.ok(label.endsWith(' (копия)')); assert.ok(apiLabelSafe(label));
  for (let index = 0; index < label.length; index++) { const code = label.charCodeAt(index); if (code >= 0xd800 && code <= 0xdbff) assert.ok(label.charCodeAt(index + 1) >= 0xdc00); }
  assert.equal(copyLabel('Evil\u202eName\u200f', 'copy'), 'EvilName (copy)');
  assert.equal(copyLabel('\u202e\u2066', 'copy'), '(copy)', 'a label of refused characters only keeps just the suffix');
  assert.equal(copyLabel('A', 'copy', ['A (copy)', 'A (copy 2)']), 'A (copy 3)');
  assert.equal(sanitizeLabel(' a\u0007b\u061c c\u2069 \u00a0d '), 'ab c d');
  for (const char of ['\u0000', '\u001f', '\u007f', '\u0085', '\u061c', '\u200e', '\u200f', '\u202a', '\u202e', '\u2066', '\u2069']) assert.equal(sanitizeLabel('a' + char + 'b'), 'ab', JSON.stringify(char));
  for (const char of ['\u00a0', 'é', '😀', 'ع', '中']) assert.equal(sanitizeLabel('a' + char + 'b'), ('a' + char + 'b').replace(/\s+/u, ' '), JSON.stringify(char));
});

test('short GPU names keep the model for every catalogue card; ANGLE renderers outside the catalogue are parsed', () => {
  const expected = { 'nvidia-rtx-3060': 'RTX 3060', 'nvidia-rtx-3050-laptop': 'RTX 3050 Laptop', 'amd-rx-580': 'RX 580', 'amd-rx-6700-xt': 'RX 6700 XT', 'amd-radeon-renoir': 'Radeon (Renoir)', 'intel-uhd-630': 'UHD 630', 'intel-hd-620': 'HD 620', 'intel-iris-xe-alder-lake': 'Iris Xe (Alder Lake)', 'intel-arc-a770': 'Arc A770', 'intel-arc-graphics': 'Arc (Meteor Lake)', 'intel-iris-plus': 'Iris Plus' };
  for (const card of GPU_PRESETS) {
    const name = shortGpuName(card.label); assert.ok(name && name.length <= 48, card.id); assert.doesNotMatch(name, /\b(?:GeForce|Graphics)\b/u, card.id);
    if (expected[card.id]) assert.equal(name, expected[card.id], card.id);
    assert.equal(rendererName(card.webgl.unmaskedRenderer), shortGpuName(card.webgl.unmaskedRenderer.match(/^ANGLE \([^,]*,\s*(.+?) \(0x/u)[1]), card.id);
  }
  assert.equal(rendererName('ANGLE (NVIDIA, NVIDIA GeForce RTX 2080 SUPER (0x00001E81) Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'RTX 2080 SUPER');
  assert.equal(rendererName('Mesa Intel(R) UHD Graphics 620 (KBL GT2)'), 'Mesa Intel UHD 620 (KBL GT2)');
  assert.equal(rendererName(''), null); assert.equal(shortGpuName(42), null); assert.ok(rendererName('A'.repeat(600)).length <= 48);
});

test('the preset shown for a profile follows the strongest Quick-setup preset whose rows it holds', () => {
  assert.equal(profileProtection(device('C', { protection: 'compatibility' })), 'compatibility');
  assert.equal(profileProtection(device('B', { protection: 'balanced' })), 'balanced');
  assert.equal(profileProtection(device('S', { protection: 'strict' })), 'strict');
  assert.equal(profileProtection(snapshotFingerprintProfile(createApiConfiguration(), 'Native')), 'none');
});

test('row facts read the saved profile: Windows version, browser major, card, screen, region and preset', () => {
  const profile = device('Berlin', { os: 'windows-10', browser: 'edge', version: 150, gpu: 'nvidia-rtx-3060', screen: '1920x1080', region: 'DE' });
  const facts = profileFacts(profile);
  assert.equal(facts.os, 'windows-10'); assert.equal(facts.browser, 'edge'); assert.equal(facts.major, 150); assert.equal(facts.gpuName, 'RTX 3060'); assert.equal(facts.gpuVendor, 'nvidia');
  assert.equal(facts.screen, '1920 × 1080'); assert.equal(facts.region, 'DE'); assert.equal(facts.protection, 'balanced'); assert.ok(facts.custom > 10);
  assert.equal(profileFacts(profile), facts, 'identity-cached');
  const native = profileFacts(snapshotFingerprintProfile(createApiConfiguration(), 'Native'));
  assert.deepEqual([native.os, native.browser, native.major, native.gpuName, native.screen, native.region, native.protection, native.custom], [null, null, null, null, null, null, 'none', 0]);
});

test('search folds accents, matches word starts across facts and falls back to substrings for CJK and digits', () => {
  const profiles = [device('México oficina', { region: 'MX', screen: '2560x1440', gpu: 'nvidia-rtx-3060' }), device('我的德国配置', { region: 'DE', gpu: 'amd-rx-6600', screen: '3840x2160' }), device('Ünïcode lab', { gpu: 'intel-uhd-630', screen: '1920x1080' })];
  const entries = profiles.map(profile => { const facts = profileFacts(profile), folded = foldText([profile.label, facts.gpuName, facts.screen, facts.screen?.replace(' × ', 'x'), facts.region].filter(Boolean).join(' ')); return { profile, text: folded, words: folded.split(/[^\p{L}\p{N}]+/u).filter(Boolean) }; });
  const labels = query => searchProfiles(entries, query).map(profile => profile.label);
  assert.deepEqual(labels('mexico'), ['México oficina']); assert.deepEqual(labels('UNICODE'), ['Ünïcode lab']);
  assert.deepEqual(labels('rx 66'), ['我的德国配置'], 'every word must start a fact word'); assert.deepEqual(labels('德国'), ['我的德国配置'], 'CJK falls back to substrings');
  assert.deepEqual(labels('1920x1080'), ['Ünïcode lab']); assert.deepEqual(labels('080'), ['Ünïcode lab'], 'digits inside a word use the substring fallback');
  assert.deepEqual(labels('   '), profiles.map(profile => profile.label)); assert.deepEqual(labels('nothing here'), []);
  assert.equal(searchProfiles(entries, 'x'.repeat(5000)).length, 0);
});

test('fit hints are memoised by content and environment, count only warnings and know when this browser was not read', () => {
  const base = createApiConfiguration(), fast = device('Fast', {}, { 'hardware-concurrency': 32 }), quiet = device('Quiet');
  const fit = profileFit(fast, base, ENVIRONMENT); assert.ok(fit.issues.some(issue => issue.code === 'cores-above-real' && issue.severity === 'warning')); assert.equal(fit.conflicts, fit.issues.filter(issue => issue.severity === 'warning').length); assert.equal(fit.checked, true);
  assert.equal(profileFit(fast, base, ENVIRONMENT), fit, 'the same profile reuses its result');
  assert.equal(profileFit(clone(fast), base, ENVIRONMENT), fit, 'an equal profile from a newer revision reuses it too');
  assert.equal(profileFit({ ...clone(fast), label: 'Renamed' }, base, ENVIRONMENT), fit, 'a rename does not change the fit');
  assert.equal(profileFit(quiet, base, ENVIRONMENT, { compute: false }), null, 'compute:false only reads the cache');
  const unchecked = profileFit(quiet, base, undefined); assert.equal(unchecked.checked, false, 'no snapshot of this browser means not checked');
  assert.notEqual(profileFit(quiet, base, { ...ENVIRONMENT, hardwareConcurrency: 64 }), unchecked);
});

test('the Peek difference counts the rows applying a profile would change, by the canonical diff', () => {
  const profile = device('Diff');
  const applied = { ...createApiConfiguration(), apis: createApiConfiguration().apis.map(row => ({ ...row, ...clone(profile.apis.find(item => item.id === row.id)) })), preset: profile.preset, webrtcNetworkPolicy: profile.webrtcNetworkPolicy };
  assert.equal(profileDifference(profile, validateApiConfiguration(applied).value), 0);
  const base = createApiConfiguration(), count = profileDifference(profile, base);
  assert.equal(count, profile.apis.filter(row => row.mode !== 'bypass' || row.selected.kind !== 'unset').length + (profile.preset !== base.preset ? 1 : 0) + (profile.webrtcNetworkPolicy !== base.webrtcNetworkPolicy ? 1 : 0));
  assert.equal(profileDifference(profile, base), count, 'memoised per base');
});

test('libraryKey changes with any id, content, label or order change and ignores object identity', () => {
  const a = device('A'), b = device('B'), key = libraryKey([a, b]);
  assert.equal(libraryKey([clone(a), clone(b)]), key); assert.notEqual(libraryKey([b, a]), key); assert.notEqual(libraryKey([{ ...a, label: 'A2' }, b]), key); assert.notEqual(libraryKey([a]), key);
  const changed = clone(a); changed.apis.find(row => row.id === 'hardware-concurrency').selected = { kind: 'value', value: 2 }; changed.apis.find(row => row.id === 'hardware-concurrency').mode = 'custom';
  assert.notEqual(libraryKey([changed, b]), key);
});

// --- Labels -------------------------------------------------------------------------------------------------------

test('library labels: 21 languages, the full key set, the same placeholders as English, valid plural forms, no refused characters', () => {
  assert.deepEqual(Object.keys(FINGERPRINT_LIBRARY_LABELS).sort(), PRODUCTION_LANGUAGES.map(language => language.id).sort());
  assert.equal(new Set(FINGERPRINT_LIBRARY_KEYS).size, FINGERPRINT_LIBRARY_KEYS.length);
  const placeholders = value => [...new Set([...String(value).matchAll(/\{(\w+)\}/gu)].map(match => match[1]))].sort().join(',');
  const plural = new Set(['conflicts', 'diffRows']), mayEqual = new Set(['filterOs', 'filterBrowser', 'filterPreset', 'filters', 'name', 'status', 'actions', 'other', 'peekLabel', 'duplicate', 'more']);
  for (const [locale, table] of Object.entries(FINGERPRINT_LIBRARY_LABELS)) {
    assert.deepEqual(Object.keys(table), [...FINGERPRINT_LIBRARY_KEYS], locale);
    let same = 0;
    for (const key of FINGERPRINT_LIBRARY_KEYS) {
      const value = table[key]; assert.ok(typeof value === 'string' && value.trim(), locale + '/' + key); assert.ok(apiLabelSafe(value), locale + '/' + key + ' has no control or bidi formatting characters');
      if (plural.has(key)) {
        const forms = value.split('|'); assert.ok(forms.every(form => /^(zero|one|two|few|many|other)=./su.test(form)), locale + '/' + key); assert.ok(forms.some(form => form.startsWith('other=')), locale + '/' + key + ' has other');
        for (const count of [1, 2, 3, 5, 11, 21, 100]) { const form = fingerprintLibraryPlural(locale, value, count); assert.ok(form.trim() && !form.includes('|') && !/^\w+=/u.test(form), locale + '/' + key + '/' + count); }
      } else assert.equal(placeholders(value), placeholders(FINGERPRINT_LIBRARY_LABELS.en[key]), locale + '/' + key);
      if (locale !== 'en' && value === FINGERPRINT_LIBRARY_LABELS.en[key] && !mayEqual.has(key)) same++;
    }
    if (locale !== 'en') assert.ok(same <= 2, locale + ': ' + same + ' strings are still English');
  }
  assert.equal(fingerprintLibraryLabels('pt-BR'), FINGERPRINT_LIBRARY_LABELS.pt_BR); assert.equal(fingerprintLibraryLabels('xx'), FINGERPRINT_LIBRARY_LABELS.en);
  const forms = n => fingerprintLibraryPlural('ru', FINGERPRINT_LIBRARY_LABELS.ru.conflicts, n).replace('{n}', n);
  assert.deepEqual([1, 2, 5, 11, 21, 22].map(forms), ['1 конфликт', '2 конфликта', '5 конфликтов', '11 конфликтов', '21 конфликт', '22 конфликта']);
  assert.equal(fingerprintLibraryPlural('ar', FINGERPRINT_LIBRARY_LABELS.ar.conflicts, 2), 'تعارضان'); assert.equal(fingerprintLibraryPlural('en', FINGERPRINT_LIBRARY_LABELS.en.diffRows, 1), 'Differs from the applied settings in {n} row');
  assert.equal(fingerprintLibraryPlural('ja', FINGERPRINT_LIBRARY_LABELS.ja.conflicts, 1), '{n} 件の矛盾'); assert.equal(fingerprintLibraryPlural('en', 'plain', 3), 'plain');
  assert.equal(fillTemplate('{a} {b} {a} {c}', { a: 1, b: 'x' }), '1 x 1 {c}');
});

// --- Component: rows, Peek and keyboard ---------------------------------------------------------------------------

test('rows show facts instead of navigator.platform, a version chip only when the major differs, and labels inside <bdi>', async () => {
  const same = device('Same major', { version: 153, gpu: 'nvidia-rtx-3060', screen: '2560x1440', region: 'DE' }), older = device('Older major', { version: 150, browser: 'edge', os: 'windows-10' });
  const h = libraryHarness({ profiles: [same, older] });
  try {
    h.render(); await h.settle();
    const meta = id => text(descend(rowOf(h, id), node => node.props['data-profile-facts'] === true));
    assert.match(meta(same.id), /Windows 11/u); assert.match(meta(same.id), /Chrome 153/u); assert.match(meta(same.id), /RTX 3060/u); assert.match(meta(same.id), /2560 × 1440/u); assert.match(meta(same.id), /Germany/u); assert.match(meta(same.id), /Balanced/u);
    assert.doesNotMatch(meta(same.id) + meta(older.id), /Win32/u);
    assert.equal(descend(rowOf(h, same.id), node => node.props['data-profile-version-chip'] !== undefined), undefined, 'no chip for the real major');
    const chip = descend(rowOf(h, older.id), node => node.props['data-profile-version-chip'] !== undefined); assert.equal(chip.props['data-profile-version-chip'], 150); assert.match(text(chip), /Edge 150/u); assert.match(chip.props.title, /153/u);
    const name = descend(rowOf(h, same.id), node => node.props.class === 'fingerprint-row__name'); assert.equal(name.type, 'bdi'); assert.equal(name.props.children, 'Same major');
    h.env.saved = { ...h.env.saved, environment: undefined }; h.render(); await h.settle();
    assert.equal(descend(rowOf(h, older.id), node => node.props['data-profile-version-chip'] !== undefined), undefined, 'without the real major there is nothing to compare');
  } finally { h.unmount(); }
});

test('Enter or click opens a read-only Peek in the device-card slot; it never writes and Esc returns to the row', async () => {
  const profile = device('Peek me', { gpu: 'intel-uhd-630', region: 'FR' }), other = device('Other');
  const h = libraryHarness({ profiles: [profile, other], statuses: new Map([[profile.id, 'applied']]) });
  try {
    h.render(); await h.settle();
    assert.equal(h.tree[0].props['data-test-card'], true, 'the slot shows the device card while nothing is peeked');
    const before = clone(h.env.draft);
    inRow(h, profile.id, 'pick').props.onClick(); await h.settle();
    const node = peek(h); assert.equal(node.props['data-profile-peek'], profile.id); assert.equal(node.props['data-profile-peek-placement'], 'card'); assert.equal(h.tree[0], node, 'the Peek takes the card slot');
    assert.equal(inRow(h, profile.id, 'pick').props['aria-expanded'], true); assert.equal(inRow(h, profile.id, 'pick').props['aria-controls'], node.props.id); assert.equal(rowOf(h, profile.id).props['aria-selected'], true);
    assert.equal(descend(node, item => item.type === 'h4').props.children.type, 'bdi');
    assert.equal(descend(node, item => item.props['data-profile-status']).props['data-profile-status'], 'applied');
    const facts = Object.fromEntries(h.nodes(item => item.props['data-profile-peek-fact']).map(item => [item.props['data-profile-peek-fact'], text(item)]));
    assert.match(facts.os, /Windows 11/u); assert.match(facts.gpu, /UHD Graphics 630/u); assert.match(facts.region, /France/u); assert.ok(facts.cpu && facts.ram && facts.screen && facts.timezone && facts.custom);
    assert.ok(Number(h.attr('peek-facts') ? 1 : 1)); assert.ok(Number.isInteger(h.nodes(item => item.props['data-profile-peek-diff'] !== undefined)[0].props['data-profile-peek-diff']));
    assert.ok(['issues', 'none', 'unchecked'].includes(h.nodes(item => item.props['data-profile-peek-hints'])[0].props['data-profile-peek-hints']));
    assert.equal(h.log.commits.length, 0, 'opening the Peek never writes'); assert.deepEqual(h.env.draft, before, 'nor stages anything');
    const event = keyEvent('Escape'); node.props.onKeyDown(event); await h.settle();
    assert.equal(event.defaultPrevented, true); assert.equal(peek(h), undefined); assert.equal(h.tree[0].props['data-test-card'], true); assert.deepEqual(tabStops(h), [profile.id + ':0'], 'focus goes back to the row');
    await cellKey(h, other.id, 0, 'ArrowDown'); inRow(h, other.id, 'pick').props.onClick(); await h.settle(); assert.equal(peek(h).props['data-profile-peek'], other.id);
    inRow(h, other.id, 'pick').props.onClick(); await h.settle(); assert.equal(peek(h), undefined, 'a second click closes it');
    assert.equal(h.log.commits.length, 0);
  } finally { h.unmount(); }
});

test('the Peek shows the difference from the applied settings and its hints in three states', async () => {
  const fast = device('Fast', {}, { 'hardware-concurrency': 32 }), calm = device('Calm');
  const h = libraryHarness({ profiles: [fast, calm] });
  try {
    h.render(); await h.settle();
    inRow(h, fast.id, 'pick').props.onClick(); await h.settle();
    const hints = () => h.nodes(item => item.props['data-profile-peek-hints'])[0];
    assert.equal(hints().props['data-profile-peek-hints'], 'issues'); assert.ok(h.nodes(item => item.props['data-profile-peek-issue'] === 'cores-above-real').length);
    const diff = h.nodes(item => item.props['data-profile-peek-diff'] !== undefined)[0]; assert.ok(diff.props['data-profile-peek-diff'] > 1); assert.match(text(diff), new RegExp('in ' + diff.props['data-profile-peek-diff'] + ' rows'));
    inRow(h, calm.id, 'pick').props.onClick(); await h.settle();
    assert.equal(hints().props['data-profile-peek-hints'], 'none'); assert.equal(h.nodes(item => item.props['data-profile-peek-hint-state'] === 'none')[0].props.children, FINGERPRINT_LIBRARY_LABELS.en.hintsNone);
    h.env.saved = { ...h.env.saved, environment: undefined }; h.render(); await h.settle();
    assert.equal(hints().props['data-profile-peek-hints'], 'unchecked'); assert.equal(h.nodes(item => item.props['data-profile-peek-hint-state'] === 'unchecked')[0].props.children, FINGERPRINT_LIBRARY_LABELS.en.notChecked);
    // A profile equal to the applied settings says so.
    h.external(next => { next.apis = next.apis.map(row => ({ ...row, ...clone(calm.apis.find(item => item.id === row.id)) })); next.preset = calm.preset; next.webrtcNetworkPolicy = calm.webrtcNetworkPolicy; }); await h.settle();
    const same = h.nodes(item => item.props['data-profile-peek-diff'] !== undefined)[0]; assert.equal(same.props['data-profile-peek-diff'], 0); assert.equal(same.props.children, FINGERPRINT_LIBRARY_LABELS.en.diffNone);
    assert.equal(h.log.commits.length, 0);
  } finally { h.unmount(); }
});

test('in a narrow container the Peek opens under its row and the card slot keeps the device card', async () => {
  const profile = device('Narrow');
  const h = libraryHarness({ profiles: [profile], layout: 'narrow' });
  try {
    h.render(); await h.settle(); inRow(h, profile.id, 'pick').props.onClick(); await h.settle();
    assert.equal(h.tree[0].props['data-test-card'], true);
    const cell = descend(rowOf(h, profile.id), node => node.props.class === 'fingerprint-row__peek'); assert.equal(cell.props.role, 'gridcell'); assert.equal(cell.props['aria-colspan'], 3);
    assert.equal(descend(cell, node => typeof node.props['data-profile-peek'] === 'string').props['data-profile-peek-placement'], 'row');
    h.setLayout('wide'); await h.settle(); assert.equal(descend(rowOf(h, profile.id), node => node.props.class === 'fingerprint-row__peek'), undefined); assert.equal(h.tree[0].props['data-profile-peek'], profile.id);
  } finally { h.unmount(); }
});

test('the list is one Tab stop: arrows, Home and End move between rows and buttons, mirrored in RTL, skipping disabled buttons', async () => {
  const profiles = ['One', 'Two', 'Three'].map(label => device(label));
  const h = libraryHarness({ profiles }), computed = globalThis.getComputedStyle;
  try {
    h.render(); await h.settle(); const [a, b, c] = rowIds(h);
    assert.deepEqual(tabStops(h), [a + ':0']); assert.equal(h.attr('library').props.role, 'grid'); assert.equal(rowOf(h, a).props.role, 'row');
    let event = await cellKey(h, a, 0, 'ArrowDown'); assert.equal(event.defaultPrevented, true); assert.deepEqual(tabStops(h), [b + ':0']);
    await cellKey(h, b, 0, 'End'); assert.deepEqual(tabStops(h), [c + ':0']);
    await cellKey(h, c, 0, 'ArrowDown'); assert.deepEqual(tabStops(h), [c + ':0'], 'no wrap past the last row');
    await cellKey(h, c, 0, 'Home'); assert.deepEqual(tabStops(h), [a + ':0']);
    await cellKey(h, a, 0, 'ArrowRight'); assert.deepEqual(tabStops(h), [a + ':1']);
    await cellKey(h, a, 1, 'ArrowRight'); await cellKey(h, a, 2, 'ArrowRight'); assert.deepEqual(tabStops(h), [a + ':3']);
    await cellKey(h, a, 3, 'ArrowRight'); assert.deepEqual(tabStops(h), [a + ':3'], 'no wrap past the last button');
    await cellKey(h, a, 3, 'ArrowDown'); assert.deepEqual(tabStops(h), [b + ':3'], 'the column is kept between rows');
    await cellKey(h, b, 3, 'ArrowUp'); await cellKey(h, a, 3, 'ArrowLeft'); assert.deepEqual(tabStops(h), [a + ':2']);
    globalThis.getComputedStyle = () => ({ direction: 'rtl' });
    await cellKey(h, a, 2, 'ArrowLeft'); assert.deepEqual(tabStops(h), [a + ':3'], 'ArrowLeft moves forward in RTL');
    await cellKey(h, a, 3, 'ArrowRight'); await cellKey(h, a, 2, 'ArrowRight'); assert.deepEqual(tabStops(h), [a + ':1']);
    globalThis.getComputedStyle = computed;
    h.state.locked = true; h.render(); await h.settle();
    await cellKey(h, a, 1, 'ArrowRight'); assert.deepEqual(tabStops(h), [a + ':1'], 'rename and delete are skipped while locked');
    event = await cellKey(h, a, 1, 'ArrowDown', { altKey: true }); assert.equal(event.defaultPrevented, false, 'modified keys are left to the browser');
    assert.equal(h.log.commits.length, 0);
  } finally { globalThis.getComputedStyle = computed; h.unmount(); }
});

test('F2 renames inline with its own text: Enter saves once, Escape cancels, unchanged and empty names never write', async () => {
  const profile = device('Before'), other = device('Other');
  const h = libraryHarness({ profiles: [profile, other] });
  try {
    h.render(); await h.settle();
    h.attr('name').props.onInput({ currentTarget: { value: 'Typed for saving' } }); await h.settle();
    await cellKey(h, profile.id, 0, 'F2');
    const field = () => h.attr('rename-input');
    assert.equal(field().props.value, 'Before'); assert.equal(h.attr('name').props.value, 'Typed for saving', 'the Save-as field keeps its own text');
    assert.equal(inRow(h, profile.id, 'pick'), undefined, 'the editor replaces the row button');
    let event = keyEvent('Escape'); field().props.onKeyDown(event); await h.settle(); assert.equal(field(), undefined); assert.equal(h.log.commits.length, 0); assert.deepEqual(tabStops(h), [profile.id + ':0']);
    inRow(h, profile.id, 'rename').props.onClick(); await h.settle(); field().props.onKeyDown(keyEvent('Enter')); await h.settle(); assert.equal(h.log.commits.length, 0, 'an unchanged name is not written'); assert.equal(field(), undefined);
    inRow(h, profile.id, 'rename').props.onClick(); await h.settle(); field().props.onInput({ currentTarget: { value: '   ' } }); await h.settle(); field().props.onKeyDown(keyEvent('Enter')); await h.settle();
    assert.equal(h.log.commits.length, 0); assert.deepEqual(h.log.errors, ['antidetect_editor_nameRequired']);
    field().props.onInput({ currentTarget: { value: 'After' } }); await h.settle(); event = keyEvent('Enter'); field().props.onKeyDown(event); await h.settle();
    assert.equal(event.defaultPrevented, true); assert.equal(h.log.commits.length, 1); assert.deepEqual(h.env.saved.configuration.fingerprintProfiles.map(item => item.label).sort(), ['After', 'Other']); assert.equal(field(), undefined);
    assert.equal(h.env.saved.configuration.fingerprintProfiles.find(item => item.id === profile.id).label, 'After');
    assert.equal(h.attr('name').props.value, 'Typed for saving');
  } finally { h.unmount(); }
});

test('control and bidi characters are refused for new names with an inline message; stored ones still render in <bdi>', async () => {
  const stored = { ...device('Stored'), label: 'Evil\u202eName' }, h = libraryHarness({ profiles: [] });
  try {
    h.env.saved = { ...h.env.saved, configuration: { ...h.env.saved.configuration, fingerprintProfiles: [stored] } }; h.render(); await h.settle();
    const name = descend(rowOf(h, stored.id), node => node.props.class === 'fingerprint-row__name'); assert.equal(name.type, 'bdi'); assert.equal(name.props.children, 'Evil\u202eName');
    assert.doesNotMatch(inRow(h, stored.id, 'delete').props['aria-label'], /\u202e/u, 'attribute text is cleaned');
    await cellKey(h, stored.id, 0, 'F2'); assert.equal(h.attr('rename-input').props.value, 'EvilName', 'the editor starts from the visible text');
    h.attr('rename-input').props.onInput({ currentTarget: { value: 'New\u2066name' } }); await h.settle(); h.attr('rename-input').props.onKeyDown(keyEvent('Enter')); await h.settle();
    assert.equal(h.log.commits.length, 0); assert.equal(h.attr('rename-error').props.children, FINGERPRINT_LIBRARY_LABELS.en.unsafeLabel); assert.equal(h.attr('rename-input').props['aria-invalid'], true);
    h.attr('rename-input').props.onInput({ currentTarget: { value: 'EvilName' } }); await h.settle(); assert.equal(h.attr('rename-error'), undefined, 'typing clears the message');
    h.attr('rename-input').props.onKeyDown(keyEvent('Enter')); await h.settle(); assert.equal(h.log.commits.length, 1); assert.equal(h.env.saved.configuration.fingerprintProfiles[0].label, 'EvilName', 'saving the shown text cleans the stored label');
    h.attr('name').props.onInput({ currentTarget: { value: 'Bad\u200fname' } }); await h.settle(); await h.attr('save-named').props.onClick(); await h.settle();
    assert.equal(h.log.commits.length, 1); assert.equal(h.attr('name-error').props.children, FINGERPRINT_LIBRARY_LABELS.en.unsafeLabel); assert.equal(h.attr('name').props['aria-invalid'], true);
    h.attr('name').props.onInput({ currentTarget: { value: 'Good name' } }); await h.settle(); h.attr('name').props.onKeyDown(keyEvent('Enter')); await h.settle();
    assert.equal(h.log.commits.length, 2); assert.deepEqual(h.env.saved.configuration.fingerprintProfiles.map(entry => entry.label).sort(), ['EvilName', 'Good name']); assert.equal(h.attr('name').props.value, '', 'the Save-as field is cleared after saving');
    for (const locale of Object.keys(FINGERPRINT_LIBRARY_LABELS)) assert.ok(fingerprintLibraryLabels(locale).unsafeLabel.trim(), locale);
  } finally { h.unmount(); }
});

test('Delete commits at once, focus moves to the next row, and Undo restores the same profile at its old position', async () => {
  const profiles = ['A', 'B', 'C'].map(label => device(label));
  const h = libraryHarness({ profiles });
  try {
    h.render(); await h.settle(); const [a, b, c] = rowIds(h), deleted = clone(h.env.saved.configuration.fingerprintProfiles[1]);
    inRow(h, b, 'pick').props.onClick(); await h.settle();
    await cellKey(h, b, 0, 'Delete');
    assert.equal(h.log.commits.length, 1); assert.deepEqual(rowIds(h), [a, c]); assert.deepEqual(tabStops(h), [c + ':0'], 'focus moves to the next row');
    assert.equal(peek(h), undefined, 'the Peek of a deleted profile closes');
    const line = h.nodes(node => node.props['data-profile-undo'] === b)[0]; assert.ok(line); assert.equal(descend(line, node => node.type === 'bdi').props.children, deleted.label);
    await cellKey(h, c, 0, 'z', { ctrlKey: true });
    assert.equal(h.log.commits.length, 2); assert.deepEqual(h.env.saved.configuration.fingerprintProfiles.map(profile => profile.id), [a, b, c]); assert.deepEqual(h.env.saved.configuration.fingerprintProfiles[1], deleted);
    assert.equal(h.nodes(node => node.props['data-profile-undo']).length, 0); assert.deepEqual(tabStops(h), [b + ':0']);
    // The last row falls back to the previous one, then to the search field.
    await cellKey(h, c, 0, 'Delete'); assert.deepEqual(tabStops(h), [b + ':0']);
    h.attr('undo-button').props.onClick(); await h.settle(); assert.deepEqual(rowIds(h), [a, b, c]);
    const single = libraryHarness({ profiles: [device('Only')] }); try { single.render(); await single.settle(); const only = rowIds(single)[0]; await cellKey(single, only, 0, 'Delete'); assert.deepEqual(rowIds(single), []); assert.ok(single.nodes(node => node.props['data-profile-empty'] === 'library').length); } finally { single.unmount(); }
  } finally { h.unmount(); }
});

test('the Undo line lasts eight seconds of unhovered, unfocused time', async () => {
  const profiles = ['A', 'B'].map(label => device(label)), h = libraryHarness({ profiles });
  try {
    h.render(); await h.settle(); inRow(h, profiles[0].id, 'delete').props.onClick(); await h.settle();
    const line = () => h.nodes(node => typeof node.props['data-profile-undo'] === 'string')[0];
    h.advance(LIBRARY_UNDO_MS - 1000); assert.ok(line());
    line().props.onMouseEnter(); h.advance(5000); assert.ok(line(), 'hovering pauses the countdown'); assert.match(line().props.class, /is-paused/u);
    line().props.onFocusIn(); line().props.onMouseLeave(); h.advance(5000); assert.ok(line(), 'focus inside keeps it paused');
    line().props.onFocusOut({ currentTarget: { contains: () => false }, relatedTarget: null }); h.advance(900); assert.ok(line());
    h.advance(200); assert.equal(line(), undefined, 'the remaining second runs out after hover and focus leave');
    await cellKey(h, profiles[1].id, 0, 'z', { metaKey: true }); assert.equal(h.log.commits.length, 1, 'Cmd/Ctrl+Z does nothing once the line is gone');
  } finally { h.unmount(); }
});

test('Undo never re-inserts blindly: a library changed since the deletion keeps the newer state and says why', async () => {
  const profiles = ['A', 'B', 'C'].map(label => device(label)), h = libraryHarness({ profiles });
  try {
    h.render(); await h.settle(); inRow(h, profiles[0].id, 'delete').props.onClick(); await h.settle();
    h.external(next => { next.fingerprintProfiles.find(profile => profile.id === profiles[2].id).label = 'C from another window'; }); await h.settle();
    const labels = () => h.env.saved.configuration.fingerprintProfiles.map(profile => profile.label).sort();
    h.attr('undo-button').props.onClick(); await h.settle();
    assert.equal(h.log.commits.length, 1, 'no restore write'); assert.deepEqual(labels(), ['B', 'C from another window']);
    assert.equal(h.nodes(node => node.props['data-profile-library-notice'] === 'stale')[0].props.children, FINGERPRINT_LIBRARY_LABELS.en.undoStale);
    assert.equal(h.attr('undo-button'), undefined, 'the stale Undo is gone'); h.advance(LIBRARY_UNDO_MS); assert.equal(h.nodes(node => node.props['data-profile-library-notice']).length, 0, 'the message leaves after the same time');
    // A newer revision that leaves the library alone (for example the master switch) does not block the restore.
    inRow(h, profiles[1].id, 'delete').props.onClick(); await h.settle(); h.external(next => { next.antidetectEnabled = !next.antidetectEnabled; }); await h.settle();
    h.attr('undo-button').props.onClick(); await h.settle(); assert.equal(h.log.commits.length, 3); assert.deepEqual(labels(), ['B', 'C from another window']);
    // A failed restore write (stale CAS in the panel) keeps the Undo line for another try.
    inRow(h, profiles[1].id, 'delete').props.onClick(); await h.settle(); h.state.failNext = true; h.attr('undo-button').props.onClick(); await h.settle();
    assert.ok(h.attr('undo-button')); assert.deepEqual(labels(), ['C from another window']);
    h.attr('undo-button').props.onClick(); await h.settle(); assert.deepEqual(labels(), ['B', 'C from another window'], 'the retry restores');
  } finally { h.unmount(); }
});

test('the Peek menu renames, duplicates with a suffix, deletes and closes; Duplicate is off at 128 profiles', async () => {
  const profile = device('Menu'), h = libraryHarness({ profiles: [profile] });
  try {
    h.render(); await h.settle(); inRow(h, profile.id, 'pick').props.onClick(); await h.settle();
    const button = () => h.attr('peek-menu'); assert.equal(button().props['aria-haspopup'], 'menu'); assert.equal(button().props['aria-expanded'], false); assert.match(button().props['aria-label'], /Menu/u);
    button().props.onClick(); await h.settle(); assert.equal(button().props['aria-expanded'], true); assert.equal(h.attr('peek-menu-list').props.role, 'menu');
    const item = key => h.nodes(node => node.props['data-profile-menu-item'] === key)[0];
    assert.deepEqual(h.attr('peek-menu-list').props.children.map(node => [node.props['data-profile-menu-item'], node.props.role]), [['rename', 'menuitem'], ['duplicate', 'menuitem'], ['delete', 'menuitem'], ['close', 'menuitem']]);
    const escape = keyEvent('Escape'); let stopped = false; escape.stopPropagation = () => { stopped = true; }; h.attr('peek-menu-list').props.onKeyDown(escape); await h.settle();
    assert.equal(button().props['aria-expanded'], false); assert.ok(stopped, 'Escape closes only the menu'); assert.ok(peek(h));
    button().props.onClick(); await h.settle(); item('duplicate').props.onClick(); await h.settle();
    const labels = () => h.env.saved.configuration.fingerprintProfiles.map(entry => entry.label).sort();
    assert.equal(h.log.commits.length, 1); assert.deepEqual(labels(), ['Menu', 'Menu (copy)']);
    button().props.onClick(); await h.settle(); item('duplicate').props.onClick(); await h.settle(); assert.deepEqual(labels(), ['Menu', 'Menu (copy 2)', 'Menu (copy)']);
    assert.ok(h.env.saved.configuration.fingerprintProfiles.filter(entry => entry.id !== profile.id).every(entry => JSON.stringify(entry.apis) === JSON.stringify(profile.apis)), 'copies keep every row');
    button().props.onClick(); await h.settle(); item('rename').props.onClick(); await h.settle(); assert.equal(h.attr('rename-input').props.value, 'Menu'); h.attr('rename-cancel').props.onClick(); await h.settle();
    button().props.onClick(); await h.settle(); item('close').props.onClick(); await h.settle(); assert.equal(peek(h), undefined);
    inRow(h, profile.id, 'pick').props.onClick(); await h.settle(); button().props.onClick(); await h.settle(); item('delete').props.onClick(); await h.settle();
    assert.equal(h.env.saved.configuration.fingerprintProfiles.length, 2); assert.equal(peek(h), undefined);
    h.external(next => { next.fingerprintProfiles = Array.from({ length: API_CONFIGURATION_MAX_PROFILES }, (_, index) => ({ ...clone(profile), id: 'fp-' + index.toString(16).padStart(32, '0'), label: 'P' + index })); }); await h.settle();
    inRow(h, 'fp-' + '0'.repeat(32), 'pick').props.onClick(); await h.settle(); button().props.onClick(); await h.settle(); assert.equal(item('duplicate').props.disabled, true);
  } finally { h.unmount(); }
});

test('Load stages the saved profile into the preview without writing, from the row and from the Peek', async () => {
  const cpu = device('Twenty', {}, { 'hardware-concurrency': 20 }), h = libraryHarness({ profiles: [cpu] });
  try {
    h.render(); await h.settle(); inRow(h, cpu.id, 'load').props.onClick(); await h.settle();
    assert.equal(h.log.commits.length, 0); assert.equal(h.log.staged.length, 1); assert.equal(h.log.staged[0].apis.find(row => row.id === 'hardware-concurrency').selected.value, 20);
    inRow(h, cpu.id, 'pick').props.onClick(); await h.settle(); h.attr('peek-load').props.onClick(); await h.settle(); assert.equal(h.log.staged.length, 2); assert.equal(h.log.commits.length, 0);
    h.state.busy = true; h.render(); await h.settle(); assert.equal(h.attr('peek-load').props.disabled, true); assert.equal(inRow(h, cpu.id, 'load').props.disabled, true);
  } finally { h.unmount(); }
});

test('fit pills come from idle work in view order: conflicts with a plural count, a fit pill only when this browser was read', async () => {
  const fast = device('Fast', {}, { 'hardware-concurrency': 32 }), calm = device('Calm'), mixed = device('Mixed', {}, { 'navigator-language': 'de-DE', 'navigator-languages': ['fr-FR', 'fr'] });
  const h = libraryHarness({ profiles: [fast, calm, mixed] });
  try {
    h.render(); await h.settle();
    assert.equal(h.nodes(node => node.props['data-profile-fit']).length, 0, 'nothing is computed during render'); assert.ok(h.idle.length > 0);
    h.flushIdle(); await h.settle();
    const pill = id => descend(rowOf(h, id), node => typeof node.props['data-profile-fit'] === 'string');
    assert.equal(pill(fast.id).props['data-profile-fit'], 'conflicts'); const count = pill(fast.id).props['data-profile-conflicts']; assert.ok(count >= 1); assert.match(pill(fast.id).props.children, new RegExp('^' + count + ' conflict'));
    assert.equal(pill(calm.id).props['data-profile-fit'], 'fit'); assert.equal(pill(calm.id).props.children, FINGERPRINT_LIBRARY_LABELS.en.fit);
    const ownKeys = Reflect.ownKeys; let validations = 0; Reflect.ownKeys = value => { if (value?.format === 'detect.expert/api-configuration' && Array.isArray(value.apis)) validations++; return ownKeys(value); };
    try { h.external(next => { next.antidetectEnabled = !next.antidetectEnabled; }); await h.settle(); h.flushIdle(); await h.settle(); } finally { Reflect.ownKeys = ownKeys; }
    assert.ok(validations <= 2, 'a newer revision with the same profiles reuses the memoised fit (' + validations + ' validations from the test helper)'); assert.equal(pill(fast.id).props['data-profile-fit'], 'conflicts');
    h.setLocale('ru'); await h.settle(); assert.match(pill(fast.id).props.children, /конфликт/u);
    h.env.saved = { ...h.env.saved, environment: undefined }; h.render(); await h.settle(); h.flushIdle(); await h.settle();
    assert.equal(pill(calm.id), undefined, 'without this browser no fit claim is shown'); assert.equal(pill(fast.id), undefined, 'a conflict with this browser needs this browser');
    assert.equal(pill(mixed.id).props['data-profile-fit'], 'conflicts', 'an internal contradiction is found without it');
  } finally { h.unmount(); }
});

test('filters with counts and removable chips narrow the list; the count says how many are shown', async () => {
  const profiles = [device('Desk 11', { os: 'windows-11', gpu: 'nvidia-rtx-3060' }), device('Desk 10', { os: 'windows-10', gpu: 'amd-rx-6600' }), device('Laptop 10', { os: 'windows-10', deviceType: 'laptop', gpu: 'intel-iris-xe', protection: 'strict' })];
  const h = libraryHarness({ profiles, statuses: new Map([[profiles[0].id, 'applied']]) });
  try {
    h.render(); await h.settle();
    assert.equal(h.attr('count').props.children, '3 · up to 128'); assert.equal(h.attr('filters'), undefined);
    h.attr('filters-toggle').props.onClick(); await h.settle(); assert.equal(h.attr('filters-toggle').props['aria-expanded'], true);
    const option = key => h.nodes(node => node.props['data-profile-filter'] === key)[0], count = key => Number(text(descend(option(key), node => node.props.class === 'fingerprint-filter__count')));
    assert.equal(count('os:windows-10'), 2); assert.equal(count('os:windows-11'), 1); assert.equal(count('gpu:amd'), 1); assert.equal(count('device:laptop'), 1); assert.equal(count('preset:strict'), 1); assert.equal(count('status:applied'), 1);
    assert.deepEqual(h.nodes(node => node.props['data-profile-filter-group']).map(node => node.props['data-profile-filter-group']), [...LIBRARY_FILTER_GROUPS]);
    const shown = () => [...rowIds(h)].sort(), ids = list => list.map(profile => profile.id).sort();
    option('os:windows-10').props.onClick(); await h.settle();
    assert.deepEqual(shown(), ids([profiles[1], profiles[2]])); assert.equal(h.attr('count').props.children, '2 of 3 · up to 128'); assert.equal(option('os:windows-10').props['aria-pressed'], true);
    assert.equal(count('gpu:amd'), 1, 'other groups count within the current filter'); assert.equal(option('gpu:nvidia'), undefined, 'empty options are hidden');
    option('device:laptop').props.onClick(); await h.settle(); assert.deepEqual(shown(), ids([profiles[2]]), 'groups combine with AND');
    option('os:windows-11')?.props.onClick(); await h.settle(); assert.equal(option('os:windows-11'), undefined, 'an option with no match in the other groups is not offered');
    const chips = h.nodes(node => typeof node.props['data-profile-filter-chip'] === 'string'); assert.deepEqual(chips.map(chip => chip.props['data-profile-filter-chip']), ['os:windows-10', 'device:laptop']);
    assert.equal(chips[1].props['aria-label'], 'Remove filter: Device type: Laptop'); assert.equal(descend(chips[1], node => node.type === 'bdi').props.children, 'Laptop');
    chips[1].props.onClick(); await h.settle(); assert.deepEqual(shown(), ids([profiles[1], profiles[2]]));
    // Search and filters together can exclude everything: the empty state says so and clears both.
    h.attr('search').props.onInput({ currentTarget: { value: 'Desk 11' } }); await h.settle(); assert.equal(rowIds(h).length, 0);
    assert.equal(h.nodes(node => node.props['data-profile-empty'] === 'filters').length, 1); assert.match(text(h.nodes(node => node.props['data-profile-empty'] === 'filters')[0]), /No profiles match the search and filters/u);
    h.nodes(node => node.props['data-profile-empty-clear'] === 'filters')[0].props.onClick(); await h.settle(); assert.equal(rowIds(h).length, 3); assert.equal(h.attr('count').props.children, '3 · up to 128'); assert.equal(h.attr('search').props.value, '');
    option('status:applied').props.onClick(); await h.settle(); assert.deepEqual(rowIds(h), [profiles[0].id], 'the status group filters by the applied pill');
    assert.ok(Object.values(LIBRARY_FILTER_OPTIONS).every(list => list.length >= 3));
  } finally { h.unmount(); }
});

test('search covers the facts in the UI language; empty states name their cause and offer the one useful action', async () => {
  const profiles = [device('Berlin', { region: 'DE', gpu: 'nvidia-rtx-4070' }), device('Paris', { region: 'FR', screen: '1920x1080' })], h = libraryHarness({ profiles, locale: 'ru' });
  try {
    h.render(); await h.settle();
    const search = value => { h.attr('search').props.onInput({ currentTarget: { value } }); return h.settle(); };
    await search('германия'); assert.deepEqual(rowIds(h), [profiles[0].id]); await search('germany'); assert.deepEqual(rowIds(h), [profiles[0].id], 'the English region name also matches');
    await search('rtx 4070'); assert.deepEqual(rowIds(h), [profiles[0].id]); await search('1920x1080'); assert.deepEqual(rowIds(h), [profiles[1].id]);
    assert.equal(h.attr('count').props.children, '1 из 2 · максимум 128');
    await search('nothing'); assert.equal(h.attr('library').props.hidden, true); const empty = h.nodes(node => node.props['data-profile-empty'] === 'search')[0]; assert.match(text(empty), new RegExp(h.table.fingerprint_no_profiles.message.replace('.', '\\.')));
    h.nodes(node => node.props['data-profile-empty-clear'] === 'search')[0].props.onClick(); await h.settle(); assert.equal(h.attr('search').props.value, ''); assert.equal(rowIds(h).length, 2);
    const blank = libraryHarness({ profiles: [] });
    try {
      blank.render(); await blank.settle(); assert.equal(blank.attr('filters-toggle'), undefined);
      blank.attr('empty-randomize').props.onClick(); blank.attr('empty-import').props.onClick(); assert.equal(blank.log.randomize, 1); assert.equal(blank.log.import, 1); assert.equal(blank.log.commits.length, 0);
    } finally { blank.unmount(); }
  } finally { h.unmount(); }
});

test('one honest line says profiles share cookies and site storage and links to the Cookies section in every language', async () => {
  for (const locale of Object.keys(FINGERPRINT_LIBRARY_LABELS)) {
    const h = libraryHarness({ profiles: [], locale });
    try {
      h.render(); await h.settle(); const note = h.attr('cookies-note'), link = h.attr('cookies-link');
      assert.ok(text(note).includes(FINGERPRINT_LIBRARY_LABELS[locale].cookiesNote), locale); assert.equal(link.type, 'a'); assert.equal(link.props.href, '#cookies'); assert.equal(link.props.children, FINGERPRINT_LIBRARY_LABELS[locale].cookiesLink);
      assert.match(FINGERPRINT_LIBRARY_LABELS[locale].cookiesNote, /localStorage/u, locale);
    } finally { h.unmount(); }
  }
});

test('the command palette offers Load for at most 64 profiles with clean names; the provider goes away on unmount', async () => {
  const template = device('Template'), many = Array.from({ length: 80 }, (_, index) => ({ ...clone(template), id: 'fp-' + index.toString(16).padStart(32, '0'), label: index === 0 ? 'Bidi\u202e' + 'x'.repeat(140) : 'Palette ' + index }));
  const h = libraryHarness({ profiles: [] });
  try {
    h.env.saved = { ...h.env.saved, configuration: { ...h.env.saved.configuration, fingerprintProfiles: many } }; h.render(); await h.settle();
    const commands = collectPaletteCommands().filter(command => command.source === 'fingerprint-library');
    assert.equal(commands.length, LIBRARY_PALETTE_MAX); assert.ok(commands.every(command => command.kind === 'load-profile' && command.name.length <= 128 && apiLabelSafe(command.name)));
    assert.equal(commands[0].name.length, 128); assert.ok(commands[0].name.endsWith('…'));
    commands[1].run(); await h.settle(); assert.equal(h.log.staged.length, 1); assert.equal(h.log.commits.length, 0);
  } finally { h.unmount(); }
  assert.equal(collectPaletteCommands().filter(command => command.source === 'fingerprint-library').length, 0);
});

test('leaving the page with a changed rename asks for confirmation; Ctrl/Cmd+S is offered to the rename and Save-as fields', async () => {
  const listeners = [], add = globalThis.addEventListener, remove = globalThis.removeEventListener;
  globalThis.addEventListener = (type, listener) => listeners.push([type, listener]); globalThis.removeEventListener = (type, listener) => { const index = listeners.findIndex(entry => entry[1] === listener); if (index >= 0) listeners.splice(index, 1); };
  const profile = device('Guarded'), h = libraryHarness({ profiles: [profile] });
  try {
    h.render(); await h.settle();
    const guard = listeners.find(([type]) => type === 'beforeunload')?.[1]; assert.ok(guard, 'one beforeunload guard while mounted');
    const leave = () => { const event = { prevented: false, preventDefault() { this.prevented = true; } }; guard(event); return event.prevented; };
    assert.equal(leave(), false);
    await cellKey(h, profile.id, 0, 'F2'); assert.equal(leave(), false, 'an untouched editor is not dirty');
    h.attr('rename-input').props.onInput({ currentTarget: { value: 'Guarded 2' } }); await h.settle(); assert.equal(leave(), true);
    h.attr('rename-cancel').props.onClick(); await h.settle(); assert.equal(leave(), false);
  } finally { h.unmount(); globalThis.addEventListener = add; globalThis.removeEventListener = remove; }
  assert.equal(listeners.filter(([type]) => type === 'beforeunload').length, 0, 'the guard is removed on unmount');
});

test('128 profiles render with one Tab stop and bounded facts in Arabic (RTL) and Japanese', async () => {
  const template = device('Template', { region: 'EG' }), profiles = Array.from({ length: API_CONFIGURATION_MAX_PROFILES }, (_, index) => ({ ...clone(template), id: 'fp-' + index.toString(16).padStart(32, '0'), label: 'ملف ' + index }));
  for (const locale of ['ar', 'ja']) {
    const h = libraryHarness({ profiles: [], locale });
    try {
      h.env.saved = { ...h.env.saved, configuration: { ...h.env.saved.configuration, fingerprintProfiles: profiles } }; h.render(); await h.settle();
      assert.equal(rowIds(h).length, 128); assert.equal(tabStops(h).length, 1); assert.equal(h.attr('count').props.children, fillTemplate(FINGERPRINT_LIBRARY_LABELS[locale].countTotal, { total: 128, max: 128 }));
      const meta = text(descend(rowOf(h, profiles[5].id), node => node.props['data-profile-facts'] === true)); assert.ok(meta.length < 400, meta);
      assert.ok(h.nodes(node => node.type === 'bdi' && node.props.class === 'fingerprint-row__name').length === 128);
    } finally { h.unmount(); }
  }
});

// --- Inside the real panel ----------------------------------------------------------------------------------------

function server() {
  const calls = [], value = { configuration: createApiConfiguration(), revision: 7 };
  const snapshot = () => ({ schemaVersion: 1, type: 'api-config-state', configuration: clone(value.configuration), revision: value.revision, registration: value.configuration.enabled ? 'ready' : 'inactive', reloadRequired: false, earlyAccess: 'ready' });
  function event() { const listeners = new Set(); return { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn), emit: (...args) => { for (const fn of listeners) fn(...args); } }; }
  const api = { runtime: { id: 'library-fixture', getURL: path => 'chrome-extension://library-fixture/' + path, sendMessage: async request => { calls.push(clone(request));
    if (request.type === 'ui-api-config-set') { if (request.expectedRevision !== value.revision) return { schemaVersion: 1, type: 'api-config-error', code: 'stale-revision' }; const checked = validateApiConfiguration(request.configuration); assert.equal(checked.ok, true); value.configuration = checked.value; value.revision++; } return snapshot(); } },
    storage: { onChanged: event() }, permissions: { onRemoved: event() }, tabs: { create: async () => ({}) } };
  return { api, value, writes: () => calls.filter(call => call.type === 'ui-api-config-set') };
}
function panel({ s = server(), view = 'quick' } = {}) {
  const previous = Object.fromEntries(['window', 'location', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const own = {}; own.top = own; Object.defineProperty(globalThis, 'window', { configurable: true, value: own }); Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: 'chrome-extension://library-fixture/options.html#antidetect' } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: ENVIRONMENT.userAgent, platform: 'Win32', language: 'en-US', languages: ['en-US'], userAgentData: { brands: [{ brand: 'Chromium', version: '153' }], mobile: false, platform: 'Windows' } } });
  const slots = [], effects = [], table = messages('en'); let cursor = 0, changed = true, tree, props = { active: true, view };
  const hooks = { useState(initial) { const slot = slots[cursor++] ??= { value: initial }; return [slot.value, next => { const value = typeof next === 'function' ? next(slot.value) : next; if (!Object.is(slot.value, value)) { slot.value = value; changed = true; } }]; }, useRef(initial) { return (slots[cursor++] ??= { ref: { current: initial } }).ref; }, useEffect(fn, dependencies) { const slot = slots[cursor++] ??= {}; if (!slot.dependencies || dependencies.some((value, index) => !Object.is(value, slot.dependencies[index]))) { slot.dependencies = dependencies; effects.push(() => { slot.cleanup?.(); slot.cleanup = fn(); }); } } };
  const { FingerprintProfilePanel } = createFingerprintProfileUi({ ...hooks, h: (type, nodeProps) => ({ type, props: nodeProps }), useLocale: () => 'en', translate: key => table[key]?.message ?? key, browserApi: s.api });
  function render() { cursor = 0; changed = false; tree = FingerprintProfilePanel(props); while (effects.length) effects.shift()(); return tree; }
  async function settle() { for (let index = 0; index < 12; index++) { if (changed) render(); await turn(); } if (changed) render(); }
  function nodes(predicate) { const results = []; (function visit(node) { if (Array.isArray(node)) { node.forEach(visit); return; } if (!node?.props) return; if (predicate(node)) results.push(node); visit(node.props.children); })(tree); return results; }
  return { s, render, settle, nodes, attr: key => nodes(node => node.props['data-profile-' + key] === true)[0], update(patch) { props = { ...props, ...patch }; changed = true; render(); }, unmount() { for (const slot of slots) slot?.cleanup?.(); for (const [key, descriptor] of Object.entries(previous)) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]; } };
}

test('inside the panel: the library is the second half of the quick pair, keeps its state across views and writes through the panel CAS', async () => {
  const s = server(); s.value.configuration = storeFingerprintProfile(s.value.configuration, device('Panel A')); s.value.configuration = storeFingerprintProfile(s.value.configuration, device('Panel B'));
  const [a, b] = s.value.configuration.fingerprintProfiles.map(profile => profile.id), p = panel({ s });
  try {
    p.render(); await p.settle();
    const pair = p.nodes(node => node.props.class === 'fp-quick-pair')[0]; assert.equal(pair.props.children.length, 2); assert.equal(pair.props.children[0].props['data-profile-device-card'], true); assert.equal(pair.props.children[1].props['data-profile-library-panel'], true);
    p.attr('search').props.onInput({ currentTarget: { value: 'Panel B' } }); await p.settle();
    p.update({ view: 'device' }); await p.settle(); assert.equal(p.attr('library'), undefined); p.update({ view: 'quick' }); await p.settle();
    assert.equal(p.attr('search').props.value, 'Panel B', 'library state survives the level views'); p.attr('search').props.onInput({ currentTarget: { value: '' } }); await p.settle();
    descend(p.nodes(node => node.props['data-profile-row'] === b)[0], node => node.props['data-profile-pick'] === true).props.onClick(); await p.settle();
    assert.equal(p.nodes(node => node.props.class === 'fp-quick-pair')[0].props.children[0].props['data-profile-peek'], b, 'the Peek replaces the device card');
    const del = descend(p.nodes(node => node.props['data-profile-row'] === a)[0], node => node.props['data-profile-delete'] === true); await del.props.onClick(); await p.settle();
    assert.equal(s.writes().length, 1); assert.equal(s.writes()[0].expectedRevision, 7); assert.deepEqual(s.value.configuration.fingerprintProfiles.map(profile => profile.id), [b]);
    await p.attr('undo-button').props.onClick(); await p.settle();
    assert.equal(s.writes().length, 2); assert.equal(s.writes()[1].expectedRevision, 8); assert.deepEqual(s.value.configuration.fingerprintProfiles.map(profile => profile.id), [a, b]);
    assert.equal(s.value.configuration.antidetectEnabled, false); assert.equal(s.value.configuration.enabled, false);
  } finally { p.unmount(); }
});

test('the library stylesheet is linked once right after the panel stylesheet, only in Options, with themes, RTL, forced colors and reduced motion', () => {
  const read = file => readFileSync(new URL('../../apps/production-extension/' + file, import.meta.url), 'utf8');
  const options = read('options.html'), links = [...options.matchAll(/href="([^"]+\.css)"/gu)].map(match => match[1]);
  assert.equal(links.filter(link => link === 'fingerprint-library-ui.css').length, 1); assert.equal(links.indexOf('fingerprint-library-ui.css'), links.indexOf('fingerprint-profile-ui.css') + 1);
  for (const page of ['popup.html', 'sidepanel.html']) assert.doesNotMatch(read(page), /fingerprint-library-ui\.(?:css|js)/u, page);
  const css = read('fingerprint-library-ui.css').replace(/\/\*[\s\S]*?\*\//gu, '');
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|!important|url\(|@import/iu, 'tokens only, no external resources');
  assert.doesNotMatch(css, /(?:^|[;{\s])(?:margin|padding|border)-(?:left|right)\s*:|(?:^|[;{\s])(?:left|right)\s*:|text-align:\s*(?:left|right)/u, 'logical properties keep RTL');
  for (const block of ['@media (forced-colors: active)', '@media (prefers-reduced-motion: reduce)', '@media (prefers-reduced-motion: no-preference)', ':dir(rtl)']) assert.ok(css.includes(block), block);
  const rules = [...css.replace(/@(?:media|container)[^{]+\{/gu, '').replace(/@keyframes[^{]+\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/gu, '').matchAll(/([^{}]+)\{[^{}]*\}/gu)].map(match => match[1].trim()).filter(Boolean);
  assert.ok(rules.length > 60);
  for (const rule of rules) for (const selector of rule.split(/,(?![^()]*\))/u)) assert.match(selector.trim(), /^(?::root(?:\[data-ui-theme\])? body )?\.fingerprint-/u, 'every selector belongs to the library: ' + selector.trim());
});
