// E22-22: UI lifecycle and interaction boundaries; backend CAS is covered by its controller suite.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { GUARD_LAUNCHER_UI_KEYS, GUARD_LAUNCHER_UI_MESSAGES, applyGuardLauncherCopy } from '../production-locales-guard-launchers.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';

const source = readFileSync(new URL('../../apps/production-extension/guard-launchers-ui.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').replaceAll('export function ', 'function ');
function fixture({ locale = 'en', tabId = 19, open } = {}) {
  const changes = [], navigation = [], calls = { load: 0, toggle: 0, dispose: 0 }, slots = [], effects = [];
  let notify, cursor = 0, dirty = true, tree, state = { enabled: null, busy: false, error: null }, props = { tabId };
  const api = {};
  const context = vm.createContext({ createGuardLauncherController: (actual, options) => {
    assert.equal(actual, api); assert.equal(options.masterKey, 'antidetectEnabled'); notify = options.onChange;
    return { getState: () => ({ ...state }), load: async () => { calls.load++; }, toggle: async () => { calls.toggle++; }, dispose: () => { calls.dispose++; } };
  }, openManagement: async (...args) => { navigation.push(args); return open ? open(...args) : true; }, console });
  vm.runInContext(source + '\nglobalThis.exports = { createGuardLaunchersUi, guardLauncherHasFirewall };', context);
  const hooks = {
    useState(initial) { const slot = slots[cursor++] ??= { value: initial }; return [slot.value, next => { slot.value = typeof next === 'function' ? next(slot.value) : next; changes.push(slot.value); dirty = true; }]; },
    useRef(initial) { return (slots[cursor++] ??= { ref: { current: initial } }).ref; },
    useEffect(callback, deps) { const slot = slots[cursor++] ??= {}; if (!slot.deps || deps.some((value, index) => value !== slot.deps[index])) { slot.deps = deps; effects.push(() => { slot.cleanup?.(); slot.cleanup = callback(); }); } }
  };
  const ui = context.exports.createGuardLaunchersUi({ ...hooks, h: (type, properties) => ({ type, props: properties }), useLocale: () => locale, translate: key => GUARD_LAUNCHER_UI_MESSAGES[locale][key], browserApi: api });
  function render() { cursor = 0; dirty = false; tree = ui.AntidetectLauncher(props); while (effects.length) effects.shift()(); return tree; }
  function settle() { for (let count = 0; count < 8 && dirty; count++) render(); return tree; }
  function nodes(predicate) { const result = []; function visit(node) { if (Array.isArray(node)) return node.forEach(visit); if (!node?.props) return; if (predicate(node)) result.push(node); visit(node.props.children); } visit(tree); return result; }
  const attr = key => nodes(node => node.props[key] === true)[0];
  return { api, ui, calls, navigation, changes, render, settle, nodes, attr,
    emit(next) { state = { ...state, ...next }; notify({ ...state }); settle(); },
    update(next) { props = { ...props, ...next }; render(); settle(); },
    unmount() { for (const slot of slots) slot.cleanup?.(); },
    hasFirewall: context.exports.guardLauncherHasFirewall,
    get tree() { return tree; }
  };
}
const labels = node => { if (typeof node === 'string') return node; if (Array.isArray(node)) return node.map(labels).join(''); return labels(node?.props?.children ?? ''); };

test('Antidetect launcher reads on mount, reflects actual state, and delegates only the compact switch to toggle', async () => {
  const f = fixture(); f.render(); f.settle();
  assert.equal(f.calls.load, 1);
  assert.equal(f.attr('data-antidetect-launcher-master').props.disabled, true);
  assert.equal(f.tree.props['aria-busy'], true);
  f.emit({ enabled: false });
  assert.equal(f.attr('data-antidetect-launcher-master').props.disabled, false);
  assert.equal(labels(f.attr('data-antidetect-launcher-master')), 'OFF');
  await f.attr('data-antidetect-launcher-master').props.onClick();
  assert.equal(f.calls.toggle, 1); assert.deepEqual(f.navigation, []);
  f.emit({ enabled: true, busy: true });
  assert.equal(f.attr('data-antidetect-launcher-master').props['aria-checked'], true);
  assert.equal(labels(f.attr('data-antidetect-launcher-master')), 'ON');
  assert.equal(f.attr('data-antidetect-launcher-master').props.disabled, true);
  assert.equal(f.calls.load, 1);
  f.unmount(); assert.equal(f.calls.dispose, 1);
});

test('large Antidetect button navigates through the shared management helper without toggling', async () => {
  const f = fixture(); f.render(); f.settle();
  await f.attr('data-antidetect-open').props.onClick(); f.settle();
  assert.equal(f.navigation.length, 1);
  assert.equal(f.navigation[0][0], 'antidetect'); assert.equal(f.navigation[0][1], 19); assert.equal(f.navigation[0][2], f.api);
  assert.equal(f.calls.toggle, 0);
  f.update({ tabId: 23 }); await f.attr('data-antidetect-open').props.onClick();
  assert.equal(f.navigation[1][1], 23);
  f.unmount();
});

test('navigation suppresses duplicate work and ignores completion after unmount', async () => {
  let finish; const f = fixture({ open: () => new Promise(resolve => { finish = resolve; }) }); f.render(); f.settle();
  const first = f.attr('data-antidetect-open').props.onClick(); f.settle();
  assert.equal(f.attr('data-antidetect-open').props.disabled, true);
  await f.attr('data-antidetect-open').props.onClick(); assert.equal(f.navigation.length, 1);
  f.unmount(); const prior = f.changes.length; finish(false); await first;
  f.emit({ enabled: true }); assert.equal(f.changes.length, prior);
});

test('read and navigation errors show local copy without exposing raw backend errors', async () => {
  const f = fixture({ locale: 'ru', open: async () => false }); f.render(); f.settle();
  f.emit({ enabled: null, error: 'private-untrusted-message' });
  assert.equal(labels(f.nodes(node => node.props.role === 'alert')[0]), GUARD_LAUNCHER_UI_MESSAGES.ru.guard_launcher_error);
  assert.equal(labels(f.tree).includes('private-untrusted-message'), false);
  await f.attr('data-antidetect-open').props.onClick(); f.settle();
  assert.equal(labels(f.nodes(node => node.props.role === 'alert')[0]), GUARD_LAUNCHER_UI_MESSAGES.ru.guard_launcher_open_error);
  f.unmount();
});

test('invalid tab targets never navigate or mutate', async () => {
  for (const tabId of [-1, 2147483648, NaN, '19']) {
    const f = fixture({ tabId }); f.render(); f.settle(); await f.attr('data-antidetect-open').props.onClick();
    assert.deepEqual(f.navigation, []); assert.equal(f.calls.toggle, 0); f.unmount();
  }
});

test('DPI Guard and unavailable Firewall remain disabled OFF with localized explanations in every locale', () => {
  for (const { id } of PRODUCTION_LANGUAGES) {
    const f = fixture({ locale: id });
    for (const [name, attribute, reason] of [['DpiGuardLauncher', 'data-dpi-guard-launcher', 'coming_soon'], ['UnavailableFirewallLauncher', 'data-firewall-unavailable-launcher', 'firewall_unavailable']]) {
      const vnode = f.ui[name](), card = vnode.type(vnode.props), controls = card.props.children.props.children;
      assert.equal(card.props[attribute], true);
      assert.equal(card.props.children.props.title, GUARD_LAUNCHER_UI_MESSAGES[id]['guard_launcher_' + reason]);
      // ADR-103: DPI Guard adds a visible localized "soon" word; both buttons stay disabled.
      const buttons = controls.filter(Boolean).filter(control => control.type === 'button');
      assert.equal(buttons.length, 2);
      assert.equal(controls.filter(Boolean).length, name === 'DpiGuardLauncher' ? 3 : 2);
      if (name === 'DpiGuardLauncher') assert.equal(controls[2].props.children, GUARD_LAUNCHER_UI_MESSAGES[id].guard_launcher_coming_soon);
      for (const control of buttons) { assert.equal(control.props.disabled, true); assert.equal(control.props.onClick, undefined); assert.ok(control.props['aria-label']); }
      assert.equal(controls[1].props.role, 'switch'); assert.equal(controls[1].props['aria-checked'], false); assert.equal(labels(controls[1]), 'OFF');
    }
    assert.deepEqual(f.calls, { load: 0, toggle: 0, dispose: 0 }); assert.deepEqual(f.navigation, []);
  }
});

test('Firewall capability follows the declared production permission and fails closed', () => {
  const f = fixture();
  assert.equal(f.hasFirewall({ runtime: { getManifest: () => ({ permissions: ['declarativeNetRequestWithHostAccess'] }) } }), true);
  for (const permissions of [[], ['declarativeNetRequest'], 'declarativeNetRequestWithHostAccess', null]) assert.equal(f.hasFirewall({ runtime: { getManifest: () => ({ permissions }) } }), false);
  assert.equal(f.hasFirewall({ runtime: { getManifest: () => { throw Error('unavailable'); } } }), false);
});

test('launcher copy has an explicit complete catalog for all 21 production locales', () => {
  assert.deepEqual(Object.keys(GUARD_LAUNCHER_UI_MESSAGES).sort(), PRODUCTION_LANGUAGES.map(value => value.id).sort());
  for (const { id } of PRODUCTION_LANGUAGES) {
    const table = { existing: { message: 'keep' } }; applyGuardLauncherCopy(table, id);
    assert.equal(table.existing.message, 'keep');
    for (const key of GUARD_LAUNCHER_UI_KEYS) assert.ok(table[key].message && table[key].message !== key && !table[key].message.includes('\uFFFD'));
  }
  assert.throws(() => applyGuardLauncherCopy({}, 'not-a-locale'));
});
