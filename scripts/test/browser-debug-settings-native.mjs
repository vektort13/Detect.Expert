// ADR-055/063: Browser Debug is a Settings subpage in the real owned Options.
// Unchanged delivery, disposable profiles, no permission grants or external probes.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launchOwnedManagement, until } from './management-browser-fixture.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';

const root = resolve(import.meta.dirname, '../..'), browser = process.argv.includes('--firefox') ? 'firefox' : 'chrome';
mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/browser-debug-settings-' + browser + '-')), frozen = join(run, 'frozen');
cpSync(join(root, 'dist', browser), frozen, { recursive: true });
const directory = join(root, 'test-results/production-1.1.0/browser-debug-settings'); mkdirSync(directory, { recursive: true });
const files = ['manifest.json','options.html','options.js','options.css','management-ui.js','management-ui.css','management-navigation.js','browser-debug-ui.js','browser-debug-ui.css','browser-debug-controller.js'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const evidence = { at: new Date().toISOString(), browser, run, result: 'RUNNING', disposableProfile: true, externalConnectionAttempted: false, permissionGranted: false, hashes: Object.fromEntries(files.map(file => [file, hash(readFileSync(join(frozen, file)))])), checks: [], locales: [], screenshots: [] };
const tabs = ['hub','detector','api','firewall','antidetect','autosurf','cookies','proxy','integrations','settings','contacts'];
const check = text => { evidence.checks.push(text); console.log('  ok ' + text); };
let opened, phase = 'startup';
async function route(section) {
  await until(() => opened.evaluate(section => document.querySelector('[data-management-shell]')?.dataset.managementActive === section && document.querySelector('[data-management-panel="' + section + '"]')?.hidden === false, section), section + ' route');
  const state = await opened.evaluate(() => ({ selected: [...document.querySelectorAll('[data-management-tab][aria-selected="true"]')].map(tab => tab.dataset.managementTab), roving: [...document.querySelectorAll('[data-management-tab][tabindex="0"]')].map(tab => tab.dataset.managementTab), panels: [...document.querySelectorAll('[data-management-panel]')].map(panel => ({ id: panel.dataset.managementPanel, hidden: panel.hidden, inert: panel.inert, labelled: Boolean(document.getElementById(panel.getAttribute('aria-labelledby'))) })), controls: document.querySelector('[data-management-tab="settings"]')?.getAttribute('aria-controls') }));
  assert.deepEqual(state.selected, [section === 'browser-debug' ? 'settings' : section]); assert.equal(state.roving.length, 1);
  assert.equal(state.panels.length, 12, 'hub, ten primary sections and Browser Debug'); for (const panel of state.panels) { assert.equal(panel.hidden, panel.id !== section); assert.equal(panel.inert, panel.id !== section); assert.equal(panel.labelled, true); }
  if (section === 'browser-debug' || section === 'settings') assert.equal(state.controls, 'management-panel-' + section);
}
async function locale(id) {
  await opened.evaluate(async id => { await (globalThis.browser ?? globalThis.chrome).storage.local.set({ 'ui-language-v1': id }); }, id);
  await until(() => opened.evaluate(id => document.querySelector('[data-management-shell]')?.lang === id.replaceAll('_','-'), id), 'locale ' + id);
}
try {
  opened = await launchOwnedManagement({ root, run, extension: frozen, browser, evidence, dark: browser === 'firefox' }); evidence.version = opened.version;
  await opened.goto(opened.base + 'options.html?tabId=13#browser-debug'); await route('browser-debug');
  assert.deepEqual(await opened.evaluate(() => [...document.querySelectorAll('[data-management-tab]')].map(tab => tab.dataset.managementTab)), tabs);
  assert.equal(await opened.evaluate(() => document.querySelector('[data-management-tab="browser-debug"]')), null);
  assert.equal(await opened.evaluate(() => document.title), 'Browser Debug — Detect Expert');
  assert.equal(await opened.evaluate(() => Boolean(document.querySelector('[data-browser-debug-count]'))), false);
  const identity = randomUUID(); await opened.evaluate(identity => { window.__settingsDebugIdentity = identity; }, identity);
  check('canonical #browser-debug opens under the selected Settings tab with eleven visible tabs, one roving tab, correct panel relations and no automatic snapshot');

  phase = 'entry, back and inactive guard';
  await opened.fill('[data-browser-debug-search]', 'OWNED_SETTINGS_QUERY'); await opened.click('[data-browser-debug-back]'); await route('settings');
  await opened.evaluate(() => document.querySelector('[data-browser-debug-load]').click());
  await opened.click('[data-settings-browser-debug]'); await route('browser-debug');
  assert.equal(await opened.evaluate(() => document.querySelector('[data-browser-debug-search]').value), 'OWNED_SETTINGS_QUERY');
  assert.equal(await opened.evaluate(() => Boolean(document.querySelector('[data-browser-debug-count]'))), false);
  assert.equal(await opened.evaluate(() => window.__settingsDebugIdentity), identity); assert.equal(await opened.evaluate(() => new URL(location.href).searchParams.get('tabId')), '13');
  await opened.evaluate(() => history.back()); await route('settings'); await opened.evaluate(() => history.forward()); await route('browser-debug');
  assert.equal(await opened.evaluate(() => window.__settingsDebugIdentity), identity);
  check('Settings entry/back and browser history reuse one document and source-tab query; hidden Debug cannot Load, and its existing RAM search draft survives');

  phase = 'visible tab keyboard'; await locale('en');
  await opened.evaluate(() => { const tab = document.querySelector('[data-management-tab="settings"]'); tab.focus(); tab.dispatchEvent(new KeyboardEvent('keydown', { key:'ArrowRight', bubbles:true })); });
  assert.equal(await opened.evaluate(() => document.activeElement?.dataset.managementTab), 'contacts'); await route('browser-debug');
  await opened.evaluate(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', bubbles:true }))); await route('contacts');
  await opened.evaluate(() => { location.hash = '#browser-debug'; }); await route('browser-debug'); await locale('ar');
  await opened.evaluate(() => { const tab = document.querySelector('[data-management-tab="settings"]'); tab.focus(); tab.dispatchEvent(new KeyboardEvent('keydown', { key:'ArrowLeft', bubbles:true })); });
  assert.equal(await opened.evaluate(() => document.activeElement?.dataset.managementTab), 'contacts');
  await opened.click('[data-management-tab="settings"]'); await route('settings');
  check('LTR Right and RTL Left skip the nested Debug route and focus Contacts; manual activation changes pages while arrows alone retain the current route');

  phase = '21 localized entry/back labels';
  for (const language of PRODUCTION_LANGUAGES) {
    await locale(language.id); const catalog = JSON.parse(readFileSync(join(frozen, language.uiOnly ? 'ui-locales' : '_locales', language.id, 'messages.json')));
    assert.equal(await opened.evaluate(() => document.querySelector('[data-settings-browser-debug] strong').textContent), catalog.management_tab_browser_debug.message);
    // The 2026-10-31 internal-menu redesign removed the repeated introductory line on purpose: the entry is icon + localized title + arrow.
    // Keep asserting that the text block holds exactly the authored title (no stale or unresolved secondary line) in every locale.
    assert.deepEqual(await opened.evaluate(() => { const entry = document.querySelector('[data-settings-browser-debug]'), text = entry.querySelector('.management-settings-entry__text'); return { tags: [...text.children].map(child => child.tagName), text: text.textContent, unresolved: /management_tab_|browser_debug_/.test(entry.textContent) }; }), { tags: ['STRONG'], text: catalog.management_tab_browser_debug.message, unresolved: false });
    await opened.click('[data-settings-browser-debug]'); await route('browser-debug');
    assert.equal(await opened.evaluate(() => document.querySelector('[data-browser-debug-back]').textContent.trim()), catalog.management_tab_settings.message);
    assert.equal(await opened.evaluate(() => /management_tab_|browser_debug_/.test(document.querySelector('[data-browser-debug]').textContent)), false);
    await opened.click('[data-browser-debug-back]'); await route('settings'); evidence.locales.push(language.id);
  }
  check('all 21 shipped locales display the authored Settings entry title (title-only entry, no stale subtitle) and back label without unresolved keys');

  phase = 'explicit safe overview load'; await locale('en'); await opened.click('[data-settings-browser-debug]'); await route('browser-debug'); await opened.fill('[data-browser-debug-search]', '');
  assert.equal(await opened.evaluate(() => Boolean(document.querySelector('[data-browser-debug-count]'))), false);
  await opened.click('[data-browser-debug-load]'); await until(() => opened.evaluate(() => document.querySelector('[data-browser-debug]')?.getAttribute('aria-busy') === 'false' && document.querySelectorAll('[data-browser-debug-record]').length > 0), 'explicit overview snapshot');
  assert.equal(await opened.evaluate(() => Boolean(document.querySelector('[data-browser-debug-error]'))), false);
  await opened.click('[data-browser-debug-back]'); await route('settings'); assert.equal(await opened.evaluate(() => document.querySelector('[data-browser-debug]').getAttribute('aria-busy')), 'false');
  await opened.click('[data-settings-browser-debug]'); await route('browser-debug');
  assert.ok(await opened.evaluate(() => document.querySelectorAll('[data-browser-debug-record]').length) > 0);
  assert.deepEqual(await opened.evaluate(() => Promise.all(['history','bookmarks','nativeMessaging'].map(permission => (globalThis.browser ?? globalThis.chrome).permissions.contains({ permissions:[permission] })))), [false,false,false]);
  check('only explicit Load reads the safe overview; leaving clears busy/active acceptance while retaining the existing snapshot, with sensitive/native permissions ungranted');

  phase = 'responsive screenshots';
  for (const [id,width] of [['ru',1180],['ar',340]]) {
    await locale(id); await opened.media({ colorScheme: browser === 'chrome' && id === 'ru' ? 'light' : 'dark' }); await opened.viewport(width,900);
    await opened.evaluate(async () => { document.activeElement?.blur?.(); scrollTo(0,0); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
    const geometry = await opened.evaluate(() => ({ width:innerWidth, overflow:document.documentElement.scrollWidth > innerWidth + 1, dir:getComputedStyle(document.querySelector('[data-management-shell]')).direction, top:scrollY, backVisible:Boolean(document.querySelector('[data-browser-debug-back]').getClientRects().length) }));
    assert.equal(geometry.width,width); assert.equal(geometry.overflow,false); assert.equal(geometry.top,0); assert.equal(geometry.dir,id === 'ar' ? 'rtl' : 'ltr'); assert.equal(geometry.backVisible,true);
    const file = browser + '-' + id + '-' + width + '.png', path = join(directory,file); await opened.screenshot(path); evidence.screenshots.push({ file, sha256:hash(readFileSync(path)), ...geometry });
  }
  check('RU desktop and Arabic narrow dark screenshots retain the Settings selection, visible backlink and unclipped nested content');
  evidence.result = 'PASS'; console.log('PASS Browser Debug Settings ' + browser + ': ' + evidence.checks.length + ' checks');
} catch (error) { evidence.result='FAIL'; evidence.phase=phase; evidence.error=error.message; if(opened) try { await opened.screenshot(join(run,'failed.png')); } catch {} throw error; }
finally { try { if(opened) await opened.close(); } finally { writeFileSync(join(directory,browser+'.json'),JSON.stringify(evidence,null,2)+'\n'); } }
