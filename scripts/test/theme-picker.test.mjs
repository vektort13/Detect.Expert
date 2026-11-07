// Shared appearance UI: actual component handlers, a native-popover DOM model and a controlled store.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { transform } from 'esbuild';
import { createThemePicker } from '../../apps/production-extension/theme-picker.js';
import { THEME_LABELS, getThemeLabels } from '../../apps/production-extension/theme-labels.js';
import { THEME_IDS } from '../../apps/production-extension/theme-controller.js';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';

const turn = () => new Promise(resolve => setImmediate(resolve));
function store(initial = {}) {
  let value = { id: 'system', effectiveId: 'system-light', ready: true, saving: false, error: null, ...initial };
  const listeners = new Set(), calls = [], state = { pending: null, failure: false, initialization: 0 };
  const publish = patch => { value = { ...value, ...patch }; for (const listener of listeners) listener(value); };
  const controller = {
    getThemeSnapshot: () => value,
    subscribeTheme(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async initializeTheme() { state.initialization++; },
    async setTheme(id) {
      calls.push(id); publish({ saving: true, error: null });
      try { if (state.pending) await state.pending; if (state.failure) throw Error('PRIVATE_BACKEND_ERROR'); publish({ id, effectiveId: id === 'system' ? 'system-light' : id, error: null }); }
      catch (error) { publish({ error: 'save-failed' }); throw error; }
      finally { publish({ saving: false }); }
    }
  };
  return { controller, publish, listeners, calls, state };
}
function fixture({ source = store(), locale: initialLocale = 'en', width = 320, height = 600, rect = { left: 270, right: 306, top: 10, bottom: 46 }, deferEffects = false } = {}) {
  const previous = new Map(['document', 'window', 'requestAnimationFrame', 'cancelAnimationFrame'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const documentListeners = new Map(), windowListeners = new Map(), frames = new Map(), items = new Map(), slots = [], effects = [];
  const document = { body: {}, documentElement: { clientWidth: width, clientHeight: height }, activeElement: null };
  document.activeElement = document.body;
  const eventMethods = listeners => ({ addEventListener(name, callback) { const entries = listeners.get(name) ?? new Set(); entries.add(callback); listeners.set(name, entries); }, removeEventListener(name, callback) { listeners.get(name)?.delete(callback); } });
  Object.assign(document, eventMethods(documentListeners));
  const window = { innerWidth: width, innerHeight: height, ...eventMethods(windowListeners) };
  let sequence = 0, cursor = 0, dirty = true, tree, locale = initialLocale, nativeShows = 0, nativeHides = 0, closed = false, assignedRefs = new Map();
  const root = { contains: element => element === trigger || element === panel || [...items.values()].includes(element) };
  const trigger = { focus() { document.activeElement = this; }, getBoundingClientRect: () => rect };
  const panelListeners = new Map();
  const panel = { style: {}, scrollHeight: 330, open: false, ...eventMethods(panelListeners), showPopover() { nativeShows++; this.open = true; }, hidePopover() { nativeHides++; this.open = false; }, setAttribute() {} };
  for (const [key, value] of Object.entries({ document, window, requestAnimationFrame: callback => { const id = ++sequence; frames.set(id, callback); return id; }, cancelAnimationFrame: id => frames.delete(id) })) Object.defineProperty(globalThis, key, { configurable: true, value });
  const hooks = {
    useState(initial) { const slot = slots[cursor++] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slot.value, next => { const value = typeof next === 'function' ? next(slot.value) : next; if (!Object.is(value, slot.value)) { slot.value = value; dirty = true; } }]; },
    useRef(initial) { return (slots[cursor++] ??= { ref: { current: initial } }).ref; },
    useEffect(callback, dependencies) { const slot = slots[cursor++] ??= {}; if (!slot.dependencies || dependencies.some((value, index) => !Object.is(value, slot.dependencies[index]))) { slot.dependencies = dependencies; effects.push(() => { slot.cleanup?.(); slot.cleanup = callback(); }); } }
  };
  const { ThemePicker } = createThemePicker({ ...hooks, h: (type, props) => ({ type, props }), useLocale: () => locale, themeController: source.controller });
  function nodes(predicate) { const found = []; function visit(node) { if (Array.isArray(node)) { node.forEach(visit); return; } if (!node?.props) return; if (predicate(node)) found.push(node); visit(node.props.children); } visit(tree); return found; }
  function render() {
    cursor = 0; dirty = false; tree = ThemePicker();
    const nextRefs = new Map();
    for (const node of nodes(() => true)) {
      let element = node.props['data-theme-picker'] ? root : node.props['data-theme-trigger'] ? trigger : node.props.popover ? panel : null;
      const id = node.props['data-theme-option'];
      if (id) {
        if (!items.has(id)) items.set(id, { id, focus() { if (!this.disabled) { document.activeElement = this; this.onFocus?.(); } }, scrollIntoView() {} });
        element = items.get(id); element.disabled = node.props.disabled; element.onFocus = node.props.onFocus;
      }
      if (element && node.props.ref) { typeof node.props.ref === 'function' ? node.props.ref(element) : node.props.ref.current = element; nextRefs.set(element, node.props.ref); }
    }
    for (const [element, ref] of assignedRefs) if (!nextRefs.has(element)) { typeof ref === 'function' ? ref(null) : ref.current = null; if (document.activeElement === element) document.activeElement = document.body; }
    assignedRefs = nextRefs;
    if (document.activeElement?.disabled) document.activeElement = document.body;
    if (!deferEffects) while (effects.length) effects.shift()();
  }
  function flush() { for (let index = 0; dirty && index < 12; index++) render(); assert.equal(dirty, false); }
  function runEffects() { for (const callback of effects.splice(0)) callback(); }
  function flushEffects() { for (let index = 0; index < 12; index++) { flush(); if (!effects.length) return; runEffects(); } assert.fail('passive effects did not settle'); }
  async function settle() { for (let index = 0; index < 4; index++) { flushEffects(); await turn(); } flushEffects(); }
  const attr = (name, value = true) => nodes(node => node.props[name] === value)[0];
  function frame() { for (const [id, callback] of [...frames]) { frames.delete(id); callback(); } flush(); }
  function event(name, value) { for (const callback of [...documentListeners.get(name) ?? []]) callback({ type: name, ...value }); flush(); }
  function key(node, value, commit = true) { let prevented = false; node.props.onKeyDown({ key: value, preventDefault() { prevented = true; }, stopPropagation() {} }); if (commit) flush(); return prevented; }
  const text = node => Array.isArray(node) ? node.map(text).join(' ') : node?.props ? text(node.props.children) : typeof node === 'string' ? node : '';
  flush();
  return { source, document, panel, trigger, frames, nodes, attr, flush, runEffects, flushEffects, settle, frame, event, key, text: () => text(tree), get nativeShows() { return nativeShows; }, get nativeHides() { return nativeHides; },
    open() { attr('data-theme-trigger').props.onClick(); flush(); frame(); },
    locale(value) { locale = value; dirty = true; flush(); },
    dismissNative() { for (const callback of [...panelListeners.get('toggle') ?? []]) callback({ newState: 'closed' }); flush(); },
    unmount() { if (closed) return; closed = true; for (const slot of slots) slot.cleanup?.(); for (const [key, descriptor] of previous) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]; },
    listenerCount: () => [...documentListeners.values(), ...windowListeners.values(), ...panelListeners.values()].reduce((sum, entries) => sum + entries.size, 0),
  };
}

test('theme labels cover all21 shipped locales and every actual controller ID without generated catalogs', () => {
  assert.deepEqual(Object.keys(THEME_LABELS).sort(), PRODUCTION_LANGUAGES.map(row => row.id).sort());
  for (const language of PRODUCTION_LANGUAGES) for (const key of ['theme', 'saveFailed', 'loadFailed', ...THEME_IDS]) assert.ok(getThemeLabels(language.id)[key].trim(), language.id + ':' + key);
  assert.equal(getThemeLabels('zh-Hans'), THEME_LABELS.zh_CN); assert.equal(getThemeLabels('pt-BR'), THEME_LABELS.pt_BR); assert.equal(getThemeLabels('unknown'), THEME_LABELS.en);
});
test('opening the native popover reads/subscribes only, exposes six radio cards and preserves selected bootstrap ID', async () => {
  const h = fixture({ source: store({ id: 'glass', effectiveId: 'glass', ready: false }) });
  try {
    await h.settle(); h.open();
    assert.equal(h.nativeShows, 1); assert.equal(h.source.state.initialization, 1); assert.deepEqual(h.source.calls, []);
    const options = h.nodes(node => node.props.role === 'menuitemradio'); assert.deepEqual(options.map(node => node.props['data-theme-option']), THEME_IDS);
    assert.equal(options.filter(node => node.props['aria-checked']).length, 1); assert.equal(h.attr('data-theme-option', 'glass').props['aria-checked'], true);
    assert.ok(options.every(node => node.props.disabled)); h.source.publish({ ready: true }); h.flush(); assert.equal(h.attr('data-theme-option', 'glass').props.disabled, false);
  } finally { h.unmount(); }
});
test('keyboard navigation is roving/manual, supports Home/End and reverses horizontal arrows in RTL', async () => {
  for (const locale of ['en', 'ar']) {
    const h = fixture({ locale });
    try {
      await h.settle(); assert.equal(h.key(h.attr('data-theme-trigger'), 'ArrowDown'), true); h.frame(); assert.equal(h.document.activeElement.id, 'system');
      h.key(h.attr('data-theme-option', 'system'), 'ArrowRight'); assert.equal(h.document.activeElement.id, locale === 'ar' ? 'glass' : 'pearl');
      h.key(h.attr('data-theme-option', 'system'), 'End'); assert.equal(h.document.activeElement.id, 'glass');
      h.key(h.attr('data-theme-option', 'glass'), 'Home'); assert.equal(h.document.activeElement.id, 'system');
      assert.equal(h.nodes(node => node.props.role === 'menuitemradio' && node.props.tabIndex === 0).length, 1); assert.deepEqual(h.source.calls, []);
      h.event('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} }); assert.equal(h.attr('data-theme-trigger').props['aria-expanded'], false); assert.equal(h.document.activeElement, h.trigger);
    } finally { h.unmount(); }
  }
});
test('trigger Escape cancels opening before commit and before the native-popover effect', async () => {
  for (const commitBeforeEscape of [false, true]) {
    const h = fixture({ deferEffects: true });
    try {
      await h.settle(); const trigger = h.attr('data-theme-trigger');
      trigger.props.onClick();
      if (commitBeforeEscape) h.flush();
      assert.equal(h.key(trigger, 'Escape', false), true, 'Escape is consumed immediately');
      h.runEffects(); assert.equal(h.nativeShows, 0, 'Escape also invalidates effects flushed before the closing commit');
      h.flushEffects(); h.frame();
      assert.equal(h.attr('data-theme-trigger').props['aria-expanded'], false);
      assert.equal(h.nodes(node => node.props.role === 'menuitemradio').length, 0);
      assert.equal(h.nativeShows, 0, 'a stale passive effect must not open a dismissed menu');
      assert.equal(h.panel.open, false); assert.equal(h.frames.size, 0); assert.equal(h.listenerCount(), 0);
      assert.equal(h.document.activeElement, h.trigger); assert.deepEqual(h.source.calls, []);
      h.attr('data-theme-trigger').props.onClick(); h.flushEffects(); h.frame();
      assert.equal(h.nativeShows, 1); assert.equal(h.document.activeElement.id, 'system', 'a later explicit opening still works');
    } finally { h.unmount(); }
  }
});
test('a second pre-commit trigger click cancels the first and stale focus work cannot survive Escape', async () => {
  const h = fixture({ deferEffects: true });
  try {
    await h.settle(); const trigger = h.attr('data-theme-trigger');
    trigger.props.onClick(); trigger.props.onClick(); h.flushEffects(); h.frame();
    assert.equal(h.attr('data-theme-trigger').props['aria-expanded'], false); assert.equal(h.nativeShows, 0);
    trigger.props.onClick(); h.flushEffects(); assert.equal(h.nativeShows, 1); assert.ok(h.frames.size > 0);
    assert.equal(h.key(h.attr('data-theme-trigger'), 'Escape', false), true);
    h.frame(); h.flushEffects();
    assert.equal(h.attr('data-theme-trigger').props['aria-expanded'], false); assert.equal(h.panel.open, false);
    assert.equal(h.document.activeElement, h.trigger); assert.equal(h.frames.size, 0); assert.equal(h.listenerCount(), 0); assert.deepEqual(h.source.calls, []);
  } finally { h.unmount(); }
});
test('closing and reopening before passive work invalidates the previous opening and its focus frame', async () => {
  const h = fixture({ deferEffects: true });
  try {
    await h.settle(); let trigger = h.attr('data-theme-trigger');
    trigger.props.onClick(); h.flush();
    h.key(trigger, 'Escape', false); h.key(trigger, 'ArrowUp', false);
    h.runEffects(); assert.equal(h.nativeShows, 0, 'an earlier committed opening cannot activate the next opening');
    h.flushEffects(); assert.equal(h.nativeShows, 1);
    const oldFrame = [...h.frames.values()][0]; assert.equal(typeof oldFrame, 'function');
    trigger = h.attr('data-theme-trigger'); h.key(trigger, 'Escape', false); h.key(trigger, 'ArrowDown', false);
    oldFrame(); assert.equal(h.document.activeElement, h.trigger, 'a cancelled frame cannot focus a reopened generation');
    h.flushEffects(); h.frame();
    assert.equal(h.nativeShows, 2); assert.equal(h.document.activeElement.id, 'system'); assert.deepEqual(h.source.calls, []);
  } finally { h.unmount(); }
});
test('a real explicit selection commits once; outside dismissal during a pending save never steals later focus', async () => {
  const source = store(); let finish; source.state.pending = new Promise(resolve => { finish = resolve; }); const h = fixture({ source });
  try {
    await h.settle(); h.open(); const select = h.attr('data-theme-option', 'aurora').props.onClick;
    const pending = select(); select(); h.flush(); assert.deepEqual(source.calls, ['aurora']); assert.ok(h.nodes(node => node.props.role === 'menuitemradio').every(node => node.props.disabled));
    const elsewhere = {}; h.document.activeElement = elsewhere; h.event('pointerdown', { target: elsewhere }); assert.equal(h.attr('data-theme-trigger').props['aria-expanded'], false);
    finish(); await pending; await h.settle(); h.frame(); assert.equal(h.document.activeElement, elsewhere); assert.equal(source.controller.getThemeSnapshot().id, 'aurora');
    h.open(); const selected = h.attr('data-theme-option', 'aurora'); assert.equal(selected.props['aria-checked'], true);
    source.state.pending = null; await h.attr('data-theme-option', 'orchid').props.onClick(); await h.settle(); assert.equal(h.document.activeElement, h.trigger); assert.equal(h.attr('data-theme-trigger').props['aria-expanded'], false);
  } finally { h.unmount(); }
});
test('save refusal keeps the previous selected ID and restores a retry target without raw backend errors', async () => {
  const source = store(); source.state.failure = true; const h = fixture({ source, locale: 'ru' });
  try {
    await h.settle(); h.open(); const pending = h.attr('data-theme-option', 'aurora').props.onClick(); h.flush(); assert.equal(h.document.activeElement, h.document.body);
    await pending; await h.settle(); h.frame(); assert.equal(h.attr('data-theme-trigger').props['aria-expanded'], true);
    assert.equal(h.attr('data-theme-option', 'system').props['aria-checked'], true); assert.equal(h.document.activeElement.id, 'aurora');
    assert.match(h.text(), /Не удалось сохранить тему/); assert.doesNotMatch(h.text(), /PRIVATE_BACKEND_ERROR/);
    source.state.failure = false; await h.attr('data-theme-option', 'aurora').props.onClick(); await h.settle(); assert.equal(source.controller.getThemeSnapshot().id, 'aurora'); assert.equal(h.document.activeElement, h.trigger);
  } finally { h.unmount(); }
});
test('external theme and live locale changes update labels without writes; unmount cancels frames/listeners', async () => {
  const h = fixture();
  try {
    await h.settle(); h.source.publish({ id: 'system', effectiveId: 'system-dark' }); h.flush(); h.open();
    assert.match(h.attr('data-theme-trigger').props['aria-label'], /Theme: System/u);
    assert.equal(h.attr('data-theme-option', 'system').props['aria-checked'], true);
    assert.deepEqual(h.nodes(node => node.props.role === 'menuitemradio').map(node => node.props['data-theme-option']), THEME_IDS);
    h.source.publish({ id: 'system', effectiveId: 'system-light' }); h.flush();
    assert.equal(h.attr('data-theme-option', 'system').props['aria-checked'], true); assert.deepEqual(h.source.calls, []);
    h.key(h.attr('data-theme-trigger'), 'Escape');
    h.source.publish({ id: 'orchid', effectiveId: 'orchid' }); h.flush(); h.locale('fr');
    assert.match(h.attr('data-theme-trigger').props['aria-label'], /Thème: Orchidée/); assert.deepEqual(h.source.calls, []);
    h.attr('data-theme-trigger').props.onClick(); h.flush(); assert.ok(h.frames.size > 0); assert.ok(h.listenerCount() > 0);
    h.unmount(); assert.equal(h.frames.size, 0); assert.equal(h.listenerCount(), 0); assert.equal(h.source.listeners.size, 0);
  } finally { h.unmount(); }
});
test('native dismiss and Tab-away close without refocusing; positioning stays inside narrow and short viewports', async () => {
  for (const [width, height] of [[144, 150], [320, 600], [1200, 900]]) {
    const h = fixture({ width, height, rect: { left: width - 48, right: width - 12, top: 8, bottom: 44 } });
    try {
      await h.settle(); h.open(); const style = h.panel.style;
      assert.ok(parseFloat(style.left) >= 0); assert.ok(parseFloat(style.left) + parseFloat(style.width) <= width); assert.ok(parseFloat(style.top) + parseFloat(style.maxHeight) <= height);
      const next = {}; h.document.activeElement = next; h.event('focusin', { target: next }); assert.equal(h.attr('data-theme-trigger').props['aria-expanded'], false); assert.equal(h.document.activeElement, next);
      h.open(); h.dismissNative(); assert.equal(h.attr('data-theme-trigger').props['aria-expanded'], false);
    } finally { h.unmount(); }
  }
});
test('picker CSS parses for supported engines and contains no selector outside its own component', async () => {
  const css = readFileSync(new URL('../../apps/production-extension/theme-picker.css', import.meta.url), 'utf8');
  const output = await transform(css, { loader: 'css', target: ['chrome153', 'firefox138'] }); assert.deepEqual(output.warnings, []);
  assert.doesNotMatch(css, /(?:^|\})\s*(?:body|:root|\.management-shell|\.language-picker)\s*\{/u);
  assert.match(css, /max-height: calc\(100dvh - 16px\)/u); assert.match(css, /forced-colors: active/u);
});
