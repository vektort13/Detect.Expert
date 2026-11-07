// REQ-002/013: report headings are complete in every shipped locale.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';
import { applyProReportCopy, PRO_REPORT_KEYS } from '../production-locales-report.mjs';

for (const { id } of PRODUCTION_LANGUAGES) test('Pro report headings are localized without placeholders: ' + id, () => {
  const unrelated = { message: 'Existing message', placeholders: { value: { content: '$1' } } };
  const table = { unrelated };
  assert.equal(applyProReportCopy(table, id), table);
  assert.equal(table.unrelated, unrelated);
  assert.equal(PRO_REPORT_KEYS.length, 16);
  for (const key of PRO_REPORT_KEYS) {
    assert.equal(typeof table[key]?.message, 'string', key);
    assert.ok(table[key].message.trim().length > 0, key);
    assert.equal(/[<>$]|report_data_/.test(table[key].message), false, key);
  }
  const once = structuredClone(table);
  applyProReportCopy(table, id);
  assert.deepEqual(table, once);
  if (id !== 'en') assert.notEqual(table.report_data_title.message, applyProReportCopy({}, 'en').report_data_title.message);
});

for (const { id, uiOnly } of PRODUCTION_LANGUAGES) test('Pro cookie recording facts are localized and idempotent without changing ordinary export: ' + id, () => {
  const table = JSON.parse(readFileSync(new URL('../../apps/production-extension/' + (uiOnly ? 'ui-locales/' : '_locales/') + id + '/messages.json', import.meta.url), 'utf8'));
  const originalExport = structuredClone(table.export_preview_desc);
  const originalStart = table.pro_start_note.message;
  applyProReportCopy(table, id);
  assert.deepEqual(table.export_preview_desc, originalExport);
  assert.ok(table.pro_start_note.message.startsWith(originalStart));
  assert.ok(table.pro_start_note.message.includes('Pro'));
  assert.ok(table.inventory_never.message.includes('Math'));
  assert.ok(table.inventory_never.message.includes('Canvas'));
  assert.ok(table.inventory_never.message.includes('ICE'));
  assert.ok(table.report_cookie_values_unavailable.message.length > 10);
  assert.ok(table.report_cookie_values_limited.message.length > 10);
  const once = structuredClone(table);
  applyProReportCopy(table, id);
  assert.deepEqual(table, once);
  if (id !== 'en') {
    const english = applyProReportCopy({}, 'en');
    assert.notEqual(table.report_cookie_values_unavailable.message, english.report_cookie_values_unavailable.message);
    assert.notEqual(table.report_cookie_values_limited.message, english.report_cookie_values_limited.message);
  }
});

test('cookie recording overlay removes only the old cookie exclusion and adds one precise storage fact', () => {
  const en = { inventory_never: { message: 'Never stored: audio samples, cookie values, request headers and bodies.' }, pro_start_note: { message: 'Records for 10 minutes.' }, export_preview_desc: { message: 'Values are excluded from the preview.' } };
  applyProReportCopy(en, 'en');
  const fact = 'During a Pro recording, outgoing cookie names and values and the values of a fixed list of technical request headers are stored locally for the report.';
  assert.equal(en.inventory_never.message, 'Never stored: audio samples, request headers and bodies. ' + fact);
  assert.equal(en.pro_start_note.message, 'Records for 10 minutes. ' + fact);
  assert.equal(en.export_preview_desc.message, 'Values are excluded from the preview.');
  applyProReportCopy(en, 'en');
  assert.equal(en.pro_start_note.message.split(fact).length - 1, 1);
  const ru = applyProReportCopy({}, 'ru');
  assert.equal(ru.report_cookie_values_unavailable.message, 'Значения отправленных cookies недоступны в этом браузере.');
  assert.equal(ru.report_cookie_values_limited.message, 'Часть значений отправленных cookies не сохранена.');
});

test('report labels describe recorded reads and calls without claiming network transmission or unique identities', () => {
  const en = applyProReportCopy({}, 'en'), ru = applyProReportCopy({}, 'ru');
  assert.equal(en.report_data_title.message, 'Data read by the site');
  assert.equal(ru.report_data_title.message, 'Данные, прочитанные сайтом');
  assert.equal(en.report_data_samples.message, 'Recorded calls');
  assert.equal(ru.report_data_samples.message, 'Записанные обращения');
});

test('report copy fails on an unknown locale instead of silently exporting mixed-language headings', () => {
  for (const locale of ['zz', '', '__proto__', null, undefined]) assert.throws(() => applyProReportCopy({}, locale), /unknown locale/);
  for (const table of [null, undefined, [], 'table']) assert.throws(() => applyProReportCopy(table, 'en'), /expected a message table/);
});
