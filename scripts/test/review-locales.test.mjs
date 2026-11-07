// ADR-038: existing coverage status and newly visible API groups, no new warning UI.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';
import { applyProductionCoverageCopy } from '../production-locale-corrections.mjs';
import { applyReviewCopy, REVIEW_COVERAGE_COPY, REVIEW_MECHANISM_COPY, REVIEW_MECHANISM_KEYS } from '../production-locales-review.mjs';

test('review coverage and mechanism copy cover exactly the 21 production languages', () => {
  const locales = PRODUCTION_LANGUAGES.map(language => language.id).sort(); assert.equal(locales.length, 21);
  assert.deepEqual(Object.keys(REVIEW_COVERAGE_COPY).sort(), locales); assert.deepEqual(Object.keys(REVIEW_MECHANISM_COPY).sort(), locales);
  assert.equal(REVIEW_MECHANISM_KEYS.length, 6);
});

for (const { id, uiOnly } of PRODUCTION_LANGUAGES) test('current coverage and all six new mechanism headings are localized: ' + id, () => {
  const table = JSON.parse(readFileSync(new URL('../../apps/production-extension/' + (uiOnly ? 'ui-locales/' : '_locales/') + id + '/messages.json', import.meta.url), 'utf8'));
  const title = structuredClone(table.coverage_blind_spots_title), exportDescription = structuredClone(table.export_preview_desc);
  applyProductionCoverageCopy(table, id); applyReviewCopy(table, id);
  const text = table.coverage_blind_spots_desc.message, gap = text.indexOf('CSSOM');
  // Covered surfaces precede the remaining-gaps list in every translation.
  assert.ok(text.indexOf('Math') >= 0 && text.indexOf('Pro') > text.indexOf('Math'));
  for (const token of ['Math', 'Pro', 'Worker/Worklet', 'WebGPU', 'API']) assert.ok(text.indexOf(token) >= 0 && text.indexOf(token) < gap, token);
  for (const token of ['HTTP', 'CNAME', 'Wasm/worker/CSS', 'DNS', 'TLS']) assert.ok(text.indexOf(token) > gap, token);
  assert.doesNotMatch(text, /Not implemented|Не реализованы|Generic Sensor|Worker\/Worklet creation|WebGPU readback|Sites can notice|Сайт может заметить/);
  assert.doesNotMatch(text, /[<>$]/); assert.ok(text.length < 600);
  if (id !== 'en') assert.notEqual(text, REVIEW_COVERAGE_COPY.en);
  for (const [index, key] of REVIEW_MECHANISM_KEYS.entries()) {
    assert.equal(table[key].message, REVIEW_MECHANISM_COPY[id][index]); assert.ok(table[key].message.trim().length > 0);
    assert.doesNotMatch(table[key].message, /api_mechanism_|[<>$]/);
    if (id !== 'en' && !['api_mechanism_webtransport', 'api_mechanism_webauthn'].includes(key)) assert.notEqual(table[key].message, REVIEW_MECHANISM_COPY.en[index]);
  }
  assert.deepEqual(table.coverage_blind_spots_title, title); assert.deepEqual(table.export_preview_desc, exportDescription);
  const once = structuredClone(table); applyReviewCopy(table, id); assert.deepEqual(table, once);
});

test('locale overlay rejects an unsupported locale instead of generating untranslated review copy', () => {
  for (const id of ['missing', '__proto__', '', null, undefined]) assert.throws(() => applyReviewCopy({}, id), /Missing review locale/);
});

test('review coverage overlay runs after the historical media-only correction', () => {
  const source = readFileSync(new URL('../production-locales.mjs', import.meta.url), 'utf8');
  assert.ok(source.indexOf('applyReviewCopy(table, language.id)') > source.indexOf('applyProductionCoverageCopy(table, language.id)'));
  for (const name of ['popup.js', 'sidepanel.js']) {
    const ui = readFileSync(new URL('../../apps/production-extension/' + name, import.meta.url), 'utf8');
    assert.match(ui, /"data-coverage-limitations": "build", children: t3\("coverage_blind_spots_desc"\)/);
  }
});

test('popup and sidepanel resolve each new API group through its localized title key', () => {
  const mechanisms = ['device-sensor', 'webtransport', 'webauthn', 'clipboard', 'worker', 'storage'];
  for (const name of ['popup.js', 'sidepanel.js']) {
    const source = readFileSync(new URL('../../apps/production-extension/' + name, import.meta.url), 'utf8');
    for (const [index, mechanism] of mechanisms.entries()) assert.ok(source.includes('"' + mechanism + '": "' + REVIEW_MECHANISM_KEYS[index] + '"'), name + ': ' + mechanism);
  }
});
