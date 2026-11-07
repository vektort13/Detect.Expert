// Controlled Math UX: no probes or persistence, canonical draft changes and saved effective states.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMathTranscendentalsUi, MATH_UI_GROUPS } from '../../apps/production-extension/antidetect-math-ui.js';
import { API_MATH_FUNCTIONS } from '../../apps/production-extension/api-configuration.js';
import { MATH_UI_KEYS, MATH_UI_ALIAS_KEYS, MATH_UI_MESSAGES, applyMathCopy } from '../production-locales-math.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';

const model = (functions = API_MATH_FUNCTIONS, mode = 'spoof') => ({ mode, profile: { algorithm: 'deterministic-ulp-v1', functions: [...functions] } });
function harness(initialProps = {}, locale = 'en') {
  const slots = [], effects = [], changes = []; let cursor = 0, dirty = true, tree, props = { value: model(), onChange: next => changes.push(next), effective: 'inactive', ...initialProps };
  const hooks = {
    useState(initial) { const slot = slots[cursor++] ??= { value: initial }; return [slot.value, next => { const value = typeof next === 'function' ? next(slot.value) : next; if (!Object.is(value, slot.value)) { slot.value = value; dirty = true; } }]; },
    useRef(initial) { return (slots[cursor++] ??= { ref: { current: initial } }).ref; },
    useEffect(callback, dependencies) { const slot = slots[cursor++] ??= {}; if (!slot.dependencies || dependencies?.some((value, index) => !Object.is(value, slot.dependencies[index]))) { slot.dependencies = dependencies; effects.push(() => { slot.cleanup?.(); slot.cleanup = callback(); }); } },
  };
  const ui = createMathTranscendentalsUi({ ...hooks, h: (type, props) => ({ type, props }), useLocale: () => locale, translate: key => MATH_UI_MESSAGES[locale][key] ?? key });
  function render() { cursor = 0; dirty = false; tree = ui.MathTranscendentalsPanel(props); while (effects.length) effects.shift()(); return tree; }
  function nodes(predicate) { const result = []; function visit(node) { if (Array.isArray(node)) { node.forEach(visit); return; } if (!node?.props) return; if (predicate(node)) result.push(node); visit(node.props.children); } visit(tree); return result; }
  const attr = (key, value = true) => nodes(node => node.props[key] === value)[0];
  return { render, nodes, attr, changes, get tree() { return tree; }, update(next) { props = { ...props, ...next }; dirty = true; return render(); }, settle() { if (dirty) render(); return tree; }, unmount() { for (const slot of slots) slot?.cleanup?.(); } };
}

test('all 23 canonical functions appear exactly once in four groups without executing Math or changing the controlled value', () => {
  const value = model(), original = JSON.stringify(value), h = harness({ value });
  const before = Object.getOwnPropertyDescriptor(Math, 'sin'); let probes = 0;
  Object.defineProperty(Math, 'sin', { configurable: true, get() { probes++; throw Error('UI must not probe Math'); } });
  try {
    h.render(); assert.equal(probes, 0); assert.equal(h.changes.length, 0); assert.equal(JSON.stringify(value), original);
    const functions = h.nodes(node => node.props['data-math-function']).map(node => node.props['data-math-function']);
    assert.equal(functions.length, 23); assert.equal(API_MATH_FUNCTIONS.length, 23); assert.deepEqual(new Set(functions), new Set(API_MATH_FUNCTIONS));
    assert.deepEqual(h.nodes(node => node.props['data-math-group']).map(node => node.props['data-math-group']), ['trig', 'hyperbolic', 'exp_log', 'power']);
    const grouped = MATH_UI_GROUPS.flatMap(group => group.functions);assert.equal(grouped.length, 23);assert.equal(new Set(grouped).size, 23);
    assert.deepEqual(MATH_UI_GROUPS.find(group => group.id === 'power').functions, ['pow', 'sqrt', 'cbrt', 'hypot']);
    assert.equal(h.attr('data-math-selected-count', 23).props.children, MATH_UI_MESSAGES.en.antidetect_math_selected + ': 23/23');
  } finally { Object.defineProperty(Math, 'sin', before); h.unmount(); }
});

test('toggle changes emit one immutable complete profile in canonical order while the parent remains the only state owner', () => {
  const value = model(['sin', 'pow']), h = harness({ value }); h.render();
  h.attr('data-math-function', 'acos').props.onChange({ currentTarget: { checked: true } });
  assert.equal(h.changes.length, 1); assert.deepEqual(h.changes[0], model(['acos', 'sin', 'pow'])); assert.deepEqual(value, model(['sin', 'pow'])); assert.equal(h.attr('data-math-function', 'acos').props.checked, false, 'the view changes only when parent supplies the draft');
  h.update({ value: h.changes.at(-1) }); assert.equal(h.attr('data-math-function', 'acos').props.checked, true);
  h.attr('data-math-function', 'sin').props.onChange({ currentTarget: { checked: false } }); assert.deepEqual(h.changes.at(-1), model(['acos', 'pow'])); h.unmount();
});

test('search is local and selection-wide all/clear actions include hidden functions without dropping the algorithm', () => {
  const h = harness({ value: model(['pow']) }); h.render();
  h.attr('data-math-search').props.onInput({ currentTarget: { value: 'Math.log' } }); h.settle(); assert.deepEqual(h.nodes(node => node.props['data-math-function']).map(node => node.props['data-math-function']), ['log', 'log1p', 'log2', 'log10']); assert.equal(h.changes.length, 0);
  h.attr('data-math-select-all').props.onClick(); assert.deepEqual(h.changes.at(-1), model()); h.update({ value: h.changes.at(-1) }); assert.equal(h.attr('data-math-search').props.value, 'Math.log');
  h.attr('data-math-clear').props.onClick(); assert.deepEqual(h.changes.at(-1), model([])); h.update({ value: h.changes.at(-1), effective: 'empty' }); assert.equal(h.attr('data-math-selected-count', 0).props.children, MATH_UI_MESSAGES.en.antidetect_math_selected + ': 0/23'); assert.equal(h.attr('data-math-effective-state', 'empty').props.children[1], MATH_UI_MESSAGES.en.antidetect_math_status_empty); assert.doesNotMatch(h.attr('data-math-effective-state', 'empty').props.class, /--spoof/); h.unmount();
});

test('localized group search and unmatched queries neither change selected functions nor call a parent handler', () => {
  const h = harness({}, 'ru'); h.render(); h.attr('data-math-search').props.onInput({ currentTarget: { value: 'логарифмы' } }); h.settle(); assert.deepEqual(h.nodes(node => node.props['data-math-group']).map(node => node.props['data-math-group']), ['exp_log']); assert.equal(h.nodes(node => node.props['data-math-function']).length, 6);
  h.attr('data-math-search').props.onInput({ currentTarget: { value: 'корни' } }); h.settle();assert.deepEqual(h.nodes(node => node.props['data-math-function']).map(node => node.props['data-math-function']), ['pow', 'sqrt', 'cbrt', 'hypot']);
  h.attr('data-math-search').props.onInput({ currentTarget: { value: 'not-a-real-function' } }); h.settle(); assert.ok(h.attr('data-math-empty-search')); assert.equal(h.attr('data-math-selected-count', 23).props['data-math-selected-count'], 23); assert.equal(h.changes.length, 0); h.unmount();
});

test('sqrt/cbrt/hypot toggles remain controlled and emit exact canonical IDs with the algorithm retained', () => {
  const h = harness({ value: model(['pow']) });h.render();
  for (const name of ['hypot', 'sqrt', 'cbrt']) {
    h.attr('data-math-function', name).props.onChange({ currentTarget: { checked: true } });
    h.update({ value: h.changes.at(-1) });
  }
  assert.deepEqual(h.changes.at(-1), model(['pow', 'sqrt', 'cbrt', 'hypot']));
  assert.equal(h.changes.length, 3);assert.equal(h.changes.at(-1).profile.algorithm, 'deterministic-ulp-v1');h.unmount();
});

test('Allow greys profile controls and retains the complete selected profile for a later return to Spoof', () => {
  const value = model(['atan2', 'pow']), h = harness({ value }); h.render(); h.attr('data-math-mode', 'allow').props.onClick(); assert.deepEqual(h.changes.at(-1), model(['atan2', 'pow'], 'allow'));
  h.update({ value: h.changes.at(-1), effective: 'allow' }); assert.equal(h.attr('data-math-profile').props.disabled, true); assert.equal(h.attr('data-math-function', 'pow').props.disabled, true); const count = h.changes.length; h.attr('data-math-clear').props.onClick(); h.attr('data-math-function', 'sin').props.onChange({ currentTarget: { checked: true } }); assert.equal(h.changes.length, count);
  h.attr('data-math-mode', 'spoof').props.onClick(); assert.deepEqual(h.changes.at(-1), model(['atan2', 'pow'])); h.update({ value: h.changes.at(-1) }); assert.equal(h.attr('data-math-profile').props.disabled, false); assert.equal(h.attr('data-math-function', 'pow').props.checked, true); h.unmount();
});

test('parent disabled and busy block every mutation handler, while Stale only neutralizes the saved effective state', () => {
  for (const gate of [{ disabled: true }, { busy: true }]) { const h = harness(gate); h.render(); assert.equal(h.attr('data-math-mode', 'allow').props.disabled, true); assert.equal(h.attr('data-math-profile').props.disabled, true); h.attr('data-math-mode', 'allow').props.onClick(); h.attr('data-math-clear').props.onClick(); h.attr('data-math-function', 'sin').props.onChange({ currentTarget: { checked: false } }); assert.equal(h.changes.length, 0); h.unmount(); }
  const h = harness({ effective: 'spoof', stale: true }); h.render(); assert.equal(h.attr('data-math-effective-state', 'unknown').props.children[1], MATH_UI_MESSAGES.en.antidetect_math_status_unknown); assert.doesNotMatch(h.attr('data-math-effective-state', 'unknown').props.class, /--spoof/); assert.equal(h.attr('data-math-profile').props.disabled, false, 'local draft edits remain available while the parent blocks Save'); h.unmount();
});

test('inherited mode selects no false Allow, and keyboard navigation changes only the parent draft', () => {
  const h = harness({ value: model(['sin'], 'inherit'), effective: 'inherited' }, 'ar'); h.render(); assert.ok(h.attr('data-math-inherited')); assert.equal(h.attr('data-math-mode', 'allow').props['aria-checked'], false); assert.equal(h.attr('data-math-mode', 'spoof').props['aria-checked'], false); assert.equal(h.attr('data-math-mode', 'allow').props.tabIndex, 0); let focused = 0, prevented = false; h.attr('data-math-mode', 'spoof').props.ref({ focus() { focused++; } });
  h.attr('data-math-mode', 'allow').props.onKeyDown({ key: 'End', preventDefault() { prevented = true; } }); assert.equal(prevented, true); assert.equal(focused, 1); assert.deepEqual(h.changes.at(-1), model(['sin'])); assert.equal(h.attr('data-math-mode', 'spoof').props['aria-checked'], false); h.unmount();
});

test('effective indicators use saved outcomes rather than the selected unsaved mode', () => {
  const h = harness({ value: model(), effective: 'allow' }); h.render(); assert.equal(h.attr('data-math-mode', 'spoof').props['aria-checked'], true); assert.equal(h.attr('data-math-effective-state', 'allow').props.children[1], MATH_UI_MESSAGES.en.antidetect_math_status_allow);
  h.update({ effective: 'spoof' }); assert.equal(h.attr('data-math-effective-state', 'spoof').props.children[1], 'Registered for new pages');
  for (const [effective, key] of [['inactive', 'status_inactive'], ['scope-inactive', 'status_inactive'], ['reload-required', 'status_pending'], ['error', 'status_error'], ['unsupported', 'status_unknown']]) { h.update({ effective }); assert.equal(h.attr('data-math-effective-state', effective).props.children[1], MATH_UI_MESSAGES.en['antidetect_math_' + key]); }
  h.update({ effective: 'untrusted-state' }); assert.ok(h.attr('data-math-effective-state', 'unknown')); assert.equal(h.changes.length, 0); h.unmount();
});

test('all 21 locales contain the same UI, precision and technical scope without executing probes or promising normalization', () => {
  assert.equal(Object.keys(MATH_UI_MESSAGES).length, PRODUCTION_LANGUAGES.length);
  for (const language of PRODUCTION_LANGUAGES) {
    const table = applyMathCopy({}, language.id); assert.deepEqual(Object.keys(table), [...MATH_UI_KEYS, ...MATH_UI_ALIAS_KEYS]); for (const key of [...MATH_UI_KEYS, ...MATH_UI_ALIAS_KEYS]) assert.ok(table[key].message.trim(), language.id + '/' + key); assert.equal(table.protection_feature_math_transcendentals.message, table.antidetect_math_title.message);
    assert.match(table.antidetect_math_description.message, /23/);assert.doesNotMatch(table.antidetect_math_description.message, /20/);
    const h = harness({}, language.id); h.render(); const textNodes = []; function visit(node) { if (typeof node === 'string') { textNodes.push(node); return; } if (Array.isArray(node)) return node.forEach(visit); if (node?.props) visit(node.props.children); } visit(h.tree);
    assert.equal(textNodes.some(value => value.startsWith('antidetect_math_')), false, language.id + ': no raw key'); assert.match(table.antidetect_math_precision.message, /1 ULP/); assert.match(table.antidetect_math_coverage.message, /Workers/); assert.match(table.antidetect_math_coverage.message, /WebAssembly/); assert.match(table.antidetect_math_coverage.message, /\*\*/); assert.match(table.antidetect_math_coverage.message, /CSS/); assert.match(table.antidetect_math_primitive_numbers.message, /Number/); assert.ok(h.attr('data-math-primitive-numbers')); assert.ok(h.attr('data-math-opaque')); assert.ok(h.attr('data-math-coverage')); h.unmount();
  }
});
