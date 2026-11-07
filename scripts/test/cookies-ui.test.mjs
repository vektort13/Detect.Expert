// ADR-069: explicit cookie actions, view lifecycle and portable preview controls.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createCookiesUi, cookieWorkspaceRows, cookieWorkspaceEditorRecord } from '../../apps/production-extension/cookies-ui.js';
import { unixSecondsToDateTime } from '../../apps/production-extension/cookie-time.js';
import { MANAGEMENT_SECTIONS, managementSectionForHash, managementHashForSection } from '../../apps/production-extension/management-ui.js';
import { COOKIES_WORKSPACE_KEYS, COOKIES_WORKSPACE_MESSAGES, applyCookiesCopy } from '../production-locales-cookies.mjs';
import { applyBrowserDebugCopy } from '../production-locales-browser-debug.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';

const turn = () => new Promise(resolve => setImmediate(resolve));
// The page's translator: $NAME$ is replaced by the value whose position the placeholder's "content" ($1, $2) names.
const message = (table, key, substitutions = []) => { const entry = table[key]; if (!entry) return key; return entry.message.replace(/\$([A-Za-z_]+)\$/gu, (token, name) => { const content = entry.placeholders?.[name.toLowerCase()]?.content; return content ? substitutions[Number(content.slice(1)) - 1] ?? '' : token; }); };
const record = (id = 'a', changes = {}) => ({ id, name: 'cookie-' + id, domain: 'owned.example.test', path: '/', hostOnly: true, secure: true, httpOnly: true, sameSite: 'lax', session: true, expirationDate: null, storeId: '0', partitionKey: null, firstPartyDomain: null, ...changes });
const result = changes => ({ changed: true, succeeded: 1, failed: 0, skipped: 0, conflicts: 0, adjusted: 0, unknown: 0, undoAvailable: true, results: [], ...changes });
function server() {
  const calls = [], state = { rows: [record()], ready: true, onInvalidate: null, failure: null }; let running = null;
  // The real controller runs one operation at a time; an overlapping call is refused. The fake yields once so that overlaps are possible at all.
  const exclusive = async (name, work) => { if (running) throw Object.assign(Error('safe'), { code: 'busy' }); running = name; try { await turn(); return await work(); } finally { running = null; } };
  const track = (name, value) => { calls.push({ name, value }); if (state.failure?.name === name) throw Object.assign(Error('safe'), { code: state.failure.code, ...(state.failure.outcome ? { outcome: state.failure.outcome } : {}) }); };
  const preview = options => ({ token: 'preview-token', format: 'json', sourceStores: [{ id: 'source' }], rows: [record('imported', { action: options.storeMap?.source ? 'create' : 'error', code: options.storeMap?.source ? null : 'target-required' })], counts: { total: 1, create: options.storeMap?.source ? 1 : 0, error: options.storeMap?.source ? 0 : 1 }, errors: options.storeMap?.source ? [] : [{ code: 'target-required' }], warnings: [] });
  const controller = {
    access() { return exclusive('access', async () => { track('access'); return { status: state.ready ? 'ready' : 'permission-required', stores: state.ready ? [{ id: '0' }, { id: 'container' }] : [], capabilities: { partitionKey: true, hasCrossSiteAncestor: true, firstPartyDomain: false, ...state.capabilities }, browser: state.browser ?? 'chrome' }; }); },
    grant() { track('grant'); state.ready = true; return Promise.resolve(true); },
    load(options) { return exclusive('load', async () => { track('load', options); return { token: 'snapshot-token', rows: state.rows, count: state.rows.length, truncated: false }; }); },
    async reveal(id) { track('reveal', id); return state.revealPromise ?? 'RAW_VALUE_FROM_EXPLICIT_REVEAL'; },
    async describe(id) { track('describe', id); return state.describePromise ?? { ...record(id ?? 'new'), name: id === null ? '' : 'cookie-' + id, value: 'EDITOR_ONLY_VALUE', ...(id === null ? { domain: '' } : {}), ...state.descriptionRecord }; },
    async save(id, cookie) { track('save', { id, cookie }); return result(state.result); },
    async remove(ids) { track('remove', ids); return result(state.result); },
    async prepareImport(text, options) { track('prepareImport', { text, options }); return preview(options); },
    async updateImport(token, options) { track('updateImport', { token, options }); return preview(options); },
    async applyImport(token, ids) { track('applyImport', { token, ids }); return result(state.result); },
    cancelImport(token) { track('cancelImport', token); },
    async prepareExport(token, ids, options) { track('prepareExport', { token, ids, options }); return state.exportPromise ?? { text: '{"exact":"EXPORT_VALUE"}', filename: 'owned.json', warnings: [] }; },
    async undo() { track('undo'); return result({ undoAvailable: false }); },
    setActive(value) { track('setActive', value); }, dispose() { track('dispose'); },
  };
  return { calls, state, controller, count: name => calls.filter(call => call.name === name).length };
}
function harness({ source = server(), locale = 'en', props: initial = {}, focusModel = false } = {}) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document'), listeners = new Map(), document = { visibilityState: 'visible', addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name, fn) { if (listeners.get(name) === fn) listeners.delete(name); } };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  const previousFrames = new Map(['requestAnimationFrame', 'cancelAnimationFrame'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const elements = new Map(), frames = new Map(), focusAttempts = []; let frameId = 0;
  const body = { isConnected: true, focus() { document.activeElement = this; } }; document.body = body; document.activeElement = body;
  const elementKey = (key, value) => key + ':' + String(value);
  function focusElement(key) {
    if (!elements.has(key)) elements.set(key, { key, isConnected: true, disabled: false, focus() { focusAttempts.push(key); if (this.isConnected && !this.disabled) document.activeElement = this; } });
    return elements.get(key);
  }
  const dialogInput = focusElement('dialog-input');
  const nativeDialog = { open: false, isConnected: false, showModal() { this.open = true; dialogInput.focus(); }, close() { this.open = false; if (document.activeElement === dialogInput) document.activeElement = body; }, setAttribute() { this.open = true; }, querySelector() { return dialogInput; } };
  if (focusModel) {
    Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: callback => { const id = ++frameId; frames.set(id, callback); return id; } });
    Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: id => frames.delete(id) });
  }
  const slots = [], effects = [], downloads = []; let cursor = 0, dirty = true, tree, props = { active: true, ...initial };
  const table = applyCookiesCopy(applyBrowserDebugCopy({}, locale), locale);
  const hooks = {
    useState(initial) { const slot = slots[cursor++] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slot.value, next => { const value = typeof next === 'function' ? next(slot.value) : next; if (!Object.is(value, slot.value)) { slot.value = value; dirty = true; } }]; },
    useRef(initial) { return (slots[cursor++] ??= { ref: { current: initial } }).ref; },
    useEffect(callback, dependencies) { const slot = slots[cursor++] ??= {}; if (!slot.dependencies || dependencies?.some((value, index) => !Object.is(value, slot.dependencies[index]))) { slot.dependencies = dependencies; effects.push(() => { slot.cleanup?.(); slot.cleanup = callback(); }); } },
  };
  const ui = createCookiesUi({ ...hooks, h: (type, props) => ({ type, props }), useLocale: () => locale, translate: (key, substitutions) => message(table, key, substitutions), browserApi: {}, createController: (_api, options) => { source.state.onInvalidate = options.onInvalidate; return source.controller; }, downloadFile: (filename, text) => downloads.push({ filename, text }) });
  function render() {
    cursor = 0; dirty = false; tree = ui.CookiesApp(props);
    if (focusModel) {
      for (const element of elements.values()) element.isConnected = false;
      nativeDialog.isConnected = false;
      for (const node of nodes(() => true)) {
        const attribute = Object.keys(node.props).find(key => key.startsWith('data-cookies-'));
        const element = attribute ? focusElement(elementKey(attribute, node.props[attribute])) : null;
        if (element) { element.isConnected = true; element.disabled = node.props.disabled === true; }
        if (node.type === 'dialog') { nativeDialog.isConnected = true; dialogInput.isConnected = true; if (node.props.ref) node.props.ref.current = nativeDialog; }
      }
      // Native disabling/removing a focused opener happens before passive effects.
      if (document.activeElement?.disabled || document.activeElement?.isConnected === false) document.activeElement = body;
    }
    while (effects.length) effects.shift()(); return tree;
  }
  async function settle() { for (let index = 0; index < 8; index++) { if (dirty) render(); await turn(); } if (dirty) render(); return tree; }
  function nodes(predicate) { const found = []; function visit(node) { if (Array.isArray(node)) return node.forEach(visit); if (!node?.props) return; if (predicate(node)) found.push(node); visit(node.props.children); } visit(tree); return found; }
  const attr = (key, value = true) => nodes(node => node.props[key] === value)[0];
  function update(next) { props = { ...props, ...next }; dirty = true; render(); }
  function text(node) { if (arguments.length === 0) node = tree; if (Array.isArray(node)) return node.map(value => text(value)).join(' '); if (node?.props) return text(node.props.children); return typeof node === 'string' || typeof node === 'number' ? String(node) : ''; }
  return { source, render, settle, nodes, attr, text, downloads, table, update,
    focus(key, value = true) { const element = focusElement(elementKey(key, value)); element.focus(); return element; },
    get activeElement() { return document.activeElement; }, body, frames, focusAttempts,
    drainFrames() { for (const [id, callback] of [...frames]) { frames.delete(id); callback(); } },
    hide() { document.visibilityState = 'hidden'; listeners.get('visibilitychange')?.(); },
    show() { document.visibilityState = 'visible'; listeners.get('visibilitychange')?.(); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; if (focusModel) for (const [key, descriptor] of previousFrames) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]; },
  };
}
const click = (h, attr, value = true) => h.attr(attr, value).props.onClick();
const input = (h, attr, value, key = true) => h.attr(attr, key).props.onInput({ currentTarget: { value } });
const select = (h, attr, value, key = true) => h.attr(attr, key).props.onChange({ currentTarget: { value } });
async function opened(options) { const h = harness(options); h.render(); await h.settle(); return h; }

test('Cookies retains its canonical tab inside the requested Attack group', () => {
  assert.deepEqual(MANAGEMENT_SECTIONS, ['hub', 'detector', 'api', 'firewall', 'antidetect', 'autosurf', 'cookies', 'proxy', 'integrations', 'settings', 'contacts', 'browser-debug']);
  assert.equal(managementSectionForHash('#cookies'), 'cookies'); assert.equal(managementHashForSection('cookies'), '#cookies');
});
test('all 21 catalogs contain every cookie label without fallback; metadata sorting never searches values', () => {
  assert.equal(new Set(COOKIES_WORKSPACE_KEYS).size, 99);
  for (const language of PRODUCTION_LANGUAGES) {
    assert.deepEqual(Object.keys(COOKIES_WORKSPACE_MESSAGES[language.id]).sort(), [...COOKIES_WORKSPACE_KEYS].sort());
    for (const key of COOKIES_WORKSPACE_KEYS) assert.ok(COOKIES_WORKSPACE_MESSAGES[language.id][key].trim(), language.id + '/' + key);
  }
  const rows = [record('z', { value: 'UNSEARCHABLE_SECRET' }), record('a')];
  assert.deepEqual(cookieWorkspaceRows(rows, '', 'name').map(row => row.id), ['a', 'z']); assert.equal(cookieWorkspaceRows(rows, 'UNSEARCHABLE_SECRET').length, 0);
  assert.equal(cookieWorkspaceRows(rows, 'owned.example').length, 2); assert.deepEqual(rows.map(row => row.id), ['z', 'a']);
});
test('editor preserves empty value, session and nullable partition ancestor; expiry validation is typed', () => {
  const values = { ...record(), value: '', partitioned: false, partitionTopLevelSite: '', partitionAncestor: 'unspecified', firstPartyDomain: '', expirationDate: '' };
  delete values.id;
  assert.equal(cookieWorkspaceEditorRecord(values).value, ''); assert.equal(cookieWorkspaceEditorRecord(values).expirationDate, null);
  assert.equal(cookieWorkspaceEditorRecord({ ...values, session: false }), null);
  assert.equal(cookieWorkspaceEditorRecord({ ...values, session: false, expirationDate: '2000000000.25' }).expirationDate, 2000000000.25);
  assert.deepEqual(cookieWorkspaceEditorRecord({ ...values, partitioned: true, partitionTopLevelSite: 'https://example.test', partitionAncestor: 'false' }).partitionKey, { topLevelSite: 'https://example.test', hasCrossSiteAncestor: false });
  for (const site of ['https://user:pass@example.test', 'https://example.test/path', 'https://example.test?token=x', 'javascript:alert(1)']) assert.equal(cookieWorkspaceEditorRecord({ ...values, partitioned: true, partitionTopLevelSite: site }), null);
});
test('with access the section reads every store by itself (metadata only); explicit Reveal is the only value read', async () => {
  const h = await opened(); try {
    assert.equal(h.source.count('access'), 1); assert.equal(h.source.count('load'), 1); assert.deepEqual(h.source.calls.find(call => call.name === 'load').value, { storeId: '*', domain: '' });
    assert.equal(h.source.count('reveal'), 0); assert.equal(h.source.count('describe'), 0);
    assert.equal(h.attr('data-cookies-status', 'not-loaded'), undefined, 'nothing waits for the Load button'); assert.equal(h.attr('data-cookies-count', 1).props['data-cookies-count'], 1);
    assert.equal(h.attr('data-cookies-store').props.value, '*', 'all stores are the default scope');
    await click(h, 'data-cookies-load'); await h.settle(); assert.equal(h.source.count('load'), 2, 'Refresh reads again'); assert.equal(h.attr('data-cookies-count', 1).props['data-cookies-count'], 1);
    assert.equal(h.attr('data-cookies-value', 'a'), undefined); assert.doesNotMatch(h.text(), /RAW_VALUE/);
    await click(h, 'data-cookies-reveal', 'a'); await h.settle(); assert.equal(h.attr('data-cookies-value', 'a').props.children, 'RAW_VALUE_FROM_EXPLICIT_REVEAL');
    click(h, 'data-cookies-reveal', 'a'); await h.settle(); assert.equal(h.attr('data-cookies-value', 'a'), undefined); assert.equal(h.source.count('reveal'), 1);
    assert.equal(h.source.count('save') + h.source.count('remove') + h.source.count('applyImport'), 0);
  } finally { h.unmount(); }
});
test('results table shows existing SameSite and expiry metadata as pills while the value stays masked until Reveal', async () => {
  const source = server(); source.state.rows = [record('a'), record('b', { session: false, expirationDate: 2000000000, sameSite: 'no_restriction', httpOnly: false, partitionKey: { topLevelSite: 'https://owned.example.test' } })];
  const h = await opened({ source }); try {
    await click(h, 'data-cookies-load'); await h.settle(); assert.equal(h.source.count('reveal'), 0);
    assert.equal(h.nodes(node => node.type === 'th' && node.props.class === 'cookies-workspace-expiry-column').length, 1);
    const pills = id => h.text(h.attr('data-cookies-record', id)); assert.match(pills('a'), /SameSite: Lax/); assert.match(pills('b'), /SameSite: None/); assert.match(pills('b'), /2033/);
    assert.equal(h.nodes(node => node.props.class === 'cookies-workspace-pill cookies-workspace-pill--session').length, 1);
    assert.equal(h.nodes(node => node.props.class === 'cookies-workspace-masked').length, 2); assert.equal(h.nodes(node => node.props['data-cookies-value']).length, 0); assert.doesNotMatch(h.text(), /RAW_VALUE/);
    assert.equal(h.nodes(node => node.type === 'button' && !node.props.type).length, 0);
  } finally { h.unmount(); }
});
test('permission grant stays on the click stack; nothing is read before it, and the section reads every store right after', async () => {
  const source = server(); source.state.ready = false; const h = await opened({ source });
  try {
    assert.equal(source.count('load'), 0, 'no read while access is missing'); assert.ok(h.attr('data-cookies-grant'));
    const pending = click(h, 'data-cookies-grant'); assert.equal(source.count('grant'), 1); await pending; await h.settle();
    assert.equal(source.count('load'), 1, 'access exists: the section reads by itself'); assert.deepEqual(source.calls.find(call => call.name === 'load').value, { storeId: '*', domain: '' });
    assert.equal(h.attr('data-cookies-count', 1).props['data-cookies-count'], 1); assert.equal(h.attr('data-cookies-load').props.disabled, false); assert.equal(h.attr('data-cookies-error'), undefined);
  } finally { h.unmount(); }
});
test('the automatic read is once per view: a failed read is not retried, a changed scope waits for the button, a page shown again reads again', async () => {
  const source = server(); source.state.failure = { name: 'load', code: 'timeout' }; const h = await opened({ source });
  try {
    assert.equal(source.count('load'), 1); assert.ok(h.attr('data-cookies-error')); await h.settle(); await h.settle(); assert.equal(source.count('load'), 1, 'a failed read is not retried in a loop');
    source.state.failure = null; select(h, 'data-cookies-store', '0'); await h.settle(); assert.equal(source.count('load'), 1, 'a changed scope is read by the button only');
    await click(h, 'data-cookies-load'); await h.settle(); assert.equal(source.count('load'), 2); assert.equal(source.calls.filter(call => call.name === 'load').at(-1).value.storeId, '0');
    h.hide(); await h.settle(); assert.equal(h.attr('data-cookies-count'), undefined, 'hiding the page erases the list'); const accessBefore = source.count('access');
    h.show(); await h.settle(); assert.equal(source.count('access'), accessBefore + 1); assert.equal(source.count('load'), 3, 'the page shown again reads again'); assert.equal(h.attr('data-cookies-count', 1).props['data-cookies-count'], 1);
    assert.equal(source.count('save') + source.count('remove') + source.count('applyImport') + source.count('reveal'), 0);
  } finally { h.unmount(); }
});
test('the list is sorted by domain name: case and the leading dot of a domain cookie do not matter; ties go by path, name and id', () => {
  const rows = [record('1', { domain: 'zeta.example.org' }), record('2', { domain: '.Example.com', path: '/b' }), record('3', { domain: 'alpha.example.net' }), record('4', { domain: 'example.com', path: '/a' }), record('5', { domain: 'WWW.example.com' }), record('6', { domain: '.example.com', path: '/b', name: 'a-first' })];
  assert.deepEqual(cookieWorkspaceRows(rows).map(row => row.id), ['3', '4', '6', '2', '5', '1']);
  assert.deepEqual(cookieWorkspaceRows(rows, '', 'domain').map(row => row.id), ['3', '4', '6', '2', '5', '1']);
  assert.deepEqual(rows.map(row => row.id), ['1', '2', '3', '4', '5', '6'], 'the input is not reordered');
});

test('Cookie modal focus returns to the original synchronous Import, Export and removal opener', async () => {
  const h = await opened({ focusModel: true });
  try {
    await click(h, 'data-cookies-load'); await h.settle();
    for (const [attribute, value] of [['data-cookies-import', true], ['data-cookies-export', true], ['data-cookies-remove', 'a']]) {
      const opener = h.focus(attribute, value); click(h, attribute, value); await h.settle(); h.drainFrames();
      assert.ok(h.nodes(node => node.type === 'dialog').length === 1); assert.notEqual(h.activeElement, opener);
      if (attribute === 'data-cookies-import') { input(h, 'data-cookies-import-text', 'PRIVATE_DRAFT'); await h.settle(); h.nodes(node => node.type === 'dialog')[0].props.onCancel({ preventDefault() {} }); }
      else click(h, 'data-cookies-cancel');
      await h.settle(); assert.equal(h.activeElement, opener, attribute + ': capture must precede disabled-trigger commit');
      assert.equal(h.nodes(node => node.type === 'dialog').length, 0); assert.doesNotMatch(h.text(), /PRIVATE_DRAFT/);
    }
    h.attr('data-cookies-select', 'a').props.onChange({ currentTarget: { checked: true } }); await h.settle();
    const selectedOpener = h.focus('data-cookies-delete-selected'); click(h, 'data-cookies-delete-selected'); await h.settle(); h.drainFrames();
    assert.ok(h.attr('data-cookies-dialog', 'remove')); click(h, 'data-cookies-cancel'); await h.settle(); assert.equal(h.activeElement, selectedOpener);
    assert.equal(h.source.count('save') + h.source.count('remove') + h.source.count('applyImport'), 0);
  } finally { h.unmount(); }
});

test('Cookie Edit/Create captures focus before the asynchronous busy render disables its original trigger', async () => {
  const source = server();
  const h = await opened({ source, focusModel: true });
  try {
    await click(h, 'data-cookies-load'); await h.settle();
    for (const [attribute, value] of [['data-cookies-edit', 'a'], ['data-cookies-create', true]]) {
      let resolveDescribe; source.state.describePromise = new Promise(resolve => { resolveDescribe = resolve; });
      const opener = h.focus(attribute, value), pending = click(h, attribute, value); await h.settle();
      assert.equal(h.attr(attribute, value).props.disabled, true); assert.equal(h.activeElement, h.body); assert.equal(h.nodes(node => node.type === 'dialog').length, 0);
      resolveDescribe({ ...record(), value: 'ASYNC_EDITOR_SECRET' }); await pending; await h.settle(); h.drainFrames();
      assert.ok(h.attr('data-cookies-dialog', 'editor')); click(h, 'data-cookies-cancel'); await h.settle();
      assert.equal(h.activeElement, opener); assert.equal(h.nodes(node => node.type === 'dialog').length, 0); assert.doesNotMatch(h.text(), /ASYNC_EDITOR_SECRET/); assert.equal(source.count('save'), 0);
    }
  } finally { h.unmount(); }
});

test('Cookie modal cleanup cancels pending initial focus and never restores an inactive or unmounted trigger', async () => {
  const h = await opened({ focusModel: true }); let closed = false;
  try {
    const opener = h.focus('data-cookies-import'); click(h, 'data-cookies-import'); await h.settle(); assert.equal(h.frames.size, 1);
    click(h, 'data-cookies-cancel'); await h.settle(); assert.equal(h.frames.size, 0); assert.equal(h.activeElement, opener);
    const attempts = h.focusAttempts.length; h.drainFrames(); assert.equal(h.focusAttempts.length, attempts);
    const exportOpener = h.focus('data-cookies-import'); click(h, 'data-cookies-import'); await h.settle();
    const beforeHide = h.focusAttempts.filter(key => key === exportOpener.key).length;
    h.update({ active: false }); await h.settle(); assert.equal(h.frames.size, 0); assert.equal(h.focusAttempts.filter(key => key === exportOpener.key).length, beforeHide); assert.equal(h.nodes(node => node.type === 'dialog').length, 0);
    h.update({ active: true }); await h.settle(); h.focus('data-cookies-import'); click(h, 'data-cookies-import'); await h.settle();
    const beforeUnmount = h.focusAttempts.filter(key => key === exportOpener.key).length;
    h.unmount(); closed = true; assert.equal(h.frames.size, 0); assert.equal(h.focusAttempts.filter(key => key === exportOpener.key).length, beforeUnmount);
  } finally { if (!closed) h.unmount(); }
});
test('all stores, paged selection, search and sorting are view-only; export contains exactly the prepared preview', async () => {
  const source = server(); source.state.rows = Array.from({ length: 130 }, (_, index) => record(String(index).padStart(2, '0'))); const h = await opened({ source });
  try {
    select(h, 'data-cookies-store', '*'); await h.settle(); await click(h, 'data-cookies-load'); await h.settle(); assert.equal(source.calls.find(call => call.name === 'load').value.storeId, '*');
    assert.equal(h.nodes(node => node.props['data-cookies-record']).length, 100, 'a page holds a hundred rows'); h.attr('data-cookies-select-page').props.onChange({ currentTarget: { checked: true } }); await h.settle();
    click(h, 'data-cookies-next'); await h.settle(); assert.equal(h.nodes(node => node.props['data-cookies-record']).length, 30);
    click(h, 'data-cookies-export'); await h.settle(); assert.equal(h.attr('data-cookies-download').props.disabled, true); assert.equal(source.count('prepareExport'), 0);
    await click(h, 'data-cookies-export-prepare'); await h.settle(); const prepared = source.calls.find(call => call.name === 'prepareExport'); assert.equal(prepared.value.ids.length, 100); assert.deepEqual(prepared.value.options, { format: 'json', allowLossy: false });
    assert.equal(h.attr('data-cookies-export-preview').props.children[1].props.value, '{"exact":"EXPORT_VALUE"}'); click(h, 'data-cookies-download'); assert.deepEqual(h.downloads, [{ filename: 'owned.json', text: '{"exact":"EXPORT_VALUE"}' }]);
    source.state.failure = { name: 'prepareExport', code: 'conflict' }; await click(h, 'data-cookies-export-prepare'); await h.settle(); assert.equal(h.attr('data-cookies-download').props.disabled, true);
    click(h, 'data-cookies-cancel'); await h.settle(); input(h, 'data-cookies-search', 'cookie-00'); await h.settle(); assert.equal(h.nodes(node => node.props['data-cookies-record']).length, 1); assert.equal(source.count('save'), 0);
  } finally { h.unmount(); }
});
test('edit locks exact identity, retains full value limits, and does not write before Save', async () => {
  const h = await opened(); try {
    await click(h, 'data-cookies-load'); await h.settle(); await click(h, 'data-cookies-edit', 'a'); await h.settle();
    for (const key of ['name', 'domain', 'path', 'storeId', 'hostOnly', 'partitioned', 'partitionTopLevelSite', 'partitionAncestor', 'firstPartyDomain']) assert.equal(h.attr('data-cookies-field', key).props.disabled, true, key);
    assert.equal(h.attr('data-cookies-field', 'value').props.maxLength, 65536); assert.equal(h.attr('data-cookies-field', 'value').props.type, 'password'); assert.equal(h.source.count('save'), 0);
    input(h, 'data-cookies-field', '', 'value'); await h.settle(); const form = h.nodes(node => node.type === 'form')[0]; await form.props.onSubmit({ preventDefault() {} }); await h.settle();
    const saved = h.source.calls.find(call => call.name === 'save'); assert.equal(saved.value.cookie.value, ''); assert.equal(saved.value.id, 'a'); assert.ok(h.attr('data-cookies-result'));
  } finally { h.unmount(); }
});
test('import previews metadata, requires every store mapping, and writes only after explicit Apply', async () => {
  const h = await opened(); try {
    click(h, 'data-cookies-import'); await h.settle(); input(h, 'data-cookies-import-text', '{"value":"IMPORT_SECRET"}'); await h.settle();
    await click(h, 'data-cookies-import-prepare'); await h.settle(); assert.equal(h.source.count('applyImport'), 0); assert.ok(h.attr('data-cookies-import-preview')); assert.equal(h.attr('data-cookies-import-apply').props.disabled, true); assert.doesNotMatch(h.text(), /IMPORT_SECRET/);
    await select(h, 'data-cookies-map-store', '0', 'source'); await h.settle(); assert.equal(h.attr('data-cookies-import-apply').props.disabled, false); assert.equal(h.source.count('applyImport'), 0);
    await click(h, 'data-cookies-import-apply'); await h.settle(); assert.equal(h.source.count('applyImport'), 1); assert.equal(h.attr('data-cookies-dialog'), undefined); assert.ok(h.attr('data-cookies-undo'));
    await click(h, 'data-cookies-undo'); await h.settle(); assert.equal(h.source.count('undo'), 1);
  } finally { h.unmount(); }
});
test('unsupported Firefox unspecified SameSite stays readable but cannot be newly selected or silently converted', async () => {
  const source = server(); source.state.capabilities = { unspecifiedSameSite: false }; source.state.descriptionRecord = { sameSite: 'unspecified' }; const h = await opened({ source });
  try {
    await click(h, 'data-cookies-load'); await h.settle(); await click(h, 'data-cookies-edit', 'a'); await h.settle();
    const sameSite = h.attr('data-cookies-field', 'sameSite'); assert.equal(sameSite.props.value, 'unspecified');
    const options = sameSite.props.children; assert.equal(options.find(option => option.props.value === 'unspecified').props.disabled, true);
    for (const option of options.filter(option => option.props.value !== 'unspecified')) assert.equal(option.props.disabled, false);
    assert.equal(source.count('save'), 0); click(h, 'data-cookies-cancel'); await h.settle(); await click(h, 'data-cookies-create'); await h.settle();
    assert.equal(h.attr('data-cookies-field', 'sameSite').props.children.find(option => option.props.value === 'unspecified').props.disabled, true);
  } finally { h.unmount(); }
});
test('single-write readback failure displays an unconfirmed outcome with the cause and never claims Saved', async () => {
  const h = await opened({ locale: 'ru' });
  try {
    await click(h, 'data-cookies-load'); await h.settle(); await click(h, 'data-cookies-edit', 'a'); await h.settle();
    h.source.state.failure = { name: 'save', code: 'timeout', outcome: 'unknown' };
    h.nodes(node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} }); await h.settle();
    assert.equal(h.source.count('save'), 1); assert.ok(h.attr('data-cookies-dialog', 'editor'));
    assert.equal(h.attr('data-cookies-error').props.children, h.table.cookies_workspace_unknown.message + ': ' + h.table.browser_debug_timeout.message);
    assert.doesNotMatch(h.text(), /Сохранено|Saved/); assert.equal(h.attr('data-cookies-result'), undefined);
  } finally { h.unmount(); }
});
test('failed preview update and failed Apply discard their invalidated plans; partial results never claim Saved', async () => {
  const h = await opened(); try {
    click(h, 'data-cookies-import'); await h.settle(); input(h, 'data-cookies-import-text', '[]'); await h.settle(); await click(h, 'data-cookies-import-prepare'); await h.settle();
    h.source.state.failure = { name: 'updateImport', code: 'stale' }; await select(h, 'data-cookies-map-store', '0', 'source'); await h.settle(); assert.equal(h.attr('data-cookies-import-preview'), undefined); assert.ok(h.attr('data-cookies-import-text'));
    h.source.state.failure = null; input(h, 'data-cookies-import-text', '[]'); await h.settle(); await click(h, 'data-cookies-import-prepare'); await h.settle(); await select(h, 'data-cookies-map-store', '0', 'source'); await h.settle();
    h.source.state.failure = { name: 'applyImport', code: 'conflict' }; await click(h, 'data-cookies-import-apply'); await h.settle(); assert.equal(h.attr('data-cookies-import-preview'), undefined);
    click(h, 'data-cookies-cancel'); await h.settle(); h.source.state.failure = null; h.source.state.result = { succeeded: 0, failed: 1, unknown: 1 }; await click(h, 'data-cookies-load'); await h.settle(); click(h, 'data-cookies-remove', 'a'); await h.settle(); await click(h, 'data-cookies-delete-confirm'); await h.settle(); assert.doesNotMatch(h.text(), /Saved/); assert.match(h.text(), /Outcome unknown/);
  } finally { h.unmount(); }
});
test('document hiding, panel changes and permission revocation erase secrets and ignore late reveals', async () => {
  const source = server(); let revealResolve; source.state.revealPromise = new Promise(resolve => { revealResolve = resolve; }); const h = await opened({ source });
  try {
    await click(h, 'data-cookies-load'); await h.settle(); const pending = click(h, 'data-cookies-reveal', 'a'); h.hide(); await h.settle(); revealResolve('LATE_SECRET'); await pending; await h.settle(); assert.doesNotMatch(h.text(), /LATE_SECRET/); assert.equal(h.attr('data-cookies-record', 'a'), undefined); assert.ok(source.calls.some(call => call.name === 'setActive' && call.value === false));
    h.show(); await h.settle(); await click(h, 'data-cookies-create'); await h.settle(); assert.ok(h.attr('data-cookies-dialog', 'editor')); h.update({ active: false }); await h.settle(); assert.equal(h.attr('data-cookies-dialog'), undefined);
    h.update({ active: true }); await h.settle(); await click(h, 'data-cookies-load'); await h.settle(); click(h, 'data-cookies-export'); await h.settle(); await click(h, 'data-cookies-export-prepare'); await h.settle(); const capturedDownload = h.attr('data-cookies-download').props.onClick;
    source.state.onInvalidate({ reason: 'permissions' }); await h.settle(); capturedDownload(); assert.equal(h.downloads.length, 0); assert.equal(h.attr('data-cookies-export-preview'), undefined); assert.equal(h.attr('data-cookies-dialog'), undefined);
  } finally { h.unmount(); }
});
test('every current core/controller/crypto failure renders a localized message in all 21 languages', async () => {
  const codes = ['unauthorized', 'inactive', 'busy', 'timeout', 'unsupported', 'permission-required', 'permission-denied', 'invalid-input', 'invalid-json', 'invalid-format', 'unsupported-version', 'invalid-cookie', 'duplicate-key', 'duplicate-cookie', 'duplicate-store', 'duplicate-target', 'target-required', 'unknown-store', 'stale', 'conflict', 'ambiguous', 'not-applied', 'capacity', 'unsupported-partition', 'unsupported-first-party-domain', 'unsupported-samesite', 'unsupported-format', 'lossy-export', 'identity-change', 'expired', 'operation-failed', 'invalid-domain', 'invalid-path', 'invalid-expiration', 'invalid-samesite', 'invalid-prefix', 'limit-exceeded', 'invalid-store', 'unsupported-field', 'invalid-encrypted', 'invalid-password', 'decryption-failed', 'too-large', 'unsupported-crypto'];
  for (const language of PRODUCTION_LANGUAGES) {
    const h = await opened({ locale: language.id });
    try {
      for (const code of codes) { h.source.state.failure = { name: 'load', code }; await click(h, 'data-cookies-load'); await h.settle(); assert.ok(h.attr('data-cookies-error'), language.id + '/' + code); assert.doesNotMatch(h.text(), /(?:cookies_workspace|browser_debug|management_tab)_/, language.id + '/' + code); }
      assert.equal(h.source.count('save') + h.source.count('remove') + h.source.count('applyImport'), 0);
    } finally { h.unmount(); }
  }
});
test('a revoked encrypted import cannot start a new native preview after pending decryption finishes', async () => {
  const previousCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto'); let finishKey, decryptCalls = 0;
  const key = new Promise(resolve => { finishKey = resolve; });
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues: value => value, subtle: { importKey: async () => ({}), deriveKey: () => key, decrypt: async () => { ++decryptCalls; return new TextEncoder().encode('[]').buffer; } } } });
  const h = await opened();
  try {
    const envelope = JSON.stringify({ format: 'detect.expert.cookies.encrypted', formatVersion: 1, cipher: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iterations: 600000, salt: 'AAAAAAAAAAAAAAAAAAAAAA==', iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'AAAAAAAAAAAAAAAAAAAAAA==' });
    click(h, 'data-cookies-import'); await h.settle(); input(h, 'data-cookies-import-text', envelope); await h.settle(); input(h, 'data-cookies-password', 'owned-password'); await h.settle(); click(h, 'data-cookies-import-prepare'); await h.settle();
    assert.equal(h.source.count('prepareImport'), 0); h.source.state.onInvalidate({ reason: 'permissions' }); await h.settle(); finishKey({}); await h.settle();
    assert.equal(decryptCalls, 1); assert.equal(h.source.count('prepareImport'), 0); assert.equal(h.attr('data-cookies-dialog'), undefined); assert.doesNotMatch(h.text(), /owned-password/);
  } finally { h.unmount(); if (previousCrypto) Object.defineProperty(globalThis, 'crypto', previousCrypto); else delete globalThis.crypto; }
});
test('revocation during export preparation stops later encryption and rejects retained download callbacks', async () => {
  const previousCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto'); let randomCalls = 0, finishExport;
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues: value => { ++randomCalls; return value; }, subtle: { deriveKey: async () => ({}) } } });
  const source = server(); source.state.exportPromise = new Promise(resolve => { finishExport = resolve; }); const h = await opened({ source });
  try {
    await click(h, 'data-cookies-load'); await h.settle(); click(h, 'data-cookies-export'); await h.settle(); select(h, 'data-cookies-export-format', 'encrypted-json'); await h.settle(); input(h, 'data-cookies-password', 'owned-password'); await h.settle(); click(h, 'data-cookies-export-prepare'); await h.settle();
    source.state.onInvalidate({ reason: 'permissions' }); await h.settle(); finishExport({ text: 'EXPORT_PLAINTEXT', filename: 'owned.json', warnings: [] }); await h.settle();
    assert.equal(randomCalls, 0); assert.equal(h.attr('data-cookies-dialog'), undefined); assert.equal(h.downloads.length, 0); assert.doesNotMatch(h.text(), /EXPORT_PLAINTEXT|owned-password/);
  } finally { h.unmount(); if (previousCrypto) Object.defineProperty(globalThis, 'crypto', previousCrypto); else delete globalThis.crypto; }
});

// ---- Editor completeness, lock explanation and the Unix-seconds <-> date/time converter (ADR-069 addendum 2026-11-07) ----
// A persistent cookie 100 days from the moment the test runs: never in the past, inside Chrome's 400-day reach, with Chrome-style fraction digits.
const SOON_TEXT = (Math.floor(Date.now() / 1000) + 100 * 86400) + '.97721', SOON = Number(SOON_TEXT);
const persistent = (changes = {}) => ({ session: false, expirationDate: SOON, sameSite: 'no_restriction', secure: true, httpOnly: false, hostOnly: false, domain: '.owned.example.test', path: '/', ...changes });
const field = (h, key) => h.attr('data-cookies-field', key);
const detail = (h, key) => h.text(h.attr('data-cookies-detail', key)?.props.children[1]).replace(/\s+/gu, ' ').trim();
const converterError = h => h.nodes(node => node.props['data-cookies-converter-error'] !== undefined)[0];
const problems = h => h.nodes(node => node.props['data-cookies-problem']).map(node => node.props['data-cookies-problem']);
const checked = (h, key, value) => field(h, key).props.onChange({ currentTarget: { checked: value } });
async function editing(descriptionRecord = {}, { state = {}, ...options } = {}) {
  const source = server(); Object.assign(source.state, state); source.state.descriptionRecord = descriptionRecord;
  const h = await opened({ source, ...options }); await click(h, 'data-cookies-load'); await h.settle(); await click(h, 'data-cookies-edit', 'a'); await h.settle(); return h;
}
const saves = h => h.source.calls.filter(call => call.name === 'save');
const submit = async h => { h.nodes(node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} }); await h.settle(); };

test('the editor form carries every attribute the cookies API returns and every choice of every editable attribute is reachable', async () => {
  const everything = persistent({ name: 'full', sameSite: 'strict', httpOnly: true, storeId: 'container', partitionKey: { topLevelSite: 'https://top.example.test', hasCrossSiteAncestor: false }, firstPartyDomain: 'first.example.test', path: '/deep/path' });
  const h = await editing(everything, { state: { capabilities: { firstPartyDomain: true } } });
  try {
    const shown = Object.fromEntries(['name', 'domain', 'path', 'storeId', 'value', 'sameSite', 'expirationDate', 'partitionTopLevelSite', 'partitionAncestor', 'firstPartyDomain'].map(key => [key, field(h, key).props.value]));
    assert.deepEqual(shown, { name: 'full', domain: '.owned.example.test', path: '/deep/path', storeId: 'container', value: 'EDITOR_ONLY_VALUE', sameSite: 'strict', expirationDate: SOON_TEXT, partitionTopLevelSite: 'https://top.example.test', partitionAncestor: 'false', firstPartyDomain: 'first.example.test' });
    assert.deepEqual(['hostOnly', 'secure', 'httpOnly', 'session', 'partitioned'].map(key => field(h, key).props.checked), [false, true, true, false, true]);
    assert.deepEqual(field(h, 'sameSite').props.children.map(option => [option.props.value, option.props.disabled]), [['unspecified', false], ['lax', false], ['strict', false], ['no_restriction', false]], 'all four SameSite choices are offered');
    assert.deepEqual(field(h, 'partitionAncestor').props.children.map(option => [option.props.value, option.props.disabled]), [['unspecified', true], ['true', false], ['false', false]], 'an unknown ancestor bit cannot be written while the browser has the bit');
    assert.deepEqual(h.attr('data-cookies-field', 'storeId').props.children.map(option => option.props.value), ['0', 'container']);
    assert.equal(h.text(h.nodes(node => node.props.id === 'cookies-hint-ancestor')[0]), 'Unspecified: Unavailable in this browser.', 'the disabled Unspecified choice says why'); assert.equal(field(h, 'partitionAncestor').props['aria-describedby'], 'cookies-hint-ancestor');
    for (const key of ['name', 'domain', 'path', 'storeId', 'hostOnly', 'partitioned', 'partitionTopLevelSite', 'partitionAncestor', 'firstPartyDomain']) assert.equal(field(h, key).props.disabled, true, key + ' is an identity field');
    for (const key of ['value', 'sameSite', 'expirationDate', 'secure', 'httpOnly', 'session']) assert.notEqual(field(h, key).props.disabled, true, key + ' stays editable');
    assert.equal(h.attr('data-cookies-datetime').props.disabled, false); assert.equal(h.attr('data-cookies-zone').props.disabled, false);
  } finally { h.unmount(); }
});

test('read-only details: expiry as a date with time left or expired, size measured in UTF-8 bytes, and where the browser sends the cookie', async () => {
  const now = Math.floor(Date.now() / 1000);
  const h = await editing(persistent({ expirationDate: now + 3 * 86400 + 3600, hostOnly: false, domain: '.owned.example.test', path: '/shop', secure: true }));
  try {
    assert.match(detail(h, 'expires'), /\d{4}.* · in 3 days$/); assert.doesNotMatch(detail(h, 'expires'), /Expired/);
    assert.equal(detail(h, 'size'), '25 of 4096 B allowed (name and value)', 'cookie-a + EDITOR_ONLY_VALUE: 8 + 17 bytes, measured against the Chrome limit');
    assert.equal(detail(h, 'host'), 'owned.example.test and all its subdomains'); assert.equal(detail(h, 'path'), '/shop and everything below it'); assert.equal(detail(h, 'connection'), 'HTTPS only');
    assert.equal(h.text(h.attr('data-cookies-details')).includes('EDITOR_ONLY_VALUE'), false, 'the value is never repeated in the details');
    assert.match(h.text(h.attr('data-cookies-details')), /does not report the creation time, last access, priority, source scheme or source port/);
    // The facts follow the form: host-only, plain HTTP, a multi-byte value.
    checked(h, 'hostOnly', true); input(h, 'data-cookies-field', 'owned.example.test', 'domain'); checked(h, 'secure', false); input(h, 'data-cookies-field', 'é€😀', 'value'); await h.settle();
    assert.equal(detail(h, 'host'), 'owned.example.test only, not its subdomains'); assert.equal(detail(h, 'connection'), 'HTTP and HTTPS'); assert.equal(detail(h, 'size'), '17 of 4096 B allowed (name and value)', 'é = 2, € = 3, 😀 = 4 bytes');
  } finally { h.unmount(); }
  const host = await editing({ hostOnly: true, domain: 'owned.example.test', path: '/', secure: false }); try {
    assert.equal(detail(host, 'host'), 'owned.example.test only, not its subdomains'); assert.equal(detail(host, 'path'), '/ and everything below it'); assert.equal(detail(host, 'connection'), 'HTTP and HTTPS');
  } finally { host.unmount(); }
  const expired = await editing(persistent({ expirationDate: now - 2 * 86400 - 3600 })); try { assert.match(detail(expired, 'expires'), /^Expired.* · 2 days ago$/); } finally { expired.unmount(); }
  const session = await editing({}); try { assert.equal(detail(session, 'expires'), 'No expiry date: kept until the browser session ends'); } finally { session.unmount(); }
});

test('the byte limit is shown for Chrome only; a cookie above it is flagged before Save, and so are attribute combinations the browser refuses', async () => {
  const chrome = await editing(persistent());
  try {
    assert.equal(chrome.attr('data-cookies-problems'), undefined, 'a valid cookie raises no problem');
    input(chrome, 'data-cookies-field', 'x'.repeat(5000), 'value'); await chrome.settle();
    assert.equal(chrome.text(chrome.attr('data-cookies-problem', 'size')), 'Name and value take 5008 B, but Chrome refuses cookies above 4096 B.'); assert.equal(detail(chrome, 'size'), '5008 of 4096 B allowed (name and value)');
    input(chrome, 'data-cookies-field', 'x'.repeat(4088), 'value'); await chrome.settle(); assert.equal(chrome.attr('data-cookies-problem', 'size'), undefined, '4096 bytes exactly is accepted');
    checked(chrome, 'secure', false); input(chrome, 'data-cookies-field', 'v', 'value'); input(chrome, 'data-cookies-field', '__Host-id', 'name'); await chrome.settle();
    assert.deepEqual(problems(chrome), ['samesite-none', 'prefix'], 'SameSite None needs Secure, and so does the __Host- prefix');
    checked(chrome, 'secure', true); checked(chrome, 'hostOnly', true); await chrome.settle(); assert.equal(chrome.attr('data-cookies-problems'), undefined, 'Secure, host-only and the path / satisfy __Host-');
    input(chrome, 'data-cookies-field', '/x', 'path'); await chrome.settle(); assert.deepEqual(problems(chrome), ['prefix'], '__Host- also needs the path /');
    { const prefix = chrome.attr('data-cookies-problem', 'prefix'), isolated = chrome.nodes(node => node.type === 'bdi' && node.props.dir === 'ltr').map(node => chrome.text(node)).filter(shown => shown.startsWith('__'));
      assert.deepEqual(isolated, ['__Secure-', '__Host-', '__Http-'], 'the three cookie-name prefixes are isolated left to right inside the translated hint (a right-to-left sentence draws "__Secure-" as "-Secure__" otherwise)');
      assert.equal(chrome.text(prefix).replace(/ {2,}/gu, ' '), chrome.table.cookies_workspace_problem_prefix.message, 'the hint still reads as the translated message (the harness joins children with a space)'); }
    input(chrome, 'data-cookies-field', '/', 'path'); input(chrome, 'data-cookies-field', '__Http-id', 'name'); await chrome.settle(); assert.deepEqual(problems(chrome), ['prefix'], '__Http- needs HttpOnly'); checked(chrome, 'httpOnly', true); await chrome.settle(); assert.deepEqual(problems(chrome), []);
  } finally { chrome.unmount(); }
  const firefox = await editing(persistent(), { state: { browser: 'firefox' } });
  try {
    input(firefox, 'data-cookies-field', 'x'.repeat(5000), 'value'); await firefox.settle();
    assert.equal(firefox.attr('data-cookies-problems'), undefined, 'no Chrome limit is applied to Firefox'); assert.equal(detail(firefox, 'size'), '5008 B (name and value)', 'no limit is claimed for Firefox');
  } finally { firefox.unmount(); }
  const create = await opened(); try {
    await click(create, 'data-cookies-create'); await create.settle(); checked(create, 'secure', false); checked(create, 'partitioned', true); await create.settle();
    assert.deepEqual(problems(create), ['partition-secure']);
  } finally { create.unmount(); }
});

test('why identity fields are locked is stated; a copy unlocks them and must end up as a different cookie', async () => {
  const h = await editing(persistent({ name: 'keep' }));
  try {
    assert.equal(h.text(h.attr('data-cookies-lock-note')).includes('cannot be changed'), true); assert.match(h.text(h.attr('data-cookies-lock-note')), /copy this one as new/);
    assert.equal(h.attr('data-cookies-copy-as-new').props['data-cookies-copy-as-new'], true); assert.equal(h.nodes(node => node.type === 'h3')[0].props.children, 'Edit cookie');
    await click(h, 'data-cookies-copy-as-new'); await h.settle();
    assert.equal(h.nodes(node => node.type === 'h3')[0].props.children, 'Create cookie'); assert.equal(h.attr('data-cookies-lock-note'), undefined); assert.ok(h.attr('data-cookies-copy-note'));
    for (const key of ['name', 'domain', 'path', 'storeId', 'hostOnly', 'partitioned']) assert.equal(field(h, key).props.disabled, false, key + ' is open on a copy');
    assert.equal(field(h, 'value').props.value, 'EDITOR_ONLY_VALUE', 'the copy keeps the value and the attributes');
    await submit(h); assert.equal(saves(h).length, 0, 'an unchanged identity is the original cookie, not a new one'); assert.equal(h.attr('data-cookies-error').props.children, h.table.cookies_workspace_copy_same_identity.message);
    input(h, 'data-cookies-field', 'copy', 'name'); await h.settle(); assert.equal(h.attr('data-cookies-error'), undefined, 'editing clears the message'); await submit(h);
    assert.equal(saves(h).length, 1); assert.equal(saves(h)[0].value.id, null, 'saved as a new cookie'); assert.equal(saves(h)[0].value.cookie.name, 'copy'); assert.equal(saves(h)[0].value.cookie.value, 'EDITOR_ONLY_VALUE'); assert.equal(saves(h)[0].value.cookie.expirationDate, SOON);
  } finally { h.unmount(); }
  const create = await opened(); try { await click(create, 'data-cookies-create'); await create.settle(); assert.equal(create.attr('data-cookies-lock-note'), undefined, 'a new cookie has nothing locked'); assert.equal(create.attr('data-cookies-copy-as-new'), undefined); } finally { create.unmount(); }
});

test('options the browser lacks are disabled with the reason beside them', async () => {
  const h = await editing(persistent(), { state: { capabilities: { unspecifiedSameSite: false, partitionKey: false, hasCrossSiteAncestor: false } } });
  try {
    const hint = id => h.text(h.nodes(node => node.props.id === id)[0]);
    assert.equal(hint('cookies-hint-samesite'), 'Unspecified: Unavailable in this browser.'); assert.equal(field(h, 'sameSite').props['aria-describedby'], 'cookies-hint-samesite');
    assert.equal(hint('cookies-hint-ancestor'), 'Cross-site ancestor: Unavailable in this browser.'); assert.equal(hint('cookies-hint-first-party'), 'First-party domain: Unavailable in this browser.');
    assert.equal(field(h, 'firstPartyDomain').props['aria-describedby'], 'cookies-hint-first-party');
    assert.match(h.text(h.nodes(node => node.props.class === 'cookies-workspace-hint cookies-workspace-partition__hint')[0]), /^A partitioned cookie is kept separately .* Partitioned: Unavailable in this browser\.$/);
  } finally { h.unmount(); }
  const firefox = await editing(persistent(), { state: { browser: 'firefox', capabilities: { firstPartyDomain: true, hasCrossSiteAncestor: true } } }); try {
    assert.equal(firefox.nodes(node => node.props.id === 'cookies-hint-first-party').length, 0, 'First-party isolation is offered where it exists'); assert.equal(firefox.nodes(node => node.props.id === 'cookies-hint-samesite').length, 0);
  } finally { firefox.unmount(); }
  const stores = await editing({}); try {
    assert.deepEqual(stores.attr('data-cookies-field', 'storeId').props.children.map(option => option.props.children), ['0 (default)', 'container'], 'the default store of Chrome is named');
  } finally { stores.unmount(); }
  const named = await editing({ storeId: 'firefox-default' }, { state: { browser: 'firefox' } }); try { assert.equal(named.attr('data-cookies-field', 'storeId').props.value, 'firefox-default'); } finally { named.unmount(); }
});

test('converter: two arrows between Unix seconds and the date field convert only when pressed; both fields and both arrows are off for a session cookie', async () => {
  const session = await editing({}); try {
    for (const node of [session.attr('data-cookies-convert', 'forward'), session.attr('data-cookies-convert', 'back'), session.attr('data-cookies-datetime'), field(session, 'expirationDate'), session.attr('data-cookies-zone')]) assert.equal(node.props.disabled, true);
    await click(session, 'data-cookies-convert', 'forward'); await click(session, 'data-cookies-convert', 'back'); await session.settle(); assert.equal(converterError(session), undefined, 'a session cookie has nothing to convert');
    checked(session, 'session', false); await session.settle();
    for (const node of [session.attr('data-cookies-convert', 'forward'), session.attr('data-cookies-convert', 'back'), session.attr('data-cookies-datetime'), field(session, 'expirationDate'), session.attr('data-cookies-zone')]) assert.equal(node.props.disabled, false);
    assert.equal(session.attr('data-cookies-datetime').props.value, '', 'nothing is invented for an empty expiry');
  } finally { session.unmount(); }
  const h = await editing(persistent());
  try {
    const opening = unixSecondsToDateTime(SOON_TEXT, { zone: 'local' }).text;
    assert.equal(h.attr('data-cookies-datetime').props.value, opening, 'the date field starts as the real expiry'); assert.match(opening, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.97721(?:[+-]\d\d:\d\d)$/);
    const arrows = ['forward', 'back'].map(kind => h.attr('data-cookies-convert', kind).props);
    assert.deepEqual(arrows.map(props => props['aria-label']), [h.table.cookies_workspace_convert_to_datetime.message, h.table.cookies_workspace_convert_to_seconds.message]); assert.deepEqual(arrows.map(props => props.title), arrows.map(props => props['aria-label']));
    assert.deepEqual(arrows.map(props => props.type), ['button', 'button'], 'arrows never submit the form');
    // Typing in either field changes nothing in the other one.
    input(h, 'data-cookies-field', '1700000000.5', 'expirationDate'); await h.settle(); assert.equal(h.attr('data-cookies-datetime').props.value, opening);
    input(h, 'data-cookies-datetime', '2030-01-01 00:00:00Z'); await h.settle(); assert.equal(field(h, 'expirationDate').props.value, '1700000000.5');
    // Unix seconds -> date and time.
    await click(h, 'data-cookies-convert', 'forward'); await h.settle();
    assert.equal(h.attr('data-cookies-datetime').props.value, unixSecondsToDateTime('1700000000.5', { zone: 'local' }).text); assert.equal(field(h, 'expirationDate').props.value, '1700000000.5');
    // Date and time -> Unix seconds.
    input(h, 'data-cookies-datetime', '2030-01-01 00:00:00Z'); await h.settle(); assert.equal(field(h, 'expirationDate').props.value, '1700000000.5');
    await click(h, 'data-cookies-convert', 'back'); await h.settle(); assert.equal(field(h, 'expirationDate').props.value, '1893456000'); assert.equal(h.attr('data-cookies-datetime').props.value, '2030-01-01 00:00:00Z', 'the typed text is left as typed');
    // The UTC switch decides how a date without an offset is read and how the next date is shown.
    select(h, 'data-cookies-zone', 'utc'); input(h, 'data-cookies-field', '1893456000.25', 'expirationDate'); await h.settle(); await click(h, 'data-cookies-convert', 'forward'); await h.settle();
    assert.equal(h.attr('data-cookies-datetime').props.value, '2030-01-01 00:00:00.25Z'); input(h, 'data-cookies-datetime', '2031-02-03 04:05:06.789'); await h.settle(); await click(h, 'data-cookies-convert', 'back'); await h.settle();
    assert.equal(field(h, 'expirationDate').props.value, Date.UTC(2031, 1, 3, 4, 5, 6) / 1000 + '.789'); assert.equal(converterError(h), undefined);
    assert.equal(h.attr('data-cookies-zone').props.children[0].props.children.startsWith('Local time (UTC'), true); assert.equal(h.attr('data-cookies-zone').props.children[1].props.children, 'UTC');
  } finally { h.unmount(); }
});

test('converter: bad or out-of-range text shows an inline accessible error and changes nothing; the error clears when the field is edited', async () => {
  const h = await editing(persistent());
  try {
    const before = { seconds: field(h, 'expirationDate').props.value, datetime: h.attr('data-cookies-datetime').props.value };
    const message = () => converterError(h);
    for (const [text, code, key] of [['', 'empty', 'converter_error_format'], ['not a date', 'format', 'converter_error_format'], ['2026-02-30 10:00:00Z', 'format', 'converter_error_format'], ['1970-01-01 00:00:00Z', 'range', 'converter_error_range'], ['275760-09-14 00:00:00Z', 'range', 'converter_error_range']]) {
      input(h, 'data-cookies-datetime', text); await h.settle(); await click(h, 'data-cookies-convert', 'back'); await h.settle();
      assert.equal(message().props['data-cookies-converter-error'], 'datetime:' + code, JSON.stringify(text)); assert.equal(message().props.role, 'alert'); assert.equal(h.text(message()), h.table['cookies_workspace_' + key].message);
      assert.equal(field(h, 'expirationDate').props.value, before.seconds, 'the Unix seconds do not change'); assert.equal(h.attr('data-cookies-datetime').props['aria-invalid'], true); assert.equal(field(h, 'expirationDate').props['aria-invalid'], undefined);
      assert.match(h.attr('data-cookies-datetime').props['aria-describedby'], /cookies-converter-message/); assert.equal(h.nodes(node => node.props.id === 'cookies-converter-message').length, 1);
    }
    input(h, 'data-cookies-datetime', before.datetime); await h.settle(); assert.equal(message(), undefined, 'editing the date clears its error');
    for (const seconds of ['', '0', '-5', 'abc', '1e9', '8640000000001', '1.5.5']) {
      input(h, 'data-cookies-field', seconds, 'expirationDate'); await h.settle();
      assert.equal(message().props['data-cookies-converter-error'].startsWith('seconds:'), true, JSON.stringify(seconds) + ' is flagged as soon as it is typed'); assert.equal(h.text(message()), h.table.cookies_workspace_converter_error_seconds.message);
      assert.equal(field(h, 'expirationDate').props['aria-invalid'], true); assert.equal(field(h, 'expirationDate').props['aria-describedby'], 'cookies-converter-hint cookies-converter-message');
      await click(h, 'data-cookies-convert', 'forward'); await h.settle(); assert.equal(h.attr('data-cookies-datetime').props.value, before.datetime, 'nothing is converted from a bad value');
    }
    input(h, 'data-cookies-field', before.seconds, 'expirationDate'); await h.settle(); assert.equal(message(), undefined);
    await click(h, 'data-cookies-convert', 'forward'); await click(h, 'data-cookies-convert', 'back'); await h.settle(); assert.equal(message(), undefined);
    assert.equal(h.nodes(node => node.props.id === 'cookies-converter-hint').length, 1, 'the format hint is always there for aria-describedby');
    assert.equal(saves(h).length, 0);
  } finally { h.unmount(); }
});

test('Save never ignores a typed but unconverted date and time; the Unix seconds are what is written, fraction included', async () => {
  // A refused write keeps the dialog open, so several Save attempts can be counted in one session.
  const refusing = { state: { failure: { name: 'save', code: 'timeout' } } };
  const h = await editing(persistent(), refusing);
  try {
    await submit(h); assert.equal(saves(h).length, 1); assert.equal(saves(h)[0].value.cookie.expirationDate, SOON, 'a fractional expiry from Chrome is saved as it came');
    input(h, 'data-cookies-datetime', '2030-01-01 00:00:00Z'); await h.settle(); await submit(h);
    assert.equal(saves(h).length, 1, 'the date was typed but not converted: nothing is saved'); assert.equal(converterError(h).props['data-cookies-converter-error'], 'datetime:unapplied'); assert.equal(h.text(converterError(h)), h.table.cookies_workspace_converter_unapplied.message);
    await click(h, 'data-cookies-convert', 'back'); await h.settle(); await submit(h);
    assert.equal(saves(h).length, 2); assert.equal(saves(h)[1].value.cookie.expirationDate, 1893456000);
    await click(h, 'data-cookies-convert', 'forward'); await h.settle(); await submit(h); assert.equal(saves(h).length, 3, 'a date made by the forward arrow is not a pending edit');
  } finally { h.unmount(); }
  const cleared = await editing(persistent(), refusing); try {
    input(cleared, 'data-cookies-datetime', ''); await cleared.settle(); await submit(cleared); assert.equal(saves(cleared).length, 1, 'an emptied date field is not a pending edit');
    input(cleared, 'data-cookies-datetime', '2030-01-01 00:00:00Z'); await cleared.settle(); input(cleared, 'data-cookies-datetime', unixSecondsToDateTime(SOON_TEXT, { zone: 'local' }).text); await cleared.settle(); await submit(cleared); assert.equal(saves(cleared).length, 2, 'typing back the converted text leaves nothing pending');
    checked(cleared, 'session', true); input(cleared, 'data-cookies-datetime', '2030-01-01 00:00:00Z'); await cleared.settle(); await submit(cleared); assert.equal(saves(cleared).length, 3, 'a session cookie ignores the date field'); assert.equal(saves(cleared)[2].value.cookie.expirationDate, null);
  } finally { cleared.unmount(); }
});

test('the editor record takes strict decimal Unix seconds and keeps the fraction digits', () => {
  const values = { ...record(), value: 'v', partitioned: false, partitionTopLevelSite: '', partitionAncestor: 'unspecified', firstPartyDomain: '', session: false };
  delete values.id;
  assert.equal(cookieWorkspaceEditorRecord({ ...values, expirationDate: '4000000000.97721' }).expirationDate, 4000000000.97721); assert.equal(cookieWorkspaceEditorRecord({ ...values, expirationDate: ' 2000000000 ' }).expirationDate, 2000000000);
  assert.equal(cookieWorkspaceEditorRecord({ ...values, expirationDate: 2000000000.5 }).expirationDate, 2000000000.5, 'a number from a caller is read through its text');
  for (const bad of ['', '0', '-1', 'abc', '1e9', '0x10', 'Infinity', '1.', '.5', '8640000000001', '1,5', null, undefined]) assert.equal(cookieWorkspaceEditorRecord({ ...values, expirationDate: bad }), null, String(bad));
  assert.equal(cookieWorkspaceEditorRecord({ ...values, session: true, expirationDate: 'garbage' }).expirationDate, null, 'a session cookie has no expiry whatever the field holds');
});

test('all 21 languages render the new editor text without fallback: arrows, lock note, details, hints and placeholders', async () => {
  for (const language of PRODUCTION_LANGUAGES) {
    const h = await editing(persistent({ hostOnly: true, domain: 'owned.example.test', path: '/shop' }), { locale: language.id, state: { capabilities: { unspecifiedSameSite: false, hasCrossSiteAncestor: false } } });
    try {
      const forward = h.attr('data-cookies-convert', 'forward').props, back = h.attr('data-cookies-convert', 'back').props;
      for (const props of [forward, back]) { assert.ok(props['aria-label'].length > 3 && props['aria-label'] === props.title, language.id); assert.doesNotMatch(props['aria-label'], /cookies_workspace_/, language.id); }
      assert.notEqual(forward['aria-label'], back['aria-label'], language.id + ': the two arrows are told apart');
      const dialogText = h.text();
      assert.doesNotMatch(dialogText, /(?:cookies_workspace|browser_debug|management_tab)_|\$[A-Z]+\$|undefined|\[object/, language.id);
      for (const key of ['host', 'path', 'size', 'expires', 'connection']) assert.ok(detail(h, key).trim().length > 2, language.id + '/' + key);
      assert.ok(detail(h, 'host').includes('owned.example.test') && detail(h, 'path').includes('/shop') && /25/.test(detail(h, 'size')) && /4096/.test(detail(h, 'size')), language.id + ': placeholders are substituted');
      assert.deepEqual(h.nodes(node => node.type === 'bdi' && node.props.dir === 'ltr').map(node => node.props.children), ['owned.example.test', '/shop'], language.id + ': host and path keep their own direction inside translated text');
      assert.match(h.attr('data-cookies-zone').props.children[0].props.children, /UTC[+-]\d\d:\d\d/, language.id); assert.ok(h.text(h.attr('data-cookies-lock-note')).length > 40, language.id);
      assert.ok(h.nodes(node => node.props.id === 'cookies-hint-samesite').length === 1, language.id);
    } finally { h.unmount(); }
  }
});

test('every new editor string exists in all 21 languages with the same placeholders as English', () => {
  const english = COOKIES_WORKSPACE_MESSAGES.en, placeholders = text => [...text.matchAll(/\$[A-Z]+\$/gu)].map(match => match[0]).sort();
  const added = COOKIES_WORKSPACE_KEYS.slice(-36); assert.equal(added.length, 36); assert.equal(added[0], 'cookies_workspace_expiry_datetime'); assert.equal(added.at(-1), 'cookies_workspace_details_api_limits');
  for (const language of PRODUCTION_LANGUAGES) for (const key of added) {
    const text = COOKIES_WORKSPACE_MESSAGES[language.id][key]; assert.ok(text && text === text.trim(), language.id + '/' + key);
    assert.deepEqual(placeholders(text), placeholders(english[key]), language.id + '/' + key); assert.doesNotMatch(text, /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff\ufffd]/u, language.id + '/' + key);
    if (language.id !== 'en' && !['cookies_workspace_details_https_only', 'cookies_workspace_details_http_https'].includes(key)) assert.notEqual(text, english[key], language.id + '/' + key + ' is still English');
  }
  for (const [key, names] of Object.entries({ cookies_workspace_timezone_local: ['offset'], cookies_workspace_problem_size: ['size', 'limit'], cookies_workspace_details_host_only: ['host'], cookies_workspace_details_path_value: ['path'] })) {
    const table = applyCookiesCopy({}, 'de'); assert.deepEqual(Object.keys(table[key].placeholders), names, key);
  }
  assert.equal(applyCookiesCopy({}, 'en').cookies_workspace_expiry_datetime.placeholders, undefined);
});

test('the stylesheet mirrors the arrows in right-to-left, stacks the converter in a narrow dialog and keeps Save reachable', () => {
  const css = readFileSync(new URL('../../apps/production-extension/cookies-ui.css', import.meta.url), 'utf8');
  assert.match(css, /\.cookies-workspace:dir\(rtl\) \.cookies-workspace-convert \.cookies-workspace-icon \{ transform: scaleX\(-1\); \}/); assert.match(css, /\.cookies-workspace:dir\(rtl\) \.cookies-workspace-convert--back \.cookies-workspace-icon \{ transform: none; \}/);
  assert.match(css, /\.cookies-workspace-convert--back \.cookies-workspace-icon \{ transform: scaleX\(-1\); \}/); assert.match(css, /\.cookies-workspace-editor \{ container: cookie-editor \/ inline-size; \}/);
  const narrow = /@container cookie-editor \(max-width: 560px\) \{([\s\S]*?)\n\}/u.exec(css)?.[1] ?? ''; assert.match(narrow, /\.cookies-workspace-converter \{ grid-template-columns: minmax\(0, 1fr\); \}/); assert.match(narrow, /rotate\(90deg\)/); assert.match(narrow, /rotate\(-90deg\)/);
  assert.match(css, /\.cookies-workspace-editor > \.cookies-workspace-dialog-actions \{ position: sticky;/); assert.match(css, /\.cookies-workspace-convert > span \{ display: none; \}/);
  assert.equal(/\.cookies-workspace-converter \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\)/.test(css), true, 'two fields with the arrows between them');
});

test('an expiry that is already in the past is flagged before Save, with the consequence in plain words', async () => {
  const now = Math.floor(Date.now() / 1000);
  const past = await editing(persistent({ expirationDate: now - 3600 }));
  try {
    assert.deepEqual(problems(past), ['expired']); assert.equal(past.text(past.attr('data-cookies-problem', 'expired')), past.table.cookies_workspace_problem_expired.message); assert.match(detail(past, 'expires'), /^Expired /);
    input(past, 'data-cookies-field', String(now + 86400), 'expirationDate'); await past.settle(); assert.deepEqual(problems(past), [], 'a future expiry clears it');
    input(past, 'data-cookies-field', '', 'expirationDate'); await past.settle(); assert.deepEqual(problems(past), [], 'an empty expiry has its own message under the converter, not this one');
    checked(past, 'session', true); input(past, 'data-cookies-field', String(now - 5), 'expirationDate'); await past.settle(); assert.deepEqual(problems(past), [], 'a session cookie has no expiry to be late');
  } finally { past.unmount(); }
});

test('the Chrome 400-day lifetime cap is announced before Save, for Chrome only and only beyond 400 days', async () => {
  const now = Math.floor(Date.now() / 1000);
  const h = await editing(persistent({ expirationDate: now + 399 * 86400 }));
  try {
    assert.deepEqual(problems(h), [], '399 days is inside the cap'); input(h, 'data-cookies-field', String(now + 401 * 86400), 'expirationDate'); await h.settle();
    assert.deepEqual(problems(h), ['reach']); assert.equal(h.text(h.attr('data-cookies-problem', 'reach')), 'Chrome limits cookie lifetime to 400 days from now: a later expiry is shortened when it is saved.');
    input(h, 'data-cookies-field', String(now - 60), 'expirationDate'); await h.settle(); assert.deepEqual(problems(h), ['expired'], 'a past expiry is the stronger message and replaces the note');
  } finally { h.unmount(); }
  const firefox = await editing(persistent({ expirationDate: now + 900 * 86400 }), { state: { browser: 'firefox' } });
  try { assert.deepEqual(problems(firefox), [], 'no lifetime cap is claimed for Firefox'); } finally { firefox.unmount(); }
});
