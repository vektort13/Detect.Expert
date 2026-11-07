// A test harness for the saved-profiles library with the round-5 stores (trash, profile-to-proxy links, saved proxies, temporary action).
// Same technique as fingerprint-library-ui.test.mjs: positional hooks, a fake clock and idle queue, a CAS-like commit; the stores are the real
// ones over a fake browser storage, so the tests exercise the real trash and link logic.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFingerprintLibraryUi } from '../../apps/production-extension/fingerprint-library-ui.js';
import { validateApiConfiguration, createApiConfiguration } from '../../apps/production-extension/api-configuration.js';
import { createTrashStore } from '../../apps/production-extension/fingerprint-trash.js';
import { createBundleStore } from '../../apps/production-extension/identity-bundles.js';
import { storeFingerprintProfile } from '../../apps/production-extension/fingerprint-profiles.js';
import { applyAntidetectCopy } from '../production-locales-antidetect.mjs';
import { applyFingerprintCopy } from '../production-locales-fingerprint.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';
import { clone, turn, fakeStorage, ENVIRONMENT } from './fingerprint-identity-fixtures.mjs';

export const BASE = 1_800_000_000_000;
export function messages(locale) {
  const language = PRODUCTION_LANGUAGES.find(item => item.id === locale);
  return applyFingerprintCopy(applyAntidetectCopy(JSON.parse(readFileSync(new URL('../../apps/production-extension/' + (language.uiOnly ? 'ui-locales' : '_locales') + '/' + locale + '/messages.json', import.meta.url))), locale), locale);
}
export const text = node => { const parts = []; (function visit(item) { if (Array.isArray(item)) item.forEach(visit); else if (typeof item === 'string' || typeof item === 'number') parts.push(String(item)); else if (item?.props) visit(item.props.children); })(node); return parts.join(' '); };
export function descend(node, predicate) { if (Array.isArray(node)) { for (const item of node) { const found = descend(item, predicate); if (found) return found; } return undefined; } if (!node?.props) return undefined; if (predicate(node)) return node; return descend(node.props.children, predicate); }
export const keyEvent = (key, extra = {}) => ({ key, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, currentTarget: {}, ...extra });

export function libraryHarness({ profiles = [], environment = ENVIRONMENT, locale: initialLocale = 'en', layout: initialLayout = 'wide', trash = true, bundles = true, proxies = null, temporary = true, storage = fakeStorage(), base: baseConfiguration = null, extra = {} } = {}) {
  // A stand-in for the library's root element: it receives the keydown listener of the save shortcut, so Ctrl/Cmd+S can be driven without a DOM.
  const root = { listeners: [], selectors: [], querySelector(selector) { this.selectors.push(selector); return null; }, addEventListener(type, listener) { this.listeners.push([type, listener]); }, removeEventListener(type, listener) { this.listeners = this.listeners.filter(entry => entry[1] !== listener); }, contains: () => true };
  let configuration = baseConfiguration ?? createApiConfiguration(); for (const profile of profiles) configuration = storeFingerprintProfile(configuration, profile);
  let locale = initialLocale, layout = initialLayout;
  const env = { saved: { configuration, environment, revision: 1, earlyAccess: 'ready' } }; env.draft = clone(configuration);
  const savedRef = { current: env.saved }, draftRef = { current: env.draft };
  const slots = [], effects = []; let cursor = 0, changed = true, tree, firstRef = true;
  const hooks = { useState(initial) { const slot = slots[cursor++] ??= { value: initial }; return [slot.value, next => { const value = typeof next === 'function' ? next(slot.value) : next; if (!Object.is(slot.value, value)) { slot.value = value; changed = true; } }]; }, useRef(initial) { const slot = slots[cursor++] ??= { ref: { current: initial === null && firstRef ? root : initial } }; firstRef = false; return slot.ref; }, useEffect(fn, dependencies) { const slot = slots[cursor++] ??= {}; if (!slot.dependencies || dependencies.some((value, index) => !Object.is(value, slot.dependencies[index]))) { slot.dependencies = dependencies; effects.push(() => { slot.cleanup?.(); slot.cleanup = fn(); }); } } };
  const table = messages(locale), time = { now: 0, timers: [], next: 1 }, idle = [];
  const clock = { now: () => BASE + time.now, set: (task, ms) => { const id = time.next++; time.timers.push({ id, at: time.now + ms, task }); return id; }, clear: id => { time.timers = time.timers.filter(timer => timer.id !== id); } };
  const defer = task => { const entry = { task, cancelled: false }; idle.push(entry); return () => { entry.cancelled = true; }; };
  const trace = [], log = { commits: [], staged: [], errors: [], randomize: 0, import: 0, temporary: [], connects: [] }, state = { busy: false, locked: false, dirty: false, failNext: false, failTrash: false, statuses: null };
  // The stores are the real ones; the wrappers add a trace of the order of the two-step flows and the failure switches the tests need.
  const trashStore = createTrashStore(storage, { now: clock.now }), bundleStore = createBundleStore(storage);
  const trashApi = trash ? {
    read: library => trashStore.read({ library }), remove: id => { trace.push('trash.remove'); return trashStore.remove(id); }, empty: () => { trace.push('trash.empty'); return trashStore.empty(); }, watch: callback => trashStore.watch(callback),
    add: async (profile, index, library) => { trace.push('trash.add'); if (state.failTrash) throw new Error('trash refused'); return trashStore.add(profile, index, { library }); } } : null;
  const bundleApi = bundles ? { read: ids => bundleStore.read({ profileIds: ids }), link: (profileId, proxy, context) => { trace.push('bundles.link'); return bundleStore.link(profileId, proxy, context); }, unlink: (profileId, context) => { trace.push('bundles.unlink'); return bundleStore.unlink(profileId, context); }, watch: callback => bundleStore.watch(callback) } : null;
  const proxyState = { list: proxies, loads: 0, answers: [] };
  const proxyApi = proxies !== null ? {
    async load({ fresh = false } = {}) { proxyState.loads++; trace.push(fresh ? 'proxies.refresh' : 'proxies.load'); return proxyState.list ? clone(proxyState.list) : null; },
    begin(proxy) {
      trace.push('proxies.begin:' + proxy.id);
      return { async finish() { trace.push('proxies.finish'); const answer = proxyState.answers.shift() ?? { ok: true }; log.connects.push([proxy.id, answer]); return answer; }, cancel() { trace.push('proxies.cancel'); } };
    } } : null;
  async function commit(next, retainPreview) {
    trace.push('commit'); log.commits.push(clone(next)); await turn();
    if (state.failNext) { state.failNext = false; return false; }
    const checked = validateApiConfiguration(next); assert.ok(checked.ok, 'every library write is a valid configuration');
    env.saved = { ...env.saved, configuration: checked.value, revision: env.saved.revision + 1 }; savedRef.current = env.saved;
    env.draft = retainPreview ? { ...env.draft, fingerprintProfiles: clone(checked.value.fingerprintProfiles) } : clone(checked.value); draftRef.current = env.draft;
    changed = true; return true;
  }
  const stage = next => { env.draft = next; draftRef.current = next; log.staged.push(next); changed = true; };
  const { FingerprintLibrary } = createFingerprintLibraryUi({ ...hooks, h: (type, props) => ({ type, props }), useLocale: () => locale, translate: key => table[key]?.message ?? key, Icon: function Icon() { return null; }, clock, defer });
  function render() {
    cursor = 0; changed = false; firstRef = true; savedRef.current = env.saved; draftRef.current = env.draft;
    tree = FingerprintLibrary({ visible: true, saved: env.saved, draft: env.draft, savedRef, draftRef, statuses: state.statuses ?? new Map(), busy: state.busy, locked: state.locked, dirty: state.dirty, commit, stage,
      setError: code => { log.errors.push(code); changed = true; }, safeError: failure => failure?.code ?? 'antidetect_failed', card: () => ({ type: 'section', props: { 'data-test-card': true } }),
      onRandomize: () => { log.randomize++; }, onImport: () => { log.import++; }, layout, trash: trashApi, bundles: bundleApi, proxies: proxyApi,
      onTemporary: temporary ? async profile => { trace.push('temporary'); log.temporary.push(profile.id); return true; } : null, ...extra });
    while (effects.length) effects.shift()(); return tree;
  }
  async function settle() { for (let index = 0; index < 12; index++) { if (changed) render(); await turn(); } if (changed) render(); }
  function nodes(predicate) { const results = []; (function visit(node) { if (Array.isArray(node)) { node.forEach(visit); return; } if (!node?.props) return; if (predicate(node)) results.push(node); visit(node.props.children); })(tree); return results; }
  const attr = key => nodes(node => node.props['data-profile-' + key] === true)[0];
  function advance(ms) { time.now += ms; for (;;) { const due = time.timers.filter(timer => timer.at <= time.now).sort((a, b) => a.at - b.at)[0]; if (!due) break; time.timers = time.timers.filter(timer => timer !== due); due.task(); } changed = true; render(); }
  function flushIdle() { while (idle.length) { const entry = idle.shift(); if (!entry.cancelled) entry.task({ timeRemaining: () => 50 }); } changed = true; render(); }
  function external(mutate) { const next = clone(env.saved.configuration); mutate(next); const checked = validateApiConfiguration(next); assert.ok(checked.ok); env.saved = { ...env.saved, configuration: checked.value, revision: env.saved.revision + 1 }; savedRef.current = env.saved; changed = true; render(); }
  const keydown = event => { for (const [type, listener] of root.listeners) if (type === 'keydown') listener(event); };
  return { env, log, state, time, idle, table, trace, storage, proxyState, root, keydown, render, settle, nodes, attr, advance, flushIdle, external, get tree() { return tree; },
    setLocale(next) { locale = next; Object.assign(table, messages(next)); changed = true; render(); }, setLayout(next) { layout = next; changed = true; render(); }, unmount() { for (const slot of slots) slot?.cleanup?.(); } };
}
export const rowOf = (h, id) => h.nodes(node => node.props['data-profile-row'] === id)[0];
export const inRow = (h, id, key) => descend(rowOf(h, id), node => node.props['data-profile-' + key] === true);
export const rowIds = h => h.attr('library')?.props.children.map(row => row.props['data-profile-row']) ?? [];
export const peek = h => h.nodes(node => typeof node.props['data-profile-peek'] === 'string')[0];
export const cellKey = async (h, id, col, key, extra) => { const node = h.nodes(item => item.props['data-profile-focus'] === id + ':' + col)[0]; const event = keyEvent(key, extra); node.props.onKeyDown(event); await h.settle(); return event; };
export const byData = (h, key, value) => h.nodes(node => node.props['data-profile-' + key] === value)[0];
export const allByData = (h, key) => h.nodes(node => node.props['data-profile-' + key] !== undefined);
// Types into a tag/note input as the browser would deliver it.
export const typeInto = async (h, node, value) => { node.props.onInput({ currentTarget: { value } }); await h.settle(); };
export const press = async (h, node, key, extra) => { const event = keyEvent(key, extra); node.props.onKeyDown(event); await h.settle(); return event; };
export const click = async (h, node) => { assert.ok(node, 'the control exists'); assert.notEqual(node.props.disabled, true, 'the control is enabled'); node.props.onClick(); await h.settle(); };
// Records what announce() would put into the two live regions. Timers of a second or more (the clearing of a shown message) are dropped so the
// test process does not wait for them; everything else still runs on the real clock.
export function captureAnnouncements() {
  const texts = [], regions = {}, real = globalThis.setTimeout, previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  for (const kind of ['polite', 'assertive']) regions[kind] = { isConnected: true, append(node) { texts.push([kind, node.textContent]); } };
  Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: { querySelector: selector => regions[/"(polite|assertive)"/u.exec(selector)?.[1]] ?? null, createElement: () => ({ textContent: '', remove() {} }) } });
  globalThis.setTimeout = (task, ms, ...rest) => ms >= 1000 ? 0 : real(task, ms, ...rest);
  return {
    texts, all: () => texts.map(entry => entry[1]).join(' | '),
    async flush() { await new Promise(resolve => real(resolve, 40)); },
    stop() { globalThis.setTimeout = real; if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; }
  };
}
// Every node under `root` (including itself) that satisfies the predicate.
export function within(root, predicate) { const results = []; (function visit(node) { if (Array.isArray(node)) { node.forEach(visit); return; } if (!node?.props) return; if (predicate(node)) results.push(node); visit(node.props.children); })(root); return results; }
