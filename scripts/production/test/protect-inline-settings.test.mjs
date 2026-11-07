// ADR-053/062 / ADR-020 §15: actual activation TSX, canonical consent and native disabled semantics.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../../..');
const shim = resolve(root, 'apps/production-protect/src/ui/i18n-shim.ts');
const vendorI18n = resolve(root, 'vendor/protect-722fae8/packages/ui/src/i18n');
const vendorState = resolve(root, 'vendor/protect-722fae8/packages/ui/src/app/useProtectState');
const built = await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
  export * from './apps/production-protect/src/ui/inline-consent.tsx';
  export * from './apps/production-protect/src/ui/protect-section.tsx';
  export { FirewallLauncherIsland, ToolBoundary, launcherToolOf } from './apps/production-protect/src/ui/islands.tsx';
  export * from './apps/production-protect/src/ui/i18n-shim.ts';
  export * from './vendor/protect-722fae8/packages/ui/test/protect-firewall-support.ts';
  export * from './vendor/protect-722fae8/packages/engine/src/protect/consent.ts';
  export { PROTECT_CONSENT_VERSION, PROTECT_FEATURES, PROTECT_PRESETS } from '@detect-expert/contracts';
` }, bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', jsxImportSource: 'preact',
  tsconfig: resolve(root, 'apps/production-protect/tsconfig.json'), logLevel: 'silent',
  plugins: [{ name: 'reviewed-ui-boundaries', setup(builder) {
    builder.onResolve({ filter: /^preact\/hooks$/ }, () => ({ path: 'hooks', namespace: 'inline-test' }));
    builder.onLoad({ filter: /^hooks$/, namespace: 'inline-test' }, () => ({ contents:
      ['useState', 'useRef', 'useEffect', 'useLayoutEffect', 'useMemo', 'useCallback'].map(name => `export const ${name}=(...args)=>globalThis.__protectInlineHooks.${name}(...args);`).join('\n') }));
    builder.onLoad({ filter: /^state$/, namespace: 'inline-test' }, () => ({ contents: 'export const useProtectState=()=>globalThis.__protectInlineSession;' }));
    builder.onLoad({ filter: /[\\/]apps[\\/]production-protect[\\/]src[\\/]ui[\\/]islands\.tsx$/ }, args => ({
      contents: readFileSync(args.path, 'utf8') + '\nexport { FirewallLauncherIsland, ToolBoundary, launcherToolOf };', loader: 'tsx',
    }));
    builder.onResolve({ filter: /^\.{1,2}\// }, args => {
      const path = resolve(args.resolveDir, args.path);
      if (path === vendorState || path === vendorState + '.ts') return { path: 'state', namespace: 'inline-test' };
      return path === vendorI18n || path === vendorI18n + '.ts' ? { path: shim } : undefined;
    });
  } }],
});
const M = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const clone = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(done => setImmediate(done));
function walk(value, ancestors = []) {
  if (value === null || value === undefined || typeof value === 'boolean') return [];
  if (Array.isArray(value)) return value.flatMap(child => walk(child, ancestors));
  if (typeof value === 'string' || typeof value === 'number') return [{ type: '#text', value: String(value), props: {}, ancestors }];
  const node = { type: value.type, props: value.props, ancestors };
  return [node, ...walk(value.props?.children, [...ancestors, node])];
}
function harness(component, initialProps, locale = 'en') {
  const slots = [], effects = []; let cursor = 0, dirty = true, props = initialProps, tree;
  const same = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const hooks = {
    useState(initial) { const slot = slots[cursor++] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slot.value, next => { slot.value = typeof next === 'function' ? next(slot.value) : next; dirty = true; }]; },
    useRef(initial) { return (slots[cursor++] ??= { current: initial }); },
    useEffect(callback, dependencies) { const slot = slots[cursor++] ??= {}; if (!same(slot.dependencies, dependencies)) { slot.dependencies = dependencies; effects.push(() => { slot.cleanup?.(); slot.cleanup = callback(); }); } },
    useMemo(callback, dependencies) { const slot = slots[cursor++] ??= {}; if (!same(slot.dependencies, dependencies)) { slot.dependencies = dependencies; slot.value = callback(); } return slot.value; },
  };
  hooks.useCallback = (callback, dependencies) => hooks.useMemo(() => callback, dependencies); hooks.useLayoutEffect = hooks.useEffect;
  const eventHost = { addEventListener() {}, removeEventListener() {} };
  function inContext(work) {
    const previous = { hooks: globalThis.__protectInlineHooks, session: globalThis.__protectInlineSession, window: globalThis.window };
    globalThis.__protectInlineHooks = hooks; globalThis.__protectInlineSession = props.session;
    if (component === 'FirewallLauncherIsland') globalThis.window = eventHost;
    try { return work(); }
    finally {
      for (const [name, value] of [['__protectInlineHooks', previous.hooks], ['__protectInlineSession', previous.session], ['window', previous.window]]) {
        if (value === undefined) delete globalThis[name]; else globalThis[name] = value;
      }
    }
  }
  function draw() {
    M.setProductionLocale(locale); cursor = 0; dirty = false;
    inContext(() => { tree = M[component](props); effects.splice(0).forEach(effect => effect()); });
    return walk(tree);
  }
  return {
    draw, nodes: () => walk(tree),
    update(next) { props = { ...props, ...next }; return draw(); },
    async settle() { for (let index = 0; index < 8; index++) { if (dirty) draw(); await tick(); } return walk(tree); },
    unmount() { inContext(() => slots.forEach(slot => slot.cleanup?.())); },
  };
}
const marked = (tree, name, value = 'true') => tree.find(node => String(node.props[name]) === value);
const inside = (tree, parent) => tree.filter(node => node.ancestors.includes(parent));
const inputs = (tree, parent) => inside(tree, parent).filter(node => node.type === 'input');
const disabled = node => node.props.disabled === true || node.ancestors.some(parent => parent.type === 'fieldset' && parent.props.disabled === true);
const text = tree => tree.filter(node => node.type === '#text').map(node => node.value).join(' ');
const consentNode = tree => tree.find(node => ['InlineProtectConsent', 'ProtectConsentDialog'].includes(node.type?.name));
function sessionFor(state, over = {}) {
  const calls = [];
  const session = { state, loaded: true, available: true, busy: false, notice: null, dismissNotice() {}, refresh: async () => {},
    ...Object.fromEntries(['enable', 'disable', 'purgeAll', 'setFeatures', 'setPreset', 'setSite', 'snooze'].map(name => [name, async (...args) => { calls.push({ name, args }); return true; }])), ...over };
  return { session, calls };
}
const off = changes => M.fwState({ state: 'off', decisions: 0, consentVersion: null, features: [], ...changes });
const clickEnable = tree => { const button = marked(tree, 'data-protect-enable'); assert.ok(button); button.props.onClick({ currentTarget: { isConnected: true, focus() {} } }); };
function inlineProps(state, over = {}) { return { id: 'protect-consent', state, busy: false, error: null, onConfirm() {}, onCancel() {}, ...over }; }
function activationHarness(surface, state, session, over = {}) {
  const h = harness(surface === 'Options' ? 'ProtectSection' : 'FirewallLauncherIsland', { state, session, mode: 'full', locale: 'en', ...over });
  return { ...h, click(tree = h.nodes()) {
    if (surface === 'Options') clickEnable(tree);
    else {
      const button = marked(tree, 'data-protect-toggle', 'status'); assert.ok(button);
      button.props.onClick({ currentTarget: { disabled: false, isConnected: true, focus() {} } });
    }
  } };
}
function noActivationDialog(tree) {
  assert.equal(consentNode(tree), undefined);
  assert.equal(tree.some(node => node.type === 'dialog' || node.props['aria-modal'] || node.props['data-protect-inline-consent']), false);
}

test('Off Options shows all real disabled features and preset choices without opening consent or sending an action', () => {
  const state = off(), f = sessionFor(state), h = harness('ProtectSection', { state, session: f.session, mode: 'full' });
  const tree = h.draw(), features = marked(tree, 'data-protect-features'), presets = marked(tree, 'data-protect-preset-preview');
  assert.ok(features); assert.ok(presets);
  assert.equal(inputs(tree, features).length, M.PROTECT_FEATURES.length); assert.equal(inputs(tree, presets).length, M.PROTECT_PRESETS.length);
  assert.ok(inputs(tree, features).every(disabled)); assert.ok(inputs(tree, presets).every(disabled));
  assert.equal(inputs(tree, presets).filter(node => node.props.checked).length, 1);
  assert.equal(consentNode(tree), undefined); assert.equal(tree.some(node => node.type === 'dialog' || node.props['aria-modal']), false);
  assert.deepEqual(f.calls, []); h.unmount();
});

test('busy and organization-disabled Options keep operational settings disabled while retained data remains removable', () => {
  for (const state of [off({ decisions: 3 }), M.fwState({ state: 'organization-disabled', organizationDisabled: true }), M.fwState({ state: 'organization-disabled', organizationPolicyInvalid: true })]) {
    const before = clone(state), f = sessionFor(state, { busy: state.state === 'off' }), h = harness('ProtectSection', { state, session: f.session, mode: 'full' });
    const tree = h.draw(), features = marked(tree, 'data-protect-features'), presets = marked(tree, 'data-protect-preset-preview');
    assert.ok(features); assert.ok(presets); assert.ok(inputs(tree, features).every(disabled)); assert.ok(inputs(tree, presets).every(disabled));
    assert.ok(marked(tree, 'data-protect-purge'), 'read/delete ownership is not hidden merely because operational controls are disabled');
    assert.equal(consentNode(tree), undefined); assert.deepEqual(f.calls, []); assert.deepEqual(state, before); h.unmount();
  }
});

test('active feature choices retain the existing setFeatures path; a disabled Firewall gets only the disabled mode preview', () => {
  const state = M.fwState({ features: ['value-match'] }), f = sessionFor(state), h = harness('ProtectSection', { state, session: f.session, mode: 'full' });
  const tree = h.draw(), features = marked(tree, 'data-protect-features'), presets = marked(tree, 'data-protect-preset-preview');
  assert.ok(features); assert.ok(presets); assert.ok(inputs(tree, presets).every(disabled));
  const control = inputs(tree, features).find(node => node.props.id === 'protect-feature-gpc'); assert.ok(control); assert.equal(disabled(control), false);
  control.props.onChange({ currentTarget: { checked: true } }); assert.deepEqual(f.calls, [{ name: 'setFeatures', args: [['value-match', 'gpc']] }]);
  h.update({ state: M.fwState() }); assert.equal(marked(h.nodes(), 'data-protect-preset-preview'), undefined, 'the real FirewallRulesPanel owns the active editable mode'); h.unmount();
});

test('inline consent renders all seven original blocks and the unchanged RU/EN canonical consent digest without modal behavior', () => {
  const catalog = JSON.parse(readFileSync(resolve(root, 'apps/production-protect/src/locales/catalog.generated.json'), 'utf8')), rendered = {};
  for (const locale of ['ru', 'en']) {
    const h = harness('InlineProtectConsent', inlineProps(off()), locale), tree = h.draw(); rendered[locale] = tree.filter(node => node.type === '#text').map(node => node.value);
    assert.ok(marked(tree, 'data-protect-inline-consent')); assert.deepEqual(tree.filter(node => node.props['data-consent-block'] !== undefined).map(node => node.props['data-consent-block']), ['1', '2', '3', '4', '5', '6', '7']);
    assert.equal(tree.some(node => node.type === 'dialog' || node.props['aria-modal'] || node.props.onKeyDown), false);
    for (const key of M.PROTECT_CONSENT_KEYS) assert.equal(rendered[locale].filter(value => value === catalog[locale][key].message).length, 1, locale + '/' + key);
    assert.ok(text(tree).includes(catalog[locale].fw_mode_strict_warning.message)); h.unmount();
  }
  const input = M.protectConsentDigestInput(key => rendered.ru.find(value => value === catalog.ru[key].message), key => rendered.en.find(value => value === catalog.en[key].message));
  assert.equal(createHash('sha256').update(input).digest('hex'), M.PROTECT_CONSENT_DIGEST.sha256); assert.equal(M.PROTECT_CONSENT_DIGEST.version, M.PROTECT_CONSENT_VERSION);
});

test('inline confirmation requires acknowledgement and a feature, stays blocked while busy, and calls the existing enable callback synchronously', () => {
  const calls = []; let inGesture = false;
  const h = harness('InlineProtectConsent', inlineProps(off(), { onConfirm: (...args) => calls.push({ args, inGesture }) }));
  let tree = h.draw(); marked(tree, 'data-consent-confirm').props.onClick(); assert.deepEqual(calls, []);
  tree.find(node => node.props.id === 'protect-consent-ack').props.onChange({ currentTarget: { checked: true } }); tree = h.draw();
  const featureControls = inputs(tree, marked(tree, 'data-protect-consent-features'));
  for (const control of featureControls.filter(node => node.props.checked)) control.props.onChange({ currentTarget: { checked: false } }); tree = h.draw();
  marked(tree, 'data-consent-confirm').props.onClick(); assert.deepEqual(calls, []);
  tree.find(node => node.props.id === 'protect-consent-feature-value-match').props.onChange({ currentTarget: { checked: true } }); tree = h.draw();
  h.update({ busy: true }); marked(h.nodes(), 'data-consent-confirm').props.onClick(); assert.deepEqual(calls, []);
  h.update({ busy: false }); inGesture = true; marked(h.nodes(), 'data-consent-confirm').props.onClick(); inGesture = false;
  assert.deepEqual(calls, [{ args: [['value-match'], 'normal'], inGesture: true }]); h.unmount();
});

test('Options and launcher first clicks activate empty choices with canonical defaults in the same gesture and no dialog', async () => {
  for (const surface of ['Options', 'Launcher']) for (const consentVersion of [null, 0, 1]) {
    const state = off({ consentVersion, preset: 'strict' }), before = clone(state), calls = []; let inGesture = false;
    const f = sessionFor(state, { enable: (features, preset) => { calls.push({ features, preset, inGesture }); return Promise.resolve(false); } });
    const h = activationHarness(surface, state, f.session);
    try {
      noActivationDialog(h.draw()); await h.settle(); assert.deepEqual(calls, [], 'rendering and effects never enable');
      inGesture = true; h.click(); inGesture = false;
      assert.deepEqual(calls, [{ features: ['value-match', 'firewall', 'session-replay'], preset: 'normal', inGesture: true }], surface);
      noActivationDialog(h.draw()); await h.settle(); noActivationDialog(h.nodes());
      assert.ok(marked(h.nodes(), 'data-protect-state', 'off')); assert.deepEqual(state, before);
    } finally { h.unmount(); }
  }
});

test('Options and launcher preserve nonempty saved features and mode even when the consent version changes', async () => {
  for (const surface of ['Options', 'Launcher']) for (const consentVersion of [0, 1]) {
    const state = off({ consentVersion, features: ['gpc', 'history'], preset: 'warn-only' }), before = clone(state), calls = []; let inGesture = false;
    const f = sessionFor(state, { enable: (features, preset) => { calls.push({ features, preset, inGesture }); return Promise.resolve(false); } });
    const h = activationHarness(surface, state, f.session);
    try {
      h.draw(); inGesture = true; h.click(); inGesture = false;
      assert.deepEqual(calls, [{ features: ['gpc', 'history'], preset: 'warn-only', inGesture: true }], surface);
      assert.notEqual(calls[0].features, state.features, 'activation receives a copy of the saved feature list');
      await h.settle(); noActivationDialog(h.nodes()); assert.deepEqual(state, before);
    } finally { h.unmount(); }
  }
});

test('pending first activation blocks reentry; failed saves keep OFF and allow only an explicit retry', async () => {
  for (const surface of ['Options', 'Launcher']) for (const failure of ['false', 'reject']) {
    let finish, fail, calls = 0;
    const pending = new Promise((yes, no) => { finish = yes; fail = no; });
    const state = off(), layout = [], f = sessionFor(state, { enable: () => { ++calls; return calls === 1 ? pending : Promise.resolve(false); } });
    const h = activationHarness(surface, state, f.session, { onLayoutAction: action => layout.push(action) });
    try {
      const initial = h.draw(); h.click(initial); h.click(initial); assert.equal(calls, 1, surface);
      const busyTree = h.draw(), button = surface === 'Options' ? marked(busyTree, 'data-protect-enable') : marked(busyTree, 'data-protect-toggle', 'status');
      assert.equal(disabled(button), true); noActivationDialog(busyTree); assert.ok(marked(busyTree, 'data-protect-state', 'off'));
      if (failure === 'false') finish(false); else fail(new Error('owned save failure'));
      await h.settle(); assert.equal(calls, 1); assert.deepEqual(layout, []); assert.ok(marked(h.nodes(), 'data-protect-state', 'off'));
      noActivationDialog(h.nodes()); h.click(); assert.equal(calls, 2); await h.settle();
    } finally { h.unmount(); }
  }
});

test('synchronous activation errors keep OFF and release the explicit-click lock without opening a dialog', async () => {
  for (const surface of ['Options', 'Launcher']) {
    let calls = 0;
    const state = off(), f = sessionFor(state, { enable: () => { ++calls; if (calls === 1) throw new Error('owned activation failure'); return Promise.resolve(false); } });
    const h = activationHarness(surface, state, f.session);
    try {
      h.draw(); h.click(); await h.settle(); assert.equal(calls, 1);
      assert.ok(marked(h.nodes(), 'data-protect-state', 'off')); noActivationDialog(h.nodes());
      assert.ok(h.nodes().some(node => node.props.role === 'alert' || node.props['data-protect-message']));
      h.click(); assert.equal(calls, 2); await h.settle();
    } finally { h.unmount(); }
  }
});

test('loading, unavailable, busy and managed sessions cannot activate; becoming eligible never auto-enables', async () => {
  for (const surface of ['Options', 'Launcher']) for (const condition of [
    { loaded: false }, { available: false }, { busy: true },
    { state: off({ organizationDisabled: true }) }, { state: off({ organizationPolicyInvalid: true }) },
  ]) {
    const state = condition.state ?? off(), f = sessionFor(state, condition), h = activationHarness(surface, state, f.session);
    try {
      const tree = h.draw(), button = surface === 'Options' ? marked(tree, 'data-protect-enable') : marked(tree, 'data-protect-toggle', 'status');
      if (button) { assert.equal(disabled(button), true); h.click(tree); }
      await h.settle(); assert.deepEqual(f.calls, []); noActivationDialog(h.nodes());
      const ready = off(); Object.assign(f.session, { state: ready, loaded: true, available: true, busy: false });
      h.update({ state: ready }); await h.settle(); assert.deepEqual(f.calls, []);
      h.click(); assert.deepEqual(f.calls, [{ name: 'enable', args: [['value-match', 'firewall', 'session-replay'], 'normal'] }]);
      await h.settle(); noActivationDialog(h.nodes());
    } finally { h.unmount(); }
  }
});

// ---- ADR-111: the Options shell's Tour button between the title and the switch of the launcher (`toolSlot`) ------------------------------------------------
// The shell hands a maker, not a vnode: its Preact cannot run inside this module's copy. Without one the launcher row has exactly its two buttons.
function launcherHarness(over = {}) {
  const state = off(), f = sessionFor(state), h = harness('FirewallLauncherIsland', { surface: 'launcher', tabId: null, openSidePanel: null, locale: 'en', session: f.session, ...over });
  return { f, h };
}
function launcherRow(tree) {
  const controls = tree.find(node => node.props.class === 'blocking-launcher__controls'); assert.ok(controls, 'the launcher has its controls row');
  const kind = node => node.props['data-protect-open'] ? 'open' : node.props['data-protect-toggle'] ? 'switch' : node.type === M.ToolBoundary ? 'tool' : 'other:' + String(node.type);
  return { controls, row: tree.filter(node => node.ancestors.at(-1) === controls).map(kind) };
}

test('without a toolSlot the launcher row is exactly its title and its switch (popup, side panel, Control center: the DOM is unchanged); a slot that is not a function is ignored', () => {
  for (const over of [{}, { toolSlot: null }, { toolSlot: undefined }, { toolSlot: 'tour' }, { toolSlot: {} }, { toolSlot: 42 }]) {
    const { h } = launcherHarness(over);
    try { assert.deepEqual(launcherRow(h.draw()).row, ['open', 'switch'], JSON.stringify(over)); } finally { h.unmount(); }
  }
});

test('with a toolSlot the shell\'s component stands between the title and the switch, as a direct child of the row, in this order in the DOM', () => {
  function Tool() { return null; }
  const { h } = launcherHarness({ toolSlot: () => Tool });
  try {
    const tree = h.draw(), { row, controls } = launcherRow(tree);
    assert.deepEqual(row, ['open', 'tool', 'switch'], 'title, then the shell\'s control, then the switch');
    const open = marked(tree, 'data-protect-open'), boundary = tree.find(node => node.type === M.ToolBoundary), tool = tree.find(node => node.type === Tool), toggle = marked(tree, 'data-protect-toggle', 'status');
    assert.ok(tool, 'the component the maker returned is drawn'); assert.deepEqual(tool.ancestors.slice(-2), [controls, boundary], 'inside the row, behind a boundary that draws no element of its own');
    assert.ok(tree.indexOf(open) < tree.indexOf(tool) && tree.indexOf(tool) < tree.indexOf(toggle), 'document order: title, control, switch');
    assert.equal(tree.filter(node => node.type === Tool).length, 1, 'one control');
    assert.equal(controls.props.class, 'blocking-launcher__controls'); assert.equal(open.props.disabled, false); assert.equal(toggle.props.role, 'switch', 'the two module buttons are the same ones');
  } finally { h.unmount(); }
});

test('the maker gets the kit of THIS Preact: its h and hooks and the language of the page; it is called once per maker, not once per render', () => {
  const kits = []; function Tool() { return null; }
  const maker = kit => { kits.push(kit); return Tool; };
  const { h } = launcherHarness({ toolSlot: maker });
  try {
    h.draw(); h.draw(); h.update({ locale: 'ru' }); h.update({ tabId: 3 });
    assert.equal(kits.length, 1, 'the component keeps its identity (and its state) across the launcher\'s own re-renders'); const [kit] = kits;
    assert.deepEqual(Object.keys(kit).sort(), ['h', 'useEffect', 'useLocale', 'useState']); assert.ok(Object.isFrozen(kit)); for (const name of Object.keys(kit)) assert.equal(typeof kit[name], 'function', name);
    const vnode = kit.h('span', { class: 'x', children: 'text' }, 'key-1'); assert.equal(vnode.type, 'span'); assert.equal(vnode.props.class, 'x'); assert.equal(vnode.props.children, 'text'); assert.equal(vnode.key, 'key-1', 'a vnode of this module\'s Preact (jsx-runtime)');
    M.setProductionLocale('de'); assert.equal(kit.useLocale(), 'de', 'the language of the page, read when the component renders'); M.setProductionLocale('zh_CN'); assert.equal(kit.useLocale(), 'zh_CN');
    M.setProductionLocale(null); assert.equal(kit.useLocale(), 'en', 'English before the host has said anything');
    const next = () => Tool; h.update({ toolSlot: next }); assert.equal(h.nodes().filter(node => node.type === Tool).length, 1); h.update({ toolSlot: next }); h.draw();
    h.update({ toolSlot: null }); assert.deepEqual(launcherRow(h.nodes()).row, ['open', 'switch'], 'taking the slot away leaves the two buttons'); assert.equal(h.nodes().some(node => node.type === Tool), false);
  } finally { h.unmount(); }
});

test('a maker that throws or returns something that is not a component leaves the two buttons; the boundary draws nothing for a control that fails', () => {
  const bad = { throws: () => { throw new Error('boom'); }, 'returns null': () => null, 'returns a string': () => 'tool', 'returns an object': () => ({ type: 'button' }), 'returns undefined': () => undefined };
  for (const [name, toolSlot] of Object.entries(bad)) {
    const { h } = launcherHarness({ toolSlot });
    try { assert.deepEqual(launcherRow(h.draw()).row, ['open', 'switch'], name); assert.equal(M.launcherToolOf(toolSlot), null, name); } finally { h.unmount(); }
  }
  assert.equal(M.launcherToolOf(null), null); assert.equal(typeof M.launcherToolOf(() => function Tool() { return null; }), 'function');
  const boundary = new M.ToolBoundary({ children: 'control' });
  assert.equal(boundary.render(), 'control', 'a healthy control is drawn as it is'); assert.deepEqual(M.ToolBoundary.getDerivedStateFromError(), { failed: true });
  boundary.state = { failed: true }; assert.equal(boundary.render(), null, 'a failed control leaves its place empty; the launcher goes on');
});

test('the switch and the title behave exactly as before with a control in the row: one click, one enable; navigation and busy states are not touched', async () => {
  function Tool() { return null; }
  const { f, h } = launcherHarness({ toolSlot: () => Tool });
  try {
    const tree = h.draw(), toggle = marked(tree, 'data-protect-toggle', 'status'); assert.ok(toggle); assert.equal(disabled(toggle), false);
    toggle.props.onClick({ currentTarget: { disabled: false, isConnected: true, focus() {} } });
    assert.deepEqual(f.calls, [{ name: 'enable', args: [['value-match', 'firewall', 'session-replay'], 'normal'] }]);
    await h.settle(); assert.deepEqual(launcherRow(h.nodes()).row, ['open', 'tool', 'switch'], 'the control is still there after the state changed');
  } finally { h.unmount(); }
});
