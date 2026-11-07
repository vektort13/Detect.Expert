// Round 5 (ADR-101 amendment): typed controls for the Custom media-capabilities value in the Custom value editor.
// The controls and the JSON view are one draft; changes flow through the modal's draft and the contract validation of Save; the
// controls never probe the browser; the labels exist in all 21 languages and the note stays honest about what is not covered.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  createMediaCodecConfigurationUi, mediaCodecText, readMediaCodec, readMediaCodecInput,
  MEDIA_CODEC_FALLBACK, MEDIA_CODEC_FAMILY_LABELS, MEDIA_CODEC_IDENTITY, MEDIA_CODEC_START
} from '../../apps/production-extension/media-codec-configuration-ui.js';
import { createApiConfigurationUi } from '../../apps/production-extension/api-configuration-ui.js';
import { API_CONFIG_CATALOG, API_MEDIA_CODEC_FAMILIES, validateApiValue } from '../../apps/production-extension/api-configuration.js';
import { MEDIA_CODEC_FIELDS, MEDIA_CODEC_KEYS, MEDIA_CODEC_MESSAGES, applyMediaCopy } from '../production-locales-media.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';

const clone = value => structuredClone(value), turn = () => new Promise(resolve => setImmediate(resolve));
const root = new URL('../../', import.meta.url);
const sourceOf = path => readFileSync(new URL(path, root), 'utf8');
// A minimal virtual tree with working hooks (the style of webrtc-configuration-ui.test.mjs): nodes are { type, props }.
function harness(build, initialProps) {
  const slots = [], effects = []; let cursor = 0, dirty = true, tree, props = initialProps;
  const hooks = {
    // The tree has no renderer: the media controls are expanded where the modal creates them, so the modal tests see their inputs.
    h: (type, p) => typeof type === 'function' && type.name === 'MediaCodecFields' ? type(p) : { type, props: p },
    useState(initial) { const slot = slots[cursor++] ??= { value: initial }; return [slot.value, next => { const value = typeof next === 'function' ? next(slot.value) : next; if (!Object.is(value, slot.value)) { slot.value = value; dirty = true; } }]; },
    useRef(initial) { return (slots[cursor++] ??= { ref: { current: initial } }).ref; },
    useEffect(callback, dependencies) { const slot = slots[cursor++] ??= {}; if (!slot.dependencies || dependencies?.some((value, index) => !Object.is(value, slot.dependencies[index]))) { slot.dependencies = dependencies; effects.push(() => { slot.cleanup?.(); slot.cleanup = callback(); }); } }
  };
  const component = build(hooks);
  function render() { cursor = 0; dirty = false; tree = component(props); while (effects.length) effects.shift()(); }
  function nodes(predicate) { const found = []; const visit = node => { if (Array.isArray(node)) return node.forEach(visit); if (!node?.props) return; if (predicate(node)) found.push(node); visit(node.props.children); }; visit(tree); return found; }
  const attr = (key, value = true) => nodes(node => node.props[key] === value)[0];
  return { render, nodes, attr, get tree() { return tree; }, update(next) { props = { ...props, ...next }; render(); },
    async settle() { for (let count = 0; count < 6; count++) { if (dirty) render(); await turn(); } if (dirty) render(); }, unmount() { for (const slot of slots) slot?.cleanup?.(); } };
}
const fieldsHarness = (props, translate) => harness(hooks => createMediaCodecConfigurationUi({ ...hooks, translate }).MediaCodecFields, props);
const mediaEntry = () => ({ ...clone(API_CONFIG_CATALOG.find(item => item.id === 'media-capabilities')), mode: 'custom', selected: { kind: 'value', value: clone(MEDIA_CODEC_IDENTITY) }, userValues: [], settings: {} });
const modalHarness = (props, { translate, locale = 'en' } = {}) => harness(hooks => createApiConfigurationUi({ ...hooks, useLocale: () => locale, browserApi: {}, translate }).ValueModal, props);
const preventDefault = () => {};
const submit = h => h.nodes(node => node.type === 'form')[0].props.onSubmit({ preventDefault });
const flagInput = (h, key) => h.attr('data-media-codec-field', key);
const familyInput = (h, family) => h.attr('data-media-codec-family', family);
const flagState = h => ['supported', 'smooth', 'powerEfficient'].map(key => [flagInput(h, key).props.checked, flagInput(h, key).props.disabled]);
const hiddenOf = h => API_MEDIA_CODEC_FAMILIES.filter(family => familyInput(h, family).props.checked);
const valueOf = (supported, smooth, powerEfficient, hidden = []) => ({ hidden, powerEfficient, smooth, supported });
const text = node => [].concat(node.props.children).filter(child => typeof child === 'string').join('');

test('the controls are real fieldsets and checkboxes: three answer flags, the eleven families in contract order, and the honest note', () => {
  const h = fieldsHarness({ value: valueOf(true, true, false, ['h264']), onChange() {} }); h.render();
  const fieldsets = h.nodes(node => node.type === 'fieldset');
  assert.equal(fieldsets.length, 2);
  assert.deepEqual(fieldsets.map(node => text(node.props.children.find(child => child?.type === 'legend'))), ['Answer given to the page', 'Hide codec families']);
  const flags = h.nodes(node => node.props['data-media-codec-field']);
  assert.deepEqual(flags.map(node => node.props['data-media-codec-field']), ['supported', 'smooth', 'powerEfficient']);
  assert.ok(flags.every(node => node.type === 'input' && node.props.type === 'checkbox'));
  const families = h.nodes(node => node.props['data-media-codec-family']);
  assert.deepEqual(families.map(node => node.props['data-media-codec-family']), [...API_MEDIA_CODEC_FAMILIES]);
  assert.ok(families.every(node => node.type === 'input' && node.props.type === 'checkbox'));
  assert.deepEqual(API_MEDIA_CODEC_FAMILIES.map(family => text(h.nodes(node => node.type === 'span' && node.props.dir === 'ltr')[API_MEDIA_CODEC_FAMILIES.indexOf(family)])), API_MEDIA_CODEC_FAMILIES.map(family => MEDIA_CODEC_FAMILY_LABELS[family]), 'codec names read left to right in every language');
  assert.deepEqual(Object.keys(MEDIA_CODEC_FAMILY_LABELS), [...API_MEDIA_CODEC_FAMILIES]);
  assert.deepEqual(['H.264', 'H.265 / HEVC', 'AV1', 'VP9', 'VP8', 'AAC', 'Opus', 'Vorbis', 'FLAC', 'MP3'], API_MEDIA_CODEC_FAMILIES.slice(0, 10).map(family => MEDIA_CODEC_FAMILY_LABELS[family]));
  assert.match(MEDIA_CODEC_FAMILY_LABELS.dolby, /^Dolby /);
  assert.deepEqual(hiddenOf(h), ['h264']);
  assert.deepEqual(flagState(h), [[true, false], [true, false], [false, false]]);
  const note = h.attr('data-media-codec-note');
  assert.equal(note.props.id, 'media-codec-note');
  assert.equal(fieldsets[1].props['aria-describedby'], note.props.id, 'the families group is described by the note');
  for (const word of ['only lower', 'MediaCapabilities', 'canPlayType', 'isTypeSupported', 'windows and same-origin frames', 'Workers', 'opaque origin', 'not covered']) assert.ok(text(note).includes(word), word);
  assert.equal(h.nodes(node => node.type === 'input' && node.props.type !== 'checkbox').length, 0, 'no free-text input: the JSON view is the only text editor');
  assert.equal(h.attr('data-media-codec-invalid'), undefined); assert.equal(h.attr('data-media-codec-all-off'), undefined);
});

test('flags: smooth and power efficient need Supported; switching it off lowers them, shows them off and locked, and switching it on gives them back', () => {
  const changes = [], h = fieldsHarness({ value: valueOf(true, true, true), onChange: next => changes.push(next) }); h.render();
  const apply = () => { h.update({ value: changes.at(-1) }); };
  flagInput(h, 'smooth').props.onChange({ currentTarget: { checked: false } }); assert.deepEqual(changes.at(-1), valueOf(true, false, true)); apply();
  flagInput(h, 'smooth').props.onChange({ currentTarget: { checked: true } }); assert.deepEqual(changes.at(-1), valueOf(true, true, true)); apply();
  flagInput(h, 'supported').props.onChange({ currentTarget: { checked: false } });
  assert.deepEqual(changes.at(-1), valueOf(false, false, false), 'Supported off lowers the other two flags in the value itself'); apply();
  assert.deepEqual(flagState(h), [[false, false], [false, true], [false, true]], 'smooth and power efficient are shown off and locked');
  assert.ok(API_MEDIA_CODEC_FAMILIES.every(family => familyInput(h, family).props.disabled === true), 'the family boxes are locked while nothing is supported');
  assert.equal(text(h.attr('data-media-codec-all-off')), MEDIA_CODEC_FALLBACK.all_off);
  const before = changes.length;
  flagInput(h, 'smooth').props.onChange({ currentTarget: { checked: true } }); familyInput(h, 'aac').props.onChange({ currentTarget: { checked: true } });
  assert.equal(changes.length, before, 'a queued change of a locked control does nothing');
  flagInput(h, 'supported').props.onChange({ currentTarget: { checked: true } });
  assert.deepEqual(changes.at(-1), valueOf(true, true, true), 'smooth and power efficient come back as they were'); apply();
  assert.equal(h.attr('data-media-codec-all-off'), undefined);
  const fresh = fieldsHarness({ value: valueOf(false, false, false), onChange: next => changes.push(next) }); fresh.render();
  flagInput(fresh, 'supported').props.onChange({ currentTarget: { checked: true } });
  assert.deepEqual(changes.at(-1), valueOf(true, false, false), 'with nothing remembered they stay off');
});

test('families: the hidden list stays in contract order, whatever order the boxes are ticked in, and every emitted value is a valid canonical value', () => {
  const changes = [], h = fieldsHarness({ value: clone(MEDIA_CODEC_IDENTITY), onChange: next => changes.push(next) }); h.render();
  const tick = (family, checked) => { familyInput(h, family).props.onChange({ currentTarget: { checked } }); h.update({ value: changes.at(-1) }); };
  tick('dolby', true); tick('aac', true); tick('h264', true);
  assert.deepEqual(changes.at(-1).hidden, ['h264', 'aac', 'dolby']);
  assert.deepEqual(Object.keys(changes.at(-1)), ['hidden', 'powerEfficient', 'smooth', 'supported'], 'canonical key order, like the JSON the contract writes');
  tick('aac', false); assert.deepEqual(changes.at(-1).hidden, ['h264', 'dolby']);
  for (const family of API_MEDIA_CODEC_FAMILIES) tick(family, true);
  assert.deepEqual(changes.at(-1).hidden, [...API_MEDIA_CODEC_FAMILIES]);
  // A random walk over every control: each emitted value is valid, never smooth or efficient without support, and the boxes follow it.
  let seed = 20261106; const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let step = 0; step < 300; step++) {
    const roll = random(), checked = random() < 0.5;
    if (roll < 0.25) flagInput(h, 'supported').props.onChange({ currentTarget: { checked } });
    else if (roll < 0.45) flagInput(h, 'smooth').props.onChange({ currentTarget: { checked } });
    else if (roll < 0.65) flagInput(h, 'powerEfficient').props.onChange({ currentTarget: { checked } });
    else familyInput(h, API_MEDIA_CODEC_FAMILIES[Math.floor(random() * API_MEDIA_CODEC_FAMILIES.length)]).props.onChange({ currentTarget: { checked } });
    const value = changes.at(-1); h.update({ value });
    assert.equal(validateApiValue('media-capabilities', { kind: 'value', value }).ok, true, JSON.stringify(value));
    if (!value.supported) assert.deepEqual([value.smooth, value.powerEfficient], [false, false]);
    assert.deepEqual(hiddenOf(h), value.hidden); assert.deepEqual(flagState(h).map(([on]) => on), [value.supported, value.supported && value.smooth, value.supported && value.powerEfficient]);
  }
});

test('the outer disabled state and an invalid JSON view lock every control and ignore queued events', () => {
  const changes = [];
  for (const [label, props] of [['disabled', { disabled: true }], ['invalid', { invalid: true }]]) {
    const h = fieldsHarness({ value: valueOf(true, true, false, ['av1']), onChange: next => changes.push(next), ...props }); h.render();
    assert.equal(h.nodes(node => node.type === 'input').length, 14, label); assert.equal(h.nodes(node => node.type === 'fieldset').length, 2, label);
    assert.ok(h.nodes(node => node.type === 'input').every(node => node.props.disabled === true), label);
    assert.ok(h.nodes(node => node.type === 'fieldset').every(node => node.props.disabled === true), label);
    flagInput(h, 'supported').props.onChange({ currentTarget: { checked: false } }); familyInput(h, 'h264').props.onChange({ currentTarget: { checked: true } });
    assert.equal(changes.length, 0, label);
    assert.deepEqual(hiddenOf(h), ['av1'], label + ': the last valid value stays shown');
    assert.equal(label === 'invalid' ? text(h.attr('data-media-codec-invalid')) : h.attr('data-media-codec-invalid'), label === 'invalid' ? MEDIA_CODEC_FALLBACK.json_invalid : undefined);
    if (label === 'invalid') assert.equal(h.attr('data-media-codec-invalid').props.role, 'status');
  }
});

test('texts come from the message tables, fall back to English per key, and a missing translation never shows a key', () => {
  const ru = key => MEDIA_CODEC_MESSAGES.ru[key] ?? key;
  const h = fieldsHarness({ value: clone(MEDIA_CODEC_IDENTITY), onChange() {} }, ru); h.render();
  assert.deepEqual(h.nodes(node => node.type === 'legend').map(text), [MEDIA_CODEC_MESSAGES.ru.media_codecs_flags, MEDIA_CODEC_MESSAGES.ru.media_codecs_families]);
  assert.equal(text(h.attr('data-media-codec-note')), MEDIA_CODEC_MESSAGES.ru.media_codecs_note);
  const partial = key => key === 'media_codecs_flags' ? 'Own title' : key;
  const g = fieldsHarness({ value: clone(MEDIA_CODEC_IDENTITY), onChange() {} }, partial); g.render();
  assert.deepEqual(g.nodes(node => node.type === 'legend').map(text), ['Own title', MEDIA_CODEC_FALLBACK.families]);
  assert.equal(mediaCodecText(undefined, 'note'), MEDIA_CODEC_FALLBACK.note); assert.equal(mediaCodecText(() => '', 'smooth'), MEDIA_CODEC_FALLBACK.smooth); assert.equal(mediaCodecText(() => undefined, 'nothing'), 'nothing');
  for (const field of MEDIA_CODEC_FIELDS) assert.equal(MEDIA_CODEC_FALLBACK[field], MEDIA_CODEC_MESSAGES.en['media_codecs_' + field], 'the English fallback in the module is the en table: ' + field);
  assert.deepEqual(Object.keys(MEDIA_CODEC_FALLBACK), [...MEDIA_CODEC_FIELDS]);
});

test('reading values: the contract decides, the result is canonical, and anything else is not a value', () => {
  assert.deepEqual(readMediaCodec({ supported: true, smooth: false, powerEfficient: false, hidden: ['aac', 'h264'] }), valueOf(true, false, false, ['h264', 'aac']));
  for (const bad of [null, undefined, 3, 'x', [], {}, { supported: true, smooth: true, powerEfficient: true }, valueOf(false, true, false), valueOf(true, true, true, ['h263']), valueOf(true, true, true, ['aac', 'aac']), { ...valueOf(true, true, true), extra: 1 }]) assert.equal(readMediaCodec(bad), null, JSON.stringify(bad));
  assert.deepEqual(readMediaCodecInput('{"supported":true,"smooth":true,"powerEfficient":true,"hidden":[]}'), clone(MEDIA_CODEC_IDENTITY));
  for (const bad of ['', '{', 'null', '[]', '{"supported":true}', 5, undefined, 'x'.repeat(70000)]) assert.equal(readMediaCodecInput(bad), null);
  assert.deepEqual(MEDIA_CODEC_START, { kind: 'value', value: MEDIA_CODEC_IDENTITY });
  assert.equal(validateApiValue('media-capabilities', MEDIA_CODEC_START).ok, true);
});

// ---- the Custom value editor: the controls and the JSON view are one draft ----
const jsonView = h => h.attr('data-api-value-input');
const setJson = (h, value) => jsonView(h).props.onInput({ currentTarget: { value } });

test('the value editor shows the controls above the JSON view, starts a new value from the browser answer and keeps every other API untouched', async () => {
  const h = modalHarness({ entry: mediaEntry(), onSave: async () => {}, onClose() {} }); h.render(); await h.settle();
  assert.equal(h.nodes(node => node.props['data-media-codec-fields']).length, 1);
  assert.equal(jsonView(h).type, 'textarea', 'the JSON view stays available');
  assert.equal(jsonView(h).props.value, JSON.stringify(MEDIA_CODEC_IDENTITY, null, 2), 'a new value starts from the browser answer, not from the first preset that lowers everything');
  assert.deepEqual(flagState(h), [[true, false], [true, false], [true, false]]); assert.deepEqual(hiddenOf(h), []);
  const order = h.nodes(node => node.props['data-media-codec-fields'] || node.props['data-api-value-input']).map(node => node.props['data-media-codec-fields'] ? 'fields' : 'json');
  assert.deepEqual(order, ['fields', 'json']);
  h.unmount();
  for (const id of ['hardware-concurrency', 'webrtc', 'navigator-platform']) {
    const other = modalHarness({ entry: { ...clone(API_CONFIG_CATALOG.find(item => item.id === id)), mode: 'custom', selected: { kind: 'unset' }, userValues: [], settings: {} }, onSave: async () => {}, onClose() {} }); other.render();
    assert.equal(other.nodes(node => node.props['data-media-codec-fields']).length, 0, id); other.unmount();
  }
  const saved = modalHarness({ entry: mediaEntry(), value: { id: 'custom-1', label: 'Saved', value: { kind: 'value', value: valueOf(true, false, false, ['vp8']) } }, onSave: async () => {}, onClose() {} }); saved.render();
  assert.deepEqual(hiddenOf(saved), ['vp8']); assert.deepEqual(flagState(saved).map(([on]) => on), [true, false, false]); saved.unmount();
});

test('controls to JSON and JSON to controls: both directions stay in sync, and the JSON text is written in the contract order', async () => {
  const h = modalHarness({ entry: mediaEntry(), onSave: async () => {}, onClose() {} }); h.render(); await h.settle();
  familyInput(h, 'dolby').props.onChange({ currentTarget: { checked: true } }); await h.settle();
  familyInput(h, 'h264').props.onChange({ currentTarget: { checked: true } }); await h.settle();
  flagInput(h, 'powerEfficient').props.onChange({ currentTarget: { checked: false } }); await h.settle();
  assert.deepEqual(JSON.parse(jsonView(h).props.value), valueOf(true, true, false, ['h264', 'dolby']));
  assert.deepEqual(Object.keys(JSON.parse(jsonView(h).props.value)), ['hidden', 'powerEfficient', 'smooth', 'supported']);
  setJson(h, JSON.stringify({ supported: true, smooth: false, powerEfficient: true, hidden: ['mp3', 'aac'] })); await h.settle();
  assert.deepEqual(flagState(h), [[true, false], [false, false], [true, false]]); assert.deepEqual(hiddenOf(h), ['aac', 'mp3']);
  setJson(h, JSON.stringify(valueOf(false, false, false, ['av1']))); await h.settle();
  assert.deepEqual(flagState(h), [[false, false], [false, true], [false, true]]); assert.deepEqual(hiddenOf(h), ['av1']);
  assert.ok(h.attr('data-media-codec-all-off'));
  h.unmount();
});

test('an invalid JSON view locks the controls on the last valid value, says why, and a fix unlocks them; Save refuses the draft meanwhile', async () => {
  const saves = [], h = modalHarness({ entry: mediaEntry(), onSave: async next => saves.push(next), onClose() {} }); h.render(); await h.settle();
  familyInput(h, 'aac').props.onChange({ currentTarget: { checked: true } }); await h.settle();
  h.attr('data-api-value-name').props.onInput({ currentTarget: { value: 'Draft' } });
  for (const broken of ['{ "supported": tru', '{"supported":true,"smooth":true,"powerEfficient":true}', JSON.stringify(valueOf(false, true, false)), JSON.stringify({ ...valueOf(true, true, true), hidden: ['h263'] })]) {
    setJson(h, broken); await h.settle();
    assert.ok(h.attr('data-media-codec-invalid'), broken); assert.equal(h.nodes(node => node.type === 'input').filter(node => node.props['data-media-codec-field'] || node.props['data-media-codec-family']).filter(node => node.props.disabled === true).length, 14, broken);
    assert.deepEqual(hiddenOf(h), ['aac'], 'the last valid value stays shown');
    await submit(h); await h.settle();
    assert.equal(saves.length, 0, broken); assert.ok(h.attr('role', 'alert'), broken);
  }
  setJson(h, JSON.stringify(valueOf(true, true, true, ['flac']))); await h.settle();
  assert.equal(h.attr('data-media-codec-invalid'), undefined); assert.deepEqual(hiddenOf(h), ['flac']);
  assert.ok(familyInput(h, 'aac').props.disabled === false);
  h.unmount();
});

test('Save takes the same path as the JSON editor: the contract-validated value of the text, under the entered name', async () => {
  const saves = [], h = modalHarness({ entry: mediaEntry(), onSave: async next => saves.push(next), onClose() {} }); h.render(); await h.settle();
  h.attr('data-api-value-name').props.onInput({ currentTarget: { value: 'No H.264' } });
  familyInput(h, 'h264').props.onChange({ currentTarget: { checked: true } }); await h.settle();
  flagInput(h, 'smooth').props.onChange({ currentTarget: { checked: false } }); await h.settle();
  await submit(h); await h.settle();
  assert.equal(saves.length, 1);
  assert.deepEqual(saves[0].value, { kind: 'value', value: valueOf(true, false, true, ['h264']) });
  assert.equal(saves[0].label, 'No H.264');
  assert.equal(validateApiValue('media-capabilities', saves[0].value).ok, true);
  // The same draft typed into the JSON view saves the identical value.
  const typed = modalHarness({ entry: mediaEntry(), onSave: async next => saves.push(next), onClose() {} }); typed.render(); await typed.settle();
  typed.attr('data-api-value-name').props.onInput({ currentTarget: { value: 'No H.264' } }); setJson(typed, '{"supported":true,"smooth":false,"powerEfficient":true,"hidden":["h264"]}'); await typed.settle();
  await submit(typed); await typed.settle();
  assert.deepEqual(saves[1].value, saves[0].value);
  // A missing name is refused before anything is saved, like for every other API.
  const unnamed = modalHarness({ entry: mediaEntry(), onSave: async next => saves.push(next), onClose() {} }); unnamed.render(); await unnamed.settle();
  await submit(unnamed); await unnamed.settle(); assert.equal(saves.length, 2); assert.ok(unnamed.attr('role', 'alert'));
  h.unmount(); typed.unmount(); unnamed.unmount();
});

test('while a save is running the controls are locked with the rest of the form', async () => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const h = modalHarness({ entry: mediaEntry(), onSave: () => pending, onClose() {} }); h.render(); await h.settle();
  h.attr('data-api-value-name').props.onInput({ currentTarget: { value: 'Busy' } }); await h.settle();
  const controls = () => h.nodes(node => node.type === 'input' && (node.props['data-media-codec-field'] || node.props['data-media-codec-family']));
  assert.equal(controls().length, 14); assert.ok(controls().some(node => node.props.disabled === false), 'unlocked before saving');
  const saving = submit(h); await h.settle();
  assert.equal(controls().length, 14); assert.ok(controls().every(node => node.props.disabled === true), 'every box is locked while the save runs');
  release(); await saving; await h.settle(); h.unmount();
});

test('the controls never probe the browser and use only the local draft (REQ-001)', () => {
  const module = sourceOf('apps/production-extension/media-codec-configuration-ui.js');
  for (const pattern of [/\.canPlayType\s*\(/, /\.isTypeSupported\s*\(/, /\.decodingInfo\s*\(/, /\.encodingInfo\s*\(/, /\bnavigator\b/, /\bfetch\s*\(/, /XMLHttpRequest/, /new\s+Audio\b/, /new\s+MediaSource\b/, /createElement\s*\(\s*['"](?:video|audio)/, /\bchrome\./, /\bbrowser\./, /\bstorage\b/, /\beval\s*\(/, /new\s+Function/]) assert.doesNotMatch(module, pattern, String(pattern));
  assert.match(module, /from '\.\/api-configuration\.js'/); assert.equal((module.match(/^import /gm) ?? []).length, 1, 'the only import is the contract');
});

test('every class the controls use has a rule in the stylesheet that all four extension pages load', () => {
  const module = sourceOf('apps/production-extension/media-codec-configuration-ui.js'), css = sourceOf('apps/production-extension/api-configuration-ui.css');
  const classes = new Set([...module.matchAll(/class: '([^']+)'/g)].flatMap(match => match[1].split(' ')));
  assert.ok(classes.has('media-codec-fields') && classes.has('media-codec-section') && classes.has('media-codec-check') && classes.has('media-codec-families') && classes.has('media-codec-note'));
  // A rule whose selector ends in the class (a longer class name or a mention inside another selector does not count).
  const ruleFor = name => { for (let at = css.indexOf('.' + name); at >= 0; at = css.indexOf('.' + name, at + 1)) { const next = css.slice(at + name.length + 1).trimStart()[0]; if (next === '{' || next === ',') return true; } return false; };
  for (const name of classes) assert.ok(ruleFor(name), name + ' has a rule');
  for (const page of ['options.html', 'popup.html', 'sidepanel.html', 'protection.html']) assert.ok(sourceOf('apps/production-extension/' + page).includes('href="api-configuration-ui.css"'), page);
  assert.match(css, /@media \(forced-colors: active\) \{ \.media-codec-section/);
});

// ---- the 21 languages ----
const range = (from, to = from) => String.fromCodePoint(from) + (to === from ? '' : '-' + String.fromCodePoint(to));
const FORBIDDEN = new RegExp('[' + range(0x61c) + range(0x200b, 0x200f) + range(0x202a, 0x202e) + range(0x2066, 0x2069) + ']', 'u');
// The shipped claim patterns of honest-copy.test.mjs (REQ-007 / REQ-014), applied to this file's own copy.
const CLAIMS = [/\binvisib/iu, /\bundetectab/iu, /\banonym/iu, /\bbypass/iu, /\bstealth/iu, /(?<![\d.,])100\s?%/u, /\bguarant/iu, /\blegitimat/iu,
  /(?<!\p{L})невидим/iu, /(?<!\p{L})необнаружим/iu, /(?<!\p{L})анонимн/iu, /(?<!\p{L})обход/iu, /(?<!\p{L})гарантир/iu, /(?<!\p{L})легитимн/iu];

test('all 21 languages have exactly the eight keys: trimmed, single-line, no hidden formatting characters, no placeholders', () => {
  assert.deepEqual(Object.keys(MEDIA_CODEC_MESSAGES).sort(), PRODUCTION_LANGUAGES.map(language => language.id).sort());
  assert.equal(PRODUCTION_LANGUAGES.length, 21); assert.equal(MEDIA_CODEC_KEYS.length, 8);
  assert.deepEqual([...MEDIA_CODEC_KEYS], MEDIA_CODEC_FIELDS.map(field => 'media_codecs_' + field));
  for (const [locale, messages] of Object.entries(MEDIA_CODEC_MESSAGES)) {
    assert.deepEqual(Object.keys(messages), [...MEDIA_CODEC_KEYS], locale);
    const table = applyMediaCopy({}, locale); assert.deepEqual(Object.keys(table), [...MEDIA_CODEC_KEYS]);
    for (const key of MEDIA_CODEC_KEYS) {
      const message = messages[key]; assert.equal(table[key].message, message);
      assert.ok(message && message === message.trim() && !message.includes(String.fromCharCode(10)), locale + ':' + key);
      assert.doesNotMatch(message, /[{}]|\$\{|%s|%d/u, locale + ':' + key + ' has a placeholder');
      for (const claim of CLAIMS) assert.doesNotMatch(message, claim, locale + ':' + key + ' ' + claim);
      if (locale !== 'te') assert.doesNotMatch(message, FORBIDDEN, locale + ':' + key);
      if (locale !== 'en') assert.notEqual(message, MEDIA_CODEC_MESSAGES.en[key], locale + ':' + key + ' is not translated');
    }
  }
  // Telugu needs the zero-width non-joiner U+200C in one word and nothing else of that kind.
  assert.deepEqual([...MEDIA_CODEC_MESSAGES.te.media_codecs_note].filter(character => FORBIDDEN.test(character)).map(character => character.codePointAt(0)), [0x200c]);
  assert.throws(() => applyMediaCopy({}, 'xx'), /unknown locale/); assert.throws(() => applyMediaCopy(null, 'en'), TypeError); assert.throws(() => applyMediaCopy([], 'en'), TypeError);
});

test('in every language the note names the three APIs, the two gaps and says a Custom value can only lower; the labels name the flags', () => {
  for (const [locale, messages] of Object.entries(MEDIA_CODEC_MESSAGES)) {
    const note = messages.media_codecs_note;
    for (const word of ['MediaCapabilities', 'canPlayType', 'isTypeSupported', 'Workers', 'about:', 'blob:', 'data:', 'Custom']) assert.ok(note.includes(word), locale + ' note names ' + word);
    assert.ok(note.length >= 100 && note.length <= 360, locale + ' note is one short paragraph');
    assert.ok(messages.media_codecs_all_off.length >= 20 && messages.media_codecs_json_invalid.length >= 15, locale);
    assert.ok(new Set([messages.media_codecs_supported, messages.media_codecs_smooth, messages.media_codecs_power]).size >= (['zh_CN', 'yue', 'wuu'].includes(locale) ? 3 : 3), locale + ' three different flag labels');
  }
});

test('production-locales.mjs applies the media copy to every language table', () => {
  const pipeline = sourceOf('scripts/production-locales.mjs');
  assert.match(pipeline, /import \{ applyMediaCopy \} from '\.\/production-locales-media\.mjs';/);
  assert.match(pipeline, /applyMediaCopy\(table, language\.id\);/);
  assert.ok(pipeline.indexOf('applyMediaCopy(table, language.id);') < pipeline.indexOf('table.extName.message = EXTENSION_NAME;'), 'before the table is written');
});
