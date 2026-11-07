// Round 5 (ADR-101 amendment): the media codec controls of the Custom value editor in a REAL browser DOM. The production ValueModal and the real
// api-configuration-ui.css are bundled with Preact (esbuild, in memory) into an owned blank page; no extension, no network, nothing is decoded.
// Checked: fieldset/legend structure, the keyboard path (Tab order, Space toggles real checkboxes), disabled controls leaving the Tab order,
// the JSON view staying in sync in both directions, Save through the same path, and - for every one of the 21 languages, left to right and
// right to left, at the modal width and at 320 px - that no text is clipped or pushes the form sideways.
//
// node scripts/test/media-codec-fields-native.mjs [--firefox]
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, firefox } from 'playwright';
import { MEDIA_CODEC_MESSAGES } from '../production-locales-media.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';

const root = resolve(import.meta.dirname, '../..'), source = join(root, 'apps/production-extension'), useFirefox = process.argv.includes('--firefox');
const FAMILIES = ['h264', 'h265', 'av1', 'vp9', 'vp8', 'aac', 'opus', 'vorbis', 'flac', 'mp3', 'dolby'];
const entrySource = `
import { h, render } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { createApiConfigurationUi } from './apps/production-extension/api-configuration-ui.js';
import { API_CONFIG_CATALOG } from './apps/production-extension/api-configuration.js';
window.__saved = [];
window.__show = (messages, language, value) => {
  render(null, document.body);
  document.documentElement.lang = language; document.documentElement.dir = language === 'ar' || language === 'ur' ? 'rtl' : 'ltr';
  const ui = createApiConfigurationUi({ h, useState, useEffect, useRef, useLocale: () => 'en', browserApi: {}, translate: id => messages[id] });
  const entry = { ...JSON.parse(JSON.stringify(API_CONFIG_CATALOG.find(item => item.id === 'media-capabilities'))), mode: 'custom', selected: { kind: 'unset' }, userValues: [], settings: {} };
  render(h(ui.ValueModal, { entry, value: value ?? null, onSave: async next => { window.__saved.push(JSON.parse(JSON.stringify(next))); }, onClose() { window.__closed = true; } }), document.body);
};`;
const bundle = (await build({ stdin: { contents: entrySource, resolveDir: root, sourcefile: 'media-codec-fields-page.js', loader: 'js' }, bundle: true, write: false, format: 'iife', platform: 'browser', target: 'chrome119', logLevel: 'silent' })).outputFiles[0].text;
const css = readFileSync(join(source, 'api-configuration-ui.css'), 'utf8');
const page_html = '<!doctype html><html><head><meta charset="utf-8"><title>media codec fields</title><meta name="color-scheme" content="light dark"><style>:root{--text:#14283b;--surface:#fff;--surface-2:#f1f4f8;--border:#d2d8e0;--muted:#526273;--accent:#2454b8}body{margin:0;font:14px system-ui,sans-serif}.button{padding:8px 14px}</style><style>' + css + '</style></head><body></body></html>';

async function launchFirefox() {
  try { return await firefox.launch({ headless: true }); }
  catch { return await firefox.launch({ headless: true, executablePath: process.env.FIREFOX_BINARY || join(process.env.LOCALAPPDATA || '', 'ms-playwright/firefox-1538/firefox/firefox.exe') }); }
}
const browser = useFirefox ? await launchFirefox() : await chromium.launch({ headless: true });
const checks = [], ok = label => { checks.push(label); console.log('  ok ' + label); };
try {
  const context = await browser.newContext({ viewport: { width: 900, height: 1100 } }), page = await context.newPage();
  await page.setContent(page_html); await page.addScriptTag({ content: bundle });
  const show = (language, value) => page.evaluate(([messages, tag, current]) => window.__show(messages, tag, current), [language === 'en' ? {} : MEDIA_CODEC_MESSAGES[language], language, value ?? null]);
  const focusName = () => page.evaluate(() => { const active = document.activeElement; return active?.getAttribute('data-media-codec-field') ?? active?.getAttribute('data-media-codec-family') ?? (active?.hasAttribute('data-api-value-name') ? 'name' : active?.hasAttribute('data-api-value-input') ? 'json' : active?.textContent?.trim() || active?.tagName); });
  const json = () => page.inputValue('[data-api-value-input]');
  const disabledCount = () => page.evaluate(() => [...document.querySelectorAll('[data-media-codec-fields] input')].filter(input => input.matches(':disabled')).length);

  // ---- structure and keyboard (English) ----
  await show('en'); await page.waitForSelector('[data-media-codec-fields]');
  const structure = await page.evaluate(() => ({
    fieldsets: [...document.querySelectorAll('[data-media-codec-fields] fieldset')].map(set => set.querySelector('legend')?.textContent),
    checkboxes: [...document.querySelectorAll('[data-media-codec-fields] input')].map(input => input.type),
    flags: [...document.querySelectorAll('[data-media-codec-field]')].map(input => input.getAttribute('data-media-codec-field')),
    families: [...document.querySelectorAll('[data-media-codec-family]')].map(input => [input.getAttribute('data-media-codec-family'), input.closest('label').textContent]),
    note: document.querySelector('[data-media-codec-note]')?.textContent, described: document.querySelector('[data-media-codec-families]')?.getAttribute('aria-describedby'), noteId: document.querySelector('[data-media-codec-note]')?.id,
    labelled: [...document.querySelectorAll('[data-media-codec-fields] input')].every(input => input.closest('label')?.textContent.trim().length > 0),
    textarea: document.querySelector('[data-api-value-input]')?.tagName, start: document.querySelector('[data-api-value-input]')?.value
  }));
  assert.deepEqual(structure.fieldsets, ['Answer given to the page', 'Hide codec families']);
  assert.equal(structure.checkboxes.length, 14); assert.ok(structure.checkboxes.every(type => type === 'checkbox'), 'real checkboxes');
  assert.deepEqual(structure.flags, ['supported', 'smooth', 'powerEfficient']); assert.deepEqual(structure.families.map(([family]) => family), FAMILIES);
  assert.deepEqual(structure.families.slice(0, 10).map(([, label]) => label), ['H.264', 'H.265 / HEVC', 'AV1', 'VP9', 'VP8', 'AAC', 'Opus', 'Vorbis', 'FLAC', 'MP3']); assert.match(structure.families[10][1], /^Dolby /);
  assert.equal(structure.described, structure.noteId); assert.ok(structure.labelled); assert.equal(structure.textarea, 'TEXTAREA');
  assert.deepEqual(JSON.parse(structure.start), { hidden: [], powerEfficient: true, smooth: true, supported: true }, 'a new value starts from the browser answer');
  ok('structure: two fieldsets with legends, 3 + 11 real labelled checkboxes in contract order, the note describes the families group, the JSON view is a textarea');

  assert.equal(await focusName(), 'name', 'the dialog focuses the name field');
  const order = [];
  for (let step = 0; step < 18; step++) { await page.keyboard.press('Tab'); order.push(await focusName()); }
  assert.deepEqual(order, ['supported', 'smooth', 'powerEfficient', ...FAMILIES, 'json', 'Cancel', 'Save', 'name'], 'Tab visits the controls in reading order and wraps inside the dialog');
  ok('keyboard: Tab order name -> 3 flags -> 11 families -> JSON -> Cancel -> Save -> wraps to the name');

  // Space toggles the focused real checkbox; the JSON view follows at once.
  for (let step = 0; step < 3; step++) await page.keyboard.press('Tab');
  assert.equal(await focusName(), 'powerEfficient'); await page.keyboard.press('Space');
  assert.equal(JSON.parse(await json()).powerEfficient, false);
  await page.keyboard.press('Tab'); assert.equal(await focusName(), 'h264'); await page.keyboard.press('Space');
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); assert.equal(await focusName(), 'aac'); await page.keyboard.press('Space');
  assert.deepEqual(JSON.parse(await json()), { hidden: ['h264', 'aac'], powerEfficient: false, smooth: true, supported: true });
  ok('keyboard: Space on the focused boxes changes the draft; the JSON view shows { hidden: [h264, aac], powerEfficient: false } in contract order');

  // ---- Supported off locks the rest, leaves them out of the Tab order, shows them off; switching it on gives them back ----
  await page.focus('[data-media-codec-field="supported"]'); await page.keyboard.press('Space');
  assert.deepEqual(JSON.parse(await json()), { hidden: ['h264', 'aac'], powerEfficient: false, smooth: false, supported: false });
  assert.equal(await disabledCount(), 13);
  const lockedState = await page.evaluate(() => ({ smooth: document.querySelector('[data-media-codec-field="smooth"]').checked, power: document.querySelector('[data-media-codec-field="powerEfficient"]').checked,
    hidden: [...document.querySelectorAll('[data-media-codec-family]')].filter(input => input.checked).map(input => input.getAttribute('data-media-codec-family')), allOff: document.querySelector('[data-media-codec-all-off]')?.textContent }));
  assert.deepEqual(lockedState, { smooth: false, power: false, hidden: ['h264', 'aac'], allOff: 'Supported is off: every codec is reported as unsupported, whatever is ticked below.' });
  await page.keyboard.press('Tab'); assert.equal(await focusName(), 'json', 'the locked boxes are skipped by Tab');
  await page.keyboard.press('Shift+Tab'); assert.equal(await focusName(), 'supported');
  await page.keyboard.press('Space'); assert.equal(await disabledCount(), 0);
  assert.deepEqual(JSON.parse(await json()), { hidden: ['h264', 'aac'], powerEfficient: false, smooth: true, supported: true }, 'smooth comes back as it was, power efficient stays off');
  ok('Supported off: smooth, power efficient and the 11 families are disabled, shown off, skipped by Tab, with the all-off note; Supported on restores them');

  // ---- the JSON view drives the controls, an invalid text locks them, Save takes the validated value ----
  await page.fill('[data-api-value-input]', '{"supported":true,"smooth":false,"powerEfficient":true,"hidden":["mp3","vp9"]}');
  assert.deepEqual(await page.evaluate(() => ({ flags: ['supported', 'smooth', 'powerEfficient'].map(key => document.querySelector('[data-media-codec-field="' + key + '"]').checked), hidden: [...document.querySelectorAll('[data-media-codec-family]')].filter(input => input.checked).map(input => input.getAttribute('data-media-codec-family')) })), { flags: [true, false, true], hidden: ['vp9', 'mp3'] });
  await page.fill('[data-api-value-input]', '{"supported":true,');
  assert.equal(await disabledCount(), 14); assert.equal(await page.locator('[data-media-codec-invalid]').count(), 1);
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('[data-media-codec-family]')].filter(input => input.checked).length), 2, 'the last valid value stays shown');
  await page.fill('[data-api-value-input]', '{"supported":true,"smooth":true,"powerEfficient":true,"hidden":["flac"]}');
  assert.equal(await disabledCount(), 0); assert.equal(await page.locator('[data-media-codec-invalid]').count(), 0);
  await page.fill('[data-api-value-name]', 'No FLAC'); await page.click('[data-api-value-save]');
  await page.waitForFunction(() => window.__saved.length === 1);
  assert.deepEqual(await page.evaluate(() => window.__saved[0]), { id: 'custom-1', label: 'No FLAC', value: { kind: 'value', value: { hidden: ['flac'], powerEfficient: true, smooth: true, supported: true } } });
  ok('JSON view <-> controls stay in sync, an invalid text locks the controls on the last valid value, Save hands over the validated value');

  // ---- every language, left to right and right to left: texts are there and nothing is clipped or pushes sideways ----
  const widths = [{ width: 900, height: 1100 }, { width: 320, height: 1000 }];
  let measured = 0;
  for (const language of PRODUCTION_LANGUAGES.map(item => item.id)) for (const size of widths) {
    await page.setViewportSize(size); await show(language); await page.waitForSelector('[data-media-codec-fields]');
    const result = await page.evaluate(() => {
      const modal = document.querySelector('.api-config-modal'), fields = document.querySelector('[data-media-codec-fields]'), frame = modal.getBoundingClientRect();
      // The rectangle of the TEXT itself (a label box can stay narrow while its text runs out of it) against the content box of its group.
      const content = element => { const box = element.getBoundingClientRect(), style = getComputedStyle(element), edge = name => parseFloat(style[name]) || 0; return { left: box.left + edge('borderLeftWidth') + edge('paddingLeft'), right: box.right - edge('borderRightWidth') - edge('paddingRight') }; };
      const inside = [...fields.querySelectorAll('legend, label > span, p')].every(node => {
        const range = document.createRange(); range.selectNodeContents(node); const box = range.getBoundingClientRect(), holder = node.tagName === 'LEGEND' ? frame : content(node.closest('fieldset') ?? fields);
        return box.width > 0 && box.left >= holder.left - 1 && box.right <= holder.right + 1;
      });
      return { legends: [...fields.querySelectorAll('legend')].map(node => node.textContent), note: fields.querySelector('[data-media-codec-note]').textContent, labels: [...fields.querySelectorAll('[data-media-codec-field]')].map(input => input.closest('label').textContent),
        overflow: modal.scrollWidth - modal.clientWidth, formOverflow: fields.scrollWidth - fields.clientWidth, inside, dir: getComputedStyle(fields).direction, columns: getComputedStyle(fields.querySelector('.media-codec-families')).gridTemplateColumns.split(' ').length };
    });
    const expected = language === 'en' ? { media_codecs_flags: 'Answer given to the page', media_codecs_families: 'Hide codec families', media_codecs_supported: 'Supported', media_codecs_smooth: 'Smooth playback', media_codecs_power: 'Power efficient', media_codecs_note: MEDIA_CODEC_MESSAGES.en.media_codecs_note } : MEDIA_CODEC_MESSAGES[language];
    const label = language + ' @' + size.width;
    assert.deepEqual(result.legends, [expected.media_codecs_flags, expected.media_codecs_families], label);
    assert.equal(result.note, expected.media_codecs_note, label);
    assert.deepEqual(result.labels, [expected.media_codecs_supported, expected.media_codecs_smooth, expected.media_codecs_power], label);
    assert.ok(result.overflow <= 0 && result.formOverflow <= 0 && result.inside, label + ' overflows: ' + JSON.stringify(result));
    assert.equal(result.dir, language === 'ar' || language === 'ur' ? 'rtl' : 'ltr', label);
    assert.equal(result.columns, size.width <= 420 ? 1 : 2, label + ' family columns');
    measured++;
  }
  assert.equal(measured, 42);
  ok('21 languages x 2 widths (900 and 320 px; ar and ur right to left): the right texts, no clipping or sideways overflow, two family columns wide and one narrow');
  console.log(JSON.stringify({ browser: browser.version(), result: 'PASS', checks: checks.length }));
} catch (error) { console.error(error); process.exitCode = 1; }
finally { await browser.close(); }
