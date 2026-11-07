// Controlled Math editor. Parent owns persistence, master state, CAS and early registration.
import { API_MATH_FUNCTIONS } from './api-configuration.js';

export const MATH_UI_GROUPS = Object.freeze([
  Object.freeze({ id: 'trig', functions: Object.freeze(['acos', 'asin', 'atan', 'atan2', 'cos', 'sin', 'tan']) }),
  Object.freeze({ id: 'hyperbolic', functions: Object.freeze(['acosh', 'asinh', 'atanh', 'cosh', 'sinh', 'tanh']) }),
  Object.freeze({ id: 'exp_log', functions: Object.freeze(['exp', 'expm1', 'log', 'log1p', 'log2', 'log10']) }),
  Object.freeze({ id: 'power', functions: Object.freeze(['pow', 'sqrt', 'cbrt', 'hypot']) }),
]);
const DEFAULT_VALUE = Object.freeze({ mode: 'inherit', profile: Object.freeze({ algorithm: 'deterministic-ulp-v1', functions: API_MATH_FUNCTIONS }) });
const STATES = Object.freeze({ spoof: 'status_active', allow: 'status_allow', inherited: 'inherited', inherit: 'inherited', empty: 'status_empty', inactive: 'status_inactive', 'scope-inactive': 'status_inactive', 'reload-required': 'status_pending', error: 'status_error', unsupported: 'status_unknown', unknown: 'status_unknown' });

export function createMathTranscendentalsUi({ h, useState, useEffect, useRef, useLocale, translate }) {
  const t = key => translate('antidetect_math_' + key);
  function Icon({ name = 'math', size = 21 }) {
    const path = {
      math: 'M18 4H7l7 8-7 8h11M3 7l2-2m-2 12 2 2',
      trig: 'M3 12h18M12 3v18M3 12c2-10 6-10 9 0s7 10 9 0',
      hyperbolic: 'M3 20h18M4 17c5-15 11-15 16 0M7 4h10',
      exp_log: 'M3 3v18h18M5 18c8 0 12-5 13-14M7 9l2-2m4 8 2-2',
      power: 'm4 10 7 10m0-10L4 20m11-12 5-5m-5 0h5v5',
      search: 'M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 1 0 0-15Zm5.5 13 5 5',
    }[name];
    return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': true, focusable: 'false', children: h('path', { d: path }) });
  }
  function MathTranscendentalsPanel({ value = DEFAULT_VALUE, disabled = false, busy = false, onChange, effective = 'unknown', stale = false }) {
    const locale = useLocale(), [query, setQuery] = useState(''), radioRefs = useRef(new Map());
    const model = value?.profile && Array.isArray(value.profile.functions) ? value : DEFAULT_VALUE;
    const selection = new Set(model.profile.functions), selected = API_MATH_FUNCTIONS.filter(name => selection.has(name));
    const blocked = disabled || busy, fieldsDisabled = blocked || model.mode !== 'spoof';
    const needle = query.trim().toLocaleLowerCase(), rtl = /^(ar|ur)(?:[-_]|$)/i.test(locale);
    const groups = MATH_UI_GROUPS.map(group => ({ ...group, shown: group.functions.filter(name => !needle || ('Math.' + name + '() ' + t('group_' + group.id)).toLocaleLowerCase().includes(needle)) })).filter(group => group.shown.length);
    const actual = stale ? 'unknown' : typeof effective === 'string' && Object.hasOwn(STATES, effective) ? effective : 'unknown';
    const stateLabel = t(STATES[actual]), highlighted = actual === 'spoof' || actual === 'allow';
    function changeMode(mode) { if (!blocked && mode !== model.mode) onChange({ ...model, mode, profile: { ...model.profile, functions: [...model.profile.functions] } }); }
    function changeFunctions(functions) { if (!fieldsDisabled) onChange({ ...model, profile: { ...model.profile, functions: API_MATH_FUNCTIONS.filter(name => functions.has(name)) } }); }
    function toggle(name, checked) { const next = new Set(selection); checked ? next.add(name) : next.delete(name); changeFunctions(next); }
    function navigate(event, index) {
      let next; if (event.key === 'Home') next = 0; else if (event.key === 'End') next = 1;
      else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft' || event.key === 'ArrowDown' || event.key === 'ArrowUp') next = (index + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : (event.key === 'ArrowRight' ? 1 : -1) * (rtl ? -1 : 1)) + 2) % 2;
      else return;
      event.preventDefault(); if (blocked) return; const mode = ['allow', 'spoof'][next]; changeMode(mode); radioRefs.current.get(mode)?.focus();
    }
    return h('section', { class: 'antidetect-math antidetect-card', 'data-math-transcendentals': true, 'aria-busy': busy, children: [
      h('div', { class: 'antidetect-math-heading', children: [h('div', { class: 'antidetect-math-title', children: [h('span', { class: 'antidetect-math-icon', children: h(Icon, { size: 24 }) }), h('div', { children: [h('h3', { children: t('title') }), h('p', { class: 'antidetect-math-note', children: t('description') })] })] }), h('span', { class: 'antidetect-math-state' + (highlighted ? ' antidetect-math-state--' + actual : ''), role: 'status', 'data-math-effective-state': actual, children: [h('span', { class: 'antidetect-math-state__dot', 'aria-hidden': true }), stateLabel] })] }),
      h('div', { class: 'antidetect-math-modes', role: 'radiogroup', 'aria-label': t('mode'), children: ['allow', 'spoof'].map((mode, index) => h('button', { type: 'button', class: 'antidetect-math-mode antidetect-math-mode--' + mode + (model.mode === mode ? ' is-selected' : ''), role: 'radio', 'aria-checked': model.mode === mode, disabled: blocked, tabIndex: model.mode === mode || model.mode === 'inherit' && index === 0 ? 0 : -1, key: mode, 'data-math-mode': mode, ref: element => { if (element) radioRefs.current.set(mode, element); else radioRefs.current.delete(mode); }, onClick: () => changeMode(mode), onKeyDown: event => navigate(event, index), children: t(mode) })) }),
      model.mode === 'inherit' ? h('p', { class: 'antidetect-math-note', 'data-math-inherited': true, children: t('inherited') }) : null,
      h('fieldset', { class: 'antidetect-math-profile', disabled: fieldsDisabled, 'data-math-profile': true, children: [
        h('legend', { class: 'sr-only', children: t('functions') }),
        h('div', { class: 'antidetect-math-toolbar', children: [h('label', { class: 'antidetect-math-search', children: [h(Icon, { name: 'search', size: 17 }), h('input', { type: 'search', value: query, maxLength: 64, disabled: fieldsDisabled, placeholder: t('search'), 'aria-label': t('search'), autoComplete: 'off', spellcheck: false, 'data-math-search': true, onInput: event => { if (!fieldsDisabled) setQuery(event.currentTarget.value); } })] }), h('span', { class: 'antidetect-math-count', 'data-math-selected-count': selected.length, children: t('selected') + ': ' + selected.length + '/' + API_MATH_FUNCTIONS.length }), h('div', { class: 'antidetect-math-selection', children: [h('button', { type: 'button', class: 'button button--text', disabled: fieldsDisabled || selected.length === API_MATH_FUNCTIONS.length, 'data-math-select-all': true, onClick: () => changeFunctions(new Set(API_MATH_FUNCTIONS)), children: t('all') }), h('button', { type: 'button', class: 'button button--text', disabled: fieldsDisabled || selected.length === 0, 'data-math-clear': true, onClick: () => changeFunctions(new Set()), children: t('clear') })] })] }),
        groups.length ? h('div', { class: 'antidetect-math-groups', children: groups.map(group => h('section', { class: 'antidetect-math-group antidetect-math-group--' + group.id, key: group.id, 'data-math-group': group.id, children: [h('h4', { children: [h('span', { class: 'antidetect-math-group__icon', children: h(Icon, { name: group.id, size: 18 }) }), h('span', { children: t('group_' + group.id) }), h('span', { class: 'antidetect-math-group__count', children: group.functions.filter(name => selection.has(name)).length + '/' + group.functions.length })] }), h('div', { class: 'antidetect-math-functions', children: group.shown.map(name => h('label', { class: 'antidetect-math-function' + (selection.has(name) ? ' is-selected' : ''), key: name, children: [h('input', { type: 'checkbox', checked: selection.has(name), disabled: fieldsDisabled, 'data-math-function': name, onChange: event => toggle(name, event.currentTarget.checked) }), h('code', { dir: 'ltr', children: 'Math.' + name + '()' })] })) }), group.id === 'power' ? h('p', { class: 'antidetect-math-note', children: t('pow_note') }) : null] })) }) : h('p', { class: 'antidetect-math-note', 'data-math-empty-search': true, children: t('empty') })
      ] }),
      h('div', { class: 'antidetect-math-method', children: [h('p', { children: t('method') }), h('ul', { children: [h('li', { children: t('precision') }), h('li', { children: t('stability') }), h('li', { children: t('special_cases') }), h('li', { 'data-math-primitive-numbers': true, children: t('primitive_numbers') })] }), h('p', { class: 'antidetect-math-coverage', 'data-math-coverage': true, children: t('coverage') }), h('p', { class: 'antidetect-math-coverage', 'data-math-opaque': true, children: t('opaque') })] })
    ] });
  }
  return { MathTranscendentalsPanel };
}
