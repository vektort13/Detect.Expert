// ADR-088: actual shell handlers with a DOM visibility/focus model; no browser APIs mutate.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createManagementUi, MANAGEMENT_TABS } from '../../apps/production-extension/management-ui.js';
import { proxyGeoSettingsLabels } from '../../apps/production-extension/proxy-geo-settings-labels.js';

function fixture(initialWide = true, locale = 'en', initialHash = '#settings') {
  const globals = ['document', 'window', 'location', 'matchMedia', 'addEventListener', 'removeEventListener', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const previous = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const listeners = new Map(), frames = new Map(), mediaListeners = new Set(), elements = new Map(), focusAttempts = [];
  const document = { body: { id: 'body' }, documentElement: { id: 'html' }, activeElement: null };
  document.activeElement = document.body;
  const media = { matches: initialWide, addEventListener: (type, callback) => mediaListeners.add(callback), removeEventListener: (type, callback) => mediaListeners.delete(callback) };
  const location = { hash: initialHash, href: 'chrome-extension://shell-fixture/options.html' + initialHash };
  const createdTabs = [];
  const ownWindow = {}; ownWindow.top = ownWindow;
  let frameId = 0;
  const replacements = { document, window: ownWindow, location, matchMedia: () => media,
    addEventListener(type, callback) { const callbacks = listeners.get(type) ?? new Set(); callbacks.add(callback); listeners.set(type, callbacks); },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
    requestAnimationFrame(callback) { const id = ++frameId; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
  };
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const slots = [], effects = []; let cursor = 0, changed = true, tree;
  const hooks = {
    useState(initial) { const slot = slots[cursor++] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slot.value, next => { const value = typeof next === 'function' ? next(slot.value) : next; if (!Object.is(value, slot.value)) { slot.value = value; changed = true; } }]; },
    useRef(initial) { return (slots[cursor++] ??= { ref: { current: initial } }).ref; },
    useEffect(callback, dependencies) { const slot = slots[cursor++] ??= {}; if (!slot.dependencies || dependencies.some((value, index) => !Object.is(value, slot.dependencies[index]))) { slot.dependencies = dependencies; effects.push(() => { slot.cleanup?.(); slot.cleanup = callback(); }); } },
  };
  const { ManagementApp } = createManagementUi({ ...hooks, h: (type, props) => ({ type, props }), useLocale: () => locale, translate: key => key,
    browserApi: { runtime: { id: 'shell-fixture', getURL: file => 'chrome-extension://shell-fixture/' + file, getManifest: () => ({ permissions: [] }) }, tabs: { create: value => { createdTabs.push(value); return Promise.resolve(); } } },
  });
  function walk(node, callback, hidden = false) {
    if (Array.isArray(node)) { for (const child of node) walk(child, callback, hidden); return; }
    if (!node?.props) return;
    const invisible = hidden || node.props.hidden === true || node.props.inert === true;
    callback(node, invisible); walk(node.props.children, callback, invisible);
  }
  function render() {
    cursor = 0; changed = false; tree = ManagementApp();
    walk(tree, (node, hidden) => {
      if (!node.props.ref) return;
      const id = node.props.id ?? (node.props['data-management-menu-toggle'] ? 'menu-toggle' : null);
      assert.ok(id, 'Every shell ref has a stable test identity');
      let element = elements.get(id);
      if (!element) {
        element = { id, hidden, contains: value => value?.parentId === id, querySelectorAll: () => [], scrollIntoView() {}, focus() { focusAttempts.push({ id, hidden: this.hidden }); if (this.hidden) return; document.activeElement = this; this.onFocus?.(); } };
        elements.set(id, element);
      }
      element.hidden = hidden; element.onFocus = node.props.onFocus;
      node.props.ref(element);
    });
    // Browser hiding a focused control moves activeElement out of that subtree.
    if (document.activeElement?.hidden) document.activeElement = document.body;
    while (effects.length) effects.shift()();
  }
  function flush() { for (let index = 0; changed && index < 12; index++) render(); assert.equal(changed, false); }
  function nodes(predicate) { const found = []; walk(tree, node => { if (predicate(node)) found.push(node); }); return found; }
  const attr = (key, value = true) => nodes(node => node.props[key] === value)[0];
  function resize(wide) { media.matches = wide; for (const callback of mediaListeners) callback(); }
  function drain() { for (const [id, callback] of [...frames]) { frames.delete(id); callback(); } flush(); }
  function unmount() { for (const slot of slots) slot.cleanup?.(); for (const [key, descriptor] of previous) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]; }
  flush();
  return { document, elements, attr, nodes, resize, flush, drain, unmount, frames, focusAttempts, location, mediaListeners, createdTabs,
    focus: id => elements.get(id).focus(), get activeId() { return document.activeElement.id; },
  };
}

test('responsive navigation transfers focus in both directions only after the new control commits visible', () => {
  const f = fixture();
  try {
    f.focus('management-tab-settings'); f.resize(false);
    assert.equal(f.activeId, 'management-tab-settings', 'no attempt to focus the still-hidden menu before commit');
    f.flush(); assert.equal(f.activeId, 'body'); assert.equal(f.attr('data-management-navigation').props.hidden, true);
    f.drain(); assert.equal(f.activeId, 'menu-toggle');
    f.resize(true); assert.equal(f.activeId, 'menu-toggle');
    f.flush(); assert.equal(f.activeId, 'body'); f.drain();
    assert.equal(f.activeId, 'management-tab-settings');
    assert.equal(f.focusAttempts.some(row => row.hidden), false);
  } finally { f.unmount(); }
});

test('another focused field wins over a pending resize transfer and an unrelated field is never displaced', () => {
  const f = fixture();
  try {
    f.focus('management-tab-settings'); f.resize(false); f.flush();
    f.document.activeElement = { id: 'edited-field' }; f.drain(); assert.equal(f.activeId, 'edited-field');
    f.resize(true); f.flush(); f.drain(); assert.equal(f.activeId, 'edited-field');
  } finally { f.unmount(); }
});

test('rapid viewport changes cancel the obsolete transfer and unmount cancels its animation frame', () => {
  const f = fixture(); let closed = false;
  try {
    f.focus('management-tab-settings'); f.resize(false); f.flush(); assert.equal(f.frames.size, 1);
    f.resize(true); f.flush(); f.drain();
    assert.equal(f.focusAttempts.filter(row => row.id === 'menu-toggle').length, 0);
    f.focus('management-tab-settings'); f.resize(false); f.flush(); assert.equal(f.frames.size, 1);
    f.unmount(); closed = true; assert.equal(f.frames.size, 0); assert.equal(f.mediaListeners.size, 0);
  } finally { if (!closed) f.unmount(); }
});

test('narrow menu disclosure and Escape restore the visible toggle without changing the route', () => {
  const f = fixture(false);
  try {
    const toggle = () => f.attr('data-management-menu-toggle');
    assert.equal(toggle().props['aria-expanded'], false); assert.equal(f.attr('data-management-navigation').props.hidden, true);
    toggle().props.onClick(); f.flush(); assert.equal(toggle().props['aria-expanded'], true);
    f.focus('management-tab-settings'); let prevented = false, stopped = false;
    f.attr('data-management-navigation').props.onKeyDown({ key: 'Escape', preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
    f.flush(); assert.equal(prevented, true); assert.equal(stopped, true); assert.equal(f.activeId, 'menu-toggle');
    assert.equal(toggle().props['aria-expanded'], false); assert.equal(f.location.hash, '#settings');
  } finally { f.unmount(); }
});

test('manual-activation primary tabs keep one keyboard stop and preserve RTL arrows, Home and End', () => {
  for (const locale of ['en', 'ar']) {
    const f = fixture(true, locale);
    try {
      const selected = f.attr('data-management-tab', 'settings'); let prevented = false;
      selected.props.onKeyDown({ key: 'ArrowRight', preventDefault() { prevented = true; } }); f.flush();
      assert.equal(prevented, true); assert.equal(f.activeId, 'management-tab-' + (locale === 'ar' ? 'integrations' : 'contacts'));
      assert.equal(f.location.hash, '#settings', 'arrow focus does not commit a route');
      assert.equal(f.nodes(node => node.props.role === 'tab' && node.props.tabIndex === 0).length, 1);
      for (const [key, id] of [['Home', MANAGEMENT_TABS[0]], ['End', MANAGEMENT_TABS.at(-1)]]) {
        f.attr('data-management-tab', 'settings').props.onKeyDown({ key, preventDefault() {} }); f.flush(); assert.equal(f.activeId, 'management-tab-' + id);
      }
    } finally { f.unmount(); }
  }
});

test('API tools entry works without a source tab and opens only the original trusted settings document', () => {
  for (const locale of ['en', 'ar']) {
    const f = fixture(true, locale, '#integrations');
    try {
      const api = f.attr('data-management-tab', 'integrations');
      assert.equal(api.props['aria-selected'], true);
      assert.equal(f.nodes(node => node.props['data-management-integrations']).length, 1);
      const tools = f.attr('data-management-group', 'tools');
      assert.deepEqual(tools.props.children[1].props.children.map(node => node.props['data-management-tab']), ['integrations', 'settings', 'contacts']);
      assert.equal(f.createdTabs.length, 0);
      f.attr('data-api-precursor').props.onClick();
      assert.deepEqual(f.createdTabs, [{ url: 'chrome-extension://shell-fixture/precursor-settings.html' }]);
      // ADR-109: the second entry sits right after the first, has a proper-name title and opens only its own page.
      const entries = f.nodes(node => node.props['data-management-integrations'])[0].props.children;
      assert.deepEqual(entries.slice(1).map(node => Object.keys(node.props).find(key => key.startsWith('data-api-'))), ['data-api-precursor', 'data-api-proxy-geo']);
      const geo = f.attr('data-api-proxy-geo'), text = geo.props.children[1].props.children;
      assert.equal(geo.props.class, f.attr('data-api-precursor').props.class);
      assert.deepEqual([text[0].props.dir, text[0].props.children, text[1].props.children], ['ltr', 'Proxy Manager Geolocation API', proxyGeoSettingsLabels(locale).entry_subtitle]);
      assert.equal(f.createdTabs.length, 1, 'rendering opens nothing');
      geo.props.onClick();
      assert.deepEqual(f.createdTabs, [{ url: 'chrome-extension://shell-fixture/precursor-settings.html' }, { url: 'chrome-extension://shell-fixture/proxy-geo-settings.html' }]);
      assert.equal(f.location.hash, '#integrations');
      f.attr('data-management-tab', 'settings').props.onClick();
      assert.equal(f.location.hash, '#settings');
    } finally { f.unmount(); }
  }
});
